import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useBrand } from "../context";
import { Badge, Breakdown, Button, Card, ConfidenceBadge, Empty, Field, Modal, PageHead, QueryView, ScorePill, Select, StatusBadge, TextArea, TextInput, useAction } from "../components/ui";
import { RunTaskButton, RunProgress } from "../components/agent";

const OPP_LABELS: Record<string, string> = { audienceRelevance: "Audience relevance", demandEvidence: "Evidence of demand", differentiation: "Differentiation / gap", brandAlignment: "Brand alignment", platformFit: "Platform / format fit", feasibility: "Feasibility", timeliness: "Timeliness" };

export function IdeasPage() {
  const { brandId, meta } = useBrand();
  const [f, setF] = useState({ pillar: "", platform: "", status: "", series: "" });
  const pillars = useQuery({ queryKey: ["pillars", brandId], queryFn: () => api.get(`/brands/${brandId}/pillars`) });
  const series = useQuery({ queryKey: ["series", brandId], queryFn: () => api.get(`/brands/${brandId}/series`) });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const ideas = useQuery({ queryKey: ["ideas", brandId, qs], queryFn: () => api.get(`/brands/${brandId}/ideas?${qs}`) });
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [gen, setGen] = useState({ count: 6, pillarId: "", platform: "", focus: "" });
  const platformOpts = [{ value: "", label: "All platforms" }, ...(meta?.platforms ?? []).map((p: any) => ({ value: p.id, label: p.label }))];
  return (
    <>
      <PageHead title="Idea Lab" sub="A scored backlog. Each idea shows its rationale, evidence and a transparent score breakdown — a triage aid, never a view prediction. Near-duplicates of your own library are flagged." actions={<><a className="btn" href={`/api/brands/${brandId}/ideas.csv`}>Export CSV</a><Button kind="primary" onClick={() => setAdding(true)}>+ Add idea</Button></>} />
      <div className="grid g3">
        <Card title="Generate scored ideas" className="span2">
          <div className="grid g4">
            <Field label="How many"><input type="number" min={1} max={20} value={gen.count} onChange={(e) => setGen({ ...gen, count: Number(e.target.value) })} /></Field>
            <Field label="Pillar"><Select value={gen.pillarId} onChange={(v) => setGen({ ...gen, pillarId: v })} options={[{ value: "", label: "All pillars" }, ...(pillars.data ?? []).map((p: any) => ({ value: p.id, label: p.name }))]} /></Field>
            <Field label="Platform"><Select value={gen.platform} onChange={(v) => setGen({ ...gen, platform: v })} options={platformOpts} /></Field>
            <Field label="Focus (optional)"><TextInput value={gen.focus} onChange={(v) => setGen({ ...gen, focus: v })} /></Field>
          </div>
          <div style={{ marginTop: 10 }}><RunTaskButton task="generate_ideas" input={{ count: gen.count, pillarId: gen.pillarId || null, platform: gen.platform || null, focus: gen.focus }} label="Generate ideas" invalidate={[["ideas", brandId], ["series", brandId]]} /></div>
        </Card>
        <Card title="Series">
          <QueryView q={series} empty={(d: any[]) => !d.length && <p className="muted">Series are created from strategy or idea generation — recurring formats compound better than one-offs.</p>}>
            {(l: any[]) => l.map((s) => <div key={s.id} className="list-item"><div className="row between"><b className="small">{s.name}</b><Badge>{s.ideaCount} ideas</Badge></div><div className="faint clamp2">{s.premise}</div></div>)}
          </QueryView>
        </Card>
      </div>
      <Card title="Backlog" actions={<>
        <Select value={f.pillar} onChange={(v) => setF({ ...f, pillar: v })} options={[{ value: "", label: "All pillars" }, ...(pillars.data ?? []).map((p: any) => ({ value: p.id, label: p.name }))]} style={{ width: "auto" }} />
        <Select value={f.platform} onChange={(v) => setF({ ...f, platform: v })} options={platformOpts} style={{ width: "auto" }} />
        <Select value={f.series} onChange={(v) => setF({ ...f, series: v })} options={[{ value: "", label: "All series" }, ...(series.data ?? []).map((s: any) => ({ value: s.id, label: s.name }))]} style={{ width: "auto" }} />
        <Select value={f.status} onChange={(v) => setF({ ...f, status: v })} options={[{ value: "", label: "Open" }, { value: "BRIEF", label: "Briefed" }, { value: "ARCHIVED", label: "Archived" }]} style={{ width: "auto" }} />
      </>}>
        <QueryView q={ideas} empty={(d: any[]) => !d.length && <Empty title="No ideas match">Generate ideas from your strategy, or add your own.</Empty>}>
          {(list: any[]) => (
            <div className="table-wrap"><table>
              <thead><tr><th>Score</th><th>Idea</th><th>Pillar / series</th><th>Platform</th><th>Effort</th><th>Status</th></tr></thead>
              <tbody>{list.map((i) => (
                <tr key={i.id} className="clickable" onClick={() => setOpen(i.id)}>
                  <td><ScorePill score={i.scoring.score} title={`Confidence ${i.scoring.confidence}; data coverage ${Math.round(i.scoring.coverage * 100)}%`} /><div className="faint">{i.scoring.confidence} conf.</div></td>
                  <td><b>{i.title}</b><div className="muted small clamp2">{i.angle}</div>{i.duplicateOf && <Badge tone="warn">≈{Math.round(i.duplicateSimilarity * 100)}% like “{(i.duplicateTitle ?? "existing content").slice(0, 40)}”</Badge>}</td>
                  <td className="small">{i.pillarName ?? <span className="faint">unassigned</span>}{i.seriesName && <div className="faint">Series: {i.seriesName}</div>}</td>
                  <td className="small">{i.platform ?? "—"}<div className="faint">{i.format}</div></td>
                  <td><Badge>{i.effort}</Badge></td>
                  <td><StatusBadge status={i.status} /></td>
                </tr>))}</tbody>
            </table></div>
          )}
        </QueryView>
      </Card>
      {open && <IdeaModal id={open} onClose={() => setOpen(null)} />}
      {adding && <AddIdea onClose={() => setAdding(false)} pillars={pillars.data ?? []} platformOpts={platformOpts} />}
    </>
  );
}

function IdeaModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { brandId } = useBrand();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["idea", id], queryFn: () => api.get(`/ideas/${id}`) });
  const [runId, setRunId] = useState<string | null>(null);
  const inv = [["ideas", brandId], ["idea", id]];
  const patch = useAction((p: any) => api.patch(`/ideas/${id}`, p), { invalidate: inv, success: "Updated" });
  const brief = useAction(() => api.post(`/brands/${brandId}/agent/runs`, { task: "create_brief", input: { ideaId: id } }), { onSuccess: (r) => setRunId(r.id) });
  return (
    <Modal title="Idea" onClose={onClose}>
      <QueryView q={q}>
        {(i) => (
          <>
            <div className="row"><ScorePill score={i.scoring.score} /><ConfidenceBadge c={i.scoring.confidence} /><span className="faint">data coverage {Math.round(i.scoring.coverage * 100)}% · missing-data penalty −{i.scoring.missingPenalty} pts · up to {i.scoring.maxIfDataFound} if missing data is strong</span></div>
            <h2>{i.title}</h2>
            <p className="muted">{i.angle}</p>
            {i.rationale && <div className="notice small pre">{i.rationale}</div>}
            {i.duplicateOf && <div className="notice warn small">Looks {Math.round(i.duplicateSimilarity * 100)}% similar to “{i.duplicateTitle ?? "existing content"}”. Make the angle clearly different or archive one.</div>}
            <Breakdown rows={i.scoring.breakdown} labels={OPP_LABELS} />
            <p className="faint">{i.scoring.note} Rate unknown dimensions yourself to remove the penalty:</p>
            <div className="grid g4">
              {["differentiation", "demandEvidence", "timeliness", "feasibility"].map((d) => (
                <Field key={d} label={OPP_LABELS[d]}><Select value={i.ratings?.[d] == null ? "" : String(i.ratings[d])} onChange={(v) => patch.mutate({ ratings: { [d]: v === "" ? null : Number(v) }, ratingReasons: { [d]: "Rated by you" } })} options={[{ value: "", label: "unknown" }, ...[0, 1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))]} /></Field>
              ))}
            </div>
            <div className="row">
              <span className="small">Your rating:</span>
              {[1, 2, 3, 4, 5].map((n) => <Button key={n} size="sm" kind={i.userRating >= n ? "primary" : undefined} onClick={() => patch.mutate({ userRating: n })} aria-label={`Rate ${n}`}>★</Button>)}
            </div>
            <div className="row">
              {i.status !== "BRIEF" && <Button kind="primary" onClick={() => brief.mutate()} busy={brief.isPending} disabled={!!runId}>Promote to brief (agent)</Button>}
              {i.status !== "ARCHIVED" ? <Button onClick={() => patch.mutate({ status: "ARCHIVED" })}>Archive</Button> : <Button onClick={() => patch.mutate({ status: "IDEA" })}>Restore</Button>}
              <span className="faint">{i.revisions} edit(s) in history · source: {i.source}</span>
            </div>
            {runId && <RunProgress runId={runId} compact invalidate={inv} onDone={(r) => r.output?.briefId && nav(`/briefs/${r.output.briefId}`)} />}
          </>
        )}
      </QueryView>
    </Modal>
  );
}

function AddIdea({ onClose, pillars, platformOpts }: { onClose: () => void; pillars: any[]; platformOpts: any[] }) {
  const { brandId, meta } = useBrand();
  const [i, setI] = useState({ title: "", angle: "", rationale: "", pillarId: "", platform: "", format: "", effort: "medium", audience: "" });
  const add = useAction(() => api.post(`/brands/${brandId}/ideas`, { ...i, pillarId: i.pillarId || null, platform: i.platform || null, format: i.format || null, source: "manual" }), { success: (r) => (r.duplicateOf ? `Saved — but it looks ${Math.round(r.duplicateSimilarity * 100)}% similar to existing content` : "Idea saved"), invalidate: [["ideas", brandId]], onSuccess: onClose });
  return (
    <Modal title="Add idea" onClose={onClose} footer={<Button kind="primary" onClick={() => add.mutate()} disabled={i.title.length < 3} busy={add.isPending}>Save idea</Button>}>
      <Field label="Title"><TextInput value={i.title} onChange={(v) => setI({ ...i, title: v })} /></Field>
      <Field label="Unique angle"><TextArea value={i.angle} onChange={(v) => setI({ ...i, angle: v })} rows={2} /></Field>
      <Field label="Why it should work (rationale / evidence)"><TextArea value={i.rationale} onChange={(v) => setI({ ...i, rationale: v })} rows={2} /></Field>
      <div className="grid g4">
        <Field label="Pillar"><Select value={i.pillarId} onChange={(v) => setI({ ...i, pillarId: v })} options={[{ value: "", label: "—" }, ...pillars.map((p) => ({ value: p.id, label: p.name }))]} /></Field>
        <Field label="Platform"><Select value={i.platform} onChange={(v) => setI({ ...i, platform: v })} options={[{ value: "", label: "—" }, ...platformOpts.slice(1)]} /></Field>
        <Field label="Format"><Select value={i.format} onChange={(v) => setI({ ...i, format: v })} options={[{ value: "", label: "—" }, ...Object.entries(meta?.formats ?? {}).map(([k, v]) => ({ value: k, label: String(v) }))]} /></Field>
        <Field label="Effort"><Select value={i.effort} onChange={(v) => setI({ ...i, effort: v })} options={["low", "medium", "high"].map((x) => ({ value: x, label: x }))} /></Field>
      </div>
    </Modal>
  );
}
