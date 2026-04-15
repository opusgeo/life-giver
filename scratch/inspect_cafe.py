import bpy
import os
import sys

argv = sys.argv
if "--" in argv:
    blend_path = argv[argv.index("--") + 1]
else:
    sys.exit(1)

bpy.ops.wm.open_mainfile(filepath=blend_path)

print(f"\n--- SCENES ---")
for s in bpy.data.scenes:
    print(f"Scene: {s.name}")

active_scene = bpy.context.scene
print(f"Active Scene: {active_scene.name}")
print(f"Total Objects in active scene: {len(active_scene.objects)}")

bpy.ops.wm.quit_blender()
