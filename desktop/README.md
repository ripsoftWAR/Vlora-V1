# 🖥️ Desktop Office Bridges — Vlora-V1 Ghost Worker

Framework ini memungkinkan AI agent **mengetik langsung** di Microsoft Word, Excel, dan PowerPoint.
Seperti punya **ghost worker** di dalam Office-mu.

## 📋 Prasyarat

| Kebutuhan | Detail |
|-----------|--------|
| **OS** | Windows 10/11 (COM Automation hanya Windows) |
| **Office** | Microsoft Office 2016+ (Word, Excel, PowerPoint) |
| **Python** | Python 3.8+ terinstall di PATH |
| **pywin32** | `pip install -r desktop/requirements.txt` |

## 🚀 Instalasi

```bash
# 1. Install Python dependencies
pip install -r desktop/requirements.txt

# Atau kalau cuma butuh pywin32:
pip install pywin32

# 2. Verifikasi instalasi
python desktop/bridge_manager.py doctor
```

## 🧪 Testing

Cek apakah Office dan pywin32 siap:

```bash
# Diagnosa lengkap
python desktop/bridge_manager.py doctor

# Contoh output:
# 🩺 Office Bridge Diagnosis
#    Platform: win32
#    pywin32: ✅
#    Aplikasi Office:
#      ✅ word (running)
#      ✅ excel
#      ✅ powerpoint
```

## 🎯 Usage

### Bridge langsung (standalone)
```bash
# Jalankan Word bridge — dia akan connect ke Word yang sedang running
python -m desktop.word_bridge --debug

# Kirim command via stdin (satu baris JSON per command)
{"action": "get_active_document"}
{"action": "write_at_cursor", "text": "Halo, ini ghost!", "typing_speed": 0.01}
{"action": "exit"}
```

### Via Node.js (dari agent framework)
```javascript
import { sendCommand } from './src/desktop.js';

// Word: ghost typing
await sendCommand('word', {
  action: 'write_at_cursor',
  text: 'Prolog BAB 1: Ini adalah awal dari segalanya...',
  typing_speed: 0.02, // delay per karakter (detik)
});

// Excel: cari error di ribuan baris
const result = await sendCommand('excel', {
  action: 'find_errors',
  range: 'A1:Z10000',
});
console.log(`Ditemukan ${result.errors?.length} error`);

// PowerPoint: bikin slide baru
await sendCommand('powerpoint', {
  action: 'add_slide',
  layout: 'title',
});
```

### Via agent framework
Framework agent (Vlora-V1) sudah punya tools bawaan:

```
word_inject → word_read → word_format
excel_inject → excel_read → excel_format
ppt_inject → ppt_read → ppt_format
```

## 🏗️ Arsitektur

```
┌──────────────────────────────────────────────┐
│            Agent Framework (Node.js)          │
│  agent.js → chatStream → tool call           │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│         src/desktop.js (Node.js middleware)   │
│   - spawn Python subprocess                   │
│   - stdin/stdout JSON protocol                │
│   - connection pooling                        │
│   - timeout & error handling                  │
│   - platform check (Windows only)             │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│      Python COM Bridge (subprocess)           │
│   desktop/word_bridge.py                      │
│   desktop/excel_bridge.py                     │
│   desktop/powerpoint_bridge.py                │
│   desktop/bridge_manager.py                   │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│      Microsoft Office (COM Automation)        │
│   Word.Application                            │
│   Excel.Application                           │
│   PowerPoint.Application                      │
└──────────────────────────────────────────────┘
```

## 📡 Protokol Komunikasi

Bridge berkomunikasi via **stdin/stdout** dengan format **JSON per baris**:

**→ Input (stdin):**
```json
{"action": "write_at_cursor", "text": "Halo", "typing_speed": 0.01, "_cmdId": "word_123"}
```

**← Output (stdout):**
```json
{"success": true, "result": {"action": "write_at_cursor", "chars_typed": 4, "ghost_mode": false}, "app": "Word.Application"}
```

## 🔒 Keamanan

1. **Eksplisit**: Setiap aksi harus dari perintah user/tool call — tidak ada ghost action otomatis
2. **Read-only default**: Operasi baca selalu diizinkan, operasi tulis butuh parameter eksplisit
3. **Destructive protection**: Penghapusan/overwrite butuh konfirmasi (via UI layer)
4. **Windows-only**: Kode tidak bisa dijalankan di Linux/Mac — error graceful
5. **Timeout**: 30 detik default, bridge hang akan direstart

## 🧹 Troubleshooting

### "pywin32 not installed"
```bash
pip install pywin32
# Kalau gagal, coba:
python -m pip install pywin32
```

### "Cannot get active document"
Pastikan Office aplikasi **sedang berjalan** dan ada dokumen terbuka.

### "Bridge not responding in 30000ms"
Biasanya karena Office menampilkan dialog (save, error, dll). Tutup dialognya.

### COM Error: "Method x not found"
Versi Office mungkin beda. Coba cek mapping method di dokumentasi VBA.

## 📁 File Structure

```
desktop/
├── __init__.py              # Package init (kosong)
├── bridge_manager.py        # CLI manager & dispatcher
├── office_base.py           # Base class COM bridge
├── word_bridge.py           # Word operations (30+ actions)
├── excel_bridge.py          # Excel operations (30+ actions)
├── powerpoint_bridge.py     # PowerPoint operations (25+ actions)
├── requirements.txt         # Python dependencies
└── README.md               # Dokumentasi ini
```
