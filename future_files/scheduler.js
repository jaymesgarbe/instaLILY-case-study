/**
 * scheduler.js
 *
 * Nightly batch worker that pre-generates enrichment briefs for all active leads.
 * Runs via node-cron or can be triggered externally (e.g. Cloud Scheduler → Cloud Run job).
 *
 * Strategy: process leads in priority order (highest lead score first),
 * with concurrency limiting to avoid rate-limit exhaustion on either API.
 */

require("dotenv").config({ path: "../.env" });
const cron = require("node-cron");
const { Pool } = require("pg");
const { enrichContractor } = require("../enrichment");
const { getCache, setCache } = require("../utils/cache");
const logger = require("../utils/logger");

const db = new Pool({ connectionString: process.env.DATABASE_URL });

const BATCH_CONCURRENCY = 3;   // parallel enrichments at once
const BATCH_DELAY_MS   = 1200; // ms between batches (rate limit buffer)
const CACHE_TTL        = parseInt(process.env.ENRICHMENT_CACHE_TTL) || 21600;

// ─── Core Batch Runner ────────────────────────────────────────────────────────

async function runEnrichmentBatch() {
  logger.info("[Scheduler] Starting nightly enrichment batch");

  let contractors;
  try {
    const result = await db.query(`
      SELECT c.*, 
             e.generated_at as last_enriched
      FROM   contractors c
      LEFT   JOIN enrichments e ON e.contractor_id = c.id
                                AND e.generated_at > NOW() - INTERVAL '6 hours'
      WHERE  c.active = true
        AND  e.contractor_id IS NULL     -- not yet enriched in last 6h
      ORDER  BY c.lead_score DESC        -- highest value leads first
      LIMIT  500
    `);
    contractors = result.rows;
  } catch (err) {
    logger.error("[Scheduler] DB query failed:", err.message);
    return;
  }

  logger.info(`[Scheduler] ${contractors.length} contractors queued for enrichment`);
  if (contractors.length === 0) return;

  let succeeded = 0;
  let failed = 0;

  // Process in chunks of BATCH_CONCURRENCY
  for (let i = 0; i < contractors.length; i += BATCH_CONCURRENCY) {
    const chunk = contractors.slice(i, i + BATCH_CONCURRENCY);

    const results = await Promise.allSettled(
      chunk.map((contractor) => processSingle(contractor))
    );

    for (const result of results) {
      if (result.status === "fulfilled") succeeded++;
      else {
        failed++;
        logger.error("[Scheduler] Enrichment failed:", result.reason?.message);
      }
    }

    // Throttle between batches
    if (i + BATCH_CONCURRENCY < contractors.length) {
      await sleep(BATCH_DELAY_MS);
    }

    logger.info(`[Scheduler] Progress: ${Math.min(i + BATCH_CONCURRENCY, contractors.length)}/${contractors.length}`);
  }

  logger.info(`[Scheduler] Batch complete. Succeeded: ${succeeded}, Failed: ${failed}`);
}

async function processSingle(contractor) {
  // Check Redis cache first — skip if recently enriched
  const cacheKey = `enrichment:${contractor.id}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    logger.info(`[Scheduler] Cache hit for ${contractor.id}, skipping`);
    return;
  }

  const enrichment = await enrichContractor(contractor);

  // Persist to Postgres
  await db.query(
    `INSERT INTO enrichments (contractor_id, generated_at, pipeline_ms, research_modules, brief)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (contractor_id) 
     DO UPDATE SET generated_at = $2, pipeline_ms = $3, research_modules = $4, brief = $5`,
    [
      contractor.id,
      enrichment.generatedAt,
      enrichment.pipelineMs,
      enrichment.researchModulesReturned,
      JSON.stringify(enrichment.brief),
    ]
  );

  // Write to Redis cache
  await setCache(cacheKey, enrichment, CACHE_TTL);
}

// ─── Cron Schedule ────────────────────────────────────────────────────────────

// Run at 2am every night
cron.schedule("0 2 * * *", () => {
  runEnrichmentBatch().catch((err) =>
    logger.error("[Scheduler] Unhandled batch error:", err.message)
  );
});

logger.info("[Scheduler] Nightly enrichment cron registered (2:00 AM daily)");

// ─── Manual trigger (dev/staging) ────────────────────────────────────────────
if (process.argv.includes("--run-now")) {
  runEnrichmentBatch()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error(err);
      process.exit(1);
    });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
