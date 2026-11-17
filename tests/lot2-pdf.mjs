// LOT 2, points 3 et 8 : extractFromPdf sur un vrai (petit) PDF construit à la main.
// En Node il n'y a pas de canvas : le rendu des pages échoue, ce qui permet de vérifier que
// chaque page perdue est comptée (pagesFailed) au lieu de disparaître en silence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOT, imp } from './lot2-helpers.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

globalThis.pdfjsWorker = await import(pathToFileURL(path.join(ROOT, 'node_modules/pdfjs-dist/build/pdf.worker.mjs')).href);
const P = await imp('src/pdfParser.js');

function makePdf(pages) {
  const objs = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((txt, i) => {
    const content = `BT /F1 12 Tf 50 700 Td (${txt}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
const fakePdfFile = (name, pages) => { const b = makePdf(pages); return { name, type: 'application/pdf', arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };

test('PDF de 3 pages : le nombre de pages est connu et toute page non rendue est listée', async () => {
  const r = await P.extractFromPdf(fakePdfFile('plan.pdf', ['Concert test', 'Page deux', 'Page trois']));
  assert.equal(r.pageCount, 3);
  assert.equal(r.planDataUrls.length + r.pagesFailed.length, 3, 'rendues + perdues = total');
  assert.deepEqual(r.planPageNumbers.concat(r.pagesFailed).sort(), [1, 2, 3].map(String).sort().map(Number));
});
test('PDF sans mention de chef ni de nomenclature : sansChef reste inconnu (null), plus true', async () => {
  const r = await P.extractFromPdf(fakePdfFile('plan.pdf', ['Concert test']));
  assert.equal(r.effectif, '');
  assert.equal(r.sansChef, null);
});
