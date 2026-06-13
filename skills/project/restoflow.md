---
name: restoflow
version: "0.1.0"
scope: project
description: "Context spesifik project RestoFlow — restaurant management app"
---

# 🍽️ RestoFlow — Project Context

## Tentang Project
RestoFlow adalah aplikasi manajemen restoran.
Stack: React 19 + Vite + Express + TypeScript + PostgreSQL + Google Gemini AI.

---

## Dependencies Penting

| Package | Kegunaan |
|---------|---------|
| `@google/genai` | Google Gemini AI integration |
| `pg` | PostgreSQL client |
| `express` | Backend REST API |
| `bcryptjs` | Password hashing (auth) |
| `framer-motion` | Animasi UI |
| `recharts` | Chart & grafik (dashboard) |
| `lucide-react` | Icon library |
| `tailwindcss v4` | Styling (pakai `@tailwindcss/vite`) |

---

## Script yang Sering Dipakai

```bash
npm run dev          # frontend (Vite)
npm run dev:server   # backend (tsx watch)
npm run build        # build frontend + backend
npm run lint         # TypeScript check (tsc --noEmit)
```

> 💡 Untuk dev, jalankan **dua terminal** — satu `dev`, satu `dev:server`

---

## Hal yang Perlu Diingat

- Tailwind v4 pakai `@tailwindcss/vite` — konfigurasinya beda dari v3
  - Tidak ada `tailwind.config.js` → config langsung di CSS atau `vite.config.ts`
- Google Gemini pakai `@google/genai` v2 — API-nya berbeda dari versi lama
- Build server pakai `esbuild` dengan `--packages=external` → node_modules tidak di-bundle
- `tsx` untuk dev server, bukan `ts-node` langsung (lebih cepat)

---

## Pola AI Integration (Google Gemini)

```typescript
// Contoh pola yang dipakai di project ini
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const response = await ai.models.generateContent({
  model: 'gemini-2.0-flash',
  contents: [{ role: 'user', parts: [{ text: prompt }] }],
});
```

---

## Kalau Ada Error Umum

**`Cannot find module` di server:**
→ Cek apakah path import sudah pakai ekstensi `.js` (bukan `.ts`)
→ ESM di Node wajib ekstensi eksplisit

**Tailwind class tidak muncul:**
→ Cek apakah `@tailwindcss/vite` sudah terdaftar di `vite.config.ts`
→ Tailwind v4 tidak perlu `content` config — auto-detect

**PostgreSQL connection error:**
→ Cek `DATABASE_URL` di `.env`
→ Format: `postgresql://user:password@localhost:5432/dbname`

**Gemini API error:**
→ Cek `GEMINI_API_KEY` di `.env`
→ Pastikan model name valid: `gemini-2.0-flash` atau `gemini-1.5-pro`
