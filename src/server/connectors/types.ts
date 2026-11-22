import type { DraftFields, Platform } from "../../shared/schemas.js";
import type { Ctx } from "../context.js";

export type IntegrationStatus =
  | "connected" // verified live connection
  | "available" // works without setup (e.g. manual, page import)
  | "needs_credentials"
  | "needs_oauth"
  | "needs_provider_approval"
  | "not_implemented" // boundary defined, live calls not built yet
  | "demo_only"
  | "disconnected";

export type Capability = "generate" | "research" | "read_analytics" | "publish" | "schedule" | "export";

export interface ConnectorDescriptor {
  id: string;
  name: string;
  kind: "model" | "research" | "platform" | "publishing_provider" | "export";
  platforms: Platform[];
  capabilities: Capability[];
  scopes: string[]; // least-privilege scopes the connector would request
  permissionExplanation: string;
  setupSteps: string[];
  docsUrls: string[];
  verifiedOn: string; // date the official docs were last checked
}

export interface PublishPayload {
  account: string;
  platform: Platform;
  format: string;
  title: string;
  fields: DraftFields;
  scheduledAt: string | null;
  privacy: "private" | "unlisted" | "public";
  mediaAssetIds: string[];
}

export type PublishOutcome =
  | { kind: "succeeded"; externalId: string; url: string; raw?: unknown }
  | { kind: "failed"; error: string; retryable: boolean }
  | { kind: "ambiguous"; error: string }; // request may or may not have been applied — must check before retrying

export interface PlatformConnector {
  descriptor: ConnectorDescriptor;
  status(ctx: Ctx): { status: IntegrationStatus; detail: string; account?: string };
  validate?(payload: PublishPayload): string[];
  publish?(ctx: Ctx, payload: PublishPayload, idempotencyKey: string): Promise<PublishOutcome>;
  checkStatus?(ctx: Ctx, idempotencyKey: string): Promise<PublishOutcome | { kind: "not_found" }>;
}
