/**
 * Project Analyst Agent — Performance-Optimized v2.0
 * 
 * Fitur performa:
 * - Sliding Window Context (hanya kirim N pesan terakhir + compressed prefix)
 * - Context Budget (hard limit 32K token, auto-trim)
 * - Tool Cache (LRU, hasil tool tidak dieksekusi ulang)
 * - Prompt Cache (system prompt dibangun sekali, reuse antar turn)
 * - Smart Memory Retrieval (semantic summary dari conversation lama)
 * - Conversation Compression (compress > 25 pesan secara heuristik)
 * - Auto-truncate tool results (> 2000 karakter)
 * - Token & response time logging
 */

import { chalk } from './colors.js';
import { buildTools } from './tools.js';
import { buildSystemPrompt } from './prompts.js';
import { ContextBudget } from './perf/context-budget.js';
import { ToolCache } from './perf/tool-cache.js';
import { Logger } from './perf/logger.js';
import { Compressor } from './perf/compressor.js';

// ── Provider configs ────────────────────────────────────────────
const PROVIDERS = {
  nvidia: {
    baseURL: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    envKey: 'NVIDIA_API_KEY',
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    envKey: 'DEEPSEEK_API_KEY',
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-chat-v3-0324:free',
    envKey: 'OPENROUTER_API_KEY',
  },
};

export class Agent {
  constructor({ apiKey, memory, scanner, projectPath, skillManager, perfOptions = {} }) {
    // Provider setup
    const providerName = process.env.AI_PROVIDER?.toLowerCase() || 'nvidia';
    const provider = PROVIDERS[providerName] || PROVIDERS.nvidia;

    this.apiKey = apiKey || process.env[provider.envKey];
    this.baseURL = provider.baseURL;
    this.model = process.env.AI_MODEL || provider.defaultModel;
    this.providerName = providerName;

    // Core services
    this.memory = memory;
    this.scanner = scanner;
    this.projectPath = projectPath;
    this.skillManager = skillManager;

    // ── PERFORMANCE MODULES ──────────────────────────────────
    this.contextBudget = new ContextBudget({
      maxTokens: perfOptions.maxTokens || 32000,
      systemReserve: perfOptions.systemReserve || 15000,
      outputReserve: perfOptions.outputReserve || 8000,
      windowSize: perfOptions.windowSize || 15,
    });
    this.toolCache = new ToolCache({
      maxSize: perfOptions.toolCacheSize || 200,
      truncateAt: perfOptions.toolTruncateAt || 2000,
    });
    this.logger = new Logger({
      enabled: perfOptions.logging !== false,
      verbose: perfOptions.verbose !== false,
    });
    this.compressor = new Compressor({
      triggerThreshold: perfOptions.compressThreshold || 25,
      keepRecent: perfOptions.compressKeepRecent || 12,
    });

    // ── STATE ────────────────────────────────────────────────
    this.conversationHistory = [];
    this.compressedSummary = null;     // ringkasan dari conversation yang sudah di-compress
    
    // Prompt cache
    this._promptCache = {
      hash: null,
      prompt: null,
      tools: null,
    };

    // Stats
    this.totalToolCalls = 0;
  }

  // ═══════════════════════════════════════════════════════════════
  //  MAIN CHAT LOOP
  // ═══════════════════════════════════════════════════════════════

  async chat(userMessage, onChunk) {
    // ── 1. Push user message ──────────────────────────────────
    this.conversationHistory.push({ role: 'user', content: userMessage });

    // Async memory save (fire-and-forget, non-blocking)
    this.memory.addMessage(this.projectPath, { role: 'user', content: userMessage })
      .catch(() => {}); // silent fail — memory is non-critical

    // ── 2. Build/retrieve system prompt (CACHED) ──────────────
    const { systemPrompt, tools } = await this._getCachedPrompt();

    // ── 3. Apply compression if needed ────────────────────────
    const { messages: workingMessages, compressedSummary: newSummary } = 
      this._applyCompression();
    if (newSummary) this.compressedSummary = newSummary;

    // ── 4. MAIN LOOP ──────────────────────────────────────────
    let finalText = '';
    let continueLoop = true;
    const loopStart = Date.now();

    while (continueLoop) {
      // 4a. Apply sliding window + budget
      const { messages: windowMessages, trimmed, estimatedTokens } = 
        this.contextBudget.apply(workingMessages, this.compressedSummary);

      if (trimmed && this.logger.verbose) {
        this.logger.logBudget({
          action: 'trim',
          beforeTokens: this.contextBudget.estimateRequestTokens(systemPrompt, workingMessages, tools),
          afterTokens: this.contextBudget.estimateRequestTokens(systemPrompt, windowMessages, tools),
          messagesBefore: workingMessages.length,
          messagesAfter: windowMessages.length,
        });
      }

      // 4a-2. Sanitasi: buang 'tool' message yatim (tool_call_id-nya tidak
      // punya pasangan assistant.tool_calls di window ini). Jaga-jaga
      // kalau sliding window / compression memotong pasangan tool_calls/tool.
      const sanitizedMessages = this._sanitizeToolPairs(windowMessages);

      // 4b. Call LLM
      const callStart = Date.now();
      let response;
      try {
        response = await this._callAPI({ systemPrompt, messages: sanitizedMessages, tools });
      } catch (err) {
        this.logger.logLLMCall({
          model: this.model,
          messagesCount: windowMessages.length,
          estimatedTokensIn: estimatedTokens,
          tokensOut: 0,
          durationMs: Date.now() - callStart,
          provider: this.providerName,
          finishReason: 'error',
        });
        throw err;
      }

      const llmDuration = Date.now() - callStart;
      const message = response.choices?.[0]?.message;
      const usage = response.usage;

      // 4c. Log LLM call
      this.logger.logLLMCall({
        model: this.model,
        messagesCount: windowMessages.length,
        estimatedTokensIn: estimatedTokens,
        tokensOut: usage?.completion_tokens || 0,
        durationMs: llmDuration,
        provider: this.providerName,
        finishReason: response.choices?.[0]?.finish_reason || 'stop',
      });

      // 4d. Handle tool calls
      if (message?.tool_calls && message.tool_calls.length > 0) {
        // Push assistant message with tool calls
        workingMessages.push(message);
        this.conversationHistory.push(message);

        // Execute each tool
        for (const tc of message.tool_calls) {
          const name = tc.function.name;
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}

          // ── TOOL CACHE CHECK ────────────────────────────
          const cached = this.toolCache.get(name, args);
          
          let result;
          let toolDuration = 0;
          let cachedHit = false;

          if (cached.found) {
            result = cached.result; // sudah truncated
            cachedHit = true;
            onChunk?.(chalk.dim(`\n[🔧 ${name} ⚡cache]\n`));
          } else {
            onChunk?.(chalk.dim(`\n[🔧 ${name}]\n`));

            const toolStart = Date.now();
            result = await this._executeTool(name, args, tools);
            toolDuration = Date.now() - toolStart;

            // Cache the FULL result, return TRUNCATED
            result = this.toolCache.set(name, args, result);

            // Invalidate related cache entries for write operations
            if (['write_file', 'edit_file', 'delete_file'].includes(name) && args.file_path) {
              this.toolCache.invalidateFile(args.file_path);
            }
          }

          const preview = (result || '').slice(0, 120);
          onChunk?.(chalk.dim(`   → ${preview}${cachedHit ? '' : ''}\n`));

          // Log tool execution
          this.logger.logToolExecution({
            toolName: name,
            args,
            durationMs: toolDuration,
            resultSize: result?.length || 0,
            cached: cachedHit,
          });

          this.totalToolCalls++;

          // Push tool result to both working and history
          const toolMsg = {
            role: 'tool',
            tool_call_id: tc.id,
            content: result,
          };
          workingMessages.push(toolMsg);
          this.conversationHistory.push(toolMsg);
        }

        // Check if we need compression mid-loop
        if (workingMessages.length > this.compressor.triggerThreshold + 10) {
          const { compressed, summary, didCompress, stats } = this.compressor.compress(workingMessages);
          if (didCompress) {
            workingMessages.length = 0;
            workingMessages.push(...compressed);
            this.compressedSummary = summary;
            this.logger.logCompression(stats);
          }
        }

        // Safety: max tool call iterations
        if (this.totalToolCalls > 150) {
          finalText = '⚠️ Batas maksimum tool calls (150) tercapai. Agent berhenti untuk mencegah infinite loop.';
          continueLoop = false;
        }

      } else {
        // ── NO TOOL CALLS → FINAL RESPONSE ──────────────────
        finalText = message?.content || '';

        // Streaming output
        if (onChunk && finalText) {
          // Faster streaming — chunk by sentence instead of word
          const sentences = finalText.split(/(?<=[.!?])\s+/);
          for (let i = 0; i < sentences.length; i++) {
            onChunk((i > 0 ? ' ' : '') + sentences[i]);
            if (sentences.length > 20) await sleep(2); // skip delay for short responses
          }
        }

        // Push to history
        workingMessages.push({ role: 'assistant', content: finalText });
        this.conversationHistory.push({ role: 'assistant', content: finalText });

        // Async memory save (non-blocking)
        this.memory.addMessage(this.projectPath, { role: 'assistant', content: finalText })
          .catch(() => {});
        
        // Async summary save
        if (this.conversationHistory.length > 20) {
          this._saveSessionSummary(systemPrompt).catch(() => {});
        }

        continueLoop = false;
      }
    }

    // ── 5. Post-chat: compress if conversation is long ────────
    if (this.conversationHistory.length > this.compressor.triggerThreshold) {
      this._deferredCompress();
    }

    return finalText;
  }

  // ═══════════════════════════════════════════════════════════════
  //  PROMPT CACHING
  // ═══════════════════════════════════════════════════════════════

  async _getCachedPrompt() {
    // Build hash dari inputs yang mempengaruhi prompt
    const projectContext = await this.scanner.getContextSummary();
    const memoryContext = await this.memory.getRecentContext(this.projectPath);
    const skillsContext = this.skillManager ? await this.skillManager.loadContext() : '';
    
    // Simple hash based on key fields
    const hashInput = JSON.stringify({
      tree: projectContext.tree?.slice(0, 200),   // hanya awal tree
      techStack: projectContext.techStack,
      pkgInfo: projectContext.pkgInfo,
      summary: memoryContext.summary,
      factsCount: memoryContext.facts?.length,
      skillsLen: skillsContext.length,
    });

    // Return cached if unchanged
    if (this._promptCache.hash === hashInput && this._promptCache.prompt && this._promptCache.tools) {
      return { systemPrompt: this._promptCache.prompt, tools: this._promptCache.tools };
    }

    // Build fresh
    const systemPrompt = buildSystemPrompt(projectContext, memoryContext, skillsContext);
    const tools = buildTools(this.scanner);

    // Cache
    this._promptCache = { hash: hashInput, prompt: systemPrompt, tools };

    return { systemPrompt, tools };
  }

  /**
   * Force rebuild prompt cache (call after project changes)
   */
  invalidatePromptCache() {
    this._promptCache = { hash: null, prompt: null, tools: null };
  }

  // ═══════════════════════════════════════════════════════════════
  //  COMPRESSION
  // ═══════════════════════════════════════════════════════════════

  _applyCompression() {
    if (this.conversationHistory.length <= this.compressor.triggerThreshold) {
      return { messages: [...this.conversationHistory], compressedSummary: null };
    }

    const { compressed, summary, didCompress, stats } = 
      this.compressor.compress(this.conversationHistory);

    if (didCompress) {
      this.logger.logCompression(stats);
      // Update conversation history to compressed version
      this.conversationHistory = compressed;
      return { messages: [...compressed], compressedSummary: summary };
    }

    return { messages: [...this.conversationHistory], compressedSummary: null };
  }

  _deferredCompress() {
    const { compressed, summary, didCompress } = 
      this.compressor.compress(this.conversationHistory);
    if (didCompress) {
      this.conversationHistory = compressed;
      this.compressedSummary = summary;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  ASYNC MEMORY SUMMARIZATION
  // ═══════════════════════════════════════════════════════════════

  async _saveSessionSummary(systemPrompt) {
    try {
      // Use the compressor's semantic summary instead of calling LLM
      const { summary } = this.compressor.compress(this.conversationHistory);
      if (summary) {
        await this.memory.saveSummary(this.projectPath, summary);
      }
    } catch {
      // Silent fail
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  LLM API CALL
  // ═══════════════════════════════════════════════════════════════

  async _callAPI({ systemPrompt, messages, tools }) {
    const body = {
      model: this.model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      max_tokens: 8000,
      temperature: 0.2,
      stream: false,
    };

    if (tools && tools.length > 0) {
      // Kirim tool definitions tanpa _handler (tidak serializable)
      body.tools = tools.map(({ type, function: func }) => ({ type, function: func }));
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout

    try {
      const res = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`${this.providerName.toUpperCase()} API ${res.status}: ${err.slice(0, 300)}`);
      }

      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  SAFETY: pastikan pasangan tool_calls ↔ tool tidak pernah pecah
  //  akibat sliding window / compression yang memotong di tengah blok.
  // ═══════════════════════════════════════════════════════════════

  _sanitizeToolPairs(messages) {
    const result = [];
    let pendingIds = null;

    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        pendingIds = new Set(msg.tool_calls.map((tc) => tc.id));
        result.push(msg);
        continue;
      }

      if (msg.role === 'tool') {
        if (pendingIds && pendingIds.has(msg.tool_call_id)) {
          result.push(msg);
          pendingIds.delete(msg.tool_call_id);
          if (pendingIds.size === 0) pendingIds = null;
        }
        continue;
      }

      pendingIds = null;
      result.push(msg);
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  //  TOOL EXECUTION
  // ═══════════════════════════════════════════════════════════════

  async _executeTool(name, args, tools) {
    const def = tools.find((t) => t.function.name === name);
    if (!def?._handler) return `Tool "${name}" tidak ditemukan`;
    try {
      return await def._handler(args);
    } catch (err) {
      return `Error tool ${name}: ${err.message}`;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get comprehensive performance report
   */
  getPerfReport() {
    return {
      agent: {
        totalToolCalls: this.totalToolCalls,
        conversationSize: this.conversationHistory.length,
        compressedSummarySize: this.compressedSummary?.length || 0,
        promptCached: this._promptCache.hash !== null,
      },
      contextBudget: this.contextBudget.getStats(),
      toolCache: this.toolCache.getStats(),
      compressor: this.compressor.getStats(),
      llm: this.logger.getStats(),
    };
  }

  /**
   * Print performance report
   */
  printPerfReport() {
    this.logger.printStats();
    
    const tc = this.toolCache.getStats();
    const cb = this.contextBudget.getStats();
    
    console.log('┌─────────────────────────────────────────────┐');
    console.log('│           🔧 CACHE & BUDGET STATS            │');
    console.log('├─────────────────────────────────────────────┤');
    console.log(`│  Tool Cache     : ${tc.cacheSize} entries, ${tc.hitRate} hit rate`);
    console.log(`│  Tokens Saved   : ${tc.totalSavedTokens.toLocaleString()} (truncation)`);
    console.log(`│  Budget Trims   : ${cb.totalTrims}x, ${cb.totalMessagesTrimmed} msgs trimmed`);
    console.log(`│  Tokens Saved   : ${cb.totalTokensSaved.toLocaleString()} (budget)`);
    console.log(`│  Compressions   : ${this.compressor.stats.totalCompressions}x`);
    console.log(`│  History Size   : ${this.conversationHistory.length} msgs`);
    console.log('└─────────────────────────────────────────────┘\n');
  }

  /**
   * Print compact one-line stats
   */
  printCompactStats() {
    this.logger.printCompact();
    const tc = this.toolCache.getStats();
    console.log(`🔧 Cache:${tc.cacheSize} hit:${tc.hitRate} | History:${this.conversationHistory.length}msg`);
  }

  /**
   * Reset session (keep memory, clear conversation)
   */
  resetConversation() {
    this.conversationHistory = [];
    this.compressedSummary = null;
    this.totalToolCalls = 0;
    this.toolCache.clear();
    this.invalidatePromptCache();
  }

  /**
   * Switch project (re-scan, clear cache, keep memory)
   */
  async switchProject(newPath) {
    this.projectPath = newPath;
    this.scanner.projectPath = newPath;
    this.scanner._cache.clear();
    this.resetConversation();
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
