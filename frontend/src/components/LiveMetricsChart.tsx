import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, AreaChart } from 'recharts';
import { TrendingUp } from 'lucide-react';
import type { PortfolioSnapshot, Trade } from '../types';
import { formatTimestamp } from '../utils';

interface Props {
  snapshots: PortfolioSnapshot[];
  trades: Trade[];
}

export default function LiveMetricsChart({ snapshots, trades }: Props) {
  if (snapshots.length < 2) {
    return (
      <section className="bg-bg-card rounded-xl border border-border p-8 text-center">
        <TrendingUp className="w-8 h-8 text-text-muted mx-auto mb-2" />
        <p className="text-sm text-text-muted">等待数据积累中…</p>
        <p className="text-xs text-text-muted mt-1">交易开始后，资产曲线会在这里展示</p>
      </section>
    );
  }

  const chartData = snapshots.map(s => ({
    time: formatTimestamp(s.timestamp),
    totalValue: parseFloat(s.totalValueSOL.toFixed(4)),
    cash: parseFloat(s.cashSOL.toFixed(4)),
    pnlPct: parseFloat(s.cumulativePnlPct.toFixed(2)),
  }));

  const closedTrades = trades.filter(t => t.status !== 'open' && t.roi !== null);
  const tradeData = closedTrades.slice(-20).map((t, i) => ({
    idx: i + 1,
    symbol: t.tokenSymbol,
    roi: parseFloat((t.roi ?? 0).toFixed(1)),
    fill: (t.roi ?? 0) >= 0 ? '#10b981' : '#ef4444',
  }));

  const tooltipStyle = {
    background: 'rgba(8, 18, 28, 0.96)',
    border: '1px solid rgba(255, 184, 77, 0.15)',
    borderRadius: 16,
    fontSize: 12,
    boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
  } satisfies React.CSSProperties;

  return (
    <section className="space-y-4">
      {/* Portfolio value chart */}
      <div className="bg-bg-card terminal-panel rounded-2xl border border-border p-4">
        <h3 className="panel-title text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          资产曲线
        </h3>
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffb84d" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#ffb84d" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(164,188,214,0.1)" />
              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${v} SOL`}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Area type="monotone" dataKey="totalValue" stroke="#ffb84d" strokeWidth={2.5} fill="url(#valueGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Trade ROI bars */}
      {tradeData.length > 0 && (
        <div className="bg-bg-card rounded-2xl border border-border p-4">
          <h3 className="panel-title text-sm font-semibold text-text-primary mb-4">
            最近交易 ROI
          </h3>
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={tradeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(164,188,214,0.1)" />
                <XAxis dataKey="symbol" tick={{ fill: '#64748b', fontSize: 9 }} tickLine={false} axisLine={false} angle={-30} textAnchor="end" height={40} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip
                  contentStyle={tooltipStyle}
                />
                <Line type="monotone" dataKey="roi" stroke="#3dd7c4" strokeWidth={2.5} dot={{ r: 3, fill: '#3dd7c4' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}
