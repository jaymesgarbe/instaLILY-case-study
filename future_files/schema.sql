-- RoofIQ Database Schema
-- Run once to initialize. Production: use a migration tool (Flyway, node-pg-migrate).

-- ─── Contractors ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contractors (
  id                VARCHAR(20)  PRIMARY KEY,  -- e.g. "c001"
  name              TEXT         NOT NULL,
  cert_level        VARCHAR(20)  NOT NULL CHECK (cert_level IN ('master_elite','certified_plus','certified')),
  address           TEXT,
  city              TEXT,
  state             CHAR(2),
  zip               VARCHAR(10),
  home_zip          VARCHAR(10),               -- search origin zip
  phone             VARCHAR(20),
  website           TEXT,
  distance_miles    NUMERIC(5,1),
  years_in_business INTEGER,
  review_count      INTEGER,
  rating            NUMERIC(2,1),
  specialties       TEXT[],
  employees         VARCHAR(20),
  lead_score        INTEGER CHECK (lead_score BETWEEN 0 AND 100),
  status            VARCHAR(20)  DEFAULT 'new',
  recent_projects   INTEGER      DEFAULT 0,
  active            BOOLEAN      DEFAULT true,
  first_seen_at     TIMESTAMPTZ  DEFAULT NOW(),
  last_updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractors_home_zip    ON contractors (home_zip);
CREATE INDEX IF NOT EXISTS idx_contractors_lead_score  ON contractors (lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_contractors_cert_level  ON contractors (cert_level);
CREATE INDEX IF NOT EXISTS idx_contractors_status      ON contractors (status);

-- ─── Enrichments ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enrichments (
  id                SERIAL       PRIMARY KEY,
  contractor_id     VARCHAR(20)  NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  generated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  pipeline_ms       INTEGER,
  research_modules  INTEGER,     -- how many Perplexity modules returned
  brief             JSONB        NOT NULL,
  UNIQUE (contractor_id)         -- one current enrichment per contractor
);

CREATE INDEX IF NOT EXISTS idx_enrichments_generated  ON enrichments (generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrichments_contractor ON enrichments (contractor_id);

-- ─── Lead Events (audit log) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_events (
  id            SERIAL       PRIMARY KEY,
  contractor_id VARCHAR(20)  NOT NULL REFERENCES contractors(id),
  rep_id        VARCHAR(50),
  event_type    VARCHAR(30)  NOT NULL,  -- new, contacted, qualified, proposal, closed_won, closed_lost
  notes         TEXT,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_events_contractor ON lead_events (contractor_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_rep        ON lead_events (rep_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_created    ON lead_events (created_at DESC);

-- ─── Sales Reps (multi-tenant) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reps (
  id            VARCHAR(50)  PRIMARY KEY,
  name          TEXT         NOT NULL,
  email         TEXT         UNIQUE NOT NULL,
  territory_zip VARCHAR(10),
  region        VARCHAR(50),
  active        BOOLEAN      DEFAULT true,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);
