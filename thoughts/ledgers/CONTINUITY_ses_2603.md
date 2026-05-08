---
session: ses_2603
updated: 2026-04-18T08:55:16.527Z
---

# Session Summary

## Goal
Advance the integration of a dev rug probability signal into the 16-factor strategy scoring, enabling risk-adjusted token screening without changing frontend API contracts.

## Constraints & Preferences
- Technical requirements and patterns: refer to existing Screener/Monitor data flow; avoid breaking API contracts; fold new risk signal into scoring rather than adding new endpoints.
- Use exact file paths and function names when describing sources or touchpoints.
- Focus on concrete, actionable steps and traceable data flow.
- (none) for any additional preferences beyond the constraints above.

## Progress

### Done
- [x] Located the core strategy scoring and data flow
  - backend/src/screener.ts
    - screenToken(token: TokenData, weights: StrategyWeights, extras?: ScreeningExtras): ScreeningResult
    - Uses a wide set of factors and scoring paths, including:
      - Honeypot (getHoneypotScoreAdjustment)
      - Narrative hard gate (isNarrativeBlocked, getNarrativeCorrelationAdjustment)
      - Core factors: contractSafety, liquidityDepth, volumeRatio, mcLpRatio, top10HolderPct, buyPressure, momentum, freshness
      - Advanced signals: social.ts, creator.ts, narrative correlation (getNarrativeCorrelationAdjustment), time-window.ts, volume-anomaly.ts
  - backend/src/monitor.ts
    - startMonitoring, stopMonitoring
    - runDiscovery
    - collectScreeningExtras
    - buildAssessedToken (used to attach screening results to TokenData via screenToken)
    - applyExtrasToToken
  - backend/src/narrative.ts
    - updateNarrativeTracking, recordNarrativeRug, getActiveNarrativeCount, getNarrativeStates
    - isNarrativeBlocked, getNarrativeCorrelationAdjustment
  - backend/src/index.ts
    - Entry point that loads environment and calls startServer
  - backend/src/types.ts
    - Shared types used across tokens, narratives, authority/holders, etc.
  - frontend/src/components/DashboardPage.tsx
    - Renders overall dashboard, including risk-related panels and tokens overview
  - frontend/src/components/StrategyInsightsPanel.tsx
    - Renders current strategy weights and narrative bonus matrix; shows recent optimization logs
- [x] Verified frontend risk-metrics rendering points
  - StrategyInsightsPanel.tsx pulls from currentWeights and narrativeBonus to present risk posture
  - DashboardPage.tsx wires risk and status state into the UI
- [x] Confirmed backend entrypoint for token evaluation and the data-flow path
  - Entry point: /Users/dongmac/project/tugoucatcher/backend/src/index.ts
  - Token evaluation path: pair -> tokenData -> collectScreeningExtras -> screenToken -> tokenData.screeningScore
- [x] Confirmed creator/dev related checks exist and are used in scoring
  - backend/src/creator.ts (analyzeCreator, getCreatorScoreAdjustment)
  - Screener.ts imports getCreatorScoreAdjustment and applies it in the scoring
- [x] Confirmed API response types and frontend rendering targets
  - TokenData fields exposed via tokens/eligible endpoints and WebSocket paths
  - Frontend renders risk signals via StrategyInsightsPanel and TokenDiscovery via DashboardPage
- [x] No file modifications were made yet (Modified: none)

### In Progress
- [ ] Planning/in-progress patch to introduce a new dev rug probability signal (will be implemented by integrating a new module into Screener)

### Blocked
- (none)

## Key Decisions
- **Integrate dev rug probability into Screener scoring rather than exposing a separate API field**: Keeps the frontend contract stable (no API changes) and leverages the existing screening flow to penalize tokens with dev rug risk consistently. Rationale: minimizes churn and uses existing TokenData.screeningScore and screeningPassed/Failed traces to reflect risk adjustments.

## Next Steps
1. Implement new module: backend/src/dev-rug-prob.ts
   - Export function: getDevRugProbabilityAdjustment(token: TokenData, creatorProfile?: CreatorProfile | null): { adjustment: number; label: string }
   - Heuristic: base on token.creatorAddress, token.creatorRugCount, token.creatorSurvivalCount, and optional creatorProfile data
2. Wire the new metric into Screener
   - In backend/src/screener.ts:
     - Import: import { getDevRugProbabilityAdjustment } from './dev-rug-prob.js';
     - Call within screenToken, and apply the adjustment to score, pushing an explanatory label into passed/failed arrays as appropriate
   - Location for insertion: after the existing creator-related signals (or immediately after the narrative-related signals, depending on how you want to weight it vs other signals)
3. Validate data flow
   - Ensure tokenData fields used by the new metric exist and can be fed CreatorProfile if available
   - Confirm that token evaluation path (monitor.ts: buildAssessedToken -> screenToken) captures and surfaces the adjusted score to the frontend
4. Run local tests
   - Unit test the new function with representative TokenData (rug history high/low, no rug history, etc.)
   - End-to-end test by running the app in dev mode and observing changes to token screening scores in the UI
5. Document in code comments and update any developer notes
   - Briefly annotate the new module and insertion point
   - Optionally add a short README note describing the new signal and how weights can be tuned

## Critical Context
- Data and signals involved today:
  - Core 16-factor scoring path in Screener: screenToken(token, weights, extras)
  - Token evaluation path through Monitor: buildAssessedToken(pair, weights, momentumConfirmed)
  - On-chain checks and creator analyses are wired via collectScreeningExtras into screenToken
  - Existing dev/creator checks live in backend/src/creator.ts and are used by Screener
- Frontend risk surfaces:
  - Contextual risk weights are displayed via StrategyInsightsPanel and dashboards in DashboardPage
  - Token risk/eligibility is exposed via REST/WebSocket channels to frontend (no API changes expected for the new signal)

## File Operations
### Read
- /Users/dongmac/project/tugoucatcher/backend/src/index.ts
- /Users/dongmac/project/tugoucatcher/backend/src/monitor.ts
- /Users/dongmac/project/tugoucatcher/backend/src/narrative.ts
- /Users/dongmac/project/tugoucatcher/backend/src/screener.ts
- /Users/dongmac/project/tugoucatcher/backend/src/types.ts
- /Users/dongmac/project/tugoucatcher/frontend/src/components/DashboardPage.tsx
- /Users/dongmac/project/tugoucatcher/frontend/src/components/StrategyInsightsPanel.tsx

### Modified
- (none)


