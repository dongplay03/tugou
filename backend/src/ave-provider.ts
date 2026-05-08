import type { ChainId, CreatorProfile, CreatorTokenHistoryItem, HolderCheckResult } from './types.js';

export interface AveRiskSnapshot {
  top10HolderPct: number | null;
  holderCount: number | null;
  riskLevel: number | null;
  riskInfo: string | null;
  devAddress: string | null;
  devLaunchedTokenCount: number | null;
  devRugCount: number | null;
  devSurvivalCount: number | null;
  devRugRate: number | null;
  devHistory: CreatorTokenHistoryItem[];
}

const DEFAULT_AVE_BASE = 'https://prod.ave-api.com';

export function isAveProviderEnabled(): boolean {
  return Boolean(
    process.env.AVE_API_KEY?.trim() ||
    process.env.AVEAI_API_KEY?.trim() ||
    process.env.AVE_API_BASE?.trim() ||
    process.env.AVEAI_API_BASE?.trim(),
  );
}

export async function fetchAveRiskSnapshot(tokenAddress: string, chainId: ChainId): Promise<AveRiskSnapshot | null> {
  if (!isAveProviderEnabled()) return null;

  const tokenId = `${tokenAddress}-${chainId}`;
  const [contract, holders, devHistoryRaw] = await Promise.all([
    aveGet(`/v2/contracts/${encodeURIComponent(tokenId)}`).catch(() => null),
    aveGet(`/v2/tokens/top100/${encodeURIComponent(tokenId)}?limit=100`).catch(() => null),
    aveGet(`/v2/tokens/${encodeURIComponent(tokenId)}/dev-launched?limit=30`).catch(() => null),
  ]);

  const contractData = unwrapAveData(contract);
  const holdersData = unwrapAveData(holders);
  const devHistoryData = unwrapAveData(devHistoryRaw);
  const devAddress = extractString(contractData, [
    'dev', 'dev_address', 'devAddress', 'creator', 'creator_address', 'creatorAddress',
    'deployer', 'deployer_address', 'owner', 'owner_address', 'pump_dev', 'pumpDev',
  ]);
  const devHistory = extractDevHistory(devHistoryData);
  const rugged = devHistory.filter(item => item.status === 'rugged').length;
  const survived = devHistory.filter(item => item.status === 'survived').length;
  const sample = rugged + survived;

  return {
    top10HolderPct: extractTop10Pct(holdersData),
    holderCount: extractNumber(contractData, ['holders', 'holder_count', 'holderCount']),
    riskLevel: extractNumber(contractData, ['risk_level', 'riskLevel']),
    riskInfo: extractString(contractData, ['risk_info', 'riskInfo']),
    devAddress,
    devLaunchedTokenCount: extractNumber(contractData, ['dev_token_count', 'devTokenCount', 'launch_count', 'launchCount', 'created_token_count', 'createdTokenCount']) ?? (devHistory.length || null),
    devRugCount: extractNumber(contractData, ['dev_rug_count', 'devRugCount', 'rug_count', 'rugCount']) ?? (sample > 0 ? rugged : null),
    devSurvivalCount: extractNumber(contractData, ['dev_survival_count', 'devSurvivalCount', 'survival_count', 'survivalCount']) ?? (sample > 0 ? survived : null),
    devRugRate: extractNumber(contractData, ['dev_rug_rate', 'devRugRate', 'rug_rate', 'rugRate']) ?? (sample > 0 ? rugged / sample : null),
    devHistory,
  };
}

export function aveSnapshotToHolderCheck(snapshot: AveRiskSnapshot | null): HolderCheckResult | undefined {
  if (!snapshot || snapshot.top10HolderPct === null) return undefined;
  return {
    top10Pct: snapshot.top10HolderPct,
    holderCount: snapshot.holderCount,
    inconclusive: false,
  };
}

async function aveGet(path: string): Promise<unknown> {
  const base = (process.env.AVE_API_BASE?.trim() || process.env.AVEAI_API_BASE?.trim() || DEFAULT_AVE_BASE).replace(/\/$/, '');
  const apiKey = process.env.AVE_API_KEY?.trim() || process.env.AVEAI_API_KEY?.trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(`${base}${path}`, {
      signal: controller.signal,
      headers: apiKey
        ? {
            'X-API-KEY': apiKey,
            Authorization: `Bearer ${apiKey}`,
          }
        : undefined,
    });

    if (!response.ok) {
      throw new Error(`AVE request failed: ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function unwrapAveData(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const record = payload as Record<string, unknown>;
  return record.data ?? record.result ?? payload;
}

function extractTop10Pct(data: unknown): number | null {
  if (!Array.isArray(data)) return null;
  const top10 = data.slice(0, 10);
  const values = top10
    .map(item => item && typeof item === 'object'
      ? extractNumber(item as Record<string, unknown>, ['percent', 'pct', 'holder_percent', 'amount_percent', 'ratio', 'rate'])
      : null)
    .filter((value): value is number => value !== null);

  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + normalizePct(value), 0);
  return Math.min(100, total);
}

function extractNumber(data: unknown, keys: string[]): number | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function extractString(data: unknown, keys: string[]): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function normalizePct(value: number): number {
  if (value <= 1) return value * 100;
  return value;
}


export function aveSnapshotToCreatorProfile(snapshot: AveRiskSnapshot | null, fallbackCreatorAddress: string | null): CreatorProfile | undefined {
  if (!snapshot) return undefined;
  const creatorAddress = snapshot.devAddress || fallbackCreatorAddress;
  if (!creatorAddress) return undefined;
  const ruggedTokens = snapshot.devRugCount ?? snapshot.devHistory.filter(item => item.status === 'rugged').length;
  const survivingTokens = snapshot.devSurvivalCount ?? snapshot.devHistory.filter(item => item.status === 'survived').length;
  const tokensMinted = snapshot.devLaunchedTokenCount ?? Math.max(ruggedTokens + survivingTokens, snapshot.devHistory.length);

  return {
    creatorAddress,
    tokensMinted,
    ruggedTokens,
    survivingTokens,
    avgTokenLifespanHours: 0,
    lastChecked: Date.now(),
    source: 'ave',
    devLaunchedTokenCount: snapshot.devLaunchedTokenCount ?? tokensMinted,
    devRugRate: snapshot.devRugRate,
    devHistory: snapshot.devHistory,
  };
}

function extractDevHistory(data: unknown): CreatorTokenHistoryItem[] {
  const items = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? (['list', 'items', 'tokens', 'data'].map(key => (data as Record<string, unknown>)[key]).find(Array.isArray) as unknown[] | undefined) ?? []
      : [];

  return items.slice(0, 30).map((item, index) => normalizeDevToken(item, index)).filter((item): item is CreatorTokenHistoryItem => Boolean(item));
}

function normalizeDevToken(raw: unknown, index: number): CreatorTokenHistoryItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const address = extractString(record, ['address', 'token', 'token_address', 'tokenAddress', 'mint', 'mint_address']);
  if (!address) return null;
  const symbol = extractString(record, ['symbol', 'token_symbol', 'tokenSymbol']) || `DEV#${index + 1}`;
  const name = extractString(record, ['name', 'token_name', 'tokenName']) || symbol;
  const marketCap = extractNumber(record, ['market_cap', 'marketCap', 'mc', 'fdv']);
  const liquidityUsd = extractNumber(record, ['liquidity', 'liquidity_usd', 'liquidityUsd', 'lp']);
  const priceChange24h = extractNumber(record, ['price_change_24h', 'priceChange24h', 'change24h']);
  const createdAt = normalizeTime(extractNumber(record, ['created_at', 'createdAt', 'launch_time', 'launchTime', 'open_time']));
  const riskText = `${extractString(record, ['status', 'risk', 'risk_info', 'riskInfo', 'label']) || ''}`.toLowerCase();
  const status: CreatorTokenHistoryItem['status'] =
    riskText.includes('rug') || riskText.includes('跑路') || riskText.includes('归零') || riskText.includes('dead') || (liquidityUsd !== null && liquidityUsd < 1000)
      ? 'rugged'
      : marketCap !== null && marketCap > 50_000 && (liquidityUsd ?? 0) > 5_000
        ? 'survived'
        : 'unknown';
  return {
    address,
    symbol,
    name,
    createdAt,
    marketCap,
    liquidityUsd,
    priceChange24h,
    status,
    evidence: extractString(record, ['evidence', 'risk_info', 'riskInfo', 'status']) || 'AVE dev-launched token history',
  };
}

function normalizeTime(value: number | null): number | null {
  if (!value) return null;
  return value < 10_000_000_000 ? value * 1000 : value;
}
