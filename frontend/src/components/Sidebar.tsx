import {
  Activity,
  Brain,
  ChevronLeft,
  ChevronRight,
  Eye,
  Flame,
  History,
  LayoutDashboard,
  Search,
  Server,
  Settings,
  Wallet,
} from 'lucide-react';
import { cn } from '../utils';

export type Page =
  | 'dashboard'
  | 'token-search'
  | 'watchpool'
  | 'smart-money'
  | 'narratives'
  | 'trade-history'
  | 'config';

interface NavMeta {
  badge?: string;
  hint: string;
}

interface Props {
  activePage: Page;
  onNavigate: (page: Page) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  connected: boolean;
  isTrading: boolean;
  navMeta: Record<Page, NavMeta>;
}

type NavItem = {
  id: Page;
  icon: typeof LayoutDashboard;
  label: string;
  section: 'workspace' | 'discovery' | 'system';
};

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: '总览', section: 'workspace' },
  { id: 'trade-history', icon: History, label: '交易历史', section: 'workspace' },
  { id: 'token-search', icon: Search, label: '代币搜索', section: 'discovery' },
  { id: 'watchpool', icon: Eye, label: '观察池', section: 'discovery' },
  { id: 'smart-money', icon: Brain, label: '聪明钱', section: 'discovery' },
  { id: 'narratives', icon: Flame, label: '热叙事', section: 'discovery' },
  { id: 'config', icon: Settings, label: '数据库', section: 'system' },
];

const SECTION_LABELS: Record<NavItem['section'], string> = {
  workspace: '交易工作台',
  discovery: '信号发现',
  system: '系统管理',
};

export default function Sidebar({
  activePage,
  onNavigate,
  collapsed,
  onToggleCollapse,
  connected,
  isTrading,
  navMeta,
}: Props) {
  const grouped = {
    workspace: NAV_ITEMS.filter(item => item.section === 'workspace'),
    discovery: NAV_ITEMS.filter(item => item.section === 'discovery'),
    system: NAV_ITEMS.filter(item => item.section === 'system'),
  };

  return (
    <aside className={cn(
      'h-screen flex flex-col bg-bg-card/80 backdrop-blur-2xl border-r border-border/70 z-20 transition-all duration-300 shrink-0 shadow-2xl relative',
      collapsed ? 'w-20' : 'w-80'
    )}>
      <div className="absolute inset-x-0 top-0 h-32 pointer-events-none bg-gradient-to-b from-primary/10 to-transparent" />

      <div className="flex items-center gap-3 px-4 py-5 border-b border-border/70 relative">
        <div className="w-11 h-11 rounded-2xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0 shadow-[0_10px_30px_rgba(255,184,77,0.1)]">
          <Activity className="w-5 h-5 text-primary" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="panel-title text-sm font-bold text-text-primary leading-tight truncate">土狗猎手</h1>
            <p className="text-[10px] uppercase tracking-[0.18em] text-text-muted truncate">TuGou Catcher Terminal</p>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="px-3 pt-3">
          <div className="rounded-2xl border border-border/70 bg-bg-secondary/70 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">系统状态</p>
                <p className="text-sm text-text-primary">{isTrading ? '交易引擎运行中' : '交易引擎待机'}</p>
              </div>
              <div className={cn(
                'h-2.5 w-2.5 rounded-full',
                connected ? 'bg-success shadow-[0_0_14px_rgba(68,212,146,0.8)]' : 'bg-danger shadow-[0_0_14px_rgba(255,107,122,0.8)]'
              )} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatusPill icon={Server} label="后端" value={connected ? '在线' : '离线'} tone={connected ? 'success' : 'danger'} />
              <StatusPill icon={Wallet} label="交易" value={isTrading ? '自动' : '暂停'} tone={isTrading ? 'primary' : 'muted'} />
            </div>
          </div>
        </div>
      )}

      <nav className="flex-1 py-4 px-3 overflow-y-auto space-y-5">
        {(['workspace', 'discovery', 'system'] as const).map(section => (
          <div key={section} className="space-y-2">
            {!collapsed && (
              <p className="px-2 text-[11px] uppercase tracking-[0.18em] text-text-muted">
                {SECTION_LABELS[section]}
              </p>
            )}
            <div className="space-y-1.5">
              {grouped[section].map(item => {
                const Icon = item.icon;
                const isActive = activePage === item.id;
                const meta = navMeta[item.id];
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className={cn(
                      'w-full flex items-start gap-3 rounded-2xl px-3 py-3 text-left transition-all border',
                      isActive
                        ? 'bg-primary/14 text-primary border-primary/20 shadow-[0_10px_30px_rgba(255,184,77,0.08)]'
                        : 'border-transparent text-text-secondary hover:bg-bg-card hover:text-text-primary'
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon className={cn('mt-0.5 w-4.5 h-4.5 shrink-0', isActive ? 'text-primary' : '')} />
                    {!collapsed && (
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium truncate">{item.label}</span>
                          {meta.badge && (
                            <span className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded-full shrink-0',
                              isActive ? 'bg-primary/15 text-primary' : 'bg-bg-primary text-text-muted'
                            )}>
                              {meta.badge}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] text-text-muted leading-4">
                          {meta.hint}
                        </p>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <button
        onClick={onToggleCollapse}
        className="flex items-center justify-center py-4 border-t border-border/70 text-text-muted hover:text-text-primary transition-colors"
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>
    </aside>
  );
}

function StatusPill({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Server;
  label: string;
  value: string;
  tone: 'success' | 'danger' | 'primary' | 'muted';
}) {
  const toneClass = {
    success: 'text-success',
    danger: 'text-danger',
    primary: 'text-primary',
    muted: 'text-text-secondary',
  }[tone];

  return (
    <div className="rounded-xl border border-border/60 bg-bg-primary/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <Icon className={cn('w-3.5 h-3.5', toneClass)} />
        <span className="text-[11px] text-text-muted">{label}</span>
      </div>
      <p className={cn('mt-1 text-sm font-medium', toneClass)}>{value}</p>
    </div>
  );
}
