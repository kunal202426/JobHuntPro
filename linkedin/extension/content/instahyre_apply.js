// content/instahyre_apply.js — clicks Instahyre's "Apply" button on a job page.
// The button is an AngularJS control: <button class="btn btn-primary"
// ng-click="submitChoiceNonMatching()">Apply</button>. A native .click()
// triggers the ng-click handler.

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

  function alreadyApplied() {
    const body = normalize(document.body && document.body.innerText);
    return /you have applied|application sent|applied on|already applied|view application|you applied/.test(body);
  }

  // The primary "Apply" button (not "Apply with..." variations, not disabled).
  function findApplyButton() {
    const candidates = Array.from(document.querySelectorAll("button, a.btn, .btn"));
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

  // Read the experience requirement from the detail page (e.g. "7-11 Years").
  function getExperienceText() {
    const direct = document.querySelector('.experience, span.experience, [class*="experience"]');
    if (direct) return normalize(direct.textContent);
    const brief = document.querySelector('i.fa-briefcase, .fa-briefcase');
    if (brief && brief.parentElement) return normalize(brief.parentElement.textContent);
    const cand = Array.from(document.querySelectorAll("span, div, li")).find((e) => {
      const t = (e.textContent || "").trim();
      return t.length < 30 && /\byears?\b/i.test(t) && /\d/.test(t);
    });
    return cand ? normalize(cand.textContent) : "";
  }

  function getJobTitle() {
    const el = document.querySelector('h1, .job-title, [class*="job-title"], [class*="jobTitle"]');
    return normalize((el && el.textContent) || document.title);
  }

  // Drop if it wants more than 2 years, or is a senior title.
  function unsuitableReason() {
    const exp = getExperienceText();
    if (exp) {
      const nums = (exp.toLowerCase().match(/\d+/g) || []).map(Number);
      if (nums.length) {
        const maxY = Math.max(...nums);
        if (maxY > 2 || (/\d+\s*\+/.test(exp) && maxY >= 2)) return "too_experienced:" + exp;
      }
    }
    const title = getJobTitle().toLowerCase();
    if (/\bsenior\b|\bsr\.?\b|\blead\b|\bprincipal\b|\bstaff\b|\barchitect\b|\bmanager\b|\biii\b|\biv\b|\bl[2-9]\b/.test(title)) {
      return "senior_title:" + title;
    }
    return null;
  }

  async function doApply() {
    // Wait for the page / Angular job data to load and the button to enable.
    let btn = null;
    for (let i = 0; i < 24; i++) {
      if (alreadyApplied()) return { status: "already_applied" };
      btn = findApplyButton();
      if (btn) break;
      await sleep(500);
    }

    // Experience / seniority gate — read from the detail page and skip if unfit.
    const reason = unsuitableReason();
    if (reason) return { status: "discarded", error: reason };

    if (alreadyApplied()) return { status: "already_applied" };
    if (!btn) return { status: "failed", error: "apply_button_not_found" };

    btn.click();

    // Verify: applied-confirmation text appears, or the Apply button goes away.
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (alreadyApplied()) return { status: "applied" };
      if (!findApplyButton()) return { status: "applied" };
    }
    return { status: "failed", error: "apply_unconfirmed" };
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
