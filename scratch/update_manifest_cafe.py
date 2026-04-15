import json
import os

manifest_path = r"C:\Users\Burak\life-giver\public\models\manifest.json"
with open(manifest_path, 'r') as f:
    manifest = json.load(f)

manifest["027_CafeRemastered"] = [
    "027_CafeRemastered/CafeRemastered.glb"
]

with open(manifest_path, 'w') as f:
    json.dump(manifest, f, indent=2)
print("Manifest updated.")
