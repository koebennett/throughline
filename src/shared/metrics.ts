// Metric definitions + CSV header aliases (incl. common YouTube Studio / Meta / TikTok export headers).
// Platforms define "views" differently — the app compares posts only against the same platform's own baseline.
export interface MetricDef {
  key: string;
  label: string;
  unit: "count" | "percent" | "seconds" | "minutes" | "currency";
  definition: string;
  aliases: string[];
  higherIsBetter: boolean;
}

export const METRICS: MetricDef[] = [
  { key: "impressions", label: "Impressions", unit: "count", higherIsBetter: true, definition: "Times the content (or its thumbnail) was shown, per the platform's own definition.", aliases: ["impressions", "impr", "reach impressions"] },
  { key: "reach", label: "Reach", unit: "count", higherIsBetter: true, definition: "Unique accounts reached (platform-defined).", aliases: ["reach", "accounts reached", "unique viewers"] },
  { key: "views", label: "Views", unit: "count", higherIsBetter: true, definition: "Platform-defined views/plays. Not comparable across platforms.", aliases: ["views", "video views", "plays", "video plays", "engaged views"] },
  { key: "watch_time_minutes", label: "Watch time (min)", unit: "minutes", higherIsBetter: true, definition: "Total minutes watched.", aliases: ["watch time (minutes)", "watch time minutes", "watch_time_minutes", "total watch time"] },
  { key: "watch_time_hours", label: "Watch time (h)", unit: "count", higherIsBetter: true, definition: "Total hours watched (converted to minutes on import).", aliases: ["watch time (hours)", "watch time hours"] },
  { key: "avg_view_duration_seconds", label: "Avg view duration (s)", unit: "seconds", higherIsBetter: true, definition: "Average seconds watched per view. h:mm:ss values are converted.", aliases: ["average view duration", "avg view duration", "average watch time", "avg_view_duration_seconds"] },
  { key: "avg_percent_viewed", label: "Avg % viewed", unit: "percent", higherIsBetter: true, definition: "Average percentage of the video watched (retention).", aliases: ["average percentage viewed (%)", "average percentage viewed", "avg % viewed", "avg_percent_viewed", "retention"] },
  { key: "ctr_percent", label: "CTR %", unit: "percent", higherIsBetter: true, definition: "Impressions click-through rate.", aliases: ["impressions click-through rate (%)", "ctr", "ctr (%)", "click-through rate", "ctr_percent"] },
  { key: "likes", label: "Likes", unit: "count", higherIsBetter: true, definition: "Likes/reactions.", aliases: ["likes", "reactions", "hearts"] },
  { key: "comments", label: "Comments", unit: "count", higherIsBetter: true, definition: "Comments added.", aliases: ["comments", "comments added", "replies"] },
  { key: "shares", label: "Shares", unit: "count", higherIsBetter: true, definition: "Shares/reposts/sends.", aliases: ["shares", "reposts", "sends", "retweets"] },
  { key: "saves", label: "Saves", unit: "count", higherIsBetter: true, definition: "Saves/bookmarks — a strong usefulness signal on many platforms.", aliases: ["saves", "saved", "bookmarks"] },
  { key: "link_clicks", label: "Link clicks", unit: "count", higherIsBetter: true, definition: "Clicks on links in the post.", aliases: ["link clicks", "clicks", "url clicks", "website clicks"] },
  { key: "profile_visits", label: "Profile visits", unit: "count", higherIsBetter: true, definition: "Visits to the profile from this content.", aliases: ["profile visits", "profile views"] },
  { key: "followers_gained", label: "Followers gained", unit: "count", higherIsBetter: true, definition: "Net subscribers/followers gained.", aliases: ["subscribers", "subscribers gained", "followers", "follows", "followers gained", "new followers"] },
  { key: "conversions", label: "Conversions", unit: "count", higherIsBetter: true, definition: "User-defined conversions (sign-ups, sales) attributed to the post.", aliases: ["conversions", "signups", "sign-ups", "leads", "sales"] },
  { key: "revenue", label: "Revenue", unit: "currency", higherIsBetter: true, definition: "Revenue — only import if you are authorised to use it.", aliases: ["revenue", "estimated revenue", "your estimated revenue (usd)", "earnings"] },
];

export const META_COLUMNS: Record<string, string[]> = {
  post_ref: ["post_id", "post id", "content", "video", "id", "video id", "media id"],
  title: ["title", "video title", "post title", "caption", "description", "name"],
  url: ["url", "permalink", "link", "post url"],
  published_at: ["published_at", "video publish time", "publish time", "date", "published", "post date", "created"],
  format: ["format", "type", "post type", "media type", "content type"],
  pillar: ["pillar", "topic", "category"],
  platform: ["platform", "network", "channel"],
};

export const CSV_TEMPLATE_HEADERS = [
  "post_id", "platform", "title", "url", "published_at", "format", "pillar",
  "impressions", "reach", "views", "watch_time_minutes", "avg_view_duration_seconds", "avg_percent_viewed", "ctr_percent",
  "likes", "comments", "shares", "saves", "link_clicks", "profile_visits", "followers_gained", "conversions", "revenue",
];

/** Metrics most relevant to each objective — guides which numbers the analysis leads with. */
export const GOAL_METRICS: Record<string, string[]> = {
  awareness: ["impressions", "reach", "views", "shares"],
  engagement: ["avg_percent_viewed", "avg_view_duration_seconds", "saves", "comments", "shares"],
  growth: ["followers_gained", "profile_visits", "views"],
  conversion: ["link_clicks", "conversions", "revenue", "ctr_percent"],
};
