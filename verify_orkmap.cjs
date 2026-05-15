const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('[console.error] ' + msg.text()); });

  const results = [];
  function log(check, pass, detail = '') {
    results.push({ check, pass, detail });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${check}${detail ? ' — ' + detail : ''}`);
  }

  // ─── CHECK 1: Page loads, "Mes concerts" visible ───────────────────────────
  try {
    await page.setViewport({ width: 1280, height: 800 });
    const res = await page.goto('http://localhost:5199', { waitUntil: 'networkidle0', timeout: 15000 });
    log('Page loads (HTTP 200)', res.status() === 200, `HTTP ${res.status()}`);
    await sleep(1500);
    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasMesConcerts = bodyText.includes('Mes concerts');
    log('"Mes concerts" visible', hasMesConcerts);
    if (!hasMesConcerts) {
      await page.screenshot({ path: '/tmp/fail-mes-concerts.png' });
      console.log('  Body preview:', bodyText.slice(0, 300));
    }
  } catch(e) {
    log('Page loads', false, e.message);
  }

  // ─── CHECK 2: Concert demo visible, navigation works ───────────────────────
  try {
    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasConcertDemo = bodyText.includes('Programme Francesconi') || bodyText.includes('Ensemble Intercontemporain');
    log('Concert demo visible', hasConcertDemo, hasConcertDemo ? 'Programme Francesconi found' : 'not found');

    // Click on the concert card (the DIV with onClick)
    const concertClicked = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div'));
      const card = divs.find(el =>
        el.textContent.includes('Programme Francesconi') &&
        typeof el.onclick === 'function'
      );
      if (card) { card.click(); return true; }
      return false;
    });

    if (!concertClicked) {
      // Try React event dispatch
      const found = await page.evaluate(() => {
        const divs = Array.from(document.querySelectorAll('div'));
        const card = divs.find(el => el.textContent.includes('Programme Francesconi') && el.textContent.trim().length < 200);
        if (card) {
          card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return 'dispatched';
        }
        return 'not found';
      });
      console.log('  Concert click dispatch:', found);
    }
    await sleep(1500);

    const newText = await page.evaluate(() => document.body.innerText);
    // Should now be on "home" screen showing pieces
    const hasEtymo = newText.includes('ETYMO') || newText.includes('Unexpected End') || newText.includes('pièce');
    log('Concert navigation works', hasEtymo, hasEtymo ? 'concert detail opened' : 'navigation failed');
    if (!hasEtymo) {
      console.log('  After click text:', newText.slice(0, 300));
      await page.screenshot({ path: '/tmp/fail-concert-nav.png' });
    } else {
      await page.screenshot({ path: '/tmp/check2-concert-detail.png' });
    }
  } catch(e) {
    log('Concert demo + navigation', false, e.message);
  }

  // ─── CHECK 3: Bouton "Extraire par IA" visible sur pièce avec plans ────────
  // Navigate into the first piece, then inject a plan and check the button
  try {
    // Current screen should be "home" with pieces list. Click the ≡ / first piece.
    // Actually from source: clicking a piece navigates via goPiece()
    // The piece card in "home" has an onClick that calls goPiece
    const bodyText = await page.evaluate(() => document.body.innerText);
    const onHome = bodyText.includes('ETYMO') || bodyText.includes('Unexpected End');

    if (!onHome) {
      // Navigate to concert first
      await page.goto('http://localhost:5199', { waitUntil: 'networkidle0', timeout: 10000 });
      await sleep(1000);
      await page.evaluate(() => {
        const divs = Array.from(document.querySelectorAll('div'));
        const card = divs.find(el => el.textContent.includes('Programme Francesconi') && typeof el.onclick === 'function');
        if (card) card.click();
      });
      await sleep(1500);
    }

    // Now navigate into ETYMO piece — find piece card with onClick for goPiece
    // Looking at source: in screen="home", pieces are rendered with cards that have onClick={goPiece}
    // The piece uses the "≡" as DragHandle, not navigation. The piece CARD itself navigates.
    // Let me check what's clickable on this screen
    const pieceClicked = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div'));
      // Find a div that contains "ETYMO" and has onclick
      const card = divs.find(el =>
        el.textContent.includes('ETYMO') &&
        typeof el.onclick === 'function' &&
        el.textContent.trim().length < 300
      );
      if (card) { card.click(); return 'clicked ETYMO card'; }
      // Fallback: dispatch click on smallest div containing ETYMO
      const cards2 = divs.filter(el => el.textContent.includes('ETYMO')).sort((a, b) => a.textContent.length - b.textContent.length);
      if (cards2[0]) {
        cards2[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return 'dispatched click on ' + cards2[0].tagName;
      }
      return 'not found';
    });
    console.log('  Piece click:', pieceClicked);
    await sleep(1500);

    let pieceText = await page.evaluate(() => document.body.innerText);
    const onPiece = pieceText.includes('Ajouter plan') || pieceText.includes('ETYMO');
    console.log('  On piece screen:', onPiece, pieceText.slice(0, 200));
    await page.screenshot({ path: '/tmp/check3-piece-before-plan.png' });

    if (onPiece) {
      // Now inject a fake plan via React state manipulation to trigger AI button
      // The AI button condition: (piece.plans || []).length > 0
      // We can try clicking "Ajouter plan" but it opens a file picker.
      // Instead, inject into the page's React state via __REACT_DEVTOOLS or direct state manipulation
      // Let's use a simpler approach: check if button exists in DOM already (some pieces might have plans)
      const aiButtonVisible = pieceText.includes('Extraire les données par IA') || pieceText.includes('🤖');

      if (!aiButtonVisible) {
        // The demo pieces have no plans by default. We need to inject a plan.
        // Use React fiber traversal to add a plan
        const injected = await page.evaluate(() => {
          // Try to find and click "Ajouter plan" to trigger file picker (won't actually work headless)
          // Instead, inject via React fiber
          function findReactFiber(element) {
            const key = Object.keys(element).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
            return key ? element[key] : null;
          }
          function findSetConcerts(fiber) {
            if (!fiber) return null;
            // Walk up to find a fiber with setConcerts in its memoizedState
            let f = fiber;
            let depth = 0;
            while (f && depth < 30) {
              if (f.memoizedState) {
                let s = f.memoizedState;
                while (s) {
                  if (typeof s.queue?.dispatch === 'function') {
                    // Found a useState setter
                  }
                  s = s.next;
                }
              }
              f = f.return;
              depth++;
            }
            return null;
          }

          // Simpler: Look for the piece detail in the DOM and trigger the button visibility
          // The button is: {(piece.plans || []).length > 0 && <button>...🤖...</button>}
          // We need to mutate the piece state. Let's find the App component's state.
          const root = document.querySelector('#root');
          if (!root) return 'no root';

          const reactKey = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
          if (!reactKey) return 'no react key';

          let fiber = root[reactKey];
          // Navigate to find App component
          function getFibers(f, depth = 0) {
            if (!f || depth > 50) return [];
            const results = [];
            if (f.stateNode && f.stateNode.setState) results.push(f);
            if (f.memoizedState) {
              // Check hooks
              let s = f.memoizedState;
              while (s) {
                if (Array.isArray(s.memoizedState) && s.memoizedState.length > 0) {
                  // Might be concerts array
                  const arr = s.memoizedState;
                  if (arr[0] && arr[0].id === 'demo' && arr[0].pieces) {
                    // Found it! Add plans to first piece
                    const dispatch = s.queue?.dispatch;
                    if (dispatch) {
                      const updated = arr.map(c => c.id === 'demo' ? {
                        ...c,
                        pieces: c.pieces.map((p, i) => i === 0 ? { ...p, plans: ['fake-plan-data'] } : p)
                      } : c);
                      dispatch(updated);
                      return 'dispatched';
                    }
                  }
                }
                s = s.next;
              }
            }
            return results;
          }

          // Walk the fiber tree
          function walk(f, maxDepth = 100) {
            if (!f || maxDepth <= 0) return null;
            // Check this node's hooks for concerts state
            if (f.memoizedState) {
              let s = f.memoizedState;
              while (s) {
                const ms = s.memoizedState;
                if (Array.isArray(ms) && ms.length > 0 && ms[0] && ms[0].id === 'demo' && ms[0].pieces) {
                  const dispatch = s.queue?.dispatch;
                  if (dispatch) {
                    const updated = ms.map(c => c.id === 'demo' ? {
                      ...c,
                      pieces: c.pieces.map((p, i) => i === 0 ? { ...p, plans: ['fake-plan-data'] } : p)
                    } : c);
                    dispatch(updated);
                    return 'dispatched concerts update';
                  }
                }
                s = s.next;
              }
            }
            const childResult = walk(f.child, maxDepth - 1);
            if (childResult) return childResult;
            return walk(f.sibling, maxDepth - 1);
          }

          const result = walk(fiber);
          return result || 'fiber walk done, no match';
        });
        console.log('  React state injection:', injected);
        await sleep(800);
        pieceText = await page.evaluate(() => document.body.innerText);
      }

      const aiButtonNow = pieceText.includes('Extraire les données par IA') || pieceText.includes('🤖 Extraire');
      log('Bouton "Extraire par IA" visible', aiButtonNow, aiButtonNow ? 'button found on piece with plans' : 'button not found');
      await page.screenshot({ path: '/tmp/check3-ai-button.png' });
    } else {
      log('Bouton "Extraire par IA" visible', false, 'could not navigate to piece screen');
    }
  } catch(e) {
    log('Bouton "Extraire par IA" visible', false, e.message);
  }

  // ─── CHECK 4: Bouton Archiver (📦) present on concert list ────────────────
  try {
    await page.goto('http://localhost:5199', { waitUntil: 'networkidle0', timeout: 10000 });
    await sleep(1000);
    const html = await page.content();
    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasArchive = html.includes('📦') || bodyText.includes('📦') || bodyText.includes('Archiver');
    log('Bouton Archiver (📦) présent', hasArchive, hasArchive ? 'found' : 'not found');
    if (!hasArchive) await page.screenshot({ path: '/tmp/fail-archive.png' });
  } catch(e) {
    log('Bouton Archiver (📦)', false, e.message);
  }

  // ─── CHECK 5: Mobile 375px, pas d'overflow ────────────────────────────────
  try {
    await page.setViewport({ width: 375, height: 812 });
    await page.goto('http://localhost:5199', { waitUntil: 'networkidle0', timeout: 10000 });
    await sleep(1000);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    }));
    log('Mobile 375px — no horizontal overflow', !overflow.overflow,
      `scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth}`);
    await page.screenshot({ path: '/tmp/check5-mobile.png' });
  } catch(e) {
    log('Mobile 375px', false, e.message);
  }

  // ─── CHECK 6: 0 console errors (fresh desktop reload) ─────────────────────
  await page.setViewport({ width: 1280, height: 800 });
  const freshErrors = [];
  const freshPage = await browser.newPage();
  freshPage.on('pageerror', err => freshErrors.push(err.message));
  freshPage.on('console', msg => { if (msg.type() === 'error') freshErrors.push('[console.error] ' + msg.text()); });
  await freshPage.goto('http://localhost:5199', { waitUntil: 'networkidle0', timeout: 10000 });
  await sleep(2000);
  await freshPage.close();

  const allErrors = [...errors, ...freshErrors].filter(e =>
    !e.includes('favicon') && !e.includes('manifest') &&
    !e.includes('service-worker') && !e.includes('sw.js') &&
    !e.toLowerCase().includes('warning')
  );
  log('0 console errors', allErrors.length === 0,
    allErrors.length > 0 ? allErrors.slice(0, 3).join(' | ') : 'clean');
  if (allErrors.length > 0) console.log('  Errors:', JSON.stringify(allErrors));

  // ─── Final summary ─────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass);
  console.log(`Passed: ${passed}/${results.length}`);
  if (failed.length) {
    console.log('Failed:');
    failed.forEach(f => console.log(`  - [${f.check}]: ${f.detail}`));
  } else {
    console.log('All checks passed!');
  }

  await browser.close();
  process.exit(failed.length > 0 ? 1 : 0);
})();
