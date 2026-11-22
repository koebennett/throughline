// Structured JSON logging. Never pass secrets; known secret-looking keys are redacted defensively.
const REDACT = /(key|token|secret|password|authorization|cookie)/i;

function scrub(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrub(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) out[k] = REDACT.test(k) ? "[redacted]" : scrub(val, depth + 1);
  return out;
}

type Level = "debug" | "info" | "warn" | "error";
const quiet = () => process.env.CSA_LOG === "silent" || process.env.VITEST;

export const log = {
  write(level: Level, msg: string, data?: Record<string, unknown>) {
    if (quiet() && level !== "error") return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(data ? (scrub(data) as object) : {}) });
    (level === "error" ? console.error : console.log)(line);
  },
  info: (m: string, d?: Record<string, unknown>) => log.write("info", m, d),
  warn: (m: string, d?: Record<string, unknown>) => log.write("warn", m, d),
  error: (m: string, d?: Record<string, unknown>) => log.write("error", m, d),
};
