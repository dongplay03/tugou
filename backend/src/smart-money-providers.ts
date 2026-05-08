import * as db from './database.js';
import type { SmartMoneyProviderRun, SmartMoneySource, SmartMoneyWallet } from './types.js';

type ProviderSummary = {
  source: SmartMoneySource;
  label: string;
  mode: 'api' | 'search-only' | 'manual';
  enabled: boolean;
  autoRefresh: boolean;
  note: string;
  docsUrl?: string;
};

const PROVIDERS: ProviderSummary[] = [
  {
    source: 'gmgn',
    label: 'GMGN',
    mode: 'search-only',
    enabled: true,
    autoRefresh: true,
    note: '使用内置 GMGN Solana 聪明钱包池；不直接请求不稳定公开 API，网页/搜索用于人工校验和扩容。',
    docsUrl: 'https://docs.gmgn.ai/index/wallet-detail-page',
  },
  {
    source: 'ave',
    label: 'AVE',
    mode: 'search-only',
    enabled: true,
    autoRefresh: true,
    note: '使用内置 AVE Solana 聪明钱包/Top holder 观察池；API 不通时通过 Chrome/搜索补充验证。',
    docsUrl: 'https://docs.ave.ai/reference/api-reference/v2',
  },
  {
    source: 'birdeye',
    label: 'Birdeye',
    mode: 'api',
    enabled: Boolean(process.env.BIRDEYE_API_KEY),
    autoRefresh: Boolean(process.env.BIRDEYE_API_KEY),
    note: process.env.BIRDEYE_API_KEY
      ? 'Birdeye 开发者 API 已启用，可自动刷新 Top 钱包。'
      : '缺少 BIRDEYE_API_KEY，当前只能使用手动搜索和导入。',
    docsUrl: 'https://docs.birdeye.so/reference/get-trader-gainers-losers',
  },
  {
    source: 'x',
    label: 'X / Twitter',
    mode: 'api',
    enabled: Boolean(process.env.X_BEARER_TOKEN),
    autoRefresh: Boolean(process.env.X_BEARER_TOKEN),
    note: process.env.X_BEARER_TOKEN
      ? 'X Recent Search API 已启用，将从公开 smart-wallet feed 抽取地址。'
      : '缺少 X_BEARER_TOKEN，当前只能使用搜索入口和手动导入。',
    docsUrl: 'https://docs.x.com/x-api/posts/search/introduction',
  },
  {
    source: 'bullx',
    label: 'BullX',
    mode: 'search-only',
    enabled: false,
    autoRefresh: false,
    note: '未找到稳定官方开发接口，暂保留搜索入口和手动导入。',
  },
  {
    source: 'photon',
    label: 'Photon',
    mode: 'search-only',
    enabled: false,
    autoRefresh: false,
    note: '未找到稳定官方开发接口，暂保留搜索入口和手动导入。',
  },
  {
    source: 'telegram',
    label: 'Telegram / Discord',
    mode: 'manual',
    enabled: false,
    autoRefresh: false,
    note: '社群来源无法统一抓取，适合人工筛选后批量导入。',
  },
];

const SOLANA_WALLET_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const DAY_MS = 24 * 60 * 60 * 1000;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function getNow() {
  return Date.now();
}

function getProviderSummary(source: SmartMoneySource): ProviderSummary {
  return PROVIDERS.find(provider => provider.source === source) ?? {
    source,
    label: source,
    mode: 'manual',
    enabled: false,
    autoRefresh: false,
    note: 'Unsupported provider',
  };
}

function dedupeWallets(wallets: SmartMoneyWallet[]): SmartMoneyWallet[] {
  const seen = new Set<string>();
  const deduped: SmartMoneyWallet[] = [];

  for (const wallet of wallets) {
    if (seen.has(wallet.address)) continue;
    seen.add(wallet.address);
    deduped.push(wallet);
  }

  return deduped.slice(0, 50);
}

const seededAt = Date.parse('2026-04-06T10:00:00+08:00');
const BUILTIN_SMART_MONEY_POOLS: Record<'gmgn' | 'ave', SmartMoneyWallet[]> = {
  gmgn: [
    ['CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o', 'GMGN Smart Money #1', '+5.9M 7D profit; top ranked smart wallet', 0.72, 2.8, 450],
    ['5M8ACGKEXG1ojKDTMH3sMqhTihTgHYMSsZc6W8i7QW3Y', 'GMGN Smart Money #2', '+627.9k 7D profit', 0.68, 2.3, 320],
    ['bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa', 'GMGN Smart Money #3', '+173.9k 7D profit', 0.65, 2.1, 280],
    ['22vL22PcYcoAVCwYN8iDW9VrFEYq93TCtr7a6avNVyjL', 'GMGN Smart Money #4', '+160.6k 7D profit', 0.64, 2.0, 260],
    ['515vh1DrPuwMATt9Zoq9kP4sJL9fyojA1dHJu4DQpNRp', 'GMGN Smart Money #5', '+134.8k 7D profit', 0.62, 1.9, 240],
    ['2wHHnAmdhFaAAsayWAeqKe3snK3KkbRQkRgLwTtz7iCi', 'GMGN Smart Money #6', '+121.7k 7D profit', 0.61, 1.8, 220],
    ['9yxmCNwZcHe63NucU9yvCt7b1ja3jwP9v4T3yFMkQ1Z9', 'GMGN Smart Money #7', '+116.9k 7D profit', 0.60, 1.7, 210],
    ['VJSDW6S74YXR4rRR9P4xwhMvLZJQMhrUb8XMFirUsy1', 'GMGN Smart Money #8', '+114.3k 7D profit', 0.59, 1.6, 200],
    ['8oEdL8WBRpE3C63FeqZ7hwSH8fjh715ZvkgmMLhDneGm', 'GMGN Smart Money #9', '+105.2k 7D profit', 0.58, 1.5, 190],
    ['8HcYptCBAaPFWkmupiSAmysZ6Z8jB7N1c4YhVjhX7zbg', 'GMGN Smart Money #10', '+98.8k 7D profit', 0.57, 1.5, 180],
    ['2AqFJzcgSMQ9v7Vwh4yE7Vux8brcrjus1eg4K1zM2zUd', 'GMGN Smart Money #11', '+96.8k 7D profit', 0.56, 1.4, 170],
    ['7VHRg4Wi55NtnK68VRjWwhy4x1XYF846DHWnPBXwRmnv', 'GMGN Smart Money #12', '+92.2k 7D profit', 0.55, 1.4, 160],
    ['CQKJHYqVPn8P944dpQtNud5eVLQr4p8iFuKSVNgKYNxY', 'GMGN Smart Money #13', '+89.9k 7D profit', 0.54, 1.3, 150],
    ['JBV41vYBL2b8HuBmNcCnpRoBfrLDJrUFViQFPJ2vZrWd', 'GMGN Smart Money #14', '+78.6k 7D profit', 0.53, 1.3, 140],
    ['5ZuV8eqkvzYFVEKbLvGBdexL2tFv7E5BCd2HZpjqbdg', 'GMGN Smart Money #15', '+74.1k 7D profit', 0.52, 1.2, 130],
    ['GpTXmkdvrTajqkzX1fBmC4BUjSboF9dHgfnqPqj8WAc4', 'GMGN Smart Money #16', '+72.3k 7D profit', 0.51, 1.2, 120],
    ['7szNtB9WXHpUdyGiBvMRaYouBBTsL2QbTtYrig8wo2vP', 'GMGN Smart Money #17', '+50.2k 7D profit', 0.50, 1.1, 110],
    ['4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk', 'GMGN Smart Money #18', '+39.6k 7D profit', 0.49, 1.0, 100],
    ['9XVWfqzavraezfvS38v8xcZepHYxcNKtnNMEKpPXEwTN', 'GMGN Smart Money #19', '+39.5k 7D profit', 0.48, 1.0, 95],
    ['D9gQ6RhKEpnobPBUdWY5bPQt2p3zGk3iVz6ChpUi2ArA', 'GMGN Smart Money #20', '+38.2k 7D profit', 0.47, 1.0, 90],
    ['2pJGF9p7kpzb6eU326EFZf2cDnimbTFVeJtx1qtB', 'GMGN Trend Candidate #21', 'GMGN trend candidate placeholder; use Chrome GMGN wallet page to verify before weighting', 0, 0, 0],
    ['NJAEqN76R7PwPfHt3oWb8R6cKvhgyxQdDn53jFrK6wF', 'GMGN Trend Candidate #22', 'GMGN trend candidate placeholder; use Chrome GMGN wallet page to verify before weighting', 0, 0, 0],
    ['RJWhvQBQPEjJmki5fhBboGBWRJhmcFkMvrr4Fu3t', 'GMGN Trend Candidate #23', 'GMGN trend candidate placeholder; use Chrome GMGN wallet page to verify before weighting', 0, 0, 0],
    ['SJ5EdynMEiYSyiWAH9GpcbHpeUzeSQF9ZY6q4x8AhB', 'GMGN Trend Candidate #24', 'GMGN trend candidate placeholder; use Chrome GMGN wallet page to verify before weighting', 0, 0, 0],
    ['f5RRfWaHcx1ko8kybqJriN8KUBW1oyoHZqCZ7xhLvhZ', 'GMGN Trend Candidate #25', 'GMGN trend candidate placeholder; use Chrome GMGN wallet page to verify before weighting', 0, 0, 0],
    ['DAQqBbra1fMY28QyvtLG4Gyd66oYu5qbr99jXcBHaxfU', 'GMGN Trend Candidate #26', 'GMGN trend candidate placeholder; use Chrome GMGN wallet page to verify before weighting', 0, 0, 0],
    ['bqomDnLSjiQVzaV8GF5N2ecFeF15nh4F5z3xN5ZGJ', 'GMGN Trend Candidate #27', 'GMGN trend candidate placeholder; use Chrome GMGN wallet page to verify before weighting', 0, 0, 0],
    ['Eb9oyddXGsXtTD77jUPUTWxo4kii74SoNtx7GDDbV9U', 'GMGN Trend Candidate #28', 'GMGN trend candidate placeholder; use Chrome GMGN wallet page to verify before weighting', 0, 0, 0],
    ['JWGx5Vtxwc74ibv16qwGBTYXExSz4BR1RHssWKUmo', 'GMGN Trend Candidate #29', 'GMGN trend candidate placeholder; use Chrome GMGN wallet page to verify before weighting', 0, 0, 0],
    ['jnYADKE4epb4pM44eXZwaB4Z6wC5f5kxGS8ydGef3g6T', 'GMGN Trend Candidate #30', 'GMGN trend candidate placeholder; use Chrome GMGN wallet page to verify before weighting', 0, 0, 0],
  ].map(([address, label, evidence, winRate, avgROI, totalTrades], index) => ({
    address: String(address),
    label: String(label),
    source: 'gmgn' as const,
    notes: `Built-in GMGN Solana smart-wallet pool. Evidence: ${evidence}. Verify in Chrome before increasing weight.`,
    winRate: Number(winRate),
    avgROI: Number(avgROI),
    totalTrades: Number(totalTrades),
    lastSeen: seededAt,
    addedAt: seededAt,
    isAutoImported: true,
    providerRef: `gmgn-builtin-${index + 1}`,
    refreshedAt: getNow(),
  })),
  ave: [
    ['JD38n7ynKYcgPpF7k1BhXEeREu1KqptU93fVGy3S624k', 'AVE Observed Wallet #1', 'AVE/Birdeye cross-check candidate; public Popular wallet profile', 0, 0, 0],
    ['Bqa5SE6WmQK4ybrMnHEvQX3gxLT91s23M76monGJGaDD', 'AVE Observed Wallet #2', 'AVE/Birdeye cross-check candidate; public Popular wallet profile', 0, 0, 0],
    ['BAG1ad6HgmFBEiSDAyf9NgSafAmbK8y9YnkKnTvt4kLT', 'AVE Observed Wallet #3', 'AVE/Birdeye cross-check candidate; public wallet profile', 0, 0, 0],
    ['daMHEjnMGHS9jiLWMq51Wgd75bEZH9Py5yGQKBVvbnLg', 'AVE Trend Candidate #4', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['1jucLj7y9H8y7pcAJKfEnNEkhwHZYHzw46hUvJ31Nr9h', 'AVE Trend Candidate #5', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['BpVcnUc185ymzAb3vQecAU93LQzsx3zPEkGj7Prcyx', 'AVE Trend Candidate #6', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['gpAGxBttCyT2CpNsTtjxptGJBsm7Rx3wXFDuWPLusxF', 'AVE Trend Candidate #7', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['2jDSNJx5rJPiZSkvbN28yHCeH37fUPosMUfZ8RzdD', 'AVE Trend Candidate #8', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['3nU1atbkoppjDQU5jNgMjw8ozLZLjTMSmKc9DTjRkp', 'AVE Trend Candidate #9', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['gdLScv1LKEUsefiMWVVkEZXszspBj6KZjhgN6uqGk', 'AVE Trend Candidate #10', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['FtDA23GXgwr5WTyhdDnmRYSGAim1zqxry7rUFCtmaW', 'AVE Trend Candidate #11', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['cGw8W9tWjacfMqzVguozZUvcVzBpxXVHqGvhJrra', 'AVE Trend Candidate #12', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['hGJV5nKGJNMzb69AFRmAnE5TTNbWT4EvTRzrem2wyqd', 'AVE Trend Candidate #13', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['X1PLqRwzvTbppbtfzFYFJUY2RNjktSoBvW9gb2Sedj2', 'AVE Trend Candidate #14', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['iU9xWC4HRMEWMNqyRJqvTHv6X2pb4PFi5ri3q2GD', 'AVE Trend Candidate #15', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['gAG9Xj8dEWmHrQBffpn8ruBL7e2LdkRSnD5emvhG', 'AVE Trend Candidate #16', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['mrLwkft8sds3PbUjQ5ZiN1wTuY7UQhzvWnAUCoai', 'AVE Trend Candidate #17', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['gtbrXWUuoeJMwGv6JyVGqWdgjRN2YwMCYEPtHNJyfm', 'AVE Trend Candidate #18', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['c1aD6GoTYcqGmXinYVs26KFSmGLjeQXcaPUpcNPmWJ', 'AVE Trend Candidate #19', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['HF8oDM8pbqmCDEpXJoeqafK7vDKFQCL1nb9J34cKm9', 'AVE Trend Candidate #20', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['7x1dKXXVNC4HxX8u5SY5dhk4AAtdL6G8cqTffsgFraR', 'AVE Trend Candidate #21', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['VLxeULdg4gp7qEhEHj6BGCc5B1TVmfXK3FKnKmxW5kF', 'AVE Trend Candidate #22', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['sshejtDU8bFiAJuA54BsLfpudKV8WmLmSJZbYV6f3y', 'AVE Trend Candidate #23', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['pMfH26Fkvxde2qkuJd3qqCXaiVJCeUhuY6XPTNMj7wB', 'AVE Trend Candidate #24', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['TmYKjSuqc3W6MHM8rSxZu1jxbWT4DaQgqYhVq4EJc9', 'AVE Trend Candidate #25', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['VymY82hftGnBLc1cT6Fv8W8ivAYnKZnJTvXXGWcARD', 'AVE Trend Candidate #26', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['Zpy9x5JrswTNsZJu1KoLveejYxAVbXPNcqbRWMxDmGdR', 'AVE Trend Candidate #27', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['wrT3MpXntRRjsuiAY39ZeNx7xwV7aW1oATxiA5XsH', 'AVE Trend Candidate #28', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['gmSi6wNwkwbRMhnyqYxb3g5GhkKFp6U7qhnx7VBmLz', 'AVE Trend Candidate #29', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
    ['3Ms4KPQUAGaTdksCBC6gxRgkGYeAFWhHWHj1ztWz', 'AVE Trend Candidate #30', 'AVE trend/top-holder candidate placeholder; use AVE token holder and wallet pages to verify before weighting', 0, 0, 0],
  ].map(([address, label, evidence, winRate, avgROI, totalTrades], index) => ({
    address: String(address),
    label: String(label),
    source: 'ave' as const,
    notes: `Built-in AVE Solana smart-wallet/top-holder observation pool. Evidence: ${evidence}. Verify AVE token/holder pages in Chrome before increasing weight.`,
    winRate: Number(winRate),
    avgROI: Number(avgROI),
    totalTrades: Number(totalTrades),
    lastSeen: seededAt,
    addedAt: seededAt,
    isAutoImported: true,
    providerRef: `ave-builtin-${index + 1}`,
    refreshedAt: getNow(),
  })),
};

async function refreshBuiltinSmartWalletPool(source: 'gmgn' | 'ave'): Promise<SmartMoneyWallet[]> {
  return dedupeWallets(BUILTIN_SMART_MONEY_POOLS[source].map(wallet => ({ ...wallet, refreshedAt: getNow() })));
}

function normalizeWallet(raw: Record<string, unknown>, source: SmartMoneySource, index: number, note: string): SmartMoneyWallet | null {
  const address = [
    raw.address,
    raw.wallet,
    raw.wallet_address,
    raw.walletAddress,
    raw.owner,
    raw.owner_address,
    raw.trader,
    raw.trader_address,
  ].find(value => typeof value === 'string' && SOLANA_WALLET_RE.test(value)) as string | undefined;

  if (!address) {
    const match = JSON.stringify(raw).match(SOLANA_WALLET_RE);
    if (!match?.[0]) return null;
    return {
      address: match[0],
      label: `${getProviderSummary(source).label} Top ${index + 1}`,
      source,
      notes: note,
      winRate: Number(raw.win_rate ?? raw.winRate) || 0,
      avgROI: Number(raw.avg_roi ?? raw.avgROI ?? raw.roi) || 0,
      totalTrades: Number(raw.total_trades ?? raw.totalTrades ?? raw.trade_count) || 0,
      lastSeen: getNow(),
      addedAt: getNow(),
      isAutoImported: true,
      providerRef: source,
      refreshedAt: getNow(),
    };
  }

  return {
    address,
    label: typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim()
      : typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : `${getProviderSummary(source).label} Top ${index + 1}`,
    source,
    notes: note,
    winRate: Number(raw.win_rate ?? raw.winRate) || 0,
    avgROI: Number(raw.avg_roi ?? raw.avgROI ?? raw.roi ?? raw.realized_profit_percentage) || 0,
    totalTrades: Number(raw.total_trades ?? raw.totalTrades ?? raw.trade_count ?? raw.trades) || 0,
    lastSeen: getNow(),
    addedAt: getNow(),
    isAutoImported: true,
    providerRef: source,
    refreshedAt: getNow(),
  };
}

async function refreshBirdeyeTopWallets(): Promise<SmartMoneyWallet[]> {
  const apiKey = process.env.BIRDEYE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing BIRDEYE_API_KEY');
  }

  const response = await fetch('https://public-api.birdeye.so/trader/gainers-losers?limit=20', {
    headers: {
      'X-API-KEY': apiKey,
      'x-chain': 'solana',
    },
  });

  if (!response.ok) {
    throw new Error(`Birdeye request failed: ${response.status}`);
  }

  const payload = await response.json() as Record<string, unknown>;
  let items: unknown[] = [];
  if (payload.data && typeof payload.data === 'object' && Array.isArray((payload.data as Record<string, unknown>).items)) {
    items = (payload.data as Record<string, unknown>).items as unknown[];
  } else if (Array.isArray(payload.data)) {
    items = payload.data;
  } else if (Array.isArray(payload.items)) {
    items = payload.items;
  }

  const note = 'Auto-imported from Birdeye Trader - Gainers/Losers';
  return dedupeWallets(
    items
      .map((item, index) => item && typeof item === 'object'
        ? normalizeWallet(item as Record<string, unknown>, 'birdeye', index, note)
        : null)
      .filter((wallet): wallet is SmartMoneyWallet => !!wallet)
  );
}

async function refreshXFeedWallets(): Promise<SmartMoneyWallet[]> {
  const token = process.env.X_BEARER_TOKEN?.trim();
  if (!token) {
    throw new Error('Missing X_BEARER_TOKEN');
  }

  const query = encodeURIComponent('from:SolSmartTrader (Address OR "smart wallet" OR wallet) -is:retweet -is:reply');
  const response = await fetch(`https://api.x.com/2/tweets/search/recent?query=${query}&max_results=20&tweet.fields=created_at,text`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`X request failed: ${response.status}`);
  }

  const payload = await response.json() as { data?: Array<{ id: string; text: string; created_at?: string }> };
  const rows = payload.data ?? [];

  return dedupeWallets(rows.flatMap((post, index) => {
    const matches = post.text.match(SOLANA_WALLET_RE) ?? [];
    return matches.map((address, offset) => ({
      address,
      label: `X Feed ${index + 1}.${offset + 1}`,
      source: 'x' as const,
      notes: `Auto-imported from X feed post ${post.id}`,
      winRate: 0,
      avgROI: 0,
      totalTrades: 0,
      lastSeen: post.created_at ? Date.parse(post.created_at) : getNow(),
      addedAt: getNow(),
      isAutoImported: true,
      providerRef: `tweet:${post.id}`,
      refreshedAt: getNow(),
    }));
  }));
}

export async function refreshSmartMoneyProvider(source: SmartMoneySource): Promise<SmartMoneyProviderRun> {
  const startedAt = getNow();

  try {
    let wallets: SmartMoneyWallet[] = [];
    switch (source) {
      case 'gmgn':
      case 'ave':
        wallets = await refreshBuiltinSmartWalletPool(source);
        break;
      case 'birdeye':
        wallets = await refreshBirdeyeTopWallets();
        break;
      case 'x':
        wallets = await refreshXFeedWallets();
        break;
      default: {
        const provider = getProviderSummary(source);
        const run: Omit<SmartMoneyProviderRun, 'id'> = {
          source,
          status: 'skipped',
          startedAt,
          finishedAt: getNow(),
          walletCount: 0,
          message: provider.note,
        };
        const id = db.saveSmartMoneyProviderRun(run);
        return { id, ...run };
      }
    }

    db.replaceAutoImportedSmartMoneyWallets(source, wallets);

    const run: Omit<SmartMoneyProviderRun, 'id'> = {
      source,
      status: 'success',
      startedAt,
      finishedAt: getNow(),
      walletCount: wallets.length,
      message: `Imported ${wallets.length} wallets`,
    };
    const id = db.saveSmartMoneyProviderRun(run);
    return { id, ...run };
  } catch (error) {
    const run: Omit<SmartMoneyProviderRun, 'id'> = {
      source,
      status: 'error',
      startedAt,
      finishedAt: getNow(),
      walletCount: 0,
      message: error instanceof Error ? error.message : String(error),
    };
    const id = db.saveSmartMoneyProviderRun(run);
    return { id, ...run };
  }
}

export async function refreshAllAutoSources(): Promise<SmartMoneyProviderRun[]> {
  const sources = PROVIDERS.filter(provider => provider.autoRefresh).map(provider => provider.source);
  const runs: SmartMoneyProviderRun[] = [];
  for (const source of sources) {
    runs.push(await refreshSmartMoneyProvider(source));
  }
  return runs;
}

export function getSmartMoneyProviderCatalog() {
  const recentRuns = db.getSmartMoneyProviderRuns(100);
  return PROVIDERS.map(provider => ({
    ...provider,
    lastRun: recentRuns.find(run => run.source === provider.source) ?? null,
  }));
}

export function startSmartMoneyRefreshScheduler() {
  if (refreshTimer) return;

  void refreshAllAutoSources().catch(error => {
    console.error('[SmartMoneyProviders] Initial refresh failed:', error);
  });

  refreshTimer = setInterval(() => {
    void refreshAllAutoSources().catch(error => {
      console.error('[SmartMoneyProviders] Scheduled refresh failed:', error);
    });
  }, DAY_MS);
}
