---
name: ui-taste
version: "1.0.0"
scope: project
description: "Aplikasi konkret prinsip UI taste ke project ini — React + Vite + Tailwind CSS"
---

# 🎨 Taste untuk Project Ini

## Stack & Implikasi Desain

| Teknologi | Implikasi Taste |
|-----------|----------------|
| **Tailwind CSS** | Hindari utility overload (`className` > 10 class → ekstrak komponen). Pakai spacing system Tailwind (`p-4`, `gap-6`) yang sudah sesuai 4px grid. |
| **React 19** | Komponen kecil & fokus. Satu komponen = satu tanggung jawab visual. |
| **Framer Motion** | Animasi: subtle. `duration: 0.2`, bukan `0.5`. Pakai `ease-out` untuk enter, `ease-in` untuk exit. JANGAN animasi semua elemen. |
| **TypeScript** | Props interface harus mendokumentasikan intent visual (`size?: 'sm' | 'md' | 'lg'`, `variant?: 'primary' | 'ghost'`). |

---

## Review Semua Komponen (12 file)

Kalau kamu diminta review UI project ini, pakai checklist ini untuk setiap komponen:

### Untuk Setiap Komponen, Nilai:

```
✅ / ⚠️ / ❌

[ ] Clarity      — fungsinya jelas dalam 3 detik?
[ ] Hierarchy    — ada focal point?
[ ] Spacing      — bernapas? tidak sumpek?
[ ] Color        — tidak > 3 warna + netral?
[ ] Typography   — hirarki teks jelas?
[ ] Responsive   — mobile: stack, desktop: grid?
[ ] State        — loading, error, empty state ada?
[ ] Accessibility— ARIA label, keyboard nav, focus?
```

---

## Spacing Cheatsheet (Tailwind)

```tsx
// ✅ BAIK — spacing bernapas
<div className="p-6 space-y-4">       // card
<section className="py-12 px-4">      // section
<div className="gap-6">               // grid/flex gap
<button className="px-4 py-2">        // button padding

// ❌ BURUK — terlalu padat
<div className="p-2 space-y-1">       // card sumpek
<section className="py-4 px-2">       // section sempit
<div className="gap-2">               // grid terlalu rapat
<button className="px-2 py-1">        // button kecil susah diklik
```

---

## Color Tokens (yang Enak untuk Project Ini)

```css
/* Background */
--bg-primary    : white / zinc-50
--bg-secondary  : zinc-100 / gray-50
--bg-tertiary   : zinc-200 / gray-100

/* Text */
--text-primary   : zinc-900 / gray-900
--text-secondary : zinc-600 / gray-500
--text-tertiary  : zinc-400 / gray-400

/* Brand — pilih SATU palette */
/* Opsi A: Indigo (profesional, tech) */
--brand       : indigo-600
--brand-hover : indigo-700
--brand-light : indigo-50

/* Opsi B: Emerald (segar, modern) */
--brand       : emerald-600
--brand-hover : emerald-700
--brand-light : emerald-50

/* Opsi C: Violet (kreatif, premium) */
--brand       : violet-600
--brand-hover : violet-700
--brand-light : violet-50

/* Border */
--border       : zinc-200 / gray-200
--border-focus : brand-500 (ring)
```

---

## Do / Don't — Contoh Konkret

### ❌ Card Over-designed (NORAK)
```tsx
<div className="bg-white rounded-xl shadow-lg border-2 border-indigo-300 p-4 
     bg-gradient-to-br from-indigo-50 to-white">
  {/* shadow + border + gradient + rounded-xl = TERLALU RAMAI */}
</div>
```

### ✅ Card Bersih (ENAK)
```tsx
<div className="bg-white rounded-lg border border-zinc-200 p-6 
     hover:shadow-sm transition-shadow">
  {/* satu border subtle + hover shadow tipis = elegan */}
</div>
```

---

### ❌ Button Pelangi
```tsx
<button className="bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 
     text-white px-4 py-2 rounded-full shadow-lg">
  Click Me
</button>
```

### ✅ Button Fokus
```tsx
<button className="bg-indigo-600 hover:bg-indigo-700 text-white 
     px-5 py-2.5 rounded-lg font-medium transition-colors 
     focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
  Simpan
</button>
```

---

## Animasi yang Bertaste

```tsx
// ✅ Enter: fade + slide tipis
<motion.div
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.2, ease: 'easeOut' }}
>

// ✅ Exit: fade cepat
<motion.div
  exit={{ opacity: 0 }}
  transition={{ duration: 0.15 }}

// ❌ TERLALU LAMA
transition={{ duration: 0.5 }}     // user nunggu

// ❌ TERLALU RAMAI
initial={{ scale: 0, rotate: 180, opacity: 0 }}  // sirkus
```

---

## Review Cepat (Quick Scan)

Kalau melihat kode dan ragu soal taste, tanyakan:

```
1. "Apa yang paling PENTING di screen ini?" → harus paling menonjol
2. "Ada yang bisa DIHAPUS?" → kalau iya, hapus
3. "Warna ini perlu?" → kalau > 3 warna brand, tidak perlu
4. "Spacing cukup?" → padding < 12px → terlalu padat
5. "Mobile gimana?" → test di 375px width
```
