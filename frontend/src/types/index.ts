// ===== Frontend Types matching Backend =====

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
  principalRecovered: boolean;
  halfSoldPrice: number | null;
  halfSoldTimestamp: number | null;
  recoveredSOL: number;
  highestPriceAfterRecovery: number;
  trailingStopPct: number;
  tieredExits: { multiplier: number; sellPct: number; executed: boolean; executedAt?: number; executedPrice?: number }[];
  tieredExitsExecuted: number;
  totalRecoveredSOL: number;
  liquidityAtEntry: number;
  currentLiquidity: number;
  lastPriceUpdate: number;
}

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
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
  top10HolderPct: number | null;
  holderCount: number | null;
  mcLpRatio: number;
  volumeToMcRatio: number;
  buyToSellRatio1h: number;
  creatorAddress: string | null;
  creatorRugCount: number | null;
  creatorSurvivalCount: number | null;
  creatorRugProbability: number | null;
  creatorRiskBand: 'very_low' | 'low' | 'medium' | 'high' | 'very_high' | 'unknown' | null;
  creatorHistorySampleSize: number | null;
  creatorRiskConfidence: number | null;
  creatorDevLaunchedTokenCount: number | null;
  creatorDevRugRate: number | null;
  creatorDevHistory: CreatorTokenHistoryItem[];
  lpLocked: boolean | null;
  lpLockPlatform: string | null;
  lpCreatorPct: number | null;
  smartMoneyBuyers: number;
  socialMentions: number;
  socialUrls: string[];
  momentumConfirmed: boolean;
  momentumObservations: number;
  screeningScore: number;
  screeningPassed: string[];
  screeningFailed: string[];
  eligible: boolean;
  experimentStrategy: ExperimentStrategyTag;
  rugRiskScore: number;
  rugRiskLevel: RugRiskLevel;
  rugRiskReasons: string[];
  discoveredAt: number;
  lastUpdated: number;
  imageUrl?: string;
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
  byChain: ChainPortfolioState[];
}

export interface ChainPortfolioState {
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

export type SmartMoneySource =
  | 'gmgn'
  | 'ave'
  | 'bullx'
  | 'photon'
  | 'birdeye'
  | 'x'
  | 'telegram'
  | 'manual';

export type EntryStrategyMode = 'unified';
export type ChainId = 'solana';
export type RugRiskLevel = 'low' | 'medium' | 'high' | 'critical';

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

export interface SmartMoneyWalletRecord {
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

export interface SmartMoneyProviderStatus {
  source: SmartMoneySource;
  label: string;
  mode: 'api' | 'search-only' | 'manual';
  enabled: boolean;
  autoRefresh: boolean;
  note: string;
  docsUrl?: string;
  lastRun: SmartMoneyProviderRun | null;
}

export interface ChainTradingRulesView {
  chainId: ChainId;
  label: string;
  unit: 'SOL';
  profile: string;
  screening: {
    minScore: number;
    minLiquidityUsd: number;
    maxRugScore: number;
    preferredDexes: string[];
  };
  exits: {
    experimentTimeoutHours: number;
    liquidityRugDropPct: number;
    priceRugMultiplier: number;
  };
  ui: {
    buyRules: string[];
    sellRules: string[];
    riskRules: string[];
    dataSources: string[];
  };
}

export interface MarketDataProviderStatus {
  id: 'dexscreener' | 'ave' | 'gmgn';
  label: string;
  mode: 'api' | 'configurable-api' | 'search-only';
  enabled: boolean;
  chains: ChainId[];
  note: string;
  docsUrl: string;
  fallbackUrl?: string;
  fallbackNote?: string;
}

export interface ElonMonitorPost {
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

export interface ElonMonitorOverview {
  enabled: boolean;
  lastFetchedAt: number;
  cashtags: string[];
  narrativeTags: string[];
  posts: ElonMonitorPost[];
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

export interface OpenNewsHeadline {
  articleId: string;
  text: string;
  link: string;
  publishedAt: number;
  score: number;
  signal: string;
  newsType: string;
  engineType: string;
  coins: string[];
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
  headlines: OpenNewsHeadline[];
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

export interface DbTableColumn {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

export interface DbTableInfo {
  name: string;
  rowCount: number;
  columns: DbTableColumn[];
  primaryKeys: string[];
}

export interface SmartMoneyOverview {
  walletCount: number;
  sourceCounts: Record<SmartMoneySource, number>;
  wallets: SmartMoneyWalletRecord[];
  trackedTokens: Array<{
    address: string;
    symbol: string;
    name: string;
    smartMoneyBuyers: number;
    screeningScore: number;
    liquidityUsd: number;
    priceChange1h: number;
    lastUpdated: number;
  }>;
  signalCount: number;
  lastCheckTime: number;
}

export interface DexSearchPair {
  chainId: ChainId;
  pairAddress: string;
  dexId?: string;
  priceUsd?: string;
  priceNative?: string;
  pairCreatedAt?: number;
  fdv?: number;
  marketCap?: number;
  liquidity?: { usd?: number };
  volume?: { h1?: number; h24?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  baseToken?: { address: string; symbol?: string; name?: string };
  info?: {
    imageUrl?: string;
    websites?: ExternalLinkItem[];
    socials?: ExternalLinkItem[];
  };
}

export interface ExternalLinkItem {
  type?: string;
  url: string;
}

export interface RugCheckReport {
  score?: number;
  risks?: Array<{ name: string; description: string; level: string; score: number }>;
  tokenMeta?: { name: string; symbol: string; uri: string };
  topHolders?: Array<{ address: string; pct: number; insider: boolean }>;
  markets?: Array<{ marketType: string; pubkey: string; lp: unknown }>;
}

export type WsServerMessage =
  | { type: 'init'; data: InitData }
  | { type: 'portfolio_update'; data: PortfolioState }
  | { type: 'trade_opened'; data: Trade }
  | { type: 'trade_updated'; data: Trade }
  | { type: 'trade_closed'; data: Trade }
  | { type: 'snapshot'; data: PortfolioSnapshot }
  | { type: 'token_discovered'; data: TokenData }
  | { type: 'alert'; data: Alert }
  | { type: 'strategy_update'; data: StrategyLog }
  | { type: 'status'; data: SystemStatus }
  | { type: 'price_update'; data: PriceUpdate[] };
