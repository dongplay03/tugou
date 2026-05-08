// ===== Shared Types for Backend =====

// ===== Momentum Watchpool =====
export interface WatchPoolEntry {
  address: string;
  symbol: string;
  pairAddress: string;
  observations: MomentumObservation[];
  addedAt: number;
  status: 'watching' | 'confirmed' | 'rejected';
}

export interface MomentumObservation {
  timestamp: number;
  priceUsd: number;
  priceNative: number;
  volume1h: number;
  buys1h: number;
  sells1h: number;
  liquidity: number;
}

// ===== Creator Behavior =====
export interface CreatorTokenHistoryItem {
  address: string;
  symbol: string;
  name: string;
  createdAt: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  priceChange24h: number | null;
  status: 'rugged' | 'survived' | 'unknown';
  evidence: string;
}

export interface CreatorProfile {
  creatorAddress: string;
  tokensMinted: number;
  ruggedTokens: number;
  survivingTokens: number;
  avgTokenLifespanHours: number;
  lastChecked: number;
  source?: 'solana-rpc' | 'ave' | 'merged';
  devLaunchedTokenCount?: number;
  devRugRate?: number | null;
  devHistory?: CreatorTokenHistoryItem[];
}

export type CreatorRiskBand = 'very_low' | 'low' | 'medium' | 'high' | 'very_high' | 'unknown';

// ===== Smart Money =====
export type SmartMoneySource =
  | 'gmgn'
  | 'ave'
  | 'bullx'
  | 'photon'
  | 'birdeye'
  | 'x'
  | 'telegram'
  | 'manual';

export interface SmartMoneyWallet {
  address: string;
  label: string;
  source: SmartMoneySource;
  notes: string;
  winRate: number;
  avgROI: number;
  totalTrades: number;
  lastSeen: number;
  addedAt: number;
  isAutoImported?: boolean;
  providerRef?: string;
  refreshedAt?: number;
}

export interface SmartMoneyProviderRun {
  id: number;
  source: SmartMoneySource;
  status: 'success' | 'error' | 'skipped';
  startedAt: number;
  finishedAt: number;
  walletCount: number;
  message: string;
}

export interface XMonitorPost {
  id: number;
  postId: string;
  authorHandle: string;
  text: string;
  url: string;
  postedAt: number;
  fetchedAt: number;
  cashtags: string[];
  narrativeTags: string[];
}

export interface OpenNewsArticle {
  id: number;
  articleId: string;
  text: string;
  link: string;
  engineType: string;
  newsType: string;
  coins: Array<{
    symbol: string;
    marketType?: string;
    match?: string[];
  }>;
  aiScore: number;
  aiGrade: string;
  aiSignal: string;
  aiStatus: string;
  aiSummary: string;
  enSummary: string;
  publishedAt: number;
  fetchedAt: number;
}

export interface OpenNewsRefreshRun {
  id: number;
  status: 'success' | 'error' | 'disabled';
  startedAt: number;
  finishedAt: number;
  articleCount: number;
  message: string;
}

export interface OpenNewsThemeHeat {
  theme: string;
  count: number;
  coins: string[];
  sampleHeadlines: Array<{
    text: string;
    link: string;
    publishedAt: number;
    score: number;
    newsType: string;
    engineType: string;
  }>;
}

export interface OpenNewsCoinHeat {
  symbol: string;
  count: number;
  maxScore: number;
  themes: string[];
}

export interface OpenNewsOverview {
  enabled: boolean;
  status: 'ready' | 'cached' | 'disabled' | 'error';
  message: string;
  lastFetchedAt: number;
  lastAttemptedAt: number;
  articleCount: number;
  topThemes: OpenNewsThemeHeat[];
  topCoins: OpenNewsCoinHeat[];
  headlines: Array<{
    articleId: string;
    text: string;
    link: string;
    publishedAt: number;
    score: number;
    signal: string;
    newsType: string;
    engineType: string;
    coins: string[];
  }>;
}

export interface OpenNewsDailySubcategory {
  key: string;
  name: string;
  nameZh: string;
  description: string;
}

export interface OpenNewsDailyCategory {
  key: string;
  name: string;
  nameZh: string;
  description: string;
  subcategories: OpenNewsDailySubcategory[];
}

export interface OpenNewsDailyNewsItem {
  id: string;
  title: string;
  source: string;
  link: string;
  score: number;
  grade: string;
  signal: string;
  summaryZh: string;
  summaryEn: string;
  coins: string[];
  publishedAt: number;
  engineType: string;
}

export interface OpenNewsDailyTweetItem {
  author: string;
  handle: string;
  content: string;
  url: string;
  postedAt: number;
  relevance: string;
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
  };
}

export interface OpenNewsDailyHotOverview {
  status: 'ready' | 'cached' | 'error';
  message: string;
  category: string;
  subcategory: string;
  updatedAt: number;
  fetchedAt: number;
  relatedCoins: string[];
  newsItems: OpenNewsDailyNewsItem[];
  tweets: OpenNewsDailyTweetItem[];
}

export interface BlockBeatsFeedItem {
  id: string;
  title: string;
  summary: string;
  link: string;
  source: string;
  timeLabel: string;
  publishedAt: number;
  itemType: 'newsflash' | 'article' | 'search';
  category: string;
}

export interface BlockBeatsSearchResult extends BlockBeatsFeedItem {
  searchType: 'article' | 'newsflash' | 'unknown';
}

export interface BlockBeatsOverview {
  enabled: boolean;
  status: 'ready' | 'partial' | 'disabled' | 'error';
  message: string;
  sentimentIndex: number | null;
  sentimentLabel: string;
  btcEtfNetInflow: number | null;
  btcEtfCumulativeInflow: number | null;
  onchainVolume: number | null;
  importantNews: BlockBeatsFeedItem[];
}

export interface BlockBeatsNetflowItem {
  chain: string;
  tokenAddress: string;
  tokenSymbol: string;
  logoUrl: string;
  priceUsd: number | null;
  marketCap: number | null;
  volume: number | null;
  netflow: number | null;
  liquidity: number | null;
}

export interface BlockBeatsDerivativesSnapshot {
  date: string;
  hyperliquidOpenInterest: number | null;
  hyperliquidVolume: number | null;
  bybitOpenInterest: number | null;
  bybitVolume: number | null;
  binanceOpenInterest: number | null;
  binanceVolume: number | null;
}

// ===== Sector/Narrative Tracking =====
export interface NarrativeState {
  narrative: string;
  activeTokens: number;
  risingTokens: number;
  ruggedTokens: number;
  avgPerformance: number;
  lastUpdated: number;
  blocked: boolean;
  blockReason?: string;
}

// ===== LP Lock Info =====
export interface LPLockInfo {
  locked: boolean;
  lockPlatform: string | null;
  lpHolderCount: number;
  lpCreatorPct: number;
}

export interface AuthorityCheckResult {
  mintAuthority: string | null;
  freezeAuthority: string | null;
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
  inconclusive: boolean;
  reason?: string;
}

export interface HolderCheckResult {
  top10Pct: number | null;
  holderCount: number | null;
  inconclusive: boolean;
  reason?: string;
}

export type EntryStrategyMode = 'unified';
export type ChainId = 'solana';

export type ExperimentStrategyTag =
  | 'liquidity_surge'
  | 'volume_absorption'
  | 'dip_reclaim'
  | 'high_turnover_low_mc'
  | 'smart_money_follow'
  | 'narrative_rotation'
  | 'social_pre_fomo'
  | 'momentum_breakout'
  | 'score_momentum';

export type RugRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RugRiskReport {
  score: number;
  level: RugRiskLevel;
  reasons: string[];
  shouldBlockEntry: boolean;
  shouldEmergencyExit: boolean;
}

export interface StrategyPerformance {
  strategy: ExperimentStrategyTag | 'unknown';
  chainId: ChainId | 'all';
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgROI: number;
  totalPnlSOL: number;
  bestROI: number | null;
  worstROI: number | null;
}

export interface EntryStrategySettings {
  mode: EntryStrategyMode;
  directEntryMinScore: number;
  directEntryMinLiquidityUsd: number;
}

// ===== Tiered Exit Plan =====
export interface TieredExitPlan {
  tiers: ExitTier[];
  executedTiers: number;
}

export interface ExitTier {
  multiplier: number;  // e.g. 2x, 3x, 5x
  sellPct: number;     // e.g. 0.50, 0.25, 0.25
  executed: boolean;
  executedAt?: number;
  executedPrice?: number;
}

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative: string;
  priceUsd: string | null;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: { h24: number; h6: number; h1: number; m5: number };
  priceChange: { m5: number; h1: number; h6: number; h24: number };
  liquidity: { usd: number; base: number; quote: number };
  fdv: number | null;
  marketCap: number | null;
  pairCreatedAt: number | null;
  info?: {
    imageUrl?: string;
    websites?: { url: string }[];
    socials?: { type: string; url: string }[];
  };
}

export interface TokenData {
  chainId: ChainId;
  address: string;
  symbol: string;
  name: string;
  pairAddress: string;
  dex: string;
  priceUsd: number;
  priceNative: number;
  liquidityUsd: number;
  volume24h: number;
  volume1h: number;
  marketCap: number;
  fdv: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  txnsBuys24h: number;
  txnsSells24h: number;
  txnsBuys1h: number;
  txnsSells1h: number;
  pairCreatedAt: number;
  // On-chain data
  mintAuthorityRevoked: boolean | null; // null = unknown
  freezeAuthorityRevoked: boolean | null;
  top10HolderPct: number | null;
  holderCount: number | null;
  // Computed
  mcLpRatio: number;
  volumeToMcRatio: number;
  buyToSellRatio1h: number;
  // Creator behavior
  creatorAddress: string | null;
  creatorRugCount: number | null;
  creatorSurvivalCount: number | null;
  creatorRugProbability: number | null;
  creatorRiskBand: CreatorRiskBand | null;
  creatorHistorySampleSize: number | null;
  creatorRiskConfidence: number | null;
  creatorDevLaunchedTokenCount: number | null;
  creatorDevRugRate: number | null;
  creatorDevHistory: CreatorTokenHistoryItem[];
  // LP lock
  lpLocked: boolean | null;
  lpLockPlatform: string | null;
  lpCreatorPct: number | null;
  // Smart money
  smartMoneyBuyers: number;
  // Social signals
  socialMentions: number;
  socialUrls: string[];
  // Momentum watchpool
  momentumConfirmed: boolean;
  momentumObservations: number;
  // Screening
  screeningScore: number;
  screeningPassed: string[];
  screeningFailed: string[];
  eligible: boolean;
  experimentStrategy: ExperimentStrategyTag;
  rugRiskScore: number;
  rugRiskLevel: RugRiskLevel;
  rugRiskReasons: string[];
  // Meta
  discoveredAt: number;
  lastUpdated: number;
  imageUrl?: string;
}

export interface Trade {
  id: string;
  chainId: ChainId;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  pairAddress: string;
  entryPriceUsd: number;
  entryPriceNative: number;
  currentPriceUsd: number;
  exitPriceUsd: number | null;
  entryTimestamp: number;
  exitTimestamp: number | null;
  amountSOL: number;
  initialAmountSOL: number;
  tokensAcquired: number;
  status: 'open' | 'closed-tp' | 'closed-sl' | 'closed-rug' | 'closed-manual' | 'closed-time';
  roi: number | null;
  currentRoi: number;
  unrealizedPnlSOL: number;
  realizedPnlSOL: number;
  takeProfitMultiplier: number;
  stopLossMultiplier: number;
  screeningScore: number;
  experimentStrategy: ExperimentStrategyTag;
  rugRiskScore: number;
  rugRiskLevel: RugRiskLevel;
  rugRiskReasons: string[];
  entryReasons: string[];
  narrativeTags: string[];
  // 翻倍出本
  principalRecovered: boolean;
  halfSoldPrice: number | null;
  halfSoldTimestamp: number | null;
  recoveredSOL: number;
  // Trailing stop after principal recovery
  highestPriceAfterRecovery: number;
  trailingStopPct: number;
  // Tiered exit
  tieredExits: ExitTier[];
  tieredExitsExecuted: number;
  totalRecoveredSOL: number;
  // Monitoring
  liquidityAtEntry: number;
  currentLiquidity: number;
  lastPriceUpdate: number;
}

export interface PortfolioState {
  totalValueSOL: number;
  cashSOL: number;
  openPositions: number;
  totalTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  cumulativePnlSOL: number;
  cumulativePnlPct: number;
  bestTrade: { symbol: string; roi: number } | null;
  worstTrade: { symbol: string; roi: number } | null;
  byChain: Array<{
    chainId: ChainId;
    totalValueSOL: number;
    cashSOL: number;
    openPositions: number;
    totalTrades: number;
    closedTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    cumulativePnlSOL: number;
    cumulativePnlPct: number;
  }>;
}

export interface PortfolioSnapshot {
  timestamp: number;
  totalValueSOL: number;
  cashSOL: number;
  openPositions: number;
  cumulativePnlSOL: number;
  cumulativePnlPct: number;
}

export interface StrategyWeights {
  contractSafety: number;
  liquidityDepth: number;
  volumeRatio: number;
  mcLpRatio: number;
  holderDistribution: number;
  buyPressure: number;
  smartMoneySignal: number;
  freshness: number;
  narrativeBonus: Record<string, number>;
}

export interface StrategyLog {
  id: number;
  timestamp: number;
  batchNumber: number;
  winRate: number;
  avgROI: number;
  changes: string[];
  weightsSnapshot: StrategyWeights;
  commonTraits: CommonTrait[];
}

export interface CommonTrait {
  trait: string;
  frequency: number;
  avgROI: number;
  confidence: number;
}

export interface Alert {
  id: string;
  timestamp: number;
  level: 'info' | 'warning' | 'danger' | 'success';
  title: string;
  message: string;
  tokenSymbol?: string;
  tokenAddress?: string;
}

export interface TradePriceHistoryPoint {
  id: number;
  tradeId: string;
  timestamp: number;
  priceUsd: number;
  priceNative: number;
  liquidityUsd: number;
}

export interface DiscoveryLog {
  id: number;
  timestamp: number;
  durationMs: number;
  discoveredCount: number;
  screenedCount: number;
  eligibleCount: number;
  errorCount: number;
  passRate: number;
}

// WebSocket message types
export type WsServerMessage =
  | { type: 'init'; data: InitData }
  | { type: 'price_update'; data: PriceUpdate[] }
  | { type: 'trade_opened'; data: Trade }
  | { type: 'trade_updated'; data: Trade }
  | { type: 'trade_closed'; data: Trade }
  | { type: 'portfolio_update'; data: PortfolioState }
  | { type: 'snapshot'; data: PortfolioSnapshot }
  | { type: 'token_discovered'; data: TokenData }
  | { type: 'alert'; data: Alert }
  | { type: 'strategy_update'; data: StrategyLog }
  | { type: 'status'; data: SystemStatus };

export type WsClientMessage =
  | { type: 'start_trading' }
  | { type: 'stop_trading' }
  | { type: 'close_trade'; tradeId: string }
  | { type: 'refresh' };

export interface InitData {
  portfolio: PortfolioState;
  trades: Trade[];
  recentTokens: TokenData[];
  strategyLogs: StrategyLog[];
  snapshots: PortfolioSnapshot[];
  alerts: Alert[];
  status: SystemStatus;
  weights: StrategyWeights;
  strategyPerformance: StrategyPerformance[];
}

export interface PriceUpdate {
  tokenAddress: string;
  symbol: string;
  priceUsd: number;
  priceNative: number;
  liquidityUsd: number;
  volume1h: number;
  priceChange5m: number;
  priceChange1h: number;
}

export interface SystemStatus {
  isTrading: boolean;
  lastFetchTime: number | null;
  tokensScreened: number;
  uptime: number;
  errors: number;
  watchPoolSize: number;
  activeNarratives: number;
  smartMoneyWallets: number;
  tradingWindowActive: boolean;
  entryStrategyMode: EntryStrategyMode;
  activeChains: ChainId[];
}
