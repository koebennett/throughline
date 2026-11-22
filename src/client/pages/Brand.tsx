import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useBrand } from "../context";
import { Badge, Button, Card, ConfidenceBadge, Empty, Field, fmtDate, Modal, PageHead, QueryView, Select, StatusBadge, Tabs, TextArea, TextInput, useAction } from "../components/ui";
import { ProfileForm, SECTIONS } from "../components/ProfileForm";

type Tab = "profile" | "documents" | "memory" | "versions";

export function BrandPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "profile";
  return (
    <>
      <PageHead title="Brand Brain" sub="Your approved brand truth. The agent reads only what's relevant to each task, cites document sections, and never rewrites this profile on its own." />
      <Tabs<Tab> tabs={[{ id: "profile", label: "Profile" }, { id: "documents", label: "Documents" }, { id: "memory", label: "Memory & learnings" }, { id: "versions", label: "Version history" }]} value={tab} onChange={(t) => setParams({ tab: t })} />
      {tab === "profile" && <ProfileTab />}
      {tab === "documents" && <DocumentsTab />}
      {tab === "memory" && <MemoryTab />}
      {tab === "versions" && <VersionsTab />}
    </>
  );
}

function ProfileTab() {
  const { brandId, brand } = useBrand();
  const [p, setP] = useState<any>(null);
  const [section, setSection] = useState<(typeof SECTIONS)[number]["id"]>("basics");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (brand?.profile) setP(structuredClone(brand.profile));
  }, [brand?.profile, brand?.version]);
  const save = useAction(() => api.put(`/brands/${brandId}`, { profile: p, changeNote: note }), { success: (b) => `Saved as version ${b.version}`, invalidate: [["brand", brandId], ["brands"], ["versions", brandId], ["home", brandId]], onSuccess: () => setNote("") });
  if (!p) return null;
  const dirty = JSON.stringify(p) !== JSON.stringify(brand.profile);
  return (
    <div className="split">
      <Card className="sticky">
        <div className="stack tight">
          {SECTIONS.map((s) => (
            <Button key={s.id} kind={section === s.id ? "primary" : "ghost"} onClick={() => setSection(s.id)}>{s.label}</Button>
          ))}
        </div>
        <div className="divider" />
        <div className="faint">Version {brand.version} · updated {fmtDate(brand.updatedAt, true)}</div>
      </Card>
      <Card title={SECTIONS.find((s) => s.id === section)?.label} actions={dirty && <Badge tone="warn">Unsaved changes</Badge>}>
        <ProfileForm value={p} onChange={setP} section={section} />
        <div className="divider" />
        <div className="row">
          <TextInput value={note} onChange={setNote} placeholder="What changed? (saved with the version)" style={{ flex: 1, minWidth: 200 }} />
          <Button onClick={() => setP(structuredClone(brand.profile))} disabled={!dirty}>Discard</Button>
          <Button kind="primary" onClick={() => save.mutate()} disabled={!dirty || !p.name?.trim()} busy={save.isPending}>Save new version</Button>
        </div>
      </Card>
    </div>
  );
}

function DocumentsTab() {
  const { brandId } = useBrand();
  const docs = useQuery({ queryKey: ["docs", brandId], queryFn: () => api.get(`/brands/${brandId}/documents`) });
  const [adding, setAdding] = useState(false);
  const [doc, setDoc] = useState({ title: "", kind: "doc", content: "" });
  const [query, setQuery] = useState("");
  const [view, setView] = useState<string | null>(null);
  const search = useQuery({ queryKey: ["search", brandId, query], queryFn: () => api.get(`/brands/${brandId}/search?q=${encodeURIComponent(query)}`), enabled: query.trim().length > 2 });
  const add = useAction(() => api.post(`/brands/${brandId}/documents`, doc), { success: "Document added and indexed", invalidate: [["docs", brandId]], onSuccess: () => (setAdding(false), setDoc({ title: "", kind: "doc", content: "" })) });
  const upload = useAction((f: File) => { const fd = new FormData(); fd.append("file", f); return api.upload(`/brands/${brandId}/documents/upload`, fd); }, { success: "File added and indexed", invalidate: [["docs", brandId]] });
  const toggle = useAction((d: any) => api.patch(`/documents/${d.id}`, { excluded: !d.excluded }), { invalidate: [["docs", brandId]] });
  const del = useAction((id: string) => api.del(`/documents/${id}`), { success: "Deleted", invalidate: [["docs", brandId]] });
  return (
    <div className="grid g3">
      <Card title="Documents" className="span2" actions={<>
        <label className="btn sm">Upload .txt/.md/.srt/.vtt<input type="file" hidden accept=".txt,.md,.markdown,.srt,.vtt,.csv,.json" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} /></label>
        <Button size="sm" kind="primary" onClick={() => setAdding(true)}>+ Paste text</Button></>}>
        <QueryView q={docs} empty={(d: any[]) => !d.length && <Empty title="No documents yet">Add your offer sheet, about page, scripts, transcripts or content exports. They're chunked and searchable, and the agent cites them by section.</Empty>}>
          {(list: any[]) => (
            <div className="table-wrap"><table>
              <thead><tr><th>Title</th><th>Type</th><th>Size</th><th>Added</th><th /></tr></thead>
              <tbody>{list.map((d) => (
                <tr key={d.id}>
                  <td><button className="btn ghost sm" onClick={() => setView(d.id)}>{d.title}</button> {d.excluded && <Badge tone="muted">excluded from retrieval</Badge>}</td>
                  <td><Badge>{d.kind}</Badge></td><td className="faint">{d.chars.toLocaleString()} chars · {d.chunks} chunks</td><td className="faint">{fmtDate(d.createdAt)}</td>
                  <td className="nowrap"><Button size="sm" onClick={() => toggle.mutate(d)}>{d.excluded ? "Include" : "Exclude"}</Button> <Button size="sm" kind="danger" onClick={() => confirm(`Delete “${d.title}”?`) && del.mutate(d.id)}>Delete</Button></td>
                </tr>))}
              </tbody></table></div>
          )}
        </QueryView>
      </Card>
      <Card title="Test retrieval">
        <Field label="What would the agent find?"><TextInput value={query} onChange={setQuery} placeholder="e.g. pricing, audience, refund policy" /></Field>
        <div className="stack" style={{ marginTop: 10 }}>
          {search.data?.map((s: any) => (
            <div key={s.chunkId} className="list-item"><b className="small">{s.citation}</b><p className="small muted clamp2" style={{ WebkitLineClamp: 4 }}>{s.text}</p></div>
          ))}
          {search.data && !search.data.length && <p className="faint">No matching snippets.</p>}
        </div>
      </Card>
      {adding && (
        <Modal title="Add document" onClose={() => setAdding(false)} footer={<Button kind="primary" onClick={() => add.mutate()} busy={add.isPending} disabled={!doc.title || !doc.content}>Add & index</Button>}>
          <div className="grid g2">
            <Field label="Title"><TextInput value={doc.title} onChange={(v) => setDoc({ ...doc, title: v })} /></Field>
            <Field label="Type"><Select value={doc.kind} onChange={(v) => setDoc({ ...doc, kind: v })} options={["doc", "offer", "script", "transcript", "content_export", "note"].map((k) => ({ value: k, label: k }))} /></Field>
          </div>
          <Field label="Content" hint="Markdown headings (#) become citable sections."><TextArea value={doc.content} onChange={(v) => setDoc({ ...doc, content: v })} rows={12} /></Field>
        </Modal>
      )}
      {view && <DocViewer id={view} onClose={() => setView(null)} />}
    </div>
  );
}

function DocViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["doc", id], queryFn: () => api.get(`/documents/${id}`) });
  const [text, setText] = useState<string | null>(null);
  const save = useAction(() => api.patch(`/documents/${id}`, { content: text }), { success: "Saved and re-indexed", invalidate: [["doc", id], ["docs"]], onSuccess: onClose });
  return (
    <Modal title={q.data?.title ?? "Document"} onClose={onClose} footer={<Button kind="primary" disabled={text === null} onClick={() => save.mutate()} busy={save.isPending}>Save changes</Button>}>
      <QueryView q={q}>{(d) => <TextArea value={text ?? d.content} onChange={setText} rows={18} />}</QueryView>
    </Modal>
  );
}

function MemoryTab() {
  const { brandId } = useBrand();
  const q = useQuery({ queryKey: ["memory", brandId], queryFn: () => api.get(`/brands/${brandId}/memory`) });
  const [m, setM] = useState({ layer: "preference", statement: "" });
  const add = useAction(() => api.post(`/brands/${brandId}/memory`, { ...m, sourceType: "user" }), { success: "Saved", invalidate: [["memory", brandId]], onSuccess: () => setM({ ...m, statement: "" }) });
  const upd = useAction(({ id, ...patch }: any) => api.patch(`/memory/${id}`, patch), { invalidate: [["memory", brandId], ["home", brandId]] });
  const del = useAction((id: string) => api.del(`/memory/${id}`), { invalidate: [["memory", brandId]] });
  return (
    <div className="grid g3">
      <Card title="Memory" className="span2">
        <p className="faint" style={{ marginBottom: 10 }}>Learnings proposed by the agent or analytics stay <b>proposed</b> until you approve them. Conflicts are flagged, never silently merged.</p>
        <QueryView q={q} empty={(d: any[]) => !d.length && <Empty title="No memory yet">Approved learnings from analytics and your saved preferences will appear here.</Empty>}>
          {(list: any[]) => list.map((x) => (
            <div key={x.id} className="list-item">
              <div className="row between">
                <div className="row"><StatusBadge status={x.status} /><Badge>{x.layer}</Badge><ConfidenceBadge c={x.confidence} /><span className="faint">from {x.sourceType}{x.sourceRef ? ` · ${x.sourceRef}` : ""} · {fmtDate(x.createdAt)}</span></div>
                <div className="row">
                  {x.status !== "approved" && <Button size="sm" onClick={() => upd.mutate({ id: x.id, status: "approved" })}>Approve</Button>}
                  {x.status !== "rejected" && <Button size="sm" onClick={() => upd.mutate({ id: x.id, status: "rejected" })}>Reject</Button>}
                  <Button size="sm" onClick={() => { const s = prompt("Edit statement", x.statement); if (s && s.trim().length > 2) upd.mutate({ id: x.id, statement: s }); }}>Edit</Button>
                  <Button size="sm" kind="danger" onClick={() => del.mutate(x.id)}>Delete</Button>
                </div>
              </div>
              <p style={{ marginTop: 6 }}>{x.statement}</p>
              {x.conflictsWith && <div className="notice warn small" style={{ marginTop: 6 }}>Possible conflict with another memory item — review both.</div>}
            </div>
          ))}
        </QueryView>
      </Card>
      <Card title="Add a preference or fact">
        <div className="stack">
          <Field label="Layer"><Select value={m.layer} onChange={(v) => setM({ ...m, layer: v })} options={["brand", "project", "content", "research", "preference"].map((x) => ({ value: x, label: x }))} /></Field>
          <Field label="Statement"><TextArea value={m.statement} onChange={(v) => setM({ ...m, statement: v })} placeholder="e.g. Never film on weekdays; keep Shorts under 40 seconds." /></Field>
          <Button kind="primary" onClick={() => add.mutate()} disabled={m.statement.trim().length < 3} busy={add.isPending}>Save to memory</Button>
        </div>
      </Card>
    </div>
  );
}

function VersionsTab() {
  const { brandId } = useBrand();
  const q = useQuery({ queryKey: ["versions", brandId], queryFn: () => api.get(`/brands/${brandId}/versions`) });
  const restore = useAction((v: number) => api.post(`/brands/${brandId}/versions/${v}/restore`), { success: (b) => `Restored as version ${b.version}`, invalidate: [["brand", brandId], ["versions", brandId]] });
  return (
    <Card title="Profile versions">
      <QueryView q={q}>
        {(list: any[]) => (
          <table>
            <thead><tr><th>Version</th><th>Change</th><th>By</th><th>When</th><th /></tr></thead>
            <tbody>{list.map((v, i) => (
              <tr key={v.version}><td>v{v.version} {i === 0 && <Badge tone="good">current</Badge>}</td><td>{v.changeNote || <span className="faint">—</span>}</td><td>{v.createdBy}</td><td className="faint">{fmtDate(v.createdAt, true)}</td>
                <td>{i > 0 && <Button size="sm" onClick={() => restore.mutate(v.version)}>Restore</Button>}</td></tr>
            ))}</tbody>
          </table>
        )}
      </QueryView>
    </Card>
  );
}
