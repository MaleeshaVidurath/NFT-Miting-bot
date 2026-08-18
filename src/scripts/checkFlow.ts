/**
 * Enforces the flow-folder dependency rule so the structure cannot rot.
 *   npm run flow:check
 *
 * Rule: a step may import an EARLIER step, never a later one.
 * Exception: shared layers below may be imported from anywhere - the RPC
 * provider and the ledger are infrastructure, not sequential stages.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const FLOW_DIR = 'src/flow';
const SHARED = new Set(['02-chain', '08-save']);

interface Violation {
  file: string;
  from: string;
  to: string;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry.endsWith('.ts')) out.push(p);
  }
  return out;
}

const stepOf = (p: string): string | undefined =>
  /flow[\\/](\d\d-[a-z]+)/.exec(p)?.[1];

const violations: Violation[] = [];
const edges = new Set<string>();

for (const file of walk(FLOW_DIR)) {
  const from = stepOf(file);
  if (!from) continue;
  const text = readFileSync(file, 'utf8');

  for (const m of text.matchAll(/from\s+'(\.[^']+)'/g)) {
    const target = resolve(join(file, '..'), m[1]!);
    const to = stepOf(relative(process.cwd(), target).split(sep).join('/'));
    if (!to || to === from) continue;

    edges.add(from + ' -> ' + to);
    if (SHARED.has(to)) continue;
    if (from < to) violations.push({ file, from, to });
  }
}

console.log('\nFlow dependency check\n');
for (const e of [...edges].sort()) {
  const to = e.split(' -> ')[1]!;
  console.log('  ' + e + (SHARED.has(to) ? '   [shared]' : ''));
}

if (violations.length === 0) {
  console.log('\n  OK - no step imports a later step.\n');
  process.exit(0);
}

console.log('\n  ' + violations.length + ' violation(s):\n');
for (const v of violations) {
  console.log('  ' + v.file + '\n    ' + v.from + ' must not import ' + v.to);
}
console.log();
process.exit(1);
