// ===== Express + WebSocket Server =====

import express from 'express';
import cors from 'cors';
import { createServer, type IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { WsServerMessage, WsClientMessage, InitData } from './types.js';
import * as db from './database.js';
import { getPortfolioState, manualCloseTrade } from './trader.js';
import { startMonitoring, stopMonitoring, setBroadcast, getStatus } from './monitor.js';
import { getWatchPool, getWatchPoolSize } from './momentum.js';
import { getNarrativeStates, getActiveNarrativeCount } from './narrative.js';
import { getAllSmartWallets, getSmartWalletCount, addSmartWallet, removeSmartWallet, loadSmartWallets, buildSmartMoneyOverview } from './smart-money.js';
import { getCurrentTradingWindow, getMaxPositions, getPositionSizeMultiplier } from './time-window.js';
import { blacklistCreator } from './creator.js';
import { NARRATIVE_PATTERNS } from './narrative-patterns.js';
import type { SmartMoneySource, EntryStrategyMode, ChainId } from './types.js';
import { getSmartMoneyProviderCatalog, refreshAllAutoSources, refreshSmartMoneyProvider, startSmartMoneyRefreshScheduler } from './smart-money-providers.js';
import { getChainRulesCatalog } from './chain-rules.js';
import { getDailyNewsCategories, getDailyNewsHot } from './opennews.js';
import { getBlockBeatsDerivatives, getBlockBeatsFeed, getBlockBeatsNetflow, getBlockBeatsOverview, searchBlockBeats } from './blockbeats.js';
import { getMarketDataProviderCatalog } from './market-data-providers.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const API_KEY = process.env.API_KEY?.trim() || process.env.TUGOU_API_KEY?.trim() || '';
const ENABLE_DB_WORKBENCH = process.env.ENABLE_DB_WORKBENCH === 'true';
const RATE_LIMIT_WINDOW_MS = 60_000;

type RateLimitBucket = {
  windowStart: number;
  count: number;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

function extractApiKey(req: IncomingMessage | express.Request): string {
  const headerValue = req.headers['x-api-key'];
  if (typeof headerValue === 'string') return headerValue;
  if (Array.isArray(headerValue) && headerValue.length > 0) return headerValue[0];

  const url = req.url || '';
  const parsed = new URL(url, `http://localhost:${PORT}`);
  return parsed.searchParams.get('apiKey') || '';
}

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!API_KEY || req.path === '/health') {
    next();
    return;
  }

  if (extractApiKey(req) !== API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

function createRateLimiter(limit: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = `${req.ip}:${req.route?.path || req.path}:${limit}`;
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key);

    if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      rateLimitBuckets.set(key, { windowStart: now, count: 1 });
      next();
      return;
    }

    if (bucket.count >= limit) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    bucket.count += 1;
    next();
  };
}

function normalizeChainQuery(_value: unknown): ChainId {
  return 'solana';
}

function normalizeLimitQuery(value: unknown, fallback: number, max: number): number {
  return Math.min(max, Math.max(1, parseInt(String(value || fallback), 10) || fallback));
}

function normalizeSmartMoneySource(value: unknown): SmartMoneySource {
  const source = typeof value === 'string' ? value.trim().toLowerCase() : '';
  switch (source) {
    case 'gmgn':
    case 'ave':
    case 'bullx':
    case 'photon':
    case 'birdeye':
    case 'x':
    case 'telegram':
      return source;
    default:
      return 'manual';
  }
}

function normalizeEntryStrategyMode(_value: unknown): EntryStrategyMode {
  return 'unified';
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 15_000): Promise<{ response: Response; data: T }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const data = await response.json() as T;
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

app.use('/api', createRateLimiter(120));
app.use('/api', requireApiKey);

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Track all connected WebSocket clients
const clients = new Set<WebSocket>();

// Broadcast message to all connected clients
function broadcast(msg: WsServerMessage) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// Register broadcast function with monitor
setBroadcast(broadcast);

// ===== WebSocket handling =====
// Ping/pong heartbeat to detect dead connections
const WS_PING_INTERVAL = 30_000; // 30s
const pingInterval = setInterval(() => {
  wss.clients.forEach((ws: any) => {
    if (ws.isAlive === false) {
      console.log('[WS] Terminating dead client');
      clients.delete(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, WS_PING_INTERVAL);

wss.on('close', () => clearInterval(pingInterval));

wss.on('connection', (ws: any, req) => {
  if (API_KEY && extractApiKey(req) !== API_KEY) {
    ws.close(1008, 'Unauthorized');
    return;
  }

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  clients.add(ws);
  console.log(`[WS] Client connected (total: ${clients.size})`);

  // Send initial state
  const initData: InitData = {
    portfolio: getPortfolioState(),
    trades: db.getAllTrades(),
    recentTokens: db.getRecentTokens(30),
    strategyLogs: db.getStrategyLogs(),
    snapshots: db.getSnapshots(),
    alerts: db.getAlerts(30),
    status: getStatus(),
    weights: db.getWeights(),
    strategyPerformance: db.getStrategyPerformance(),
  };

  ws.send(JSON.stringify({ type: 'init', data: initData }));

  // Handle client messages
  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as WsClientMessage;

      switch (msg.type) {
        case 'start_trading':
          startMonitoring();
          broadcast({ type: 'status', data: getStatus() });
          break;

        case 'stop_trading':
          await stopMonitoring();
          broadcast({ type: 'status', data: getStatus() });
          break;

        case 'close_trade': {
          const result = manualCloseTrade(msg.tradeId);
          if (result) {
            broadcast({ type: 'trade_closed', data: result.trade });
            broadcast({ type: 'alert', data: result.alert });
            broadcast({ type: 'portfolio_update', data: getPortfolioState() });
          }
          break;
        }

        case 'refresh': {
          const refreshData: InitData = {
            portfolio: getPortfolioState(),
            trades: db.getAllTrades(),
            recentTokens: db.getRecentTokens(30),
            strategyLogs: db.getStrategyLogs(),
            snapshots: db.getSnapshots(),
            alerts: db.getAlerts(30),
            status: getStatus(),
            weights: db.getWeights(),
            strategyPerformance: db.getStrategyPerformance(),
          };
          ws.send(JSON.stringify({ type: 'init', data: refreshData }));
          break;
        }
      }
    } catch (err) {
      console.error('[WS] Error processing message:', err);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected (total: ${clients.size})`);
  });

  ws.on('error', (err) => {
    console.error('[WS] Client error:', err);
    clients.delete(ws);
  });
});

// ===== REST API endpoints =====

// Get portfolio state
app.get('/api/portfolio', (_req, res) => {
  res.json(getPortfolioState());
});

// Get all trades
app.get('/api/trades', (req, res) => {
  const chainId = normalizeChainQuery(req.query.chain);
  res.json(db.getAllTrades(chainId));
});

// Get open trades
app.get('/api/trades/open', (req, res) => {
  const chainId = normalizeChainQuery(req.query.chain);
  res.json(db.getOpenTrades(chainId));
});

app.get('/api/trades/:id/history', (req, res) => {
  res.json(db.getTradePriceHistory(req.params.id));
});

// Get closed trades
app.get('/api/trades/closed', (req, res) => {
  const chainId = normalizeChainQuery(req.query.chain);
  res.json(db.getClosedTrades(chainId));
});

// Close a trade manually
app.post('/api/trades/:id/close', (req, res) => {
  const result = manualCloseTrade(req.params.id);
  if (!result) {
    res.status(404).json({ error: 'Trade not found or already closed' });
    return;
  }
  broadcast({ type: 'trade_closed', data: result.trade });
  broadcast({ type: 'alert', data: result.alert });
  broadcast({ type: 'portfolio_update', data: getPortfolioState() });
  res.json(result.trade);
});

// Get recent discovered tokens
app.get('/api/tokens', (req, res) => {
  const chainId = normalizeChainQuery(req.query.chain);
  const limit = normalizeLimitQuery(req.query.limit, 50, 200);
  res.json(db.getRecentTokens(limit, chainId));
});

app.get('/api/tokens/search', createRateLimiter(20), (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const limit = normalizeLimitQuery(req.query.limit, 24, 50);
  const chainId = normalizeChainQuery(req.query.chain);
  res.json(db.searchTokens(query, limit, chainId));
});

app.get('/api/chain-rules', (_req, res) => {
  res.json({ chains: getChainRulesCatalog() });
});

app.get('/api/market-data/providers', (_req, res) => {
  res.json({ providers: getMarketDataProviderCatalog() });
});

// Get eligible tokens
app.get('/api/tokens/eligible', (_req, res) => {
  res.json(db.getEligibleTokens());
});

// Get portfolio snapshots
app.get('/api/snapshots', (_req, res) => {
  res.json(db.getSnapshots());
});

// Get strategy logs
app.get('/api/strategy/logs', (_req, res) => {
  res.json(db.getStrategyLogs());
});

app.get('/api/strategy/performance', (_req, res) => {
  res.json(db.getStrategyPerformance());
});

app.get('/api/discovery-logs', (_req, res) => {
  res.json(db.getDiscoveryLogs());
});

// Get current weights
app.get('/api/strategy/weights', (_req, res) => {
  res.json(db.getWeights());
});

app.get('/api/strategy/entry-settings', (_req, res) => {
  res.json(db.getEntryStrategySettings());
});

app.put('/api/strategy/entry-settings', (req, res) => {
  const mode = normalizeEntryStrategyMode(req.body?.mode);
  const directEntryMinScore = Number(req.body?.directEntryMinScore);
  const directEntryMinLiquidityUsd = Number(req.body?.directEntryMinLiquidityUsd);

  db.setEntryStrategyMode(mode);

  if (Number.isFinite(directEntryMinScore) && directEntryMinScore > 0) {
    db.setDirectEntryMinScore(directEntryMinScore);
  }

  if (Number.isFinite(directEntryMinLiquidityUsd) && directEntryMinLiquidityUsd > 0) {
    db.setDirectEntryMinLiquidityUsd(directEntryMinLiquidityUsd);
  }

  const settings = db.getEntryStrategySettings();
  broadcast({ type: 'status', data: getStatus() });
  res.json(settings);
});

// Get alerts
app.get('/api/alerts', (_req, res) => {
  res.json(db.getAlerts(50));
});

// Get system status
app.get('/api/status', (_req, res) => {
  res.json(getStatus());
});

// Start trading
app.post('/api/start', (_req, res) => {
  startMonitoring();
  broadcast({ type: 'status', data: getStatus() });
  res.json({ success: true, status: getStatus() });
});

// Stop trading
app.post('/api/stop', (_req, res) => {
  Promise.resolve(stopMonitoring()).then(() => {
    broadcast({ type: 'status', data: getStatus() });
    res.json({ success: true, status: getStatus() });
  }).catch(err => {
    res.status(500).json({ error: 'Failed to stop monitoring', details: String(err) });
  });
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ===== Strategy Endpoints =====

// Get momentum watchpool status
app.get('/api/strategies/watchpool', (_req, res) => {
  res.json({
    size: getWatchPoolSize(),
    entries: getWatchPool(),
  });
});

// Get narrative states
app.get('/api/strategies/narratives', (_req, res) => {
  res.json({
    activeCount: getActiveNarrativeCount(),
    narratives: getNarrativeStates(),
  });
});

app.get('/api/opennews/daily/categories', createRateLimiter(30), async (_req, res) => {
  try {
    const payload = await getDailyNewsCategories();
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load daily news categories' });
  }
});

app.get('/api/opennews/daily/hot', createRateLimiter(30), async (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : 'web3';
  const subcategory = typeof req.query.subcategory === 'string' ? req.query.subcategory : '';
  const force = req.query.force === '1';

  try {
    const payload = await getDailyNewsHot(category, subcategory, force);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load daily hot news' });
  }
});

app.get('/api/blockbeats/overview', createRateLimiter(30), async (_req, res) => {
  res.json(await getBlockBeatsOverview());
});

app.get('/api/blockbeats/feed', createRateLimiter(30), async (req, res) => {
  const kind = typeof req.query.kind === 'string' ? req.query.kind : 'important';
  const size = Math.min(20, Math.max(1, Number(req.query.size) || 10));
  res.json(await getBlockBeatsFeed(kind, size));
});

app.get('/api/blockbeats/search', createRateLimiter(20), async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const size = Math.min(20, Math.max(1, Number(req.query.size) || 10));
  res.json(await searchBlockBeats(q, size));
});

app.get('/api/blockbeats/netflow', createRateLimiter(30), async (req, res) => {
  const network = typeof req.query.network === 'string' ? req.query.network : 'solana';
  res.json(await getBlockBeatsNetflow(network));
});

app.get('/api/blockbeats/derivatives', createRateLimiter(30), async (req, res) => {
  const dataType = typeof req.query.dataType === 'string' ? req.query.dataType : '1D';
  res.json(await getBlockBeatsDerivatives(dataType));
});

// Get smart money wallets
app.get('/api/strategies/smart-money', (_req, res) => {
  const tokens = db.getRecentTokens(200);
  res.json(buildSmartMoneyOverview(tokens, getAllSmartWallets()));
});

// Get trading time window status
app.get('/api/strategies/time-window', (_req, res) => {
  res.json({
    currentWindow: getCurrentTradingWindow(),
    maxPositions: getMaxPositions(),
    positionSizeMultiplier: getPositionSizeMultiplier(),
  });
});

// Combined strategy overview
app.get('/api/strategies/overview', (_req, res) => {
  res.json({
    watchPool: { size: getWatchPoolSize() },
    narratives: { activeCount: getActiveNarrativeCount(), states: getNarrativeStates() },
    smartMoney: { walletCount: getSmartWalletCount() },
    timeWindow: {
      current: getCurrentTradingWindow(),
      maxPositions: getMaxPositions(),
      positionSizeMultiplier: getPositionSizeMultiplier(),
    },
  });
});

// ===== DexScreener proxy (allows frontend to search any token) =====
app.get('/api/dex/search', createRateLimiter(30), async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const chainId = normalizeChainQuery(req.query.chain) ?? 'solana';
  if (!query || query.length < 2) {
    res.json({ pairs: [] });
    return;
  }
  try {
    const dexBase = process.env.DEXSCREENER_API_BASE?.trim() || 'https://api.dexscreener.com';
    const { response, data } = await fetchJsonWithTimeout<{ pairs?: any[] }>(
      `${dexBase}/latest/dex/search?q=${encodeURIComponent(query)}`,
    );
    if (!response.ok) {
      res.status(response.status).json({ error: 'DexScreener search failed' });
      return;
    }
    const pairs = (data.pairs || []).filter((p: any) => p.chainId === chainId).slice(0, 50);
    res.json({ pairs });
  } catch (err) {
    res.status(500).json({ error: 'DexScreener search error' });
  }
});

// DexScreener token detail
app.get('/api/dex/tokens/:address', createRateLimiter(30), async (req, res) => {
  try {
    const dexBase = process.env.DEXSCREENER_API_BASE?.trim() || 'https://api.dexscreener.com';
    const addr = String(req.params.address);
    const { response, data } = await fetchJsonWithTimeout(
      `${dexBase}/latest/dex/tokens/${encodeURIComponent(addr)}`,
    );
    if (!response.ok) {
      res.status(response.status).json({ error: 'DexScreener token lookup failed' });
      return;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'DexScreener token lookup error' });
  }
});

// RugCheck proxy
app.get('/api/rugcheck/:mint', createRateLimiter(20), async (req, res) => {
  try {
    const rugBase = process.env.RUGCHECK_API_BASE?.trim() || 'https://api.rugcheck.xyz';
    const mint = String(req.params.mint);
    const { response, data } = await fetchJsonWithTimeout(
      `${rugBase}/v1/tokens/${encodeURIComponent(mint)}/report`,
    );
    if (!response.ok) {
      res.status(response.status).json({ error: 'RugCheck lookup failed' });
      return;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'RugCheck lookup error' });
  }
});

// ===== Config CRUD =====
app.get('/api/config', (_req, res) => {
  res.json(db.getAllConfig());
});

app.put('/api/config/:key', (req, res) => {
  const key = req.params.key;
  const value = typeof req.body?.value === 'string' ? req.body.value : String(req.body?.value ?? '');
  db.setConfig(key, value);
  res.json({ key, value });
});

app.delete('/api/config/:key', (req, res) => {
  const deleted = db.deleteConfig(req.params.key);
  res.json({ deleted });
});

// ===== Smart Money Wallets CRUD =====
app.get('/api/smart-money/wallets', (_req, res) => {
  res.json(db.getSmartMoneyWalletsFromDB());
});

app.get('/api/smart-money/providers', (_req, res) => {
  res.json({
    providers: getSmartMoneyProviderCatalog(),
    runs: db.getSmartMoneyProviderRuns(30),
  });
});

app.post('/api/smart-money/providers/refresh-all', async (_req, res) => {
  const runs = await refreshAllAutoSources();
  res.json({ runs });
});

app.post('/api/smart-money/providers/:source/refresh', async (req, res) => {
  const source = normalizeSmartMoneySource(req.params.source);
  const run = await refreshSmartMoneyProvider(source);
  res.json(run);
});

app.post('/api/smart-money/wallets', (req, res) => {
  const { address, label, source, notes, winRate, avgROI, totalTrades } = req.body || {};
  if (!address || typeof address !== 'string') {
    res.status(400).json({ error: 'address is required' });
    return;
  }
  const wallet = {
    address: address.trim(),
    label: (label || address.slice(0, 8)).trim(),
    source: normalizeSmartMoneySource(source),
    notes: typeof notes === 'string' ? notes.trim() : '',
    winRate: Number(winRate) || 0,
    avgROI: Number(avgROI) || 0,
    totalTrades: Number(totalTrades) || 0,
    lastSeen: Date.now(),
    addedAt: Date.now(),
  };
  db.saveSmartMoneyWallet(wallet);
  addSmartWallet(wallet);
  res.json(wallet);
});

app.post('/api/smart-money/wallets/bulk', (req, res) => {
  const { source, notes, wallets } = req.body || {};
  if (!Array.isArray(wallets) || wallets.length === 0) {
    res.status(400).json({ error: 'wallets array is required' });
    return;
  }

  const normalizedSource = normalizeSmartMoneySource(source);
  const now = Date.now();
  const parsed: Array<{
    address: string;
    label: string;
    winRate: number;
    avgROI: number;
    totalTrades: number;
  }> = [];

  for (const row of wallets) {
    if (typeof row === 'string') {
      const [addressPart, labelPart] = row.split(',').map(part => part.trim());
      if (!addressPart) continue;
      parsed.push({
        address: addressPart,
        label: labelPart || addressPart.slice(0, 8),
        winRate: 0,
        avgROI: 0,
        totalTrades: 0,
      });
      continue;
    }

    if (row && typeof row === 'object') {
      const candidate = row as Record<string, unknown>;
      const address = typeof candidate.address === 'string' ? candidate.address.trim() : '';
      if (!address) continue;
      const label = typeof candidate.label === 'string' && candidate.label.trim()
        ? candidate.label.trim()
        : address.slice(0, 8);

      parsed.push({
        address,
        label,
        winRate: Number(candidate.winRate) || 0,
        avgROI: Number(candidate.avgROI) || 0,
        totalTrades: Number(candidate.totalTrades) || 0,
      });
    }
  }

  if (parsed.length === 0) {
    res.status(400).json({ error: 'no valid wallets found' });
    return;
  }

  const walletRows = parsed.map(wallet => ({
    ...wallet,
    source: normalizedSource,
    notes: typeof notes === 'string' ? notes.trim() : '',
    lastSeen: now,
    addedAt: now,
  }));

  db.saveSmartMoneyWalletsBulk(walletRows);
  for (const wallet of walletRows) {
    addSmartWallet(wallet);
  }

  res.json({
    imported: walletRows.length,
    source: normalizedSource,
    wallets: walletRows,
  });
});

app.delete('/api/smart-money/wallets/:address', (req, res) => {
  const deleted = db.deleteSmartMoneyWallet(req.params.address);
  removeSmartWallet(req.params.address);
  res.json({ deleted });
});

// ===== Blacklisted Creators CRUD =====
app.get('/api/blacklisted-creators', (_req, res) => {
  res.json(db.getBlacklistedCreators());
});

app.post('/api/blacklisted-creators', (req, res) => {
  const { address, reason } = req.body || {};
  if (!address || typeof address !== 'string') {
    res.status(400).json({ error: 'address is required' });
    return;
  }
  db.saveBlacklistedCreator(address.trim(), (reason || '').trim());
  blacklistCreator(address.trim());
  res.json({ address: address.trim(), reason: (reason || '').trim() });
});

app.delete('/api/blacklisted-creators/:address', (req, res) => {
  const deleted = db.deleteBlacklistedCreator(req.params.address);
  res.json({ deleted });
});

// ===== Token detail =====
app.get('/api/tokens/:address', (req, res) => {
  const token = db.getToken(req.params.address);
  if (!token) {
    res.status(404).json({ error: 'Token not found in local DB' });
    return;
  }
  res.json(token);
});

// ===== Narrative patterns (for frontend display) =====
app.get('/api/narrative-patterns', (_req, res) => {
  res.json(NARRATIVE_PATTERNS);
});

function requireDbWorkbench(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (ENABLE_DB_WORKBENCH) {
    next();
    return;
  }

  res.status(403).json({
    error: 'DB workbench is disabled. Set ENABLE_DB_WORKBENCH=true for local maintenance.',
  });
}

function getRouteParam(value: string | string[], fallback = ''): string {
  return Array.isArray(value) ? value[0] ?? fallback : value;
}

app.get('/api/db/tables', requireDbWorkbench, (_req, res) => {
  res.json(db.getDbTableList());
});

app.get('/api/db/table/:name', requireDbWorkbench, (req, res) => {
  const limit = Math.min(300, Math.max(1, Number(req.query.limit) || 100));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  try {
    res.json(db.getDbTableRows(getRouteParam(req.params.name), limit, offset));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/db/table/:name/row', requireDbWorkbench, (req, res) => {
  try {
    db.upsertDbTableRow(getRouteParam(req.params.name), req.body || {});
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/api/db/table/:name/row', requireDbWorkbench, (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    db.deleteDbTableRow(getRouteParam(req.params.name), body);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});


// ===== Start server =====
export function startServer() {
  // Load smart money wallets from DB at startup
  let savedWallets = db.getSmartMoneyWalletsFromDB();
  if (savedWallets.length > 0) {
    loadSmartWallets(savedWallets);
    console.log(`[Server] Loaded ${savedWallets.length} smart money wallets from DB`);
  }

  void refreshAllAutoSources().then(() => {
    savedWallets = db.getSmartMoneyWalletsFromDB();
    loadSmartWallets(savedWallets);
    console.log(`[Server] Smart money pools ready (${savedWallets.length} wallets)`);
  }).catch(error => {
    console.error('[Server] Smart money initial pool refresh failed:', error);
  });

  startSmartMoneyRefreshScheduler();
  if (process.env.AUTO_START_TRADING !== 'false') {
    startMonitoring();
  }

  // Load blacklisted creators from DB
  const blacklisted = db.getBlacklistedCreators();
  for (const c of blacklisted) {
    blacklistCreator(c.address);
  }
  if (blacklisted.length > 0) {
    console.log(`[Server] Loaded ${blacklisted.length} blacklisted creators from DB`);
  }

  server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║       🐕 土狗猎手 TuGou Catcher Backend 🐕       ║
╠══════════════════════════════════════════════════╣
║  HTTP API:  http://localhost:${PORT}/api            ║
║  WebSocket: ws://localhost:${PORT}                  ║
║  Status:    Ready                                ║
╚══════════════════════════════════════════════════╝
    `);
  });
}
