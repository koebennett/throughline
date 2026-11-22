import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useBrand } from "../context";
import { Badge, Button, Card, Field, fmtDate, PageHead, QueryView, StatusBadge, Tabs, TextInput, useAction, useToast, safeHref } from "../components/ui";

type Tab = "integrations" | "agent" | "publishing" | "data" | "audit";
const QA_LABELS: Record<string, string> = { audienceValue: "Audience value", originality: "Originality", clarityHook: "Clarity & hook", evidenceAccuracy: "Evidence & accuracy", brandFit: "Brand fit", platformFit: "Platform fit", narrative: "Narrative", ctaAlignment: "CTA fit" };

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("integrations");
  return (
    <>
      <PageHead title="Settings" sub="Integrations are labelled honestly: connected, available, needs credentials, needs OAuth, needs provider approval or not implemented. A mock is never shown as live." />
      <Tabs<Tab> tabs={[{ id: "integrations", label: "Integrations" }, { id: "agent", label: "Agent, budgets & QA" }, { id: "publishing", label: "Publishing safety" }, { id: "data", label: "Data & privacy" }, { id: "audit", label: "Audit log" }]} value={tab} onChange={setTab} />
      {tab === "integrations" && <Integrations />}
      {tab === "agent" && <AgentSettings />}
      {tab === "publishing" && <Publishing />}
      {tab === "data" && <DataTab />}
      {tab === "audit" && <AuditTab />}
    </>
  );
}

function Integrations() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["integrations"], queryFn: () => api.get("/integrations") });
  const [key, setKey] = useState("");
  const inv = [["integrations"], ["meta"]];
  const saveKey = useAction(() => api.post("/integrations/anthropic/key", { apiKey: key }), { success: "Claude connected — key verified and stored encrypted", invalidate: inv, onSuccess: () => setKey("") });
  const test = useAction((id: string) => api.post(`/integrations/${id}/test`), { onSuccess: (r) => toast(r.detail, !r.ok), invalidate: inv });
  const disconnect = useAction((id: string) => api.post(`/integrations/${id}/disconnect`), { success: (r) => r.note ?? "Disconnected; saved credentials deleted", invalidate: inv, onSuccess: () => qc.invalidateQueries() });
  return (
    <QueryView q={q}>
      {(list: any[]) => (
        <div className="stack">
          {list.map((i) => (
            <Card key={i.id} title={<div className="row"><h2>{i.name}</h2><StatusBadge status={i.status} /><Badge>{i.kind.replace("_", " ")}</Badge></div>} actions={<>
              {["anthropic", "webpage", "claude_web_search"].includes(i.id) && <Button size="sm" onClick={() => test.mutate(i.id)} busy={test.isPending && test.variables === i.id}>Test connection</Button>}
              {!["manual", "webpage"].includes(i.id) && i.status !== "disconnected" && <Button size="sm" kind="danger" onClick={() => confirm(`Disconnect ${i.name}? Saved credentials and any API-sourced data from it will be deleted.`) && disconnect.mutate(i.id)}>Disconnect</Button>}
            </>}>
              <p className="small">{i.detail}</p>
              <p className="small muted" style={{ marginTop: 6 }}>{i.permissionExplanation}</p>
              {i.scopes.length > 0 && <div className="faint" style={{ marginTop: 6 }}>Least-privilege scopes: {i.scopes.join(", ")}</div>}
              {i.id === "youtube" && <YoutubeSetup status={i.status} />}
              {i.id === "anthropic" && i.status !== "connected" && (
                <div className="row" style={{ marginTop: 10, flexWrap: "nowrap" }}>
                  <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-… (verified, then stored encrypted on this machine)" aria-label="Anthropic API key" />
                  <Button kind="primary" onClick={() => saveKey.mutate()} disabled={key.length < 20} busy={saveKey.isPending}>Verify & save</Button>
                </div>
              )}
              <details style={{ marginTop: 8 }}>
                <summary className="small">Setup steps & docs (checked {i.verifiedOn})</summary>
                <ol className="small" style={{ margin: "6px 0", paddingLeft: 18 }}>{i.setupSteps.map((s: string, k: number) => <li key={k}>{s}</li>)}</ol>
                {i.docsUrls.map((u: string) => <div key={u}><a className="small" href={u} target="_blank" rel="noreferrer noopener">{u}</a></div>)}
              </details>
              {(i.lastSyncAt || i.connectedAt) && <div className="faint">Connected {fmtDate(i.connectedAt, true)} · last check {fmtDate(i.lastSyncAt, true)}</div>}
            </Card>
          ))}
        </div>
      )}
    </QueryView>
  );
}

function useSettings() {
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings") });
  const [s, setS] = useState<any>(null);
  useEffect(() => { if (q.data) setS(structuredClone(q.data)); }, [q.data]);
  const save = useAction((patch: any) => api.put("/settings", patch), { success: "Settings saved", invalidate: [["settings"], ["meta"], ["ideas"]] });
  return { q, s, setS, save };
}

function AgentSettings() {
  const { s, setS, save, q } = useSettings();
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => api.get("/usage") });
  const { meta } = useBrand();
  if (!s) return <QueryView q={q}>{() => null}</QueryView>;
  const num = (k: string, label: string, hint: string, step = 1) => <Field label={label} hint={hint}><input type="number" step={step} min={0} value={s[k]} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} /></Field>;
  return (
    <div className="grid g2">
      <Card title="Model & cost limits">
        <p className="small muted" style={{ marginBottom: 10 }}>Strategy & creative work: <b>{meta?.model.models.strong}</b>. Classification & QA judgement: <b>{meta?.model.models.fast}</b>. Change models with CSA_MODEL_STRONG / CSA_MODEL_FAST.</p>
        <div className="grid g2">
          {num("runBudgetUsd", "Budget per agent run (USD)", "Run stops cleanly when reached; retry after raising.", 0.1)}
          {num("monthlyBudgetUsd", "Monthly budget (USD)", "All model calls stop when reached.", 1)}
          {num("maxWebSearchesPerRun", "Max web searches per research run", "Billed per search by Anthropic.")}
          {num("maxRevisionLoops", "Max QA revision loops (0–2)", "Bounded — failures are surfaced, not looped.")}
          <Field label="Default time zone"><TextInput value={s.timezone} onChange={(v) => setS({ ...s, timezone: v })} /></Field>
        </div>
        <Button kind="primary" onClick={() => save.mutate({ runBudgetUsd: s.runBudgetUsd, monthlyBudgetUsd: s.monthlyBudgetUsd, maxWebSearchesPerRun: s.maxWebSearchesPerRun, maxRevisionLoops: Math.min(2, s.maxRevisionLoops), timezone: s.timezone })}>Save</Button>
      </Card>
      <Card title="Usage (estimated)">
        <QueryView q={usage}>
          {(u) => (
            <>
              <div className="stat"><span className="faint">Month to date</span><b>${u.monthToDateUsd.toFixed(4)}</b></div>
              <table className="small" style={{ marginTop: 8 }}><thead><tr><th>Model</th><th>Purpose</th><th>Calls</th><th>Tokens in/out</th><th>Cost</th></tr></thead>
                <tbody>{u.byModel.map((r: any, i: number) => <tr key={i}><td>{r.model}</td><td>{r.purpose}</td><td>{r.calls}</td><td>{r.input_tokens}/{r.output_tokens}</td><td>${r.cost_usd}</td></tr>)}</tbody></table>
              {!u.byModel.length && <p className="muted">No model usage yet.</p>}
              <p className="faint" style={{ marginTop: 6 }}>{u.note}</p>
            </>
          )}
        </QueryView>
      </Card>
      <Card title="QA rubric" className="span2">
        <p className="small muted" style={{ marginBottom: 10 }}>Weights for the 0–100 draft quality score (a triage aid). Hard blockers are rule-based and not affected by weights.</p>
        <div className="grid g4">
          {Object.keys(QA_LABELS).map((k) => <Field key={k} label={QA_LABELS[k]}><input type="number" min={0} max={100} value={s.qaWeights[k]} onChange={(e) => setS({ ...s, qaWeights: { ...s.qaWeights, [k]: Number(e.target.value) } })} /></Field>)}
          <Field label="Pass threshold" hint="Below this, QA adds a warning (not a blocker)."><input type="number" min={0} max={100} value={s.qaPassScore} onChange={(e) => setS({ ...s, qaPassScore: Number(e.target.value) })} /></Field>
        </div>
        <Button kind="primary" onClick={() => save.mutate({ qaWeights: s.qaWeights, qaPassScore: s.qaPassScore })}>Save rubric</Button>
      </Card>
    </div>
  );
}

function Publishing() {
  const { s, save, q } = useSettings();
  const { brandId } = useBrand();
  const jobs = useQuery({ queryKey: ["publish-jobs", brandId], queryFn: () => api.get(`/brands/${brandId}/publish-jobs`) });
  const check = useAction((id: string) => api.post(`/publish-jobs/${id}/check`), { success: (j) => `Job is now ${j.status}`, invalidate: [["publish-jobs", brandId]] });
  if (!s) return <QueryView q={q}>{() => null}</QueryView>;
  return (
    <div className="grid g2">
      <Card title="Publishing kill switch">
        <div className="stack">
          <div className={`notice ${s.publishingEnabled ? "bad" : "good"}`}>{s.publishingEnabled ? "Publishing is ON. Approved content can be sent to connected platforms after you confirm each preview." : "Publishing is OFF. No external post can be made from this app."}</div>
          <Button kind={s.publishingEnabled ? "danger" : "primary"} onClick={() => (s.publishingEnabled || confirm("Turn publishing on? Every post still needs QA, approval of the exact variant, and confirmation of a preview.")) && save.mutate({ publishingEnabled: !s.publishingEnabled })}>{s.publishingEnabled ? "Turn publishing OFF (emergency pause)" : "Turn publishing on"}</Button>
          <p className="faint">Per-channel automatic posting is not available in this release; every post requires a human confirmation. Changes to this switch are recorded in the audit log.</p>
        </div>
      </Card>
      <Card title="Publish log">
        <QueryView q={jobs} empty={(d: any[]) => !d.length && <p className="muted">No publish attempts.</p>}>
          {(list: any[]) => list.map((j) => (
            <div key={j.id} className="list-item small">
              <div className="row between"><b>{j.title}</b><StatusBadge status={j.status === "ambiguous" ? "interrupted" : j.status} /></div>
              <div className="faint">{j.connector} · attempts {j.attempts} · {fmtDate(j.updatedAt, true)}{safeHref(j.resultUrl) && <> · <a href={safeHref(j.resultUrl)} target="_blank" rel="noreferrer noopener">post</a></>}</div>
              {j.lastError && <div style={{ color: "var(--bad)" }}>{j.lastError}</div>}
              {j.status === "ambiguous" && <Button size="sm" onClick={() => check.mutate(j.id)}>Check status with provider</Button>}
            </div>
          ))}
        </QueryView>
      </Card>
    </div>
  );
}

function DataTab() {
  const { brandId, brand, setBrandId } = useBrand();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [confirmName, setConfirmName] = useState("");
  const del = useAction(() => api.del(`/brands/${brandId}`, { confirmName }), { success: "Brand and all its data deleted", onSuccess: () => { setBrandId(null); qc.invalidateQueries(); nav("/"); } });
  return (
    <div className="grid g2">
      <Card title="Export & backup">
        <div className="stack">
          <a className="btn" href={`/api/brands/${brandId}/export`}>Download full brand export (JSON)</a>
          <p className="small muted">Database backup (all brands): stop nothing, run <code>npm run db:backup</code>. Restore: stop the server and copy the backup over <code>data/throughline.sqlite</code>, keeping <code>data/secret.key</code> alongside it (needed to decrypt saved keys).</p>
          <p className="small muted">Everything is stored locally in SQLite. Nothing leaves this machine except calls you trigger to connected providers (e.g. Claude) — those receive only the context a task needs.</p>
        </div>
      </Card>
      <Card title="Delete this brand">
        <div className="stack">
          <p className="small">Permanently deletes <b>{brand?.name}</b>: profile versions, documents, memory, research, strategy, ideas, briefs, content, calendar, analytics and its audit history. A single deletion record is kept.</p>
          <Field label={`Type “${brand?.name}” to confirm`}><TextInput value={confirmName} onChange={setConfirmName} /></Field>
          <Button kind="danger" disabled={confirmName !== brand?.name} onClick={() => del.mutate()} busy={del.isPending}>Delete brand permanently</Button>
        </div>
      </Card>
    </div>
  );
}

function AuditTab() {
  const { brandId } = useBrand();
  const q = useQuery({ queryKey: ["audit", brandId], queryFn: () => api.get(`/audit?brandId=${brandId}&limit=300`) });
  return (
    <Card title="Audit log (append-only)">
      <QueryView q={q}>
        {(list: any[]) => (
          <div className="table-wrap"><table className="small">
            <thead><tr><th>When</th><th>Entity</th><th>Action</th><th>Change</th><th>Actor</th><th>Detail</th></tr></thead>
            <tbody>{list.map((a) => <tr key={a.id}><td className="nowrap faint">{fmtDate(a.created_at, true)}</td><td>{a.entity_type}</td><td>{a.action.replace(/_/g, " ")}</td><td>{a.from_state && `${a.from_state} → ${a.to_state}`}</td><td>{a.actor}</td><td className="faint" style={{ maxWidth: 360, wordBreak: "break-word" }}>{Object.keys(a.detail ?? {}).length ? JSON.stringify(a.detail).slice(0, 200) : ""}</td></tr>)}</tbody>
          </table></div>
        )}
      </QueryView>
    </Card>
  );
}

function YoutubeSetup({ status }: { status: string }) {
  const { brandId } = useBrand();
  const [c, setC] = useState({ clientId: "", clientSecret: "" });
  const save = useAction(() => api.post("/integrations/youtube/client", c), { success: "OAuth client saved (encrypted)", invalidate: [["integrations"]], onSuccess: () => setC({ clientId: "", clientSecret: "" }) });
  const connect = useAction(() => api.post("/integrations/youtube/connect", { brandId }), {
    onSuccess: (r) => {
      window.open(r.authUrl, "_blank", "noopener");
    },
    success: "Opened Google sign-in in your browser — approve read-only access, then come back here.",
  });
  if (status === "needs_credentials" || status === "disconnected")
    return (
      <div className="grid g3" style={{ marginTop: 10 }}>
        <Field label="OAuth client ID (Desktop app)"><TextInput value={c.clientId} onChange={(v) => setC({ ...c, clientId: v })} placeholder="…apps.googleusercontent.com" /></Field>
        <Field label="Client secret"><input type="password" autoComplete="off" value={c.clientSecret} onChange={(e) => setC({ ...c, clientSecret: e.target.value })} /></Field>
        <div style={{ alignSelf: "end" }}><Button kind="primary" onClick={() => save.mutate()} disabled={!c.clientId} busy={save.isPending}>Save client</Button></div>
      </div>
    );
  if (status === "needs_oauth") return <div style={{ marginTop: 10 }}><Button kind="primary" onClick={() => connect.mutate()} busy={connect.isPending}>Connect YouTube (read-only)</Button></div>;
  return <p className="faint" style={{ marginTop: 6 }}>Sync analytics from Analytics Lab → Import data.</p>;
}
