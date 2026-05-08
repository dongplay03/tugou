// ===== X Profile Scraper =====
// Scrapes X/Twitter profile data via browser for richer social signals.
// Only called for tokens that pass initial screening (to avoid rate limits).
// Data: follower count, account age, tweet frequency, engagement.

const X_PROFILE_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

export interface XProfileData {
  handle: string;
  followers: number;
  following: number;
  tweets: number;
  accountAgeDays: number;
  /** Approximate tweets per day over account lifetime */
  tweetFrequency: number;
  /** Whether the account has a blue check (Twitter Blue or verified org) */
  isVerified: boolean;
  /** Profile image exists (not default egg) */
  hasCustomAvatar: boolean;
  /** Bio contains relevant crypto/meme keywords */
  hasRelevantBio: boolean;
  scrapedAt: number;
}

const profileCache = new Map<string, XProfileData>();

/**
 * Extract X/Twitter handle from a social URL.
 * Handles formats: https://x.com/handle, https://twitter.com/handle, x.com/@handle
 */
export function extractXHandle(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace('www.', '');
    if (host !== 'x.com' && host !== 'twitter.com') return null;

    const path = parsed.pathname.replace(/^\//, '').replace(/\/$/, '');
    const handle = path.split('/')[0]?.replace('@', '');
    if (!handle || handle.length < 2 || handle.length > 30) return null;
    // Skip non-profile paths
    if (['search', 'explore', 'notifications', 'messages', 'settings', 'home'].includes(handle.toLowerCase())) return null;
    return handle;
  } catch {
    return null;
  }
}

/**
 * Scrape X profile data using the project's Chrome browser (CDP).
 * Uses the devtools protocol to navigate to the profile page and extract data.
 * 
 * This function is designed to be called sparingly — only for high-potential tokens.
 */
export async function scrapeXProfile(handle: string): Promise<XProfileData | null> {
  // Check cache first
  const cached = profileCache.get(handle);
  if (cached && Date.now() - cached.scrapedAt < X_PROFILE_CACHE_TTL) {
    return cached;
  }

  try {
    // Use HTTP-based approach first (X's embed API is public and doesn't need auth)
    const data = await scrapeXProfileViaEmbed(handle);
    if (data) {
      profileCache.set(handle, data);
      return data;
    }

    // Fallback: use nitter instances (public, no auth needed)
    const nitterData = await scrapeXProfileViaNitter(handle);
    if (nitterData) {
      profileCache.set(handle, nitterData);
      return nitterData;
    }

    return null;
  } catch (err) {
    console.warn(`[XProfileScraper] Failed to scrape @${handle}:`, (err as Error).message);
    return null;
  }
}

/**
 * Try to get profile data from X's embed/oembed API (public, no auth).
 * Returns basic data but not follower counts.
 */
async function scrapeXProfileViaEmbed(handle: string): Promise<XProfileData | null> {
  try {
    const url = `https://publish.twitter.com/oembed?url=https://x.com/${handle}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (!resp.ok) return null;

    const data = await resp.json() as any;
    const html = data?.html || '';

    // Extract what we can from the oembed response
    const nameMatch = html.match(/class="twitter-tweet"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
    const authorName = nameMatch?.[1] || handle;

    return {
      handle,
      followers: 0, // oembed doesn't provide this
      following: 0,
      tweets: 0,
      accountAgeDays: 0,
      tweetFrequency: 0,
      isVerified: false,
      hasCustomAvatar: true, // if they have an embed, they have a profile
      hasRelevantBio: /crypto|solana|defi|web3|nft|meme|token/i.test(authorName),
      scrapedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Try to scrape from nitter instances (public Twitter frontends).
 * These provide more data without authentication.
 */
async function scrapeXProfileViaNitter(handle: string): Promise<XProfileData | null> {
  const nitterInstances = [
    'https://nitter.privacydev.net',
    'https://nitter.poast.org',
    'https://nitter.projectsegfau.lt',
  ];

  for (const instance of nitterInstances) {
    try {
      const url = `${instance}/${handle}`;
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      });

      if (!resp.ok) continue;

      const html = await resp.text();

      // Parse follower count
      const followersMatch = html.match(/(\d[\d,.]*[KkMm]?)\s*Followers/i);
      const followers = parseNumber(followersMatch?.[1] || '0');

      // Parse following count
      const followingMatch = html.match(/(\d[\d,.]*[KkMm]?)\s*Following/i);
      const following = parseNumber(followingMatch?.[1] || '0');

      // Parse tweet count
      const tweetsMatch = html.match(/(\d[\d,.]*[KkMm]?)\s*Tweets/i);
      const tweets = parseNumber(tweetsMatch?.[1] || '0');

      // Parse join date
      const joinMatch = html.match(/Joined\s+(\w+\s+\d{4})/i);
      const accountAgeDays = joinMatch ? getAccountAgeDays(joinMatch[1]) : 0;

      // Check verification
      const isVerified = html.includes('verified-icon') || html.includes('icon-verified');

      // Check bio for crypto keywords
      const bioMatch = html.match(/profile-bio[^>]*>([\s\S]*?)<\//i);
      const bio = bioMatch?.[1] || '';
      const hasRelevantBio = /crypto|solana|defi|web3|nft|meme|token|degen|pump/i.test(bio);

      // Check avatar
      const hasCustomAvatar = !html.includes('default_profile') && !html.includes('egg_avatar');

      const tweetFrequency = accountAgeDays > 0 ? tweets / accountAgeDays : 0;

      const result: XProfileData = {
        handle,
        followers,
        following,
        tweets,
        accountAgeDays,
        tweetFrequency,
        isVerified,
        hasCustomAvatar,
        hasRelevantBio,
        scrapedAt: Date.now(),
      };

      return result;
    } catch {
      continue; // try next instance
    }
  }

  return null;
}

/** Parse human-readable numbers like "12.5K", "1.2M" */
function parseNumber(str: string): number {
  const clean = str.replace(/,/g, '').trim();
  const match = clean.match(/^([\d.]+)\s*([KkMm]?)$/);
  if (!match) return parseInt(clean, 10) || 0;

  const num = parseFloat(match[1]);
  const suffix = match[2]?.toUpperCase();
  if (suffix === 'K') return Math.round(num * 1000);
  if (suffix === 'M') return Math.round(num * 1_000_000);
  return Math.round(num);
}

/** Calculate account age in days from a join date string like "March 2021" */
function getAccountAgeDays(dateStr: string): number {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    return Math.max(0, Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)));
  } catch {
    return 0;
  }
}

/**
 * Compute a rich social score from X profile data.
 * Returns a score 0-100 and adjustment for the screener.
 */
export function computeXProfileScore(profile: XProfileData | null): {
  score: number;
  adjustment: number;
  label: string;
} {
  if (!profile) {
    return { score: 0, adjustment: 0, label: '' };
  }

  let score = 0;
  const reasons: string[] = [];

  // Follower score (0-40 points)
  if (profile.followers >= 100_000) { score += 40; reasons.push(`${fmtNum(profile.followers)} followers (major)`); }
  else if (profile.followers >= 20_000) { score += 30; reasons.push(`${fmtNum(profile.followers)} followers (large)`); }
  else if (profile.followers >= 5_000) { score += 20; reasons.push(`${fmtNum(profile.followers)} followers (medium)`); }
  else if (profile.followers >= 1_000) { score += 10; reasons.push(`${fmtNum(profile.followers)} followers (small)`); }
  else if (profile.followers > 0) { score += 3; reasons.push(`${fmtNum(profile.followers)} followers (micro)`); }

  // Account age score (0-20 points)
  if (profile.accountAgeDays >= 365) { score += 20; reasons.push(`Account ${Math.floor(profile.accountAgeDays / 365)}y old`); }
  else if (profile.accountAgeDays >= 90) { score += 12; reasons.push(`Account ${Math.floor(profile.accountAgeDays / 30)}mo old`); }
  else if (profile.accountAgeDays >= 30) { score += 5; reasons.push(`Account ${Math.floor(profile.accountAgeDays / 30)}mo old`); }
  else if (profile.accountAgeDays > 0) { score -= 5; reasons.push(`⚠️ New account (${profile.accountAgeDays}d)`); }

  // Tweet frequency (0-15 points)
  if (profile.tweetFrequency >= 1 && profile.tweetFrequency <= 20) { score += 15; reasons.push(`Active tweeter (${profile.tweetFrequency.toFixed(1)}/day)`); }
  else if (profile.tweetFrequency > 20) { score += 5; reasons.push(`Very high frequency (${profile.tweetFrequency.toFixed(0)}/day)`); }
  else if (profile.tweetFrequency > 0) { score += 8; reasons.push(`Occasional tweeter`); }

  // Verification bonus
  if (profile.isVerified) { score += 10; reasons.push('Verified account'); }

  // Bio relevance
  if (profile.hasRelevantBio) { score += 10; reasons.push('Crypto-relevant bio'); }

  // Custom avatar (minor signal of legitimacy)
  if (profile.hasCustomAvatar) { score += 5; }

  const finalScore = Math.max(0, Math.min(100, score));

  // Convert to screener adjustment
  let adjustment = 0;
  let label = '';

  // Check if we have meaningful data (not all zeros from oembed fallback)
  const hasRealData = profile.followers > 0 || profile.accountAgeDays > 0 || profile.tweets > 0;

  if (finalScore >= 60) {
    adjustment = 12;
    label = `✅ Strong X profile (@${profile.handle}: ${reasons.join(', ')}) (+12)`;
  } else if (finalScore >= 35) {
    adjustment = 6;
    label = `⚠️ Moderate X profile (@${profile.handle}: ${reasons.join(', ')}) (+6)`;
  } else if (finalScore >= 15) {
    adjustment = 2;
    label = `ℹ️ Basic X profile (@${profile.handle}) (+2)`;
  } else if (hasRealData) {
    // We have real data AND it shows a weak profile — penalize
    adjustment = -3;
    label = `❌ Weak X profile (@${profile.handle}: ${reasons.join(', ')}) (-3)`;
  } else {
    // No real data (oembed fallback) — having an X profile at all is slightly positive
    adjustment = 2;
    label = `ℹ️ X profile exists (@${profile.handle}, limited data) (+2)`;
  }

  return { score: finalScore, adjustment, label };
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

/** Cleanup old cache entries. */
export function cleanupXProfileCache(): void {
  const now = Date.now();
  for (const [handle, data] of profileCache) {
    if (now - data.scrapedAt > X_PROFILE_CACHE_TTL * 3) {
      profileCache.delete(handle);
    }
  }
}
