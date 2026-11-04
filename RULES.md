# Splat rules

Two rollers paint a 16×16 board for 120 turns. The side with more painted tiles at the end wins; equal counts draw. A win scores 1, a draw ½ and a loss 0.

## A turn

Both bots choose a move at the same time: `N` (y − 1), `E` (x + 1), `S` (y + 1), `W` (x − 1) or `stay`. A move into a wall or off the board becomes `stay`.

## Paint and mass

Rollers start with mass 1, side 0 at (0, 0) and side 1 at (15, 15). After moving, a roller paints its tile:

- Unpainted tile: it becomes yours.
- Enemy tile: it becomes yours and your mass drops by 1, to a minimum of 1.
- Your own tile, having moved onto it: your mass rises by 1, to a maximum of 9.

## Collisions

Rollers collide when they reach the same tile or swap tiles. A squished roller returns home at mass 1 and sits out 8 turns. With equal mass, both are squished. Otherwise the heavier roller takes the tile and the lighter one is squished.

## What a bot sees

A bot sees the whole wall map, its own roller, and anything within 4 tiles (Manhattan distance): paint and the enemy's position and mass. Everything else is hidden, including the score. Walls are point-symmetric and differ by match.

## Writing a bot

A bot is one TypeScript file that default-exports a function. It takes a seed and returns a function from view to move. The bot may keep state between turns, and `bots/greedy.ts` is an example.

```ts
export default function createBot(seed: number) {
  return (view) => "E";
}
```

`view` is the `View` type in `src/sim.ts`. A turn has a 200 ms limit. A bot that throws passes the turn. A bot that exceeds the limit or crashes passes for the rest of the match. A bot may read only its own folder.
