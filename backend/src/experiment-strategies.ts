// ===== Aggressive experiment strategy classifier =====
// Each entry gets one primary tag so simulated trades can be reviewed by bucket.

import type { ExperimentStrategyTag, TokenData } from './types.js';
import { detectNarratives } from './screener.js';

export function assignExperimentStrategy(
  token: TokenData,
  previous?: TokenData | null,
  momentumConfirmed = false,
): ExperimentStrategyTag {
  const liquidityGrowth = previous && previous.liquidityUsd > 0
    ? (token.liquidityUsd - previous.liquidityUsd) / previous.liquidityUsd
    : 0;
  const volumeToLiquidity = token.liquidityUsd > 0 ? token.volume1h / token.liquidityUsd : 0;
  const volumeToMarketCap = token.marketCap > 0 ? token.volume24h / token.marketCap : 0;
  const socialReady = token.socialMentions >= 2;
  const narrativeCount = detectNarratives(token.name, token.symbol).length;

  if (token.smartMoneyBuyers > 0 && token.priceChange1h < 45) {
    return 'smart_money_follow';
  }

  if (liquidityGrowth >= 0.5 && token.priceChange1h < 80) {
    return 'liquidity_surge';
  }

  if (token.priceChange1h <= -10 && token.priceChange5m >= 4 && token.buyToSellRatio1h >= 1.15) {
    return 'dip_reclaim';
  }

  if (volumeToLiquidity >= 1.2 && token.priceChange1h < 35 && token.priceChange1h > -10) {
    return 'volume_absorption';
  }

  if (token.marketCap > 0 && token.marketCap < 1_000_000 && volumeToMarketCap >= 0.45 && token.mcLpRatio < 18) {
    return 'high_turnover_low_mc';
  }

  if (narrativeCount > 0 && token.priceChange1h > 0 && token.priceChange1h < 60) {
    return 'narrative_rotation';
  }

  if (socialReady && token.priceChange1h < 50 && token.volume1h > 0) {
    return 'social_pre_fomo';
  }

  if (momentumConfirmed || (token.priceChange5m > 0 && token.priceChange1h > 0)) {
    return 'momentum_breakout';
  }

  return 'score_momentum';
}

export function getExperimentStrategyLabel(strategy: ExperimentStrategyTag | string): string {
  switch (strategy) {
    case 'liquidity_surge': return 'LP 跃迁';
    case 'volume_absorption': return '放量不涨';
    case 'dip_reclaim': return '假摔反包';
    case 'high_turnover_low_mc': return '低市值高换手';
    case 'smart_money_follow': return '聪明钱先手';
    case 'narrative_rotation': return '叙事轮动';
    case 'social_pre_fomo': return '社交未爆量';
    case 'momentum_breakout': return '动量突破';
    case 'score_momentum': return '综合高分';
    default: return '未知策略';
  }
}
