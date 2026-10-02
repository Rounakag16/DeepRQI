import json
import os
import requests

API_URL = "http://localhost:5000/api/admin/export/review"
# Assumes token is provided via environment or just a dummy token if auth is disabled for local testing
TOKEN = os.environ.get("DEEPRQI_ADMIN_TOKEN", "")

# Same as config.py
CLASS_NAMES = ["pothole", "alligator_cracking", "longitudinal_crack", "rutting"]
CLASS_MAP = {name: i for i, name in enumerate(CLASS_NAMES)}

def main():
    headers = {"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}
    resp = requests.get(API_URL, headers=headers)
    resp.raise_for_status()
    images = resp.json()

    out_dir = "export_labels"
    os.makedirs(out_dir, exist_ok=True)
    
    false_positives = []
    
    for img in images:
        if not img.get("imageWidth") or not img.get("imageHeight"):
            print(f"Skipping {img['id']} due to missing width/height")
            continue
            
        w, h = img["imageWidth"], img["imageHeight"]
        yolo_lines = []
        
        for det in img.get("detections", []):
            if det["status"] == "VERIFIED":
                cls_idx = CLASS_MAP.get(det["damageType"])
                if cls_idx is None:
                    continue
                # bbox is [xmin, ymin, xmax, ymax]
                xmin, ymin, xmax, ymax = det["bbox"]
                
                # YOLO format: cls_id x_center y_center width height (normalized)
                x_center = ((xmin + xmax) / 2) / w
                y_center = ((ymin + ymax) / 2) / h
                box_w = (xmax - xmin) / w
                box_h = (ymax - ymin) / h
                
                yolo_lines.append(f"{cls_idx} {x_center:.6f} {y_center:.6f} {box_w:.6f} {box_h:.6f}")
                
            elif det["status"] == "FALSE_POSITIVE":
                false_positives.append({
                    "imageId": img["id"],
                    "imagePath": img["imagePath"],
                    "detectionId": det["id"],
                    "bbox": det["bbox"],
                    "damageType": det["damageType"]
                })
        
        if yolo_lines:
            txt_path = os.path.join(out_dir, f"{img['id']}.txt")
            with open(txt_path, "w") as f:
                f.write("\n".join(yolo_lines) + "\n")
                
    if false_positives:
        with open(os.path.join(out_dir, "false_positives.json"), "w") as f:
            json.dump(false_positives, f, indent=2)

    print(f"Exported labels to {out_dir}/")

if __name__ == "__main__":
    main()
