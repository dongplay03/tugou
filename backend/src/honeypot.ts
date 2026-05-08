// ===== Additional Strategy 9: Anti-Honeypot Detection =====
// Detects honeypot tokens where sells are blocked or heavily taxed.
// Checks buy/sell ratio asymmetry as a proxy for sell restrictions.

import type { DexScreenerPair } from './types.js';

/**
 * Analyze if a token might be a honeypot based on transaction patterns.
 *
 * Honeypot indicators:
 * - Very high buy count but near-zero sells (sells blocked)
 * - Extreme buy/sell ratio (>10x) in a short window
 * - Volume but no price movement (tax eating all value)
 */
export function detectHoneypot(pair: DexScreenerPair): {
  isLikelyHoneypot: boolean;
  confidence: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let honeypotSignals = 0;

  const buys5m = pair.txns?.m5?.buys || 0;
  const sells5m = pair.txns?.m5?.sells || 0;
  const buys1h = pair.txns?.h1?.buys || 0;
  const sells1h = pair.txns?.h1?.sells || 0;
  const buys24h = pair.txns?.h24?.buys || 0;
  const sells24h = pair.txns?.h24?.sells || 0;

  // Check 1: Zero sells in 5 minutes despite buys
  if (buys5m >= 5 && sells5m === 0) {
    honeypotSignals += 2;
    reasons.push(`🍯 0 sells in 5m despite ${buys5m} buys — possible honeypot`);
  }

  // Check 2: Extreme buy/sell ratio in 1 hour
  if (buys1h > 10 && sells1h > 0) {
    const ratio = buys1h / sells1h;
    if (ratio > 10) {
      honeypotSignals += 2;
      reasons.push(`🍯 Extreme buy/sell ratio: ${ratio.toFixed(1)}x in 1h`);
    } else if (ratio > 5) {
      honeypotSignals += 1;
      reasons.push(`⚠️ High buy/sell ratio: ${ratio.toFixed(1)}x in 1h`);
    }
  }

  // Check 3: Many buys, literally zero sells in 1 hour
  if (buys1h >= 20 && sells1h === 0) {
    honeypotSignals += 3;
    reasons.push(`🍯 Zero sells in 1h despite ${buys1h} buys — STRONG honeypot signal`);
  }

  // Check 4: 24h sanity check
  if (buys24h >= 50 && sells24h < 3) {
    honeypotSignals += 2;
    reasons.push(`🍯 Almost no sells in 24h (${sells24h}/${buys24h}) — likely honeypot`);
  }

  // Check 5: Volume exists but price hasn't moved (hidden tax)
  // Only check when liquidity is meaningful to avoid false positives on zero-liquidity tokens
  const priceChange1h = pair.priceChange?.h1 || 0;
  const volume1h = pair.volume?.h1 || 0;
  const liquidity = pair.liquidity?.usd || 0;
  if (liquidity > 100 && volume1h > liquidity * 0.5 && Math.abs(priceChange1h) < 1 && buys1h > 10) {
    honeypotSignals += 1;
    reasons.push('⚠️ High volume but no price impact — possible hidden tax');
  }

  const isLikelyHoneypot = honeypotSignals >= 3;
  const confidence = Math.min(100, honeypotSignals * 20);

  return { isLikelyHoneypot, confidence, reasons };
}

/**
 * Score adjustment for honeypot detection.
 */
export function getHoneypotScoreAdjustment(pair: DexScreenerPair): {
  adjustment: number;
  label: string;
  isHoneypot: boolean;
} {
  const result = detectHoneypot(pair);

  if (result.isLikelyHoneypot) {
    return {
      adjustment: -100,
      label: `🍯 HONEYPOT DETECTED (${result.confidence}% confidence) — HARD FAIL`,
      isHoneypot: true,
    };
  }

  if (result.confidence > 20) {
    return {
      adjustment: -10,
      label: `⚠️ Partial honeypot signals (${result.confidence}% confidence) (-10)`,
      isHoneypot: false,
    };
  }

  return { adjustment: 0, label: '', isHoneypot: false };
}
