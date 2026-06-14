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
        const fullPath = path.join(scanner.projectPath, file_path);
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
        const fullPath = path.join(scanner.projectPath, file_path);
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
          scanner._cache?.delete(fullPath);
          return `✅ Edit berhasil di "${file_path}"`;
        }
        // Fallback trim
        const trimOrig = trimLines(normalOrig);
        const trimOld = trimLines(normalOld);
        count = trimOrig.split(trimOld).length - 1;
        if (count === 1) {
          const updated = trimOrig.replace(trimOld, normalNew);
          await fs.writeFile(fullPath, updated, 'utf-8');
          scanner._cache?.delete(fullPath);
          return `✅ Edit berhasil di "${file_path}" (trim-match)`;
        }
        if (count === 0) return `❌ Teks tidak ditemukan di "${file_path}". Pastikan exact match.`;
        if (count > 1) return `❌ Teks ditemukan ${count}x — terlalu ambigu.`;
        const updated = original.replace(old_str, new_str);
        await fs.writeFile(fullPath, updated, 'utf-8');
        scanner._cache.delete(fullPath);
        return `✅ Edit berhasil di "${file_path}" — ${old_str.length} chars → ${new_str.length} chars`;
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
        const fullPath = path.join(scanner.projectPath, file_path);
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
        // Safety: block destructive commands
        const blocked = ['rm -rf /', 'rm -rf ~', 'mkfs', 'dd if=', 'shutdown', 'reboot', ':(){ :|:& };:'];
        for (const b of blocked) {
          if (command.includes(b)) return `❌ Command diblokir karena berbahaya: "${b}"`;
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

  ];
}