
## The bot arena's game is a new one, in the open

`bench/bot-arena` follows Polytopia Bench's format (5 bots per model, points out of 100 with one dot per bot, an isometric clip with lab marks and hands) on Splat, a game written for it. Considered: Elo with confidence intervals (a less readable card, and different from the format people have already seen) and an existing game (people would know it, but we couldn't publish its rules and simulation for anyone to run). There is no required time limit, unlike the reference (maintainer's call); `--minutes` is optional. The rules, runner, prompt, bots and transcripts are all public, so results can be re-run and anyone can add a bot.

Bots run in one process each under Node's permission flags, which limit file reads. Node 24 has no flag that blocks network access, so community bots need a real sandbox before CI runs them.
