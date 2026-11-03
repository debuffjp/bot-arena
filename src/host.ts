// Runs one bot in its own process. The parent starts it with Node's permission flags, so a bot can read only its own folder.
import { pathToFileURL } from "node:url";
import type { Move, View } from "./sim.ts";

export type Decide = (view: View) => Move | Promise<Move>;
export type BotModule = { default: (seed: number) => Decide };

const file = process.argv[2];
if (!file) throw new Error("host.ts needs a bot file");
const createBot = ((await import(pathToFileURL(file).href)) as BotModule).default;
let decide: Decide | undefined;

process.on("message", async (message: { seed: number } | { id: number; view: View }) => {
  if ("seed" in message) {
    decide = createBot(message.seed);
    return;
  }
  let move: Move = "stay";
  try {
    move = await (decide as Decide)(message.view);
  } catch {
    // A throwing bot passes this turn and keeps playing.
  }
  process.send?.({ id: message.id, move });
});
process.send?.({ ready: true });
