---
name: ui-taste
version: "1.0.0"
scope: global
description: "Framework selera desain UI/UX — prinsip, anti-pattern, dan penilaian estetika"
---

# 🎨 UI Taste — Design Sensibility Framework

## Filosofi

UI yang "enak dilihat" bukan subjektif. Ada prinsip universal yang bisa diukur:

> **Good taste = clarity + hierarchy + consistency + restraint**

## Prinsip Inti (4 Pilar)

### 1. Clarity (Kejelasan)
- User harus paham dalam **< 3 detik** apa fungsi utama screen
- Headline jelas, action primary terlihat, noise minimal
- ❌ Jangan sembunyikan CTA di balik menu yang tidak perlu
- ❌ Jangan pakai jargon teknis untuk user umum

### 2. Hierarchy (Jenjang Visual)
- Setiap screen harus punya **satu** focal point yang dominan
- Gunakan size, color, whitespace — bukan cuma bold
- Aturan: **1 besar, 2-3 medium, sisanya kecil**
- ❌ Semua elemen sama besar → user bingung prioritas

### 3. Consistency (Konsistensi)
- Spacing: pakai sistem **4px grid** (4, 8, 12, 16, 24, 32, 48)
- Warna: maksimal **2-3 warna brand** + netral (gray scale)
- Typography: maksimal **2 typeface** (1 display + 1 body)
- ❌ Jangan campur 3+ warna berbeda dalam satu screen

### 4. Restraint (Menahan Diri)
- **Less is more.** Kalau ragu, buang.
- Borders, shadows, gradients — pakai **salah satu**, jangan ketiganya
- Animasi: subtle & purposeful, bukan "keren-kerenan"
- ❌ Shadow + border + background color beda di satu card → over-designed

---

## Color Taste Rules

### Warna yang Enak
```
✅ Monochromatic + satu aksen
✅ Analogous (bersebelahan di color wheel)
✅ High saturation HANYA untuk CTA/element penting
✅ Neutral background (white, gray-50, zinc-50, slate-50)
```

### Warna yang NORAK
```
❌ Pelangi (merah, biru, hijau, kuning dalam 1 screen)
❌ Warna "murni" (#FF0000, #00FF00, #0000FF) — selalu tone down
❌ Text abu-abu di atas background abu-abu (low contrast)
❌ Gradasi linear pelangi (kecuali untuk efek spesifik)
```

### Sistem Warna yang Direkomendasikan
```
Primary    : 1 warna brand (60% penggunaan)
Secondary  : 1 warna pelengkap (30% penggunaan)
Accent     : 1 warna aksen untuk CTA/highlight (10% penggunaan)
Neutral    : slate/gray/zinc scale (background, text, border)
Success    : emerald/green-600
Warning    : amber/yellow-500
Error      : red-500/rose-600
```

---

## Typography Rules

### Hirarki Teks
```
Heading (h1)   : 1 per halaman, ukuran 2-3x body
Subheading (h2): 1-3 per section, ukuran 1.5x body
Body           : 14-16px, line-height 1.5-1.6
Caption        : 12px, untuk metadata/label sekunder
```

### Aturan Emas
- ✅ Line-height body selalu **1.5–1.6** (bukan default 1.2)
- ✅ Max-width paragraf: **65-75 karakter** (untuk readability)
- ✅ Letter-spacing heading: **-0.5px sampai -1px** (tight)
- ❌ JANGAN pakai center-align untuk teks > 2 baris
- ❌ JANGAN pakai uppercase untuk teks panjang

---

## Spacing & Layout

### Sistem Spacing (kelipatan 4)
```
xs   : 4px   → gap icon-label, padding tight
sm   : 8px   → gap antar elemen dalam group
md   : 16px  → padding card, gap section kecil
lg   : 24px  → padding section, gap section besar
xl   : 32px  → padding page, gap major section
2xl  : 48px  → hero section, major divider
3xl  : 64px  → jarak antar block besar
```

### Aturan
- ✅ Whitespace adalah alat desain, bukan "ruang kosong"
- ✅ Card padding minimal **16px** (jangan 8px — sumpek)
- ✅ Gap antar card minimal **16px**
- ❌ Container full-width tanpa max-width (pakai max-w-6xl atau max-w-7xl)

---

## Penilaian "Enak/Tidak"

Saat menilai UI, tanyakan 5 pertanyaan ini:

| # | Pertanyaan | Kalau "Tidak" → |
|---|-----------|-----------------|
| 1 | Apakah fungsi utama terlihat dalam 3 detik? | Redesign layout & hierarchy |
| 2 | Apakah warna nyaman dipandang > 10 detik? | Kurangi saturasi, perbaiki kontras |
| 3 | Apakah spacing terasa "bernapas"? | Tambah whitespace, padding, gap |
| 4 | Apakah ada elemen yang bisa dihapus? | Hapus. Less is more. |
| 5 | Apakah alignments konsisten? | Perbaiki grid, margin, padding |

---

## Anti-Patterns (JANGAN PERNAH)

```
❌ Button dengan 3+ warna berbeda dalam 1 screen
❌ Modal di dalam modal
❌ Loading spinner tanpa teks penjelasan
❌ Form label di kiri, input di kanan (atas-bawah lebih baik)
❌ Gambar background dengan text di atasnya tanpa overlay
❌ Scroll horizontal di desktop (kecuali galeri/data table)
❌ Alert/notifikasi yang tidak bisa di-dismiss
❌ Icon tanpa label (kecuali icon universal: search, home, settings)
```

---

## Checklist Sebelum Kirim Kode UI

- [ ] Max-width container diterapkan
- [ ] Spacing konsisten (pakai sistem 4px)
- [ ] Warna tidak lebih dari 3 + netral
- [ ] Kontras text ≥ 4.5:1 untuk body text
- [ ] Focus state terlihat di semua elemen interaktif
- [ ] Hover state ada di semua elemen clickable
- [ ] Loading, empty, error state sudah di-handle
- [ ] Responsive di mobile (375px) dan desktop (1440px)
