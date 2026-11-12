/* FocusFlow – pure logic (no DOM access) so it can be unit-tested in Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FocusFlowLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var COLUMNS = ["todo", "doing", "done"];
  var COLUMN_LABELS = { todo: "To do", doing: "In progress", done: "Done" };
  var PRIORITIES = ["low", "medium", "high"];
  var DURATIONS = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
  var LONG_BREAK_EVERY = 4;

  /** Returns { ok, value, error } so the UI can show an accessible message. */
  function validateTitle(raw) {
    var value = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
    if (!value) return { ok: false, value: value, error: "Enter a task title." };
    if (value.length > 80)
      return { ok: false, value: value, error: "Keep the title under 80 characters (currently " + value.length + ")." };
    return { ok: true, value: value, error: "" };
  }

  function createTask(title, priority, now) {
    var v = validateTitle(title);
    if (!v.ok) throw new Error(v.error);
    var p = PRIORITIES.indexOf(priority) === -1 ? "medium" : priority;
    var t = now == null ? Date.now() : now;
    return {
      id: "t" + t.toString(36) + Math.random().toString(36).slice(2, 7),
      title: v.value,
      priority: p,
      status: "todo",
      pomodoros: 0,
      createdAt: t
    };
  }

  /** Move a task one column left (-1) or right (+1). Returns a new array. */
  function moveTask(tasks, id, direction) {
    return tasks.map(function (t) {
      if (t.id !== id) return t;
      var i = COLUMNS.indexOf(t.status) + direction;
      if (i < 0 || i >= COLUMNS.length) return t;
      return Object.assign({}, t, { status: COLUMNS[i] });
    });
  }

  function removeTask(tasks, id) {
    return tasks.filter(function (t) { return t.id !== id; });
  }

  function addPomodoro(tasks, id) {
    return tasks.map(function (t) {
      return t.id === id ? Object.assign({}, t, { pomodoros: t.pomodoros + 1 }) : t;
    });
  }

  var PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  function sortTasks(list) {
    return list.slice().sort(function (a, b) {
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt;
    });
  }

  function stats(tasks) {
    var total = tasks.length;
    var done = tasks.filter(function (t) { return t.status === "done"; }).length;
    var sessions = tasks.reduce(function (n, t) { return n + t.pomodoros; }, 0);
    return { total: total, done: done, sessions: sessions, percent: total ? Math.round((done / total) * 100) : 0 };
  }

  function formatTime(seconds) {
    var s = Math.max(0, Math.floor(seconds));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
  }

  /** Which phase follows after finishing `phase`, given completed focus count. */
  function nextPhase(phase, completedFocus) {
    if (phase !== "focus") return "focus";
    return completedFocus > 0 && completedFocus % LONG_BREAK_EVERY === 0 ? "long" : "short";
  }

  /** Defensive load: ignore corrupt or hand-edited storage. */
  function sanitizeTasks(data) {
    if (!Array.isArray(data)) return [];
    return data
      .filter(function (t) {
        return t && typeof t.id === "string" && typeof t.title === "string" &&
          COLUMNS.indexOf(t.status) !== -1 && t.title.trim().length > 0;
      })
      .map(function (t) {
        return {
          id: t.id,
          title: t.title.slice(0, 80),
          priority: PRIORITIES.indexOf(t.priority) === -1 ? "medium" : t.priority,
          status: t.status,
          pomodoros: Number.isFinite(t.pomodoros) && t.pomodoros > 0 ? Math.floor(t.pomodoros) : 0,
          createdAt: Number.isFinite(t.createdAt) ? t.createdAt : 0
        };
      });
  }

  return {
    COLUMNS: COLUMNS, COLUMN_LABELS: COLUMN_LABELS, PRIORITIES: PRIORITIES,
    DURATIONS: DURATIONS, LONG_BREAK_EVERY: LONG_BREAK_EVERY,
    validateTitle: validateTitle, createTask: createTask, moveTask: moveTask,
    removeTask: removeTask, addPomodoro: addPomodoro, sortTasks: sortTasks,
    stats: stats, formatTime: formatTime, nextPhase: nextPhase, sanitizeTasks: sanitizeTasks
  };
});
