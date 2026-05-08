import { RefreshCw, Wifi, WifiOff, Clock3, Search, Eye, Flame, Brain, Sun, MoonStar, AlertTriangle, Rocket } from 'lucide-react';
import type { SystemStatus } from '../types';
import { cn } from '../utils';

interface HeaderProps {
  connected: boolean;
  isTrading: boolean;
  onRefresh: () => void;
  status: SystemStatus;
}

export default function Header({
  connected,
  isTrading,
  onRefresh,
  status,
}: HeaderProps) {
  const uptimeSeconds = Math.floor(status.uptime / 1000);
  const uptime = uptimeSeconds > 0
    ? `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`
    : '—';

  return (
    <header className="border-b border-border/70 bg-bg-secondary/80 backdrop-blur-xl">
      <div className="px-4 sm:px-6 py-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-2xl border border-primary/20 bg-primary/10 flex items-center justify-center">
              <span className="panel-title text-sm font-bold text-primary">TG</span>
            </div>
            <div className="min-w-0 space-y-2">
              <p className="panel-title text-base font-semibold text-text-primary">Solana 模拟实验台</p>
              <p className="text-xs text-text-muted">只跟踪 Solana：独立资金、持仓、策略复盘。</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <div className="metric-chip rounded-full px-3 py-1.5 flex items-center gap-1.5">
            {connected
              ? <Wifi className="w-3.5 h-3.5 text-success" />
              : <WifiOff className="w-3.5 h-3.5 text-danger" />}
            <span className={connected ? 'text-success' : 'text-danger'}>
              {connected ? '已连接' : '未连接'}
            </span>
          </div>
          <div className="metric-chip rounded-full px-3 py-1.5 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5" />
            <span>已筛选 {status.tokensScreened} 个代币</span>
          </div>
          <div className="metric-chip rounded-full px-3 py-1.5 flex items-center gap-1.5">
            <Clock3 className="w-3.5 h-3.5" />
            <span>运行 {uptime}</span>
          </div>
          <div className="metric-chip rounded-full px-3 py-1.5 flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5" />
            <span>观察池 {status.watchPoolSize}</span>
          </div>
          <div className="metric-chip rounded-full px-3 py-1.5 flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-warning" />
            <span>热叙事 {status.activeNarratives}</span>
          </div>
          <div className="metric-chip rounded-full px-3 py-1.5 flex items-center gap-1.5">
            <Brain className="w-3.5 h-3.5 text-accent" />
            <span>聪明钱 {status.smartMoneyWallets}</span>
          </div>
          <div className="metric-chip rounded-full px-3 py-1.5 flex items-center gap-1.5">
            {status.tradingWindowActive
              ? <Sun className="w-3.5 h-3.5 text-success" />
              : <MoonStar className="w-3.5 h-3.5 text-text-muted" />}
            <span className={status.tradingWindowActive ? 'text-success' : 'text-text-muted'}>
              {status.tradingWindowActive ? '活跃时段' : '低谷时段'}
            </span>
          </div>
          {status.errors > 0 && (
            <div className="metric-chip rounded-full px-3 py-1.5 flex items-center gap-1.5 text-warning">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{status.errors} 错误</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 self-end xl:self-auto">
          <button
            onClick={onRefresh}
            disabled={!connected}
            className={cn(
              'h-10 w-10 rounded-xl border border-border transition-colors',
              connected ? 'hover:bg-bg-card text-text-secondary hover:text-text-primary' : 'opacity-40 cursor-not-allowed'
            )}
            title="刷新数据"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <div className={cn(
            'px-4 py-2.5 rounded-xl border flex items-center gap-2 text-sm font-medium',
            isTrading
              ? 'bg-success/14 text-success border-success/30'
              : 'bg-warning/10 text-warning border-warning/30'
          )}>
            <Rocket className="w-3.5 h-3.5" />
            {isTrading ? '自动交易运行中' : connected ? '自动启动中' : '等待连接'}
          </div>
        </div>
      </div>
    </header>
  );
}
