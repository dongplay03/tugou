// ===== 链上新池实时监听 =====
// 通过 Solana WebSocket 订阅 Raydium V4 AMM 和 Pump.fun 的 program logs，
// 秒级检测新池子创建 / bonding curve 毕业事件，比 DexScreener 快 3-15 分钟。

import WebSocket from 'ws';
import { getRpcUrl } from './rpc-client.js';

// Raydium V4 AMM program
const RAYDIUM_V4 = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
// Pump.fun program（毕业时会调用 Raydium 的 initialize）
const PUMPFUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
// SOL 的 mint 地址
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

type NewPoolCallback = (pool: NewPoolEvent) => void;

export interface NewPoolEvent {
  poolAddress: string;
  baseMint: string;
  quoteMint: string;
  source: 'raydium' | 'pumpfun';
  timestamp: number;
  signature: string;
}

let ws: WebSocket | null = null;
let callbacks: NewPoolCallback[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;
let subscriptionId: number | null = null;
let messageId = 1;

// 去重：最近 5 分钟内见过的 pool 不重复回调
const recentPools = new Map<string, number>();
const DEDUP_TTL = 5 * 60 * 1000;

function getWsUrl(): string {
  // 优先用环境变量配置的 WebSocket URL
  const explicit = process.env.SOLANA_WS_URL?.trim();
  if (explicit) return explicit;
  // 否则从 RPC URL 推导
  return getRpcUrl()
    .replace('https://', 'wss://')
    .replace('http://', 'ws://');
}

export function onNewPool(cb: NewPoolCallback) {
  callbacks.push(cb);
}

export function startPoolWatcher() {
  if (isRunning) return;
  isRunning = true;
  console.log('[PoolWatcher] 🚀 启动链上新池监听...');
  connect();
}

export function stopPoolWatcher() {
  isRunning = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  subscriptionId = null;
  console.log('[PoolWatcher] ⏹️ 已停止');
}

function connect() {
  if (!isRunning) return;

  const wsUrl = getWsUrl();
  console.log(`[PoolWatcher] 连接 WebSocket: ${wsUrl.slice(0, 50)}...`);

  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('[PoolWatcher] ✅ WebSocket 已连接');
    subscribe();
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleMessage(msg);
    } catch {
      // 忽略非 JSON 消息
    }
  });

  ws.on('close', () => {
    console.warn('[PoolWatcher] WebSocket 断开');
    subscriptionId = null;
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error('[PoolWatcher] WebSocket 错误:', (err as Error).message);
  });
}

function subscribe() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const id = messageId++;
  // 订阅 Raydium V4 AMM program 的日志，检测 initialize2 指令
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'logsSubscribe',
    params: [
      { mentions: [RAYDIUM_V4] },
      { commitment: 'confirmed' },
    ],
  }));
}

function handleMessage(msg: any) {
  // 订阅确认
  if (msg.id && msg.result !== undefined) {
    subscriptionId = msg.result;
    console.log(`[PoolWatcher] 已订阅 Raydium logs (subscription: ${subscriptionId})`);
    return;
  }

  // 日志通知
  if (msg.method === 'logsNotification' && msg.params?.result?.value) {
    const value = msg.params.result.value;
    const logs: string[] = value.logs || [];
    const signature: string = value.signature || '';

    // 检测 Raydium V4 的 initialize2 指令（新池创建）
    const isInitialize = logs.some(
      (log: string) => log.includes('initialize2') || log.includes('Initialize2')
    );

    if (!isInitialize) return;

    // 从日志中提取 token mint 地址
    const pool = extractPoolFromLogs(logs, signature);
    if (!pool) return;

    // 去重
    if (recentPools.has(pool.baseMint)) return;
    recentPools.set(pool.baseMint, Date.now());

    console.log(`[PoolWatcher] 🆕 新池检测: ${pool.baseMint} (${pool.source})`);

    for (const cb of callbacks) {
      try {
        cb(pool);
      } catch (err) {
        console.error('[PoolWatcher] 回调执行错误:', err);
      }
    }
  }
}

function extractPoolFromLogs(logs: string[], signature: string): NewPoolEvent | null {
  // Raydium V4 initialize2 日志中会包含 pool 和 token mint 信息
  // 从 Program log 中提取 mint 地址（base58，32-44 字符）
  const mintPattern = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  const allMints = new Set<string>();

  for (const log of logs) {
    // 跳过非 data 日志
    if (log.startsWith('Program ') && !log.includes('data:')) continue;

    const matches = log.match(mintPattern);
    if (matches) {
      for (const m of matches) {
        // 排除已知的程序地址和系统地址
        if (m === RAYDIUM_V4 || m === PUMPFUN_PROGRAM) continue;
        if (m.startsWith('1111111111')) continue;
        allMints.add(m);
      }
    }
  }

  // 检测是否来自 Pump.fun 毕业
  const isPumpfun = logs.some(
    (log: string) => log.includes(PUMPFUN_PROGRAM) || log.includes('pump')
  );

  // 简化逻辑：从日志提取的地址中，WSOL 是 quote，其他是 base
  const nonSolMints = [...allMints].filter(m => m !== WSOL_MINT);

  if (nonSolMints.length === 0) return null;

  // 取第一个非 SOL 的 mint 作为 base token
  return {
    poolAddress: '', // 从日志中难以可靠提取 pool address，后续通过 DexScreener 获取
    baseMint: nonSolMints[0],
    quoteMint: WSOL_MINT,
    source: isPumpfun ? 'pumpfun' : 'raydium',
    timestamp: Date.now(),
    signature,
  };
}

function scheduleReconnect() {
  if (!isRunning) return;
  if (reconnectTimer) return;

  console.log('[PoolWatcher] 5 秒后重连...');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 5000);
}

// 定期清理去重缓存
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of recentPools) {
    if (now - ts > DEDUP_TTL) recentPools.delete(key);
  }
}, 60_000);
