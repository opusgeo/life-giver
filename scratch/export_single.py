import bpy
import os
import json
import re
import sys

argv = sys.argv
if "--" in argv:
    scene_name = argv[argv.index("--") + 1]
else:
    sys.exit(1)

root_dir = r"C:\Users\Burak\Github\bunchverse-assets\Source\Maps\Scenes"
output_root = r"C:\Users\Burak\life-giver\public\models"
manifest_path = r"C:\Users\Burak\life-giver\public\models\manifest.json"

def clean_name(name):
    cname = re.sub(r'[^a-zA-Z0-9_\-]', '_', name)
    return cname[:50] 

scene_dir = os.path.join(root_dir, scene_name)
blend_files = [f for f in os.listdir(scene_dir) if f.endswith(".blend")]
if not blend_files: sys.exit(0)

blend_path = os.path.join(scene_dir, blend_files[0])
level_dir = os.path.join(output_root, scene_name)
if not os.path.exists(level_dir): os.makedirs(level_dir)
else:
    for f in os.listdir(level_dir):
        try: os.remove(os.path.join(level_dir, f))
        except: pass

print(f"\n--- ULTIMATE PIECE-BY-PIECE EXPORT: {scene_name} ---")

try:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.open_mainfile(filepath=blend_path)
except Exception as e:
    print(f"ERROR: {e}")
    sys.exit(0)

# Goal: Export every distinct mesh piece as its own file.
# To avoid excessive file counts (like 1000 bricks), we limit to ~200 pieces.
all_meshes = [o for o in bpy.data.objects if o.type == 'MESH']

# Heuristic: If it has more than 150 meshes, we'll only export top-level meshes
# or use a more conservative grouping.
if len(all_meshes) > 150:
    print(f"  Large scene ({len(all_meshes)} meshes). Using grouping logic.")
    # Group by name prefix (e.g. Wall.001, Wall.002 -> Wall)
    # But usually just joining by parent + material is safer.
    groups = {}
    for obj in all_meshes:
        key = (obj.parent.name if obj.parent else "root", obj.active_material.name if obj.active_material else "none")
        if key not in groups: groups[key] = []
        groups[key].append(obj)
    
    for key, objs in groups.items():
        if len(objs) < 2: continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs: o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        try: bpy.ops.object.join()
        except: pass

# Final Export Targets: All remaining meshes
export_targets = [o for o in bpy.data.objects if o.type == 'MESH']

scene_files = []
used_names = {}

for obj in export_targets:
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    # Important: Do NOT select children recursive to avoid duplication.
    # Each mesh is its own GLB.
    bpy.context.view_layer.objects.active = obj
    
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
        bpy.ops.export_scene.gltf(
            filepath=export_path, export_format='GLB',
            use_selection=True, export_apply=True
        )
        scene_files.append(f"{scene_name}/{filename}")
    except: pass

# Post-processing to update manifest sync would happen via batch_run.ps1
# but we'll update it here too for single runs
if os.path.exists(manifest_path):
    try:
        with open(manifest_path, 'r') as f: manifest = json.load(f)
    except: manifest = {}
else: manifest = {}

manifest[scene_name] = sorted(list(set(scene_files)))
with open(manifest_path, 'w') as f:
    json.dump(manifest, f, indent=2)

print(f"DONE. Exported {len(scene_files)} items.")
