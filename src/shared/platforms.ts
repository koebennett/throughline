// Platform format guidance used by QA and the Creation Studio.
// Limits change; values here are commonly documented limits as of the research date and are surfaced as
// SOFT warnings with "verify" wording — never as hard blockers. Re-check official docs (docs/INTEGRATIONS.md).
import type { Format, Platform } from "./schemas.js";

export interface PlatformSpec {
  label: string;
  defaultFormat: Format;
  formats: Format[];
  limits: Partial<Record<"title" | "body" | "caption" | "description" | "hashtags", number>>;
  aspect?: string;
  duration?: string;
  notes: string[];
  verifiedOn: string;
}

export const PLATFORM_SPECS: Record<Platform, PlatformSpec> = {
  youtube: {
    label: "YouTube",
    defaultFormat: "long_video",
    formats: ["long_video", "live"],
    limits: { title: 100, description: 5000 },
    aspect: "16:9",
    notes: ["Packaging (title + thumbnail) must truthfully match the content.", "Chapters need a 00:00 first timestamp."],
    verifiedOn: "2026-11-22",
  },
  youtube_shorts: {
    label: "YouTube Shorts",
    defaultFormat: "short_video",
    formats: ["short_video"],
    limits: { title: 100 },
    aspect: "9:16",
    duration: "up to 3 minutes (verify current limit)",
    notes: ["Hook in the first second; loop-friendly endings help rewatch."],
    verifiedOn: "2026-11-22",
  },
  tiktok: {
    label: "TikTok",
    defaultFormat: "short_video",
    formats: ["short_video", "carousel", "live"],
    limits: { caption: 4000 },
    aspect: "9:16",
    notes: ["Native, creator-led delivery beats polished ads.", "Direct Post API requires an audited app for public posts."],
    verifiedOn: "2026-11-22",
  },
  instagram: {
    label: "Instagram",
    defaultFormat: "carousel",
    formats: ["carousel", "short_video", "single_image", "story_sequence"],
    limits: { caption: 2200, hashtags: 30 },
    aspect: "4:5 feed, 9:16 Reels/Stories",
    notes: ["Carousels: one idea per slide, payoff on the last slide."],
    verifiedOn: "2026-11-22",
  },
  facebook: {
    label: "Facebook",
    defaultFormat: "text_post",
    formats: ["text_post", "short_video", "single_image", "long_video"],
    limits: { body: 63206 },
    notes: [],
    verifiedOn: "2026-11-22",
  },
  linkedin: {
    label: "LinkedIn",
    defaultFormat: "text_post",
    formats: ["text_post", "carousel", "article", "short_video"],
    limits: { body: 3000 },
    notes: ["First ~2 lines show before 'see more' — lead with the insight."],
    verifiedOn: "2026-11-22",
  },
  x: {
    label: "X",
    defaultFormat: "thread",
    formats: ["text_post", "thread", "short_video"],
    limits: { body: 280 },
    notes: ["280 characters per post for standard accounts; threads split longer ideas."],
    verifiedOn: "2026-11-22",
  },
  threads: {
    label: "Threads",
    defaultFormat: "text_post",
    formats: ["text_post", "thread"],
    limits: { body: 500 },
    notes: [],
    verifiedOn: "2026-11-22",
  },
  pinterest: {
    label: "Pinterest",
    defaultFormat: "single_image",
    formats: ["single_image", "short_video"],
    limits: { title: 100, description: 500 },
    aspect: "2:3",
    notes: ["Search-driven: descriptive, keyword-natural titles."],
    verifiedOn: "2026-11-22",
  },
  blog: {
    label: "Blog",
    defaultFormat: "article",
    formats: ["article"],
    limits: { title: 70, description: 160 },
    notes: ["SEO title ≈ 60 chars and meta description ≈ 155 chars are display guidelines, not rules."],
    verifiedOn: "2026-11-22",
  },
  newsletter: {
    label: "Newsletter",
    defaultFormat: "newsletter_issue",
    formats: ["newsletter_issue"],
    limits: { title: 90 },
    notes: ["Subject line = title option; preview text = description."],
    verifiedOn: "2026-11-22",
  },
  podcast: {
    label: "Podcast",
    defaultFormat: "podcast_episode",
    formats: ["podcast_episode"],
    limits: { title: 120, description: 4000 },
    notes: [],
    verifiedOn: "2026-11-22",
  },
};

export const FORMAT_LABELS: Record<Format, string> = {
  long_video: "Long-form video",
  short_video: "Short video",
  carousel: "Carousel",
  single_image: "Single image",
  text_post: "Text post",
  thread: "Thread",
  article: "Article",
  newsletter_issue: "Newsletter issue",
  story_sequence: "Story sequence",
  live: "Live",
  podcast_episode: "Podcast episode",
};
