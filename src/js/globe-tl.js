/* globe-tl */
/* ============================================================
   globe-timeline.js  –  Master time controller  (v2 — multi-cadence)
   ─────────────────────────────────────────────────────────────
   Each NC overlay has its own cadence (daily/weekly/monthly/
   yearly/irregular). The master clock advances in real-time at
   a chosen fps; each layer updates independently only when the
   master clock crosses its next frame boundary.

   Cadence detection:
     median gap between consecutive sortKeys (days):
       < 2   → daily
       < 10  → weekly
       < 40  → monthly
       else  → yearly / irregular

   Layer update rule:
     overlay shows frame i while  frames[i].sortKey <= t < frames[i+1].sortKey
     (last frame holds until end of range)

   Seasonal fallback (no NC files loaded):
     slider 0–11, chips J–D, same as before.
   ============================================================ */
window.GlobeTimeline = (function () {
  const listeners = [];
  let currentDate  = null;   // JS Date or null
  let currentMonth = new Date().getMonth();
  let playTimer    = null;
  let playFps      = 4;      // steps/sec on master clock
  let panelBuilt   = false;

  // All registered frame sets (one entry per overlay)
  const frameSets = [];  // [{frames, id}]

  // Unified date range across all overlays
  let rangeMin = null;   // days since epoch
  let rangeMax = null;

  /* ── public API ─────────────────────────────────────────── */
  const TL = {
    get month()   { return currentMonth; },
    get date()    { return currentDate;  },
    get playing() { return !!playTimer;  },

    /* Register or update a frame set for an overlay (call on load/reload) */
    registerFrames(frames, ovId) {
      if (!frames.length) return;
      const keys = frames.map(f => f.sortKey).filter(k => isFinite(k));
      if (!keys.length) return;

      // Update or insert
      const existing = frameSets.find(fs => fs.id === ovId);
      if (existing) existing.frames = frames;
      else frameSets.push({ frames, id: ovId });

      // Recompute union range
      rangeMin = null; rangeMax = null;
      frameSets.forEach(fs => {
        const ks = fs.frames.map(f=>f.sortKey).filter(isFinite);
        if (!ks.length) return;
        const mn = Math.min(...ks), mx = Math.max(...ks);
        if (rangeMin === null || mn < rangeMin) rangeMin = mn;
        if (rangeMax === null || mx > rangeMax) rangeMax = mx;
      });
      rebuildSlider();
    },

    unregisterFrames(ovId) {
      const i = frameSets.findIndex(fs => fs.id === ovId);
      if (i >= 0) frameSets.splice(i, 1);
      rangeMin = null; rangeMax = null;
      frameSets.forEach(fs => {
        const ks = fs.frames.map(f=>f.sortKey).filter(isFinite);
        if (!ks.length) return;
        const mn = Math.min(...ks), mx = Math.max(...ks);
        if (rangeMin === null || mn < rangeMin) rangeMin = mn;
        if (rangeMax === null || mx > rangeMax) rangeMax = mx;
      });
      rebuildSlider();
    },

    subscribe(fn) { listeners.push(fn); },

    setByMonth(m) {
      currentMonth = ((m % 12) + 12) % 12;
      currentDate  = null;
      dispatch();
      syncSliderUI();
    },

    setByDate(d) {
      currentDate  = d instanceof Date ? d : new Date(d);
      currentMonth = currentDate.getMonth();
      dispatch();
      syncSliderUI();
    },

    setByProgress(p) {
      if (rangeMin !== null && rangeMax !== null) {
        const days = rangeMin + p * (rangeMax - rangeMin);
        TL.setByDate(new Date(days * 86400000));
      } else {
        TL.setByMonth(Math.round(p * 11));
      }
    },

    startPlay() {
      if (playTimer) return;
      const pb = document.getElementById('tl-play');
      if (pb) pb.textContent = '⏸';
      // Step size: one "tick" = finest cadence present / playFps
      playTimer = setInterval(() => {
        const sl = document.getElementById('tl-slider');
        if (!sl) return;
        let v = +sl.value + 1;
        if (v > +sl.max) v = +sl.min;
        sl.value = v;
        TL.setByProgress(+sl.max > 0 ? v / +sl.max : v / 11);
      }, 1000 / playFps);
    },

    stopPlay() {
      clearInterval(playTimer); playTimer = null;
      const pb = document.getElementById('tl-play');
      if (pb) pb.textContent = '▶';
    },

    /* ── Given a set of frames, return the index whose time window
       contains currentDate.  Each frame i is active during
       [sortKey_i, sortKey_{i+1}).  Last frame holds to rangeMax. ── */
    nearestFrame(frames) {
      if (!frames.length) return 0;

      if (currentDate) {
        const t = currentDate.getTime() / 86400000;
        // Walk backward from the end to find last frame whose sortKey <= t
        for (let i = frames.length - 1; i >= 0; i--) {
          if (frames[i].sortKey <= t + 0.5) return i;  // +0.5 day tolerance
        }
        return 0;
      }

      // Seasonal fallback: find frame whose label month matches currentMonth
      let best = 0, bestDist = Infinity;
      frames.forEach((f, i) => {
        const m = f.label && f.label.length >= 7
          ? parseInt(f.label.slice(5, 7), 10) - 1
          : i % 12;
        const d = Math.abs(m - currentMonth);
        const dd = Math.min(d, 12 - d); // wrap around year
        if (dd < bestDist) { bestDist = dd; best = i; }
      });
      return best;
    },

    buildPanel(ctrl) {
      if (panelBuilt) return; panelBuilt = true;
      const sec = document.createElement('div');
      sec.id = 'tl-section';
      sec.innerHTML = `
<div class="tl-head" id="tl-head">
  <span>TIMELINE <span class="nc-badge">sync</span></span>
  <span class="nc-tog" id="tl-tog">▾</span>
</div>
<div id="tl-body">
  <div class="tl-row">
    <button class="nc-gbtn" id="tl-play">▶</button>
    <div class="nc-sr" style="flex:1;gap:8px">
      <input type="range" id="tl-speed" class="month-slider" min="1" max="30" value="4" style="flex:1">
      <span id="tl-fps" style="font-family:monospace;font-size:11px;color:var(--ink-faint);white-space:nowrap">4 fps</span>
    </div>
  </div>
  <div class="tl-date-row">
    <span class="tl-date" id="tl-date">—</span>
    <span class="tl-month-chips" id="tl-chips">${['J','F','M','A','M','J','J','A','S','O','N','D'].map((l,i)=>`<span class="tl-chip" data-m="${i}">${l}</span>`).join('')}</span>
  </div>
  <input type="range" id="tl-slider" class="month-slider" min="0" max="11" value="${currentMonth}" step="1" style="width:100%">
  <div id="tl-cadence-info" style="margin-top:5px"></div>
  <div class="tl-hint" id="tl-hint-mode">Seasonal mode — load .nc files to enable date timeline</div>
</div>`;
      ctrl.prepend(sec);

      document.getElementById('tl-tog').addEventListener('click', () => {
        const b = document.getElementById('tl-body'), t = document.getElementById('tl-tog');
        const v = b.style.display !== 'none'; b.style.display = v ? 'none' : ''; t.textContent = v ? '▸' : '▾';
      });
      document.getElementById('tl-play').addEventListener('click', () => TL.playing ? TL.stopPlay() : TL.startPlay());
      document.getElementById('tl-speed').addEventListener('input', e => {
        playFps = +e.target.value;
        document.getElementById('tl-fps').textContent = playFps + ' fps';
        if (TL.playing) { TL.stopPlay(); TL.startPlay(); }
      });
      document.getElementById('tl-slider').addEventListener('input', e => {
        TL.stopPlay();
        const max = +e.target.max;
        TL.setByProgress(max > 0 ? e.target.value / max : e.target.value / 11);
      });
      document.getElementById('tl-chips').addEventListener('click', e => {
        const chip = e.target.closest('.tl-chip'); if (!chip) return;
        TL.stopPlay(); TL.setByMonth(+chip.dataset.m);
      });
      syncSliderUI();
    }
  };

  /* ── Cadence detection ───────────────────────────────────── */
  function detectCadence(frames) {
    if (frames.length < 2) return 'single';
    const keys = frames.map(f => f.sortKey).filter(isFinite).sort((a,b)=>a-b);
    const gaps = [];
    for (let i = 1; i < keys.length; i++) gaps.push(keys[i] - keys[i-1]);
    gaps.sort((a,b)=>a-b);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (median < 2)   return 'daily';
    if (median < 10)  return 'weekly';
    if (median < 40)  return 'monthly';
    if (median < 100) return 'seasonal';
    return 'yearly';
  }

  /* ── Cadence info bar ────────────────────────────────────── */
  function updateCadenceInfo() {
    const el = document.getElementById('tl-cadence-info');
    if (!el || !frameSets.length) { if(el) el.innerHTML=''; return; }
    const colors = ['var(--acc)','var(--warm)','var(--cold)','var(--itcz)'];
    el.innerHTML = frameSets.map((fs, i) => {
      const c = detectCadence(fs.frames);
      const col = colors[i % colors.length];
      return `<span style="font-family:monospace;font-size:10px;color:${col};margin-right:8px">L${i+1}:${c}</span>`;
    }).join('');
  }

  function dispatch() {
    listeners.forEach(fn => { try { fn(currentMonth, currentDate); } catch(e) {} });
  }

  function syncSliderUI() {
    const sl = document.getElementById('tl-slider'); if (!sl) return;
    const dateEl = document.getElementById('tl-date');
    document.querySelectorAll('.tl-chip').forEach((c, i) => c.classList.toggle('active', i === currentMonth));
    if (currentDate && rangeMin !== null && rangeMax !== null) {
      const range = rangeMax - rangeMin || 1;
      const p = (currentDate.getTime() / 86400000 - rangeMin) / range;
      sl.value = Math.round(Math.max(0, Math.min(1, p)) * +sl.max);
      if (dateEl) dateEl.textContent = currentDate.toISOString().slice(0, 10);
    } else {
      sl.value = currentMonth;
      const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      if (dateEl) dateEl.textContent = MONTHS[currentMonth];
    }
    updateCadenceInfo();
  }

  function rebuildSlider() {
    const sl = document.getElementById('tl-slider'); if (!sl) return;
    const hint = document.getElementById('tl-hint-mode');
    if (rangeMin !== null && rangeMax !== null) {
      const totalDays = Math.min(7300, Math.round(rangeMax - rangeMin));
      sl.min = 0; sl.max = Math.max(totalDays, 1); sl.step = 1;
      if (!currentDate) TL.setByDate(new Date(rangeMin * 86400000));
      else syncSliderUI();
      if (hint) hint.textContent = 'Date timeline active — layers sync independently by cadence';
    } else {
      sl.min = 0; sl.max = 11; sl.step = 1;
      if (hint) hint.textContent = 'Seasonal mode — load .nc files to enable date timeline';
    }
    updateCadenceInfo();
  }

  return TL;
})();

