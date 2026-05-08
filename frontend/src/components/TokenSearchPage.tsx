// ===== Token Search Page — DexScreener-style search for Solana tokens =====
import { useMemo, useState, useCallback, useRef } from 'react';
import { Search, Loader2, ExternalLink, ChevronDown } from 'lucide-react';
import { API_URL } from '../config';
import { formatUSD, formatPct, cn, formatChain } from '../utils';
import type { ChainId, DexSearchPair, TokenData } from '../types';
import TokenDetailModal from './TokenDetailModal';

type SortKey = 'liquidity' | 'volume' | 'priceChange' | 'marketCap' | 'createdAt';

export default function TokenSearchPage({ localTokens }: { localTokens: TokenData[] }) {
  const [query, setQuery] = useState('');
  const [chainId] = useState<ChainId>('solana');
  const [results, setResults] = useState<DexSearchPair[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('liquidity');
  const [selectedPair, setSelectedPair] = useState<DexSearchPair | null>(null);
  const [selectedLocal, setSelectedLocal] = useState<TokenData | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const renderedAt = useState(() => Date.now())[0];

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/dex/search?q=${encodeURIComponent(q)}&chain=${chainId}`);
      if (res.ok) {
        const data = await res.json();
        setResults((Array.isArray(data) ? data : data.pairs || []) as DexSearchPair[]);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [chainId]);

  const handleInput = (val: string) => {
    setQuery(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val.trim()), 300);
  };

  const sorted = useMemo(() => [...results].sort((a, b) => {
    switch (sortBy) {
      case 'liquidity': return (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0);
      case 'volume': return (b.volume?.h24 || 0) - (a.volume?.h24 || 0);
      case 'priceChange': return (b.priceChange?.h1 || 0) - (a.priceChange?.h1 || 0);
      case 'marketCap': return (b.fdv || 0) - (a.fdv || 0);
      case 'createdAt': return (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0);
      default: return 0;
    }
  }), [results, sortBy]);

  const openDetail = (pair: DexSearchPair) => {
    const local = localTokens.find(t => t.chainId === pair.chainId && t.address === pair.baseToken?.address);
    if (local) {
      setSelectedLocal(local);
      setSelectedPair(pair);
    } else {
      setSelectedLocal(null);
      setSelectedPair(pair);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search header */}
      <div className="bg-bg-card terminal-panel rounded-2xl border border-border p-4">
        <div className="flex items-center gap-3 mb-3">
          <Search className="w-5 h-5 text-primary" />
          <h2 className="panel-title text-base font-bold text-text-primary">Solana 代币搜索</h2>
          <span className="text-xs text-text-muted ml-auto">数据来自 DexScreener · 当前 {formatChain(chainId)}</span>
        </div>
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={e => handleInput(e.target.value)}
              placeholder={`输入 ${formatChain(chainId)} 代币名称、符号或合约地址...`}
              className="w-full bg-bg-primary border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm text-text-primary focus:border-primary outline-none"
            />
            {loading && <Loader2 className="w-4 h-4 text-primary animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
          </div>

          <div className="relative">
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortKey)}
              className="appearance-none bg-bg-primary border border-border rounded-lg px-3 py-2.5 text-sm text-text-secondary pr-8 focus:border-primary outline-none cursor-pointer"
            >
              <option value="liquidity">流动性排序</option>
              <option value="volume">成交量排序</option>
              <option value="priceChange">涨幅排序</option>
              <option value="marketCap">市值排序</option>
              <option value="createdAt">最新排序</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-text-muted absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Results */}
      {sorted.length > 0 ? (
        <div className="bg-bg-card rounded-2xl border border-border overflow-hidden data-grid">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-text-muted border-b border-border">
                  <th className="text-left px-4 py-3 font-medium">代币</th>
                  <th className="text-right px-3 py-3 font-medium">价格</th>
                  <th className="text-right px-3 py-3 font-medium">5m</th>
                  <th className="text-right px-3 py-3 font-medium">1h</th>
                  <th className="text-right px-3 py-3 font-medium">24h</th>
                  <th className="text-right px-3 py-3 font-medium">流动性</th>
                  <th className="text-right px-3 py-3 font-medium">市值</th>
                  <th className="text-right px-3 py-3 font-medium">24h量</th>
                  <th className="text-right px-3 py-3 font-medium">创建时间</th>
                  <th className="text-center px-3 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {sorted.map((pair) => {
                  const bt = pair.baseToken;
                  const pc = pair.priceChange || {};
                  const age = pair.pairCreatedAt ? ((renderedAt - pair.pairCreatedAt) / 3_600_000) : 0;
                  return (
                    <tr
                      key={pair.pairAddress}
                      className="hover:bg-bg-card-hover transition-colors cursor-pointer"
                      onClick={() => openDetail(pair)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {pair.info?.imageUrl && (
                            <img src={pair.info.imageUrl} alt="" className="w-7 h-7 rounded-full" />
                          )}
                          <div>
                            <p className="font-medium text-text-primary">{bt?.symbol || '?'}</p>
                            <p className="text-[11px] text-text-muted truncate max-w-[140px]">
                              {bt?.name} · {pair.dexId}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-text-secondary">
                        ${parseFloat(pair.priceUsd || '0').toPrecision(4)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <ChangeCell value={pc.m5} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <ChangeCell value={pc.h1} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <ChangeCell value={pc.h24} />
                      </td>
                      <td className="px-3 py-3 text-right text-text-secondary">
                        {formatUSD(pair.liquidity?.usd || 0)}
                      </td>
                      <td className="px-3 py-3 text-right text-text-secondary">
                        {formatUSD(pair.fdv || pair.marketCap || 0)}
                      </td>
                      <td className="px-3 py-3 text-right text-text-secondary">
                        {formatUSD(pair.volume?.h24 || 0)}
                      </td>
                      <td className="px-3 py-3 text-right text-xs text-text-muted">
                        {age > 0 ? (age < 24 ? `${age.toFixed(1)}h` : `${(age / 24).toFixed(0)}d`) : '—'}
                      </td>
                      <td className="px-3 py-3 text-center">
                    <a
                          href={`https://dexscreener.com/solana/${pair.pairAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="inline-flex p-1.5 rounded hover:bg-bg-primary text-text-muted hover:text-accent transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : query.length >= 2 && !loading ? (
        <div className="bg-bg-card rounded-2xl border border-border p-12 text-center">
          <Search className="w-8 h-8 text-text-muted mx-auto mb-3" />
          <p className="text-sm text-text-muted">未找到匹配的代币</p>
          <p className="text-xs text-text-muted mt-1">尝试搜索其他名称或地址</p>
        </div>
      ) : (
        <div className="bg-bg-card rounded-2xl border border-border p-12 text-center">
          <Search className="w-10 h-10 text-text-muted/50 mx-auto mb-3" />
          <p className="text-sm text-text-secondary">搜索任意 {formatChain(chainId)} 代币</p>
          <p className="text-xs text-text-muted mt-1">支持代币名称、符号、合约地址搜索</p>
        </div>
      )}

      {/* Detail Modal */}
      {selectedPair && (
        <TokenDetailModal
          token={selectedLocal}
          dexPair={selectedPair}
          onClose={() => { setSelectedPair(null); setSelectedLocal(null); }}
        />
      )}
    </div>
  );
}

function ChangeCell({ value }: { value?: number }) {
  if (value == null) return <span className="text-text-muted">—</span>;
  return (
    <span className={cn('text-xs font-medium', value >= 0 ? 'text-success' : 'text-danger')}>
      {formatPct(value)}
    </span>
  );
}
