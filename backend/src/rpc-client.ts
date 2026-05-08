// ===== Shared Solana RPC Client =====
// Single rate-limited RPC client used by all strategy modules.
// Eliminates duplicate requestQueue / rpcFetch across creator, lp-lock, smart-money.

const MIN_INTERVAL = 350; // ms between RPC requests
const DEFAULT_TIMEOUT = 12_000;

let requestQueue = Promise.resolve();
let nextAvailable = 0;

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function getRpcUrl(): string {
  return process.env.SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';
}

export interface RpcFetchResult<T = any> {
  ok: boolean;
  status: number | null;
  data: T | null;
}

/**
 * Rate-limited Solana JSON-RPC call.
 * Serialises requests through a shared queue so that all callers
 * (creator, lp-lock, smart-money, fetcher) respect the same rate limit.
 */
export async function rpcFetch(body: object, timeoutMs = DEFAULT_TIMEOUT): Promise<any> {
  const result = await rpcFetchWithMeta(body, timeoutMs);
  return result.ok ? result.data : null;
}

export async function rpcFetchWithMeta<T = any>(body: object, timeoutMs = DEFAULT_TIMEOUT): Promise<RpcFetchResult<T>> {
  const slot = requestQueue.then(async () => {
    const wait = Math.max(0, nextAvailable - Date.now());
    if (wait > 0) await delay(wait);
    nextAvailable = Date.now() + MIN_INTERVAL;
  });
  requestQueue = slot.catch(() => undefined);
  await slot;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(getRpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, data: null };
    }
    const data = await res.json() as T;
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: null, data: null };
  } finally {
    clearTimeout(timeout);
  }
}
