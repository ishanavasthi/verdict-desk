#!/usr/bin/env node
/**
 * Headless-browser smoke test: login -> docket renders -> open MCQ problem
 * -> submit -> assert the friendly "Passed" verdict.
 *
 * Browser resolution:
 *  - If SMOKE_BROWSER_PATH is set, launch that executable via playwright-core.
 *  - Otherwise, launch the default @playwright chromium (CI installs it via
 *    `npx playwright install --with-deps chromium`).
 *
 * Hard-capped at ~90s total. On any failure: exit non-zero with a clear
 * message and a failure screenshot saved to the CWD.
 */

import { setTimeout as sleep } from 'node:timers/promises';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const BROWSER_PATH = process.env.SMOKE_BROWSER_PATH || null;
const TOTAL_BUDGET_MS = 90_000;
const SCREENSHOT_PATH = new URL('./smoke-failure.png', `file://${process.cwd()}/`).pathname;

const startedAt = Date.now();
function remainingMs() {
  return Math.max(1000, TOTAL_BUDGET_MS - (Date.now() - startedAt));
}

async function resolveChromium() {
  if (BROWSER_PATH) {
    // Prefer a locally-installed playwright-core (root devDependency);
    // fall back to whatever's in the npx cache if that ever changes.
    const { chromium } = await import('playwright-core');
    return chromium;
  }
  const { chromium } = await import('playwright-core');
  return chromium;
}

let page = null;
let browser = null;

async function fail(step, err) {
  console.error(`\n[ci-browser-smoke] FAILED at step: ${step}`);
  console.error(err?.stack || err);
  if (page) {
    try {
      await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
      console.error(`[ci-browser-smoke] saved failure screenshot to ${SCREENSHOT_PATH}`);
    } catch (screenshotErr) {
      console.error('[ci-browser-smoke] could not save failure screenshot:', screenshotErr?.message || screenshotErr);
    }
  }
  if (browser) {
    try {
      await browser.close();
    } catch {
      // best-effort cleanup
    }
  }
  process.exit(1);
}

async function main() {
  const chromium = await resolveChromium();

  const launchOptions = { headless: true };
  if (BROWSER_PATH) {
    launchOptions.executablePath = BROWSER_PATH;
  }
  browser = await chromium.launch(launchOptions);
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(20_000);

  // Step 1: login
  try {
    // networkidle here (not on the post-login nav below) so React has
    // hydrated and attached the form's onSubmit handler before we click —
    // clicking too early falls through to a native full-page form submit.
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: remainingMs() });
    await page.fill('#email', 'student@verdict.dev');
    await page.fill('#password', 'password');
    await page.click('button[type="submit"]');
    // Next <Link>/router.push is a client nav — wait for the URL, not networkidle.
    await page.waitForURL(`${BASE_URL}/`, { timeout: remainingMs() });
  } catch (err) {
    return fail('login', err);
  }

  // Step 2: docket renders — at least one problem row and one MCQ kind badge
  try {
    await page.waitForSelector('a[href^="/problems/"]', { timeout: remainingMs() });
    const problemRows = await page.locator('a[href^="/problems/"]').count();
    if (problemRows < 1) throw new Error('expected >= 1 problem row on the docket, found 0');

    const mcqBadgeCount = await page.getByText('MCQ', { exact: true }).count();
    if (mcqBadgeCount < 1) throw new Error('expected at least one MCQ kind badge on the docket, found 0');
  } catch (err) {
    return fail('docket renders', err);
  }

  // Step 3: open the 'Docker Network Isolation' problem
  try {
    await page.getByRole('link', { name: /Docker Network Isolation/i }).click();
    await page.waitForURL(/\/problems\/[^/]+$/, { timeout: remainingMs() });
    await page.waitForSelector('text=Choose one', { timeout: remainingMs() });
  } catch (err) {
    return fail("open 'Docker Network Isolation' problem", err);
  }

  // Step 4: select the '--network none' option and submit
  try {
    const option = page.locator('label', { hasText: '--network none' }).first();
    await option.locator('input[type="radio"]').check();
    await page.getByRole('button', { name: /^Submit$/ }).click();
  } catch (err) {
    return fail("select '--network none' and submit", err);
  }

  // Step 5: assert the friendly 'Passed' verdict appears
  try {
    await page.waitForSelector('.verdict-stamp:has-text("Passed")', { timeout: remainingMs() });
  } catch (err) {
    return fail("assert 'Passed' verdict", err);
  }

  console.log('[ci-browser-smoke] OK — login -> docket -> MCQ submit -> Passed verdict');
  await browser.close();
  process.exit(0);
}

const guard = sleep(TOTAL_BUDGET_MS + 5000).then(() => {
  throw new Error(`smoke test exceeded ${TOTAL_BUDGET_MS}ms budget`);
});

Promise.race([main(), guard]).catch((err) => fail('overall timeout', err));
