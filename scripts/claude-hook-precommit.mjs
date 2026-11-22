// Claude Code PreToolUse hook: before any `git commit`, run the secret scan. Exit 2 blocks the tool call.
import { execSync } from "node:child_process";
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = JSON.parse(input)?.tool_input?.command ?? "";
  } catch {
    process.exit(0);
  }
  if (!/\bgit\b[^|;&]*\bcommit\b/.test(cmd)) process.exit(0);
  try {
    execSync("node scripts/check-secrets.mjs", { stdio: "pipe" });
    process.exit(0);
  } catch (e) {
    process.stderr.write(String(e.stderr || e.stdout || e.message));
    process.exit(2);
  }
});
