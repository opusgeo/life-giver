import bpy
import os
import json
import re
import sys

argv = sys.argv
if "--" in argv:
    scene_name = argv[argv.index("--") + 1]
    blend_path = argv[argv.index("--") + 2]
else:
    sys.exit(1)

output_root = r"C:\Users\Burak\life-giver\public\models"
level_dir = os.path.join(output_root, scene_name)
if not os.path.exists(level_dir): os.makedirs(level_dir)

bpy.ops.wm.open_mainfile(filepath=blend_path)

def clean_name(name):
    return re.sub(r'[^a-zA-Z0-9_\-]', '_', name)

scene_files = []

# If there are no collections with meshes, fall back to pieces
collections_with_meshes = [c for c in bpy.data.collections if any(obj.type == 'MESH' for obj in c.all_objects)]

if collections_with_meshes:
    print(f"Exporting {len(collections_with_meshes)} collections...")
    for col in collections_with_meshes:
        bpy.ops.object.select_all(action='DESELECT')
        has_mesh = False
        for obj in col.all_objects:
            if obj.type == 'MESH':
                obj.select_set(True)
                has_mesh = True
        
        if not has_mesh: continue
        
        cname = clean_name(col.name)
        filename = f"{cname}.glb"
        export_path = os.path.join(level_dir, filename)
        
        print(f"Exporting collection: {col.name} -> {filename}")
        try:
            bpy.ops.export_scene.gltf(
                filepath=export_path, export_format='GLB',
                use_selection=True, export_apply=True
            )
            scene_files.append(f"{scene_name}/{filename}")
        except Exception as e:
            print(f"  Failed: {e}")
else:
    # Fallback to single export if no collections
    print("No collections found, exporting full scene...")
    filename = "FullScene.glb"
    export_path = os.path.join(level_dir, filename)
    bpy.ops.export_scene.gltf(filepath=export_path, export_format='GLB', export_apply=True)
    scene_files.append(f"{scene_name}/{filename}")

# Update manifest
manifest_path = r"C:\Users\Burak\life-giver\public\models\manifest.json"
if os.path.exists(manifest_path):
    with open(manifest_path, 'r') as f: manifest = json.load(f)
    manifest[scene_name] = sorted(list(set(scene_files)))
    with open(manifest_path, 'w') as f: json.dump(manifest, f, indent=2)

print(f"COMPLETED. Total files: {len(scene_files)}")
