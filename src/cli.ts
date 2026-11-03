// node src/cli.ts <entries.json> [--seeds 10] [--out results/<name>.json]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Entry, runTournament } from "./tournament.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { seeds: { type: "string", default: "10" }, out: { type: "string" } },
});
const manifest = positionals[0];
if (!manifest) throw new Error("usage: cli.ts <entries.json> [--seeds n] [--out file]");
const base = dirname(resolve(manifest));
const entries = (JSON.parse(readFileSync(manifest, "utf8")) as Entry[]).map((entry) => ({ ...entry, file: resolve(base, entry.file) }));

const started = Date.now();
const result = await runTournament(entries, {
  seeds: Number(values.seeds),
  onMatch: (done, total) => done % 100 === 0 && console.error(`${done}/${total}`),
});
for (const row of result.leaderboard)
  console.log(
    `${row.model.padEnd(24)} ${row.mean.toFixed(1).padStart(5)} ± ${row.sd.toFixed(1)}  [${row.bots.map((b) => b.toFixed(0)).join(" ")}]`,
  );
console.log(JSON.stringify(result.vsReference, null, 2));
console.error(`${result.matches.length} matches in ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (values.out) {
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, JSON.stringify({ entries: entries.map(({ model, lab, attempt }) => ({ model, lab, attempt })), ...result }));
}
