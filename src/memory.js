import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import crypto from 'crypto';

export class Memory {
  constructor(memoryDir) {
    this.memoryDir = memoryDir;
  }

  // Get a stable ID for a project path
  _projectId(projectPath) {
    return crypto.createHash('md5').update(projectPath).digest('hex').slice(0, 8);
  }

  _filePath(projectPath) {
    return path.join(this.memoryDir, `${this._projectId(projectPath)}.json`);
  }

  async _load(projectPath) {
    const filePath = this._filePath(projectPath);
    if (!existsSync(filePath)) {
      return this._defaultMemory(projectPath);
    }
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return this._defaultMemory(projectPath);
    }
  }

  _defaultMemory(projectPath) {
    return {
      projectPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      summary: null,
      messages: [],
      facts: [],       // Extracted important facts about the project
      decisions: [],   // Design decisions or recommendations made
    };
  }

  async _save(projectPath, data) {
    await fs.mkdir(this.memoryDir, { recursive: true });
    data.updatedAt = new Date().toISOString();
    await fs.writeFile(this._filePath(projectPath), JSON.stringify(data, null, 2), 'utf-8');
  }

  async addMessage(projectPath, message) {
    // Fire-and-forget: jangan block agent loop
    this._addMessageAsync(projectPath, message).catch(() => {});
  }

  async _addMessageAsync(projectPath, message) {
    const mem = await this._load(projectPath);
    mem.messages.push({
      ...message,
      timestamp: new Date().toISOString(),
    });

    // Keep last 150 messages (increased from 100)
    if (mem.messages.length > 150) {
      mem.messages = mem.messages.slice(-150);
    }

    // Auto-extract facts from assistant messages
    if (message.role === 'assistant' && message.content) {
      this._extractFactsSync(mem, message.content);
    }

    await this._save(projectPath, mem);
  }

  _extractFactsSync(mem, content) {
    // Simple heuristic: look for key insights in responses
    const factPatterns = [
      /menggunakan\s+([A-Za-z\s]+)\s+sebagai/gi,
      /arsitektur[^.]+/gi,
      /pattern[^.]+digunakan/gi,
      /terdapat\s+\d+[^.]+/gi,
    ];

    for (const pattern of factPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches.slice(0, 2)) {
          const fact = match.trim().slice(0, 150);
          if (!mem.facts.includes(fact)) {
            mem.facts.push(fact);
          }
        }
      }
    }

    // Keep last 20 facts
    if (mem.facts.length > 20) {
      mem.facts = mem.facts.slice(-20);
    }
  }

  async saveSummary(projectPath, summary) {
    const mem = await this._load(projectPath);
    mem.summary = summary;
    await this._save(projectPath, mem);
  }

  async getSummary(projectPath) {
    const mem = await this._load(projectPath);
    if (!mem.summary && mem.messages.length === 0) return null;
    if (mem.summary) return `(${mem.messages.length} pesan sebelumnya) — ${mem.summary.slice(0, 100)}`;
    return `${mem.messages.length} pesan sebelumnya tersimpan`;
  }

  async getRecentContext(projectPath, maxMessages = 10) {
    const mem = await this._load(projectPath);
    return {
      summary: mem.summary,
      recentMessages: mem.messages.slice(-maxMessages),
      facts: mem.facts,
      decisions: mem.decisions,
    };
  }

  async getAll(projectPath) {
    return this._load(projectPath);
  }

  async reset(projectPath) {
    const filePath = this._filePath(projectPath);
    if (existsSync(filePath)) {
      await fs.unlink(filePath);
    }
  }

  // List all known projects
  async listProjects() {
    await fs.mkdir(this.memoryDir, { recursive: true });
    const files = await fs.readdir(this.memoryDir);
    const projects = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(await fs.readFile(path.join(this.memoryDir, file), 'utf-8'));
        projects.push({
          path: data.projectPath,
          messages: data.messages.length,
          updatedAt: data.updatedAt,
        });
      } catch { /* skip */ }
    }
    return projects;
  }
}
