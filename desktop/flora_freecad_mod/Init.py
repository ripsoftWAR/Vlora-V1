# 🌸 Flora Bridge — Init.py
# Berjalan saat FreeCAD start (bahkan dalam mode console/headless)
# Mod sudah self-contained — semua file ada di direktori yang sama.

import sys
import os

# Tambahkan direktori mod ke sys.path agar import lokal berfungsi
try:
    _MOD_DIR = os.path.dirname(os.path.abspath(__file__))
except NameError:
    # FreeCAD kadang tidak mendefinisikan __file__ saat load Init.py
    _MOD_DIR = r"C:\Users\Ka'Abid\AppData\Roaming\FreeCAD\Mod\FloraBridge"
if _MOD_DIR not in sys.path:
    sys.path.insert(0, _MOD_DIR)
