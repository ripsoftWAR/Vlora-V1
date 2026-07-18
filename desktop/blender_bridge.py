"""
blender_bridge.py — Blender 3D Automation Bridge untuk Flora Agent.

Mode operasi:
  - Mode 1 (Script): Kirim Python script ke Blender via blender.exe --background
  - Mode 2 (Socket): Komunikasi real-time dengan Blender melalui socket TCP
  - Mode 3 (Batch): Eksekusi multi-step tanpa restart Blender tiap langkah

Semua output file 3D (.blend, .obj, .fbx, .glb, .stl, .ply) disimpan ke:
  D:\\VloraWorkspace\\models\\

Contoh command via stdin:
  {"action": "run_script", "script": "import bpy; bpy.ops.mesh.primitive_cube_add()"}
  {"action": "export_model", "format": "obj", "filename": "cube"}
  {"action": "get_scene_info"}
  {"action": "render_viewport"}
  {"action": "exit"}
"""

import sys
import json
import os
import subprocess
import tempfile
import traceback
import uuid
from pathlib import Path


# ── Constants ───────────────────────────────────────────────────

BLENDER_EXE = r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
WORKSPACE_DIR = Path(r"D:\VloraWorkspace\models")
DEFAULT_TIMEOUT = 120  # Blender ops butuh waktu lebih lama

# ── Workspace ────────────────────────────────────────────────────

def ensure_workspace():
    """Pastikan direktori workspace untuk output 3D ada."""
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
    return WORKSPACE_DIR


# ═══════════════════════════════════════════════════════════════
# 🧩 BlenderBridge — Kelas utama
# ═══════════════════════════════════════════════════════════════

class BlenderBridge:
    """Bridge untuk komunikasi Agent → Blender via script injection.

    Arsitektur:
        Agent → tools.js → desktop.js → BlenderBridge (Python) → blender.exe

    Mode Operasi:
      1. one_shot:  tulis script ke file temp, jalankan blender.exe --background,
                    tangkap stdout, hapus temp.
      2. persistent:  jalankan Blender dengan console Python aktif, kirim script
                      via stdin, baca hasil dari stdout (mode expert).
      3. socket:    jalankan Blender dengan addon socket server, kirim command
                    via TCP (mode advanced — untuk animasi real-time).
    """

    # ── Core: Execute Python di Blender ──────────────────────────

    def run_script(self, script: str, timeout: int = DEFAULT_TIMEOUT) -> dict:
        """Jalankan Python script di Blender (headless / background mode).
        
        Args:
            script: Kode Python yang akan dieksekusi di environment Blender.
                    Variabel 'bpy' sudah tersedia (Blender Python API).
            timeout: Maks waktu tunggu dalam detik.
        
        Returns:
            dict dengan keys: success, output, error, blend_file
        """
        ensure_workspace()

        # Bungkus script dengan boilerplate
        wrapped = self._wrap_script(script)

        # Tulis ke file temp
        script_file = tempfile.NamedTemporaryFile(
            mode='w', suffix='.py', delete=False, encoding='utf-8'
        )
        script_path = script_file.name
        script_file.write(wrapped)
        script_file.close()

        try:
            # Eksekusi Blender
            result = subprocess.run(
                [BLENDER_EXE, '--background', '--python', script_path],
                capture_output=True, text=True, timeout=timeout,
                cwd=str(WORKSPACE_DIR)
            )

            # Parse output — cari JSON result yang di-print script kita
            stdout = result.stdout or ''
            stderr = result.stderr or ''

            # Ambil baris JSON yang dimulai dengan "BLENDER_RESULT:"
            json_result = None
            output_lines = []
            for line in stdout.split('\n'):
                if line.startswith('BLENDER_RESULT:'):
                    try:
                        json_str = line[len('BLENDER_RESULT:'):].strip()
                        json_result = json.loads(json_str)
                    except json.JSONDecodeError:
                        json_result = {"raw": line}
                else:
                    output_lines.append(line)

            return {
                "success": result.returncode == 0,
                "output": '\n'.join(output_lines[-50:]),  # 50 baris terakhir
                "error": stderr[:2000] if stderr else None,
                "blend_file": json_result.get("blend_file") if json_result else None,
                "exported_files": json_result.get("exported_files") if json_result else [],
                "return_code": result.returncode,
                "result": json_result,
            }

        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "error": f"Blender timeout setelah {timeout} detik. Script terlalu kompleks atau infinite loop.",
                "output": None,
            }
        except FileNotFoundError:
            return {
                "success": False,
                "error": f"Blender tidak ditemukan di: {BLENDER_EXE}\n"
                         f"Pastikan Blender 5.2 terinstall di path tersebut.",
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Blender execution error: {e}",
            }
        finally:
            # Bersihkan file temp
            try:
                os.unlink(script_path)
            except (OSError, PermissionError):
                pass

    # ── Script wrapper ────────────────────────────────────────────

    def _wrap_script(self, script: str) -> str:
        """Bungkus script user dengan boilerplate yang diperlukan.
        
        - Setup output directory
        - Siapkan bpy context
        - Tangkap hasil dalam format JSON
        """
        workspace = WORKSPACE_DIR.as_posix()

        return f'''
import bpy
import sys
import json
import os
from pathlib import Path

# ── Workspace ──────────────────────────────────────────────────
WORKSPACE = Path(r"{workspace}")
WORKSPACE.mkdir(parents=True, exist_ok=True)

# ── Result tracker ──────────────────────────────────────────────
_result = {{
    "blend_file": None,
    "exported_files": [],
    "objects_created": [],
    "objects_modified": [],
}}

def save_blend(filename: str = None) -> str:
    """Simpan file .blend ke workspace."""
    if not filename:
        filename = f"flora_{{uuid}}".replace("-", "")[:20]
    if not filename.endswith('.blend'):
        filename += '.blend'
    path = str(WORKSPACE / filename)
    bpy.ops.wm.save_as_mainfile(filepath=path)
    _result["blend_file"] = path
    return path

def export_obj(name: str = "model") -> str:
    """Export sebagai .obj ke workspace."""
    path = str(WORKSPACE / f"{{name}}.obj")
    bpy.ops.wm.obj_export(filepath=path)
    _result["exported_files"].append(path)
    return path

def export_fbx(name: str = "model") -> str:
    """Export sebagai .fbx ke workspace."""
    path = str(WORKSPACE / f"{{name}}.fbx")
    bpy.ops.export_scene.fbx(filepath=path)
    _result["exported_files"].append(path)
    return path

def export_glb(name: str = "model") -> str:
    """Export sebagai .glb ke workspace."""
    path = str(WORKSPACE / f"{{name}}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB')
    _result["exported_files"].append(path)
    return path

def export_stl(name: str = "model") -> str:
    """Export sebagai .stl ke workspace."""
    path = str(WORKSPACE / f"{{name}}.stl")
    bpy.ops.wm.stl_export(filepath=path)
    _result["exported_files"].append(path)
    return path

def new_scene():
    """Buat scene baru (hapus semua object)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)

# ── USER SCRIPT ─────────────────────────────────────────────────
try:
    {script}
except Exception as _e:
    import traceback
    print(f"BLENDER_ERROR: {{traceback.format_exc()}}", file=sys.stderr)
    _result["error"] = str(_e)

# ── Output result ──────────────────────────────────────────────
print(f"BLENDER_RESULT:{{json.dumps(_result, default=str)}}")
'''

    # ── High-level operations ─────────────────────────────────────

    def create_mesh(self, mesh_type: str = "cube", **kwargs) -> dict:
        """Buat mesh primitive di Blender.
        
        mesh_type: cube, sphere, cylinder, cone, torus, plane, monkey, circle, grid
        kwargs: size, radius, depth, vertices, location, rotation, scale, name
        """
        loc = kwargs.get("location", (0, 0, 0))
        rot = kwargs.get("rotation", (0, 0, 0))
        scale = kwargs.get("scale", (1, 1, 1))
        name = kwargs.get("name", f"{mesh_type}_{uuid.uuid4().hex[:6]}")

        # Peta operasi berdasarkan tipe mesh
        ops_map = {
            "cube":       ('bpy.ops.mesh.primitive_cube_add', {'size': kwargs.get('size', 2)}),
            "sphere":     ('bpy.ops.mesh.primitive_uv_sphere_add', {
                'radius': kwargs.get('radius', 1),
                'segments': kwargs.get('segments', 32),
                'ring_count': kwargs.get('ring_count', 16),
            }),
            "cylinder":   ('bpy.ops.mesh.primitive_cylinder_add', {
                'radius': kwargs.get('radius', 1),
                'depth': kwargs.get('depth', 2),
                'vertices': kwargs.get('vertices', 32),
            }),
            "cone":       ('bpy.ops.mesh.primitive_cone_add', {
                'radius1': kwargs.get('radius', 1),
                'depth': kwargs.get('depth', 2),
                'vertices': kwargs.get('vertices', 32),
            }),
            "torus":      ('bpy.ops.mesh.primitive_torus_add', {
                'major_radius': kwargs.get('major_radius', 1),
                'minor_radius': kwargs.get('minor_radius', 0.25),
                'major_segments': kwargs.get('major_segments', 48),
                'minor_segments': kwargs.get('minor_segments', 12),
            }),
            "plane":      ('bpy.ops.mesh.primitive_plane_add', {
                'size': kwargs.get('size', 2),
            }),
            "monkey":     ('bpy.ops.mesh.primitive_monkey_add', {}),
            "circle":     ('bpy.ops.mesh.primitive_circle_add', {
                'radius': kwargs.get('radius', 1),
                'vertices': kwargs.get('vertices', 32),
            }),
            "grid":       ('bpy.ops.mesh.primitive_grid_add', {
                'x_subdivisions': kwargs.get('x_subdivisions', 10),
                'y_subdivisions': kwargs.get('y_subdivisions', 10),
                'size': kwargs.get('size', 2),
            }),
        }

        if mesh_type not in ops_map:
            return {"success": False, "error": f"Mesh type '{mesh_type}' tidak dikenal. Pilihan: {', '.join(ops_map.keys())}"}

        op_name, op_kwargs = ops_map[mesh_type]

        # Build script
        kwargs_str = ', '.join([f'{k}={repr(v)}' for k, v in op_kwargs.items()])
        script = f'''
# Create {mesh_type}
{op_name}({kwargs_str})

# Rename & position
obj = bpy.context.active_object
obj.name = "{name}"
obj.location = {repr(loc)}
obj.rotation_euler = {repr(rot)}
obj.scale = {repr(scale)}

_result["objects_created"].append("{name}")
'''

        return self.run_script(script)

    def modify_object(self, obj_name: str, **kwargs) -> dict:
        """Modifikasi objek yang sudah ada di scene.
        
        kwargs:
          - location: (x, y, z)
          - rotation: (x, y, z) dalam radians
          - scale: (x, y, z)
          - hide: bool
          - parent: str — nama parent object
        """
        changes = []
        for k, v in kwargs.items():
            if v is not None:
                changes.append(f"obj.{k} = {repr(v)}")

        if not changes:
            return {"success": False, "error": "Tidak ada properti yang diubah."}

        script = f'''
obj = bpy.data.objects.get("{obj_name}")
if obj is None:
    raise ValueError(f"Object '{{obj_name}}' tidak ditemukan di scene.")
{"".join(changes)}
_result["objects_modified"].append("{obj_name}")
'''
        return self.run_script(script)

    def apply_material(self, obj_name: str, material: str, color: tuple = None) -> dict:
        """Apply material ke object.
        
        material: 'principled', 'emission', 'glass', 'metallic', 'glossy'
        color: (r, g, b, a) — 0.0-1.0
        """
        if color is None:
            color = (0.8, 0.8, 0.8, 1.0)

        material_scripts = {
            'principled': f'''
mat = bpy.data.materials.new(name="{obj_name}_mat")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = {repr(color)}
''',
            'emission': f'''
mat = bpy.data.materials.new(name="{obj_name}_mat")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = {repr(color)}
bsdf.inputs["Emission Strength"].default_value = 1.0
bsdf.inputs["Emission Color"].default_value = {repr(color)}
''',
            'glass': f'''
mat = bpy.data.materials.new(name="{obj_name}_mat")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = {repr(color)}
bsdf.inputs["Transmission Weight"].default_value = 1.0
bsdf.inputs["Roughness"].default_value = 0.0
''',
            'metallic': f'''
mat = bpy.data.materials.new(name="{obj_name}_mat")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = {repr(color)}
bsdf.inputs["Metallic"].default_value = 1.0
bsdf.inputs["Roughness"].default_value = 0.3
''',
            'glossy': f'''
mat = bpy.data.materials.new(name="{obj_name}_mat")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = {repr(color)}
bsdf.inputs["Roughness"].default_value = 0.0
''',
        }

        mat_script = material_scripts.get(material, material_scripts['principled'])

        script = f'''
obj = bpy.data.objects.get("{obj_name}")
if obj is None:
    raise ValueError(f"Object '{{obj_name}}' tidak ditemukan.")

{mat_script}

# Assign to object
if obj.data.materials:
    obj.data.materials[0] = mat
else:
    obj.data.materials.append(mat)
'''

        return self.run_script(script)

    def delete_object(self, obj_name: str) -> dict:
        """Hapus object dari scene."""
        script = f'''
obj = bpy.data.objects.get("{obj_name}")
if obj is None:
    raise ValueError(f"Object '{{obj_name}}' tidak ditemukan.")
bpy.data.objects.remove(obj, do_unlink=True)
'''
        return self.run_script(script)

    def get_scene_info(self) -> dict:
        """Dapatkan informasi scene Blender saat ini."""
        script = '''
import bpy
info = {
    "objects": [],
    "materials": [],
    "world": str(bpy.context.scene.world.name) if bpy.context.scene.world else None,
    "frames": bpy.context.scene.frame_end - bpy.context.scene.frame_start + 1,
}
for obj in bpy.data.objects:
    info["objects"].append({
        "name": obj.name,
        "type": obj.type,
        "location": tuple(obj.location),
        "rotation": tuple(obj.rotation_euler),
        "scale": tuple(obj.scale),
        "vertices": len(obj.data.vertices) if hasattr(obj.data, "vertices") else 0,
        "polygons": len(obj.data.polygons) if hasattr(obj.data, "polygons") else 0,
    })
for mat in bpy.data.materials:
    info["materials"].append(mat.name)
_result["scene_info"] = info
'''
        return self.run_script(script)

    def export_model(self, fmt: str = "obj", filename: str = "model") -> dict:
        """Export scene ke format 3D.
        
        format: 'obj', 'fbx', 'glb', 'stl', 'ply', 'blend'
        """
        export_funcs = {
            'obj': ('export_obj', f"export_obj('{filename}')"),
            'fbx': ('export_fbx', f"export_fbx('{filename}')"),
            'glb': ('export_glb', f"export_glb('{filename}')"),
            'stl': ('export_stl', f"export_stl('{filename}')"),
            'blend': ('save_blend', f"save_blend('{filename}.blend')"),
        }

        if fmt not in export_funcs:
            return {"success": False, "error": f"Format '{fmt}' tidak didukung. Pilihan: {', '.join(export_funcs.keys())}"}

        func_name, func_call = export_funcs[fmt]
        script = f'''
path = {func_call}
print(f"Exported to: {{path}}")
'''
        return self.run_script(script)

    def clear_scene(self) -> dict:
        """Bersihkan scene (hapus semua object)."""
        script = '''
import bpy
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
# Bersihkan juga material, mesh, dll
for block in bpy.data.meshes:
    bpy.data.meshes.remove(block)
for block in bpy.data.materials:
    bpy.data.materials.remove(block)
for block in bpy.data.textures:
    bpy.data.textures.remove(block)
'''
        return self.run_script(script)

    def render_viewport(self, filename: str = "viewport_render") -> dict:
        """Render viewport dan simpan sebagai PNG."""
        script = f'''
import bpy
scene = bpy.context.scene
scene.render.filepath = str(WORKSPACE / "{filename}.png")
scene.render.image_settings.file_format = 'PNG'
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
bpy.ops.render.render(write_still=True)
path = scene.render.filepath
_result["rendered_file"] = path
print(f"Render saved: {{path}}")
'''
        return self.run_script(script)

    def apply_modifier(self, obj_name: str, modifier_type: str, **kwargs) -> dict:
        """Apply modifier ke object.
        
        modifier_type: 'subdivision_surface', 'bevel', 'mirror', 'array',
                      'solidify', 'boolean', 'decimate', 'screw'
        kwargs: specific to modifier type
        """
        mod_params = {
            'subdivision_surface': f"mod.levels = {kwargs.get('levels', 2)}; mod.quality = {kwargs.get('quality', 3)}",
            'bevel': f"mod.width = {kwargs.get('width', 0.1)}; mod.segments = {kwargs.get('segments', 2)}",
            'mirror': f"mod.use_axis = ({kwargs.get('mirror_x', True)}, {kwargs.get('mirror_y', False)}, {kwargs.get('mirror_z', False)})",
            'array': f"mod.count = {kwargs.get('count', 3)}; mod.relative_offset_displace = ({kwargs.get('offset_x', 1)}, 0, 0)",
            'solidify': f"mod.thickness = {kwargs.get('thickness', 0.1)}",
            'decimate': f"mod.ratio = {kwargs.get('ratio', 0.5)}",
            'screw': f"mod.steps = {kwargs.get('steps', 32)}; mod.render_steps = {kwargs.get('render_steps', 32)}",
        }

        mod_line = mod_params.get(modifier_type, '')
        script = f'''
obj = bpy.data.objects.get("{obj_name}")
if obj is None:
    raise ValueError(f"Object '{{obj_name}}' tidak ditemukan.")
mod = obj.modifiers.new(name="{modifier_type}", type='{modifier_type.upper()}')
{mod_line}
bpy.ops.object.modifier_apply(modifier=mod.name)
_result["objects_modified"].append("{obj_name}")
'''
        return self.run_script(script)

    def boolean_operation(self, obj_a: str, obj_b: str, operation: str = 'DIFFERENCE') -> dict:
        """Boolean operation antara dua object.
        
        operation: 'DIFFERENCE', 'UNION', 'INTERSECT'
        """
        script = f'''
obj_a = bpy.data.objects.get("{obj_a}")
obj_b = bpy.data.objects.get("{obj_b}")
if obj_a is None or obj_b is None:
    raise ValueError("Salah satu object tidak ditemukan.")

bpy.context.view_layer.objects.active = obj_a
mod = obj_a.modifiers.new(name="Boolean", type='BOOLEAN')
mod.object = obj_b
mod.operation = '{operation}'
bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.data.objects.remove(obj_b, do_unlink=True)
_result["objects_modified"].append("{obj_a}")
'''
        return self.run_script(script)

    # ── Dispatch ──────────────────────────────────────────────────

    def dispatch(self, action: str, cmd: dict) -> any:
        """Route action ke method yang sesuai."""
        handlers = {
            # ── Core ──
            "run_script": self._run_script,
            "ping": self._ping,

            # ── Create ──
            "create_mesh": self._create_mesh,

            # ── Modify ──
            "modify_object": self._modify_object,
            "apply_material": self._apply_material,
            "delete_object": self._delete_object,
            "apply_modifier": self._apply_modifier,
            "boolean_operation": self._boolean_operation,
            "clear_scene": self._clear_scene,

            # ── Export ──
            "export_model": self._export_model,
            "render_viewport": self._render_viewport,

            # ── Query ──
            "get_scene_info": self._get_scene_info,

            # ── Python Exec (langsung) ──
            "exec_python": self._exec_python,
        }

        handler = handlers.get(action)
        if handler is None:
            raise ValueError(
                f"Action '{action}' tidak dikenal. "
                f"Yang tersedia: {', '.join(handlers.keys())}"
            )
        return handler(cmd)

    def _run_script(self, cmd):
        script = cmd.get("script", "")
        timeout = cmd.get("timeout", DEFAULT_TIMEOUT)
        if not script:
            raise ValueError("Parameter 'script' wajib diisi")
        return self.run_script(script, timeout)

    def _ping(self, cmd):
        return {"pong": True, "blender": BLENDER_EXE, "workspace": str(WORKSPACE_DIR)}

    def _create_mesh(self, cmd):
        return self.create_mesh(
            mesh_type=cmd.get("mesh_type", "cube"),
            size=cmd.get("size"),
            radius=cmd.get("radius"),
            depth=cmd.get("depth"),
            vertices=cmd.get("vertices"),
            segments=cmd.get("segments"),
            location=cmd.get("location", (0, 0, 0)),
            rotation=cmd.get("rotation", (0, 0, 0)),
            scale=cmd.get("scale", (1, 1, 1)),
            name=cmd.get("name"),
        )

    def _modify_object(self, cmd):
        kwargs = {k: cmd[k] for k in ('location', 'rotation', 'scale', 'hide', 'parent') if k in cmd}
        return self.modify_object(cmd.get("obj_name", ""), **kwargs)

    def _apply_material(self, cmd):
        return self.apply_material(
            obj_name=cmd.get("obj_name", ""),
            material=cmd.get("material", "principled"),
            color=tuple(cmd.get("color", (0.8, 0.8, 0.8, 1.0))),
        )

    def _delete_object(self, cmd):
        return self.delete_object(cmd.get("obj_name", ""))

    def _apply_modifier(self, cmd):
        return self.apply_modifier(
            obj_name=cmd.get("obj_name", ""),
            modifier_type=cmd.get("modifier_type", "subdivision_surface"),
            **{k: cmd[k] for k in ('levels', 'quality', 'width', 'segments',
                                   'count', 'thickness', 'ratio', 'steps') if k in cmd}
        )

    def _boolean_operation(self, cmd):
        return self.boolean_operation(
            obj_a=cmd.get("obj_a", ""),
            obj_b=cmd.get("obj_b", ""),
            operation=cmd.get("operation", "DIFFERENCE"),
        )

    def _clear_scene(self, cmd):
        return self.clear_scene()

    def _export_model(self, cmd):
        return self.export_model(
            fmt=cmd.get("format", "obj"),
            filename=cmd.get("filename", "model"),
        )

    def _render_viewport(self, cmd):
        return self.render_viewport(filename=cmd.get("filename", "viewport_render"))

    def _get_scene_info(self, cmd):
        return self.get_scene_info()

    def _exec_python(self, cmd):
        """Execute arbitrary Python code in Blender environment."""
        code = cmd.get("code", "")
        if not code:
            raise ValueError("Parameter 'code' wajib diisi")
        return self.run_script(code, timeout=cmd.get("timeout", DEFAULT_TIMEOUT))

    # ── I/O — stdin/stdout bridge protocol ───────────────────────

    def __init__(self, debug=False):
        self.debug = debug
        self._connected = False
        self._last_cmd_id = ''

    def connect(self):
        """Verify Blender exists and workspace is ready."""
        if not os.path.exists(BLENDER_EXE):
            raise FileNotFoundError(
                f"Blender tidak ditemukan di: {BLENDER_EXE}\n"
                f"Pastikan Blender 5.2 terinstall."
            )
        ensure_workspace()
        self._connected = True
        return True

    def disconnect(self):
        self._connected = False

    def read_command(self) -> dict:
        line = sys.stdin.readline().strip()
        if not line:
            return None
        try:
            cmd = json.loads(line)
            self._last_cmd_id = cmd.get('_cmdId', '')
            return cmd
        except json.JSONDecodeError as e:
            return {"error": f"Invalid JSON: {e}", "raw": line}

    def send_response(self, data: dict):
        data['_cmdId'] = self._last_cmd_id
        response = json.dumps(data, ensure_ascii=False, default=str)
        sys.stdout.write(response + "\n")
        sys.stdout.flush()

    def send_error(self, message: str, details: str = ""):
        self.send_response({
            "success": False,
            "error": message,
            "details": details,
            "app": "Blender",
        })

    def send_success(self, result: any = None):
        self.send_response({
            "success": True,
            "result": result,
            "app": "Blender",
        })

    def run_forever(self):
        """Main loop: baca command dari stdin → eksekusi → kirim response."""
        self._log("Blender bridge ready. Listening on stdin...")
        self.send_response({
            "ready": True,
            "app": "Blender",
            "platform": sys.platform,
            "blender_exe": BLENDER_EXE,
            "workspace": str(WORKSPACE_DIR),
        })

        while True:
            try:
                cmd = self.read_command()
                if cmd is None:
                    continue

                action = cmd.get("action", "")

                if action == "exit" or action == "quit":
                    self.send_success({"status": "bye"})
                    break

                if action == "ping":
                    self.send_success(self._ping(cmd))
                    continue

                if action == "disconnect":
                    self.disconnect()
                    self.send_success({"status": "disconnected"})
                    continue

                if action == "reconnect":
                    self._connected = False
                    self.connect()
                    self.send_success({"status": "reconnected"})
                    continue

                # ── Dispatch ──────────────────────────────────
                try:
                    if not self._connected:
                        self.connect()
                    result = self.dispatch(action, cmd)
                    self.send_success(result)
                except Exception as e:
                    self.send_error(str(e), traceback.format_exc())

            except EOFError:
                break
            except KeyboardInterrupt:
                break
            except Exception as e:
                self.send_error(f"Fatal bridge error: {e}", traceback.format_exc())
                break

        self._log("Blender bridge shutting down...")

    def _log(self, message):
        print(f"[BlenderBridge] {message}", file=sys.stderr, flush=True)


# ═══════════════════════════════════════════════════════════════
# 🚀 MAIN — Entry point
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    bridge = BlenderBridge(debug="--debug" in sys.argv)
    try:
        bridge.connect()
        bridge.run_forever()
    except Exception as e:
        bridge.send_error(f"Startup error: {e}", traceback.format_exc())
    finally:
        bridge.disconnect()
