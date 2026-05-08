// ===== Token Screening Engine =====
// Applies multi-factor analysis to determine if a token is worth trading.
// Integrates all 10 strategies: base screening, momentum, social, creator,
// LP lock, smart money, narrative correlation, time window, honeypot, volume anomaly.

import type {
  TokenData,
  StrategyWeights,
  DexScreenerPair,
  CreatorProfile,
  LPLockInfo,
  AuthorityCheckResult,
  HolderCheckResult,
} from './types.js';
import { getTimeWindowAdjustment } from './time-window.js';
import { getNarrativeCorrelationAdjustment, isNarrativeBlocked } from './narrative.js';
import { getHoneypotScoreAdjustment } from './honeypot.js';
import { getVolumeAnomalyAdjustment } from './volume-anomaly.js';
import { getSocialScoreAdjustment } from './social.js';
import { getCreatorScoreAdjustment } from './creator.js';
import { getLPLockScoreAdjustment } from './lp-lock.js';
import { getSmartMoneyScoreAdjustment } from './smart-money.js';
import { NARRATIVE_PATTERNS, detectNarrativeTags as detectNarrativeTagsShared } from './narrative-patterns.js';
import { getChainTradingRules, getScoreBandValue } from './chain-rules.js';
import { analyzeWithAI, getAIScoreAdjustment, type AIAnalysisResult } from './ai-analyzer.js';

export interface ScreeningResult {
  score: number;
  passed: string[];
  failed: string[];
  eligible: boolean;
  inconclusive?: boolean;
}

/** Supplementary data collected by monitor before screening. */
export interface ScreeningExtras {
  pair?: DexScreenerPair;
  creatorProfile?: CreatorProfile | null;
  lpLockInfo?: LPLockInfo | null;
  smartMoneyBuyers?: number;
  authorities?: AuthorityCheckResult;
  holders?: HolderCheckResult;
  aiAnalysis?: AIAnalysisResult | null;
}

export function screenToken(
  token: TokenData,
  weights: StrategyWeights,
  extras?: ScreeningExtras,
): ScreeningResult {
  const passed: string[] = [];
  const failed: string[] = [];
  let score = 0;
  let inconclusive = false;

  // ============================================================
  // HARD GATES — instant rejection if any trigger
  // ============================================================

  // === Honeypot detection (hard gate) ===
  if (extras?.pair) {
    const hp = getHoneypotScoreAdjustment(extras.pair);
    if (hp.isHoneypot) {
      failed.push(hp.label);
      return { score: 0, passed, failed, eligible: false };
    }
    if (hp.adjustment !== 0) {
      failed.push(hp.label);
      score += hp.adjustment;
    }
  }

  // === Narrative block (hard gate) ===
  const blockedNarrative = isNarrativeBlocked(token.name, token.symbol);
  if (blockedNarrative) {
    const adj = getNarrativeCorrelationAdjustment(token.name, token.symbol);
    failed.push(adj.label);
    return { score: 0, passed, failed, eligible: false };
  }

  // === 1. Contract Safety (hard gate if data available) ===
  if (token.chainId !== 'solana') {
    passed.push('ℹ️ EVM contract authority checks pending; using reduced safety score');
    score += weights.contractSafety * 0.5;
  } else if (extras?.authorities?.inconclusive) {
    failed.push(`⏸️ Authority check inconclusive: ${extras.authorities.reason || 'RPC unavailable'}`);
    inconclusive = true;
  } else if (token.mintAuthorityRevoked !== null) {
    if (token.mintAuthorityRevoked && token.freezeAuthorityRevoked) {
      passed.push('✅ Mint & Freeze authority revoked');
      score += weights.contractSafety;
    } else {
      if (!token.mintAuthorityRevoked) {
        failed.push('❌ Mint Authority NOT revoked - HARD FAIL');
        return { score: 0, passed, failed, eligible: false };
      }
      if (!token.freezeAuthorityRevoked) {
        failed.push('⚠️ Freeze Authority NOT revoked');
        score += weights.contractSafety * 0.3;
      }
    }
  } else {
    failed.push('⏸️ Authority status unavailable');
    inconclusive = true;
  }

  // ============================================================
  // CORE FACTORS
  // ============================================================

  // === 2. Liquidity Depth ===
  if (token.liquidityUsd >= 100_000) {
    passed.push(`✅ Liquidity $${(token.liquidityUsd / 1000).toFixed(0)}K (excellent)`);
    score += weights.liquidityDepth;
  } else if (token.liquidityUsd >= 30_000) {
    passed.push(`⚠️ Liquidity $${(token.liquidityUsd / 1000).toFixed(0)}K (acceptable)`);
    score += weights.liquidityDepth * 0.6;
  } else if (token.liquidityUsd >= 12_000) {
    passed.push(`⚠️ Liquidity $${(token.liquidityUsd / 1000).toFixed(1)}K (low, pump.fun level)`);
    score += weights.liquidityDepth * 0.3;
  } else {
    failed.push(`❌ Liquidity $${(token.liquidityUsd / 1000).toFixed(1)}K < $12K`);
  }

  // === 3. Volume/MC ratio ===
  const volMcPct = token.volumeToMcRatio * 100;
  if (volMcPct >= 10 && volMcPct <= 500) {
    passed.push(`✅ Vol/MC ratio ${volMcPct.toFixed(1)}% (healthy activity)`);
    score += weights.volumeRatio;
  } else if (volMcPct > 500 && volMcPct <= 2000) {
    passed.push(`⚠️ Vol/MC ratio ${volMcPct.toFixed(1)}% (very high, potential hype)`);
    score += weights.volumeRatio * 0.7;
  } else if (volMcPct > 2000) {
    failed.push(`⚠️ Vol/MC ratio ${volMcPct.toFixed(1)}% (extreme, likely wash trading)`);
    score += weights.volumeRatio * 0.3;
  } else if (volMcPct >= 5) {
    passed.push(`⚠️ Vol/MC ratio ${volMcPct.toFixed(1)}% (moderate)`);
    score += weights.volumeRatio * 0.4;
  } else {
    failed.push(`❌ Vol/MC ratio ${volMcPct.toFixed(1)}% (too low)`);
  }

  // === 4. MC/LP ratio ===
  if (token.mcLpRatio < 20) {
    passed.push(`✅ MC/LP ${token.mcLpRatio.toFixed(1)}x (thick order book)`);
    score += weights.mcLpRatio;
  } else if (token.mcLpRatio < 50) {
    passed.push(`⚠️ MC/LP ${token.mcLpRatio.toFixed(1)}x (moderate)`);
    score += weights.mcLpRatio * 0.5;
  } else {
    failed.push(`❌ MC/LP ${token.mcLpRatio.toFixed(1)}x (thin order book, dump risk)`);
  }

  // === 5. Top 10 holder distribution ===
  // Note: Solana top10 includes LP pools, DEX programs, burn addresses
  // So thresholds are more lenient to account for this
  if (token.chainId !== 'solana' && token.top10HolderPct === null) {
    failed.push('ℹ️ EVM holder distribution not available yet');
  } else if (extras?.holders?.inconclusive) {
    failed.push(`⏸️ Holder check inconclusive: ${extras.holders.reason || 'RPC unavailable'} — entry allowed with smaller confidence`);
    score -= 3;
  } else if (token.top10HolderPct !== null) {
    if (token.top10HolderPct < 50) {
      passed.push(`✅ Top 10 hold ${token.top10HolderPct.toFixed(1)}% (well distributed)`);
      score += weights.holderDistribution;
    } else if (token.top10HolderPct < 70) {
      passed.push(`⚠️ Top 10 hold ${token.top10HolderPct.toFixed(1)}% (moderate concentration)`);
      score += weights.holderDistribution * 0.5;
    } else {
      failed.push(`❌ Top 10 hold ${token.top10HolderPct.toFixed(1)}% (high concentration)`);
    }
  } else {
    failed.push('⏸️ Holder data unavailable');
    score -= 3;
  }

  // === 6. Buy pressure ===
  if (token.buyToSellRatio1h > 1.5) {
    passed.push(`✅ Buy pressure ${token.buyToSellRatio1h.toFixed(2)}x (strong buying)`);
    score += weights.buyPressure;
  } else if (token.buyToSellRatio1h > 1.0) {
    passed.push(`⚠️ Buy pressure ${token.buyToSellRatio1h.toFixed(2)}x (mild buying)`);
    score += weights.buyPressure * 0.5;
  } else if (token.buyToSellRatio1h > 0.7) {
    failed.push(`⚠️ Sell pressure ${token.buyToSellRatio1h.toFixed(2)}x`);
  } else {
    failed.push(`❌ Heavy sell pressure ${token.buyToSellRatio1h.toFixed(2)}x`);
  }

  // === 7. Price momentum ===
  const momentum5m = token.priceChange5m;
  const momentum1h = token.priceChange1h;
  if (momentum5m > 0 && momentum1h > 0 && momentum1h < 300) {
    passed.push(`✅ Positive momentum: 5m ${momentum5m.toFixed(1)}%, 1h ${momentum1h.toFixed(1)}%`);
    score += weights.buyPressure * 0.7;
  } else if (momentum5m > 3 && momentum1h > -20 && momentum1h <= 0) {
    // Dip reclaim: 5m bouncing while 1h still negative — early reversal signal
    passed.push(`✅ Dip reclaim: 5m +${momentum5m.toFixed(1)}% while 1h ${momentum1h.toFixed(1)}% (early bounce)`);
    score += weights.buyPressure * 0.6;
  } else if (momentum1h > -5 && momentum1h < 50) {
    passed.push(`⚠️ Neutral momentum: 1h ${momentum1h.toFixed(1)}%`);
    score += weights.buyPressure * 0.3;
  } else if (momentum1h >= 300) {
    failed.push(`⚠️ Overheated: 1h +${momentum1h.toFixed(0)}% (FOMO risk)`);
  } else {
    failed.push(`❌ Negative momentum: 1h ${momentum1h.toFixed(1)}%`);
  }

  if (isTailPump(token)) {
    failed.push(`❌ Anti-FOMO: 5m ${momentum5m.toFixed(1)}% move is too concentrated vs 1h ${momentum1h.toFixed(1)}%`);
    return { score, passed, failed, eligible: false, inconclusive };
  }

  // === 8. Freshness bonus ===
  if (token.pairCreatedAt > 0) {
    const ageHours = (Date.now() - token.pairCreatedAt) / 3_600_000;
    if (ageHours < 2) {
      passed.push(`✅ Very fresh: ${(ageHours * 60).toFixed(0)}m old (maximum alpha)`);
      score += weights.freshness * 1.5;
    } else if (ageHours < 24) {
      passed.push(`✅ Fresh: ${ageHours.toFixed(0)}h old (early opportunity)`);
      score += weights.freshness;
    } else if (ageHours < 72) {
      passed.push(`ℹ️ Age: ${(ageHours / 24).toFixed(1)} days`);
      score += weights.freshness * 0.5;
    }
  }

  // === 9. Narrative bonus (uses shared patterns) ===
  let narrativeScore = 0;
  const matchedNarratives: string[] = [];

  const detectedNarratives = detectNarrativeTagsShared(token.name, token.symbol);
  for (const narrative of detectedNarratives) {
    const bonus = weights.narrativeBonus[narrative] || 0;
    narrativeScore += bonus;
    matchedNarratives.push(narrative);
  }

  if (narrativeScore > 0) {
    passed.push(`✅ Narrative: [${[...new Set(matchedNarratives)].join(', ')}] +${narrativeScore}`);
    score += narrativeScore;
  }

  // ============================================================
  // ADVANCED STRATEGY SIGNALS (10–15)
  // ============================================================

  // === 10. Social signal (Strategy 2) ===
  if (extras?.pair) {
    const social = getSocialScoreAdjustment(extras.pair);
    if (social.adjustment > 0) passed.push(social.label);
    else if (social.adjustment < 0) failed.push(social.label);
    score += social.adjustment;
  }

  // === 11. Creator behavior (Strategy 3) ===
  if (extras?.creatorProfile !== undefined) {
    const creator = getCreatorScoreAdjustment(extras.creatorProfile ?? null);
    if (creator.adjustment > 0) passed.push(creator.label);
    else if (creator.adjustment < 0) failed.push(creator.label);
    else if (creator.label) passed.push(creator.label);
    score += creator.adjustment;

    // Hard fail for blacklisted creators
    if (creator.adjustment <= -50) {
      return { score: 0, passed, failed, eligible: false };
    }
  }

  // === 12. LP lock status (Strategy 4) ===
  if (extras?.lpLockInfo !== undefined) {
    const lp = getLPLockScoreAdjustment(extras.lpLockInfo ?? null);
    if (lp.adjustment > 0) passed.push(lp.label);
    else if (lp.adjustment < 0) failed.push(lp.label);
    score += lp.adjustment;
  }

  // === 13. Smart money (Strategy 5) ===
  if (extras?.smartMoneyBuyers !== undefined) {
    const sm = getSmartMoneyScoreAdjustment(extras.smartMoneyBuyers);
    if (sm.adjustment > 0) passed.push(sm.label);
    else if (sm.label) passed.push(sm.label);
    score += sm.adjustment;
  }

  // === 14. Narrative correlation / sector rotation (Strategy 6) ===
  {
    const nc = getNarrativeCorrelationAdjustment(token.name, token.symbol);
    if (nc.adjustment > 0) passed.push(nc.label);
    else if (nc.adjustment < 0 && nc.label) failed.push(nc.label);
    score += nc.adjustment;
  }

  // === 15. Time window (Strategy 7) ===
  {
    const tw = getTimeWindowAdjustment();
    if (tw.adjustment > 0) passed.push(tw.label);
    else if (tw.adjustment < 0) failed.push(tw.label);
    else if (tw.label) passed.push(tw.label);
    score += tw.adjustment;
  }

  // === 16. Volume anomaly (Additional Strategy 10) ===
  if (extras?.pair) {
    const va = getVolumeAnomalyAdjustment(extras.pair);
    if (va.adjustment < 0) failed.push(va.label);
    score += va.adjustment;
  }

  // === 17. AI-powered semantic analysis (Strategy 17) ===
  if (extras?.aiAnalysis) {
    const ai = getAIScoreAdjustment(extras.aiAnalysis);
    if (ai.adjustment > 0) passed.push(ai.label);
    else if (ai.adjustment < 0) failed.push(ai.label);
    else if (ai.label) passed.push(ai.label);
    score += ai.adjustment;

    // Hard fail: AI flags serial rugger with high confidence
    if (extras.aiAnalysis.devRisk === 'serial_rugger' && extras.aiAnalysis.confidence > 0.7) {
      failed.push(`🤖 AI: Serial rugger detected (${(extras.aiAnalysis.confidence * 100).toFixed(0)}% confidence)`);
      return { score: 0, passed, failed, eligible: false };
    }
    // Hard fail: AI flags fake social with scam patterns
    if (extras.aiAnalysis.flags.includes('SCAM_PATTERN') && extras.aiAnalysis.confidence > 0.6) {
      failed.push(`🤖 AI: Scam pattern detected — ${extras.aiAnalysis.reasoning.slice(0, 100)}`);
      return { score: 0, passed, failed, eligible: false };
    }
  }

  // ============================================================
  // ELIGIBILITY
  // ============================================================
  const rules = getChainTradingRules(token.chainId);
  const minScore = rules.screening.minScore;
  const minLiquidity = rules.screening.minLiquidityUsd;
  const dexMatchesChain = rules.screening.preferredDexes.some(dex => token.dex.toLowerCase().includes(dex));
  if (dexMatchesChain) {
    passed.push(`✅ Preferred ${rules.label} venue: ${token.dex}`);
  }

  if (token.rugRiskScore !== undefined && token.rugRiskScore > rules.screening.maxRugScore) {
    failed.push(`❌ ${rules.label} Rug score ${token.rugRiskScore} > ${rules.screening.maxRugScore}`);
  }

  const eligible =
    score >= minScore &&
    token.liquidityUsd >= minLiquidity &&
    (token.rugRiskScore ?? 0) <= rules.screening.maxRugScore;

  return { score, passed, failed, eligible, inconclusive };
}


function isTailPump(token: TokenData): boolean {
  if (token.priceChange5m < 25 || token.priceChange1h <= 0) return false;
  const fiveMinuteShare = token.priceChange5m / Math.max(token.priceChange1h, 0.01);
  const buyBurst = token.txnsBuys1h >= 20 && token.buyToSellRatio1h > 1.2;
  return fiveMinuteShare >= 0.65 && buyBurst;
}

// Position sizing based on score and available cash
export function getPositionSize(score: number, availableCash: number, chainId: TokenData['chainId'] = 'solana'): number {
  const rules = getChainTradingRules(chainId);
  const maxPosition = availableCash * rules.position.maxCashFraction;
  const scoreFraction = getScoreBandValue(rules.position.scoreFractions, score);
  return Math.min(maxPosition, availableCash * scoreFraction);
}

// TP/SL multipliers based on score
export function getTpSlMultipliers(score: number, chainId: TokenData['chainId'] = 'solana'): { tp: number; sl: number } {
  const rules = getChainTradingRules(chainId);
  return getScoreBandValue(rules.exits.tpSl, score);
}

// Detect narrative tags from token name/symbol (re-export from shared module)
export function detectNarratives(name: string, symbol: string): string[] {
  return detectNarrativeTagsShared(name, symbol);
}
