// ===== Shared Narrative Keyword Patterns =====
// Single source of truth for narrative detection used by both
// screener.ts (inline scoring) and narrative.ts (sector tracking).
// v2: Supports dynamic patterns auto-extracted from DexScreener trending.

/**
 * Master narrative keyword map (static).
 * Keys are narrative names, values are uppercase keywords.
 * When adding a new narrative, add it here — both screener and
 * narrative tracker will pick it up automatically.
 */
export const NARRATIVE_PATTERNS: Record<string, string[]> = {
  'AI':        ['AI', 'GPT', 'AGENT', 'NEURAL', 'BRAIN', 'INTEL', 'SENTIENT', 'LLM', 'OPENAI', 'CLAUDE'],
  'Political': ['TRUMP', 'BIDEN', 'MAGA', 'VOTE', 'ELECTION', 'PRESIDENT', 'GOV', 'CONGRESS'],
  'Meme':      ['PEPE', 'DOGE', 'SHIB', 'BONK', 'WIF', 'FROG', 'MOON', 'BASED', 'CHAD', 'WOJAK'],
  'Celebrity': ['ELON', 'MUSK', 'DRAKE', 'KANYE', 'TAYLOR', 'SNOOP'],
  'DeFi':      ['DEFI', 'SWAP', 'YIELD', 'STAKE', 'FARM', 'PROTOCOL', 'LEND', 'VAULT'],
  'Gaming':    ['GAME', 'PLAY', 'QUEST', 'NFT', 'PIXEL', 'ARENA', 'WORLD'],
  'Dog':       ['DOG', 'DOGE', 'SHIB', 'WOOF', 'PUP', 'PAWS', 'BARK', 'INU'],
  'Cat':       ['CAT', 'KITTY', 'MEOW', 'NYAN', 'KITTEN', 'PURR', 'POPCAT'],
};

// ===== Dynamic patterns (auto-extracted from trending data) =====
interface DynamicPattern {
  keywords: string[];
  addedAt: number;
  lastSeenAt: number;
  source: string; // e.g. 'dexscreener-trending'
}

const dynamicPatterns = new Map<string, DynamicPattern>();
const DYNAMIC_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MIN_CLUSTER_SIZE = 3; // need 3+ tokens with same keyword to form a narrative

// Common words to exclude from dynamic extraction
const STOP_WORDS = new Set([
  'THE', 'OF', 'AND', 'TO', 'IN', 'FOR', 'ON', 'WITH', 'AT', 'BY',
  'COIN', 'TOKEN', 'TOKENS', 'CRYPTO', 'MEME', 'MEMES', 'DEFI',
  'SOL', 'SOLANA', 'PUMP', 'MOON', 'MOONSHOT', 'DIP', 'BUY', 'SELL',
  'SWAP', 'DEX', 'EXCHANGE', 'LP', 'FARM', 'YIELD', 'STAKE',
  'BEST', 'TOP', 'NEW', 'NEXT', '100X', '1000X', '10X', 'GEM',
  'RUG', 'SAFE', 'SCAM', 'LEGIT', 'REAL', 'FAKE',
  'ELON', 'MUSK', 'TRUMP', 'PEPE', 'DOGE', 'SHIB', 'BONK',
]);

/**
 * Detect which narrative tags apply to a token based on name/symbol.
 * Checks both static and dynamic patterns.
 */
export function detectNarrativeTags(name: string, symbol: string): string[] {
  const text = (name + ' ' + symbol).toUpperCase();
  const tags: string[] = [];

  // Static patterns
  for (const [narrative, keywords] of Object.entries(NARRATIVE_PATTERNS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        tags.push(narrative);
        break;
      }
    }
  }

  // Dynamic patterns
  for (const [narrative, pattern] of dynamicPatterns) {
    for (const keyword of pattern.keywords) {
      if (text.includes(keyword)) {
        tags.push(narrative);
        pattern.lastSeenAt = Date.now();
        break;
      }
    }
  }

  return tags;
}

/**
 * Extract common keywords from a batch of trending token names/symbols.
 * Identifies clusters of tokens sharing keywords — these become dynamic narratives.
 * Returns the extracted keywords grouped by potential narrative name.
 */
export function extractTrendingKeywords(
  tokens: Array<{ name: string; symbol: string }>,
): Map<string, string[]> {
  const keywordCounts = new Map<string, number>();

  for (const token of tokens) {
    const text = (token.name + ' ' + token.symbol).toUpperCase();
    // Extract potential keywords (2+ chars, not stop words)
    const words = text.match(/[A-Z]{2,}/g) || [];

    const seen = new Set<string>(); // avoid counting same word twice per token
    for (const word of words) {
      if (STOP_WORDS.has(word)) continue;
      if (word.length < 3) continue; // skip very short words
      if (seen.has(word)) continue;
      seen.add(word);
      keywordCounts.set(word, (keywordCounts.get(word) || 0) + 1);
    }
  }

  // Filter to keywords that appear in 3+ tokens
  const clusters = new Map<string, string[]>();
  for (const [keyword, count] of keywordCounts) {
    if (count >= MIN_CLUSTER_SIZE) {
      // Use keyword as narrative name
      const narrativeName = `${keyword} Trend`;
      clusters.set(narrativeName, [keyword]);
    }
  }

  return clusters;
}

/**
 * Update dynamic patterns from trending data.
 * Called after each discovery cycle with the latest trending tokens.
 */
export function updateDynamicPatterns(
  tokens: Array<{ name: string; symbol: string }>,
): { added: string[]; removed: string[] } {
  const now = Date.now();
  const added: string[] = [];
  const removed: string[] = [];

  // Extract new clusters
  const newClusters = extractTrendingKeywords(tokens);

  // Add new patterns
  for (const [narrative, keywords] of newClusters) {
    if (!dynamicPatterns.has(narrative)) {
      dynamicPatterns.set(narrative, {
        keywords,
        addedAt: now,
        lastSeenAt: now,
        source: 'dexscreener-trending',
      });
      added.push(narrative);
      console.log(`[NarrativePatterns] 🆕 Dynamic narrative detected: "${narrative}" (keywords: ${keywords.join(', ')})`);
    } else {
      // Update last seen
      const existing = dynamicPatterns.get(narrative)!;
      existing.lastSeenAt = now;
    }
  }

  // Cleanup stale patterns
  for (const [narrative, pattern] of dynamicPatterns) {
    if (now - pattern.lastSeenAt > DYNAMIC_TTL_MS) {
      dynamicPatterns.delete(narrative);
      removed.push(narrative);
      console.log(`[NarrativePatterns] 🗑️ Expired dynamic narrative: "${narrative}"`);
    }
  }

  return { added, removed };
}

/**
 * Get all current dynamic patterns (for debugging/display).
 */
export function getDynamicPatterns(): Array<{ name: string; keywords: string[]; age: string }> {
  const now = Date.now();
  return Array.from(dynamicPatterns.entries()).map(([name, pattern]) => ({
    name,
    keywords: pattern.keywords,
    age: `${Math.floor((now - pattern.addedAt) / 3_600_000)}h`,
  }));
}

/**
 * Get total pattern count (static + dynamic).
 */
export function getTotalPatternCount(): number {
  return Object.keys(NARRATIVE_PATTERNS).length + dynamicPatterns.size;
}
