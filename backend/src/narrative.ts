// ===== Strategy 6: Sector / Narrative Correlation =====
// Tracks narrative-level performance in real-time.
// If a narrative has 3+ tokens rising simultaneously, lower entry thresholds
// for that narrative. If multiple rugs appear in a narrative, block it.

import type { NarrativeState, TokenData } from './types.js';
import { detectNarrativeTags } from './narrative-patterns.js';

// In-memory narrative tracker
const narrativeStates = new Map<string, NarrativeState>();

// Config
const NARRATIVE_BLOCK_THRESHOLD = 3;     // block narrative after N rugs in window
const NARRATIVE_BLOCKWINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const NARRATIVE_BOOST_MIN_RISING = 3;    // need 3+ rising tokens to boost

// Track rug timestamps per narrative for windowed counting
const narrativeRugTimestamps = new Map<string, number[]>();

/**
 * Get all active narrative states.
 */
export function getNarrativeStates(): NarrativeState[] {
  return [...narrativeStates.values()];
}

export function getActiveNarrativeCount(): number {
  return narrativeStates.size;
}

/**
 * Update narrative tracking with a batch of screened tokens.
 * Called after each discovery cycle.
 */
export function updateNarrativeTracking(tokens: TokenData[]): void {
  // Group tokens by narrative
  const narrativeTokens = new Map<string, TokenData[]>();

  for (const token of tokens) {
    const narratives = detectNarrativeTags(token.name, token.symbol);
    for (const n of narratives) {
      const existing = narrativeTokens.get(n) || [];
      existing.push(token);
      narrativeTokens.set(n, existing);
    }
  }

  // Update each narrative
  for (const [narrative, toks] of narrativeTokens) {
    const rising = toks.filter(t => t.priceChange1h > 5).length;
    const total = toks.length;

    const state = narrativeStates.get(narrative) || {
      narrative,
      activeTokens: 0,
      risingTokens: 0,
      ruggedTokens: 0,
      avgPerformance: 0,
      lastUpdated: 0,
      blocked: false,
    };

    state.activeTokens = total;
    state.risingTokens = rising;
    state.avgPerformance = toks.reduce((s, t) => s + t.priceChange1h, 0) / (total || 1);
    state.lastUpdated = Date.now();

    // Check if should be unblocked (cooldown expired)
    if (state.blocked) {
      const rugTimes = narrativeRugTimestamps.get(narrative) || [];
      const recentRugs = rugTimes.filter(t => Date.now() - t < NARRATIVE_BLOCKWINDOW_MS);
      if (recentRugs.length < NARRATIVE_BLOCK_THRESHOLD) {
        state.blocked = false;
        state.blockReason = undefined;
        console.log(`[Narrative] 🟢 Unblocked narrative: ${narrative} (cooldown expired)`);
      }
    }

    narrativeStates.set(narrative, state);
  }
}

/**
 * Record a rug-pull for a token's narratives.
 * If too many rugs in a narrative window, block it.
 */
export function recordNarrativeRug(token: TokenData): void {
  const narratives = detectNarrativeTags(token.name, token.symbol);

  for (const narrative of narratives) {
    const rugTimes = narrativeRugTimestamps.get(narrative) || [];
    rugTimes.push(Date.now());
    narrativeRugTimestamps.set(narrative, rugTimes);

    // Clean old entries
    const recent = rugTimes.filter(t => Date.now() - t < NARRATIVE_BLOCKWINDOW_MS);
    narrativeRugTimestamps.set(narrative, recent);

    // Check if should block
    if (recent.length >= NARRATIVE_BLOCK_THRESHOLD) {
      const state = narrativeStates.get(narrative) || {
        narrative,
        activeTokens: 0,
        risingTokens: 0,
        ruggedTokens: 0,
        avgPerformance: 0,
        lastUpdated: Date.now(),
        blocked: false,
      };

      state.blocked = true;
      state.ruggedTokens = recent.length;
      state.blockReason = `${recent.length} rugs in ${NARRATIVE_BLOCKWINDOW_MS / 3_600_000}h window`;
      narrativeStates.set(narrative, state);

      console.log(`[Narrative] 🔴 BLOCKED narrative: ${narrative} — ${state.blockReason}`);
    }
  }
}

/**
 * Check if a token's narratives are currently blocked.
 * Returns the blocked narrative name, or null if ok.
 */
export function isNarrativeBlocked(name: string, symbol: string): string | null {
  const narratives = detectNarrativeTags(name, symbol);
  for (const n of narratives) {
    const state = narrativeStates.get(n);
    if (state?.blocked) return n;
  }
  return null;
}

/**
 * Get score adjustment based on narrative momentum.
 * Hot narratives get a bonus; cold ones get nothing.
 */
export function getNarrativeCorrelationAdjustment(name: string, symbol: string): {
  adjustment: number;
  label: string;
} {
  const narratives = detectNarrativeTags(name, symbol);
  let bestAdj = 0;
  let bestLabel = '';

  for (const n of narratives) {
    const state = narrativeStates.get(n);
    if (!state) continue;

    if (state.blocked) {
      return { adjustment: -100, label: `🔴 Narrative "${n}" BLOCKED: ${state.blockReason}` };
    }

    if (state.risingTokens >= NARRATIVE_BOOST_MIN_RISING) {
      const adj = Math.min(10, state.risingTokens * 2);
      if (adj > bestAdj) {
        bestAdj = adj;
        bestLabel = `🔥 Narrative "${n}" is hot: ${state.risingTokens} tokens rising (+${adj})`;
      }
    }
  }

  if (bestAdj > 0) {
    return { adjustment: bestAdj, label: bestLabel };
  }

  return { adjustment: 0, label: '' };
}

export { detectNarrativeTags } from './narrative-patterns.js';
