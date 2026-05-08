// ===== Data Fetcher: DexScreener + Solana RPC =====

import type {
  DexScreenerPair,
  TokenData,
  AuthorityCheckResult,
  HolderCheckResult,
  ChainId,
} from './types.js';
import { rpcFetchWithMeta } from './rpc-client.js';

function getDexBase(): string {
  return process.env.DEXSCREENER_API_BASE?.trim() || 'https://api.dexscreener.com';
}

const DEXSCREENER_BASE = getDexBase();

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

let nextAvailableAt = 0;
let requestQueue = Promise.resolve();
const MIN_REQUEST_INTERVAL = 350; // ms between requests
const AUTHORITY_CACHE_TTL = 30 * 60 * 1000;
const HOLDER_CACHE_TTL = 10 * 60 * 1000;
const RPC_FAILURE_CACHE_TTL = 2 * 60 * 1000;
const PRICE_CACHE_TTL = 10 * 1000;
const DEFAULT_DISCOVERY_CHAINS: ChainId[] = ['solana'];

const authorityCache = new Map<string, CacheEntry<AuthorityCheckResult>>();
const holderCache = new Map<string, CacheEntry<HolderCheckResult>>();
const priceCache = new Map<string, CacheEntry<DexScreenerPair>>();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return cached.value;
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): T {
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function rateLimitedFetch(url: string, options?: RequestInit): Promise<Response> {
  const slot = requestQueue.then(async () => {
    const wait = Math.max(0, nextAvailableAt - Date.now());
    if (wait > 0) {
      await delay(wait);
    }
    nextAvailableAt = Date.now() + MIN_REQUEST_INTERVAL;
  });
  requestQueue = slot.catch(() => undefined);
  await slot;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function rpcFetchWithRetry<T = any>(
  body: object,
  retries = 2,
): Promise<{ ok: boolean; status: number | null; data: T | null }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await rpcFetchWithMeta<T>(body);
    if (result.ok) {
      return result;
    }

    const isRetryable = result.status === 429 || result.status === 503 || result.status === null;
    if (!isRetryable || attempt === retries) {
      return result;
    }

    const backoffMs = 600 * (attempt + 1);
    await delay(backoffMs);
  }

  return { ok: false, status: null, data: null };
}

function buildRpcFailureReason(prefix: string, status: number | null): string {
  if (status === null) {
    return `${prefix} request failed`;
  }
  return `${prefix} returned ${status}`;
}

function isSupportedChain(chainId: string, chains: ChainId[]): boolean {
  return chains.includes(chainId as ChainId);
}

// ===== DexScreener: Get trending/boosted tokens =====
export async function fetchTrendingTokens(chains: ChainId[] = DEFAULT_DISCOVERY_CHAINS): Promise<DexScreenerPair[]> {
  try {
    // Get latest boosted tokens
    const boostRes = await rateLimitedFetch(`${DEXSCREENER_BASE}/token-boosts/latest/v1`);
    if (!boostRes.ok) throw new Error(`Boost API error: ${boostRes.status}`);
    const boostData = await boostRes.json() as any[];

    const tokensByChain = new Map<ChainId, string[]>();
    for (const item of boostData) {
      if (!isSupportedChain(item.chainId, chains)) continue;
      const chainId = item.chainId as ChainId;
      const list = tokensByChain.get(chainId) ?? [];
      list.push(item.tokenAddress);
      tokensByChain.set(chainId, list);
    }

    const tokenRefs = [...tokensByChain.entries()]
      .flatMap(([chainId, addresses]) => addresses.slice(0, 20).map(address => ({ chainId, address })))
      .slice(0, 30);

    if (tokenRefs.length === 0) {
      console.log('[Fetcher] No supported tokens in boost list, trying profiles...');
      return fetchLatestProfiles(chains);
    }

    // Get detailed pair data for these tokens
    return fetchTokenDetails(tokenRefs.map(ref => ref.address), chains);
  } catch (error) {
    console.error('[Fetcher] Error fetching trending tokens:', error);
    return [];
  }
}

// ===== DexScreener: Get latest token profiles =====
export async function fetchLatestProfiles(chains: ChainId[] = DEFAULT_DISCOVERY_CHAINS): Promise<DexScreenerPair[]> {
  try {
    const res = await rateLimitedFetch(`${DEXSCREENER_BASE}/token-profiles/latest/v1`);
    if (!res.ok) throw new Error(`Profile API error: ${res.status}`);
    const data = await res.json() as any[];

    const tokens = data
      .filter((t: any) => isSupportedChain(t.chainId, chains))
      .map((t: any) => t.tokenAddress)
      .slice(0, 30);

    if (tokens.length === 0) return [];
    return fetchTokenDetails(tokens, chains);
  } catch (error) {
    console.error('[Fetcher] Error fetching profiles:', error);
    return [];
  }
}

// ===== DexScreener: Search for new Solana memecoins =====
export async function searchNewTokens(query = 'SOL', chains: ChainId[] = DEFAULT_DISCOVERY_CHAINS): Promise<DexScreenerPair[]> {
  try {
    const res = await rateLimitedFetch(`${DEXSCREENER_BASE}/latest/dex/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`Search API error: ${res.status}`);
    const data = await res.json() as { pairs: DexScreenerPair[] };

    return (data.pairs || []).filter(
      (p: DexScreenerPair) => isSupportedChain(p.chainId, chains) && p.liquidity?.usd > 0
    );
  } catch (error) {
    console.error('[Fetcher] Error searching tokens:', error);
    return [];
  }
}

// ===== DexScreener: Get detailed token data =====
export async function fetchTokenDetails(addresses: string[], chains: ChainId[] = DEFAULT_DISCOVERY_CHAINS): Promise<DexScreenerPair[]> {
  if (addresses.length === 0) return [];

  // DexScreener allows max 30 addresses per request
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += 30) {
    chunks.push(addresses.slice(i, i + 30));
  }

  const allPairs: DexScreenerPair[] = [];

  for (const chunk of chunks) {
    try {
      const res = await rateLimitedFetch(
        `${DEXSCREENER_BASE}/latest/dex/tokens/${chunk.join(',')}`
      );
      if (!res.ok) continue;
      const data = await res.json() as { pairs: DexScreenerPair[] | null };
      if (data.pairs) {
        // Get the best pair for each token (highest liquidity)
        const bestPairs = new Map<string, DexScreenerPair>();
        for (const pair of data.pairs) {
          if (!isSupportedChain(pair.chainId, chains)) continue;
          const addr = pair.baseToken.address;
          const existing = bestPairs.get(addr);
          if (!existing || (pair.liquidity?.usd || 0) > (existing.liquidity?.usd || 0)) {
            bestPairs.set(addr, pair);
          }
        }
        allPairs.push(...bestPairs.values());
      }
    } catch (error) {
      console.error('[Fetcher] Error fetching token details:', error);
    }
  }

  return allPairs;
}

// ===== DexScreener: Get price data for specific pairs =====
export async function fetchPairData(pairAddresses: string[]): Promise<Map<string, DexScreenerPair>> {
  const result = new Map<string, DexScreenerPair>();
  if (pairAddresses.length === 0) return result;

  // Collect all base token addresses from open trades - use token endpoint instead
  // Actually we have pair addresses, let's batch fetch them
  for (const pairAddr of pairAddresses) {
    try {
      const res = await rateLimitedFetch(
        `${DEXSCREENER_BASE}/latest/dex/pairs/solana/${pairAddr}`
      );
      if (!res.ok) continue;
      const data = await res.json() as { pairs: DexScreenerPair[] | null; pair: DexScreenerPair | null };
      const pair = data.pair || data.pairs?.[0];
      if (pair) {
        result.set(pair.baseToken.address, pair);
      }
    } catch (error) {
      console.error(`[Fetcher] Error fetching pair ${pairAddr}:`, error);
    }
  }

  return result;
}

// ===== Fetch by token addresses directly (for monitoring) =====
export async function fetchTokenPrices(tokenAddresses: string[], chains: ChainId[] = DEFAULT_DISCOVERY_CHAINS): Promise<Map<string, DexScreenerPair>> {
  const result = new Map<string, DexScreenerPair>();
  if (tokenAddresses.length === 0) return result;

  const missingAddresses: string[] = [];

  for (const tokenAddress of tokenAddresses) {
    const cached = getCached(priceCache, tokenAddress);
    if (cached) result.set(tokenAddress, cached);
    else missingAddresses.push(tokenAddress);
  }

  if (missingAddresses.length === 0) return result;

  const chunks: string[][] = [];
  for (let i = 0; i < missingAddresses.length; i += 30) {
    chunks.push(missingAddresses.slice(i, i + 30));
  }

  for (const chunk of chunks) {
    try {
      const res = await rateLimitedFetch(
        `${DEXSCREENER_BASE}/latest/dex/tokens/${chunk.join(',')}`
      );
      if (!res.ok) continue;
      const data = await res.json() as { pairs: DexScreenerPair[] | null };
      if (data.pairs) {
        // Get best pair per token
        for (const pair of data.pairs) {
          if (!isSupportedChain(pair.chainId, chains)) continue;
          const addr = pair.baseToken.address;
          const existing = result.get(addr);
          if (!existing || (pair.liquidity?.usd || 0) > (existing.liquidity?.usd || 0)) {
            const cachedPair = setCached(priceCache, addr, pair, PRICE_CACHE_TTL);
            result.set(addr, cachedPair);
          }
        }
      }
    } catch (error) {
      console.error('[Fetcher] Error fetching token prices:', error);
    }
  }

  return result;
}

// ===== Solana RPC: Check mint & freeze authority =====
export async function checkTokenAuthorities(
  mintAddress: string
): Promise<AuthorityCheckResult> {
  const cached = getCached(authorityCache, mintAddress);
  if (cached) return cached;

  try {
    const res = await rpcFetchWithRetry<{
      result?: {
        value?: {
          data?: {
            parsed?: {
              info?: {
                mintAuthority?: string | null;
                freezeAuthority?: string | null;
              };
            };
          };
        } | null;
      };
    }>({
      method: 'getAccountInfo',
      params: [mintAddress, { encoding: 'jsonParsed' }],
    });

    if (!res.ok) {
      return setCached(authorityCache, mintAddress, {
        mintAuthority: null,
        freezeAuthority: null,
        mintAuthorityRevoked: null,
        freezeAuthorityRevoked: null,
        inconclusive: true,
        reason: buildRpcFailureReason('Authority RPC', res.status),
      }, RPC_FAILURE_CACHE_TTL);
    }

    const parsed = res.data?.result?.value?.data?.parsed?.info;

    if (!parsed) {
      return setCached(authorityCache, mintAddress, {
        mintAuthority: null,
        freezeAuthority: null,
        mintAuthorityRevoked: null,
        freezeAuthorityRevoked: null,
        inconclusive: true,
        reason: 'Authority RPC returned no parsed account info',
      }, RPC_FAILURE_CACHE_TTL);
    }

    return setCached(authorityCache, mintAddress, {
      mintAuthority: parsed.mintAuthority ?? null,
      freezeAuthority: parsed.freezeAuthority ?? null,
      mintAuthorityRevoked: parsed.mintAuthority === null || parsed.mintAuthority === undefined,
      freezeAuthorityRevoked: parsed.freezeAuthority === null || parsed.freezeAuthority === undefined,
      inconclusive: false,
    }, AUTHORITY_CACHE_TTL);
  } catch (error) {
    console.error(`[Fetcher] Error checking authorities for ${mintAddress}:`, error);
    return setCached(authorityCache, mintAddress, {
      mintAuthority: null,
      freezeAuthority: null,
      mintAuthorityRevoked: null,
      freezeAuthorityRevoked: null,
      inconclusive: true,
      reason: 'Authority RPC request failed',
    }, RPC_FAILURE_CACHE_TTL);
  }
}

// ===== Solana RPC: Get top holders =====
export async function getTopHolders(
  mintAddress: string
): Promise<HolderCheckResult> {
  const cached = getCached(holderCache, mintAddress);
  if (cached) return cached;

  try {
    const res = await rpcFetchWithRetry<{
      result?: {
        value?: Array<{ amount?: string }>;
      };
    }>({
      method: 'getTokenLargestAccounts',
      params: [mintAddress],
    });

    if (!res.ok) {
      return setCached(holderCache, mintAddress, {
        top10Pct: null,
        holderCount: null,
        inconclusive: true,
        reason: buildRpcFailureReason('Holder RPC', res.status),
      }, RPC_FAILURE_CACHE_TTL);
    }

    const accounts = res.data?.result?.value;

    if (!accounts || accounts.length === 0) {
      return setCached(holderCache, mintAddress, {
        top10Pct: null,
        holderCount: null,
        inconclusive: true,
        reason: 'Holder RPC returned no accounts',
      }, RPC_FAILURE_CACHE_TTL);
    }

    // Get total supply
    const supplyRes = await rpcFetchWithRetry<{
      result?: {
        value?: {
          amount?: string;
        };
      };
    }>({
      method: 'getTokenSupply',
      params: [mintAddress],
    });

    if (!supplyRes.ok) {
      return setCached(holderCache, mintAddress, {
        top10Pct: null,
        holderCount: null,
        inconclusive: true,
        reason: buildRpcFailureReason('Supply RPC', supplyRes.status),
      }, RPC_FAILURE_CACHE_TTL);
    }

    const totalSupply = parseFloat(supplyRes.data?.result?.value?.amount || '0');

    if (totalSupply === 0) {
      return setCached(holderCache, mintAddress, {
        top10Pct: null,
        holderCount: null,
        inconclusive: true,
        reason: 'Token supply is zero or unavailable',
      }, RPC_FAILURE_CACHE_TTL);
    }

    // Calculate top 10 holder percentage
    const top10Amount = accounts
      .slice(0, 10)
      .reduce((sum: number, acc: any) => sum + parseFloat(acc.amount || '0'), 0);

    const top10Pct = (top10Amount / totalSupply) * 100;

    return setCached(holderCache, mintAddress, {
      top10Pct,
      holderCount: accounts.length,
      inconclusive: false,
    }, HOLDER_CACHE_TTL);
  } catch (error) {
    console.error(`[Fetcher] Error getting holders for ${mintAddress}:`, error);
    return setCached(holderCache, mintAddress, {
      top10Pct: null,
      holderCount: null,
      inconclusive: true,
      reason: 'Holder RPC request failed',
    }, RPC_FAILURE_CACHE_TTL);
  }
}

// ===== Convert DexScreener pair to our TokenData =====
export function pairToTokenData(pair: DexScreenerPair): TokenData {
  const priceUsd = parseFloat(pair.priceUsd || '0');
  const priceNative = parseFloat(pair.priceNative || '0');
  const marketCap = pair.marketCap || pair.fdv || 0;
  const liquidityUsd = pair.liquidity?.usd || 0;
  const volume24h = pair.volume?.h24 || 0;

  return {
    chainId: 'solana',
    address: pair.baseToken.address,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    pairAddress: pair.pairAddress,
    dex: pair.dexId,
    priceUsd,
    priceNative,
    liquidityUsd,
    volume24h,
    volume1h: pair.volume?.h1 || 0,
    marketCap,
    fdv: pair.fdv || 0,
    priceChange5m: pair.priceChange?.m5 || 0,
    priceChange1h: pair.priceChange?.h1 || 0,
    priceChange6h: pair.priceChange?.h6 || 0,
    priceChange24h: pair.priceChange?.h24 || 0,
    txnsBuys24h: pair.txns?.h24?.buys || 0,
    txnsSells24h: pair.txns?.h24?.sells || 0,
    txnsBuys1h: pair.txns?.h1?.buys || 0,
    txnsSells1h: pair.txns?.h1?.sells || 0,
    pairCreatedAt: pair.pairCreatedAt || 0,
    mintAuthorityRevoked: null,
    freezeAuthorityRevoked: null,
    top10HolderPct: null,
    holderCount: null,
    mcLpRatio: liquidityUsd > 0 ? marketCap / liquidityUsd : 999,
    volumeToMcRatio: marketCap > 0 ? volume24h / marketCap : 0,
    buyToSellRatio1h: (pair.txns?.h1?.sells || 1) > 0
      ? (pair.txns?.h1?.buys || 0) / (pair.txns?.h1?.sells || 1)
      : 0,
    creatorAddress: null,
    creatorRugCount: null,
    creatorSurvivalCount: null,
    creatorRugProbability: null,
    creatorRiskBand: null,
    creatorHistorySampleSize: null,
    creatorRiskConfidence: null,
    creatorDevLaunchedTokenCount: null,
    creatorDevRugRate: null,
    creatorDevHistory: [],
    lpLocked: null,
    lpLockPlatform: null,
    lpCreatorPct: null,
    smartMoneyBuyers: 0,
    socialMentions: 0,
    socialUrls: [],
    momentumConfirmed: false,
    momentumObservations: 0,
    screeningScore: 0,
    screeningPassed: [],
    screeningFailed: [],
    eligible: false,
    experimentStrategy: 'score_momentum',
    rugRiskScore: 0,
    rugRiskLevel: 'low',
    rugRiskReasons: [],
    discoveredAt: Date.now(),
    lastUpdated: Date.now(),
    imageUrl: pair.info?.imageUrl,
  };
}
