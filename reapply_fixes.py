#!/usr/bin/env python3
"""
Re-apply semua fix yang hilang setelah git reset.
Jalankan dari root project: python3 reapply_fixes.py
Aman dijalankan berkali-kali (idempotent - skip kalau fix udah ada).
"""

def patch(filepath, old, new, label):
    try:
        with open(filepath, 'r') as f:
            content = f.read()
    except FileNotFoundError:
        print(f"❌ SKIP [{label}] — file tidak ditemukan: {filepath}")
        return

    if new in content:
        print(f"✅ SUDAH ADA [{label}] — skip, tidak perlu patch lagi")
        return

    if old not in content:
        print(f"⚠️  GAGAL [{label}] — teks pencarian tidak ketemu di {filepath}")
        print(f"    (kemungkinan struktur file sudah beda, perlu cek manual)")
        return

    content = content.replace(old, new, 1)
    with open(filepath, 'w') as f:
        f.write(content)
    print(f"✅ BERHASIL [{label}] — {filepath}")


# ── FIX 1: agent.js — panggil sanitasi sebelum _callAPI ──────────────
patch(
    'src/agent.js',
    """      // 4b. Call LLM
      const callStart = Date.now();
      let response;
      try {
        response = await this._callAPI({ systemPrompt, messages: windowMessages, tools });""",
    """      // 4a-2. Sanitasi: buang 'tool' message yatim (tool_call_id-nya tidak
      // punya pasangan assistant.tool_calls di window ini). Jaga-jaga
      // kalau sliding window / compression memotong pasangan tool_calls/tool.
      const sanitizedMessages = this._sanitizeToolPairs(windowMessages);

      // 4b. Call LLM
      const callStart = Date.now();
      let response;
      try {
        response = await this._callAPI({ systemPrompt, messages: sanitizedMessages, tools });""",
    "agent.js: panggil sanitasi sebelum API call"
)

# ── FIX 2: agent.js — tambah method _sanitizeToolPairs ────────────────
patch(
    'src/agent.js',
    """  async _executeTool(name, args, tools) {""",
    """  _sanitizeToolPairs(messages) {
    const result = [];
    let pendingIds = null;

    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        pendingIds = new Set(msg.tool_calls.map((tc) => tc.id));
        result.push(msg);
        continue;
      }

      if (msg.role === 'tool') {
        if (pendingIds && pendingIds.has(msg.tool_call_id)) {
          result.push(msg);
          pendingIds.delete(msg.tool_call_id);
          if (pendingIds.size === 0) pendingIds = null;
        }
        continue;
      }

      pendingIds = null;
      result.push(msg);
    }

    return result;
  }

  async _executeTool(name, args, tools) {""",
    "agent.js: method _sanitizeToolPairs"
)

# ── FIX 3: prompts.js — aturan langsung edit, jangan tanya ─────────────
patch(
    'src/prompts.js',
    """## ⚠️ ATURAN EKSEKUSI MULTI-STEP
- Task "tambah/edit kode" SELALU butuh MINIMAL 2 tool call: read_file lalu edit_file (atau write_file).""",
    """## ⚠️ ATURAN EKSEKUSI MULTI-STEP
- Task "tambah/edit/perbaiki/optimasi kode", termasuk "analisa lalu benerin", "cari bottleneck",
  "audit performa", atau permintaan APAPUN yang berujung pada perubahan file, SELALU butuh
  MINIMAL 2 tool call: read_file lalu edit_file (atau write_file).
- JANGAN PERNAH mengakhiri giliran dengan laporan/daftar temuan lalu bertanya "lanjut ke
  implementasi?" — itu DILARANG. Begitu kamu sudah tahu apa yang perlu diubah dan di file mana,
  LANGSUNG panggil edit_file/write_file di giliran yang SAMA, untuk SEMUA temuan sekaligus.
- Kalau user memang HANYA minta "analisa" tanpa menyebut kata "perbaiki/benerin/fix" sama sekali,
  baru boleh berhenti di laporan tanpa edit. Kalau ada indikasi apapun user ingin masalah
  diselesaikan (kata "kenapa lambat", "kok error", "benerin", "fix", "optimasi"), itu = task edit.""",
    "prompts.js: aturan langsung edit tanpa nanya"
)

# ── FIX 4: tools.js — isAbsolute check di edit_file ────────────────────
patch(
    'src/tools.js',
    """      _handler: async ({ file_path, old_str, new_str }) => {
        const fullPath = path.join(scanner.projectPath, file_path);""",
    """      _handler: async ({ file_path, old_str, new_str }) => {
        const fullPath = path.isAbsolute(file_path)
          ? file_path
          : path.join(scanner.projectPath, file_path);""",
    "tools.js: isAbsolute check di edit_file"
)

# ── FIX 5: tools.js — isAbsolute check di write_file ───────────────────
patch(
    'src/tools.js',
    """      _handler: async ({ file_path, content }) => {
        const fullPath = path.join(scanner.projectPath, file_path);""",
    """      _handler: async ({ file_path, content }) => {
        const fullPath = path.isAbsolute(file_path)
          ? file_path
          : path.join(scanner.projectPath, file_path);""",
    "tools.js: isAbsolute check di write_file"
)

# ── FIX 6: tools.js — isAbsolute check di delete_file ──────────────────
patch(
    'src/tools.js',
    """      _handler: async ({ file_path }) => {
        const fullPath = path.join(scanner.projectPath, file_path);
        if (!existsSync(fullPath)) return `File "${file_path}" tidak ditemukan`;""",
    """      _handler: async ({ file_path }) => {
        const fullPath = path.isAbsolute(file_path)
          ? file_path
          : path.join(scanner.projectPath, file_path);
        if (!existsSync(fullPath)) return `File "${file_path}" tidak ditemukan`;""",
    "tools.js: isAbsolute check di delete_file"
)

# ── FIX 7: package.json — script "dev" salah nunjuk ke next dev ────────
patch(
    'package.json',
    '"dev": "next dev",',
    '"dev": "node server.js",',
    "package.json: fix script dev"
)

print("\n" + "="*60)
print("SELESAI. Verifikasi manual dengan:")
print('  grep -n "_sanitizeToolPairs" src/agent.js')
print('  grep -n "DILARANG" src/prompts.js')
print('  grep -n "isAbsolute" src/tools.js')
print('  grep -n \'"dev":\' package.json')
