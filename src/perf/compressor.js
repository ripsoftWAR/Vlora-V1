/**
 * Conversation Compressor
 * 
 * Fitur:
 * - Semantic summarization — ekstrak fakta, keputusan, pattern dari percakapan
 * - Tidak perlu LLM call — pure heuristic (cepat & gratis)
 * - Menghasilkan structured summary + compressed message list
 * - Trigger: saat conversation > threshold (default 25 messages)
 */

export class Compressor {
  constructor(opts = {}) {
    this.triggerThreshold = opts.triggerThreshold || 25;  // messages
    this.keepRecent = opts.keepRecent || 12;               // keep last N in full
    this.maxSummaryTokens = opts.maxSummaryTokens || 2000; // max chars for summary
    
    this.stats = {
      totalCompressions: 0,
      totalMessagesCompressed: 0,
    };
  }

  /**
   * Main compress method
   * @param {Array} conversationHistory - full conversation
   * @returns {{ compressed: Array, summary: string, didCompress: boolean }}
   */
  compress(conversationHistory) {
    if (conversationHistory.length <= this.triggerThreshold) {
      return { 
        compressed: conversationHistory, 
        summary: null, 
        didCompress: false 
      };
    }

    const startTime = Date.now();
    
    // Split: old messages to compress, recent to keep
    const oldMessages = conversationHistory.slice(0, -this.keepRecent);
    const recentMessages = conversationHistory.slice(-this.keepRecent);
    
    // Build structured summary
    const summary = this._buildSummary(oldMessages);
    
    // Build compressed message list:
    // [summary as system message] + [recent messages]
    const compressed = [
      { role: 'system', content: `[RINGKASAN KOMPRESI — ${oldMessages.length} pesan sebelumnya]\n\n${summary}` },
      ...recentMessages,
    ];
    
    const durationMs = Date.now() - startTime;
    
    this.stats.totalCompressions++;
    this.stats.totalMessagesCompressed += oldMessages.length;
    
    return {
      compressed,
      summary,
      didCompress: true,
      stats: {
        beforeCount: conversationHistory.length,
        afterCount: compressed.length,
        compressedCount: oldMessages.length,
        durationMs,
      }
    };
  }

  /**
   * Build a structured semantic summary from old messages
   */
  _buildSummary(messages) {
    const sections = [];
    
    // 1. Extract user intents/questions
    const userIntents = [];
    for (const msg of messages) {
      if (msg.role === 'user' && typeof msg.content === 'string') {
        const cleaned = msg.content.replace(/\n/g, ' ').slice(0, 150).trim();
        if (cleaned) userIntents.push(cleaned);
      }
    }
    
    if (userIntents.length > 0) {
      // Deduplicate and limit
      const unique = [...new Set(userIntents)].slice(0, 8);
      sections.push(`## 🔍 Pertanyaan/Topik\n${unique.map(u => `- ${u}`).join('\n')}`);
    }
    
    // 2. Extract tool executions (aggregate)
    const toolStats = {};
    const fileReads = [];
    const fileWrites = [];
    
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          const name = tc.function.name;
          toolStats[name] = (toolStats[name] || 0) + 1;
          
          // Track file operations
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
          if (name === 'read_file' && args.file_path) fileReads.push(args.file_path);
          if (['write_file', 'edit_file', 'delete_file'].includes(name) && args.file_path) {
            fileWrites.push(`${name.replace('_', ' ')} ${args.file_path}`);
          }
        }
      }
    }
    
    if (Object.keys(toolStats).length > 0) {
      const toolList = Object.entries(toolStats)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `- ${name}: ${count}x`)
        .join('\n');
      sections.push(`## 🔧 Tools Digunakan\n${toolList}`);
    }
    
    // 3. Extract key decisions & facts
    const facts = [];
    for (const msg of messages) {
      if (msg.role === 'assistant' && typeof msg.content === 'string') {
        // Look for decision patterns
        const patterns = [
          /(?:rekomendasi|kesimpulan|keputusan)[^.?!]+/gi,
          /(?:sebaiknya|gunakan|pakai|implementasi)[^.?!]+/gi,
          /(?:pattern|arsitektur|stack)[^.?!]+/gi,
        ];
        for (const pattern of patterns) {
          const matches = msg.content.match(pattern);
          if (matches) {
            for (const m of matches.slice(0, 2)) {
              const cleaned = m.trim().slice(0, 200);
              if (!facts.includes(cleaned)) facts.push(cleaned);
            }
          }
        }
      }
    }
    
    if (facts.length > 0) {
      sections.push(`## 💡 Keputusan & Rekomendasi\n${facts.slice(0, 5).map(f => `- ${f}`).join('\n')}`);
    }
    
    // 4. File changes summary  
    if (fileWrites.length > 0 || fileReads.length > 0) {
      const uniqueReads = [...new Set(fileReads)].slice(0, 10);
      const uniqueWrites = [...new Set(fileWrites)].slice(0, 10);
      
      let fileSummary = '';
      if (uniqueReads.length > 0) fileSummary += `File dibaca: ${uniqueReads.join(', ')}\n`;
      if (uniqueWrites.length > 0) fileSummary += `File ditulis: ${uniqueWrites.join(', ')}`;
      sections.push(`## 📁 Operasi File\n${fileSummary}`);
    }
    
    // Combine — respect max length
    let summary = sections.join('\n\n');
    if (summary.length > this.maxSummaryTokens) {
      summary = summary.slice(0, this.maxSummaryTokens) + '\n...[truncated]';
    }
    
    return summary || `Percakapan ${messages.length} pesan (tidak ada konten yang bisa dirangkum)`;
  }

  getStats() {
    return { ...this.stats };
  }
}
