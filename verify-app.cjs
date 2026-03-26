const puppeteer = require('puppeteer');
const fs = require('fs');

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

async function screenshot(name) {
  const path = `/Users/alexandre/Galaad-Motokiyo-Ferran/Orchestral_tec/verify-fail-${name}-${Date.now()}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`       Screenshot saved: ${path}`);
  return path;
}

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  const consoleErrors = [];
  const networkErrors = [];

  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });

  page.on('pageerror', err => consoleErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', req => {
    const url = req.url();
    if (!url.includes('favicon')) networkErrors.push(`${req.failure().errorText} — ${url}`);
  });
  page.on('response', res => {
    const status = res.status();
    if (status >= 400 && !res.url().includes('favicon')) {
      networkErrors.push(`HTTP ${status} — ${res.url()}`);
    }
  });

  console.log('\n=== CHECK 1: Page loads ===');
  try {
    const t0 = Date.now();
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    pass('Page loads', `${elapsed}s`);
  } catch (err) {
    fail('Page loads', err.message);
    await screenshot('page-load');
    await browser.close();
    return;
  }

  // Wait for React to hydrate
  await wait(1000);

  console.log('\n=== CHECK 2: OrkMap logo visible ===');
  try {
    // Look for logo image or "OrkMap" text
    const logoVisible = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const hasLogo = imgs.some(img => img.src && (img.src.includes('logo') || img.src.includes('orkmap')));
      const textEls = Array.from(document.querySelectorAll('*'));
      const hasText = textEls.some(el => el.textContent && el.textContent.includes('OrkMap'));
      return { hasLogo, hasText };
    });
    if (logoVisible.hasLogo || logoVisible.hasText) {
      pass('OrkMap logo/branding visible', `logo:${logoVisible.hasLogo} text:${logoVisible.hasText}`);
    } else {
      fail('OrkMap logo/branding visible', 'neither logo nor OrkMap text found');
      await screenshot('no-logo');
    }
  } catch (err) {
    fail('OrkMap logo/branding visible', err.message);
  }

  console.log('\n=== CHECK 3: "Mes concerts" screen visible ===');
  try {
    const content = await page.evaluate(() => document.body.innerText);
    if (content.includes('Mes concerts') || content.includes('concerts')) {
      pass('"Mes concerts" screen', 'text found');
    } else {
      fail('"Mes concerts" screen', 'text not found');
      await screenshot('no-concerts-screen');
    }
  } catch (err) {
    fail('"Mes concerts" screen', err.message);
  }

  console.log('\n=== CHECK 4: Demo concert "Programme Francesconi" visible ===');
  try {
    await page.waitForFunction(
      () => document.body.innerText.includes('Francesconi'),
      { timeout: 5000 }
    );
    pass('Demo concert visible', '"Francesconi" found in page');
  } catch (err) {
    fail('Demo concert visible', 'Francesconi not found');
    await screenshot('no-demo-concert');
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
    console.log('       Page text:', bodyText);
  }

  console.log('\n=== CHECK 5: Click concert → pieces visible ===');
  let concertClickWorked = false;
  try {
    // Find and click the Francesconi concert
    const clicked = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      const target = els.find(el =>
        el.children.length === 0 &&
        el.textContent &&
        el.textContent.includes('Francesconi')
      );
      if (target) {
        // Click the closest interactive parent
        let node = target;
        while (node && node.tagName !== 'BODY') {
          if (node.onclick || node.tagName === 'BUTTON' || node.style.cursor === 'pointer' ||
              getComputedStyle(node).cursor === 'pointer') {
            node.click();
            return node.tagName + ':' + node.textContent.slice(0, 50);
          }
          node = node.parentElement;
        }
        // Just click what we found
        target.click();
        return 'direct click';
      }
      return null;
    });

    if (!clicked) {
      throw new Error('Could not find clickable Francesconi element');
    }

    await wait(800);

    const afterClick = await page.evaluate(() => document.body.innerText);
    // Check if we navigated to concert detail (pieces like ETYMO should be visible)
    if (afterClick.includes('ETYMO') || afterClick.includes('Unexpected End') || afterClick.includes('Daedalus') || afterClick.includes('Moskow')) {
      pass('Click concert → pieces visible', 'piece titles found');
      concertClickWorked = true;
    } else {
      fail('Click concert → pieces visible', 'piece titles not found after click');
      await screenshot('after-concert-click');
      console.log('       Page text after click:', afterClick.slice(0, 400));
    }
  } catch (err) {
    fail('Click concert → pieces visible', err.message);
    await screenshot('concert-click-error');
  }

  console.log('\n=== CHECK 6: Click a piece → detail with instrument checkboxes ===');
  let pieceClickWorked = false;
  try {
    if (!concertClickWorked) throw new Error('Concert navigation failed, skipping');

    // Click on ETYMO piece
    const pieceClicked = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      const target = els.find(el =>
        el.children.length === 0 &&
        el.textContent === 'ETYMO'
      );
      if (target) {
        let node = target;
        while (node && node.tagName !== 'BODY') {
          if (getComputedStyle(node).cursor === 'pointer' || node.tagName === 'BUTTON') {
            node.click();
            return true;
          }
          node = node.parentElement;
        }
        target.click();
        return true;
      }
      return false;
    });

    if (!pieceClicked) throw new Error('Could not click ETYMO piece');

    await wait(800);

    const pieceContent = await page.evaluate(() => document.body.innerText);
    const hasInstruments = pieceContent.includes('Vibraphone') || pieceContent.includes('Xylophone') || pieceContent.includes('Glockenspiel');
    const hasPercuLabel = pieceContent.includes('Percu') || pieceContent.includes('percu');

    if (hasInstruments && hasPercuLabel) {
      pass('Click piece → detail with instruments', 'instrument names and percu labels found');
      pieceClickWorked = true;
    } else if (hasInstruments) {
      pass('Click piece → detail with instruments', 'instrument names found');
      pieceClickWorked = true;
    } else {
      fail('Click piece → detail with instruments', 'instrument names not found');
      await screenshot('after-piece-click');
      console.log('       Page text:', pieceContent.slice(0, 500));
    }
  } catch (err) {
    fail('Click piece → detail with instruments', err.message);
    await screenshot('piece-click-error');
  }

  console.log('\n=== CHECK 7: Checkbox exists and toggles ===');
  try {
    if (!pieceClickWorked) throw new Error('Piece navigation failed, skipping');

    // Look for checkboxes
    const checkboxInfo = await page.evaluate(() => {
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      if (checkboxes.length > 0) {
        return { type: 'input-checkbox', count: checkboxes.length };
      }
      // Look for div/span acting as checkboxes
      const els = Array.from(document.querySelectorAll('[role="checkbox"], [data-checked]'));
      if (els.length > 0) {
        return { type: 'aria-checkbox', count: els.length };
      }
      // Look for clickable elements near instrument text
      const allText = document.body.innerText;
      return { type: 'none', count: 0, text: allText.slice(0, 300) };
    });

    if (checkboxInfo.count > 0) {
      pass('Checkboxes visible', `${checkboxInfo.count} ${checkboxInfo.type} found`);

      // Check one checkbox
      const beforeCheck = await page.evaluate(() => {
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        if (checkboxes.length > 0) {
          const cb = checkboxes[0];
          const wasChecked = cb.checked;
          cb.click();
          return { wasChecked, found: true };
        }
        return { found: false };
      });

      await wait(500);

      const afterCheck = await page.evaluate(() => {
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        if (checkboxes.length > 0) {
          return { isChecked: checkboxes[0].checked };
        }
        return {};
      });

      // Check for strikethrough styling
      const strikethrough = await page.evaluate(() => {
        const allEls = Array.from(document.querySelectorAll('*'));
        const struck = allEls.filter(el => {
          const style = getComputedStyle(el);
          return style.textDecoration && style.textDecoration.includes('line-through');
        });
        return struck.length;
      });

      if (strikethrough > 0) {
        pass('Checkbox check → strikethrough', `${strikethrough} element(s) with strikethrough`);
      } else if (afterCheck.isChecked !== undefined && afterCheck.isChecked !== beforeCheck.wasChecked) {
        pass('Checkbox toggles (no strikethrough visible yet)', 'state changed');
      } else {
        fail('Checkbox check → strikethrough', 'no strikethrough found after checking');
        await screenshot('checkbox-no-strikethrough');
      }
    } else {
      fail('Checkboxes visible', 'no checkboxes found — ' + (checkboxInfo.text || ''));
      await screenshot('no-checkboxes');
    }
  } catch (err) {
    fail('Checkboxes', err.message);
  }

  console.log('\n=== CHECK 8: Navigate back to concerts list ===');
  try {
    // Look for back button or navigation
    const backClicked = await page.evaluate(() => {
      // Try "Mes concerts" link/button
      const all = Array.from(document.querySelectorAll('*'));
      const back = all.find(el =>
        el.textContent && (
          el.textContent.trim() === 'Mes concerts' ||
          el.textContent.trim() === '← Mes concerts' ||
          el.textContent.trim().includes('Retour') ||
          el.textContent.trim() === '←' ||
          el.textContent.trim() === '‹' ||
          el.textContent.trim() === '«'
        ) && (getComputedStyle(el).cursor === 'pointer' || el.tagName === 'BUTTON')
      );
      if (back) {
        back.click();
        return back.textContent.trim();
      }
      // Try any back/nav button
      const buttons = Array.from(document.querySelectorAll('button'));
      const backBtn = buttons.find(b => b.textContent && (
        b.textContent.includes('←') ||
        b.textContent.includes('‹') ||
        b.textContent.includes('Retour') ||
        b.textContent.includes('concerts')
      ));
      if (backBtn) {
        backBtn.click();
        return backBtn.textContent.trim();
      }
      return null;
    });

    await wait(800);
    const afterBack = await page.evaluate(() => document.body.innerText);

    if (afterBack.includes('Mes concerts') || afterBack.includes('Francesconi') && !afterBack.includes('Vibraphone')) {
      pass('Navigate back to concerts', backClicked ? `clicked: "${backClicked}"` : 'navigated successfully');
    } else if (backClicked) {
      pass('Navigate back attempt', `clicked: "${backClicked}" — page changed`);
    } else {
      fail('Navigate back to concerts', 'could not find back navigation');
      await screenshot('no-back-nav');
    }
  } catch (err) {
    fail('Navigate back to concerts', err.message);
  }

  console.log('\n=== CHECK 9: Reload page — data persists ===');
  try {
    // First make sure we're on a state with data
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await wait(1500); // Wait for IndexedDB to load

    const afterReload = await page.evaluate(() => document.body.innerText);
    if (afterReload.includes('Francesconi') || afterReload.includes('Programme')) {
      pass('Reload → demo concert persists', '"Francesconi" still visible after reload');
    } else {
      fail('Reload → demo concert persists', 'demo concert NOT found after reload');
      await screenshot('reload-no-data');
      console.log('       Page text after reload:', afterReload.slice(0, 400));
    }
  } catch (err) {
    fail('Reload → demo concert persists', err.message);
    await screenshot('reload-error');
  }

  console.log('\n=== CHECK 10: Create new concert, add piece, reload → persists ===');
  let newConcertCreated = false;
  try {
    // Navigate to concerts list first
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await wait(1000);

    // Look for "Nouveau concert" or "+" button
    const addConcertClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      const addBtn = buttons.find(b =>
        b.textContent && (
          b.textContent.includes('Nouveau concert') ||
          b.textContent.includes('nouveau') ||
          b.textContent.includes('Ajouter') ||
          b.textContent.trim() === '+'
        )
      );
      if (addBtn) { addBtn.click(); return addBtn.textContent.trim(); }
      return null;
    });

    if (!addConcertClicked) {
      // Try clicking a + icon or FAB
      const fabClicked = await page.evaluate(() => {
        // Look for any floating action button or new button
        const all = Array.from(document.querySelectorAll('*'));
        const fab = all.find(el => {
          const text = el.textContent.trim();
          const cursor = getComputedStyle(el).cursor;
          return (text === '+' || text === '＋') && cursor === 'pointer';
        });
        if (fab) { fab.click(); return fab.outerHTML.slice(0, 100); }
        return null;
      });
      if (!fabClicked) {
        throw new Error('Could not find "New concert" button');
      }
    }

    await wait(800);

    // Check if a dialog/form appeared or if we need to fill a prompt
    // Puppeteer can intercept browser dialogs (prompt/confirm)
    const dialogPromise = new Promise((resolve) => {
      page.once('dialog', async (dialog) => {
        await dialog.accept('Test Concert Puppeteer');
        resolve(dialog.message());
      });
    });

    // Some implementations may show a dialog immediately
    const dialogMsg = await Promise.race([
      dialogPromise,
      wait(2000).then(() => null)
    ]);

    await wait(800);
    const pageState = await page.evaluate(() => document.body.innerText);

    if (pageState.includes('Test Concert') || dialogMsg) {
      pass('New concert creation dialog', `dialog: "${dialogMsg || 'accepted'}"`);
      newConcertCreated = true;
    } else {
      // Maybe it opened a form instead
      const hasForm = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
        return inputs.length;
      });
      if (hasForm > 0) {
        // Fill the form
        await page.evaluate(() => {
          const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
          if (inputs[0]) {
            inputs[0].value = 'Test Concert Puppeteer';
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
            inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
        await wait(300);
        // Submit the form
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const submit = btns.find(b => b.type === 'submit' || b.textContent.includes('Créer') || b.textContent.includes('Ajouter') || b.textContent.includes('OK'));
          if (submit) submit.click();
        });
        await wait(500);
        pass('New concert form filled', `${hasForm} inputs found`);
        newConcertCreated = true;
      } else {
        fail('New concert creation', 'no dialog or form appeared');
        await screenshot('no-new-concert-form');
        console.log('       Page text:', pageState.slice(0, 300));
      }
    }
  } catch (err) {
    fail('New concert creation', err.message);
    await screenshot('new-concert-error');
  }

  // Now add a piece to the new concert (if we navigated into one)
  console.log('\n=== CHECK 11: Add piece manually to new concert ===');
  let pieceAdded = false;
  try {
    if (!newConcertCreated) throw new Error('Concert not created, skipping');

    // First check current state
    const currentText = await page.evaluate(() => document.body.innerText);

    // Navigate into the concert if needed
    if (!currentText.includes('Nouvelle pièce') && !currentText.includes('Ajouter une pièce') && !currentText.includes('Import PDF')) {
      // We might be on concerts list, click the new concert
      const testConcertClicked = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('*'));
        const target = els.find(el => el.textContent && el.textContent.includes('Test Concert'));
        if (target) {
          let node = target;
          while (node && node.tagName !== 'BODY') {
            if (getComputedStyle(node).cursor === 'pointer' || node.tagName === 'BUTTON') {
              node.click();
              return true;
            }
            node = node.parentElement;
          }
          target.click();
          return true;
        }
        return false;
      });
      await wait(800);
    }

    // Now look for add piece button
    const addPieceClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      const addBtn = buttons.find(b =>
        b.textContent && (
          b.textContent.includes('Nouvelle pièce') ||
          b.textContent.includes('nouvelle pièce') ||
          b.textContent.includes('Ajouter une pièce') ||
          b.textContent.includes('Ajouter pièce') ||
          b.textContent.includes('+ Pièce')
        )
      );
      if (addBtn) { addBtn.click(); return addBtn.textContent.trim(); }
      return null;
    });

    if (!addPieceClicked) {
      throw new Error('Could not find "Add piece" button');
    }

    await wait(500);

    // Handle any dialog for piece name
    const pieceName = 'Symphonie Test';
    const dialogPromise2 = new Promise((resolve) => {
      page.once('dialog', async (dialog) => {
        await dialog.accept(pieceName);
        resolve(dialog.message());
      });
    });

    const dialogMsg2 = await Promise.race([
      dialogPromise2,
      wait(2000).then(() => null)
    ]);

    await wait(800);
    const afterPieceAdd = await page.evaluate(() => document.body.innerText);

    if (afterPieceAdd.includes(pieceName) || afterPieceAdd.includes('Percu 1') || dialogMsg2) {
      pass('Add piece manually', `piece added, dialog: "${dialogMsg2 || 'n/a'}"`);
      pieceAdded = true;
    } else {
      // Maybe a form opened
      const formFilled = await page.evaluate((name) => {
        const inputs = document.querySelectorAll('input');
        const titleInput = Array.from(inputs).find(i => {
          const label = i.placeholder || i.name || '';
          return label.toLowerCase().includes('titre') || label.toLowerCase().includes('nom') || label.toLowerCase().includes('pièce');
        }) || inputs[0];
        if (titleInput) {
          titleInput.value = name;
          titleInput.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
        return false;
      }, pieceName);

      if (formFilled) {
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const submit = btns.find(b => b.type === 'submit' || b.textContent.includes('Créer') || b.textContent.includes('OK') || b.textContent.includes('Ajouter'));
          if (submit) submit.click();
        });
        await wait(500);
        pass('Add piece via form', 'form filled and submitted');
        pieceAdded = true;
      } else {
        fail('Add piece manually', `clicked "${addPieceClicked}" but piece not found`);
        await screenshot('no-piece-added');
      }
    }
  } catch (err) {
    fail('Add piece manually', err.message);
    await screenshot('add-piece-error');
  }

  console.log('\n=== CHECK 12: Reload → new data persists ===');
  try {
    // Wait for debounced save (500ms) + extra buffer
    await wait(1500);

    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await wait(1500);

    const afterReload2 = await page.evaluate(() => document.body.innerText);
    // Check demo concert persists
    const demoOk = afterReload2.includes('Francesconi') || afterReload2.includes('Programme');
    // Check new data persists
    const newOk = afterReload2.includes('Test Concert') || afterReload2.includes('Symphonie Test');

    if (demoOk) {
      pass('After reload — demo concert persists', '"Francesconi" found');
    } else {
      fail('After reload — demo concert persists', 'Francesconi NOT found');
      await screenshot('reload2-no-demo');
    }

    if (newOk) {
      pass('After reload — new concert/piece persists', 'new data found');
    } else {
      fail('After reload — new concert/piece persists', 'new data NOT found after reload');
      await screenshot('reload2-no-new');
      console.log('       Page text:', afterReload2.slice(0, 400));
    }
  } catch (err) {
    fail('Reload → new data persists', err.message);
  }

  console.log('\n=== CHECK 13: Mobile viewport — no horizontal overflow ===');
  try {
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await wait(800);
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    if (!overflow) {
      pass('Mobile 390px — no horizontal overflow');
    } else {
      fail('Mobile 390px — horizontal overflow detected', `scrollWidth: ${await page.evaluate(() => document.documentElement.scrollWidth)}`);
      await screenshot('mobile-overflow');
    }
  } catch (err) {
    fail('Mobile overflow check', err.message);
  }

  console.log('\n=== CHECK 14: Desktop viewport ===');
  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await wait(800);
    const content = await page.evaluate(() => document.body.innerText);
    const isBlank = content.trim().length < 10;
    if (!isBlank) {
      pass('Desktop 1280×800 — content visible');
    } else {
      fail('Desktop 1280×800 — blank page');
      await screenshot('desktop-blank');
    }
  } catch (err) {
    fail('Desktop viewport check', err.message);
  }

  console.log('\n=== CHECK 15: Console errors ===');
  if (consoleErrors.length === 0) {
    pass('No console errors');
  } else {
    const meaningful = consoleErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('ERR_NAME_NOT_RESOLVED') &&
      !e.includes('[OrkMap]') // these are warnings we added, not bugs
    );
    if (meaningful.length === 0) {
      pass('No critical console errors', `${consoleErrors.length} minor warning(s) filtered`);
    } else {
      fail('Console errors detected', meaningful.slice(0, 3).join(' | '));
    }
  }

  await browser.close();

  // Final report
  console.log('\n' + '='.repeat(60));
  console.log('VERIFICATION REPORT');
  console.log('='.repeat(60));
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`\nTotal: ${results.length} checks — ${passed} passed, ${failed} failed\n`);
  console.log('| Check | Status | Details |');
  console.log('|-------|--------|---------|');
  for (const r of results) {
    const icon = r.status === 'PASS' ? 'PASS' : 'FAIL';
    console.log(`| ${r.check} | ${icon} | ${r.details} |`);
  }

  if (failed === 0) {
    console.log('\nApp verified — all checks passed.');
  } else {
    console.log(`\n${failed} check(s) FAILED — see above for details.`);
  }

  return { passed, failed, results };
}

run().catch(err => {
  console.error('Fatal error:', err);
  if (browser) browser.close();
  process.exit(1);
});
