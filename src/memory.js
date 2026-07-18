import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import crypto from 'crypto';

// ── Konfigurasi enkripsi ──────────────────────────────────────────
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const ITERATIONS = 100000;
const SALT_LENGTH = 32;

export class Memory {
  constructor(memoryDir) {
    this.memoryDir = memoryDir;
    this._encryptionKey = null;
  }

  // ── Enkripsi AES-256-GCM untuk session memory ─────────────────
  async _getEncryptionKey() {
    if (this._encryptionKey) return this._encryptionKey;

    // Key derivation dari path memory dir (unique per installasi)
    const seed = path.resolve(this.memoryDir);
    const saltPath = path.join(this.memoryDir, '.session-salt');

    let salt;
    try {
      salt = await fs.readFile(saltPath);
    } catch {
      salt = crypto.randomBytes(SALT_LENGTH);
      await fs.mkdir(this.memoryDir, { recursive: true });
      await fs.writeFile(saltPath, salt);
    }

    return new Promise((resolve, reject) => {
      crypto.pbkdf2(seed, salt, ITERATIONS, KEY_LENGTH, 'sha512', (err, key) => {
        if (err) reject(err);
        else {
          this._encryptionKey = key;
          resolve(key);
        }
      });
    });
  }

  async _encryptSession(data) {
    const key = await this._getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const json = JSON.stringify(data);
    let encrypted = cipher.update(json, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  async _decryptSession(encoded) {
    const key = await this._getEncryptionKey();
    const parts = encoded.split(':');
    if (parts.length !== 3) throw new Error('Format encrypted data invalid');

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');
    return JSON.parse(decrypted);
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
    return path.join(this._sessionsDir(projectPath), `${sessionId}.enc`);
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
      if (!file.endsWith('.enc') || file === '_active.json') continue;
      try {
        const raw = await fs.readFile(path.join(dir, file), 'utf-8');
        const data = await this._decryptSession(raw);
        sessions.push({
          id: data.id || file.replace('.enc', ''),
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
    const encrypted = await this._encryptSession(session);
    await fs.writeFile(this._sessionPath(projectPath, sessionId), encrypted, 'utf-8');
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
          const encrypted = await this._encryptSession(session);
          await fs.writeFile(this._sessionPath(projectPath, session.id), encrypted, 'utf-8');
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
      const raw = await fs.readFile(sp, 'utf-8');
      return await this._decryptSession(raw);
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
    const raw = await fs.readFile(sp, 'utf-8');
    return await this._decryptSession(raw);
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
      longTermSummary: null,     // Ringkasan lintas sesi
      messages: [],
      facts: [],                 // Fakta teknis (arsitektur, keputusan)
      decisions: [],             // Keputusan arsitektur spesifik
      userPreferences: [],       // Preferensi user
      constraints: [],           // Constraint teknis
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
    if (!data.title || data.title === 'Percakapan kosong' || data.title === 'Percakapan sebelumnya' || data.title === 'Chat baru') {
      data.title = this._guessTitle(data.messages || []);
    }
    const encrypted = await this._encryptSession(data);
    await fs.writeFile(this._sessionPath(projectPath, data.id), encrypted, 'utf-8');
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

    // Auto-extract facts, decisions, preferences dari assistant messages
    if (message.role === 'assistant') {
      await this._extractKnowledge(mem, message.content);
    }

    await this._save(projectPath, mem);
  }

  /**
   * 🔍 Ekstraksi pengetahuan pintar — lebih dari sekedar regex
   * Deteksi: fakta arsitektur, keputusan, preferensi user, constraint
   */
  async _extractKnowledge(mem, content) {
    if (!content) return;

    // ── 1. Fakta Arsitektur ────────────────────────────────────
    const architecturePatterns = [
      /menggunakan\s+([A-Za-z0-9\s/+#.-]+)\s+sebagai/gi,
      /arsitektur[^.]*\./gi,
      /pattern[^.]*(?:digunakan|dipakai|diimplementasi)[^.]*\./gi,
      /stack[^.]*terdiri[^.]*\./gi,
      /framework[^.]*(?:yang dipakai|digunakan)[^.]*\./gi,
      /database[^.]*(?:menggunakan|pakai|pake)[^.]*\./gi,
      /mengintegrasikan\s+([A-Za-z0-9\s/+#.-]+)/gi,
      /menggunakan\s+([A-Za-z0-9\s/+#.-]+)\s+untuk\s+(?:autentikasi|authorisasi|storage|caching|logging)/gi,
    ];

    for (const pattern of architecturePatterns) {
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches.slice(0, 3)) {
          const fact = match.trim().slice(0, 200);
          if (!mem.facts.includes(fact)) {
            mem.facts.push(fact);
          }
        }
      }
    }

    // ── 2. Keputusan Arsitektur ────────────────────────────────
    const decisionPatterns = [
      /(?:memilih|pilih|pakai|gunakan|decide|decided)\s+([A-Za-z0-9\s/+#.-]+)\s+(?:karena|soalnya|alasannya|biar|agar|supaya)/gi,
      /(?:alasan|reason|kenapa)\s+(?:pake|pakai|menggunakan|memilih)[^.]*\./gi,
      /(?:lebih baik|better|lebih cocok|lebih sesuai)\s+(?:pake|pakai|menggunakan)[^.]*\./gi,
      /keputusan[^.]*\./gi,
    ];

    for (const pattern of decisionPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches.slice(0, 2)) {
          const decision = match.trim().slice(0, 200);
          if (!mem.decisions.includes(decision)) {
            mem.decisions.push(decision);
          }
        }
      }
    }

    // ── 3. Preferensi User ─────────────────────────────────────
    const prefPatterns = [
      /(?:saya suka|saya lebih suka|preferensi saya|preferensi|saya prefer|saya mau|saya ingin)\s[^.]*\./gi,
      /(?:tolong|mohon|harap)\s+(?:jangan|hindari|pakai|gunakan)[^.]*\./gi,
      /(?:saya tidak suka|saya ga suka|saya gak suka|saya kurang suka)[^.]*\./gi,
      /(?:setting|pengaturan|aturannya)\s[^.]*\./gi,
    ];

    for (const pattern of prefPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches.slice(0, 2)) {
          const pref = match.trim().slice(0, 200);
          if (!mem.userPreferences.includes(pref)) {
            mem.userPreferences.push(pref);
          }
        }
      }
    }

    // ── 4. Constraint Teknis ───────────────────────────────────
    const constraintPatterns = [
      /(?:harus|wajib|mesti|must|required)\s+(?:kompatibel|compatible|support|bisa jalan|berjalan)[^.]*\./gi,
      /(?:minimal|minimum)\s+(?:versi|version|ram|memory|storage|space)[^.]*\./gi,
      /(?:tidak bisa|ga bisa|gak bisa|tidak support|tidak mendukung)[^.]*\./gi,
      /(?:keterbatasan|limitation|limitasi|batasan)[^.]*\./gi,
      /(?:hanya\s+(?:bisa|dapat|support|mendukung))\s[^.]*\./gi,
    ];

    for (const pattern of constraintPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches.slice(0, 2)) {
          const constraint = match.trim().slice(0, 200);
          if (!mem.constraints.includes(constraint)) {
            mem.constraints.push(constraint);
          }
        }
      }
    }

    // ── Limit size ─────────────────────────────────────────────
    if (mem.facts.length > 30) mem.facts = mem.facts.slice(-30);
    if (mem.decisions.length > 15) mem.decisions = mem.decisions.slice(-15);
    if (mem.userPreferences.length > 10) mem.userPreferences = mem.userPreferences.slice(-10);
    if (mem.constraints.length > 10) mem.constraints = mem.constraints.slice(-10);
  }

  async saveSummary(projectPath, summary) {
    const mem = await this._load(projectPath);
    mem.summary = summary;
    await this._save(projectPath, mem);
  }

  /**
   * Simpan ringkasan jangka panjang (lintas sesi)
   */
  async saveLongTermSummary(projectPath, summary) {
    const mem = await this._load(projectPath);
    mem.longTermSummary = summary;
    await this._save(projectPath, mem);
  }

  async getSummary(projectPath) {
    const mem = await this._load(projectPath);
    if (!mem.summary && mem.messages.length === 0) return null;
    
    let result = '';
    if (mem.longTermSummary) {
      result += `📚 **Pengetahuan akumulasi:** ${mem.longTermSummary.slice(0, 200)}\n`;
    }
    if (mem.summary) {
      result += `(${mem.messages.length} pesan sebelumnya) — ${mem.summary.slice(0, 100)}`;
    } else {
      result += `${mem.messages.length} pesan sebelumnya tersimpan`;
    }
    return result;
  }

  async getRecentContext(projectPath, maxMessages = 10) {
    const mem = await this._load(projectPath);
    return {
      summary: mem.summary,
      longTermSummary: mem.longTermSummary,
      recentMessages: mem.messages.slice(-maxMessages),
      facts: mem.facts,
      decisions: mem.decisions,
      userPreferences: mem.userPreferences,
      constraints: mem.constraints,
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
    session.userPreferences = [];
    session.constraints = [];
    session.summary = null;
    session.longTermSummary = null;
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

      const sessionFiles = (await fs.readdir(dp)).filter(f => f.endsWith('.enc') && f !== '_active.json');
      if (sessionFiles.length === 0) continue;

      try {
        const raw = await fs.readFile(path.join(dp, sessionFiles[sessionFiles.length - 1]), 'utf-8');
        const lastSession = await this._decryptSession(raw);
        projects.push({
          path: lastSession.projectPath || dir,
          messages: sessionFiles.length,
          updatedAt: lastSession.updatedAt,
        });
      } catch { /* skip */ }
    }
    return projects;
  }

  // ── 🌐 GLOBAL MEMORY (lintas project) ──────────────────────────
  // Menyimpan preferensi user, fakta umum, dan pengetahuan yang
  // berlaku di SEMUA project — bukan per project.

  _globalMemoryPath() {
    return path.join(this.memoryDir, 'global-memory.enc');
  }

  _defaultGlobalMemory() {
    return {
      userPreferences: [],     // Preferensi user lintas project
      facts: [],               // Fakta umum (bukan spesifik project)
      decisions: [],           // Keputusan arsitektur yang sering dipakai
      constraints: [],         // Constraint umum
      projectHistory: [],      // Riwayat project yang pernah dikerjakan
      updatedAt: new Date().toISOString(),
    };
  }

  async _loadGlobalMemory() {
    const gp = this._globalMemoryPath();
    if (!existsSync(gp)) return this._defaultGlobalMemory();
    try {
      const raw = await fs.readFile(gp, 'utf-8');
      return await this._decryptSession(raw);
    } catch {
      return this._defaultGlobalMemory();
    }
  }

  async _saveGlobalMemory(data) {
    data.updatedAt = new Date().toISOString();
    const encrypted = await this._encryptSession(data);
    await fs.writeFile(this._globalMemoryPath(), encrypted, 'utf-8');
  }

  /**
   * Ambil global memory untuk di-inject ke system prompt
   */
  async getGlobalContext() {
    const global = await this._loadGlobalMemory();
    return {
      userPreferences: global.userPreferences || [],
      facts: global.facts || [],
      decisions: global.decisions || [],
      constraints: global.constraints || [],
      projectHistory: global.projectHistory || [],
    };
  }

  /**
   * Simpan preferensi user ke global memory (lintas project)
   */
  async addGlobalPreference(preference) {
    const global = await this._loadGlobalMemory();
    const trimmed = preference.trim().slice(0, 200);
    if (!trimmed) return;
    if (!global.userPreferences.includes(trimmed)) {
      global.userPreferences.push(trimmed);
      if (global.userPreferences.length > 20) global.userPreferences = global.userPreferences.slice(-20);
      await this._saveGlobalMemory(global);
    }
  }

  /**
   * Simpan fakta umum ke global memory
   */
  async addGlobalFact(fact) {
    const global = await this._loadGlobalMemory();
    const trimmed = fact.trim().slice(0, 200);
    if (!trimmed) return;
    if (!global.facts.includes(trimmed)) {
      global.facts.push(trimmed);
      if (global.facts.length > 30) global.facts = global.facts.slice(-30);
      await this._saveGlobalMemory(global);
    }
  }

  /**
   * Catat project yang pernah dikerjakan
   */
  async recordProject(projectPath, techStack) {
    const global = await this._loadGlobalMemory();
    const existing = global.projectHistory.find(p => p.path === projectPath);
    if (existing) {
      existing.lastAccessed = new Date().toISOString();
      if (techStack) existing.techStack = techStack;
    } else {
      global.projectHistory.push({
        path: projectPath,
        name: path.basename(projectPath),
        techStack: techStack || [],
        firstAccessed: new Date().toISOString(),
        lastAccessed: new Date().toISOString(),
      });
      if (global.projectHistory.length > 20) global.projectHistory = global.projectHistory.slice(-20);
    }
    await this._saveGlobalMemory(global);
  }

  // ── 🔍 MEMORY SEARCH ───────────────────────────────────────────
  // Cari knowledge di memory berdasarkan keyword — lintas project

  /**
   * Cari di semua session project untuk kata kunci tertentu
   * Berguna untuk: "ingetin dong, kita pernah bahas database pake apa?"
   */
  async searchMemory(query, options = {}) {
    const { maxResults = 5, includeProjects = [], excludeProjects = [] } = options;
    const sessionsDir = path.join(this.memoryDir, 'sessions');
    if (!existsSync(sessionsDir)) return [];

    const queryLower = query.toLowerCase();
    const results = [];

    const projectDirs = await fs.readdir(sessionsDir);
    for (const dir of projectDirs) {
      const dp = path.join(sessionsDir, dir);
      const stat = await fs.stat(dp);
      if (!stat.isDirectory()) continue;

      // Filter project
      if (includeProjects.length && !includeProjects.includes(dir)) continue;
      if (excludeProjects.includes(dir)) continue;

      const sessionFiles = (await fs.readdir(dp)).filter(f => f.endsWith('.enc') && f !== '_active.json');
      for (const file of sessionFiles.slice(-3)) { // Cuma 3 session terakhir per project
        try {
          const raw = await fs.readFile(path.join(dp, file), 'utf-8');
          const session = await this._decryptSession(raw);

          // Cari di facts
          for (const fact of (session.facts || [])) {
            if (fact.toLowerCase().includes(queryLower)) {
              results.push({
                type: 'fact',
                project: session.projectPath || dir,
                content: fact,
                sessionTitle: session.title,
                score: 1,
              });
            }
          }

          // Cari di decisions
          for (const decision of (session.decisions || [])) {
            if (decision.toLowerCase().includes(queryLower)) {
              results.push({
                type: 'decision',
                project: session.projectPath || dir,
                content: decision,
                sessionTitle: session.title,
                score: 1,
              });
            }
          }

          // Cari di userPreferences
          for (const pref of (session.userPreferences || [])) {
            if (pref.toLowerCase().includes(queryLower)) {
              results.push({
                type: 'preference',
                project: session.projectPath || dir,
                content: pref,
                sessionTitle: session.title,
                score: 1,
              });
            }
          }

          // Cari di constraints
          for (const constraint of (session.constraints || [])) {
            if (constraint.toLowerCase().includes(queryLower)) {
              results.push({
                type: 'constraint',
                project: session.projectPath || dir,
                content: constraint,
                sessionTitle: session.title,
                score: 1,
              });
            }
          }

          // Cari di summary & longTermSummary
          if (session.summary?.toLowerCase().includes(queryLower)) {
            results.push({
              type: 'summary',
              project: session.projectPath || dir,
              content: session.summary.slice(0, 200),
              sessionTitle: session.title,
              score: 0.8,
            });
          }
          if (session.longTermSummary?.toLowerCase().includes(queryLower)) {
            results.push({
              type: 'long_term_summary',
              project: session.projectPath || dir,
              content: session.longTermSummary.slice(0, 200),
              sessionTitle: session.title,
              score: 0.8,
            });
          }

          // Cari di messages (10 pesan terakhir aja)
          for (const msg of (session.messages || []).slice(-10)) {
            if (msg.content?.toLowerCase().includes(queryLower)) {
              results.push({
                type: 'message',
                project: session.projectPath || dir,
                content: msg.content.slice(0, 200),
                role: msg.role,
                sessionTitle: session.title,
                score: 0.5,
              });
            }
          }
        } catch { /* skip corrupted */ }
      }
    }

    // Sort by score (highest first), deduplicate by content
    results.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const unique = [];
    for (const r of results) {
      const key = r.content.slice(0, 50);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(r);
      }
      if (unique.length >= maxResults) break;
    }

    return unique;
  }

  /**
   * Cari preferensi user di global memory
   */
  async searchGlobalPreferences(query) {
    const global = await this._loadGlobalMemory();
    const queryLower = query.toLowerCase();
    const results = [];

    for (const pref of (global.userPreferences || [])) {
      if (pref.toLowerCase().includes(queryLower)) {
        results.push({ type: 'global_preference', content: pref });
      }
    }
    for (const fact of (global.facts || [])) {
      if (fact.toLowerCase().includes(queryLower)) {
        results.push({ type: 'global_fact', content: fact });
      }
    }

    return results;
  }
}
