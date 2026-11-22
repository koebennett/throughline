// Deterministic secret scan over tracked + staged files. Exit 1 on findings.
// Used by `npm run check:secrets` and by the Claude Code PreToolUse hook before `git commit`.
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API key"],
  [/AIza[0-9A-Za-z_-]{35}/, "Google API key"],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "Private key"],
  [/ghp_[A-Za-z0-9]{36}/, "GitHub token"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\bCSA_SECRET_KEY=[0-9a-fA-F]{64}\b/, "Throughline secret key"],
];
const files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
const banned = files.filter((f) => /(^|\/)\.env$|secret\.key$|\.sqlite(-wal|-shm)?$/.test(f));
const hits = [];
for (const f of files) {
  if (!existsSync(f) || /node_modules|\.png$|\.jpg$|package-lock\.json$/.test(f)) continue;
  const text = readFileSync(f, "utf8");
  for (const [re, label] of PATTERNS) if (re.test(text)) hits.push(`${f}: possible ${label}`);
}
if (banned.length || hits.length) {
  console.error("Secret check FAILED:\n" + [...banned.map((f) => `${f}: must never be committed`), ...hits].join("\n"));
  process.exit(1);
}
console.log(`Secret check passed (${files.length} files).`);
