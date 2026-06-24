// content/linkedin_people.js — LinkedIn People Search DOM reader (Phase 5)

function extractProfile(card, targetCompany) {
  try {
    const linkEl =
      card.querySelector("a[href*='/in/']") ||
      card.querySelector("a[href^='/in/']");
    const name = cleanName(linkEl?.textContent);
    if (!name || name.toLowerCase() === "linkedin member") return null;

    // Headline / title
    const pTexts = Array.from(card.querySelectorAll("p"))
      .map(p => normalizeText(p.textContent))
      .filter(Boolean);
    const { title, company, currentLine, titleLine } = extractHeadlineAndCompany(pTexts);
    if (targetCompany) {
      const line = currentLine || titleLine || "";
      if (!company || isFormerLine(line) || !isCompanyMatch(company, targetCompany)) return null;
    }

    // Profile URL — strip query params and tracking
    const profile_url = linkEl?.href?.split("?")[0];
    if (!profile_url || !profile_url.includes("/in/")) return null;

    return {
      name,
      title,
      company,
      profile_url,
      temp_id: profile_url,
    };
  } catch (err) {
    console.warn("[LinkedIn People] Profile parse error:", err.message);
    return null;
  }
}

function scrapeProfiles(targetCompany) {
  const cardSelectors = [
    ".reusable-search__result-container",
    "li.reusable-search__result-container",
    ".search-results-container .entity-result",
    "[data-chameleon-result-urn]",
    ".artdeco-list__item",
  ];

  let cards = [];
  for (const sel of cardSelectors) {
    const found = document.querySelectorAll(sel);
    if (found.length > 0) { cards = Array.from(found); break; }
  }

  if (cards.length === 0) {
    const links = Array.from(
      document.querySelectorAll("a[href*='/in/'], a[href^='/in/']")
    );
    const fallbackCards = new Set();
    links.forEach(link => {
      const card = findProfileCard(link);
      if (card) fallbackCards.add(card);
    });
    cards = Array.from(fallbackCards);
  }

  if (cards.length === 0) {
    console.log("[LinkedIn People] No profile cards found with known selectors");
    return [];
  }

  const profiles = cards.map(card => extractProfile(card, targetCompany)).filter(Boolean);
  console.log(`[LinkedIn People] Extracted ${profiles.length} profiles from ${cards.length} cards`);
  return profiles;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function cleanName(value) {
  const name = normalizeText(value);
  return name.replace(/\bverified\b/i, "").trim();
}

function findProfileCard(link) {
  let node = link;
  for (let i = 0; i < 6 && node; i++) {
    if (node.matches("li, div")) {
      const text = node.textContent || "";
      if (text.includes("Message") || text.includes("Current:") || text.includes("@") || text.includes(" at ")) {
        return node;
      }
    }
    node = node.parentElement;
  }
  return link.closest("li") || link.closest("div");
}

function parseCompanyFromText(text) {
  if (!text) return null;
  const match = text.match(/(?:@| at )\s*([^|·•,]+)/i);
  return match ? normalizeText(match[1]) : null;
}

function extractHeadlineAndCompany(pTexts) {
  let company = null;
  let title = null;

  const currentLine = pTexts.find(t => /current:/i.test(t));
  if (currentLine) company = parseCompanyFromText(currentLine);

  const titleLine = pTexts.find(t => /@| at /i.test(t)) ||
    pTexts.find(t => /(engineer|developer|recruiter|manager|lead|talent|hr|people|cto|vp)/i.test(t)) ||
    null;

  title = titleLine;
  if (!company && titleLine) company = parseCompanyFromText(titleLine);

  return { title, company, currentLine, titleLine };
}

function isFormerLine(text) {
  return /(\bex[-\s]|\bformer\b|\bpreviously\b)/i.test(text || "");
}

function normalizeCompany(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(inc|ltd|llc|pvt|private|limited|technologies|technology|tech|systems|solutions|corp|corporation|co|company)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeCompany(value) {
  return normalizeCompany(value)
    .split(" ")
    .filter(Boolean);
}

function isCompanyMatch(candidate, target) {
  if (!target) return true;
  if (!candidate) return false;
  const cand = normalizeCompany(candidate);
  const targ = normalizeCompany(target);
  if (!cand || !targ) return false;
  if (cand.includes(targ) || targ.includes(cand)) return true;

  const candTokens = new Set(tokenizeCompany(cand));
  const targTokens = new Set(tokenizeCompany(targ));
  if (targTokens.size === 1) {
    const token = Array.from(targTokens)[0];
    return candTokens.has(token);
  }
  let hits = 0;
  targTokens.forEach(t => { if (candTokens.has(t)) hits++; });
  return hits >= Math.min(2, targTokens.size);
}

async function waitForCards(targetCompany, maxWaitMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const cards = scrapeProfiles(targetCompany);
    if (cards.length > 0) return cards;
    await sleep(800);
  }
  return [];
}

async function scrapeWithAutoScroll(targetCompany) {
  const results = new Map();
  const initial = await waitForCards(targetCompany);
  initial.forEach(p => results.set(p.profile_url, p));

  const MAX_SCROLLS = 6;
  const SCROLL_STEP = 900;
  const SCROLL_WAIT = 900;

  for (let i = 0; i < MAX_SCROLLS; i++) {
    window.scrollBy({ top: SCROLL_STEP, left: 0, behavior: "smooth" });
    await sleep(SCROLL_WAIT);
    const profiles = scrapeProfiles(targetCompany);
    profiles.forEach(p => results.set(p.profile_url, p));
  }

  return Array.from(results.values());
}

// Listen for SCRAPE_PEOPLE message from background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SCRAPE_PEOPLE") {
    (async () => {
      const profiles = await scrapeWithAutoScroll(message.payload?.company);
      sendResponse({ profiles });
    })();
    return true;
  }
});
