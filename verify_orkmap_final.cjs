const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Helper to find App fiber (the one with >= 12 useState hooks)
function findAppFiberJS() {
  const root = document.getElementById('root');
  const fiberKey = Object.keys(root).find(k => k.startsWith('__reactContainer'));
  if (!fiberKey) return null;
  function find(f, d = 0) {
    if (!f || d > 100) return null;
    let c = 0; let s = f.memoizedState; while (s) { c++; s = s.next; }
    if (c >= 12) return f;
    return find(f.child, d+1) || find(f.sibling, d+1);
  }
  return find(root[fiberKey]);
}

// Helper to get App hooks array
function getHooksJS(app) {
  const hooks = []; let s = app.memoizedState;
  while (s) { hooks.push(s); s = s.next; }
  return hooks;
}

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
    await sleep(1500);
    log('Page loads (HTTP 200)', res.status() === 200, `HTTP ${res.status()}`);
    const bodyText = await page.evaluate(() => document.body.innerText);
    log('"Mes concerts" visible', bodyText.includes('Mes concerts'));
  } catch(e) {
    log('Page loads + Mes concerts', false, e.message);
  }

  // ─── CHECK 2: Concert demo visible + navigation to concert detail ──────────
  try {
    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasConcertDemo = bodyText.includes('Programme Francesconi');
    log('Concert demo visible (Programme Francesconi)', hasConcertDemo);

    // Navigate to concert via React fiber dispatch
    await page.evaluate(new Function(`
      const app = (${findAppFiberJS.toString()})();
      if (!app) return;
      const hooks = (${getHooksJS.toString()})(app);
      // hook 6 = screen, hook 7 = concertId
      if (hooks[6]?.queue?.dispatch) hooks[6].queue.dispatch('home');
      if (hooks[7]?.queue?.dispatch) hooks[7].queue.dispatch('demo');
    `));
    await sleep(1500);

    const textAfterNav = await page.evaluate(() => document.body.innerText);
    const onConcertHome = textAfterNav.includes('ETYMO') || textAfterNav.includes('Nouvelle pièce') || textAfterNav.includes('Importer PDF');
    log('Concert navigation (home screen with pieces)', onConcertHome,
      onConcertHome ? 'found pieces list' : 'navigation failed');
    if (!onConcertHome) {
      console.log('  Text after nav:', textAfterNav.slice(0, 300));
      await page.screenshot({ path: '/tmp/fail-concert-nav.png' });
    } else {
      await page.screenshot({ path: '/tmp/check2-concert-home.png' });
    }
  } catch(e) {
    log('Concert demo + navigation', false, e.message);
  }

  // ─── CHECK 3: Bouton "Extraire par IA" visible sur une pièce avec plans ────
  try {
    // Navigate to piece "etymo" in screen="piece"
    await page.evaluate(new Function(`
      const app = (${findAppFiberJS.toString()})();
      if (!app) return;
      const hooks = (${getHooksJS.toString()})(app);
      if (hooks[8]?.queue?.dispatch) hooks[8].queue.dispatch('etymo'); // pieceId
      if (hooks[6]?.queue?.dispatch) hooks[6].queue.dispatch('piece'); // screen
    `));
    await sleep(1000);

    let text = await page.evaluate(() => document.body.innerText);
    const onPiece = text.includes('ETYMO') && (text.includes('Ajouter plan') || text.includes('instruments'));
    if (!onPiece) {
      log('Bouton "Extraire par IA" (navigation to piece)', false, 'could not navigate to piece screen');
    } else {
      // AI button only appears when piece has plans. Inject a fake plan.
      const hasAIAlready = text.includes('Extraire') || text.includes('🤖 Extraire');
      if (!hasAIAlready) {
        await page.evaluate(new Function(`
          const app = (${findAppFiberJS.toString()})();
          if (!app) return;
          const hooks = (${getHooksJS.toString()})(app);
          // hook 0 = concerts array
          const concerts = hooks[0]?.memoizedState;
          if (!concerts || !hooks[0]?.queue?.dispatch) return;
          const updated = concerts.map(c => c.id === 'demo' ? {
            ...c,
            pieces: c.pieces.map(p => p.id === 'etymo' ? { ...p, plans: ['data:image/png;base64,fake'] } : p)
          } : c);
          hooks[0].queue.dispatch(updated);
        `));
        await sleep(800);
        text = await page.evaluate(() => document.body.innerText);
      }
      const hasAI = text.includes('Extraire les données par IA') || text.includes('🤖 Extraire');
      log('Bouton "Extraire par IA" visible (pièce avec plans)', hasAI,
        hasAI ? 'button rendered correctly when plans present' : 'button not found even with plans');
      await page.screenshot({ path: '/tmp/check3-ai-button.png' });
    }
  } catch(e) {
    log('Bouton "Extraire par IA" visible', false, e.message);
  }

  // ─── CHECK 4: Bouton Archiver (📦) sur la liste des concerts ──────────────
  try {
    // Navigate back to concert list
    await page.evaluate(new Function(`
      const app = (${findAppFiberJS.toString()})();
      if (!app) return;
      const hooks = (${getHooksJS.toString()})(app);
      if (hooks[6]?.queue?.dispatch) hooks[6].queue.dispatch('concerts');
      if (hooks[7]?.queue?.dispatch) hooks[7].queue.dispatch(null);
      if (hooks[8]?.queue?.dispatch) hooks[8].queue.dispatch(null);
    `));
    await sleep(1000);
    const html = await page.content();
    const hasArchive = html.includes('📦') || (await page.evaluate(() => document.body.innerText)).includes('📦');
    log('Bouton Archiver (📦) présent', hasArchive, hasArchive ? 'found on concert list' : 'not found');
    if (!hasArchive) await page.screenshot({ path: '/tmp/fail-archive.png' });
  } catch(e) {
    log('Bouton Archiver (📦)', false, e.message);
  }

  // ─── CHECK 5: Mobile 375px, pas d'overflow horizontal ────────────────────
  try {
    await page.setViewport({ width: 375, height: 812 });
    await page.goto('http://localhost:5199', { waitUntil: 'networkidle0', timeout: 10000 });
    await sleep(1000);
    const overflow = await page.evaluate(() => ({
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
      bodyScrollW: document.body.scrollWidth,
    }));
    const hasOverflow = overflow.docScrollW > overflow.docClientW;
    log('Mobile 375px — no horizontal overflow', !hasOverflow,
      `docScrollW=${overflow.docScrollW}, clientW=${overflow.docClientW}`);
    await page.screenshot({ path: '/tmp/check5-mobile.png' });
  } catch(e) {
    log('Mobile 375px', false, e.message);
  }

  // ─── CHECK 6: 0 console errors ─────────────────────────────────────────────
  await page.setViewport({ width: 1280, height: 800 });
  const freshErrors = [];
  const page2 = await browser.newPage();
  page2.on('pageerror', err => freshErrors.push(err.message));
  page2.on('console', msg => { if (msg.type() === 'error') freshErrors.push('[console.error] ' + msg.text()); });
  await page2.goto('http://localhost:5199', { waitUntil: 'networkidle0', timeout: 10000 });
  await sleep(2000);
  await page2.close();

  const allErrors = [...errors, ...freshErrors].filter(e =>
    !e.includes('favicon') && !e.includes('manifest') &&
    !e.includes('service-worker') && !e.includes('sw.js') &&
    !e.toLowerCase().includes('warning')
  );
  log('0 console errors', allErrors.length === 0,
    allErrors.length === 0 ? 'clean' : allErrors.slice(0, 3).join(' | '));
  if (allErrors.length > 0) console.log('  Errors detail:', JSON.stringify(allErrors));

  // ─── Final report ──────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(56));
  console.log('RAPPORT FINAL');
  console.log('='.repeat(56));
  console.log('| Vérification                                  | Status |');
  console.log('|-----------------------------------------------|--------|');
  results.forEach(r => {
    const name = r.check.padEnd(45).slice(0, 45);
    const status = r.pass ? '  PASS  ' : '  FAIL  ';
    console.log(`| ${name} | ${status}|`);
    if (!r.pass && r.detail) console.log(`|   --> ${r.detail}`);
  });
  console.log('='.repeat(56));
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\nTotal: ${passed}/${results.length} passed, ${failed} failed`);
  if (failed === 0) console.log('App verified — all checks passed.');

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
