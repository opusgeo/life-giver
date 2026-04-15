import bpy
import os
import json
import re
import sys

# Argument handling
# Usage: blender -b <blend> -P export_instanced_level.py -- [optional_scene_name] [optional_output_root] [optional_manifest_path]
argv = sys.argv
if "--" in argv:
    args = argv[argv.index("--") + 1:]
else:
    args = []

# If scene_name is not provided or is "AUTO", use the active scene name in the blend
scene_name    = args[0] if len(args) > 0 and args[0] != "AUTO" else bpy.context.scene.name
output_root   = args[1] if len(args) > 1 else r"C:\Users\Burak\life-giver\public\models"
manifest_path = args[2] if len(args) > 2 else r"C:\Users\Burak\life-giver\public\models\manifest.json"

# Force update scene graph to ensure current matrices
bpy.context.view_layer.update()

def clean_name(name):
    # Only allow alphanumeric and underscores
    return re.sub(r'[^a-zA-Z0-9_\-]', '_', name)[:60]

# Setup output dir and checksums
level_dir = os.path.join(output_root, scene_name)
if not os.path.exists(level_dir):
    os.makedirs(level_dir)

checksum_path = os.path.join(level_dir, "checksums.json")
if os.path.exists(checksum_path):
    with open(checksum_path, 'r') as f:
        mesh_checksums = json.load(f)
else:
    mesh_checksums = {}

def get_mesh_checksum(m_data):
    # Quick checksum: vert count + edge count + sum of vert coordinates
    v_count = len(m_data.vertices)
    e_count = len(m_data.edges)
    # Simple sum of positions (limited to 1000 verts for better precision)
    v_sum = sum((v.co.x + v.co.y + v.co.z) for v in m_data.vertices[:1000])
    return f"{v_count}_{e_count}_{v_sum:.4f}"

print(f"\n--- INCREMENTAL INSTANCED EXPORT: {scene_name} ---")

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
exported_count = 0
skipped_count = 0

# Process each unique mesh
for m_data, objs in mesh_to_objs.items():
    # Use MESH DATA name instead of OBJECT name to avoid collisions
    # e.g. "Cube" object and "Cube.001" object might have same mesh or different ones.
    # Mesh names in Blender are always unique (e.g. "Cube", "Cube.001").
    base_name = clean_name(m_data.name) 
    filename = f"{base_name}.glb"
    export_path = os.path.join(level_dir, filename)
    
    # Calculate current checksum
    current_checksum = get_mesh_checksum(m_data)
    needs_export = (filename not in mesh_checksums or 
                    mesh_checksums[filename] != current_checksum or
                    not os.path.exists(export_path))

    if needs_export:
        bpy.ops.object.select_all(action='DESELECT')
        ref_obj = objs[0]
        
        # Check view layer
        if ref_obj.name not in bpy.context.view_layer.objects:
            print(f"Skipping {ref_obj.name}: Not in current view layer")
            continue

        ref_obj.select_set(True)
        
        # Temporary neutral transform for export
        orig_matrix = ref_obj.matrix_world.copy()
        ref_obj.matrix_world = bpy.types.Object.matrix_world.default_value # identity
        
        try:
            bpy.ops.export_scene.gltf(
                filepath=export_path,
                export_format='GLB',
                use_selection=True,
                export_apply=False,
                export_attributes=True
            )
            mesh_checksums[filename] = current_checksum
            exported_count += 1
            print(f"Exported: {filename}")
        except Exception as e:
            print(f"Error {filename}: {e}")
            
        ref_obj.matrix_world = orig_matrix
    else:
        skipped_count += 1

    # Add manifest entries for all instances (ALWAYS DO THIS, positions might change)
    for obj in objs:
        loc, rot_quat, scl = obj.matrix_world.decompose()
        rot = rot_quat.to_euler()
        
        px, py, pz = loc
        rx, ry, rz = rot
        sx, sy, sz = scl
        
        # Blender (Z-up) to Three.js (Y-up)
        tx, ty, tz = px, pz, -py
        trx, try_, trz = rx, rz, -ry
        
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

# Save checksums
with open(checksum_path, 'w') as f:
    json.dump(mesh_checksums, f)

print(f"\nSUCCESS! {scene_name} updated.")
print(f"Exported: {exported_count} GLBs, Skipped (unchanged): {skipped_count} GLBs.")
print(f"Total manifest entries: {len(manifest_entries)}")
