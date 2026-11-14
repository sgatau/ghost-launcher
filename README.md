# Ghost Launcher — a Solana coin-launch agent

An agent that launches a real coin on pump.fun, cheaply and verifiably.
It was built for the make.fun "Race to launch a real coin on Solana" bounty
and launched a live coin on 2026-11-14. It is now entered as a Wildcard build
for Agent Games (zkVerify Season 01).

## What it launched (verified on-chain)

- **Coin:** make.fun Ghost (GHOST)
- **Mint:** `2sEvz1qTR4hSxYRPiHqbHunu64A66ERCoqiZRGakL1TZ`
- **Create transaction:** `yrTq8VJTaj44CQVqxvwR2R4CwMCmtFfoPgkiK1aPzEAC85dD2MJRw8rUwuzVUsuKzs2ZTVffZWAVhH5XaTQQzBt`
- **Launched:** 2026-11-14 04:31:19 UTC (slot 469194759), finalized, error-free
- **Creator:** `EeceLsEq3mVV1tqDzU8mGtgwKf5dra9CheNHKFTdm9ev`
- **Cost:** 0.00556244 SOL total — 0.00254508 mint rent + 0.00149352 bonding-curve
  ATA rent + 0.00151384 mayhem vault rent + 0.00001 SOL transaction fee
- **Token standard:** Token-2022, 6 decimals, supply 1,000,000,000,000,000,
  mint authority and freeze authority both null (revoked at creation)
- **Metadata:** name "make.fun Ghost", symbol "GHOST", description
  "made for make.fun $1000 bounty", image make.fun's ghost mascot
  (https://make.fun/press/mark-1024.png, unmodified) — stored on-chain in the
  mint account as a TokenMetadata extension, update authority null
  (immutable)
- **Verify it yourself:** https://pump.fun/coin/2sEvz1qTR4hSxYRPiHqbHunu64A66ERCoqiZRGakL1TZ
  or any Solana explorer with the mint / signature above.

## How it works

`scripts/launch_v2.mjs` (Node 22, `@solana/kit` 8.x) builds pump.fun's current
`create_v2` instruction by hand — no pump.fun SDK, no API:

1. **Prepare** — coin name/symbol/description and the metadata URI are fixed
   in `out/prepare.json`. The metadata JSON (`out/metadata.json`) is fetched
   back and checked byte-for-byte before anything is signed.
2. **Derive** — all 16 accounts are derived from the pump.fun program
   (bonding curve PDA, associated bonding curve, mayhem state/vault, global
   accounts). Fixed PDAs are asserted against the values seen in two live
   CreateV2 launches — if any derivation differs, the run aborts.
3. **Simulate** — `node scripts/launch_v2.mjs simulate` builds and signs the
   transaction and simulates it on-chain. A failed simulation never reaches
   broadcast. The recorded simulation (`out/simulate_v2.json`) passed with
   `err: null`, 101,442 compute units.
4. **Launch** — `node scripts/launch_v2.mjs launch` re-simulates, broadcasts,
   writes the mint + signature to `out/launch-state.json` *immediately after
   send* (so a crash can never lose the result), waits for finalization, then
   verifies on-chain: transaction error-free, mint account exists and is
   owned by Token-2022, metadata re-fetched and re-checked, balances
   re-read. Only then is `LAUNCH.json` written.
5. **Hand in** — `main.ts` validates `LAUNCH.json` (real mint + signature,
   no placeholders) and copies it to the harness output directory.

## The key decision: CreateV2, not the legacy create

pump.fun's old `create` (Metaplex metadata account, 2,576 bytes of rent)
costs ~0.0178 SOL. The current `create_v2` stores metadata inside the mint
account as a Token-2022 extension — no separate metadata account, no
0.0137 SOL of metadata rent. Same coin, ~3x cheaper: 0.0056 SOL with no
first buy. The difference was found by decoding two live CreateV2
transactions on-chain (OOPS, MEG, 2026-11-14) and confirmed in simulation
before the real launch. The legacy script is deliberately not included here.

## Run it

```sh
npm i @solana/kit@8.5.0
# needs a funded Solana keypair at $MAKEFUN_KEYPAIR (or ../makefun-keypair.json)
node scripts/launch_v2.mjs simulate   # no broadcast, no SOL spent
node scripts/launch_v2.mjs launch     # broadcasts a real transaction (~0.0056 SOL)
node main.ts                            # validates and hands in LAUNCH.json
```

The agent wallet keypair is loaded only to sign; its bytes are never
printed, logged, or copied. No keypair, API key, or credential is included
in this repository — `out/mint-keypair.json` (the mint's own keypair) is
excluded by design.

## Files

- `main.ts` — entrypoint: validates and hands in `LAUNCH.json`
- `scripts/launch_v2.mjs` — the launcher (simulate / launch)
- `LAUNCH.json` — the launched coin's mint + create signature (public)
- `out/prepare.json` — coin definition used at launch
- `out/simulate_v2.json` — the passing pre-launch simulation record
- `out/COST.md` — the CreateV2 vs legacy cost analysis
- `out/metadata.json` — the coin's metadata, as served at launch
- `LICENSE` — MIT

> Note: the mascot image is the make.fun press-kit ghost, unmodified, at
> https://make.fun/press/mark-1024.png — it is not bundled in this repo.

## Limits (stated plainly)

- This agent is a command-line program, not a hosted HTTPS service — there
  is no live public endpoint. Wrapping it in one is possible and not done.
- It launches coins; it does not trade, manage, or monitor them afterwards.
- It generates no zero-knowledge proof. The checkable claim is the on-chain
  record itself (mint + create transaction), which anyone can verify with a
  Solana RPC — see "What it launched" above.
