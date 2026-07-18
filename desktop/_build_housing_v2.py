"""
Build Honda Beat Headlamp Housing v2 — Lebih detail & akurat
"""
import FreeCAD as App
import Part
import math

doc = App.newDocument("BeatHeadlamp")

# ── DIMENSIONS ──
WT = 260   # width top
WB = 180   # width bottom (teardrop)
HT = 70    # height top
HB = 50    # height bottom
DP = 100   # depth

# ── HELPER: Round-cornered shape ──
def teardrop_points(rx, ry_top, ry_bot, z, n=48):
    pts = []
    for i in range(n):
        a = math.radians(i * 360 / n)
        rx_ = rx
        if i % n > n//4 and i % n < 3*n//4:
            rx_ = rx * 0.85  # narrower at top/bottom
        # Ry: smooth top→bottom transition
        half = n // 2
        if i % n < half:
            # Upper half
            ry = ry_top
            t = (i % n) / half
        else:
            # Lower half
            ry = ry_bot
            t = (i % n - half) / half
        # Smooth transitions at sides  
        s = abs(math.sin(a))
        if s > 0.8:
            b = (s - 0.8) / 0.2
            if i % n < half:
                ry = ry_bot + (ry_top - ry_bot) * (1 - b)
            else:
                ry = ry_top + (ry_bot - ry_top) * (1 - b)
        px = rx_ * math.sin(a)
        py = ry * math.cos(a)
        pts.append(App.Vector(px, py, z))
    pts.append(pts[0])
    return pts

# ═══════════════════════════════
# 1. MAIN BODY (Solid Loft)
# ═══════════════════════════════
print("[1/4] Main body...")

# Front profile (big)
fp = Part.makePolygon(teardrop_points(WT/2, HT, HB, DP/2))
# Back profile (small, tapered) 
bp = Part.makePolygon(teardrop_points(WT/2*0.4, HT*0.4, HB*0.4, -DP/2))

body = Part.makeLoft([fp, bp], True, True)
body_obj = doc.addObject("Part::Feature", "HousingBody")
body_obj.Shape = body
doc.recompute()
print(f"  Body: {body_obj.Shape.Volume/1000:.0f} cm^3")

# ═══════════════════════════════
# 2. LENS OPENING (Extrude + Cut)
# ═══════════════════════════════
print("[2/4] Lens opening...")

# Make a smaller shape at the front for the lens opening
lx, ly = 50, 40
lpts = [App.Vector(lx*math.cos(math.radians(i*360/36)),
                   ly*math.sin(math.radians(i*360/36)), 0) for i in range(36)]
lpts.append(lpts[0])
lw = Part.makePolygon(lpts)
l_face = Part.Face(lw)

# Extrude through body (from slightly in front to past the back)
l_extrude = l_face.extrude(App.Vector(0, 0, -1) * (DP + 30))
l_extrude.translate(App.Vector(0, 5, DP/2 + 5))

cut_obj = doc.addObject("Part::Feature", "LensCutTool")
cut_obj.Shape = l_extrude

# Boolean cut
cut = doc.addObject("Part::Cut", "Housing")
cut.Base = body_obj
cut.Tool = cut_obj
doc.recompute()

if hasattr(cut, 'Shape') and cut.Shape and cut.Shape.isValid():
    print(f"  Cut valid! Volume: {cut.Shape.Volume/1000:.0f} cm^3")
else:
    print("  Cut failed! Using body directly.")
    cut = body_obj  # fallback

# ═══════════════════════════════
# 3. REFLECTOR DISH
# ═══════════════════════════════
print("[3/4] Reflector dish...")

# Create as half-ellipsoid
sph = doc.addObject("Part::Sphere", "RefOrigin")
sph.Radius = 50
doc.recompute()

s2 = sph.Shape.copy()
m = App.Matrix()
m.scale(App.Vector(1.0, 0.85, 0.65))
s2.transformGeometry(m)

ref_shape = doc.addObject("Part::Feature", "RefShape")
ref_shape.Shape = s2

# Cut to front half
bx = doc.addObject("Part::Box", "RefBox")
bx.Length, bx.Width, bx.Height = 120, 100, 45
bx.Placement.Base = App.Vector(-60, -50, 0)

ref = doc.addObject("Part::Common", "Reflector")
ref.Base = ref_shape
ref.Tool = bx
doc.recompute()

# Clean intermediates
doc.removeObject("RefOrigin")
doc.removeObject("RefShape")
doc.removeObject("RefBox")

# Position reflector inside housing
doc.getObject("Reflector").Placement.Base = App.Vector(0, 5, DP/2 - 50)

# ═══════════════════════════════
# 4. BULB HOLE + SIGNALS + MOUNTS
# ═══════════════════════════════
print("[4/4] Details...")

# Bulb hole at the back center
bulb = doc.addObject("Part::Cylinder", "BulbHole")
bulb.Radius, bulb.Height = 15, 35
bulb.Placement.Base = App.Vector(0, -5, -DP/2 - 2)
bulb.Placement.Rotation = App.Rotation(App.Vector(1, 0, 0), 90)
doc.recompute()

# Bulb mounting flange
flange = doc.addObject("Part::Cylinder", "BulbFlange")
flange.Radius, flange.Height = 22, 5
flange.Placement.Base = App.Vector(0, -5, -DP/2 - 2)
flange.Placement.Rotation = App.Rotation(App.Vector(1, 0, 0), 90)
doc.recompute()

# Turn signals
for side, x in [("L", -115), ("R", 115)]:
    sig = doc.addObject("Part::Cylinder", f"Signal{side}")
    sig.Radius, sig.Height = 18, 10
    sig.Placement.Base = App.Vector(x, HT*0.7, DP/2 - 5)
    sig.Placement.Rotation = App.Rotation(App.Vector(0, 1, 0), 90)
    
    lens = doc.addObject("Part::Cylinder", f"Signal{side}_Lens")
    lens.Radius, lens.Height = 15, 2
    lens.Placement.Base = App.Vector(x, HT*0.7, DP/2 - 2)
    lens.Placement.Rotation = App.Rotation(App.Vector(0, 1, 0), 90)

# Mounting brackets
for side, x in [("L", -75), ("R", 75)]:
    m = doc.addObject("Part::Box", f"Mount{side}")
    m.Length, m.Width, m.Height = 20, 6, 30
    m.Placement.Base = App.Vector(x-10, -HB-5, -DP/2+8)
    
    sh = doc.addObject("Part::Cylinder", f"Mount{side}_Hole")
    sh.Radius, sh.Height = 2.5, 10
    sh.Placement.Base = App.Vector(x, -HB-2, -DP/2+8)

doc.recompute()

# ═══════════════════════════════
# REPORT
# ═══════════════════════════════
print(f"\n{'='*50}")
print(f"BEAT HEADLAMP — BUILD COMPLETE")
print(f"{'='*50}")
for o in doc.Objects:
    try:
        v = o.Shape.Volume/1000 if hasattr(o,'Shape') and o.Shape and o.Shape.isValid() else 0
        if v > 0:
            print(f"  {o.Label:20s} {v:8.0f} cm^3  [{o.TypeId}]")
        else:
            print(f"  {o.Label:20s} {'(ref only)':>8}  [{o.TypeId}]")
    except:
        print(f"  {o.Label:20s} {'(no shape)':>8}  [{o.TypeId}]")
print(f"\nTotal: {len(doc.Objects)} objects")
