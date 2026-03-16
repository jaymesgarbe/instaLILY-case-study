/**
 * enrichment.js
 * 
 * Two-stage AI enrichment pipeline:
 *   Stage 1 — Perplexity: live web research (reviews, presence, news, weather)
 *   Stage 2 — Claude: synthesize structured sales brief from profile + research
 *
 * Designed to run as an on-demand API handler or a pre-generation batch worker.
 */

const logger = require("../utils/logger");

// ─── Stage 1: Perplexity Research ────────────────────────────────────────────

/**
 * Builds four targeted Perplexity queries in parallel for a contractor.
 * Each query is scoped tightly to minimize noise and token usage.
 */
async function fetchPerplexityResearch(contractor) {
  const { name, city, state, zip } = contractor;
  const location = `${city}, ${state}`;

  const queries = [
    {
      key: "reviewSentiment",
      prompt: `Summarize recent customer reviews and reputation for "${name}", a roofing contractor in ${location}. 
               Include overall sentiment, recurring praise or complaints, and any BBB rating or disputes. 
               Be concise and factual.`,
    },
    {
      key: "webPresence",
      prompt: `Evaluate the online presence and business activity of "${name}" roofing contractor in ${location}. 
               Check for: active website, Google Business profile, social media accounts (Facebook, Instagram, Nextdoor), 
               and frequency of recent posts or updates. Indicate if they appear active or dormant.`,
    },
    {
      key: "newsAndComplaints",
      prompt: `Find any news articles, legal actions, licensing issues, or notable mentions of "${name}" roofing 
               contractor in ${location}. Include contractor license status if findable. 
               Flag any red flags or positive press.`,
    },
    {
      key: "stormActivity",
      prompt: `What major weather events (hail, wind, hurricanes, nor'easters) have impacted the ${location} 
               metro area (zip ${zip}) in the past 90 days? Summarize which events would drive 
               residential roofing demand and replacement activity.`,
    },
  ];

  const results = await Promise.allSettled(
    queries.map(({ key, prompt }) =>
      callPerplexity(prompt).then((text) => ({ key, text }))
    )
  );

  const research = {};
  for (const result of results) {
    if (result.status === "fulfilled") {
      research[result.value.key] = result.value.text;
    } else {
      logger.warn(`Perplexity query failed: ${result.reason?.message}`);
    }
  }

  return research;
}

async function callPerplexity(prompt) {
  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        {
          role: "system",
          content:
            "You are a B2B sales research assistant. Be factual, concise, and cite sources where possible. " +
            "If you cannot find specific information, say so clearly rather than guessing.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 512,
      temperature: 0.2, // low temp for factual research
      return_citations: true,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Perplexity API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ─── Stage 2: Claude Synthesis ───────────────────────────────────────────────

/**
 * Takes the structured contractor profile + raw Perplexity research and
 * produces a single, blended, actionable sales brief via Claude.
 */
async function synthesizeWithClaude(contractor, research) {
  const researchBlock = Object.entries(research)
    .map(([key, text]) => `### ${RESEARCH_LABELS[key] || key}\n${text}`)
    .join("\n\n");

  const prompt = `You are a senior B2B sales intelligence analyst for a roofing materials distributor 
based in NYC (zip 10013). Your job is to produce concise, actionable account briefs that help 
sales reps open conversations and close distribution agreements with roofing contractors.

## Contractor Profile (GAF Directory)
- Name: ${contractor.name}
- Location: ${contractor.city}, ${contractor.state} ${contractor.zip} (${contractor.distance} miles from warehouse)
- GAF Certification: ${contractor.certLevel.replace(/_/g, " ")}
- Years in business: ${contractor.yearsInBusiness}
- Rating: ${contractor.rating}/5 (${contractor.reviewCount} reviews)
- Specialties: ${contractor.specialties.join(", ")}
- Employees: ${contractor.employees}
- Recent project activity: ${contractor.recentProjects} jobs in last 90 days
- Lead score: ${contractor.leadScore}/100

## Live Research (Perplexity — sourced from the web)
${researchBlock}

## Instructions
Synthesize the profile AND live research into a single cohesive sales brief. 
Where research confirms or contradicts the profile, note it.
Where storm activity is relevant, tie it to urgency.
Respond ONLY with valid JSON — no markdown fences, no preamble.

Return exactly this schema:
{
  "executiveSummary": "3-4 sentence account opportunity summary blending profile + live research",
  "talkingPoints": ["point1", "point2", "point3", "point4"],
  "painPoints": ["pain1", "pain2", "pain3"],
  "recommendedProducts": ["product1 with brief rationale", "product2 with brief rationale", "product3 with brief rationale"],
  "openingLine": "opening sentence of a personalized cold outreach email referencing something specific from the research",
  "riskFactors": ["risk1", "risk2"],
  "bestTimeToCall": "timing recommendation based on contractor type and activity level",
  "marketContext": "1-2 sentences on local storm/weather demand signals relevant to this territory",
  "onlinePresenceSummary": "1 sentence assessment of their digital footprint",
  "reputationSignal": "positive | mixed | negative | unknown",
  "urgencyLevel": "high | medium | low",
  "researchConfidence": "high | medium | low"
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.content[0].text;
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ─── Main Pipeline Entry Point ────────────────────────────────────────────────

/**
 * Full enrichment pipeline: profile → Perplexity research → Claude brief.
 * Called by the API handler or the batch scheduler.
 *
 * @param {Object} contractor - Contractor profile object
 * @returns {Object} Enriched sales brief
 */
async function enrichContractor(contractor) {
  logger.info(`[Enrichment] Starting pipeline for ${contractor.name} (${contractor.id})`);
  const startTime = Date.now();

  logger.info(`[Enrichment] Stage 1: Perplexity research for ${contractor.id}`);
  const research = await fetchPerplexityResearch(contractor);
  logger.info(`[Enrichment] Perplexity returned ${Object.keys(research).length}/4 research modules`);

  logger.info(`[Enrichment] Stage 2: Claude synthesis for ${contractor.id}`);
  const brief = await synthesizeWithClaude(contractor, research);

  const elapsed = Date.now() - startTime;
  logger.info(`[Enrichment] Pipeline complete for ${contractor.id} in ${elapsed}ms`);

  return {
    contractorId: contractor.id,
    generatedAt: new Date().toISOString(),
    pipelineMs: elapsed,
    researchModulesReturned: Object.keys(research).length,
    brief,
  };
}

const RESEARCH_LABELS = {
  reviewSentiment: "Customer Reviews & Reputation",
  webPresence: "Web Presence & Social Activity",
  newsAndComplaints: "News Mentions & Licensing",
  stormActivity: "Local Storm & Weather Demand Signals",
};

module.exports = { enrichContractor };
