// ===== Strategy 2: Social Signal Detection =====
// Monitors social mentions for tokens using DexScreener's info.socials.
// v2: Enriched with X profile scraping (follower count, account age, tweet frequency).
// Since Twitter API requires auth (and costs money), we use:
// - DexScreener social fields as free baseline
// - X profile scraping via browser/nitter for high-potential tokens only

import type { DexScreenerPair } from './types.js';
import { extractXHandle, scrapeXProfile, computeXProfileScore, type XProfileData } from './x-profile-scraper.js';

const SOCIAL_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

interface SocialSnapshot {
  urls: string[];
  hasSocials: boolean;
  hasTwitter: boolean;
  hasTelegram: boolean;
  hasWebsite: boolean;
  socialCount: number;
  timestamp: number;
  // v2 enriched data
  xProfile: XProfileData | null;
  enrichedScore: number;
}

// In-memory social signal cache
const socialCache = new Map<string, SocialSnapshot>();

/**
 * Analyze a token's social presence from DexScreener pair data.
 * Returns a social score (0–100) and metadata.
 */
export function analyzeSocialSignals(pair: DexScreenerPair): {
  score: number;
  urls: string[];
  mentionCount: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;
  const urls: string[] = [];

  const socials = pair.info?.socials || [];
  const websites = pair.info?.websites || [];

  // ---- Collect all social URLs ----
  for (const s of socials) {
    if (s.url) urls.push(s.url);
  }
  for (const w of websites) {
    if (w.url) urls.push(w.url);
  }

  // ---- Check specific social platforms ----
  const hasTwitter = socials.some(s => s.type === 'twitter' && s.url);
  const hasTelegram = socials.some(s => s.type === 'telegram' && s.url);
  const hasDiscord = socials.some(s => s.type === 'discord' && s.url);
  const hasWebsite = websites.length > 0;

  // Score social presence
  if (hasTwitter) {
    score += 25;
    reasons.push('✅ Has Twitter/X account');
  }
  if (hasTelegram) {
    score += 20;
    reasons.push('✅ Has Telegram group');
  }
  if (hasDiscord) {
    score += 15;
    reasons.push('✅ Has Discord server');
  }
  if (hasWebsite) {
    score += 15;
    reasons.push('✅ Has website');
  }

  // Multiple socials is a good sign
  const totalSocials = socials.length + websites.length;
  if (totalSocials >= 4) {
    score += 15;
    reasons.push(`✅ Rich social presence (${totalSocials} links)`);
  } else if (totalSocials === 0) {
    score -= 10;
    reasons.push('❌ No social links at all');
  }

  // Penalize tokens with zero socials heavily
  if (!hasTwitter && !hasTelegram && !hasWebsite) {
    score -= 20;
    reasons.push('⚠️ No social proof — higher rug risk');
  }

  // Cache the snapshot
  socialCache.set(pair.baseToken.address, {
    urls,
    hasSocials: totalSocials > 0,
    hasTwitter,
    hasTelegram,
    hasWebsite,
    socialCount: totalSocials,
    timestamp: Date.now(),
    xProfile: null,
    enrichedScore: score,
  });

  return {
    score: Math.max(0, Math.min(100, score)),
    urls,
    mentionCount: totalSocials,
    reasons,
  };
}

/**
 * Enrich social analysis with X profile data.
 * Called for high-potential tokens only (to avoid rate limits).
 * Returns the additional score adjustment from X profile analysis.
 */
export async function enrichWithXProfile(
  pair: DexScreenerPair,
  existingScore: number,
): Promise<{ adjustment: number; label: string }> {
  const socials = pair.info?.socials || [];
  const twitterUrl = socials.find(s => s.type === 'twitter')?.url;

  if (!twitterUrl) {
    return { adjustment: 0, label: '' };
  }

  const handle = extractXHandle(twitterUrl);
  if (!handle) {
    return { adjustment: 0, label: '' };
  }

  // Check cache
  const cached = socialCache.get(pair.baseToken.address);
  if (cached?.xProfile) {
    const { adjustment, label } = computeXProfileScore(cached.xProfile);
    return { adjustment, label };
  }

  try {
    const profile = await scrapeXProfile(handle);
    if (!profile) return { adjustment: 0, label: '' };

    // Update cache
    if (cached) {
      cached.xProfile = profile;
    }

    const { adjustment, label } = computeXProfileScore(profile);
    return { adjustment, label };
  } catch {
    return { adjustment: 0, label: '' };
  }
}

/**
 * Get cached social data for a token.
 */
export function getCachedSocial(address: string): SocialSnapshot | null {
  const cached = socialCache.get(address);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > SOCIAL_CACHE_TTL) {
    socialCache.delete(address);
    return null;
  }
  return cached;
}

/**
 * Compute a social score delta for the screener.
 * Tokens with active social presence get bonus points.
 * Tokens with NO social presence get a penalty.
 */
export function getSocialScoreAdjustment(pair: DexScreenerPair): {
  adjustment: number;
  label: string;
} {
  const { score, reasons } = analyzeSocialSignals(pair);

  if (score >= 60) {
    return { adjustment: 8, label: '✅ Strong social presence (+8)' };
  } else if (score >= 30) {
    return { adjustment: 3, label: '⚠️ Moderate social presence (+3)' };
  } else if (score > 0) {
    return { adjustment: 0, label: 'ℹ️ Minimal social presence' };
  } else {
    return { adjustment: -5, label: '❌ No social presence (-5)' };
  }
}

/** Cleanup old social cache entries. */
export function cleanupSocialCache(): void {
  const now = Date.now();
  for (const [addr, snap] of socialCache) {
    if (now - snap.timestamp > SOCIAL_CACHE_TTL * 3) {
      socialCache.delete(addr);
    }
  }
}
