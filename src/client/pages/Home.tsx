import { Fragment } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useBrand } from "../context";
import { Badge, Card, ConfidenceBadge, Empty, fmtDate, PageHead, QueryView, StatusBadge } from "../components/ui";

export function HomePage() {
  const { brandId } = useBrand();
  const q = useQuery({ queryKey: ["home", brandId], queryFn: () => api.get(`/brands/${brandId}/home`) });
  return (
    <QueryView q={q}>
      {(d) => (
        <>
          <PageHead
            title={d.brand.name}
            sub={d.brand.objective ? <>Goal: {d.brand.objective}</> : <>No objective set — <Link to="/brand">add one</Link> so recommendations can be measured.</>}
          />
          {d.brand.isDemo && <div className="notice warn" style={{ marginBottom: 14 }}>You are viewing the DEMO workspace. Every source, metric and draft here is fictional sample data created to show how the product works.</div>}
          {!d.model.live && <div className="notice info" style={{ marginBottom: 14 }}>No AI model connected. Outputs are <b>offline scaffolds</b> built from your own data, with <code>[insert: …]</code> markers QA won't let you ship. <Link to="/settings">Connect Claude</Link> for researched, synthesised work.</div>}
          <div className="grid g3">
            <Card title="Next best actions" className="span2">
              {d.nextActions.length ? (
                <div className="stack">
                  {d.nextActions.map((a: any, i: number) => (
                    <div key={i} className="list-item row between" style={{ marginTop: 0 }}>
                      <div className="stack tight" style={{ flex: 1, minWidth: 220 }}>
                        <b>{i === 0 && <Badge tone="accent">Do first</Badge>} {a.title}</b>
                        <span className="muted small">{a.reason}</span>
                      </div>
                      <Link className="btn sm" to={a.action.to}>{a.action.label}</Link>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title="Nothing urgent">Your pipeline is in good shape. Keep the cadence and import results weekly.</Empty>
              )}
            </Card>
            <Card title="Pipeline">
              <dl className="kv">
                <dt>Evidence</dt><dd>{d.counts.evidence} <span className="faint">({d.counts.sourcedEvidence} sourced)</span></dd>
                <dt>Open ideas</dt><dd>{d.counts.ideas}</dd>
                <dt>Briefs w/o drafts</dt><dd>{d.counts.briefsWithoutContent}</dd>
                {Object.entries(d.counts.content).map(([k, v]) => (<Fragment key={k}><dt><StatusBadge status={k} /></dt><dd>{v as number}</dd></Fragment>))}
                <dt>Learnings to review</dt><dd>{d.counts.proposedMemory}</dd>
              </dl>
              <p className="faint" style={{ marginTop: 10 }}>{d.sources.counts}</p>
            </Card>
          </div>
          <div className="grid g3" style={{ marginTop: 14 }}>
            <Card title="Review queue" actions={<Link to="/studio" className="small">All content</Link>}>
              {d.reviewQueue.length ? d.reviewQueue.map((c: any) => (
                <Link key={c.id} to={`/studio/${c.id}`} className="list-item row between" style={{ display: "flex", color: "inherit" }}>
                  <span className="clamp2" style={{ flex: 1 }}>{c.title}</span><span className="row"><Badge>{c.platform}</Badge><StatusBadge status={c.status} /></span>
                </Link>
              )) : <p className="muted">No drafts waiting.</p>}
            </Card>
            <Card title="Next 14 days" actions={<Link to="/calendar" className="small">Calendar</Link>}>
              {d.upcoming.length ? d.upcoming.map((e: any) => (
                <div key={e.id} className="list-item">
                  <div className="row between"><b className="small">{fmtDate(e.scheduled_at, true)}</b>{e.content_status && <StatusBadge status={e.content_status} />}</div>
                  <div className="small clamp2">{e.platform && <Badge>{e.platform}</Badge>} {e.title}</div>
                </div>
              )) : <p className="muted">Nothing planned. Plan from the calendar or ask the agent to propose a schedule.</p>}
            </Card>
            <Card title="Strategy">
              {d.strategy ? (
                <div className="stack">
                  <div className="row"><Badge tone="good">v{d.strategy.version} active</Badge><span className="faint">approved {fmtDate(d.strategy.approvedAt)}</span></div>
                  <p className="small clamp2" style={{ WebkitLineClamp: 6 }}>{d.strategy.summary}</p>
                  <Link to="/strategy" className="small">Open Strategy Studio</Link>
                </div>
              ) : <p className="muted">No approved strategy yet. <Link to="/strategy">Build one</Link>.</p>}
            </Card>
          </div>
          <div className="grid g2" style={{ marginTop: 14 }}>
            <Card title="What the data says" actions={<Link to="/analytics" className="small">Analytics Lab</Link>}>
              {d.insights.length ? d.insights.map((i: any, k: number) => (
                <div key={k} className="list-item">
                  <div className="row"><Badge tone={i.kind === "observation" ? "info" : "muted"}>{i.kind}</Badge><ConfidenceBadge c={i.confidence} /><span className="faint">{i.platform} · n={i.n} · {fmtDate(i.window.start)} → {fmtDate(i.window.end)}</span></div>
                  <p className="small" style={{ marginTop: 4 }}>{i.text}</p>
                </div>
              )) : <p className="muted">{d.sources.insights} Import a CSV to start the learning loop.</p>}
            </Card>
            <Card title="Recent agent runs" actions={<Link to="/agent" className="small">All runs</Link>}>
              {d.recentRuns.length ? (
                <table className="small"><tbody>
                  {d.recentRuns.map((r: any) => (
                    <tr key={r.id}><td><Link to={`/agent?run=${r.id}`}>{r.task.replace(/_/g, " ")}</Link></td><td><StatusBadge status={r.status} /></td><td className="faint">{fmtDate(r.created_at, true)}</td></tr>
                  ))}
                </tbody></table>
              ) : <p className="muted">No runs yet.</p>}
            </Card>
          </div>
        </>
      )}
    </QueryView>
  );
}
