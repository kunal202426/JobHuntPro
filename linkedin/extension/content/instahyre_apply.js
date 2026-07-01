// content/instahyre_apply.js — runs ONLY when the user clicks "IH Apply" (the
// bulk apply queue), never during scraping. Two page shapes are supported:
//
// 1. Old-style standalone job page: the whole document IS the job — the Apply
//    button is somewhere on the page.
// 2. New recommendation feed (/candidate/opportunities/?jid=<id>): the job has
//    no standalone page. We land on the general feed, find the card whose
//    skills-list DOM id matches ?jid=, click its "View" area to open Instahyre's
//    in-page Angular modal (ng-click="openApplyModal(opp)"), then act inside it.
//    Job functions/experience only show inside that modal, not on the card.

(() => {
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function visible(el) {
    if (!el) return false;
    try {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
      return el.getClientRects().length > 0;
    } catch (e) { return true; }
  }

  function normalize(t) { return (t || "").replace(/\s+/g, " ").trim().toLowerCase(); }

  const APPLIED_TEXT_RE = /you have applied|application sent|applied on|already applied|view application|you applied/;

  function alreadyApplied(root) {
    const text = normalize((root || document.body)?.innerText);
    return APPLIED_TEXT_RE.test(text);
  }

  // The primary "Apply" button (not "Apply with..." variations, not disabled).
  function findApplyButton(root) {
    const candidates = Array.from((root || document).querySelectorAll("button, a.btn, .btn"));
    for (const b of candidates) {
      if (!visible(b)) continue;
      const txt = normalize(b.textContent);
      if (txt !== "apply" && txt !== "apply now") continue;
      if (b.disabled || b.getAttribute("disabled") !== null) continue;
      if (b.getAttribute("ng-disabled") && /!jobdataloaded/i.test(b.getAttribute("ng-disabled")) && b.disabled) continue;
      return b;
    }
    return null;
  }

  // Read the experience requirement (e.g. "0 - 3 years").
  function getExperienceText(root) {
    const scope = root || document;
    const direct = scope.querySelector('.experience, span.experience, [class*="experience"]');
    if (direct) return normalize(direct.textContent);
    const brief = scope.querySelector('i.fa-briefcase, .fa-briefcase');
    if (brief && brief.parentElement) return normalize(brief.parentElement.textContent);
    const cand = Array.from(scope.querySelectorAll("span, div, li")).find((e) => {
      const t = (e.textContent || "").trim();
      return t.length < 30 && /\byears?\b/i.test(t) && /\d/.test(t);
    });
    return cand ? normalize(cand.textContent) : "";
  }

  function getJobTitle(root) {
    const scope = root || document;
    const el = scope.querySelector('h1, .job-title, [class*="job-title"], [class*="jobTitle"]');
    return normalize((el && el.textContent) || document.title);
  }

  // Drop if it wants more than 1 year, or is a senior title.
  function unsuitableReason(root) {
    const exp = getExperienceText(root);
    if (exp) {
      const nums = (exp.toLowerCase().match(/\d+/g) || []).map(Number);
      if (nums.length) {
        const maxY = Math.max(...nums);
        if (maxY > 1 || (/\d+\s*\+/.test(exp) && maxY >= 1)) return "too_experienced:" + exp;
      }
    }
    const title = getJobTitle(root).toLowerCase();
    if (/\bsenior\b|\bsr\.?\b|\blead\b|\bprincipal\b|\bstaff\b|\barchitect\b|\bmanager\b|\biii\b|\biv\b|\bl[2-9]\b/.test(title)) {
      return "senior_title:" + title;
    }
    return null;
  }

  // --- New recommendation-feed flow (modal-based) ---------------------------

  function findCardByJobId(jobId) {
    const skillsList = document.querySelector(`ul[id="job-skills-${jobId}"]`);
    if (!skillsList) return null;
    return skillsList.closest(".employer-block, .employer-row");
  }

  function findViewTrigger(card) {
    return card.querySelector("a.text-link") || card.querySelector("#interested-btn");
  }

  function clickNextPage() {
    const candidates = Array.from(document.querySelectorAll(".pagination li, .pagination a, .pagination span"));
    const next = candidates.find((el) => /next/i.test(normalize(el.textContent)) && !el.classList.contains("hidden"));
    if (!next) return false;
    next.click();
    return true;
  }

  async function findCardWithPaging(jobId) {
    let card = findCardByJobId(jobId);
    if (card) return card;

    for (let page = 0; page < 3 && !card; page++) {
      const moved = clickNextPage();
      if (!moved) break;
      await sleep(1500);
      card = findCardByJobId(jobId);
    }
    return card;
  }

  function findModalRoot() {
    return document.querySelector(".candidate-apply-modal");
  }

  function findModalCloseControl(root) {
    if (!root) return null;
    return (
      root.querySelector(".application-modal-close") ||
      root.querySelector('[ng-click*="close"]') ||
      root.querySelector(".application-modal-backdrop")
    );
  }

  function closeModal() {
    const root = findModalRoot();
    const close = findModalCloseControl(root);
    if (close) { close.click(); return; }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }

  async function doApplyViaModal(jobId) {
    const card = await findCardWithPaging(jobId);
    if (!card) return { status: "failed", error: "job_not_found_on_feed" };

    const trigger = findViewTrigger(card);
    if (!trigger) return { status: "failed", error: "view_trigger_not_found" };

    trigger.click();

    let root = null;
    for (let i = 0; i < 16; i++) {
      root = findModalRoot();
      if (root && root.querySelector("button, a.btn, .btn") && (root.textContent || "").trim().length > 20) break;
      await sleep(400);
      root = null;
    }
    if (!root) return { status: "failed", error: "apply_modal_did_not_open" };

    await sleep(400); // let Angular finish rendering job details

    if (alreadyApplied(root)) {
      closeModal();
      return { status: "already_applied" };
    }

    const reason = unsuitableReason(root);
    if (reason) {
      closeModal();
      return { status: "discarded", error: reason };
    }

    const btn = findApplyButton(root);
    if (!btn) {
      closeModal();
      return { status: "failed", error: "apply_button_not_found" };
    }

    btn.click();

    let result = { status: "failed", error: "apply_unconfirmed" };
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const stillRoot = findModalRoot();
      if (!stillRoot || alreadyApplied(stillRoot) || !findApplyButton(stillRoot)) {
        result = { status: "applied" };
        break;
      }
    }

    closeModal();
    return result;
  }

  // --- Old standalone-page flow (kept as a fallback) ------------------------

  async function doApplyOnPage() {
    let btn = null;
    for (let i = 0; i < 24; i++) {
      if (alreadyApplied()) return { status: "already_applied" };
      btn = findApplyButton();
      if (btn) break;
      await sleep(500);
    }

    const reason = unsuitableReason();
    if (reason) return { status: "discarded", error: reason };

    if (alreadyApplied()) return { status: "already_applied" };
    if (!btn) return { status: "failed", error: "apply_button_not_found" };

    btn.click();

    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (alreadyApplied()) return { status: "applied" };
      if (!findApplyButton()) return { status: "applied" };
    }
    return { status: "failed", error: "apply_unconfirmed" };
  }

  async function doApply() {
    const jobId = new URLSearchParams(window.location.search).get("jid");
    if (jobId) return doApplyViaModal(jobId);
    return doApplyOnPage();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "DO_APPLY") {
      const job_id = message.payload?.job_id;
      doApply()
        .then((r) => sendResponse({ ...r, job_id }))
        .catch((e) => sendResponse({ status: "failed", error: e.message, job_id }));
      return true; // async
    }
  });
})();
