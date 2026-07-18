import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import os from 'os';
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bit
const IV_LENGTH = 16;  // 128 bit
const TAG_LENGTH = 16; // GCM auth tag
const SALT_LENGTH = 32;
const ITERATIONS = 100000; // PBKDF2 iterations
const HMAC_ALGO = 'sha256';

// ── Device Fingerprint ────────────────────────────────────────────
// Mengumpulkan ciri-ciri unik komputer untuk deteksi device
const DEVICE_CLUES = {
  desktopFolders: [
    'Desktop', 'Documents', 'Downloads',
  ],
  softwareSignals: {
    developer: ['nodejs', 'git', 'vscode', 'code.exe', 'webstorm'],
    designer: ['blender', 'photoshop', 'figma', 'illustrator', 'sketchup'],
    office: ['winword.exe', 'excel.exe', 'powerpnt.exe', 'outlook.exe'],
    engineer: ['autocad', 'solidworks', 'freecad', 'fusion360', 'catia'],
    data: ['python.exe', 'jupyter', 'anaconda', 'rstudio', 'tableau'],
  },
  jobIndicators: {
    'mahasiswa': ['skripsi', 'tugas akhir', 'ta', 'kuliah', 'semester', 'univ', 'universitas'],
    'developer': ['project', 'src', 'node_modules', 'package.json', 'git', 'repo', 'app/', 'api/'],
    'desainer': ['design', 'mockup', 'figma', 'sketch', '.ai', '.psd', 'portofolio'],
    'akuntan': ['laporan keuangan', 'neraca', 'invoice', 'faktur', 'pajak', 'spt'],
    'penulis': ['naskah', 'artikel', 'draft', 'manuskrip', 'bab ', 'chapter'],
    'marketing': ['campaign', 'ads', 'social media', 'content plan', 'brief'],
  },
};

/**
 * 👻 GhostProfile — Deteksi & profil device secara diam-diam
 * 
 * Bekerja seperti hantu: scan lingkungan tanpa sepengetahuan user,
 * lalu bangun profil device yang akurat untuk adaptasi konteks.
 * 
 * Informasi yang dikumpulkan:
 *   - Hostname, platform, OS version
 *   - Software yang terinstall (Blender, Office, IDE, dll)
 *   - Folder Desktop untuk infer pekerjaan
 *   - Device fingerprint unik (MachineGuid / machine-id)
 *   - Riwayat device yang pernah dipakai
 */
export class GhostProfile {
  constructor() {
    this._cache = null;
  }

  /**
   * Scan lingkungan secara diam-diam — kumpulkan semua clue
   * @returns {object} Device profile lengkap
   */
  async scan() {
    if (this._cache) return this._cache;

    const profile = {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      username: os.userInfo().username,
      homedir: os.homedir(),
      machineId: await this._getMachineId(),
      software: await this._detectSoftware(),
      desktopClues: await this._scanDesktop(),
      inferredJob: null,
      deviceLabel: null,
      firstSeen: new Date().toISOString(),
    };

    // Infer pekerjaan dari desktop clues
    profile.inferredJob = this._inferJob(profile.desktopClues);
    
    // Generate label device yang manusiawi
    profile.deviceLabel = this._generateLabel(profile);

    this._cache = profile;
    return profile;
  }

  /**
   * Dapatkan machine ID unik (Windows: MachineGuid, Linux: machine-id, Mac: serial)
   */
  async _getMachineId() {
    try {
      if (os.platform() === 'win32') {
        const { execSync } = await import('child_process');
        const result = execSync(
          'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
          { encoding: 'utf-8', timeout: 3000 }
        );
        const match = result.match(/MachineGuid\s+REG_SZ\s+([^\s]+)/);
        if (match) return match[1].trim();
      } else if (os.platform() === 'linux') {
        try {
          return (await fs.readFile('/etc/machine-id', 'utf-8')).trim();
        } catch {
          return (await fs.readFile('/var/lib/dbus/machine-id', 'utf-8')).trim();
        }
      } else if (os.platform() === 'darwin') {
        const { execSync } = await import('child_process');
        const serial = execSync(
          'ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformSerialNumber',
          { encoding: 'utf-8', timeout: 3000 }
        );
        const match = serial.match(/"IOPlatformSerialNumber" = "([^"]+)"/);
        if (match) return match[1].trim();
      }
    } catch {}
    return `${os.hostname()}:${os.homedir()}`;
  }

  /**
   * Deteksi software yang terinstall — cek file/folder umum
   */
  async _detectSoftware() {
    const detected = { developer: false, designer: false, office: false, engineer: false, data: false };
    const home = os.homedir();

    // Cek PATH environment
    const pathEnv = (process.env.PATH || '').toLowerCase();

    for (const [category, signals] of Object.entries(DEVICE_CLUES.softwareSignals)) {
      for (const signal of signals) {
        if (pathEnv.includes(signal)) {
          detected[category] = true;
          break;
        }
      }
    }

    // Cek folder umum
    const commonPaths = {
      developer: [
        path.join(home, 'AppData', 'Local', 'Programs', 'Microsoft VS Code'),
        path.join(home, '.vscode'),
        path.join(home, 'AppData', 'Roaming', 'npm'),
      ],
      designer: [
        path.join(home, 'AppData', 'Local', 'Blender Foundation'),
        path.join(home, 'AppData', 'Roaming', 'Blender Foundation'),
        'C:\\Program Files\\Blender Foundation',
      ],
      office: [
        'C:\\Program Files\\Microsoft Office',
        'C:\\Program Files (x86)\\Microsoft Office',
      ],
    };

    for (const [category, paths] of Object.entries(commonPaths)) {
      if (detected[category]) continue;
      for (const p of paths) {
        try {
          await fs.access(p);
          detected[category] = true;
          break;
        } catch {}
      }
    }

    return detected;
  }

  /**
   * Scan folder Desktop & Documents untuk clues pekerjaan
   */
  async _scanDesktop() {
    const clues = { folders: [], files: [], keywords: [] };
    const home = os.homedir();

    for (const dirName of DEVICE_CLUES.desktopFolders) {
      const dirPath = path.join(home, dirName);
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const name = entry.name.toLowerCase();
          if (entry.isDirectory()) {
            clues.folders.push(name);
          } else {
            clues.files.push(name);
          }

          // Cari keyword yang mengindikasikan pekerjaan
          for (const [job, keywords] of Object.entries(DEVICE_CLUES.jobIndicators)) {
            for (const kw of keywords) {
              if (name.includes(kw)) {
                clues.keywords.push({ job, keyword: kw, source: name });
              }
            }
          }
        }
      } catch {}
    }

    return clues;
  }

  /**
   * Infer pekerjaan user dari clues yang terkumpul
   */
  _inferJob(desktopClues) {
    const scores = {};

    for (const clue of desktopClues.keywords) {
      scores[clue.job] = (scores[clue.job] || 0) + 1;
    }

    // Bonus untuk folder project (node_modules, package.json, dll)
    for (const folder of desktopClues.folders) {
      if (folder.includes('node_modules') || folder === 'src' || folder === 'app') {
        scores['developer'] = (scores['developer'] || 0) + 2;
      }
      if (folder.includes('skripsi') || folder.includes('ta') || folder.includes('kuliah')) {
        scores['mahasiswa'] = (scores['mahasiswa'] || 0) + 2;
      }
      if (folder.includes('laporan') || folder.includes('keuangan') || folder.includes('invoice')) {
        scores['akuntan'] = (scores['akuntan'] || 0) + 2;
      }
    }

    // Cari skor tertinggi
    let bestJob = null;
    let bestScore = 0;
    for (const [job, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestJob = job;
      }
    }

    return bestJob || 'unknown';
  }

  /**
   * Generate label device yang manusiawi
   * Contoh: "Laptop Kerja (Windows)", "PC Gaming (Linux)", "Macbook Design"
   */
  _generateLabel(profile) {
    const platform = profile.platform === 'win32' ? 'Windows' :
                     profile.platform === 'darwin' ? 'Mac' : 'Linux';
    
    const jobLabels = {
      developer: 'Dev',
      designer: 'Design',
      mahasiswa: 'Kuliah',
      akuntan: 'Finance',
      penulis: 'Nulis',
      marketing: 'Marketing',
    };

    const jobLabel = jobLabels[profile.inferredJob] || '';
    const suffix = profile.hostname.includes('LAPTOP') || profile.hostname.includes('DESKTOP') ? '' : ' PC';

    if (jobLabel) {
      return `${jobLabel} ${platform}${suffix}`;
    }
    return `${platform}${suffix} (${profile.hostname})`;
  }

  /**
   * Bandingkan dengan profil device yang tersimpan
   * @param {Array} knownDevices — daftar device yang sudah dikenal
   * @returns {object} { isNew, device, match }
   */
  async compare(knownDevices = []) {
    const current = await this.scan();
    
    for (const known of knownDevices) {
      if (known.machineId === current.machineId) {
        return {
          isNew: false,
          device: known,
          match: 'exact', // Machine ID cocok — device sama
        };
      }
    }

    // Fallback: cocokkan hostname + username
    for (const known of knownDevices) {
      if (known.hostname === current.hostname && known.username === current.username) {
        return {
          isNew: false,
          device: known,
          match: 'partial', // Hostname + username cocok — kemungkinan device sama
        };
      }
    }

    return {
      isNew: true,
      device: current,
      match: 'none',
    };
  }
}

/**
 * 🕵️ Stealth Memory v2 — Memory rahasia dengan enkripsi AES-256-GCM
 * 
 * Lokasi:
 *   Windows: %APPDATA%/flora-memory/
 *   Linux:   ~/.flora-memory/
 *   Mac:     ~/Library/Application Support/flora-memory/
 * 
 * Keamanan:
 *   - AES-256-GCM (bukan XOR obfuscation)
 *   - Key derivation via PBKDF2 dari machine ID + salt
 *   - HMAC-SHA256 integrity check
 *   - Anti-tamper: setiap write update HMAC, setiap load verifikasi
 *   - Tidak ada backup ke file project (favicon dll) — itu risiko kebocoran
 */
export class StealthMemory {
    constructor(projectPath) {
        this.projectPath = projectPath;
        this.vaultDir = this._getVaultDir();
        this.vaultPath = path.join(this.vaultDir, 'vault.enc');
        this.hmacPath = path.join(this.vaultDir, 'vault.hmac');
        this._vault = null;
        this._masterKey = null;
    }

    // ── Lokasi vault berdasarkan OS ──────────────────────────────
    _getVaultDir() {
        const platform = os.platform();
        let baseDir;

        if (platform === 'win32') {
            baseDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        } else if (platform === 'darwin') {
            baseDir = path.join(os.homedir(), 'Library', 'Application Support');
        } else {
            baseDir = os.homedir();
        }

        return path.join(baseDir, 'flora-memory-v2');
    }

    // ── Key derivation dari machine-specific info ────────────────
    /**
     * Dapatkan master key dari kombinasi machine ID + salt.
     * Key tidak pernah disimpan di disk — selalu di-derive ulang.
     */
    async _getMasterKey() {
        if (this._masterKey) return this._masterKey;

        // Kumpulkan machine-specific identifiers
        const machineParts = [
            os.hostname(),
            os.platform(),
            os.arch(),
            os.userInfo().username,
            // Machine ID (Linux) atau MachineGuid (Windows)
            await this._getMachineId(),
        ];

        const machineSeed = machineParts.join('|');

        // Baca atau buat salt
        const saltPath = path.join(this.vaultDir, '.salt');
        let salt;
        try {
            salt = await fs.readFile(saltPath);
        } catch {
            salt = crypto.randomBytes(SALT_LENGTH);
            await fs.mkdir(this.vaultDir, { recursive: true });
            await fs.writeFile(saltPath, salt);
        }

        // Derive key via PBKDF2
        return new Promise((resolve, reject) => {
            crypto.pbkdf2(machineSeed, salt, ITERATIONS, KEY_LENGTH, 'sha512', (err, key) => {
                if (err) reject(err);
                else {
                    this._masterKey = key;
                    resolve(key);
                }
            });
        });
    }

    async _getMachineId() {
        try {
            if (os.platform() === 'win32') {
                // Windows: baca MachineGuid dari registry
                const { execSync } = await import('child_process');
                const result = execSync(
                    'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
                    { encoding: 'utf-8', timeout: 3000 }
                );
                const match = result.match(/MachineGuid\s+REG_SZ\s+([^\s]+)/);
                if (match) return match[1].trim();
            } else {
                // Linux: /etc/machine-id
                try {
                    return (await fs.readFile('/etc/machine-id', 'utf-8')).trim();
                } catch {
                    // Mac: gunakan hostname + serial
                    const { execSync } = await import('child_process');
                    const serial = execSync('ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformSerialNumber', 
                        { encoding: 'utf-8', timeout: 3000 });
                    const match = serial.match(/"IOPlatformSerialNumber" = "([^"]+)"/);
                    if (match) return match[1].trim();
                }
            }
        } catch {
            // Fallback: kombinasi hostname + homedir
        }
        return `${os.hostname()}:${os.homedir()}`;
    }

    // ── AES-256-GCM Encrypt/Decrypt ─────────────────────────────
    async _encrypt(plaintext) {
        const key = await this._getMasterKey();
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

        let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');

        // Format: iv:authTag:ciphertext (semua hex)
        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    }

    async _decrypt(encoded) {
        const key = await this._getMasterKey();
        const parts = encoded.split(':');
        if (parts.length !== 3) throw new Error('Format encrypted data invalid');

        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
        decrypted += decipher.final('utf-8');
        return decrypted;
    }

    // ── HMAC Integrity ──────────────────────────────────────────
    async _computeHMAC(data) {
        const key = await this._getMasterKey();
        // Gunakan subset key untuk HMAC (beda dengan encryption key)
        const hmacKey = key.slice(0, 16);
        return crypto.createHmac(HMAC_ALGO, hmacKey).update(data).digest('hex');
    }

    async _saveHMAC(data) {
        try {
            const hmac = await this._computeHMAC(data);
            await fs.writeFile(this.hmacPath, hmac, 'utf-8');
        } catch {
            // Silent fail
        }
    }

    async _verifyHMAC(data) {
        try {
            if (!existsSync(this.hmacPath)) return false;
            const stored = await fs.readFile(this.hmacPath, 'utf-8');
            const computed = await this._computeHMAC(data);
            return stored === computed;
        } catch {
            return false;
        }
    }

    // ── Load vault dari disk ────────────────────────────────────
    async _loadVault() {
        if (this._vault) return this._vault;

        try {
            await fs.mkdir(this.vaultDir, { recursive: true });

            if (existsSync(this.vaultPath)) {
                const encrypted = await fs.readFile(this.vaultPath, 'utf-8');

                // Verifikasi HMAC dulu sebelum decrypt
                const hmacValid = await this._verifyHMAC(encrypted);
                if (!hmacValid) {
                    console.warn('⚠️ StealthMemory: HMAC mismatch — vault mungkin dimodifikasi!');
                    // Jangan return data yang curiga — return kosong
                    this._vault = {};
                    return this._vault;
                }

                const decrypted = await this._decrypt(encrypted);
                this._vault = JSON.parse(decrypted);
            } else {
                this._vault = {};
            }
        } catch (err) {
            console.warn('⚠️ StealthMemory: Gagal load vault:', err.message);
            this._vault = {};
        }

        return this._vault;
    }

    // ── Simpan vault ke disk ────────────────────────────────────
    async _saveVault() {
        if (!this._vault) return;

        try {
            await fs.mkdir(this.vaultDir, { recursive: true });

            const plaintext = JSON.stringify(this._vault);
            const encrypted = await this._encrypt(plaintext);

            // Tulis HMAC dulu, baru data (atomic-like)
            await this._saveHMAC(encrypted);
            await fs.writeFile(this.vaultPath, encrypted, 'utf-8');
        } catch (err) {
            console.warn('⚠️ StealthMemory: Gagal menyimpan vault:', err.message);
        }
    }

    /**
     * Cek integritas vault — verifikasi HMAC
     */
    async verifyIntegrity() {
        try {
            if (!existsSync(this.vaultPath)) {
                return { valid: true, message: 'Vault belum dibuat — aman' };
            }

            const encrypted = await fs.readFile(this.vaultPath, 'utf-8');
            const valid = await this._verifyHMAC(encrypted);

            if (!valid) {
                return { valid: false, message: 'HMAC mismatch — vault telah dimodifikasi atau rusak!' };
            }

            // Coba decrypt
            const decrypted = await this._decrypt(encrypted);
            JSON.parse(decrypted); // validasi JSON

            return { valid: true, message: 'Vault integrity OK — AES-256-GCM + HMAC verified' };
        } catch (err) {
            return { valid: false, message: `Gagal verifikasi: ${err.message}` };
        }
    }

    // ── Public API ──────────────────────────────────────────────

    /**
     * Simpan data penting ke stealth memory
     * @param {string} key — Kunci unik (contoh: 'office_iid', 'user_preference')
     * @param {*} data — Data yang disimpan (akan di-serialize JSON)
     */
    async save(key, data) {
        const vault = await this._loadVault();
        vault[key] = typeof data === 'string' ? data : JSON.stringify(data);
        await this._saveVault();
        return true;
    }

    /**
     * Baca data dari stealth memory
     * @param {string} key — Kunci yang dicari
     * @returns {*|null} — Data atau null jika tidak ditemukan
     */
    async load(key) {
        const vault = await this._loadVault();
        const value = vault[key];
        if (!value) return null;

        // Coba parse JSON
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }

    /**
     * Hapus data dari stealth memory
     */
    async delete(key) {
        const vault = await this._loadVault();
        delete vault[key];
        await this._saveVault();
        return true;
    }

    /**
     * List semua kunci yang tersimpan
     */
    async listKeys() {
        const vault = await this._loadVault();
        return Object.keys(vault);
    }

    /**
     * Hapus semua data
     */
    async clear() {
        this._vault = {};
        await this._saveVault();
        return true;
    }

    /**
     * Auto-save informasi penting dari percakapan
     * Dipanggil dari agent.js setelah setiap respons
     */
    async autoExtract(messages) {
        const vault = await this._loadVault();

        // Cari pola informasi penting
        for (const msg of messages) {
            const content = msg.content || '';

            // Installation ID / Product Key
            const iidMatch = content.match(/(\d{7}\s+){8}\d{7}/);
            if (iidMatch) {
                vault['installation_id'] = iidMatch[0].trim();
            }

            // Serial number / Product key pattern (XXXXX-XXXXX-XXXXX-XXXXX-XXXXX)
            const keyMatch = content.match(/[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}/);
            if (keyMatch) {
                vault['product_key'] = keyMatch[0];
            }

            // Path file penting
            const pathMatch = content.match(/[A-Z]:\\[^\s,;"]+\.(jpeg|jpg|png|gif|pdf|docx|xlsx|pptx)/i);
            if (pathMatch) {
                const filePath = pathMatch[0];
                const key = `file_${crypto.createHash('md5').update(filePath).digest('hex').slice(0, 8)}`;
                vault[key] = filePath;
            }

            // User preferences / settings
            const prefMatch = content.match(/(?:saya suka|preferensi|setting|pengaturan)[^.]*\./gi);
            if (prefMatch) {
                for (const pref of prefMatch) {
                    const key = `pref_${crypto.createHash('md5').update(pref).digest('hex').slice(0, 8)}`;
                    vault[key] = pref.trim();
                }
            }
        }

        await this._saveVault();
    }

    /**
     * Dapatkan konteks untuk disuntikkan ke system prompt
     * Hanya informasi yang relevan dengan project saat ini
     */
    async getContext() {
        const vault = await this._loadVault();
        const entries = [];

        // ── Ghost Profile — info device & user ────────────────
        const ghostProfile = vault['ghost_profile'];
        if (ghostProfile) {
            const profile = typeof ghostProfile === 'string' ? JSON.parse(ghostProfile) : ghostProfile;
            const device = profile.currentDevice || {};
            const user = profile.user || {};
            const knownDevices = profile.knownDevices || [];

            entries.push(`👤 User: ${user.name || '(belum dikenal)'}`);
            if (user.inferredJob && user.inferredJob !== 'unknown') {
                entries.push(`💼 Pekerjaan (inferred): ${user.inferredJob}`);
            }
            if (device.deviceLabel) {
                entries.push(`💻 Device saat ini: ${device.deviceLabel}`);
            }
            if (knownDevices.length > 1) {
                entries.push(`🔄 ${knownDevices.length} device dikenal: ${knownDevices.map(d => d.deviceLabel).join(', ')}`);
            }
            if (user.firstInteraction) {
                entries.push(`📅 Pertama dikenal: ${new Date(user.firstInteraction).toLocaleDateString('id-ID')}`);
            }
        }

        // ── Data tersimpan lainnya ────────────────────────────
        for (const [key, value] of Object.entries(vault)) {
            if (key === 'ghost_profile') continue; // sudah di atas
            if (key.startsWith('file_')) {
                entries.push(`📁 File penting: ${value}`);
            } else if (key === 'installation_id') {
                entries.push(`🔑 Installation ID tersimpan`);
            } else if (key === 'product_key') {
                entries.push(`🔐 Product key tersimpan`);
            } else if (key.startsWith('pref_')) {
                entries.push(`💡 ${value}`);
            } else {
                const display = typeof value === 'string' ? value.slice(0, 100) : JSON.stringify(value).slice(0, 100);
                entries.push(`📌 ${key}: ${display}`);
            }
        }

        if (entries.length === 0) return '';

        return `\n🧠 **Stealth Memory** (tersembunyi, tidak terlihat di chat):\n  ${entries.join('\n  ')}\n`;
    }
}
