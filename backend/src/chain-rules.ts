import type { ChainId, ExitTier, ExperimentStrategyTag } from './types.js';

type ScoreBand<T> = {
  minScore: number;
  value: T;
};

export interface ChainTradingRules {
  chainId: ChainId;
  label: string;
  unit: 'SOL';
  profile: string;
  screening: {
    minScore: number;
    minLiquidityUsd: number;
    maxRugScore: number;
    preferredDexes: string[];
  };
  position: {
    minCash: number;
    minPosition: number;
    maxCashFraction: number;
    scoreFractions: ScoreBand<number>[];
  };
  exits: {
    tpSl: ScoreBand<{ tp: number; sl: number }>[];
    experimentalMaxTp: number;
    experimentalMinSl: number;
    experimentTimeoutHours: number;
    liquidityRugDropPct: number;
    rapidLiquidityDrainPct: number; // per-cycle rapid drain detection threshold
    priceRugMultiplier: number;
    trailingStop: ScoreBand<number>[];
    trailingMin: number;
    trailingMax: number;
    tiered: {
      experimental: ExitTier[];
      momentum: ExitTier[];
      high: ExitTier[];
      midHigh: ExitTier[];
      mid: ExitTier[];
      low: ExitTier[];
    };
  };
  ui: {
    buyRules: string[];
    sellRules: string[];
    riskRules: string[];
    dataSources: string[];
  };
}

const SOLANA_RULES: ChainTradingRules = {
  chainId: 'solana',
  label: 'Solana 抢新池',
  unit: 'SOL',
  profile: '低手续费、高发行频率、价格节奏更快，优先抢早期动量但必须更快止盈和 Rug 退出。',
  screening: {
    minScore: 45,
    minLiquidityUsd: 12_000,
    maxRugScore: 55,
    preferredDexes: ['raydium', 'meteora', 'orca', 'pump'],
  },
  position: {
    minCash: 0.01,
    minPosition: 0.003,
    maxCashFraction: 0.24,
    scoreFractions: [
      { minScore: 85, value: 0.16 },
      { minScore: 70, value: 0.12 },
      { minScore: 55, value: 0.08 },
      { minScore: 0, value: 0.05 },
    ],
  },
  exits: {
    tpSl: [
      { minScore: 85, value: { tp: 5.5, sl: 0.72 } },
      { minScore: 70, value: { tp: 3.6, sl: 0.75 } },
      { minScore: 55, value: { tp: 2.4, sl: 0.78 } },
      { minScore: 0, value: { tp: 1.8, sl: 0.80 } },
    ],
    experimentalMaxTp: 2.0,
    experimentalMinSl: 0.84,
    experimentTimeoutHours: 0.5,
    liquidityRugDropPct: 0.35,      // lowered from 0.48 — exit earlier on liquidity drain
    rapidLiquidityDrainPct: 0.10,   // 5 秒轮询下 >10% 单周期流失 = 紧急
    priceRugMultiplier: 0.16,
    trailingStop: [
      { minScore: 85, value: 0.34 },
      { minScore: 70, value: 0.28 },
      { minScore: 55, value: 0.23 },
      { minScore: 0, value: 0.18 },
    ],
    trailingMin: 0.13,
    trailingMax: 0.55,
    tiered: {
      experimental: [
        { multiplier: 1.22, sellPct: 0.50, executed: false },
        { multiplier: 1.55, sellPct: 0.30, executed: false },
        { multiplier: 2.0, sellPct: 0.15, executed: false },
      ],
      momentum: [
        { multiplier: 1.35, sellPct: 0.45, executed: false },
        { multiplier: 2.0, sellPct: 0.30, executed: false },
        { multiplier: 3.0, sellPct: 0.15, executed: false },
      ],
      high: [
        { multiplier: 2.0, sellPct: 0.40, executed: false },
        { multiplier: 4.0, sellPct: 0.25, executed: false },
        { multiplier: 8.0, sellPct: 0.20, executed: false },
      ],
      midHigh: [
        { multiplier: 1.8, sellPct: 0.45, executed: false },
        { multiplier: 3.0, sellPct: 0.30, executed: false },
        { multiplier: 5.0, sellPct: 0.25, executed: false },
      ],
      mid: [
        { multiplier: 1.6, sellPct: 0.45, executed: false },
        { multiplier: 2.4, sellPct: 0.30, executed: false },
        { multiplier: 3.5, sellPct: 0.15, executed: false },
      ],
      low: [
        { multiplier: 1.35, sellPct: 0.60, executed: false },
        { multiplier: 1.8, sellPct: 0.25, executed: false },
        { multiplier: 2.5, sellPct: 0.10, executed: false },
      ],
    },
  },
  ui: {
    buyRules: ['分数 >= 45', '流动性 >= $15K', 'Mint/Freeze、Top10 优先验证'],
    sellRules: ['实验桶 30 分钟无优势就撤', '1.22x 起分批止盈，动量桶保留尾仓', '流动性跌 35% 或单周期跌 15% 直接 Rug 退出'],
    riskRules: ['SOL 新池数量多，允许更早入场，但必须小仓和快跑', '重点看权限未放弃、Top10 集中、LP 快速抽走'],
    dataSources: ['DexScreener pairs/profiles', 'Solana RPC authority/holders', 'RugCheck', 'GMGN/AVE 人工或可配置扩展'],
  },
};

const RULES: Record<ChainId, ChainTradingRules> = {
  solana: SOLANA_RULES,
};

export function getChainTradingRules(chainId: ChainId = 'solana'): ChainTradingRules {
  return RULES[chainId] ?? SOLANA_RULES;
}

export function getScoreBandValue<T>(bands: ScoreBand<T>[], score: number): T {
  const sorted = [...bands].sort((a, b) => b.minScore - a.minScore);
  return sorted.find(band => score >= band.minScore)?.value ?? sorted[sorted.length - 1].value;
}

export function cloneExitTiers(tiers: ExitTier[]): ExitTier[] {
  return tiers.map(tier => ({ ...tier, executed: false, executedAt: undefined, executedPrice: undefined }));
}

export function getChainRulesCatalog() {
  return Object.values(RULES).map(rule => ({
    chainId: rule.chainId,
    label: rule.label,
    unit: rule.unit,
    profile: rule.profile,
    screening: rule.screening,
    exits: {
      experimentTimeoutHours: rule.exits.experimentTimeoutHours,
      liquidityRugDropPct: rule.exits.liquidityRugDropPct,
      priceRugMultiplier: rule.exits.priceRugMultiplier,
    },
    ui: rule.ui,
  }));
}

export function isExperimentalStrategy(strategy?: ExperimentStrategyTag): boolean {
  return Boolean(strategy && strategy !== 'score_momentum' && strategy !== 'momentum_breakout');
}
