// main.ts — entrypoint for the make.fun coin-launch entry.
// Reads the launched coin's LAUNCH.json (mint + create signature) from the
// repository, checks both values are real, and writes the file to the
// harness output directory where the grader reads it. The coin itself is
// launched by the agent; this program only hands in the proof.
//
// In the grader's sandbox the repository is mounted read-only at /bot and
// the output directory is /output (writable), and neither MAKEFUN_BOT_DIR
// nor MAKEFUN_OUTPUT_DIR is set — so the defaults below must be /bot and
// /output, never a path inside the repository. Locally, test with:
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BOT_DIR = process.env.MAKEFUN_BOT_DIR ?? dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const launch = JSON.parse(readFileSync(join(BOT_DIR, 'LAUNCH.json'), 'utf8'));
if (!launch.mint || !launch.create_signature) {
  throw new Error('LAUNCH.json must contain mint and create_signature');
}
if (launch.mint.includes('REPLACE') || launch.create_signature.includes('REPLACE')) {
  throw new Error('LAUNCH.json still holds placeholders');
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const dest = join(OUTPUT_DIR, 'LAUNCH.json');
writeFileSync(dest, JSON.stringify(launch, null, 2) + '\n');
console.log(`wrote ${dest} for mint ${launch.mint}`);
