/**
 * Creates a fresh burner wallet and writes it straight into .env.
 *   npm run wallet:new
 *
 * The private key is never printed - it would otherwise sit in your terminal
 * scrollback and shell history. Only the public address is shown.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { Wallet } from 'ethers';
import { createInterface } from 'node:readline/promises';

const ENV = '.env';

async function main() {
  const existing = existsSync(ENV) ? readFileSync(ENV, 'utf8') : '';
  const current = /^PRIVATE_KEY=(.+)$/m.exec(existing)?.[1]?.trim();

  if (current) {
    const addr = (() => {
      try {
        return new Wallet(current).address;
      } catch {
        return '(unreadable)';
      }
    })();
    console.log('\n  A wallet is already configured: ' + addr);
    console.log('  Replacing it will LOSE ACCESS to anything held there,');
    console.log('  unless you have saved the key elsewhere.\n');

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('  Type REPLACE to continue, anything else to cancel: ')).trim();
    rl.close();
    if (answer !== 'REPLACE') {
      console.log('\n  Cancelled. Nothing changed.\n');
      return;
    }
  }

  const wallet = Wallet.createRandom();

  const lines = existing.split(/\r?\n/);
  let replaced = false;
  const next = lines.map((line) => {
    if (/^PRIVATE_KEY=/.test(line.trim())) {
      replaced = true;
      return 'PRIVATE_KEY=' + wallet.privateKey;
    }
    return line;
  });
  if (!replaced) next.push('PRIVATE_KEY=' + wallet.privateKey);

  const tmp = ENV + '.tmp';
  writeFileSync(tmp, next.join('\n'), 'utf8');
  renameSync(tmp, ENV);

  console.log('\n  Burner wallet created and saved to .env\n');
  console.log('    Address:  ' + wallet.address + '\n');
  console.log('  Send it a SMALL amount of ETH on the network you are hunting on.');
  console.log('  The private key is in your .env file. Never share that file.');
  console.log('  Restart the dashboard so it picks the wallet up.\n');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
