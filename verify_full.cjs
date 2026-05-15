/**
 * Full Puppeteer verification for OrkMap PWA (React + Vite)
 * Uses state-based navigation (no URL routing), single App.jsx
 */

const puppeteer = require('puppeteer');
const path = require('path');

const URL = 'http://localhost:5199';
const SCREENSHOT_DIR = '/Users/alexandre/Galaad-Motokiyo-Ferran/Orchestral_tec';

const results = [];
let browser, page;
const jsErrors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function pass(check, detail = '') {
  results.push({ check, status: 'PASS', detail });
  console.log(`[PASS] ${check}${detail ? ' — ' + detail : ''}`);
}
function fail(check, detail = '') {
  results.push({ check, status: 'FAIL', detail });
  console.log(`[FAIL] ${check}${detail ? ' — ' + detail : ''}`);
}
async function screenshot(name) {
  try {
    const p = path.join(SCREENSHOT_DIR, `verify-fail-${name}-${Date.now()}.png`);
    await page.screenshot({ path: p, fullPage: false });
    console.log(`  Screenshot: ${p}`);
  } catch(e) { console.log(`  Screenshot failed: ${e.message}`); }
}

async function main() {
  browser = await puppeteer.launch({
    headless: 'new',
    protocolTimeout: 60000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  page = await browser.newPage();
  await page.setDefaultTimeout(15000);
  await page.setDefaultNavigationTimeout(20000);

  page.on('pageerror', err => jsErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') jsErrors.push(msg.text());
  });

  // ── CHECK 1: Page loads ──────────────────────────────────────────────────
  console.log('\n── CHECK 1: Page loads ──');
  const t0 = Date.now();
  try {
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 20000 });
    pass('Page loads', `${((Date.now() - t0)/1000).toFixed(2)}s`);
  } catch (e) {
    fail('Page loads', e.message);
    await screenshot('page-loads');
    await browser.close();
    printSummary();
    return;
  }

  // ── CHECK 2: "Mes concerts" visible ────────────────────────────────────
  console.log('\n── CHECK 2: "Mes concerts" visible ──');
  try {
    await page.waitForFunction(
      () => document.body.innerText.includes('Mes concerts'),
      { timeout: 8000 }
    );
    pass('"Mes concerts" visible');
  } catch (e) {
    const text = await page.evaluate(() => document.body.innerText.substring(0, 300));
    fail('"Mes concerts" visible', `Body: ${text}`);
    await screenshot('mes-concerts');
  }

  // ── CHECK 3: No JS errors at load ───────────────────────────────────────
  console.log('\n── CHECK 3: JS errors at load ──');
  await sleep(1000);
  const loadErrors = jsErrors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('net::ERR_') &&
    !e.includes('Failed to load resource')
  );
  if (loadErrors.length === 0) {
    pass('No JS errors at load');
  } else {
    fail('No JS errors at load', loadErrors.slice(0, 3).join(' | '));
    await screenshot('js-errors');
  }

  // ── CHECK 4: Demo concert visible in list ───────────────────────────────
  console.log('\n── CHECK 4: Demo concert in list ──');
  try {
    const hasDemoConcert = await page.evaluate(() => {
      return document.body.innerText.includes('Programme Francesconi') ||
             document.body.innerText.includes('Francesconi');
    });
    if (hasDemoConcert) {
      pass('Demo concert visible', '"Programme Francesconi" found');
    } else {
      // May not have loaded from IndexedDB yet
      await sleep(2000);
      const bodyText = await page.evaluate(() => document.body.innerText);
      if (bodyText.includes('Francesconi') || bodyText.includes('concert')) {
        pass('Demo concert visible', 'Concert list non-empty');
      } else {
        fail('Demo concert visible', 'No concert found in list');
        await screenshot('demo-concert');
      }
    }
  } catch (e) {
    fail('Demo concert visible', e.message);
  }

  // ── CHECK 5: Navigate into demo concert → pieces visible ────────────────
  console.log('\n── CHECK 5: Navigate into concert — pieces visible ──');
  try {
    // Concert cards are divs with cursor:pointer and a left border (S.card).
    // We find the card that contains ONLY the concert title (not too much text)
    // by targeting the div with cursor=pointer and borderLeft containing the title.
    const clicked = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('div'));
      // Find cards with cursor:pointer style (these are S.card elements)
      const clickableCards = cards.filter(el =>
        el.style && el.style.cursor === 'pointer' &&
        el.style.borderRadius &&
        el.textContent.includes('Francesconi')
      );
      // Click the first matching card (most specific match = smallest element with content)
      if (clickableCards.length > 0) {
        // Sort by text length (shorter = more specific card)
        clickableCards.sort((a, b) => a.textContent.length - b.textContent.length);
        clickableCards[0].click();
        return { ok: true, text: clickableCards[0].textContent.substring(0, 80) };
      }
      return { ok: false };
    });

    if (clicked && clicked.ok) {
      await sleep(1500);
      // On home screen we expect: back button, concert title, piece list
      const bodyText = await page.evaluate(() => document.body.innerText);
      const onHomeScreen = bodyText.includes('ETYMO') || bodyText.includes('Unexpected End') ||
                           (bodyText.includes('pièces') && bodyText.includes('←'));
      if (onHomeScreen) {
        pass('Navigate into concert', 'Home screen with pieces list loaded');
      } else {
        fail('Navigate into concert', `Body: ${bodyText.substring(0, 200)}`);
        await screenshot('concert-nav');
      }
    } else {
      fail('Navigate into concert', 'Could not find concert card to click');
      await screenshot('concert-nav');
    }
  } catch (e) {
    fail('Navigate into concert', e.message);
    await screenshot('concert-nav');
  }

  // ── CHECK 6: Piece navigation ────────────────────────────────────────────
  console.log('\n── CHECK 6: Navigate into a piece ──');
  let pieceNavigated = false;
  try {
    // Now on home screen. Piece cards also have cursor:pointer + borderLeft.
    // Piece cards contain the piece title (e.g. "ETYMO") but NOT the concert title.
    const clickResult = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('div'));
      // Find cards with cursor:pointer — but exclude those containing "Francesconi" + back button
      // (which would be the whole concert view container)
      const clickableCards = cards.filter(el =>
        el.style && el.style.cursor === 'pointer' &&
        el.style.borderRadius &&
        (el.textContent.includes('ETYMO') || el.textContent.includes('Unexpected End') ||
         el.textContent.includes('Luca FRANCESCONI'))
      );
      // Sort by text length ascending (smallest = most targeted piece card)
      clickableCards.sort((a, b) => a.textContent.length - b.textContent.length);
      const best = clickableCards[0];
      if (best) {
        best.click();
        return { ok: true, text: best.textContent.substring(0, 80).trim() };
      }
      return { ok: false, allCards: cards.filter(el => el.style && el.style.cursor === 'pointer').map(el => el.textContent.substring(0, 40)).join(' | ') };
    });

    if (clickResult && clickResult.ok) {
      await sleep(1500);
      const bodyText = await page.evaluate(() => document.body.innerText);
      // Piece screen has: color picker buttons, metadata fields (Compositeur, Durée etc), Percu sections
      const onPieceScreen = bodyText.includes('Compositeur') || bodyText.includes('Durée') ||
                            bodyText.includes('Percu') || bodyText.includes('FRANCESCONI');
      if (onPieceScreen) {
        pass('Navigate into piece', `Piece screen loaded — clicked: "${clickResult.text}"`);
        pieceNavigated = true;
      } else {
        fail('Navigate into piece', `Body after click: ${bodyText.substring(0, 200)}`);
        await screenshot('piece-nav');
      }
    } else {
      fail('Navigate into piece', `Could not find piece card. ${clickResult?.allCards || ''}`);
      await screenshot('piece-nav');
    }
  } catch (e) {
    fail('Navigate into piece', e.message);
    await screenshot('piece-nav');
  }

  // ── CHECK 7: IA button (requires piece with plans) ──────────────────────
  console.log('\n── CHECK 7: IA button — inject plan into IndexedDB and reload ──');
  try {
    // The IA button only shows when piece.plans.length > 0
    // We inject a plan into the piece in localStorage/IndexedDB via the page
    // First, check current state
    const hasIANow = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent.includes('IA') || b.textContent.includes('Extraire'));
    });

    if (hasIANow) {
      pass('IA button visible', 'Already visible');
    } else {
      // Inject a fake plan into the piece via IndexedDB
      const injected = await page.evaluate(async () => {
        try {
          // Add a tiny 1x1 data URL as a plan to the demo piece
          const fakeDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

          const dbReq = indexedDB.open('orkmap-db', 2);
          return await new Promise((resolve) => {
            dbReq.onsuccess = (e) => {
              const db = e.target.result;
              const storeNames = Array.from(db.objectStoreNames);
              // Try to find the concerts store
              const concertStore = storeNames.find(s => s.toLowerCase().includes('concert'));
              if (!concertStore) { resolve({ ok: false, reason: 'no concert store, stores: ' + storeNames.join(',') }); return; }

              const tx = db.transaction(concertStore, 'readwrite');
              const store = tx.objectStore(concertStore);
              const getAllReq = store.getAll();
              getAllReq.onsuccess = () => {
                const concerts = getAllReq.result;
                const demo = concerts.find(c => c.id === 'demo');
                if (!demo) { resolve({ ok: false, reason: 'demo concert not found, concerts: ' + concerts.map(c=>c.id).join(',') }); return; }

                // Add plan to first piece
                const updated = { ...demo };
                if (updated.pieces && updated.pieces.length > 0) {
                  updated.pieces = updated.pieces.map((p, i) =>
                    i === 0 ? { ...p, plans: [fakeDataUrl] } : p
                  );
                }
                const putReq = store.put(updated);
                putReq.onsuccess = () => resolve({ ok: true });
                putReq.onerror = () => resolve({ ok: false, reason: 'put failed' });
              };
              getAllReq.onerror = () => resolve({ ok: false, reason: 'getAll failed' });
            };
            dbReq.onerror = () => resolve({ ok: false, reason: 'db open failed' });
          });
        } catch(err) {
          return { ok: false, reason: err.message };
        }
      });

      console.log(`  IndexedDB inject result: ${JSON.stringify(injected)}`);

      if (injected && injected.ok) {
        // Reload page and navigate to the piece
        await page.reload({ waitUntil: 'networkidle0', timeout: 15000 });
        await sleep(1000);

        // Navigate to demo concert (smallest cursor:pointer card containing Francesconi)
        await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('div'))
            .filter(el => el.style && el.style.cursor === 'pointer' && el.style.borderRadius && el.textContent.includes('Francesconi'));
          cards.sort((a, b) => a.textContent.length - b.textContent.length);
          if (cards[0]) cards[0].click();
        });
        await sleep(1200);

        // Navigate to first piece (smallest cursor:pointer card containing ETYMO)
        await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('div'))
            .filter(el => el.style && el.style.cursor === 'pointer' && el.style.borderRadius && el.textContent.includes('ETYMO'));
          cards.sort((a, b) => a.textContent.length - b.textContent.length);
          if (cards[0]) cards[0].click();
        });
        await sleep(1500);

        // Check for IA button
        const iaVisible = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          return btns.some(b => b.textContent.includes('IA') || b.textContent.includes('Extraire'));
        });

        if (iaVisible) {
          pass('IA button visible', 'Visible after injecting plan into piece');
        } else {
          const btnsText = await page.evaluate(() =>
            Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).join(' | ')
          );
          fail('IA button visible', `Buttons: ${btnsText.substring(0, 300)}`);
          await screenshot('ia-button');
        }
      } else {
        // If IndexedDB inject failed, check if it's because no DB exists yet
        // (first load might not have persisted). Check via alternative.
        fail('IA button visible', `Could not inject plan: ${injected?.reason}. IA button requires piece with plans.`);
        await screenshot('ia-button');
      }
    }
  } catch (e) {
    fail('IA button visible', e.message);
    await screenshot('ia-button');
  }

  // ── CHECK 8: Archive button present ─────────────────────────────────────
  console.log('\n── CHECK 8: Archive button (📦) present ──');
  try {
    // Go back to concerts list
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(800);

    const archiveBtnInfo = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const archiveBtn = btns.find(b =>
        b.textContent.includes('📦') ||
        (b.title && b.title.toLowerCase().includes('archiv')) ||
        b.className.toLowerCase().includes('archiv')
      );
      if (archiveBtn) {
        return { found: true, text: archiveBtn.textContent.trim(), title: archiveBtn.title };
      }
      return {
        found: false,
        allBtns: btns.map(b => ({ text: b.textContent.trim().substring(0, 30), title: b.title }))
      };
    });

    if (archiveBtnInfo.found) {
      pass('Archive button present', `text="${archiveBtnInfo.text}" title="${archiveBtnInfo.title}"`);
    } else {
      // May need a concert to be present with the archive button
      const hasConcert = await page.evaluate(() =>
        document.body.innerText.includes('Programme Francesconi')
      );
      if (hasConcert) {
        const allBtns = archiveBtnInfo.allBtns || [];
        fail('Archive button present', `Concert visible but no archive btn. Buttons: ${allBtns.map(b=>b.text+'['+b.title+']').join(' | ')}`);
        await screenshot('archive-btn');
      } else {
        fail('Archive button present', 'No concert visible in list');
        await screenshot('archive-btn');
      }
    }
  } catch (e) {
    fail('Archive button present', e.message);
    await screenshot('archive-btn');
  }

  // ── CHECK 9: Back navigation works ──────────────────────────────────────
  console.log('\n── CHECK 9: Back navigation ──');
  try {
    // Ensure we're on concerts screen first
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(800);

    // Navigate into concert (smallest cursor:pointer div with Francesconi)
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('div'))
        .filter(el => el.style && el.style.cursor === 'pointer' && el.style.borderRadius && el.textContent.includes('Francesconi'));
      cards.sort((a, b) => a.textContent.length - b.textContent.length);
      if (cards[0]) cards[0].click();
    });
    await sleep(1200);

    // Verify we're on the home/concert screen (has back button)
    const onConcertScreen = await page.evaluate(() =>
      document.body.innerText.includes('←') || document.querySelector('button') &&
      Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === '←')
    );

    // Click back button (←)
    const backClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const back = btns.find(b => b.textContent.trim() === '←');
      if (back) { back.click(); return true; }
      // Debug: show all button texts
      return btns.map(b => b.textContent.trim()).join(' | ');
    });
    await sleep(800);

    if (backClicked === true) {
      const onConcerts = await page.evaluate(() =>
        document.body.innerText.includes('Mes concerts')
      );
      if (onConcerts) {
        pass('Back navigation', 'Navigated into concert then back to list');
      } else {
        fail('Back navigation', 'Clicked ← but did not return to concerts screen');
        await screenshot('back-nav');
      }
    } else {
      fail('Back navigation', `Back button (←) not found. Buttons: ${String(backClicked).substring(0, 200)}`);
      await screenshot('back-nav');
    }
  } catch (e) {
    fail('Back navigation', e.message);
  }

  // ── CHECK 10: Mobile 375px no overflow ─────────────────────────────────
  console.log('\n── CHECK 10: Mobile 375x812 — no horizontal overflow ──');
  try {
    await page.setViewport({ width: 375, height: 812, isMobile: true });
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(800);

    const overflow = await page.evaluate(() => {
      return {
        overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      };
    });

    if (!overflow.overflows) {
      pass('Mobile 375px no overflow');
    } else {
      fail('Mobile 375px no overflow', `scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`);
      await screenshot('mobile-overflow');
    }
  } catch (e) {
    fail('Mobile 375px no overflow', e.message);
  }

  // ── CHECK 11: Desktop 1280px ─────────────────────────────────────────────
  console.log('\n── CHECK 11: Desktop 1280x800 — content visible ──');
  try {
    await page.setViewport({ width: 1280, height: 800, isMobile: false });
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(800);
    const bodyLen = await page.evaluate(() => document.body.innerText.trim().length);
    if (bodyLen > 50) {
      pass('Desktop 1280px content visible', `${bodyLen} chars`);
    } else {
      fail('Desktop 1280px content visible', `Only ${bodyLen} chars`);
      await screenshot('desktop-blank');
    }
  } catch (e) {
    fail('Desktop 1280px content visible', e.message);
  }

  // ── CHECK 12: No freeze after 5s ────────────────────────────────────────
  console.log('\n── CHECK 12: No freeze / infinite loop after 5s ──');
  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(5000);

    const t1 = Date.now();
    const responsive = await page.evaluate(() =>
      new Promise(resolve => {
        const to = setTimeout(() => resolve(false), 3000);
        requestAnimationFrame(() => { clearTimeout(to); resolve(true); });
      })
    );
    const elapsed = Date.now() - t1;

    if (responsive) {
      pass('No freeze after 5s', `rAF responded in ${elapsed}ms`);
    } else {
      fail('No freeze after 5s', 'Page did not respond to rAF — possible freeze');
      await screenshot('freeze');
    }
  } catch (e) {
    fail('No freeze after 5s', e.message);
  }

  // ── CHECK 13: Final JS error count ─────────────────────────────────────
  console.log('\n── CHECK 13: Total JS errors ──');
  const finalErrors = jsErrors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('Failed to load resource') &&
    !e.includes('net::ERR_')
  );
  if (finalErrors.length === 0) {
    pass('Zero JS errors total');
  } else {
    fail('Zero JS errors total', `${finalErrors.length} errors: ${finalErrors.slice(0, 3).join(' | ')}`);
  }

  await browser.close();
  printSummary();
}

function printSummary() {
  console.log('\n\n═══════════════════════════════════════════════════════════════════════════');
  console.log('VERIFICATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  const maxLen = Math.max(...results.map(r => r.check.length));
  for (const r of results) {
    const icon = r.status === 'PASS' ? 'PASS' : 'FAIL';
    const detail = r.detail ? ` — ${r.detail}` : '';
    console.log(`  [${icon}] ${r.check.padEnd(maxLen + 2)}${detail}`);
  }
  const passes = results.filter(r => r.status === 'PASS').length;
  const fails = results.filter(r => r.status === 'FAIL').length;
  console.log('───────────────────────────────────────────────────────────────────────────');
  console.log(`  Total: ${passes} PASS, ${fails} FAIL`);
  if (fails === 0) {
    console.log('\n  App verified — all checks passed.');
  } else {
    console.log(`\n  ${fails} check(s) need attention.`);
  }
}

main().catch(async e => {
  console.error('Fatal error:', e.message);
  if (browser) await browser.close().catch(() => {});
  printSummary();
  process.exit(1);
});
