/**
 * server.js — RoofIQ server with live Perplexity-powered GAF ingestion
 *
 * Lead data flows:
 *   Boot        → hardcoded seed data (instant, always available)
 *   POST /api/ingest → Perplexity queries GAF contractors near zip 10013
 *                      → Claude structures + scores each contractor
 *                      → live data replaces seed in memory
 */

require("dotenv").config();
const express = require("express");
const cors    = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ─── In-memory stores ─────────────────────────────────────────────────────────
const enrichmentCache = new Map();
const statusStore     = new Map();

let ingestionStatus = { state: "idle", startedAt: null, completedAt: null, count: 0, error: null };

// ─── Seed data (fallback while live data loads) ───────────────────────────────
const SEED_CONTRACTORS = [
  {id:"c001",name:"Empire State Roofing Co.",certLevel:"master_elite",address:"245 W 35th St",city:"New York",state:"NY",zip:"10001",phone:"(212) 555-0147",website:"www.empirestateroof.com",distance:1.8,yearsInBusiness:24,reviewCount:187,rating:4.9,specialties:["Residential","Metal Roofing","FORTIFIED Roof"],employees:"25–50",leadScore:94,status:"new",recentProjects:12,source:"seed"},
  {id:"c002",name:"Brooklyn Heights Roofing",certLevel:"master_elite",address:"780 Atlantic Ave",city:"Brooklyn",state:"NY",zip:"11238",phone:"(718) 555-0293",website:"www.bkheightsroofing.com",distance:4.2,yearsInBusiness:18,reviewCount:142,rating:4.8,specialties:["Residential","Historic Buildings","Slate"],employees:"15–25",leadScore:88,status:"new",recentProjects:8,source:"seed"},
  {id:"c003",name:"Tri-State Roofing Solutions",certLevel:"master_elite",address:"1150 E Ridgewood Ave",city:"Ridgewood",state:"NJ",zip:"07450",phone:"(201) 555-0381",website:"www.tristateroofing.net",distance:12.6,yearsInBusiness:31,reviewCount:224,rating:4.7,specialties:["Residential","Commercial","Storm Damage"],employees:"50–100",leadScore:91,status:"new",recentProjects:19,source:"seed"},
  {id:"c004",name:"Queens Pro Roofing",certLevel:"certified_plus",address:"89-12 Jamaica Ave",city:"Queens",state:"NY",zip:"11421",phone:"(718) 555-0462",website:"www.queensproroof.com",distance:6.8,yearsInBusiness:11,reviewCount:96,rating:4.6,specialties:["Residential","Flat Roofs","Solar Shingles"],employees:"10–15",leadScore:76,status:"new",recentProjects:6,source:"seed"},
  {id:"c005",name:"Bronx All-Weather Roofing",certLevel:"certified_plus",address:"1745 Morris Ave",city:"Bronx",state:"NY",zip:"10453",phone:"(718) 555-0529",website:"www.bronxallweather.com",distance:9.3,yearsInBusiness:16,reviewCount:78,rating:4.5,specialties:["Residential","Multi-Family","Flat Roofs"],employees:"10–15",leadScore:72,status:"new",recentProjects:5,source:"seed"},
  {id:"c006",name:"Long Island Premier Roofing",certLevel:"master_elite",address:"425 Sunrise Hwy",city:"West Islip",state:"NY",zip:"11795",phone:"(631) 555-0614",website:"www.lipremierroofing.com",distance:20.1,yearsInBusiness:27,reviewCount:198,rating:4.9,specialties:["Residential","FORTIFIED Roof","Metal Roofing","Solar"],employees:"25–50",leadScore:92,status:"new",recentProjects:14,source:"seed"},
  {id:"c007",name:"Hoboken Roofing & Restoration",certLevel:"certified_plus",address:"320 Observer Hwy",city:"Hoboken",state:"NJ",zip:"07030",phone:"(201) 555-0728",website:"www.hobokenroofing.com",distance:3.1,yearsInBusiness:9,reviewCount:61,rating:4.7,specialties:["Residential","Historic Buildings","Brownstones"],employees:"5–10",leadScore:69,status:"new",recentProjects:4,source:"seed"},
  {id:"c008",name:"Staten Island Roofing Pros",certLevel:"certified",address:"1847 Victory Blvd",city:"Staten Island",state:"NY",zip:"10314",phone:"(718) 555-0835",website:null,distance:11.4,yearsInBusiness:7,reviewCount:44,rating:4.3,specialties:["Residential","Gutters"],employees:"5–10",leadScore:54,status:"new",recentProjects:3,source:"seed"},
  {id:"c009",name:"Westchester Elite Roofing",certLevel:"master_elite",address:"500 Mamaroneck Ave",city:"White Plains",state:"NY",zip:"10605",phone:"(914) 555-0947",website:"www.westchestereliteroofing.com",distance:22.8,yearsInBusiness:20,reviewCount:156,rating:4.8,specialties:["Residential","Luxury Homes","Metal Roofing","FORTIFIED"],employees:"15–25",leadScore:89,status:"new",recentProjects:9,source:"seed"},
  {id:"c010",name:"Jersey City Roofing",certLevel:"certified",address:"234 Newark Ave",city:"Jersey City",state:"NJ",zip:"07302",phone:"(201) 555-1023",website:"www.jerseycityroofing.com",distance:2.9,yearsInBusiness:5,reviewCount:29,rating:4.2,specialties:["Residential","Commercial"],employees:"5–10",leadScore:48,status:"new",recentProjects:2,source:"seed"},
  {id:"c011",name:"Yonkers Roofing & Sheet Metal",certLevel:"certified_plus",address:"780 Central Park Ave",city:"Yonkers",state:"NY",zip:"10704",phone:"(914) 555-1147",website:"www.yonkersroofing.com",distance:16.3,yearsInBusiness:14,reviewCount:88,rating:4.6,specialties:["Residential","Commercial","Sheet Metal","Gutters"],employees:"15–25",leadScore:75,status:"new",recentProjects:7,source:"seed"},
  {id:"c012",name:"Nassau County Roofing Group",certLevel:"certified_plus",address:"1200 Old Country Rd",city:"Westbury",state:"NY",zip:"11590",phone:"(516) 555-1253",website:"www.nassauroofing.com",distance:18.7,yearsInBusiness:13,reviewCount:107,rating:4.5,specialties:["Residential","Storm Damage","Insurance Claims"],employees:"15–25",leadScore:78,status:"new",recentProjects:8,source:"seed"},
  {id:"c013",name:"Manhattan Premium Roofing",certLevel:"certified_plus",address:"540 W 148th St",city:"New York",state:"NY",zip:"10031",phone:"(212) 555-1364",website:"www.manhattanpremiumroofing.com",distance:5.5,yearsInBusiness:8,reviewCount:52,rating:4.4,specialties:["Residential","Brownstones","Multi-Family"],employees:"10–15",leadScore:67,status:"new",recentProjects:4,source:"seed"},
  {id:"c014",name:"Newark Roofing & Construction",certLevel:"certified",address:"89 Market St",city:"Newark",state:"NJ",zip:"07102",phone:"(973) 555-1478",website:null,distance:8.1,yearsInBusiness:4,reviewCount:18,rating:3.9,specialties:["Residential","Commercial"],employees:"1–5",leadScore:38,status:"new",recentProjects:1,source:"seed"}
];

// Live store — starts with seed, replaced by ingestion
let contractorStore = [...SEED_CONTRACTORS];
let contractorMap   = new Map(contractorStore.map(c => [c.id, c]));

// ─── Lead scoring formula ─────────────────────────────────────────────────────

function calculateLeadScore(contractor) {
  const certScore = { master_elite: 40, certified_plus: 25, certified: 10 };
  const cert      = certScore[contractor.certLevel] || 10;
  const rating    = Math.round(Math.max(0, (contractor.rating - 3.0) / 2.0) * 20);
  const reviews   = Math.min(Math.round(contractor.reviewCount / 10), 15);
  const tenure    = Math.min(Math.round(contractor.yearsInBusiness / 2), 10);
  const activity  = Math.min(Math.round((contractor.recentProjects || 0) * 1.5), 15);
  return Math.min(cert + rating + reviews + tenure + activity, 100);
}

// ─── Perplexity GAF ingestion ─────────────────────────────────────────────────

async function ingestContractorsFromPerplexity(zip = "10013", distance = 25) {
  console.log(`[Ingest] Querying Perplexity for GAF contractors near ${zip} (2 batches)...`);

  const schema = '{"name":"string","certLevel":"master_elite|certified_plus|certified","address":"string","city":"string","state":"2-letter","zip":"string","phone":"string|null","website":"string|null","distance":0,"yearsInBusiness":0,"reviewCount":0,"rating":0,"specialties":["string"],"employees":"string","recentProjects":0}';

  const makePrompt = (batch) => `Find real GAF-certified roofing contractors within ${distance} miles of zip ${zip} (NYC metro).
Use gaf.com/en-us/roofing-contractors/residential and public sources.
Return ONLY a valid JSON array of 8 contractors. No markdown, no preamble, no explanation.
Each object must match: ${schema}
Batch ${batch} of 2 — if batch 2, return different contractors than batch 1.
If real data is unavailable, estimate realistically.`;

  const [r1, r2] = await Promise.allSettled([
    callPerplexityRaw(makePrompt(1)),
    callPerplexityRaw(makePrompt(2)),
  ]);

  const seenNames = new Set();
  const contractors = [];
  for (const result of [r1, r2]) {
    if (result.status !== 'fulfilled') { console.warn('[Ingest] Batch failed:', result.reason?.message); continue; }
    try {
      const parsed = JSON.parse(result.value.replace(/```json|```/g, '').trim());
      if (!Array.isArray(parsed)) continue;
      for (const c of parsed) {
        const key = (c.name || '').toLowerCase().trim();
        if (key && !seenNames.has(key)) { seenNames.add(key); contractors.push(c); }
      }
    } catch(e) { console.warn('[Ingest] Parse failed:', e.message); }
  }

  if (contractors.length === 0) throw new Error('No contractors returned from either batch');
  console.log(`[Ingest] Perplexity returned ${contractors.length} contractors across 2 batches`);

  // Normalize, score, and assign stable IDs
  return contractors.map((c, i) => {
    const normalized = {
      id: `live-${String(i + 1).padStart(3, "0")}`,
      name: c.name || "Unknown Contractor",
      certLevel: ["master_elite","certified_plus","certified"].includes(c.certLevel) ? c.certLevel : "certified",
      address: c.address || "",
      city: c.city || "",
      state: c.state || "",
      zip: c.zip || "",
      phone: c.phone || null,
      website: c.website || null,
      distance: typeof c.distance === "number" ? c.distance : parseFloat(c.distance) || 0,
      yearsInBusiness: parseInt(c.yearsInBusiness) || 1,
      reviewCount: parseInt(c.reviewCount) || 0,
      rating: parseFloat(c.rating) || 4.0,
      specialties: Array.isArray(c.specialties) ? c.specialties : ["Residential"],
      employees: c.employees || "Unknown",
      recentProjects: parseInt(c.recentProjects) || 0,
      status: "new",
      source: "live",
      ingestedAt: new Date().toISOString(),
    };
    normalized.leadScore = calculateLeadScore(normalized);
    return normalized;
  });
}


// ─── Perplexity raw call (used by ingestion) ─────────────────────────────────

async function callPerplexityRaw(prompt) {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        { role: 'system', content: 'You are a data extraction assistant. Return only valid JSON arrays. No markdown, no preamble, no explanation.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 4000,
      temperature: 0.1,
    }),
  });
  if (!res.ok) throw new Error(`Perplexity ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// ─── Perplexity enrichment (per-contractor brief) ─────────────────────────────

async function fetchPerplexityResearch(contractor) {
  const { name, city, state, zip } = contractor;
  const queries = [
    { key: "reviewSentiment",
      prompt: `Summarize recent customer reviews and reputation for "${name}", a roofing contractor in ${city}, ${state}. Include overall sentiment, recurring themes, and any BBB rating or disputes. Be concise.` },
    { key: "webPresence",
      prompt: `Evaluate the online presence of "${name}" roofing contractor in ${city}, ${state}. Check for active website, Google Business profile, and social media activity. Is the business active or dormant online?` },
    { key: "newsAndComplaints",
      prompt: `Find any news mentions, legal issues, licensing status, or notable coverage of "${name}" roofing contractor in ${city}, ${state}. Flag red flags or positive press.` },
    { key: "stormActivity",
      prompt: `What major weather events (hail, wind, nor'easters) have impacted the ${city}, ${state} metro area (zip ${zip}) in the past 90 days? How does this affect residential roofing demand?` },
  ];

  const results = await Promise.allSettled(
    queries.map(({ key, prompt }) =>
      callPerplexity(prompt).then(text => ({ key, text }))
    )
  );

  const research = {};
  for (const r of results) {
    if (r.status === "fulfilled") research[r.value.key] = r.value.text;
    else console.warn(`[Perplexity] Query failed: ${r.reason?.message}`);
  }
  return research;
}

async function callPerplexity(prompt) {
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        { role: "system", content: "You are a B2B sales research assistant. Be factual and concise. If you cannot find specific info, say so clearly." },
        { role: "user", content: prompt },
      ],
      max_tokens: 400,
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`Perplexity ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// ─── Claude synthesis ─────────────────────────────────────────────────────────

async function synthesizeWithClaude(contractor, research) {
  const researchBlock = [
    research.reviewSentiment   && `### Customer Reviews & Reputation\n${research.reviewSentiment}`,
    research.webPresence       && `### Web Presence & Social Activity\n${research.webPresence}`,
    research.newsAndComplaints && `### News Mentions & Licensing\n${research.newsAndComplaints}`,
    research.stormActivity     && `### Local Storm & Weather Demand\n${research.stormActivity}`,
  ].filter(Boolean).join("\n\n");

  const prompt = `You are a senior B2B sales intelligence analyst for a roofing materials distributor based in NYC (zip 10013). Produce a concise, actionable account brief for a sales rep.

## Contractor Profile
- Name: ${contractor.name}
- Location: ${contractor.city}, ${contractor.state} ${contractor.zip} (${contractor.distance} miles from warehouse)
- GAF Certification: ${contractor.certLevel.replace(/_/g, " ")}
- Years in business: ${contractor.yearsInBusiness}
- Rating: ${contractor.rating}/5 (${contractor.reviewCount} reviews)
- Specialties: ${contractor.specialties.join(", ")}
- Employees: ${contractor.employees}
- Recent projects: ${contractor.recentProjects} in last 90 days
- Lead score: ${contractor.leadScore}/100
- Data source: ${contractor.source === "live" ? "Live Perplexity ingestion" : "Seed data"}

## Live Research (Perplexity)
${researchBlock || "No live research available — base brief on profile only."}

Synthesize both sources. Respond ONLY with valid JSON, no markdown fences.

{"executiveSummary":"3-4 sentences blending profile + live research","talkingPoints":["p1","p2","p3","p4"],"painPoints":["pain1","pain2","pain3"],"recommendedProducts":["product + rationale 1","product + rationale 2","product + rationale 3"],"openingLine":"personalized cold email opener referencing a specific live research detail","riskFactors":["risk1","risk2"],"bestTimeToCall":"specific timing advice","marketContext":"1-2 sentences on local storm/weather demand signals","onlinePresenceSummary":"1 sentence on digital footprint","reputationSignal":"positive","urgencyLevel":"high","researchConfidence":"high"}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
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
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.content[0].text.replace(/```json|```/g, "").trim());
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    ts: new Date().toISOString(),
    contractors: contractorStore.length,
    enrichmentsCached: enrichmentCache.size,
    dataSource: contractorStore[0]?.source || "seed",
    ingestion: ingestionStatus,
    keys: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      perplexity: !!process.env.PERPLEXITY_API_KEY,
    },
  });
});

// Trigger live ingestion from Perplexity
app.post("/api/ingest", async (req, res) => {
  if (ingestionStatus.state === "running") {
    return res.status(409).json({ error: "Ingestion already in progress" });
  }

  const { zip = "10013", distance = 25 } = req.body;
  ingestionStatus = { state: "running", startedAt: new Date().toISOString(), completedAt: null, count: 0, error: null };
  res.json({ message: "Ingestion started", status: ingestionStatus });

  // Run async — don't block the response
  ingestContractorsFromPerplexity(zip, distance)
    .then(contractors => {
      contractorStore = contractors;
      contractorMap   = new Map(contractors.map(c => [c.id, c]));
      enrichmentCache.clear(); // clear stale briefs for old contractors
      ingestionStatus = { state: "complete", startedAt: ingestionStatus.startedAt, completedAt: new Date().toISOString(), count: contractors.length, error: null };
      console.log(`[Ingest] Complete — ${contractors.length} live contractors loaded`);
    })
    .catch(err => {
      ingestionStatus = { state: "error", startedAt: ingestionStatus.startedAt, completedAt: new Date().toISOString(), count: 0, error: err.message };
      console.error(`[Ingest] Failed: ${err.message}`);
    });
});


// ─── Playwright scraper route ─────────────────────────────────────────────────

app.post('/api/ingest/playwright', async (req, res) => {
  if (ingestionStatus.state === 'running') {
    return res.status(409).json({ error: 'Ingestion already in progress' });
  }
  let playwright;
  try { playwright = require('playwright'); }
  catch { return res.status(500).json({ error: 'Playwright not installed. Run: npm install playwright && npx playwright install chromium' }); }

  const { zip = '10013', distance = 25 } = req.body;
  ingestionStatus = { state: 'running', startedAt: new Date().toISOString(), completedAt: null, count: 0, error: null, method: 'playwright' };
  res.json({ message: 'Playwright scrape started', status: ingestionStatus });

  (async () => {
    let browser;
    try {
      console.log('[Playwright] Launching Chromium...');
      browser = await playwright.chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' });

      const url = `https://www.gaf.com/en-us/roofing-contractors/residential?zip=${zip}&distance=${distance}`;
      console.log(`[Playwright] Navigating to ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Click 'Load More' and scroll until all contractors are loaded
      console.log('[Playwright] Loading all contractors...');
      let totalLoaded = 0;
      for (let attempt = 0; attempt < 30; attempt++) {
        // Scroll to bottom first
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);

        // Try clicking any 'Load More' / 'Show More' / 'Next' button
        const clicked = await page.evaluate(() => {
          const btnSelectors = [
            'button[class*="load-more"]', 'button[class*="LoadMore"]',
            'button[class*="show-more"]', 'button[class*="ShowMore"]',
            'a[class*="load-more"]', 'a[class*="show-more"]',
            'button[class*="pagination"]', '[class*="load-more"]',
            '[class*="loadMore"]', '[class*="showMore"]',
          ];
          for (const sel of btnSelectors) {
            const btn = document.querySelector(sel);
            if (btn && btn.offsetParent !== null) { btn.click(); return sel; }
          }
          // Also try any button whose text includes load/show/more
          const allBtns = [...document.querySelectorAll('button, a')];
          const moreBtn = allBtns.find(b => /load more|show more|view more|next/i.test(b.innerText) && b.offsetParent !== null);
          if (moreBtn) { moreBtn.click(); return moreBtn.innerText.trim(); }
          return null;
        });

        // Count current cards
        const count = await page.evaluate(() => {
          const selectors = ['[class*="contractor-card"]','[class*="ContractorCard"]','[class*="contractor-result"]','[class*="search-result"]','[class*="ResultCard"]','.contractor-listing','[class*="listing-card"]','[class*="contractor-item"]','[class*="ContractorItem"]'];
          for (const sel of selectors) {
            const cards = document.querySelectorAll(sel);
            if (cards.length > 0) return cards.length;
          }
          return 0;
        });

        console.log(`[Playwright] Attempt ${attempt + 1}: ${count} cards visible, clicked: ${clicked || 'nothing'}`);

        if (count === totalLoaded && !clicked) break; // nothing new loaded and no button found
        totalLoaded = count;
        if (clicked) await page.waitForTimeout(2000); // wait for new cards to render after click
      }
      console.log(`[Playwright] Loading complete — ${totalLoaded} cards found`);

      const raw = await page.evaluate(() => {
        const results = [];
        const cardSelectors = ['[class*="contractor-card"]','[class*="ContractorCard"]','[class*="contractor-result"]','[class*="search-result"]','[class*="ResultCard"]','.contractor-listing','[class*="listing-card"]'];
        let cards = [];
        for (const sel of cardSelectors) { cards = document.querySelectorAll(sel); if (cards.length > 0) break; }
        if (cards.length === 0) {
          const links = document.querySelectorAll('a[href*="/roofing-contractors/"]');
          cards = [...new Set([...links].map(l => l.closest('[class]') || l))];
        }
        cards.forEach((card) => {
          const text = card.innerText || '';
          const html = card.innerHTML || '';
          const nameEl = card.querySelector('h2,h3,h4,[class*="name"],[class*="Name"],[class*="title"]');
          const name = nameEl?.innerText?.trim() || '';
          const cardText = text.toLowerCase();
          let certLevel = 'certified';
          if (cardText.includes('master elite') || html.toLowerCase().includes('master-elite') || html.toLowerCase().includes('president')) certLevel = 'master_elite';
          else if (cardText.includes('certified plus') || html.toLowerCase().includes('certified-plus')) certLevel = 'certified_plus';
          const addrEl = card.querySelector('[class*="address"],[class*="Address"],[class*="location"],address');
          const address = addrEl?.innerText?.trim() || '';
          const phoneEl = card.querySelector('a[href^="tel:"]');
          const phone = phoneEl?.getAttribute('href')?.replace('tel:','') || null;
          const ratingEl = card.querySelector('[class*="rating"],[class*="Rating"],[aria-label*="rating"]');
          const ratingText = ratingEl?.innerText || ratingEl?.getAttribute('aria-label') || '';
          const ratingMatch = ratingText.match(/[d.]+/);
          const rating = ratingMatch ? parseFloat(ratingMatch[0]) : 4.0;
          const reviewMatch = text.match(/(d+)s*review/i);
          const reviewCount = reviewMatch ? parseInt(reviewMatch[1]) : 0;
          const websiteEl = card.querySelector('a[href^="http"]:not([href*="gaf.com"])');
          const website = websiteEl?.getAttribute('href') || null;
          const distMatch = text.match(/([d.]+)s*mi/i);
          const dist = distMatch ? parseFloat(distMatch[1]) : null;
          if (name) results.push({ name, certLevel, address, phone, rating, reviewCount, website, distance: dist });
        });
        return { results, totalCards: cards.length };
      });

      console.log(`[Playwright] Found ${raw.results.length} contractors from ${raw.totalCards} cards`);
      if (raw.results.length === 0) throw new Error('No contractor cards found — GAF may have changed their DOM structure');

      const contractors = raw.results.map((c, i) => {
        const addrParts = (c.address || '').split(',').map(s => s.trim());
        const stateZip = (addrParts[2] || '').trim().split(' ');
        const normalized = {
          id: `gaf-${String(i+1).padStart(3,'0')}`,
          name: c.name, certLevel: c.certLevel,
          address: addrParts[0] || '', city: addrParts[1] || '', state: stateZip[0] || '', zip: stateZip[1] || '',
          phone: c.phone || null, website: c.website || null,
          distance: c.distance || Math.round((i+1)*1.5*10)/10,
          yearsInBusiness: 10, reviewCount: c.reviewCount || 0, rating: c.rating || 4.0,
          specialties: ['Residential'], employees: 'Unknown', recentProjects: 0,
          status: 'new', source: 'playwright', ingestedAt: new Date().toISOString(),
        };
        normalized.leadScore = calculateLeadScore(normalized);
        return normalized;
      });

      contractorStore = contractors;
      contractorMap = new Map(contractors.map(c => [c.id, c]));
      enrichmentCache.clear();
      ingestionStatus = { state: 'complete', startedAt: ingestionStatus.startedAt, completedAt: new Date().toISOString(), count: contractors.length, error: null, method: 'playwright' };
      console.log(`[Playwright] Complete — ${contractors.length} real GAF contractors loaded`);
    } catch (err) {
      ingestionStatus = { state: 'error', startedAt: ingestionStatus.startedAt, completedAt: new Date().toISOString(), count: 0, error: err.message, method: 'playwright' };
      console.error(`[Playwright] Failed: ${err.message}`);
    } finally { if (browser) await browser.close(); }
  })();
});

// Poll ingestion status
app.get("/api/ingest/status", (_req, res) => {
  res.json({ ...ingestionStatus, contractors: contractorStore.length, dataSource: contractorStore[0]?.source || "seed" });
});

app.get("/api/leads", (req, res) => {
  const { cert_level, sort = "leadScore", order = "desc", search = "" } = req.query;
  let leads = contractorStore.map(c => ({ ...c, status: statusStore.get(c.id) || c.status }));
  if (cert_level) leads = leads.filter(c => c.certLevel === cert_level);
  if (search) {
    const q = search.toLowerCase();
    leads = leads.filter(c => c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q));
  }
  const SORTABLE = ["leadScore","rating","distance","reviewCount","yearsInBusiness"];
  if (SORTABLE.includes(sort)) {
    leads.sort((a, b) => order === "asc" ? a[sort] - b[sort] : b[sort] - a[sort]);
  }
  res.json({ total: leads.length, leads, dataSource: contractorStore[0]?.source || "seed" });
});

app.get("/api/leads/:id", (req, res) => {
  const c = contractorMap.get(req.params.id);
  if (!c) return res.status(404).json({ error: "Not found" });
  res.json({ ...c, status: statusStore.get(c.id) || c.status });
});

app.get("/api/leads/:id/enrichment", async (req, res) => {
  const { id } = req.params;
  const contractor = contractorMap.get(id);
  if (!contractor) return res.status(404).json({ error: "Contractor not found" });

  if (enrichmentCache.has(id)) {
    console.log(`[API] Cache hit: ${id}`);
    return res.json({ source: "cache", ...enrichmentCache.get(id) });
  }

  console.log(`[API] Generating: ${contractor.name}`);
  const start = Date.now();
  try {
    const research = await fetchPerplexityResearch(contractor);
    console.log(`[API] Perplexity: ${Object.keys(research).length}/4 modules`);
    const brief = await synthesizeWithClaude(contractor, research);
    const payload = {
      contractorId: id,
      generatedAt: new Date().toISOString(),
      pipelineMs: Date.now() - start,
      researchModules: Object.keys(research).length,
      brief,
    };
    enrichmentCache.set(id, payload);
    res.json({ source: "live", ...payload });
  } catch (err) {
    console.error(`[API] Failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/leads/:id/status", (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const VALID = ["new","contacted","qualified","proposal","closed_won","closed_lost"];
  if (!VALID.includes(status)) return res.status(400).json({ error: "Invalid status" });
  if (!contractorMap.has(id)) return res.status(404).json({ error: "Not found" });
  statusStore.set(id, status);
  res.json({ success: true, id, status });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n  RoofIQ      →  http://localhost:${PORT}`);
  console.log(`  API         →  http://localhost:${PORT}/api/health`);
  console.log(`  Anthropic   →  ${process.env.ANTHROPIC_API_KEY ? "✓ key set" : "✗ MISSING"}`);
  console.log(`  Perplexity  →  ${process.env.PERPLEXITY_API_KEY ? "✓ key set" : "✗ MISSING"}`);
  console.log(`\n  POST /api/ingest to pull live GAF contractors from Perplexity\n`);
});
