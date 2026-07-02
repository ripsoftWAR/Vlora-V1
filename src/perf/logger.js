/**
 * Performance Logger
 * 
 * Fitur:
 * - Token usage logging per LLM call
 * - Response time tracking (ms)
 * - Tool execution time tracking
 * - Aggregate stats untuk benchmark
 * - Formatted output untuk terminal & server
 */

export class Logger {
  constructor(opts = {}) {
    this.enabled = opts.enabled !== false;
    this.verbose = opts.verbose || false;
    
    // Per-request logs
    this.llmCalls = [];
    this.toolExecutions = [];
    
    // Session aggregate
    this.session = {
      startTime: Date.now(),
      totalLLMCalls: 0,
      totalToolCalls: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      totalLLMTimeMs: 0,
      totalToolTimeMs: 0,
    };
  }

  /**
   * Log LLM API call
   */
  logLLMCall({ model, messagesCount, estimatedTokensIn, tokensOut, durationMs, provider, finishReason }) {
    if (!this.enabled) return;
    
    const entry = {
      timestamp: Date.now(),
      model,
      messagesCount,
      estimatedTokensIn,
      tokensOut: tokensOut || 0,
      durationMs,
      provider,
      finishReason,
    };
    
    this.llmCalls.push(entry);
    this.session.totalLLMCalls++;
    this.session.totalTokensIn += estimatedTokensIn;
    this.session.totalTokensOut += (tokensOut || 0);
    this.session.totalLLMTimeMs += durationMs;
    
    if (this.verbose) {
      const providerTag = provider ? `[${provider.toUpperCase()}]` : '';
      console.log(
        `  ⚡ LLM ${providerTag} ${model} | ` +
        `msg:${messagesCount} | ` +
        `tok:${estimatedTokensIn.toLocaleString()}→${(tokensOut || 0).toLocaleString()} | ` +
        `${durationMs}ms [${finishReason || 'stop'}]`
      );
    }
  }

  /**
   * Log tool execution
   */
  logToolExecution({ toolName, args, durationMs, resultSize, cached }) {
    if (!this.enabled) return;
    
    const entry = {
      timestamp: Date.now(),
      toolName,
      argsPreview: JSON.stringify(args).slice(0, 100),
      durationMs,
      resultSize,
      cached: cached || false,
    };
    
    this.toolExecutions.push(entry);
    this.session.totalToolCalls++;
    this.session.totalToolTimeMs += durationMs;
    
    if (this.verbose) {
      const cacheTag = cached ? ' [CACHE]' : '';
      console.log(
        `  🔧 ${toolName}${cacheTag} | ` +
        `${durationMs}ms | ` +
        `${(resultSize || 0).toLocaleString()} chars`
      );
    }
  }

  /**
   * Log context budget action
   */
  logBudget({ action, beforeTokens, afterTokens, messagesBefore, messagesAfter }) {
    if (!this.enabled || !this.verbose) return;
    
    const saved = beforeTokens - afterTokens;
    console.log(
      `  📊 Budget ${action} | ` +
      `tok:${beforeTokens.toLocaleString()}→${afterTokens.toLocaleString()} ` +
      `(saved ${saved.toLocaleString()}) | ` +
      `msg:${messagesBefore}→${messagesAfter}`
    );
  }

  /**
   * Log compression event
   */
  logCompression({ beforeCount, afterCount, compressedCount, durationMs }) {
    if (!this.enabled) return;
    
    if (this.verbose) {
      console.log(
        `  🗜️  Compression | ` +
        `msg:${beforeCount}→${afterCount} ` +
        `(compressed ${compressedCount}) | ` +
        `${durationMs}ms`
      );
    }
  }

  /**
   * Get formatted session stats
   */
  getStats() {
    const elapsed = (Date.now() - this.session.startTime) / 1000;
    const last10LLM = this.llmCalls.slice(-10);
    const avgLLMDuration = last10LLM.length > 0 ?
      last10LLM.reduce((s, c) => s + c.durationMs, 0) / last10LLM.length : 0;
    
    const last10Tools = this.toolExecutions.slice(-10);
    const avgToolDuration = last10Tools.length > 0 ?
      last10Tools.reduce((s, c) => s + c.durationMs, 0) / last10Tools.length : 0;
    
    return {
      session: {
        durationSec: Math.round(elapsed),
        totalLLMCalls: this.session.totalLLMCalls,
        totalToolCalls: this.session.totalToolCalls,
        totalTokensIn: this.session.totalTokensIn,
        totalTokensOut: this.session.totalTokensOut,
        totalLLMTimeMs: this.session.totalLLMTimeMs,
        totalToolTimeMs: this.session.totalToolTimeMs,
      },
      averages: {
        llmDurationMs: Math.round(avgLLMDuration),
        toolDurationMs: Math.round(avgToolDuration),
        tokensPerLLMCall: this.session.totalLLMCalls > 0 ?
          Math.round(this.session.totalTokensIn / this.session.totalLLMCalls) : 0,
      },
      lastLLMCalls: last10LLM,
      lastToolExecutions: last10Tools,
    };
  }

  /**
   * Print formatted stats
   */
  printStats() {
    const stats = this.getStats();
    const s = stats.session;
    const a = stats.averages;
    
    console.log('\n┌─────────────────────────────────────────────┐');
    console.log('│           📊 PERFORMANCE REPORT              │');
    console.log('├─────────────────────────────────────────────┤');
    console.log(`│  Session        : ${s.durationSec}s total`);
    console.log(`│  LLM Calls      : ${s.totalLLMCalls} (avg ${a.llmDurationMs}ms/call)`);
    console.log(`│  Tool Execs     : ${s.totalToolCalls} (avg ${a.toolDurationMs}ms/exec)`);
    console.log(`│  Tokens IN      : ${s.totalTokensIn.toLocaleString()}`);
    console.log(`│  Tokens OUT     : ${s.totalTokensOut.toLocaleString()}`);
    console.log(`│  Tokens/Call    : ${a.tokensPerLLMCall.toLocaleString()} avg`);
    console.log(`│  LLM Time       : ${(s.totalLLMTimeMs/1000).toFixed(1)}s`);
    console.log(`│  Tool Time      : ${(s.totalToolTimeMs/1000).toFixed(1)}s`);
    console.log('└─────────────────────────────────────────────┘\n');
  }

  /**
   * Print compact one-line stats
   */
  printCompact() {
    const stats = this.getStats();
    const s = stats.session;
    const a = stats.averages;
    
    console.log(
      `📊 LLM:${s.totalLLMCalls}x avg:${a.llmDurationMs}ms | ` +
      `Tools:${s.totalToolCalls}x avg:${a.toolDurationMs}ms | ` +
      `Tok:${s.totalTokensIn.toLocaleString()}→${s.totalTokensOut.toLocaleString()} | ` +
      `${s.durationSec}s`
    );
  }
}
