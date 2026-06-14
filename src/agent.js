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
      const response = await this.callAPI({ systemPrompt, messages: this.conversationHistory, tools });
      const message  = response.choices[0].message;

      if (message.tool_calls && message.tool_calls.length > 0) {
        this.conversationHistory.push(message);

        for (const tc of message.tool_calls) {
          const name = tc.function.name;
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /**/ }

          onChunk(chalk.dim(`\n[🔧 ${name}]\n`));

          const result  = await this.executeTool(name, args, tools);
          const preview = (typeof result === 'string' ? result : JSON.stringify(result)).slice(0, 150);
          onChunk(chalk.dim(`   → ${preview}\n`));

          this.conversationHistory.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          });
        }

      } else {
        finalText = message.content || '';

        // Streaming simulation word-by-word
        const words = finalText.split(' ');
        for (let i = 0; i < words.length; i++) {
          onChunk(words[i] + (i < words.length - 1 ? ' ' : ''));
          await sleep(6);
        }

        this.conversationHistory.push({ role: 'assistant', content: finalText });
        await this.memory.addMessage(this.projectPath, { role: 'assistant', content: finalText });

        if (this.conversationHistory.length > 20) await this._summarizeMemory(systemPrompt);
        continueLoop = false;
      }
    }

    return finalText;
  }

  async callAPI({ systemPrompt, messages, tools }) {
    const body = {
      model: this.model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
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

    // OpenRouter needs extra headers
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

  async executeTool(name, args, tools) {
    const def = tools.find((t) => t.function.name === name);
    if (!def?._handler) return `Tool "${name}" tidak ditemukan`;
    try {
      return await def._handler(args);
    } catch (err) {
      return `Error tool ${name}: ${err.message}`;
    }
  }

  async _summarizeMemory(systemPrompt) {
    const toSummarize = this.conversationHistory.slice(0, -10);
    const recent      = this.conversationHistory.slice(-10);
    if (!toSummarize.length) return;

    try {
      const res = await this.callAPI({
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }