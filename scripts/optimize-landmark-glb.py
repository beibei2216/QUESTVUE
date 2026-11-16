import argparse
import os
import sys

import bpy
import bmesh


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--ratio", type=float, default=0.03)
    parser.add_argument("--texture-size", type=int, default=1024)
    parser.add_argument(
        "--bottom-cutoff",
        type=float,
        default=None,
        help="Remove faces entirely below this Blender Z height before optimizing.",
    )
    script_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(script_args)


def main():
    args = parse_args()
    output_path = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=args.input)

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("No mesh objects were imported")

    if args.bottom_cutoff is not None:
        for obj in meshes:
            mesh = obj.data
            editable = bmesh.new()
            editable.from_mesh(mesh)
            faces = [
                face
                for face in editable.faces
                if all(vertex.co.z <= args.bottom_cutoff for vertex in face.verts)
            ]
            bmesh.ops.delete(editable, geom=faces, context="FACES")
            loose = [vertex for vertex in editable.verts if not vertex.link_faces]
            bmesh.ops.delete(editable, geom=loose, context="VERTS")
            editable.to_mesh(mesh)
            editable.free()
            mesh.update()

    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        modifier = obj.modifiers.new(name="RuntimeDecimation", type="DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = args.ratio
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)

    for image in bpy.data.images:
        if image.type != "IMAGE" or image.size[0] == 0 or image.size[1] == 0:
            continue
        width, height = image.size
        if max(width, height) > args.texture_size:
            ratio = args.texture_size / max(width, height)
            image.scale(max(1, round(width * ratio)), max(1, round(height * ratio)))
            image.pack()
        print("Texture:", image.name, (width, height), "->", tuple(image.size))

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )

    triangles = sum(len(obj.data.loop_triangles) for obj in meshes)
    vertices = sum(len(obj.data.vertices) for obj in meshes)
    print("Optimized mesh:", vertices, "vertices", triangles, "triangles")
    print("Output:", output_path, os.path.getsize(output_path), "bytes")


if __name__ == "__main__":
    main()
