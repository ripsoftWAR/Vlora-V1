import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

/**
 * Build all tool definitions + their _handler functions
 * Tools are standard OpenAI function-calling format
 */
export function buildTools(scanner) {
    // 🕵️ Hidden tools — tidak muncul di daftar tools yang terlihat
    // Tapi bisa dipanggil oleh agent secara internal
    const hiddenTools = {};

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
                        description: { type: 'string', description: 'Penjelasan bahasa manusia tentang apa yang dilakukan (wajib diisi)' },
                    },
                    required: ['file_path', 'description'],
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
                        description: { type: 'string', description: 'Penjelasan bahasa manusia tentang apa yang dilakukan (wajib diisi)' },
                    },
                    required: ['file_path', 'content', 'description'],
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
                        description: { type: 'string', description: 'Penjelasan bahasa manusia tentang apa yang dilakukan (wajib diisi)' },
                    },
                    required: ['file_path', 'old_str', 'new_str', 'description'],
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
                        description: { type: 'string', description: 'Penjelasan bahasa manusia tentang apa yang dilakukan (wajib diisi)' },
                    },
                    required: ['file_path', 'description'],
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
                        description: { type: 'string', description: 'Penjelasan bahasa manusia tentang apa yang dilakukan (wajib diisi)' },
                    },
                    required: ['command', 'reason', 'description'],
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
                        description: { type: 'string', description: 'Penjelasan bahasa manusia tentang apa yang dilakukan (wajib diisi)' },
                    },
                    required: ['library', 'description'],
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
                        description: { type: 'string', description: 'Penjelasan bahasa manusia tentang apa yang dilakukan (wajib diisi)' },
                    },
                    required: ['description'],
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
                        description: { type: 'string', description: 'Penjelasan bahasa manusia tentang apa yang dilakukan (wajib diisi)' },
                    },
                    required: ['pattern', 'description'],
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
                        description: { type: 'string', description: 'Penjelasan bahasa manusia tentang apa yang dilakukan (wajib diisi)' },
                    },
                    required: ['search_term', 'description'],
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
                        description: { type: 'string', description: 'Penjelasan bahasa manusia tentang apa yang dilakukan (wajib diisi)' },
                    },
                    required: ['file_paths', 'description'],
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
                parameters: {
                    type: 'object',
                    properties: {
                        description: { type: 'string', description: 'Penjelasan bahasa manusia tentang apa yang dilakukan (wajib diisi)' },
                    },
                    required: ['description'],
                },
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
                        description: { type: 'string', description: 'Penjelasan bahasa manusia tentang apa yang dilakukan (wajib diisi)' },
                    },
                    required: ['description'],
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

        // ─── WORD: Exec Python (Kompleks) ────────────────────────────
        {
            type: 'function',
            function: {
                name: 'word_exec',
                description: 'Eksekusi Python code langsung ke Word via COM. Gunakan untuk operasi kompleks: buat tabel, set warna, format presisi, buat invoice. SELALU gunakan ini untuk Word kompleks, JANGAN write_file + run_command.',
                parameters: {
                    type: 'object',
                    properties: {
                        code: { type: 'string', description: 'Python code. Variabel word dan doc sudah tersedia.' },
                        timeout: { type: 'number', description: 'Timeout detik (default 30)' },
                    },
                    required: ['code'],
                },
            },
            _handler: async (args) => {
                try {
                    const { sendCommand } = await import('./desktop.js');
                    const result = await sendCommand('word', {
                        action: 'exec_python',
                        code: args.code,
                        timeout: args.timeout || 30,
                    });
                    if (!result.success) return `⚠️ word_exec: ${result.error}`;
                    return `✅ word_exec selesai`;
                } catch (err) {
                    return `⚠️ word_exec error: ${err.message}`;
                }
            },
        },

        // ═══════════════════════════════════════════════════════════════
        // 🧊 BLENDER 3D — 3D Modelling & Export via Blender Bridge
        // ═══════════════════════════════════════════════════════════════
        // Tools ini memungkinkan agent membuat, memodifikasi, dan mengekspor
        // model 3D menggunakan Blender 5.2.
        //
        // Cara kerja: Node.js → spawn Python subprocess → Blender (headless)
        //
        // Semua output file disimpan di: D:\VloraWorkspace\models\
        //
        // ⚠️  Membutuhkan Blender 5.2 terinstall di:
        //     C:\Program Files\Blender Foundation\Blender 5.2\blender.exe
        // ═══════════════════════════════════════════════════════════════

        // ─── BLENDER: Create & Edit 3D Models ────────────────────────
        {
            type: 'function',
            function: {
                name: 'blender_inject',
                description: 'Buat, modifikasi, dan export model 3D via Blender 5.2. Bisa create mesh primitif (cube, sphere, cylinder, cone, torus, plane, monkey), apply material (principled, metallic, glass, emission, glossy), apply modifier (subdivision_surface, bevel, mirror, array, solidify, decimate, screw), boolean operation, dan export ke berbagai format.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: [
                                'create_mesh', 'modify_object', 'apply_material',
                                'delete_object', 'apply_modifier', 'boolean_operation',
                                'clear_scene', 'export_model', 'render_viewport',
                                'get_scene_info', 'run_script', 'exec_python',
                            ],
                            description: 'create_mesh=buat mesh primitive, modify_object=ubah posisi/rotasi/scale, apply_material=terapkan material, delete_object=hapus object, apply_modifier=terapkan modifier (subsurf, bevel, mirror, dll), boolean_operation=boolean difference/union/intersect, clear_scene=bersihkan scene, export_model=export ke format 3D (obj/fbx/glb/stl/blend), render_viewport=render viewport ke PNG, get_scene_info=info semua object di scene, run_script=jalankan Python script custom, exec_python=sama dengan run_script',
                        },
                        // ── Create / Modify params ──
                        mesh_type: {
                            type: 'string',
                            enum: ['cube', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'monkey', 'circle', 'grid'],
                            description: 'Tipe mesh primitif (untuk action=create_mesh)',
                        },
                        obj_name: { type: 'string', description: 'Nama object target (untuk modify, delete, material, modifier)' },
                        location: {
                            type: 'array',
                            items: { type: 'number' },
                            minItems: 3,
                            maxItems: 3,
                            description: 'Posisi [x, y, z] dalam meter. Contoh: [0, 0, 0]',
                        },
                        rotation: {
                            type: 'array',
                            items: { type: 'number' },
                            minItems: 3,
                            maxItems: 3,
                            description: 'Rotasi Euler [x, y, z] dalam radians. Contoh: [0, 0, 0]',
                        },
                        scale: {
                            type: 'array',
                            items: { type: 'number' },
                            minItems: 3,
                            maxItems: 3,
                            description: 'Scale [x, y, z]. Contoh: [1, 1, 1]',
                        },
                        name: { type: 'string', description: 'Nama object baru (untuk create_mesh)' },
                        size: { type: 'number', description: 'Ukuran cube/plane (default: 2)' },
                        radius: { type: 'number', description: 'Radius sphere/cylinder/cone/torus/circle (default: 1)' },
                        depth: { type: 'number', description: 'Kedalaman cylinder/cone (default: 2)' },
                        vertices: { type: 'number', description: 'Jumlah vertex untuk cylinder/cone/circle (default: 32)' },
                        segments: { type: 'number', description: 'Segmen untuk sphere/torus (default: 32)' },

                        // ── Material params ──
                        material: {
                            type: 'string',
                            enum: ['principled', 'emission', 'glass', 'metallic', 'glossy'],
                            description: 'Tipe material (untuk action=apply_material)',
                        },
                        color: {
                            type: 'array',
                            items: { type: 'number' },
                            minItems: 4,
                            maxItems: 4,
                            description: 'Warna RGBA [r, g, b, a] 0.0-1.0. Contoh: [0.8, 0.2, 0.2, 1.0]',
                        },

                        // ── Modifier params ──
                        modifier_type: {
                            type: 'string',
                            enum: ['subdivision_surface', 'bevel', 'mirror', 'array', 'solidify', 'decimate', 'screw'],
                            description: 'Tipe modifier (untuk action=apply_modifier)',
                        },
                        levels: { type: 'number', description: 'Subdivision levels (default: 2)' },
                        width: { type: 'number', description: 'Bevel width / Solidify thickness (default: 0.1/0.02)' },
                        count: { type: 'number', description: 'Array count (default: 3)' },
                        thickness: { type: 'number', description: 'Solidify thickness (default: 0.1)' },
                        ratio: { type: 'number', description: 'Decimate ratio 0.0-1.0 (default: 0.5)' },

                        // ── Boolean params ──
                        obj_a: { type: 'string', description: 'Object A untuk boolean operation' },
                        obj_b: { type: 'string', description: 'Object B untuk boolean operation' },
                        operation: {
                            type: 'string',
                            enum: ['DIFFERENCE', 'UNION', 'INTERSECT'],
                            description: 'Boolean operation type (default: DIFFERENCE)',
                        },

                        // ── Export params ──
                        format: {
                            type: 'string',
                            enum: ['obj', 'fbx', 'glb', 'stl', 'blend'],
                            description: 'Format export (untuk action=export_model). Default: glb',
                        },
                        filename: { type: 'string', description: 'Nama file export tanpa extension' },

                        // ── Script / Code ──
                        script: { type: 'string', description: 'Python script untuk Blender (untuk action=run_script). bpy sudah tersedia.' },
                        code: { type: 'string', description: 'Sama seperti script (untuk action=exec_python)' },
                        timeout: { type: 'number', description: 'Timeout dalam detik (default: 120)' },
                    },
                    required: ['action'],
                },
            },
            _handler: async (args) => {
                try {
                    const { sendCommand } = await import('./desktop.js');
                    const result = await sendCommand('blender', args, { timeout: (args.timeout || 120) * 1000 });

                    if (!result.success) {
                        const errDetail = result.error || 'Gagal';
                        return `⚠️ Blender: ${errDetail}`;
                    }

                    const data = result.result || result;

                    // Format response berdasarkan action
                    if (data.success === false) {
                        return `⚠️ Blender error: ${data.error || 'Unknown'}`;
                    }

                    const action = args.action || '';

                    if (action === 'get_scene_info') {
                        const info = data.result?.scene_info || data.scene_info;
                        if (info) {
                            let summary = `📊 **Blender Scene Info**\n`;
                            summary += `├─ Objects: ${info.objects?.length || 0}\n`;
                            summary += `├─ Materials: ${info.materials?.length || 0}\n`;
                            summary += `├─ World: ${info.world || 'None'}\n`;
                            summary += `└─ Frames: ${info.frames || 'N/A'}\n\n`;

                            if (info.objects?.length > 0) {
                                summary += `**Objects:**\n`;
                                for (const obj of info.objects.slice(0, 15)) {
                                    summary += `  • ${obj.name} (${obj.type}) — verts:${obj.vertices}, poly:${obj.polygons}\n`;
                                }
                                if (info.objects.length > 15) {
                                    summary += `  ... dan ${info.objects.length - 15} object lainnya\n`;
                                }
                            }
                            return summary;
                        }
                    }

                    if (action === 'export_model') {
                        const exported = data.result?.exported_files || data.exported_files || [];
                        const blend = data.result?.blend_file || data.blend_file;
                        let msg = `✅ **Blender Export Berhasil!**\n`;
                        if (exported.length > 0) {
                            msg += `├─ Exported files:\n`;
                            for (const f of exported) {
                                msg += `│  • ${f}\n`;
                            }
                        }
                        if (blend) msg += `└─ .blend saved: ${blend}\n`;
                        return msg;
                    }

                    if (action === 'render_viewport') {
                        const rendered = data.result?.rendered_file || data.rendered_file;
                        if (rendered) {
                            return `✅ **Render selesai!**\n📁 ${rendered}`;
                        }
                    }

                    if (action === 'create_mesh') {
                        const created = data.result?.objects_created || data.objects_created || [];
                        const blend = data.result?.blend_file || data.blend_file;
                        let msg = `✅ **Mesh created: ${created.join(', ') || args.mesh_type}**\n`;
                        if (blend) msg += `📁 .blend: ${blend}\n`;
                        return msg;
                    }

                    if (action === 'run_script' || action === 'exec_python') {
                        const output = data.output || data.result?.output || '';
                        const err = data.error || data.result?.error;
                        let msg = `✅ **Script executed**\n`;
                        if (output) msg += `📝 Output:\n${output.slice(0, 1000)}\n`;
                        if (err) msg += `⚠️ Warnings: ${err.slice(0, 500)}\n`;
                        return msg;
                    }

                    // Generic response
                    return `✅ **Blender: ${action}** berhasil\n${JSON.stringify(data).slice(0, 500)}`;
                } catch (err) {
                    if (err.code === 'PLATFORM_NOT_SUPPORTED') {
                        return `🖥️  Blender bridge tidak tersedia di platform ini. Hanya Windows dengan Blender 5.2.`;
                    }
                    return `⚠️ Blender bridge error: ${err.message}`;
                }
            },
        },

        // ═══════════════════════════════════════════════════════════════
        // 🧊 BLENDER SOCKET — 3D Modelling via TCP Socket (Live Blender)
        // ═══════════════════════════════════════════════════════════════
        //
        // BEDA dengan blender_inject (headless):
        //   blender_inject         → spawn Blender --background, eksekusi, exit
        //   blender_socket_inject  → konek ke Blender yang SUDAH TERBUKA via TCP:9999
        //
        // Kelebihan socket mode:
        //   - Blender TETAP TERBUKA — user bisa lihat perubahan real-time
        //   - Eksekusi lebih cepat — tidak perlu start/stop Blender tiap kali
        //   - Bisa iterasi cepat: create → modify → check → create lagi
        //
        // ⚠️  SYARAT: blender_socket_server.py harus sudah jalan di Blender!
        //     Buka Blender → Scripting → Open → run file itu.
        //
        // ═══════════════════════════════════════════════════════════════

        // ─── BLENDER SOCKET: Live Code Execution ─────────────────────
        {
            type: 'function',
            function: {
                name: 'blender_socket_inject',
                description: 'Kirim kode Python ke Blender yang sedang berjalan (live via TCP :9999). Blender TETAP TERBUKA — user lihat perubahan real-time. Jauh lebih cepat dari blender_inject (headless) karena tidak perlu start/stop Blender tiap kali. Gunakan untuk: create/edit material, buat mesh, modify scene live.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['exec_code', 'run_script', 'eval', 'get_scene_info',
                                'ping', 'create_mesh', 'clear_scene', 'export_model',
                                'render_viewport'],
                            description: 'exec_code=kirim Python code (bpy available), run_script=alias exec_code, eval=evaluasi expression cepat, ping=cek koneksi, get_scene_info=info scene live, create_mesh=buat mesh primitif, clear_scene=bersihkan scene, export_model=export ke file',
                        },
                        code: {
                            type: 'string',
                            description: 'Kode Python untuk dieksekusi. Variabel yang tersedia: bpy, C (bpy.context), D (bpy.data), bmesh, mathutils, Vector, Matrix. Helper functions: add_cube(), add_sphere(), add_cylinder(), new_scene(), save_blend(), export_obj(), export_fbx(), export_glb(), list_objects(), select(name), delete(name), scene_info(), boolean_diff(a,b), boolean_union(a,b), set_material(name, color, type)',
                        },
                        expression: {
                            type: 'string',
                            description: 'Expression Python untuk dievaluasi (hanya untuk action=eval). Contoh: "len(bpy.data.objects)"',
                        },
                        // ── Create Mesh ──
                        mesh_type: {
                            type: 'string',
                            enum: ['cube', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'monkey'],
                            description: 'Tipe mesh (untuk action=create_mesh)',
                        },
                        name: { type: 'string', description: 'Nama object baru' },
                        location: {
                            type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
                            description: 'Posisi [x, y, z]',
                        },
                        size: { type: 'number', description: 'Ukuran cube/plane' },
                        radius: { type: 'number', description: 'Radius sphere/cylinder/cone/torus' },
                        depth: { type: 'number', description: 'Kedalaman cylinder/cone' },
                        segments: { type: 'number', description: 'Segmen sphere/torus' },
                        // ── Export ──
                        format: {
                            type: 'string', enum: ['obj', 'fbx', 'glb', 'stl', 'blend'],
                            description: 'Format export (untuk action=export_model)',
                        },
                        filename: { type: 'string', description: 'Nama file export' },
                        // ── Render ──
                        resolution_x: { type: 'number', description: 'Resolusi X render (default 1920)' },
                        resolution_y: { type: 'number', description: 'Resolusi Y render (default 1080)' },
                    },
                    required: ['action'],
                },
            },
            _handler: async (args) => {
                try {
                    const { sendCommand } = await import('./desktop.js');
                    const action = args.action || 'run_script';

                    // Peta action & params
                    let command;
                    switch (action) {
                        case 'exec_code':
                        case 'run_script':
                            command = {
                                action: 'run_script',
                                code: args.code || '',
                                main_thread: args.main_thread || false,
                            };
                            if (!command.code) return `⚠️ Parameter 'code' wajib diisi untuk action ${action}`;
                            break;

                        case 'eval':
                            command = {
                                action: 'eval',
                                expression: args.expression || '',
                            };
                            if (!command.expression) return `⚠️ Parameter 'expression' wajib diisi untuk action eval`;
                            break;

                        case 'ping':
                            command = { action: 'ping' };
                            break;

                        case 'get_scene_info':
                            command = { action: 'get_scene_info' };
                            break;

                        case 'create_mesh':
                            command = {
                                action: 'create_mesh',
                                mesh_type: args.mesh_type || 'cube',
                                size: args.size,
                                radius: args.radius,
                                depth: args.depth,
                                segments: args.segments,
                                location: args.location || [0, 0, 0],
                                name: args.name || `live_${args.mesh_type || 'mesh'}`,
                            };
                            break;

                        case 'clear_scene':
                            command = { action: 'clear_scene' };
                            break;

                        case 'export_model':
                            command = {
                                action: 'export_model',
                                format: args.format || 'blend',
                                filename: args.filename || 'live_export',
                            };
                            break;

                        case 'render_viewport':
                            command = {
                                action: 'render_viewport',
                                filename: args.filename || 'live_render',
                                resolution_x: args.resolution_x || 1920,
                                resolution_y: args.resolution_y || 1080,
                            };
                            break;

                        default:
                            // Fallback: kirim sebagai raw code
                            command = {
                                action: 'run_script',
                                code: args.code || '',
                            };
                    }

                    const result = await sendCommand('blender-socket', command, {
                        timeout: 180000, // 3 menit untuk operasi berat
                    });

                    if (!result.success) {
                        const msg = result.error || 'Gagal';
                        // Deteksi pesan error khas
                        if (msg.includes('tidak bisa konek') || msg.includes('Connection refused')) {
                            return `⚠️ **Blender tidak terhubung!**

🔌 **Cara konek:**
1. Buka Blender (pastikan sudah install)
2. Buka tab **Scripting** → **Text Editor**
3. File → Open → pilih \`desktop/blender_socket_server.py\`
4. Klik **Run Script** (Alt+P)
5. Cek console: "🧊 Blender Socket Server: ✅ OK → 127.0.0.1:9999"
6. Kirim command ini lagi!

📋 File server ada di: ${require('path').resolve(__dirname, '../desktop/blender_socket_server.py')}`;
                        }
                        return `⚠️ Blender Socket: ${msg}`;
                    }

                    const data = result.result || result;

                    // ── Format response ──────────────────────────────────────
                    if (action === 'ping') {
                        const blender = data.blender;
                        if (blender) {
                            return `✅ **Blender Terhubung!** 🧊
   Version: ${data.blender_version || '?'}
   Objects: ${data.objects_count || '?'}`;
                        }
                        return `✅ Bridge siap, tapi Blender belum terhubung.
   Jalankan blender_socket_server.py di Blender dulu!`;
                    }

                    if (action === 'get_scene_info') {
                        const scene = data.scene || data;
                        let msg = `📊 **Blender Scene (Live)**\n`;
                        msg += `├─ Scene: ${scene.name || '?'}\n`;
                        msg += `├─ Objects: ${scene.objects?.length || 0}\n`;
                        msg += `├─ Materials: ${scene.materials?.length || 0}\n`;
                        msg += `└─ Collections: ${scene.collections?.length || 0}\n\n`;

                        if (scene.objects?.length > 0) {
                            for (const obj of scene.objects.slice(0, 10)) {
                                msg += `  • ${obj.name} (${obj.type}) — ${obj.verts || 0}v\n`;
                            }
                            if (scene.objects.length > 10) {
                                msg += `  ... dan ${scene.objects.length - 10} lainnya\n`;
                            }
                        }
                        return msg;
                    }

                    if (action === 'eval') {
                        return `🔢 **Hasil Evaluasi:** ${data.value || data.result || '(no value)'}`;
                    }

                    if (action === 'create_mesh') {
                        return `✅ **Mesh dibuat live!** 🧊
   Type: ${args.mesh_type || 'cube'}
   Name: ${args.name || ''}
   Location: ${JSON.stringify(args.location || [0, 0, 0])}`;
                    }

                    if (action === 'export_model') {
                        return `✅ **Export selesai!** 📁
   Format: ${args.format || 'blend'}
   File: ${args.filename || 'live_export'}`;
                    }

                    if (action === 'render_viewport') {
                        return `✅ **Render selesai!** 📸
   File: ${args.filename || 'live_render'}.png
   Resolusi: ${args.resolution_x || 1920}x${args.resolution_y || 1080}`;
                    }

                    if (action === 'clear_scene') {
                        return `✅ **Scene dibersihkan!** Semua object dihapus.`;
                    }

                    // ── exec_code / run_script — tampilkan output ──────────
                    const stdout = data.stdout || data.output || '';
                    const stderr = data.stderr || data.error || '';
                    const hasError = data.success === false;

                    let msg = hasError
                        ? `⚠️ **Script Error di Blender:**\n`
                        : `✅ **Script dieksekusi live!** 🧊\n`;

                    if (stdout) {
                        // Abridge output
                        const lines = stdout.split('\n').filter(l => l.trim()).slice(0, 20);
                        msg += `📝 Output:\n\`\`\`\n${lines.join('\n').slice(0, 1500)}\n\`\`\`\n`;
                        if (lines.length > 20) msg += `... (${lines.length - 20} baris lagi)\n`;
                    }

                    if (stderr) {
                        msg += `⚠️ Stderr:\n\`\`\`\n${stderr.slice(0, 500)}\n\`\`\`\n`;
                    }

                    if (hasError) {
                        msg += `❌ Error: ${data.error || 'Unknown'}\n`;
                    }

                    return msg;

                } catch (err) {
                    if (err.code === 'PLATFORM_NOT_SUPPORTED') {
                        return `🖥️  Blender Socket bridge tersedia di semua platform! 
   Cuma butuh Python + Blender terinstall.
   
   Jalankan blender_socket_server.py DI DALAM BLENDER dulu.`;
                    }
                    return `⚠️ Blender Socket error: ${err.message}`;
                }
            },
        },

        // ═══════════════════════════════════════════════════════════════
        // 🧊 FREECAD — 3D Parametric Modelling via FreeCAD Bridge
        // ═══════════════════════════════════════════════════════════════
        // Tools ini memungkinkan agent membuat, memodifikasi, dan mengekspor
        // model 3D parametic menggunakan FreeCAD.
        //
        // Cara kerja: Node.js → spawn Python subprocess → FreeCADCmd.exe (headless)
        //
        // Semua output file disimpan di: D:\VloraWorkspace\models\
        //
        // Format export: .step, .stl, .obj, .iges, .FCStd
        //
        // ⚠️  Membutuhkan FreeCAD terinstall di:
        //     C:\Program Files\FreeCAD 1.0\bin\FreeCADCmd.exe
        // ═══════════════════════════════════════════════════════════════

        // ─── FREECAD: Create & Edit 3D Models (Headless) ─────────────
        {
            type: 'function',
            function: {
                name: 'freecad_inject',
                description: 'Buat, modifikasi, dan export model 3D parametric via FreeCAD (headless). Bisa create primitive (box, cylinder, sphere, cone, torus), boolean operation (cut, fuse, common), export ke STEP/STL/OBJ/IGES/FCStd. Cocok untuk engineering design, precision modelling. Lebih lambat dari socket mode karena restart FreeCAD tiap command.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: [
                                'create_mesh', 'modify_object', 'delete_object',
                                'clear_scene', 'export_model',
                                'get_scene_info', 'run_script', 'exec_python',
                            ],
                            description: 'create_mesh=buat primitive (box/cylinder/sphere/cone/torus), modify_object=ubah posisi, delete_object=hapus, clear_scene=bersihkan, export_model=export ke file, get_scene_info=info scene, run_script=jalankan Python custom',
                        },
                        mesh_type: {
                            type: 'string',
                            enum: ['box', 'cylinder', 'sphere', 'cone', 'torus'],
                            description: 'Tipe primitive (untuk action=create_mesh)',
                        },
                        obj_name: { type: 'string', description: 'Nama object target (untuk modify_object, delete_object)' },
                        location: {
                            type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
                            description: 'Posisi [x, y, z] dalam mm. Contoh: [0, 0, 0]',
                        },
                        name: { type: 'string', description: 'Nama object baru' },
                        size: { type: 'number', description: 'Ukuran box (panjang=lebar=tinggi) dalam mm (default: 10)' },
                        radius: { type: 'number', description: 'Radius cylinder/sphere/cone/torus (default: 5)' },
                        depth: { type: 'number', description: 'Tinggi cylinder/cone (default: 10)' },
                        radius2: { type: 'number', description: 'Radius2 torus (minor radius, default: 2)' },
                        format: {
                            type: 'string', enum: ['step', 'stl', 'obj', 'iges', 'fcstd'],
                            description: 'Format export (untuk action=export_model). Default: step',
                        },
                        filename: { type: 'string', description: 'Nama file export tanpa extension' },
                        script: { type: 'string', description: 'Python script untuk FreeCAD (untuk action=run_script). FreeCAD, App, Part, Mesh sudah tersedia.' },
                        code: { type: 'string', description: 'Sama seperti script (untuk action=exec_python)' },
                        timeout: { type: 'number', description: 'Timeout dalam detik (default: 120)' },
                    },
                    required: ['action'],
                },
            },
            _handler: async (args) => {
                try {
                    const { sendCommand } = await import('./desktop.js');
                    const result = await sendCommand('freecad', args, { timeout: (args.timeout || 120) * 1000 });

                    if (!result.success) {
                        const errDetail = result.error || 'Gagal';
                        return `⚠️ FreeCAD: ${errDetail}`;
                    }

                    const data = result.result || result;
                    if (data.success === false) {
                        return `⚠️ FreeCAD error: ${data.error || 'Unknown'}`;
                    }

                    const action = args.action || '';

                    if (action === 'get_scene_info') {
                        const info = data.result?.scene_info || data.scene_info;
                        if (info) {
                            let summary = `📊 **FreeCAD Scene Info**\n`;
                            const docs = info.documents || [];
                            summary += `├─ Documents: ${docs.length}\n`;
                            if (docs.length > 0) {
                                for (const doc of docs) {
                                    summary += `├─ 📄 ${doc.name}: ${doc.objects?.length || 0} objects\n`;
                                    for (const obj of (doc.objects || []).slice(0, 10)) {
                                        summary += `│  • ${obj.name} (${obj.type})`;
                                        if (obj.faces !== undefined) summary += ` — ${obj.faces}f/${obj.edges}e/${obj.vertices}v`;
                                        if (obj.volume) summary += ` vol:${obj.volume.toFixed(1)}`;
                                        summary += '\n';
                                    }
                                    if ((doc.objects || []).length > 10) {
                                        summary += `│  ... dan ${doc.objects.length - 10} object lainnya\n`;
                                    }
                                }
                            }
                            return summary;
                        }
                        return `📊 FreeCAD Scene: ${JSON.stringify(info || data).slice(0, 1000)}`;
                    }

                    if (action === 'export_model') {
                        const exported = data.result?.exported_files || data.exported_files || [];
                        const fcstd = data.result?.fcstd_file || data.fcstd_file;
                        let msg = `✅ **FreeCAD Export Berhasil!**\n`;
                        if (exported.length > 0) {
                            msg += `├─ Exported files:\n`;
                            for (const f of exported) msg += `│  • ${f}\n`;
                        }
                        if (fcstd) msg += `└─ .FCStd saved: ${fcstd}\n`;
                        return msg;
                    }

                    if (action === 'create_mesh') {
                        const created = data.result?.objects_created || data.objects_created || [];
                        let msg = `✅ **${args.mesh_type || 'object'} dibuat di FreeCAD!** 🧊\n`;
                        if (created.length > 0) msg += `├─ Name: ${created.join(', ')}\n`;
                        if (args.location) msg += `└─ Position: ${JSON.stringify(args.location)}\n`;
                        return msg;
                    }

                    if (action === 'run_script' || action === 'exec_python') {
                        const output = data.output || data.result?.output || '';
                        const err = data.error || data.result?.error;
                        let msg = `✅ **FreeCAD script executed**\n`;
                        if (output) msg += `📝 Output:\n${output.slice(0, 1000)}\n`;
                        if (err) msg += `⚠️ Warnings: ${err.slice(0, 500)}\n`;
                        return msg;
                    }

                    return `✅ **FreeCAD: ${action}** berhasil\n${JSON.stringify(data).slice(0, 500)}`;
                } catch (err) {
                    if (err.code === 'PLATFORM_NOT_SUPPORTED') {
                        return `🖥️  FreeCAD bridge membutuhkan FreeCAD terinstall.`;
                    }
                    return `⚠️ FreeCAD bridge error: ${err.message}`;
                }
            },
        },

        // ═══════════════════════════════════════════════════════════════
        // 🧊 FREECAD SOCKET — 3D Modelling via TCP Socket (Live FreeCAD)
        // ═══════════════════════════════════════════════════════════════
        //
        // BEDA dengan freecad_inject (headless):
        //   freecad_inject         → spawn FreeCADCmd --headless, eksekusi, exit
        //   freecad_socket_inject  → konek ke FreeCAD yang SUDAH TERBUKA via TCP:9998
        //
        // Kelebihan socket mode:
        //   - FreeCAD TETAP TERBUKA — user lihat perubahan real-time
        //   - Eksekusi lebih cepat — tidak perlu start/stop FreeCAD tiap kali
        //   - Bisa iterasi cepat: create → modify → check → create lagi
        //
        // ⚠️  SYARAT: freecad_socket_server.py harus sudah jalan di FreeCAD!
        //     Buka FreeCAD → Macro → Macros... → Create → Paste → Execute
        //
        // ═══════════════════════════════════════════════════════════════

        // ─── FREECAD SOCKET: Live Code Execution ─────────────────────
        {
            type: 'function',
            function: {
                name: 'freecad_socket_inject',
                description: 'Kirim kode Python ke FreeCAD yang sedang berjalan (live via TCP :9998). FreeCAD TETAP TERBUKA — user lihat perubahan real-time. Jauh lebih cepat dari freecad_inject (headless) karena tidak perlu start/stop FreeCAD tiap kali. Gunakan untuk: create/edit part, boolean operation, modify scene live.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['exec_code', 'run_script', 'eval', 'get_scene_info',
                                'ping', 'create_mesh', 'clear_scene', 'export_model'],
                            description: 'exec_code=kirim Python code (FreeCAD, App, Part available), run_script=alias exec_code, eval=evaluasi expression cepat, ping=cek koneksi, get_scene_info=info scene live, create_mesh=buat primitive, clear_scene=bersihkan scene, export_model=export ke file',
                        },
                        code: {
                            type: 'string',
                            description: 'Kode Python untuk dieksekusi. Helper functions: add_box(), add_cylinder(), add_sphere(), add_cone(), add_torus(), boolean_cut(), boolean_fuse(), boolean_common(), save_fcstd(), export_stl(), export_step(), scene_info(), new_document(), get_or_create_doc()',
                        },
                        expression: {
                            type: 'string',
                            description: 'Expression Python untuk dievaluasi (hanya untuk action=eval). Contoh: "len(FreeCAD.listDocuments())"',
                        },
                        mesh_type: {
                            type: 'string', enum: ['box', 'cylinder', 'sphere', 'cone', 'torus'],
                            description: 'Tipe primitive (untuk action=create_mesh)',
                        },
                        name: { type: 'string', description: 'Nama object baru' },
                        location: {
                            type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
                            description: 'Posisi [x, y, z]',
                        },
                        size: { type: 'number', description: 'Ukuran box (default: 10)' },
                        radius: { type: 'number', description: 'Radius cylinder/sphere/cone (default: 5)' },
                        depth: { type: 'number', description: 'Tinggi cylinder/cone (default: 10)' },
                        radius2: { type: 'number', description: 'Minor radius torus (default: 2)' },
                        format: {
                            type: 'string', enum: ['step', 'stl', 'fcstd'],
                            description: 'Format export (untuk action=export_model)',
                        },
                        filename: { type: 'string', description: 'Nama file export' },
                    },
                    required: ['action'],
                },
            },
            _handler: async (args) => {
                try {
                    const { sendCommand } = await import('./desktop.js');
                    const action = args.action || 'run_script';

                    let command;
                    switch (action) {
                        case 'exec_code':
                        case 'run_script':
                            command = { action: 'run_script', code: args.code || '' };
                            if (!command.code) return `⚠️ Parameter 'code' wajib diisi untuk action ${action}`;
                            break;

                        case 'eval':
                            command = { action: 'eval', expression: args.expression || '' };
                            if (!command.expression) return `⚠️ Parameter 'expression' wajib diisi untuk action eval`;
                            break;

                        case 'ping':
                            command = { action: 'ping' };
                            break;

                        case 'get_scene_info':
                            command = { action: 'get_scene_info' };
                            break;

                        case 'create_mesh':
                            command = {
                                action: 'create_mesh',
                                mesh_type: args.mesh_type || 'box',
                                size: args.size,
                                radius: args.radius,
                                depth: args.depth,
                                radius2: args.radius2,
                                location: args.location || [0, 0, 0],
                                name: args.name || `live_${args.mesh_type || 'box'}`,
                            };
                            break;

                        case 'clear_scene':
                            command = { action: 'clear_scene' };
                            break;

                        case 'export_model':
                            command = {
                                action: 'export_model',
                                format: args.format || 'step',
                                filename: args.filename || 'live_export',
                            };
                            break;

                        default:
                            command = { action: 'run_script', code: args.code || '' };
                    }

                    const result = await sendCommand('freecad-socket', command, {
                        timeout: 180000,
                    });

                    if (!result.success) {
                        const msg = result.error || 'Gagal';
                        if (msg.includes('tidak bisa konek') || msg.includes('Connection refused')) {
                            return `⚠️ **FreeCAD tidak terhubung!**

🔌 **Cara konek:**
1. Buka **FreeCAD**
2. Buka menu **Macro → Macros...**
3. Klik **Create**, beri nama 'freecad_socket_server'
4. Paste isi dari \`desktop/freecad_socket_server.py\`
5. Simpan, lalu klik **Execute**
6. Atau dari Python Console FreeCAD:
   \`\`\`
   exec(open(r"D:\\\\downloads\\\\Vlora-V1\\\\desktop\\\\freecad_socket_server.py").read())
   \`\`\`
7. Cek console: "🧊 FreeCAD Socket Server: ✅ OK → 127.0.0.1:9998"
8. Kirim command ini lagi!`;
                        }
                        return `⚠️ FreeCAD Socket: ${msg}`;
                    }

                    const data = result.result || result;

                    if (action === 'ping') {
                        return `✅ **FreeCAD Terhubung!** 🧊
   Documents: ${data.documents || '?'}
   Status: ${data.pong ? '✅ Live' : '⚠️ Unknown'}`;
                    }

                    if (action === 'get_scene_info') {
                        const scene = data.scene || data;
                        let msg = `📊 **FreeCAD Scene (Live)**\n`;
                        const docs = scene.documents || [];
                        msg += `├─ Documents: ${docs.length}\n`;
                        if (docs.length > 0) {
                            for (const doc of docs) {
                                msg += `├─ 📄 ${doc.name}: ${doc.objects?.length || 0} objects\n`;
                                for (const obj of (doc.objects || []).slice(0, 8)) {
                                    msg += `│  • ${obj.name} (${obj.type})`;
                                    if (obj.faces !== undefined) msg += ` — ${obj.faces}f`;
                                    if (obj.volume) msg += ` vol:${obj.volume.toFixed(1)}`;
                                    msg += '\n';
                                }
                            }
                        }
                        return msg;
                    }

                    if (action === 'eval') {
                        return `🔢 **Hasil Evaluasi:** ${data.value || data.result || '(no value)'}`;
                    }

                    if (action === 'create_mesh') {
                        return `✅ **${args.mesh_type || 'Object'} dibuat live di FreeCAD!** 🧊
   Name: ${args.name || ''}
   Position: ${JSON.stringify(args.location || [0, 0, 0])}`;
                    }

                    if (action === 'clear_scene') {
                        return `✅ **Scene dibersihkan!** Semua object dihapus.`;
                    }

                    if (action === 'export_model') {
                        return `✅ **Export selesai!** 📁
   Format: ${args.format || 'step'}
   Path: ${data.path || args.filename || 'live_export'}`;
                    }

                    const stdout = data.stdout || data.output || '';
                    const stderr = data.stderr || data.error || '';
                    const hasError = data.success === false;

                    let msg = hasError
                        ? `⚠️ **Script Error di FreeCAD:**\n`
                        : `✅ **Script dieksekusi live!** 🧊\n`;

                    if (stdout) {
                        const lines = stdout.split('\n').filter(l => l.trim()).slice(0, 20);
                        msg += `📝 Output:\n\`\`\`\n${lines.join('\n').slice(0, 1500)}\n\`\`\`\n`;
                    }

                    if (stderr) msg += `⚠️ Stderr:\n\`\`\`\n${stderr.slice(0, 500)}\n\`\`\`\n`;
                    if (hasError) msg += `❌ Error: ${data.error || 'Unknown'}\n`;

                    return msg;
                } catch (err) {
                    return `⚠️ FreeCAD Socket error: ${err.message}`;
                }
            },
        },

        // ═══════════════════════════════════════════════════════════════
        // 👁️  GEMINI VISION — Analisis Gambar via Google Gemini 2.0 Flash
        // ═══════════════════════════════════════════════════════════════
        // Tool ini memungkinkan agent "melihat" gambar dengan mengirimnya
        // ke Google Gemini 2.0 Flash via OpenRouter API.
        //
        // Cara kerja: baca file gambar → base64 → OpenRouter API → deskripsi
        //
        // Mendukung format: jpg, jpeg, png, gif, webp
        //
        // ⚠️  Membutuhkan OPENROUTER_API_KEY di .env
        // ═══════════════════════════════════════════════════════════════

        {
            type: 'function',
            function: {
                name: 'analyze_image',
                description: 'Analisis gambar menggunakan Gemini 2.0 Flash Vision via OpenRouter. Kirim path file gambar di komputer/desktop, dan Gemini akan mendeskripsikan apa yang terlihat di gambar. Gunakan ini sebagai "mata" AI untuk melihat screenshot, foto product, UI design, dll. Bisa juga untuk membaca teks di gambar (OCR). Mendukung format: jpg, jpeg, png, gif, webp.',
                parameters: {
                    type: 'object',
                    properties: {
                        file_path: {
                            type: 'string',
                            description: 'Path lengkap ke file gambar. Bisa absolut (D:\\downloads\\gambar.jpg) atau relatif dari root project. Contoh: "D:\\downloads\\housinglamp.jfif" atau "screenshot.png"',
                        },
                        prompt: {
                            type: 'string',
                            description: 'Pertanyaan/instruksi spesifik tentang gambar. Contoh: "Apa warna dominan gambar ini?", "Jelaskan komponen apa saja yang terlihat", "Baca teks yang ada di gambar ini". Default: deskripsi detail gambar.',
                        },
                        detail: {
                            type: 'string',
                            enum: ['auto', 'low', 'high'],
                            description: 'Level detail analisis. "high" untuk analisis detail (lebih banyak token), "low" untuk analisis cepat, "auto" biar Gemini yang tentukan sendiri.',
                        },
                    },
                    required: ['file_path'],
                },
            },
            _handler: async ({ file_path, prompt, detail }) => {
                const fsp = await import('fs/promises');
                const pth = await import('path');

                try {
                    // ── Resolve path ──────────────────────────────────────
                    const fullPath = pth.isAbsolute(file_path)
                        ? file_path
                        : pth.join(scanner.projectPath, file_path);

                    // ── Validasi file ─────────────────────────────────────
                    try {
                        await fsp.access(fullPath);
                    } catch {
                        return `❌ File "${file_path}" tidak ditemukan di:\n   ${fullPath}\n\nPastikan path-nya benar. Contoh: D:\\downloads\\gambar.jpg`;
                    }

                    const stat = await fsp.stat(fullPath);
                    const maxSize = 20 * 1024 * 1024; // 20MB — batas OpenRouter
                    if (stat.size > maxSize) {
                        return `⚠️ File terlalu besar (${(stat.size / 1024 / 1024).toFixed(1)}MB). Maksimal 20MB.`;
                    }

                    // ── Validasi ekstensi ─────────────────────────────────
                    const ext = pth.extname(fullPath).toLowerCase();
                    const supported = ['.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp'];
                    if (!supported.includes(ext)) {
                        return `⚠️ Format "${ext}" belum didukung. Supported: ${supported.join(', ')}`;
                    }

                    // ── Baca & encode ─────────────────────────────────────
                    const imageBuffer = await fsp.readFile(fullPath);
                    const isJpeg = ['.jpg', '.jpeg', '.jfif'].includes(ext);
                    const mimeType = isJpeg ? 'image/jpeg'
                        : ext === '.png' ? 'image/png'
                        : ext === '.gif' ? 'image/gif'
                        : ext === '.webp' ? 'image/webp'
                        : 'image/jpeg';

                    const base64Image = imageBuffer.toString('base64');
                    const dataUrl = `data:${mimeType};base64,${base64Image}`;

                    const fileName = pth.basename(fullPath);
                    const fileSize = (stat.size / 1024).toFixed(1);

                    // ── API Call ke OpenRouter (Gemini 2.0 Flash) ────────
                    const apiKey = process.env.OPENROUTER_API_KEY;
                    if (!apiKey) {
                        return `❌ OPENROUTER_API_KEY tidak ditemukan di .env!

Biar Gemini Vision bisa jalan, lo perlu set:
1. Buka file .env di root project
2. Tambahin: OPENROUTER_API_KEY=sk-or-v1-xxxxx

Atau pake cara manual dulu — install Pillow:
   python -m pip install Pillow
   python temp_img_vlm.py

Udah kepikiran? 😎`;
                    }

                    const apiPrompt = prompt
                        ? `Analisis gambar ini: ${prompt}`
                        : `Deskripsikan gambar ini secara detail dalam Bahasa Indonesia. Jelaskan:
1. Apa yang terlihat (objek, orang, teks, background)
2. Warna dominan dan mood
3. Komposisi visual
4. Detail teknis (jika ada teks, baca dan tuliskan)`;

                    const body = {
                        model: 'nvidia/nemotron-nano-12b-v2-vl:free',
                        messages: [
                            {
                                role: 'user',
                                content: [
                                    { type: 'text', text: apiPrompt },
                                    { type: 'image_url', image_url: { url: dataUrl, detail: detail || 'auto' } },
                                ],
                            },
                        ],
                        max_tokens: 2048,
                        temperature: 0.3,
                    };

                    // Fetch with timeout
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

                    try {
                        const response = await fetch(
                            'https://openrouter.ai/api/v1/chat/completions',
                            {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${apiKey}`,
                                    'HTTP-Referer': 'https://project-analyst-agent',
                                    'X-Title': 'Project Analyst Agent',
                                },
                                body: JSON.stringify(body),
                                signal: controller.signal,
                            }
                        );

                        clearTimeout(timeoutId);

                        if (!response.ok) {
                            const errText = await response.text().catch(() => 'Unknown error');
                            let errMsg = `OpenRouter API error (${response.status})`;

                            if (response.status === 402) {
                                errMsg = `⚠️ **OpenRouter: Insufficient credits!**
        
Model gratis mungkin limitnya habis. Coba:
1. Ganti model ke 'google/gemini-2.0-flash-001' (biasanya masih free)
2. Atau isi credit di openrouter.ai
3. Atau gunakan model vision lain seperti 'qwen/qwen-vl-plus:free'`;
                            } else if (response.status === 401) {
                                errMsg = `❌ **API Key invalid!**
Cek OPENROUTER_API_KEY di .env — mungkin expired atau salah.`;
                            } else if (response.status === 429) {
                                errMsg = `⏳ **Rate limit exceeded!** Tunggu beberapa saat lalu coba lagi.`;
                            }

                            return `${errMsg}\n\nDetail: ${errText.slice(0, 300)}`;
                        }

                        const json = await response.json();
                        const content = json.choices?.[0]?.message?.content;

                        if (!content) {
                            return `⚠️ Gemini Vision merespon tapi kosong. Mungkin gambar tidak bisa diproses.
Response: ${JSON.stringify(json).slice(0, 500)}`;
                        }

                        // ── Format hasil ──────────────────────────────────
                        const usage = json.usage || {};
                        const tokenInfo = usage.total_tokens
                            ? `\n📊 Token: ${usage.total_tokens} total (${usage.prompt_tokens || '?'} prompt + ${usage.completion_tokens || '?'} completion)`
                            : '';

                        return `👁️ **Gemini Vision — ${fileName}** (${fileSize}KB)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${content.trim()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${tokenInfo}
`;
                    } catch (fetchErr) {
                        clearTimeout(timeoutId);
                        if (fetchErr.name === 'AbortError') {
                            return `⏰ **Timeout!** Gemini Vision tidak merespon dalam 30 detik.

Mungkin:
- Gambar terlalu kompleks (coba resize)
- Jaringan lambat
- OpenRouter sedang sibuk

Coba lagi dengan prompt yang lebih spesifik atau gambar yang lebih kecil.`;
                        }
                        throw fetchErr;
                    }
                } catch (err) {
                    return `⚠️ Gemini Vision error: ${err.message}

Coba install Pillow untuk analisis gambar lokal:
   python -m pip install Pillow
   python temp_img_vlm.py`;
                }
            },
        },

    ];

    // ─── 🕵️ HIDDEN TOOLS — tidak muncul di daftar, hanya dipanggil internal ───
    // Tool ini tidak didaftarkan di array tools utama, tapi bisa diakses
    // oleh agent.js secara langsung via this.stealthMemory

    // Simpan referensi hidden tools untuk internal use
    hiddenTools.save_memory = async ({ key, data }) => {
        try {
            const { StealthMemory } = await import('./stealth-memory.js');
            const sm = new StealthMemory(scanner.projectPath);
            await sm.save(key, data);
            return `✅ Memory "${key}" tersimpan rahasia.`;
        } catch (err) {
            return `⚠️ Gagal menyimpan memory: ${err.message}`;
        }
    };

    hiddenTools.load_memory = async ({ key }) => {
        try {
            const { StealthMemory } = await import('./stealth-memory.js');
            const sm = new StealthMemory(scanner.projectPath);
            const data = await sm.load(key);
            if (data === null) return `❌ Memory "${key}" tidak ditemukan.`;
            return `📖 Memory "${key}": ${JSON.stringify(data).slice(0, 500)}`;
        } catch (err) {
            return `⚠️ Gagal membaca memory: ${err.message}`;
        }
    };

    hiddenTools.list_memory = async () => {
        try {
            const { StealthMemory } = await import('./stealth-memory.js');
            const sm = new StealthMemory(scanner.projectPath);
            const keys = await sm.listKeys();
            if (keys.length === 0) return '📭 Belum ada memory tersimpan.';
            return `🗂️ Memory tersimpan (${keys.length}):\n${keys.map(k => `  • ${k}`).join('\n')}`;
        } catch (err) {
            return `⚠️ Gagal list memory: ${err.message}`;
        }
    };

    // Attach hidden tools ke array utama (tapi tidak akan muncul di OpenAI tool list)
    // karena kita tidak menambahkan definisi function-nya ke schema
    // Agent bisa akses via this.executeTool dengan nama hidden tool
    for (const [name, handler] of Object.entries(hiddenTools)) {
        tools.push({
            type: 'function',
            function: {
                name,
                description: `🕵️ [HIDDEN] ${name} — internal use only`,
                parameters: {
                    type: 'object',
                    properties: {
                        key: { type: 'string' },
                        data: { type: 'string' },
                    },
                },
            },
            _handler: handler,
        });
    }

}
