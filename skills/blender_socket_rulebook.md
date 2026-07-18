# 🧊 Blender Live Socket Bridge — Panduan Lengkap

## 📋 Apa Ini?

**Blender Socket Bridge** adalah sistem yang memungkinkan **Flora Agent** mengontrol **Blender secara real-time** — tanpa perlu restart Blender setiap kali.

### ⚡ Perbandingan Mode

| Fitur | `blender_inject` (Headless) | `blender_socket_inject` (Live) |
|-------|---------------------------|------------------------------|
| Blender restart? | ✅ Setiap command | ❌ Tidak pernah |
| User lihat perubahan? | ❌ Tidak (headless) | ✅ **Real-time di viewport** |
| Kecepatan | Lambat (~5-10 detik/command) | **Cepat (~0.5 detik/command)** |
| Cocok untuk | Export batch, render malam | **Iterasi desain, modelling live** |
| Bisa trial & error? | ❌ Susah | ✅ **Sangat mudah** |

---

## 🚀 Cara Pakai — Step by Step

### Step 1: Buka Blender
Pastikan Blender 5.2 sudah terinstall dan terbuka.

### Step 2: Jalankan Socket Server di Blender
Ada **3 cara** untuk start server:

#### 🅰️ Via Blender Text Editor (Termudah)
1. Di Blender, buka tab **Scripting** (atau ubah workspace ke **Scripting**)
2. Di Text Editor, klik **File → Open**
3. Pilih: `desktop/blender_socket_server.py`
4. Klik **Run Script** (Alt+P)
5. Lihat Console Blender — harus muncul:
   ```
   🧊 Blender Socket Server AKTIF!
      Host: 127.0.0.1
      Port: 9999
   ```

#### 🅱️ Via Python Console Blender
```python
# Di Blender Python Console:
import sys
sys.path.append(r"D:\downloads\Vlora-V1")
from desktop.blender_socket_server import start_server
start_server()
```

#### 🅲 Via Flora (jika Blender sudah connect headless)
Gunakan tool `blender_socket_inject` dengan action `start_server`:
```
blender_socket_inject(action="start_server")
```

### Step 3: Konek dari Flora
Setelah server jalan di Blender, Flora otomatis akan deteksi saat kamu kirim command `blender_socket_inject` pertama.

### Step 4: Mulai Modelling Live!
```python
# Contoh: Buat kubus
blender_socket_inject(
    action="create_mesh",
    mesh_type="cube",
    size=2,
    location=[0, 0, 0]
)

# Contoh: Buat sphere + material
blender_socket_inject(
    action="run_script",
    code="""
add_sphere(radius=1.5, location=[2, 0, 0], name="Bola")
set_material("Bola", color=(0.2, 0.6, 1.0, 1.0), mat_type="glass")
"""
)
```

---

## 🎮 Action Reference

### Action: `run_script` / `exec_code`
Kirim kode Python apa pun ke Blender.

| Parameter | Tipe | Wajib | Deskripsi |
|-----------|------|-------|-----------|
| `code` | string | ✅ | Kode Python (bpy, helpers available) |
| `main_thread` | bool | ❌ | Force main thread (default: false) |

**Variabel yang tersedia di Blender:**
- `bpy` — Blender Python API
- `bmesh` — Blender Mesh API
- `C` — `bpy.context`
- `D` — `bpy.data`
- `Vector`, `Matrix`, `Euler`, `Quaternion` — mathutils
- `radians()`, `degrees()` — konversi sudut

**Helper functions (built-in):**
| Fungsi | Deskripsi |
|--------|-----------|
| `new_scene()` | Bersihkan semua object |
| `save_blend(name)` | Simpan .blend ke workspace |
| `export_obj(name)` | Export sebagai .obj |
| `export_fbx(name)` | Export sebagai .fbx |
| `export_glb(name)` | Export sebagai .glb |
| `export_stl(name)` | Export sebagai .stl |
| `list_objects()` | Daftar semua object di scene |
| `select(name)` | Select object by name |
| `delete(name)` | Hapus object by name |
| `scene_info()` | Info scene lengkap (dict) |
| `set_material(name, color, type)` | Apply material |
| `add_cube(size, location, name)` | Buat cube |
| `add_sphere(...)` | Buat sphere |
| `add_cylinder(...)` | Buat cylinder |
| `add_cone(...)` | Buat cone |
| `add_torus(...)` | Buat torus |
| `add_monkey(...)` | Buat Suzanne (monkey) |
| `add_plane(...)` | Buat plane |
| `apply_modifier(obj, type, **kw)` | Apply & apply modifier |
| `boolean_diff(a, b)` | Boolean DIFFERENCE |
| `boolean_union(a, b)` | Boolean UNION |

### Action: `eval`
Evaluasi expression Python, return value-nya.

| Parameter | Tipe | Wajib | Deskripsi |
|-----------|------|-------|-----------|
| `expression` | string | ✅ | Contoh: `"len(bpy.data.objects)"` |

**Contoh:**
```
blender_socket_inject(action="eval", expression="len(bpy.data.objects)")
→ 🔢 Hasil Evaluasi: 5
```

### Action: `ping`
Cek apakah Blender dan socket server hidup.

**Contoh response:**
```json
{
  "bridge": "ok",
  "blender": true,
  "blender_version": "5.2.0"
}
```

### Action: `get_scene_info`
Dapatkan info lengkap scene — semua object, material, collection.

**Contoh response:**
```json
{
  "name": "Scene",
  "objects": [
    {"name": "Cube", "type": "MESH", "location": [0,0,0], "verts": 24}
  ],
  "materials": ["Material"],
  "collections": ["Collection"]
}
```

### Action: `create_mesh`
Buat mesh primitive — shortcut tanpa perlu nulis kode.

| Parameter | Tipe | Wajib | Default |
|-----------|------|-------|---------|
| `mesh_type` | string | ✅ | `"cube"` |
| `size` | number | ❌ | 2 (cube/plane) |
| `radius` | number | ❌ | 1 (sphere/cylinder/cone) |
| `depth` | number | ❌ | 2 (cylinder/cone) |
| `segments` | number | ❌ | 32 (sphere) |
| `location` | [x,y,z] | ❌ | [0,0,0] |
| `name` | string | ❌ | auto |

### Action: `clear_scene`
Hapus semua object, material, mesh, texture dari scene.

### Action: `export_model`
Export scene ke format file.

| Parameter | Tipe | Wajib | Default |
|-----------|------|-------|---------|
| `format` | string | ❌ | `"blend"` |
| `filename` | string | ❌ | `"exported_model"` |

Format: `obj`, `fbx`, `glb`, `stl`, `blend`

### Action: `render_viewport`
Render viewport ke PNG.

| Parameter | Tipe | Wajib | Default |
|-----------|------|-------|---------|
| `filename` | string | ❌ | `"viewport_render"` |
| `resolution_x` | number | ❌ | 1920 |
| `resolution_y` | number | ❌ | 1080 |

### Action: `start_server`
Kirim perintah ke Blender untuk start socket server (otomatis).

### Action: `stop_server`
Matikan socket server di Blender.

### Action: `connect` / `disconnect` / `reconnect`
Manage koneksi bridge ke Blender.

---

## 📂 Workspace Output

Semua file hasil export dan render disimpan di:
```
~/VloraWorkspace/models/
```
Path lengkap: `C:\Users\[username]\VloraWorkspace\models\`

Bisa diubah dengan set variabel `WORKSPACE_DIR` di `blender_socket_server.py`.

---

## 🔌 Protocol: Client → Server

Bridge dan server berkomunikasi via **TCP JSON**:

### Request (Client → Server :9999)
```json
{
  "cmdId": "blender_1712345678_0",
  "code": "add_cube(size=2, name='MyCube')"
}
```

### Response (Server → Client)
```json
{
  "success": true,
  "stdout": "[SAVED] C:/Users/.../models/scene.blend\n",
  "stderr": "",
  "result": null,
  "error": null,
  "cmdId": "blender_1712345678_0"
}
```

---

## 🐛 Troubleshooting

| Masalah | Penyebab | Solusi |
|---------|----------|--------|
| ❌ "tidak bisa konek" | Server belum jalan | Jalankan `blender_socket_server.py` di Blender |
| ❌ "Connection refused" | Port 9999 tidak terbuka | Cek firewall. Coba `ping` dulu |
| ❌ "Address already in use" | Server sudah jalan / port dipakai | Stop dulu: `blender_socket_inject(action="stop_server")` |
| ❌ "import bpy failed" | Script jalan di luar Blender | PASTIKAN script dijalankan DARI DALAM Blender |
| ⚠️ Response timeout | Kode infinite loop | Script jangan pakai `while True` tanpa break |
| ⚠️ Blender freeze | Operasi berat | Panggil `C.window_manager.progress_begin()` dulu |
| ❌ Module not found | Path salah | Cek sys.path.append path project |

### Diagnosa Cepat

**Cek koneksi:**
```
blender_socket_inject(action="ping")
```
Kalau response `blender: false` → server belum jalan.

**Cek scene:**
```
blender_socket_inject(action="get_scene_info")
```

**Coba kode sederhana:**
```
blender_socket_inject(
    action="run_script",
    code="add_cube(size=2, name='Test')"
)
```

---

## 💡 Tips & Trik

### 🔥 Iterasi Cepat — Edit & Lihat Langsung
```
Kirim 1: add_cube(location=[0,0,0])
           → (lihat kubus muncul di Blender)
Kirim 2: set_material("Cube", color=(1,0,0,1), mat_type="glossy")
           → (kubus jadi merah mengkilap real-time)
Kirim 3: apply_modifier("Cube", "BEVEL", width=0.05)
           → (tepi kubus jadi bulat)
```

### 🎯 Object Selection by Name
Helper `select("Cube")` akan select object + set active. Gunakan untuk operasi yang butuh active object.

### 💾 Auto-save
Helper `save_blend("project_v2")` otomatis simpan ke workspace.

### 📋 Copy-Paste dari Blender Console
Bisa mix-code: jalankan kode manual di Blender Console + lewat Flora.
Semua helper function tersedia di console juga setelah server start.

---

## ⚠️ Peringatan Keamanan

- Server listen di `127.0.0.1` saja (localhost) — **tidak bisa diakses dari luar**
- Kode yang dikirim via socket bisa akses **semua API Blender** — setara dengan Python Console
- Jangan jalanin server di Blender yang berisi file rahasia jika ada orang lain di jaringan lokal
- Matikan server (`stop_server()`) jika tidak dipakai lagi
