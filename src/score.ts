// Scoring in the reference's format: points out of 100, mean ± SD across a model's bots.

export interface BotId {
  model: string;
  attempt: number;
}

export interface GameResult {
  a: BotId;
  b: BotId;
  /** Points for `a`: 1, ½ or 0. `b` takes the complement. */
  points: number;
}

export interface ModelScore {
  model: string;
  mean: number;
  sd: number;
  /** One score per bot: the dots on the leaderboard. */
  bots: number[];
}

/** Games between a model's own bots don't count: a model can't earn points from itself. */
export function leaderboard(games: readonly GameResult[]): ModelScore[] {
  const tally = new Map<string, Map<number, { points: number; games: number }>>();
  const add = (bot: BotId, points: number) => {
    const bots = tally.get(bot.model) ?? new Map();
    tally.set(bot.model, bots);
    const entry = bots.get(bot.attempt) ?? { points: 0, games: 0 };
    bots.set(bot.attempt, entry);
    entry.points += points;
    entry.games += 1;
  };
  for (const game of games) {
    if (game.a.model === game.b.model) continue;
    add(game.a, game.points);
    add(game.b, 1 - game.points);
  }
  return [...tally]
    .map(([model, bots]) => {
      const scores = [...bots.values()].map((bot) => (100 * bot.points) / bot.games);
      const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
      const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / Math.max(1, scores.length - 1);
      return { model, mean, sd: Math.sqrt(variance), bots: scores };
    })
    .sort((x, y) => y.mean - x.mean);
}
