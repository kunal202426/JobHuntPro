// content/linkedin_connect.js — LinkedIn profile connect handler (Phase 6)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isCheckpointPage() {
  return /\/(checkpoint|challenge|authwall|login)/.test(window.location.pathname);
}

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function findSendWithoutNoteButton(scope = document) {
  const root = scope || document;
  const selectors = [
    'button[aria-label="Send without a note"]',
    '[aria-label="Send without a note"]',
    'button[aria-label*="Send without a note" i]',
    '[aria-label*="Send without a note" i]',
    'button[aria-label*="send without" i]',
    '[aria-label*="send without" i]',
  ];

  for (const sel of selectors) {
    let found = [];
    try { found = Array.from(root.querySelectorAll(sel)); } catch (e) { continue; }
    for (const btn of found) {
      if (btn && !btn.disabled) return btn;
    }
  }

  const candidates = Array.from(root.querySelectorAll("button, [role='button'], [componentkey], [aria-label]"));
  for (const el of candidates) {
    const text = normalizeText(el.textContent || "");
    const label = normalizeText(el.getAttribute?.("aria-label") || "");
    if ((/^send without a note$/i.test(text) || /^send without a note$/i.test(label)) && !el.disabled) {
      return el;
    }
  }

  return null;
}

function isElementVisible(el) {
  if (!el) return false;
  try {
    if (el.disabled) return false;
    const style = window.getComputedStyle(el);
    if (!style) return true;
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    if (el.getClientRects && el.getClientRects().length === 0) return false;
    return true;
  } catch (e) {
    return !el.disabled;
  }
}

function getSearchRoots() {
  const roots = [document];
  const stack = [document];
  const seen = new Set([document]);

  while (stack.length) {
    const root = stack.pop();
    let nodes = [];
    try {
      nodes = root.querySelectorAll ? Array.from(root.querySelectorAll("*")) : [];
    } catch (e) { /* ignore */ }

    for (const node of nodes) {
      if (node && node.shadowRoot && !seen.has(node.shadowRoot)) {
        seen.add(node.shadowRoot);
        roots.push(node.shadowRoot);
        stack.push(node.shadowRoot);
      }
      if (node && node.tagName === "IFRAME") {
        try {
          const doc = node.contentDocument;
          if (doc && !seen.has(doc)) {
            seen.add(doc);
            roots.push(doc);
            stack.push(doc);
          }
        } catch (e) { /* cross-origin iframe */ }
      }
    }
  }

  return roots;
}

function findSendWithoutNoteButtonDeep() {
  const roots = getSearchRoots();
  for (const root of roots) {
    const btn = findSendWithoutNoteButton(root);
    if (btn && isElementVisible(btn)) return btn;
  }

  for (const root of roots) {
    let candidates = [];
    try {
      candidates = Array.from(root.querySelectorAll("button, [role='button'], span, div"));
    } catch (e) { /* ignore */ }

    for (const el of candidates) {
      const text = normalizeText(el.textContent || "");
      if (!/send without a note/i.test(text)) continue;
      const btn = el.closest ? (el.closest("button, [role='button']") || el) : el;
      if (btn && isElementVisible(btn)) return btn;
    }
  }

  return null;
}

function collectActionButtonDebug() {
  const out = [];
  const roots = getSearchRoots();
  for (const root of roots) {
    let candidates = [];
    try {
      candidates = Array.from(root.querySelectorAll("button, [role='button']"));
    } catch (e) { /* ignore */ }

    for (const el of candidates) {
      const text = normalizeText(el.textContent || "");
      const label = normalizeText(el.getAttribute?.("aria-label") || "");
      const blob = `${text} | ${label}`.toLowerCase();
      if (!/(send|note|connect|invite)/i.test(blob)) continue;
      out.push({
        text: text.slice(0, 120),
        ariaLabel: label.slice(0, 120),
        visible: isElementVisible(el),
        className: normalizeText(el.className || "").slice(0, 120)
      });
      if (out.length >= 25) return out;
    }
  }
  return out;
}

function robustClick(el) {
  if (!el) return false;
  // Click the nearest interactive ancestor if the matched node is a label/icon wrapper.
  const target = (el.closest && el.closest('button, a, [role="button"], [componentkey], [aria-label]')) || el;
  try {
    const rect = target.getBoundingClientRect && target.getBoundingClientRect();
    const cx = rect ? rect.left + Math.min(10, (rect.width || 4) / 2) : 2;
    const cy = rect ? rect.top + Math.min(10, (rect.height || 4) / 2) : 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 };
    // Pointer events FIRST — LinkedIn's new custom components listen for these,
    // and a bare .click() often does nothing on them.
    try {
      target.dispatchEvent(new PointerEvent("pointerover", opts));
      target.dispatchEvent(new PointerEvent("pointerenter", opts));
      target.dispatchEvent(new PointerEvent("pointerdown", { ...opts, isPrimary: true }));
      target.dispatchEvent(new PointerEvent("pointerup", { ...opts, isPrimary: true }));
    } catch (e) { /* PointerEvent unsupported — fall through to mouse events */ }
    target.dispatchEvent(new MouseEvent("mousedown", opts));
    target.dispatchEvent(new MouseEvent("mouseup", opts));
    target.dispatchEvent(new MouseEvent("click", opts));
  } catch (e) { /* ignore */ }
  // Native click triggers LinkedIn's real handler. For menu links that would
  // also navigate to the href — callers wrap this in withNavigationGuard() to
  // cancel that navigation while still letting the handler open the modal.
  try { target.click(); } catch (e) { /* ignore */ }
  return true;
}

// Run a click while cancelling any resulting navigation to a LinkedIn invite
// link, so the SPA opens the "Send invitation" modal in place instead of
// loading the /preload/custom-invite URL as a full page.
function withNavigationGuard(fn) {
  const guard = (e) => {
    try {
      const a = e.target && e.target.closest && e.target.closest('a[href*="custom-invite" i], a[href*="/preload/" i]');
      if (a) e.preventDefault();
    } catch (err) { /* ignore */ }
  };
  document.addEventListener("click", guard, true);
  try { fn(); }
  finally { setTimeout(() => { try { document.removeEventListener("click", guard, true); } catch (e) {} }, 80); }
}

function getProfileTopCard() {
  const selectors = [
    ".pv-top-card",
    "[data-view-name='profile-top-card']",
    ".profile-topcard-summary-info",
    ".artdeco-card.pv-top-card",
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function isFirstDegreeConnection() {
  const top = getProfileTopCard();
  const text = normalizeText(top?.innerText || "");
  return /\b1st\b/.test(text);
}

// The name of the profile we're currently viewing (main heading).
function getCurrentProfileName() {
  const h1 = document.querySelector("main h1") || document.querySelector("h1");
  return normalizeText(h1 ? h1.textContent : "").toLowerCase();
}

// Make sure an "Invite <name> to connect" button is for the CURRENT profile,
// not someone in the "People similar / More profiles" carousels.
function labelMatchesProfile(label, profileName) {
  const m = (label || "").toLowerCase().match(/invite (.+?) to connect/);
  if (!m) return true;            // not a named-invite button — don't name-filter
  if (!profileName) return true;  // unknown current profile — can't filter
  const who = m[1].trim();
  if (who.includes(profileName) || profileName.includes(who)) return true;
  const pFirst = profileName.split(/\s+/)[0];
  const wFirst = who.split(/\s+/)[0];
  return !!pFirst && pFirst === wFirst;
}

function findDirectConnectButton() {
  const profileName = getCurrentProfileName();
  const selectors = [
    // New LinkedIn UI: the Connect control is often a <div>/custom element with
    // aria-label "Invite <name> to connect" and a componentkey attribute.
    '[aria-label^="Invite"][aria-label*="to connect" i]',
    '[componentkey][aria-label*="to connect" i]',
    // Older UI variants
    'button[aria-label*="Connect"]',
    'button[aria-label*="Invite"][aria-label*="connect" i]',
    'div[aria-label*="Invite"][aria-label*="connect" i]',
    'div[aria-label*="Connect" i]',
    '.pvs-profile-actions button[aria-label*="Connect"]',
    '.pv-s-profile-actions button[aria-label*="Connect"]',
    '[data-view-name="profile-top-card-cta"] button[aria-label*="Connect"]',
    '.artdeco-button--2[aria-label*="Connect"]',
  ];
  for (const sel of selectors) {
    let matches = [];
    try { matches = Array.from(document.querySelectorAll(sel)); } catch (e) { continue; }
    for (const btn of matches) {
      if (!btn || btn.disabled) continue;
      const label = (btn.getAttribute("aria-label") || "").toLowerCase();
      if (/message|follow|pending|withdraw|remove connection/i.test(label)) continue;
      if (!isElementVisible(btn)) continue;
      // Don't grab a "People similar" card's Connect for a different person.
      if (!labelMatchesProfile(label, profileName)) continue;
      return btn;
    }
  }
  // Fallback: search for visible text "Connect" inside the top card (some pages render as div/span)
  const byText = findConnectByText();
  if (byText) return byText;
  return null;
}

function findConnectByText() {
  // Only search a real top card. If we can't find one (new UI), return null so
  // the flow uses the "More" dropdown — searching document.body here risks
  // grabbing a "People similar" carousel Connect for a different person.
  const top = getProfileTopCard();
  if (!top) return null;
  const profileName = getCurrentProfileName();
  const cand = Array.from(top.querySelectorAll("div,span,p,a,button"));
  for (const el of cand) {
    const txt = normalizeText(el.textContent || "").toLowerCase();
    if (txt === "connect" || /\bconnect\b/.test(txt)) {
      const clickable = (el.closest && el.closest('button, a, [role="button"], div[aria-label*="connect" i], div[aria-label*="invite" i]'))
        || (el.tagName === "BUTTON" && !el.disabled ? el : null);
      if (!clickable) continue;
      const label = (clickable.getAttribute && clickable.getAttribute("aria-label")) || "";
      if (!labelMatchesProfile(label, profileName)) continue;
      return clickable;
    }
  }
  return null;
}

function isAlreadyConnected() {
  const msgBtn = document.querySelector(
    'button[aria-label*="Message"], a[aria-label*="Message"]'
  );
  return !!msgBtn && !findDirectConnectButton() && isFirstDegreeConnection();
}

function hasPendingInviteIndicatorGlobal() {
  const textCandidates = Array.from(document.querySelectorAll("button, a, span, div, p"));
  for (const el of textCandidates) {
    if (!isElementVisible(el)) continue;
    const text = normalizeText(el.textContent || "");
    if (!/^pending$/i.test(text) && !/withdraw invitation/i.test(text)) continue;

    // Heuristic: profile action chips are usually in the upper viewport.
    try {
      const r = el.getBoundingClientRect();
      if (r && r.top > 900) continue;
    } catch (e) { /* ignore */ }

    return true;
  }

  // Specific marker from your inspect snippet
  const clockIcon = document.querySelector('svg#clock-small');
  if (clockIcon) {
    const host = clockIcon.closest("button, a, span, div");
    const text = normalizeText(host?.textContent || "");
    if (/pending/i.test(text)) return true;
  }

  // aria-label based pending chips/buttons
  const ariaPending = document.querySelector(
    '[aria-label*="pending" i], [aria-label*="withdraw invitation" i]'
  );
  if (ariaPending && isElementVisible(ariaPending)) return true;

  return false;
}

// STRICT "we already invited this person" check. The only reliable signal is a
// visible "Withdraw invitation" control near the top of the profile — that
// exists ONLY for someone you personally invited. We do NOT use loose "Pending"
// text, which can come from carousels / nav and caused false "Sent".
function isAlreadyInvited() {
  const els = Array.from(document.querySelectorAll('button, a, [role="button"], [aria-label]'));
  for (const el of els) {
    if (!isElementVisible(el)) continue;
    const label = normalizeText((el.getAttribute && el.getAttribute("aria-label")) || "").toLowerCase();
    const text = normalizeText(el.textContent || "").toLowerCase();
    if (!/withdraw invitation/.test(label) && !/withdraw invitation/.test(text)) continue;
    try { const r = el.getBoundingClientRect(); if (r && r.top > 700) continue; } catch (e) { /* ignore */ }
    return true;
  }
  return false;
}

function isPending() {
  // Classic button-style pending state
  if (document.querySelector('button[aria-label*="Pending"], button[aria-label*="pending"]')) {
    return true;
  }

  // New UI often renders pending as plain text/icon inside the profile top card.
  const top = getProfileTopCard();
  if (top) {
    const pendingText = Array.from(top.querySelectorAll("button, a, span, div, p")).some((el) => {
      const text = normalizeText(el.textContent || "");
      return /\bpending\b/i.test(text);
    });
    if (pendingText) return true;

    // Another common post-invite state
    const withdrawInvite = Array.from(top.querySelectorAll("button, a, span, div, p")).some((el) => {
      const text = normalizeText(el.textContent || "");
      return /withdraw invitation/i.test(text);
    });
    if (withdrawInvite) return true;
  }

  // Fallback for UI variants where top-card selectors fail.
  if (hasPendingInviteIndicatorGlobal()) return true;

  return false;
}

function isFollowOnly() {
  const followBtn = document.querySelector('button[aria-label*="Follow"]');
  return !!followBtn && !findDirectConnectButton();
}

function findMenuContainer() {
  const menus = Array.from(document.querySelectorAll(
    "[role='menu'], .artdeco-dropdown__content, .artdeco-dropdown__content-inner, .artdeco-dropdown__item-container, [popover='manual'] [role='menu']"
  ));
  for (const menu of menus) {
    if (isElementVisible(menu)) return menu;
  }
  return menus[0] || null;
}

function findMenuItemByText(menu, textPattern) {
  if (!menu) return null;
  const candidates = Array.from(menu.querySelectorAll(
    "button, a, [role='menuitem'], [role='option'], p, span, div"
  ));
  for (const el of candidates) {
    const text = normalizeText(el.textContent).toLowerCase();
    if (textPattern.test(text)) return el;
  }
  return null;
}

function menuLooksLikeActionPopover(menu) {
  if (!menu) return false;
  try {
    const text = normalizeText(menu.textContent || "").toLowerCase();
    if (/connect|invite|send profile|save to pdf|report|about this member/.test(text)) return true;
    const items = menu.querySelectorAll ? menu.querySelectorAll('[role="menuitem"], a[role="menuitem"]') : [];
    return items.length > 0;
  } catch (e) {
    return false;
  }
}

async function waitForActionMenu(timeoutMs = 3500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const menus = Array.from(document.querySelectorAll(
      "[popover='manual'] [role='menu'], [role='menu'], .artdeco-dropdown__content, .artdeco-dropdown__content-inner, .artdeco-dropdown__item-container"
    ));
    for (const menu of menus) {
      if (!isElementVisible(menu)) continue;
      if (menuLooksLikeActionPopover(menu)) return menu;
    }
    await sleep(120);
  }
  return null;
}

function closeAnyMenu() {
  try {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
  } catch (e) { /* ignore */ }
  try { document.body.click(); } catch (e) { /* ignore */ }
}

// Find the Connect item inside an opened dropdown menu (new UI: an <a> whose
// href points at /preload/custom-invite, or any node labelled "...to connect").
function findConnectInMenu(menu) {
  if (!menu) return null;
  const byHref = menu.querySelector('a[href*="custom-invite" i]');
  if (byHref) return byHref;
  const byLabel = menu.querySelector('[aria-label*="to connect" i], [aria-label*="invite" i][aria-label*="connect" i]');
  if (byLabel) return byLabel;
  // Text fallback — a menuitem whose visible text is exactly "Connect"
  const items = Array.from(menu.querySelectorAll('a[role="menuitem"], [role="menuitem"], [role="option"], button, li, div[aria-label]'));
  for (const el of items) {
    const text = normalizeText(el.textContent || "").toLowerCase();
    if (text === "connect" || /\bconnect\b/.test(text)) return el;
  }
  return null;
}

async function tryMoreActionsConnect() {
  // The new LinkedIn profile has SEVERAL "More" buttons (profile actions AND
  // every post in the activity feed). Clicking the wrong one opens a post menu
  // with no Connect. So: gather all "More" buttons, try them top-to-bottom, and
  // only use the one whose dropdown actually contains a Connect/custom-invite item.
  let moreButtons = Array.from(document.querySelectorAll(
    'button[aria-label="More"], button[aria-label="More actions"], button[aria-label*="more actions" i], [componentkey][aria-label="More"], button[aria-haspopup="menu"], button[aria-expanded][aria-label*="more" i]'
  )).filter(isElementVisible);

  // De-dupe and sort by vertical position (profile action More sits near the top).
  moreButtons = Array.from(new Set(moreButtons)).sort((a, b) => {
    try { return a.getBoundingClientRect().top - b.getBoundingClientRect().top; } catch (e) { return 0; }
  });

  if (moreButtons.length === 0) return { element: null, followOnly: false };

  let sawFollow = false;

  for (const moreBtn of moreButtons) {
    robustClick(moreBtn);
    await sleep(400);

    const menu = await waitForActionMenu(2500) || findMenuContainer();
    if (!menu) { closeAnyMenu(); await sleep(150); continue; }

    // Already invited? The profile menu shows "Withdraw invitation"/"Pending"
    // instead of a Connect (custom-invite) item.
    const menuTxt = normalizeText(menu.textContent || "").toLowerCase();
    if (/withdraw invitation/.test(menuTxt) && !menu.querySelector('a[href*="custom-invite" i]')) {
      closeAnyMenu();
      return { element: null, followOnly: false, pending: true };
    }

    const connectEl = findConnectInMenu(menu);
    if (connectEl) {
      // Prefer the inner labelled element ("Invite … to connect") over the
      // wrapping <a>, so the click lands like a real user tap and the SPA opens
      // the invite modal rather than navigating to the custom-invite href.
      const inner = connectEl.querySelector && connectEl.querySelector('[aria-label*="to connect" i]');
      const btn = inner || connectEl;
      // Real click (opens the invite modal) but cancel the link navigation.
      withNavigationGuard(() => robustClick(btn));
      return { element: btn, followOnly: false };
    }

    if (findMenuItemByText(menu, /\bfollow\b/i)) sawFollow = true;

    // Wrong menu (e.g. a post's menu) or Connect simply isn't here — close, try next.
    closeAnyMenu();
    await sleep(200);
  }

  // No menu had Connect. If we only ever saw Follow, treat as follow-only.
  if (sawFollow) return { element: null, followOnly: true };
  return { element: null, followOnly: false };
}

// STRICT success: only the CURRENT person's Pending state counts. We do NOT use
// the global "Invitation sent" toast — the extension reuses one tab and a toast
// from a previous person lingers, which caused false positives.
function inviteSucceeded() {
  return isAlreadyInvited();
}

// LinkedIn refused the invite (weekly limit, "moving too fast", upsell, etc.).
// If this is up after we click Send, the invite did NOT go out.
function hasInviteBlockedDialog() {
  const scopes = Array.from(document.querySelectorAll('[role="dialog"], .artdeco-modal, [role="alert"], .artdeco-toast-item'));
  for (const s of scopes) {
    if (!isElementVisible(s)) continue;
    const txt = normalizeText(s.textContent || "").toLowerCase();
    if (/weekly (invitation|invite) limit|reached the (weekly|monthly)|moving too fast|want to stand out|you('| a)re out of invitations|try again later|upgrade to|premium/.test(txt)) {
      return true;
    }
  }
  return false;
}

// The "Send invitation" dialog: classic artdeco modal (class send-invite), or
// any visible dialog that contains the Send-without-a-note / Add-a-note actions.
function getSendInviteModal() {
  const byClass = document.querySelector(".artdeco-modal.send-invite, [data-test-modal].send-invite");
  if (byClass && isElementVisible(byClass)) return byClass;
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .artdeco-modal'));
  for (const d of dialogs) {
    if (!isElementVisible(d)) continue;
    if (d.querySelector('[aria-label*="Send without a note" i], [aria-label*="Add a note" i]')) return d;
  }
  return null;
}

function hasEmailGate() {
  const dialog = document.querySelector('[role="dialog"], .artdeco-modal');
  if (!dialog || !isElementVisible(dialog)) return false;
  if (dialog.querySelector('input[type="email"], input[name="email"], input[id*="email" i], input[name*="email" i]')) return true;
  // Some variants use a plain text input with an "email to verify" prompt.
  const txt = normalizeText(dialog.textContent || "").toLowerCase();
  if (/enter .{0,16}email|email .{0,10}to connect|to verify .{0,30}member|please enter .{0,20}email/.test(txt)) return true;
  return false;
}

async function handleConnectModal() {
  const TIMEOUT_MS = 15000;
  const start = Date.now();

  // 1) Wait for the invite modal — detected by its "Send without a note" button
  //    (deep search across shadow DOM / layers). This is more reliable than
  //    matching a modal container class, which LinkedIn changes.
  let sendBtn = null;
  while (Date.now() - start < 8000) {
    if (inviteSucceeded()) return "sent";
    if (hasEmailGate()) {
      const closeBtn = document.querySelector('button[aria-label="Dismiss"], [aria-label="Dismiss"], button[aria-label*="close" i]');
      if (closeBtn) robustClick(closeBtn);
      return "email_required";
    }
    sendBtn = findSendWithoutNoteButtonDeep();
    if (sendBtn) break;
    await sleep(300);
  }
  if (!sendBtn) {
    if (inviteSucceeded()) return "sent";
    try { console.warn("[LinkedIn Connect] no 'Send without a note' button appeared — debug:", collectActionButtonDebug()); } catch (e) {}
    return "modal_timeout";
  }

  // 2) Click it.
  robustClick(sendBtn);

  // 3) Confirm: the "Send without a note" button goes away (LinkedIn closes the
  //    modal only on a real send), and no blocked/limit dialog took its place.
  while (Date.now() - start < TIMEOUT_MS) {
    await sleep(400);
    if (hasInviteBlockedDialog()) return "invite_blocked";
    if (inviteSucceeded()) return "sent";
    if (!findSendWithoutNoteButtonDeep()) {
      if (hasInviteBlockedDialog()) return "invite_blocked";
      if (hasEmailGate()) return "email_required";
      return "sent";
    }
  }
  return "send_unconfirmed";
}

async function attemptConnect(profile_url) {
  if (isCheckpointPage()) {
    return { status: "failed", error: "captcha_checkpoint" };
  }

  // Wait for profile top card to render (max 4s)
  const profileSelectors = [
    ".pv-top-card",
    "[data-view-name='profile-top-card']",
    ".profile-topcard-summary-info",
    ".artdeco-card.pv-top-card",
  ];
  let waited = 0;
  while (waited < 4000) {
    if (profileSelectors.some(sel => document.querySelector(sel))) break;
    await sleep(400);
    waited += 400;
  }

  // Verify we're on the correct profile
  if (profile_url) {
    const targetPath = profile_url.replace(/^https?:\/\/[^/]+/, "").split("?")[0].replace(/\/$/, "");
    const currentPath = window.location.pathname.replace(/\/$/, "");
    if (targetPath && !currentPath.startsWith(targetPath)) {
      return { status: "failed", error: "wrong_page" };
    }
  }

  if (isAlreadyConnected()) return { status: "already_connected" };
  if (isAlreadyInvited())    return { status: "already_pending" };

  // Case A: a directly-visible Connect button (rare on the new UI).
  const directBtn = findDirectConnectButton();
  if (directBtn) {
    withNavigationGuard(() => robustClick(directBtn));
  } else {
    // Case B: Connect lives in the "More" dropdown. tryMoreActionsConnect opens
    // the correct menu and clicks Connect itself (don't click again here).
    const res = await tryMoreActionsConnect();
    if (res.pending) return { status: "already_pending" };
    if (res.followOnly) return { status: "no_button", error: "follow_only" };
    if (!res.element) {
      if (isAlreadyInvited()) return { status: "already_pending" };
      if (isFollowOnly()) return { status: "no_button", error: "follow_only" };
      return { status: "no_button", error: "connect_button_not_found" };
    }
  }

  // Single place that finds the invite modal, clicks "Send without a note", and
  // verifies the invite actually went out (modal closes / withdraw-invitation).
  const modalResult = await handleConnectModal();
  if (modalResult === "sent") return { status: "sent" };
  if (modalResult === "email_required") return { status: "no_button", error: "email_required" };
  if (isAlreadyInvited()) return { status: "sent" };
  return { status: "failed", error: modalResult };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "DO_CONNECT") {
    const { profile_url, queue_id } = message.payload || {};
    (async () => {
      try {
        const result = await attemptConnect(profile_url);
        console.log("[LinkedIn Connect] Result:", result.status, result.error || "");
        sendResponse({ ...result, queue_id });
      } catch (err) {
        console.error("[LinkedIn Connect] Error:", err.message);
        sendResponse({ status: "failed", error: err.message, queue_id });
      }
    })();
    return true; // async
  }
});
