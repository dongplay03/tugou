# Ave.ai Playwright Collector

This minimal Playwright-based scraper logs into Ave.ai, navigates to the metrics dashboard, extracts key metrics, and exports them as JSON for ingestion into downstream pipelines.

What you get:
- A self-contained Node.js project under tools/aveai-collector
- A login flow with credentials sourced from environment variables
- Flexible selectors for metrics (with reasonable fallbacks)
- Output JSON files in aveai-output/

Usage
- Copy tools/aveai-collector/.env.example to .env and fill in AVEAI_EMAIL, AVEAI_PASSWORD, and optional URLs.
- Install Playwright and dependencies in the subfolder:
  cd tools/aveai-collector
  npm install
- Run collection: node index.js

Notes
- The selectors used are resilient fallbacks. If Ave.ai changes its DOM, you may need to adjust them.
- For production, consider adding a robust retry/backoff, error reporting, and an explicit schema for output.
