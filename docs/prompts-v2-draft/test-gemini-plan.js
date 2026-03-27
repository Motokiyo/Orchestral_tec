#!/usr/bin/env node
/**
 * test-gemini-plan.js — Standalone Gemini Vision test for orchestral stage plans
 * 
 * Usage:
 *   node test-gemini-plan.js path/to/plan.pdf [options]
 * 
 * Options:
 *   --prompt <file>     Use custom prompt file (default: prompts/default.txt)
 *   --page <n>          PDF page to extract (default: 1)
 *   --output <file>     Output JSON file (default: <input>-result.json)
 *   --tag <name>        Tag for result file (for comparison: <input>-result-<tag>.json)
 *   --raw               Also save raw Gemini response text
 *   --model <name>      Gemini model (default: gemini-2.5-flash-preview-05-20)
 *   --dry-run           Show prompt + image info without calling API
 * 
 * Environment:
 *   GOOGLE_API_KEY      Required — Gemini API key
 * 
 * Prerequisites:
 *   - pdftoppm (from poppler-utils): apt install poppler-utils
 *   - Node.js 18+
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Parse CLI args ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { pdfPath: null, prompt: null, page: 1, output: null, tag: null, raw: false, model: 'gemini-2.5-flash-preview-05-20', dryRun: false };
  const rest = argv.slice(2);
  
  for (let i = 0; i < rest.length; i++) {
    switch (rest[i]) {
      case '--prompt':  args.prompt = rest[++i]; break;
      case '--page':    args.page = parseInt(rest[++i], 10); break;
      case '--output':  args.output = rest[++i]; break;
      case '--tag':     args.tag = rest[++i]; break;
      case '--raw':     args.raw = true; break;
      case '--model':   args.model = rest[++i]; break;
      case '--dry-run': args.dryRun = true; break;
      case '--help':    printUsage(); process.exit(0);
      default:
        if (!rest[i].startsWith('-')) args.pdfPath = rest[i];
        else { console.error(`Unknown option: ${rest[i]}`); process.exit(1); }
    }
  }
  
  if (!args.pdfPath) { printUsage(); process.exit(1); }
  return args;
}

function printUsage() {
  console.log(`
Usage: node test-gemini-plan.js <plan.pdf> [options]

Options:
  --prompt <file>     Custom prompt file (default: prompts/default.txt)
  --page <n>          PDF page number (default: 1)
  --output <file>     Output JSON path
  --tag <name>        Tag for result filename (e.g. "default", "v2")
  --raw               Save raw Gemini text response too
  --model <name>      Gemini model name
  --dry-run           Preview without API call

Environment:
  GOOGLE_API_KEY      Gemini API key (required)
`);
}

// ── PDF to PNG via pdftoppm ─────────────────────────────────────────────────
function pdfToImage(pdfPath, page = 1) {
  const tmpPrefix = `/tmp/gemini-test-${Date.now()}`;
  
  try {
    execSync(`pdftoppm -png -f ${page} -l ${page} -r 200 "${pdfPath}" "${tmpPrefix}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000
    });
  } catch (err) {
    console.error('❌ pdftoppm failed. Is poppler-utils installed?');
    console.error('   Install: apt install poppler-utils (or brew install poppler)');
    process.exit(1);
  }
  
  // pdftoppm outputs: prefix-01.png or prefix-1.png
  const candidates = [
    `${tmpPrefix}-${String(page).padStart(2, '0')}.png`,
    `${tmpPrefix}-${page}.png`,
    `${tmpPrefix}-${String(page).padStart(3, '0')}.png`,
  ];
  
  const pngPath = candidates.find(f => fs.existsSync(f));
  if (!pngPath) {
    console.error('❌ Could not find converted PNG. Candidates:', candidates);
    process.exit(1);
  }
  
  const buffer = fs.readFileSync(pngPath);
  fs.unlinkSync(pngPath); // cleanup
  
  return buffer;
}

// ── Call Gemini API (raw fetch, no SDK needed) ──────────────────────────────
async function callGemini(prompt, imageBase64, mimeType, model, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: imageBase64 } }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 16384
    }
  };
  
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${errText.slice(0, 300)}`);
  }
  
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  
  return {
    raw: text,
    usage: data.usageMetadata || null,
    finishReason: data.candidates?.[0]?.finishReason || 'unknown'
  };
}

// ── Parse JSON with repair attempt ──────────────────────────────────────────
function parseJsonResponse(text) {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn('⚠️  JSON parse failed, attempting repair...');
    let repaired = cleaned;
    const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) repaired += '"';
    
    let opens = 0, closes = 0, openB = 0, closeB = 0;
    for (const ch of repaired) {
      if (ch === '[') opens++;
      if (ch === ']') closes++;
      if (ch === '{') openB++;
      if (ch === '}') closeB++;
    }
    repaired += ']'.repeat(Math.max(0, opens - closes));
    repaired += '}'.repeat(Math.max(0, openB - closeB));
    
    return JSON.parse(repaired); // will throw if still invalid
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  const startTime = Date.now();
  
  // Validate PDF exists
  if (!fs.existsSync(args.pdfPath)) {
    console.error(`❌ File not found: ${args.pdfPath}`);
    process.exit(1);
  }
  
  // Check API key
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey && !args.dryRun) {
    console.error('❌ GOOGLE_API_KEY not set. Export it first:');
    console.error('   export GOOGLE_API_KEY="your-key-here"');
    process.exit(1);
  }
  
  // Load prompt
  const promptPath = args.prompt || path.join(__dirname, 'prompts', 'default.txt');
  if (!fs.existsSync(promptPath)) {
    console.error(`❌ Prompt file not found: ${promptPath}`);
    process.exit(1);
  }
  const prompt = fs.readFileSync(promptPath, 'utf8');
  
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     🎵 Gemini Orchestral Plan Test Tool         ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`📄 PDF:    ${args.pdfPath}`);
  console.log(`📝 Prompt: ${promptPath} (${prompt.length} chars)`);
  console.log(`🤖 Model:  ${args.model}`);
  console.log(`📃 Page:   ${args.page}`);
  console.log('');
  
  // Convert PDF to image
  console.log('🔄 Converting PDF page to PNG...');
  const imageBuffer = pdfToImage(args.pdfPath, args.page);
  const imageBase64 = imageBuffer.toString('base64');
  console.log(`✅ Image: ${(imageBuffer.length / 1024).toFixed(0)} KB`);
  
  if (args.dryRun) {
    console.log('\n🏁 DRY RUN — would send to Gemini:');
    console.log(`   Prompt: ${prompt.length} chars`);
    console.log(`   Image:  ${imageBase64.length} chars base64 (${(imageBuffer.length / 1024).toFixed(0)} KB)`);
    console.log(`   Model:  ${args.model}`);
    return;
  }
  
  // Call Gemini
  console.log('\n🚀 Calling Gemini API...');
  const result = await callGemini(prompt, imageBase64, 'image/png', args.model, apiKey);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(`✅ Response received (${elapsed}s)`);
  console.log(`   Finish: ${result.finishReason}`);
  if (result.usage) {
    console.log(`   Tokens: prompt=${result.usage.promptTokenCount || '?'}, output=${result.usage.candidatesTokenCount || '?'}, total=${result.usage.totalTokenCount || '?'}`);
  }
  
  // Parse JSON
  let parsed;
  try {
    parsed = parseJsonResponse(result.raw);
    console.log('\n✅ JSON parsed successfully');
  } catch (e) {
    console.error('\n❌ JSON parse failed even after repair:', e.message);
    console.error('\nRaw response (first 500 chars):');
    console.error(result.raw.slice(0, 500));
    
    if (args.raw) {
      const rawPath = args.output ? args.output.replace('.json', '-raw.txt') : args.pdfPath.replace('.pdf', '-raw.txt');
      fs.writeFileSync(rawPath, result.raw);
      console.log(`💾 Raw response saved: ${rawPath}`);
    }
    process.exit(1);
  }
  
  // Display result
  console.log('\n' + '═'.repeat(60));
  console.log('📊 EXTRACTION RESULT');
  console.log('═'.repeat(60));
  
  console.log(`\n🎼 Titre:       ${parsed.titre || '(non détecté)'}`);
  console.log(`🎵 Compositeur: ${parsed.compositeur || '(non détecté)'}`);
  console.log(`⏱  Durée:       ${parsed.duree || '(non détecté)'}`);
  console.log(`🏛  Salle:       ${parsed.salle || '(non détecté)'}`);
  console.log(`🎤 Chef:        ${parsed.chef || '(non détecté)'}`);
  console.log(`📅 Date:        ${parsed.date || '(non détecté)'}`);
  console.log(`📋 Effectif:    ${parsed.effectif || '(non détecté)'}`);
  
  if (parsed.orchestre) {
    console.log('\n🎻 Orchestre:');
    if (parsed.orchestre.bois?.length) console.log(`   Bois:    ${parsed.orchestre.bois.join(', ')}`);
    if (parsed.orchestre.cuivres?.length) console.log(`   Cuivres: ${parsed.orchestre.cuivres.join(', ')}`);
    if (parsed.orchestre.cordes?.length) console.log(`   Cordes:  ${parsed.orchestre.cordes.join(', ')}`);
    if (parsed.orchestre.autres?.length) console.log(`   Autres:  ${parsed.orchestre.autres.join(', ')}`);
  }
  
  if (parsed.percus?.length) {
    console.log('\n🥁 Percussions:');
    for (const pole of parsed.percus) {
      const items = (pole.items || []).map(i => i.nom).join(', ');
      console.log(`   ${pole.nom}: ${items}`);
    }
  }
  
  // Determine output path
  let outputPath;
  if (args.output) {
    outputPath = args.output;
  } else if (args.tag) {
    outputPath = args.pdfPath.replace('.pdf', `-result-${args.tag}.json`);
  } else {
    outputPath = args.pdfPath.replace('.pdf', '-result.json');
  }
  
  // Save result
  const output = {
    _meta: {
      source: args.pdfPath,
      prompt: path.basename(promptPath),
      model: args.model,
      timestamp: new Date().toISOString(),
      elapsed_seconds: parseFloat(elapsed),
      tokens: result.usage || null,
      finishReason: result.finishReason
    },
    ...parsed
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n💾 Result saved: ${outputPath}`);
  
  // Save raw if requested
  if (args.raw) {
    const rawPath = outputPath.replace('.json', '-raw.txt');
    fs.writeFileSync(rawPath, result.raw);
    console.log(`💾 Raw response: ${rawPath}`);
  }
  
  // Full JSON dump
  console.log('\n' + '─'.repeat(60));
  console.log('📄 Full JSON:');
  console.log('─'.repeat(60));
  console.log(JSON.stringify(parsed, null, 2));
}

main().catch(err => {
  console.error('\n💥 Fatal error:', err.message);
  process.exit(1);
});
