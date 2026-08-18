# Bot flow → code map

Every box in the flow diagram is one folder under `src/flow/`. Folders are
numbered in execution order, so the directory listing reads as the diagram.

```
                 RH FREEMINT HUNTER
                         │
                         ▼
              Scan OpenSea Drops              →  src/flow/01-scan/
                         │
                         ▼
              Robinhood Chain only            →  src/flow/02-chain/
                         │
                         ▼
              New / upcoming drops            →  src/flow/03-drops/
                         │
                         ▼
              Analyze each project            →  src/flow/04-analyze/
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
       FREE MINT                PAID MINT     →  src/flow/05-eligibility/
             │                       │
       credibility              credibility
         doesn't                 ≥ 75/100?
          matter                    │
             │                 AND ≤ $1
             │                       │
             ▼                       ▼
          ELIGIBLE               ELIGIBLE
             │                       │
             └───────────┬───────────┘
                         ▼
                 Wallet already                →  src/flow/06-wallet/
                 minted it?
                    /       \
                  YES        NO
                   │          │
                 SKIP       MINT 1             →  src/flow/07-mint/
                              │
                              ▼
                         Save result           →  src/flow/08-save/
                              │
                              ▼
                       Move to next            →  src/flow/09-next/
```

## Folder reference

| Step | Folder | Responsibility | Key files |
| --- | --- | --- | --- |
| 1 | `01-scan/` | Find candidate collections | `seaDropEvents.ts` (on-chain `PublicDropUpdated`), `openSeaDrops.ts` + `openSeaClient.ts` (OpenSea API) |
| 2 | `02-chain/` | Robinhood Chain access only | `provider.ts` - RPC, wallet, refuses to start on a chain-id mismatch |
| 3 | `03-drops/` | New / upcoming drops | `inspector.ts` (read mint schedule), `watchlist.ts` (arm before start), `types.ts` |
| 4 | `04-analyze/` | Score each project | `credibility.ts` (0-100 signals), `price.ts` (ETH→USD) |
| 5 | `05-eligibility/` | FREE / PAID decision | `rules.ts` - the branch logic |
| 6 | `06-wallet/` | Already minted? | `history.ts` - ledger → `getMintStats` → `balanceOf` |
| 7 | `07-mint/` | Mint 1 | `executor.ts` (simulate then send), `guard.ts` (spend caps) |
| 8 | `08-save/` | Save result | `ledger.ts` - crash-safe JSON ledger |
| 9 | `09-next/` | Move to next | `queue.ts` - serial queue, one mint at a time |

Outside the flow:

| Path | Role |
| --- | --- |
| `src/core/` | `config.ts`, `logger.ts` - used by every step |
| `src/pipeline.ts` | Wires steps 5-9 together; reads top to bottom like the diagram |
| `src/index.ts` | Entry point: starts detectors, routes candidates by drop status |
| `src/scripts/` | Diagnostics, each targeting one step |
| `src/hunter.ts` | The bot as a start/stop-able object, driven by CLI or UI |
| `src/web/` | Dashboard: HTTP server, settings validation, single-page UI |
| `src/core/events.ts` | Event bus - the flow publishes, the UI subscribes |

## Import rules

Each step folder has an `index.ts` barrel. Import a step through its barrel:

```ts
import { attemptMint } from './flow/07-mint/index.js';
```

A step may import an **earlier** step, never a later one.

Two folders are exceptions, because they are infrastructure rather than
sequential stages, and any step may import them:

- **`02-chain/`** - RPC access. Scanning needs a provider as much as minting does.
- **`08-save/`** - the ledger. Step 6 answers "already minted?" partly from
  saved results, so it reads the store that step 8 writes.

`core/` is likewise importable from anywhere.

`npm run flow:check` enforces this and exits non-zero on a violation, so the
structure cannot quietly rot. Current graph:

```
01-scan        -> 02-chain   [shared]
03-drops       -> 02-chain   [shared]
04-analyze     -> 02-chain   [shared]
04-analyze     -> 03-drops
05-eligibility -> 03-drops
05-eligibility -> 04-analyze
06-wallet      -> 02-chain   [shared]
06-wallet      -> 08-save    [shared]
07-mint        -> 02-chain   [shared]
07-mint        -> 03-drops
```

## Adding a step

1. Create `src/flow/NN-name/` with an `index.ts` barrel.
2. Add it to the table above and the diagram.
3. Wire it into `src/pipeline.ts` at the right position.
4. Run `npm run flow:check`.
