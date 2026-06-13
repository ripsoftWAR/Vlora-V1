---
name: react-nextjs
version: "1.0.0"  
description: "Konvensi React & Next.js App Router"
---

# React / Next.js Rules

## Stack
- Next.js App Router (bukan Pages Router)
- Tailwind CSS untuk styling
- shadcn/ui untuk komponen
- Zustand / React Query untuk state

## Konvensi Komponen
- Server Component by default
- Tambah 'use client' hanya kalau perlu interaktivitas
- Props selalu pakai TypeScript interface (meski JS, tulis JSDoc)

## Aturan
- Jangan pakai useEffect untuk data fetching → pakai server component
- Image selalu pakai next/image
- Link selalu pakai next/link
- Loading state pakai loading.js, error pakai error.js