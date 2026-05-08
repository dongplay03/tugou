import { BarChart3, Layers, Shield, TrendingDown, TrendingUp, Wallet, XCircle } from 'lucide-react';
import type { ChainPortfolioState, Trade } from '../types';
import { cn, formatPct, formatRugRiskLevel, formatSOL, formatStrategy, formatTimestamp, rugRiskTone, shortenAddress } from '../utils';

interface Props {
  portfolio: ChainPortfolioState;
  unit: string;
  openTrades: Trade[];
  onCloseTrade: (tradeId: string) => void;
}

export default function PortfolioDashboard({ portfolio, unit, openTrades, onCloseTrade }: Props) {
  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Wallet} label="账户净值" value={`${formatSOL(portfolio.totalValueSOL)} ${unit}`} sub={`现金 ${formatSOL(portfolio.cashSOL)} ${unit}`} />
        <Stat
          icon={portfolio.cumulativePnlSOL >= 0 ? TrendingUp : TrendingDown}
          label="累计盈亏"
          value={`${portfolio.cumulativePnlSOL >= 0 ? '+' : ''}${formatSOL(portfolio.cumulativePnlSOL)} ${unit}`}
          sub={formatPct(portfolio.cumulativePnlPct)}
          tone={portfolio.cumulativePnlSOL >= 0 ? 'text-success' : 'text-danger'}
        />
        <Stat
          icon={BarChart3}
          label="胜率"
          value={portfolio.closedTrades > 0 ? formatPct(portfolio.winRate * 100, 0).replace('+', '') : '—'}
          sub={`${portfolio.wins}胜 / ${portfolio.losses}负 / ${portfolio.closedTrades}平仓`}
        />
        <Stat icon={Shield} label="持仓" value={`${portfolio.openPositions}`} sub={`累计 ${portfolio.totalTrades} 笔`} />
      </div>

      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <h3 className="panel-title flex items-center gap-2 text-sm text-text-primary">
            <Shield className="h-4 w-4 text-primary" />
            当前持仓
          </h3>
          <span className="text-[11px] text-text-muted">{openTrades.length} 个仓位</span>
        </div>

        {openTrades.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-text-primary">当前链没有持仓</p>
            <p className="mt-1 text-xs text-text-muted">启动交易后，开仓会出现在这里。</p>
          </div>
        ) : (
          <div className="divide-y divide-border/70">
            {openTrades.map(trade => (
              <PositionRow key={trade.id} trade={trade} unit={unit} onCloseTrade={onCloseTrade} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ icon: Icon, label, value, sub, tone = 'text-text-primary' }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-text-muted">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className={cn('panel-title mt-2 text-xl', tone)}>{value}</p>
      <p className="mt-1 text-xs text-text-muted">{sub}</p>
    </div>
  );
}

function PositionRow({ trade, unit, onCloseTrade }: {
  trade: Trade;
  unit: string;
  onCloseTrade: (tradeId: string) => void;
}) {
  const roiColor = trade.currentRoi >= 0 ? 'text-success' : 'text-danger';

  return (
    <div className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-text-primary">{trade.tokenSymbol}</p>
          <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', rugRiskTone(trade.rugRiskLevel))}>
            Rug {formatRugRiskLevel(trade.rugRiskLevel)} {trade.rugRiskScore}
          </span>
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent">{formatStrategy(trade.experimentStrategy)}</span>
          {trade.tieredExitsExecuted > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">
              <Layers className="h-3 w-3" />
              {trade.tieredExitsExecuted}/{trade.tieredExits.length}阶
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-text-muted">
          {shortenAddress(trade.tokenAddress)} · 买入 {formatTimestamp(trade.entryTimestamp)} · ${trade.entryPriceUsd.toFixed(8)}
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 lg:justify-end">
        <div className="text-left lg:text-right">
          <p className={cn('panel-title text-base', roiColor)}>{formatPct(trade.currentRoi)}</p>
          <p className="text-xs text-text-muted">{formatSOL(trade.amountSOL)} {unit}</p>
        </div>
        <button
          onClick={() => onCloseTrade(trade.id)}
          className="rounded-lg p-2 text-text-muted transition-colors hover:bg-danger/15 hover:text-danger"
          title="手动平仓"
        >
          <XCircle className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
