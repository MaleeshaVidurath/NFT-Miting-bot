/**
 * Builds a single self-contained executable.
 *
 *   node tools/package-exe.mjs
 *
 * The result needs nothing installed on the target machine - no Node, no
 * Docker. Everything, including the dashboard page, is inside the one file.
 *
 * Steps: bundle to one CommonJS file -> generate a SEA blob -> copy the node
 * binary -> inject the blob into it.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'build');
const NAME = process.platform === 'win32' ? 'RH-Freemint-Hunter.exe' : 'rh-freemint-hunter';
const EXE = join(OUT, NAME);

const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(1) + ' MB';
const step = (n, msg) => console.log('  [' + n + '/6] ' + msg);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1. Bundle. SEA does not resolve node_modules at runtime, so every dependency
//    must be inlined here.
step(1, 'Bundling application...');
await build({
  entryPoints: [join(ROOT, 'src', 'ui.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: join(OUT, 'app.cjs'),
  minify: true,
  legalComments: 'none',
  // Loaded from the embedded asset instead; see readDashboard() in server.ts.
  external: ['node:sea'],
  define: { 'process.env.NODE_ENV': '"production"' },
});
console.log('        bundle ' + mb(join(OUT, 'app.cjs')));

// 2. SEA config. The dashboard HTML rides along as an asset.
step(2, 'Writing SEA config...');
const cfg = {
  main: join(OUT, 'app.cjs'),
  output: join(OUT, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets: {
    'index.html': join(ROOT, 'src', 'web', 'public', 'index.html'),
  },
};
const cfgPath = join(OUT, 'sea-config.json');
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

// 3. Blob.
step(3, 'Generating executable blob...');
execFileSync(process.execPath, ['--experimental-sea-config', cfgPath], { stdio: 'inherit' });

// 4. Copy the node binary as the host for the blob.
step(4, 'Copying Node runtime...');
copyFileSync(process.execPath, EXE);

// 5. Inject.
step(5, 'Injecting application into executable...');
const postject = join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js');
if (!existsSync(postject)) throw new Error('postject not found - run: npm i -D postject');

execFileSync(
  process.execPath,
  [
    postject, EXE, 'NODE_SEA_BLOB', cfg.output,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ],
  { stdio: 'inherit' },
);

// Windows decides whether to allocate a console from a flag in the PE header.
// Node's binary is built as a console app; flipping it to GUI means the program
// runs with no black window at all. Logs are still visible in the dashboard's
// Activity tab, and startup failures raise a dialog instead of printing.
step(6, 'Removing the console window...');
{
  const buf = readFileSync(EXE);
  const peOffset = buf.readUInt32LE(0x3c);
  // 0x00004550 is the ASCII signature PE followed by two NULs, read as a little-endian word.
  if (buf.readUInt32LE(peOffset) !== 0x00004550) {
    throw new Error('Not a PE executable - cannot detach the console');
  }
  // Optional header starts after the 4-byte signature and 20-byte file header;
  // Subsystem sits 68 bytes into it. 2 = GUI, 3 = console.
  const subsystemAt = peOffset + 24 + 68;
  const current = buf.readUInt16LE(subsystemAt);
  if (current !== 2 && current !== 3) {
    throw new Error('Unexpected subsystem value ' + current + ' - refusing to patch');
  }
  buf.writeUInt16LE(2, subsystemAt);
  writeFileSync(EXE, buf);
  console.log('        subsystem ' + current + ' -> 2 (no console window)');
}

// Tidy the intermediates so build/ holds only what ships.
rmSync(cfg.output, { force: true });
rmSync(cfgPath, { force: true });
rmSync(join(OUT, 'app.cjs'), { force: true });

console.log('\n  Done: ' + EXE);
console.log('  Size: ' + mb(EXE));
console.log('\n  Give this one file to anyone. Nothing else to install.\n');
