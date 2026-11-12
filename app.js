/* FocusFlow – DOM layer. All state transitions live in logic.js. */
(function () {
  "use strict";
  var L = window.FocusFlowLogic;
  var STORE_KEY = "focusflow.v1";
  var CIRC = 2 * Math.PI * 52;

  var state = { tasks: [], activeId: null, phase: "focus", remaining: L.DURATIONS.focus, running: false, completedFocus: 0 };
  var tickHandle = null;
  var endsAt = 0; // wall-clock end time, so background-tab throttling can't drift the timer

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    board: $("board"), form: $("task-form"), title: $("task-title"), priority: $("task-priority"),
    error: $("title-error"), progress: $("progress"), announcer: $("announcer"),
    time: $("time"), phaseLabel: $("phase-label"), start: $("start-btn"), reset: $("reset-btn"),
    dial: $("dial-progress"), active: $("active-task"), tabs: document.querySelectorAll("[data-phase]")
  };

  /* ---------- storage ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      state.tasks = L.sanitizeTasks(data.tasks);
      state.completedFocus = Number.isFinite(data.completedFocus) ? data.completedFocus : 0;
      if (state.tasks.some(function (t) { return t.id === data.activeId; })) state.activeId = data.activeId;
    } catch (e) { /* corrupt or blocked storage: start fresh */ }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ tasks: state.tasks, activeId: state.activeId, completedFocus: state.completedFocus }));
    } catch (e) { announce("Could not save: browser storage is unavailable."); }
  }

  function announce(msg) {
    els.announcer.textContent = "";
    // Re-set on next frame so repeated identical messages are still announced.
    requestAnimationFrame(function () { els.announcer.textContent = msg; });
  }

  /* ---------- rendering ---------- */
  function el(tag, props, children) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") n.textContent = props[k];
      else if (k === "class") n.className = props[k];
      else n.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function actionButton(label, aria, cls, handler, disabled) {
    var b = el("button", { type: "button", class: "btn small " + (cls || ""), "aria-label": aria, text: label });
    if (disabled) b.disabled = true;
    b.addEventListener("click", handler);
    return b;
  }

  function renderTask(t) {
    var idx = L.COLUMNS.indexOf(t.status);
    var isActive = state.activeId === t.id;
    var li = el("li", { class: "task" + (isActive ? " active" : "") + (t.status === "done" ? " is-done" : ""), "data-priority": t.priority, "data-id": t.id });
    li.appendChild(el("p", { class: "task-title", text: t.title }));
    li.appendChild(el("div", { class: "meta" }, [
      el("span", { class: "badge " + t.priority, text: t.priority + " priority" }),
      el("span", { text: "🍅 " + t.pomodoros, "aria-label": t.pomodoros + " focus sessions completed" })
    ]));
    var actions = el("div", { class: "actions" });
    if (t.status !== "done") {
      actions.appendChild(actionButton(isActive ? "Selected" : "Focus", (isActive ? "Selected for timer: " : "Select for timer: ") + t.title, "", function () { selectTask(t.id); }, isActive));
    }
    actions.appendChild(actionButton("←", "Move “" + t.title + "” to " + (idx > 0 ? L.COLUMN_LABELS[L.COLUMNS[idx - 1]] : "previous column"), "", function () { move(t.id, -1); }, idx === 0));
    actions.appendChild(actionButton("→", "Move “" + t.title + "” to " + (idx < 2 ? L.COLUMN_LABELS[L.COLUMNS[idx + 1]] : "next column"), "", function () { move(t.id, 1); }, idx === 2));
    actions.appendChild(actionButton("Delete", "Delete task: " + t.title, "danger", function () { remove(t.id); }));
    li.appendChild(actions);
    return li;
  }

  function render() {
    var focusedId = document.activeElement && document.activeElement.closest && document.activeElement.closest(".task");
    var restore = focusedId ? { id: focusedId.getAttribute("data-id"), idx: Array.prototype.indexOf.call(document.activeElement.parentNode.children, document.activeElement) } : null;

    els.board.textContent = "";
    L.COLUMNS.forEach(function (col) {
      var tasks = L.sortTasks(state.tasks.filter(function (t) { return t.status === col; }));
      var headingId = "col-" + col;
      var section = el("section", { class: "column", "aria-labelledby": headingId });
      section.appendChild(el("h3", { id: headingId }, [
        el("span", { text: L.COLUMN_LABELS[col] }),
        el("span", { class: "count", text: String(tasks.length), "aria-label": tasks.length + (tasks.length === 1 ? " task" : " tasks") })
      ]));
      if (!tasks.length) section.appendChild(el("p", { class: "empty", text: "Nothing here yet." }));
      else {
        var ul = el("ul", { class: "task-list" });
        tasks.forEach(function (t) { ul.appendChild(renderTask(t)); });
        section.appendChild(ul);
      }
      els.board.appendChild(section);
    });

    var s = L.stats(state.tasks);
    els.progress.textContent = s.done + " of " + s.total + " tasks done (" + s.percent + "%) · " + s.sessions + " focus sessions";

    var active = state.tasks.filter(function (t) { return t.id === state.activeId; })[0];
    els.active.textContent = active ? active.title : "no task selected";

    // Keep keyboard focus stable after a re-render (WCAG 2.4.3).
    if (restore) {
      var li = els.board.querySelector('[data-id="' + restore.id + '"]');
      if (li) {
        var btns = li.querySelectorAll("button:not([disabled])");
        (btns[Math.min(restore.idx, btns.length - 1)] || btns[0] || li).focus();
      }
    }
  }

  /* ---------- task actions ---------- */
  function selectTask(id) {
    state.activeId = id; save(); render();
    var t = state.tasks.filter(function (x) { return x.id === id; })[0];
    announce("Timer is now working on " + t.title);
  }
  function move(id, dir) {
    state.tasks = L.moveTask(state.tasks, id, dir);
    var t = state.tasks.filter(function (x) { return x.id === id; })[0];
    if (t.status === "done" && state.activeId === id) state.activeId = null;
    save(); render();
    announce("Moved " + t.title + " to " + L.COLUMN_LABELS[t.status]);
  }
  function remove(id) {
    var t = state.tasks.filter(function (x) { return x.id === id; })[0];
    state.tasks = L.removeTask(state.tasks, id);
    if (state.activeId === id) state.activeId = null;
    save(); render();
    announce("Deleted " + t.title);
    els.title.focus();
  }

  els.form.addEventListener("submit", function (e) {
    e.preventDefault();
    var v = L.validateTitle(els.title.value);
    if (!v.ok) {
      els.error.textContent = v.error; els.error.hidden = false;
      els.title.setAttribute("aria-invalid", "true"); els.title.focus();
      return;
    }
    els.error.hidden = true; els.title.removeAttribute("aria-invalid");
    var task = L.createTask(v.value, els.priority.value);
    state.tasks.push(task);
    if (!state.activeId) state.activeId = task.id;
    els.title.value = ""; save(); render(); els.title.focus();
    announce("Added task " + task.title);
  });
  els.title.addEventListener("input", function () {
    if (!els.error.hidden) { els.error.hidden = true; els.title.removeAttribute("aria-invalid"); }
  });
  els.title.addEventListener("keydown", function (e) { if (e.key === "Escape") { els.title.value = ""; } });

  /* ---------- timer ---------- */
  var PHASE_NAMES = { focus: "Focus", short: "Short break", long: "Long break" };

  function drawTimer() {
    els.time.textContent = L.formatTime(state.remaining);
    els.phaseLabel.textContent = PHASE_NAMES[state.phase];
    var total = L.DURATIONS[state.phase];
    els.dial.style.strokeDasharray = CIRC.toFixed(2);
    els.dial.style.strokeDashoffset = (CIRC * (1 - state.remaining / total)).toFixed(2);
    els.start.textContent = state.running ? "Pause" : (state.remaining < total ? "Resume" : "Start");
    document.title = (state.running ? L.formatTime(state.remaining) + " · " : "") + "FocusFlow";
    Array.prototype.forEach.call(els.tabs, function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-phase") === state.phase)); });
  }

  function setPhase(phase) {
    stop(); state.phase = phase; state.remaining = L.DURATIONS[phase]; drawTimer();
  }
  function stop() { state.running = false; clearInterval(tickHandle); tickHandle = null; }
  function begin() {
    state.running = true; endsAt = Date.now() + state.remaining * 1000;
    tickHandle = setInterval(tick, 250); drawTimer();
  }
  function tick() {
    var left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    if (left !== state.remaining) { state.remaining = left; drawTimer(); }
    if (left <= 0) finish();
  }
  function finish() {
    var wasFocus = state.phase === "focus";
    stop();
    if (wasFocus) {
      state.completedFocus += 1;
      if (state.activeId) state.tasks = L.addPomodoro(state.tasks, state.activeId);
      save(); render();
    }
    var next = L.nextPhase(state.phase, state.completedFocus);
    announce(wasFocus ? "Focus session complete. Time for a " + PHASE_NAMES[next].toLowerCase() + "." : "Break over. Ready to focus.");
    setPhase(next);
  }

  els.start.addEventListener("click", function () { state.running ? (stop(), drawTimer()) : begin(); });
  els.reset.addEventListener("click", function () { setPhase(state.phase); announce("Timer reset"); });
  Array.prototype.forEach.call(els.tabs, function (b) {
    b.addEventListener("click", function () { setPhase(b.getAttribute("data-phase")); announce(PHASE_NAMES[state.phase] + " selected, " + L.formatTime(state.remaining)); });
  });

  /* ---------- init ---------- */
  load();
  if (!state.tasks.length) {
    // First-run sample content so the board never looks broken or empty.
    ["Outline the project scope", "Build the core feature", "Write README and screenshots"].forEach(function (t, i) {
      var task = L.createTask(t, ["high", "medium", "low"][i], Date.now() + i);
      state.tasks.push(task);
    });
    state.activeId = state.tasks[0].id;
    save();
  }
  render(); drawTimer();

  // Test hook (used by the Playwright checks; harmless in production).
  window.__focusflow = { state: state, finish: finish };
})();
