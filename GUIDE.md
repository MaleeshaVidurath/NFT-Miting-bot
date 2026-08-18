# RH Freemint Hunter — user guide

No coding needed. This walks you through everything.

---

## 1. One-time setup

**Install Node.js** (only once, on this computer):

1. Go to **https://nodejs.org**
2. Download the big green **LTS** button
3. Run the installer, click Next until it finishes

**Start the hunter:**

Double-click **`START-HUNTER.bat`**.

The first run takes about a minute while it installs itself. A black window
opens — that is normal. **Leave it open.** Your browser opens the dashboard at
`http://127.0.0.1:4663`.

Closing the black window shuts the bot down.

---

## 2. The dashboard

Five tabs across the top:

| Tab | What it shows |
| --- | --- |
| **Dashboard** | Whether it is running, your wallet, and what is opening soon |
| **Drops found** | Every collection it looked at and whether it qualified |
| **My mints** | What you actually minted |
| **Activity** | A live feed of what it is doing right now |
| **Settings** | All the knobs |

The coloured bar under the title is the important one:

- **Green "PRACTICE MODE"** — it only pretends to mint. Nothing is spent. Safe.
- **Red "LIVE MODE"** — it can spend real money from your wallet.

**It starts in practice mode.** Leave it there until you have watched it for a
while and trust what it does.

---

## 3. Changing the rules for paid mints

The **Dashboard** tab has a "Rules for paid mints" box with two controls:

- **Minimum credibility score** — a slider, 0 to 100
- **Most I will pay per mint** — a dollar amount

Free mints ignore both. They only apply to drops that cost money.

As you move them, a line underneath tells you what would change, based on the
drops the bot has already seen:

> Of the **9** drops still open that the bot has seen: **4 would qualify**
> (1 free, 3 paid). 1 rejected on score, 4 too expensive.

Nothing is saved until you press **Apply new rules**. **Undo** puts them back.

Once applied they take effect straight away — no need to stop and restart. The
new rules apply to the next drop found; drops already judged keep their verdict.

### Using your own currency

The price limit does not have to be in dollars. **Settings → Rules → Currency**
has 35 currencies including Sri Lankan Rupee, Indian Rupee, Euro, Pound, Yen
and Dirham.

When you change it, your existing limit is **converted automatically** so it
stays worth the same amount — $1 becomes about Rs 332, not "1 rupee". A line
under the dropdown tells you the new figure before you save.

After that, every price on the dashboard is shown in your currency.

If you want to change the currency *and* set a different limit at the same
time, just type the new limit as well — then it is used exactly as typed, with
no conversion.

**Rules of thumb**

- Higher credibility = safer, fewer mints. 75 is a sensible starting point.
- Lowering it below about 60 starts letting in projects with unverified
  contracts and no real holders.
- The price cap is your real spending protection. Keep it low.

*(The same two settings also live under Settings → Rules. Same thing, either
place works.)*

---

## 4. Trying it safely

1. Press **Start hunting**
2. Open the **Activity** tab and watch
3. Open **Drops found** after a minute

You will see collections appear with a score out of 100 and a YES/NO for
whether they qualify. In practice mode it says what it *would* have minted.

Press **Stop** whenever you like.

---

## 5. Going live (spending real money)

Only when you are ready.

**Step 1 — make a burner wallet.** A fresh wallet used only for this. Never
your main wallet. Put in a small amount of ETH on Robinhood Chain — enough for
transaction fees, no more. If anything goes wrong, that is the most you can lose.

**Step 2 — enter the key.** Settings tab → *Wallet private key* → paste it →
**Save settings**. It is stored only on your own computer.

**Step 3 — turn off practice mode.** Stop the bot first. Settings → turn
*Practice mode* **off** → Save → Start hunting again.

The bar turns red. It is now spending real money.

> **Always stop the bot before changing settings, then start it again.**

---

## 6. What the settings mean

**Network** — which blockchain to hunt on

| Setting | Meaning |
| --- | --- |
| Network | Pick from the dropdown. Robinhood Chain is the default. |

Available: Robinhood Chain, Robinhood Chain (testnet), Ethereum, Base, Arbitrum.

Everything follows automatically when you switch — the connection, the block
explorer used for credibility scores, and the OpenSea chain name.

**To switch networks:**

1. Press **Stop**
2. Settings → **Network** → pick one
3. Update **Where to scan for drops** to the matching chain link
4. **Save settings**
5. Press **Start hunting**

Things to know:

- **Your wallet is per-network.** The same wallet address exists on every
  chain, but its funds do not. Put ETH on the network you switch to.
- **Mint history is per-network too.** A collection you minted on Robinhood
  Chain does not exist on Base.
- **Robinhood Chain (testnet)** uses fake money. Good for practising with
  practice mode off, without risking anything real.

**Safety**

| Setting | Meaning |
| --- | --- |
| Practice mode | ON = pretend only. The master safety switch. |
| Gas budget per run | It stops minting after spending this much on fees. |
| Max mints per run | Hard stop after this many. |
| Max gas price | Never pay more than this per transaction. |

**Rules**

| Setting | Meaning |
| --- | --- |
| Minimum credibility | Paid drops scoring under this are skipped. Free drops ignore it. |
| Max price per paid mint | A paid drop above this price is never minted. |
| Block flagged free mints | Skip free drops flagged as scams. Recommended ON. |

**Drop source** — where it looks for new drops

| Setting | Meaning |
| --- | --- |
| Where to scan for drops | Paste an OpenSea link. See below. |
| OpenSea API address | Advanced. Leave it alone. |

Open OpenSea in your browser, go to the page you want watched, and copy the
address bar into this box. It accepts:

| What you paste | What it does |
| --- | --- |
| `https://opensea.io/collections/chain/robinhood` | watches every new drop on Robinhood Chain (default) |
| `https://opensea.io/collections/chain/base` | watches every new drop on Base |
| `https://opensea.io/collection/some-name` | watches only that one collection |
| `robinhood` | same as the chain link, just shorter |

As you type, a line underneath tells you what it understood. Green means good,
red means it could not read the link — fix it before saving.

**Careful:** changing this only changes where it *looks* for drops. Minting
still happens on the network the bot is connected to. If you point it at a
different chain, the box turns orange to warn you.

This setting only affects the OpenSea source. The bot also watches Robinhood
Chain directly, and that part always follows the connected network.

**Connections**

| Setting | Meaning |
| --- | --- |
| OpenSea API key | Optional extra source of drops. Free from OpenSea. |
| Custom RPC URL | Optional. Blank uses the public one. |
| Check every | How often to look for new drops. |

---

## 7. How it decides

```
Find a new or upcoming drop
        |
Is it free?
   YES ──────────────► eligible
   NO  ──► score 75+ AND under $1? ──► eligible
                                   └─► skip
        |
Have I already minted it? ── YES ──► skip
        |
        NO ──► mint 1 ──► save the result ──► next drop
```

The credibility score comes from things it can check itself: is the contract
verified, does it have proper metadata, are royalties set, does it have real
holders, is the supply sensible, is the mint window reasonable.

---

## 8. Problems

**"Node.js is not installed"** — do step 1.

**Browser shows "can't reach this page"** — give it 10 seconds and refresh. The
black window must stay open.

**Nothing appears in Drops found** — normal if no one is launching right now.
Leave it running. Check the Activity tab to confirm it is working.

**"Simulation reverted"** — it tried a mint that would have failed and correctly
backed out before spending anything. Nothing is wrong.

**It found a drop but skipped it** — the reason is in the Eligible column on the
Drops found tab. Usually the price or the credibility score.

---

## 9. Good habits

- Stay in practice mode until you understand what it does
- Burner wallet only, small amounts
- Your private key lives in the `.env` file on your computer — never share that
  file or a screenshot of the Settings tab
- Keep the dashboard on this computer only. It is not built to be exposed to
  the internet.
