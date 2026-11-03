// The social clip, in the reference's format: isometric board on black, a lab-against-lab bar, giant hands, then the leaderboard card.
// Plays real results: public/results.json comes from `node src/cli.ts <entries> --out public/results.json`.
import { Game, type Scene } from "@debuffjp/core";
import type { ModelScore } from "./score.ts";
import { createMatch, type MatchState, type Move, NONE, SIZE, scoreOf, step, TURNS } from "./sim.ts";
import type { MatchRecord } from "./tournament.ts";

interface Results {
  entries: { model: string; lab: string; attempt: number }[];
  matches: MatchRecord[];
  leaderboard: ModelScore[];
}

const results = (await (await fetch("results.json")).json()) as Results;
const labOf = (model: string) => results.entries.find((e) => e.model === model)?.lab ?? "";

/** Logos are files we don't ship: drop public/logos/<lab>.png in place. A missing one falls back to a lettered mark. */
const logos = new Map<string, HTMLImageElement>();
await Promise.all(
  [...new Set(results.entries.map((e) => e.lab))].map(
    (lab) =>
      new Promise<void>((done) => {
        const image = new Image();
        image.onload = () => {
          logos.set(lab, image);
          done();
        };
        image.onerror = () => done();
        image.src = `logos/${lab}.png`;
      }),
  ),
);

const W = 1280;
const H = 720;
const TW = 56;
const TH = 28;
const OX = W / 2;
const OY = 150;
const TURN_SECONDS = 0.09;
const CARD_SECONDS = 5;
const MATCHES_PER_CLIP = 2;
const COLOURS = [
  ["#ff6b1a", "#c94a08", "#9c3805"],
  ["#3a50ff", "#2233c4", "#182594"],
  ["#e9e6da", "#b9b5a6", "#9c9889"],
] as const;
const BAR = ["#ffa94a", "#7fa2ff"] as const;

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error('Missing <canvas id="game">');
const game = new Game({ canvas, width: W, height: H, background: "#000000", splash: false });

/** Closest different-lab matches make the best clips: a bar that swings beats a walkover. */
const featured = results.matches
  .filter((m) => m.a.model !== m.b.model && !m.a.model.startsWith("reference:") && !m.b.model.startsWith("reference:"))
  .sort((x, y) => Math.abs(x.score[0] - x.score[1]) - Math.abs(y.score[0] - y.score[1]))
  .slice(0, MATCHES_PER_CLIP);
if (featured.length === 0) throw new Error("results.json has no match between two models");

const fromLetter = (letter: string | undefined): Move =>
  letter === "N" || letter === "E" || letter === "S" || letter === "W" ? letter : "stay";

let matchIndex = 0;
let state: MatchState;
let previous: MatchState;
let clock = 0;
let cardClock = -1;
const pops = new Float32Array(SIZE * SIZE);
const lastSquish = [-99, -99];

function load(index: number): void {
  matchIndex = index;
  state = createMatch((featured[index] as MatchRecord).seed);
  previous = state;
  clock = 0;
  pops.fill(0);
  lastSquish.fill(-99);
}
load(0);

const iso = (x: number, y: number) => ({ x: OX + ((x - y) * TW) / 2, y: OY + ((x + y) * TH) / 2 });

game.add({
  id: "clip",
  update(dt) {
    if (cardClock >= 0) {
      cardClock += dt;
      if (cardClock > CARD_SECONDS) {
        cardClock = -1;
        load(0);
      }
      return;
    }
    clock += dt;
    for (let i = 0; i < pops.length; i++) pops[i] = Math.max(0, (pops[i] as number) - dt * 3.5);
    const match = featured[matchIndex] as MatchRecord;
    while (clock >= TURN_SECONDS && state.turn < TURNS) {
      clock -= TURN_SECONDS;
      previous = state;
      const turn = state.turn;
      const { state: next, events } = step(state, [fromLetter(match.moves[0][turn]), fromLetter(match.moves[1][turn])]);
      state = next;
      for (const event of events) {
        if (event.type === "paint") pops[event.y * SIZE + event.x] = 1;
        else lastSquish[event.winner] = turn;
      }
    }
    if (state.turn >= TURNS && clock > 0.8) {
      if (matchIndex + 1 < featured.length) load(matchIndex + 1);
      else cardClock = 0;
    }
  },
  render(draw) {
    if (cardClock >= 0) {
      renderCard(draw, cardClock / CARD_SECONDS);
      return;
    }
    renderSlab(draw);
    for (let sum = 0; sum < SIZE * 2 - 1; sum++) {
      for (let y = 0; y < SIZE; y++) {
        const x = sum - y;
        if (x >= 0 && x < SIZE) renderTile(draw, x, y);
      }
    }
    const t = Math.min(1, clock / TURN_SECONDS);
    const tips = [0, 1].map((side) => renderRoller(draw, side as 0 | 1, t));
    tips.forEach((tip, side) => {
      const turn = state.turn;
      // Hands reach in at moments that matter and otherwise leave the board in view.
      const reaching = turn - (lastSquish[side] as number) < 12 || (turn + side * 20) % 40 < 12;
      if (tip && reaching) renderHand(draw, tip.x, tip.y, side === 0 ? -1 : 1);
    });
    renderBar(draw);
  },
  inspect: () => ({ match: matchIndex, turn: state.turn, score: scoreOf(state), card: cardClock >= 0 }),
});
game.go("clip");
game.start();

type Draw = Parameters<NonNullable<Scene["render"]>>[0];

/** spryte has no polygon, so a face is a unit rect sheared onto its parallelogram. */
function face(draw: Draw, ox: number, oy: number, ax: number, ay: number, bx: number, by: number, colour: string): void {
  draw.push();
  draw.transform(ax, ay, bx, by, ox, oy);
  draw.rect(0, 0, 1, 1, colour);
  draw.pop();
}

function renderSlab(draw: Draw): void {
  const left = iso(0, SIZE);
  const front = iso(SIZE, SIZE);
  const right = iso(SIZE, 0);
  face(draw, left.x, left.y + 6, front.x - left.x, front.y - left.y, 0, 22, "#7a5a3c");
  face(draw, right.x, right.y + 6, front.x - right.x, front.y - right.y, 0, 22, "#5e432c");
}

function renderTile(draw: Draw, x: number, y: number): void {
  const i = y * SIZE + x;
  const p = iso(x, y);
  if (state.walls[i]) {
    renderBlock(draw, p.x, p.y);
    return;
  }
  const paint = state.paint[i] as number;
  const pop = pops[i] as number;
  const ramp = COLOURS[paint === NONE ? 2 : paint] ?? COLOURS[2];
  const height = (paint === NONE ? 4 : 10) + pop * 16;
  const top = p.y - pop * 12;
  face(draw, p.x - TW / 2, top + TH / 2, TW / 2, TH / 2, 0, height, ramp[1]);
  face(draw, p.x, top + TH, TW / 2, -TH / 2, 0, height, ramp[2]);
  face(draw, p.x, top, TW / 2, TH / 2, -TW / 2, TH / 2, pop > 0.5 ? "#ffffff" : ramp[0]);
}

function renderBlock(draw: Draw, x: number, y: number): void {
  const height = 26;
  const top = y - height + 6;
  face(draw, x - TW / 2, top + TH / 2, TW / 2, TH / 2, 0, height, "#3a3d33");
  face(draw, x, top + TH, TW / 2, -TH / 2, 0, height, "#2a2c25");
  face(draw, x, top, TW / 2, TH / 2, -TW / 2, TH / 2, "#55594b");
}

function renderRoller(draw: Draw, side: 0 | 1, t: number): { x: number; y: number } | null {
  const now = state.rollers[side];
  if (now.respawn > 0) return null;
  const was = previous.rollers[side];
  const gx = was.x + (now.x - was.x) * t + 0.5;
  const gy = was.y + (now.y - was.y) * t + 0.5;
  const p = iso(gx, gy);
  const size = 0.75 + now.mass * 0.08;
  const lift = 16 * size;
  const half = 20 * size;
  draw.circle(p.x, p.y + 3, half * 0.9, "#00000055");
  draw.line(p.x - half, p.y - lift, p.x + half, p.y - lift, 22 * size, "#111111");
  draw.line(p.x - half, p.y - lift, p.x + half, p.y - lift, 16 * size, COLOURS[side][0]);
  draw.line(p.x, p.y - lift, p.x, p.y - lift - 34, 5, "#f4f1e6");
  return { x: p.x, y: p.y - lift - 34 };
}

function renderHand(draw: Draw, x: number, y: number, side: -1 | 1): void {
  const skin = "#e8d6c4";
  // A short wrist, as in the reference: a full arm hides too much of the board.
  draw.line(x + side * 110, y - 90, x, y - 44, 44, "#d8c4b0");
  draw.circle(x, y - 40, 34, skin);
  for (let k = 0; k < 4; k++) {
    const fx = x - 24 + k * 16;
    draw.line(fx, y - 34, fx, y - 4, 13, skin);
    draw.circle(fx, y - 4, 6.5, skin);
  }
  draw.line(x - side * 30, y - 36, x - side * 36, y - 12, 15, skin);
}

function renderLabel(draw: Draw, model: string, x: number, align: "left" | "right", colour: string): void {
  const lab = labOf(model);
  const logo = logos.get(lab);
  const markX = align === "left" ? x + 22 : x - 22;
  if (logo) {
    draw.push();
    draw.translate(markX - 22, 12);
    draw.scale(44 / logo.naturalWidth, 44 / logo.naturalHeight);
    draw.sprite(logo, 0, 0);
    draw.pop();
  } else {
    draw.circle(markX, 34, 22, colour);
    renderText(draw, lab.slice(0, 1).toUpperCase() || "?", markX, 26, 2, "#000000", "center");
  }
  const textX = align === "left" ? x + 54 : x - 54;
  renderText(draw, model, textX, 22, 2, "#ffffff", align);
}

function renderText(draw: Draw, text: string, x: number, y: number, size: number, color: string, align: "left" | "center" | "right"): void {
  draw.push();
  draw.translate(x, y);
  draw.scale(size);
  draw.text(text, 0, 0, { color, align });
  draw.pop();
}

function renderBar(draw: Draw): void {
  const match = featured[matchIndex] as MatchRecord;
  const [a, b] = scoreOf(state);
  const share = a / Math.max(1, a + b);
  const x0 = 390;
  const width = 500;
  const y = 70;
  renderLabel(draw, match.a.model, 40, "left", BAR[0]);
  renderLabel(draw, match.b.model, W - 40, "right", BAR[1]);
  draw.rect(x0, y, width * share, 12, BAR[0]);
  draw.rect(x0 + width * share, y, width * (1 - share), 12, BAR[1]);
  draw.rect(x0 + width * share - 2, y - 4, 4, 20, "#ffffff");
  renderText(draw, `${Math.round(share * 100)}%`, x0 - 12, y - 6, 3, BAR[0], "right");
  renderText(draw, `${Math.round((1 - share) * 100)}%`, x0 + width + 12, y - 6, 3, BAR[1], "left");
}

function renderCard(draw: Draw, progress: number): void {
  const x = 170;
  const y = 70;
  const w = 940;
  const rows = results.leaderboard;
  const rowH = Math.min(56, 480 / Math.max(1, rows.length));
  const h = 150 + rows.length * rowH;
  const grow = Math.min(1, progress * 3);
  const bars = x + 310;
  const barW = 460;
  draw.rect(x, y, w, h, "#ffffff");
  renderText(draw, "Splat arena", x + 32, y + 24, 3, "#111111", "left");
  renderText(draw, `${rows.length} models  ${results.matches.length} games`, x + w - 32, y + 34, 2, "#666666", "right");
  rows.forEach((row, i) => {
    const ry = y + 100 + i * rowH;
    renderText(draw, row.model, x + 32, ry - 8, 2, "#111111", "left");
    draw.rect(bars, ry - 10, (barW * row.mean * grow) / 100, 20, "#ffd9c0");
    for (const bot of row.bots) {
      const dot = bars + (barW * bot * grow) / 100;
      draw.circle(dot, ry, 7, "#c94a08");
      draw.circle(dot, ry, 4, "#ffffff");
    }
    renderText(draw, `${row.mean.toFixed(1)} +- ${row.sd.toFixed(1)}`, x + w - 32, ry - 8, 2, "#111111", "right");
  });
  renderText(draw, "One dot per bot.  Win = 1  draw = 1/2  loss = 0", x + 32, y + h - 36, 2, "#666666", "left");
}
