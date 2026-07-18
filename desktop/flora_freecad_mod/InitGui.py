# 🌸 Flora Bridge — InitGui.py
# Berjalan saat FreeCAD GUI start — auto-start socket server
# Tanpa UI baru, silent di background
#
# NOTE: flora_help() dll ada di namespace Python Console FreeCAD.
#       Ketik:  flora_help()
#       Tanpa >>> di depannya.

import FreeCAD as App
import FreeCADGui as Gui
import sys
import os
import atexit
import __main__ as fcmain

# ── Path mod lokal ───────────────────────────────────────────
try:
    _MOD_DIR = os.path.dirname(os.path.abspath(__file__))
except NameError:
    # FreeCAD kadang tidak mendefinisikan __file__ saat load InitGui.py
    _MOD_DIR = r"C:\Users\Ka'Abid\AppData\Roaming\FreeCAD\Mod\FloraBridge"
if _MOD_DIR not in sys.path:
    sys.path.insert(0, _MOD_DIR)

_FLORA_SERVER = None

def _inject_flora_helpers():
    """Inject helper functions ke FreeCAD Python Console namespace.

    Strategi DUAL:
    1. builtins — PASTI diakses dari Python Console FreeCAD manapun
    2. __main__  — backup untuk standard Python scope
    """
    try:
        import FloraWorkbench as _fw

        # Panggil register helpers — fungsinya sudah handle builtins + __main__
        _fw._register_console_helpers()

        App.Console.PrintLog("🌸 Flora Bridge: Helpers injected via FloraWorkbench\n")
    except Exception as e:
        App.Console.PrintLog(f"🌸 Flora Bridge: Helper injection FAILED - {e}\n")

def _start_flora_server():
    """Start FreeCAD socket server di background (non-blocking).

    Menggunakan importlib agar bisa load file freecad_socket_server.py
    yang sudah di-copy ke mod folder FloraBridge/ saat install.
    """
    global _FLORA_SERVER
    try:
        import importlib.util
        _server_path = os.path.join(_MOD_DIR, "freecad_socket_server.py")
        if not os.path.isfile(_server_path):
            App.Console.PrintLog(
                f"🌸 Flora Bridge: Server file tidak ditemukan di {_server_path}\n"
            )
            return

        spec = importlib.util.spec_from_file_location(
            "freecad_socket_server_mod", _server_path
        )
        srv = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(srv)

        import threading
        server_thread = threading.Thread(target=srv.run_server, daemon=True)
        server_thread.start()
        _FLORA_SERVER = server_thread

        App.Console.PrintLog("🌸 Flora Bridge: Socket server started on :9998\n")
    except Exception as e:
        App.Console.PrintLog(f"🌸 Flora Bridge: Failed to start server - {e}\n")

def _stop_flora_server():
    """Cleanup saat FreeCAD ditutup."""
    global _FLORA_SERVER
    if _FLORA_SERVER:
        App.Console.PrintLog("🌸 Flora Bridge: Shutting down\n")
        _FLORA_SERVER = None

# ── Daftarkan cleanup ───────────────────────────────────────
atexit.register(_stop_flora_server)

# ── Start & Inject ──────────────────────────────────────────
if App.GuiUp:
    import PySide.QtCore as QtCore

    # 🔥 SEGERA inject helpers — gak perlu nunggu timer!
    #   flora_help(), flora_scene(), dll langsung tersedia di Python Console.
    _inject_flora_helpers()

    # Timer 1 detik — start socket server setelah FreeCAD fully loaded
    QtCore.QTimer.singleShot(1000, _start_flora_server)
    
    # Timer 2 detik — buka Flora Panel (QDockWidget)
    def _open_panel():
        try:
            import FloraPanel
            FloraPanel.create_flora_panel()
            App.Console.PrintLog("🌸 Flora Panel: Auto-opened\n")
        except ImportError as e:
            App.Console.PrintLog(f"🌸 Flora Panel: Import gagal - {e}\n")
        except Exception as e:
            App.Console.PrintLog(f"🌸 Flora Panel: Gagal buka - {e}\n")
    
    QtCore.QTimer.singleShot(2000, _open_panel)

App.Console.PrintLog("🌸 Flora Bridge loaded. Socket server will start automatically.\n")
App.Console.PrintLog("🌸 Interact via Python Console. Type:  flora_help()  (no >>> prefix)\n")
