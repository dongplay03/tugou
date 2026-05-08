import * as db from './database.js';
import { NARRATIVE_PATTERNS } from './narrative-patterns.js';
import type { XMonitorPost } from './types.js';

const CASHTAG_RE = /\$[A-Za-z][A-Za-z0-9]{1,14}/g;
const DAY_MS = 24 * 60 * 60 * 1000;
let elonTimer: ReturnType<typeof setInterval> | null = null;

function detectNarrativeTags(text: string): string[] {
  const normalized = text.toUpperCase();
  const tags: string[] = [];

  for (const [tag, keywords] of Object.entries(NARRATIVE_PATTERNS)) {
    if (keywords.some(keyword => normalized.includes(keyword))) {
      tags.push(tag);
    }
  }

  return tags;
}

export async function refreshElonMonitor(): Promise<{ ok: boolean; message: string; count: number }> {
  const token = process.env.X_BEARER_TOKEN?.trim();
  if (!token) {
    return { ok: false, message: 'Missing X_BEARER_TOKEN', count: 0 };
  }

  const query = encodeURIComponent('from:elonmusk -is:retweet -is:reply');
  const response = await fetch(`https://api.x.com/2/tweets/search/recent?query=${query}&max_results=20&tweet.fields=created_at,text`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return { ok: false, message: `X request failed: ${response.status}`, count: 0 };
  }

  const payload = await response.json() as { data?: Array<{ id: string; text: string; created_at?: string }> };
  const fetchedAt = Date.now();
  const posts: Array<Omit<XMonitorPost, 'id'>> = (payload.data ?? []).map(post => ({
    postId: post.id,
    authorHandle: 'elonmusk',
    text: post.text,
    url: `https://x.com/elonmusk/status/${post.id}`,
    postedAt: post.created_at ? Date.parse(post.created_at) : fetchedAt,
    fetchedAt,
    cashtags: Array.from(new Set((post.text.match(CASHTAG_RE) ?? []).map(tag => tag.toUpperCase()))),
    narrativeTags: detectNarrativeTags(post.text),
  }));

  db.saveXMonitorPosts(posts);
  return { ok: true, message: `Stored ${posts.length} Elon posts`, count: posts.length };
}

export function getElonMonitorOverview(limit = 20) {
  const posts = db.getXMonitorPosts(limit);
  const lastFetchedAt = posts[0]?.fetchedAt ?? 0;
  return {
    enabled: Boolean(process.env.X_BEARER_TOKEN?.trim()),
    lastFetchedAt,
    cashtags: Array.from(new Set(posts.flatMap(post => post.cashtags))).slice(0, 20),
    narrativeTags: Array.from(new Set(posts.flatMap(post => post.narrativeTags))).slice(0, 20),
    posts,
  };
}

export function startElonMonitorScheduler() {
  if (elonTimer) return;

  void refreshElonMonitor().catch(error => {
    console.error('[XMonitor] Initial Elon refresh failed:', error);
  });

  elonTimer = setInterval(() => {
    void refreshElonMonitor().catch(error => {
      console.error('[XMonitor] Scheduled Elon refresh failed:', error);
    });
  }, DAY_MS);
}
