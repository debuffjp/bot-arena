// The writing phase. Each attempt gets a fresh folder with the rules, the simulation and the reference bots, and one agent with a time limit.
// node src/write-bots.ts --models models.json --out work/<name> [--attempts 5] [--minutes n]
// Spends real money: check provider dashboards before and after.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

export interface ModelSpec {
  /** Label on the clip and the leaderboard, such as "Claude Opus 5.5". */
  model: string;
  /** Logo file name: public/logos/<lab>.png. */
  lab: string;
  /** Command and arguments. The prompt arrives on stdin, in the attempt's folder. */
  command: string[];
}

export const prompt = (minutes?: number) => `Write the strongest bot you can for the game in RULES.md.${minutes ? ` You have ${minutes} minutes.` : ""}

Write it to bot/bot.ts as one file with no imports outside the Node standard library. src/sim.ts is the exact game, and you can use it to play your bot locally against bots/random.ts and bots/greedy.ts. Only bot/bot.ts is scored. You will face other strong bots on hidden maps.`;

function runAgent(
  spec: ModelSpec,
  cwd: string,
  minutes: number | undefined,
  text: string,
): Promise<{ code: number | null; seconds: number; timedOut: boolean }> {
  const started = Date.now();
  return new Promise((done) => {
    const [command, ...args] = spec.command;
    if (!command) throw new Error(`${spec.model} has no command`);
    const log = join(cwd, "transcript.jsonl");
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    let timedOut = false;
    const timer = minutes
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, minutes * 60_000)
      : undefined;
    child.on("close", (code) => {
      clearTimeout(timer);
      writeFileSync(log, output);
      done({ code, timedOut, seconds: (Date.now() - started) / 1000 });
    });
    child.stdin.end(text);
  });
}

const { values } = parseArgs({
  options: {
    models: { type: "string" },
    out: { type: "string" },
    attempts: { type: "string", default: "5" },
    minutes: { type: "string" },
  },
});
if (!values.models || !values.out) throw new Error("usage: write-bots.ts --models models.json --out work/<name>");
const root = resolve(import.meta.dirname, "..");
const specs = JSON.parse(readFileSync(values.models, "utf8")) as ModelSpec[];
const minutes = values.minutes ? Number(values.minutes) : undefined;
const entries: { model: string; lab: string; attempt: number; file: string }[] = [];
for (const spec of specs) {
  for (let attempt = 0; attempt < Number(values.attempts); attempt++) {
    const cwd = resolve(values.out, spec.model.replace(/\W+/g, "-"), String(attempt));
    mkdirSync(join(cwd, "bot"), { recursive: true });
    cpSync(join(root, "RULES.md"), join(cwd, "RULES.md"));
    cpSync(join(root, "src/sim.ts"), join(cwd, "src/sim.ts"));
    cpSync(join(root, "bots/random.ts"), join(cwd, "bots/random.ts"));
    cpSync(join(root, "bots/greedy.ts"), join(cwd, "bots/greedy.ts"));
    const run = await runAgent(spec, cwd, minutes, prompt(minutes));
    const file = join(cwd, "bot/bot.ts");
    console.log(
      `${spec.model} #${attempt}: exit ${run.code}, ${run.seconds.toFixed(0)} s${run.timedOut ? ", timed out" : ""}${existsSync(file) ? "" : ", NO BOT"}`,
    );
    if (existsSync(file)) entries.push({ model: spec.model, lab: spec.lab, attempt, file });
  }
}
writeFileSync(resolve(values.out, "entries.json"), JSON.stringify(entries, null, 2));
