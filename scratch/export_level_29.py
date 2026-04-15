import bpy
import os
import json
import re

# Precise paths for this task
blend_path = r"E:\old works no uploaded gdrive\bunch\BunchTown\BT Finalizing osman feedback UNİTY.blend"
scene_name = "029_BunchTownV2"
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

print(f"\n--- EXPORTING LEVEL 29: {scene_name} ---")
print(f"Source: {blend_path}")

try:
    # Try to open the file. We don't use read_factory_settings(use_empty=True) 
    # if we want to preserve internal data, but usually it's better to start clean.
    # However, open_mainfile replaces the current state anyway.
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

# Incremental manifest update to avoid losing data if it crashes
def update_manifest(files):
    if os.path.exists(manifest_path):
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
    else:
        manifest = {}
    
    manifest[scene_name] = sorted(list(set(files)))
    sorted_manifest = dict(sorted(manifest.items()))
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(sorted_manifest, f, indent=2)

for obj in all_meshes:
    try:
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
        
        # Export selected object
        bpy.ops.export_scene.gltf(
            filepath=export_path,
            export_format='GLB',
            use_selection=True,
            export_apply=True,
            export_colors=True # Important for vertex colors
        )
        scene_files.append(f"{scene_name}/{filename}")
        print(f"Exported: {filename}")
        
        # Update manifest every 10 objects or so, or just at the end if it's fast
        # Let's do it at the end for performance, but we have the loop.
    except Exception as e:
        print(f"Skipping {obj.name}: {e}")

# Final explicit manifest update
update_manifest(scene_files)

print(f"\nSUCCESS! Exported {len(scene_files)} GLB files to {level_dir}")
print(f"Manifest updated with {scene_name}")
