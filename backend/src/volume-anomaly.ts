// ===== Additional Strategy 10: Volume Anomaly Detection =====
// Detects suspicious volume patterns that indicate wash trading
// or artificial pump-and-dump schemes.

import type { DexScreenerPair } from './types.js';

/**
 * Detect volume anomalies that suggest artificial manipulation.
 *
 * Anomaly indicators:
 * - 5m volume > 1h volume (impossible organically, means spike just happened or data error)
 * - Volume concentrated in tiny window (5m vol > 50% of 1h vol)
 * - Extremely even buy/sell counts (wash trading signature)
 * - Volume/liquidity ratio too extreme
 */
export function detectVolumeAnomaly(pair: DexScreenerPair): {
  isAnomaly: boolean;
  washTradingLikely: boolean;
  pumpAndDump: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  let anomalySignals = 0;
  let washSignals = 0;
  let pumpSignals = 0;

  const vol5m = pair.volume?.m5 || 0;
  const vol1h = pair.volume?.h1 || 0;
  const vol6h = pair.volume?.h6 || 0;
  const vol24h = pair.volume?.h24 || 0;
  const liquidity = pair.liquidity?.usd || 0;
  const buys1h = pair.txns?.h1?.buys || 0;
  const sells1h = pair.txns?.h1?.sells || 0;

  // Check 1: 5m volume spike (>50% of 1h volume)
  if (vol1h > 0 && vol5m > vol1h * 0.5) {
    pumpSignals++;
    reasons.push(`⚠️ 5m vol (${fmt(vol5m)}) > 50% of 1h vol (${fmt(vol1h)}) — sudden spike`);
  }

  // Check 2: Volume much higher than liquidity (multiple times over)
  if (liquidity > 0 && vol1h > liquidity * 5) {
    anomalySignals++;
    reasons.push(`⚠️ 1h vol/liq ratio: ${(vol1h / liquidity).toFixed(1)}x — unusually high`);
  }

  // Check 3: Wash trading — buy and sell counts suspiciously equal
  if (buys1h > 10 && sells1h > 10) {
    const ratio = Math.min(buys1h, sells1h) / Math.max(buys1h, sells1h);
    if (ratio > 0.9) {
      washSignals++;
      reasons.push(`🔄 Buy/sell count nearly equal (${buys1h}/${sells1h}) — wash trading signal`);
    }
  }

  // Check 4: Massive 24h volume but tiny current volume (pump already ended)
  if (vol24h > 0 && vol1h > 0 && vol24h / vol1h > 30) {
    pumpSignals++;
    reasons.push('⚠️ 24h vol >> 1h vol — volume collapsed, pump may be over');
  }

  // Check 5: Very low txn count but high volume (large single trades)
  const totalTxns1h = buys1h + sells1h;
  if (totalTxns1h > 0 && totalTxns1h < 5 && vol1h > 10000) {
    anomalySignals++;
    reasons.push(`⚠️ Only ${totalTxns1h} txns but ${fmt(vol1h)} volume — whale manipulation risk`);
  }

  return {
    isAnomaly: anomalySignals >= 2 || pumpSignals >= 2,
    washTradingLikely: washSignals >= 1,
    pumpAndDump: pumpSignals >= 2,
    reasons,
  };
}

/**
 * Score adjustment for volume anomalies.
 */
export function getVolumeAnomalyAdjustment(pair: DexScreenerPair): {
  adjustment: number;
  label: string;
} {
  const result = detectVolumeAnomaly(pair);

  if (result.washTradingLikely) {
    return { adjustment: -12, label: '🔄 Wash trading detected (-12)' };
  }

  if (result.pumpAndDump) {
    return { adjustment: -15, label: '📈📉 Pump & dump pattern detected (-15)' };
  }

  if (result.isAnomaly) {
    return { adjustment: -8, label: '⚠️ Volume anomaly detected (-8)' };
  }

  return { adjustment: 0, label: '' };
}

function fmt(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
