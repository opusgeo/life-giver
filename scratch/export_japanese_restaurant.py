import bpy
import os
import json
import re

# Precise paths for this task
blend_path = r"J:\personal work\2023 sonu\Japanese Restaurant\Japanese Restaurant.blend"
scene_name = "027_JapaneseRestaurant"
output_root = r"C:\Users\Burak\life-giver\public\models"
manifest_path = r"C:\Users\Burak\life-giver\public\models\manifest.json"

def clean_name(name):
    # Keep it simple and safe for filenames
    cname = re.sub(r'[^a-zA-Z0-9_\-]', '_', name)
    return cname[:50]

level_dir = os.path.join(output_root, scene_name)
if not os.path.exists(level_dir):
    os.makedirs(level_dir)
else:
    # Clear existing to avoid mixups
    for f in os.listdir(level_dir):
        try: os.remove(os.path.join(level_dir, f))
        except: pass

print(f"\n--- EXPORTING JAPANESE RESTAURANT AS SEPARATE PIECES ---")
print(f"Source: {blend_path}")

try:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.open_mainfile(filepath=blend_path)
except Exception as e:
    print(f"ERROR OPENING BLENDER FILE: {e}")
    import sys
    sys.exit(1)

# Ensure everything is visible/enabled for export
for obj in bpy.data.objects:
    obj.hide_viewport = False
    obj.hide_render = False

# Export every mesh object as its own GLB
all_meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print(f"Found {len(all_meshes)} meshes.")

scene_files = []
used_names = {}

for obj in all_meshes:
    # Deselect all
    bpy.ops.object.select_all(action='DESELECT')
    
    # Select this object
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    
    # Generate unique filename
    raw_name = clean_name(obj.name)
    if raw_name in used_names:
        used_names[raw_name] += 1
        name = f"{raw_name}_{used_names[raw_name]}"
    else:
        used_names[raw_name] = 1
        name = raw_name
        
    filename = f"{name}.glb"
    export_path = os.path.join(level_dir, filename)
    
    try:
        # Export selected object
        bpy.ops.export_scene.gltf(
            filepath=export_path,
            export_format='GLB',
            use_selection=True,
            export_apply=True,
            export_image_format='AUTO',
            export_materials='EXPORT',
            export_colors=True
        )
        scene_files.append(f"{scene_name}/{filename}")
        print(f"Exported: {filename}")
    except Exception as e:
        print(f"Failed to export {obj.name}: {e}")

# Update Manifest
if os.path.exists(manifest_path):
    try:
        with open(manifest_path, 'r') as f:
            manifest = json.load(f)
    except:
        manifest = {}
else:
    manifest = {}

# Save to manifest
manifest[scene_name] = sorted(list(set(scene_files)))

# Sort manifest keys to keep it tidy
sorted_manifest = dict(sorted(manifest.items()))

with open(manifest_path, 'w') as f:
    json.dump(sorted_manifest, f, indent=2)

print(f"\nSUCCESS! Exported {len(scene_files)} GLB files to {level_dir}")
print(f"Manifest updated with {scene_name}")
