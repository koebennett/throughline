import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, PageHead, useAction } from "../components/ui";
import { EMPTY_PROFILE, ProfileForm, SECTIONS } from "../components/ProfileForm";
import { BrandContext } from "../context";

export function OnboardingPage({ onCreated, firstRun }: { onCreated: (id: string) => void; firstRun?: boolean }) {
  const [p, setP] = useState(EMPTY_PROFILE);
  const [step, setStep] = useState(0);
  const nav = useNavigate();
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api.get("/meta") }).data;
  const create = useAction(() => api.post("/brands", p), { success: "Brand created", invalidate: [["brands"]], onSuccess: (b) => (onCreated(b.id), nav("/")) });
  const demo = useAction(() => api.post("/demo/seed"), {
    success: "Demo workspace loaded (fictional data)",
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["brands"] });
      onCreated(r.brandId);
      nav("/");
    },
  });
  const sections = SECTIONS.slice(0, 5);
  const last = step === sections.length - 1;
  return (
    <BrandContext.Provider value={{ brandId: "", brand: null, meta, setBrandId: () => {} }}>
      <div className="content" style={{ maxWidth: 980, margin: "0 auto" }}>
        <PageHead
          title={firstRun ? "Welcome to Throughline" : "New brand"}
          sub="An evidence-led content strategist. Tell it who you serve and what you can sustain; it turns research into a strategy, briefs and platform-native drafts — and learns from your results. Nothing is published without your approval."
          actions={firstRun && <Button onClick={() => demo.mutate()} busy={demo.isPending}>Explore with demo data</Button>}
        />
        <div className="tabs">
          {sections.map((s, i) => (
            <button key={s.id} className={i === step ? "active" : ""} onClick={() => setStep(i)}>{i + 1}. {s.label}</button>
          ))}
        </div>
        <Card>
          <ProfileForm value={p} onChange={setP} section={sections[step].id} />
          <div className="divider" />
          <div className="row between">
            <span className="faint">Only the name is required. Everything else can be added later in Brand Brain — but recommendations get more specific with each field.</span>
            <div className="row">
              {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
              {!last && <Button onClick={() => setStep(step + 1)}>Next</Button>}
              <Button kind="primary" disabled={!p.name.trim()} busy={create.isPending} onClick={() => create.mutate()}>{last ? "Create brand" : "Create now"}</Button>
            </div>
          </div>
        </Card>
      </div>
    </BrandContext.Provider>
  );
}
