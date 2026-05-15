/**
 * OrkMap Puppeteer verification script
 * Usage: node verify-puppeteer.js
 */

const puppeteer = require('puppeteer');

const URL = 'http://localhost:5199';
const RESULTS = [];
let browser, page;

function pass(name, detail = '') {
  RESULTS.push({ name, status: 'PASS', detail });
  console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(name, detail = '') {
  RESULTS.push({ name, status: 'FAIL', detail });
  console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
}
function info(msg) { console.log(`         ${msg}`); }

async function screenshot(label) {
  const path = `/tmp/verify-fail-${label}-${Date.now()}.png`;
  await page.screenshot({ path, fullPage: false });
  info(`Screenshot saved: ${path}`);
  return path;
}

async function check(name, fn) {
  try {
    await fn();
  } catch (e) {
    fail(name, e.message);
    await screenshot(name.replace(/\s+/g, '_'));
  }
}

async function run() {
  console.log('\n=== OrkMap Puppeteer verification ===\n');

  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // ── 1. Page loads ────────────────────────────────────────────────────────
  const jsErrors = [];
  const consoleErrors = [];
  const failedRequests = [];

  page = await browser.newPage();
  page.on('pageerror', err => jsErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', req => {
    failedRequests.push(`${req.failure().errorText} — ${req.url()}`);
  });
  page.on('response', resp => {
    const status = resp.status();
    const url = resp.url();
    if ((status >= 400) && !url.includes('favicon')) {
      failedRequests.push(`HTTP ${status} — ${url}`);
    }
  });

  await check('Page loads (networkidle0)', async () => {
    const t0 = Date.now();
    const resp = await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (!resp || resp.status() >= 400) throw new Error(`HTTP ${resp ? resp.status() : 'no response'}`);
    pass('Page loads (networkidle0)', `${elapsed}s`);
  });

  // ── 2. Main content visible ───────────────────────────────────────────────
  await check('Main content visible (not blank)', async () => {
    const bodyText = await page.evaluate(() => document.body.innerText.trim());
    if (!bodyText || bodyText.length < 10) throw new Error('Body appears blank');
    pass('Main content visible (not blank)', `${bodyText.length} chars`);
  });

  // ── 3. "Mes concerts" title visible ──────────────────────────────────────
  await check('Title "Mes concerts" visible', async () => {
    // Wait a moment for React to render
    await page.waitForFunction(
      () => document.body.innerText.includes('Mes concerts') || document.body.innerText.includes('concerts'),
      { timeout: 5000 }
    );
    const found = await page.evaluate(() => document.body.innerText.includes('Mes concerts'));
    if (!found) throw new Error('"Mes concerts" text not found');
    pass('Title "Mes concerts" visible');
  });

  // ── 4. Demo concert "Programme Francesconi" visible ───────────────────────
  await check('Demo concert "Programme Francesconi" visible', async () => {
    const found = await page.evaluate(() =>
      document.body.innerText.includes('Programme Francesconi')
    );
    if (!found) throw new Error('"Programme Francesconi" not found');
    pass('Demo concert "Programme Francesconi" visible');
  });

  // ── 5. Archive (📦) and delete (✕) buttons present ───────────────────────
  await check('Archive (📦) and delete (✕) buttons present', async () => {
    const text = await page.evaluate(() => document.body.innerHTML);
    const hasArchive = text.includes('📦') || text.includes('archiv') || text.includes('Archiver');
    const hasDelete = text.includes('✕') || text.includes('×') || text.includes('supprimer') || text.includes('Supprimer');
    const issues = [];
    if (!hasArchive) issues.push('no archive button');
    if (!hasDelete) issues.push('no delete button');
    if (issues.length) throw new Error(issues.join(', '));
    pass('Archive (📦) and delete (✕) buttons present');
  });

  // ── 6. Click concert → list of pieces ─────────────────────────────────────
  await check('Click concert opens piece list', async () => {
    // Find and click the concert card (not the action buttons)
    const clicked = await page.evaluate(() => {
      // Try to find a clickable concert title or card
      const allElements = Array.from(document.querySelectorAll('*'));
      const concertEl = allElements.find(el =>
        el.innerText && el.innerText.includes('Programme Francesconi') &&
        el.children.length < 5 // prefer leaf-ish elements
      );
      if (concertEl) {
        concertEl.click();
        return true;
      }
      return false;
    });
    if (!clicked) throw new Error('Could not find concert element to click');

    // Wait for piece list to appear
    await page.waitForFunction(
      () => {
        const txt = document.body.innerText;
        return txt.includes('ETYMO') || txt.includes('Daedalus') || txt.includes('Moskow') || txt.includes('pièce') || txt.includes('Pieces');
      },
      { timeout: 5000 }
    );
    pass('Click concert opens piece list');
  });

  // ── 7. Navigate concert → piece → back ────────────────────────────────────
  await check('Navigation: concert → piece → back', async () => {
    // Ensure we are on the concert (piece list) screen. If we see 'ETYMO' we are already there.
    // Otherwise re-click the concert.
    const alreadyOnPieceList = await page.evaluate(() => document.body.innerText.includes('ETYMO'));
    if (!alreadyOnPieceList) {
      info('Not on piece list — re-navigating to concert...');
      // Click the concert title (more targeted — find smallest element containing only the title)
      const clicked = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let node;
        while ((node = walker.nextNode())) {
          const t = (node.innerText || '').trim();
          if (t === 'Programme Francesconi' || t.startsWith('Programme Francesconi')) {
            node.click();
            return true;
          }
        }
        return false;
      });
      if (!clicked) throw new Error('Could not click concert to navigate to piece list');
      await page.waitForFunction(
        () => document.body.innerText.includes('ETYMO'),
        { timeout: 6000 }
      );
    }

    // Now click the "ETYMO" piece — find smallest element whose text is exactly or starts with ETYMO
    const pieceClicked = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let candidates = [];
      let node;
      while ((node = walker.nextNode())) {
        const t = (node.innerText || '').trim();
        if (t === 'ETYMO') { candidates.push({ el: node, len: t.length }); }
      }
      // Prefer smallest innerText length (most targeted element)
      candidates.sort((a, b) => a.len - b.len);
      if (candidates.length) { candidates[0].el.click(); return true; }
      // Fallback: any element containing ETYMO but not BODY/HTML
      const all = Array.from(document.querySelectorAll('*')).filter(
        el => el.innerText && el.innerText.includes('ETYMO') && !['BODY','HTML','DIV'].includes(el.tagName) === false
          ? true : el.innerText && el.innerText.includes('ETYMO')
      );
      if (all.length) { all[all.length - 1].click(); return true; }
      return false;
    });
    if (!pieceClicked) throw new Error('Could not click piece "ETYMO"');
    info('Clicked piece ETYMO');

    // Verify piece screen loaded
    await page.waitForFunction(
      () => {
        const txt = document.body.innerText;
        return txt.includes('Percu') || txt.includes('Vibraphone') || txt.includes('Marimba');
      },
      { timeout: 6000 }
    );
    info('Piece screen loaded (Percu/Vibraphone visible)');

    // Now go back — look for a back button (←, ‹, or text "retour")
    const backClicked = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        const t = (node.innerText || '').trim();
        if (t === '←' || t === '‹' || t === '⬅' || t === '◀' || t === '❮') {
          node.click();
          return 'arrow';
        }
        if (t.toLowerCase() === 'retour' || t.toLowerCase() === 'back') {
          node.click();
          return 'text';
        }
      }
      const btn = document.querySelector('[data-back], .back-btn, button[aria-label*="back"], button[aria-label*="retour"]');
      if (btn) { btn.click(); return 'attr'; }
      return null;
    });

    if (!backClicked) {
      info('No back button found — using browser back');
      await page.goBack();
    } else {
      info(`Back button clicked (type: ${backClicked})`);
    }

    await new Promise(r => setTimeout(r, 1200));
    const backText = await page.evaluate(() => document.body.innerText);
    // After going back from piece, we should see the concert piece list (ETYMO still visible) or concerts list
    const onExpectedScreen = backText.includes('ETYMO') || backText.includes('Daedalus') || backText.includes('Francesconi') || backText.includes('Mes concerts');
    if (!onExpectedScreen) throw new Error('Back navigation did not return to expected screen');
    pass('Navigation: concert → piece → back');
  });

  // ── 8. Mobile viewport (375px) — no horizontal overflow ──────────────────
  await check('Mobile viewport 375px — no horizontal overflow', async () => {
    await page.setViewport({ width: 375, height: 812, isMobile: true, deviceScaleFactor: 2 });
    // Reload to test from scratch at mobile size
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await page.waitForFunction(() => document.body.innerText.length > 10, { timeout: 5000 });

    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    if (overflow) {
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      throw new Error(`Horizontal overflow detected: scrollWidth=${scrollWidth} > clientWidth=${clientWidth}`);
    }
    pass('Mobile viewport 375px — no horizontal overflow');
  });

  // ── 9. Mobile content readable ────────────────────────────────────────────
  await check('Mobile: "Mes concerts" visible at 375px', async () => {
    const found = await page.evaluate(() => document.body.innerText.includes('Mes concerts'));
    if (!found) throw new Error('"Mes concerts" not visible on mobile');
    pass('Mobile: "Mes concerts" visible at 375px');
  });

  // ── 10. Broken images ──────────────────────────────────────────────────────
  await check('No broken images', async () => {
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    const broken = await page.evaluate(() => {
      return Array.from(document.images)
        .filter(img => img.naturalWidth === 0 && img.src && !img.src.startsWith('data:'))
        .map(img => img.src);
    });
    if (broken.length > 0) throw new Error(`Broken images: ${broken.join(', ')}`);
    pass('No broken images', `${(await page.evaluate(() => document.images.length))} images OK`);
  });

  // ── 11. JS errors ─────────────────────────────────────────────────────────
  if (jsErrors.length === 0) {
    pass('No JS page errors');
  } else {
    fail('No JS page errors', jsErrors.slice(0, 3).join(' | '));
  }

  // ── 12. Console errors ────────────────────────────────────────────────────
  const filteredConsole = consoleErrors.filter(e =>
    !e.includes('favicon') && !e.includes('ERR_FILE_NOT_FOUND') && !e.includes('net::ERR_ABORTED')
  );
  if (filteredConsole.length === 0) {
    pass('No console errors');
  } else {
    fail('No console errors', filteredConsole.slice(0, 3).join(' | '));
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS SUMMARY');
  console.log('='.repeat(60));
  const passed = RESULTS.filter(r => r.status === 'PASS').length;
  const failed = RESULTS.filter(r => r.status === 'FAIL').length;
  console.log(`\n  PASSED: ${passed}/${RESULTS.length}`);
  if (failed > 0) {
    console.log(`  FAILED: ${failed}/${RESULTS.length}`);
    console.log('\n  Failures:');
    RESULTS.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`    - ${r.name}: ${r.detail}`);
    });
  }
  console.log('');

  await browser.close();
  return failed;
}

run().then(failed => {
  if (failed === 0) console.log('All checks passed.\n');
  process.exit(failed > 0 ? 1 : 0);
}).catch(async err => {
  console.error('Fatal error:', err);
  if (browser) await browser.close();
  process.exit(2);
});
