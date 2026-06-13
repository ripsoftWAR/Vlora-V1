import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

// NVIDIA skills catalog - name → raw GitHub path
const NVIDIA_SKILLS_CATALOG = {
  'rag-blueprint':  'NVIDIA-AI-Blueprints/rag/refs/heads/main/skills/rag-blueprint/SKILL.md',
  'aiq':            'NVIDIA/GenerativeAIExamples/refs/heads/main/AgentIQ/skill/SKILL.md',
  'cuopt':          'NVIDIA/skills/refs/heads/main/skills/cuopt/cuopt-numerical-optimization-api-python/SKILL.md',
  'cuda-quantum':   'NVIDIA/skills/refs/heads/main/skills/cuda-quantum/onboarding/SKILL.md',
  'deepstream':     'NVIDIA/skills/refs/heads/main/skills/deepstream/deepstream-sdk-python/SKILL.md',
  'nim-operator':   'NVIDIA/skills/refs/heads/main/skills/nim-operator/nim-operator-kubernetes/SKILL.md',
  'nemo-retriever': 'NVIDIA/skills/refs/heads/main/skills/nemo-retriever/nemo-retriever-text-embedding/SKILL.md',
};

const RAW_BASE = 'https://raw.githubusercontent.com/';

export class SkillManager {
  constructor(skillsDir) {
    this.skillsDir = skillsDir; // → skills/ (root project)

    // Semua lokasi yang di-scan, berurutan dari prioritas tertinggi
    this.scanPaths = [
      // 1. Project-specific skills (paling relevan)
      { dir: path.join(process.cwd(), 'skills', 'project'), label: 'project' },
      // 2. Global skills (berlaku semua project)
      { dir: path.join(process.cwd(), 'skills', 'global'),  label: 'global'  },
      // 3. Legacy skills (file .md langsung di skills/)
      { dir: skillsDir,                                      label: 'legacy'  },
      // 4. Skills via npx skills add
      { dir: path.join(process.cwd(), '.agents', 'skills'), label: 'npx'     },
    ];
  }

  async _ensureDir() {
    await fs.mkdir(this.skillsDir, { recursive: true });
  }

  listAvailable() {
    return Object.keys(NVIDIA_SKILLS_CATALOG);
  }

  // Scan semua lokasi, return Map<name, { filePath, source, label }>
  async listInstalled() {
    const installed = new Map();

    for (const { dir, label } of this.scanPaths) {
      if (!existsSync(dir)) continue;

      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);

      for (const entry of entries) {
        // Format legacy & global/project: namafile.md langsung
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const name = entry.name.replace('.md', '');
          if (!installed.has(name)) {
            installed.set(name, {
              filePath: path.join(dir, entry.name),
              source: label,
            });
          }
        }

        // Format npx: subfolder/SKILL.md
        if (entry.isDirectory() && label === 'npx') {
          const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
          if (existsSync(skillMdPath) && !installed.has(entry.name)) {
            installed.set(entry.name, {
              filePath: skillMdPath,
              source: 'npx',
            });
          }
        }
      }
    }

    return installed;
  }

  // Kembalikan array of names saja (untuk banner startup & backward compat)
  async listInstalledNames() {
    const map = await this.listInstalled();
    return [...map.keys()];
  }

  // Download skill dari NVIDIA catalog dan simpan ke skills/
  async add(skillName) {
    const key = skillName.toLowerCase();
    const githubPath = NVIDIA_SKILLS_CATALOG[key];

    if (!githubPath) {
      const available = this.listAvailable().join(', ');
      throw new Error(`Skill "${skillName}" tidak ada di catalog.\nTersedia: ${available}`);
    }

    await this._ensureDir();

    const url = `${RAW_BASE}${githubPath}`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`Gagal download skill "${skillName}" (HTTP ${res.status})\nURL: ${url}`);
    }

    const content = await res.text();
    const filePath = path.join(this.skillsDir, `${key}.md`);
    await fs.writeFile(filePath, content, 'utf-8');

    const firstLine = content.split('\n').find((l) => l.startsWith('#')) || skillName;
    return {
      name: key,
      description: firstLine.replace(/^#+\s*/, ''),
      path: filePath,
      size: content.length,
    };
  }

  // Hapus skill (cek semua lokasi)
  async remove(skillName) {
    const installed = await this.listInstalled();
    const entry = installed.get(skillName);

    if (!entry) {
      throw new Error(`Skill "${skillName}" tidak terinstall`);
    }

    if (entry.source === 'npx') {
      // Hapus seluruh folder untuk skill via npx
      const skillFolder = path.join(process.cwd(), '.agents', 'skills', skillName);
      await fs.rm(skillFolder, { recursive: true, force: true });
    } else {
      // Hapus file .md
      await fs.unlink(entry.filePath);
    }
  }

  // Tampilkan isi skill
  async show(skillName) {
    const installed = await this.listInstalled();
    const entry = installed.get(skillName);

    if (!entry) {
      throw new Error(`Skill "${skillName}" tidak terinstall. Jalankan: /skill add ${skillName}`);
    }

    return fs.readFile(entry.filePath, 'utf-8');
  }

  // Load semua skill sebagai context string untuk system prompt
  async loadContext() {
    const installed = await this.listInstalled();
    if (installed.size === 0) return '';

    const parts = [];

    // Label badge per source
    const badge = {
      project: '🎯', // spesifik project
      global:  '🌐', // berlaku semua project
      legacy:  '📦', // skill lama
      npx:     '🔧', // dari npx skills add
    };

    for (const [name, entry] of installed) {
      try {
        const content = await fs.readFile(entry.filePath, 'utf-8');
        const truncated = content.length > 3000
          ? content.slice(0, 3000) + '\n...[truncated]'
          : content;
        const icon = badge[entry.source] ?? '📄';
        parts.push(`### ${icon} Skill: ${name} (${entry.source})\n${truncated}`);
      } catch {
        // skip kalau file rusak
      }
    }

    return parts.length > 0
      ? `\n## 📦 Installed Skills\n${parts.join('\n\n---\n\n')}`
      : '';
  }

  // Summary singkat untuk ditampilkan di banner startup
  async getSummary() {
    const installed = await this.listInstalled();
    const bySource = { project: [], global: [], legacy: [], npx: [] };

    for (const [name, entry] of installed) {
      bySource[entry.source]?.push(name);
    }

    const lines = [];
    if (bySource.project.length) lines.push(`🎯 Project : ${bySource.project.join(', ')}`);
    if (bySource.global.length)  lines.push(`🌐 Global  : ${bySource.global.join(', ')}`);
    if (bySource.legacy.length)  lines.push(`📦 Legacy  : ${bySource.legacy.join(', ')}`);
    if (bySource.npx.length)     lines.push(`🔧 NPX     : ${bySource.npx.join(', ')}`);

    return lines.join('\n') || 'Belum ada skill terinstall';
  }
}