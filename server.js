import express from 'express';
import cors from 'cors';
import { readFileSync, existsSync, renameSync, mkdirSync } from 'fs';
import { Agent } from './src/agent.js';
import { Memory } from './src/memory.js';
import { ProjectScanner } from './src/scanner.js';
import { SkillManager } from './src/skills.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load .env ──────────────────────────────────────────────────
const envFile = path.join(__dirname, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  console.log('✅ .env loaded');
}

// ── Resolve API key berdasarkan provider ───────────────────────
const provider = process.env.AI_PROVIDER || 'nvidia';
const apiKey =
  provider === 'openrouter' ? process.env.OPENROUTER_API_KEY :
  provider === 'deepseek'   ? process.env.DEEPSEEK_API_KEY :
  process.env.NVIDIA_API_KEY;

if (!apiKey) {
  console.error(`❌ API key tidak ditemukan untuk provider "${provider}"`);
  console.error('   Isi file .env di folder ini');
  console.warn('⚠️  Lanjut tanpa API key');
}

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// ── Init agent ─────────────────────────────────────────────────
const projectPath  = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const memory       = new Memory(path.join(__dirname, 'memory'));
const scanner      = new ProjectScanner(projectPath);
const skillManager = new SkillManager(path.join(__dirname, 'skills'));
const agent        = new Agent({ apiKey, memory, scanner, projectPath, skillManager });

console.log(`🤖 Agent siap! Provider: ${provider.toUpperCase()}`);

// ── Routes ─────────────────────────────────────────────────────

// Chat / analyze (SSE streaming — realtime)
app.post('/api/analyze/stream', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query kosong' });

  console.log(`📩 [SSE] Query: ${query.slice(0, 80)}`);

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await agent.chatStream(query, {
      onToolStart: (name, args) => {
        send('tool_start', { name, args });
      },
      onToolEnd: (name, preview) => {
        send('tool_end', { name, preview });
      },
      onToken: (token) => {
        send('token', { text: token });
      },
      onDone: (fullText) => {
        send('done', { text: fullText });
      },
      onError: (err) => {
        send('error', { message: err.message });
      },
    });
  } catch (err) {
    console.error('❌ Agent SSE error:', err.message);
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

// Chat / analyze (non-streaming — fallback)
app.post('/api/analyze', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query kosong' });

  console.log(`📩 Query: ${query.slice(0, 80)}`);

  try {
    let fullText = '';
    const toolCalls = [];
    await agent.chatStream(query, {
      onToolStart: (name, args) => { toolCalls.push({ name, status: 'running', preview: '' }); },
      onToolEnd: (name, preview) => {
        const tc = toolCalls.find(t => t.name === name && t.status === 'running');
        if (tc) { tc.status = 'done'; tc.preview = preview; }
      },
      onToken: (token) => { fullText += token; },
      onDone: () => {},
      onError: (err) => { throw err; },
    });

    res.json({
      text: fullText,
      toolCalls,
      data: {
        labels: ['Relevansi', 'Kompleksitas', 'Kualitas', 'Performa'],
        values: [
          Math.floor(Math.random() * 40) + 60,
          Math.floor(Math.random() * 40) + 60,
          Math.floor(Math.random() * 40) + 60,
          Math.floor(Math.random() * 40) + 60,
        ],
      },
    });
  } catch (err) {
    console.error('❌ Agent error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Project info
app.get('/api/project', async (req, res) => {
  try {
    const info   = await scanner.quickScan();
    const skills = await skillManager.listInstalled();
    const tree   = await scanner.getTree(4);
    res.json({
      projectPath,
      provider,
      totalFiles: info.totalFiles,
      techStack:  info.techStack,
      skills,
      tree,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Memory — full data (session-aware)
app.get('/api/memory', async (req, res) => {
  try {
    const mem = await memory.getAll(projectPath);
    res.json(mem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sessions — list all sessions
app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await memory.listSessions(projectPath);
    const activeId = await memory.getActiveSessionId(projectPath);
    res.json({ sessions, activeId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sessions — create new
app.post('/api/sessions', async (req, res) => {
  try {
    const { title } = req.body || {};
    const session = await memory.createSession(projectPath, title || 'Chat baru');
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sessions — switch active
app.post('/api/sessions/:id/activate', async (req, res) => {
  try {
    const session = await memory.switchSession(projectPath, req.params.id);
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Sessions — delete
app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await memory.deleteSession(projectPath, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Memory — reset current session
app.delete('/api/memory', async (req, res) => {
  try {
    await memory.reset(projectPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Skills
app.get('/api/skills', async (req, res) => {
  const installed  = await skillManager.listInstalled();
  const available  = skillManager.listAvailable();
  res.json({ installed, available });
});

app.post('/api/skills/:name', async (req, res) => {
  try {
    const result = await skillManager.add(req.params.name);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/skills/:name', async (req, res) => {
  try {
    await skillManager.remove(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Tree
app.get('/api/tree', async (req, res) => {
  try {
    const tree = await scanner.getTree(4);
    res.json({ tree });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (_, res) => {
  res.json({ ok: true, provider, projectPath });
});

// Upload folder
import multer from 'multer';

const upload = multer({ dest: '/tmp/uploads/' });

app.post('/api/upload-folder', upload.array('files'), async (req, res) => {
  try {
    const uploadPath = `/tmp/project-${Date.now()}`;
    
    for (const file of req.files) {
      const destPath = path.join(uploadPath, file.originalname);
      mkdirSync(path.dirname(destPath), { recursive: true });
      renameSync(file.path, destPath);
    }
    
    // Re-init scanner ke folder baru
    const newScanner = new ProjectScanner(uploadPath);
    const info = await newScanner.quickScan();
    
    res.json({
      projectPath: uploadPath,
      totalFiles: info.totalFiles,
      techStack: info.techStack,
      skills: await skillManager.listInstalled(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend Agent JALAN di http://localhost:${PORT}`);
});
