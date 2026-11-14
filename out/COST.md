# Launch cost — CORRECTED, measured live 2026-11-14

## The v1 number was the OLD method — do not use it

A plain pump.fun `create` (v1, Metaplex metadata account) costs **~0.017793 SOL**.
That is real — but pump.fun no longer creates coins that way.

## The current method: CreateV2 — ~0.0056 SOL, no first buy

Pump.fun's current create is **CreateV2** (same program
6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P, discriminator
[214,144,76,236,95,139,49,180]): Token-2022 mint with the metadata stored
IN the mint account as an extension. No separate Metaplex metadata account,
no 0.0137 SOL metadata rent.

Evidence (all live, 2026-11-14):
- OOPS coin (zw8FzjrfJSUS1YzXb9iTomjJt1wN8rybbSjcDaYpump), created today via
  CreateV2: creator spent 0.070049 SOL total including a ~0.059 SOL first buy.
  Non-buy accounts: mint 0.002647, mayhem_state 0.001189, mayhem_token_vault
  0.001514, bonding curve + ATA ~0.0015 each.
- MEG coin: same account layout, same fixed globals.
- A community member (Rnevanz, screenshot) was charged **0.00558 SOL**
  (~Rp8.000) for a no-buy launch — exactly the no-buy, mayhem-off total.
- Our own CreateV2 simulation (scripts/launch_v2.mjs simulate, mayhem off,
  buy 0, metadata https://files.catbox.moe/ryxczn.json): **SIMULATION OK**,
  err null, 101,442 compute units, with the wallet's current balance.

## What this means for us

- Wallet holds **0.011674 SOL** — already enough. **NO top-up needed.**
- Expected spend ~0.0056 SOL (~Rp8.000); remainder after launch ~0.006 SOL,
  which even funds one retry if the first attempt fails.
- Launch uses scripts/launch_v2.mjs (create_v2, Token-2022), NOT the v1
  scripts/launch.mjs. The v1 script and its 0.0178 SOL figure are obsolete.
- Metadata: https://files.catbox.moe/ryxczn.json (plain https, byte-identical
  to out/metadata.json on fetch-back).
