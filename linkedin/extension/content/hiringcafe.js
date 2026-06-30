// content/hiringcafe.js — Hiring Cafe scraper.
// Hiring Cafe is a Next.js SSR app: every search page embeds a
// <script id="__NEXT_DATA__"> blob whose props.pageProps.ssrHits is a 40-item
// array of fully structured job objects (title, apply_url, experience, seniority,
// category, publish timestamp, tools…). So instead of scraping fragile DOM cards
// we read that JSON, and we page through more results with same-origin fetch()
// (each page is server-rendered, so __NEXT_DATA__ comes back in the HTML — no
// reload, the content script stays alive). Hiring Cafe links OUT to the original
// posting (apply_url), so this is scrape-only — no in-site apply.

(() => {
  if (window.__jobHuntHiringCafeInitialized) {
    console.log("[HiringCafe] Already initialized; skipping");
    return;
  }
  window.__jobHuntHiringCafeInitialized = true;

  const SOURCE = "hiringcafe";
  const MAX_PAGES = 5; // page 0 (this tab) + fetched pages 1..4 → up to ~200 raw

  // Hiring Cafe aggregates ~190k jobs across every field, so relevance must be
  // strict: keep Software Development / Data & Analytics roles, plus anything
  // with a strong software keyword that landed in another category.
  const STRONG_KEYWORDS = [
    "software", "developer", "programmer", "backend", "front end", "frontend",
    "full stack", "fullstack", "sde", "python", "react", "node", "javascript",
    "typescript", "golang", "java developer", "devops", "data engineer",
    "machine learning", "data scientist",
  ];
  const ALLOWED_CATEGORIES = ["Software Development", "Data and Analytics"];

  const jf = () => window.__jhJobFilter;
  const isExcludedTitle = (t) => (jf() ? jf().isExcludedTitle(t) : false);
  const isFreshWithin = (ts) => (jf() ? jf().isFreshWithin(ts) : true);

  function isRelevant(title, coreTitle, category, tools) {
    if (isExcludedTitle(title) || isExcludedTitle(coreTitle)) return false;
    if (ALLOWED_CATEGORIES.includes(category)) return true;
    const hay = ` ${[title || "", coreTitle || "", (tools || []).join(" ")].join(" ").toLowerCase()} `;
    if (STRONG_KEYWORDS.some((kw) => hay.includes(kw))) return true;
    return / ai | ml | nlp /.test(hay);
  }

  function parseNextData(doc) {
    const el = doc.getElementById("__NEXT_DATA__");
    if (!el) return [];
    try {
      const data = JSON.parse(el.textContent);
      return data?.props?.pageProps?.ssrHits || [];
    } catch (e) {
      console.warn("[HiringCafe] __NEXT_DATA__ parse failed:", e.message);
      return [];
    }
  }

  function buildSalary(v) {
    const cur = v.listed_compensation_currency || "";
    const sym = cur === "INR" ? "₹" : cur === "USD" ? "$" : "";
    const min = v.yearly_min_compensation, max = v.yearly_max_compensation;
    if (min && max && max !== min) return `${sym}${min}-${sym}${max}/yr`;
    if (min) return `${sym}${min}/yr`;
    return null;
  }

  function mapHit(hit) {
    const v = hit.v5_processed_job_data || {};
    const title = hit.job_information?.title || v.core_job_title || null;
    const company = hit.enriched_company_data?.name || v.company_name || null;
    const job_url = hit.apply_url || null;
    if (!title || !job_url) return null;

    if (!isRelevant(title, v.core_job_title, v.job_category, v.technical_tools)) return null;

    // Experience / seniority gate — numeric fields, far cleaner than title regex.
    const yoe = v.min_industry_and_role_yoe;
    if (typeof yoe === "number" && yoe > 2) return null;
    if (String(v.seniority_level || "").toLowerCase() === "senior level") return null;

    // Freshness — exact publish timestamp from the structured data.
    const millis = v.estimated_publish_date_millis;
    const posted_at_parsed = millis ? Math.floor(millis / 1000) : null;
    if (!isFreshWithin(posted_at_parsed)) return null;

    const experience_required =
      typeof yoe === "number" ? `${yoe}+ Years` : (v.seniority_level || null);

    return {
      title,
      company,
      location: v.formatted_workplace_location || null,
      source: SOURCE,
      job_url,
      posted_at: millis ? new Date(millis).toISOString() : null,
      posted_at_parsed,
      experience_required,
      skills: Array.isArray(v.technical_tools) ? v.technical_tools.slice(0, 20) : [],
      salary: buildSalary(v),
      is_startup: hit.enriched_company_data?.organization_type === "Private" || false,
    };
  }

  const seen = new Set();
  const pending = [];

  function ingest(hits) {
    let added = 0;
    for (const hit of hits) {
      const job = mapHit(hit);
      if (!job || seen.has(job.job_url)) continue;
      seen.add(job.job_url);
      pending.push(job);
      added++;
    }
    return added;
  }

  function send() {
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    console.log(`[HiringCafe] Sending ${batch.length} jobs to backend`);
    chrome.runtime.sendMessage({ type: "JOBS_SCRAPED", payload: batch }, () => {
      if (chrome.runtime.lastError) console.warn("[HiringCafe]", chrome.runtime.lastError.message);
    });
  }

  function pageUrl(n) {
    const u = new URL(window.location.href);
    u.searchParams.set("page", String(n)); // page is 0-indexed; absent = first page
    return u.toString();
  }

  async function fetchPage(n) {
    try {
      const res = await fetch(pageUrl(n), { credentials: "include" });
      if (!res.ok) return [];
      const html = await res.text();
      return parseNextData(new DOMParser().parseFromString(html, "text/html"));
    } catch (e) {
      console.warn(`[HiringCafe] page ${n} fetch failed:`, e.message);
      return [];
    }
  }

  (async () => {
    ingest(parseNextData(document)); // page 0 — already in this tab
    send();
    for (let n = 1; n < MAX_PAGES; n++) {
      const hits = await fetchPage(n);
      if (hits.length === 0) break;
      if (ingest(hits) > 0) send();
      await new Promise((r) => setTimeout(r, 600));
    }
    console.log(`[HiringCafe] Done — ${seen.size} relevant jobs sent`);
  })();
})();
