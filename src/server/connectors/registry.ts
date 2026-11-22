// Connector registry. Statuses are computed honestly from real configuration — never assumed.
// Official docs were checked on the verifiedOn date; re-check before enabling any live write (docs/INTEGRATIONS.md).
import type { Ctx } from "../context.js";
import type { PlatformConnector } from "./types.js";
import { youtubeStatus } from "../services/youtube.js";

const VERIFIED = "2026-11-22";

const anthropic: PlatformConnector = {
  descriptor: {
    id: "anthropic", name: "Claude (Anthropic API)", kind: "model", platforms: [], capabilities: ["generate", "research"], scopes: [],
    permissionExplanation: "Sends brand context, research excerpts and drafts to the Anthropic API to generate structured strategy, drafts, QA judgements and cited web research. Keys stay server-side.",
    setupSteps: ["Create an API key at console.anthropic.com", "Set ANTHROPIC_API_KEY in .env (or paste it in Settings → Integrations; it is stored encrypted)", "Restart is not required when saved from Settings"],
    docsUrls: ["https://docs.claude.com/en/api/overview"], verifiedOn: VERIFIED,
  },
  status: (ctx) => {
    const m = ctx.model();
    return m.live ? { status: "connected", detail: `Using ${m.models.strong} (strategy/creative) and ${m.models.fast} (classification). Use “Test connection” to verify the key.` } : { status: "needs_credentials", detail: "No API key — the labelled offline scaffold engine is used instead." };
  },
};

const webpage: PlatformConnector = {
  descriptor: {
    id: "webpage", name: "Public web page import", kind: "research", platforms: [], capabilities: ["research"], scopes: [],
    permissionExplanation: "Fetches a public URL you paste (no login, no scraping of logged-in platforms), stores title, publisher, dates and an excerpt as a dated source. Private/internal addresses are refused.",
    setupSteps: ["No setup required"], docsUrls: [], verifiedOn: VERIFIED,
  },
  status: () => ({ status: "available", detail: "Paste a public URL in the Research Desk." }),
};

const claudeSearch: PlatformConnector = {
  descriptor: {
    id: "claude_web_search", name: "Claude web search (cited)", kind: "research", platforms: [], capabilities: ["research"], scopes: [],
    permissionExplanation: "Lets the research agent run a bounded number of web searches via Anthropic's server-side web search tool. Results come back with URLs, titles and page age, which are saved as sources.",
    setupSteps: ["Requires a Claude API key", "Web search must be enabled for your Anthropic organization", "Limit searches per run in Settings (default 5)"],
    docsUrls: ["https://docs.claude.com/en/docs/agents-and-tools/tool-use/web-search-tool"], verifiedOn: VERIFIED,
  },
  status: (ctx) => (ctx.model().live ? { status: "connected", detail: "Available to research runs (billed per search by Anthropic)." } : { status: "needs_credentials", detail: "Needs a Claude API key." }),
};

const youtube: PlatformConnector = {
  descriptor: {
    id: "youtube", name: "YouTube Analytics (read-only)", kind: "platform", platforms: ["youtube", "youtube_shorts"], capabilities: ["read_analytics"],
    scopes: ["https://www.googleapis.com/auth/yt-analytics.readonly", "https://www.googleapis.com/auth/youtube.readonly"],
    permissionExplanation: "Read-only access to your own channel's analytics and video titles. No uploads, no comments/likes/subscriptions, no downloading of video. Synced data is replaced on each sync and deleted after 30 days or when you disconnect (YouTube API Services policy).",
    setupSteps: [
      "Google Cloud Console → create a project → enable “YouTube Analytics API” and “YouTube Data API v3”",
      "OAuth consent screen → External → add yourself as a Test user (no Google review needed for your own use)",
      "Credentials → Create OAuth client ID → Application type: Desktop app",
      "Paste the client ID and client secret below (stored encrypted), then click Connect YouTube",
      "Sync from Analytics Lab → “Sync YouTube”",
    ],
    docsUrls: ["https://developers.google.com/youtube/analytics", "https://developers.google.com/identity/protocols/oauth2/native-app", "https://developers.google.com/youtube/terms/developer-policies"], verifiedOn: "2026-11-22 (endpoints not re-fetched — see docs/INTEGRATIONS.md)",
  },
  status: (ctx) => youtubeStatus(ctx),
};

const tiktok: PlatformConnector = {
  descriptor: {
    id: "tiktok", name: "TikTok Content Posting API", kind: "platform", platforms: ["tiktok"], capabilities: ["publish"], scopes: ["video.publish", "user.info.basic"],
    permissionExplanation: "Direct posting needs a registered app, approved video.publish scope, creator-info checks and explicit user consent. Unaudited clients can only post privately; public posting requires TikTok's audit.",
    setupSteps: ["Register an app at developers.tiktok.com", "Add Content Posting API and request video.publish", "Pass TikTok's audit before public posting is possible"],
    docsUrls: ["https://developers.tiktok.com/products/content-posting-api", "https://developers.tiktok.com/doc/content-posting-api-get-started"], verifiedOn: VERIFIED,
  },
  status: () => ({ status: "needs_provider_approval", detail: "Requires TikTok app registration + audit. Not available; use manual hand-off." }),
};

const meta: PlatformConnector = {
  descriptor: {
    id: "meta", name: "Instagram / Facebook (Meta Graph API)", kind: "platform", platforms: ["instagram", "facebook", "threads"], capabilities: ["read_analytics", "publish"],
    scopes: ["instagram_basic", "instagram_content_publish", "pages_read_engagement"],
    permissionExplanation: "Requires a professional account linked to a Facebook Page, Meta app review for publish permissions, and token refresh.",
    setupSteps: ["Create a Meta app", "Complete app review for content publishing permissions", "Re-check current Graph API docs before enabling"], docsUrls: ["https://developers.facebook.com/docs/instagram-platform"], verifiedOn: VERIFIED,
  },
  status: () => ({ status: "needs_provider_approval", detail: "Requires Meta app review. Not available; use CSV import and manual hand-off." }),
};

const linkedin: PlatformConnector = {
  descriptor: {
    id: "linkedin", name: "LinkedIn", kind: "platform", platforms: ["linkedin"], capabilities: ["publish"], scopes: ["w_member_social"],
    permissionExplanation: "Posting on behalf of a member or organization requires approved LinkedIn API products.", setupSteps: ["Apply for the relevant LinkedIn API product", "Re-check docs before enabling"],
    docsUrls: ["https://learn.microsoft.com/en-us/linkedin/"], verifiedOn: VERIFIED,
  },
  status: () => ({ status: "needs_provider_approval", detail: "Requires LinkedIn API product approval." }),
};

const publishingProvider: PlatformConnector = {
  descriptor: {
    id: "publishing_provider", name: "Multi-platform publishing provider (e.g. Buffer, Postiz)", kind: "publishing_provider",
    platforms: ["instagram", "facebook", "linkedin", "x", "threads", "pinterest", "tiktok", "youtube"], capabilities: ["publish", "schedule"], scopes: [],
    permissionExplanation: "Hands approved posts to a third-party scheduler you already use. Verify the provider's API plan, scopes, terms and pricing first. (Postiz is AGPL-3.0 — integrate over its API, do not copy code.)",
    setupSteps: ["Choose a provider with a documented API", "An adapter implementing PlatformConnector.publish/checkStatus is required"], docsUrls: [], verifiedOn: VERIFIED,
  },
  status: () => ({ status: "not_implemented", detail: "Connector interface ready; no provider adapter configured." }),
};

const manual: PlatformConnector = {
  descriptor: {
    id: "manual", name: "Manual hand-off (export)", kind: "export", platforms: [], capabilities: ["export"], scopes: [],
    permissionExplanation: "Export approved content (copy, CSV, ICS, Markdown package). You publish it yourself, then record the live URL here.",
    setupSteps: ["No setup required"], docsUrls: [], verifiedOn: VERIFIED,
  },
  status: () => ({ status: "available", detail: "Always available." }),
};

const registry = new Map<string, PlatformConnector>([anthropic, webpage, claudeSearch, youtube, tiktok, meta, linkedin, publishingProvider, manual].map((c) => [c.descriptor.id, c]));

export function listConnectors(): PlatformConnector[] {
  return [...registry.values()];
}
export function getConnector(id: string): PlatformConnector | undefined {
  return registry.get(id);
}
/** For tests and future adapters. */
export function registerConnector(c: PlatformConnector) {
  registry.set(c.descriptor.id, c);
}
export function unregisterConnector(id: string) {
  registry.delete(id);
}

export function integrationStatuses(ctx: Ctx) {
  return listConnectors().map((c) => {
    const row = ctx.db.get("SELECT * FROM integrations WHERE id = ?", c.descriptor.id);
    const s = row?.status === "disconnected" ? { status: "disconnected" as const, detail: "Disconnected by you. Reconnect to use it again." } : c.status(ctx);
    return { ...c.descriptor, ...s, lastSyncAt: row?.last_sync_at ?? null, connectedAt: row?.connected_at ?? null };
  });
}
