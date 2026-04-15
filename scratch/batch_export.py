import bpy
import os
import json
import re

root_dir = r"C:\Users\Burak\Github\bunchverse-assets\Source\Maps\Scenes"
output_root = r"C:\Users\Burak\life-giver\public\models"
manifest_path = r"C:\Users\Burak\life-giver\public\models\manifest.json"

def clean_name(name):
    cname = re.sub(r'[^a-zA-Z0-9_\-]', '_', name)
    return cname[:40] 

if os.path.exists(manifest_path):
    try:
        with open(manifest_path, 'r') as f:
            manifest = json.load(f)
    except:
        manifest = {}
else:
    manifest = {}

scenes = sorted([d for d in os.listdir(root_dir) if os.path.isdir(os.path.join(root_dir, d))])

for i, scene_name in enumerate(scenes):
    if scene_name in manifest and len(manifest[scene_name]) > 0:
        print(f"[{i+1}/{len(scenes)}] Skipping {scene_name} (done)")
        continue
        
    scene_dir = os.path.join(root_dir, scene_name)
    blend_files = [f for f in os.listdir(scene_dir) if f.endswith(".blend")]
    if not blend_files: 
        print(f"[{i+1}/{len(scenes)}] No blend in {scene_name}")
        continue
    
    blend_path = os.path.join(scene_dir, blend_files[0])
    level_dir = os.path.join(output_root, scene_name)
    if not os.path.exists(level_dir): os.makedirs(level_dir)
    
    print(f"\n[{i+1}/{len(scenes)}] >>> PROCESSING: {scene_name}")
    print(f"Path: {blend_path}")
    
    try:
        # Clear everything first
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.wm.open_mainfile(filepath=blend_path)
    except Exception as e:
        print(f"FAILED TO OPEN: {e}")
        continue
        
    scene_files = []
    
    # Selection logic
    export_targets = []
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            if obj.parent is None:
                export_targets.append(obj)
            elif obj.parent.parent is None and obj.parent.type == 'EMPTY':
                export_targets.append(obj)
                
    if len(export_targets) > 200:
        print(f"  Warning: {len(export_targets)} objects. Reverting to top-level.")
        export_targets = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent is None]

    for obj in export_targets:
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        for child in obj.children_recursive:
            child.select_set(True)
        bpy.context.view_layer.objects.active = obj
        
        name = clean_name(obj.name)
        filename = f"{name}.glb"
        export_path = os.path.join(level_dir, filename)
        
        try:
            bpy.ops.export_scene.gltf(
                filepath=export_path, export_format='GLB',
                use_selection=True, export_apply=True
            )
            scene_files.append(f"{scene_name}/{filename}")
        except:
            pass
            
    manifest[scene_name] = sorted(list(set(scene_files)))
    # Save after each successful scene
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)

print("\nFINISHED ALL SCENES.")
