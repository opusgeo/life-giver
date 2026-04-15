import bpy
import os
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

export_path = os.path.join(level_dir, "FullScene.glb")
print(f"Exporting full scene to {export_path}")

try:
    bpy.ops.export_scene.gltf(
        filepath=export_path, export_format='GLB',
        export_apply=True
    )
    print("SUCCESS")
except Exception as e:
    print(f"FAILED: {e}")

bpy.ops.wm.quit_blender()
