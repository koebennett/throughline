import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, safeStorage } from "./api";
import { BrandContext } from "./context";
import { Badge, ErrorBox, Loading, ToastProvider } from "./components/ui";
import { HomePage } from "./pages/Home";
import { OnboardingPage } from "./pages/Onboarding";
import { BrandPage } from "./pages/Brand";
import { ResearchPage } from "./pages/Research";
import { StrategyPage } from "./pages/Strategy";
import { IdeasPage } from "./pages/Ideas";
import { BriefsPage } from "./pages/Briefs";
import { StudioList, StudioItem } from "./pages/Studio";
import { RepurposePage } from "./pages/Repurpose";
import { CalendarPage } from "./pages/Calendar";
import { AnalyticsPage } from "./pages/Analytics";
import { AgentPage } from "./pages/Agent";
import { SettingsPage } from "./pages/Settings";

const I = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const NAV: { group: string; items: { to: string; label: string; icon: ReactNode }[] }[] = [
  { group: "", items: [{ to: "/", label: "Command Center", icon: I("M3 12l9-8 9 8M5 10v10h14V10") }] },
  {
    group: "Think",
    items: [
      { to: "/brand", label: "Brand Brain", icon: I("M12 3a6 6 0 0 0-6 6c0 4 3 5 3 9h6c0-4 3-5 3-9a6 6 0 0 0-6-6zM9 21h6") },
      { to: "/research", label: "Research Desk", icon: I("M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3") },
      { to: "/strategy", label: "Strategy Studio", icon: I("M4 20V10M10 20V4M16 20v-7M22 20H2") },
      { to: "/ideas", label: "Idea Lab", icon: I("M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z") },
    ],
  },
  {
    group: "Make",
    items: [
      { to: "/briefs", label: "Briefs", icon: I("M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5") },
      { to: "/studio", label: "Creation & Review", icon: I("M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z") },
      { to: "/repurpose", label: "Repurposing", icon: I("M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3") },
    ],
  },
  {
    group: "Ship & learn",
    items: [
      { to: "/calendar", label: "Calendar", icon: I("M3 5h18v16H3zM16 3v4M8 3v4M3 10h18") },
      { to: "/analytics", label: "Analytics Lab", icon: I("M3 3v18h18M7 15l4-4 3 3 5-6") },
      { to: "/agent", label: "Agent & Runs", icon: I("M12 8V4H8M4 8h16v12H4zM9 14h.01M15 14h.01") },
      { to: "/settings", label: "Settings", icon: I("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z") },
    ],
  },
];

export function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  );
}

function Root() {
  const brands = useQuery({ queryKey: ["brands"], queryFn: () => api.get<any[]>("/brands") });
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api.get("/meta"), refetchInterval: 30_000 });
  const [brandId, setBrandIdState] = useState<string | null>(() => safeStorage("throughline.brand"));
  const setBrandId = (id: string | null) => {
    setBrandIdState(id);
    safeStorage("throughline.brand", id);
  };
  const list = brands.data ?? [];
  const activeId = list.find((b) => b.id === brandId)?.id ?? list[0]?.id ?? null;
  const brand = useQuery({ queryKey: ["brand", activeId], queryFn: () => api.get(`/brands/${activeId}`), enabled: !!activeId });

  if (brands.isPending || meta.isPending) return <Loading label="Starting Throughline…" />;
  if (brands.isError) return <div className="content"><ErrorBox error={brands.error} retry={() => brands.refetch()} /></div>;
  if (!activeId) return <OnboardingPage onCreated={(id) => setBrandId(id)} firstRun />;
  return (
    <BrandContext.Provider value={{ brandId: activeId, brand: brand.data, meta: meta.data, setBrandId }}>
      <Layout brands={list} activeId={activeId} onSwitch={setBrandId}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/onboarding" element={<OnboardingPage onCreated={(id) => setBrandId(id)} />} />
          <Route path="/brand" element={<BrandPage />} />
          <Route path="/research" element={<ResearchPage />} />
          <Route path="/strategy" element={<StrategyPage />} />
          <Route path="/ideas" element={<IdeasPage />} />
          <Route path="/briefs" element={<BriefsPage />} />
          <Route path="/briefs/:id" element={<BriefsPage />} />
          <Route path="/studio" element={<StudioList />} />
          <Route path="/studio/:id" element={<StudioItem />} />
          <Route path="/repurpose" element={<RepurposePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/agent" element={<AgentPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<div className="content"><h1>Page not found</h1></div>} />
        </Routes>
      </Layout>
    </BrandContext.Provider>
  );
}

function Layout({ brands, activeId, onSwitch, children }: { brands: any[]; activeId: string; onSwitch: (id: string) => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [loc.pathname]);
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api.get("/meta") }).data;
  const active = brands.find((b) => b.id === activeId);
  return (
    <div className="shell">
      <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Main navigation">
        <div className="logo">
          <span className="logo-mark">{I("M3 16c4-9 6-9 9 0s5 9 9 0")}</span> Throughline
        </div>
        <nav className="nav">
          {NAV.map((g) => (
            <div key={g.group}>
              {g.group && <div className="nav-group">{g.group}</div>}
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === "/"}>
                  {i.icon}
                  {i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div style={{ marginTop: "auto", padding: "12px 8px 0" }} className="faint">
          Local-first · data stays on this machine unless you connect a provider.
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Toggle navigation">☰</button>
          <select aria-label="Brand" value={activeId} onChange={(e) => (e.target.value === "__new" ? navigate("/onboarding") : (onSwitch(e.target.value), navigate("/")))} style={{ width: "auto", maxWidth: 280 }}>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value="__new">+ New brand…</option>
          </select>
          {active?.isDemo && <Badge tone="warn" title="Fictional sample data — not live">DEMO DATA</Badge>}
          <span style={{ flex: 1 }} />
          {meta && (
            <NavLink to="/settings" title={meta.model.label}>
              <Badge tone={meta.model.live ? "good" : "warn"}>{meta.model.live ? `Claude · ${meta.model.models.strong}` : "Offline scaffold — no AI connected"}</Badge>
            </NavLink>
          )}
          {meta && <Badge tone={meta.settings.publishingEnabled ? "bad" : "muted"} title="Publishing kill switch">{meta.settings.publishingEnabled ? "Publishing ON" : "Publishing OFF"}</Badge>}
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
