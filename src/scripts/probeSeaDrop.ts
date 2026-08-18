import { Contract, id } from 'ethers';
import { getProvider } from '../flow/02-chain/provider.js';

const SEADROP = '0x00005EA00Ac477B1030CE78506496e8C2dE24bf5';
const ABI = [
  'function getPublicDrop(address) view returns (tuple(uint80 mintPrice,uint48 startTime,uint48 endTime,uint16 maxTotalMintableByWallet,uint16 feeBps,bool restrictFeeRecipients))',
  'function getCreatorPayoutAddress(address) view returns (address)',
  'function getAllowedFeeRecipients(address) view returns (address[])',
];

const TOKENS = process.argv.slice(2);

async function main() {
  console.log('getPublicDrop selector:', id('getPublicDrop(address)').slice(0, 10));
  const sd = new Contract(SEADROP, ABI, getProvider());

  for (const t of TOKENS) {
    try {
      const d = await sd.getFunction('getPublicDrop').staticCall(t);
      const now = Math.floor(Date.now() / 1000);
      const start = Number(d.startTime);
      const end = Number(d.endTime);
      const status = start > now ? 'UPCOMING' : end && end < now ? 'ENDED' : 'LIVE';
      console.log(
        '\n' + t + '  ' + status +
        '\n  price=' + d.mintPrice.toString() + ' wei' + (d.mintPrice === 0n ? '  (FREE)' : '') +
        '\n  start=' + new Date(start * 1000).toISOString() +
        '\n  end=  ' + new Date(end * 1000).toISOString() +
        '\n  maxPerWallet=' + d.maxTotalMintableByWallet + '  feeBps=' + d.feeBps +
        '\n  restrictFeeRecipients=' + d.restrictFeeRecipients,
      );
      const fees = await sd.getFunction('getAllowedFeeRecipients').staticCall(t);
      console.log('  feeRecipients=' + JSON.stringify(fees));
    } catch (err) {
      console.log('\n' + t + '  FAILED: ' + (err as Error).message.slice(0, 120));
    }
  }
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });
