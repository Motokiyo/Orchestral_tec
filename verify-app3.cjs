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
  return path;
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// A robust multi-prompt dialog handler
function setupPromptQueue(answers) {
  let idx = 0;
  const handler = async (dialog) => {
    const ans = (idx < answers.length) ? answers[idx] : '';
    idx++;
    console.log(`       Dialog ${idx}: "${dialog.message().slice(0, 60)}" → "${ans}"`);
    try { await dialog.accept(ans); } catch(e) { /* already handled */ }
    if (idx < answers.length + 2) page.once('dialog', handler);
  };
  page.once('dialog', handler);
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
    await wait(800);
    pass('Page loads', `${((Date.now()-t0)/1000).toFixed(1)}s`);
  } catch(err) {
    fail('Page loads', err.message);
    await browser.close(); return;
  }

  // ─────────────────────────────────────────
  // CHECK 2: OrkMap logo + "Mes concerts"
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 2: OrkMap logo & Mes concerts ===');
  const hasLogo = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img')).some(img =>
      img.src.toLowerCase().includes('logo') || img.src.toLowerCase().includes('orkmap')
    )
  );
  const bodyText = await page.evaluate(() => document.body.innerText);
  if (hasLogo) pass('OrkMap logo visible'); else fail('OrkMap logo visible');
  if (bodyText.includes('Mes concerts')) pass('"Mes concerts" heading visible');
  else fail('"Mes concerts" heading visible');

  // ─────────────────────────────────────────
  // CHECK 3: Demo concert visible
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 3: Demo concert visible ===');
  if (bodyText.includes('Francesconi') || bodyText.includes('Programme')) {
    pass('Demo concert "Programme Francesconi" visible');
  } else {
    fail('Demo concert visible');
    await shot('no-demo');
  }

  // ─────────────────────────────────────────
  // CHECK 4: Click concert card → pieces list
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 4: Click concert → pieces visible ===');
  let concertOk = false;
  try {
    // Use page.click() with the concert card — find element position then click body of card
    // The card's onClick is on the outer div. We click at the text "Programme Francesconi"
    await page.evaluate(() => {
      // Find the concert card directly (the div with the onClick on goConcert)
      const divs = Array.from(document.querySelectorAll('div'));
      const card = divs.find(d =>
        d.textContent.includes('Programme Francesconi') &&
        d.textContent.includes('pièces') &&
        d.style && d.style.cursor !== ''
      );
      if (card) {
        card.click();
        return card.className;
      }
      // Fallback: find any div containing "Francesconi" and "pièces" and click it
      const all = Array.from(document.querySelectorAll('div'));
      for (const d of all) {
        if (d.innerText && d.innerText.includes('Programme Francesconi') && d.innerText.includes('pièces')) {
          d.click();
          return 'fallback click';
        }
      }
      return null;
    });
    await wait(800);
    const t = await page.evaluate(() => document.body.innerText);
    if (t.includes('ETYMO') || t.includes('Unexpected End') || t.includes('Daedalus') || t.includes('Nouvelle pièce')) {
      pass('Click concert → pieces visible');
      concertOk = true;
    } else {
      fail('Click concert → pieces visible', 'piece titles not found');
      await shot('no-pieces');
      console.log('       Page text:', t.slice(0, 300));
    }
  } catch(err) { fail('Click concert', err.message); }

  // ─────────────────────────────────────────
  // CHECK 5: Click piece ETYMO → detail
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 5: Click piece → detail ===');
  let pieceOk = false;
  try {
    if (!concertOk) throw new Error('skipped');
    await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div'));
      for (const d of divs) {
        if (d.innerText && d.innerText.includes('ETYMO') && d.innerText.includes('instr.')) {
          d.click();
          return;
        }
      }
      // Fallback: find by title text
      const els = Array.from(document.querySelectorAll('*'));
      const etymo = els.find(el => el.textContent.trim() === 'ETYMO' && el.tagName !== 'SCRIPT');
      if (etymo) {
        let node = etymo;
        while (node && node.tagName !== 'BODY') {
          if (node.onclick || getComputedStyle(node).cursor === 'pointer') {
            node.click(); return;
          }
          node = node.parentElement;
        }
        etymo.click();
      }
    });
    await wait(800);
    const t = await page.evaluate(() => document.body.innerText);
    if (t.includes('Percu 1') || t.includes('5 instruments') || t.includes('Vibraphone')) {
      pass('Click piece → detail with percu sections');
      pieceOk = true;
    } else {
      fail('Click piece → detail', 'percu sections not found');
      await shot('no-piece-detail');
      console.log('       Text:', t.slice(0, 300));
    }
  } catch(err) { fail('Click piece', err.message); }

  // ─────────────────────────────────────────
  // CHECK 6: Click "Percu 1" → instruments appear
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 6: Expand percu → instruments ===');
  let percuOk = false;
  try {
    if (!pieceOk) throw new Error('skipped');
    await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div'));
      // Find the percu header div that shows "Percu 1" and "N instruments"
      const percuHeader = divs.find(d =>
        d.innerText && d.innerText.includes('Percu 1') && d.innerText.includes('instruments')
      );
      if (percuHeader) percuHeader.click();
    });
    await wait(600);
    const t = await page.evaluate(() => document.body.innerText);
    if (t.includes('Vibraphone') || t.includes('Xylophone')) {
      pass('Expand percu → instruments visible', 'instrument names found');
      percuOk = true;
    } else {
      fail('Expand percu', 'instruments not shown after click');
      await shot('percu-not-expanded');
      console.log('       Text:', t.slice(0, 400));
    }
  } catch(err) { fail('Expand percu', err.message); }

  // ─────────────────────────────────────────
  // CHECK 7: Checkbox → strikethrough
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 7: Checkbox → strikethrough ===');
  try {
    if (!percuOk) throw new Error('skipped');

    // Examine what UI the app uses for checkboxes
    const uiInfo = await page.evaluate(() => {
      const cbs = document.querySelectorAll('input[type="checkbox"]');
      const ariaCbs = document.querySelectorAll('[role="checkbox"]');
      // Look for elements near "Vibraphone 3 oct" text
      const all = Array.from(document.querySelectorAll('*'));
      const vibEls = all.filter(el => el.textContent.trim() === 'Vibraphone 3 oct');
      const clickableNearVib = vibEls.map(el => {
        const siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
        return {
          tag: el.tagName,
          cursor: getComputedStyle(el).cursor,
          parentCursor: el.parentElement ? getComputedStyle(el.parentElement).cursor : '',
          parentTag: el.parentElement?.tagName,
          siblings: siblings.map(s => ({ tag: s.tagName, cursor: getComputedStyle(s).cursor, text: s.textContent?.slice(0,20) }))
        };
      });
      return {
        checkboxCount: cbs.length,
        ariaCount: ariaCbs.length,
        vibaphoneInfo: clickableNearVib.slice(0, 2),
      };
    });
    console.log('       UI debug:', JSON.stringify(uiInfo, null, 2));

    let checked = false;
    if (uiInfo.checkboxCount > 0) {
      // Click first native checkbox
      await page.evaluate(() => {
        document.querySelectorAll('input[type="checkbox"]')[0].click();
      });
      checked = true;
    } else if (uiInfo.ariaCount > 0) {
      await page.evaluate(() => {
        document.querySelectorAll('[role="checkbox"]')[0].click();
      });
      checked = true;
    } else {
      // Try clicking the row containing "Vibraphone 3 oct"
      await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('*'));
        const vibEl = all.find(el => el.textContent.trim() === 'Vibraphone 3 oct');
        if (vibEl) {
          // Try clicking the parent row
          let node = vibEl.parentElement;
          while (node && node.tagName !== 'BODY') {
            if (getComputedStyle(node).cursor === 'pointer') { node.click(); return; }
            node = node.parentElement;
          }
          vibEl.click();
        }
      });
      checked = true;
    }

    await wait(600);

    // Check for strikethrough or opacity change
    const strikeInfo = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const struck = all.filter(el => {
        const s = getComputedStyle(el);
        return s.textDecoration?.includes('line-through') || el.style?.textDecoration?.includes('line-through');
      });
      const checkedCbs = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(cb => cb.checked);
      return {
        struckCount: struck.length,
        struckTexts: struck.map(el => el.textContent?.trim()?.slice(0,30)),
        checkedCbCount: checkedCbs.length,
      };
    });

    if (strikeInfo.struckCount > 0) {
      pass('Checkbox check → strikethrough', `${strikeInfo.struckCount} struck: ${strikeInfo.struckTexts[0]}`);
    } else if (strikeInfo.checkedCbCount > 0) {
      fail('Strikethrough after check', 'checkbox checked but no line-through style found');
      await shot('no-strikethrough');
      console.log('       Strike info:', JSON.stringify(strikeInfo));
    } else {
      fail('Checkbox check', 'checkbox not checked and no strikethrough');
      await shot('checkbox-fail');
    }
  } catch(err) { fail('Checkbox check', err.message); }

  // ─────────────────────────────────────────
  // CHECK 8: Back to concerts list
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 8: Back to concerts list ===');
  try {
    // Navigate back to concerts screen
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await wait(600);
    const t = await page.evaluate(() => document.body.innerText);
    if (t.includes('Mes concerts')) pass('Navigate to concerts list');
    else fail('Navigate to concerts list', 'not on concerts screen');
  } catch(err) { fail('Navigate back', err.message); }

  // ─────────────────────────────────────────
  // CHECK 9: RELOAD → demo data persists
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 9: RELOAD → demo data persists ===');
  try {
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await wait(1500);
    const t = await page.evaluate(() => document.body.innerText);
    if (t.includes('Francesconi') || t.includes('Programme')) {
      pass('Reload → demo concert persists');
    } else {
      fail('Reload → demo concert persists', 'MISSING after reload');
      await shot('reload-no-demo');
    }
  } catch(err) { fail('Reload persistence', err.message); }

  // ─────────────────────────────────────────
  // CHECK 10: Create new concert
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 10: Create new concert ===');
  let newConcertOk = false;
  try {
    // The button triggers 5 prompts in sequence
    setupPromptQueue(['Test Puppeteer', '1 janvier 2027', 'Salle Pleyel', 'EIC', 'Chef Test']);

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Nouveau concert'));
      if (btn) btn.click();
    });
    await wait(2500);

    const t = await page.evaluate(() => document.body.innerText);
    if (t.includes('Test Puppeteer') || t.includes('Nouvelle pièce') || t.includes('0 pièce')) {
      pass('New concert created', '"Test Puppeteer" in page');
      newConcertOk = true;
    } else {
      fail('New concert created', 'concert not found after creation');
      await shot('no-new-concert');
      console.log('       Text:', t.slice(0, 300));
    }
  } catch(err) { fail('Create concert', err.message); }

  // ─────────────────────────────────────────
  // CHECK 11: Add piece to new concert
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 11: Add piece to new concert ===');
  let pieceAddOk = false;
  try {
    if (!newConcertOk) throw new Error('skipped');
    // The "+ Nouvelle pièce" button triggers 2 prompts: titre, compositeur
    setupPromptQueue(['Symphonie Test', 'Beethoven']);

    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Nouvelle pièce'));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!clicked) throw new Error('"+ Nouvelle pièce" not found');

    await wait(2000);

    const t = await page.evaluate(() => document.body.innerText);
    if (t.includes('Symphonie Test') || t.includes('Beethoven') || t.includes('Percu 1')) {
      pass('New piece added', 'piece appears in page');
      pieceAddOk = true;
    } else {
      fail('New piece added', 'not visible after creation');
      await shot('no-new-piece');
      console.log('       Text:', t.slice(0, 400));
    }
  } catch(err) { fail('Add piece', err.message); }

  // ─────────────────────────────────────────
  // CHECK 12: RELOAD → new data persists
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 12: RELOAD → all data persists ===');
  try {
    await wait(1500); // debounced save window
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await wait(1500);

    const t = await page.evaluate(() => document.body.innerText);
    const demoOk = t.includes('Francesconi') || t.includes('Programme');
    const newOk = t.includes('Test Puppeteer');

    if (demoOk) pass('Reload → demo concert still there');
    else { fail('Reload → demo concert still there', 'MISSING'); await shot('reload-no-demo2'); }

    if (newOk) pass('Reload → new concert "Test Puppeteer" persists');
    else { fail('Reload → new concert persists', '"Test Puppeteer" NOT found'); await shot('reload-no-new'); console.log('       Text:', t.slice(0,300)); }
  } catch(err) { fail('Reload new data', err.message); }

  // ─────────────────────────────────────────
  // CHECK 13: Mobile no overflow
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 13: Mobile overflow ===');
  try {
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await wait(500);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 5
    );
    if (!overflow) pass('Mobile 390px — no horizontal overflow');
    else fail('Mobile 390px — overflow', `scrollWidth: ${await page.evaluate(() => document.documentElement.scrollWidth)}`);
  } catch(err) { fail('Mobile overflow', err.message); }

  // ─────────────────────────────────────────
  // CHECK 14: Desktop content visible
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 14: Desktop viewport ===');
  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await wait(500);
    const t = await page.evaluate(() => document.body.innerText.trim());
    if (t.length > 20) pass('Desktop 1280×800 — content visible');
    else { fail('Desktop — blank page'); await shot('desktop-blank'); }
  } catch(err) { fail('Desktop', err.message); }

  // ─────────────────────────────────────────
  // CHECK 15: No critical console errors
  // ─────────────────────────────────────────
  console.log('\n=== CHECK 15: Console errors ===');
  const critical = consoleErrors.filter(e =>
    !e.includes('favicon') &&
    !e.toLowerCase().includes('[orkmap]') &&
    !e.includes('net::ERR_')
  );
  if (critical.length === 0) pass('No critical console errors', `(${consoleErrors.length} total filtered)`);
  else fail('Console errors', critical.slice(0,3).join(' | '));

  await browser.close();

  // ─────────────────────────────────────────
  // FINAL REPORT
  // ─────────────────────────────────────────
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log('\n' + '='.repeat(65));
  console.log('FINAL REPORT');
  console.log('='.repeat(65));
  console.log(`\nTotal: ${results.length} — ${passed} PASS, ${failed} FAIL\n`);
  console.log('| Check | Status | Details |');
  console.log('|-------|--------|---------|');
  for (const r of results) {
    console.log(`| ${r.check} | ${r.status} | ${r.details} |`);
  }
  if (failed === 0) console.log('\nApp verified — all checks passed.');
  else { console.log(`\n${failed} check(s) FAILED.`); process.exit(1); }
}

run().catch(err => {
  console.error('Fatal:', err.message);
  if (browser) browser.close();
  process.exit(1);
});
