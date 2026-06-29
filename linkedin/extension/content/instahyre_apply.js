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

  async function doApply() {
    // Wait for the page / Angular job data to load and the button to enable.
    let btn = null;
    for (let i = 0; i < 24; i++) {
      if (alreadyApplied()) return { status: "already_applied" };
      btn = findApplyButton();
      if (btn) break;
      await sleep(500);
    }
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
