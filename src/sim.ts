// Splat's rules: a pure reducer with no rendering, so a match runs in Node and replays in the browser.

export const SIZE = 16;
export const TURNS = 120;
export const SIGHT = 4;
export const RESPAWN_TURNS = 8;
export const MAX_MASS = 9;

export type Side = 0 | 1;
export type Move = "N" | "E" | "S" | "W" | "stay";
export const MOVES: readonly Move[] = ["N", "E", "S", "W", "stay"];

/** A tile's paint: 0 or 1 for a side, NONE for unpainted. */
export const NONE = 2;

export interface Roller {
  x: number;
  y: number;
  mass: number;
  /** Turns left before a squished roller returns home; 0 means it is on the board. */
  respawn: number;
}

export interface MatchState {
  turn: number;
  /** SIZE × SIZE, indexed by y * SIZE + x. Shared between states: walls never change. */
  walls: Uint8Array;
  paint: Uint8Array;
  rollers: readonly [Roller, Roller];
}

export type MatchEvent = { type: "squish"; winner: Side; x: number; y: number } | { type: "paint"; side: Side; x: number; y: number };

/** Everything a bot may see. Paint and the enemy outside SIGHT stay hidden. */
export interface View {
  side: Side;
  turn: number;
  self: Roller;
  /** The enemy's position and mass when in sight, else null. */
  enemy: { x: number; y: number; mass: number } | null;
  /** Public: rows of 0 (open) and 1 (wall). */
  walls: readonly (readonly number[])[];
  /** Painted tiles in sight, as side numbers. Tiles out of sight are absent. */
  visiblePaint: readonly { x: number; y: number; paint: Side | null }[];
}

const DELTA: Record<Move, readonly [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0], stay: [0, 0] };
const HOME: readonly [readonly [number, number], readonly [number, number]] = [
  [0, 0],
  [SIZE - 1, SIZE - 1],
];

/** mulberry32: small, seedable, and the same on every engine. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function connected(walls: Uint8Array): boolean {
  const seen = new Uint8Array(walls.length);
  const stack = [0];
  seen[0] = 1;
  let count = 1;
  while (stack.length > 0) {
    const at = stack.pop() as number;
    const x = at % SIZE;
    const y = (at - x) / SIZE;
    for (const [dx, dy] of [DELTA.N, DELTA.E, DELTA.S, DELTA.W] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
      const i = ny * SIZE + nx;
      if (walls[i] || seen[i]) continue;
      seen[i] = 1;
      count++;
      stack.push(i);
    }
  }
  return count === walls.reduce((open, wall) => open + (wall ? 0 : 1), 0);
}

/** Walls are point-symmetric, so both sides start on equal ground and every seed is fair. */
function makeWalls(seed: number): Uint8Array {
  const random = rng(seed);
  for (;;) {
    const walls = new Uint8Array(SIZE * SIZE);
    for (let n = 0; n < 14; n++) {
      const i = Math.floor(random() * walls.length);
      walls[i] = 1;
      walls[walls.length - 1 - i] = 1;
    }
    walls[0] = 0;
    walls[walls.length - 1] = 0;
    if (connected(walls)) return walls;
  }
}

export function createMatch(seed: number): MatchState {
  const paint = new Uint8Array(SIZE * SIZE).fill(NONE);
  paint[0] = 0;
  paint[paint.length - 1] = 1;
  const roller = (side: Side): Roller => ({ x: HOME[side][0], y: HOME[side][1], mass: 1, respawn: 0 });
  return { turn: 0, walls: makeWalls(seed), paint, rollers: [roller(0), roller(1)] };
}

function target(state: MatchState, roller: Roller, move: Move): { x: number; y: number } {
  const [dx, dy] = DELTA[move];
  const x = roller.x + dx;
  const y = roller.y + dy;
  const blocked = x < 0 || y < 0 || x >= SIZE || y >= SIZE || state.walls[y * SIZE + x] === 1;
  return blocked ? { x: roller.x, y: roller.y } : { x, y };
}

/** Advances one turn. Both moves apply at once; an illegal move has already become "stay" in `target`. */
export function step(state: MatchState, moves: readonly [Move, Move]): { state: MatchState; events: MatchEvent[] } {
  const events: MatchEvent[] = [];
  const paint = state.paint.slice();
  const [a, b] = state.rollers;
  const next: [Roller, Roller] = [{ ...a }, { ...b }];

  const live = (r: Roller) => r.respawn === 0;
  if (live(a)) Object.assign(next[0], target(state, a, moves[0]));
  if (live(b)) Object.assign(next[1], target(state, b, moves[1]));

  if (live(a) && live(b)) {
    const sameTile = next[0].x === next[1].x && next[0].y === next[1].y;
    const swapped = next[0].x === b.x && next[0].y === b.y && next[1].x === a.x && next[1].y === a.y;
    if (sameTile || swapped) {
      if (a.mass === b.mass) {
        // Equal rollers bounce: nobody moves, so a collision can never be forced by size alone.
        Object.assign(next[0], { x: a.x, y: a.y });
        Object.assign(next[1], { x: b.x, y: b.y });
      } else {
        const winner: Side = a.mass > b.mass ? 0 : 1;
        const loser = (1 - winner) as Side;
        // The winner takes the tile the loser was heading for, or held in a swap.
        const at = { x: next[loser].x, y: next[loser].y };
        Object.assign(next[winner], swapped ? { x: state.rollers[loser].x, y: state.rollers[loser].y } : at);
        const [hx, hy] = HOME[loser];
        next[loser] = { x: hx, y: hy, mass: 1, respawn: RESPAWN_TURNS };
        events.push({ type: "squish", winner, x: next[winner].x, y: next[winner].y });
      }
    }
  }

  for (const side of [0, 1] as const) {
    const r = next[side];
    if (state.rollers[side].respawn > 0) {
      r.respawn = state.rollers[side].respawn - 1;
      continue;
    }
    if (r.respawn > 0) continue;
    const i = r.y * SIZE + r.x;
    const moved = r.x !== state.rollers[side].x || r.y !== state.rollers[side].y;
    if (paint[i] === side) {
      // Swelling needs movement, or a roller could sit still and grow.
      if (moved) r.mass = Math.min(MAX_MASS, r.mass + 1);
      continue;
    }
    // Taking enemy paint costs mass, so conquest and strength pull against each other.
    if (paint[i] !== NONE) r.mass = Math.max(1, r.mass - 1);
    paint[i] = side;
    events.push({ type: "paint", side, x: r.x, y: r.y });
  }

  return { state: { turn: state.turn + 1, walls: state.walls, paint, rollers: next }, events };
}

export function isOver(state: MatchState): boolean {
  return state.turn >= TURNS;
}

export function scoreOf(state: MatchState): readonly [number, number] {
  let a = 0;
  let b = 0;
  for (const tile of state.paint) {
    if (tile === 0) a++;
    else if (tile === 1) b++;
  }
  return [a, b];
}

/** 1 for a win, ½ for a draw, 0 for a loss, for side 0. Side 1 scores the complement. */
export function pointsFor(state: MatchState): number {
  const [a, b] = scoreOf(state);
  return a === b ? 0.5 : a > b ? 1 : 0;
}

export function viewFor(state: MatchState, side: Side): View {
  const self = state.rollers[side];
  const other = state.rollers[(1 - side) as Side];
  const inSight = (x: number, y: number) => Math.abs(x - self.x) + Math.abs(y - self.y) <= SIGHT;
  const visiblePaint: { x: number; y: number; paint: Side | null }[] = [];
  for (let y = Math.max(0, self.y - SIGHT); y <= Math.min(SIZE - 1, self.y + SIGHT); y++) {
    for (let x = Math.max(0, self.x - SIGHT); x <= Math.min(SIZE - 1, self.x + SIGHT); x++) {
      if (!inSight(x, y)) continue;
      const tile = state.paint[y * SIZE + x];
      visiblePaint.push({ x, y, paint: tile === NONE ? null : (tile as Side) });
    }
  }
  const walls: number[][] = [];
  for (let y = 0; y < SIZE; y++) walls.push(Array.from(state.walls.subarray(y * SIZE, (y + 1) * SIZE)));
  return {
    side,
    turn: state.turn,
    self: { ...self },
    enemy: other.respawn === 0 && inSight(other.x, other.y) ? { x: other.x, y: other.y, mass: other.mass } : null,
    walls,
    visiblePaint,
  };
}
