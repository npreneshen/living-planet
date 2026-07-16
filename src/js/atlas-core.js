/* atlas-core */
/* ============================================================
   atlas-core.js — shared engine for all three plates
   ============================================================ */
const Atlas = (function () {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const world = {};         // populated by loadWorld()
  const renderers = [];     // registered by each map file

  /* ---------- tiny svg dom helpers ---------- */
  function el(name, attrs, parent) {
    const n = document.createElementNS(SVGNS, name);
    if (attrs) for (const k in attrs) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'style') n.setAttribute('style', attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(n);
    return n;
  }
  function group(parent, id, cls) {
    return el('g', id ? { id, class: cls || '' } : { class: cls || '' }, parent);
  }

  /* ---------- geojson builders ---------- */
  const line = (coords) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });
  const poly = (rings) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: rings } });
  const pt   = (c)      => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c } });

  /* densify a polyline so projection curvature is smooth */
  function densify(coords, step) {
    step = step || 2.5;
    const out = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const [x0, y0] = coords[i], [x1, y1] = coords[i + 1];
      const dist = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(dist / step));
      for (let j = 0; j < n; j++) out.push([x0 + (x1 - x0) * j / n, y0 + (y1 - y0) * j / n]);
    }
    out.push(coords[coords.length - 1]);
    return out;
  }

  /* ---------- defs: glow filters, arrow markers, hatch patterns ---------- */
  function ensureDefs(svg) {
    let defs = svg.querySelector('defs');
    if (defs) return defs;
    defs = el('defs', null, svg);

    // soft glow filter
    const f = el('filter', { id: 'glow', x: '-60%', y: '-60%', width: '220%', height: '220%' }, defs);
    el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '3.4', result: 'b' }, f);
    const m = el('feMerge', null, f);
    el('feMergeNode', { in: 'b' }, m);
    el('feMergeNode', { in: 'SourceGraphic' }, m);

    return defs;
  }

  function arrowMarker(svg, id, color, scale) {
    const defs = ensureDefs(svg);
    if (svg.querySelector('#' + id)) return id;
    scale = scale || 1;
    const mk = el('marker', {
      id, viewBox: '0 0 10 10', refX: '6', refY: '5',
      markerWidth: 6 * scale, markerHeight: 6 * scale, orient: 'auto-start-reverse',
      markerUnits: 'userSpaceOnUse'
    }, defs);
    // slimmer, sharper chevron-style arrowhead
    el('path', { d: 'M0,1 L9,5 L0,9 L3.4,5 Z', fill: color }, mk);
    return id;
  }

  function hatchPattern(svg, id, color, opacity) {
    const defs = ensureDefs(svg);
    if (svg.querySelector('#' + id)) return id;
    const p = el('pattern', { id, width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    el('rect', { width: 7, height: 7, fill: color, 'fill-opacity': (opacity != null ? opacity : 0.12) }, p);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: color, 'stroke-width': 1.5, 'stroke-opacity': 0.75 }, p);
    return id;
  }

  function linearGrad(svg, id, stops, x1, y1, x2, y2, units) {
    const defs = ensureDefs(svg);
    if (svg.querySelector('#' + id)) svg.querySelector('#' + id).remove();
    const g = el('linearGradient', {
      id, x1: x1 ?? 0, y1: y1 ?? 0, x2: x2 ?? 1, y2: y2 ?? 0,
      gradientUnits: units || 'objectBoundingBox'
    }, defs);
    stops.forEach(s => el('stop', { offset: s[0], 'stop-color': s[1], 'stop-opacity': s[2] ?? 1 }, g));
    return id;
  }

  /* ---------- base map: sphere, graticule, land ---------- */
  function drawBase(svg, projection, opts) {
    opts = opts || {};
    const path = d3.geoPath(projection);
    const g = group(svg, null, 'base');

    // sphere fill (ocean)
    el('path', {
      d: path({ type: 'Sphere' }),
      fill: opts.oceanFill || 'rgba(10,28,46,0.35)',
      stroke: 'rgba(120,170,205,0.45)', 'stroke-width': 1.2
    }, g);

    // graticule
    if (opts.graticule !== false) {
      const grat = d3.geoGraticule().step(opts.gratStep || [30, 30])();
      el('path', {
        d: path(grat), fill: 'none',
        stroke: 'var(--grid)', 'stroke-width': 0.6, 'stroke-opacity': 0.30
      }, g);
      // equator emphasised
      const eq = d3.geoGraticule().stepMinor([360, 360]).extentMinor([[-180,-0.0001],[180,0.0001]])();
    }
    if (opts.equator) {
      el('path', {
        d: path(line(densify([[-180,0],[180,0]], 4))),
        fill: 'none', stroke: 'var(--grid)', 'stroke-width': 1, 'stroke-opacity': 0.55,
        'stroke-dasharray': '1 5', 'stroke-linecap': 'round'
      }, g);
    }

    // land
    const landData = (opts.land === '110' ? world.land110 : world.land50) || world.land110;
    el('path', {
      d: path(landData),
      fill: opts.landFill || 'var(--land)',
      stroke: opts.landStroke || 'var(--land-stroke)', 'stroke-width': opts.landStrokeW || 0.7,
      'stroke-linejoin': 'round'
    }, g);

    return { path, g };
  }

  /* ---------- current / flow line helper ---------- */
  function flow(g, path, coords, o) {
    o = o || {};
    const svg = g.ownerSVGElement || g.closest('svg');
    const f = line(densify(coords, o.step || 2.2));
    const d = path(f);
    if (!d) return null;
    let markerId = null;
    if (o.arrow !== false) {
      markerId = 'arr-' + (o.color || 'x').replace(/[^a-z0-9]/gi, '') + (o.arrowScale || 1).toString().replace('.', '');
      arrowMarker(svg, markerId, o.color, o.arrowScale || 1);
    }
    const p = el('path', {
      d, fill: 'none',
      stroke: o.color, 'stroke-width': o.width || 3,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'stroke-opacity': o.opacity != null ? o.opacity : 1
    }, g);
    if (o.dash) p.setAttribute('stroke-dasharray', o.dash);
    if (markerId) {
      p.setAttribute('marker-end', `url(#${markerId})`);
      if (o.midArrows) p.setAttribute('marker-mid', `url(#${markerId})`);
    }
    if (o.glow !== false) p.style.filter = `drop-shadow(0 0 ${o.glowR || 4}px ${o.glowColor || o.color})`;
    return p;
  }

  /* ---------- label with optional projected point ---------- */
  function label(g, projection, lonlat, txt, cls, o) {
    o = o || {};
    let x, y;
    if (Array.isArray(lonlat) && typeof lonlat[0] === 'number' && lonlat.length === 2 && o.screen) {
      [x, y] = lonlat;
    } else {
      const xy = projection(lonlat);
      if (!xy) return null;
      [x, y] = xy;
    }
    x += (o.dx || 0); y += (o.dy || 0);
    const t = el('text', {
      x, y, class: cls || 'feat-label',
      'text-anchor': o.anchor || 'middle',
      fill: o.fill || 'var(--ink)',
      text: txt
    }, g);
    if (o.rotate) t.setAttribute('transform', `rotate(${o.rotate} ${x} ${y})`);
    if (o.style) t.setAttribute('style', (t.getAttribute('style') || '') + ';' + o.style);
    return t;
  }

  /* ============================================================
     scaling, tabs, layer toggles
     ============================================================ */
  function fitStage() {
    const stage = document.getElementById('stage');
    const canvas = document.getElementById('canvas');
    const pad = 0;
    const sw = stage.clientWidth - pad, sh = stage.clientHeight - pad;
    const s = Math.min(sw / 1920, sh / 1080);
    canvas.style.transform = `scale(${s})`;
  }

  function initTabs() {
    const tabs = document.getElementById('tabs');
    tabs.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const id = b.dataset.plate;
      tabs.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      document.querySelectorAll('.plate').forEach(p => {
        p.hidden = p.dataset.plate !== id;
      });
    });
  }

  /* Build an interactive legend that doubles as a layer switch.
     items: [{ layer, type, color, color2, label, sub, on }] (group must exist with id layer-<layer>)
     swatch types: line, dash, arrow, box, hatch, dot, chip, band */
  function buildLegend(host, items) {
    const wrap = document.createElement('div');
    wrap.className = 'legend';
    items.forEach(it => {
      const row = document.createElement('div');
      row.className = 'leg' + (it.on === false ? ' off' : '');
      row.dataset.layer = it.layer || '';

      const sw = document.createElement('div');
      sw.className = 'swatch';
      sw.innerHTML = swatchHTML(it);
      const lab = document.createElement('div');
      lab.className = 'lab';
      lab.innerHTML = it.label + (it.sub ? `<small>${it.sub}</small>` : '');
      row.appendChild(sw); row.appendChild(lab);

      if (it.layer) {
        row.addEventListener('click', () => {
          const grp = document.getElementById('layer-' + it.layer);
          const off = row.classList.toggle('off');
          if (grp) grp.style.display = off ? 'none' : '';
        });
      } else { row.style.cursor = 'default'; }
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
  }

  function swatchHTML(it) {
    const c = it.color, c2 = it.color2 || it.color;
    switch (it.type) {
      case 'line':  return `<span class="sw-line" style="border-top-color:${c};box-shadow:0 0 5px ${c}"></span>`;
      case 'dash':  return `<span class="sw-dash" style="border-top-color:${c}"></span>`;
      case 'band':  return `<span class="sw-line" style="border-top:6px solid ${c};box-shadow:0 0 6px ${c}"></span>`;
      case 'arrow': return `<svg class="sw-arrow" viewBox="0 0 30 13"><defs></defs><line x1="1" y1="6.5" x2="22" y2="6.5" stroke="${c}" stroke-width="3" stroke-linecap="round" style="filter:drop-shadow(0 0 3px ${c})"/><path d="M21,2 L29,6.5 L21,11 L24,6.5 Z" fill="${c}"/></svg>`;
      case 'box':   return `<span class="sw-box" style="border-color:${c};background:${c2}"></span>`;
      case 'hatch': return `<span class="sw-hatch" style="border-color:${c};background:repeating-linear-gradient(45deg,transparent,transparent 3px,${c} 3px,${c} 4.4px)"></span>`;
      case 'dot':   return `<span class="sw-dot" style="background:${c};box-shadow:0 0 7px ${c}"></span>`;
      case 'grad':  return `<span class="sw-box" style="border-color:transparent;background:linear-gradient(90deg,${c},${c2})"></span>`;
      case 'chip':  return `<span class="sw-chip" style="background:${c}">${it.glyph || ''}</span>`;
      default:      return '';
    }
  }

  /* ---------- data load ---------- */
  async function loadWorld() {
    const base = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/';
    const [l50, c110] = await Promise.all([
      fetch(base + 'land-50m.json').then(r => r.json()),
      fetch(base + 'countries-110m.json').then(r => r.json())
    ]);
    world.land50    = topojson.feature(l50, l50.objects.land);
    world.land110   = topojson.feature(c110, c110.objects.countries); // used as land fallback / outlines
    world.countries = topojson.feature(c110, c110.objects.countries);
  }

  function register(fn) { renderers.push(fn); }

  async function init() {
    initTabs();
    fitStage();
    window.addEventListener('resize', fitStage);
    const loading = document.getElementById('loading');
    try {
      await loadWorld();
      loading.remove();
      renderers.forEach(fn => { try { fn(); } catch (e) { console.error('render error', e); } });
    } catch (err) {
      console.error(err);
      loading.classList.add('err');
      document.getElementById('loadmsg').textContent = 'Could not load map data — check connection.';
      document.querySelector('#loading .ring').style.display = 'none';
    }
  }

  return {
    init, register, world,
    el, group, line, poly, pt, densify,
    ensureDefs, arrowMarker, hatchPattern, linearGrad,
    drawBase, flow, label, buildLegend,
    SVGNS
  };
})();

