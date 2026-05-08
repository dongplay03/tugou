// ===== Pre-trade Browser Review =====
// Opens read-only research pages only for high-score tokens that are about to enter a simulated trade.
// Reuses existing tabs for AVE / GMGN / Google / Pump to avoid tab explosion.

import { WebSocket } from 'ws';
import type { TokenData } from './types.js';

const CDP_BASE = process.env.WEB3_CHROME_CDP || 'http://127.0.0.1:9335';
const MIN_SCORE = Number(process.env.PRE_TRADE_BROWSER_REVIEW_MIN_SCORE ?? 75);
const COOLDOWN_MS = Number(process.env.PRE_TRADE_BROWSER_REVIEW_COOLDOWN_MS ?? 60_000);
const enabled = process.env.PRE_TRADE_BROWSER_REVIEW !== 'false';

const openedTokens = new Set<string>();
let lastOpenedAt = 0;

// Tab reuse: ONE tab per domain max — reuse via navigate, never open duplicates
const trackedTabs: Record<string, string | null> = { ave: null, gmgn: null, pump: null, google: null };

// Domain patterns for matching existing tabs
const DOMAIN_PATTERNS: Record<string, string> = {
  ave: 'ave.ai/token/',
  gmgn: 'gmgn.ai/sol/token/',
  pump: 'pump.fun/coin/',
  google: 'google.com/search',
};

/** Quick check: is a tab still alive? Uses /json/list (cheap local fetch). */
async function isTabAlive(tabId: string): Promise<boolean> {
  try {
    const res = await fetch(`${CDP_BASE}/json/list`);
    if (!res.ok) return false;
    const tabs = (await res.json()) as Array<{ id: string }>;
    return tabs.some(t => t.id === tabId);
  } catch { return false; }
}

export async function preTradeBrowserReview(token: TokenData): Promise<boolean> {
  if (!enabled) return false;
  if (token.screeningScore < MIN_SCORE) return false;
  if (openedTokens.has(token.address)) return false;

  const now = Date.now();
  if (now - lastOpenedAt < COOLDOWN_MS) return false;

  // Cap openedTokens size to prevent unbounded growth
  if (openedTokens.size > 5000) {
    const arr = Array.from(openedTokens);
    const half = arr.length >> 1;
    for (let i = 0; i < half; i++) {
      openedTokens.delete(arr[i]);
    }
  }

  const urls = buildReviewUrls(token);
  const opened: string[] = [];

  for (const [key, url] of urls) {
    const ok = await navigateOrOpen(key, url).catch(() => false);
    if (ok) opened.push(url);
  }

  if (opened.length > 0) {
    openedTokens.add(token.address);
    lastOpenedAt = now;
    console.log(`[PreTradeReview] Opened ${opened.length} browser checks for ${token.symbol} (${token.address})`);
    return true;
  }

  return false;
}

function buildReviewUrls(token: TokenData): [string, string][] {
  const q = encodeURIComponent(`${token.symbol} ${token.address} pump dev rug solana`);
  const addr = encodeURIComponent(token.address);
  return [
    ['ave', `https://ave.ai/token/${addr}-solana`],
    ['gmgn', `https://gmgn.ai/sol/token/${addr}`],
    ['pump', `https://pump.fun/coin/${addr}`],
    ['google', `https://www.google.com/search?q=${q}`],
  ];
}

/** Navigate an existing tab or open a new one. Strictly ONE tab per domain. */
async function navigateOrOpen(domainKey: string, url: string): Promise<boolean> {
  const pattern = DOMAIN_PATTERNS[domainKey];
  let tabId = trackedTabs[domainKey];

  // 1) Try tracked tab
  if (tabId) {
    if (await isTabAlive(tabId)) {
      const ok = await navigateTab(tabId, url);
      if (ok) return true;
    }
    // Tracked tab died, clear it
    trackedTabs[domainKey] = null;
    tabId = null;
  }

  // 2) Find ANY existing tab by URL pattern (recovers after restart)
  if (pattern) {
    const allTabs = await listAllTabs();
    const existing = allTabs.filter(t => t.url.includes(pattern));

    if (existing.length > 0) {
      // Use the first one, close extras
      const keep = existing[0];
      for (let i = 1; i < existing.length; i++) {
        closeTab(existing[i].id).catch(() => {});
      }
      const ok = await navigateTab(keep.id, url);
      if (ok) {
        trackedTabs[domainKey] = keep.id;
        return true;
      }
    }
  }

  // 3) No existing tab — open a new one
  const newTabId = await openNewTab(url);
  if (newTabId) {
    trackedTabs[domainKey] = newTabId;
    return true;
  }
  return false;
}

/** List all Chrome tabs. */
async function listAllTabs(): Promise<Array<{ id: string; url: string }>> {
  try {
    const res = await fetch(`${CDP_BASE}/json/list`);
    if (!res.ok) return [];
    return (await res.json()) as Array<{ id: string; url: string }>;
  } catch { return []; }
}

/** Find a tab whose URL contains the given pattern. Returns tabId or null. */
async function findTabByPattern(pattern: string): Promise<string | null> {
  try {
    const res = await fetch(`${CDP_BASE}/json/list`);
    if (!res.ok) return null;
    const tabs = (await res.json()) as Array<{ url: string; id: string }>;
    const match = tabs.find(t => t.url.includes(pattern));
    return match?.id ?? null;
  } catch {
    return null;
  }
}

/** Navigate an existing tab to a new URL via CDP WebSocket. */
function navigateTab(tabId: string, url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const wsUrl = `${CDP_BASE.replace('http', 'ws')}/devtools/page/${tabId}`;
    let resolved = false;
    const ws = new WebSocket(wsUrl);

    const done = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch { /* noop */ }
      resolve(ok);
    };

    const timer = setTimeout(() => done(false), 5000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url } }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg.id === 1) {
          done(!msg.error);
        }
      } catch { /* ignore */ }
    });

    ws.on('error', () => done(false));
    ws.on('close', () => done(false));
  });
}

/** Open a brand-new tab and return its id. */
async function openNewTab(url: string): Promise<string | null> {
  const res = await fetch(`${CDP_BASE}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) return null;
  const tab = (await res.json().catch(() => null)) as { id?: string } | null;
  return tab?.id ?? null;
}

/** Close a Chrome tab by id. */
async function closeTab(tabId: string): Promise<void> {
  try {
    await fetch(`${CDP_BASE}/json/close/${tabId}`, { method: 'PUT' });
  } catch { /* noop */ }
}
