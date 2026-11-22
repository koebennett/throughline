import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useBrand } from "../context";
import { Badge, Button, Card, Empty, Field, fmtDate, ListInput, PageHead, QueryView, Select, StatusBadge, TextArea, TextInput, useAction } from "../components/ui";
import { RunProgress } from "../components/agent";

export function BriefsPage() {
  const { brandId } = useBrand();
  const { id } = useParams();
  const nav = useNavigate();
  const list = useQuery({ queryKey: ["briefs", brandId], queryFn: () => api.get(`/brands/${brandId}/briefs`) });
  return (
    <>
      <PageHead title="Content briefs" sub="Production-ready briefs: audience problem, thesis, original angle, hooks, outline, proof (with honest origin), assets, rights, CTA, platform constraints, KPI and a fact-check list." />
      <div className="split">
        <Card title="Briefs">
          <QueryView q={list} empty={(d: any[]) => !d.length && <Empty title="No briefs yet">Promote an idea from the Idea Lab — the agent writes the brief from your evidence and brand context.</Empty>}>
            {(l: any[]) => l.map((b) => (
              <button key={b.id} onClick={() => nav(`/briefs/${b.id}`)} className={`list-item ${id === b.id ? "selected" : ""}`} style={{ width: "100%", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}>
                <b className="small">{b.title}</b>
                <div className="row"><StatusBadge status={b.status} /><span className="faint">v{b.version} · {b.contentCount} draft(s) · {fmtDate(b.updatedAt)}</span></div>
              </button>
            ))}
          </QueryView>
        </Card>
        {id ? <BriefEditor id={id} key={id} /> : <Card><Empty title="Select a brief">Or create one from an idea.</Empty></Card>}
      </div>
    </>
  );
}

const TEXT_FIELDS: [string, string][] = [["objective", "Objective"], ["targetAudience", "Target audience"], ["audienceProblem", "Audience problem / question"], ["desiredTakeaway", "Desired takeaway / transformation"], ["coreThesis", "Core thesis"], ["originalAngle", "Original angle"], ["promise", "Promise"], ["cta", "CTA"], ["kpi", "KPI"], ["searchIntent", "Search intent (where relevant)"], ["constraints", "Platform constraints"], ["visualDirection", "Visual direction"], ["rightsNotes", "Rights & permissions"]];
const LIST_FIELDS: [string, string][] = [["hooks", "Hook options"], ["talkingPoints", "Talking points"], ["requiredAssets", "Required assets / B-roll"], ["sourceLinks", "Source links"], ["disclosures", "Disclosures"], ["risks", "Risks"], ["assumptions", "Assumptions"], ["factCheck", "Fact-check checklist"]];

function BriefEditor({ id }: { id: string }) {
  const { brandId, meta } = useBrand();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["brief", id], queryFn: () => api.get(`/briefs/${id}`) });
  const [d, setD] = useState<any>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [opts, setOpts] = useState({ voiceStrength: "balanced", readingLevel: "standard", length: "medium", creativity: "balanced", variants: 2 });
  const [runId, setRunId] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) {
      setD(structuredClone(q.data.data));
      setTargets((t) => (t.length ? t : [q.data.data.platform].filter((p: string) => meta?.platforms?.some((x: any) => x.id === p))));
    }
  }, [q.data, meta]);
  const save = useAction(() => api.put(`/briefs/${id}`, d), { success: (b) => `Saved v${b.version}`, invalidate: [["brief", id], ["briefs", brandId]] });
  const status = useAction((s: string) => api.post(`/briefs/${id}/status`, { status: s }), { invalidate: [["brief", id], ["briefs", brandId]] });
  const draft = useAction(() => api.post(`/brands/${brandId}/agent/runs`, { task: "create_drafts", input: { briefId: id, targets: targets.map((p) => ({ platform: p })), options: opts } }), { onSuccess: (r) => setRunId(r.id) });
  if (!d || !q.data) return <Card><QueryView q={q}>{() => null}</QueryView></Card>;
  const dirty = JSON.stringify(d) !== JSON.stringify(q.data.data);
  return (
    <div className="stack">
      <Card title={<div className="row"><h2>{d.workingTitle}</h2><StatusBadge status={q.data.status} /><Badge>v{q.data.version}</Badge><Badge>{q.data.generatedBy}</Badge></div>} actions={<>
        {q.data.ideaTitle && <span className="faint">from idea “{q.data.ideaTitle.slice(0, 40)}”</span>}
        {q.data.status === "draft" ? <Button onClick={() => status.mutate("approved")}>Mark approved</Button> : <Button onClick={() => status.mutate("draft")}>Reopen</Button>}
        <Button kind="primary" disabled={!dirty} onClick={() => save.mutate()} busy={save.isPending}>Save version</Button></>}>
        <div className="grid g2">
          <Field label="Working title"><TextInput value={d.workingTitle} onChange={(v) => setD({ ...d, workingTitle: v })} /></Field>
          <div className="grid g2"><Field label="Platform"><TextInput value={d.platform} onChange={(v) => setD({ ...d, platform: v })} /></Field><Field label="Format"><TextInput value={d.format} onChange={(v) => setD({ ...d, format: v })} /></Field></div>
          {TEXT_FIELDS.map(([k, l]) => <Field key={k} label={l}><TextArea value={d[k]} onChange={(v) => setD({ ...d, [k]: v })} rows={2} /></Field>)}
          {LIST_FIELDS.map(([k, l]) => <Field key={k} label={l}><ListInput value={d[k]} onChange={(v) => setD({ ...d, [k]: v })} /></Field>)}
          <label className="check"><input type="checkbox" checked={d.sponsored} onChange={(e) => setD({ ...d, sponsored: e.target.checked })} /> Sponsored / affiliate content (QA will require a disclosure)</label>
        </div>
        <h3 style={{ margin: "14px 0 6px" }}>Outline</h3>
        {d.outline.map((o: any, i: number) => (
          <div key={i} className="grid g2 list-item">
            <Field label={`Section ${i + 1}`}><TextInput value={o.section} onChange={(v) => setD({ ...d, outline: d.outline.map((x: any, j: number) => (j === i ? { ...x, section: v } : x)) })} /></Field>
            <Field label="Points"><ListInput value={o.points} onChange={(v) => setD({ ...d, outline: d.outline.map((x: any, j: number) => (j === i ? { ...x, points: v } : x)) })} rows={2} /></Field>
          </div>
        ))}
        <Button size="sm" onClick={() => setD({ ...d, outline: [...d.outline, { section: "", points: [] }] })}>+ Section</Button>
        <h3 style={{ margin: "14px 0 6px" }}>Proof & evidence</h3>
        <p className="faint" style={{ marginBottom: 6 }}>Origin is explicit: user-supplied facts, researched (cited) claims, or claims that need verification.</p>
        {d.proof.map((p: any, i: number) => (
          <div key={i} className="grid g3 list-item">
            <Field label="Claim"><TextInput value={p.claim} onChange={(v) => setD({ ...d, proof: d.proof.map((x: any, j: number) => (j === i ? { ...x, claim: v } : x)) })} /></Field>
            <Field label="Support"><TextInput value={p.support} onChange={(v) => setD({ ...d, proof: d.proof.map((x: any, j: number) => (j === i ? { ...x, support: v } : x)) })} /></Field>
            <Field label="Origin"><Select value={p.origin} onChange={(v) => setD({ ...d, proof: d.proof.map((x: any, j: number) => (j === i ? { ...x, origin: v } : x)) })} options={[{ value: "user_supplied", label: "User-supplied" }, { value: "researched", label: "Researched (cited)" }, { value: "needs_verification", label: "Needs verification" }]} /></Field>
          </div>
        ))}
        <Button size="sm" onClick={() => setD({ ...d, proof: [...d.proof, { claim: "", support: "", origin: "needs_verification" }] })}>+ Proof point</Button>
      </Card>
      <Card title="Draft platform-native content">
        <p className="faint" style={{ marginBottom: 8 }}>Each platform gets its own native draft (not a copy-paste), with distinct variants, then automatic QA{meta?.model.live ? " and up to two targeted revisions" : ""}.</p>
        <div className="chips" style={{ marginBottom: 10 }}>
          {(meta?.platforms ?? []).map((p: any) => (
            <label key={p.id} className="check list-item" style={{ margin: 0 }}><input type="checkbox" checked={targets.includes(p.id)} onChange={() => setTargets(targets.includes(p.id) ? targets.filter((x) => x !== p.id) : [...targets, p.id])} /> {p.label}</label>
          ))}
        </div>
        <div className="grid g4">
          <Field label="Voice strength"><Select value={opts.voiceStrength} onChange={(v) => setOpts({ ...opts, voiceStrength: v })} options={["light", "balanced", "strong"].map((x) => ({ value: x, label: x }))} /></Field>
          <Field label="Reading level"><Select value={opts.readingLevel} onChange={(v) => setOpts({ ...opts, readingLevel: v })} options={["simple", "standard", "expert"].map((x) => ({ value: x, label: x }))} /></Field>
          <Field label="Length"><Select value={opts.length} onChange={(v) => setOpts({ ...opts, length: v })} options={["short", "medium", "long"].map((x) => ({ value: x, label: x }))} /></Field>
          <Field label="Creativity"><Select value={opts.creativity} onChange={(v) => setOpts({ ...opts, creativity: v })} options={["conservative", "balanced", "bold"].map((x) => ({ value: x, label: x }))} /></Field>
          <Field label="Variants per platform"><Select value={String(opts.variants)} onChange={(v) => setOpts({ ...opts, variants: Number(v) })} options={["1", "2", "3"].map((x) => ({ value: x, label: x }))} /></Field>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <Button kind="primary" disabled={!targets.length || !!runId || dirty} onClick={() => draft.mutate()} busy={draft.isPending}>Draft for {targets.length} platform(s)</Button>
          {dirty && <span className="faint">Save the brief first.</span>}
          <Link to="/studio" className="small">Open Creation & Review</Link>
        </div>
        {runId && <div style={{ marginTop: 10 }}><RunProgress runId={runId} compact invalidate={[["content", brandId]]} onDone={(r) => r.output?.items?.[0] && nav(`/studio/${r.output.items[0].contentItemId}`)} /></div>}
      </Card>
    </div>
  );
}
