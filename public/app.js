(() => {
  "use strict";

  const CAP = window.TABLE_CAPACITY || 12;
  const TABLES = window.TABLES || [];
  const POLL_MS = 3000;
  const FETCH_TIMEOUT_MS = 8000;  // a hung request must not stop the 3s loop
  const ZOOMS = [1, 2, 3];
  const $ = (id) => document.getElementById(id);

  let data = {};           // counts  { [id]: { n, t, by } }
  let labels = {};         // numbers { [id]: { label, t, by, edits } }
  let open = null;         // { id, expectT, initial }
  let draft = 0;
  let saving = false;
  let adminEnabled = true; // server tells us whether an ADMIN_PIN is configured
  let adminPin = null;     // kept in memory only, never stored on the phone

  // The printed number. Falls back to the internal id until someone renames it.
  const labelOf = (id) => (labels[id] && labels[id].label) || String(id);

  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  let usher = store.get("usherName", "");

  // ---------- helpers ----------
  function colorClass(n) {
    // 0 | 1-2 | 3-4 | 5-6 | 7-8 | 9-10 | 11 | 12 (full)
    if (n <= 0) return "b0";
    if (n >= CAP) return "b7";
    return "b" + Math.min(6, Math.ceil(n / 2));
  }
  const countOf = (id) => (data[id] ? data[id].n : 0);

  function fmtTime(t) {
    const d = new Date(t);
    const sameDay = d.toDateString() === new Date().toDateString();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return sameDay ? time : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
  }
  function ago(t) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    return `${Math.round(m / 60)} h ago`;
  }

  let toastTimer;
  function toast(msg, bad) {
    const el = $("toast");
    el.textContent = msg;
    el.className = "toast" + (bad ? " bad" : "");
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2600);
  }

  // ---------- map ----------
  const map = $("map");
  const btns = {};
  for (const t of TABLES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tbl b0";
    b.style.left = t.x + "%";
    b.style.top = t.y + "%";
    b.dataset.id = t.id;
    b.innerHTML = `<span class="no"></span><span class="cnt">0</span>`;
    b.setAttribute("aria-label", `Table ${t.id}`);
    map.appendChild(b);
    btns[t.id] = b;
  }
  map.addEventListener("click", (e) => {
    const b = e.target.closest(".tbl");
    if (b) openSheet(Number(b.dataset.id));
  });

  function render(changed) {
    let guests = 0, full = 0, empty = 0, partial = 0;
    for (const t of TABLES) {
      const n = countOf(t.id);
      guests += n;
      if (n === 0) empty++;
      else if (n >= CAP) full++;
      else partial++;
      const b = btns[t.id];
      const label = labelOf(t.id);
      b.className = "tbl " + colorClass(n) + (label.length > 3 ? " long" : "");
      b.firstChild.textContent = label;
      b.lastChild.textContent = `${n}/${CAP}`;
      b.setAttribute("aria-label", `Table ${label}: ${n} of ${CAP}`);
      if (changed && changed.has(t.id)) {
        void b.offsetWidth;
        b.classList.add("flash");
      }
    }
    $("sGuests").textContent = guests;
    $("sCap").textContent = TABLES.length * CAP;
    $("sFull").textContent = full;
    $("sPartial").textContent = partial;
    $("sEmpty").textContent = empty;
  }

  // ---------- sync ----------
  function setLive(ok) {
    const el = $("live");
    el.textContent = ok ? "● Live" : "● Offline";
    el.classList.toggle("off", !ok);
  }

  async function refresh() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch("api/tables", { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) throw new Error(res.status);
      const body = await res.json();
      adminEnabled = body.adminEnabled !== false;
      labels = body.labels || {};
      const next = body.tables || {};
      const changed = new Set();
      for (const t of TABLES) {
        const a = data[t.id], b = next[t.id];
        if ((a && a.t) !== (b && b.t)) changed.add(t.id);
      }
      const first = Object.keys(data).length === 0;
      data = next;
      render(first ? null : changed);
      if (open && changed.has(open.id)) showNow();
      setLive(true);
    } catch {
      setLive(false);
    } finally {
      clearTimeout(timer);
    }
  }

  let pollTimer;
  function schedule() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      if (!document.hidden) await refresh();
      schedule();
    }, POLL_MS);
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });

  // ---------- sheet ----------
  const grid = $("grid");
  for (let i = 0; i <= CAP; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = i;
    b.dataset.n = i;
    b.className = colorClass(i);
    grid.appendChild(b);
  }
  grid.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) setDraft(Number(b.dataset.n));
  });

  const input = $("countInput");

  function setDraft(n, fromInput) {
    draft = n;
    if (!fromInput) input.value = String(n);
    for (const b of grid.children) b.classList.toggle("sel", Number(b.dataset.n) === n);
    $("inputErr").hidden = true;
  }

  function showNow() {
    const rec = data[open.id];
    $("nowCount").textContent = rec ? rec.n : 0;
    $("nowMeta").textContent = rec
      ? `Last updated ${fmtTime(rec.t)} (${ago(rec.t)})${rec.by ? " · by " + rec.by : ""}`
      : "Not updated yet";
  }

  function openSheet(id) {
    const rec = data[id];
    open = { id, expectT: rec ? rec.t : 0, initial: rec ? rec.n : 0 };
    $("sheetTitle").textContent = `Table ${labelOf(id)}`;
    showLabelNote();
    $("conflict").hidden = true;
    showNow();
    setDraft(open.initial);
    $("sheetBackdrop").hidden = false;
    $("okBtn").disabled = false;
  }

  function showLabelNote() {
    const rec = labels[open.id];
    const note = $("labelNote");
    if (!rec) {
      note.hidden = true;
      $("editNoBtn").textContent = "✏️ Edit no.";
      return;
    }
    const dup = TABLES.filter((t) => labelOf(t.id) === rec.label).length;
    note.innerHTML =
      `Number set${rec.by ? " by " + rec.by : ""} ${fmtTime(rec.t)}` +
      (dup > 1 ? ` · also used by ${dup - 1} other table${dup > 2 ? "s" : ""}` : "") +
      (adminPin ? "" : " · 🔒 admin PIN needed to change");
    note.hidden = false;
    $("editNoBtn").textContent = adminPin ? "✏️ Edit no." : "🔒 Edit no.";
  }

  function closeSheet() {
    $("sheetBackdrop").hidden = true;
    open = null;
    input.blur();
  }

  function parseInput() {
    const raw = input.value.trim();
    if (!/^\d{1,2}$/.test(raw) || Number(raw) > CAP) return null;
    return Number(raw);
  }

  input.addEventListener("input", () => {
    const n = parseInput();
    if (n === null) {
      for (const b of grid.children) b.classList.remove("sel");
      return;
    }
    setDraft(n, true);
  });
  input.addEventListener("focus", () => input.select());
  $("stepForm").addEventListener("submit", (e) => {
    e.preventDefault();
    save();
  });
  $("minus").addEventListener("click", () => setDraft(Math.max(0, (parseInput() ?? draft) - 1)));
  $("plus").addEventListener("click", () => setDraft(Math.min(CAP, (parseInput() ?? draft) + 1)));
  $("okBtn").addEventListener("click", save);
  $("cancelBtn").addEventListener("click", askCancel);
  $("sheetBackdrop").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) askCancel();
  });

  async function askCancel() {
    if (!open) return;
    const ok = await confirmDialog(
      `Cancel Table ${open.id}?`,
      "Your change will not be saved.",
      { yes: "Yes, cancel", no: "Keep editing" }
    );
    if (ok) closeSheet();
  }

  async function save(force) {
    if (!open || saving) return;
    const n = parseInput();
    if (n === null) {
      $("inputErr").textContent = `Enter a number from 0 to ${CAP}.`;
      $("inputErr").hidden = false;
      input.focus();
      return;
    }
    saving = true;
    $("okBtn").disabled = true;
    const id = open.id;
    try {
      const res = await fetch("api/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, n, by: usher, expectT: open.expectT, force: force === true }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        const rec = body.rec;
        if (rec) data[id] = rec; else delete data[id];
        render();
        showNow();
        open.expectT = rec ? rec.t : 0;
        const w = $("conflict");
        w.textContent = `⚠ Someone${rec && rec.by ? " (" + rec.by + ")" : ""} just updated this table to ${rec ? rec.n : 0}. Check the number and press OK again to save ${n}.`;
        w.hidden = false;
        return;
      }
      if (!res.ok) throw new Error(body.error || "Save failed");
      data[id] = body.rec;
      render(new Set([id]));
      closeSheet();
      toast(`Table ${id} → ${n} ${n === 1 ? "person" : "persons"}`);
    } catch (err) {
      toast(`Not saved: ${err.message || "no connection"}. Try again.`, true);
    } finally {
      saving = false;
      $("okBtn").disabled = false;
    }
  }

  // ---------- dialog ----------
  function confirmDialog(title, text, opts = {}) {
    return new Promise((resolve) => {
      const bd = $("dlgBackdrop");
      const inp = $("dlgInput");
      $("dlgTitle").textContent = title;
      $("dlgText").textContent = text;
      $("dlgYes").textContent = opts.yes || "Yes";
      $("dlgNo").textContent = opts.no || "No";
      inp.hidden = !opts.input;
      if (opts.input) {
        inp.value = opts.value || "";
        inp.type = opts.inputType || "text";
        inp.placeholder = opts.placeholder || "";
      }
      bd.hidden = false;
      (opts.input ? inp : $("dlgNo")).focus();
      const done = (v) => {
        bd.hidden = true;
        $("dlgYes").onclick = $("dlgNo").onclick = inp.onkeydown = bd.onclick = null;
        resolve(v);
      };
      $("dlgYes").onclick = () => done(opts.input ? inp.value : true);
      $("dlgNo").onclick = () => done(opts.input ? null : false);
      bd.onclick = (e) => { if (e.target === bd) done(opts.input ? null : false); };
      inp.onkeydown = (e) => { if (e.key === "Enter") done(inp.value); };
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("dlgBackdrop").hidden) $("dlgNo").click();
    else if (open) askCancel();
  });

  // ---------- admin mode ----------
  function updateAdminChip() {
    $("adminChip").hidden = !adminPin;
  }

  // Returns a verified PIN, or null if the user cancelled / got it wrong.
  async function askPin(title, text) {
    if (adminPin) return adminPin;
    const pin = await confirmDialog(title, text, {
      input: true, inputType: "password", placeholder: "Admin PIN", yes: "Unlock", no: "Cancel",
    });
    if (pin === null || !pin.trim()) return null;
    const res = await fetch("api/tables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify-pin", pin: pin.trim() }),
    }).catch(() => null);
    if (!res) {
      toast("No connection — try again", true);
      return null;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast(body.error || "Wrong admin PIN", true);
      return null;
    }
    adminPin = pin.trim();
    updateAdminChip();
    if (open) showLabelNote();
    return adminPin;
  }

  $("adminChip").addEventListener("click", async () => {
    const yes = await confirmDialog("Leave admin mode?", "Table numbers will be locked again.", {
      yes: "Leave", no: "Stay",
    });
    if (!yes) return;
    adminPin = null;
    updateAdminChip();
    if (open) showLabelNote();
    toast("Admin mode off");
  });

  // ---------- table number ----------
  async function sendLabel(id, label, pin) {
    const res = await fetch("api/tables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-label", id, label, by: usher, ...(pin ? { pin } : {}) }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  $("editNoBtn").addEventListener("click", async () => {
    if (!open) return;
    const id = open.id;
    const current = labelOf(id);
    const already = Boolean(labels[id]);

    // Already set once? The PIN comes first, so nobody types a number for nothing.
    if (already && !adminPin) {
      if (!adminEnabled) {
        return toast("This number was already set and no admin PIN is set on this site", true);
      }
      const pin = await askPin(
        "Admin PIN needed",
        `Table number “${current}” was already set${labels[id].by ? " by " + labels[id].by : ""}. Enter the admin PIN to change it.`
      );
      if (!pin) return;
    }

    const value = await confirmDialog(
      `Table number`,
      already
        ? `Change “${current}” to the number printed at the table. The same number may be used twice.`
        : `Set the number printed at this table (now showing “${current}”). You can set it once; after that the admin PIN is needed.`,
      { input: true, value: current, placeholder: "e.g. 12 or A3", yes: "Save", no: "Cancel" }
    );
    if (value === null) return;
    const label = value.trim().slice(0, 6);
    if (!label) return toast("Enter a table number", true);
    if (label === current && already) return;

    let r = await sendLabel(id, label, adminPin);
    if (r.status === 423) {
      // Someone set it while this sheet was open.
      if (r.body.rec) labels[id] = r.body.rec;
      const pin = await askPin("Admin PIN needed", `This table was just numbered “${r.body.rec ? r.body.rec.label : ""}” by someone else. Enter the admin PIN to change it.`);
      if (!pin) { render(); showLabelNote(); $("sheetTitle").textContent = `Table ${labelOf(id)}`; return; }
      r = await sendLabel(id, label, pin);
    }
    if (r.status === 403) {
      adminPin = null;
      updateAdminChip();
      return toast("Admin PIN was rejected", true);
    }
    if (r.status !== 200) return toast(r.body.error || "Could not save the number", true);

    labels[id] = r.body.rec;
    render();
    $("sheetTitle").textContent = `Table ${labelOf(id)}`;
    showLabelNote();
    toast(`Table number saved: ${label}`);
  });

  // ---------- usher name ----------
  function showName() {
    $("nameLabel").textContent = usher || "Set your name";
  }
  $("nameBtn").addEventListener("click", async () => {
    const v = await confirmDialog("Your name", "Shown to other ushers next to your updates.", {
      input: true, value: usher, placeholder: "e.g. Andi", yes: "Save", no: "Cancel",
    });
    if (v === null) return;
    usher = v.trim().slice(0, 30);
    store.set("usherName", usher);
    showName();
  updateAdminChip();
  });

  // ---------- find + zoom ----------
  const viewport = $("viewport");
  $("findForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("findInput").value.trim();
    const match = TABLES.find((t) => labelOf(t.id).toLowerCase() === q.toLowerCase());
    const id = match ? match.id : Number(q);
    const b = btns[id];
    if (!q || !b) return toast(`No table ${q}`.trim(), true);
    $("findInput").blur();
    b.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    b.classList.remove("pulse");
    void b.offsetWidth;
    b.classList.add("pulse");
    setTimeout(() => openSheet(id), 900);
  });

  function setZoom(z, keepCenter) {
    const cx = viewport.scrollLeft + viewport.clientWidth / 2;
    const cy = viewport.scrollTop + viewport.clientHeight / 2;
    const oldW = map.offsetWidth;
    map.style.width = z * 100 + "%";
    map.classList.toggle("detail", map.offsetWidth * 0.0374 >= 36);
    for (const b of document.querySelectorAll("[data-zoom]")) b.classList.toggle("on", Number(b.dataset.zoom) === z);
    store.set("zoom", String(z));
    if (keepCenter && oldW) {
      const k = map.offsetWidth / oldW;
      viewport.scrollLeft = cx * k - viewport.clientWidth / 2;
      viewport.scrollTop = cy * k - viewport.clientHeight / 2;
    }
  }
  for (const b of document.querySelectorAll("[data-zoom]")) {
    b.addEventListener("click", () => setZoom(Number(b.dataset.zoom), true));
  }

  // ---------- admin reset ----------
  $("resetBtn").addEventListener("click", async () => {
    const sure = await confirmDialog("Reset all counts?", "Sets every table back to 0. Table numbers are kept.", {
      yes: "Yes, reset", no: "Cancel",
    });
    if (!sure) return;
    const pin = await askPin("Admin PIN needed", "Enter the admin PIN to reset every count.");
    if (!pin) return;
    const res = await fetch("api/tables", { method: "DELETE", headers: { "x-admin-pin": pin } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast(body.error || "Reset failed", true);
    data = {};
    render();
    toast("All tables reset to 0");
  });

  // ---------- start ----------
  showName();
  const savedZoom = Number(store.get("zoom", ""));
  setZoom(ZOOMS.includes(savedZoom) ? savedZoom : window.innerWidth < 700 ? 2 : 1);
  window.addEventListener("resize", () => map.classList.toggle("detail", map.offsetWidth * 0.0374 >= 36));
  render();
  refresh().then(schedule);
  setInterval(() => { if (open) showNow(); }, 30000);
})();
