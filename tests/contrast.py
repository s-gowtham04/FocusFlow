"""WCAG 2.2 contrast check for every text/background pair used in styles.css.
Run: python3 tests/contrast.py   (exit code 1 if any pair fails)
"""
import re, sys, pathlib

css = (pathlib.Path(__file__).parent.parent / "styles.css").read_text()

def block(selector_regex):
    m = re.search(selector_regex, css, re.S)
    return dict(re.findall(r"--([\w-]+):\s*(#[0-9a-fA-F]{6})", m.group(1)))

light = block(r":root\s*\{(.*?)\n\}")
dark = block(r"prefers-color-scheme: dark\)\s*\{\s*:root\s*\{(.*?)\n  \}")

def lum(hexc):
    r, g, b = [int(hexc[i:i+2], 16) / 255 for i in (1, 3, 5)]
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

def ratio(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)

# (foreground token, background token, minimum ratio, description)
PAIRS = [
    ("text", "bg", 4.5, "body text on page"),
    ("text", "surface", 4.5, "body text on cards"),
    ("text", "surface-2", 4.5, "text on columns / secondary buttons"),
    ("muted", "surface", 4.5, "muted text on cards"),
    ("muted", "surface-2", 4.5, "muted text on columns"),
    ("muted", "bg", 4.5, "footer muted text"),
    ("on-brand", "brand", 4.5, "primary button label"),
    ("on-brand", "brand-hover", 4.5, "primary button hover label"),
    ("brand", "surface", 4.5, "brand-coloured heading on header"),
    ("danger", "surface", 4.5, "error text / delete button on card"),
    ("danger", "surface-2", 4.5, "delete button on secondary bg"),
    ("high", "surface", 4.5, "high priority badge"),
    ("medium", "surface", 4.5, "medium priority badge"),
    ("low", "surface", 4.5, "low priority badge"),
    ("focus-ring", "surface", 3.0, "focus indicator (non-text, 1.4.11)"),
    ("focus-ring", "bg", 3.0, "focus indicator on page"),
    ("muted", "surface", 3.0, "input border (non-text, 1.4.11)"),
    ("brand", "surface", 3.0, "progress ring vs card (non-text)"),
]

failed = 0
for theme, tokens in (("light", light), ("dark", dark)):
    print(f"\n== {theme} theme ==")
    for fg, bg, need, label in PAIRS:
        r = ratio(tokens[fg], tokens[bg])
        ok = r >= need
        failed += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {r:5.2f}:1 (need {need})  {fg} on {bg}  - {label}")

print(f"\n{len(PAIRS) * 2 - failed}/{len(PAIRS) * 2} checks passed")
sys.exit(1 if failed else 0)
