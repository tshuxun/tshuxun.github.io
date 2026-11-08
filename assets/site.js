(() => {
  'use strict';

  initNavigation();
  initTalkDownloads();
  updateLastModified();
  initCitationBadges();

  function initRoutes(pages, panels, homeLink) {
    // Keep relative URLs anchored before history changes the address bar.
    const base = document.createElement('base');
    base.href = location.href;
    document.head.prepend(base);
    const siteRoot = new URL('.', base.href);
    const isLocalFile = location.protocol === 'file:';

    // Local files need an explicit filename; hosted pages keep the directory link.
    if (isLocalFile) homeLink.href = 'index.html';

    const pathsById = new Map();
    for (const page of pages) {
      pathsById.set(page.id, new URL(page.id, siteRoot).pathname);
    }
    for (const panel of panels) {
      const pageId = panel.closest('.page').id;
      pathsById.set(panel.id, new URL(`${pageId}/${panel.id}`, siteRoot).pathname);
    }
    const idsByPath = new Map(Array.from(pathsById, ([id, path]) => [path, id]));

    function hrefFor(targetId) {
      return isLocalFile ? '#' + targetId : pathsById.get(targetId);
    }

    function normalizePath(path) {
      return path.replace(/\/+$/, '') || '/';
    }

    function currentId() {
      return isLocalFile ? location.hash.slice(1) : idsByPath.get(normalizePath(location.pathname));
    }

    function restoreAddress() {
      if (isLocalFile) return;
      let url = new URL(location.href);
      // The "route" parameter is shared with the GitHub Pages entry point, 404.html.
      const requested = url.searchParams.get('route');
      if (requested) {
        url = new URL(siteRoot);
        try {
          const candidate = new URL(requested, siteRoot);
          const path = normalizePath(candidate.pathname);
          if (candidate.origin === siteRoot.origin && idsByPath.has(path)) {
            url = candidate;
          }
        } catch {
          // A malformed route falls back to the homepage.
        }
      }
      const targetId = idsByPath.get(normalizePath(url.pathname));
      if (targetId) {
        url.pathname = pathsById.get(targetId);
        url.hash = '';
      }
      if (url.href !== location.href) history.replaceState(null, '', url.href);
    }

    return { hrefFor, currentId, restoreAddress };
  }

  function initNavigation() {
    const main = document.getElementById('main-content');
    const homeLink = document.querySelector('.brand');
    const skipLink = document.querySelector('.skip-link');
    const primaryNav = document.querySelector('.primary-nav');
    const researchTabs = document.querySelector('.research-tabs');
    const pages = Array.from(document.querySelectorAll('.page'));
    const navLinks = primaryNav.querySelectorAll('a');
    const tabs = Array.from(researchTabs.querySelectorAll('a'));
    const panels = Array.from(document.querySelectorAll('.research-panel'));

    const defaultLink = primaryNav.querySelector('[aria-current="page"]');
    const defaultPage = document.getElementById(defaultLink.hash.slice(1));
    const researchPage = researchTabs.closest('.page');
    const defaultPanel = document.getElementById(tabs[0].getAttribute('aria-controls'));
    const routes = initRoutes(pages, panels, homeLink);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const rootStyle = getComputedStyle(document.documentElement);
    const viewDurationMs = parseFloat(rootStyle.getPropertyValue('--view-motion-ms')) || 160;
    const viewDistancePx = parseFloat(rootStyle.getPropertyValue('--view-motion-distance')) || 14;
    const viewEasing = rootStyle.getPropertyValue('--motion-easing').trim() ||
      'cubic-bezier(0.2, 0.7, 0.3, 1)';
    let activePage = null;
    let activePanel = null;
    let handledUrl = null;
    let viewAnimation = null;
    let focusRequestId = 0;

    const selections = [
      createNavSelection(primaryNav, '[aria-current="page"]'),
      createNavSelection(researchTabs, '[aria-selected="true"]'),
    ];

    function positionSelections(animate = false) {
      selections.forEach(({ nav, selector, indicator }) => {
        const selected = nav.querySelector(selector);
        if (!selected || !nav.offsetWidth) return;
        const canMove = animate && !indicator.hidden && !reducedMotion.matches;
        indicator.style.transition = canMove ? '' : 'none';
        indicator.style.width = `${selected.offsetWidth}px`;
        indicator.style.height = `${selected.offsetHeight}px`;
        indicator.style.transform = `translate(${selected.offsetLeft}px, ${selected.offsetTop}px)`;
        indicator.hidden = false;
        nav.classList.add('has-selection');
      });
    }

    function enterView(element, previous, order) {
      viewAnimation?.cancel();
      viewAnimation = null;
      if (reducedMotion.matches || !element.animate) return;
      const direction = order.indexOf(element) > order.indexOf(previous) ? 1 : -1;
      const animation = element.animate(
        [
          { opacity: 0.25, transform: `translateX(${direction * viewDistancePx}px)` },
          { opacity: 1, transform: 'translateX(0)' },
        ],
        { duration: viewDurationMs, easing: viewEasing },
      );
      viewAnimation = animation;
      animation.finished.then(() => {
        if (viewAnimation === animation) viewAnimation = null;
      }).catch(() => {}); // Cancelling an earlier transition is expected.
    }

    function selectPageAndPanel(page, panel) {
      for (const item of pages) item.hidden = item !== page;
      for (const item of panels) item.hidden = item !== panel;
      for (const tab of tabs) {
        const selected = tab.getAttribute('aria-controls') === panel.id;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
      }
      const pageHref = routes.hrefFor(page.id);
      for (const link of navLinks) {
        if (link.getAttribute('href') === pageHref) {
          link.setAttribute('aria-current', 'page');
        } else {
          link.removeAttribute('aria-current');
        }
      }
    }

    function showPage(moveFocus = false, tabAction = null) {
      handledUrl = location.href;
      const target = document.getElementById(routes.currentId() || defaultPage.id);
      const page = target?.closest('.page') || defaultPage;
      const panelTarget = tabs.includes(target)
        ? document.getElementById(target.getAttribute('aria-controls'))
        : target;
      const panel = panelTarget?.closest('.research-panel') || defaultPanel;
      const previousPage = activePage;
      const previousPanel = activePanel;
      activePage = page;
      activePanel = panel;
      selectPageAndPanel(page, panel);
      positionSelections(Boolean(previousPage));

      if (previousPage && previousPage !== page) {
        enterView(page, previousPage, pages);
      } else if (page === researchPage && previousPanel && previousPanel !== panel) {
        enterView(panel, previousPanel, panels);
      }

      const focusTab = previousPage === researchPage ? tabAction : null;
      cancelAnimationFrame(focusRequestId);
      focusRequestId = requestAnimationFrame(() => positionView(page, target, focusTab, moveFocus));
    }

    function positionView(page, target, tabAction, moveFocus) {
      if (tabAction) {
        window.scrollTo({ top: tabAction.scrollY, behavior: 'instant' });
        tabAction.tab.focus({ preventScroll: true });
        return;
      }

      const isDeepLink = target && target !== page && page.contains(target) &&
        !panels.includes(target) && !tabs.includes(target);
      if (isDeepLink) {
        target.scrollIntoView({
          block: 'start',
          behavior: reducedMotion.matches ? 'instant' : 'smooth',
        });
        if (moveFocus) target.focus({ preventScroll: true });
        return;
      }

      window.scrollTo({ top: 0, behavior: 'instant' });
      if (moveFocus) page.querySelector('h1').focus({ preventScroll: true });
    }

    function navigate(targetId, tabAction = null) {
      const url = new URL(routes.hrefFor(targetId), location.href);
      if (location.href !== url.href) history.pushState(null, '', url.href);
      showPage(true, tabAction);
    }

    function selectTab(tab) {
      navigate(tab.getAttribute('aria-controls'), { tab, scrollY: window.scrollY });
    }

    function tabForKey(key, index) {
      switch (key) {
        case 'ArrowRight': return tabs[(index + 1) % tabs.length];
        case 'ArrowLeft': return tabs[(index - 1 + tabs.length) % tabs.length];
        case 'Home': return tabs[0];
        case 'End': return tabs[tabs.length - 1];
        case ' ': return tabs[index];
        default: return null;
      }
    }

    navLinks.forEach(link => {
      const targetId = link.hash.slice(1);
      link.href = routes.hrefFor(targetId);
      onUnmodifiedClick(link, () => navigate(targetId));
    });
    researchTabs.setAttribute('role', 'tablist');
    panels.forEach(panel => panel.setAttribute('role', 'tabpanel'));
    tabs.forEach((tab, index) => {
      tab.setAttribute('role', 'tab');
      tab.href = routes.hrefFor(tab.getAttribute('aria-controls'));
      onUnmodifiedClick(tab, () => selectTab(tab));
      tab.addEventListener('keydown', event => {
        const nextTab = tabForKey(event.key, index);
        if (!nextTab) return;
        event.preventDefault();
        selectTab(nextTab);
      });
    });
    onUnmodifiedClick(skipLink, () => {
      main.focus({ preventScroll: true });
      main.scrollIntoView({ block: 'start' });
    });

    function restoreHistory() {
      // Handle popstate and hashchange only once per URL.
      if (location.href !== handledUrl) showPage(true);
    }
    window.addEventListener('popstate', restoreHistory);
    window.addEventListener('hashchange', restoreHistory);
    routes.restoreAddress();
    showPage();
    window.addEventListener('resize', () => positionSelections());
    if (document.fonts?.ready) document.fonts.ready.then(() => positionSelections());
    reducedMotion.addEventListener('change', () => {
      if (reducedMotion.matches) viewAnimation?.cancel();
      positionSelections();
    });
  }

  function onUnmodifiedClick(link, action) {
    link.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      action();
    });
  }

  function createNavSelection(nav, selector) {
    // Reserve the active label's width to keep adjacent labels in place.
    for (const link of nav.querySelectorAll('a')) {
      const label = document.createElement('span');
      label.className = 'nav-label';
      label.textContent = link.textContent;
      const sizer = label.cloneNode(true);
      sizer.className = 'nav-label-sizer';
      sizer.setAttribute('aria-hidden', 'true');
      link.replaceChildren(label, sizer);
    }

    const indicator = document.createElement('span');
    indicator.className = 'nav-selection';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.hidden = true;
    nav.append(indicator);
    return { nav, selector, indicator };
  }

  function initTalkDownloads() {
    const template = document.getElementById('slides-download-template');
    for (const placeholder of document.querySelectorAll('[data-slides]')) {
      const filename = placeholder.dataset.slides.trim();
      if (!filename) {
        placeholder.remove();
        continue;
      }
      const link = template.content.firstElementChild.cloneNode(true);
      link.href = `assets/${encodeURIComponent(filename)}`;
      link.download = filename;
      placeholder.replaceWith(link);
    }
  }

  function updateLastModified() {
    // The browser uses file or server metadata and may fall back to the current time.
    const updatedAt = document.getElementById('last-updated');
    const modifiedAt = new Date(document.lastModified);
    if (Number.isNaN(modifiedAt.getTime())) return;
    updatedAt.dateTime = modifiedAt.toISOString();
    updatedAt.textContent = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(modifiedAt);
  }

  function initCitationBadges() {
    const placeholders = document.querySelectorAll('[data-citation-doi]');
    if (!placeholders.length) return;
    const template = document.getElementById('citation-badge-template');
    for (const placeholder of placeholders) {
      const badge = template.content.firstElementChild.cloneNode(true);
      badge.dataset.doi = placeholder.dataset.citationDoi.trim();
      const link = badge.querySelector('.citation-fallback');
      link.href += badge.dataset.doi;
      placeholder.replaceWith(badge);
    }
    const script = document.createElement('script');
    script.src = 'https://badge.dimensions.ai/badge.js';
    script.async = true;
    script.charset = 'utf-8';
    document.body.append(script);
  }
})();
