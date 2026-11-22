import { Button, Field, ListInput, Select, TextArea, TextInput } from "./ui";
import { useBrand } from "../context";

export type Profile = any;
export const EMPTY_PROFILE: Profile = {
  name: "", description: "", website: "", niche: "", offer: "", monetization: "", objective: "", geography: "", languages: [],
  audiences: [], platforms: [], capacity: { team: "", equipment: "", budget: "", constraints: "" },
  voice: { traits: [], tone: "", vocabulary: [], phrasesToUse: [], phrasesToAvoid: [], readingLevel: "standard" },
  positioning: "", pointOfView: "", proof: [], differentiators: [], ctas: [], compliance: { bannedClaims: [], requiredDisclosures: [], notes: "" },
  competitors: [], likes: [], dislikes: [], topicsOfExpertise: [], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
};

type Section = "basics" | "audience" | "platforms" | "voice" | "positioning" | "competitors";
export const SECTIONS: { id: Section; label: string }[] = [
  { id: "basics", label: "Basics & goal" },
  { id: "audience", label: "Audience" },
  { id: "platforms", label: "Platforms & capacity" },
  { id: "voice", label: "Voice & boundaries" },
  { id: "positioning", label: "Positioning & proof" },
  { id: "competitors", label: "Competitors & taste" },
];

export function ProfileForm({ value: p, onChange, section }: { value: Profile; onChange: (p: Profile) => void; section: Section }) {
  const { meta } = useBrand();
  const set = (k: string, v: unknown) => onChange({ ...p, [k]: v });
  const setIn = (k: string, sub: string, v: unknown) => onChange({ ...p, [k]: { ...p[k], [sub]: v } });
  const platforms: { id: string; label: string }[] = meta?.platforms ?? [];
  if (section === "basics")
    return (
      <div className="grid g2">
        <Field label="Brand / creator name *"><TextInput value={p.name} onChange={(v) => set("name", v)} required /></Field>
        <Field label="Website"><TextInput value={p.website} onChange={(v) => set("website", v)} placeholder="https://" /></Field>
        <Field label="Niche" hint="Be specific: who + what, e.g. “budget weeknight cooking for busy parents”"><TextInput value={p.niche} onChange={(v) => set("niche", v)} /></Field>
        <Field label="Main objective" hint="What should content achieve in the next 90 days?"><TextInput value={p.objective} onChange={(v) => set("objective", v)} /></Field>
        <div className="span2"><Field label="Description"><TextArea value={p.description} onChange={(v) => set("description", v)} /></Field></div>
        <Field label="Offer / product"><TextArea value={p.offer} onChange={(v) => set("offer", v)} rows={2} /></Field>
        <Field label="Monetization model"><TextArea value={p.monetization} onChange={(v) => set("monetization", v)} rows={2} /></Field>
        <Field label="Topics of expertise" hint="One per line — these seed pillars"><ListInput value={p.topicsOfExpertise} onChange={(v) => set("topicsOfExpertise", v)} /></Field>
        <div className="stack">
          <Field label="Geography"><TextInput value={p.geography} onChange={(v) => set("geography", v)} /></Field>
          <Field label="Languages"><ListInput value={p.languages} onChange={(v) => set("languages", v)} rows={1} /></Field>
          <Field label="Time zone"><TextInput value={p.timezone} onChange={(v) => set("timezone", v)} /></Field>
        </div>
      </div>
    );
  if (section === "audience")
    return (
      <div className="stack">
        {p.audiences.map((a: any, i: number) => {
          const upd = (k: string, v: unknown) => set("audiences", p.audiences.map((x: any, j: number) => (j === i ? { ...x, [k]: v } : x)));
          return (
            <div key={i} className="list-item">
              <div className="row between" style={{ marginBottom: 8 }}>
                <b>Segment {i + 1}</b>
                <Button size="sm" kind="danger" onClick={() => set("audiences", p.audiences.filter((_: any, j: number) => j !== i))}>Remove</Button>
              </div>
              <div className="grid g2">
                <Field label="Name"><TextInput value={a.name} onChange={(v) => upd("name", v)} /></Field>
                <Field label="Knowledge level"><Select value={a.knowledgeLevel ?? "mixed"} onChange={(v) => upd("knowledgeLevel", v)} options={["beginner", "intermediate", "advanced", "mixed"].map((x) => ({ value: x, label: x }))} /></Field>
                <div className="span2"><Field label="Description"><TextInput value={a.description} onChange={(v) => upd("description", v)} /></Field></div>
                <Field label="Problems (their words)"><ListInput value={a.problems} onChange={(v) => upd("problems", v)} /></Field>
                <Field label="Desires"><ListInput value={a.desires} onChange={(v) => upd("desires", v)} /></Field>
                <Field label="Objections"><ListInput value={a.objections} onChange={(v) => upd("objections", v)} /></Field>
                <Field label="Language / phrases they use"><ListInput value={a.language} onChange={(v) => upd("language", v)} /></Field>
                <Field label="Needs"><ListInput value={a.needs} onChange={(v) => upd("needs", v)} /></Field>
                <Field label="Desired transformation"><TextArea value={a.transformation} onChange={(v) => upd("transformation", v)} rows={2} /></Field>
              </div>
            </div>
          );
        })}
        <div><Button onClick={() => set("audiences", [...p.audiences, { name: "", description: "", knowledgeLevel: "mixed", needs: [], problems: [], desires: [], objections: [], language: [], transformation: "" }])}>+ Add audience segment</Button></div>
      </div>
    );
  if (section === "platforms")
    return (
      <div className="stack">
        <div className="chips">
          {platforms.map((pl) => {
            const on = p.platforms.some((x: any) => x.platform === pl.id);
            return (
              <label key={pl.id} className="check list-item" style={{ margin: 0 }}>
                <input type="checkbox" checked={on} onChange={() => set("platforms", on ? p.platforms.filter((x: any) => x.platform !== pl.id) : [...p.platforms, { platform: pl.id, handle: "", url: "", role: "", active: true }])} />
                {pl.label}
              </label>
            );
          })}
        </div>
        {p.platforms.map((x: any, i: number) => {
          const upd = (k: string, v: unknown) => set("platforms", p.platforms.map((y: any, j: number) => (j === i ? { ...y, [k]: v } : y)));
          return (
            <div key={x.platform} className="grid g3 list-item">
              <Field label={`${platforms.find((pl) => pl.id === x.platform)?.label ?? x.platform} handle`}><TextInput value={x.handle} onChange={(v) => upd("handle", v)} /></Field>
              <Field label="Account URL"><TextInput value={x.url} onChange={(v) => upd("url", v)} /></Field>
              <Field label="Role — why this channel exists"><TextInput value={x.role} onChange={(v) => upd("role", v)} /></Field>
            </div>
          );
        })}
        <div className="grid g3">
          <Field label="Hours per week for content"><input type="number" min={0} max={168} value={p.capacity.hoursPerWeek ?? ""} onChange={(e) => setIn("capacity", "hoursPerWeek", e.target.value === "" ? undefined : Number(e.target.value))} /></Field>
          <Field label="Pieces per week you can sustain"><input type="number" min={0} max={100} value={p.capacity.postsPerWeekTarget ?? ""} onChange={(e) => setIn("capacity", "postsPerWeekTarget", e.target.value === "" ? undefined : Number(e.target.value))} /></Field>
          <Field label="Budget"><TextInput value={p.capacity.budget} onChange={(v) => setIn("capacity", "budget", v)} /></Field>
          <Field label="Team"><TextInput value={p.capacity.team} onChange={(v) => setIn("capacity", "team", v)} /></Field>
          <Field label="Equipment"><TextInput value={p.capacity.equipment} onChange={(v) => setIn("capacity", "equipment", v)} /></Field>
          <Field label="Constraints"><TextInput value={p.capacity.constraints} onChange={(v) => setIn("capacity", "constraints", v)} /></Field>
        </div>
      </div>
    );
  if (section === "voice")
    return (
      <div className="grid g2">
        <Field label="Voice traits"><ListInput value={p.voice.traits} onChange={(v) => setIn("voice", "traits", v)} /></Field>
        <Field label="Tone"><TextArea value={p.voice.tone} onChange={(v) => setIn("voice", "tone", v)} rows={2} /></Field>
        <Field label="Vocabulary to use"><ListInput value={p.voice.vocabulary} onChange={(v) => setIn("voice", "vocabulary", v)} /></Field>
        <Field label="Signature phrases"><ListInput value={p.voice.phrasesToUse} onChange={(v) => setIn("voice", "phrasesToUse", v)} /></Field>
        <Field label="Phrases to avoid" hint="QA warns when these appear"><ListInput value={p.voice.phrasesToAvoid} onChange={(v) => setIn("voice", "phrasesToAvoid", v)} /></Field>
        <Field label="Reading level"><Select value={p.voice.readingLevel} onChange={(v) => setIn("voice", "readingLevel", v)} options={[{ value: "simple", label: "Simple" }, { value: "standard", label: "Standard" }, { value: "expert", label: "Expert" }]} /></Field>
        <Field label="Banned claims" hint="Hard blockers in QA (e.g. regulated or medical claims)"><ListInput value={p.compliance.bannedClaims} onChange={(v) => setIn("compliance", "bannedClaims", v)} /></Field>
        <Field label="Required disclosures"><ListInput value={p.compliance.requiredDisclosures} onChange={(v) => setIn("compliance", "requiredDisclosures", v)} /></Field>
        <div className="span2"><Field label="Compliance notes"><TextArea value={p.compliance.notes} onChange={(v) => setIn("compliance", "notes", v)} rows={2} /></Field></div>
      </div>
    );
  if (section === "positioning")
    return (
      <div className="grid g2">
        <Field label="Positioning"><TextArea value={p.positioning} onChange={(v) => set("positioning", v)} /></Field>
        <Field label="Point of view"><TextArea value={p.pointOfView} onChange={(v) => set("pointOfView", v)} /></Field>
        <Field label="Differentiators"><ListInput value={p.differentiators} onChange={(v) => set("differentiators", v)} /></Field>
        <Field label="Proof you can truthfully cite" hint="Credentials, results, case studies — used as user-supplied facts"><ListInput value={p.proof} onChange={(v) => set("proof", v)} /></Field>
        <Field label="Preferred CTAs"><ListInput value={p.ctas} onChange={(v) => set("ctas", v)} /></Field>
      </div>
    );
  return (
    <div className="stack">
      {p.competitors.map((c: any, i: number) => {
        const upd = (k: string, v: unknown) => set("competitors", p.competitors.map((x: any, j: number) => (j === i ? { ...x, [k]: v } : x)));
        return (
          <div key={i} className="grid g4 list-item">
            <Field label="Name"><TextInput value={c.name} onChange={(v) => upd("name", v)} /></Field>
            <Field label="URL"><TextInput value={c.url} onChange={(v) => upd("url", v)} /></Field>
            <Field label="Type"><Select value={c.kind ?? "competitor"} onChange={(v) => upd("kind", v)} options={[{ value: "competitor", label: "Competitor" }, { value: "reference", label: "Reference" }, { value: "aspirational", label: "Aspirational" }]} /></Field>
            <Field label="Notes (public patterns only)"><div className="row" style={{ flexWrap: "nowrap" }}><TextInput value={c.notes} onChange={(v) => upd("notes", v)} /><Button size="sm" kind="danger" onClick={() => set("competitors", p.competitors.filter((_: any, j: number) => j !== i))}>✕</Button></div></Field>
          </div>
        );
      })}
      <div><Button onClick={() => set("competitors", [...p.competitors, { name: "", url: "", notes: "", kind: "competitor" }])}>+ Add competitor / reference</Button></div>
      <div className="grid g2">
        <Field label="Content you like"><ListInput value={p.likes} onChange={(v) => set("likes", v)} /></Field>
        <Field label="Content you dislike"><ListInput value={p.dislikes} onChange={(v) => set("dislikes", v)} /></Field>
      </div>
    </div>
  );
}
