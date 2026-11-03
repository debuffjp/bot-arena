# Bot arena

Models write a TypeScript bot for [Splat](RULES.md), a small game with simultaneous turns and hidden paint. Each model writes 5 bots from fresh starts, and the bots play every bot from other models. The format follows [Polytopia Bench](https://x.com/kzdagoof/status/2117257994232881492), without its 40-minute limit: `--minutes` sets one if you want it, and the agent's own command should cap spend.

Everything is open: the rules, the runner, the prompt, the bots, the transcripts and the replays. Check any result by re-running it.

```bash
node src/cli.ts bots/entries.json --seeds 10                 # play a tournament
node src/write-bots.ts --models models.json --out work/run1  # agents write bots: spends money
node src/cli.ts work/run1/entries.json --out public/results.json
npm run clip                                                 # the clip, from public/results.json
```

`models.json` lists `{ model, lab, command }`. The agent runs `command` in its folder, with the prompt on stdin. Logos go in `public/logos/<lab>.png` and aren't committed. Without one, the clip draws a lettered mark.

## Scoring

A win is 1, a draw ½ and a loss 0. A bot's score is its points out of 100 against other models' bots. A model's score is the mean ± SD of its bots, and each bot is a dot on the leaderboard. Games against `reference:` bots are reported apart and don't count.

## Add a bot

Write one file to the contract in [RULES.md](RULES.md) and try it:

```bash
node src/cli.ts my-entries.json --seeds 20
```

`bots/entries.json` shows the entry format.

## Limits

- A bot runs in its own process and can read only its own folder. Node's permission flags on 24 don't block network access, so don't run bots you don't trust outside a sandbox.
- The turn limit uses wall-clock time, so a bot near 200 ms may time out on a busy machine. Recorded moves always replay exactly.
- `reference:greedy` is hand-written. The spec's 5-minute model bot doesn't exist until a pilot runs.
