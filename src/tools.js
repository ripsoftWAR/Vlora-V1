import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

/**
 * Build all tool definitions + their _handler functions
 * Tools are standard OpenAI function-calling format
 */
export function buildTools(scanner) {
  return [

    // ─── READ FILE ──────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Baca isi dari sebuah file dalam project. Gunakan path relatif dari root project.',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path relatif, contoh: src/App.tsx' },
          },
          required: ['file_path'],
        },
      },
      _handler: async ({ file_path }) => {
        const content = await scanner.readFile(file_path);
        if (!content) return `File "${file_path}" tidak ditemukan.`;
        return `=== ${file_path} ===\n${content}`;
      },
    },

    // ─── WRITE / CREATE FILE ─────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Buat file baru atau timpa file yang ada dengan konten baru. Gunakan untuk membuat komponen, utils, config, dll.',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path file relatif dari root project' },
            content: { type: 'string', description: 'Konten lengkap yang akan ditulis ke file' },
          },
          required: ['file_path', 'content'],
        },
      },
      _handler: async ({ file_path, content }) => {
        const fullPath = path.isAbsolute(file_path)
          ? file_path
          : path.join(scanner.projectPath, file_path);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
        scanner._cache.delete(fullPath); // invalidate cache
        return `✅ File "${file_path}" berhasil ditulis (${content.length} chars)`;
      },
    },

    // ─── EDIT FILE (str_replace) ──────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Edit bagian kode tertentu dalam file dengan mencari teks lama dan menggantinya. Lebih aman daripada write_file karena hanya mengubah bagian spesifik.',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path file relatif' },
            old_str: { type: 'string', description: 'Teks yang akan diganti (harus unik dan exact match)' },
            new_str: { type: 'string', description: 'Teks pengganti' },
          },
          required: ['file_path', 'old_str', 'new_str'],
        },
      },
      _handler: async ({ file_path, old_str, new_str }) => {
        const fullPath = path.isAbsolute(file_path)
          ? file_path
          : path.join(scanner.projectPath, file_path);
        if (!existsSync(fullPath)) return `❌ File "${file_path}" tidak ditemukan`;

        const original = await fs.readFile(fullPath, 'utf-8');
        // Normalize line endings & trim whitespace
        const norm = (s) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const trimLines = (s) => s.split('\n').map(l => l.trimEnd()).join('\n');
        const normalOrig = norm(original);
        const normalOld = norm(old_str);
        const normalNew = norm(new_str);
        // Exact match
        let count = normalOrig.split(normalOld).length - 1;
        if (count === 1) {
          const updated = normalOrig.replace(normalOld, normalNew);
          await fs.writeFile(fullPath, updated, 'utf-8');
          scanner._cache.delete(fullPath);
          return `✅ Edit berhasil di "${file_path}"`;
        }
        // Fallback trim
        const trimOrig = trimLines(normalOrig);
        const trimOld = trimLines(normalOld);
        count = trimOrig.split(trimOld).length - 1;
        if (count === 1) {
          const updated = trimOrig.replace(trimOld, normalNew);
          await fs.writeFile(fullPath, updated, 'utf-8');
          scanner._cache.delete(fullPath);
          return `✅ Edit berhasil di "${file_path}" (trim-match)`;
        }
        if (count === 0) return `❌ Teks tidak ditemukan di "${file_path}". Pastikan exact match.`;
        if (count > 1) return `❌ Teks ditemukan ${count}x — terlalu ambigu.`;
        return `❌ Gagal mengedit "${file_path}" — teks tidak cocok setelah normalisasi.`;
      },
    },

    // ─── DELETE FILE ─────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'delete_file',
        description: 'Hapus file dari project. Gunakan dengan hati-hati.',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path file relatif yang akan dihapus' },
          },
          required: ['file_path'],
        },
      },
      _handler: async ({ file_path }) => {
        const fullPath = path.isAbsolute(file_path)
          ? file_path
          : path.join(scanner.projectPath, file_path);
        if (!existsSync(fullPath)) return `File "${file_path}" tidak ditemukan`;
        await fs.unlink(fullPath);
        return `🗑️ File "${file_path}" dihapus`;
      },
    },

    // ─── RUN COMMAND ─────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Jalankan shell command di root project. Gunakan untuk: npm install, npm run build, git status, npx, dll. JANGAN jalankan command berbahaya (rm -rf, dll).',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command yang akan dijalankan' },
            reason: { type: 'string', description: 'Alasan kenapa command ini perlu dijalankan' },
          },
          required: ['command', 'reason'],
        },
      },
      _handler: async ({ command, reason }) => {
        // ── Safety: layered protection ────────────────────────────
        // Layer 1: Blocklist — destructive/irreversible patterns
        const blocked = [
          // Filesystem destruction
          /rm\s+-rf?\s*(\/|\*|~|\.\.?)/i,
          /rm\s+-r\s+(\/|\*)/i,
          /sudo\s+rm/i,
          /:\s*\(\)\s*\{/i,         // fork bomb
          // Format / overwrite disks
          /\bmkfs\b/i,
          /\bdd\s+if=/i,
          /\bshred\b/i,
          // System shutdown
          /\b(shutdown|reboot|halt|poweroff|init\s+[06])\b/i,
          // Dangerous privilege escalation
          /\bchmod\s+777\s+(\/|\*)/i,
          /\bchown\s+-R\s+.*\s+(\/|\*)/i,
        ];
        for (const pattern of blocked) {
          if (pattern.test(command)) {
            return `❌ Command diblokir keamanan: "${command.slice(0, 80)}"`;
          }
        }

        // Layer 2: Allowlist — only known-safe operations
        const allowed = [
          /^(npm|npx|yarn|pnpm|bun)\s/,
          /^(git|gh)\s/,
          /^(node|tsx|ts-node)\s/,
          /^(ls|dir|cat|head|tail|wc|find|grep|which)\s/,
          /^(ps|top|df|du|free)\s/,
          /^(echo|printf|date|whoami|pwd|env)\s/,
          /^(curl|wget)\s/,
          /^(docker|docker-compose)\s/,
          /^(python3?|pip3?|uv)\s/,
        ];
        const isAllowed = allowed.some((p) => p.test(command.trim()));
        if (!isAllowed) {
          return `❌ Command tidak diizinkan untuk keamanan: "${command.slice(0, 80)}"\nHanya command development standar yang diizinkan (npm, git, node, ls, cat, docker, dll).`;
        }

        try {
          const output = execSync(command, {
            cwd: scanner.projectPath,
            timeout: 30000,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          return `$ ${command}\n${output.slice(0, 2000)}${output.length > 2000 ? '\n...[truncated]' : ''}`;
        } catch (err) {
          const stderr = err.stderr?.toString() || '';
          const stdout = err.stdout?.toString() || '';
          return `$ ${command}\n[exit ${err.status}]\n${(stdout + stderr).slice(0, 1000)}`;
        }
      },
    },

    // ─── FETCH CONTEXT7 DOCS ─────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'fetch_docs',
        description: 'Fetch dokumentasi terbaru sebuah library/framework dari Context7 atau GitHub. Berguna untuk cek API terbaru yang mungkin belum ada di training data.',
        parameters: {
          type: 'object',
          properties: {
            library: { type: 'string', description: 'Nama library, contoh: react, nextjs, prisma, tailwindcss, fastapi' },
            topic: { type: 'string', description: 'Topik spesifik yang dicari, contoh: hooks, routing, authentication' },
          },
          required: ['library'],
        },
      },
      _handler: async ({ library, topic }) => {
        // Context7 MCP resolves library IDs - we use their public API pattern
        const queries = [
          `https://context7.com/api/v1/search?q=${encodeURIComponent(library)}`,
        ];

        // Fallback: fetch from common doc sources
        const docSources = {
          react: 'https://raw.githubusercontent.com/reactjs/react.dev/main/src/content/reference/react/hooks.md',
          nextjs: 'https://raw.githubusercontent.com/vercel/next.js/canary/docs/01-getting-started/01-installation.mdx',
          tailwindcss: 'https://raw.githubusercontent.com/tailwindlabs/tailwindcss.com/master/src/pages/docs/installation.mdx',
          prisma: 'https://raw.githubusercontent.com/prisma/docs/main/content/100-getting-started/01-quickstart.mdx',
          vue: 'https://raw.githubusercontent.com/vuejs/docs/main/src/guide/introduction.md',
          fastapi: 'https://raw.githubusercontent.com/tiangolo/fastapi/master/docs/en/docs/index.md',
        };

        const libKey = library.toLowerCase().replace(/[^a-z]/g, '');

        try {
          const url = docSources[libKey] || `https://raw.githubusercontent.com/${library}/${library}/main/README.md`;
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();

          // Filter to topic if specified
          let result = text.slice(0, 4000);
          if (topic) {
            const lines = text.split('\n');
            const topicRegex = new RegExp(topic, 'i');
            const relevantLines = [];
            let capture = false;
            for (const line of lines) {
              if (topicRegex.test(line)) { capture = true; }
              if (capture) relevantLines.push(line);
              if (relevantLines.length > 80) break;
            }
            if (relevantLines.length > 0) result = relevantLines.join('\n');
          }

          return `📚 Docs: ${library}${topic ? ` → ${topic}` : ''}\n\n${result}`;
        } catch (err) {
          return `⚠️ Gagal fetch docs untuk "${library}": ${err.message}\nCoba cari manual di: https://context7.com`;
        }
      },
    },

    // ─── LIST FILES ──────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'Tampilkan struktur folder dan file project dalam bentuk tree.',
        parameters: {
          type: 'object',
          properties: {
            depth: { type: 'number', description: 'Kedalaman tree (1-5, default 3)' },
          },
        },
      },
      _handler: async ({ depth = 3 }) => {
        const tree = await scanner.getTree(Math.min(depth, 5));
        return `Project tree (${scanner.projectPath}):\n${tree}`;
      },
    },

    // ─── FIND FILES ──────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'find_files',
        description: 'Cari file berdasarkan nama atau pola regex.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Pola pencarian, contoh: "Header", "api", "\\.test\\.tsx$"' },
          },
          required: ['pattern'],
        },
      },
      _handler: async ({ pattern }) => {
        const files = await scanner.findFiles(pattern, 20);
        if (files.length === 0) return `Tidak ada file cocok dengan "${pattern}"`;
        return `File matching "${pattern}":\n${files.map((f) => `  • ${f}`).join('\n')}`;
      },
    },

    // ─── SEARCH IN FILES ─────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'search_in_files',
        description: 'Cari teks atau kode tertentu di dalam semua file project.',
        parameters: {
          type: 'object',
          properties: {
            search_term: { type: 'string', description: 'Teks atau regex yang dicari' },
            extensions: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter ekstensi, contoh: [".ts", ".tsx"]',
            },
          },
          required: ['search_term'],
        },
      },
      _handler: async ({ search_term, extensions = null }) => {
        const results = await scanner.grepFiles(search_term, extensions);
        if (results.length === 0) return `"${search_term}" tidak ditemukan`;
        return results
          .map((r) => `📄 ${r.file}\n${r.matches.map((m) => `   L${m.line}: ${m.content.slice(0, 100)}`).join('\n')}`)
          .join('\n\n');
      },
    },

    // ─── READ MULTIPLE FILES ─────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'read_multiple_files',
        description: 'Baca beberapa file sekaligus (max 5).',
        parameters: {
          type: 'object',
          properties: {
            file_paths: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array path file',
            },
          },
          required: ['file_paths'],
        },
      },
      _handler: async ({ file_paths }) => {
        const results = [];
        for (const fp of file_paths.slice(0, 5)) {
          const content = await scanner.readFile(fp);
          const preview = content
            ? (content.length > 2000 ? content.slice(0, 2000) + '\n...[truncated]' : content)
            : '[Tidak ditemukan]';
          results.push(`=== ${fp} ===\n${preview}`);
        }
        return results.join('\n\n');
      },
    },

    // ─── DETECT TECH STACK ───────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'detect_tech_stack',
        description: 'Deteksi tech stack, framework, library yang digunakan project.',
        parameters: { type: 'object', properties: {} },
      },
      _handler: async () => {
        const stack = await scanner.detectTechStack();
        const keyFiles = await scanner.findKeyFiles();
        return `Tech stack: ${stack.join(', ')}\nKey files: ${keyFiles.join(', ')}`;
      },
    },

    // ─── FIND UI COMPONENTS ──────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'find_ui_components',
        description: 'Temukan semua komponen UI dalam project.',
        parameters: {
          type: 'object',
          properties: {
            filter: { type: 'string', description: 'Filter nama komponen' },
          },
        },
      },
      _handler: async ({ filter = '' }) => {
        let components = await scanner.findUIComponents();
        if (filter) components = components.filter((c) => c.toLowerCase().includes(filter.toLowerCase()));
        if (components.length === 0) return 'Tidak ada komponen UI ditemukan';
        return `Komponen UI (${components.length}):\n${components.map((c) => `  • ${c}`).join('\n')}`;
      },
    },

    // ═══════════════════════════════════════════════════════════════
    // 🖥️  DESKTOP TOOLS — Microsoft Office COM Automation
    // ═══════════════════════════════════════════════════════════════
    // Tools ini memungkinkan agent mengontrol Word, Excel, dan PowerPoint
    // langsung di desktop Windows — ghost worker mode.
    //
    // Cara kerja: Node.js → spawn Python subprocess → COM → Office App
    //
    // ⚠️  HANYA BERFUNGSI DI WINDOWS DENGAN MICROSOFT OFFICE TERINSTALL.
    //     Di Linux/macOS, tools ini return fallback error "Windows only".
    // ═══════════════════════════════════════════════════════════════

    // ─── WORD: Inject teks ───────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'word_inject',
        description: 'Tulis teks langsung ke dokumen Word yang sedang aktif (Ghost typing). Bisa ngetik di posisi cursor, di bookmark tertentu, atau di halaman tertentu. Gunakan untuk: menulis konten, mengisi template, mengetik prolog/bab, dll.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['write_at_cursor', 'write_at_bookmark', 'write_at_page', 'write_at_position', 'replace_selection'],
              description: 'write_at_cursor=ketik di posisi cursor (ghost mode), write_at_bookmark=tulis di bookmark, write_at_page=tulis di halaman tertentu, replace_selection=ganti teks yang sedang dipilih',
            },
            text: { type: 'string', description: 'Teks yang akan diketik/ditulis' },
            typing_speed: { type: 'number', description: 'Kecepatan ghost typing (detik per karakter). 0 = instant, 0.01 = cepat, 0.05 = seperti manusia' },
            bookmark: { type: 'string', description: 'Nama bookmark (hanya untuk action=write_at_bookmark)' },
            page: { type: 'number', description: 'Nomor halaman (hanya untuk action=write_at_page)' },
            press_enter: { type: 'boolean', description: 'Enter di akhir tulisan' },
          },
          required: ['action', 'text'],
        },
      },
      _handler: async (args) => {
        try {
          const { sendCommand } = await import('./desktop.js');
          const result = await sendCommand('word', {
            action: args.action,
            text: args.text,
            typing_speed: args.typing_speed || 0,
            bookmark: args.bookmark || '',
            page: args.page || 1,
            press_enter: args.press_enter || false,
          });
          if (!result.success) {
            return `⚠️ Word: ${result.error || 'Gagal'}`;
          }
          return `✅ Word: ${result.result?.action || args.action} — ${args.text.slice(0, 100)}...`;
        } catch (err) {
          if (err.code === 'PLATFORM_NOT_SUPPORTED') {
            const os = await import('os');
            return `🖥️  Word bridge tidak tersedia di ${os.default?.platform?.() || os.platform()}. Fitur ini hanya untuk Windows dengan Microsoft Office.`;
          }
          return `⚠️ Word bridge error: ${err.message}`;
        }
      },
    },

    // ─── WORD: Baca dokumen ──────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'word_read',
        description: 'Baca isi dokumen Word yang sedang aktif. Berguna untuk: analisis dokumen, cari konten spesifik, deteksi typo, dll.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['get_active_document', 'get_selection', 'read_full_document', 'read_page', 'get_document_info'],
              description: 'get_active_document=info dokumen, get_selection=teks yg dipilih, read_full_document=baca semua teks, read_page=baca halaman tertentu',
            },
            max_chars: { type: 'number', description: 'Maksimal karakter yang dibaca (default 10000)' },
            page: { type: 'number', description: 'Nomor halaman (hanya untuk read_page)' },
            include_text: { type: 'boolean', description: 'Sertakan teks dalam response' },
          },
          required: ['action'],
        },
      },
      _handler: async (args) => {
        try {
          const { sendCommand } = await import('./desktop.js');
          const result = await sendCommand('word', {
            action: args.action,
            max_chars: args.max_chars || 10000,
            page: args.page || 1,
            include_text: args.include_text || false,
          });
          if (!result.success) {
            return `⚠️ Word read: ${result.error}`;
          }
          const data = result.result || result;
          return `📄 Word Document:\n${JSON.stringify(data, null, 2).slice(0, 2000)}`;
        } catch (err) {
          if (err.code === 'PLATFORM_NOT_SUPPORTED') {
            return `🖥️  Word bridge tidak tersedia. Hanya Windows.`;
          }
          return `⚠️ Word read error: ${err.message}`;
        }
      },
    },

    // ─── WORD: Format & Perbaikan ────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'word_format',
        description: 'Format dan perbaiki dokumen Word. Bisa format selection, alignment, spacing, cari typo, dll. Gunakan untuk: merapihkan paragraf, standardisasi font, perbaiki typo massal.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['format_selection', 'format_paragraph', 'format_document', 'fix_typos', 'fix_alignment', 'fix_spacing', 'fix_fonts', 'find_replace', 'find_replace_all', 'apply_style'],
              description: 'format_selection=format teks terpilih, fix_typos=perbaiki typo otomatis, fix_alignment=rapihkan alignment, find_replace=cari ganti teks',
            },
            // Format params
            bold: { type: 'boolean' },
            italic: { type: 'boolean' },
            font_size: { type: 'number', description: 'Ukuran font' },
            font_name: { type: 'string', description: 'Nama font (Calibri, Arial, Times New Roman, dll)' },
            alignment: { type: 'string', enum: ['left', 'center', 'right', 'justify'], description: 'Perataan paragraf' },
            // Find/Replace params
            find: { type: 'string', description: 'Teks yang dicari (untuk find_replace)' },
            replace: { type: 'string', description: 'Teks pengganti (untuk find_replace)' },
            language: { type: 'string', description: 'Bahasa untuk spell check (default: id)' },
            style: { type: 'string', description: 'Nama style Word (Normal, Heading 1, dll)' },
            scope: { type: 'string', enum: ['selection', 'document'], description: 'Scope operasi' },
          },
          required: ['action'],
        },
      },
      _handler: async (args) => {
        try {
          const { sendCommand } = await import('./desktop.js');
          const result = await sendCommand('word', {
            action: args.action,
            bold: args.bold,
            italic: args.italic,
            font_size: args.font_size,
            font_name: args.font_name,
            alignment: args.alignment,
            find: args.find,
            replace: args.replace,
            language: args.language || 'id',
            style: args.style,
            scope: args.scope || 'selection',
          });
          if (!result.success) {
            return `⚠️ Word format: ${result.error}`;
          }
          return `✅ Word format: ${JSON.stringify(result.result || result).slice(0, 500)}`;
        } catch (err) {
          if (err.code === 'PLATFORM_NOT_SUPPORTED') {
            return `🖥️  Word format tidak tersedia. Hanya Windows.`;
          }
          return `⚠️ Word format error: ${err.message}`;
        }
      },
    },

    // ─── EXCEL: Inject data ──────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'excel_inject',
        description: 'Tulis data ke Excel. Bisa tulis cell, range, formula, insert row/column. Gunakan untuk: input data massal, terapkan formula, isi template spreadsheet.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['write_cell', 'write_range', 'write_at_cursor', 'apply_formula', 'insert_row', 'insert_column'],
              description: 'write_cell=tulis satu cell, write_range=tulis range 2D, apply_formula=terapkan formula, insert_row=sisip baris',
            },
            cell: { type: 'string', description: 'Referensi cell (A1, B2, dll) — untuk write_cell' },
            range: { type: 'string', description: 'Range (A1:C10) — untuk write_range, apply_formula' },
            value: { type: 'string', description: 'Nilai cell — untuk write_cell, write_at_cursor' },
            data: {
              type: 'array',
              items: { type: 'array' },
              description: 'Data 2D array [[kolom1, kolom2], ...] — untuk write_range',
            },
            formula: { type: 'string', description: 'Formula Excel (=SUM(A1:A10)) — untuk apply_formula' },
          },
          required: ['action'],
        },
      },
      _handler: async (args) => {
        try {
          const { sendCommand } = await import('./desktop.js');
          const result = await sendCommand('excel', {
            action: args.action,
            cell: args.cell || 'A1',
            range: args.range || 'A1',
            value: args.value || '',
            data: args.data || [],
            formula: args.formula || '',
          });
          if (!result.success) return `⚠️ Excel: ${result.error}`;
          return `✅ Excel: ${JSON.stringify(result.result || result).slice(0, 500)}`;
        } catch (err) {
          if (err.code === 'PLATFORM_NOT_SUPPORTED') return `🖥️  Excel bridge: Windows only.`;
          return `⚠️ Excel error: ${err.message}`;
        }
      },
    },

    // ─── EXCEL: Baca & Analisis ──────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'excel_read',
        description: 'Baca data dari Excel. Bisa baca range, cari error, cari duplikat, deteksi inkonsistensi. Gunakan untuk: audit data, cek ribuan baris, cari kesalahan.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['get_active_workbook', 'get_selection', 'get_range', 'get_used_range', 'find_errors', 'find_in_range', 'find_typos_in_text', 'find_inconsistencies', 'highlight_duplicates'],
              description: 'get_range=baca range, find_errors=cari cell error (#VALUE!, dll), find_typos_in_text=cari potensi typo, find_inconsistencies=cari format campuran',
            },
            range: { type: 'string', description: 'Range yang dibaca/dianalisis' },
            query: { type: 'string', description: 'Teks yang dicari (untuk find_in_range)' },
            max_rows: { type: 'number', description: 'Maks baris yang dibaca (default: 1000)' },
          },
          required: ['action'],
        },
      },
      _handler: async (args) => {
        try {
          const { sendCommand } = await import('./desktop.js');
          const result = await sendCommand('excel', {
            action: args.action,
            range: args.range || '',
            query: args.query || '',
            max_rows: args.max_rows || 1000,
          });
          if (!result.success) return `⚠️ Excel read: ${result.error}`;
          return `📊 Excel Data:\n${JSON.stringify(result.result || result, null, 2).slice(0, 3000)}`;
        } catch (err) {
          if (err.code === 'PLATFORM_NOT_SUPPORTED') return `🖥️  Excel bridge: Windows only.`;
          return `⚠️ Excel read error: ${err.message}`;
        }
      },
    },

    // ─── EXCEL: Format & Perbaikan ───────────────────────────────
    {
      type: 'function',
      function: {
        name: 'excel_format',
        description: 'Format dan perbaiki spreadsheet Excel. Bisa format range, auto-fit, sort, filter, normalize text, fix number format.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['format_range', 'auto_fit_columns', 'auto_fit_rows', 'sort_range', 'filter_range', 'normalize_text', 'fix_number_format', 'merge_cells', 'unmerge_cells', 'clear_range'],
              description: 'format_range=format cell, sort_range=urutkan, normalize_text=trim/proper/upper/lower, fix_number_format=perbaiki format angka',
            },
            range: { type: 'string', description: 'Range yang di-format' },
            bold: { type: 'boolean' },
            font_size: { type: 'number' },
            horizontal_alignment: { type: 'string', enum: ['left', 'center', 'right'] },
            number_format: { type: 'string', description: 'Format angka ($#,##0.00, #,##0, dll)' },
            key_column: { type: 'number', description: 'Kolom untuk sort (1-indexed)' },
            order: { type: 'string', enum: ['asc', 'desc'], description: 'Urutan sort' },
            mode: { type: 'string', enum: ['trim', 'proper', 'upper', 'lower'], description: 'Mode normalisasi teks' },
          },
          required: ['action'],
        },
      },
      _handler: async (args) => {
        try {
          const { sendCommand } = await import('./desktop.js');
          const result = await sendCommand('excel', {
            action: args.action,
            range: args.range || '',
            bold: args.bold,
            font_size: args.font_size,
            horizontal_alignment: args.horizontal_alignment,
            number_format: args.number_format,
            key_column: args.key_column,
            order: args.order,
            mode: args.mode,
          });
          if (!result.success) return `⚠️ Excel format: ${result.error}`;
          return `✅ Excel format: ${JSON.stringify(result.result || result).slice(0, 500)}`;
        } catch (err) {
          if (err.code === 'PLATFORM_NOT_SUPPORTED') return `🖥️  Excel format: Windows only.`;
          return `⚠️ Excel format error: ${err.message}`;
        }
      },
    },

    // ─── POWERPOINT: Inject & Edit ───────────────────────────────
    {
      type: 'function',
      function: {
        name: 'ppt_inject',
        description: 'Tulis dan edit slide PowerPoint. Bisa tulis teks, tambah textbox, tambah slide baru, format slide elements. Gunakan untuk: mengisi konten slide, memperbaiki presentasi.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['write_to_slide', 'add_textbox', 'add_slide', 'delete_slide', 'duplicate_slide'],
              description: 'write_to_slide=tulis ke placeholder/shape, add_textbox=tambah textbox baru, add_slide=tambah slide baru',
            },
            text: { type: 'string', description: 'Teks yang ditulis' },
            placeholder_index: { type: 'number', description: 'Index placeholder (1=judul, 2=subtitle, dll)' },
            shape_name: { type: 'string', description: 'Nama shape spesifik' },
            layout: { type: 'string', enum: ['blank', 'title', 'text', 'two_content', 'comparison', 'title_only'], description: 'Layout slide baru' },
            left: { type: 'number', description: 'Posisi X textbox' },
            top: { type: 'number', description: 'Posisi Y textbox' },
            width: { type: 'number', description: 'Lebar textbox' },
            height: { type: 'number', description: 'Tinggi textbox' },
            font_size: { type: 'number', description: 'Ukuran font' },
          },
          required: ['action'],
        },
      },
      _handler: async (args) => {
        try {
          const { sendCommand } = await import('./desktop.js');
          const result = await sendCommand('powerpoint', {
            action: args.action,
            text: args.text || '',
            placeholder_index: args.placeholder_index,
            shape_name: args.shape_name || '',
            layout: args.layout || 'blank',
            left: args.left || 50,
            top: args.top || 100,
            width: args.width || 400,
            height: args.height || 50,
            font_size: args.font_size || 18,
          });
          if (!result.success) return `⚠️ PPT: ${result.error}`;
          return `✅ PowerPoint: ${JSON.stringify(result.result || result).slice(0, 500)}`;
        } catch (err) {
          if (err.code === 'PLATFORM_NOT_SUPPORTED') return `🖥️  PowerPoint bridge: Windows only.`;
          return `⚠️ PPT error: ${err.message}`;
        }
      },
    },

    // ─── POWERPOINT: Baca presentasi ─────────────────────────────
    {
      type: 'function',
      function: {
        name: 'ppt_read',
        description: 'Baca konten presentasi PowerPoint. Bisa lihat slide aktif, daftar semua slide, baca konten slide tertentu.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['get_active_presentation', 'get_current_slide', 'get_all_slides', 'get_slide_content'],
              description: 'get_active_presentation=info presentasi, get_current_slide=slide aktif, get_all_slides=daftar semua slide, get_slide_content=baca konten slide',
            },
            slide: { type: 'number', description: 'Nomor slide (untuk get_slide_content)' },
            max_slides: { type: 'number', description: 'Maks slide yang dilist (default 50)' },
          },
          required: ['action'],
        },
      },
      _handler: async (args) => {
        try {
          const { sendCommand } = await import('./desktop.js');
          const result = await sendCommand('powerpoint', {
            action: args.action,
            slide: args.slide || 1,
            max_slides: args.max_slides || 50,
          });
          if (!result.success) return `⚠️ PPT read: ${result.error}`;
          return `📊 PowerPoint:\n${JSON.stringify(result.result || result, null, 2).slice(0, 2000)}`;
        } catch (err) {
          if (err.code === 'PLATFORM_NOT_SUPPORTED') return `🖥️  PowerPoint bridge: Windows only.`;
          return `⚠️ PPT read error: ${err.message}`;
        }
      },
    },

    // ─── POWERPOINT: Format presentasi ───────────────────────────
    {
      type: 'function',
      function: {
        name: 'ppt_format',
        description: 'Format slide PowerPoint. Bisa format teks, atur alignment, standardisasi font, atur transisi slide.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['format_text', 'change_layout', 'fix_font_size', 'fix_alignment', 'fix_bullet_spacing', 'set_transition'],
              description: 'format_text=format teks di shape, fix_font_size=standardisasi ukuran font, fix_alignment=rata teks, set_transition=atur transisi slide',
            },
            font_size: { type: 'number', description: 'Ukuran font' },
            font_name: { type: 'string', description: 'Nama font' },
            alignment: { type: 'string', enum: ['left', 'center', 'right', 'justify'], description: 'Alignment teks' },
            bold: { type: 'boolean' },
            layout: { type: 'string', enum: ['blank', 'title', 'text', 'two_content'], description: 'Layout baru' },
            transition: { type: 'string', enum: ['none', 'fade', 'push', 'wipe', 'zoom'], description: 'Jenis transisi' },
            duration: { type: 'number', description: 'Durasi transisi (detik)' },
            shape_name: { type: 'string', description: 'Nama shape yang diformat' },
          },
          required: ['action'],
        },
      },
      _handler: async (args) => {
        try {
          const { sendCommand } = await import('./desktop.js');
          const result = await sendCommand('powerpoint', {
            action: args.action,
            font_size: args.font_size || 18,
            font_name: args.font_name || '',
            alignment: args.alignment || 'left',
            bold: args.bold,
            layout: args.layout || 'blank',
            transition: args.transition || 'fade',
            duration: args.duration || 1.0,
            shape_name: args.shape_name || '',
          });
          if (!result.success) return `⚠️ PPT format: ${result.error}`;
          return `✅ PPT format: ${JSON.stringify(result.result || result).slice(0, 500)}`;
        } catch (err) {
          if (err.code === 'PLATFORM_NOT_SUPPORTED') return `🖥️  PowerPoint format: Windows only.`;
          return `⚠️ PPT format error: ${err.message}`;
        }
      },
    },

  ];
}