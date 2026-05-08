import { Bell, AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react';
import type { Alert } from '../types';
import { formatTimestamp, cn } from '../utils';

interface Props {
  alerts: Alert[];
}

const LEVEL_STYLES: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; bg: string }> = {
  info: { icon: Info, color: 'text-accent', bg: 'bg-accent/10 border-accent/20' },
  success: { icon: CheckCircle, color: 'text-success', bg: 'bg-success/10 border-success/20' },
  warning: { icon: AlertTriangle, color: 'text-warning', bg: 'bg-warning/10 border-warning/20' },
  danger: { icon: XCircle, color: 'text-danger', bg: 'bg-danger/10 border-danger/20' },
};

export default function AlertsPanel({ alerts }: Props) {
  const recent = alerts.slice(0, 8);

  return (
    <section className="bg-bg-card terminal-panel rounded-2xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border/70 flex items-center justify-between">
        <h3 className="panel-title text-sm font-semibold text-text-primary flex items-center gap-2">
          <Bell className="w-4 h-4 text-warning" />
          实时警报
        </h3>
        <span className="text-xs text-text-muted">{alerts.length} 条</span>
      </div>

      <div className="divide-y divide-border/50 max-h-[280px] overflow-y-auto">
        {recent.map(alert => {
          const style = LEVEL_STYLES[alert.level] || LEVEL_STYLES.info;
          const Icon = style.icon;
          return (
            <div key={alert.id} className="px-4 py-3 flex items-start gap-3 hover:bg-bg-card-hover transition-colors">
              <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border', style.bg)}>
                <Icon className={cn('w-3.5 h-3.5', style.color)} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-text-primary truncate">
                    {alert.title}
                    {alert.tokenSymbol && (
                      <span className="ml-1.5 text-text-muted font-normal">
                        [{alert.tokenSymbol}]
                      </span>
                    )}
                  </p>
                  <span className="text-[10px] text-text-muted shrink-0">
                    {formatTimestamp(alert.timestamp)}
                  </span>
                </div>
                <p className="text-[11px] text-text-secondary mt-0.5 line-clamp-2">
                  {alert.message}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
