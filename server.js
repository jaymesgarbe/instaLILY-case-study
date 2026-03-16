/**
 * server.js — RoofIQ standalone server
 *
 * Zero infrastructure required: no Postgres, no Redis.
 * Swap in db.js + cache.js for production.
 *
 * Usage:
 *   cp .env.example .env   # add your API keys
 *   node server.js
 */

require("dotenv").config();
const express = require("express");
const cors    = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ─── In-memory stores ─────────────────────────────────────────────────────────
const enrichmentCache = new Map();
const statusStore     = new Map();

const CONTRACTORS = [
  {id:"c001",name:"Empire State Roofing Co.",certLevel:"master_elite",address:"245 W 35th St",city:"New York",state:"NY",zip:"10001",phone:"(212) 555-0147",website:"www.empirestateroof.com",distance:1.8,yearsInBusiness:24,reviewCount:187,rating:4.9,specialties:["Residential","Metal Roofing","FORTIFIED Roof"],employees:"25–50",leadScore:94,status:"new",recentProjects:12},
  {id:"c002",name:"Brooklyn Heights Roofing",certLevel:"master_elite",address:"780 Atlantic Ave",city:"Brooklyn",state:"NY",zip:"11238",phone:"(718) 555-0293",website:"www.bkheightsroofing.com",distance:4.2,yearsInBusiness:18,reviewCount:142,rating:4.8,specialties:["Residential","Historic Buildings","Slate"],employees:"15–25",leadScore:88,status:"new",recentProjects:8},
  {id:"c003",name:"Tri-State Roofing Solutions",certLevel:"master_elite",address:"1150 E Ridgewood Ave",city:"Ridgewood",state:"NJ",zip:"07450",phone:"(201) 555-0381",website:"www.tristateroofing.net",distance:12.6,yearsInBusiness:31,reviewCount:224,rating:4.7,specialties:["Residential","Commercial","Storm Damage"],employees:"50–100",leadScore:91,status:"contacted",recentProjects:19},
  {id:"c004",name:"Queens Pro Roofing",certLevel:"certified_plus",address:"89-12 Jamaica Ave",city:"Queens",state:"NY",zip:"11421",phone:"(718) 555-0462",website:"www.queensproroof.com",distance:6.8,yearsInBusiness:11,reviewCount:96,rating:4.6,specialties:["Residential","Flat Roofs","Solar Shingles"],employees:"10–15",leadScore:76,status:"new",recentProjects:6},
  {id:"c005",name:"Bronx All-Weather Roofing",certLevel:"certified_plus",address:"1745 Morris Ave",city:"Bronx",state:"NY",zip:"10453",phone:"(718) 555-0529",website:"www.bronxallweather.com",distance:9.3,yearsInBusiness:16,reviewCount:78,rating:4.5,specialties:["Residential","Multi-Family","Flat Roofs"],employees:"10–15",leadScore:72,status:"new",recentProjects:5},
  {id:"c006",name:"Long Island Premier Roofing",certLevel:"master_elite",address:"425 Sunrise Hwy",city:"West Islip",state:"NY",zip:"11795",phone:"(631) 555-0614",website:"www.lipremierroofing.com",distance:20.1,yearsInBusiness:27,reviewCount:198,rating:4.9,specialties:["Residential","FORTIFIED Roof","Metal Roofing","Solar"],employees:"25–50",leadScore:92,status:"qualified",recentProjects:14},
  {id:"c007",name:"Hoboken Roofing & Restoration",certLevel:"certified_plus",address:"320 Observer Hwy",city:"Hoboken",state:"NJ",zip:"07030",phone:"(201) 555-0728",website:"www.hobokenroofing.com",distance:3.1,yearsInBusiness:9,reviewCount:61,rating:4.7,specialties:["Residential","Historic Buildings","Brownstones"],employees:"5–10",leadScore:69,status:"new",recentProjects:4},
  {id:"c008",name:"Staten Island Roofing Pros",certLevel:"certified",address:"1847 Victory Blvd",city:"Staten Island",state:"NY",zip:"10314",phone:"(718) 555-0835",website:null,distance:11.4,yearsInBusiness:7,reviewCount:44,rating:4.3,specialties:["Residential","Gutters"],employees:"5–10",leadScore:54,status:"new",recentProjects:3},
  {id:"c009",name:"Westchester Elite Roofing",certLevel:"master_elite",address:"500 Mamaroneck Ave",city:"White Plains",state:"NY",zip:"10605",phone:"(914) 555-0947",website:"www.westchestereliteroofing.com",distance:22.8,yearsInBusiness:20,reviewCount:156,rating:4.8,specialties:["Residential","Luxury Homes","Metal Roofing","FORTIFIED"],employees:"15–25",leadScore:89,status:"proposal",recentProjects:9},
  {id:"c010",name:"Jersey City Roofing",certLevel:"certified",address:"234 Newark Ave",city:"Jersey City",state:"NJ",zip:"07302",phone:"(201) 555-1023",website:"www.jerseycityroofing.com",distance:2.9,yearsInBusiness:5,reviewCount:29,rating:4.2,specialties:["Residential","Commercial"],employees:"5–10",leadScore:48,status:"new",recentProjects:2},
  {id:"c011",name:"Yonkers Roofing & Sheet Metal",certLevel:"certified_plus",address:"780 Central Park Ave",city:"Yonkers",state:"NY",zip:"10704",phone:"(914) 555-1147",website:"www.yonkersroofing.com",distance:16.3,yearsInBusiness:14,reviewCount:88,rating:4.6,specialties:["Residential","Commercial","Sheet Metal","Gutters"],employees:"15–25",leadScore:75,status:"contacted",recentProjects:7},
  {id:"c012",name:"Nassau County Roofing Group",certLevel:"certified_plus",address:"1200 Old Country Rd",city:"Westbury",state:"NY",zip:"11590",phone:"(516) 555-1253",website:"www.nassauroofing.com",distance:18.7,yearsInBusiness:13,reviewCount:107,rating:4.5,specialties:["Residential","Storm Damage","Insurance Claims"],employees:"15–25",leadScore:78,status:"new",recentProjects:8},
  {id:"c013",name:"Manhattan Premium Roofing",certLevel:"certified_plus",address:"540 W 148th St",city:"New York",state:"NY",zip:"10031",phone:"(212) 555-1364",website:"www.manhattanpremiumroofing.com",distance:5.5,yearsInBusiness:8,reviewCount:52,rating:4.4,specialties:["Residential","Brownstones","Multi-Family"],employees:"10–15",leadScore:67,status:"new",recentProjects:4},
  {id:"c014",name:"Newark Roofing & Construction",certLevel:"certified",address:"89 Market St",city:"Newark",state:"NJ",zip:"07102",phone:"(973) 555-1478",website:null,distance:8.1,yearsInBusiness:4,reviewCount:18,rating:3.9,specialties:["Residential","Commercial"],employees:"1–5",leadScore:38,status:"new",recentProjects:1}
];

const contractorMap = new Map(CONTRACTORS.map(c => [c.id, c]));

// ─── Perplexity research ──────────────────────────────────────────────────────

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

// ─── Static frontend ──────────────────────────────────────────────────────────
app.use(express.static(__dirname));

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    ts: new Date().toISOString(),
    contractors: CONTRACTORS.length,
    enrichmentsCached: enrichmentCache.size,
    keys: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      perplexity: !!process.env.PERPLEXITY_API_KEY,
    },
  });
});

app.get("/api/leads", (req, res) => {
  const { cert_level, sort = "leadScore", order = "desc", search = "" } = req.query;
  let leads = CONTRACTORS.map(c => ({ ...c, status: statusStore.get(c.id) || c.status }));
  if (cert_level) leads = leads.filter(c => c.certLevel === cert_level);
  if (search) {
    const q = search.toLowerCase();
    leads = leads.filter(c => c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q));
  }
  const SORTABLE = ["leadScore","rating","distance","reviewCount","yearsInBusiness"];
  if (SORTABLE.includes(sort)) {
    leads.sort((a, b) => order === "asc" ? a[sort] - b[sort] : b[sort] - a[sort]);
  }
  res.json({ total: leads.length, leads });
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
  console.log(`  Anthropic   →  ${process.env.ANTHROPIC_API_KEY ? "✓ key set" : "✗ MISSING — add to .env"}`);
  console.log(`  Perplexity  →  ${process.env.PERPLEXITY_API_KEY ? "✓ key set" : "✗ MISSING — add to .env"}\n`);
});
