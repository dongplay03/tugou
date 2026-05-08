// ===== WebSocket-based backend connection hook =====

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  Trade, PortfolioState, PortfolioSnapshot, StrategyLog,
  StrategyWeights, Alert, TokenData, SystemStatus, InitData, WsServerMessage, EntryStrategyMode, StrategyPerformance,
} from '../types';
import { API_URL, WS_URL } from '../config';

const DEFAULT_WEIGHTS: StrategyWeights = {
  contractSafety: 20, liquidityDepth: 15, volumeRatio: 10,
  mcLpRatio: 10, holderDistribution: 10, buyPressure: 10,
  smartMoneySignal: 10, freshness: 5,
  narrativeBonus: { AI: 4, Political: 2, Meme: 3, Celebrity: 2, DeFi: 2, Gaming: 1 },
};

const DEFAULT_PORTFOLIO: PortfolioState = {
  totalValueSOL: 1, cashSOL: 1, openPositions: 0,
  totalTrades: 0, closedTrades: 0, wins: 0, losses: 0, winRate: 0,
  cumulativePnlSOL: 0, cumulativePnlPct: 0, bestTrade: null, worstTrade: null,
  byChain: [
    { chainId: 'solana', totalValueSOL: 1, cashSOL: 1, openPositions: 0, totalTrades: 0, closedTrades: 0, wins: 0, losses: 0, winRate: 0, cumulativePnlSOL: 0, cumulativePnlPct: 0 },
  ],
};

export interface BackendData {
  connected: boolean;
  portfolio: PortfolioState;
  trades: Trade[];
  openTrades: Trade[];
  closedTrades: Trade[];
  snapshots: PortfolioSnapshot[];
  strategyLogs: StrategyLog[];
  weights: StrategyWeights;
  alerts: Alert[];
  recentTokens: TokenData[];
  strategyPerformance: StrategyPerformance[];
  status: SystemStatus;
  // Derived
  totalValue: number;
  cash: number;
  pnlSOL: number;
  pnlPct: number;
  winRate: number;
  totalTrades: number;
  // Actions
  startTrading: () => void;
  stopTrading: () => void;
  closeTrade: (tradeId: string) => void;
  refresh: () => void;
  updateEntryStrategyMode: (mode: EntryStrategyMode) => Promise<void>;
  updatingEntryStrategy: boolean;
}

export function useSimulation(): BackendData {
  const [connected, setConnected] = useState(false);
  const [portfolio, setPortfolio] = useState<PortfolioState>(DEFAULT_PORTFOLIO);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [strategyLogs, setStrategyLogs] = useState<StrategyLog[]>([]);
  const [weights, setWeights] = useState<StrategyWeights>(DEFAULT_WEIGHTS);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [recentTokens, setRecentTokens] = useState<TokenData[]>([]);
  const [strategyPerformance, setStrategyPerformance] = useState<StrategyPerformance[]>([]);
  const [status, setStatus] = useState<SystemStatus>({
    isTrading: false, lastFetchTime: null, tokensScreened: 0, uptime: 0, errors: 0,
    watchPoolSize: 0, activeNarratives: 0, smartMoneyWallets: 0, tradingWindowActive: true, entryStrategyMode: 'unified',
    activeChains: ['solana'],
  });
  const [updatingEntryStrategy, setUpdatingEntryStrategy] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reconnectRef = useRef<() => void>(() => {});

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const handleMessage = useCallback((msg: WsServerMessage) => {
    switch (msg.type) {
      case 'init': {
        const init = msg.data as InitData;
        setPortfolio(init.portfolio);
        setTrades(init.trades);
        setSnapshots(init.snapshots);
        setStrategyLogs(init.strategyLogs);
        setWeights(init.weights);
        setAlerts(init.alerts);
        setRecentTokens(init.recentTokens);
        setStrategyPerformance(init.strategyPerformance ?? []);
        setStatus(init.status);
        break;
      }
      case 'portfolio_update':
        setPortfolio(msg.data as PortfolioState);
        break;
      case 'trade_opened':
        setTrades(prev => [msg.data as Trade, ...prev]);
        break;
      case 'trade_updated':
        setTrades(prev => prev.map(t => t.id === (msg.data as Trade).id ? msg.data as Trade : t));
        break;
      case 'trade_closed':
        setTrades(prev => prev.map(t => t.id === (msg.data as Trade).id ? msg.data as Trade : t));
        break;
      case 'snapshot':
        setSnapshots(prev => [...prev, msg.data as PortfolioSnapshot]);
        break;
      case 'token_discovered':
        setRecentTokens(prev => [msg.data as TokenData, ...prev].slice(0, 50));
        break;
      case 'alert':
        setAlerts(prev => [msg.data as Alert, ...prev].slice(0, 50));
        break;
      case 'strategy_update': {
        const log = msg.data as StrategyLog;
        setStrategyLogs(prev => [...prev, log]);
        setWeights(log.weightsSnapshot);
        break;
      }
      case 'status':
        setStatus(msg.data as SystemStatus);
        break;
      case 'price_update':
        break;
    }
  }, []);

  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected to backend');
        setConnected(true);
        send({ type: 'start_trading' });
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected, reconnecting in 3s...');
        setConnected(false);
        wsRef.current = null;
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectRef.current();
        }, 3000);
      };

      ws.onerror = () => {
        setConnected(false);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleMessage(msg);
        } catch (err) {
          console.error('[WS] Parse error:', err);
        }
      };
    } catch {
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectRef.current();
      }, 3000);
    }
  }, [handleMessage]);

  useEffect(() => {
    reconnectRef.current = connectWs;
  }, [connectWs]);

  useEffect(() => {
    connectWs();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectWs]);

  const startTrading = useCallback(() => {
    send({ type: 'start_trading' });
  }, [send]);

  const stopTrading = useCallback(() => {
    send({ type: 'stop_trading' });
  }, [send]);

  const closeTrade = useCallback((tradeId: string) => {
    send({ type: 'close_trade', tradeId });
  }, [send]);

  const refresh = useCallback(() => {
    send({ type: 'refresh' });
  }, [send]);

  const updateEntryStrategyMode = useCallback(async (mode: EntryStrategyMode) => {
    if (status.entryStrategyMode === mode) return;

    setUpdatingEntryStrategy(true);
    try {
      const response = await fetch(`${API_URL}/strategy/entry-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });

      if (!response.ok) {
        throw new Error(`entry strategy update failed: ${response.status}`);
      }

      setStatus(current => ({ ...current, entryStrategyMode: mode }));
    } catch (error) {
      console.error('[Simulation] Failed to update entry strategy mode:', error);
    } finally {
      setUpdatingEntryStrategy(false);
    }
  }, [status.entryStrategyMode]);

  const openTrades = trades.filter(t => t.status === 'open');
  const closedTrades = trades.filter(t => t.status !== 'open');

  return {
    connected,
    portfolio,
    trades,
    openTrades,
    closedTrades,
    snapshots,
    strategyLogs,
    weights,
    alerts,
    recentTokens,
    strategyPerformance,
    status,
    totalValue: portfolio.totalValueSOL,
    cash: portfolio.cashSOL,
    pnlSOL: portfolio.cumulativePnlSOL,
    pnlPct: portfolio.cumulativePnlPct,
    winRate: portfolio.winRate,
    totalTrades: portfolio.closedTrades,
    startTrading,
    stopTrading,
    closeTrade,
    refresh,
    updateEntryStrategyMode,
    updatingEntryStrategy,
  };
}
