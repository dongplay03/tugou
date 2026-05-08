// ===== Strategy 7: Trading Time Window + Real-Time Activity =====
// Memecoin activity correlates with US/EU market hours AND on-chain activity.
// Uses both static time windows AND real-time DexScreener global volume
// to determine optimal trading conditions.

/**
 * Trading windows (in UTC hours).
 * Peak: UTC 14:00–22:00 (US market hours, EU afternoon)
 * Medium: UTC 06:00–14:00 (EU morning, Asia evening)
 * Off-peak: UTC 22:00–06:00 (Asian deep night, low liquidity)
 */
export type TradingWindow = 'peak' | 'medium' | 'off-peak';

// Real-time activity tracking (updated by monitor with DexScreener data)
interface ActivitySnapshot {
  timestamp: number;
  /** Total 1h volume across all tracked pairs (USD) */
  totalVolume1h: number;
  /** Number of pairs with >0 volume in 1h */
  activePairCount: number;
  /** Average buy/sell ratio across tracked pairs */
  avgBuyRatio: number;
}

let latestActivity: ActivitySnapshot | null = null;
const ACTIVITY_TTL_MS = 5 * 60 * 1000; // 5 min

/** Feed real-time activity data from discovery cycle. */
export function updateActivitySnapshot(data: {
  totalVolume1h: number;
  activePairCount: number;
  avgBuyRatio: number;
}): void {
  latestActivity = {
    timestamp: Date.now(),
    totalVolume1h: data.totalVolume1h,
    activePairCount: data.activePairCount,
    avgBuyRatio: data.avgBuyRatio,
  };
}

/** Get the real-time activity level: 'hot' | 'warm' | 'cold' */
export function getRealTimeActivityLevel(): 'hot' | 'warm' | 'cold' {
  if (!latestActivity || Date.now() - latestActivity.timestamp > ACTIVITY_TTL_MS) {
    return 'cold'; // no data = conservative
  }

  const { totalVolume1h, activePairCount, avgBuyRatio } = latestActivity;

  // Hot: high volume + many active pairs + buying pressure
  if (totalVolume1h > 5_000_000 && activePairCount > 30 && avgBuyRatio > 1.2) {
    return 'hot';
  }

  // Warm: moderate activity
  if (totalVolume1h > 1_000_000 && activePairCount > 10 && avgBuyRatio > 0.9) {
    return 'warm';
  }

  return 'cold';
}

/**
 * Determine the current trading window (time-based).
 */
export function getCurrentTradingWindow(): TradingWindow {
  const utcHour = new Date().getUTCHours();

  if (utcHour >= 14 && utcHour < 22) return 'peak';
  if (utcHour >= 6 && utcHour < 14) return 'medium';
  return 'off-peak';
}

/**
 * Check if we should allow new entries now.
 * Uses BOTH time window AND real-time activity.
 * Off-peak but hot on-chain → still allow (reduced penalty).
 * Peak but cold on-chain → be cautious.
 */
export function isTradingWindowActive(): boolean {
  const timeWindow = getCurrentTradingWindow();
  const activity = getRealTimeActivityLevel();

  // Off-peak + hot activity → allow (rare but happens during meme season)
  if (timeWindow === 'off-peak' && activity === 'hot') return true;
  // Peak + cold → cautious but still active
  if (timeWindow === 'peak' && activity === 'cold') return true;
  // Normal logic
  return timeWindow !== 'off-peak';
}

/**
 * Get the screening threshold multiplier based on current time AND activity.
 * Blends both signals for more accurate adjustment.
 */
export function getTimeWindowThresholdMultiplier(): number {
  const timeWindow = getCurrentTradingWindow();
  const activity = getRealTimeActivityLevel();

  // Base multiplier from time
  const timeMultiplier = (() => {
    switch (timeWindow) {
      case 'peak': return 1.0;
      case 'medium': return 1.15;
      case 'off-peak': return 1.4;
    }
  })();

  // Activity adjustment (can reduce or increase the multiplier)
  const activityAdj = (() => {
    switch (activity) {
      case 'hot': return -0.15; // lower threshold (more permissive)
      case 'warm': return 0;
      case 'cold': return 0.2;  // raise threshold (more strict)
    }
  })();

  return Math.max(0.8, timeMultiplier + activityAdj);
}

/**
 * Get score adjustment and label for current time window + activity.
 */
export function getTimeWindowAdjustment(): {
  adjustment: number;
  label: string;
  window: TradingWindow;
} {
  const window = getCurrentTradingWindow();
  const activity = getRealTimeActivityLevel();

  let adjustment = 0;
  let label = '';

  // Base time adjustment
  switch (window) {
    case 'peak':
      adjustment = 5;
      label = '✅ Peak trading hours (UTC 14-22)';
      break;
    case 'medium':
      adjustment = 0;
      label = 'ℹ️ Medium activity hours (UTC 06-14)';
      break;
    case 'off-peak':
      adjustment = -8;
      label = '⚠️ Off-peak hours (UTC 22-06)';
      break;
  }

  // Activity overlay
  switch (activity) {
    case 'hot':
      adjustment += 4;
      label += ' + 🔥 Hot on-chain activity (+4)';
      break;
    case 'warm':
      label += ' + 🟢 Normal activity';
      break;
    case 'cold':
      adjustment -= 3;
      label += ' + 🥶 Cold on-chain activity (-3)';
      break;
  }

  return { adjustment, label, window };
}

/**
 * Get the maximum number of allowed open positions based on time + activity.
 */
export function getMaxPositions(): number {
  const timeWindow = getCurrentTradingWindow();
  const activity = getRealTimeActivityLevel();

  const base = (() => {
    switch (timeWindow) {
      case 'peak': return 5;
      case 'medium': return 4;
      case 'off-peak': return 2;
    }
  })();

  // Hot activity can add 1 extra slot
  if (activity === 'hot') return base + 1;
  // Cold activity reduces by 1
  if (activity === 'cold') return Math.max(1, base - 1);
  return base;
}

/**
 * Get position size multiplier based on time window + activity.
 */
export function getPositionSizeMultiplier(): number {
  const timeWindow = getCurrentTradingWindow();
  const activity = getRealTimeActivityLevel();

  const base = (() => {
    switch (timeWindow) {
      case 'peak': return 1.0;
      case 'medium': return 0.85;
      case 'off-peak': return 0.6;
    }
  })();

  if (activity === 'hot') return Math.min(1.1, base + 0.1);
  if (activity === 'cold') return base * 0.8;
  return base;
}

/** Get activity snapshot for status display. */
export function getActivitySnapshot(): ActivitySnapshot | null {
  return latestActivity;
}
