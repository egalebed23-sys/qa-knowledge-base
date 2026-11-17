/* Keyword search for the whole knowledge base.
 * Adds a "Поиск по базе" button to the sidebar of every page (also: "/" or Ctrl+K),
 * searches search-index.js (built by tools/build_search_index.py) and, after a click,
 * highlights the found words on the target page. Works from file:// as well. */
(function () {
  'use strict';

  var script = document.currentScript;
  var BASE = script && script.src ? script.src.replace(/[^\/]*$/, '') : '';
  var HIT_KEY = 'kb-search-hit:';
  var MAX_RESULTS = 30;
  var EXAMPLES = ['acid', 'kafka offset', 'fixture scope', 'solid', 'pesticide paradox', 'cors'];

  var overlay, input, meta, list, trigger, chip;
  var IDX = null, loading = false, active = -1, lastFocus = null, timer = 0, shown = [];

  /* ───────────── text helpers ───────────── */
  function norm(s) { return String(s).toLowerCase().replace(/ё/g, 'е'); }
  function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&'); }

  function parseTerms(q) {
    var seen = {}, out = [];
    norm(q).split(/[^\p{L}\p{N}]+/u).forEach(function (t) {
      if (!t || seen[t]) return;
      if (t.length < 2 && !/\d/.test(t)) return;
      seen[t] = 1; out.push(t);
    });
    return out.slice(0, 6);
  }

  /* short words must match whole; longer ones match as a prefix of a word, so
     Russian endings and plurals do not get in the way ("тестирование" ~ "тестирования") */
  /* latin words are matched whole (so "extend" does not hit "external"), minus a plural "s";
     the two-letter cut is only for Russian endings */
  function stemOf(t) {
    if (t.length <= 3) return t;
    if (/^[a-z0-9]+$/.test(t)) return t.length > 4 ? t.replace(/s$/, '') : t;
    return t.length <= 5 ? t.slice(0, -1) : t.slice(0, -2);
  }
  function termSource(t, forHighlight) {
    var stem = escRe(stemOf(t)).replace(/е/g, '[её]');
    var exact = t.length <= 3;
    return '(?<![\\p{L}\\p{N}])' + stem + (exact ? '(?![\\p{L}\\p{N}])' : (forHighlight ? '[\\p{L}\\p{N}]*' : ''));
  }
  function makeRe(source, flags) {
    try { return new RegExp(source, flags); }
    catch (e) { return new RegExp(source.replace(/\(\?<!\[[^\]]*\]\)/g, '\\b'), flags.replace('u', '')); }
  }
  function buildPats(terms) {
    return terms.map(function (t) {
      var src = termSource(t, false);
      return { t: t, all: makeRe(src, 'gu'), has: makeRe(src, 'u') };
    });
  }
  function highlightRe(terms) {
    return makeRe('(?:' + terms.map(function (t) { return termSource(t, true); }).join('|') + ')', 'giu');
  }
  function hlHtml(text, re) {
    var out = '', last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      if (!m[0]) { re.lastIndex++; continue; }
      out += escHtml(text.slice(last, m.index)) + '<mark>' + escHtml(m[0]) + '</mark>';
      last = m.index + m[0].length;
    }
    return out + escHtml(text.slice(last));
  }
  function plural(n, one, few, many) {
    var a = n % 10, b = n % 100;
    return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many;
  }

  /* ───────────── searching ───────────── */
  function prepare() {
    IDX.forEach(function (e) { e.lcx = norm(e.x); e.lct = norm(e.t + ' ' + e.pt); });
  }

  function snippetFor(e, pats) {
    var rarest = null;
    pats.forEach(function (p) { if (p.n > 0 && (!rarest || p.n < rarest.n)) rarest = p; });
    if (!rarest) return { pos: 0, cover: 0 };
    var re = makeRe(rarest.all.source, 'gu'), m, best = { pos: 0, cover: -1 }, seen = 0;
    while ((m = re.exec(e.lcx)) !== null && seen++ < 60) {
      var win = e.lcx.slice(Math.max(0, m.index - 160), m.index + 160);
      var cover = pats.filter(function (p) { return p.has.test(win); }).length;
      if (cover > best.cover) best = { pos: m.index, cover: cover };
      if (cover === pats.length) break;
    }
    return best;
  }

  function cutSnippet(text, pos) {
    var start = Math.max(0, pos - 70), end;
    if (start > 0) { var sp = text.indexOf(' ', start); if (sp > -1 && sp - start < 20) start = sp + 1; }
    end = Math.min(text.length, start + 210);
    if (end < text.length) { var sp2 = text.lastIndexOf(' ', end); if (sp2 > start + 100) end = sp2; }
    return (start > 0 ? '… ' : '') + text.slice(start, end) + (end < text.length ? ' …' : '');
  }

  function search(q) {
    var terms = parseTerms(q);
    if (!terms.length) return null;
    var pats = buildPats(terms);
    var phrase = terms.length > 1 ? norm(q).trim().replace(/\s+/g, ' ') : '';
    var strict = [], loose = [];

    IDX.forEach(function (e) {
      var found = 0, score = 0, titleHits = 0;
      pats.forEach(function (p) {
        var hits = e.lcx.match(p.all);
        p.n = hits ? hits.length : 0;
        var inTitle = p.has.test(e.lct);
        if (inTitle) titleHits++;
        if (p.n || inTitle) found++;
        score += Math.min(p.n, 6);
      });
      if (!found) return;
      score += 8 * titleHits;
      if (phrase && e.lcx.indexOf(phrase) > -1) score += 40;
      var snip = snippetFor(e, pats);
      if (pats.length > 1 && snip.cover === pats.length) score += 15;
      var item = { e: e, score: score, pos: snip.pos, found: found };
      (found === pats.length ? strict : loose).push(item);
    });

    var byScore = function (a, b) { return b.score - a.score; };
    strict.sort(byScore);
    if (strict.length || terms.length === 1) return { items: strict, terms: terms, partial: false };
    loose.sort(function (a, b) { return b.found - a.found || b.score - a.score; });
    return { items: loose, terms: terms, partial: true };
  }

  /* ───────────── rendering ───────────── */
  function currentPage() { return location.pathname.split('/').pop() || 'index.html'; }
  function hrefOf(e) { return e.p + (e.i ? '#' + e.i : ''); }
  function pathOf(e) { return e.pt + (e.n ? ' · §' + e.n : '') + ' · ' + e.t; }

  function render(q) {
    active = -1; shown = [];
    if (!IDX) { meta.textContent = loading ? 'Загружаю индекс…' : ''; return; }
    var res = search(q);
    if (!res) {
      meta.textContent = 'Введите слово или фразу';
      list.innerHTML = '<div class="kb-s-empty">Например: ' + EXAMPLES.map(function (x) {
        return '<button type="button" class="kb-s-ex" data-q="' + escHtml(x) + '">' + escHtml(x) + '</button>';
      }).join(' ') + '</div>';
      return;
    }
    if (!res.items.length) {
      meta.textContent = 'Ничего не найдено';
      list.innerHTML = '<div class="kb-s-empty">Попробуй другое слово, часть слова или английский термин.</div>';
      return;
    }
    var re = highlightRe(res.terms);
    shown = res.items.slice(0, MAX_RESULTS);
    meta.textContent = (res.partial ? 'Целиком фразы нет, найдено по отдельным словам: ' : 'Найдено: ') + res.items.length +
      (res.items.length > MAX_RESULTS ? ' · показаны первые ' + MAX_RESULTS : '');
    list.innerHTML = shown.map(function (it, i) {
      var e = it.e;
      return '<a class="kb-s-item" role="option" id="kb-s-opt-' + i + '" href="' + hrefOf(e) + '" data-i="' + i + '">' +
        '<div class="kb-s-path">' + hlHtml(pathOf(e), re) + '</div>' +
        '<div class="kb-s-snip">' + hlHtml(cutSnippet(e.x, it.pos), re) + '</div></a>';
    }).join('');
    setActive(0);
  }

  function setActive(i) {
    var items = list.querySelectorAll('.kb-s-item');
    if (!items.length) { active = -1; return; }
    active = (i + items.length) % items.length;
    items.forEach(function (el, k) { el.setAttribute('aria-selected', k === active ? 'true' : 'false'); });
    items[active].scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', items[active].id);
  }

  /* ───────────── open / close ───────────── */
  function ensureIndex() {
    if (IDX || loading) return;
    if (window.KB_INDEX) { IDX = window.KB_INDEX; prepare(); return; }
    loading = true;
    var s = document.createElement('script');
    s.src = BASE + 'search-index.js';
    s.onload = function () { loading = false; IDX = window.KB_INDEX || []; prepare(); render(input.value); };
    s.onerror = function () { loading = false; meta.textContent = 'Не удалось загрузить search-index.js'; };
    document.head.appendChild(s);
  }

  function openSearch(prefill) {
    if (!overlay.hidden) return;
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    if (typeof prefill === 'string') input.value = prefill;
    ensureIndex();
    render(input.value);
    input.focus(); input.select();
  }
  function closeSearch() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ───────────── carrying the query to the target page ───────────── */
  function stash(hit) {
    var s = JSON.stringify(hit);
    try { sessionStorage.setItem(HIT_KEY, s); } catch (e) { /* storage blocked */ }
    try { window.name = HIT_KEY + s; } catch (e) { /* ignore */ }
  }
  function take() {
    var s = null;
    try { s = sessionStorage.getItem(HIT_KEY); sessionStorage.removeItem(HIT_KEY); } catch (e) { /* ignore */ }
    if (!s && window.name && window.name.indexOf(HIT_KEY) === 0) s = window.name.slice(HIT_KEY.length);
    if (window.name && window.name.indexOf(HIT_KEY) === 0) { try { window.name = ''; } catch (e) { /* ignore */ } }
    try { var h = s && JSON.parse(s); return h && Date.now() - h.at < 20000 ? h : null; } catch (e) { return null; }
  }

  function clearMarks() {
    document.querySelectorAll('mark.kb-hit').forEach(function (m) {
      var p = m.parentNode;
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    });
    if (chip) { chip.remove(); chip = null; }
  }

  function applyHit(hit, attempt) {
    var root = (hit.id && document.getElementById(hit.id)) || document.querySelector('.main') || document.body;
    var re = highlightRe(hit.terms);
    var nodes = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        if (!n.nodeValue.trim() || p.closest('script,style,textarea,mark,.kb-s-overlay,.kb-hit-chip')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);

    var marks = [];
    for (var i = 0; i < nodes.length && marks.length < 200; i++) {
      var node = nodes[i], text = node.nodeValue, last = 0, m, frag = null;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        if (!m[0]) { re.lastIndex++; continue; }
        frag = frag || document.createDocumentFragment();
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var mk = document.createElement('mark');
        mk.className = 'kb-hit'; mk.textContent = m[0];
        frag.appendChild(mk); marks.push(mk);
        last = m.index + m[0].length;
      }
      if (frag) {
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      }
    }
    if (!marks.length) { if (attempt < 12) setTimeout(function () { applyHit(hit, attempt + 1); }, 150); return; }

    marks[0].scrollIntoView({ block: 'center' });
    chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'kb-hit-chip';
    chip.textContent = 'Найдено в тексте: «' + hit.q + '» · ' + marks.length + ' · убрать подсветку ✕';
    chip.addEventListener('click', clearMarks);
    document.body.appendChild(chip);
  }

  function followHit(entry, q) {
    var hit = { q: q, terms: parseTerms(q), id: entry.i, at: Date.now() };
    if (entry.p === currentPage()) {
      closeSearch(); clearMarks();
      if (entry.i) { try { history.replaceState(null, '', '#' + entry.i); } catch (e) { location.hash = entry.i; } }
      setTimeout(function () { applyHit(hit, 0); }, 30);
    } else {
      stash(hit);
      location.href = hrefOf(entry);
    }
  }

  /* ───────────── DOM + events ───────────── */
  var CSS = [
    '.kb-search-btn{display:flex;align-items:center;gap:8px;width:100%;margin-top:14px;padding:8px 10px;background:var(--bg,#0d0f14);border:1px solid var(--border,#252830);border-radius:8px;color:var(--muted,#7a7f92);font:500 13px/1.2 "Manrope",system-ui,sans-serif;cursor:pointer;text-align:left}',
    '.kb-search-btn:hover{border-color:#343846;color:var(--text,#e8eaf0)}',
    '.kb-search-btn.kb-fixed{position:fixed;top:12px;right:12px;width:auto;margin:0;z-index:50;background:var(--surface,#161920)}',
    '.kb-search-btn kbd,.kb-s-close{margin-left:auto;font:600 11px "JetBrains Mono",ui-monospace,monospace;color:var(--muted-2,#5a5f72);border:1px solid var(--border,#252830);border-radius:4px;padding:1px 6px;background:transparent}',
    '.kb-s-overlay{position:fixed;inset:0;z-index:1000;display:flex;justify-content:center;align-items:flex-start;padding:8vh 16px 16px;background:rgba(5,7,11,.72)}',
    '.kb-s-overlay[hidden]{display:none}',
    '.kb-s-box{display:flex;flex-direction:column;width:100%;max-width:720px;max-height:84vh;background:var(--surface,#161920);border:1px solid #343846;border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.55);overflow:hidden;font-family:"Manrope",system-ui,sans-serif;color:var(--text,#e8eaf0)}',
    '.kb-s-head{display:flex;gap:10px;align-items:center;padding:12px;border-bottom:1px solid var(--border,#252830)}',
    '.kb-s-input{flex:1;min-width:0;padding:10px 12px;background:var(--bg,#0d0f14);border:1px solid var(--border,#252830);border-radius:8px;color:var(--text,#e8eaf0);font:500 16px "Manrope",system-ui,sans-serif;outline:none}',
    '.kb-s-input:focus{border-color:var(--accent,#005bff)}',
    '.kb-s-close{cursor:pointer;padding:6px 8px}',
    '.kb-s-meta{padding:8px 16px 4px;font:500 11px "JetBrains Mono",ui-monospace,monospace;color:var(--muted,#7a7f92);letter-spacing:.04em;min-height:24px}',
    '.kb-s-list{overflow-y:auto;padding:4px 8px 8px}',
    '.kb-s-item{display:block;padding:10px 12px;border-radius:8px;text-decoration:none;color:var(--text,#e8eaf0)}',
    '.kb-s-item:hover,.kb-s-item[aria-selected="true"]{background:rgba(0,91,255,.15)}',
    '.kb-s-path{margin-bottom:3px;font:500 11px/1.4 "JetBrains Mono",ui-monospace,monospace;color:var(--muted,#7a7f92)}',
    '.kb-s-snip{font-size:13.5px;line-height:1.55;color:#c4c9d8;overflow-wrap:anywhere}',
    '.kb-s-box mark,mark.kb-hit{background:rgba(255,200,60,.3);color:#fff;border-radius:3px;padding:0 1px}',
    '.kb-s-empty{padding:14px 12px;font-size:13.5px;color:var(--muted,#7a7f92);line-height:2}',
    '.kb-s-ex{margin-right:4px;padding:3px 10px;background:var(--surface-2,#12151d);border:1px solid var(--border,#252830);border-radius:999px;color:var(--text,#e8eaf0);font:500 12.5px "Manrope",system-ui,sans-serif;cursor:pointer}',
    '.kb-s-ex:hover{border-color:var(--accent,#005bff)}',
    '.kb-s-foot{padding:8px 16px;border-top:1px solid var(--border,#252830);font:500 11px "JetBrains Mono",ui-monospace,monospace;color:var(--muted-2,#5a5f72)}',
    '.kb-hit-chip{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:60;max-width:calc(100vw - 32px);padding:8px 14px;background:var(--surface,#161920);border:1px solid #343846;border-radius:999px;color:var(--text,#e8eaf0);font:600 12.5px "Manrope",system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 30px rgba(0,0,0,.45)}',
    '.kb-hit-chip:hover{border-color:var(--accent,#005bff)}',
    '@media (max-width:600px){.kb-s-overlay{padding-top:12px}.kb-s-foot{display:none}.kb-s-box{max-height:92vh}}',
    '@media (prefers-reduced-motion:no-preference){mark.kb-hit{transition:background .3s}}'
  ].join('\n');

  function build() {
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'kb-search-btn';
    trigger.innerHTML = '<span aria-hidden="true">⌕</span><span>Поиск по базе</span><kbd>/</kbd>';
    var brand = document.querySelector('.sidebar-brand');
    if (brand) brand.appendChild(trigger);
    else { trigger.classList.add('kb-fixed'); document.body.appendChild(trigger); }
    trigger.addEventListener('click', function () { openSearch(); });

    overlay = document.createElement('div');
    overlay.className = 'kb-s-overlay'; overlay.hidden = true;
    overlay.innerHTML = '<div class="kb-s-box" role="dialog" aria-modal="true" aria-label="Поиск по базе">' +
      '<div class="kb-s-head"><input class="kb-s-input" type="search" autocomplete="off" spellcheck="false" ' +
      'placeholder="Ключевые слова: acid, kafka offset, fixture…" aria-label="Запрос" role="combobox" aria-expanded="true" aria-controls="kb-s-list">' +
      '<button type="button" class="kb-s-close" aria-label="Закрыть поиск">Esc</button></div>' +
      '<div class="kb-s-meta" aria-live="polite"></div>' +
      '<div class="kb-s-list" id="kb-s-list" role="listbox"></div>' +
      '<div class="kb-s-foot">↑ ↓ выбрать · Enter открыть · Esc закрыть</div></div>';
    document.body.appendChild(overlay);
    input = overlay.querySelector('.kb-s-input');
    meta = overlay.querySelector('.kb-s-meta');
    list = overlay.querySelector('.kb-s-list');

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { render(input.value); }, 90);
    });
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeSearch(); });
    overlay.querySelector('.kb-s-close').addEventListener('click', closeSearch);
    list.addEventListener('click', function (e) {
      var ex = e.target.closest('.kb-s-ex');
      if (ex) { input.value = ex.getAttribute('data-q'); render(input.value); input.focus(); return; }
      var a = e.target.closest('.kb-s-item');
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
      e.preventDefault();
      followHit(shown[Number(a.getAttribute('data-i'))].e, input.value);
    });
  }

  function isTyping(el) {
    return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  document.addEventListener('keydown', function (e) {
    if (overlay.hidden) {
      if ((e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) ||
          ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K'))) {
        e.preventDefault(); openSearch();
      } else if (e.key === 'Escape' && chip) clearMarks();
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); followHit(shown[active].e, input.value); }
    else if (e.key === 'Tab') { e.preventDefault(); input.focus(); }
  });

  function start() {
    build();
    var hit = take();
    if (hit && hit.terms && hit.terms.length) {
      var go = function () { setTimeout(function () { applyHit(hit, 0); }, 60); };
      if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
    }
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
