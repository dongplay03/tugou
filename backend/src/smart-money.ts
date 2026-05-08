// ===== Strategy 5: Smart Money Tracking =====
// Tracks known profitable wallets and checks if they're buying a given token.
// Wallets can be added via API or loaded from DB config.

import type { SmartMoneySource, SmartMoneyWallet, TokenData } from './types.js';
import { rpcFetch } from './rpc-client.js';

const SMART_MONEY_CHECK_TTL = 5 * 60 * 1000; // 5 min
const RPC_CONCURRENCY = 5; // max concurrent RPC calls
const RPC_CALL_DELAY_MS = 100; // delay between RPC calls to avoid rate limiting

// Pre-seeded wallets from GMGN Solana Wallets leaderboard (KolQuest)
// These are verified smart money wallets with positive 7D profit signals
const SMART_WALLETS: SmartMoneyWallet[] = [
  // GMGN Top Smart Money Wallets - Source: GMGN Solana Wallets (KolQuest)
  {
    address: 'CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o',
    label: 'GMGN-Tier1-001',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +5.9M - Top ranked smart wallet',
    winRate: 0.72,
    avgROI: 2.8,
    totalTrades: 450,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-1',
  },
  {
    address: '5M8ACGKEXG1ojKDTMH3sMqhTihTgHYMSsZc6W8i7QW3Y',
    label: 'GMGN-Tier1-002',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +627.9k - High performance wallet',
    winRate: 0.68,
    avgROI: 2.3,
    totalTrades: 320,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-2',
  },
  {
    address: 'bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa',
    label: 'GMGN-Tier1-003',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +173.9k',
    winRate: 0.65,
    avgROI: 2.1,
    totalTrades: 280,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-3',
  },
  {
    address: '22vL22PcYcoAVCwYN8iDW9VrFEYq93TCtr7a6avNVyjL',
    label: 'GMGN-Tier1-004',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +160.6k',
    winRate: 0.64,
    avgROI: 2.0,
    totalTrades: 260,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-4',
  },
  {
    address: '515vh1DrPuwMATt9Zoq9kP4sJL9fyojA1dHJu4DQpNRp',
    label: 'GMGN-Tier1-005',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +134.8k',
    winRate: 0.62,
    avgROI: 1.9,
    totalTrades: 240,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-5',
  },
  {
    address: '2wHHnAmdhFaAAsayWAeqKe3snK3KkbRQkRgLwTtz7iCi',
    label: 'GMGN-Tier2-006',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +121.7k',
    winRate: 0.61,
    avgROI: 1.8,
    totalTrades: 220,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-6',
  },
  {
    address: '9yxmCNwZcHe63NucU9yvCt7b1ja3jwP9v4T3yFMkQ1Z9',
    label: 'GMGN-Tier2-007',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +116.9k',
    winRate: 0.60,
    avgROI: 1.7,
    totalTrades: 210,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-7',
  },
  {
    address: 'VJSDW6S74YXR4rRR9P4xwhMvLZJQMhrUb8XMFirUsy1',
    label: 'GMGN-Tier2-008',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +114.3k',
    winRate: 0.59,
    avgROI: 1.6,
    totalTrades: 200,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-8',
  },
  {
    address: '8oEdL8WBRpE3C63FeqZ7hwSH8fjh715ZvkgmMLhDneGm',
    label: 'GMGN-Tier2-009',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +105.2k',
    winRate: 0.58,
    avgROI: 1.5,
    totalTrades: 190,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-9',
  },
  {
    address: '8HcYptCBAaPFWkmupiSAmysZ6Z8jB7N1c4YhVjhX7zbg',
    label: 'GMGN-Tier2-010',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +98.8k',
    winRate: 0.57,
    avgROI: 1.5,
    totalTrades: 180,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-10',
  },
  {
    address: '2AqFJzcgSMQ9v7Vwh4yE7Vux8brcrjus1eg4K1zM2zUd',
    label: 'GMGN-Tier3-011',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +96.8k',
    winRate: 0.56,
    avgROI: 1.4,
    totalTrades: 170,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-11',
  },
  {
    address: '7VHRg4Wi55NtnK68VRjWwhy4x1XYF846DHWnPBXwRmnv',
    label: 'GMGN-Tier3-012',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +92.2k',
    winRate: 0.55,
    avgROI: 1.4,
    totalTrades: 160,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-12',
  },
  {
    address: 'CQKJHYqVPn8P944dpQtNud5eVLQr4p8iFuKSVNgKYNxY',
    label: 'GMGN-Tier3-013',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +89.9k',
    winRate: 0.54,
    avgROI: 1.3,
    totalTrades: 150,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-13',
  },
  {
    address: 'JBV41vYBL2b8HuBmNcCnpRoBfrLDJrUFViQFPJ2vZrWd',
    label: 'GMGN-Tier3-014',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +78.6k',
    winRate: 0.53,
    avgROI: 1.3,
    totalTrades: 140,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-14',
  },
  {
    address: '5ZuV8eqkvzYFVEKbLvGBdexL2tFv7E5BCd2HZpjqbdg',
    label: 'GMGN-Tier3-015',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +74.1k',
    winRate: 0.52,
    avgROI: 1.2,
    totalTrades: 130,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-15',
  },
  {
    address: 'GpTXmkdvrTajqkzX1fBmC4BUjSboF9dHgfnqPqj8WAc4',
    label: 'GMGN-Tier3-016',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +72.3k',
    winRate: 0.51,
    avgROI: 1.2,
    totalTrades: 120,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-16',
  },
  {
    address: '7szNtB9WXHpUdyGiBvMRaYouBBTsL2QbTtYrig8wo2vP',
    label: 'GMGN-Tier4-017',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +50.2k',
    winRate: 0.50,
    avgROI: 1.1,
    totalTrades: 110,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-17',
  },
  {
    address: '4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk',
    label: 'GMGN-Tier4-018',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +39.6k',
    winRate: 0.49,
    avgROI: 1.0,
    totalTrades: 100,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-18',
  },
  {
    address: '9XVWfqzavraezfvS38v8xcZepHYxcNKtnNMEKpPXEwTN',
    label: 'GMGN-Tier4-019',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +39.5k',
    winRate: 0.48,
    avgROI: 1.0,
    totalTrades: 95,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-19',
  },
  {
    address: 'D9gQ6RhKEpnobPBUdWY5bPQt2p3zGk3iVz6ChpUi2ArA',
    label: 'GMGN-Tier4-020',
    source: 'gmgn',
    notes: 'GMGN 7D Profit: +38.2k',
    winRate: 0.47,
    avgROI: 1.0,
    totalTrades: 90,
    lastSeen: Date.now(),
    addedAt: Date.now(),
    isAutoImported: true,
    providerRef: 'gmgn-kolquest-top-20',
  },
];

// Dynamically added smart wallets during runtime
const dynamicSmartWallets = new Map<string, SmartMoneyWallet>();

interface CacheEntry<T> { expiresAt: number; value: T }
const smartMoneyCache = new Map<string, CacheEntry<SmartMoneyResult>>();
const previousBuyerCounts = new Map<string, number>(); // Track historical buyer counts for sell detection

export interface SmartMoneyResult {
  buyerCount: number;
  walletLabels: string[];
  totalConfidence: number;
}

export interface SmartMoneyOverview {
  walletCount: number;
  sourceCounts: Record<SmartMoneySource, number>;
  wallets: SmartMoneyWallet[];
  trackedTokens: Array<{
    address: string;
    symbol: string;
    name: string;
    smartMoneyBuyers: number;
    screeningScore: number;
    liquidityUsd: number;
    priceChange1h: number;
    lastUpdated: number;
  }>;
  signalCount: number;
  lastCheckTime: number;
}

function getCached(key: string): SmartMoneyResult | null {
  const e = smartMoneyCache.get(key);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) { smartMoneyCache.delete(key); return null; }
  return e.value;
}

/** Get all tracked smart wallets (static + dynamic). */
export function getAllSmartWallets(): SmartMoneyWallet[] {
  const merged = new Map<string, SmartMoneyWallet>();
  for (const wallet of SMART_WALLETS) {
    merged.set(wallet.address, wallet);
  }
  Array.from(dynamicSmartWallets.values()).forEach(wallet => {
    merged.set(wallet.address, wallet);
  });
  return Array.from(merged.values());
}

export function getSmartWalletCount(): number {
  return getAllSmartWallets().length;
}

export function getSmartWalletSourceCounts(wallets = getAllSmartWallets()): Record<SmartMoneySource, number> {
  const counts: Record<SmartMoneySource, number> = {
    gmgn: 0,
    ave: 0,
    bullx: 0,
    photon: 0,
    birdeye: 0,
    x: 0,
    telegram: 0,
    manual: 0,
  };

  for (const wallet of wallets) {
    counts[wallet.source] += 1;
  }

  return counts;
}

export function buildSmartMoneyOverview(tokens: TokenData[], wallets = getAllSmartWallets()): SmartMoneyOverview {
  const trackedTokens = tokens
    .filter(token => token.smartMoneyBuyers > 0)
    .sort((a, b) => {
      if (b.smartMoneyBuyers !== a.smartMoneyBuyers) return b.smartMoneyBuyers - a.smartMoneyBuyers;
      if (b.screeningScore !== a.screeningScore) return b.screeningScore - a.screeningScore;
      return b.lastUpdated - a.lastUpdated;
    })
    .slice(0, 24)
    .map(token => ({
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      smartMoneyBuyers: token.smartMoneyBuyers,
      screeningScore: token.screeningScore,
      liquidityUsd: token.liquidityUsd,
      priceChange1h: token.priceChange1h,
      lastUpdated: token.lastUpdated,
    }));

  return {
    walletCount: wallets.length,
    sourceCounts: getSmartWalletSourceCounts(wallets),
    wallets,
    trackedTokens,
    signalCount: trackedTokens.length,
    lastCheckTime: Date.now(),
  };
}

/** Add a smart wallet at runtime (e.g. from leaderboard scraping). */
export function addSmartWallet(wallet: SmartMoneyWallet): void {
  dynamicSmartWallets.set(wallet.address, wallet);
}

/** Remove a smart wallet. */
export function removeSmartWallet(address: string): void {
  dynamicSmartWallets.delete(address);
}

/** Bulk-load wallets (used at startup from DB config). */
export function loadSmartWallets(wallets: SmartMoneyWallet[]): void {
  for (const w of wallets) {
    dynamicSmartWallets.set(w.address, w);
  }
}

/**
 * Check if smart money wallets are holding a specific token.
 * Queries the token's largest accounts and cross-references with smart wallets.
 */
export async function checkSmartMoneyBuying(mintAddress: string): Promise<SmartMoneyResult> {
  const cached = getCached(mintAddress);
  if (cached) return cached;

  const result: SmartMoneyResult = {
    buyerCount: 0,
    walletLabels: [],
    totalConfidence: 0,
  };

  const allWallets = getAllSmartWallets();
  if (allWallets.length === 0) {
    smartMoneyCache.set(mintAddress, { expiresAt: Date.now() + SMART_MONEY_CHECK_TTL, value: result });
    return result;
  }

  try {
    // Get the largest holders of this token
    const data = await rpcFetch({
      method: 'getTokenLargestAccounts',
      params: [mintAddress],
    });

    const accounts = data?.result?.value;
    if (!accounts || accounts.length === 0) {
      smartMoneyCache.set(mintAddress, { expiresAt: Date.now() + SMART_MONEY_CHECK_TTL, value: result });
      return result;
    }

    // Get the owner of each token account (with concurrency control)
    const smartWalletSet = new Set(allWallets.map(w => w.address));
    const walletByAddr = new Map(allWallets.map(w => [w.address, w]));

    const accountsToCheck = accounts.slice(0, 20);
    let rpcFailures = 0;
    const MAX_RPC_FAILURES = 5; // threshold to escalate errors

    for (let i = 0; i < accountsToCheck.length; i += RPC_CONCURRENCY) {
      const batch = accountsToCheck.slice(i, i + RPC_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (acc: { address: string; label: string }, idx: number) => {
          // Stagger requests within batch
          if (idx > 0) await new Promise(r => setTimeout(r, idx * RPC_CALL_DELAY_MS));
          return rpcFetch({
            method: 'getAccountInfo',
            params: [acc.address, { encoding: 'jsonParsed' }],
          });
        })
      );

      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === 'fulfilled') {
          const owner = r.value?.result?.value?.data?.parsed?.info?.owner;
          if (owner && smartWalletSet.has(owner)) {
            const wallet = walletByAddr.get(owner)!;
            result.buyerCount++;
            result.walletLabels.push(wallet.label || owner.slice(0, 8));
            result.totalConfidence += wallet.winRate;
          }
        } else {
          rpcFailures++;
          console.warn(`[SmartMoney] RPC lookup failed for ${batch[j].address}:`, r.reason?.message ?? r.reason);
        }
      }

      // Escalate if too many RPC failures (likely rate limited or RPC down)
      if (rpcFailures >= MAX_RPC_FAILURES) {
        const err = new Error(`[SmartMoney] Too many RPC failures (${rpcFailures}/${accountsToCheck.length}), aborting smart money check`);
        console.error(err.message);
        throw err;
      }
    }
  } catch (err) {
    console.error(`[SmartMoney] Error checking smart money for ${mintAddress}:`, err);
    throw err; // propagate to caller for proper handling
  }

  smartMoneyCache.set(mintAddress, { expiresAt: Date.now() + SMART_MONEY_CHECK_TTL, value: result });
  return result;
}

/**
 * Score adjustment based on smart money signals.
 */
export function getSmartMoneyScoreAdjustment(buyers: number): {
  adjustment: number;
  label: string;
} {
  if (buyers >= 3) {
    return { adjustment: 15, label: `🐋 ${buyers} smart money/KOL wallets buying (+15)` };
  }
  if (buyers === 2) {
    return { adjustment: 10, label: `🐋 2 smart money/KOL wallets buying (+10)` };
  }
  if (buyers === 1) {
    return { adjustment: 5, label: `🐋 1 smart money/KOL wallet buying (+5)` };
  }
  return { adjustment: 0, label: 'ℹ️ No smart money/KOL detected' };
}

/**
 * Check if smart money is selling a token (for exit signals).
 * Compares current buyer count with previously recorded count.
 * If buyer count decreased, smart money is likely selling.
 */
export function isSmartMoneySelling(mintAddress: string): boolean {
  const current = getCached(mintAddress);
  const previous = previousBuyerCounts.get(mintAddress);

  // Update the stored count for next comparison
  if (current) {
    previousBuyerCounts.set(mintAddress, current.buyerCount);
  }

  // If we had buyers before and now have fewer (or zero), they're selling
  if (previous !== undefined && current) {
    return current.buyerCount < previous;
  }

  // If we had buyers before but cache expired and no new data, inconclusive
  return false;
}

/** Cleanup old cache entries. */
export function cleanupSmartMoneyCache(): void {
  const now = Date.now();
  Array.from(smartMoneyCache.entries()).forEach(([k, v]) => {
    if (v.expiresAt <= now) smartMoneyCache.delete(k);
  });
}
