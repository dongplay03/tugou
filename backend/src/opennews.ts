import * as db from './database.js';
import type {
  OpenNewsArticle,
  OpenNewsOverview,
  OpenNewsThemeHeat,
  OpenNewsDailyCategory,
  OpenNewsDailyHotOverview,
  OpenNewsDailyNewsItem,
  OpenNewsDailyTweetItem,
} from './types.js';

const OPENNEWS_BASE = 'https://ai.6551.io';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ARTICLES = 80;
const FREE_CACHE_MS = 10 * 60 * 1000;
const ALLOWED_ENGINE_TYPES = new Set(['news', 'listing', 'onchain', 'meme', 'market']);
const BLOCKED_SYMBOLS = new Set([
  'BANK',
  'TRUST',
  'LAYER',
  'RIVER',
  'MET',
  'LOW',
  'HIGH',
  'UP',
  'DOWN',
  'YES',
  'NO',
]);

type NewsCoin = {
  symbol?: string;
  market_type?: string;
  match?: string[];
};

type NewsPayload = {
  success?: boolean;
  error?: string;
  data?: Array<{
    id: string | number;
    text?: string;
    link?: string;
    engineType?: string;
    newsType?: string;
    coins?: NewsCoin[];
    aiRating?: {
      score?: number;
      grade?: string;
      signal?: string;
      status?: string;
      summary?: string;
      enSummary?: string;
    };
    ts?: string | number;
  }>;
};

type NormalizedArticle = {
  articleId: string;
  text: string;
  link: string;
  engineType: string;
  newsType: string;
  coins: string[];
  score: number;
  signal: string;
  publishedAt: number;
  fetchedAt: number;
};

let openNewsTimer: ReturnType<typeof setInterval> | null = null;
let freeCategoryCache: { fetchedAt: number; updatedAt: number; categories: OpenNewsDailyCategory[] } | null = null;
const freeHotCache = new Map<string, OpenNewsDailyHotOverview>();

type FreeCategoriesPayload = {
  success?: boolean;
  updated_at?: string;
  categories?: Array<{
    key?: string;
    name?: string;
    name_zh?: string;
    description?: string;
    subcategories?: Array<{
      key?: string;
      name?: string;
      name_zh?: string;
      description?: string;
    }>;
  }>;
};

type FreeHotPayload = {
  success?: boolean;
  category?: string;
  subcategory?: string;
  error?: string;
  news?: {
    success?: boolean;
    updated_at?: string;
    items?: Array<{
      id?: string | number;
      title?: string;
      source?: string;
      link?: string;
      score?: number;
      grade?: string;
      signal?: string;
      summary_zh?: string;
      summary_en?: string;
      coins?: string[];
      published_at?: string;
      engine_type?: string;
    }>;
  };
  tweets?: {
    success?: boolean;
    updated_at?: string;
    items?: Array<{
      author?: string;
      handle?: string;
      content?: string;
      url?: string;
      relevance?: string;
      posted_at?: string;
      metrics?: {
        likes?: number;
        retweets?: number;
        replies?: number;
      };
    }>;
  };
};

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanMatchTerm(value: string): string {
  return value
    .replace(/\(\?i\)/g, '')
    .replace(/\\b/g, '')
    .replace(/[()[\]|?:+*^$\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidCoinSymbol(symbol: string): boolean {
  return /^[A-Z0-9]{2,15}$/.test(symbol) && !BLOCKED_SYMBOLS.has(symbol);
}

function extractCoinSymbols(text: string, coins: NewsCoin[] | undefined): string[] {
  const normalizedText = stripHtml(text);
  const result = new Set<string>();

  for (const coin of coins ?? []) {
    const symbol = String(coin.symbol || '').toUpperCase();
    if (!isValidCoinSymbol(symbol)) continue;

    const hasTicker = new RegExp(`\\$${escapeRegExp(symbol)}\\b|\\b${escapeRegExp(symbol)}\\b`, 'i').test(normalizedText);
    const hasMatch = Array.isArray(coin.match) && coin.match.some(term => {
      const cleaned = cleanMatchTerm(String(term));
      return cleaned.length >= 3 && normalizedText.toLowerCase().includes(cleaned.toLowerCase());
    });

    if (hasTicker || hasMatch) {
      result.add(symbol);
    }
  }

  return Array.from(result);
}

function parseTimestamp(value: string | number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }

  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return fallback;
}

function mapApiArticle(item: NonNullable<NewsPayload['data']>[number], fetchedAt: number): Omit<OpenNewsArticle, 'id'> {
  const text = stripHtml(item.text || '');
  return {
    articleId: String(item.id),
    text,
    link: String(item.link || ''),
    engineType: String(item.engineType || 'news'),
    newsType: String(item.newsType || 'unknown'),
    coins: (item.coins ?? []).map(coin => ({
      symbol: String(coin.symbol || '').toUpperCase(),
      marketType: coin.market_type,
      match: Array.isArray(coin.match) ? coin.match.map(part => String(part)) : [],
    })),
    aiScore: Number(item.aiRating?.score || 0),
    aiGrade: String(item.aiRating?.grade || ''),
    aiSignal: String(item.aiRating?.signal || ''),
    aiStatus: String(item.aiRating?.status || ''),
    aiSummary: String(item.aiRating?.summary || ''),
    enSummary: String(item.aiRating?.enSummary || ''),
    publishedAt: parseTimestamp(item.ts, fetchedAt),
    fetchedAt,
  };
}

function buildFreeHotCacheKey(category: string, subcategory: string): string {
  return `${category.trim().toLowerCase()}::${subcategory.trim().toLowerCase()}`;
}

function mapFreeCategories(payload: FreeCategoriesPayload): { updatedAt: number; categories: OpenNewsDailyCategory[] } {
  return {
    updatedAt: parseTimestamp(payload.updated_at, Date.now()),
    categories: (payload.categories ?? []).map(category => ({
      key: String(category.key || ''),
      name: String(category.name || ''),
      nameZh: String(category.name_zh || category.name || ''),
      description: String(category.description || ''),
      subcategories: (category.subcategories ?? []).map(subcategory => ({
        key: String(subcategory.key || ''),
        name: String(subcategory.name || ''),
        nameZh: String(subcategory.name_zh || subcategory.name || ''),
        description: String(subcategory.description || ''),
      })),
    })).filter(category => category.key.length > 0),
  };
}

function mapFreeNewsItem(item: NonNullable<NonNullable<FreeHotPayload['news']>['items']>[number]): OpenNewsDailyNewsItem {
  const coins = Array.isArray(item.coins) ? item.coins.map(coin => String(coin).toUpperCase()).filter(isValidCoinSymbol) : [];
  return {
    id: String(item.id || ''),
    title: stripHtml(String(item.title || '')),
    source: String(item.source || ''),
    link: String(item.link || ''),
    score: Number(item.score || 0),
    grade: String(item.grade || ''),
    signal: String(item.signal || ''),
    summaryZh: stripHtml(String(item.summary_zh || '')),
    summaryEn: stripHtml(String(item.summary_en || '')),
    coins,
    publishedAt: parseTimestamp(item.published_at, Date.now()),
    engineType: String(item.engine_type || 'news'),
  };
}

function mapFreeTweetItem(item: NonNullable<NonNullable<FreeHotPayload['tweets']>['items']>[number]): OpenNewsDailyTweetItem {
  return {
    author: String(item.author || ''),
    handle: String(item.handle || ''),
    content: stripHtml(String(item.content || '')),
    url: String(item.url || ''),
    postedAt: parseTimestamp(item.posted_at, Date.now()),
    relevance: String(item.relevance || ''),
    metrics: {
      likes: Number(item.metrics?.likes || 0),
      retweets: Number(item.metrics?.retweets || 0),
      replies: Number(item.metrics?.replies || 0),
    },
  };
}

function toNormalizedArticle(article: OpenNewsArticle): NormalizedArticle | null {
  if (!ALLOWED_ENGINE_TYPES.has(article.engineType)) return null;
  const coins = extractCoinSymbols(article.text, article.coins);
  if (coins.length === 0) return null;

  return {
    articleId: article.articleId,
    text: article.text,
    link: article.link,
    engineType: article.engineType,
    newsType: article.newsType,
    coins,
    score: article.aiScore,
    signal: article.aiSignal,
    publishedAt: article.publishedAt,
    fetchedAt: article.fetchedAt,
  };
}

function inferThemes(article: NormalizedArticle): string[] {
  const text = `${article.newsType} ${article.text}`.toLowerCase();
  const tags = new Set<string>();

  if (/(ai|agent|agents|llm|gpu|inference|model|openai|anthropic|deepseek|depin)/i.test(text)) tags.add('AI / Agent');
  if (/(rwa|tokenized|tokenisation|real world asset|treasury|xaut|gold)/i.test(text)) tags.add('RWA / 现实资产');
  if (/(funding_rate|funding_diff|arb|arbitrage|cross-ex|cross ex|rate diff|short rate)/i.test(text)) tags.add('资金费率 / 跨所套利');
  if (/(listing|listed|launchpool|binance|coinbase|bybit|okx|上线)/i.test(text)) tags.add('交易所 / 上币');
  if (/(solana|\bsol\b|jupiter|raydium|pump\.fun|meteora|orca)/i.test(text)) tags.add('Solana 生态');
  if (/(bitcoin|\bbtc\b|ordinal|runes)/i.test(text)) tags.add('比特币生态');
  if (/(stablecoin|usdt|usdc|payment|payments|settlement|visa|mastercard|stripe)/i.test(text)) tags.add('稳定币 / 支付');
  if (/(defi|dex|lending|yield|staking|amm|perp)/i.test(text)) tags.add('DeFi');
  if (/(base|layer 2|\bl2\b|arbitrum|optimism|zksync|scroll)/i.test(text)) tags.add('Base / L2');
  if (/(cardano|\bada\b|summit|governance|treasury proposal)/i.test(text)) tags.add('Cardano 事件');
  if (/(meme|memecoin|doge|shib|pepe|viral)/i.test(text)) tags.add('Meme');
  if (/(price_change|price change|up [0-9.]+%|down [0-9.]+%)/i.test(text)) tags.add('短线异动');

  if (tags.size === 0) {
    if (article.engineType === 'market') tags.add('市场异动');
    else tags.add('综合热点');
  }

  return Array.from(tags);
}

function buildOverviewFromArticles(articles: OpenNewsArticle[]): Pick<OpenNewsOverview, 'articleCount' | 'lastFetchedAt' | 'topThemes' | 'topCoins' | 'headlines'> {
  const normalized = articles
    .map(toNormalizedArticle)
    .filter((article): article is NormalizedArticle => Boolean(article));

  const themeStats = new Map<string, { count: number; coins: Set<string>; sampleHeadlines: OpenNewsThemeHeat['sampleHeadlines'] }>();
  const coinStats = new Map<string, { count: number; maxScore: number; themes: Set<string> }>();

  for (const article of normalized) {
    const themes = inferThemes(article);

    for (const symbol of article.coins) {
      const current = coinStats.get(symbol) ?? { count: 0, maxScore: 0, themes: new Set<string>() };
      current.count += 1;
      current.maxScore = Math.max(current.maxScore, article.score);
      themes.forEach(theme => current.themes.add(theme));
      coinStats.set(symbol, current);
    }

    for (const theme of themes) {
      const current = themeStats.get(theme) ?? { count: 0, coins: new Set<string>(), sampleHeadlines: [] };
      current.count += 1;
      article.coins.forEach(symbol => current.coins.add(symbol));
      if (current.sampleHeadlines.length < 3) {
        current.sampleHeadlines.push({
          text: article.text,
          link: article.link,
          publishedAt: article.publishedAt,
          score: article.score,
          newsType: article.newsType,
          engineType: article.engineType,
        });
      }
      themeStats.set(theme, current);
    }
  }

  const topThemes = Array.from(themeStats.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([theme, stats]) => ({
      theme,
      count: stats.count,
      coins: Array.from(stats.coins).slice(0, 10),
      sampleHeadlines: stats.sampleHeadlines,
    }));

  const topCoins = Array.from(coinStats.entries())
    .sort((a, b) => b[1].count - a[1].count || b[1].maxScore - a[1].maxScore)
    .slice(0, 12)
    .map(([symbol, stats]) => ({
      symbol,
      count: stats.count,
      maxScore: stats.maxScore,
      themes: Array.from(stats.themes).slice(0, 4),
    }));

  const headlines = normalized
    .sort((a, b) => b.score - a.score || b.publishedAt - a.publishedAt)
    .slice(0, 10)
    .map(article => ({
      articleId: article.articleId,
      text: article.text,
      link: article.link,
      publishedAt: article.publishedAt,
      score: article.score,
      signal: article.signal,
      newsType: article.newsType,
      engineType: article.engineType,
      coins: article.coins,
    }));

  const lastFetchedAt = normalized.reduce((max, article) => Math.max(max, article.fetchedAt), 0);

  return {
    articleCount: normalized.length,
    lastFetchedAt,
    topThemes,
    topCoins,
    headlines,
  };
}

export async function getDailyNewsCategories(force = false): Promise<{ updatedAt: number; categories: OpenNewsDailyCategory[] }> {
  const now = Date.now();
  if (!force && freeCategoryCache && now - freeCategoryCache.fetchedAt < FREE_CACHE_MS) {
    return {
      updatedAt: freeCategoryCache.updatedAt,
      categories: freeCategoryCache.categories,
    };
  }

  const response = await fetch(`${OPENNEWS_BASE}/open/free_categories`);
  const payload = await response.json() as FreeCategoriesPayload;

  if (!response.ok || payload.success === false) {
    throw new Error(`free_categories failed: ${response.status}`);
  }

  const mapped = mapFreeCategories(payload);
  freeCategoryCache = {
    fetchedAt: now,
    updatedAt: mapped.updatedAt,
    categories: mapped.categories,
  };

  return mapped;
}

export async function getDailyNewsHot(category: string, subcategory = '', force = false): Promise<OpenNewsDailyHotOverview> {
  const normalizedCategory = category.trim().toLowerCase();
  const normalizedSubcategory = subcategory.trim().toLowerCase();
  const cacheKey = buildFreeHotCacheKey(normalizedCategory, normalizedSubcategory);
  const cached = freeHotCache.get(cacheKey);
  const now = Date.now();

  if (!force && cached && now - cached.fetchedAt < FREE_CACHE_MS) {
    return cached;
  }

  const params = new URLSearchParams({ category: normalizedCategory });
  if (normalizedSubcategory) {
    params.set('subcategory', normalizedSubcategory);
  }

  try {
    const response = await fetch(`${OPENNEWS_BASE}/open/free_hot?${params.toString()}`);
    const payload = await response.json() as FreeHotPayload;

    if (!response.ok || payload.success === false) {
      const message = payload.error || `free_hot failed: ${response.status}`;
      if (cached) {
        return {
          ...cached,
          status: 'cached',
          message: `免费热榜暂时不可用，显示最近缓存。原因：${message}`,
        };
      }
      return {
        status: 'error',
        message,
        category: normalizedCategory,
        subcategory: normalizedSubcategory,
        updatedAt: 0,
        fetchedAt: now,
        relatedCoins: [],
        newsItems: [],
        tweets: [],
      };
    }

    const newsItems = (payload.news?.items ?? []).map(mapFreeNewsItem);
    const tweets = (payload.tweets?.items ?? []).map(mapFreeTweetItem);
    const relatedCoins = Array.from(new Set(newsItems.flatMap(item => item.coins))).slice(0, 20);
    const updatedAt = Math.max(
      parseTimestamp(payload.news?.updated_at, 0),
      parseTimestamp(payload.tweets?.updated_at, 0),
    );

    const result: OpenNewsDailyHotOverview = {
      status: 'ready',
      message: `已加载 ${newsItems.length} 条热门新闻和 ${tweets.length} 条热门推文`,
      category: normalizedCategory,
      subcategory: normalizedSubcategory,
      updatedAt,
      fetchedAt: now,
      relatedCoins,
      newsItems,
      tweets,
    };

    freeHotCache.set(cacheKey, result);
    return result;
  } catch (error) {
    if (cached) {
      return {
        ...cached,
        status: 'cached',
        message: `免费热榜请求失败，显示最近缓存。原因：${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }

    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown free_hot error',
      category: normalizedCategory,
      subcategory: normalizedSubcategory,
      updatedAt: 0,
      fetchedAt: now,
      relatedCoins: [],
      newsItems: [],
      tweets: [],
    };
  }
}

export function getOpenNewsOverview(limit = 120): OpenNewsOverview {
  const enabled = Boolean(process.env.OPENNEWS_TOKEN?.trim());
  const articles = db.getOpenNewsArticles(limit);
  const latestRun = db.getLatestOpenNewsRefreshRun();
  const summary = buildOverviewFromArticles(articles);

  if (!enabled) {
    return {
      enabled: false,
      status: 'disabled',
      message: '未配置 OPENNEWS_TOKEN，新闻热度未启用',
      lastFetchedAt: summary.lastFetchedAt,
      lastAttemptedAt: latestRun?.finishedAt ?? 0,
      articleCount: summary.articleCount,
      topThemes: summary.topThemes,
      topCoins: summary.topCoins,
      headlines: summary.headlines,
    };
  }

  const hasCache = summary.articleCount > 0;
  const status = latestRun?.status === 'success'
    ? 'ready'
    : hasCache
      ? 'cached'
      : 'error';

  return {
    enabled,
    status,
    message: latestRun?.message || (hasCache ? '显示最近一次有效缓存' : '暂无新闻热度数据'),
    lastFetchedAt: summary.lastFetchedAt,
    lastAttemptedAt: latestRun?.finishedAt ?? 0,
    articleCount: summary.articleCount,
    topThemes: summary.topThemes,
    topCoins: summary.topCoins,
    headlines: summary.headlines,
  };
}

export async function refreshOpenNews(): Promise<{ ok: boolean; message: string; count: number }> {
  const token = process.env.OPENNEWS_TOKEN?.trim();
  const startedAt = Date.now();

  if (!token) {
    const finishedAt = Date.now();
    db.saveOpenNewsRefreshRun({
      status: 'disabled',
      startedAt,
      finishedAt,
      articleCount: 0,
      message: 'Missing OPENNEWS_TOKEN',
    });
    return { ok: false, message: 'Missing OPENNEWS_TOKEN', count: 0 };
  }

  try {
    const response = await fetch(`${OPENNEWS_BASE}/open/news_search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit: MAX_ARTICLES, page: 1, hasCoin: true }),
    });

    const payload = await response.json() as NewsPayload;
    const finishedAt = Date.now();

    if (!response.ok || payload.success === false || payload.error) {
      const message = payload.error || `OpenNews request failed: ${response.status}`;
      db.saveOpenNewsRefreshRun({
        status: 'error',
        startedAt,
        finishedAt,
        articleCount: 0,
        message,
      });
      return { ok: false, message, count: 0 };
    }

    const articles = (payload.data ?? []).map(item => mapApiArticle(item, finishedAt));
    db.saveOpenNewsArticles(articles);
    db.saveOpenNewsRefreshRun({
      status: 'success',
      startedAt,
      finishedAt,
      articleCount: articles.length,
      message: `Stored ${articles.length} OpenNews articles`,
    });

    return { ok: true, message: `Stored ${articles.length} OpenNews articles`, count: articles.length };
  } catch (error) {
    const finishedAt = Date.now();
    const message = error instanceof Error ? error.message : 'Unknown OpenNews error';
    db.saveOpenNewsRefreshRun({
      status: 'error',
      startedAt,
      finishedAt,
      articleCount: 0,
      message,
    });
    return { ok: false, message, count: 0 };
  }
}

export function startOpenNewsScheduler() {
  if (openNewsTimer) return;

  void refreshOpenNews().catch(error => {
    console.error('[OpenNews] Initial refresh failed:', error);
  });

  openNewsTimer = setInterval(() => {
    void refreshOpenNews().catch(error => {
      console.error('[OpenNews] Scheduled refresh failed:', error);
    });
  }, DAY_MS);
}
