import type { ChainId } from './types.js';

export type MarketDataProviderStatus = {
  id: 'dexscreener' | 'ave' | 'gmgn';
  label: string;
  mode: 'api' | 'configurable-api' | 'search-only';
  enabled: boolean;
  chains: ChainId[];
  note: string;
  docsUrl: string;
  fallbackUrl?: string;
  fallbackNote?: string;
};

export function getMarketDataProviderCatalog(): MarketDataProviderStatus[] {
  const dexBase = process.env.DEXSCREENER_API_BASE?.trim();
  const aveKey = process.env.AVE_API_KEY?.trim() || process.env.AVEAI_API_KEY?.trim();
  const aveBase = process.env.AVE_API_BASE?.trim() || process.env.AVEAI_API_BASE?.trim();
  const gmgnBase = process.env.GMGN_API_BASE?.trim();

  return [
    {
      id: 'dexscreener',
      label: 'DexScreener',
      mode: 'api',
      enabled: true,
      chains: ['solana'],
      note: dexBase
        ? `Using custom base ${dexBase}`
        : 'Public pair/search/profile APIs enabled for Solana discovery.',
      docsUrl: 'https://docs.dexscreener.com/api/reference',
    },
    {
      id: 'ave',
      label: 'AVE',
      mode: 'configurable-api',
      enabled: Boolean(aveKey || aveBase),
      chains: ['solana'],
      note: aveKey || aveBase
        ? 'AVE enrichment enabled for contract risk and top-holder concentration during screening.'
        : 'AVE API not required. Use browser/search fallback for contract risk, top-holder concentration, and trend-board checks to reduce direct API/IP pressure.',
      docsUrl: 'https://docs.ave.ai/reference/api-reference/v2',
      fallbackUrl: 'https://www.google.com/search?q=site%3Aave.ai%20solana%20token%20risk%20holders',
      fallbackNote: 'Fallback: open AVE token pages or Google site-search in Chrome when API is unavailable or rate-limited.',
    },
    {
      id: 'gmgn',
      label: 'GMGN',
      mode: gmgnBase ? 'configurable-api' : 'search-only',
      enabled: Boolean(gmgnBase),
      chains: ['solana'],
      note: gmgnBase
        ? `GMGN base configured at ${gmgnBase}; use it for a private/compatible feed adapter.`
        : 'GMGN public product pages are useful for hot lists, wallet radar, and smart-money evidence; no stable public API is assumed.',
      docsUrl: 'https://docs.gmgn.ai/index/wallet-detail-page',
      fallbackUrl: 'https://gmgn.ai/sol/discover',
      fallbackNote: 'Fallback: open GMGN discover/token/wallet pages in Chrome and capture hot-list, net-buy, wallet, and holder evidence manually.',
    },
  ];
}
