import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Brain,
  ExternalLink,
  LoaderCircle,
  Lock,
  MessageCircle,
  Radar,
  Search,
  TrendingUp,
} from 'lucide-react';
import type { ChainId, TokenData } from '../types';
import { API_URL } from '../config';
import TokenDetailModal from './TokenDetailModal';
import { cn, formatChain, formatPct, formatRugRiskLevel, formatStrategy, formatTimestamp, formatUSD, rugRiskTone, shortenAddress } from '../utils';

interface Props {
  tokens: TokenData[];
  chainId: ChainId;
}

export default function TokenDiscovery({ tokens, chainId }: Props) {
  const [query, setQuery] = useState('');
  const [remoteResults, setRemoteResults] = useState<TokenData[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedToken, setSelectedToken] = useState<TokenData | null>(null);
  const trimmedQuery = query.trim();
  const deferredQuery = useDeferredValue(trimmedQuery);

  useEffect(() => {
    setQuery('');
    setRemoteResults([]);
    setIsSearching(false);
    setSelectedToken(null);
  }, [chainId]);

  const localResults = useMemo(() => {
    if (!deferredQuery) return tokens.slice(0, 14);
    const keyword = deferredQuery.toLowerCase();
    return tokens.filter(token => (
      token.symbol.toLowerCase().includes(keyword) ||
      token.name.toLowerCase().includes(keyword) ||
      token.address.toLowerCase().includes(keyword)
    )).slice(0, 18);
  }, [deferredQuery, tokens]);

  useEffect(() => {
    if (deferredQuery.length < 2) {
      startTransition(() => setRemoteResults([]));
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(
          `${API_URL}/tokens/search?q=${encodeURIComponent(deferredQuery)}&limit=24&chain=${chainId}`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error(`Token search failed: ${response.status}`);
        }
        const results = await response.json() as TokenData[];
        if (!controller.signal.aborted) {
          startTransition(() => setRemoteResults(results));
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('[TokenDiscovery] Search failed:', error);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 150);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [chainId, deferredQuery]);

  const recent = deferredQuery.length >= 2
    ? (remoteResults.length > 0 ? remoteResults : localResults)
    : tokens.slice(0, 14);

  if (tokens.length === 0 && !trimmedQuery) {
    return (
      <section className="bg-bg-card rounded-2xl border border-border p-8 text-center">
        <Radar className="w-8 h-8 text-text-muted mx-auto mb-2" />
        <p className="text-sm text-text-muted">正在扫描链上代币</p>
        <p className="text-xs text-text-muted mt-1">发现的代币会在这里形成实时列表。</p>
      </section>
    );
  }

  return (
    <>
      <section className="bg-bg-card terminal-panel rounded-2xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border/70 flex items-center justify-between gap-4">
          <div>
            <h3 className="panel-title text-sm font-semibold text-text-primary flex items-center gap-2">
              <Radar className="w-4 h-4 text-accent" />
              {formatChain(chainId)} 最新发现
            </h3>
            <p className="mt-1 text-[11px] text-text-muted">只看当前链的本地发现与搜索结果。点击任一代币查看策略命中、Rug 分和入场依据。</p>
          </div>
          <span className="rounded-full bg-bg-primary px-2 py-1 text-[10px] text-text-muted">
            {trimmedQuery ? `结果 ${recent.length}` : `最近 ${tokens.length} 个`}
          </span>
        </div>

        <div className="px-4 py-3 border-b border-border/70 bg-bg-secondary/40">
          <label className="relative flex items-center">
            <Search className="w-4 h-4 text-text-muted absolute left-3" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={`搜索 ${formatChain(chainId)} 代币符号、名称或地址`}
              className="w-full rounded-xl border border-border bg-bg-primary pl-10 pr-10 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
            />
            {isSearching && (
              <LoaderCircle className="w-4 h-4 text-primary animate-spin absolute right-3" />
            )}
          </label>
        </div>

        {recent.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-text-muted">没有匹配的币种</p>
            <p className="text-xs text-text-muted mt-1">换一个符号、名称或地址片段试试。</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {recent.map(token => (
              <div
                key={`${token.chainId}:${token.address}`}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedToken(token)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedToken(token);
                  }
                }}
                className="px-4 py-3 hover:bg-bg-card-hover transition-colors cursor-pointer focus:outline-none focus:bg-bg-card-hover"
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0 xl:w-[320px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-text-primary">{token.symbol}</p>
                      <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-text-muted">
                        {formatChain(token.chainId)}
                      </span>
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
                        {formatStrategy(token.experimentStrategy)}
                      </span>
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', rugRiskTone(token.rugRiskLevel))}>
                        Rug {formatRugRiskLevel(token.rugRiskLevel)} {token.rugRiskScore}
                      </span>
                      {token.eligible && (
                        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] text-success">合格</span>
                      )}
                      {token.momentumConfirmed && (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">动量确认</span>
                      )}
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10px]',
                        token.screeningScore >= 70 ? 'bg-success/15 text-success' :
                        token.screeningScore >= 45 ? 'bg-warning/15 text-warning' :
                        'bg-text-muted/15 text-text-muted'
                      )}>
                        {token.screeningScore.toFixed(0)} 分
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-text-muted truncate">{token.name}</p>
                    <p className="mt-1 text-[11px] font-mono text-text-muted">{shortenAddress(token.address, 6)}</p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-5 gap-3 flex-1">
                    <Metric label="价格" value={formatUSD(token.priceUsd)} />
                    <Metric label="流动性" value={formatUSD(token.liquidityUsd)} />
                    <Metric label="市值" value={formatUSD(token.marketCap)} />
                    <Metric label="1h" value={formatPct(token.priceChange1h)} tone={token.priceChange1h >= 0 ? 'positive' : 'negative'} />
                    <Metric label="更新时间" value={formatTimestamp(token.lastUpdated)} />
                  </div>

                  <div className="flex items-center gap-2 flex-wrap xl:w-[250px] xl:justify-end">
                    <Tag label="Mint" tone={token.mintAuthorityRevoked === true ? 'positive' : token.mintAuthorityRevoked === false ? 'negative' : 'muted'} />
                    <Tag label="Freeze" tone={token.freezeAuthorityRevoked === true ? 'positive' : token.freezeAuthorityRevoked === false ? 'negative' : 'muted'} />
                    {token.lpLocked && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-[10px] text-success">
                        <Lock className="w-3 h-3" />
                        LP
                      </span>
                    )}
                    {token.smartMoneyBuyers > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-1 text-[10px] text-accent">
                        <Brain className="w-3 h-3" />
                        {token.smartMoneyBuyers}
                      </span>
                    )}
                    {token.socialMentions > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] text-primary">
                        <MessageCircle className="w-3 h-3" />
                        {token.socialMentions}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-text-muted xl:order-first">点击查看策略命中</span>
                    <a
                      href={`https://dexscreener.com/solana/${token.pairAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={event => event.stopPropagation()}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] text-text-muted hover:text-accent hover:border-accent/30 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      查看
                    </a>
                  </div>
                </div>

                {(token.top10HolderPct !== null || (token.creatorRugCount ?? 0) > 0 || token.creatorRugProbability !== null) && (
                  <div className="mt-3 flex items-center gap-3 text-[11px] text-text-muted">
                    {token.top10HolderPct !== null && (
                      <span className={token.top10HolderPct < 40 ? 'text-success' : 'text-danger'}>
                        Top10 持仓 {token.top10HolderPct.toFixed(1)}%
                      </span>
                    )}
                    {(token.creatorRugCount ?? 0) > 0 && (
                      <span className="text-danger">创建者 Rug × {token.creatorRugCount}</span>
                    )}
                    {token.creatorRugProbability !== null && (
                      <span className={token.creatorRugProbability >= 0.55 ? 'text-danger' : token.creatorRugProbability >= 0.35 ? 'text-warning' : 'text-success'}>
                        Creator Rug Probability: {(token.creatorRugProbability * 100).toFixed(0)}%
                      </span>
                    )}
                    {token.momentumConfirmed && (
                      <span className="inline-flex items-center gap-1 text-success">
                        <TrendingUp className="w-3 h-3" />
                        进入确认阶段
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <TokenDetailModal token={selectedToken} onClose={() => setSelectedToken(null)} />
    </>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div className="rounded-xl bg-bg-primary/60 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-text-muted">{label}</p>
      <p className={cn(
        'mt-1 text-xs font-medium',
        tone === 'positive' ? 'text-success' : tone === 'negative' ? 'text-danger' : 'text-text-primary'
      )}>
        {value}
      </p>
    </div>
  );
}

function Tag({
  label,
  tone,
}: {
  label: string;
  tone: 'positive' | 'negative' | 'muted';
}) {
  return (
    <span className={cn(
      'rounded-full px-2 py-1 text-[10px]',
      tone === 'positive' ? 'bg-success/10 text-success' :
      tone === 'negative' ? 'bg-danger/10 text-danger' :
      'bg-text-muted/10 text-text-muted'
    )}>
      {label}
    </span>
  );
}
