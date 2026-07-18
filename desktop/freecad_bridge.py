"""
freecad_bridge.py — FreeCAD 3D Automation Bridge untuk Flora Agent.

Mode operasi:
  - Mode 1 (Headless): Kirim Python script ke FreeCAD via FreeCADCmd.exe --background
  - Mode 2 (Socket): Komunikasi real-time dengan FreeCAD melalui socket TCP

Semua output file 3D (.FCStd, .step, .stl, .obj, .iges) disimpan ke:
  D:\\VloraWorkspace\\models\\

Contoh command via stdin:
  {"action": "run_script", "script": "import FreeCAD; doc=FreeCAD.newDocument(); doc.addObject('Part::Box','Box').Height=10"}
  {"action": "export_model", "format": "stl", "filename": "model"}
  {"action": "get_scene_info"}
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

FREECAD_EXE = r"C:\Program Files\FreeCAD 1.1\bin\FreeCADCmd.exe"
WORKSPACE_DIR = Path(r"D:\VloraWorkspace\models")
DEFAULT_TIMEOUT = 300  # FreeCAD ops butuh waktu (5 menit untuk first-start)

# ── Workspace ────────────────────────────────────────────────────

def ensure_workspace():
    """Pastikan direktori workspace untuk output 3D ada."""
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
    return WORKSPACE_DIR


# ═══════════════════════════════════════════════════════════════
# 🧩 FreeCADBridge — Kelas utama
# ═══════════════════════════════════════════════════════════════

class FreeCADBridge:
    """Bridge untuk komunikasi Agent → FreeCAD via script injection.

    Arsitektur:
        Agent → tools.js → desktop.js → FreeCADBridge (Python) → FreeCADCmd.exe

    Mode Operasi:
      1. one_shot:  tulis script ke file temp, jalankan FreeCADCmd.exe --background,
                    tangkap stdout, hapus temp.
      2. socket:    kirim command via TCP ke FreeCAD yang sudah running + socket server.
    """

    # ── Core: Execute Python di FreeCAD ──────────────────────────

    def run_script(self, script: str, timeout: int = DEFAULT_TIMEOUT) -> dict:
        """Jalankan Python script di FreeCAD (headless / background mode).
        
        Args:
            script: Kode Python yang akan dieksekusi di environment FreeCAD.
                    Variabel 'FreeCAD', 'App', 'Part', 'Mesh' sudah tersedia.
            timeout: Maks waktu tunggu dalam detik.
        
        Returns:
            dict dengan keys: success, output, error, fcstd_file
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
            # Eksekusi FreeCAD (--console = headless mode di FreeCAD 1.1)
            result = subprocess.run(
                [FREECAD_EXE, '--console', script_path],
                capture_output=True, text=True, timeout=timeout,
                cwd=str(WORKSPACE_DIR)
            )

            stdout = result.stdout or ''
            stderr = result.stderr or ''

            # Ambil baris JSON yang dimulai dengan "FREECAD_RESULT:"
            json_result = None
            output_lines = []
            for line in stdout.split('\n'):
                if line.startswith('FREECAD_RESULT:'):
                    try:
                        json_str = line[len('FREECAD_RESULT:'):].strip()
                        json_result = json.loads(json_str)
                    except json.JSONDecodeError:
                        json_result = {"raw": line}
                else:
                    output_lines.append(line)

            return {
                "success": result.returncode == 0,
                "output": '\n'.join(output_lines[-50:]),
                "error": stderr[:2000] if stderr else None,
                "fcstd_file": json_result.get("fcstd_file") if json_result else None,
                "exported_files": json_result.get("exported_files") or [],
                "return_code": result.returncode,
                "result": json_result,
            }

        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "error": f"FreeCAD timeout setelah {timeout} detik. Script terlalu kompleks.",
                "output": None,
            }
        except FileNotFoundError:
            return {
                "success": False,
                "error": f"FreeCAD tidak ditemukan di: {FREECAD_EXE}\n"
                         f"Pastikan FreeCAD 1.0 terinstall di path tersebut.",
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"FreeCAD execution error: {e}",
            }
        finally:
            try:
                os.unlink(script_path)
            except (OSError, PermissionError):
                pass

    # ── Script wrapper ────────────────────────────────────────────

    def _wrap_script(self, script: str) -> str:
        """Bungkus script user dengan boilerplate yang diperlukan."""
        workspace = WORKSPACE_DIR.as_posix()

        return f'''
import sys
import os
import json
import math
from pathlib import Path

# ── FreeCAD imports ──────────────────────────────────────────
import FreeCAD as App
import FreeCADGui as Gui
import Part
import Mesh
import MeshPart
import Import
import ImportGui

# ── Workspace ──────────────────────────────────────────────────
WORKSPACE = Path(r"{workspace}")
WORKSPACE.mkdir(parents=True, exist_ok=True)

_doc_name = None

# ── Helper functions ────────────────────────────────────────────

def _get_doc():
    global _doc_name
    if _doc_name and _doc_name in [d.Name for d in App.listDocuments().values()]:
        return App.getDocument(_doc_name)
    docs = App.listDocuments()
    if docs:
        name = list(docs.keys())[0]
        _doc_name = name
        return docs[name]
    return None

def get_or_create_doc(name="FloraModel"):
    global _doc_name
    _doc_name = name
    if name in [d.Name for d in App.listDocuments().values()]:
        return App.getDocument(name)
    return App.newDocument(name)

# ── Result tracker ──────────────────────────────────────────────
_result = {{
    "fcstd_file": None,
    "exported_files": [],
    "objects_created": [],
}}

def save_fcstd(filename: str = None) -> str:
    doc = _get_doc()
    if doc is None:
        raise RuntimeError("Tidak ada dokumen aktif untuk disimpan")
    if not filename:
        filename = f"flora_model"
    if not filename.endswith('.FCStd'):
        filename += '.FCStd'
    path = str(WORKSPACE / filename)
    doc.saveAs(path)
    _result["fcstd_file"] = path
    return path

def export_stl(name: str = "model") -> str:
    doc = _get_doc()
    if doc is None:
        raise RuntimeError("Tidak ada dokumen aktif")
    path = str(WORKSPACE / f"{{name}}.stl")
    import Mesh
    objects = doc.Objects
    mesh = Mesh.Mesh()
    for obj in objects:
        if hasattr(obj, "Shape") and obj.Shape:
            try:
                mesh2 = MeshPart.meshFromShape(Shape=obj.Shape, LinearDeflection=0.1, AngularDeflection=0.5)
                mesh.addMesh(mesh2)
            except:
                pass
    mesh.write(path)
    _result["exported_files"].append(path)
    return path

def export_step(name: str = "model") -> str:
    doc = _get_doc()
    if doc is None:
        raise RuntimeError("Tidak ada dokumen aktif")
    path = str(WORKSPACE / f"{{name}}.step")
    Import.export(doc.Objects, path)
    _result["exported_files"].append(path)
    return path

def export_obj(name: str = "model") -> str:
    doc = _get_doc()
    if doc is None:
        raise RuntimeError("Tidak ada dokumen aktif")
    path = str(WORKSPACE / f"{{name}}.obj")
    Import.export(doc.Objects, path)
    _result["exported_files"].append(path)
    return path

def export_iges(name: str = "model") -> str:
    doc = _get_doc()
    if doc is None:
        raise RuntimeError("Tidak ada dokumen aktif")
    path = str(WORKSPACE / f"{{name}}.iges")
    Import.export(doc.Objects, path)
    _result["exported_files"].append(path)
    return path

def new_document(name="FloraModel"):
    global _doc_name
    _doc_name = name
    if name in [d.Name for d in App.listDocuments().values()]:
        App.closeDocument(name)
    return App.newDocument(name)

def add_box(length=10, width=10, height=10, name="Box", 
            placement=(0,0,0), label=None):
    doc = get_or_create_doc()
    obj = doc.addObject("Part::Box", name)
    obj.Length = length
    obj.Width = width
    obj.Height = height
    obj.Placement.Base = App.Vector(*placement)
    if label:
        obj.Label = label
    doc.recompute()
    _result["objects_created"].append(name)
    return obj

def add_cylinder(radius=5, height=10, name="Cylinder",
                 placement=(0,0,0), angle=360):
    doc = get_or_create_doc()
    obj = doc.addObject("Part::Cylinder", name)
    obj.Radius = radius
    obj.Height = height
    obj.Angle = angle
    obj.Placement.Base = App.Vector(*placement)
    doc.recompute()
    _result["objects_created"].append(name)
    return obj

def add_sphere(radius=5, name="Sphere", placement=(0,0,0)):
    doc = get_or_create_doc()
    obj = doc.addObject("Part::Sphere", name)
    obj.Radius = radius
    obj.Placement.Base = App.Vector(*placement)
    doc.recompute()
    _result["objects_created"].append(name)
    return obj

def add_cone(radius1=0, radius2=5, height=10, name="Cone",
             placement=(0,0,0)):
    doc = get_or_create_doc()
    obj = doc.addObject("Part::Cone", name)
    obj.Radius1 = radius1
    obj.Radius2 = radius2
    obj.Height = height
    obj.Placement.Base = App.Vector(*placement)
    doc.recompute()
    _result["objects_created"].append(name)
    return obj

def add_torus(radius1=10, radius2=2, name="Torus", placement=(0,0,0)):
    doc = get_or_create_doc()
    obj = doc.addObject("Part::Torus", name)
    obj.Radius1 = radius1
    obj.Radius2 = radius2
    obj.Placement.Base = App.Vector(*placement)
    doc.recompute()
    _result["objects_created"].append(name)
    return obj

def boolean_cut(base_name, tool_name, result_name="Cut"):
    doc = _get_doc()
    if doc is None:
        raise RuntimeError("Tidak ada dokumen aktif")
    base = doc.getObject(base_name)
    tool = doc.getObject(tool_name)
    if not base or not tool:
        raise ValueError(f"Object tidak ditemukan: {base_name} atau {tool_name}")
    obj = doc.addObject("Part::Cut", result_name)
    obj.Base = base
    obj.Tool = tool
    doc.recompute()
    _result["objects_created"].append(result_name)
    return obj

def boolean_fuse(obj_a_name, obj_b_name, result_name="Fusion"):
    doc = _get_doc()
    if doc is None:
        raise RuntimeError("Tidak ada dokumen aktif")
    a = doc.getObject(obj_a_name)
    b = doc.getObject(obj_b_name)
    if not a or not b:
        raise ValueError(f"Object tidak ditemukan")
    obj = doc.addObject("Part::MultiFuse", result_name)
    obj.Shapes = [a, b]
    doc.recompute()
    _result["objects_created"].append(result_name)
    return obj

def boolean_common(obj_a_name, obj_b_name, result_name="Common"):
    doc = _get_doc()
    if doc is None:
        raise RuntimeError("Tidak ada dokumen aktif")
    a = doc.getObject(obj_a_name)
    b = doc.getObject(obj_b_name)
    if not a or not b:
        raise ValueError(f"Object tidak ditemukan")
    obj = doc.addObject("Part::Common", result_name)
    obj.Base = a
    obj.Tool = b
    doc.recompute()
    _result["objects_created"].append(result_name)
    return obj

def fillet(obj_name, edges, radius=1.0, result_name="Fillet"):
    """Buat fillet pada edges object."""
    doc = _get_doc()
    if doc is None:
        raise RuntimeError("Tidak ada dokumen aktif")
    obj = doc.getObject(obj_name)
    if not obj:
        raise ValueError(f"Object '{obj_name}' tidak ditemukan")
    fillet_obj = doc.addObject("Part::Fillet", result_name)
    fillet_obj.Base = obj
    fillet_obj.Radius = radius
    fillet_obj.Edges = edges if isinstance(edges, list) else [edges]
    doc.recompute()
    _result["objects_created"].append(result_name)
    return fillet_obj

def chamfer(obj_name, edges, size=1.0, result_name="Chamfer"):
    doc = _get_doc()
    if doc is None:
        raise RuntimeError("Tidak ada dokumen aktif")
    obj = doc.getObject(obj_name)
    if not obj:
        raise ValueError(f"Object '{obj_name}' tidak ditemukan")
    cham_obj = doc.addObject("Part::Chamfer", result_name)
    cham_obj.Base = obj
    cham_obj.Size = size
    cham_obj.Edges = edges if isinstance(edges, list) else [edges]
    doc.recompute()
    _result["objects_created"].append(result_name)
    return cham_obj

def revolve(obj_name, axis=(0,0,1), angle=360, result_name="Revolved"):
    """Revolve (putar) object di sekitar axis."""
    doc = _get_doc()
    if doc is None:
        raise RuntimeError("Tidak ada dokumen aktif")
    obj = doc.getObject(obj_name)
    if not obj:
        raise ValueError(f"Object '{obj_name}' tidak ditemukan")
    rev = doc.addObject("Part::Revolution", result_name)
    rev.Source = obj
    rev.Axis = App.Vector(*axis)
    rev.Angle = angle
    doc.recompute()
    _result["objects_created"].append(result_name)
    return rev

def scene_info():
    """Kumpulkan info semua object di scene."""
    docs = App.listDocuments()
    info = {{
        "documents": [],
    }}
    for name, doc in docs.items():
        doc_info = {{
            "name": name,
            "objects": [],
        }}
        for obj in doc.Objects:
            obj_info = {{
                "name": obj.Name,
                "label": obj.Label,
                "type": obj.TypeId,
            }}
            if hasattr(obj, "Shape") and obj.Shape:
                try:
                    bb = obj.Shape.BoundBox
                    obj_info["boundbox"] = {{
                        "xmin": bb.XMin, "ymin": bb.YMin, "zmin": bb.ZMin,
                        "xmax": bb.XMax, "ymax": bb.YMax, "zmax": bb.ZMax,
                    }}
                    obj_info["volume"] = obj.Shape.Volume
                    obj_info["faces"] = len(obj.Shape.Faces)
                    obj_info["edges"] = len(obj.Shape.Edges)
                    obj_info["vertices"] = len(obj.Shape.Vertexes)
                except:
                    pass
            doc_info["objects"].append(obj_info)
        info["documents"].append(doc_info)
    return info

# ── USER SCRIPT ─────────────────────────────────────────────────
try:
    {script}
    # Pastikan recompute setelah script user
    doc = _get_doc()
    if doc:
        doc.recompute()
except Exception as _e:
    import traceback
    traceback.print_exc(file=sys.stderr)
    print(f"FREECAD_ERROR: {{_e}}", file=sys.stderr)
    _result["error"] = str(_e)

# ── Output result ──────────────────────────────────────────────
print(f"FREECAD_RESULT:{{json.dumps(_result, default=str)}}")
'''

    # ── High-level operations ─────────────────────────────────────

    def create_mesh(self, mesh_type: str = "box", **kwargs) -> dict:
        """Buat primitive di FreeCAD.
        
        mesh_type: box, cylinder, sphere, cone, torus
        kwargs: size, radius, height, placement, name
        """
        loc = kwargs.get("location", (0, 0, 0))
        name = kwargs.get("name", f"{mesh_type}_{uuid.uuid4().hex[:6]}")

        ops_map = {
            "box": (
                f'add_box('
                f'length={kwargs.get("size", 10)}, '
                f'width={kwargs.get("size", 10)}, '
                f'height={kwargs.get("size", 10)}, '
                f'name="{name}", '
                f'placement={repr(loc)})'
            ),
            "cylinder": (
                f'add_cylinder('
                f'radius={kwargs.get("radius", 5)}, '
                f'height={kwargs.get("depth", 10)}, '
                f'name="{name}", '
                f'placement={repr(loc)})'
            ),
            "sphere": (
                f'add_sphere('
                f'radius={kwargs.get("radius", 5)}, '
                f'name="{name}", '
                f'placement={repr(loc)})'
            ),
            "cone": (
                f'add_cone('
                f'radius1={kwargs.get("radius1", 0)}, '
                f'radius2={kwargs.get("radius", 5)}, '
                f'height={kwargs.get("depth", 10)}, '
                f'name="{name}", '
                f'placement={repr(loc)})'
            ),
            "torus": (
                f'add_torus('
                f'radius1={kwargs.get("radius", 10)}, '
                f'radius2={kwargs.get("radius2", 2)}, '
                f'name="{name}", '
                f'placement={repr(loc)})'
            ),
        }

        if mesh_type not in ops_map:
            return {"success": False, "error": f"Type '{mesh_type}' tidak dikenal. Pilihan: {', '.join(ops_map.keys())}"}

        script = f'''
doc = get_or_create_doc()
{ops_map[mesh_type]}
doc.recompute()
'''
        return self.run_script(script)

    def get_scene_info(self) -> dict:
        """Dapatkan informasi scene FreeCAD saat ini."""
        script = '''
import json
info = scene_info()
_result["scene_info"] = info
'''
        return self.run_script(script)

    def export_model(self, fmt: str = "step", filename: str = "model") -> dict:
        """Export scene ke format 3D.
        
        format: 'step', 'stl', 'obj', 'iges', 'fcstd'
        """
        export_funcs = {
            'step': ("export_step", f"export_step('{filename}')"),
            'stl': ("export_stl", f"export_stl('{filename}')"),
            'obj': ("export_obj", f"export_obj('{filename}')"),
            'iges': ("export_iges", f"export_iges('{filename}')"),
            'fcstd': ("save_fcstd", f"save_fcstd('{filename}.FCStd')"),
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
        """Bersihkan semua dokumen."""
        script = '''
for name, doc in list(App.listDocuments().items()):
    App.closeDocument(name)
new_document("FloraModel")
'''
        return self.run_script(script)

    # ── Dispatch ──────────────────────────────────────────────────

    def dispatch(self, action: str, cmd: dict) -> any:
        """Route action ke method yang sesuai."""
        handlers = {
            "run_script": self._run_script,
            "ping": self._ping,
            "create_mesh": self._create_mesh,
            "modify_object": self._modify_object,
            "delete_object": self._delete_object,
            "clear_scene": self._clear_scene,
            "export_model": self._export_model,
            "get_scene_info": self._get_scene_info,
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
        return {"pong": True, "freecad": FREECAD_EXE, "workspace": str(WORKSPACE_DIR)}

    def _create_mesh(self, cmd):
        return self.create_mesh(
            mesh_type=cmd.get("mesh_type", "box"),
            size=cmd.get("size"),
            radius=cmd.get("radius"),
            depth=cmd.get("depth"),
            radius1=cmd.get("radius1"),
            radius2=cmd.get("radius2"),
            location=cmd.get("location", (0, 0, 0)),
            name=cmd.get("name"),
        )

    def _modify_object(self, cmd):
        obj_name = cmd.get("obj_name", "")
        location = cmd.get("location")
        if not location:
            return {"success": False, "error": "Parameter 'location' diperlukan"}
        script = f'''
doc = _get_doc()
obj = doc.getObject("{obj_name}")
if obj is None:
    raise ValueError(f"Object '{{obj_name}}' tidak ditemukan")
obj.Placement.Base = App.Vector(*{repr(location)})
doc.recompute()
'''
        return self.run_script(script)

    def _delete_object(self, cmd):
        obj_name = cmd.get("obj_name", "")
        if not obj_name:
            return {"success": False, "error": "Parameter 'obj_name' diperlukan"}
        script = f'''
doc = _get_doc()
obj = doc.getObject("{obj_name}")
if obj is None:
    raise ValueError(f"Object '{{obj_name}}' tidak ditemukan")
doc.removeObject("{obj_name}")
doc.recompute()
'''
        return self.run_script(script)

    def _clear_scene(self, cmd):
        return self.clear_scene()

    def _export_model(self, cmd):
        return self.export_model(
            fmt=cmd.get("format", "step"),
            filename=cmd.get("filename", "model"),
        )

    def _get_scene_info(self, cmd):
        return self.get_scene_info()

    def _exec_python(self, cmd):
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
        """Verify FreeCAD exists and workspace is ready."""
        global FREECAD_EXE
        if not os.path.exists(FREECAD_EXE):
            # Coba path alternatif
            alt_paths = [
                r"C:\Program Files\FreeCAD 1.1\bin\FreeCADCmd.exe",
                r"C:\Program Files\FreeCAD 1.0\bin\FreeCADCmd.exe",
                r"C:\Program Files\FreeCAD 0.21\bin\FreeCADCmd.exe",
                r"C:\Program Files\FreeCAD 0.20\bin\FreeCADCmd.exe",
            ]
            found = False
            for p in alt_paths:
                if os.path.exists(p):
                    FREECAD_EXE = p
                    found = True
                    break
            if not found:
                raise FileNotFoundError(
                    f"FreeCAD tidak ditemukan.\n"
                    f"Coba instal FreeCAD atau set FREECAD_EXE di script ini."
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
            "app": "FreeCAD",
        })

    def send_success(self, result: any = None):
        self.send_response({
            "success": True,
            "result": result,
            "app": "FreeCAD",
        })

    def run_forever(self):
        """Main loop: baca command dari stdin → eksekusi → kirim response."""
        self._log("FreeCAD bridge ready. Listening on stdin...")
        self.send_response({
            "ready": True,
            "app": "FreeCAD",
            "platform": sys.platform,
            "freecad_exe": FREECAD_EXE,
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

        self._log("FreeCAD bridge shutting down...")

    def _log(self, message):
        print(f"[FreeCADBridge] {message}", file=sys.stderr, flush=True)


# ═══════════════════════════════════════════════════════════════
# 🚀 MAIN — Entry point
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    bridge = FreeCADBridge(debug="--debug" in sys.argv)
    try:
        bridge.connect()
        bridge.run_forever()
    except Exception as e:
        bridge.send_error(f"Startup error: {e}", traceback.format_exc())
    finally:
        bridge.disconnect()
