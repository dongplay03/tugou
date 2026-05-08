// ===== X/Twitter Web Trend Discovery =====
// Strategy: Use ONE existing X tab, navigate it to different search URLs via CDP.
// NEVER open new X tabs — always reuse the same one.
// Primary token discovery comes from DexScreener; X is only for social signal.

import WebSocket from 'ws';

const CDP_BASE = process.env.WEB3_CHROME_CDP || 'http://127.0.0.1:9335';
const enabled = process.env.X_TREND_DISCOVERY !== 'false';
const OPEN_COOLDOWN_MS = Number(process.env.X_TREND_DISCOVERY_OPEN_COOLDOWN_MS ?? 10 * 60 * 1000);

let lastOpenedAt = 0;
let nextSearchIndex = 0;

// Elon tweet keyword cache
let elonKeywordsCache: { keywords: string[]; fetchedAt: number } | null = null;
const ELON_KEYWORDS_TTL = 10 * 60 * 1000; // refresh every 10 min

interface ChromeTab {
  id: string;
  type: string;
  url: string;
  title?: string;
  webSocketDebuggerUrl?: string;
}

/**
 * General crypto narrative keywords for DexScreener search.
 */
export function getXTrendKeywords(): string[] {
  const configured = process.env.X_TREND_KEYWORDS?.trim();
  if (configured) {
    return configured.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
  }

  return [
    'memecoin',
    'solana memecoin',
    'pump.fun',
    'ai agent',
    'defi',
    'rwa',
    'gaming',
    'layer2',
    'nft',
    'socialfi',
    'dep in',
    'trending solana',
  ];
}

export function getPrimaryXTrendKeywords(): string[] {
  return getXTrendKeywords().slice(0, Number(process.env.X_TREND_DEX_SEARCH_LIMIT ?? 3));
}

/**
 * Navigate the single shared X tab to a trend search URL.
 * NEVER opens a new tab — reuses existing X tab only.
 */
export async function openXTrendDiscoveryTabs(): Promise<number> {
  if (!enabled) return 0;
  const now = Date.now();
  if (now - lastOpenedAt < OPEN_COOLDOWN_MS) return 0;

  const urls = buildXTrendUrls();
  const url = urls[nextSearchIndex % urls.length];
  nextSearchIndex++;

  const navigated = await navigateExistingXTab(url).catch(() => false);
  if (navigated) {
    lastOpenedAt = now;
    console.log(`[XTrend] Navigated X tab to: ${url.slice(0, 80)}...`);
    return 1;
  }

  // No X tab found — skip, don't open new tabs
  console.warn('[XTrend] No existing X tab found, skipping trend navigation');
  return 0;
}

function buildXTrendUrls(): string[] {
  return [
    `https://x.com/search?q=${encodeURIComponent('($SOL OR solana) (CA OR pump.fun OR gmgn OR ave) min_faves:20')}&src=typed_query&f=live`,
    `https://x.com/search?q=${encodeURIComponent('(memecoin OR "meme coin") solana (pump OR CA OR launch) min_faves:10')}&src=typed_query&f=live`,
    `https://x.com/search?q=${encodeURIComponent('(AI agent OR "ai coin" OR "ai token") solana min_faves:10')}&src=typed_query&f=live`,
    `https://x.com/search?q=${encodeURIComponent('solana ("bought" OR "accumulating" OR "whale") (token OR CA) min_faves:15')}&src=typed_query&f=live`,
    `https://x.com/search?q=${encodeURIComponent('solana trending token 100x OR 1000x min_faves:20')}&src=typed_query&f=live`,
  ];
}

/**
 * Find any existing X tab and navigate it. NEVER opens a new tab.
 */
async function navigateExistingXTab(url: string): Promise<boolean> {
  const tabs = await listChromeTabs();
  const tab = tabs.find(t => t.type === 'page' && isXUrl(t.url) && t.webSocketDebuggerUrl);
  if (!tab?.webSocketDebuggerUrl) return false;

  await activateChromeTab(tab.id).catch(() => undefined);
  await cdpNavigate(tab.webSocketDebuggerUrl, url);
  return true;
}

function isXUrl(url: string): boolean {
  return url.startsWith('https://x.com/') || url.startsWith('https://twitter.com/');
}

async function listChromeTabs(): Promise<ChromeTab[]> {
  const res = await fetch(`${CDP_BASE}/json/list`);
  if (!res.ok) return [];
  return await res.json() as ChromeTab[];
}

async function activateChromeTab(id: string): Promise<void> {
  await fetch(`${CDP_BASE}/json/activate/${encodeURIComponent(id)}`).catch(() => undefined);
}

async function cdpNavigate(wsUrl: string, url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('CDP navigate timeout'));
    }, 5000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url } }));
    });
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw.toString()) as { id?: number; error?: unknown };
        if (msg.id === 1) {
          clearTimeout(timer);
          ws.close();
          msg.error ? reject(new Error('CDP navigate failed')) : resolve();
        }
      } catch {
        // ignore non-json CDP events
      }
    });
    ws.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Fetch crypto-related keywords from Elon Musk's latest tweets.
 * REUSES the existing X tab — navigates to Elon's profile, scrapes, then navigates back.
 * Cached for 10 minutes.
 */
export async function fetchElonTweetKeywords(): Promise<string[]> {
  if (!enabled) return [];
  if (elonKeywordsCache && Date.now() - elonKeywordsCache.fetchedAt < ELON_KEYWORDS_TTL) {
    return elonKeywordsCache.keywords;
  }

  try {
    // Find existing X tab — do NOT open a new one
    const tabs = await listChromeTabs();
    const xTab = tabs.find(t => t.type === 'page' && isXUrl(t.url) && t.webSocketDebuggerUrl);
    if (!xTab?.webSocketDebuggerUrl) {
      console.warn('[XTrend] No existing X tab for Elon tweet scraping, skipping');
      return elonKeywordsCache?.keywords ?? [];
    }

    // Navigate to Elon's profile
    await activateChromeTab(xTab.id).catch(() => undefined);
    await cdpNavigate(xTab.webSocketDebuggerUrl, 'https://x.com/elonmusk');
    // Wait for page load
    await new Promise(r => setTimeout(r, 5000));

    // Extract keywords
    const keywords = await extractKeywordsFromTab(xTab.webSocketDebuggerUrl);
    elonKeywordsCache = { keywords, fetchedAt: Date.now() };

    // Navigate back to a generic search
    await cdpNavigate(xTab.webSocketDebuggerUrl, buildXTrendUrls()[0]).catch(() => undefined);

    return keywords;
  } catch (err) {
    console.warn('[XTrend] Failed to fetch Elon tweet keywords:', err);
    return elonKeywordsCache?.keywords ?? [];
  }
}

async function extractKeywordsFromTab(wsUrl: string): Promise<string[]> {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      resolve(elonKeywordsCache?.keywords ?? []);
    }, 8000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `
            Array.from(document.querySelectorAll('article [data-testid="tweetText"]'))
              .slice(0, 15)
              .map(el => el.innerText)
              .join(' ')
          `,
          returnByValue: true,
        },
      }));
    });

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw.toString()) as any;
        if (msg.id === 1) {
          clearTimeout(timer);
          ws.close();
          const text: string = msg.result?.result?.value ?? '';
          const keywords = parseCryptoKeywords(text);
          resolve(keywords);
        }
      } catch { /* ignore */ }
    });

    ws.on('error', () => {
      clearTimeout(timer);
      resolve(elonKeywordsCache?.keywords ?? []);
    });
  });
}

function parseCryptoKeywords(text: string): string[] {
  if (!text) return [];

  const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'not',
    'and', 'or', 'but', 'if', 'then', 'so', 'for', 'of', 'to', 'in',
    'on', 'at', 'by', 'with', 'from', 'as', 'into', 'about', 'between',
    'through', 'after', 'before', 'during', 'without', 'within', 'along',
    'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
    'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
    'i', 'me', 'my', 'what', 'which', 'who', 'whom', 'how', 'when', 'where',
    'very', 'too', 'also', 'just', 'only', 'even', 'still', 'already',
    'new', 'one', 'two', 'first', 'last', 'next', 'more', 'most', 'much',
    'many', 'some', 'any', 'all', 'each', 'every', 'both', 'few', 'no',
    'up', 'out', 'off', 'over', 'under', 'again', 'once', 'here', 'there',
    'now', 'than', 'other', 'another', 'such', 'like', 'because', 'while',
    'amp', 'https', 'http', 'com', 'x', 'rt', 'via',
  ]);

  const CRYPTO_PATTERNS = [
    'solana', 'sol', 'pump', 'memecoin', 'meme', 'defi', 'nft', 'gaming',
    'ai', 'agent', 'token', 'coin', 'crypto', 'blockchain', 'web3',
    'doge', 'dogecoin', 'shib', 'pepe', 'woj', 'bonk', 'floki',
    'mars', 'moon', 'rocket', 'diamond', 'hodl', 'ape', 'bull', 'bear',
    'whale', 'pumpfun', 'raydium', 'jupiter', 'meteora', 'dex',
    'grok', 'xai', 'tesla', 'spacex', 'starship', 'robotaxi', 'neuralink',
    'trump', 'mag', 'politi', 'rwa', 'layer2', 'l2', 'zk', 'rollup',
    'socialfi', 'depind', 'trending', 'viral', 'launch', 'gem',
  ];

  const words = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= 3 && w.length <= 20 && !STOP_WORDS.has(w));

  const wordCounts = new Map<string, number>();
  for (const w of words) {
    wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
  }

  // Only keep $CASHTAGs and confirmed crypto patterns — drop generic words like "space", "brain", "robot"
  const cashtags = [...text.matchAll(/\$([A-Z]{2,10})/g)].map(m => m[1].toLowerCase());

  // Crypto-specific patterns only (not generic English words)
  const STRICT_CRYPTO = [
    'solana', 'pump', 'pumpfun', 'memecoin', 'meme',
    'doge', 'dogecoin', 'shib', 'pepe', 'bonk', 'floki', 'woj',
    'grok', 'xai', 'tesla', 'spacex', 'starship', 'robotaxi', 'neuralink',
    'trump', 'mag', 'raydium', 'jupiter', 'meteora',
    'defi', 'nft', 'blockchain', 'web3', 'rwa', 'layer2', 'zk',
  ];

  const cryptoMatches = [...wordCounts.entries()]
    .filter(([word]) => STRICT_CRYPTO.some(p => {
      // Short patterns (< 5 chars): exact word match only (prevents "images" matching "ai")
      if (p.length < 5) return word === p;
      // Longer patterns: word equals or starts with pattern
      return word === p || word.startsWith(p);
    }))
    .map(([word]) => word);

  const result = [...new Set([...cashtags, ...cryptoMatches])];
  console.log(`[XTrend] Elon tweet keywords: ${result.slice(0, 10).join(', ')}${result.length > 10 ? ` (+${result.length - 10} more)` : ''}`);
  return result;
}

/**
 * Check if a token matches any of Elon's recent tweet keywords.
 * Strict matching: only high-confidence overlaps qualify.
 */
export function matchTokenAgainstElonKeywords(
  token: { symbol: string; name: string; address: string },
  elonKeywords: string[],
): string | undefined {
  if (elonKeywords.length === 0) return undefined;

  const symbol = token.symbol.toLowerCase();
  const name = token.name.toLowerCase();
  const nameWords = name.split(/\s+/);

  for (const kw of elonKeywords) {
    // Tier 1: $CASHTAG exact symbol match (highest confidence)
    if (symbol === kw) return kw;
    // Tier 2: keyword is a standalone word in the token name
    if (nameWords.includes(kw) && kw.length >= 4) return kw;
    // Tier 3: symbol contains the keyword (only for meaningful-length keywords)
    if (kw.length >= 5 && symbol.includes(kw)) return kw;
    // NO: kw.includes(symbol) — way too loose ("space" contains "e")
  }

  return undefined;
}
