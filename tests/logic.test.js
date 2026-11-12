// Run with: node tests/logic.test.js   (Node 18+, no dependencies)
const assert = require("node:assert/strict");
const test = require("node:test");
const L = require("../logic.js");

test("validateTitle rejects empty and whitespace-only input", () => {
  assert.equal(L.validateTitle("").ok, false);
  assert.equal(L.validateTitle("    ").ok, false);
  assert.equal(L.validateTitle(null).ok, false);
});

test("validateTitle collapses whitespace and trims", () => {
  const r = L.validateTitle("  write   the   docs ");
  assert.equal(r.ok, true);
  assert.equal(r.value, "write the docs");
});

test("validateTitle enforces 80 character limit", () => {
  assert.equal(L.validateTitle("a".repeat(80)).ok, true);
  const r = L.validateTitle("a".repeat(81));
  assert.equal(r.ok, false);
  assert.match(r.error, /81/);
});

test("createTask defaults and sanitises", () => {
  const t = L.createTask("Ship it", "nonsense", 1000);
  assert.equal(t.priority, "medium");
  assert.equal(t.status, "todo");
  assert.equal(t.pomodoros, 0);
  assert.throws(() => L.createTask("   "));
});

test("createTask generates unique ids", () => {
  const ids = new Set(Array.from({ length: 200 }, () => L.createTask("x").id));
  assert.equal(ids.size, 200);
});

test("moveTask moves within bounds and never mutates input", () => {
  const a = L.createTask("A");
  const list = [a];
  const right = L.moveTask(list, a.id, 1);
  assert.equal(right[0].status, "doing");
  assert.equal(list[0].status, "todo", "original untouched");
  assert.equal(L.moveTask(list, a.id, -1)[0].status, "todo", "cannot go left of first");
  const done = L.moveTask(L.moveTask(list, a.id, 1), a.id, 1);
  assert.equal(done[0].status, "done");
  assert.equal(L.moveTask(done, a.id, 1)[0].status, "done", "cannot go right of last");
});

test("removeTask and addPomodoro", () => {
  const a = L.createTask("A"), b = L.createTask("B");
  assert.deepEqual(L.removeTask([a, b], a.id).map((t) => t.id), [b.id]);
  assert.equal(L.addPomodoro([a, b], b.id)[1].pomodoros, 1);
  assert.equal(L.addPomodoro([a, b], b.id)[0].pomodoros, 0);
});

test("sortTasks orders by priority then age", () => {
  const lo = L.createTask("lo", "low", 1);
  const hi = L.createTask("hi", "high", 3);
  const hi2 = L.createTask("hi2", "high", 2);
  assert.deepEqual(L.sortTasks([lo, hi, hi2]).map((t) => t.title), ["hi2", "hi", "lo"]);
});

test("stats handles empty and partial boards", () => {
  assert.deepEqual(L.stats([]), { total: 0, done: 0, sessions: 0, percent: 0 });
  const a = Object.assign(L.createTask("A"), { status: "done", pomodoros: 2 });
  const b = L.createTask("B");
  assert.deepEqual(L.stats([a, b]), { total: 2, done: 1, sessions: 2, percent: 50 });
});

test("formatTime", () => {
  assert.equal(L.formatTime(1500), "25:00");
  assert.equal(L.formatTime(65), "01:05");
  assert.equal(L.formatTime(0), "00:00");
  assert.equal(L.formatTime(-5), "00:00");
  assert.equal(L.formatTime(59.9), "00:59");
});

test("nextPhase gives a long break every 4th focus session", () => {
  assert.equal(L.nextPhase("focus", 1), "short");
  assert.equal(L.nextPhase("focus", 3), "short");
  assert.equal(L.nextPhase("focus", 4), "long");
  assert.equal(L.nextPhase("focus", 8), "long");
  assert.equal(L.nextPhase("short", 4), "focus");
  assert.equal(L.nextPhase("long", 4), "focus");
});

test("sanitizeTasks survives corrupt storage", () => {
  assert.deepEqual(L.sanitizeTasks(null), []);
  assert.deepEqual(L.sanitizeTasks("nope"), []);
  const out = L.sanitizeTasks([
    { id: "1", title: "ok", status: "todo", priority: "bogus", pomodoros: -3 },
    { id: 2, title: "bad id", status: "todo" },
    { id: "3", title: "   ", status: "todo" },
    { id: "4", title: "bad status", status: "archived" },
    null
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].priority, "medium");
  assert.equal(out[0].pomodoros, 0);
});
