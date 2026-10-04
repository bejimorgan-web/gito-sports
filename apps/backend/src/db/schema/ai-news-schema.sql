CREATE TABLE IF NOT EXISTS ai_tasks (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL CHECK (task_type IN (
    'story_understanding', 'story_clustering', 'research', 'claim_extraction',
    'claim_verification', 'article_generation', 'article_validation', 'editor_assistance'
  )),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  news_article_id TEXT,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  failure_code TEXT,
  failure_message TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost REAL,
  currency TEXT,
  provider_usage_json TEXT,
  FOREIGN KEY (news_article_id) REFERENCES news_articles(id) ON DELETE SET NULL,
  UNIQUE (actor_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_tasks_article_created
  ON ai_tasks(news_article_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_status_created
  ON ai_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_correlation
  ON ai_tasks(correlation_id);

CREATE TABLE IF NOT EXISTS ai_generations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE,
  news_article_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  output_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES ai_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (news_article_id) REFERENCES news_articles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_generations_article_created
  ON ai_generations(news_article_id, created_at);

CREATE TABLE IF NOT EXISTS ai_research_sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE,
  article_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','completed_with_source_failures','failed','cancelled')),
  prompt_version TEXT NOT NULL,
  query_summary TEXT NOT NULL,
  discovery_provider TEXT NOT NULL,
  retrieval_provider TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  failure_code TEXT,
  failure_message TEXT,
  FOREIGN KEY (task_id) REFERENCES ai_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_research_sessions_article_created ON ai_research_sessions(article_id, created_at);

CREATE TABLE IF NOT EXISTS ai_research_sources (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  source_title TEXT,
  publisher TEXT,
  author TEXT,
  published_at TEXT,
  discovered_at TEXT NOT NULL,
  retrieved_at TEXT,
  http_status INTEGER,
  content_type TEXT,
  source_type TEXT NOT NULL DEFAULT 'unknown' CHECK (source_type IN ('official','primary','news','interview','database','social','reference','unknown')),
  retrieval_status TEXT NOT NULL CHECK (retrieval_status IN ('discovered','retrieved','failed')),
  content_hash TEXT,
  snapshot_text TEXT,
  retrieval_provider TEXT NOT NULL,
  discovery_provider TEXT NOT NULL,
  retrieval_metadata_json TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  FOREIGN KEY (session_id) REFERENCES ai_research_sessions(id) ON DELETE CASCADE,
  UNIQUE (session_id, canonical_url)
);
CREATE INDEX IF NOT EXISTS idx_ai_research_sources_session ON ai_research_sources(session_id, discovered_at);

CREATE TABLE IF NOT EXISTS ai_research_evidence (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  evidence_text TEXT NOT NULL,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('source_statement','context','other')),
  location_json TEXT NOT NULL,
  extraction_confidence REAL,
  extracted_at TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES ai_research_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES ai_research_sources(id) ON DELETE CASCADE,
  CHECK (extraction_confidence IS NULL OR (extraction_confidence >= 0 AND extraction_confidence <= 1))
);
CREATE INDEX IF NOT EXISTS idx_ai_research_evidence_session ON ai_research_evidence(session_id, extracted_at);
CREATE INDEX IF NOT EXISTS idx_ai_research_evidence_source ON ai_research_evidence(source_id);

CREATE TABLE IF NOT EXISTS ai_claims (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  claim_type TEXT NOT NULL CHECK (claim_type IN ('event','result','fixture','transfer','injury','availability','appointment','statement','statistic','date','location','disciplinary','competition','roster','other')),
  source_context TEXT,
  subject_entities_json TEXT NOT NULL,
  temporal_context_json TEXT NOT NULL,
  extraction_confidence REAL CHECK (extraction_confidence IS NULL OR (extraction_confidence >= 0 AND extraction_confidence <= 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE,
  UNIQUE(article_id, identity_key, claim_type)
);
CREATE INDEX IF NOT EXISTS idx_ai_claims_article_type ON ai_claims(article_id, claim_type);

CREATE TABLE IF NOT EXISTS ai_claim_provenance (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  origin_type TEXT NOT NULL CHECK (origin_type IN ('source_article','story_understanding','research','editor_instruction')),
  task_id TEXT,
  generation_id TEXT,
  research_session_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES ai_claims(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES ai_tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (generation_id) REFERENCES ai_generations(id) ON DELETE SET NULL,
  FOREIGN KEY (research_session_id) REFERENCES ai_research_sessions(id) ON DELETE SET NULL,
  UNIQUE(claim_id, origin_type, task_id, generation_id, research_session_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_claim_provenance_session ON ai_claim_provenance(research_session_id);

CREATE TABLE IF NOT EXISTS ai_verification_requests (
  task_id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  research_session_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES ai_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (claim_id) REFERENCES ai_claims(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (research_session_id) REFERENCES ai_research_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_verification_assessments (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  research_session_id TEXT NOT NULL,
  task_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('supported','contradicted','insufficient_evidence','conflicting_sources','unresolved')),
  explanation TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  confidence_semantics TEXT NOT NULL CHECK (confidence_semantics = 'assessment_reliability_not_truth_probability'),
  temporal_status TEXT NOT NULL CHECK (temporal_status IN ('not_time_sensitive','applicable','uncertain')),
  temporal_warnings_json TEXT NOT NULL,
  evidence_set_size INTEGER NOT NULL CHECK (evidence_set_size >= 0),
  rules_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES ai_claims(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (research_session_id) REFERENCES ai_research_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES ai_tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_verification_assessments_claim_created ON ai_verification_assessments(claim_id, created_at);

CREATE TABLE IF NOT EXISTS ai_verification_evidence_set (
  assessment_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  content_hash TEXT,
  content_identity TEXT,
  source_published_at TEXT,
  retrieved_at TEXT,
  PRIMARY KEY (assessment_id, evidence_id),
  FOREIGN KEY (assessment_id) REFERENCES ai_verification_assessments(id) ON DELETE CASCADE,
  FOREIGN KEY (evidence_id) REFERENCES ai_research_evidence(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES ai_research_sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_claim_evidence (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('supporting','contradicting','contextual','insufficient')),
  directness TEXT NOT NULL CHECK (directness IN ('direct','indirect','unclear')),
  assessment_confidence REAL NOT NULL CHECK (assessment_confidence >= 0 AND assessment_confidence <= 1),
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (assessment_id) REFERENCES ai_verification_assessments(id) ON DELETE CASCADE,
  FOREIGN KEY (claim_id) REFERENCES ai_claims(id) ON DELETE CASCADE,
  FOREIGN KEY (evidence_id) REFERENCES ai_research_evidence(id) ON DELETE CASCADE,
  UNIQUE(assessment_id, evidence_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_claim_evidence_claim ON ai_claim_evidence(claim_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_claim_evidence_source_evidence ON ai_claim_evidence(evidence_id);

CREATE TABLE IF NOT EXISTS ai_article_generation_requests (
  task_id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  research_session_id TEXT NOT NULL,
  article_type TEXT NOT NULL CHECK (article_type IN ('news_report','match_preview','match_recap','transfer_update','injury_update','team_update','competition_update','explainer')),
  editor_instruction TEXT,
  requested_length INTEGER,
  tone TEXT NOT NULL,
  headline_options INTEGER NOT NULL DEFAULT 0 CHECK (headline_options BETWEEN 0 AND 5),
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES ai_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (research_session_id) REFERENCES ai_research_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_article_generation_requests_article_actor ON ai_article_generation_requests(article_id, actor_id, created_at);

CREATE TABLE IF NOT EXISTS ai_article_generation_context (
  task_id TEXT NOT NULL,
  context_type TEXT NOT NULL CHECK (context_type IN ('story_generation','research_task','research_session','source','evidence','claim','verification_assessment')),
  context_id TEXT NOT NULL,
  PRIMARY KEY (task_id, context_type, context_id),
  FOREIGN KEY (task_id) REFERENCES ai_article_generation_requests(task_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_article_generation_context_lookup ON ai_article_generation_context(context_type, context_id);

CREATE TABLE IF NOT EXISTS ai_generated_article_versions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  task_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  sections_json TEXT NOT NULL,
  output_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'needs_review' CHECK (review_state = 'needs_review'),
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES ai_article_generation_requests(task_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_generated_article_versions_article ON ai_generated_article_versions(article_id, created_at DESC);
