// Reference bot: moves at random. Any written bot should beat it.
const MOVES = ["N", "E", "S", "W"] as const;

export default function createBot(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return MOVES[a >>> 30] ?? "N";
  };
}
