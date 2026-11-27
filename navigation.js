(() => {
  const toggle = document.querySelector('.menu-toggle');
  const sidebar = toggle.closest('.sidebar');
  const narrow = matchMedia('(max-width: 900px)');
  const expanded = () => toggle.getAttribute('aria-expanded') === 'true';
  const setOpen = open => toggle.setAttribute('aria-expanded', String(open));

  toggle.addEventListener('click', () => setOpen(!expanded()));
  narrow.addEventListener('change', () => setOpen(false));
  sidebar.addEventListener('keydown', event => {
    if (event.key === 'Escape' && narrow.matches && expanded()) {
      setOpen(false);
      toggle.focus();
    }
  });

  // Carry the catalog's scroll position across an ordinary same-tab section change.
  const key = 'qa:catalog-scroll';
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    sessionStorage.removeItem(key);
    if (!narrow.matches && saved?.path === location.pathname) sidebar.scrollTop = saved.top;
  } catch { /* Storage may be unavailable on local files. */ }

  sidebar.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || event.defaultPrevented || event.button !== 0 ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (narrow.matches) {
      if (link.hash || link.getAttribute('href') === '#') setOpen(false);
    } else if (link.matches('.nav-item') && link.pathname !== location.pathname) {
      try {
        sessionStorage.setItem(key, JSON.stringify({ path: link.pathname, top: sidebar.scrollTop }));
      } catch { /* Navigation still works without storage. */ }
    }
  });
})();
