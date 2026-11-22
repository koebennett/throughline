import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useBrand } from "../context";
import { Badge, Breakdown, Button, Card, CopyButton, download, Empty, Field, fmtDate, ListInput, Modal, PageHead, QueryView, ScorePill, Select, StatusBadge, TextArea, TextInput, useAction } from "../components/ui";

const QA_LABELS: Record<string, string> = { audienceValue: "Audience value", originality: "Originality", clarityHook: "Clarity & hook", evidenceAccuracy: "Evidence & accuracy", brandFit: "Brand fit", platformFit: "Platform fit", narrative: "Narrative / usefulness", ctaAlignment: "CTA / objective fit" };

export function StudioList() {
  const { brandId, meta } = useBrand();
  const [f, setF] = useState({ status: "", platform: "" });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const q = useQuery({ queryKey: ["content", brandId, qs], queryFn: () => api.get(`/brands/${brandId}/content?${qs}`) });
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHead title="Creation & Review" sub="Every draft is versioned. QA runs real checks — hard blockers stop approval; warnings explain how to fix. Approval is bound to the exact variant you reviewed." actions={<Button kind="primary" onClick={() => setAdding(true)}>+ Blank draft</Button>} />
      <Card actions={<>
        <Select value={f.status} onChange={(v) => setF({ ...f, status: v })} options={[{ value: "", label: "All statuses" }, ...["DRAFT", "QA", "REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED", "ANALYZED", "ARCHIVED"].map((s) => ({ value: s, label: s }))]} style={{ width: "auto" }} />
        <Select value={f.platform} onChange={(v) => setF({ ...f, platform: v })} options={[{ value: "", label: "All platforms" }, ...(meta?.platforms ?? []).map((p: any) => ({ value: p.id, label: p.label }))]} style={{ width: "auto" }} /></>} title="Content library">
        <QueryView q={q} empty={(d: any[]) => !d.length && <Empty title="No content yet">Draft from a brief, repurpose a transcript, or start a blank draft.</Empty>}>
          {(list: any[]) => (
            <div className="table-wrap"><table>
              <thead><tr><th>Title</th><th>Platform</th><th>Status</th><th>QA</th><th>Variants</th><th>Planned</th><th>Updated</th></tr></thead>
              <tbody>{list.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => nav(`/studio/${c.id}`)}>
                  <td><b>{c.title}</b></td><td className="small">{c.platform}<div className="faint">{c.format}</div></td><td><StatusBadge status={c.status} /></td>
                  <td><ScorePill score={c.lastQaScore} />{c.currentQaPassed === 0 && <div><Badge tone="bad">blocked</Badge></div>}</td><td>{c.variantCount}</td><td className="faint">{c.plannedAt ? fmtDate(c.plannedAt) : "—"}</td><td className="faint">{fmtDate(c.updatedAt)}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </QueryView>
      </Card>
      {adding && <BlankDraft onClose={() => setAdding(false)} />}
    </>
  );
}

function BlankDraft({ onClose }: { onClose: () => void }) {
  const { brandId, meta } = useBrand();
  const nav = useNavigate();
  const [d, setD] = useState({ title: "", platform: "youtube", format: "long_video" });
  const add = useAction(() => api.post(`/brands/${brandId}/content`, { ...d, fields: { body: "" } }), { invalidate: [["content", brandId]], onSuccess: (r) => nav(`/studio/${r.id}`) });
  const spec = meta?.platforms?.find((p: any) => p.id === d.platform)?.spec;
  return (
    <Modal title="Blank draft" onClose={onClose} footer={<Button kind="primary" disabled={!d.title} onClick={() => add.mutate()}>Create</Button>}>
      <Field label="Title"><TextInput value={d.title} onChange={(v) => setD({ ...d, title: v })} /></Field>
      <div className="grid g2">
        <Field label="Platform"><Select value={d.platform} onChange={(v) => setD({ ...d, platform: v, format: meta.platforms.find((p: any) => p.id === v).spec.defaultFormat })} options={(meta?.platforms ?? []).map((p: any) => ({ value: p.id, label: p.label }))} /></Field>
        <Field label="Format"><Select value={d.format} onChange={(v) => setD({ ...d, format: v })} options={(spec?.formats ?? []).map((f: string) => ({ value: f, label: meta.formats[f] }))} /></Field>
      </div>
    </Modal>
  );
}

export function StudioItem() {
  const { id } = useParams();
  const { brandId, meta } = useBrand();
  const q = useQuery({ queryKey: ["content-item", id], queryFn: () => api.get(`/content/${id}`) });
  const [selected, setSelected] = useState<string | null>(null);
  const [compare, setCompare] = useState<string | null>(null);
  const inv = [["content-item", id], ["content", brandId], ["home", brandId], ["calendar", brandId]];
  const item = q.data;
  const variantId = selected ?? item?.currentVariantId;
  const variant = item?.variants.find((v: any) => v.id === variantId);
  const review = item?.reviews.find((r: any) => r.variantId === variantId);
  const setCurrent = useAction((vid: string) => api.post(`/content/${id}/current-variant`, { variantId: vid }), { success: "Current variant changed", invalidate: inv });
  if (q.isPending || q.isError) return <QueryView q={q}>{() => null}</QueryView>;
  const spec = meta?.platforms?.find((p: any) => p.id === item.platform)?.spec;
  return (
    <>
      <PageHead title={item.title} sub={<span className="row"><Badge>{spec?.label ?? item.platform}</Badge><Badge>{meta?.formats?.[item.format] ?? item.format}</Badge><StatusBadge status={item.status} />{item.campaignName && <Badge tone="accent">{item.campaignName}</Badge>}{item.briefId && <Link to={`/briefs/${item.briefId}`} className="small">Brief: {item.briefTitle}</Link>}</span>} actions={<Link to="/studio" className="btn">← Library</Link>} />
      <div className="split">
        <div className="stack">
          <Card title="Variants">
            {item.variants.map((v: any) => (
              <div key={v.id} className={`list-item ${v.id === variantId ? "selected" : ""}`}>
                <button onClick={() => setSelected(v.id)} style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}>
                  <div className="row between"><b className="small">v{v.version} · {v.angleLabel || "Untitled angle"}</b>{v.id === item.currentVariantId && <Badge tone="good">current</Badge>}</div>
                  <div className="faint">{v.generatedBy === "offline-scaffold" ? "offline scaffold" : v.generatedBy} · {fmtDate(v.createdAt, true)}{v.parentVariantId ? " · revision" : ""}</div>
                  {(() => { const r = item.reviews.find((x: any) => x.variantId === v.id); return r ? <div className="row" style={{ marginTop: 4 }}><ScorePill score={r.score} />{r.passed ? <Badge tone="good">QA passed</Badge> : <Badge tone="bad">{r.blockers} blocker(s)</Badge>}</div> : <span className="faint">not reviewed</span>; })()}
                </button>
                <div className="row" style={{ marginTop: 6 }}>
                  {v.id !== item.currentVariantId && <Button size="sm" onClick={() => setCurrent.mutate(v.id)}>Make current</Button>}
                  {v.id !== variantId && <Button size="sm" onClick={() => setCompare(v.id)}>Compare</Button>}
                </div>
              </div>
            ))}
          </Card>
          <ApprovalCard item={item} inv={inv} />
          <PlanCard item={item} inv={inv} />
          {item.lineage.length > 0 && (
            <Card title="Lineage">
              {item.lineage.map((l: any) => (
                <div key={l.id} className="small list-item">
                  From <b>{l.assetTitle ?? l.sourceContentTitle}</b> {l.segmentStart && <Badge>{l.segmentStart} → {l.segmentEnd}</Badge>} {l.assetRights && <Badge tone={l.assetRights === "unknown" ? "bad" : "good"}>rights: {l.assetRights}</Badge>}
                  {l.quote && <p className="faint clamp2" style={{ marginTop: 4 }}>“{l.quote}”</p>}
                </div>
              ))}
              <Link className="small" to="/repurpose">Manage source rights</Link>
            </Card>
          )}
          <Card title="History">
            {item.history.slice(0, 15).map((h: any, i: number) => (
              <div key={i} className="small" style={{ marginBottom: 4 }}><span className="faint">{fmtDate(h.createdAt, true)}</span> · {h.action.replace(/_/g, " ")}{h.fromState && ` ${h.fromState} → ${h.toState}`} <span className="faint">({h.actor})</span></div>
            ))}
          </Card>
        </div>
        <div className="stack">
          {variant && <QaCard item={item} variant={variant} review={review} inv={inv} />}
          {variant && <DraftEditor key={variant.id} item={item} variant={variant} inv={inv} onSaved={() => setSelected(null)} />}
          {variant && <HandoffCard item={item} />}
        </div>
      </div>
      {compare && variant && <CompareModal a={variant} b={item.variants.find((v: any) => v.id === compare)} onClose={() => setCompare(null)} />}
    </>
  );
}

const fieldText = (f: any) => [f.titleOptions?.[0] && `# ${f.titleOptions[0]}`, f.hooks?.length && `Hook: ${f.hooks[0]}`, f.body, f.slides?.map((s: any, i: number) => `${i + 1}. ${s.heading} — ${s.text}`).join("\n"), f.beats?.map((b: any) => `• ${b.beat} [${b.visual}]`).join("\n"), f.caption && `Caption: ${f.caption}`, f.cta && `CTA: ${f.cta}`].filter(Boolean).join("\n\n");

function CompareModal({ a, b, onClose }: { a: any; b: any; onClose: () => void }) {
  return (
    <Modal title="Compare variants" onClose={onClose}>
      <div className="grid g2">
        {[a, b].map((v) => (
          <div key={v.id}><h3>v{v.version} · {v.angleLabel}</h3><p className="faint">{v.rationale}</p><pre className="small list-item">{fieldText(v.fields)}</pre></div>
        ))}
      </div>
    </Modal>
  );
}

function QaCard({ item, variant, review, inv }: { item: any; variant: any; review: any; inv: unknown[][] }) {
  const { meta } = useBrand();
  const [useModel, setUseModel] = useState(true);
  const run = useAction(() => api.post(`/content/${item.id}/qa`, { variantId: variant.id, useModel }), { success: (r) => (r.passed ? `QA passed (${r.score})` : `QA found ${r.blockers} blocker(s)`), invalidate: inv });
  const override = useAction(({ checkId, note }: { checkId: string; note: string }) => api.post(`/qa/${review.id}/override`, { checkId, note }), { success: "Override recorded", invalidate: inv });
  const [showDims, setShowDims] = useState(false);
  const checks = review?.checks ?? [];
  const order = { block: 0, warn: 1, pass: 2 } as Record<string, number>;
  return (
    <Card title={<div className="row"><h2>Quality & safety review</h2>{review && <ScorePill score={review.score} />}{review && <Badge>{review.method}</Badge>}</div>} actions={<>
      {meta?.model.live && <label className="check small"><input type="checkbox" checked={useModel} onChange={(e) => setUseModel(e.target.checked)} /> include Claude editor judgement</label>}
      <Button kind="primary" onClick={() => run.mutate()} busy={run.isPending}>Run QA on v{variant.version}</Button></>}>
      {!review ? <p className="muted">This variant hasn't been reviewed. QA is required before approval.</p> : (
        <div className="stack">
          {review.blockers > 0 ? <div className="notice bad">{review.blockers} hard blocker(s) — approval is disabled until fixed.</div> : <div className="notice good">No hard blockers{review.warnings ? ` · ${review.warnings} warning(s) to consider` : ""}.</div>}
          {[...checks].sort((a: any, b: any) => order[a.status] - order[b.status]).map((c: any) => {
            const ack = review.acknowledged?.find((a: any) => a.checkId === c.id);
            return (
              <div key={c.id} className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                <Badge tone={c.status === "block" ? (ack ? "muted" : "bad") : c.status === "warn" ? "warn" : "good"}>{c.status === "block" ? (ack ? "overridden" : "BLOCKER") : c.status === "warn" ? "warning" : "pass"}</Badge>
                <div style={{ flex: 1 }}>
                  <b className="small">{c.label}</b>{c.origin === "model" && <span className="faint"> · editor model</span>}
                  {c.status !== "pass" && <div className="small">{c.message}</div>}
                  {c.status !== "pass" && c.fix && <div className="small muted">Fix: {c.fix}</div>}
                  {ack && <div className="faint">Override note: {ack.note}</div>}
                </div>
                {c.status === "block" && c.overridable && !ack && <Button size="sm" onClick={() => { const note = prompt("Why is this model-raised blocker wrong? (recorded in the audit log)"); if (note) override.mutate({ checkId: c.id, note }); }}>Override</Button>}
              </div>
            );
          })}
          <Button size="sm" kind="ghost" onClick={() => setShowDims(!showDims)}>{showDims ? "Hide" : "Show"} rubric breakdown</Button>
          {showDims && <Breakdown rows={review.dimensions} labels={QA_LABELS} />}
          <p className="faint">Quality rubric for triage — not a prediction of reach, ranking or monetization. Reviewed {fmtDate(review.createdAt, true)}.</p>
        </div>
      )}
    </Card>
  );
}

const GROUPS: Record<string, string[]> = {
  long_video: ["titleOptions", "hooks", "body", "description", "chapters", "thumbnailConcepts", "pinnedComment", "cta", "targetLength"],
  short_video: ["titleOptions", "hooks", "beats", "body", "caption", "hashtags", "cta", "targetLength"],
  carousel: ["hooks", "slides", "caption", "hashtags", "cta"],
  article: ["titleOptions", "hooks", "body", "seoTitle", "metaDescription", "cta"],
  newsletter_issue: ["titleOptions", "description", "body", "cta"],
  thread: ["hooks", "body", "cta"],
  text_post: ["hooks", "body", "hashtags", "cta"],
};
const ALL = ["titleOptions", "hooks", "body", "caption", "description", "chapters", "slides", "beats", "hashtags", "cta", "thumbnailConcepts", "visualPrompts", "pinnedComment", "seoTitle", "metaDescription", "productionNotes", "targetLength", "claimsToVerify"];
const LABELS: Record<string, string> = { titleOptions: "Title options", hooks: "Opening hooks", body: "Script / body", caption: "Caption", description: "Description", chapters: "Chapters", slides: "Slides", beats: "Beat sheet", hashtags: "Hashtags", cta: "Call to action", thumbnailConcepts: "Thumbnail concepts", visualPrompts: "Image/video generation prompts (not factual claims)", pinnedComment: "Pinned comment", seoTitle: "SEO title", metaDescription: "Meta description", productionNotes: "Production / edit notes", targetLength: "Target length", claimsToVerify: "Claims to verify (clear each once checked)" };

function DraftEditor({ item, variant, inv, onSaved }: { item: any; variant: any; inv: unknown[][]; onSaved: () => void }) {
  const { meta } = useBrand();
  const [f, setF] = useState<any>(() => structuredClone(variant.fields));
  const [label, setLabel] = useState(`${variant.angleLabel || "Draft"} (edited)`);
  const [showAll, setShowAll] = useState(false);
  const [regen, setRegen] = useState({ field: "hooks", instruction: "" });
  useEffect(() => setF(structuredClone(variant.fields)), [variant.id, variant.fields]);
  const dirty = JSON.stringify(f) !== JSON.stringify(variant.fields);
  const save = useAction(() => api.post(`/content/${item.id}/variants`, { fields: f, angleLabel: label, parentVariantId: variant.id }), { success: "Saved as a new variant (previous kept in history)", invalidate: inv, onSuccess: onSaved });
  const regenerate = useAction(() => api.post(`/content/${item.id}/regenerate`, regen), { success: "Section regenerated as a new variant", invalidate: inv, onSuccess: onSaved });
  const fields = useMemo(() => (showAll ? ALL : [...(GROUPS[item.format] ?? GROUPS.text_post), ...(f.claimsToVerify?.length ? ["claimsToVerify"] : []), "productionNotes"]), [showAll, item.format, f.claimsToVerify?.length]);
  const limits = meta?.platforms?.find((p: any) => p.id === item.platform)?.spec?.limits ?? {};
  return (
    <Card title={`Edit v${variant.version}`} actions={<><Button size="sm" kind="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? "Relevant fields" : "All fields"}</Button></>}>
      {variant.rationale && <p className="faint" style={{ marginBottom: 8 }}>Rationale: {variant.rationale}</p>}
      <div className="stack">
        {fields.map((k) => {
          const v = f[k];
          const limit = limits[k === "body" ? "body" : k];
          const len = typeof v === "string" ? v.length : 0;
          const hint = limit && typeof v === "string" ? <span style={{ color: len > limit ? "var(--bad)" : undefined }}>{len}/{limit} (commonly documented limit — verify)</span> : undefined;
          if (k === "slides") return <PairList key={k} label={LABELS[k]} items={v} a="heading" b="text" onChange={(x) => setF({ ...f, slides: x })} />;
          if (k === "chapters") return <PairList key={k} label={LABELS[k]} items={v} a="time" b="label" onChange={(x) => setF({ ...f, chapters: x })} />;
          if (k === "beats") return <PairList key={k} label={LABELS[k]} items={v} a="beat" b="visual" onChange={(x) => setF({ ...f, beats: x.map((y: any) => ({ seconds: null, ...y })) })} />;
          if (Array.isArray(v)) return <Field key={k} label={LABELS[k]}><ListInput value={v} onChange={(x) => setF({ ...f, [k]: x })} rows={k === "hooks" || k === "titleOptions" ? 3 : 2} /></Field>;
          return <Field key={k} label={LABELS[k]} hint={hint}><TextArea value={v} onChange={(x) => setF({ ...f, [k]: x })} rows={k === "body" ? 12 : 2} /></Field>;
        })}
      </div>
      <div className="divider" />
      <div className="row">
        <TextInput value={label} onChange={setLabel} style={{ flex: 1, minWidth: 200 }} aria-label="Variant label" />
        <Button onClick={() => setF(structuredClone(variant.fields))} disabled={!dirty}>Discard</Button>
        <Button kind="primary" disabled={!dirty} onClick={() => save.mutate()} busy={save.isPending}>Save as new variant</Button>
      </div>
      <div className="divider" />
      <div className="row">
        <span className="small"><b>Regenerate a section</b></span>
        <Select value={regen.field} onChange={(v) => setRegen({ ...regen, field: v })} options={["titleOptions", "hooks", "body", "caption", "description", "cta", "thumbnailConcepts", "hashtags", "pinnedComment"].map((x) => ({ value: x, label: LABELS[x] }))} style={{ width: "auto" }} />
        <TextInput value={regen.instruction} onChange={(v) => setRegen({ ...regen, instruction: v })} placeholder="Instruction, e.g. more specific, less hype" style={{ flex: 1, minWidth: 180 }} />
        <Button onClick={() => regenerate.mutate()} busy={regenerate.isPending} disabled={!meta?.model.live || dirty} title={!meta?.model.live ? "Needs a Claude API key" : dirty ? "Save or discard edits first" : ""}>Regenerate</Button>
      </div>
      {!meta?.model.live && <p className="faint">Section regeneration needs Claude. You can always edit by hand.</p>}
    </Card>
  );
}

function PairList({ label, items, a, b, onChange }: { label: string; items: any[]; a: string; b: string; onChange: (x: any[]) => void }) {
  return (
    <div className="field">
      <span>{label}</span>
      {items.map((it, i) => (
        <div key={i} className="row" style={{ flexWrap: "nowrap" }}>
          <input value={it[a] ?? ""} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, [a]: e.target.value } : x)))} style={{ maxWidth: a === "time" ? 90 : 220 }} aria-label={`${label} ${a} ${i + 1}`} />
          <input value={it[b] ?? ""} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, [b]: e.target.value } : x)))} aria-label={`${label} ${b} ${i + 1}`} />
          <Button size="sm" kind="ghost" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove">✕</Button>
        </div>
      ))}
      <div><Button size="sm" onClick={() => onChange([...items, { [a]: "", [b]: "" }])}>+ Add</Button></div>
    </div>
  );
}

function ApprovalCard({ item, inv }: { item: any; inv: unknown[][] }) {
  const [note, setNote] = useState("");
  const approve = useAction((decision: string) => api.post(`/content/${item.id}/approve`, { decision, note }), { success: (r) => (r.status === "APPROVED" ? "Approved" : "Changes requested"), invalidate: inv, onSuccess: () => setNote("") });
  const review = item.reviews.find((r: any) => r.variantId === item.currentVariantId);
  const approval = item.approvals.find((a: any) => a.variantId === item.currentVariantId && a.decision === "approved");
  const canApprove = item.status === "REVIEW" && review?.passed;
  return (
    <Card title="Approval">
      {approval ? <div className="notice good small">Current variant approved {fmtDate(approval.createdAt, true)}{approval.note ? ` — “${approval.note}”` : ""}.</div> : (
        <div className="stack">
          <p className="small muted">{!review ? "Run QA on the current variant first." : !review.passed ? "Fix QA blockers on the current variant first." : item.status === "REVIEW" ? "Ready for your decision." : `Status ${item.status}.`}</p>
          <TextInput value={note} onChange={setNote} placeholder="Note (optional)" />
          <div className="row">
            <Button kind="primary" disabled={!canApprove} onClick={() => approve.mutate("approved")} busy={approve.isPending}>Approve current variant</Button>
            <Button onClick={() => approve.mutate("changes_requested")} disabled={item.status === "DRAFT"}>Request changes</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function PlanCard({ item, inv }: { item: any; inv: unknown[][] }) {
  const { brandId, brand, meta } = useBrand();
  const tz = brand?.profile?.timezone || meta?.settings?.timezone || "UTC";
  const [when, setWhen] = useState(() => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16));
  const [url, setUrl] = useState("");
  const plan = useAction(() => api.post(`/brands/${brandId}/calendar`, { contentItemId: item.id, scheduledAt: new Date(when).toISOString(), timezone: tz }), { success: "Added to calendar (planned)", invalidate: inv });
  const transition = useAction((body: any) => api.post(`/content/${item.id}/transition`, body), { success: (r) => `Status: ${r.status}`, invalidate: inv });
  const approved = ["APPROVED", "SCHEDULED"].includes(item.status);
  return (
    <Card title="Plan & status">
      <div className="stack">
        <Field label={`Planned date (${tz})`} hint="Planning is allowed for drafts; “Scheduled” requires approval."><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <div className="row">
          <Button size="sm" onClick={() => plan.mutate()}>Add to calendar</Button>
          <Button size="sm" disabled={item.status !== "APPROVED"} onClick={() => transition.mutate({ to: "SCHEDULED", scheduledAt: new Date(when).toISOString() })}>Mark scheduled</Button>
        </div>
        {item.calendar.length > 0 && <div className="faint">On calendar: {item.calendar.map((c: any) => fmtDate(c.scheduledAt, true)).join(", ")}</div>}
        <div className="divider" />
        <Field label="Published manually? Record the live URL"><TextInput value={url} onChange={setUrl} placeholder="https://…" /></Field>
        <div className="row">
          <Button size="sm" disabled={!approved || !/^https?:\/\//.test(url)} onClick={() => transition.mutate({ to: "PUBLISHED", publishedUrl: url })}>Mark published</Button>
          {item.status === "PUBLISHED" && <Button size="sm" onClick={() => transition.mutate({ to: "ANALYZED" })}>Mark analyzed</Button>}
          {item.status !== "ARCHIVED" ? <Button size="sm" kind="danger" onClick={() => transition.mutate({ to: "ARCHIVED" })}>Archive</Button> : <Button size="sm" onClick={() => transition.mutate({ to: "DRAFT" })}>Unarchive</Button>}
        </div>
        {item.publishedUrl && <a className="small" href={item.publishedUrl} target="_blank" rel="noreferrer noopener">{item.publishedUrl}</a>}
      </div>
    </Card>
  );
}

function HandoffCard({ item }: { item: any }) {
  const [pkg, setPkg] = useState<any>(null);
  const [connector, setConnector] = useState("");
  const [privacy, setPrivacy] = useState("private");
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: () => api.get("/integrations") });
  const publishers = (integrations.data ?? []).filter((i: any) => i.capabilities.includes("publish"));
  const preview = useQuery({ queryKey: ["publish-preview", item.id, connector, privacy, item.currentVariantId], queryFn: () => api.get(`/content/${item.id}/publish-preview?connector=${connector}&privacy=${privacy}`), enabled: !!connector });
  const load = useAction(() => api.get(`/content/${item.id}/handoff`), { onSuccess: setPkg });
  const publish = useAction(() => api.post(`/content/${item.id}/publish`, { connectorId: connector, previewHash: preview.data.previewHash, confirm: true, privacy }), { success: (r) => `Publish job ${r.job.status}`, invalidate: [["content-item", item.id]] });
  return (
    <Card title="Hand-off & publishing">
      <div className="stack">
        <div className="row">
          <Button onClick={() => load.mutate()} busy={load.isPending}>Prepare hand-off package</Button>
          {pkg && <CopyButton text={pkg.markdown} label="Copy all" />}
          {pkg && <Button size="sm" onClick={() => download(`${item.title.slice(0, 40).replace(/[^\w-]+/g, "-")}.md`, pkg.markdown, "text/markdown")}>Download .md</Button>}
          {pkg && !pkg.approved && <Badge tone="warn">not approved yet</Badge>}
        </div>
        {pkg && <pre className="small list-item" style={{ maxHeight: 260, overflow: "auto" }}>{pkg.markdown}</pre>}
        <div className="divider" />
        <div className="row">
          <Field label="Direct publish via connector"><Select value={connector} onChange={setConnector} options={[{ value: "", label: "— choose —" }, ...publishers.map((p: any) => ({ value: p.id, label: `${p.name} (${p.status.replace(/_/g, " ")})` }))]} /></Field>
          <Field label="Privacy / audience"><Select value={privacy} onChange={setPrivacy} options={[{ value: "private", label: "Private" }, { value: "unlisted", label: "Unlisted" }, { value: "public", label: "Public" }]} /></Field>
        </div>
        {preview.data && (
          <div className="list-item small">
            <dl className="kv"><dt>Account</dt><dd>{preview.data.payload.account}</dd><dt>Content</dt><dd>{preview.data.payload.title}</dd><dt>When</dt><dd>{preview.data.payload.scheduledAt ? fmtDate(preview.data.payload.scheduledAt, true) : "immediately"}</dd><dt>Privacy</dt><dd>{preview.data.payload.privacy}</dd><dt>Media</dt><dd>{preview.data.payload.mediaAssetIds.length ? `${preview.data.payload.mediaAssetIds.length} linked asset(s)` : "none linked"}</dd><dt>Caption</dt><dd className="clamp2">{preview.data.payload.fields.caption || preview.data.payload.fields.body.slice(0, 200)}</dd></dl>
            {preview.data.blockers.map((b: string, i: number) => <div key={i} className="notice bad small" style={{ marginTop: 6 }}>{b}</div>)}
            <Button kind="primary" disabled={!preview.data.canPublish} onClick={() => confirm(`Publish to ${preview.data.payload.account} as ${privacy}? This is an external action.`) && publish.mutate()} busy={publish.isPending}>Confirm & publish</Button>
          </div>
        )}
        <p className="faint">Live connectors are disabled until official app approval and credentials exist — see Settings → Integrations. Use the hand-off package meanwhile.</p>
      </div>
    </Card>
  );
}
