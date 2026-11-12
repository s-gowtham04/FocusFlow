"""End-to-end checks in real Chrome. Run: python3 tests/e2e.py
Writes screenshots to evidence/ and prints PASS/FAIL per check."""
import pathlib, sys, json
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).parent.parent
URL = (ROOT / "index.html").as_uri()
EV = ROOT / "evidence"
EV.mkdir(exist_ok=True)
results = []

def check(name, cond, detail=""):
    results.append(bool(cond))
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, color_scheme="light")
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)

    # 1. Initial render
    check("page title set", "FocusFlow" in page.title())
    check("lang attribute present", page.get_attribute("html", "lang") == "en")
    check("3 columns rendered", page.locator(".column").count() == 3)
    check("3 starter tasks rendered", page.locator(".task").count() == 3)
    page.screenshot(path=str(EV / "01-desktop-light.png"), full_page=True)

    # 2. Validation: empty submit shows accessible error, focus returns to input
    page.click("#task-form .add-btn")
    check("empty submit shows error", page.is_visible("#title-error"))
    check("error text is helpful", "Enter a task title" in page.inner_text("#title-error"))
    check("input flagged aria-invalid", page.get_attribute("#task-title", "aria-invalid") == "true")
    check("focus moved to input", page.evaluate("document.activeElement.id") == "task-title")
    page.screenshot(path=str(EV / "02-validation-error.png"))

    # 3. Add a task
    page.fill("#task-title", "Test the accessibility")
    page.select_option("#task-priority", "high")
    page.click("#task-form .add-btn")
    check("task added", page.locator(".task").count() == 4)
    check("error cleared after valid add", not page.is_visible("#title-error"))
    page.wait_for_timeout(100)  # announcer updates on next animation frame
    check("live region announces add", "Added task Test the accessibility" in page.inner_text("#announcer"))

    # 4. Keyboard-only move: Tab to a move button, press Enter
    first_todo = page.locator("#col-todo").locator("xpath=..").locator(".task").first
    first_todo.get_by_role("button", name="Move", exact=False).nth(1).focus()  # → button
    page.keyboard.press("Enter")
    check("keyboard move works", page.locator("section[aria-labelledby=col-doing] .task").count() == 1)
    check("focus preserved inside board after move", page.evaluate("!!document.activeElement.closest('.task')"))

    # 5. Persistence across reload
    page.reload()
    check("tasks persisted after reload", page.locator(".task").count() == 4)
    check("moved task still in progress", page.locator("section[aria-labelledby=col-doing] .task").count() == 1)

    # 6. Timer: start, pause, reset, phase switch
    page.click("#start-btn")
    check("start becomes Pause", page.inner_text("#start-btn") == "Pause")
    page.wait_for_timeout(2300)
    t = page.inner_text("#time")
    check("timer counts down", t in ("24:57", "24:58", "24:56"), t)
    page.click("#start-btn")
    check("pause becomes Resume", page.inner_text("#start-btn") == "Resume")
    page.click("#reset-btn")
    check("reset restores 25:00", page.inner_text("#time") == "25:00")
    page.click("[data-phase=short]")
    check("short break is 05:00", page.inner_text("#time") == "05:00")
    check("aria-pressed updated", page.get_attribute("[data-phase=short]", "aria-pressed") == "true"
          and page.get_attribute("[data-phase=focus]", "aria-pressed") == "false")
    page.click("[data-phase=focus]")

    # 7. Finishing a focus session credits the selected task and queues a break
    before = page.evaluate("window.__focusflow.state.tasks.reduce((n,t)=>n+t.pomodoros,0)")
    page.evaluate("window.__focusflow.finish()")
    after = page.evaluate("window.__focusflow.state.tasks.reduce((n,t)=>n+t.pomodoros,0)")
    check("pomodoro credited to active task", after == before + 1, f"{before}→{after}")
    check("auto-switched to short break", page.inner_text("#phase-label") == "Short break")
    page.screenshot(path=str(EV / "03-after-focus-session.png"), full_page=True)

    # 8. Delete returns focus to input
    page.locator(".task").first.get_by_role("button", name="Delete").click()
    check("delete removes task", page.locator(".task").count() == 3)
    check("focus returns to input after delete", page.evaluate("document.activeElement.id") == "task-title")

    # 9. Corrupt localStorage does not crash the app
    page.evaluate("localStorage.setItem('focusflow.v1', '{not json')")
    page.reload()
    check("corrupt storage → fresh start, no crash", page.locator(".task").count() == 3)

    # 10. XSS safety: HTML in titles is rendered as text
    page.fill("#task-title", "<img src=x onerror=window.__pwned=1>")
    page.click("#task-form .add-btn")
    check("HTML title escaped (no injection)", page.evaluate("window.__pwned") is None)
    check("title shown literally", "<img src=x" in page.locator(".task-title").last.inner_text()
          or any("<img" in t for t in page.locator(".task-title").all_inner_texts()))

    # 11. Keyboard tab order sanity: skip link is first focusable and works
    page.reload()
    page.keyboard.press("Tab")
    check("skip link is first tab stop", page.evaluate("document.activeElement.className") == "skip-link")

    # 12. Touch target size >= 44px for every button
    small = page.evaluate("""[...document.querySelectorAll('button')].filter(b => {
        const r = b.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; }).length""")
    check("all buttons ≥ 44×44 CSS px", small == 0, f"{small} too small")

    # 13. Responsive: no horizontal scroll at 360px, dark mode
    mobile = browser.new_context(viewport={"width": 360, "height": 780}, color_scheme="dark", device_scale_factor=2)
    m = mobile.new_page(); m.goto(URL)
    overflow = m.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no horizontal overflow at 360px", not overflow)
    m.screenshot(path=str(EV / "04-mobile-dark.png"), full_page=True)

    # 14. Reduced motion respected
    rm = browser.new_context(reduced_motion="reduce"); r = rm.new_page(); r.goto(URL)
    dur = r.evaluate("getComputedStyle(document.getElementById('dial-progress')).transitionDuration")
    check("reduced motion disables dial transition", dur in ("0s", "0.000001s", "1e-05s") or float(dur.rstrip('s')) < 0.001, dur)

    # 15. Console clean
    check("no console errors", not errors, "; ".join(errors))

    # Accessibility tree snapshot (evidence)
    snap = page.accessibility.snapshot() if hasattr(page, "accessibility") else None
    if snap:
        (EV / "accessibility-tree.json").write_text(json.dumps(snap, indent=2))
    browser.close()

passed, total = sum(results), len(results)
print(f"\n{passed}/{total} checks passed")
sys.exit(0 if passed == total else 1)
