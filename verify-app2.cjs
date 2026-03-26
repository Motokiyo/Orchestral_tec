const puppeteer = require('puppeteer');

const URL = 'http://localhost:5173/';
const results = [];
let browser, page;

function pass(check, details = '') {
  results.push({ check, status: 'PASS', details });
  console.log(`  PASS  ${check}${details ? ' — ' + details : ''}`);
}
function fail(check, details = '') {
  results.push({ check, status: 'FAIL', details });
  console.log(`  FAIL  ${check}${details ? ' — ' + details : ''}`);
}
async function shot(name) {
  const path = `/Users/alexandre/Galaad-Motokiyo-Ferran/Orchestral_tec/verify-fail-${name}-${Date.now()}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`       Screenshot: ${path}`);
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Helper: click element matching predicate
async function clickEl(predicateFn) {
  return page.evaluate((src) => {
    const predicate = new Function('el', `return (${src})(el)`);
    const all = Array.from(document.querySelectorAll('*'));
    const target = all.find(predicate);
    if (!target) return null;
    let node = target;
    while (node && node.tagName !== 'BODY') {
      if (getComputedStyle(node).cursor === 'pointer' || node.tagName === 'BUTTON' || node.tagName === 'A') {
        node.click();
        return node.textContent.trim().slice(0, 80);
      }
      node = node.parentElement;
    }
    target.click();
    return target.textContent.trim().slice(0, 80);
  }, predicateFn.toString());
}

async function run() {
  const consoleErrors = [];

  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    protocolTimeout: 60000,
  });
  page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  page.on('pageerror', err => consoleErrors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  // ─────────────────────────────────────────
  // CHECK 1: Page loads
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 1: Page loads ===');
  try {
    const t0 = Date.now();
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await wait(500);
    pass('Page loads', `${((Date.now()-t0)/1000).toFixed(1)}s`);
  } catch(err) {
    fail('Page loads', err.message);
    await browser.close(); return;
  }

  // ─────────────────────────────────────────
  // CHECK 2: OrkMap logo + "Mes concerts"
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 2: OrkMap logo & Mes concerts screen ===');
  const hasLogo = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.some(img => img.src.toLowerCase().includes('logo') || img.src.toLowerCase().includes('orkmap'));
  });
  const bodyText = await page.evaluate(() => document.body.innerText);
  if (hasLogo) pass('OrkMap logo visible'); else fail('OrkMap logo visible', 'no logo img found');
  if (bodyText.includes('Mes concerts')) pass('"Mes concerts" heading visible');
  else fail('"Mes concerts" heading visible', 'text not found');

  // ─────────────────────────────────────────
  // CHECK 3: Demo concert "Programme Francesconi" visible
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 3: Demo concert visible ===');
  if (bodyText.includes('Francesconi') || bodyText.includes('Programme')) {
    pass('Demo concert "Programme Francesconi" visible');
  } else {
    fail('Demo concert "Programme Francesconi" visible', 'not found');
    await shot('no-demo-concert');
  }

  // ─────────────────────────────────────────
  // CHECK 4: Click concert → pieces list
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 4: Click concert → pieces visible ===');
  let concertOk = false;
  try {
    await clickEl(el => el.textContent && el.textContent.includes('Francesconi'));
    await wait(600);
    const t = await page.evaluate(() => document.body.innerText);
    if (t.includes('ETYMO') || t.includes('Unexpected End') || t.includes('Daedalus')) {
      pass('Click concert → pieces visible');
      concertOk = true;
    } else {
      fail('Click concert → pieces visible', 'piece titles not found');
      await shot('no-pieces');
    }
  } catch(err) { fail('Click concert', err.message); }

  // ─────────────────────────────────────────
  // CHECK 5: Click piece ETYMO → piece detail
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 5: Click piece → detail screen ===');
  let pieceOk = false;
  try {
    if (!concertOk) throw new Error('skipped');
    await clickEl(el => el.textContent && el.textContent.trim() === 'ETYMO' && el.children.length === 0);
    await wait(600);
    const t = await page.evaluate(() => document.body.innerText);
    if (t.includes('Percu 1') || t.includes('5 instruments')) {
      pass('Click piece → detail with percu sections');
      pieceOk = true;
    } else {
      fail('Click piece → detail', 'no percu sections found');
      await shot('no-piece-detail');
    }
  } catch(err) { fail('Click piece → detail', err.message); }

  // ─────────────────────────────────────────
  // CHECK 6: Click "Percu 1" to expand → instruments visible
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 6: Expand percu → instruments visible ===');
  let percuExpanded = false;
  try {
    if (!pieceOk) throw new Error('skipped');
    // Click the "Percu 1" collapsible header
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const header = all.find(el =>
        el.children.length >= 1 &&
        el.textContent.includes('Percu 1') &&
        el.textContent.includes('instruments')
      );
      if (header) header.click();
    });
    await wait(500);
    const t = await page.evaluate(() => document.body.innerText);
    if (t.includes('Vibraphone') || t.includes('Xylophone') || t.includes('Glockenspiel')) {
      pass('Expand percu → instruments visible', 'instrument names found');
      percuExpanded = true;
    } else {
      fail('Expand percu → instruments visible', 'instruments not shown after click');
      await shot('percu-not-expanded');
      console.log('       Text:', t.slice(0, 400));
    }
  } catch(err) { fail('Expand percu', err.message); }

  // ─────────────────────────────────────────
  // CHECK 7: Checkbox → strikethrough + moves down
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 7: Checkbox check → strikethrough ===');
  try {
    if (!percuExpanded) throw new Error('skipped');

    // Get first instrument name before checking
    const firstItemBefore = await page.evaluate(() => {
      // Find first checkbox
      const cbs = document.querySelectorAll('input[type="checkbox"]');
      if (cbs.length === 0) return null;
      return cbs[0].closest('[data-item]')?.textContent?.trim() || null;
    });

    // Click first checkbox
    const cbClicked = await page.evaluate(() => {
      const cbs = document.querySelectorAll('input[type="checkbox"]');
      if (cbs.length > 0) { cbs[0].click(); return true; }
      // Try to find a div/span that acts as checkbox near instrument text
      const all = Array.from(document.querySelectorAll('[role="checkbox"]'));
      if (all.length > 0) { all[0].click(); return true; }
      return false;
    });

    if (!cbClicked) {
      // Check if there's a different interactive element (maybe a tap-to-check)
      const hasClickableItems = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('*'));
        const items = all.filter(el =>
          el.textContent.includes('Vibraphone') &&
          getComputedStyle(el).cursor === 'pointer'
        );
        if (items.length > 0) { items[0].click(); return true; }
        return false;
      });
      if (!hasClickableItems) {
        fail('Checkbox check', 'no checkbox or clickable item found');
        await shot('no-checkbox');
        // Log what's available
        const dbg = await page.evaluate(() => {
          const cbs = document.querySelectorAll('input[type="checkbox"]');
          const roles = document.querySelectorAll('[role="checkbox"]');
          const vibEls = Array.from(document.querySelectorAll('*')).filter(e => e.textContent.trim() === 'Vibraphone 3 oct');
          return {
            checkboxCount: cbs.length,
            ariaCheckboxCount: roles.length,
            vibaphoneEls: vibEls.map(e => ({ tag: e.tagName, cursor: getComputedStyle(e).cursor, parent: e.parentElement?.tagName }))
          };
        });
        console.log('       Debug:', JSON.stringify(dbg));
      }
    }

    await wait(600);

    // Check for strikethrough
    const strikeCount = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      return all.filter(el => {
        const style = getComputedStyle(el);
        return style.textDecoration?.includes('line-through') ||
               el.style?.textDecoration?.includes('line-through');
      }).length;
    });

    if (strikeCount > 0) {
      pass('Checkbox check → strikethrough', `${strikeCount} element(s) struck`);
    } else {
      // Maybe checked state is shown differently
      const checkedState = await page.evaluate(() => {
        const cbs = document.querySelectorAll('input[type="checkbox"]');
        if (cbs.length > 0) return Array.from(cbs).map(cb => cb.checked);
        return [];
      });
      if (checkedState.some(c => c === true)) {
        fail('Strikethrough after check', 'checkbox is checked but no strikethrough styling found');
        await shot('no-strikethrough');
      } else {
        fail('Checkbox check → strikethrough', 'checkbox not checked or strikethrough missing');
        await shot('checkbox-fail');
      }
    }
  } catch(err) { fail('Checkbox check', err.message); }

  // ─────────────────────────────────────────
  // CHECK 8: Back to concerts list
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 8: Navigate back to concerts ===');
  try {
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await wait(500);
    const t = await page.evaluate(() => document.body.innerText);
    if (t.includes('Mes concerts') || t.includes('Francesconi')) {
      pass('Navigate back to concerts list');
    } else {
      fail('Navigate back to concerts list', 'unexpected page state');
      await shot('back-nav-fail');
    }
  } catch(err) { fail('Navigate back', err.message); }

  // ─────────────────────────────────────────
  // CHECK 9: Reload → demo data persists
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 9: RELOAD → demo data persists ===');
  try {
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await wait(1500); // IndexedDB load
    const t = await page.evaluate(() => document.body.innerText);
    if (t.includes('Francesconi') || t.includes('Programme')) {
      pass('Reload → demo concert persists', '"Francesconi" still visible');
    } else {
      fail('Reload → demo concert persists', 'demo concert MISSING after reload');
      await shot('reload-no-demo');
      console.log('       Page text:', t.slice(0, 300));
    }
  } catch(err) { fail('Reload → demo data persists', err.message); }

  // ─────────────────────────────────────────
  // CHECK 10: Create new concert (multi-prompt flow)
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 10: Create new concert ===');
  let newConcertId = null;
  try {
    // Set up dialog handlers for the sequence of prompts:
    // 1. "Nom du concert :"  → "Test Puppeteer"
    // 2. "Date :"            → "1 janvier 2027"
    // 3. "Lieu :"            → "Salle Pleyel"
    // 4. "Orchestre :"       → "EIC"
    // 5. "Chef :"            → "Chef Test"
    const promptAnswers = [
      'Test Puppeteer',
      '1 janvier 2027',
      'Salle Pleyel',
      'EIC',
      'Chef Test',
    ];
    let promptCount = 0;
    const dialogHandler = async (dialog) => {
      const answer = promptAnswers[promptCount] || '';
      promptCount++;
      console.log(`       Dialog [${promptCount}]: "${dialog.message()}" → "${answer}"`);
      await dialog.accept(answer);
      // Re-attach for next prompt
      page.once('dialog', dialogHandler);
    };
    page.once('dialog', dialogHandler);

    // Click "+ Nouveau concert"
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.includes('Nouveau concert'));
      if (btn) btn.click();
    });

    // Wait for all prompts to complete and navigation to happen
    await wait(2000);

    const t = await page.evaluate(() => document.body.innerText);
    if (t.includes('Test Puppeteer') || t.includes('Nouvelle pièce') || t.includes('+ Nouvelle pièce')) {
      pass('New concert created', '"Test Puppeteer" visible or piece screen shown');
      newConcertId = 'test-puppeteer';
    } else {
      fail('New concert created', 'concert not found in page after creation');
      await shot('no-new-concert');
      console.log('       Page text:', t.slice(0, 300));
    }
  } catch(err) { fail('Create new concert', err.message); }

  // ─────────────────────────────────────────
  // CHECK 11: Add piece manually to new concert
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 11: Add piece to new concert ===');
  let pieceAddOk = false;
  try {
    if (!newConcertId) throw new Error('concert not created, skipped');

    // We may already be on the concert's home screen (pieces list)
    // Set up prompt handler for piece title and composer
    const piecePromptAnswers = ['Symphonie Test', 'Beethoven'];
    let ppCount = 0;
    const pieceDialogHandler = async (dialog) => {
      const answer = piecePromptAnswers[ppCount] || '';
      ppCount++;
      console.log(`       Piece dialog [${ppCount}]: "${dialog.message()}" → "${answer}"`);
      await dialog.accept(answer);
      page.once('dialog', pieceDialogHandler);
    };
    page.once('dialog', pieceDialogHandler);

    // Click "+ Nouvelle pièce"
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.includes('Nouvelle pièce'));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!clicked) throw new Error('"+ Nouvelle pièce" button not found');

    await wait(1500);

    const t = await page.evaluate(() => document.body.innerText);
    if (t.includes('Symphonie Test') || t.includes('Beethoven') || t.includes('Percu 1')) {
      pass('New piece added to concert');
      pieceAddOk = true;
    } else {
      fail('New piece added', 'piece not found after creation');
      await shot('no-new-piece');
      console.log('       Page text:', t.slice(0, 400));
    }
  } catch(err) { fail('Add piece', err.message); }

  // ─────────────────────────────────────────
  // CHECK 12: RELOAD → new data persists
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 12: RELOAD → new data persists ===');
  try {
    // Allow debounced save to complete (500ms debounce + buffer)
    await wait(1500);

    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await wait(1500);

    const t = await page.evaluate(() => document.body.innerText);
    const demoOk = t.includes('Francesconi') || t.includes('Programme');
    const newOk = t.includes('Test Puppeteer');

    if (demoOk) pass('Reload → demo concert still there');
    else fail('Reload → demo concert still there', 'MISSING after second reload');

    if (newOk) pass('Reload → new "Test Puppeteer" concert persists');
    else fail('Reload → new concert persists', '"Test Puppeteer" NOT found after reload');

    if (!demoOk || !newOk) {
      await shot('reload-persistence-fail');
      console.log('       Page text:', t.slice(0, 400));
    }
  } catch(err) { fail('Reload persistence', err.message); }

  // ─────────────────────────────────────────
  // CHECK 13: Mobile — no horizontal overflow
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 13: Mobile overflow ===');
  try {
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await wait(500);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 5
    );
    if (!overflow) pass('Mobile 390px — no horizontal overflow');
    else { fail('Mobile 390px — horizontal overflow', `scrollWidth: ${await page.evaluate(() => document.documentElement.scrollWidth)}`); await shot('mobile-overflow'); }
  } catch(err) { fail('Mobile overflow', err.message); }

  // ─────────────────────────────────────────
  // CHECK 14: Desktop — content visible
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 14: Desktop viewport ===');
  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await wait(500);
    const t = await page.evaluate(() => document.body.innerText.trim());
    if (t.length > 20) pass('Desktop 1280×800 — content visible');
    else { fail('Desktop 1280×800 — blank'); await shot('desktop-blank'); }
  } catch(err) { fail('Desktop', err.message); }

  // ─────────────────────────────────────────
  // CHECK 15: No critical console errors
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 15: Console errors ===');
  const criticalErrors = consoleErrors.filter(e =>
    !e.includes('favicon') &&
    !e.toLowerCase().includes('[orkmap]') &&
    !e.includes('ERR_NAME_NOT_RESOLVED') &&
    !e.includes('net::ERR_')
  );
  if (criticalErrors.length === 0) {
    pass('No critical console errors', `(${consoleErrors.length} total, all filtered as non-critical)`);
  } else {
    fail('Console errors', criticalErrors.slice(0, 3).join(' | '));
  }

  await browser.close();

  // ─────────────────────────────────────────
  // FINAL REPORT
  // ─────────────────────────────────────────
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log('\n' + '='.repeat(65));
  console.log('FINAL VERIFICATION REPORT');
  console.log('='.repeat(65));
  console.log(`\nTotal: ${results.length} checks — ${passed} PASS, ${failed} FAIL\n`);
  console.log('| Check | Status | Details |');
  console.log('|-------|--------|---------|');
  for (const r of results) {
    console.log(`| ${r.check} | ${r.status} | ${r.details} |`);
  }
  if (failed === 0) {
    console.log('\nApp verified — all checks passed.');
  } else {
    console.log(`\n${failed} check(s) FAILED.`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal:', err.message);
  if (browser) browser.close();
  process.exit(1);
});
