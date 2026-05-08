// ===== Strategy Self-Optimizer =====
// Reviews performance every N closed trades and adjusts weights.
// v2: Per-strategy analysis, loss review auto-tagging, DEX/liquidity/score band breakdown.

import type { Trade, StrategyLog, StrategyWeights, CommonTrait, ExperimentStrategyTag, WsServerMessage } from './types.js';
import * as db from './database.js';
import { getExperimentStrategyLabel } from './experiment-strategies.js';

const BATCH_SIZE = 5; // Review after every 5 closed trades (smaller for faster iteration)

type BroadcastFn = (msg: WsServerMessage) => void;

let lastReviewedCount = 0;

export function checkAndOptimize(broadcastFn: BroadcastFn) {
  const closedCount = db.getClosedTradesCount();

  // Only review after every BATCH_SIZE closed trades
  if (closedCount < lastReviewedCount + BATCH_SIZE) return;
  if (closedCount === 0) return;

  lastReviewedCount = closedCount;
  const batchNumber = Math.floor(closedCount / BATCH_SIZE);

  console.log(`[Optimizer] 🧠 Running strategy review (batch #${batchNumber}, ${closedCount} total closed trades)`);

  const closedTrades = db.getClosedTrades();
  const recentTrades = closedTrades.slice(0, BATCH_SIZE * 2); // Look at recent trades
  const currentWeights = db.getWeights();

  const log = runOptimization(batchNumber, recentTrades, currentWeights);

  // Save new weights
  db.setWeights(log.weightsSnapshot);
  db.setMaxHoldHours(log.nextMaxHoldHours);
  db.saveStrategyLog(log);

  // Broadcast
  broadcastFn({ type: 'strategy_update', data: log });
  broadcastFn({
    type: 'alert',
    data: {
      id: `alert-strategy-${Date.now()}`,
      timestamp: Date.now(),
      level: 'info',
      title: `🧠 Strategy Updated (Batch #${batchNumber})`,
      message: `Win rate: ${(log.winRate * 100).toFixed(0)}%, Avg ROI: ${log.avgROI.toFixed(1)}%. Max hold: ${log.nextMaxHoldHours}h. ${log.changes.length} adjustments made.`,
    },
  });

  console.log(`[Optimizer] Strategy updated: WR ${(log.winRate * 100).toFixed(0)}%, Avg ROI ${log.avgROI.toFixed(1)}%`);
  for (const change of log.changes) {
    console.log(`  → ${change}`);
  }
}

// ===== Per-strategy performance analysis =====
interface StrategyBucket {
  strategy: ExperimentStrategyTag;
  trades: Trade[];
  wins: number;
  losses: number;
  winRate: number;
  avgROI: number;
  totalROI: number;
  avgScore: number;
  rugCount: number;
}

function analyzePerStrategy(trades: Trade[]): StrategyBucket[] {
  const buckets = new Map<ExperimentStrategyTag, Trade[]>();

  for (const trade of trades) {
    const strat = trade.experimentStrategy || 'score_momentum';
    const existing = buckets.get(strat) || [];
    existing.push(trade);
    buckets.set(strat, existing);
  }

  const results: StrategyBucket[] = [];
  for (const [strategy, strades] of buckets) {
    const wins = strades.filter(t => (t.roi ?? 0) > 0).length;
    const losses = strades.length - wins;
    const totalROI = strades.reduce((s, t) => s + (t.roi ?? 0), 0);
    const avgScore = strades.reduce((s, t) => s + t.screeningScore, 0) / strades.length;
    const rugCount = strades.filter(t => t.status === 'closed-rug').length;

    results.push({
      strategy,
      trades: strades,
      wins,
      losses,
      winRate: strades.length > 0 ? wins / strades.length : 0,
      avgROI: strades.length > 0 ? totalROI / strades.length : 0,
      totalROI,
      avgScore,
      rugCount,
    });
  }

  return results.sort((a, b) => b.avgROI - a.avgROI);
}

// ===== Loss review auto-tagging =====
interface LossTag {
  tag: string;
  count: number;
  avgLoss: number;
  pct: number; // percentage of total losses
}

function analyzeLossTags(losers: Trade[]): LossTag[] {
  if (losers.length === 0) return [];

  const tagCounts = new Map<string, { count: number; totalLoss: number }>();

  const addTag = (tag: string, loss: number) => {
    const existing = tagCounts.get(tag) || { count: 0, totalLoss: 0 };
    existing.count++;
    existing.totalLoss += loss;
    tagCounts.set(tag, existing);
  };

  for (const trade of losers) {
    const roi = trade.roi ?? 0;
    const loss = Math.abs(roi);

    // Tag by liquidity range
    if (trade.liquidityAtEntry < 30_000) addTag('💧 Low liquidity (<$30K)', loss);
    else if (trade.liquidityAtEntry < 80_000) addTag('💧 Mid liquidity ($30-80K)', loss);
    else addTag('💧 High liquidity (>$80K)', loss);

    // Tag by DEX
    addTag(`🔀 DEX: ${trade.pairAddress ? 'known' : 'unknown'}`, loss);

    // Tag by exit type
    addTag(`📤 Exit: ${trade.status}`, loss);

    // Tag by score band
    if (trade.screeningScore >= 85) addTag('📊 Score: 85+ (high)', loss);
    else if (trade.screeningScore >= 70) addTag('📊 Score: 70-85 (mid-high)', loss);
    else if (trade.screeningScore >= 55) addTag('📊 Score: 55-70 (mid)', loss);
    else addTag('📊 Score: <55 (low)', loss);

    // Tag by strategy
    addTag(`🎯 Strategy: ${getExperimentStrategyLabel(trade.experimentStrategy)}`, loss);

    // Tag by rug risk at entry
    if (trade.rugRiskScore >= 50) addTag('🚨 Entry rug risk: high (50+)', loss);
    else if (trade.rugRiskScore >= 25) addTag('⚠️ Entry rug risk: medium (25-50)', loss);

    // Tag by narrative
    for (const tag of trade.narrativeTags) {
      addTag(`🏷️ Narrative: ${tag}`, loss);
    }

    // Tag by hold time
    const holdHours = trade.exitTimestamp
      ? (trade.exitTimestamp - trade.entryTimestamp) / 3_600_000
      : 0;
    if (holdHours < 1) addTag('⏱️ Hold: <1h (quick loss)', loss);
    else if (holdHours < 6) addTag('⏱️ Hold: 1-6h', loss);
    else addTag('⏱️ Hold: >6h (slow bleed)', loss);
  }

  const totalLosses = losers.length;
  return Array.from(tagCounts.entries())
    .map(([tag, data]) => ({
      tag,
      count: data.count,
      avgLoss: data.totalLoss / data.count,
      pct: data.count / totalLosses,
    }))
    .sort((a, b) => b.count - a.count);
}

function runOptimization(
  batchNumber: number,
  trades: Trade[],
  weights: StrategyWeights
): StrategyLog & { nextMaxHoldHours: number } {
  const winners = trades.filter(t => (t.roi ?? 0) > 0);
  const losers = trades.filter(t => (t.roi ?? 0) <= 0);
  const winRate = trades.length > 0 ? winners.length / trades.length : 0;
  const avgROI = trades.length > 0
    ? trades.reduce((sum, t) => sum + (t.roi ?? 0), 0) / trades.length
    : 0;

  const commonTraits = analyzeCommonTraits(winners, losers);
  const changes: string[] = [];
  const newWeights = {
    ...weights,
    narrativeBonus: { ...weights.narrativeBonus },
  };
  let nextMaxHoldHours = db.getMaxHoldHours();

  // === Global win rate adjustments ===
  if (winRate < 0.35) {
    changes.push('Win rate < 35% → Increasing liquidity threshold weight (+3)');
    newWeights.liquidityDepth = Math.min(25, newWeights.liquidityDepth + 3);
    changes.push('Win rate < 35% → Increasing buy pressure weight (+2)');
    newWeights.buyPressure = Math.min(20, newWeights.buyPressure + 2);
  } else if (winRate < 0.50) {
    changes.push('Win rate < 50% → Slightly increasing screening strictness');
    newWeights.liquidityDepth = Math.min(25, newWeights.liquidityDepth + 1);
  } else if (winRate > 0.65) {
    changes.push('Win rate > 65% → Strategy performing well, maintaining parameters');
  }

  // === Rug-pull frequency ===
  const rugTrades = trades.filter(t => t.status === 'closed-rug');
  if (rugTrades.length > 0) {
    const rugRate = rugTrades.length / trades.length;
    if (rugRate > 0.15) {
      changes.push(`Rug rate ${(rugRate * 100).toFixed(0)}% → Increasing contract safety weight (+3)`);
      newWeights.contractSafety = Math.min(30, newWeights.contractSafety + 3);
      changes.push('Rug rate high → Increasing holder distribution check (+2)');
      newWeights.holderDistribution = Math.min(20, newWeights.holderDistribution + 2);
    }
  }

  // === Exit reason distribution ===
  const exitCounts = {
    tp: trades.filter(t => t.status === 'closed-tp').length,
    sl: trades.filter(t => t.status === 'closed-sl').length,
    rug: trades.filter(t => t.status === 'closed-rug').length,
    time: trades.filter(t => t.status === 'closed-time').length,
  };

  if (trades.length > 0) {
    const timeoutRate = exitCounts.time / trades.length;
    const stopLossRate = exitCounts.sl / trades.length;

    if (timeoutRate >= 0.25) {
      nextMaxHoldHours = Math.max(24, nextMaxHoldHours - 6);
      changes.push(`Time exits ${(timeoutRate * 100).toFixed(0)}% → Reducing max hold to ${nextMaxHoldHours}h`);
      newWeights.freshness = Math.min(10, newWeights.freshness + 1);
      changes.push('Time exits elevated → Increasing freshness weight (+1)');
    }

    if (stopLossRate >= 0.30) {
      newWeights.buyPressure = Math.min(20, newWeights.buyPressure + 1);
      newWeights.volumeRatio = Math.min(18, newWeights.volumeRatio + 1);
      changes.push(`Stop-loss exits ${(stopLossRate * 100).toFixed(0)}% → Tightening entry quality via buy pressure (+1) and volume ratio (+1)`);
    }

    if (exitCounts.tp === 0 && trades.length >= 4) {
      changes.push('No take-profit exits in recent sample → Entries may be too late or too weak');
    }
  }

  // === Per-strategy analysis (NEW: Optimization 4) ===
  const strategyBuckets = analyzePerStrategy(trades);
  const strategiesToDisable: string[] = [];

  for (const bucket of strategyBuckets) {
    if (bucket.trades.length < 2) continue; // need at least 2 trades for meaningful analysis

    const label = getExperimentStrategyLabel(bucket.strategy);

    if (bucket.winRate >= 0.65 && bucket.avgROI > 15) {
      changes.push(`🟢 Strategy "${label}" strong: WR ${(bucket.winRate * 100).toFixed(0)}%, avg ROI ${bucket.avgROI.toFixed(0)}%`);
    } else if (bucket.winRate < 0.25 && bucket.trades.length >= 3) {
      changes.push(`🔴 Strategy "${label}" weak: WR ${(bucket.winRate * 100).toFixed(0)}% (${bucket.trades.length} trades) — consider pausing`);
      strategiesToDisable.push(bucket.strategy);
    }

    if (bucket.rugCount >= 2) {
      changes.push(`🚨 Strategy "${label}" has ${bucket.rugCount} rug exits — tightening entry for this strategy`);
    }

    // Adjust strategy-specific weights
    if (bucket.strategy === 'smart_money_follow' && bucket.winRate > 0.6) {
      newWeights.smartMoneySignal = Math.min(15, newWeights.smartMoneySignal + 1);
      changes.push(`Smart money strategy strong → increasing smart money signal weight (+1)`);
    }
    if (bucket.strategy === 'momentum_breakout' && bucket.winRate < 0.4) {
      newWeights.freshness = Math.min(10, newWeights.freshness + 1);
      changes.push(`Momentum breakout weak → increasing freshness weight (+1)`);
    }
  }

  if (strategiesToDisable.length > 0) {
    changes.push(`⚠️ Consider disabling strategies: ${strategiesToDisable.join(', ')} (will need DB support)`);
  }

  // === Narrative performance ===
  const narrativePerf = new Map<string, { wins: number; total: number; totalROI: number }>();
  for (const trade of trades) {
    for (const tag of trade.narrativeTags) {
      const existing = narrativePerf.get(tag) ?? { wins: 0, total: 0, totalROI: 0 };
      existing.total++;
      existing.totalROI += trade.roi ?? 0;
      if ((trade.roi ?? 0) > 0) existing.wins++;
      narrativePerf.set(tag, existing);
    }
  }

  for (const [tag, perf] of narrativePerf.entries()) {
    const wr = perf.total > 0 ? perf.wins / perf.total : 0;
    const avgR = perf.total > 0 ? perf.totalROI / perf.total : 0;
    const currentBonus = newWeights.narrativeBonus[tag] || 1;

    if (wr > 0.6 && avgR > 20) {
      newWeights.narrativeBonus[tag] = Math.min(6, currentBonus + 1);
      changes.push(`Narrative "${tag}" outperforming (WR: ${(wr * 100).toFixed(0)}%, avg ROI: ${avgR.toFixed(0)}%) → bonus increased to ${newWeights.narrativeBonus[tag]}`);
    } else if (wr < 0.3 && perf.total >= 2) {
      newWeights.narrativeBonus[tag] = Math.max(0, currentBonus - 1);
      changes.push(`Narrative "${tag}" underperforming (WR: ${(wr * 100).toFixed(0)}%) → bonus decreased to ${newWeights.narrativeBonus[tag]}`);
    }
  }

  // === Stop loss effectiveness ===
  const slTrades = trades.filter(t => t.status === 'closed-sl');
  if (slTrades.length > winners.length && slTrades.length > 2) {
    changes.push('Stop losses triggering frequently → Consider wider SL range');
  }

  // === Principal recovery effectiveness ===
  const recoveredTrades = trades.filter(t => t.principalRecovered);
  if (recoveredTrades.length > 0) {
    const avgRecoveredROI = recoveredTrades.reduce((s, t) => s + (t.roi ?? 0), 0) / recoveredTrades.length;
    changes.push(`Principal recovery trades: ${recoveredTrades.length}, avg final ROI: ${avgRecoveredROI.toFixed(1)}%`);
  }

  // === Loss review auto-tagging (NEW: Optimization 9) ===
  if (losers.length >= 2) {
    const lossTags = analyzeLossTags(losers);
    const concentrated = lossTags.filter(t => t.pct >= 0.4); // tags appearing in >40% of losses

    if (concentrated.length > 0) {
      changes.push(`📊 LOSS PATTERN DETECTED (${losers.length} losers):`);
      for (const lt of concentrated.slice(0, 5)) {
        changes.push(`  ${lt.tag}: ${lt.count}x (${(lt.pct * 100).toFixed(0)}%), avg loss ${lt.avgLoss.toFixed(0)}%`);
      }

      // Auto-adjust based on loss patterns
      const lowLiqLosses = lossTags.find(t => t.tag.includes('Low liquidity'));
      if (lowLiqLosses && lowLiqLosses.pct >= 0.35) {
        newWeights.liquidityDepth = Math.min(25, newWeights.liquidityDepth + 2);
        changes.push(`Low liquidity losses concentrated (${(lowLiqLosses.pct * 100).toFixed(0)}%) → liquidity weight +2`);
      }

      const quickLosses = lossTags.find(t => t.tag.includes('<1h (quick loss)'));
      if (quickLosses && quickLosses.pct >= 0.35) {
        newWeights.buyPressure = Math.min(20, newWeights.buyPressure + 1);
        newWeights.volumeRatio = Math.min(18, newWeights.volumeRatio + 1);
        changes.push(`Quick losses concentrated (${(quickLosses.pct * 100).toFixed(0)}%) → buy pressure +1, volume ratio +1`);
      }

      const highRugEntry = lossTags.find(t => t.tag.includes('Entry rug risk: high'));
      if (highRugEntry && highRugEntry.pct >= 0.3) {
        newWeights.contractSafety = Math.min(30, newWeights.contractSafety + 2);
        changes.push(`High rug-risk entries causing losses → contract safety +2`);
      }
    }
  }

  if (changes.length === 0) {
    changes.push('No significant adjustments needed. Strategy within expected parameters.');
  }

  return {
    id: batchNumber,
    timestamp: Date.now(),
    batchNumber,
    winRate,
    avgROI,
    changes,
    weightsSnapshot: newWeights,
    commonTraits,
    nextMaxHoldHours,
  };
}

function analyzeCommonTraits(winners: Trade[], losers: Trade[]): CommonTrait[] {
  const traitMap = new Map<string, { winCount: number; loseCount: number; totalROI: number }>();

  const processTradeReasons = (trades: Trade[], isWin: boolean) => {
    for (const trade of trades) {
      for (const reason of trade.entryReasons) {
        const existing = traitMap.get(reason) ?? { winCount: 0, loseCount: 0, totalROI: 0 };
        if (isWin) existing.winCount++;
        else existing.loseCount++;
        existing.totalROI += trade.roi ?? 0;
        traitMap.set(reason, existing);
      }
      for (const tag of trade.narrativeTags) {
        const key = `Narrative: ${tag}`;
        const existing = traitMap.get(key) ?? { winCount: 0, loseCount: 0, totalROI: 0 };
        if (isWin) existing.winCount++;
        else existing.loseCount++;
        existing.totalROI += trade.roi ?? 0;
        traitMap.set(key, existing);
      }
    }
  };

  processTradeReasons(winners, true);
  processTradeReasons(losers, false);

  const total = winners.length + losers.length;
  const traits: CommonTrait[] = [];

  for (const [trait, data] of traitMap.entries()) {
    const traitTotal = data.winCount + data.loseCount;
    const frequency = total > 0 ? traitTotal / total : 0;
    const avgROI = traitTotal > 0 ? data.totalROI / traitTotal : 0;
    const winRate = traitTotal > 0 ? data.winCount / traitTotal : 0;

    traits.push({
      trait,
      frequency,
      avgROI,
      confidence: Math.min(1, winRate * frequency * 2),
    });
  }

  return traits.sort((a, b) => b.confidence - a.confidence).slice(0, 15);
}
