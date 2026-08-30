/* Search on Ctrl+K, copy buttons, heading anchors. All optional; the site
 * works without this file. */
(() => {
  "use strict";

  /* ── copy buttons ────────────────────────────────────────────────────── */
  for (const pre of document.querySelectorAll(".prose pre")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.textContent = "Copy";
    button.addEventListener("click", async () => {
      /* Strip the shell prompt. */
      const code = pre.cloneNode(true);
      code.querySelectorAll(".gp").forEach((el) => el.remove());
      try {
        await navigator.clipboard.writeText(code.textContent.replace(/^[ \t]+/gm, "").trimEnd());
        button.textContent = "Copied";
      } catch {
        button.textContent = "Select it instead";
      }
      setTimeout(() => (button.textContent = "Copy"), 1600);
    });
    pre.parentElement?.classList.add("has-copy");
    pre.before(button);
  }

  /* ── anchor links ────────────────────────────────────────────────────── */
  for (const h of document.querySelectorAll(".prose h2[id], .prose h3[id]")) {
    const a = document.createElement("a");
    a.className = "anchor";
    a.href = "#" + h.id;
    a.setAttribute("aria-label", `Link to “${h.textContent.trim()}”`);
    a.textContent = "#";
    h.append(a);
  }

  const state = { index: null, open: false, items: [], cursor: 0 };

  /* ── search ──────────────────────────────────────────────────────────── */
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "search-trigger";
  trigger.innerHTML =
    '<span>Search</span><kbd>Ctrl</kbd><kbd>K</kbd>';
  trigger.addEventListener("click", () => open());
  document.querySelector(".masthead nav")?.prepend(trigger);

  const dialog = document.createElement("dialog");
  dialog.className = "palette";
  dialog.innerHTML = `
    <form method="dialog" class="palette__form">
      <input type="search" class="palette__input" placeholder="Search the documentation…"
             aria-label="Search the documentation" autocomplete="off" spellcheck="false">
    </form>
    <ul class="palette__results" role="listbox" aria-label="Results"></ul>
    <p class="palette__hint"><kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>↵</kbd> to open · <kbd>Esc</kbd> to close</p>`;
  document.body.append(dialog);

  const input = dialog.querySelector(".palette__input");
  const list = dialog.querySelector(".palette__results");

  async function load() {
    if (state.index) return state.index;
    const res = await fetch("/index.json");
    state.index = await res.json();
    return state.index;
  }

  async function open() {
    if (state.open) return;
    state.open = true;
    dialog.showModal();
    input.value = "";
    render([]);
    await load();
    input.focus();
  }

  function close() {
    state.open = false;
    if (dialog.open) dialog.close();
  }

  function search(query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const hits = [];

    for (const page of state.index || []) {
      const title = page.t.toLowerCase();
      const desc = page.d.toLowerCase();
      const body = page.x.toLowerCase();
      let score = 0;
      let matchedAll = true;

      for (const term of terms) {
        let best = 0;
        if (title.startsWith(term)) best = 120;
        else if (title.includes(term)) best = 80;
        if (desc.includes(term)) best += 30;

        /* Count matches: a page that repeats a term is usually about it. */
        const hits = countOf(body, term);
        if (hits) best += Math.min(30, 6 + hits * 2);

        if (!best) matchedAll = false;
        score += best;
      }
      if (!matchedAll) continue;

      /* Prefer a matching heading over the top of the page. */
      let anchor = null;
      for (const h of page.h || []) {
        const ht = h.t.toLowerCase();
        if (terms.every((t) => ht.includes(t))) { anchor = h; score += 40; break; }
      }

      hits.push({ page, anchor, score, where: excerpt(page.x, terms[0]) });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, 8);
  }

  function countOf(haystack, needle) {
    let n = 0;
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) n++;
    return n;
  }

  function excerpt(text, term) {
    const at = text.toLowerCase().indexOf(term);
    if (at < 0) return "";
    const from = Math.max(0, at - 40);
    return (from ? "…" : "") + text.slice(from, from + 140).trim() + "…";
  }

  function render(hits) {
    state.items = hits;
    state.cursor = 0;
    list.innerHTML = "";
    for (const [i, hit] of hits.entries()) {
      const li = document.createElement("li");
      li.role = "option";
      li.className = "palette__result";
      li.ariaSelected = String(i === 0);
      li.innerHTML = `
        <span class="palette__group">${escape(hit.page.g)}</span>
        <span class="palette__title">${escape(hit.page.t)}${
          hit.anchor ? ` <span class="palette__anchor">${escape(hit.anchor.t)}</span>` : ""
        }</span>
        <span class="palette__where">${escape(hit.where)}</span>`;
      li.addEventListener("click", () => go(i));
      list.append(li);
    }
  }

  const escape = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function move(by) {
    if (!state.items.length) return;
    const next = (state.cursor + by + state.items.length) % state.items.length;
    list.children[state.cursor]?.setAttribute("aria-selected", "false");
    state.cursor = next;
    const el = list.children[next];
    el?.setAttribute("aria-selected", "true");
    el?.scrollIntoView({ block: "nearest" });
  }

  function go(i) {
    const hit = state.items[i ?? state.cursor];
    if (!hit) return;
    close();
    location.href = hit.page.u + (hit.anchor ? "#" + hit.anchor.i : "");
  }

  input.addEventListener("input", () => render(search(input.value)));
  dialog.addEventListener("close", () => { state.open = false; });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });

  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); go(); }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open(); }
    else if (e.key === "/" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) {
      e.preventDefault(); open();
    }
  });
})();
