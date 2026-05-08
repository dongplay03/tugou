// ===== Strategy 17: AI-Powered Token Analysis =====
// Uses LLM to analyze token metadata, social signals, and dev patterns
// for semantic-level risk assessment that rule-based systems miss.
//
// Key capabilities:
// - Narrative authenticity (real trend vs keyword stuffing)
// - Social quality (real community vs bot/shill accounts)
// - Dev pattern detection (multi-rug serial deployer)
// - Description analysis (scam red flags, copied content)
// - Cross-signal synthesis (combines multiple weak signals)

import type { TokenData, DexScreenerPair, CreatorProfile } from './types.js';
import { readFileSync } from 'fs';

// ===== Configuration =====
// Nous Portal (free) — OAuth token → mint agent key → inference
const NOUS_AUTH_FILE = process.env.NOUS_AUTH_FILE || '/Users/limindong/.hermes/shared/nous_auth.json';
const NOUS_PORTAL_URL = process.env.NOUS_PORTAL_URL || 'https://portal.nousresearch.com';
const AI_MODEL = process.env.AI_ANALYZER_MODEL || 'arcee-ai/trinity-large-thinking';
const AI_BASE_URL = process.env.AI_ANALYZER_BASE_URL || 'https://inference-api.nousresearch.com/v1';

// Cached agent key (short-lived, re-minted on demand)
let cachedAgentKey: string | null = null;
let agentKeyExpiresAt = 0;

function getNousOAuthToken(): string | null {
  try {
    const raw = readFileSync(NOUS_AUTH_FILE, 'utf8');
    const auth = JSON.parse(raw);
    return auth.access_token || null;
  } catch {
    return null;
  }
}

async function mintNousAgentKey(): Promise<string | null> {
  const oauthToken = getNousOAuthToken();
  if (!oauthToken) return null;

  try {
    const res = await fetch(`${NOUS_PORTAL_URL}/api/oauth/agent-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${oauthToken}`,
      },
      body: JSON.stringify({ min_ttl_seconds: 3600 }), // 1 hour minimum
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[AI] Agent key mint failed ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const data = await res.json() as { api_key?: string; expires_at?: string };
    if (!data.api_key) {
      console.error('[AI] Agent key mint response missing api_key');
      return null;
    }

    cachedAgentKey = data.api_key;
    // Parse expiry or default to 50 minutes from now
    if (data.expires_at) {
      agentKeyExpiresAt = new Date(data.expires_at).getTime() - 5 * 60_000; // 5min buffer
    } else {
      agentKeyExpiresAt = Date.now() + 50 * 60_000;
    }
    console.log('[AI] Agent key minted successfully');
    return cachedAgentKey;
  } catch (err: any) {
    console.error('[AI] Agent key mint error:', err?.message || err);
    return null;
  }
}

async function getNousInferenceKey(): Promise<string | null> {
  // Return cached key if still valid
  if (cachedAgentKey && Date.now() < agentKeyExpiresAt) {
    return cachedAgentKey;
  }
  // Mint a new one
  return mintNousAgentKey();
}

// Fallback: OpenRouter if Nous unavailable
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim() || '';

const AI_ENABLED = process.env.AI_ANALYZER_DISABLED !== 'true';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MIN_SCORE_FOR_ANALYSIS = 40; // only analyze tokens that pass basic screening
const REQUEST_TIMEOUT_MS = 30_000;

// Rate limiting
const MAX_CONCURRENT = 2;
let inflight = 0;
const queue: Array<() => void> = [];

// Cache
interface CacheEntry {
  expiresAt: number;
  result: AIAnalysisResult;
}
const analysisCache = new Map<string, CacheEntry>();

// ===== Types =====
export interface AIAnalysisResult {
  adjustment: number;      // -15 to +15
  confidence: number;      // 0-1
  reasoning: string;
  flags: string[];         // risk flags like "SCAM_PATTERN", "FAKE_SOCIAL", etc.
  narrative: string;       // detected real narrative or "NONE"
  socialQuality: 'real' | 'mixed' | 'fake' | 'unknown';
  devRisk: 'clean' | 'suspicious' | 'serial_rugger' | 'unknown';
}

interface LLMResponse {
  adjustment: number;
  confidence: number;
  reasoning: string;
  flags: string[];
  narrative: string;
  social_quality: string;
  dev_risk: string;
}

// ===== Rate limiter =====
async function acquireSlot(): Promise<void> {
  if (inflight < MAX_CONCURRENT) {
    inflight++;
    return;
  }
  return new Promise<void>(resolve => {
    queue.push(() => {
      inflight++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  inflight--;
  if (queue.length > 0) {
    const next = queue.shift()!;
    next();
  }
}

// ===== Core analysis =====
function buildPrompt(
  token: TokenData,
  pair?: DexScreenerPair | null,
  creatorProfile?: CreatorProfile | null,
): string {
  const socials = pair?.info?.socials || [];
  const websites = pair?.info?.websites || [];
  const description = pair?.info?.description || '';

  const socialLinks = [
    ...socials.map(s => `${s.type}: ${s.url || 'N/A'}`),
    ...websites.map(w => `website: ${w.url}`),
  ].join('\n') || 'None';

  const ageHours = token.pairCreatedAt > 0
    ? ((Date.now() - token.pairCreatedAt) / 3_600_000).toFixed(1)
    : 'unknown';

  const creatorInfo = creatorProfile
    ? `Dev launched ${creatorProfile.totalLaunches} tokens, ${creatorProfile.suspectedRugs} suspected rugs (${(creatorProfile.rugRate * 100).toFixed(0)}% rug rate). Survived: ${creatorProfile.survived}.`
    : 'No dev history available.';

  // Narrative keywords currently detected (for the LLM to validate)
  const currentNarratives = detectCurrentNarratives(token.name, token.symbol);

  return `Analyze this Solana memecoin for scam risk and investment potential.

TOKEN DATA:
- Name: ${token.name}
- Symbol: ${token.symbol}
- Address: ${token.address}
- Chain: ${token.chainId}
- Age: ${ageHours} hours
- Market Cap: $${(token.marketCap || 0).toLocaleString()}
- Liquidity: $${(token.liquidityUsd || 0).toLocaleString()}
- Price change 1h: ${token.priceChange1h?.toFixed(1)}%
- Price change 5m: ${token.priceChange5m?.toFixed(1)}%
- Buy/Sell ratio 1h: ${token.buyToSellRatio1h?.toFixed(2)}x
- Top 10 holder %: ${token.top10HolderPct?.toFixed(1) || 'unknown'}
- LP creator %: ${token.lpCreatorPct?.toFixed(1) || 'unknown'}
- Mint authority revoked: ${token.mintAuthorityRevoked}
- Freeze authority revoked: ${token.freezeAuthorityRevoked}

SOCIAL LINKS:
${socialLinks}

TOKEN DESCRIPTION:
${description || '(none)'}

DEV HISTORY:
${creatorInfo}

CURRENT NARRATIVE DETECTION (rule-based):
${currentNarratives.length > 0 ? currentNarratives.join(', ') : 'None detected'}

ANALYZE AND RESPOND IN THIS EXACT JSON FORMAT (no markdown, no explanation outside JSON):
{
  "adjustment": <number from -15 to 15, positive means lower risk/higher potential>,
  "confidence": <0.0 to 1.0>,
  "reasoning": "<one paragraph explaining your analysis>",
  "flags": ["<UPPER_CASE_FLAG>", ...],
  "narrative": "<real narrative this token belongs to, or NONE>",
  "social_quality": "<real|mixed|fake|unknown>",
  "dev_risk": "<clean|suspicious|serial_rugger|unknown>"
}

KEY ANALYSIS POINTS:
1. Is the token name/symbol a genuine narrative (AI agent, RWA, etc.) or generic keyword stuffing (moon, rocket, safe)?
2. Is the description original or copied/template? Scam tokens often have no description or identical boilerplate.
3. Social links: are they real communities or just placeholder links? A Telegram group with 50K members but no activity = bots.
4. Dev history: serial rugger pattern (>3 launches, >50% rug rate) is a major red flag.
5. Tokenomics red flags: very high top10%, LP creator >50%, or mint not revoked = danger.
6. Narrative authenticity: does this token actually belong to a real crypto narrative, or is it name-squatting?
7. Consider ALL signals together — a token with mediocre social but excellent dev history and clean contract is fine.
8. For memecoins, some risk is expected. Don't over-penalize — focus on SCAM indicators, not volatility.`;
}

function detectCurrentNarratives(name: string, symbol: string): string[] {
  const text = `${name} ${symbol}`.toLowerCase();
  const narratives: string[] = [];
  const patterns: Record<string, RegExp[]> = {
    'AI/Agent': [/\b(ai|agent|llm|gpt|claude|deepseek|inference|gpu)\b/i],
    'Meme': [/\b(pepe|doge|shib|bonk|wojak|chad)\b/i],
    'DeFi': [/\b(swap|dex|yield|farm|staking|liquidity)\b/i],
    'Gaming': [/\b(game|gaming|play|p2e|metaverse)\b/i],
    'RWA': [/\b(rwa|real.?world|asset|tokeniz)\b/i],
    'DePIN': [/\b(depin|sensor|network|infrastructure)\b/i],
  };
  for (const [tag, pats] of Object.entries(patterns)) {
    if (pats.some(p => p.test(text))) narratives.push(tag);
  }
  return narratives;
}

async function callLLM(prompt: string): Promise<LLMResponse | null> {
  if (!AI_ENABLED) return null;

  // Try Nous first (free), fallback to OpenRouter
  const nousKey = await getNousInferenceKey();
  const apiKey = nousKey || OPENROUTER_API_KEY;
  const baseUrl = nousKey ? AI_BASE_URL : 'https://openrouter.ai/api/v1';
  const model = nousKey ? AI_MODEL : 'openrouter/owl-alpha';

  if (!apiKey) {
    console.error('[AI] No API key available (neither Nous token nor OpenRouter key)');
    return null;
  }

  await acquireSlot();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };
    // OpenRouter needs extra headers
    if (!nousKey) {
      headers['HTTP-Referer'] = 'https://tugoucatcher.local';
      headers['X-Title'] = 'TuGouCatcher AI Analyzer';
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a Solana memecoin scam analyst. Respond ONLY with valid JSON, no markdown fences, no explanation.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 2000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[AI] LLM API error ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string; reasoning?: string; reasoning_details?: Array<{ type: string; text: string }> } }>;
    };
    const msg = data.choices?.[0]?.message;
    // Thinking models put the actual response in reasoning/content
    // Try content first, then reasoning text, then reasoning_details
    let content = msg?.content?.trim();
    if (!content && msg?.reasoning) {
      // For thinking models, extract JSON from reasoning
      const reasoningMatch = msg.reasoning.match(/\{[\s\S]*\}/);
      if (reasoningMatch) content = reasoningMatch[0];
    }
    if (!content && msg?.reasoning_details) {
      for (const detail of msg.reasoning_details) {
        if (detail.text) {
          const match = detail.text.match(/\{[\s\S]*\}/);
          if (match) { content = match[0]; break; }
        }
      }
    }
    if (!content) {
      console.error('[AI] Empty LLM response (no content/reasoning)');
      return null;
    }

    // Parse JSON from response (handle potential markdown fences and truncation)
    let jsonStr = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    // Try to fix truncated JSON by finding the last complete field
    try {
      return JSON.parse(jsonStr) as LLMResponse;
    } catch {
      // Attempt to repair truncated JSON: find last complete key-value pair
      const lastBrace = jsonStr.lastIndexOf('}');
      if (lastBrace > 0) {
        const truncated = jsonStr.slice(0, lastBrace + 1);
        try { return JSON.parse(truncated) as LLMResponse; } catch {}
      }
      // Try to extract partial fields with regex as last resort
      const adj = jsonStr.match(/"adjustment"\s*:\s*(-?\d+)/);
      const conf = jsonStr.match(/"confidence"\s*:\s*([\d.]+)/);
      const reasoning = jsonStr.match(/"reasoning"\s*:\s*"([^"]*)"/);
      const socialQ = jsonStr.match(/"social_quality"\s*:\s*"(\w+)"/);
      const devR = jsonStr.match(/"dev_risk"\s*:\s*"(\w+)"/);
      if (adj) {
        console.warn('[AI] Recovered partial JSON from truncated response');
        return {
          adjustment: parseInt(adj[1]),
          confidence: conf ? parseFloat(conf[1]) : 0.5,
          reasoning: reasoning ? reasoning[1] : 'Partial analysis (truncated response)',
          flags: [],
          narrative: 'NONE',
          social_quality: socialQ ? socialQ[1] : 'unknown',
          dev_risk: devR ? devR[1] : 'unknown',
        } as LLMResponse;
      }
      console.error('[AI] Failed to parse LLM JSON:', jsonStr.slice(0, 200));
      return null;
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      console.error('[AI] LLM request timed out');
    } else {
      console.error('[AI] LLM call failed:', err?.message || err);
    }
    return null;
  } finally {
    releaseSlot();
  }
}

function normalizeResult(raw: LLMResponse | null): AIAnalysisResult {
  if (!raw) {
    return {
      adjustment: 0,
      confidence: 0,
      reasoning: 'AI analysis unavailable',
      flags: [],
      narrative: 'NONE',
      socialQuality: 'unknown',
      devRisk: 'unknown',
    };
  }

  return {
    adjustment: Math.max(-15, Math.min(15, Math.round(raw.adjustment || 0))),
    confidence: Math.max(0, Math.min(1, raw.confidence || 0)),
    reasoning: String(raw.reasoning || '').slice(0, 500),
    flags: Array.isArray(raw.flags) ? raw.flags.map(f => String(f).toUpperCase()).slice(0, 10) : [],
    narrative: String(raw.narrative || 'NONE').toUpperCase(),
    socialQuality: ['real', 'mixed', 'fake', 'unknown'].includes(raw.social_quality)
      ? raw.social_quality as AIAnalysisResult['socialQuality']
      : 'unknown',
    devRisk: ['clean', 'suspicious', 'serial_rugger', 'unknown'].includes(raw.dev_risk)
      ? raw.dev_risk as AIAnalysisResult['devRisk']
      : 'unknown',
  };
}

// ===== Public API =====

/**
 * Analyze a token using AI. Returns cached result if available.
 * Only processes tokens above MIN_SCORE_FOR_ANALYSIS threshold.
 * Returns null if AI is disabled or token doesn't qualify.
 */
export async function analyzeWithAI(
  token: TokenData,
  pair?: DexScreenerPair | null,
  creatorProfile?: CreatorProfile | null,
): Promise<AIAnalysisResult | null> {
  if (!AI_ENABLED) return null;
  if ((token.screeningScore ?? 0) < MIN_SCORE_FOR_ANALYSIS) return null;

  // Check cache
  const cached = analysisCache.get(token.address);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  // Build prompt and call LLM
  const prompt = buildPrompt(token, pair, creatorProfile);
  const raw = await callLLM(prompt);
  const result = normalizeResult(raw);

  // Cache result
  analysisCache.set(token.address, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    result,
  });

  if (result.flags.length > 0) {
    console.log(`[AI] ${token.symbol}: flags=${result.flags.join(',')} adj=${result.adjustment}`);
  }

  return result;
}

/**
 * Get score adjustment for the screener.
 * Returns adjustment and label for display.
 */
export function getAIScoreAdjustment(result: AIAnalysisResult | null): {
  adjustment: number;
  label: string;
} {
  if (!result || result.confidence < 0.3) {
    return { adjustment: 0, label: '' };
  }

  const adj = result.adjustment;
  const flagStr = result.flags.length > 0 ? ` [${result.flags.join(',')}]` : '';
  const confStr = `(${(result.confidence * 100).toFixed(0)}% conf)`;

  if (adj > 0) {
    return {
      adjustment: adj,
      label: `🤖 AI: ${result.reasoning.slice(0, 120)}${flagStr} ${confStr} (+${adj})`,
    };
  } else if (adj < 0) {
    return {
      adjustment: adj,
      label: `🤖 AI: ${result.reasoning.slice(0, 120)}${flagStr} ${confStr} (${adj})`,
    };
  }
  return { adjustment: 0, label: `🤖 AI: neutral${confStr}` };
}

/**
 * Cleanup expired cache entries.
 */
export function cleanupAICache(): void {
  const now = Date.now();
  for (const [addr, entry] of analysisCache) {
    if (entry.expiresAt < now) {
      analysisCache.delete(addr);
    }
  }
}

/**
 * Get cache stats for monitoring.
 */
export function getAICacheStats(): { size: number; enabled: boolean; model: string; provider: string } {
  const oauthToken = getNousOAuthToken();
  const hasValidKey = cachedAgentKey && Date.now() < agentKeyExpiresAt;
  return {
    size: analysisCache.size,
    enabled: AI_ENABLED,
    model: hasValidKey ? AI_MODEL : 'openrouter/owl-alpha',
    provider: hasValidKey ? 'nous (free)' : oauthToken ? 'nous (minting...)' : OPENROUTER_API_KEY ? 'openrouter' : 'none',
  };
}
