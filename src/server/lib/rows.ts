import { parseJson, type Row } from "../db/db.js";

const BOOL_KEYS = new Set(["is_demo", "excluded", "passed", "active"]);

/** Convert a DB row to an API DTO: snake_case → camelCase, *_json parsed, 0/1 flags → booleans. */
export function dto<T = any>(row: Row | undefined): T {
  if (!row) return row as T;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.endsWith("_json")) out[camel(k.slice(0, -5))] = parseJson(v as string, null);
    else if (BOOL_KEYS.has(k)) out[camel(k)] = !!v;
    else out[camel(k)] = v;
  }
  return out as T;
}
export const dtos = <T = any>(rows: Row[]) => rows.map((r) => dto<T>(r));
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
