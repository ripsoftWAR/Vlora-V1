"""
Build Honda Beat Headlamp Housing — via FreeCAD Socket
Jalankan: type _build_housing.py | python freecad_send.py run_script code=-
"""
import FreeCAD as App
import Part
import math

# ── BUAT DOKUMEN ──
doc = App.newDocument("BeatHeadlamp")

# ── DIMENSI (mm) ──
W_TOP = 280      # lebar atas housing
W_BOT = 200      # lebar bawah housing (teardrop)
H_TOP = 75       # tinggi dari center ke atas
H_BOT = 55       # tinggi dari center ke bawah
DEPTH = 110      # kedalaman housing

# ── FUNGSI PROFILE TEARDROP ──
def make_teardrop_profile(rx_top, rx_bot, ry_top, ry_bot, z, seg=64):
    """Buat profile teardrop asymmetric — lebar atas, sempit bawah"""
    pts = []
    for i in range(seg):
        ang = math.radians(i * 360 / seg)
        # Rx: lebih lebar di samping kiri/kanan
        rx = rx_bot + (rx_top - rx_bot) * abs(math.cos(ang))
        # Ry: smooth transisi atas-bawah
        if ang <= math.pi:
            ry = ry_top
        else:
            ry = ry_bot
        # Blend di sisi
        sin_a = abs(math.sin(ang))
        if sin_a > 0.8:
            blend = (sin_a - 0.8) / 0.2
            if ang <= math.pi:
                ry = ry_bot + (ry_top - ry_bot) * (1 - blend)
            else:
                ry = ry_top + (ry_bot - ry_top) * (1 - blend)
        px = rx * math.sin(ang)
        py = ry * math.cos(ang)
        pts.append(App.Vector(px, py, z))
    pts.append(pts[0])
    return Part.makePolygon(pts)

# ═══════════════════════════════════════════
# STEP 1: MAIN HOUSING BODY
# ═══════════════════════════════════════════
print("[1/5] Main housing body...")
front = make_teardrop_profile(W_TOP/2, W_BOT/2, H_TOP, H_BOT, DEPTH/2)
back = make_teardrop_profile(
    W_TOP/2*0.45, W_BOT/2*0.45, H_TOP*0.45, H_BOT*0.45, -DEPTH/2
)
housing = Part.makeLoft([front, back], True, True)
obj = doc.addObject("Part::Feature", "HousingBody")
obj.Shape = housing
doc.recompute()
print(f"  Volume: {obj.Shape.Volume/1000:.0f} cm^3")

# ═══════════════════════════════════════════
# STEP 2: LENS CUTOUT
# ═══════════════════════════════════════════
print("[2/5] Lens opening...")
lens_rx, lens_ry = 58, 48
lpts = [App.Vector(lens_rx*math.cos(math.radians(i*360/48)),
                   lens_ry*math.sin(math.radians(i*360/48)), 0)
        for i in range(48)]
lpts.append(lpts[0])
lw = Part.makePolygon(lpts)
lens_cut = lw.extrude(App.Vector(0, 0, -1) * (DEPTH + 20))
lens_cut.translate(App.Vector(0, 5, DEPTH/2 + 2))

lc = doc.addObject("Part::Feature", "LensCutTool")
lc.Shape = lens_cut
cut = doc.addObject("Part::Cut", "HousingCut")
cut.Base = obj
cut.Tool = lc
doc.recompute()

# ═══════════════════════════════════════════
# STEP 3: REFLECTOR DISH
# ═══════════════════════════════════════════
print("[3/5] Reflector dish...")
# Gunakan sphere yang di-scale
sph = doc.addObject("Part::Sphere", "RefSphere")
sph.Radius = 55
doc.recompute()
s2 = sph.Shape.copy()
m = App.Matrix()
m.scale(App.Vector(50/55, 42/55, 32/55))
s2.transformGeometry(m)

sf = doc.addObject("Part::Feature", "RefScaled")
sf.Shape = s2

# Potong bagian depan (z>0)
bx = doc.addObject("Part::Box", "RefBox")
bx.Length, bx.Width, bx.Height = 120, 100, 50
bx.Placement.Base = App.Vector(-60, -50, 0)

ref = doc.addObject("Part::Common", "Reflector")
ref.Base = sf
ref.Tool = bx
doc.recompute()

# Bersihkan intermediate
doc.removeObject("RefSphere")
doc.removeObject("RefScaled")
doc.removeObject("RefBox")

# ═══════════════════════════════════════════
# STEP 4: BULB HOLE
# ═══════════════════════════════════════════
print("[4/5] Bulb hole...")
b = doc.addObject("Part::Cylinder", "BulbHole")
b.Radius, b.Height = 14, 30
b.Placement.Base = App.Vector(0, -5, -DEPTH/2)
b.Placement.Rotation = App.Rotation(App.Vector(1, 0, 0), 90)

# ═══════════════════════════════════════════
# STEP 5: SIGNALS + MOUNTS
# ═══════════════════════════════════════════
print("[5/5] Signals & mounts...")
for s, x in [("L", -125), ("R", 125)]:
    sig = doc.addObject("Part::Cylinder", f"Signal{s}")
    sig.Radius, sig.Height = 20, 12
    sig.Placement.Base = App.Vector(x, 55, DEPTH/2 - 6)
    sig.Placement.Rotation = App.Rotation(App.Vector(0, 1, 0), 90)
    sl = doc.addObject("Part::Cylinder", f"Signal{s}_Lens")
    sl.Radius, sl.Height = 17, 2
    sl.Placement.Base = App.Vector(x, 55, DEPTH/2 - 2)
    sl.Placement.Rotation = App.Rotation(App.Vector(0, 1, 0), 90)

for s, x in [("L", -85), ("R", 85)]:
    m = doc.addObject("Part::Box", f"Mount{s}")
    m.Length, m.Width, m.Height = 20, 6, 25
    m.Placement.Base = App.Vector(x-10, -H_BOT-3, -DEPTH/2+5)

doc.recompute()
print(f"\nDONE! {len(doc.Objects)} objects created")
