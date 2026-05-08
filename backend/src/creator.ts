// ===== Strategy 3: Creator Behavior Analysis =====
// Traces back to the creator of a token mint and checks their history.
// Serial rug-pullers get penalized; creators with surviving tokens get bonuses.
// Now uses shared rpc-client and parses InitializeMint instructions.

import type { CreatorProfile, CreatorRiskBand } from './types.js';
import { rpcFetch } from './rpc-client.js';

const CREATOR_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Known rug creator addresses (sample blacklist, extend over time)
const BLACKLISTED_CREATORS = new Set<string>([
  // Add known rug-pull deployer addresses here
]);

interface CacheEntry<T> { expiresAt: number; value: T }
const creatorCache = new Map<string, CacheEntry<CreatorProfile>>();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (e.expiresAt <= Date.now()) { cache.delete(key); return undefined; }
  return e.value;
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttl: number): T {
  cache.set(key, { expiresAt: Date.now() + ttl, value });
  return value;
}

/**
 * Look up the creator (deployer) of a token mint.
 * Uses getSignaturesForAddress to find the first transaction on the mint account.
 */
export async function getTokenCreator(mintAddress: string): Promise<string | null> {
  try {
    // Get signatures — paginate to find the earliest (creation) transaction
    // getSignaturesForAddress returns newest-first, so we page backwards
    let oldestSig: string | undefined;
    let before: string | undefined = undefined;
    for (let page = 0; page < 5; page++) {
      const opts: Record<string, unknown> = { limit: 1000 };
      if (before) opts.before = before;
      const data = await rpcFetch({
        method: 'getSignaturesForAddress',
        params: [mintAddress, opts],
      });
      const sigs = data?.result;
      if (!sigs || sigs.length === 0) break;
      oldestSig = sigs[sigs.length - 1]?.signature; // last = oldest in this page
      before = oldestSig;
      if (sigs.length < 1000) break; // no more pages
    }

    if (!oldestSig) return null;

    const txData = await rpcFetch({
      method: 'getTransaction',
      params: [oldestSig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
    });

    const tx = txData?.result;
    if (!tx) return null;

    // Fee payer is typically the creator
    const feePayer = tx.transaction?.message?.accountKeys?.[0]?.pubkey
      ?? tx.transaction?.message?.accountKeys?.[0];

    return typeof feePayer === 'string' ? feePayer : null;
  } catch (err) {
    console.error(`[Creator] Error looking up creator for ${mintAddress}:`, err);
    return null;
  }
}

/**
 * Analyze a creator's history. 
 * Returns a CreatorProfile with rug count, surviving tokens, etc.
 */
export async function analyzeCreator(creatorAddress: string): Promise<CreatorProfile> {
  const cached = getCached(creatorCache, creatorAddress);
  if (cached !== undefined) return cached!;

  const profile: CreatorProfile = {
    creatorAddress,
    tokensMinted: 0,
    ruggedTokens: 0,
    survivingTokens: 0,
    avgTokenLifespanHours: 0,
    lastChecked: Date.now(),
  };

  try {
    // Look up recent transactions from this creator that interacted with token program
    // We use getSignaturesForAddress to get recent activity
    const data = await rpcFetch({
      method: 'getSignaturesForAddress',
      params: [creatorAddress, { limit: 50 }],
    });

    const sigs = data?.result;
    if (!sigs || sigs.length === 0) {
      return setCached(creatorCache, creatorAddress, profile, CREATOR_CACHE_TTL);
    }

    // Count transactions as a rough proxy for activity
    // Parse recent transactions to look for InitializeMint (SPL Token program)
    const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    let mintCount = 0;
    const mintChecks = sigs.slice(0, 20); // check last 20 txs for mint instructions

    for (const sig of mintChecks) {
      if (!sig?.signature) continue;
      try {
        const txData = await rpcFetch({
          method: 'getTransaction',
          params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
        });
        const instructions = txData?.result?.transaction?.message?.instructions ?? [];
        const innerInstructions = txData?.result?.meta?.innerInstructions ?? [];

        // Check outer instructions
        for (const ix of instructions) {
          if (ix?.programId === TOKEN_PROGRAM_ID && ix?.parsed?.type === 'initializeMint') {
            mintCount++;
          }
        }

        // Check inner (CPI) instructions
        for (const inner of innerInstructions) {
          for (const ix of inner?.instructions ?? []) {
            if (ix?.programId === TOKEN_PROGRAM_ID && ix?.parsed?.type === 'initializeMint') {
              mintCount++;
            }
          }
        }
      } catch {
        // Skip failed tx lookups
      }
    }

    profile.tokensMinted = Math.max(1, mintCount);

    // If the creator is blacklisted, mark as high-risk
    if (BLACKLISTED_CREATORS.has(creatorAddress)) {
      profile.ruggedTokens = profile.tokensMinted;
    }
  } catch (err) {
    console.error(`[Creator] Error analyzing creator ${creatorAddress}:`, err);
  }

  return setCached(creatorCache, creatorAddress, profile, CREATOR_CACHE_TTL);
}

export interface CreatorRiskAssessment {
  rugProbability: number | null;
  riskBand: CreatorRiskBand;
  historySampleSize: number;
  confidence: number;
}

export function getCreatorRiskAssessment(profile: CreatorProfile | null): CreatorRiskAssessment {
  if (!profile) {
    return {
      rugProbability: null,
      riskBand: 'unknown',
      historySampleSize: 0,
      confidence: 0,
    };
  }

  const historySampleSize = Math.max(0, (profile.ruggedTokens || 0) + (profile.survivingTokens || 0));
  if (historySampleSize === 0) {
    return {
      rugProbability: null,
      riskBand: 'unknown',
      historySampleSize,
      confidence: 0,
    };
  }

  const rugProbability = Math.min(1, Math.max(0, (profile.ruggedTokens + 1) / (historySampleSize + 2)));
  const confidence = Math.min(1, historySampleSize / 8);

  let riskBand: CreatorRiskBand;
  if (rugProbability >= 0.75) riskBand = 'very_high';
  else if (rugProbability >= 0.55) riskBand = 'high';
  else if (rugProbability >= 0.35) riskBand = 'medium';
  else if (rugProbability >= 0.20) riskBand = 'low';
  else riskBand = 'very_low';

  return {
    rugProbability,
    riskBand,
    historySampleSize,
    confidence,
  };
}

/**
 * Get a score adjustment based on creator behavior.
 * Positive for trustworthy creators, negative for serial ruggers.
 */
export function getCreatorScoreAdjustment(profile: CreatorProfile | null): {
  adjustment: number;
  label: string;
  rugProbability: number | null;
  riskBand: CreatorRiskBand;
  historySampleSize: number;
  confidence: number;
} {
  const assessment = getCreatorRiskAssessment(profile);

  if (!profile) {
    return { adjustment: 0, label: 'ℹ️ Creator unknown', ...assessment };
  }

  if (BLACKLISTED_CREATORS.has(profile.creatorAddress)) {
    return {
      adjustment: -50,
      label: '🚨 Creator BLACKLISTED — known rug deployer (-50)',
      rugProbability: 1,
      riskBand: 'very_high',
      historySampleSize: Math.max(assessment.historySampleSize, 1),
      confidence: 1,
    };
  }

  if (assessment.rugProbability === null || assessment.historySampleSize < 2) {
    return {
      adjustment: 0,
      label: 'ℹ️ Creator history insufficient',
      ...assessment,
    };
  }

  const rugPct = (assessment.rugProbability * 100).toFixed(0);
  const confidencePct = (assessment.confidence * 100).toFixed(0);

  let baseAdjustment = 0;
  let labelPrefix = 'ℹ️';
  let riskText = 'neutral risk';

  if (assessment.riskBand === 'very_high') {
    baseAdjustment = -20;
    labelPrefix = '❌';
    riskText = 'very high risk';
  } else if (assessment.riskBand === 'high') {
    baseAdjustment = -12;
    labelPrefix = '⚠️';
    riskText = 'high risk';
  } else if (assessment.riskBand === 'medium') {
    baseAdjustment = -6;
    labelPrefix = '⚠️';
    riskText = 'medium risk';
  } else if (assessment.riskBand === 'low') {
    baseAdjustment = 2;
    labelPrefix = '✅';
    riskText = 'low risk';
  } else if (assessment.riskBand === 'very_low') {
    baseAdjustment = 8;
    labelPrefix = '✅';
    riskText = 'very low risk';
  }

  const scaledAdjustment = Math.round(baseAdjustment * (0.45 + assessment.confidence * 0.55));

  return {
    adjustment: scaledAdjustment,
    label: `${labelPrefix} Creator rug probability ${rugPct}% (${riskText}, n=${assessment.historySampleSize}, confidence ${confidencePct}%) (${scaledAdjustment >= 0 ? '+' : ''}${scaledAdjustment})`,
    ...assessment,
  };
}

/** Add an address to the blacklist at runtime. */
export function blacklistCreator(address: string): void {
  BLACKLISTED_CREATORS.add(address);
}

/** Cleanup old cache entries. */
export function cleanupCreatorCache(): void {
  const now = Date.now();
  for (const [k, v] of creatorCache) {
    if (v.expiresAt <= now) creatorCache.delete(k);
  }
}
