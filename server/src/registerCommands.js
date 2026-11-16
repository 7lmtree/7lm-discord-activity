import { registerSlashCommands } from "./discordBot.js";

try {
  const cmds = await registerSlashCommands();
  console.log(
    "Registered slash commands:",
    cmds.map((c) => c.name).join(", ")
  );
  process.exit(0);
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
