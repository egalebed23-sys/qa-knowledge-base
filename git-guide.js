(() => {
  const nav = document.querySelector('.guide-nav');
  const links = [...nav.querySelectorAll('.chapter-link')];
  const chapters = links.map(link => document.getElementById(link.hash.slice(1)));
  const groups = [...nav.querySelectorAll('.chapter-group')];
  const filter = document.querySelector('#chapter-filter');
  const resume = document.querySelector('#resume-git');
  const current = document.querySelector('#current-chapter');
  const storageKey = 'qa-git:read-chapters:v1';
  const read = new Set();
  let activeChapter;

  function loadRead() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (Array.isArray(saved)) {
        for (const chapter of chapters) if (saved.includes(chapter.id)) read.add(chapter.id);
      }
    } catch { /* Reading still works when browser storage is unavailable. */ }
  }

  function renderProgress() {
    document.querySelector('#read-count').textContent = read.size + ' / ' + chapters.length;
    document.querySelector('#read-progress').value = read.size;
    links.forEach((link, index) => {
      const done = read.has(chapters[index].id);
      link.classList.toggle('is-read', done);
      if (done) link.setAttribute('aria-description', 'Глава прочитана');
      else link.removeAttribute('aria-description');
    });
    for (const group of groups) {
      const items = [...group.querySelectorAll('.chapter-link')];
      group.querySelector('small').textContent =
        items.filter(link => read.has(link.hash.slice(1))).length + ' / ' + items.length;
    }
    const next = chapters.find(chapter => !read.has(chapter.id));
    resume.href = '#' + (next || chapters[0]).id;
    resume.textContent = !next ? 'Повторить курс' :
      (read.size ? 'Продолжить с главы ' : 'Начать с главы ') + next.id.slice(1);
  }

  function markRead(id) {
    if (read.has(id)) return;
    loadRead();
    read.add(id);
    try { localStorage.setItem(storageKey, JSON.stringify([...read])); } catch { /* In-memory progress. */ }
    renderProgress();
  }

  loadRead();
  renderProgress();
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) {
      read.clear();
      loadRead();
      renderProgress();
    }
  });

  // A pause at the end counts as reading; jumping over chapters does not.
  const timers = new Map();
  const atEnd = new Set();
  function scheduleRead(footer) {
    clearTimeout(timers.get(footer));
    timers.delete(footer);
    if (!document.hidden && atEnd.has(footer) && !read.has(footer.parentElement.id)) {
      timers.set(footer, setTimeout(() => {
        markRead(footer.parentElement.id);
        timers.delete(footer);
      }, 1300));
    }
  }
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.intersectionRatio >= 0.6) atEnd.add(entry.target);
      else atEnd.delete(entry.target);
      scheduleRead(entry.target);
    }
  }, { threshold: [0, 0.6] }) : null;
  document.addEventListener('visibilitychange', () => atEnd.forEach(scheduleRead));

  function chapterNavLink(index, label) {
    const link = document.createElement('a');
    link.href = '#' + chapters[index].id;
    const caption = document.createElement('small');
    caption.textContent = label;
    link.append(caption, links[index].querySelector('.read-mark + span').firstChild.textContent);
    return link;
  }
  chapters.forEach((chapter, index) => {
    const footer = document.createElement('nav');
    footer.className = 'chapter-footer';
    footer.setAttribute('aria-label', 'Переходы главы ' + chapter.id.slice(1));
    if (index) footer.append(chapterNavLink(index - 1, 'Назад'));
    const forward = index + 1 < chapters.length ? chapterNavLink(index + 1, 'Далее') : document.createElement('a');
    if (index + 1 === chapters.length) {
      forward.href = '#resume-git';
      forward.textContent = 'Завершить главу и вернуться к обзору';
    }
    forward.className = 'next-chapter';
    forward.addEventListener('click', () => markRead(chapter.id));
    footer.append(forward);
    chapter.append(footer);
    observer?.observe(footer);
  });

  function updateActive() {
    const line = document.querySelector('.topbar').getBoundingClientRect().height + 36;
    const index = chapters.findLastIndex(chapter => chapter.getBoundingClientRect().top <= line);
    if (index === activeChapter) return;
    activeChapter = index;
    links.forEach((link, i) => {
      if (i === index) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    if (index >= 0 && !filter.value.trim()) links[index].closest('details').open = true;
    current.textContent = index < 0 ? 'Обзор курса' : 'Глава ' + chapters[index].id.slice(1) + ' / ' + chapters.length;
  }
  let queued = false;
  function scheduleActive() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; updateActive(); });
  }
  window.addEventListener('scroll', scheduleActive, { passive: true });
  window.addEventListener('resize', scheduleActive);
  window.addEventListener('load', scheduleActive);
  updateActive();

  let openGroups;
  filter.addEventListener('input', () => {
    const query = filter.value.trim().toLocaleLowerCase('ru');
    if (query && !openGroups) openGroups = groups.map(group => group.open);
    links.forEach((link, i) => {
      const title = chapters[i].querySelector('.section-title').textContent;
      const groupName = link.closest('details').querySelector('summary').firstChild.textContent;
      const keywords = [groupName, link.textContent, title].join(' ').toLocaleLowerCase('ru');
      link.hidden = !keywords.includes(query);
    });
    groups.forEach((group, i) => {
      group.hidden = !group.querySelector('.chapter-link:not([hidden])');
      if (query) group.open = !group.hidden;
      else if (openGroups) group.open = openGroups[i];
    });
    if (!query) openGroups = null;
    document.querySelector('#filter-empty').hidden = groups.some(group => !group.hidden);
  });
})();
