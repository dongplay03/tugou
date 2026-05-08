import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Brain,
  Clock3,
  ExternalLink,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
  Wallet,
} from 'lucide-react';
import { API_URL } from '../config';
import {
  SMART_MONEY_SOURCE_OPTIONS,
  SMART_MONEY_SOURCE_SEARCH,
  getSmartMoneySourceName,
  isLikelySolanaWallet,
} from '../constants/smartMoney';
import type {
  SmartMoneyOverview,
  SmartMoneyProviderRun,
  SmartMoneyProviderStatus,
  SmartMoneySource,
  SmartMoneyWalletRecord,
  TokenData,
} from '../types';
import { cn, formatPct, formatTimestamp, formatUSD, shortenAddress } from '../utils';
import TokenDetailModal from './TokenDetailModal';

type SmartHit = SmartMoneyOverview['trackedTokens'][number];

interface Props {
  localTokens: TokenData[];
  trackedWalletCount: number;
}

const emptySourceCounts: Record<SmartMoneySource, number> = {
  gmgn: 0,
  ave: 0,
  bullx: 0,
  photon: 0,
  birdeye: 0,
  x: 0,
  telegram: 0,
  manual: 0,
};

export default function SmartMoneyPage({ localTokens, trackedWalletCount }: Props) {
  const [overview, setOverview] = useState<SmartMoneyOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [openingAddress, setOpeningAddress] = useState<string | null>(null);
  const [selectedToken, setSelectedToken] = useState<TokenData | null>(null);
  const [providers, setProviders] = useState<SmartMoneyProviderStatus[]>([]);
  const [providerRuns, setProviderRuns] = useState<SmartMoneyProviderRun[]>([]);
  const [providerBusy, setProviderBusy] = useState<SmartMoneySource | 'all' | null>(null);
  const [selectedSource, setSelectedSource] = useState<SmartMoneySource>('manual');
  const [walletFilter, setWalletFilter] = useState<SmartMoneySource | 'all'>('all');
  const [walletQuery, setWalletQuery] = useState('');
  const [platformSearchQuery, setPlatformSearchQuery] = useState('');
  const [newWallet, setNewWallet] = useState({
    address: '',
    label: '',
    source: 'manual' as SmartMoneySource,
    notes: '',
    winRate: '',
    avgROI: '',
    totalTrades: '',
  });
  const [bulkImportText, setBulkImportText] = useState('');
  const [bulkNotes, setBulkNotes] = useState('');

  const fetchOverview = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const [overviewResponse, providersResponse] = await Promise.all([
        fetch(`${API_URL}/strategies/smart-money`),
        fetch(`${API_URL}/smart-money/providers`),
      ]);

      if (!overviewResponse.ok) {
        throw new Error(`smart money overview failed: ${overviewResponse.status}`);
      }

      const data = await overviewResponse.json() as SmartMoneyOverview;
      setOverview(data);

      if (providersResponse.ok) {
        const payload = await providersResponse.json() as {
          providers: SmartMoneyProviderStatus[];
          runs: SmartMoneyProviderRun[];
        };
        setProviders(payload.providers);
        setProviderRuns(payload.runs);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const wallets = useMemo(() => overview?.wallets ?? [], [overview]);
  const sourceCounts = overview?.sourceCounts ?? emptySourceCounts;

  const fallbackSmartHits = useMemo<SmartHit[]>(() => localTokens
    .filter(token => token.smartMoneyBuyers > 0)
    .sort((a, b) => {
      if (b.smartMoneyBuyers !== a.smartMoneyBuyers) return b.smartMoneyBuyers - a.smartMoneyBuyers;
      if (b.screeningScore !== a.screeningScore) return b.screeningScore - a.screeningScore;
      return b.lastUpdated - a.lastUpdated;
    })
    .slice(0, 24)
    .map(token => ({
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      smartMoneyBuyers: token.smartMoneyBuyers,
      screeningScore: token.screeningScore,
      liquidityUsd: token.liquidityUsd,
      priceChange1h: token.priceChange1h,
      lastUpdated: token.lastUpdated,
    })), [localTokens]);

  const trackedTokens = overview?.trackedTokens.length ? overview.trackedTokens : fallbackSmartHits;
  const normalizedPlatformQuery = platformSearchQuery.trim();

  const sourceSummary = useMemo(() => SMART_MONEY_SOURCE_OPTIONS.map(source => ({
    ...source,
    count: sourceCounts[source.id] ?? 0,
  })), [sourceCounts]);

  const filteredWallets = useMemo(() => {
    const keyword = walletQuery.trim().toLowerCase();
    return wallets.filter(wallet => {
      const sourceMatch = walletFilter === 'all' || wallet.source === walletFilter;
      const text = `${wallet.address} ${wallet.label} ${wallet.notes}`.toLowerCase();
      const queryMatch = !keyword || text.includes(keyword);
      return sourceMatch && queryMatch;
    });
  }, [walletFilter, walletQuery, wallets]);

  const addWallet = async () => {
    const address = newWallet.address.trim();
    if (!address) return;

    setAdding(true);
    try {
      const response = await fetch(`${API_URL}/smart-money/wallets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          label: newWallet.label.trim() || shortenAddress(address, 6),
          source: newWallet.source,
          notes: newWallet.notes.trim(),
          winRate: Number(newWallet.winRate) || 0,
          avgROI: Number(newWallet.avgROI) || 0,
          totalTrades: Number(newWallet.totalTrades) || 0,
        }),
      });

      if (!response.ok) {
        throw new Error(`wallet add failed: ${response.status}`);
      }

      setNewWallet({
        address: '',
        label: '',
        source: newWallet.source,
        notes: '',
        winRate: '',
        avgROI: '',
        totalTrades: '',
      });
      setSelectedSource(newWallet.source);
      await fetchOverview();
    } finally {
      setAdding(false);
    }
  };

  const bulkImportWallets = async () => {
    const rows = bulkImportText
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    if (rows.length === 0) return;

    setImporting(true);
    try {
      const response = await fetch(`${API_URL}/smart-money/wallets/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: selectedSource,
          notes: bulkNotes.trim(),
          wallets: rows,
        }),
      });

      if (!response.ok) {
        throw new Error(`wallet bulk import failed: ${response.status}`);
      }

      setBulkImportText('');
      setBulkNotes('');
      setWalletFilter(selectedSource);
      await fetchOverview();
    } finally {
      setImporting(false);
    }
  };

  const removeWallet = async (address: string) => {
    await fetch(`${API_URL}/smart-money/wallets/${encodeURIComponent(address)}`, { method: 'DELETE' });
    await fetchOverview();
  };

  const openPlatformSearch = (source: SmartMoneySource) => {
    const config = SMART_MONEY_SOURCE_SEARCH[source];
    const target = normalizedPlatformQuery ? config.buildSearchUrl(normalizedPlatformQuery) : config.homeUrl;
    window.open(target, '_blank', 'noopener,noreferrer');
  };

  const openPlatformDocs = (source: SmartMoneySource) => {
    const config = SMART_MONEY_SOURCE_SEARCH[source];
    const target = config.docsUrl || config.homeUrl;
    window.open(target, '_blank', 'noopener,noreferrer');
  };

  const applySourceToForm = (source: SmartMoneySource) => {
    const notePrefix = normalizedPlatformQuery
      ? `Search seed: ${getSmartMoneySourceName(source)} / ${normalizedPlatformQuery}`
      : `Search seed: ${getSmartMoneySourceName(source)}`;

    setSelectedSource(source);
    setWalletFilter(source);
    setNewWallet(current => ({
      ...current,
      source,
      address: current.address || (isLikelySolanaWallet(normalizedPlatformQuery) ? normalizedPlatformQuery : ''),
      notes: current.notes || notePrefix,
    }));
  };

  const refreshProvider = async (source: SmartMoneySource | 'all') => {
    setProviderBusy(source);
    try {
      const url = source === 'all'
        ? `${API_URL}/smart-money/providers/refresh-all`
        : `${API_URL}/smart-money/providers/${source}/refresh`;
      const response = await fetch(url, { method: 'POST' });
      if (!response.ok) {
        throw new Error(`provider refresh failed: ${response.status}`);
      }
      await fetchOverview();
    } finally {
      setProviderBusy(null);
    }
  };

  const openTokenDetails = async (hit: SmartHit) => {
    const localToken = localTokens.find(token => token.address === hit.address);
    if (localToken) {
      setSelectedToken(localToken);
      return;
    }

    setOpeningAddress(hit.address);
    try {
      const response = await fetch(`${API_URL}/tokens/${encodeURIComponent(hit.address)}`);
      if (!response.ok) {
        throw new Error(`token fetch failed: ${response.status}`);
      }
      const token = await response.json() as TokenData;
      setSelectedToken(token);
    } finally {
      setOpeningAddress(null);
    }
  };

  return (
    <div className="space-y-5">
      <section className="bg-bg-card terminal-panel rounded-2xl border border-border p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3">
              <Brain className="h-5 w-5 text-accent" />
              <div>
                <h2 className="panel-title text-lg font-semibold text-text-primary">聪明钱追踪台</h2>
                <p className="text-xs text-text-muted">
                  页面现在直接使用后端来源字段、备注字段和批量导入接口。平台分类、命中结果和钱包维护在同一视图里收口。
                </p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 xl:w-[460px]">
            <MetricCard label="已追踪钱包" value={String(overview?.walletCount ?? trackedWalletCount)} hint="smart_money_wallets 实际记录数" />
            <MetricCard label="来源平台" value={String(sourceSummary.filter(item => item.count > 0).length)} hint="当前有钱包落入的来源分类" />
            <MetricCard label="命中代币" value={String(overview?.signalCount ?? trackedTokens.length)} hint="最近发现中存在聪明钱买入" />
            <MetricCard
              label="最近检查"
              value={overview?.lastCheckTime ? formatTimestamp(overview.lastCheckTime) : '待同步'}
              hint="来源于 /strategies/smart-money 概览接口"
            />
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-5">
          <section className="bg-bg-card rounded-2xl border border-border p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="panel-title text-base font-semibold text-text-primary">来源平台</h3>
                <p className="text-xs text-text-muted">点击平台卡片会同时切换新增表单来源和下方钱包筛选器。</p>
              </div>
              <button
                onClick={() => fetchOverview(true)}
                disabled={refreshing}
                className="h-10 w-10 rounded-xl border border-border text-text-muted transition-colors hover:bg-bg-primary hover:text-text-primary"
              >
                <RefreshCw className={cn('mx-auto h-4 w-4', refreshing && 'animate-spin')} />
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sourceSummary.map(source => {
                const active = selectedSource === source.id;
                return (
                  <button
                    key={source.id}
                    onClick={() => {
                      setSelectedSource(source.id);
                      setWalletFilter(source.id);
                      setNewWallet(current => ({ ...current, source: source.id }));
                    }}
                    className={cn(
                      'rounded-2xl border p-4 text-left transition-all',
                      active
                        ? 'border-primary/30 bg-primary/10 shadow-[0_10px_30px_rgba(255,184,77,0.08)]'
                        : 'border-border hover:border-primary/20 hover:bg-bg-card-hover'
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="panel-title text-sm font-medium text-text-primary">{source.name}</span>
                      <span className="rounded-full bg-bg-primary px-2 py-1 text-[10px] text-text-muted">{source.count}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-text-muted">{source.hint}</p>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="bg-bg-card rounded-2xl border border-border p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="panel-title text-base font-semibold text-text-primary">自动抓取与每日刷新</h3>
                <p className="text-xs text-text-muted">Birdeye 和 X 支持真实接口刷新；其他平台已预留按钮和状态位，接口稳定后可直接接入。</p>
              </div>
              <button
                onClick={() => void refreshProvider('all')}
                disabled={providerBusy !== null}
                className="rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
              >
                {providerBusy === 'all' ? '刷新中' : '刷新全部自动源'}
              </button>
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              {providers.map(provider => {
                const activeRun = provider.lastRun;
                const busy = providerBusy === provider.source;
                return (
                  <div key={provider.source} className="rounded-2xl border border-border bg-bg-primary/35 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="panel-title text-sm font-medium text-text-primary">{provider.label}</span>
                          <span className={cn(
                            'rounded-full px-2 py-1 text-[10px]',
                            provider.mode === 'api'
                              ? 'bg-success/10 text-success'
                              : provider.mode === 'search-only'
                                ? 'bg-warning/10 text-warning'
                                : 'bg-bg-card-hover text-text-muted'
                          )}>
                            {provider.mode === 'api' ? 'API' : provider.mode === 'search-only' ? 'Search Only' : 'Manual'}
                          </span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-text-muted">{provider.note}</p>
                      </div>
                      <span className={cn(
                        'rounded-full px-2 py-1 text-[10px]',
                        provider.enabled ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                      )}>
                        {provider.enabled ? '已启用' : '未启用'}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-text-secondary">
                      <ValueBlock label="自动刷新" value={provider.autoRefresh ? '每天' : '关闭'} />
                      <ValueBlock label="最近结果" value={activeRun ? `${activeRun.walletCount} 条` : '未运行'} />
                      <ValueBlock label="最近状态" value={activeRun ? activeRun.status : '—'} />
                      <ValueBlock label="最近时间" value={activeRun ? formatTimestamp(activeRun.finishedAt) : '—'} />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={() => void refreshProvider(provider.source)}
                        disabled={providerBusy !== null}
                        className="rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
                      >
                        {busy ? '获取中' : '一键获取前20'}
                      </button>
                      <button
                        onClick={() => openPlatformSearch(provider.source)}
                        className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-card-hover hover:text-text-primary"
                      >
                        搜索平台
                      </button>
                      {provider.docsUrl && (
                        <button
                          onClick={() => openPlatformDocs(provider.source)}
                          className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-card-hover hover:text-text-primary"
                        >
                          文档
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 rounded-2xl border border-border/70 bg-bg-primary/45 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-text-muted" />
                <h4 className="text-sm font-medium text-text-primary">最近刷新记录</h4>
              </div>
              {providerRuns.length === 0 ? (
                <p className="text-xs text-text-muted">还没有自动抓取记录。</p>
              ) : (
                <div className="space-y-2">
                  {providerRuns.slice(0, 6).map(run => (
                    <div key={run.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-bg-card/60 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm text-text-primary">
                          {getSmartMoneySourceName(run.source)} <span className="text-text-muted">· {run.message}</span>
                        </p>
                        <p className="text-[11px] text-text-muted">{formatTimestamp(run.finishedAt)}</p>
                      </div>
                      <span className={cn(
                        'rounded-full px-2 py-1 text-[10px]',
                        run.status === 'success'
                          ? 'bg-success/10 text-success'
                          : run.status === 'error'
                            ? 'bg-danger/10 text-danger'
                            : 'bg-warning/10 text-warning'
                      )}>
                        {run.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="bg-bg-card rounded-2xl border border-border p-5">
            <div className="mb-4 flex items-start gap-3">
              <Settings2 className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <h3 className="panel-title text-base font-semibold text-text-primary">平台搜索工具箱</h3>
                <p className="text-xs text-text-muted">输入代币名、KOL 名称或钱包地址，然后按平台一键外跳搜索；也可以把当前来源和备注直接填进新增表单。</p>
              </div>
            </div>

            <div className="mb-4 grid gap-3 lg:grid-cols-[1.3fr_0.7fr]">
              <label className="space-y-2">
                <span className="text-xs text-text-muted">搜索词</span>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                  <input
                    value={platformSearchQuery}
                    onChange={event => setPlatformSearchQuery(event.target.value)}
                    placeholder={SMART_MONEY_SOURCE_SEARCH[selectedSource].placeholder}
                    className="w-full rounded-xl border border-border bg-bg-primary py-2.5 pl-9 pr-3 text-sm text-text-primary outline-none focus:border-primary"
                  />
                </div>
              </label>
              <div className="rounded-2xl border border-border/70 bg-bg-primary/60 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">当前目标</p>
                <p className="panel-title mt-2 text-lg font-semibold text-text-primary">{getSmartMoneySourceName(selectedSource)}</p>
                <p className="mt-1 text-[11px] leading-5 text-text-muted">{SMART_MONEY_SOURCE_SEARCH[selectedSource].helper}</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {SMART_MONEY_SOURCE_OPTIONS.map(source => {
                const searchConfig = SMART_MONEY_SOURCE_SEARCH[source.id];
                return (
                  <div key={source.id} className="rounded-2xl border border-border bg-bg-primary/35 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="panel-title text-sm font-medium text-text-primary">{source.name}</span>
                      <span className="rounded-full bg-bg-primary px-2 py-1 text-[10px] text-text-muted">{sourceCounts[source.id] ?? 0}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-text-muted">{searchConfig.helper}</p>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => openPlatformSearch(source.id)}
                        className="rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                      >
                        搜索平台
                      </button>
                      <button
                        onClick={() => applySourceToForm(source.id)}
                        className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-card-hover hover:text-text-primary"
                      >
                        填入表单
                      </button>
                      <button
                        onClick={() => openPlatformDocs(source.id)}
                        className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-card-hover hover:text-text-primary"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        打开入口 / 文档
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid gap-5 2xl:grid-cols-2">
            <div className="bg-bg-card rounded-2xl border border-border p-5">
              <div className="mb-4">
                <h3 className="panel-title text-base font-semibold text-text-primary">新增追踪钱包</h3>
                <p className="text-xs text-text-muted">单条录入会直接写入后端 `smart_money_wallets`，包含来源和备注。</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-xs text-text-muted">来源平台</span>
                  <select
                    value={newWallet.source}
                    onChange={event => {
                      const source = event.target.value as SmartMoneySource;
                      setSelectedSource(source);
                      setNewWallet(current => ({ ...current, source }));
                    }}
                    className="w-full rounded-xl border border-border bg-bg-primary px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
                  >
                    {SMART_MONEY_SOURCE_OPTIONS.map(source => (
                      <option key={source.id} value={source.id}>{source.name}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-xs text-text-muted">展示标签</span>
                  <input
                    value={newWallet.label}
                    onChange={event => setNewWallet(current => ({ ...current, label: event.target.value }))}
                    placeholder="如：榜单主仓、跟单组 A"
                    className="w-full rounded-xl border border-border bg-bg-primary px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
                  />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs text-text-muted">钱包地址</span>
                  <input
                    value={newWallet.address}
                    onChange={event => setNewWallet(current => ({ ...current, address: event.target.value }))}
                    placeholder="Solana 钱包地址"
                    className="w-full rounded-xl border border-border bg-bg-primary px-3 py-2.5 text-sm font-mono text-text-primary outline-none focus:border-primary"
                  />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs text-text-muted">备注</span>
                  <input
                    value={newWallet.notes}
                    onChange={event => setNewWallet(current => ({ ...current, notes: event.target.value }))}
                    placeholder="例如来源链接、筛选理由、风险备注"
                    className="w-full rounded-xl border border-border bg-bg-primary px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs text-text-muted">胜率 %</span>
                  <input
                    value={newWallet.winRate}
                    onChange={event => setNewWallet(current => ({ ...current, winRate: event.target.value }))}
                    placeholder="0"
                    className="w-full rounded-xl border border-border bg-bg-primary px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs text-text-muted">平均 ROI %</span>
                  <input
                    value={newWallet.avgROI}
                    onChange={event => setNewWallet(current => ({ ...current, avgROI: event.target.value }))}
                    placeholder="0"
                    className="w-full rounded-xl border border-border bg-bg-primary px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs text-text-muted">交易总数</span>
                  <input
                    value={newWallet.totalTrades}
                    onChange={event => setNewWallet(current => ({ ...current, totalTrades: event.target.value }))}
                    placeholder="0"
                    className="w-full rounded-xl border border-border bg-bg-primary px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    onClick={addWallet}
                    disabled={adding || !newWallet.address.trim()}
                    className="w-full rounded-xl bg-primary/90 px-4 py-2.5 text-sm font-medium text-slate-950 transition-colors hover:bg-primary disabled:opacity-50"
                  >
                    {adding ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        写入中
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        加入追踪
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-bg-card rounded-2xl border border-border p-5">
              <div className="mb-4">
                <h3 className="panel-title text-base font-semibold text-text-primary">批量导入</h3>
                <p className="text-xs text-text-muted">每行一个钱包，支持 `address` 或 `address,label`。统一写入当前所选平台来源。</p>
              </div>
              <div className="space-y-3">
                <label className="space-y-2">
                  <span className="text-xs text-text-muted">导入来源</span>
                  <div className="rounded-xl border border-border bg-bg-primary px-3 py-2.5 text-sm text-text-primary">
                    {getSmartMoneySourceName(selectedSource)}
                  </div>
                </label>
                <label className="space-y-2">
                  <span className="text-xs text-text-muted">统一备注</span>
                  <input
                    value={bulkNotes}
                    onChange={event => setBulkNotes(event.target.value)}
                    placeholder="例如：2026-04-06 GMGN 榜单导入"
                    className="w-full rounded-xl border border-border bg-bg-primary px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs text-text-muted">钱包列表</span>
                  <textarea
                    value={bulkImportText}
                    onChange={event => setBulkImportText(event.target.value)}
                    placeholder={'walletAddress1,label1\nwalletAddress2,label2\nwalletAddress3'}
                    rows={8}
                    className="w-full rounded-xl border border-border bg-bg-primary px-3 py-3 text-sm text-text-primary outline-none focus:border-primary"
                  />
                </label>
                <button
                  onClick={bulkImportWallets}
                  disabled={importing || !bulkImportText.trim()}
                  className="w-full rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
                >
                  {importing ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      导入中
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <Upload className="h-4 w-4" />
                      批量导入
                    </span>
                  )}
                </button>
              </div>
            </div>
          </section>
        </div>

        <section className="bg-bg-card rounded-2xl border border-border p-5">
          <div className="mb-4">
            <h3 className="panel-title text-base font-semibold text-text-primary">聪明钱命中结果</h3>
            <p className="text-xs text-text-muted">这里展示后端概览接口返回的命中代币，不再依赖前端推导来源。</p>
          </div>
          <div className="space-y-2">
            {trackedTokens.length === 0 ? (
              <EmptyState icon={Brain} title="暂无命中币种" description="后端一旦识别到聪明钱地址持仓，命中结果会直接出现在这里。" />
            ) : (
              trackedTokens.map(hit => (
                <button
                  key={hit.address}
                  onClick={() => void openTokenDetails(hit)}
                  disabled={openingAddress === hit.address}
                  className="w-full rounded-2xl border border-border px-4 py-3 text-left transition-colors hover:bg-bg-card-hover disabled:opacity-80"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary">{hit.symbol}</p>
                      <p className="truncate text-[11px] text-text-muted">{hit.name}</p>
                    </div>
                    <span className="rounded-full bg-accent/10 px-2 py-1 text-[10px] text-accent">
                      {hit.smartMoneyBuyers} 钱包/KOL
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-[11px] text-text-secondary">
                    <ValueBlock label="评分" value={hit.screeningScore.toFixed(0)} />
                    <ValueBlock label="流动性" value={formatUSD(hit.liquidityUsd)} />
                    <ValueBlock label="1h" value={formatPct(hit.priceChange1h)} tone={hit.priceChange1h >= 0 ? 'positive' : 'negative'} />
                    <ValueBlock
                      label="状态"
                      value={openingAddress === hit.address ? '读取中' : formatTimestamp(hit.lastUpdated)}
                    />
                  </div>
                </button>
              ))
            )}
          </div>
        </section>
      </section>

      <section className="bg-bg-card rounded-2xl border border-border p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="panel-title text-base font-semibold text-text-primary">追踪钱包表</h3>
            <p className="text-xs text-text-muted">当前视图直接映射后端 `smart_money_wallets` 表，支持来源过滤、文本搜索和删除。</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                value={walletQuery}
                onChange={event => setWalletQuery(event.target.value)}
                placeholder="搜地址、标签或备注"
                className="w-full rounded-xl border border-border bg-bg-primary py-2.5 pl-9 pr-3 text-sm text-text-primary outline-none focus:border-primary sm:w-56"
              />
            </label>
            <label className="relative">
              <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <select
                value={walletFilter}
                onChange={event => setWalletFilter(event.target.value as SmartMoneySource | 'all')}
                className="w-full rounded-xl border border-border bg-bg-primary py-2.5 pl-9 pr-3 text-sm text-text-primary outline-none focus:border-primary sm:w-44"
              >
                <option value="all">全部来源</option>
                {SMART_MONEY_SOURCE_OPTIONS.map(source => (
                  <option key={source.id} value={source.id}>{source.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center">
            <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-text-muted">钱包表加载中</p>
          </div>
        ) : filteredWallets.length === 0 ? (
          <EmptyState icon={Wallet} title="当前筛选下没有钱包" description="切换来源过滤器，或者先在上方新增 / 导入追踪钱包。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-text-muted">
                  <th className="px-3 py-3 text-left font-medium">来源</th>
                  <th className="px-3 py-3 text-left font-medium">地址 / 标签</th>
                  <th className="px-3 py-3 text-left font-medium">备注</th>
                  <th className="px-3 py-3 text-right font-medium">胜率</th>
                  <th className="px-3 py-3 text-right font-medium">平均 ROI</th>
                  <th className="px-3 py-3 text-right font-medium">交易数</th>
                  <th className="px-3 py-3 text-right font-medium">录入时间</th>
                  <th className="px-3 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filteredWallets.map(wallet => (
                  <WalletRow key={wallet.address} wallet={wallet} onDelete={removeWallet} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedToken && (
        <TokenDetailModal token={selectedToken} onClose={() => setSelectedToken(null)} />
      )}
    </div>
  );
}

function WalletRow({
  wallet,
  onDelete,
}: {
  wallet: SmartMoneyWalletRecord;
  onDelete: (address: string) => Promise<void>;
}) {
  return (
    <tr className="transition-colors hover:bg-bg-card-hover">
      <td className="px-3 py-3">
        <span className="rounded-full bg-bg-primary px-2 py-1 text-[10px] text-text-secondary">
          {getSmartMoneySourceName(wallet.source)}
        </span>
      </td>
      <td className="px-3 py-3">
        <div>
          <p className="font-medium text-text-primary">{wallet.label}</p>
          <p className="text-[11px] font-mono text-text-muted">{wallet.address}</p>
        </div>
      </td>
      <td className="max-w-[280px] px-3 py-3 text-xs leading-5 text-text-secondary">
        {wallet.notes || '—'}
      </td>
      <td className="px-3 py-3 text-right text-text-secondary">{wallet.winRate.toFixed(1)}%</td>
      <td className={cn('px-3 py-3 text-right', wallet.avgROI >= 0 ? 'text-success' : 'text-danger')}>
        {formatPct(wallet.avgROI)}
      </td>
      <td className="px-3 py-3 text-right text-text-secondary">{wallet.totalTrades}</td>
      <td className="px-3 py-3 text-right text-text-secondary">
        {wallet.addedAt ? formatTimestamp(wallet.addedAt) : '—'}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-2">
          <a
            href={`https://solscan.io/account/${wallet.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-primary hover:text-accent"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <button
            onClick={() => void onDelete(wallet.address)}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-bg-primary/60 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">{label}</p>
      <p className="panel-title mt-2 text-xl font-semibold text-text-primary">{value}</p>
      <p className="mt-1 text-[11px] text-text-muted">{hint}</p>
    </div>
  );
}

function ValueBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div>
      <p className="text-text-muted">{label}</p>
      <p
        className={cn(
          'mt-1 font-medium',
          tone === 'positive' ? 'text-success' : tone === 'negative' ? 'text-danger' : 'text-text-primary'
        )}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Brain;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-bg-primary/40 px-5 py-10 text-center">
      <Icon className="mx-auto h-5 w-5 text-text-muted" />
      <p className="mt-3 text-sm font-medium text-text-primary">{title}</p>
      <p className="mt-1 text-xs leading-5 text-text-muted">{description}</p>
    </div>
  );
}
