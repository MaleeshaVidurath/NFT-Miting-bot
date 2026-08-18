/**
 * Verifies the "wallet already minted it?" branch against real on-chain data.
 * Finds a genuine minter of a live drop and checks both answers.
 *   npm run check:minted -- <tokenAddress>
 */
import { Contract, Wallet, getAddress, id } from 'ethers';
import { getProvider } from '../flow/02-chain/provider.js';
import { config } from '../core/config.js';
import { hasWalletMinted } from '../flow/06-wallet/history.js';

const SEADROP_MINT = id('SeaDropMint(address,address,address,address,uint256,uint256,uint256,uint256)');

async function findMinter(token: string): Promise<string | undefined> {
  const provider = getProvider();
  const latest = await provider.getBlockNumber();
  for (let back = 0; back < 20000; back += config.logChunkSize) {
    const to = latest - back;
    const from = Math.max(0, to - config.logChunkSize + 1);
    const logs = await provider.getLogs({
      address: config.seaDropAddress,
      fromBlock: from,
      toBlock: to,
      topics: [SEADROP_MINT, '0x' + '0'.repeat(24) + token.slice(2).toLowerCase()],
    });
    const hit = logs[logs.length - 1];
    const minterTopic = hit?.topics[2];
    if (minterTopic) return getAddress('0x' + minterTopic.slice(26));
    if (from === 0) break;
  }
  return undefined;
}

async function main() {
  const token = getAddress(process.argv[2] ?? '');
  const name = await new Contract(token, ['function name() view returns (string)'], getProvider())
    .getFunction('name')
    .staticCall()
    .catch(() => 'unknown');

  console.log('\nToken ' + token + ' "' + name + '"\n');

  const minter = await findMinter(token);
  if (!minter) {
    console.log('  Could not find a minter in recent blocks.');
    return;
  }

  const yes = await hasWalletMinted(minter, token);
  console.log('  Real minter  ' + minter);
  console.log('    -> minted=' + yes.minted + ' via ' + yes.source + ' count=' + (yes.count ?? '-'));
  console.log('    -> expected YES branch: ' + (yes.minted ? 'SKIP  [correct]' : 'MINT  [WRONG]'));

  const fresh = Wallet.createRandom().address;
  const no = await hasWalletMinted(fresh, token);
  console.log('\n  Fresh wallet ' + fresh);
  console.log('    -> minted=' + no.minted + ' via ' + no.source + ' count=' + (no.count ?? '-'));
  console.log('    -> expected NO branch: ' + (no.minted ? 'SKIP  [WRONG]' : 'MINT 1  [correct]'));
  console.log();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
