(() => {
  'use strict';

  const series = [
    ['first', 'First author'],
    ['corresponding', 'Corresponding author (non-first)'],
    ['other', 'Other co-author'],
  ];

  function readPublicationTable(figure) {
    const table = JSON.parse(figure.querySelector('script[type="application/json"]').textContent);
    const { years } = table;
    if (!Array.isArray(years) || !years.length) {
      throw new Error('The publication table needs at least one year.');
    }

    const columns = years.map(year => ({ year }));
    const totals = {};
    for (const [key] of series) {
      const counts = table[key];
      if (!Array.isArray(counts) || counts.length !== years.length ||
          counts.some(count => !Number.isSafeInteger(count) || count < 0)) {
        throw new Error(`The "${key}" row needs one nonnegative integer per year.`);
      }
      totals[key] = 0;
      for (const [index, count] of counts.entries()) {
        columns[index][key] = count;
        totals[key] += count;
      }
    }
    columns.sort((a, b) => a.year - b.year);
    return { columns, totals };
  }

  function svgElement(tag, attributes, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function countScale(above, below) {
    const target = Math.max(1, (above + below) / 6);
    const power = 10 ** Math.floor(Math.log10(target));
    const step = power * [1, 2, 5, 10].find(factor => factor * power >= target);
    return { high: Math.max(1, Math.ceil(above / step)) * step, low: -Math.ceil(below / step) * step, step };
  }

  function createLegend(counts) {
    const list = document.createElement('ul');
    list.className = 'publication-legend';
    for (const [key, label] of series) {
      const item = document.createElement('li');
      item.dataset.series = key;
      const number = document.createElement('span');
      number.className = 'publication-count';
      number.textContent = counts[key];
      const role = document.createElement('span');
      role.textContent = label;
      item.append(number, ' × ', role);
      list.append(item);
    }
    return list;
  }

  function createYearTooltip(figure) {
    const tip = document.createElement('div');
    tip.className = 'publication-tooltip';
    // Each year's accessible label also contains its counts.
    tip.setAttribute('aria-hidden', 'true');
    tip.hidden = true;
    figure.append(tip);

    function hide() { tip.hidden = true; }

    function show(column, group) {
      const year = document.createElement('strong');
      year.textContent = column.year;
      tip.replaceChildren(year, createLegend(column));
      tip.hidden = false;

      const frame = figure.getBoundingClientRect();
      const plot = group.ownerSVGElement.getBoundingClientRect();
      const anchor = group.getBoundingClientRect();
      const { width, height } = tip.getBoundingClientRect();
      const headerBottom = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
      const topLimit = Math.max(frame.top, headerBottom, 0);
      const bottomLimit = Math.min(plot.bottom, document.documentElement.clientHeight);
      if (bottomLimit - topLimit < height) return hide();

      const gap = 8;
      let left = anchor.left + (anchor.width - width) / 2;
      let top = anchor.top - height - gap;
      // Prefer the bar top. Use the open side when the card would cover the legend.
      if (top < Math.max(plot.top, topLimit)) {
        const roomLeft = anchor.left - frame.left;
        const roomRight = frame.right - anchor.right;
        if (Math.max(roomLeft, roomRight) >= width + gap) {
          left = roomRight >= roomLeft ? anchor.right + gap : anchor.left - width - gap;
          top = Math.max(plot.top, anchor.top + (anchor.height - height) / 2);
        }
      }
      tip.style.left = `${Math.min(Math.max(left, frame.left), frame.right - width) - frame.left}px`;
      tip.style.top = `${Math.min(Math.max(top, topLimit), bottomLimit - height) - frame.top}px`;
    }

    return { show, hide };
  }

  function createYearColumn(column, x, yForCount, tooltip) {
    const counts = series.map(([key, label]) => `${column[key]} × ${label}`);
    const group = svgElement('g', {
      class: 'publication-column', tabindex: 0, role: 'img',
      'pointer-events': 'bounding-box',
      'aria-label': [column.year, ...counts].join('. '),
    });

    const bases = { first: 0, corresponding: column.first, other: -column.other };
    for (const [key] of series) {
      const count = column[key];
      if (count === 0) continue;
      const bottom = bases[key];
      const top = yForCount(bottom + count);
      group.append(svgElement('rect', {
        class: 'publication-bar', 'data-series': key, x,
        y: top, height: yForCount(bottom) - top,
      }));
    }
    group.append(svgElement('text', {
      x, y: yForCount(0), dy: '1.2em', 'text-anchor': 'middle', class: 'publication-year',
    }, column.year));

    const showTooltip = () => tooltip.show(column, group);
    group.addEventListener('mouseenter', showTooltip);
    group.addEventListener('focus', showTooltip);
    group.addEventListener('mouseleave', tooltip.hide);
    group.addEventListener('blur', tooltip.hide);
    return group;
  }

  function drawPublicationChart(figure) {
    const { columns, totals } = readPublicationTable(figure);
    const scale = countScale(
      Math.max(...columns.map(column => column.first + column.corresponding)),
      Math.max(...columns.map(column => column.other))
    );
    const plotHeight = 200;
    const yForCount = count => 12 + (scale.high - count) * plotHeight / (scale.high - scale.low);
    const height = Math.max(yForCount(scale.low) + 9, yForCount(0) + 24);
    const slot = 100 / columns.length;
    figure.style.setProperty('--chart-years', columns.length);

    const tooltip = createYearTooltip(figure);

    const scroll = document.createElement('div');
    scroll.className = 'publication-chart-scroll';
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', 'Annual publication counts');
    const frame = document.createElement('div');
    frame.className = 'publication-plot';
    const axis = svgElement('svg', { width: '100%', height, 'aria-hidden': 'true' });
    const plot = svgElement('svg', { width: '100%', height, role: 'group', 'aria-label': 'Papers by year and authorship' });

    for (let value = scale.low; value <= scale.high; value += scale.step) {
      const tickY = yForCount(value);
      axis.append(svgElement('text', { x: '100%', dx: -7, y: tickY, dy: '.35em', 'text-anchor': 'end' }, Math.abs(value)));
      plot.append(svgElement('line', { x1: 0, x2: '100%', y1: tickY, y2: tickY, class: value === 0 ? 'publication-zero' : 'publication-gridline' }));
    }

    columns.forEach((column, index) => {
      const x = `${(index + .5) * slot}%`;
      plot.append(createYearColumn(column, x, yForCount, tooltip));
    });

    frame.append(axis, plot);
    scroll.append(frame);
    scroll.addEventListener('scroll', tooltip.hide);
    window.addEventListener('resize', tooltip.hide);
    figure.addEventListener('keydown', event => { if (event.key === 'Escape') tooltip.hide(); });
    figure.querySelector('figcaption').after(createLegend(totals), scroll);
  }

  document.querySelectorAll('.publication-chart').forEach(drawPublicationChart);
})();
