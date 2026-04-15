import os
import json

output_root = r"C:\Users\Burak\life-giver\public\models"
manifest_path = r"C:\Users\Burak\life-giver\public\models\manifest.json"

manifest = {}
# Sort folders to ensure level order (000, 001, 002...)
folders = sorted([d for d in os.listdir(output_root) if os.path.isdir(os.path.join(output_root, d))])

for folder in folders:
    folder_path = os.path.join(output_root, folder)
    # Get all .glb files in this folder
    files = [f for f in os.listdir(folder_path) if f.endswith(".glb")]
    if files:
        # Use relative paths from /models/
        manifest[folder] = sorted([f"{folder}/{f}" for f in files])

with open(manifest_path, 'w') as f:
    json.dump(manifest, f, indent=2)

print(f"Manifest synchronized. Found {len(manifest)} levels.")
