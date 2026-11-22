import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useBrand } from "../context";
import { Badge, Button, Card, Empty, Field, fmtDate, Modal, PageHead, QueryView, Select, StatusBadge, TextArea, TextInput, useAction } from "../components/ui";
import { RunTaskButton } from "../components/agent";

const RIGHTS = [{ value: "owned", label: "Owned (I made it)" }, { value: "licensed", label: "Licensed" }, { value: "public_domain", label: "Public domain" }, { value: "permissioned", label: "Permissioned (written OK)" }, { value: "unknown", label: "Unknown" }];

export function RepurposePage() {
  const { brandId, meta } = useBrand();
  const assets = useQuery({ queryKey: ["assets", brandId], queryFn: () => api.get(`/brands/${brandId}/assets`) });
  const lineage = useQuery({ queryKey: ["lineage", brandId], queryFn: () => api.get(`/brands/${brandId}/lineage`) });
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [opts, setOpts] = useState({ maxMoments: 4, platform: "youtube_shorts" });
  const inv = [["assets", brandId], ["lineage", brandId], ["content", brandId]];
  const rights = useAction(({ id, rights }: { id: string; rights: string }) => api.patch(`/assets/${id}/rights`, { rights, note: "Updated in Repurposing Studio" }), { success: "Rights updated — re-run QA on derivatives", invalidate: inv });
  const del = useAction((id: string) => api.del(`/assets/${id}`), { success: "Deleted", invalidate: inv });
  const selected = assets.data?.find((a: any) => a.id === sel);
  return (
    <>
      <PageHead title="Repurposing Studio" sub="Turn your own long-form into platform-native derivatives with timestamps and lineage. Only owned, licensed or permissioned sources — the app never downloads other creators' media or uses platform APIs to fetch audiovisual content." actions={<Button kind="primary" onClick={() => setAdding(true)}>+ Add source</Button>} />
      <div className="grid g3">
        <Card title="Source assets" className="span2">
          <QueryView q={assets} empty={(d: any[]) => !d.length && <Empty title="No sources yet">Upload a transcript (.txt, .srt, .vtt) of your own video or podcast, or paste one. Video/audio files are recorded as metadata only — edit clips from your original file.</Empty>}>
            {(list: any[]) => (
              <div className="table-wrap"><table>
                <thead><tr><th>Asset</th><th>Rights</th><th>Text</th><th>Derivatives</th><th /></tr></thead>
                <tbody>{list.map((a) => (
                  <tr key={a.id} className={sel === a.id ? "" : "clickable"} onClick={() => setSel(a.id)} style={sel === a.id ? { background: "var(--accent-soft)" } : undefined}>
                    <td><b>{a.title}</b><div className="faint">{a.kind}{a.filename && ` · ${a.filename}`} · {fmtDate(a.createdAt)}</div></td>
                    <td onClick={(e) => e.stopPropagation()}><Select value={a.rights} onChange={(v) => rights.mutate({ id: a.id, rights: v })} options={RIGHTS} aria-label="Rights" /></td>
                    <td className="faint">{a.textChars ? `${a.textChars.toLocaleString()} chars` : "metadata only"}</td>
                    <td>{a.derivativeCount}</td>
                    <td onClick={(e) => e.stopPropagation()}><Button size="sm" kind="danger" onClick={() => confirm(`Delete “${a.title}” and its lineage links?`) && del.mutate(a.id)}>Delete</Button></td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </QueryView>
        </Card>
        <Card title="Find clip-worthy moments">
          {selected ? (
            <div className="stack">
              <b>{selected.title}</b>
              {selected.rights === "unknown" && <div className="notice warn small">Rights unknown — derivatives will be blocked at QA until you confirm them.</div>}
              {!selected.textChars && <div className="notice small">This asset has no transcript. Add one to extract moments.</div>}
              <div className="grid g2">
                <Field label="Moments"><input type="number" min={1} max={8} value={opts.maxMoments} onChange={(e) => setOpts({ ...opts, maxMoments: Number(e.target.value) })} /></Field>
                <Field label="Target"><Select value={opts.platform} onChange={(v) => setOpts({ ...opts, platform: v })} options={(meta?.platforms ?? []).filter((p: any) => p.spec.formats.includes("short_video")).map((p: any) => ({ value: p.id, label: p.label }))} /></Field>
              </div>
              <RunTaskButton task="repurpose_transcript" input={{ assetId: selected.id, ...opts }} label="Extract & draft derivatives" disabled={!selected.textChars} invalidate={inv} />
            </div>
          ) : <p className="muted">Select a source asset.</p>}
        </Card>
      </div>
      <Card title="Content lineage map">
        <QueryView q={lineage} empty={(d: any[]) => !d.length && <p className="muted">Derivatives appear here, each linked to its source and exact segment.</p>}>
          {(list: any[]) => (
            <div className="table-wrap"><table className="small">
              <thead><tr><th>Source</th><th>Segment</th><th>Derivative</th><th>Status</th></tr></thead>
              <tbody>{list.map((l) => (
                <tr key={l.id}><td>{l.assetTitle} <Badge tone={l.assetRights === "unknown" ? "bad" : "good"}>{l.assetRights}</Badge></td><td className="mono">{l.segmentStart} → {l.segmentEnd}<div className="faint clamp2">“{l.quote}”</div></td><td><Link to={`/studio/${l.derivativeContentItemId}`}>{l.derivativeTitle}</Link><div className="faint">{l.derivativePlatform}</div></td><td><StatusBadge status={l.derivativeStatus} /></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </QueryView>
      </Card>
      {adding && <AddAsset onClose={() => setAdding(false)} onAdded={(id) => (setSel(id), setAdding(false))} />}
    </>
  );
}

function AddAsset({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const { brandId } = useBrand();
  const [a, setA] = useState({ title: "", kind: "transcript", rights: "owned", rightsNote: "", textContent: "", sourceUrl: "" });
  const [file, setFile] = useState<File | null>(null);
  const inv = [["assets", brandId]];
  const add = useAction(() => api.post(`/brands/${brandId}/assets`, a), { success: "Source added", invalidate: inv, onSuccess: (r) => onAdded(r.id) });
  const upload = useAction(() => { const fd = new FormData(); fd.append("file", file!); fd.append("title", a.title || file!.name); fd.append("rights", a.rights); fd.append("rightsNote", a.rightsNote); return api.upload(`/brands/${brandId}/assets/upload`, fd); }, { success: "Uploaded", invalidate: inv, onSuccess: (r) => onAdded(r.id) });
  return (
    <Modal title="Add a source asset" onClose={onClose} footer={file ? <Button kind="primary" onClick={() => upload.mutate()} busy={upload.isPending}>Upload</Button> : <Button kind="primary" disabled={!a.title} onClick={() => add.mutate()} busy={add.isPending}>Save</Button>}>
      <div className="grid g2">
        <Field label="Title"><TextInput value={a.title} onChange={(v) => setA({ ...a, title: v })} /></Field>
        <Field label="Rights" hint="Required for QA; unknown rights block approval."><Select value={a.rights} onChange={(v) => setA({ ...a, rights: v })} options={RIGHTS} /></Field>
      </div>
      <Field label="Rights note"><TextInput value={a.rightsNote} onChange={(v) => setA({ ...a, rightsNote: v })} placeholder="e.g. my podcast ep. 12; guest signed release" /></Field>
      <Field label="Upload file" hint="Text: .txt .md .srt .vtt (≤5 MB, extracted). Media: recorded as metadata only."><input type="file" accept=".txt,.md,.srt,.vtt,.mp4,.mov,.mp3,.wav,.m4a,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      {!file && <Field label="…or paste a transcript" hint="Keep timestamps like [12:30] so derivatives cite exact segments."><TextArea value={a.textContent} onChange={(v) => setA({ ...a, textContent: v })} rows={10} /></Field>}
    </Modal>
  );
}
