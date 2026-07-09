import { chalk } from './colors.js';
import { buildTools } from './tools.js';
import { buildSystemPrompt } from './prompts.js';

// ── Provider configs ────────────────────────────────────────────
const PROVIDERS = {
  nvidia: {
    baseURL: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    envKey: 'NVIDIA_API_KEY',
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',   // DeepSeek V3
    envKey: 'DEEPSEEK_API_KEY',
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-chat-v3-0324:free',
    envKey: 'OPENROUTER_API_KEY',
  },
};

export class Agent {
  constructor({ apiKey, memory, scanner, projectPath, skillManager }) {
    // Detect provider from env or default to nvidia
    const providerName = process.env.AI_PROVIDER?.toLowerCase() || 'nvidia';
    const provider = PROVIDERS[providerName] || PROVIDERS.nvidia;

    this.apiKey = apiKey || process.env[provider.envKey];
    this.baseURL = provider.baseURL;
    this.model = process.env.AI_MODEL || provider.defaultModel;
    this.providerName = providerName;

    this.memory = memory;
    this.scanner = scanner;
    this.projectPath = projectPath;
    this.skillManager = skillManager;
    this.conversationHistory = [];
  }

  async chat(userMessage, onChunk) {
    return this.chatStream(userMessage, {
      onToolStart: (name) => { if (onChunk) onChunk(chalk.dim(`\n[🔧 ${name}]\n`)); },
      onToolEnd: (name, preview) => { if (onChunk) onChunk(chalk.dim(`   → ${preview}\n`)); },
      onToken: (token) => { if (onChunk) onChunk(token); },
      onDone: () => {},
      onError: (err) => { throw err; },
    });
  }

  /**
   * Streaming chat with structured callbacks for realtime UI
   * @param {string} userMessage
   * @param {{ onToolStart, onToolEnd, onToken, onDone, onError }} callbacks
   */
  async chatStream(userMessage, callbacks = {}) {
    const { onToolStart, onToolEnd, onToken, onDone, onError } = callbacks;

    this.conversationHistory.push({ role: 'user', content: userMessage });
    await this.memory.addMessage(this.projectPath, { role: 'user', content: userMessage });

    const projectContext = await this.scanner.getContextSummary();
    const memoryContext  = await this.memory.getRecentContext(this.projectPath);
    const skillsContext  = this.skillManager ? await this.skillManager.loadContext() : '';
    const systemPrompt   = buildSystemPrompt(projectContext, memoryContext, skillsContext);
    const tools          = buildTools(this.scanner);

    let finalText = '';
    let continueLoop = true;

    while (continueLoop) {
      // ── Real streaming via SSE ─────────────────────────────────
      const stream = this.callAPIStream({ systemPrompt, messages: this.conversationHistory, tools });

      let content = '';
      const toolCallMap = {};  // index → accumulated tool_call

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // ── Text token ──────────────────────────────────────────
        if (delta.content) {
          content += delta.content;
          if (onToken) onToken(delta.content);
        }

        // ── Tool call delta ─────────────────────────────────────
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallMap[idx]) {
              toolCallMap[idx] = {
                id: tc.id || '',
                type: 'function',
                function: { name: '', arguments: '' },
              };
            }
            const entry = toolCallMap[idx];
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.function.name += tc.function.name;
            if (tc.function?.arguments) entry.function.arguments += tc.function.arguments;
          }
        }
      }

      const toolCalls = Object.values(toolCallMap);

      if (toolCalls.length > 0) {
        // ── Tool call path ──────────────────────────────────────
        const message = { role: 'assistant', tool_calls: toolCalls };
        this.conversationHistory.push(message);

        for (const tc of toolCalls) {
          const name = tc.function.name;
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /**/ }

          if (onToolStart) onToolStart(name, args);

          const result  = await this.executeTool(name, args, tools);
          const preview = (typeof result === 'string' ? result : JSON.stringify(result)).slice(0, 150);

          if (onToolEnd) onToolEnd(name, preview);

          this.conversationHistory.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          });
        }

      } else {
        // ── Text response path ─────────────────────────────────
        finalText = content;

        this.conversationHistory.push({ role: 'assistant', content: finalText });
        await this.memory.addMessage(this.projectPath, { role: 'assistant', content: finalText });

        if (this.conversationHistory.length > 20) await this._summarizeMemory(systemPrompt);
        continueLoop = false;
      }
    }

    if (onDone) onDone(finalText);
    return finalText;
  }

  /**
   * Sanitasi messages — hapus orphan tool messages yang tidak punya
   * pasangan assistant dengan tool_calls sebelumnya. Ini safety net
   * kalau _summarizeMemory masih lobolos.
   */
  _sanitizeMessages(messages) {
    const cleaned = [];
    // Track tool_call_ids yang "aktif" dari assistant terakhir dengan tool_calls
    let activeToolCallIds = new Set();

    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        // Reset: assistant baru dengan tool_calls menggantikan yang lama
        activeToolCallIds = new Set(msg.tool_calls.map(tc => tc.id));
        cleaned.push(msg);
      } else if (msg.role === 'tool') {
        // Hanya izinkan tool message jika tool_call_id-nya dikenal
        if (activeToolCallIds.has(msg.tool_call_id)) {
          cleaned.push(msg);
        }
        // Kalau orphan, skip (tidak di-push)
      } else {
        // user, assistant (tanpa tool_calls), system — selalu aman
        activeToolCallIds.clear();
        cleaned.push(msg);
      }
    }

    return cleaned;
  }

  /**
   * Non-streaming API call — untuk summarization & internal use
   */
  async callAPINonStream({ systemPrompt, messages, tools }) {
    const cleanMessages = this._sanitizeMessages(messages);

    const body = {
      model: this.model,
      messages: [{ role: 'system', content: systemPrompt }, ...cleanMessages],
      max_tokens: 8000,
      temperature: 0.2,
      stream: false,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (this.providerName === 'openrouter') {
      headers['HTTP-Referer'] = 'https://project-analyst-agent';
      headers['X-Title'] = 'Project Analyst Agent';
    }

    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`${this.providerName.toUpperCase()} API ${res.status}: ${err.slice(0, 300)}`);
    }

    return res.json();
  }

  /**
   * Streaming API call — SSE chunk iterator
   * Yields parsed JSON delta chunks for realtime UI
   */
  async *callAPIStream({ systemPrompt, messages, tools }) {
    const cleanMessages = this._sanitizeMessages(messages);

    const body = {
      model: this.model,
      messages: [{ role: 'system', content: systemPrompt }, ...cleanMessages],
      max_tokens: 8000,
      temperature: 0.2,
      stream: true,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (this.providerName === 'openrouter') {
      headers['HTTP-Referer'] = 'https://project-analyst-agent';
      headers['X-Title'] = 'Project Analyst Agent';
    }

    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`${this.providerName.toUpperCase()} API ${res.status}: ${err.slice(0, 300)}`);
    }

    // ── Parse SSE stream ──────────────────────────────────────────
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          yield parsed;
        } catch {
          // skip unparseable chunks
        }
      }
    }
  }

  async executeTool(name, args, tools) {
    const def = tools.find((t) => t.function.name === name);
    if (!def?._handler) return `Tool "${name}" tidak ditemukan`;
    try {
      return await def._handler(args);
    } catch (err) {
      return `Error tool ${name}: ${err.message}`;
    }
  }

  /**
   * Cari batas aman untuk memotong history — tidak boleh memotong
   * di tengah grup assistant(tool_calls) → tool → tool → ...
   * Batas aman = mulai dari index message dengan role 'user' atau
   * 'assistant' (tanpa tool_calls) atau 'system'.
   */
  _findSafeCutIndex(maxKeep) {
    const total = this.conversationHistory.length;
    const startIdx = Math.max(0, total - maxKeep);

    // Geser mundur sampai ketemu role yang "aman" sebagai awal
    for (let i = startIdx; i < total; i++) {
      const role = this.conversationHistory[i].role;
      // Tool messages selalu harus didahului assistant dengan tool_calls
      if (role === 'tool') continue;
      // Kalau ini assistant dengan tool_calls, cek apakah tool_call_id di
      // message tool setelahnya valid (masih dalam array)
      if (role === 'assistant' && this.conversationHistory[i].tool_calls) {
        // Pastikan semua tool response setelahnya masih ada
        const toolCallIds = this.conversationHistory[i].tool_calls.map(tc => tc.id);
        let allToolsPresent = true;
        for (let j = i + 1; j < total; j++) {
          const msg = this.conversationHistory[j];
          if (msg.role === 'tool' && toolCallIds.includes(msg.tool_call_id)) {
            continue; // masih dalam grup yang sama
          }
          if (msg.role === 'assistant' && !msg.tool_calls) {
            break; // assistant final — batas aman
          }
          if (msg.role === 'user') break;
          if (msg.role === 'assistant' && msg.tool_calls) {
            // Mulai grup tool_calls baru — berarti semua tool sebelumnya sudah lengkap
            break;
          }
        }
        if (!allToolsPresent) continue; // tool belum lengkap, cari index berikutnya
      }
      // Role 'user', 'assistant' (tanpa tool_calls), atau 'system' — aman
      return i;
    }

    // Fallback: return total (tidak ada batas aman, keep semua)
    return total;
  }

  async _summarizeMemory(systemPrompt) {
    const safeCutIdx = this._findSafeCutIndex(10);
    const toSummarize = this.conversationHistory.slice(0, safeCutIdx);
    const recent      = this.conversationHistory.slice(safeCutIdx);

    if (!toSummarize.length) return;

    try {
      const res = await this.callAPINonStream({
        systemPrompt: 'Kamu adalah conversation summarizer.',
        messages: [{
          role: 'user',
          content: `Ringkas percakapan berikut (max 200 kata, Bahasa Indonesia):\n\n${
            toSummarize.map((m) => `${m.role}: ${m.content?.slice(0, 200)}`).join('\n')
          }`,
        }],
        tools: null,
      });

      const summary = res.choices[0].message.content;
      this.conversationHistory = [
        { role: 'system', content: `[Ringkasan sebelumnya]: ${summary}` },
        ...recent,
      ];
      await this.memory.saveSummary(this.projectPath, summary);
    } catch {
      this.conversationHistory = recent;
    }
  }
}