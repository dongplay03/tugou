// ===== Strategy 8: Tiered Take-Profit =====
// Instead of "sell half at 2x, then trailing stop", we use multiple exit tiers:
// Tier 1: 2x → sell 50% (recover principal)
// Tier 2: 3x → sell 25%
// Tier 3: 5x → sell 25% (keep 0% or tiny remainder with trailing stop)
// Each partial sell locks in profits progressively.

import type { ChainId, ExitTier, ExperimentStrategyTag } from './types.js';
import { cloneExitTiers, getChainTradingRules, isExperimentalStrategy } from './chain-rules.js';

/**
 * Generate a tiered exit plan based on screening score.
 * Higher-scoring tokens get more aggressive hold targets.
 */
export function buildExitPlan(
  screeningScore: number,
  strategy?: ExperimentStrategyTag,
  chainId: ChainId = 'solana',
): ExitTier[] {
  const rules = getChainTradingRules(chainId);

  if (isExperimentalStrategy(strategy)) {
    return cloneExitTiers(rules.exits.tiered.experimental);
  }

  if (strategy === 'momentum_breakout' && screeningScore < 85) {
    return cloneExitTiers(rules.exits.tiered.momentum);
  }

  if (screeningScore >= 85) {
    return cloneExitTiers(rules.exits.tiered.high);
  }

  if (screeningScore >= 70) {
    return cloneExitTiers(rules.exits.tiered.midHigh);
  }

  if (screeningScore >= 55) {
    return cloneExitTiers(rules.exits.tiered.mid);
  }

  return cloneExitTiers(rules.exits.tiered.low);
}

/**
 * Check if any tiers should execute given the current price multiplier.
 * Returns the list of tiers to execute now (may be multiple if price jumped).
 */
export function checkTieredExits(
  tiers: ExitTier[],
  priceMultiplier: number,
): ExitTier[] {
  const toExecute: ExitTier[] = [];

  for (const tier of tiers) {
    if (!tier.executed && priceMultiplier >= tier.multiplier) {
      toExecute.push(tier);
    }
  }

  return toExecute;
}

/**
 * Execute a set of tiers and return the total SOL to recover.
 * @param tiers - tiers being executed
 * @param currentAmountSOL - current position size in SOL equivalent at original price
 * @param priceMultiplier - current price / entry price
 * @returns SOL to add back to cash, and the remaining position reduction factor
 */
export function executeTiers(
  tiers: ExitTier[],
  currentAmountSOL: number,
  priceMultiplier: number,
): { solToRecover: number; remainingFraction: number } {
  let totalSellPct = 0;

  for (const tier of tiers) {
    tier.executed = true;
    tier.executedAt = Date.now();
    tier.executedPrice = priceMultiplier;
    totalSellPct += tier.sellPct;
  }

  // Cap at 100% (shouldn't happen with proper configuration)
  totalSellPct = Math.min(1.0, totalSellPct);

  // SOL recovered = (position value at current multiplier) * sell percentage
  const currentValue = currentAmountSOL * priceMultiplier;
  const solToRecover = currentValue * totalSellPct;

  return {
    solToRecover,
    remainingFraction: 1 - totalSellPct,
  };
}

/**
 * Calculate total sell percentage already executed.
 */
export function getExecutedSellPct(tiers: ExitTier[]): number {
  return tiers
    .filter(t => t.executed)
    .reduce((sum, t) => sum + t.sellPct, 0);
}

/**
 * Check if all tiers have been executed.
 */
export function allTiersExecuted(tiers: ExitTier[]): boolean {
  return tiers.every(t => t.executed);
}
