'use strict';
require('dotenv').config();

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

class AveAiCollector {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async login() {
    const email = process.env.AVEAI_EMAIL;
    const password = process.env.AVEAI_PASSWORD;
    const loginUrl = process.env.AVEAI_LOGIN_URL || 'https://ave.ai/login';
    if (!email || !password) throw new Error('AveAi credentials not set. Please set AVEAI_EMAIL and AVEAI_PASSWORD in env.');

    this.browser = await chromium.launch({ headless: true });
    const context = await this.browser.newContext({ viewport: { width: 1280, height: 800 } });
    this.page = await context.newPage();
    await this.page.goto(loginUrl, { waitUntil: 'networkidle' });

    const tryFill = async (sel, value) => {
      try {
        await this.page.fill(sel, value);
        return true;
      } catch {
        return false;
      }
    };

    if (!(await tryFill('input[name="email"]', email))) {
      await this.page.fill('input[type="email"]', email);
    }
    if (!(await tryFill('input[name="password"]', password))) {
      await this.page.fill('input[type="password"]', password);
    }

    const loginBtn = await this.page.$('button:has-text("Log In"), button:has-text("Sign In"), button[type="submit"]');
    if (loginBtn) await loginBtn.click();
    else {
      await this.page.keyboard.press('Enter');
    }

    // Wait for a dashboard element
    await this.page.waitForSelector('#dashboard, [data-testid="dashboard"]', { timeout: 60000 }).catch(async () => {
      await this.page.waitForSelector('[data-testid="metrics-widget"]', { timeout: 60000 });
    });
  }

  async navigateToMetrics() {
    const page = this.page;
    const metricsUrl = process.env.AVEAI_METRICS_URL;
    if (metricsUrl) {
      await page.goto(metricsUrl, { waitUntil: 'networkidle' });
      return;
    }
    const candidates = [
      'a[href*="/metrics"]',
      'a[href*="metrics"]',
      'button:has-text("Metrics")',
      '[data-testid="metrics-link"]'
    ];
    for (const sel of candidates) {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await page.waitForLoadState('networkidle');
        return;
      }
    }
    throw new Error('Metrics page not found via known selectors.');
  }

  async extractMetrics() {
    const page = this.page;
    const data = {
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().slice(0, 10),
      totalVisitors: 0,
      pageViews: 0,
      conversions: 0,
      conversionRate: 0
    };

    const readNum = async (selectors) => {
      for (const s of selectors) {
        try {
          const v = await page.$eval(s, el => {
            const t = (el && el.innerText) ? el.innerText : '';
            const n = parseFloat(t.replace(/[^0-9.]/g, ''));
            return Number.isFinite(n) ? n : null;
          });
          if (typeof v === 'number') return v;
        } catch { /* ignore */ }
      }
      return null;
    };

    data.totalVisitors = (await readNum(['span[data-testid="total-visitors"]', '#total-visitors', '.visitors-count'])) ?? 0;
    data.pageViews = (await readNum(['span[data-testid="page-views"]', '#page-views', '.views-count'])) ?? 0;
    data.conversions = (await readNum(['span[data-testid="conversions"]', '#conversions', '.conversions-count'])) ?? 0;

    if (data.totalVisitors > 0) data.conversionRate = data.conversions / data.totalVisitors;
    else data.conversionRate = 0;

    try {
      const rev = await page.$eval('[data-testid="revenue"]', el => {
        const t = el.innerText;
        const n = parseFloat(t.replace(/[^0-9.]/g, ''));
        return Number.isFinite(n) ? n : null;
      });
      if (typeof rev === 'number' && Number.isFinite(rev)) data.revenue = rev;
    } catch {
      // ignore
    }

    return data;
  }

  async export(metrics, outDir = './aveai-output') {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `aveai-metrics-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(metrics, null, 2));
    return file;
  }

  async close() {
    if (this.browser) await this.browser.close();
  }
}

async function runCollector() {
  const c = new AveAiCollector();
  await c.login();
  await c.navigateToMetrics();
  const m = await c.extractMetrics();
  const f = await c.export(m);
  await c.close();
  return f;
}

module.exports = { AveAiCollector, runCollector };
