import { lazy, Suspense, useState } from 'react';
import Sidebar, { type Page } from './components/Sidebar';
import Header from './components/Header';
import PanelSkeleton from './components/PanelSkeleton';
import { useSimulation } from './hooks/useSimulation';

const DashboardPage = lazy(() => import('./components/DashboardPage'));
const TokenSearchPage = lazy(() => import('./components/TokenSearchPage'));
const WatchpoolPage = lazy(() => import('./components/WatchpoolPage'));
const SmartMoneyPage = lazy(() => import('./components/SmartMoneyPage'));
const NarrativesPage = lazy(() => import('./components/NarrativesPage'));
const TradeHistoryPage = lazy(() => import('./components/TradeHistoryPage'));
const ConfigPage = lazy(() => import('./components/ConfigPage'));

function App() {
  const sim = useSimulation();
  const [activePage, setActivePage] = useState<Page>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const navMeta = {
    dashboard: {
      badge: `${sim.portfolio.openPositions}`,
      hint: '资产、持仓、预警和曲线总览',
    },
    'trade-history': {
      badge: `${sim.portfolio.closedTrades}`,
      hint: '查看已平仓记录和收益结果',
    },
    'token-search': {
      badge: `${sim.recentTokens.length}`,
      hint: 'Solana 搜索和本地发现结果联查',
    },
    watchpool: {
      badge: `${sim.status.watchPoolSize}`,
      hint: '等待动量确认的入场候选池',
    },
    'smart-money': {
      badge: `${sim.status.smartMoneyWallets}`,
      hint: '追踪钱包来源、命中币种和维护列表',
    },
    narratives: {
      badge: `${sim.status.activeNarratives}`,
      hint: '按叙事观察链上热点聚集情况',
    },
    config: {
      badge: '',
      hint: '数据库工作台和开仓策略参数',
    },
  } satisfies Record<Page, { badge: string; hint: string }>;

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return (
          <Suspense fallback={<PanelSkeleton title="仪表盘" rows={6} />}>
            <DashboardPage sim={sim} />
          </Suspense>
        );
      case 'token-search':
        return (
          <Suspense fallback={<PanelSkeleton title="代币搜索" rows={6} />}>
            <TokenSearchPage localTokens={sim.recentTokens} />
          </Suspense>
        );
      case 'watchpool':
        return (
          <Suspense fallback={<PanelSkeleton title="观察池" rows={6} />}>
            <WatchpoolPage localTokens={sim.recentTokens} />
          </Suspense>
        );
      case 'smart-money':
        return (
          <Suspense fallback={<PanelSkeleton title="聪明钱" rows={6} />}>
            <SmartMoneyPage localTokens={sim.recentTokens} trackedWalletCount={sim.status.smartMoneyWallets} />
          </Suspense>
        );
      case 'narratives':
        return (
          <Suspense fallback={<PanelSkeleton title="热叙事" rows={6} />}>
            <NarrativesPage />
          </Suspense>
        );
      case 'trade-history':
        return (
          <Suspense fallback={<PanelSkeleton title="交易历史" rows={6} />}>
            <TradeHistoryPage trades={sim.trades} />
          </Suspense>
        );
      case 'config':
        return (
          <Suspense fallback={<PanelSkeleton title="系统配置" rows={6} />}>
            <ConfigPage />
          </Suspense>
        );
    }
  };

  return (
    <div className="h-screen w-full overflow-hidden bg-bg-primary text-text-primary flex relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,184,77,0.045),transparent_28%,rgba(61,215,196,0.035)_100%)]" />
      </div>

      {/* Sidebar (提升层级避免被光晕遮挡交互) */}
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(c => !c)}
        connected={sim.connected}
        isTrading={sim.status.isTrading}
        navMeta={navMeta}
      />

      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <Header
          connected={sim.connected}
          isTrading={sim.status.isTrading}
          onRefresh={sim.refresh}
          status={sim.status}
        />

        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
          {renderPage()}

          <footer className="text-center py-6 mt-6 border-t border-border/70">
            <p className="text-xs text-text-muted">
              土狗猎手 TuGou Catcher — Solana Memecoin 模拟实验台
            </p>
            <p className="text-[11px] text-text-muted mt-1">
              数据来源：DexScreener + Solana RPC | 模拟交易，不构成投资建议 | 初始资金：1 SOL
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}

export default App;
