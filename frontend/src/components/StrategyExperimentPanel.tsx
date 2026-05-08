import { FlaskConical, TrendingDown, TrendingUp } from 'lucide-react';
import type { StrategyPerformance } from '../types';
import { cn, formatChain, formatPct, formatSOL, formatStrategy } from '../utils';

interface Props {
  performance: StrategyPerformance[];
}

export default function StrategyExperimentPanel({ performance }: Props) {
  const rows = [...performance]
    .filter(row => row.trades > 0)
    .sort((a, b) => b.totalPnlSOL - a.totalPnlSOL)
    .slice(0, 8);

  return (
    <section className="bg-bg-card terminal-panel rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border/70 flex items-center justify-between">
        <h3 className="panel-title text-sm font-semibold text-text-primary flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-primary" />
          策略实验表现
        </h3>
        <span className="text-[11px] text-text-muted">按链分桶</span>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-text-muted">
          暂无已平仓样本，跑够 30-50 笔后这里会显示策略胜率和 ROI。
        </div>
      ) : (
        <div className="divide-y divide-border/70">
          {rows.map(row => {
            const positive = row.totalPnlSOL >= 0;
            const Icon = positive ? TrendingUp : TrendingDown;
            return (
              <div key={`${row.chainId}-${row.strategy}`} className="px-4 py-3 grid grid-cols-[1fr_auto] gap-3 items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon className={cn('w-3.5 h-3.5', positive ? 'text-success' : 'text-danger')} />
                    <p className="text-sm font-semibold text-text-primary truncate">{formatStrategy(row.strategy)}</p>
                    <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-text-muted">{formatChain(row.chainId)}</span>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    {row.trades} 笔 · {row.wins}胜/{row.losses}负 · 胜率 {formatPct(row.winRate * 100, 0).replace('+', '')}
                  </p>
                </div>
                <div className="text-right">
                  <p className={cn('panel-title text-sm font-semibold', positive ? 'text-success' : 'text-danger')}>
                    {positive ? '+' : ''}{formatSOL(row.totalPnlSOL)} u
                  </p>
                  <p className="text-xs text-text-muted">均值 {formatPct(row.avgROI)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
