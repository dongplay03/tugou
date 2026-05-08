import type { SmartMoneySource } from '../types';

export const SMART_MONEY_SOURCE_OPTIONS: Array<{
  id: SmartMoneySource;
  name: string;
  hint: string;
}> = [
  { id: 'gmgn', name: 'GMGN', hint: '链上热榜、高手榜和高胜率地址池。' },
  { id: 'ave', name: 'AVE', hint: 'AVE 风险页、Top holder 和聪明钱包观察池。' },
  { id: 'bullx', name: 'BullX', hint: '交易终端和社区导出的热点跟单钱包。' },
  { id: 'photon', name: 'Photon', hint: 'Photon 社区与热点狙击钱包来源。' },
  { id: 'birdeye', name: 'Birdeye', hint: '价格面板和活跃钱包看板来源。' },
  { id: 'x', name: 'X / Twitter', hint: '公开分享、KOL 贴文和线程整理地址。' },
  { id: 'telegram', name: 'Telegram / Discord', hint: '社群 Alpha 池、聊天群整理名单。' },
  { id: 'manual', name: 'Manual', hint: '手工录入、临时观察和其他来源。' },
];

export function getSmartMoneySourceName(source: SmartMoneySource): string {
  return SMART_MONEY_SOURCE_OPTIONS.find(item => item.id === source)?.name || 'Manual';
}

export function isLikelySolanaWallet(query: string): boolean {
  const trimmed = query.trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
}

type SearchConfig = {
  homeUrl: string;
  docsUrl?: string;
  placeholder: string;
  helper: string;
  buildSearchUrl: (query: string) => string;
};

export const SMART_MONEY_SOURCE_SEARCH: Record<SmartMoneySource, SearchConfig> = {
  gmgn: {
    homeUrl: 'https://gmgn.ai/discover?chain=sol',
    docsUrl: 'https://docs.gmgn.ai/index/wallet-rader',
    placeholder: '代币名、KOL 名称或钱包地址',
    helper: '打开 GMGN 发现页或用站点搜索找 Wallet Radar / Follow / Track 里的聪明钱包。',
    buildSearchUrl: (query) => `https://www.google.com/search?q=${encodeURIComponent(`site:gmgn.ai ${query} solana wallet smart money`)}`,
  },
  ave: {
    homeUrl: 'https://ave.ai/',
    docsUrl: 'https://docs.ave.ai/reference/api-reference/v2',
    placeholder: '代币地址、holder 或聪明钱包地址',
    helper: 'AVE API 不通时，打开 AVE token/holder 页面或 Google 站内搜索补证据。',
    buildSearchUrl: (query) => isLikelySolanaWallet(query)
      ? `https://ave.ai/token/${encodeURIComponent(query.trim())}-solana`
      : `https://www.google.com/search?q=${encodeURIComponent(`site:ave.ai ${query} solana wallet holder smart money`)}`,
  },
  bullx: {
    homeUrl: 'https://bull-x.io/',
    placeholder: '代币名、标签或钱包地址',
    helper: 'BullX 没有稳定公开索引页时，直接走站点搜索更稳。',
    buildSearchUrl: (query) => `https://www.google.com/search?q=${encodeURIComponent(`site:bull-x.io OR site:bullxneo.com ${query} solana wallet`)}`,
  },
  photon: {
    homeUrl: 'https://photon-sol.tinyastro.io/',
    placeholder: '代币名、标签或钱包地址',
    helper: 'Photon 搜索入口经常变动，优先用站点搜索再手动复制地址。',
    buildSearchUrl: (query) => `https://www.google.com/search?q=${encodeURIComponent(`site:photon-sol.tinyastro.io ${query} solana wallet`)}`,
  },
  birdeye: {
    homeUrl: 'https://birdeye.so/',
    docsUrl: 'https://learn.birdeye.so/docs/wallet-tracker',
    placeholder: '钱包地址或 trader 关键词',
    helper: 'Birdeye 的 Wallet Tracker 支持直接打开钱包详情页，也适合搜 Popular 钱包。',
    buildSearchUrl: (query) => isLikelySolanaWallet(query)
      ? `https://birdeye.so/solana/profile/${encodeURIComponent(query.trim())}`
      : `https://www.google.com/search?q=${encodeURIComponent(`site:birdeye.so/solana/profile ${query} solana trader`)}`,
  },
  x: {
    homeUrl: 'https://x.com/SolSmartTrader',
    placeholder: '代币名、smart wallet、KOL 名称',
    helper: '优先搜公开线程、榜单号和贴文里的钱包地址，再手动加入。',
    buildSearchUrl: (query) => `https://x.com/search?q=${encodeURIComponent(`${query} solana smart wallet OR wallet address`)}&src=typed_query&f=live`,
  },
  telegram: {
    homeUrl: 'https://t.me/s/GMGN_US',
    placeholder: '频道名、代币名或钱包地址',
    helper: 'Telegram Web 对全局搜索支持有限，使用站点搜索更可控。',
    buildSearchUrl: (query) => `https://www.google.com/search?q=${encodeURIComponent(`site:t.me ${query} solana smart wallet`)}`,
  },
  manual: {
    homeUrl: 'https://solscan.io/',
    placeholder: '钱包地址或任何备注关键词',
    helper: '手工核验时可直接跳转 Solscan，确认是否真是你要跟踪的钱包。',
    buildSearchUrl: (query) => isLikelySolanaWallet(query)
      ? `https://solscan.io/account/${encodeURIComponent(query.trim())}`
      : `https://www.google.com/search?q=${encodeURIComponent(`${query} solana wallet`)}`,
  },
};
