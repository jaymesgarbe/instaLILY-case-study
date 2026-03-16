/**
 * server.js
 *
 * RoofIQ enrichment API server.
 * Exposes endpoints the React frontend calls for lead data and AI briefs.
 *
 * Production: deploy to Cloud Run or Fly.io behind a load balancer.
 * The scheduler worker runs as a separate Cloud Run Job on cron.
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const { enrichContractor } = require("./worker/enrichment");
const { getCache, setCache } = require("./utils/cache");
const logger = require("./utils/logger");

const app = express();
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const CACHE_TTL = parseInt(process.env.ENRICHMENT_CACHE_TTL) || 21600;

app.use(cors());
app.use(express.json());

// ─── Request logging middleware ───────────────────────────────────────────────

app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/leads
 * Returns paginated, filterable contractor list with lead scores.
 */
app.get("/api/leads", async (req, res) => {
  const {
    zip = "10013",
    distance = 25,
    cert_level,
    sort = "lead_score",
    order = "desc",
    limit = 50,
    offset = 0,
  } = req.query;

  const ALLOWED_SORT = ["lead_score", "rating", "distance_miles", "review_count", "years_in_business"];
  const safeSort  = ALLOWED_SORT.includes(sort) ? sort : "lead_score";
  const safeOrder = order === "asc" ? "ASC" : "DESC";

  const params = [zip, distance, limit, offset];
  const certClause = cert_level ? `AND cert_level = $${params.push(cert_level)}` : "";

  const { rows } = await db.query(
    `SELECT id, name, cert_level, city, state, zip, phone, website,
            distance_miles, years_in_business, review_count, rating,
            specialties, employees, lead_score, status, recent_projects
     FROM   contractors
     WHERE  active = true
       AND  home_zip = $1
       AND  distance_miles <= $2
       ${certClause}
     ORDER  BY ${safeSort} ${safeOrder}
     LIMIT  $3 OFFSET $4`,
    params
  );

  const countResult = await db.query(
    `SELECT COUNT(*) FROM contractors WHERE active = true AND home_zip = $1 AND distance_miles <= $2`,
    [zip, distance]
  );

  res.json({
    total: parseInt(countResult.rows[0].count),
    leads: rows,
  });
});

/**
 * GET /api/leads/:id/enrichment
 * Returns cached enrichment brief or generates one on demand.
 *
 * Cache hierarchy:
 *   1. Redis (fastest — sub-millisecond for pre-generated)
 *   2. Postgres (persisted, survives Redis flush)
 *   3. Live generation (fallback — adds ~6-10s latency)
 */
app.get("/api/leads/:id/enrichment", async (req, res) => {
  const { id } = req.params;
  const cacheKey = `enrichment:${id}`;

  // 1. Redis cache
  const cached = await getCache(cacheKey);
  if (cached) {
    logger.info(`[API] Cache hit for ${id}`);
    return res.json({ source: "cache", ...cached });
  }

  // 2. Postgres
  const dbResult = await db.query(
    `SELECT brief, generated_at, pipeline_ms 
     FROM enrichments 
     WHERE contractor_id = $1 
       AND generated_at > NOW() - INTERVAL '6 hours'
     ORDER BY generated_at DESC 
     LIMIT 1`,
    [id]
  );

  if (dbResult.rows.length > 0) {
    const row = dbResult.rows[0];
    const payload = { brief: row.brief, generatedAt: row.generated_at, pipelineMs: row.pipeline_ms };
    await setCache(cacheKey, payload, CACHE_TTL);
    logger.info(`[API] DB hit for ${id}`);
    return res.json({ source: "db", ...payload });
  }

  // 3. Live generation
  logger.info(`[API] Cache miss — generating live for ${id}`);
  const contractorResult = await db.query(
    "SELECT * FROM contractors WHERE id = $1",
    [id]
  );

  if (contractorResult.rows.length === 0) {
    return res.status(404).json({ error: "Contractor not found" });
  }

  const contractor = contractorResult.rows[0];
  const enrichment = await enrichContractor(contractor);

  // Persist async (don't block response)
  db.query(
    `INSERT INTO enrichments (contractor_id, generated_at, pipeline_ms, research_modules, brief)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (contractor_id) DO UPDATE 
     SET generated_at = $2, pipeline_ms = $3, research_modules = $4, brief = $5`,
    [id, enrichment.generatedAt, enrichment.pipelineMs, enrichment.researchModulesReturned, JSON.stringify(enrichment.brief)]
  ).catch((err) => logger.error("[API] Failed to persist enrichment:", err.message));

  await setCache(cacheKey, enrichment, CACHE_TTL);
  return res.json({ source: "live", ...enrichment });
});

/**
 * PATCH /api/leads/:id/status
 * Updates lead pipeline status (new → contacted → qualified → proposal).
 * In production: also writes to lead_events audit log.
 */
app.patch("/api/leads/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status, rep_id } = req.body;

  const VALID_STATUSES = ["new", "contacted", "qualified", "proposal", "closed_won", "closed_lost"];
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  await db.query("UPDATE contractors SET status = $1 WHERE id = $2", [status, id]);
  await db.query(
    "INSERT INTO lead_events (contractor_id, rep_id, event_type, created_at) VALUES ($1, $2, $3, NOW())",
    [id, rep_id || null, status]
  );

  res.json({ success: true, id, status });
});

/**
 * GET /api/health
 */
app.get("/api/health", (_req, res) => res.json({ status: "ok", ts: new Date().toISOString() }));

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  logger.error("[Server] Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => logger.info(`[Server] RoofIQ API listening on :${PORT}`));
