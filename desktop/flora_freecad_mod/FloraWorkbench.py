# 🌸 Flora Workbench — FreeCAD Workbench Integration
#
# Workbench minimalis: TANPA toolbar, TANPA panel baru.
# Hanya menyediakan helper functions untuk Python Console.
#
# Cara pakai di Python Console FreeCAD:
#   >>> flora_help()
#   >>> flora_scene()       # lihat info scene
#   >>> flora_send("code")  # kirim kode langsung

import FreeCAD as App
import FreeCADGui as Gui
import sys
import os
import json
import builtins

# ── Inject helpers ke builtins agar selalu tersedia ─────────
# FreeCAD Python Console pakai namespace sendiri, bukan __main__.
# builtins adalah satu-satunya namespace yang diakses dari MANA PUN.
def _register_console_helpers():
    """Daftarkan flora_* functions ke builtins."""
    import __main__ as _fcmain
    _helpers = {}

    # Semua fungsi yang akan didaftarkan
    _helpers["flora_help"] = lambda: print(HELP_TEXT)
    _helpers["flora_scene"] = _scene_info
    _helpers["flora_ping"] = _ping_check
    _helpers["flora_send"] = _send_code

    # Tambahkan fungsi panel
    _helpers["flora_panel"] = _ensure_panel
    _helpers["flora_panel_toggle"] = lambda: (
        _ensure_panel().hide() if _ensure_panel() and _ensure_panel().isVisible()
        else _ensure_panel()
    )

    # Inject ke builtins (PASTI bisa diakses dari Python Console)
    for name, func in _helpers.items():
        builtins.__dict__[name] = func

    # Juga inject ke __main__ sebagai backup
    try:
        for name, func in _helpers.items():
            _fcmain.__dict__[name] = func
    except:
        pass

    App.Console.PrintLog("🌸 Flora helpers registered (builtins + __main__)\n")

# ── Panel ─────────────────────────────────────────────────
def _ensure_panel():
    """Pastikan Flora Panel sudah terbuka (create jika belum)."""
    try:
        from FloraPanel import create_flora_panel, _panel_instance
        if _panel_instance is None:
            create_flora_panel()
            App.Console.PrintLog("🌸 Flora Panel: Created\n")
        else:
            _panel_instance.show()
            _panel_instance.raise_()
        return _panel_instance
    except Exception as e:
        App.Console.PrintLog(f"🌸 Flora Panel: Gagal create - {e}\n")
        return None

# ── Fungsi-fungsi helper ──────────────────────────────────

def _get_socket_status():
    """Cek apakah socket server berjalan."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.5)
        s.connect(("127.0.0.1", 9998))
        s.close()
        return True
    except:
        return False

HELP_TEXT = """
🌸 Flora Bridge — Help
=======================
Socket status: {status}

Perintah Python Console:
  flora_help()       — tampilkan help ini
  flora_scene()      — info semua object di scene
  flora_send(code)   — kirim kode Python ke Flora
  flora_ping()       — test koneksi ke Flora

Koneksi otomatis via port :9998.
Flora bisa melihat scene dan mengirim perintah kapan saja.

Contoh:
  >>> flora_scene()
  >>> App.Console.PrintLog(FreeCAD.listDocuments())
"""

def _scene_info():
    """Tampilkan info semua object di scene aktif."""
    docs = App.listDocuments()
    if not docs:
        print("🌸 Tidak ada document terbuka.")
        return
    for name, doc in docs.items():
        print(f"\n📄 Document: {name}")
        objs = doc.Objects
        if not objs:
            print("   (kosong)")
        for obj in objs:
            print(f"   🧊 {obj.Name} ({obj.TypeId})")

def _ping_check():
    """Test koneksi ke Flora Agent."""
    status = _get_socket_status()
    if status:
        print("🌸 ✅ Flora terhubung! Port :9998 aktif.")
    else:
        print("🌸 ⏳ Flora belum terhubung. Pastikan server sudah start.")
        print("   Server auto-start dalam beberapa detik setelah FreeCAD buka.")

def _send_code(code):
    """Kirim kode Python langsung ke Flora (via socket :9998)."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(5)
        s.connect(("127.0.0.1", 9998))
        cmd = json.dumps({"action": "run_script", "code": code})
        s.sendall(cmd.encode())
        s.shutdown(socket.SHUT_WR)
        resp = b""
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            resp += chunk
        s.close()
        result = json.loads(resp.decode())
        print(f"🌸 Response: {json.dumps(result, indent=2)}")
    except Exception as e:
        print(f"🌸 Error: {e}")

# ── Nama workbench ─────────────────────────────────────────
class FloraWorkbench(Gui.Workbench):
    """Flora AI Bridge — Ghost Engineer untuk FreeCAD.

    Workbench tanpa UI. Semua interaksi via Python Console.
    Socket server otomatis jalan di background port :9998.
    """
    MenuText = "Flora Bridge"
    ToolTip = "Flora AI Ghost Engineer Bridge"
    Icon = None  # no icon needed

    def Initialize(self):
        """Dipanggil saat workbench diaktifkan."""
        App.Console.PrintLog("🌸 Flora Bridge workbench initialized\n")
        # 🔥 Daftarkan helper functions ke console saat workbench diaktifkan
        _register_console_helpers()
        # 🔥 Buka panel (delay biar FreeCAD selesai loading)
        try:
            from PySide import QtCore
            QtCore.QTimer.singleShot(800, _ensure_panel)
        except:
            pass

    def GetClassName(self):
        return "Gui::PythonWorkbench"

# ── Helper functions untuk Python Console ──────────────────

def _get_flora_socket():
    """Cek apakah socket server berjalan."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.5)
        s.connect(("127.0.0.1", 9998))
        s.close()
        return True
    except:
        return False

def flora_help():
    """Tampilkan perintah Flora yang tersedia."""
    print("""
🌸 Flora Bridge — Help
=======================
Socket status: {status}

Perintah Python Console:
  flora_help()       — tampilkan help ini
  flora_scene()      — info semua object di scene
  flora_send(code)   — kirim kode Python ke Flora
  flora_ping()       — test koneksi ke Flora
  flora_doc(name)    — buka/model document baru

Koneksi otomatis via port :9998.
Flora bisa melihat scene dan mengirim perintah kapan saja.

Contoh:
  >>> flora_scene()
  >>> App.Console.PrintLog(FreeCAD.listDocuments())
""".format(status="✅ AKTIF" if _get_flora_socket() else "⏳ Menunggu Flora..."))

def flora_scene():
    """Tampilkan info semua object di scene aktif."""
    docs = App.listDocuments()
    if not docs:
        print("🌸 Tidak ada document terbuka.")
        return
    for name, doc in docs.items():
        print(f"\n📄 Document: {name}")
        objs = doc.Objects
        if not objs:
            print("   (kosong)")
        for obj in objs:
            print(f"   🧊 {obj.Name} ({obj.TypeId})")

def flora_ping():
    """Test koneksi ke Flora Agent."""
    status = _get_flora_socket()
    if status:
        print("🌸 ✅ Flora terhubung! Port :9998 aktif.")
    else:
        print("🌸 ⏳ Flora belum terhubung. Pastikan server sudah start.")
        print("   Server auto-start dalam beberapa detik setelah FreeCAD buka.")

def flora_send(code):
    """Kirim kode Python langsung ke Flora (via socket :9998)."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(5)
        s.connect(("127.0.0.1", 9998))
        cmd = json.dumps({"action": "run_script", "code": code})
        s.sendall(cmd.encode())
        s.shutdown(socket.SHUT_WR)
        resp = b""
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            resp += chunk
        s.close()
        result = json.loads(resp.decode())
        print(f"🌸 Response: {json.dumps(result, indent=2)}")
    except Exception as e:
        print(f"🌸 Error: {e}")

# ── Register workbench ──────────────────────────────────────
Gui.addWorkbench(FloraWorkbench())

App.Console.PrintLog("🌸 Flora workbench registered. Type flora_help() for commands.\n")
