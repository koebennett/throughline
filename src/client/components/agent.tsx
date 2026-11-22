// Reusable agent run UI: start a task, follow its persisted steps, handle approval gates and controls.
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Badge, Button, StatusBadge, useAction, fmtDate, TextInput } from "./ui";
import { useBrand } from "../context";

const ACTIVE = ["queued", "running"];

export function useRun(runId: string | null) {
  return useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.get(`/agent/runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (q) => (q.state.data && (ACTIVE.includes(q.state.data.status) || q.state.data.running) ? 800 : false),
  });
}

/** Button that launches an agent task and then shows its live progress inline. */
export function RunTaskButton({ task, input, label, kind = "primary", disabled, onDone, invalidate = [] }: { task: string; input: unknown; label: ReactNode; kind?: "primary" | "ghost"; disabled?: boolean; onDone?: (run: any) => void; invalidate?: unknown[][] }) {
  const { brandId, meta } = useBrand();
  const [runId, setRunId] = useState<string | null>(null);
  const start = useAction(() => api.post(`/brands/${brandId}/agent/runs`, { task, input }), { onSuccess: (r) => setRunId(r.id), invalidate: [["runs", brandId]] });
  return (
    <div className="stack" style={{ width: "100%" }}>
      <div className="row">
        <Button kind={kind === "ghost" ? undefined : "primary"} onClick={() => start.mutate()} busy={start.isPending} disabled={disabled}>{label}</Button>
        <Badge tone={meta?.model.live ? "good" : "warn"} title={meta?.model.label}>{meta?.model.live ? "Claude" : "Offline scaffold"}</Badge>
      </div>
      {runId && <RunProgress runId={runId} onDone={onDone} invalidate={invalidate} compact />}
    </div>
  );
}

export function RunProgress({ runId, onDone, invalidate = [], compact }: { runId: string; onDone?: (run: any) => void; invalidate?: unknown[][]; compact?: boolean }) {
  const qc = useQueryClient();
  const q = useRun(runId);
  const [notified, setNotified] = useState(false);
  const [note, setNote] = useState("");
  const inv = () => [["run", runId], ["runs"], ["home"], ...invalidate].forEach((k) => qc.invalidateQueries({ queryKey: k }));
  const control = useAction((action: string) => api.post(`/agent/runs/${runId}/${action}`), { invalidate: [["run", runId]], onSuccess: inv });
  const decide = useAction((decision: "approve" | "reject") => api.post(`/agent/runs/${runId}/decision`, { decision, note }), { success: (r) => (r.status === "succeeded" ? "Approved and applied" : r.status === "cancelled" ? "Rejected — nothing applied" : "Recorded"), onSuccess: inv });
  const run = q.data;
  if (!run) return <div className="faint">Starting…</div>;
  const done = !ACTIVE.includes(run.status) && !run.running;
  if (done && !notified) {
    setNotified(true);
    inv();
    if (run.status === "succeeded" || run.status === "awaiting_approval") onDone?.(run);
  }
  const gateStep = run.steps.find((s: any) => s.status === "awaiting_approval");
  return (
    <div className="list-item" data-testid="run-progress">
      <div className="row between">
        <div className="row">
          <StatusBadge status={run.status} />
          <span className="faint">{run.provider === "offline-scaffold" ? "Offline scaffold" : run.provider} · ${Number(run.costUsd).toFixed(3)} · {run.modelCalls} model call(s)</span>
        </div>
        <div className="row">
          {ACTIVE.includes(run.status) && <Button size="sm" onClick={() => control.mutate("pause")}>Pause</Button>}
          {["paused", "interrupted"].includes(run.status) && <Button size="sm" onClick={() => control.mutate("resume")}>Resume</Button>}
          {run.status === "failed" && <Button size="sm" onClick={() => control.mutate("resume")}>Retry from failed step</Button>}
          {!["succeeded", "failed", "cancelled"].includes(run.status) && <Button size="sm" kind="danger" onClick={() => control.mutate("cancel")}>Cancel</Button>}
          {compact && <Link className="small" to={`/agent?run=${run.id}`}>Inspect</Link>}
        </div>
      </div>
      <div className="steps" style={{ marginTop: 8 }}>
        {run.steps.map((s: any) => (
          <div className="step" key={s.id}>
            <span className={`step-dot ${s.status}`} />
            <div>
              <div className="row">
                <b>{s.label}</b>
                {s.attempts > 1 && <Badge tone="warn">attempt {s.attempts}</Badge>}
                {s.output?.summary && <span className="muted small">— {s.output.summary}</span>}
              </div>
              {s.error && <div className="small" style={{ color: "var(--bad)" }}>{s.error}</div>}
              {!compact && s.output?.notes?.length > 0 && (
                <ul className="small muted" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {s.output.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}
                </ul>
              )}
              {compact && s.output?.notes?.length > 0 && <div className="faint clamp2">{s.output.notes.join(" · ")}</div>}
            </div>
          </div>
        ))}
      </div>
      {run.error && run.status !== "succeeded" && <div className="notice bad small" style={{ marginTop: 8 }}>{run.error}</div>}
      {gateStep && (
        <div className="notice warn" style={{ marginTop: 10 }} data-testid="approval-gate">
          <div className="stack">
            <b>Approval needed: {gateStep.label}</b>
            <span>{gateStep.output?.approval?.message}</span>
            <ApprovalPayload payload={gateStep.output?.approval?.payload} />
            <TextInput value={note} onChange={setNote} placeholder="Optional note" />
            <div className="row">
              <Button kind="primary" onClick={() => decide.mutate("approve")} busy={decide.isPending}>Approve & apply</Button>
              <Button kind="danger" onClick={() => decide.mutate("reject")} busy={decide.isPending}>Reject</Button>
            </div>
          </div>
        </div>
      )}
      <div className="faint" style={{ marginTop: 6 }}>Started {fmtDate(run.createdAt, true)} · run {run.id}</div>
    </div>
  );
}

function ApprovalPayload({ payload }: { payload: any }) {
  if (!payload) return null;
  if (Array.isArray(payload))
    return (
      <div className="table-wrap" style={{ maxHeight: 220, overflowY: "auto", background: "var(--surface)", borderRadius: 6 }}>
        <table className="small">
          <tbody>
            {payload.slice(0, 40).map((p: any, i: number) => (
              <tr key={i}><td>{fmtDate(p.scheduledAt, true)}</td><td>{p.platform}</td><td>{p.title}</td><td><Badge tone={p.basis === "own_history" ? "good" : "warn"}>{p.basis === "own_history" ? "own history" : "hypothesis"}</Badge></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return <pre className="small" style={{ background: "var(--surface)", color: "var(--text)", padding: 8, borderRadius: 6, maxHeight: 220, overflow: "auto" }}>{JSON.stringify(payload, null, 2)}</pre>;
}
