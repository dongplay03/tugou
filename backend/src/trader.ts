// ===== Paper Trading Engine =====
// Manages trade execution, position tracking, and exit logic
// Now with: tiered take-profit, time-window position sizing, LP drain detection

import { randomUUID } from 'crypto';
import type { Trade, TokenData, PortfolioState, Alert, ExitTier } from './types.js';
import * as db from './database.js';
import { getPositionSize, getTpSlMultipliers, detectNarratives } from './screener.js';
import { buildExitPlan, checkTieredExits, executeTiers, getExecutedSellPct } from './tiered-exit.js';
import { getPositionSizeMultiplier, getMaxPositions } from './time-window.js';
import { detectLPDrain } from './lp-lock.js';
import { assessRuntimeRugRisk } from './rug-risk.js';
import type { DexScreenerPair } from './types.js';
import { getChainTradingRules, getScoreBandValue, isExperimentalStrategy } from './chain-rules.js';

const INITIAL_CAPITAL_BY_CHAIN = {
  solana: 1.0,
} as const;

const ACTIVE_CHAINS = ['solana'] as const;

// ===== Open a new paper trade =====
export function openTrade(token: TokenData): { trade: Trade; alert: Alert } | null {
  const chainId = token.chainId ?? 'solana';
  const rules = getChainTradingRules(chainId);
  const cash = db.getCash(chainId);

  // Don't trade if not enough cash
  if (cash < rules.position.minCash) {
    console.log(`[Trader] Insufficient ${rules.unit} cash (${cash.toFixed(4)}), skipping ${token.symbol}`);
    return null;
  }

  // Check if we already have an open position for this token
  const openTrades = db.getOpenTrades();
  if (openTrades.some(t => t.tokenAddress === token.address && t.chainId === chainId)) {
    console.log(`[Trader] Already holding ${token.symbol}, skipping`);
    return null;
  }

  // === Narrative exposure control (Optimization 5) ===
  // Don't let >40% of total position value be in the same narrative sector
  const tokenNarratives = detectNarratives(token.name, token.symbol);
  if (tokenNarratives.length > 0 && openTrades.length > 0) {
    const totalOpenValue = openTrades.reduce((s, t) => s + t.amountSOL * t.currentRoi / 100 + t.amountSOL, 0);
    const narrativeExposure = openTrades
      .filter(t => t.narrativeTags.some(tag => tokenNarratives.includes(tag)))
      .reduce((s, t) => s + t.amountSOL, 0);
    const exposureRatio = totalOpenValue > 0 ? narrativeExposure / totalOpenValue : 0;

    if (exposureRatio > 0.40) {
      console.log(`[Trader] ⚠️ Narrative exposure ${tokenNarratives.join('/')} at ${(exposureRatio * 100).toFixed(0)}% > 40% cap, skipping ${token.symbol}`);
      return null;
    }
  }

  // Limit max open positions (time-window aware)
  const maxPos = getMaxPositions();
  if (openTrades.length >= maxPos) {
    console.log(`[Trader] Max open positions (${maxPos}) reached, skipping ${token.symbol}`);
    return null;
  }

  let positionSize = getPositionSize(token.screeningScore, cash, chainId);
  // Apply time-window multiplier (smaller positions during off-peak)
  positionSize *= getPositionSizeMultiplier();

  if (positionSize < rules.position.minPosition) {
    console.log(`[Trader] Position too small for ${token.symbol}, skipping`);
    return null;
  }

  if (token.priceNative <= 0) {
    console.log(`[Trader] Invalid price for ${token.symbol} (priceNative=${token.priceNative}), skipping`);
    return null;
  }

  let { tp, sl } = getTpSlMultipliers(token.screeningScore, chainId);
  if (isExperimentalStrategy(token.experimentStrategy)) {
    tp = Math.min(tp, rules.exits.experimentalMaxTp);
    sl = Math.max(sl, rules.exits.experimentalMinSl);
  }
  const narratives = detectNarratives(token.name, token.symbol);

  for (const narrative of narratives) {
    const overlap = openTrades.filter(t => t.narrativeTags.includes(narrative)).length;
    if (overlap >= 2) {
      console.log(`[Trader] Narrative correlation cap reached for ${narrative}, skipping ${token.symbol}`);
      return null;
    }
  }

  const tieredExits = buildExitPlan(token.screeningScore, token.experimentStrategy, chainId);
  const openedAt = Date.now();

  const trade: Trade = {
    id: `trade-${randomUUID().slice(0, 8)}`,
    chainId,
    tokenAddress: token.address,
    tokenSymbol: token.symbol,
    tokenName: token.name,
    pairAddress: token.pairAddress,
    entryPriceUsd: token.priceUsd,
    entryPriceNative: token.priceNative,
    currentPriceUsd: token.priceUsd,
    exitPriceUsd: null,
    entryTimestamp: openedAt,
    exitTimestamp: null,
    amountSOL: positionSize,
    initialAmountSOL: positionSize,
    tokensAcquired: positionSize / token.priceNative,
    status: 'open',
    roi: null,
    currentRoi: 0,
    unrealizedPnlSOL: 0,
    realizedPnlSOL: 0,
    takeProfitMultiplier: tp,
    stopLossMultiplier: sl,
    screeningScore: token.screeningScore,
    experimentStrategy: token.experimentStrategy ?? 'score_momentum',
    rugRiskScore: token.rugRiskScore ?? 0,
    rugRiskLevel: token.rugRiskLevel ?? 'low',
    rugRiskReasons: token.rugRiskReasons ?? [],
    entryReasons: token.screeningPassed,
    narrativeTags: narratives,
    principalRecovered: false,
    halfSoldPrice: null,
    halfSoldTimestamp: null,
    recoveredSOL: 0,
    highestPriceAfterRecovery: 0,
    trailingStopPct: getBaseTrailingStopPct(token.screeningScore, chainId),
    tieredExits,
    tieredExitsExecuted: 0,
    totalRecoveredSOL: 0,
    liquidityAtEntry: token.liquidityUsd,
    currentLiquidity: token.liquidityUsd,
    lastPriceUpdate: openedAt,
  };

  const alert: Alert = {
    id: `alert-${randomUUID().slice(0, 8)}`,
    timestamp: openedAt,
    level: 'success',
    title: `🟢 Opened: ${token.symbol}`,
    message: `[${chainId.toUpperCase()}] Bought ${positionSize.toFixed(4)} ${rules.unit} at $${token.priceUsd.toFixed(8)}. Strategy: ${token.experimentStrategy}. Score: ${token.screeningScore}. TP: ${tp}x, SL: ${(1 - sl) * 100}%.`,
    tokenSymbol: token.symbol,
    tokenAddress: token.address,
  };

  db.runInTransaction(() => {
    db.setCash(cash - positionSize, chainId);
    db.saveTrade(trade);
    db.saveTradePriceHistoryPoint(trade.id, openedAt, token.priceUsd, token.priceNative, token.liquidityUsd);
    db.saveAlert(alert);
  });

  console.log(`[Trader] ✅ OPENED ${token.symbol}: ${positionSize.toFixed(4)} ${rules.unit} @ $${token.priceUsd.toFixed(8)} | Score: ${token.screeningScore} | TP: ${tp}x SL: ${((1 - sl) * 100).toFixed(0)}%`);

  return { trade, alert };
}

// ===== Update trade with new price data =====
export function updateTradePrice(
  trade: Trade,
  newPriceUsd: number,
  newPriceNative: number,
  newLiquidity: number,
  pair?: DexScreenerPair,
): { trade: Trade; closed: boolean; alert: Alert | null } {
  const rules = getChainTradingRules(trade.chainId);

  // Guard against invalid prices
  if (trade.entryPriceNative <= 0) {
    console.warn(`[Trader] Invalid entryPriceNative for ${trade.tokenSymbol}, skipping price update`);
    return { trade, closed: false, alert: null };
  }

  const priceMultiplier = newPriceNative / trade.entryPriceNative;
  const currentValueSOL = trade.amountSOL * priceMultiplier;
  const unrealizedPnl = currentValueSOL - trade.amountSOL + trade.totalRecoveredSOL;
  const roi = (priceMultiplier - 1) * 100;

  trade.currentPriceUsd = newPriceUsd;
  trade.currentRoi = roi;
  trade.unrealizedPnlSOL = unrealizedPnl;
  trade.currentLiquidity = newLiquidity;
  trade.lastPriceUpdate = Date.now();

  db.saveTradePriceHistoryPoint(trade.id, trade.lastPriceUpdate, newPriceUsd, newPriceNative, newLiquidity);

  // === Check LP drain (Strategy 4 - ongoing monitoring) ===
  const holdTimeMs = Date.now() - trade.entryTimestamp;
  const holdTimeHours = holdTimeMs / 3_600_000;
  const rugRisk = assessRuntimeRugRisk(trade, {
    pair,
    liquidityAtEntry: trade.liquidityAtEntry,
    currentLiquidity: newLiquidity,
    priceMultiplier,
    holdTimeMs,
  });
  trade.rugRiskScore = rugRisk.score;
  trade.rugRiskLevel = rugRisk.level;
  trade.rugRiskReasons = rugRisk.reasons;

  if (rugRisk.shouldEmergencyExit) {
    return closeTrade(trade, newPriceUsd, newPriceNative, 'closed-rug',
      `🚨 RUG RISK EXIT: ${rugRisk.score}/100 (${rugRisk.level}). ${rugRisk.reasons.join(' | ')}`);
  }

  // === Rapid liquidity drain detection (per-cycle) ===
  // If liquidity dropped >15% in a single 20s monitoring cycle, that's a strong rug signal
  const prevLiquidity = trade.currentLiquidity;
  if (prevLiquidity > 0 && newLiquidity >= 0) {
    const cycleDrop = 1 - (newLiquidity / prevLiquidity);
    if (cycleDrop >= rules.exits.rapidLiquidityDrainPct) {
      return closeTrade(trade, newPriceUsd, newPriceNative, 'closed-rug',
        `🚨 RAPID LP DRAIN: ${(cycleDrop * 100).toFixed(0)}% drop in single cycle (${prevLiquidity.toFixed(0)} → ${newLiquidity.toFixed(0)})`);
    }
  }

  const lpDrain = detectLPDrain(trade.liquidityAtEntry, newLiquidity, holdTimeMs);
  if (lpDrain.alert && newLiquidity < trade.liquidityAtEntry * 0.3) {
    // Severe LP drain → close as rug
    return closeTrade(trade, newPriceUsd, newPriceNative, 'closed-rug',
      `🚨 LP DRAIN: ${lpDrain.label}`);
  }

  // === Check tiered exits (Strategy 8) ===
  const pendingTiers = checkTieredExits(trade.tieredExits, priceMultiplier);
  if (pendingTiers.length > 0) {
    const { solToRecover, remainingFraction } = executeTiers(
      pendingTiers, trade.amountSOL, priceMultiplier
    );

    trade.amountSOL *= remainingFraction;
    trade.tokensAcquired *= remainingFraction;
    trade.totalRecoveredSOL += solToRecover;
    trade.tieredExitsExecuted += pendingTiers.length;

    // First tier acts as principal recovery
    if (!trade.principalRecovered && trade.totalRecoveredSOL > 0) {
      trade.principalRecovered = true;
      trade.halfSoldPrice = newPriceUsd;
      trade.halfSoldTimestamp = Date.now();
      trade.recoveredSOL = trade.totalRecoveredSOL;
      trade.highestPriceAfterRecovery = newPriceNative;
    }

    trade.trailingStopPct = getDynamicTrailingStopPct(trade);

    // Add recovered SOL back to cash
    const cash = db.getCash(trade.chainId);

    const tierDesc = pendingTiers.map(t => `${t.multiplier}x(${(t.sellPct * 100).toFixed(0)}%)`).join(', ');
    const executedPct = getExecutedSellPct(trade.tieredExits);
    const alert: Alert = {
      id: `alert-${randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
      level: 'success',
      title: `💰 阶梯止盈: ${trade.tokenSymbol}`,
      message: `Tier(s) hit: ${tierDesc}. Recovered ${solToRecover.toFixed(4)} ${rules.unit}. Total sold: ${(executedPct * 100).toFixed(0)}%. Remaining position: ${(trade.amountSOL).toFixed(4)} ${rules.unit}.`,
      tokenSymbol: trade.tokenSymbol,
      tokenAddress: trade.tokenAddress,
    };

    db.runInTransaction(() => {
      db.setCash(cash + solToRecover, trade.chainId);
      db.saveTrade(trade);
      db.saveAlert(alert);
    });

    console.log(`[Trader] 💰 阶梯止盈 ${trade.tokenSymbol}: ${tierDesc}. Recovered ${solToRecover.toFixed(4)} ${rules.unit} at ${priceMultiplier.toFixed(2)}x`);

    // If all tiers executed and position is tiny, close the trade
    if (trade.amountSOL < 0.001) {
      return closeTrade(trade, newPriceUsd, newPriceNative, 'closed-tp',
        `🎯 All tiered exits executed. Total recovered: ${trade.totalRecoveredSOL.toFixed(4)} ${rules.unit}`);
    }

    return { trade, closed: false, alert };
  }

  // === If principal recovered, use trailing stop on remaining position ===
  if (trade.principalRecovered) {
    trade.trailingStopPct = getDynamicTrailingStopPct(trade);

    if (newPriceNative > trade.highestPriceAfterRecovery) {
      trade.highestPriceAfterRecovery = newPriceNative;
    }

    const dropFromHigh = 1 - (newPriceNative / trade.highestPriceAfterRecovery);
    if (dropFromHigh >= trade.trailingStopPct && trade.highestPriceAfterRecovery > 0) {
      return closeTrade(trade, newPriceUsd, newPriceNative, 'closed-tp',
        `🎯 Trailing stop hit. Drop: ${(dropFromHigh * 100).toFixed(1)}% from high. Total recovered: ${trade.totalRecoveredSOL.toFixed(4)} ${rules.unit}`);
    }
  }

  // === Check RUG detection ===
  if (trade.liquidityAtEntry > 0) {
    const liquidityDrop = 1 - (newLiquidity / trade.liquidityAtEntry);
    if (liquidityDrop >= rules.exits.liquidityRugDropPct) {
      return closeTrade(trade, newPriceUsd, newPriceNative, 'closed-rug',
        `🚨 RUG DETECTED! Liquidity dropped ${(liquidityDrop * 100).toFixed(0)}%`);
    }
  }

  // === Check price-based rug ===
  if (priceMultiplier <= rules.exits.priceRugMultiplier) {
    return closeTrade(trade, newPriceUsd, newPriceNative, 'closed-rug',
      `🚨 DUMP DETECTED! Price crashed ${((1 - priceMultiplier) * 100).toFixed(0)}%`);
  }

  // === Check hard stop loss ===
  const effectiveStopLossMultiplier = getEffectiveStopLossMultiplier(trade, holdTimeHours, roi);
  if (priceMultiplier <= effectiveStopLossMultiplier) {
    return closeTrade(trade, newPriceUsd, newPriceNative, 'closed-sl',
      `🔴 Stop loss hit at ${(priceMultiplier).toFixed(2)}x (effective SL: ${effectiveStopLossMultiplier.toFixed(2)}x)`);
  }

  // Aggressive experiments should free capital quickly when no edge appears.
  if (isExperimentalStrategy(trade.experimentStrategy) && holdTimeHours >= rules.exits.experimentTimeoutHours && roi < 10) {
    return closeTrade(trade, newPriceUsd, newPriceNative, 'closed-time',
      `⏱️ ${rules.label} experiment timeout (${trade.experimentStrategy}) after ${(rules.exits.experimentTimeoutHours * 60).toFixed(0)}m with ${roi.toFixed(1)}% ROI`);
  }

  // === Check max hold time ===
  const maxHoldHours = db.getMaxHoldHours();
  if (holdTimeHours >= maxHoldHours && roi < 10) {
    return closeTrade(trade, newPriceUsd, newPriceNative, 'closed-time',
      `⏰ Max hold time (${maxHoldHours}h) reached with only ${roi.toFixed(1)}% ROI`);
  }

  // Just update, no close
  db.saveTrade(trade);
  return { trade, closed: false, alert: null };
}

// ===== Close a trade =====
export function closeTrade(
  trade: Trade,
  exitPriceUsd: number,
  exitPriceNative: number,
  status: Trade['status'],
  reason: string
): { trade: Trade; closed: boolean; alert: Alert } {
  const rules = getChainTradingRules(trade.chainId);

  // Guard against division by zero
  const priceMultiplier = trade.entryPriceNative > 0
    ? exitPriceNative / trade.entryPriceNative
    : 0;
  const exitValue = trade.amountSOL * priceMultiplier;
  const totalReturn = exitValue + trade.totalRecoveredSOL;
  const originalInvestment = trade.initialAmountSOL;
  const roi = originalInvestment > 0
    ? ((totalReturn / originalInvestment) - 1) * 100
    : 0;

  trade.exitPriceUsd = exitPriceUsd;
  trade.exitTimestamp = Date.now();
  trade.status = status;
  trade.roi = roi;
  trade.currentRoi = roi;
  trade.realizedPnlSOL = totalReturn - originalInvestment;
  trade.unrealizedPnlSOL = 0;

  // Add remaining value back to cash
  const cash = db.getCash(trade.chainId);

  const levelMap: Record<string, Alert['level']> = {
    'closed-tp': 'success',
    'closed-sl': 'warning',
    'closed-rug': 'danger',
    'closed-manual': 'info',
    'closed-time': 'info',
  };

  const alert: Alert = {
    id: `alert-${randomUUID().slice(0, 8)}`,
    timestamp: Date.now(),
    level: levelMap[status] || 'info',
    title: `${roi >= 0 ? '🟢' : '🔴'} Closed: ${trade.tokenSymbol}`,
    message: `${reason} | ROI: ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}% | PnL: ${trade.realizedPnlSOL >= 0 ? '+' : ''}${trade.realizedPnlSOL.toFixed(4)} ${rules.unit}`,
    tokenSymbol: trade.tokenSymbol,
    tokenAddress: trade.tokenAddress,
  };

  db.runInTransaction(() => {
    db.setCash(cash + exitValue, trade.chainId);
    db.saveTrade(trade);
    db.saveAlert(alert);
  });

  console.log(`[Trader] ${roi >= 0 ? '✅' : '❌'} CLOSED ${trade.tokenSymbol}: ${status} | ROI: ${roi.toFixed(1)}% | PnL: ${trade.realizedPnlSOL.toFixed(4)} ${rules.unit} | ${reason}`);

  return { trade, closed: true, alert };
}

// ===== Manually close a trade =====
export function manualCloseTrade(tradeId: string): { trade: Trade; alert: Alert } | null {
  const trade = db.getTrade(tradeId);
  if (!trade || trade.status !== 'open') return null;

  const result = closeTrade(
    trade,
    trade.currentPriceUsd,
    trade.entryPriceUsd > 0
      ? trade.currentPriceUsd * (trade.entryPriceNative / trade.entryPriceUsd)
      : 0,
    'closed-manual',
    'Manual close by user'
  );

  return { trade: result.trade, alert: result.alert };
}

// ===== Calculate portfolio state =====
export function getPortfolioState(): PortfolioState {
  const openTrades = db.getOpenTrades();
  const allTrades = db.getAllTrades();
  const closedTrades = allTrades.filter(t => t.status !== 'open');
  const winners = closedTrades.filter(t => (t.roi ?? 0) > 0);

  const byChain = ACTIVE_CHAINS.map(chainId => {
    const initialCapital = INITIAL_CAPITAL_BY_CHAIN[chainId];
    const chainOpen = openTrades.filter(t => t.chainId === chainId);
    const chainAll = allTrades.filter(t => t.chainId === chainId);
    const chainClosed = chainAll.filter(t => t.status !== 'open');
    const chainWinners = chainClosed.filter(t => (t.roi ?? 0) > 0);
    const chainCash = db.getCash(chainId);
    const chainOpenValue = chainOpen.reduce((sum, t) => {
      const multiplier = t.entryPriceUsd > 0 ? t.currentPriceUsd / t.entryPriceUsd : 0;
      return sum + t.amountSOL * multiplier;
    }, 0);
    const totalValue = chainCash + chainOpenValue;
    const cumulativePnl = totalValue - initialCapital;

    return {
      chainId,
      totalValueSOL: totalValue,
      cashSOL: chainCash,
      openPositions: chainOpen.length,
      totalTrades: chainAll.length,
      closedTrades: chainClosed.length,
      wins: chainWinners.length,
      losses: chainClosed.length - chainWinners.length,
      winRate: chainClosed.length > 0 ? chainWinners.length / chainClosed.length : 0,
      cumulativePnlSOL: cumulativePnl,
      cumulativePnlPct: initialCapital > 0 ? (cumulativePnl / initialCapital) * 100 : 0,
    };
  });

  const cash = byChain.reduce((sum, chain) => sum + chain.cashSOL, 0);
  const openValue = openTrades.reduce((sum, t) => {
    const multiplier = t.entryPriceUsd > 0 ? t.currentPriceUsd / t.entryPriceUsd : 0;
    return sum + t.amountSOL * multiplier;
  }, 0);

  const totalValue = cash + openValue;
  const initialCapital = byChain.reduce((sum, chain) => sum + INITIAL_CAPITAL_BY_CHAIN[chain.chainId], 0);
  const cumulativePnl = totalValue - initialCapital;
  const cumulativePnlPct = (cumulativePnl / initialCapital) * 100;

  const bestTrade = closedTrades.reduce<{ symbol: string; roi: number } | null>(
    (best, t) => (!best || (t.roi ?? 0) > best.roi) ? { symbol: t.tokenSymbol, roi: t.roi ?? 0 } : best,
    null
  );
  const worstTrade = closedTrades.reduce<{ symbol: string; roi: number } | null>(
    (worst, t) => (!worst || (t.roi ?? 0) < worst.roi) ? { symbol: t.tokenSymbol, roi: t.roi ?? 0 } : worst,
    null
  );

  return {
    totalValueSOL: totalValue,
    cashSOL: cash,
    openPositions: openTrades.length,
    totalTrades: allTrades.length,
    closedTrades: closedTrades.length,
    wins: winners.length,
    losses: closedTrades.length - winners.length,
    winRate: closedTrades.length > 0 ? winners.length / closedTrades.length : 0,
    cumulativePnlSOL: cumulativePnl,
    cumulativePnlPct,
    bestTrade,
    worstTrade,
    byChain,
  };
}

function getBaseTrailingStopPct(score: number, chainId: Trade['chainId'] = 'solana'): number {
  const rules = getChainTradingRules(chainId);
  return getScoreBandValue(rules.exits.trailingStop, score);
}

function getDynamicTrailingStopPct(trade: Trade): number {
  const points = db.getRecentTradePriceHistory(trade.id, 8);
  const rules = getChainTradingRules(trade.chainId);
  const base = getBaseTrailingStopPct(trade.screeningScore, trade.chainId);
  const holdHours = (Date.now() - trade.entryTimestamp) / 3_600_000;

  if (points.length < 4) {
    return holdHours >= 24 ? Math.max(0.18, base - 0.05) : base;
  }

  const returns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].priceNative;
    const next = points[i].priceNative;
    if (prev > 0 && next > 0) {
      returns.push((next - prev) / prev);
    }
  }

  if (returns.length === 0) return base;

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / returns.length;
  const volatility = Math.sqrt(variance);

  let dynamic = base;
  if (volatility >= 0.12) dynamic += 0.05;
  else if (volatility <= 0.04) dynamic -= 0.05;

  if (holdHours >= 24 && trade.currentRoi < 50) dynamic -= 0.07;
  else if (holdHours >= 12 && trade.currentRoi < 25) dynamic -= 0.03;

  return Math.min(rules.exits.trailingMax, Math.max(rules.exits.trailingMin, dynamic));
}

function getEffectiveStopLossMultiplier(trade: Trade, holdTimeHours: number, roi: number): number {
  let multiplier = trade.stopLossMultiplier;

  if (holdTimeHours >= 36 && roi < 50) {
    multiplier = Math.max(multiplier, 0.90);
  } else if (holdTimeHours >= 24 && roi < 50) {
    multiplier = Math.max(multiplier, 0.85);
  }

  return multiplier;
}
