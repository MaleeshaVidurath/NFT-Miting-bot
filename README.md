# RH Free Mint Hunter

Free-mint hunter for **Robinhood Chain** (Arbitrum-stack L2, chainId 4663),
scanning new collections via the OpenSea API. Also supports Ethereum, Base and
Arbitrum via `CHAIN=`.

Step 1 scaffold: chain connection, config with hard safety rails, a pluggable
detector interface, and a mint executor that simulates before it sends.

## Setup

```bash
npm install
cp .env.example .env   # then fill in RPC_HTTP_URL
npm run typecheck
npm start
```

`DRY_RUN=true` is the default. Nothing is broadcast until you explicitly set it
to `false`.

## Layout

| Path | Role |
| --- | --- |
| `src/config.ts` | env parsing + safety limits |
| `src/chain/provider.ts` | RPC providers, wallet, connection check |
| `src/detect/types.ts` | `Detector` / `MintCandidate` interfaces |
| `src/detect/index.ts` | detector registry |
| `src/detect/openseaCollections.ts` | polls OpenSea for new collections on the chain |
| `src/opensea/client.ts` | OpenSea API v2 wrapper (key required) |
| `src/mint/guard.ts` | per-run spend, gas-price and rate limits |
| `src/mint/executor.ts` | static-call simulation, then broadcast |
| `src/index.ts` | wiring + graceful shutdown |

## Safety rails

- `DRY_RUN` — simulate only (default `true`)
- `MAX_GAS_GWEI` — never pay above this gas price
- `MAX_MINT_VALUE_ETH` — hard cap on tx value; `0` for a true free mint
- `DAILY_GAS_BUDGET_ETH` — halts the bot once gas spend hits the cap
- `MAX_MINTS_PER_CONTRACT` / `MAX_MINTS_PER_RUN` — rate limits

Use a burner wallet. `PRIVATE_KEY` is read from `.env`, which is gitignored.

## Chain reference

| | |
| --- | --- |
| Chain ID | 4663 (`0x1237`) |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |
| Gas token | ETH |
| Stack | Arbitrum |
| OpenSea slug | `robinhood` |

Testnet is chainId 46630 at `https://rpc.testnet.chain.robinhood.com`.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | run the hunter |
| `npm run drops:upcoming -- 15000` | report scheduled drops, free ones first |
| `npm run drops:scan -- 3000` | inspect contracts minting in recent blocks |
| `npm run drops:eligible -- 12000` | apply the eligibility rules to live/upcoming drops |
| `npm run ledger` | show what the bot has minted/attempted |
| `npm run check:minted -- <token>` | verify the already-minted check on a real token |
| `npm run scan:check` | verify the OpenSea API side (needs a key) |

## Eligibility rules

```
                 New / upcoming drops
                          |
                  Analyze each project
                    /                            FREE MINT          PAID MINT
                  |          credibility >= 75/100
        credibility ignored     AND price <= $1
                  |                   |
              ELIGIBLE            ELIGIBLE
```

Credibility is scored 0-100 from weighted signals: contract verification (20),
creator payout address (15), holder traction (15), contract metadata (12), name
quality (10), supply sanity (10), mint window (10), royalties (8).

Signals that cannot apply - holder traction on a drop that has not opened yet -
are dropped from the denominator rather than scored zero, so an upcoming drop is
not punished for being early. A Blockscout scam flag is a hard veto,
independent of the numeric score.

Tunable via `MIN_CREDIBILITY` and `MAX_PAID_MINT_USD`. Prices convert through
live ETH/USD (CoinGecko), or pin the rate with `ETH_USD_PRICE`.

## Mint decision path

```
ELIGIBLE
   |
Wallet already minted it?
   |              YES            NO
   |             |
 SKIP         MINT 1
                 |
            Save result
                 |
            Move to next
```

"Already minted" is answered by the local ledger first, then `getMintStats(wallet)`
on-chain - authoritative for SeaDrop, and unlike `balanceOf` it is not fooled by
tokens transferred away or bought on the secondary market. `balanceOf` is the
fallback for non-SeaDrop collections.

Results persist to `data/mints.json` (gitignored) via temp-file + rename, so a
crash mid-write cannot corrupt it. Records are keyed by **wallet + contract**, so
several burner wallets can share one machine. A confirmed mint blocks retries; a
failure stays retryable up to `MAX_ATTEMPTS_PER_CONTRACT`.

Mints run on a serial queue - two concurrent `sendTransaction` calls from one
wallet would collide on the same nonce and one would be dropped.

## How upcoming drops are found

Robinhood Chain collections use **OpenSea SeaDrop v1**, deployed at the
canonical `0x00005EA00Ac477B1030CE78506496e8C2dE24bf5`. Two consequences:

- The mint schedule lives on the **SeaDrop** contract as
  `getPublicDrop(token)`, not on the token. Probing the token finds nothing.
- Minting goes through `SeaDrop.mintPublic(token, feeRecipient, 0, qty)`.
  Calling the token's `mintSeaDrop()` directly always reverts - only SeaDrop
  is authorised.

SeaDrop emits `PublicDropUpdated` when a creator **schedules** a drop, which is
normally before minting opens. That event is the upcoming-drop feed; waiting
for a first mint would only ever find drops that are already live.

## Next steps

3. Scoring/filtering — spam and honeypot rejection before the executor runs.
4. Mint-path support for OpenSea drop contracts (SeaDrop) alongside plain
   `mint()` collections.
5. Notifications and persistence.
