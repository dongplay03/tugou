// ===== Strategy 4: LP Lock / Liquidity Behavior Monitoring =====
// Checks whether LP tokens are locked in known lock contracts,
// and continuously monitors LP for slow draining (soft rug).
// Now uses shared rpc-client and parses pool account to find LP mint.

import type { LPLockInfo } from './types.js';
import { rpcFetch } from './rpc-client.js';

// Known LP lock program addresses on Solana
const KNOWN_LOCK_PROGRAMS = new Set([
  'Lock7kBijGCQLEFAmXcengzXKA88iDNQPriQ7TbgJHsJ', // Raydium LP Locker
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',   // general token extensions
]);

// Known LP burn address (tokens sent here are effectively locked forever)
const BURN_ADDRESSES = new Set([
  '1111111111111111111111111111111111',
  '1nc1nerator11111111111111111111111111111111',
]);

const LP_CHECK_CACHE_TTL = 15 * 60 * 1000; // 15 min

interface CacheEntry<T> { expiresAt: number; value: T }
const lpCache = new Map<string, CacheEntry<LPLockInfo>>();

function getCached(key: string): LPLockInfo | null {
  const e = lpCache.get(key);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) { lpCache.delete(key); return null; }
  return e.value;
}

function setCached(key: string, value: LPLockInfo): LPLockInfo {
  lpCache.set(key, { expiresAt: Date.now() + LP_CHECK_CACHE_TTL, value });
  return value;
}

/**
 * Try to extract the LP token mint from a Raydium/Orca pool account.
 * Falls back to pairAddress if parsing fails.
 */
async function resolveLpMint(pairAddress: string): Promise<string> {
  try {
    const pairInfo = await rpcFetch({
      method: 'getAccountInfo',
      params: [pairAddress, { encoding: 'jsonParsed' }],
    });

    const data = pairInfo?.result?.value?.data;

    // Raydium AMM pools: the pool account is owned by the AMM program
    // and the LP mint is embedded in the account data
    if (data?.parsed?.info?.lpMint) {
      return data.parsed.info.lpMint;
    }

    // Try to read raw data — Raydium V4 AMM layout has LP mint at offset 232-264
    if (typeof data === 'object' && Array.isArray(data) && data[0]) {
      // base64 encoded
    }

    // Fallback: look for associated token accounts that are SPL tokens
    // linked to this pool
  } catch (err) {
    console.error(`[LPLock] Error resolving LP mint for ${pairAddress}:`, err);
  }

  // Fallback to pairAddress (original behavior)
  return pairAddress;
}

/**
 * Check if the LP for a given pair is locked.
 * First resolves the LP token mint from the pool account,
 * then checks largest holders for known lock contracts or burn addresses.
 * @param pairAddress - The pair/pool address
 * @param creatorAddress - Optional creator address to calculate creator LP percentage
 */
export async function checkLPLock(pairAddress: string, creatorAddress?: string | null): Promise<LPLockInfo> {
  const cached = getCached(pairAddress);
  if (cached) return cached;

  const defaultResult: LPLockInfo = {
    locked: false,
    lockPlatform: null,
    lpHolderCount: 0,
    lpCreatorPct: 0,
  };

  try {
    // Get the account info for the pair to find the LP mint
    const pairInfo = await rpcFetch({
      method: 'getAccountInfo',
      params: [pairAddress, { encoding: 'jsonParsed' }],
    });

    if (!pairInfo?.result?.value) {
      return setCached(pairAddress, defaultResult);
    }

    // Resolve the actual LP token mint from the pool account
    const lpMint = await resolveLpMint(pairAddress);

    // Get largest holders of the LP mint
    const largestAccounts = await rpcFetch({
      method: 'getTokenLargestAccounts',
      params: [lpMint],
    });

    const accounts = largestAccounts?.result?.value;
    if (!accounts || accounts.length === 0) {
      // pairAddress might not be a token mint; try alternative approach
      return setCached(pairAddress, defaultResult);
    }

    // Check if any large holder is a known lock contract or burn address
    let locked = false;
    let lockPlatform: string | null = null;
    let totalLP = 0;
    let creatorLP = 0;

    for (const acc of accounts) {
      const amount = parseFloat(acc.amount || '0');
      totalLP += amount;

      // Check if the holder's owner is a lock program
      const ownerInfo = await rpcFetch({
        method: 'getAccountInfo',
        params: [acc.address, { encoding: 'jsonParsed' }],
      });

      const owner = ownerInfo?.result?.value?.owner;
      if (owner && KNOWN_LOCK_PROGRAMS.has(owner)) {
        locked = true;
        lockPlatform = 'Raydium Lock';
      }

      // Check if tokens were sent to burn address
      if (BURN_ADDRESSES.has(acc.address)) {
        locked = true;
        lockPlatform = 'Burned';
      }

      // Check if this holder is the creator
      if (creatorAddress && owner === creatorAddress) {
        creatorLP += amount;
      }
    }

    const result: LPLockInfo = {
      locked,
      lockPlatform,
      lpHolderCount: accounts.length,
      lpCreatorPct: totalLP > 0 ? (creatorLP / totalLP) * 100 : 0,
    };

    return setCached(pairAddress, result);
  } catch (err) {
    console.error(`[LPLock] Error checking LP lock for ${pairAddress}:`, err);
    return setCached(pairAddress, defaultResult);
  }
}

/**
 * Score adjustment based on LP lock status.
 */
export function getLPLockScoreAdjustment(info: LPLockInfo | null): {
  adjustment: number;
  label: string;
} {
  if (!info) {
    return { adjustment: 0, label: 'ℹ️ LP lock status unknown' };
  }

  if (info.locked && info.lockPlatform === 'Burned') {
    return { adjustment: 12, label: `✅ LP burned (permanent lock) (+12)` };
  }

  if (info.locked) {
    return { adjustment: 8, label: `✅ LP locked via ${info.lockPlatform} (+8)` };
  }

  if (info.lpCreatorPct > 80) {
    return { adjustment: -10, label: `❌ Creator holds ${info.lpCreatorPct.toFixed(0)}% of LP — rug risk (-10)` };
  }

  if (info.lpCreatorPct > 50) {
    return { adjustment: -5, label: `⚠️ Creator holds ${info.lpCreatorPct.toFixed(0)}% of LP (-5)` };
  }

  return { adjustment: -3, label: '⚠️ LP not locked (-3)' };
}

/**
 * Monitor LP changes for an open trade.
 * Returns a drain rate (negative = LP being removed).
 */
export function detectLPDrain(
  liquidityAtEntry: number,
  currentLiquidity: number,
  holdTimeMs: number
): { drainRate: number; alert: boolean; label: string } {
  if (liquidityAtEntry <= 0) {
    return { drainRate: 0, alert: false, label: '' };
  }

  const changePct = ((currentLiquidity - liquidityAtEntry) / liquidityAtEntry) * 100;
  const holdHours = holdTimeMs / 3_600_000;

  // Drain rate per hour
  const drainRatePerHour = holdHours > 0 ? changePct / holdHours : 0;

  // Alert if LP dropping more than 5% per hour
  if (drainRatePerHour < -5 && changePct < -10) {
    return {
      drainRate: drainRatePerHour,
      alert: true,
      label: `🚨 Slow LP drain detected: ${changePct.toFixed(1)}% (${drainRatePerHour.toFixed(1)}%/hr)`,
    };
  }

  // Warning if LP dropped more than 15% total
  if (changePct < -15) {
    return {
      drainRate: drainRatePerHour,
      alert: true,
      label: `⚠️ LP dropped ${Math.abs(changePct).toFixed(1)}% since entry`,
    };
  }

  return { drainRate: drainRatePerHour, alert: false, label: '' };
}

/** Cleanup old cache entries. */
export function cleanupLPCache(): void {
  const now = Date.now();
  for (const [k, v] of lpCache) {
    if (v.expiresAt <= now) lpCache.delete(k);
  }
}
