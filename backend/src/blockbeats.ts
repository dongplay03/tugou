import type {
  BlockBeatsDerivativesSnapshot,
  BlockBeatsFeedItem,
  BlockBeatsNetflowItem,
  BlockBeatsOverview,
  BlockBeatsSearchResult,
} from './types.js';

const BLOCKBEATS_BASE = 'https://api-pro.theblockbeats.info';

const FEED_ENDPOINTS: Record<string, { path: string; itemType: 'newsflash' | 'article' }> = {
  important: { path: '/v1/newsflash/important', itemType: 'newsflash' },
  latest: { path: '/v1/newsflash', itemType: 'newsflash' },
  onchain: { path: '/v1/newsflash/onchain', itemType: 'newsflash' },
  ai: { path: '/v1/newsflash/ai', itemType: 'newsflash' },
  prediction: { path: '/v1/newsflash/prediction', itemType: 'newsflash' },
  financing: { path: '/v1/newsflash/financing', itemType: 'newsflash' },
  article: { path: '/v1/article', itemType: 'article' },
  article_important: { path: '/v1/article/important', itemType: 'article' },
  article_original: { path: '/v1/article/original', itemType: 'article' },
};

type BlockBeatsEnvelope<T> = {
  status?: number;
  message?: string;
  data?: T;
};

type RequestResult<T> = {
  ok: boolean;
  message: string;
  data: T | null;
};

function getApiKey(): string {
  return process.env.BLOCKBEATS_API_KEY?.trim() || '';
}

function stripHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }

  if (typeof value === 'string' && value.trim()) {
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const parsed = Date.parse(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
}

function pickArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['items', 'list', 'rows', 'data']) {
      if (Array.isArray(record[key])) return record[key] as any[];
    }
  }
  return [];
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    if (cleaned) return Number(cleaned[0]);
  }
  return null;
}

function extractSentimentIndex(data: unknown): number | null {
  const direct = parseNumber((data as any)?.index ?? (data as any)?.value ?? (data as any)?.current);
  if (direct !== null) return direct;

  const rows = pickArray(data);
  if (rows.length === 0) return null;

  let score = 0;
  let maxScore = 0;

  for (const row of rows) {
    const status = String((row as Record<string, unknown>).status || '').toLowerCase();
    maxScore += 20;
    if (status.includes('buy')) {
      score += 20;
    } else if (status.includes('hold')) {
      score += 10;
    } else if (status.includes('caution')) {
      score += 4;
    }
  }

  if (maxScore === 0) return null;
  return Math.round((score / maxScore) * 100);
}

async function requestBlockBeats<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<RequestResult<T>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, message: 'Missing BLOCKBEATS_API_KEY', data: null };
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }

  const url = `${BLOCKBEATS_BASE}${path}${params.size > 0 ? `?${params.toString()}` : ''}`;

  try {
    const response = await fetch(url, {
      headers: {
        'api-key': apiKey,
      },
    });

    const payload = await response.json() as BlockBeatsEnvelope<T>;
    if (!response.ok || payload.status !== 0) {
      return {
        ok: false,
        message: payload.message || `BlockBeats request failed: ${response.status}`,
        data: payload.data ?? null,
      };
    }

    return {
      ok: true,
      message: payload.message || 'ok',
      data: payload.data ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown BlockBeats error',
      data: null,
    };
  }
}

function mapFeedItem(raw: Record<string, unknown>, itemType: BlockBeatsFeedItem['itemType'], category: string): BlockBeatsFeedItem {
  return {
    id: String(raw.id ?? raw.news_id ?? raw.article_id ?? Math.random()),
    title: stripHtml(raw.title ?? raw.name ?? raw.abstract ?? ''),
    summary: stripHtml(raw.abstract ?? raw.content ?? raw.summary ?? ''),
    link: String(raw.url ?? raw.link ?? ''),
    source: String(raw.source ?? raw.author ?? raw.media_name ?? ''),
    timeLabel: String(raw.time_cn ?? raw.create_time ?? raw.published_at ?? raw.created_at ?? ''),
    publishedAt: parseTimestamp(raw.create_time ?? raw.published_at ?? raw.created_at ?? raw.time),
    itemType,
    category,
  };
}

function summarizeSentiment(index: number | null): string {
  if (index === null) return '未知';
  if (index < 20) return '低位机会区';
  if (index > 80) return '高位风险区';
  return '中性区间';
}

export async function getBlockBeatsOverview(): Promise<BlockBeatsOverview> {
  if (!getApiKey()) {
    return {
      enabled: false,
      status: 'disabled',
      message: '未配置 BLOCKBEATS_API_KEY',
      sentimentIndex: null,
      sentimentLabel: '未启用',
      btcEtfNetInflow: null,
      btcEtfCumulativeInflow: null,
      onchainVolume: null,
      importantNews: [],
    };
  }

  const [sentiment, important, etf, dailyTx] = await Promise.allSettled([
    requestBlockBeats<any>('/v1/data/bottom_top_indicator'),
    requestBlockBeats<any>('/v1/newsflash/important', { size: 5, lang: 'cn' }),
    requestBlockBeats<any>('/v1/data/btc_etf'),
    requestBlockBeats<any>('/v1/data/daily_tx'),
  ]);

  const sentimentResult = sentiment.status === 'fulfilled' ? sentiment.value : { ok: false, message: 'sentiment failed', data: null };
  const importantResult = important.status === 'fulfilled' ? important.value : { ok: false, message: 'important failed', data: null };
  const etfResult = etf.status === 'fulfilled' ? etf.value : { ok: false, message: 'btc_etf failed', data: null };
  const dailyTxResult = dailyTx.status === 'fulfilled' ? dailyTx.value : { ok: false, message: 'daily_tx failed', data: null };

  const sentimentIndex = extractSentimentIndex(sentimentResult.data);
  const importantNews = pickArray(importantResult.data).map(item => mapFeedItem(item as Record<string, unknown>, 'newsflash', 'important')).slice(0, 5);
  const btcEtfNetInflow = parseNumber((etfResult.data as any)?.today_net_inflow ?? (etfResult.data as any)?.net_inflow ?? (etfResult.data as any)?.today);
  const btcEtfCumulativeInflow = parseNumber((etfResult.data as any)?.cumulative_net_inflow ?? (etfResult.data as any)?.cumulative ?? (etfResult.data as any)?.total);
  const onchainVolume = parseNumber((dailyTxResult.data as any)?.today ?? (dailyTxResult.data as any)?.value ?? (dailyTxResult.data as any)?.current);

  const successCount = [sentimentResult.ok, importantResult.ok, etfResult.ok, dailyTxResult.ok].filter(Boolean).length;
  const status: BlockBeatsOverview['status'] = successCount === 4 ? 'ready' : successCount > 0 ? 'partial' : 'error';
  const message = status === 'ready'
    ? 'BlockBeats 市场总览已更新'
    : status === 'partial'
      ? '部分 BlockBeats 数据可用'
      : 'BlockBeats 总览请求失败';

  return {
    enabled: true,
    status,
    message,
    sentimentIndex,
    sentimentLabel: summarizeSentiment(sentimentIndex),
    btcEtfNetInflow,
    btcEtfCumulativeInflow,
    onchainVolume,
    importantNews,
  };
}

export async function getBlockBeatsFeed(kind: string, size = 10): Promise<{ enabled: boolean; message: string; items: BlockBeatsFeedItem[] }> {
  if (!getApiKey()) {
    return { enabled: false, message: '未配置 BLOCKBEATS_API_KEY', items: [] };
  }

  const selected = FEED_ENDPOINTS[kind] ?? FEED_ENDPOINTS.important;
  const query = selected.path.includes('/24h')
    ? { lang: 'cn' }
    : { page: 1, size: Math.min(20, Math.max(1, size)), lang: 'cn' };

  const result = await requestBlockBeats<any>(selected.path, query);
  if (!result.ok) {
    return { enabled: true, message: result.message, items: [] };
  }

  const items = pickArray(result.data)
    .map(item => mapFeedItem(item as Record<string, unknown>, selected.itemType, kind))
    .filter(item => item.title.length > 0)
    .slice(0, Math.min(20, Math.max(1, size)));

  return {
    enabled: true,
    message: items.length > 0 ? 'ok' : '暂无数据',
    items,
  };
}

export async function searchBlockBeats(keyword: string, size = 10): Promise<{ enabled: boolean; message: string; items: BlockBeatsSearchResult[] }> {
  if (!getApiKey()) {
    return { enabled: false, message: '未配置 BLOCKBEATS_API_KEY', items: [] };
  }

  const query = keyword.trim();
  if (query.length < 2) {
    return { enabled: true, message: '请输入至少 2 个字符', items: [] };
  }

  const result = await requestBlockBeats<any>('/v1/search', {
    name: query,
    size: Math.min(20, Math.max(1, size)),
    lang: 'cn',
  });

  if (!result.ok) {
    return { enabled: true, message: result.message, items: [] };
  }

  const items = pickArray(result.data).map(item => {
    const record = item as Record<string, unknown>;
    const mapped = mapFeedItem(record, 'search', query);
    const typeValue = Number(record.type);
    return {
      ...mapped,
      searchType: typeValue === 0 ? 'article' : typeValue === 1 ? 'newsflash' : 'unknown',
    } satisfies BlockBeatsSearchResult;
  });

  return {
    enabled: true,
    message: items.length > 0 ? 'ok' : '未找到结果',
    items,
  };
}

export async function getBlockBeatsNetflow(network = 'solana'): Promise<{ enabled: boolean; message: string; items: BlockBeatsNetflowItem[] }> {
  if (!getApiKey()) {
    return { enabled: false, message: '未配置 BLOCKBEATS_API_KEY', items: [] };
  }

  const result = await requestBlockBeats<any>('/v1/data/top10_netflow', { network });
  if (!result.ok) {
    return { enabled: true, message: result.message, items: [] };
  }

  const items = pickArray(result.data).map(item => {
    const record = item as Record<string, unknown>;
    return {
      chain: String(record.chain || network),
      tokenAddress: String(record.tokenAddressHex || record.tokenAddress || ''),
      tokenSymbol: String(record.tokenSymbol || ''),
      logoUrl: String(record.logoUrl || ''),
      priceUsd: parseNumber(record.priceUsd),
      marketCap: parseNumber(record.marketCap),
      volume: parseNumber(record.volume),
      netflow: parseNumber(record.netflow),
      liquidity: parseNumber(record.liquidity),
    } satisfies BlockBeatsNetflowItem;
  }).filter(item => item.tokenSymbol.length > 0);

  return {
    enabled: true,
    message: items.length > 0 ? 'ok' : '暂无资金流数据',
    items,
  };
}

export async function getBlockBeatsDerivatives(dataType = '1D'): Promise<{ enabled: boolean; message: string; items: BlockBeatsDerivativesSnapshot[] }> {
  if (!getApiKey()) {
    return { enabled: false, message: '未配置 BLOCKBEATS_API_KEY', items: [] };
  }

  const result = await requestBlockBeats<any>('/v1/data/contract', { dataType });
  if (!result.ok) {
    return { enabled: true, message: result.message, items: [] };
  }

  const items = pickArray(result.data).map(item => {
    const record = item as Record<string, unknown>;
    return {
      date: String(record.date || ''),
      hyperliquidOpenInterest: parseNumber(record.hyperliquid_open_interest),
      hyperliquidVolume: parseNumber(record.hyperliquid_volume),
      bybitOpenInterest: parseNumber(record.bybit_open_interest),
      bybitVolume: parseNumber(record.bybit_volume),
      binanceOpenInterest: parseNumber(record.binance_open_interest),
      binanceVolume: parseNumber(record.binance_volume),
    } satisfies BlockBeatsDerivativesSnapshot;
  }).filter(item => item.date.length > 0);

  return {
    enabled: true,
    message: items.length > 0 ? 'ok' : '暂无合约数据',
    items,
  };
}
