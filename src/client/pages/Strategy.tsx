import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useBrand } from "../context";
import { Badge, Button, Card, ConfidenceBadge, Empty, Field, fmtDate, ListInput, Modal, PageHead, QueryView, StatusBadge, TextArea, TextInput, useAction } from "../components/ui";
import { RunTaskButton } from "../components/agent";

const OPP_LABELS: Record<string, string> = { audienceRelevance: "Audience relevance", demandEvidence: "Evidence of demand", differentiation: "Differentiation / gap", brandAlignment: "Brand alignment", platformFit: "Platform / format fit", feasibility: "Feasibility", timeliness: "Timeliness" };

export function StrategyPage() {
  const { brandId } = useBrand();
  const list = useQuery({ queryKey: ["strategies", brandId], queryFn: () => api.get(`/brands/${brandId}/strategies`) });
  const [sel, setSel] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const current = sel ?? list.data?.find((s: any) => s.status === "approved")?.id ?? list.data?.[0]?.id ?? null;
  return (
    <>
      <PageHead title="Strategy Studio" sub="Positioning, pillars, clusters, platform roles, cadence and a 30/60/90 plan. Every recommendation carries evidence, confidence and a success metric. Pillars only change when you approve a version." />
      <div className="split">
        <div className="stack">
          <Card title="Generate">
            <div className="stack">
              <Field label="Goal for this strategy"><TextArea value={goal} onChange={setGoal} rows={2} placeholder="Defaults to the brand objective" /></Field>
              <RunTaskButton task="build_strategy" input={{ goal }} label="Build strategy" invalidate={[["strategies", brandId], ["pillars", brandId]]} onDone={(r) => r.output?.strategyId && setSel(r.output.strategyId)} />
            </div>
          </Card>
          <Card title="Versions">
            <QueryView q={list} empty={(d: any[]) => !d.length && <p className="muted">No strategies yet.</p>}>
              {(l: any[]) => l.map((s) => (
                <button key={s.id} onClick={() => setSel(s.id)} className={`list-item ${current === s.id ? "selected" : ""}`} style={{ width: "100%", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}>
                  <div className="row between"><b>v{s.version}</b><StatusBadge status={s.status} /></div>
                  <div className="faint">{s.generatedBy} · {fmtDate(s.createdAt)}{s.validation?.length ? ` · ${s.validation.length} note(s)` : ""}</div>
                </button>
              ))}
            </QueryView>
          </Card>
          <WeightsCard />
        </div>
        <div className="stack">
          {current ? <StrategyView id={current} /> : <Card><Empty title="No strategy yet">Build one from your brand profile and evidence. With Claude connected it synthesises your research; offline it creates an honest scaffold for you to complete.</Empty></Card>}
          <PillarsCard />
        </div>
      </div>
    </>
  );
}

function StrategyView({ id }: { id: string }) {
  const { brandId } = useBrand();
  const q = useQuery({ queryKey: ["strategy", id], queryFn: () => api.get(`/strategies/${id}`) });
  const [edit, setEdit] = useState<any>(null);
  const inv = [["strategy", id], ["strategies", brandId], ["pillars", brandId], ["home", brandId]];
  const approve = useAction((ack: boolean) => api.post(`/strategies/${id}/approve`, { acknowledgeWarnings: ack }), { success: "Strategy approved — pillars and series are now active", invalidate: inv });
  const dup = useAction(() => api.post(`/strategies/${id}/duplicate`), { success: (s) => `Draft v${s.version} created`, invalidate: inv });
  const save = useAction(() => api.put(`/strategies/${id}`, edit), { success: "Draft saved and re-validated", invalidate: inv, onSuccess: () => setEdit(null) });
  return (
    <QueryView q={q}>
      {(s) => {
        const d = s.data;
        const errors = (s.validation ?? []).filter((v: any) => v.level === "error");
        const warnings = (s.validation ?? []).filter((v: any) => v.level === "warning");
        return (
          <>
            <Card title={<div className="row"><h2>Strategy v{s.version}</h2><StatusBadge status={s.status} /><Badge>{s.generatedBy}</Badge></div>} actions={<>
              {s.status === "draft" && <Button onClick={() => setEdit(structuredClone(d))}>Edit</Button>}
              {s.status !== "draft" && <Button onClick={() => dup.mutate()}>Duplicate as draft</Button>}
              {s.status === "draft" && <Button kind="primary" disabled={errors.length > 0} busy={approve.isPending} onClick={() => (!warnings.length || confirm(`Approve with ${warnings.length} warning(s)?\n\n${warnings.map((w: any) => "• " + w.message).join("\n")}`)) && approve.mutate(warnings.length > 0)}>Approve & activate</Button>}
            </>}>
              {(errors.length > 0 || warnings.length > 0) && (
                <div className="stack" style={{ marginBottom: 12 }}>
                  {errors.map((v: any, i: number) => <div key={i} className="notice bad small">Blocker: {v.message}</div>)}
                  {warnings.map((v: any, i: number) => <div key={i} className="notice warn small">{v.message}</div>)}
                </div>
              )}
              <p>{d.executiveSummary}</p>
              <div className="grid g2" style={{ marginTop: 12 }}>
                <div><h3>Positioning</h3><p className="muted">{d.positioning}</p></div>
                <div><h3>Differentiators</h3><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{d.differentiators.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>
              </div>
            </Card>
            <Card title="Pillars & topic clusters">
              <div className="grid g2">
                {d.pillars.map((p: any, i: number) => (
                  <div key={i} className="list-item" style={{ marginTop: 0 }}>
                    <h3>{p.name}</h3>
                    <p className="small" style={{ marginTop: 4 }}>{p.purpose}</p>
                    <dl className="kv small" style={{ marginTop: 6 }}><dt>Need</dt><dd>{p.audienceNeed}</dd><dt>Proof</dt><dd>{p.proof}</dd><dt>Excludes</dt><dd>{p.boundaries}</dd></dl>
                    {p.clusters.map((c: any, j: number) => <div key={j} className="faint" style={{ marginTop: 4 }}>▸ {c.name}: {c.subtopics.join(", ")} <i>({c.searchIntent})</i></div>)}
                  </div>
                ))}
              </div>
            </Card>
            <div className="grid g2">
              <Card title="Platform roles">{d.platformRoles.map((r: any, i: number) => <div key={i} className="small" style={{ marginBottom: 6 }}><b>{r.platform}</b> — {r.role} <span className="faint">({r.contentTypes.join(", ")})</span></div>)}</Card>
              <Card title="Cadence"><p>{d.cadence.summary}</p><div className="chips" style={{ margin: "6px 0" }}>{d.cadence.perWeek.map((c: any) => <Badge key={c.platform}>{c.platform}: {c.count}/wk</Badge>)}</div><p className="faint">{d.cadence.rationale}</p></Card>
            </div>
            <Card title="Recommendations">
              <div className="table-wrap"><table className="small">
                <thead><tr><th>Recommendation</th><th>Evidence</th><th>Benefit (hypothesis)</th><th>Effort / risk</th><th>Confidence</th><th>Success metric</th></tr></thead>
                <tbody>{d.recommendations.map((r: any, i: number) => (
                  <tr key={i}><td><b>{r.title}</b><div className="muted">{r.detail}</div></td><td>{r.evidence}</td><td>{r.expectedBenefit}</td><td>{r.effort}<div className="faint">{r.risk}</div></td><td><ConfidenceBadge c={r.confidence} /></td><td>{r.successMetric}</td></tr>
                ))}</tbody>
              </table></div>
            </Card>
            <div className="grid g2">
              <Card title="30 / 60 / 90 plan">{d.plan.map((p: any, i: number) => <div key={i} className="list-item"><div className="row between"><b>{p.window}</b><span className="faint">review {p.reviewDate}</span></div><p className="small">{p.focus}</p><ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{p.milestones.map((m: string, j: number) => <li key={j}>{m}</li>)}</ul></div>)}</Card>
              <Card title="Experiments">{d.experiments.map((e: any, i: number) => <div key={i} className="list-item small"><b>{e.hypothesis}</b><div className="faint">Variable: {e.variable} · Metric: {e.metric} · Threshold: {e.threshold}</div></div>)}</Card>
            </div>
            <div className="grid g3">
              <Card title="Messaging matrix" className="span2"><div className="table-wrap"><table className="small"><thead><tr><th>Stage</th><th>Problem</th><th>Promise</th><th>Proof</th><th>CTA</th></tr></thead><tbody>{d.messagingMatrix.map((m: any, i: number) => <tr key={i}><td>{m.stage}</td><td>{m.problem}</td><td>{m.promise}</td><td>{m.proof}</td><td>{m.cta}</td></tr>)}</tbody></table></div></Card>
              <Card title="Assumptions & risks"><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{[...d.assumptions.map((a: string) => `Assumption: ${a}`), ...d.risks.map((r: string) => `Risk: ${r}`)].map((x, i) => <li key={i}>{x}</li>)}</ul></Card>
            </div>
            {edit && (
              <Modal title={`Edit draft v${s.version}`} onClose={() => setEdit(null)} footer={<Button kind="primary" onClick={() => save.mutate()} busy={save.isPending}>Save draft</Button>}>
                <Field label="Executive summary"><TextArea value={edit.executiveSummary} onChange={(v) => setEdit({ ...edit, executiveSummary: v })} /></Field>
                <Field label="Positioning"><TextArea value={edit.positioning} onChange={(v) => setEdit({ ...edit, positioning: v })} /></Field>
                <Field label="Differentiators"><ListInput value={edit.differentiators} onChange={(v) => setEdit({ ...edit, differentiators: v })} /></Field>
                {edit.pillars.map((p: any, i: number) => {
                  const up = (k: string, v: string) => setEdit({ ...edit, pillars: edit.pillars.map((x: any, j: number) => (j === i ? { ...x, [k]: v } : x)) });
                  return (
                    <div key={i} className="list-item grid g2">
                      <Field label={`Pillar ${i + 1} name`}><TextInput value={p.name} onChange={(v) => up("name", v)} /></Field>
                      <Field label="Purpose"><TextInput value={p.purpose} onChange={(v) => up("purpose", v)} /></Field>
                      <Field label="Proof"><TextInput value={p.proof} onChange={(v) => up("proof", v)} /></Field>
                      <Field label="Boundaries (what it excludes)"><TextInput value={p.boundaries} onChange={(v) => up("boundaries", v)} /></Field>
                    </div>
                  );
                })}
                <div className="row">
                  <Button size="sm" onClick={() => setEdit({ ...edit, pillars: [...edit.pillars, { name: "New pillar", purpose: "", audienceNeed: "", proof: "", boundaries: "", clusters: [] }] })}>+ Pillar</Button>
                  {edit.pillars.length > 0 && <Button size="sm" kind="danger" onClick={() => setEdit({ ...edit, pillars: edit.pillars.slice(0, -1) })}>Remove last pillar</Button>}
                </div>
                <Field label="Cadence summary"><TextInput value={edit.cadence.summary} onChange={(v) => setEdit({ ...edit, cadence: { ...edit.cadence, summary: v } })} /></Field>
              </Modal>
            )}
          </>
        );
      }}
    </QueryView>
  );
}

function PillarsCard() {
  const { brandId } = useBrand();
  const q = useQuery({ queryKey: ["pillars", brandId], queryFn: () => api.get(`/brands/${brandId}/pillars`) });
  const [cluster, setCluster] = useState<{ pillarId: string; name: string; subtopics: string[] } | null>(null);
  const addCluster = useAction(() => api.post(`/brands/${brandId}/clusters`, cluster), { success: "Cluster added", invalidate: [["pillars", brandId]], onSuccess: () => setCluster(null) });
  const delCluster = useAction((id: string) => api.del(`/clusters/${id}`), { invalidate: [["pillars", brandId]] });
  const addPillar = useAction(() => { const name = prompt("Pillar name"); return name ? api.post(`/brands/${brandId}/pillars`, { name }) : Promise.resolve(null); }, { invalidate: [["pillars", brandId]] });
  return (
    <Card title="Active pillars (topic map)" actions={<Button size="sm" onClick={() => addPillar.mutate()}>+ Pillar</Button>}>
      <QueryView q={q} empty={(d: any[]) => !d.length && <p className="muted">No active pillars. Approve a strategy, or add pillars manually.</p>}>
        {(list: any[]) => (
          <div className="grid g3">
            {list.map((p) => (
              <div key={p.id} className="list-item" style={{ marginTop: 0 }}>
                <b>{p.name}</b>
                {p.clusters.map((c: any) => <div key={c.id} className="small row between"><span>▸ {c.name} <span className="faint">{(c.subtopics ?? []).length} subtopics</span></span><button className="btn ghost sm" onClick={() => delCluster.mutate(c.id)} aria-label="Remove cluster">✕</button></div>)}
                <Button size="sm" kind="ghost" onClick={() => setCluster({ pillarId: p.id, name: "", subtopics: [] })}>+ cluster</Button>
              </div>
            ))}
          </div>
        )}
      </QueryView>
      {cluster && (
        <Modal title="Add topic cluster" onClose={() => setCluster(null)} footer={<Button kind="primary" onClick={() => addCluster.mutate()} disabled={!cluster.name}>Add</Button>}>
          <Field label="Cluster name"><TextInput value={cluster.name} onChange={(v) => setCluster({ ...cluster, name: v })} /></Field>
          <Field label="Supporting subtopics"><ListInput value={cluster.subtopics} onChange={(v) => setCluster({ ...cluster, subtopics: v })} /></Field>
        </Modal>
      )}
    </Card>
  );
}

function WeightsCard() {
  const { meta } = useBrand();
  const [w, setW] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (meta?.settings) setW(meta.settings.opportunityWeights);
  }, [meta?.settings]);
  const save = useAction(() => api.put("/settings", { opportunityWeights: w }), { success: "Weights saved — ideas re-scored", invalidate: [["meta"], ["ideas"]] });
  if (!w) return null;
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  return (
    <Card title="Opportunity score weights">
      <p className="faint" style={{ marginBottom: 8 }}>A prioritisation aid, not a prediction of reach. Missing data is penalised and shown as lower confidence.</p>
      {Object.keys(OPP_LABELS).map((k) => (
        <div key={k} className="row" style={{ flexWrap: "nowrap", marginBottom: 4 }}>
          <span className="small" style={{ flex: 1 }}>{OPP_LABELS[k]}</span>
          <input type="range" min={0} max={40} value={w[k] ?? 0} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} style={{ width: 90 }} aria-label={OPP_LABELS[k]} />
          <span className="small mono" style={{ width: 40, textAlign: "right" }}>{total ? Math.round(((w[k] ?? 0) / total) * 100) : 0}%</span>
        </div>
      ))}
      <Button size="sm" kind="primary" onClick={() => save.mutate()} busy={save.isPending}>Save weights</Button>
    </Card>
  );
}
