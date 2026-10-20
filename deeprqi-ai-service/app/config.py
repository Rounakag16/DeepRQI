import json
import os
from dotenv import load_dotenv

load_dotenv()

# ---- Model registry ----
# MODEL_PATH remains the single env var for the *default* model -- existing
# single-model setups (Milestones 1-11) are unaffected. Additional named
# models can be added via MODEL_REGISTRY_JSON, a JSON object mapping a short
# name to a checkpoint path, e.g. once more than one model is trained:
#   MODEL_REGISTRY_JSON={"yolo26s_v1": "runs/yolo26s_rdd2022/weights/best.pt", "yolo26m_v1": "runs/yolo26m_rdd2022/weights/best.pt"}
# Every registered model is loaded at startup so /predict?model=<name> can
# switch between them per-request, and POST /api/images/:id/compare (Node
# backend) can run the same photo through several at once.
import shutil

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(BASE_DIR, "models")

# Ensure yolo26n_best.pt exists if only the zip was downloaded/committed
if os.path.isdir(MODELS_DIR):
    zip_path = os.path.join(MODELS_DIR, "yolo26n_best.pt.zip")
    pt_path = os.path.join(MODELS_DIR, "yolo26n_best.pt")
    if os.path.exists(zip_path) and not os.path.exists(pt_path):
        try:
            shutil.copyfile(zip_path, pt_path)
        except Exception:
            pass

MODEL_PATH = os.getenv("MODEL_PATH", "models/yolo26s_best.pt")
DEFAULT_MODEL_NAME = os.getenv("DEFAULT_MODEL_NAME", "yolo26s_v1")

_registry_json = os.getenv("MODEL_REGISTRY_JSON", "")
try:
    MODEL_REGISTRY = json.loads(_registry_json) if _registry_json else {}
except json.JSONDecodeError:
    MODEL_REGISTRY = {}

# Auto-discover any models in models/ directory if not explicitly in registry
if os.path.isdir(MODELS_DIR):
    standard_models = [
        ("yolo26n_v1", "models/yolo26n_best.pt"),
        ("yolo26s_v1", "models/yolo26s_best.pt"),
        ("yolo26m_v1", "models/yolo26m_best.pt"),
        ("yolo26l_v1", "models/yolo26l_best.pt"),
    ]
    for key, rel_path in standard_models:
        abs_p = os.path.join(BASE_DIR, rel_path)
        if (os.path.exists(abs_p) or os.path.exists(rel_path)) and key not in MODEL_REGISTRY:
            MODEL_REGISTRY[key] = rel_path

MODEL_REGISTRY.setdefault(DEFAULT_MODEL_NAME, MODEL_PATH)

# Rich metadata for inspection and UI display
MODEL_METADATA = {
    "yolo26n_v1": {
        "display_name": "YOLO26-Nano",
        "tag": "Nano",
        "badge": "⚡ Ultra Fast",
        "speed": "Fastest (~12ms)",
        "accuracy": "Good",
        "file_size": "~5.4 MB",
        "description": "Ultra-lightweight model tailored for rapid mobile scans, low bandwidth, and high-FPS video.",
    },
    "yolo26s_v1": {
        "display_name": "YOLO26-Small",
        "tag": "Small",
        "badge": "⚖️ Balanced (Default)",
        "speed": "Fast (~18ms)",
        "accuracy": "High",
        "file_size": "~60.2 MB",
        "description": "Standard production baseline offering the optimal balance of speed and detection accuracy.",
    },
    "yolo26m_v1": {
        "display_name": "YOLO26-Medium",
        "tag": "Medium",
        "badge": "🎯 High Precision",
        "speed": "Moderate (~32ms)",
        "accuracy": "Very High",
        "file_size": "~131.2 MB",
        "description": "Enhanced network depth and feature representation for fine transverse and hairline cracks.",
    },
    "yolo26l_v1": {
        "display_name": "YOLO26-Large",
        "tag": "Large",
        "badge": "🔬 Maximum Capacity",
        "speed": "Thorough (~58ms)",
        "accuracy": "Maximum Precision",
        "file_size": "~157.9 MB",
        "description": "Deepest architecture for comprehensive road condition analysis on complex distressed asphalt.",
    },
}

def get_model_metadata(name: str, is_placeholder: bool = False):
    meta = MODEL_METADATA.get(name)
    if meta:
        return {**meta, "is_placeholder": is_placeholder}
    name_clean = name.replace("_v1", "").replace("_best", "").replace("-", " ").title()
    return {
        "display_name": name_clean,
        "tag": "Custom",
        "badge": "Custom Checkpoint" if not is_placeholder else "Untrained Placeholder",
        "speed": "Standard",
        "accuracy": "Standard" if not is_placeholder else "COCO Only",
        "file_size": "Unknown",
        "description": f"Custom model checkpoint ({name}).",
        "is_placeholder": is_placeholder,
    }


# ---- Class names, in the exact index order used during training ----
CLASS_NAMES = [
    "D00_longitudinal_crack",
    "D10_transverse_crack",
    "D20_alligator_crack",
    "D40_pothole",
]

# ---- RQI damage weights ----
# Mirrors the original spec's weight table. Note: "Patch Repair" has a defined
# weight but no corresponding trained class yet (RDD2022 doesn't include a
# patch-repair label) -- it's kept here so the formula/schema doesn't need to
# change if that class is added in Phase 3, but it will never fire today.
DAMAGE_WEIGHTS = {
    "D40_pothole": 10,
    "D00_longitudinal_crack": 6,
    "D10_transverse_crack": 5,
    "D20_alligator_crack": 12,
    "patch_repair": 3,  # reserved, not currently detected
}

# ---- Severity multipliers ----
SEVERITY_MULTIPLIERS = {
    "low": 1,
    "medium": 2,
    "high": 3,
    "critical": 5,
}

# ---- Severity thresholds, as % of image area the bbox covers ----
# Heuristic starting points (as flagged in the original spec, calibratable
# later against real inspection outcomes). A large box relative to the frame
# reads as more severe damage.
SEVERITY_AREA_THRESHOLDS = {
    "low": 0.02,       # < 2% of image area
    "medium": 0.05,    # 2-5%
    "high": 0.10,      # 5-10%
    # anything >= 0.10 -> "critical"
}

# ---- RQI category bands (for display) ----
RQI_BANDS = [
    (85, 100, "Good"),
    (60, 85, "Fair"),
    (40, 60, "Poor"),
    (25, 40, "Very Poor"),
    (0, 25, "Critical"),
]
