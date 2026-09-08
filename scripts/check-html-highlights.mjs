#!/usr/bin/env node
// Publish scripts/fixtures/html-highlights.html, then pass its review URL here.
// Uses mocked feedback in an isolated browser; no annotations are saved to the server.
import { execFileSync } from 'node:child_process';
const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) throw new Error('Pass the HTML highlight fixture review URL');
const session = `html-highlights-${process.pid}`;
const cli = (...args) => {
 const output = execFileSync('playwright-cli', [`-s=${session}`, ...args], {encoding:'utf8'});
 if (output.includes('### Error')) throw new Error(output);
 return output;
};
const check = async page => {
 await page.route('**/feedback', async route => {
  const response = await route.fetch();
  const state = await response.json();
  state.annotations = [{id:'highlight-regression',type:'text',selectedText:'A persistent HTML annotation',prefix:'',suffix:'',body:'Test annotation',createdAt:'2026-09-08T00:00:00Z'}];
  await route.fulfill({response,json:state});
 });
 await page.reload();
 const frame = page.frameLocator('iframe');
 await frame.locator('#annotated').waitFor();
 const assertHighlight = async (phase) => {
  try {
  await page.waitForFunction(() => {
   const doc = document.querySelector('iframe')?.contentDocument;
   const highlight = doc?.defaultView.CSS.highlights.get('live-word-annotations');
   return highlight && [...highlight].some(range => range.startContainer.isConnected && range.toString()==='A persistent HTML annotation');
  }, null, {timeout:3000});
  } catch { throw new Error(`Highlight missing after ${phase}`); }
 };
 await assertHighlight('initial load');
 // Same-sized replacement: ResizeObserver alone cannot detect this.
 await frame.locator('#annotated').evaluate(el => el.replaceWith(el.cloneNode(true)));
 await assertHighlight('same-sized node replacement');
 await frame.locator('#annotated').evaluate(el => el.firstChild.data = 'Other tab');
 await page.waitForFunction(() => {
  const doc = document.querySelector('iframe').contentDocument;
  return !doc.defaultView.CSS.highlights.has('live-word-annotations');
 }, null, {timeout:3000});
 await frame.locator('#annotated').evaluate(el => el.firstChild.data = 'A persistent HTML annotation');
 await assertHighlight('text restoration');
 // Replacing the body must not orphan the mutation observer.
 await frame.locator('body').evaluate(el => el.replaceWith(el.cloneNode(true)));
 await assertHighlight('body replacement');
 await page.reload();
 await assertHighlight('reload');
};
try {
 cli('open',url);
 cli('run-code',check.toString());
 console.log('PASS: highlights recover after node, text and body replacement, and reload');
} catch(error) { console.error(error.message);process.exitCode=1; }
finally {try {cli('close');}catch{}}
