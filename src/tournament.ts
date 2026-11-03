import { type ChildProcess, fork } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type BotId, type GameResult, leaderboard, type ModelScore } from "./score.ts";
import { createMatch, isOver, MOVES, type Move, pointsFor, scoreOf, step, viewFor } from "./sim.ts";

const HOST = fileURLToPath(new URL("host.ts", import.meta.url));

export interface Entry extends BotId {
  /** Display label's owner, for logos: "openai", "anthropic", "reference"... */
  lab: string;
  file: string;
}

export interface MatchRecord {
  a: BotId;
  b: BotId;
  seed: number;
  /** Side 0's and side 1's moves as one letter per turn; S from "stay" is "-". */
  moves: [string, string];
  score: readonly [number, number];
  points: number;
  /** Turns each side lost to a timeout, crash or illegal move. */
  forfeits: [number, number];
}

const toLetter = (move: Move) => (move === "stay" ? "-" : move);

/** A bot's process. A timeout kills it, and it sits out the rest of that match: a stuck loop can't be interrupted politely. */
class BotProcess {
  private child: ChildProcess | undefined;
  private id = 0;
  private entry: Entry;
  private turnMs: number;
  constructor(entry: Entry, turnMs: number) {
    this.entry = entry;
    this.turnMs = turnMs;
  }

  async start(seed: number): Promise<void> {
    if (!this.child) await this.spawn();
    this.child?.send({ seed });
  }

  private spawn(): Promise<void> {
    const file = resolve(this.entry.file);
    const child = fork(HOST, [file], {
      execArgv: ["--permission", `--allow-fs-read=${dirname(file)}`, `--allow-fs-read=${dirname(HOST)}`],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    this.child = child;
    return new Promise((done) => {
      const timer = setTimeout(() => this.kill(), 5000);
      child.once("message", () => {
        clearTimeout(timer);
        done();
      });
      child.once("exit", () => {
        clearTimeout(timer);
        if (this.child === child) this.child = undefined;
        done();
      });
    });
  }

  ask(view: unknown): Promise<Move | null> {
    const child = this.child;
    if (!child?.connected) return Promise.resolve(null);
    const id = ++this.id;
    return new Promise((done) => {
      const timer = setTimeout(() => {
        finish(null);
        this.kill();
      }, this.turnMs);
      const onMessage = (message: { id?: number; move?: unknown }) => {
        if (message.id !== id) return;
        finish(MOVES.includes(message.move as Move) ? (message.move as Move) : null);
      };
      const onExit = () => finish(null);
      const finish = (move: Move | null) => {
        clearTimeout(timer);
        child.off("message", onMessage);
        child.off("exit", onExit);
        done(move);
      };
      child.on("message", onMessage);
      child.once("exit", onExit);
      child.send({ id, view });
    });
  }

  kill(): void {
    this.child?.kill();
    this.child = undefined;
  }
}

async function playMatch(a: BotProcess, b: BotProcess, seed: number): Promise<Omit<MatchRecord, "a" | "b">> {
  // Bots get different seeds from the match's, so they can't learn the map generator's stream.
  await Promise.all([a.start((seed ^ 0x51ed) >>> 0), b.start((seed ^ 0x2f9a) >>> 0)]);
  let state = createMatch(seed);
  const moves: [string, string] = ["", ""];
  const forfeits: [number, number] = [0, 0];
  while (!isOver(state)) {
    const answers = await Promise.all([a.ask(viewFor(state, 0)), b.ask(viewFor(state, 1))]);
    const played = answers.map((answer, side) => {
      if (answer === null) forfeits[side as 0 | 1]++;
      return answer ?? "stay";
    }) as [Move, Move];
    moves[0] += toLetter(played[0]);
    moves[1] += toLetter(played[1]);
    state = step(state, played).state;
  }
  return { seed, moves, score: scoreOf(state), points: pointsFor(state), forfeits };
}

export interface TournamentResult {
  seeds: number;
  matches: MatchRecord[];
  leaderboard: ModelScore[];
  /** Each model's points out of 100 against the reference bots, by reference bot. */
  vsReference: Record<string, Record<string, number>>;
}

const isReference = (entry: { model: string }) => entry.model.startsWith("reference:");

/** Every pair of bots from different models plays each seed from both sides. */
export async function runTournament(
  entries: readonly Entry[],
  options: { seeds: number; turnMs?: number; baseSeed?: number; onMatch?: (done: number, total: number) => void },
): Promise<TournamentResult> {
  const processes = new Map(entries.map((entry) => [entry, new BotProcess(entry, options.turnMs ?? 200)]));
  const pairs: [Entry, Entry][] = [];
  entries.forEach((a, i) => {
    for (const b of entries.slice(i + 1)) if (a.model !== b.model) pairs.push([a, b]);
  });
  const total = pairs.length * options.seeds * 2;
  const matches: MatchRecord[] = [];
  const base = options.baseSeed ?? 1;
  try {
    for (const [x, y] of pairs) {
      for (let s = 0; s < options.seeds; s++) {
        for (const [a, b] of [
          [x, y],
          [y, x],
        ] as const) {
          const played = await playMatch(processes.get(a) as BotProcess, processes.get(b) as BotProcess, base + s);
          matches.push({ a: { model: a.model, attempt: a.attempt }, b: { model: b.model, attempt: b.attempt }, ...played });
          options.onMatch?.(matches.length, total);
        }
      }
    }
  } finally {
    for (const process of processes.values()) process.kill();
  }

  const vs: Record<string, Record<string, { points: number; games: number }>> = {};
  const addVs = (model: string, reference: string, points: number) => {
    const row = vs[model] ?? {};
    vs[model] = row;
    const cell = row[reference] ?? { points: 0, games: 0 };
    row[reference] = cell;
    cell.points += points;
    cell.games += 1;
  };
  const games: GameResult[] = [];
  for (const match of matches) {
    const aRef = isReference(match.a);
    const bRef = isReference(match.b);
    if (!aRef && !bRef) games.push({ a: match.a, b: match.b, points: match.points });
    else if (aRef && !bRef) addVs(match.b.model, match.a.model, 1 - match.points);
    else if (bRef && !aRef) addVs(match.a.model, match.b.model, match.points);
  }
  const vsReference = Object.fromEntries(
    Object.entries(vs).map(([model, row]) => [
      model,
      Object.fromEntries(Object.entries(row).map(([ref, c]) => [ref, (100 * c.points) / c.games])),
    ]),
  );
  return { seeds: options.seeds, matches, leaderboard: leaderboard(games), vsReference };
}
