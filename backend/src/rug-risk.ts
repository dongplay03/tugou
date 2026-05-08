// ===== Unified Rug Risk Scoring =====
// Produces one score for both entry filtering and emergency exit decisions.

import type { DexScreenerPair, RugRiskLevel, RugRiskReport, TokenData, Trade } from './types.js';
import { detectHoneypot } from './honeypot.js';
import { detectLPDrain } from './lp-lock.js';

interface RuntimeRiskInput {
  pair?: DexScreenerPair;
  liquidityAtEntry?: number;
  currentLiquidity?: number;
  priceMultiplier?: number;
  holdTimeMs?: number;
}

export function assessTokenRugRisk(
  token: TokenData,
  pair?: DexScreenerPair,
): RugRiskReport {
  const reasons: string[] = [];
  let score = 0;
  let fatal = false;

  if (token.mintAuthorityRevoked === false) {
    score += 60;
    fatal = true;
    reasons.push('Mint 权限未撤销，可增发，硬性 Rug 风险');
  } else if (token.mintAuthorityRevoked === null) {
    score += 8;
    reasons.push('Mint 权限未知');
  }

  if (token.freezeAuthorityRevoked === false) {
    score += 15;
    reasons.push('Freeze 权限未撤销，可能冻结账户');
  } else if (token.freezeAuthorityRevoked === null) {
    score += 5;
    reasons.push('Freeze 权限未知');
  }

  if (token.lpLocked === false) {
    score += 15;
    reasons.push('LP 未锁仓');
  } else if (token.lpLocked === null) {
    score += 8;
    reasons.push('LP 锁仓状态未知');
  }

  if ((token.lpCreatorPct ?? 0) > 80) {
    score += 40;
    reasons.push(`创建者持有 LP ${token.lpCreatorPct?.toFixed(0)}%`);
  } else if ((token.lpCreatorPct ?? 0) > 50) {
    score += 25;
    reasons.push(`创建者持有 LP ${token.lpCreatorPct?.toFixed(0)}%`);
  }

  if ((token.top10HolderPct ?? 0) > 60) {
    score += 35;
    reasons.push(`Top10 持仓 ${token.top10HolderPct?.toFixed(1)}%，高度集中`);
  } else if ((token.top10HolderPct ?? 0) > 40) {
    score += 20;
    reasons.push(`Top10 持仓 ${token.top10HolderPct?.toFixed(1)}%，集中度偏高`);
  } else if (token.top10HolderPct === null && token.chainId === 'solana') {
    score += 8;
    reasons.push('持仓分布未知');
  }

  if (token.mcLpRatio > 50) {
    score += 20;
    reasons.push(`MC/LP ${token.mcLpRatio.toFixed(1)}x，盘口过薄`);
  } else if (token.mcLpRatio > 30) {
    score += 10;
    reasons.push(`MC/LP ${token.mcLpRatio.toFixed(1)}x，盘口偏薄`);
  }

  if (token.buyToSellRatio1h < 0.7) {
    score += 15;
    reasons.push(`1h 买卖比 ${token.buyToSellRatio1h.toFixed(2)}x，卖压重`);
  }

  if ((token.creatorDevRugRate ?? 0) >= 0.7 && (token.creatorDevLaunchedTokenCount ?? 0) >= 3) {
    score += 45;
    reasons.push(`Pump dev 历史跑路率 ${(token.creatorDevRugRate! * 100).toFixed(0)}% / ${token.creatorDevLaunchedTokenCount} 个币`);
  } else if ((token.creatorDevRugRate ?? 0) >= 0.45 && (token.creatorDevLaunchedTokenCount ?? 0) >= 3) {
    score += 28;
    reasons.push(`Pump dev 历史跑路率 ${(token.creatorDevRugRate! * 100).toFixed(0)}% / ${token.creatorDevLaunchedTokenCount} 个币`);
  }

  if ((token.creatorRugProbability ?? 0) >= 0.75) {
    score += 40;
    reasons.push(`创建者 Rug 概率 ${(token.creatorRugProbability! * 100).toFixed(0)}%`);
  } else if ((token.creatorRugProbability ?? 0) >= 0.55) {
    score += 25;
    reasons.push(`创建者 Rug 概率 ${(token.creatorRugProbability! * 100).toFixed(0)}%`);
  }

  if (token.socialMentions === 0) {
    score += 5;
    reasons.push('缺少可验证社交链接');
  }

  if (token.liquidityUsd < 30_000) {
    score += 10;
    reasons.push(`流动性 ${token.liquidityUsd.toFixed(0)} 美元，缓冲不足`);
  }

  if (pair) {
    const hp = detectHoneypot(pair);
    if (hp.isLikelyHoneypot) {
      score += 80;
      fatal = true;
      reasons.push(...hp.reasons);
    } else if (hp.confidence > 20) {
      score += 20;
      reasons.push(...hp.reasons);
    }
  }

  return buildReport(score, reasons, fatal);
}

export function assessRuntimeRugRisk(
  trade: Trade,
  input: RuntimeRiskInput,
): RugRiskReport {
  const reasons = [...(trade.rugRiskReasons ?? [])];
  let score = Math.max(0, trade.rugRiskScore ?? 0);
  let fatal = false;

  const liquidityAtEntry = input.liquidityAtEntry ?? trade.liquidityAtEntry;
  const currentLiquidity = input.currentLiquidity ?? trade.currentLiquidity;
  if (liquidityAtEntry > 0 && currentLiquidity >= 0) {
    const liquidityDrop = 1 - (currentLiquidity / liquidityAtEntry);
    if (liquidityDrop >= 0.50) {
      score += 100;
      fatal = true;
      reasons.push(`LP 较入场下降 ${(liquidityDrop * 100).toFixed(0)}%`);
    } else if (liquidityDrop >= 0.25) {
      score += 60;
      reasons.push(`LP 较入场下降 ${(liquidityDrop * 100).toFixed(0)}%`);
    } else if (liquidityDrop >= 0.12) {
      score += 35;
      reasons.push(`LP 较入场下降 ${(liquidityDrop * 100).toFixed(0)}%`);
    } else if (liquidityDrop >= 0.08) {
      score += 20;
      reasons.push(`LP 较入场下降 ${(liquidityDrop * 100).toFixed(0)}%`);
    }

    const lpDrain = detectLPDrain(liquidityAtEntry, currentLiquidity, input.holdTimeMs ?? 0);
    if (lpDrain.alert) {
      score += 40;
      reasons.push(lpDrain.label);
    }
  }

  const priceMultiplier = input.priceMultiplier ?? 1;
  if (priceMultiplier <= 0.15) {
    score += 100;
    fatal = true;
    reasons.push(`价格跌至入场 ${priceMultiplier.toFixed(2)}x`);
  } else if (priceMultiplier <= 0.35) {
    score += 45;
    reasons.push(`价格跌至入场 ${priceMultiplier.toFixed(2)}x`);
  }

  if (input.pair) {
    const buys1h = input.pair.txns?.h1?.buys ?? 0;
    const sells1h = input.pair.txns?.h1?.sells ?? 0;
    const buySell = sells1h > 0 ? buys1h / sells1h : buys1h > 0 ? 99 : 0;
    const priceChange5m = input.pair.priceChange?.m5 ?? 0;

    if (buySell < 0.8 && priceChange5m <= -5) {
      score += 30;
      reasons.push(`买卖比反转 ${buySell.toFixed(2)}x，5m ${priceChange5m.toFixed(1)}%`);
    }

    const hp = detectHoneypot(input.pair);
    if (hp.isLikelyHoneypot) {
      score += 80;
      fatal = true;
      reasons.push(...hp.reasons);
    }
  }

  return buildReport(score, reasons, fatal);
}

function buildReport(score: number, reasons: string[], fatal: boolean): RugRiskReport {
  const normalized = Math.min(100, Math.max(0, Math.round(score)));
  const level = getRugRiskLevel(normalized, fatal);
  const uniqueReasons = [...new Set(reasons)].slice(0, 8);

  return {
    score: normalized,
    level,
    reasons: uniqueReasons,
    shouldBlockEntry: fatal || normalized >= 75,
    shouldEmergencyExit: fatal || normalized >= 75,
  };
}

function getRugRiskLevel(score: number, fatal: boolean): RugRiskLevel {
  if (fatal || score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}
