// scripts/launch_v2.mjs — launch "make.fun Ghost" (GHOST) on pump.fun via CreateV2.
//
// Why v2: pump.fun's current create is CreateV2 (Token-2022 + in-mint metadata
// extension). The old v1 create (Metaplex metadata account, fixed 2,576 bytes)
// costs ~0.0178 SOL; a real v2 create costs ~0.0056 SOL with no first buy.
// Verified against two live v2 creates on 2026-11-14 (OOPS, MEG) + the kit IDL
// (contracts/idl/pump.json, create_v2 discriminator [214,144,76,236,95,139,49,180]).
//
// Modes (run from the repo root):
//   node scripts/launch_v2.mjs simulate  — build + sign the create_v2 tx from
//       out/prepare.json and simulate it (no broadcast, no SOL spent)
//   node scripts/launch_v2.mjs launch    — build + sign + broadcast the create_v2
//       tx (buy amount 0), wait for finalization, verify on-chain, write LAUNCH.json
//
// The agent wallet keypair is loaded only to sign; its bytes are never printed.
// simulate broadcasts nothing. Only `launch` sends a transaction.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getUtf8Encoder,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RPC_URL = process.env.RPC_URL ?? 'https://solana-rpc.publicnode.com';
const KEYPAIR_PATH = process.env.MAKEFUN_KEYPAIR ?? join(ROOT, '..', 'makefun-keypair.json');
const OUT_DIR = join(ROOT, 'out');
const PREPARE_PATH = join(OUT_DIR, 'prepare.json');
const MINT_KEYPAIR_PATH = join(OUT_DIR, 'mint-keypair.json');
const LAUNCH_JSON_PATH = join(ROOT, 'LAUNCH.json');

const PUMP_PROGRAM = address('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const TOKEN_2022_PROGRAM = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ASSOCIATED_TOKEN_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
const MAYHEM_PROGRAM = address('MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e');
// Fixed pump.fun global accounts, verified identical in two live v2 creates
// (OOPS + MEG, 2026-11-14).
const GLOBAL_PARAMS = address('13ec7XdrjF3h3YcqBTFDSReRcUFwbCnJaAQspM4j6DDJ');
const SOL_VAULT = address('BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s');

const COIN_NAME = 'make.fun Ghost';
const COIN_SYMBOL = 'GHOST';
const COIN_DESCRIPTION = 'made for make.fun $1000 bounty';

// pump.fun `create_v2` discriminator (first 8 bytes of sha256("global:create_v2")),
// confirmed against the kit IDL and the decoded OOPS create transaction.
const CREATE_V2_DISCRIMINATOR = Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]);

function borshString(s) {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length, 0);
  return Buffer.concat([len, b]);
}

async function loadCreator() {
  const secret = Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, 'utf8')));
  return createKeyPairSignerFromBytes(secret);
}

async function deriveV2Accounts(mintAddress) {
  const utf8 = getUtf8Encoder();
  const addrEnc = getAddressEncoder();
  const [mintAuthority] = await getProgramDerivedAddress({
    programAddress: PUMP_PROGRAM,
    seeds: [utf8.encode('mint-authority')],
  });
  const [bondingCurve] = await getProgramDerivedAddress({
    programAddress: PUMP_PROGRAM,
    seeds: [utf8.encode('bonding-curve'), addrEnc.encode(mintAddress)],
  });
  const [associatedBondingCurve] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [addrEnc.encode(bondingCurve), addrEnc.encode(TOKEN_2022_PROGRAM), addrEnc.encode(mintAddress)],
  });
  const [global] = await getProgramDerivedAddress({
    programAddress: PUMP_PROGRAM,
    seeds: [utf8.encode('global')],
  });
  const [eventAuthority] = await getProgramDerivedAddress({
    programAddress: PUMP_PROGRAM,
    seeds: [utf8.encode('__event_authority')],
  });
  const [mayhemState] = await getProgramDerivedAddress({
    programAddress: MAYHEM_PROGRAM,
    seeds: [utf8.encode('mayhem-state'), addrEnc.encode(mintAddress)],
  });
  const [mayhemTokenVault] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [addrEnc.encode(SOL_VAULT), addrEnc.encode(TOKEN_2022_PROGRAM), addrEnc.encode(mintAddress)],
  });
  // Sanity: fixed PDAs must match the values seen in live v2 creates.
  if (String(mintAuthority) !== 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM') throw new Error(`mintAuthority mismatch: ${mintAuthority}`);
  if (String(global) !== '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf') throw new Error(`global mismatch: ${global}`);
  if (String(eventAuthority) !== 'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1') throw new Error(`eventAuthority mismatch: ${eventAuthority}`);
  return { mintAuthority, bondingCurve, associatedBondingCurve, global, eventAuthority, mayhemState, mayhemTokenVault };
}

async function buildCreateV2Tx({ creator, mintSigner, metadataUri }) {
  const rpc = createSolanaRpc(RPC_URL);
  const mintAddress = mintSigner.address;
  const accts = await deriveV2Accounts(mintAddress);
  // create_v2 args: name, symbol, uri (borsh strings), creator (pubkey),
  // is_mayhem_mode (bool), is_cashback_enabled (OptionBool = 1 byte),
  // creator_fee_bps (OptionU64 = 8 bytes LE), is_holder_reward (OptionBool = 1 byte).
  // Encoding confirmed by decoding the live OOPS create_v2 transaction.
  const feeBps = Buffer.alloc(8); // 0
  const data = Buffer.concat([
    CREATE_V2_DISCRIMINATOR,
    borshString(COIN_NAME),
    borshString(COIN_SYMBOL),
    borshString(metadataUri),
    Buffer.from(getAddressEncoder().encode(creator.address)),
    Buffer.from([0]), // is_mayhem_mode = false
    Buffer.from([0]), // is_cashback_enabled = false
    feeBps, // creator_fee_bps = 0
    Buffer.from([0]), // is_holder_reward = false
  ]);
  const ix = {
    programAddress: PUMP_PROGRAM,
    accounts: [
      { address: mintAddress, role: AccountRole.WRITABLE_SIGNER, signer: mintSigner },
      { address: accts.mintAuthority, role: AccountRole.READONLY },
      { address: accts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accts.associatedBondingCurve, role: AccountRole.WRITABLE },
      { address: accts.global, role: AccountRole.READONLY },
      { address: creator.address, role: AccountRole.WRITABLE_SIGNER, signer: creator },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: TOKEN_2022_PROGRAM, role: AccountRole.READONLY },
      { address: ASSOCIATED_TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: MAYHEM_PROGRAM, role: AccountRole.WRITABLE },
      { address: GLOBAL_PARAMS, role: AccountRole.READONLY },
      { address: SOL_VAULT, role: AccountRole.WRITABLE },
      { address: accts.mayhemState, role: AccountRole.WRITABLE },
      { address: accts.mayhemTokenVault, role: AccountRole.WRITABLE },
      { address: accts.eventAuthority, role: AccountRole.READONLY },
      { address: PUMP_PROGRAM, role: AccountRole.READONLY },
    ],
    data: new Uint8Array(data),
  };
  const { value: latest } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(creator, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
    (m) => appendTransactionMessageInstructions([ix], m),
  );
  const signed = await partiallySignTransactionMessageWithSigners(message);
  const wire = getBase64EncodedWireTransaction(signed);
  return { wire, accounts: accts, mintAddress, rpc };
}

async function cmdSimulate() {
  if (!existsSync(PREPARE_PATH)) throw new Error('run prepare first (out/prepare.json missing)');
  const prep = JSON.parse(readFileSync(PREPARE_PATH, 'utf8'));
  const creator = await loadCreator();
  const mintSecret = Uint8Array.from(JSON.parse(readFileSync(MINT_KEYPAIR_PATH, 'utf8')));
  const mintSigner = await createKeyPairSignerFromBytes(mintSecret);
  if (mintSigner.address !== prep.mint) throw new Error('mint keypair does not match prepare.json');
  const bal = await createSolanaRpc(RPC_URL).getBalance(creator.address).send();
  console.log(`creator: ${creator.address}`);
  console.log(`creator balance: ${Number(bal.value) / 1e9} SOL`);
  console.log(`mint: ${prep.mint}`);
  console.log(`metadataUri: ${prep.metadataUri}`);
  const { wire, mintAddress, accounts } = await buildCreateV2Tx({ creator, mintSigner, metadataUri: prep.metadataUri });
  console.log('accounts:', JSON.stringify(accounts, null, 1));
  const rpc = createSolanaRpc(RPC_URL);
  const sim = await rpc.simulateTransaction(wire, { encoding: 'base64', sigVerify: true }).send();
  const out = {
    mint: mintAddress,
    err: sim.value.err,
    logs: sim.value.logs ?? [],
    unitsConsumed: sim.value.unitsConsumed == null ? null : Number(sim.value.unitsConsumed),
  };
  console.log(`err: ${JSON.stringify(out.err, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
  console.log(`unitsConsumed: ${out.unitsConsumed}`);
  console.log('logs:');
  for (const l of out.logs) console.log(`  ${l}`);
  writeFileSync(join(OUT_DIR, 'simulate_v2.json'), JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  if (sim.value.err) {
    console.log('SIMULATION FAILED');
    process.exitCode = 2;
  } else {
    console.log('SIMULATION OK');
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function verifyMetadata(metadataUri) {
  const res = await fetch(metadataUri, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`metadataUri fetch failed: HTTP ${res.status}`);
  const meta = await res.json();
  if (meta.description !== COIN_DESCRIPTION) throw new Error(`metadata description mismatch: ${JSON.stringify(meta.description)}`);
  if (meta.name !== COIN_NAME || meta.symbol !== COIN_SYMBOL) throw new Error(`metadata name/symbol mismatch: ${meta.name}/${meta.symbol}`);
  if (!meta.image) throw new Error('metadata has no image field');
  return { meta };
}

async function cmdLaunch() {
  if (!existsSync(PREPARE_PATH)) throw new Error('run prepare first (out/prepare.json missing)');
  const prep = JSON.parse(readFileSync(PREPARE_PATH, 'utf8'));
  const creator = await loadCreator();
  const mintSecret = Uint8Array.from(JSON.parse(readFileSync(MINT_KEYPAIR_PATH, 'utf8')));
  const mintSigner = await createKeyPairSignerFromBytes(mintSecret);
  if (mintSigner.address !== prep.mint) throw new Error('mint keypair does not match prepare.json');
  const rpc = createSolanaRpc(RPC_URL);
  const balBefore = await rpc.getBalance(creator.address).send();
  console.log(`creator balance before: ${Number(balBefore.value) / 1e9} SOL`);
  const { wire, mintAddress, accounts } = await buildCreateV2Tx({ creator, mintSigner, metadataUri: prep.metadataUri });
  // Final simulation gate: never broadcast a tx that does not simulate clean.
  const sim = await rpc.simulateTransaction(wire, { encoding: 'base64', sigVerify: true }).send();
  if (sim.value.err) {
    console.log(`simulation failed, NOT broadcasting: ${JSON.stringify(sim.value.err)}`);
    console.log((sim.value.logs ?? []).join('\n'));
    process.exit(2);
  }
  console.log(`simulation OK (units: ${sim.value.unitsConsumed}), broadcasting...`);
  const signature = await rpc
    .sendTransaction(wire, { encoding: 'base64', preflightCommitment: 'confirmed', skipPreflight: false })
    .send();
  console.log(`signature: ${signature}`);
  console.log(`mint: ${mintAddress}`);
  // Record immediately so a crash after send never loses the mint + signature.
  writeFileSync(
    join(OUT_DIR, 'launch-state.json'),
    JSON.stringify({ mint: mintAddress, create_signature: signature, metadataUri: prep.metadataUri }, null, 2),
  );
  // Wait for finalization.
  let finalized = false;
  for (let i = 0; i < 45; i++) {
    const st = await rpc.getSignatureStatuses([signature]).send();
    const s = st.value[0];
    if (s?.confirmationStatus === 'finalized') {
      finalized = true;
      break;
    }
    if (s?.err) throw new Error(`transaction failed on-chain: ${JSON.stringify(s.err)}`);
    await sleep(2000);
  }
  if (!finalized) throw new Error('transaction did not finalize within ~90s');
  console.log('finalized');
  // Verify on-chain.
  const tx = await rpc.getTransaction(signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }).send();
  if (!tx || tx.meta?.err) throw new Error(`confirmed tx has error or is missing: ${JSON.stringify(tx?.meta?.err)}`);
  const mintInfo = await rpc.getAccountInfo(address(mintAddress)).send();
  if (!mintInfo.value) throw new Error('mint account does not exist on-chain');
  console.log(`mint account owner: ${mintInfo.value.owner} (expect ${TOKEN_2022_PROGRAM})`);
  if (mintInfo.value.owner !== TOKEN_2022_PROGRAM) throw new Error('mint account owner is not Token-2022');
  const check = await verifyMetadata(prep.metadataUri);
  console.log(`metadata re-verified: ${JSON.stringify(check.meta.description)}`);
  const balAfter = await rpc.getBalance(creator.address).send();
  const spent = (Number(balBefore.value) - Number(balAfter.value)) / 1e9;
  console.log(`creator balance after: ${Number(balAfter.value) / 1e9} SOL (spent ${spent} SOL)`);
  const launch = { mint: mintAddress, create_signature: signature };
  writeFileSync(join(ROOT, 'LAUNCH.json'), JSON.stringify(launch, null, 2) + '\n');
  writeFileSync(
    join(OUT_DIR, 'launch.json'),
    JSON.stringify({ ...launch, metadataUri: prep.metadataUri, spentSOL: spent, slot: tx.slot }, null, 2),
  );
  console.log(`LAUNCH.json written: ${JSON.stringify(launch)}`);
}

const mode = process.argv[2];
if (mode === 'simulate') await cmdSimulate();
else if (mode === 'launch') await cmdLaunch();
else {
  console.error('usage: node scripts/launch_v2.mjs <simulate|launch>');
  process.exitCode = 1;
}
