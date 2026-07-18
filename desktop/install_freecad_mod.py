"""
Flora Bridge Installer for FreeCAD Workbench

Menyalin file workbench ke direktori Mod FreeCAD.
Cara pakai:
  python desktop/install_freecad_mod.py
"""

import sys
import os
import shutil

FLORA_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD_SRC = os.path.join(FLORA_ROOT, "desktop", "flora_freecad_mod")

def find_freecad_mod_dir():
    """Cari direktori Mod FreeCAD."""
    appdata = os.environ.get("APPDATA", "")
    candidates = [
        os.path.join(appdata, "FreeCAD", "Mod"),
        os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "FreeCAD", "Mod"),
        os.path.join(os.path.expanduser("~"), ".FreeCAD", "Mod"),
        "C:\\Program Files\\FreeCAD\\Mod",
        "C:\\Program Files (x86)\\FreeCAD\\Mod",
    ]

    for candidate in candidates:
        if os.path.isdir(candidate) or os.path.exists(os.path.dirname(candidate)):
            return candidate

    default = os.path.join(appdata, "FreeCAD", "Mod") if appdata else os.path.join(os.path.expanduser("~"), "FreeCAD", "Mod")
    os.makedirs(default, exist_ok=True)
    return default


def install():
    dest_dir = find_freecad_mod_dir()
    target = os.path.join(dest_dir, "FloraBridge")

    print("[Flora Bridge Installer]")
    print(f"Target: {target}")

    if os.path.isdir(target):
        print(f"[WARNING] Folder already exists: {target}")
        # Auto-overwrite jika ada arg --force, atau jika stdin bukan terminal
        force = "--force" in sys.argv
        if not force:
            try:
                ans = input("  Overwrite? (y/n): ").strip().lower()
                if ans != "y":
                    print("[CANCELLED]")
                    return
            except (EOFError, OSError):
                # Non-interactive — default: overwrite
                pass
        shutil.rmtree(target)

    # 1. Copy workbench files (Init.py, InitGui.py, FloraWorkbench.py)
    shutil.copytree(MOD_SRC, target)
    
    # 2. Copy socket server agar mod benar-benar self-contained
    socket_server_src = os.path.join(FLORA_ROOT, "desktop", "freecad_socket_server.py")
    socket_server_dst = os.path.join(target, "freecad_socket_server.py")
    if os.path.isfile(socket_server_src):
        shutil.copy2(socket_server_src, socket_server_dst)
        print(f"   + socket server co-pied")
    else:
        print(f"   ! WARNING: {socket_server_src} tidak ditemukan")
    
    print(f"[OK] Installed to: {target}")
    print()
    print("Files installed:")
    for f in sorted(os.listdir(target)):
        print(f"   - {f}")
    print()
    print("Restart FreeCAD!")
    print("Workbench 'Flora Bridge' available in Workbench dropdown.")
    print()
    print("In FreeCAD Python Console, type:")
    print("   >>> flora_help()")


if __name__ == "__main__":
    install()
