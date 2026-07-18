"""
blender_socket_server.py — Blender Socket Server (jalankan DARI DALAM BLENDER)

CARA PAKAI:
  1. Buka Blender
  2. Buka Text Editor (bisa via Scripting workspace)
  3. Paste atau buka file ini
  4. Klik "Run Script" — atau jalankan dari konsol:
     exec(open(r"D:\\downloads\\Vlora-V1\\desktop\\blender_socket_server.py").read())

  5. Begitu jalan, server TCP akan live di port 9999
  6. Flora agent bisa kirim kode Python via socket — hasilnya langsung dieksekusi!

BAGAIMANA CARA KERJA:
  ┌───────────────┐     TCP :9999     ┌──────────────────────┐
  │ Flora Agent   │ ────────────────→ │ Blender + bpy        │
  │ (via bridge)  │ ←──────────────── │ exec(code, globals)  │
  └───────────────┘     JSON/STDOUT   └──────────────────────┘
"""

import bpy
import bmesh
import sys
import os
import json
import time
import socket
import threading
import traceback
from mathutils import Vector, Matrix, Euler, Quaternion
from math import radians, degrees

# ═══════════════════════════════════════════════════════════════
# 📋 KONFIGURASI
# ═══════════════════════════════════════════════════════════════

HOST = "127.0.0.1"
PORT = 9999
BUFFER_SIZE = 65536  # 64KB — cukup untuk script besar

# Workspace untuk output file
WORKSPACE_DIR = os.path.join(os.path.expanduser("~"), "VloraWorkspace", "models")

# Global context untuk exec()
GLOBALS_SCOPE = {
    "bpy": bpy,
    "bmesh": bmesh,
    "Vector": Vector,
    "Matrix": Matrix,
    "Euler": Euler,
    "Quaternion": Quaternion,
    "radians": radians,
    "degrees": degrees,
    "os": os,
    "json": json,
    "math": __import__("math"),
    "time": time,
}

# ═══════════════════════════════════════════════════════════════
# 🔧 HELPER FUNCTIONS — tersedia langsung di exec()
# ═══════════════════════════════════════════════════════════════

def _make_helpers():
    """Buat helper functions yang akan dimasukkan ke scope global.
    User bisa panggil langsung: new_scene(), save_blend(), dll.
    """
    helpers = {}

    helpers_code = '''
def new_scene():
    """Bersihkan scene — hapus semua object."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        bpy.data.materials.remove(block)
    for block in bpy.data.textures:
        bpy.data.textures.remove(block)
    for block in bpy.data.images:
        bpy.data.images.remove(block)

def save_blend(filename=None):
    """Simpan .blend ke workspace. Returns path."""
    _ensure_workspace()
    if not filename:
        filename = f"flora_{int(time.time())}.blend"
    if not filename.endswith('.blend'):
        filename += '.blend'
    path = os.path.join(WORKSPACE_DIR, filename)
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print(f"[SAVED] {path}")
    return path

def export_obj(name="model"):
    """Export sebagai .obj ke workspace."""
    _ensure_workspace()
    path = os.path.join(WORKSPACE_DIR, f"{name}.obj")
    bpy.ops.wm.obj_export(filepath=path)
    print(f"[EXPORTED] {path}")
    return path

def export_fbx(name="model"):
    """Export sebagai .fbx ke workspace."""
    _ensure_workspace()
    path = os.path.join(WORKSPACE_DIR, f"{name}.fbx")
    bpy.ops.export_scene.fbx(filepath=path)
    print(f"[EXPORTED] {path}")
    return path

def export_glb(name="model"):
    """Export sebagai .glb ke workspace."""
    _ensure_workspace()
    path = os.path.join(WORKSPACE_DIR, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB')
    print(f"[EXPORTED] {path}")
    return path

def export_stl(name="model"):
    """Export sebagai .stl ke workspace."""
    _ensure_workspace()
    path = os.path.join(WORKSPACE_DIR, f"{name}.stl")
    bpy.ops.wm.stl_export(filepath=path)
    print(f"[EXPORTED] {path}")
    return path

def list_objects():
    """Daftar semua object di scene."""
    result = []
    for obj in bpy.data.objects:
        verts = len(obj.data.vertices) if hasattr(obj.data, "vertices") else 0
        polys = len(obj.data.polygons) if hasattr(obj.data, "polygons") else 0
        result.append({
            "name": obj.name,
            "type": obj.type,
            "location": tuple(round(v, 4) for v in obj.location),
            "verts": verts,
            "polygons": polys,
        })
    return result

def select(name):
    """Select object by name."""
    obj = bpy.data.objects.get(name)
    if obj:
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
    return obj

def delete(name):
    """Hapus object by name."""
    obj = bpy.data.objects.get(name)
    if obj:
        bpy.data.objects.remove(obj, do_unlink=True)
        return True
    return False

def set_material(obj_name, color=(0.8, 0.8, 0.8, 1.0), mat_type="principled"):
    """Apply material ke object.
    mat_type: principled, emission, glass, metallic, glossy
    """
    obj = bpy.data.objects.get(obj_name)
    if not obj:
        print(f"[ERROR] Object '{obj_name}' not found")
        return None

    mat = bpy.data.materials.new(name=f"{obj_name}_mat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]

    if mat_type == "emission":
        bsdf.inputs["Emission Strength"].default_value = 1.0
        bsdf.inputs["Emission Color"].default_value = color
    elif mat_type == "glass":
        bsdf.inputs["Transmission Weight"].default_value = 1.0
        bsdf.inputs["Roughness"].default_value = 0.0
    elif mat_type == "metallic":
        bsdf.inputs["Metallic"].default_value = 1.0
        bsdf.inputs["Roughness"].default_value = 0.3
    elif mat_type == "glossy":
        bsdf.inputs["Roughness"].default_value = 0.0

    bsdf.inputs["Base Color"].default_value = color

    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)

    return mat.name

def add_cube(size=2, location=(0,0,0), name="Cube"):
    bpy.ops.mesh.primitive_cube_add(size=size, location=location)
    obj = bpy.context.active_object
    obj.name = name
    return obj

def add_sphere(radius=1, location=(0,0,0), name="Sphere", segments=32):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=location, segments=segments)
    obj = bpy.context.active_object
    obj.name = name
    return obj

def add_cylinder(radius=1, depth=2, location=(0,0,0), name="Cylinder", vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=location, vertices=vertices)
    obj = bpy.context.active_object
    obj.name = name
    return obj

def add_cone(radius=1, depth=2, location=(0,0,0), name="Cone", vertices=32):
    bpy.ops.mesh.primitive_cone_add(radius1=radius, depth=depth, location=location, vertices=vertices)
    obj = bpy.context.active_object
    obj.name = name
    return obj

def add_torus(major_radius=1, minor_radius=0.25, location=(0,0,0), name="Torus"):
    bpy.ops.mesh.primitive_torus_add(major_radius=major_radius, minor_radius=minor_radius, location=location)
    obj = bpy.context.active_object
    obj.name = name
    return obj

def add_monkey(location=(0,0,0), name="Suzanne"):
    bpy.ops.mesh.primitive_monkey_add(location=location)
    obj = bpy.context.active_object
    obj.name = name
    return obj

def add_plane(size=2, location=(0,0,0), name="Plane"):
    bpy.ops.mesh.primitive_plane_add(size=size, location=location)
    obj = bpy.context.active_object
    obj.name = name
    return obj

def apply_modifier(obj_name, mod_type, **kwargs):
    """Apply modifier lalu apply-apply.
    mod_type: SUBSURF, BEVEL, MIRROR, ARRAY, SOLIDIFY, DECIMATE, SCREW, BOOLEAN
    """
    obj = bpy.data.objects.get(obj_name)
    if not obj:
        return f"[ERROR] Object '{obj_name}' not found"

    mod = obj.modifiers.new(name=mod_type, type=mod_type)

    for k, v in kwargs.items():
        if hasattr(mod, k):
            setattr(mod, k, v)

    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return f"[OK] {mod_type} applied to {obj_name}"

def boolean_diff(obj_a, obj_b):
    """Boolean difference: obj_a - obj_b. Hapus obj_b setelahnya."""
    obj = bpy.data.objects.get(obj_a)
    cutter = bpy.data.objects.get(obj_b)
    if not obj or not cutter:
        return f"[ERROR] Object not found: {obj_a} or {obj_b}"

    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new(name="Boolean", type='BOOLEAN')
    mod.object = cutter
    mod.operation = 'DIFFERENCE'
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
    return f"[OK] Boolean DIFFERENCE: {obj_a} - {obj_b}"

def boolean_union(obj_a, obj_b):
    """Boolean union: obj_a + obj_b. Hapus obj_b setelahnya."""
    obj = bpy.data.objects.get(obj_a)
    joiner = bpy.data.objects.get(obj_b)
    if not obj or not joiner:
        return f"[ERROR] Object not found: {obj_a} or {obj_b}"

    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new(name="Boolean", type='BOOLEAN')
    mod.object = joiner
    mod.operation = 'UNION'
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(joiner, do_unlink=True)
    return f"[OK] Boolean UNION: {obj_a} + {obj_b}"

def scene_info():
    """Dapatkan info scene dalam bentuk dict."""
    info = {
        "objects": [],
        "materials": [],
        "frame_start": bpy.context.scene.frame_start,
        "frame_end": bpy.context.scene.frame_end,
        "frame_current": bpy.context.scene.frame_current,
    }
    for obj in bpy.data.objects:
        info["objects"].append({
            "name": obj.name,
            "type": obj.type,
            "location": tuple(round(v, 4) for v in obj.location),
            "rotation": tuple(round(v, 4) for v in obj.rotation_euler),
            "scale": tuple(round(v, 4) for v in obj.scale),
            "verts": len(obj.data.vertices) if hasattr(obj.data, "vertices") else 0,
            "polygons": len(obj.data.polygons) if hasattr(obj.data, "polygons") else 0,
        })
    for mat in bpy.data.materials:
        info["materials"].append(mat.name)
    return info

def _ensure_workspace():
    os.makedirs(WORKSPACE_DIR, exist_ok=True)
'''

    # Compile helper functions into the scope
    compiled = compile(helpers_code, '<helpers>', 'exec')
    exec(compiled, GLOBALS_SCOPE)

    # Add workspace to scope
    GLOBALS_SCOPE["WORKSPACE_DIR"] = WORKSPACE_DIR


# ═══════════════════════════════════════════════════════════════
# 🧠 SOCKET SERVER
# ═══════════════════════════════════════════════════════════════

class BlenderSocketServer:
    """TCP server yang berjalan di dalam Blender, listen di port 9999.

    Menerima perintah JSON via socket:
      {"code": "import bpy; bpy.ops.mesh.primitive_cube_add()", "cmdId": "abc123"}

    Mengembalikan:
      {"success": true, "stdout": "...", "stderr": "...", "result": ..., "cmdId": "abc123"}
    """

    def __init__(self, host=HOST, port=PORT):
        self.host = host
        self.port = port
        self.server = None
        self.running = False
        self._thread = None

    def start(self):
        """Start server di thread terpisah agar tidak block Blender UI."""
        if self.running:
            print(f"[BlenderSocket] Server already running on {self.host}:{self.port}")
            return

        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.settimeout(1.0)  # timeout for accept() so we can check running flag

        try:
            self.server.bind((self.host, self.port))
            self.server.listen(5)
            self.running = True

            self._thread = threading.Thread(target=self._accept_loop, daemon=True)
            self._thread.start()

            print(f"\n{'='*50}")
            print(f"🧊 Blender Socket Server AKTIF!")
            print(f"   Host: {self.host}")
            print(f"   Port: {self.port}")
            print(f"   Thread: {self._thread.name}")
            print(f"   Workspace: {WORKSPACE_DIR}")
            print(f"{'='*50}")
            print(f"\nFlora agent sekarang bisa kirim kode Python langsung ke Blender!")
            print(f"Via: blender_socket_inject(code=\"...\")\n")

            return True

        except OSError as e:
            print(f"[BlenderSocket] ERROR: Gagal bind {self.host}:{self.port} — {e}")
            print(f"   Mungkin port sudah dipakai. Cek proses lain di port {self.port}.")
            self.server = None
            return False

    def stop(self):
        """Stop server."""
        self.running = False
        if self.server:
            try:
                self.server.close()
            except:
                pass
            self.server = None
        print("[BlenderSocket] Server stopped.")

    def _accept_loop(self):
        """Loop utama: terima koneksi, handle di thread sendiri."""
        while self.running:
            try:
                client, addr = self.server.accept()
                # Handle setiap koneksi di thread sendiri
                handler = threading.Thread(
                    target=self._handle_client,
                    args=(client, addr),
                    daemon=True,
                )
                handler.start()
            except socket.timeout:
                continue
            except OSError:
                break
            except Exception as e:
                if self.running:
                    print(f"[BlenderSocket] Accept error: {e}")

    def _handle_client(self, client, addr):
        """Handle satu koneksi client: baca command, eksekusi, kirim response."""
        print(f"[BlenderSocket] Koneksi dari {addr[0]}:{addr[1]}")

        try:
            client.settimeout(30.0)

            # Baca data (sampai client nutup koneksi)
            data = b""
            while True:
                chunk = client.recv(BUFFER_SIZE)
                if not chunk:
                    break
                data += chunk
                if len(chunk) < BUFFER_SIZE:
                    break  # Asumsinya data lengkap

            if not data:
                print(f"[BlenderSocket] Koneksi kosong dari {addr}")
                client.close()
                return

            # Parse JSON
            request = json.loads(data.decode("utf-8"))
            cmd_id = request.get("cmdId", "")
            code = request.get("code", "")

            if not code:
                self._send_response(client, {
                    "success": False,
                    "error": "Parameter 'code' wajib diisi",
                    "cmdId": cmd_id,
                })
                client.close()
                return

            print(f"[BlenderSocket] Eksekusi kode ({len(code)} chars) dari {addr[0]}")
            if len(code) < 200:
                print(f"   Code: {code[:200]}")

            # ── Eksekusi ──────────────────────────────────────────
            result = self._execute_code(code, cmd_id)

            # ── Kirim response ────────────────────────────────────
            self._send_response(client, result)

        except json.JSONDecodeError as e:
            self._send_response(client, {
                "success": False,
                "error": f"Invalid JSON: {e}",
            })
        except socket.timeout:
            self._send_response(client, {
                "success": False,
                "error": "Timeout: client tidak mengirim data dalam 30 detik",
            })
        except Exception as e:
            self._send_response(client, {
                "success": False,
                "error": f"Connection error: {e}",
                "traceback": traceback.format_exc(),
            })
        finally:
            try:
                client.close()
            except:
                pass

    def _execute_code(self, code, cmd_id=""):
        """Eksekusi kode Python di lingkungan Blender dengan bpy.

        Args:
            code: String kode Python
            cmd_id: ID untuk tracing

        Returns:
            dict: { success, stdout, stderr, result, cmdId }
        """
        # Capture stdout/stderr
        old_stdout = sys.stdout
        old_stderr = sys.stderr

        stdout_capture = StringCapture()
        stderr_capture = StringCapture()

        sys.stdout = stdout_capture
        sys.stderr = stderr_capture

        exec_result = None
        error_trace = None

        try:
            # Compile with 'exec' mode
            compiled = compile(code.strip(), '<blender_socket>', 'exec')

            # Eksekusi dengan globals yang sudah berisi bpy + helpers
            exec(compiled, GLOBALS_SCOPE)

            # Coba ambil variabel _result dari scope (optional)
            # _result = GLOBALS_SCOPE.get("_result")
            # if _result is not None:
            #     exec_result = _result

            success = True

        except Exception as e:
            success = False
            error_trace = traceback.format_exc()
            print(f"[ERROR] {e}", file=old_stderr)

        finally:
            sys.stdout = old_stdout
            sys.stderr = old_stderr

        stdout_text = stdout_capture.getvalue()
        stderr_text = stderr_capture.getvalue()

        # Parse result dari stdout jika ada baris BLENDER_RESULT:
        parsed_result = None
        for line in stdout_text.split('\n'):
            if line.startswith('BLENDER_RESULT:'):
                try:
                    parsed_result = json.loads(line[len('BLENDER_RESULT:'):])
                except json.JSONDecodeError:
                    parsed_result = {"raw": line}

        return {
            "success": success,
            "stdout": stdout_text,
            "stderr": stderr_text,
            "result": parsed_result or exec_result,
            "error": error_trace if not success else None,
            "cmdId": cmd_id,
        }

    def _send_response(self, client, data):
        """Kirim JSON response ke client."""
        response = json.dumps(data, ensure_ascii=False, default=str)
        client.sendall(response.encode("utf-8"))


# ═══════════════════════════════════════════════════════════════
# 📝 STRING CAPTURE — capture stdout/stderr
# ═══════════════════════════════════════════════════════════════

class StringCapture:
    """Simple string buffer untuk capture stdout/stderr."""
    def __init__(self):
        self._buffer = []

    def write(self, text):
        self._buffer.append(text)

    def flush(self):
        pass

    def getvalue(self):
        return "".join(self._buffer)

    def __len__(self):
        return len("".join(self._buffer))


# ═══════════════════════════════════════════════════════════════
# 🚀 MODULE-LEVEL STARTUP FUNCTION — untuk import dari bridge
# ═══════════════════════════════════════════════════════════════

_server_instance = None  # hold reference agar bisa di-stop


def start_server(host=HOST, port=PORT) -> bool:
    """Start Blender Socket Server — bisa dipanggil dari luar (import).

    Fungsi ini dipanggil oleh blender_socket_bridge._cmd_start_server()
    ketika bridge ingin start server di Blender via remote code execution.

    Args:
        host: IP untuk listen (default: 127.0.0.1)
        port: Port untuk listen (default: 9999)

    Returns:
        True jika berhasil, False jika gagal
    """
    global _server_instance

    _make_helpers()

    server = BlenderSocketServer(host=host, port=port)
    if server.start():
        _server_instance = server
        GLOBALS_SCOPE["blender_socket"] = server
        return True

    return False


def stop_server():
    """Stop Blender Socket Server yang sedang berjalan."""
    global _server_instance
    if _server_instance:
        _server_instance.stop()
        _server_instance = None
        return True
    return False


# ═══════════════════════════════════════════════════════════════
# 🚀 STARTUP — hanya jika dijalankan langsung
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    # Register helper functions ke scope global
    _make_helpers()

    # Buat dan start server
    server = BlenderSocketServer()

    if server.start():
        # Simpan referensi global agar bisa diakses dari console Blender
        # User bisa stop dengan: blender_socket.stop()
        GLOBALS_SCOPE["blender_socket"] = server

        # Biarkan main thread hidup — server di thread daemon
        try:
            while server.running:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n[BlenderSocket] Shutting down...")
            server.stop()
    else:
        print("[BlenderSocket] Gagal start server. Cek konfigurasi.")
