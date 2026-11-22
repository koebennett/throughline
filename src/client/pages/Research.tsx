import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useBrand } from "../context";
import { Badge, Button, Card, ConfidenceBadge, Empty, EvidenceBadge, Field, fmtDate, ListInput, Modal, PageHead, QueryView, Select, StatusBadge, TextArea, TextInput, useAction } from "../components/ui";
import { RunTaskButton } from "../components/agent";

export function ResearchPage() {
  const { brandId, meta } = useBrand();
  const [topic, setTopic] = useState("");
  const [question, setQuestion] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  const [web, setWeb] = useState(true);
  const [runFilter, setRunFilter] = useState("");
  const runs = useQuery({ queryKey: ["research-runs", brandId], queryFn: () => api.get(`/brands/${brandId}/research-runs`) });
  const evidence = useQuery({ queryKey: ["evidence", brandId, runFilter], queryFn: () => api.get(`/brands/${brandId}/evidence${runFilter ? `?run=${runFilter}` : ""}`) });
  const sources = useQuery({ queryKey: ["sources", brandId], queryFn: () => api.get(`/brands/${brandId}/sources`) });
  const inv = [["evidence", brandId], ["sources", brandId], ["research-runs", brandId], ["home", brandId]];
  return (
    <>
      <PageHead title="Research Desk" sub="Dated, cited evidence — with facts, observations, inferences and hypotheses kept apart. Nothing here is invented: unsupported claims are downgraded automatically." />
      <div className="grid g3">
        <Card title="Run a research task" className="span2">
          <div className="grid g2">
            <Field label="Topic"><TextInput value={topic} onChange={setTopic} placeholder="e.g. budgeting with irregular income" /></Field>
            <Field label="Specific question (optional)"><TextInput value={question} onChange={setQuestion} placeholder="What do beginners get wrong?" /></Field>
            <Field label="Public URLs to read (optional)" hint="One per line. Public pages only — no logged-in platforms. Private/internal addresses are refused."><ListInput value={urls} onChange={setUrls} rows={3} placeholder="https://…" /></Field>
            <div className="stack">
              <label className="check"><input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} disabled={!meta?.model.live} /> Use Claude web search (cited, max {meta?.settings.maxWebSearchesPerRun} searches/run)</label>
              {!meta?.model.live && <span className="faint">Web search needs a Claude API key. Offline, research uses the URLs you provide and sources already on file.</span>}
            </div>
          </div>
          <div style={{ marginTop: 12 }}><RunTaskButton task="research_topic" input={{ topic, question, urls, useWebSearch: web && !!meta?.model.live }} label="Research" disabled={topic.trim().length < 2} invalidate={inv} /></div>
        </Card>
        <Card title="Research runs">
          <QueryView q={runs} empty={(d: any[]) => !d.length && <p className="muted">No research runs yet.</p>}>
            {(list: any[]) => list.slice(0, 12).map((r) => (
              <button key={r.id} className={`list-item ${runFilter === r.id ? "selected" : ""}`} style={{ width: "100%", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }} onClick={() => setRunFilter(runFilter === r.id ? "" : r.id)}>
                <div className="row between"><b className="small">{r.topic}</b><StatusBadge status={r.status === "complete" ? "succeeded" : r.status} /></div>
                <div className="faint">{r.provider} · {r.evidenceCount} evidence · {r.sourceCount} sources · {fmtDate(r.createdAt)}</div>
              </button>
            ))}
          </QueryView>
        </Card>
      </div>
      {runFilter && <RunSynthesis id={runFilter} />}
      <div className="grid g3" style={{ marginTop: 14 }}>
        <EvidenceCard q={evidence} sources={sources.data ?? []} filtered={!!runFilter} />
        <SourcesCard q={sources} />
      </div>
    </>
  );
}

function RunSynthesis({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["research-run", id], queryFn: () => api.get(`/research-runs/${id}`) });
  const s = q.data?.synthesis;
  if (!s) return null;
  const list = (t: string, xs: string[]) => xs?.length > 0 && <div><h3 style={{ marginBottom: 4 }}>{t}</h3><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
  return (
    <Card title={`Research brief: ${q.data.topic}`} className="" actions={<Badge>{q.data.provider}</Badge>}>
      <p className="muted" style={{ marginBottom: 10 }}>{s.summary}</p>
      <div className="grid g4">
        {list("Audience questions", s.audienceQuestions)}
        {list("Content gaps", s.contentGaps)}
        {list("Angles", s.angles)}
        {list("Open questions & audit", s.openQuestions)}
      </div>
    </Card>
  );
}

function EvidenceCard({ q, sources, filtered }: { q: any; sources: any[]; filtered: boolean }) {
  const { brandId } = useBrand();
  const [kind, setKind] = useState("");
  const [open, setOpen] = useState(false);
  const [e, setE] = useState({ claim: "", kind: "user_fact", confidence: "medium", topic: "", sourceId: "", quote: "" });
  const add = useAction(() => api.post(`/brands/${brandId}/evidence`, { ...e, sourceId: e.sourceId || null }), { success: (r) => (r.auditNote ? r.auditNote : "Evidence saved"), invalidate: [["evidence", brandId], ["home", brandId]], onSuccess: () => (setOpen(false), setE({ ...e, claim: "", quote: "" })) });
  const del = useAction((id: string) => api.del(`/evidence/${id}`), { invalidate: [["evidence", brandId]] });
  return (
    <Card title={filtered ? "Evidence from selected run" : "Evidence"} className="span2" actions={<>
      <Select value={kind} onChange={setKind} options={[{ value: "", label: "All kinds" }, { value: "user_fact", label: "User facts" }, { value: "fact", label: "Sourced facts" }, { value: "observation", label: "Observations" }, { value: "inference", label: "Inferences" }, { value: "hypothesis", label: "Hypotheses" }]} style={{ width: "auto" }} />
      <Button size="sm" kind="primary" onClick={() => setOpen(true)}>+ Add evidence</Button></>}>
      <QueryView q={q} empty={(d: any[]) => !d.length && <Empty title="No evidence yet">Run research, or add what you already know (comments you've seen, results you've had) as user facts.</Empty>}>
        {(list: any[]) => (
          <div className="stack">
            {list.filter((x) => !kind || x.kind === kind).map((x) => (
              <div key={x.id} className="list-item" style={{ marginTop: 0 }}>
                <div className="row between">
                  <div className="row"><EvidenceBadge kind={x.kind} /><ConfidenceBadge c={x.confidence} />{x.topic && <Badge>{x.topic}</Badge>}<span className="faint">by {x.createdBy}</span></div>
                  <Button size="sm" kind="ghost" onClick={() => del.mutate(x.id)} aria-label="Delete evidence">✕</Button>
                </div>
                <p style={{ marginTop: 4 }}>{x.claim}</p>
                {x.sourceTitle ? (
                  <div className="faint">Source: {x.sourceUrl ? <a href={x.sourceUrl} target="_blank" rel="noreferrer noopener">{x.sourceTitle}</a> : x.sourceTitle}{x.sourcePublisher && ` — ${x.sourcePublisher}`} · published {x.sourcePublishedAt || "unknown"} · retrieved {fmtDate(x.sourceRetrievedAt)}</div>
                ) : <div className="faint">No source attached</div>}
                {x.auditNote && <div className="small" style={{ color: "var(--warn)" }}>{x.auditNote}</div>}
              </div>
            ))}
          </div>
        )}
      </QueryView>
      {open && (
        <Modal title="Add evidence" onClose={() => setOpen(false)} footer={<Button kind="primary" onClick={() => add.mutate()} disabled={e.claim.length < 3} busy={add.isPending}>Save</Button>}>
          <Field label="Claim"><TextArea value={e.claim} onChange={(v) => setE({ ...e, claim: v })} /></Field>
          <div className="grid g3">
            <Field label="Kind" hint="Facts/observations need a source or they become inferences."><Select value={e.kind} onChange={(v) => setE({ ...e, kind: v })} options={[{ value: "user_fact", label: "User-supplied fact" }, { value: "fact", label: "Sourced fact" }, { value: "observation", label: "Source-backed observation" }, { value: "inference", label: "Inference" }, { value: "hypothesis", label: "Hypothesis" }]} /></Field>
            <Field label="Confidence"><Select value={e.confidence} onChange={(v) => setE({ ...e, confidence: v })} options={["low", "medium", "high"].map((x) => ({ value: x, label: x }))} /></Field>
            <Field label="Topic"><TextInput value={e.topic} onChange={(v) => setE({ ...e, topic: v })} /></Field>
          </div>
          <Field label="Source"><Select value={e.sourceId} onChange={(v) => setE({ ...e, sourceId: v })} options={[{ value: "", label: "— none —" }, ...sources.map((s) => ({ value: s.id, label: s.title.slice(0, 80) }))]} /></Field>
          <Field label="Quote (optional)"><TextArea value={e.quote} onChange={(v) => setE({ ...e, quote: v })} rows={2} /></Field>
        </Modal>
      )}
    </Card>
  );
}

function SourcesCard({ q }: { q: any }) {
  const { brandId } = useBrand();
  const [url, setUrl] = useState("");
  const [manual, setManual] = useState<any>(null);
  const imp = useAction(() => api.post(`/brands/${brandId}/sources/import-url`, { url }), { success: (s) => `Imported “${s.title}”`, invalidate: [["sources", brandId]], onSuccess: () => setUrl("") });
  const add = useAction(() => api.post(`/brands/${brandId}/sources`, manual), { success: "Source saved", invalidate: [["sources", brandId]], onSuccess: () => setManual(null) });
  const del = useAction((id: string) => api.del(`/sources/${id}`), { invalidate: [["sources", brandId], ["evidence", brandId]] });
  return (
    <Card title="Sources" actions={<Button size="sm" onClick={() => setManual({ title: "", url: "", publisher: "", publishedAt: "", excerpt: "", notes: "" })}>+ Manual</Button>}>
      <div className="row" style={{ flexWrap: "nowrap", marginBottom: 10 }}>
        <TextInput value={url} onChange={setUrl} placeholder="https://public-page…" />
        <Button onClick={() => imp.mutate()} busy={imp.isPending} disabled={!url.startsWith("http")}>Import</Button>
      </div>
      <QueryView q={q} empty={(d: any[]) => !d.length && <p className="muted">No sources yet.</p>}>
        {(list: any[]) => list.map((s) => (
          <div key={s.id} className="list-item">
            <div className="row between"><b className="small clamp2" style={{ flex: 1 }}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a> : s.title}</b><Button size="sm" kind="ghost" onClick={() => confirm("Delete source? Linked evidence keeps its text but loses the citation.") && del.mutate(s.id)}>✕</Button></div>
            <div className="faint">{s.publisher || "—"} · published {s.publishedAt || "unknown"} · retrieved {fmtDate(s.retrievedAt)} · {s.provider} · {s.evidenceCount} evidence</div>
          </div>
        ))}
      </QueryView>
      {manual && (
        <Modal title="Add a source" onClose={() => setManual(null)} footer={<Button kind="primary" onClick={() => add.mutate()} disabled={!manual.title} busy={add.isPending}>Save</Button>}>
          <div className="grid g2">
            <Field label="Title *"><TextInput value={manual.title} onChange={(v) => setManual({ ...manual, title: v })} /></Field>
            <Field label="URL"><TextInput value={manual.url} onChange={(v) => setManual({ ...manual, url: v })} /></Field>
            <Field label="Publisher"><TextInput value={manual.publisher} onChange={(v) => setManual({ ...manual, publisher: v })} /></Field>
            <Field label="Publication date"><input type="date" value={manual.publishedAt} onChange={(e) => setManual({ ...manual, publishedAt: e.target.value })} /></Field>
          </div>
          <Field label="Excerpt / key passage"><TextArea value={manual.excerpt} onChange={(v) => setManual({ ...manual, excerpt: v })} rows={4} /></Field>
          <Field label="Notes"><TextArea value={manual.notes} onChange={(v) => setManual({ ...manual, notes: v })} rows={2} /></Field>
        </Modal>
      )}
    </Card>
  );
}
