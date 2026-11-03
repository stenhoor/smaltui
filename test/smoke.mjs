// Post-deploy smoke test: loads a deployed smaltui site in headless Chromium and fails if the demo does not run.
//
//   node test/smoke.mjs https://stenhoor.github.io/smaltui/      (the Pages workflow runs this after each deploy)
//
// A green deploy does not prove the site works (smaltui#7: every file returned 200, yet the demo failed), so this
// checks what a visitor sees: the landing console runs its first query, and the workbench builds the demo
// environment without an error. Retries a few times, since a fresh deploy can take a minute to reach the CDN.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = (process.argv[2] ?? '').replace(/\/?$/, '/');
if (!/^https?:\/\//.test(base)) {
  console.error('usage: node test/smoke.mjs <site url>');
  process.exit(2);
}
const attempts = Number(process.env.SMOKE_ATTEMPTS ?? 5);
const delayMs = Number(process.env.SMOKE_DELAY_MS ?? 30000);

// The smalt brand is applied: brand tokens are loaded and exactly one header logo shows (light, dark and compact
// versions are switched by CSS, so a missing or stale stylesheet shows several).
async function checkBrand(page, where) {
  const b = await page.evaluate(() => ({
    primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    logos: [...document.querySelectorAll('.brand img')].filter((i) => i.offsetParent !== null).map((i) => i.src.split('/').pop()),
  }));
  if (!b.primary) throw new Error(`${where}: brand tokens not loaded (no --primary)`);
  if (b.logos.length !== 1) throw new Error(`${where}: ${b.logos.length} header logos visible (${b.logos.join(', ') || 'none'})`);
  return b;
}

async function check(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    // Landing page: the live console loads the demo and runs its first example.
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => /rows? in|could not/i.test(document.querySelector('#consoleStatus')?.textContent ?? ''), null, { timeout: 45000 });
    const landing = (await page.locator('#consoleStatus').textContent()).trim();
    if (!/rows? in/.test(landing)) throw new Error(`landing console: ${landing}`);
    if (!(await page.locator('#gridHost tbody tr[data-row]').count())) throw new Error('landing console: no rows shown');
    await checkBrand(page, 'landing');

    // Workbench: the demo environment builds without an error popup.
    await page.goto(base + 'workbench/?env=envs/demo/env.json', { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('.toast.ok, .toast.err'), null, { timeout: 45000 });
    const errs = await page.evaluate(() => [...document.querySelectorAll('.toast.err')].map((t) => t.textContent.trim()));
    if (errs.length) throw new Error(`workbench demo: ${errs.join(' | ')}`);
    await checkBrand(page, 'workbench');
    const engine = await page.locator('#stEngine').textContent();
    if (/vendor copy missing/.test(engine)) throw new Error(`workbench engine: ${engine} (the built site is not what is being served)`);
    if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
    return `landing: "${landing}"; workbench: demo loaded; engine: ${engine.trim()}`;
  } finally {
    await ctx.close();
  }
}

const browser = await chromium.launch();
let last;
try {
  for (let i = 1; i <= attempts; i++) {
    try {
      console.log(`smoke ${base} (attempt ${i}/${attempts}): ok — ${await check(browser)}`);
      process.exitCode = 0;
      break;
    } catch (e) {
      last = e;
      console.log(`smoke ${base} (attempt ${i}/${attempts}): ${e.message.split('\n')[0]}`);
      process.exitCode = 1;
      if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
} finally {
  await browser.close();
}
if (process.exitCode) console.error(`smoke test failed: ${last?.message}`);
