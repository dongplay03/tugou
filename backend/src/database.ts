// ===== Database Layer (SQLite via better-sqlite3) =====

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  Trade, TokenData, PortfolioSnapshot, StrategyLog,
  StrategyWeights, Alert, TradePriceHistoryPoint, DiscoveryLog, SmartMoneyProviderRun, SmartMoneySource, SmartMoneyWallet, XMonitorPost, EntryStrategyMode, EntryStrategySettings,
  OpenNewsArticle, OpenNewsRefreshRun,
  ChainId, StrategyPerformance, ExperimentStrategyTag, RugRiskLevel,
} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'tugoucatcher.db');
const DB_PATH = process.env.DB_PATH?.trim()
  ? path.resolve(process.env.DB_PATH.trim())
  : DEFAULT_DB_PATH;

// Ensure data directory exists
import fs from 'fs';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db: DatabaseType = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function ensureColumn(tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function normalizeSmartMoneySource(value: unknown): SmartMoneySource {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';

  switch (normalized) {
    case 'gmgn':
    case 'ave':
    case 'bullx':
    case 'photon':
    case 'birdeye':
    case 'x':
    case 'telegram':
      return normalized as SmartMoneySource;
    default:
      return 'manual';
  }
}

function normalizeChainId(value: unknown): ChainId {
  return 'solana';
}

function normalizeExperimentStrategy(value: unknown): ExperimentStrategyTag {
  const normalized = typeof value === 'string' ? value.trim() : '';
  switch (normalized) {
    case 'liquidity_surge':
    case 'volume_absorption':
    case 'dip_reclaim':
    case 'high_turnover_low_mc':
    case 'smart_money_follow':
    case 'narrative_rotation':
    case 'social_pre_fomo':
    case 'momentum_breakout':
    case 'score_momentum':
      return normalized;
    default:
      return 'score_momentum';
  }
}

function normalizeRugRiskLevel(value: unknown): RugRiskLevel {
  switch (value) {
    case 'critical':
    case 'high':
    case 'medium':
    case 'low':
      return value;
    default:
      return 'low';
  }
}

function assertIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid identifier: ${identifier}`);
  }
  return identifier;
}

function quoteIdentifier(identifier: string): string {
  return `"${assertIdentifier(identifier)}"`;
}

// ===== Schema =====
db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    address TEXT PRIMARY KEY,
    chain_id TEXT DEFAULT 'solana',
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    pair_address TEXT,
    dex TEXT,
    price_usd REAL,
    price_native REAL,
    liquidity_usd REAL,
    volume_24h REAL,
    volume_1h REAL,
    market_cap REAL,
    fdv REAL,
    price_change_5m REAL,
    price_change_1h REAL,
    price_change_6h REAL,
    price_change_24h REAL,
    txns_buys_24h INTEGER,
    txns_sells_24h INTEGER,
    txns_buys_1h INTEGER,
    txns_sells_1h INTEGER,
    pair_created_at INTEGER,
    mint_authority_revoked INTEGER,
    freeze_authority_revoked INTEGER,
    top10_holder_pct REAL,
    holder_count INTEGER,
    mc_lp_ratio REAL,
    volume_to_mc_ratio REAL,
    buy_to_sell_ratio_1h REAL,
    screening_score REAL,
    screening_passed TEXT,
    screening_failed TEXT,
    eligible INTEGER DEFAULT 0,
    experiment_strategy TEXT DEFAULT 'score_momentum',
    rug_risk_score REAL DEFAULT 0,
    rug_risk_level TEXT DEFAULT 'low',
    rug_risk_reasons TEXT DEFAULT '[]',
    discovered_at INTEGER,
    last_updated INTEGER,
    image_url TEXT,
    creator_address TEXT,
    creator_rug_count INTEGER,
    creator_survival_count INTEGER,
    creator_rug_probability REAL,
    creator_risk_band TEXT,
    creator_history_sample_size INTEGER,
    creator_risk_confidence REAL,
    lp_locked INTEGER,
    lp_lock_platform TEXT,
    lp_creator_pct REAL,
    smart_money_buyers INTEGER DEFAULT 0,
    social_mentions INTEGER DEFAULT 0,
    social_urls TEXT,
    momentum_confirmed INTEGER DEFAULT 0,
    momentum_observations INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    chain_id TEXT DEFAULT 'solana',
    token_address TEXT NOT NULL,
    token_symbol TEXT NOT NULL,
    token_name TEXT NOT NULL,
    pair_address TEXT,
    entry_price_usd REAL,
    entry_price_native REAL,
    current_price_usd REAL,
    exit_price_usd REAL,
    entry_timestamp INTEGER,
    exit_timestamp INTEGER,
    amount_sol REAL,
    initial_amount_sol REAL DEFAULT 0,
    tokens_acquired REAL,
    status TEXT DEFAULT 'open',
    roi REAL,
    current_roi REAL DEFAULT 0,
    unrealized_pnl_sol REAL DEFAULT 0,
    realized_pnl_sol REAL DEFAULT 0,
    tp_multiplier REAL,
    sl_multiplier REAL,
    screening_score REAL,
    experiment_strategy TEXT DEFAULT 'score_momentum',
    rug_risk_score REAL DEFAULT 0,
    rug_risk_level TEXT DEFAULT 'low',
    rug_risk_reasons TEXT DEFAULT '[]',
    entry_reasons TEXT,
    narrative_tags TEXT,
    principal_recovered INTEGER DEFAULT 0,
    half_sold_price REAL,
    half_sold_timestamp INTEGER,
    recovered_sol REAL DEFAULT 0,
    highest_price_after_recovery REAL DEFAULT 0,
    trailing_stop_pct REAL DEFAULT 0.20,
    tiered_exits TEXT,
    tiered_exits_executed INTEGER DEFAULT 0,
    total_recovered_sol REAL DEFAULT 0,
    liquidity_at_entry REAL,
    current_liquidity REAL,
    last_price_update INTEGER
  );

  CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    total_value_sol REAL,
    cash_sol REAL,
    open_positions INTEGER,
    cumulative_pnl_sol REAL,
    cumulative_pnl_pct REAL
  );

  CREATE TABLE IF NOT EXISTS strategy_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    batch_number INTEGER,
    win_rate REAL,
    avg_roi REAL,
    changes TEXT,
    weights_snapshot TEXT,
    common_traits TEXT
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    level TEXT,
    title TEXT,
    message TEXT,
    token_symbol TEXT,
    token_address TEXT
  );

  CREATE TABLE IF NOT EXISTS trade_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    price_usd REAL NOT NULL,
    price_native REAL NOT NULL,
    liquidity_usd REAL NOT NULL,
    FOREIGN KEY(trade_id) REFERENCES trades(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS discovery_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    discovered_count INTEGER NOT NULL,
    screened_count INTEGER NOT NULL,
    eligible_count INTEGER NOT NULL,
    error_count INTEGER NOT NULL,
    pass_rate REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS token_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_address TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    price_usd REAL,
    liquidity_usd REAL,
    market_cap REAL,
    volume_1h REAL,
    screening_score REAL,
    eligible INTEGER DEFAULT 0,
    FOREIGN KEY(token_address) REFERENCES tokens(address) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tokens_discovered_at ON tokens(discovered_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tokens_last_updated ON tokens(last_updated DESC);
  CREATE INDEX IF NOT EXISTS idx_tokens_screening_score ON tokens(screening_score DESC);
  CREATE INDEX IF NOT EXISTS idx_tokens_symbol_nocase ON tokens(symbol COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_tokens_name_nocase ON tokens(name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_tokens_eligible ON tokens(eligible);
  CREATE INDEX IF NOT EXISTS idx_trades_status_entry ON trades(status, entry_timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_trade_price_history_trade_time ON trade_price_history(trade_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_discovery_logs_timestamp ON discovery_logs(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_token_snapshots_token_time ON token_snapshots(token_address, timestamp DESC);
`);

ensureColumn('trades', 'initial_amount_sol', 'REAL DEFAULT 0');
ensureColumn('trades', 'chain_id', "TEXT DEFAULT 'solana'");
ensureColumn('trades', 'experiment_strategy', "TEXT DEFAULT 'score_momentum'");
ensureColumn('trades', 'rug_risk_score', 'REAL DEFAULT 0');
ensureColumn('trades', 'rug_risk_level', "TEXT DEFAULT 'low'");
ensureColumn('trades', 'rug_risk_reasons', "TEXT DEFAULT '[]'");
ensureColumn('tokens', 'chain_id', "TEXT DEFAULT 'solana'");
ensureColumn('tokens', 'experiment_strategy', "TEXT DEFAULT 'score_momentum'");
ensureColumn('tokens', 'rug_risk_score', 'REAL DEFAULT 0');
ensureColumn('tokens', 'rug_risk_level', "TEXT DEFAULT 'low'");
ensureColumn('tokens', 'rug_risk_reasons', "TEXT DEFAULT '[]'");
ensureColumn('tokens', 'creator_rug_probability', 'REAL');
ensureColumn('tokens', 'creator_risk_band', 'TEXT');
ensureColumn('tokens', 'creator_history_sample_size', 'INTEGER');
ensureColumn('tokens', 'creator_risk_confidence', 'REAL');
ensureColumn('tokens', 'creator_dev_launched_token_count', 'INTEGER');
ensureColumn('tokens', 'creator_dev_rug_rate', 'REAL');
ensureColumn('tokens', 'creator_dev_history', "TEXT DEFAULT '[]'");

const insertTokenSnapshot = db.prepare(`
  INSERT INTO token_snapshots (
    token_address, timestamp, symbol, price_usd, liquidity_usd,
    market_cap, volume_1h, screening_score, eligible
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertTradePriceHistory = db.prepare(`
  INSERT INTO trade_price_history (
    trade_id, timestamp, price_usd, price_native, liquidity_usd
  ) VALUES (?, ?, ?, ?, ?)
`);

const insertDiscoveryLog = db.prepare(`
  INSERT INTO discovery_logs (
    timestamp, duration_ms, discovered_count, screened_count,
    eligible_count, error_count, pass_rate
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// ===== Token CRUD =====
const insertToken = db.prepare(`
  INSERT OR REPLACE INTO tokens (
    address, chain_id, symbol, name, pair_address, dex, price_usd, price_native,
    liquidity_usd, volume_24h, volume_1h, market_cap, fdv,
    price_change_5m, price_change_1h, price_change_6h, price_change_24h,
    txns_buys_24h, txns_sells_24h, txns_buys_1h, txns_sells_1h,
    pair_created_at, mint_authority_revoked, freeze_authority_revoked,
    top10_holder_pct, holder_count, mc_lp_ratio, volume_to_mc_ratio,
    buy_to_sell_ratio_1h, screening_score, screening_passed, screening_failed,
    eligible, experiment_strategy, rug_risk_score, rug_risk_level, rug_risk_reasons,
    discovered_at, last_updated, image_url,
    creator_address, creator_rug_count, creator_survival_count,
    creator_rug_probability, creator_risk_band, creator_history_sample_size, creator_risk_confidence,
    creator_dev_launched_token_count, creator_dev_rug_rate, creator_dev_history,
    lp_locked, lp_lock_platform, lp_creator_pct,
    smart_money_buyers, social_mentions, social_urls,
    momentum_confirmed, momentum_observations
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
`);

export function saveToken(t: TokenData): void {
  db.transaction(() => {
    insertToken.run(
      t.address, t.chainId ?? 'solana', t.symbol, t.name, t.pairAddress, t.dex, t.priceUsd, t.priceNative,
      t.liquidityUsd, t.volume24h, t.volume1h, t.marketCap, t.fdv,
      t.priceChange5m, t.priceChange1h, t.priceChange6h, t.priceChange24h,
      t.txnsBuys24h, t.txnsSells24h, t.txnsBuys1h, t.txnsSells1h,
      t.pairCreatedAt, t.mintAuthorityRevoked === null ? null : t.mintAuthorityRevoked ? 1 : 0,
      t.freezeAuthorityRevoked === null ? null : t.freezeAuthorityRevoked ? 1 : 0,
      t.top10HolderPct, t.holderCount, t.mcLpRatio, t.volumeToMcRatio,
      t.buyToSellRatio1h, t.screeningScore, JSON.stringify(t.screeningPassed),
      JSON.stringify(t.screeningFailed), t.eligible ? 1 : 0,
      t.experimentStrategy ?? 'score_momentum', t.rugRiskScore ?? 0, t.rugRiskLevel ?? 'low', JSON.stringify(t.rugRiskReasons ?? []),
      t.discoveredAt, t.lastUpdated, t.imageUrl ?? null,
      t.creatorAddress ?? null, t.creatorRugCount ?? null, t.creatorSurvivalCount ?? null,
      t.creatorRugProbability ?? null, t.creatorRiskBand ?? null, t.creatorHistorySampleSize ?? null, t.creatorRiskConfidence ?? null,
      t.creatorDevLaunchedTokenCount ?? null, t.creatorDevRugRate ?? null, JSON.stringify(t.creatorDevHistory ?? []),
      t.lpLocked === null || t.lpLocked === undefined ? null : t.lpLocked ? 1 : 0,
      t.lpLockPlatform ?? null, t.lpCreatorPct ?? null,
      t.smartMoneyBuyers ?? 0, t.socialMentions ?? 0,
      JSON.stringify(t.socialUrls ?? []),
      t.momentumConfirmed ? 1 : 0, t.momentumObservations ?? 0
    );

    insertTokenSnapshot.run(
      t.address,
      t.lastUpdated,
      t.symbol,
      t.priceUsd,
      t.liquidityUsd,
      t.marketCap,
      t.volume1h,
      t.screeningScore,
      t.eligible ? 1 : 0,
    );
  })();
}

export function getRecentTokens(limit = 50, chainId?: ChainId): TokenData[] {
  const rows = chainId
    ? db.prepare(
      'SELECT * FROM tokens WHERE chain_id = ? ORDER BY discovered_at DESC LIMIT ?'
    ).all(chainId, limit) as any[]
    : db.prepare(
      'SELECT * FROM tokens ORDER BY discovered_at DESC LIMIT ?'
    ).all(limit) as any[];
  return rows.map(rowToToken);
}

export function getEligibleTokens(): TokenData[] {
  const rows = db.prepare(
    'SELECT * FROM tokens WHERE eligible = 1 ORDER BY screening_score DESC'
  ).all() as any[];
  return rows.map(rowToToken);
}

export function getToken(address: string): TokenData | null {
  const row = db.prepare('SELECT * FROM tokens WHERE address = ?').get(address) as any;
  return row ? rowToToken(row) : null;
}

export function searchTokens(query: string, limit = 24, chainId?: ChainId): TokenData[] {
  const keyword = query.trim();
  if (!keyword) {
    const rows = chainId
      ? db.prepare('SELECT * FROM tokens WHERE chain_id = ? ORDER BY last_updated DESC LIMIT ?').all(chainId, limit) as any[]
      : db.prepare('SELECT * FROM tokens ORDER BY last_updated DESC LIMIT ?').all(limit) as any[];
    return rows.map(rowToToken);
  }

  const rows = db.prepare(`
    SELECT *
    FROM tokens
    WHERE (@chainId IS NULL OR chain_id = @chainId)
      AND (
        symbol LIKE @prefix COLLATE NOCASE
        OR symbol LIKE @contains COLLATE NOCASE
        OR name LIKE @contains COLLATE NOCASE
        OR address LIKE @contains COLLATE NOCASE
      )
    ORDER BY
      CASE
        WHEN symbol = @exact THEN 0
        WHEN symbol LIKE @prefix COLLATE NOCASE THEN 1
        WHEN name LIKE @prefix COLLATE NOCASE THEN 2
        ELSE 3
      END,
      eligible DESC,
      screening_score DESC,
      last_updated DESC
    LIMIT @limit
  `).all({
    exact: keyword,
    prefix: `${keyword}%`,
    contains: `%${keyword}%`,
    chainId: chainId ?? null,
    limit,
  }) as any[];

  return rows.map(rowToToken);
}

function rowToToken(r: any): TokenData {
  return {
    chainId: normalizeChainId(r.chain_id),
    address: r.address,
    symbol: r.symbol,
    name: r.name,
    pairAddress: r.pair_address,
    dex: r.dex,
    priceUsd: r.price_usd,
    priceNative: r.price_native,
    liquidityUsd: r.liquidity_usd,
    volume24h: r.volume_24h,
    volume1h: r.volume_1h,
    marketCap: r.market_cap,
    fdv: r.fdv,
    priceChange5m: r.price_change_5m,
    priceChange1h: r.price_change_1h,
    priceChange6h: r.price_change_6h,
    priceChange24h: r.price_change_24h,
    txnsBuys24h: r.txns_buys_24h,
    txnsSells24h: r.txns_sells_24h,
    txnsBuys1h: r.txns_buys_1h,
    txnsSells1h: r.txns_sells_1h,
    pairCreatedAt: r.pair_created_at,
    mintAuthorityRevoked: r.mint_authority_revoked === null ? null : r.mint_authority_revoked === 1,
    freezeAuthorityRevoked: r.freeze_authority_revoked === null ? null : r.freeze_authority_revoked === 1,
    top10HolderPct: r.top10_holder_pct,
    holderCount: r.holder_count,
    mcLpRatio: r.mc_lp_ratio,
    volumeToMcRatio: r.volume_to_mc_ratio,
    buyToSellRatio1h: r.buy_to_sell_ratio_1h,
    creatorAddress: r.creator_address ?? null,
    creatorRugCount: r.creator_rug_count ?? null,
    creatorSurvivalCount: r.creator_survival_count ?? null,
    creatorRugProbability: r.creator_rug_probability ?? null,
    creatorRiskBand: r.creator_risk_band ?? null,
    creatorHistorySampleSize: r.creator_history_sample_size ?? null,
    creatorRiskConfidence: r.creator_risk_confidence ?? null,
    creatorDevLaunchedTokenCount: r.creator_dev_launched_token_count ?? null,
    creatorDevRugRate: r.creator_dev_rug_rate ?? null,
    creatorDevHistory: JSON.parse(r.creator_dev_history || '[]'),
    lpLocked: r.lp_locked === null ? null : r.lp_locked === 1,
    lpLockPlatform: r.lp_lock_platform ?? null,
    lpCreatorPct: r.lp_creator_pct ?? null,
    smartMoneyBuyers: r.smart_money_buyers ?? 0,
    socialMentions: r.social_mentions ?? 0,
    socialUrls: JSON.parse(r.social_urls || '[]'),
    momentumConfirmed: r.momentum_confirmed === 1,
    momentumObservations: r.momentum_observations ?? 0,
    screeningScore: r.screening_score,
    screeningPassed: JSON.parse(r.screening_passed || '[]'),
    screeningFailed: JSON.parse(r.screening_failed || '[]'),
    eligible: r.eligible === 1,
    experimentStrategy: normalizeExperimentStrategy(r.experiment_strategy),
    rugRiskScore: r.rug_risk_score ?? 0,
    rugRiskLevel: normalizeRugRiskLevel(r.rug_risk_level),
    rugRiskReasons: JSON.parse(r.rug_risk_reasons || '[]'),
    discoveredAt: r.discovered_at,
    lastUpdated: r.last_updated,
    imageUrl: r.image_url ?? undefined,
  };
}

// ===== Trade CRUD =====
const insertTrade = db.prepare(`
  INSERT OR REPLACE INTO trades (
    id, chain_id, token_address, token_symbol, token_name, pair_address,
    entry_price_usd, entry_price_native, current_price_usd, exit_price_usd,
    entry_timestamp, exit_timestamp, amount_sol, initial_amount_sol, tokens_acquired,
    status, roi, current_roi, unrealized_pnl_sol, realized_pnl_sol,
    tp_multiplier, sl_multiplier, screening_score, experiment_strategy,
    rug_risk_score, rug_risk_level, rug_risk_reasons,
    entry_reasons, narrative_tags,
    principal_recovered, half_sold_price, half_sold_timestamp, recovered_sol,
    highest_price_after_recovery, trailing_stop_pct,
    tiered_exits, tiered_exits_executed, total_recovered_sol,
    liquidity_at_entry, current_liquidity, last_price_update
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
`);

export function saveTrade(t: Trade): void {
  db.transaction(() => {
    insertTrade.run(
      t.id, t.chainId ?? 'solana', t.tokenAddress, t.tokenSymbol, t.tokenName, t.pairAddress,
      t.entryPriceUsd, t.entryPriceNative, t.currentPriceUsd, t.exitPriceUsd,
      t.entryTimestamp, t.exitTimestamp, t.amountSOL, t.initialAmountSOL, t.tokensAcquired,
      t.status, t.roi, t.currentRoi, t.unrealizedPnlSOL, t.realizedPnlSOL,
      t.takeProfitMultiplier, t.stopLossMultiplier, t.screeningScore,
      t.experimentStrategy ?? 'score_momentum',
      t.rugRiskScore ?? 0, t.rugRiskLevel ?? 'low', JSON.stringify(t.rugRiskReasons ?? []),
      JSON.stringify(t.entryReasons), JSON.stringify(t.narrativeTags),
      t.principalRecovered ? 1 : 0, t.halfSoldPrice, t.halfSoldTimestamp, t.recoveredSOL,
      t.highestPriceAfterRecovery, t.trailingStopPct,
      JSON.stringify(t.tieredExits), t.tieredExitsExecuted, t.totalRecoveredSOL,
      t.liquidityAtEntry, t.currentLiquidity, t.lastPriceUpdate
    );
  })();
}

export function saveTradePriceHistoryPoint(tradeId: string, timestamp: number, priceUsd: number, priceNative: number, liquidityUsd: number): void {
  insertTradePriceHistory.run(tradeId, timestamp, priceUsd, priceNative, liquidityUsd);
}

export function getTradePriceHistory(tradeId: string, limit = 200): TradePriceHistoryPoint[] {
  const rows = db.prepare(`
    SELECT *
    FROM trade_price_history
    WHERE trade_id = ?
    ORDER BY timestamp ASC
    LIMIT ?
  `).all(tradeId, limit) as any[];

  return rows.map(r => ({
    id: r.id,
    tradeId: r.trade_id,
    timestamp: r.timestamp,
    priceUsd: r.price_usd,
    priceNative: r.price_native,
    liquidityUsd: r.liquidity_usd,
  }));
}

export function getRecentTradePriceHistory(tradeId: string, limit = 8): TradePriceHistoryPoint[] {
  const rows = db.prepare(`
    SELECT *
    FROM trade_price_history
    WHERE trade_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(tradeId, limit) as any[];

  return rows.reverse().map(r => ({
    id: r.id,
    tradeId: r.trade_id,
    timestamp: r.timestamp,
    priceUsd: r.price_usd,
    priceNative: r.price_native,
    liquidityUsd: r.liquidity_usd,
  }));
}

export function getOpenTrades(chainId?: ChainId): Trade[] {
  const rows = chainId
    ? db.prepare("SELECT * FROM trades WHERE status = 'open' AND chain_id = ? ORDER BY entry_timestamp DESC").all(chainId) as any[]
    : db.prepare("SELECT * FROM trades WHERE status = 'open' ORDER BY entry_timestamp DESC").all() as any[];
  return rows.map(rowToTrade);
}

export function getAllTrades(chainId?: ChainId): Trade[] {
  const rows = chainId
    ? db.prepare('SELECT * FROM trades WHERE chain_id = ? ORDER BY entry_timestamp DESC').all(chainId) as any[]
    : db.prepare('SELECT * FROM trades ORDER BY entry_timestamp DESC').all() as any[];
  return rows.map(rowToTrade);
}

export function getClosedTrades(chainId?: ChainId): Trade[] {
  const rows = chainId
    ? db.prepare("SELECT * FROM trades WHERE status != 'open' AND chain_id = ? ORDER BY exit_timestamp DESC").all(chainId) as any[]
    : db.prepare("SELECT * FROM trades WHERE status != 'open' ORDER BY exit_timestamp DESC").all() as any[];
  return rows.map(rowToTrade);
}

export function getStrategyPerformance(): StrategyPerformance[] {
  const rows = db.prepare(`
    SELECT
      COALESCE(experiment_strategy, 'unknown') as strategy,
      COALESCE(chain_id, 'solana') as chain_id,
      COUNT(*) as trades,
      SUM(CASE WHEN COALESCE(roi, 0) > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN COALESCE(roi, 0) <= 0 THEN 1 ELSE 0 END) as losses,
      AVG(COALESCE(roi, 0)) as avg_roi,
      SUM(COALESCE(realized_pnl_sol, 0)) as total_pnl,
      MAX(roi) as best_roi,
      MIN(roi) as worst_roi
    FROM trades
    WHERE status != 'open'
    GROUP BY strategy, chain_id
    ORDER BY total_pnl DESC, trades DESC
  `).all() as any[];

  return rows.map(row => ({
    strategy: normalizeExperimentStrategy(row.strategy),
    chainId: normalizeChainId(row.chain_id),
    trades: row.trades,
    wins: row.wins,
    losses: row.losses,
    winRate: row.trades > 0 ? row.wins / row.trades : 0,
    avgROI: row.avg_roi ?? 0,
    totalPnlSOL: row.total_pnl ?? 0,
    bestROI: row.best_roi,
    worstROI: row.worst_roi,
  }));
}

export function getTrade(id: string): Trade | null {
  const row = db.prepare('SELECT * FROM trades WHERE id = ?').get(id) as any;
  return row ? rowToTrade(row) : null;
}

export function getClosedTradesCount(): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM trades WHERE status != 'open'").get() as any;
  return row.count;
}

function rowToTrade(r: any): Trade {
  return {
    id: r.id,
    chainId: normalizeChainId(r.chain_id),
    tokenAddress: r.token_address,
    tokenSymbol: r.token_symbol,
    tokenName: r.token_name,
    pairAddress: r.pair_address,
    entryPriceUsd: r.entry_price_usd,
    entryPriceNative: r.entry_price_native,
    currentPriceUsd: r.current_price_usd,
    exitPriceUsd: r.exit_price_usd,
    entryTimestamp: r.entry_timestamp,
    exitTimestamp: r.exit_timestamp,
    amountSOL: r.amount_sol,
    initialAmountSOL: r.initial_amount_sol ?? r.amount_sol,
    tokensAcquired: r.tokens_acquired,
    status: r.status,
    roi: r.roi,
    currentRoi: r.current_roi,
    unrealizedPnlSOL: r.unrealized_pnl_sol,
    realizedPnlSOL: r.realized_pnl_sol,
    takeProfitMultiplier: r.tp_multiplier,
    stopLossMultiplier: r.sl_multiplier,
    screeningScore: r.screening_score,
    experimentStrategy: normalizeExperimentStrategy(r.experiment_strategy),
    rugRiskScore: r.rug_risk_score ?? 0,
    rugRiskLevel: normalizeRugRiskLevel(r.rug_risk_level),
    rugRiskReasons: JSON.parse(r.rug_risk_reasons || '[]'),
    entryReasons: JSON.parse(r.entry_reasons || '[]'),
    narrativeTags: JSON.parse(r.narrative_tags || '[]'),
    principalRecovered: r.principal_recovered === 1,
    halfSoldPrice: r.half_sold_price,
    halfSoldTimestamp: r.half_sold_timestamp,
    recoveredSOL: r.recovered_sol,
    highestPriceAfterRecovery: r.highest_price_after_recovery,
    trailingStopPct: r.trailing_stop_pct,
    tieredExits: JSON.parse(r.tiered_exits || '[]'),
    tieredExitsExecuted: r.tiered_exits_executed ?? 0,
    totalRecoveredSOL: r.total_recovered_sol ?? 0,
    liquidityAtEntry: r.liquidity_at_entry,
    currentLiquidity: r.current_liquidity,
    lastPriceUpdate: r.last_price_update,
  };
}

// ===== Portfolio Snapshots =====
export function saveSnapshot(s: PortfolioSnapshot): void {
  db.prepare(`
    INSERT INTO portfolio_snapshots (timestamp, total_value_sol, cash_sol, open_positions, cumulative_pnl_sol, cumulative_pnl_pct)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(s.timestamp, s.totalValueSOL, s.cashSOL, s.openPositions, s.cumulativePnlSOL, s.cumulativePnlPct);
}

export function getSnapshots(limit = 200): PortfolioSnapshot[] {
  const rows = db.prepare('SELECT * FROM portfolio_snapshots ORDER BY timestamp ASC LIMIT ?').all(limit) as any[];
  return rows.map(r => ({
    timestamp: r.timestamp,
    totalValueSOL: r.total_value_sol,
    cashSOL: r.cash_sol,
    openPositions: r.open_positions,
    cumulativePnlSOL: r.cumulative_pnl_sol,
    cumulativePnlPct: r.cumulative_pnl_pct,
  }));
}

// ===== Strategy Logs =====
export function saveStrategyLog(log: StrategyLog): void {
  db.prepare(`
    INSERT INTO strategy_logs (timestamp, batch_number, win_rate, avg_roi, changes, weights_snapshot, common_traits)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    log.timestamp, log.batchNumber, log.winRate, log.avgROI,
    JSON.stringify(log.changes), JSON.stringify(log.weightsSnapshot), JSON.stringify(log.commonTraits)
  );
}

export function getStrategyLogs(): StrategyLog[] {
  const rows = db.prepare('SELECT * FROM strategy_logs ORDER BY timestamp ASC').all() as any[];
  return rows.map(r => ({
    id: r.id,
    timestamp: r.timestamp,
    batchNumber: r.batch_number,
    winRate: r.win_rate,
    avgROI: r.avg_roi,
    changes: JSON.parse(r.changes || '[]'),
    weightsSnapshot: JSON.parse(r.weights_snapshot || '{}'),
    commonTraits: JSON.parse(r.common_traits || '[]'),
  }));
}

export function saveDiscoveryLog(log: Omit<DiscoveryLog, 'id'>): void {
  insertDiscoveryLog.run(
    log.timestamp,
    log.durationMs,
    log.discoveredCount,
    log.screenedCount,
    log.eligibleCount,
    log.errorCount,
    log.passRate,
  );
}

export function getDiscoveryLogs(limit = 100): DiscoveryLog[] {
  const rows = db.prepare(`
    SELECT *
    FROM discovery_logs
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map(r => ({
    id: r.id,
    timestamp: r.timestamp,
    durationMs: r.duration_ms,
    discoveredCount: r.discovered_count,
    screenedCount: r.screened_count,
    eligibleCount: r.eligible_count,
    errorCount: r.error_count,
    passRate: r.pass_rate,
  }));
}

// ===== Alerts =====
export function saveAlert(a: Alert): void {
  db.prepare(`
    INSERT OR REPLACE INTO alerts (id, timestamp, level, title, message, token_symbol, token_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(a.id, a.timestamp, a.level, a.title, a.message, a.tokenSymbol ?? null, a.tokenAddress ?? null);
}

export function getAlerts(limit = 50): Alert[] {
  const rows = db.prepare('SELECT * FROM alerts ORDER BY timestamp DESC LIMIT ?').all(limit) as any[];
  return rows.map(r => ({
    id: r.id,
    timestamp: r.timestamp,
    level: r.level,
    title: r.title,
    message: r.message,
    tokenSymbol: r.token_symbol ?? undefined,
    tokenAddress: r.token_address ?? undefined,
  }));
}

// ===== Config =====
export function getConfig(key: string, defaultValue: string): string {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as any;
  return row ? row.value : defaultValue;
}

export function setConfig(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value);
}

function getCashConfigKey(_chainId: ChainId): string {
  return 'cash_sol';
}

export function getCash(_chainId: ChainId = 'solana'): number {
  return parseFloat(getConfig(getCashConfigKey('solana'), '1.0'));
}

export function setCash(value: number, _chainId: ChainId = 'solana'): void {
  setConfig(getCashConfigKey('solana'), value.toString());
}

export function getMaxHoldHours(): number {
  return parseFloat(getConfig('max_hold_hours', '48'));
}

export function setMaxHoldHours(value: number): void {
  setConfig('max_hold_hours', value.toString());
}

export function getWeights(): StrategyWeights {
  const raw = getConfig('strategy_weights', '');
  if (!raw) return getDefaultWeights();
  try {
    return JSON.parse(raw);
  } catch {
    return getDefaultWeights();
  }
}

export function setWeights(w: StrategyWeights): void {
  setConfig('strategy_weights', JSON.stringify(w));
}

export function getEntryStrategyMode(): EntryStrategyMode {
  return 'unified';
}

export function setEntryStrategyMode(_mode: EntryStrategyMode): void {
  setConfig('entry_strategy_mode', 'unified');
}

export function getDirectEntryMinScore(): number {
  return parseFloat(getConfig('direct_entry_min_score', '70'));
}

export function setDirectEntryMinScore(value: number): void {
  setConfig('direct_entry_min_score', value.toString());
}

export function getDirectEntryMinLiquidityUsd(): number {
  return parseFloat(getConfig('direct_entry_min_liquidity_usd', '50000'));
}

export function setDirectEntryMinLiquidityUsd(value: number): void {
  setConfig('direct_entry_min_liquidity_usd', value.toString());
}

export function getEntryStrategySettings(): EntryStrategySettings {
  return {
    mode: getEntryStrategyMode(),
    directEntryMinScore: getDirectEntryMinScore(),
    directEntryMinLiquidityUsd: getDirectEntryMinLiquidityUsd(),
  };
}

function getDefaultWeights(): StrategyWeights {
  return {
    contractSafety: 20,
    liquidityDepth: 15,
    volumeRatio: 10,
    mcLpRatio: 10,
    holderDistribution: 10,
    buyPressure: 10,
    smartMoneySignal: 10,
    freshness: 5,
    narrativeBonus: {
      'AI': 4,
      'Political': 2,
      'Meme': 3,
      'Celebrity': 2,
      'DeFi': 2,
      'Gaming': 1,
    },
  };
}

export function getLastBatchNumber(): number {
  const row = db.prepare('SELECT MAX(batch_number) as max_batch FROM strategy_logs').get() as any;
  return row?.max_batch || 0;
}

export function cleanupExpiredData(now = Date.now()): { deletedTokens: number; deletedAlerts: number; deletedTokenSnapshots: number } {
  const tokenCutoff = now - 30 * 24 * 60 * 60 * 1000;
  const alertCutoff = now - 7 * 24 * 60 * 60 * 1000;

  const deleteOldSnapshots = db.prepare('DELETE FROM token_snapshots WHERE timestamp < ?');
  const deleteOldAlerts = db.prepare('DELETE FROM alerts WHERE timestamp < ?');
  const deleteOldTokens = db.prepare(`
    DELETE FROM tokens
    WHERE last_updated < ?
      AND address NOT IN (SELECT DISTINCT token_address FROM trades)
  `);

  const result = db.transaction(() => ({
    deletedTokenSnapshots: deleteOldSnapshots.run(tokenCutoff).changes,
    deletedAlerts: deleteOldAlerts.run(alertCutoff).changes,
    deletedTokens: deleteOldTokens.run(tokenCutoff).changes,
  }))();

  return result;
}

export function runInTransaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}

// ===== Config CRUD (for frontend config page) =====
export function getAllConfig(): Array<{ key: string; value: string }> {
  return db.prepare('SELECT key, value FROM config ORDER BY key').all() as Array<{ key: string; value: string }>;
}

export function deleteConfig(key: string): boolean {
  const result = db.prepare('DELETE FROM config WHERE key = ?').run(key);
  return result.changes > 0;
}

// ===== Smart Money Wallets persistence =====
db.exec(`
  CREATE TABLE IF NOT EXISTS smart_money_wallets (
    address TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    win_rate REAL DEFAULT 0,
    avg_roi REAL DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    last_seen INTEGER DEFAULT 0,
    added_at INTEGER DEFAULT 0
  );
`);

ensureColumn('smart_money_wallets', 'source', "TEXT DEFAULT 'manual'");
ensureColumn('smart_money_wallets', 'notes', "TEXT DEFAULT ''");
ensureColumn('smart_money_wallets', 'is_auto_imported', 'INTEGER DEFAULT 0');
ensureColumn('smart_money_wallets', 'provider_ref', "TEXT DEFAULT ''");
ensureColumn('smart_money_wallets', 'refreshed_at', 'INTEGER DEFAULT 0');

export function getSmartMoneyWalletsFromDB(): SmartMoneyWallet[] {
  const rows = db.prepare('SELECT * FROM smart_money_wallets ORDER BY added_at DESC').all() as any[];
  return rows.map(r => ({
    address: r.address,
    label: r.label,
    source: normalizeSmartMoneySource(r.source),
    notes: r.notes ?? '',
    winRate: r.win_rate,
    avgROI: r.avg_roi,
    totalTrades: r.total_trades,
    lastSeen: r.last_seen,
    addedAt: r.added_at ?? 0,
    isAutoImported: r.is_auto_imported === 1,
    providerRef: r.provider_ref ?? '',
    refreshedAt: r.refreshed_at ?? 0,
  }));
}

export function saveSmartMoneyWallet(w: {
  address: string; label: string; source?: SmartMoneySource; notes?: string;
  winRate?: number; avgROI?: number; totalTrades?: number; lastSeen?: number; addedAt?: number;
  isAutoImported?: boolean; providerRef?: string; refreshedAt?: number;
}): void {
  db.prepare(`
    INSERT OR REPLACE INTO smart_money_wallets (
      address, label, source, notes, win_rate, avg_roi, total_trades, last_seen, added_at,
      is_auto_imported, provider_ref, refreshed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    w.address,
    w.label,
    normalizeSmartMoneySource(w.source),
    w.notes ?? '',
    w.winRate ?? 0,
    w.avgROI ?? 0,
    w.totalTrades ?? 0,
    w.lastSeen ?? 0,
    w.addedAt ?? Date.now(),
    w.isAutoImported ? 1 : 0,
    w.providerRef ?? '',
    w.refreshedAt ?? 0,
  );
}

export function saveSmartMoneyWalletsBulk(wallets: Array<{
  address: string; label: string; source?: SmartMoneySource; notes?: string;
  winRate?: number; avgROI?: number; totalTrades?: number; lastSeen?: number; addedAt?: number;
  isAutoImported?: boolean; providerRef?: string; refreshedAt?: number;
}>): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO smart_money_wallets (
      address, label, source, notes, win_rate, avg_roi, total_trades, last_seen, added_at,
      is_auto_imported, provider_ref, refreshed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction((rows: typeof wallets) => {
    for (const w of rows) {
      insert.run(
        w.address,
        w.label,
        normalizeSmartMoneySource(w.source),
        w.notes ?? '',
        w.winRate ?? 0,
        w.avgROI ?? 0,
        w.totalTrades ?? 0,
        w.lastSeen ?? 0,
        w.addedAt ?? Date.now(),
        w.isAutoImported ? 1 : 0,
        w.providerRef ?? '',
        w.refreshedAt ?? 0,
      );
    }
  })(wallets);
}

export function replaceAutoImportedSmartMoneyWallets(source: SmartMoneySource, wallets: SmartMoneyWallet[]): void {
  db.transaction((rows: SmartMoneyWallet[]) => {
    const addresses = rows.map(row => row.address);
    if (addresses.length > 0) {
      const placeholders = addresses.map(() => '?').join(', ');
      db.prepare(`
        DELETE FROM smart_money_wallets
        WHERE source = ?
          AND is_auto_imported = 1
          AND address NOT IN (${placeholders})
      `).run(source, ...addresses);
    } else {
      db.prepare('DELETE FROM smart_money_wallets WHERE source = ? AND is_auto_imported = 1').run(source);
    }

    saveSmartMoneyWalletsBulk(rows.map(row => ({
      ...row,
      source,
      isAutoImported: true,
    })));
  })(wallets);
}

export function deleteSmartMoneyWallet(address: string): boolean {
  const result = db.prepare('DELETE FROM smart_money_wallets WHERE address = ?').run(address);
  return result.changes > 0;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS smart_money_provider_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER NOT NULL,
    wallet_count INTEGER DEFAULT 0,
    message TEXT DEFAULT ''
  );
`);

export function saveSmartMoneyProviderRun(run: Omit<SmartMoneyProviderRun, 'id'>): number {
  const result = db.prepare(`
    INSERT INTO smart_money_provider_runs (
      source, status, started_at, finished_at, wallet_count, message
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    normalizeSmartMoneySource(run.source),
    run.status,
    run.startedAt,
    run.finishedAt,
    run.walletCount,
    run.message,
  );

  return Number(result.lastInsertRowid);
}

export function getSmartMoneyProviderRuns(limit = 50): SmartMoneyProviderRun[] {
  const rows = db.prepare(`
    SELECT *
    FROM smart_money_provider_runs
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map(row => ({
    id: row.id,
    source: normalizeSmartMoneySource(row.source),
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    walletCount: row.wallet_count,
    message: row.message ?? '',
  }));
}

db.exec(`
  CREATE TABLE IF NOT EXISTS x_monitor_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT UNIQUE NOT NULL,
    author_handle TEXT NOT NULL,
    text TEXT NOT NULL,
    url TEXT NOT NULL,
    posted_at INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL,
    cashtags TEXT DEFAULT '[]',
    narrative_tags TEXT DEFAULT '[]'
  );
`);

export function saveXMonitorPosts(posts: Array<Omit<XMonitorPost, 'id'>>): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO x_monitor_posts (
      post_id, author_handle, text, url, posted_at, fetched_at, cashtags, narrative_tags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction((rows: Array<Omit<XMonitorPost, 'id'>>) => {
    for (const row of rows) {
      insert.run(
        row.postId,
        row.authorHandle,
        row.text,
        row.url,
        row.postedAt,
        row.fetchedAt,
        JSON.stringify(row.cashtags),
        JSON.stringify(row.narrativeTags),
      );
    }
  })(posts);
}

export function getXMonitorPosts(limit = 40): XMonitorPost[] {
  const rows = db.prepare(`
    SELECT *
    FROM x_monitor_posts
    ORDER BY posted_at DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map(row => ({
    id: row.id,
    postId: row.post_id,
    authorHandle: row.author_handle,
    text: row.text,
    url: row.url,
    postedAt: row.posted_at,
    fetchedAt: row.fetched_at,
    cashtags: JSON.parse(row.cashtags || '[]'),
    narrativeTags: JSON.parse(row.narrative_tags || '[]'),
  }));
}

db.exec(`
  CREATE TABLE IF NOT EXISTS opennews_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id TEXT UNIQUE NOT NULL,
    text TEXT NOT NULL,
    link TEXT DEFAULT '',
    engine_type TEXT NOT NULL,
    news_type TEXT NOT NULL,
    coins TEXT DEFAULT '[]',
    ai_score REAL DEFAULT 0,
    ai_grade TEXT DEFAULT '',
    ai_signal TEXT DEFAULT '',
    ai_status TEXT DEFAULT '',
    ai_summary TEXT DEFAULT '',
    en_summary TEXT DEFAULT '',
    published_at INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS opennews_refresh_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER NOT NULL,
    article_count INTEGER DEFAULT 0,
    message TEXT DEFAULT ''
  );
`);

export function saveOpenNewsArticles(articles: Array<Omit<OpenNewsArticle, 'id'>>): void {
  const replace = db.prepare(`
    INSERT OR REPLACE INTO opennews_articles (
      article_id, text, link, engine_type, news_type, coins,
      ai_score, ai_grade, ai_signal, ai_status, ai_summary, en_summary,
      published_at, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction((rows: Array<Omit<OpenNewsArticle, 'id'>>) => {
    for (const article of rows) {
      replace.run(
        article.articleId,
        article.text,
        article.link,
        article.engineType,
        article.newsType,
        JSON.stringify(article.coins),
        article.aiScore,
        article.aiGrade,
        article.aiSignal,
        article.aiStatus,
        article.aiSummary,
        article.enSummary,
        article.publishedAt,
        article.fetchedAt,
      );
    }
  })(articles);
}

export function getOpenNewsArticles(limit = 120): OpenNewsArticle[] {
  const rows = db.prepare(`
    SELECT *
    FROM opennews_articles
    ORDER BY published_at DESC, id DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map(row => ({
    id: row.id,
    articleId: String(row.article_id),
    text: row.text,
    link: row.link ?? '',
    engineType: row.engine_type,
    newsType: row.news_type,
    coins: JSON.parse(row.coins || '[]'),
    aiScore: row.ai_score ?? 0,
    aiGrade: row.ai_grade ?? '',
    aiSignal: row.ai_signal ?? '',
    aiStatus: row.ai_status ?? '',
    aiSummary: row.ai_summary ?? '',
    enSummary: row.en_summary ?? '',
    publishedAt: row.published_at ?? 0,
    fetchedAt: row.fetched_at ?? 0,
  }));
}

export function saveOpenNewsRefreshRun(run: Omit<OpenNewsRefreshRun, 'id'>): number {
  const result = db.prepare(`
    INSERT INTO opennews_refresh_runs (
      status, started_at, finished_at, article_count, message
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    run.status,
    run.startedAt,
    run.finishedAt,
    run.articleCount,
    run.message,
  );

  return Number(result.lastInsertRowid);
}

export function getLatestOpenNewsRefreshRun(): OpenNewsRefreshRun | null {
  const row = db.prepare(`
    SELECT *
    FROM opennews_refresh_runs
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `).get() as any;

  if (!row) return null;

  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    articleCount: row.article_count ?? 0,
    message: row.message ?? '',
  };
}

export type DbTableColumn = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
};

export type DbTableInfo = {
  name: string;
  rowCount: number;
  columns: DbTableColumn[];
  primaryKeys: string[];
};

export function getDbTableList(): DbTableInfo[] {
  const rows = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name ASC
  `).all() as Array<{ name: string }>;

  return rows.map(({ name }) => {
    const tableName = assertIdentifier(name);
    const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as DbTableColumn[];
    const countRow = db.prepare(`SELECT COUNT(*) as count FROM ${quoteIdentifier(tableName)}`).get() as { count: number };
    return {
      name: tableName,
      rowCount: countRow.count,
      columns,
      primaryKeys: columns.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name),
    };
  });
}

export function getDbTableRows(table: string, limit = 100, offset = 0): { info: DbTableInfo; rows: Record<string, unknown>[] } {
  const info = getDbTableList().find(item => item.name === table);
  if (!info) {
    throw new Error(`Unknown table: ${table}`);
  }

  const rows = db.prepare(`
    SELECT rowid AS _rowid, *
    FROM ${quoteIdentifier(table)}
    ORDER BY _rowid DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as Record<string, unknown>[];

  return { info, rows };
}

export function upsertDbTableRow(table: string, payload: Record<string, unknown>): void {
  const info = getDbTableList().find(item => item.name === table);
  if (!info) {
    throw new Error(`Unknown table: ${table}`);
  }

  const editableColumns = info.columns.map(column => column.name);
  const row = Object.fromEntries(
    Object.entries(payload).filter(([key]) => editableColumns.includes(key))
  );

  if (Object.keys(row).length === 0) {
    throw new Error('No editable columns supplied');
  }

  const primaryKeys = info.primaryKeys;
  const hasPrimaryKeyValues = primaryKeys.length > 0 && primaryKeys.every(key => row[key] !== undefined && row[key] !== null && row[key] !== '');

  if (hasPrimaryKeyValues) {
    const updateColumns = editableColumns.filter(column => row[column] !== undefined && !primaryKeys.includes(column));
    if (updateColumns.length > 0) {
      const setClause = updateColumns.map(column => `${quoteIdentifier(column)} = ?`).join(', ');
      const whereClause = primaryKeys.map(column => `${quoteIdentifier(column)} = ?`).join(' AND ');
      db.prepare(`
        UPDATE ${quoteIdentifier(table)}
        SET ${setClause}
        WHERE ${whereClause}
      `).run(
        ...updateColumns.map(column => row[column]),
        ...primaryKeys.map(column => row[column]),
      );
      return;
    }
  }

  const insertColumns = editableColumns.filter(column => row[column] !== undefined);
  const placeholders = insertColumns.map(() => '?').join(', ');
  db.prepare(`
    INSERT OR REPLACE INTO ${quoteIdentifier(table)} (${insertColumns.map(quoteIdentifier).join(', ')})
    VALUES (${placeholders})
  `).run(...insertColumns.map(column => row[column]));
}

export function deleteDbTableRow(table: string, keyValues: Record<string, unknown>): void {
  const info = getDbTableList().find(item => item.name === table);
  if (!info) {
    throw new Error(`Unknown table: ${table}`);
  }

  const primaryKeys = info.primaryKeys;
  if (primaryKeys.length > 0) {
    const missing = primaryKeys.filter(key => keyValues[key] === undefined || keyValues[key] === null || keyValues[key] === '');
    if (missing.length > 0) {
      throw new Error(`Missing primary key values: ${missing.join(', ')}`);
    }

    const whereClause = primaryKeys.map(column => `${quoteIdentifier(column)} = ?`).join(' AND ');
    db.prepare(`
      DELETE FROM ${quoteIdentifier(table)}
      WHERE ${whereClause}
    `).run(...primaryKeys.map(column => keyValues[column]));
    return;
  }

  if (keyValues._rowid === undefined) {
    throw new Error('Missing _rowid for delete');
  }

  db.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE rowid = ?`).run(keyValues._rowid);
}

// ===== Blacklisted creators persistence =====
db.exec(`
  CREATE TABLE IF NOT EXISTS blacklisted_creators (
    address TEXT PRIMARY KEY,
    reason TEXT,
    added_at INTEGER DEFAULT 0
  );
`);

export function getBlacklistedCreators(): Array<{ address: string; reason: string; addedAt: number }> {
  const rows = db.prepare('SELECT * FROM blacklisted_creators ORDER BY added_at DESC').all() as any[];
  return rows.map(r => ({ address: r.address, reason: r.reason ?? '', addedAt: r.added_at }));
}

export function saveBlacklistedCreator(address: string, reason: string): void {
  db.prepare('INSERT OR REPLACE INTO blacklisted_creators (address, reason, added_at) VALUES (?, ?, ?)').run(address, reason, Date.now());
}

export function deleteBlacklistedCreator(address: string): boolean {
  return db.prepare('DELETE FROM blacklisted_creators WHERE address = ?').run(address).changes > 0;
}

export { db };
