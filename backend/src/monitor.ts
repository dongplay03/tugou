// ===== Price Monitor + Rug Detector =====
// Continuously monitors open positions and token prices.
// Integrates all 10 strategies into the discovery and monitoring pipeline.

import type { Trade, TokenData, Alert, PriceUpdate, PortfolioSnapshot, DexScreenerPair, ChainId } from './types.js';
import * as db from './database.js';
import {
  fetchTokenPrices, fetchTrendingTokens, fetchLatestProfiles, fetchTokenDetails,
  pairToTokenData, checkTokenAuthorities, getTopHolders, searchNewTokens,
} from './fetcher.js';
import { screenToken, type ScreeningResult, type ScreeningExtras } from './screener.js';
import { openTrade, updateTradePrice, getPortfolioState, tryAddToPosition } from './trader.js';
import { checkAndOptimize } from './optimizer.js';
import type { WsServerMessage } from './types.js';

// Strategy imports
import {
  addToWatchPool, isInWatchPool, isConfirmed, consumeConfirmed,
  getWatchPool, updateWatchPool, getWatchPoolSize, cleanupWatchPool,
} from './momentum.js';
import { analyzeSocialSignals, enrichWithXProfile } from './social.js';
import { getTokenCreator, analyzeCreator, getCreatorRiskAssessment } from './creator.js';
import { checkLPLock } from './lp-lock.js';
import { checkSmartMoneyBuying, getSmartWalletCount } from './smart-money.js';
import { isSmartMoneyRefreshDue, refreshSmartMoneyPool } from './smart-money-refresh.js';
import { updateNarrativeTracking, recordNarrativeRug, getActiveNarrativeCount } from './narrative.js';
import { updateDynamicPatterns } from './narrative-patterns.js';
import { isTradingWindowActive, getCurrentTradingWindow, updateActivitySnapshot } from './time-window.js';
import { assignExperimentStrategy } from './experiment-strategies.js';
import { assessTokenRugRisk } from './rug-risk.js';
import { getChainTradingRules } from './chain-rules.js';
import { preTradeBrowserReview } from './pre-trade-review.js';
import { getPrimaryXTrendKeywords, openXTrendDiscoveryTabs, fetchElonTweetKeywords, matchTokenAgainstElonKeywords } from './x-trend-discovery.js';
import { aveSnapshotToCreatorProfile, aveSnapshotToHolderCheck, fetchAveRiskSnapshot, isAveProviderEnabled } from './ave-provider.js';
import { analyzeWithAI, getAIScoreAdjustment, getAICacheStats, cleanupAICache } from './ai-analyzer.js';
import { startPoolWatcher, stopPoolWatcher, onNewPool, type NewPoolEvent } from './pool-watcher.js';
import { startSmartMoneyWatcher, stopSmartMoneyWatcher, onSmartMoneyBuy, type SmartMoneyBuyEvent } from './smart-money-watcher.js';

type BroadcastFn = (msg: WsServerMessage) => void;

let isRunning = false;
let discoveryInterval: ReturnType<typeof setInterval> | null = null;
let monitorInterval: ReturnType<typeof setInterval> | null = null;
let snapshotInterval: ReturnType<typeof setInterval> | null = null;
let broadcastFn: BroadcastFn = () => {};
let tokensScreenedCount = 0;
let errorCount = 0;
let startTime = Date.now();
let lastFetchTime: number | null = null;
let discoveryInFlight = false;
let monitorInFlight = false;
let lastCleanupAt = 0;
const ACTIVE_CHAINS: ChainId[] = ['solana'];

export function setBroadcast(fn: BroadcastFn) {
  broadcastFn = fn;
}

export function getStatus() {
  return {
    isTrading: isRunning,
    lastFetchTime,
    tokensScreened: tokensScreenedCount,
    uptime: Date.now() - startTime,
    errors: errorCount,
    watchPoolSize: getWatchPoolSize(),
    activeNarratives: getActiveNarrativeCount(),
    smartMoneyWallets: getSmartWalletCount(),
    tradingWindowActive: isTradingWindowActive(),
    entryStrategyMode: db.getEntryStrategyMode(),
    activeChains: ACTIVE_CHAINS,
    aiAnalyzer: getAICacheStats(),
  };
}

// ===== Start all monitoring loops =====
export function startMonitoring() {
  if (isRunning) {
    console.log('[Monitor] Already running');
    return;
  }

  isRunning = true;
  startTime = Date.now();
  lastFetchTime = null;
  tokensScreenedCount = 0;
  errorCount = 0;
  console.log('[Monitor] 🚀 Starting monitoring system...');

  broadcastFn({ type: 'status', data: getStatus() });
  broadcastFn({
    type: 'alert',
    data: {
      id: `alert-start-${Date.now()}`,
      timestamp: Date.now(),
      level: 'info',
      title: '🚀 System Started',
      message: 'Token discovery, price monitoring, and paper trading activated.',
    },
  });

  // 启动链上实时监听（秒级发现新池 + 聪明钱买入）
  setupRealtimeWatchers();

  // Run initial discovery immediately
  runDiscovery().catch(err => {
    console.error('[Monitor] Initial discovery error:', err);
    errorCount++;
  });

  // Discovery: every 120 seconds
  discoveryInterval = setInterval(() => {
    runDiscovery().catch(err => {
      console.error('[Monitor] Discovery error:', err);
      errorCount++;
    });
  }, 45_000);

  // 价格监控 + 动量观察池更新：5 秒轮询（Rug 秒级事件）
  monitorInterval = setInterval(() => {
    monitorOpenPositions().catch(err => {
      console.error('[Monitor] Price monitoring error:', err);
      errorCount++;
    });
  }, 5_000);

  // Portfolio snapshot: every 5 minutes
  snapshotInterval = setInterval(() => {
    takeSnapshot();
  }, 300_000);
}

// ===== Stop monitoring =====
export async function stopMonitoring() {
  if (!isRunning) return;

  isRunning = false;
  if (discoveryInterval) clearInterval(discoveryInterval);
  if (monitorInterval) clearInterval(monitorInterval);
  if (snapshotInterval) clearInterval(snapshotInterval);

  discoveryInterval = null;
  monitorInterval = null;
  snapshotInterval = null;

  await waitForInFlightSettled();

  // 停止链上实时监听
  stopPoolWatcher();
  stopSmartMoneyWatcher();

  console.log('[Monitor] ⏹️ Monitoring stopped');

  broadcastFn({ type: 'status', data: getStatus() });
  broadcastFn({
    type: 'alert',
    data: {
      id: `alert-stop-${Date.now()}`,
      timestamp: Date.now(),
      level: 'warning',
      title: '⏹️ System Stopped',
      message: 'All monitoring and trading paused.',
    },
  });
}

// ===== Discover new tokens & auto-trade =====
async function runDiscovery() {
  if (!isRunning) return;
  if (discoveryInFlight) return;

  discoveryInFlight = true;
  lastFetchTime = Date.now();
  const cycleStartedAt = Date.now();
  const cycleErrorCountStart = errorCount;
  let discoveredCount = 0;
  let screenedCount = 0;
  let eligibleCount = 0;
  let openedCount = 0;

  const window = getCurrentTradingWindow();
  console.log(`[Monitor] 🔍 Running token discovery... (window: ${window})`);

  try {
    // Periodically refresh smart money wallet pool from GMGN
    if (isSmartMoneyRefreshDue()) {
      refreshSmartMoneyPool().then(result => {
        if (result.added > 0 || result.removed > 0) {
          broadcastFn({
            type: 'alert',
            data: {
              id: `alert-sm-refresh-${Date.now()}`,
              timestamp: Date.now(),
              level: 'info',
              title: '🔄 Smart Money Pool Refreshed',
              message: `+${result.added} new wallets, -${result.removed} stale. Total: ${result.totalWallets}`,
            },
          });
        }
      }).catch(() => {});
    }

    // PRIMARY SOURCE: DexScreener trending + latest profiles
    let pairs = await fetchTrendingTokens(ACTIVE_CHAINS);
    console.log(`[Monitor] DexScreener trending: ${pairs.length} pairs`);

    // Always fetch latest profiles for broader coverage
    const profilePairs = await fetchLatestProfiles(ACTIVE_CHAINS);
    const existingAddrs = new Set(pairs.map(p => p.baseToken.address));
    let newFromProfiles = 0;
    for (const pp of profilePairs) {
      if (!existingAddrs.has(pp.baseToken.address)) {
        pairs.push(pp);
        existingAddrs.add(pp.baseToken.address);
        newFromProfiles++;
      }
    }
    if (newFromProfiles > 0) {
      console.log(`[Monitor] Latest profiles added ${newFromProfiles} new pairs`);
    }

    // SUPPLEMENTARY: X trend keywords — only 3 broad searches, results merged as bonus
    await openXTrendDiscoveryTabs().catch(() => 0);
    const xTrendMatches = new Map<string, string>();
    const xTrendKeywords = getPrimaryXTrendKeywords(); // now returns max 3 broad crypto keywords
    for (const keyword of xTrendKeywords) {
      const found = await searchNewTokens(keyword, ACTIVE_CHAINS).catch(() => []);
      for (const pair of found.slice(0, 3)) {
        if (!existingAddrs.has(pair.baseToken.address)) {
          pairs.push(pair);
          existingAddrs.add(pair.baseToken.address);
          xTrendMatches.set(pair.baseToken.address, keyword);
        }
      }
    }
    if (xTrendMatches.size > 0) {
      console.log(`[Monitor] X trend supplement added ${xTrendMatches.size} additional candidates`);
    }

    // Fetch Elon's tweet keywords for score boosting (not primary discovery)
    const elonKeywords = await fetchElonTweetKeywords().catch(() => []);
    if (elonKeywords.length > 0) {
      console.log(`[Monitor] 🐦 Elon tweet keywords loaded: ${elonKeywords.slice(0, 5).join(', ')}...`);
    }

    discoveredCount = pairs.length;
    console.log(`[Monitor] Found ${pairs.length} Solana token pairs`);

    const weights = db.getWeights();
    // Build a price map for momentum watchpool updates
    const pairMap = new Map<string, DexScreenerPair>();
    for (const p of pairs) {
      pairMap.set(p.baseToken.address, p);
    }

    // Update momentum watchpool with latest prices
    const newlyConfirmed = updateWatchPool(pairMap);
    if (newlyConfirmed.length > 0) {
      console.log(`[Monitor] 🎯 ${newlyConfirmed.length} tokens confirmed by momentum watchpool`);
    }

    // Process confirmed momentum tokens first (they get priority for trading)
    for (const addr of newlyConfirmed) {
      const pair = pairMap.get(addr);
      if (!pair || !isRunning) continue;

      try {
        const assessed = await buildAssessedToken(pair, weights, true, elonKeywords);
        if (!assessed) continue;

        const { tokenData, result } = assessed;
        applyXTrendEvidence(tokenData, xTrendMatches.get(tokenData.address));

        db.saveToken(tokenData);
        screenedCount++;
        if (tokenData.eligible) eligibleCount++;
        tokensScreenedCount++;
        broadcastFn({ type: 'token_discovered', data: tokenData });
        consumeConfirmed(addr);

        if (tokenData.eligible && isRunning) {
          console.log(`[Monitor] 🎯 Momentum-confirmed eligible: ${tokenData.symbol} (Score: ${tokenData.screeningScore})`);

          await preTradeBrowserReview(tokenData);
          const tradeResult = openTrade(tokenData);
          if (tradeResult) {
            openedCount++;
            broadcastFn({ type: 'trade_opened', data: tradeResult.trade });
            broadcastFn({ type: 'alert', data: tradeResult.alert });
            broadcastFn({ type: 'portfolio_update', data: getPortfolioState() });
          }
        }
      } catch (err) {
        console.error('[Monitor] Error processing momentum token:', err);
        errorCount++;
      }
    }

    // Collect all screened tokens for narrative tracking
    const screenedTokens: TokenData[] = [];

    // Process remaining pairs
    await runWithConcurrency(pairs, 4, async (pair) => {
      if (!isRunning) return;
      const addr = pair.baseToken.address;

      // Skip tokens already processed via momentum confirmation
      if (newlyConfirmed.includes(addr)) return;

      try {
        const tokenData = pairToTokenData(pair);

        const existing = db.getToken(tokenData.address);
        if (existing && Date.now() - existing.lastUpdated < 300_000) {
          return;
        }

        const assessed = await buildAssessedToken(pair, weights, false, elonKeywords);
        if (!assessed) return;

        const { tokenData: screenedToken, result } = assessed;
        applyXTrendEvidence(screenedToken, xTrendMatches.get(screenedToken.address));

        db.saveToken(screenedToken);
        screenedTokens.push(screenedToken);
        screenedCount++;
        if (screenedToken.eligible) eligibleCount++;
        tokensScreenedCount++;
        broadcastFn({ type: 'token_discovered', data: screenedToken });

        if (screenedToken.eligible && isRunning) {
          if (shouldEnterDirectly(screenedToken)) {
            await preTradeBrowserReview(screenedToken);
            const tradeResult = openTrade(screenedToken);
            if (tradeResult) {
              openedCount++;
              broadcastFn({ type: 'trade_opened', data: tradeResult.trade });
              broadcastFn({ type: 'alert', data: tradeResult.alert });
              broadcastFn({ type: 'portfolio_update', data: getPortfolioState() });
              console.log(`[Monitor] 🎯 Direct entry: ${screenedToken.symbol} (Score: ${screenedToken.screeningScore})`);
              return;
            }
          }

          // Unified path: lower-conviction candidates wait for momentum confirmation.
          if (!isInWatchPool(screenedToken.address) && !isConfirmed(screenedToken.address)) {
            addToWatchPool(screenedToken.address, screenedToken.symbol, screenedToken.pairAddress);
            console.log(`[Monitor] 👁️ ${screenedToken.symbol} (Score: ${result.score}) → momentum watchpool`);

            broadcastFn({
              type: 'alert',
              data: {
                id: `alert-watch-${Date.now()}-${screenedToken.address.slice(0, 6)}`,
                timestamp: Date.now(),
                level: 'info',
                title: `👁️ Watching: ${screenedToken.symbol}`,
                message: `Score: ${result.score}. Added to momentum watchpool — waiting for trend confirmation.`,
                tokenSymbol: screenedToken.symbol,
                tokenAddress: screenedToken.address,
              },
            });
          }
        }
      } catch (err) {
        console.error('[Monitor] Error processing token:', err);
        errorCount++;
      }
    });

    // Feed real-time activity data for time-window strategy
    if (pairs.length > 0) {
      const totalVol1h = pairs.reduce((s, p) => s + (p.volume?.h1 || 0), 0);
      const activePairs = pairs.filter(p => (p.volume?.h1 || 0) > 0).length;
      const avgBuyRatio = pairs.reduce((s, p) => {
        const buys = p.txns?.h1?.buys || 0;
        const sells = p.txns?.h1?.sells || 1;
        return s + buys / Math.max(sells, 1);
      }, 0) / Math.max(pairs.length, 1);
      updateActivitySnapshot({ totalVolume1h: totalVol1h, activePairCount: activePairs, avgBuyRatio });
    }

    // Update narrative tracking (Strategy 6)
    if (screenedTokens.length > 0) {
      updateNarrativeTracking(screenedTokens);

      // Update dynamic narrative patterns from trending data
      const dynamicResult = updateDynamicPatterns(
        pairs.map(p => ({ name: p.baseToken.name, symbol: p.baseToken.symbol }))
      );
      if (dynamicResult.added.length > 0) {
        console.log(`[Monitor] 🆕 New dynamic narratives: ${dynamicResult.added.join(', ')}`);
      }
    }

    // Cleanup stale watchpool entries
    cleanupWatchPool();

    if (openedCount > 0) {
      console.log(`[Monitor] Opened ${openedCount} new positions`);
    }

    if (Date.now() - lastCleanupAt > 6 * 60 * 60 * 1000) {
      const cleanup = db.cleanupExpiredData();
      lastCleanupAt = Date.now();
      if (cleanup.deletedAlerts > 0 || cleanup.deletedTokens > 0 || cleanup.deletedTokenSnapshots > 0) {
        console.log(`[Monitor] 🧹 Cleanup: ${cleanup.deletedTokens} tokens, ${cleanup.deletedAlerts} alerts, ${cleanup.deletedTokenSnapshots} snapshots removed`);
      }
    }

    lastFetchTime = Date.now();
    db.saveDiscoveryLog({
      timestamp: lastFetchTime,
      durationMs: lastFetchTime - cycleStartedAt,
      discoveredCount,
      screenedCount,
      eligibleCount,
      errorCount: errorCount - cycleErrorCountStart,
      passRate: screenedCount > 0 ? eligibleCount / screenedCount : 0,
    });
    broadcastFn({ type: 'status', data: getStatus() });
  } catch (error) {
    console.error('[Monitor] Discovery cycle error:', error);
    errorCount++;
  } finally {
    discoveryInFlight = false;
  }
}

/** Collect all supplementary screening data for a token. */
async function collectScreeningExtras(
  tokenAddress: string,
  pair: DexScreenerPair,
): Promise<ScreeningExtras> {
  const extras: ScreeningExtras = { pair };

  if (pair.chainId !== 'solana') {
    if (isAveProviderEnabled()) {
      const ave = await fetchAveRiskSnapshot(tokenAddress, pair.chainId as ChainId).catch(() => null);
      const holderCheck = aveSnapshotToHolderCheck(ave);
      if (holderCheck) extras.holders = holderCheck;
    }
    extras.smartMoneyBuyers = 0;
    extras.creatorProfile = null;
    extras.lpLockInfo = null;
    return extras;
  }

  try {
    // Only fetch authorities + holders + smart money via RPC (skip creator + LP lock — too unreliable)
    const [authorities, holders, smartMoney] = await Promise.all([
      checkTokenAuthorities(tokenAddress),
      getTopHolders(tokenAddress),
      checkSmartMoneyBuying(tokenAddress).catch(() => ({ buyerCount: 0, walletLabels: [], totalConfidence: 0 })),
    ]);

    extras.authorities = authorities;
    extras.holders = holders;
    extras.lpLockInfo = null; // disabled — RPC LP lock check was unreliable
    extras.smartMoneyBuyers = smartMoney.buyerCount;
    extras.creatorProfile = null;

    // AVE enrichment (API, not RPC) — keep this as it's more reliable
    if (isAveProviderEnabled()) {
      const ave = await fetchAveRiskSnapshot(tokenAddress, 'solana').catch(() => null);
      const holderCheck = aveSnapshotToHolderCheck(ave);
      if (holderCheck && holderCheck.top10Pct !== null) {
        extras.holders = holderCheck;
      }
      const aveCreatorProfile = aveSnapshotToCreatorProfile(ave, null);
      if (aveCreatorProfile) {
        extras.creatorProfile = aveCreatorProfile;
      }
    }

  } catch (err) {
    console.error('[Monitor] Error collecting screening extras:', err);
  }

  return extras;
}

async function buildAssessedToken(
  pair: DexScreenerPair,
  weights: ReturnType<typeof db.getWeights>,
  momentumConfirmed: boolean,
  elonKeywords: string[] = [],
): Promise<{ tokenData: TokenData; result: ScreeningResult } | null> {
  const tokenData = pairToTokenData(pair);
  const previous = db.getToken(tokenData.address);
  const extras = await collectScreeningExtras(tokenData.address, pair);

  applyExtrasToToken(tokenData, pair, extras);

  const result = screenToken(tokenData, weights, extras);
  const rugRisk = assessTokenRugRisk(tokenData, pair);

  // Base score
  let finalScore = momentumConfirmed ? result.score + 10 : result.score;

  // Elon tweet boost: if token matches Elon's recent tweets AND price is rising → +15
  const elonMatch = matchTokenAgainstElonKeywords(
    { symbol: tokenData.symbol, name: tokenData.name, address: tokenData.address },
    elonKeywords,
  );
  const priceChange = pair.priceChange?.h1 ?? 0;
  if (elonMatch && priceChange > 0) {
    finalScore += 15;
    const elonLabel = `🐦 Elon 推特相关: "${elonMatch}" + 1h涨${priceChange.toFixed(1)}%`;
    if (!tokenData.screeningPassed.includes(elonLabel)) {
      tokenData.screeningPassed = [...tokenData.screeningPassed, elonLabel];
    }
    console.log(`[Monitor] 🐦 Elon boost +15 for ${tokenData.symbol} (keyword: ${elonMatch}, 1h: +${priceChange.toFixed(1)}%)`);
  }

  // X Profile enrichment (browser scraping): only for near-eligible tokens to avoid rate limits
  if (finalScore >= 65) {
    try {
      const xResult = await enrichWithXProfile(pair, finalScore);
      if (xResult.adjustment !== 0) {
        finalScore += xResult.adjustment;
        tokenData.screeningPassed = [...tokenData.screeningPassed, xResult.label];
        console.log(`[Monitor] 🐦 X profile enrichment for ${tokenData.symbol}: ${xResult.adjustment > 0 ? '+' : ''}${xResult.adjustment}`);
      }
    } catch (err) {
      // Non-fatal: continue without X profile data
      console.warn(`[Monitor] X profile enrichment failed for ${tokenData.symbol}:`, (err as Error).message);
    }
  }

  // AI semantic analysis: only for high-potential tokens to control API costs
  if (finalScore >= 40) {
    try {
      // Set screeningScore temporarily so analyzeWithAI can read it
      tokenData.screeningScore = finalScore;
      const aiResult = await analyzeWithAI(tokenData, pair, extras.creatorProfile);
      if (aiResult) {
        extras.aiAnalysis = aiResult;
        const aiAdj = getAIScoreAdjustment(aiResult);
        if (aiAdj.adjustment !== 0) {
          finalScore += aiAdj.adjustment;
          console.log(`[Monitor] 🤖 AI analysis for ${tokenData.symbol}: ${aiAdj.adjustment > 0 ? '+' : ''}${aiAdj.adjustment} (flags: ${aiResult.flags.join(',') || 'none'})`);
        }
      }
    } catch (err) {
      // Non-fatal: continue without AI analysis
      console.warn(`[Monitor] AI analysis failed for ${tokenData.symbol}:`, (err as Error).message);
    }
  }

  tokenData.screeningScore = finalScore;
  tokenData.screeningPassed = momentumConfirmed
    ? [...result.passed, '✅ Momentum confirmed: 3+ consecutive up-ticks', '✅ Final entry re-screen passed on latest market data', ...tokenData.screeningPassed.filter(p => p.startsWith('🐦'))]
    : result.passed;
  tokenData.screeningFailed = result.failed;
  tokenData.rugRiskScore = rugRisk.score;
  tokenData.rugRiskLevel = rugRisk.level;
  tokenData.rugRiskReasons = rugRisk.reasons;
  tokenData.eligible = resolveFinalEligibility(tokenData, result, momentumConfirmed) && !rugRisk.shouldBlockEntry;
  if (rugRisk.shouldBlockEntry) {
    tokenData.screeningFailed = [
      ...tokenData.screeningFailed,
      `🚨 Rug risk ${rugRisk.score}/100 (${rugRisk.level}) — ${rugRisk.reasons[0] || 'high risk'}`,
    ];
  }
  tokenData.experimentStrategy = assignExperimentStrategy(tokenData, previous, momentumConfirmed);
  tokenData.momentumConfirmed = momentumConfirmed;
  tokenData.momentumObservations = momentumConfirmed ? 3 : tokenData.momentumObservations;

  return { tokenData, result };
}

function applyExtrasToToken(tokenData: TokenData, pair: DexScreenerPair, extras: ScreeningExtras): void {
  if (extras.authorities) {
    tokenData.mintAuthorityRevoked = extras.authorities.mintAuthorityRevoked;
    tokenData.freezeAuthorityRevoked = extras.authorities.freezeAuthorityRevoked;
  }

  if (extras.holders) {
    tokenData.top10HolderPct = extras.holders.top10Pct;
    tokenData.holderCount = extras.holders.holderCount;
  }

  tokenData.socialUrls = analyzeSocialSignals(pair).urls;
  tokenData.socialMentions = tokenData.socialUrls.length;

  if (extras.creatorProfile) {
    const creatorRisk = getCreatorRiskAssessment(extras.creatorProfile);
    // Only set creator address if it's a valid Solana address (base58, not zero-padded 0x)
    const addr = extras.creatorProfile.creatorAddress;
    if (addr && !addr.startsWith('0x')) {
      tokenData.creatorAddress = addr;
    }
    tokenData.creatorRugCount = extras.creatorProfile.ruggedTokens;
    tokenData.creatorSurvivalCount = extras.creatorProfile.survivingTokens;
    tokenData.creatorRugProbability = creatorRisk.rugProbability;
    tokenData.creatorRiskBand = creatorRisk.riskBand;
    tokenData.creatorHistorySampleSize = creatorRisk.historySampleSize;
    tokenData.creatorRiskConfidence = creatorRisk.confidence;
    tokenData.creatorDevLaunchedTokenCount = extras.creatorProfile.devLaunchedTokenCount ?? extras.creatorProfile.tokensMinted ?? null;
    tokenData.creatorDevRugRate = extras.creatorProfile.devRugRate ?? creatorRisk.rugProbability;
    tokenData.creatorDevHistory = extras.creatorProfile.devHistory ?? [];
  }

  if (extras.lpLockInfo) {
    tokenData.lpLocked = extras.lpLockInfo.locked;
    tokenData.lpLockPlatform = extras.lpLockInfo.lockPlatform;
    tokenData.lpCreatorPct = extras.lpLockInfo.lpCreatorPct;
  }

  tokenData.smartMoneyBuyers = extras.smartMoneyBuyers ?? 0;
}

function applyXTrendEvidence(tokenData: TokenData, keyword?: string): void {
  if (!keyword) return;
  const label = `X 热点发现：${keyword}`;
  if (!tokenData.screeningPassed.includes(label)) {
    tokenData.screeningPassed = [...tokenData.screeningPassed, label];
  }
  tokenData.socialMentions = Math.max(tokenData.socialMentions, 1);
  tokenData.socialUrls = [
    ...new Set([
      ...tokenData.socialUrls,
      `https://x.com/search?q=${encodeURIComponent(`${keyword} ${tokenData.symbol} ${tokenData.address} solana pump`) }&src=typed_query&f=live`,
    ]),
  ];
}

function resolveFinalEligibility(
  tokenData: TokenData,
  result: ScreeningResult,
  momentumConfirmed: boolean,
): boolean {
  const rules = getChainTradingRules(tokenData.chainId);
  const minScore = rules.screening.minScore;
  const minLiquidity = rules.screening.minLiquidityUsd;

  if (!momentumConfirmed) {
    return result.eligible;
  }

  return !result.inconclusive &&
    tokenData.screeningScore >= minScore &&
    tokenData.liquidityUsd >= minLiquidity &&
    (tokenData.rugRiskScore ?? 0) <= rules.screening.maxRugScore;
}

function shouldEnterDirectly(tokenData: TokenData): boolean {
  const settings = db.getEntryStrategySettings();
  const rules = getChainTradingRules(tokenData.chainId);
  const minScore = Math.max(rules.screening.minScore, settings.directEntryMinScore);
  const minLiquidity = Math.max(rules.screening.minLiquidityUsd, settings.directEntryMinLiquidityUsd);

  return tokenData.screeningScore >= minScore
    && tokenData.liquidityUsd >= minLiquidity
    && (tokenData.rugRiskScore ?? 0) <= rules.screening.maxRugScore;
}

// ===== Monitor all open positions =====
async function monitorOpenPositions() {
  if (!isRunning) return;
  if (monitorInFlight) return;

  const openTrades = db.getOpenTrades();
  const watchPoolEntries = getWatchPool();
  if (openTrades.length === 0 && watchPoolEntries.length === 0) return;

  monitorInFlight = true;
  lastFetchTime = Date.now();

  const tokenAddresses = [...new Set([
    ...openTrades.map(t => t.tokenAddress),
    ...watchPoolEntries.map(entry => entry.address),
  ])];

  console.log(`[Monitor] 📊 Monitoring ${openTrades.length} open positions and ${watchPoolEntries.length} watchpool tokens...`);

  try {
    const priceMap = await fetchTokenPrices(tokenAddresses, ACTIVE_CHAINS);
    const priceUpdates: PriceUpdate[] = [];

    // Also fetch prices for watchpool tokens and update momentum (Strategy 1)
    if (getWatchPoolSize() > 0) {
      const newlyConfirmed = updateWatchPool(priceMap);
      const weights = db.getWeights();
      for (const addr of newlyConfirmed) {
        const pair = priceMap.get(addr);
        if (!pair) continue;

        const elonKw = await fetchElonTweetKeywords().catch(() => []);
        const assessed = await buildAssessedToken(pair, weights, true, elonKw);
        consumeConfirmed(addr);
        if (!assessed) continue;

        const { tokenData } = assessed;
        db.saveToken(tokenData);
        broadcastFn({ type: 'token_discovered', data: tokenData });

        if (tokenData.eligible) {
          const tradeResult = openTrade(tokenData);
          if (tradeResult) {
            broadcastFn({ type: 'trade_opened', data: tradeResult.trade });
            broadcastFn({ type: 'alert', data: tradeResult.alert });
            broadcastFn({ type: 'portfolio_update', data: getPortfolioState() });
          }
        }
      }
    }

    for (const trade of openTrades) {
      const pair = priceMap.get(trade.tokenAddress);
      if (!pair) continue;

      const newPriceUsd = parseFloat(pair.priceUsd || '0');
      const newPriceNative = parseFloat(pair.priceNative || '0');
      const newLiquidity = pair.liquidity?.usd || 0;

      if (!Number.isFinite(newPriceUsd) || !Number.isFinite(newPriceNative) || newPriceUsd <= 0 || newPriceNative <= 0) continue;

      // Update trade
      const result = updateTradePrice(trade, newPriceUsd, newPriceNative, newLiquidity, pair);

      if (result.closed) {
        broadcastFn({ type: 'trade_closed', data: result.trade });
        if (result.alert) broadcastFn({ type: 'alert', data: result.alert });

        // Record rug events for narrative tracking (Strategy 6)
        if (result.trade.status === 'closed-rug') {
          const tokenData = db.getToken(trade.tokenAddress);
          if (tokenData) recordNarrativeRug(tokenData);
        }

        // Check strategy optimization after closes
        checkAndOptimize(broadcastFn);
      } else {
        broadcastFn({ type: 'trade_updated', data: result.trade });
        if (result.alert) broadcastFn({ type: 'alert', data: result.alert });

        // 加仓检测：回调 15-25% + 已止盈过 + 利润加仓
        const addResult = tryAddToPosition(result.trade, newPriceNative, newLiquidity);
        if (addResult) {
          broadcastFn({ type: 'trade_updated', data: addResult.trade });
          broadcastFn({ type: 'alert', data: addResult.alert });
          broadcastFn({ type: 'portfolio_update', data: getPortfolioState() });
        }
      }

      priceUpdates.push({
        tokenAddress: trade.tokenAddress,
        symbol: trade.tokenSymbol,
        priceUsd: newPriceUsd,
        priceNative: newPriceNative,
        liquidityUsd: newLiquidity,
        volume1h: pair.volume?.h1 || 0,
        priceChange5m: pair.priceChange?.m5 || 0,
        priceChange1h: pair.priceChange?.h1 || 0,
      });
    }

    if (priceUpdates.length > 0) {
      lastFetchTime = Date.now();
      broadcastFn({ type: 'price_update', data: priceUpdates });
      broadcastFn({ type: 'portfolio_update', data: getPortfolioState() });
    }
  } catch (error) {
    console.error('[Monitor] Price monitoring error:', error);
    errorCount++;
  } finally {
    monitorInFlight = false;
  }
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let index = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });

  await Promise.all(workers);
}

async function waitForInFlightSettled(): Promise<void> {
  while (discoveryInFlight || monitorInFlight) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

// ===== Take portfolio snapshot =====
function takeSnapshot() {
  const state = getPortfolioState();
  const snapshot: PortfolioSnapshot = {
    timestamp: Date.now(),
    totalValueSOL: state.totalValueSOL,
    cashSOL: state.cashSOL,
    openPositions: state.openPositions,
    cumulativePnlSOL: state.cumulativePnlSOL,
    cumulativePnlPct: state.cumulativePnlPct,
  };

  db.saveSnapshot(snapshot);
  broadcastFn({ type: 'snapshot', data: snapshot });
}

// ===== 链上实时监听集成 =====
function setupRealtimeWatchers() {
  // 新池监听：检测到 Raydium/Pump.fun 新池 → 立即筛选
  onNewPool(async (event: NewPoolEvent) => {
    if (!isRunning) return;

    console.log(`[Monitor] 🆕 链上新池: ${event.baseMint.slice(0, 12)}... (${event.source})`);

    broadcastFn({
      type: 'alert',
      data: {
        id: `alert-newpool-${Date.now()}`,
        timestamp: Date.now(),
        level: 'info',
        title: `🆕 链上新池 (${event.source})`,
        message: `检测到新池: ${event.baseMint.slice(0, 16)}...`,
      },
    });

    // 等 3 秒让 DexScreener 索引到这个 token
    await new Promise(r => setTimeout(r, 3000));

    try {
      const pairs = await fetchTokenDetails([event.baseMint], ACTIVE_CHAINS);
      if (pairs.length === 0) {
        // DexScreener 还没索引到，5 秒后重试一次
        await new Promise(r => setTimeout(r, 5000));
        const retryPairs = await fetchTokenDetails([event.baseMint], ACTIVE_CHAINS);
        if (retryPairs.length === 0) return;
        await processRealtimeDiscovery(retryPairs[0], `链上新池 (${event.source})`);
      } else {
        await processRealtimeDiscovery(pairs[0], `链上新池 (${event.source})`);
      }
    } catch (err) {
      console.error('[Monitor] 新池处理错误:', err);
    }
  });

  // 聪明钱买入监听：检测到聪明钱买新 token → 立即筛选
  onSmartMoneyBuy(async (event: SmartMoneyBuyEvent) => {
    if (!isRunning) return;

    console.log(`[Monitor] 🐋 聪明钱买入: ${event.walletLabel} → ${event.tokenMint.slice(0, 12)}...`);

    broadcastFn({
      type: 'alert',
      data: {
        id: `alert-smbuy-${Date.now()}`,
        timestamp: Date.now(),
        level: 'success',
        title: `🐋 聪明钱买入: ${event.walletLabel}`,
        message: `${event.walletLabel} 刚买入 ${event.tokenMint.slice(0, 16)}...`,
      },
    });

    // 等 2 秒
    await new Promise(r => setTimeout(r, 2000));

    try {
      const pairs = await fetchTokenDetails([event.tokenMint], ACTIVE_CHAINS);
      if (pairs.length > 0) {
        await processRealtimeDiscovery(pairs[0], `聪明钱跟单 (${event.walletLabel})`);
      }
    } catch (err) {
      console.error('[Monitor] 聪明钱跟单处理错误:', err);
    }
  });

  // 启动两个 watcher
  startPoolWatcher();
  startSmartMoneyWatcher();
}

// 实时信号的快速筛选入场流程
async function processRealtimeDiscovery(pair: DexScreenerPair, source: string) {
  if (!isRunning) return;

  const weights = db.getWeights();
  const elonKw = await fetchElonTweetKeywords().catch(() => []);

  const assessed = await buildAssessedToken(pair, weights, false, elonKw);
  if (!assessed) return;

  const { tokenData, result } = assessed;
  // 实时发现的 token 加分：基础分越高加越多（信息优势分层）
  const rtBonus = result.score >= 70 ? 5 : result.score >= 50 ? 3 : 1;
  tokenData.screeningScore += rtBonus;
  tokenData.screeningPassed = [...tokenData.screeningPassed, `🚀 ${source} (+${rtBonus})`];

  db.saveToken(tokenData);
  tokensScreenedCount++;
  broadcastFn({ type: 'token_discovered', data: tokenData });

  if (tokenData.eligible) {
    console.log(`[Monitor] 🎯 实时发现合格: ${tokenData.symbol} (Score: ${tokenData.screeningScore}, 来源: ${source})`);

    // 实时信号直接入场，不走观察池
    const tradeResult = openTrade(tokenData);
    if (tradeResult) {
      broadcastFn({ type: 'trade_opened', data: tradeResult.trade });
      broadcastFn({ type: 'alert', data: tradeResult.alert });
      broadcastFn({ type: 'portfolio_update', data: getPortfolioState() });
    }
  } else if (!isInWatchPool(tokenData.address) && !isConfirmed(tokenData.address)) {
    addToWatchPool(tokenData.address, tokenData.symbol, tokenData.pairAddress);
    console.log(`[Monitor] 👁️ 实时发现 ${tokenData.symbol} (Score: ${result.score}) → 观察池`);
  }
}

