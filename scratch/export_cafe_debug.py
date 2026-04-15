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

print(f"DEBUG: Processing {scene_name} from {blend_path}")

bpy.ops.wm.open_mainfile(filepath=blend_path)

all_meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print(f"DEBUG: Total Meshes: {len(all_meshes)}")

for i, obj in enumerate(all_meshes):
    print(f"DEBUG: Processing item {i}: {obj.name}")
    try:
        # Just a test: can we select it?
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        print(f"DEBUG: Selected {obj.name}")
    except Exception as e:
        print(f"DEBUG: Failed to select {obj.name}: {e}")

print("DEBUG: Loop finished (unexpectedly?)")
bpy.ops.wm.quit_blender()
