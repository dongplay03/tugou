// ===== Strategy 1: Momentum Watchpool =====
// Tokens don't get traded immediately — they enter a watch pool and must
// show consecutive price increases + rising volume before confirmation.
//
// Flow: discover → watchpool → 3 consecutive up ticks + volume up → confirm entry
//                            → any downtick → reject

import type { WatchPoolEntry, MomentumObservation, DexScreenerPair } from './types.js';

const REQUIRED_UP_TICKS = 2; // relaxed from 3 — allow 2-of-3 pattern
const LOOKBACK_WINDOW = 4; // check last 4 observations instead of exactly 3 (allows 1 dip in window)
const MAX_OBSERVATIONS = 10; // slightly more room for confirmation (≈ 200s)
const OBSERVATION_INTERVAL_MS = 20_000; // aligned with price monitor cycle
const SMALL_PULLBACK_TOLERANCE = 0.03; // relaxed from 2.5% — Solana microstructure often dips 3%
const HARD_DRAWDOWN_REJECT_PCT = 0.05; // slightly wider hard reject (was 4%)
const LIQUIDITY_DRAIN_REJECT_PCT = 0.15;

// In-memory watch pool
const watchPool = new Map<string, WatchPoolEntry>();

export function getWatchPoolSize(): number {
  return watchPool.size;
}

export function getWatchPool(): WatchPoolEntry[] {
  return Array.from(watchPool.values());
}

/** Add a token to the watch pool for momentum confirmation. */
export function addToWatchPool(address: string, symbol: string, pairAddress: string): void {
  if (watchPool.has(address)) return;

  watchPool.set(address, {
    address,
    symbol,
    pairAddress,
    observations: [],
    addedAt: Date.now(),
    status: 'watching',
  });

  console.log(`[Momentum] 👁️ Added ${symbol} to watch pool (pool size: ${watchPool.size})`);
}

/** Returns true if token is currently in the watch pool. */
export function isInWatchPool(address: string): boolean {
  return watchPool.has(address);
}

/** Returns true if token has already been confirmed (ready for entry). */
export function isConfirmed(address: string): boolean {
  const entry = watchPool.get(address);
  return entry?.status === 'confirmed';
}

/** Mark a confirmed token as consumed (so it doesn't get re-entered). */
export function consumeConfirmed(address: string): void {
  watchPool.delete(address);
}

/** Get all confirmed tokens that are ready for entry. */
export function getConfirmedTokens(): WatchPoolEntry[] {
  return Array.from(watchPool.values()).filter(e => e.status === 'confirmed');
}

/**
 * Feed new price data for tokens in the watch pool.
 * Call this each monitoring cycle with the latest DexScreener pair data.
 * Returns list of token addresses that just got confirmed.
 */
export function updateWatchPool(priceMap: Map<string, DexScreenerPair>): string[] {
  const newlyConfirmed: string[] = [];
  const toDelete: string[] = [];

  for (const [address, entry] of Array.from(watchPool)) {
    if (entry.status !== 'watching') continue;

    const pair = priceMap.get(address);
    if (!pair) continue;

    const priceUsd = parseFloat(pair.priceUsd || '0');
    const priceNative = parseFloat(pair.priceNative || '0');
    if (priceUsd <= 0) continue;

    const obs: MomentumObservation = {
      timestamp: Date.now(),
      priceUsd,
      priceNative,
      volume1h: pair.volume?.h1 || 0,
      buys1h: pair.txns?.h1?.buys || 0,
      sells1h: pair.txns?.h1?.sells || 0,
      liquidity: pair.liquidity?.usd || 0,
    };

    entry.observations.push(obs);

    // Need at least 2 observations to compare
    if (entry.observations.length < 2) continue;

    // Too many observations without confirmation → reject
    if (entry.observations.length > MAX_OBSERVATIONS) {
      entry.status = 'rejected';
      console.log(`[Momentum] ❌ ${entry.symbol} rejected: max observations exceeded`);
      toDelete.push(address);
      continue;
    }

    // Check momentum using flexible window: need REQUIRED_UP_TICKS positive
    // in the last LOOKBACK_WINDOW observations (allows 1 dip in window)
    const recent = entry.observations.slice(-LOOKBACK_WINDOW);
    if (recent.length < REQUIRED_UP_TICKS) continue; // not enough data yet

    let positiveStructureTicks = 0;
    let volumeRising = true;
    let consecutiveDownTicks = 0;
    let rejected = false;
    let dipCount = 0; // track how many dips in the window

    for (let i = 1; i < recent.length; i++) {
      const prev = recent[i - 1];
      const curr = recent[i];
      const priceChange = prev.priceNative > 0 ? (curr.priceNative - prev.priceNative) / prev.priceNative : 0;
      const liquidityDrop = prev.liquidity > 0 ? 1 - (curr.liquidity / prev.liquidity) : 0;
      const sellPressure = curr.sells1h > curr.buys1h * 1.25 && curr.sells1h > prev.sells1h * 1.2;

      if (priceChange <= -HARD_DRAWDOWN_REJECT_PCT) {
        entry.status = 'rejected';
        console.log(`[Momentum] ❌ ${entry.symbol} rejected: hard drawdown ${(priceChange * 100).toFixed(1)}% at observation #${entry.observations.length}`);
        toDelete.push(address);
        rejected = true;
        break;
      }

      if (liquidityDrop >= LIQUIDITY_DRAIN_REJECT_PCT) {
        entry.status = 'rejected';
        console.log(`[Momentum] ❌ ${entry.symbol} rejected: liquidity drained ${(liquidityDrop * 100).toFixed(1)}% at observation #${entry.observations.length}`);
        toDelete.push(address);
        rejected = true;
        break;
      }

      if (priceChange < -SMALL_PULLBACK_TOLERANCE) {
        consecutiveDownTicks++;
        dipCount++;
      } else if (priceChange > 0) {
        // Only count as positive if price actually went up
        consecutiveDownTicks = 0;
        positiveStructureTicks++;
      }
      // priceChange between -tolerance and 0 is flat/neutral — not counted as dip or positive

      // Reject on 2+ consecutive down ticks OR heavy sell pressure
      if (consecutiveDownTicks >= 2 || sellPressure) {
        entry.status = 'rejected';
        console.log(`[Momentum] ❌ ${entry.symbol} rejected: weakening structure at observation #${entry.observations.length}`);
        toDelete.push(address);
        rejected = true;
        break;
      }

      // Check buy activity is non-decreasing enough (allow small dips)
      if (curr.buys1h < prev.buys1h * 0.8) {
        volumeRising = false;
      }
    }

    if (rejected || entry.status === 'rejected') continue;

    // Confirm if we have enough positive structure ticks with resilient buy activity
    // Relaxed: allow 1 dip in window (dipCount <= 1), was strict 3-of-3
    if (positiveStructureTicks >= REQUIRED_UP_TICKS && dipCount <= 1 && volumeRising) {
      entry.status = 'confirmed';
      newlyConfirmed.push(address);
      console.log(`[Momentum] ✅ ${entry.symbol} CONFIRMED: ${positiveStructureTicks} positive ticks (dips: ${dipCount}) with resilient buy activity`);
    }
  }

  // Safe deletion after iteration
  for (const address of toDelete) {
    watchPool.delete(address);
  }

  return newlyConfirmed;
}

/** Clean up stale entries (called periodically). */
export function cleanupWatchPool(): void {
  const maxAge = MAX_OBSERVATIONS * OBSERVATION_INTERVAL_MS * 2;
  const now = Date.now();

  Array.from(watchPool.entries()).forEach(([address, entry]) => {
    if (now - entry.addedAt > maxAge) {
      watchPool.delete(address);
    }
  });
}
