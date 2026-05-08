// ===== 聪明钱实时交易监控 =====
// 通过 Solana WebSocket 订阅聪明钱钱包的交易日志，
// 秒级检测他们的新买入动作（而不是查"持仓"）。

import WebSocket from 'ws';
import { getRpcUrl } from './rpc-client.js';
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

// 已知的 DEX program 地址（买卖交易一定会涉及这些）
const DEX_PROGRAMS = new Set([
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium V4
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',  // Orca Whirlpool
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',  // Pump.fun
]);

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

function getWsUrl(): string {
  const rpcUrl = getRpcUrl();
  return rpcUrl
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

  const wsUrl = getWsUrl();
  // 只监控前 10 个高质量钱包（WebSocket 订阅数量有限）
  const watchList = wallets
    .sort((a, b) => (b.winRate * b.avgROI) - (a.winRate * a.avgROI))
    .slice(0, 10);

  console.log(`[SmartMoneyWatch] 监控 ${watchList.length} 个聪明钱钱包`);

  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('[SmartMoneyWatch] ✅ WebSocket 已连接');
    // 为每个钱包订阅日志
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

  // 保存 wallet 地址和 id 的映射关系
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

    // 检查是否是 DEX swap 交易（买入操作）
    const isDexSwap = logs.some(
      (log: string) => [...DEX_PROGRAMS].some(prog => log.includes(prog))
    );
    if (!isDexSwap) return;

    // 检测是否是买入（涉及 SOL 转出 + token 转入）
    const isBuy = logs.some(
      (log: string) => log.includes('Transfer') || log.includes('swap')
    );
    if (!isBuy) return;

    // 提取涉及的 token mint
    const tokenMint = extractTokenMintFromLogs(logs);
    if (!tokenMint) return;

    // 去重
    const dedupeKey = `${walletInfo.address}:${tokenMint}`;
    if (recentBuys.has(dedupeKey)) return;
    recentBuys.set(dedupeKey, Date.now());

    const event: SmartMoneyBuyEvent = {
      walletAddress: walletInfo.address,
      walletLabel: walletInfo.label,
      tokenMint,
      signature,
      timestamp: Date.now(),
    };

    console.log(`[SmartMoneyWatch] 🐋 ${walletInfo.label} 买入新 token: ${tokenMint.slice(0, 12)}...`);

    for (const cb of callbacks) {
      try {
        cb(event);
      } catch (err) {
        console.error('[SmartMoneyWatch] 回调执行错误:', err);
      }
    }
  }
}

function extractTokenMintFromLogs(logs: string[]): string | null {
  const mintPattern = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  const candidates = new Set<string>();

  for (const log of logs) {
    const matches = log.match(mintPattern);
    if (matches) {
      for (const m of matches) {
        // 排除已知地址
        if (m === WSOL_MINT) continue;
        if (DEX_PROGRAMS.has(m)) continue;
        if (m.startsWith('1111111111')) continue;
        if (m.length < 32 || m.length > 44) continue;
        candidates.add(m);
      }
    }
  }

  // 返回第一个候选 mint
  return candidates.size > 0 ? [...candidates][0] : null;
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
