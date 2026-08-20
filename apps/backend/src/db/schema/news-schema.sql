CREATE TABLE IF NOT EXISTS news_articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  summary TEXT,
  body TEXT,
  body_blocks_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published', 'archived')),
  sport_id TEXT,
  competition_id TEXT,
  team_id TEXT,
  country_id TEXT,
  match_id TEXT,
  source_id TEXT,
  source_name TEXT,
  source_url TEXT,
  external_id TEXT,
  author TEXT,
  categories_json TEXT,
  tags_json TEXT,
  content_availability TEXT,
  content_origin TEXT,
  fetched_body TEXT,
  fetched_at TEXT,
  fetch_status TEXT,
  fetch_error TEXT,
  created_by TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (sport_id) REFERENCES sports(id),
  FOREIGN KEY (competition_id) REFERENCES competitions(id),
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (country_id) REFERENCES countries(id),
  FOREIGN KEY (match_id) REFERENCES matches(id),
  FOREIGN KEY (source_id) REFERENCES news_sources(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES operator_users(id)
);

CREATE INDEX IF NOT EXISTS idx_news_articles_status ON news_articles(status);
CREATE INDEX IF NOT EXISTS idx_news_articles_sport ON news_articles(sport_id);
CREATE INDEX IF NOT EXISTS idx_news_articles_competition ON news_articles(competition_id);
CREATE INDEX IF NOT EXISTS idx_news_articles_team ON news_articles(team_id);
CREATE INDEX IF NOT EXISTS idx_news_articles_match ON news_articles(match_id);
CREATE INDEX IF NOT EXISTS idx_news_articles_created_at ON news_articles(created_at);
CREATE INDEX IF NOT EXISTS idx_news_articles_published_at ON news_articles(published_at);
CREATE INDEX IF NOT EXISTS idx_news_articles_source_external_id ON news_articles(source_id, external_id);

CREATE TABLE IF NOT EXISTS news_article_categories (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  category_type TEXT NOT NULL CHECK (category_type IN ('sport', 'country', 'team', 'competition', 'match')),
  entity_id TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 100,
  reason TEXT,
  classification_source TEXT NOT NULL DEFAULT 'editorial',
  classification_status TEXT NOT NULL DEFAULT 'approved' CHECK (classification_status IN ('suggested', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE,
  UNIQUE(article_id, category_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_news_article_categories_article ON news_article_categories(article_id);
CREATE INDEX IF NOT EXISTS idx_news_article_categories_type ON news_article_categories(category_type);
CREATE INDEX IF NOT EXISTS idx_news_article_categories_entity ON news_article_categories(entity_id);
CREATE INDEX IF NOT EXISTS idx_news_article_categories_approved_entity ON news_article_categories(category_type, entity_id, classification_status);

CREATE TABLE IF NOT EXISTS news_article_media (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video', 'embed')),
  url TEXT NOT NULL,
  alt_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_news_article_media_article ON news_article_media(article_id);

CREATE TABLE IF NOT EXISTS news_article_links (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  url TEXT NOT NULL,
  label TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_news_article_links_article ON news_article_links(article_id);

CREATE TABLE IF NOT EXISTS news_article_audit (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_news_article_audit_article ON news_article_audit(article_id);

CREATE TABLE IF NOT EXISTS news_article_research_results (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  query TEXT NOT NULL,
  research_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE,
  UNIQUE(article_id)
);

CREATE INDEX IF NOT EXISTS idx_news_article_research_results_article ON news_article_research_results(article_id);

CREATE TABLE IF NOT EXISTS news_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'external' CHECK (source_type IN ('external', 'partner', 'wire', 'internal')),
  base_url TEXT,
  feed_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  collection_interval_minutes INTEGER NOT NULL DEFAULT 60,
  last_collection_attempt_at TEXT,
  last_collection_succeeded_at TEXT,
  last_collection_error TEXT,
  last_collection_discovered_count INTEGER,
  last_collection_new_count INTEGER,
  last_collection_duplicate_count INTEGER,
  rights_status TEXT DEFAULT 'unknown' CHECK (rights_status IN ('unknown', 'full_republication_permitted', 'republication_permitted_with_conditions', 'limited_use_only', 'republication_not_permitted', 'review_required')),
  rights_last_checked_at TEXT,
  rights_review_notes TEXT,
  rights_administrator_decision TEXT,
  rights_decision_at TEXT,
  rights_audit_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_news_sources_enabled ON news_sources(enabled);
CREATE INDEX IF NOT EXISTS idx_news_sources_name ON news_sources(name);
CREATE INDEX IF NOT EXISTS idx_news_sources_rights_status ON news_sources(rights_status);

CREATE TABLE IF NOT EXISTS news_generated_rss_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  feed_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_fetched_at TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  discovered_article_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  crawler_tier TEXT NOT NULL DEFAULT 'http',
  failure_classification TEXT
);

CREATE TABLE IF NOT EXISTS news_generated_rss_articles (
  id TEXT PRIMARY KEY,
  generated_feed_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  article_url TEXT NOT NULL,
  published_at TEXT,
  discovered_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'discovered',
  FOREIGN KEY (generated_feed_id) REFERENCES news_generated_rss_sources(id) ON DELETE CASCADE,
  UNIQUE(generated_feed_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_news_generated_rss_articles_feed ON news_generated_rss_articles(generated_feed_id);

CREATE TABLE IF NOT EXISTS news_source_rights_audits (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'full_republication_permitted', 'republication_permitted_with_conditions', 'limited_use_only', 'republication_not_permitted', 'review_required')),
  summary TEXT,
  review_notes TEXT,
  administrator_decision TEXT,
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES news_sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS news_source_rights_evidence (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL,
  evidence_url TEXT NOT NULL,
  page_title TEXT,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('rss_terms', 'terms_of_use', 'copyright_policy', 'republication_policy', 'syndication', 'licensing', 'other')),
  evidence_domain TEXT,
  evidence_origin TEXT,
  matched_rule TEXT,
  snippet TEXT,
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (audit_id) REFERENCES news_source_rights_audits(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS news_source_rights_permissions (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('full_article_republication', 'headline', 'summary_excerpt', 'original_link_reference', 'commercial_use', 'modification', 'attribution', 'image_reuse', 'video_reuse', 'ai_assisted_original_story')),
  allowed INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  evidence_url TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (audit_id) REFERENCES news_source_rights_audits(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_news_source_rights_audits_source ON news_source_rights_audits(source_id);
CREATE INDEX IF NOT EXISTS idx_news_source_rights_evidence_audit ON news_source_rights_evidence(audit_id);
CREATE INDEX IF NOT EXISTS idx_news_source_rights_permissions_audit ON news_source_rights_permissions(audit_id);
