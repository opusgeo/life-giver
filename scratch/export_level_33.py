import bpy
import os
import json
import re

# Config
scene_name = "033_MillieScene"
blend_path = r"C:\Users\Burak\Github\bunchverse-assets\Source\Maps\Scenes\Threejs1\Millie Scene.blend"
output_root = r"C:\Users\Burak\life-giver\public\models"
manifest_path = r"C:\Users\Burak\life-giver\public\models\manifest.json"

def clean_name(name):
    return re.sub(r'[^a-zA-Z0-9_\-]', '_', name)[:50]

# Setup output dir
level_dir = os.path.join(output_root, scene_name)
if not os.path.exists(level_dir):
    os.makedirs(level_dir)

print(f"\n--- EXPORTING LEVEL 33: {scene_name} ---")
bpy.ops.wm.open_mainfile(filepath=blend_path)

# Build map of mesh data -> list of objects
mesh_to_objs = {}
all_meshes = [o for o in bpy.data.objects if o.type == 'MESH']

for obj in all_meshes:
    # Ensure they are visible
    obj.hide_viewport = False
    obj.hide_render = False
    
    m_data = obj.data
    if m_data not in mesh_to_objs:
        mesh_to_objs[m_data] = []
    mesh_to_objs[m_data].append(obj)

print(f"Found {len(all_meshes)} objects using {len(mesh_to_objs)} unique meshes.")

manifest_entries = []
exported_files = set()

# Process each unique mesh
for m_data, objs in mesh_to_objs.items():
    # Pick a base name for this mesh
    base_name = clean_name(objs[0].name.split('.')[0]) # Remove .001 etc
    filename = f"{base_name}.glb"
    export_path = os.path.join(level_dir, filename)
    
    # Export the mesh ONCE at local origin
    if filename not in exported_files:
        # Deselect all
        bpy.ops.object.select_all(action='DESELECT')
        
        # We'll use one of the objects to export the mesh
        # But we must temporarily clear its transform so it's exported at 0,0,0
        # actually, if we use export_apply=False, it exports the mesh data and the object transform.
        # If we pick the object and clear transform, it works.
        ref_obj = objs[0]
        # Make sure it's linked to the collection/view layer
        if ref_obj.name not in bpy.context.view_layer.objects:
            # If it's not and we really want it, we could try to find its collection
            print(f"Skipping {ref_obj.name}: Not in current view layer")
            continue

        ref_obj.select_set(True)
        
        orig_loc = ref_obj.location.copy()
        orig_rot = ref_obj.rotation_euler.copy()
        orig_scl = ref_obj.scale.copy()
        
        ref_obj.location = (0,0,0)
        ref_obj.rotation_euler = (0,0,0)
        ref_obj.scale = (1,1,1)
        
        # Export
        try:
            bpy.ops.export_scene.gltf(
                filepath=export_path,
                export_format='GLB',
                use_selection=True,
                export_apply=False, # Don't bake loc/rot/scale
                export_attributes=True # Replaces export_colors in newer Blender
            )
            exported_files.add(filename)
            print(f"Exported mesh: {filename} (used by {len(objs)} objects)")
        except Exception as e:
            print(f"Error exporting {filename}: {e}")
            
        # Restore
        ref_obj.location = orig_loc
        ref_obj.rotation_euler = orig_rot
        ref_obj.scale = orig_scl

    # Add manifest entries for all instances
    for obj in objs:
        # Use matrix_world to get global transforms (handles parenting)
        loc, rot_quat, scl = obj.matrix_world.decompose()
        # Convert quaternion to euler for manifest (easier to read)
        rot = rot_quat.to_euler()
        
        px, py, pz = loc
        rx, ry, rz = rot
        sx, sy, sz = scl
        
        # Blender (Z-up) to Three.js (Y-up) coordinate conversion
        # Blender (X, Y, Z) -> Three (X, Z, -Y)
        tx, ty, tz = px, pz, -py
        
        # For rotation: Blender (RX, RY, RZ) euler on Z-up 
        # is complex to map directly. However, for upright objects, 
        # RZ maps to RY. 
        # Let's use the same mapping as position for a rough estimate,
        # but rotation is sensitive. 
        trx, try_, trz = rx, rz, -ry
        
        # String format: file|px,py,pz|rx,ry.rz|sx,sy,sz
        entry = (f"{scene_name}/{filename}|"
                 f"{tx:.4f},{ty:.4f},{tz:.4f}|"
                 f"{trx:.4f},{try_:.4f},{trz:.4f}|"
                 f"{sx:.4f},{sz:.4f},{sy:.4f}")
        
        manifest_entries.append(entry)

# Update manifest.json
if os.path.exists(manifest_path):
    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)
else:
    manifest = {}

manifest[scene_name] = manifest_entries
sorted_manifest = dict(sorted(manifest.items()))

with open(manifest_path, 'w', encoding='utf-8') as f:
    json.dump(sorted_manifest, f, indent=2)

print(f"\nSUCCESS! Level 33 exported with {len(exported_files)} GLBs and {len(manifest_entries)} instances.")
