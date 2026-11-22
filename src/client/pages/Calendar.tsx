import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useBrand } from "../context";
import { Badge, Button, Card, Field, fmtDate, Modal, PageHead, QueryView, Select, StatusBadge, Tabs, TextArea, TextInput, useAction } from "../components/ui";
import { RunTaskButton } from "../components/agent";

type View = "month" | "week" | "list";
const DAY = 86400000;
const startOfWeek = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tone = (s?: string) => (["APPROVED", "SCHEDULED", "PUBLISHED"].includes(s ?? "") ? "good" : s ? "warn" : "");

export function CalendarPage() {
  const { brandId, meta } = useBrand();
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [f, setF] = useState({ platform: "", status: "", campaign: "" });
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [open, setOpen] = useState<any>(null);
  const [addDay, setAddDay] = useState<string | null>(null);
  const range = useMemo(() => {
    if (view === "week") { const s = startOfWeek(cursor); return { from: s, to: new Date(s.getTime() + 7 * DAY) }; }
    if (view === "list") { const s = new Date(); s.setHours(0, 0, 0, 0); return { from: new Date(s.getTime() - 7 * DAY), to: new Date(s.getTime() + 90 * DAY) }; }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const s = startOfWeek(first);
    return { from: s, to: new Date(s.getTime() + 42 * DAY) };
  }, [view, cursor]);
  const qs = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString(), ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }).toString();
  const q = useQuery({ queryKey: ["calendar", brandId, qs], queryFn: () => api.get(`/brands/${brandId}/calendar?${qs}`) });
  const campaigns = useQuery({ queryKey: ["campaigns", brandId], queryFn: () => api.get(`/brands/${brandId}/campaigns`) });
  const inv = [["calendar", brandId], ["home", brandId]];
  const move = useAction(({ id, day, entry }: { id: string; day: string; entry: any }) => {
    const old = new Date(entry.scheduledAt);
    const [y, m, d] = day.split("-").map(Number);
    const next = new Date(old);
    next.setFullYear(y, m - 1, d);
    return api.post(`/calendar/${id}/move`, { scheduledAt: next.toISOString() });
  }, { success: "Rescheduled", invalidate: inv });
  const shift = (n: number) => setCursor((c) => (view === "week" ? new Date(c.getTime() + n * 7 * DAY) : new Date(c.getFullYear(), c.getMonth() + n, 1)));
  const days: Date[] = [];
  for (let t = range.from.getTime(); t < range.to.getTime(); t += DAY) days.push(new Date(t));
  const byDay = new Map<string, any[]>();
  (q.data ?? []).forEach((e: any) => { const k = ymd(new Date(e.scheduledAt)); byDay.set(k, [...(byDay.get(k) ?? []), e]); });
  const today = ymd(new Date());
  return (
    <>
      <PageHead title="Calendar & campaigns" sub={<>Planned dates for drafts and approved content. Suggested slots use your own analytics when you have enough history; otherwise they're labelled hypotheses. Times shown in your browser's time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</>} actions={<>
        <a className="btn" href={`/api/brands/${brandId}/calendar.csv`}>Export CSV</a><a className="btn" href={`/api/brands/${brandId}/calendar.ics`}>Export ICS</a></>} />
      <div className="grid g3">
        <Card className="span2">
          <div className="row between" style={{ marginBottom: 10 }}>
            <div className="row">
              {view !== "list" && <><Button size="sm" onClick={() => shift(-1)} aria-label="Previous">←</Button><Button size="sm" onClick={() => setCursor(new Date())}>Today</Button><Button size="sm" onClick={() => shift(1)} aria-label="Next">→</Button></>}
              <b>{view === "month" ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" }) : view === "week" ? `Week of ${fmtDate(range.from.toISOString())}` : "Next 90 days"}</b>
            </div>
            <div className="row">
              <Select value={f.platform} onChange={(v) => setF({ ...f, platform: v })} options={[{ value: "", label: "All platforms" }, ...(meta?.platforms ?? []).map((p: any) => ({ value: p.id, label: p.label }))]} style={{ width: "auto" }} />
              <Select value={f.status} onChange={(v) => setF({ ...f, status: v })} options={[{ value: "", label: "All statuses" }, ...["DRAFT", "QA", "REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED"].map((s) => ({ value: s, label: s }))]} style={{ width: "auto" }} />
              <Select value={f.campaign} onChange={(v) => setF({ ...f, campaign: v })} options={[{ value: "", label: "All campaigns" }, ...(campaigns.data ?? []).map((c: any) => ({ value: c.id, label: c.name }))]} style={{ width: "auto" }} />
            </div>
          </div>
          <Tabs<View> tabs={[{ id: "month", label: "Month" }, { id: "week", label: "Week" }, { id: "list", label: "List" }]} value={view} onChange={setView} />
          <QueryView q={q}>
            {(list: any[]) => view === "list" ? (
              list.length ? <div className="table-wrap"><table><thead><tr><th>When</th><th>Platform</th><th>Title</th><th>Status</th><th>Basis</th></tr></thead><tbody>
                {list.map((e) => <tr key={e.id} className="clickable" onClick={() => setOpen(e)}><td className="nowrap">{fmtDate(e.scheduledAt, true)}</td><td>{e.platform}</td><td>{e.title}{e.preview?.hook && <div className="faint clamp2">{e.preview.hook}</div>}</td><td>{e.contentStatus ? <StatusBadge status={e.contentStatus} /> : <Badge>planned</Badge>}</td><td><Badge tone={e.suggestionBasis === "hypothesis" ? "warn" : e.suggestionBasis === "own_history" ? "good" : "neutral"}>{e.suggestionBasis.replace("_", " ")}</Badge></td></tr>)}
              </tbody></table></div> : <p className="muted">Nothing planned in the next 90 days.</p>
            ) : (
              <div className="cal" role="grid">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="cal-h">{d}</div>)}
                {days.map((d) => {
                  const k = ymd(d);
                  return (
                    <div key={k} className={`cal-d ${view === "month" && d.getMonth() !== cursor.getMonth() ? "other" : ""} ${k === today ? "today" : ""} ${dropDay === k ? "drop" : ""}`} style={view === "week" ? { minHeight: 260 } : undefined}
                      onDragOver={(ev) => { ev.preventDefault(); setDropDay(k); }} onDragLeave={() => setDropDay(null)}
                      onDrop={(ev) => { ev.preventDefault(); setDropDay(null); const id = ev.dataTransfer.getData("text/plain"); const entry = list.find((x) => x.id === id); if (entry && ymd(new Date(entry.scheduledAt)) !== k) move.mutate({ id, day: k, entry }); }}
                      onDoubleClick={() => setAddDay(k)}>
                      <span className="cal-num">{d.getDate()}</span>
                      {(byDay.get(k) ?? []).map((e) => (
                        <div key={e.id} className={`cal-e ${tone(e.contentStatus)}`} draggable onDragStart={(ev) => ev.dataTransfer.setData("text/plain", e.id)} onClick={() => setOpen(e)} title={`${e.title} — ${e.contentStatus ?? "planned"} (drag to reschedule)`} role="button" tabIndex={0} onKeyDown={(ev) => ev.key === "Enter" && setOpen(e)}>
                          {new Date(e.scheduledAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} {e.platform && `${e.platform} · `}{e.title}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </QueryView>
          <p className="faint" style={{ marginTop: 8 }}>Drag an entry to another day to reschedule (time is kept). Double-click a day to add an entry. Green = approved/scheduled; amber = not yet approved.</p>
        </Card>
        <div className="stack">
          <Card title="Plan with the agent">
            <p className="small muted" style={{ marginBottom: 8 }}>Proposes slots for unplanned drafts based on your strategy cadence and own history. Nothing is written until you approve.</p>
            <RunTaskButton task="plan_calendar" input={{ weeks: 2 }} label="Propose a 2-week schedule" invalidate={inv} />
          </Card>
          <CampaignsCard q={campaigns} />
        </div>
      </div>
      {open && <EntryModal e={open} onClose={() => setOpen(null)} />}
      {addDay && <AddEntry day={addDay} onClose={() => setAddDay(null)} />}
    </>
  );
}

function EntryModal({ e, onClose }: { e: any; onClose: () => void }) {
  const { brandId } = useBrand();
  const [notes, setNotes] = useState(e.notes ?? "");
  const [when, setWhen] = useState(() => { const d = new Date(e.scheduledAt); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
  const inv = [["calendar", brandId], ["home", brandId]];
  const save = useAction(async () => { await api.patch(`/calendar/${e.id}`, { notes }); return api.post(`/calendar/${e.id}/move`, { scheduledAt: new Date(when).toISOString() }); }, { success: "Saved", invalidate: inv, onSuccess: onClose });
  const del = useAction(() => api.del(`/calendar/${e.id}`), { success: "Removed from calendar", invalidate: inv, onSuccess: onClose });
  return (
    <Modal title={e.title} onClose={onClose} footer={<><Button kind="danger" onClick={() => del.mutate()}>Remove</Button><Button kind="primary" onClick={() => save.mutate()} busy={save.isPending}>Save</Button></>}>
      <div className="row">{e.contentStatus ? <StatusBadge status={e.contentStatus} /> : <Badge>planned only</Badge>}<Badge>{e.platform}</Badge><Badge tone={e.suggestionBasis === "hypothesis" ? "warn" : "neutral"}>basis: {e.suggestionBasis.replace("_", " ")}</Badge><span className="faint">{e.timezone}</span></div>
      {e.preview && <div className="list-item small">{e.preview.title && <b>{e.preview.title}</b>}<p>{e.preview.hook}</p><p className="faint">{e.preview.caption}</p></div>}
      {e.contentItemId && <Link to={`/studio/${e.contentItemId}`}>Open in Creation & Review →</Link>}
      <Field label="When"><input type="datetime-local" value={when} onChange={(ev) => setWhen(ev.target.value)} /></Field>
      <Field label="Notes"><TextArea value={notes} onChange={setNotes} /></Field>
    </Modal>
  );
}

function AddEntry({ day, onClose }: { day: string; onClose: () => void }) {
  const { brandId } = useBrand();
  const content = useQuery({ queryKey: ["content", brandId, ""], queryFn: () => api.get(`/brands/${brandId}/content`) });
  const [d, setD] = useState({ contentItemId: "", title: "", time: "10:00" });
  const add = useAction(() => api.post(`/brands/${brandId}/calendar`, { contentItemId: d.contentItemId || null, title: d.title || undefined, scheduledAt: new Date(`${day}T${d.time}`).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }), { success: "Planned", invalidate: [["calendar", brandId]], onSuccess: onClose });
  return (
    <Modal title={`Plan for ${fmtDate(day)}`} onClose={onClose} footer={<Button kind="primary" disabled={!d.contentItemId && !d.title} onClick={() => add.mutate()}>Add</Button>}>
      <Field label="Content item"><Select value={d.contentItemId} onChange={(v) => setD({ ...d, contentItemId: v })} options={[{ value: "", label: "— none (placeholder) —" }, ...(content.data ?? []).map((c: any) => ({ value: c.id, label: `${c.title.slice(0, 60)} (${c.platform}, ${c.status})` }))]} /></Field>
      {!d.contentItemId && <Field label="Placeholder title"><TextInput value={d.title} onChange={(v) => setD({ ...d, title: v })} /></Field>}
      <Field label="Time"><input type="time" value={d.time} onChange={(e) => setD({ ...d, time: e.target.value })} /></Field>
    </Modal>
  );
}

function CampaignsCard({ q }: { q: any }) {
  const { brandId } = useBrand();
  const [c, setC] = useState<any>(null);
  const save = useAction(() => (c.id ? api.put(`/brands/${brandId}/campaigns/${c.id}`, c) : api.post(`/brands/${brandId}/campaigns`, c)), { success: "Campaign saved", invalidate: [["campaigns", brandId]], onSuccess: () => setC(null) });
  return (
    <Card title="Campaigns" actions={<Button size="sm" onClick={() => setC({ name: "", goal: "", kpi: "", startDate: "", endDate: "", status: "planned", notes: "" })}>+ New</Button>}>
      <QueryView q={q} empty={(d: any[]) => !d.length && <p className="muted">Group content around a goal and window.</p>}>
        {(list: any[]) => list.map((x) => (
          <button key={x.id} className="list-item" style={{ width: "100%", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }} onClick={() => setC(x)}>
            <div className="row between"><b className="small">{x.name}</b><StatusBadge status={x.status === "active" ? "running" : x.status === "complete" ? "succeeded" : "draft"} /></div>
            <div className="faint">{x.startDate || "?"} → {x.endDate || "?"} · {x.contentCount} item(s) · KPI: {x.kpi || "—"}</div>
          </button>
        ))}
      </QueryView>
      {c && (
        <Modal title={c.id ? "Edit campaign" : "New campaign"} onClose={() => setC(null)} footer={<Button kind="primary" disabled={!c.name} onClick={() => save.mutate()}>Save</Button>}>
          <Field label="Name"><TextInput value={c.name} onChange={(v) => setC({ ...c, name: v })} /></Field>
          <Field label="Goal"><TextArea value={c.goal} onChange={(v) => setC({ ...c, goal: v })} rows={2} /></Field>
          <div className="grid g3">
            <Field label="KPI"><TextInput value={c.kpi} onChange={(v) => setC({ ...c, kpi: v })} /></Field>
            <Field label="Start"><input type="date" value={c.startDate} onChange={(e) => setC({ ...c, startDate: e.target.value })} /></Field>
            <Field label="End"><input type="date" value={c.endDate} onChange={(e) => setC({ ...c, endDate: e.target.value })} /></Field>
          </div>
          <Field label="Status"><Select value={c.status} onChange={(v) => setC({ ...c, status: v })} options={["planned", "active", "complete", "cancelled"].map((x) => ({ value: x, label: x }))} /></Field>
          <Field label="Notes"><TextArea value={c.notes} onChange={(v) => setC({ ...c, notes: v })} rows={2} /></Field>
        </Modal>
      )}
    </Card>
  );
}
