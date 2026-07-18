"""
freecad_socket_server.py — FreeCAD Socket Server v2 (NO-THREAD, SELECT-BASED)
============================================================================

CARA PAKAI (Pilih salah satu):
  1. Di Python Console FreeCAD:
     exec(open(r"D:\\downloads\\Vlora-V1\\desktop\\freecad_socket_server.py", encoding="utf-8").read())

  2. Via Macro:
     - Macro > Macros... > Create > Beri nama "freecad_socket_server"
     - Paste isi file ini > Execute

CARA KERJA:
  - Server TCP di port 9998
  - SELECT-based (single thread, non-blocking)
  - Terima JSON command dari Flora Agent
  - Eksekusi kode Python di FreeCAD context
  - Kirim response JSON balik

PERBEDAAN DARI V1:
  ❌ Tidak pakai threading (sering silent-fail di FreeCAD embedded Python)
  ✅ Single-thread select() loop — lebih stabil
  ✅ Flush stdout setiap print agar terlihat di console FreeCAD
  ✅ Auto-restart port jika masih terpakai
"""

import FreeCAD as App
import FreeCADGui as Gui
import Part
import Mesh
import MeshPart
import Import
import sys
import os
import json
import socket

import traceback
import math
from math import radians, degrees

# ── Konfigurasi ──────────────────────────────────────────────
HOST = "127.0.0.1"
PORT = 9998
WORKSPACE_DIR = os.path.join(os.path.expanduser("~"), "VloraWorkspace", "models")

# ── Namespace untuk exec() ───────────────────────────────────
GLOBALS_SCOPE = {
    "App": App, "Gui": Gui, "FreeCAD": App,
    "Part": Part, "Mesh": Mesh, "MeshPart": MeshPart,
    "Import": Import,
    "os": os, "json": json, "math": math,
    "radians": radians, "degrees": degrees,
    "Vector": App.Vector, "Matrix": App.Matrix, "Rotation": App.Rotation,
    "Placement": App.Placement, "time": __import__("time"),
}

# ── Print helper (flush agar kelihatan di FreeCAD console) ───
def _p(*args, **kw):
    print(*args, **kw)
    sys.stdout.flush()

# ── Build helper functions ──────────────────────────────────
_HELPERS_CODE = """
def _get_doc(name="FloraModel"):
    docs = App.listDocuments()
    if docs:
        for d in docs.values():
            return d
    return App.newDocument(name)

def new_scene(name="FloraModel"):
    for d in list(App.listDocuments().values()):
        App.closeDocument(d.Name)
    return App.newDocument(name)

def add_box(l=10, w=10, h=10, name="Box", pos=(0,0,0)):
    doc = _get_doc()
    o = doc.addObject("Part::Box", name)
    o.Length, o.Width, o.Height = l, w, h
    o.Placement.Base = App.Vector(*pos)
    doc.recompute()
    return o

def add_cyl(r=5, h=10, name="Cyl", pos=(0,0,0)):
    doc = _get_doc()
    o = doc.addObject("Part::Cylinder", name)
    o.Radius, o.Height = r, h
    o.Placement.Base = App.Vector(*pos)
    doc.recompute()
    return o

def add_sph(r=5, name="Sphere", pos=(0,0,0)):
    doc = _get_doc()
    o = doc.addObject("Part::Sphere", name)
    o.Radius = r
    o.Placement.Base = App.Vector(*pos)
    doc.recompute()
    return o

def boolean_cut(base_name, tool_name, result="Cut"):
    doc = _get_doc()
    b = doc.getObject(base_name)
    t = doc.getObject(tool_name)
    o = doc.addObject("Part::Cut", result)
    o.Base, o.Tool = b, t
    doc.recompute()
    return o

def fuse_all(names, result="Fused"):
    doc = _get_doc()
    objs = [doc.getObject(n) for n in names if doc.getObject(n)]
    if len(objs) == 0: return None
    if len(objs) == 1: return objs[0]
    o = doc.addObject("Part::MultiFuse", result)
    o.Shapes = objs
    doc.recompute()
    return o

def scene_info():
    info = {"documents": []}
    for name, doc in App.listDocuments().items():
        di = {"name": name, "objects": []}
        for obj in doc.Objects:
            oi = {"name": obj.Name, "label": obj.Label, "type": obj.TypeId}
            if hasattr(obj, "Shape") and obj.Shape:
                try:
                    bb = obj.Shape.BoundBox
                    oi["bbox"] = {"x":bb.XLength,"y":bb.YLength,"z":bb.ZLength}
                    oi["volume"] = obj.Shape.Volume
                except: pass
            di["objects"].append(oi)
        info["documents"].append(di)
    return info

def export_stl(path):
    doc = _get_doc()
    m = Mesh.Mesh()
    for o in doc.Objects:
        if hasattr(o,"Shape") and o.Shape:
            try:
                m2 = MeshPart.meshFromShape(Shape=o.Shape, LinearDeflection=0.5)
                m.addMesh(m2)
            except: pass
    if m.Facets:
        m.write(path)
    return path

def export_step(path):
    doc = _get_doc()
    Import.export(doc.Objects, path)
    return path
"""

# ── Process a single command ─────────────────────────────────
def process_command(cmd):
    action = cmd.get("action", "")
    _p(f"[FreeCAD] Action: {action}")
    
    try:
        if action == "ping":
            return {"success": True, "pong": True, "app": "FreeCAD",
                    "documents": len(App.listDocuments())}
        
        elif action in ("run_script", "exec_code"):
            code = cmd.get("code", "")
            if not code:
                return {"success": False, "error": "Parameter 'code' wajib diisi"}
            ns = dict(GLOBALS_SCOPE)
            try:
                exec(_HELPERS_CODE, ns)
                exec(code, ns)
                # Auto-recompute
                for d in App.listDocuments().values():
                    d.recompute()
                return {"success": True, "result": "ok"}
            except Exception as e:
                return {"success": False, "error": str(e), "traceback": traceback.format_exc()}
        
        elif action == "eval":
            expr = cmd.get("expression", "")
            if not expr:
                return {"success": False, "error": "Parameter 'expression' wajib diisi"}
            ns = dict(GLOBALS_SCOPE)
            try:
                exec(_HELPERS_CODE, ns)
                val = eval(expr, ns)
                return {"success": True, "value": str(val)}
            except Exception as e:
                return {"success": False, "error": str(e)}
        
        elif action == "get_scene_info":
            ns = dict(GLOBALS_SCOPE)
            exec(_HELPERS_CODE, ns)
            si = ns["scene_info"]()
            return {"success": True, "scene": si}
        
        elif action == "create_mesh":
            mt = cmd.get("mesh_type", "box")
            loc = cmd.get("location", [0,0,0])
            name = cmd.get("name", "m")
            ns = dict(GLOBALS_SCOPE)
            exec(_HELPERS_CODE, ns)
            if mt == "box":
                s = cmd.get("size", 10)
                ns["add_box"](l=s, w=s, h=s, name=name, pos=tuple(loc))
            elif mt == "cylinder":
                r = cmd.get("radius", 5)
                h = cmd.get("depth", 10)
                ns["add_cyl"](r=r, h=h, name=name, pos=tuple(loc))
            elif mt == "sphere":
                r = cmd.get("radius", 5)
                ns["add_sph"](r=r, name=name, pos=tuple(loc))
            else:
                return {"success": False, "error": f"Unknown mesh: {mt}"}
            for d in App.listDocuments().values():
                d.recompute()
            return {"success": True, "result": f"{mt} '{name}' created"}
        
        elif action == "clear_scene":
            for d in list(App.listDocuments().values()):
                App.closeDocument(d.Name)
            return {"success": True, "result": "Scene cleared"}
        
        elif action == "export_model":
            fmt = cmd.get("format", "step")
            fn = cmd.get("filename", "live_export")
            os.makedirs(WORKSPACE_DIR, exist_ok=True)
            ns = dict(GLOBALS_SCOPE)
            exec(_HELPERS_CODE, ns)
            if fmt == "step":
                path = os.path.join(WORKSPACE_DIR, fn + ".step")
                ns["export_step"](path)
            elif fmt == "stl":
                path = os.path.join(WORKSPACE_DIR, fn + ".stl")
                ns["export_stl"](path)
            else:
                return {"success": False, "error": f"Format '{fmt}' tidak didukung"}
            sz = os.path.getsize(path)
            return {"success": True, "path": path, "size": sz}
        
        else:
            return {"success": False, "error": f"Action '{action}' tidak dikenal"}
    
    except Exception as e:
        return {"success": False, "error": str(e), "traceback": traceback.format_exc()}


# ── Main server loop (select-based, single thread) ──────────
def run_server():
    os.makedirs(WORKSPACE_DIR, exist_ok=True)
    
    # Tentukan port — coba 9998 dulu, fallback ke 9997
    port = PORT
    
    # Buat server socket
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.setblocking(False)
    
    # Coba bind
    for attempt in range(3):
        try:
            server.bind((HOST, port))
            break
        except OSError:
            _p(f"[FreeCAD] Port {port} masih terpakai, coba lain...")
            time.sleep(1)
            port = 9997
    else:
        server.bind((HOST, port))
    
    server.listen(5)
    server.settimeout(0.5)
    
    _p("")
    _p("=" * 50)
    _p("  🧊 FreeCAD Socket Server v2 AKTIF!")
    _p("     Host: " + str(HOST))
    _p("     Port: " + str(port))
    _p("     PID: " + str(os.getpid()))
    _p("     Documents: " + str(len(App.listDocuments())))
    _p("=" * 50)
    _p("")
    
    clients = {}  # {socket: buffer}
    
    while True:
        # Accept new connections
        try:
            client, addr = server.accept()
            client.setblocking(False)
            clients[client] = b""
            _p(f"[FreeCAD] Client terhubung: {addr}")
        except (BlockingIOError, socket.timeout):
            pass
        except Exception as e:
            _p(f"[FreeCAD] Accept error: {e}")
            continue
        
        # Process existing clients
        to_remove = []
        for client, buf in clients.items():
            try:
                data = client.recv(65536)
                if not data:
                    to_remove.append(client)
                    continue
                buf += data
                
                # Process complete messages (separated by \n)
                while b'\n' in buf:
                    msg_bytes, buf = buf.split(b'\n', 1)
                    msg_str = msg_bytes.decode().strip()
                    if not msg_str:
                        continue
                    
                    try:
                        cmd = json.loads(msg_str)
                        response = process_command(cmd)
                        client.sendall(
                            json.dumps(response, ensure_ascii=False, default=str).encode() + b'\n'
                        )
                    except json.JSONDecodeError:
                        client.sendall(json.dumps({
                            "success": False, "error": "Invalid JSON"
                        }).encode() + b'\n')
                
                clients[client] = buf
                
            except (BlockingIOError, socket.timeout):
                continue
            except (ConnectionResetError, BrokenPipeError, OSError):
                to_remove.append(client)
        
        for c in to_remove:
            try:
                c.close()
            except:
                pass
            clients.pop(c, None)
            if to_remove:
                _p(f"[FreeCAD] Client disconnect ({len(clients)} remaining)")
        
        # Sleep sedikit agar tidak busy-loop
        time.sleep(0.01)


# ── START! ──────────────────────────────────────────────────
import time as _time
time = _time  # inject ke scope

_p("[FreeCAD] Starting select-based server (no threading)...")
try:
    run_server()
except KeyboardInterrupt:
    _p("[FreeCAD] Server stopped by user")
except Exception as e:
    _p(f"[FreeCAD] Server fatal error: {e}")
    traceback.print_exc()
