// ===== Smart Money Dynamic Refresh =====
// Scrapes GMGN Solana wallet leaderboard via browser to auto-refresh
// the smart wallet pool. Replaces underperforming wallets automatically.

import type { SmartMoneyWallet, SmartMoneySource } from './types.js';
import { addSmartWallet, removeSmartWallet, getAllSmartWallets } from './smart-money.js';

const GMGN_LEADERBOARD_URL = 'https://gmgn.ai/rank/solana/wallet?period=7d&order_by=profit';
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_DYNAMIC_WALLETS = 20;
const MIN_PROFIT_THRESHOLD_USD = 30_000; // only import wallets with >$30K 7D profit
const MIN_WIN_RATE = 0.45;

let lastRefreshAt = 0;
let refreshInProgress = false;

interface GMGNWalletEntry {
  address: string;
  label: string;
  profit7d: number;
  winRate: number;
  totalTrades: number;
  avgROI: number;
}

/**
 * Check if smart money refresh is due.
 */
export function isSmartMoneyRefreshDue(): boolean {
  return Date.now() - lastRefreshAt > REFRESH_INTERVAL_MS && !refreshInProgress;
}

/**
 * Scrape GMGN leaderboard using the project's Chrome browser.
 * This is designed to be called from the monitor or a cron job.
 * Returns the parsed wallet entries.
 */
export async function scrapeGMGNLeaderboard(): Promise<GMGNWalletEntry[]> {
  // This function uses the fetcher to get GMGN data via HTTP
  // (browser-based scraping is handled by pre-trade-review.ts pattern)
  // For now, we use GMGN's semi-public API endpoints that the frontend calls

  const entries: GMGNWalletEntry[] = [];

  try {
    // GMGN's internal API that their frontend uses
    const url = 'https://gmgn.ai/api/v1/rank/solana/wallets?period=7d&orderby=profit&direction=desc&limit=20';

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://gmgn.ai/rank/solana/wallet',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.warn(`[SmartMoneyRefresh] GMGN API returned ${response.status}`);
      return entries;
    }

    const data = await response.json() as any;
    const wallets = data?.data?.rank || data?.data || [];

    for (const w of wallets) {
      const address = w.address || w.wallet_address;
      const profit = parseFloat(w.profit || w.total_profit || '0');
      const winRate = parseFloat(w.win_rate || w.winrate || '0');
      const trades = parseInt(w.total_trades || w.trades || '0', 10);
      const avgRoi = parseFloat(w.avg_roi || w.avgroi || '0');

      if (!address) continue;
      if (profit < MIN_PROFIT_THRESHOLD_USD) continue;
      if (winRate < MIN_WIN_RATE) continue;

      entries.push({
        address,
        label: `GMGN-Auto-${entries.length + 1}`,
        profit7d: profit,
        winRate,
        totalTrades: trades,
        avgROI: isNaN(avgRoi) ? 0 : avgRoi,
      });
    }
  } catch (err) {
    console.error('[SmartMoneyRefresh] Failed to scrape GMGN:', (err as Error).message);
  }

  return entries;
}

/**
 * Refresh the smart wallet pool.
 * 1. Scrapes GMGN leaderboard
 * 2. Removes wallets with poor recent performance
 * 3. Adds new high-performing wallets
 * 4. Caps dynamic wallet count
 */
export async function refreshSmartMoneyPool(): Promise<{
  added: number;
  removed: number;
  totalWallets: number;
  error?: string;
}> {
  if (refreshInProgress) {
    return { added: 0, removed: 0, totalWallets: getAllSmartWallets().length, error: 'Refresh already in progress' };
  }

  refreshInProgress = true;
  let added = 0;
  let removed = 0;

  try {
    console.log('[SmartMoneyRefresh] 🔄 Starting smart money pool refresh...');

    // 1. Scrape fresh data
    const freshWallets = await scrapeGMGNLeaderboard();
    console.log(`[SmartMoneyRefresh] Scraped ${freshWallets.length} wallets from GMGN`);

    if (freshWallets.length === 0) {
      console.warn('[SmartMoneyRefresh] No wallets scraped, keeping existing pool');
      return { added: 0, removed: 0, totalWallets: getAllSmartWallets().length, error: 'No data from GMGN' };
    }

    // 2. Get current dynamic wallets
    const currentWallets = getAllSmartWallets();
    const dynamicWallets = currentWallets.filter(w => w.isAutoImported);
    const staticWallets = currentWallets.filter(w => !w.isAutoImported);

    // 3. Find stale dynamic wallets (not in fresh top list)
    const freshAddresses = new Set(freshWallets.map(w => w.address));

    for (const wallet of dynamicWallets) {
      if (!freshAddresses.has(wallet.address)) {
        // Wallet no longer in top list — check if it's been there long enough to evaluate
        const ageMs = Date.now() - wallet.refreshedAt!;
        if (ageMs > REFRESH_INTERVAL_MS * 2) { // only remove after 2 refresh cycles
          removeSmartWallet(wallet.address);
          removed++;
          console.log(`[SmartMoneyRefresh] 🗑️ Removed stale wallet: ${wallet.label} (${wallet.address.slice(0, 8)}...)`);
        }
      }
    }

    // 4. Add new high-performing wallets
    const existingAddresses = new Set(getAllSmartWallets().map(w => w.address));

    for (const entry of freshWallets) {
      if (existingAddresses.has(entry.address)) continue;
      if (added + dynamicWallets.length - removed >= MAX_DYNAMIC_WALLETS) break;

      const wallet: SmartMoneyWallet = {
        address: entry.address,
        label: entry.label,
        source: 'gmgn' as SmartMoneySource,
        notes: `GMGN 7D Profit: $${(entry.profit7d / 1000).toFixed(1)}K, WR: ${(entry.winRate * 100).toFixed(0)}%`,
        winRate: entry.winRate,
        avgROI: isNaN(entry.avgROI) ? 1.0 : entry.avgROI,
        totalTrades: entry.totalTrades,
        lastSeen: Date.now(),
        addedAt: Date.now(),
        isAutoImported: true,
        providerRef: 'gmgn-auto-refresh',
        refreshedAt: Date.now(),
      };

      addSmartWallet(wallet);
      existingAddresses.add(entry.address);
      added++;
      console.log(`[SmartMoneyRefresh] ✅ Added: ${wallet.label} (${entry.address.slice(0, 8)}...) — $${(entry.profit7d / 1000).toFixed(1)}K profit`);
    }

    lastRefreshAt = Date.now();
    const totalWallets = getAllSmartWallets().length;
    console.log(`[SmartMoneyRefresh] Done: +${added} added, -${removed} removed, ${totalWallets} total`);

    return { added, removed, totalWallets };
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[SmartMoneyRefresh] Error:', msg);
    return { added: 0, removed: 0, totalWallets: getAllSmartWallets().length, error: msg };
  } finally {
    refreshInProgress = false;
  }
}

/** Get last refresh timestamp. */
export function getLastSmartMoneyRefresh(): number {
  return lastRefreshAt;
}
