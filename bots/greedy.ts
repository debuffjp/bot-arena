// Reference bot: steps to the adjacent open tile it has seen least of, preferring tiles that aren't its own colour.
// It ignores the enemy and mass. A hand-written stand-in until a model writes the 5-minute bot.
type Step = "N" | "E" | "S" | "W";
interface Tile {
  x: number;
  y: number;
  paint: 0 | 1 | null;
}
interface View {
  side: 0 | 1;
  self: { x: number; y: number };
  walls: readonly (readonly number[])[];
  visiblePaint: readonly Tile[];
}
const STEPS: readonly (readonly [Step, number, number])[] = [
  ["N", 0, -1],
  ["E", 1, 0],
  ["S", 0, 1],
  ["W", -1, 0],
];

export default function createBot(seed: number) {
  const visits = new Map<number, number>();
  let tie = seed >>> 0;
  return (view: View): Step | "stay" => {
    tie = (Math.imul(tie, 1664525) + 1013904223) >>> 0;
    const key = (x: number, y: number) => y * 16 + x;
    visits.set(key(view.self.x, view.self.y), (visits.get(key(view.self.x, view.self.y)) ?? 0) + 1);
    const paint = new Map(view.visiblePaint.map((t) => [key(t.x, t.y), t.paint]));
    let best: Step | "stay" = "stay";
    let bestScore = -Infinity;
    STEPS.forEach(([move, dx, dy], i) => {
      const x = view.self.x + dx;
      const y = view.self.y + dy;
      if (view.walls[y]?.[x] !== 0) return;
      const own = paint.get(key(x, y)) === view.side;
      const score = (own ? 0 : 10) - (visits.get(key(x, y)) ?? 0) + ((tie >>> (i * 4)) & 15) / 16;
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    });
    return best;
  };
}
