import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import crypto from 'crypto';

export class Memory {
  constructor(memoryDir) {
    this.memoryDir = memoryDir;
  }

  // ── Project ID ───────────────────────────────────────────────
  _projectId(projectPath) {
    return crypto.createHash('md5').update(projectPath).digest('hex').slice(0, 8);
  }

  // ── Session helpers ──────────────────────────────────────────
  _sessionsDir(projectPath) {
    return path.join(this.memoryDir, 'sessions', this._projectId(projectPath));
  }

  _sessionPath(projectPath, sessionId) {
    return path.join(this._sessionsDir(projectPath), `${sessionId}.json`);
  }

  _activeSessionPath(projectPath) {
    return path.join(this._sessionsDir(projectPath), '_active.json');
  }

  // ── Legacy single-file path (for migration) ──────────────────
  _legacyFilePath(projectPath) {
    return path.join(this.memoryDir, `${this._projectId(projectPath)}.json`);
  }

  // ── Active session tracking ──────────────────────────────────
  async getActiveSessionId(projectPath) {
    const p = this._activeSessionPath(projectPath);
    try {
      const raw = await fs.readFile(p, 'utf-8');
      const data = JSON.parse(raw);
      return data.sessionId || null;
    } catch {
      return null;
    }
  }

  async setActiveSessionId(projectPath, sessionId) {
    await fs.mkdir(this._sessionsDir(projectPath), { recursive: true });
    await fs.writeFile(this._activeSessionPath(projectPath), JSON.stringify({ sessionId }), 'utf-8');
  }

  // ── Session CRUD ─────────────────────────────────────────────
  /**
   * List all sessions for a project
   */
  async listSessions(projectPath) {
    const dir = this._sessionsDir(projectPath);
    if (!existsSync(dir)) return [];

    const files = await fs.readdir(dir);
    const sessions = [];
    for (const file of files) {
      if (!file.endsWith('.json') || file === '_active.json') continue;
      try {
        const raw = await fs.readFile(path.join(dir, file), 'utf-8');
        const data = JSON.parse(raw);
        sessions.push({
          id: data.id || file.replace('.json', ''),
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          messageCount: (data.messages || []).length,
          title: data.title || this._guessTitle(data.messages || []),
        });
      } catch { /* skip corrupted */ }
    }

    // Sort newest first
    sessions.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    return sessions;
  }

  _guessTitle(messages) {
    const firstUser = messages.find(m => m.role === 'user');
    if (!firstUser) return 'Percakapan kosong';
    return firstUser.content.slice(0, 50) + (firstUser.content.length > 50 ? '…' : '');
  }

  /**
   * Create a new session
   */
  async createSession(projectPath, title) {
    await fs.mkdir(this._sessionsDir(projectPath), { recursive: true });
    const sessionId = crypto.randomUUID().slice(0, 8);
    const session = this._defaultSession(projectPath, sessionId, title);
    await fs.writeFile(this._sessionPath(projectPath, sessionId), JSON.stringify(session, null, 2), 'utf-8');
    await this.setActiveSessionId(projectPath, sessionId);
    return session;
  }

  /**
   * Get or create active session
   */
  async getOrCreateSession(projectPath) {
    let sessionId = await this.getActiveSessionId(projectPath);
    if (!sessionId) {
      // Check legacy file
      const legacy = this._legacyFilePath(projectPath);
      if (existsSync(legacy)) {
        // Migrate legacy to session
        try {
          const raw = await fs.readFile(legacy, 'utf-8');
          const data = JSON.parse(raw);
          const session = await this.createSession(projectPath, 'Percakapan sebelumnya');
          session.messages = data.messages || [];
          session.facts = data.facts || [];
          session.decisions = data.decisions || [];
          session.summary = data.summary;
          await fs.writeFile(this._sessionPath(projectPath, session.id), JSON.stringify(session, null, 2), 'utf-8');
          // Delete legacy
          await fs.unlink(legacy);
          return session;
        } catch {
          // Fallback: create new
        }
      }
      return this.createSession(projectPath);
    }

    const sp = this._sessionPath(projectPath, sessionId);
    if (!existsSync(sp)) {
      return this.createSession(projectPath);
    }
    try {
      return JSON.parse(await fs.readFile(sp, 'utf-8'));
    } catch {
      return this.createSession(projectPath);
    }
  }

  /**
   * Switch active session
   */
  async switchSession(projectPath, sessionId) {
    const sp = this._sessionPath(projectPath, sessionId);
    if (!existsSync(sp)) throw new Error(`Session ${sessionId} tidak ditemukan`);
    await this.setActiveSessionId(projectPath, sessionId);
    return JSON.parse(await fs.readFile(sp, 'utf-8'));
  }

  /**
   * Delete a session
   */
  async deleteSession(projectPath, sessionId) {
    const sp = this._sessionPath(projectPath, sessionId);
    if (existsSync(sp)) {
      await fs.unlink(sp);
    }
    // If active session deleted, switch to latest
    const activeId = await this.getActiveSessionId(projectPath);
    if (activeId === sessionId) {
      const sessions = await this.listSessions(projectPath);
      if (sessions.length > 0) {
        await this.setActiveSessionId(projectPath, sessions[0].id);
      } else {
        await this.setActiveSessionId(projectPath, '');
      }
    }
  }

  _defaultSession(projectPath, sessionId, title) {
    return {
      id: sessionId,
      projectPath,
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      summary: null,
      messages: [],
      facts: [],
      decisions: [],
    };
  }

  // ── Message operations (session-aware) ───────────────────────
  async _load(projectPath) {
    const session = await this.getOrCreateSession(projectPath);
    return session;
  }

  async _save(projectPath, data) {
    await fs.mkdir(this._sessionsDir(projectPath), { recursive: true });
    data.updatedAt = new Date().toISOString();
    // Auto-update title from first user message
    if (!data.title || data.title === 'Percakapan kosong' || data.title === 'Percakapan sebelumnya') {
      data.title = this._guessTitle(data.messages || []);
    }
    await fs.writeFile(this._sessionPath(projectPath, data.id), JSON.stringify(data, null, 2), 'utf-8');
  }

  async addMessage(projectPath, message) {
    const mem = await this._load(projectPath);
    mem.messages.push({
      ...message,
      timestamp: new Date().toISOString(),
    });

    // Keep last 100 messages
    if (mem.messages.length > 100) {
      mem.messages = mem.messages.slice(-100);
    }

    // Auto-extract facts from assistant messages
    if (message.role === 'assistant') {
      await this._extractFacts(mem, message.content);
    }

    await this._save(projectPath, mem);
  }

  async _extractFacts(mem, content) {
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
    const session = await this.getOrCreateSession(projectPath);
    session.messages = [];
    session.facts = [];
    session.decisions = [];
    session.summary = null;
    await this._save(projectPath, session);
  }

  async listProjects() {
    const sessionsDir = path.join(this.memoryDir, 'sessions');
    if (!existsSync(sessionsDir)) return [];

    const projectDirs = await fs.readdir(sessionsDir);
    const projects = [];
    for (const dir of projectDirs) {
      const dp = path.join(sessionsDir, dir);
      const stat = await fs.stat(dp);
      if (!stat.isDirectory()) continue;

      const sessionFiles = (await fs.readdir(dp)).filter(f => f.endsWith('.json') && f !== '_active.json');
      if (sessionFiles.length === 0) continue;

      try {
        const lastSession = JSON.parse(await fs.readFile(path.join(dp, sessionFiles[sessionFiles.length - 1]), 'utf-8'));
        projects.push({
          path: lastSession.projectPath || dir,
          messages: sessionFiles.length,
          updatedAt: lastSession.updatedAt,
        });
      } catch { /* skip */ }
    }
    return projects;
  }
}
