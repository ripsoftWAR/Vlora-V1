# 🔬 Project Analyst Agent

AI Agent berbasis Node.js yang berjalan di terminal untuk analisis mendalam project kode dan UI/UX, menggunakan **NVIDIA NIM API** dengan tool-calling dan persistent memory.

## ✨ Fitur

- **Deep Code Analysis** — baca, pahami, dan jelaskan alur kode
- **UI/UX Understanding** — analisis komponen, design pattern, user flow
- **Tool Calling** — agent secara otomatis baca file yang relevan sebelum menjawab
- **Persistent Memory** — ingat konteks percakapan antar sesi per-project
- **Multi-project** — bisa diarahkan ke project manapun

## 📦 Instalasi

```bash
# Clone / copy folder ini ke komputermu
cd project-analyst-agent

# Install dependencies
npm install

# Beri permission eksekusi
chmod +x index.js
```

## 🔑 Setup NVIDIA API Key

1. Buka https://build.nvidia.com
2. Login / daftar akun
3. Klik **"Get API Key"**
4. Copy API key (format: `nvapi-xxxx`)

```bash
# Set di environment variable
export NVIDIA_API_KEY=nvapi-xxxxxxxxxxxxxxxx

# Opsional: pilih model (default: meta/llama-3.3-70b-instruct)
export NVIDIA_MODEL=meta/llama-3.3-70b-instruct
```

## 🚀 Cara Pakai

```bash
# Analisis project di folder saat ini
node index.js

# Analisis project di path tertentu
node index.js /path/ke/project-kamu

# Contoh
node index.js ~/projects/my-react-app
node index.js /home/user/backend-api
node index.js .   # folder saat ini
```

## 💬 Contoh Pertanyaan

```
you ▶ Jelaskan arsitektur keseluruhan project ini
you ▶ Bagaimana alur autentikasi dari login sampai dapat token?
you ▶ Review komponen Header dari sisi UI/UX
you ▶ Apa saja potensi bug atau security issue yang kamu temukan?
you ▶ Bagaimana state management diimplementasikan?
you ▶ Buat dokumentasi untuk file src/api/users.ts
you ▶ Apa yang bisa dioptimasi untuk performa?
you ▶ Jelaskan design system yang digunakan
you ▶ Trace alur data dari form submit sampai database
```

## ⌨️ Commands

| Command | Fungsi |
|---------|--------|
| `/tree` | Tampilkan struktur folder |
| `/scan` | Deep scan ulang project |
| `/memory` | Lihat isi memory sesi ini |
| `/reset` | Hapus memory project ini |
| `/help` | Bantuan |
| `/exit` | Keluar |

## 🤖 Model NVIDIA yang Tersedia

| Model | Kecepatan | Kualitas |
|-------|-----------|----------|
| `meta/llama-3.3-70b-instruct` | ⚡⚡ | ⭐⭐⭐⭐⭐ |
| `meta/llama-3.1-8b-instruct` | ⚡⚡⚡ | ⭐⭐⭐ |
| `mistralai/mixtral-8x22b-instruct-v0.1` | ⚡ | ⭐⭐⭐⭐⭐ |
| `nvidia/llama3-chatqa-1.5-70b` | ⚡⚡ | ⭐⭐⭐⭐ |

## 📁 Struktur Project

```
project-analyst-agent/
├── index.js          ← Entry point, terminal REPL
├── src/
│   ├── agent.js      ← Core agent + agentic loop
│   ├── scanner.js    ← Project file scanner
│   ├── memory.js     ← Persistent memory sistem
│   ├── tools.js      ← Tool definitions + handlers
│   └── prompts.js    ← System prompt builder
├── memory/           ← Memory files disimpan di sini (auto-created)
└── package.json
```

## 🧠 Cara Kerja Memory

Memory disimpan per-project di folder `memory/` sebagai file JSON.
Setiap project punya ID unik berdasarkan path-nya.

```json
{
  "projectPath": "/home/user/my-app",
  "messages": [...],
  "summary": "Ringkasan otomatis setelah 20+ pesan",
  "facts": ["Menggunakan React 18 dengan TypeScript", ...],
  "decisions": [...]
}
```

Setelah 20 pesan, agent otomatis meringkas percakapan untuk efisiensi context window.
# Vlora-V1
