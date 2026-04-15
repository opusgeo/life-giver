import bpy
import os

with open(r"C:\Users\Burak\life-giver\scratch\hierarchy_log.txt", "w") as f:
    f.write(f"Scene: {os.path.basename(bpy.data.filepath)}\n")
    for o in bpy.data.objects:
        pname = o.parent.name if o.parent else "None"
        f.write(f"OBJ: {o.name} | TYPE: {o.type} | PARENT: {pname}\n")
print("HIERARCHY LOG SAVED.")
