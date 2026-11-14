'use strict';
const fs = require('node:fs');
const path = require('node:path');

const htmlFiles = [
  'index.html',
  'pages/login.html',
  'pages/register.html',
  'pages/customer-dashboard.html',
  'pages/pet-profile.html',
  'pages/health-records.html',
  'pages/booking.html',
  'pages/ai-assistant.html',
  'pages/providers.html',
  'pages/services.html'
];

const frontendDir = path.resolve(__dirname, '../../frontend');
let allOk = true;

console.log('=== VERIFYING FRONTEND CSP COMPLIANCE (NO UNSAFE-INLINE) ===');

for (const rel of htmlFiles) {
  const p = path.join(frontendDir, rel);
  if (!fs.existsSync(p)) {
    console.error(`[FAIL] MISSING FILE: ${rel}`);
    allOk = false;
    continue;
  }
  const html = fs.readFileSync(p, 'utf8');

  // Check inline script tags
  const inlineScriptMatch = html.match(/<script(?![^>]*src=)[\s\S]*?>[\s\S]*?<\/script>/gi);
  if (inlineScriptMatch) {
    console.error(`[FAIL] INLINE SCRIPT in ${rel}:`, inlineScriptMatch);
    allOk = false;
  }

  // Check inline event handlers
  const inlineHandlers = html.match(/\son[a-z]+\s*=\s*['"][^'"]*['"]/gi);
  if (inlineHandlers) {
    console.error(`[FAIL] INLINE HANDLER in ${rel}:`, inlineHandlers);
    allOk = false;
  }

  // Check javascript: pseudo-protocols
  const jsHrefs = html.match(/href\s*=\s*['"]javascript:/gi);
  if (jsHrefs) {
    console.error(`[FAIL] JAVASCRIPT PSEUDO-PROTOCOL in ${rel}:`, jsHrefs);
    allOk = false;
  }

  // Check referenced scripts exist on disk
  const srcMatches = [...html.matchAll(/<script[^>]+src=['"]([^'"]+)['"]/gi)];
  for (const m of srcMatches) {
    const scriptSrc = m[1];
    if (scriptSrc.startsWith('http')) continue;
    const baseDir = path.dirname(p);
    const resolvedScript = scriptSrc.startsWith('/')
      ? path.join(frontendDir, scriptSrc.slice(1))
      : path.resolve(baseDir, scriptSrc);
    if (!fs.existsSync(resolvedScript)) {
      console.error(`[FAIL] BROKEN SCRIPT REF in ${rel} -> "${scriptSrc}" (not found at ${resolvedScript})`);
      allOk = false;
    }
  }

  console.log(`[OK] ${rel.padEnd(32)}: ${srcMatches.length} external script(s), 0 inline script, 0 inline handler`);
}

if (!allOk) {
  console.error('\nVerification failed! Fix issues above.');
  process.exit(1);
}

console.log('\nAll 10 frontend HTML pages strictly comply with CSP (script-src \'self\') without unsafe-inline!');
