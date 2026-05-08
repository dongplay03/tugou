// ===== 聪明钱实时交易监控 =====
// 通过 Solana WebSocket 订阅聪明钱钱包的交易日志，
// 秒级检测他们的新买入动作（而不是查"持仓"）。
// v2: 用 getTransaction 解析实际买卖方向 + token mint

import WebSocket from 'ws';
import { getRpcUrl, rpcFetch } from './rpc-client.js';
import { getAllSmartWallets } from './smart-money.js';

type SmartMoneyBuyCallback = (event: SmartMoneyBuyEvent) => void;

export interface SmartMoneyBuyEvent {
  walletAddress: string;
  walletLabel: string;
  tokenMint: string;
  signature: string;
  timestamp: number;
}

let ws: WebSocket | null = null;
let callbacks: SmartMoneyBuyCallback[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;
let subscriptionIds: number[] = [];
let messageId = 100;

// 去重：同一钱包+同一 token 5 分钟内不重复
const recentBuys = new Map<string, number>();
const DEDUP_TTL = 5 * 60 * 1000;

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// 已知 DEX program（用于快速过滤日志）
const DEX_PROGRAMS = new Set([
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium V4
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',  // Orca Whirlpool
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',  // Pump.fun
]);

function getWsUrl(): string {
  // 优先用环境变量配置的 WebSocket URL
  const explicit = process.env.SOLANA_WS_URL?.trim();
  if (explicit) return explicit;
  // 否则从 RPC URL 推导
  return getRpcUrl()
    .replace('https://', 'wss://')
    .replace('http://', 'ws://');
}

export function onSmartMoneyBuy(cb: SmartMoneyBuyCallback) {
  callbacks.push(cb);
}

export function startSmartMoneyWatcher() {
  if (isRunning) return;
  isRunning = true;
  console.log('[SmartMoneyWatch] 🚀 启动聪明钱实时监控...');
  connect();
}

export function stopSmartMoneyWatcher() {
  isRunning = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  subscriptionIds = [];
  console.log('[SmartMoneyWatch] ⏹️ 已停止');
}

function connect() {
  if (!isRunning) return;

  const wallets = getAllSmartWallets();
  if (wallets.length === 0) {
    console.warn('[SmartMoneyWatch] 没有聪明钱钱包可监控');
    return;
  }

  // 按综合质量排序（胜率 × 平均 ROI），取前 10
  const watchList = wallets
    .sort((a, b) => (b.winRate * b.avgROI) - (a.winRate * a.avgROI))
    .slice(0, 10);

  const wsUrl = getWsUrl();
  console.log(`[SmartMoneyWatch] 监控 ${watchList.length} 个聪明钱钱包`);

  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('[SmartMoneyWatch] ✅ WebSocket 已连接');
    for (const wallet of watchList) {
      subscribeWallet(wallet.address, wallet.label);
    }
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleMessage(msg);
    } catch {
      // 忽略
    }
  });

  ws.on('close', () => {
    console.warn('[SmartMoneyWatch] WebSocket 断开');
    subscriptionIds = [];
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[SmartMoneyWatch] WebSocket 错误:', (err as Error).message);
  });
}

function subscribeWallet(address: string, label: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const id = messageId++;
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'logsSubscribe',
    params: [
      { mentions: [address] },
      { commitment: 'confirmed' },
    ],
  }));

  walletIdMap.set(id, { address, label });
}

// 映射 subscription request id → wallet info
const walletIdMap = new Map<number, { address: string; label: string }>();
// 映射 subscription id → wallet info
const subIdToWallet = new Map<number, { address: string; label: string }>();

function handleMessage(msg: any) {
  // 订阅确认
  if (msg.id && msg.result !== undefined) {
    const walletInfo = walletIdMap.get(msg.id);
    if (walletInfo) {
      subscriptionIds.push(msg.result);
      subIdToWallet.set(msg.result, walletInfo);
      console.log(`[SmartMoneyWatch] 已订阅 ${walletInfo.label} (${walletInfo.address.slice(0, 8)}...)`);
    }
    return;
  }

  // 日志通知
  if (msg.method === 'logsNotification' && msg.params?.result?.value) {
    const subId = msg.params.subscription;
    const walletInfo = subIdToWallet.get(subId);
    if (!walletInfo) return;

    const value = msg.params.result.value;
    const logs: string[] = value.logs || [];
    const signature: string = value.signature || '';

    // 快速过滤：必须是 DEX swap 交易
    const isDexSwap = logs.some(
      (log: string) => [...DEX_PROGRAMS].some(prog => log.includes(prog))
    );
    if (!isDexSwap) return;

    // 异步解析实际交易方向和 token
    processTransaction(walletInfo, signature);
  }
}

// 用 getTransaction 解析实际买卖方向
async function processTransaction(
  walletInfo: { address: string; label: string },
  signature: string,
) {
  try {
    // 去重
    const dedupeKey = `${walletInfo.address}:${signature}`;
    if (recentBuys.has(dedupeKey)) return;
    recentBuys.set(dedupeKey, Date.now());

    // 获取交易详情
    const res = await rpcFetch({
      method: 'getTransaction',
      params: [
        signature,
        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
      ],
    });

    if (!res?.result) return;

    const tx = res.result;
    const preBalances: any[] = tx.meta?.preTokenBalances || [];
    const postBalances: any[] = tx.meta?.postTokenBalances || [];
    const accountKeys: string[] = tx.transaction?.message?.accountKeys
      ?.map((k: any) => typeof k === 'string' ? k : k.pubkey) || [];

    // 判断是否是买入：钱包地址的 SOL 余额减少（付出 SOL）
    const walletIndex = accountKeys.indexOf(walletInfo.address);
    if (walletIndex < 0) return;

    const preSol = tx.meta?.preBalances?.[walletIndex] || 0;
    const postSol = tx.meta?.postBalances?.[walletIndex] || 0;
    const solChange = postSol - preSol;

    // 买入 = SOL 减少（付出 SOL 换 token）
    if (solChange >= 0) return; // SOL 增加 = 卖出，跳过

    // 找出钱包获得的 token（post > pre 且 owner 是钱包地址）
    const gainedMints: string[] = [];
    for (const post of postBalances) {
      if (post.owner !== walletInfo.address) continue;
      const pre = preBalances.find(
        (p: any) => p.mint === post.mint && p.owner === walletInfo.address
      );
      const preAmount = parseFloat(pre?.uiTokenAmount?.uiAmountString || '0');
      const postAmount = parseFloat(post.uiTokenAmount?.uiAmountString || '0');
      if (postAmount > preAmount && post.mint !== WSOL_MINT) {
        gainedMints.push(post.mint);
      }
    }

    if (gainedMints.length === 0) return;

    // 取获得量最大的 token
    const tokenMint = gainedMints[0];

    // 二次去重（wallet + token）
    const tokenDedupeKey = `${walletInfo.address}:${tokenMint}`;
    if (recentBuys.has(tokenDedupeKey)) return;
    recentBuys.set(tokenDedupeKey, Date.now());

    const event: SmartMoneyBuyEvent = {
      walletAddress: walletInfo.address,
      walletLabel: walletInfo.label,
      tokenMint,
      signature,
      timestamp: Date.now(),
    };

    console.log(`[SmartMoneyWatch] 🐋 ${walletInfo.label} 买入: ${tokenMint.slice(0, 12)}... (SOL: ${(solChange / 1e9).toFixed(4)})`);

    for (const cb of callbacks) {
      try {
        cb(event);
      } catch (err) {
        console.error('[SmartMoneyWatch] 回调执行错误:', err);
      }
    }
  } catch (err) {
    // getTransaction 可能暂时查不到（刚上链），静默忽略
  }
}

function scheduleReconnect() {
  if (!isRunning) return;
  if (reconnectTimer) return;

  console.log('[SmartMoneyWatch] 5 秒后重连...');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 5000);
}

// 定期清理去重缓存
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of recentBuys) {
    if (now - ts > DEDUP_TTL) recentBuys.delete(key);
  }
}, 60_000);
