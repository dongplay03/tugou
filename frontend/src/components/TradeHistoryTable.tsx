import { History, ArrowUpRight, ArrowDownRight, Shield, AlertTriangle, Clock, Hand, Layers, Radar, Wallet } from 'lucide-react';
import type { Trade } from '../types';
import { formatChain, formatSOL, formatPct, formatRugRiskLevel, formatStrategy, formatTimestamp, rugRiskTone, shortenAddress, cn } from '../utils';

interface Props {
  trades: Trade[];
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  'open': { label: '持仓中', color: 'text-primary', icon: ArrowUpRight },
  'closed-tp': { label: '止盈', color: 'text-success', icon: ArrowUpRight },
  'closed-sl': { label: '止损', color: 'text-danger', icon: ArrowDownRight },
  'closed-rug': { label: 'Rug', color: 'text-danger', icon: AlertTriangle },
  'closed-manual': { label: '手动', color: 'text-warning', icon: Hand },
  'closed-time': { label: '超时', color: 'text-text-muted', icon: Clock },
};

export default function TradeHistoryTable({ trades }: Props) {
  const openTrades = trades
    .filter(trade => trade.status === 'open')
    .sort((a, b) => b.entryTimestamp - a.entryTimestamp);
  const closedTrades = trades
    .filter(trade => trade.status !== 'open')
    .sort((a, b) => (b.exitTimestamp || b.entryTimestamp) - (a.exitTimestamp || a.entryTimestamp));

  if (openTrades.length === 0 && closedTrades.length === 0) {
    return (
      <section className="bg-bg-card rounded-xl border border-border p-8 text-center">
        <History className="w-8 h-8 text-text-muted mx-auto mb-2" />
        <p className="text-sm text-text-muted">暂无交易历史</p>
        <p className="text-xs text-text-muted mt-1">系统开始交易后，持仓中和已平仓记录都会显示在这里</p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-primary/20 bg-[linear-gradient(180deg,rgba(255,184,77,0.08),rgba(17,22,31,0.9))]">
        <div className="flex items-center justify-between border-b border-primary/15 px-4 py-3">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Radar className="w-4 h-4 text-primary" />
            在场持仓 ({openTrades.length})
          </h3>
          <span className="rounded-full bg-primary/12 px-2.5 py-1 text-[10px] text-primary">开仓后立即显示</span>
        </div>

        {openTrades.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-text-primary">当前没有持仓中的交易</p>
            <p className="mt-1 text-xs text-text-muted">新的开仓单会优先显示在这里。</p>
          </div>
        ) : (
          <div className="grid gap-3 p-4 lg:grid-cols-2">
            {openTrades.map(trade => {
              const roiColor = trade.currentRoi >= 0 ? 'text-success' : 'text-danger';
              const pnlColor = trade.unrealizedPnlSOL >= 0 ? 'text-success' : 'text-danger';
              const currentMultiple = trade.entryPriceUsd > 0 ? trade.currentPriceUsd / trade.entryPriceUsd : 1;

              return (
                <article key={trade.id} className="rounded-2xl border border-border/70 bg-bg-card/85 p-4 shadow-[0_14px_40px_rgba(0,0,0,0.18)]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-base font-semibold text-text-primary">{trade.tokenSymbol}</p>
                        <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-text-muted">{formatChain(trade.chainId)}</span>
                        <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] text-primary">持仓中</span>
                        <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', rugRiskTone(trade.rugRiskLevel))}>
                          Rug {formatRugRiskLevel(trade.rugRiskLevel)} {trade.rugRiskScore}
                        </span>
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[10px]',
                          trade.screeningScore >= 70 ? 'bg-success/15 text-success' :
                          trade.screeningScore >= 50 ? 'bg-warning/15 text-warning' :
                          'bg-text-muted/15 text-text-muted'
                        )}>
                          {trade.screeningScore.toFixed(0)} 分
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-text-muted">{shortenAddress(trade.tokenAddress)} · {formatStrategy(trade.experimentStrategy)} · 买入于 {formatTimestamp(trade.entryTimestamp)}</p>
                    </div>
                    <div className="text-right">
                      <p className={cn('text-lg font-semibold', roiColor)}>{formatPct(trade.currentRoi)}</p>
                      <p className={cn('text-xs', pnlColor)}>
                        {trade.unrealizedPnlSOL >= 0 ? '+' : ''}{formatSOL(trade.unrealizedPnlSOL)} SOL
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Metric label="买入价格" value={trade.entryPriceUsd > 0 ? `$${trade.entryPriceUsd.toFixed(8)}` : '—'} />
                    <Metric label="当前价格" value={trade.currentPriceUsd > 0 ? `$${trade.currentPriceUsd.toFixed(8)}` : '—'} />
                    <Metric label="初始仓位" value={`${formatSOL(trade.initialAmountSOL || trade.amountSOL)} SOL`} />
                    <Metric label="当前仓位" value={`${formatSOL(trade.amountSOL)} SOL`} />
                  </div>

                  <PricePositionBar
                    stopLoss={trade.stopLossMultiplier}
                    current={currentMultiple}
                    takeProfit={trade.takeProfitMultiplier}
                  />

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                    {trade.tieredExits && trade.tieredExits.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-bg-primary px-2.5 py-1">
                        <Layers className="w-3 h-3 text-primary" />
                        {trade.tieredExitsExecuted}/{trade.tieredExits.length} 阶已执行
                      </span>
                    )}
                    {trade.principalRecovered && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-success">
                        <Shield className="w-3 h-3" />
                        已回本
                      </span>
                    )}
                    {trade.totalRecoveredSOL > 0 && (
                      <span className="rounded-full bg-success/10 px-2.5 py-1 text-success">
                        已收回 {formatSOL(trade.totalRecoveredSOL, 2)} SOL
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="bg-bg-card rounded-2xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Wallet className="w-4 h-4 text-text-secondary" />
            已平仓历史 ({closedTrades.length})
          </h3>
          <span className="text-[11px] text-text-muted">按最近平仓时间排序</span>
        </div>

        {closedTrades.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-text-primary">当前还没有已平仓记录</p>
            <p className="mt-1 text-xs text-text-muted">平仓后的交易会沉淀到这里。</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-text-muted border-b border-border">
                  <th className="text-left px-4 py-2.5 font-medium">代币</th>
                  <th className="text-left px-4 py-2.5 font-medium">策略</th>
                  <th className="text-center px-4 py-2.5 font-medium">Rug风险</th>
                  <th className="text-right px-4 py-2.5 font-medium">买入</th>
                  <th className="text-right px-4 py-2.5 font-medium">平仓仓位</th>
                  <th className="text-right px-4 py-2.5 font-medium">ROI</th>
                  <th className="text-right px-4 py-2.5 font-medium">已实现盈亏</th>
                  <th className="text-center px-4 py-2.5 font-medium">阶梯止盈</th>
                  <th className="text-center px-4 py-2.5 font-medium">状态</th>
                  <th className="text-center px-4 py-2.5 font-medium">评分</th>
                  <th className="text-right px-4 py-2.5 font-medium">买入时间</th>
                  <th className="text-right px-4 py-2.5 font-medium">平仓时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {closedTrades.map(trade => {
                  const roi = trade.roi ?? 0;
                  const roiColor = roi >= 0 ? 'text-success' : 'text-danger';
                  const pnl = trade.realizedPnlSOL;
                  const statusInfo = STATUS_MAP[trade.status] || STATUS_MAP['closed-manual'];
                  const StatusIcon = statusInfo.icon;

                  return (
                    <tr key={trade.id} className="hover:bg-bg-card-hover transition-colors">
                      <td className="px-4 py-2.5">
                        <div>
                          <p className="font-medium text-text-primary">{trade.tokenSymbol}</p>
                          <p className="text-xs text-text-muted">{formatChain(trade.chainId)} · {shortenAddress(trade.tokenAddress)}</p>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-text-secondary">
                        {formatStrategy(trade.experimentStrategy)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px]', rugRiskTone(trade.rugRiskLevel))}>
                          {formatRugRiskLevel(trade.rugRiskLevel)} {trade.rugRiskScore}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-text-secondary">
                        <p>{trade.entryPriceUsd > 0 ? `$${trade.entryPriceUsd.toFixed(8)}` : '—'}</p>
                        <p className="text-xs text-text-muted">{formatSOL(trade.initialAmountSOL || trade.amountSOL)} SOL</p>
                      </td>
                      <td className="px-4 py-2.5 text-right text-text-secondary">
                        {formatSOL(trade.amountSOL)} SOL
                      </td>
                      <td className={cn('px-4 py-2.5 text-right font-semibold', roiColor)}>
                        {formatPct(roi)}
                      </td>
                      <td className={cn('px-4 py-2.5 text-right', pnl >= 0 ? 'text-success' : 'text-danger')}>
                        {pnl >= 0 ? '+' : ''}{formatSOL(pnl)} SOL
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {trade.tieredExits && trade.tieredExits.length > 0 ? (
                          <div className="inline-flex items-center gap-1">
                            <Layers className="w-3 h-3 text-primary" />
                            <span className="text-[10px] font-medium text-text-primary">
                              {trade.tieredExitsExecuted}/{trade.tieredExits.length}
                            </span>
                            {trade.totalRecoveredSOL > 0 && (
                              <span className="text-[10px] text-success ml-0.5">
                                +{formatSOL(trade.totalRecoveredSOL, 2)}
                              </span>
                            )}
                          </div>
                        ) : trade.principalRecovered ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-success/15 text-success rounded-full">
                            <Shield className="w-3 h-3" />
                            ✓
                          </span>
                        ) : (
                          <span className="text-text-muted text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={cn('inline-flex items-center gap-1 text-xs', statusInfo.color)}>
                          <StatusIcon className="w-3 h-3" />
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={cn(
                          'text-xs font-medium px-1.5 py-0.5 rounded',
                          trade.screeningScore >= 70 ? 'bg-success/15 text-success' :
                          trade.screeningScore >= 50 ? 'bg-warning/15 text-warning' :
                          'bg-text-muted/15 text-text-muted'
                        )}>
                          {trade.screeningScore.toFixed(0)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-text-muted">
                        {formatTimestamp(trade.entryTimestamp)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-text-muted">
                        {trade.exitTimestamp ? formatTimestamp(trade.exitTimestamp) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-bg-primary/60 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-text-muted">{label}</p>
      <p className="mt-1 text-sm font-medium text-text-primary">{value}</p>
    </div>
  );
}

function PricePositionBar({
  stopLoss,
  current,
  takeProfit,
}: {
  stopLoss: number;
  current: number;
  takeProfit: number;
}) {
  const min = Math.min(stopLoss, 1);
  const max = Math.max(takeProfit, 1);
  const range = Math.max(max - min, 0.0001);
  const currentPct = clampPercent(((current - min) / range) * 100);
  const entryPct = clampPercent(((1 - min) / range) * 100);
  const stopPct = clampPercent(((stopLoss - min) / range) * 100);
  const takeProfitPct = clampPercent(((takeProfit - min) / range) * 100);

  return (
    <div className="mt-4 rounded-2xl border border-border/60 bg-bg-primary/50 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">止盈 / 止损位置</p>
        <p className="text-xs text-text-secondary">当前 {current.toFixed(2)}x</p>
      </div>

      <div className="relative mt-3 h-2 rounded-full bg-bg-secondary">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-danger/25"
          style={{ width: `${Math.max(stopPct, entryPct)}%` }}
        />
        <div
          className="absolute inset-y-0 rounded-full bg-success/20"
          style={{ left: `${Math.min(entryPct, takeProfitPct)}%`, width: `${Math.abs(takeProfitPct - entryPct)}%` }}
        />
        <div className="absolute inset-y-0 left-0 right-0 rounded-full border border-white/5" />

        <Marker position={stopPct} color="bg-danger" label="SL" />
        <Marker position={entryPct} color="bg-primary" label="入场" />
        <Marker position={takeProfitPct} color="bg-success" label="TP" />
        <div
          className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-bg-card bg-primary shadow-[0_0_18px_rgba(255,184,77,0.45)]"
          style={{ left: `calc(${currentPct}% - 8px)` }}
          aria-hidden="true"
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-text-muted">
        <PositionMeta label="止损" value={`${stopLoss.toFixed(2)}x`} tone="text-danger" />
        <PositionMeta label="入场" value="1.00x" tone="text-primary" />
        <PositionMeta label="止盈" value={`${takeProfit.toFixed(2)}x`} tone="text-success" />
      </div>
    </div>
  );
}

function Marker({ position, color, label }: { position: number; color: string; label: string }) {
  return (
    <div className="absolute top-1/2 -translate-y-1/2" style={{ left: `calc(${position}% - 1px)` }}>
      <div className={cn('h-4 w-0.5 rounded-full', color)} />
      <span className="absolute top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] text-text-muted">{label}</span>
    </div>
  );
}

function PositionMeta({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <p>{label}</p>
      <p className={cn('mt-1 font-medium', tone)}>{value}</p>
    </div>
  );
}

function clampPercent(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}
