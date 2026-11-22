// Content lifecycle state machine. Enforced in code on the server — never by model judgement.
export const CONTENT_STATUSES = [
  "IDEA",
  "RESEARCHED",
  "BRIEF",
  "DRAFT",
  "QA",
  "REVIEW",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHED",
  "ANALYZED",
  "ARCHIVED",
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

const T: Record<ContentStatus, ContentStatus[]> = {
  IDEA: ["RESEARCHED", "BRIEF", "ARCHIVED"],
  RESEARCHED: ["BRIEF", "IDEA", "ARCHIVED"],
  BRIEF: ["DRAFT", "RESEARCHED", "ARCHIVED"],
  DRAFT: ["QA", "BRIEF", "ARCHIVED"],
  QA: ["REVIEW", "DRAFT", "ARCHIVED"],
  REVIEW: ["APPROVED", "DRAFT", "ARCHIVED"],
  APPROVED: ["SCHEDULED", "PUBLISHED", "DRAFT", "ARCHIVED"],
  SCHEDULED: ["PUBLISHED", "APPROVED", "DRAFT", "ARCHIVED"],
  PUBLISHED: ["ANALYZED", "ARCHIVED"],
  ANALYZED: ["ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

export function allowedTransitions(from: ContentStatus): ContentStatus[] {
  return T[from] ?? [];
}

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return allowedTransitions(from).includes(to);
}

/** States that require a passing QA + explicit human approval on the current variant. */
export const REQUIRES_APPROVAL: ContentStatus[] = ["APPROVED", "SCHEDULED", "PUBLISHED"];

export const STATUS_TONE: Record<ContentStatus, "neutral" | "info" | "warn" | "good" | "muted"> = {
  IDEA: "neutral",
  RESEARCHED: "neutral",
  BRIEF: "info",
  DRAFT: "info",
  QA: "warn",
  REVIEW: "warn",
  APPROVED: "good",
  SCHEDULED: "good",
  PUBLISHED: "good",
  ANALYZED: "muted",
  ARCHIVED: "muted",
};
