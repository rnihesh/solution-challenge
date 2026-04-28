import { createClient } from "redis";

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

type RedisClient = ReturnType<typeof createClient>;

const memoryCache = new Map<string, CacheEntry<unknown>>();
const pendingLoads = new Map<string, Promise<unknown>>();

let redisClient: RedisClient | null = null;
let redisClientPromise: Promise<RedisClient | null> | null = null;
let redisRetryAfter = 0;
let loggedMissingRedis = false;

const redisRetryDelayMs = 30000;
const maxMemoryCacheEntries = getPositiveNumber(
  process.env.MAX_MEMORY_CACHE_ENTRIES,
  500,
);

function getPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getRedisUrl(): string | null {
  return (
    process.env.REDIS_URL ||
    process.env.REDISCLOUD_URL ||
    process.env.REDIS_TLS_URL ||
    null
  );
}

async function getRedisClient(): Promise<RedisClient | null> {
  const redisUrl = getRedisUrl();

  if (!redisUrl) {
    if (!loggedMissingRedis) {
      console.log("Redis cache disabled: REDIS_URL is not configured");
      loggedMissingRedis = true;
    }
    return null;
  }

  if (redisClient?.isOpen) {
    return redisClient;
  }

  if (Date.now() < redisRetryAfter) {
    return null;
  }

  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      try {
        const client = createClient({
          url: redisUrl,
          socket: {
            reconnectStrategy: false,
          },
        });

        client.on("error", (error) => {
          console.warn("Redis cache error:", error.message);
        });

        await client.connect();
        redisClient = client;
        console.log("Redis cache connected");
        return client;
      } catch (error) {
        redisRetryAfter = Date.now() + redisRetryDelayMs;
        console.warn(
          "Redis cache unavailable, falling back to in-memory cache:",
          error instanceof Error ? error.message : String(error),
        );
        return null;
      } finally {
        redisClientPromise = null;
      }
    })();
  }

  return redisClientPromise;
}

function getMemoryCache<T>(key: string): T | undefined {
  const entry = memoryCache.get(key) as CacheEntry<T> | undefined;

  if (!entry) {
    return undefined;
  }

  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return undefined;
  }

  return entry.data;
}

function setMemoryCache<T>(key: string, data: T, ttlSeconds: number) {
  pruneMemoryCache();

  memoryCache.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  while (memoryCache.size > maxMemoryCacheEntries) {
    const oldestKey = memoryCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    memoryCache.delete(oldestKey);
  }
}

function pruneMemoryCache() {
  const now = Date.now();

  for (const [key, entry] of memoryCache.entries()) {
    if (now > entry.expiresAt) {
      memoryCache.delete(key);
    }
  }
}

export function getCacheTtlSeconds(
  envName: string,
  fallbackSeconds: number,
): number {
  const value = Number(process.env[envName] || process.env.CACHE_TTL_SECONDS);
  return Number.isFinite(value) && value > 0 ? value : fallbackSeconds;
}

export function buildCacheKey(
  parts: Array<string | number | boolean | null | undefined>,
) {
  return parts
    .map((part) => encodeURIComponent(String(part ?? "all")))
    .join(":");
}

export function normalizeBoundsForCache(
  bounds: { north: number; south: number; east: number; west: number },
  precision = Number(process.env.MAP_CACHE_BOUNDS_PRECISION || 2),
) {
  const safePrecision =
    Number.isFinite(precision) && precision >= 0 ? precision : 2;
  const factor = 10 ** safePrecision;

  return {
    north: Math.ceil(bounds.north * factor) / factor,
    south: Math.floor(bounds.south * factor) / factor,
    east: Math.ceil(bounds.east * factor) / factor,
    west: Math.floor(bounds.west * factor) / factor,
  };
}

export async function getCachedJson<T>(key: string): Promise<T | undefined> {
  const memoryValue = getMemoryCache<T>(key);
  if (memoryValue !== undefined) {
    return memoryValue;
  }

  const client = await getRedisClient();
  if (!client) {
    return undefined;
  }

  try {
    const value = await client.get(key);
    if (!value) {
      return undefined;
    }

    const parsed = JSON.parse(value) as T;
    setMemoryCache(key, parsed, getCacheTtlSeconds("CACHE_TTL_SECONDS", 60));
    return parsed;
  } catch (error) {
    console.warn(
      "Redis cache read failed, continuing without cached value:",
      error instanceof Error ? error.message : String(error),
    );
    return undefined;
  }
}

export async function setCachedJson<T>(
  key: string,
  data: T,
  ttlSeconds: number,
) {
  setMemoryCache(key, data, ttlSeconds);

  const client = await getRedisClient();
  if (!client) {
    return;
  }

  try {
    await client.set(key, JSON.stringify(data), {
      EX: ttlSeconds,
    });
  } catch (error) {
    console.warn(
      "Redis cache write failed, continuing with in-memory cache:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function getOrSetCachedJson<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const cached = await getCachedJson<T>(key);
  if (cached !== undefined) {
    return cached;
  }

  const pendingLoad = pendingLoads.get(key) as Promise<T> | undefined;
  if (pendingLoad) {
    return pendingLoad;
  }

  const loadPromise = (async () => {
    try {
      const data = await load();
      // Only set cache if load succeeds
      await setCachedJson(key, data, ttlSeconds);
      return data;
    } catch (err) {
      console.warn(
        "Error loading data to cache, fallback strategy applied",
        err,
      );
      // Attempt to return existing stale cache if any exists before failing
      const staleCached = await getCachedJson<T>(key);
      if (staleCached !== undefined) {
        return staleCached;
      }
      throw err;
    }
  })().finally(() => {
    pendingLoads.delete(key);
  });

  pendingLoads.set(key, loadPromise);
  return loadPromise;
}
