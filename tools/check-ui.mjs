/**
 * Syntax-checks the dashboard's inline JavaScript.
 *
 *   node tools/check-ui.mjs
 *
 * A syntax error in that script kills the entire page - no buttons, no data,
 * just placeholders - and nothing else in the build would catch it, because
 * TypeScript never looks inside the HTML. This shipped once; not again.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HTML = resolve(import.meta.dirname, '..', 'src', 'web', 'public', 'index.html');
const html = readFileSync(HTML, 'utf8');

const blocks = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
if (blocks.length === 0) {
  console.error('  No <script> block found in ' + HTML);
  process.exit(1);
}

let failed = 0;

blocks.forEach((block, i) => {
  const code = block[1] ?? '';
  // Line number of the script's first line, so errors point at the real file.
  const startLine = html.slice(0, block.index).split('\n').length;

  try {
    // Parses without executing. Catches exactly the class of error that broke
    // the page: unterminated strings, stray tokens, unbalanced braces.
    new Function(code);
    const lines = code.split('\n').length;
    console.log('  OK    script block ' + (i + 1) + ' (' + lines + ' lines, from line ' + startLine + ')');
  } catch (err) {
    failed += 1;
    console.error('  FAIL  script block ' + (i + 1) + ' starting at line ' + startLine);
    console.error('        ' + err.message);
  }
});

// Common runtime trap: referencing an element id that the markup does not have.
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const used = new Set([...html.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]));

// Settings inputs are built at runtime as id="f_${field.key}", so their ids
// cannot appear literally in the markup. Only treat them as dynamic if that
// template is actually present - otherwise a genuine typo would slip through.
const buildsSettingsIds = /id="f_\$\{/.test(html);
const isDynamic = (id) => buildsSettingsIds && id.startsWith('f_');

const missing = [...used].filter((id) => !ids.has(id) && !isDynamic(id));

if (missing.length) {
  failed += 1;
  console.error('  FAIL  script uses ids that do not exist: ' + missing.join(', '));
} else {
  console.log('  OK    all ' + used.size + ' referenced element ids exist');
}

if (failed) {
  console.error('\n  Dashboard would be broken in the browser. Not shipping.\n');
  process.exit(1);
}
console.log('\n  Dashboard script is valid.\n');
