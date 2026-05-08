// ===== Trade History Page — wraps existing TradeHistoryTable + stats =====
import { lazy, Suspense } from 'react';
import { History, TrendingUp, TrendingDown, BarChart3, Award } from 'lucide-react';
import type { Trade } from '../types';
import { formatSOL, formatPct, cn } from '../utils';
import PanelSkeleton from './PanelSkeleton';

const TradeHistoryTable = lazy(() => import('./TradeHistoryTable'));

interface Props {
  trades: Trade[];
}

export default function TradeHistoryPage({ trades }: Props) {
  const open = trades.filter(t => t.status === 'open');
  const closed = trades.filter(t => t.status !== 'open');
  const wins = closed.filter(t => (t.roi ?? 0) > 0);
  const losses = closed.filter(t => (t.roi ?? 0) <= 0);
  const totalPnl = closed.reduce((sum, t) => sum + t.realizedPnlSOL, 0);
  const avgRoi = closed.length > 0 ? closed.reduce((sum, t) => sum + (t.roi ?? 0), 0) / closed.length : 0;
  const bestTrade = closed.length > 0 ? closed.reduce((a, b) => (a.roi ?? 0) > (b.roi ?? 0) ? a : b) : null;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatBox label="总交易" value={String(trades.length)} icon={History} />
        <StatBox label="持仓中" value={String(open.length)} icon={TrendingUp} color={open.length > 0 ? 'text-primary' : undefined} />
        <StatBox label="胜率" value={closed.length > 0 ? `${(wins.length / closed.length * 100).toFixed(0)}%` : '—'} icon={BarChart3} color={wins.length > losses.length ? 'text-success' : 'text-danger'} />
        <StatBox label="总盈亏" value={`${totalPnl >= 0 ? '+' : ''}${formatSOL(totalPnl)} SOL`} icon={totalPnl >= 0 ? TrendingUp : TrendingDown} color={totalPnl >= 0 ? 'text-success' : 'text-danger'} />
        <StatBox label="平均ROI" value={formatPct(avgRoi)} icon={BarChart3} color={avgRoi >= 0 ? 'text-success' : 'text-danger'} />
        <StatBox label="最佳交易" value={bestTrade ? `${bestTrade.tokenSymbol} ${formatPct(bestTrade.roi ?? 0)}` : '—'} icon={Award} color="text-success" />
      </div>

      {/* Table */}
      <Suspense fallback={<PanelSkeleton title="交易历史" rows={5} />}>
        <TradeHistoryTable trades={trades} />
      </Suspense>
    </div>
  );
}

function StatBox({ label, value, icon: Icon, color }: { label: string; value: string; icon: typeof History; color?: string }) {
  return (
    <div className="bg-bg-card rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn('w-3.5 h-3.5', color || 'text-text-muted')} />
        <span className="text-[11px] text-text-muted">{label}</span>
      </div>
      <p className={cn('text-sm font-bold truncate', color || 'text-text-primary')}>{value}</p>
    </div>
  );
}
