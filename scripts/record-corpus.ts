/**
 * Record the filed-lines corpus.
 *
 *   npx tsx scripts/record-corpus.ts          # show what would change
 *   npx tsx scripts/record-corpus.ts --write  # accept it
 *
 * A data revision or a deliberate engine change FAILS the corpus gate on
 * purpose — the filed values really moved. Re-recording is how you accept that,
 * and the diff it prints is the record of what you accepted.
 *
 * Read the diff. Every time. A corpus re-recorded reflexively is worse than no
 * corpus: it is a green check that means nothing, and it will hide the one line
 * that moved for a reason nobody intended. That is the entire safety mechanism —
 * the default here is therefore DRY RUN, and `--write` is a second, deliberate act.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { diff, formatDeltas, type Recording, runAll } from '../tests/corpus/harness.js';

const DIR = join(import.meta.dirname, '../tests/corpus/recorded');
const write = process.argv.includes('--write');

mkdirSync(DIR, { recursive: true });

const fresh = runAll();
let changedScenarios = 0;
let changedLines = 0;
let newScenarios = 0;

for (const recording of fresh) {
  const file = join(DIR, `${recording.scenario}.json`);
  let previous: Recording | undefined;
  try {
    previous = JSON.parse(readFileSync(file, 'utf8')) as Recording;
  } catch {
    previous = undefined;
  }

  if (!previous) {
    newScenarios += 1;
    console.log(`NEW  ${recording.scenario} — ${Object.keys(recording.lines).length} lines`);
  } else {
    const deltas = diff(previous.lines, recording.lines);
    if (deltas.length > 0) {
      changedScenarios += 1;
      changedLines += deltas.length;
      console.log(formatDeltas(recording.scenario, deltas));
    }
  }

  if (write) writeFileSync(file, `${JSON.stringify(recording, null, 2)}\n`, 'utf8');
}

const total = fresh.reduce((n, r) => n + Object.keys(r.lines).length, 0);
console.log(
  `\n${fresh.length} scenarios, ${total} filed lines — ` +
    `${changedLines} changed across ${changedScenarios} scenario(s), ${newScenarios} new.`,
);
if (!write) console.log('Dry run. Re-run with --write to accept, after reading the diff above.');
