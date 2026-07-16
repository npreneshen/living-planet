/* globe-adv */
/* ============================================================
   globe-advanced.js — Advanced mode: seasonal + geography layers
   Called by globe.js as: window.AdvancedGlobe(GlobeAPI)
   ============================================================ */
window.AdvancedGlobe = function (api) {
  const A = api.A, d3 = api.d3;
  const svg = api.svg, gMain = api.gMain, gLabels = api.gLabels;
  const items = api.items, state = api.state;

  /* register all info data */
  if (window.GlobeInfo) Object.assign(api.infoData, window.GlobeInfo);

  /* ---- monthly data tables (index 0=Jan … 11=Dec) ---- */
  const ITCZ_LAT  = [-2,-1,2,5,8,9.5,11,10,7,4,1,-1];
  const ARCTIC_ICE= [72,70,68,71,74,77,79,80,80,78,75,73]; // southern edge °N — higher=less ice
  const ANTARC_ICE= [-68,-72,-73,-71,-66,-62,-60,-60,-60,-62,-65,-68]; // northern edge °S — less negative = more ice
  const POLAR_JET = [44,46,50,55,60,64,66,65,62,56,50,46]; // N-hemi polar jet base lat
  const SUB_JET   = [26,27,28,30,32,33,36,35,33,30,28,26]; // N-hemi sub-trop jet base lat

  /* cyclone basins */
  const BASINS = [
    { n:'Atlantic',       col:'#ff6060', mo:[5,6,7,8,9,10],    r:[[-100,8],[-15,8],[-15,24],[-100,24]] },
    { n:'E. Pacific',     col:'#ffaa40', mo:[4,5,6,7,8,9,10],  r:[[-140,5],[-75,5],[-75,22],[-140,22]] },
    { n:'W. Pacific',     col:'#ffdd44', mo:[4,5,6,7,8,9,10,11],r:[[100,5],[180,5],[180,25],[100,25]] },
    { n:'N. Indian',      col:'#cc88ff', mo:[3,4,5,8,9,10,11], r:[[50,5],[100,5],[100,22],[50,22]] },
    { n:'SW Indian',      col:'#44ccff', mo:[10,11,0,1,2,3],   r:[[25,-22],[100,-22],[100,-6],[25,-6]] },
    { n:'Australia/S.Pac',col:'#66ffcc', mo:[10,11,0,1,2,3],   r:[[100,-22],[180,-22],[180,-8],[100,-8]] }
  ];

  /* monsoon arrow pairs [from, to] */
  const MSOON_SW = [ /* Jun–Sep: SW onshore */
    [[55,3],[63,10]],[[60,-2],[68,6]],[[65,-5],[70,2]],[[72,-8],[76,0]],
    [[48,10],[55,18]],[[52,14],[60,22]],[[58,8],[65,16]],
    [[-12,5],[-4,12]],[[-6,3],[4,10]],[[0,2],[9,8]]
  ];
  const MSOON_NE = [ /* Oct–May: NE offshore */
    [[70,14],[62,8]],[[74,10],[66,4]],[[78,6],[69,0]],[[76,3],[67,-3]],
    [[65,20],[57,14]],[[60,22],[52,16]],[[62,16],[55,10]],
    [[8,15],[0,9]],[[12,13],[4,7]],[[14,10],[6,4]]
  ];

  /* ---- helper: create path node + register dynamic item ---- */
  function dynPath(layer, o, getGeo) {
    const node = A.el('path', {
      fill: o.fill||'none', stroke: o.stroke||o.color||'none',
      'stroke-width': o.width||1.8, 'stroke-linecap':'round', 'stroke-linejoin':'round',
      'fill-opacity': o.fillOp!=null?o.fillOp:1, 'stroke-opacity': o.strokeOp!=null?o.strokeOp:1
    }, gMain);
    if (o.dash) node.setAttribute('stroke-dasharray', o.dash);
    if (o.glow) node.style.filter = `drop-shadow(0 0 ${o.glowR||5}px ${o.color||o.stroke})`;
    const item = { kind:'path', layer, node, geo: getGeo(api.currentMonth), getGeo };
    items.push(item);
    if (state[layer] === undefined) state[layer] = false;
  }

  /* ================================================================
     SEASONAL LAYER 1 · ITCZ migration
  ================================================================ */
  function itczGeo(m) {
    const lat = ITCZ_LAT[m];
    const pts = []; for (let l=-180;l<=180;l+=4) pts.push([l, lat+3.2*Math.sin(l/28)]);
    return A.line(A.densify(pts, 4));
  }
  dynPath('s-itcz', { color:'#c779ff', width:4.5, dash:'10 7', glow:true, glowR:6, strokeOp:0.92 }, itczGeo);
  api.addDynamicLabel('s-itcz', m=>[-150, ITCZ_LAT[m]+1.5],
    'ITCZ (seasonal)', 'g-tech', { size:10, fill:'#c779ff', anchor:'start', info:'itcz' });

  /* ================================================================
     SEASONAL LAYER 2 · Sea Ice (Arctic + Antarctic)
  ================================================================ */
  const gc = d3.geoCircle().precision(4);
  function arcticGeo(m) {
    const r = 90 - ARCTIC_ICE[m];
    return gc.center([0,90]).radius(Math.max(1,r))();
  }
  function antarcGeo(m) {
    const r = 90 + ANTARC_ICE[m]; // ANTARC_ICE is negative
    return gc.center([0,-90]).radius(Math.max(1,r))();
  }
  const iceO = { fill:'rgba(200,235,255,0.24)', color:'rgba(160,224,255,0.88)', width:2, fillOp:1 };
  dynPath('seaice', iceO, arcticGeo);
  dynPath('seaice', iceO, antarcGeo);
  api.addDynamicLabel('seaice', m=>[0, ARCTIC_ICE[m]-5],
    'Arctic ice edge', 'g-tech', { size:10, fill:'rgba(180,225,255,0.9)', info:'seaice' });
  api.addDynamicLabel('seaice', m=>[0, ANTARC_ICE[m]+5],
    'Antarctic ice edge', 'g-tech', { size:10, fill:'rgba(180,225,255,0.9)' });

  /* ================================================================
     SEASONAL LAYER 3 · Monsoon winds
     Two pre-built static groups (SW summer, NE winter) — toggle visibility
     only when month changes, no path recreation per frame.
  ================================================================ */
  const MON_SW_COL = '#ff7a50', MON_NE_COL = '#60b8ff';
  const EMPTY = { type:'Feature', geometry:{ type:'LineString', coordinates:[] } };
  function isSW(m){ return m >= 5 && m <= 8; }   // Jun–Sep = SW monsoon
  // SW arrows visible only Jun–Sep; NE arrows visible only Oct–May.
  // Tracked as normal 'monsoon' layer items → toggle works, reproject every
  // frame via getGeo, animate via flow, and clip to the sphere.
  MSOON_SW.forEach(([a,b]) => {
    api.addLine('monsoon', [a,b], { color:MON_SW_COL, width:3, arrowScale:1.0, flow:true,
      flowPeriod:20, flowSpeed:0.65, glowR:4 },
      { getGeo: m => isSW(m) ? A.line(A.densify([a,b],1.5)) : EMPTY });
  });
  MSOON_NE.forEach(([a,b]) => {
    api.addLine('monsoon', [a,b], { color:MON_NE_COL, width:3, arrowScale:1.0, flow:true,
      flowPeriod:20, flowSpeed:0.65, glowR:4 },
      { getGeo: m => isSW(m) ? EMPTY : A.line(A.densify([a,b],1.5)) });
  });
  // Season label — follows the active monsoon
  api.addDynamicLabel('monsoon', m => isSW(m) ? [66, 20] : [66, -4],
    'MONSOON', 'g-tech', { size:10.5, fill:MON_SW_COL, info:'monsoon' });
  if (state['monsoon'] === undefined) state['monsoon'] = false;

  /* ================================================================
     SEASONAL LAYER 4 · Tropical cyclone basins (dynamic group)
  ================================================================ */
  let _cycloneMonth = -1;
  const cycloneG = api.addDynamic('cyclones', function(month, p) {
    const proj = api.projection;
    if (month === _cycloneMonth) {
      // Just reproject existing paths
      [...cycloneG.querySelectorAll('g[data-info]')].forEach(g2 => {
        const ll = g2._ll; if (!ll) return;
        const cp = proj(ll);
        if (cp) { g2.style.display = ''; g2.setAttribute('transform', `translate(${cp[0]},${cp[1]})`); }
        else g2.style.display = 'none';
      });
      [...cycloneG.querySelectorAll('path')].forEach(el => {
        const geo = el._geo; if (!geo) return;
        const d = p(geo) || '';
        el.setAttribute('d', d);
        el.style.display = d.length > 4 ? '' : 'none';
      });
      return;
    }
    _cycloneMonth = month;
    while (cycloneG.firstChild) cycloneG.removeChild(cycloneG.firstChild);
    BASINS.forEach(b => {
      if (!b.mo.includes(month)) return;
      // winding fix: a CCW ring makes d3 fill the whole sphere minus the box
      let rr=b.r.slice(); { let a2=0; for(let i=0;i<rr.length;i++){const j=(i+1)%rr.length;a2+=rr[i][0]*rr[j][1]-rr[j][0]*rr[i][1];} if(a2>0)rr=rr.reverse(); }
      const geo = A.poly([A.densify(rr.concat([rr[0]]), 3)]);
      const d = p(geo);
      if (!d) return;
      const pathEl = A.el('path', { d, fill:'rgba(0,0,0,0.08)', stroke:b.col,
        'stroke-width':2.2, 'stroke-dasharray':'8 4', 'stroke-opacity':0.92 }, cycloneG);
      pathEl._geo = geo;
      const cx = (b.r[0][0]+b.r[1][0])/2, cy = (b.r[0][1]+b.r[2][1])/2;
      const cp = proj([cx,cy]);
      if (cp) {
        const g2 = A.el('g', { transform:`translate(${cp[0]},${cp[1]})`,
          'data-info':'cyclones', style:'cursor:pointer' }, cycloneG);
        g2._ll = [cx, cy];
        A.el('text', { x:0, y:5, 'text-anchor':'middle', 'font-size':13,
          fill:b.col, 'fill-opacity':0.8, text:'🌀' }, g2);
        A.el('text', { x:0, y:24, 'text-anchor':'middle', class:'g-tech',
          'font-size':10, fill:b.col, text:b.n }, g2);
      }
    });
  });
  if (state['cyclones'] === undefined) state['cyclones'] = false;

  /* ================================================================
     SEASONAL LAYER 5 · Seasonal jet streams (migrate N/S)
  ================================================================ */
  /* ================================================================
     SEASONAL LAYER 5 · Seasonal jet streams (migrate N/S + Rossby amplitude)
     Polar jet uses wavenumber-3 + wavenumber-5 superposition (realistic troughs
     over western continents). Amplitude varies: large in winter, weak in summer.
     Sub-tropical jet is steadier but shifts with the Hadley cell boundary.
  ================================================================ */
  // Rossby wave amplitude: large in winter when N-S temp gradient is max
  const PJ_AMP = [14,13,11,8,5,3,3,4,7,10,12,14]; // NH polar jet amplitude by month
  const SJ_AMP = [2.5,2,2,2,2.5,3,3.5,3.5,2.5,2,2,2.5]; // subtropical jet amplitude

  function polarJetGeo(m, hemi) {
    // Use real ERA5 300 hPa data when available — trace the jet speed maximum
    // instead of the analytical Rossby-wave approximation. The embedded field
    // is an annual mean, so this ignores month `m` and holds one fixed shape.
    if (window._jetSpd) {
      const JGW=window._jetGW||360, JGH=window._jetGH||180;
      const spd=window._jetSpd;
      const latMin=hemi>0?25:-75, latMax=hemi>0?80:-25;
      const iyMin=Math.max(0,Math.floor(latMin+90)), iyMax=Math.min(JGH-1,Math.floor(latMax+90));
      const THRESH=25; // m/s minimum to trace (jet core)
      const pts=[];
      for(let ix=0;ix<JGW;ix+=2){
        const lon=-180+(ix+0.5);
        let best=-1,bestLat=hemi>0?55:-55;
        for(let iy=iyMin;iy<=iyMax;iy++){
          const s=spd[iy*JGW+ix]; if(s>best){best=s;bestLat=-90+(iy+0.5);}
        }
        if(best>=THRESH) pts.push([lon,bestLat]);
      }
      if(pts.length>=10) return A.line(A.densify(pts,2));
    }
    const base = POLAR_JET[m] * hemi;
    const amp = PJ_AMP[m] * (hemi < 0 ? PJ_AMP[(m+6)%12]/PJ_AMP[m] : 1); // SH: opposite season
    const pts = [];
    for (let l=-180;l<=180;l+=2) {
      // Superposition of wavenumber-3 (planetary Rossby) and wavenumber-5
      // Phase offsets match observed troughs: W of Rockies, W of Urals, W of Japan
      const y = base + amp*(0.65*Math.sin(l*Math.PI/60)+0.35*Math.sin(l*Math.PI/36+1.2));
      pts.push([l, Math.max(-85, Math.min(85, y))]);
    }
    return A.line(A.densify(pts, 2));
  }
  function subJetGeo(m, hemi) {
    const base = SUB_JET[m] * hemi;
    const amp = SJ_AMP[m] * (hemi < 0 ? SJ_AMP[(m+6)%12]/SJ_AMP[m] : 1);
    const pts = [];
    for (let l=-180;l<=180;l+=3) pts.push([l, base + amp*Math.sin(l*Math.PI/80+0.5)]);
    return A.line(A.densify(pts, 3));
  }

  // Polar jet: wide soft shear zone + bright animated core
  dynPath('s-jets', { color:'var(--jet-pol)', width:10, glow:false, strokeOp:0.12 }, m=>polarJetGeo(m, 1));
  dynPath('s-jets', { color:'var(--jet-pol)', width:10, glow:false, strokeOp:0.12 }, m=>polarJetGeo(m,-1));
  dynPath('s-jets', { color:'var(--jet-pol)', width:4.5, glow:true, glowR:7, strokeOp:0.92 }, m=>polarJetGeo(m, 1));
  dynPath('s-jets', { color:'var(--jet-pol)', width:4.5, glow:true, glowR:7, strokeOp:0.92 }, m=>polarJetGeo(m,-1));
  // Sub-tropical jet
  dynPath('s-jets', { color:'var(--jet-sub)', width:3.2, glow:true, glowR:4, strokeOp:0.85 }, m=>subJetGeo(m, 1));
  dynPath('s-jets', { color:'var(--jet-sub)', width:3.2, glow:true, glowR:4, strokeOp:0.85 }, m=>subJetGeo(m,-1));
  api.addDynamicLabel('s-jets', m=>[150, POLAR_JET[m]+5], 'Polar jet', 'g-feat',
    { size:11, fill:'#7fa0ff', info:'s-jets' });
  api.addDynamicLabel('s-jets', m=>[150, SUB_JET[m]+4], 'Subtropical jet', 'g-feat',
    { size:11, fill:'var(--jet-sub)' });

  /* ================================================================
     STATIC GEOGRAPHY · Mountains
  ================================================================ */
  [
    ['Andes',       [[-72,10],[-70,0],[-68,-18],[-69,-33],[-70,-42],[-72,-52]]],
    ['Rockies',     [[-117,33],[-114,40],[-111,47],[-116,54]]],
    ['Himalaya',    [[70,30],[82,30],[90,28],[96,26],[102,24]]],
    ['Alps',        [[5,44],[10,46],[15,47],[18,46]]],
    ['Atlas Mts',   [[-5,33],[4,33],[9,31]]],
    ['Urals',       [[58,51],[58,56],[60,60],[60,65]]],
    ['Caucasus',    [[38,41],[43,42],[47,43]]],
    ['E. Africa Rift',[[35,2],[36,0],[36,-4],[34,-10]]],
    ['Appalachians',[[-84,34],[-82,38],[-80,42],[-74,44]]]
  ].forEach(([name,pts]) => {
    api.addLine('mountains', pts, { color:'rgba(180,150,110,0.82)', width:3.5, arrow:false, glow:false, dash:'4 4', step:2.5 });
    const mid = pts[Math.floor(pts.length/2)];
    api.addLabel('mountains', mid, name, 'g-tech', { size:10, fill:'rgba(205,175,130,0.88)', dy:-7, info:'mountains' });
  });

  /* ================================================================
     STATIC GEOGRAPHY · Deserts
  ================================================================ */
  A.hatchPattern(svg, 'desert-hatch', '#d4a040', 0.10);
  [
    ['Sahara',      [[-17,16],[50,16],[50,30],[-17,30]]],
    ['Arabian',     [[35,15],[60,15],[60,30],[35,30]]],
    ['Atacama',     [[-76,-28],[-69,-28],[-69,-15],[-76,-15]]],
    ['Namib',       [[12,-30],[17,-30],[17,-18],[12,-18]]],
    ['Kalahari',    [[20,-30],[28,-30],[28,-20],[20,-20]]],
    ['Gobi',        [[90,38],[114,38],[114,50],[90,50]]],
    ['Aus. Outback',[[114,-32],[140,-32],[140,-22],[114,-22]]]
  ].forEach(([name,r]) => {
    api.addPoly('deserts', r, { fill:'url(#desert-hatch)', stroke:'rgba(212,160,64,0.75)', sw:1.2, fillOp:1, strokeOp:1 });
    const cx=(r[0][0]+r[1][0])/2, cy=(r[0][1]+r[2][1])/2;
    api.addLabel('deserts', [cx,cy], name, 'g-tech', { size:10.5, fill:'rgba(222,170,80,0.9)', info:'deserts' });
  });

  /* ================================================================
     STATIC GEOGRAPHY · Rainforests
  ================================================================ */
  A.hatchPattern(svg, 'forest-hatch', '#2ea86e', 0.14);
  [
    ['Amazon',  [[-76,-14],[-46,-14],[-46,5],[-76,5]]],
    ['Congo',   [[14,-6],[30,-6],[30,6],[14,6]]],
    ['SE Asia', [[95,-4],[140,-4],[140,10],[95,10]]]
  ].forEach(([name,r]) => {
    api.addPoly('forests', r, { fill:'url(#forest-hatch)', stroke:'rgba(46,168,110,0.72)', sw:1.2, fillOp:1, strokeOp:1 });
    const cx=(r[0][0]+r[1][0])/2, cy=(r[0][1]+r[2][1])/2;
    api.addLabel('forests', [cx,cy], name, 'g-tech', { size:10.5, fill:'rgba(80,220,140,0.9)', info:'forests' });
  });

  /* ================================================================
     STATIC GEOGRAPHY · Ring of Fire + Mid-Ocean Ridges
  ================================================================ */
  api.addLine('ringfire',
    [[-106,18],[-88,14],[-78,2],[-72,-15],[-70,-35],[-75,-48],
     [-178,-55],[-170,52],[-165,55],[-155,60],[-148,61],[-135,59],
     [143,39],[135,34],[130,32],[124,25],[120,22],[115,10],[106,0],
     [124,-8],[132,-15],[150,-22],[160,-22],[170,-18]],
    { color:'rgba(255,80,40,0.88)', width:3.6, arrow:false, glow:true, glowR:4, glowColor:'rgba(255,80,40,0.65)', step:3 });
  api.addLabel('ringfire', [-178,0], 'RING OF FIRE', 'g-tech',
    { size:10, fill:'rgba(255,120,80,0.92)', anchor:'start', info:'ringfire' });
  // Alpide belt — the planet's second great seismic belt (Azores→Himalaya→Indonesia)
  api.addLine('ringfire',
    [[-28,38],[-12,36],[0,37],[12,38],[22,38.5],[30,38],[38,37],[46,35],[54,31],[62,30],
     [70,33],[78,32],[86,28],[93,26],[97,20],[98,12],[97,5],[100,-2],[106,-6.5],[114,-8],[122,-8.5],[130,-6.5]],
    { color:'rgba(255,150,60,0.7)', width:2.4, arrow:false, glow:false, dash:'7 4', step:3 });
  api.addLabel('ringfire', [40,33], 'Alpide Belt', 'g-feat',
    { size:9.5, fill:'rgba(255,170,90,0.85)' });
  // Major subduction trenches (deepest seismic zones)
  [['Mariana Tr.',147.5,15.5],['Japan Tr.',144.5,38.5],['Peru–Chile Tr.',-73.5,-23],
   ['Sunda Tr.',106,-9.5],['Tonga Tr.',-173,-21.5],['Aleutian Tr.',-176,51.5]
  ].forEach(([n2,lo,la])=>api.addLabel('ringfire',[lo,la],'▼ '+n2,'g-tech',{size:8.5,fill:'rgba(255,130,90,0.8)'}));
  // Mid-Atlantic Ridge
  api.addLine('ringfire',
    [[-18,70],[-26,62],[-28,54],[-30,45],[-28,36],[-24,25],[-14,12],[-12,2],[-12,-12],[-14,-22],[-14,-36],[-16,-50],[-22,-56],[-30,-62]],
    { color:'rgba(255,120,80,0.65)', width:2.2, arrow:false, glow:false, dash:'8 4', step:3 });
  api.addLabel('ringfire', [-28,18], 'Mid-Atlantic Ridge', 'g-feat',
    { size:10, fill:'rgba(255,150,110,0.82)' });

  /* ================================================================
     STATIC GEOGRAPHY · Named wind latitude zones
  ================================================================ */
  [
    { h:12,   lat:0,   col:'rgba(199,121,255,0.30)', lab:'Doldrums (±6°)',      lcol:'rgba(205,130,255,0.9)', info:'windlats' },
    { h:5,    lat:30,  col:'rgba(255,120,60,0.25)',  lab:'Horse Latitudes 30°N',lcol:'rgba(255,155,85,0.88)' },
    { h:5,    lat:-30, col:'rgba(255,120,60,0.25)',  lab:'Horse Latitudes 30°S',lcol:'rgba(255,155,85,0.88)' },
    { h:11,   lat:-43, col:'rgba(143,157,255,0.28)', lab:'Roaring Forties',     lcol:'rgba(165,175,255,0.9)', info:'windlats' },
    { h:9,    lat:-54, col:'rgba(120,140,255,0.26)', lab:'Furious Fifties',     lcol:'rgba(150,165,255,0.9)' },
    { h:8,    lat:-64, col:'rgba(90,120,255,0.24)',  lab:'Screaming Sixties',   lcol:'rgba(130,155,255,0.9)' }
  ].forEach(z => {
    const ring=[];
    for (let l=-180;l<=180;l+=6) ring.push([l,z.lat+z.h/2]);
    for (let l=180;l>=-180;l-=6) ring.push([l,z.lat-z.h/2]);
    api.addPoly('windlats', ring, { fill:z.col, stroke:'none', sw:0, fillOp:1, strokeOp:0 });
    api.addLabel('windlats', [-170, z.lat], z.lab, 'g-tech',
      { size:9.5, fill:z.lcol, anchor:'start', info:z.info||null });
  });

  /* ================================================================
     PANEL: inject Advanced groups (hidden until Advanced mode)
  ================================================================ */
  const CHK='<svg viewBox="0 0 12 12"><path d="M2 6.5 L5 9.5 L10 3" fill="none" stroke="#061119" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function sw2(sw) {
    const t=sw[0],c=sw[1];
    if(t==='l') return `<span class="swl" style="border-top-color:${c};box-shadow:0 0 5px ${c}"></span>`;
    if(t==='d') return `<span class="swd" style="border-top-color:${c}"></span>`;
    if(t==='b') return `<span class="swb" style="background:${c};box-shadow:0 0 4px ${c}"></span>`;
    if(t==='h') return `<span class="swh" style="border-color:${c};background:repeating-linear-gradient(45deg,transparent,transparent 3px,${c} 3px,${c} 4.4px)"></span>`;
    if(t==='c') return `<span class="swc" style="background:${c};box-shadow:0 0 6px ${c}"></span>`;
    return '';
  }
  function setAdv(id,on){
    state[id]=on;
    const row=document.querySelector(`.row[data-layer="${id}"]`);
    if(row){row.classList.toggle('on',on);row.classList.toggle('off',!on);}
    if(id==='user-geo'&&window._userGeoLayer) window._userGeoLayer.enabled=on;
    if(id==='user-geo'&&on&&window.GlobeAPI?.redraw) window.GlobeAPI.redraw();
    if(id==='user-geo'&&window._syncUserGeoUi) window._syncUserGeoUi();
    api.redraw();
  }
  [
    { name:'Geography', items:[
      {id:'mountains',label:'Mountain ranges',       sw:['l','rgba(200,165,110,0.88)'],on:false},
      {id:'countries',label:'Country borders',       sw:['l','rgba(120,160,190,0.6)'], on:true},
      {id:'country-names',label:'Country names',      sw:['c','rgba(190,205,220,0.65)'],on:true},
      {id:'user-geo',  label:'Loaded boundaries',   sw:['l','rgba(255,210,127,0.55)'],on:false,
        title:'Toggle optional boundary GeoJSON loaded below.'},
      {id:'traderoutes',label:'Maritime trade routes',sw:['d','#e8c468'],               on:false},
      {id:'deserts',  label:'Deserts',               sw:['h','#d4a040'],               on:false},
      {id:'forests',  label:'Tropical rainforests',  sw:['h','#2ea86e'],               on:false},
      {id:'ringfire', label:'Ring of Fire / Ridges', sw:['l','rgba(255,80,40,0.9)'],   on:false},
      {id:'windlats', label:'Named wind zones',      sw:['b','rgba(143,157,255,0.75)'],on:false},
      {id:'straits', label:'Straits & passages',   sw:['c','#8fd4ff'],               on:false}
    ]},
    { name:'Seasonal (use month slider)', items:[
      {id:'s-itcz',  label:'ITCZ migration',         sw:['d','#c779ff'],               on:false},
      {id:'seaice',  label:'Sea-ice extent',          sw:['b','rgba(180,225,255,0.85)'],on:false},
      {id:'monsoon', label:'Monsoon winds',           sw:['l','#ff7a50'],               on:false},
      {id:'cyclones',label:'Cyclone basins (active)', sw:['c','#ff6060'],               on:false},
      {id:'s-jets',  label:'Seasonal jet streams',   sw:['l','var(--jet-pol)'],         on:false}
    ]}
  ].forEach((grp,gi) => {
    const sec=document.createElement('div');
    sec.className='grp collapsible';
    sec.innerHTML=`<div class="grp-head" data-agrp="${grp.name}">
      <span class="grp-caret">▸</span>
      <span class="grp-name">${grp.name}</span>
      <span class="toggle-all-adv" data-agrp="${grp.name}">all</span>
    </div><div class="grp-body" style="display:none"></div>`;
    const body=sec.querySelector('.grp-body');
    grp.items.forEach(it=>{
      if(state[it.id]===undefined) state[it.id]=it.on;
      const row=document.createElement('div');
      row.className='row'+(state[it.id]?' on':' off');
      row.dataset.layer=it.id;
      if(it.id==='user-geo') row.style.display='none';
      row.innerHTML=`<span class="chk">${CHK}</span><span class="sw">${sw2(it.sw)}</span><span class="lbl">${it.label}</span>`;
      row.addEventListener('click',()=>setAdv(it.id,!state[it.id]));
      body.appendChild(row);
    });
    sec.querySelector('.toggle-all-adv').addEventListener('click',e=>{
      e.stopPropagation();
      const anyOff=grp.items.some(it=>!state[it.id]);
      grp.items.forEach(it=>setAdv(it.id,anyOff));
    });
    sec.querySelector('.grp-head').addEventListener('click',e=>{
      if(e.target.classList.contains('toggle-all-adv'))return;
      const b=sec.querySelector('.grp-body'),caret=sec.querySelector('.grp-caret');
      const hidden=b.style.display==='none';
      b.style.display=hidden?'':'none'; caret.textContent=hidden?'▾':'▸';
    });
    document.getElementById('groups').appendChild(sec);
  });

  /* Maritime trade routes — real traced shipping corridors, three tiers by
     traffic density. Major reads as the animated "trunk" lanes (closest to
     what the old schematic tried to depict, now geographically real);
     Middle/Minor are static, fainter, unanimated — supporting texture
     rather than 187 more competing animated dashes. step:3 on addLine's
     densify is a safety margin only: this data is already sampled far
     finer than that, so densify is a no-op for nearly every segment (see
     its "add points only where sparse" behaviour). */
  (window.GlobeFeatures.SHIPPING_LANES?.Major||[]).forEach(path=>{
    api.addLine('traderoutes',path,{color:'rgba(232,196,104,0.7)',width:1.1,
      glow:false,arrowScale:0.6,arrow:false,flow:true,flowPeriod:26,flowSpeed:0.35,step:3});
  });
  (window.GlobeFeatures.SHIPPING_LANES?.Middle||[]).forEach(path=>{
    api.addLine('traderoutes',path,{color:'rgba(232,196,104,0.38)',width:0.7,
      glow:false,arrow:false,flow:false,step:3});
  });
  (window.GlobeFeatures.SHIPPING_LANES?.Minor||[]).forEach(path=>{
    api.addLine('traderoutes',path,{color:'rgba(232,196,104,0.18)',width:0.5,
      glow:false,arrow:false,flow:false,step:3});
  });
  (window.GlobeFeatures.PORTS||[]).forEach(([n2,lo,la])=>{
    api.addLabel('traderoutes',[lo,la],'◈ '+n2,'g-tech',{size:8.5,fill:'rgba(232,196,104,0.85)'});
  });
  if (state['traderoutes'] === undefined) state['traderoutes'] = false;

  /* Straits & passages — chokepoints researchers monitor */
  [['Drake Passage',-62,-58.5],['Str. of Gibraltar',-5.5,36.2],['Str. of Malacca',100,3.5],
   ['Bering Strait',-169,65.8],['Str. of Hormuz',56.5,26.4],['Bab-el-Mandeb',43.4,12.6],
   ['Denmark Strait',-27,66.5],['Mozambique Channel',40.5,-18.5],['Luzon Strait',121,20.5],
   ['Fram Strait',-2,78.8],['Torres Strait',142.4,-9.9],['Yucatán Channel',-85.8,21.8]
  ].forEach(([n2,lo,la])=>api.addLabel('straits',[lo,la],n2,'g-tech',{size:9.5,fill:'rgba(143,212,255,0.85)'}));
  if (state['straits'] === undefined) state['straits'] = false;

  /* Seasonal preset button — toggles its layers independently */
  const pb=document.createElement('button');
  pb.textContent='Seasonal';
  pb.dataset.preset='seasonal';
  pb.addEventListener('click',()=>{
    const want=['s-itcz','seaice','monsoon','cyclones','s-jets'];
    const allOn=want.every(id=>!!state[id]);
    want.forEach(id=>setAdv(id,!allOn));
    // Highlight button when active
    pb.classList.toggle('on',!allOn);
  });
  document.getElementById('presets').appendChild(pb);

  /* Geography preset button */
  const pbGeo=document.createElement('button');
  pbGeo.textContent='Geography';
  pbGeo.dataset.preset='geography';
  pbGeo.addEventListener('click',()=>{
    const want=['mountains','countries','country-names','straits'];
    const allOn=want.every(id=>!!state[id]);
    want.forEach(id=>setAdv(id,!allOn));
    pbGeo.classList.toggle('on',!allOn);
  });
  document.getElementById('presets').appendChild(pbGeo);

  /* initial render with current month */
  api.redraw();
};

