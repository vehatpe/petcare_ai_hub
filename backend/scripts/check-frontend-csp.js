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

function getAllJsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllJsFiles(fullPath));
    } else if (file.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

function verifyFrontendCsp() {
  const issues = [];

  // 1. Verify HTML files
  for (const rel of htmlFiles) {
    const p = path.join(frontendDir, rel);
    if (!fs.existsSync(p)) {
      issues.push(`[MISSING HTML] ${rel}`);
      continue;
    }
    const html = fs.readFileSync(p, 'utf8');

    // Inline <script> without src
    const inlineScriptMatch = html.match(/<script(?![^>]*src=)[\s\S]*?>[\s\S]*?<\/script>/gi);
    if (inlineScriptMatch) {
      issues.push(`[INLINE SCRIPT in HTML] ${rel}: ${inlineScriptMatch.join(', ')}`);
    }

    // Inline event handlers on...=
    const inlineHandlers = html.match(/\son[a-z]+\s*=\s*['"][^'"]*['"]/gi);
    if (inlineHandlers) {
      issues.push(`[INLINE HANDLER in HTML] ${rel}: ${inlineHandlers.join(', ')}`);
    }

    // javascript: pseudo-protocols
    const jsHrefs = html.match(/href\s*=\s*['"]javascript:/gi);
    if (jsHrefs) {
      issues.push(`[JAVASCRIPT PSEUDO-PROTOCOL in HTML] ${rel}: ${jsHrefs.join(', ')}`);
    }

    // Script refs exist
    const srcMatches = [...html.matchAll(/<script[^>]+src=['"]([^'"]+)['"]/gi)];
    for (const m of srcMatches) {
      const scriptSrc = m[1];
      if (scriptSrc.startsWith('http')) continue;
      const baseDir = path.dirname(p);
      const resolvedScript = scriptSrc.startsWith('/')
        ? path.join(frontendDir, scriptSrc.slice(1))
        : path.resolve(baseDir, scriptSrc);
      if (!fs.existsSync(resolvedScript)) {
        issues.push(`[BROKEN SCRIPT REF in HTML] ${rel} -> "${scriptSrc}"`);
      }
    }
  }

  // 2. Verify all JS files in frontend/js/**/*.js
  const jsDir = path.join(frontendDir, 'js');
  const jsFiles = getAllJsFiles(jsDir);

  const inlineHandlerRegex = /\son[a-z]+\s*=\s*["']/i;
  const jsPseudoProtocolRegex = /javascript:/i;

  for (const jsPath of jsFiles) {
    const rel = path.relative(frontendDir, jsPath).replace(/\\/g, '/');
    const content = fs.readFileSync(jsPath, 'utf8');

    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (inlineHandlerRegex.test(line)) {
        issues.push(`[INLINE HANDLER in JS string] ${rel}:${idx + 1} -> ${line.trim()}`);
      }
      if (jsPseudoProtocolRegex.test(line)) {
        issues.push(`[JAVASCRIPT PSEUDO-PROTOCOL in JS string] ${rel}:${idx + 1} -> ${line.trim()}`);
      }
    });
  }

  return { ok: issues.length === 0, issues };
}

if (require.main === module) {
  console.log('=== VERIFYING FRONTEND CSP COMPLIANCE (NO UNSAFE-INLINE / NO INLINE HANDLERS) ===');
  const { ok, issues } = verifyFrontendCsp();
  if (!ok) {
    console.error('\nVerification failed! Issues found:');
    issues.forEach((iss) => console.error(' - ' + iss));
    process.exit(1);
  }
  console.log('\nAll frontend HTML and JS files strictly comply with CSP (script-src \'self\') without unsafe-inline or inline handlers!');
}

module.exports = { verifyFrontendCsp, htmlFiles, getAllJsFiles };
