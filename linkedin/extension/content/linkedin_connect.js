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
    'button[aria-label*="Send without a note" i]',
    'button[aria-label*="send without" i]',
  ];

  for (const sel of selectors) {
    const btn = root.querySelector(sel);
    if (btn && !btn.disabled) return btn;
  }

  const candidates = Array.from(root.querySelectorAll("button, [role='button']"));
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
  try { el.click(); } catch (e) { /* ignore */ }
  try {
    const rect = el.getBoundingClientRect && el.getBoundingClientRect();
    const evOpts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect ? rect.left + 2 : 2,
      clientY: rect ? rect.top + 2 : 2
    };
    el.dispatchEvent(new MouseEvent("mousedown", evOpts));
    el.dispatchEvent(new MouseEvent("mouseup", evOpts));
    el.dispatchEvent(new MouseEvent("click", evOpts));
  } catch (e) { /* ignore */ }
  return true;
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

function findDirectConnectButton() {
  const selectors = [
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
    const btn = document.querySelector(sel);
    if (!btn || btn.disabled) continue;
    const label = (btn.getAttribute("aria-label") || "").toLowerCase();
    if (/message|follow|pending|withdraw/i.test(label)) continue;
    return btn;
  }
  // Fallback: search for visible text "Connect" inside the top card (some pages render as div/span)
  const byText = findConnectByText();
  if (byText) return byText;
  return null;
}

function findConnectByText() {
  const top = getProfileTopCard() || document.body;
  const cand = Array.from(top.querySelectorAll("div,span,p,a,button"));
  for (const el of cand) {
    const txt = normalizeText(el.textContent || "").toLowerCase();
    if (txt === "connect" || /\bconnect\b/.test(txt)) {
      // prefer a clickable/button element
      if (el.closest && el.closest('button, a, [role="button"], div[aria-label*="connect" i], div[aria-label*="invite" i]')) {
        return el.closest('button, a, [role="button"], div[aria-label*="connect" i], div[aria-label*="invite" i]');
      }
      if (el.tagName === 'BUTTON' && !el.disabled) return el;
      // if element itself is clickable
      if (el.getAttribute && (el.getAttribute('role') === 'button' || el.onclick)) return el;
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

async function tryMoreActionsConnect() {
  // LinkedIn uses different aria-labels like "More" or "More actions"
  const moreBtn = document.querySelector(
    'button[aria-label="More"], button[aria-label*="more" i], button[aria-label*="More actions" i], button[aria-label*="more actions" i], button[aria-haspopup="menu"]'
  );
  if (!moreBtn) return { element: null, followOnly: false };

  robustClick(moreBtn);
  await sleep(300);

  const menu = await waitForActionMenu(3500) || findMenuContainer();
  if (!menu) return { element: null, followOnly: false };
  const connectByHref = menu.querySelector(
    'a[role="menuitem"][href*="/preload/custom-invite" i], a[role="menuitem"][href*="custom-invite" i]'
  );
  const connectByLabel = menu.querySelector(
    '[aria-label*="invite" i][aria-label*="connect" i], [aria-label*="to connect" i]'
  );
  const connectByText = findMenuItemByText(menu, /\bconnect\b/i);
  const connectEl = connectByHref || connectByLabel || connectByText;
  const followEl = findMenuItemByText(menu, /\bfollow\b/i);

  if (connectEl) {
    const btn = connectEl.closest("button, [role='menuitem'], [role='option'], a, [role='button'], div[aria-label], li") || connectEl;
    robustClick(btn);
    return { element: btn, followOnly: false };
  }

  // Only mark follow-only when we can see a follow action and no invite/connect marker at all.
  const hasAnyInviteConnect = !!menu.querySelector(
    'a[role="menuitem"][href*="custom-invite" i], [aria-label*="invite" i][aria-label*="connect" i], [aria-label*="to connect" i]'
  );
  if (followEl && !hasAnyInviteConnect) {
    try { document.body.click(); } catch (e) { /* ignore */ }
    return { element: null, followOnly: true };
  }

  const items = menu.querySelectorAll(
    '[role="option"], .artdeco-dropdown__item, li.mn-overflow-menu__option, [role="menuitem"], a[role="menuitem"], div[aria-label*="connect" i], div[aria-label*="invite" i]'
  );
  for (const item of items) {
    const itemText = normalizeText(item.textContent || "");
    const itemLabel = normalizeText(item.getAttribute?.("aria-label") || "");
    if (/connect/i.test(itemText) || /connect/i.test(itemLabel)) {
      const btn = item.querySelector("button, [role='button']") || item;
      robustClick(btn);
      return { element: btn, followOnly: false };
    }
  }

  const globalInviteMenuItem = Array.from(menu.querySelectorAll('a[role="menuitem"], [role="menuitem"]')).find((el) => {
    if (!isElementVisible(el)) return false;
    const href = normalizeText(el.getAttribute?.("href") || "");
    const label = normalizeText(el.getAttribute?.("aria-label") || "");
    const text = normalizeText(el.textContent || "");
    return /custom-invite/i.test(href) || (/invite/i.test(label) && /connect/i.test(label)) || /\bconnect\b/i.test(text);
  });
  if (globalInviteMenuItem) {
    const btn = globalInviteMenuItem.closest("a, button, [role='menuitem'], [role='button'], div[aria-label]") || globalInviteMenuItem;
    robustClick(btn);
    return { element: btn, followOnly: false };
  }

  // Connect not in dropdown — close it
  document.body.click();
  return { element: null, followOnly: false };
}

async function handleConnectModal() {
  const TIMEOUT_MS = 20000;
  const start = Date.now();

  // Helper: if the profile shows Pending/Message, consider it successful
  function detectConnectionSuccess() {
    if (isPending()) return true;
    if (isAlreadyConnected()) return true;
    const top = getProfileTopCard();
    if (!top) return false;
    // look for Message button or Pending label in top card
    const msg = top.querySelector('button[aria-label*="Message"], a[aria-label*="Message"]');
    if (msg) return true;
    const pendingText = Array.from(top.querySelectorAll('button, span, div')).some(el => /pending/i.test(normalizeText(el.textContent || '')));
    if (pendingText) return true;
    return false;
  }

  while (Date.now() - start < TIMEOUT_MS) {
    // If connect resulted in immediate DOM change, treat as sent
    if (detectConnectionSuccess()) return "sent";

    // Some LinkedIn variants render the button outside an obvious modal container.
    const globalSendWithoutNoteBtn = findSendWithoutNoteButtonDeep();
    if (globalSendWithoutNoteBtn) {
      robustClick(globalSendWithoutNoteBtn);
      await sleep(900);
      if (detectConnectionSuccess()) return "sent";
      return "sent";
    }

    const modal = document.querySelector('[role="dialog"], .artdeco-modal, .artdeco-modal__content');
    if (modal) {
      const sendWithoutNoteBtn = findSendWithoutNoteButton(modal) || findSendWithoutNoteButtonDeep();
      if (sendWithoutNoteBtn) {
        robustClick(sendWithoutNoteBtn);
        await sleep(900);
        if (detectConnectionSuccess()) return "sent";
        return "sent";
      }
      // "How do you know X?" with email field — too risky, abort
      if (modal.querySelector('input[name="email"]')) {
        const closeBtn = modal.querySelector(
          'button[aria-label="Dismiss"], button[aria-label="Cancel"], button[aria-label*="close" i]'
        );
        if (closeBtn) closeBtn.click();
        return "email_required";
      }

      // "Send without a note" or "Send now"
      const buttons = Array.from(modal.querySelectorAll("button, div[role=button], a[role=button], span"));
      const sendBtn = buttons.find(btn => {
        const text = (btn.textContent || "").trim();
        const label = btn.getAttribute ? (btn.getAttribute("aria-label") || "") : "";
        return /send without a note|send now|send invitation|send/i.test(text)
          || /send without a note/i.test(label)
          || /^connect$/i.test(text)
          || /\bconnect\b/i.test(label);
      });

      if (sendBtn) {
        try { sendBtn.click(); } catch (e) { /* ignore */ }
        await sleep(900);
        // If clicking produced a DOM change, treat as sent
        if (detectConnectionSuccess()) return "sent";
        return "sent"; // assume sent if button was clicked
      }
    }
    await sleep(350);
  }
  // final check before timing out
  if (detectConnectionSuccess()) return "sent";
  try {
    console.warn("[LinkedIn Connect] modal_timeout debug candidates:", collectActionButtonDebug());
  } catch (e) { /* ignore */ }
  return "modal_timeout";
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
  if (isPending())           return { status: "sent" };

  // Case A: direct Connect button
  let connectBtn = findDirectConnectButton();
  let followOnlyFromMenu = false;

  // Case B: More actions dropdown
  if (!connectBtn) {
    const res = await tryMoreActionsConnect();
    connectBtn = res.element;
    followOnlyFromMenu = res.followOnly;
  }

  if (!connectBtn) {
    // If we already see pending after menu checks, treat it as successful state.
    if (isPending()) return { status: "sent" };
    if (followOnlyFromMenu || isFollowOnly()) return { status: "no_button", error: "follow_only" };
    return { status: "no_button", error: "connect_button_not_found" };
  }

  robustClick(connectBtn);
  await sleep(1200);

  const modalResult = await handleConnectModal();
  if (modalResult === "sent") return { status: "sent" };

  // Fallback: sometimes the "Send without a note" button is outside the modal
  const findAndClickSendWithoutNote = async () => {
    // 1) shared exact/contains detection
    let btn = findSendWithoutNoteButtonDeep();

    // 2) look for span text inside buttons
    if (!btn) {
      const spans = Array.from(document.querySelectorAll('span.artdeco-button__text, span'));
      for (const sp of spans) {
        if (/send without a note/i.test(normalizeText(sp.textContent || ''))) {
          btn = sp.closest('button') || sp.parentElement;
          break;
        }
      }
    }

    // 3) XPath fallback for text node inside a button
    if (!btn) {
      try {
        const xp = document.evaluate("//button[normalize-space(.)[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'send without a note')]]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        btn = xp.singleNodeValue;
      } catch (e) { /* ignore */ }
    }

    if (!btn) return false;

    // Attempt click; if that doesn't dispatch, send mouse events as fallback
    robustClick(btn);
    await sleep(250);
    if (isPending() || isAlreadyConnected()) return true;

    await sleep(500);
    return (isPending() || isAlreadyConnected() || !findSendWithoutNoteButton(document));
  };

  if (await findAndClickSendWithoutNote()) return { status: 'sent' };

  if (isPending()) return { status: "sent" };
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
