from .config import DAMAGE_WEIGHTS, SEVERITY_MULTIPLIERS, RQI_BANDS


def _category_for_score(score: float) -> str:
    for low, high, label in RQI_BANDS:
        if low <= score <= high:
            return label
    return "Unknown"


def compute_rqi(detections: list[dict]) -> dict:
    """
    detections: list of dicts, each with at least:
        - "damage_type": str (must match a key in DAMAGE_WEIGHTS)
        - "severity": str ("low" | "medium" | "high" | "critical")

    Occurrence count is handled implicitly -- each detection in the list
    contributes its own penalty term, so N detections of the same type/severity
    naturally sum to weight * multiplier * N.

    Returns the RQI score, category, total penalty, and a per-detection
    breakdown so the score is fully auditable (a core design goal from the
    original spec -- any RQI number should be traceable to exactly which
    detections produced it).
    """
    total_penalty = 0.0
    breakdown = []

    for det in detections:
        damage_type = det["damage_type"]
        severity = det["severity"]

        weight = DAMAGE_WEIGHTS.get(damage_type, 0)
        multiplier = SEVERITY_MULTIPLIERS.get(severity, 1)
        penalty = weight * multiplier

        total_penalty += penalty
        breakdown.append({
            "id": det.get("id"),
            "damage_type": damage_type,
            "severity": severity,
            "weight": weight,
            "multiplier": multiplier,
            "penalty": penalty,
        })

    score = max(0.0, 100.0 - total_penalty)
    category = _category_for_score(score)

    return {
        "score": round(score, 2),
        "category": category,
        "total_penalty": round(total_penalty, 2),
        "breakdown": breakdown,
    }
