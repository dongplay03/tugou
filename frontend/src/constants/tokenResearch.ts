import type { ChainId } from '../types';

export type ResearchProviderId =
  | 'dexscreener'
  | 'ave'
  | 'aveSearch'
  | 'gmgn'
  | 'gmgnSearch'
  | 'rugcheck'
  | 'explorer'
  | 'birdeye'
  | 'pumpfun'
  | 'bubblemaps'
  | 'x'
  | 'google';

export interface ResearchProviderLink {
  id: ResearchProviderId;
  name: string;
  mode: 'api' | 'manual' | 'external';
  signal: string;
  buildUrl: (input: ResearchLinkInput) => string;
}

export interface ResearchLinkInput {
  chainId: ChainId;
  address: string;
  pairAddress: string;
  symbol: string;
  name: string;
}

export const RESEARCH_PROVIDERS: ResearchProviderLink[] = [
  {
    id: 'dexscreener',
    name: 'DexScreener',
    mode: 'api',
    signal: '行情、池子、成交量、多池流动性',
    buildUrl: ({ pairAddress, address }) => `https://dexscreener.com/solana/${pairAddress || address}`,
  },
  {
    id: 'ave',
    name: 'AVE Token',
    mode: 'external',
    signal: '网页核验：价格、风险、Top holders、交易路径；API 不通时直接用浏览器打开',
    buildUrl: ({ address }) => `https://ave.ai/token/${address}-solana`,
  },
  {
    id: 'aveSearch',
    name: 'AVE Search',
    mode: 'manual',
    signal: 'AVE 直链失效或被风控时，用搜索页/Google 站内搜索兜底，降低 API/IP 压力',
    buildUrl: ({ address, symbol, name }) => `https://www.google.com/search?q=${encodeURIComponent(`site:ave.ai ${address || symbol || name} solana token`)}`,
  },
  {
    id: 'gmgn',
    name: 'GMGN Token',
    mode: 'external',
    signal: '网页核验：热度、聪明钱、资金流、钱包跟踪；不假设稳定公开 API',
    buildUrl: ({ address, symbol }) => {
      const query = symbol || address;
      return `https://gmgn.ai/sol/token/${address}?q=${encodeURIComponent(query)}`;
    },
  },
  {
    id: 'gmgnSearch',
    name: 'GMGN Search',
    mode: 'manual',
    signal: 'GMGN 直链打不开时，用站内搜索找 token、holder、smart money 页面',
    buildUrl: ({ address, symbol, name }) => `https://www.google.com/search?q=${encodeURIComponent(`site:gmgn.ai ${address || symbol || name} solana`)}`,
  },
  {
    id: 'rugcheck',
    name: 'RugCheck',
    mode: 'api',
    signal: 'SOL 风险报告、权限、LP 和 Holder 风险',
    buildUrl: ({ address }) => `https://rugcheck.xyz/tokens/${address}`,
  },
  {
    id: 'explorer',
    name: 'Solscan',
    mode: 'external',
    signal: '链上交易、持有人、权限、创建者、池子账户详情',
    buildUrl: ({ address }) => `https://solscan.io/token/${address}`,
  },
  {
    id: 'birdeye',
    name: 'Birdeye',
    mode: 'external',
    signal: '价格、流动性、持有人、交易者画像和钱包跳转补充',
    buildUrl: ({ address }) => `https://birdeye.so/token/${address}?chain=solana`,
  },
  {
    id: 'pumpfun',
    name: 'Pump.fun',
    mode: 'external',
    signal: '新币来源、bonding curve、创建者页面、早期评论/社区热度',
    buildUrl: ({ address }) => `https://pump.fun/coin/${address}`,
  },
  {
    id: 'bubblemaps',
    name: 'Bubblemaps',
    mode: 'external',
    signal: 'Holder 集中度、地址簇、疑似关联钱包可视化',
    buildUrl: ({ address }) => `https://app.bubblemaps.io/sol/token/${address}`,
  },
  {
    id: 'x',
    name: 'X Search',
    mode: 'manual',
    signal: 'KOL 传播、项目公告、异常舆情、CA 扩散速度',
    buildUrl: ({ symbol, name, address }) => `https://x.com/search?q=${encodeURIComponent(`${address} OR ${symbol || name || ''} solana token smart money rug`)}&src=typed_query&f=live`,
  },
  {
    id: 'google',
    name: 'Google OSINT',
    mode: 'manual',
    signal: '跨站兜底：CA、项目名、黑名单、骗局反馈、旧项目迁移记录',
    buildUrl: ({ address, symbol, name }) => `https://www.google.com/search?q=${encodeURIComponent(`${address} ${symbol || name || ''} solana token rug holders`)}`,
  },
];

export function buildEvidenceStorageKey(chainId: ChainId, address: string): string {
  return `tugou:evidence:${chainId}:${address}`;
}
