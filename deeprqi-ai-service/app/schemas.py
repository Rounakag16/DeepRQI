from pydantic import BaseModel
from typing import List


class Detection(BaseModel):
    damage_type: str
    confidence: float
    bbox: List[float]  # [xmin, ymin, xmax, ymax] in pixel coords
    severity: str


class RQIResult(BaseModel):
    score: float
    category: str
    total_penalty: float
    breakdown: List[dict]  # per-detection penalty contribution, for auditability


class PredictResponse(BaseModel):
    detections: List[Detection]
    rqi: RQIResult
    heatmap_base64: str  # PNG, base64-encoded
    image_width: int
    image_height: int

class RQIComputeRequest(BaseModel):
    detections: List[dict]

