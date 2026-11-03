import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runTournament } from "../src/tournament.ts";

const bots = join(import.meta.dirname, "../bots");
const entry = (model: string, file: string) => ({ model, lab: "test", attempt: 0, file });
const hostile = (source: string) => {
  const file = join(mkdtempSync(join(tmpdir(), "arena-")), "bot.ts");
  writeFileSync(file, source);
  return file;
};

describe("tournament", () => {
  it("plays each seed from both sides and greedy beats random", async () => {
    const result = await runTournament([entry("random", join(bots, "random.ts")), entry("greedy", join(bots, "greedy.ts"))], { seeds: 3 });
    expect(result.matches).toHaveLength(6);
    expect(result.leaderboard[0]?.model).toBe("greedy");
    expect(result.matches[0]?.moves[0]).toHaveLength(120);
  });

  it("forfeits a bot that hangs and still finishes the match", async () => {
    const stuck = hostile("export default () => () => { for (;;); };");
    const result = await runTournament([entry("stuck", stuck), entry("random", join(bots, "random.ts"))], { seeds: 1, turnMs: 100 });
    expect(result.matches[0]?.forfeits[0]).toBe(120);
    expect(result.leaderboard[0]?.model).toBe("random");
  });

  it("stops a bot reading files outside its folder", async () => {
    const snoop = hostile(`import { readFileSync } from "node:fs";
export default () => () => { readFileSync(${JSON.stringify(join(bots, "greedy.ts"))}); return "E"; };`);
    const result = await runTournament([entry("snoop", snoop), entry("random", join(bots, "random.ts"))], { seeds: 1 });
    expect(result.matches[0]?.moves[0]).toBe("-".repeat(120));
  });
});
