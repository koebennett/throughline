import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useBrand } from "../context";
import { Badge, Button, Card, ConfidenceBadge, Field, fmtDate, PageHead, QueryView, Select, StatusBadge, TextArea, TextInput, useAction } from "../components/ui";
import { RunProgress, useRun } from "../components/agent";

const TEMPLATES: { task: string; label: string; help: string; fields?: { key: string; label: string; kind?: "text" | "number" | "idea" | "brief" | "content" | "asset" }[] }[] = [
  { task: "research_topic", label: "Research a topic", help: "Gather sources, synthesise cited evidence, audit it.", fields: [{ key: "topic", label: "Topic" }, { key: "question", label: "Question" }] },
  { task: "build_strategy", label: "Build a 90-day strategy", help: "Pillars, clusters, cadence, plan, experiments — pauses for your approval.", fields: [{ key: "goal", label: "Goal" }] },
  { task: "generate_ideas", label: "Generate scored ideas", help: "De-duplicated against your library, scored transparently.", fields: [{ key: "count", label: "How many", kind: "number" }, { key: "focus", label: "Focus" }] },
  { task: "create_brief", label: "Create a brief from an idea", help: "Thesis, angle, hooks, outline, proof with honest origin.", fields: [{ key: "ideaId", label: "Idea", kind: "idea" }] },
  { task: "review_draft", label: "Review a draft (QA)", help: "Rules + optional editor model; deterministic blockers.", fields: [{ key: "contentItemId", label: "Content item", kind: "content" }] },
  { task: "repurpose_transcript", label: "Repurpose a transcript", help: "Timestamped moments → derivative drafts with lineage.", fields: [{ key: "assetId", label: "Source asset", kind: "asset" }] },
  { task: "plan_calendar", label: "Plan the next 2 weeks", help: "Proposes slots from cadence + own history; needs approval.", fields: [] },
  { task: "analyze_performance", label: "Analyze performance", help: "Own-baseline comparison, hypotheses, experiments; needs approval for memory.", fields: [] },
];

export function AgentPage() {
  const { brandId, meta } = useBrand();
  const [params, setParams] = useSearchParams();
  const runId = params.get("run");
  const runs = useQuery({ queryKey: ["runs", brandId], queryFn: () => api.get(`/brands/${brandId}/agent/runs`), refetchInterval: 4000 });
  return (
    <>
      <PageHead title="Agent & runs" sub="One orchestrated workflow with typed, persisted steps — bounded retries, budgets, pause/resume, and approval gates before anything changes your strategy or calendar. Every run is inspectable." />
      <div className="grid g3">
        <div className="span2 stack">
          <AskCard />
          {runId ? <RunDetail id={runId} /> : <TaskTemplates onStarted={(id) => setParams({ run: id })} />}
        </div>
        <Card title="Run history" actions={runId && <Button size="sm" onClick={() => setParams({})}>New task</Button>}>
          <QueryView q={runs} empty={(d: any[]) => !d.length && <p className="muted">No runs yet.</p>}>
            {(list: any[]) => list.map((r) => (
              <button key={r.id} onClick={() => setParams({ run: r.id })} className={`list-item ${runId === r.id ? "selected" : ""}`} style={{ width: "100%", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}>
                <div className="row between"><b className="small">{meta?.tasks?.[r.task] ?? r.task}</b><StatusBadge status={r.status} /></div>
                <div className="faint">{fmtDate(r.createdAt, true)} · step {Math.min(r.currentStep + 1, r.stepCount)}/{r.stepCount} · ${Number(r.costUsd).toFixed(3)}</div>
              </button>
            ))}
          </QueryView>
        </Card>
      </div>
    </>
  );
}

function TaskTemplates({ onStarted }: { onStarted: (id: string) => void }) {
  const { brandId } = useBrand();
  const [task, setTask] = useState(TEMPLATES[0].task);
  const [input, setInput] = useState<Record<string, any>>({});
  const t = TEMPLATES.find((x) => x.task === task)!;
  const ideas = useQuery({ queryKey: ["ideas", brandId, ""], queryFn: () => api.get(`/brands/${brandId}/ideas`), enabled: t.fields?.some((f) => f.kind === "idea") });
  const content = useQuery({ queryKey: ["content", brandId, ""], queryFn: () => api.get(`/brands/${brandId}/content`), enabled: t.fields?.some((f) => f.kind === "content") });
  const assets = useQuery({ queryKey: ["assets", brandId], queryFn: () => api.get(`/brands/${brandId}/assets`), enabled: t.fields?.some((f) => f.kind === "asset") });
  const start = useAction(() => api.post(`/brands/${brandId}/agent/runs`, { task, input }), { onSuccess: (r) => onStarted(r.id), invalidate: [["runs", brandId]] });
  const pick = (kind: string) => (kind === "idea" ? ideas.data : kind === "content" ? content.data : assets.data) ?? [];
  return (
    <Card title="Task templates">
      <div className="grid g4" style={{ marginBottom: 12 }}>
        {TEMPLATES.map((x) => (
          <button key={x.task} className={`list-item ${task === x.task ? "selected" : ""}`} style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", marginTop: 0 }} onClick={() => (setTask(x.task), setInput({}))}>
            <b className="small">{x.label}</b><div className="faint">{x.help}</div>
          </button>
        ))}
      </div>
      <div className="grid g2">
        {t.fields?.map((f) => (
          <Field key={f.key} label={f.label}>
            {f.kind && ["idea", "content", "asset"].includes(f.kind) ? (
              <Select value={input[f.key] ?? ""} onChange={(v) => setInput({ ...input, [f.key]: v })} options={[{ value: "", label: "— choose —" }, ...pick(f.kind).map((x: any) => ({ value: x.id, label: (x.title ?? "").slice(0, 70) }))]} />
            ) : f.kind === "number" ? <input type="number" min={1} max={20} value={input[f.key] ?? 6} onChange={(e) => setInput({ ...input, [f.key]: Number(e.target.value) })} /> : <TextInput value={input[f.key] ?? ""} onChange={(v) => setInput({ ...input, [f.key]: v })} />}
          </Field>
        ))}
      </div>
      <div style={{ marginTop: 12 }}><Button kind="primary" onClick={() => start.mutate()} busy={start.isPending}>Start “{t.label}”</Button></div>
      <p className="faint" style={{ marginTop: 8 }}>For drafting from a brief, use Briefs → “Draft platform-native content”.</p>
    </Card>
  );
}

function RunDetail({ id }: { id: string }) {
  const { meta } = useBrand();
  const q = useRun(id);
  return (
    <Card title={q.data ? <div className="row"><h2>{meta?.tasks?.[q.data.task] ?? q.data.task}</h2><Badge>{q.data.id}</Badge></div> : "Run"}>
      <RunProgress runId={id} />
      {q.data?.input && <details style={{ marginTop: 10 }}><summary className="small">Input</summary><pre className="small">{JSON.stringify(q.data.input, null, 2)}</pre></details>}
      {q.data?.output && <RunOutput run={q.data} />}
    </Card>
  );
}

function RunOutput({ run }: { run: any }) {
  const o = run.output;
  const links: [string, string][] = [];
  if (o.strategyId) links.push(["/strategy", "Open strategy"]);
  if (o.researchRunId) links.push(["/research", "Open research"]);
  if (o.ideaIds?.length) links.push(["/ideas", `Open ${o.ideaIds.length} idea(s)`]);
  if (o.briefId) links.push([`/briefs/${o.briefId}`, "Open brief"]);
  o.items?.forEach((it: any) => links.push([`/studio/${it.contentItemId}`, `Open ${it.platform} draft`]));
  o.contentItemIds?.forEach((cid: string, i: number) => links.push([`/studio/${cid}`, `Open derivative ${i + 1}`]));
  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <h3>Output</h3>
      {run.task === "ask" && o.answer ? <AnswerView a={o} /> : null}
      {links.length > 0 && <div className="row">{links.map(([to, l]) => <Link key={to + l} className="btn sm" to={to}>{l}</Link>)}</div>}
      <details><summary className="small">Raw output</summary><pre className="small">{JSON.stringify(o, null, 2)}</pre></details>
    </div>
  );
}

function AnswerView({ a }: { a: any }) {
  const list = (t: string, xs: string[]) => xs?.length > 0 && <div><h3 style={{ marginBottom: 4 }}>{t}</h3><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
  return (
    <div className="stack">
      <p>{a.answer}</p>
      <div className="notice info"><b>Recommendation:</b> {a.recommendation} <ConfidenceBadge c={a.confidence} /></div>
      <div className="grid g2">{list("Evidence", a.evidence)}{list("Assumptions", a.assumptions)}{list("Next actions", a.nextActions)}{list("Success criteria", a.successCriteria)}</div>
      {a.retrievedDocs?.length > 0 && <p className="faint">Brand docs consulted: {a.retrievedDocs.join("; ")}</p>}
    </div>
  );
}

function AskCard() {
  const { brandId } = useBrand();
  const [question, setQuestion] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const run = useRun(runId);
  const ask = useAction(() => api.post(`/brands/${brandId}/agent/runs`, { task: "ask", input: { question } }), { onSuccess: (r) => setRunId(r.id) });
  return (
    <Card title="Ask the strategist">
      <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-end" }}>
        <TextArea value={question} onChange={setQuestion} rows={2} placeholder="e.g. Which pillar should I double down on next month, and why?" />
        <Button kind="primary" onClick={() => ask.mutate()} disabled={question.trim().length < 3} busy={ask.isPending || (!!run.data && ["queued", "running"].includes(run.data.status))}>Ask</Button>
      </div>
      <p className="faint" style={{ marginTop: 4 }}>Uses your saved brand context, evidence and documents — it won't re-ask what's already in Brand Brain.</p>
      {run.data?.status === "succeeded" && run.data.output && <div style={{ marginTop: 10 }}><AnswerView a={run.data.output} /></div>}
      {run.data?.status === "failed" && <div className="notice bad small" style={{ marginTop: 10 }}>{run.data.error}</div>}
    </Card>
  );
}
