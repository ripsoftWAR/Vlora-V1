/**
 * Context Budget Manager
 * 
 * Fitur:
 * - Estimasi token count (1 token ≈ 4 karakter untuk teks, 3 untuk kode)
 * - Hard limit total context (default 32K tokens)
 * - Sliding window dengan prioritas: system prompt → newest messages → oldest messages
 * - Auto-trimming saat budget melebihi limit
 */

// Rough token estimation — conservative (overestimate rather than underestimate)
function estimateTokens(text) {
  if (!text) return 0;
  // Code-heavy content tends to have ~3 chars/token
  // Mixed content ~3.5 chars/token  
  // Pure natural language ~4 chars/token
  // Using 3.5 as balanced default, but detect code blocks
  const codeBlockChars = (text.match(/```[\s\S]*?```/g) || []).reduce((sum, b) => sum + b.length, 0);
  const nonCodeChars = text.length - codeBlockChars;
  
  // Code: 3 chars/token, non-code: 4 chars/token
  return Math.ceil(codeBlockChars / 3 + nonCodeChars / 4);
}

function estimateMessagesTokens(messages) {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.text) total += estimateTokens(part.text);
      }
    }
    // Tool calls overhead
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += estimateTokens(JSON.stringify(tc.function));
      }
    }
    // Role overhead (~4 tokens per message)
    total += 4;
  }
  return total;
}

export class ContextBudget {
  /**
   * @param {Object} opts
   * @param {number} opts.maxTokens - Hard limit (default 32000)
   * @param {number} opts.systemReserve - Tokens reserved for system prompt (default 15000)
   * @param {number} opts.outputReserve - Tokens reserved for LLM output (default 8000)
   * @param {number} opts.windowSize - Recent messages to keep in full (default 15)
   */
  constructor(opts = {}) {
    this.maxTokens = opts.maxTokens || 32000;
    this.systemReserve = opts.systemReserve || 15000;
    this.outputReserve = opts.outputReserve || 8000;
    this.windowSize = opts.windowSize || 15;
    
    // Stats
    this.stats = {
      totalTrims: 0,
      totalMessagesTrimmed: 0,
      totalTokensSaved: 0,
    };
  }

  /**
   * Available budget for conversation messages
   */
  get availableBudget() {
    return this.maxTokens - this.systemReserve - this.outputReserve;
  }

  /**
   * Apply sliding window + budget to messages
   * 
   * Strategy:
   * 1. Keep last `windowSize` messages in full
   * 2. Older messages get compressed into a prefix summary
   * 3. If still over budget, trim oldest messages from the window
   * 
   * @param {Array} messages - Full conversation messages
   * @param {string|null} compressedPrefix - Pre-computed compression of old messages
   * @returns {{ messages: Array, trimmed: boolean, estimatedTokens: number }}
   */
  apply(messages, compressedPrefix = null) {
    const originalCount = messages.length;
    
    if (messages.length === 0) {
      return { messages: [], trimmed: false, estimatedTokens: 0 };
    }

    let result = [];
    
    // Step 1: Split into old (to compress) and recent (to keep)
    if (messages.length > this.windowSize) {
      const recent = messages.slice(-this.windowSize);
      
      // Build compressed prefix if not provided
      if (!compressedPrefix) {
        compressedPrefix = this._buildCompressedPrefix(messages.slice(0, -this.windowSize));
      }
      
      if (compressedPrefix) {
        result.push({ role: 'system', content: compressedPrefix });
      }
      result.push(...recent);
    } else {
      result = [...messages];
    }

    // Step 2: Check budget
    let estimatedTokens = estimateMessagesTokens(result);
    
    // Step 3: If over budget, progressively trim from the oldest end
    // Keep at minimum: system prefix + last 3 messages
    const minKeep = compressedPrefix ? 4 : 3;
    
    while (estimatedTokens > this.availableBudget && result.length > minKeep) {
      // Find the first non-system message to remove
      let removeIdx = compressedPrefix ? 1 : 0; // skip system prefix
      if (removeIdx < result.length) {
        const removed = result.splice(removeIdx, 1)[0];
        estimatedTokens = estimateMessagesTokens(result);
        this.stats.totalMessagesTrimmed++;
        this.stats.totalTokensSaved += estimateTokens(
          typeof removed.content === 'string' ? removed.content : JSON.stringify(removed)
        );
      } else {
        break;
      }
    }

    const trimmed = result.length < originalCount;
    if (trimmed) {
      this.stats.totalTrims++;
    }

    return { messages: result, trimmed, estimatedTokens };
  }

  /**
   * Build a compressed prefix from old messages
   * Simple heuristic — no extra LLM call
   */
  _buildCompressedPrefix(oldMessages) {
    if (oldMessages.length === 0) return null;
    
    // Extract key information
    const userMessages = oldMessages.filter(m => m.role === 'user');
    const toolCalls = oldMessages.filter(m => m.role === 'assistant' && m.tool_calls);
    const fileOperations = [];
    
    // Extract file operations from tool results
    for (const msg of oldMessages) {
      if (msg.role === 'tool' && msg.content) {
        const toolName = msg.tool_call_id ? 
          oldMessages.find(m => m.tool_calls?.some(tc => tc.id === msg.tool_call_id))
            ?.tool_calls?.find(tc => tc.id === msg.tool_call_id)?.function?.name
          : 'unknown';
        
        if (['read_file', 'write_file', 'edit_file', 'delete_file'].includes(toolName)) {
          const firstLine = msg.content.split('\n')[0].slice(0, 120);
          fileOperations.push(`${toolName}: ${firstLine}`);
        }
      }
    }

    const parts = [];
    parts.push(`[RINGKASAN ${oldMessages.length} PESAN SEBELUMNYA]`);
    
    if (userMessages.length > 0) {
      const topics = userMessages
        .map(m => (typeof m.content === 'string' ? m.content : '').slice(0, 100))
        .filter(Boolean);
      parts.push(`Topik: ${topics.join(' | ')}`);
    }
    
    if (toolCalls.length > 0) {
      const toolNames = new Set();
      for (const msg of toolCalls) {
        for (const tc of (msg.tool_calls || [])) {
          toolNames.add(tc.function.name);
        }
      }
      parts.push(`Tool calls: ${toolCalls.length}x (${[...toolNames].join(', ')})`);
    }
    
    if (fileOperations.length > 0) {
      const unique = [...new Set(fileOperations)].slice(0, 5);
      parts.push(`File ops: ${unique.join('; ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Estimate total tokens for a full request (system + messages + tools)
   */
  estimateRequestTokens(systemPrompt, messages, toolsDefs) {
    let total = estimateTokens(systemPrompt);
    total += estimateMessagesTokens(messages);
    if (toolsDefs) {
      total += estimateTokens(JSON.stringify(toolsDefs.map(t => ({
        type: t.type,
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        }
      }))));
    }
    return total;
  }

  getStats() {
    return { ...this.stats };
  }
}

export { estimateTokens, estimateMessagesTokens };
