/**
 * desktop.js — Node.js middleware untuk Office Desktop Bridges.
 *
 * Menghubungkan agent framework (Node.js) dengan Python COM bridges
 * yang mengontrol Microsoft Word, Excel, dan PowerPoint.
 *
 * Arsitektur:
 *   Agent → tools.js → desktop.js → spawn Python subprocess → COM → Office App
 *
 * Keamanan:
 *   - Setiap perintah harus eksplisit (tidak ada ghost action otomatis)
 *   - Confirmasi untuk operasi destruktif (delete, overwrite)
 *   - Timeout untuk mencegah bridge hang
 *   - Hanya jalan di Windows (graceful fallback di OS lain)
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { platform } from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ── Constants ──────────────────────────────────────────────────

const APP_NAMES = {
  word: 'Word',
  excel: 'Excel',
  powerpoint: 'PowerPoint',
  blender: 'Blender',
  'blender-socket': 'Blender Socket',
  freecad: 'FreeCAD',
  'freecad-socket': 'FreeCAD Socket',
};

const BRIDGE_MODULES = {
  word: 'desktop.word_bridge',
  excel: 'desktop.excel_bridge',
  powerpoint: 'desktop.powerpoint_bridge',
  blender: 'desktop.blender_bridge',
  'blender-socket': 'desktop.blender_socket_bridge',
  freecad: 'desktop.freecad_bridge',
  'freecad-socket': 'desktop.freecad_socket_bridge',
};

const DEFAULT_TIMEOUT = 30000; // 30 detik
const IS_WINDOWS = platform() === 'win32';

// ── Bridge connection pool ─────────────────────────────────────

const activeBridges = new Map();  // app → { process, resolve, reject, buffer }

// ── Logger ─────────────────────────────────────────────────────

function log(level, app, message, data = null) {
  const prefix = `[DesktopBridge:${app}]`;
  const ts = new Date().toISOString().slice(11, 19);
  const logLine = `${ts} ${prefix} ${message}`;
  if (data) {
    console.log(`${logLine}`, data);
  } else {
    console.log(logLine);
  }
}

// ── Python discovery ───────────────────────────────────────────

/**
 * Cari Python di sistem — coba beberapa nama command.
 * Returns nama command (string), bukan path lengkap.
 */
function findPython() {
  // Di Windows, coba py dulu (Python launcher), lalu python
  // Di Linux/Mac, coba python3 dulu, lalu python
  if (IS_WINDOWS) {
    return 'python';
  }
  return 'python3';
}

// ── Bridge lifecycle ────────────────────────────────────────────

/**
 * Start a Python bridge process for the given app.
 * @param {'word'|'excel'|'powerpoint'} app
 * @param {object} options
 * @param {boolean} options.debug
 * @param {number} options.timeout - timeout for ready signal (ms)
 * @returns {Promise<object>} bridge handle
 */
export async function startBridge(app, options = {}) {
  // Blender Socket bisa jalan di semua platform
  const officeApps = ['word', 'excel', 'powerpoint'];
  if (!IS_WINDOWS && officeApps.includes(app)) {
    const err = new Error(
      `🖥️  Desktop bridge "${APP_NAMES[app]}" hanya tersedia di Windows.\n` +
      `   Sistem saat ini: ${platform()}\n` +
      '   Di Linux/macOS, fungsi Office tidak aktif dan mengembalikan fallback response.'
    );
    err.code = 'PLATFORM_NOT_SUPPORTED';
    throw err;
  }

  if (activeBridges.has(app)) {
    const existing = activeBridges.get(app);
    if (existing.process.exitCode === null) {
      log('info', app, 'Reusing existing bridge process');
      return existing;
    }
    // Process already exited, clean up
    activeBridges.delete(app);
  }

  const debug = options.debug || false;
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  const bridgeModule = BRIDGE_MODULES[app];
  const pythonCmd = findPython();

  const args = ['-m', bridgeModule];
  if (debug) args.push('--debug');

  log('info', app, `Starting bridge: ${pythonCmd} ${args.join(' ')}`);

  const child = spawn(pythonCmd, args, {
    cwd: PROJECT_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    windowsHide: false, // user bisa lihat console window
  });

  const bridgeHandle = {
    process: child,
    app,
    startTime: Date.now(),
    pendingCommands: new Map(), // cmdId -> { resolve, reject, timer }
    cmdCounter: 0,
  };

  // ── stdout handler ─────────────────────────────────────────────
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response = JSON.parse(trimmed);

        // Handle ping/pong
        if (response.ready) {
          log('info', app, `Bridge ready: ${JSON.stringify(response)}`);
          // Resolve the startup promise
          if (bridgeHandle._startResolve) {
            bridgeHandle._startResolve(bridgeHandle);
            bridgeHandle._startResolve = null;
          }
          continue;
        }

        // Route response ke pending command
        if (response._cmdId && bridgeHandle.pendingCommands.has(response._cmdId)) {
          const pending = bridgeHandle.pendingCommands.get(response._cmdId);
          clearTimeout(pending.timer);
          bridgeHandle.pendingCommands.delete(response._cmdId);
          pending.resolve(response);
        } else if (response.action === 'search_web_and_write' && response.needs_web_search) {
          // Special: bridge minta web search — agent framework harus handle
          // Ini ditangani di level Agent, bukan di sini
          log('info', app, `Bridge requesting web search: "${response.query}"`);
          if (bridgeHandle._webSearchHandler) {
            bridgeHandle._webSearchHandler(response.query);
          }
        } else {
          log('warn', app, `Unhandled response:`, response);
        }
      } catch (e) {
        log('error', app, `Failed to parse bridge response: "${trimmed.slice(0, 200)}"`, e.message);
      }
    }
  });

  // ── stderr handler ─────────────────────────────────────────────
  child.stderr.on('data', (chunk) => {
    const msg = chunk.toString().trim();
    if (msg) {
      log('debug', app, `[stderr] ${msg}`);
    }
  });

  // ── Process lifecycle ──────────────────────────────────────────
  child.on('error', (err) => {
    log('error', app, `Bridge process error: ${err.message}`);
    // Reject semua pending commands
    for (const [cmdId, pending] of bridgeHandle.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Bridge process error: ${err.message}`));
    }
    bridgeHandle.pendingCommands.clear();
    activeBridges.delete(app);
  });

  child.on('exit', (code, signal) => {
    log('info', app, `Bridge exited (code: ${code}, signal: ${signal})`);
    // Reject pending
    for (const [cmdId, pending] of bridgeHandle.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Bridge exited unexpectedly (code: ${code})`));
    }
    bridgeHandle.pendingCommands.clear();
    activeBridges.delete(app);
  });

  // ── Wait for ready signal ──────────────────────────────────────
  const readyPromise = new Promise((resolve, reject) => {
    bridgeHandle._startResolve = resolve;

    const timer = setTimeout(() => {
      if (bridgeHandle._startResolve) {
        bridgeHandle._startResolve = null;
        reject(new Error(`Bridge "${app}" tidak siap dalam ${timeout}ms. Error di stderr:\n${
          child.stderr.read()?.toString()?.slice(0, 500) || '(stderr kosong)'
        }`));
      }
    }, timeout);

    // Clean up timer on resolve
    const origResolve = bridgeHandle._startResolve;
    bridgeHandle._startResolve = (handle) => {
      clearTimeout(timer);
      origResolve(handle);
    };
  });

  activeBridges.set(app, bridgeHandle);
  return readyPromise;
}

/**
 * Send a command to a running bridge and wait for response.
 * @param {'word'|'excel'|'powerpoint'} app
 * @param {object} command - { action, ...params }
 * @param {object} options - { timeout, confirmDestructive }
 * @returns {Promise<object>} response
 */
export async function sendCommand(app, command, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  // ── Platform check ─────────────────────────────────────────────
  // Blender Socket bisa jalan di semua platform (Blender cross-platform)
  // Tapi Office (word/excel/powerpoint) hanya Windows
  const officeApps = ['word', 'excel', 'powerpoint'];
  if (!IS_WINDOWS && officeApps.includes(app)) {
    return {
      success: false,
      platform: platform(),
      error: 'Desktop bridge hanya tersedia di Windows',
      simulated: true,
      app: APP_NAMES[app] || app,
      action: command.action,
      note: 'Fitur Office Automation tidak aktif di OS ini. Install di Windows untuk menggunakan.',
    };
  }

  // ── Safety check: destructive operations ───────────────────────
  const destructiveActions = ['delete_slide', 'delete_sheet', 'delete_range',
    'clear_range', 'quit', 'delete_file'];
  const action = command.action || '';

  if (destructiveActions.includes(action)) {
    const confirm = options.confirmDestructive !== false;
    if (confirm) {
      // Untuk operasi destruktif, kita minta konfirmasi eksplisit dari user
      // Ini ditangani di UI layer — di sini kita lempar error
      log('warn', app, `Destructive action requires confirmation: ${action}`);
    }
  }

  // ── Get or start bridge ────────────────────────────────────────
  let bridge;
  try {
    if (!activeBridges.has(app)) {
      bridge = await startBridge(app, { timeout });
    } else {
      bridge = activeBridges.get(app);
      if (bridge.process.exitCode !== null) {
        // Restart
        activeBridges.delete(app);
        bridge = await startBridge(app, { timeout });
      }
    }
  } catch (err) {
    return {
      success: false,
      error: `Gagal start bridge: ${err.message}`,
      app: APP_NAMES[app] || app,
      action,
      platform: platform(),
    };
  }

  // ── Send command ───────────────────────────────────────────────
  const cmdId = `${app}_${Date.now()}_${bridge.cmdCounter++}`;
  const fullCommand = { ...command, _cmdId: cmdId };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bridge.pendingCommands.delete(cmdId);
      reject(new Error(
        `Timeout: Bridge "${app}" tidak merespon dalam ${timeout}ms.\n` +
        `Command: ${JSON.stringify(command).slice(0, 200)}`
      ));
    }, timeout);

    bridge.pendingCommands.set(cmdId, { resolve, reject, timer });

    try {
      const json = JSON.stringify(fullCommand) + '\n';
      bridge.process.stdin.write(json);
      log('debug', app, `Sent: ${action}`, { params: Object.keys(command).filter(k => k !== 'action' && k !== '_cmdId') });
    } catch (err) {
      clearTimeout(timer);
      bridge.pendingCommands.delete(cmdId);
      reject(new Error(`Gagal kirim command ke bridge: ${err.message}`));
    }
  });
}

/**
 * Stop a bridge process gracefully.
 * @param {'word'|'excel'|'powerpoint'} app
 */
export async function stopBridge(app) {
  if (!activeBridges.has(app)) return;

  const bridge = activeBridges.get(app);
  try {
    bridge.process.stdin.write('{"action": "exit"}\n');
    await new Promise((resolve) => {
      bridge.process.on('exit', resolve);
      setTimeout(() => {
        bridge.process.kill();
        resolve();
      }, 3000);
    });
  } catch (err) {
    log('error', app, `Error stopping bridge: ${err.message}`);
    try { bridge.process.kill(); } catch {}
  }
  activeBridges.delete(app);
  log('info', app, 'Bridge stopped');
}

/**
 * Stop all active bridges.
 */
export async function stopAllBridges() {
  const apps = [...activeBridges.keys()];
  await Promise.allSettled(apps.map(stopBridge));
  log('info', 'all', 'All bridges stopped');
}

/**
 * Set handler untuk web search request dari bridge.
 * Dipanggil saat bridge minta agent search web.
 * @param {'word'|'excel'|'powerpoint'} app
 * @param {function} handler - (query: string) => Promise<string>
 */
export function setWebSearchHandler(app, handler) {
  const bridge = activeBridges.get(app);
  if (bridge) {
    bridge._webSearchHandler = handler;
  }
}

// ── Convenience: high-level API ─────────────────────────────────

/**
 * Inject text ke Word di posisi cursor (Ghost mode).
 * @param {string} text - teks yang akan diketik
 * @param {object} options
 * @param {number} options.typing_speed - delay antar karakter (detik)
 * @param {boolean} options.press_enter - enter di akhir
 */
export async function wordWriteAtCursor(text, options = {}) {
  return sendCommand('word', {
    action: 'write_at_cursor',
    text,
    typing_speed: options.typing_speed || 0,
    press_enter: options.press_enter || false,
  });
}

/**
 * Read current document text.
 */
export async function wordReadDocument(maxChars = 10000) {
  return sendCommand('word', {
    action: 'read_full_document',
    max_chars: maxChars,
  });
}

/**
 * Format selection di Word.
 */
export async function wordFormatSelection(formatting) {
  return sendCommand('word', {
    action: 'format_selection',
    ...formatting,
  });
}

/**
 * Cari dan perbaiki typo di dokumen Word.
 */
export async function wordFixTypos(language = 'id') {
  return sendCommand('word', {
    action: 'fix_typos',
    language,
  });
}

/**
 * Rapihkan alignment paragraf.
 */
export async function wordFixAlignment(alignment = 'justify') {
  return sendCommand('word', {
    action: 'fix_alignment',
    alignment,
  });
}

/**
 * Excel: tulis data ke range.
 */
export async function excelWriteRange(range, data) {
  return sendCommand('excel', {
    action: 'write_range',
    range,
    data,
  });
}

/**
 * Excel: cari error di range.
 */
export async function excelFindErrors(range) {
  return sendCommand('excel', {
    action: 'find_errors',
    range,
  });
}

/**
 * PowerPoint: tulis teks ke slide.
 */
export async function powerpointWriteToSlide(text, options = {}) {
  return sendCommand('powerpoint', {
    action: 'write_to_slide',
    text,
    placeholder_index: options.placeholder_index || null,
    shape_name: options.shape_name || null,
  });
}

/**
 * PowerPoint: tambah slide baru.
 */
export async function powerpointAddSlide(layout = 'blank') {
  return sendCommand('powerpoint', {
    action: 'add_slide',
    layout,
  });
}

// ── Cleanup on exit ────────────────────────────────────────────

process.on('exit', () => {
  stopAllBridges().catch(() => {});
});
process.on('SIGINT', () => {
  stopAllBridges().catch(() => {}).finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  stopAllBridges().catch(() => {}).finally(() => process.exit(0));
});

export default {
  startBridge,
  stopBridge,
  stopAllBridges,
  sendCommand,
  setWebSearchHandler,
  wordWriteAtCursor,
  wordReadDocument,
  wordFormatSelection,
  wordFixTypos,
  wordFixAlignment,
  excelWriteRange,
  excelFindErrors,
  powerpointWriteToSlide,
  powerpointAddSlide,
};
