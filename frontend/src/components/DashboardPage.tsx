import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpRight,
  DatabaseZap,
  FlaskConical,
  Gauge,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Target,
  Wallet,
} from 'lucide-react';
import type { BackendData } from '../hooks/useSimulation';
import type { ChainId, ChainPortfolioState, ChainTradingRulesView, MarketDataProviderStatus, TokenData, Trade } from '../types';
import { API_URL } from '../config';
import PortfolioDashboard from './PortfolioDashboard';
import PanelSkeleton from './PanelSkeleton';
import { cn, formatChain, formatPct, formatSOL, formatUSD } from '../utils';

const StrategyExperimentPanel = lazy(() => import('./StrategyExperimentPanel'));
const AlertsPanel = lazy(() => import('./AlertsPanel'));
const TokenDiscovery = lazy(() => import('./TokenDiscovery'));

interface Props {
  sim: BackendData;
}

const CHAINS: Array<{
  id: ChainId;
  name: string;
  unit: 'SOL';
  initial: number;
  accent: string;
}> = [
  { id: 'solana', name: 'Solana', unit: 'SOL', initial: 1, accent: 'text-accent' },
];

const FALLBACK_RULES: Record<ChainId, ChainTradingRulesView> = {
  solana: {
    chainId: 'solana',
    label: 'Solana 抢新池',
    unit: 'SOL',
    profile: '低手续费、高发行频率、价格节奏更快，优先抢早期动量但必须更快止盈和 Rug 退出。',
    screening: {
      minScore: 45,
      minLiquidityUsd: 25_000,
      maxRugScore: 55,
      preferredDexes: ['raydium', 'meteora', 'orca', 'pump'],
    },
    exits: { experimentTimeoutHours: 0.5, liquidityRugDropPct: 0.48, priceRugMultiplier: 0.16 },
    ui: {
      buyRules: ['分数 >= 45', '流动性 >= $25K', 'Mint/Freeze、Top10、LP/创建者优先验证'],
      sellRules: ['实验桶 30 分钟无优势就撤', '1.22x 起分批止盈，动量桶保留尾仓', '流动性跌 48% 或价格跌到 0.16x 直接 Rug 退出'],
      riskRules: ['SOL 新池数量多，允许更早入场，但必须小仓和快跑', '重点看权限未放弃、Top10 集中、LP 快速抽走'],
      dataSources: ['DexScreener pairs/profiles', 'Solana RPC authority/holders', 'RugCheck', 'GMGN/AVE 人工或可配置扩展'],
    },
  },
};

const FALLBACK_PROVIDERS: MarketDataProviderStatus[] = [
  {
    id: 'dexscreener',
    label: 'DexScreener',
    mode: 'api',
    enabled: true,
    chains: ['solana'],
    note: 'Public pair/search/profile APIs enabled.',
    docsUrl: 'https://docs.dexscreener.com/api/reference',
  },
  {
    id: 'ave',
    label: 'AVE',
    mode: 'configurable-api',
    enabled: false,
    chains: ['solana'],
    note: 'API 不可用时走 Chrome/搜索兜底：合约风险、Top holders、趋势榜。',
    docsUrl: 'https://docs.ave.ai/reference/api-reference/v2',
    fallbackUrl: 'https://www.google.com/search?q=site%3Aave.ai%20solana%20token%20risk%20holders',
    fallbackNote: '打开 AVE 页面或 Google 站内搜索，避免直接打 API 被限流。',
  },
  {
    id: 'gmgn',
    label: 'GMGN',
    mode: 'search-only',
    enabled: false,
    chains: ['solana'],
    note: '无稳定公开 API 假设；优先打开网页获取热榜、聪明钱、钱包雷达证据。',
    docsUrl: 'https://docs.gmgn.ai/index/wallet-detail-page',
    fallbackUrl: 'https://gmgn.ai/sol/discover',
    fallbackNote: '打开 GMGN Discover/Token/Wallet 页面，人工提取 net buy、top traders、holder 等证据。',
  },
];

function mergeByKey<T>(primary: T[], secondary: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];

  for (const item of [...primary, ...secondary]) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged;
}

export default function DashboardPage({ sim }: Props) {
  const [activeChain, setActiveChain] = useState<ChainId>('solana');
  const [rules, setRules] = useState<Record<ChainId, ChainTradingRulesView>>(FALLBACK_RULES);
  const [providers, setProviders] = useState<MarketDataProviderStatus[]>(FALLBACK_PROVIDERS);
  const [chainTokenCache, setChainTokenCache] = useState<Record<ChainId, TokenData[]>>({ solana: [] });
  const [chainOpenTradeCache, setChainOpenTradeCache] = useState<Record<ChainId, Trade[]>>({ solana: [] });
  const chainMeta = CHAINS.find(chain => chain.id === activeChain) ?? CHAINS[0];
  const activeRules = rules[activeChain] ?? FALLBACK_RULES[activeChain];

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboardMeta() {
      try {
        const [rulesResponse, providersResponse] = await Promise.all([
          fetch(`${API_URL}/chain-rules`, { signal: controller.signal }),
          fetch(`${API_URL}/market-data/providers`, { signal: controller.signal }),
        ]);

        if (rulesResponse.ok) {
          const payload = await rulesResponse.json() as { chains?: ChainTradingRulesView[] };
          if (payload.chains?.length) {
            setRules(payload.chains.reduce((acc, rule) => ({ ...acc, [rule.chainId]: rule }), FALLBACK_RULES));
          }
        }

        if (providersResponse.ok) {
          const payload = await providersResponse.json() as { providers?: MarketDataProviderStatus[] };
          if (payload.providers?.length) setProviders(payload.providers);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('[Dashboard] Failed to load chain rules/providers:', error);
        }
      }
    }

    void loadDashboardMeta();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadChainLists() {
      try {
        const [tokensResponse, tradesResponse] = await Promise.all([
          fetch(`${API_URL}/tokens?chain=${activeChain}&limit=80`, { signal: controller.signal }),
          fetch(`${API_URL}/trades/open?chain=${activeChain}`, { signal: controller.signal }),
        ]);

        if (tokensResponse.ok) {
          const tokens = await tokensResponse.json() as TokenData[];
          if (!controller.signal.aborted) {
            setChainTokenCache(current => ({ ...current, [activeChain]: tokens }));
          }
        }

        if (tradesResponse.ok) {
          const trades = await tradesResponse.json() as Trade[];
          if (!controller.signal.aborted) {
            setChainOpenTradeCache(current => ({ ...current, [activeChain]: trades }));
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error(`[Dashboard] Failed to load ${activeChain} lists:`, error);
        }
      }
    }

    void loadChainLists();
    return () => controller.abort();
  }, [activeChain]);

  const chainPortfolio = useMemo(
    () => sim.portfolio.byChain.find(chain => chain.chainId === activeChain) ?? createEmptyChainPortfolio(activeChain, chainMeta.initial),
    [activeChain, chainMeta.initial, sim.portfolio.byChain],
  );
  const chainOpenTrades = useMemo(
    () => {
      const liveTrades = sim.openTrades.filter(trade => trade.chainId === activeChain);
      return sim.connected ? liveTrades : chainOpenTradeCache[activeChain];
    },
    [activeChain, chainOpenTradeCache, sim.connected, sim.openTrades],
  );
  const chainTokens = useMemo(
    () => mergeByKey(
      sim.recentTokens.filter(token => token.chainId === activeChain),
      chainTokenCache[activeChain],
      token => `${token.chainId}:${token.address}`,
    ),
    [activeChain, chainTokenCache, sim.recentTokens],
  );
  const chainPerformance = useMemo(
    () => sim.strategyPerformance.filter(row => row.chainId === activeChain),
    [activeChain, sim.strategyPerformance],
  );
  const activeProviders = useMemo(
    () => providers.filter(provider => provider.chains.includes(activeChain)),
    [activeChain, providers],
  );

  return (
    <div className="space-y-5">
      {!sim.connected && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3">
          <p className="text-sm text-danger">
            后端未连接。请确认 <code className="rounded bg-bg-card px-2 py-0.5 text-xs">VITE_API_URL</code> 指向当前后端端口。
          </p>
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-border bg-bg-card">
        <div className="border-b border-border/70 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-text-muted">
                <Activity className={cn('h-3.5 w-3.5', sim.status.isTrading ? 'text-success' : 'text-warning')} />
                {sim.status.isTrading ? 'Live Solana paper trading' : 'Paused'}
              </div>
              <h2 className="panel-title mt-2 text-2xl text-text-primary">Solana 土狗控制台</h2>
              <p className="mt-1 max-w-3xl text-sm text-text-secondary">
                当前只启用 Solana：资金、持仓、发现列表和买卖规则都按 SOL 口径计算。
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-4 2xl:w-[620px]">
              <HeaderMetric icon={Wallet} label="总净值" value={`${formatSOL(sim.portfolio.totalValueSOL)} u`} />
              <HeaderMetric icon={Radar} label="观察池" value={`${sim.status.watchPoolSize}`} />
              <HeaderMetric icon={ShieldCheck} label="平仓" value={`${sim.portfolio.closedTrades}`} />
              <HeaderMetric icon={AlertTriangle} label="错误" value={`${sim.status.errors}`} tone={sim.status.errors > 0 ? 'text-danger' : 'text-success'} />
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-[250px_minmax(0,1fr)]">
          <div className="border-b border-border/70 bg-bg-primary/45 p-3 lg:border-b-0 lg:border-r">
            <div className="grid gap-2">
              {CHAINS.map(chain => {
                const p = sim.portfolio.byChain.find(item => item.chainId === chain.id) ?? createEmptyChainPortfolio(chain.id, chain.initial);
                const active = activeChain === chain.id;
                return (
                  <button
                    key={chain.id}
                    onClick={() => setActiveChain(chain.id)}
                    className={cn(
                      'rounded-lg border px-3 py-3 text-left transition-colors',
                      active
                        ? 'border-accent/30 bg-accent/10'
                        : 'border-border/70 bg-bg-card/35 hover:border-primary/25 hover:bg-bg-card-hover',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className={cn('panel-title text-base', active ? chain.accent : 'text-text-primary')}>{chain.name}</p>
                        <p className="mt-0.5 text-[11px] text-text-muted">初始 {chain.initial} {chain.unit}</p>
                      </div>
                      <span className="rounded-md border border-border/70 px-2 py-1 font-mono text-[11px] text-text-muted">{chain.unit}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <MiniMetric label="现金" value={`${formatSOL(p.cashSOL)} ${chain.unit}`} />
                      <MiniMetric label="PnL" value={formatPct(p.cumulativePnlPct)} tone={p.cumulativePnlPct >= 0 ? 'text-success' : 'text-danger'} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-text-muted">Active Chain</p>
                    <h3 className="panel-title mt-1 text-xl text-text-primary">{formatChain(activeChain)} · {activeRules.label}</h3>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs sm:w-[360px]">
                    <ChainKpi label="净值" value={`${formatSOL(chainPortfolio.totalValueSOL)} ${chainMeta.unit}`} />
                    <ChainKpi label="持仓" value={`${chainPortfolio.openPositions}`} />
                    <ChainKpi label="胜率" value={chainPortfolio.closedTrades ? formatPct(chainPortfolio.winRate * 100, 0).replace('+', '') : '-'} />
                  </div>
                </div>

                <p className="mt-3 text-sm leading-6 text-text-secondary">{activeRules.profile}</p>

                <div className="mt-4 grid gap-3 xl:grid-cols-3">
                  <RuleColumn
                    icon={ArrowDownToLine}
                    title="买入过滤"
                    items={activeRules.ui.buyRules}
                    footer={`Score ${activeRules.screening.minScore} · Liq ${formatUSD(activeRules.screening.minLiquidityUsd)}`}
                  />
                  <RuleColumn
                    icon={Target}
                    title="卖出节奏"
                    items={activeRules.ui.sellRules}
                    footer={`Timeout ${(activeRules.exits.experimentTimeoutHours * 60).toFixed(0)}m`}
                  />
                  <RuleColumn
                    icon={ShieldAlert}
                    title="Rug 熔断"
                    items={activeRules.ui.riskRules}
                    footer={`LP -${(activeRules.exits.liquidityRugDropPct * 100).toFixed(0)}% · Price ${activeRules.exits.priceRugMultiplier}x`}
                  />
                </div>
              </div>

              <div className="rounded-lg border border-border/70 bg-bg-primary/45 p-3">
                <div className="flex items-center gap-2">
                  <DatabaseZap className="h-4 w-4 text-accent" />
                  <h3 className="panel-title text-sm text-text-primary">数据源状态</h3>
                </div>
                <div className="mt-3 space-y-2">
                  {activeProviders.map(provider => (
                    <a
                      key={provider.id}
                      href={provider.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-lg border border-border/70 bg-bg-card/35 px-3 py-2 transition-colors hover:border-accent/25 hover:bg-bg-card-hover"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-text-primary">{provider.label}</span>
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[10px]',
                          provider.enabled ? 'bg-success/15 text-success' : 'bg-text-muted/15 text-text-muted',
                        )}>
                          {provider.enabled ? 'API' : provider.mode === 'search-only' ? '搜索入口' : '未配置'}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-text-muted">{provider.note}</p>
                      {provider.fallbackUrl && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                          <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">Chrome 兜底</span>
                          <span className="line-clamp-1 text-text-muted">{provider.fallbackNote || 'API 不通时打开网页/搜索核验。'}</span>
                        </div>
                      )}
                    </a>
                  ))}
                </div>
                <div className="mt-3 rounded-lg border border-border/70 bg-bg-primary/70 px-3 py-2">
                  <p className="text-[11px] text-text-muted">当前优先级</p>
                  <p className="mt-1 text-xs text-text-secondary">{activeRules.ui.dataSources.join(' / ')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.7fr)]">
        <div className="space-y-5">
          <PortfolioDashboard
            portfolio={chainPortfolio}
            unit={chainMeta.unit}
            openTrades={chainOpenTrades}
            onCloseTrade={sim.closeTrade}
          />

          <Suspense fallback={<PanelSkeleton title="代币发现" rows={4} />}>
            <TokenDiscovery key={activeChain} tokens={chainTokens} chainId={activeChain} />
          </Suspense>
        </div>

        <aside className="space-y-5">
          <section className="rounded-xl border border-border bg-bg-card p-4">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-primary" />
              <h3 className="panel-title text-sm text-text-primary">当前参数</h3>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <Param label="最低分数" value={`${activeRules.screening.minScore}`} />
              <Param label="最低流动性" value={formatUSD(activeRules.screening.minLiquidityUsd)} />
              <Param label="Rug 上限" value={`${activeRules.screening.maxRugScore}`} />
            </dl>
          </section>

          <Suspense fallback={<PanelSkeleton title="策略实验" rows={4} />}>
            <StrategyExperimentPanel performance={chainPerformance} />
          </Suspense>

          <Suspense fallback={<PanelSkeleton title="实时警报" rows={3} />}>
            <AlertsPanel alerts={sim.alerts} />
          </Suspense>

          <section className="rounded-xl border border-border bg-bg-card p-4">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-accent" />
              <h3 className="panel-title text-sm text-text-primary">实验口径</h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-text-secondary">
              Solana 偏快进快出：小仓、快跑、Rug 检测优先于普通止损，触发后直接按 Rug 平仓。
            </p>
          </section>
        </aside>
      </section>
    </div>
  );
}

function createEmptyChainPortfolio(chainId: ChainId, initial: number): ChainPortfolioState {
  return {
    chainId,
    totalValueSOL: initial,
    cashSOL: initial,
    openPositions: 0,
    totalTrades: 0,
    closedTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    cumulativePnlSOL: 0,
    cumulativePnlPct: 0,
  };
}

function HeaderMetric({ icon: Icon, label, value, tone = 'text-text-primary' }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-bg-primary/55 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-text-muted">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className={cn('panel-title mt-1 text-base', tone)}>{value}</p>
    </div>
  );
}

function MiniMetric({ label, value, tone = 'text-text-primary' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-[11px] text-text-muted">{label}</p>
      <p className={cn('mt-1 font-mono text-xs font-semibold', tone)}>{value}</p>
    </div>
  );
}

function ChainKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-bg-primary/55 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-text-muted">{label}</p>
      <p className="mt-1 font-mono text-xs font-semibold text-text-primary">{value}</p>
    </div>
  );
}

function RuleColumn({ icon: Icon, title, items, footer }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  items: string[];
  footer: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-bg-primary/50 p-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h4 className="panel-title text-xs text-text-primary">{title}</h4>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map(item => (
          <li key={item} className="flex gap-2 text-xs leading-5 text-text-secondary">
            <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 rounded-md border border-border/70 bg-bg-card/40 px-2 py-1.5 font-mono text-[11px] text-text-muted">{footer}</p>
    </div>
  );
}

function Param({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-bg-primary/55 px-3 py-2">
      <dt className="text-text-muted">{label}</dt>
      <dd className="mt-1 font-mono font-semibold text-text-primary">{value}</dd>
    </div>
  );
}
