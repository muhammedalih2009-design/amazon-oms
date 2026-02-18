import { base44 } from '@/api/base44Client';

// Global API client with rate limit protection
class APIClient {
  constructor() {
    this.cache = new Map();
    this.inFlightRequests = new Map();
    this.requestQueue = [];
    this.activeRequests = 0;
    this.maxConcurrent = 4;
    this.defaultCacheTTL = 60000; // 60 seconds
    this.rateLimitLog = [];
  }

  // Generate cache key from request params
  getCacheKey(method, params) {
    return `${method}:${JSON.stringify(params)}`;
  }

  // Check if cached response is still valid
  getCachedResponse(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp < cached.ttl) {
      console.log('[API Cache] HIT:', key.substring(0, 80));
      return cached.data;
    }
    
    this.cache.delete(key);
    return null;
  }

  // Store response in cache
  setCachedResponse(key, data, ttl = this.defaultCacheTTL) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
    
    // Limit cache size
    if (this.cache.size > 200) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  // Exponential backoff retry for rate limits
  async retryWithBackoff(fn, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        const isRateLimit = error.message?.toLowerCase().includes('rate limit') ||
                           error.message?.toLowerCase().includes('too many requests') ||
                           error.status === 429;
        
        if (!isRateLimit || i === maxRetries - 1) {
          throw error;
        }
        
        const delay = Math.min(1000 * Math.pow(2, i), 16000);
        console.warn(`[API Retry] Rate limit hit, retry ${i + 1}/${maxRetries} after ${delay}ms`);
        
        this.rateLimitLog.push({
          timestamp: Date.now(),
          retry: i + 1,
          delay
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // Process queue with concurrency limit
  async processQueue() {
    while (this.requestQueue.length > 0 && this.activeRequests < this.maxConcurrent) {
      const { fn, resolve, reject } = this.requestQueue.shift();
      this.activeRequests++;
      
      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        this.activeRequests--;
        this.processQueue();
      }
    }
  }

  // Enqueue request with concurrency control
  async enqueueRequest(fn) {
    if (this.activeRequests < this.maxConcurrent) {
      this.activeRequests++;
      try {
        return await fn();
      } finally {
        this.activeRequests--;
        this.processQueue();
      }
    }
    
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ fn, resolve, reject });
    });
  }

  // Main method: list entities with caching + dedup + retry
  async list(entityName, filters = {}, sort = null, limit = 50, options = {}) {
    const { useCache = true, cacheTTL = this.defaultCacheTTL } = options;
    const cacheKey = this.getCacheKey(`${entityName}.list`, { filters, sort, limit });
    
    // Check cache first
    if (useCache) {
      const cached = this.getCachedResponse(cacheKey);
      if (cached) return cached;
    }
    
    // Check for in-flight duplicate request
    if (this.inFlightRequests.has(cacheKey)) {
      console.log('[API Dedup] Waiting for in-flight request:', cacheKey.substring(0, 80));
      return await this.inFlightRequests.get(cacheKey);
    }
    
    // Create new request
    const requestPromise = this.enqueueRequest(async () => {
      return await this.retryWithBackoff(async () => {
        const data = await base44.entities[entityName].filter(filters, sort, limit);
        
        if (useCache) {
          this.setCachedResponse(cacheKey, data, cacheTTL);
        }
        
        return data;
      });
    });
    
    this.inFlightRequests.set(cacheKey, requestPromise);
    
    try {
      const result = await requestPromise;
      return result;
    } finally {
      this.inFlightRequests.delete(cacheKey);
    }
  }

  // Create entity (no caching)
  async create(entityName, data) {
    return await this.enqueueRequest(async () => {
      return await this.retryWithBackoff(async () => {
        return await base44.entities[entityName].create(data);
      });
    });
  }

  // Update entity (invalidate cache)
  async update(entityName, id, data) {
    const result = await this.enqueueRequest(async () => {
      return await this.retryWithBackoff(async () => {
        return await base44.entities[entityName].update(id, data);
      });
    });
    
    // Invalidate all caches for this entity
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${entityName}.list:`)) {
        this.cache.delete(key);
      }
    }
    
    return result;
  }

  // Delete entity (invalidate cache)
  async delete(entityName, id) {
    const result = await this.enqueueRequest(async () => {
      return await this.retryWithBackoff(async () => {
        return await base44.entities[entityName].delete(id);
      });
    });
    
    // Invalidate all caches for this entity
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${entityName}.list:`)) {
        this.cache.delete(key);
      }
    }
    
    return result;
  }

  // Bulk create (no caching)
  async bulkCreate(entityName, dataArray) {
    return await this.enqueueRequest(async () => {
      return await this.retryWithBackoff(async () => {
        return await base44.entities[entityName].bulkCreate(dataArray);
      });
    });
  }

  // Invoke function with retry
  async invokeFunction(functionName, params) {
    return await this.enqueueRequest(async () => {
      return await this.retryWithBackoff(async () => {
        const { data } = await base44.functions.invoke(functionName, params);
        return data;
      });
    });
  }

  // Clear all cache
  clearCache() {
    this.cache.clear();
    console.log('[API Cache] Cleared');
  }

  // Clear cache for specific entity
  clearEntityCache(entityName) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${entityName}.list:`)) {
        this.cache.delete(key);
      }
    }
    console.log(`[API Cache] Cleared for ${entityName}`);
  }

  // Get stats for monitoring
  getStats() {
    return {
      cacheSize: this.cache.size,
      activeRequests: this.activeRequests,
      queuedRequests: this.requestQueue.length,
      rateLimitEvents: this.rateLimitLog.filter(e => Date.now() - e.timestamp < 60000).length
    };
  }

  // Get recent rate limit events
  getRecentRateLimits() {
    const oneMinuteAgo = Date.now() - 60000;
    return this.rateLimitLog.filter(e => e.timestamp > oneMinuteAgo);
  }
}

export const apiClient = new APIClient();

// Debounced function creator
export function debounce(fn, delay = 500) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    return new Promise((resolve) => {
      timeoutId = setTimeout(async () => {
        resolve(await fn(...args));
      }, delay);
    });
  };
}