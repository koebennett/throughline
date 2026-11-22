// Publish gate. Deterministic checks — never model judgement — decide whether an external write may happen:
// kill switch → connector connected → current variant approved → preview hash confirmed → idempotency.
// Ambiguous outcomes are never blindly retried: provider status is queried first.
import { createHash } from "node:crypto";
import type { Ctx } from "../context.js";
import { newId, now, parseJson } from "../db/db.js";
import { dto, dtos } from "../lib/rows.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { getConnector } from "../connectors/registry.js";
import type { PublishOutcome, PublishPayload } from "../connectors/types.js";
import { audit } from "./audit.js";
import { currentApproval, getContentItem, normaliseFields, transition } from "./content.js";

function buildPayload(ctx: Ctx, itemId: string, privacy: PublishPayload["privacy"]): PublishPayload {
  const item = getContentItem(ctx.db, itemId);
  const v = item.variants.find((x: any) => x.id === item.currentVariantId);
  if (!v) throw conflict("No current variant.");
  const connector = getConnector(item.platform === "youtube_shorts" ? "youtube" : item.platform);
  return {
    account: connector?.status(ctx).account ?? "(not connected)",
    platform: item.platform,
    format: item.format,
    title: item.title,
    fields: normaliseFields(v.fields),
    scheduledAt: item.scheduledAt ?? null,
    privacy,
    mediaAssetIds: item.lineage.map((l: any) => l.sourceAssetId).filter(Boolean),
  };
}

const hashPayload = (p: PublishPayload, variantId: string, connectorId: string) =>
  createHash("sha256").update(JSON.stringify({ p, variantId, connectorId })).digest("hex").slice(0, 32);

/** Everything the user must see before an external write: account, content, media, caption, time, privacy. */
export function publishPreview(ctx: Ctx, itemId: string, connectorId: string, privacy: PublishPayload["privacy"] = "private") {
  const connector = getConnector(connectorId);
  if (!connector) throw notFound("Connector");
  const item = getContentItem(ctx.db, itemId);
  const payload = buildPayload(ctx, itemId, privacy);
  const status = connector.status(ctx);
  const blockers: string[] = [];
  if (!ctx.settings().publishingEnabled) blockers.push("Publishing is switched OFF (Settings → Publishing kill switch).");
  if (status.status !== "connected") blockers.push(`${connector.descriptor.name} is not connected (${status.status.replace(/_/g, " ")}).`);
  if (!connector.descriptor.capabilities.includes("publish") || !connector.publish) blockers.push(`${connector.descriptor.name} cannot publish.`);
  if (!currentApproval(ctx.db, itemId)) blockers.push("The current variant has not been approved.");
  blockers.push(...(connector.validate?.(payload) ?? []));
  return { connector: { id: connectorId, name: connector.descriptor.name, status: status.status }, payload, previewHash: hashPayload(payload, item.currentVariantId, connectorId), blockers, canPublish: blockers.length === 0 };
}

export async function publish(ctx: Ctx, itemId: string, input: { connectorId: string; previewHash: string; confirm: boolean; privacy?: PublishPayload["privacy"] }) {
  if (!input.confirm) throw badRequest("Explicit confirmation is required to publish.");
  const preview = publishPreview(ctx, itemId, input.connectorId, input.privacy ?? "private");
  if (preview.previewHash !== input.previewHash) throw conflict("The content changed since you reviewed the preview. Review it again before publishing.");
  if (preview.blockers.length) throw forbidden("Publishing is blocked.", preview.blockers);
  const item = getContentItem(ctx.db, itemId);
  const key = createHash("sha256").update(`${itemId}:${item.currentVariantId}:${input.connectorId}`).digest("hex").slice(0, 40);
  const existing = ctx.db.get("SELECT * FROM publish_jobs WHERE idempotency_key = ?", key);
  if (existing) {
    if (existing.status === "succeeded") return { job: dto(existing), duplicate: true };
    if (existing.status === "running") throw conflict("A publish job for this exact content is already running.");
    if (existing.status === "ambiguous") throw conflict("The previous attempt had an ambiguous outcome. Use “Check status” before retrying.");
  }
  const connector = getConnector(input.connectorId)!;
  const jobId = existing?.id ?? newId("pub");
  ctx.db.tx(() => {
    if (existing) ctx.db.update("publish_jobs", jobId, { status: "running", attempts: existing.attempts + 1, updated_at: now() });
    else
      ctx.db.insert("publish_jobs", { id: jobId, brand_id: item.brandId, content_item_id: itemId, variant_id: item.currentVariantId, connector: input.connectorId, idempotency_key: key, status: "running", request_json: preview.payload, attempts: 1, created_at: now(), updated_at: now() });
    audit(ctx.db, { brandId: item.brandId, entityType: "publish_job", entityId: jobId, action: "publish_started", detail: { connector: input.connectorId, privacy: preview.payload.privacy, previewHash: input.previewHash } });
  });
  let outcome: PublishOutcome;
  try {
    outcome = await connector.publish!(ctx, preview.payload, key);
  } catch (e) {
    outcome = { kind: "ambiguous", error: (e as Error).message }; // unknown whether the provider applied it
  }
  return { job: recordOutcome(ctx, jobId, outcome), duplicate: false };
}

function recordOutcome(ctx: Ctx, jobId: string, outcome: PublishOutcome) {
  const job = ctx.db.get("SELECT * FROM publish_jobs WHERE id = ?", jobId)!;
  ctx.db.tx(() => {
    if (outcome.kind === "succeeded") {
      ctx.db.update("publish_jobs", jobId, { status: "succeeded", last_error: "", updated_at: now() });
      ctx.db.insert("publish_results", { id: newId("pres"), publish_job_id: jobId, external_id: outcome.externalId, url: outcome.url, raw_json: outcome.raw ?? {}, created_at: now() });
      ctx.db.update("content_items", job.content_item_id, { external_id: outcome.externalId, published_url: outcome.url });
    } else ctx.db.update("publish_jobs", jobId, { status: outcome.kind === "failed" ? "failed" : "ambiguous", last_error: outcome.error.slice(0, 2000), updated_at: now() });
    audit(ctx.db, { brandId: job.brand_id, entityType: "publish_job", entityId: jobId, action: `publish_${outcome.kind}`, detail: outcome.kind === "succeeded" ? { externalId: outcome.externalId, url: outcome.url } : { error: outcome.error } });
  });
  if (outcome.kind === "succeeded") transition(ctx.db, job.content_item_id, "PUBLISHED", { viaConnector: job.connector, publishedUrl: outcome.url });
  return dto(ctx.db.get("SELECT * FROM publish_jobs WHERE id = ?", jobId));
}

/** For ambiguous jobs: ask the provider whether the post exists before allowing a retry. */
export async function checkJobStatus(ctx: Ctx, jobId: string) {
  const job = ctx.db.get("SELECT * FROM publish_jobs WHERE id = ?", jobId);
  if (!job) throw notFound("Publish job");
  const connector = getConnector(job.connector);
  if (!connector?.checkStatus) throw badRequest("This connector cannot report status; verify on the platform and record the URL manually.");
  const res = await connector.checkStatus(ctx, job.idempotency_key);
  if (res.kind === "not_found") {
    ctx.db.update("publish_jobs", jobId, { status: "failed", last_error: "Provider reports no post for this request — safe to retry.", updated_at: now() });
    audit(ctx.db, { brandId: job.brand_id, entityType: "publish_job", entityId: jobId, action: "status_checked", detail: { result: "not_found" } });
    return dto(ctx.db.get("SELECT * FROM publish_jobs WHERE id = ?", jobId));
  }
  return recordOutcome(ctx, jobId, res);
}

export function listPublishJobs(ctx: Ctx, brandId: string) {
  return dtos(ctx.db.all("SELECT j.*, c.title, r.url AS result_url, r.external_id FROM publish_jobs j JOIN content_items c ON c.id = j.content_item_id LEFT JOIN publish_results r ON r.publish_job_id = j.id WHERE j.brand_id = ? ORDER BY j.created_at DESC", brandId));
}

/** Manual hand-off package for approved content. Not an external write. */
export function handoffPackage(ctx: Ctx, itemId: string) {
  const item = getContentItem(ctx.db, itemId);
  const approval = currentApproval(ctx.db, itemId);
  const v = item.variants.find((x: any) => x.id === item.currentVariantId);
  const f = normaliseFields(v?.fields ?? {});
  const lines = [
    `# ${item.title}`,
    `Platform: ${item.platform} · Format: ${item.format} · Status: ${item.status}${approval ? ` · Approved ${approval.created_at.slice(0, 10)}` : " · NOT APPROVED"}`,
    item.scheduledAt ? `Planned: ${item.scheduledAt} (${item.timezone})` : "",
    f.titleOptions.length ? `\n## Title options\n${f.titleOptions.map((t) => `- ${t}`).join("\n")}` : "",
    f.hooks.length ? `\n## Hooks\n${f.hooks.map((t) => `- ${t}`).join("\n")}` : "",
    f.body ? `\n## Body / script\n${f.body}` : "",
    f.slides.length ? `\n## Slides\n${f.slides.map((s, i) => `${i + 1}. **${s.heading}** — ${s.text}`).join("\n")}` : "",
    f.beats.length ? `\n## Beat sheet\n${f.beats.map((b) => `- ${b.seconds != null ? `[${b.seconds}s] ` : ""}${b.beat} — visual: ${b.visual}`).join("\n")}` : "",
    f.caption ? `\n## Caption\n${f.caption}` : "",
    f.description ? `\n## Description\n${f.description}` : "",
    f.chapters.length ? `\n## Chapters\n${f.chapters.map((c) => `${c.time} ${c.label}`).join("\n")}` : "",
    f.hashtags.length ? `\n## Hashtags\n${f.hashtags.join(" ")}` : "",
    f.cta ? `\n## CTA\n${f.cta}` : "",
    f.pinnedComment ? `\n## Pinned comment\n${f.pinnedComment}` : "",
    f.thumbnailConcepts.length ? `\n## Thumbnail concepts\n${f.thumbnailConcepts.map((t) => `- ${t}`).join("\n")}` : "",
    f.productionNotes ? `\n## Production notes\n${f.productionNotes}` : "",
  ].filter(Boolean);
  audit(ctx.db, { brandId: item.brandId, entityType: "content", entityId: itemId, action: "handoff_exported", detail: { approved: !!approval } });
  return { markdown: lines.join("\n") + "\n", approved: !!approval, fields: f, item: { id: item.id, title: item.title, platform: item.platform, format: item.format, status: item.status } };
}

export function parseJobRequest(job: { request_json: string }) {
  return parseJson<PublishPayload | null>(job.request_json, null);
}
