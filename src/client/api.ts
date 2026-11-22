// Typed-enough fetch wrapper. All writes carry the X-Throughline header (server CSRF check).
export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["x-throughline"] = "1";
  if (body !== undefined && !isForm) headers["content-type"] = "application/json";
  const res = await fetch(`/api${path}`, { method, headers, body: isForm ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (csv/ics) */
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details);
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>("GET", p),
  post: <T = any>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  put: <T = any>(p: string, b: unknown) => request<T>("PUT", p, b),
  patch: <T = any>(p: string, b: unknown) => request<T>("PATCH", p, b),
  del: <T = any>(p: string, b?: unknown) => request<T>("DELETE", p, b),
  upload: <T = any>(p: string, form: FormData) => request<T>("POST", p, form, true),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.details;
    if (Array.isArray(d) && d.length) {
      const items = d.slice(0, 4).map((x: any) => (typeof x === "string" ? x : x.message ?? x.label ?? JSON.stringify(x)));
      return `${e.message}: ${items.join(" · ")}`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export function safeStorage(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — fine */
  }
  return value ?? null;
}
