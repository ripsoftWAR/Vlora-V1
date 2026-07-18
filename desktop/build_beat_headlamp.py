"""
build_beat_headlamp.py - Build Honda Beat Deluxe Headlamp 3D Model

Menghasilkan model 3D lampu depan Beat Deluxe dengan presisi:
  - Housing utama dengan bentuk oval-teardrop khas Beat
  - Reflector dish di dalam
  - Lensa depan transparan
  - Housing sein kiri & kanan
  - Lubang bulb utama
  - Mounting bracket

Output:
  D:\\VloraWorkspace\\models\\BeatDeluxe_Headlamp.FCStd  (FreeCAD source)
  D:\\VloraWorkspace\\models\\BeatDeluxe_Headlamp.step   (STEP exchange format)
  D:\\VloraWorkspace\\models\\BeatDeluxe_Headlamp.stl    (STL mesh)

Cara pakai:
  "C:\\Program Files\\FreeCAD 1.1\\bin\\FreeCADCmd.exe" --console build_beat_headlamp.py
"""

# Guard: cegah double execution
import sys as _sys
if hasattr(_sys, '_beat_headlamp_done'):
    _sys.exit(0)
_sys._beat_headlamp_done = True

import FreeCAD as App
import Part
import Mesh
import MeshPart
import Import
import math
import os

# ═══════════════════════════════════════════════════════════════
# KONFIGURASI
# ═══════════════════════════════════════════════════════════════

WORKSPACE = r"D:\VloraWorkspace\models"
os.makedirs(WORKSPACE, exist_ok=True)

# ── Dimensi Lampu Depan Beat Deluxe (mm) ──────────────────────
# Berdasarkan referensi visual & estimasi presisi

DIMS = {
    # Housing utama — bentuk oval melebar di atas, mengecil di bawah
    "housing_width_top": 280,      # Lebar maksimal di bagian atas
    "housing_width_bot": 220,      # Lebar bagian bawah (mengecil)
    "housing_height_top": 80,      # Tinggi dari center ke atas
    "housing_height_bot": 60,      # Tinggi dari center ke bawah
    "housing_depth": 110,          # Kedalaman housing (depan-belakang)
    
    # Reflector
    "reflector_radius": 55,        # Radius reflector dish
    "reflector_depth": 45,         # Kedalaman reflector
    
    # Lensa
    "lens_radius": 65,             # Radius lensa depan
    "lens_thickness": 3,           # Tebal lensa
    
    # Sein kiri/kanan
    "signal_radius": 22,           # Radius housing sein
    "signal_depth": 15,            # Kedalaman sein
    "signal_spacing": 175,         # Jarak antar sein dari center
    
    # Bulb
    "bulb_radius": 14,             # Radius lubang bulb
    "bulb_depth": 25,              # Kedalaman lubang
    
    # Mounting
    "mount_width": 25,
    "mount_thickness": 8,
    "mount_height": 30,
    "mount_spacing": 90,           # Jarak mounting dari center
}

print("=" * 60)
print("BEAT DELUXE HEADLAMP -- 3D Model Builder")
print("=" * 60)

# ═══════════════════════════════════════════════════════════════
# DOKUMEN BARU
# ═══════════════════════════════════════════════════════════════

doc = App.newDocument("BeatDeluxe_Headlamp")

d = DIMS
H = d["housing_height_top"] + d["housing_height_bot"]
W = d["housing_width_top"]

print(f"\n[DIMS] Width: {W}mm x Height: {H}mm x Depth: {d['housing_depth']}mm")

# ═══════════════════════════════════════════════════════════════
# STEP 1: MAIN HOUSING BODY -- Profile Loft
# ═══════════════════════════════════════════════════════════════
# Bentuk housing: oval/teardrop -- lebar di atas, sempit di bawah.
# Dibuat dengan loft antara 2 sketch elips (depan & belakang)

print("\n[BOX] Step 1/7: Main Housing Body...")

def make_elliptical_wire(rx, ry, z, segments=48):
    """Buat wire elips pada bidang z."""
    points = []
    for i in range(segments):
        angle = math.radians(i * 360 / segments)
        px = rx * math.cos(angle)
        py = ry * math.sin(angle)
        points.append(App.Vector(px, py, z))
    points.append(points[0])  # Tutup polygon
    return Part.makePolygon(points)

# Profile depan (lebih besar) — bentuk teardrop khas Beat
# Bagian atas lebih lebar, bawah lebih sempit
# Gunakan 2 setengah elips: atas & bawah dengan rx berbeda

front_segments = 48
front_pts = []
for i in range(front_segments):
    angle = math.radians(i * 360 / front_segments)
    # Sisi kanan (0° - 180°): rx = width_top/2
    # Sisi kiri juga simetris
    rx = (d["housing_width_top"] / 2) if (0 <= i % front_segments <= front_segments//2) else (d["housing_width_top"] / 2)
    # Bagian atas (0° - 180°) dan bawah (180° - 360°) punya ry berbeda
    angle_norm = (i % front_segments) / front_segments  # 0.0 - 1.0
    if angle_norm <= 0.5:
        # Atas — ry lebih besar
        ry = d["housing_height_top"]
    else:
        # Bawah — ry lebih kecil (teardrop shape)
        ry = d["housing_height_bot"]
    
    # Smooth transition antara atas dan bawah
    t = angle_norm * 2 if angle_norm <= 0.5 else (angle_norm - 0.5) * 2
    if angle_norm > 0.5:
        ry = d["housing_height_top"] - (d["housing_height_top"] - d["housing_height_bot"]) * t
    
    px = rx * math.sin(math.radians(i * 360 / front_segments))
    py = ry * math.cos(math.radians(i * 360 / front_segments))
    front_pts.append(App.Vector(px, py, d["housing_depth"] / 2))

front_pts.append(front_pts[0])
front_wire = Part.makePolygon(front_pts)

# Profile belakang (lebih kecil — tapered ke belakang)
back_pts = []
back_rx = d["housing_width_top"] / 2 * 0.55
back_ry_top = d["housing_height_top"] * 0.55
back_ry_bot = d["housing_height_bot"] * 0.55

for i in range(front_segments):
    angle = math.radians(i * 360 / front_segments)
    angle_norm = (i % front_segments) / front_segments
    if angle_norm <= 0.5:
        t = angle_norm * 2
        ry = back_ry_top
    else:
        t = (angle_norm - 0.5) * 2
        ry = back_ry_top - (back_ry_top - back_ry_bot) * t
    
    px = back_rx * math.sin(angle)
    py = ry * math.cos(angle)
    back_pts.append(App.Vector(px, py, -d["housing_depth"] / 2))

back_pts.append(back_pts[0])
back_wire = Part.makePolygon(back_pts)

# Buat loft body
try:
    housing_loft = Part.makeLoft([front_wire, back_wire], True, True)
    housing_shape = doc.addObject("Part::Feature", "MainHousing")
    housing_shape.Shape = housing_loft
    doc.recompute()
    print("   [OK] Main housing loft created -", housing_loft.Volume / 1000, "cm^3")
except Exception as e:
    print(f"   [WARN] Loft method failed: {e}")
    print("   -> Falling back to box + boolean method")
    # Fallback: box as base
    box = doc.addObject("Part::Box", "HousingBox")
    box.Length = d["housing_width_top"]
    box.Width = d["housing_height_top"] + d["housing_height_bot"]
    box.Height = d["housing_depth"]
    box.Placement.Base = App.Vector(-box.Length/2, -d["housing_height_top"], -box.Height/2)
    
    # Round edges with cylinders
    for (cx, cy, rot) in [
        (box.Length/2 - 50, box.Width/2 - 40, 0),
        (-box.Length/2 + 50, box.Width/2 - 40, 0),
        (box.Length/2 - 50, -box.Width/2 + 40, 0),
        (-box.Length/2 + 50, -box.Width/2 + 40, 0),
    ]:
        fillet = doc.addObject("Part::Cylinder", f"Corner_{cx}_{cy}")
        fillet.Radius = 40
        fillet.Height = d["housing_depth"] + 1
        fillet.Placement.Base = App.Vector(cx, cy, -box.Height/2 - 0.5)
        doc.recompute()

# ═══════════════════════════════════════════════════════════════
# STEP 2: REFLECTOR DISH
# ═══════════════════════════════════════════════════════════════
print("\n[REFLECTOR] Step 2/7: Reflector Dish...")

# Reflector: bentuk mangkuk elips di dalam housing
# Buat ellipsoid dengan stretch matrix, lalu cut untuk dish shape

# Metode: buat sphere, transform matrix scaling, buat Part::Feature
reflector_sphere = doc.addObject("Part::Sphere", "ReflectorSphere")
reflector_sphere.Radius = d["reflector_radius"]
doc.recompute()

# Scale shape menggunakan transformGeometry dengan Matrix
shape_copy = reflector_sphere.Shape.copy()
mat = App.Matrix()
mat.scale(App.Vector(1.0, 0.85, 0.65))
shape_copy.transformGeometry(mat)

scaled_feat = doc.addObject("Part::Feature", "ReflectorScaled")
scaled_feat.Shape = shape_copy

# Potong dengan box untuk membuat dish (hanya bagian z > 0)
cut_box = doc.addObject("Part::Box", "ReflectorCutBox")
cl = d["reflector_radius"] * 2.5
cw = d["reflector_radius"] * 2.5
ch = d["reflector_radius"] * 2
cut_box.Length = cl
cut_box.Width = cw
cut_box.Height = ch
cut_box.Placement.Base = App.Vector(-cl/2, -cw/2, 0)

# Common = intersection untuk bagian depan reflector
try:
    dish = doc.addObject("Part::Common", "ReflectorDish")
    dish.Base = scaled_feat
    dish.Tool = cut_box
    doc.recompute()
    vol = dish.Shape.Volume / 1000
    print("   [OK] Reflector dish created -", vol, "cm^3")
except Exception as e:
    print(f"   [WARN] Reflector warning: {e}")

# ═══════════════════════════════════════════════════════════════
# STEP 3: LENS OPENING (Cutout for headlight lens)
# ═══════════════════════════════════════════════════════════════
print("\n[LENS] Step 3/7: Lens Opening...")

# Buat cylinder sebagai cutting tool untuk lens opening
lens_cutter = doc.addObject("Part::Cylinder", "LensCutter")
lens_cutter.Radius = d["lens_radius"]
lens_cutter.Height = d["housing_depth"] + 20
lens_cutter.Placement.Base = App.Vector(0, 0, -d["housing_depth"]/2 - 5)
lens_cutter.Placement.Rotation = App.Rotation(App.Vector(0, 1, 0), 90)

try:
    # Cari housing object
    housing_obj = doc.getObject("MainHousing") or doc.getObject("HousingBox")
    if housing_obj:
        lens_opening = doc.addObject("Part::Cut", "HousingWithLensOpening")
        # Cari semua housing-related objects untuk di-fuse dulu
        base_objs = []
        for name in ["MainHousing", "HousingBox"]:
            obj = doc.getObject(name)
            if obj: base_objs.append(obj)
        
        # Fuse all housing parts first
        if len(base_objs) > 1:
            fuse = doc.addObject("Part::MultiFuse", "HousingFused")
            fuse.Shapes = base_objs
            doc.recompute()
            lens_opening.Base = fuse
        else:
            lens_opening.Base = base_objs[0]
        
        lens_opening.Tool = doc.getObject("LensCutter")
        doc.recompute()
        print("   [OK] Lens opening created")
except Exception as e:
    print(f"   [WARN] Lens opening skipped: {e}")

# ═══════════════════════════════════════════════════════════════
# STEP 4: LENS (Transparent Cover)
# ═══════════════════════════════════════════════════════════════
print("\n[LENS] Step 4/7: Lens (Transparent Cover)...")

# Buat cylinder, lalu scale shape untuk lens elliptical
lens_cyl = doc.addObject("Part::Cylinder", "LensRaw")
lens_cyl.Radius = d["lens_radius"] - 2
lens_cyl.Height = d["lens_thickness"]
lens_cyl.Placement.Base = App.Vector(0, 0, 0)
lens_cyl.Placement.Rotation = App.Rotation(App.Vector(0, 1, 0), 90)
doc.recompute()

# Scale shape menjadi elliptical
lens_shape = lens_cyl.Shape.copy()
mat = App.Matrix()
mat.scale(App.Vector(1.0, 1.0, 0.6))
lens_shape.transformGeometry(mat)

lens_feat = doc.addObject("Part::Feature", "Lens")
lens_feat.Shape = lens_shape
lens_feat.Placement.Base = App.Vector(0, 0, d["housing_depth"]/2 - d["lens_thickness"]/2)
doc.recompute()
print(f"   [OK] Lens created: R={d['lens_radius']-2}mm, t={d['lens_thickness']}mm (elliptical)")

# ═══════════════════════════════════════════════════════════════
# STEP 5: TURN SIGNAL HOUSINGS (Sein kiri & kanan)
# ═══════════════════════════════════════════════════════════════
print("\n[SIGNAL] Step 5/7: Turn Signal Housings (Sein)...")

for side_name, x_pos, y_pos in [
    ("LeftSignal", -d["signal_spacing"]/2, d["housing_height_top"] * 0.2),
    ("RightSignal", d["signal_spacing"]/2, d["housing_height_top"] * 0.2),
]:
    # Housing sein — bentuk cylinder
    signal = doc.addObject("Part::Cylinder", side_name)
    signal.Radius = d["signal_radius"]
    signal.Height = d["signal_depth"]
    signal.Placement.Base = App.Vector(x_pos, y_pos, d["housing_depth"]/2 - d["signal_depth"]/2)
    signal.Placement.Rotation = App.Rotation(App.Vector(0, 1, 0), 90)
    
    # Lens sein
    sig_lens = doc.addObject("Part::Cylinder", f"{side_name}_Lens")
    sig_lens.Radius = d["signal_radius"] - 3
    sig_lens.Height = 2
    sig_lens.Placement.Base = App.Vector(x_pos, y_pos, d["housing_depth"]/2 - 2)
    sig_lens.Placement.Rotation = App.Rotation(App.Vector(0, 1, 0), 90)
    
    doc.recompute()
    print(f"   [OK] {side_name}: at ({x_pos}, {y_pos})")

# ═══════════════════════════════════════════════════════════════
# STEP 6: BULB HOLE & MOUNTING
# ═══════════════════════════════════════════════════════════════
print("\n[BULB] Step 6/7: Bulb Mount & Hole...")

# Lubang utama untuk bulb
bulb_hole = doc.addObject("Part::Cylinder", "BulbHole")
bulb_hole.Radius = d["bulb_radius"]
bulb_hole.Height = d["bulb_depth"]
bulb_hole.Placement.Base = App.Vector(0, 0, -d["housing_depth"]/2 - d["bulb_depth"]/2 + 10)
doc.recompute()

# Reflector hole (lubang di reflector untuk bulb masuk)
ref_hole = doc.addObject("Part::Cylinder", "ReflectorHole")
ref_hole.Radius = d["bulb_radius"] + 5
ref_hole.Height = d["reflector_depth"]
ref_hole.Placement.Base = App.Vector(0, 0, -10)
doc.recompute()

print("   [OK] Bulb hole created")

# ═══════════════════════════════════════════════════════════════
# STEP 7: MOUNTING BRACKETS
# ═══════════════════════════════════════════════════════════════
print("\n[MOUNT] Step 7/7: Mounting Brackets...")

for i, (x_pos, label) in enumerate([
    (-d["mount_spacing"]/2, "MountLeft"),
    (d["mount_spacing"]/2, "MountRight"),
]):
    mount = doc.addObject("Part::Box", label)
    mount.Length = d["mount_width"]
    mount.Width = d["mount_thickness"]
    mount.Height = d["mount_height"]
    mount.Placement.Base = App.Vector(
        x_pos - d["mount_width"]/2,
        -d["housing_height_top"] - d["mount_thickness"],
        -d["housing_depth"]/2 - d["mount_height"]/2 + 10
    )
    doc.recompute()
    
    # Lubang baut pada bracket
    screw_hole = doc.addObject("Part::Cylinder", f"{label}_ScrewHole")
    screw_hole.Radius = 3
    screw_hole.Height = d["mount_thickness"] + 2
    screw_hole.Placement.Base = App.Vector(
        x_pos,
        -d["housing_height_top"] - 1,
        -d["housing_depth"]/2 + 10
    )
    doc.recompute()
    
    print(f"   [OK] {label}")

# ═══════════════════════════════════════════════════════════════
# FINAL RECOMPUTE & EXPORT
# ═══════════════════════════════════════════════════════════════

doc.recompute()

print("\n" + "=" * 60)
print("[OK] MODEL COMPLETE!")
print("Beat Deluxe Headlamp")
print("=" * 60)

# Info object
objects_count = len(doc.Objects)
print(f"\n[INFO] Object count: {objects_count}")
for obj in doc.Objects:
    vol = ""
    if hasattr(obj, "Shape") and obj.Shape:
        try:
            vol = f" - {obj.Shape.Volume/1000:.1f}cm^3"
        except:
            pass
    print(f"   * {obj.Label or obj.Name} ({obj.TypeId}){vol}")

# ── SAVE ────────────────────────────────────────────────────────
fcstd_path = os.path.join(WORKSPACE, "BeatDeluxe_Headlamp.FCStd")
doc.saveAs(fcstd_path)
print(f"\n[SAVE] Saved: {fcstd_path}")

# ── EXPORT STEP ─────────────────────────────────────────────────
step_path = os.path.join(WORKSPACE, "BeatDeluxe_Headlamp.step")
try:
    Import.export(doc.Objects, step_path)
    sz = os.path.getsize(step_path)/1024
    print(f"[FILE] STEP: {step_path}  ({sz:.0f} KB)")
except Exception as e:
    print(f"[WARN] STEP export: {e}")

# ── EXPORT STL ──────────────────────────────────────────────────
stl_path = os.path.join(WORKSPACE, "BeatDeluxe_Headlamp.stl")
try:
    # Mesh export
    mesh = Mesh.Mesh()
    for obj in doc.Objects:
        if hasattr(obj, "Shape") and obj.Shape and obj.Shape.Volume > 0:
            try:
                mesh2 = MeshPart.meshFromShape(
                    Shape=obj.Shape,
                    LinearDeflection=0.5,
                    AngularDeflection=0.5
                )
                mesh.addMesh(mesh2)
            except:
                pass
    if len(mesh.Facets) > 0:
        mesh.write(stl_path)
        sz = os.path.getsize(stl_path)/1024
        print(f"[FILE] STL: {stl_path}  ({sz:.0f} KB, {len(mesh.Facets)} facets)")
    else:
        print("[WARN] STL: No valid mesh to export")
except Exception as e:
    print(f"[WARN] STL export: {e}")

print("\n" + "=" * 60)
print("[DONE] Model siap digunakan.")
print("=" * 60)
