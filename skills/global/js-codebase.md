---
name: js-codebase
version: "1.0.0"
description: "Konvensi kode JavaScript/Node.js project ini"
---

# JS Codebase Rules

## Stack
- Runtime: Node.js ESM (import/export, bukan require)
- Framework: Express / Next.js App Router
- Style: camelCase untuk variable, PascalCase untuk class
- File naming: kebab-case (contoh: skill-manager.js)

## Struktur Folder
src/
  agent.js      → core agent loop
  tools.js      → tool definitions
  skills.js     → skill manager
  prompts.js    → system prompt builder
  memory/       → conversation memory
  skills/       → skill files (.md)
.agents/skills/ → skill via npx

## Aturan Coding Agent
- Selalu gunakan async/await, bukan .then()
- Error handling wajib pakai try/catch dengan pesan Bahasa Indonesia
- Jangan hardcode path, pakai process.cwd() + path.join()
- Setiap fungsi baru wajib ada JSDoc singkat

## Contoh Pattern yang Dipakai
// ✅ Benar
const result = await skillManager.listInstalledNames();

// ❌ Hindari  
skillManager.listInstalled().then(r => ...)