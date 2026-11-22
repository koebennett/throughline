// Ordered, append-only migrations. Never edit a shipped migration — add a new one.
// Rich, frequently-evolving fields live in *_json columns validated by Zod at the service layer.
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "init",
    sql: `
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE brand_profile_versions (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  profile_json TEXT NOT NULL,
  change_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  UNIQUE (brand_id, version)
);

-- Brand Brain: documents are chunked and indexed with FTS5 for cheap, citable retrieval.
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL, -- doc | transcript | script | content_export | offer | note | webpage
  source_ref TEXT NOT NULL DEFAULT '', -- filename or URL
  owner TEXT NOT NULL DEFAULT 'user',
  content TEXT NOT NULL,
  excluded INTEGER NOT NULL DEFAULT 0, -- user can exclude from retrieval without deleting
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE doc_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL
);
CREATE VIRTUAL TABLE chunks_fts USING fts5(text, heading, chunk_id UNINDEXED, brand_id UNINDEXED, tokenize = 'porter unicode61');

CREATE TABLE memory_items (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  layer TEXT NOT NULL, -- brand | project | content | research | preference
  statement TEXT NOT NULL,
  source_type TEXT NOT NULL, -- user | analytics | research | agent
  source_ref TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed | approved | rejected
  conflicts_with TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Research
CREATE TABLE research_runs (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  question TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  synthesis_json TEXT,
  agent_run_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  research_run_id TEXT REFERENCES research_runs(id) ON DELETE SET NULL,
  url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  publisher TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL DEFAULT '',
  retrieved_at TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'manual',
  excerpt TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  url_status TEXT NOT NULL DEFAULT 'unchecked', -- unchecked | ok | unreachable | invalid
  created_at TEXT NOT NULL
);
CREATE TABLE evidence_items (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  research_run_id TEXT REFERENCES research_runs(id) ON DELETE SET NULL,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  claim TEXT NOT NULL,
  kind TEXT NOT NULL,
  confidence TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  quote TEXT NOT NULL DEFAULT '',
  audit_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);

-- Strategy
CREATE TABLE strategy_versions (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | approved | superseded
  data_json TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  agent_run_id TEXT,
  validation_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL, approved_at TEXT,
  UNIQUE (brand_id, version)
);
CREATE TABLE pillars (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  strategy_version_id TEXT REFERENCES strategy_versions(id) ON DELETE SET NULL,
  name TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT '', audience_need TEXT NOT NULL DEFAULT '',
  proof TEXT NOT NULL DEFAULT '', boundaries TEXT NOT NULL DEFAULT '',
  ord INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE topic_clusters (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  pillar_id TEXT REFERENCES pillars(id) ON DELETE CASCADE,
  name TEXT NOT NULL, pillar_topic TEXT NOT NULL DEFAULT '',
  subtopics_json TEXT NOT NULL DEFAULT '[]', search_intent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE series (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL, premise TEXT NOT NULL DEFAULT '', format TEXT NOT NULL DEFAULT '',
  cadence TEXT NOT NULL DEFAULT '', pillar_id TEXT REFERENCES pillars(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '', kpi TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '', end_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned', notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Ideas → briefs → content
CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  title TEXT NOT NULL, angle TEXT NOT NULL DEFAULT '', rationale TEXT NOT NULL DEFAULT '',
  pillar_id TEXT REFERENCES pillars(id) ON DELETE SET NULL,
  series_id TEXT REFERENCES series(id) ON DELETE SET NULL,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  audience TEXT NOT NULL DEFAULT '', platform TEXT, format TEXT, funnel_stage TEXT,
  effort TEXT NOT NULL DEFAULT 'medium', source TEXT NOT NULL DEFAULT 'manual',
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  ratings_json TEXT NOT NULL DEFAULT '{}', rating_reasons_json TEXT NOT NULL DEFAULT '{}',
  score INTEGER, score_confidence TEXT,
  status TEXT NOT NULL DEFAULT 'IDEA',
  user_rating INTEGER, notes TEXT NOT NULL DEFAULT '',
  duplicate_of TEXT, duplicate_similarity REAL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE idea_revisions (
  id TEXT PRIMARY KEY, idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE briefs (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  idea_id TEXT REFERENCES ideas(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  data_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | approved
  version INTEGER NOT NULL DEFAULT 1,
  generated_by TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE brief_revisions (
  id TEXT PRIMARY KEY, brief_id TEXT NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE content_items (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  brief_id TEXT REFERENCES briefs(id) ON DELETE SET NULL,
  idea_id TEXT REFERENCES ideas(id) ON DELETE SET NULL,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  platform TEXT NOT NULL, format TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  current_variant_id TEXT,
  scheduled_at TEXT, timezone TEXT NOT NULL DEFAULT 'UTC',
  published_url TEXT NOT NULL DEFAULT '', external_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE content_variants (
  id TEXT PRIMARY KEY,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  angle_label TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  generated_by TEXT NOT NULL, -- model id | offline-scaffold | user
  parent_variant_id TEXT,
  feedback TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE qa_reviews (
  id TEXT PRIMARY KEY,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES content_variants(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  dimensions_json TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  blockers INTEGER NOT NULL, warnings INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  method TEXT NOT NULL, -- rules | rules+model
  acknowledged_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL, qa_review_id TEXT NOT NULL,
  decision TEXT NOT NULL, -- approved | changes_requested
  note TEXT NOT NULL DEFAULT '', approved_by TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);

-- Assets & lineage (user-owned / licensed media only)
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- video | audio | image | transcript | document
  title TEXT NOT NULL,
  rights TEXT NOT NULL DEFAULT 'unknown', -- owned | licensed | public_domain | permissioned | unknown
  rights_note TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '', mime TEXT NOT NULL DEFAULT '', size_bytes INTEGER NOT NULL DEFAULT 0,
  text_content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE content_lineage (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  source_asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
  source_content_item_id TEXT REFERENCES content_items(id) ON DELETE CASCADE,
  derivative_content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  segment_start TEXT NOT NULL DEFAULT '', segment_end TEXT NOT NULL DEFAULT '',
  quote TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- Calendar & publishing
CREATE TABLE calendar_entries (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  content_item_id TEXT REFERENCES content_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL, platform TEXT NOT NULL DEFAULT '',
  scheduled_at TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'UTC',
  suggestion_basis TEXT NOT NULL DEFAULT 'user', -- user | own_history | hypothesis
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE publish_jobs (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL,
  connector TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL, -- pending | running | succeeded | failed | ambiguous | cancelled
  request_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE publish_results (
  id TEXT PRIMARY KEY,
  publish_job_id TEXT NOT NULL REFERENCES publish_jobs(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);

-- Analytics & learning
CREATE TABLE analytics_imports (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  filename TEXT NOT NULL, platform TEXT NOT NULL, account TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'csv',
  row_count INTEGER NOT NULL, skipped INTEGER NOT NULL DEFAULT 0,
  mapping_json TEXT NOT NULL, warnings_json TEXT NOT NULL DEFAULT '[]',
  window_start TEXT NOT NULL DEFAULT '', window_end TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE analytics_snapshots (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  import_id TEXT REFERENCES analytics_imports(id) ON DELETE CASCADE,
  content_item_id TEXT REFERENCES content_items(id) ON DELETE SET NULL,
  platform TEXT NOT NULL, post_ref TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '', published_at TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '', pillar TEXT NOT NULL DEFAULT '',
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE experiments (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  hypothesis TEXT NOT NULL, variable TEXT NOT NULL, target_metric TEXT NOT NULL,
  success_threshold TEXT NOT NULL, start_date TEXT NOT NULL DEFAULT '', end_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned', result TEXT NOT NULL DEFAULT '', decision TEXT NOT NULL DEFAULT '',
  content_item_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Agent runs
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  input_json TEXT NOT NULL,
  status TEXT NOT NULL, -- queued | running | paused | awaiting_approval | succeeded | failed | cancelled | interrupted
  control TEXT NOT NULL DEFAULT '', -- pause | cancel requested by user
  current_step INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  error TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  budget_usd REAL NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  model_calls INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE agent_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL, name TEXT NOT NULL, label TEXT NOT NULL,
  status TEXT NOT NULL, -- pending | running | succeeded | failed | skipped | awaiting_approval
  output_json TEXT, error TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0,
  started_at TEXT, finished_at TEXT,
  UNIQUE (run_id, ord)
);
CREATE TABLE usage_records (
  id TEXT PRIMARY KEY,
  brand_id TEXT, run_id TEXT, step TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL, model TEXT NOT NULL, purpose TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0, web_searches INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Integrations: metadata only. Secrets live in the separate encrypted secrets table.
CREATE TABLE integrations (
  id TEXT PRIMARY KEY, -- connector id
  status TEXT NOT NULL,
  account_label TEXT NOT NULL DEFAULT '',
  scopes_json TEXT NOT NULL DEFAULT '[]',
  connected_at TEXT, last_sync_at TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE TABLE secrets (
  name TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, tag TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);

-- Immutable audit log: approvals, status changes, publish, delete, connection & permission changes.
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  brand_id TEXT,
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  from_state TEXT NOT NULL DEFAULT '', to_state TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events
  WHEN (SELECT value_json FROM settings WHERE key = '__audit_purge_brand') IS NOT OLD.brand_id
  BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

CREATE INDEX idx_ideas_brand ON ideas(brand_id, status);
CREATE INDEX idx_content_brand ON content_items(brand_id, status);
CREATE INDEX idx_variants_item ON content_variants(content_item_id, version);
CREATE INDEX idx_calendar_brand ON calendar_entries(brand_id, scheduled_at);
CREATE INDEX idx_evidence_brand ON evidence_items(brand_id);
CREATE INDEX idx_snapshots_brand ON analytics_snapshots(brand_id, platform);
CREATE INDEX idx_runs_brand ON agent_runs(brand_id, created_at);
CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id);
`,
  },
];
