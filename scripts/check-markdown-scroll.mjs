#!/usr/bin/env node
// Usage: node scripts/check-markdown-scroll.mjs <long-Markdown-review-URL>
// Uses the Playwright CLI and a separate browser session; does not touch user tabs.
import { execFileSync } from 'node:child_process';

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) throw new Error('Pass a long Markdown review URL');
const session = `markdown-scroll-${process.pid}`;
const cli = (...args) => execFileSync('npx', ['--yes', '--package', '@playwright/cli', 'playwright-cli', `-s=${session}`, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const check = async page => {
 await page.locator('.md-content').first().waitFor();
 for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  await page.setViewportSize(viewport);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => window.scrollY);
  const hasOverflow = await page.evaluate(() => document.body.scrollHeight > window.innerHeight);
  if (!hasOverflow) throw new Error('Use a Markdown review longer than one screen');
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.mouse.wheel(0, 700);
  await page.waitForFunction(start => window.scrollY > start + 100, before, { timeout: 3000 });
 }
 // Real touch gestures exercise touch-action and scroll locks on mobile as well.
 const mobile = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
 try {
  const touchPage = await mobile.newPage();
  await touchPage.goto(page.url());
  await touchPage.locator('.md-content').first().waitFor();
  const cdp = await mobile.newCDPSession(touchPage);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 650 }] });
  for (let y = 620; y >= 250; y -= 30) {
   await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y }] });
   await touchPage.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touchPage.waitForFunction(() => window.scrollY > 100, null, { timeout: 3000 });
 } finally { await mobile.close(); }
};
try {
 cli('open', url);
 cli('run-code', check.toString());
 console.log('PASS: Markdown scrolls with mouse wheels and mobile touch gestures');
} catch (cause) {
 console.error(cause.stdout?.toString() || cause.message);
 process.exitCode = 1;
} finally { try { cli('close'); } catch {} }
