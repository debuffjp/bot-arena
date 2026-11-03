import { describe, expect, it } from "vitest";
import { leaderboard } from "../src/score.ts";
import {
  createMatch,
  isOver,
  type MatchState,
  MOVES,
  NONE,
  pointsFor,
  RESPAWN_TURNS,
  SIGHT,
  SIZE,
  scoreOf,
  step,
  TURNS,
  viewFor,
} from "../src/sim.ts";

const open = (): MatchState => ({ ...createMatch(1), walls: new Uint8Array(SIZE * SIZE) });
const at = (x: number, y: number, mass = 1) => ({ x, y, mass, respawn: 0 });

describe("splat rules", () => {
  it("replays identically from a seed and moves", () => {
    const play = () => {
      let state = createMatch(42);
      let n = 7;
      while (!isOver(state)) {
        n = (n * 31 + 11) % 101;
        state = step(state, [MOVES[n % 5] ?? "stay", MOVES[(n >> 2) % 5] ?? "stay"]).state;
      }
      return [...state.paint];
    };
    expect(play()).toEqual(play());
  });

  it("makes point-symmetric walls that leave both homes open", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { walls } = createMatch(seed);
      expect(walls[0]).toBe(0);
      for (let i = 0; i < walls.length; i++) expect(walls[i]).toBe(walls[walls.length - 1 - i]);
    }
  });

  it("does not move into edges or walls", () => {
    const start = createMatch(1);
    const { state } = step(start, ["N", "S"]);
    expect(state.rollers[0]).toMatchObject({ x: 0, y: 0 });
    expect(state.rollers[1]).toMatchObject({ x: SIZE - 1, y: SIZE - 1 });
  });

  it("swells on own paint only when moving and shrinks on enemy paint", () => {
    const paint = new Uint8Array(SIZE * SIZE).fill(NONE);
    paint[0] = 0;
    paint[1] = 0;
    paint[2] = 1;
    let state: MatchState = { ...open(), paint, rollers: [at(0, 0, 3), at(9, 9)] };
    state = step(state, ["stay", "stay"]).state;
    expect(state.rollers[0].mass).toBe(3);
    state = step(state, ["E", "stay"]).state;
    expect(state.rollers[0].mass).toBe(4);
    state = step(state, ["E", "stay"]).state;
    expect(state.rollers[0].mass).toBe(3);
    expect(state.paint[2]).toBe(0);
  });

  it("squishes the smaller roller on a collision and sends it home", () => {
    const state: MatchState = { ...open(), rollers: [at(4, 4, 5), at(6, 4, 2)] };
    const { state: next, events } = step(state, ["E", "W"]);
    expect(next.rollers[0]).toMatchObject({ x: 5, y: 4 });
    expect(next.rollers[1]).toMatchObject({ x: SIZE - 1, y: SIZE - 1, mass: 1, respawn: RESPAWN_TURNS });
    expect(events.some((e) => e.type === "squish" && e.winner === 0)).toBe(true);
  });

  it("catches rollers that swap tiles", () => {
    const state: MatchState = { ...open(), rollers: [at(4, 4, 2), at(5, 4, 5)] };
    const { state: next } = step(state, ["E", "W"]);
    expect(next.rollers[1]).toMatchObject({ x: 4, y: 4 });
    expect(next.rollers[0].respawn).toBe(RESPAWN_TURNS);
  });

  it("bounces equal rollers", () => {
    const state: MatchState = { ...open(), rollers: [at(4, 4, 3), at(6, 4, 3)] };
    const { state: next } = step(state, ["E", "W"]);
    expect(next.rollers[0]).toMatchObject({ x: 4, y: 4, respawn: 0 });
    expect(next.rollers[1]).toMatchObject({ x: 6, y: 4, respawn: 0 });
  });

  it("keeps a squished roller off the board until its respawn ends", () => {
    let state: MatchState = { ...open(), rollers: [at(4, 4, 5), at(6, 4, 2)] };
    state = step(state, ["E", "W"]).state;
    for (let i = 0; i < RESPAWN_TURNS; i++) state = step(state, ["stay", "N"]).state;
    expect(state.rollers[1]).toMatchObject({ x: SIZE - 1, y: SIZE - 1, respawn: 0 });
    state = step(state, ["stay", "N"]).state;
    expect(state.rollers[1].y).toBe(SIZE - 2);
  });

  it("hides the enemy and paint outside sight", () => {
    const state: MatchState = { ...open(), rollers: [at(0, 0), at(SIGHT + 1, 0)] };
    const view = viewFor(state, 0);
    expect(view.enemy).toBeNull();
    expect(view.visiblePaint.every((t) => t.x + t.y <= SIGHT)).toBe(true);
    expect(viewFor({ ...state, rollers: [at(0, 0), at(SIGHT, 0)] }, 0).enemy).toEqual({ x: SIGHT, y: 0, mass: 1 });
  });

  it("ends after TURNS and awards points by paint", () => {
    let state = createMatch(3);
    for (let i = 0; i < TURNS; i++) state = step(state, ["stay", "stay"]).state;
    expect(isOver(state)).toBe(true);
    expect(scoreOf(state)).toEqual([1, 1]);
    expect(pointsFor(state)).toBe(0.5);
  });
});

describe("leaderboard", () => {
  it("scores out of 100, ignores same-model games and ranks by mean", () => {
    const board = leaderboard([
      { a: { model: "x", attempt: 0 }, b: { model: "y", attempt: 0 }, points: 1 },
      { a: { model: "x", attempt: 1 }, b: { model: "y", attempt: 0 }, points: 0.5 },
      { a: { model: "x", attempt: 0 }, b: { model: "x", attempt: 1 }, points: 1 },
    ]);
    expect(board.map((m) => m.model)).toEqual(["x", "y"]);
    expect(board[0]?.bots).toEqual([100, 50]);
    expect(board[0]?.mean).toBe(75);
    expect(board[1]?.mean).toBe(25);
  });
});
