import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { errorMessage } from "../api";

// ---------------- toast ----------------
type Toast = { id: number; text: string; bad?: boolean };
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, bad = false) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, bad }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), bad ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.bad ? "bad" : ""}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Mutation with toast on success/error and query invalidation. */
export function useAction<TVars = void, TRes = any>(fn: (v: TVars) => Promise<TRes>, opts: { success?: string | ((r: TRes) => string); invalidate?: unknown[][]; onSuccess?: (r: TRes) => void } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast(typeof opts.success === "function" ? opts.success(r) : opts.success);
      (opts.invalidate ?? []).forEach((k) => qc.invalidateQueries({ queryKey: k }));
      opts.onSuccess?.(r);
    },
    onError: (e) => toast(errorMessage(e), true),
  });
}

// ---------------- primitives ----------------
export function Button({ kind, size, busy, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "danger" | "ghost"; size?: "sm"; busy?: boolean }) {
  return (
    <button type="button" className={`btn ${kind ?? ""} ${size ?? ""}`} disabled={busy || rest.disabled} {...rest}>
      {busy && <span className="spinner" style={{ width: 12, height: 12 }} />}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {(title || actions) && (
        <div className="card-head">
          {typeof title === "string" ? <h2>{title}</h2> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export type Tone = "neutral" | "info" | "good" | "warn" | "bad" | "accent" | "muted";
export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`badge ${tone}`} title={title}>{children}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function TextInput({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} {...rest} />;
}
export function TextArea({ value, onChange, rows = 3, ...rest }: { value: string; onChange: (v: string) => void; rows?: number } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  return <textarea value={value ?? ""} rows={rows} onChange={(e) => onChange(e.target.value)} {...rest} />;
}
/** Edit a string[] as one item per line. */
export function ListInput({ value, onChange, rows = 3, placeholder }: { value: string[]; onChange: (v: string[]) => void; rows?: number; placeholder?: string }) {
  const [text, setText] = useState((value ?? []).join("\n"));
  useEffect(() => {
    if ((value ?? []).join("\n") !== text.split("\n").filter((x) => x.trim()).join("\n")) setText((value ?? []).join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <textarea
      rows={rows}
      value={text}
      placeholder={placeholder ?? "One per line"}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split("\n").map((x) => x.trim()).filter(Boolean));
      }}
    />
  );
}
export function Select<T extends string>({ value, onChange, options, ...rest }: { value: T | ""; onChange: (v: T) => void; options: { value: T | ""; label: string }[] } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="row muted" style={{ padding: 16 }}>
      <span className="spinner" /> {label}
    </div>
  );
}
export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="notice bad row between" role="alert">
      <span>{errorMessage(error)}</span>
      {retry && <Button size="sm" onClick={retry}>Retry</Button>}
    </div>
  );
}
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p className="muted" style={{ maxWidth: 520, margin: "0 auto 12px" }}>{children}</p>}
      {action}
    </div>
  );
}

/** Render loading / error / empty states for a query consistently. */
export function QueryView<T>({ q, empty, children }: { q: UseQueryResult<T>; empty?: (d: T) => ReactNode | false; children: (d: T) => ReactNode }) {
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const e = empty?.(q.data as T);
  if (e) return <>{e}</>;
  return <>{children(q.data as T)}</>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? "active" : ""} onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2>{title}</h2>
          <Button kind="ghost" size="sm" onClick={onClose} aria-label="Close">✕</Button>
        </div>
        <div className="stack">{children}</div>
        {footer && <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>{footer}</div>}
      </div>
    </div>
  );
}

export function ScorePill({ score, title }: { score: number | null | undefined; title?: string }) {
  if (score === null || score === undefined) return <span className="score" title={title}>—</span>;
  return <span className={`score ${score >= 70 ? "hi" : score >= 50 ? "mid" : "lo"}`} title={title}>{score}</span>;
}

export function Breakdown({ rows, labels }: { rows: { dimension: string; weight: number; rating: number | null; contribution: number; missing: boolean; reason?: string }[]; labels: Record<string, string> }) {
  return (
    <table className="small">
      <thead>
        <tr><th>Dimension</th><th>Weight</th><th style={{ width: "30%" }}>Rating (0–5)</th><th>Points</th><th>Why</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.dimension}>
            <td className="nowrap">{labels[r.dimension] ?? r.dimension}</td>
            <td>{r.weight}%</td>
            <td>
              <div className={`bar ${r.missing ? "missing" : ""}`} title={r.missing ? "No data — penalised" : String(r.rating)}><i style={{ width: `${((r.rating ?? 2) / 5) * 100}%` }} /></div>
              <span className="faint">{r.missing ? "unknown (penalised)" : r.rating}</span>
            </td>
            <td>{r.contribution}</td>
            <td className="muted">{r.reason ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  IDEA: "neutral", RESEARCHED: "neutral", BRIEF: "info", DRAFT: "info", QA: "warn", REVIEW: "warn", APPROVED: "good", SCHEDULED: "good", PUBLISHED: "good", ANALYZED: "muted", ARCHIVED: "muted",
  succeeded: "good", running: "accent", queued: "accent", failed: "bad", cancelled: "muted", paused: "warn", awaiting_approval: "warn", interrupted: "warn",
  connected: "good", available: "good", needs_credentials: "warn", needs_oauth: "warn", needs_provider_approval: "warn", not_implemented: "muted", demo_only: "muted", disconnected: "muted",
  draft: "info", approved: "good", superseded: "muted", proposed: "warn", rejected: "muted",
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

const KIND_TONE: Record<string, Tone> = { user_fact: "accent", fact: "good", observation: "info", inference: "warn", hypothesis: "muted" };
const KIND_LABEL: Record<string, string> = { user_fact: "User fact", fact: "Sourced fact", observation: "Observation", inference: "Inference", hypothesis: "Hypothesis" };
export function EvidenceBadge({ kind }: { kind: string }) {
  return <Badge tone={KIND_TONE[kind]}>{KIND_LABEL[kind] ?? kind}</Badge>;
}
export function ConfidenceBadge({ c }: { c: string }) {
  return <Badge tone={c === "high" ? "good" : c === "medium" ? "info" : "warn"} title="Confidence">{c} conf.</Badge>;
}

/** Only http(s) links are rendered as hrefs (defence in depth; the server also rejects other schemes). */
export const safeHref = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined);

export function fmtDate(iso?: string | null, withTime = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return withTime ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`);

export function download(name: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <Button size="sm" onClick={() => navigator.clipboard?.writeText(text).then(() => toast("Copied"), () => toast("Clipboard unavailable", true))}>{label}</Button>
  );
}
