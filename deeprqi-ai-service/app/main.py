import base64
import json
import logging

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO

from .config import CLASS_NAMES, MODEL_REGISTRY, DEFAULT_MODEL_NAME
from .explainability import EigenCAM, get_target_layer
from .occlusion import compute_occlusion_map, occlusion_map_to_overlay
from .rqi_engine import compute_rqi
from .schemas import PredictResponse, RQIResult, RQIComputeRequest
from .severity import compute_severity

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("deeprqi-ai-service")

app = FastAPI(title="DeepRQI AI Service", version="0.1.0")

# Loosened for local dev with the Node backend on a different port.
# Tighten this to your actual frontend/backend origins before any real deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load every registered model up front (see config.py -- MODEL_REGISTRY
# always has at least DEFAULT_MODEL_NAME). Eager loading keeps /predict
# latency flat regardless of which model is requested, at the cost of
# holding every model in memory for the life of the process -- fine for the
# handful of model variants this project compares, not meant to scale to
# dozens.
logger.info(f"Loading {len(MODEL_REGISTRY)} model(s): {list(MODEL_REGISTRY.keys())}")
_loaded_models = {}
for _name, _path in MODEL_REGISTRY.items():
    logger.info(f"  loading '{_name}' from {_path}")
    _m = YOLO(_path)
    _is_placeholder = _m.model.nc != len(CLASS_NAMES)
    if _is_placeholder:
        logger.warning(
            "Model '%s' (%s) has %s classes, not DeepRQI's %s trained classes -- looks like a "
            "placeholder/COCO checkpoint. Predictions will run but damage_type labels will be "
            "meaningless until it's pointed at real trained weights.",
            _name, _path, _m.model.nc, len(CLASS_NAMES),
        )
    _loaded_models[_name] = {
        "model": _m,
        "cam": EigenCAM(_m, get_target_layer(_m)),
        "path": _path,
        "is_placeholder": _is_placeholder,
    }


def _get_model_entry(name: str):
    entry = _loaded_models.get(name)
    if entry is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown model '{name}'. Available: {list(_loaded_models.keys())}",
        )
    return entry


@app.get("/models")
def list_models():
    return {
        "default": DEFAULT_MODEL_NAME,
        "models": [
            {
                "name": name,
                "path": entry["path"],
                "is_placeholder_model": entry["is_placeholder"],
                "num_classes_loaded": entry["model"].model.nc,
            }
            for name, entry in _loaded_models.items()
        ],
    }


@app.get("/health")
def health():
    default_entry = _loaded_models[DEFAULT_MODEL_NAME]
    return {
        "status": "ok",
        "model_path": default_entry["path"],
        "is_placeholder_model": default_entry["is_placeholder"],
        "num_classes_loaded": default_entry["model"].model.nc,
        "available_models": list(_loaded_models.keys()),
    }


@app.post("/predict", response_model=PredictResponse)
async def predict(file: UploadFile = File(...), model: str = DEFAULT_MODEL_NAME):
    entry = _get_model_entry(model)
    yolo_model = entry["model"]
    cam = entry["cam"]

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image.")

    contents = await file.read()
    npimg = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(npimg, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Could not decode image.")

    img_h, img_w = img.shape[:2]

    results = yolo_model.predict(img, verbose=False, conf=0.15)[0]

    detections = []
    for box in results.boxes:
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])
        xyxy = [float(v) for v in box.xyxy[0].tolist()]

        damage_type = CLASS_NAMES[cls_id] if cls_id < len(CLASS_NAMES) else f"unknown_class_{cls_id}"
        severity = compute_severity(xyxy, img_w, img_h)

        detections.append({
            "damage_type": damage_type,
            "confidence": round(conf, 4),
            "bbox": [round(v, 1) for v in xyxy],
            "severity": severity,
        })

    rqi_result = compute_rqi(detections)

    heatmap_img = cam.generate(img)
    success, buf = cv2.imencode(".png", heatmap_img)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to encode heatmap image.")
    heatmap_b64 = base64.b64encode(buf.tobytes()).decode("utf-8")

    return {
        "detections": detections,
        "rqi": rqi_result,
        "heatmap_base64": heatmap_b64,
        "image_width": img_w,
        "image_height": img_h,
    }


@app.post("/detect")
def detect(file: UploadFile = File(...), model: str = DEFAULT_MODEL_NAME):
    """
    Fast path for live capture. Skips EigenCAM and RQI computation.
    Runs synchronously so FastAPI offloads it to a threadpool, preventing
    the CPU-bound YOLO inference from blocking the async event loop.
    """
    entry = _get_model_entry(model)
    yolo_model = entry["model"]

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image.")

    contents = file.file.read()
    npimg = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(npimg, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Could not decode image.")

    img_h, img_w = img.shape[:2]

    results = yolo_model.predict(img, verbose=False, conf=0.15)[0]

    detections = []
    for box in results.boxes:
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])
        xyxy = [float(v) for v in box.xyxy[0].tolist()]

        damage_type = CLASS_NAMES[cls_id] if cls_id < len(CLASS_NAMES) else f"unknown_class_{cls_id}"
        severity = compute_severity(xyxy, img_w, img_h)

        detections.append({
            "damage_type": damage_type,
            "confidence": round(conf, 4),
            "bbox": [round(v, 1) for v in xyxy],
            "severity": severity,
        })

    return {"detections": detections}



@app.post("/predict/occlusion")
async def predict_occlusion(
    file: UploadFile = File(...),
    bbox: str = Form(...),
    model: str = Form(DEFAULT_MODEL_NAME),
    grid_size: int = Form(6),
):
    """
    Second XAI method (see occlusion.py) -- explains ONE specific detection
    (identified by its bbox, as already returned by /predict) via black-box
    occlusion sensitivity rather than EigenCAM's activation-reading. Not
    called automatically on every upload -- one call here is grid_size**2
    model forward passes, so this is meant to be triggered on demand for a
    single inspection someone's actually looking at.
    """
    entry = _get_model_entry(model)
    yolo_model = entry["model"]

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image.")
    if not (1 <= grid_size <= 12):
        raise HTTPException(status_code=400, detail="grid_size must be between 1 and 12.")

    try:
        target_bbox = json.loads(bbox)
        if not (isinstance(target_bbox, list) and len(target_bbox) == 4):
            raise ValueError
        target_bbox = [float(v) for v in target_bbox]
    except (json.JSONDecodeError, ValueError, TypeError):
        raise HTTPException(status_code=400, detail="bbox must be a JSON array of 4 numbers: [x1, y1, x2, y2].")

    contents = await file.read()
    npimg = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(npimg, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Could not decode image.")

    occlusion_map = compute_occlusion_map(yolo_model, img, target_bbox, grid_size=grid_size)
    overlay = occlusion_map_to_overlay(img, occlusion_map)

    success, buf = cv2.imencode(".png", overlay)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to encode occlusion overlay image.")
    overlay_b64 = base64.b64encode(buf.tobytes()).decode("utf-8")

    return {
        "occlusion_grid": occlusion_map.tolist(),
        "overlay_base64": overlay_b64,
        "detection_found": bool(occlusion_map.max() > 0) if occlusion_map.size else False,
    }


@app.post("/rqi/compute", response_model=RQIResult)
def recompute_rqi(req: RQIComputeRequest):
    """
    Recompute RQI from a manually verified list of detections.
    The list should omit false positives and include only verified
    or still-detected items.
    """
    return compute_rqi(req.detections)

