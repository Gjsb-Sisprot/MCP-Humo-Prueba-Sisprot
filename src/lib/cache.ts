
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
}

export interface CacheOptions {
  
  ttl?: number;
  
  maxEntries?: number;
  
  name?: string;
}

export class TTLCache<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>();
  private stats: CacheStats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  private readonly ttl: number;
  private readonly maxEntries: number;
  private readonly name: string;

  constructor(options: CacheOptions = {}) {
    this.ttl = options.ttl ?? 5 * 60 * 1000; 
    this.maxEntries = options.maxEntries ?? 500;
    this.name = options.name ?? 'cache';
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return undefined;
    }

    this.stats.hits++;
    return entry.value;
  }

  set(key: string, value: T, customTtl?: number): void {
    
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      this.evictExpired();
      
      if (this.cache.size >= this.maxEntries) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) {
          this.cache.delete(firstKey);
          this.stats.evictions++;
        }
      }
    }

    const ttl = customTtl ?? this.ttl;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now(),
    });
    this.stats.sets++;
  }

  async getOrSet<R extends T>(key: string, fn: () => Promise<R>, customTtl?: number): Promise<R> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached as R;
    }

    const value = await fn();
    this.set(key, value, customTtl);
    return value;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  invalidateByPrefix(prefix: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  evictExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        count++;
        this.stats.evictions++;
      }
    }
    return count;
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): CacheStats & { size: number; name: string; hitRate: string } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) + '%' : '0%';
    return {
      ...this.stats,
      size: this.cache.size,
      name: this.name,
      hitRate,
    };
  }
}

export const embeddingCache = new TTLCache<number[]>({
  ttl: 60 * 60 * 1000, 
  maxEntries: 200,
  name: 'embeddings',
});

export const smartoltCache = new TTLCache({
  ttl: 10 * 60 * 1000, 
  maxEntries: 50,
  name: 'smartolt',
});

export const sisprotCache = new TTLCache({
  ttl: 15 * 60 * 1000, 
  maxEntries: 100,
  name: 'sisprot',
});

export const knowledgeCache = new TTLCache({
  ttl: 5 * 60 * 1000, 
  maxEntries: 10,
  name: 'knowledge',
});

export function getAllCacheStats() {
  return {
    embeddings: embeddingCache.getStats(),
    smartolt: smartoltCache.getStats(),
    sisprot: sisprotCache.getStats(),
    knowledge: knowledgeCache.getStats(),
  };
}

export function clearAllCaches() {
  embeddingCache.clear();
  smartoltCache.clear();
  sisprotCache.clear();
  knowledgeCache.clear();
}
