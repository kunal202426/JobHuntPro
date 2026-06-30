// content/hiringcafe.js — Hiring Cafe scraper.
// Hiring Cafe is a Next.js SSR app: every search page embeds a
// <script id="__NEXT_DATA__"> blob whose props.pageProps.ssrHits is a 40-item
// array of fully structured job objects. So instead of scraping fragile DOM cards
// we read that JSON, and we page through more results with same-origin fetch()
// (each page is server-rendered, so __NEXT_DATA__ comes back in the HTML — no
// reload, the content script stays alive). Hiring Cafe links OUT to the original
// posting (apply_url), so this is scrape-only — no in-site apply.
//
// Relevance/experience/department are already enforced at the SOURCE by the
// searchState URL in background.js (searchQuery + tech departments + roleYoeRange
// 0-1). So the ONLY client-side filter here is the ~24h freshness cut — nothing
// else. Results are sorted newest-first, so once a page is entirely stale we stop.

(() => {
  if (window.__jobHuntHiringCafeInitialized) {
    console.log("[HiringCafe] Already initialized; skipping");
    return;
  }
  window.__jobHuntHiringCafeInitialized = true;

  const SOURCE = "hiringcafe";
  const MAX_PAGES = 10; // hard cap; the freshness early-stop usually ends sooner

  const jf = () => window.__jhJobFilter;
  const isFreshWithin = (ts) => (jf() ? jf().isFreshWithin(ts) : true);
  const hitMillis = (hit) => hit.v5_processed_job_data?.estimated_publish_date_millis || null;
  const hitFresh = (hit) => {
    const m = hitMillis(hit);
    return isFreshWithin(m ? Math.floor(m / 1000) : null);
  };

  function buildSalary(v) {
    const cur = v.listed_compensation_currency || "";
    const sym = cur === "INR" ? "₹" : cur === "USD" ? "$" : "";
    const min = v.yearly_min_compensation, max = v.yearly_max_compensation;
    if (min && max && max !== min) return `${sym}${min}-${sym}${max}/yr`;
    if (min) return `${sym}${min}/yr`;
    return null;
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

  function mapHit(hit) {
    const v = hit.v5_processed_job_data || {};
    const title = hit.job_information?.title || v.core_job_title || null;
    const company = hit.enriched_company_data?.name || v.company_name || null;
    const job_url = hit.apply_url || null;
    if (!title || !job_url) return null;

    // Only filter: ~24h freshness (source URL already handled relevance/experience).
    if (!hitFresh(hit)) return null;

    const millis = hitMillis(hit);
    const yoe = v.min_industry_and_role_yoe;

    return {
      title,
      company,
      location: v.formatted_workplace_location || null,
      source: SOURCE,
      job_url,
      posted_at: millis ? new Date(millis).toISOString() : null,
      posted_at_parsed: millis ? Math.floor(millis / 1000) : null,
      experience_required: typeof yoe === "number" ? `${yoe}+ Years` : (v.seniority_level || null),
      skills: Array.isArray(v.technical_tools) ? v.technical_tools.slice(0, 20) : [],
      salary: buildSalary(v),
      is_startup: hit.enriched_company_data?.organization_type === "Private" || false,
    };
  }

  const seen = new Set();
  const pending = [];

  // Returns { added, fresh } — `fresh` counts how many hits on this page were
  // within the window (used for the newest-first early-stop).
  function ingest(hits) {
    let added = 0, fresh = 0;
    for (const hit of hits) {
      if (hitFresh(hit)) fresh++;
      const job = mapHit(hit);
      if (!job || seen.has(job.job_url)) continue;
      seen.add(job.job_url);
      pending.push(job);
      added++;
    }
    return { added, fresh };
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
    const first = ingest(parseNextData(document)); // page 0 — already in this tab
    send();
    // Stop early if even the first page is entirely outside the 24h window.
    if (first.fresh === 0) {
      console.log("[HiringCafe] Page 0 had no fresh jobs — done");
      return;
    }
    for (let n = 1; n < MAX_PAGES; n++) {
      const hits = await fetchPage(n);
      if (hits.length === 0) break;
      const { added, fresh } = ingest(hits);
      if (added) send();
      if (fresh === 0) break; // newest-first → past the 24h boundary, stop paging
      await new Promise((r) => setTimeout(r, 600));
    }
    console.log(`[HiringCafe] Done — ${seen.size} jobs sent (last 24h)`);
  })();
})();
