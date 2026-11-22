import { afterEach, describe, expect, it } from "vitest";
import { makeApp, PROFILE } from "../helpers/setup.js";
import { registerConnector, unregisterConnector } from "../../src/server/connectors/registry.js";
import type { PlatformConnector, PublishOutcome } from "../../src/server/connectors/types.js";
import { updateSettings } from "../../src/server/services/settings.js";

function mockConnector(outcomes: PublishOutcome[], statusResult: any = { kind: "not_found" }) {
  const calls: string[] = [];
  const c: PlatformConnector = {
    descriptor: { id: "linkedin", name: "Mock LinkedIn (test)", kind: "platform", platforms: ["linkedin"], capabilities: ["publish"], scopes: [], permissionExplanation: "", setupSteps: [], docsUrls: [], verifiedOn: "test" },
    status: () => ({ status: "connected", detail: "test", account: "@test" }),
    publish: async (_ctx, _p, key) => (calls.push(key), outcomes.shift() ?? { kind: "failed", error: "none", retryable: false }),
    checkStatus: async () => statusResult,
  };
  registerConnector(c);
  return calls;
}

async function approvedItem() {
  const t = makeApp();
  const b = (await t.call("POST", "/api/brands", PROFILE)).body.id;
  const item = await t.call("POST", `/api/brands/${b}/content`, { title: "Post", platform: "linkedin", format: "text_post", fields: { hooks: ["Irregular income breaks budgets."], body: "Irregular income breaks budgets.\nUse a buffer account and pay yourself a fixed monthly salary from it.\n1. One account\n2. Fixed salary\n3. Tax pot", cta: "Join the newsletter" } });
  await t.call("POST", `/api/content/${item.body.id}/qa`, { useModel: false });
  const ap = await t.call("POST", `/api/content/${item.body.id}/approve`, {});
  expect(ap.body.status).toBe("APPROVED");
  return { ...t, itemId: item.body.id as string };
}

afterEach(() => {
  unregisterConnector("linkedin");
});

describe("publish gate", () => {
  it("is blocked by the kill switch (default OFF) even when connected and approved", async () => {
    mockConnector([]);
    const t = await approvedItem();
    const pv = await t.call("GET", `/api/content/${t.itemId}/publish-preview?connector=linkedin`);
    expect(pv.body.canPublish).toBe(false);
    expect(pv.body.blockers.join(" ")).toMatch(/switched OFF/);
    expect(pv.body.payload).toMatchObject({ account: "@test", privacy: "private", platform: "linkedin" });
    const r = await t.call("POST", `/api/content/${t.itemId}/publish`, { connectorId: "linkedin", previewHash: pv.body.previewHash, confirm: true });
    expect(r.status).toBe(403);
  });

  it("requires explicit confirmation and an unchanged preview, and is idempotent", async () => {
    const calls = mockConnector([{ kind: "succeeded", externalId: "urn:1", url: "https://linkedin.com/p/1" }]);
    const t = await approvedItem();
    updateSettings(t.db, { publishingEnabled: true });
    const pv = (await t.call("GET", `/api/content/${t.itemId}/publish-preview?connector=linkedin`)).body;
    expect(pv.canPublish).toBe(true);
    expect((await t.call("POST", `/api/content/${t.itemId}/publish`, { connectorId: "linkedin", previewHash: pv.previewHash, confirm: false })).status).toBe(400);
    expect((await t.call("POST", `/api/content/${t.itemId}/publish`, { connectorId: "linkedin", previewHash: "stale", confirm: true })).status).toBe(409);
    const ok = await t.call("POST", `/api/content/${t.itemId}/publish`, { connectorId: "linkedin", previewHash: pv.previewHash, confirm: true });
    expect(ok.body.job.status).toBe("succeeded");
    const item = (await t.call("GET", `/api/content/${t.itemId}`)).body;
    expect(item).toMatchObject({ status: "PUBLISHED", publishedUrl: "https://linkedin.com/p/1", externalId: "urn:1" });
    // A second attempt does not call the provider again.
    const pv2 = (await t.call("GET", `/api/content/${t.itemId}/publish-preview?connector=linkedin`)).body;
    expect(pv2.canPublish).toBe(false); // already published → no new external write is allowed
    const again = await t.call("POST", `/api/content/${t.itemId}/publish`, { connectorId: "linkedin", previewHash: pv.previewHash, confirm: true });
    expect(again.body.duplicate).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("never blindly retries an ambiguous outcome", async () => {
    const calls = mockConnector([{ kind: "ambiguous", error: "timeout after send" }, { kind: "succeeded", externalId: "urn:2", url: "https://linkedin.com/p/2" }]);
    const t = await approvedItem();
    updateSettings(t.db, { publishingEnabled: true });
    const pv = (await t.call("GET", `/api/content/${t.itemId}/publish-preview?connector=linkedin`)).body;
    const first = await t.call("POST", `/api/content/${t.itemId}/publish`, { connectorId: "linkedin", previewHash: pv.previewHash, confirm: true });
    expect(first.body.job.status).toBe("ambiguous");
    const blocked = await t.call("POST", `/api/content/${t.itemId}/publish`, { connectorId: "linkedin", previewHash: pv.previewHash, confirm: true });
    expect(blocked.status).toBe(409);
    expect(calls).toHaveLength(1);
    const checked = await t.call("POST", `/api/publish-jobs/${first.body.job.id}/check`);
    expect(checked.body.status).toBe("failed"); // provider says not found → now safe to retry
    const retry = await t.call("POST", `/api/content/${t.itemId}/publish`, { connectorId: "linkedin", previewHash: pv.previewHash, confirm: true });
    expect(retry.body.job.status).toBe("succeeded");
    expect(retry.body.job.attempts).toBe(2);
    const audit = (await t.call("GET", `/api/audit?entityId=${first.body.job.id}`)).body.map((a: any) => a.action);
    expect(audit).toEqual(expect.arrayContaining(["publish_started", "publish_ambiguous", "status_checked", "publish_succeeded"]));
  });

  it("voids approval after changes are requested, archive, or switching variants (security review #1)", async () => {
    const calls = mockConnector([{ kind: "succeeded", externalId: "x", url: "https://linkedin.com/p/x" }]);
    const t = await approvedItem();
    updateSettings(t.db, { publishingEnabled: true });
    const pv = (await t.call("GET", `/api/content/${t.itemId}/publish-preview?connector=linkedin`)).body;
    expect(pv.canPublish).toBe(true);
    await t.call("POST", `/api/content/${t.itemId}/approve`, { decision: "changes_requested", note: "fix hook" });
    const after = (await t.call("GET", `/api/content/${t.itemId}/publish-preview?connector=linkedin`)).body;
    expect(after.canPublish).toBe(false);
    expect((await t.call("POST", `/api/content/${t.itemId}/publish`, { connectorId: "linkedin", previewHash: after.previewHash, confirm: true })).status).toBe(403);
    // Re-approve, then archive → blocked again
    await t.call("POST", `/api/content/${t.itemId}/qa`, { useModel: false });
    expect((await t.call("POST", `/api/content/${t.itemId}/approve`, {})).body.status).toBe("APPROVED");
    await t.call("POST", `/api/content/${t.itemId}/transition`, { to: "ARCHIVED" });
    expect((await t.call("GET", `/api/content/${t.itemId}/publish-preview?connector=linkedin`)).body.canPublish).toBe(false);
    expect(calls).toHaveLength(0);
    // javascript: URLs are refused when marking as published
    expect((await t.call("POST", `/api/content/${t.itemId}/transition`, { to: "PUBLISHED", publishedUrl: "javascript:alert(1)" })).status).toBe(400);
  });

  it("reports honest integration statuses; nothing claims to be connected without config", async () => {
    const t = makeApp();
    const list = (await t.call("GET", "/api/integrations")).body;
    const by = Object.fromEntries(list.map((i: any) => [i.id, i.status]));
    expect(by).toMatchObject({ anthropic: "needs_credentials", youtube: "needs_credentials", tiktok: "needs_provider_approval", manual: "available", webpage: "available" });
    const d = await t.call("POST", "/api/integrations/youtube/disconnect");
    expect(d.body.disconnected).toBe(true);
    expect((await t.call("GET", "/api/integrations")).body.find((i: any) => i.id === "youtube").status).toBe("disconnected");
  });
});
