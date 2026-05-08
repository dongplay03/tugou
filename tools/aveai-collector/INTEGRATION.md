Ave.ai Playwright Collector - Integration Plan

Overview
- Collects key metrics from Ave.ai by logging in, navigating to the metrics dashboard, and exporting data as JSON for downstream pipelines.
- Output is placed in aveai-output/ with a timestamped filename: aveai-metrics-TIMESTAMP.json

Data flow
- Ave.ai -> Playwright collector (tools/aveai-collector/index.js) -> local storage (aveai-output/) -> downstream ETL/warehouse

Integration steps
- Configure credentials and endpoints via a .env file (AVEAI_EMAIL, AVEAI_PASSWORD, AVEAI_LOGIN_URL, AVEAI_METRICS_URL).
- Run: node index.js to perform a single scrape.
- For automated collection, schedule via CI/CD (Github Actions, GitLab CI, or similar) or a cron job.
- Ingest into a warehouse (e.g., Snowflake, Redshift) via a small ETL script:
  - Read new aveai-metrics-*.json files
  - Validate schema: { timestamp, date, totalVisitors, pageViews, conversions, conversionRate, revenue? }
  - Append to a daily metrics table or a streaming pipeline

Scheduling patterns
- Daily at 02:00 local time (UTC+0 example):
  - Cron: 0 2 * * *
- Or run every 6 hours depending on data freshness requirements

Reliability considerations
- Implement retries with exponential backoff on login/metrics fetch failures
- Capture and log errors to a central system (e.g., Slack, Sentry)
- Ensure idempotency for ingestion by writing timestamped files and deduplicating in the warehouse

Security and secrets
- Prefer storing credentials in a secrets manager or Vault and injecting at runtime
- Do not commit credentials to version control

Validation and monitoring
- Validate output format with a lightweight schema check
- Health checks: ensure last run produced a file within the last N hours
- Alert if runs fail or data age exceeds threshold

Next steps (optional)
- Add a small API endpoint to fetch latest metrics from a secured internal service
- Extend to collect more metrics (e.g., revenue by product, cohort analysis)
