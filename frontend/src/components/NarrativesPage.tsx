import { useCallback, useEffect, useState } from 'react';
import { Flame, Hash, Loader2, RefreshCw, Search, Sparkles, TrendingUp } from 'lucide-react';
import { API_URL } from '../config';
import type {
  BlockBeatsDerivativesSnapshot,
  BlockBeatsFeedItem,
  BlockBeatsNetflowItem,
  BlockBeatsOverview,
  BlockBeatsSearchResult,
} from '../types';
import { cn, formatTimestamp, formatUSD } from '../utils';

interface NarrativeState {
  narrative?: string;
  tag?: string;
  activeTokens?: number;
  risingTokens?: number;
  ruggedTokens?: number;
  avgPerformance?: number;
  avgScore?: number;
  momentum?: number;
  lastUpdated?: number;
  lastUpdate?: number;
  blocked?: boolean;
  blockReason?: string;
  tokens?: Array<{
    address: string;
    symbol: string;
    name: string;
    priceChange1h: number;
    screeningScore: number;
  }>;
}

interface PatternGroup {
  tag: string;
  keywords: string[];
}

interface NarrativePayload {
  activeCount?: number;
  narratives?: NarrativeState[];
}

const BLOCKBEATS_TABS = [
  { key: 'important', label: '重要快讯' },
  { key: 'onchain', label: '链上快讯' },
  { key: 'ai', label: 'AI 快讯' },
  { key: 'prediction', label: '预测市场' },
  { key: 'article_important', label: '重点文章' },
] as const;

export default function NarrativesPage() {
  const [narratives, setNarratives] = useState<NarrativePayload | null>(null);
  const [patterns, setPatterns] = useState<PatternGroup[]>([]);
  const [overview, setOverview] = useState<BlockBeatsOverview | null>(null);
  const [feedItems, setFeedItems] = useState<BlockBeatsFeedItem[]>([]);
  const [feedMessage, setFeedMessage] = useState('');
  const [selectedTab, setSelectedTab] = useState<(typeof BLOCKBEATS_TABS)[number]['key']>('important');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BlockBeatsSearchResult[]>([]);
  const [searchMessage, setSearchMessage] = useState('');
  const [netflowItems, setNetflowItems] = useState<BlockBeatsNetflowItem[]>([]);
  const [netflowMessage, setNetflowMessage] = useState('');
  const [derivativesItems, setDerivativesItems] = useState<BlockBeatsDerivativesSnapshot[]>([]);
  const [derivativesMessage, setDerivativesMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [signalsRefreshing, setSignalsRefreshing] = useState(false);
  const [expandedTag, setExpandedTag] = useState<string | null>(null);

  const fetchNarratives = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const [narRes, patRes] = await Promise.all([
        fetch(`${API_URL}/strategies/narratives`),
        fetch(`${API_URL}/narrative-patterns`),
      ]);

      if (narRes.ok) {
        setNarratives(await narRes.json() as NarrativePayload);
      }

      if (patRes.ok) {
        const payload = await patRes.json();
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          setPatterns(Object.entries(payload).map(([tag, keywords]) => ({
            tag,
            keywords: keywords as string[],
          })));
        } else if (Array.isArray(payload)) {
          setPatterns(payload as PatternGroup[]);
        }
      }
    } catch {
      // no-op
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadOverview = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/blockbeats/overview`);
      if (!response.ok) throw new Error(`overview failed: ${response.status}`);
      setOverview(await response.json() as BlockBeatsOverview);
    } catch {
      setOverview({
        enabled: false,
        status: 'error',
        message: 'BlockBeats 总览暂时不可用',
        sentimentIndex: null,
        sentimentLabel: '未知',
        btcEtfNetInflow: null,
        btcEtfCumulativeInflow: null,
        onchainVolume: null,
        importantNews: [],
      });
    }
  }, []);

  const loadFeed = useCallback(async (kind: (typeof BLOCKBEATS_TABS)[number]['key'], showRefresh = false) => {
    if (showRefresh) setFeedRefreshing(true);
    try {
      const params = new URLSearchParams({ kind, size: '10' });
      const response = await fetch(`${API_URL}/blockbeats/feed?${params.toString()}`);
      if (!response.ok) throw new Error(`feed failed: ${response.status}`);
      const payload = await response.json() as { enabled: boolean; message: string; items: BlockBeatsFeedItem[] };
      setSelectedTab(kind);
      setFeedItems(Array.isArray(payload.items) ? payload.items : []);
      setFeedMessage(payload.message || '');
    } catch {
      setSelectedTab(kind);
      setFeedItems([]);
      setFeedMessage('BlockBeats 分类流暂时不可用');
    } finally {
      setFeedRefreshing(false);
    }
  }, []);

  const runSearch = useCallback(async (query: string) => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setSearchResults([]);
      setSearchMessage('请输入至少 2 个字符');
      return;
    }

    setSearching(true);
    try {
      const params = new URLSearchParams({ q: normalized, size: '10' });
      const response = await fetch(`${API_URL}/blockbeats/search?${params.toString()}`);
      if (!response.ok) throw new Error(`search failed: ${response.status}`);
      const payload = await response.json() as { enabled: boolean; message: string; items: BlockBeatsSearchResult[] };
      setSearchResults(Array.isArray(payload.items) ? payload.items : []);
      setSearchMessage(payload.message || '');
    } catch {
      setSearchResults([]);
      setSearchMessage('BlockBeats 搜索暂时不可用');
    } finally {
      setSearching(false);
    }
  }, []);

  const loadSignals = useCallback(async (showRefresh = false) => {
    if (showRefresh) setSignalsRefreshing(true);
    try {
      const [netflowRes, derivativesRes] = await Promise.all([
        fetch(`${API_URL}/blockbeats/netflow?network=solana`),
        fetch(`${API_URL}/blockbeats/derivatives?dataType=1D`),
      ]);

      if (netflowRes.ok) {
        const payload = await netflowRes.json() as { message: string; items: BlockBeatsNetflowItem[] };
        setNetflowItems(Array.isArray(payload.items) ? payload.items : []);
        setNetflowMessage(payload.message || '');
      } else {
        setNetflowItems([]);
        setNetflowMessage('资金流数据暂时不可用');
      }

      if (derivativesRes.ok) {
        const payload = await derivativesRes.json() as { message: string; items: BlockBeatsDerivativesSnapshot[] };
        setDerivativesItems(Array.isArray(payload.items) ? payload.items : []);
        setDerivativesMessage(payload.message || '');
      } else {
        setDerivativesItems([]);
        setDerivativesMessage('合约热度数据暂时不可用');
      }
    } finally {
      setSignalsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchNarratives();
    void loadOverview();
    void loadFeed('important');
    void loadSignals();
  }, [fetchNarratives, loadFeed, loadOverview, loadSignals]);

  useEffect(() => {
    const timer = setInterval(() => {
      void fetchNarratives();
      void loadOverview();
      void loadSignals();
    }, 30_000);
    return () => clearInterval(timer);
  }, [fetchNarratives, loadOverview, loadSignals]);

  const activeNarratives = Array.isArray(narratives?.narratives) ? narratives.narratives : [];
  const activeTabLabel = BLOCKBEATS_TABS.find(tab => tab.key === selectedTab)?.label || '资讯';

  return (
    <div className="space-y-5">
      <section className="terminal-panel flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-bg-card p-4">
        <div className="flex items-center gap-3">
          <Flame className="h-5 w-5 text-warning" />
          <div>
            <h2 className="panel-title text-base font-bold text-text-primary">热叙事与 BlockBeats</h2>
            <p className="text-xs text-text-muted">右侧现在直接接 BlockBeats 的市场总览、分类快讯和关键词搜索，用来补链上叙事的资讯层。</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge
            label={overview?.status === 'ready' ? 'BlockBeats 已连接' : overview?.status === 'partial' ? 'BlockBeats 部分可用' : overview?.status === 'disabled' ? 'BlockBeats 未配置' : 'BlockBeats 异常'}
            tone={overview?.status === 'ready' ? 'success' : overview?.status === 'partial' ? 'warning' : 'muted'}
          />
          <button
            onClick={() => {
              void fetchNarratives(true);
              void loadOverview();
              void loadFeed(selectedTab, true);
            }}
            disabled={refreshing || feedRefreshing}
            className="rounded-lg border border-border p-2 text-text-muted transition-colors hover:bg-bg-primary hover:text-text-primary"
          >
            <RefreshCw className={cn('h-4 w-4', (refreshing || feedRefreshing) && 'animate-spin')} />
          </button>
        </div>
      </section>

      {loading ? (
        <div className="rounded-xl border border-border bg-bg-card p-12 text-center">
          <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-text-muted">加载中...</p>
        </div>
      ) : (
        <>
          <section className="grid gap-4 xl:grid-cols-[1.02fr_0.98fr]">
            <section className="rounded-2xl border border-border bg-bg-card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-warning" />
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">活跃叙事</h3>
                    <p className="text-xs text-text-muted">看哪些板块在链上持续活跃，以及板块内哪些币正在抬头。</p>
                  </div>
                </div>
                <span className="text-xs text-text-muted">{activeNarratives.length} 条</span>
              </div>

              <div className="space-y-3">
                {activeNarratives.length > 0 ? activeNarratives.map(item => {
                  const tag = item.narrative || item.tag || '未命名';
                  const updatedAt = item.lastUpdated || item.lastUpdate || 0;
                  const expanded = expandedTag === tag;

                  return (
                    <div key={tag} className="rounded-2xl border border-border/70 bg-bg-primary/35 px-4 py-4 transition-colors hover:border-border">
                      <button
                        onClick={() => setExpandedTag(current => current === tag ? null : tag)}
                        className="flex w-full items-start justify-between gap-4 text-left"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{getNarrativeEmoji(tag)}</span>
                            <h4 className="text-sm font-semibold text-text-primary">{tag}</h4>
                            {item.blocked && <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-medium text-danger">封禁</span>}
                          </div>
                          <div className="flex flex-wrap gap-2 text-[11px] text-text-secondary">
                            <MiniChip label={`活跃 ${item.activeTokens ?? 0}`} />
                            <MiniChip label={`上涨 ${item.risingTokens ?? 0}`} tone={item.risingTokens ? 'success' : 'muted'} />
                            <MiniChip label={`均分 ${(item.avgScore ?? 0).toFixed(0)}`} />
                            <MiniChip label={`动量 ${(item.momentum ?? 0).toFixed(1)}`} tone={(item.momentum ?? 0) >= 0 ? 'success' : 'danger'} />
                          </div>
                        </div>
                        <div className="text-right text-[11px] text-text-muted">
                          <div>{updatedAt ? formatTimestamp(updatedAt) : '—'}</div>
                          <div className="mt-2">{expanded ? '收起' : '展开'}</div>
                        </div>
                      </button>

                      {expanded && (
                        <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
                          {item.blocked && (
                            <div className="rounded-xl border border-danger/30 bg-danger/6 px-3 py-2 text-xs text-danger">
                              {item.blockReason || '当前叙事已被系统封禁'}
                            </div>
                          )}
                          <div className="grid grid-cols-4 gap-2 text-[11px] text-text-secondary">
                            <Metric label="活跃代币" value={String(item.activeTokens ?? 0)} />
                            <Metric label="上涨代币" value={String(item.risingTokens ?? 0)} />
                            <Metric label="Rug 数" value={String(item.ruggedTokens ?? 0)} />
                            <Metric label="均表现" value={`${(item.avgPerformance ?? 0).toFixed(1)}%`} />
                          </div>
                          {item.tokens && item.tokens.length > 0 && (
                            <div className="space-y-2">
                              {item.tokens.slice(0, 8).map(token => (
                                <div key={token.address} className="flex items-center justify-between rounded-xl border border-border/70 bg-bg-card/70 px-3 py-2 text-xs">
                                  <div>
                                    <span className="font-medium text-text-primary">{token.symbol}</span>
                                    <span className="ml-2 text-text-muted">{token.name}</span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className={cn(token.priceChange1h >= 0 ? 'text-success' : 'text-danger')}>
                                      1h {token.priceChange1h.toFixed(1)}%
                                    </span>
                                    <span className="text-text-muted">评分 {token.screeningScore.toFixed(0)}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }) : (
                  <div className="rounded-xl border border-border p-8 text-center">
                    <Flame className="mx-auto mb-3 h-8 w-8 text-text-muted/50" />
                    <p className="text-sm text-text-muted">暂无活跃叙事</p>
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-4">
              <div className="rounded-2xl border border-border bg-bg-card p-5">
                <div className="mb-4 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-warning" />
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">市场总览</h3>
                    <p className="text-xs text-text-muted">情绪指标、BTC ETF 净流入、链上成交量和重要快讯。</p>
                  </div>
                </div>

                {overview?.enabled === false ? (
                  <div className="rounded-xl border border-dashed border-border p-5">
                    <p className="text-sm text-text-primary">未启用 BlockBeats</p>
                    <p className="mt-1 text-xs text-text-muted">请在 `.env` 中配置 `BLOCKBEATS_API_KEY` 后重启后端。</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3 text-[11px] text-text-secondary">
                      <Metric label="情绪指数" value={overview?.sentimentIndex !== null && overview?.sentimentIndex !== undefined ? String(overview.sentimentIndex) : '—'} />
                      <Metric label="ETF 当日净流入" value={overview?.btcEtfNetInflow !== null && overview?.btcEtfNetInflow !== undefined ? `${overview.btcEtfNetInflow}` : '—'} />
                      <Metric label="链上成交量" value={overview?.onchainVolume !== null && overview?.onchainVolume !== undefined ? `${overview.onchainVolume}` : '—'} />
                    </div>
                    <div className="rounded-xl border border-border/70 bg-bg-primary/35 px-3 py-3">
                      <div className="flex items-center gap-2">
                        <StatusBadge label={overview?.sentimentLabel || '未知'} tone={overview?.status === 'ready' ? 'success' : overview?.status === 'partial' ? 'warning' : 'muted'} />
                        <span className="text-xs text-text-muted">{overview?.message || '暂无说明'}</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {(overview?.importantNews || []).map(item => (
                        <NewsCard key={`${item.category}-${item.id}`} item={item} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-border bg-bg-card p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">分类资讯流</h3>
                    <p className="text-xs text-text-muted">按你现在最关心的场景切到重要快讯、链上、AI、预测市场和重点文章。</p>
                  </div>
                  <button
                    onClick={() => void loadFeed(selectedTab, true)}
                    disabled={feedRefreshing}
                    className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-xs font-medium text-warning transition-colors hover:bg-warning/15"
                  >
                    {feedRefreshing ? '刷新中' : '刷新资讯流'}
                  </button>
                </div>

                <div className="mb-4 flex flex-wrap gap-2">
                  {BLOCKBEATS_TABS.map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => void loadFeed(tab.key, true)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs transition-colors',
                        selectedTab === tab.key
                          ? 'border-primary/40 bg-primary/12 text-primary'
                          : 'border-border bg-bg-primary text-text-secondary hover:text-text-primary',
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="rounded-xl border border-border/70 bg-bg-primary/35 px-3 py-3">
                  <p className="text-xs text-text-secondary">{feedMessage || `${activeTabLabel} 已加载`}</p>
                </div>

                <div className="mt-4 space-y-2">
                  {feedItems.length > 0 ? feedItems.map(item => (
                    <NewsCard key={`${item.category}-${item.id}`} item={item} />
                  )) : (
                    <div className="rounded-xl border border-border p-4 text-sm text-text-muted">当前分类暂无内容</div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-bg-card p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">资金流与早期信号</h3>
                    <p className="text-xs text-text-muted">用 Solana Top10 资金流看热门 meme / 聪明钱线索，再用合约持仓看杠杆风险。</p>
                  </div>
                  <button
                    onClick={() => void loadSignals(true)}
                    disabled={signalsRefreshing}
                    className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-xs font-medium text-warning transition-colors hover:bg-warning/15"
                  >
                    {signalsRefreshing ? '刷新中' : '刷新信号'}
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-border/70 bg-bg-primary/35 px-3 py-3">
                    <p className="text-xs text-text-secondary">{netflowMessage || '按资金净流入排序，可直接拿来做热门 meme / 早期信号参考'}</p>
                  </div>

                  <div className="space-y-2">
                    {netflowItems.slice(0, 8).map(item => (
                      <div key={`${item.tokenAddress}-${item.tokenSymbol}`} className="rounded-xl border border-border/70 bg-bg-primary/35 px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-text-primary">{item.tokenSymbol}</span>
                              <span className="text-[11px] text-text-muted">{item.chain}</span>
                            </div>
                            <p className="mt-1 text-[11px] text-text-secondary">{item.tokenAddress}</p>
                          </div>
                          <span className="rounded-full bg-success/10 px-2 py-1 text-[11px] text-success">
                            净流入 {item.netflow !== null ? formatUSD(item.netflow) : '—'}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-4 gap-2 text-[11px] text-text-secondary">
                          <Metric label="市值" value={item.marketCap !== null ? formatUSD(item.marketCap) : '—'} />
                          <Metric label="流动性" value={item.liquidity !== null ? formatUSD(item.liquidity) : '—'} />
                          <Metric label="成交量" value={item.volume !== null ? formatUSD(item.volume) : '—'} />
                          <Metric label="价格" value={item.priceUsd !== null ? `$${item.priceUsd.toFixed(6)}` : '—'} />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-border/70 bg-bg-primary/35 px-3 py-3">
                    <p className="text-xs text-text-secondary">{derivativesMessage || '合约持仓越大，杠杆挤压风险越高；Hyperliquid 可以作为链上合约热度观察窗'}</p>
                  </div>

                  <div className="space-y-2">
                    {derivativesItems.slice(0, 2).map(item => (
                      <div key={item.date} className="rounded-xl border border-border/70 bg-bg-primary/35 px-3 py-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold text-text-primary">{item.date}</span>
                          <span className="text-[11px] text-text-muted">合约热度快照</span>
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-[11px] text-text-secondary">
                          <Metric label="Binance OI" value={item.binanceOpenInterest !== null ? formatUSD(item.binanceOpenInterest) : '—'} />
                          <Metric label="Bybit OI" value={item.bybitOpenInterest !== null ? formatUSD(item.bybitOpenInterest) : '—'} />
                          <Metric label="Hyperliquid OI" value={item.hyperliquidOpenInterest !== null ? formatUSD(item.hyperliquidOpenInterest) : '—'} />
                          <Metric label="Binance 成交量" value={item.binanceVolume !== null ? formatUSD(item.binanceVolume) : '—'} />
                          <Metric label="Bybit 成交量" value={item.bybitVolume !== null ? formatUSD(item.bybitVolume) : '—'} />
                          <Metric label="Hyperliquid 成交量" value={item.hyperliquidVolume !== null ? formatUSD(item.hyperliquidVolume) : '—'} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-bg-card p-5">
                <div className="mb-4 flex items-center gap-2">
                  <Search className="h-4 w-4 text-primary" />
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">关键词搜索</h3>
                    <p className="text-xs text-text-muted">直接搜币名、协议、叙事词或 KOL，快速拉出相关文章和快讯。</p>
                  </div>
                </div>

                <form
                  className="mb-4 flex gap-2"
                  onSubmit={event => {
                    event.preventDefault();
                    void runSearch(searchQuery);
                  }}
                >
                  <input
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder="搜索 BTC、Solana、Hyperliquid、AI agent..."
                    className="flex-1 rounded-xl border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary/40"
                  />
                  <button
                    type="submit"
                    disabled={searching}
                    className="rounded-xl border border-primary/25 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
                  >
                    {searching ? '搜索中' : '搜索'}
                  </button>
                </form>

                <div className="rounded-xl border border-border/70 bg-bg-primary/35 px-3 py-3">
                  <p className="text-xs text-text-secondary">{searchMessage || '输入关键词后会在 BlockBeats 资讯库中检索'}</p>
                </div>

                <div className="mt-4 space-y-2">
                  {searchResults.length > 0 ? searchResults.map(item => (
                    <NewsCard
                      key={`search-${item.id}`}
                      item={item}
                      badgeLabel={item.searchType === 'article' ? '文章' : item.searchType === 'newsflash' ? '快讯' : '搜索结果'}
                    />
                  )) : (
                    <div className="rounded-xl border border-border p-4 text-sm text-text-muted">暂无搜索结果</div>
                  )}
                </div>
              </div>
            </section>
          </section>

          <section className="rounded-2xl border border-border bg-bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Hash className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-text-primary">叙事关键词库</h3>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {patterns.length > 0 ? patterns.map(pattern => (
                <div key={pattern.tag} className="rounded-xl border border-border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm">{getNarrativeEmoji(pattern.tag)}</span>
                    <h4 className="text-sm font-medium text-text-primary">{pattern.tag}</h4>
                    <span className="ml-auto text-[10px] text-text-muted">{pattern.keywords.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {pattern.keywords.map(keyword => (
                      <span key={keyword} className="rounded bg-bg-primary px-2 py-0.5 text-[11px] text-text-secondary">
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              )) : (
                <div className="rounded-xl border border-border p-6 text-center">
                  <p className="text-xs text-text-muted">关键词库待加载</p>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-bg-primary/60 px-3 py-2">
      <p className="text-text-muted">{label}</p>
      <p className="mt-1 text-text-primary">{value}</p>
    </div>
  );
}

function MiniChip({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'success' | 'danger' }) {
  const toneClass = tone === 'success'
    ? 'bg-success/10 text-success'
    : tone === 'danger'
      ? 'bg-danger/10 text-danger'
      : 'bg-bg-card/80 text-text-secondary';
  return <span className={cn('rounded-full px-2 py-1 text-[11px]', toneClass)}>{label}</span>;
}

function StatusBadge({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'success' | 'warning' }) {
  const toneClass = tone === 'success'
    ? 'border-success/25 bg-success/10 text-success'
    : tone === 'warning'
      ? 'border-warning/25 bg-warning/10 text-warning'
      : 'border-border bg-bg-primary text-text-secondary';
  return <span className={cn('rounded-full border px-2 py-1 text-[11px] font-medium', toneClass)}>{label}</span>;
}

function NewsCard({ item, badgeLabel }: { item: BlockBeatsFeedItem; badgeLabel?: string }) {
  return (
    <a
      href={item.link || undefined}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'block rounded-xl border border-border/70 bg-bg-primary/35 px-3 py-3 transition-colors',
        item.link ? 'hover:bg-bg-card/80' : 'cursor-default',
      )}
    >
      <div className="flex items-center justify-between gap-3 text-[11px] text-text-muted">
        <span>{badgeLabel || item.source || item.category}</span>
        <span>{item.timeLabel || (item.publishedAt ? formatTimestamp(item.publishedAt) : '—')}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-text-primary">{item.title}</p>
      {item.summary && <p className="mt-2 text-xs leading-5 text-text-secondary">{item.summary}</p>}
    </a>
  );
}

function getNarrativeEmoji(tag: string): string {
  const map: Record<string, string> = {
    AI: '🤖',
    Political: '🏛️',
    Meme: '🐸',
    Celebrity: '⭐',
    DeFi: '💱',
    Gaming: '🎮',
    Dog: '🐕',
    Cat: '🐱',
  };
  return map[tag] || '🔥';
}
