/**
 * Tool Result Cache
 * 
 * Fitur:
 * - LRU cache hasil tool execution
 * - Key: `${toolName}:${sortedJSON(args)}`
 * - Full result disimpan di cache, ke LLM dikirim versi truncated
 * - Auto-truncate hasil > 2000 karakter
 * - Cache invalidation untuk write operations
 */

import crypto from 'crypto';

const DEFAULT_MAX_CACHE = 200;
const DEFAULT_TRUNCATE_AT = 2000;

export class ToolCache {
  constructor(opts = {}) {
    this.maxSize = opts.maxSize || DEFAULT_MAX_CACHE;
    this.truncateAt = opts.truncateAt || DEFAULT_TRUNCATE_AT;
    this.cache = new Map();        // key → { result, timestamp, accessCount }
    this.accessOrder = [];          // LRU tracking
    
    this.stats = {
      hits: 0,
      misses: 0,
      totalSavedTokens: 0,
      writes: 0,
    };
  }

  /**
   * Generate cache key from tool name + args
   */
  _key(toolName, args) {
    // Sort keys for deterministic hashing
    const sorted = typeof args === 'object' ? 
      JSON.stringify(args, Object.keys(args || {}).sort()) : 
      JSON.stringify(args);
    const hash = crypto.createHash('md5').update(`${toolName}:${sorted}`).digest('hex').slice(0, 12);
    return `${toolName}:${hash}`;
  }

  /**
   * Check cache — returns { found, result } where result is truncated
   */
  get(toolName, args) {
    const key = this._key(toolName, args);
    const entry = this.cache.get(key);
    
    if (entry) {
      this.stats.hits++;
      entry.accessCount++;
      
      // Move to end of LRU
      this.accessOrder = this.accessOrder.filter(k => k !== key);
      this.accessOrder.push(key);
      
      return {
        found: true,
        result: this._truncate(entry.result),
        fullResult: entry.result,
      };
    }
    
    this.stats.misses++;
    return { found: false, result: null, fullResult: null };
  }

  /**
   * Store result in cache
   */
  set(toolName, args, result) {
    const key = this._key(toolName, args);
    
    // Evict oldest if at capacity
    while (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift();
      this.cache.delete(oldest);
    }
    
    this.cache.set(key, {
      result: String(result),
      timestamp: Date.now(),
      accessCount: 0,
    });
    this.accessOrder.push(key);
    
    // Return truncated version for LLM
    return this._truncate(String(result));
  }

  /**
   * Invalidate cache entries related to a file path (for write operations)
   */
  invalidateFile(filePath) {
    let count = 0;
    for (const [key, entry] of this.cache) {
      if (entry.result.includes(filePath)) {
        this.cache.delete(key);
        this.accessOrder = this.accessOrder.filter(k => k !== key);
        count++;
      }
    }
    this.stats.writes += count;
    return count;
  }

  /**
   * Invalidate specific tool + args
   */
  invalidate(toolName, args) {
    const key = this._key(toolName, args);
    this.cache.delete(key);
    this.accessOrder = this.accessOrder.filter(k => k !== key);
  }

  /**
   * Truncate result + add note
   */
  _truncate(result) {
    const str = String(result);
    if (str.length <= this.truncateAt) return str;
    
    const preview = str.slice(0, this.truncateAt);
    const remaining = str.length - this.truncateAt;
    this.stats.totalSavedTokens += Math.ceil((remaining) / 4); // rough token estimate
    
    return `${preview}\n\n...[TRUNCATED: ${remaining.toLocaleString()} more chars. Use read_file with specific params to re-read if needed.]`;
  }

  /**
   * Get full (untruncated) result from cache
   */
  getFull(toolName, args) {
    const key = this._key(toolName, args);
    const entry = this.cache.get(key);
    return entry ? entry.result : null;
  }

  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0 ?
      ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(1) :
      '0.0';
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      hitRate: `${hitRate}%`,
    };
  }

  clear() {
    this.cache.clear();
    this.accessOrder = [];
    this.stats = { hits: 0, misses: 0, totalSavedTokens: 0, writes: 0 };
  }
}
