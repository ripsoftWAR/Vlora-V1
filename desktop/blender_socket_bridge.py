"""
blender_socket_bridge.py — 🧊 Blender Live Socket Bridge (Client Side)
======================================================================

Bridge yang berjalan sebagai child process dari Node.js (desktop.js).
Menghubungkan agent Flora dengan Blender yang sedang berjalan via TCP socket.

Arsitektur:
  Flora Agent → tools.js → desktop.js (Node.js)
    → stdin/stdout JSON
      → blender_socket_bridge.py (Python child process)
        → TCP socket :9999
          → blender_socket_server.py (RUNS INSIDE BLENDER)
            → exec() kode Python di Blender context

Mode operasi:
  - Live: Blender sudah terbuka, server sudah jalan → konek via TCP :9999
  - Retry: Coba reconnect otomatis jika Blender mati/hang
  - Eval: Evaluasi expression cepat (bukan full exec)

Contoh command via stdin:
  {"action": "run_script", "code": "import bpy; bpy.ops.mesh.primitive_cube_add()"}
  {"action": "ping"}
  {"action": "eval", "expression": "len(bpy.data.objects)"}
  {"action": "get_scene_info"}
  {"action": "exit"}
"""

import sys
import json
import socket
import traceback
import time
from datetime import datetime

# ── Constants ───────────────────────────────────────────────────

BLENDER_HOST = "127.0.0.1"
BLENDER_PORT = 9999
CONNECT_TIMEOUT = 5      # detik timeout koneksi awal
RESPONSE_TIMEOUT = 120   # detik timeout menunggu response dari Blender
RECONNECT_DELAY = 1.0    # detik delay sebelum reconnect


# ═══════════════════════════════════════════════════════════════
# 🧩 BlenderSocketBridge — Client yang konek ke Blender via TCP
# ═══════════════════════════════════════════════════════════════

class BlenderSocketBridge:
    """Bridge Agent → Blender via TCP socket (live connection).

    Bridge ini berjalan sebagai subprocess Python, komunikasi dengan
    Node.js via stdin/stdout JSON (sama seperti word_bridge).
    Node.js kirim command → bridge kirim ke Blender via TCP → balikin hasil.
    """

    APP_NAME = "BlenderSocket"

    def __init__(self, debug=False):
        self.debug = debug
        self._connected = False
        self._last_cmd_id = ''
        self._sock = None
        self._buffer = b""

    # ── Koneksi TCP ke Blender ─────────────────────────────────

    def connect_to_blender(self, host=BLENDER_HOST, port=BLENDER_PORT):
        """Konek ke Blender socket server.

        Retry beberapa kali kalau belum siap (Blender mungkin baru start).
        """
        if self._connected and self._sock:
            return True

        self._log(f"Menghubungkan ke Blender di {host}:{port}...")

        last_error = None
        for attempt in range(5):  # 5x percobaan
            try:
                self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self._sock.settimeout(CONNECT_TIMEOUT)
                self._sock.connect((host, port))
                self._connected = True
                self._buffer = b""
                self._log(f"✅ Terhubung ke Blender di {host}:{port}")
                return True
            except (socket.timeout, ConnectionRefusedError, OSError) as e:
                last_error = e
                if attempt < 4:
                    delay = (attempt + 1) * RECONNECT_DELAY
                    self._log(f"⏳ Percobaan {attempt + 1} gagal: {e}. "
                              f"Retry dalam {delay:.1f} detik...")
                    time.sleep(delay)
                self._sock = None

        self._connected = False
        error_msg = (
            f"❌ Tidak bisa konek ke Blender di {host}:{port}.\n"
            f"   Pastikan:\n"
            f"   1. Blender sudah terbuka\n"
            f"   2. Sudah jalankan blender_socket_server.py di Text Editor Blender\n"
            f"   3. Server berjalan di port {port}\n"
            f"   Detail: {last_error}"
        )
        raise ConnectionError(error_msg)

    def disconnect_from_blender(self):
        """Putus koneksi TCP ke Blender."""
        self._connected = False
        if self._sock:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None
        self._log("Diputus dari Blender.")

    def reconnect(self):
        """Putus lalu konek ulang."""
        self.disconnect_from_blender()
        return self.connect_to_blender()

    # ── Kirim command ke Blender via TCP ───────────────────────

    def send_to_blender(self, command: dict) -> dict:
        """Kirim command JSON ke Blender, terima response.

        Args:
            command: Dict dengan action + params

        Returns:
            Dict response dari Blender
        """
        if not self._connected or not self._sock:
            self.connect_to_blender()

        # Kirim command sebagai JSON + newline
        payload = json.dumps(command, ensure_ascii=False) + "\n"
        self._sock.sendall(payload.encode("utf-8"))

        # Baca response — baca sampai newline
        response_data = b""
        self._sock.settimeout(RESPONSE_TIMEOUT)

        while True:
            try:
                chunk = self._sock.recv(4096)
                if not chunk:
                    raise ConnectionError("Blender menutup koneksi.")
                response_data += chunk

                # Cek apakah sudah ada newline (akhir JSON)
                if b"\n" in response_data:
                    line, rest = response_data.split(b"\n", 1)
                    self._buffer = rest
                    decoded = line.decode("utf-8").strip()
                    return json.loads(decoded)

            except socket.timeout:
                raise TimeoutError(
                    f"Blender tidak merespon dalam {RESPONSE_TIMEOUT} detik.\n"
                    f"Command: {json.dumps(command)[:200]}"
                )

    # ── High-level Blender operations ─────────────────────────

    def ping(self) -> dict:
        """Cek koneksi ke Blender."""
        return self.send_to_blender({"action": "ping"})

    def get_scene_info(self) -> dict:
        """Dapatkan info scene Blender saat ini."""
        return self.send_to_blender({"action": "get_scene_info"})

    def run_code(self, code: str, main_thread: bool = False) -> dict:
        """Kirim kode Python untuk dieksekusi di Blender.

        Args:
            code: Kode Python (bpy, C, D, mathutils sudah tersedia)
            main_thread: True jika harus jalan di main thread Blender

        Returns:
            Dict dengan success, output, error, dll
        """
        return self.send_to_blender({
            "action": "exec_code",
            "code": code,
            "main_thread": main_thread,
        })

    def evaluate(self, expression: str) -> dict:
        """Evaluasi expression Python di Blender (return value)."""
        return self.send_to_blender({
            "action": "eval",
            "expression": expression,
        })

    def shutdown(self) -> dict:
        """Matikan server socket di Blender."""
        return self.send_to_blender({"action": "shutdown"})

    # ── Blender high-level helpers ────────────────────────────

    def create_mesh(self, mesh_type: str = "cube", **kwargs) -> dict:
        """Buat mesh primitive di Blender."""
        loc = kwargs.get("location", (0, 0, 0))
        rot = kwargs.get("rotation", (0, 0, 0))
        scale = kwargs.get("scale", (1, 1, 1))
        name = kwargs.get("name", f"{mesh_type}_live")

        ops_map = {
            "cube":       f"bpy.ops.mesh.primitive_cube_add(size={kwargs.get('size', 2)})",
            "sphere":     f"bpy.ops.mesh.primitive_uv_sphere_add(radius={kwargs.get('radius', 1)}, segments={kwargs.get('segments', 32)}, ring_count={kwargs.get('ring_count', 16)})",
            "cylinder":   f"bpy.ops.mesh.primitive_cylinder_add(radius={kwargs.get('radius', 1)}, depth={kwargs.get('depth', 2)}, vertices={kwargs.get('vertices', 32)})",
            "cone":       f"bpy.ops.mesh.primitive_cone_add(radius1={kwargs.get('radius', 1)}, depth={kwargs.get('depth', 2)}, vertices={kwargs.get('vertices', 32)})",
            "torus":      f"bpy.ops.mesh.primitive_torus_add(major_radius={kwargs.get('major_radius', 1)}, minor_radius={kwargs.get('minor_radius', 0.25)}, major_segments={kwargs.get('major_segments', 48)}, minor_segments={kwargs.get('minor_segments', 12)})",
            "plane":      f"bpy.ops.mesh.primitive_plane_add(size={kwargs.get('size', 2)})",
            "monkey":     "bpy.ops.mesh.primitive_monkey_add()",
            "circle":     f"bpy.ops.mesh.primitive_circle_add(radius={kwargs.get('radius', 1)}, vertices={kwargs.get('vertices', 32)})",
            "grid":       f"bpy.ops.mesh.primitive_grid_add(x_subdivisions={kwargs.get('x_subdivisions', 10)}, y_subdivisions={kwargs.get('y_subdivisions', 10)}, size={kwargs.get('size', 2)})",
        }

        if mesh_type not in ops_map:
            return {"success": False, "error": f"Unknown mesh type: {mesh_type}"}

        code = f'''
import bpy
{ops_map[mesh_type]}
obj = bpy.context.active_object
obj.name = "{name}"
obj.location = {repr(loc)}
obj.rotation_euler = {repr(rot)}
obj.scale = {repr(scale)}
'''
        return self.run_code(code)

    def apply_material(self, obj_name: str, material_type: str = "principled",
                       color: tuple = (0.8, 0.8, 0.8, 1.0)) -> dict:
        """Apply material ke object."""
        mat_scripts = {
            "principled": f"""
mat = bpy.data.materials.new(name="{obj_name}_mat")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = {repr(color)}
"""
        }

        mat_script = mat_scripts.get(material_type, mat_scripts["principled"])
        code = f'''
import bpy
obj = bpy.data.objects.get("{obj_name}")
if obj is None:
    raise ValueError(f"Object '{obj_name}' tidak ditemukan")
{mat_script}
if obj.data.materials:
    obj.data.materials[0] = mat
else:
    obj.data.materials.append(mat)
'''
        return self.run_code(code)

    # ── Dispatch ──────────────────────────────────────────────

    def dispatch(self, action: str, cmd: dict) -> any:
        """Route action ke method yang sesuai."""
        handlers = {
            # ── Connection ──
            "ping": self._cmd_ping,
            "connect": self._cmd_connect,
            "disconnect": self._cmd_disconnect,
            "reconnect": self._cmd_reconnect,

            # ── Eksekusi ──
            "run_script": self._cmd_run_script,
            "exec_python": self._cmd_run_script,
            "eval": self._cmd_eval,
            "exec_code": self._cmd_run_script,

            # ── High-level ──
            "create_mesh": self._cmd_create_mesh,
            "apply_material": self._cmd_apply_material,
            "get_scene_info": self._cmd_get_scene_info,
            "clear_scene": self._cmd_clear_scene,
            "render_viewport": self._cmd_render_viewport,
            "export_model": self._cmd_export_model,
            "start_server": self._cmd_start_server,
            "stop_server": self._cmd_stop_server,
        }

        handler = handlers.get(action)
        if handler is None:
            raise ValueError(
                f"Action '{action}' tidak dikenal. "
                f"Yang tersedia: {', '.join(handlers.keys())}"
            )
        return handler(cmd)

    # ── Command handlers ──────────────────────────────────────

    def _cmd_ping(self, cmd):
        result = self.ping()
        return {
            "connected": result.get("pong", False),
            "blender_version": result.get("blender_version"),
            "objects_count": result.get("objects_count"),
        }

    def _cmd_connect(self, cmd):
        host = cmd.get("host", BLENDER_HOST)
        port = cmd.get("port", BLENDER_PORT)
        self.connect_to_blender(host, port)
        return {"status": "connected", "host": host, "port": port}

    def _cmd_disconnect(self, cmd):
        self.disconnect_from_blender()
        return {"status": "disconnected"}

    def _cmd_reconnect(self, cmd):
        self.reconnect()
        return {"status": "reconnected"}

    def _cmd_run_script(self, cmd):
        code = cmd.get("code", "") or cmd.get("script", "")
        if not code:
            raise ValueError("Parameter 'code' (atau 'script') wajib diisi")
        main_thread = cmd.get("main_thread", False)
        return self.run_code(code, main_thread)

    def _cmd_eval(self, cmd):
        expression = cmd.get("expression", "")
        if not expression:
            raise ValueError("Parameter 'expression' wajib diisi")
        return self.evaluate(expression)

    def _cmd_create_mesh(self, cmd):
        return self.create_mesh(
            mesh_type=cmd.get("mesh_type", "cube"),
            size=cmd.get("size"),
            radius=cmd.get("radius"),
            depth=cmd.get("depth"),
            segments=cmd.get("segments"),
            vertices=cmd.get("vertices"),
            location=cmd.get("location", (0, 0, 0)),
            rotation=cmd.get("rotation", (0, 0, 0)),
            scale=cmd.get("scale", (1, 1, 1)),
            name=cmd.get("name"),
        )

    def _cmd_apply_material(self, cmd):
        return self.apply_material(
            obj_name=cmd.get("obj_name", ""),
            material_type=cmd.get("material", "principled"),
            color=tuple(cmd.get("color", (0.8, 0.8, 0.8, 1.0))),
        )

    def _cmd_get_scene_info(self, cmd):
        return self.get_scene_info()

    def _cmd_clear_scene(self, cmd):
        code = '''
import bpy
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in bpy.data.meshes:
    bpy.data.meshes.remove(block)
for block in bpy.data.materials:
    bpy.data.materials.remove(block)
'''
        return self.run_code(code)

    def _cmd_render_viewport(self, cmd):
        filename = cmd.get("filename", "viewport_render")
        workspace = cmd.get("workspace", r"D:\VloraWorkspace\models")
        code = f'''
import bpy
import os
scene = bpy.context.scene
path = os.path.join(r"{workspace}", "{filename}.png")
scene.render.filepath = path
scene.render.image_settings.file_format = 'PNG'
scene.render.resolution_x = {cmd.get("resolution_x", 1920)}
scene.render.resolution_y = {cmd.get("resolution_y", 1080)}
bpy.ops.render.render(write_still=True)
print(f"Render saved: {{path}}")
'''
        return self.run_code(code)

    def _cmd_export_model(self, cmd):
        fmt = cmd.get("format", "blend")
        filename = cmd.get("filename", "exported_model")
        workspace = cmd.get("workspace", r"D:\VloraWorkspace\models")

        export_codes = {
            "obj": f'bpy.ops.wm.obj_export(filepath=os.path.join(r"{workspace}", "{filename}.obj"))',
            "fbx": f'bpy.ops.export_scene.fbx(filepath=os.path.join(r"{workspace}", "{filename}.fbx"))',
            "glb": f'bpy.ops.export_scene.gltf(filepath=os.path.join(r"{workspace}", "{filename}.glb"), export_format="GLB")',
            "stl": f'bpy.ops.wm.stl_export(filepath=os.path.join(r"{workspace}", "{filename}.stl"))',
            "blend": f'bpy.ops.wm.save_as_mainfile(filepath=os.path.join(r"{workspace}", "{filename}.blend"))',
        }

        if fmt not in export_codes:
            return {"success": False, "error": f"Format '{fmt}' tidak didukung"}

        code = f'''
import bpy, os
os.makedirs(r"{workspace}", exist_ok=True)
{export_codes[fmt]}
'''
        return self.run_code(code)

    def _cmd_start_server(self, cmd):
        """Kirim perintah ke Blender untuk start server (kalau belum jalan)."""
        host = cmd.get("host", BLENDER_HOST)
        port = cmd.get("port", BLENDER_PORT)

        # Path ke root project — diresolved dari lokasi file ini
        project_root = os.path.normpath(
            os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
        )

        code = f'''
import bpy
import sys

# Tambahkan project root ke path agar bisa import desktop.blender_socket_server
_project_root = r"{project_root}"
if _project_root not in sys.path:
    sys.path.append(_project_root)

from desktop.blender_socket_server import start_server
result = start_server(host="{host}", port={port})
print(f"[BRIDGE] start_server() returned: {{result}}")
'''
        return self.run_code(code)

    def _cmd_stop_server(self, cmd):
        """Suruh Blender matikan server."""
        return self.shutdown()

    # ── I/O — stdin/stdout bridge protocol ────────────────────

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
            "app": self.APP_NAME,
        })

    def send_success(self, result: any = None):
        self.send_response({
            "success": True,
            "result": result,
            "app": self.APP_NAME,
        })

    # ── Main loop ─────────────────────────────────────────────

    def connect(self):
        """Connect ke Blender — coba konek TCP."""
        try:
            self.connect_to_blender()
            return True
        except ConnectionError as e:
            self._log(f"⚠️  {e}")
            self._log("   Bridge tetap jalan — akan coba konek saat ada command.")
            return True  # Jangan gagal — biar retry pas pertama command

    def disconnect(self):
        self.disconnect_from_blender()

    def run_forever(self):
        """Main loop: baca command dari stdin → kirim ke Blender → response."""
        self._log("🧊 Blender Socket Bridge ready. Listening on stdin...")
        self.send_response({
            "ready": True,
            "app": self.APP_NAME,
            "host": BLENDER_HOST,
            "port": BLENDER_PORT,
            "message": "Bridge siap. Pastikan blender_socket_server.py sudah jalan di Blender!",
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
                    # Ping bridge dulu, lalu coba ping Blender
                    try:
                        blender_ping = self.ping()
                        self.send_success({
                            "bridge": "ok",
                            "blender": blender_ping.get("pong", False),
                            "blender_version": blender_ping.get("blender_version"),
                        })
                    except Exception:
                        self.send_success({
                            "bridge": "ok",
                            "blender": False,
                            "note": "Bridge siap tapi Blender belum terhubung. Jalankan blender_socket_server.py di Blender!",
                        })
                    continue

                if action == "disconnect":
                    self.disconnect_from_blender()
                    self.send_success({"status": "disconnected"})
                    continue

                if action == "reconnect":
                    self.reconnect()
                    self.send_success({"status": "reconnected"})
                    continue

                # ── Dispatch ──────────────────────────────────
                try:
                    # Auto-connect kalau belum
                    if not self._connected or not self._sock:
                        try:
                            self.connect_to_blender()
                        except ConnectionError:
                            # Masih gagal — kasih error jelas
                            self.send_error(
                                "Blender tidak terhubung.\n\n"
                                "📋 Cara konek:\n"
                                "1. Buka Blender\n"
                                "2. Buka tab Scripting → Text Editor\n"
                                "3. File → Open → pilih desktop/blender_socket_server.py\n"
                                "4. Run Script (Alt+P)\n"
                                "5. Cek console: '🧊 Blender Socket Server: ✅ OK → 127.0.0.1:9999'\n"
                                "6. Kirim command ini lagi!"
                            )
                            continue

                    result = self.dispatch(action, cmd)
                    self.send_success(result)

                except ConnectionError as e:
                    self._connected = False
                    self.send_error(
                        f"Koneksi ke Blender terputus: {e}\n"
                        f"Coba reconnect dengan action 'reconnect'."
                    )
                except TimeoutError as e:
                    self.send_error(
                        f"Timeout: {e}\n"
                        f"Blender mungkin sibuk. Coba lagi."
                    )
                except Exception as e:
                    self.send_error(str(e), traceback.format_exc())

            except EOFError:
                break
            except KeyboardInterrupt:
                break
            except Exception as e:
                self.send_error(f"Fatal bridge error: {e}", traceback.format_exc())
                break

        self._log("Blender Socket Bridge shutting down...")
        self.disconnect_from_blender()

    def _log(self, message):
        print(f"[{self.APP_NAME}] {message}", file=sys.stderr, flush=True)


# ═══════════════════════════════════════════════════════════════
# 🚀 MAIN — Entry point
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    bridge = BlenderSocketBridge(debug="--debug" in sys.argv)
    try:
        bridge.connect()
        bridge.run_forever()
    except Exception as e:
        bridge.send_error(f"Startup error: {e}", traceback.format_exc())
    finally:
        bridge.disconnect()
