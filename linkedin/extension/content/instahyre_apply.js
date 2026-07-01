// content/instahyre_apply.js — "IH Apply" bulk-apply.
//
// Instahyre has no standalone per-job page anymore: a job can only be reached
// by finding its card on the recommendation feed and clicking it to open an
// in-page Angular modal (ng-click="openApplyModal(opp)"). So there is no way
// to process the apply queue one job at a time with separate navigations —
// instead we open the (filtered) feed ONCE and page/scroll through it in a
// single continuous pass, applying to every card whose job-skills id matches
// something in the pending queue (sent in as `jobs`, keyed by numeric jid).

(() => {
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function cleanText(v) { return (v || "").replace(/\s+/g, " ").trim(); }

  function visible(el) {
    if (!el) return false;
    try {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
      return el.getClientRects().length > 0;
    } catch (e) { return true; }
  }

  const APPLIED_TEXT_RE = /you have applied|application sent|applied on|already applied|view application|you applied/i;
  function alreadyApplied(root) {
    return APPLIED_TEXT_RE.test(cleanText((root || document.body).innerText));
  }

  function findApplyButton(root) {
    const candidates = Array.from((root || document).querySelectorAll("button, a.btn, .btn"));
    for (const b of candidates) {
      if (!visible(b)) continue;
      const txt = cleanText(b.textContent).toLowerCase();
      if (txt !== "apply" && txt !== "apply now") continue;
      if (b.disabled || b.getAttribute("disabled") !== null) continue;
      return b;
    }
    return null;
  }

  function getExperienceText(root) {
    const scope = root || document;
    const direct = scope.querySelector('.experience, span.experience, [class*="experience"]');
    return direct ? cleanText(direct.textContent) : "";
  }

  // Drop if it wants more than 1 year of experience.
  function tooMuchExperience(expText) {
    if (window.__jhJobFilter) return window.__jhJobFilter.tooMuchExperience(expText);
    if (!expText) return false;
    const lower = expText.toLowerCase();
    const nums = (lower.match(/\d+/g) || []).map(Number);
    if (nums.length === 0) return false;
    const maxYear = Math.max(...nums);
    return maxYear > 1 || (/\d+\s*\+/.test(lower) && maxYear >= 1);
  }

  // --- Search-form automation (mirrors instahyre.js's scraper) --------------
  const JOB_FUNCTION_VALUES = ["/api/v1/job_category/1", "/api/v1/job_category/8"];
  const TARGET_YEARS = "0";
  const CATEGORY_HEADER_FALLBACK = { "/api/v1/job_category/1": "Software Engineering" };

  function getJobFunctionsControl() {
    const input = document.getElementById("job-functions-selectized");
    return input ? input.closest(".selectize-control") : null;
  }

  function isJobFunctionSelected(value) {
    const control = getJobFunctionsControl();
    if (!control) return false;
    return Array.from(control.querySelectorAll(".item"))
      .some((el) => el.getAttribute("data-value") === value);
  }

  async function openJobFunctionsDropdown() {
    const control = getJobFunctionsControl();
    const input = document.getElementById("job-functions-selectized");
    if (!control || !input) return null;

    const inputWrap = control.querySelector(".selectize-input");
    (inputWrap || input).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    input.focus();

    for (let i = 0; i < 10; i++) {
      const dropdown = control.querySelector(".selectize-dropdown");
      if (dropdown && dropdown.style.display !== "none") return dropdown;
      await sleep(200);
    }
    return null;
  }

  async function selectJobFunction(value) {
    if (isJobFunctionSelected(value)) return true;

    const dropdown = await openJobFunctionsDropdown();
    if (!dropdown) return false;

    let target = Array.from(dropdown.querySelectorAll(".option"))
      .find((o) => o.getAttribute("data-value") === value);

    if (!target && CATEGORY_HEADER_FALLBACK[value]) {
      const label = CATEGORY_HEADER_FALLBACK[value];
      target = Array.from(dropdown.querySelectorAll(".optgroup-header"))
        .find((h) => cleanText(h.textContent) === label);
    }

    if (!target) return false;

    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    target.click();
    await sleep(400);
    return isJobFunctionSelected(value);
  }

  function setYearsInput(years) {
    const input = document.getElementById("years");
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, years);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  async function applyInstahyreFilters() {
    try {
      let ready = false;
      for (let i = 0; i < 20; i++) {
        if (document.getElementById("job-functions-selectized") &&
            document.getElementById("years") &&
            document.getElementById("show-results")) {
          ready = true;
          break;
        }
        await sleep(300);
      }
      if (!ready) {
        console.log("[Instahyre Apply] Search form not found — applying against the default recommended feed");
        return false;
      }

      for (const value of JOB_FUNCTION_VALUES) await selectJobFunction(value);

      const stillMissing = JOB_FUNCTION_VALUES.filter((v) => !isJobFunctionSelected(v));
      if (stillMissing.length > 0) {
        console.warn("[Instahyre Apply] Job functions did not stick:", stillMissing);
        return false;
      }

      setYearsInput(TARGET_YEARS);
      await sleep(300);

      const showBtn = document.getElementById("show-results");
      if (!showBtn || showBtn.disabled || showBtn.getAttribute("disabled") !== null) {
        console.log("[Instahyre Apply] Show results button disabled");
        return false;
      }

      showBtn.click();
      console.log("[Instahyre Apply] Search filters applied");
      await sleep(2500);
      return true;
    } catch (err) {
      console.warn("[Instahyre Apply] applyInstahyreFilters error:", err.message);
      return false;
    }
  }

  // --- Card / modal helpers --------------------------------------------------
  function getCardNodes() {
    return Array.from(document.querySelectorAll(".employer-block, .employer-row"));
  }

  function extractJobId(card) {
    const skillsList = card.querySelector('ul[id^="job-skills-"]');
    if (!skillsList) return null;
    const m = skillsList.id.match(/job-skills-(\d+)/);
    return m ? m[1] : null;
  }

  function findViewTrigger(card) {
    return card.querySelector("a.text-link") || card.querySelector("#interested-btn");
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

  function clickNextPage() {
    const candidates = Array.from(document.querySelectorAll(".pagination li, .pagination a, .pagination span"));
    const next = candidates.find((el) => /next/i.test(cleanText(el.textContent)) && !el.classList.contains("hidden"));
    if (!next) return false;
    next.click();
    return true;
  }

  async function applyToCard(card) {
    const trigger = findViewTrigger(card);
    if (!trigger) return { status: "failed", error: "view_trigger_not_found" };

    trigger.click();

    let root = null;
    for (let i = 0; i < 16; i++) {
      root = findModalRoot();
      if (root && root.querySelector("button, a.btn, .btn") && cleanText(root.textContent).length > 20) break;
      await sleep(400);
      root = null;
    }
    if (!root) return { status: "failed", error: "apply_modal_did_not_open" };

    await sleep(400); // let Angular finish rendering job details

    if (alreadyApplied(root)) {
      closeModal();
      return { status: "already_applied" };
    }

    const exp = getExperienceText(root);
    if (tooMuchExperience(exp)) {
      closeModal();
      return { status: "discarded", error: "too_experienced:" + exp };
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

  // jobs: [{ id, job_id, jid }] — id/job_id are our backend's identifiers
  // (reported back per result), jid is Instahyre's numeric job id used to
  // match against each card's job-skills-<jid> element.
  async function runApplyBatch(jobs) {
    const pending = new Map(jobs.filter((j) => j.jid).map((j) => [String(j.jid), j]));
    const processedJids = new Set();
    const results = [];

    console.log(`[Instahyre Apply] Starting batch — ${pending.size} job(s) to look for`);
    await applyInstahyreFilters();

    let cycles = 0;
    let idleCycles = 0;
    let pageClicks = 0;
    const MAX_CYCLES = 40;
    const MAX_IDLE = 6;
    const MAX_PAGES = 10;

    while (pending.size > 0 && cycles < MAX_CYCLES && pageClicks < MAX_PAGES) {
      cycles++;
      let foundThisCycle = 0;

      for (const card of getCardNodes()) {
        if (pending.size === 0) break;
        const jid = extractJobId(card);
        if (!jid || processedJids.has(jid) || !pending.has(jid)) continue;

        processedJids.add(jid);
        const task = pending.get(jid);
        pending.delete(jid);
        foundThisCycle++;

        try {
          const outcome = await applyToCard(card);
          console.log(`[Instahyre Apply] jid=${jid} ->`, outcome.status, outcome.error || "");
          results.push({ id: task.id, job_id: task.job_id, ...outcome });
        } catch (err) {
          console.warn(`[Instahyre Apply] jid=${jid} error:`, err.message);
          results.push({ id: task.id, job_id: task.job_id, status: "failed", error: err.message });
          closeModal();
        }

        await sleep(600);
      }

      if (foundThisCycle > 0) idleCycles = 0; else idleCycles++;

      if (pending.size === 0) break;

      window.scrollBy({ top: 900, behavior: "smooth" });
      await sleep(1500);

      const atBottom = (window.scrollY + window.innerHeight) >= (document.documentElement.scrollHeight - 150);
      if (idleCycles >= MAX_IDLE || atBottom) {
        const moved = clickNextPage();
        if (moved) {
          pageClicks++;
          idleCycles = 0;
          await sleep(2200);
        } else if (idleCycles >= MAX_IDLE) {
          console.log("[Instahyre Apply] No more pages/cards — stopping");
          break;
        }
      }
    }

    console.log(`[Instahyre Apply] Batch done — ${results.length} processed, ${pending.size} not found on feed`);
    return results;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "DO_APPLY_BATCH") {
      runApplyBatch(message.payload?.jobs || [])
        .then((results) => sendResponse({ results }))
        .catch((e) => sendResponse({ results: [], error: e.message }));
      return true; // async
    }
  });
})();
