"""
office_base.py — Base class for Microsoft Office COM Automation.
Semua bridge (Word, Excel, PowerPoint) inherit dari sini.
"""

import sys
import json
import traceback
import importlib.util
import os


def is_windows():
    """Cek apakah OS adalah Windows."""
    return sys.platform == 'win32' or sys.platform == 'win64'


def require_office():
    """Import win32com.client — fail gracefully kalau tidak ada."""
    if not is_windows():
        raise OSError(
            "Microsoft Office COM Automation hanya tersedia di Windows. "
            "Sistem operasi saat ini: " + sys.platform
        )
    try:
        import win32com.client
        return win32com.client
    except ImportError:
        raise ImportError(
            "pywin32 tidak terinstall. Jalankan:\n"
            "  pip install pywin32\n"
            "Atau: pip install -r desktop/requirements.txt"
        )


class OfficeBridge:
    """Base class untuk bridge Office.

    Setiap bridge subclass harus implement:
      - APP_NAME         : str  → 'Word.Application', 'Excel.Application', dll
      - ensure_running()        → connect atau buka aplikasi
      - dispatch(action)        → route action ke method yang sesuai
    """

    APP_NAME = None  # Override di subclass

    def __init__(self, debug=False):
        self.debug = debug
        self.com = None  # win32com.client module
        self.app = None  # Aplikasi COM (Word.Application, dll)
        self._connected = False

    # ── Connection ────────────────────────────────────────────────

    def connect(self):
        """Connect ke aplikasi Office yang sedang berjalan, atau buka baru."""
        if self._connected and self.app:
            return True

        self.com = require_office()
        self.app = self._get_or_create_app()
        self._connected = True
        return True

    def _get_or_create_app(self):
        """Coba dapetin yang running, fallback ke yang baru."""
        try:
            # GetActiveObject: ambil instance yang sedang berjalan
            app = self.com.GetActiveObject(self.APP_NAME)
            if self.debug:
                self._log(f"Connected to running {self.APP_NAME}")
            return app
        except Exception:
            # Kalau tidak ada yang running, buka baru (tidak visible)
            app = self.com.Dispatch(self.APP_NAME)
            app.Visible = True  # Biar user bisa lihat
            if self.debug:
                self._log(f"Opened new {self.APP_NAME}")
            return app

    def disconnect(self):
        """Disconnect — jangan quit biar user masih bisa pakai."""
        self.app = None
        self._connected = False
        if self.debug:
            self._log("Disconnected")

    def quit(self):
        """Tutup aplikasi Office — hati-hati, ini force quit."""
        if self.app:
            try:
                self.app.Quit()
            except Exception:
                pass
        self.disconnect()

    # ── I/O — komunikasi stdin/stdout ─────────────────────────────

    def read_command(self) -> dict:
        """Baca satu baris JSON dari stdin."""
        line = sys.stdin.readline().strip()
        if not line:
            return None
        try:
            return json.loads(line)
        except json.JSONDecodeError as e:
            return {"error": f"Invalid JSON: {e}", "raw": line}

    def send_response(self, data: dict):
        """Kirim JSON response ke stdout (satu baris)."""
        response = json.dumps(data, ensure_ascii=False, default=str)
        sys.stdout.write(response + "\n")
        sys.stdout.flush()

    def send_error(self, message: str, details: str = ""):
        """Kirim error response."""
        self.send_response({
            "success": False,
            "error": message,
            "details": details,
            "app": self.APP_NAME
        })

    def send_success(self, result: any = None):
        """Kirim success response."""
        self.send_response({
            "success": True,
            "result": result,
            "app": self.APP_NAME
        })

    # ── Main loop ─────────────────────────────────────────────────

    def run_forever(self):
        """Loop baca command dari stdin, eksekusi, kirim response."""
        self._log(f"{self.APP_NAME} bridge ready. Listening on stdin...")
        self.send_response({
            "ready": True,
            "app": self.APP_NAME,
            "platform": sys.platform
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
                    self.send_success({"pong": True})
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

                # ── Dispatch ke action handler ─────────────────
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

        self._log("Bridge shutting down...")

    # ── Abstract ──────────────────────────────────────────────────

    def dispatch(self, action: str, cmd: dict) -> any:
        """Route action ke method yang sesuai. Override di subclass."""
        raise NotImplementedError(
            f"Subclass harus implement dispatch(). "
            f"Action diterima: {action}"
        )

    # ── Helpers ───────────────────────────────────────────────────

    def _log(self, message: str):
        """Log ke stderr (tidak mengganggu stdout JSON)."""
        print(f"[{self.APP_NAME}] {message}", file=sys.stderr, flush=True)

    def _ensure_active_document(self):
        """Pastikan ada dokumen aktif. Override di subclass spesifik."""
        raise NotImplementedError
