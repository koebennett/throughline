import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useBrand } from "../context";
import { Badge, Button, Card, ConfidenceBadge, Empty, Field, fmtDate, Modal, PageHead, QueryView, Select, StatusBadge, Tabs, TextArea, TextInput, useAction } from "../components/ui";
import { RunTaskButton } from "../components/agent";

export function AnalyticsPage() {
  const { brandId } = useBrand();
  const [tab, setTab] = useState<"results" | "import" | "experiments">("results");
  return (
    <>
      <PageHead title="Analytics & Learning Lab" sub="Compare each post with your own account's baseline on the same platform — never with invented benchmarks. Separate what's measured from what's only a hypothesis, then test one variable at a time." actions={<a className="btn" href="/api/analytics/template.csv">Download CSV template</a>} />
      <Tabs tabs={[{ id: "results", label: "Results" }, { id: "import", label: "Import data" }, { id: "experiments", label: "Experiment log" }]} value={tab} onChange={setTab} />
      {tab === "results" && <Results brandId={brandId} onImport={() => setTab("import")} />}
      {tab === "import" && <Import brandId={brandId} onDone={() => setTab("results")} />}
      {tab === "experiments" && <Experiments brandId={brandId} />}
    </>
  );
}

const fmt = (n: number | undefined) => (n === undefined ? "—" : Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(Math.round(n * 100) / 100));
const ratioTone = (r: number | null | undefined) => (r == null ? "neutral" : r >= 1.5 ? "good" : r <= 0.67 ? "bad" : "neutral");

function Results({ brandId, onImport }: { brandId: string; onImport: () => void }) {
  const { meta } = useBrand();
  const q = useQuery({ queryKey: ["analytics", brandId], queryFn: () => api.get(`/brands/${brandId}/analytics`) });
  const [platform, setPlatform] = useState<string>("");
  const [pm, setPm] = useState<string | null>(null);
  const metricLabel = (k: string) => meta?.metrics?.find((m: any) => m.key === k)?.label ?? k;
  return (
    <QueryView q={q} empty={(d) => !d.platforms.length && <Card><Empty title="No performance data yet" action={<Button kind="primary" onClick={onImport}>Import a CSV</Button>}>Export analytics from YouTube Studio, Instagram, TikTok or any tool as CSV — headers are mapped for you. API connections can be added later.</Empty></Card>}>
      {(d) => {
        const pl = d.platforms.find((p: any) => p.platform === platform) ?? d.platforms[0];
        const metrics = Object.keys(pl.baseline).sort((a, b) => (a === pl.primaryMetric ? -1 : b === pl.primaryMetric ? 1 : 0)).slice(0, 6);
        return (
          <>
            <div className="row between" style={{ marginBottom: 12 }}>
              <div className="row">{d.platforms.map((p: any) => <Button key={p.platform} kind={p.platform === pl.platform ? "primary" : undefined} size="sm" onClick={() => setPlatform(p.platform)}>{p.platform} ({p.n})</Button>)}</div>
              <RunTaskButton task="analyze_performance" input={{ platform: pl.platform }} label="Interpret with the agent" invalidate={[["experiments", brandId], ["memory", brandId]]} />
            </div>
            <div className="notice small" style={{ marginBottom: 12 }}>Source: imported CSV · {pl.n} post(s) · window {fmtDate(pl.window.start)} → {fmtDate(pl.window.end)} · baseline = median of this platform's posts · {d.note}</div>
            <div className="grid g4">
              {metrics.slice(0, 4).map((k) => <Card key={k}><div className="stat"><span className="faint">Median {metricLabel(k)}</span><b>{fmt(pl.baseline[k].median)}</b><span className="faint">n={pl.baseline[k].n}</span></div></Card>)}
            </div>
            <div className="grid g3" style={{ marginTop: 14 }}>
              <Card title="Insights" className="span2">
                {pl.insights.length ? pl.insights.map((i: any, k: number) => <div key={k} className="list-item"><div className="row"><Badge tone={i.kind === "observation" ? "info" : "muted"}>{i.kind}</Badge><ConfidenceBadge c={i.confidence} /></div><p className="small" style={{ marginTop: 4 }}>{i.text}</p></div>) : <p className="muted">Not enough tagged data for patterns yet.</p>}
              </Card>
              <Card title="By segment">
                {(["format", "pillar", "weekday"] as const).map((dim) => pl.segments[dim].length > 0 && (
                  <div key={dim} style={{ marginBottom: 10 }}><h3 style={{ marginBottom: 4 }}>{dim}</h3>
                    {pl.segments[dim].map((s: any) => <div key={s.label} className="row between small"><span>{s.label} <span className="faint">n={s.n}</span></span><Badge tone={ratioTone(s.ratio)}>{s.ratio ?? "—"}× median</Badge></div>)}
                  </div>
                ))}
              </Card>
            </div>
            <Card title="Posts vs own baseline">
              <div className="table-wrap"><table className="small">
                <thead><tr><th>Post</th><th>Published</th><th>Format / pillar</th>{metrics.map((m) => <th key={m}>{metricLabel(m)}</th>)}<th>Verdict</th><th /></tr></thead>
                <tbody>{pl.posts.map((p: any) => (
                  <tr key={p.id}>
                    <td style={{ maxWidth: 280 }}>{p.url ? <a href={p.url} target="_blank" rel="noreferrer noopener">{p.title}</a> : p.title}{p.contentItemId && <div><Badge tone="accent">linked to library</Badge></div>}</td>
                    <td className="nowrap faint">{fmtDate(p.publishedAt)}</td>
                    <td>{p.format || "—"}<div className="faint">{p.pillar}</div></td>
                    {metrics.map((m) => <td key={m}>{fmt(p.metrics[m])}{p.vsBaseline[m] != null && <div><Badge tone={ratioTone(p.vsBaseline[m])}>{p.vsBaseline[m]}×</Badge></div>}</td>)}
                    <td><StatusBadge status={p.verdict === "outperformed" ? "succeeded" : p.verdict === "underperformed" ? "failed" : "draft"} /><div className="faint">{p.verdict.replace("_", " ")}</div></td>
                    <td><Button size="sm" onClick={() => setPm(p.id)}>Postmortem</Button></td>
                  </tr>))}</tbody>
              </table></div>
            </Card>
            {pm && <Postmortem id={pm} onClose={() => setPm(null)} />}
          </>
        );
      }}
    </QueryView>
  );
}

function Postmortem({ id, onClose }: { id: string; onClose: () => void }) {
  const { brandId } = useBrand();
  const q = useQuery({ queryKey: ["postmortem", id], queryFn: () => api.get(`/analytics/snapshots/${id}/postmortem`) });
  const addExp = useAction((e: any) => api.post(`/brands/${brandId}/experiments`, { hypothesis: e.hypothesis, variable: e.variable, targetMetric: e.metric, successThreshold: e.threshold, status: "planned" }), { success: "Added to experiment log", invalidate: [["experiments", brandId]] });
  const sec = (t: string, xs: string[]) => xs?.length > 0 && <div><h3>{t}</h3><ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
  return (
    <Modal title="Postmortem" onClose={onClose}>
      <QueryView q={q}>
        {(d) => (
          <>
            <div className="row"><b>{d.post.title}</b><ConfidenceBadge c={d.confidence} /></div>
            {sec("What happened (measured)", d.whatHappened)}
            {sec("What we know", d.known)}
            {sec("Hypotheses (not yet proven)", d.hypotheses)}
            {sec("Repeat", d.repeat)}
            {sec("Change", d.change)}
            <div className="list-item small"><b>Suggested experiment</b><p>{d.nextExperiment.hypothesis}</p><p className="faint">Variable: {d.nextExperiment.variable} · Metric: {d.nextExperiment.metric} · Threshold: {d.nextExperiment.threshold}</p><Button size="sm" onClick={() => addExp.mutate(d.nextExperiment)}>Add to experiment log</Button></div>
            <p className="faint">{d.note}</p>
          </>
        )}
      </QueryView>
    </Modal>
  );
}

function Import({ brandId, onDone }: { brandId: string; onDone: () => void }) {
  const { meta } = useBrand();
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("import.csv");
  const [platform, setPlatform] = useState("youtube");
  const [account, setAccount] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const imports = useQuery({ queryKey: ["imports", brandId], queryFn: () => api.get(`/brands/${brandId}/analytics/imports`) });
  const prev = useAction(() => api.post(`/brands/${brandId}/analytics/preview`, { text }), { onSuccess: (p) => (setPreview(p), setMapping(p.mapping)) });
  const imp = useAction(() => api.post(`/brands/${brandId}/analytics/import`, { text, filename, platform, account, mapping }), { success: (r) => `Imported ${r.rowCount} row(s)${r.skipped ? `, skipped ${r.skipped}` : ""}`, invalidate: [["analytics", brandId], ["imports", brandId], ["home", brandId]], onSuccess: (r) => (r.warnings?.length ? setPreview({ ...preview, importWarnings: r.warnings }) : onDone()) });
  const del = useAction((id: string) => api.del(`/analytics/imports/${id}`), { success: "Import deleted", invalidate: [["analytics", brandId], ["imports", brandId]] });
  const options = [{ value: "", label: "— ignore —" }, ...["post_ref", "title", "url", "published_at", "format", "pillar", "platform"].map((k) => ({ value: k, label: `meta: ${k}` })), ...(meta?.metrics ?? []).map((m: any) => ({ value: m.key, label: m.label }))];
  return (
    <div className="grid g3">
      <Card title="Import a CSV export" className="span2">
        <div className="stack">
          <div className="grid g3">
            <Field label="File"><input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFilename(f.name); setText(await f.text()); setPreview(null); } }} /></Field>
            <Field label="Platform"><Select value={platform} onChange={setPlatform} options={(meta?.platforms ?? []).map((p: any) => ({ value: p.id, label: p.label }))} /></Field>
            <Field label="Account (label)"><TextInput value={account} onChange={setAccount} placeholder="@yourchannel" /></Field>
          </div>
          <Field label="…or paste CSV"><TextArea value={text} onChange={(v) => (setText(v), setPreview(null))} rows={5} /></Field>
          <div><Button onClick={() => prev.mutate()} disabled={!text.trim()} busy={prev.isPending}>Preview & map columns</Button></div>
          {preview && (
            <>
              {preview.warnings.map((w: string, i: number) => <div key={i} className="notice warn small">{w}</div>)}
              <p className="faint">{preview.rowCount} data row(s). Check each column's mapping — unmapped columns are ignored. Totals rows are skipped; invalid numbers are ignored with a warning.</p>
              <div className="table-wrap"><table className="small">
                <thead><tr><th>CSV column</th><th>Maps to</th><th>Sample</th></tr></thead>
                <tbody>{preview.headers.map((h: string, i: number) => (
                  <tr key={h + i}><td>{h}</td><td><Select value={mapping[h] ?? ""} onChange={(v) => setMapping({ ...mapping, [h]: v })} options={options} aria-label={`Mapping for ${h}`} /></td><td className="faint">{preview.sample.slice(0, 3).map((r: string[]) => r[i]).join(" · ")}</td></tr>
                ))}</tbody>
              </table></div>
              <div><Button kind="primary" onClick={() => imp.mutate()} busy={imp.isPending}>Import {preview.rowCount} row(s)</Button></div>
              {preview.importWarnings && <div className="notice warn small"><b>Imported with warnings:</b><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{preview.importWarnings.slice(0, 15).map((w: string, i: number) => <li key={i}>{w}</li>)}</ul><Button size="sm" onClick={onDone}>View results</Button></div>}
            </>
          )}
        </div>
      </Card>
      <Card title="Import history">
        <QueryView q={imports} empty={(d: any[]) => !d.length && <p className="muted">No imports yet.</p>}>
          {(list: any[]) => list.map((i) => (
            <div key={i.id} className="list-item small">
              <div className="row between"><b>{i.filename}</b><Button size="sm" kind="danger" onClick={() => confirm("Delete this import and its rows?") && del.mutate(i.id)}>Delete</Button></div>
              <div className="faint">{i.platform}{i.account && ` · ${i.account}`} · {i.rowCount} rows{i.skipped ? `, ${i.skipped} skipped` : ""} · {i.source} · {fmtDate(i.createdAt)}</div>
            </div>
          ))}
        </QueryView>
      </Card>
    </div>
  );
}

function Experiments({ brandId }: { brandId: string }) {
  const q = useQuery({ queryKey: ["experiments", brandId], queryFn: () => api.get(`/brands/${brandId}/experiments`) });
  const [e, setE] = useState<any>(null);
  const save = useAction(() => (e.id ? api.put(`/brands/${brandId}/experiments/${e.id}`, e) : api.post(`/brands/${brandId}/experiments`, e)), { success: "Saved", invalidate: [["experiments", brandId]], onSuccess: () => setE(null) });
  const del = useAction((id: string) => api.del(`/experiments/${id}`), { invalidate: [["experiments", brandId]] });
  return (
    <Card title="Experiment log" actions={<Button kind="primary" size="sm" onClick={() => setE({ hypothesis: "", variable: "", targetMetric: "", successThreshold: "", startDate: "", endDate: "", status: "planned", result: "", decision: "" })}>+ Experiment</Button>}>
      <p className="faint" style={{ marginBottom: 8 }}>One major variable per experiment, a target metric, a success threshold and a decision when it ends.</p>
      <QueryView q={q} empty={(d: any[]) => !d.length && <Empty title="No experiments yet">Add one from a postmortem or the strategy.</Empty>}>
        {(list: any[]) => (
          <div className="table-wrap"><table className="small">
            <thead><tr><th>Hypothesis</th><th>Variable</th><th>Metric / threshold</th><th>Window</th><th>Status</th><th>Result → decision</th><th /></tr></thead>
            <tbody>{list.map((x) => (
              <tr key={x.id}><td>{x.hypothesis}</td><td>{x.variable}</td><td>{x.targetMetric}<div className="faint">{x.successThreshold}</div></td><td className="faint">{x.startDate || "?"} → {x.endDate || "?"}</td><td><StatusBadge status={x.status === "running" ? "running" : x.status === "completed" ? "succeeded" : x.status === "abandoned" ? "cancelled" : "draft"} /></td><td>{x.result || "—"}{x.decision && <div className="faint">→ {x.decision}</div>}</td>
                <td className="nowrap"><Button size="sm" onClick={() => setE(x)}>Edit</Button> <Button size="sm" kind="ghost" onClick={() => del.mutate(x.id)}>✕</Button></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </QueryView>
      {e && (
        <Modal title={e.id ? "Edit experiment" : "New experiment"} onClose={() => setE(null)} footer={<Button kind="primary" disabled={e.hypothesis.length < 5 || !e.variable || !e.targetMetric || !e.successThreshold} onClick={() => save.mutate()}>Save</Button>}>
          <Field label="Hypothesis"><TextArea value={e.hypothesis} onChange={(v) => setE({ ...e, hypothesis: v })} rows={2} /></Field>
          <div className="grid g3">
            <Field label="One variable"><TextInput value={e.variable} onChange={(v) => setE({ ...e, variable: v })} /></Field>
            <Field label="Target metric"><TextInput value={e.targetMetric} onChange={(v) => setE({ ...e, targetMetric: v })} /></Field>
            <Field label="Success threshold"><TextInput value={e.successThreshold} onChange={(v) => setE({ ...e, successThreshold: v })} /></Field>
            <Field label="Start"><input type="date" value={e.startDate} onChange={(ev) => setE({ ...e, startDate: ev.target.value })} /></Field>
            <Field label="End"><input type="date" value={e.endDate} onChange={(ev) => setE({ ...e, endDate: ev.target.value })} /></Field>
            <Field label="Status"><Select value={e.status} onChange={(v) => setE({ ...e, status: v })} options={["planned", "running", "completed", "abandoned"].map((x) => ({ value: x, label: x }))} /></Field>
          </div>
          <Field label="Result"><TextArea value={e.result} onChange={(v) => setE({ ...e, result: v })} rows={2} /></Field>
          <Field label="Decision"><TextArea value={e.decision} onChange={(v) => setE({ ...e, decision: v })} rows={2} /></Field>
        </Modal>
      )}
    </Card>
  );
}
