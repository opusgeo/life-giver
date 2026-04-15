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

if os.path.exists(level_dir):
    import shutil
    shutil.rmtree(level_dir)
os.makedirs(level_dir)

bpy.ops.wm.open_mainfile(filepath=blend_path)

# 1. Pack all textures to ensure they are available for export
try:
    bpy.ops.file.pack_all()
    print("DEBUG: All textures packed.")
except:
    print("DEBUG: Failed to pack textures.")

# 2. Fix Normals & Visibility
for obj in bpy.data.objects:
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.hide_select = False
    
    if obj.type == 'MESH':
        # Apply transforms first to ensure normals are calculated in world-ish space
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        
        # Enter edit mode to recalculate normals
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode='OBJECT')
        print(f"DEBUG: Fixed normals for {obj.name}")

all_meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print(f"DEBUG: Found {len(all_meshes)} meshes to export.")

scene_files = []
used_names = {}

for obj in all_meshes:
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    
    raw_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', obj.name)
    if raw_name in used_names:
        used_names[raw_name] += 1
        name = f"{raw_name}_{used_names[raw_name]}"
    else:
        used_names[raw_name] = 1
        name = raw_name
        
    filename = f"{name}.glb"
    export_path = os.path.join(level_dir, filename)
    
    try:
        # GLTF Exporter settings
        bpy.ops.export_scene.gltf(
            filepath=export_path,
            export_format='GLB',
            use_selection=True,
            export_apply=True,
            export_colors=True,
            export_materials='EXPORT',
            export_image_format='AUTO',
            export_extras=True
        )
        scene_files.append(f"{scene_name}/{filename}")
    except Exception as e:
        print(f"ERROR exporting {obj.name}: {e}")

# Update manifest
manifest_path = r"C:\Users\Burak\life-giver\public\models\manifest.json"
if os.path.exists(manifest_path):
    with open(manifest_path, 'r') as f:
        manifest = json.load(f)
    manifest[scene_name] = sorted(list(set(scene_files)))
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)

print(f"COMPLETED. Total pieces: {len(scene_files)}")
