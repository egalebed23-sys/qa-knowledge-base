# -*- coding: utf-8 -*-
"""Build search-index.js for the knowledge base.

Run from anywhere after editing any page:

    python tools/build_search_index.py

The index is a plain script (window.KB_INDEX = [...]) rather than a JSON file, so
search works when a page is opened straight from disk, where fetch() is blocked.
One entry per section; the glossary on index.html is split into one entry per term;
the chapters of practice.html, which are rendered from JavaScript data, are read
from that data.
"""
import glob
import html
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# file -> (number in the sidebar, label shown in results). wallet.html has its own nav.
PAGES = {
    "index.html":      ("00", "Старт"),
    "theory.html":     ("01", "Теория"),
    "api.html":        ("02", "Backend и API"),
    "db.html":         ("03", "Базы данных"),
    "python.html":     ("04", "Python"),
    "pytest.html":     ("05", "Pytest"),
    "ui.html":         ("06", "UI и E2E"),
    "cicd.html":       ("07", "CI/CD"),
    "git.html":        ("08", "Git"),
    "bash.html":       ("09", "Bash · Docker · K8s"),
    "load.html":       ("10", "Нагрузка"),
    "softskills.html": ("11", "Soft skills"),
    "architecture.html": ("12", "Архитектура"),
    "security.html":   ("13", "Безопасность"),
    "practice.html":   ("14", "Практика Python"),
    "scenarios.html":  ("15", "Сценарные кейсы"),
    "wallet.html":     ("",   "Блокчейн · Кошельки · TMA"),
}


def to_text(fragment):
    """HTML fragment -> one line of plain text, with block boundaries kept as spaces."""
    fragment = re.sub(r"<(script|style)\b.*?</\1>", " ", fragment, flags=re.S | re.I)
    fragment = re.sub(r'(<span class="(?:hl-label|g-term)">.*?)</span>', r"\1</span>: ", fragment, flags=re.S)
    fragment = re.sub(r"<br\s*/?>|</(?:p|div|li|tr|td|th|h[1-6]|pre|section|table|ul|ol|summary)>", " ", fragment, flags=re.I)
    fragment = re.sub(r"<[^>]+>", "", fragment)
    text = html.unescape(fragment).replace(" ", " ").replace(" ", " ")
    return re.sub(r"\s+", " ", text).strip()


def first(pattern, fragment):
    m = re.search(pattern, fragment, flags=re.S)
    return to_text(m.group(1)) if m else ""


def entry(page, sec_id, num, title, text):
    pn, pt = PAGES[page]
    return {"p": page, "pn": pn, "pt": pt, "i": sec_id, "n": num, "t": title, "x": text}


def sections_of(page, src):
    out = []
    for m in re.finditer(r'<section\b[^>]*\bid="([^"]+)"[^>]*>(.*?)</section>', src, flags=re.S):
        sec_id, body = m.group(1), m.group(2)
        title = first(r'<span class="section-title">(.*?)</span>', body)
        num = first(r'<span class="section-num">(.*?)</span>', body)
        body = re.sub(r'<div class="section-header">.*?</div>', "", body, count=1, flags=re.S)
        text = to_text(body)
        if title and text:
            out.append(entry(page, sec_id, num, title, text))
    return out


def index_page(src):
    """index.html has no <section>s: home blocks plus a glossary of cards."""
    out = []
    for m in re.finditer(r'<div class="home-block" id="([^"]+)">(.*?)(?=<div class="home-block"|</main>)', src, flags=re.S):
        block_id, body = m.group(1), m.group(2)
        if block_id == "sections":
            continue
        if block_id == "glossary":
            for card in re.finditer(r'<div class="gloss-card">(.*?)</div>\s*</div>', body, flags=re.S):
                term = first(r'<span class="g-term">(.*?)</span>', card.group(1))
                en = first(r'<span class="g-en">(.*?)</span>', card.group(1))
                text = first(r'<div class="g-body">(.*)', card.group(1) + "</div>")
                if term and text:
                    out.append(entry("index.html", "glossary", "", "%s%s" % (term, " · " + en if en else ""), text))
            continue
        title = first(r"<h2>(.*?)</h2>", body)
        out.append(entry("index.html", block_id, "", title, to_text(re.sub(r"<h2>.*?</h2>", "", body, count=1, flags=re.S))))
    return out


def practice_chapters(src):
    """Chapters of practice.html live in a JS array; theory and task statements are HTML in template strings."""
    js = re.search(r"<script>(.*?)</script>", src, flags=re.S).group(1)
    out = []
    pat = re.compile(r"\{\s*\n\s*id: '(ch\w+)',\s*\n\s*num: '([^']+)',\s*\n\s*part: '[^']+',\s*\n\s*title: '([^']+)',\s*\n\s*theory: `(.*?)`,\s*\n(.*?)(?=\n\{\s*\n\s*id: 'ch|\n\];)", re.S)
    for m in pat.finditer(js):
        cid, num, title, theory, rest = m.groups()
        tasks = []
        for t in re.finditer(r"\n\s*title: '([^']*)',\s*\n\s*statement: `(.*?)`,", rest, flags=re.S):
            tasks.append("Задача «%s»: %s" % (to_text(t.group(1)), to_text(t.group(2))))
        text = to_text(theory) + (" " + " ".join(tasks) if tasks else "")
        out.append(entry("practice.html", cid, num, title, text))
    return out


def main():
    entries = []
    for page in sorted(PAGES, key=lambda p: PAGES[p][0] or "99"):
        path = os.path.join(ROOT, page)
        src = io.open(path, encoding="utf-8").read()
        if page == "index.html":
            found = index_page(src)
        else:
            found = sections_of(page, src)
        if page == "practice.html":
            found += practice_chapters(src)
        entries += found
        print("%-18s %3d entries  %7d chars" % (page, len(found), sum(len(e["x"]) for e in found)))

    entries.append({"p": "theory-quiz.html", "pn": "", "pt": "Тест по теории", "i": "", "n": "",
                    "t": "Тест по теории тестирования",
                    "x": "53 вопроса по главам 01–10 теории тестирования с проверкой ответа, объяснением и ссылкой на раздел. Проверь себя, работа над ошибками, итог по главам."})

    out_path = os.path.join(ROOT, "search-index.js")
    lines = [json.dumps(e, ensure_ascii=False, separators=(",", ":")) for e in entries]
    with io.open(out_path, "w", encoding="utf-8", newline="") as f:
        f.write("/* generated by tools/build_search_index.py — do not edit by hand */\n")
        f.write("window.KB_INDEX=[\n" + ",\n".join(lines) + "\n];\n")
    size = os.path.getsize(out_path)
    print("-> search-index.js: %d entries, %.0f KB" % (len(entries), size / 1024.0))
    if len(entries) < 100:
        sys.exit("suspiciously few entries — a page layout probably changed")


if __name__ == "__main__":
    main()
