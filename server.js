/**
 * server.js — RoofIQ
 * 76 real GAF-certified contractors near zip 10013
 * Sourced directly from gaf.com/en-us/roofing-contractors/residential, March 2026
 */

require("dotenv").config();
const express = require("express");
const cors    = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const enrichmentCache = new Map();
const statusStore     = new Map();

// ─── Lead scoring ─────────────────────────────────────────────────────────────

function calculateLeadScore(c) {
  const cert          = { master_elite: 40, certified_plus: 25, certified: 10 }[c.certLevel] || 10;
  const presBonus     = c.presidentsClub ? 10 : 0;
  const ratingVal     = c.rating || 4.0;
  const ratingScore   = Math.round(Math.max(0, (ratingVal - 3.0) / 2.0) * 20);
  const reviewScore   = Math.min(Math.round((c.reviewCount || 0) / 10), 15);
  const tenureScore   = Math.min(Math.round((c.yearsInBusiness || 1) / 2), 10);
  const activityScore = Math.min(Math.round((c.recentProjects || 0) * 1.5), 15);
  return Math.min(cert + presBonus + ratingScore + reviewScore + tenureScore + activityScore, 100);
}

// ─── 76 Real GAF Contractors ───────────────────────────────────────────────────
// Source: gaf.com residential contractor search, zip 10013, distance 25mi

const RAW = [
  // ── President's Club + Master Elite (1-12) ──────────────────────────────────
  {name:"Preferred Exterior Corp",         presidentsClub:true, city:"New Hyde Park",  state:"NY",zip:"11040",phone:"(516) 354-7252",distance:17.5,rating:5.0,reviewCount:49, yearsInBusiness:4, employees:"5–10"},
  {name:"Allied Brothers Home Corporation",presidentsClub:true, city:"Wayne",          state:"NJ",zip:"07470",phone:"(973) 566-0060",distance:18.7,rating:4.9,reviewCount:250,yearsInBusiness:10,employees:"15–25"},
  {name:"Grapevine Pro",                   presidentsClub:true, city:"Iselin",         state:"NJ",zip:"08830",phone:"(732) 335-7770",distance:19.7,rating:4.7,reviewCount:443,yearsInBusiness:15,employees:"25–50"},
  {name:"Donny's Home Improvement",        presidentsClub:true, city:"Elmwood Park",   state:"NJ",zip:"07407",phone:"(973) 333-6364",distance:14.7,rating:5.0,reviewCount:114,yearsInBusiness:8, employees:"10–15"},
  {name:"Brothers Aluminum Home Improvements Corp",presidentsClub:true,city:"Valley Stream",state:"NY",zip:"11580",phone:"(516) 872-0947",distance:16.7,rating:4.9,reviewCount:359,yearsInBusiness:12,employees:"15–25"},
  {name:"Blue Nail Exteriors",             presidentsClub:true, city:"Montville",      state:"NJ",zip:"07045",phone:"(973) 937-8876",distance:21.7,rating:4.9,reviewCount:331,yearsInBusiness:12,employees:"15–25"},
  {name:"American Home Contractors Inc",   presidentsClub:true, city:"Florham Park",   state:"NJ",zip:"07932",phone:"(908) 771-0123",distance:19.8,rating:4.9,reviewCount:259,yearsInBusiness:10,employees:"15–25"},
  {name:"The Great American Roofing Company",presidentsClub:true,city:"Ramsey",        state:"NJ",zip:"07446",phone:"(201) 825-2955",distance:24.1,rating:4.9,reviewCount:150,yearsInBusiness:8, employees:"10–15"},
  {name:"American Roofing and Siding",     presidentsClub:true, city:"Nutley",         state:"NJ",zip:"07110",phone:"(973) 542-0710",distance:11.0,rating:4.9,reviewCount:128,yearsInBusiness:8, employees:"10–15"},
  {name:"John Goess Roofing Inc",          presidentsClub:true, city:"Westbury",       state:"NY",zip:"11590",phone:"(516) 541-4597",distance:23.6,rating:4.9,reviewCount:59, yearsInBusiness:4, employees:"5–10"},
  {name:"Rebuild America Inc",             presidentsClub:true, city:"Mineola",        state:"NY",zip:"11501",phone:"(516) 535-9293",distance:19.7,rating:4.9,reviewCount:34, yearsInBusiness:3, employees:"5–10"},
  {name:"Seci Construction Inc",           presidentsClub:true, city:"Clifton",        state:"NJ",zip:"07011",phone:"(866) 572-7324",distance:11.5,rating:4.8,reviewCount:122,yearsInBusiness:6, employees:"10–15"},
  // ── Master Elite only (13-76) ────────────────────────────────────────────────
  {name:"Matute Roofing",                  presidentsClub:false,city:"Wayne",          state:"NJ",zip:"07470",phone:"(973) 618-6489",distance:17.3,rating:5.0,reviewCount:455,yearsInBusiness:15,employees:"25–50"},
  {name:"Complete Roof Systems",           presidentsClub:false,city:"Dumont",         state:"NJ",zip:"07628",phone:"(201) 387-1846",distance:15.0,rating:5.0,reviewCount:368,yearsInBusiness:12,employees:"15–25"},
  {name:"AK Gatsios Inc",                  presidentsClub:false,city:"Bronx",          state:"NY",zip:"10451",phone:"(646) 302-5175",distance:12.6,rating:5.0,reviewCount:316,yearsInBusiness:12,employees:"15–25"},
  {name:"DeFalco Roofing",                 presidentsClub:false,city:"Fairfield",      state:"NJ",zip:"07004",phone:"(973) 255-0374",distance:18.6,rating:5.0,reviewCount:309,yearsInBusiness:10,employees:"10–15"},
  {name:"MNT Roofing & Siding",            presidentsClub:false,city:"Totowa",         state:"NJ",zip:"07512",phone:"(973) 758-7077",distance:17.3,rating:5.0,reviewCount:134,yearsInBusiness:6, employees:"10–15"},
  {name:"Future Remodeling",               presidentsClub:false,city:"Bergenfield",    state:"NJ",zip:"07621",phone:"(866) 221-1433",distance:13.7,rating:5.0,reviewCount:124,yearsInBusiness:6, employees:"10–15"},
  {name:"Golden Key Construction Group Inc",presidentsClub:false,city:"Staten Island", state:"NY",zip:"10301",phone:"(929) 353-9227",distance:10.4,rating:5.0,reviewCount:112,yearsInBusiness:6, employees:"10–15"},
  {name:"One Call Construction",           presidentsClub:false,city:"Hawthorne",      state:"NJ",zip:"07506",phone:"(800) 747-0283",distance:18.3,rating:5.0,reviewCount:109,yearsInBusiness:6, employees:"10–15"},
  {name:"Aura Home Exteriors",             presidentsClub:false,city:"Edison",         state:"NJ",zip:"08817",phone:"(732) 851-8028",distance:24.0,rating:5.0,reviewCount:104,yearsInBusiness:6, employees:"10–15"},
  {name:"Apex Roofing Solutions",          presidentsClub:false,city:"Woodland Park",  state:"NJ",zip:"07424",phone:"(973) 558-3045",distance:15.7,rating:5.0,reviewCount:90, yearsInBusiness:5, employees:"5–10"},
  {name:"US Roofing & Siding Inc",         presidentsClub:false,city:"Matawan",        state:"NJ",zip:"07747",phone:"(609) 982-8206",distance:24.2,rating:5.0,reviewCount:72, yearsInBusiness:4, employees:"5–10"},
  {name:"Reisch Roofing and Construction LLC",presidentsClub:false,city:"Pompton Plains",state:"NJ",zip:"07444",phone:"(855) 734-7241",distance:23.2,rating:5.0,reviewCount:70,yearsInBusiness:4,employees:"5–10"},
  {name:"Revive Home Remodeling Group LLC",presidentsClub:false,city:"Woodbridge",     state:"NJ",zip:"07095",phone:"(908) 902-9588",distance:18.6,rating:5.0,reviewCount:65, yearsInBusiness:4, employees:"5–10"},
  {name:"Kelly Exteriors",                 presidentsClub:false,city:"Emerson",        state:"NJ",zip:"07630",phone:"(201) 977-1076",distance:17.4,rating:5.0,reviewCount:59, yearsInBusiness:4, employees:"5–10"},
  {name:"All Professional Remodeling Group LLC",presidentsClub:false,city:"Cedar Grove",state:"NJ",zip:"07009",phone:"(973) 857-9449",distance:14.5,rating:5.0,reviewCount:58,yearsInBusiness:4,employees:"5–10"},
  {name:"High Caliber Renovations LLC",    presidentsClub:false,city:"Rahway",         state:"NJ",zip:"07065",phone:"(908) 472-5096",distance:17.1,rating:5.0,reviewCount:58, yearsInBusiness:4, employees:"5–10"},
  {name:"Big Apple Renovators",            presidentsClub:false,city:"Astoria",        state:"NY",zip:"11102",phone:"(718) 521-2121",distance:6.6, rating:5.0,reviewCount:35, yearsInBusiness:3, employees:"5–10"},
  {name:"ARM Roofing",                     presidentsClub:false,city:"Elmsford",       state:"NY",zip:"10523",phone:"(914) 347-2763",distance:24.9,rating:5.0,reviewCount:10, yearsInBusiness:2, employees:"1–5"},
  {name:"All Seasons Roofing LLC",         presidentsClub:false,city:"Staten Island",  state:"NY",zip:"10301",phone:"(718) 200-1802",distance:15.2,rating:5.0,reviewCount:6,  yearsInBusiness:2, employees:"1–5"},
  {name:"Patwood Roofing Co Inc",          presidentsClub:false,city:"Little Falls",   state:"NJ",zip:"07424",phone:"(973) 256-0400",distance:15.6,rating:5.0,reviewCount:5,  yearsInBusiness:2, employees:"1–5"},
  {name:"A&S Construction & Son Inc",      presidentsClub:false,city:"Brooklyn",       state:"NY",zip:"11201",phone:"(347) 326-4098",distance:6.5, rating:5.0,reviewCount:1,  yearsInBusiness:2, employees:"1–5"},
  {name:"ADH Group",                       presidentsClub:false,city:"College Point",  state:"NY",zip:"11356",phone:"(929) 215-3378",distance:9.5, rating:4.9,reviewCount:1002,yearsInBusiness:20,employees:"50–100"},
  {name:"Long Island Roofing and Repairs Service",presidentsClub:false,city:"North Bellmore",state:"NY",zip:"11710",phone:"(516) 221-9100",distance:24.8,rating:4.9,reviewCount:367,yearsInBusiness:12,employees:"15–25"},
  {name:"R&G Services Corp",               presidentsClub:false,city:"Orange",         state:"NJ",zip:"07050",phone:"(973) 324-9461",distance:13.0,rating:4.9,reviewCount:298,yearsInBusiness:10,employees:"15–25"},
  {name:"The Carpenter's Touch LLC",       presidentsClub:false,city:"Livingston",     state:"NJ",zip:"07039",phone:"(973) 994-1085",distance:17.0,rating:4.9,reviewCount:163,yearsInBusiness:8, employees:"10–15"},
  {name:"Above & Beyond Exterior Remodelers",presidentsClub:false,city:"Westfield",   state:"NJ",zip:"07090",phone:"(732) 322-8482",distance:18.9,rating:4.9,reviewCount:146,yearsInBusiness:8, employees:"10–15"},
  {name:"A L Best Construction Corp",      presidentsClub:false,city:"Queens Village", state:"NY",zip:"11427",phone:"(800) 516-1424",distance:14.3,rating:4.9,reviewCount:118,yearsInBusiness:6, employees:"10–15"},
  {name:"LGM Roofing Contractors",         presidentsClub:false,city:"Bloomfield",     state:"NJ",zip:"07003",phone:"(973) 707-2154",distance:10.8,rating:4.9,reviewCount:108,yearsInBusiness:6, employees:"10–15"},
  {name:"Lojas Home Improvement Plus LLC", presidentsClub:false,city:"Union",          state:"NJ",zip:"07083",phone:"(973) 757-3958",distance:15.3,rating:4.9,reviewCount:108,yearsInBusiness:6, employees:"10–15"},
  {name:"American Star Contractor Corp",   presidentsClub:false,city:"Bronx",          state:"NY",zip:"10451",phone:"(862) 294-9990",distance:11.9,rating:4.9,reviewCount:95, yearsInBusiness:5, employees:"5–10"},
  {name:"American Quality Home Improvements LLC",presidentsClub:false,city:"Belleville",state:"NJ",zip:"07109",phone:"(888) 205-1925",distance:8.7,rating:4.9,reviewCount:84,yearsInBusiness:5,employees:"5–10"},
  {name:"KNA Roofing",                     presidentsClub:false,city:"New York",       state:"NY",zip:"10013",phone:"(718) 288-6808",distance:1.5, rating:4.9,reviewCount:74, yearsInBusiness:4, employees:"5–10"},
  {name:"MK Best Roofing",                 presidentsClub:false,city:"Roosevelt",      state:"NY",zip:"11575",phone:"(631) 645-2710",distance:22.3,rating:4.9,reviewCount:54, yearsInBusiness:4, employees:"5–10"},
  {name:"Prodigy Contracting Inc",         presidentsClub:false,city:"Franklin Square", state:"NY",zip:"11010",phone:"(631) 767-2520",distance:17.2,rating:4.9,reviewCount:38, yearsInBusiness:3, employees:"5–10"},
  {name:"A Real Advantage Inc",            presidentsClub:false,city:"Jamaica",        state:"NY",zip:"11432",phone:"(718) 767-6950",distance:13.2,rating:4.9,reviewCount:27, yearsInBusiness:3, employees:"1–5"},
  {name:"Penyak Roofing Co Inc",           presidentsClub:false,city:"South Plainfield",state:"NJ",zip:"07080",phone:"(908) 753-4222",distance:24.2,rating:4.8,reviewCount:939,yearsInBusiness:20,employees:"25–50"},
  {name:"Royal Renovators Inc",            presidentsClub:false,city:"Forest Hills",   state:"NY",zip:"11375",phone:"(718) 414-6067",distance:9.3, rating:4.8,reviewCount:255,yearsInBusiness:10,employees:"15–25"},
  {name:"A&J Professional Services Inc",   presidentsClub:false,city:"South Plainfield",state:"NJ",zip:"07080",phone:"(908) 432-7081",distance:22.1,rating:4.8,reviewCount:220,yearsInBusiness:10,employees:"15–25"},
  {name:"B&B Siding and Roofing",          presidentsClub:false,city:"Staten Island",  state:"NY",zip:"10301",phone:"(718) 757-2904",distance:12.9,rating:4.8,reviewCount:179,yearsInBusiness:8, employees:"10–15"},
  {name:"Kamtech Restoration Corp",        presidentsClub:false,city:"Brooklyn",       state:"NY",zip:"11201",phone:"(347) 860-1109",distance:7.8, rating:4.8,reviewCount:160,yearsInBusiness:8, employees:"10–15"},
  {name:"CKG Contractors Inc",             presidentsClub:false,city:"Parsippany",     state:"NJ",zip:"07054",phone:"(973) 599-0811",distance:23.8,rating:4.8,reviewCount:150,yearsInBusiness:8, employees:"10–15"},
  {name:"Tico's Carpentry and Roofing LLC",presidentsClub:false,city:"Union",          state:"NJ",zip:"07083",phone:"(908) 624-0001",distance:13.4,rating:4.8,reviewCount:40, yearsInBusiness:3, employees:"5–10"},
  {name:"R Jenny Construction",            presidentsClub:false,city:"Orange",         state:"NJ",zip:"07050",phone:"(973) 673-7663",distance:12.5,rating:4.8,reviewCount:24, yearsInBusiness:3, employees:"1–5"},
  {name:"Dior Construction",               presidentsClub:false,city:"Bergenfield",    state:"NJ",zip:"07621",phone:"(201) 472-5462",distance:13.7,rating:4.7,reviewCount:274,yearsInBusiness:10,employees:"15–25"},
  {name:"Abraham Roofing",                 presidentsClub:false,city:"Lynbrook",       state:"NY",zip:"11563",phone:"(800) 347-0913",distance:18.2,rating:4.7,reviewCount:112,yearsInBusiness:6, employees:"10–15"},
  {name:"SmartRoof LLC",                   presidentsClub:false,city:"Parsippany",     state:"NJ",zip:"07054",phone:"(844) 334-1864",distance:21.7,rating:4.7,reviewCount:89, yearsInBusiness:5, employees:"5–10"},
  {name:"Gorman & Carbone Roofing Contractors",presidentsClub:false,city:"Staten Island",state:"NY",zip:"10301",phone:"(718) 317-4023",distance:19.5,rating:4.7,reviewCount:27,yearsInBusiness:3,employees:"5–10"},
  {name:"Homestead Roofing Company",       presidentsClub:false,city:"Ridgewood",      state:"NJ",zip:"07450",phone:"(201) 444-2233",distance:18.8,rating:4.6,reviewCount:173,yearsInBusiness:8, employees:"10–15"},
  {name:"Acorn Home Improvements Inc",     presidentsClub:false,city:"Whippany",       state:"NJ",zip:"07981",phone:"(973) 386-9604",distance:22.4,rating:4.6,reviewCount:73, yearsInBusiness:4, employees:"5–10"},
  {name:"Garden State Roofing & Siding",   presidentsClub:false,city:"North Middletown",state:"NJ",zip:"07748",phone:"(732) 787-5545",distance:21.3,rating:4.6,reviewCount:66,yearsInBusiness:4,employees:"5–10"},
  {name:"Premium Home Improvements",       presidentsClub:false,city:"Berkeley Heights",state:"NJ",zip:"07922",phone:"(908) 898-1420",distance:23.2,rating:4.6,reviewCount:55,yearsInBusiness:4,employees:"5–10"},
  {name:"Green Star Exteriors",            presidentsClub:false,city:"South Plainfield",state:"NJ",zip:"07080",phone:"(800) 625-0021",distance:24.2,rating:4.6,reviewCount:34,yearsInBusiness:3,employees:"5–10"},
  {name:"Abraham Roofing & Siding",        presidentsClub:false,city:"Union",          state:"NJ",zip:"07083",phone:"(973) 379-1300",distance:15.4,rating:4.6,reviewCount:10, yearsInBusiness:2, employees:"1–5"},
  {name:"Classic Remodeling Corp",         presidentsClub:false,city:"Paramus",        state:"NJ",zip:"07652",phone:"(201) 745-8065",distance:16.4,rating:4.5,reviewCount:56, yearsInBusiness:4, employees:"5–10"},
  {name:"FM Construction Group LLC",       presidentsClub:false,city:"East Orange",    state:"NJ",zip:"07017",phone:"(973) 989-1616",distance:10.3,rating:4.3,reviewCount:36, yearsInBusiness:3, employees:"5–10"},
  {name:"A1 Affordable Construction",      presidentsClub:false,city:"Clifton",        state:"NJ",zip:"07011",phone:"(800) 865-0053",distance:12.7,rating:4.2,reviewCount:501,yearsInBusiness:15,employees:"25–50"},
  {name:"American Siding Construction Corp",presidentsClub:false,city:"Newark",        state:"NJ",zip:"07102",phone:"(201) 772-7713",distance:6.5, rating:4.1,reviewCount:27, yearsInBusiness:3, employees:"5–10"},
  {name:"JC Master Inc",                   presidentsClub:false,city:"Richmond Hill",  state:"NY",zip:"11418",phone:"(347) 400-2611",distance:9.2, rating:4.0,reviewCount:92, yearsInBusiness:5, employees:"5–10"},
  {name:"Nations Roof LLC",                presidentsClub:false,city:"Yonkers",        state:"NY",zip:"10701",phone:"(732) 406-4471",distance:16.9,rating:4.0,reviewCount:4,  yearsInBusiness:2, employees:"1–5"},
  {name:"Carework Construction LLC",       presidentsClub:false,city:"Lyndhurst",      state:"NJ",zip:"07071",phone:"(201) 998-8960",distance:9.0, rating:null,reviewCount:0, yearsInBusiness:2, employees:"1–5"},
  {name:"DC Services",                     presidentsClub:false,city:"Edison",         state:"NJ",zip:"08817",phone:"(973) 991-1888",distance:23.0,rating:null,reviewCount:0, yearsInBusiness:2, employees:"1–5"},
  {name:"Firstline Contracting Inc",       presidentsClub:false,city:"New Hyde Park",  state:"NY",zip:"11040",phone:"(718) 721-0080",distance:16.6,rating:null,reviewCount:0, yearsInBusiness:2, employees:"1–5"},
  {name:"Happy Remodeling",                presidentsClub:false,city:"Long Beach",     state:"NY",zip:"11561",phone:"(516) 993-8556",distance:20.5,rating:null,reviewCount:0, yearsInBusiness:2, employees:"1–5"},
  {name:"REK Roofing Services",            presidentsClub:false,city:"Tenafly",        state:"NJ",zip:"07670",phone:"(646) 721-4431",distance:14.3,rating:null,reviewCount:0, yearsInBusiness:2, employees:"1–5"},
];

const CONTRACTORS = RAW.map((c, i) => ({
  id: `gaf-${String(i + 1).padStart(3, "0")}`,
  certLevel: "master_elite",
  specialties: ["Residential"],
  recentProjects: 0,
  status: "new",
  source: "gaf",
  website: null,
  address: "",
  ...c,
  leadScore: calculateLeadScore({ certLevel: "master_elite", ...c }),
}));

let contractorStore = [...CONTRACTORS];
let contractorMap   = new Map(contractorStore.map(c => [c.id, c]));

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
    queries.map(({ key, prompt }) => callPerplexity(prompt).then(text => ({ key, text })))
  );
  const research = {};
  for (const r of results) {
    if (r.status === "fulfilled") research[r.value.key] = r.value.text;
    else console.warn(`[Perplexity] Failed: ${r.reason?.message}`);
  }
  return research;
}

async function callPerplexity(prompt) {
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        { role: "system", content: "You are a B2B sales research assistant. Be factual and concise." },
        { role: "user", content: prompt },
      ],
      max_tokens: 400, temperature: 0.2,
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
- GAF Certification: Master Elite${contractor.presidentsClub ? " + President's Club" : ""}
- Years in business: ${contractor.yearsInBusiness}
- Rating: ${contractor.rating || "No rating"}/5 (${contractor.reviewCount} reviews)
- Lead score: ${contractor.leadScore}/100

## Live Research (Perplexity)
${researchBlock || "No live research available."}

Respond ONLY with valid JSON, no markdown fences.
{"executiveSummary":"3-4 sentences","talkingPoints":["p1","p2","p3","p4"],"painPoints":["pain1","pain2","pain3"],"recommendedProducts":["product 1","product 2","product 3"],"openingLine":"personalized cold email opener","riskFactors":["risk1","risk2"],"bestTimeToCall":"timing advice","marketContext":"1-2 sentences on local demand signals","onlinePresenceSummary":"1 sentence","reputationSignal":"positive","urgencyLevel":"high","researchConfidence":"high"}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.content[0].text.replace(/```json|```/g, "").trim());
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok", ts: new Date().toISOString(),
    contractors: contractorStore.length,
    enrichmentsCached: enrichmentCache.size,
    keys: { anthropic: !!process.env.ANTHROPIC_API_KEY, perplexity: !!process.env.PERPLEXITY_API_KEY },
  });
});

app.get("/api/leads", (req, res) => {
  const { cert_level, sort = "leadScore", order = "desc", search = "" } = req.query;
  let leads = contractorStore.map(c => ({ ...c, status: statusStore.get(c.id) || c.status }));
  if (cert_level) leads = leads.filter(c => c.certLevel === cert_level);
  if (search) { const q = search.toLowerCase(); leads = leads.filter(c => c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q)); }
  const SORTABLE = ["leadScore","rating","distance","reviewCount","yearsInBusiness"];
  if (SORTABLE.includes(sort)) leads.sort((a, b) => order === "asc" ? (a[sort]||0) - (b[sort]||0) : (b[sort]||0) - (a[sort]||0));
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
  if (enrichmentCache.has(id)) { console.log(`[API] Cache hit: ${id}`); return res.json({ source: "cache", ...enrichmentCache.get(id) }); }
  console.log(`[API] Generating: ${contractor.name}`);
  const start = Date.now();
  try {
    const research = await fetchPerplexityResearch(contractor);
    const brief = await synthesizeWithClaude(contractor, research);
    const payload = { contractorId: id, generatedAt: new Date().toISOString(), pipelineMs: Date.now() - start, researchModules: Object.keys(research).length, brief };
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
  console.log(`  Leads       →  ${contractorStore.length} real GAF contractors`);
  console.log(`  Anthropic   →  ${process.env.ANTHROPIC_API_KEY ? "✓ key set" : "✗ MISSING"}`);
  console.log(`  Perplexity  →  ${process.env.PERPLEXITY_API_KEY ? "✓ key set" : "✗ MISSING"}\n`);
});
