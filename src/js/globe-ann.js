/* globe-ann */
/* ============================================================
   globe-annotations.js — Date-pinned annotations on the globe
   Add a note to any date; it appears as a glowing badge at a
   chosen location when the timeline reaches that date.
   Stored in localStorage under 'globe-annotations'.
   ============================================================ */
window.GlobeAnnotations = function (api) {
  const A = api.A, svg = api.svg;
  const STORE_KEY = 'globe-annotations-v2';
  let annotations = [];
  let pendingLonLat = null;    // waiting for user to click globe for position
  let editingId = null;
  const gAnnot = A.group(svg, 'g-annotations', 'annot-layer');
  gAnnot.style.zIndex = 20;

  /* ---- persistence ---- */
  function load() {
    try { annotations = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch(e) { annotations = []; }
  }
  function save() { localStorage.setItem(STORE_KEY, JSON.stringify(annotations)); }
  load();

  /* ---- render all visible annotations for current date ---- */
  function render(month, date) {
    while (gAnnot.firstChild) gAnnot.removeChild(gAnnot.firstChild);
    const center = [-api.projection.rotate()[0], -api.projection.rotate()[1]];
    annotations.forEach(ann => {
      if (!shouldShow(ann, month, date)) return;
      const ll = [ann.lon, ann.lat];
      if (d3.geoDistance(ll, center) > 1.35) return;
      const p = api.projection(ll); if (!p) return;
      drawBadge(p[0], p[1], ann);
    });
  }

  function shouldShow(ann, month, date) {
    if (ann.dateStr) {
      // exact or range date match
      if (date) {
        const d0 = new Date(ann.dateStr);
        const d1 = ann.dateEndStr ? new Date(ann.dateEndStr) : d0;
        return date >= d0 && date <= new Date(d1.getTime() + 86400000);
      } else {
        // seasonal fallback: match month
        const m = parseInt(ann.dateStr.slice(5,7),10) - 1;
        return m === month;
      }
    }
    if (ann.month != null) return ann.month === month;
    return true; // always visible
  }

  function drawBadge(x, y, ann) {
    const col = ann.color || '#ffd24a';
    const g = A.el('g', { transform:`translate(${x},${y})`, style:'cursor:pointer', 'data-ann-id':ann.id }, gAnnot);
    // Pin line
    A.el('line', { x1:0, y1:0, x2:0, y2:-26, stroke:col, 'stroke-width':1.5, 'stroke-opacity':0.7 }, g);
    A.el('circle', { cx:0, cy:0, r:4, fill:col, style:`filter:drop-shadow(0 0 5px ${col})` }, g);
    // Label bubble
    const words = ann.text || 'Note';
    const bw = Math.min(220, Math.max(60, words.length * 6.8 + 16));
    const bx = -bw/2, by = -44;
    A.el('rect', { x:bx, y:by, width:bw, height:20, rx:5, fill:'rgba(5,14,24,0.88)',
      stroke:col, 'stroke-width':1.2, 'stroke-opacity':0.9 }, g);
    const t = A.el('text', { x:0, y:by+13.5, 'text-anchor':'middle',
      'font-family':'IBM Plex Mono,monospace', 'font-size':10, fill:col,
      text: words.length > 26 ? words.slice(0,24)+'…' : words }, g);
    t.style.filter = `drop-shadow(0 0 3px ${col})`;
    // date sub-label
    if (ann.dateStr) {
      A.el('text', { x:0, y:by-5, 'text-anchor':'middle',
        'font-family':'IBM Plex Mono,monospace', 'font-size':9,
        fill:'rgba(160,185,210,0.7)', text:ann.dateStr+(ann.dateEndStr?' → '+ann.dateEndStr:'') }, g);
    }
    g.addEventListener('click', e => { e.stopPropagation(); openEdit(ann.id); });
  }

  /* ---- subscribe to timeline ---- */
  if (window.GlobeTimeline) {
    window.GlobeTimeline.subscribe((m, d) => render(m, d));
  }
  // Also hook into globe redraw to reproject
  const prevOnRedraw = api.onRedraw;
  api.onRedraw = function() {
    if (prevOnRedraw) prevOnRedraw();
    if (!api.isDragging) render(api.currentMonth, window.GlobeTimeline?.date);
  };

  /* ---- globe click → pick position ---- */
  svg.addEventListener('click', e => {
    if (!pendingLonLat) return;
    // Same popup click-through guard as the feature-info handler: ignore
    // clicks whose mousedown began on UI chrome (see window._downOnGlobe).
    if (window._downOnGlobe === false) return;
    e.stopPropagation();
    const rect = svg.getBoundingClientRect();
    const xy = [e.clientX - rect.left, e.clientY - rect.top];
    const ll = api.projection.invert(xy);
    if (!ll) return;
    pendingLonLat(ll);
    pendingLonLat = null;
    document.getElementById('ann-pick-hint').style.display = 'none';
    svg.style.cursor = '';
  });

  /* ============================================================ VALUE PROBE
     Hold Alt and hover the globe to read lon/lat/value under the cursor for
     the topmost enabled data overlay — a standard "inspect a grid cell"
     tool researchers expect (Panoply, ncview, QGIS all have one). Reads
     straight from the already-decoded renderSlice, so it's effectively free. */
  const probeEl=document.createElement('div');
  probeEl.id='gp-value-probe';
  probeEl.style.cssText='position:fixed;z-index:500;pointer-events:none;display:none;'+
    'background:rgba(6,14,22,0.94);border:1px solid rgba(127,208,255,0.4);border-radius:6px;'+
    'padding:5px 9px;font-family:IBM Plex Mono,monospace;font-size:10.5px;color:#eaf4fb;'+
    'box-shadow:0 6px 20px rgba(0,0,0,0.45);white-space:nowrap;';
  document.body.appendChild(probeEl);
  function _probeSample(lon,lat){
    // Topmost = last in list that is enabled and has a renderable slice —
    // matches the visual stacking order overlays are drawn in.
    for(let k=api._overlaysForProbe.length-1;k>=0;k--){
      const ov=api._overlaysForProbe[k];
      if(!ov||ov.enabled===false||!ov.renderSlice) continue;
      const rs=ov.renderSlice;
      const lat0=rs.lats[0],lat1=rs.lats[rs.lats.length-1];
      const lon0=rs.lons[0],lon1=rs.lons[rs.lons.length-1];
      let fr=(lat-lat0)/((lat1-lat0)||1)*(rs.nLat-1);
      let fc=(lon-lon0)/((lon1-lon0)||1)*(rs.nLon-1);
      if(fr<-0.5||fr>rs.nLat-0.5||fc<-0.5||fc>rs.nLon-0.5) continue;
      const r=Math.max(0,Math.min(rs.nLat-1,Math.round(fr)));
      const c=Math.max(0,Math.min(rs.nLon-1,Math.round(fc)));
      const v=rs.data[r*rs.nLon+c];
      return {ov,v};
    }
    return null;
  }
  let _probeActive=false;
  window.addEventListener('keydown',e=>{ if(e.key==='Alt') _probeActive=true; });
  window.addEventListener('keyup',e=>{ if(e.key==='Alt'){ _probeActive=false; probeEl.style.display='none'; } });
  window.addEventListener('blur',()=>{ _probeActive=false; probeEl.style.display='none'; });
  svg.addEventListener('mousemove', e=>{
    if(!_probeActive||!api._overlaysForProbe||!api._overlaysForProbe.length){ probeEl.style.display='none'; return; }
    const rect=svg.getBoundingClientRect();
    const xy=[e.clientX-rect.left,e.clientY-rect.top];
    const ll=api.projection.invert(xy);
    if(!ll||Math.abs(ll[0])>180||Math.abs(ll[1])>90){ probeEl.style.display='none'; return; }
    const hit=_probeSample(ll[0],ll[1]);
    if(!hit||hit.v==null||isNaN(hit.v)){ probeEl.style.display='none'; return; }
    const units=(hit.ov.activeSlice&&hit.ov.activeSlice.units)||'';
    probeEl.innerHTML=
      '<b>'+(hit.ov.name||hit.ov.selVar||'layer')+'</b><br>'+
      ll[1].toFixed(2)+'°'+(ll[1]>=0?'N':'S')+', '+ll[0].toFixed(2)+'°'+(ll[0]>=0?'E':'W')+'<br>'+
      '<span style="color:#7fd0ff;font-size:12.5px;">'+hit.v.toPrecision(6)+(units?(' '+units):'')+'</span>';
    probeEl.style.left=(e.clientX+16)+'px';
    probeEl.style.top=(e.clientY+16)+'px';
    probeEl.style.display='';
  });
  svg.addEventListener('mouseleave',()=>{ probeEl.style.display='none'; });

  /* ============================================================ PANEL UI */
  function buildPanel() {
    const ctrl = document.getElementById('ctrl');
    const sec = document.createElement('div'); sec.id = 'ann-section';
    sec.innerHTML = `
<div class="nc-head" id="ann-head">
  <span>ANNOTATIONS <span class="nc-badge">pins</span></span>
  <span class="nc-tog" id="ann-tog">▸</span>
</div>
<div id="ann-body" style="display:none">
  <div id="ann-list" class="ann-list"></div>
  <button class="btn" id="ann-add" style="width:100%;margin-top:8px">＋ Add annotation</button>
</div>
<!-- add/edit form -->
<div id="ann-form" class="ann-form" style="display:none">
  <div class="ann-form-title" id="ann-form-title">New annotation</div>
  <label class="nl">Text<input type="text" id="ann-text" class="nc-ni" placeholder="Your note…" maxlength="80"></label>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <label class="nl">Start date<input type="date" id="ann-date" class="nc-ni"></label>
    <label class="nl">End date (opt.)<input type="date" id="ann-date-end" class="nc-ni"></label>
  </div>
  <label class="nl">Or month (if no date)
    <select id="ann-month" class="nc-sel">
      <option value="">— any —</option>
      ${['January','February','March','April','May','June','July','August','September','October','November','December'].map((m,i)=>`<option value="${i}">${m}</option>`).join('')}
    </select>
  </label>
  <label class="nl">Colour
    <div class="ann-colors" id="ann-colors">
      ${['#ffd24a','#ff6a55','#4ea4ff','#2bd4c4','#c779ff','#38e0a0'].map(c=>`<span class="ann-swatch" data-c="${c}" style="background:${c}"></span>`).join('')}
    </div>
  </label>
  <div id="ann-pick-hint" class="ann-pick" style="display:none">Click on the globe to place the pin…</div>
  <div style="display:flex;gap:8px;margin-top:6px">
    <button class="nc-gbtn" id="ann-place">📍 Place on globe</button>
    <button class="btn" id="ann-save" style="flex:1">Save</button>
    <button class="btn" id="ann-cancel" style="color:var(--warm)">✕</button>
  </div>
  <div id="ann-del-row" style="display:none;margin-top:6px">
    <button class="btn" id="ann-delete" style="width:100%;color:var(--warm)">🗑 Delete</button>
  </div>
</div>`;
    ctrl.appendChild(sec);

    // toggle
    document.getElementById('ann-tog').addEventListener('click', () => {
      const b = document.getElementById('ann-body'), t = document.getElementById('ann-tog');
      const v = b.style.display !== 'none'; b.style.display = v ? 'none' : ''; t.textContent = v ? '▸' : '▾';
    });
    document.getElementById('ann-add').addEventListener('click', () => openForm());
    document.getElementById('ann-save').addEventListener('click', saveForm);
    document.getElementById('ann-cancel').addEventListener('click', closeForm);
    document.getElementById('ann-delete').addEventListener('click', deleteAnn);
    document.getElementById('ann-colors').addEventListener('click', e => {
      const sw = e.target.closest('.ann-swatch'); if (!sw) return;
      document.querySelectorAll('.ann-swatch').forEach(s => s.classList.remove('sel'));
      sw.classList.add('sel');
    });
    document.getElementById('ann-place').addEventListener('click', () => {
      const hint = document.getElementById('ann-pick-hint');
      hint.style.display = '';
      svg.style.cursor = 'crosshair';
      pendingLonLat = ll => {
        formState.lon = ll[0]; formState.lat = ll[1];
        hint.style.display = 'none';
        document.getElementById('ann-place').textContent = `📍 ${ll[1].toFixed(1)}°, ${ll[0].toFixed(1)}°`;
      };
    });
    refreshList();
  }

  const formState = { lon: 0, lat: 0 };

  function openForm(id) {
    editingId = id || null;
    const form = document.getElementById('ann-form');
    const ann = id ? annotations.find(a => a.id === id) : null;
    document.getElementById('ann-form-title').textContent = id ? 'Edit annotation' : 'New annotation';
    document.getElementById('ann-text').value = ann?.text || '';
    document.getElementById('ann-date').value = ann?.dateStr || '';
    document.getElementById('ann-date-end').value = ann?.dateEndStr || '';
    document.getElementById('ann-month').value = ann?.month != null ? ann.month : '';
    document.querySelectorAll('.ann-swatch').forEach(s => s.classList.toggle('sel', s.dataset.c === (ann?.color||'#ffd24a')));
    document.getElementById('ann-del-row').style.display = id ? '' : 'none';
    formState.lon = ann?.lon || 0; formState.lat = ann?.lat || 0;
    document.getElementById('ann-place').textContent = ann ? `📍 ${ann.lat.toFixed(1)}°, ${ann.lon.toFixed(1)}°` : '📍 Place on globe';
    form.style.display = '';
    document.getElementById('ann-body').style.display = '';
  }
  function closeForm() {
    document.getElementById('ann-form').style.display = 'none';
    editingId = null; pendingLonLat = null;
    svg.style.cursor = '';
    document.getElementById('ann-pick-hint').style.display = 'none';
  }
  function saveForm() {
    const text = document.getElementById('ann-text').value.trim();
    if (!text) { alert('Please enter annotation text.'); return; }
    const dateStr = document.getElementById('ann-date').value || null;
    const dateEndStr = document.getElementById('ann-date-end').value || null;
    const monthVal = document.getElementById('ann-month').value;
    const month = monthVal !== '' ? parseInt(monthVal) : null;
    const color = document.querySelector('.ann-swatch.sel')?.dataset.c || '#ffd24a';
    const ann = {
      id: editingId || ('ann_' + Date.now()),
      text, dateStr, dateEndStr, month, color,
      lon: formState.lon, lat: formState.lat
    };
    if (editingId) {
      const i = annotations.findIndex(a => a.id === editingId);
      if (i >= 0) annotations[i] = ann;
    } else {
      annotations.push(ann);
    }
    save(); refreshList(); closeForm();
    render(api.currentMonth, window.GlobeTimeline?.date);
  }
  function deleteAnn() {
    if (!editingId) return;
    annotations = annotations.filter(a => a.id !== editingId);
    save(); refreshList(); closeForm();
    render(api.currentMonth, window.GlobeTimeline?.date);
  }
  function openEdit(id) { openForm(id); }

  function refreshList() {
    const list = document.getElementById('ann-list'); if (!list) return;
    list.innerHTML = '';
    if (!annotations.length) { list.innerHTML = '<div style="font-size:12px;color:var(--ink-faint);text-align:center;padding:8px">No annotations yet</div>'; return; }
    annotations.forEach(ann => {
      const row = document.createElement('div'); row.className = 'ann-row';
      const dot = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${ann.color};margin-right:7px;flex-shrink:0"></span>`;
      const when = ann.dateStr || (ann.month != null ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][ann.month] : 'Always');
      row.innerHTML = `<div style="display:flex;align-items:center;gap:6px;cursor:pointer">${dot}<span class="nc-fname" style="flex:1">${ann.text}</span><span class="nc-ffr">${when}</span></div>`;
      row.addEventListener('click', () => openEdit(ann.id));
      list.appendChild(row);
    });
  }

  buildPanel();
  if(window.reorgWorkspacePanel) window.reorgWorkspacePanel();
};

