// ===== Watchpool Page — tokens being observed before entering trades =====
import { useEffect, useState, useCallback } from 'react';
import { Eye, RefreshCw, Loader2, Brain, Flame } from 'lucide-react';
import { API_URL } from '../config';
import { formatUSD, formatPct, cn, shortenAddress, formatTimestamp } from '../utils';
import type { TokenData } from '../types';
import TokenDetailModal from './TokenDetailModal';

interface WatchpoolEntry {
  address: string;
  symbol: string;
  name: string;
  pairAddress: string;
  addedAt: number;
  observations: number;
  confirmed: boolean;
  priceUsd: number;
  liquidityUsd: number;
  marketCap: number;
  priceChange1h: number;
  priceChange5m: number;
  screeningScore: number;
  eligible: boolean;
  smartMoneyBuyers: number;
  narrativeTags?: string[];
}

export default function WatchpoolPage({ localTokens }: { localTokens: TokenData[] }) {
  const [entries, setEntries] = useState<WatchpoolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<TokenData | null>(null);

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const res = await fetch(`${API_URL}/strategies/watchpool`);
      if (res.ok) {
        const data = await res.json();
        setEntries(Array.isArray(data) ? data : data.entries || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    const load = async () => {
      await fetchData();
    };
    void load();
  }, [fetchData]);

  // Auto-refresh every 15s
  useEffect(() => {
    const timer = setInterval(() => fetchData(), 15_000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const openDetail = (entry: WatchpoolEntry) => {
    const local = localTokens.find(t => t.address === entry.address);
    if (local) setSelected(local);
  };

  return (
    <div className="space-y-4">
      <div className="bg-bg-card terminal-panel rounded-2xl border border-border p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Eye className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-base font-bold text-text-primary">观察池</h2>
            <p className="text-xs text-text-muted">等待动量确认的候选代币</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted">{entries.length} 个代币</span>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="p-2 rounded-lg border border-border hover:bg-bg-primary text-text-muted hover:text-text-primary transition-colors"
          >
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-bg-card rounded-xl border border-border p-12 text-center">
          <Loader2 className="w-6 h-6 text-primary animate-spin mx-auto mb-2" />
          <p className="text-sm text-text-muted">加载中...</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-bg-card rounded-xl border border-border p-12 text-center">
          <Eye className="w-8 h-8 text-text-muted/50 mx-auto mb-3" />
          <p className="text-sm text-text-muted">观察池暂无代币</p>
          <p className="text-xs text-text-muted mt-1">系统发现符合条件的代币后会自动加入观察池</p>
        </div>
      ) : (
        <div className="bg-bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-text-muted border-b border-border">
                  <th className="text-left px-4 py-3 font-medium">代币</th>
                  <th className="text-right px-3 py-3 font-medium">价格</th>
                  <th className="text-right px-3 py-3 font-medium">5m</th>
                  <th className="text-right px-3 py-3 font-medium">1h</th>
                  <th className="text-right px-3 py-3 font-medium">流动性</th>
                  <th className="text-right px-3 py-3 font-medium">市值</th>
                  <th className="text-center px-3 py-3 font-medium">评分</th>
                  <th className="text-center px-3 py-3 font-medium">观察</th>
                  <th className="text-center px-3 py-3 font-medium">状态</th>
                  <th className="text-right px-3 py-3 font-medium">加入时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {entries.map((entry) => (
                  <tr
                    key={entry.address}
                    className="hover:bg-bg-card-hover transition-colors cursor-pointer"
                    onClick={() => openDetail(entry)}
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-text-primary flex items-center gap-1.5">
                          {entry.symbol}
                          {entry.smartMoneyBuyers > 0 && (
                            <span className="inline-flex" aria-label={`${entry.smartMoneyBuyers}只聪明钱在买`}>
                              <Brain className="w-3 h-3 text-accent" />
                            </span>
                          )}
                          {entry.narrativeTags && entry.narrativeTags.length > 0 && (
                            <span className="inline-flex" aria-label={entry.narrativeTags.join(', ')}>
                              <Flame className="w-3 h-3 text-warning" />
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-text-muted truncate max-w-[160px]">
                          {entry.name} · {shortenAddress(entry.address)}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-text-secondary">
                      {formatUSD(entry.priceUsd)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className={cn('text-xs font-medium', entry.priceChange5m >= 0 ? 'text-success' : 'text-danger')}>
                        {formatPct(entry.priceChange5m)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className={cn('text-xs font-medium', entry.priceChange1h >= 0 ? 'text-success' : 'text-danger')}>
                        {formatPct(entry.priceChange1h)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-text-secondary">
                      {formatUSD(entry.liquidityUsd)}
                    </td>
                    <td className="px-3 py-3 text-right text-text-secondary">
                      {formatUSD(entry.marketCap)}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={cn(
                        'text-xs font-medium px-1.5 py-0.5 rounded',
                        entry.screeningScore >= 70 ? 'bg-success/15 text-success' :
                        entry.screeningScore >= 45 ? 'bg-warning/15 text-warning' :
                        'bg-text-muted/15 text-text-muted'
                      )}>
                        {entry.screeningScore.toFixed(0)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-text-secondary">
                      {entry.observations}次
                    </td>
                    <td className="px-3 py-3 text-center">
                      {entry.confirmed ? (
                        <span className="text-[10px] px-1.5 py-0.5 bg-success/15 text-success rounded-full">已确认</span>
                      ) : entry.eligible ? (
                        <span className="text-[10px] px-1.5 py-0.5 bg-primary/15 text-primary rounded-full">合格</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 bg-text-muted/15 text-text-muted rounded-full">观察中</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-xs text-text-muted">
                      {formatTimestamp(entry.addedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <TokenDetailModal token={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
