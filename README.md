# 🔬 Vlora V1 — Project Analyst Agent

AI Agent fullstack untuk analisis mendalam kode dan UI/UX, dengan kemampuan membaca, mengedit, dan menjalankan kode secara langsung. Powered by **DeepSeek V3** via OpenRouter.

## ✨ Fitur

- **Deep Code Analysis** — baca, pahami, dan jelaskan alur kode secara mendalam
- **Edit & Write Code** — agent bisa langsung tulis/edit file di project kamu
- **Run Commands** — eksekusi npm, build, test langsung dari chat
- **UI/UX Understanding** — analisis komponen, design pattern, user flow
- **Fetch Docs** — ambil dokumentasi library terbaru otomatis
- **NVIDIA Skills** — install skill NVIDIA (RAG, NeMo, dll) dengan `/skill add`
- **Persistent Memory** — ingat konteks percakapan antar sesi per-project
- **Web UI** — frontend React untuk chat tanpa terminal
- **Folder Picker** — upload project langsung dari browser

## 🏗️ Arsitektur
Frontend (React + Vite + TypeScript)  ← Vercel

↕ REST API

Backend (Express + Node.js)           ← Railway

↕ Tool Calling Loop

Agent (DeepSeek V3 via OpenRouter)

├── read_file / write_file / edit_file

├── run_command

├── fetch_docs

├── search_in_files

└── find_ui_components

↕

Memory (JSON per-project) + Skills (NVIDIA)

## 📦 Instalasi

```bash
git clone https://github.com/ripsoftWAR/Vlora-V1.git
cd Vlora-V1
npm install
cd frontend && npm install && cd ..
```

## 🔑 Setup API Key

Buat file `.env` di root project:

```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxx
AI_MODEL=deepseek/deepseek-chat-v3-0324
```

Dapatkan API key gratis di **https://openrouter.ai/keys**

## 🚀 Jalankan Lokal

```bash
# Terminal 1 — Backend
node server.js /path/ke/project-yang-dianalisis

# Terminal 2 — Frontend
cd frontend
npm run dev
```

Buka **http://localhost:5173**

## 💬 Cara Pakai

### Via Web UI
1. Buka browser → `http://localhost:5173`
2. Klik **"Pilih Folder Project"** → pilih folder project kamu
3. Mulai tanya ke agent

### Via Terminal
```bash
node index.js /path/ke/project
```

### Contoh Pertanyaan
→ Jelaskan arsitektur keseluruhan project ini

→ Bagaimana alur autentikasi dari login sampai dapat token?

→ Review komponen Header dari sisi UI/UX

→ Temukan potensi bug atau security issue

→ Buatkan komponen Button dengan Tailwind CSS

→ Trace alur data dari form submit sampai database

→ Optimasi performa project ini

## ⌨️ Commands Terminal

| Command | Fungsi |
|---------|--------|
| `/skill add <nama>` | Install NVIDIA skill |
| `/skill list` | Lihat skills terinstall |
| `/skill available` | Semua skill di catalog |
| `/tree` | Tampilkan struktur folder |
| `/scan` | Deep scan ulang project |
| `/memory` | Lihat isi memory |
| `/reset` | Hapus memory project |
| `/help` | Bantuan |
| `/exit` | Keluar |

## 🤖 Model yang Didukung

| Provider | Model | Kecepatan | Kualitas |
|----------|-------|-----------|----------|
| OpenRouter | `deepseek/deepseek-chat-v3-0324` | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ |
| OpenRouter | `deepseek/deepseek-r1` | ⚡⚡ | ⭐⭐⭐⭐⭐ |
| OpenRouter | `meta-llama/llama-3.3-70b-instruct:free` | ⚡⚡ | ⭐⭐⭐⭐ |
| DeepSeek | `deepseek-chat` | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ |
| NVIDIA | `meta/llama-3.3-70b-instruct` | ⚡⚡ | ⭐⭐⭐⭐ |

## 📁 Struktur Project
Vlora-V1/

├── index.js              ← Terminal REPL

├── server.js             ← Backend Express API

├── src/

│   ├── agent.js          ← Core agent + agentic loop

│   ├── scanner.js        ← Project file scanner

│   ├── memory.js         ← Persistent memory sistem

│   ├── tools.js          ← Tool definitions + handlers

│   ├── skills.js         ← NVIDIA Skills manager

│   ├── prompts.js        ← System prompt builder

│   └── colors.js         ← Terminal colors

├── frontend/             ← React + Vite + TypeScript

│   └── src/

│       └── App.tsx       ← Web UI utama

├── skills/               ← NVIDIA Skills tersimpan

├── memory/               ← Memory per-project (auto-created)

└── .env                  ← API keys (jangan di-commit!)

## 🛠️ Tools Agent

| Tool | Fungsi |
|------|--------|
| `read_file` | Baca isi file |
| `write_file` | Buat/timpa file |
| `edit_file` | Edit bagian kode (str_replace) |
| `delete_file` | Hapus file |
| `run_command` | Jalankan shell command |
| `fetch_docs` | Fetch docs library terbaru |
| `list_files` | Tampilkan tree folder |
| `find_files` | Cari file by nama/pattern |
| `search_in_files` | Grep teks di seluruh project |
| `find_ui_components` | Temukan komponen UI |
| `detect_tech_stack` | Deteksi teknologi project |

## 🚀 Deploy

### Backend → Railway
```bash
railway login
railway init
railway variables set AI_PROVIDER=openrouter
railway variables set OPENROUTER_API_KEY=sk-or-v1-xxx
railway variables set AI_MODEL=deepseek/deepseek-chat-v3-0324
railway up
```

### Frontend → Vercel
```bash
cd frontend
vercel
```

Set environment variable di Vercel:
VITE_API_URL=https://your-backend.railway.app

## 📄 License

MIT © 2026 Finework Technology
