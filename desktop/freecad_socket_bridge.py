"""
freecad_socket_bridge.py — 🧊 FreeCAD Live Socket Bridge (Client Side)
=======================================================================

Bridge yang berjalan sebagai child process dari Node.js (desktop.js).
Menghubungkan agent Flora dengan FreeCAD yang sedang berjalan via TCP socket.

Arsitektur:
  Flora Agent → tools.js → desktop.js (Node.js)
    → stdin/stdout JSON
      → freecad_socket_bridge.py (Python child process)
        → TCP socket :9998
          → freecad_socket_server.py (RUNS INSIDE FREECAD)
            → exec() kode Python di FreeCAD context

Mode operasi:
  - Live: FreeCAD sudah terbuka, server sudah jalan → konek via TCP :9998
  - Retry: Coba reconnect otomatis jika FreeCAD mati/hang
  - Eval: Evaluasi expression cepat (bukan full exec)

Contoh command via stdin:
  {"action": "run_script", "code": "import FreeCAD; doc=FreeCAD.newDocument(); doc.addObject('Part::Box','Box')"}
  {"action": "ping"}
  {"action": "eval", "expression": "len(FreeCAD.listDocuments())"}
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

FREECAD_HOST = "127.0.0.1"
FREECAD_PORT = 9998
CONNECT_TIMEOUT = 5      # detik timeout koneksi awal
RESPONSE_TIMEOUT = 120   # detik timeout menunggu response dari FreeCAD
RECONNECT_DELAY = 1.0    # detik delay sebelum reconnect


# ═══════════════════════════════════════════════════════════════
# 🧩 FreeCADSocketBridge — Client yang konek ke FreeCAD via TCP
# ═══════════════════════════════════════════════════════════════

class FreeCADSocketBridge:
    """Bridge Agent → FreeCAD via TCP socket (live connection).

    Bridge ini berjalan sebagai subprocess Python, komunikasi dengan
    Node.js via stdin/stdout JSON (sama seperti word_bridge).
    Node.js kirim command → bridge kirim ke FreeCAD via TCP → balikin hasil.
    """

    APP_NAME = "FreeCADSocket"

    def __init__(self, debug=False):
        self.debug = debug
        self.sock = None
        self._cmd_id = 0
        self._last_cmd_id = ""

    # ── Connection Management ─────────────────────────────────────

    def connect(self):
        """Konek ke FreeCAD socket server via TCP."""
        if self.sock:
            try:
                self.sock.close()
            except:
                pass

        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.settimeout(CONNECT_TIMEOUT)

        try:
            self.sock.connect((FREECAD_HOST, FREECAD_PORT))
            self._log(f"✅ Terkoneksi ke FreeCAD di {FREECAD_HOST}:{FREECAD_PORT}")
            return True
        except (ConnectionRefusedError, TimeoutError, OSError) as e:
            self.sock = None
            raise ConnectionError(
                f"Tidak bisa konek ke FreeCAD di {FREECAD_HOST}:{FREECAD_PORT}.\n\n"
                f"🔌 **Cara konek FreeCAD Live:**\n"
                f"1. Buka FreeCAD\n"
                f"2. Buka menu **Macro → Macros...**\n"
                f"3. Klik **Create**, beri nama 'freecad_socket_server'\n"
                f"4. Paste isi dari file `desktop/freecad_socket_server.py`\n"
                f"5. Simpan, lalu **Execute**\n"
                f"6. Cek console FreeCAD: '🧊 FreeCAD Socket Server AKTIF!'\n\n"
                f"📋 Atau jalankan dari Python Console FreeCAD:\n"
                f"  exec(open(r'D:\\\\downloads\\\\Vlora-V1\\\\desktop\\\\freecad_socket_server.py').read())\n\n"
                f"Error: {e}"
            )

    def disconnect(self):
        """Putus koneksi TCP."""
        if self.sock:
            try:
                self.sock.close()
            except:
                pass
            self.sock = None
            self._log("Disconnected from FreeCAD")

    def reconnect(self):
        """Coba reconnect dengan delay."""
        self.disconnect()
        time.sleep(RECONNECT_DELAY)
        return self.connect()

    def ensure_connected(self):
        """Pastikan koneksi aktif. Reconnect jika perlu."""
        if self.sock is None:
            return self.connect()
        try:
            # Test koneksi dengan kirim ping
            self.sock.settimeout(2)
            self.sock.sendall(json.dumps({"action": "ping"}).encode() + b'\n')
            response = self.sock.recv(4096)
            self.sock.settimeout(RESPONSE_TIMEOUT)
            return True
        except (socket.timeout, ConnectionResetError, BrokenPipeError, OSError) as e:
            self._log(f"Koneksi putus: {e}. Mencoba reconnect...")
            return self.reconnect()
        except Exception as e:
            self._log(f"Unexpected error di ensure_connected: {e}")
            self.disconnect()
            return self.reconnect()

    # ── Send Command & Receive Response ──────────────────────────

    def send_command(self, command: dict) -> dict:
        """Kirim command ke FreeCAD dan tunggu response."""
        try:
            self.ensure_connected()
        except Exception as e:
            return {"success": False, "error": f"Gagal konek ke FreeCAD: {e}"}

        if self.sock is None:
            return {"success": False, "error": "Socket tidak tersedia setelah ensure_connected"}

        payload = json.dumps(command) + '\n'
        self.sock.settimeout(RESPONSE_TIMEOUT)

        try:
            self.sock.sendall(payload.encode())
        except (BrokenPipeError, ConnectionResetError, OSError) as e:
            self.disconnect()
            return {"success": False, "error": f"Koneksi terputus saat kirim: {e}"}
        except Exception as e:
            self.disconnect()
            return {"success": False, "error": f"Error kirim data: {e}"}

        # Baca response
        try:
            response_data = self.sock.recv(65536).decode().strip()
            if not response_data:
                return {"success": False, "error": "Response kosong dari FreeCAD"}

            return json.loads(response_data)
        except socket.timeout:
            return {"success": False, "error": "Timeout menunggu response dari FreeCAD"}
        except json.JSONDecodeError as e:
            return {"success": False, "error": f"Response invalid: {e}", "raw": response_data}
        except Exception as e:
            return {"success": False, "error": f"Error baca response: {e}"}

    # ── Action Handlers ──────────────────────────────────────────

    def handle_ping(self, cmd):
        return self.send_command({"action": "ping"})

    def handle_run_script(self, cmd):
        code = cmd.get("code", "")
        if not code:
            return {"success": False, "error": "Parameter 'code' wajib diisi"}
        return self.send_command({
            "action": "run_script",
            "code": code,
        })

    def handle_eval(self, cmd):
        expression = cmd.get("expression", "")
        if not expression:
            return {"success": False, "error": "Parameter 'expression' wajib diisi"}
        return self.send_command({
            "action": "eval",
            "expression": expression,
        })

    def handle_get_scene_info(self, cmd):
        return self.send_command({"action": "get_scene_info"})

    def handle_create_mesh(self, cmd):
        return self.send_command({
            "action": "create_mesh",
            "mesh_type": cmd.get("mesh_type", "box"),
            "size": cmd.get("size"),
            "radius": cmd.get("radius"),
            "depth": cmd.get("depth"),
            "location": cmd.get("location", [0, 0, 0]),
            "name": cmd.get("name", ""),
        })

    def handle_clear_scene(self, cmd):
        return self.send_command({"action": "clear_scene"})

    def handle_export_model(self, cmd):
        return self.send_command({
            "action": "export_model",
            "format": cmd.get("format", "step"),
            "filename": cmd.get("filename", "live_export"),
        })

    # ── Dispatch ──────────────────────────────────────────────────

    def dispatch(self, action: str, cmd: dict) -> dict:
        handlers = {
            "ping": self.handle_ping,
            "run_script": self.handle_run_script,
            "exec_code": self.handle_run_script,
            "eval": self.handle_eval,
            "get_scene_info": self.handle_get_scene_info,
            "create_mesh": self.handle_create_mesh,
            "clear_scene": self.handle_clear_scene,
            "export_model": self.handle_export_model,
        }
        handler = handlers.get(action)
        if handler is None:
            return {"success": False, "error": f"Action '{action}' tidak dikenal"}
        return handler(cmd)

    # ── I/O — stdin/stdout bridge protocol ───────────────────────

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
            "app": "FreeCADSocket",
        })

    def send_success(self, result: any = None):
        self.send_response({
            "success": True,
            "result": result,
            "app": "FreeCADSocket",
        })

    def run_forever(self):
        """Main loop: baca command dari stdin → kirim ke FreeCAD → kirim response."""
        self._log("FreeCAD Socket bridge ready. Listening on stdin...")
        self.send_response({
            "ready": True,
            "app": "FreeCADSocket",
            "platform": sys.platform,
        })

        consecutive_errors = 0
        max_consecutive_errors = 5

        while True:
            try:
                cmd = self.read_command()
                if cmd is None:
                    consecutive_errors += 1
                    if consecutive_errors > max_consecutive_errors:
                        self._log("Too many empty reads, shutting down...")
                        break
                    continue

                consecutive_errors = 0  # reset on success
                action = cmd.get("action", "")

                if action == "exit" or action == "quit":
                    self.send_success({"status": "bye"})
                    break

                if action == "ping":
                    try:
                        result = self.handle_ping(cmd)
                        self.send_success(result)
                    except ConnectionError as e:
                        self.send_error(str(e))
                    continue

                # ── Dispatch ──────────────────────────────────
                try:
                    result = self.dispatch(action, cmd)
                    self.send_success(result)
                except ConnectionError as e:
                    self.send_error(str(e))
                except Exception as e:
                    self.send_error(str(e), traceback.format_exc())

            except EOFError:
                self._log("EOFError — stdin closed")
                break
            except KeyboardInterrupt:
                self._log("KeyboardInterrupt — shutting down")
                break
            except Exception as e:
                self._log(f"Fatal bridge error: {e}")
                self.send_error(f"Fatal bridge error: {e}", traceback.format_exc())
                break

        self._log("FreeCAD Socket bridge shutting down...")
        self.disconnect()

    def _log(self, message):
        print(f"[FreeCADSocketBridge] {message}", file=sys.stderr, flush=True)


# ═══════════════════════════════════════════════════════════════
# 🚀 MAIN — Entry point
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    bridge = FreeCADSocketBridge(debug="--debug" in sys.argv)
    try:
        bridge.run_forever()
    except Exception as e:
        bridge.send_error(f"Startup error: {e}", traceback.format_exc())
