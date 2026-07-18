/* globe */
/* ============================================================
   globe.js — interactive rotatable orthographic globe
   Basic / Advanced modes · seasonal month slider · info panel
   ============================================================ */
(function () {
  const A = Atlas;
  const svg = document.getElementById('globe');
  const d3svg = d3.select(svg);

  /* ---- state ---- */
  let world = null;
  let scale = 300, baseScale = 300, cx = 0, cy = 0;
  function globeViewport(){
    return { w: innerWidth, h: innerHeight, dpr: window.devicePixelRatio||1 };
  }
  function syncGlobeClip(){
    if(window._syncFlowClip) window._syncFlowClip(cx,cy,scale);
  }
  function _userGeoLabelName(props){
    if(!props) return null;
    return props.name||props.NAME||props.Name||props.name_en||props.gn_name||props.woe_name||null;
  }
  function _userGeoMinZLod(props){
    if(!props) return 1.52;
    if(props.min_zoom!=null&&!isNaN(+props.min_zoom)) return Math.max(1.48,1.42+0.06*+props.min_zoom);
    const sr=props.scalerank!=null?+props.scalerank:(props.labelrank!=null?+props.labelrank:5);
    return 1.48+sr*0.06;
  }
  function _userGeoLabelLL(f){
    const p=f.properties||{};
    const la=+p.latitude, lo=+p.longitude;
    if(!isNaN(la)&&!isNaN(lo)&&Math.abs(la)<=90) return [lo,la];
    try{
      const c=d3.geoCentroid(f);
      if(c&&!isNaN(c[0])&&!isNaN(c[1])) return c;
    }catch(e){}
    return null;
  }
  function _buildUserGeoLabelSpecs(ug){
    if(!ug||!ug.geo||!ug.geo.features) return;
    for(let i=items.length-1;i>=0;i--){
      if(items[i].layer==='user-geo'&&items[i].kind==='label'){
        items[i].node.remove();
        items.splice(i,1);
      }
    }
    ug.labelSpecs=[];
    for(const f of ug.geo.features){
      const name=_userGeoLabelName(f.properties);
      const ll=_userGeoLabelLL(f);
      if(!name||!ll) continue;
      ug.labelSpecs.push({name,ll,minZLod:_userGeoMinZLod(f.properties),item:null});
    }
  }
  function _ensureUserGeoLabel(spec){
    if(spec.item) return spec.item;
    const lbl=addLabel('user-geo',spec.ll,spec.name,'g-tech',
      {size:8.5,fill:'rgba(255,210,127,0.88)',dx:2,dy:-2,anchor:'start'});
    lbl._minZLod=spec.minZLod;
    spec.item=lbl;
    return lbl;
  }
  function _syncUserGeoLabels(zLod, center){
    const ug=window._userGeoLayer;
    if(!ug||!ug.labelSpecs||!ug.labelSpecs.length) return;
    const toggleOn=!!state['user-geo'];
    if(!toggleOn&&zLod<=1.52) return;
    for(const spec of ug.labelSpecs){
      if(!toggleOn&&zLod<spec.minZLod) continue;
      if(d3.geoDistance(spec.ll,center)>1.38) continue;
      _ensureUserGeoLabel(spec);
    }
  }
  // Radial-distance ring/line simplifier in DEGREES. tol 0.02° ≈ 2.2 km —
  // below one screen pixel even at max zoom (≈0.1°/px), so the "hi" level
  // is visually lossless; the "lo" level (0.08°) is only ever shown while
  // the globe is in MOTION, where the difference is imperceptible. This is
  // strictly a RENDER copy — ug.geo keeps the original full-resolution
  // geometry for region extraction / point-in-polygon.
  function _simplifyLine(pts,tol){
    if(!pts||pts.length<3) return pts;
    const t2=tol*tol, out=[pts[0]];
    let last=pts[0];
    for(let i=1;i<pts.length-1;i++){
      const p=pts[i];
      const dx=(p[0]-last[0])*Math.cos(p[1]*Math.PI/180), dy=p[1]-last[1];
      if(dx*dx+dy*dy>t2){ out.push(p); last=p; }
    }
    out.push(pts[pts.length-1]);
    return out;
  }
  function _simplifyGeom(g,tol){
    const t=g.type;
    if(t==='LineString') return {type:t,coordinates:_simplifyLine(g.coordinates,tol)};
    if(t==='MultiLineString') return {type:t,coordinates:g.coordinates.map(r=>_simplifyLine(r,tol))};
    if(t==='Polygon') return {type:t,coordinates:g.coordinates.map(r=>_simplifyLine(r,tol)).filter(r=>r.length>=4)};
    if(t==='MultiPolygon') return {type:t,coordinates:g.coordinates.map(p=>p.map(r=>_simplifyLine(r,tol)).filter(r=>r.length>=4)).filter(p=>p.length)};
    return g;
  }
  function _buildUserGeoFeatMeta(ug){
    const D2=Math.PI/180;
    ug._featMeta=[];
    for(const f of ug.geo.features){
      if(!f.geometry) continue;
      try{
        const c=d3.geoCentroid(f);
        if(!c||isNaN(c[0])) continue;
        // Angular radius of the feature's bounding circle around its
        // centroid, from its lon/lat bounds (cheap upper bound — exact
        // enough for a "definitely on the far side" cull).
        const b=d3.geoBounds(f); // [[w,s],[e,n]]
        const corners=[[b[0][0],b[0][1]],[b[0][0],b[1][1]],[b[1][0],b[0][1]],[b[1][0],b[1][1]]];
        let r=0;
        for(const q of corners){ const dd=d3.geoDistance(c,q); if(dd>r) r=dd; }
        ug._featMeta.push({
          c:c, r:Math.min(r,Math.PI),
          hi:{type:'Feature',geometry:_simplifyGeom(f.geometry,0.02)},
          lo:{type:'Feature',geometry:_simplifyGeom(f.geometry,0.08)}
        });
      }catch(e){}
    }
  }
  function applyUserGeoLayer(){
    try{
    for(let i=items.length-1;i>=0;i--){
      if(items[i].layer==='user-geo'){
        items[i].node.remove();
        items.splice(i,1);
      }
    }
    const ug=window._userGeoLayer;
    if(!ug||!ug.geo) return;
    let geo=ug.geo;
    if(geo.type==='Feature') geo={type:'FeatureCollection',features:[geo]};
    if(!geo.features||!geo.features.length) return;
    ug.geo=geo;
    _buildUserGeoLabelSpecs(ug);
    _buildUserGeoFeatMeta(ug);
    const pathNode=A.el('path',{fill:'none',stroke:'rgba(255,210,127,0.42)','stroke-width':0.45,'stroke-linejoin':'round'},gMain);
    items.push({kind:'path',layer:'user-geo',node:pathNode,geo,_userGeoPath:true});
    if(window._syncUserGeoUi) window._syncUserGeoUi();
    redraw();
    }catch(err){
      console.error('[applyUserGeoLayer]', err);
      throw err;
    }
  }
  function clearUserGeoLayer(){
    window._userGeoLayer=null;
    if(state['user-geo']!==undefined) state['user-geo']=false;
    applyUserGeoLayer();
    const row=document.querySelector('.row[data-layer="user-geo"]');
    if(row){row.style.display='none';row.classList.remove('on');row.classList.add('off');}
    if(window._syncUserGeoUi) window._syncUserGeoUi();
    redraw();
  }
  // Opening view centers Africa (~17°E, 2°N) — d3 rotate is [-λ,-φ].
  let rotate = [-17, -2, 0];
  // Max zoom as a multiple of baseScale. Was 3.2 — enough to inspect a
  // continent but nowhere near enough to make a small regional GRIB2 grid
  // (a few hundred km across — HRRR-Alaska, a Puerto Rico NDFD analysis,
  // the Great Lakes wave model...) fill a useful portion of the screen.
  // Projected-grid overlays are decimated to a fixed point cap regardless
  // of zoom level, so raising this doesn't add rendering cost.
  const MAX_ZOOM = 25;
  let night = true, dragging = false;
  let flowTick = 0, frameCount = 0, ncDeferTimer = null;
  let currentMonth = new Date().getMonth();
  let globeMode = 'basic';
  let playTimer = null;

  const projection = d3.geoOrthographic().clipAngle(90).precision(0.4);
  const path = d3.geoPath(projection);
  const items = [];
  const state = {};
  const infoData = {};

  /* ---- defs ---- */
  const defs = A.ensureDefs(svg);
  A.linearGrad(svg, 'sphereGrad', [[0,'#0c2338'],[0.55,'#071929'],[1,'#040f18']], 0, 0, 1, 1);
  (function(){
    const g = A.el('radialGradient',{id:'atmoGrad',cx:'0.5',cy:'0.5',r:'0.5'},defs);
    A.el('stop',{offset:'0.78','stop-color':'#2bd4c4','stop-opacity':'0'},g);
    A.el('stop',{offset:'0.94','stop-color':'#3fa9c4','stop-opacity':'0.20'},g);
    A.el('stop',{offset:'1','stop-color':'#3fa9c4','stop-opacity':'0'},g);
  })();
  const nightGrad = A.el('radialGradient',{id:'nightGrad',gradientUnits:'userSpaceOnUse'},defs);
  A.el('stop',{offset:'0','stop-color':'#000','stop-opacity':'0'},nightGrad);
  A.el('stop',{offset:'0.52','stop-color':'#000','stop-opacity':'0'},nightGrad);
  A.el('stop',{offset:'1','stop-color':'#02060c','stop-opacity':'0.65'},nightGrad);

  const haloNode   = A.el('circle',{fill:'url(#atmoGrad)'},svg);
  const sphereNode = A.el('path',{fill:'none',stroke:'rgba(120,200,225,0.45)','stroke-width':1.0},svg);
  // Clip everything in gMain to the sphere disc (kills arrowheads/markers past the horizon)
  const sphereClip = A.el('clipPath',{id:'sphere-clip'},defs);
  const sphereClipCircle = A.el('circle',{cx:0,cy:0,r:300},sphereClip);
  const gMain    = A.group(svg,null,'gmain');
  gMain.setAttribute('clip-path','url(#sphere-clip)');
  const nightNode  = A.el('circle',{fill:'url(#nightGrad)','pointer-events':'none'},svg);
  const gLabels  = A.group(svg,null,'glabels');
  // Labels sit above the wind-particle canvas (z-index 16); wind renders over land fill.
  const svgLabels=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svgLabels.id='globe-labels';
  svgLabels.setAttribute('xmlns','http://www.w3.org/2000/svg');
  svgLabels.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:17;pointer-events:none;overflow:visible;';
  document.body.appendChild(svgLabels);
  svgLabels.appendChild(gLabels);
  window._globeLabelSvg=svgLabels;
  // Ensure wind particle canvas (if already created) sits between land and labels.
  const wFlow=document.getElementById('wind-flow-canvas')||document.getElementById('wind-flow-gpu');
  if(wFlow) document.body.insertBefore(wFlow,svgLabels);

  /* ============================================================ DATA */
  const C = { warm:'var(--warm)',cold:'var(--cold)',acc:'var(--acc)',up:'var(--upwell)',
    itcz:'var(--itcz)',trade:'var(--trade)',wester:'var(--wester)',polar:'var(--polar)',
    jsub:'var(--jet-sub)',jpol:'var(--jet-pol)' };

  const WARM = [
    ['Gulf Stream',[[-80,25],[-79,31],[-74,36],[-66,40],[-52,43],[-38,47]],[-58,44],'gulf-stream'],
    ['N. Atlantic Drift',[[-38,47],[-24,52],[-8,57],[6,62]],[-4,60],'n-atlantic-drift'],
    ['Kuroshio',[[122,21],[127,27],[135,33],[143,36],[153,39],[163,41]],[150,43],'kuroshio'],
    ['Brazil C.',[[-36,-8],[-43,-19],[-50,-29],[-55,-38]],[-44,-26],'brazil-current'],
    ['Agulhas C.',[[38,-22],[33,-29],[27,-35],[20,-38]],[40,-30],'agulhas'],
    ['E. Australian C.',[[153,-24],[152,-31],[150,-37],[149,-43]],[156,-34],'east-australian'],
    ['Mozambique C.',[[42,-12],[40,-18],[37,-24]],[46,-17],null]
  ];
  const COLD = [
    ['California C.',[[-127,46],[-124,39],[-119,31],[-112,23]],[-128,37],'california-current'],
    ['Humboldt C.',[[-74,-40],[-76,-30],[-79,-18],[-81,-7],[-82,1]],[-86,-20],'humboldt'],
    ['Canary C.',[[-11,34],[-15,27],[-18,20],[-19,14]],[-24,24],null],
    ['Benguela C.',[[16,-33],[13,-25],[11,-18],[10,-12]],[4,-20],'benguela'],
    ['Labrador C.',[[-52,62],[-53,56],[-51,50],[-49,45]],[-60,53],null],
    ['Oyashio C.',[[162,54],[156,48],[150,43],[145,39]],[167,48],null],
    ['W. Australian C.',[[112,-18],[112,-27],[114,-34],[116,-38]],[106,-28],null],
    ['Falkland C.',[[-58,-50],[-56,-43],[-54,-37]],[-50,-45],null]
  ];
  const UPWELL = [
    ['California',[[-126,42],[-119,42],[-118,31],[-125,31]]],
    ['Peru–Chile',[[-82,-4],[-77,-4],[-73,-38],[-80,-38]]],
    ['NW Africa',[[-19,30],[-12,30],[-16,12],[-21,12]]],
    ['Benguela',[[9,-13],[16,-13],[18,-33],[11,-33]]],
    ['Equatorial',[[-150,3],[-90,3],[-90,-3],[-150,-3]]]
  ];
  const BASINS = [
    ['NORTH PACIFIC',[-160,28],18],['SOUTH PACIFIC',[-130,-25],18],
    ['NORTH ATLANTIC',[-40,33],16],['SOUTH ATLANTIC',[-15,-28],16],
    ['INDIAN OCEAN',[78,-22],16],['ARCTIC OCEAN',[0,78],13],['SOUTHERN OCEAN',[60,-66],13]
  ];
  const PLACES = [
    ['N. AMERICA',[-100,42]],['S. AMERICA',[-60,-15]],['AFRICA',[20,5]],
    ['EUROPE',[18,52]],['ASIA',[95,48]],['AUSTRALIA',[134,-25]],
    ['ANTARCTICA',[40,-82]],['GREENLAND',[-42,72]]
  ];
  const HIGHS = [['Azores H',-28,33],['Hawaiian H',-140,32],['S. Pacific H',-95,-30],['S. Atlantic H',-8,-28],['Mascarene H',80,-30]];
  const LOWS  = [['Aleutian L',-175,52],['Icelandic L',-24,62]];
  // Monthly lat offsets for H/L seasonal migration (index 0=Jan..11=Dec)
  // Subtropical highs shift ~5° N in NH summer, NH lows strengthen/shift in winter
  const HL_MONTHLY_DLAT = [-4,-3,0,2,4,5,5,4,2,0,-3,-4]; // NH shift: + poleward in summer
  const LONS  = [-160,-120,-80,-40,0,40,80,120,160];
  const REFLINES = [
    [0,'EQUATOR','#7fd0ff'],[23.44,'Tropic of Cancer','rgba(150,200,235,0.5)'],
    [-23.44,'Tropic of Capricorn','rgba(150,200,235,0.5)'],
    [66.56,'Arctic Circle','rgba(150,200,235,0.4)'],[-66.56,'Antarctic Circle','rgba(150,200,235,0.4)']
  ];

  /* ============================================================ BUILDERS */
  function marker(color, sc) {
    const id='m-'+color.replace(/[^a-z0-9]/gi,'')+(sc||1).toString().replace('.','');
    A.arrowMarker(svg,id,color,sc||1); return id;
  }
  function addLine(layer, coords, o, opts) {
    o=o||{}; opts=opts||{};
    const fp=o.flowPeriod||28;
    const arrowId=marker(o.color,(o.arrowScale||1)*1.1);
    const node=A.el('path',{fill:'none',stroke:o.color,'stroke-width':o.width||2.6,
      'stroke-linecap':'round','stroke-linejoin':'round'},gMain);
    if(o.flow){
      node.setAttribute('stroke-dasharray',(fp*0.5)+' '+(fp*0.5));
      node.setAttribute('marker-end','url(#'+arrowId+')');
    } else if(o.dash) node.setAttribute('stroke-dasharray',o.dash);
    if(!o.flow && o.arrow!==false) node.setAttribute('marker-end','url(#'+arrowId+')');
    if(o.glow!==false){node.style.filter=`drop-shadow(0 0 ${o.glowR||4}px ${o.glowColor||o.color})`;node.setAttribute('data-glow','1');}
    if(o.opacity!=null) node.setAttribute('stroke-opacity',o.opacity);
    const item={kind:'path',layer,node};
    if(o.flow){item.flow=true;item.flowPeriod=fp;item.flowSpeed=o.flowSpeed||0.55;}
    if(opts.getGeo){item.getGeo=opts.getGeo;item.geo=opts.getGeo(currentMonth);}
    else item.geo=A.line(A.densify(coords,o.step||2.5));
    items.push(item); return item;
  }
  function addPoly(layer, ring, o, opts) {
    o=o||{}; opts=opts||{};
    const node=A.el('path',{fill:o.fill||'none',stroke:o.stroke||'none','stroke-width':o.sw||1.2,
      'fill-opacity':o.fillOp!=null?o.fillOp:0.5,'stroke-opacity':o.strokeOp!=null?o.strokeOp:0.85},gMain);
    if(o.glow){node.style.filter=`drop-shadow(0 0 8px ${o.glow})`;node.setAttribute('data-glow','1');}
    const item={kind:'path',layer,node};
    if(opts.getGeo){item.getGeo=opts.getGeo;item.geo=opts.getGeo(currentMonth);}
    else {
      // Ensure clockwise winding so d3 fills the SMALL interior, not the whole globe.
      // (d3 spherical convention: interior lies to the left of the ring direction;
      // a CCW lon/lat box otherwise fills its complement = the entire sphere.)
      let r=ring.slice();
      let a=0; for(let i=0;i<r.length;i++){const j=(i+1)%r.length;a+=r[i][0]*r[j][1]-r[j][0]*r[i][1];}
      if(a>0) r=r.reverse(); // positive shoelace = CCW → reverse to CW
      item.geo=A.poly([A.densify(r.concat([r[0]]),o.step||2)]);
    }
    items.push(item); return item;
  }
  function addLabel(layer, ll, txt, cls, o) {
    o=o||{};
    const baseSize=o.size||12;
    const node=A.el('text',{class:cls,fill:o.fill||'var(--ink)','text-anchor':o.anchor||'middle',
      'font-size':baseSize,text:txt},gLabels);
    if(o.weight) node.setAttribute('font-weight',o.weight);
    if(o.op!=null) node.setAttribute('opacity',o.op);
    if(o.info){node.setAttribute('data-info',o.info);node.style.cursor='pointer';node.style.pointerEvents='all';}
    const actualLL = o.getLL ? o.getLL(currentMonth) : ll;
    const item={kind:'label',layer,node,ll:actualLL,dx:o.dx||0,dy:o.dy||0,baseSize,baseWeight:o.weight||null};
    if(o.getLL) item.getLL=o.getLL;
    items.push(item); return item;
  }
  function addMark(layer,lon,lat,letter,color,name,infoId) {
    const g=A.el('g',{},gLabels);
    A.el('circle',{r:17,fill:'none',stroke:color,'stroke-width':1.4,'stroke-opacity':0.55},g);
    const t1=A.el('text',{'text-anchor':'middle',y:8,'font-family':'Space Grotesk, sans-serif',
      'font-weight':700,'font-size':23,fill:color,text:letter},g);
    t1.style.filter=`drop-shadow(0 0 5px ${color})`;
    A.el('text',{'text-anchor':'middle',y:30,class:'g-tech','font-size':10.5,fill:color,text:name},g);
    if(infoId){g.setAttribute('data-info',infoId);g.style.cursor='pointer';g.style.pointerEvents='all';}
    items.push({kind:'mark',layer,node:g,ll:[lon,lat]});
  }
  function addDynamic(layer, updateFn) {
    const g=A.el('g',{},gMain);
    items.push({kind:'dynamic',layer,node:g,update:updateFn});
    return g;
  }
  function addDynamicLabel(layer,getLL,txt,cls,o) {
    const ll=getLL(currentMonth);
    return addLabel(layer,ll,txt,cls,Object.assign({},o,{getLL}));
  }
  function ellipseLoop(cx0,cy0,rx,ry,cwise,start) {
    const pts=[],n=30; start=start||0;
    for(let i=0;i<=n;i++){const a=start+(cwise?1:-1)*(i/n)*2*Math.PI;pts.push([cx0+rx*Math.cos(a),cy0+ry*Math.sin(a)]);}
    return pts;
  }
  function ninoRing(lonW,lonE,latS,latN) {
    const ring=[],step=4,norm=l=>(l>180?l-360:(l<-180?l+360:l));
    for(let l=lonW;l<=lonE;l+=step) ring.push([norm(l),latN]);
    for(let t=latN;t>=latS;t-=2) ring.push([norm(lonE),t]);
    for(let l=lonE;l>=lonW;l-=step) ring.push([norm(l),latS]);
    for(let t=latS;t<=latN;t+=2) ring.push([norm(lonW),t]);
    return ring;
  }

  /* ============================================================ POPULATE (basic) */
  function populate() {
    // land
    const land=A.el('path',{fill:'#243d52',stroke:'#5588a8','stroke-width':0.9,'stroke-linejoin':'round'},gMain);
    items.push({kind:'path',layer:'coast',node:land,geo:world.land});
    window._landNode=land;
    // country borders
    if(world.borders){
      const bordersNode=A.el('path',{fill:'none',stroke:'rgba(120,160,190,0.35)','stroke-width':0.5,'stroke-linejoin':'round'},gMain);
      items.push({kind:'path',layer:'countries',node:bordersNode,geo:world.borders});
      window._bordersNode=bordersNode;
    }
    // graticule
    const grat=A.el('path',{fill:'none','stroke-width':0.5},gMain);
    grat.style.stroke='rgba(120,170,205,0.45)';
    items.push({kind:'path',layer:'graticule',node:grat,geo:d3.geoGraticule().step([30,30])()});
    // reference lines
    REFLINES.forEach(([lat,name,col])=>{
      addLine('reflines',[[-180,lat],[-90,lat],[0,lat],[90,lat],[180,lat]],
        {color:col,width:lat===0?1.4:1,arrow:false,glow:false,dash:lat===0?'1 6':'5 5',opacity:0.8,step:4});
      addLabel('reflines',[-150,lat],name,'g-tech',{size:10.5,fill:col,op:0.85,dy:-4,anchor:'start'});
    });
    // basin + continent labels
    BASINS.forEach(([t,ll,sz])=>addLabel('basins',ll,t,'g-basin',{size:sz,op:0.85}));
    PLACES.forEach(([t,ll])=>addLabel('basins',ll,t,'g-basin',{size:11,fill:'rgba(160,180,200,0.55)',op:0.9}));
    // ===== OCEAN CURRENTS — vector-field style: short arrows tracing the exact
    //       path (quiver-plot aesthetic). Spacing measured in true angular
    //       distance (lon compressed by cos(lat)) so density is uniform. =====
    const GF = window.GlobeFeatures;
    // current names only — the colour-coded particle flow IS the current display now
    GF.WARM.forEach(c=>{
      addLabel('warm',c.labelAt,c.name,'g-feat',{size:11.5,fill:'var(--warm-2)',dy:-5,info:c.info||undefined});
    });
    GF.COLD.forEach(c=>{
      addLabel('cold',c.labelAt,c.name,'g-feat',{size:11.5,fill:'var(--cold-2)',dy:-5,info:c.info||undefined});
    });
    // ACC — faint continuous band + vector arrows circling the globe
    const accLat=GF.ACC_LAT;
    addLine('acc',[[-180,accLat],[-120,accLat],[-60,accLat],[0,accLat],[60,accLat],[120,accLat],[180,accLat]],
      {color:C.acc,width:6,opacity:0.13,arrow:false,glow:false,step:3});
    addLabel('acc',[-150,accLat],'ANTARCTIC CIRCUMPOLAR CURRENT','g-tech',{size:10.5,fill:'var(--acc)',info:'acc'});
    // upwelling
    A.hatchPattern(svg,'g-up','#38e0a0',0.12);
    GF.UPWELL.forEach(u=>{
      addPoly('upwell',u.ring,{fill:'url(#g-up)',stroke:'#38e0a0',sw:1.1,strokeOp:0.8});
      const cx0=u.ring.reduce((s,p)=>s+p[0],0)/u.ring.length,cy0=u.ring.reduce((s,p)=>s+p[1],0)/u.ring.length;
      addLabel('upwell',[cx0,cy0],u.name,'g-tech',{size:10,fill:'#7fffce'});
    });
    // Subtropical gyres are now rendered by the particle engine (class 3).
    // SVG outlines removed — particles trace the elliptic paths instead.
    // deep-water formation sites (downwelling)
    GF.DEEPWATER.forEach(d=>{
      addLabel('gyres',d.at,'▼ '+d.name,'g-tech',{size:9,fill:'rgba(127,208,255,0.7)'});
    });
    // trade winds — vector field: pre-built static paths animated via dashoffset
    (function(){
      // wind belts are now rendered by the particle flow engine (classes 3–5);
      // only the labels remain here
      addLabel('trades',[-178,16],'NE TRADES','g-tech',{size:9.5,fill:'rgba(255,170,120,0.75)',anchor:'start'});
      addLabel('trades',[-178,-16],'SE TRADES','g-tech',{size:9.5,fill:'rgba(255,170,120,0.75)',anchor:'start'});
    })();
    (function(){
      addLabel('wester',[-178,46],'WESTERLIES','g-tech',{size:9.5,fill:'rgba(150,160,255,0.8)',anchor:'start'});
      addLabel('wester',[-178,-46],'WESTERLIES','g-tech',{size:9.5,fill:'rgba(150,160,255,0.8)',anchor:'start'});
    })();
    (function(){
      addLabel('polar',[-178,72],'POLAR EASTERLIES','g-tech',{size:9,fill:'rgba(160,210,255,0.7)',anchor:'start'});
    })();
    // ITCZ now handled by seasonal layer in globe-advanced.js (moves with month)
    addLabel('itcz',[-150,6],'ITCZ','g-tech',{size:10,fill:'var(--itcz)',anchor:'start',info:'itcz'});
    // jet streams - subtropical (~28deg, steadier) + polar-front (~50-60deg, big Rossby meanders)
    // Pure synthetic geometry, exactly as the original -- no real-data trace
    // (that produced a jagged/staircase line since a single max-speed pick
    // per 1deg longitude column is noisy over real ERA5 data). Real data
    // drives the particle flow instead (see the independent jets particle
    // engine below); these lines are just a thin, light backdrop.
    const sjN=[],sjS=[],pjN=[],pjS=[];
    for(let l=-180;l<=180;l+=3){
      sjN.push([l,28+2.5*Math.sin(l*Math.PI/90)]);
      sjS.push([l,-28-2.5*Math.sin(l*Math.PI/90)]);
    }
    for(let l=-180;l<=180;l+=2){
      // polar jet: superposition of wavenumber-3 and -5 for realistic troughs/ridges
      pjN.push([l,54+11*Math.sin(l*Math.PI/60)+4*Math.sin(l*Math.PI/36+1)]);
      pjS.push([l,-54-11*Math.sin(l*Math.PI/60+0.5)-4*Math.sin(l*Math.PI/36)]);
    }
    addLine('jets',sjN,{color:C.jsub,width:1.5,arrow:false,glowR:3,opacity:0.55,step:3,flow:true,flowPeriod:50,flowSpeed:0.4});
    addLine('jets',sjS,{color:C.jsub,width:1.5,arrow:false,glowR:3,opacity:0.55,step:3,flow:true,flowPeriod:50,flowSpeed:0.4});
    // Polar jet: two-layer rendering -- wide soft glow + narrower bright core,
    // both scaled down from the original for a lighter, thinner look.
    addLine('jets',pjN,{color:C.jpol,width:4,arrow:false,glowR:0,step:2,flow:false,opacity:0.10});
    addLine('jets',pjS,{color:C.jpol,width:4,arrow:false,glowR:0,step:2,flow:false,opacity:0.10});
    addLine('jets',pjN,{color:C.jpol,width:2,arrow:false,glowR:4,opacity:0.6,step:2,flow:true,flowPeriod:60,flowSpeed:0.5});
    addLine('jets',pjS,{color:C.jpol,width:2,arrow:false,glowR:4,opacity:0.6,step:2,flow:true,flowPeriod:60,flowSpeed:0.5});
    addLabel('jets',[-120,32],'Subtropical jet','g-feat',{size:11.5,fill:'var(--jet-sub)'});
    addLabel('jets',[-60,66],'Polar-front jet · Rossby waves','g-feat',{size:11.5,fill:'#7fa0ff'});
    // Country names
    if(world.countries){
      const NAMES={4:'Afghanistan',8:'Albania',12:'Algeria',24:'Angola',32:'Argentina',36:'Australia',40:'Austria',50:'Bangladesh',56:'Belgium',68:'Bolivia',76:'Brazil',100:'Bulgaria',116:'Cambodia',120:'Cameroon',124:'Canada',144:'Sri Lanka',152:'Chile',156:'China',170:'Colombia',188:'Costa Rica',192:'Cuba',203:'Czechia',208:'Denmark',218:'Ecuador',818:'Egypt',231:'Ethiopia',246:'Finland',250:'France',276:'Germany',288:'Ghana',300:'Greece',320:'Guatemala',332:'Haiti',356:'India',360:'Indonesia',364:'Iran',368:'Iraq',372:'Ireland',376:'Israel',380:'Italy',388:'Jamaica',392:'Japan',400:'Jordan',398:'Kazakhstan',404:'Kenya',408:'North Korea',410:'South Korea',414:'Kuwait',418:'Laos',422:'Lebanon',434:'Libya',484:'Mexico',504:'Morocco',508:'Mozambique',524:'Nepal',528:'Netherlands',554:'New Zealand',566:'Nigeria',578:'Norway',586:'Pakistan',591:'Panama',604:'Peru',608:'Philippines',616:'Poland',620:'Portugal',642:'Romania',643:'Russia',682:'Saudi Arabia',686:'Senegal',706:'Somalia',710:'South Africa',724:'Spain',729:'Sudan',752:'Sweden',756:'Switzerland',760:'Syria',764:'Thailand',788:'Tunisia',792:'Turkey',800:'Uganda',804:'Ukraine',784:'UAE',826:'United Kingdom',840:'United States',858:'Uruguay',860:'Uzbekistan',704:'Vietnam',887:'Yemen',894:'Zambia',716:'Zimbabwe'};
      // Added LARGEST-FIRST: item order is the collision-culling priority
      // in redraw() — when two country names would overlap on screen, the
      // one added earlier wins, so sorting by spherical area keeps Russia/
      // Brazil/Algeria visible and drops microstates first at far zoom.
      world.countries.features
        .filter(f=>NAMES[+f.id])
        .map(f=>{ let a=0; try{a=d3.geoArea(f);}catch(e){} return [a,f]; })
        .sort((x,y)=>y[0]-x[0])
        .forEach(([_,f])=>{
          const name=NAMES[+f.id];
          try{const centroid=d3.geoCentroid(f);if(!centroid||isNaN(centroid[0]))return;
            addLabel('country-names',centroid,name,'g-tech',{size:9.5,fill:'rgba(190,205,220,0.65)'});}
          catch(e){}
        });
      items.filter(it=>it.layer==='country-names').forEach(it=>{it._baseOp='0.65';});
    }
    // Pressure systems — migrate seasonally with month
    // NH highs shift poleward in summer; Aleutian/Icelandic lows intensify in winter.
    // SH highs shift poleward in SH summer (Jan) — opposite sign.
    (function(){
      let _pressureMonth = -1;
      const pressureG = addDynamic('pressure', function(month, p) {
        const center = [-projection.rotate()[0], -projection.rotate()[1]];
        if (month === _pressureMonth) {
          [...pressureG.querySelectorAll('g[data-info]')].forEach(g2 => {
            const ll = g2._ll; if (!ll) return;
            if (d3.geoDistance(ll, center) >= 1.40) { g2.style.display = 'none'; return; }
            const cp = projection(ll);
            if (cp) { g2.style.display = ''; g2.setAttribute('transform', `translate(${cp[0]},${cp[1]})`); }
            else g2.style.display = 'none';
          });
          return;
        }
        _pressureMonth = month;
        while(pressureG.firstChild) pressureG.removeChild(pressureG.firstChild);
        const dlat = HL_MONTHLY_DLAT[month];
        const systems = [
          ['Azores H',  -28, 33+dlat,          'H','var(--warm)','pressure-high'],
          ['Hawaiian H',-140,32+dlat,           'H','var(--warm)','pressure-high'],
          ['S. Pacific H',-95,-30-dlat*0.7,    'H','var(--warm)','pressure-high'],
          ['S. Atlantic H',-8,-28-dlat*0.7,    'H','var(--warm)','pressure-high'],
          ['Mascarene H', 80,-30-dlat*0.7,     'H','var(--warm)','pressure-high'],
          ['Aleutian L',-175,52+dlat*0.4,      'L','var(--cold)','pressure-low'],
          ['Icelandic L', -24,62+dlat*0.3,     'L','var(--cold)','pressure-low'],
        ];
        systems.forEach(([name,lon,lat,letter,color,infoId])=>{
          const ll = [lon, lat];
          if (d3.geoDistance(ll, center) >= 1.40) return;
          const cp = projection(ll); if(!cp) return;
          const g=A.el('g',{transform:`translate(${cp[0]},${cp[1]})`,
            'data-info':infoId,style:'cursor:pointer;pointer-events:all'},pressureG);
          g._ll = ll;
          A.el('circle',{r:17,fill:'none',stroke:color,'stroke-width':1.4,'stroke-opacity':0.55},g);
          const t1=A.el('text',{'text-anchor':'middle',y:8,'font-family':'Space Grotesk, sans-serif',
            'font-weight':700,'font-size':23,fill:color,text:letter},g);
          t1.style.filter=`drop-shadow(0 0 5px ${color})`;
          A.el('text',{'text-anchor':'middle',y:30,class:'g-tech','font-size':10.5,fill:color,text:name},g);
        });
      });
    })();
    // warm pool
    A.linearGrad(svg,'g-pool',[[0,'#ff8a3c'],[1,'#ff4d4d']],0,0,1,1);
    addPoly('pool',[[110,11],[126,13],[144,12],[158,8],[164,1],[160,-6],[148,-11],[130,-12],[116,-9],[108,-1]],
      {fill:'url(#g-pool)',fillOp:0.55,stroke:'#ff7a4d',sw:1.4,glow:'rgba(255,90,70,0.5)'});
    addLabel('pool',[136,1],'W. PACIFIC WARM POOL','g-basin',{size:12,fill:'#ffd0b0',info:'warm-pool'});
    // Niño regions
    [[160,210,-5,5,'#5ad1ff','Niño 4'],[190,240,-5,5,'#ffd24a','Niño 3.4'],[210,270,-5,5,'#9b8cff','Niño 3'],[270,280,-10,0,'#ff8fb0','Niño 1+2']]
      .forEach(([w,e,s,n,col,name],i)=>{
        addPoly('nino',ninoRing(w,e,s,n),{fill:col,fillOp:i===1?0.05:0.09,stroke:col,sw:i===1?2:1.5,strokeOp:0.95,step:4});
        const cl=(w+e)/2,cln=cl>180?cl-360:cl;
        addLabel('nino',[cln,(s+n)/2+(i===1?6:0)],name,'g-feat',{size:12,fill:col,weight:600});
      });
  }

  let lastDynamicMonth = -1;
  function redraw() {
    projection.rotate(rotate).scale(scale).translate([cx,cy]);
    // Canvas is managed by the particle frame() loop — it detects rotation and clears
    const center=[-rotate[0],-rotate[1]];
    haloNode.setAttribute('cx',cx); haloNode.setAttribute('cy',cy); haloNode.setAttribute('r',scale*1.16);
    sphereClipCircle.setAttribute('cx',cx); sphereClipCircle.setAttribute('cy',cy); sphereClipCircle.setAttribute('r',scale+2);
    syncGlobeClip();
    sphereNode.setAttribute('d',path({type:'Sphere'}));
    // seasonal terminator
    nightNode.setAttribute('cx',cx); nightNode.setAttribute('cy',cy); nightNode.setAttribute('r',scale+1);
    nightNode.style.display=night?'':'none';
    const decl=23.44*Math.sin(2*Math.PI*(currentMonth-2.75)/12);
    nightGrad.setAttribute('cx',cx-scale*0.4); nightGrad.setAttribute('cy',cy+scale*(decl/90)*1.5);
    nightGrad.setAttribute('r',scale*1.7); nightGrad.setAttribute('fx',cx-scale*0.4); nightGrad.setAttribute('fy',cy+scale*(decl/90)*1.5);

    if(!dragging) applyFlowAnim();
    // Hide non-geography labels during drag; keep country names when data overlay is on
    gLabels.style.display=(dragging&&!window._ncDataActive)?'none':'';
    const monthChanged=currentMonth!==lastDynamicMonth;
    if(monthChanged) lastDynamicMonth=currentMonth;
    // ── Zoom level-of-detail: as you zoom in, country borders, then names,
    //    appear automatically (even if their layer toggles are off), and the
    //    graticule refines from 30° to 10°. Zoomed out, nothing changes.
    const zLod=scale/baseScale;
    // Every label's font-size below is an ABSOLUTE px value (baseSize +
    // boost), tuned by eye against a "normal" desktop-size globe. zLod
    // alone doesn't fix this: it's scale/baseScale, a ZOOM ratio that
    // sits at ~1 on load on ANY device, phone or desktop, since scale
    // starts out equal to baseScale — it carries no information about
    // how large the globe's disc actually is in CSS px. On a narrow
    // phone baseScale (the globe's own on-screen radius, see resize())
    // can be a third of its desktop value while labels stayed exactly
    // the same absolute size, so the SAME text visibly dwarfs a small
    // globe (worst on the big all-caps ocean/continent names — see
    // reported screenshot). REF_BASE_SCALE is a representative desktop
    // baseScale; labels shrink below that but never grow past their
    // tuned size, and never shrink past a legibility floor.
    const REF_BASE_SCALE=400, MIN_LABEL_VP_SCALE=0.6;
    const labelVpScale=Math.max(MIN_LABEL_VP_SCALE,Math.min(1,baseScale/REF_BASE_SCALE));
    _syncUserGeoLabels(zLod, center);
    // Finer-than-country detail at zoom: swap the 110m country borders for the
    // 50m mesh (lazily parsed from the embedded countries-50m TopoJSON).
    if(zLod>1.45 && !window._b50 && !window._b50Loading){
      window._b50Loading=true;
      fetch('countries-50m').then(r=>r.json()).then(t=>{
        window._b50=topojson.mesh(t,t.objects.countries,(a,b)=>a!==b);
        redraw();
      }).catch(()=>{window._b50Loading=false;});
    }
    const bIt=items.find(x=>x.layer==='countries');
    if(bIt){
      if(!bIt._geo110) bIt._geo110=bIt.geo;
      const want=(zLod>1.45&&window._b50)?window._b50:bIt._geo110;
      if(bIt.geo!==want) bIt.geo=want;
    }
    const coastIt=items.find(x=>x.layer==='coast');
    const gcfg=window._geoAppearCfg||{autoBoost:true,coastW:0.35,coastBright:0.55,countryW:0.25,countryBright:0.4,ctrW:0.3,ctrBright:0.35,nameBright:0.5,nameSize:9.5};
    // Boost applies whenever the toggle is on — no longer hidden behind an
    // active-overlay check, so the sliders always give immediate feedback.
    const boost=gcfg.autoBoost?1:0;
    if(coastIt){
      const w=0.9+boost*gcfg.coastW*(window._ncContoursOn?1.15:1);
      const br=boost*gcfg.coastBright;
      coastIt.node.setAttribute('stroke',boost?`rgba(${Math.round(85+130*br)},${Math.round(136+99*br)},${Math.round(168+87*br)},${0.75+0.25*br})`:'#5588a8');
      coastIt.node.setAttribute('stroke-width',String(w));
      if(boost){coastIt.node.setAttribute('stroke-linejoin','round');coastIt.node.setAttribute('paint-order','stroke fill');}
      else{coastIt.node.removeAttribute('stroke-linejoin');coastIt.node.removeAttribute('paint-order');}
    }
    if(bIt){
      const w=0.5+boost*gcfg.countryW;
      const br=boost*gcfg.countryBright;
      bIt.node.setAttribute('stroke',boost?`rgba(${Math.round(120+75*br)},${Math.round(160+58*br)},${Math.round(190+55*br)},${0.35+0.55*br})`:'rgba(120,160,190,0.35)');
      bIt.node.setAttribute('stroke-width',String(w));
      bIt.node.removeAttribute('stroke-dasharray');
      if(boost) bIt.node.setAttribute('stroke-linejoin','round');
      else bIt.node.removeAttribute('stroke-linejoin');
    }
    const gratIt=items.find(x=>x.layer==='graticule');
    if(gratIt){
      const fine=zLod>2.1;
      if(fine!==!!gratIt._fine){gratIt._fine=fine;gratIt.geo=d3.geoGraticule().step(fine?[10,10]:[30,30])();}
    }
    // Screen rects of country-name labels placed THIS redraw — later
    // (smaller-country, see largest-first insertion order) labels that
    // would overlap an already-placed one are hidden for this frame.
    const _placedLbl=[];
    for(const it of items){
      let on=it.layer==='coast'?true:state[it.layer];
      if(it.layer==='jets'&&state['s-jets']) on=false;
      if(!on){
        if(it.layer==='countries'&&zLod>1.45) on=true;
        else if(it.layer==='country-names'&&zLod>1.85) on=true;
        else if(it.layer==='user-geo'){
          if(!state['user-geo']) on=zLod>1.55;
        }
      }
      if(it.layer==='user-geo'&&it.kind==='label'&&on&&!state['user-geo']&&it._minZLod!=null&&zLod<it._minZLod) on=false;
      if(!on){if(it.node.style.display!=='none')it.node.style.display='none';continue;}
      if(it.kind==='path'){
        if(it._userGeoPath){
          // Loaded boundary files can be huge (a 50 m admin-1 file is
          // ~1M coordinates); path(wholeCollection) re-projected every
          // single coordinate on every redraw, including each drag frame
          // — the "app slows down with provinces loaded" report. Render
          // from the pre-simplified per-feature metadata built in
          // applyUserGeoLayer instead: skip features entirely on the far
          // hemisphere (bounding-circle test), use the coarser LOD while
          // dragging (imperceptible in motion), and cache the assembled
          // path string so month-slider/label redraws don't re-project
          // anything when the projection hasn't moved. The ORIGINAL
          // geometry stays untouched on ug.geo for region extraction.
          const ug=window._userGeoLayer;
          const meta=ug&&ug._featMeta;
          if(meta){
            const dKey=rotate[0]+','+rotate[1]+','+(rotate[2]||0)+','+scale+','+(dragging?1:0);
            if(it._dKey!==dKey){
              let dStr='';
              const HALF=Math.PI/2;
              for(let mi=0;mi<meta.length;mi++){
                const m=meta[mi];
                if(d3.geoDistance(m.c,center)-m.r>HALF) continue;
                const seg=path(dragging?m.lo:m.hi);
                if(seg) dStr+=seg;
              }
              it._dKey=dKey; it._d=dStr;
            }
            if(!it._d||it._d.length<5){it.node.setAttribute('d','');it.node.style.display='none';}
            else{it.node.style.display='';it.node.setAttribute('d',it._d);}
            continue;
          }
        }
        if(it.getGeo) it.geo=it.getGeo(currentMonth);
        const d=path(it.geo);
        if(!d||d.length<5){it.node.setAttribute('d','');it.node.style.display='none';}
        else{it.node.style.display='';it.node.setAttribute('d',d);}
      } else if(it.kind==='dynamic'){
        it.node.style.display='';
        it.update(currentMonth,path);
      } else {
        // Labels/marks used to be skipped while dragging (an old perf
        // guard) — but their nodes stayed visible at STALE positions and
        // then snapped to place on release. Reprojecting them is cheap
        // (~200 items × one projection each), so track the drag live.
        if(it.getLL) it.ll=it.getLL(currentMonth);
        const vis=d3.geoDistance(it.ll,center)<1.40;
        if(!vis){it.node.style.display='none';continue;}
        const p=projection(it.ll);
        if(!p){it.node.style.display='none';continue;}
        it.node.style.display='';
        if(it.kind==='label'){
          // Label size boost applies uniformly to every label on the globe
          // (not just country names), scaled from each label's own base
          // size. Font weight is left untouched at all times — no bold
          // "jump" when boost toggles — only size and (for country names)
          // colour brightness change.
          const sizeDelta=boost*(gcfg.nameSize-9.5);
          let fs=(it.baseSize||12)+sizeDelta;
          if(it.layer==='basins'){
            const lodScale=Math.max(0.48,Math.min(1.08,0.42+zLod*0.38));
            fs=(it.baseSize||12)*lodScale+sizeDelta;
          }
          fs*=labelVpScale;
          it.node.setAttribute('font-size',String(fs));
          if(it.layer==='country-names'){
            const br=boost*gcfg.nameBright;
            it.node.setAttribute('fill',boost?`rgba(${Math.round(190+65*br)},${Math.round(205+50*br)},${Math.round(220+35*br)},${0.65+0.35*br})`:'rgba(190,205,220,0.65)');
          }
          // Collision culling: ALL text labels (current names, jets,
          // straits, wind zones, basins, country names, …) compete for
          // screen space, not just country names — the current-name
          // labels ("Norwegian C.", "N. Atlantic Drift", …) overlapping
          // each other and earthquake feed markers was the same class of
          // bug, just on a layer the culling didn't reach yet. First-
          // placed (items-array order) wins any overlap; width estimate
          // 0.58·fs per character tracks IBM Plex Mono's advance closely
          // enough that a getBBox() call (layout flush per label per
          // frame) isn't worth it. Small padding keeps neighbours from
          // touching.
          const lw2=(it.node.textContent.length*fs*0.58)+6, lh2=fs*1.15+4;
          const lx0=p[0]+it.dx-lw2/2, ly0=p[1]+it.dy-lh2*0.75;
          let _clash=false;
          for(let ri=0;ri<_placedLbl.length;ri++){
            const r=_placedLbl[ri];
            if(lx0<r.x1&&lx0+lw2>r.x0&&ly0<r.y1&&ly0+lh2>r.y0){_clash=true;break;}
          }
          if(_clash){it.node.style.display='none';continue;}
          _placedLbl.push({x0:lx0,x1:lx0+lw2,y0:ly0,y1:ly0+lh2});
          it.node.setAttribute('x',p[0]+it.dx);it.node.setAttribute('y',p[1]+it.dy);
        }
        else it.node.setAttribute('transform',`translate(${p[0]},${p[1]})`);
      }
    }
    // NC overlays: render AFTER SVG paths/labels update so data aligns with coastlines.
    if(window.GlobeAPI?.onRedraw){
      window.GlobeAPI.onRedraw();
    }
  }
  function resize(){
    const v=globeViewport();
    const w=v.w, h=v.h;
    svg.setAttribute('width',w); svg.setAttribute('height',h);
    cx=w/2; cy=h/2;
    baseScale=Math.max(50,Math.min(w,h)/2-46);
    scale=Math.max(Math.min(scale,baseScale*MAX_ZOOM),baseScale);
    if(scale===300) scale=baseScale;
    redraw();
    if(window._flowRotated) window._flowRotated();
  }
  function setMonth(m){
    currentMonth=m;
    const sl=document.getElementById('month-slider'); if(sl) sl.value=m;
    const lb=document.getElementById('month-label');
    if(lb) lb.textContent=['January','February','March','April','May','June','July','August','September','October','November','December'][m];
    document.querySelectorAll('.mtick').forEach((t,i)=>t.classList.toggle('cur',i===m));
    if(window.GlobeTimeline&&window.GlobeTimeline.month!==m) window.GlobeTimeline.setByMonth(m);
    redraw();
  }
  function showInfoPanel(id){
    const info=infoData[id]; if(!info) return;
    document.getElementById('info-title').textContent=info.name||id;
    document.getElementById('info-body').innerHTML=info.html||'';
    const panel=document.getElementById('info-panel');
    panel.style.display='';
    requestAnimationFrame(()=>panel.classList.add('visible'));
  }

  /* ============================================================ INTERACTION */
  function clampLat(v){return Math.max(-90,Math.min(90,v));}
  d3svg.call(d3.drag()
    .on('start',()=>{dragging=true;svg.classList.add('dragging');fadeHint();})
    .on('drag',(e)=>{const k=78/scale;rotate=[rotate[0]+e.dx*k,clampLat(rotate[1]-e.dy*k),rotate[2]];redraw();})
    .on('end',()=>{
      dragging=false;svg.classList.remove('dragging');
      if(window._flowRotated)window._flowRotated();
      gLabels.style.display='';
      clearTimeout(ncDeferTimer);
      ncDeferTimer=setTimeout(()=>{if(window.GlobeAPI?.onRedraw)window.GlobeAPI.onRedraw();redraw();},60);
    })
  );
  /* ---- pinch-to-zoom (two-finger touch) ----
     d3.drag() above only ever tracks rotation from a single pointer, so on
     touch devices a second finger did nothing — no gesture zoom, only the
     ± buttons and (desktop-only) wheel. Handled as native Touch events on
     `document` in the CAPTURE phase, which — unlike listeners on svg
     itself — fires before d3.drag's own bubble-phase touchstart/touchmove,
     letting stopPropagation() here actually keep d3 from also treating
     the same two fingers as a rotate-drag. Gated to touches that start on
     the globe so a pinch inside a plot window or the side panel is left
     alone. */
  (function(){
    let pinchDist=null, pinchScale0=null;
    const dist=(a,b)=>Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
    document.addEventListener('touchstart',(e)=>{
      if(e.touches.length!==2) return;
      if(!svg.contains(e.touches[0].target)&&!svg.contains(e.touches[1].target)) return;
      e.preventDefault(); e.stopPropagation();
      dragging=false; svg.classList.remove('dragging');
      pinchDist=dist(e.touches[0],e.touches[1]);
      pinchScale0=scale;
    },{passive:false,capture:true});
    document.addEventListener('touchmove',(e)=>{
      if(pinchDist==null||e.touches.length!==2) return;
      e.preventDefault(); e.stopPropagation();
      const d=dist(e.touches[0],e.touches[1]);
      scale=Math.max(baseScale*0.85,Math.min(baseScale*MAX_ZOOM,pinchScale0*(d/pinchDist)));
      redraw();
    },{passive:false,capture:true});
    const endPinch=(e)=>{
      if(pinchDist==null) return;
      if(e.touches.length<2){
        pinchDist=null; pinchScale0=null;
        clearTimeout(ncDeferTimer);
        ncDeferTimer=setTimeout(()=>{if(window.GlobeAPI?.onRedraw)window.GlobeAPI.onRedraw();redraw();},60);
      }
    };
    document.addEventListener('touchend',endPinch,{capture:true});
    document.addEventListener('touchcancel',endPinch,{capture:true});
  })();
  /* ════════════════════════════════════════════════════════════════
     PARTICLE FLOW FIELD — earth.nullschool.net-style animated currents.
     A synthetic velocity field is built ONCE from the curated current
     paths (unit direction × gaussian falloff, σ≈2.5°), the ACC ring and
     gyre tangents; ~3000 particles advect through it with fading trails.
     Honest note: directions are accurate along charted currents, but the
     field is synthesized from those paths — not measured u/v velocities.
     ════════════════════════════════════════════════════════════════ */
  function initFlowField(){
    const GF=window.GlobeFeatures; if(!GF) return;
    const D2=Math.PI/180;
    // ---- velocity grid: 1.5° → 240×120, [u,v] in deg-equivalents ----
    const GW=240,GH=120,CELL=1.5;
    const U=new Float32Array(GW*GH), V=new Float32Array(GW*GH), Wt=new Float32Array(GW*GH);
    // classes: 0 warm · 1 cold · 2 ACC · 3 gyres · 4 trades · 5 westerlies · 6 polar easterlies · 7 jets
    const NCLS=8;
    const CWt=[];for(let c=0;c<NCLS;c++)CWt.push(new Float32Array(GW*GH));
    const gi=(lon,lat)=>{
      let x=Math.floor((lon+180)/CELL), y=Math.floor((lat+90)/CELL);
      x=((x%GW)+GW)%GW; y=Math.max(0,Math.min(GH-1,y));
      return y*GW+x;
    };
    function stamp(lon,lat,ux,uy,w,cls){
      const R=3, sig2=2*2.0*2.0;  // tighter kernel — stampPath handles cross-track spread
      for(let dy=-R;dy<=R;dy+=1)for(let dx=-R;dx<=R;dx+=1){
        const la=lat+dy*CELL; if(la<-89||la>89)continue;
        const lo=lon+dx*CELL/Math.max(0.25,Math.cos(la*D2));
        const d2=(dx*CELL)*(dx*CELL)+(dy*CELL)*(dy*CELL);
        const w2=w*Math.exp(-d2/sig2);
        const k=gi(lo,la);
        U[k]+=ux*w2; V[k]+=uy*w2; Wt[k]+=w2; CWt[cls][k]+=w2;
      }
    }
    function stampPath(pts,speed,cls,halfWidthDeg){
      // halfWidthDeg: Gaussian e-folding width; default 2° for narrow jets, 4° for broad currents
      const hw=halfWidthDeg||(speed>1.0?1.5:speed>0.5?2.5:3.5);
      const sig2=2*hw*hw;
      for(let i=0;i<pts.length-1;i++){
        const a=pts[i],b=pts[i+1];
        const cm=Math.max(0.25,Math.cos((a[1]+b[1])/2*D2));
        let ux=(b[0]-a[0])*cm, uy=b[1]-a[1];
        const m=Math.hypot(ux,uy)||1; ux/=m; uy/=m;
        // Along-track normal for cross-track Gaussian profile
        const nx=-uy, ny=ux*cm;  // normal in lon/lat space
        const n=Math.max(2,Math.ceil(m/0.6));
        for(let t=0;t<n;t++){
          const lon=a[0]+(b[0]-a[0])*t/n, lat=a[1]+(b[1]-a[1])*t/n;
          // Stamp along multiple cross-track offsets with Gaussian falloff
          const nOffsets=Math.max(3,Math.ceil(hw*2));
          for(let oi=-nOffsets;oi<=nOffsets;oi++){
            const offDeg=oi*(hw/nOffsets);
            const offW=Math.exp(-(offDeg*offDeg)/sig2);
            const sLon=lon+nx*offDeg/cm, sLat=lat+ny*offDeg;
            // Speed also falls off: fast core, slow edges
            const coreSpeed=speed*offW;
            stamp(sLon,sLat,ux*coreSpeed,uy*coreSpeed,offW,cls||0);
          }
        }
      }
    }
    // Realistic speeds per current (m/s equivalents, normalised to grid units)
    // Gulf Stream: ~2 m/s, Kuroshio: ~1.5, ACC: ~0.3, Gyres: ~0.05
    const WARM_SPD = {
      'Gulf Stream':2.0,'Kuroshio':1.8,'Agulhas C.':1.5,'Brazil C.':0.9,
      'Mozambique C.':0.7,'Loop Current':1.2,'N. Atlantic Drift':0.6,
      'Norwegian C.':0.5,'E. Greenland C.':0.5,'W. Australian C.':0.5,
      'Somali C. (JJAS)':1.2,'Leeuwin C.':0.4
    };
    const COLD_SPD = {
      'Humboldt C.':0.8,'Benguela C.':0.7,'Canary C.':0.5,
      'Labrador C.':0.8,'California C.':0.5,'Oyashio':0.8,
      'Falkland C.':0.7,'W. Greenland C.':0.5,'E. Iceland C.':0.4,
      'Guinea C.':0.4
    };
    (GF.WARM||[]).forEach(c=>{
      const spd=WARM_SPD[c.name]||(c.thin?0.4:0.8);
      stampPath(c.path,spd,0);
    });
    (GF.COLD||[]).forEach(c=>{
      const spd=COLD_SPD[c.name]||(c.thin?0.4:0.6);
      stampPath(c.path,spd,1);
    });
    { const acc=[]; for(let lo=-180;lo<=180;lo+=3)acc.push([lo,GF.ACC_LAT]); stampPath(acc,0.5,2,3); }
    // ---- Equatorial current system (analytically defined zonal bands) ----
    // Based on Lumpkin & Johnson (2013) drifter climatology mean values
    // Currents stamp across all longitudes in their lat bands (ocean cells only)
    // [latCentre, latHalfWidth, uSpeed, vSpeed, class, label]
    const EQ_CURRENTS=[
      [21.5, 4.0, -0.25, 0.0, 1, 'NEC'],   // North Equatorial Current  18-25°N westward
      [ 8.0, 3.5,  0.38, 0.0, 0, 'NECC'],  // N. Equatorial Counter Current 5-12°N eastward
      [ 1.5, 3.5, -0.45, 0.0, 1, 'nSEC'],  // North SEC  0-4°N westward (stronger)
      [-5.0, 3.5, -0.35, 0.0, 1, 'sSEC'],  // South SEC  3-8°S westward
      [-15, 4.5, -0.18, 0.0, 1, 'SSEC'],   // S. Sub-Equatorial 10-20°S
    ];
    (function(){
      const LON_STEP=3;
      EQ_CURRENTS.forEach(([latC,hw,us,vs,cls])=>{
        for(let lo=-180;lo<=180;lo+=LON_STEP){
          // Gaussian in latitude around band centre
          const latHits=8;
          for(let di=-latHits;di<=latHits;di++){
            const la=latC+di*(hw/latHits);
            const dLat=la-latC, offW=Math.exp(-(dLat*dLat)/(2*hw*hw));
            const coreU=us*offW, coreV=vs*offW;
            if(Math.abs(coreU)<0.02) continue;
            stamp(lo,la,coreU,coreV,offW*0.6,cls);
          }
        }
      });
    })();
    (GF.GYRES||[]).forEach(g=>{
      const pts=[]; const n=120;
      for(let i=0;i<=n;i++){
        const th=(g.cw?-1:1)*2*Math.PI*i/n;
        pts.push([g.cx+g.rx*Math.cos(th), g.cy+g.ry*Math.sin(th)*(g.cw?-1:1)]);
      }
      stampPath(pts,0.12,3,2.5);
      g._ringPts=pts.slice();  // store for spawn list (built later after spawnByClass is declared)
    });
    // ---- wind belts (separate field: WU/WV) — zonal climatological flow ----
    const WU=new Float32Array(GW*GH), WV=new Float32Array(GW*GH);
    const WCls=new Int8Array(GW*GH); WCls.fill(-1);
    // Channel 3 ("custom") — jets only today. A genuine 3rd velocity field,
    // completely separate from U/V (ocean) and WU/WV (wind), so activating
    // jets can never reclassify or overwrite a single ocean/wind cell.
    const JU=new Float32Array(GW*GH), JV=new Float32Array(GW*GH);
    for(let y=0;y<GH;y++){
      const la=-90+(y+0.5)*CELL, ab=Math.abs(la), s=la>0?1:-1;
      let wu=0,wv=0,wc=-1;
      if(ab>=4&&ab<=28){ wu=-0.9; wv=-s*0.22; wc=4; }           // trades: E→W, equatorward
      else if(ab>=32&&ab<=58){ wu=1.0; wv=s*0.10; wc=5; }       // westerlies: W→E
      else if(ab>=62&&ab<=82){ wu=-0.65; wv=0; wc=6; }          // polar easterlies
      if(wc<0)continue;
      for(let x=0;x<GW;x++){ const k=y*GW+x; WU[k]=wu; WV[k]=wv; WCls[k]=wc; }
    }
    for(let k=0;k<GW*GH;k++){ if(Wt[k]>0){U[k]/=Wt[k];V[k]/=Wt[k];} }
    // ── Compare-mode field storage ───────────────────────────────
    // When a custom field is displayed "simultaneously" with the embedded
    // baseline (side-by-side compare), the embedded field stays live in
    // U/V (ocean) / WU/WV (wind) and the custom field lives here, in a
    // parallel channel. Half the layer's particle pool is advected through
    // this channel and drawn with the custom colormap, so both fields flow
    // at once. GPU-resident particles only carry two hardwired channels
    // (ocean/wind), so compare mode runs on the CPU path (see frame()).
    const Uc =new Float32Array(GW*GH), Vc =new Float32Array(GW*GH);
    const WUc=new Float32Array(GW*GH), WVc=new Float32Array(GW*GH);
    // Per-target compare toggle and custom-field colormap override.
    window._compareActive     ={ocean:false,wind:false};   // show embedded+custom together
    window._customFieldTheme  ={ocean:null,  wind:null};    // colormap key for the custom field
    window._customFieldLabel  ={ocean:'',    wind:''};      // user-editable display name
    // dominant ocean class per cell, and per-class spawn lists (incl. wind belts)
    const CLS=new Int8Array(GW*GH);
    const spawnByClass=[[],[],[],[],[],[],[],[]];
    for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
      const k=y*GW+x;
      let c=0,cMax=CWt[0][k];
      if(CWt[1][k]>cMax){c=1;cMax=CWt[1][k];}
      if(CWt[2][k]>cMax){c=2;cMax=CWt[2][k];}
      if(CWt[3][k]>cMax){c=3;cMax=CWt[3][k];}
      CLS[k]=c;
      if(Math.hypot(U[k],V[k])>0) spawnByClass[c].push([-180+(x+0.5)*CELL,-90+(y+0.5)*CELL]);
      if(WCls[k]>=0) spawnByClass[WCls[k]].push([-180+(x+0.5)*CELL,-90+(y+0.5)*CELL]);
    }
    // A custom field's own on/off toggle (in the Earth Systems panel) is now
    // sufficient by itself to make it render — like any other overlay's
    // visibility toggle — instead of also requiring the separate lat-band
    // class checkboxes (Trade winds/Westerlies/Polar easterlies for wind;
    // Warm/Cold/ACC/Gyres for ocean) to be enabled first. Those checkboxes
    // still work as filters for the embedded data, but an active custom
    // field bypasses them entirely so "load a field → see it" always holds.
    const clsEnabled=()=>{
      const cfa=window._customFieldActive||{}, cmp=window._compareActive||{};
      // A layer renders if its custom field is active (swap) OR it's being
      // compared against the embedded baseline (both fields shown together).
      const oceanOn=!!cfa.ocean||!!cmp.ocean, windOn=!!cfa.wind||!!cmp.wind;
      return [
        !!state.warm||oceanOn, !!state.cold||oceanOn, !!state.acc||oceanOn, !!state.gyres||oceanOn,
        !!state.trades||windOn, !!state.wester||windOn, !!state.polar||windOn, !!state.jets
      ];
    };
    // ---- land mask: pre-computed bitfield (GW×GH bits, 3600 bytes, generated from land-110m.json) ----
    // Eliminates 28,800 geoContains calls — instant startup, same accuracy.
    const LAND=new Uint8Array(GW*GH);
    (function(){
      const b64='/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wMA/v//////////////////////////////////AAD8//////////////////////////////////8AAAD+////////P4Dx/////////////////////w8AAADA//////8/gPAD4P///////////////////wcAABj///////8PAIAH/////////////////////38AAEDz//////8/AAAA8P///////////////////x8AAADA////////BwAAAPz//////////////////x8AAAAAAAAe4P//fwAAAMD//////////////////38AAAAAAAAAABAAeAAAAID///////////////////8DAAAAAAAAAACAewAAAADI/v////8///////////8BAAAAAAAAAAAAPwAAAAAAAADg//8//P///////wMAAAAAAAAAAAAACAAAAAAAAAAA4P8/4P//////BwAAAAAAAAAAAAAAGAAAAAAAAAAAADwAAAR4Pv4HAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAgwEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADADwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADABwAAAAAAAAAAAAAAAAAAAAAAAIADAAAAAAAAAADADwAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAACAHwAAAAAAAAAAAAAAAAAAAAAABgAMAAAAAAAAAACAHwAAAAAAAAAAAAAAAAAAAAAABgAQAAAAAAAAAACAfwAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAACA/wEAAAAAAAAAAAAAAAAAAADAAgBwAAAAAAAAAACA/wMAAAAAAAAAAAAAAAAAAADgDwAQAAAAAAAAAAAA/wMAAAAAAAAAAAAAAAAAAADwDwAIAAAAAAAAAAAA/w8AAAAAAPABAAAAAAAA4Af0HwAAAAAAAAAAAAAA/x8AAAAAAPAHAAAAAAAA4B/+PwAAAAAAAAAAAAAA/z8AAAAAAPAPAAAAAAAA4P//PwAAAAAAAAAAAAAA/38AAAAAAPgfAAAAAAAA4P//PwAAAAAAAAAAAAAA/v8AAAAAAPw/AAAAAAAA8P//PwAAAAAAAAAAAAAA/v8AAAAAAPw/AAAAAAAA8P//PwAAAAAAAAAAAAAA/v8AAAAAAPx/YAAAAAAA8P//PwAAAAAAAAAAAAAA/v8HAAAAAPz/4AAAAAAA8P//HwAAAAAAAAAAAAAA/v8fAAAAAP7/4AAAAAAA4P//D0AAAAAAAAAAAAAA/v8fAAAAAP5/wAAAAAAAgP//ByAAAAAAAAAAAAAA/v8/AAAAAP//4AEAAAAAAP7/AwAAAAAAAAAAAAAA//8/AAAAAP//4QEAAAAAAPzfAQAAAAAAAAAAAADA//8/AAAAAP//hwMAAAAAAPjHAQAAAAAAAAAAAADg//8/AAAAAP//BwEAAAAAANDHAAAAAAAAAAAAAADg//9/AAAAAP7/BwAAAAAAAICHAAAAAAAAAAAAAADw//9/AAAAAP7/BwAAAAAAAAAAAAAAAAAAAAAAAADw////AAAAAP7/BwAAAAAAAAQADAAAAAAAAAAAAAD4////AQAAAP7/AwAAAAAAHADwBgQAAAAAAAAAAAD8////AQAAAP//AwAAAADABADyAwEAAAAAAAAAAAD8////AAAAAP//AwAAAABgAADwAQAAAAAAAAAAAAD8//8/AAAAgP//BwAAAABwEBL+AAAAAAAAAAAAAAD8//8DAAAAwP//BwAAAAA4vgEaAAAAAAAAAAAAAAD8//8BAAAAwP//DwAAAAAYPiABAAAAAAAAAAAAAAD4/38AAAAAwP//HwAAAAAcficAAAAAAAAAAAAAAADw/z8AAAAAwP//fwAAAAAWfAAAAAAAAAAAAAAAAADg/z8AAAAAwP///wAAAAAbMAAAAAAAAAAAAAAAAADw/x8AAAD8+P///wAAAAAZYAAAAAAAAAAAAAAAAADw/wEAAAD//////wEAIAAIAAgAAAAAAAAAAAAAAADy/wAAAID//////wEAIAAGAAwAAAAAAAAAAAAAAADBfgAAAID//////wMAGABAAAAAAAAAAAAAAAAAAICAAgAAAMD/////HwMAGADgAAoAAAAAAAAAAAAAAMAAAAAAAOD/////PwAAHAD8AQQAAAAAAAAAAAAAAPgBAAAAAOD/////7wEAHAD+AQEAAAAAAAAAAAAAgPwAAAAAAOD/////8wcAPoD+AAEAAAAAAAAAAAAA4B8AAAAAAOD/////8x8AfoB/AAMAAAAAAAAAAAAA+DgAAwAAAOD/////+T8A/oB/AwAAAAAAAAAAAAAAfDBwAAAAAOD/////+X8A/sN/AAAAAAAAAAAAAAAAfAAIAAAAAOD//////f/A/+f/BwAAAAAAAAAAAAAAfgAAAAAAAOD//////H/A////PwEAAAAAAAAAAAAgfwAAAAAAAMD///9//jPg////fwAAAAAAAAAAAACgfwAWAAAAAMD///9//+H//////wAAAAAAAAAAAADYfwACAAAAAID///8///n//////wEAAAAAAAAAAADo/wkCAAAAAAD+//////z//////wEAAAAAAAAAAADo//8DAAAAAAD8/+///////////wEAAAAAAAAAAAD8//8DAAAAAAD8/2OA/////////4EAAAAAAAAAAAD+//8PAAAAAAD4fwAA/////////wAHAAAAAAAAAID///8fAAAAAACwfwBD/////////zA/AAAAAAAAAID///8fAAAAAABwdAD8/////////zE4AAAAAAAAAMD///8/AAAAAAD8AMT8//H/////fzggAAAAAAAAAOD///9/AAAAAAD8AGT8//H//////xpgAAAAAAAAAOD/////AAAAAAD8Aebn+fH//////z8AAAAAAAAAAOD/////AQAAAAD8g/EH8Pj////////gAAAAAAAAAOD/////EwAAAACA//wHfPz////////HAAAAAAAAAOD//////wAAAACA//9P/vj///////8PAAAAAAAAAOD/////HxAAAADA//////////////8fAAAAAAAAAPD/////Gw4AAACg//////////////8fAAAAAAAAAPj/////zwAAAAAw/v////////////+/AAAAAAAAAPj////7/wMAAADg+f////////////9/AAEAAAAAgPz////5/wcAAADs+P////////////9/AAcAAAQAAP7////5/wMAAABoQOj///////////8DAA8AACAAAP///z/gfwAAAAAwYMf///////////8PAB8AAIACgP///wPgfwAAAAAQAAf///////////8fAA4AAPAB+P///wHwMwAAAAAA8A//////////////ZBgAAPzf/////wHwAwAGAAAA+M///////////////+ADAPz//////wNxDIAPAAAA8M///////////////98/AOD//////88GH8AfAAwAwJ////////////////9/GP7//////7/wJ+AfAH4AAD9++P//////////////N/D///////+Bf/D/AQAAAP7/x////v//////////A/7///8Pw56BB+D/DwAAAPz/Y+zf/f//////////APj/A0/8X4PwB/D//wAAAOA/AADh/v///////wM+A4AAAED8A/P/AOD//wEAAAAAADjg/v///z//HwCAAAAAAOBdc/MDAPj//wEAAAAAABjAwP///z9gAAAAAAAAAOAAAAAAAPz//wMAAAAAAGAAAPz/AQAAAAAAAAAAAAC8cQwBAP///wcAAAAAAIAHAMD/DwDwAAAAAAAAAAADAOAH/P///wcAAA4AAAAAAAAwAAAAAAAAAAAAAAAg3N4f/v///wcAAB8AAAAAAAA4AAAAAAAAAAAAAAAAAD/++f///wcAAPADgAEAAOADAAAAAAAAAAAAAAAAAPj/z////3EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const raw=atob(b64);
      for(let k=0;k<GW*GH;k++){
        if((raw.charCodeAt(k>>3)>>(k&7))&1){
          LAND[k]=1; U[k]=0; V[k]=0;
        }
      }
      // rebuild spawn lists immediately (no async delay)
      for(let c=0;c<4;c++) spawnByClass[c].length=0;
      for(let c=4;c<7;c++) spawnByClass[c].length=0;
      for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
        const k=y*GW+x;
        const pt=[-180+(x+0.5)*CELL,-90+(y+0.5)*CELL];
        if(!LAND[k]&&Math.hypot(U[k],V[k])>0) spawnByClass[CLS[k]].push(pt);
        // Wind spawns on land too — ERA5 10 m field is global (land + ocean).
        if(WCls[k]>=4) spawnByClass[WCls[k]].push(pt);
      }
      // Gyre ring: add ellipse path pts directly to class-3 spawn list
      (GF.GYRES||[]).forEach(g=>{
        (g._ringPts||[]).forEach(([lon,lat])=>{ if(lat>=-89&&lat<=89) spawnByClass[3].push([lon,lat]); });
      });
    })();
    function velFrom(UU,VV,lon,lat){ // bilinear in grid space
      let gx=(lon+180)/CELL-0.5, gy=(lat+90)/CELL-0.5;
      const x0=Math.floor(gx), y0=Math.floor(gy);
      const fx=gx-x0, fy=gy-y0;
      const x0w=((x0%GW)+GW)%GW, x1w=(x0w+1)%GW;
      const y0c=Math.max(0,Math.min(GH-1,y0)), y1c=Math.max(0,Math.min(GH-1,y0+1));
      const k00=y0c*GW+x0w,k01=y0c*GW+x1w,k10=y1c*GW+x0w,k11=y1c*GW+x1w;
      return [
        (UU[k00]*(1-fx)+UU[k01]*fx)*(1-fy)+(UU[k10]*(1-fx)+UU[k11]*fx)*fy,
        (VV[k00]*(1-fx)+VV[k01]*fx)*(1-fy)+(VV[k10]*(1-fx)+VV[k11]*fx)*fy
      ];
    }
    const vel=(lon,lat)=>velFrom(U,V,lon,lat);
    const velW=(lon,lat)=>velFrom(WU,WV,lon,lat);
// ════════════════════════════════════════════════════════════════════
//  PARTICLE FLOW ENGINE  — drop-in replacement for the particle loop
//  inside initFlowField(). All 8 ChatGPT stages implemented.
//  Preserves existing API: U,V,WU,WV,CLS,WCls,spawnByClass,clsEnabled.
// ════════════════════════════════════════════════════════════════════
    // ---- canvas ----
    const cnv=document.createElement('canvas');
    cnv.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;';
    document.body.appendChild(cnv);
    const ctx=cnv.getContext('2d');
    // Wind particles render above the SVG land fill (z-index 16) so streaks
    // are visible over continents; ocean currents stay on cnv below land (z-index 2).
    // Wind overlay sits directly above #globe (land) and below #globe-labels.
    const windCnv=document.createElement('canvas');
    windCnv.id='wind-flow-canvas';
    windCnv.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:16;pointer-events:none;background:transparent;';
    const labelSvg=document.getElementById('globe-labels');
    if(labelSvg) document.body.insertBefore(windCnv,labelSvg);
    else {
      const gEl=document.getElementById('globe');
      if(gEl) document.body.insertBefore(windCnv,gEl.nextSibling);
      else document.body.appendChild(windCnv);
    }
    const windCtx=windCnv.getContext('2d');
    let dpr=1;
  let _flowTr0=null,_flowTr1=null,_flowSc0=null;
  function _flowViewport(){
    if(window.GlobeAPI?.globeViewport) return window.GlobeAPI.globeViewport();
    return { w: innerWidth, h: innerHeight };
  }
  window._syncFlowClip=(cx,cy,sc)=>{
    const clip=`circle(${sc}px at ${cx}px ${cy}px)`;
    cnv.style.clipPath=clip;
    windCnv.style.clipPath=clip;
  };
  function sizeCanvas(){
      const v=_flowViewport();
      // Capped, not raw devicePixelRatio: canvas pixel count (and so every
      // per-frame clear/fill cost) scales with dpr², and a lot of phones
      // report 3 — 9x the fill-rate of dpr=1 for particle TRAILS, which are
      // soft/blurred by their own fade anyway and don't read any sharper at
      // full native resolution the way text or borders would. This is the
      // single biggest lever for the "currents freeze on older phones"
      // complaint that doesn't touch particle count/physics/appearance at
      // all — a capable device just gets slightly-supersampled trails
      // instead of 2-3x supersampled ones, indistinguishable in practice.
      dpr=Math.min(window.devicePixelRatio||1,2);
      cnv.width=Math.round(v.w*dpr);
      cnv.height=Math.round(v.h*dpr);
      windCnv.width=cnv.width;
      windCnv.height=cnv.height;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,cnv.width,cnv.height);
      windCtx.setTransform(1,0,0,1,0,0);
      windCtx.clearRect(0,0,windCnv.width,windCnv.height);
    }
    sizeCanvas();
    // Draw ocean background on canvas each frame — since sphere SVG fill is removed
    // Theme definitions: {bg: ocean base colours, streak: particle overlay colour, fade: rgba fade}
    // NULLSCHOOL MODEL: background = speed-coloured cmap, streaks = white/near-white
    // Themes define the BACKGROUND colour palette. Streaks are always light on dark.
    // ── Colour maps for speed-coded themes ─────────────────────
    function viridisColor(t){
      const r=Math.round(t<0.5?68+t*2*120:188+(t-0.5)*2*67);
      const g=Math.round(t<0.25?1+t*4*82:t<0.75?83+(t-0.25)*2*115:198-(t-0.75)*4*198);
      const b=Math.round(t<0.5?84+(t*2*30):114-(t-0.5)*2*114);
      return [Math.min(255,r),Math.min(255,g),Math.min(255,b)];
    }
    function plasmaColor(t){
      const r=Math.round(t<0.5?13+t*2*200:213+(t-0.5)*2*28);
      const g=Math.round(t<0.33?8+t*3*5:t<0.66?13+(t-0.33)*3*100:113+(t-0.66)*3*130);
      const b=Math.round(t<0.5?134+t*2*10:144-(t-0.5)*2*144);
      return [Math.min(255,r),Math.min(255,g),Math.min(255,b)];
    }
    function infraredColor(t){ // black→purple→red→orange→yellow (thermal IR style)
      const r=Math.round(t<0.33?t*3*120:t<0.66?120+(t-0.33)*3*135:255);
      const g=Math.round(t<0.5?0:t<0.75?(t-0.5)*4*180:180+(t-0.75)*4*75);
      const b=Math.round(t<0.25?t*4*100:t<0.5?100-(t-0.25)*4*100:0);
      return [Math.min(255,r),Math.min(255,g),Math.min(255,b)];
    }
    function turboColor(t){ // blue→cyan→green→yellow→red (Google Turbo)
      const r=Math.round(t<0.25?59+t*4*106:t<0.5?165+(t-0.25)*4*62:t<0.75?227+(t-0.75)*4*28:t>0.85?255-(t-0.85)*6.7*120:255);
      const g=Math.round(t<0.25?t*4*200:t<0.5?200+(t-0.25)*4*30:t<0.75?230-(t-0.5)*4*120:110-(t-0.75)*4*110);
      const b=Math.round(t<0.25?148+t*4*70:t<0.5?218-(t-0.25)*4*200:t<0.75?18:0);
      return [Math.min(255,r),Math.min(255,g),Math.min(255,b)];
    }

    function oceanSpeedBg(t){
      const mag=Math.min(1,t*1.5);
      if(mag<0.18){ const f=mag/0.18; return [Math.round(28+f*18),Math.round(72+f*55),Math.round(165+f*75)]; }
      if(mag<0.38){ const f=(mag-0.18)/0.20; return [Math.round(30+f*5),Math.round(100+f*135),Math.round(210+f*45)]; }
      if(mag<0.58){ const f=(mag-0.38)/0.20; return [Math.round(35+f*220),Math.round(235+f*20),Math.round(255)]; }
      if(mag<0.75){ const f=(mag-0.58)/0.17; return [Math.round(255),Math.round(255-f*130),Math.round(255-f*255)]; }
      const f=(mag-0.75)/0.25;
      return [Math.round(255),Math.round(125-f*100),Math.round(12+f*8)];
    }
    // Distinct per-theme speedpaint palettes — previously 'currents', 'dark',
    // 'teal' and 'warm' all fell back to oceanSpeedBg (or an identical copy
    // of it), so every theme's background heatmap looked the same aside from
    // base tint. Each of these keeps the same 5-band structure (calm → hot)
    // but with a palette on-brand for its theme.
    function indigoSpeedBg(t){ // 'currents' — indigo → violet → magenta → hot white
      const mag=Math.min(1,t*1.5);
      if(mag<0.18){ const f=mag/0.18; return [Math.round(40+f*30),Math.round(30+f*20),Math.round(120+f*60)]; }
      if(mag<0.38){ const f=(mag-0.18)/0.20; return [Math.round(70+f*70),Math.round(50+f*20),Math.round(180+f*40)]; }
      if(mag<0.58){ const f=(mag-0.38)/0.20; return [Math.round(140+f*100),Math.round(70+f*20),Math.round(220+f*20)]; }
      if(mag<0.75){ const f=(mag-0.58)/0.17; return [Math.round(240+f*15),Math.round(90+f*90),Math.round(240-f*40)]; }
      const f=(mag-0.75)/0.25;
      return [255,Math.round(180+f*60),Math.round(200+f*55)];
    }
    function monoSpeedBg(t){ // 'dark' — cool grayscale, calm & minimal
      const mag=Math.min(1,t*1.5);
      if(mag<0.18){ const f=mag/0.18; return [Math.round(20+f*15),Math.round(24+f*18),Math.round(30+f*24)]; }
      if(mag<0.38){ const f=(mag-0.18)/0.20; return [Math.round(35+f*35),Math.round(42+f*40),Math.round(54+f*46)]; }
      if(mag<0.58){ const f=(mag-0.38)/0.20; return [Math.round(70+f*60),Math.round(82+f*63),Math.round(100+f*70)]; }
      if(mag<0.75){ const f=(mag-0.58)/0.17; return [Math.round(130+f*90),Math.round(145+f*85),Math.round(170+f*70)]; }
      const f=(mag-0.75)/0.25;
      return [Math.round(220+f*35),Math.round(230+f*25),Math.round(240+f*15)];
    }
    function tealSpeedBg(t){ // 'teal' — deep teal → green → yellow-green hot
      const mag=Math.min(1,t*1.5);
      if(mag<0.18){ const f=mag/0.18; return [Math.round(10+f*10),Math.round(60+f*50),Math.round(50+f*35)]; }
      if(mag<0.38){ const f=(mag-0.18)/0.20; return [Math.round(20+f*10),Math.round(110+f*70),Math.round(85+f*15)]; }
      if(mag<0.58){ const f=(mag-0.38)/0.20; return [Math.round(30+f*70),Math.round(180+f*50),Math.round(100-f*20)]; }
      if(mag<0.75){ const f=(mag-0.58)/0.17; return [Math.round(100+f*130),Math.round(230+f*20),Math.round(80-f*40)]; }
      const f=(mag-0.75)/0.25;
      return [Math.round(230+f*25),255,Math.round(40+f*120)];
    }
    function amberSpeedBg(t){ // 'warm' — deep umber → amber → hot yellow-white
      const mag=Math.min(1,t*1.5);
      if(mag<0.18){ const f=mag/0.18; return [Math.round(50+f*40),Math.round(25+f*20),Math.round(10+f*5)]; }
      if(mag<0.38){ const f=(mag-0.18)/0.20; return [Math.round(90+f*70),Math.round(45+f*45),Math.round(15+f*5)]; }
      if(mag<0.58){ const f=(mag-0.38)/0.20; return [Math.round(160+f*80),Math.round(90+f*70),Math.round(20+f*10)]; }
      if(mag<0.75){ const f=(mag-0.58)/0.17; return [Math.round(240+f*15),Math.round(160+f*70),Math.round(30+f*40)]; }
      const f=(mag-0.75)/0.25;
      return [255,Math.round(230+f*20),Math.round(70+f*140)];
    }
    function _mixRgb(a,b,t){
      const u=Math.min(1,Math.max(0,t));
      return [Math.round(a[0]+(b[0]-a[0])*u),Math.round(a[1]+(b[1]-a[1])*u),Math.round(a[2]+(b[2]-a[2])*u)];
    }
    // Sample speed along local flow — elongates high-speed colour along streamlines.
    function _flowSpeedAt(lon,lat){
      const [u0,v0]=vel(lon,lat);
      let spd=Math.hypot(u0,v0);
      if(spd<0.02) return spd;
      const ux=u0/spd, vy=v0/spd, hop=1.5;
      for(let s=-4;s<=4;s++){
        if(!s) continue;
        const [u,v]=vel(lon+ux*hop*s,lat+vy*hop*s);
        spd=Math.max(spd,Math.hypot(u,v));
      }
      return spd;
    }
    // Directional streak-blend for the speedpaint background: instead of
    // colouring each low-res cell from one point sample (which produces hard
    // blocky edges and isolated dark holes wherever the synthesized current
    // field is momentarily weak between two stamped paths), average colour
    // across several samples stepped along the LOCAL FLOW DIRECTION with a
    // Gaussian falloff. This elongates fast-current colour along the
    // streamline and blends it softly into the slower water around it — an
    // "emulsion" look — and a weak/calm cell picks up colour from its
    // upstream/downstream neighbours instead of rendering as a flat hole.
    // Falls back to a small isotropic ring sample when there's no clear
    // local direction (dead-calm patch) so it still softens rather than
    // holding a hard edge. Only runs during paintOcean's low-res repaint
    // (on rotation), never per animation frame, so the extra samples are
    // effectively free.
    function _streakBgColor(lon,lat,cmapFn){
      const [u0,v0]=vel(lon,lat);
      const spd0=Math.hypot(u0,v0);
      const haveDir=spd0>0.03;
      const dirLon=haveDir?u0/spd0:0, dirLat=haveDir?v0/spd0:0;
      // Longer smear (±3.9° vs ±3.45°) with a wider gaussian — elongates
      // the flow-aligned "fibres" so the paint reads as fluid streamlines
      // rather than soft blobs. Sample count unchanged (7).
      const steps=3, stepDeg=1.3;
      let accR=0,accG=0,accB=0,accW=0;
      for(let s=-steps;s<=steps;s++){
        let slon,slat;
        if(haveDir){ slon=lon+dirLon*stepDeg*s; slat=lat+dirLat*stepDeg*s; }
        else { const ang=(s/steps)*Math.PI; slon=lon+Math.cos(ang)*stepDeg*0.8; slat=lat+Math.sin(ang)*stepDeg*0.8; }
        const [su,sv]=vel(slon,slat);
        const sSpd=Math.hypot(su,sv);
        const w=Math.exp(-(s*s)/9.5);
        const st=Math.min(1,sSpd/1.5);
        let scol;
        if(st>0.72){ const soft=cmapFn(0.72); const hot=cmapFn(st); scol=_mixRgb(soft,hot,Math.min(1,(st-0.72)/0.28)*0.55); }
        else scol=cmapFn(st);
        accR+=scol[0]*w; accG+=scol[1]*w; accB+=scol[2]*w; accW+=w;
      }
      return [accR/accW,accG/accW,accB/accW];
    }
    function _parseBgRgb(hex){
      const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex||'');
      return m?[parseInt(m[1],16),parseInt(m[2],16),parseInt(m[3],16)]:[2,8,16];
    }
    function oceanFlowOn(){
      if(window._ncDataActive) return false;
      const en=clsEnabled();
      return !!(en[0]||en[1]||en[2]||en[3]);
    }

    // ── OCEAN THEMES (dark bg, water-appropriate colours) ─────
    // ── WIND THEMES (separate palette, easy to distinguish) ───
    const THEMES={
      // Ocean themes — deep dark backgrounds
      ocean: {
        bg:['#0a1e2e','#061422','#030b16'], fadeBg:'rgba(5,14,22,',
        streak:[255,255,255], lineWidth:1.05, cmap:oceanSpeedBg,
        bgSpeed:true, bgMute:0.48, bgAlpha:0.34
      },
      currents: {
        bg:['#0a1e2e','#061422','#030b16'], fadeBg:'rgba(5,14,22,',
        streak:null, lineWidth:0.88, cmap:indigoSpeedBg,
        bgSpeed:true, bgMute:0.42, bgAlpha:0.30
      },
      dark: {
        bg:['#040608','#020405','#010203'], fadeBg:'rgba(2,3,5,',
        streak:[210,218,230], lineWidth:0.9, cmap:monoSpeedBg,
        bgSpeed:true, bgMute:0.26, bgAlpha:0.26
      },
      viridis: {
        bg:['#0a1828','#06121c','#030a12'], fadeBg:'rgba(5,12,18,',
        streak:null, lineWidth:1.0, cmap:viridisColor, bgSpeed:true, bgMute:0.4, bgAlpha:0.28
      },
      plasma: {
        bg:['#0a1828','#06121c','#030a12'], fadeBg:'rgba(5,12,18,',
        streak:null, lineWidth:1.1, cmap:plasmaColor, bgSpeed:true, bgMute:0.4, bgAlpha:0.28
      },
      teal: {
        bg:['#031e18','#021210','#010a08'], fadeBg:'rgba(2,12,8,',
        streak:[180,255,220], lineWidth:1.05, cmap:tealSpeedBg, bgSpeed:true, bgMute:0.38, bgAlpha:0.30
      },
      warm: {
        bg:['#160d04','#0e0802','#060400'], fadeBg:'rgba(10,6,2,',
        streak:[255,230,160], lineWidth:1.0, cmap:amberSpeedBg, bgSpeed:true, bgMute:0.36, bgAlpha:0.28
      },
      // Wind-optimised themes — distinct from ocean for easy differentiation
      wind_white: {  // clean white streaks on deep ocean base
        bg:['#0a1e2e','#061422','#030b16'], fadeBg:'rgba(5,14,22,',
        streak:[255,255,255], lineWidth:0.85, cmap:null
      },
      winds: {  // nullschool-style speed-coloured winds
        bg:['#0a1e2e','#061422','#030b16'], fadeBg:'rgba(5,14,22,',
        // Wind normalised 0-1 by GPU shader (/20), so t here is 0-1.
        // Use cls=99 to hit the wind branch in speedColor (not ocean palette).
        streak:null, lineWidth:0.72, cmap:(t)=>speedColor(t,99)
      },
      wind_cyan: {   // cyan/teal streaks — distinct from ocean white/plasma
        bg:['#060e14','#040a0e','#030608'], fadeBg:'rgba(4,8,12,',
        streak:[100,230,255], lineWidth:0.85, cmap:null
      },
      wind_yellow: { // amber/yellow — warm tone, very distinct from blue ocean themes
        bg:['#0e0a04','#090702','#050400'], fadeBg:'rgba(8,6,3,',
        streak:[255,210,60], lineWidth:0.85, cmap:null
      },
      // Infrared cmap starts near deep violet — tint bg to match.
      infra: {       // infrared thermal palette — purple→red→orange→yellow
        bg:['#0a1828','#06121c','#030a12'], fadeBg:'rgba(5,12,18,',
        streak:null, lineWidth:1.0, cmap:infraredColor
      },
      turbo: {       // Turbo rainbow — blue→cyan→green→yellow→red
        bg:['#0a1828','#06121c','#030a12'], fadeBg:'rgba(5,12,18,',
        streak:null, lineWidth:1.0, cmap:turboColor
      }
    };
    // Resolve a custom-field colormap key (as picked in the Earth Systems
    // panel) to a THEMES entry. Returns null when no valid override is set.
    function customTheme(target){
      const key=(window._customFieldTheme||{})[target];
      return key&&THEMES[key]?THEMES[key]:null;
    }
    function getOceanTheme(){
      const c=window._flowCfg||{};
      // In swap mode (custom active, not comparing) the ocean particles ARE
      // the custom field, so honour its own colormap choice if one is set.
      const cfa=window._customFieldActive||{}, cmp=window._compareActive||{};
      if(cfa.ocean&&!cmp.ocean){ const ct=customTheme('ocean'); if(ct) return ct; }
      return THEMES[c.oceanTheme||'ocean']||THEMES.ocean;
    }
    function getWindTheme(){
      const c=window._flowCfg||{};
      const cfa=window._customFieldActive||{}, cmp=window._compareActive||{};
      if(cfa.wind&&!cmp.wind){ const ct=customTheme('wind'); if(ct) return ct; }
      return THEMES[c.windTheme||'ocean']||THEMES.ocean;
    }
    // Theme used to draw the custom "compare" channel — its own colormap if
    // chosen, else a sensible high-contrast default distinct from the
    // embedded layer (winds-speed for wind, plasma for ocean).
    function getCompareTheme(target){
      const ct=customTheme(target); if(ct) return ct;
      return target==='wind'?THEMES.winds:THEMES.plasma;
    }
    function getTheme(){ return getOceanTheme(); } // legacy alias
    // Expose for the Flow Appearance IIFE's colormap selects.
    window._THEMES=THEMES;

    // Per-class colormap overrides (Earth Systems panel): classes 0-6
    // (warm/cold/acc/gyres/trades/westerlies/polar) plus jets (7) can each
    // pick their own THEMES colormap instead of sharing the single
    // ocean/wind default (or, for jets, the fixed violet→white ramp).
    window._classColormap={};
    function classCmapOverride(cls){
      if(cls>7) return null;
      const key=(window._classColormap||{})[cls];
      return key&&THEMES[key]?THEMES[key]:null;
    }

    // Low-res scratch buffer for smooth speed-field upscale (not a DOM layer).
    let _spdScratch=null, _spdDraw=null;
    function restoreSpeedBg(){
      if(!_spdDraw||!_spdScratch||!oceanFlowOn()) return;
      const th=getOceanTheme();
      if(!th.bgSpeed) return;
      ctx.globalCompositeOperation='destination-over';
      ctx.drawImage(_spdScratch,_spdDraw.x0,_spdDraw.y0,_spdDraw.dw,_spdDraw.dh);
      ctx.globalCompositeOperation='source-over';
    }
    function paintOceanFlat(th){
      _spdDraw=null;
      const tr=projection.translate(), sc=projection.scale();
      if(!(sc>0)) return;
      const cx0=tr[0]*dpr, cy0=tr[1]*dpr, R=(sc+1)*dpr;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx0, cy0, R, 0, 2*Math.PI);
      ctx.clip();
      try{
        const grad=ctx.createRadialGradient(
          (tr[0]-sc*0.15)*dpr,(tr[1]-sc*0.15)*dpr,sc*0.05*dpr,
          tr[0]*dpr,tr[1]*dpr,sc*dpr);
        grad.addColorStop(0,th.bg[0]);
        grad.addColorStop(0.6,th.bg[1]);
        grad.addColorStop(1,th.bg[2]);
        ctx.fillStyle=grad;
      }catch(e){ ctx.fillStyle=th.bg[1]; }
      ctx.fillRect(0,0,cnv.width,cnv.height);
      ctx.restore();
    }
    function paintOcean(){
      const tr=projection.translate(), sc=projection.scale();
      if(!(sc>0)) return;
      const th=getOceanTheme();
      const cx0=tr[0]*dpr, cy0=tr[1]*dpr, R=(sc+1)*dpr;
      const flowOn=oceanFlowOn();
      if(!th.bgSpeed||!flowOn){ paintOceanFlat(th); return; }
      const cmapFn=th.cmap||oceanSpeedBg;
      const mute=th.bgMute!=null?th.bgMute:0.45;
      const bgAlpha=th.bgAlpha!=null?th.bgAlpha:0.30;
      const bgDeep=th.bg[2]||'#030b16';
      const bgRgb=_parseBgRgb(bgDeep);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx0, cy0, R, 0, 2*Math.PI);
      ctx.clip();
      ctx.fillStyle=bgDeep;
      ctx.fillRect(0,0,cnv.width,cnv.height);
      // Finer texel size when the globe is settled (≈2x the old 7-15px
      // resolution) — the visible "blockiness" of the speed paint was the
      // scratch resolution, not the smear. During drag keep the old coarse
      // step: paintOcean runs every frame while dragging and the fine
      // grid would cost ~4x there.
      const step=(typeof dragging!=='undefined'&&dragging)
        ? Math.max(7, Math.min(15, Math.round(sc/40)))
        : Math.max(5, Math.min(11, Math.round(sc/52)));
      const x0=cx0-R, y0=cy0-R;
      const w=Math.ceil(2*R/step)+1, h=Math.ceil(2*R/step)+1;
      const dw=w*step, dh=h*step;
      if(!_spdScratch) _spdScratch=document.createElement('canvas');
      if(_spdScratch.width!==w||_spdScratch.height!==h){ _spdScratch.width=w; _spdScratch.height=h; }
      const tctx=_spdScratch.getContext('2d');
      const im=tctx.createImageData(w,h);
      const inv=projection.invert.bind(projection);
      const R2=(sc+1)*(sc+1);
      for(let py=0;py<h;py++){
        for(let px=0;px<w;px++){
          const sx=(x0+px*step)/dpr, sy=(y0+py*step)/dpr;
          const pi=(py*w+px)*4;
          const dx=sx-tr[0], dy=sy-tr[1];
          if(dx*dx+dy*dy>R2){ im.data[pi+3]=0; continue; }
          const ll=inv([sx,sy]);
          if(!ll){ im.data[pi+3]=0; continue; }
          if(LAND[gi(ll[0],ll[1])]){
            im.data[pi]=bgRgb[0]; im.data[pi+1]=bgRgb[1]; im.data[pi+2]=bgRgb[2]; im.data[pi+3]=255;
            continue;
          }
          const col=_streakBgColor(ll[0],ll[1],cmapFn);
          const wgt=mute*bgAlpha;
          im.data[pi]=Math.round(bgRgb[0]+(col[0]-bgRgb[0])*wgt);
          im.data[pi+1]=Math.round(bgRgb[1]+(col[1]-bgRgb[1])*wgt);
          im.data[pi+2]=Math.round(bgRgb[2]+(col[2]-bgRgb[2])*wgt);
          im.data[pi+3]=255;
        }
      }
      tctx.putImageData(im,0,0);
      ctx.imageSmoothingEnabled=true;
      if(ctx.imageSmoothingQuality) ctx.imageSmoothingQuality='high';
      ctx.drawImage(_spdScratch, x0, y0, dw, dh);
      _spdDraw={x0,y0,dw,dh};
      ctx.restore();
    }
    paintOcean();  // paint initial ocean background
    window.addEventListener('resize',()=>{ sizeCanvas(); paintOcean(); _canvasRot0=null; });
    window.visualViewport?.addEventListener('resize',()=>{ sizeCanvas(); paintOcean(); _canvasRot0=null; window.dispatchEvent(new Event('resize')); });
    window.visualViewport?.addEventListener('scroll',()=>{ if(window._syncFlowClip&&projection){ const tr=projection.translate(),sc=projection.scale(); window._syncFlowClip(tr[0],tr[1],sc); } });
    window._flowClear=()=>{
      ctx.clearRect(0,0,cnv.width,cnv.height);
      windCtx.clearRect(0,0,windCnv.width,windCnv.height);
      if(oceanFlowOn()) paintOcean();
      else paintOceanFlat(getOceanTheme());
    };

    // ── Stage 1: Typed-array SoA particle storage (no objects) ──────
    // Large enough for 28.5k ocean + 9.5k wind + 1.7k jets with the full
    // GPU boost (raised 32000→40000 so wind no longer has to be clamped
    // to a fraction of the boost — GPU compute handles 40k trivially).
    // CPU path uses at most ~22k*1.2=26.4k so still well under ceiling.
    const MAXP=40000;
    // Touch-primary devices (phones/tablets — NOT just "has a touchscreen",
    // which would also catch touch-enabled laptops) get a lighter default
    // particle count. The CPU/Canvas2D path below is single-threaded scalar
    // math per particle every frame; on an older phone's weaker single-core
    // performance, the desktop default (up to ~26k active particles) is
    // frequently enough to blow the frame budget and read as "frozen"
    // rather than merely slow. This scales the count actually simulated —
    // sliders, their displayed range, and every other appearance setting
    // are untouched, so a capable phone/tablet can still push density
    // back up to the same ceiling desktop has.
    const _mobileParticleScale=(window.matchMedia&&window.matchMedia('(pointer:coarse)').matches)?0.6:1;
    const pLon  =new Float32Array(MAXP);
    const pLat  =new Float32Array(MAXP);
    const pAge  =new Uint16Array(MAXP);
    const pCls  =new Uint8Array(MAXP);
    const pAlive=new Uint8Array(MAXP);   // 0=dead, 1=alive

    // ── Stage 2: Preallocated segment buffers (no per-frame allocs) ─
    const segBuf =[];
    const segMag =[];  // speed magnitude per segment for colour mapping
    // 6 floats/segment (was 4): [ax,ay, mx,my, bx,by] — the middle pair is
    // the projected RK2 midpoint, rendered as a quadratic Bézier control
    // so fast/long segments curve with the flow instead of chording.
    for(let c=0;c<NCLS;c++){ segBuf[c]=new Float32Array(MAXP*6); segMag[c]=new Float32Array(MAXP); }
    const segN=new Uint32Array(NCLS);
    // Parallel segment buffers for the custom "compare" field — populated in
    // the same advect loop by the sub-pool of particles routed through the
    // custom channel (Uc/Vc/WUc/WVc), then drawn with the custom colormap.
    const segBufC=[]; const segMagC=[];
    for(let c=0;c<NCLS;c++){ segBufC[c]=new Float32Array(MAXP*6); segMagC[c]=new Float32Array(MAXP); }
    const segNC=new Uint32Array(NCLS);

    // ── Stage 4: Fast LCG random number generator ───────────────────
    let _seed=Math.imul(Date.now(),1664525)|1;
    function rand(){
      _seed=(_seed*1664525+1013904223)|0;
      return (_seed>>>0)/4294967296;
    }

    // ── Stage 8: Velocity-weighted spawn list (fast currents = more particles) ──
    // Build a flat weighted spawn table: entries repeated proportional to speed
    function buildWeightedSpawn(cls){
      const raw=spawnByClass[cls]; if(!raw.length) return raw;
      // For wind/ocean cells store the speed too
      const weighted=[];
      for(let i=0;i<raw.length;i++){
        const lon=raw[i][0], lat=raw[i][1];
        const [u,v]= cls>=4 ? velW(lon,lat) : vel(lon,lat);
        const mag=Math.hypot(u,v);
        // Linear speed weighting — fast currents denser, slow gyres still covered
        const reps=Math.max(1,Math.round(1+mag*5));
        for(let r=0;r<reps;r++) weighted.push(raw[i]);
      }
      return weighted;
    }
    const spawnW=[];
    // Build weighted lists after land mask finishes (initial pass uses raw)
    let _spawnReady=false;
    function rebuildSpawnWeights(){
      for(let c=0;c<NCLS;c++) spawnW[c]=buildWeightedSpawn(c);
      _spawnReady=true;
    }


    // ════ REAL ERA5 10m WIND FIELD ═══════════════════════════════
    // Replaces synthetic zonal wind belts with real measured wind velocities.
    // Source: ERA5 monthly mean, 10m u/v, 1°x1° annual mean
    // Encoding: uint8, -20…+20 m/s → 0…255 (128 = zero)
    (function(){
      const VMAX=20.0, HALF=128, SCALE=VMAX/127.5;
      const GW2=360, GH2=180;
      const raw=atob('jJCMkYyRjJGLkYuRi5GLkoqSipKKkoqSiZKJkomSiJOIk4iTiJOHk4eTh5OHk4aThpOGk4WThZOFk4SThJOEk4OTg5ODk4KTgpOCk4GTgZOBk4CTgJOAk4CTf5N/k3+SfpJ+kn6SfZJ9kn2SfJJ8knySe5J7knuSe5F6kXqRepF6kXmReZF5kXmQeJB4kHiQd5B3kHePd493j3aPdo92j3aPdo91j3WPdY51jnWOdI50jnSNdI1zjXONc4xyjHKMcoxyi3GLcYtxi3GKcIpwinCJcIlviW+Ib4hviG6Hboduhm6GboZthW2FbYRthGyEbINsg2yDbIJsgmyBbIFrgWuAa4Brf2t/a35rfmt9a31rfGt8a3xre2t7a3premt6a3lreWt4a3hrd2t3bHdsdmx2bHVsdWx0bXRtdG1zbXNtcm1ybnJucW5xbnBvcG9wb29vb3BucG5wbnFtcW1xbHJscmxya3Jrc2tza3NqdGp0anRqdWl1aXZpdmh3aHdod2h4Z3hneWd5Z3pmemZ7ZntmfGZ8Zn1lfWV+ZX5lf2V/ZYBlgGWBZYFlgmWDZYNlhGWEZYVlhmWGZYdlh2WIZYlliWWKZotmi2aMZo1njWeOZ49oj2iQaJFokWmSaZNpk2qUapRrlGuVbJVtlm2Wbpdul2+Yb5hwmHCYcZlymXKZc5lzmXSZdJl1mXWZdpl2mXeZd5l4mXiZeZl5mXqZeph7mHuYfJh8mHyYfZd9l32Xfpd+l36WfpZ/ln+Wf5aAlYCVgJWAlYGVgZWBlIKUgpSClIOUg5SDlIOThJOEk4SThZOFk4WShZKGkoaShpKHkoeRh5GHkYiRiJGIkYiRiJCJkImQiZCJkImQipCKj4qPio+Kj4uPi4+Lj4uPjI+Mj4yPjI+MjoyOjI6Njo2OjY6Njo2Ojo6Ojo6Ojo6OjY+Nj42PjY+Nj42QjZCMkIyQeJ14nXideJ14nXiceJx4nHiceJx4nHiceZx5nHmceZx5nHmceZx5nHmceZx5nHmdeZ15nXmdeZ15nXideJ14nneed553nnaedp51nXSddJ1znXOcc5xynHKccptxm3GbcZpxmnGacZpxmXGZcZlxmXGZcZlxmHGYcZhxmHGYcZhxmHGYcZhxmHGYcZhxmHGYcJhwmXCZcJlwmXCZb5lvmW+Zb5lumW6ZbpltmW2ZbZhtmGyYbJhsmGuXa5dql2qWapZqlmmVaZVplGiUaJNnk2eSZ5JmkWaRZpBlj2WPZY5kjmSNY41jjGOMY4tii2KKYopiiWGJYYhhiGGIYYdhh2CHYIZghmCFYIVghGCEYIRgg2CDYIJggmCBYIFfgF9/X39ffl99X31ffF97X3pfel95X3hfd192X3VfdF90X3Nfcl9xX3FgcGBvYG5gbmFtYWxhbGJrYmpiamNpY2lkaGRoZGdlZ2VmZmZmZWdlZ2RoZGhkaWNpY2piamJrYmthbGFsYW1gbmBuYG9fb19wX3BecV5xXnJecl1zXXNddFx0XHVcdVx2XHdbd1t4W3hbeVt6W3tbfFt9W35bflt/XIBcgl2DXYRehV6GX4dfiGCJYYphi2KMY45jj2SQZZFmkmeTZ5RolWmWapdrmGyZbZlumm+bb5xwnXGdcp1znnSedZ51n3afd594oHmfeZ96n3uffJ98n32ffp9/n3+fgJ6BnoGegp6DnYOdhJ2FnIWchpyHm4ebiJuJmomaipqLmYuZjJmNmI2YjpePl4+XkJaQlpGVkZWSlJKTkpOTkpOSk5GUkJSQlI+UjpWNlY2VjJWLlYuWipaJlomWiJaIl4eXhpeGl4WYhZiEmISZg5mDmYOagpqCmoGagZuAm4Cbf5x/nH6cfpx+nH2cfZx8nXydfJ17nXude516nXqdep16nXmdeZ15nXmdeZ14nXidZadlqGWpZqlmqmaqZqtlrGWtZa1krmOvYq9hr2CwX7BfsF+wX7BfsGCwYa9jr2SvZq5nrmavZa9lr2SvYq5grV2sW6tYqlapVahVplSkU6NTolOhU6BTn1OfU55TnlKeUp1SnVKdU51UnVWdVp1XnVidWZ1anVudXJ1dnV2dXp1fnWCdYZ1inmOeZJ5lnmafZ59on2igaaBpoWqhaqFqomqiaqJpomiiZ6JmomWiZKJiomGiYKFfoV6gXaBcn1ufW55anlqdWZxZnFibWJtXmleaV5lXmVeYVphWmFaXVpdWl1aXVpZXlleWV5ZYlliWWZZZllqWWpZblluWW5ZclVyVXJRclFyTXJJckVyQXI9bjluNW4tbiluJWohahlmFWYRYgliBV4BXfld9VnxWe1Z6VnhWd1Z2V3VXdFh0WHNYcllxWnBbb1tvXG5dbV5sXmtfamBqYWlhaGJnYmdjZmNlZGVkZGRjZWJlYmZhZmFnYGdgaF9pX2pfa15sXm1ebl1vXXFdcl1zXXRcdVx1XHZcd1x3W3hbeFt4W3lbeVp5WnlaeVp6Wnpaelp6Wntae1p8W31bflt/XIBcgV2DXYRehV+HX4hgimGLYoxjjWOOZI9lkGaRZ5FokmmSapNqk2uUbJRtlW6Wb5Zwl3GXcpdzmHOYdJl1mXaZd5l4mXmaeZp6mnuafJp8mn2afpp/moCagJqBm4Kbg5uDm4SbhZuGm4abh5qImomaipqLmoyajZqNmY6Zj5mQmZGYkpiTmJSYlZeWl5eWmJaYlpmVmpWblJuTnJOdkp6Rn5Cfj6COoY2ijKKLo4qkiaSJpYilh6aGp4WnhKiDqIKogaiAqX+pfql9qXyqe6p6qnmqeKp3qnaqdap0qnOqcqpxqnCpb6luqW6obahsqGyna6dqp2qmaaZppmimaKZnpmemZ6ZmpmamZaZlp2WnZadkp2SnXK5ermCuYq5krmiua65ur3Cvcq51rXatdqx1qnOocKZtpWqjaKBmnWacaJtum3OaeJp7m36dfp5+nnqbdJhvlWmSZJBej1mOVY9SkFCQTpBNkE+QUo9Wj1qPX5Fjk2WUZZZil1+YXZhallWVUZJNkEuOSoxKi0qKSopLjEyNTo5Pjk+OUI9Rj1OPVY9XkFqQXZFhk2aVa5dvmXObdp54oHmieqR6pXmmeKZ2pnSlcqRwo26ia6FooGWfYp9fnlyeWp1YnleeVZ9VoFShVKNTo1KkUaVPpU2lS6VJpUikRqRFo0aiR6FHoUmgSp9Mn06fUJ5SnlSdVZ1VnFWbVZpVmVSXVJZTlFKSUpFSj1KOUoxSi1KKU4hUh1SFVYRVglaBVn9XfVd8V3tXeVd4V3dXdVd0V3NXcVdwV29XbVhsWGtYallpWWhaZ1pmW2VbZVxkXGRdY15jXmJfYmBhYWFhYWJgY2BjYGRgZGBlX2VfZl9mX2dfZ19oX2lfaV9qXmtea15sXm1dbl1uXG9ccFtxW3FbclpzWXNZdFl1WHZYdld3V3hWeFZ5VnpWe1V8VX1VflZ/VoBWgleDV4VYhlmIWYlailuMXI1djl2PXpBfkWCSYJNhlGKVYpZjlmSXZJhlmWaaZ5pom2icaZxqnWuebJ5tn26fb59woHGgcqBzoXShdaF3oXiieaJ6onuifKJ9on6if6KBoYKhg6GEoIWghqCHoImfip+Ln4yejZ6Ono+dkJ2RnJKck5uUm5WalpqXmZiZmZmbmJyYnZeel5+XoJahlaKVo5Skk6SSpZKmkaeQqI+ojqmNqoyqi6uKq4msiKyHrYatha6EroOugq6Brn+vfq99r3uveq95rneudq51rnStc61xrXCtbq1trWyta61qrGisZ61mrWStY61hrWCtYK1grV+tXq1drVytWq1ZrFisWKxYrFisWaxZrFutcqRwo26jbKJon2WdZptqmG+WdJJ5kH2NgYuFiIeHiYeJiYiLhY2Bj32RepJ5lHmUeZV6lnqXepd3lnWVc5Nwkm6PbI5rjmqOaI5njmaOZo5mjmaPZ5BpkWqTaZVqlWuUapBqjGiIZodlhWOFYIVdhVyGWoZYhVeGV4ZVhlKGT4ZOhk6FToVOhU+GUIhRi1GOU5FWlFqXX5pmnGyec6B4oHqgep55nHeZdpd3lHqSfpKDk4qTjpSOl42ai5yHn4GhfKN3pHSlcqZwpm+lbqRsommgZZ1gmVqWVZRQkkuRRpBDkEKRQZJCk0OVRZZHmEiaSJpKmkuZTJhNlk6UT5JQkFGOUYxRilGJUYdShVGEUYJRgVF/UX1QfFB6UHlQd1B2UHRRc1JyU3BUb1VuVm1WbFZrVWpUalNpU2hSaFJoU2dTZ1RnVWdWZ1dnWGdZZ1lnWmdbZ1xnXGddZ15nXmdfZ19nYGdgZ2FnYmZiZmNmY2ZjZmRlZGVlZWVlZWRmZGdkZ2RoY2hjaWJqYmpha2BsYGxfbF5tXW1cbVttWm1ZblhuWG9Xb1ZwVnFWclV0VXVVd1V5VntWfVZ/V4FXg1iEWIZYh1mIWYpai1qMW41cj1yQXZFekl6TX5NglGCVYZZil2KYY5lkmmWcZp1nnmifaaBqoGyhbaJuo3CjcaRypHSldaV3pXileqZ7pnylfqV/pYClgaWDpYSlhaWGpYeliaWKpYuljKSOpI+kkKORo5Kik6KVoZahl6CYoJmfm56cnZ2dnpyfm6CbopqjmqSZpZimmKiWqZWplKqTq5Kska2QrY+uj6+OsI2xjLKLsoqzirOIs4ezhrOFs4Szg7OCs4KzgLN/s36zfLN7s3qyebJ4sniyd7J2snWzdLN0tHS0dbR1tHS1crZwtW6zbLBsrWyqbqdvpm+mbaVspGmgZZxfmFuUXJRdlV+YYptnnm6ihZCDj4OPg46BjX2Meox4jXWOc49xkW+TbJVql2eZZZtknGWdZJ1jnGKaYplhl2GWYZRgkmCQX41ei12IXIZbhFqCWIBVflN8UHtOeUx4S3dJdkd1RXVDdUJ0QHQ/cz5yPXI9cj1yPXI9cj1zPXQ9dT12PXg9eT17Pnw/fUB+Q35Ff0iAS4FNgU6CT4JRgVKBU4FUgVaCWYRchWKHZ4lsi3CMdI12jniPeZB7knyUfpWBlYSWiJaKmIycjKCLpIupi6yLro2wjrCOsI2vi62JrIephKeApHyheJ5zm26ZbJdulm6WbJhqm2adXp5Unk6cSpdHkkaNRYlGhUiDSoJMgk+CUYNSg1OCUoFRf099TXtLeUl2SnVLdEtzTHNNc01yTXJNck1yTXJOck5yT3JPclBxUHFPcU9xT3BOcE5wT3BPcFBwUXBRcFJwU3BUcFVwVnBWcFdwV29Yb1hvWW9Zb1puW25cblxuXW5ebV9tYG1hbWFtYmxjbGNsZGtla2VrZmpmaWdpaGhoZ2lmaWVqZGpia2FrYGtea11qW2paallrWGtXbFZtVW5VblRvVHFUclRzVHVUd1V4VXpVfFZ+V4BYglmEWoZaiFuJXIpci12MXY1ejl6PX5BfkWCSYJNhlGKVYpdjmGSZZZpmm2edaZ5qn2ugbKBuoW+icaNypHSldaV3pnimead7p32ofqiAqIGog6iEp4anh6eIpoqmi6WNpY6lj6WQpJGkkqSUpJWjlqOXo5mimqKbop2hnqGfoKCfoZ+jn6SepZ6mnaedqJypm6mbqpqrmayYrZeula6Ur5OvkrCRsJCwj7GOsY2xjLKLs4qziLSHtIa0hLWDtYO1grSBtIC0f7V+tX60fbR8tHu0erR7tXu1e7Z6tnm3eLZ5tH2xg6yJpougjJqLk4qMi4eNho+Fi4aFiH6Jeod4hnmFfYWDhoWIhouGjoaOdo50kXKUcZVvlm2YbJlpmmibaJxnnWacZp1mnWecZ5tnmmeZZ5hnlmeVZpNmkWaPZo1mi2WJZYZkhGOCY39jfmR8ZHpjeGN3YnZhdWB1YHVfdF9zXnJccVtxWXBYb1ZvVW5UbVNtVGxVa1VqVmhWZ1ZlVmNVYlVhVGBUYFRgVGFVYlVjVmRWZVdlWGZZZ1pnW2heaWFqZGxnbWpwbHNudnB6cX9yg3SGdYp3jnqSfJZ+mYCcgJ+BooGlgqmCroKygrWCt4K5g7qFu4a8iLyIvIi6h7mGt4S0g7KDr4OuhayGq4esiauLqYmkhZ9+mHWPa4hlhGGBXoBdgV6CYYRohHCGdYl3jHOObJBijliJT4RIgEN9QXtBekR5R3hJeEp4S3hLeEt4THlNeU15TnpOek56TnpOek15THlLeUt5SnhKeEp4S3dMd012TnZPdVB1UXVSdFJ0U3NUc1VzVnJXclhxWXFZcFpvW29cbl1uXm5gbWFtYmxjbGVrZmtnamhqaGlpaGpnamVrZGtja2FrYGxebF1tW21ablluWG1WbVVtVG1UblRvU3BTcVNxU3FTcVNxU3JUdFR3VXlWfFd+WIBZgVmCWoNahFqFWoZah1uIW4lbilyLXIxcjV2NXY5ej16QX5FgkmGUYpVjl2WZZ5ppnGudbZ5voHGgc6F1oneieKN6o3ykfqR/pIGkg6SEpIakh6SIpIqki6WMpY2ljqWPpZClkqSTpJSjlaKXopiimaKaopuinKKdoZ6gn6Cgn6CfoZ+in6SepZ2nnaicqZuqm6ubrJutmq2arpmumK6WrpWula+Ur5SvlLCTsZOxkrKSs5GzkbOQtI+0jrSMtIq1ibWHtIa0hbODsoKygbGCsYSxhbGFsoWzhrKJsIush6eAoXycfJSAjoeMjYmKhoKGgIWEhIiEioaJhoSGgYeCiIWJhIqDin6Je4p4i3iMdpl0mnSbdJtzm3KacZlxmXKZcphymHKXcpZylXKUcpNzknORc5BzjnKNcoxyi3KJcYhwhW+DboBtfW17bXptem15bHlreGl3Z3ZldWV0ZnRoc2pxa29sbWxrbGlsZ2pmamVpZGlkaGNoY2hjZ2JnYmZhZmBlX2RdY1tiWmNZZFlmWGZYZldmV2ZXZldmWGVZZVplXGdebWF0ZXtpgG2CcoN1g3mCfYKAg4SFiIeMiJCJk4mWipqLnYyhjKSNpo2pjKyMrouwirKJtIi0hrSFtIOzgLB+rXyqe6Z6pHuieqF6oXqheqB6nnubfJd9k36Ofop5h3WEcIVshmiIZopnjGmQcpZ5nICihKaApXmfbZNgiFd/UHpKekd7SH1Kfk5/UIBRgFGAUoBSgFKAU39Uf1V+VX5VfVV8VnpVd1R1U3NSclFxUXBQcFBvUm9TcFVwVnFXcVhyWXJZcllyWXJZcVlxWnBab1tvXG5dbV5sX2tha2JqZWpmaWhpaWlraGxobWduZ29mb2VwZHBkcWNxYXJgcl9yXXJcclpxWXFXcVdyVnNWdFV1VXVUdlR2U3ZTdlN2VHdUeVV6VnxXflh/WX9ZgFmAWoBagFqBW4Fcgl2CXYNeg1+EYIRhhGKEYoVjhWSGZodniWiKaYtrjWyPbZBukm+TcJVxl3OZdZt3nXmee599n3+ggaCDoISghqCHoIigiaCKoIqgi6CMoIyhjaGOoo+ikKORo5Kkk6SUo5WjlqOYo5mimqGboJugnKCdoZ+ioaOjpKSjpaGmn6adpZylnKWbpZumm6abp5qomqqaq5mtma6Yr5ewl7GXsZaylrKVspWzlLOTtJK0kLSPtI60jbOMsouxi7GKsImwiLCHsIavha+GromrjaaSn5eWmJCVjZCLioeGhYiFiYaIh4iJiIqIiomKhol/hXuEe4h7jH2RfZR6lXiVeJd3mHaYfJh7mHuXe5d7lnqWepV6lHqUeZN5knmSeZF5kHmPeY14jHmMeYt5inqIeod6hnmEeIF0fXF6bnhseW56b3xxfXV/eIB5gHh/dXxyeHB1bnNtcW1vbWxtam5ob2dxZnFkcWNyYXJfc110W3RZdVd2VXZTdlJ1UHNPcU5uTm1ObU5sTmxPak9pUGlSaVRpVmpZalxqX2xjb2dyanRseG58b4FyhXSIeIp8i3+MhI6IkIyRj5GTkpaUmZaclqCWo5WnlKmUq5Ork6ySrZCtjayJq4WogKR7oHeedZ53nnqefp2Am3+ZfZZ8knqPeY14i3aJdoh1h3SFc4RyhHKEcYRxhXCHcIlvjW+PcZF0kXaNdohxgWl9Xn1Uf06CTYZOiFCKUIlSiFKGUoVRhVCGUodViViJWYhZhVaBVH1SelF4UXVRc1JwU25UblZvWHBacVxyXnNgc2JzY3Flb2ZtaGpqaGtla2NsYWxfbF5uXW9dcF1xXXJddF12XnheeV56XXtcfFt9Wn5Zf1d/Vn9Vf1OAUn9Rf09+Tn1Ofk5/T4BPgE+AT39Pfk99T3xPfFB8UHxRfFJ8U3xVflZ/WIBZgFqAW39cf12AX4BggGKAY4BlgGaAaH9pf2p+a31sfGx7bXpuem56b3pwe3F7cnxzfHR9dH51fnZ/d4B3g3iHeYt6jnyRfpN/lYGXgpiDmYSahJqFm4ach5yInYmdip2LnYydjJ2NnY6ej5+QoJGhkqKTopSilaKWoZahlqGXopijmaObo5yjnKKdop2inaGcop2inqOfo6CkoqSjpKWkpqSnpKikqaOpoamgqZ6pnamcqZyqnKucrJytnK2crpuumq6Zrpeul66Wrpevlq+Vr5SwlbCWsZayk7KOsoevgah4nnaTeoqBhYqDjYONhImGiImHioiMho2DjYKOg5CDkoKTgJSAlX+Wf5Z+l36XfZd8mHyYgZWBlYCUgJSAlH+Tf5J/kX6RfpB+j32OfY19jHyLfIp8inuJe4h7h3uHeoZ5hniFdoV1hHWDdIN0gXKAcX9wfnB9b3tveG91cHNwcXFvcm10a3Roc2ZyZHFicmB0XnVcdlt2WXZXdVZ1VHRTdFN0UnRSdFN0U3RUc1RzVXJWcFduV2xZa1tqXWpea2BrYmxja2RrZWtna2hsa21tbXFudHB4dHt5fn2AgIKEhIeGjIiPi5GOk5GUlpWZlpyWnZWdlJyWnJqhm6eZq5irlaySrIyph6SFoIScgpmAl36VfZR8k3ySfJF7kHiOdo13jXmNeY13jXWMdYtziG+Fa4FrgXKAeIB8fnt8fXuBfIR/hYOChn6HfId5hnWGcYVug2yBaIFmgWWCZoRmhmWFY4RjgWZ/aX9rgGiBZX9jfGF4XnVYcFZsV2lbaV9pYGhhZmNlZ2VqZWxkbmBuXW9bcFpxWXBYcFdvV29Wb1ZvVnFVc1V1VXdVeVR7VHxTfVN+Un5SflJ+UX9RflF+UH9Qf1B/UH9Qf1F/UX9Rf1J/Un9Tf1N/VH9Uf1V+Vn5Xflh9WX5aflt+XH5dfl9+YH5hfWJ9ZH1mfWh9an1sfG97cnt0end5eXh7d3x1fXR+cn9xf29/boBugG2AbIBsgG2AbYBtgG2AbX9tf21/bn9uf3GAc4B4gH2CgoOFhYeGiYeLiI2KjouOjY+NkI6RjpKOk46UjpWOl4+Yj5iQmZCakZuSnJKdlJ2VnpeemZ+an5ufnJ6dnp2dnJ2cnp2enZ+eoJ+hoKGhoqKio6Oko6WipqKmoaagpZ+loKShpKSlpqWnpqeoqKmoqqeqpqqkqqKqoamhqaCnoKahpaGkoqOkoqehqqGtoa6hr6Cwn66ZqI+YgIt5hXuJgZCEk4WTho+GjIaJhomKiY2JjomPiJCHkYeShpSFlIWVhJWElYOWg5aCloKVhZWFlISUg5ODk4KSgZKBkYCQf5B/j36OfY59jX2Neol5hnqDf4SCh4GKfop8iXuHeoV6g3uBfH98e3p3eXN6cH1ugG2CboNvhW+Db4Bvfm59bXxsemp4ZnZjdGB0XnRcdFt0WnRZdVl2WXdZd1p2WnZadVp1WnRac1pyWnJbcVxxXnFfcGBvYm1ka2ZqZ2hqZ2xnb2ZxZnRnd2h5anxrf2yBbYNshWuHaohqimuLbo10jn2QhJCIkIyOkI2SjJCMj4yQj4yRhZN/lYKYhpuHnoWfhJ+FnYSag5aFk4iUiJSFlISTg5GBkICOf4x+i32LfIt9i3yKfYl9iHyHfIV6gnV+bXpoeGd4a3pxf32Eh4iKi4WPf5F9kXyPeo14i3WJc4ZyhHGAcHxud2lzZHFlcml0bXRwc3Jyc3FybW1qZ2dhZl1lXWRgZGJjY2NjY2VhZ2BnXmddZ11qXW1dcFxwXHBbcVpyWnFacVlwWHBYcFhxWHJXc1d0V3VXdld4VnlWelZ7VntWe1Z8VnxXfFd9V31XfVh9WH1ZfVl+Wn5aflt+XH5cfl1+Xn5efl9+YH5hfWN9ZH1lfGd8aXxre257cXp1enh6fHqAeYN5hneJdop0jHONcY5wj26PbI9qj2mOZ41ljWSMYothimCJYIlgiGCHYIdgh2CHYIdghmCGYIdhiWSKZ4xrjm6PcZBzkXaReJF5j3qOe419i3+KgomFiYmJjImPipKLlI2Wj5eRmZOZlJqVm5abl5uXm5ibmJuXmpeal5uYnJmdmp6bn5yfnZ+eoJ6gn6CfoJ+gn6CfoJ6fnqCeoJ+ioKShpaOlpKalpqampqWmpKWkpKOjo6KjoKOeo5ykmqWZp5iol6qXrZavlK+SsZGyj7GOrY+ojqKIm4WUhJOElX+Wfo9+ioCOgpSIlouUjpSPk5GRkpCUj5SNlIyVi5WKlomWiJWHlYaVh5eGl4WXhJaDloKVgZWBlICUf5N+k32SfZF9kX2QeI91jnWQd492jnWLdop4iHqEeX52d3Zwd2t5anlreWx6bHtsfG19b4BvhW6JbIhqhmeEZINigl+CXoFdgV2BXYFcgFt+W31cfl1/X39gfmF9YXxiemJ4YXRhcWJvZG1nbGprb2tza3dremp8Z31kfWN9Yn5hfmB+YH9ggGGCYYNihWSGZodoiWqKa4tqjGmMaI1ojGiKaIdrg3OAfn+GgIeDgIR1h3eHgIqHjoiUh5WElYSUhpWHl4eXhJWCk4OShZKGkoWShJCDjoONgoyCi4KKgYmBiYCIgIiAh3+Hfod/hn2EdoBrfmZ+aYFzhXyIgYx/kHiTdpR2k3eSeJF5jXaEcnp2cX9uh26KboltgWp4a3Bsbm1va3JodWR2YHhde1x+XH9cflx7XHhcdFtwW21ba1xrXGpcal1qXmxebl5wXnFdcVxyXHJbc1tzW3Rbc1tzWnRadFp0WXVZdVl1WHZZd1l4WXlZelp6Wntae1t7W3xcfV19XX1dfV59Xn1ffV99YH1hfWJ+Y35lfmZ9Zn1ofWl+a35tfW99cn52fnp+f36EfYh8i3uOepF5k3iVdpZ1mHOZcppwm26bbJxqnGebZJphmF6WW5RZk1eSVpNWk1aTVZNVklSSVJJUk1KTUZRTlFaVV5RXkViPWo1ci16IYYZkhGeCa4FtgW+Acn91gHiBfYOChoeJi4uOjpGPk5GUkpSTlZSWlZaVlpWWlJiVmZWZlpqXm5ibmZyanJucm5ybnZudm56bnpqfmp+aoJqgmaGao5qmnKedqJ6on6igqKCnoKWfpJ+knaOcpJukmqSZo5mjmKSXpZell6aXp5eomKmYq5msm66dsp60n7WZsoyqf594m3aVdIx0jXWSe5GCjYeOipCOkpOSlpKZkZqQmY+YjpiMmYuZipiJl4iXhp6GnoWchJyDm4KagZmBmICXgJZ/lX+UfpN9kn2RfJB7j3qOeY55jniLdIZtf2t7cHp4e3p/d4Z3ineLdIlvh26JcYtwhm19bHJ0anhje198XXxbfFp9WX1Yf1iCWYRahFqDWoJbgl2CYoFmf2Z/YoBif2V+aXxuenJ3d3V7c4BxhG+HbYhriGmIZ4dlhWKEYIRfg16DXoNdglyBW4BbgFyBXYJfhGOGZoZphmuGbYZthW6Fbodri2aOdY2AioCGe4ODhoGFfYKBgoqGj46Mk4mViJaKl4iVhpKGkIaOho2GjYaMhoyFi4WKhYqEioSJg4mDiYKJgYmBiYCJf4l+iX2JfYl8iXiJdIpzi3OMdI5zkHORdY92jneMeIp6hnp/dHtteGl3a3ZvcXJtdWh3ZXljemJ7YHtgel52XnJeb19vYXJhdWJ3Y3djd2N2YnZhd2F2YXVhcmBxX3FfcV5xXXJdc1xzXHRbdFt1W3Zbdlp2WnZadll2WXZZdlp3Wndbd1t4XHhceV15Xnpeel96X3pfemB6YHphemJ6Y3pjeWR5ZHplemd7aHppeWp5bHlueG94cnl1enl8fX6Bf4aAioCNgJGAk36Wfph9mnyce556oHmhd6N2pHSldKVxpW2kZ6JioVygWJ9TnlCeTp1NnE2cTJxNm06bT5lPlVCST49Qi1GHUYJSflN6VXdXdVl0W3RedGF0ZXVodWp1bXdveHF5dHx6gH+EhImHjIiPipGLk42UjZWNlo2VjJSOlZGXkpiTmZOalJqVmpWalZqWmpaal5mXmZiZmZiZmJqXmpeblp2WoJejmaWbpZymnaadpp2lnaSco5ujm6Oao5mjmaOZo5mimaKZoZmhmaGaoZqimqObo5uknKSbpZukmqSaopmem52an5OXiYuGioaOiIeLfYt7hoGDh4eLkYyajJ6Mn4yfjJ6Ln4qfip+In4efh56HnYachpuFmoWZhJiEl4OWg5WClIKUgZOBkoCRgJF/kH+Pf49+jn6NfYt8iXmHeIZ4hHeDdYJ0gHN/c351fHh9dXxweGtxZGliZmZnamlqZ2tmbWduZ29mcWZzaXRpdGlyaW9ob2lubXFzeHZ8cn10fXt9gXyGeYl6iXyJe455k3aUb5Bwh3SFcoprjmWNX4pbiFeGVYRTg1GCUoNUhlWIVolWilSKUopSi1OLVYtYi1yLYYtnjG6OdJB6kX6RgJF/kXqOeI9/lISVgJN8j3uKfYWAgYN+iX6OgI2EioeKiIuJioqKiomKiIqHioaKhYuEi4SLg4uCjIGMgY1/jX6Nfo1+jH2MfYt8inuKe4p6inqKeol6iXqIeod6hXmDeIF2fnR8cXlteGd4YHlcelt6W3paelx6XnpgeWF6YXpiemN6ZHhkdWVyZW5ma2lpbGdwZXJidGF1X3VedF50XXRddF10XXRddFxzXHNcc1x0XHRcdFx1XXVddV51XnZfdmB2YXZhdWJ1Y3VjdWR1ZXRlc2ZzZ3JocmlxanBsb25ucW50bnZteW17bHxrfmt/a4Bsgm2FbohwinONdZB2kniVepd7mnycfZ5+oH6jfaV8p3ype6t6rXeuda91sHWwdK9vrWirX6hXplGlTaVMpUukS6FMnUyXTJFNi0+FUX5TeFRyU25SbFNqVWpXalpqXGtea2BsY25lb2dxaXFrc211cHl1fXqDf4iCjIOPhZGGk4aVhJWDlYSWhZiHmoiciJ2Inoieh56HnYiciZyKm4uajJiOl5CWkpWTlJSTlZKXkpmTnJSflqKYo5mimqKbopyinKGboJuhm6KboZuhnKGcoJ2gnp+enZ+dn5ygnKGbopujm6WbqJurm62bsJu0l7aVtJqvoKOckpeHk4eOjoiQiIyGhIN/gYKAjIGXhJ6HoYiiiKOJo4miiaGIoIifh52HnIabhpqGmYWYhZeFloSVhJSElIOTg5KDkYORgpCCj4KPgo6BjYGMgYuBiYCIf4Z+hX2De4J5gXiAdX9zf3B/bX1qfWd+ZYBphGyDZH9aflmAXYVhh2OHZ4liiWOHbIpmilyGXIdai1uOX5FflGCYX5pfm2CcY55mn2qacZN6kXqZcKBqnmqYbpVtm2SeWZhOk0iSR5RJlUuYTJlLlUeQRohKg1CCU4FSgFGAUIFQgk+DUIRUhV2HaYp0jnqQfJB7j3yOf46FjoePhI6Bh4CAf3t9eHx4fHZ/c4JxhHCMdJB7iYGJhYyKioyKjYmOiI6HjoWPhI+Dj4KOgY6BjYCMgIuAi4CKf4p/in+Jfol+iX6JfYl9iH2IfId8hnuFeoR5g3iCdoF0gHF/b35sfWl8ZX1jgGGDYYVjhmKGX4VdhlyEWn1ZeFt2XHRdcmFuZWlpZGtibmFwYXJhcmFzYHNgcWBvYG5hbmJtY2xjbGNsY2xjbWRtZG5kbmRuZW9mb2dvaG5pbWpsbGxta25qcGlyZ3NmdWV4ZXtmfmaCZYVkh2OJYothjGGMYIxei12LXYtei2CMYo5kkGaSaJRrlm2YcJpynXWfeKJ6pHymfql/rH+vf7J+tXu3eLl2u3S9cr9wv2y8ZbhftFqwVqtTpVGdT5VOjk6HT4BPeU9yTmxPZ1JkVWJWYlZjV2RYZVplW2ZdZ2BpYWpjbGRtZW9mcmh1a3pxgXWHeIx6j3uSfJR9ln6Yfpp+m36cfp1+nn6ffp99n32ffJ57nXuce5p7mXyYfZZ+lX+TgpKFkYiQjJGPkpKTlJWXl5qZnJucnJydnJ2bnJqbm5ydnp2fnKCcoZyim6Kao5mjmKOXpJekl6SYpZmnm6mcq52tnq+fsp+zm7SZsJukn5ufk52HmoKXhJSEk4WQhI2Ei4eJjIiRiJaImomdiZ+JoImgiJ+In4ieh5yGm4aahpmFmIWXhZaFlYWUhZOFkoSRhJCEkISPhI6EjoSNhIyDjIOLg4qDiYKIgoeBhoGFgIR/g36DfYJ8gnqBeYF4gHZ/dH9yfnB9bX1qfWh/ZYFhg2OGZYhfiVuLYI1hjF2KWYlYiVqLXYpeil6NW41bjl+RX5Rcl16aYZ1mm2+Xd5hzlmyObZFqmWWYYpJfjV2MXIxfi2OHZn5lc11qVmdaa2FvZ3BocGVvYm5dbllxVXZTfVaGX45nlGiYZ5lomGmVbpN4k36RfIt7hXqAdHluc3BwdW52bHZqemiFa5NxlHiNfIl+h4CJh4qPipOIk4eRhZCEj4OOg42CjIKMgYuBioGKgIqAiYCJgImAiX+If4h/iH6Ifod+h32GfYZ8hXuFeoR6hHmDd4J2gXSAc39xf29+b35vfm99bnpvd2t2Y3Zedlp1WHZbeGB7ZX5ofmR8YXpid2FzY25na2pra3Bpdmd7Y3tgeV51XnJecF9vYG5hbmFuYnBicWNzY3ZieWJ7Yn9hgV+DXoVdhluHWohZilmMWo5ckV6UXpdeml2bW5tXmVSWU5NTkVGOUI1RjVOOVpBZklyUXpZgl2KZZZtonmugb6JzpHenfKqBrYSwhrKHs4a0g7WBt4G6gLt+vXu9dbxuuma1WqxUolKYUY1QglB5UHJPa0tmSWNJYUxhUWFUYlViVmJXY1dkWWZbaFxpXmtfbWBvYHJhdWN6Z4BrhW+Kco5zkXWUdpd3mXibeJ14n3igd6F2oXWhdKB0oHOecp1ymnGYcZZxlHKSc5F0j3SPdY52j3iQfJKBlIWWiJeLmI6ZkZqTm5SblZuUnJeemaGYo5akk6SUpZWmlKeTqJKokaiQp5CnkKeRp5OmlqaZpZ2koKOkoaeeqpmtkrGLtYGtcJxnmnKVeJR+mIaVi5OOkpCQko+UjpiNmoyci52KnomeiJ6InYedhpqFmoWYhZeFloWVhZSFk4WShZGFkIWQhY+FjoWNhY2FjIWMhYuFioWKhYmFiIWIhYeEhoSGhIWDhIOEgoOCg4GCgIJ/gn6BfYF8gXuAeoB4gHeAdYF0gXOCc4JygnKDcoNyg3KEc4VwgnGBdYJvhWmFZYVliGiLaYtpi2mLaotqi2mOapNqk2mRaZFskG6NcIlwhnCDcH9ve253a3Vlc150XXhffF59XXxhfGiAZYdci1eNVpJYmVifWKNdpmCnYKRgnVqVWJVkn3CjdZ10km2IboNpgWF/YH5gfF95X3hne3V+gH2Me5J9jYCJgYWHhJCFk4WShZGEj4OOg42CjIKLgYuBioGKgYmBiYGJgIiAiICIgIiAiICHf4d/h3+Hfod+hn2GfYV8hXyEe4N6g3mCeIF3gHV/dH5zfXB8bnptem96cHpsd2hzbHNndF11WHRTcVBxUXRRd1R4WXtghGOOYJdnmmeaXI1VflN2VHNVcVZxWHNZd1p7WoBag1iFWIdbi16QXpRblliXVZlTmlGbT5xNnEqbSZpPm1qiYKhfq1upU6JLmkiVSJNHkEWNRYxHjkqRTZRPllGYU5hVmVeaWZtbm16cYp5noG6jdqV8qIGqh6uLrJCulK+Xspi2mbqZvpjCk8KQwIy5eqxill+DXnlVdFFuUmlRZU1gSV5IXkpfTWFQYlFjUWRSZlRoVWpWbFZuV3BYcll0Wndbel5/YYRkiWeOapFtlW6XcJpxnHOfdKF1o3SjcqNwo26ja6FroGueapxpmWiWaJRpk2qRapFrkGyQbY9tj2+PcZB0kXeTe5R+lYKWh5eKmYybjZ2On5Kjk6WRp4+ojKqNq42si62JrYithq2GrIWshayErIOrg6qFqIiljKKQn5SblpaZkp2QoI2WhoGHgYiHgoV+hHyGfoiDiImOj5CWjpuNnYyeip6Jnoieh52GnIabhJmEmISWhZWFlIWThZKFkYWQho+GjoaOho2GjIeMh4uHioeKh4mHiYiIiIiIh4iGiIaHhYeFh4SHhIeEhoOGg4aDhYKFgoWChIKDgYOBgoGBgYGAgIB/gH+AfoB9f31/fH96f3l/eIB3gneEd4R3g3aCdYJ0gnODc4Nzg3KEcoRyhXKGc4d0h3WHdod2hneFd4N3gnaAdX9zf3J/cH1vfW9+cH5xfXF+b4BrhGmGZ4dmhmaHZIpljWaNZoxoi2qJbIVsgWuAaYJqhG+FeIV4hXWBeH94fHV5dXl1d3V2dHZscmtscGl9cJB5lICKg4WHgY6CkoKRgpCCjoKNgoyBi4GKgYqBiYGJgYiBiIGIgYiBiIGIgYiBh4GHgIeAh4CHgId/hn+Gf4Z+hX6FfYR8hHuDe4N6gnmBd4B2f3V+cn1vfW19bH1sfWt+a35pfGV4XXNSb09xUXdPe02BVoplkXWSe5hynmWXYoZigV2AWH9VfFeAW4pfk1uZVphTl0+VUpdZoV6qXa1Vq1esWa5YrVauVapNokqbSJxVomqsaLheuVSrSZ9FmUOYQJQ6kDaOOZBBlEaXR5hHmEeYSJhKmEyXTpZPllCWU5dXmV6bZ55xoHqjgaWHp42qlK2bsKK0pbaotqm1rLSxsrayrqiRmX+TcZJcflJuT2hMZUllRGVFZkhnSWdKZ0xoTWlOalBsUW5QcFFzUXVSeFJ8Un9Sg1WHWYtcj16SYZZjmWWbZ55poWujbaVvpXGmcaVvpGyiaaBmn2WdZJtjmWKXYpdil2KXYpdhlmGVYZNikmORZJBnkWqRbpJwk3KWd5l9nIGehaCIo4uljKeNqouriKyGrIathq+FsIKwgLB/sH+wfbB8r3qtd6l0p3OmdKV0pHWidqF7oYOkjKOVoJeigZpvhm+AfoKEgISBhH+Hg42ViqGKoomhiKCHn4aehZyFm4WahJaElYSUhJKFkYWQhY+GjoaNh42HjIeLiIuIiomJiYmJiImIioeKh4qGioaKhYqFioWLhIuEi4OKg4qDioOKgoqCioKKgomBiYGJgYmBiIGIgIeAh4CGgIaAhYCEgISAg4CCgIKAgYGBgYGBgYGAgYCBgIF/gX6BfoF+gX2BfYF9gn2CfYJ9gn6CfoJ+gn6BfoF9gH2AfH97f3l+eH94f3aAdoF2gnaDdoJ0gXSBc4FzgXOBdIF0gXWBdoB3f3d+eHx4e3h6eHp4eXh5eXh7d3p1enZ8d3x2enN8coByhnV5bHRjeGGCapB4jH+HgoWIgI2Aj4COgI2AjIGLgYqBioGJgYiBiIGIgYiBh4KHgoeCh4KHgoeCh4KHgoeCh4GHgYeBh4GGgIaAhoCGf4V+hX6EfYR8g3uDeoJ5gniBd4B1gHN/cn5wfm99bXxre2h5YndXeWCCZ4dXglKEVoxilGiXapZ5k3SNYohcilqLW45ikmSWaZlunmSfXppgm2SYappqol+sVKtNq1GtXKtmp2enYaFcmlmZVp9Tp02yRrA/pz+fP5c/kj6PPYw6jTWQNJc7nUGfQZ1AmkCWQZNCkEWNR4xKi0uLTY1OkFGUV5hfnWegcKF5o4SljaiUqpqrnqujrKitr6+1srm0uLOrq56pk56AjGZ6V2xTZVBjTGJHY0ZlRmdFaUVrR21JcEpzS3VMeEx7TH5NgE6DToVNh02KT45UkliXWZtanluhXaRfpl+nYKhiqGaoa6dvpm6la6Jon2SdYpxgnF6dX51enF2aXJhclluUWpJakVqQWpBbkF2SYZRllmiZap1toG+hdaR6p3ypf6uCq4Srh6uJrIiuhrGDs4C0fbV7tXm1d7R1snOwca1vq22oa6Zro2ugbJ1vnHidiZiWmI6bfpF5iH+Jeop7h4CFf4SAg3qSfaSCpYOjg6GDn4Ocg5uDmYOXg5KEkYSQhY+GjoaNh4yHi4iLiYqJiYqJioiLiIuHi4eMhoyGjIWNhY2EjYSNhI2DjoOOg46CjoKOgo6CjoGOgY6BjoGOgY6BjoCNgI2AjYCNgIyAjICMgIuAi4CKgIp/in+Jf4mAiICIgIiAiICHgIeAh4CGgIaAhoCFgIWAhYCFgISAhICEgISAhICEgISAhICDgIN/g3+Cf4J/gX6BfoB+f35/fn5+fn5+fn5+fX5+fn59fn1+fX58fnt+e396f3l/eH53fnZ+dX50fnN9cn1yf3R/dX13enl4fHx9g3l7anZjemaLc5KCioSEhoGLgI6AjYCLgIuAioCJgIiBiIGHgYeBh4KHgoeChoKGgoaDhoOGg4aDhoOGg4aDh4OHg4eDh4OGgoaChoKGgYaBhoCFf4V/hX6EfYR8hHuDeoN5gniCdoF0gXKAcIBugGuAaIJlhWWGZYZhhmGJY4hiiGOJY4djhmOGY4Rfg1uFWYhXjFaPVpFVkFKPU5BVklmTVpdSmlCcTJlPmlCeV55fm1mYUZhQm06dUp9Wm1aTVI1PiUeIQ4pDjECMPIs6ijmPPZlIo1ClSZlAiUCDQn9DfUR8Rn5Jgk2HT41OkE2ST5RSllaYWppjn22keKiBqoisja2UrZ6wqrOvt67Ap7uboJGhkKyOp4WYboJXb0xrS25IcERwQHE/cz93QXpCfEN+RoFIg0iFSIZIh0eIR4lGikaMSZFNllSaV55WoValV6dWqFWnVaZVplenXKpkq2erZqdjpGKjYqRhpV6kW6JYn1edVptWmFWVVJNUkVSQVI9UkFWTWJdcnF6fXZ9dn1+gZKJrpXKncahwqXOqe6yEr4myi7WLuYe8gb16vXW8c7tyuW+2bLNssWmtZaZloGecappqm3GYhpOOkIOSfYmCiHmHeIZ7hnmGdIdxi3CVc5x4nnuefpx/moCZgZeClYKUhI6FjYaMh4uIiomJiYmKiIuHi4eMhoyGjYWNhY6FjoSPhI+Dj4OQg5CCkIKQgpGCkYGRgZGBkYGRgZKAkoCSgJKAkoCSgJKAkoCRgJGAkX+Rf5F/kX+Qf5B/kH+Pf49/j3+Of45/jn+Of41/jX+Nf41/jH+Mf4x/jH+Lf4t/i3+Kf4p/in+Kf4p/iX+Jf4l/iX+Jf4h/iH+Ifoh+h36Hfod+hn2GfYZ9hX2FfIV8hXyEfIR7hHuEe4R6hHqEeYR5g3iDd4N2gnWCdIFzgHJ+cX1wfXF8cX52fHp8e4F8eHRxdW91dXeHgI6FhoaCiYCMf4t/ioCJgIiAh4CHgYaBhoKGgoaChYOFg4WDhYOFhIWEhYSGhIaEhoSGhYaFhoWGhYaEhoSGhIaEhoSGhIaDhoOGgoWChYGFgIWAhX+EfoR9hHyEe4R6g3iEd4N1hHSEcoRxhXCFb4Vuhm2GbIZqhmmGZ4Zmh2WHZIhiiGGJX4leil2KXYtcjFuNW45aj1qQWZBakVqRWpJclVyWW5ZclVyUXZRek1+RYY9ii2KHYoVhg2CDYYJhgVh9SX9UjV+WXZpnnXCUZIJNcUZwSHVGekZ/SIVNjlaXWppQlEqNSYlMiVGNV5Zbnl6lZqtvsnS4db16wIHBhcGNvpS7mLebp5idkKWMq4mmg5t0jmmIYYNTfkh8QXo+eT15PXs/f0GDQ4dFiEWJRYpEi0KMQY5AkT+UQZhEnEqhU6RYplenVqhSp02iTKBOoFKkVqlarVysXKtdq16tXq5erVqpV6VUolOfUpxQmU+WTZRMkkySTJJNlFCYU5xWn1efVZ9Sn1GfU59YoWekbaVqpWqob692tn68hsKKyIfLgcp7x3LDbL5su2+2b7NtsWqpZKBmnmaeb5xynHCWepN5kXiReIt1h3OGcYZwh3CJcItwjnKRdJN3lHmVfJR+k3+SgZGCkIOPh4mIiImHioeLhoyGjYWNhY6Ej4SPhJCDkIORg5GCkYKSgpKBkoGTgZOAk4CUgJSAlICUgJSAlX+Vf5V/lX+Vf5V/lX+Vf5V/lX+Vf5V/lX+Vf5V/lX+Uf5R/lH+Uf5R/k3+TfpN+kn6Sf5J/kn+Sf5F/kX+Rf5F/kH+Qf5B/kH+Pf49/j3+Pf45/jn+Of45+jn6Nfo1+jX6Nfo1+jH6Mfox9jH2LfYt8i3yKfIp8inuKe4p7iXuJeol6iXmIeYh4iHiHd4d2hnaFdYR0g3SBc39zfXN6dHd2d3t8fH53fXF5cnd6goGDg4KCgIaBioGKgImAh4GGgYaBhYKFgoWChIOEg4SDhISEhISFhIWEhYSFhYaFhoWGhYaFhoWHhYeGh4aHhoeGh4aGhoaGhoaGhoaGhYaFhYSFhIWDhYKFgoWBhYCFgIV/hX6FfYV8hXuFeoZ5hniGdoZ1hnWHdIdzh3GHcIdvh26HbYdsiGuIaYlpiWiKZ4pni2aLZoxljWWNZY5ljmWOZo9mj2ePZ45ojmiNaYxpi2qJaohqhmmEaIJngGV/Yn5fflmBXIlijWGJYoRjgGR6YXVaeFV+ToFJhEmMTJhRoVyiX5pPh0l/SINJi1SWYaBepVioXK1qtW26ZrpkuGe7a75qwW7FdMd6xIS6j7KOtYewgqV8mXWNcINrfWd5WXZCdj17QYNDiUGKQItAjESPRpBCkD6RPpI+lT6YPp4/oz+nRqpWrVywV6tPoUacQpxGn0+jWKdbqlmsWK9as1u0XbRasVetU6lRpVChT55NnEqYSJRGkkWSRZRImE6eUqNTpVOkUaFOnUmaR5pNn1enYKlkqGmsb7N1u3jDe8t/1HrZbdN5ynvCa7hlr2mqcalxqGydaZVxk3CObIxsjW2PcI5zjXSLdIh0h3SGdIZ0hnSHdYh2iXeKeYt6jHyMfoyAjIKMg4uFioaKi4SMhI2DjoOPg5CCkIKRgpKCkoGTgZOBlIGUgJSAlYCVgJV/ln+Wf5Z/ln+Xf5d+l36Xfpd+mH6Yfph+mH6Yfph+mH6Yfph+mH6Yfph+mH6Yfph+mH6Yfph+mH6Xfpd+l36XfpZ+ln6WfpZ+ln6VfpV+lX6VfpV+lH6UfpR+lH6UfpN/k3+Tf5J/kn6SfpJ+kn6SfpJ+kX6RfpF+kX2RfZB9kH2QfI98j3yPfI97j3uOe457jnuNeo16jXmNeYx4jHiLd4t3ineJdol2iHWHdYV1hHWDdYJ1gXR/cntxenN6d3l9g39+goCFf4WChYKFgYWChIKEg4ODg4ODhIOEg4SDhYOFg4aDhoOGg4eDh4OHg4iEiISIhIiEiYSJhYmFiYWJhYmFiYWJhYmFiYWIhYiGiIaIhYeFh4WGhYaFhoWFhYSGhIaDhoKGgoaBhoCGf4Z/hn6HfYd8h3yHe4d6h3mHeId3h3eHdoh1iHSIc4hyiXKJcYlxinCKcIpwinCLcItwi3GLcYpxinGKcYpxiXGJcohyh3GGcYVxhHCDb4JtgWyBaoFpgWiCaIJogWiAZ35lfGN6YXleeV15W3tagVuIXY5hj2ySbIxVgUiHSY9Ik0+UZ5p3n2mdXKJnqmWqXaZhol+mX6dgqmCpZKllq2OwaLhxu3eyeKV2mnOQb4lqg2V+X3xZfFN/UIROh0WIQI1FkkOUQ5RDkj2RO5M+l0GbRKBCoz6nQLBQt22vZKVInkebQZo/nkenVLBbtlu7WL5TvlC9VLdYqmCiXqBWoFCfUp5Tmk2USpJGk0GVQppHok6oVqpVqlSnTp5HkUeOR5NPn1OnVatYr1y1Ybxowm3Gccl3yIXDgq91r3qxeqh2mHOScpJzkXSOdIt0inWJdYh1iHaIeId5hnmFeoR6g3uCe4J8gnyDfYN+hH+EgIWBhYKGhIaFhoaGiIWJhYqFkIGRgZKBk4CTgJSAlICVgJV/ln+Wf5d/l3+Xfph+mH6Yfpl+mX6ZfZl9mn2afZp9mn2afZp9mn2bfZt9m32bfZt9m32bfZt9m36bfpt+m36bfpt+m36bfpt+m36bfpt+mn6afpp+mn6afpl+mX6Zfpl+mX6Yfph+mH6Yf5h/l3+Xf5d/l3+Xf5Z/ln+Wf5V+lX6WfpZ+lX6VfZV9lX2VfZR9lHyUfJR8k3yTe5N7k3uTe5J7knqSepF6kXmReZB5kHiPeI93jneOd412jHaMdot2inWJdYh1hnSEdIB0fXZ+eHh2e32FfoN/hYCGf4aBhYKEgoSChYKFgoWChoKGgoaCh4KHgYiCiIKJgomCiYKKgoqDioOLg4uDi4SLhIuEi4SLhIuFi4WLhYuFi4WLhYuFi4WKhYqFioWKhYmFiYWJhoiGiIaHhoeGhoaGhoWGhYaEh4OHg4eCh4KHgYeAh4CHf4d/h36Hfod9iHyIfIh7iHuIeoh6iHmIeYh5iHmIeYh5iHmIeYh5h3mHeYd5hnmGeYV5hXmEeIR4g3eCd4J2gXWBdIBzgHOAcn9xf3B+b31ufGx8antoe2Z7ZHxkfGN8ZHxkfWZ+aH5sgGd8XntagFmJZ5V8nn+acJtomWaVZZFjkWKRYpJjlGKVYpdhmmGfZKNqpW+hc5t0lnOQcoxwiW2Ga4Rog2SCYYJegluDWYVahliGVYhWiFKITYtKk0+XUphRllObU5xZpGilap9TkUSSQpZIokutVLJdt124WrBYq1qeUIxUjHGZfp90nmeXYpJhjV6HW4VYhVWIUo5Qk0+cYKRnmWiLYX9Ngk6OTpdfnVyeVKFYpVmnW6tfq2KsYq9mqGmrca11pnageJt7lnyRfY59i36Jfoh/hn+FgISAg4GCgYGCgIJ/g3+Df4R+hH6EfoV+hX+Gf4eAiICIgImBioGLgYyBjYGOgY+Bln6Wfpd+l36Yfph+mH6Zfpl+mX2afZp9m32bfZt9m32cfZx8nHycfJ18nXydfJ18nXydfJ18nX2dfZ19nn2efZ59nn2efZ59nn2efZ59nn2efZ59nn2efZ59nn6efp5+nn6efp1+nX6dfp1+nX+cf5x/nH+cf5x/nH+cf5t/m3+bf5t/m3+bf5p/mn+afpl+mX6Zfpl+mX2ZfZl9mH2YfJh8mHyYfJd8l3uXe5d7lnuWe5Z7lnqWepZ6lXqUeZR5lHiTeJJ4kneRd5F3kHeQd492j3aOdo12jHWKdYl1h3WFdIJ1fXh3eYB8iH6DgYWBhoKFgoWChoGHgYeAiICJgImAioCKgIuAi4CLgIyBjIGMgY2CjYKNgo2CjYONg46DjoSOhI6EjoSOhI6FjoWOhY2FjYWNhY2FjYWMhYyFjIWMhYuGi4aLhouGioaKhomGiYaJhoiGiIaHhoeGh4eGh4aHhYeFh4SHhIeEh4OHg4eCh4KHgoeBh4GHgYeBh4GHgIaAhoCGgIaAhYCFgIWAhICEgISAg3+Df4J/gn+BfoF+gH2AfIB8f3t/en96fnl9eH13fHV8dHtye3F7b3ptemt6anpoeWV5Y3lgeV17WoBXiFeSWZtfoGSeZ5polmiTaJJokWeRZ5FokmiTaJRplmuXbZhwl3OWdZR2kXaOdox1inSIc4dyhnCFb4VthGyEaoRohWaFZYVkhWKFYIZfh1+IX4heiF2JX4xgj2GRY4xhhlyIVpFal1mYWpxfnWWaaZNsi2qEYoddlGOfaZ5rmGySbIxriWmGZoVkhWKFYIZfh1+JYYpihmCCXYFahFmIWYpaj12QXY9ej1+QYJFikmSUZpZomGyZcZl2mHqVfZKAjoKMg4mEh4WFhoOHgoiBiICJf4l+in2KfIp8i3uMe4x7jHuNe417jXuOfI58j3yQfZB9kX2SfZN+k36UfpV+m3ybfJx8nHycfJx8nXydfJ18nXyefJ58nnyefJ58nnyfe597n3ufe598oHygfKB8oHygfKB8oHygfKB8oHygfKB8oHygfKF8oXyhfKF9oX2hfaF9oX2hfaF9oX6hfqF+oX6hfqB+oH6gf6B/oH+gf59/n3+ff59/n3+ff55/nn+ef55/nn+ef55/nn+dfp1+nH6cfZx9nH2cfZx9nHycfJx8m3ybfJt8m3uae5p7mnuZe5p6mnqaepl6mXqZeZh5mHmXeJZ4lniVeJV3lXeUd5N3k3eSdpF2kXaQdo91jXWMdYp2h3aBeH5+foB/foV+hICFf4h9i4CMfox+jX6Nfo1+jX6Of45/jn+Of4+Aj4CPgY+Bj4GQgpCCkIKQgpCDkIOQg5CDkISQhJCEkISQhJCEkIWQhZCFkIWPhY+Fj4WPhY+Fj4WOhY6GjoaOho2GjYaNhoyGjIaMhoyGi4aLhouGi4aKhoqGioaJhomGiYaJhoiGiIaIhoiGh4aHhYeFh4WHhYeEh4SHhIeDh4OGg4aChoKGgoaBhoGFgYWAhYCEgIR/hH+Df4J+gn6BfoF9gH1/fH58fXt7e3p7eXt3enV6c3pwe258an1nf2SCYoViimKOZZFokmuSbZFukG+PcI5wjnCOcI5xjnGPco9zkHSQdpB3kHmPeo57jXyMfIp8iXuIe4d6hnmGeIV3hXaFdYV0hXOFcoVxhXCFb4Zuhm2HbIdrh2qIaYlpimiKaIpni2aNZo5nkGmRa5FukG+Ob4xuimyKa4xsjm6QcI9yjXSLdIl0h3OGc4VyhHGEcIRvhG+EboRtg2yDa4RqhGmFaYdpiGqJa4lsim2KbotvjHGMc412jXmNfIx+i4GKhIiGh4iFioSLgoyBjX+Ofo99j3yQe5B6kXqReZJ5knmSeJN4k3iUeZR5lHmVeZV5lnqWepZ6l3uYe5h7mXyafJp8oHqgeqB6oHqgeqB6oHqgeqF6oXuhe6F7oXuhe6F7oXuie6J7onuie6J7onuie6N7o3uje6N7o3uje6N7o3uje6N8o3yjfKN8o3yjfKN8o3yjfKN8pH2kfaR9pH6kfqR+pH6kfqR+pH+jf6N/o3+jf6N/on+if6J/on+hfqF+oX6hfqF+on6hfqF+oX6gfqB9n32ffZ99n3yffJ98n3yffJ98nnyefJ58nnude517nXudep16nXqdep15nXmceZx5nHmbeJp4mniaeJl4mXiYeJd4l3eWd5Z3lXaUdpR2k3aSdpF3j3iOeo57jn2Ne4l9iIGKgI6AkHyRfpJ/kn6SfpJ+kn6RfpF+kn6Sf5J/koCSgJKAkoGSgZKBkoKSgpKCkoOSg5ODk4OTg5ODk4SThJOEk4SShJKEkoSShJKEkoSShZKFkoWShZKFkYWRhZGFkYWRhZCFkIWQhZCFkIWPhY+Fj4WPhY+Fj4WOhY6FjoWOhY6FjoWOhY2EjYSNhI2EjYSNg42DjYONgo2CjIKMgYyBjIGMgYyAjICMgIt/i3+Lf4t/in6Kfol+iX2IfYh9h3yHfIZ8hXyEe4N7gnuBe397fnt8fHp9eX53f3WBdYN0hXWGdoh3iXiJeYl5iXqJeol7inuKe4p8inyKfYp9i36Lf4uAioGKgYqCiYKIg4iDh4OGgoaChYKFgYSAhICEf4R+hH6EfYR8hHyEe4V6hXmFeIZ4hneGdod2h3aIdoh1iXWKdop2ineLeIp5inmJeYl5iHmIeYh6iHuIfIh9h32GfoV+hH6DfoJ+gX6BfYF9gH2AfYB8gHyAe4B7gHqBeoF7gnuCfIJ8gn2CfoN/g4GDgoOEg4aDh4KJgouBjICOgI9/kX6SfZN8lHuUepV5lnmWeJd4l3eXd5h3mHeYd5l3mXead5p3mnebeJt4m3ibeZx5nHmdep56n3qfep96o3mkeaR5pHmkeaR5pHmkeaR5pHmkeaR5pHqkeqR6pHqkeqR6pHqleqV6pXule6V7pXule6V7pXule6V7pXule6V7pXume6Z7pnymfKZ8pnymfKZ8pn2mfaZ9pn6mfqZ+pn6mfqZ+pn6mfqZ/pn+mf6V+pX6lfqR+pH6kfqR+pH6kfqR+pH6kfqN+o32jfaJ9on2ifKJ8oXyhfKF8oXuhe6F7onyifKF7oXuge6B6oHqgeqB6oHmgeaB5oHmgeaB5n3ifeJ94nnieeJ54nnideJ14nHiaeJp3mXeZd5h2mHaXd5Z3lneWeJZ5lnmWeZZ5lXqUe5R+lX+Xf5d/l3+XfpZ+ln6VfpV+lX6Vf5V/lX+VgJWAlYCVgZWBlYGVgpWClYKVgpWClYOVg5WDlYOVg5WDlYOVhJWElYSVhJWElYSVhJWElYSVhJWFlYWVhZWFlIWUhZSFlIWUhZSFlIWThZOFk4SThJOEk4SThJOEk4SThJODk4OTg5ODk4OTg5KCkoKSgpKCkoGSgZKBkoCSgJKAkoCSf5J/kn+Sf5J+kn6RfpF+kX6QfZB9kH2PfI98jnyOfI18jXuMe4t7i3uKe4l7iHyHfIZ8hX2EfoR/g4CDgYOCg4ODg4SEhISFhYWFhYWGhoaGhoaGhoeGh4aHh4iHiIeJhomGiYaKhoqFioWKhYqEioSKg4qDiYOJg4iDiIOHg4eDhoOGg4WDhYSEhISEg4SChYKFgoWChoKGgoaChoKGgoaChoOGg4aDhoOFhIWEhYSFhYSFhIWEhoOGg4eCh4GIgYiAiH+Ifoh+iH2IfYl9iXyJfIl8iXyJfIl8iXyJfIl8iXyKfIp8i3yMfI18jnyPfJF8knyTe5R7lXqWepd5l3mYeJl4mnead5t2nHacdpx1nHWddZ11nnWedZ92n3afdqB2oHegd6F3oXiieKJ5o3mjeaN5o3mjeaN5p3end6d3p3end6d4p3ineKd4p3imeaZ5p3mnead5p3mmeaZ6p3qneqd6p3qneqd6p3qneqZ6pnqmeqd6p3qneqd7p3une6d7p3uoe6h8qHyofKh8qH2ofah9qH2ofqh+qH6ofqh+qH6ofqh+qH6ofqh+p36nfqd+p36nfqZ+pn6mfqZ+pn2mfaV9pX2lfaV8pHykfKR7pHuke6R7pHuke6R7pHuke6R7pHqjeqN6o3qjeaN5o3mjeaN5o3ijeKN4oniieKJ4oniieKJ4oXiheKF4oHefd553nneddpx2nHabdpt3m3ead5p4mniaeJp5mXqYe5d8mHyZfZl+mX+Zfpl+mH6Yfph+mH6Yf5h/mH+YgJeAl4CXgZeBl4GXgZeCl4KXgpeCl4KXgpeCl4OXg5eDl4OYg5iDmIOXhJeEl4SXhJeEl4SXhJeEl4SYhJiEmISYhJeEl4SXhJeEl4SXhJeEl4OXg5eDl4OXg5eDl4OXgpeCl4KXgpeBl4GXgZeBl4GXgJeAmICYgJh/mH+Yf5h/mH+Yfph+mH6Yfph9mH2XfZd9l32XfJZ8lnyWfJZ8lXuVe5R7lHuUe5N7k3uSe5F7kXuQfJB8j3yPfY59jn6Of41/joCOgI6BjoGPgo+Cj4KPg4+Dj4OQg5CEkISQhJCEkISQhJCEkYORg5GDkYORgpGCkYKRgpGBkIGQgZCBj4GPgY+CjoKOgo6CjYONg4yDjIOMg4uDi4OLg4yDjIOMg4yDjIONg42DjYONg42CjYKNgo2CjoGOgY+Aj4CPgI9/j3+QfpB9kH2QfJB7kXuRepF6knqSepJ5knmSeZN5k3mTeZN4k3iTeJR4lXiVeJZ4l3iYeJl3mXead5t3m3acdp11nXWedJ50n3Sgc6FzonSidKJ0onSidKN0o3SkdKR1pHWldaV2pnamdqd3p3eoeKh4p3ineKZ4pnemd6d3qXapdql2qXapd6l3qXepeKl4qXipeKl4qXmpeal5qXmpeah5qHmoeah5qHqoeqh6qHqneqd5p3mnead6qHqoeqh6qHqoe6h7qXupe6l8qXypfKl8qX2pfal9qX2pfal+qX6pfql+qX6pfql+qX6qfql+qX6ofqh+qH2ofah9qH2ofah9qH2nfad9p3ynfKd8pnyme6Z7pnune6d7p3une6d7p3ume6Z6pnqmeaZ5pnmmeaZ5pXileKZ4pnimeKZ4pXileKV4pXileKV3pHekd6R3pHejd6N3oXehdqB3oHefd593nnedd513nXideJ15nXqcepx7nHycfZx+nH6bfpt+m36bf5t/m3+af5uAmoCagJqAmoGZgZmBmYGagZmCmYKZgpmCmYKZgpqCmoKagpqCmoOag5uDm4SahJqEmoSahJqEmoSag5qDmoOag5qDmoOag5qDmoOag5qDmoOag5uDm4KbgpuCm4KbgpuCm4GbgZuBm4GbgJyAnICcgJx/nH+cf5x/nH6cfp1+nX6dfp1+nX2dfZ19nX2dfZ19nXydfJ18nXycfJx7nHuce5x7nHube5t6m3qaepp6mnqZepl7mXuYe5h7l3yXfJd8ln2WfZZ+ln6WfpZ/ln+Xf5eAl4CXgZeBl4GXgZeCl4KXgpeCl4KXgpeCl4GXgZeBl4GXgZeAl4CXgJeAl4CXgJeAloCWgJaBl4GWgpaClYKVgpSClIGUgZSBlIGUgZSBlIGUgZSBlIGVgZWBlYCVgJWAlYCVf5V/lX+WfpZ+ln2XfZd9l3yXe5d7l3qXeZd5mHmYeJh4mXeZd5l3mnead5p2mnabdpt2m3WbdZt1nHWcdZ11nXSedJ90oHSgc6FzoXOhcqFyonGicaNxpHGlcaZxpnKmcqZyp3KncqdzqHOpdKl0qXWpdal1qnardqt3q3erd6t3qneqdql2qXaqdqp2rHardqt2q3asdqx3rHesd6t3q3ireKt4q3ireKt5qnmqeap5qnmqeal5qXmpeal5qXmoeah5qHmoeah5qHmoeql6qXqpeql7qXuqe6p8qnyqfKp8qn2qfap9qn2qfqp+qn6qfqp+qn+rf6t/q3+rf6p+qn6qfqp+qX2pfal9qX2pfal9qX2pfal8qXypfKh8qHupe6l7qXupe6l7qXupe6l6qHqoeqh6qHmoeah5qHineKd4qHioeKh4qHioeKh4qHiod6h3qHeod6d3p3andqd2p3andqZ2pneld6V3pHejd6J3oXegd593n3ifeJ95n3qfep97nnyefJ59nn6efp5/nX+df52AnYCdgJ2AnYGdgZyBnIGcgZyBnIGcgZyBnIGcgZyCnIKcgpyCnIKcgpyCnIKcgp2DnYOdg52DnIOcg5yDnIOcg5yDnIOcg5yDnIOdgp2CnYKdgp2CnYKegp6CnoGegZ6BnoGegJ+An4CfgJ9/n3+ff6B/oH6gfqB+oH6hfaF9oX2hfaF9oXyifKJ8onyifKJ8onyifKN8o3yie6J7onuie6J7onqieqF6oXqheqF6oXqgeqB6oHqgeqB6n3qfep97n3uee557nnydfJ18nX2dfZ19nX2dfp5+nn+ef55/noCegJ6AnoCegJ6AnoCegJ6AnoCdf51/nX+df51/nX+df51/nX+df51/nX+df56AnoCdgZ2BnICcgJuAm4CbgJt/mn+af5p/mn+af5t/m36bfpx+nH6cfpx+nH2cfZx9nHycfJ18nXude516nXqdeZ14nXied553nnaedp52n3WfdZ91oHWgdKB0oHSgc6BzoXOhc6FzoXKicqJyo3KjcqRxpHGkcKVwpXClb6VvpW+mb6dvqG+pcKlwqXCqcapxq3GqcqtyrXKuc65zrXSudK51rnWvdq92r3audq52rXasdqx1rHWtda11rnWtda12rnaudq13rXetd613rHesd6x4rHiseKx4q3ireat5q3mreap5qnmpeal5qXmpeah5qHmoeah5qHmoeah6qXqpeql7qXuqe6p8qnyqfKp8qn2qfap9qn6rfqt+q3+rf6t/q3+rf6t/q3+rfqt+q36rfqt+q32rfat9q32rfat9q32qfKp8qnyqfKp8qnure6t7q3uqe6p6qnqqeqp6qnqqeap5qXmpeal4qXipeKl4qXiqeKp4qniqd6p3qneqd6l2qXapdql2qXapdql2qnWqdqp2qnapdql2qHend6Z4pXikeKJ5onmheqF6oHqge6B7oHygfaB9oH6gfp9/n3+ff5+An4CfgJ+Bn4GfgZ+Bn4GfgZ+Bn4GegZ6BnoGegZ6CnoKegp6CnoKegp6CnoKegp+CoIKgg5+Dn4Ofg5+Dn4Ofg5+Dn4Ofgp+Cn4Kfgp+Cn4KggaCBoIGggaGBoYChgKGAooCif6J/on+ifqJ+o36jfqN9o32kfaR9pHykfKV8pXylfKV7pXume6Z7pnune6d7p3qneqd6p3qoeqd6p3qneqd6p3qneqZ5pnmmeaZ5pnmleaV5pXmleaV5pXmleaV6pXqleqR6pHuke6R7pHuke6R8pHykfKR9pH2kfaR+pH6lfqV/pH+kf6R/pH+jf6N+o36jfqN+on6jfqN+o36jfqN+on6ifqJ+o36jf6R/pICjgKN/on+if6F/oX6hfqB+oH2gfaB9oH2gfaB9oH2hfKF8oXyhfKF8onuie6J7onqieqJ6onmjeaN4o3ijd6N2o3ajdaN1o3SkdKR0pHSkc6RzpHOkcqVypXKlcaVxpXGlcaZxpnGncKdwp3Cnb6dvp26nbqdup22nbadtqW2qbqpuqm+rb6twq3CscK1wrnGtca1xrnGvcrBysHOxc7F0sXSydbJ1sXWxdbB1sHWvda51rnWuda51r3Wvda92r3avdq53rneud613rXetd613rXiteKx5rHmseat5q3mreap5qnmqeap5qXmpeql6qHqoeah5qHqoeqh6qHqoeql7qXupe6l8qnyqfap+qn6qfqp+qn6rfqt/q3+sf6x/rH+sfqx+rH6sfqx+q36rfqt+q32rfax9q32rfax9rHysfKx8rHysfKx7rHuse6x7rHqseqt6q3qreqt5q3mreat5q3mqeKp4qniqeKt4q3ird6t3q3erd6t3q3ardqt2qnaqdat1q3Wrdat0rHSsdKx0rXStda11rHereKp5qHqneqZ6pXuke6N8onyifKF9oH2gfaF9oX6hf6F/oX+hgKCAoIChgKGAoYCggKGAoYChgaGBoYGhgaGBoYGhgaGBoYGhgaGBoIGggaCBoIGhgaGBo4KjgqKCooKigqKCooKigqKCoYKhgqGCoYKigaKBooGigaKBo4CjgKOAo3+kf6R/pH6lfqV+pX2lfaV9pnymfKZ8p3ynfKd7qHuoe6h7qHupe6l6qXqpeql6qnqqeat5q3mreax5rHmseax5rHmseax5rHmreat4q3ireKp4qniqeKl4qXiqeKp4qniqeKp4qnmqeap5qnmpeql6qXqpeql7qXupe6l8qnyqfKp9qn2qfap9qn6pfal9qX2pfah9qH2ofad9p32nfad8qH2ofad9p32ofah+qX6pf6l/qH+ofqd+p36mfaZ9pn2mfaV8pXylfKV8pHyke6R7pXule6Z7pnqmeqZ6pnqmead5p3mneKd4qHeod6h2qHaodah0qHSodKhzqHOoc6hyqHKocqhxqHGocahwqXCpcKlwqXCpb6lvqW+qb6puqm6qbaltqWypbKlsqWypa6psrG2sbqxurG+tb61vrXCtcK5wrnGtcK1wrnCvcbFxs3Kzc7N0s3SzdLN0snSydLJ0snSxdLB0r3SvdK90sXWxdrB2sHevd693rneud613rXetd614rXitea15rHmreat5qnmqeap5qnqqeqp6qnqpe6l7qHqoeqh6qHuoe6h7p3une6d7qHypfKp+q3+rf6t/q3+qf6l/qX6qfqt+q36rfqt+q36sfqx+rH6sfqx+rH6sfqx+rH2sfax9rH2sfKx8rHysfKx8rXute617rXuse616rXqteqx6rHmseax5rHmseax4rHiseKx4q3ireKx3rHesd6x3rHardqt2rHardqt1q3WrdKt0rHSsc6xzrXKucq5yr3Kwc7F1sXeveqx7qXynfKZ8pXylfKV9pH2kfqN+on6ifqF+on+if6J/ooCigKKAoYCigKKAooCigKKAooCigKKAon+jf6N/pICkgKSBo4GjgaOAooCigKKAo4CjgaWBpYKkgqSBpIGkgaWCpYKkgqSBpIGkgaSBpIGkgKSApIClgKV/pX+lf6Z+pn6mfqd9p32nfah8qHyofKh8qHupe6l7qXuqeqp6qnqreqt6q3qseax5rHmseax5rHiteK14rniveK94sHiweLB4sHiveK94r3iveK93r3eud653rnetd613rXetd613rneud653rneueK54rniueK54rnmuea56rnqueq57rnuue658rnyufK58rnyufK58rnytfK18rHysfKt8q3yre6t7q3ure6x7rHytfa59rn6ufq1+rH2sfat9q32qfKp8qnyqfKp8qnyqfKl8qHuoeqh6qHmpeal5qnmqeap4qniqeKt3q3erdqx2rHasdax1q3SsdKxzrHOscqxyrHKscaxxrHGscaxwq3CscKxwrG+sb6xvrG6sbqxurG6sbaxtq2yrbKtrq2ura6prqmura61srm2ubq1vrW+ub65wr3Cuca5xrXGtcK1wrnCwcbJys3O0dLN0snSydLJ0snOyc7JzsnSxdLF0sHSwdLB0snaxd7B3r3evd694rniteKx4rHeseKx4rHiseax5q3mreat5q3qqeqp6qnuqe6p7qXupe6h7qHuofKh8p3ynfKd8p3ynfah9qX6qf6t/qn+qf6p/qn+pfql+qX6pfql+qn6qfqt+rH+sf6x/rX+tf61+rX6sfqx9rH2sfKx8rHyse617rXute617rXute617rXuteq16rXqteq15rXmtea15rXiteK14rXiteKx4rHesd6x3rHesdqx2rHasdqx1rHWsdax0rHSsc6xzrHKscq1xrnCub69vsG6xb61yqHinfKZ9pH6kfaR8pHykfKR9pX2lfqV+pH+jf6N/o3+jf6N/o3+jgKN/on+if6N/o3+jf6N/o3+jf6N/o36kfqV9pn6mf6WApICkgKR/pH+kf6R/pYCmgaeBpoGmgaaBpoGngaeBp4GngaeAp4CngKeAp3+nf6d/p3+nfqd+p36ofah9qH2pfKl8qXypfKp7qnure6t7q3qreqt6q3qseax5rHmtea15rnmueK54rniveK94r3evd7B3sHexd7J3sneyd7J3sneyd7J3sneyd7J3sneyd7J3snexd7B2sHawdrB2sHawdrF2sXaxdrF3sXexd7F3sniyeLJ5snmyebJ6snqyerJ6snuye7F7sXuxe7J7snuye7F7sXuwe697sHuwe697rnuueq96sHuxe7F8sXyxfLF8sHywfK98r3yufK58rnyvfK98rnyte617rHqseat5q3ireKx4rXitd613rXetdq12rnWvda91sHSvdK90r3Ovc69yr3Kvcq9xr3Gvca9wr3CucK5wr3Cvb69vr2+ubq5urm2uba5trm2tba1srGysa6xrrGura6tqq2utbK9tsG6vb65vr2+wcLBxsXGwca9xrXGscK1wrnGwcrJztHS0dLN0snSxdLF0sXOxc7FzsXOxc7BzsHSxdLJ1sXaxd7B4r3iueK14rXiseKx5q3mqeap5qnmreap5qnqqeqp7qnuqe6p7qXypfKl8qXypfKh8qH2nfad9p32nfah+qH6of6l/qX+pf6l/qX+pfql+qX6pfqh+qH6pfql+qn+rf6yArICsf6x/rH6sfqx9rH2sfKx8q3ure6x7rHute657rnuue617rXuteq56rXqteq16rXmtea15rXmtea14rXiteK14rXitd613rXesd6x2rHasdqx2rHasdax1rHWsdKx0rHOsc6xyrHGtcK1vrm6vbK5spXCVdox7jXuQepd5nnijeqN8o3yjfKR9pH2kfqR+pH6kfqR+o36jfqR+pH+kf6N/o3+jf6R/pH+kf6R/pH+jf6N/on6ffZt8nHugfaJ+o36kfqR+pX6lf6Z/p4CogKiAqICogKiAqICpgKmAqYCpgKl/qX+pf6l+qX6pfql9qX2pfKl8qXyqfKp8qnure6t7q3ure6t6rHqseqx6rXmtea15rXmteK14rniueK94r3ewd7B3sHewd7F3sXexdrF2sXaydrN2tHa0drV2tHa0drR2tHa0drV2tHa0drR2tHazdrN2snWydbJ1snWydbN1s3W0drR2tHa0d7R3tHe1eLR4tHi0ebR5tHm0ebV5tXq1erV6tXq1erV6tHq0erR6s3qzerN6s3qzerJ6sXqwebF5snqzerN6tHu1e7R8tHyzfLN8snyyfLF8snyye7F7sHuweq95r3mveK54rneud693r3ewd7B2r3avda91sHSwdLFzsnOyc7JzsnKycrFysXGxcbFxsXCxcLFwsXCxcLFwsW+wb7BusG6wbq9tr22vba9tr22ubK1srGusa6xrrGusa6xrrWyvbbFvsXCvcK9wr3CwcLBwsHGvca5xrnGtca1xr3Kxc7J0s3SydLJ0snSxdLBzsHOvc69zr3Ovc690r3SwdLB1rnevd694rnmuea15rHmseqx6q3qqeql6qXqpeql6qXupe6l7qXypfKl8qX2ofah9qH2ofah9qH6nfqd+p36of6h/qH+of6h/qH+nf6d+qH6ofqh+qH+of6l/qX+pf6qAq4CrgKt/q3+rfqt+q32rfat9q3yrfKt7q3ure6t6rHqteq57rnuue616rXqteq16rXqtea15rXmtea15rXmteK14rXiteK13rXetd6x3rHesdqx2rHasdqx2rHWrdat1q3WrdKtzq3OrcqxxrHCsb61trWuraJd0k3mXeJ17oHykd6d1pnekeaN6onuie6N8o32jfaN+o36jfaN9pH2kfaR+pH6kfqR+o36kfqR+pH6kfqR+pH6kfqR+o3+igaaApXmkeqR7pHykfaV9pX6mfqd/qH+ogKmAqYCpgKqAqoCqf6p/qn+qfqp+qn6qfap9qn2qfKp8qnure6t7q3ure6x6rHqseqx6rXqteq16rXmtea55rnmueK54r3iueK54r3evd693sHewdrF2sXaxdrJ2snaydbJ1snWzdbR1tXW1dbZ2tna2drZ2tna2dbZ2tna2drZ2tXW1dbR1tHW0dLR0tHS0dLR1tXW2drZ2tna1d7V3tne2d7Z3tni2eLZ4tni2ebZ5tnm2ebZ5t3m3ebd6tnq2ebZ5tXm1ebV5tXm0ebR5s3myeLJ4s3izeLV5tnq3e7d8tny2fLV8tXy1fLR8tHuze7N6snqyebJ5snmxeLF4sHewd7F3sXaxdrF2sXWxdbF0sXOxc7Jys3KzcrNys3KzcbNxs3GzcbNxs3CzcLNws3CzcLJvsm+yb7FusW6xbrBtsG2wbbBtsG2vbK1srWuta61srGysbK1tr26xb7JwsHCvcK5wr3CwcLBxsHGvca5xrnGucq9ysHOxc7F0sXSwdLB0sHSvc69zr3Ouc650rXStdK10rXSuda52rHiseKx5rHmseqx6q3qre6p7qXuoe6h7p3uoe6h8qHynfKd8p3yofah9p32nfad9p36ofqh/qH+of6d/p3+nf6d/pn+mfqd+p3+nf6d/p3+nf6h/qH+of6l/qX+qf6p/qn+qfqp+qn6qfat9q32rfKt8q3yre6t7qnqqeqt6q3qteq16rXqteq16rXqteq15rXmtea15rXmtea15rXiteK14rXitd6x3rHesd6x3rHesdqx2q3ardqt2q3ardat1q3WqdKp0qnOqcqpxq2+rbaxqrGafa5F4mnieeZ99onyleqV6pXqjeqJ6onuhe6F7on2ifaJ9on2ifKN8o3ykfKR9pH2kfaR9o32jfKN9pH2kfaR9pH2kfqV+pX+mf6d+p32nfKZ8pXylfKZ8pn2nfqh+qX+pf6p/qn+qf6t/q3+rfqt+q36rfqt9q32rfKt8q3yre6t7q3qseqx6rHqseq16rXqteq56rnqueq55rnmvebB5sHmwebB5sHmweK94r3ewd7B2sXaxdrF2snaydrJ1snWydbN1s3WzdLR1tXW2dbd1tna2dbZ1tnW2dbd1t3W3dbZ1tnW1dLV0tXS1dLV0tXS1dLZ1t3W3drd2t3e3d7Z3tne2d7Z3t3e3d7d4t3i3eLd4t3i3ebd5t3m4ebh5t3m3ebd5t3m3ebZ5tnm1eLV4tHi0eLR4tHi1ebd6uXu5fLl8uHy4fLh8uHy3fLd8tnu1e7R6tHq0ebR5tHizeLN4s3ezd7N3snaydrJ1snWydLJ0snOyc7JysnKzcrNxs3G0cbRxtHG0cbRwtHC0cLRws3CzcLNvs2+zb7Jusm6ybrFusW6wbbBtr22vba5srWyubK5trW6tbq5vsG+xcLFxr3Guca5wr3Gvca9yrnKucq5yrnKuc65zrnOvc690r3SudK50rXStdKxzrHSsdKx0q3SqdKp0q3Wrdqt3qXipeal6qXqpe6l7qXuofKd7pnume6V7pXumfKZ8pn2lfaV9pX2mfaZ9pn6mfqZ+pn+nf6d/p3+nf6d/pn+mf6Z/pX+mfqZ/p3+nf6d/p3+nf6d/p3+of6h/qH6pfql+qX6pfal9qn2qfap9qnyqfKp7qnuqe6p6qnqpeqp6qnqreqx6rHqseqx6rHqseax5rHmseax5rHmseax4rHiseKx4rHisd6x3rHesd6x3q3erd6t3q3ardqp2qnaqdqp1qnWpdal0qXOpcqlxqG6oa6dmoGWSb458mX2cfpx/nH6ffaB9oHygfKB7oHufe518m3ybe557oHuhe6J7onuje6N8o3yjfKN8o3yjfKN9pH2kfqR+pH6kfaV+pn6mfqd+p36nfaZ9pnymfKd8p32ofal+qn6qf6p+qn6rfqt+q36rfqt9rH2sfax9rHysfKx8rHuse6t6rHqseq16rXmtea55rnmvea95sHmwebB5sHmwebB5sXixeLF4sXixeLB3r3evdrB2sXaydrJ2snaydrJ2snWydbN1s3S0dbR1tXW2dbd1t3a2drZ2tnW2dbZ1tnW2dbZ1tXW1dLV0tXS1dLZ0tnS2dLZ1t3W4drh2t3a3drd2t3a3drd3t3e4d7h3uHi4eLh4uHi4ebh4uHi4eLh4uHi4eLd4t3i3eLZ4tni2eLZ4tXi2eLd5t3q3erl7uny6fLp9un25fLl8uXy5fLh8t3y2e7Z7tXq1ebV5tXi1eLV3tHe0d7R2s3azdbN1s3SzdLN0snOyc7JysnKycrNys3K0crRytHK0cbRxtHG1cbRxtHCzcLNws3Cyb7Jvsm+ybrFusW6wbrBur26vba5trm6vb69vrnCtcK5wsHGwca9xrnGtca5xrnKucq5zrXOtc61zrHSsdKt0q3SsdKx0rHSsdKt0qnSqdKp0qnSqdal1qHWndad1p3aod6h4pXmleqZ6pnumfKZ8pn2lfaR9o3yjfKR8pH2kfaR+pH6jfaN9o32kfaR+pX6lf6V/pX+lf6V/pX+lf6V/pX+lf6V/pX+lfqV/pn+mfqZ+pn6mfqZ+pn6mfqd+p36nfad9qH2ofah9qH2ofKh8qXype6l7qXupe6l6qXqoeqh6qXmpeap5q3qreqt6q3qreat5q3mreat5q3mreat4q3ireKt4q3ireKt3q3erd6t3qneqd6p3qneqd6p3qXapdql2qXaodah1qHSnc6dxpm+ka6FljWyGd4d7kHqWepl9ln6YfZp9m32cfJ18nXuee597oHuheqF6oHqheqF6oXqie6J7onuifKJ8o32jfaN9o36kfqR+o36jfaR9pX6mfqd/p36mfqZ9pn2nfad9qH2ofal+qX6qfqp+q36rfqt9q32rfax9rH2sfKx8rHysfKx7rHuseqx6rHmsea15rXmtea55rnmvebB5sHmxebF5sHmweLB4sXixeLF3snexd7F3sHaxdrF2snezd7N3snaydrJ1snWzdbN1s3WzdbN1tHW1dbZ2t3a2drV2tXa1dbV1tXW2dbV1tXW0dLR0tXS1dLZ1tXW2dbZ1tnW3drd2t3a3drd2t3a3drd2t3e3d7h3uHi4eLh4uHi3eLd4t3e3d7d2uHa3eLZ5tni2eLZ3tne2d7d4uHm5erl7uXu5e7p8uny7fbp9un26fbp9un26fbp9uXy3fLZ7tnq1ebV5tXi1eLV3tXe1drV2tHW0dbR1tHS0dLN0s3Oyc7JzsnOzc7NztHS1dLV0tHO0c7RytHK0crRxtHGzcbNxs3CycLJwsW+xb7BvsG+wbq9ur26vb69vsHCwcLBxrnGtca1xrnGucq1yrHKscqxyrXOtc6x0rHSrdKt0qnWqdal1qHWodal1qXWpdah1p3Wndad1p3WmdqZ2pXakdqR3o3ekeKR4oHqheqJ7o3yjfaR+o36jfqJ+oX6hfqJ+on6ifqJ+oX6hfaF+oX6ifqN/o3+jf6N/o3+jf6N/o3+jf6N/o3+jf6N/o36jfqR+pH6kfqR+pH6kfqR9pH2lfaV9pX2lfaZ9pn2mfKZ8pnynfKd8p3une6d7p3une6d6p3qneqd6p3qoeql6qXqpeqp6qnqqeqp5qnmqeap5qnmqeap5qniqeKp4qniqeKp4qniqeKp4qXipeKl3qXepd6l3qHeod6h3qHandqd2pnWmdKVzo3CgbZhohHSFeY55knmVepZ7lXyUfZV8l3yZe5p7m3ucep16nnqeeZ95n3mfeaB5oHqhe6J8on2ifaJ+on+if6N/on+if6J+on6ifqJ9o36lfqV/pX6mfqZ+p36nfqd+p36ofah9qX2pfap9qn2qfap9qnyrfKt8rHysfKx8rHyte6x7rHuseqx5q3mseK15rnmvea95r3qwerF6sXqxebF5sXmxeLB4sXexd7F3sneyd7F3sXaydrN3tHezd7J2snaydrJ1snWydbJ1s3WzdrN2s3a0drV2tne2d7R3s3azdrN1tHW0dbR1tHW0dbR1tHW0dbV1tXW0dbV1tXW1dbV1tnW2drZ2t3a3drd3t3e3d7d4t3i3eLd4tni2eLZ4tni1d7N1qnepebB3s3e0d7V3tni3ebh5uHq5e7l7uXu5e7p8u3y7fbp9un27fbt9u327fbp9uXy4e7d7t3q2ebZ4tni2d7V3tXe1drV2tXW0dbR1tHW0dbR1tHS0dLR1tHW0dbV1tXW1dbV0tHSzc7Nzs3K0crRytHKzcrNxsnGycbFwsXCwcLBwr2+vb69vr3CvcK9wsHGvca9xrXGtca1yrXKscqtzqnOqc6p0qnSqdap1qXWpdah2p3andqZ2pnamdqZ2pnamdqR2pHWkdqN2o3ajd6J3oXiheKB4oHmgeaB6nHycfJ59n32gfqF/oH+gf6B/n36ffp9+n36ffp5+nn2ffp9+oH6gf6B/oH+gf6F/oX+hf6F/oX+hf6F/oX+hf6F+on6ifqJ+on6ifqJ9on2ifaN9o32jfaN9o32jfaR9pHykfKR8pXylfKV7pXule6Z7pnume6Z6pnqmeqZ6pnqneqd6p3qoeqh6qHqoeql6qXqpeql5qXmpeal5qXmpeal5qXipeKl4qXipeKh4qHioeKh4qHioeKd4p3ind6d3p3emd6Z3pXakdqN1oXOecZJwhXWEe4d3lnaUdZt2mH2UfZJ8k3qWeph6mXmaeZp5m3iceJ14nXieeZ96oHuifaN+o3+jgKOAo4GjgaOBo4GigaKAooCjgKSBpIGkgaSApICkf6V/pn6mfqZ+p32nfad9qH2ofal9qX2pfKp8qn2rfat9q3ysfKx8rHysfKx7rHqreat5q3ireKx4rniwebB5sHqxerF5sXmxebF4sXixeLF4sHewd7F3sneyd7J3sXaydrN3s3eydrJ2snaydrJ2sXaxdrF2snaydrJ2snezd7R3tni1eLN4snexdrF2sXaydrJ1snWydbJ1snWzdbN1s3WzdbN1s3WzdbR1tHW0drV2tXa2d7Z3tni2eLZ4tnm1ebR4tHi0eLR4tXm1ebN7snm1dLR0s3W0drV4tnm3erd6t3u4e7h7uHu5fLl8uny6fbp9u327frt+u326fbl8uXu4e7d6t3m2ebZ4tni2d7V3tXe1drV2tHa0drR2tHa0drR2tXa1drV2tXa1drR1tHW0dLR0s3Ozc7Nzs3O0c7Rzs3KzcrNysnGycbFxsXGwcK9wr3CucK5wrnGuca5xrnKtcqxyrHKsc6tzq3OqdKl0qXWodah1qHandqd3pneld6V3pHekd6N3o3ejd6N3o3ekdqJ3oHefd553nnieeJ15nXmceZx6nHqde518mX2Zfpp+nH+df51/nX+cf5x+nH6cfpx+nH6cfpx+nH6cfp1+nX+df51/nX+ef55/nn+ef55/n3+ff59/n3+ffp9+oH6gfqB+oH6gfaB9oH2hfaF9oX2hfaF9oX2hfaJ8onyifKJ8o3yjfKN7o3uje6R7pHuke6R7pHuke6V7pXuleqV6pnqmeqd6p3qneqd6p3qneqd6p3qnead5p3mnead5p3mnead5p3mnead5p3mnead4p3imeKZ4pnimeKZ4pnileKV4pHijeKJ3oHaddJlzi3OFeYZ9kXuTeJp4l3yTe5J7knmVd5d4mHiYeJh3mXeadpx3nXieep97oX2ifqN/o4CigKKAooCigKOAo4CjgKOAo4CkgKSApICkgKWApICkf6R/pH6kfqV9pn2mfaZ9pn2nfKd8qHypfKl9qn2rfat9q32rfat8q3yre6p6qnmqeap4qniqd6t3rXivebB5sHmwebB4sHixeLF4snixeLB3sHewd7B3sXeyd7F3sXexd7J3snaxdrJ2sXexd7F3sXewd7B3sHexd7B3sHexd7J4s3izeLJ4sXexd7B3r3evdq92r3awdbB1sHWxdrF2sXaxdrF2sHWwdbF1snWydrJ2s3a0d7V4tXi1ebV5tHq0erN6s3qyerF5snmzerN6tHq1ebR4s3e0eLV5tnu1e7V7tny2fLZ8tny3fLh8uX25fbp9un66fbp9uX25fLh8uHu3erd6tnm2eLZ4tni1eLV3tXe1d7V4tXi1eLV4tHi0d7R3tXe1d7V3tHe0drN2s3WzdbN0snSydLJ0snOzc7NzsnOycrFysXGwcbBxr3Gvca5xrnGtca1xrXKscqxyq3Orc6tzqnSqdKl1qXWndqd2p3emd6V3pXikeKN4o3iieaF5oXmgeaB5n3mfeZ94n3egdp93m3qYepd5mHmYeph7mHuXe5h8mHyZfZl9ln6Wfpd/mH+Zf5l/mX+Zf5l/mX6Zfpl+mX6Zfpl+mn6afpp/mn+af5t/m3+bf5t/m3+cf5x/nH+cf5x/nX+dfp1+nX6dfp5+nn6efp5+nn6efp9+n32ffZ99n32gfaB9oHygfKB8oXyhfKF8oXyhfKJ8onuie6J7onuie6N7o3uje6R7pHuke6V7pXule6V6pXqleqV6pXqleqV6pXmmeaZ5pnmmeaZ5pnmmeaZ5pnmmeaV5pXmleaV5pXqleqV6pHqkeqN6o3qieaF5n3mcd5Z1iXeCe4Z7kHqZdpl4mXmXe5R4lHaVd5Z3l3eXd5d3l3aYdpt3nHmdep97oH2hfqF+oX+hf6F/oX+hf6F/on+if6J/on+jf6N/o3+jf6N+pH6jfqN+o32jfaR9pH2lfaV9pX2mfaZ9p32ofah9qX2pfap9qn2qfKl8qXupeql5qXipeKp4qniqeKt4rHmtea55r3mvea94r3iveLB3sXiweLB3r3evd7B2sXeyd7J4sXiwd7B3sHexd7F4sXiweK94r3iveK94rniueK54rniveLB4sHmwea94r3ivd653rXesdqx2rXatdq52rnavdq92r3avdq52rXWuda92r3avdq92sHeyeLJ5s3mzerN7s3yzfLJ8sHyvfK57rnqverB6sXqyerJ6s3q0e7Z8tn21frR+s320fbR9tH21fbd9uH24frl+uH64fbh9uHy4fLh8t3u2e7Z6tXm1ebZ5tnm1ebV5tHm1ebV5tnm2ebZ5tXm0ebR4tHi1d7R3s3ezdrN2snaydbF1sXWxdLF0sXSxdLBzsHOvc69yr3Kucq5yrXKtcqxyrHKscqtyq3Oqc6p0qXSpdal1qHWodqh3p3emeKV4pHmjeaJ5oXmgeqB6n3qfep57nnude5x7nHube5p6mXeZc5Z6jnuPfI57j3qRe5F8kn2SfZN9lH2UfpV+kn6TfpR/lX+Vf5V/lX+Wf5Z/ln+Wf5Z/l3+Xf5d+l36Xf5d/mH+Yf5h/mH+Yf5h/mX+Zf5l/mX+af5p/mn+af5t/m36bfpt+m36cfpx+nH6cfpx+nX6dfp19nX2dfZ59nn2efJ58nnyffJ98n3yffKB8oHygfKB8oXyhe6F7oXuie6J7onuie6N7o3uje6N7o3ujeqN6o3qkeqR6pHqkeqR6pHqkeqR6pHqkeqR6pHqkeqR6pHqkeqR6pHqke6N7o3uje6J7oXuhe597nnuce5d6jXqEeYd7knmdeJt3l3uZe5N6k3iUeJV3lXeVd5V2lXWWdpl3m3mcep17nn2ffZ9+n36ffp9+n36ffp9+oH6gfqB+oX6hfqF+oX6ifqJ9on2ifaJ9on2ifaJ9o32jfaN9pH2lfaV9pn2nfqd+qH6ofal9qH2ofKh7p3qneah5qHmoeal5qXmqeqt6q3qseqx5rXmtea15rXiueK94sHiweK94rXeud693sHexeLF4r3iveK94r3iwea96rnmtea15rXmteqx6q3qreat5rHmsea16rXqseax5q3ireKt3qnepdqp2qnardqt2q3ardqt2q3ardqp2qnWrdqt2q3esd6x3rXiuebB6sXuxfLF9sn2yfrF+rn6tfax9rHyre6x7r3ywfLF9sX2yfbR+tX60frN+sn6xfbF9sn2zfbV9tn62frZ9tn22fbZ9tny2fLZ8tnu1e7R6tHq0erV6tnu3e7Z7tHu0e7R6tXq2erV5tHmzeLN4s3izd7J3sneyd7F2sXawdrB1sHWvda91r3SudK50rnOtc61zrHOsc6tzq3Oqc6pzqXOpdKl0qHSodad1p3amdqZ3pnemd6Z4pXmkeaN6oXqge557nnude5x8nHycfJt8m32afZl9mX2YfZZ9k3uLdoV5hnmHfIZ8hXuHfIp9i32NfY59j32QfZF+j36PfpB/kX+Sf5N/k3+Tf5N/k3+Tf5R/lH+Uf5R/lH+Vf5V/lX+Vf5V/lX+Wf5Z/ln+Wf5eAl4CXgJd/mH+Yf5h/mH+Yf5l/mX+Zf5l/mn6afpp+mn6bfpt+m36bfZx9nH2cfZx9nX2dfZ19nX2dfZ58nnyefJ58n3yffJ98n3yge6B7oHuge6F7oXuhe6F7oXuhe6J7onuieqJ6onqieqJ6onqieqJ6o3qje6N7o3uje6N7o3uje6N7onuifKJ8onyhfKF9oH2ffZ5+nX6bfpl9kXyHdoR7j3qWdpl5lX2VfpR8knyQeZJ3k3eTdpN2knWUdZd3mXiaepx7nX2dfZ1+nX6dfp1+nH6cfZ19nX2efZ59nn2ffZ99n32ffZ99oH2gfaB9oX2hfaJ+oX2hfaJ9o32jfqR+pX6mfqZ+pn2nfad8p3yme6Z6pnqmeah6qXqpe6p7qnuqe6t7q3qreqt6q3msea15rXmuea95r3mueK14rHisd613rniveK54rnmuea56r3que617rHure6t7q3yrfKl8qHuoe6h7qHupe6l7qXqpeqh5p3mneKd4pnemd6Z3p3end6d3p3end6d3p3amdqZ2p3aod6h3qHipeKl5qnqse618rn2vfq9/sH+wf7B/rn+sf6t+qn6qfat9rX6vfrB+r3+wfrF+sn6xfrF9sH2wfbB9sH2xfbJ9s36zfbR9tH20fbR9tHy0fLR8tHy0e7N7tHu0fLV8tny2fLV8tHu0e7R6tHqzerN5snmyeLF4sXixeLB4sHewd693rneudq52rXatdqx1rHWsdat0q3SrdKp0qXSpdKl0qHSodKd0p3WmdaV2pXakd6R3o3ijeKJ4oniieKN4onqhe598nnycfJt9mn2afZl9mX2YfZh+mH6Xfpd/ln+VgJSAkoCOf4V9gn2Ee4V8f3x+e4J8hnyIfIp8i3yNfY59jX6Nf45/jn+Pf5B/kH+Qf5B/kX+Rf5F/kX+Rf5J/kn+Sf5J/k3+Tf5N/k4CTgJOAlICUgJSAlICVgJWAlYCVf5V/ln+Wf5Z/l3+Xf5d/l3+Yf5h/mH+Yfpl+mX6Zfpp+mn6afpp+mn2bfZt9m32bfZx9nH2cfJx8nXydfJ18nnyefJ58nnyefJ98n3ufe597n3uge6B7oHuge6B7oHuge6B7oHuhe6F7oXuhe6F7oXuhfKF8oXyhfKF8oXyhfaB9oH2gfp9+n3+ef52AnICagJh/lH2NeIR7iXuQeZh5ln2UgJGAkH6NeY93kHeRdpF2kHWRdZR2lniYeZp7m3ybfZt+m36bfpp+mn6afZp9mn2bfZt9nH2cfZx9nH2dfZ19nn6efp59n36hfqF+oH6gfqF+on6ifqN+pH6kfaV9pX2lfKV8pXuke6R6pXqneql7qXupe6l7qXqpeql6qXmpeap5qnmreax5rHmseax4rHiseKx4q3ireKt4q3msea16rXqte618rXysfat9qn2pfal+qX6ofqZ+pn2lfaV9pXylfKV8pHuke6R6o3qjeqJ5onmieKN4o3ijeKN4o3iieKJ3oneid6J3o3ejeKR4pXmmeqZ7p3ypfap9rH6tf61/rX+uf65/rn6sfqp+qX2pfat9rH6tfq1+rX6tfq5+rn2ufa59rn2ufa59r32wfbB+sX6xfrF9sX2xfbJ9sn2yfLJ8snyyfLN8s32zfbN9s3yzfLN7snuye7F6sXqxerB6sHmwea95r3muea55rXmteKx4rHireKt3qneqd6l2qXaodqh1qHWndad1pnWmdaV1pXakdqR2o3ejd6J4oXmheaB6n3qfep56nXqceZh5l32YfZl9mH6Yfpd+ln6WfpZ+ln6Vf5V/lX+VgJSAlIGUgZOCkoKRg5CCi4KEf4N8hHqAe4B6g3uGeoh7inyLfYx9i36Mfox/jX+Nf45/jn+Of45/jn+Pf49/j3+Pf49/j3+Qf5CAkICQgJCAkYCRgJGAkYCSgJKAkoCSgJKAkoCTgJOAk4CTgJSAlICUgJWAlYCVf5V/ln+Wf5d/l3+Xf5d+l36Yfph+mH6Yfpl9mX2ZfZl9mn2afZp9m3ybfJt8m3ycfJx8nHycfJ18nXydfJ18nXyee557nnuee557nnuee597n3ufe598n3yffJ98n3yffJ98n32ffZ99n32ffp9+nn+ef56AnYGcgZuCmoKYg5aCkH+HfIN7iH2MepF4lniWfo9/jn6KeYt4jXaOdo52jnaOdpB2k3eVeZh7mnyZfZl+mX6Zfpl+mH6Xfpd9mH2YfZl9mX6afpp+mn6bfpx/nH+cf5x+nX6ffp9/n36ffqB+oX6hfqF9on2jfaN9o3yjfKN7o3uje6R7pXune6d7p3qneqd5p3mnead4qHioeKh4qXipeKp4qniqeKp4qniqeKp4qnmqeal5qXqqe6t7q3yrfat+qn+pf6h/p3+ngKeApn+lf6R/o3+hfqF9oX2hfaF8oXyhfKB8oHufe597n3qfep96n3qfep96oHqfep96n3qfe597nnqeep96oXuifKN9pH2lfqd+qX+qf6p/qn+qfqt+q36qfal9qHyofKl9qn2qfap9qn2qfat9q32rfat9rH2sfax9rX2tfa59rn2ufa59rn2vfa99r32vfa99sH2wfbF9sX2wfbB8sHywfLB8sHuve697r3uue657rnute617rHqreqt6qnqqeql6qHmoead5p3imeKZ3pXeld6V3pHekd6R3o3eid6J3oXiheKB4oHmfep56nnudfJx8m32afZl9mHyQe4t7inyMe5F8k32TfpN+k3+Tf5J/k3+TgJOAk4CSgZKBkoKSgpKDkoOSg5KDkoKQgYmAg36HeoR9gXmHdol5inuKfIt9in6Kfot+i36Lfox+jH6Mfox+jH6Mf41/jX+Nf41/jYCNgI2AjoCOgI6AjoCPgI+Bj4GPgY+BkIGQgZCBkICQgJGAkYCRgJGAkoCSgJKAk4CTgJN/k3+Uf5R/lH+Vf5V/lX6VfpZ+ln6WfpZ+l36XfZd9mH2YfZh9mH2ZfJl8mXyZfJp8mnyafJt8m3ybfJt8m3ybfJx8nHuce5x7nHucfJx8nHycfJ18nXydfJ18nX2dfZ19nX2dfp1+nX+df52AnICcgZuCm4Oag5mEmIWWhpSGkIOIfoN9hn2NeJB8kn6UfJR+jX+IeYp3ineLdox2jHaMdo12j3eSeZV6l3yXfZd+ln6WfpZ+ln6VfpV9ln6Wfpd+l36Yf5h/mX+af5p/mn+af5p+m36dfp1+nX6efp5+n32ffaB9oH2hfKF8oXyhe6F7onuje6N7pHqkeqR6pHmleaV5pXileKV4pnimeKd4p3ineKd4p3ineKh4qHmoeah5qHqoeqd7p3ynfah9qX6pf6mAqIGngqaCpIKjgqKCooGhgKCAoH+ef51+nX6dfZ59nn2efZ19nHydfJ18nHyce5x7nHuce517nXudfJ18nnyefJ19nH2bfJt8nX2ffaF+on6jf6R/pn+mfqd+p36nfad9p32nfKZ8pnymfKd8p3ynfKd8p32ofah9qH2ofal9qX2qfap9qn2qfat9q32rfat9rH2sfax9rH2tfa19rX2tfa19rX2tfa19rX2tfa18rXysfKx8rHyrfKt8qnyqfKl8qXyofKd8p3ymfKV8pXuke6N6o3qieaJ5oXiheKF4oHigeKB4n3ifeZ55nnmdepx6nHubfJt9mn2Zfph/mH+Wf5V/kYCHfoh+h3uKeo96kHyRfZF+kX+Qf5CAkICQgJCBkIGQgZCCkIKRg5GDkYORg5KDkoOSgpCCiYKEgIZ/h3aJdoh5inqKfIp9iH6Jfol+iX6Jfop+in6Kfop+in+Kf4t/i3+LgIuAi4CLgIuAi4CMgIyBjIGMgY2BjYGNgY2BjYGOgY6BjoGOgY6BjoGPgI+Aj4CQgJCAkICRgJGAkX+Rf5J/kn+Sf5J/k3+Tf5N+k36UfpR+lH6VfZV9lX2VfZZ9ln2WfZd9l32XfZh9mHyYfJh8mXyZfJl8mXyZfJl8mXyZfJp8mnyafJp8mnyafJp8m32bfZt9m32bfpt+m36bf5t/m4CbgZuBmoKag5mEmYWYhpeHlYiUiZGKjYmGgYN/h32LfJB8k3+Qg42Bin2Ieod6hnmHdol2iXaJdop3jHiOeZF7lHyVfZR+lH6UfpN+k36TfpN+k36UfpR+lX+Wf5Z/l3+Xf5h/mH+Xfph+mn6bfpt+m36cfZ19nX2dfJ58nnyee597n3ufe596oHqheqF6oXqheaJ5onmieaN4o3ijeKN4pHikeKR4pHikeKR4pHmleaV5pXqleqV7pXulfKV9pX6lf6WApoGmgqaDpoOlhKSEooSghJ+EnYOcgpyBm4Caf5l/mX6Zfpt+m32afZl9mXyafJp8mnyZfJl7mXuae5t8m3ybfJt8m3ybfJt8mn2afZp9m32dfp5+n36gfqF+oX6ifqJ9o32jfaN9o3yjfKN8o3ykfKR8pHykfKR8pH2kfaV9pX2lfaZ9pn2mfad9p32nfad9qH2ofah9qH2pfal9qX2pfap+qn2qfap9qn2qfap9qn6qfqp+qX6pfql+qH6ofqd+p36mfqZ+pX6kfqN+o36ifqF+oH2ffZ98nnuee516nXqdepx6nHqcept6m3qbepp7mnuZfJh9mH2XfpZ/loCVgJWBlIGTgpKCj4SOgZN9k3yRe5J7kXyQfo9/j3+OgI6AjoCOgY6BjoGOgo6CjoKPg4+Dj4OQg5CDkIOQg5CDjoSMhYt8jHqIeYp7iHyIfYh+h32HfYh9iH6Ifoh+iH6If4h/iX+Jf4l/iYCJgImAiYCJgImAiYCKgYqBioGKgYqBioGLgYuBi4GLgYuBjIGMgYyBjIGNgY2BjYCNgI6AjoCOgI+Aj4CPf49/kH+Qf5B/kH+Rf5F/kX6RfpJ+kn6SfpJ9k32TfZN9lH2UfZR9lX2VfZV9lX2WfJZ9ln2XfZd8l3yXfJd8l3yXfJd8l3yYfJh8mH2YfZh9mH2YfZh+mX6Zf5l/mX+ZgJmAmYGZgpiCmIOXhJeGloeViJSKk4yRjY+OjY6Jh4OAhn2Ne4uDjYONgop+iXyHeoZ6hXmFd4Z3hneHeId4iXmKeo58kX2SfpF+kX6RfpF+kX6RfpF+kX6RfpJ/k3+Uf5R/lX+VfpV+lX6Wfpd+mH6YfZl9mX2afZp8mnybfJt7nHuce5x6nXqdep16nnqeep56n3mfeZ95oHmgeaB4oHigeKF4oXiheKJ4onmieaJ5onqieqJ7onuifKN8o32ifqJ/ooCigaOCo4OjhKOFooWhhqCGn4WehZyFm4Sag5iCloGVgJR/lX6Wfpd+mH2XfZV8lXyWfJd8l3yWfJV7lnuXe5d7mHuYe5h8mHyYfJh8mHyYfJh8mXyafZt9m32cfZx9nX2efZ59n32ffJ98n3yffKB8oHygfKB8oHygfaF9oX2hfaF9oX2ifaJ9on2jfaN9o32jfaR9pH2kfqR+pX6lfqV+pX6lfqZ+pn6mfqZ+pn6nfqd/p3+mf6Z/pn+mf6V/pYCkgKSAo4GigaGBoYGggZ+BnoGdgZyAm3+bf5p+mX2ZfJl8mHuYe5h7mHuXe5d7l3yWfJZ9lX2VfpR/k4CTgZKBkYKRg5GDkIOQg5CDj4ORgZN/k3+RfpF+kH6Pf46AjYCMgIyBjIGMgYyBjIKMgoyCjIONg42DjYOOg46DjoOOg42DjYWNho2CiXyGeod+gn6EfYZ9h32HfYd9h36Hfod+h3+Hf4d/h3+Hf4eAh4CHgIeAh4GHgYeBh4GHgYiBiIGIgYiBiIGIgYmBiYKJgYmBiYGKgYqBioGKgYuBi4GLgIuAjICMgIyAjYCNgI2AjX+Nf45/jn+Of45/j36Pfo9+j36QfpB9kH2RfZF9kX2SfZJ9kn2SfZN9k32TfZR9lH2UfZR9lHyUfJR9lX2VfZV9lX2VfZV9lX2WfZZ9ln6WfpZ+ln+Xf5eAloCWgZaBloKWg5WElYWVhpSIlImTi5KNkY+PkY2Si5GIiYWBg32MfoqAh4SIgod/hnyFe4R5hXaGd4Z4hXmFeoR6hXqHe4p8jX2Ofo5+jX6Ofo5+jn6Ofo9+j36PfpB+kH6RfpF+kn6SfpN9k32UfZV9lX2VfJZ8lnyXfJd7mHuYe5l7mXqZepp6mnqaept6m3qceZx5nHmdeZ15nXmdeZ15nXmeeZ55nnmeeZ55n3mfep97n3ugfKB8n32ffZ9+n3+fgJ+Bn4Kfg5+Fn4aeh56HnYeciJuHm4aZhpiFl4SVg5SCkoGPgI9/kH+SfpN9k32SfJF8knuTe5R7lHuTe5J7knuTe5R7lXuVe5V7lXuVe5V7lXuVe5Z7lnyWfJd8l3yYfJh8mX2ZfZp8mnybfJt8m3ybfJt8nHycfJx9nH2dfZ19nX2dfZ19nn2efZ59nn2efZ9+n36ffqB+oH6gfqF+oX6hfqF+oX+hf6J/on+if6J/o3+jgKOAo4CigKKBooGigaKBoYKhgqCDn4OehJ2EnISchJuEmoSYg5eDloKVgJV/lH6UfpR9k3yTfJN8k3yTfJJ9kn2SfpF/kX+QgJCBj4KOg46EjYSNhYyFi4SKg4mAioOKgIp/i4GNgo6BjoCNgYyBioGKgYqBioGKgYqCioKKgoqCioOLg4uDi4OLg4yDjIOMhIyEjIWMhYyEiYGEf4V/hX6EfoV8iH6Hfod+h36GfoZ/hn+Gf4V/hYCFgIWAhYCFgYWBhYGFgYWBhYGFgYWBhoGGgoaChoKGgoaCh4KHgoeCh4KHgYiBiIGIgYiBiYGJgImAiYCJgIqAioCKgIuAi4CLgIt/i3+Mf4x/jH6Mfo1+jX6Nfo19jn2OfY99j32PfY99kH2QfJB8kHyRfZF9kX2RfZF9kn2SfZJ9kn2SfZJ9kn2SfZN9k32TfpN+k36TfpN/lH+UgJSAlIGUgpOCk4OThJOFkoeSiJGKkYyQjo+QjpKNlIyWiZeGkIOGgn6KfIeAg4KCgYJ/gXyCe4B6gHmDe4N5hHqEfIN8gnuDfYZ+iX6Kfop+in6Kfop+i32LfYx9jH2MfY1+jX6Ofo99j32QfZB9kX2RfZJ8knyTfJN8lHuUe5V7lXqVepZ6lnqXepd6l3qYeph6mHqZeZl5mnmaeZp5mnmaeZt5m3mbeZt5m3mbept6nHuce5x8nHydfZ1+nH6bf5uAm4GbgpuDm4WbhpqHmomZiZiKl4qWipWJlIiUh5OFkoWQhI+DjYKMgYuBjICNfo59jn2NfI17jnuPepB6kHqQeo96kHqQepB6kXqRe5F7kXuRe5F7kXuRe5J7knuSfJN8k3yTfJR8lHyVfJV8lnyWfJZ8lnyXfZd9l32YfZh9mH2YfZl9mX2Zfpl+mX6afpp+mn6afpt+m36bf5x/nH+cf5x/nX+df51/nYCdgJ6AnoCegJ6AnoGfgZ+BnoKegp6CnoOeg52EnYSchZyFm4aahpmHmIeXh5aHlIeThpKFkYOQgpCBj4CPf49+j32PfY59jn2Ofo5+jn+NgI2BjIKMgouDi4SKhYqGiYeJh4aEhICFgIV/hYCDf4R8hH2Gf4iAi4KKg4iDh4KHgoeCh4GIgoiCiIKIgoiDiIOJg4mDiYOJg4qEioSKhIqEi4WLhYuFioSGgYh/iH+JgIp+iICHf4Z/hn+Ff4V/hICEgISAhICDgYOBg4GDgYOBg4GDgYOBg4GDgoOChIKEgoSChIKEgoSChYKFgoWChYKGgYaBhoGGgYaBhoGGgYeAh4CHgIeAiICIgIiAiICIf4l/iX+Jf4p/in6Kfop+in6LfYt9i32MfYx9jH2MfY19jX2NfI18jX2OfY59jn2OfY99j32PfY99j32PfZB9kH2QfZB9kH6QfpB+kH+Rf5GAkYCRgZGBkYKQg5CEkISQhpCHj4iPio6Mjo6NkI2TjJWLl4uai5yNmIaHgoGFeYV8gX1/fnx9fHx+fX58fnt+fH98gH6AfoB+fnx/fYF/hH+GfoZ+hn6Gfod+h32IfYl9iX2KfYp9i32LfYx9jH2NfY58jnyOfI98j3yQe5B7kXuRe5J6knqTepN6k3qUepR6lXqVepZ6lnqWepd6l3qXepd6l3mYeZh6mHqYeph6mHqYe5h7mXyZfJl9mX2Zfpl/mYCYgZeCl4OXhJeGl4eWiZWLlIyTjZKOkY6Pjo2MjIqNiI2GjoWNhYuEiYSIg4iBiICIfoh9iHyJe4l7inqLeot6i3qLeox6jHqMeox6jHqMeo17jXuNe417jXuNe417jXuOfI58j3yPfI98kH2QfZB9kX2RfZF9kn2SfZJ9k36TfpN+lH6UfpR+lH6VfpV+lX6VfpV+ln+Wf5Z/l3+Xf5d/l4CYgJiAmICYgJmAmYGZgZmBmYGZgZmCmoKag5qDmoOahJqEmYWZhZmGmIeXh5eIlomViZSKk4uRi5CKjoqNiIyGjISLg4qCioGKgIl/in6Kfop+in6Jf4mAiYGJgoiDiISHhYeGhoeGh4aIhomHiYWDhYKEg4SDgoSCg4GAgX6EfYV+g4OEg4SDhIKEgoWChYKFgoaChoKGg4aDhoOGg4aDh4OHhIiEiISIhIiEiYWJhYmFiIOIgYl/iYCJgYmBhoGFgIWAhICEgIOAg4CCgYKBgoGCgYGBgYGBgoGCgYKBgoGCgYKBgoKCgoKCgoKCgoKCgoOCg4KDgoOCg4KEgoSBhIGEgYSBhIGEgYSBhICFgIWAhYCFgIaAhn+Gf4Z/h3+Hf4d/h36Ifoh+iH6Ifoh9iX2JfYl9iX2KfYp9in2KfYp9i32LfYt9i32MfYx9jH2MfYx9jH2NfY19jX6Nfo1+jX6Nfo5/jn+OgI6AjoGOgY6CjYONhI2EjYaNh4yJjIqMjIyOi5CLk4qVipiKmoqdi5+MnomQhYSDfIZ9gnt9fnl8eX17fXx8fHt9fH19fn5+f31+en57f31/gH+CfoJ+gn6CfoN9hH2FfYV9hn2HfYd9iH2JfYl8inyKfIt8i3yMfIx7jXuNe457jnqPeo96kHqQepB6kXqRepJ6knqSepN6k3qTepR6lHqVepV6lXqVepV6lXqVepV7lXuVe5V8lXyVfZV+lX6Vf5WAlYGUg5SEk4WTh5KJkoqRjJCOj4+NkYySipKIkoWQhIuFh4eGiIaJhoiFhoSFhISCg4GDf4N9g3yEe4R6hXqGeoZ6h3qHeod6h3qHeod6iHuIe4h7iHuIe4h7iHuJe4l7iXyJfIp8inyKfYt9i32LfYx9jH2Mfo1+jX6Nfo5+jn+Of45/j3+Pf49/kH+Qf5B/kH+Qf5F/kX+RgJKAkoCSgJKAk4CTgZOBk4GUgZSBlIKUgpSClYKVg5WDlYSVhJWFlYWVhpWGlIeUiJSIk4mSipKLkYyQjY+OjY6Mj4qOiY2Hi4aIhoWGhIWDhIKEgYSAhH+Ff4V/hX+FgISBhIKEhISFhIaDh4OIg4mDiYKIg4eFh4WDhYSFhISEhIODgoJ/gX6DfoV9g4CBgYGBgoGCgYKBg4KDgoSChIKEg4SDhIOEg4SDhYSFhIWEhYSGhIaEhoWHhoaEhYGHgoiCh4KGgoaBg4KDgoOBgoGCgYGBgYGAgoCCgIKAgoCCgIJ/goCCgIJ/gn+CgIKAgoCCgIKAgoCCgIKBgoGCgYKBgoGCgoKCgoKCgoGCgYKBgoGCgYKBgoGCgIKAg4CDgIOAg3+Ef4R/hH+Ff4V/hX+FfoV+hn6GfoZ9hn2GfYd9h32HfYd8h3yHfYh9iH2IfYh9iX2JfYl9iX2JfYl9iX2Kfop+in6Kfop+in+Kf4t/i4CLgIuBioGKgoqDioSKhYqGioeKiImKiYyJjoiQiJKIlYiYiJqInYmgiqKMoo2ahoWBf4V7fn17gHh9d314fXp7ent7fHx+fH97f3qAe4B7f31/fIB+f39+f35/fX99gH2BfIJ8g3yEfIV8hXyGfId8h3yIfIh7iXuJe4p7inuLe4t6jHqMeox6jXqNeo56jnqPeo96j3qQepB6kHqRepF6kXqRepJ6knqSepJ6knuSe5J7knyRfJF9kn2SfpF/kYCRgZGCkIOQhY+Gj4iOio2MjI2Mj4uRiZOIlYaXhZeCl3+Ve41/g4CFgYaDhoWFhoOGg4OCgIF/f359f3x/e4B6gXqBeoJ6gnqDeoN6g3uDe4N7g3uDfIN8g3yDfIN8g3yEfIR8hHyFfIV9hX2GfYZ+h36Hfod+iH6Ifoh/iH+Jf4l/iX+Jf4p/ioCKgIuAi4CLgIuAi4CMgIyAjICMgI2BjYGNgY2BjoGOgY6CjoKPgo+Dj4OPg4+Dj4SQhJCFkIWQhpCGkIeQh4+Ij4mPio6LjoyNjYyOjI+LkIqRiJKHk4aShJGDjIKDgoGCgoGEf4R/g3+Cf4CAgICAgIGAgoCDgISAhoCHgIiAiYCKgYmBioKIgoWFhIWFhIWEhYSEhISDgoKAgH+Af4R9hoCCgoCAgICAgIGBgYGCgoKCgoKCg4KDgoOCg4KEgoSDhIKEg4SDhIOFhIWEhoWEhYKFg4WDhIOEg4SCgYOBg4CDgIKAgn+Cf4J+gn6CfoJ+g36CfoJ+gn6CfoJ+gn6CfoJ+gn6DfoN+gn6CfoJ/gn+Cf4J/gn+CgIKAgoCCgIKAgoCCgIGAgYCBgIGAgICAgICBgIGAgYCBgIJ/gn+Cf4J/g3+DfoN+g36DfYN9g32EfYR9hH2EfIR8hX2FfYV9hX2FfYV9hn2GfYZ9hn2GfYZ9h32Hfod+h36Hfod/h3+Hf4eAiICIgYeBh4KHg4eEh4WHhoeHhoiGioaMho6FkIWShZSFl4WahZ2GoIeiiKSLpIygiIyCgYN+fYN6gHd7eHt5enp7enx6fXp/e4B6gHqAeoB6f3yBe4F5gHt/fH18fHx8fXx+fH98gHyBfIJ8g3yDfIR8hXuFe4Z7hnuHe4d7iHqIeol6iXqKeop6inqLeot6jHqMeox6jXqNeo16jnqOeo56jnqOeo56jnqOeo57jnuOe458jnyOfY5+jX6Nf42AjYGNg4yEjIaLh4uJiouJjIiOh5GGk4WVhJeDmYKbgZyAnH+agI2AgYCCgIOBg4KCg4OChIODgYF9f3t+enx7e3t6fHl9eX55fnp+en57fnx+fH58fn1+fX59fn1+fX58f3x/fH98gH2AfYF9gX6BfoJ+gn6Cf4N/g3+Df4N/hICEgISAhICFgIWAhYCFgIaAhoCGgYaBhoGHgYeBh4GHgYiBiIKIgoiCiIKJgomDiYOKg4qEioSKhIqFioWKhouGi4eKh4qIiomKiYqKiouJjImNiI6IkIeRh5KGlIWVhJaDl4OWg5WBi3+Df4KAgoCBgIJ/gn+Bf4B7gnuDe4N7hHuFfIZ8iHyJfYp9i3+MgYWBhIOKgoKGhIWGg4eDhoOFgoSBg4GBgYCAfoF+hIGAgn5/fn9/gH+AgIGAgoCCgIOAg4CDgIOAhICEgISAhICEgIWAhYGFgYaChoOFgoSChIKEgoSBhIGDfoR+hH6EfoN9g32DfYN9g3yDfIN8g3yDfIN8g3yDfIN8g3yDfIN8g3yDfIN8g32DfYN9g32DfYJ9gn2CfoJ+gn6CfoJ+gn6CfoJ+gn6BfoF+gH6Af4B/gH+Af4B/gH9/gH+Af4B/gH+AfoB+gX6BfYF9gX2BfYF9gn2CfYJ9gn2CfYJ9gn2CfYN9g32DfYN9g32DfYN9g36EfoR+hH6Ef4R/hH+EgISAhIGEgYSChIOEhIOFg4aDh4OIg4qDi4ONgo+CkYKUgpaCmYKcg5+EooWkhqaIpomjiJOBgIV/f4V4f3Z2fnx8e3x7e315f3qAeYB5gXiBeIB4gXqBe4F5gHd/eX15e3p7e3t8e317fnt+e397gHuBe4J7gnuDe4N7hHqFeoV6hnqGeoZ5h3mHeYh5iHmIeYl5iXmJeol6inqKeop6inqKeot6i3qLeot6i3uLe4t7inyKfIp9in2Kfol/iYCJgYmCiIOIhYeGh4iGioWLhI2Dj4OSgpSBloCZgJt/nX+ff6B/n4GahIqDg4N/hIKAg3+BgIOAgYGAgYCAgHp/d3x3e3d5eHl5eXp5e3p7e3p8en16fXl+eX55fnl+eX55fXl9en16fXt9e318fXx+fX59f31/fn9+f35/f4B/gH+Af4B/gICBgIGAgYCBgIGBgYGBgYGBgYGBgYKCgoKCgoKCgoKCg4KDg4ODg4ODg4SEhISEhIWFhYWFhoWGhYaFh4WIhYiFiYWKhYuFi4SMhI2Ej4SQg5GDkoKUgpaBl4GZgJqAmoCagZiBkX2DfYN9g36Cf4J/gX6BfoF7g3iFd4Z3hneHeIl4inmLeox8jYCIgYSBhYGHgYSChYOHgoeChoGGgIWAg4CBf4F9gH6BgYKBgH9/fX59f36AfoF+gn6CfoN+g36DfoR+hH6EfoV9hX2FfYZ+hn6GfoZ/hn+Gf4V/hX+Ff4V/hX+EfIV8hXuFe4R7hHuEe4R7hHqEeoR6g3qDeoN6g3qDeoN6g3qDeoN6g3uDe4N7g3uDe4N7g3uDe4N7g3uDe4N8g3yCfIJ8gnyCfIJ8gnyBfIF9gHyAfIB8gHyAfYB9gH1/fX99f35/fn5+fn5+fn1/fX99f31/fX99f31/fX99f31/fX99f31/fYB9gH2AfYB9gH2AfYB+gH6AfoF+gX+Bf4F/gYCBgIGBgYGAgoCDgISAhYCGgIeAiH+Kf4t/jX+Pf5F/k3+Vf5h/m4CegKGBo4OmhKiGqIamhZWBfoR9gIR9f3l2fXp8fXt+eoB4gXiCeIJ4gneCdoF5gXmBeYB7gHWAdn13enh5eXp6enp6e3t8e317fnt+e396gHqAeoF6gXqCeoN5g3mEeYR5hHmFeYV5hXmGeYZ5hnmGeoZ6h3qHeod6h3qHeod6h3qHe4d7h3uHfId8hn2GfYZ+hn+Ff4WAhYGEgoSEg4WDh4KIgoqBjICOf5B+kn2VfZd8mnude597oXuifKJ9n4CXhYiEgYSBg3+EfoN+hH2EfoN7gnx/gH6BeH11e3R5dXh2eHd5d3p3fHd9dn52f3WAdIB0gHR/dH90fnR+dX12fXZ9d313fnh+eH95f3l/eYB6gHqAeoB6gXuBe4F7gXuBe4J7gnyCfIJ8gnyCfIJ8gnyCfIN9g32DfYN9g32DfYN9g36EfoR+hX6Ff4V/hn+Gf4Z/h3+Hf4h/iX+Jf4p/i3+Lf4x/jX+Of5B/kX6SfpR+lX6Xfpl9mn6cfZ1+nX6cf5l/kX2EfYR8gnyCfIF8gnuCe4N5hHmFeYV5hXmHeIh4inqLfYh/h4CGf4aAiICHf4SAh32JfYiAh4CHfoV+g36DfoN9gX6Bf4KBf4J/fX98gHuBe4F8gnyDfIN8hHuEe4V7hXuFe4V7hnuGe4Z7hnuGfIZ8h3yGfYZ9hn2GfIZ8hnyFeYZ5hnmFeYV5hXmFeYV4hHiEeIR4hHiEeIR4hHiEeIN5g3iDeYN5g3mDeYN5g3mDeYN5g3mDeYN5g3mDeoN6g3qDeoN6g3qCeoJ6gnqBe4F7gXuAeoB6gHqAeoB7f3t/e397f3t+fH58fnx9fH18fXx9fH18fXx9fH18fXx9fH18fXx9fH18fX19fX19fX19fX19fX1+fX59fn1/fX99f32AfYB9gX2BfYJ8g3yEfIV8hnyHfIh8iXuLe417jnuQe5J7lXuXfJp8nH2ffqJ/pYGngqmEqoWph5WBfoV9f4N6fnd8dXp1f3uCdIN3gneDd4N2g3aDdIJ2g3aCd4J5gnmCdn92eHd3eHh4eXl6eXp6enp6e3p8enx6fXp+eX55f3mAeYB5gXmBeYF5gniCeYJ5gnmDeYN5g3mDeoN6g3qEeoR6hHqDeoN6g3uDe4N8g3yDfYJ9gn6CfoF/gYCBgYCCgIN/hH+Ffod+iX2LfI18j3uRepN5lnmYeJt3nnegd6J3pHikeaJ6nn2Rg4OGhIWDgoGCf4J+g3yEfIN7gnmEfX9/fYB2fHN4c3d0eHR5dHt0fXR/c4BygXGCcIJvgW+Ab39vf3B+cH1xfXJ9c310fnR+dH91f3WAdoB2gXaBdoF2gXaCd4J3gneCd4J3g3eDd4N3g3eDd4N3g3eDd4N4g3iDeIR4hHiEeIR4hHiFeIV5hnmGeYZ5h3mHeYh6iHqJeop6inqLeot6jHqNeo56j3qQepJ6k3qVepZ6mHqaepx6nXqee597n3yefZt9i32FfIR8g3uCeoF4g3eCeYJ5hHiFd4Z3hniHeYh6iHyIfId+h3+GfoZ/iH6KfYaAh32Ie4h8iH2IfYZ9hH2DfIN8gn2Cf4B/f4OAfoF6gXmBeYJ5g3mDeYR5hHmFeYV5hnmGeYZ5hnmGeIZ4h3mHeYd5h3mHeod6h3qHeod6h3mGd4d3h3aGdoZ2hXaFdoV2hXaFdoV2hHaEd4R3hHeEd4R3g3eDd4R3g3eDd4N3g3eDd4N3g3eDd4N3g3eDeIN4g3iDeIN4g3iCeIJ4gnmBeYF5gXiAeIB4gHiAeIB5f3l/eX95fnl+eX56fXp9en16fXp9en16fXl9eXx5fXl9eX16fXp9en16fXp9en16fXp9en16fXp+en56f3p/en96gHmAeYF5gXmCeIN4hHiFeIZ4h3iIeIl4ineMd453kHeSd5R4lniZeJt5nnqhe6N9pn+ogaqDqoaqipiBfoZ9gIF8gHqEcHpxeXWDdoN2g3aDd4N2g3aDdYN1g3eBeYF7gHyBfX14e3Z3eHd3eXd6d3p3enh6eHp5eXp5e3l7eXx4fXh9eH54fnh/eH94f3iAeIB5gHmAeYB5gHmAeoB6gHqAeoB6gHqAe4B7f3x/fH99f31+fn5+fn99f32AfYF8gnyDe4V7hnqIeYl5i3iNd493knaUdZZ1mXScdJ5zoXOkc6V0pnWld6J5nH+LgIWBhYWEg3+EfYN8gXyCeoN4gXmGeoJ9fn96gHR4c3dzeHJ6cnxxf3GBcIJuhG2EbIRrg2qCaoBqf2t9bH1tfG59b31wfnF+cX9xgHKAcoFygXKBcoJygnKCcoNyg3KDcoNyg3KEcoRyhHKEcoRyhHKEc4RzhHOEc4RzhXOFc4VzhXOGc4Zzh3OHdIh0iHSJdIl0inSKdIt0i3WMdY11jnWPdZB1kXWSdZR1lXaXdpl2mnacd553n3iheKF5oXqgfJt8iXyHe4V5g3mCd4N2g3eCeIN4hHiGdYd3h3iGeYZ5h3qHe4d7iHyIfId9iHyJfId7inyJeoh7iHuIfYZ8hHyDe4J8gX1/fX99gIGCfIR4gneCd4N3hHeEd4V3hXaGdoZ2hnaHdod2h3aHdod2h3aIdoh2iHaId4h3iHeId4d3h3eHdId0h3SHdIZ0hnSGdIZ0hXSFdIV0hXSEdYR1hHWEdYR1hHWEdYR1hHWEdYR1hHWDdYN1g3WDdYN1g3aDdoN2g3aDdoN2g3aCdoJ3gXeBd4F3gXeAd4B3gHd/d393f3d/d353fnd+d313fXd9d313fXd9d313fXd8d3x3fHd8d313fXd9d3x3fXd9d313fXd9d312fnZ+dn52f3Z/doB2gHWBdYF1gnWDdIR0hXSGdId0iHSJdIpzjHONc49zkXSTdJV0l3WadZx2n3eieaR7p32pgKqDq4ariZ2CfYZ6hnx+gH6Ge3t2enKBdIJ1gnaDdoR2hHaEd4N3gneAeX96fnx7fnp/fnl5eHh2eXV6dXp1enV6dnl3eXd4eHh5eHp4end7eHt4fHh8eHx4fXh9eH15fXl9eX15fXp9en16fXp8enx7fHt8e3x8e3x7fXt+e356f3p/eYB5gXiCeIN3hHeFdod2iHWKdIx0jnOQc5JylHGXcZlxnHCfcKJwpHCncalxqXKnc6B7lIKGg4SChIKDgX+CeoZ5g3qBeYF5f3qCf4J+fn5/gHp7dHlyenB8cH5vgW6DbYVrhmqHaIdmhWWDZYFmfmd8aXtqe2t8bH1tfm1/bn9ugG6BboFugm6CboNug26DboRuhG6EboRuhG6EboRthG2FbYVuhW6FboVuhW6FbYVthm2GbYZth26HboduiG6IbolviW+Kb4pvi2+Lb4xwjXCNcI5wj3CQcJFxk3GUcZVxl3KZcppznHOedKB1oXaidqN3o3ihe5d8inmIeIZ3hHeDdYN1g3WCd4R3hniGd4Z4hniGeYV5hnqFeYZ6h3qHeoh6iHqMeoh6inqJeIl6iHqHeoZ7hHuDe4F7gHx/fH57f3+DfoN3g3WDdYR0hXSFdIZ0h3SHc4dziHOIc4hziHOIc4hziHOIc4hziHOIdIh0iHSIdIh0iHSIcYhxiHGHcYdyh3KGcoZyhnKFcoVyhXKFcoRyhHKEcoRyhHKEcoRzhHOEc4RzhHOEc4RzhHOEc4RzhHSDdIN0g3SDdIN0gnWCdYJ1gXSBdIF1gHWAdYB1gHV/dX91f3V+dX51fnV9dX11fXV9dX11fXV9dH10fHR8dHx0fHR8dHx0fHR8dHx0fXR9dH1zfXN9c35zfnN+cn9yf3KAcoBygXGCcYJxg3GEcIVwhnCHcIhwiXCKb4tvjW+PcJBwknCUcJZxmHGbcp1zoHWid6V5p3upfqqCqoaqjKGIg4J+iXl/gX6DfYF4f3V/dIF2gnaDd4N3g3eDd4J5gHp/en57fnt8e3p/fn5+eHx0e3J7cntyenJ5c3h0eHV3dnd3d3h3eHd5d3l3eXd6eHp4enh6eHp5enl6eXp6eXp5enl7eXt5e3h7eHx4fHh9d313fnd/dn92gHWBdYF0gnSDc4RzhnKHcolxinCMcI5vkG+SbpRul26ZbZxtn22ibaVup26qb6xvrG+qcZ56iYKEgoGEgoCCf35+e4F5hHmCeIF6f3uBfoR9gHx9fnyAc31wfG9+boFtg2yGa4hpimeKZYpjiGGFYIFhfWN6Znpoeml7an1qfmt/a4BrgWuBa4Jrg2uDa4NrhGqEaoRqhWqFaoVqhWmFaYVphmmGaYZphmmGaYZphmmGaYdph2mHaYdpiGmIaYhpiWmJaopqimqLaotqjGuMa41rjmuPa5BskWySbJNtlG2VbZdumW6ab5xwnnGgcqFzo3SkdaV2pHijepN6jHeJdoZ2hHWDdYN0g3SDdoV2h3aIdoZ3hneGd4V3hXiEeYR5hnmHeYh4iXmMeop6inqJeYh5h3mGeIV6g3qCe4B7f3t+e355gH2DeYV0hXOFcoVyhnKHcYdxiHGIcIlwiXCJcIlwiXCJcIlwiXCJcIlwiXCJcYlxiXGJcYlxiHGIb4hviG+Ib4dvh2+Hb4ZvhnCFcIVwhXCFcIVwhXCFcIVwhXCFcIVwhXCEcIRxhHGEcYRxhHGEcYRxhHKEcoNyg3KDcoNzgnOCc4FzgXKBc4FzgHKAcoByf3J/cn9yfnN+c35zfXN9cn1yfXJ9cn1yfXJ8cnxyfHJ8cnxxfHF8cXxxfHF8cX1wfXB9cH1wfXB+b35vf29/boBugG6BboFugm2CbYNthG2FbIZsh2yIbIlsimyLbI1sjmyQbJFsk2yVbZdumW6cb55xoHKjdKV3p3qofamAqYWniaKJi4N+h3yHeoN+fX99fnd+doB2gXeCd4J4g3eCeYF6f3t+fHx7enx5fXx9fnqBdIByfXB8b3tvenB4cXdydnN2dHV1dnZ2dnZ2dnd3d3d3d3d4d3h3eXd5d3l2enZ6dnp2e3Z7dXt1fHV8dH10fXR+c35zf3KAcoBxgXGCcINwhG+Fb4ZuiG6JbYttjWyPbJBrk2uVapdqmWqcap9qoWukbKdtqm6sb65xrXStfJR+gIGCf4F9gX6AfXx8enx5f3l/d4J3gXmBe4F8gX1+f3yBcYFugG2BbINshmuJaoxojmaPZI5hjF+IXYJde2B2ZHdmeWd6aHxofmh/aIFogWiCaINng2eEZ4RnhWeFZ4VmhmaGZoZmhmaGZYZlhmWHZYdlh2WHZYdlh2WIZIhkiGSIZIhkiWSJZIllimWKZYtli2WMZoxmjWaNZ45nj2eQZ5FokmiTaZRplWmXaphrmmucbJ1tn2+hcKJxpHOldaZ2pnqjfJF4jHeJdYZ1hXSDdINyg3KGcodyiXKJdYd3hnaFdoN3gneDdoR3h3eIeIl4inmLeot5inmJeYh4hniFd4R5gnqAen96fnp+en95gXyDdYdxhnCHb4dviG+Iboluim6Kboptim2KbYptim2KbYptim2KbYptim6Kbopuim6JboluiW+JbIlsiGyIbIhth22HbYdthm2GbYZthm6FboVuhW6FboVuhW6FboVuhW6FboVuhW6Fb4VvhG+Eb4RvhG+EcIRwg3CDcINwgnGCcYFxgXGBcYFxgHCAcIBwf3B/cH9wfnB+cH1wfXB9cH1wfXB9cH1wfG98b3xvfG98b3xufG58bn1ufW59bX1tfW19bX5sfmx+a39rf2uAa4BqgWqBaoJqg2mDaYRphWmGaYdoiGiJaIpoi2iMaI5oj2iRaJNplGmWaphrmmycbZ9uoXCjcqV1pnine6h/qIOmh6OJkIJ/iXuJeoZ7e359gHqAd4B3gXeBd4J3gniBeYB6f3p+eX15fHp8fH16fHuCcoJvgG5+bXxteW53b3VwdHJ0c3RzdHR1dHV0dnR2dXd0d3R4dHh0eXR5dHpzenN7c3tze3J8cnxxfXF9cX5wfnB/b39vgG6BboJtgm2DbIRshmuHaohqimmLaY1oj2iRaJNnlWeXZ5lnnGeeaKFopGmma6lsrG+tcq51rXyqfoiAfoGAfH97fnt9fHt8eHt5e3l6d316f319fX98f359gXuEcYZsg2yDbIZriWqNaY9okmeTZZNjkmOOZYZefWBwZHNmd2Z6Z3xmfmaAZoFlgmWDZYRkhGSFZIVkhmSGY4djh2OHY4dih2KHYodih2GIYYhhiGGIYYhhiGGJYYlhiWCJYIlgimCKYIpgi2CLYYxhjGGNYY1ijmKPYo9jkGORZJJkk2SUZZVmlmaYZ5lom2mdap5soG2ib6NxpXOmdad3p32jf5R6jHiIdoZ0hHODcoNyhHGGcYhxiHKIc4d1hnSDcYJyhXGGcYdyiHWIdol2i3eMeIt5inmJeIh4hneEd4J4gXmAeX96f3uAeYF5gnqFcYhtiG2JbIlsiWyKbItri2uLa4xqjGqLaotqi2qLaotqi2uLa4tri2uLa4primuKbIpsiWyJaolqiWqJaohqiGuHa4drhmuGa4ZrhmuGa4ZrhmyGbIZshmyGbIVshWyFbIVshW2FbYVthW2EbYRthG2EboRug26DboJugm6Cb4FvgW+Bb4BvgG+Ab39vf25/bn5ufm5+bn1ufW59bX1tfW19bXxtfG18bXxsfGx8bHxrfWt9a31rfWp9an1qfWl+aX5pf2h/aIBogGeBZ4FngmaCZoNmhGaEZYVlhmWHZYhliWWKZItkjGSOZI9lkGWSZZRmlWaXZ5lom2mdap9soW6icKRzpXamead9poGlh6SJkIB6hnyIeol8f35+gHyCeIF3gXeAd4F4gXmBeX95fnp8eHx4fXmAen56fn2Ce4Nygm9/bX1semx2bXNvcnBycXNyc3J0c3VydXJ2cndyeHJ4cXlxeXF6cXpwe3B7cHtvfG98bn1ufW1+bX5sf2yAa4BrgWqCaoNphGmFaIZoh2eIZ4pmi2aNZY9lkWWTZJVkl2SZZJtlnmWgZqNnpWioaqtsrXCudK55q4GggYSBf3+Be356e3p6enh6d3p3eXh5eXp5fHp9e3p7e357hHqGeYV1hW2FbIhrjGuPapJqlWqXaphtlnWIdoV4gXByZ3Jmd2Z7ZX1lgGSBY4Njg2KEYoVihWGGYYZhh2GHYIhgiGCIYIhfiF+IX4heiF6JXoleiV6JXYldil2KXYpdil2KXYtdi12LXYxdjF2MXY1djV6OXo9ej16QX5FfkWCSYJNhlGGVYpZjmGOZZJpmnGedaJ9qoGyibqRwpXOmdad5p3+if5J9jHqId4Z1hHODcoRyhXKHcYhxiHGHcYZxhXCDb4Vvhm+Db4RyhXOHdYp0jHWOd4x4iniJd4d3hXaDdYF1gHd+eH96gXmBd4F5g3GIaopqimmLaYtpi2mMaYxojWiNaI1ojWeNZ4xnjGeLaItoi2iLaItoi2mLaYtpi2mKaYppimqKaIpoiWiJaIhoiGiIaYdph2mHaYZphmmGaYZphmqGaoZqhmqGaoZqhmuFa4VrhWuFa4VrhWuFa4RrhGyEbIRsg2yDbIJsgmyCbIFtgW2AbYBtgG1/bX9tf2x+bH5sfmx9a31rfWt9a31rfWt8anxqfGp8an1qfWl9aX1pfWh9aH1ofWd+Z35mfmZ/Zn9lgGWAZYFkgWSCZIJjg2ODY4RihWKFYoZih2KIYYlhimGLYYxhjWGPYZBikmKTYpVjlmSYZJplm2edaJ9qoGyib6NxpHSleKV8pIGjhqGLk4V+h4CLfI1+g39/gHyDeYF4gHh/eH95gHp/en56fHp9eX14fnh+eIF3gniEe4R8gnqBdIBvfmx4bXNvcXBxcHFxc3F0cXVwdnB2cHdveG94b3luem56bntte217bHxsfGt9a35rfmp/aX9pgGiBaIJngmeDZoRmhWWGZYhkiWSKY4xjjWKPYpFik2KVYpZimWKbYp1jn2SiZaRmp2ipaqttrXCuda17qIGYgoKBf4F+fHt5eXl4eXh4eHh5d3p2enZ4dXd2e3V9eYJ3hXmGeYV4hHOGbItsjmySbJVtl26ZcZp3k3qEeH92e3l7anRneGV8ZH9jgWKDYYRghWCFYIZfhl+HX4heiF6IXYldiV2JXYpciVyJXIpbiluKW4pbilqKWotai1qLWotajFqMWoxajFqMWY1ZjVqOWo5aj1qPW5BbkFuRXJJckl2TXZRelV6WX5dgmWGaYptknGWeZ59poWuibaRwpXOmdqZ6poGhgZJ9jXuJeYZ3gXSCcoRyhnKIcodyhnGGcYVxhHGEcYRxg3GDcYVxh3KHdIp0jXWOdox3ineJd4d1hXWCdH9zfnV/dYB2gHaBdIJsiGeMZoxmjGaMZo1mjWaOZo5mj2aPZY9lj2WPZI5ljGWMZoxmjGaMZoxmjGaMZ4tni2eLZ4tnimiKZopmiWeJZ4lniGeIZ4dnh2eHZ4dnh2eGaIZohmiGaIZohmmGaYZphmmFaYVphWmFaYVphWmFaYVqhGqEaoNqg2qDaoJqgmqBa4FrgWuAa4Brf2t/a39rf2p+an5qfWl9aX1pfWl9aH1ofWh8aH1ofWd9Z31nfWZ9Zn1mfWV9ZX5kfmR+ZH9jf2OAYoBigWKBYYJhgmGDYINghGCEYIVfhl+HX4hfiF+JXopei16MXo1ej1+QX5Ffk1+UYJZhl2GZYppjnGWdZp9ooGqhbaJwo3Okd6N7ooCghp+Ml4aAh36MgIt9gXx/gH+Be395fnl+en57fnt9e3x7e3t9en54fneAd4B3gXmDfIJ7f35+fn99f3t+c3hvcm9wcHFwc290b3Vudm53bXhteGx5bHpremt7a3tqfGp8aX1pfWh+aH9nf2eAZoBlgWWCZINkhGOFY4Zih2KIYYlhimGMYI1gj2CRYJNglGCWYJhgmmCcYZ9ioWOjZKVmqGiqaqttrXGtdqp8o4WQgoB/f4B8fXt6end5d3t3e3V7dXtzenJ5c3lxe3GAdYV2hneFd4R3g3OIbI5skG2TbpVwmHOZd5l9jXyCdX9zg3h/bHdnemV+ZIFihGCGXoddhl6GXodeiF2IXIlciVuKW4pbiluLWotai1mLWYtZi1mLWItYi1iMWIxXjFeMV41XjVeNV41XjVeOV45XjlePV49XkFeQWJFYkVmSWZNZk1qUW5VbllyXXZhemV+aYZxinWSeZp9ooGqibaNwpHOld6V7pYGhhJGAi32FfIF5gXeEdYR0hnSIdIZ0hXKEcYRyg3ODcYJugW6DboVxhXCJco10jnOPdY12ineJd4d0hXKDcoBxfnR/c4F0gXOBboZki2SMY41jjWSOZI5kj2SPZJBkkGSRZJFjkWORY5BmjGWMZIxkjGSMZIxkjGSMZYxljGWLZYtmimaKZYpliWWJZYhmiGaIZodmh2aHZodmh2aGZoZmhmaGZ4ZnhmeGZ4ZnhmeGZ4VohWiFaIVohWiFaIVohGiEaINog2iCaIJpgWmBaYFpgGmAaX9pf2l/aH9ofmh+aH5nfWd9Z31nfWZ9Zn1mfWV9ZX1lfWR9ZH1kfWN+Y35jfmJ+Yn5hf2F/YX9ggGCAX4FfgV+CXoJeg16EXYRdhV2GXYZch1yIXIlcilyKXItcjFyOXI9ckFyRXJJdlF2VXpZfmF+ZYJtinGOdZZ9moGmha6FuonGidaJ6oH+ehZyLmId8hoCJgoh7gHt+f3+BfX57fXt8fHx8fHx8fHt7fXx9e356fnl/eH94gXmAe396fXt9e399fX1/e39wdW9wb3Juc211bXZsd2t4a3hqeWl6aXpoe2h7Z3xnfGZ9Zn5lfmV/ZIBkgGOBY4JigmKDYYRhhWCGYIdfiF+KX4tejF6OXo9ekV6TXpRell6YXppfnF+eYKBhomKkZKZmqGiqaqttrHGrdah6n4GKf4N8fnt+enx5fHd7dnx0e3R7cntwfG5/b39vfnCAcoN0hXWEdoJ2hHCKbI9tkW6TcZVzl3eYe5eBjHyCeIJ1gnl/c3xpfGaAZIRjh2KJYYxiiGCHXYlciVuKW4pai1qLWYtZjFmMWIxYjFeMV4xXjFeMVoxWjVaNVY1VjVWOVY5VjlWOVY5Vj1SPVI9Uj1WQVZBVkVWRVpJWklaTV5RXlFiVWZZZl1qYW5ldml6bX5xhnWOeZZ9noGmhbKJvo3Ojd6N7ooGgh5WHiICDfIN6g3mDeIR3hXeGdoV1hHOEcoNzgnOBcIBugW2DboRyhnGIcopyjnOOdYxzi3WKdYl0hnKDcIByfXR/c4B0gW+GYoxijWGOYY5hj2GPYpBikGKRYpFikmOSY5NklGWUb4xsi2WOZI1jjWONY41jjWONY4xjjGOMZItkimSKZIlkiWWJZYhliGWIZYdlh2WHZYdlh2WGZYZlhmWGZYZmhmaGZoZmhmaGZoVmhWaFZoVmhWaFZoRmhGaDZoNmgmeCZ4FngWeAZ4BngGd/Z39nf2Z/Zn5mfmZ+ZX5lfWV9ZX1kfWR9ZH1jfWN9Y31ifWJ+YX5hfmF+YH5gfl9/X39fgF6AXoBdgV2BXYJcglyDW4RbhFuFW4ZahlqHWohaiFqJWopZi1mMWY1ZjlmPWpBakVqSW5NblVyWXJddmV6aX5tgnWKeY59ln2egaaBsoXCgdKB4nn2cgpqEmIiCiIGJfoZ6gH59f31/fnx+en56fXt8e3x8fX58fnt8fH17fnp+en56f3p/en56fnp+eX56fnx9fX55enFzbnNtdGt2andpeGl5aHpnemZ7ZntlfGV8ZH1kfWN+Y39if2KAYYFhgWCCYINfhF+FXoZeh16IXYldil2LXIxcjlyPXJFcklyUXJZdl12ZXZtenV+fYKFho2OlZKdmqWiqa6tuq3GpdKV8l4OEf4J6gHp+d352fnZ+dH90f3N/cH9rgG+BboFwgHGAdIN2hHaDeYB3hGyMbI9tkW+TcpR2lXqWfpWEj4KDf4F6gHiAe4BtgGeDZYZkiGWJZ4hlimCPYItci1qLWYxZjFiMWI1XjVeNV41WjVaNVo1VjVWNVY5UjlSOVI5UjlOPU49Tj1OPU49TkFOQU5BTkVORU5JTklOSVJNUlFWUVZVWllaWV5dYmFmYWplbml2bXpxgnGKdZJ5mn2mgbKFvoXKhdqF6n3+chJaGjoWHhIKBgX2Ce4R6hXmFeIR2hHWDc4JygnGBcIBvgG2CbYRth2yIboxwjXWMdYtyi3WLdol1h3SEcn50fXV+dH9yhWSOYY5gj1+PX49fkGCRYJFgkWGSYZJhkmKTZJNnk3CNZ4xjjmONYY5ijWKNYo1ijWKNYo1ijGKMYotjimSKZIlkiWSIZIhkiGSIZIdkh2SHZIdkhmSGZIZkhmSGZIZlhmWGZYZlhmWFZYVlhWWFZYVlhWWFZYRlhGWDZYJlgmWBZYFmgGWAZYBlf2V/ZX9lf2R+ZH5kfmR+Y35jfWN9Yn1ifWJ9YX1hfWB+YH5gfl9+X35ff15/Xn9df12AXIBcgFyBW4FbglqCWoNahFmEWYVZhliGWIdYh1iIWIlYileKV4tXjFeNV45Yj1iQWJFYklmTWZRallqXW5hcmV2bXpxfnWCeYp9kn2agaKBroG6fcp52nHuagJmDl4aCiIGGfoV9gHp+fX1+fnqAd4B4f3p+e318fn19fXx9fX18fXx9e357fXt8enx6fnp/d394fnp8eX56f3J6bXZrdml3aHlneWZ6ZXtke2R8Y3xifWJ9YX5hf2B/YIBfgV+BXoJeg12EXYRchVyGXIdbiFuJW4pbi1uNW45aj1qRW5JblFuVW5dcmVyaXZxenl+gYKJipGOlZadnqWmqbKtuqnGodqJ/i32Ce4R5gneAd4B1f3V/dn91f3R/dIB0f3V9c39xgnKEdIR3hXuDfYN7hnGMbZBukXCRc5J3k3yTgZGFjYaEgX9+gHiCfYNzhWmHZYhiiWCKXYtbjl2NXIxajlmNWI1YjVeOV45WjlaOVY5VjlWOVY9Uj1SPVI9Tj1OPU49TkFKQUpBSkFKQUpBSkVKRUpFSklKSUpNSk1KUUpRTlVOVVJZUllWXVphXmFiZWZlamlybXZtfnGGdY51mnmifa59un3KfdZ55nX2agJaCkYONg4mDhoOEgoR/hHyEeoR5hHaDdIFzgHGAb4Bwgm2EbYVthW2GcIlxiXWKdYl1iHaJeId3hXSBcoB0gHR/bYRhjl+QX5BekF6QXpFekV+SX5JfkmCTYJNhkmGSYpFikGGOYI9gjmGOYo5kjGKNYo1ijWKNYo1ijWKMYopjiWSJZIhkiGSIZIhkiGSIZIdkh2SHY4ZjhmOGY4ZkhmSGZIZkhmSGZIVkhWWFZYVlhWWEZYRlhGWEZYRlg2WCZYFlgGSAZIBkgGR/ZH9kf2N/Y39jfmN+Yn5ifmJ+Yn5hfmF+YH5gfl9+X35ffl5+Xn5dfl1/XX9cf1x/W4BbgFqBWoFZglmCWYNYg1iEWIRXhVeGV4ZWh1aIVohWiVaKVopWi1aMVo1WjVaOVo9WkFaRV5JXk1eUWJZZl1mYWplbmlybXZxenWCeYZ9jn2WgZ6Bpn2yfb51zm3eYepaEkIWBh4GDfIJ9fXx8fIB8gXaCd4F4gHp/e398f3x+fH1+fH18fH19fH57fnp9eX15fnqAeH93fnd+dn52gG98anlpeWd5Znpke2N8YnxifWF9YH5ffl9/XoBegF2BXYFcglyDXIRbhFuFWoZah1qIWolZilmLWYxZjVmOWZBZkVmSWpRalVqXW5hcmlybXZ1en2CgYaJjpGSmZqdpqWuqbatvq3Gpe5aAhHyFeIV3gnaAdYB1f3WAdn92fnZ+dX1zfHV8dn11f3SDcoN1hXiDfId9iHqIdIxvkHGQdJB4kHyQgY+FjIOEf4F4gHOEeYZ5iWuLZYxhjF+NXY1cjluPWo9Zj1mPWI9Xj1ePVo9Wj1WPVY9Vj1SPVI9UkFOQU5BTkFKQUpBSkVKRUpFRkVGRUZJRklGSUZJRk1GTUZRRlFGVUpVSllOWU5dUl1SYVZhWmFeZWJlamlubXZtfm2GcY5xlnWida51unXGddJx4mnuYfpWAkoGPgYyBioKJg4iFh4CEfYV7hHmBd4B0gHKAb4Fwg2+Eb4Ntg3GFc4Z0h3SId4Z4hXiGeYR4gnOCcIRzgHCHYY1ej16QXpBekV6SXpJekl6TXpNfk1+TYJNgkmCSYZFgkGCPYI9gjmGOYY1hjWKNYo1ijWONY41jjWOMY4llh2WIZYhliGSIZIhkiGSIZIdjh2OGY4ZjhmOGY4ZjhmOFY4VkhWSFZIVkhWSEZIRkhGSEZINlg2WDZYNmgmaBZYBlgGR/Y39jf2J/Yn9if2J/YX5hfmF+YX5gfmB+YH5ffl9+Xn5efl1+XX5cflx/XH9bf1t/WoBagFmAWYFYgViCWIJXg1eDVoRWhVaFVYZVhlWHVYhViFSJVIpUilSLVIxUjVSNVI5Uj1SQVZFVklWTVpRWlVeWV5dYmFmZWppbm1ycXZ1enl+fYZ9ioGSgZqBnoGmfa51um3CXeJKCiIaDhH2BeIB7fXuBe4V7hXmDeYB6gHyAfX9+f31+fX18fHx8fnx+fX97fnp+eH16f3h/eH91gXWBdYB1gHR+aXtne2V7Y3xifWF9YH5ffl5/XoBdgFyBXIFbgluDWoNahFqFWYVZhlmHWIhYiViKWIpYi1iNWI5Yj1iQWJFYklmUWZVallqYW5lcml2cXp5fn2GhYqJkpGamaKdrqW2qcKtzrHurgIh+gnuDeIN4gXZ/dX91f3V/dYB1f3V/dH1zfXR8eHp4fnd/c351gHaDd4x4jXmKe4d3inSOdY55jnyOgI2Di4GEfYB4gXOFdId6jWyQZo9ij1+PXZBckFuQWpBZkFmQWJBXkFeQVpBWkFWQVZBVkFSQVJBUkFOQU5FTkVKRUpFSkVKSUpJSklGSUZJRk1GTUZNRlFGUUZVRlVGVUZZSllKXU5dTl1SYVZhWmFeZWJlamluaXZpfm2CbY5tlm2ebapttm3Cbc5p2mHmWe5R9kX+PgI2BjIGKg4mGiIWEgYJ/gH1/eYB1gHWBcIJyg3KDcIJyg3OEdIR1hHaDeYN6gX2Ce4J4gXSCcIRzhW6QYZFfkV6RXpJekl6TXpNek16TX5Nfk1+TYJNgkmCSYZFhkGGQYI9hjmGNYYxijWKNY41jjWSNZYxnjGqKcoVuiGaIZ4lliGWIZYhkiGSHZIdkhmOGY4VjhWOFY4VjhWOFY4VjhGSEZIRkhGSDZINkg2SDZIJkgmWCZYFlgWWAZIBkf2N/Yn9if2F/YX9gfmB+YH5ffl9+X35efl5+Xn5dfl1+XH5cflt/W39af1p/WYBZgFmAWIFYgVeCV4JWg1aDVoRVhFWFVYVUhlSHVIdUiFOJU4lTilOLU4tTjFONU41TjlOPU5BTkFSRVJJUk1WUVZVWllaXV5hYmVmaWptbnFydXZ5enmCfYaBioGShZaFmoWegZ59sl3iOgoaDg4R/f3t+fYF9gH+BfoF9gnuDeoJ7gXx/fX99f35+fX1+e358f3yBfIF7f3l+eH55f3iAdIB0gnWCdIB2f3eAa35lfWN9YX5gfl9/Xn9dgFyBW4FbglqDWYNZhFmEWIVYhliHV4dXiFeJV4pXileLV4xXjVeOV49XkFeRWJJYlFmVWZZal1uYXJpcm16dX55goGKhZKNmpGilaqdtqHCpdKp6rIalh4GBfX6Be4J5gHd/dn92f3Z/doB2f3V/dH1ze3B9dX94enN6dH1yg3CGcYt1jHiGe4V9hX6FfIh6jHyMf4yBi4OFfYJ6gXaEc4h5jG+UZ5Njk2CSXpJckluRWpFakVmRWJFYkVeRV5FWkVaRVpFVkVWRVZFUkVSRVJFTkVOSU5JTklKSUpJSk1KTUpNSlFKUUpRRlVGVUZVRllKWUpZSl1KXU5dUmFSYVZhWmFeZWJlamVuZXZlfmmGaY5plmmeaappsmW+Ycpd1lneVeZN7kX2Pfo2AjIGLg4mFiIeGiIKCf35/e4B3gniBc4F0g3WCdIF1gnWBdoF2gXeBd4J4hHyEfYJ4gHWAcYFwiWaZYZRfk1+TXpNfk1+UX5RflF+TX5Ngk2CTYJJhkmGRYZFikGKQYo9ijmaLY4xjjGOMZIxljGaLZ4poiWiHZYdqim6HZolmiGWIZYdlh2WHZYZkhWSFZIRkhGSEZIRkhGSEZINkg2SDZINkg2SCZIJkgmSBZIFkgWSAZIBkgGN/Y39if2F/YX9gf2B+X35ffl9+Xn5efl1+XX5dflx+XH5bflt/Wn9af1l/WYBYgFiAV4FXgVeBVoJWglWDVYRVhFSFVIVUhlOHU4dTiFOJUolSilKLUotSjFKMUo1SjlKOUo9SkFORU5FTklOTVJRUlFWVVZZWl1eYV5lYmlmbWpxbnVydXp5fn2CgYqBjoWSiZaJmo2egdpOAhIGDgoKDgXx9fXx/f4F/gX2AfYB9gH2CfYF9f3yAfH99f31+fX58fX58f3yBe4F6gHmAeYB5gXiAdYB1g3KBcYB1gXeBbIFkgGGAYIBegF2BXIFbglqDWYNZhFiEWIVXhleGVodWiFaIVolWilaLVotWjFaNVo5Wj1aQVpFXkleTWJRYlVmWWpdamFuZXJpdnF+dYJ5ioGOhZaJnpGqlbKZwp3OoeKiApomdjIKEf4CBfIF6gHmAeH93gHeAd4B3f3V/c35yf3J/cX9xf3J+cYJtgm+Hc4l4hnqEe4d9hX6Ff4V9iX2MfYx/i4CIf4R6gnSCcIZ3iniSaphklmGUX5Rdk1ySW5JbklqSWZFZkViRWJFYkVeRV5FXkVaRVpFWkVWRVZJVklSSVJJUklSTVJNTk1OUU5RTlFOUU5VSlVKVUpZSllOWU5dTl1OXVJdUl1WYVphXmFiYWZhamFyYXZhfmGGYY5hlmGeYaphsl26WcZVzlHaTeJJ5kHuOfY1+i4CKgYmDiIaHiYWIgn+BfYF7gXuAen94gXiAdoF2gXWAdYBzf3GDcoV1hnmGe4N2f3N9cIJnlWKYYZVglGCTYJNglGCUYJRglGGTYZNhk2GSYpJikWORY5BkkGSQZZBpjGqJZYxljGWLZYtmimeJZ4hnh2eHZodmh2WJZ4hnh2aHZoZmhmaGZoVlhGaDZoNlgmWCZYNkg2SCZIJkgmSCZIJkgWSBY4FjgWOAY4BjgGN/Yn9if2F/YX9hf2B/YH5ffl9+Xn5efl1+XX5cflx+XH5bflt/Wn9af1l/WX9YgFiAV4FXgVaBVoJVglWDVIRUhFSFU4VThlOHU4dSiFKIUolSilKKUotSjFKMUo1SjlKOUo9SkFKQUpFSklKSU5NTlFOUVJVUllWXVpdWmFeZWJpZm1qcW5xcnV6eX59goGKgY6FkomajZ6Vppn2TgoGBf4N+g36CfH98f32AfoF9gX2AfIB9gH6AfoB9f31/e4B9fn19fnt+fX99gH2Be4B6gXqBeYF5gnWBdYF0gW+BcYBygniDa4Vjg2CCXoJcgluDWoNZhFiFWIVXhleHVodWiFWIVYlVilWKVYtVjFWNVY1VjlWPVZBWkVaRVpJXk1eUWJVZllmXWphbmVyaXZtenGCeYZ9joGWhZ6Jpo2ykb6VypXelfKSDoYmZi4eCgICAfoB8gHqAeoB5gHmAeIB4gHZ/dYB0gHOAcoBwgnODd4RuhnWJd4V5hHqFeoR5hHuGfIZ+hnyNfIx8i3yKe4l5iHuFeoJ7hHiYa5xlmWKWYJVflF6TXZNcklySW5JbklqSWpFZkVmRWZFYkViRWJJYkVeSV5JXkleSVpJWk1aTVpNVk1WUVZRVlFWUVJVUlVSVVJZUllSWVJZUllWWVZZWl1aXV5dYl1mXWpdbl12XXpdgl2KXZJdmlmiWapZslW6UcJNyknSRdpB4j3mNe4x8i32Kf4iAh4KGhYWHhIaCgYF+gYF/gX98gHqBeIB3gHWAc4Fvg3CFcYZzhnaHeYRzf29/aohhmGGXYZVhlGGTYZNik2KUYpRik2KTY5NjkmOSY5FkkGSQZY9mjmiNa4tsiWiNZ4xni2aKZ4lniWeIaIdnh2eGZoZmh2aIaIZohWiFaIRohGmEaoNtg2qCZ4FmgWaBZYFlgWWBZIFkgWSBZIBkgGOAY4Bjf2N/Yn9if2J+YX5hfmB+YH5gfl9+X35efl5+XX5dflx+W35bflp+Wn9af1l/WX9YgFiAV4BXgVaBVoJVglWDVINUhFSFU4VThlOHUodSiFKIUolSilGKUYtRjFGMUY1RjlGOUY9RkFGQUpFSkVKSUpNSk1OUU5VTlVSWVJdVl1aYVplXmViaWZtanFucXJ1dnl+fYJ9ioGOgZaFmommjbaZ9ooODfn1/fIJ9gHyAfoF/g36DfYJ8gXyBfIB9f35/fn5+fX19fn5/fn98fnx/fIB8gH2Ae4B6gHqBeoJ5gnaCdoN1hHGEc4F0gnaFaohhhV+EXYRbhFqFWYVYhleHV4dWiFaJVYlVilWLVItUjFSMVI1UjlSOVI9UkFWRVZFVklaTVpRXlVeVWJZZl1qYW5lcml2bXpxgnWGeY59koGahaaJro26jcaN1o3mif6CEnImXjIyEfYB/fn99gHyBe4F7gHqAeoF5gHh/d4B1gXWBdYNzhHKFeIR3g3OIc4N4iHiEe4J5g3mEeYR7h3mNeox7i3uKfYmBhoWAg396h3Ohap9mmmSYYpZhlWCUX5Nek16SXZJdklySXJFckVuRW5FbkVuRWpFakVqRWpJZklmSWZJZklmTWJNYk1iTWJRXlFeUV5RXlFeVVpVWlVaVV5VXlVeVV5VYlViVWZValVuVXJVdlV6VYJVhlWOUZZRmlGiUapRsk26ScJJykXOQdY92jneMeIt5inuJfIh9h36GgIWBhIOEhIODg4WChoB/gHyBeYB3gXiBd4JyhHCFcYZyhnSGd4RxgWuGXZJflmGWYpRjk2OSZJJlk2WTZZNlk2WSZZJlkWWRZpBmj2aOZ41ojGiLZ4pmi2eMaItoiWiJaIhoh2mHaYZohmiGaIZnhmeGaYRphGmDaYNpgmmBaYBngmiBaIBngGaAZoBlgGWAZYBlf2R/ZH9kf2N/Y39jfmJ+Yn5ifmF+YX5gfmB+X35ffl5+Xn5dfl1+XH5cflt+Wn9af1l/WX9Yf1iAV4BXgVaBVoJVglWDVINUhFSEU4VThlOGUodSiFKIUolSilGKUYtRjFGMUY1RjlGOUY9Rj1GQUZFSkVKSUpJSk1KUU5RTlVOWVJZUl1WXVZhWmVeZV5pYm1mbWpxbnVydXp5fnmCfYp9koGWgZ6FpoW2idKOCkH9+fX1/foF+gH+BgIF/gX6CfYF8gXyAfYB+f35/fX59fn59f32AfX98f3yAfIB8gHyAe4B5gHiBeYN3gnaDdoN4g3OBcIJzg3OJcohkhl6GXIZbhlqHWIhXiFeJVopVilWLVItUjFSMVI1UjlSOVI9UkFSQVJFUklWSVZNWlFaUV5VXlliXWZhamVuZXJpdm16cX51hnWKeZJ9moGiha6FtonCidKJ3oXyggJ2FmYmVjpCLgYF/foF8gX6Ce4F7gXuCe4J6gXiAeYB3gXeCdoJ2g3WFdId6hXeEb4J9iHiBe4N4g3eEeIR6hniMeYx5inyJfoaBgoGAfYRwkGmnaaBnm2aYZJdjlWKUYpNhk2CSYJJgkl+RX5FfkV6RXpFekV6RXZFdkV2RXZFckVyRXJJcklySXJJbk1uTW5Nak1qTWpNak1qUWZRZlFmUWpRalFqUWpNbk1uTXJNck12TXpNfk2CTYpJjkmWSZpJokmmSa5FtkW6QcJBxj3OOdI11jHaMdot3iniJeYh6h3qGe4R9hH+EgIWChYOEhIKDf35+e354gXmCeIN2hHCGcYZxhnKHdIVxg2iPYZRilWOUZJNlkWaRZ5FokWiSaJJokmiRZ5FnkGePaI5ojWiMaItpimmKaIppimmJaolqiGqHaoZqhmqFaoVqhGmEaYRphGmEaoJqgmqBaoFqgGmAaYBogGh/aH9nf2d/Zn9mfmV+ZX5lfmR+ZH5jfmN9Y31ifWJ9YX1hfWB9YH1ffV99Xn1efV1+XX5cflx+W35bf1p/WX9Zf1h/WIBXgFeBVoFWglWCVYNUg1SEU4VThVOGU4dSh1KIUolSiVKKUYtRi1GMUY1RjVGOUY9Rj1GQUZFSkVKSUpJSk1KUUpRTlVOVU5ZUl1SXVZhVmFaZVplXmliaWZtZnFqcW51dnV6eX55hn2KfZJ9loGegaaBsoXChepuAgX59fn6Af4F/g3yCfIF8gXyBfIF9gH2AfYB+f35+fn1+fX9+f31/fH98gHyAfIB8gHyBe4B5gHmBeYJ2gHaCd4F2gXGDbIlxiXKLcYlshl6HXIhbiFmJWIpXilaLVYxVjFWNVI1UjlSOVI9Uj1SQVJFUkVSSVJNVk1WUVpVWlVeWV5dYl1mYWplbmlyaXZtenF+cYZ1inmSeZp9ooGqgbKFvoXKhdqB5n32dgpuGmImUi5CMi4OBfoF9gn6De4F7gX2CfIJ7gXmCeYJ4gXiCd4N3g3aEdYV0h36FcYOAh3qAeIJ4gXiCd4N4h3WLd4t6iHmGeYV3g3GFZo5hoWajaJ9om2eYZ5dmlWWUZZNkkmSSY5FjkWORYpFikWKRYpFhkWGQYZBhkGCQYJBgkWCRYJFgkV+RX5Ffkl+SX5Jekl6SXpJdkl2SXZJdkl2SXZJdkl2SXpFekV6RX5FfkWCRYZFikWOQZJBlkGeQaJBpkGuQbI9uj2+PcI5xjXONc4x0jHWLdYp2iXaId4d3h3eGd4R6g3yEfoV/hX+EgIJ/f3t9eXx0f3OBcoRxhnCHcIdvhnCGcYZwh2WTZJRklGSTZZFmj2iOao5skGyRa5FrkWqQapBqj2qOaoxqi2qKaolqiGqIa4hriGuHbIdshmyFbIVshGyEa4Nrg2uDa4JrgmqCa4BrgGt/a39qf2p+aX5pfmh+aH1nfWd9Zn1mfWV9ZX1kfWR9ZHxjfGN8YnxifGF8YXxgfGB8X3xefF59XX1dfVx9XH1bflt+Wn9af1l/WYBYgFeAV4BWgVaBVYJVg1SDVIRUhVOFU4ZTh1KIUohSiVKKUopSi1GMUYxRjVGOUY5Rj1GQUpBSkVKSUpJSk1KTUpRTlVOVU5ZUllSXVJdVmFWYVplWmVeaWJpYm1mbWpxbnFydXZ1enmCeYZ5in2SfZp9on2qfbKBvoXOhgYx9fn5/gH+BfoF9gn2BfYF8gX2AfYB9gH5/fn9/f35+fn1/fYB9gH1/fIB8gHuAfIB8gHx/fH97gHuAeYB2gXaCdYFxgG2FbIhwjHGNb4pwiWiHXohcilqLWIxXjVaNVY5VjlWOVI9Uj1SQVJFUkVSSVJJUk1WTVZRVlVaVVpZXl1iXWJhZmVqZW5pcm12bXpxfnGGdYp1knmWfZ59pn2ygbqBxoHSfeJ97nX+cgpmFloiTiZCJj4WDgIGAgn6BfYF7gn6DfoN9gnuCeoN4gnqEeYR5hHaEd4J1hHuGeYB9inmBeYB5gXqAeIF3h3OLdIpziHOIcIdsiWWPYJhjnmefaZ1qmmqYaZZplWiUaJNokmeRZ5FnkGaQZpBmkGaQZpBlkGWPZY9lj2WPZY9kj2SQZJBkkGSQY5BjkGORY5FikWKRYpFhkWGRYZFhkWGRYZBhkGGQYo9ij2KPY49jj2SPZI9lj2aPZ45ojmmOao5sjm2Nbo1vjXCNcYxyjHOMdIt0i3WKdYp1inWJd4Z3iXaJc4R2gHqDe4V7hnqFeYN3gXSAcYFwhG+Gb4dviG+Ibodth2yHaohojmeTZ5RnlGaSZo9pjG+KdIlwj2+QbpBtkG2PbI5sjWyMbIptiHGGboZthm2GbYZthW2FbYVthG2DbYNtgm2CbYJtgWyBbIFsgGyAbH5sfmt+a31rfWp9aX1pfGh8aHxnfGd8ZnxmfGV7ZXtke2R7Y3tje2J7Ynthe2B7YHtfe157XntdfF18XHxcfFt9W31afVp+Wn5Zf1l/WIBYgFeBVoFVglWDVINUhFSFU4VThlOHU4dSiFKJUopSilKLUoxSjFKNUo5Sj1KPUpBSkVKRUpJSklKTU5RTlFOVU5VUllSXVJdVmFWYVplWmVeaV5pYmlibWZtanFucXJ1dnV6dX55gnmGeY55knmaeaJ5qn2yfb59yoH2dgIF9fn9/gH+AfYB9gX2AfYB9gH2AfoB+gH5/f39/fn9+f31/fYB9gH2AfIB7f3t+fIB8f3t/fX98f3p/eYF3gXaCdIFwgnCDaoZqj2uQbI5vjXCGaYdfjFuOWY5Xj1aPVo9VkFWQVZFUkVSSVJJUk1WTVZRVlFWVVpVWlleXV5dYmFmYWZlamluaXJtdm16cX5xhnWKdY55lnmefaZ9rn26fcJ9zn3afeZ59nICbg5iFloeUh5KHi4aChYCEgYCBfoF9gn6DfoJ+gX2BfIJ8gnyEfYJ+hXmEdoV2g3WEd4F7hnp/e4B4gXiAdoNvi3CMcIpvim2Laoxnj2SUZJlmm2mba5psmGyXbJVslGyTbJJrkWuQa5Brj2qPao9qj2qPao5qjmqOao5pjmmOaY5pjmmOaY5pj2iPaI9oj2iPZ49nj2ePZo9mj2aPZo9mj2aPZo5mjmaOZo1mjWeNZ41njWiNaI1pjWmNao1rjWyMbYxujG+LcIxxjHKMcotzinWKdop2i3WKd4l6inyGeYV6iH2JgYN9gXmAeYV4iHeHdoV0hXKEcYVwhnCIcIlviW6JbYlriWmKaYtqjmqSa5Nrk2yRd4h9gXyDdotzj3GPcI9vjm+Nb4xwinGKdYd1hHKEcIVwhHCEb4Rvg2+Db4Jvgm+Bb4FvgW+AboBuf25/bX9tf21/bX1sfGx8a3xqfGp7aXtpe2h7Z3tnemZ6ZnplemR6ZHpjemN6YnphemF6YHpgel96Xnpeel17XXtce1x8W3xbfFp9Wn1ZfVl+WH5Yf1iAV4BWgVaCVYJVg1SEVIVUhVOGU4dTh1OIU4lSilKKUotSjFKMUo1SjlKPUo9SkFKRUpFSklOSU5NTlFOUU5VUllSWVJdVl1WYVphWmVaZV5pXmlibWZtZm1qcW5xcnVydXZ1enWCdYZ5inmOeZZ5mnmieap5snm6fcZ91n4KOfn5+f4B/gH6AfYB9gH2AfX99f36Afn9+f39/f39/fn99f31/fYB9gH2Be396f3uAe398f3t/fX98fnt/e4B4gHeBdIFxg3CGa4pqjGqNbY9vjW+JdYhkj1yQWZBYkFeRVpFWkVWSVZJVklWTVZNVlFWUVpVWlVaWV5dXl1iYWJhZmVqaWppbm1ybXZxenF+cYZ1inWSeZZ5nnmmfa59tn2+fcp91nniee51+m4Gag5iFloaUh5KHiIWDhIOEg4CAfX9+gX+CfoF+gX2BfIF9gn2DfIR+hnyCe4J4hHyEd4N0hnSGfX96f3eCcYZtjG2MbYxsjGqNaI9nkmaVaJhqmWyZbZhvlm+Vb5Nvkm+Rb5Bvj2+Pb45vjm6Obo5ujW6Nbo1ujW6NboxujG6MboxujW6Nbo1ujW2NbY5tjm2ObI5sjmyOa45rjmuOa41rjWuNa41rjGuMa4tri2uLa4tsi2yLbItti22Lbotvi2+Lb4twinKIdIl0i3OKdYh3h3qFe4d7iH2HfYR9h3uHfoKAgoKFg4SBhH2AfIN5iXeIdod0h3OGcodyiHKJcYpxinCKcIhui3KJd4V4hXOMcJFzj3yFgIB8gnSJcY1yj3OOcY1xjHKKc4h1hnWFd4N2hHSEcoNygnKCcYJxgXGBcYBwgHCAcH9wf29/b35vfm5+bn1tfW19bHtse2t7antqeml6aHpoemd6ZnlmeWV5ZHlkeWN5YnlieWF5YXlgel96X3peel56XXpcelx7W3tbe1p8WnxZfVl9WH5Yflh/V39XgFaBVoFWglWDVYRUhFSFVIZTh1OHU4hTiVOJU4pTi1OLUoxSjVKOUo5Sj1OQU5BTkVOSU5JTk1SUVJRUlVSWVZZVl1WXVphWmFaZV5lXmliaWJtZm1qbWpxbnFycXZ1dnV6dX51gnWKdY51knWWdZ51onWqdbJ1unnGedJ57mYCBfH5/f4B/f3yAfYB9f35/fn9+f39/f39/f39+f35/fn99f32AfYB9gHx/e4B7gHqAen97f3yAe398fXx+e354f3d/dIFzg3KGbohriXGKcottimmLcYtokl2TWpJYkleSV5JWklaTVpNWk1aUVpRWlVaVV5ZXl1eXWJhYmFmZWplamlubXJtdm16cX5xgnWGdYp1knmWeZ55pn2ufbZ9vn3GfdJ93nnmdfJx/m4Gag5iFloaUhZKFiIWEhISEgYF/f3+AgYCBfoB+gH6BfYJ9gn6CfIR8hHuBfoR6g3uGc4R4g3aDeYV7gXmBcYhsjGyNbI1rjmqPaZFpk2mVa5Ztl2+XcJZxlHKTc5JzkXOQc49yjnKNco1yjXKMcoxyjHKMcotyi3KLcotzi3OLc4tzi3OLc4xzjHOMcoxyjHKMcoxxjHGMcYxwjHCMcIxwjHCLcItvim+KcIpwiXCJcIlwiXCJcYlxiXKJcopzinOLcotziHiFe4R8hX+Ef4SAg36Dfol+hH2HfIV7hX+EgYCAgIGCgIF+gXyCeoZ5jHmJd4l3iHeGdIh0iHSJdYp2inmJe4V7hHyDe4N7g32EfId/g4CAfYF3iXOJc4t0jHSMc4t0iXSGd4R4g3eCdoJ0gnSCdIF0gHOAc4Bzf3J/cn9xfnF+cX5wfXB9b31vfW58bnxtfG17a3premp6aXppemh5Z3lmeWZ5ZXlkeWR5Y3lieWF5YXlgeWB5X3peel56XXpdelx6XHtbe1p7WnxafFl9WX1Yflh+V39Xf1eAVoFWgVWCVYNVhFWEVIVUhlSGVIdUiFOJU4lTilOLU4tTjFONU41TjlOPU49TkFORVJFUklSTVJNUlFWVVZVVllaWVpdWl1eYV5hYmViZWZpZmlqbWptbm1ycXJxdnF6cX51gnWGdYp1jnWSdZZ1mnWidaZ1rnWydbp1wnXOceZyDjH58fX9/foF9gH2AfX99f35/fn9+f39+f35/fn9+f35/fn99f31/fYB8f3x/e396f3p/eX96f3t+e358fX19en13fXd+d4B3gnaEc4ZuhHGFcYZuh2eNb45jmFyWWpRZk1iTWJNXk1eTV5RXlFeVV5VXlliWWJdYmFmYWZlamVqaW5pcm12bXZxenF+dYJ1inWOeZJ5mnmefaZ9rn22fb59xn3Ofdp54nnudfpyAm4KahJiFloWUhZCFh4aEh4OEgIF+gYCBgIB/f39/gICBfoB9gn6CfIJ6gHqDe4N5hXeFcINwgXGAc4R6gnqCc4ltjmyOa49rj2qQapJrk2yUbpRwlHGUc5N0knWRdpB2j3aOdo12jXaMdox2i3aLdot2inaKdop2inaKdop3ineKd4p3iniKeIp4iniLeIt3i3eLd4t3i3eLdot2inaKdYp1inWKdYl0iXSIdIh0iHSIdIh0iHWIdYh1iHaIdoh3iHmJfIqAg4CAf4OCgYGAf4J9gnuDeYd5iHmIeId4hXmAfH98gnuDe4N6hHeGd4t5jHqKeol5iHeJd4l3iHmGeIl6iHyHfoV+gn2CfYN+goCCgIKAgX6BfoN6iXWHdYd3iHeJd4h4hnuCeoJ4gneBdoB2gHaAdX91f3V+dH5zfnN9cn1yfXF9cXxwfHB8b3xue257bXttemx6anppeWh5aHlneWZ5ZXlleWR5Y3ljeWJ5YXlgeWB6X3pfel56Xnpde1x7XHtbe1t7WnxafFl9WX1Zflh+WH9Xf1eAV4BWgVaCVoJVg1WEVYRVhVSGVIZUh1SIVIhUiVSKVIpUi1SMVIxUjVSNVI5Uj1SPVJBUkVWRVZJVk1WTVpRWlFaVV5VXlleWWJdYmFmYWZhamVqZW5pbmlyaXZtdm16bX5tgnGCcYZxinGOcZJxlnGacaJxpnGqca5xtnG6ccJxznXidgZeAg39+f3+BfoB9gH1/fX9+f35/f39/f39+f35/fn9+f35/fX99f31/fH98fnt+e356fnl+eX55fnl+en59fnx9eXx3e3h8en56gHqCcoNsg26Bb4FthWiKaJNdm1yXW5ValFmTWZNZk1mUWJRYlVmVWZZZllmXWpdamFqZW5lcmlyaXZtem1+cX5xgnWGdYp5knmWeZp9on2mfa59tn2+fcZ9zn3WfeJ56nnydf5yBm4KZhJiEloWUhYuHhIeEiIKFgIKAgYCBf4F+gH+Af4B/f4B+gX6BfYB6gH+CfIN6hXaFcIVthnGBb4N2h3iFc4tukGyQbJBrkGuRbJFtkm+ScJJyknSRdZF2kHePeI54jnmNeYx5i3mLeYp5inmKeYl5iXmIeoh6iHqIeoh6iHuIe4h8iXyJfIl8iXyJfYl9iX2JfYl8iXyJfIl7iXuJeol6iXqIeoh5h3mHeYd4hniGeIZ4hnmGeYZ5hnqGe4Z9hYCDg4WBgX+AfoJ+gnyDe4R6hXmGeIh4iHiJeIl4iHmBeYB2hHmEd4V2h3aJd4p5inqJe4l6iXmJeoh8hn2FfId+hoCEgYF/gX+AgIGBgYCAgH9/f39+eIZ9i4CFf4N+gn6GfYN+gnuDeYJ5gHh/eH93fnd+dn52fXV9dX10fHN8cnxyfHF8cHtwe297bntte216bHpremp6aHlneWd5ZnlleWR5ZHljemJ6YnphemB6YHpfel56Xntde117XHxcfFt8W3xafVp9WX1Zflh+WH9Yf1eAV4BXgVeBVoJWglaDVYRVhFWFVYVVhlWHVYdViFWJVYlVilWLVYtVjFWMVY1VjVWOVY9Vj1WQVpBWkVaSVpJXk1eTV5RYlFiVWZVZllqWWpdbl1uXXJhcmF2ZXZlemV+ZX5pgmmGaYppjmmObZJtlm2abZ5tom2mbaptrm22bbptvm3GbdJ13n3+hhIp+gX9/gYCBfoB+f35/fn9+f39/f35/fn9+f35/fX99f31/fX99f3x+e357fnt+e316fXl9eHx4fHl8eXx7fHp8eHt3e3l7enx6fXp/coJvgG2DbYFghVaOV5lamVuWW5VblFuTWpNak1qUWpRalFqVW5ZblluXXJdcmF2ZXZleml6bX5tgnGGcYp1jnWSeZZ5mnmefaZ9qn2yfbp9wn3Gfc591n3efep58nX6cgJuBmoOYg5aElIWQhIaGhYeFh4OIgoSAgn+CfoJ+gX6Bf4B/gIB/gH9/foB9gYCAfoN7hXeFdIdxhnCBcIR0iXqGeY5xk26TbJJskW2RbpFvkXGQcpB0kHaPd454jnmNeo17jHuLe4t7inuJfIl8iXyIfIh8h32HfYd9hn2GfYZ+h36Hf4d/h4CHgIeBiIGIgYiBiIKIgoiBiIGIgYiAiICIf4h/h3+Hfod+hn2GfYZ9hX2FfYV9hX2FfYV9hH6Df4GBgYCAf4J9gn2CfIJ8g3uEe4V6h3mIeYh5iHqJfIiAhIKBe4V7gnyBd4d1iHWId4d5iHuHfIh8inuJe4Z8hXyFfoOAgoCAgICAgYCAgICAgIB/gH9/f3yDeYh/iIKDg4KDgICFfoN7gnuCe4B6f3l+eH14fXd9dn12fHV8dHx0fHN8cntxe3B7b3tue256bXpsemt6anpqeml5ZnpmemV6ZHpjemN6YnphemF6YHtfe197Xntee117XXxcfFx8W31bfVp9Wn5Zfll+WX5Yf1h/WIBYgFeBV4FXgleCVoNWg1aEVoRWhVaGVYZVh1WHVYhWiVaJVopWilaLVoxWjFaNVo1WjleOV49Xj1eQV5BYkViSWJJZk1mTWpRalFuUW5VclVyWXZZdll6XXpdfl2CXYJhhmGKYYphjmWSZZZlmmWeZaJlpmWmZaplrmWyZbZlumW+ZcJlymnSbeJ1+oYyijYOAf36AgH+AfoB+f35/fn9/f39/f3+AfoB+gH2AfX99f3x/fX58fnx+en56fnp+en15fXh9d3x3enh7eXt6enl7d3t3e3h6d3l2enZ5c3xxg2uDX4hVjlWTWJZbllyUXJNck1ySXJJck1yTXJNclF2VXZVdll6WXpdemF+YYJlgmmGaYptjm2ScZZxmnWedaJ5pnmqebJ9tn2+fcJ9yn3Sfdp94nnqefJ1+nX+cgZqCmYOXg5SCkISHhoWHg4eEiIWHg4SAg36CfoJ+gn6BfoF/gX9/f39+f39+gX+DfoN9hHmFd4Zyg3CDdYR4hHiIeo9zl2+VbZRtk26Rb5BxkHKPdI52jniNeY16jHuMfIt9i32KfYl9iX6Ifod+h3+Gf4Z/hn+FgIWAhYCFgIWBhYGFgoWDhoOGhIaEhoWGhYeGh4aHhoeGiIaIhYiFiISHhIeDh4OGgoaChoGFgYWBhICEgISAhICDgIOBgoGAgX+AgH+Af4F7gnyCfIN8hHyEfIZ8h3uJfYZ9g3yGfIZ8gn6CfoSAgX2CeIh2iXaIfIN8hXyDfYV/hn6IgIV+hICCgYCBgIB/gH9/f4B/gH+AfoB9fn18gHuDfYSAg4GBgIB+gn6FfYV9gnyAe396fnl9eX14fHd8dnx1fHR8dHxze3J7cXtwe297bntte2x6a3pqeml6aXpoemd6ZXtke2N7Y3tie2F7YXtge198X3xefF58XXxdfFx8XH1bfVt9W35aflp+Wn5Zf1l/WIBYgFiAWIFYgVeCV4JXg1eDV4NXhFeEV4VXhVeGV4ZXh1eHV4hXiVeJV4pXileLWItYjFiMWI1YjVmOWY5Zj1qPWpBakFuRW5FbklySXJJdk12TXpRelF+UYJVglWGVYpVilmOWZJZklmWXZpdml2eXaJhpmGqYa5dsl22Xbpdvl2+XcJhxmHKYc5l1mnibfZ2Eno+bkoqFgnuBgH+Afn9/f39/f39/f39/gH6AfoB+gH2AfIB8f3x/fH58fnt+en55fnl+eH51fXN7dXx3enh6eHp4eXh6dnp2enV5cHZqdmF1WXlZgVWIVY1Wj1iSWpNck12SXpJekV6RXpFekl+SX5Nfk1+UX5RglWCWYZZhl2KYYphjmWSaZZpmm2ebaJxpnGqda51snm2eb55wnnKfc591n3eeeJ56nnydfpyAnIGagpmDmISWg5ODiYSDhYSGhoaFh4SFgoR/g3+CfoJ+gn+Bf4F/gX+Af39+f39+gH2CfYR8g3yDe4N3g3KBeYN2gXeKd5F2lW+YbpZulG+ScJByj3SOdo13jHmMe4t8in2Kfop/iX+If4iAh4CHgIaAhoGFgYWBhIKEgoSCg4ODg4OEg4SEhYSGhIaEh4SIhYiFiYWJhomGioeKh4mHiYeJh4iHiIeHhoaGhoWFhYWFhISEhIODg4ODgoOCg4GCf4F+gIB/gH+Af4F9gX2BfYN9hH6Cf4KAgoCDgIN/gn+FfoZ/gYB/gIKAgHqHeYl7iH+EgX+BiIOBhIGCh4OIhIODgoOAhH2DgIJ/gn+Af4F+gX6BfYB9fn59gH2BfoF/gH6AfYB7gnuEfIN8gXyAe356fnl9eHx3fHZ8dXx0fHN8cntxe3B7b3tue217bHtre2t7antpe2h7Z3tme2V7Y3xjfGJ8YnxhfGB8YH1ffV99Xn1dfV19XX1cflx+W35bflt+W39af1p/WoBZgFmAWYBYgViBWIJYgliCWINYg1iDWIRYhFiFWIVYhViGWIZYh1iHWYhZiFmJWYlailqKWotai1uLW4xbjFyNXI1cjl2OXY5dj16PXpBfkF+RYJFgkWGRYZJikmOSY5Nkk2WTZZNmlGeUZ5RolWmVaZVqlWuWbJZslm2WbpZvlnGWcZVxlXOWc5d0mHWZdpl4mnybgZyHnI2ZiYmBg3uBgX+Af39/fn9+f39/f39/gH+AfoB+gX2AfIB7f3t/e398fnt+en56fnl+eX53fnZ9dHp1eXd5d3l2eHR4dHpzem55YXZYdVV4U31Tg1WJV4xZjluPXZBekF+QYJBgkGGQYZBhkGGRYpFikmKTYpNjlGOVZJVklmWXZpdnmGeZaJlpmmqaa5tsm22cbpxwnHGdcp10nnWed554nnqee519nX+cgJyCm4OahJmFl4WWhI2DhYSEhoWEhIeEhoOEgYOAg3+Cf4KAgoCCgIGAgIB/f39/f4B/gX6CfoJ9g3yGfoN8gHODdoJ0gneLd5J4kXWScJhvlXCScpBzjnWNd4x5i3uLfIp9iX6Jf4iAiIGHgYeBhoKFgoWChIOEg4ODg4ODhIKEgoWChYKGgoeCh4KIgomDiYOKg4uEi4SMhYyFjIaNhoyHjIeMh4uHi4eKhomGiYWIhYeEh4SGg4aDhYKFgYWBg4CDfoCAgIB/f35/fX99gH2CfoOAhICBgIGBgYGCgYJ/gYCEgIWBgYCAf4F+gYCGgImAhIKAgIODg4SAgoKChYKEgX+CgIN/hn2EfoN+gn+DfYJ8gX2BfYB9f35+f35/foB9gHyAe4B7gXuCe4J7gHt/en55fnh9d312fHV8dHxzfHJ8cXxwfG98bnxtfGx8a3xqfGl8aHxnfGZ8ZnxlfGR8Y35ifmJ+YX5hfmB+X39ff15/Xn9df11/XH9cgFyAXIBbgFuAW4FbgVuBWoFaglqCWYJZg1mDWYNZg1mEWYRZhVmFWYVZhlmGWYZahlqHWodah1qIWohbiVuJW4pcilyLXItdi12MXYxejF6NXo1fjl+OYI5gj2GPYZBikGKQY5BkkWSRZZFlkWaSZ5JnkmiSaZNpk2qTa5RslGyUbZRulW+Vb5ZwlnGWcpdzl3SXdpd7lXiWdpp3mnibept8nH+chJyJm46Zj42Dg32Bf4CAgH9/fn9+f35/f39/f3+Af4B/gX2BfIB8gHt/e357fnt+e356fXp9en13fHR7dnx1enZ4dHhzeGp1Z3dfdlp2WnZYeFZ7VYBWhFiIWopcjF6NX41gjmGOYo5jjmOOY49kj2SQZZBlkWWSZpNmk2eUZ5VolWmWapdql2uYbJhtmW6Zb5pwmnGbcpt0nHWcdp13nXmeep58nn2df52AnYKcg5uEmoWZh5iIl4mWhYmEhIeChoGGgoeDhoKEgYSBg4GDgYKBgoGCgIGAgIF/gH6Af4F/gX6AfYJ9hH2IgIWAgXmBeYJ7g3mOd5V3lHeRc5Vwl3GTc5F1jneNeYx7i3yKfol/iYCIgYiCh4KHg4aDhYOEhISEg4SDhIKFgoWChYGGgYaBh4GIgYiBiYGKgYqBi4GMgo2DjYOOhI6Fj4WPho+Gj4eOh46HjYeMhoyGi4aKhYmEiYSIg4eCh4KHgYV/hH6CgICAf4B+f3x+fH58gH6BgIKAgoCBgIGAgIGAgYGAgYCCgIOBgoKBgH+Af4GAhIiGhYKAgoKEgYKBgoOChIKDgYGBfYN8hH2DfIN8g3yDfIJ8gXyAfX99f35+fn1/fX98f3t/e4B6gHqBeoB6gHl/eX54fnZ9dX10fXN9cn1xfXB9cH1vfW59bX1sfWt9an1pfWh9Z31mfWV9ZX1kfmN+YoBigGGAYYBggWCBX4FfgV6BXoJdgl2CXYJcglyDXINcg1yDW4RbhFuEW4VahVqFWoVahlqGWoZahlqHWodah1qIWohaiFqJWolaiVuKW4pbiluLXItcjFyMXI1djV2NXo5ejl6OX49fj1+QYJBgkGGRYZFikWKSY5JjkmSTZZNlk2aTZpRnlGiUaJVplWqVa5VrlmyWbZZul26Xb5dwmHGYcplymXOadJp2m3ibfJt/lHeYeJ16nXydfZ2AnYOdhpyKmo+YlJOIhIJ/fYKAgH+Afn9+f35/fn9/f4CAgIB/gH+AfX9+gHx/e316fXt9e316fHl7eXt1e3V8dXt0enZ6cHZjc11yW3RbdVp2WnhZelh9WIBZhFqGXIheil+LYYtijGOMZIxljWWNZo5mjmePaJBokWmRaZJqk2qUa5VslmyWbZdumG+YcJlxmnKac5t0m3Wcdpx3nHmdep17nX2efp2AnYGdgp2EnIWbhpuHmoiZiZiKl4yViYyGgoiDiIOHg4eChoKEg4OCgoKCgoKCgoGBgYKBgIJ/gn+CgIJ/gn+Bf4F+g3+FgYV/gXt+eoB4g3aSdZh2lXaTdpBzlXOUdJF3j3mNe4t9in6JgImBiIKIg4eDh4SGhIWFhIWEhYOFgoWChYGGgYaBhoCHgIeAiICJf4l/in+LgIyAjICNgY6Bj4KPg5CEkIWQhZCGkIeQh4+Hj4eOh42GjIaLhYuFioSJg4iCh4GHgIR/gX+BgYCAf399fnt9fH99f3+AgYCAf4GAgYCAgYCAgYGAgICAgIGBgoKBf4B9gHuAfoKEhISChIGEf4KCgoODgoSChoGGfYV7hHuDe4N8gnyBfIF8gHx/fX59fn59fnx+fH97f3p/en95gHmAeYB4f3h/d352fnV+dH5zfXJ9cX1wfm9+bn5tfm1+bH5rfmp+aX5of2d/Zn9mf2V/ZH9jgGOAYoJigmGCYYJggmCDX4Nfg16DXoRdhF2EXYVdhVyFXIVchlyGXIZch1uHW4dbiFuIWohaiFqJWolaiVuKW4pbiluLW4tbi1uMW4xbjVuNW41cjlyOXI9dj12QXZBekF6RXpFfkl+SYJJgk2CTYZRhlGKVYpVjlWOWZJZllmWXZpdml2eXaJhomGmZaplqmWuZbJptmm6ab5twm3GbcZxynHScdZ12nXeeeJ55n3yff51/mXubfJ5+nn+egZ6DnoWdiJuLmY+Wk5OVjImBgIB+goCAfn9+fn5+fn9/f4B/gICAgICAfoB9gH1/fX17fHp7eXp5eXp5eHp1enV7dHt1e3V6dXpic11zXHRcdVt3Wnlae1p+WoBbg12FXoZgh2GIYolkiWWKZopmi2eMaIxpjWmOao9rkGyRbJJtk26Ub5VvlnCXcZhymHKZc5l0mnWbdpt4nHmcepx8nH2dfp2AnYGcgpyEnIWchpuHm4iaiZmKmIuXjJaMlY2TiY2GgoeBh4KGg4aDhYOEg4ODg4OCg4KDgoOCg4GCgIKAgoCCf4J/gX+Bf4CBgn6Df4N9gHx/doFyhm6TcpZ1lHaTdpJ3j3aSdpJ4j3uMfYt+ioCJgYiCh4OHhIaFhoWFhYSGhIaDhoKGgoaBhoGHgIeAh4CHf4h/iH+Jfop+i36Lfox/jX+OgI+Aj4GQgpGDkYSRhZGGkYeQh5CHj4eOh46HjYaMhouFioWJhIiDh4GFf4N+goCBgX+AfX59fnx9fH59f39/gH9/gIGAgICBgICAgYCAgICAgICAgICDgYF/gH+Bf36BgISDhYKEgYGAg4KEgYWBhX+FfYR8g3uCe4F7gHyAfH98fnx9fX19fH17fnt+en96f3l/eH94f3d/d392f3Z/dX50fnN+cn5xfnB+b35ufm5+bX5sfmt/an9qf2l/aH9nf2aAZYBlgGSAZIFjgWOBYoJhgmGCYYJgg2CDX4NfhF+EXoVehV6FXYVdhl2GXYZdh12HXYdciFyIXIhciVuJW4lbiluKW4pbi1yLXItcjFyMXI1cjVyNXI5djl2PXY9dkF6QXpFekV+SX5Jfk2CTYJNhlGGUYpVilWKWY5Zjl2SXZJdlmGaYZphnmWeZaJlpmmmaapprm2ybbJttnG6cb5xwnHGccpxznHScdZ12nXedeZ16nnuefJ9+n4Cegp2BnICdgZ6CnoOehJ6GnYebiZmLlo6Tko+VjJCJhYF+gYCEfn9+fX5+fn5/f4B/gICAgICAf4B8gHp9fHx6fXd7dXl4d3l4eHl2eXZ6dHt1e3V7aXZfc15zXXRcdlx3W3lbe1x8XH5dgF6CYINhhGOFZIVlhmaGZ4doiGmJaolrimyLbYxtjW6Ob5BwkXGScpNzlHSVdZZ2l3eYeJh5mXqae5p8mn6bf5uAm4Kbg5uEm4WahpqImomZipmKmIuYjJeNlo6Vj5SPk4+Rjo+Hg4mAiIGGgoWChIKDg4ODg4SChIOEgoOCgoGDgYN/g4CCf4J/g36CfYJ/g3yBe4B3fXd+cYNqkWyTcpJ3kXiSeJJ3kXqOeo96j3yNfouAiYGIgoeEhoWGhYWGhYaEhoSHg4eCh4GHgYeAh4CHf4d/iH+Ifoh+iX6JfYp9i32LfYx9jX6Ofo9/kICQgZGCkYOShJKGkYeRh5CIj4iOiI2HjIeMhouGioWJhIeDhoCEfoJ/gYCBgH+Afn5+fXx9fH99f35+f36AfYF8gH+AgYCAgICBgICAgIB9gH6Cf4J/gH6Afn5+fX+Cg4OEgYN/g4GDgYSAhH+DfYJ8gXyAe398fnx9fH18fHx7fXp9en15fnl+eH53fnd+dn52fnV/dH90fnN+cn5yfnF+cH5vfW59bX5tfmx+a35qfmp+aX9of2h/Z39mf2V/ZYBkgGSAY4FjgWKBYoFhgWGBYYJggmCCYINgg1+EX4RfhF6FXoVehV6GXoZehl6HXoddh12IXYhdiF2JXYldil2KXYpdi12LXYtdjF6MXo1ejV6OXo5fj1+PX5BfkGCRYJFhkWGSYZJik2KTY5RjlGSVZJVllmWWZpdml2eYaJhomGmZaZlqmWuaa5psmm2abptum2+bcJtwm3Gbcptzm3SbdZt2m3ebeZt6m3ubfJx+nH+cgZyCnISchZuFm4WbhZyGnIeciJuJmomYipaLk42OkIqTh5SIjIiDfn6CfYJ+fX19fn1/foB/gH+AgH+Af4B7fn2AfH56fnJ8c3h4dnp3d3l3end7dXt1e3V8YnVec15zXXRddVx2XHhdeV17XnxffWB+YX9jgGSBZYFmgmeCaYNqg2uEbIVthm6Hb4hwiXGKc4x0jXWOdpB3kXiSeZR6lXuVfJZ9l36XgJiBmIKYhJiFmIaYiJiImImYipeLl4yWjZaOlo6Vj5SQlJCTkZKQkY6MjYyHhoqBh4GGgoWDhIODg4ODg4SDhYKFgoSChIGDgIOAhICEgISAg3+DfYF+gXyBeX90f22EYo1hk2uOdY16jn2QfJN4knyQfI97jnuNf4qBiYKIg4eFhoaFhoSHhIeDh4OHgoeBh4GHgId/iH+Ifoh+iH6IfYl9iX2KfIp8i3yLfIx8jXyOfY9+kH+RgJGBkoKShJKGkYeQiI+IjoiNiIyIi4eKhomGiIaHhYSDg3+CgIGBgn+BgICAf4B8fHp+e398fn59f32AfIB7gXuBfYCAgIGAgICAfoB8f32Af4F/gX6BfH97fXx/gIGCgIN/goCCgIJ/gX6BfoB9f3x+fH18fHx7fHp8eX15fXh9d313fXZ+dX51fnR+dH5zfnN+cn5xfnF9cH1vfW59bX1sfWx9a31rfWp9aX1pfWh9Z35nfmZ+ZX5lfmR+ZH9jf2N/YoBigGKAYX9hf2F/YIBggGCAYIFggV+CX4Jfg1+DX4Nfg16EXoRehV6FXoVehl6GXoZeh16HXoheiF6JXolfiV+KX4pfi1+LYIxgjGCMYI1hjWGOYo5ij2KPY5BjkGORZJFkkmWSZZNmk2eUZ5RolWiVaZZqlmqXa5drl2yYbZhtmG6Zb5lvmXCZcZlymnKac5p0mnWadZl2mXeZeJl5mXqYe5h8mH6Yf5iAmIKYg5iFl4eXiJeIl4mXiZiKmIuYi5eMloyUjJGMjYyJjYOQgZCCioaEgn6BfoB9gX5+fXx+fH99gH9/f39/fIB9fn9+foB8fnd7dnZ6dXl2eHl3enZ6dXt1fGt6XnRec11zXXRddV11XXZdd154X3lgemF7YnxkfGV9Zn1nfml+an9rf2yAbYFvgXCCcYNzhHSFdoZ3iHiKeot7jXyPfpB/kYCSgZOClIOUhJSFlIaUh5KHj4qSjJWNlo2VjpSPk5GUkZSRlJGUkpOSkpGQjYyNjIuLhIKFhYmGh4OFgoSCg4OCg4ODgoSChIKFgoWBhIGEgYSBg4CDgIOAg3+Cf4F/gX2BeYNziG6LbY9vi3GKd418jH+OfJJ7kHyRe5B9jnuOfoyBioKIhIeFhoaFh4SHg4eCiIKIgYiBiICHf4h/iH6IfYh9iH2JfIl8iXyKfIp8i3uLe4x7jHuOe5B8kX6RgJGAkoGSg5KGkIiPiY6JjYmLiYqIiYeIh4aGhYaDhn+Df4CBgYF9gH2AgH+Af399fXl/eX57fXx8fXt+e396gHqAe4B9gIGAgYCAgH9/f35/f4CAgX+CfYF7f3t8f32Af4F/gH+Af4B/f35+fn59fX17fHp8eXx4fHd8d312fXV9dH10fXN9c31yfXJ9cX1wfXB9b31ufW58bXxsfGt8anxqfGl7aXtoe2h7Z3tnfGZ8ZXxlfGR8ZHxjfGN9Yn1ifWJ9Yn1hfmF+YHxgfF98X31ffV99X35ffl9+X39ff1+AX4BegF6BXoFegV6CXoJegl6DXoNfhF+EX4VfhV+GX4Zgh2CHYIdgiGGIYYlhiWKKYopii2OLY4xkjGSNZY1ljWaOZo5nj2ePaJBpkGmRapJrkmuTbJNtlG2UbpRvlW+VcJVxlnGWcpZzlnOWdJZ1l3aXdpd3l3iWeJZ5lnqVe5V7lHyUfZN+k3+SgJKBkYKRhJGGkIeQiY+KkIuQjJGNko6SjpKOkI6PjYyMiIuEin2Meo1+h4WCgn+AgoJ8g32AfXp+en57fn19f35/fH6AfIB+fn56e3p7fHp8eHh4dnl0enR7b3tkeF11XXNdc11zXXNddF10XXVedV92YHdhd2J4Y3hkeWZ5Z3poemp6a3tse218b3xwfXF9c350f3aAeIF6g3uEfYZ/iICKgouDjYSOhY+GkIeQiJGJkIaLhYeFh4WIh4qJjYmNh4mIiY2OlJWVlZSUlJKUkY2KhoWFhoOHgoKCgYGFhISEgoKBgYGCgYKCgoOChIGFgYSAhIGDgYOAg4CCgIKAg3+Cf4J+gXuBd4V2h3iHe4R8g3iDfIV9iX2Nfo9+k3yPfI59jnyOe49+jYKKhIiFh4aGhoWHg4eCiIGIgYiAh3+Hfod+iH2IfIh8iHyJe4l7inuKe4t7i3uLe4x6jHqNeZB5knyTgJF/kn+ThJGHj4mOioyKi4qKiYiJh4iFh4SGgoZ/iH+GfoF9f358fnuAf3+Afn95gHeAeH56fXt7fXp9en55fnl+en57gH2BgICAgIB/f31+f3+BgIKCgoKBgX58f3t/fX9/fn9+f31/fX58fnt+en15fXh8d3x2fHV8dHxzfHJ8cnxxfHB8cHxvfG98bnxtfG18bHxre2t7antpe2h7Z3tnemZ6ZnplemV5ZXlkemR6Y3pjemJ6YXphemF6YHpgemB7YHtge2B7XnheeF55XnleeV16XXpdel17XXtde118XXxdfF19XX1dfV19Xn5efl5+Xn9ef16AX4BfgV+BX4JggmCCYINhg2GEYYRihWKFY4VjhmSGZIdliGWIZohmiWeJaIpoimmLaotqjGuMbI1tjm6Obo9vj3CQcJBxkHKQcpFzkXSRdJJ1knaSd5J3kniSeJJ5knmSepF6kXuQe5B8j3yOfY19jH6Mf4uAioGJgomDiISHhoeIh4qIjImOipCLkYyRjJCKjoiNhYuAiHqJdIp6hYSBgn6Afn+AgH2BgHt/en17ent6fHp/en59fXh7dn15fXh/en53emt3XnJdc1x0XHVbdFtzXHNcclxyXHJdcl1zXnNec190YHRhdWJ1ZHVldmZ2Z3Zpd2p3a3dsd254b3hxeXJ5dHp1end7eX17fn1/f4GCg4SEhoaHiImKiouLjIuMi4yGh4WFh4aGh4WJhYmEioSKhYmGiYWIhYuLjo6Qj4+Ni4eGh4eGh4OJgoSAf4B/f4CAgH9/gH6CgIKCgYOBhIGEgISAg4CDgIKAgYGBgIKAgn+CfoF9gXuCe4R7hHyCf4F+gn2DgIF/hH6Mf45+j3+MgI1+jn2PfI16joCMg4qFiYWHhYaGhIaDh4KHgYeAh3+Hfod9h3yIe4h7iHuJeol6inqLeox6jHqNeo16jHmMd492knmUfop/jIKQiY6KjYuLi4qLiYqIioeJhYiEiIKIgYiAiYKIgYF/fX57fnt+fn2Cd4F1gHaAd355fHt6fHl8eX15fXl9enx6fHx8fX6Bfn95fHp8fH2BfoKBgoKCgX9+fXx+fHx+fH97f3p+en55fnh+d312fXV9dHxzfHJ8cXxwfG98b3xufG18bXtse2x7a3tqe2l7aHtoemd6Z3pmemV6ZHlkeWN4Y3hjeGJ4YnhheGF4YHhgeGB4X3hfeF54XnheeF54XnheeF54XHVcdlt2W3Zbdlt2W3dbd1t3XHdcd1t4XHhceFx4XHlceVx5XHlceVx6XXpdel17Xntee158XnxffF99X31gfmB+YX5hf2J/Yn9jgGOAZIFlgWWCZoJmg2eDaINphGqFaoVrhmyGbYduh26Ib4hwiXGJcopyinOKdIt1i3WMdox3jHeMeIx4jHmMeYx6jHqMeot6i3uKe4p7iXuIe4d7hnyFfIV9hH2DfoJ/goCBgYCCf4SAh4GLg4+FkYeSiJGIj4WNg4l/hHqFcYZ5goGBgYB/gX5/gHyBgn5/fHx7eHt1e3R9dX91fXF7bXxye3V+dn1peV11W3RadFp0WnRac1pzW3JbcltyXHJccV1xXXJecl9yYHJhcmJyY3Nlc2ZzZ3Noc2lza3RsdG10b3RwdXJ1dHV2dnh3enh8eX56gXyDfoaAiIKKhIyGjYiOiIuHhYWEhIaFhoWFhoSJhImDiYSKhYmFiIKIgYiCiIOJg4iFh4aHhoiFiIOJhoWDgYF/gH5+fn9+gX+Cf4KBgYKAg4CEf4N/gn+Bf4CAgIGAgIGAgX6CfYF9gX2CfoN8g32AgIB/gX5/fH99gn2Mfox/i4OKg4yBjYCMf4t+i36NgoyEi4SJhYeFhoWEhoOHgYeAh3+HfYd8h3uIe4h6iXqJeYp5i3mMeY15jnmPeo96j3qOd45zknmPgYSEgn+BhoaKiIuIi4iLh4qGioWJhImDiIKIgoiCiIOHhIOCf4F8gH18gHmDeIJ3gXeAd354fHp6e3h8d3x4fXh8ent7enx5fnmBeX95fHl7ent8e39/gYCBgH5+fn18fHl+eH94fnd+d312fXV9dH1zfXJ8cXxwfG98bnxtfG18bHtre2t7antpeml6aHpnemZ6ZXpleWR5ZHljeWJ4YXhheGB3YHdgdl92X3Zfdl52XnZddl12XHZcdlx2XHZcdlt2W3VcdVx1WXNZdFl0WXRZdFl0WXRZdFl0WXRZdFl1WXVZdVl1WXVadVp1WnVadlt2W3Zbdlx2XHZcd1x3XXddd114XnheeF94X3hgeWB5YXlheWJ6Y3pjemR7ZXtlfGZ8Z3xofWl+an5qf2t/bIBtgG6Bb4FwgnGCcYNyg3ODdIR1hHWFdoV3hneGeIZ4hnmHeYd5h3mGeYZ5hnmFeYV5hHmDeYJ5gXmAeYB5f3l+en56fnp9enx7fHx7fnqCe4d+jYKPhY6GioOEf4N7hHeGcoN7gXyGf4V/goF+fn5/foJ/fX18eX10fXF8cHxte254cXpzfXB9Z3xceFp2WXVYdFh0WHNZc1lyWXJaclpxWnFbcVxxXHBdcF5wX3BgcGFwYnBjcGRwZnBncGhwaXFrcWxxbnFvcXFxc3J1cndyeXN8dH52gXeEeYd7in6NgY+Dj4WQh4aEhISFhYSFhIWEhYGGgoeCh4KIhIaDhoGHgYeAhoGHgoeEiISGgoaChoOFhoOHgoSAg3+Bf4J+gn6CfoKAgYGAgn+DfoN9gn2AfoCAgICAgIB/gX6CfYF9gX+Bf4J+gYCCgIF+gXt/e359f3uFfoiChoeIhYqEi4ONgY2AiX+Mgo6DjYOLhImEh4SGhYSGgoaBh3+HfYd8iHuIeoh5iXmKeIp4i3iMd454j3iQeJF5knmQd4t6ioKKiIaHhYKAg4GHg4mEioWKhYqFioSJhImDiIOIg4iDh4SFhYOGgIR+f4B8gnyEfIR7g3uDeYF4fnl6end8dn13fXh8eXt7enx6fnuAe395e3l6eXp6e3l8e3x/fX5/e3x3fXZ+dX51fnR9dH1zfHJ8cXxwfG98bnxtfGx8a3tre2p7aXtpe2h7Z3pmemV6ZXlkeWN5YnlieGF4YXhgeF93Xnded152XXZddl11XHVcdVt1W3VbdVp0WnRadFl0WXRZdFl0WXRZc1lzV3JXcldyV3NXc1dzV3NXc1dzV3NXc1dzV3NXc1dzV3NXc1hzWHNYc1hzWXNZc1lzWnNac1pzWnNbc1t0W3RcdFx0XXRddF50XnRfdGB0YHRhdGJ1YnVjdWR2ZXZmdmd3aHdoeGl4anlreWx5bXpue297b3xwfHF9cn1zfnR/dX91gHaAdoF3gXeBd4F4gniCeIJ3gneCd4F3gXaAdn92fnV9dXx1e3V7dnt1e3V7dXt0enR5dHd1dnh1f3mEgYSEf3+Ceoh0gnF9c3x0f3KFdoZ+g4J/gn1/gn6Agn6BfH52fnR6dnlwfm55c3tufV17WXlZeFh2V3VXdVd0V3RXc1dyWHJYcllxWXFZcFpwW3Bbb1xvXW9eb19uYG5hbmJuY25lbmZuZ25pbmpubG5tbm9ucW5zbnVueG96cH1xgHOEdYd3inqOfpCBkIWMhYWEhYWEhYOFgoOAg4CEgYWBhYGFgoWBhIGHgoaAg4CFgYWChIGDf4N/gn+Bgn6EgYaDh3+EfoJ9g36Cf4GBgYGAgn+CfYJ8gnyBfX9+fn9+f35/f36BfYF+gICAf4KAgoGAgIGAgH2Cen99gH2CgIWEhomGh4eIiIaMg4mFiYKLgZGDkIOOg4yDiYSHhYaFhIaChoCHfod8iHuIeol5iXiKd4t3jHaNdo92kHeQd5F3kXiJeoN+gIGBiYOHg4WChYGGgYiCiYOKg4qDiYOJg4mDiIOIg4eDhoSEhIKFgIOAf4J/hICEgYSBhIODfoJ5gnd8eXZ8dH12fXh8ent7enx5fXl9e317fXh6eXp6eX18e3p4ent9d31zfHJ9cn1yfXF8cHxwfG97bntte2x7a3tqe2p7aXtoe2h7Z3tme2V6ZHpkemN6YnlheWB5YHhfeF54Xnddd113XHdcdlt2W3ZadVp1WnVZdFl0WXRYdFh0WHRXdFdzV3NXc1dzV3NXc1dyVXJVclVyVXJVclVyVXJVclVyVXJVclVyVXJVclVyVXJVclVyVnJWclZyVnJXcldyV3FXcVhxWHFYcVlxWXFZcVpxWnFbcVtxXHFccV1wXXBecF9wX3FgcWFxYnFjcWRyZXJlcmZzZ3Noc2l0anRrdWx1bXZudm93cHdxeHF5cnpzenR7dHx1fHV8dX12fXZ+dn52f3V/dX90f3R/c35yfXJ8cnpyeXN4dHh0eXN6cntwe296bXhpdWZxaW90eHh9en56dnRwb21sbGtra2pubHh0gH19f3x7fnh5gHCCeX90e3N+bHZqdG9+aH1hfVt6V3lXeFZ2VnZWdVZ0VnRWc1ZzVnJXcldxV3FYcFhwWW9Zb1pvW25cblxtXW1ebV9sYWxibGNsZWxmbGhsaWxrbG1sb2xxa3NrdWt4bHttf26CcIZzinaOe5CCjIaEhYKCg4ODhIODgYGAgX+Cf4OBhIGFgYSBhICFgoWAhICDgIOAg36DfYJ9gX6BgX2AfoJ/gn2BfIN7gn2BfoGAgIGAgX+CfYN7gnt/fHx+e357fnx+fX5+fn5/foF/gYGBgoKAgX+Bf35/e35+fnp+c4F7gn2DgYOChoSHiIeIiISHfpKClIKRg46Di4SJhIeFhYWDhoGHf4d9iHuJeol5ineLd4x2jXWOdY91kHaRdpB3jneFfoSAgX5/g4GJg4eChoGHgYeBiIKJgomCiYOIg4iDiIOHg4aDhYSEhIKEgYSCgoGGg4eEh4SHgoaCgoR/hXmBeXh+cn92fnh8ent7eXx5fHh8eHx5fHh8d3d8eXp4fHt7fHV8c3xwfHB8b3xvfG58bntte2x7a3tqe2p7aXtoe2d7Z3tme2Z7ZXtke2N6YnphemB6YHlfeV55XXhdeFx4XHdbd1t3Wndadll2WXZYdVh1WHVXdVd0V3RWdFZ0VnRWc1VzVXNVc1VzVXJVclVyVHJUclRyVHJUclRyVHJUclRyVHJUclRyVHJUclRyVHJUclRxVHFUcVRxVHFUcVVxVXFVcFVwVnBWcFZwVnBXcFdwV3BYb1hvWW9Zb1puWm5bbltuXG5dbl5uXm5fbmBuYW5ibmNvZG9lb2ZvZ3BocWlxanFrcmxybXNuc290cHVxdnF3cndzeHN5dHl0enR7dHt0fHR9dH1zfnN+cn1xfHB7b3lwd3F1dHV1d3Z5dHtye3F7b3tsemZ5YHZhdHF6bnVpcWduY2xga11qWmhXaFZoWWtmeWx9Wm5cc2KAXYFSfVR/VXpVelV+Vn1We1Z6VnlWeFV3VXZVdVV1VXRVc1VzVXNVclZyVnFWcVdwV3BYb1hvWW5ZblptW2xcbF1sXmtfa2BqYmpjamVqZ2poampqbGpuaXBpc2h2aHlpfWqBbIVvinKPeIyBhYWEhIGBgH+AgICBgIGAgX+Bf4OAgoCDf4OAg4CEgYSBhICDgIN+g32DfIN9goCBgX5/fX9+gX2BfoJ8gHyAfIB+f3+AgH+CfYJ7gnp/ent9en17fXp9e3x7f3uCe4R+hIGGgYOAgX+Bfn9/e397gHiCdIF1gHJ/c4BxgHN+c3x6gH6BfI+Al4GUgo+EjISKhYmFhoWEhoKHgId+iHyJeop5i3eLdox1jnWPdJB1kXWRdpB3jHmDgIOCgoCAgX6JgYmBiIGHgYiBiIGIgoiCiIKIg4eDh4OHg4aEhYSEhYKGgYaBg4CJhIqFioSEgIOBgoSBhICBf32AdYB4fXp7e3p7eXt4fHh8eHx4fXd9cHhzcnl7dXh2e3V8b3tue217bXtse2x7a3tqe2p7aXpoemd6Z3pmemZ6ZXple2R7Y3tie2F7YHpfel56XnldeVx5XHlbeFt4WnhZd1l3WHdYd1h2V3ZXdld1VnVWdVZ1VXRVdFV0VXRUdFR0VHNUc1RzVHNUclRyU3NTc1NyU3JTclNyU3JTclNyU3JTclNyU3JTclJyUnJSclJyUnFScVJxUnFScVNwU3BTcFNwVHBUcFRwVHBVcFVvVW9Vb1ZuVm5WbldtV21YbVhsWWxabFpsW2xcbF1sXmxfbF9sYGxhbGNsZG1lbWZuZ25ob2lvam9rcGxxbXJucm9zcHRxdXJ1cnZzd3R4dHl1enV7dXx1fXR9dH1zfHJ8cHpvd3BzdHF5c3t4e3x5fXh8eXx4fXh+cXxvdXZ1bnFjb2BuXW5abVZsUmtPa0ttSnBMc1ByUHdKeUqATYFPf1B/Un5SflN+VH1Ue1V6VXlVeFR3VHdUdlR1VHVUdFR0VHNVc1VyVXJVcVVxVnBWcFZvV25XblhtWW1abFprW2tdal5pX2lhaWJoZGhmaGhnamdsaG5ncGVzZXdme2d/aINriG6Kd4V/hIKFg4SCgn+Afn9/foB/gH+Bf4F/gX+Bf4J/gn+CgIKAg4CCf4J9gn2DfIN9gn9/f31+fX59gHyAfH56fnp/e399f3+Af36AfIB9fnyAeXl7d3p5e3l8eX16gHuEfIV+hoCGf4SAgYCBfX9+e4F8gHuBdoV0iHKCb4Rwg3KCb3xufm59b456lX+SgoyFjoWMhYqGiIaFhoOHgYh/iX2Je4p5i3eMdo11jnSPdJF0knWSdo94hX+FgYOAgn+BgH2If4qBiYGIgYiCiIKIgoiCh4OHg4aEhoSFhISFhIaDh4KIgIZ/goCHhoeHg4OCgoGBf4J9gnyAfX5+d3t5ent5e3h7eHt3e3d7d3t5e3x9fYB4dXd4dXl1eXJ8bXtse2t7a3tqe2l6aXpoemh6Z3pmemZ6ZXplemR6ZHpje2J7Yntge197Xnteel16XHpcelt5WnlaeVl5WXhYeFh4V3dXd1d3VndWdlZ2VXZVdlV1VXVUdVR1VHVUdFN0U3RTdFN0U3NTc1NzU3RTdFNzU3NTc1NzU3NSc1JzUnNSc1JzUnNSc1JzUnNSclJyUnJRclFxUXFRcVFxUnBScFJwUnBTcFNwU3BTb1NvU29Tb1RuVG5UblVtVW1WbFZsV2tXa1hrWWtZalpqW2pcal1qXmpfamBqYWpia2RrZWxmbGdtaG1qbmtubG9tcG5wb3FwcnFzcnNzdHR1dXd2eHd5eHt4fHh8eH14fXh8d3t0eXFzdW19b4J3gn6DfoF/gH2AgHx+dXh4eHp3b3Jhb11wWnBWb1NvUG9NcEtySXRJdkl3SHpIfEp/TX9Pf1B/UX5SflN9VHxVe1V5VXlUeFR4VHdUd1R2VHVUdVR0VHRUdFRzVHNUclRyVXFVcFVwVm9WblduV21YbFlrWWtaaltpXWheaF9nYWdjZmVmZ2VqZWxmbWNxYnRieGR8ZYFnh2uIdYR8hH6EgISBg3+Bfn9/foB+f36Af4B+gX6AfoF/gX+Bf4J+gn6CfYJ9gnyCfIF8gX1+fHt8e3x7fXt8enp5e3h8eH56fnt+fXx/eH56eXt7eX55eXZ2eXV8doB4g3mEeYV7hX2FfoN+goCAgH5/eoB9fXqBdY5+jXuCdoR0g3SCdIB1f3KCcIp2knySfY2Bj4WNhouGiYeGh4SIgoh/iX2Ke4t5jHeNdo50j3SQc5FzkXSRdo17hIKFgYOBhICCgH2HfoqAioGJgoiCiIOIg4iDh4OHhIaEhYWEhoOHg4iDiIKIgIV/g4GDh4CEgoKDgYGAf4J9g3uBfH5+eXl6d3x3fHZ7dnt3end6dnt1enR5d315enp6entxem17a3pqeml6aXpoemh6Z3pnemZ6ZnplemR6ZHpjemN6YnpiemF7YHtfe157XXtce1x7W3pbelp6WnpZeVl5WHlYeVd4V3hXeFZ4VndWd1V3VXdVdlV2VHZUdlR2VHZTdVN1U3VTdVN1U3RTdFN0U3VTdVN0U3RTdFN0U3RTdFN0U3RTdFJ0UnRSdFJ0UnRSdFJzUXNRc1FzUXJRclFxUXFRcFJwUnBScFJwUnBScFJwUm9Sb1JvU25TblNtVG1UbFVsVWtWa1ZqV2pYalhpWWlaaVtpXGldaV5pYGlhaWJpY2plamZrZ2tobGpsa21sbm5ub29wcHJxc3F1cnZzeHR5dnt4fHl9e358f3yAfYB9gXx/fHl4dmqBaYZ2hH+CgH99fXh+en16eHx5e3t5dHdgclxyWHJVclJyUHNNdEt1SnZJeEh5SXtKfEx+Tn5Qf1F+Un5TfVR9VnxYelh6VXlUeVR5VHhUd1R3VHZUdlR1VHVUdVR0VHRUc1RzVHJUcVVxVXBVb1ZuVm5XbVdsWGtZalppW2hcZ11mX2ZgZWJkZGRnYmtjbWNvX3JgdmF6Yn9khGeEdIN6g3uCfYJ9gX5/fn59fX19fn1+fX59f31/fn9/gH6BfoF9gn2CfYN8hHqDeoB6f3l8eXp5eXl5eXl4d3d4eHd4dXp2enh7enl9c391eHV3dHp3d3V1d3B+cYFzg3WCdYR3hHuDfIN8gn6BgH6AfIB9e3aFfZKHg35+fX9+hX2GfYV7hHmFd4l5j32RgI6AjISNhoyHioiHiIWIg4mAin6Le4x5jXeOdo90kHOQc5FzknORdYp+h4KHgYWBg4GCgX2Jf4uBioKJg4mEiYSIhIiEh4SGhYWFhIaDiIOJg4qDioOIgoGBg4CAhH+CgoGBgIGAgYF/gX6Afnx8e3Z9dH10fXR7dHp1eXd5eHp4fHZ9dn53enJ2bnpsemt6anppemh6Z3pnemZ6ZnplemV6ZHpkemN6Y3piemF6YXpgemB7X3tee117XHtce1t7W3tae1p6WXpZelh6WHlYeVd5V3lWeFZ4VnhWeFV4VXdVd1V3VHdUd1R2VHZUdlR2U3ZTdlN1U3VTdVN1VHVUdVR1VHVUdVR1VHVUdVR1VHVUdVN2U3ZTdlN2U3VSdVJ1UnVSdFF0UXRQc1ByUXFRcVJxUnFScVJxUnFScFJwUnBScFJvUm9SblNuU21TbVRsVGxVa1VqVmpXaldpWGlZaFpoW2hdaF5oX2hgaGFoY2hkaWVpZ2poampra2ttbG5tcG1xbnNvdXB3cXlxe3N9dH92gXiDeoR8hXyGfYh9iH2JfoV+enCEZYR4gH58fn59fn1/fH59e357f3l8aXlfdVt1WXVWdVN1UXZPd014S3lKekp6SntMe059UH5RflJ+VH5VfVZ9VnxVelZ7VXtVelV5VHlUeFR4VHdUd1R2VHZUdVR1VHVUdFR0VHNUclRyVXFVcFVvVW9WblZtV2xYa1hqWWlaZ1xmXWVeZGBkYmNjYmVfbGJtX3Bec154X3xhgWSFboN3gnmCe4B8fnt9fH19fH17fXp8fHx8fHx+fX59fn1+fIB7gHyBfIJ8g3mDeYJ3f3Z8dnh3d3Z4dnh0eHR4c3dzdXRzdXR1dXR6b39se3B0c3VydXV0em5/b39vgHCCcIR0gneCeoF7gH2Bfn5+fnt5eneHg4qFgHx9fXt7gnqGfIZ6hX2Hfod+jn+Pgo2Di4WMhoyIi4iJiYaJhIqBi3+MfI16jXiOdo90kHORcpFyknOQd4aBh4OHgoSCgoGCgn+KgIyDi4SKhYmFiYWJhYiFh4WGhoWHhIiDioGMgouEi4WIhoCBg4F+hX+CgIB+gH1/fn9/gH5/fX51fnJ/cX5xfXF7cnpzeHV3eHd8eoB9fYF3e3B0bXlreml7aHpoemd6ZnpmemV6ZXpkemR6Y3pjemJ6YnphemF6YHpgel97Xntde118XHxcfFt7W3tae1p7WXtZe1h6WHpYeld5V3lXeVd5VnhWeFZ4VnhVeFV4VXdVd1V3VHdUd1R3VHZUdlR2VHZUdlR2VXZVdlV2VXZVdlV2VXZVdlV2VXZVd1V3VXdVd1V3VHdUd1R3U3dTdlJ2UnZRdVBzUXJRcVJxUnFSclJyUnJSclJxUnFScVJwUnBSb1NvU25TblNtVGxUbFVrVmpWaldpWGlZaFpoW2hcaF5oX2dgZ2FnY2hkaGZoZ2hpaWtpbGpuanBrcWxzbXVud255b3twfnGAc4N1hniIeol9iX2LfYp/hoGCgH1+f3iCb4B5gH58f36Be4F0eWh4Y3tkf2R/YHpeeFx3W3dYeFV5U3lSeVF7T31MfUt8THpPelF7U31TflR+VX1WfVd8WXtbfVd8VnxVe1V6VXpVeVV4VXhVeFV3VXdVdlV2VXVVdVV1VXRVc1VzVXJVcVVwVXBWb1ZuV21XbFhqWGlZaFpnW2ZdZF5jYGJhY2NfZ15rXm1ccVx1XHpdgGCFZ4NygnWAd3x6e3l5enp4enp5e3h5enl7ent6fHt7e3t8en15fXp+e357gXqDd4V0hHB9c3d4dnZ4dXl0eHN5cnlvd251b3Nwc3J2bn5me25xcnNxdnN1eHB8bX1tf2+DboJzg3WDeH56eXmAeX2AfXt6f36Eh4SEf35+e3l3fXZ/doF1gXKBc4J4h4KJhomJioqNiI2IjIiKiYeKhYqCi3+MfY16jniPdo90kHORcpFykXOMeoeBh4KFgoOBg4GDg4GFgIiDioaLh4qHioeJh4mGiIeGh4WIg4mCi4CIgIaDiIeFh4GDgoN+hH+BgIF9gXt/en58fn1/c4Fuf25+bn5ufW57b3lwd3J1dXR5dn17f4F9fnZ5bXtqe2h7Z3tnemZ6ZnpleWV5ZHlkemN6Y3pjemJ6YnphemF7YHtge197Xntde118XHxcfFt8W3xbfFp7WntZe1l7WXtYelh6WHpXeVd5V3lXeVZ5VnhWeFZ4VnhVeFV4VXdVd1V3VXdVd1V3VXZVdlV2VndWd1Z2VnZXdld3V3dXd1d3V3dXd1d4V3hXeFd4V3hXeFZ4VnhWeVV5VHlSeVB2UHNTclNyVHNTc1NzU3NTc1NzU3JSclJxUnFTcFNwU29Tb1NuVG1UbVVsVmtXalhqWWlaaVtoXGhdaF5oX2dhZ2JnZGdlZ2dnaWdqaGxobmhwaXJqdGp1a3dseW18bn5vgHCEcYd0ineLe4qAiICEgYGCgIN9f319g3uCe4F7fH97gnuCdX5zfmF6XX1df19+X3teel55Xnlee11+Wn5Yelh9V4FUg1GCUXtUdld5WH1YgFZ+WHxXfVd9V31Xfld9V3xWfFZ7VnpWelZ5VnlWeFZ4VnhWd1Z3VnZWdlV1VXVVdFV0VXNVclZyVnFWcFZvV25XbVdrWGpZaVloWmZbZV1jXmJfYGNgZV5oXGtbblpzWnhafl2EYoFuf3F+dHp5eHh2d3d2dnZ1d3Z3eHZ5dnp3e3h6eXp6eXt3fXh7eXx6fnuAfIN5hXF+dXV5dnd5dHp0enR5cnpremZ0aG5qbm9wbnVqe2x5cnFycnJzdG54antqgGyCboBxgXGBdXx7cnl8cn5/fXt+foR/iIOAgHt/eX13fXV+dn92hHSJeYp+iXyLf4yIjouViZGIj4mMiYmKhouDjICNfY57j3iPdpB1kHORc5FzkHOJfYeAh4CEgYOChIKDg4KFgYSDhIeLiYyIi4iLiIqHiIiHiIWJg4qCi4CKf4WDgYSAhIKCgoR/hICDfoJ8gnuBe32AfnaBb4Rsf219bX5sfWx7bHltd250b3Jycnd1fn5+f3Z+a31pfGd8Z3tmemZ6ZnpleWV5ZHlkemN6Y3pjemJ6YnpiemF7YXtge197X3xefF58XXxdfFx8XHxcfFt8W3xafFp7WntZe1l7WXpZelh6WHpYelh5V3lXeVd5V3lXeFZ4VnhWeFZ4VndWd1Z3VndWd1Z3WHdYd1h3WHdYd1h3WHdYd1h3WXdZeFl4WXhZeFl5WXlaeVp5Wnlbelt6W3xZf1J+T3NWcVZ0VXRVdVR1VHVUdFR0U3RTc1NzU3JTcVNxU3BUb1RvVG5VbVZtVmxXa1hrWWpaaVtpXGheaF9nYGdiZ2NnZWdnZ2hmamdsZ25ncGdyaHRodml5antrfWx/bYFug26Gb4pyi3mHf4KDg4SDgIGBfoF4gH5+f3l9dnZ1cnp0fXaBcoFzf2J9Xn5efl99X3xge2B6YXlieWh6bX9ngGN9bH1zgHeDeIFyfm16ZnxifWd/YH9Zf1l+WH5Yflh+WH1YfFh8V3tXe1d6V3pXeVd5V3hXeFd4V3dXd1d2V3ZWdVZ1VnRWc1ZzV3JXcVdwV29XblhtWGtZallpWmdbZlxkXWNfYmFgY15mXGhabFlwWHZYfFqEYIBufHJ6dHd2c3l2dXVzdHR1dXZ2d3Z5dnp2end5eHl5eXp1fHZ6eHl4enp7e3x6fnOAeXl7d3d6dXx2fHh9dn1tfmN6Ym9oaGxsbHRreWt5cHNycW9vcWl4Znxnfml9a3ttf25/c3l6b3l7c354gniFe4d/goF7hHqBd351fHV8dX12fneCeoR9g32Gfot8i4OTh5WIkomOiouLh4yEjYKOf458j3mQd5B1kXSRc5Fzj3aGf4l+hX2Ef4SBhIKFg4ODg4ODgYKEh4qKjoiMiIuIiYiHiYWKg4uBi4GFgYGEf4SBhIODgISAhYCCfoJ+gH1+gX97f3OEc4V2gHR8bn9rfmt8anlqd2p1anNqcWlxbnhyfmqAaH5nfWd8Z3tme2Z6ZnplemV6ZXpkemR6ZHpjemN6Y3pje2J7YnthfGF8YHxgfF99X31efV59XX1dfVx9XH1cfFt8W3xbfFp7Wntae1p7WXpZell6WXpYelh5WHlYeVh5WHhYeFh4WHhXeFd4V3dYd1h3WXhZd1l3WXdad1p3Wndad1p3Wndad1t4W3hbeFt4XHlceVx5XXlfeWF5ZXlre3aAc31idFp3WHdXd1Z2VXZVdlV2VHVUdVR0VHNUc1RyVHFUcFVwVW9WblZtV21YbFlrWmtbalxpXWhfaGBnYmdjZ2VmZ2ZoZmpmbGZuZnBmc2Z1Z3dnemh8aX9qgWuCbIRuhW6HbopyhH+BgYCCgYKAgYB/foB9f35+eHRwdml2Zndqd3N8coF0gGp/YX5gfmB9YXxhe2F6YXlieWF6YoBlgGd6aHFxdnl7d3x0g22CX4Fbf1mAWoFagFp/Wn9aflp+WX5ZfVl9WXxZfFl7WXtZell6WXlYeVh5WHhYeFh3WHdYdlh2WHVYdFh0WHNYclhxWHBYb1huWWxZa1pqWmhbZ1xlXWReYmBgYl5kXGZaaVhtVnNVe1eCX3xseHB4dHJ1cXVzdXRzdXR1dXd2d3Z4dnl2eXZ5d3h5eXp0fHV7dnl2eXZ4d3l0e3B+fHx8eXd6dHp4eXx9fYJ7gnWCanZuZW9pbW9tdG14b3VvcG5tdGl5Zntke2R5Z3tpfWt6cHZ3cH58cX9vh3OLe4aBgYF5gniFdoJ0gHR9dHx1fHd8eX17fnyCfoZ+iX6Mg5KGlYmRio2LiYyGjYOOgI99kHqQeJF2knWSdZF1jnmFgYh+hn6FfoR+hICEgYKCg4KEgoKCgoOGjoeOiIyIioiIiIWJg4uBiIKDgoGGf4WChIKEgoR/hYCEgIN/gn+BgH92gHCCc4F5gXeCbYFqfml8aXlpd2h1Z3Rlc2N0YXlkfGZ9Z31nfGd8Z3tne2d6ZnpmemZ6ZXplemV6ZXplemR6ZHtke2N7Y3xjfGJ8Yn1hfWF9YH1gfWB9X31ffV59Xn1efV19XX1dfFx8XHxcfFt7W3tbe1t7Wntaelp6WnpZell5WXlZeVl5WXhZeFl4WXhZeFl4W3hbeFt4W3hbeFx3XHdcd1x3XHhceFx4XHhdeF14XXheeF54X3hgd2J1ZnRqc2hzX35egVt7WXpYeVh4V3hWeFZ3VndVdlV2VXVVdFV0VXNWclZxVnBXb1huWG1ZbVpsW2tcal5qX2lgaGJoY2dlZ2dmaWZrZm1lb2VxZXNldmV4ZXtmfmeAZ4NphWuHbYdvh3CGcIR0gYCCgoGCf4B8f3x8fH1/fnmAcn5qe2V7Y3tkeWx5dIB1gHGAZX9jf2N+Y31jfGN7YnpkeWd6bXp0fHR8anlbdVt7WH5ZhVyFXINcglyBXIFcgFyAXIBcf1x/XH5cflt9W31bfVt8W3xbe1t7Wnpaelp6WnlaeVp4WnhZd1l3WXZZdVl1WXRZc1lyWXFZcFlvWm5abFprW2pbaFxmXWVeY2BhYV9jXWVbZ1lrVm9VeFV/Xndrdmx2cXJ0c3J0cnVyd3N3dHd1eHZ4dnh2eHV4dnh3eHh2fHV+dXx1enN5c3hwe2+Ad314eXV5cXd1cXx0f36AgIB+en14b3Jsb29uc291b3Zvcm9tdWl5ZXtje2N6Zntmfmh4cHZydnx+bINpim+GgYKDfYF4gXWDdYF0fnR9dHx1e3d6eXp7e3x+foN+hoCKgo2BlYaSio6Mi42HjoSPgZB+kHuReJJ2k3aTeJF7jn6Gg4l/hn6GfYZ9hX6Df4KBhIKEgYODgoKBhYOIhoyIi4iJh4aHg4aBgoKDhICIgYaEhIKEgYKAg4GEgIN/g3+Cf4B5gXB/cX5xfm6BaYBqfml8aHlnd2d0Z3RmdWN2YndleGh6aXxofGh8aHxoe2d7Z3pnemd6Z3pnemZ6ZnpmemZ6Zntme2V8ZXxlfGR9ZH1kfmN+Y35ifmJ+Yn5hfmF+YH5gfmB+X35ffV59Xn1efV18XXxdfF18XHtce1x7XHtbelt6W3pbelt5W3lbeVt5W3lbeFt4XnleeV55XnheeF54XnheeF54XnheeF54XnhfeF94X3hgeGB4YXdjd2J1Y3NfdVp8WoJbgFx9W3tae1l6WXlYeVh5V3hXeFd3V3ZXdld1V3RXc1dyWHFYcFlvWm5bbVxsXWtea19qYWliaGRoZmdnZmlma2VtZW9lcWR0ZHdkeWR8ZH9lgmaFZ4hoi2qMb4tyinOJc4Z3goCDgIGBfYF6fXt9fH95f2+Ba4Fnf2R+Yn1ifGR5antvfXF+aIBlgGV/Z35pfWd9Z31peW95cHplel18XHxafFl+WYFahFyEXYNeg16CXoJegV6BXoBegF5/Xn9ef15+Xn5efl19XX1dfF18XXtce1x6XHpcelx5W3lbeFt4W3dbdlt2W3VbdFtzW3JbcVtwW29bblxsXGtcaV1oXmZfZGBiYWBiXmRcZlpoWGxWclN4X3RocmtxbnJxdHJ3cXhyeHR4dHh0eHV3dXd2d3V4dXh2eXh5enh+d4B0gHJ8cXpve219cntzd3F2b3R0cHRvb3J2eX16e315dnVwcW9wcnJzdXZxdnJveGp6aHtmfGN8Zn1ogWh7cHlze3WFZolniXOFgoOCfIF3gnWCdIF1fnZ7dXp2enh4eXh7eH17fn6BgoKGgIl+jYOPio+MjI6Jj4aQg5GAkX2RepJ4kniLfYl+iYKFhIiAh36GfYV9hXyDfoN/hICDgIOAgIKAgoGDhIuHjIeLhoqEhoCCgYGBg4CIgYaDg4GBgoKCg4GEf4N+gn6BfIF6gHp/eXt3f3WBb39ufGx7aXpnd2dzaXFrc2l3ZHVpcmt4a3tqfGl8aXxpe2l7aXtoe2h6aHpoemh6aHpoe2h7aHtoe2h8Z3xnfWd9Z35mfmZ/ZX9lf2V/ZX9kf2R/Y39jf2J/Yn9ifmF+YX5gfmB9YH1ffV99X3xefF58Xnxee157Xnteel56Xnpeel56XnldeV55YHpgeWB5YHlgeWB5YHlgeWB5YHlgeWB5YHlgeWB5YHhgeGB3YXZhdWV4YHhde1x/XIBcf1x+XH1cfFt7W3taelp6WXlZeVl4WXdZd1l2WXVZdFlzWnJacVtwXG9cbl1tX2xga2FqY2llaGZoaGdqZmxmbmVwZXJkdWR3Y3pjfWOAY4NkhmWJZoxnkGmRdYx2i3aMdoZ9goGCgYCDeYV4g3mBeoB0gW2DaYNmgmSBY4Bif2J+Yn5jfmV/ZoBnf2t9cX1tfXF9c3xwfGh7YHxffV5+Xn5df12AXYJeg1+DYINhg2GDYYJhgmGBYYFhgWGAYYBhf2F/YX9hf2B+YH5gfWB9X3xffF98Xntee156XnpeeV55XXhdeF13XXZddV10XXNdcl1xXXBdb11uXWxea15pX2dgZmBkYWJjYGReZVxnWmhYbFVyWXJlcmlxa3Nud295cnpzeXV5dXh1eHR4dXd1dnV4dHl1enZ7eXp9eYB2g3R/d3xyfnF7cntveGxzcXNycHBwZ3NxdHZ0dnl2fXZ2c3JzcXVyd3R1dnZwemp8aHxnfWeAaH9qgWx7cXx2h3CPZY9qh3qHgYKCfYN5hHmFeIN3f3h6d3l4eHl3enZ8dn53gHmCfYGCgYV/iIKHiZKMjo6LkIeRhJKBkn6TfJR7kX2Lf4p+hYCEgoaBh36GfoR/hH6FfIN9g32CfoJ+gYCBgYGBgIOBhYGGgYeBiX+DgYGBgH+DgISDgYKBgoGDg3+Ef4J+gn6CfYF9gXx/fIB7f3uAe4B7fnh+cn1seWhzaW5ua3ZveXpycW94bXxsfWt8anxqfGp7antqe2p7antre2t7a3tre2t7a3trfGt8an1qfWp+aX5pfml/aH9of2iAaIBngGeAZ4BmgGWAZYBlf2R/ZH9jf2N+Y35ifmJ+Yn1hfWF9YX1hfGF8YHxge2B7YHtge2B6YHpgemB6Y3pjemN6Y3pjemN6Y3pjemN6Y3pjeWN5Y3ljeWJ5YnlieWF4YXhgeGB5X3pefF5/Xn9ef15+Xn5efV19XXxcfFx7XHtbelt5W3lbeFt3W3ZbdVt0XHNccl1xXnBfb2BtYWxia2RqZWlnaGlna2dtZm9lcWVzZHZjeGN7Yn5igWKEYohji2SOZpFoj2+De4h4i3iIfIGAg4KChH+HeYt8iH2De4Z3hm+HaoZnhGWDZYJkgmSBZYFlgGeAZ4Bnf2d8aHtpfGh9Zn5kfmR+ZH5jf2J/YoBhgGGBYYJig2ODY4Nkg2SDZINkgmSCZIJkgWSBZIFkgGSAZIBkgGR/Y39jfmN+Yn5ifWJ9YXxhfGF7YXtgemB6YHlgeWB4X3dfdl92X3VfdF9zX3FfcF9vX21fbGBqYGlhZ2JlYmRjYmRgZV9mXWdbaFlsWHFjcmhzaXhrem16b3txenN5dXl2eHV3dXd0eHV4dXl1e3Z8eHx7fH58f3uCf4F5f3iAdH5veXF5c3Vzc291a3tudm9zbnZufXV3dHV3cndzeHR3dntvfWp+Z35nfmZ/Z4FogWuBdH9yiWKQZI9yhICGg4GCfIN7g3mCeoF5gHt9enh6dnt1fHV9dIF1g3eDe4F/f39+f32Fg4+Jj42LkIiShpODlIGVf5V/kIGNgYqBhYCEgIaCh4CGfoR9g36DfoN+g36DfYJ/g3+DfoF/gIF/g3+Ef4V/hX+DgYKAf3+Bf4GBgIOBg4KDg4KFgYaAh3+Hf4R+hHyBe398fnt+e357fnx9fH19fnl9bXJuZ3RlgHd5eXB2bXtsfGx8bHxsfGx8bHtte217bXtte217bXtue257bnxufG19bX1tfm1+bH9sf2x/bIBrgGuAa4BrgGuBaoFpgWmBaIFogGiAZ4BngGd/Zn9mf2V/ZX9lfmR+ZH5kfWR9ZH1kfGR8ZHxjfGN7Y3tje2N7Z3tme2Z7Zntme2Z7ZnpmemZ6ZnpmemV6ZXplemV6ZHpkemR6Y3piemJ7YXxgfWB+YH9gf2B/YH5gfmB9X31ffF58Xntee156XXpdeV14XXdddl51XnRfc19yYHBhb2JuY21la2ZqaGlqaGxnbmZwZnJldGR3Y3ljfGJ+YoFhhGGIYYxikGSTaJNviXqKeIt5iH6CgIKCg4KCg36Fe4Z7hX2Dd4d1i2+La4hph2iFZ4Rng2eCaIJpgWmBaYBpf2l+aH1pfWp+a4BqgWyAa4BogWeBZoFmgmaCZoNmg2eDZ4Nng2iDaINog2iDaIJogmiCaIFogWiBZ4FngWeAZ4BmgGZ/ZX9lfmV+ZH5kfWR9ZHxjfGN7Y3pjemJ5YnhieGJ3YXZhdWF0YXNhcWFwYW9ibWJsYmpjaWNnZGVlY2ZiZ2FoYGhfZ11pXG9dcmd1aHtqeWt6bXtvenJ7dHt1enh5eXh4eHV4dXh0enR7dn16fHx5e3x/fYF6gnp/d355fXV/dXt0d3F4bHtuem13bXduenV4d3d4dnhzd3N2dnt0gWyBaYFogWh/aIZqhW5/colpjmGOaYV+hIGDgH+BfIR7g3uDe4B6f3x8fXl+dn91f3SAcYVyhnaCfX+Aen58gH+Fg4uHjIyKkIeThpWFlYOTgZCBkIONg4iDhIOFgYWBhoCFf4N+g36DfoN+g36Df4N/goCCgIF/gH9/gX6DfoN9g3+BgIGCf4CAgH+AgIOBhIOFhISGhImCiICFfIN7gnuBe4B8fHx/fX1+fn5+fn2AfX9/fH9ycG9jdmt8f3N3bXpte258bnxufG98b3twe3B7cHtwfHF8cXxxfHF8cXxxfXF9cX5wfnB/cH9wf2+Ab4BvgG+Ab4FugW6BboFtgm2CbIJsgWuBa4FrgWqAaoBpgGmAaYBof2h/aH9ofmd+Z35nfWd9Z31nfGd8Z3xnfGd7anxqfGp8aXxpe2l7aXtpe2l7aXtpe2h7aHtoe2h7Z3tne2Z7Zntle2V8ZH1jfmN+Y39jf2N/Y39jf2J+Yn5hfWF9YXxgfGB7YHtgemB5YHhgd2F2YXVidGJyY3FkcGVuZm1oa2lqa2ltaG9ncWZzZXVkeGN6Y31igGKCYYVhiGGLYJBhlWWYbY14h3qKe4h/goGBgYSDgIF8fnl/eX98gXiFc4p0jW6NbIpriGqHaoVqhGuDbINsgmyCbIFsgG1/bX5vfXR+doBwg2+CbYNsg2uDa4Nqg2qDaoNrg2uDa4Nrg2yDbINsg2yDbINsg2yCbIJrgmuCa4JrgWuBaoFqgWmBaYBpgGh/aH9ofmd+Z31nfWZ8Znxme2V6ZXpleWR4ZHdkdmR1ZHRkc2RxZHBkb2RtZGxlamVpZWdmZWdjaGJqYmtiamJoYGlccGJ2Zndoemd9aX5ufXN+dX12fHd5d3d3d3Z4dXh1eHR6dHl2ent5fHt9eX56gHuAeoF5gXSCdoB2fXR8cH1wfG55cHhyeHZ4d3d4dnh0eHR5dn11gnCDbYJtgmqEaItuh2+Eb49jj2iGeId/hIGCf36Ae4B6gXuBen98fn58gHqCeIN0g3OGcYlziHeEfn+DfoKBg4GGg4iFiYaIiYSNhY6GjoiNgo2EioWJhoeEhYaFhYaAhX+Df4N/hH6DfoJ+g36Cf4J/gX+AgH+AfoB+gH2BfIN+goGCgIKBgoB/f39/f4OAhYOHh4iKhYmFiYGIfIN6gXqBfH9+fXt9fn1+foB/f32AfoB/f4B9fnRtbWludG54bnhveXB6cHtxe3J7cntze3N7c3x0fHR8dHx0fXR9dH10fXR+dH50f3R/dIBzgHOAc4FzgXKBcoFygXKBcYJxgnCCcIJwgm+Cb4Jugm6CboFtgW2BbYBsgGyAbIBsf2t/a39rfmt+a35qfWp9an1qfGp8bX1tfG18bXxsfGx8bHxsfGx8bHxsfGt8a3xrfGp8anxqfGl8aXxofWh9Z35nfmd/Zn9mgGaAZoBmf2V/ZX9kfmR+ZH1jfWN8Y3tje2N6Y3ljeGN3ZHZkdGVzZnJncGhuaW1ra2xqbmlwZ3JmdGV3ZHljfGN/YoFihGKGYYlhi2COYJRhlmuQd4R8iHqJf4KBgIGDhYKEfYN5gXh9eX54gXSHcYpzi26NbottiW2IboZuhW6Eb4NwgnCCcIFwgHF/cn52fXt+en90hHKFcYVwhG+Eb4RvhG+Eb4RvhG+Eb4RvhHCEcIRwhHCDcINwg3CDcINvg2+Cb4Jvgm6CboJugm2CbYFsgWyAa4BrgGt/an9qfmp9aX1pfGl8aHtoemh5Z3hnd2d2Z3VndGdzZ3JncGdvZ21nbGdqZ2hoZ2hlamNsYm5kb2hrZmhfbV12ZHlofmmEbYNvgnOCd4B6fXt6e3h5eHd4dnl2dnd0dHJ0dHd1enh9e3x6fnmAd4F1gXSBdoF2f3R9c31zfnB6dHd1d3h2eXd5d3p3fHZ8d391gnGCcIJvhmuKbIpwhnONZZRkjXOFfYN/goKCgX1+en17fHp9fH1/fYF7g3qEeIRziHGMc4p4h36FgoOIgoOCgIKChYKEg4SDhn6JfYaDgoSEgoOFhYiEiIaFhIWEhIaChH6CfoJ/g32CfYJ9gn2BfoB/f399gHyAe398fnx/fX9+fn1/fX+Af4CAgH9/f4GAhoKEhYKFgYaBhX6GfIN7g3uBfH9+fX2Afn2AfIF+f36AfX9+f39+gHt8cW1ucG50b3VxdnJ4c3p0enV7dXt2e3d8d3x3fHh9eH14fXh9eH54fnh+eH94gHeAd4F3gXeBd4F2gXaCdoJ2gnWCdYJ0g3SDdINzg3ODc4Nyg3KDcYJxgnGCcYJwgXCBcIFvgG+Ab4Bvf25/bn9ufm5+bn5tfW19cX5wfXB9cH1wfXB8cHxvfG99b3xvfG58bnxufW59bX1tfW19bH1sfWt+a35rf2p/aoBqgGmAaYBpgGiAaH9of2d/Z35nfmZ9ZnxmfGZ7ZnlmeGd3Z3ZodWhzaXJqcGtvbG1ua29qcWhzZ3VleGR6Y31igGKDYoViiGGKYYxhj2GRYZFnjnCHfId3iX6DgoCBgoKGhIKEfYR7gXmCeX5zhHKJc4lziXCMcItxinGIcYdxhXKEcoNzgnOBdIF0gHV/dn17fXx/eoB1hHSGdIZ0hnSFc4VzhHOEc4RzhHOEdIR0hHSEdIR0hHSEdIR0hHSDdINzg3ODc4Nzg3KDcoNyg3GDcYJwgnCCb4FvgW6AboBuf21/bX5tfmx9bHxrfGt7a3pqeWp4andqdmp0anNqcmpwam9qbmpsampqaGpma2RsYm5idGdxbG5kcltzX3hlf2SCaodwiHWEeoF8fn18fnp+eXt4eHl3dHlxd3B1bXVudnJ6dXt0fXN+c39zgHOAdYF1f3R9dH11fHd6eXd6dnx1fHV7d313fnd+doF1gXOBcYRth22GbodsjGyXZ5BvhH6GgYF/f4CAf3+Af359e317f3uBeoN5hHiDdYdyinGJeYOAgoGAgoCEhIWFgIR7hX6GfoV8i32JgYZ+hX+AgH2Df4WBhoSFg4WEhISDg3+DfoJ9gn2CfYJ+gX+Af39/f3+AgYCBgIGAgoGCgIKAgYCBf4B/fn9+f4GAf4CBhYGEhIKFf4R+gH5+f4B9gXqCeoB9fHx+fXx/en98fX59fIB9gH9/f36Aenhzb3FycXNzdHV1dnh3eXh6eXt6e3p8enx7fXt9e358fnx+fH98f3x/fIB7gHuBe4F7gnqCeoJ6gnqCeYJ5gnmCeIN4g3iDd4R3hHeEdoR2g3aDdYN1g3WDdYN0gnSCdIJzgXOBc4FygHKAcoByf3F/cX9xfnF+dH90fnR+c35zfnN9c31zfXN9cn1yfXJ9cX1xfXF9cX1wfXB+cH5vfm9+b39ugG6AbYBtgG2BbIFsgWyAa4BrgGt/an9qfmp+an1qfGp7anpqeWp4andrdWt0bHJtcG5vb21xa3NpdGh3Znlke2N+YoFhhGGHYYphjGKPYpBjkmKWZJdsinqJe4qAhIKBgoGDhYWGgoGDfYV8hHqEeoR0h3OIdId2iHaJdYl0iXSIdId1hXWDdoN2gneBd4B3gHh+en19fX1/eoF4hXiGeIZ4hniGeIZ4hXiFeIV4hHiEeIR4hHiEeIR4hHiEeIR4hHiEeIR3hHeEd4R3hHaEdoR1g3WDdYN0g3SDc4JzgnKBcoFygHGAcX9wf3B+cH5vfW98bntuem55bXhtd212bXVtc21ybHFsb2xubGxsamxpbGdsZGxjamBxa3VkdV90X3ZgfGWDbot3in+GgIGBf4J9gnuAeX54end4dHpye3B6cnpzeXV6dHx0fnSAdIB1gHWAdn91fnh9d3x5fHt7e3l9eH92gHZ+d394gHiBd4F2gnWCcoRuhG2Eb4VwjmmEb4N5hH2BfX97fX6AfoB+f31/e4B6gXiDd4V2hXaHdIl0hniEfoOBg4GDgoKCg4OEfoaAhX+EfIt0iHmEgYKChnyAgHyCfYCAgIGBgYOBgoKBg4CDfoJ9g32CfoF/gX+BgICAgYGBgoWFhIWEh4KKhIaBiIGGf4F/gH9/gICBgYKEg4WEhYGDfoJ9f4B9gX9+gnuBe4B7f3l8fXyBen58fX59e356fX59fn5/fn98eHZzdHR1c3dzeXV6d3t5fHp9e318fn1+fX9+f35/fn9/f3+AgH+Af4B/gX+CfoJ+gn6CfoN9g32DfYN8g3yDfIN7hHuEe4R6hHqEeoR6hHqEeYR5hHmDeIN4g3iDd4N3gneCdoJ2gXaBdoF2gHWAdYB1f3R/eIB4f3d/d393f3d+d353fnZ+dn52fnV+dX51fnR+dH50fnN+c35zf3J/cn9ygHKAcYFxgXCBcIFwgW+Bb4FvgW6AboBtf21+bX5tfW18bXttem15bndudm90cHJwcXFvc210a3ZpeGd6ZXxkf2KCYYVgiGCLYI5hkWKTZJRklWSXaYx7iYGIf4WBgoKCgoGDhoWEhX+CfYJ8gHuCdop0iXaGeYV6hnuGfIV5iHiIeYZ6hHuDeYJ5gnqBeoF7gHx/fn5/f36AfIJ8hXyGfId8h3yHfIZ8hnyGfIV8hXyFfIV8hXyFfIV8hXyFfIV8hXyFfIR7hHuEe4R6hHqEeoR5hHmEeYR4hHiEd4N3g3eDdoJ2gnWBdYF0gHSAc39zfnJ+cn1yfHF7cXpxeHB3cHZwdXBzcHJvcW9wb25vbG5rbmltaGxnbGhuaHFlc2F1X3dde12AZ4R5hHyDgoGFgIR+hHuDeoF4fnV6dHpzfHJ9dXx2fHZ8dnx2fneAeIN4hHiCeIF5fnp9fH17fHx6fniBd4N3gniAeoF6gXmBd4J0gXaAdIJvhG+BcoRyf3SFcoR5gnmDeoF5gXyCfoJ+gn6CfIN5hHiHd4t3iXiLd4l5gn6FgIOBhIKCgYOBg4GHeoOAgoGHd4p2iXmIfoOAhYKDgICCgYF/f3+Af4B+f4B+gH6BfYJ9gX6Bf4B/gX+AgIWEhYSGhYuGioaGhoOGhoWAhX6FfoR/gn+BgIKDhYSHgYaGh4KFfX9/foF8f31+gHyDfIJ8gnx/fnt+en18fX5+fn15e3x7fXx9fX5+fXp3d3Z3dHlze3N9dX53fnh/eoB7gHyBfYF+gn6Cf4N/g4CDgIOBg4GCgoKCgoOBg4GDgYOBg4CDgISAhICEf4R/hH+FfoV+hX6FfoV9hX2FfYV9hHyEfIR8hHyEe4N7g3uDeoN6gnqCeoJ5gXmBeYF4gHiAfIF8gXuAe4B7gHt/en96f3p/eX95f3l/eH94f3h/d393f3d/d392f3aAdoB1gHWBdYF0gXSCdIJzgnOCcoFygXKBcYBxgHF/cX9xfnB9cHxxe3F5cXhydnJ0c3N0cXVvdm13a3lpe2d9ZYBjgmGFYIlfjF+PYJJhlWOWZpZnlmmMdoh/h4SEhoOEgoODhISGhoOCg4GDf4SAhXqJdo16jn2LfYl9h32GfYV9hH2EfoN+gn2CfYJ9gn6BfoF/gICAgICAgH6Af4OAhYCGgIeAh4CHgIeAh4CGgIaAhoCFgIWAhYCFgIWAhYCFgIWAhYCFgIV/hX+Ff4V+hX6FfoV9hX2FfYV8hXyFe4R7hHuEeoN6g3mCeYJ4gXiBd4B3gHZ/dn51fXV8dXt0enR5c3dzdnN1c3Ryc3JxcnBxbnFtcWtxa3FqcGpwZ3JldGJ1X3ZdeVp/WoV4g4GFf4OCgIN+hHqEe4N3gXd+dn11fHV9d3x4fHd9eH13f3iAeIF3gnmCeoF9fn1+fX19fn98gXiCdIN2gnmBeYB4gHaBdYNzg3KDc4Vzh3SDd4J3g3mGd4Z6iHmIeYV4g3uDfIN8g3yCe4Z4ineMeIx4inmHe4J8gX+FgYSDgYKEgoSBgn6Gd3t/f3yHbot1joKNgoiAg4OFgIaCg4OAfn9/foB+f39+gH2BfIF+gH+Af4GDgISEhYiGi4qMiYqIi4iLiIqKiIh/hICHf4OAgoCEg4WFhYKHgoaFhYGEfoKAf356fHt8fX1/fIJ+g36Bf359e3x8fH18f3t7fHx9f35/fH15fXh7eHh5dXtzfXN+dH91gHaAd4F5gnyCfIN9hH6FfoV/hoCGgIaBhoKFg4WDhYSEhISEhISDhIOEg4SDhIOFgoWChYKFgoWChYKFgYWBhYGFgYWBhYCFgIWAhX+Ff4R/hH6EfoN+g36DfYN9gn2CfYJ8gnyBgIJ/gn+Cf4F/gX6BfoB+gH2AfYB8gHyAfIB7gHuAe4B7gHqAeoB6gHmAeYF5gXiBeIJ4gniCd4J3g3aCdoJ2gnWCdYF1gXSAdH90f3R+dH10e3R6dHh1d3V1dnN3cXhveW16a3xofmaAZINihWGJX4xfkF6TX5ZhmGWXapRtjnOFgIJ/gYSChYKFg4SEhIaFhoKCg4KDg4R/hnqLfI9/jX+Lfop/iH6HfoZ+hX6Ef4N/g3+Df4KAgYCBgIGAgICAgYGBgYCBgIKDhISFhIeEh4OHhIeEh4SHhIeEhoSGhIaEhoWGhYaEhoSGhIaEhoSGhIaDhoOGg4aChoKGgoaBhoGGgYaAhoCGf4V/hX+FfoR+hH2EfYN8g3yCe4J7gXqAen95fnl9eHx4e3d6d3l3eHZ3dnV1dHVzdXJ0cHRudG10bHVsdWxzaHRldWN2YXZedlx2Wnluf3qBfoKAg4J+gXyCfIB7gXt/en56f3l/en16e3l9eX54f3eAdoF3gXuAfYCBfX98fXx9e355gHaCcoN2g3iBeYF2hHWGdYh1inOLcItwinSIdYh0iXeHe4V8j32Meod9hn6GfYV6g3qFeYp3i3aKdYl4h3uAfoB/g4SGg4CAgn+CfYJ/hHh/dnt7gHCKYopzhn+EgoaCg4WMg4p/goGBfn5+fYB/f39+gH1/fn9+f3+DhIKGiIqLi4qJiYiMhoyGi4WMhYuFioWHh4KHgIeAg4KChoaDg4KCgoODg4GDf4N/gn5+e3t6fHt9fX99f36Bf39+fX18fHx8fn5/fH56fnp/en56fnd7eXh7dX10f3OAdIB0gXSBeIF6gnqEe4R8hXyGfYd+iH+JgImCiIOIg4eEh4SGhIaEhoSGhIaEhoWGhYaFhYWFhYWGhYaFhoWGhYaFhoSGhIaEhoSGhIaDhYOFg4WChYKFgoSBhIGEgYSBg4CDgIOAg4CChIODg4ODg4KCgoKCgYKBgYGBgIGAgYCBf4F/gX+BfoF+gX6BfYF9gX2BfIF8gnyCe4J7gnuDe4N6g3qDeoN5g3mCeYJ4gXiBeIB4f3d+d313fHh6eHl4d3l1eXN6cXtvfG19a39ogWaDZIViiGCLX49ekl6WX5limmiWcJB3hn+FgIKBg4WEhoSFg4KEgoSCiIGDhYWDhYZ9iX+KgIuAjICLgIp/iH6HfoZ/hX+Ef4R/g3+DgIKBgYCBgIGAgIGAgoGBgYGBgYKDgoWChoSGhoaHhoeHh4eHh4eIh4iGiIaIhomGiYaIhoiGiIaIhoiHh4eHh4eHh4eGh4aHhoeFh4WHhYeEh4SGg4aDhoKGgoWBhYGFgISAhH+Df4N+gn6BfYF9gHx/fH57fXt8ent6eXp4eXd4dnh1eHN3cndwdm92bXdrem54bHhneGV4Y3hhd2B2YXhof3SDd4N9hIKEgYN/f36AfoF+f3x+fX1+fX19e3x8en95gHiCdoN7f35/f4CCgYJ9f3x/e4F5gneCdYJ3hXeHdopyjHONc41zj3KQcZFykXOQdJB1jneLeoZ/i3+LgIaBiICIfYd5hneIdoh3iHaIdYV4gX1+f4SDhIR/f4B/f31/fIF7gXd6dnx7g22KZoN1gH2BfYB+g3+HgoeBgX+Bfn18fn2AfX99f35+fn9/g4GFhIeGi4eLh4yGi4SNhIyDjIONgYuBiYKGgoSCg4WDh4aFgoKBgoOChIGEgYOBgIN/gn+Bf359fX1+fn99f35/fn98f3x+fn58f3t/eoB6f3t/e394fXh7enh8dn9zgHSAc4FygnOBe4N9hHaFeoR6hnmHe4l8i32Lf4uCioOJhIiEiISHhIeEh4SIhIiEiIWIhYiFiIWIhYiGiIaIhoiGiIaIhoiGiIaHhoeGh4aGhoaGhoaGhoaFhYWFhYWFhYWEhISEhISEhISDh4SHhIaEhoOGg4WDhYOFg4SChIKDgoOCg4KCgoKCgoKCgoGCgYKAgoCCgIJ/gn+Df4N/g36DfoN+hH2EfYN9g3yDfIN8gnuBe4F7gHt/e357fHt7e3l7eHx2fHR9cn5vf22AaoFog2aFY4hhi1+OXpFdlF2YXptimm6Re4iChYKGgIaChYKDgoCBgYGDgYWDiIOChoiGhIeCi4OKgomCiICJfol+h32HfoV+hH+Ef4N/g4CCgIOAgoCCgIKBgYKAgoCCgYKBgoKCgYOBhoGIg4mEiYaJhoqGioeLh4uHjIeMhoyGjIaMh4yHjIeMh4yHi4eLh4uHioeKh4qHiYiJiIiIiIiIh4eHh4eGh4aHhYaFhoWGhIaEhYOFgoSCg4GDgYKAgYCAf39/fn59fnx9e316fHl7d3t2e3V6c3lyeXB5b3htd216bXppemd7ZXtke2N7Y3xmfm+BeIJ8goCFgIF/hX+Ff4SAg36DfIJ8gn2Be397fIF5gniBd4F8gHl8eXt9fYF+gn2Ee4V6hXmGd4Z2iXaPdJBykXSRdZB0knGUcZV0lHaUeJN5kXqNfoWBioSLgYl/in+KfYp6i3eJdod4hHeBe4B+f4KChYSFgYF/f318fHt/eX96f3t3enl8gXB9Z310fnuAfIJ7gH6EfoN/gn+Bf4B+f32AfH9+fX5+f4GEhIKFgoeDiYOMg4yDioSMhIyDioKMgoyBiIOLg4uFiIWDhYWChIKDgYSCiIKFgYSAgYJ/g36Bf4F+gH6Af4B/f35/f39/fn9/fn98gHyAe4B6gHt/en94fnt7fHl+dn9zgXWDcoNzgnaCfYN/g3qDfYJ5hXaGeol5jXuNf4yCioOIhIiEiIOIg4iDiIOJg4mEioSKhIqEioWKhYqFioaKhoqGioaKhoqGioaKh4qHioaJhomGiYaJhomGiYaJhoiFiIWIhYiFiISHhIeEioWKhYmEiYSJhIiEiISIg4eDh4OHg4aDhoOGg4WDhYOFg4WDhIOEg4ODg4ODg4ODgoSChIKEgoSBhIGEgYSAhICEgIN/g3+Cf4F/gX6Afn5+fX57f3p/eH92f3SAcoFwgm2Da4RohmWIY4phjV+QXpJelV6YYJZoinuDgIWEh4GFgIOBgYOBg4GDh4aIiImFjIOFhI6Gi4eGioWJhYmBh36IfYh9h36GfoV+hICDgIOAg4CCgIKAgoGCgIKBgYCAgn+CgYKBgoGCgYKBhIGHgIqBi4OLhIyFjYaOho6Gj4aPho+GkIeQh5CHj4ePiI+Ij4iPiI6IjoiNiI2IjYiMiIyIi4iLiIuIioiKiImIiYeIh4iHh4eHhoaGhoWFhYWEhIOEgoOBg4CCf4F+gX2AfIB7f3p+eX54fnZ9dX1zfHJ8cHtvfG58bX1qfWh9Z35lf2SAZIFmg2qFcYZ7hH+Df4N+g36EfoV+hX+FgIZ/hXyDe4B7fIB6f319fX57fnt8fnuBfIR9hn2HfIh7iXmJeIl2iXSKcI9xkXaReZJylm+Xc5d3lXqTe5F7j3+NhIqJh4KJfox9jH6NfIt8jHiJeIV5gHyBgIKCgoWChYGBfn96f3l7dnt5dHl4eXx2gXeBdnB4a3l3fX5+fn99gHuCfIV9gn+BgIJ+f319fYB9fYCAgYB/goGJhoiEiYWKg4yCi4KLgo2CjYONgouDjYSMgIp+h3+Fg4SChYKHhIeBhX6GgYOBgX9/gH6BfYN9gX+Af39+gICCgIGBgIB/foB9gXyCe4F8gHx/en98fn58f3mAd4F1gnWDdoR2hHaEeYN9g36DfYN9g32GfIp2jHyLfomBh4KGgoaCh4GHgYiBiYKJgoqCi4OLg4uDi4SMhIyFjIWMhYyGjYaMhoyGjIaNhoyGjIaMhoyGjIaMhoyGjIaMhouGi4WLhYuFi4WKhYqFjYWNhYyFjIWMhYuFi4SLhIqEioSKhImEiYSJhImEiISIhIiEh4SHhIeEh4SGhIaEhoSFhIWEhYSFhYSFhIWEhYOEg4SDhIKDgoKCgYKAgn+CfoJ8gnuCeYJ3g3WDc4NwhG6Fa4ZoiGaKY4xgj1+RXpNflWCVaIZ7g36FfomEiIOEgoKDgYaEh4eGhoaHhYuGioKGgYqBioaGiIaKhIqBiH+If4h/iH+Hf4Z+hH+DgIOBgoCDgYOBg4GDgYOCg4GDgoGEgIOAgoGCgYOBg4GEgYh+jH+Ngo2DjoSQhZCFkYWShpKGkoaSh5KHkoeSiJKIkoiSiJGJkYmQiZCJkImPiY+Jj4mOiY6JjYmNiY2JjIiMiIuIi4iKh4qHiYaJhoiFiIWHhIaDhoKFgYWAhH+DfoN9gnuCeoF5gXiAdoB1f3R/cn9xf29/bn9sgGqAaIFngWaCZYRmhWmEb4J3f4CBfoN9g3yFfYZ/hYCGf4Z+hX+EfoB+g4CEf4V9g32BfoB7hHmHeol8in2KfYp7i3qLeYt4iXaHc4VziXmOdpdumG+XdpR6kn2Of4qCiH2HgYaJh4ONgpCAkHyNeop8inyGe4B9f3+BgoWEg4WBgoN/gH2Af4B8f3p6dXhyeH53gHh7fXh8dH54fX58gH2Bf4KBgYCAgXyAfYJ8f3yAfn+Af4B+f4GBhYeIhIWCh4KKg4yAjH+MgI5+i3+KgImAiH+Kf4p+h3yDfoV/hn+FfoN/h4CDgIGAgIF+gHyCfIN/gn+AfYB+fn1+foGBf4B/f4B+gn2DfIJ+gH6AfoCAfoF8g3mEeIR2hHiDfoN9hnqHeoZ7hX2EfoN+g32EfIN+hICCf4J+g36FfoZ+h36Hf4h/iX+KgIuAjIGMgYyCjIKNg42DjYSOhI6FjoWOho6GjoaOho6GjoaOho6GjoaOho6GjoaOho6GjoaOho6FjYWNhY2Fj4WPhY+Fj4WOhY6FjoWNhY2FjYSNhIyEjISMhIuEi4SLhIuFioWKhYqFioWJhYmFiYWIhYiFiIWIhYeFh4WHhYaFhoWGhIaDhYOFgoWBhYCFfoV9hXuFeoV4hXaGc4Zxh26HbIhpiWaLY45hkF+TX5RhkWeGeIV9hXyDgIGCgIKCgoGCgoSDhYWEh4WHh4eDh4WHgoiDh4SJhoaIhImBioGKgIh/h3+Gf4Z/hoGFgYSBg4GCgYOBg4KDgoODhISEg4KDgoaBhX+EgISBhIGDgYR/in2Ofo+AkIKRg5KDkoSThJOFlIWUhpSGlIeUh5SIlIiUiJSJk4mTiZOJkomSiZKKkYqRipCKkIqQiY+Jj4mPiY6JjomNiI2IjIeMh4uGi4aKhYmEiYOIgoiCh4GGgIZ+hX2FfIR7hHqDeIN3gnWCdIFygXGCb4JtgmuDaoNohGeFZ4Znh2yFdYF9f4KGgIaBg3+De4N9gn+BgYKAgn+BgIOAg3+EfoV+hn6EfIZ6iXiLeot8i3+Lfot8i3qMeYx5i3iKeId2inKObZFtknKMe4Z+hX+FgIKAhH2Bf4GFhYGKfox+ioCJf4V/hH5/fX5/goKChoSDf4SCfoCAgICAfoF/gX2AeYF0e3x7f3x/gHqBeX95e3p/fIGBgoOBgoKBf4B/goCAgH+Af39+f4GBhIKFgoSBgoCCgIOAgoKChoCIgYt/ioCKgYiChYSHg4OAhICGfoiAiYCFgoOEh4CBfn9/fX99fXx/f4KCgoGBgYGBgYCBgoCDgoKAgYF/g36Ef4OCgoGBgYGDf4V8h3mHeId4hXuEgIV+iH2Ifod9h3yHe4V6hHuCf4SBg4CCfn99gnmGeoh7iHyIfIh9iX2Lfox+jX+NgI2AjYGOgo6CjoOPg4+Ej4SPhY+FkIWQhZCFkIWQhZCGkIaQhpCGkIaQhpCGkIaQhpCFkIWQhZCFkYWRhZGFkYWRhZCFkIWQhZCFj4WPhY+Fj4WOhY6FjoWOhY2FjYWNhY2FjIWMhYyGjIaLhouGi4aKhoqGioaJhomFiYWJhYmEiYOIgoiCiICIf4h+iHyIeoh5iHaIdIhyiG+JbYpqi2eMZI5hkWCTYJVkj3SHgIZ7gn+Eg4F/gYGCgH+BgIKFgoiBhIOEg4GBhICIg4aGiISGh4SHgYeAh3+Gf4Z/hn+GgIWBhoGFgoWChIODgoOCg4ODg4ODhISEhYWFhYWEh4GGgIWBhIKEgYWBiX+MfY98kH6Rf5KAk4GTgZSClIOVhJWFlYWWhpaHloeViJWIlYiViZSJlImUiZSJk4qTipKKkoqSipKKkYqRiZGJkImQiZCJj4iPiI6IjoeNhoyGjIWLhIqDioKJgYmAiH+Ifod9h3uGeoZ5hXeFdYR0hHKEcIRvhG2Fa4VqhmmHaIhph3WGe4V/g4KDhIOAg3+Afn9+f39/gX9/f36BfoJ7hXyHeYl5inyLe4t7iXqFfIR+g3+Ifop8i3qLeYp5hXuCfYJ5g3CHaYhshHiAf4B/gH5+f4J/gX6Af4F/gn6FfIR8gn6Cf4CBfoCAgIGBgoOAhYGDfoJ+fXp8enh9doN2hnyCgoJ8fn5+gIB/gHt9eH55f3mBeYF7gX6CgIN/f4F9gH6AgYGDg4OGg4OBgoGCgoGAf319e356fnp+e39+goSChICKf4h/gYGFgYZ7iHaGd4d5iHyCf4aAiH+Cf4F/gYCDf4J/goCChYSFhYOFgYKAg3+DgYSBgYF/g3+EgIJ/gX2BgYCEf4Z9iXuJeYh5h3yEgIaBh4CGf4Z+hnyHe4d6iHqJe4l9h36FgYd/h3yKeot6i3uLe4p8in2MfY19jn6Ofo5/joCPgY+Bj4KPgpCDkIOQhJCEkYSRhJGEkYSRhZGFkYWRhZKFkoWShZKFkoWShZKFkoWShZKFk4WThZOFk4WShZKFkoWShZKFkYWRhZGFkYWRhZCFkIWQhZCGkIaPho+Gj4aPho6GjoaOho6GjYaNho2GjIaMhoyGjIaLhYuEi4SLg4uCi4GLgIt/i32Le4t5ineKdYpzinCKbotri2iMZI5hkF+SX5JpiX+GhICBg4SEgYJ+g4GCgYKDhISChIaChYODhYOGg4SIgIeChICAgH+DgISAhYCGgIaAhoGGgYWChIKEgoSDhIOEg4ODg4ODg4OEg4SEhYOFg4WFhYWIgYaBhIGEgIWBiICLfo19jnyPfI99kH2RfpJ/k4CUgZWCloOWhJaFloaWhpaHloeWiJWIlYiViJSJlImUiZOJk4mTiZOJk4mTiZOJk4mSiZKJkomRiZGIkIiQiI+HjoaOho2FjISMg4uBioCKf4l+iX2JfIh6iHmHd4d1h3SGcoZwh2+HbYdriGqIaolrh3iGfIV/hYCFgYWChYKDf4F/gICAgYCAgH6BfIJ6hXiHd4l3i3uLfol/h3+Ff4Z+hn6Hfop7inqJeoV8gH+CfoF6gXGBbX5yfnqBfX99f3+BgIN+gXyAf4GAgX+DfYN+gn6AfX+AgIOBhIOEfYF/gYGBf4N4fHV4eHR6cn1yfnl8f36BfYB6fnl7eXh6dnx1fXWAd356foCAfn99fXx8gH6BgICEgoKDg4GDgIJ+fX55fnd9dH1zfXJ7cnp0e3h7fX+CgoaAhX2De4N0hHWAeoOAh4CJgIiCh4KCgoOCgn6Af4CAf36AgoKEhYGEgISAg4GEf4N/gX+AgoCDgIJ+goCCg36FfId8iHuHeoR9hH+FgoeDh4GGf4V9hnuHeol5i3mNeI54jXqJf4eAiX6Ofo59jXyNfIx8jXyOfY59j32Pfo9/j3+PgJCAkIGQgZCCkYKRg5GDkYORg5GDkoSShJKEkoSThJOFk4WThZOFk4WThZOFk4WThZOFlIWUhZSFlIWUhZSFk4WThZOFk4WThZOFk4WShZKFkoaShpKGkoaRhpGGkYaRhpGHkIeQh5CHkIePh4+Hj4ePh46HjoaOho6FjoSOhI2DjYKNgY2AjX6NfI17jHmMdox0jHKMb4xsjGmMZo1jjWCPYId3gn99g4CEhoKEf4OBhYOEgoSDhIKCg4OChoCEhIGDgYOGg4mBhISDg4KCgYOBg4CEgISAhIGEgYSChIKDgoODg4ODhIOEg4SDhIOFg4WDhoOFg4WDhoWIhIeAhYCFgIWAh4GLgI1+jX2NfY19jn2PfZB+kn6Tf5SAlYGWgpaDlYOVhJaFloWVhpWGlIaUh5SHlIeTh5OIk4iTiJSIlIiUiZSJlImUiZSJlImTiZOJkomSiJGIkYiQh4+Gj4aPhY6DjYKNgY2AjH6MfYt8inqKeYl3iXWJdIhyiHCIbohtiWyIbIdvhniGfYV+hICEgYWBg4KEf4R+gYGBgIKAgH+Ce4V4h3eJdoh5hn6HgYiBiICHfod8hX6Ff4Z8hnuEe39/gICAgH16eXR3cHh2e3d/e39+gn2EfoF+gH1/fn5+gICBf4F9gH9/f4KCgYKBg4GCfYGAgH1/eYN1e3h1enN6c3t2d3p3fXZ9dnx2e3Z5d3d5dXt0fHV+dXx4e35+gX+Df4OAg4GDgYODhIOChX+Dfn5+en55fnh/d392f3V+dX10fHN5dHZ0d3d7fH+AgIF/g36Bf4OBhIGDgoKCgoKCgYOBgn6CfIF9g36Eg4SCh4KIgIiAhIOIgYWBhX6Df4GBgYKBgoKBhH+DfYR9hnyFe4N9g4CJgouCiYGFgIR9hXqIeIp3jHePd5B4kXmPfIaBiIGMgo9/j32PfI58j32PfY99j32PfpB+kH+Qf5B/kICRgJGBkYGSgpKCkYKSgpKDk4OTg5ODk4SThJOElISUhJSEk4SThJSElIWUhZSFlYWUhZSFlYWVhZWFlIWUhZSFlIWUhZSFlIWUhZSFlIaUhpSGk4aTh5OHk4eTh5OHkoeSh5KHkoeRiJGIkYeRh5GHkYeQhpCGkIWQhJCEkIOPgo+Aj3+Pfo98jnqOeI12jXONcYxujGuLaItmimSFaYF9gn9/g4ODhYCFf4OBhIKEg4eCg4CBgoCCiIGEgYSDg4WFhIqCgn6Cf4OAgYGAgYCCgYKBg4KDgYOCg4KDg4ODgoSDhIOFhIWEhoWGhIeEh4SGg4aDhoSGhIiChoGFgIZ/hn+IgIyAjX+Nfox+jX6OfZB9kX6SfpN/lH+Uf5SAlIGUgpSClIOTg5OEkoSShZKFkoWRhZGFkoaThpSHlYiWiJaIlomViZWJlYqVipWKlImUiZOJk4iSiJKHkYeRhpCFkIOPgo+BjoCOf419jXyMeox5i3eLdYp0inKJcIlviW6JbohwhHqDfoJ+goCEgIOAgoKGgId+g3+Ef4KBgHyDd4h0i3WMdoh8hoCHf4l/iICGf4N+goCFf4R9gnx/f36Agn+Af35+d3pzdnV4eHh5dn18gH2BfYF9gn1+fn9+fn5/gICAgIB/gYKBgYGBgH+AgIKAgn+Cf4F/en92fHV7dXh6dn92fXd7dXt1e3d5eXh6dnt1eXR5dHl7fX6AfYB/foGCgIKDf4R9g4CAhH+EfYN8g39+fXt8e397gHyAfIB7f3p9d3t0eHJ2dHR3eHp6ent8fX1+fYCBfoF9g3uEf4SBg4KGgYiAhn2EfoeEh4SHgYaAhYGJgYh/h4CFfoN+gn+Df4V/hYCFgYKAgn6Bf4F/goCGfoV/hYKDgIR8hnmKd4x3jniQeJF4knmRfIiCioOPgZJ+kn2RfpB+j36PfpB9kH2QfpF+kX6Rf5F/kX+RgJGAkoGSgZKBkoKSgpOCk4KUg5SDlIOUg5SDlIOUhJSElISUhJSElYSVhJWElYSVhJWFlYWVhZWFlYWVhZWFlYWVhZWGlYaVhpWGlYaVhpWGlYeVh5WHlYeUh5SIlIiUiJSIk4iTiJOIk4iTiJOIkoeSh5KGkoaShZKEkYORgpGBkYCQf5B9kHuPeY93jnWOc41wjG6LbIppiWiIboB/gYCDgoODhoKFgISBhIKGgYeAhH5/f4KDjISKg46Ei4qMiJGDjn+IfoR/g4CDgYOBgoGDgoKCgYODg4ODg4KEgoSChIKFgoWDhYSGhIeDiISIhIiEhoSGhIeEh4KGgoeAh3+Gf4iAioCLgYyAjYCNf45+kH6RfpF+kX6SfpJ/koCTgJOBkoGRgpGCkIOQg5CDj4OOg4+DkYSUhZaGl4eXh5eIl4iXiZeJlomWipaKloqViZWJlYmUiJSIk4eTh5OGkoWShJGDkYGQgI9/j36OfI57jXmMd4x2i3SKcolxiXCJcIhyg3yDgIOBhYGEgYSBhYCHfYp7hoCFgYKBgnqIcY1xj3SNeYp9in+LgYiBhIGBgIKAhoCHfYV8gH99f35/gX+BfoB+f31/e356enl5dHh3eXh7e4B/gYCBf4F/g36EfoR+hn+GfYOCgYGAgoGAgX6AgIKCgYB+fHx8enp3eXR7c391fnZ8dnp2e3h6enl6d3p2eXl6d3t2fXp/en98fn9/gIJ8fn1+gIKBgIKAg4OBhX+CfoF7gHuAfIJ+gH+AfX58fn59e3t5e3R4cX12gHt8f31+hHyIe4Z6iHyHfIWAhIOHgYaAhoOIhYiAhH+GgYqDi4KOgY5+i36Lfol9hn6Hf4d/hn+FgIWCg4SDg4SChIOGgoh/hYCCfoZ5iXeNd494j3mQeZF6knqSfI9+kYCRfpJ9koCRgJCAj3+Of45+j36QfpF+kn6Sf5J/kn+SgJKAkoCTgZKBkoGSgpOClIKUgpWClYKVgpWDlIOUg5WDlYSVhJWElYSVhJWElYSVhJWElYSVhZaFloWWhZaFloaWhpaGloaWhpaGloaWhpaGloeWh5aHloiWiJaIlYiViJWJlYmViZWJlYmUiJSIlIiUh5SHlIaThpOFk4STg5OCkoGSgJJ+kX2Re5B5j3ePdY5zjXGLb4luhm2Dc4CAgX+DgoSEiISHgoeDiIOKg4mDhoSDg4KDiYGJf5CEjYmMiJCDin+Hf4aBh4GGgYWBhYKEgoOCgoODgoOChIKEgoSChIKFgoWCh4KGg4eDh4KHg4qDi4SLhomGiYSHg4eDiYGFgIeAiICKgY2BjoCOgI6Aj3+Qf5B/kH+Qf5B/kX+Rf5GAkICQgZCCj4KOgo2DjIOMg4+Dk4OWhJeFmIWYhpiHmIeYiJiImImXiZeKl4qXipeJl4mWiZaJlYiViJWHlIaUhZOEk4OSgpKBkYCQfpB9j3uOeo14jHeLdYp0iHOHc4Z1goCCgYOBg4CCgIKAhH6DeoJ7gX6Cf4R/iHaPcJByj3eLfIaCgIF9gH2Bf4CBgYN9g3uCfX1/e4B9foCAgH6AfoB/gX6AfX58fnt7dnl2eXZ4d3l5fX2BfYN8hHuEfIR9g36Afn6BfoB+gYCCgYKCg3+CfH55fHh8d3x2fXZ+dYF1f3Z8dXp4ent7enp7d3p3eXh7d312fnZ9d316fYB/goGDf4OAg4GDgYSBgn+BfoOAg4KCgoCCfIN8gXyDfoJ+gX6DfIJ9fH9+doV5gIB7f35/jH+PfI17inqHe4R+hn+FgYh8iXyHgYuHjoeRhZGDjoWRg4+Cj4KQgY5/jX2Nf4l+in6If4eBhoSFhYeGh4aIhoyDiYCHfIh7iHeLeI55j3mQeZJ6knuQfYh/ioGIf4qAjISNgo2BjYCOf45/j3+Qf5F/kn6Tf5N/kn+Sf5KAk4CTgZOBk4KTgpOClIOUg5SClYKWg5aDloOVg5WDlYSWhJaEloSWhJaEloSWhJaEloWWhZaFloWWhZaFloaXhpeGl4aXhpeGl4aXhpeHl4eXh5eHl4iXiJeIl4mWiZaJlomWiZaJlomWiZaJlYmViJWIlYeVh5WGlIWUhJSDlIKTgZN/k36SfJJ7kXmQd492jnSMc4pyh3OEeYOAgYGGg4iCiYGJgIeAhH+BfIV9iIGGhYKIhIOKgYaBhISKhI2DiX+GfYSBhoGGgYSBg4GCgYKCg4KEgYSChIKFgoSChYKFgoaBh4KFgoaCh4OHgoeCiIGJgouDjIOJhIaEiIKGgoeBiH+IgYyCjoCOgI6AjYCOgpCCkIGQgZCBkIGQgJCBkIGQgpCCj4OOg42EjYSNhZCEk4OWg5eDmIOYhJiFmIaZh5mImIiYiZiJmYmYipiJmImYiZiJl4mXiJaIloeWhpWFlYSUg5OCk4GSgJJ/kX2QfI97jXmMeIp3iHeFd4N6gn+CgoKBgn+DfYR/hn6Gf4SBhYCFgIZ9inmIdod4hH2Bf4J+gYR+gX6AgIGCf356e3p5fnx9fn+BgYKAgX+BgIKAgoCBgIGAgX1/eHx3fHd8d3x4fXh+eIB5gnmCe4N/gIN/goCDgIN/gn5/fn98f3mBeIB3fnd9eH52f3h/d393gHh+eHt6ent6e3l6eHp5e3p9eH53f3Z9eXp6fH1/gH1+fH9+f3t+fX+Af4CBgoODhIOBgIJ/gn+Bf4GEgYSChICDe39/hX6FcoJ4gn6Ff4l7jH+Qfo59in+JgIqAiH+Hfox/jH2Me4t8iYOMhIyBjIGMgYuBjIGNgo+Bj3+NfIx8in6JgImCiISIhomGh4WHhIuDiICIf4Z/gn+FfYl6jXmReJJ5k3uSfo+AhoKEg4aBhYGIgoyBjX+Pf49/kH+Qf5F/kn+Tf5N/k3+Tf5N/lICUgJSBlIKVgpWDlYOUg5SDlYSVhJaDl4OWg5aEloSXhJaEloSWhJaEloWWhZaFloWWhZaFloWXhZeFl4aXhpeGl4aXhpeGmIeYh5iHmIeYh5iImIiYiJiJl4mXiZeJl4mXipeKl4qXipeJlomWiZaIloiWh5aHlYaVhZWElYOVgpSBlH+TfpN8knuRepB4j3eOdox2ineGe4SAgYKGgoWChIGEgIV9gH6BgoWEhIODgYGEhoeKhISAgoGGf4eChYGIf4R9g36Cf4F/goCBgoSBhoGFgYSChYKEgoSChYGFgYaBiIKFgoaBh4GKgYuCiYOHgYaBh4GHgoeFiIaHg4WDhoCHfod/ioCMgI2BiIGJgYyDj4OQg5CCkIOQg5GDkYORg5GDkISQhJCFkIWPhZGFlISWg5eCmIKZg5mEmYWZhpmHmYiZiJmJmYmZiZmJmYmZiZmJmImYiZiImIiXh5eGloWWhZWElYOUgpOBkoCRfpB9j3yNe4x7inqIe4Z9hX+FgIZ+hnyGeod5h3mIeoR/hICCgIGAhHyCd4B6gX2Bf4F9fYF/gYCBfoB6fnh9e319f4CBgYCCgIGAfYCCfYF+fn5+fX5+gH2AfH94fnd+d393f3l/eX93f3h+en1+foJ+gnyBeoF7gHt9en14fnWAdn93fXh9en57gHuBe4F7gXqAeX17eXl4e3h7eXt5e3l8eHx4e3l4fXt/eX55fXl8eXx3e3t/f39/fX1/fX+BfYF+gIGBgYGDgIKBgoKAgn6Cf4WAiISKhpKCkH+NeI15jH2Jfop9jH2Mf4eAiIKNgouCjYCNfop8inuIfYeCiYGIf4l+in6Of4yBj4GOe4x5inmIfIh/iIKJhIqFiIaGhomDiIOLgoiBhoWGg4iAi3mNeJF5kXqRfJF+jYGHhIiCiIKLg46Ajn+PgJB/kH+Rf5F/kn+Sf5N/k3+Tf5SAlYCVgJWBlYGVgpWClYOVg5WDlYSWhJaEloSWhJaEl4SXhJeEloSWhJaEloWWhZaFloWWhZaFloWWhZeFl4aXhpeGl4aXhpiGmIeYh5iHmIeYh5iImIiYiJiJmImYiZiJmIqYipiKmIqXipeKl4qXiZeJl4iWiJaHloeWhpaFloSVg5WClYGUf5N+k32Se5F6kHmPeI15i3qIfISAgoKHgYmBiYWFhYOCgoOCg4SDhISGhIOGhYaIg4KChYGGf4aAhoCGfoV9g32CfoJ+gn+DgYWAg4CDgIOAg4GDgoSChYGGgIWAiYGKgIiBiYCLgIqAiYGFgoaCh4GGgYaBhoKHgoaFh4SJgYh/h3+HgIiBiYKKgoiCiIKKgo+DkYSRhJKEkoSShZKFkoWRhZGFkYaRhpKGlIWWg5eCmIKag5uDm4SahZqGmoeaiJqImomaiZqJmomaiZmJmYmZiZmImYiYiJiHmIaXhpeFloSVhJWDlIKTgZKAkH+Pfo5+jH6Lfop+in+Kf4p+inyKe4l6iXmIeoN/goGBgYKChIGEf4F+gICCf399f39/f359eXx4fXp+f4B/f39+gX6Af3+AfoJ/gIGAgH+BfoJ8gXuBfIF7gHmAeIB4f3x/fn56fHp7fHx/e4B7gHqBe4J8gXt/e356f3l/eH94fnl8enx6fXt/fIF8gXyBe4B7fHt6fHp8enx6e3p7e3p7eXt4fXl9eH13fXZ9dXx6e3x6fHt8enx8foCAgoGDg4CAgIN/hHuBe359e3t9eX96g3uJe4h8hXuIfoiAhn6If4x/i3+HfYd+i32Ie4V9iHyJeol6iXuIfIV+hn+IgYiCjoCQe4t9jX6OfpB8jnmKeoh9h4CIgomDiIWIhoiFiYOJg4qBiYOHhIaEiICKeox5jXqOeo58i3+JgImAi4CNgI6AjoCQgJB+kH+RgJF/kn+Sf5N/k4CUgJSAlYCVgJaBloGVgpWClYOVg5WDloSWhJaEloSWhZaFloWXhZaEloWWhZaFloWWhZaFloWWhZaFloWWhZaGloaWhpeGl4aXhpeGl4aYh5iHmIeYh5iImIiYiZiJmImYiZiKmIqYipiKmIqYipeKl4qXipeJl4mXiJeIl4eWh5aGloWWhJWDlYKUgZR/k36SfZJ8kXuQe497jXyJf4SCgYOEgIeAiIGGiIWHg4OBg4WEhYWHg4SDiIOKf4l/iH6HfYV/hYGHgIZ/hX6Df4R/hX6Ef4OAg4GDgIOAhICEgYaCh4KHgoeAh4CHgIWAhX+Ff4V/hYCFgoaChoCFgIWBhYGGf4WAh4OIg4mCiICHgIh/iIKJgoyCjYKMgouCjoORg5KEkoSShZKFkIWShpOGk4aThpOGlIWWhZeEmIOagpuCnIOchJyGm4ebh5qImomaiZqJmomaiZqJmomaiZqJmYiZiJmHmIeYhpiGl4aXhZaElYOUg5OCkoKRgZCAj4COgI2AjYCNf4x/jH2MfIt7inuHfYOBg4KEhIWDhIGDgIGBgIB/goF/gH6BfoB/gX5/foB/goCAf4F+gn2CfoF/gIF/gYKAgIGAf4R/gn2CfIJ8gXuBeoB8f3x+fXx8enx6fHt+e4B7gXuBe4J8gn2AfYB9gH2AfoB9gHyAfH99f32AfIF8gn2BfYB9f318fHp9e318fXx8fXt9eX16fXt+eoB5gXmAeX97e3p6e3t7e3p7e3l+fICAfYB9gICBhH6FfX99fHh+eX97gXqDe4V/h4SHgYF/iIGKe4p5hnqEfIh/iX2Heoh6iXyKe4p7iHuIe4Z8iHuHfYqAj3+Pfo1+jn6MfY17jXqKfIh8hn6Hf4eBh4KGhIWCiYKJhIqCiYKIg4aEhISIgIp8inuLeot7iXyHfol/i3+Nf45/j3+Pf4+Aj3+Qf5F/kn+Sf5N/k3+UgJSAlYCVgJaBloGVgZWClYOVg5WDlYSVhJWFloWWhZaFloWWhZaFloWWhZaFlYWVhZWFlYWVhZWGlYaVhpaGloaWhpaGloaWhpeGl4aXhpeGl4eXh5iImIiYiZiJmImYipiKmIqXipeKl4qXipeKl4qXipeKl4mXiZeJl4iXh5aGloaWhZWElYOUgpSBk4CSf5J+kX2QfI99jH+HgoOCgoWBgoh+h3+EhYSIgoaDhYSEg4OLhIiGi4WKgYp+h3+If4Z/hoCGgYZ/hX+Ff4Z/hX6FfoOAhIKFgYSBhIGFf4Z9iH2If4l+iH6Gf4KChYKGgYaBhoCFgYaChoKGgYWBhoKHgYWBhYCIgIeCh4CHgYmBiX+MgY6Bj4GPgo+CjYCNgY2CjYKLg4yFjIaOhZGHk4aUhpSGlYaXhZiFmYSahJyEnYWdhZ2GnIabh5qImoiaiJqJmomaiZqJmomaiZqJmoiZiJmImYeZh5mHmIaXhpeFloWVhJSEk4OTg5KCkYKQgY+Bj4GOgI6AjX+Nfox+iX+FgYWChIKFgoSDhIODgoKCgYOCgYKBgYGCgoKCgYGCgYOAg3+DfoN+g36CfoF+gH+Agn6Cf4CEgYR/gn6CfoJ9gXyAfH99f31/fX5+fX98fnt+fIB8gH2BfYJ+gn+Bf4F+gX+Af4B/gH+Af4F/gX6BfIJ9gn2BfIF+f35+f3x/fH98fn5+f3uBen99fX1+fYB7hHuEfIF/fXx7fHl7fHt8fnl8eXl+fYKCgoSCgoSDgoWBhXqAe359g4GHhYSDhYGBfoJ/gX+Ef4p/iICKgoqAiH+Gf4d+hX2GfYl5h3qIeoh8iX2KfYx8jHuNe4t8i3+KgYmBjX2Ke4h7hnyFfoWAhoCEgoWDh4CIf4iAiIGIhIaFhYaFhYmAiXyJeoh5h3qFf4d+in6Mfo19jn2Ofo9+j36Pf5B+kX6SfpJ+k3+Uf5SAlICVgZWBlYGVgpWClIKUg5SDlISVhJWElYWVhZWFlYWVhZWFlYWVhZWGlIWUhZSFlIaUhpSGlIaUhpSFlIWVhZWFlYWVhpaGloaWhpaGloaXh5eHl4iXiJeJl4mXipeKl4qXipeKl4qXipeKl4qXipeKl4qXiZeJloiWiJaHloeVhpWFlISUg5OCk4GSgJF/kH6Pfo1/iIKDhIWDf4Z/goSAg4CCgoGDgYSDhISDh4WPg4uAi4CJgYh/hn6EfoV+hX+EgIaAh3+Ff4V/hn+GfoSAhIGFgoWChYGFgYaAhn2HfIZ9hH6DgIWBhoGGgYaBhoGGgYaBhoKGgoeCh4KIgYiBh4KHgIl/iYKIgYh/iH6Kf41/j36PgI+BjYOIg4iDiIOIhImEioWPhZGGk4WUhZWFl4aYhpmFmoWbhZ2FnYWdhpyGm4abh5qHmoeaiJqImoiaiJqImoiaiJqImoiaiJqImYiZiJmHmYeYh5eGl4aWhpWFlYWUhJOEkoOSg5GCkIKQgo+BjoGLgYeCh4KFgoSDhYOGgoWDhYOEhIOEg4WEg4SEhIOFgoWBhICDgIR/hX+EfoF+gH6BfoF9gH1+f36Bg4KEgIJ/gn6CfoJ9gn2BfoF9gH6Afn9/f4B+gX6BfoF+gX6CfoF/goCBf4F/gYCBgICAgICAgIB/gX6CfoN+g36Cf4J/gIF+gX2BfH99f35+gH6DfIWAgH9/f4B/g4CFgIeAhX+BgH5/fYB+f36AgICCgYOFfYB/fH9+fX5+f32CgoWHh4eHgYV9gn1/gn+ChYOHg4mDi4OLgYp/h36GfIN9gX+Bf4R+iHyLeol6inyLeop6inqKeIp4inyJgImDioKMfIl6h3uFfYR/hX+EgYeBiIGGf4d9hn6GgYaDhYWEh4aEiX+HfId6hniFe4d8iXyKfIx8jHyNfI59jn2PfY99j32QfZF9kn6TfpN/lICUgJSBlIGTgpOCk4OTg5ODk4SThJOEk4SThJOFk4WThZOFk4WThZSFkoWShZKFkoWShZKFkoWShZOFk4WThZOFlIWUhZSFlYWVhpWGlYaVh5aHloiWiJaJlomWiZaKloqWipaLlouWi5aLloqWipaKloqWipaKlomWiZWIlYeVh5SGlIWThJKDkYOQgo6BjH+JgISCgYJ+g32Cf4KBg4SFgoGBgYGBg4KDhIaFi4aMhImEh4KIgImBiICHgYiAh3+FgIV/hn6FgIeAh3+Gf4SBhIGFgYSBhIGFgYaBhoCFf4R/hICFgYaBh4GGgYaBhoGGgYaBhoKHgoeCh4KHgYZ/hIGHgoh+hn2JfYuAjoCNfYt9i36Nf42AjYKLhYeDiYOKg4qDi4OPhJGEk4SVhJaEmISZhJmFmoWchZyFnYWchZuFmoWahpqGmYeZh5mHmYiaiJqImoiaiJqImoiaiJqImoiZiJmImYiYh5iHmIeXh5aGlYaVhpSFlIWThJKEkoSRg5CDj4OOg42DjIOJhIiEh4SGhIWDhISDhISEhISFg4SDhIOFg4SBhICFgYWBhICDf4GAgYGCgoSBg4GDg4WDhIKEgYOAhICDf4N/g3+Cf4J/gX+Af3+AgIB/gX+Bf4F/gn+CgIKAgoCBgICAgYCBgYGBgYCBgIGAgn+CfoN/hH+EgIOBgoN/gn6CfYF+gX+BgYCEf4eCh4WDhIODhYOFg4eEiIaIhoeHhYiEh4SGg4SEgYeAhYKAf4F+g3+CgYSIhYiCiIKGgYN/f3+Af4OBhYKHgI2Ajn+Kf4h/hX+Ef4R+gn6AgIOBhoCHfYl5iXqJe4p5i3iKeYp5iniIfoiAh4GJf4p8iHyGfIR+hX6Hf4eBhoCDgISAhX6EfYR/g4KChYSGh4OJf4h8iHqFfYV8iHuKe4t7jHuMe418jXyOfI58jnyOfI97kH2RfZJ+kn+SgJKBkoGSgpKCkoKRg5GDkYORg5GEkYSRhJGEkYSRhJGEkYWShZKFj4SPhI+EkIWQhZCFkIWQhZGFkYSRhJKEkoSShJOEk4WThZSFlIaUhpSHlYeViJWIlYmViZWKlYqVipWLlYuWi5aLlouWi5aKloqVipWKlYqViZSJlIiUh5OHk4aShpGFkISOhIqEhYR/g36BgH9+gICBgoODhIKFgoOBgoCCg4KCg4mDhoKGgoWCh4KIgoiCiIGHgIeAhYGFgYeBhn+Ffod+hX6Ef4SAg4GEgYSBhYGFgYaBhoCGf4WAhoCGgIaAhoGGgIaBhoKHgYeCh4KHgoeCh4KHgoaChoGGgId/hX6FfYR6hHqFe4V8hnyGfYd+iX+MgouFi4GLgo2Cj4GQgpKCk4KVg5aDmIOZg5mDmoSbhJuEm4SahJmEmYSZhZmFmYaZhpmHmYeZh5qImoiaiJqImoiaiJqImoiaiJmImYiZiJmImIiXiJeIloeWh5WGlIaThZOFkoWShZGFj4SLhIuEjIWNhY2FjYWKhYeFhoaGh4aHh4aFhYSDhISEg4WEhoOHgYSBg4GEgoaChYOGgoaAhYKFgoWChYKFgoWChYGFgISAhH+DgIKAgYCBgICBgIGAgYCBgYKAgoGCgYKAg4CCgYCBgIGBgYGBgYGBgIKAgn+DgISBhIGEgYSFgoSBg3+Ef4N+gn+CgYGDgYWEhYWEhIOEhISFhIaHhoiHiYeLhoqEiIOEg4OEgYV/g32CgYOCh4KEgoWBhISEhoKFgIF7fX19f36Ag4GFgol9in6KfoV+g32EfYV8hH2CfoJ/hYCGgIp/i32Meot5i3iJeIZ6h3qHe4V+hX+Gf4l8h3uGe4R9hn6HfIR+hH+CgIOAg4CCfoN+g36Ef4KDhISIgIh+iHyFf4d9iHqKeYt5i3qMeox7jHuNe418jHyMe4l8i3uPepB9kH6QgI+Bj4GPgY+Cj4KPgo+Cj4KPg4+Dj4OPg4+Ej4SPhI+Ej4SPhI+EjISMhIyDjISNhI2EjYSOhI6Dj4OPg5CDkIOQg5GEkYSRhJKEkoWShZOGk4eTh5SIlIiUiZSJlIqUipSLlIuVi5WLlYuVi5WLlIuUi5SKlIqTipOJk4mSiJGIkYeQh4+GjYaLh4eIgol9hH6BgIKBhYOHhIWAhX+Cf4F/goKCgoKIhIiChYCDgIR/hH+Ef4V/hYCFgIWAhIGGgIZ/hYCHf4R/hH+Ef4SAg4GEgYSBhYGFgIaAhoCGgIZ/hn+Gf4Z/hoCGgIaAhn+IfoeBiIOIg4iDiIOIg4eDh4KGgYeAhICFf4V+hH6FfYV8hXyEfIV9hnyFfoh/ioCLf45/j3+RgJKAk4GVgZaCl4KYgpiCmYKZgpmCmIKYgpiDmIOYhJiEmIWYhZiGmYaZh5mHmoeaiJqImoiaiJqImoiaiJmImYiZiJmImImYiZeIl4iWiJWIlIeTho+GkIeSiJGHkIaNhoqEh4WIhYiFiIWKh4qHiIaHhoaGhoaFh4aGhoWHhIiDh4SHhIeEh4SHgoaChoOGgoaChYGEgoWChYKFgoWChIKFgYSAg4CDgIKBgoGCgYGCgoKCgYKBgoKCg4KDgYOBg4KDgoGCgIKBgoKCgoGCgYKBg4GDgYOBhIGEgYOFgYOChYKFgISBhYGEgoKDg4SEg4SEhISEhIaEh4eKhoqFi4WJg4eDhYSEhYOGgoiCiYKIgoaDh4CFgYSAhIaFhH+Cf4F/gX+Cf4CAgICBgISChX6JfIV+hICDf4V+h32GfYV9h36JgIt/i36MfYt8inqIe4V+h36HfIV9hH+Gf4d8h3uGe4d7h3yFfIR9g4CCgoKBg3+AgIR/hX6EfoCBhIGFgYZ+iXyGf4l+i3qMeIt5i3mLeYt6i3qLeot7i3uKe4p6hnqHe4p8i36Lf4uAi4CLgIuBi4GLgYuBi4GLgouCi4KLgoyDjIOMg4yDjIOMg4yDiYOJg4mDiYOJg4qDi4OLg4uDjIOMgo2CjoKOgo+Dj4OPg5CDkISRhJGFkYaRhpKHkoiSiJOJk4mTipOKk4uTi5OLk4uTi5OLk4uTi5KLkouSipGKkYqQiY+JjoiMh4uHiYmGioKJfod9goCCg4WFg4ODgoN+g36BgIKAg4KFiIWHg4SBhICFgIWAhYCFgISAhX6Ef4SAhYCFgIWAhoCFf4N+hH6EfYOAg4GEgYWBhYGGgIaAhoCGgIZ/hn+Gf4Z/hn+Gf4Z+iXyKfIh/hoOHg4eDh4OHg4eEiISJg4eBiIGIgIeAiICIf4h+iH6Hfod+h36Hfoh/in6MfY59kH6RfpN/lICUgJWAloCWgJaAl4CXgJeAl4GXgZeCl4OXg5eEmIWYhZiGmIaZh5mHmYeZh5qImoiaiJmImYmZiZmJmYmZiZmJmImYiZeJlomWiZWJlImRiImGh4aIhouIjoqLiIeGh4WIhomGiIaIh4uJjIeKhoeGhoaGhoaGh4aHhYeDhoOGg4aDhoOGgoaChoKGgoWChIKEgoSChIKEgYSBhIGEgYSBg4GDgYOCg4KCgoOCg4KDgoOCg4KCg4KDgoOChIKEgoOCgYKAgoGCgoKDgoOChIGEgYSBg4CEgoOGgIWChoGGgYaChoKFg4SEhIWEhYWEhoSHhImFioSKhYmEiISHhIaFhYWFhoSHhYeGhoaGhISDg4GEgIOChISEg4SDhIKBgYCCgIOAg4GBg4KEiIKGhIaDhICEgIN+hXyGfYaAhX2HfIl8i36MfYl7iHuHe4Z8hX6Gf4Z/hH+FgIaAiH2IfYd7hXyEfYN9gn2BgICBgIGBgIN/hX2BfIB/hICFfYN+h32Gf4l8jHmLeIt4inmKeYp5inmJeYl6iXqIeoh5hH2Bf4V9hnyGfYZ+hn+Hf4d/h4CHgIiAiICIgIiBiIGIgYiCiIKIgoiCiIKIgomDhoGGgYaBh4KHgoiBiIGIgYmCiYKJgomBiYGJgouCjYGNgo2CjoKOg4+Ej4WPho+GkIeQh5GIkYmRiZGKkoqSi5KLkouSi5GLkYuRi5CLkIuPi4+LjoqNioyKi4qIiYSHgIp+in2FfYOAg4OEhISFhISEgIZ/hoCEgoWGhYaFh4GGgIWAhYGFgIWAhYCEgIOAhICEf4N/hH+EgISAhH+DfoN+g32DfoKAg4CEgISAhYCFgIZ/hn+Gf4Z/hn+GfoZ+hn6Gfol8inuKfIWAhoKGgoeDh4OHhIiEioSLhIuEjIONgY1/jX+Mf4l/in2KfYh/iICKf4l/i32Oe5B7kXySfZN+k36UfpR+lH6Uf5V/lX+Vf5aAloCWgZaBl4KXg5eEmIWYhpiGmIeZh5mHmYiZiJqImoiaiJmJmYmZiZmJmYmZiZiJmImXipeKloqVipWKlIqSiYyIh4eHh4iHjIuMi4qIh4aJhYmGiYiLiYyIjYiMh4uGiYaHhoeFhoWHhYaEhoSHhIeEhoSGg4aDhoOFg4WDhIKEgoSDhIOEgoSChIGEgYSChIKDgoOCg4KDgoSDhIOEg4SChIKDg4SEg4SDhIOEg4SEg4SChIGDg4ODg4OChIKFg4WEhYGGg4SHgYaBh4GGgYaChoKGg4WEhoWGhoiGiYWKhYuEioSIhIeEh4SHhIaFhoaFhoaGhoeHhoaGhYaFhoSFg4aBhYeDiYOFhIOEgIWBhIKBgYCFgoWGhoeGhIWBg3+CfoJ9hX2EfYd6hnyFgId+inyIfYh+h36Ge4R7hXuFe4R8hH2FfoV+hX2FfIR7g3uBe4F8gHx+fX5+gYCAgYKBhn6CfIR9hn2FfYV+iXuIfIl7i3mKeIl4iHiIeIh4iHiHeYd5h3mGeYV6f3+Af4N9hHyDfIF8gXuCfIN9g36DfoR/hH+Ef4R/hICEgISAhYCFgYWBhYGFgYaBg4CDgISAhICEgIWAhYCGgIaAhoCHgIeAh4CGgIeAh3+IgYqAi4GMgoyCjISMhY2FjYaOho6Hj4iPiY+Jj4qPi4+Lj4uPjI+Mj4yOjI6MjYyMi4yLi4uKi4mLh4uFioGIfo18in2Cf4KCg4ODg4OEgoODgIR/hIWGiIaIhYeDhYKHf4V/hICEgYSAhICEgISAg4CEgISAhX+EfoJ+gn6CfoN+gn6Cf4N/g3+Ef4R/hX+Gf4Z/hn+Gf4Z/h36Ifop+in2JfYx7jHuKfYeBh4OHg4eDiISJhIqEioWMhI2CjIKNgY1/i3+Mf419jX2Mfop+in6Lf419kHuRe5F8knySfZJ9kn2SfZJ9kn2TfZN+lH6UfpV/lX+WgJaBl4KXg5iEmIWYhZmGmYeZh5mHmYiZiJmJmomZiZmJmYmZiZmJmYqYipiKl4qXipaKloqVipSLk4uSi46KiYiHh4eHiYqMi4uJh4eKhoqIi4mMiY2IjYiNh42HjYeMhouGh4WIh4qHioaJhYuGioWJhYiFiISHhIaEhYSFhIWDhIOEg4WDhYOFgoSChIKEgoSDhIKEgoWDhYOFg4WDhYOEg4SEhISEhISEhYSFhIaDhoOEhISEhIWEhYWFhoWFhYOGg4aGg4iBiIGHgYaChoKGg4aEh4SHhIeEh4SHg4eDh4SHhIeEh4WHhYeGhoaGh4eHh4aHh4aHhYeHh4aIgoeEiIqHh4WDg4GDgYSChYSHhoiGhYaDhoKEgISAg4CDf4WAhX+GfoR/iHyDgIWAhYCHfId7hXyEf4R9hH+GfYR9g3yCe4N5gniBeIJ5g3mDeoJ8f39+f39+gXx/fYKAh36LeYxziXSHeop4iHeHeIh4iHiHeIZ4hniGeIV4hXiFeIV4hHiDeYN7foF/gIOAgn2Ce395gHeAeX97gHyAfIB9gX2BfoF+gX6Bf4J/gn+Cf4KAgoCCgIKAgH+Af4F/gX+Cf4J/gn+Df4N/hH+Ef4R/hX+Ff4V/hX6EfoR/hICFgIh/iIOIg4mDioSLhIyFjIaNiI2JjYqNio2LjIuMjIyMi4yLjIqMioyJjIiMh4yGjISMgot+in2Geod8gn+BgIOAgoKCgoKDgoGEg4WHh4mGiIOHgYaChoOGg4aBhYGEgYSBhYKFgYSAg4CEgIN/g3+Df4N/g3+Cf4N+gn6CfoN+hH6EfoR+hX+Ff4V/hn6JfYt9jXyOe418jXuNe418jHyMfYuAiYSIhYqFioaLhYqEioOKg4uCi4KKgoqAioCKf4t+jn2OfI19j32RfJJ7kXuRe5F7kXuRe5B7kHuRe5F7kXyRfJJ8k32UfZR+lX6Wf5aAl4GXgpiDmISYhZiGmIaZh5mHmYiZiJmJmYmZiZmKmIqYipiKmIqXipeKloqWipWKlYuVi5SLk4uSjJGMkIyMioqKioqIiIeHiYiKiIuKjYmNiY2IjYeNh46GjoaNhouFh4WJh4qHiYaJhouGjYaNhoyGjIWLhYmFhYSEhIWEhISFhIWDhYOFg4WDhYOEg4SDhIOFg4WChYKFg4WChIOEg4SDhISEhIWEhoSGhIaEhoSFhIWEhYWGhYaFhoWEhYOGhoaHhoiEiYGIgoiCiIOHg4eEh4SHhIeEh4SIhIiEiISHhYeFh4WGhYeFhoWHhoeHiIeHhoeHiIiHh4WIhYqKiomHhoaFhoaHiIiKh4iEh4WIhIiDhoKHgoeChoOGg4WChYGGgIaAgoCGfoKBg4CFfYV8hXuEe4J5gnuEfIR8gnyBfIJ8gnyCeYF4gneAeH54fXp9en97gXyDe4J5hHaHc4ZzhXKEcoVzhXSFdoV2hHaEd4R3hHeDd4N3gneCd4J3gXiAeX98foJ8g4N+gn5/f4R7f3Z9eH15fHp9en17fXt+fH58fn1+fX59f35/fn9+f35/foB/fX1+fX59f31/fX99gH2AfYB9gX2BfYJ9gn2CfYJ9g32DfYJ9gn6CfoGAgoCEf4aBhoGHgYiCiYWJh4mIiYmJiomLiYuJjIiMiIyHjYeNho2FjYSMgoyBjH2LfIh6h3qCfIB+gYCCf4KAg4GDhIKCgoODh4OFg4WEhYKGgYWBhIOFgoWChYGFgoWChIGDgYOAg4CDgIN/hH+Df4N/g3+CfoJ+gn6DfYN9hH2FfYV9hX6Hfop+jH2Oe416jXqMeox6jHqMe4t7i3yLfYt+i4GIhYeFiYWJhYqEioOJgouBh4GIgomBiYCKfo18jH2MfI95j3mPeZB5kHmPeY95j3mPeo96j3qPeo96j3qQepF6kXqTe5R8lX2VfpZ/l4CXgZeCl4OXhJeFl4aXh5iHmIiXiJeIl4mXiZeJl4qXipaKloqWipWLlYuUi5OLk4uTi5OLkoySjJGMkIyOjYuMhomFhYeGiomMjI2LjYmNiIyIjIeMhoyFjYWNhYqFiIWJiIuJiYeFhYaEh4OKhYyHjIeLhoqGhYWFhYWEhISEhIWEhYOFg4WDhYOFhIWEhYOFg4WDhYOFg4WDhYOFg4WDhYOFhIWEhYOFhIWDhIOFhIaEhYSFhIWEhISEhYWGh4aGhYeEioKIgYiCiIOIg4iEh4WIhIiEiIWIhYiFiIWHhYeFh4WHhYaFh4aHhYeGh4aHhoeHhoeHiIiJiIiIh4mHiIeIiIqGiIaJhYmEiIWIhIeEhoOHhIiDh4OHhIeEh4OGg4aCgISEg4SChICAgIOAhX+EfoB9g32DfoV7hHuBfIB6gHqEeYJ6gnuBe4F8gX2Bf4F+gX+Ef4R+hHyEeod3h2+FbYNwgnKCc4J1gnaCd4F3gXeAd4B3f3d+d353fXd9eH16foB+g3+EgH6AfYF8gHp+d3x3e3h7eXt5e3p7ent7e3t7fHt8e3x8fHx9fH18fX19e3x7fHt8fHx8fHx8fXt9e317fXt+e397f3t/fIB8gHyAfIB8gH2AfX99gH+AgYCAgn2CfoGAgoKDhYSGhYeFiYWKhYuFjISMhI2DjYKNgY6AjX6NfIt6iXuFe4R5hXyAgIJ/hX+FgYWBhYOEgoKCgoiDhoOGg4SEhoSHgoWBgoSFgoOEhIKFf4SAgoKDgYOBhIGEgYSAhH+Df4N+gn+DfoN+g32EfYV9hXyHe4l5inmLeYx6i3qLeYt5i3mLeYt6i3qLeot7i3uLfIp+iYGFhYeGiIWJhYqDioKJgYiBiIGJgoiCh4GLf5B7jH2Me453jneOd453jneOd414jXiNeI14jXiNeI14jXiNeI54j3eReJJ5lHqVfJV+ln+WgJaCloOWhJaFloWWhpWHlYeViJWIlYmViZWJlYqUipSKlIqTipOLk4uSi5KLkYuRi5GMkYyQjI+Mj42NjouNhYqHh4iIiIeJjIuLjIqLiYqIioeJhomEioKMg4yFi4eJiYqKhYaEhYWFhoOHg4mHiIaJh4qHiYeHhoeGhoaFhYaEhoSGhIaEhoSFhYWFhoSGg4WDhYOFg4WDhYOFg4WDhYOFhIWDhYOFhIWEhYSGhIWDhIOEg4WDhYSFhYaFhoWGhIiDiYKJgoiCiIOIg4iDh4SHhIeEh4SGhIaEhoSGhIaFhoWGhYaFh4WHhYeFh4WHhoeGh4eHh4eHh4eHh4iHiIeIh4iGh4aIhYaEh4SHhIiFiIWJhYmEiISHg4iEiISJg4eDhYaGhoeFh4OEg4WDhIKEgYGBg4KFgISBhX6EfYR8hn2CfYN8gn2Cf4V9hX6Df4B/hH6EfYV9hH2DfoV+iHiHcoRug26CcYF0f3Z/d353fXd9d3x3e3d5dnl1eHV4dXl3enp9gH+CfYSAfoJ7gXx9d3t3end6eHl4eXl5eXl6eXp5enl7eXt5e3l7eXt6e3p8eHp4enl6eXp5enp6enl6eXt5e3l8enx6fXp9e317fnt9e317fXt9fH19fX59f32BfYB/fX99fn9+f4CBgIWAh4CJgIt/jH+Mfo19jXyNe416jHiMdoR7f3mCeIJ+gICEgYSAg3+FgYSChYCGgYWFhIWChIGDgIOCg4OEgYGAgIGBgIJ/goGDgYKAgoKDg4SDhIKEgYOBhICDf4N/g3+DfoR+hH2FfId7iXqLeIt4ineKd4l4iXiJeYp5inmKeYp5inmKeop6inuJfIh+hYKEhIeFh4SJg4iCiYGLgIqAjH+MgYmFhYWHgYp/in6MeYx2jXWNdI11jXWMdYx2jHaMd4x3jHeMd4x3i3eLdot0jHKOcpBzkneTepN8lH6TgJOBk4KTg5OEk4WThZOGkoeSh5KIkoiSiZKJkomRipGKkYqRipCKkIuPi4+Lj4uPi4+Mj4yOjI6MjY2NjYqLio6JiYiIiIuKi4uLi4qKiomJiIiGh4SEgYCEf4aBiIaKiYaIhIaFh4WGhoSGg4iHioeKhouGi4aIhomHhoaGhYeFh4WGhIaDhYOFhISFhYWFhIWDhYOGg4aEhYOFg4SDhYOFg4WDhYOFg4WDhYOFhIWEhYSFhIWDhoOFhISEhISGg4mCiYKIgoeCh4OHg4eDhoOGhIWEhoSFhIaEhoSGhIaEhoSGhIeFh4WHhYeFh4WGhYaFhoaGhoaHhoaGhoaGhoaGhoWFhYWGhIeFiISIhImEiISIhImFiIWHhoiEiYOJg4mDiISHhIiEhoWFhIOChYGGgoWFiIOEgoeChoGGgYaBh3+EgYWCh4GFgYWBhoCFf4WAh3+FfoR/g32DfIR+hYCIfIl4iG+BcX10e3Z5dnp1enV5dXl1eHZ3dnVzdHB1cHZyd3V5d3t6foB8hIJ9fnd7dXp2eXV4d3h4d3l2eXZ5dXl2eXZ5dnl3end6d3p4enh6dnh2eHZ4d3h3eHh4eHh4eHl4eXh6eHt5e3l7eXx6fXp9e3x8e397fnx9fX17fHp+eYB7gX17fHh6e3p8eH13gniGd4h3inaKdYtzinOJcoZ1g3p+fICAgH+Bf4OAhIGFfoaChoSFg4WChIGFhIOFgYSAgoCCgYKAgICBf4GAgIODg4aAg3+CgIGAgIB/f3+AgICBf4F/gX+CgIN/hH6FfYV8hnqIeIp2i3SKdIl1iXaId4h3iHiJeIl4iXiJeYl5iXmJeol6iHuIfIh+hYKFhIaEhoOHgoiBioCOfY17jXyMfoyCh4iGhouBjHqNdo50jnOOc41zjHOLdIt0i3WKdYp1i3WLdYt1jHWKdYh0iHCKbI9skHKPeI97j36Pf4+Bj4KPg4+Dj4SPhY+Fj4aOh46HjoiOiI6IjomOiY6JjYqNio2KjYqMi4yLjIuMi4yLjIuMi4uMi4yMjIuMi4yMi4uLioqKioqKiouJi4mLh4qFiYGFfoODgYN/g4CDg4KFg4SDhYSEhYKFg4WDh4WKhouGi4aKhomHh4aHhoeFh4WFhYWEhYSFhISFhIWFhIWDhYOFg4WEhYSFg4WDhYSFg4WDhYOFg4WDhYOFhIWEhYSFhIaEhoOFhISEg4WFhIqAh4GHgoaDhoOGg4aDhoOFg4WEhYSGhIaEhoSGhIaEhoSGhIaEhoSGhIaFhYWFhYWFhYWFhYWGhoaGhoaGhYaDhoSGhoWHhYeEh4SHg4eDh4SHhIeEh4SHhYiGiYWJg4iDh4SIhIiDh4SFhYWGhoWIhImCh4GHgIaAhYCFgIWBh4GGgIaAhoCGgIeAh3+GfoV+hICEgYSAgoCBf4R+hH6EfYZ8hHuDd354e3h7dn11fHZ9d3h0dXR2d3l4fXR8cXhudXF2cnZ0d3d7f32Dgn1/d3x0eXR4dXZ4dHlyeHF3cndydnN3dHd0d3V4dXh1eHZ4dHZ0dnV2dXZ2d3Z3d3d3d3h3eHd5d3p4enh7eXx5fXt8fH1+fYB7g3yCf399fnt+e398f3x+gXt8eHt/fH99fHR/b4JwgHR/c392gHeAfH2AfYSAgIR/hoGGgIV/hH+Ff4aEhYOCgYCBgIOBhIOEgIOAgYGCgYOBg4KDgoOBg4CCgYKBgoGBgYCBgIJ/goCBgYGCgIJ/g3+Df4R+hX2GfId6iXmKd4p1inSIdIh0iHWIdoh2iHeId4h3iHiIeIh4iHmIeYh6iHuHfId9hICBg4KDg4GFf4d9iHyLeYx5inqKfIp+i4SPhZN+knmRdpB0j3SNc4xzi3OKc4pziXOJdIl0iHOIcolyinWJeYR8fnuEeIdrhmuFc4V3hnuHfYh/iYCJgYqCioOKg4qEioWKhYqGioeKh4qIioiKiYqJiomJiomKiYqJioiKiIqIioiKiIqIioiLiYuJi4mLiYqKioqKioqKiomKiYqJi4iLh4uEi3+GfoOChIWCg4CBgYGCgYKCgoSChIKFgYWDhYSHhYiFiIWGhYSEhYSGhIeFiIWIhYaEhoSHhoaGhIWEhYWEhYSFhIWEhYSFhIWDhYOFhIWEhYOFg4WEhYSFhIWEhYSGhIaDhYOFhISEg4WEhYmAh4GGgoaChoKGgoWChYOGg4aDhYSGhIWEhoSGhIaEhoSGhIaEhoSFhIWEhYWFhYWFhoWFhoaGhoaFhoSGgoiEh4aHh4aGhoaFhoSGhIeDh4OHg4aDhoSGhIeEiISIg4iDh4SHhIeDh4OHhIiEiIWJhImCh4CHgIeAhoGFgoaBh4GGgYaBh4CIf4d/hn+Ff4R/g3+Df4KAgIF/gYF/gnyCfIN7gHqBeXx5fnl/d313fXZ7dXp3fHV8dn52gHSBc3xudmx1bnRycnVydnZ5e35/fH16fHZ7dnp3eHZ2eHV4cnRwcXFxcnNzdXN2c3ZzdnR2c3J0c3V0dXV1dnV2dnZ2dnd2d3Z4dnl2end7d3x6fHx7fXt9e317f3yDfYOAgIB/f4F8gH2AgICCfoF7fH98f32Af4CAgn+CfoB/gICCgYOBg36FgIaCh4CHfYd+hYGFgYeBhoCDf4GCgIWBgoGEgoOAgX+BgICAf39/f39/f39+fn5+fn9+gH+Bf4F/goGCgoGCgIN/g36EfoV9hnyGfId6iXiJdol1iXSIdYd0h3SHdYd1h3aHdod3h3eHd4d4h3iHeYd6h3qHfIZ+goKBhIODhYOHf4x9jH2Me4t5iXqIe4h7iHyMfI17jnmNd411jHSLc4pzinOJc4hziHOHc4ZzhXODdX17bnpwcnR0cHOHc4Zxg2R+an1wfnWAeIF7gnyDfoR/hIGFgoWChYOGhIaFhoWGhoaHhoeGiIaIhYmFiYWJhImEiYSJhImFiYWJhYmFiYaJhoqGiYaJh4mIiYiJiImJiYmJiIqIi4eLhoyCjn6JfoN/g4OCgoKCgYGCgoKEgoWBhYGGgYaCh4WIhYiFhoWDhIOEhISEhISDhIOEhISDhYSGhYSEhISFhIeGhYaEhIWEhISFhIWDhYOFhIWDhYOFg4WDhYOFg4WDhYSFhIaDhYOFhIWEhIWEhYiBh4CGgYWBhYGFgoWChYKFgoWDhYOFg4aDhoSGhIaEhoSFg4WDhYOFhIWEhYSFhYWFhYWFhYWFhYWEhYOGg4eEh4OFg4SEhIWEhYOGhIeEh4OGg4aDhoOGg4eDh4OHgoeDhoOGhIeEiIOIg4iDh4KIgoiCiIKHgoeBhoGFgoaBh4GHgYaBhoCGgIaAhoCFgYSAg4GDgYGBgIJ+gX9/gH+AfoJ7fnuAe395f3mCd354gHmCe399f3x/fIJ7gXyCfIR6hHJ+bnRxdHB2eXp3eXR5dnl6fHt/en58fnt8e357fXyAdnxtd210cHJzcnNyc3Jyd292cnVzdXV1dXR1dHV1dXZ0dnR4dHl0eXV6d3p5e317fnp+en19fHx+fYF9gX5+f359gXyDfoGAfIB7en59gIF/f39/gnyBf4OChIOBgYCAgX6DgIR/hX2EfYR/hX+Ef4J9g36Ef4OBgoSBhYKEgoJ/f39/f32AgICBf39+f35+fnt/en55fnp8fH59gH+BgICCfoN9hH2FfIZ7hnuGeoh4ineId4h1iHSGdIZ0hnSGdIZ1hnWGdYZ2hnaGdoZ3hniGeYZ5hnqGe4V+g4KIgoqCi4OMg4x+inuIe4R7gHuAeoZ6hneGeIZ4h3iIdol1iXSJc4hyiHKIcodzhnOGc4V0g3h4f2aEXYZdg2R6em6Rbot1gmh8YnlneW16cnt1fHh9en18fn5/f3+AgIGAgoCDgYSBhIGFgYaBhoCHgIeAiH+If4h/h4CHgIeBh4GHgoeDh4OIg4iDiISHhIiFiIaIh4iHiIiJiImIioeLh4yGjoWNgod/hoCGg4WDhoKFhYOGgoaChYGFgIaAh4OIhIiFhISDhYOFhISEhISEhISDhIOEg4SDg4SDhIOEg4SFg4SEhIWEhYSFhIaEhoOEg4SDhIOEg4WDhYOFg4WDhYOEg4WDhYOFg4SDg4SEhIiCiICFgYWChoKFgoWChIKEgoSChIKFgoaDh4OHg4eEhoOGhIaEhYSFhISDhIOEhIWEhYWFhYSFhYaEhoKHg4iCh4KGhIWEhYWFh4SGgoaDhYKGgoWDhoOGg4eDh4OHg4eChYOGg4aDhoOHgoeCh4KIgYeBhoGFgoWChYKGgoaBhoGGgIWAhYCFgIV/hH6CgIKBgYGBgYGBgIJ+g32DfYF9f35/goCCgYODgoGEfYR+gn1+foJ+hH+CgIN/g3+Af4J+gXt/eoF5gHd+d3x6f3t8d3l6enl9d3x6fH16gHyAgYCCe4J6gXZ+dXpzd3F4c3hveHJ2c3VzdHR0dXN2cnVycnVxd3N5cnlyenR6dnl4eXp4e3l+eoF8f358fnx9f32Afn99fn1+fX9+f3+Df4N+g32Bf4B/g4GCgYGBgH9+f3+AgH6AfIB9f32AfoB9gXyCfIF+goCDgYSDhIaDg4KCgX+AgICAgH5/fn59fn5/fn98f3uAe4B6gHt+fXx+e358gHyCfIR6hHuFfId6h3qHeop5inaIdYh3iHeIdoh2hnaFd4Z1hHWEdYR0hHWEdoV2hHeEeIR4hniGeYd8iH2JfYl9iH6If4Z/gYF+gH9/hH6De4B4g3iEd4N1hHWFdIZzhnKGcoZxhnGGcoZyhXOEdYJ4fH5yiWWZZZlolWuMeXyJaYxthnWDZn1feGZ2a3VwdXR2dnd4d3p4e3l9eX56f3qAe4F7gnuDe4N8hHuEe4R6g32Ce4N7g32CfoN/g3+DgISAhIGFgYaChoKGg4aEhoWGhYeGh4eHh4iIiImJiYqKioqKiomJh4aGhIeBhoGHhIaFgoSChIKFgYSAhYCGgYaEhoWEhYOFhIWEhIOEg4SDhIOEg4SEhIWDhYOEhISEhYWGhIWEhYSFg4WDhISEhIWEhYSFg4WDhIOFg4WDhIOEg4WDhYOFg4SDgoSDg4eAh3+FgYSBhIGEgYSChIKFgoWChYKFgoaCh4OHg4eDiISHhIeEh4WGhYaFhoSFhIWEhYWFhYWFg4eBiIKIg4mFioaKh4iGhYSEg4OEgoSCg4KDgoWChYKFgoWBhYGFgYSChIKFgoWBhIGFgYWBhoCGgIWAhYCEgYWChYGFgoWChYGEgYSAg4CCf4F/gH9/f35/fn9+f359fn1+fnyAfIF/g4WChYCDgICAgICDf4B8f3yCfIR8gnyDfYR8g36BgIKAgIB+gX9/gnuBen54fXh+eH55fnl+d311eHh5e35/gIB/fX98gHt/fIF9gXuAen10c3JycnFycnNxc3J0dnZ5cHdtd253bnhveXJ6dnp6enp5enh5enl5gHp+f3t9fH5+fX59f31/fn5+fH59foB/gn+CfIB7gHuAfoGBgIGAf4F9gH2BfoF+gH5/f4B+f32Af4OBg4ODg4OEg4SCgoB/gYGBgIGAgn6CgIGAgH+AfYB8gXuBfIB+gH9/gH2Be4J7g3uFeoV6h3iHeIZ5hnqIeYd4h3iHd4Z2hHaDdoF3gHaAdYB0fnOBcYNxgnSCd4B3gnOFc4Z1hnaGeIZ6hHuIeoZ6hX2Cf4GBg4ODhYCFfoGCgISAiX6KdIlyh3WEdoN0g3KEcIVwhXCFcIVyhHSAenx/foJyi2adaZ1smm+TeYmJepVqlGqMbYBmdmdwaW5qbmxub29ycHRxdnF4cnpze3N8dH11fnZ/d395gHqBeoB4gXeCeYKCgYF+gH6Af3+Af4F/gn+DgIOAhIGEgoWChYOFhIaFhoaGh4aHh4iHiYeKh4qHioeKhomHh4mEiYGGgIWChISChIGDgoSChYGFgIaAhoOHhoaGhIWDhYOFg4WDhIOEhISFg4WDhYOFg4aEhoWFhIWEhYSEg4ODhIOFhISEhYSEhISEhISEhIWDhYOGg4WDhIOEg4SDg4SBhISAh32Ef4OBhYGGgIWBhIKFgoWChYKHg4iDiYOJhImEiIOIg4iEh4SHhIeFh4WGhoaFhoWGhYaHgot/jYGKhIaDhYWFg4SBhIGDgoOCgoOChYKDgoSChIKDgYSBg4CDgIOBhIGEgYOBhICFgIWAhYCFf4R/g3+DgIOAg4CCgIKAgoCBgICAfoB8f3x9fXt+e3x9fn+AgIJ+g35+f32AfoGAg4OAg3+Bf3+AgYB9fX5+g4CEf4N/hH6EfoJ+g36Bf4GBgIF/goCCgIGDgH+AfX6Ae4B6gHp+en53f3eBd4B4fX19f4F9gH2AfX97e3p4d3VzdHNxc3BycHB0c3p0gHaCd350e216anpteXJ6eH19f319foB+f318f3uBfn+AfH19fH57f319fXx6e3x5f3h+enp9e39+gYGCgYOAgn2De4N+g4CDfoV+hYCCfoN/hICFg4SBhIOCgYF/gH5/fn5+fn1/fn19fn+AfoN+g32DfYN9goCCgYKCgIJ/hH2Ge4h5iHiHeod5iHiId4d4h3iHeId3h3eGd4V4g3iCd4F2gXWCdYN2hnSFcoRxg3CDdYR6iniJdYd1hnaGd4Z5hnyHfId8hX6EgoSDhYSCh4SHiYWLgol+h3mEd4R4gXp+eX5ygW6DbYRthG6Db4NwgXZ7fXt8d4FslWyhbaJwn3SYfI2HfY5tj2KHYIJpeG5xbmxpaWVqZGtma2prbmtxa3NrdGx2bXdueXB7c312fHp7en98hX6DgoOAg4GCgX9/f32BfYF+gX6CfoJ/g4CDgYSBhIKEg4SEhIWFhoWGhYeFiIWIhYiFiYWIhoiGh4iGiYKKf4Z/hYKEhIKFgYWBhIGFgYaAhYCFhIaFhIaChYGFgoWDhISDhIKEgoWChYKFg4aGhoWFhIWEhYSEhISDhYOFg4SDhISEhISEhISFhIaDhYOFg4SDhIOEg4SEhIWEh4OHhoSHgYZ+hn6Hf4aAhoKFgoWChoKIgoiCiIKGg4aDh4OHgoaChYOFg4WDhYSGhYaHhYaEhYOFgYl/jYGKgoiDiIOGf4SAhIGDgYODgoWChYGEgYOBgoKEg4WChIKDgoOBgoGDgISAhICEgIV/hH+Ef4N+g36DfoJ/gYCBgIGAgYCAgX2BfIF7gXqBgICFgYODgoSBhIKEgYJ+gn6EfYJ9gH19gn6DgYCCgoN/g4KAf3+EfoV9gnyAfX9+gH6BfYB9fn9+f4F/gIB/gH2BfYGAgH9/f36CfIJ8gXt/eoB2fXh7eXx3enh8eXl5eHt2fHh4e3d5dXhzfHKAcoFwf3R/eIJ3g3KAbn1we3N7dnx5fX18fnt9en97f32AfYB8gHx+fH16fXt9fH17gHmAe3t7e3t8fX1+fX59fX98gHqBeoN+g3+CfYN7goB/gn6CfoGAgH+Afn59fX57gHuBfIF8fnt9e3x8e3p9eYB6gXuBfoKBgoGBgoGFgYh/in+NfIx7in2IfYt8i3qLeYt4inmJeYp4inmKeYh7hX+Gfoh7iHqFeIR2hnSHcolwiG+EcYR1hHOEcYNzhHSFdoV3hXiFeYV7hHyDf4OChIGDg4KFgoKEf4F+fXyAfYJ/hH6Fd4Zth2uGbIVthG+CcIBxfXt7gH+Cfodzl22ibqNwoXGcc5N4hH1zfWd+YINfh2x8d3p0d2t0Z3Fmb2dsamlsaG1nbmduZ29ncWd0andveXB3b3hxenR7dnt4fXp+eH14fnl/en97gHyAfYB+gX+Bf4KAgoGCgoKDg4SDhIOFg4WDhoOGhIeEh4SHhYeFh4aGh4WJgYp+h3+EgYSEgYSBhYKGgYSAg4CCgYKCgYOBhIGEgoSDhISDhYKEgYSChIKDgoODg4ODgoOChIGGgYeDhoOGhISEhISEhIOEg4SEhIWDhYOFg4SEhYSFg4WEhoWHhYiFiYWJh4aHhoKGfYZ8hn6GgIeBiIGHgYeBhoKGg4aDh4OHgoaChYOFg4WDhIODhISFg4aDhoGHfol9i36IgIZ9hn6EgISAg4GDgoODgYWAhICFgoODhoSFg4SDg4OEg4ODhIOGgoSChIKFgYSBg4CDgIN/g3+CfoJ+gX+Bf4F/gIB/gXyCeoJ7gYGBhIOFgYOBgYOAhH+DgIOBhH2Fe4R8goOChYKEgYGAf4CBgIKAhH+EfYN9gn2BfoCAgICAgIF/gH+BgIB/gIB/gn+DgYOAhIGEgYOAgX9+gXyCen56fnmAeIB3e3p+e3p6eXp4eHl5gHp/e4N5hXSEc4Jwf3F9cn1xe3F6cXpxeXN5dXh3dnp2fHV8dnx5e3x7fHt8fXt/fH5/fH97f3t+e317fH2Ae4B6f3l7eXp5eXl6e3l+fX9/gX6CfIF8gIN+gH1/fn5+fn9+fn5/fYB7gX2BfYF9gXuBeoF6fXt5e3p+f4CBhIGEgoiEjIKMgY2Bjn+PfYt7h32Kfox8jXuNe417jHuMe417jHqLe4t8iH+Ig4mAiX6JfYx8jHqOeIx1hHeEdoVzhXGJb4lvhnGFdIV2hHiCeoJ7gXyAfnyAeYB3gHeBdoB4gHqBgoKGgId8iXiMdotzinKIcoZxhHKDc4B1fnx/gICAfIRslWqhbKNtom6fbppvk3GHc3lycGxuZXJfemx3hWyOaYdvfHFzcm5wa29ob2dtZ2xna2draGxqbWtubXBvcnFzcnVzdnR3dXl3enh7eXx6fXt9fH59f35/foB/gICAgYGBgYKBg4GDgoSChIKEgoWChYKFg4aEhoSGhYaGhoeEiIGIfoZ/hYGChICFgYSChIGDgYKCgoOCg4KDgoOChIODhIKDgYKBgoGDgYOChIKEgoWDiIOKgoqCiISHhYaFhYWGhoWHhYeGhYWEhYOFhIWFhoaIhomEiYWJhYmFiIWIhIeFhoWEhYKCh36JfoeAhoGGgIaAhoGFgoWDhoKGgoWChIOEg4ODgoOChIKFgYaAhn+IfIt6inuGfIR9g36DfoKBgoKBgYKDg4WCh4CHgIWEhYWEhYSFhYSFg4SDhIOEgoOCg4KEgoOChIGEgYOBg4GCgIKAgoCCf4GAgIF+gn2De4N8g4GBh36EgIOAgYCBgYGBgYB+g3yEfIGCgoOAfX5/f3+BgoCBf4GAfn+BfIN6gnuBfIF9gX6Bf4F/gIGAgYGAgICBgIKAgIB+gX6BfYJ+gn+BgIB/f4J+g3yDeoN4fXp8e3t8fHuAe4B7hn2GeIVzgnJ/cnxyenJ5cndxdnF1cXRxc3JydnR5dXt1f3h/eH95f3x+e398f32Ae4R+hH+EgIN/g3+Ef4OAgn+BgX1/fH58gHt/fIB9f3x9fH1/gIKDgoOAf35/f3+Af4F/gH9/foB9gX+CfoR9hXyFfYN+gYGAiXyJeoV8hXyGe4V7gnyCfIJ7g3uEeoR6hHuGe4h5h3iHeId3iHeIdol2iHeHeYh6iHuJfoiBiIKMfY17i3yNeot4iHyFgIp9jneQc4txiHOGdYR3g3mBe399fH54gHSBd4F3gHmAfYKDgod/iHuJeYl3iHaHdod1hnSGdIVzhHOEdYJ4gH1/gH6CdopqnGmkaqNroWuga5xrmGqUaY1phmiAaHxrenZ3iHCTa5Nwhnd/dYBzfHV7dnZ2cnJvbm1rbGduZXBlcmdzanNtdG91cXVzdnV3dnh3eXh6eXt6e3t8fH19fn1+fn9+f3+Af4F/gYCBgIKAgoCCgIOAg4GEgYSChIKEgoWDhISEhoOGgYWAhn+FgYSDg4SChYKEgoODhIOEg4SDhISEhISDg4SDhISEhISFhIWEiISKhIuDi4OKg4iDh4SFhYSFhYWGhYaGhoaGhYaFhoWHhIeEh4WHhomFiIWJhYmEh4aHhoaFhoaJhoiGioWLgoeChoKGgoaBhoGFgYOCg4KEgoKCgoOCg4KEgYWChYKFgYeBiH6Je4l/hnuIe4V8g32Bf4F/goCBg4CDgYOAhoCGf4OAg4GCg4KDgoKCgoKBgYGCgYKBg4CCgIOBg4CDgIKBgYKBgoKBgoCBgICBgIF/g3+EfYN8g36Ch4CFf4OAgoGBgICAfoF/g3yEfoaAg4KBg4CEfYB9gH5/fn9/f4GDf4R8g3qBeoB7gHx/fH99f36AfoB/goCCf3+AfYB/gH2BfYB/gYKCgoOHgYR/goJ+g36Cf4F/gX6AgIKEgYR/gnmAd352fHV6dHh0d3R2dHR0c3RydHF0b3Vvdm93b3hxfHSBdYR3hXqFeoZ8hH2CfoF9gXyBfoB/gX6CfoN/g36EfoV+hX6DgIF/gX+Bf4GAgX+AfX59fn1+fX9+fn5/fn9/gX+CgIKAgoKBg4GDg4KGgYmIhouCiH+GfYJ9f31+fH57fXt/e4F6gnmCeIJ4g3eCd4J2hHaFdoZ2hnaGdoZ2hneGeId4hneFeIR8hX+JfIt4iXiKeIl4iHqFfod/jXqLdYh0hXWDdoF5f3x8fnl+dX90fHd7enx6fn9/hX+He4d4h3eHd4Z3hneFdoR2hHWEdYN0g3OCdIB6fH19fHt9d4Rlk16dYJ1jnGWbZppnmGeWaJNpkGqLbYR0e3txgGeCXXhXamR8a4ZyfneAeoZ9ineHdX50enB4Z3pge2J6ZXlpeGx3bndweHJ4c3l0eXZ6d3t4e3h8eXx6fXt9e358fnx/fX99f31/foB+gH6BfoF/gn+Cf4KAgoCDgIOBhIGEgoSEg4WCh4GIgIZ/hYGFg4SFhIWFhoWFg4WDhYKFg4WDhYSHhIeEh4SIhYmEioOJgoiCh4KGgoWDhYOEhISEhISEhISEg4WEhISEhIOEg4SChIKEgoWChYKEgoSDhIWDh4eGi4SJg4eEhoOFg4WDhIOFgoWChIKCgoKCgoKCgoGDgoSChIKEgYSChYKFgIaAiH6KfYx9i32HfYN8g3+Fg4aAhYKGhISEhYiEhoKEgIWBgoF/gn2De4J/f4B9f3yBfIJ+g36Ef4R/g4CCgYGCgYKAgoCCgYGBgIGAgYGAgoCEfYV9hn+Gh4OHf4SBf4R/gYCAfYJ9g32DfoOAg4SAgX+EfoN9gX+CfoF/gH9+foB8gHqAeX56fnp+en57fnx+fH57fXx9fXx/fIJ+gn+CgYOCgYGBgYCCfn9/fYCAgIGBgIJ/g4CEg4KDf4N8e3p6eHl3eXd4dnd2dnZ1dnR2c3ZydnF3cHdweG94bnluem98cH5yf3R/dX92f3d/d353fnd+d312fXV+dn51fnR+dH90f3V/dX50fXR9dH12fnd9d313fXh8eHx4fHl8eX16fXp9e398gH1/fH58fXx9fn6Af4B/gH5/fn5+fn+Af4F/gn2BfIF7gXmDeIN3hHeFd4d2iHSIdId0hnWGdYZ1hXaFd4J5fnuAeIZ1iHWHdYd1hnaFeIN5gXyDfYV8hnqGd4V1gXZ/eHp8dX10fHh8doJ+gYJ+f3+CgYeCin6KeYh3hneFeIR4hHiDd4N3gnaCdoJ1gXWBdn19fIJ9gX6AcoVdllqeXZ5gnGKbZJpmmWiXaZVrkm2Ob4l0gnl6fXN/bYBphmeTZZlrjHyIgYGBg4GFgYN9gHqDdIRqg2OAZn1oe2p6bHlueW95cHpyenN6dHp1e3Z7dnx3fHh9eH15fXp9en57fnt+fH58f3x/fYB9gH2AfYF+gX6BfoJ/gn+CgIOAg4GDgoSDhIWEhYSGg4aDhoOGhIeEhoWGhYSEhIaDiIOJhIiDh4OHgoaChoKFgoWChIKDgoOCg4ODg4ODgoOCg4KDgYOBg4GDgIKAgYCAgH+BfoJ/goCCgYOCg4KEgoSChIKDgoOCgoOChIKEgoODgoOCg4KBg4GEgoOChIKEgoSBhIGEgYOAhX6GfYZ/h36IgIl/in+MgYuCi4WLh4mHhoWGhIeFh4aHhIeEhoOEhYSDhIGGgYeBh4KGhIWJgot9i3uGfYKAgYGBgoGCgYKBgoGDgYOBg4CBfoB/gH+Bf4N+hYCGhoaIg4aDg4aAhoKGhYWFhoSHg4eDh4aFhYOEg4WCg4GDgYKBgYKAgoOBg4CDfoF+gX1/fH58fXx9fHx8e316fXp+en97f3x+fH17fXt9en16fXl/e4B8gHt+e397f3t+e358fHx7fH59fHt5eXh4eHd4dnh1eHV4dHhzeHN5cnlyeXF6cXpxe3B7cHxxfHF8cX1xfXJ9cn1yfXJ8cnxyfHJ8cnxyfHJ9cn1yfXN9c310fXR9dX11fHZ8dnx3fHd8eHx4fHh8eXx5fHp8e317fXx+fH57fnl+fXx+en56fnt9fX1/fn+Af4F+gnyCe4R5hnaKc4h1h3eGd4h1iHSGdIZ0hnWGdYV2hHeEeIN7g36Jfo15iXWHdYV2gniBeIF3g3iFeYJ8gX2Ae396fXt6fXl/eX57fX9+goGDg4SDiYCJfIh6iHmHeYZ5hXmEeYR5g3mCeYJ5gXiBd4B2f3V8eHt7d355f3l+aItbnVyeX55inWSdZ5xpmmuZbpdwlHKRdY18hoOAiHqMdY9wlGuZZqBol3eJfX9+gX+Een93enqEd4drg2eAaH5pfGl7a3tsem16bnpvenF6cnpze3R7dHt0fHV8dnx2fHd9d314fXl9eX56fnp+e357f3t/e398f3yAfIB9gH2BfoF+gX6Bf4F/gYCCgIKBgoGDgoODg4SEhIWFhYWGhIaDhYKEgoSChIKDgoOCgoKCgYKBgoGCgoKCgoKCgoGCgYOBg4CDgIR/hH2Ee4N6gXp+fXyBfIJ8gX6Bf4GAgYCBgIGBgYGAgYCCgIOAg4CEgISCg4KCgYOAg4GDgYOAhICEgISAhYCFgIV+hn2Hf4d/h3+HgYeCh4KIgoaChIOCgoGCgIKAgoCCgIKBg4ODhoOJg4qDioWKh4mHiYiJioeLhY2DiYKEgoWBhYKEg4ODg4SDhIKEgYWAhn+IgIiChoCFgoWChYaFiIOEgoODgoWDhYOEg4OCg4KEgYSBhIGEgYOBgoGBgIKAgoCBgIGAgICAf39/fn5+fX59fXx9fH58fnt9e356fnp+en56fnp+en56fnl+eX55fnl+eX55fnl+eX55fnp9enx6fHp9eX15fXl8eXx4e3h7d3p2enZ6dnp1enV6dHt0e3R7c3tzfHN8c3xzfHN9c31zfXN9c31zfXN9c31zfXN9c31zfXR9dH10fXV9dX11fXZ9dn13fXd8eHx4fHl8eXx6e3p7e3t7e3x7fHt9fH18fH97gnyCf4GBf4J7gnmAe4F/g4CGf4d/h4GIgIl/iX2Meop3hneIdot0iHOGdIZ0hXWEd4N4hHiDeIV3gniEeYZ1g3WDdoF4f3t/e4N4hXd/en19fH1+e4R7g4CCg36BfICCgYmCin6He4d7iHuIeoh6h3qGeoZ6hXqFe4R7g3uDe4N7gnuCeoF5f3l9fXuBc4Ruh2iPYJtfomKiZaFooWugbZ9wnnKcdJp2mHmUfZCDiYiBi3mNco1sjmaRYZhcl2SPdIZ9hH+EgYiAh3uJdYVvf21+an1pfWl9aXxqfGt8bHxue297cHtxe3J7c3tze3R8dXx1fHV9dn12fXZ9d313fnh+eX55fnp+en56fnp+e397f3x/fH98f31/fX59fn5+fn5+f39/f39/f4CAgICAgIGAgYCBgIGAgYCBgIGAgX+Bf4F/gX+BgIGAgYCBgYGBgYCBgIKAg4CDf4R+hX2Fe4Z4hnqDgH2DeYB6f3yAfn9+f39/f3+Af4B/gX+Bf4J+gn6Df4OAg4CDgIN/g3+Df4R/hH+Ef4V/hn2Ge4V7g36Df4N/hX+FgIWAhYCFgIWBhYCDgIKBgYGAf4F/gICAgICAgYCBgYKBhIOGhIiFiYeHiIWIhIWDhISFhIWDhISEhIOEgoSChIKFgYaAh4CGgYWDhoWGhIaDhoWFhISDhIKEgoSBhIGEgISAhICEgIR/hH+EgISAg4CDf4J/gn+Cf4F/gX6BfoB+gH2AfX99f3x/fH98f3t/e397f3t/en96f3p/en96f3p+en55fnl+eX55fnl+eX55fnl9eX15fXl9eX55fnl9eX15fXl9eH14fHh8d3x3fHd8d3x2fHZ9dn12fXZ9dn12fXV+dX51fnZ+dn52fnZ+dn52fnZ+dn52fnd+d353fnd9eH14fXh9eX15fXl9enx6fHt8e3x8e3x7fHt9e317fnt+e357f3x+f36CgIGAf4N+g3yDeoZ4h3mGe4d6h3mHeod6h3mIeoh6iHqJeYh3iXWHdIZ1hXeDeIN5hniFd4R4gHyCe4V3hHWHc4ZzgneAe4J8hHuDe4CAfoKBgYWBgX9/gYKAh3+JfIh5iXeJd4l3iXiIeYh5h3qHe4Z7hnyFfYV9hX2EfoR9g32DfYJ8gX14gWmJYJVen2ClZKhnqGqnbKdvpXGkdKJ3oHqffZ2Bm4WYiJaLko2Oj4iRgZR6mHOebKVomnCMfIZ+hH6If4SAgn6Je4V4gXKAbX9qf2h/aH9of2l+an5sfm19bn1wfXF9cnxyfHN8dHx0fXV9dX11fXZ9dn52fnd+d354fnh+eX15fXl9en56fXp9e317fXt8fHx8fHx8fHx9fH18fXx9fH59fn1+fX59f31/fX99gH2AfYB9gH2AfYB9gH2AfoB+gH+Af4B/gICBgIGAgYCCf4N/g36EfoV9hXuEe4N/gIN8gnp/e399f35/f35/foB+gH6BfoF+gn2CfYJ+g36DfoN+g36DfoN+hH6EfoV+hn2IfYqAiYKHgoaChoCGf4Z9hnyFfYN8g3yDfIF8f319fn5/f3+AfoB/gH6AfoB+gH9/f39/gH+BgIGBgoGDgYOCg4KDgYSBhIGEgoSChYKFgoaCh4OGg4WChYKFgoWChoKGgoaChoGFgYWAhYCFgIV/hX+Ff4V/hH+EfoR/hH+Df4N+g36DfoN+gn6CfoJ+gX2BfYF9gX2BfIB8gHyAfIB8gHuAe4B7gHuAe4B7gHt/en96f3p/en96f3p/en96fnp+en56fnp+e397f3p/en56fnp+en56fnp+eX55fnl+eX55fnl+eX55fnh+eH94f3h/eH94f3h/eH95f3l/eX95f3l/eX55fnp+en56fnp+e357fnt9e318fXx9fH19fH18fXx+e357f3t/e396f3qAeoB6gHuAfIB/gn+Ffod8hnyGfYl8inmIeYZ6hHqEeIV3hHaEdoV2hXaFdoV2hnWFdYV2hXaFd4V3hXiFeIV4g3mEe4V6hnmFeYR4gnaAd4B5gnuDfIV8g36BfoR6iHuIfYh8iXqKeIp3ineJd4l3iHiIeYd6h3uGfIZ9hn6FfoV/hICEgIOAgoGBgX6CdYVnj1+cX6Fgo2OkZqVppWykb6Ryo3WieKF8n4GdhpqLl4+VkZOSkZOPlYyXiZqFnX+feKRupmSiX5tfkmKNZYtpiW2IdoZ8iHiGc4Ntg2uDaoNpgmqCaoFrgGyAbX9uf29+cH5xfnJ+c35zfnR+dH51fnV+dn52fnZ+d353fnh9eH14fXl8eXx5fHp7ent7ent5e3h7eHt4e3l8eXx6fHp8e3x7fHt8e317fXt9e357fnt+e357fnt+e398f3x/fH99f35/fn9+f3+Af4B+gH6AfoF+gX2CfYN9g3yFeoZ4hnqCgH2DeIF4f3t/fX5/fn9+gH2AfYB9gX2BfYF9gn2CfYJ9gn2DfYN9g32DfYR9hH6FfoV+hX6FfoZ+h32IfIl7iXyJfYd9hnyFfoR/hICEgoKBgYB/gH9/f32AfYB9gHyBfIB9f31+fX1+fH59fn9/gICBgIKBg4GDgYSBhYGFgYWBhoGGgYaBhoGGgYaBhoGGgIaAhoCGgIaAhn+Gf4Z/hn6GfoV/hH+Ff4V/hX+Ff4V/hH+EfoR+g36DfoN+g36DfoJ+gn2CfYJ9gn2CfYF8gXyBfIF8gXyBfIF8gXyAfIB8gHuAe4B7gHuAe4B7f3t/e397f3t/fIB8gHyAfIB8gHx/fH98f3x/e397f3t/e397f3t/e397f3uAe4B7gHuAe4B7gHuAe4B7gHyAfIB8f3x/fH98f31/fX99f31+fn5+fn5+fn5/fX99f31/fYB8gHyAfIB7gXuBe4F6gXqBeoJ6gnqCeoJ6g3qDeoN6g3qCeoF7gHyAfIR8hnyIeYp4h3aGdoV2hXWHdIdzhXOEdIR1g3aCd4F4g3aEdYN3gnmEeoV5gXp+foF+hH2EfoOAhIGCgH6BeoF8gId+i3mGdYZxiHCHcYZyhnOFdYV3hHmCeoJ7gXyAfH99f35+f36BfoJ9g3yFeIVxhWWKXJJamFucXp5ioGWiaKJso2+jc6J2oXqhf5+EnYqaj5eSlJSRlo6XjZiMmoycip2Hn4SggKN6pXWobqppq2WnZaJom3KPfYd/iXyIdoRwhW2Ga4ZshWyEbINsg22CbYFtgW6Ab4BwgHF/cn9yf3N/c350fnV+dX52fnZ+dn53fnh9eH15fHl7eXt6enp5enh7d3t2e3Z7dnt2e3d8d3x3e3h7eHt5e3l7ent6fHp8enx6fHp9en16fXp9en17fnt+e358fnx+fX59fn1+fX59f31/fX99gH2AfYF9gn2DfoN9hHyGfIZ+hIGAgnyBeIB4f3t+fH59fn9+gH6AfoF9gX2CfYJ9gn2CfYN9g32DfYN9hH2EfYR9hX6FfoZ+hn+Hf4mAioCLgIyAi4GKgoiFhoWEhIWDhYSFg4aBh36HfoZ+hH2CfYF8gHx/fX5+foN9hnyGfIN+gYGBgoCDgIOAhICEgIWAhYCFgIWAhoCGgIaAhoCGgIaAhn+Hf4d/h3+Hf4h+iH2IfoaBhYGEgIV/hn+Ff4V/hn+Ff4V/hX+Ef4R/hH+Ef4R+g36DfoN+g36DfoN9gn2CfYJ9gn2CfYJ9gn2CfYF9gX2BfYF9gX2BfYF8gXyAfIB8gHyAfoF+gX6BfoF+gX6BfoF+gH6AfoB+gH2AfYB9gH2AfYB9gH2AfYB9gH6AfoB+gH6AfoB+gH6AfoB/gH+Af4B/f39/gH+Af4B/gH+AfoF+gX6BfoF9gn2CfYJ9gnyCfIJ8g3uDe4N7g3qDeoN6hHqEeoR6hHqDe4N8hXuGe4V7hXyHfYl9inyKeop4iHiIeIl3iXeIdod2hnaFeIV5hXqFe4Z6h3mHd4N3gXmCeYF5f3uAfIN8hHqCdoB4fXx/fYJ8gnyCfIF5gXaGdYh0hHGCboFugHB/c394fXx6f3Z/cX1we297bXttfG56a3hmemJ8XoFciFyQXZdfm2KeZqBpoW2icKJzo3eie6J/oYSfiZ2OmpKXlZSXkZmPm42dip+IoYahhqKGo4WlhaeDqYCue7F0r3Ghdph8lYCPgYuAi3yMdotxi2+Jbohvh2+Fb4Rvg2+Db4Jvgm+Bb4FvgW+AcIBxgHF/cn9zf3N/dH91f3V/dn53fnh9eH15fHp7e3l8eHx2fHR7cnp0eHV4dnl2enZ7dnt2e3Z6d3p3enh6eHp5enl6eXt5e3l7eXt5e3l7enx6fHp8enx7fHt8e317fXx9fH18fXt+fH58fnx+fX99f31/fYB+gH6Af4B/gYCDgISBhYOFg4WBhIGDgYCDfoR/gYJ/gn6DfoJ+g32DfYN9g32DfYN9hH2EfYR+hH6FfoV+hX+Ff4V/hYCGgIaBhoGGgYeBh4OGg4aCh4KHgoeBiICJf4iAh4GHg4eGh4aHhYeHh4mFiIOFgoKCgYOBg4CDgISAhICEf4V/hX+Ff4V/hn+Gf4Z/hn+Gf4Z/h3+Hf4d/h3+HgIeAiICIgIiAiICHgIeAh4CHgIeAhoCGf4Z/hn+Gf4V/hX+Ff4V/hX+Ef4R/hH+Ef4R/hH6DfoN+g36DfoN+g36DfoN+gn6CfoJ+gn6CfoJ+gn6BfoF+gX6Bf4J/gn+Cf4J/gn+Cf4J/gX+Bf4F/gX+Bf4F/gX+BgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYGAgYCBgIGAgYCBgIKAgn+Cf4J/gn+DfoN+g36DfoN9g32EfYR9hHyEfIR8hHuFe4V7hXqFeoV6hXqFeYV5hXmGeYZ5hnmGeYd5h3iHeIZ3hneGd4Z3h3eGd4Z2hnaGdoZ2hXaFd4V3hXiEeIR4hHiEeYN7hHyFfIV7hHuDe4N9g36AgHyCfYN+gn+Af4CAgXx/fn2He4t5h3SAcHxpe2V9an11fH17gHqAeH55fHd/aolelVuaXZtgmmOZZphomWubbJ1un3Ghc6J2o3mkfKR/o4KjhaKIoIydkJqUl5eTmpCcjZ6LoImhhqOEpIOmgad/qH6qfat9rX2we7J5s3Wvc6lwoWyVbYp3inuMeI10inKIcYZyhXKEcoNygnGCcYFxgXCBcIFwgW+Bb4BwgHCAcYBygHJ/c390f3R/dX92fnd9eH15fHp7e3l8eH13fXZ+d358fX55e3d4eXd7d3t5enp5enh5eXl5eXp5enl6eXp5enl6eXp5e3l7ent6e3p7ent6fHp8e3x7fHt8e3x7fHt9e317fXt9e317fXx9fH18fXx9fH18fXx9fH18fnx+fH98gHyBfIN9g36EfYR9hH2EfYR9hH2EfYR9hH2EfYR9hH2EfYR9hH2EfYR+hH6FfoV+hX6FfoV+hX6FfoV+hX6FfoV+hX6FfoV/hn+Hf4eBhoOEhIODgoOCgoOBg4GEgYSBhIGEgISAhICEf4V/hX+Ff4V/hX+Gf4Z/hn+Gf4Z/hn+Hf4d/h3+Hf4d/h3+Hf4d/h3+Hf4d/h4CHgIeAh4CHgIeAh4CHgIeAhoCGgIaAhoCGgIaAhoCFgIWAhYCFgIWAhYCFgISAhICEgISAhICEgISAg4CDgIOAg4CDgIN/g4CDf4KAgoCCgYOBg4GDgYOBg4GCgYKBgoGCgYKBgoGCgYKBgoGCgYKCgoKBgoGCgYKBgoGCgYKBgoGDgYOBg4GDgIOAg4CDgISAhH+Ef4R/hH+Ef4R+hX6FfoV+hX2FfYV9hXyFfIZ8hnyGe4Z7hnuGeoZ6hnqGeYZ5hnmGeIZ4hniGeIZ3hneGd4Z3hneFd4V3hXeFdoV2hHaEdoR2g3aCd4J3g3eEdoV1g3aDd4N4hHmEeoJ8fn19fH57gHuAfH99fH98gICAhH9/gHWBd39/fIV5hHqFeYNyf2t6a3V0c3t4gHqEdod0jHORcplzoXameKl6qnurfKt8q32rfqp/qYCpgaiDqISnhaaHpIijiqGNn4+dk5qWlpqSnY6fiqCHooSjgaR+pnyneqh4qXaqc6xxrW+sbaptpm6kbqVrpGmfa5ZwjXOIdYZ1hXWEdYJ1gXSBc4BzgHKAcn9xf3F/cH9wgG+Ab4BvgG+Ab4BvgHCAcX9yf3N/dH51fnZ9d3x4e3p5fHd9d316fHx8e357f399gnp/eXx7fHx+e357fHt7e3t7ent6enp6enp6enp6ent6e3p7e3t7e3t7enx6fHp8enx6fHp8enx6fHp8enx6fHp8enx6fHp8enx6fHl8eXx5fHl9eX15fXl+eX55f3l/eYB6gHqBeoF6gnuCe4J7g3uDe4N8g3yDfIN8g3yEfIR8hHyEfYR9hH2EfYV9hXyFfIV8hXyFe4V7hXuEeoR6g3uCe4J6gnmAfX6AfoN/hICCgYKCgYOBhICEgISAhX+Ff4V/hX+Ff4Z/hn6GfoZ+hn6GfoZ+hn6Hfod+h3+Hf4d/h3+Hf4d/h3+Hf4d/h3+Hf4d/h3+Hf4eAh4CHgIeAh4CHgIeAh4CHgIeAh4CHgIaAhoCGgIaAhoCGgYaBhoGGgYaBhYGFgYWBhYGFgYWBhIGEgYSBhIGEgYSBhIGDgYOBg4GDgoSChIKEgoOCg4KDgoODg4ODg4ODg4ODg4KDgoOCg4KDgoOCg4KEgoSChIGEgYSBhIGEgYSBhYGFgIWAhYCFgIWAhYCFf4V/hn+Gf4Z+hn6GfoZ+hn2GfYZ9hnyGfIZ8hnyGe4d7h3uHeod6h3qGeYZ5hnmGeIZ4hniGeIZ3hneFd4V3hXaFdoV2hHaEdoR2hHaDdoN2g3eDd4N3hHaDdoJ2gnaBdoB4f3t9fnx/e358fn1+gn+FfoV+gn9/gH2BfoGAgHyBeYN7goB/gn2DfIN8hHqCe4F6f3l9eXx6fXt/fH+AfIp5lnmeeaR6p3upfqqBqoOrhauErISrg6qDqYSohaeHpoqljKOOoZGflJyXmZqVnZCgjKGIo4SkgaR9pXqmdqZzp3CnbadqpmimZqNln2WcZ5xrmnCSc4p3iXiKd4h2g3aBd4B2f3V/c39yf3F/cH9vf29/b39vf25/bn9uf25/bn9uf25/b39vfnB+cX1yfXN8dHx2e3h5e3l+e4B/gIGAfoF+goGCg4F/fn19fHx7e3t6fXmAeH94fXp8enx6fHp8enx6fHt7e3t7e3t7e3t8e3x7fHp8enx6fHp9eX15fXl9eX15fHl8eXx5fHl8eXx4fHh8eHx4fHl8eX15fXl9eX55fnl+eX95f3mAeoB6gHqBeoF6gnqCeoJ6gnuDe4N7g3uDe4N7hHyEfIR8hHyEe4V7hXuFeoV6hXqGd4Z2hXmDe4J5gH6AhX+GgIGDgIWBhYGEgIR/hH6EfoV+hX6FfoV+hX6FfoZ+hn6GfoZ+hn6GfoZ+h36Hfod+h36Hfod+h36Hf4d/h3+Hf4d/h3+Hf4d/h3+If4h/iH+IgIiAiICIgIiAiICIgIiAiICHgYeBh4GHgYeBh4GHgYeBh4GHgYeBh4GGgYaChoKGgoaChoKGgoWChYKFgoWChYKFgoWChIKEgoSChIKEg4WDhISEhISEhISEhISEhISDhIOEg4SDhIOEg4SDhYOFgoWChYKFgoWChYKFgoWBhYGGgYaBhoGGgYaAhoCGgIaAhoCGf4Z/hn+Hf4d+h36Hfod+h32HfYd9h32HfId8h3yHe4d7h3uHe4d6h3qGeoZ5hnmGeYZ5hniGeIV4hXiFd4V3hXeEd4R3hHeDdoN2g3aCdoJ2gXaBdoB2f3d/d354fnh/eH97fX94gnmEfoWGhYaBgX1+enx7fH59gH+BgYKAgX2Be4F5gXmCeoN7hHyDgICFfYZ9hn2EfIJ6fnh3eXR5dHl4eXt8fX9/g36IeI1zlHCacp92onulgKiFqYqqjauQrI+rjqqOqJCmkqOUoJecm5efkqONpommh6eFp4OngqaApn2meqd2qHOmcaJxmnSReYR9e397fn9+gn2CfYZ8inqJeIZ3g3aDdIJygnCBboJtgW2BbYFtgW2BboFugG6Abn9uf25/b35vfm99cH1xfHF7cntze3V6dnp3enh6eXp6enx6fnqAeoF8gH6AgH9/gH+AgICCf4F9f3x+fH18fXx8fHx8fHx8fHt8e3x7fHt8e3x6fXp9en15fXl9eX15fXp9en17fXt9e316fXp9en16fXp9e317fHt9e3x7fHt8enx6fXp9en56fnp/en96gHqAeoB6gXqBeoF6gnqCeoJ6gnuDe4N7g3uDe4R7hHuEe4V7hXuGe4d7h3eHdYZ4g4CChoGFg4ODgIR+hH2EfYR9hH2EfYR9hX2FfYV9hX2FfYV9hn2GfYZ9hn2GfYZ9hn2GfYd+h36Hfod+h36Hfod+h36Hfod/h3+Hf4d/iH+If4h/iH+If4iAiICIgIiAiICIgIiAiICIgIiBiIGIgYiBiIGIgYiBiIGHgYeCh4KHgoeCh4KHgoeCh4KHgoeChoKGg4aDhoOGg4aDhoOFg4WDhYOFg4WDhYOFhIWEhYWFhYWFhIWEhYSFhIWEhYSFhIWDhYOFg4aDhoOGg4aDhoKGgoaChoKGgoaBhoGGgYaBh4GHgYeAh4CHgIeAh4CHf4d/h3+Hf4d+h36Hfod+h32HfYd9h32HfYd8h3yHfId7h3uHe4d7hnqGeoZ6hnqGeoZ5hXmFeYV5hXiFeIR4hHiEeIN4g3iDeIJ4gniBeIF4gXiAeIB4f3l/eX55fnp9en16fXt8fXx9fn5+fnt/eIB4gHqAe396f3iAd4B5gH1/gX+EfYN7f3p7e3t9f4CEg4aFhYWBhX+EgYOCgYJ/gH6AfoB9f358gHmDeIZ6iX6LgYyCjYOOg4+HjomOh4+FkIKThZWJl4Wbgp2AoIefkZ6cmqSVqZCrjKmIpoaihZ6GmImTi5KKlIWSg42Ch4SFhYWFhoSHhYiGiIaJhYiFioKKgYx9jnmPdo9zjXGMcIpviW+Ib4ZvhXCEcINwgnCCcYFxgHGAcX9xf3J+cn5yfXJ9c3xzfHR7dHt1e3Z7dnp3enh6eHp5enl6enp6enp6enp7ent6e3p8enx7fHt8e3x7fHt8e3x7fHp8enx6fHp8en16fXp9en16fXp9en16fnp+en56f3p/en96f3p/en96gHt/fH98f3t/e397f3x/fH98f3x/e397f3t/e397gHqAeoB6gXqBeoF6gXqCeoJ6gnqCeoJ6g3uDe4N7hHuEe4R7hXuFe4Z8hnyGfYZ9hn2GfYV9hH2EfYR9hHyEfIR8hHyFfIV8hXyFfIV8hXyFfIZ9hn2GfYZ9hn2GfYZ9hn2GfYd9h32Hfod+h36Hfod+h36Hfod+h3+Hf4h/iH+If4h/iH+If4h/iICIgIiAiICIgIiAiICIgYiBiIGIgYiBiIGIgYiBiIKIgoiCiIKIgoeCh4KHg4eDh4OHg4eDh4OHg4eDh4OGhIaEhoSGhIaEhoSGhIWEhYSFhYWFhYWFhYWFhYaFhoSGhIaEhoSGhIaEhoSGg4aDhoOGg4eDh4OHgoeCh4KHgoeCh4GHgYeBh4GHgYeAh4CHgIeAh4CHf4d/h3+Hf4d/h36Hfod+h36HfYd9h32HfYd9h3yHfId8h3yGfIZ7hnuGe4Z7hnuGeoV6hXqFeoV6hXqEeYR5hHmDeYN5g3mDeYJ5gnmBeYF5gXqAeoB6gHp/en97f3t+e357fnx9fH18fHx8fXx+e397gHuBe4J8g32EfoR+hH2Ee4R6hXqGfId+h4CHgIeAhoKFg4OEgoSBgoCBgIKAg4CFgIZ/hX+Ef4OAgoKBhIKGhIWFhYWFg4aAh3+IgIeBh4KHgoZ+hXqFeoV9h4CIg4qBiYCIgYWEgoeAh3+Ff4R/hH6FfYV9hn2Ifot+j36QfY58jXyMfI17jHqLeol4iXiJd4l2iXaJdol3iHaIdod2h3aGdYZ1hXWEdYR0g3SCdIJ0gXSAdIB0f3R/dX51fnV+dX11fXV8dnx2fHZ8dnt3e3d7eHt4e3h7eHp5enl6eXp5enp6enp6enp6e3p7ent6e3p7ent6fHp8enx6fHp8enx6fHp8en16fXp9en16fXp9en16fnp+en56fnp+en96f3p/en96f3p/en96f3p/en96f3qAeoB6gHqAeoB6gHqAeoB6gHqBeoF6gXqBeoF6gXqCeoJ6gnqCeoN6g3qDeoN7g3uEe4R7hHuEe4R7hHyEfIR8hHyEfIR8hHyEfIR8hHyFfIV8hXyFfIV8hXyFfIZ8hnyGfIZ8hn2GfYZ9hn2HfYd9h32HfYd9h36Hfod+h36Hfod+iH6If4h/iH+If4h/iH+If4iAiICIgIiAiICIgIiAiIGIgYiBiIGIgYiBiIGIgoiCiIKIgoiCiIKIg4iDiIOIg4eDh4OHg4eDh4SHhIeEh4SHhIeEhoSGhIaFhoWGhYaFhoWGhoaGhYaFhoWGhYaFhoWGhYaEhoSGhIeEh4SHhIeDh4OHg4eDh4OHgoeCh4KHgoeCh4GHgYeBh4GHgYeAh4CHgIeAh4CHf4d/h3+Hf4d/h3+Hfod+h36Hfod+h32HfYd9h32HfYd9hnyGfIZ8hnyGfIZ8hnuFe4V7hXuFe4V7hHuEe4R7hHuDe4N7g3uDe4N7gnuCe4J7gnuBe4F8gXyBfIF8gHyAfIB9gH2AfYB9gH6Afn9+f35/fn9+f35/fn9+f39/fn9/gH+Af4CAgICBgIGAgoCCgYKBgoKDgoSBhYCFfoR9hHyEfIR8hHyEfYR+hH+EgISBhIGEgYSChIOEhISEhYWFhoWGhYeEiISIhYmGiYeKhomCiYGJgIeChoSGhoSHg4iDiISIg4mFiYSLg42CjYCOfo19i3uKeol5iXiJd4p3iXaJdoh2h3aHdoZ2hnaFd4V3hXeEd4R3g3eDd4N3gneCd4F3gXeAd4B3gHd/d393f3d+d353fXd9d314fXh8eHx4fHh8eHx5e3l7eXt5e3l7eXt6e3p7enp6enp6enp7ent6e3p7ent6e3p7enx6fHp8enx6fHp8enx6fHp9en16fXp9en15fXl9eX55fnl+eX55fnl+eX55f3l/eX95f3l/eX95gHmAeYB5gHmAeYB5gHmAeYF5gXmBeYF5gXmBeoF6gnqCeoJ6gnqCeoJ6g3qDeoN6g3qDeoN6g3qEe4R7hHuEe4R7hHuEe4R7hHuEe4V7hXuFfIV8hXyFfIV8hXyGfIZ8hnyGfIZ8hnyGfYZ9h32HfYd9h32HfYd9h36Hfod+h36Hfoh+iH6If4h/iH+If4h/iH+If4iAiICIgIiAiICIgIiBiIGIgYiBiIGIgYiBiIKIgoiCiIKIgoiCiIOIg4iDiIOIg4eDh4SHhIeEh4SHhIeEh4SHhYeFh4WGhYaFhoWGhYaFhoWGhoaGhYaFhoWGhYaFhoWGhYaEhoSHhIeEh4SHhIeDh4OHg4eDh4OHg4eCh4KHgoeCh4KHgYeBh4GHgYeBh4CHgIeAh4CHgIeAh3+Hf4d/h3+Hf4d/h36Hfod+h36Hfod+h32GfYZ9hn2GfYZ9hn2GfIZ8hXyFfIV8hXyFfIV8hXyEfIR8hHyEfIR8hHyDfIN8g3yDfIN8g3yCfIJ8gn2CfYJ9gn2CfYJ9gn2CfYJ+gn6CfoJ+gn6CfoJ+gn6Cf4J/gn+Df4N/g3+Df4N/g3+Ef4R/hH+EfoR+hH6EfoR+hX6FfoV+hH2EfYR9hH2EfoR+hH6EfoN+g3+Df4N/g4CEgISBhIGEgYSBhYKFgoWChYKGgoaChoKHgoeCiIGIgYiAiICIgImAiX+Jf4l/iX6Jfol+iX6JfYl9iXyJfIl8iHuIe4h6h3qHeoZ5hnmFeYV5hXmEeYR5g3mDeYN4gniCeIJ4gXiBeIF4gHiAeIB4f3h/eH94f3h+eH55fnl+eX15fXl9eX15fHl8eXx5fHp8enx6e3p7ent6e3p7ent7e3t7e3p7ent6e3p7ent6e3p8enx6fHp8enx6fHp8enx6fXp9en16fXl9eX15fXl9eX55fnl+eX55fnl+eX55f3l/eX95f3l/eX95gHmAeYB5gHmAeYB5gHmBeYF5gXmBeYF5gXmBeYF5gnmCeYJ6gnqCeoJ6gnqDeoN6g3qDeoN6g3qDeoN6hHqEeoR7hHuEe4R7hHuEe4V7hXuFe4V7hXuFe4V8hXyGfIZ8hnyGfIZ8hnyGfIZ9hn2HfYd9h32HfYd9h36Hfod+h36Hfod+h36Hf4h/iH+If4h/iH+IgIiAiICIgIiAiICIgYiBiIGIgYiBiIGIgYiCiIKIgoiCiIKIgoiDiIOIg4iDiIOHg4eEh4SHhIeEh4SHhIeEh4WHhYeFh4WGhYaFhoWGhYaGhoaGhYaGhYaFhoWGhYaFhoWGhYaFhoSGhIaEhoSHhIeEh4OHg4eDh4OHg4eDh4KHgoeCh4KHgoeBh4GHgYeBh4GHgYeAh4CHgIeAh4CHgId/h3+Hf4d/h3+Hf4d/h36GfoZ+hn6GfoZ+hn6GfYZ9hn2GfYZ9hX2FfYV9hX2FfYV9hX2FfIV8hHyEfIR8hHyEfIR8hHyEfIR9g3yDfIN8g32DfYN9g32DfYN9g32DfYN9g32DfYN9g32DfYN9g32DfYN9g32DfYN9g32DfYN9g32DfYN9g32DfYN9g32DfYN9g32DfYN9g32DfYN9g32DfYN9g32CfYJ9gn6CfoJ+gn6CfoJ+gn6DfoN/g3+Df4N/g3+Df4N/g3+Df4R/hH+Ef4R/hH+Ef4R+hH6EfoR+hH6EfoR+hH2EfYR9hH2EfIR8hHyEfIR8hHuDe4N7g3uDe4N7gnuCeoJ6gnqCeoF6gXqBeoF6gHqAeoB6gHp/en96f3p/en96fnp+en56fnp+en56fXp9en16fXp9enx6fHp8enx6fHt8e3x7e3t7e3t7e3t7e3t7e3t7fHt8e3x6fHp8enx6fHp8enx6fHp9en16fXp9en16fXp9en16fnl+eX55fnl+eX55fnl+eX95f3l/eX95f3l/eX95gHmAeYB5gHmAeYB5gHmBeYF5gXmBeYF5gXmBeYJ5gnmCeYJ6gnqCeoJ6gnqDeoN6g3qDeoN6g3qDeoN6hHqEeoR6hHqEe4R7hHuEe4V7hXuFe4V7hXuFe4V7hXyFfIZ8hnyGfIZ8hnyGfIZ8hn2GfYZ9h32HfYd9h32Hfod+h36Hfod+h36Hf4d/h3+Hf4d/h3+Hf4eAh4CHgIiAiICIgIiBiIGIgYiBiIGIgYiCiIKIgoeCh4KHgoeCh4OHg4eDh4OHg4eDh4SHhIeEh4SHhIeEh4SHhIaFhoWGhYaFhoWGhYaFhoWGhYWFhYWFhYWFhYWFhoWGhYaEhoSGhIaEhoSGhIaEhoOGg4aDhoOGg4aDh4KHgoeCh4KHgoeCh4KHgYeBh4GHgYeBh4GHgYeAh4CHgIeAh4CHgIZ/hn+Gf4Z/hn+Gf4Z/hn+GfoZ+hn6GfoZ+hn6GfoZ+hX6FfYV9hX2FfYV9hX2FfYV9hX2FfYV9hH2EfYR9hH2EfYR9hH2EfYR9hH2EfYR9hH2DfYN9g32DfYN9g3yDfIN8g3yDfIN8g3yDfIN8g3yDfIN8g3yDfIN8g3yDfIJ8gnyCfIJ8gnyCfIJ8gnyCfIJ8gnyCfIJ8gnyCfIJ8gn2CfYJ9gn2CfYF9gX2BfYF9gX2BfYF9gX2BfYF9gX2CfYJ9gn2CfYJ9gn2CfYJ9gn2CfYJ9gn2CfYJ9gn2CfYJ8gnyBfIF8gXyBfIF8gXyBfIF8gXyBe4F7gXuBe4F7gHuAe4B7gHuAe4B7gHuAe397f3t/e397f3t/e397fnt+e357fnt+e357fnt9e317fXt9e317fXt9e3x7fHt8e3x7fHt8e3x7fHx7fHt8e3x7fHt8e3x7fHt8e3x7fHt8e316fXp9en16fXp9en16fXp9en16fnp+en56fnp+en56fnl+eX55f3l/eX95f3l/eX95f3l/eYB5gHmAeYB5gHmAeYB5gXmBeYF5gXmBeYF5gXmBeYJ5gnmCeYJ6gnqCeoJ6gnqDeoN6g3qDeoN6g3qDeoN6hHqEeoR6hHqEeoR7hHuEe4R7hXuFe4V7hXuFe4V7hXuFfIV8hnyGfIZ8hnyGfIZ8hn2GfYZ9hn2GfYZ9hn2GfYZ+h36Hfod+h36Hfod+h3+Hf4d/h3+Hf4d/h4CHgIeAh4CHgIeAh4CHgYeBh4GHgYeBh4GHgYeCh4KHgoeCh4KHgoeCh4OHg4eDh4OHg4eDhoOGhIaEhoSGhIaEhoSGhIaEhoWGhYaFhoWFhIWFhYWFhYWFhYWFhYSFhIWEhYSFhIWEhYSGhIaDhoOGg4aDhoOGg4aDhoOGgoaChoKGgoaChoKGgoaBhoGGgYaBhoGGgYaBhoGGgIaAhoCGgIaAhoCGgIaAhoCGf4Z/hn+Gf4Z/hn+Gf4Z/hn6GfoV+hX6FfoV+hX6FfoV+hX6FfoV+hX2FfYV9hX2FfYV9hH2EfYR9hH2EfYR9hH2EfYR9hH2EfYR8hHyEfIN8g3yDfIN8g3yDfIN8g3yDfIN8g3yDfIN8g3yDfIJ8gnyCfIJ8gnyCfIJ8gnyCfIJ8gnyCfIJ8gnyCfIJ8gnyCfIF8gXyBfIF8gXyBfIF8gXyBfIF8gXyBfIF8gXyBfIF8gXyBfIF8gXyBfIF8gXyBfIB8gHyAfIB8gHyAfIB8gHyAe4B7gHuAe4B7gHuAe4B7gHuAe4B7f3t/e397f3t/e397f3t/e397f3t/e397fnt+e357fnt+e357fnt+e357fnt9e317fXt9e317fXt9e317fXt9e3x7fHx8fHx8fHx8fHx8fHx8fHx8fHx7fHt8e3x7fHt8e317fXt9e317fXt9e317fXp9en16fXp+en56fnp+en56fnp+en56fnp+en56f3p/en96f3p/en96f3l/eX95gHmAeYB5gHmAeYB5gHmAeYF5gXmBeYF5gXmBeYF6gXqCeoJ6gnqCeoJ6gnqCeoJ6g3qDeoN6g3qDeoN6g3qDeoN6hHqEeoR7hHuEe4R7hHuEe4R7hHuFe4V7hXuFe4V8hXyFfIV8hXyFfIV8hXyGfIZ9hn2GfYZ9hn2GfYZ9hn2GfoZ+hn6GfoZ+hn6GfoZ+hn+Hf4d/h3+Hf4d/h3+HgIeAh4CHgIeAh4CHgIeAh4GHgYeBh4GHgYeBh4GHgoaChoKGgoaChoKGgoaDhoOGg4aDhoOGg4aDhoOGg4aEhoSGhIaEhYSFhIWEhYSFhIWEhYSFhIWEhISEhISFhIWEhYSFhIWEhYSFhIWDhYOFg4WDhYOFg4WDhYOFg4WChYKGgoaChoKGgoaChoKGgoaBhoGGgYaBhoGGgYaBhoGGgYaAhoCGgIaAhoCGgIaAhoCGf4Z/hn+Gf4Z/hn+Gf4V/hX+Ff4V/hX+FfoV+hX6FfoV+hX6FfoV+hX6FfoV9hX2FfYV9hX2EfYR9hH2EfYR9hH2EfYR9hH2EfYR9hHyEfIR8hHyEfIN8g3yDfIN8g3yDfIN8g3yDfIN8g3yDfIN8g3yDfIJ8gnyCfIJ7gnuCe4J7gnuCe4J7gnuCe4J7gnuCe4F7gXuBe4F7gXuBe4F7gXuBe4F7gXuBe4F7gXuAe4B7gHuAe4B7gHuAe4B7gHuAe4B7gHuAe4B7gHt/e397f3t/e397f3t/e397f3t/e397f3t/e357fnt+e357fnt+e357fnt+e357fnt+e317fXt9e317fXt9e317fXt9e318fXx9fH18fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8e3x7fHt8e317fXt9e317fXt9e317fXt9e317fXt9en56fnp+en56fnp+en56fnp+en56f3p/en96f3p/en96f3p/en96f3qAeoB6gHqAeoB6gHqAeoB6gHqAeoF6gXqBeoF6gXqBeoF6gXqCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoN6g3qDeoN6g3qDe4N7g3uDe4R7hHuEe4R7hHuEe4R7hHuEe4R7hHyEfIV8hXyFfIV8hXyFfIV8hXyFfIV9hX2FfYV9hX2GfYZ9hn2GfYZ+hn6GfoZ+hn6GfoZ+hn6GfoZ/hn+Gf4Z/hn+Gf4Z/hn+GgIaAhoCGgIaAhoCGgIaAhoCGgYaBhoGGgYaBhoGGgYaChoKGgoaChoKGgoaChoKGgoaDhoOGg4aDhoOFg4WDhYOFg4WEhYSFhIWEhYSFhIWEhYSEhISEhISEhISEhISEhISEhISEhISFhIWDhYOFg4WDhYOFg4WDhYOFg4WDhYOFg4WChYKFgoWChYKFgoWChYKFgoWBhYGFgYWBhYGGgYaBhoGGgYaBhoCGgIaAhoCGgIaAhoCGgIaAhoCGf4Z/hn+Gf4Z/hn+Ff4V/hX+Ff4V/hX+FfoV+hX6FfoV+hX6FfoV+hX6FfoV9hX2FfYV9hX2FfYV9hX2EfYR9hH2EfYR9hHyEfIR8hHyEfIR8hHyEfIR8hHyDfIN8g3yDfIN8g3yDfIN7g3uDe4N7g3uDe4J7gnuCe4J7gnuCe4J7gnuCe4J7gnuCe4J7gXuBe4F7gXuBe4F7gXuBe4F7gXuBe4B7gHuAe4B6gHqAeoB6gHuAe4B7gHt/e397f3t/e397f3t/e397f3t/e397fnt+e357fnt+e357fnt+e357fnt+e317fXt9e317fXt9e317fXt9e317fXt9fH18fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHt8e317fXt9e317fXt9e317fXt9e317fXt9e357fnt+e357fnt+e356fnp+en56fnp+en96f3p/en96f3p/en96f3p/eoB6gHqAeoB6gHqAeoB6gHqAeoB6gXqBeoF6gXqBeoF6gXqBeoF6gXqCeoJ6gnqCeoJ6gnqCeoJ7gnuCe4N7g3uDe4N7g3uDe4N7g3uDe4N7g3uEe4R7hHuEe4R8hHyEfIR8hHyEfIR8hHyEfIR8hXyFfIV8hX2FfYV9hX2FfYV9hX2FfYV9hX2FfYV+hX6FfoV+hn6GfoZ+hn6GfoZ+hn+Gf4Z/hn+Gf4Z/hn+Gf4Z/hn+GgIaAhoCGgIaAhoCGgIaAhoGGgYaBhoGGgYaBhoGGgYaBhoGGgoaChoKGgoaChoKFgoWChYKFgoWDhYOFg4WDhYOFg4WDhYOFg4WDhYOF');

      // Clear synthetic wind belt field
      WU.fill(0); WV.fill(0); WCls.fill(-1);
      for(let c=4;c<7;c++) spawnByClass[c].length=0;

      for(let y=0;y<GH;y++){
        const la=-90+(y+0.5)*CELL;
        const gy=la+90;
        const y0=Math.max(0,Math.min(GH2-2,Math.floor(gy)));
        const y1=y0+1, fy=gy-y0;
        for(let x=0;x<GW;x++){
          const lo=-180+(x+0.5)*CELL;
          const gx=((lo+180)%360+360)%360;
          const x0=Math.floor(gx)%GW2, x1=(x0+1)%GW2, fx=gx-Math.floor(gx);
          const i00=(y0*GW2+x0)*2, i01=(y0*GW2+x1)*2;
          const i10=(y1*GW2+x0)*2, i11=(y1*GW2+x1)*2;
          const u=((raw.charCodeAt(i00  )-HALF)*(1-fx)*(1-fy)+
                   (raw.charCodeAt(i01  )-HALF)*fx    *(1-fy)+
                   (raw.charCodeAt(i10  )-HALF)*(1-fx)*fy    +
                   (raw.charCodeAt(i11  )-HALF)*fx    *fy    )*SCALE;
          const v=((raw.charCodeAt(i00+1)-HALF)*(1-fx)*(1-fy)+
                   (raw.charCodeAt(i01+1)-HALF)*fx    *(1-fy)+
                   (raw.charCodeAt(i10+1)-HALF)*(1-fx)*fy    +
                   (raw.charCodeAt(i11+1)-HALF)*fx    *fy    )*SCALE;
          const k=y*GW+x;
          // Previously `if(Math.hypot(u,v)===0) continue;` here — cells
          // whose quantized wind rounds to exactly (0,0) (calm doldrums
          // pockets near the equator) never got WCls set or added to
          // spawnByClass, leaving permanent grid-aligned voids. They're
          // still classified by latitude below like any other cell.
          WU[k]=u; WV[k]=v;
          // Classify wind: trades(4)=equatorial+easterly, wester(5)=mid-lat+westerly, polar(6)=high-lat
          const absLat=Math.abs(la);
          let wc;
          if(absLat>60)       wc=6;  // polar
          else if(absLat>25)  wc=5;  // westerlies
          else                wc=4;  // trades / equatorial
          WCls[k]=wc;
          spawnByClass[wc].push([lo,la]);
        }
      }
      console.log('[ERA5 wind] loaded. Wind cells:',
        WU.reduce((n,v)=>n+(v!==0?1:0),0));
    })();








    // ════ REAL SURFACE VELOCITY FIELD (CMEMS) ════════════════
    // Replaces the synthetic stamped field with measured ocean velocities.
    // Source: CMEMS Global Ocean Physics, uo+vo, surface level, 1°x1° mean
    // (area-averaged from native 0.083° using actual lat/lon coordinate
    // binning — see extract_velocity.py; a prior version used naive
    // index-based reshaping that silently mis-registered the whole field
    // by ~10° since the source's native lat range is -80..90, not -90..90)
    // Encoding: uint8, -2.5…+2.5 m/s → 0…255 (128 = zero velocity)
    (function(){
      const VMAX=2.5, HALF=128, SCALE=VMAX/127.5;
      const GW2=360, GH2=180;
      const raw=atob('gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfId7iHqHeoh6iHuIeYZ5hnqHeoZ4hXmFeYR4hHiEeIV3hHiDd4F3gHeAdn92f3Z+dn52fXd7eHp6ent7enl9fICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH2CfoN+gX+Af4B/gH+Af4B/gH+BfoF+gH6BfoB+gX6AfoB9gH2AfYB+gX6BfX9+gH5/f39/gIGBgYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYCBgICAgYCCf4F/gH+Af4F/g3+GfoZ+hn6GfYZ9hnyGfYh9iH2IfYh8iHyIe4d7iHuIeoh6iHmIeYh4hniGeIV3hXaEdoN1gnWBdYB1f3V+dX12fHV6dXl1eHV2dnR0c3VzdXN1dXd5eHp4eXl6e3t5eoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAf4J/gn+Cf4J+gn6DfoJ+gX6BfoF+gX6BfoF+gX6BfYF9gH2BfYF9gH2AfoB+gH6AfoB+gH6AfoB+gH5/fX99fX5+f39/gH+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYGAgYKBgoGBgYCBgICBgIKAhoCHf4Z/hn+Gf4d+h32Hf4h/iH6Jfol+iX2JfYp8inyKfIp8inuJe4l6iHmHeId4hniFeIR4gniBeYB5f3p+en57fXt8e3t7enx5fHl8eHt2enZ5d3h3d3d3d3Z2dXVzdHR2dHdzeHJ4dHl1eXd5eHt5fHl9enx4e4CAgICAgICAgICAgICAgICAgICAgICAgICAgX+Cf4KAgICAgICAgICAf4CAgICAgYCBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgIJ/g3+DfoN/g3+DfoN+g36CfoJ9gn2CfYJ9gn2CfYJ8gXyBfIF8gXyAfIB8f32AfX99gHx/fH58f3x/fH98fnx+e318fnt+gICAgICBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAgYGBgYGBgYGBgYGDgYSBhYGGgIaAh4CHgIeAiH+If4h/iX+Jf4l/iX+Kfot+i36Mfox9i32LfYp8iXuJe4h7h3uFe4R8g3yBfYB9f35/fn5+fX99f3x/e397gHqAeoB6gXqBe4F7gXuBe4J8gnuBe4B7f3t+e317fHp7ent5enh7d3t4fXh9eX1+foB+gH6AfYB9gH1/fYB9f31+fX5+fn5+fn1+fX9+gH9/f4CAgICAgICAgICAgoGBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB/gXuFe4N9gH9/gYCBgICAgICAgICAgICBgICAgICAgICAgICAgICAgICAgICAgICAgICAgIKAg3+Ef4R+hH6EfoR+g32DfYN9g32DfYN8g3yDfIN8gnyCe4F7gXuBeoF6gHmAeYB5f3mAeYB4gHiAeIB4fnh+eH14fXd8eH15fXt9fH13eoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgYKAgoCBgIGDgYSAhYCFgIaAh4CHf4d/iH+If4iAiICJgImAiYCKgIyAjICNgI2AjYCMgIt/i3+Kfol+iH6HfoV/hH+Cf4F/gIB/gH+AfoF9gn2CfIJ7g3uDe4N7g3qEeoR7hHuEfIR8hXyFfIR8hH2EfoV+hH6EfoN+g32BfIB7f3t+fH5+fn9+f39/f4B/f39/f39/f39+fn5/fn9+fn1+fX59f31/fn9/f39/f39/f4CAgYKAgICAgICAgICAgICAgICCgYOBgoOCg4CDfIZ8hX6EfYR9hH6Ef4F+gH5/fn5/f39/f4F/gICAgICAgICBgICAgICAgICAgICAgICAgICAgICAgIF/f4J+hH6FfoV+hX2EfYR9hH2EfYR8hHyEfIR8hHyEe4N7g3uDe4N6g3qCeoN5gXiBeYF4gXd/d4B3gXeAdoB2gHV+dX51fnV9dXx1fHV7dHp0eHN3c3d2d3l6gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBgYOAhYCFgIV/hn+Hf4d/h3+IgYeBiIKIgomCioKLgoyCjIONg42DjYONhIyEjIOLg4qDiYOIg4eDhYOEg4KDgYOAg4CDfoN+hH2EfYV8hXyFfIZ7hnuGe4Z8hnyFfIV8hnyGfYZ+hX6FfoV+hX6Ff4V/hX6Ef4R/g3+DfoN+g36CfoJ+gn6Cf4J/gn+Cf4J/gn6CfoJ+gX2BfYF9gX2BfYF9gn+Cf4J/gn+Cf4OAg4CDgYOBhIGEgYOBgoGCgoGEgYSBhYGGgYaBhYCFgYOBg4GCgYKBgoGBgIF+gH6Af39/f4B/gICAgYCAgICAgICAgICAgICAgICAgICAgICAgH+CfoR+hX2FfYV9hX2FfYV9hXyFfIV8hHyFfIR8hHyEfIR7hHuEe4R7g3uDe4N7g3qCeYJ5gniCd4J2gnaBd4F3gHd/d353fXd9d3x3e3d7eHp4enh5dnd2dnV2dnd5eXp7d3iAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAf4N/gH+Df4R/g4CEgISAhYCFgYaBhoGGgoeCiIKJgoqCioKKg4uDioSLhYyGjYaMh4yHjIeLiIqIiYiJiIeIhoiFh4SHg4eCh4GHgId/h36IfYh9iHyIfIl8iXyJfYh9h32HfYd9h32GfYZ+hn+GfoZ+hn6FfoV/hYCEf4R/hH+Ef4R/hH+EfoR+hH+Df4N/g3+Df4N+g36EfoR+hH6DfYN9hH2DfYN9g3yEfoN/g3+Ef4N/hH+EgISBhICEgoSChIODhIODhIKEg4OHg4aDh4OHgoaChYKFgYWBhIGEgoSBgoCAf4B/gH+BgIGAgICAgICAgICAgICAgICAgICAgICAgIB/g36EfoV+hX6GfYV9hX2FfYV9hX2FfYV9hX2FfIV8hXyEfIR8hHyEfIR8hHyEfIR7hHuEeoR5hHmEeYN5g3mCeYF5gHl/en57fXx9fHx9fH18fHx8e3x7fHp7eXp5eHd3d3Z1dXV2dnZ5dnx4fXZ7d3t7fHx9fHx8fICAgICAgH+AgIF9gX6AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB6gXeEeoB7f3+BgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH+AgH+Bf4F+gn6Bf4J/gn+Bf4GAgYCCgIKAg4GEgYSBhYKGgYWCh4OJg4mEiYSJhYmGiYaJh4mIioiLiYuJi4qKioqKiYuJi4iLh4uGi4WMhIyEjIOMgYx/i3+Lfot+i32KfYp9iX2Jfol/iX6Jf4h/h36Hf4h/iH+Hf4d/hn+Gf4aAhYCFf4V/hX+Ff4R/hH6EfoR/hH+Ef4R/hX+EfoR+hX6FfoV+hX2FfYV9hH2EfIR8hHyEfIV/hH6Ef4R/g36DfoSBg4GDgYSChISFhYWEg4ODhISHhImDiYOJg4iDiIOIgoeChoKGgoaChoGGgYWAg3+Df4OAgYCCgICAgH2DfoF+fYCAgICAgICAgIB/gX+Ef4V+hn6FfoV+hn6GfoV+hX2FfYV9hX2FfYV9hX2FfYV9hX2EfYR9hH2EfYV8hXyFfIZ7hnuFe4R8g32BfoF/gH+Af39/fn9+gH2AfYF9gn2CfIJ9g32DfYN9g32CfIB7fnp8eXp7eHt4e3h6eHh5fHl9eXt4end8eoF5gXmAeoF7gXt+e357gHuBfIB9f35/f4B9gXmCe4N8hXqGeoV6hXmEeoV7hXqCeoB5fnl+en56fnp8fH+BgICAgIGAgICAf4GAgH+AgIGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYCAgH6BfYB8fn9/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICAf4F/gH+Bf4B+gX6Cf4F/gn+Bf4F/gH+Af4B/gX+Bf4GAgYCCgIKBg4GFgYOBhIKGg4eEh4WHhoeHiIiJiImIiomKiYqJioqJi4mLiYyJjYiNiI2HjoaOho6FjoSOg46CjYGNgI2AjH+Lf4p/iYCJgIh/h3+IgIiBiICHfoeAh4GGgYV/hn6GgIaAhoCGgIaAhYCFf4V/hX+EfoV+hX6FfoV+hn+Hf4Z+hn2HfId9h3+GfoZ9hn2GfYV8hXyFe4V8hX6EfoN+g4CCf4KAhIGDgYOChISEhISHhIeEiIKHg4mEioWKhYqEioOJhIaGjIOHg4eDh4OHg4aFhoSHg4aChIKFgYV+hH+CgX+BgYCAgICAgICAgICAgIGCf4Z/hn+GfoZ+hn6GfoZ+hn6FfoV+hX6FfoV+hX6FfoV+hX6EfoR+hX6Ff4Z/h3+Hf4eAh4CGgYSBg4GCgoGCgYOAhICEf4V+hX6GfYZ9hn2GfYZ+hn6GfYZ+hn6HfYd9h32GfoZ9hX2DfYF9f31+fX58fnt9e318fXx+fX59fn1+fn5/fn9/f39/f35/fX9/f4V+hH2EfYV8hn2GfYR9hHyEfYR9gn2BfoF9gH1/fX99f3t+eX55fnp/eX95gHuBeoJ3fHd8d3p3eXh6eXuAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF8hHeCeH95f3p+e3x6eXt3enh8e4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH+BfYR9hH6AgICAgICAgIB/gH+Bf4J/gX+Bf4F/gX+Bf4F/gX+Af4B/gH+Af4B/gYCBgIGAgYCBgIGAgoCCf4GAgoGCg4OEhISFhYaFh4aIh4mIiYiKiYqKioqJi4mLiYyJjImMiI2IjYeOh46GjoWOhI6DjYONgoyCi4KLgoqBioGJgYiBiIGHgYeBhoGGgYaBh4GHgIeBhoGFf4aAhoGGgYaBhoCGf4aAhn+Ff4V+hX2GfYZ9h32HfYd9h32HfYd+iH6IfYh+h36HfoZ9hXyGeoh6iHuJfomEiH+IeYl7iYKHioWGhIiCiIKGhYiGjYiMiIqIiYiBiYqLjI2FioOFkYOLhIeBgoCCfoN/h4CFgYiEiISKgoyAjH+Hf4KAgYCBgICAgICAgICAgICCf4Z/h3+Gf4Z/hn+Gf4Z/hn+Gf4Z/hn+Gf4V/hX+Ff4V/hYCFgIWAhoGGgYaCh4OHhIeGh4eGiISJg4qCioGKgYuAi4CLf4t/i36Lfot+i3+Kf4p/in+KgImAiX+Jf4l/iX6Jfol/iX+Jf4l+iH6HfoZ9g32BfYB8f3t/fH98f3x/fYB+gH6AfoB/f35/foCBgISAg4CEgIWAhYCFgIWAhYCFgIWAhICDf4J/gn+BfoB+gX6AfoB9gHx/e4B5gnh/eH13enZ4dXh0eHN4c3d1eXd7d3p4e4B/gIB/gICAgICAgICAgICAgICAgICBf36AeYB3gHd/dX53f3eAd4F2g3aDd4N6hnuDfIB8fnx8fXp8eHt2end6eXt6fXx+f4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYJ+gXuGe4R7g3uDeoR8g3+Af4B/gH+Bf4F/gX+Bf4B/gX+Bf4CAgX+Bf4F/gX+Bf4F/gX+BfoB/gH+Bf4F/gX+Bf4F/gX+BgX+CgYGAgYGCgIKCgoWDhoSGhYeFiIaIiImJiYmJiomLiYuJi4mLiYyIjIiMh42HjIaNhYyEjISMhIuEi4SLg4qDiYOJg4iCiIKHgoeBh4GHgYaChoGFgYWBhoGGgYWBhYCFgIWAhoCHgIiBiX+Kfop+in2Le4t7i3uMfYyAinyKe4t/i4GJgIh7iX+Kfop+iXmIeIV8hXmDfYN/g32BfH18foSFiYaIhoeFgYOIfo99jYCHgYaEioSJgoeBg4B9g4aHiYuCh4KGjoKEgoR5gXiBe359hYSNgY6BiIWJhIaBhYCCf4CAgICAgICAgICDgIWAhoCGgYaBh4GHgYeBh4GHgYeBh4GHgYaAhoCGgIWBhYGFgoSDhYOFhIWFhoWGh4aIhomFi4SLg4yCjIKMgYyAjYCNf41/jX+Nf4x/jICMgIuAi4GLgYuBi4GLgYuBioGKgIqAin+Kf4p/in+Kf4p/iX+Ifod+g3yCe4F7gHyAfIB9gH6Af4B/gH+Af4CBgYKBg4KEgoWChoKGgoaChoOGg4aDhYOFg4WChYGEgYOBgoGDgIKAgYGAgYGCgYKAgn+CfYF8f3t7enh5d3l3eXd5dnl2eXd7eHt8fXx9e3uAgICAgIB+g3yFfYR7hXmEeIN4gHh/d393f3eAeIF6gnuCfIJ+gn+CgIGBf4F+gX2AfIB7fnt9e316fXp+gX+AfoB+f35/fn9/gICAgICAgX+Bf4CAgIGAgICAgICAgICAgICAgICAgIB/foN4g3aBeIN4gH5+gICAgICAf4F9gn2CfoF+gX1/enx4eHd7dXl2fXh9fX5/f3+Af398fX5/e353e4CBgYCAgH2AeoF3gXeBdoJ1gnWEdoN1hHaFeIN5gnmDeoJ8gX2AfYB+gH6AfoB/gH+Af4F+gH6Bf4F/gX6BfoF+gX6BfoF+gX6BfoB+gH6BfoB+gX6Bf4B/gICAgICBfYKAgoGBgIKCgoKCgYODhIaFhoaHhoiHiYeKiImJiYmJiomKiIuIi4iLh4uHi4aLhouFi4WLhYqFioWKhImEiYOJg4iDiIOHgoaChoKGgoaChYKFgoWChYKFgoWChYGFgYWBhH+EgISFg3qIfIqBiH6IfIp8i36Kf4mCiICGgId/hn6IfYd9g4GCgIR/hnuDe4N5g3mAd356gXmAeoB+hH+DfYKDgoqBiX+PfYx+hYKHf4l+ioOKiYeLh4mKh4SIg4iFg4aAgn2FgoaEgYWAfIV4iH6IgoR/i4OGgYR/gn+EfoN+goGBgICAgICAgYKBg4GFgoaCh4KIgoiCiIKIgoiCh4KHgoeChoKGgoWDhIOEg4OEhISEhYSGhYaFhoWIhYqEi4SMhIyDjYKNgo2BjYGNgIyAjICMgIuAi4CLgIuBi4GLgYuBi4KLgouCioKKgoqCioKKgoqBioCKgIqAin+Kf4p/in+IfoR9gnyCfIJ7gX2CfoF+gX+BgIGBgYOCg4KEgoWDhoOGg4aEhoOGhIaEhoSGhYeFh4WHhIaEhoWFhYSFg4WChYOFg4aChoCGfoZ9hn6HfoZ+gn1+fHp7eXp5enp5enl6eXp5eXp6fHp+e4J7g32FgIWChYSEhoKGgoaChoGGgYWBhIGEg4ODhISEg4SDhYOFgYWAhX+Ef4OAg4CCfoB9fn5+f35+fn5+fn5/fn9+f36Afn9/gICAgICAf4CAgICAgICBgICAgX+CgIJ9g36CfYR9hHyCfIF8gHuAe4F4g3qDfoJ/gH+Af4F/gX+Bf4B+f3x9eXx3fXd8d3x3e3d5d3l2enZ7dnt3fXmAfoJ6gnWDc4NxgnCCcIJwgnCCcYJygnSBdoF3gXiAeYB7gH1+fn5+fn+AfoB+gH6BfoF+gX6AfoF9gX2BfoJ9gX2BfYF9gX2BfYF9gX2BfYB9f35+f35/foB+hXyDd4OBhn+EgIKBgn6CgYKBgoGDh4SJhIeGiYaKh4mIiYmIiYmJiIqIioiKiIqHioeKhomGiYaJhomFiYWJhYmFiISIhIeEh4OHg4aDhYOFg4WDhIOEg4SEhISEgoSChYKEgYSCg4eCgYd/ioOGgISEgoKCd4V2h36Hf4h8inyIfYd9iHyHfoaEhIGGeIZ8hX2Ff4J7gXyBfIB6gHh/fH5+fX5+gYKDhIGFhISIgImAhYB/iISKjoWKhoGIg4iJi4mIhIR/hIaHjYiDhYV+iXuNf5CEh4OBhIqDiYKHf4l9g3uEe4J+hYCEf4R9gn6DgYGBgIGBgYWBhoGHgoeCh4OHhIiEh4SHhIeEhoSFhIWEhISEhIOEg4SDhYOFhIaEh4OIhImEioSKhIuEi4OLg4uDi4KLgouBi4GLgYqBioCKgYqBioCKgYqBioGKgoqCiYKJg4mDioOJg4qDioKKgYqAioCJf4mAiYCKgYmAh3+EfIR8g32Cf4KAgYCBgIGCgYKBg4KEgoWDhoOFg4aEh4SGhIaEhoSGhYiFiIaIhoeGhoeFiYWJhoiFiIaIhYiEiIOJg4eDh4CHf4iAiYCJgYl/iH2FfYN7gXt/en17fXx9f31/f4KAgIKChIOHhIiDiIOIg4iCiICJgIiCiIOIg4iDiIOIhIiEiIOIg4iDh4OHgoiBiIGHgIeBhoKDgoGAf39/f39/f35/f39/f35/f39/f4B/f39/f4F+gXyDfYJ9g32FfIZ8hHyEfYN+hH+Df4J/gYGBgYKCgoKCgoGCgYKBgYGBgIGBgYGBgYGBgIKAgX+Afn5+fHt6enl4end7dnt2fXaAdYN0hHSDc4Ryg3GDcYBygXKCcn91fnaBd315fnl+fIB7fXt8e358f3yAfX99f32BfYF9gXyAfIB9gX2CfoJ/gn+Cf4J/goCBf4J/gX+Bf3+CfIN9f3yBeoR+hXiDh4R4hX2Dg4N6hIOEg4KCgoKDhYWDg4iEhouGi4mKiYiKiIiJiIiGiIeKiIqIiYiJh4iHiIeHhoeGh4aHhYeFhoWGhIWEhYSEhISFhISDhIOFgoWDhYOEgoGEgoaBhIGGfot7iYiDf4V1iYCJioeGioGNe4l6hnuHgId8gHt9f4B1gXh/eoJ9hHyFfISAhYGDg4aDh4SEgIR9hXuCfIODgn6BgIV+hX+EhYSHhIqDjYGBgX+EjoaMh4iJhoqLiYmKiIqFjoeOiYiChYmIiouKi4WBh3uFfIiCi4OKg4mDgoSLgoiBg4KEgYOAgn+Df4B9fn1/foKAg4GFgYaBhoOGhIaEh4SHhYaFhYaEhoWFhYWEhYOFg4WDhYOEg4WDhYKGg4eDiISIhImDiYSJhIqDioOKgoqCioKKgYqBioGKgYqBiYGJgYmBiYGJgomCiYOJg4mDioSKg4qCioKKgoqBioGKgImAiYCJgIiBiIGHgYR/g36CfoJ/goCCgYKCgYOBg4GEgoWDhYOFg4WEhoWGhYaFh4aGh4iGiIeHiIeJiYiHiIWKiYmHiIaJh4iHhoiHhomEioKJhYmEioSNhI6DiIOIhImDiIGIgId/hn6FgIR/hH+EgIWChYGHgYmCi4SLgYx/jIGKgImDiIGIhIeBiIKKgouDioKJhImGiYWIgYiBiIeHg4eCiYOKg4qDiIOFgYGAgH6Af4F+gX+AgIB/gICAgYCDgYKBhYGEgYWBhYKFgoaChYKEg4aChYKEg4OEgYSBhIOFg4SDhIGDgoOBgoCBgYCAgIF/gH+CgYGCgoWDh4WGhYaHhYKEfYJ8gnd/fX2AeYR6g3t/eId0hXZ+d3h2fXt8fn95gHl/fH18f318fH18fXx8fXx9fH1+fX18fnx/fIB8gHyBfIF+gn+EgYSBhIGFgoqDhoSHhoWJgoyBj3qOeIuAjoCMfYN+hoKDdYR8goGDhoZ8hn2FgIaJg4OChISEh4qHg4Z/iYmGiYeGiYOIhIuIiomFhYSLh4iJioeKh4iGh4aGhoaGhYaFhoSFhISEhIWDhIOEg4SCg4GFgoODgoN/g4CCf4J+hXuDen2CgIKEeYJ/f4KChIV5iHeEeoaGhH+EeoV9iYGKfoZ1hHeFhnx8fHp/e4SDg4SDgoJ/goCGgId/hXyFgYKEhX6FfIN9hX6Gh4KGhIWIioqHhoOEi4KJhniIhoeGiYeFgoJ+g4CJg5GDkouLjIV/g4OHj4qGiI2Gg4OFhIeGioOOgoaJfYuGhoiAgoCDgICCf399fYJ9gYCDgYSChIGEgoSChIOEhISFhIWEhYSFhIWEhYSFgoWDhYOFg4WChYKFgoWDhYOGg4aEh4SHg4eDiIOJgomBiYGKgYqBioGJgYmBiYGIgYmBiYGIgYmCiYKKg4mDioOKg4uDi4KLgouCioKKgYmBiYGIgYiBiIKHgoeBhoGEf4N/g4CDgYOCg4SDhIOEhIaEhYSFhYaFhoWGhYaFh4SHhIiGhoiGiYeHiYaIhYWAhoGMgoiAhIGHg4qEiISEgoKDg4iFiYiKhoiGh4WFhoOEgoaEhoOFg3+EgoaBh4CHgYiBiIKHgIiBh4KHgYeBhoGGg4eBh4KIgoiDhYKEgoODhIWGhIeDiIiHhYeEiYWKhImDh4OHhIeEiIaIhIiDhoGEf4N9goCBgIGAgYCBg4CDgISBhYGFgoWEhYSFhYaFiYKEgoWGhoaFhoSFhIWBhn2GiIiAioSIhoaCiIKHgYOChX+Ag399g3aEgoWFhIKBgoGFgoOEgoSEgXyAfIOCh4WHfYZ+hYWNeZJ2jXqLhIZ3hYSEgoF7gn2GgoJ/hH+EgoKBgH5/fX98gHp9f3x/fIB8gX2Cf4OBgoKGgISBh4CHhoSHkYSCioGOgZV4lH2QiomOiHaMhIuHioOGhoZ8hn+Cf4B/gICBfoGFhISJgoqDioeLg4qCh4OIhomChoGGf3+Jf42FiIeGg4iCkYKMg4mFiYaHhoiHh4eHh4WGhoOFhYSFgoWChISGgoaFh4GJhYF9gn2FfYd7g3qCf4iBiHyEf4V+iX2LgYx/inqGhIeBi3yLdIt9h3+IfYp3iH6Fh4aFgH+EcYZ+iIeJgYh/iIKEfIV9iIOGhIeEhoOFfol4hoGAjIKHgYWBgoV+iYOIioeEhnOEfoaKiYeNiYl/hHp/f3iCdol7i36LgIeBiYOIhoqAjoKKh4GJiYqPhoOCfoF9hJCEiIJ/gYGCg4CFfYGBg4GDgoWBg4SGg4SDgoOCgoKDg4ODg4OCg4ODg4ODgoODg4OEhISEhIOEg4WDhYSFhYWEhoOGgoeCiIGJgYmBioCKgIqAioGKgYqCiYGJgYmBiYGJgYmCiIKJg4qDioOLgouDi4OLg4uDi4OLgouCioGJgomBiIKHgoaChoGFgYWAhICEgYSChISFhoSGhIeEh4SHhIeGiYaIh4eHhYmGiomHg4R+hYKFh4aEgYB9hYKChYeCiH2Gf4SDhYSDhIaChYKEhIKFg4aEh4OIhIaJiH2JgIeFh4CFgYSEgoGEgoeBioOJg4eEh4SGf4SDh4GKhIeBg3+FhYWCh4OHgoeChoOFhYSEhoaHhIaFhoaHhoeHhoaGg4eEh4aHhYeChoOFfoSChXyIgYWEgIN+goCDgoSEhISGg4R/hH+EfoSBhoSCgoWEgoOHhYOFhYWAgYGChoF7hH+Lg46CjoGNfot+h36GgYh8hnyFfoeFh4WHiImGi36NeI2JiZGGhoV/iYSMgpGFkYWUe498jHuGfYZ7g3+HhIl7iHeEhISFhYKDiISDhoGFh4OBhoGIgIV8gX2BgIF9gX6BfoGEhn+GjIWCh3yOhJZ+koOQgoyCj36NioyOiYCMgI6Mi42Lg4h4h4eJgIh/iXmNfYqMhICEeYaAiISHg4aAhH+DgoOFhH6CgIOIhYmEh4SRhI2Hk4SJhoqHjYiGiYeKhYuHi4WHhIN/gH2AfoSBhX6CfoSDhIOCh4CFgYGDfYR+h4SIf4t+iIKHfomAhX6DeYh8gn+HgYp9iniIe4Z9iXKMfIl/iX+Lh4uHjIOFe4J5gnuFf4V/hH+Jf4aCfX9+gIKDhoSHf4OBgIiBf4Z6iX6IhoR9gn+BgoN9gHx+goCFhIGHg4iGh4SIhYaSgo6DgoeNf46Bf4WEh5GLioyFhoN/iX+JfIp/f4KDfoeBiIGEgIJ/g36HgoqChIGGgIiAioGJgYiDh4GFgYOBgoKBgoCBgYCCgYOBg4KEgoSChIOEhISEhISEhISFhIaDhoKGgoaChoCHfYh+in2Mfox/ioOJgIl/ioCJgomBiYGJgYmCiYKKgoqCi4OLhIuEjISMg4yDjIKMgouCi4GKgYmCiIKIg4eDhoOGg4WDg4KDg4KCg4eDiIGKf4mAiYCNgYl/iYGFg4iEiIOBgYaChYF4gIKCg4OCgYV+hH1+foeAi4CFf4OCg4WBiIiHh4eHiH+JgYl9ioKIgId/hX6Gf4iDhoSEf4KAg4CEfoWChIKGgoeEhoODgoeBh4KFiIaBhoSDgoN+hIKDgoKCg4KDhIKFg4aDhYaFh4WGh4eDiIOGgYWCh4qIhol9jn6IhoGEfXt7fIKFhoeHfoZ+hYGChIGIf4OAhYCEgoOAhIGBgoZ9hoGDgn+CiIN+hoeGiISDg4OFfYyCjoaIhYSChH+Gfol9iYCGeoN9hoGJgIh9iX6HgoSKiY+Ph42CioWKgIl8iYKKhI5+jH2KgIh9iXuKfoaAhoOFi4WCgoqDiYqDiIKIgIp9ioGLhYh+hoCBfYJ9hXeJhIaChYKHgY6Cj3+MgIaGhoOKgpCDjYiIio+DkH+MeY+Mjo+MfYp8ioCLg4yIh3uIeomHjIqLgol8hn6JgYaAgX6AgISCg4OChoOIhYqEi4OOho+Ij4eQh4aIi4iGh4eHg4iChoKGhYaDg4CBgICAhH6HgoaGhoaGiIiKh4eKgoaAjHCKi4x3koKTg418ioeKboSDhH+GdoyCinqJeol+iHqHe4t6jnyOgYx/iYOJgYp2jn2Lg4eChX2Gc42Aj4iMhYp/in+IgIl8i4CJhIB9eYN4g31+g3+FgYSDf4GDgISFgoV7iH6EgYeDhYeMiY+GgIKNg5GEfop5k4iViZKJjI6FloKFjX+LhYeKhoqFg4WGfoZ/hH+JgIaDg4Z/h4qChoWJgYuBiYSGiIGIgoeCh4KFhYJ9f4B/gn+BgIeChYOFhIWFg4WFhISEg4WChoKHgYiBiX+JfIp7iXaKeoiAi4GKf4d+iX6MgIyBi4GLgYyCjYONgo2EjISMhoqHiYiNho+GjoWMg4yCjICKgYmCiIOHhIeDhoOFg4OEgYN9hHyGeod7iX+Kfoh+iX+KgYeChIWGhYaGg4iCiYWHgod+goCBfH9/goeDiIODgIV9iX6GfX+AfIGAgIGDgoaDiIKGgIV8hX6FfYJ8hH6DgIKAg4KEgYR+g3+BgIGFhIeGhoiEiIiIgYiBiISIg4mAhX+GhIJ/gYOAg4KBg4eDjIGNg4iLgop/hoCEgYSAioGIgIOIh4uEgod4h3+Jh42AjYeKg4OIgX2Ee4J/f4R9hX6Gf4aChYSGg4SGgoaAgIKDgoODgoKDhoCBfoSFgYqEi4aKfod7hn+Lho2CjXmMfIZ9hIGGgoaCgoCDg4SEg36IhYiIh4aKg4uAiYKKgYt9iH2KgIp/h4GEg4Z/iHmGgIWEhoOHh4WLhImJgoyCjoGPfYOAhYGIfId/i36Mf4x5hm+EfomFiH+GfoZ4i3yJipCKln6Yf5aQj5ONhY1+iomHeoqHjIiMhIiAiIGMg4yEjoGKgIl+in+JgYWDhH+Df4KDgoKAfYGAgomBi4GKg4yEjYiNi4yLi4iJiI6GiImLh4iIhIiFiYSNhIqJhnyHgoN+g3iGhomFhoCIe42Ii4qLe5J8hISGdY2CgH2Ag4SCh3yMfoqJi3qJfotzj3mLgYp/jHuOe4x7hoGGg4mCiYGKfIh3gHyDf4eEhoKDen1+e4F/f4KBgYGAhH+BfIN+h4KCh4WLgIt7i4CHhoGKg32BgIGKfpB/jX+HfX2CeYOEhZGEiIiPjoSOeYl5goOCg4aMiZiHk4mBg4SChYiDj4aLiYCXhImIgYmAi4WGf4qGhYmKioWHhYuFe4aBgIyDh4SEf4F/h4CEfIGAf4N/gYN/hHuGf4WCg4WIhISGgoeBiIKIgYqAin2Ke4t6jneLd4uCiXiKfIqBiHiGfIeDh3+LfoyHjIaIhIuHjIiNhoiIioeNi4uEjYaJhYuCjIGIgoSChIOFg4WDhISAhH6DfoOBhIKHgoeDioKIgoaBhYOHhIWHhYeEh4OHgoB8f36DfIGDhIl/hH5/gn6Ch4SGgouEi4OHhX2CfoKEgoWBf4KBg4CEf4R9hX+EfYF8gICAfoCHgIWCf4J+gYR+h3+KgIeFgoiEh4SGgIaJh36IgoZ9hoGFgIl8iIaDjYJ/h4SHhYyFh4WHfoN9e4N7f39+goJ/i4GNiYWJgYh1h4KGgIF+foKCiYeFhn2Bgn+KgIOChICHgYiAg4GDgoODgIOChoGEgH99f36AfYF/g3+Dd4R/h3+Fg4Z/h36IgYiAhX6EfISAhoOIgIiAjYGPgI1/i3+GeoOHhYuKgI1+jouJhYV/hn+Gg4WEiIKKg4iChoOEgIOAgoR/jH+IgnuFf4eIjXyGe4qKiYGKdo+Bh4eBg358fXN/dn2CgH2IfYuDhICIfoWCgoCCg4SLiomRgZOEjpaGfYd8hoCJgI5/knmTgpCJiYeLg459h4CCgoOBg4GAgYB+g4SBhH6HfYqBh4SIhoyGjYmEi4aKjYaJh4qIh4KJhYeHjI2AkYeOgod+iIGGd4yDmHyZfJeCkYuIg413koqOeYt6j4ePfoh5kIOPeY9/kIqHfIeDi32RcJdtkYaFloZ4jHWKf4aDh4OEfIV8in+KfYl+iYSFfYF9hX2IgYqHiYOEeYJ/goGDg4WDhoeDhIN6g4GBhH95goCEjYOSfoR+f4CHhYmKh4uFioOFfoSFhoaHgoiAh4CDg3+Ffod7h3yDiYeSjpSOipWDg4R0g42ElJSCko2Nf42AjoKRiISJg4mFfY6IiIqFe4aKiI+Fg4SGhYp/hICDfoWEf4GGgIp+ioN+ioGMf4uKiYSJgoiEhYGEgYiEh4KJfYt1i3aJeYqEhniEeoR8g32DfISBhoKCgYOEhISJh4WHh4eJh4mGiX+MhouGiIOFhISGg4KEg4WCh4eFh4WFhoSCh4KFgoODhIKEgYSChX+FgYWDgoSChn+GgIeChoGFgYOCgH17f3yHfoh/hoKDgIZ/gn99g4KHiYmAhYKFgoOFg4WEgIaAhn6GgIZ+iICJf4aAhYODgYOAg4OFfIWFg4SCg4SGhYWGgYODgoSBgoKAhH2GgYeChIWEhYF/f4aHh4iBhoOGgYOAhYqEhYKDgoWChIaEiIaFhoWDi3eVfY2JhISDhYSHhoCFgoOEgIN9iYCIg4aBhIGFgYaChIKFhIOBgoOAg32Ef4KAhIOEfoB8hHyEeISAfoZ+hYJ/hX2GgIh/iIOHgYh+iISMfY5+h31/f4R5hHt8h3yLhoaJgIWFh4WJhol/iH6Hh4h/iISChYR9hn6Dgn2BfIaAiYuAiYCFhYV+iXmPgIqLiYOEdYF+hY6MfIyBinKDe4ODh3eGdYOCiIaKhIaEhIaEgoaCiYGHgoOBjIuRiYqBk4iQeox+gX9+hYKFi36QeYyEhY2GgoaBg4KCh3+AgYKBioGMgYSEgIeDioiLjoWAgYOHi4aLhomHiIqEjoKPjYWCiYCMhpKDj4OQhJFpiniGgZCDlKKJiYNyhYKLfop/jXmRg4mDfoZ8f4J3hXmOiIt/j3aPbYV5ioaSi5B2hXyDe4t4joWNg4t7iX2Jf4l8ioeFhIN+gnaFeoiCiIeGhIOBgX+De4d6iYaHjYKAhH6JhoOBfn5/iYSOioaHgIaJg4WChYOGhIWFgYWFhYWEhYOCgoWBhn6GfoOJgYt8hoCKiIuRjJuLjIaAi3uRfpSAkZSHhop2k3uThZSMlJqFeYWAh5KLhoGZg4uBjYB+iYeLkYiGhoGDhoKLg4mIhIt6in+Hg4mIhIWDg4KDgn+Cg4SDhoCHeId1iHuIfIh/hn6GfIWAhX+Ff4KGf4CAgYCChISFg4eHh4OHhoiFhIaEgYiFh4eChoGDgoSDg4aBiYWLi4eEhYWDhISEgoOGhYSJhIaHhoeIhISHhImEhoSCgIOChYOCgoWChIOFgIeCiYaOf5N/jI2IhYmAhYKCf4SFhoSIgYeDiYKHhId+iICIgYiBiICIfYd/g3yBfYCEf4N7fn2Dg4WCfYWFhYaDhYSHhYSIgYaGgYJ/gYSEhIeGhYeAiX+KfomBh4GGhoKFhYKMjYeGhYeJgYqHiYGPgJF5hX99f4SKgoeDhIGDgoGCgIKFgYKFhoh+ioGIhYmEiYWFioKFhYaCgIOBhH5+fn5/fIKChIR8gn1+eX2FfoqDg4KBgn2Cf4J+g3+Gf4R9hoCFfH9+gYaEfYJ5gH9+jIWEjIONhoyIioWFhoOAhoCKhImCiYGNg4yChX+Agn+HgImChIp2lYKMh5R5mH6HhYiCmXyXhI2Fh4OFdYeGfn15godslm6aepSMh4p9i3mHhHqJfol+iYSIkIh9iXuQgpOEhIGIfoqJi4aLg4Z9hH58gH2LhYiDgYJ+hYWCjIN/g3+EhoiHioKGfoGBgoCHiYeOg4OBh4KJhIaGhYeCi3qPkY2IjH+Kf5F4lICSfouAh5OGd4N7f4mRiZSMj3qChIN4hHmJe5KCnoChgJx8nnSefpqDkXuHgX2HdXOCf4aIhoaMdIt3h4KGfoZ+hn+EfoN+g4iFhol+hn2CeIKAg4iEhIWDhn+DeH97fYeAiYd8hXqCh4SHg4ODi4SHhIiBhoCJhIaDhIKGgYR/hYCFgoaBiH+JfYWChIaGh3+Ee4aBh4CGgYiMjoaUkZV+lH6IhYKDh5mUgpRkh4yAkIKEjJeHmniDh4GDioeOjISLlIh5hoaGiYeHhoyHiIWIh3+JfYh+hoKHgIWMhoCHgISChICGgomBiHuFeYB7gX2DfoJ/g4CDfoV/iH2GgYSHhoCEhoR9hoWFgYWChIODg4OEhYSFgIiDiIaLhIqGiIaGhYSAgId/iYOGhIeFhoeGhYiEg4iGiISIhoZ/hoGGgYaCiIKJgoaFg4aEh4OAg4aCfoCHfnqAfnh/foqIhomHiIOJg4p/iICJhYp/j32SioiEg36Ef4aAiH6FfIB8gH+CgYOEgYaCgYCDgYSEf4J/hIqBgIOBg4V+g4GAhIWFgYaAi4KMgIt+iX6GgIWCiIKKho2FjXuMg5CPiY2GhYiCh3yEeHyLhIaGfoJ9i4SKhol+joKHhICCgIF/fH6Ef4GGiYSKg46IiYOHgIGEhoR8hX2CgYGEfH96fnqGeYd7gX2Dg4KFi4R/g36FfoN+gIGCfoWCgYaAfYCAgIKGfIx9hYaBg4GAgoOEg4aGhI2Eioh+h4GGgYaCg4GBgYSFhIOBhYeIjIKYbZlylY2IkoNziYGUkJJ0h3yIf42Ik5KHfo11mH+hd59nlnGNgZGOnJCkjqeFnH2MioaHhYGNe5J8j3+HfoSAg36MZ5WAl46OjoiHiYGOhouCjIGPhYyCgoiDg4R/gX+AgYJ9hn6Ch3+Eg3mFhX+UfYp/h4OFhISDhIODf3yAiIl+jnyOfYx6ioyHhoaEiIOJfoGNfn6DeYF+hYOPkIx1i3aKc452iYCJgY1+goV7hYSDhoGKhpKLk3qIc4KEg3iKcYqAh4eDgoN6g4GDgYOEgISDe4h7iIOEgIJ/g4aEgYZ+iH+FgH+Cf4WDgIJ8foV/hn+CgIWAh36Gf4mAiIGFgIaBiIGHgIeAhoGHf4aDiIGKgn+EfYSDh3+Dg4KAgICBgIKBg4WFhYSHfoSFhIaBioKHgYGDgoWGjISLf4qKk5OEjIaLj4eJgJCGg4qEgIx9iIOHiIqKhIiFhoCEgIOAg4F/hIOIhYGHgId9h36He4h9iHqFfYSAhnuEf4l9i4KGfoV9gn6DhoaAgoKFiIWCg4GCg4CCgICBf4CAgH9+gICDgoaChYSGhIaFhYSGgoOEhoOHgoeEh4WGhIOFhIiCh4WBgIR+hn2Ge4d9hX2HgYWHhoOIhoSFg4aAf36Hg3SAioGFhIKBfn2NgX2EeoWGjICSg46Ih4SEhIyKjICNgY2Fin+CfIN+hHyCf4GHhIiCiYGDhn+CjH6Cfn6BgIB+g4GGjX9/g4OFf4V7hnqFfYR/g4GDgISBgoODhoWFhYSHg4iKiJWGioeEhYSBgoODhHWAh3+BgXyIgIt1iYmQi46FiIR8gX+HgX1/jHuUg4ODhYyGi4qIf4d+g3+DgIKIhIeFf4WFfYl9hoCFfn5+hYOEh3+IfoOBhYSFfod+in+IgIN/goCBdYZ8iJSJh4mAh4OFhoSJh4OLgIiGhYGIfIiLhYWGh4mHioOGhIaCg3yCZ4R3gpWDnIJ0k1+afZeIjo2Ff4SAhoWOgY91mHCZfY5+h4OFgoaBhoGIgY2DkZCUkJWJkYOGg4B0g36Ef4KBgn9+dnqBd4x6i4x7kH+MioyHjYGLiIeGhpGFfYx5jYSMh4d7gn6BjYKAgXt/hISOi4OPgJKDlIWViI6QhoWReJSCi4t9iXVygHqMhY+EioCEhIOOk26WdZeLjIiDioNyhXiFdoGEf4Z7fX59ioiNe4l9iX2GgYV+hoCGh4KNg22Eb4KDg4mDgYJ7gXyEgIWBhoOFeYF8gIaFf4R9g4SFf4V+g4GChIGHgoGCgIKBgYF+hX6Df4d+hn+GgIeAiX+Jf4iBh4GJgIWBhYGIgoCCiYSIhn2EgYR+hIGCg4SBgYCCgoGFgISAhIGHhIKBgoJ/g4SAhH+FfId2knWHeYR9h32BgoR9kHmWepB7hHqHg4qHh4aAg4V+h4KCgYGBf4GBf4KEf4aAiIKFe4R5h3qHfYl7hnqGe4d/hnyIfH92hH+Ff4N+hoCEgYWBiYaFgoSAhICCf4OAgH18f36DgIWDhoSFhoSHhYaGhIKEhISBgoGDhIWFiIWLiIiFiIKHhoWDhomJgYuCioGHgYSBhYCDgYSGgoKDg4SHhISDg4WCgnqBiYB7hH6IhY2HioSHg4mEh4CDgIeIi4SLg4qAin6JgIiBiIKIgod/h4SBgYGDg4WEi4OEfoKChIV+hIKDhoGCgIKDhol9hnmIfoiChnqFe4SBg4GEgISDg4KGgoeDiIiIgYuGj46PiI+BjIeKhYh6kXufdJuMiYKFg32Iend+foKJf5GChnyDfX+Kg5aMkImQioWDhoWJe4aEfot/gn6JgYeDioGIg4qAiYOFhX+FfIR5fniAfoaLh4aIe4V8gYWAhYKDgYCEbIV4hZSHi4eHhoOKgouIi36LfI2DjoGLgoaPhYKGgIqAi4OOfo+EiX2Ob42CiYyUj5RuhmeBgoKGg5aGhIGBg4CKdo9wiXeCgIaFhoOHf4Z+hoGGgIeBh4GOhJONj5KIhId5hXqCgoCCfIB6en99houHfIVzgYZ/ioGCgoCIgoaKhIWJeYKBfIZ9hoN+hISJh4qHhoOGgoaGgoOCgYaDh4SLhZGKlIKJfYWEjomajJqAjn2FhoR5h4uDiIh5iWyEfIOFiY6Phol8h3yBfoF7ioGOgoh7hnqGfYV+f4SCgoR/hICChISMhW+Adn6DgYSCgIF8hHqEgIKAhHyFfIKCgH+BfoKCgYKBgICAgIF/goGBfYB7g3uDfYN8hn6CfoV/hX6Hf4d/hYGHgIiAhIKFg4aChYGFgIGChYSAgYGDgoCAgICBgYB/goKCg4OFg4SDgoKCgoOCg4KBgYKEhYSHg4qGiY2Qg4qCf4SId495kYKNiImJhoqGiYOEhIaFgomDg4F/gIB+foKEhHqCgIF/goGCfoB4gX6Df4V9iIGJdIh/hnuFfIqChHmIfY1/hYKDhoN/goOEhIJ/goB/g32FgYSDhYWGg4OCf4KAhICEgYWDh4aHgoeEhYCGhYmBiIGHgYuAioWJiIWGiIyGgoZ9iYOKi4iChISGg4WMh4eEiIWEh4aHhIR/iX6Wfo+Ig36Ig4l/jIOPh4iNhXyKd4mFiISHgIR/goKDgIOCgIF/hX1/fISCfoaIgYqEgIaHgoaDfoOBgoKCgYeDh4CGeYZ9hXmBe4R/hHyDfYSBg4WDgoSEhIGFgYSBhISGg4WFgoeDgoeFhYaOe5d0jW56iHCOfoKCf4uEinyGgICJhYiEjIqGh3+FgoGNf3+DgoaKhYWCfIOAhJCDhH6IgYGBhIWFiIyGhYmGhXt+eH12i36FgXuAeoWIepF7jYCIfIl/hYx6e3N1gIiFiYeKioOPepKBkYCMgYaEhYSEiIqFkoGUf5OGkoWQeJZ/onCcbZmClJOPgpV4h4Z4hnaChn2Wf5iMjomDeoFtgoaEeoZ8h4KFfoV/hICFgoOBg4CCgIGCi5aFjX54eIB7gn2FeoV+dH90e3+Ag36Ee4t+fYB5fn91hXaQd4V1e3qBfoh+gHeGd398gICIgoaDgYiCj4mJg4d7jnmOgo2IiJGAiYl0j3uRgZGCjoWLhYiEiYGPg458hXx+hHyAgoCEgYeBioOIjYR1g3OEgoSBgn1/fYF9hoCGgYR+g4KCh4Z+gnp8eXx6g36Hfoh7hXuDfIJ9goB/fn+Agn+AfH+BgH9+gH6AfoF/hX6DgIN9h4GCf39+gX+CfYR9hH6FgIWBhIGFgIaAg36Bf4SDg4OCgIKBfoGAgIF/fYCAgICAgH+AgoGDgoSEhISChYGEgIJ/hX+Bf4J7g4GJgoyAiH6HgpaBfXySfI6CjIGKf4qCh4SBgoaGiIeGho+Cg4B/gol+gH94i3iLiX2Ae4KCgIV7iHuKc41ykniOgoZ/i3mOeYx8jIWHen6IgYGFgYaAhISDfoR/gYWBh4ODg4GCfYCCfoZ+f4CAg4KFg4qCiIOHgoeAi4CKhoF/g3+JgoWChoSEkoGIg4iIhYuBhoCLhYl/i42FfYmIjIOPg46Gi4mHhYeAh2WJhIShi3uPg4WNgXmJgJGLj36IgIiGin6JhYN/hICFfYOFgIZ+hn+Ch3yHgoKPg4aCf3+GfYR+goCDhISIfIZ2h3iFeoR8hnqFf4WAhH+EgIKDhIWGgoWDhYODg4KEgoODgoCKgYiFeoZ4ipOHcYF7eIN2mX+DiHuPeI98jYOFkH6OgoOMeo2Ei4aHi42JkYSIiIaEiYCHh3mGfIaFhot/jH2KiYWJhIGJg4+Gh3+FfItxi3qViI6Ph4KKY4h7hISCf4N9hpKLhY53i4SKjY19kHuLe4Z/hn+IhYeIiYGOgY1+i3qTfpuJln2Sd457kHWLe4SHhJiHcYh7jJOQkpF6jHKGfI+GlY2Th4d5hnmIgIV6g3+FgIKAgYGAgX+Afn9+gH+Cf4WInH6DeH95fHuEf4F9cniAc4B6boh7i4+Chn5+f4KGhZCGmYGed5aFiomHhI2Hi4CHgIt9kn+Tgo59joOPiYeBg3qChoCLg4+KgIl1hXyEfYKBg4iFhoOFgYSBgYGAgISChYJ9en94gnx+fH+CgYZ8gn1/gIR8hX2GfoV5g4CDf4V/hIOIgYl+iX+KgId8g3SGfIR+g3uBe399gXyCfICAgICAgIKBgYKAgoGDgYCChIOEgoGDhYOAgoCAg4CBf4WBgoGEgIOAgn+HfoV+hX2FfYN5gnqHf4SAgoCCgX6AgICAgICAgIJ+goCBf4KAg4SEhYOGg4WAhX6DfoN9g32EfYqAjH+GhJB+jHmOgIqBiYOLhIeHfoiDhoaCg4SBh4uKlYR9kHiOlIaAeGaIdo2OjHOYd5B/goJ/cYB0fXmCf4p8h3p9fX19gHiAh4SEh3iGgoGDg3yJhYN/hYGHiISFhIN+fICAg3+BgYF/hICEfoV/i3yOiIKCfn6Eh4iJhn6GiIOIhYWLiZGFjoiLhYx+jH+KgIWEhYaPg42Eh4WIhoSHiIeMhoOOd3pwhnmEfnOFgY2LlICGhoKGgn2GeYqMgYOEgop/goOIeIyOgI6CiIaFgoF9g4KGgoF+hXyIgIeCiIiBiHmGeIV5hnqDg4N9gYCAgYGCgYKCgYaBh4CGgoSBgX6BgYKBgn+DgoiFjHGOgoOQhIV/gHaJd3+EgIV+gXaIc4mDgo2Gh5CHjoOAhH6Je4+DeoaFfIiAhoOEhIOMh5KIjYiEhIOBfYF+hYJ9gHaBf4aKgYSBfINvjW+KfYyNkYSEdX94hISHfn6GeoaAgIGCgIaGgYx9ioGKgYt9jXqLgIuIhX6OeJp7mIiId454j46FhoR+f3aBfIiCkIyJfHx4gYKKh4yFh4eEg4F9hoaJjI1+iXqEfoB/gH+AgYGBgIJ/f4B+f39+f36CfYKBjomPhoOBgn2Ei4mDgYGBhoKKZYV4h4yGlniEe3iHcYt8in+FgIKKjI6UfpSDjpCMf493iX+Gg4aGhYeFi4aGhH2EhYeJjIaOgYd/gYJ/fnuCfIR/hoKGg4CCgoGCgYCAgnyFe4Z/f356fn2Af36CfoCDfoF8gHmBfIF9gn+CfoR+hX2EgIOBgnmGe4Z+hH1+gYB+gnqDfIN+g3x9gX59gHqBf4GDgoODgIGCgX9/f32AgIN8hH6BgIKAg4CCf4F/gH6DfYJ8g36DgIOBhH+EgIaBhoKIgYaCgICAf36AgICAgICAgICAgICBfoF/gYKChYKHgIaAhn+EfYV9g36He4t9iH2LeIt3lXqHfYaDhIeAj4mKj4SAhomChoKCiISKkIqDhH6ReZuKk3iRYZOcg3WBcYKPhXuLaoh6gHqAc4F5f4KCg4J+foF/gId7hnuHfoiCh3uEe4aBhYOHhYuFh4SBfn9/hICJg4iDin6JhYaChHiJgIuJiYCHhoiChn2Ij4qMinyGhYSJh4iMeYt+jISKiYWNhIJ9fIKCiICMiYeNgn2KhIyRlHeegKOJnIaMjIyAl2+VloWGf4mAbod6lIiPiIl+iYKCd4GHi5GKi4Z8hIx+gXqBeIR6iYCMhIiJgYd7g3yEeYN9goCDgId/hIGCf4F9hH2FfYN/gn6CgISEgnyBfoV8h32FfYV/f4NyjXt8hoCHiI2Fk32Vf5CMjX18cXqChIaFgoSGhY2GgYWIiIeHfIORgYyFf4iLgYh/fXmDf4iFhoOBfnqEgoyDiH58fH6HjoqWiZCCfG+HhIWHhYCIeIaAhnuMe5CQjpCDdYJ0kX2QgYyCioOMf5B7lHuThY+OkHyRaIp5jYSPho97jZSLioiBiXqIdIJ6g4eFkYJ5gIJ+hICGg4aHgoWIgYSHf4SCgoCBfoR/g4CBgH+Cf39+fHt9fn58gXyCfYJ+hn+LgoSKhI2IhoeFiYh2knOJeoV+hoWNnIiRhHGHa4J/gYV6jXmGgXiCfX2NgoeJd4V/goSDhISEhYWHhoiChISGhYWFhYKFg4SFf4R+f32FfYN7hHqEeoN7g3t/eYJ5f3yJfomAfH58fIF8gICBg3yDfYJ9gXmAe35/f32BfX96gnyDf4V/hXmBf36Cfn+CfIN9g32BfIF7gXp9gX57fnp+fYJ/gnx/gYB/gH+AgH+BgIKAhn+Af4F+gn6Cf4N9gn+DgYWAhn6DfYSAhoCGg4WChYOHhYGDf3+AgICAgICAgICAgICAgIB/f3+Af4B/goCEgoSChn6Ke4Z2hnGHdYd4hH2IhYyNjouGin+PhIyCiYKPjZZ+nIqXi5d6nXqhjZ2LmXKVgJOKlHqHdoWFkoGMfY6HjHqEcIR7hYR9eH6BgXWIeIl9iICKc4p2i3uEe4J/g3+BgYKCg39/f32Ef4iHeot6iHqBfX2FfnqAeYeBhX2FfYd/in2HhoWDhIaFhImEioGJhoqGiYCKeYWChIeFiY+MkYSRg4mDiHmLiI+QknOOi4GUhWuMd4iOhIyTfpdzkoCQpIiVj3+Mc4hzgYF/g4WHh4qDgH+JfIB+i32HgIZ8g3iEgYOCjIWJioGNeod/hniGd4Z4hnqHfYh8hn2GfYR6g36CfoOBg4CDgoSEhX+GfYR7hoCKfIh/hoKOhYt6hICMhY2Bh4CBgYN+iH2EioNujX+OiYSHg4aJioCRgoiEh4SBjYeNgoeGhHmFiYeJhH+Hd4eGhYN1d3d2gYCNk4SCfnuMgpiOlYCSdZSKioSBdYF6hnWGdo2BmI2eiZl2kH6Rf5aAk4yLeYt2g3mDgo2LkH6BeYR+hoSJgYt+joiRiZCAiH18gXR/eoSDiIeDgoWCiIGKgoiAg4GEg4GFgYGCgn+Afnx5foN+foCCgIJ6fnqCeYJ3g3eBeIF5hX2LgX6BgYODg4OHiIJ8f3SEe4J8g3+IipeOm3OLfYSGhIKKio2AiHuFgYiFjH6HgYSEgYWAhYKDg4OFg4WChoSFh4CEfoJ+g36EgYR9g3qEeIh4hnuEfIN9f3l+eYJ6gnqGf4GBen18fYOAgoCCgIGDfYV8g3qAfIF+gX6CfYF9gH2Ae4F6g3uEgIGChXqFd4J7gXyCeoJ4gH6CfIJ7gICAfoB7f3yBf398gX+DgYF/gIJ/hIF/fn9+gn2CgYOAhX+DgIR/g4KCgoWEgoOChXuGgIN7goB+fn5/e36AgICAgICAgICAgICAgH+AgIKAgYCCgYOBhoGNfI55j36DgIF+fIdvloGOk4SMhYOFgoh9iIWIiYSBg4GMhYqDf4aBhYiHhn+ChICLhHyIhICOd3l+cYqCiISHcIJ9hoCPe495hnuAdIR5hnyKd4p4iX+Eg4d/inuKgYSAhoGFhYeDin2Id4R+hX6MfJl9mYSNhYN+gX99fX9+gX6CiIKCgYODh4WHhn+Kg4qChoCBhYSFiISJhImEiIGHgYmHh32Cg4SIg4SEloqKjWyCe3+XinaGgH59en6Bm5GJlHiOeIZ8g5GBiIF8gYCCg4eKi4OMg4qOfol8h4KAgoWGkIqFi3+KeI15i3qJcoh4iHWNeIx+g32CfoB6gH6BfoCAgYCCgoWAiXyLdY18jHuRgZGGgYV7gIB6gH95c4d3l4uVi5F7lnSUlIt5eIB1iH+JgoeEj4WNioqLiIqCi4WJgoKDg3t+f4CGhIGHc4N9jJGRh5B1jXGQjJGQk3+Nh4aFjHGKd4qGjoOKfYd0hn5/doB7gn6FfYd9iH6HfIiAi4aLfn6AgHuDgYODho2Hf4h4hn2FfX19f3yBfnuCfoJ+hnyJdHl6gn2Jeop+h4WHhYWChoKBhH6CeoGCfn5+fn18e39+f32BfoF+hn2FeYR5gnqDeoN8gYGBgoGAgIGDhXyIj4V/hm+FeYaBgnyCgYKBgIGCgIWBhoaHg4aBhYOEgYF/goKCgYOEhIOEg4KBgISAg32CfYZ/iICGgoWBgXyDeYN6hXqJe4R+gYCBgYJ8gXiBeYOAhoWBhXyDfH+Bf39+gHyEf4CAgX+AgYGDe4R6g36BeoJ8gnqBeIB7fXt9fn97fnZ/fH55fnx+fX9/gXyCe4J9gYB/fn19fX19gH19fX98gn5+fX1/gHuCeoN9g3+Bf4F/gn+Bf4KCgoSBhYOCfH1+e3t9fnl+eYN+hH6Be4B8g4CAgICAgICAgICAgYCAgIGAgoGBgYKBhYWLgZZ/jIN5h4WChHVvb4JwnHWDeH2AfoR+g4eCgYSEhn+AiX2KhH6HgYeJg4aBhIWHhYCJf5Sfi4qBaoB1iH6Afnx+fG6Bb4R/h4SDdYJ5gHKDdYJ7goOAgIJ+fHV7hn2Cf36Gfod9hH6BfoN7g31+dXh3eYKAh4KFf4V/f4Z4iYSCgYCCgYaHhYyEjIKIfo2CiISIfYt6jH+KfomCh36Lfop/iHyGhYeDhImDiot6hoB8hIh+jH2IiIl7hIKEgYeAg4R/hHyEgImHg4iBhIGHg4WGgYiAh3+QgI6DhYaHhImFh4mDi3yKeoh1hnSFcYp6h3iBeYmEjIWCf4F9fn5+f4J/h3+Jf4p8iX6Jeod3gm+KdYqIk4abfpWEio+Sb4x0g4CIh4t7eYt0i4CEgYyBgoN+h4aHjISMhoOGgYF6hn2SjJKEiXp9hX6AioCNhoGOeouEeoR6gniDf4h+hIGCkol7iG+BeYJ+g3+Ie4Z3hX6Je4V6hHqDeoF+f4B+f4B+gn+Dg4SIgXiDf4SCh4SJhIh8hn2DgISGg3SFe4KFfIF8hoCKgYKBfoCLfYmBhoGDhYGDg4F8fHp+gHp+f4N9gXp8fIB6f3uBdoJ5gYKHgYt/g4KAg4d/gIF9g4V+gH56gHWChYqCh3eBeYF9hICDgISDg36DgIOCg4KEhIGDhIGFg4SEgoKBgIGBgYOBhIGDgISAiICCg4GDhYCDfoR6g3uGeYV4hH+CgYV/gn5/fIJ8hHyCeoV9goSAhYODgH6Bf4B/gIKGfoF8gX+Dg4OEfoN/g3yBfYB9gXuAfX97gX2DfoF8gHp/fHt+fXl+fn59fnd8dnt9e359gHx8fn1+gn5/e319f318gH1+g36Ef35/gXyAfIF/f4CAgYCCf4F8f35+fn6GfH97gHt9fnyBgH+Bf39/g4CAgICAgICAgICAf4CBgYCBgIKBgYGBg4GGgpl/i312i3qLjoGJenaMjomJf3qBeIN/gYeAhoGCgIZ7j36Ee4N5fn6Ff4OBgYGJgHiBe4KRjZCQeIp6h36IgYeDg2+CcH98hXuNdImDh3iFcYN4gYqBe4N5h32Ef4V3jXSTeo+AiYWEfoZ2ioaIgoR9h3uLgYWGhnmOdoZ3h3+PjouLhYKDgod0f4CDfYZ8h3+DeYJwhoGFgIKEg3qAfISDgICDg4OHgouHhIiBiYWKhIR1g3eGf4WEg4aBf4OCgYKCgX+FgYKFfoKGgoKChH+HfIl9gnmPfIyDhISHh4iKhox/j3aSdJl1mXyLfHp3f3mGcpB3loSOhoyCkH6SgY95lm6fdaF/oYChfJyEjYNze2yJbXl7eICCjX2FgX+Fe4F5hHOJdJJ9gH14hHyJf4SAf4eCgISEgn+JgIp+gXSAfo2DjIeEkYaAioGDi4OOiIKFfn99gXSBfn57gXyKgox1hneEe4N/g3+De4R+hnuGeoR/gXt/f4CAfoB+gIF5gn6CgIaHhoCEf4R/hn6IhYR/f3yAfYN/fHh1gXaIfIF/gIWDiop7hX54h4iCh4F8gIB9fnt/eYJ5g3mBfYB+g398eYB3e3V6gICAgIOKiI+Ih4WBhoGHhIN+f4SDgoSAjnuKgot+iX2GfoN+gn+DgYSAhIKCf4R/hYGGg4eChH6FgIWFg4V/goKAg4OFgoWGgIiBhoODgH9/g32GeYV6gXqCfYR+gnt/foN9gnyCe359hHmEfYGAfoGAg4KBg4CBgX+DgYWHhIOAe31/fX+AgH9/fYB/gH5/gH+CfIN7f3l/d4J4g3uDf4GBfnd+en9/e3h8eHp+fX9+en59e3x/foF/fnx8g3yAen98f36Afn9+gH2BfIB+fXx7e3t9e3t9e4F2gHyFg31/gn+BgYF/gX5/fX9+hH6AgICAgICAgICAgIF/gYCCf4SAgoKBg4GDgpp9jIRrgHiDjIuRiXx7gYGKhYCBfYWAhISCgoKFe5F9in9/fYV9fX2HfYR+g36HgHt0hnCHeHqIfoSDhYGHfomEi2+IeIR8hHaBcYh6jHeIfYZ+iX6Ne413iH6Kgo93jW+LeoqJjYWSeo5+hoeEgol3hXiAfoiBineAgHyAe31+f4OGiI9+i39yg3mMfoyFiX6HeYJyfYGAg4GCgYJ/f3+Ge4V6fX2Jf4eFfIt/jH+NhIZ9fXp4fnqAfoKAgH6Cf4J/goOGg35/f4CHfIF7gn+MfoJ3jnqPg4OEgIKGiYaVgJJ8iXWHbYdil2ykh6aHmneeYqJlmoqNnZFxmXmTh5B/iW+EcYR7f39+f4iFk5KQi4yJj3WIdIeCfol5hH99iIOGiIGIhYOJgoeBgXx+f3mLgYuAeoF9jn2WfpaDjIOGf4B9e46Bk4eEg4WDi4SIhXyFgI57iHSIe417inmHfYl0gnuBe3+AhH6Ge4V8gHd+e35+foCAgYCBgoOGfYV9foOAhIKDhoKEhISCgH6BgISFhH9/eH6Afn95gHp/e3+Cf4RzhZKKj5BlhI2Ah3x/foJ+g3yDgIF/hX+Ae394fnZ+eIB9fHp/fH2AgICAgoaGhoiEhoSIhImFioOLgY59hn+Gf4WAhH+DgIN/hH6Df4F/hH+GgoKAgH6Bf4GEgYOBgoKChYWFg4GCfYF8hHuKgIWDg4GEfoN7gXuIfIN9gX6CfIN7hXqEeoR9gX98fX58gXuFfX6BfIZ9h3yDfHx8eoF/hYGGf4B6f3+Bg3uBgIKAh3+HgYWBhHqCeX95fHZ9eoB6fXp9eYB+gHh+e397gH5+fX1+fnx/fHx/eX15fn6AfYJ6gn6CfYV9g3+CfX93gHV/eYB7fHqCeIB8gXqEe4J/hX+Df4B+fX58fHx8e3qAfX5+f39+gICAgICAgICAgICAgICAf4F/g4KEf4WEiJKJkn1zeYGEeouCjImLhIWIf4F9gX9/foSCgIOMgpKBi32AfIN7hXqJe4d/gYSIf3+EhYiIhXd/coOLhX2KfZB9jXiHe4Z9inOGdX54e3t9eoN5hHuFeIJ5gnyFd4h3gnl+fH6Bf396gnKIfn6EeYB3en16e3t4fHt+f4CBf3x8goB9iYeQiI14gXV6gIt0ln6Gh3x/eH98hHqFfn6AfoODhoeEhIKGhH+GdoN9gHqCgYOKfYF9fIJ9hYCEgX+Bf4CDgYWFf4N/hIOEhIl8hnyAf4iCj4WNg4R9goSDkHuNhI99nnedfYJwamZwaod1kYCQY4h4fZ55l4NhgXqFhYmAhHR7dneEdIh2cnl3gIeIkY2KjX6KfoeCiJCDkX5rf3mCgouAjX+KgYyDiIt+hXuMgHx8eod6iX6HgoOBhIZ+gnuDgIqGiISIfIeBh4iDiYGLfY5+i4CIeot7in6IfoV8gn6Cf4KCfnx9fYJ9gXyAgoCFhICGgYeAiICFfoWAhYiFgoiBiIOIgIh6iXyGfoJ8g3qBf4B+foV/gH+Afn1+dYJ+eIp/dnF5co99f4B9gIJ+iH+DfXx9hXmBdoR2gHmCfYF+gIB/foCAgXx9gICCgYOEhICEhIeCiIKJgIl9hH+Df4N/hH+EgoF+hnmJgYZ/hHyEgoODgH1/f4CBgoKCg4GDf4J/hH+EgYGBhIGCgoGBg4OBgoV/hX6If4V+gHuBe4J9g36GfYN9f359fnt+fH59fH98gH57fn56gnqFeoV/hICDgoGCf4N6g3qBfoJ2hHqGfoZ4hHeBf36AgXqBfYN6gXp/fX57f3l/e3h7e31+fIB6gHuBfICEgX+CfYR9gYF+fIB+f4F9fnx8fX97gX6CgYF/gn6IgIB+gH6Bf398f35/f35+fXx8fX16fnuAfHx/foCDgICAgICAgICAgICAgICEfIV+h4GFf4OChIWPkI6NgH12cXV+fnaPeqGBop6EiYR9jYCNhX+HgZGFj3+EgoKIhIaKhImGfYaEiX2MgJGBlX2IhIKGhn+GfYJ6hH2Jfot3hnKCfoJ9hH2AfIN8hn2Jd4p6iHqCd357fX57goB/gYGDg4l9hHeAfIB9fH15e3d5eHt4f3mBfIR8hICAgXl+enuBeX9+boBkdol8ko16mIt+g4GCgoV6gnd/d4F4gX96hnaGfH2Afn58e4KAjIKMgYGEfoR9h4J+hn6Dg4GBgYWChIV9goSAj35/hH6Yg56JnIidj4+MeoN4hoZelmKfhKCbhH1+YopbkHyHbH5/h5yZh49rjHaJgYaChH+IeYeDi4SJeYGCfIR9hoV/hX+BgYKGhYWQiI16g36Df3yAe4h9ioGDgouCiIaIin+EeIJ9d39+hHuBfod/g319fYN8ioCJeouAkYKAh4aHg4qCioSMgIt8iXyHf4Z/g3+FfYZ9g36FeoR8hoGIfYuDiX+Gf4V7hX6EgIJ+hIKIfYh5hnqFfYB6gH2Agn98gXp9gH6DfoB/foCAgX99c3l6gI17e3qCf3+AgHuCd4N9f4B/e4J4iXqHeYd6g32HgX2Cf36Df4OBgYB/gIOAgIF+gYKEfoGCfoCCfIR+hn+KfIyAin+IhIp+hnaFgoWAhH6Bf4SBhn2EgYCCgX+AhICFg4ODhIOBgH+AgYOCf4J+gH6AgYGChIGDgIJ6gXiAdoB5gXyKfYh/hH+BgIB/eX55gnx8fXt9en16gHuDeoZ7gn9+fnqAfYR8hoCDgH96fX57hICCgnqBfoSAgnSEe4J7fHx/gIJ9fnt9gH2AfX57e357fX18gX56f3l/e356fYB+fHx/e4J5gHl/e4J+hHyAfYB7hH6Cf4KCgoF+gX6AgX5/fX58e3p8e3t8fXl/enx7e32CgICAgICAgICAgICAhHqFfIN8gn+EgIWCg4OChIqNjI98e3eBaHZfcGN4a5uAjYN6inCBlHqPdpN4kH6Jh3SafZaTh4t+hHyJfnyEf4R9h4GGjIeHin6PfZR+kH6LgId+g3uFeIh7hX+FfoV4iHeHcIN2f318fHx9e4J9f398gH9+gXl9eHt3fXmBe4N5gnp/en1/e4J+gYKAgoF+g3qCgYB/gHx+cnB8aYdvgnFai3GhqoOLgniJiYF/goOHeJNnp2CjkoSQfYB8g36BeoV4iXyEgX6FgYN9g36GfYuFiIKGfHx8e4eEjYV/h3aIeYqMiI6KjaOPtZGvjpVjiGGNcKGPsJOmXo1qgn2BdoCBgYOHgo91j3mKjoGDh3WFe4WFg4aBgoGDg36Ef4J/fYV3g31+f4R/g4GDf4R+iICKfIuBi4WBhnyGgIV9fXZvg32Dd31zhnqDfn+Bhn+Ke4d9in2MfY2CjIqKjYmNiYyCiYCMfY19inyIfIaBhICCeoV8h4CHgYd/hnuAfIOAgn2EfIN9gX6Dfod9iHyFeYJ6gnuFf4N6foB+f4B+gIJ8hX6BgXuBfYCAgIB8g2+AdXl+gXeEfX17hHyKfYF8e3aBdoZ6hYGFgYd/hoOHgn6Af4OBhX+EfYF/gYR/hX+DhXiIfYeEinuOcYmHf3d9f3t9fnyDgoZ/gn6BfoB/g4GCgIKBgH5/goCBf36AgICDgIGBhH+DfIF8gH2DfIZ+gH+Ce4F6gH2BfoF6gXaAdoR3hnuKgIiChYCDgH9/fYB5gXl8hHuBeX54gHaFfoKEgYWEgHl+e3+Bg4GDgoN7hH+GhIeEgn6BgIOAfnp8en97f36CfX5/e3x9e358gXyBfIJ2gYJ/gYF8fnt+fIB9fn2Aent+fYB+gX2BfIB8hHx9gX2CfIR9gXx9eXl8eoF7f36AfYF9fHx+fX19f3qAfn9/d4CAgICAgICAgICAgICAgH6EfoCAgnqCfoKCgoWDgoOEi5GGin2Bh32bdpJ8fYZ/g4hvgXd/nXqOepR/i4SCjmiOd46XkZyIjIqHkXSNhoWBh3aMhImGg32IeYl+jIKNg4l+inSHdoR3hIKFeId5h3aAd3x+fXyAfX6Ce4d+fH5+e4B9gHyCgX1/gIGBgoCFfYeAh36Ee4B7gXqEe4N7gH57fX6BfoN7en16hot/iG94Uk9uh4SfkmachKCCp26scJ5piHeFjYm3gXeJg4WGfYd+gIGBhHuBe4x1oW2nd6GLlJJ+iIN8jYKGkX+CfXd6eHqIc5l9eo9omYCWooSDgGGFb4J5jIGLfnmBfnZ8eoCAg4OIfIZ+gX6Fh4qGgn58fnyDgYODgn9/fX+AfX2Ef4mGhYJ7goiBhnp+gnmGf4WFhoeGgoV9dX13fnh8fHx0hHiEeoWEiISCg4R+hH6Df4l9h4KNhI2GiIiLiouMiIqJiX+IeYaAgIV9fYCDhYCCfn9/gX6DfoJ7gn2BfYJ+g4GCgYR8hnqIeIJ6f3t+fH1/fHp/f4CDgIKBg32DfH5+gYJ8fXp9gX2Afn9+h5B8k36Bi3uFdXl8gn6EgIJ8hniCe4J+gHqCeop+hIKChIWCfYOAgX1/gH99goGHhYeCh3eBdoKAgnh7eniKh3+DhIN/gX1/foB9gn2Ef4J/gH6CgYGBgX2CgICBfn97gH2Cf4R+gn6DfYN7gH6Ef4V/fn2DfIJ8f3t/eoR1h3mBfop+iYGFg4SGgIiDiISCfoF+fH1/goB9f4J/hn2Dg4GChISCh3yFe4KAhH2HgIR9f36CgYSFhYV/g4OGiX+FfH9/fnx+foF8hXiIfYJ/fnd8fXt0fniCfoF3gnmAeoB7f3p+fH2AfXyAfoKBf3+Cf4R8gHh8e3mBd315gn6CgYKDf4F/gX6BeoJ8gH2BgoOEhX2Ed4CAgICAgICAgICAgICAgICAgICAf3x/fYGBg4SEgoODhIaKj49/nF+XdpSHmZaKk310dXiBk4+Rk4Waf5x6i3R3gHmPhZCPipCFhoKCkod8iHSGfImCjYaGfoGAhoCKhot9iHaGe4F4hnmGd4N6fn9/fYCAgH2Ae4CCgoOAgoB8f4B+goCBhXuDeYN/gHd/fYF8gn6AfoB9fXd7eoJ2iH98inN/gXuIe4V4gIWKhpWBjW5zdnyCdG1venWDfn5/fHCMXn9bim6minWVdJyCpI+eh5J/jHiNeJFYgXVyfH+DlZagjqJynIGcnJyLlHSXfJCOko+Ub4ptgoZ/s4WKg1CFcIZ7gH+Ahot2hXyCdoSAg4J+gHeAdIF2f3uAgIOBgH15hIJ7iH2CfoCDgIOJgYeHgYd/h4WGioF/fHd6enCCcYB0fnyDeIVzh3p+f4B+kHyPgIWHhYKDeYZ3fnt8fn97g3qJfoqBh4eNhYiJhZF+l4aIhYGGgIt9e4Z2ioOGgoKDg36DgIN8hHeGeYl+iISGf4N5g3d/fn2AgHmAf4GBgX9+fn+BgHqHhoKChHuCgX58fIB7gX1+e3x7g3dpdYV+koSOhoOAf3mDe3uBg4KGgn2Ag3+Ff4mBfYF7goGBg4CAgIOCg4J/gIF/g4R8iXqHeX9+gH2Ae4uAhIaFfYl+hoSAfnyAfXt/fIB/f35/gIKBf398fnyAfYJ8gXyBfoJ+gX+BfoB+gX6CgIJ/g3yCf4B9gHqCd4Z5in2GgIiDh36EgoKCgYKGgYaBf3+FfoN/e3yCeIV6hn6FhIWGiYh/gHt9fX57gXyCfoWBgn6Bg4aGhoWHgIOAhn6EgIOChIGGf4h8hHiCfoB+fHx8fHx6fHx6gH19fnh/en55fnx8fnuBen15eHx+gYN9eH1+d35zg3mGgoSEg4SDgn2Be4J9hXqFeYWAhIGEhISEhH+IdYCAgICAgICAgICAgICAgICAgICAgH99f4CAhYOHhIaEhYeBh4ZvfXpxeXWFcpiDjIR+dHx4fYKHioSIhHyKd4h8iH6FgYd+iXmSfoaMhZB/iH6EeIR9g4KGh4WBhn+Hgop9iXqIfoZ7g3KCeX97gHqEfYV+iYGChn2DgIKDgIR+gn+FgoV7gnmAe4eBf4R/hYd+iH+FgIZ9hXuIdoNte4R+m4B4gmqPcY2Ge3uDb5SGi499kGqcYn1efmmFb1B+h4Chd5JviHx8j2ORbo99lYKejpuSkoqUeYlwbpxne3RihnqOg4yBiYCKhpeDmnuMgI+Pk5KMc4N3ioKZpqiMnGCFd319e4N9foJ4g398eXZ7dn95gnx6hX6JgX+De4aAf4d7iYWAiYODgHiDfoN/hX5/e3p7fnx+fHx8dYF3gHKGeIN7gX+HgIt8jXqAgYWCjIWJhISFh4eDhIKEfHp9fH56g3uKfoqBhIGMhIqJh4N/eoKCiYaIiI2KfYVshYSGhIaEiX+LfYl9gnl+enx+gIGDfYJ8gnuBgIZ8hnyDf4F8gXyBf4SBg3l8gIKCfoB+gH1/fYF+gH5/fH18gHmAdIB9fYd2k3yLkoSHgXaAiX+CfIB5h3qEfH98e3t+fYGAgYCEgYKAgX6Afn6AgoN9fniAgICAgX6AeYN7goKBfX9+f4GCfoSAg359f3uAeoF+fX+CfX97gHl/eH97g36CfH58fn19e399gHyCfIB8gX6Cf4F/gXyFfod/hYGHgoSFg4SCf3+BhYGIgoKAg4CFf4F9gH6EfoaAhoGDg4SGgYODgIB9f32Bg4OGfIZ9g4KCgoKGhYSIfYR8fIF/goOChIOCgYOAhH2If4uDhYB+fX2AfH57fHt9fXd8fH97gHx/g3yDeoF8fnt+en58fHuEdoZ/g4WGg4GBgIKAg3yEe4d9hX1/dn1/fH17gYOEgn+Dd4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBhIWHiH58f3eFgHaIdol6f3mQgnmAf32FfIV+jHuOhn+Jg4OBiYaHlYqPjnqJfYmCjYCKe4OBgIGEhIqDiX+Kf4l9iHeLeYt6h3OEeIF8fXp3gX+DgIqAh4iChICBfoN+hX6Eg4V/hYGFeYaFiIqBhYKBhIWJgY+Aj4GJfn+BeIWDiI17hW6BY3+na5xkZ2pte4txo4STjIGGfIOAcld6eIuVn42giZR/i2Z6doV9gn6Di3ihf3mQcYuGkaaQd4hfe3h8i4CEfoB6fXp7f4WBhH2Jfox4hHd7eHmAjoqFiX2IgYKDgoeEeIdwhX18gH19gn2Gf4N5g3iAfIKNfIN+enx3fnuFgYaAe350gnWEeYR6hHiEeYF8g3eGeH18eoCGeoeAhXuCf4WFjYGGgIeBh32NgYOMfIuEgnyCfIGAfoF8hn2IfYl+iHmQd4GDfIaEh36MhpKGmYWWf4p3gISAgox9j3uOe4qBhH+De4R/h36Heop9g32BfYF7gH2BfYJ7g3yDfoF8f4B/gH6BgICAgICAgICAgICAfn+AgX2Ae4R1dXR0bX10knuEdX51goB7hoR8h3uIgICCgICAgoKBgIKCf4F+gX6Bf4KDf4N8gnmBf4R9h32Lf4R+h4aAf4B5hYGCgYKCgoGCfn2Af399fnt/en98gH6BfoJ9gX6Bf4B+fXuAen96gH+EgYCEf4CDe4B+gIKHgYaCh4SGhYOEgYB/gIN9hn6Kg4KJgIeGgIN7fnuCfYWAhoGLgIeHhYqDiHyFg4KBh4WHhYd/g3+BgIOFhoSHf4KCf4KAf4KBhYKFg4V+hn6AgIOCh4aHgoKBgH2BfIR/fnp6fXl7fn9+hH2Ffn+AfH2FdXx9f36If4WAg4OBh4SFgoN5hHmGfId+iICGfoF9f4CBfYJ+h4CCeoJ5gICAgICAgICAgICAgICAgICAgICAgICAgICAgIV7hn+Gg4aGe3p9fImNkYKPgY2Ci3yBjYCJgYd/ioGEgHaFhIeJgYqEjouGiYSGgYWBhn2GgYWFhYKHgYaGhn6Jf4t9iXmHdoN3gniBeoGAfX6Bg4F/hH+Ng4eEgXx8fn2AhIWHj4WHhYGGhICDgYOKhYyCiYWGfYV6hYSAgoGEhX6OfZSBhH50b3ealpWSeXt1co96joSAhIODgH+Fe3lmVIR7j4mPiZCHhYaEdIB1goOCiYajiWd7dXZ/jYeYfYF5cnp6iX6Cen95f35/gISAjX+IhY+FioB3f39/hoV4gnqAfoeCj3mRdoh2f4CBg4V8gn6EgIGBf3x6eYKAhIF+f3uBeoN5hnqId4h5iYCDgn+Bf3+FfoOAfX+Be3xyfHaAfoWBhICCgIODjIWJgoiGiIqHjHt/eX2Gfn9+eX59gId7iXWKeYWDi4mUkHmGfIGFfIN3gn1+fH17h3qHgYKEe4J7fXqCeoGEhnmNfIqDf3qAeoJ8g3+FfoR7hXuGe4N+gHuAgH9+f39+gICAgICAgICAgICAgICAgICAgH97gpCOa6J9h4t8gYCCfId4hHV2d4N/kICLf4KCfISCgYeAgIB8hIGEgn+ChICFf4R8gnuEfIR9hXaGhIV9g4aFg4R5gH+AgYN+g4CBfoCAfYF9f3+Be4F7gH59gIN9gXh9e3x8gXmDfYCAgICBgH5+foCGfIR4fXqGfYWEgIWDgoB9gnyDgYSDh4SGg4J9fH6CgYR7g3qGgIaFiYeRiYmNg4iCg3yEfIZ+hoWHgoV8hX6DgIGChoaGgoWBhXyEfICEg4aIioWGhoOJg4WBf4KChIaIhYGDf4aBhoKFfYR8g3h8gnh9eHt3hHONdoN7gH2EgXt/fX58fnmDfYR9f4F8f32CgoSCgYSBg4aAfoGBgn6FfYF5gICAgICAgICAgICAgICAgICAgICAgICAgICAgIN4hnqFhISFhId6en19goR6kG+GenqFhYaPgIuHfo2Lg3R9gX2Jf4yDioaJhYaJf4uEiXyHgIaCg4KChIiHioOKf4h4iYCFf4B8f3x/f3+FhX6NeZGEhnyBfYmIhYp/hoGFg32HhomJg4OKg5GLioaGgoZ+h4KCgnuAdoaCd49+jYGMaJKHipCBeYaBjYqPiIyBkIaVkYWHgYJ/hoGDgX9ycFFjXHtrjGGAbHqLcpZ2jImChoWKgXyKgIx9gX53h3p/c3lxgHWGdoF+fICCgX2Dj4KFgoCJhY2HjYWKfoR5f4ODeYd8hXSAgXuDe39+fnx7e396gXqCfIJ/fYKBg4OChYCEgYN/gYCAgoCFgIV+fnt5eXt8fYB9gHuBdIZ0ineCeYZ9iHyKf4iAjH6Mg3yNfIp8g31/gXuBeX54f3h/gImAjoGRhHuIgIuJi4KHhYOOgpGEe4F9gICJfJF8kn6NgoR/hXaEfYSBhXKEdYWFhIODe4Z8g32DeYJ5gHiBdoF/gH1/f35/foB9gICAgICAgICAgICAgICAgICAgICAho+JUnWPb6R4fn2Eeop6hniDd3mJgI6WgoKEgIJ/hIOGgH+AeoJ7hoR+iXuFgIN9h3iKdop4hH1/g4R6gYCFgoJ/foKAe39+fX16fnyFfYF7fH2BfoaAgX1+en9+f35+enx7gX6HfIB9foB+f35+e3yFe4KAf4GEf4N+e3mAeYR6gHyEfoOAgoKEg4SBg36EfIR6hn2EgYiCioaNioOMgoiFhYCAfnuGgIaGgIV/hIGDhYKGhIWKg46BiH6DeX+BgISFhImLh4KHg4iGhoGGg4eHhIWIg4uFjIOKfYZ6gHyBhoGAfHl8jHyKgYeGhomFiH+Hf4R4f3d8enqBeoSAfoB/fYSAg318goOHhoWDhHyDf4B7gn6AgICAgICAgICAgICAgICAgICAgICAgICBfoN9hH2JgI+Jh4iEiHp7eoN/l4KDfm9+gYWGj4OPgYiKh4CDh4SNgouFioiIi4OKf4OBgX5+gIWHh4eGf459koGQgYp7hn2Ke4l/hoKJh4aCh3yKd4aAhoGBgYOFioqLjYeBhHyEgIqDjISKf4qHiImGg4Z8hoCHgoyEi4SEdoB3h3x9fmuIdo1zfnd3foeCe4KDdYZ2lICJfId9g39+gH9+fXx8aHVggniHdWR+P45xiaF8kXWVem6EcH+Idox1hXmAfnmDf4CCh3iGfIODf4GCiIWFeoJ6goGAiIGGgYB9gYODdoN8gH19gYB9g3yCfYB+f4N+iYCEhn6CfH9+fH9+g4N+gYCAgH59fnp9eX6AeH13fHl8eYd3iniKeomChoWGf4h/iIOJg4SGhYqFjHiFfIR+f358fHuEfIB4h3iAeYF+ioaKh39/h32Jfn96jHeIjH+QfY1/jXqMdop7hIOIhIl/g36BfYR8gHt9eHt+gICCeoR/gHp/fIB2hXuBen9/foB/fn+Af4CAgICAgICAgICAgICAgICAgICAgICAgYhrd1abY4VtcXl9hYqJi4mFgXp8dH+Zh4V+hHyEgYKAhX+Cg4WFfYl9gn+EgIl2ineEe39+fIiBdoN8gYF/hH6AgIKAe32AfX59f3+BfoJ+fH5+fYJ9foGDfYB+fX+Ce4F5gIGAhH+CeYB+fH95fH2FfIR/f4OCgod/eIOBg4Z/gIGBg4KBgX2FfoV8gH6CfYh+iYKGg42FjYaHhIGEfoKEg4GFgYOLg4aFfYJ9foB8gYCChIOEg4iEh4N+fXp+fX9/f4GIgoSAf4GGhImFhYiDhISDgICDf4F/fn6Cf4J/hX2ChICGjISKiIaFh4eEiISKgoeAgnx/f3+Cf32Afn+CgIeDh4eEgoGHfomDg3+EfoWAg3+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4OGi4KKe32Dho6DiHyCgoCCgIR+gIOPgIeEhoiMiImMgo2CiYCGh4B+gXyHf4mLjIqJgod9hXmHfoWAiHSHeIaBhYWIiYmCiHmAfn95gXl/f4CCgIWDhoaHg4GBgH+FfoOBeoOFiIyHgoF+fH2Ceot+joiJgoZ1i3qAlXuDe5J6fnhveYB5gHOJc4Z6hXqMd36AgICAgICAgH5+fnp7e3h7e3deOF5ncpuAkJGEmW2FhHeHgYOOg5GAi3qGf4R7e3R9fn+AgIiAhXyLdYh3e3p5e3uAgoGCgYCAdoF9fnl+fIJ9gXyDfoCCfIOEg4V+gH+Af4CAf4J+gX97fHp9f4B7gHt8g3mGe4V7f31+e4p7hXyDfYV6hHuHgYeFh4aHhYOFgIV8f3l4gX1/fHx0gHeBe4B8ioGGfoN+hYKHf4WAg4aEh4SGj4x9inaQgYeEhnl/eoCAgICAgIF9gn6DfIB8gH1+en97hH6DeIJ9g3qEfYV6f31/f35/foF/f39/f4CAgICAgICAgICAgICAgICAgICAgICAgIB/h4uXjIWLaoZwiYiIhI+Gj4h7iXeJgYKFiIaDiISCgoN+hICHdoV+iIGIfIF9gXh8fnmAg3qGeYGAgISBgoV8hoGDfoOBgYJ9foF7hYKBgHyCfIB8fHx9fIR5fnyAfIB/e352f397gHd/fIF7gXyFgICDfICBgYOBeX2Bg4iEgYSBg4N7hniAe39/fn6If5GCh4eEi4eNjYuMh4CDgYKCg36EgYmNi4mHe4Z8hH6AgICEhIiFiYeEioWGg4F5g3qBg4KHhoiFhoaEioKJhYaAhH+AhH6Ff4R8g3yGgIeBiYOFgYaCh4eDiYGHgoSDhH+FgYSDhoKHf4SBhHmBgIJ/g4KCg4GBh3+HfYOBg4GDfIWCg4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDh4WNf4l9fYCFfoJ/gn+FfoZ9hXyNgYeGgImFh4WBgYCFhH+JhoWDhXqIeYyGjY2Mg4mAhXmDe4R+hHd7enuEgYKDg4V9gnuDfIF2e3x3f3iBfYiAiIWDiX+GgoaChIV9foCCin+LgoeJh4CEfIB6goSFgH12dHqBnIGDg4iKf4J7eX59gnyQgoJ9g3mJe4SAgICAgICAgICAgICAgICAe3xdUFhZboCChoF7eXt4kH+Cf357fIKBg4iFiIR8hHh+eH2Bfot8in+Lg4eCgH55fX98f4J8in2IfIF9fYJ4e3t8gIF+gn2Hgn6GgICDgH2AfYF/gH+AfXx8en57fHqAdoR4hniFeoV7gHmDfIZ9h3yFf4eBiYCGhoWGg4mDiYGGfX99ent+fn1/eoN+h3mBdIR4gXuIdoeAhIONfI97dn99eYB5hX18f3x8g3eGgHGBeYCAgICAgICAgICAgICAgIB/fXx6enx7fHx6fHx9fXx9fX9+f36AgICAgICAf4CAgICAgICAgICAgICAgICAgICAgICAgICGiIOJiXyKdYV9gYV6kHCEeoh/koGDh3eHg4CDhoCKhYWChn6IdoKDg3uDgIB+hHKLh39/e3h6e39/hYGEgoF3f4d7f3t+f4V+gXl5fH98hXyCfYB/fnyDfIJ9f31+fX97eHl4d4F5g3p8fn2DhoKDf3p/eX6CfIB5fniAe4R+g398e4Z+gn19fYJ8hH2NfY6AiYSDhomGhoyIkYCHgIJ/g36GgYiHjIaKgIZ/hoCGiYKHh4aLhY2AiYKHgoJ+fXt8g4CDhYaJiYh+hYCEg4KAgICAh4KIg4WEiIWKh4qIi4iHhoSGg4F8gHx+gISAhX2GgYuAi32HfIaAh3+EgYWBhIGHhIiChICEgIWDhn2IeIOFhIKAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIqNhZV+f3qAgYZ9gn6HgIaDhYeFiIODf3+KfY1+h4SEhoKAh4aGhHl/eoCBhYOJfIt7i3+Ff4eAgoJ9hH6BfoGBgIR8h32FgH9+eHx7fnx/f4KDh4OBfIN/f4aAh4mBhYF8g32DiYSHiH+FgYF7f31+gnqHcHh5goWKgoN+f3uDfYZxfXiDeol6inuEeYGAgICAgICAgICAgICAgICAgICAgFlWZGJ4e3mFeneLgIaGe4N3fn95g4yEiYGBg4F3dnJ7coR7iH2FiYmJh4WChIODgIF7gXmBfXuDf4GCfod4hH2FgYZ/hX9+foB9gXx+fX2BfoB/gXyDfYJ7fXyAeoR5hnqGe4Z8hH6EgIR/iYKEiYKGiIOAg36EfoB9gXuAgH5+fnx8fHyDeoZ9hIKLhoqNe4SVgoiHeYiIjYyMe4B+gYaKhYx/j3yIhYl9gnCFdICAgICAgICAgICAgICAgICAgICAgICAgHt7fH16fX1+fX+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOHgXp/eIN5gI57nnd+dH6Eho5/g4N5i359gH+FhYqJjHyGfIaChnmFf4d6hXCEgJCLiX99fn56fn+Cg3t9foSDfoaAf4N/goB+goCDgYOEg32Cf4KLf4KAfoGAfn95e3J8dYB6gHuAeXx7f4OAgnl7fnqDfH94gXeAen5+e3t9fYCBhHuCeoSBi4SMho2FiIZ/iIOHgYZ8hIODh4WBh4CGhImCioGHg4F/fYR9iYWJiYiMhYmCh4aJfYiBgYF+g36BgYSEiYKBf3+AgIKBg4ODh4OFhoSGi4SHg4SFh4WFioSJhoeDioGIhId+hoKFgop/i4CKfYaBhICEg4OEgIGBgoGJg4GFfYZ9hoSAfYV/hHyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAh5OBjX6DfYF9hn6Ff4N7gXiBeoB+hH+MhIiLhIt8ioOIiIl/h4B5gnqEgoOCgId/hX6CfIF9g36Eg4d8iH2GfIV7gX1+g3+HgIKBfIKBg4OCg4GEf4OCd4J9gY2BhoV6h32EjXuHfnuFf4CCeoF7g4GIgIZ1d3yAg4eAg32DfoSGhn+FeYV5hXaFgICAgICAgICAgICAgICAgICAgICAgICAbmFvdHSHfmeBboOXgoOBfIJzgoWPioiOfYGEf4J9fYR7foN1gYeEjYOIgYCDgIGAfnWAeoV8h3qEdoF2hnuDfn18f4J/gnx8fXp+eYF/gIOAf4GHfIJ7f318gYSDiYGFfoaBgn+DfoCEgYd9g32Bh4B/gn+AgH2AfHh6g31/e4B2hHeDfIV+h32Ig318g4OMjIKEfYd/joSJgIGJi3+MiYiDgnSYdpyLjHOGdYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfYF3eXJ6eYyMjZaHjId5e39/gYmDhoh+hICKgIqEhX+Feod9gHyAe4N8f3p+fYCCg4Z/hX9zfnqAgX6DgHiEeoWBhot9g356fHx6g32GeYR6gH6EgYSCgH+CfoR7gn2CfX2Aen98gHd+en17eoF4goB5hIF/hH6AfoB5eXp8eYV6i3qMgoGHh4yHjouLh4Z9g36Bfn5+gISBhYZ+ioiEiYWBg36BhICEgIN/iIGFiIiFhIaCh3+EfYKAg4iBhYGBhIKIiomJhYSDgIOBgYKCg4OEf4J/hoGFgoSFhIiChYWEh4iCioGJhId/ioGMgYp9hn6EgYaAhoKGf4iBiIOGgoeFiHyCf4N9h4eIfYV+g4KAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJWCkn+Ke3yCg36HgIKChnaJe4eBg4eJiIWFe394gYOEioGHf456i3+IiISNgod9g36BfX57fn1/foKAg36EfIGBe4N5gnyCgoKCen98gX2FgIOCgoB/fHiCfYaEgIR7f3yCj4iHiHaEf36LeX6EeYaChId/gnl4e4J+g4KEfYl5fXmLfIR4hHeDgICAgICAgICAgICAgICAgICAgICAgICAe317eHt9gF1xdXiIhoeBfnKGaXtpgXuKhYiChXx6fYWBfnx/d4J5hoGHhIKFfoV9gXx+eYR4jH2FfX53fXp9hnx/f3yEf4h9f392d3d9eYB6f3mJe4Z9eoV7f4d+goWEg4mCgYOAgn9+fn58foB+f4N4hHmGfIaDfXp/f4J9f4V9h32CgH+EgYeHf4V5gYB8foJ6g3p/foJ+jIWCh3uMioiSfnd3aXeHhHqAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAf4x6fn+Adn6AfIKHho2KiIJ0iYWKhISChH2Dd4eEiICDdoF7hHyFfIKDgX5/eIR6hoKDhH12eXt4gXqEeXN5dnx7fYKChn9/eoJ8hnuFfYV7f3uAe4B8f3+DhIaGgoWCh36Cenx+d3h3fXd9eH59e3l5eX1+goOAgYeAgICCf4x+kX+Gh32HgoeBh4KIhYR8fHt7f39+hISCh4GAhYaHi4iAiHyIgIiBiISKi4qEiYmIhYmBhIB/f399goWCiYGDf4SAh4OIiYaGhoSEhoOFf4aEgoWDg4SAg4CCgX+HfYiEgYSChYKFhoaBh3+HgIeAhICGf4h/iYKHf4OAhoKFg4GBg3yGiH5+fn+Cf4GEgoGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICIk4WTgIR/f36Lgn2Cj4GRhoWGfIWDgoKBfXx/gYaAjoGNgZCDio19jXmKgIZ9f359foJ8h36Hg4WDf315d3qBfYZ/gX9+g39+e3p5eXl+g3+KgYJ/gH+DgYGCfn6Df4GEgYt/h3qGfomMh3uFa4yGhYuDiYJ7foB8fnuAfIN8hn6GeIF1hYCAgICAgICAgICAgICAgICAgICAgICAgICAgIB9foFueG5tfXN3eol3kGqWYIFuc3hyg32Hi3+Kgn2EgXyKeYV4fHmCfoOFfIqCiH2Fe4Ryh3mEh358fXh+g4J+fnh+eX6Ce4p5fnmAeoR4gXuJfIN8dnp+foiChHyAg4WGfIp7hYV9fn99gHx/fnt5fHd8eXyGe4B4fn2BgoKKjoCHfX98eYGCg4aLfop3iIh/i3mBen98hXuEd3t5go6FlniMeId+hniAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJCKa4eIgod7fnyDgYSBioB6fIN9iIOBi32Ce4KAf4F+e4B6fH54fX2AgHuAdXtyfIN/hnx6gX6AfoV+fX51eXt8foZ3h3aFeXyDf4aKf4h5gneEd4V7gHt/fYV/hYCBfoF6g3qEd356fHd/dX13eXZ7dX11fXaBe4J+hICDhIqFiYp+in+GgIN7gX6EgIN+gYGAgISCiIiLi4uGhoKKgox9h32DgYCEfoeChYaFiYKLf4uDh4mEgIV9gYeBhYaAhYuDiYWGiYWKiYiAh3+GfoJ+gICCgICBfYN+h36Jg4iDg4OBhYGHhomBhICEgISChIOCgIR+hYOEhYSAhICFhYaEhXmHgomIg4CBf3+If32Ce4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH+OgI57fYOMf4F9jYOGjHyGfoCGfYmCgYaGhIKJgI2EjoSOgIV0gHl/gIV+hISAgYN8hXaEf4CFfX92eXiBfoSAhH+BgX2CfoGCeYN3hX6FhoGHhIGCfYJ6gnuAfX2Ae4J8hH57fXuLf4BycG5/e42Cg4J7f4J/gHuEfoaBgH6HeIaAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHlndnp1fn1zhYODl4mWk4GEcoFuf3l2k3qAgW6KhYicgouBfX1/e4GCgH9+g3WRc454foJ8hn98gHeEg3+Ce315fHqEgIiAf318gICBgIGGgIV9fXaCen9/g4V/i36LeoZ/ho6HfoR8gYZ8hH58hnV9h3mIgYCDgIZ/gYd7iYSOhIF+e3uAfoGGfIOAgoSDlYp/ioCLiYaCiX2Kcox0foV+g4J8gn+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHx0dW6Ge4R9gn2BgIZ+iXqEdoV7goF9g3uGgIKGfYB9dH+AfoB9e4B5gnZ/enl3dH96f3x7hXmGgn2FdYl7enl4fIKFioSIfnx5fnyIfo59hXyFfYV8gXmAeYB/gX2CfYSDhIGIgoKCf4GDg397eXR6dXx0fnJ+dYB8gn2BfIGAf4N3gHt/fXt8enx8gH2Ff4mDh4iGhoOJhYiJhYCEfICAf4GAhX+IgImChoSDg4GCfn6EgYWEfoCEfY2ChISEhoyJi4yBiYKKgod/g36AfH6Bf3+BhICIf4iDhoaIiIaGhYaBhYCFf4eAiYGIgYeBiIOJgoJ+f4OAhoJ+goGEgoiAhX+DgoSEhoWEhIWEhoGFe4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH2KgIp9f3yCfIqCh4Z1h3qEi4WFh4WJgoh9in2IeYR5hnuIeIN8fH58gYJ8h4SFhYV4enRwfnSEeX97fnyBgIKCgoGBfn55f3mEfYaCg4KAhXeIi4KIgYOBgYOBgn6AfX96fIZ5hHeCe4J8f3V8d4J/fn2CeoJ9gniFfX99hXqJfIKAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH50eYB2gndif32GnIGIg4KFeIV3dYpvkXmEbndja4WHm5GRi4V+kXaSjICFf25+aXaHdYh7f396f3V+g3+GfIB6fn56iYGIh36BfX2BgX6Ne4N2hXSEeXiEe4l5hn+DfoWDh4mCgoCEeYx7golzhIF/i4GIf4F7fX59fZF8hIaDhISChICEgoB/eHp9dYJ9goR9gn6CjIR+f3x6fW+Ad395dYJ+gH+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAe398fneDdoF8gn2DeoR8jX2EfYd8iHd9dnR9fX2FgYCBeoZ2joKBgHh3d3h8fYF9goB/g352gXh9hXmMfYN9e3t5fHx7f3+Ifoh3gniHf4mGhIaKhIODgoCFfYF8hICGg4aDhISDh4GCgIJ+iHuSgox/gnuBe4B9gnyFfIWBgYCCeX95fH58gX6AgX6ChIGJhIyBg4aAhn6EfoaEh4KCgYKBg4OEiYeHioaMgYyCh4CCfn2Ee4J7hH6Jf4yEhIeGhoiHg4Z9hIGAgIF/gIB+gnyEfYR/iIKNhomIg4eFh4aHhIeAhn+Hf4d/hoCEg4OCh4CIg4WFg4SHgIl9iH6Gf4OEgXqCgYOBgoODg4SAhoGCe4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICLgYmDhYKDhn+KhoN6e4CDfYh9h3uGe4V5g32BgHx+gH+AfoGEgYOEf4N8hYOGgoR0en90gnaEe4B+f4CAfoF8gHp+eYJ5gnqDfIN/hH+FeHdziH+IgIGAgIGAgoCBfn2Ad4N7hH9/gH5/gYB/gIB8gXaFeX54iHqFeHx5g3yFgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgYR/gXxYgId5jIGShH+Dd4B8fJh9g4F+gIF8fm5ign+WjpeMjXSIjo2LinN5d3OLfn+HeYt6hX98gIKDiYOEf4NzgHyGhI+Cin+BgIqJjIaEgIl/iHeDdX1/fIKAeoR/g4qGhIWGiYmKf4N5eYp5hn+BfYd4gnN7fYuFgYGDgYSBfod8iH2BhXmEeoR6eHx+eoB9hIGEfIJ/g4t2iIiDb4CAgH+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH+CgIGCfn2RfXp+gHyFfICBhYWEhYmFhYiDgnSBdop/jH2QcYh3hoGJj356fXqBeIJ7hn2CjX12fnl7iH6Dg4CEfYJ5eYB4gXqEfoeBgn+GfYZ+gYGGhoCMgoiKg4mChoZ+iISGhol9jYGIiYp9jYGKgo2EjX2Kdoh4g3p/eIF9hn6EeX99fn5+f4GAg36Gg4iFioeLgYZ9hH2Cf4CAgYOEg4SChIaDiYSFg4ODfoGBgYOBgoSHhoiDhIWFiImHgoiEiISIgIWCg4R/hH6Ef4d+iYGIgoaCh4SGhISEgoWEhIOGgYWAhX+GgIeChoGHg4iAhHyFgYqDioSGgIR9gn2CgYGDgX55g3l+e4GDgYN+fn5/eoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIt/hYKFgoB/gYJ+gH9/en99fn1/fH1+e4N9gX6AgIKAgYGAgn6AfIB7gYCAgHl8eIR5hX6HgYGCf39+foB6gXmCfIZ/goGDg4WCgoODf4F7g32EgIKCf4KAf35+fn+CgYGCgYJ/foJ8gXuBeoF2hnuCeIR6hoCEfXx9gn2GgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXNbb4V2iXyJfYN6e26DdYqCf4GAgICAgHdndHd7hIGHgYCFhJCEjICDiYGAkXKSeImBhYh+gn92hn2Mh396eHx9dod1ioaKgJF5mIWUhomBhHqBeXx+gnx+eXiCdo15hYOBhoeCf35/foqAg4F6hIaFh4SDf3+BgYGChH+FfIN7goKEiYaJioKGfn6Cg4ODgoaChoWGfoZ4goiEd4B8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB9hX2EgHl0gYCLiXmChXyHe4N6gXuAhX+MfZCAjH2AeX17fn5/dn98gH6GjIp6hnqDeIJ/fnp+jYF0d351iXh6g3qDfn2DeIh8fICAgYN/hH+KgoKEf4eFgYF9hIOKhIqFgYl+h4iEg4GAfYR/jYV/i4GKgol+h3qGd4N7gXp9eX54gX9+gYF+gX+CgIOBgoF/gYN/g4GCgYGBf4F/goCDgYWChIOGgYmChoSDhIWBf39/f4GAgYKEhISEhYSEhYWGg4SFhIWCg4OCg4WEhoSHg4eEiISDhIOGgoqEiIOHgIWChX+FfoeAhYGCgYWAhYCGgYeBhYKDgYKCgoiCg4R7hH6BhICCf36Dg4R+gn9/gYCCgoGBdoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICCg4GCgoGCfn1+fHmAe35+gYGCf4KFgn+EgIN/hIKDgYJ/g36Afn19d4F5g3x7gIODhIOHg31/fXx9eoJ6hX+BgoCBf35/f4KAgoCCgoSCg4GEgYGAf4CBgIF+gHyBfIF9gXuCeoJ8gnyBe4N8g3qEfIN9gH+FgH9+goCFgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHpodH15hoGEh3mAhXyJen17f4CAgICAgHp2e3Z5eICHe3x+fnuEfX2GgZVxjXSAgIGBg4SIhIF9f3SEgoOIfX93c3Z5enyBe313fIN9jH2Gfnx8gIB9eYJ3hXOFd4l7fnp5foh/hX2AgoaFfYR7gYKJgYuBiYKEgYWChYOBgH6EfYd/iIGCin+EjoCDfoCAfYp+j4SOfYKIfYaBcH19gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfoR6hnuBfYF3iHp4en12inyCgIaBgIGAfnyAfHt+e36AfYB9g31/dn96fX58gYJ9gnyBdoJ6fn2AgIB2e4J9hn53e352hnWGfn+BfXyAeYd5hXyEf4KAf36LfYaAfoWGgoqCe4B9f41+hn+BhoSLh4x7i3+GgIV7hHmCd4N7hHyBe3t4fH5+gXqDfn+AgX6CfoF+f31/fYJ5gnqDe4R8hH+GfIl9hICEgoWEg4WCg4GDf4ODgIJ+gn+EgIaCg4OHgIaBgoCEgIOBhIKEg4WEhISFg4eFhIaChISFgIZ+iH+If4eCh4GEgYGAg4SCg4J/goGEfoqBh4WGgoaEiIaJgYR6gH9+hHuBd353gHh/eIN7gHyBgX99dICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYB+fHl8fXh7dYR8gn6Cf36BhHqBfYB+gX+CfoR5gXx9fXt7foB+gH97fYF+g3+Cf359gHqDe4KAg39/fYJ8gX1/f4GAgoGBhIKChoCEf4F9fn5+f4N9g32DfYJ7g3qCe4F6gHmDd4J4gXyDgIF9hXWBeX16gn2EgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH9zent/g399e4R+gYV/hYR+goCAgICAgICAem2BfYKCgoZ7hn5/gHp/dX52eIB6fX5/gYCBg4CBf2x+gYSIg4d7e3d4dHpze3d7dIN2iH2AfX18gniDd36Cfn+Ie4d6gXd/dX95gHp/fYB+gXqEeX96gXuHfoeDgYGHfYl8hHqFfIKEgIl9hHmHjoiEgoJ/eX52gXuAh3+HfYV4dHl3fn+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH6Be4Z8hXyBgHyKhoJ7gn+IiIF/hICGiIOAgnx/e4J/hXiBfIF7hHiDgH59eIB3fX52hHx+fH17fX59fnd8f3yDg4GEfH+CgoeEhHiAgICFfYt8hYN9h4KBhYCJg4KDe4eFjIOLgoSCiImLhIt6i32Ig4Z+goSBf354fnp/fn99gX+Af35+fX59gX59f359hH6CfX58gHmCeYR6hHuEfYN/hIGHg4eCg4KCgoOCgoCFfoN/gYCDg4eFhIeFh4aGhISHhYeFgIaAh4KHgoiAh4CIg4eEhoOEgYODh4OHf4OAgn+Bg4GFgoKGhYeDhoWFh4B+hX6HfIV+h4aEgISEhYKKfIeAgIR6hHqEd4J8fH+CfYN+f4KChn6Dd4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB/cYR6gHyEgYSBgX5/gX6Bf39/fn58fX9+gH58fYF7gXt+e4J5f3p+e316gn6CgH+Ag36DfYKBf4J+gH9/gH58e398hH5/f35/fnyAe4J+gX2AfYF/gn6CeoJ5hHeDe4F9fnyBfH98iXuEe4R4h3uEgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH6CeHyGd4mDe4N4gHh5e4iBhYCAgICAgICAeWt6fHmAgIGJf4d5h3mMeH5/eYJ9eYB5fX5+goOBgnF5fH+AiISRe4t/foJ7d3x3goCEhoB+fX59hX2ChXaCeH+Ne4d4f3t7fH17f3qBeH56gHqGe4F9hH2Cgn5/hXqOeYV+hIKBhnaMc4R/e4F9hIeAjYKJg390gH2Ahn+OfYWCc4Z0eXh7e4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHuHe4R5hXiDgHd+gYN/fn99hoGGf4GAg4OBgn2FfId7hH2DeoN7fXx+f3+EgoGFeYBzeoJ4fXp7eoB4hH16fH1+gn6Bf3+Af35/gIB9fn+BgoyDf4V2hIKEh4aEjX2JgIOCgoKBhIKEgISGgoSBfYV8gn+CgIeGgoN6gX2DgIN9gnyBf4F7fH19fnx9d356gHuCen96gXiGeIV8hH2GfIJ9g36FfoV+hH6Ff4SAgoKHhYiEhoOEhYSDgX+Bf4KAg4OBh4CFgIV/hn+Hf4WAgn+BgISBhoOGg4WChIOAg4CEfYN/gIKDhIKEg4SEhYSGh4qAhn6Gf4OAg4SEgIOAg3t+en2CfoV+g36Cg4F/fX2CgYSDgoOAhXqBeYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB7dH98gH6BgIaEgoCEgYKDf399f3x7fXx+f319fIF9gnl+fYB/gH5/fX+Ag4KAgICAhICFgX1+e3p8enx5fnp9d4B7f31+fIB6f3yAfYB8gH2AfoB7gnyCfIJ8gYGDgIF+gHmCd4J4h3x9eYN7hYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgX6HgHiWXpSYfY13gnt4foGAhoKEgICAgICAfHF+eX14gXqCe3yIdXB7dn6Efn55fHGAdYB3eXt2eXt6fHx4gXqCeoSBiIGGd314dnx5g356gXuAfoR6gXd7f4KMi4GPfomAgYJ+fYGBhH+IfYWIf4CAfYF9fn19hIWCjIaNgo2Ai3aHdX6Pd4Z9eoJ9hX6HhoR5gnuDhIiLjoGMdoR9gHl6eXp+e397f3t+gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB7h3uFeISBgIN+fXp9fYCBfoF/h4GDgIWAgYR/hXyEfH5/f316e3WBdHx4e3x+fn59e3d+doN6ent4foCAfX15fHt9f32De3x8fX5+foF5gHt8gIGDfXx9eoV7goB9gH99h36CfoN9gnqIfoF+hICFg4SFgYKDhYKGgIF9f32AfoB8fnx9gHuBeYF6fn19fH97fH59fn55gneGe4B9gX6EfYJ6gHqEeIR3hHqGfoSBhIOFg4eCh4KCgIJ/goGDgoGEgIV+hIGEgoJ+gX9/gn6Cf4KCgIGEg4OEgYWDhoWHhIeChYZ/gHx+f36CgYWChYOGgYR+gX6CfoN/g4KEfoN7fX10fHKAd4N6g3mCeoR4hHeAd4J8god9hH+Bc4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB9eIB6g4GFe4ODhH6Af4GBf3yBfIB8fH56fnqAe398gH97fnx8fH9+gH+Afn9+fH56gHx+fHt5fnmAeYF8fn2AfYKAf36AfYJ8gXt+fIB+gH6AfIB8g3mCeYF6f3p+fYN7f32Fe359gXp8eoB8foCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgoGEfnpxVnmafJV8f4FwhIaAhn+EgICAgICAgX+BfXt7dnh5eoCDhHR5dXaAd4B1gXZ+dX12enV4dXp6en10e3h6eH19f398f3eDcn55c353fn1/f317e4B5gH2AfoJ9gX+Fh4aHgIOEhXuBf3+MfoB9eX59fn19hXiIeIl9goZ6in2BeYWLiYiGdoZ3g3uBgYB/eX18fYOGg3+JeI2Bi35/fnp9e315fnl9eX17foCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH6CeoN4hXuDg3qAgH+Ce4B6fX2Af4N9gn+CgISBf4B+fn17fHp7fnqAfn6Afnt2end3en16fHl+e3l8eXl4enx7fn16eXx5fnuEe3t5e3p8e4d8gXp2gYCAgXuHeYd7f3yBeIR6gXyDeoJ7h3yFf4F/hYCEg4OCh4OBg4KAgX6BfXyAe4B7fX16fnuBfX18enl+eH54eXd9eH56gXyBen95gXiCeIB6f3yBfYF+f36AfX96f3iBdoR5g32Eg4eEg4aBiH+Jf4V+gYJ/g4GCgIOBhIGEg4OGf4SDhoCEgIJ+g4CDfoJ/g4CGf4OAgH1/eX9/f4CCgIF/gnqCfX98f3x/fH1/e4F5gniBd4J4hnuCeod4iHx/foOFeoR/gn+IeICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH98gXyAfIJ+gX6BfYB/gH18fHp+e31+fXx+e3x8enp5eXp5e3t+e317fXt9e357fXt+e396gXyBfH97fHp/en95fniAe4B7gnmAeX96f3uAe356gnuCfIB9f3x+fYB6gX2Be397fXp/eoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBfn5oaGSPeY97gHVwdn+Ahn+FgICAgICAgICCf4KEfHt1eHh7e3d5fXV/c39xgnGBcH1yd3V4eHZ9dXl4c39tfGd8an9uf3SBdntueG55c351gXWAdIJ1fXF/c4J1fXR6c312f3x8fH15gHmKfYF8dXl9e4F8h4SHi3+PeIp1iHqGe4SAjYOKfYF9fYF9gX2Af3qBeXuKe398cYB9gIWBgIGDfX19f35+fn59fn1/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHyGeoF/gHyAeHx4f3uAfIJ8fnp8fIV6fn6Cf4OAfX9+fX97f3t6d3p4e357gHiCgXtxeXx3fHd9eXh7d318fHx7fXp6eHx1gXaDeH15eXh+fYaBh3p5fnh9g3qJe4Z/fX6Cf4V/gX6He4J/gYKEgIZ+hn6CgICBhYCDgIV9gH+Cf4B6en17fn59fH98fHt3e3mBd4F4fHiBdYJ2gXmCeIF6fn19e397f32Ae317f3mAeIF4gXmEe4R/hIJ/gYCBfIF7gHx9gH1/foCCgYGBgH6Cf4N+hHyCeIF8g3uCgH19fH17fnl+en19eoF+gX9+e3x/e4F9gn2AfXp9gH6AfX56f3eDeYJ6hXqDfISAhYCGfIOCe4KAf4J9gX97h3WIe4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH57f3uAfH+Af31/fn+BfXx7fnt9fHp7enx+e316e3l8eHx5fXt8enx6fnp/e4F9gH1/fYB8gHx/eoF7fHyBfH98gHuBeX95gXmBe316fnqAeoB5gXt/fH18f3p+fYF/gXuCfX56fnx6gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB4fXaCgoWDg5Rwj4mCiIKGgICAgICAgIB/f3+CgYF8fHx3eXh3fneDc4J5g3mCeYB0eXF4cXVzd29+bH9mgWV/anlueXF9cIRtgmh5ZnxogWiCaIFrf3J8eYB4gHaBdX12e3h+eIB1g3uFf319f3eDen2BgYJ+hnmGeYV7f35/fH5/fIB5hHqCf4J/goJ+g3h9f4OIh3+Fc4B9hIKDgYGDfoF8gHx9fX1/f35+foCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB+gnqFfn2AgICAgIB/hXyIf3x8gnuBeH55foB2goV9gn18foR/f3l/foCAfH6EeX58f31/d4B4eoJ1gHuBe4B/e319fX99fnh8dn58fn56gniAeIB0gXh+fX58fHp/eoB8g4B6eX93hH2FfoJ7fnuCfoR+g32Gf4R+fnuCfYR/hX6DfYZ8h4CGfoV+gnqBe4F8fX58e358fHt+fX57f3x/foR5gXmBe4N6f3p+enx9enp8d4F3gXiDe4N8gnyCeoN5f3eBeH57fnt+e3x5end8eX57gnp/fXx8f32Afnx+fH16eXt4fHl8d3x6gXt+en15fnp/fX5+e3t+en95fnqBeYR8g4B/fX97gnuAfHp6hXuBfIJ9g36Cfn6FgYWLfYZ0fHaAfYKEeIl7gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH99fXx5f3iBen98f3yAfHp7fnt7e3t4e3l6fX57fXl8e359fX19fH59gHuAfH58fn19fH19gH2Bf4B+fnyCe4F+gH6BfoF/gYGAfn18gXmAeX57gHiAdX50gXV/dX93g3mCeIJ8foB4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIKDgYOBdo9oipWAjIKHg4KAgICAgICAgICFfoF6fnd4eHp6gnuFf39/g3yBf4V8gHV6cHZteG2AbYdyhHl7eHp1e3J7doR6gXl9dX5ygXGDdH97fIB5f4F8h3uBeYN3fHh7en99goCBg4GAhX1/e4B5foF5hHeCeXyBeH98fH6Ed4J5f31+gX2FgIZ9g3yBgIZ6jIODfIJ8gIJ9hH6Ff3+Ef4F/f3p/f35/fYB/gICAgICAgICAgICAgICAgICAgICAgICAgHyGeoV6hXyCfoCAgICAgIB7iH2BfIF5hneBeX59fHx1eId6e3l8en9+gHqDeH9/eICAfYF5fXmBe4KFdIF4fX13gHmAe3x8enyAfH97eYF4gIN7f3yAeIWBeYd1gH19gH1/eYR2f3SAcoF1hHmCfIN6hXmCe4F9g32DfYB7gXuBfoKBhIGEfoV9hnyCfYCAfH59fn1+fX59en92fHt+fX58gnh8doJ4g3iBeYB5gHh/e3t6gHh/e4J6g3d/eX14fneAeIB4f3eBdYBzf3h6eIB3gHd7d4B2gnd/d356fX18fX98f3qAfX1+fHt/eX15fnqAeYB8gXqAeX54f3l/eIJ5gnqFe4R/f4B/fIB7gnqBdoB3hHuBf4J+hHqFd314fnqKeomAe4B9hn2MeICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfIF4gXx/fX56f3x7fHt7fHt8fnt+f3t9eXx7f318e3p8fnqBeX94f3l+e358fnt6e396gHyBfX59f36Af359fXx+foB9fn1/e4B7g3uDe4B5g3mFe4B9gH6Afn9/gYB/gH2DfX94fXqAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB9bHVkeKN5hYGAh4OFhYKCgIB/gIGNe4d2hHN8bnlwfniBeIB4gXqBfICCgIOBeH1zdnZ+foOBfH54eXp2fHJ7dn2Aeoh6iX6Fg4KCgniDd398eIN3iHeEeIF5enZ4dXx1gHWBdIB2hnqAf3yFdYN9fHp3f3eCeXx3eXiBgYCDfnx9fXmFfIZ/gX2CfX9+fYOAfYN7g4SEhIOCgnyAgIKAf357fH5/fn9+gICAgICAgICAgICAgICAgICAgICAf4J9hHqGe4R7g32Af4GAgICAgIB8iXp/eIR3iXh+gHd+ent8eItyem5+cHZ5dIN+h3eEd4F/fYJ7fn5+h3aHc4R9f4R8g4B8gX5/fnuDeoN/dYN0g4KDg32DhnuHdn5+e4B8fnx/eYZ0f3aDd4V6g3qDeIR8hH2AfX19gnuCfYJ9goB/f4J/f4CAgYGCgYF+gHx9fHp9d358fXx+fH58enh8eIF5gXaCdYF3f3h/fH59g3uCeH94g3iCd4N4hXd8doR3g3WCc4JzgHSCdIB2fnR+eH53fnZ6eX1/f3yBe3Z6dXh9d396f3h/eXt4fnuAeYJ4fnt+e4N7f36AfH16fHh9eYF7f32EfYZ6gnqBeoJ6g3mCeYJ7gHt8e4F8hX2EeIVxfXGFe4WBfH6FgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAe4p7fX1+fIB8fX16fHt9fXt7e3t9fX99fXx8fnx9fH57gH2BfX9+f31/ent8fXl+en57fnp+fH15fH1+fIB7f3l/eIB5f3l/eIB3gXp/e4F5g3x/f35/f39/f35+gIJ+hHuBf4B6foCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcHFxd5CIhoh4g4p+h4KBgIGAgHqPeY91g3CAb39weHR9d4B7fX2Ae3x9eIF+hYF+dXt5f3t/fnqAdX9zf3l3gXCGboN2gn2CiICAgXN7d3x7eoZ3hHN/dHtvfWZ5Y3xif2N/aYBuf3d6fXCAcnyCdIFvgXB+dHtxfW9+d3h9gX9/hXWGeYiDgYR6gXeDenx+eH17g36KgIiGg4KAf4J+hYCCfHx+fH99gH6AfoF7hHuCfYCAgICAgICAgICAf4N+hH6Df4R/gn+BfoGAgH6DeYZ1inWCdYR5g393e3t4fXZ8fYl5g3mAeW98bHp7eHt8eoGBg4OBfoV0iHiAgXx/fYKCe4N4g3x/gHyFfniBcXp6dYF6f3yCd3x2fHWBd4B5fnmCfIOAgHqDeYN7gnyAfoF+gH5/en55gnqCe4J8gnyAfX98fXt+fX5/fX98fn17fnt9fHx6fHt/eXx4fnZ+dYB3f3t/e4B8f3x9fX17hH2Ce4R5hXqGeIR6hXeBeHp4f3iDeIJ2gHd/e3x8gHuBd3p4fXV9d3p7eYJ8f3l3e3qDdoF5e3iDdIB0fnN8d397fHmAe4h7gXmAfH9+fnx/fXx9fX6Ce4Z6gniDfIV9hoGCf4R+gnh/dn99gX2Ffod/g32EgHuBf4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAhYyBgXp6fHx9en13fnt9fX18e3x7fHt+fH17fnp+en57fHx8fX18f3yCe3p9e35+fn59fXuCeIJ2fnl8e4F7gHmAeX98f3yCeoN5gnd+eoB+hIB/fX+Af4J9gIOBgIV7g32CfYJ7gIGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB/enx5hXuRiIOGfoqChYF8gYN8iHaVfYuAhHqDeHt4cXx0gX17gXWCc3x1d3R6dnx1eHF2cHZye3J8cHxzd3NwcG1vcW53bnxxh3l5d3l0dnR6d4R4iHiDd350hWt/ZH5jfmh8bnp1fHd6eGl5cHiHeYp7goJ9gnp+fX19gHN6g3p7dHpzc4J/gIx8hXuAe3pzfndsfHl8f3uNe4Z8fYN0iXyDg39+fn98f3uCeoJ7g3yCfYB9goCAgICAgICAgIN/hH+CgIGBgn+Df4GAgH2GdId3g3mDdoN1f3x6gX1+gXt8fIJ/i3uBfGp8cXeCc4F4cX57hH+IgYJ4fH57fXp/fnqBd397fH54g3l/fXR5enOAdX93eXh9c310fnR/dH91f3aAeIF0g3mBd4F4f3aAd4B3fnd/dYB3fnl/eoF6fnh9d354f3iAenx7d3l7en14fHh7eHp2enV7dnx4fXh/en15e3l+en18fHt8eX57gnmBeYF4gHmBe4N5gn1/eX9zg3WCeYN5gnp+fIB7f316fnp+fHqBeHt5fHiAeX15fXOFeHx4f3l+fH56gHiAeHh6fn2EfYV8gH9+f317fnqEeX54e3p+f4N8gXuCen58fn+Bf4J+gnqEen53f35+iH+NhYeFg3p6hoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAh4eIiH9/enh7enp2e318en17fX55fXl6fXp7fnp/e3x9e318fX1+fn99fnp7fXt8en18gH2GeIF8eX95fYJ6gnmBeH56gHyEfIN8gnh9eXt8f3+BfoB7fH19gYGEgYR7gn6Af3l9gIGIiYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB+fX14hGmMioaRiIaIiYSAgYdvkW6XeYV7gnyAeHV0b3FzbYJrhm6CcH1temh9Z31pd2t2bXRxd3d7e3d3eHF5bXVocml5bn52gHh7d3tvfWZ3a39whHODcn92hHuCfH+Cdo1vj3SKfIZ9gW1+cn2HgoKQdpN6joCHgYZ8fHt4g3Z5eX17ant3fJJ/hnyAeYBzgm9ra3Zsf2+JdIV4d3Vzbnx5gHx+fH58f3yAfIF8gn6BfoJ/gYCBgIKAgIF/f4F/hX6DfYF+gn+Cf4SAgH2He4tzg3h/f4SCgINyh3mCi317eIJ+i32AeWtxd3SJeHhzeXV2ent6gHiAdYJ0fnl5eXZ1eHZ5e359g3x7dnd0fnN/dXx2fHZ+bYFvfW6AbYFvf3R9eH95fnh/eIB1gnWBd3x4fnd/dn92enl8fH97fXh+d3p3e3h8dXlyeXF8dH11fHR9c3t0e3R7dXp1fHaAdX5ze3N7dHd5eXx+eXx3fnV/dX92gHh+fIN9f32BeoJ4e3p/d395fXd+c4B0fHp7f319f36FfHZ/doOCf356gHyBfH96fnx/fnt9fH55gHp8e36AgoWCgIB/f4V6h3uKeoR6f3t9foKAhHyBe356gnaFeoWAhnyDeoF3g3SAd3p+gH2HeIKAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB/gIWGfnt7e3h6eXt8enx8ent7e3t5e3h7e35+fX14e3p7fnmBfYF+fX96fnl+eX97eH6DfIKBcYB+fYV6gXt/fn97gXmDfYCAg32BfH59foCBhoOEfoB8f39+f4F9goOCgoWBgIKDhoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB+g3V0fFiCjH+Rg32MgXqOY49clm6Hc352gXp+eXp5dXB8b4Z1gHp+en14fnOBdH52f3F9cntzeXN5d3p3fnZ9dXxzem14bXp1enx7eoB5hHB6aXhnfWmAbn50f3d/eHqCa4NvhHeEf4h9hnKBcn6EfXyDcoB9f4F+gn1+eId6gX14fXx1dGp5c4h8h3qFdIhvgmdzZnVlfGuAboNndmJ6ZXxldGd4cXh7fXx+fYB+gX2AfoN9gn6BfYJ9gn2Be4F8hH6Bf4N9gXyDfYR9g3yFgJB+hn54gH+GfYF6dn5+iHuDe4N5hniBboFneWt6c356fXF4bHZwfnOBdn95e3d6c3x0eHV3dX15g3h+dXx1fXV9dHxvfm2BbIJtf2+Ac4FzfXR5c3xze3R9dYF2g3iAeXx9fn6Af357eXd8dn52fXl9fHl7fHd/dHp2e3d7dnt2e3V7dX1zfXF8coBtfG9+cYJzfXKAdHp2f3d/eoB1g3V/dYF6fnp6eH13f3h/fYB8fHSBcoJ0f3qAeoN9fXx9eIF2gnqBe313fHd+gIKAgoKAgoF/g3yCfXiCe4N7gH5+e3x+eoJ7gHuAe4V+i36IgYGAgnx/eoN9gX5/fn97hXeJe3x/hXqHd4Z2iXeHfnh/fnyKeYeAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB+fX97hYV7fnl7enh9d3x+foB+f3p4eXd9en1+f32AfHl7eXZ9fX+CgH+BfIF/gn1+eH2GgHt3fHCDdYR7f3uAe4F7g4GBgX5/hICGf4F9gHx/fYF+gn2BgX6HfYSCgISAf4GDgoSGfICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB1jW5/V2BOf1iTUWpNi1mgYopsgHJ8dHt2gnp/gHuBfHmAfHx/e4B4fnx8e3yAfH+AgH6Bfnx+en90gHV9f3x9d3d1fHN8cXdubm90cnxzf3d7dHdte2l7bnpwe3CAb3tzbnVydnZ7e4F6gHN6enqCfnx9c3t8doVxhnGGc4h6fXd8dINrfWZ8aIBuiG6Ib4tujF5vV3JqdWl7bH95eHl5eHNxeXB1bnRkdGx0d317f3uCfoGBgnyCfoJ/gX6CgYGAgX2CfYN6g3mGeIFxgHqCg42KhIZ4jXuIfIKCf4R6hnSGcYJsiHCEdoJ7gHh4doBub3WAenl0f3OBdnx1e3R8dH10eXJ7b35wgnKAdH16fHh/dIBzg26BcYNyf3R+dX15d317fIN3gHd8eH96fYB5gXp+fH58fX55fXV+d353end6c3d0enV+dnl5ent9fHt6e3h+doFzgXJ8dX52fnN4eXx7fXeCdnp2fXZ/eIJ4hXiBfIB+fHp6dXh3fHZ7dn94gnh/eYF6eHl5fH17fXWAdH90f3Z/eIB6hHh9fnuDgoKCfoF+g36Bfnp+eXx9e318fHqAfH9/fYCAgYWAiICEgIOAhH6Ee398gX+BhICEh4CGfnqBgIKJgoeAiYCAgXl2gXePgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAf4F+hnl4gHd8eHyAen55fHh3eHZ6eH56fXp9fIB9gHKAe4OBg359fHx8fHl6e3mBeIJ4gnZ+en98fnqBfIB8gn1+f4N/hoKGgYSAgn6Afn6Fg32EfoF9gYCHgoWAgYCBg32KdICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAdpVwinKBbH5cg12IXn9fjnCJeX95fXt6gX5+gn92fnh9dXx/cnhzbn13eHV/eoJ/hniFeYV8hXeFdIZwg3N+fH59e3h4fHZ9dXRzc2d4Z39ufXN8dnt4fHd4e3J7eXyCf399c35xf3V6enZ2eHh5fH17f3J6dnV9b4pxg3WCd4Nxf26BbIVqhWN8YYFegmSEaYh0jHqEcXdvZnt9fXx3dHR+aIdtg2p2aXFue3JyZ3lsdXN+dnd9gYGEgX2Chnx/eYJ5hHmCeIJ5hXmEdX9xgnp/gIGKhYl5fYGBgXqEeoZ3kXGFbIRsh3h9f3+Bf3x9fneCdnl6eX92gXN/c3tyfHR8dXt1eHJ5cX5yf3J6c3R4end/dX5yf3CCeYB6fn15gHh+c355fYV+g3x6fX19e3x4eH90g3OCc4F0fnh9e3x6fHh+dXx1ent/f3t9gHqBe359fnmCdoZ1g3R+c4B0f3V6eH13gHeBd3x5e3p+eH95gHh/dn91gHR+cXlxeXB5cn52gXZ9d3x3enN9cYBxg3KBc350fHV+eIB6hH19fHZ+fYGAgX9+fn5/fH16eXl9fH17fnuBf3+CfYCDeol5iX2If4WFhIiHgoR7gn58f3uDhoKKgHuAf4OFiIONiouHg310jXaNgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfX58iXl2fXl8f3uGd394fnp6fHd7e3t9enx5fXp3eHZ3fHiAd4F4fnx7fnx4f3mBeoJ8gX1+fIJ4hHmDeIJ2hXWAeIN8gn2GfoWAgoGBg3l8hICMgoKDgn+Fg4OJgIh9g4CCd4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAf5d2jHSFcIVwhneFd393iX2Df4F+fH92e3p9gX50fXZ5dXV4g3aAaHludHh0dXt2e3d6dnt2gHGCbH9sfnJ6e3p/eHp5enl2eXF1eWqAb3t3d3x8e39/eodyiHWFe4Z+i3uLdI1uh3x+hHl6eXl6e3t3eHVweGyCc4Z3fXR9cYRug2+AbIVsh2uCbINthW6EbIBzhICAhnN1ZIFxhIKBf3p9gn2Lf4V/fnN0eIVwjYN+dXl8d3pxe3R+dX14hXqEeIR5hXqDeYB8gXyDgICAgH9/fn2AgIF9gIB+g4CEgYd5l3aIcot6g4J3g3uFfIF8c313dXWAdoB4g3SAcnxzenx5fnqAe35+eYR4gXd4d3N2eXR8d3x5e3l/eH53eHhxeHJ0bnN1eH92fHR4c3p1e3B8cYBvhHKEc4F3fHl5d3x3f3iBeHx5eXt6fXl8enx9e3x4fXWAdIV0g3ODcoNzgXR+dn94gHmAeXp3e3d9d310gHN/cn1wf2+Abn5ufm59b39xgXKAcIBtgWuEbINvgXOBcoNwhGyDb4R1hnqAeHp3fHt8fX96fn1/f317e3p+en55fnx+fn15gXiIdo54in+GgoOChYSNg4t9hnZ6cnp0gXyFfH98f36BeYN5hoCJdotyloCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB6jHh4dHt3g3mGeX93enZ1fHR2f3ODdIF1fnZ7d3x3fn6BfIN5gHx+fYF6gXmCeYN4gniAeoN+hYCFeYd4g3mAe354gXqAgICDf4R+gYF6fn6Ag3yBgYZ5iX2Ff4CDhXuGeYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfpN1mW+CcIdwhXCBc4B4gXx/gHyCeX12dnV6eX5xeXJ7fH13g2aHbn95eX11eG10a3Nxcnl0fXZ9dHlyeXR5eneBdHx0c3lxdnR1fHiCf3d/eIF+g36Gd4VwhXKKeI15jXSIbIFxfIB6inx+fnl8fHl6cX5rgWuDb4NugXB9b39weHeBeYV3gHl+dn93gHuBgICAfoCAfYF6gG1vdX58f4CBfXx5eIZ4h36GeIZ1eod9f4F3f4GBfn2AdoBwgm+DdYN3hHt/fYCAgICAgICAgIB9fn9/f4CAgIR8i3WAcJF2jXqHhYuBhIN/hXp8fXaAdIJ1fnaAdn15hXmGeYB4dHt1f3aDeIN/f4N+gXx4eHNyd3J1cnVwdnV9b3ZzdXFub3Judmp1b3lte3B6c3txf3N9d3l2gHaEeX14fHZ8c39xgnOBdX13eHp3eXh5enh8dnt2enZ7dX91gnOCcYJwf3B9coB3g3qDdoJzgHGCcIJxhnKEbYBogGmAan1pfGt5bHtufm9/bIFogWiCaoBsgG2AaoFsh3GJcIZwhHGAcntweXF6c3x2fHZ7eHp7enh5c3lzd3R5dH1zgHKIeI1+h4GDhIeHh4qOiY6GjXuEc4NwgXiDfIF/fYGDdI10fW+JbI1wjICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfoR2hnZ5c4B0hniIeX91fnRycm9vhW+FcX5zfHF9bYNyeXJ4d4B3fnd/fIB8gXqBeYRzhHOBcYFxf3OKeIh6hXqEeoN3hHaAe357f3WAd4Z8f4F+gnyCfX9+fH59f4Z7hXmAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH6GdqB0nHOCcoJzhXaAdX17eX58fXp8en97fnV+eH19e3h8eIJ3gmt/eHyDeYNyfWx7a3NycXZ2eH15fXZ2d3d5e3aAdoF2bnRuc3RxdXZ1eXR5dXl6gHyDd31ye3h7enp3enNzdW94bYF0hHp7d312f3SAc4Nxg3CCcYV0fHZ8d392fGV5cH2Bf36BfYJ+gX2BeYN3g3iDdYN1gnF7ZXFodXF9dXlxe215b3xyd2B5dIh2eG56b31sfnCGdYB5f3uCeoR5g32AfIKAgICAgICAgICAgICAgICAfJFvlG+Gd4d9jmuMbo19iIB9c4VpjGqHb394f3uCeoB5hHiGeH51d3d0eHN6eH1+fH97fXp4dnhyeHBzbHZsd2x1fHqBdINxe3l2eHJ3cXx0gHJ7cnZzdXZzdnF4eXh9eHp1enV3d3p3gHl/ent6eHh4d3l5e3x8f3l9eXt7eIB3hHaGdYd0hXGEcoV1hHiEeIlzi3CLb4lwi2+JcIdxgnCAcIFyf3J+bn9tgnCCcIRthmuEaYNpg2mCaIFnhGqFboVsgG18bXlseWt4b3Zzd3J4dHh4d3V1cHhuenB8cn90gniFfIZ/gn+AgoGFh4aOh5WElYKRfop6eIB4goODen6HgZB0f3eHfIOAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHyAeYtxinR9cntzgXWGdYRzhHN4aXluh3GHbIJneG2AeHl6dmyBboNvg2+BaXlugW+FcYtziXGDaYJghGeMb4Z2gnWDcYZuinKDb4NwhnCGdIV1gHd8fH+Af4OBg32CfnuAdoGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIKIfJ99nn9+gYd+hHyEen16cH94gn58eHp3eXh1dnt+f4B5f3uCgXB/f3+Hf4OAg4B8gHd+eHh5fH99gn97gHqDgH6DeoJ3dHV0cHlvd3h3gniEfISAhIR/hHmDc4NwiGx8bXhseWx9an9seW97bn5ug3CEcoJ1fHh7f32BfXt7e316fHZ/cnh0eXmAeoJ5gXiCeIN4g3aEdIJ0f3V8dHt2bHl/cXZ8d3V3dHp0e3R7cXdyfWx+a31sf3J8dHV4fHmGeId5gHeDfIKAgICAgICAgICAgICBkW2EbIx8iIGIeoaFi5CmcoZ9gnGTco56iXyBf351fniBdoN1gniFdoJ2gXV5cnVyeHd/eIByfnB+cX5xf3J3dHt2fHh7h3aHcoZ1hH+Ff4B+e4J6g3qAdXZycHJvdXB6dH11fXd+dn90gHZ/e4F9gH19fHl6eXx9fIB8gnuDeoR9hICDhH+IfIh6h3qGeoR3g3aCd4d4i3aKdod1h3WEeIB5fnl/fIF+gX6Cf4Z9hnuFe4h4inWHcodvhm+EbYFugWt/a39ufnB9bn1re2x8cHtxfnKBdYB1fnR9cn5xfW+AbINthXGIdYl4h3uEeIN1iHmPg5aKmYqVjY2Le393eYF3gGeLcZF6g3uDgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAe4V6g3GFaIxqi26CZn1jgGWGaYlqimaAW35ih2iKcoFzdnJ5b3VpgmmIaYZqiGuGY4FhhGOGaYhthmmEa4Jog2eDaYJphG+Hbolxi3CGaoprjG+Mdot9hHN9cIF4gHyAe3x/goSFfIWAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAi6CCooB8fouBiIaEi3uIcoJ+foN3f299cH10dXd1d4R3h3t/gXWCgoSEhYGHgYh9hHl+eIF4hXyIf497lniVho6Og4mBgH5/fIN9fId0h3SJeoeDfYt2i3aHeYF1im9+bXJxdG59a4BpfGyDboFxgXKEeIJ9fYF8gH6AgXl+en57fYCAf3x7e3d/d4F3hHaCdoN2gneDdoJ3gXd/d3p5a32KeYJ3dX5/eIByfXV7dn1wenSBdX10enZ6dHdtfnOEeIN8gHyCgICAgICAgICAgICAfIlzjXWDdn93fH6IfIWBgX+djJ9pkHWPgomJi4eHgIV9g32De4R1hXiKfYd+gHt7enV2fHaGd4lzhnmCeIV6gnt6gXyCfYZ5dXF1cn13f3mCeIF3fnh+eoF7gniAc4JxgnKCeIJ4hnqHeYt0jnKPdo94jX+Ng4mCg3+Hfop9jHuKfIt+i3+NgoyFioWFgoaAhoGEhICFfod9iH+Jg4mFiIeGiYOHgYiBiYGKgYuDjYeOiYyHh4iEjISNg4mBiH+HfIR5gXiBeYF6gXuBdoF1fnN9dH11fXh9eH55f3iCeoR7g3mCcHpreWqBbIRwhnSIc4hxinOLe42GkIuOj4uLiXx9cYF5hH+Jh4yDjn6If3+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHmFcYpmi2GNZolmiWqGaYZohV+KX5BoimaHY4NjhmuHcoRqdWR3Y4Jhh2WJZYloimmGaIRphWeEZ4NkhWKFZIRkhGqDbYJqgmWCZodpg2t9a4BrhG+Hdoh5gnSGbYpqjHCIeYKHfIV8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAkKiTpYKHeYl+hYh9i3mGfH2HeI53jnGJcX95dnx4f4GCgoZ4gX2BhIKEgISBhICDgnuGdoZ3hnqLeIpxiXSNgJKMlI+PiYeEhICDdH9reHN3fnWGdYl0h3aBd313gnZ9dHF1bnV5d352f3WEeoF9gH5/gHyDeYZ8hH9+fX97fn2AgICAgIB+gniEeIJ4hnSDeIJ4f3qCfIJ9gH9/fn16aHWAg3uFe36Dd4lyhm1vfn97c3qAeoB7f3l/fnd/gX19gYGAgICAgICAgICAgIBtgW6EbIdsi3d4d3l3e3iDeYJ8iXSMdJd4moiCk36XjJWQlYuShY5+iISDhYWHhIqEgId2hnWAgHqJgIeIg4+AlH+ZgZZ8inuBd3hzeXx3enp7e3p6dnt0end/eoJ6hHeJdI5wjm6QdY92kHeSd5R3lnWWc5Z1lXmTfpGEkIaMg4uCi4CKfox9jXyRf5SCkoWRg5GBkIGRgo6Gi4iJh4uGkISVhZqHmoibh5uFmYKYgpmEm4mZjZSJkIWQiJGMlIqTiZCJj4iMhYeChoKGhISEgoGAgH2CfYJ+gYCChIKIgoeDhoKHg4SCgH5/fHp+c39xfnGAcoB4fXmAc4JwhHeGe4l+jX6NeIB9gXuEeIt8jYOHhYOBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfoF6gXeCd4B1gGWPU5RkjmmIb4dzgm2AbIttimiHaIRogmd/a3tudnN2dXhwel1+X4Vgh1+HZYdlgmSAYoBkgGiAaIFggF6BYX9ggGR+aHxrgGKBYXpndm14b3xyfHV9e3t9f3aFboxyjXqOgYSKeoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICPk5Scgot/g358e3x6fnWLd5d0mHaPeX58d3t3gHiAeHt5eHt6f3+EgoSHg4l/h3iBcnpzd3B1cG1reWiAeoF+iIaNjYmRfX9yam1uandrf22FbYNugm9+cH1wfnF7cHJuc3N1eHZ8eIB5hHiHdoV1gXV+cH91fXh/fYB7gICAgH+Be4R9hH6GeYZ8iH2CgICAgICAgICAgIB+gHWBY4B1f3x/foCJg4eEiH56c4VmdHiDg4R9hH+HfH9+gn+DfX9+fYKBgIB2hmyFZ4xlfW19eH55f3x4dnlzfXKDeIB9hXqNf46Jjo1zj3mbgqiLpoiXd4ZyjXeReJF5jnqKeYhygXN+eX+BhYCTfZt8oH6jgp+FmYmNgn16jIOKhYyDiYKDf4V8hHmGe416lHWXcJdxmHScdpt1mnabdp12nXaYcZd0mHqYeZR/j4KNhYqDioGMfJB6lXiceJ2AmYWWhZOBk3yUfpWFlYmTh5KDknuUeZuCoImijJ6LnIadhKCHoYygjZuJloeTiJSKl4qZipmIl4iYh5aHlYeTiZKJkIiLiISJgoWCgoaBh4aIiYqJiYuLi42Jj4WQhouIhYqCiH2FgIN7hHiJa4xigWyCb4l2jHqHd315f3uAhH+Lg4aDg4iAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB6g3iEdYZ0g1aKQ4FHgVWAbIF8f3mDdYV2gWuCa4hziHWDdH1xeXB0c3BucGl0anpqgV6FYIlhiWCIZYZrf3J7cn5ygnOGcYduh2iGa4Rvg3R/cn9tgm6CcH5tfHR+eX93fnR9enmCe4KBd4V7g3+JfIeAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJakkKF9i3R+cn10f3aIeZF8lICKfX1zd3Rwe3F3dXB6b39vg3CDdoB8f358eXl1d3B6anlkfGRta25he2d1cXp4gH6PeINsdml3Z3lnf2iBa4Jug3GCcYNwgW18bHZtdHFzdnB8cYFxhHCDcX5xd3N2c4FzfIB+fYCAgICAgH+DfoN7hnmHeIV7hH6BgICAgICAgICAgIGEe3h5bX94gYB/gICIhIt+g4yGfIh8gHdweXt4h32Cf4CAgH2Fe4J3fnp/eYZ1hX1+gYOMd4J7gICCfoF/g4CGgYZ5gnaCgIqFkXSeeJ51l3ycf6iCsIarhZV5l3WbeJV7lnuZfZh7lXyXfJx5onSjdaJ6oHyYiIuJjIGYjY+MmImViJiImY2Xi5aIloWag52AoXmjdqN3o3aidaJ5nXqdepx5nHuZf5p9mHiTd5N/kYWNiI+Gk4OYgJl8lniSepOBlIaUhI99i3iNfZCFk4uVi42Af3eFfY6HlZCalJqQloaLfo+FlY2WjpOHkoKPf5GBkYKShZWLlo+WjpeLk4qOi4uNiY6Fj4KNgYqAh4CHgImBjYKPgY6Cjn+Lf4mBi4SSgJd6kXaJc4RziXaWbZh5iHSJcodyhG96dHZ4dHt2gnmLf42Eg4SAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAf3+DgX+CeoN3g3SFbIxLnjeKSYBabl5rbW9weW6LbotmhWmEaoZvhnOCdH5yeHV2a3RjdGV4ZYRqjGuQZpFpkGqLcIB1eHJ3b3lyfnSGd416j3eLdIVwfmZ9Z4NriGuGY4BmgGuCcYN2g3qEen99eoB5g4OCfYKBgoOAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAmqiPonSGboFoend7hIiEi4OHfoJzfnR1eHtwhGuGa4ppjmiNa41xi2+HboJsgGqFXoVdhWBtTYVMf2N6XoJieW98cXp3d299bn5wgXGCdoV7inyMeox4inSDcn1zeHR1dHR6dXx3gHl9fXl/dn53f32AgnyEeoCAgIB/g36DfYV4iHSLeYR9gYCAgICAgICAgICAgICAg4F1bXh1gXuDhISEhZF6hXCKcH14g3t8c3twf3iGaotsh3CGdIRzf3mGgoaLgIx9jn2QfY2Aj4KQgo6AjX+Pf497kniWeaB9pnikeaZ5pHyhf6ODqYGyhLKCqHuhgqSGoIKggJ5+onqleqh5qHmleqKAqYWsg6KDl4SRjJeSoI6ciZmNmZKajp2LoomkiKOKoYWhgqJ+oX2gf6CCnoGdgZ+AnoGXe5l+kICUgZSKi4qGhoeDjIGRgI9/iHmKd457j4KLiH9/fXqCf4WGi4mGhn9/fX+AgIaHi4yPlYeRfIeAgouFkI6RkYqLg4KFgIyCioSMhZSJj4uLiIiHh4mCiX2HfIZ4h3GGbIdoiGSHaIFtjGuOaItoiGqGbIJyh3GOa5FqjWmKa4JugHCEcpJqj2WIboFseW9wc25zbHpxgnaJfZCDioaGhYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYF/gn6DeYV3hHGMRa5LmVqBXn5YfVd2UH1FgkGHRIJIeVB1WnJldG94cX1vfWJ9VXtVe1F5V3xlhHKOdZJ4jHiCbXxXfk15UXVac2l2coRvjG6NZIxaiV2HW4NZhVt+ZXtseXB9c4B6gIB/gX1+eXt6fH2EfYJ7gIOAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAkqOnsZOce4pvc3Nxf4GMjI6PiY1+g3h6fHl1i2uQbZBsjmuQbpFwjmqHaoVpiWGMV49ai1N+S4pcdmFub4pwgW2Cbn92fnd+fIF9hH2GgYeChoWHiYyJkoOPgYJ9eXt2fnl8c310gHt/gX2Fe4Z/hICCgH6AgICAgIB7h3+Fe413jHqIfIZ8hICAgICAgICAgICAgICAgXt9d3JoeH5yf3SDdoaRj4OSdYZ7goCCZpFdjV2YW4pke2x5cHx5fXyEfId/hYSEhoGJg4iEioSPg5GBj4KRgZR/mYCeg6SFp4KohKuDqIGkhaSEp4epiKyLqYmpi6eLqIiphquArHyqd6t1qHOjb6B7o4Ofg6WBoIScj56QnIufi6SJo4mijZ+NpIqkiKCGmoibhKB8n3adepuAm4SehJ+AmIORfo6DjoSPgJCAi46KhYeGg36Leot8hn16en50hYF8iXuDgH+Fgn+Kc4t6hYGAgH96fXSAen15hHeHfX+Ae4V4gYF3iHeCenuBeoR+gYKEfIiBfoV9gH6FeYhviG6Ea4ZnhmWIYYlhhWGKXYJlkGKQYI1YjViJWoVXflp9YYNmiGaGZ3xqd3Bzc4FfhGZ/aX5xeHFzcG50cHt0g3iIgImKjY2DhoGBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAeoV9iHeNdYdqlUepW5JrgXN1dHdoflqDRYpCizqMPYVJe1RzXXBibmNtZHBkdFiDVINIgkF7RXJRbFtwZHJ0eHSFWYlJhVB8Vnlcd1x2W3tghl2NXIxhiWGFYX5jemp1dXN6d3p5eXh7coNxiXiGe4J7gHeBcYBzfYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICWoKqnopqGgX11enOGepSKkZh/iHx5fnN4h3aad5F1jm2LcY1yiG+NaYhnimCQX5FfmGGMX3xrbnFqZ3lqf3V8c3p4eXt6fX99hn6Ef4J5f3VygnKRh5OPiISBdoJzf3Z5cHpufnWCfIR9gn6BfX6AgICAgH+BfIR3hneOdpZ6hX+FfIGAgoCEgIKAgICAgICAgICAgICFdYBrgIN/gXuLfIGAgoyahpJ+g4CHfZdapVyRaHx2boBmimmObop3g4eGiYeFiIOLg4uFioeNi5CNk46Yi5qInoelhq2HsImuiKyHp4mpi6yBrYKvhbWJtIi0hrSGs4Syf7F4r3Otb6lupnWefJaBmYKjfpl9m4SXhJ6NsI2tiKaFnouai6GHpISkgKSBn32bd5pzlnGVd5p+m36ge55znXicfJ19moWahpd8kIOWf4+JgoKIbId3g4Z/gYJ3f3qDhIiIh32Ie3qSeot/f4N7hXqEfIJ/f3x7fnt9fnOAdIN0fnl+h31/f3WAeIF+g4aDg3uEdIdxf3CEdoVyiXGFb4NuhmqKZ49mjGOOZIxhkGKTYZddnGSWZI1hh1+GYoVjgWl6dHd4enh5bn1nh3KDe4SBf4N5f3d8eH18fHp+h4CUhpKIhIB+hIKAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAeI5qmGeYWolinYaLk4qXhJF+g396gWiVTJ9Qk1CJU4FZeWRwcW95dnd+Z31gdmR7XY9Zjk6GUXtgbm92dHpye2WUV5ddhWN3ZHRocmx4bH9sgm+Ed4N7hXuFeIJ5fX92iHONeYh7g3WDbopskHqKe4x2inSFcYdzhIGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApZmkmo2GfHZ4cHx4ipGEknt7a29wfH2Rgod7iX+Rf4mChHeKdYZwiG2QZ4lqm3aNfHqGZYdjfoNyfm5+a3dzboR5hIGBhXuDen96eHJmcl96dYqFiX2Pc493hHp4cX5sg3SHe4Z9g3l/fH+AgIB9hHyDfIN9hXuUeY1/g3t+f4J8gn6GgISBgYCAgICAgICAgYCBdYFzeox6iYSLkn2SiYuVl42EkHmTabBwoX6JjnebaKNip2KmYpt1kIuTkJSIkoSTgpWBm4ecj5uSno+iiKZ/rHuxeLd2tXKzdbZ+tIW3gbZ7snexdbV1s3axfLR/sn+yfax4qnSidJt6mICXjKOPqYighJ+Lo4uoi6mOr4OmhaWJpoSjf553nX2Xfpd/lHuUeZJ4mXeaeJZ5mHqbeZ12n3aieqKAp4Sif6B9o4Ghg52Bk4iNc4hxjHyJeIt2j4GTdpZ1mHeTfY+Dj36PdY5zjXGNcpB3kHiKfIN8hXOHcYp2iHqKeYx6i3mIdYN6gn2FgoSIf4h8iHmKe4p4i3eJbYxshW+Edo10knOXbZhtkXSOdJZ1nnOgcJlwknKLc4lziHqIhYyNiomFf39+goaAi4GKgYeChYt+knmRc5BrkmyMf4+HkoOKhYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH6FcahVs1GlXIx/d6CIqJOnj5yDkYiCkHmhXrNloGuLc393dH1qfnCIc42AhYt5i3KAdYt2lWuMcHR5ZHxvfn9+iHWRdYx4f3x1fnGBcIB1f3qGfo99mX2igaKInYadfp9yo3Cje5+Emn6TcZBukHuQeZZ0mneOe4J6gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICKip6biohzempteXqEmH2MaXZqant/gYaDioWGhIV7iHqLe4N6g3uOfY9+j4qFl3eUbX55f4ODiHuIe29/XINukIWTh5CEkoCTd4xogV52dW59dXCBZoxyjoCDdn9pgXKIfIl+hHp/f4GBgYN+hH+BgIB/i3ehgoGDg3qEd4F4f3qDe4Z+gn6BgICAgICAg4F7fHR5dIp6i4B7g3uEkIKKkm6XlImkjricnKyFt3O7bsNvx2vCdLGJqJernLOVrYupeqxzsniygbGNsoewerJxt3G2cK5wpnShfZ6Ioo2kiqSEpn2leqt9rISwi7CMqoyliKSDpoCnhKeIqoeqjqCZopepkLONuoq8irmHn4eihqSFo4egg56ClYaSiJCIkoWVhJmDnISehJqCm32eeaB3oHife6N9o3uffKB7on+ihZ+JnYSbf5V6lnKPdZVvnm6lead9p3uhep56nXWZb5hsmmubbZxynHaad5h2lXKRb5NzlnqVfJJ6k3aRdY14jXuNfo+BkYGQgo6IiI2Fi4GJgYmDjYSOfYx6kH2XgJuDmouHiZiKl46ZipyJloaGhoKLhoeIh42Gj4eMkYmRiY2IkImFiICKgY+ElISWdZ1jnmWJdISGiZGSiYaAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBykXaVeLhgwVyya3x5WJJ6mZWSm4SYgJiBmH6gfqqCn4WEi3eLc4dwjG6TcpiClZGXmZGQi4aPi5CEjmqJYYtsinaMg5GLk4STeY9zi3KIdYd5hnyKe5R4mXipgquPtIy5grB6pHqqhK2LroeieIx4iniKcoxyiX+EgIF/gXuAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI6Qm6CFiXxthVqPl4OaeHpzXHZzfYCDgoSDh4SEiYCFgYODg4aFioqOh5B9hnZ+e3yAgIKCiYqJlW+VYolzjYGbg6mCsIKufKdumGZ+g3SFe2p3YHZtgH+Ac3pmgW2EeId3gn2DfoeEg4Z/goCAgICCmn+cg3mDh4OBgYF9fnqHfoV7fn6AgYWAgICAhXx7gnaAdYVujWtzcXt2jIN9gHCLjp+ksrG/k8B2wGa9aLVzroCtibCPtJW6mMGOwH28drt2tn+tiK2OrIirgKd6pnmfepZ9kIOShpKQlpeZmJiVnZCjja2LsI2wkLCQrY+uja2Jr4Cue694r3exebR8toS4f7B2qH6khJ+Emoechp2GnIWdg5yClYWSh5SFk4KTgJV/ln+UhZeFloOVgZV/l3+ZgZ6Cn4CfgJ2EnoaejJyQnY2diZyFoX+ld6RzpnaleKV/o4ioiK19rHSpb6Vtom2gcKB4oXyge510m26Ybpd1mHuYfpx7m3mXfZx9l32UgpaEmoWfhaOJopOckpmLloqYjZeQmpCVko6Tj42Wi5aDmoucjZ2Pl5KYhpZ7kXKOeImCiIaOiZKFkISPiIuJho6CmnmWf5R/lYCSfZBylnh+h36IkIiVg4+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH2AfIB7f3qCc4lko2ylfad8voCoinWLV4luhpp9o3yhep97mn+ahpOOkpR9lnmVepN2lnSWeJZ8l4acjaSNpomjhZp7mGyWZ5Roj3SRf5WDln6TepB7jHiEeoN8jXqNd4p3gICAgICAlIWehJZ+kHuPg5iJoYWZg4uCh3yHeoF+gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnaiapol2hk2GloeshYCGXHtvfXZ+fYN+f4F9iIKCgIGAgoKCh4GKgoqBhn6Ae4J/g4GIgpJ+mXKRdop8kXyfdbR4wYTAgbd9onuHiIeDhm14bm10c3t7dnpwdW13f2WGcHGGfoZ7g4d/goCAinh/koWPhneMhoiCgn1/fYCBgYOAfnh8fol8h3qBgICAhYKFgIiKkI1/gX1wjWd4b2KGfpOKr4++frJuo3GadZd8l4SZiJiLnYeihah/qnmpcp52ln+ShZSIlImUhpGBiYJ/hIGFhYeIhomOjZSTkpaSmpChjqSIoYmhh6GInomfhp99oHSbcZl0mXGZdJpznHOadJZ7k36UgpiFj32Re5R7k32SfJN+kH+PfY59i4GKhomEjH2MgoqJjYqPh5OBmICcgp2FnYedhZuDm4SeiJyLm4uYjZuMnoOgfJx7mH6UhIyKjY2Xip+Co3uge516nHefeaCAnoWfg59+n3mhdqB7n32cf514oHOedaJzn3qhfaJ7o3imeKh9qYaqjaiJpYali6WSoYqch6CKoYKfg55/moKZi5eLmYeYe5hykXWHf3+JfZCGi4uKi5KKk4KJgY17onWUcIt2knGUdJJ9iHt5XnNpkH6Yg46AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB9gXWJcIRuhG+IYJxeonWegJWRnJ2SmmyPYH9ygZJ7nYGbfJt+lomPlI2ehqB9nYCYhJZ/k32Rf4mBhoCMgZWCmoWii56CnXGYZY5uh3iJeY57jnqHfoJ+hHuFe4p8iH2FfICAgICAgICAgICAgICAgICAgICAgICNgot+gH1+gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAi5yhtpGQbWNjhnubjISIaXxse3J+eX55fn2AgYR+gYKDg4SBh3eMgI2Ci4SIfIl5iICHfI9yi3aNeJN2knmNb5RxjH2ccqODjoyGjnmBem9+b3l5e3iAeIB5dHlsi32Ih22EfYOBfYWAgH+Bh3iJjoqMjHqQfpCGhYaCgIF/gYOCe3yBe4CBhYGEfoh+i3yGfoSChomAgod8hIKAcFZ8aYeCk4Sdfp18kneIfIN8hnqKeop8jXuOe494ineCen2DeoZ7hX2Ff4x9iXyEeYJ6gn5/gn6AgYOFhYmIjIiNj4mTgJKBkoORgIiDhYSHgIh8iXaJdYd0iH2JcIdviXOMdIt0iXWLeY1+jHWIc4Z0fnh6eoB5gneCd4N6g4KFgIh5hHl8g3qHgISGgod9iXqLfIl7in+PfoqAioWNh4uJiIqEi4mIjoGSfpN7kn+Qi4WThI6DiYiGkYWXhZmFl4GTgJOImY2dip6Fm4CafJZ6knuWepp2l3eVeZF4kn2ZeJx0mnKXdZF8k4KYhJp/m4Gdip2QoI+ghaGApIGefpGAi4eIg4uEjoCQdo9yg39+inuPfI6AiYmQiKSGnISUiJh9qHSZc4aAjYGUhYqMeId9c3NmgHWSfIWAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB3i3SLco1zjG2QX6hwn4SFk4mgkqaGm3WIeniFeIeBjoaWhpeOjZOGmYmWg4yAj4ePio6FjIKFiIKGhIOBhYSFhYKHgZB5k26Icnp8f4B7enx5gnyDgIN8hHuFgHyCeoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICaqqe6fZBVhE+FWm5rV4Nwfm2Ad4F6gHqCfYF9g4CDgIV+hnOEe4d+i4KKfoZ6inuPeId1h3SOcoZ7hHyKdoCAgnuEYZiClpaUk46HjG+Fbn94f3OCdn1+fH6EgYt8hHiCfX6Bf4OAhX2FhXaMhJiDmXuUfouIhoyGgoeCg4OCfX+DgH9/f4CFeot8jnyIe3+AgX+DgYaAfnyBfkaEXouEh4eKfo93g3qEfYBzenN4dnh4eXt7fXmAfIB+gHqFd4t1kHqMeY17iXaIeHx4fnx6eX18gnuBfoGBhoCIhIKFgYOEhICDf36DfX99fX5+hnp/eHl4e3h8cHdwfXGCbYJsg26Hcol1h3eEdXx3dnZweHJ5d3h5enqCeYd9gnyBeoF6hHiFeIN7gnmAeX92fXR+dH13f3aJeYmAioiMgZJ/jH2EfnuBdYl2iXmFf4aKg41+iYWEi4KLhYuKjIyJi4mLjYqLiY+FjoWMhYyIiYmLgpV+koGOgoqBjH6TfpN+kniQfIqAjH+LgoiBhIKHho6HkYWSgY19hXyAe4SCiICBcoF9gXqIb4p0gIZ6kXWRcYBvfHWCg6CDn4uVkpuPtIKjhX+MeY+Ki4KDeoZ+gX14en+GeYKBhICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHyCcZFnlG+DfoaDinuZdLeElIJuhXyDiomFh4V/iHmGeYZ5iXmPhJSBjnyKeox3j3OSeYt+jISOe45+hoOChoSDgYh+kn+Ug459gXx/e3aCdX52en1+goKAg4d7hnyAhH6EgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICKkbPRrsSPn32HfWWHPo1djXmCd395fHiAeYF7gn+CfYZ7gnl/eIJ3gnyCfIN6hXiEeoZzhWyFbod/g3iAhYCAgYF7aXJwiZCYl56Ej3eBe3qCfnGCdoOAg3+DeoN2g3uEgoGDgICBhoSHgXiEeYx5lYKPh5ONjI+BgISBhoGDfoCDgH1/f4KHhIuJjIeJhIOAgn19en9/hH2CiF2IYo92gn18dX1yeHp1fHd8dYBzg3KEb4h1h3yAgH2Af3+Df4SEiH6KfYd/iHyMe393gXaCdYB0f3h9fn9+g32DfoOCgoODgYB+fnyCfYF4fX9/gn5/fn9+eXp4dXd1d3R4cHtwfm+Ac4R2gH16fXh6cnhugHKBdIJxgnKFdoh5iHmGe4V5hniDeYJ3gXl+dH1ygXOCdYB4g3iHeYl7inqKd416jXyFfHt5cXh7doFyfXV8foF/f398f4B/h4OJhYyEiYKAhIGGgoh+hXp/gYGSg4+LhIWBfYOBfoiAhYCBf4WBh3uCen93enx1h3SAe3uCgYiCioSGhX+Ge31/d4l6j3WDcnyCgHqBb3J7aHxug2+FboFugGuHcph6oYaUhZiNso2gjYeJen6Ef4WUb5d1mouIj3aFc4h9foWAgICAgICAgICAgICAgICAgICAgICAgICAgYB3hnaPc5hum3F+eHl7gH+Oj6SSgYdxb49oj3WMhId8jnaKdox5i3iNe5B+kH6Le5V3l3SNf4yBlICOgox/g4WAiH6GfYJ0enJ9eoOBgYeAfn6IfIV6fH9+gISGhoZ7gYB+hICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ6109nZts6NxmjDR5ZjjIaBfYR3fnt9dn54gIGDfoR8gXx9en15fH59f394fnmAeIJygWmCcICAhIGCg3uHeIB4eXVzdX2GjpOIjoCCiIKEgniBdYR/hH2CeIF0gXyCgoGFgYKAhnyHg3aFeoJ9hoONh5SFjpWGjX58g3yFf4OBg36Cf4GEgoKBgIaEjImFhIKCfnx/f4CAhml+ZH5qfHp0f3J6cHtvgXWAeoZ1i3SJc4h4fXh3d3F9en5/fX98gnuFfIN7iX6Ifn92g3WDdYJ4f3p8fH9+hYCFgoV9hXWCdoJ0hHWDd4F8goCEfYN5gnKBcnxzeHF3cHRwdHF4cnl1eXp7eX18hHSBbIBqhG+IcI5uiHF/dYB3g3eBd4F2gHaBdoJ1gnaDcoJxhHKEdIRzhnSHdYZ2iXeIeoV7hHqAeHxuemeFaIZqf3B8coFvgHF+dYF4gnOFdYl3hXJ7a3dyd3l5eXZ2dn2Ch4OGe4F/enp3dXt5e4N5hn6BgHt+eHd+bYdni2N5c3F+eYB/g4mCjYGGh3iHf4t/jH+EfIKGfoBzemeFbHJtdW9+bX5xfXKMaJVdpk+UWIl1lICWgYuCiICAim6HdH50g4mUoIyXi4yNf36OgICAgICAfn6AgICAfn2ChniNcId2g2yDeIF8i3qPe6ODoXWAcHtwg3WMhI2Jf4GFdY11j3qMgYt0nHmPfo9/jYGLhYmBiISGhZSAkoGFgYKKiIWEgH19fnx3enV8dXZybHdqdHN+e4R9e3uJd4h8fn2BdoiBgYF/foOAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICGfIZ/e32MgnyCgICAgIJ+kpG4oduU3Xuse49+ioeKhIN1gIB+eXt3e4B+eYF9gYR/fn97f4B9g397f3mAeIF0hGmAdYCAgICCgn6RfH56fnl4eXt2f3uAhIWLjJKEi3+EdIJ5goF+e3t1fnuAgIGEg4SCioh/h3WGeoN/gn+FgpaAm4mfm46HfXyCd4d/hICFfYWDgn+BgoODg4SEgYODf32CgH59gmZza3Nydn5tg3GBeYB8goB9goN6g3N4cn1veHB3dHZyeHN5c4ByiXaJeol7gYB8e3t7gXqBfH57fHt/e4J6hnmFdIBwgXWAcoZviG+EcYJzgXiDdoZwhm6GcIFwfG1+bHpreGyAa3xtd3F0a4Z0jW+FaoRphm6Hco9xhnB9b3tyfnJ8bYBtfnCAdoJ3g3aIdoZ0hXWGdoZ1hXSEcoNwg3OBdoF3gHV/cX9sgW2EcoJ2fHB9bIRvf2+AcYZuh2yGcIhvhW9/bn5tfmyAcHpxdnd+f359fYCGen92eHp6f32Bg4KAfnx5e3WHc5Fwk21xd2t9eH+EgIiCj4mEin6BgYJ8goGBg4R/g4F3gHyAeW9rcm6Ia4Vpg2ORaZlfv1GgXHlygHOGd4BujICAfHV5eHR0cYV0loSYiZJ/l3eedoV+hXZ9fn97gHGJYI5lhmeMc4N2gmSZVI5chWqKeouKl3x9dIFwgm6NcI9xiXaEdYB0iHeHd4h7kH6Hf4WAh4ODhYKAhX+Ah4WLh4d8gHx6d36CfoJ6gHd1eHp5fnh6dIB1eXR/doF5g3yJe5OAfHyFfIGAf3+BgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfX1/d36Mhm9+hWWAd2+Rinx/hoCFkIV8goiPjpt+kYePiZR5hYOAfoJ1gH2Aen53gIGDf397f3+AgIJ8g3qEdoVzhW+AgICAgICEiIaWgYR6g3d5dnx6gHx9gn2Lf49/i4CHeYN6iHmOf4N2gHeDgYGBg4SIhYp/iHiDe4CAgICAgICAjYefjbCgnYmQdImAiYCGfIWDhn6EgX6GgYGIf4GBgoCBgod4g3Jyd3J6dINyinKDdHB3cnJucIBwiHF/dHx0fXB3b3RtcXJ6dX98goSBhoeEf4Z/gIB6fX1+gXmAe4B8f4R9gn6BeHx4f3d/doR3h3uBeIR2gnOAdod1hXWJdINvgW6DbYJufnKCcYNsf2d7boxzinSFc4d0hXiCeYV5gnh+dnx2fnN/bINtgXKAdoJ1hnGGd4J5gneBeYB5gneCdX90gXOBc4J1f3h+eIJ1hHaEd4B3enWAdYJ0gmqDZoNmh2qFa4huiXGAcoJuhW6Cbn5yenOEdIp0h3aKe4d7fXx8eH93gH6Bf4N6hXqMfpOGkYZ5f3B9d4KFhYeGh4mBioCHh4SCg4KFgIZ4h4GFgIF1e3JremmEa4pojGmOaY6BpIWchnKAfIOAen6AgICAfHh2emp7W4RZi12LY5Bplmqaa4FzgnOGc4doil6Va410hHmAfIJkmnCWfYh0inGIa4lxj3qBe4N6hm+UbpR1jXqFfoJ+hH2Gf4h+hH2CfIJ7g32BgYKDg31/eYN8gn2Bf39/fXiFe4d+g3x7fXl7g3mBeYB/eX+Ed4l1fX6AjIiLf36MgXqBe4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAhH6IdpWCk36DlJF7h1qBeoeChYqHiYeDj3+Pf4eFh4aSgouDh4qJfop0hoCCf394f3yAf398gH2CfoN7hXmHdIZvgHSAgICAgICGjpKWh41+hXeAcX50fHt6gXeBfX9/iH6JfoN+gXOHd4x9hnyCgoGChIOEgYZ/hHyAgICAgICAgICAgICIaqOLqZSUgYuCjH+Kf4iBiHyEfYaEhn2Ef4OBgIN4f397fYNzgneDfIN6gXd7cm5vdm16bYF0hnqDd3xwe3R9dXJ1b3d3fXx4fnWBfYWAgoOAgoaAgIF1d3V2enp8fIB8gXWBcIVwgnR+eoB+hXiLeYV6iHSGdYN0h3SGdoR3h3eFcYhygXOFdYh0iHGKfIqAi4OIhIl9hXqAeoN5gXd+cH5sgWyDb4Rxgm5+bYNtinGEc390g3J/dn56gnuDeoN2h3WGdoZ2gneAeYF7g3yDe397fHh/eH94gHaHc4VzhXOHdoh2h3iDcYJwh3CEboNngGeEboZ2hniIeYd6gnp9d317gXZ/doF3g3mHgImJiYx/gnp9e4OBh4iGhomGi4OHioWCh3uQfIqBgHuFgIZ6f3N0gGd8aoVvj2yNb4ZzgIWJj32AgX99gICAgICAfn18gXOJaohrhWyDb4pqlWCYbINweHeFXZtSlWSDeH2Cf4h9cp5pk3B8b4hyi3qKfIp+j3iCeX55hX2MgYuEhoODfYR9hYCBgYV9h36FgIKBgn2CfIB9hHuFe4J9gH6Afn5+foODhYeBh4OCfXp5fH6AgX96fn6GfoeCgH93gXqChYiLhHyAf4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF/gnqDd4CAgXueiaV6mHWFdXV+e4GJinOSa2x9fX6Kf3yGfo2FjoeRe491jICJgYZ5hHuEf4R8h3eKfYd8h3aHc4J0gICAgICAgICAgICMh4+Kh32OcoJ2dYJtjHOFg3x8fHmBgIeDh3iEdIF9goGCg3+BgICBf4CAgICAgICAgICAgICAgIB9e25+fo2Hg4x9kX2Qg4mDhX6EdoGAgIF/gYWEgoN/inh+f4yEfX+AeYB2f3WAdIJzfXWAc356eHx2enl9fX96d3Rzdnl8gH5/hnCNboZzfXx7dn95fHJ5c3dzgXKGc4V5hHyDe4h8gXx5fH57hX6If4F/jX+KfIN8hn6Ff4R+g3qCeYh2gXSBdoJ3hniJbYdvg3p9goh/i3iCeIF1gnKGbIhqhm2CcYNyhXOEdYR2gnmCdYJzgHV7eHx7gnmFd4N3g3qDeoN4gnZ+dX9ygnR/dnt7e3yBeoR2hHOFdX95gHqFe4N7gnaEdIZzh3KEcodzgHN+d3t1e3OKdIZ3g3mCd313g3J/d3t2hHWHe4eBgoN+hIB/e3x+foWIhZGIko2LlIiDhXmJdIiIhH6EdoN0eXNxh1h+XntlhneCe3uBeoCAgICAgICAgICAgICAf4R6hn6PeYtpklqDYn5lm2uLenx6e3WQY7NrjXF2dHZ2eXF+d6N6lHWBc4N5foGEg4h8h3iIeHx8g36JfYR9gnyGfoOBhICDe4qChoaChHyEhn2FdoJ1gXiAfX55gneAdYF0fHWAeoV+hIR9goZ9foGCf4R7gXmEf4OAfXx9enx+f4WEgoOBfoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB+gYB8gHuCeICAgICAgIZ8mImkiah/qHCehbOfqnuRcJaKiHyCeIp7kImPfIp3i36KgIh6h3qHfYZ5iHGHfId7h3SGcIB6gICAgICAgICAgH6PfoCFi4eZgIaAboZhjnOGknuFcnh4eIR6jXiDfnyAeoJ/gH6AgICAgICAgICAgICAgICAgICAgIB+nHqFgn+GgId7hXyGg4eHhYGGeYSDhX6EgIWEfIZ0k4yCiIOCf3d+eoSAg4WFgIt1gXmCenx3c31xfXd4dX1/fH59gXaDe4N7hYCPgIaFdIRygHx6fXd6eXN+fYSChYh/gXt8e35+fn16d4J5hHiCdIZ0iH2GfoOBf32DfoOAhHuGeId4gXeBcoJygXCIaYpugG97bYJ0inmDcoZvgXKGb5BxiHd/d395gX6AfoN5g3SDd4R3gXd+eH13gXWFd4V5f32DfoZ3iXGBb4BxgnR+c3txfHR/dIl1iXeGe3t5f3l/fIJ5gXiCeYh3hnmCeoN6fn16dHtyfXOCc4F0f3l/en95gXiDeX11jXSHfoKAgYR+hIWBhHeHc3h2fnyEgpCKloyLh4WJf4qKj36AeXZ6anRrgoJ9bnt2fH98gnuAgICAgICCgIaAgYF8gn6EeYZ6iXuPcJppmmuCa3l2jnqBeXt1gHmNgq2HhoN3gXl7g3KBfYiLhY2Gf5J2dHWAdYl4i3yFfX18hX+LgYiAg36Ie4R7f3yEfoWAf3qCd311g3yDg4OCgX1+eH94hHiCeYN4gHaDcYZzgXl8foOCgIGCf4V8h3h7fX19fHt8e3h/gYF9h42AfYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfn5+gXt9fnuAgICAgICAgICAgICAgI59kX6QhZeAqIedfpCHh4mCfXt3hYGKfId2h3qIfol9h3uIfIl5hXCDe4Z2hnWEcYB+gICAgICAgICAgIaHj4WKgJeMnYiXcJFgjXWJm4WSg3uIc4tzhnqFf4R/gX9/f4CAgICAgICAgICAgICAgICAgICAhX6EoIGDg3uGgYR9g32BfYmCi4GGe4SEg4CCe32KbpmAhYVtgoF3iG2Ec4F8en2DiY2Gh31+fXh8bHt9dIRwg3WGfIF/gX6OfX5/g4V/hnaBcH9yenJ5enl1dXV/cYeAgYeCiH+EgXqEgn2CgoOHhYKDeZB4h4KBiYSIg4OHfoR7gHmKfISFfoKHe4h2iG6Nf4x7e3p+doJ3gneGdYhzg3ODeYx/h36Af36Ce39+fYV7jHeBeIB8hHiBdHx0hHaGeIJ5fn5+e4x3iniCeYJ6gnaCdH9zgXCDcol2iX2Een90hHN/dYN3gniCeIx6hHiBe4d/gHmCdIJzh3OCdn57gXqCeIF3fnaCdYBujXCAeX17gnmCfoV/iICIgYJzdHV9dIZ9loeYjpWKjZGLjIR/h39/fXx8eYCAdnt5fYCAgICAgICAgIB7fX2DeoR5hXKFeIF7hHaVdphzmHOGbnpsfnKAa4JigWh7hZKSg4h+hIB7jXKDcIJwgmuGfYh8g3WBdod5iH+He4J3hXuHgIh+h4OFgoeAf36CfYF8gH+EfoF6gXiBeH17h3qDeoN5gnt/fYB8gHyDfIV9fXt4fYB7gXuBgH+LiIR7fn6AfYJ/e315gHqChJOFhoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfoF/f399f3qAgICAgICAgICAgICAgICAgICGhoh7hX+PhoyOkZKQc5l5k3iNfId+g3uEe4N+gnmEeIZ6gnWBeoR1hHeDdoCAgICAgICAgICAgICAhIKOgZB+noqafY5ohnaImJCRlXiTdY18hYCChYOBgn+Bf4CAgICAgICAgICAgICAgICAgIGDfYCOl5CKiHqLf4yDgoN+fId5jIGJh4SEgYN7d32Zg5mGd3p1e4aDkXySgIODcIeFgYKDepJ7iXt1gmyKZ5NojHB/eG+GgoqHiYGDfoR5gW15enh7dHZvgG1/cnZ4anWIeImAh4KKeX92iHeFdn52hHuFfZd2hnR7fX2GhIaKgoZ+gYOGgn55f3uEf49/i4COh419gnd9e4F8gXqKd4qAeoKIfYh6hHqAen53e3WBd399jnmDeH58gXyJd4BuhHN+eIR3f3R9dIt3hXh9foJ6hnqEeH9zhm6Fc4V4hHuEdIVyhnSCdYJ1fniDeIt2hnWGc4FyhHaBfIR4hnmEeoN6hXSGe398g3d/dIF5jXuAdYJ2gXaEe4F8h36FiICHf3J3cIZukXORe6J7oH2SfI5yiICAgICAgICAgICAgICAgICAgICAgIB+f3mFc4hoj2d/aXdojlyWZI92kXiHeoN3g3p8fYmBiXl6b3prh2x/cIFvjH2FfH5+iYGFfoV6iHSFeoF/hn6FfYl6iHeHeYR/hH6FgIaAhX+Df4SAg32DfoR+hn2Ie4F3hHmDd4N4hHp6e4F5gXt9fIB+fHh9c4F0gHV/dnx2f3uBeoF8gXmEfYF6i3qHgIiEjICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB9f4GAfn56gXmAgICAgICAgICAgICAgICAgICAgICAiH6RiJmJqIqld5F8hIKGfYiFhH+AfX9/gHmAdIR6g3yDeIR6hXiBfYCAgICAgICAgICAgICAgICIgoWCe4N8g35rfHSDjpCIjniKd4aEgIN+g4CAfn59gYCAgICAgICAgICAgICAgICJfYWFh4GHfJKIk3yUepWHl46Sf4p3iYGIh4iFhYmAgIWiiJKKd3uAhYOIjI+Sknl9cICFhYt6gnx+f413nHGXdpV1j316cGh3coODdod6g4l1h3OCgn2FeIJ5hHiBeXV3cneJeH55gXiOdod5gX+CgoR9hniFeZR7inh+eWt9f4CJhYiChnuEdopqiGx4fYaEiImFe5V/h4F+gnmDg4iNioWGenyJe4t4iHmAfnx9gXZ/c311h3iLeH94gHyHeol0jnd0d316enuBeot5hX97eYZ4iXeDeoB1iHWDe312h26JdYR4hHeEfIeCgH2FeY53iHqCeYZ4gnx/dYJ5gneAdoF4hHmEe397g3uDdIF4hnyEfYSBf35/e393iXJ8eXl8gXiGb4ttkW2OcZp1mmyWgICAgICAgICAgICAhXB5eW6AdYF7hICAgIB/f3uPapNsjXJ9b4FmlmaTcn6GgoiKi4OLepB8homDfoZ+hnyCh4aCfYeChYOEfoR8hYKFfo16iIOChnyDhX6Lfox+iIGIf4SBgYGEgIh+iX2EfoB+hXuHe4V9hX6KgIR/hn6Ge4J7g3t/eIV7gXiDeYF4gneGd4N4gXaCeIB0g3SAeYZ3iHaCfX98h36FgYB+ioCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICEf4F8f3uAfYB5gICAgICAgICAgICAgICAgICAgICAgICAgICAgIqJioWAhHePen2Cd4iEiYGJfYp/inuFdYZ2iHuHeoV8hHqAgYCAgICAgICAgICAgICAgICAgIWDiYSPg4Nwd3V5gYCBgn57eH6BfoN+gICAgICAgICAgICAgICAgICAgICAgISHeomCjXqWf5SDi4KAfIB/hIKJhIl9iHeJf4yBio+IgHyXh4aAhHeGi3iOcpF/e3xpgl2LXo9mhm15dnyFiYqRipGPhot4fG1uaW6McomAe395e3qBeoWHhImEhImAjHuCen6AhYCDhX+IgIKDeo1vkn6QkYWMioqTio+FiHR1gXd7fn1/iICKe5N7j3t6eXl8goR+b4p+e4KFeoJ8fX2Ie4N5fIWGjY2Gj4V8inqLgYaGeYZyiHWBfX2DeoSEg46GfoZ8goJ6e3mCeot6iHiBf4N+jnyCeoF8hnt+dX51inyEgIV7hn2FfX95gHeGfI19jHd+gIOFf4GDgIh/gXp+eX54gXqBen14gXiDeHx4f3mCe399e357goCGg4Z8f3l7g3mQeox/jHmQco6AgICAgICAgICAgICAgH98foB0gXR/dn56f35/gICAgIOfeahwhntugY13loSBjnaGf4aKi4KGgHp/goyDhoCAe399gnaHeIZ6gH2FfoV8hHt+fZB/hn6AeIJ5hHqJfYl+g4KBhoOBgYGCg4OHhoaEfYZ5hX+CgoSFgYWJgYWCgoSEf4Z+hX2CfYV2hnyBfoN8g3yGe4V7hHuFeIN3h3l+e4J/iH6GeIF7gHyCboV/foCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAf3qAeniAf4F+gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4uLk4iRj2+Kd4eCiIOJe4t8ioCGdoZ1h3SGfYV6gX2AgICAgICAgICAgICAgICAgICAgICAgX+AfoJ9fn6DgIKAhnuEeoB+gYF+gICAgICAgICAgICAgICAgICAgICAg4SGf4Z/hYOFhYSFi4mJgIV+goCDgYl+hneBeYSFjIeDiH2KbY10j4N5j2yCaXd/bH9pgGWKaI1shHh4enR8dYqDk4yXgo54i3F9eH+BgY9/fH17gXR6eHl7g4mIfIpykHeQjIKEfnWLfZaMkIaHc39sd39/iZGHlX2Oe5KDiIZ/jHt8d4B7hH2EgoyNhZV4i4N8h2qEe4F5fXGFdIB0enSJcYdse259d4aEkod8d31zfnmMgYOHi4N/f3l8d3aEe4qKg4F/hIp9f3p9gol/jXaCe3x/i32Den95hniBeYF8hHp+d4N5gnR+eIJ1hniAgIKCj3t/e3d8e3+HgYSBhXmCfYJ+gX98d394g3uDfH52f3Z8en54d3t6e3l7f4SAhIKEgISOiIiCjoKRgICAgICAgICAgICAgIB9e4J9iYKFjICBf358gn6AgICAgIafnbGJj39sfoWMjpB9foV7h32Gf4CAgH2Fc455inqCdoJ3hXyGeoV3gHiDd4Z3h3p8gImFiHp+eoB8gn2FgoOEfYF/gIKCgn+Aenx4fYCDg4uCgYGAgX99hH2GfYV9gXiDfYV9hn2BfISAhH1/ent/gX+Cf4J+gHuDe4R8f359fIB5g36CeoN2g3qAgIiBfICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4J+gXV/f4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgoKJh5mNmHWHfoKFh4CGeYJ9goCFdoh0iHOIfoV+gX6AgICAgICAgICAgICAgICAgICAgICAgICAgIV/hnyBfoOAg3iFe3+Bf4CAgICAgICAgICAgICAgICAgICAgICAgICFgoZ/hIGHf4uFioSPg46DiIGFgIp+jXaQg42Jj4+RhIKHcpV9kYKAg3B8aHSKbYRpg3J/fH6Fe4pzj3WAfX97inqUhZCGi4CMeJN/hpp5gXp1fGt7gXR5eH5+gHtxf2+FiI+Kj3SJdoeEj4eQf4F4dX50fH16gn2CfYKAgZGIhJJ9ioOFfYOAhoaBgnd+e4aFk32Rl4SCkX5/jn+HeYSMfZFzf3d6eoR8hn+FfIJ2gneBfIN7h4GFgYJ5gXV/fYB2gniFeYF8hHh/cIdzkn14eIB3hHiJdohyg3V7fnuBh3yCeIN4h3mCen1/g4B9e4B8jn2Be3l6enuAeIp1iHx/gYODf3yCeIJ5f3p/d4B2gHaCe397fIJ7gX+Be4R+iIqJhISJgJCDiYSDgICAgICAgICAgICAgIB6gXuAdoqBiYaBfoZ3hHiCdYF3gXeEg66Bmn5+d4N6hHyDgoh8gH2Cd4l4h3qIeZR5gHmIeoB8gHmHfId7gnmDe4d/iHyAfX6FjYKDfH9/g4GCiISChn6Ff4aCg4GEfn9+gH2AgImAgYCBfoJ7hnuDfYaAfX+JfYGDfYKEf4GBf399fn56gICAgYN7hXiEfICDfICBfod/hX9/eIl8gHmDfoh9e4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX2Bf318enmAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICGhomEhIF8h4N6hH6Ee4WChXuJc4h2iXWFfH9/gH+AgICAgICAgICAgICAgICAgICAgICAgICAgIJ/gX+DgIGAf36AfX+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOBg39/gIODiYGMgJF+kYGOg4qAgnp8fIGAk5Cdh4SYe5iThqWKm3+GbXSNcYx1fnd1h2yMeYpwhXp9jn6DfWqDgIqGjn+EgniTfZd6e4Rrg3F/fnaBb3d6eYB2fW2DfYuDi3WCeoKHfYOGe4SHg4mAd39zfneBfYB/eYh9fH11gYyAgHyEd4h2inl5gHuHgpWMgo2EmY10goF/gIGEjJOQhYh3iIKEh4N9iYp/inuAeIR2h3OCdH55f3aIb4B1gnmDe4R1iHWDeIZ/hICAfYN6hn6HhIOMhIKBfXp8hYKEgoWGgYeAgX+Ag36GeIp6iYWAgn54f3SEc4J+fnl8eXx4fXmCe3x6gHR/doB6e31+foB8f312en94f3WAeoeHgYmGjoiJiISEgICAgICAgICAgICAgIB8h4OOfI53j2aLaoBzfXWDc4J0g3iIa7F2jm55eHx+gICBgoR7g3eFd4R6g32Ff42Ah3mLd3x4g3+BfIV6hHeFeYF/gIR/gH+BjYeHi4GFgoN+fIN/gYGIgYWAg4OFhYCChXqDeYd6gnl8eoB9hX5/goR/fIGEhIF8e36DgYJ7gnyCfYN9hHyAfoV8iX2Egn2Af3+GgIaEgX59e4aAfnyBfIF7fICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIJ/gIB/fX59fX6AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGCf4uAh4tujoGJgIl/jXyMc4d5hH+BgICAgIGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH+Bf39/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIV/lHubd5d4j3mQgIiBhX6VoYqff4aLbJaSn5yJb3d3en9+eoB0fnF6fnh5fIN+i4V9e2hze3OIeoFtkWyJc4eFc4VuhnqJgpGDkXuCboN4iG6Eb4KBfX17gHqPe4N2eXuDhIeGeYB2fHp+fXmBfYeFcoZyhox5hnd/hYOOhI5+iXeFgIKEeImDin9/doh7g3V/foaHhol+eod3hXZ/dId3jHmDe4Z8h36Cd4F1gXuHfn58f3x/foKEjoOChYKDhXyAfoN/iX59g315i3mEdH56fnmDf4N+fnyDe4V6gnmCfYaCgIR9g4SDfoWEh32CfoB/en55fX19e358gH2Ce356eHV6eIB8gXh4dXp5gHqIeouBeHqEe4eBhICAgICAgICAgICAgICAgICDi4yMh5GIjo6NkHyOeomKg4V9hHqKa66Gjo53nmqnjY2Te4R7hnqEe4F9gn2DfYuAh4aIjH+EgIR+f5F+g4GCgn1/e3yGd4R8goN+hoWDh32EeIF5gHqGfYd/goB+foB4h32CgYGEgH99e4J+gn9/foF9gHx+f4R7g3h+fYCAgoCBfYJ9h31/foGBhn5/fn59gH6Ef32Ef4aGg4B9fH2Af398fnx4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGDgIaBdIF7gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfIN8iXiDfo2Mg4xvjnyQhIx7jnyIeYR7gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIqBkYKMhYORgYaUm5isiIZ3b212iYKTeopxhniCf4N1eYV6gX14gn2LhIt+f3F0fXSCeoN8jXN8dHRza391eIF4g3+Eg4WAgH9ujWWUf4WGgYZ8foOKi4aKeIGAg4R8gXh9gHqGfot+kH+QdohvjIiUkIx8gXqDfI5+iIJ4jHGEeX19hYKEhISGh4SFeHp+gYGHfZJ6iXl9e4KFiH6HfYSBg4SBhYmEgIWFf4F9gHqDeYB6hnyCfIB9h3iIeYCChYF+fYJ/jICGg3t+fnmHe4N4hXaGeoN6fXuAfIB7fnx6fn1+f35+g31/e4B8g3yAe317eoN6fH19f4B6fXZ/eH58d4GCe3V9hHeHf3uEh36IgISAgICAgICAgICAgICAgICAgICAi3mKf5CDhI52k3uIhYOHhoJ8j2Glg4OgdaB0inl6hZqMn5iCjX2Dfn9+f4CBgYuBfYp3h3+AjXh3hI+Kgox8hIJ9gYCEhIGEfIJ/fYZ/hn2LfH59fX2Bf4SAh3+Af4J9hX2BfIR6iXqDe4F+gX6DfIF8gX1+e4N8hHp/en58gn2AfoR/f39/f3x/goF/fnt9gYCHgnZ/fISAg36BgYKEgX9+gHl7eniAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH+Ch3uGeIB9gICAgICAgICAgICAgICAgICAgICAgIGDgX6Cf4J/gYGAgH+FfoCBgouAjoGTfYt6iHuMfo11hoCBfoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg36HhZGOi4t/fZClj5aBhnZ5hHCNg4iCeop8hXuBf4eEhIR3g3qCgX6DgnuDg3qGe3qDhX+EaG9sXHJ1eodyh3iHeoWDgottjmSQeZeJk42PgpGEjoaDhn19dIZ2hn53gXWJcoh/hoB9d3xxgYSIiI+Kg4h5dXZ3eoiAlHuJhIiIfISEg4SDhYOJhIp7gXiBgoqKiIqAg4N6hYSGi36MgYuCiYaJgXyNdolxf3N/c4J2g3p/eYN3jHqHf354hnWCdoF6hYGDfIJ4hniFeoR7hnqEen98gHx+fn+Afn19ent6gH14gHp9fXt6fXt9fnp9e399fH18fX99f4B/f3x9dXqCgnqAhnqEeoR2j4CHgICAgICAgICAgICAgICAgICAgIB/goCOfoyGe4J3eH1+hIKDd4lgpW+Ohl+IcYaEgYN+hIB/g46CqX2BfX1/fX19foWEdYFxfn9/gYB1gnuOfIaCfoaCfI58kHuEfIKDg4SEg4qIiYKBfXyCeYh5iX2DfYF8h3yHfYmAg4SCgYOAgYGGf4Z/hHx8f4KBh4CDfn57gXuAe4J7gH2Aenx7f399fn18gX5+fXh5e3mBe3yCgn9+gn99gnd/dXGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB+hoGHgHd7d4CAgICAgICAgICAgICAgICAgICAgICAgIGBgX2DfYd7gn2AgIGDhnmLdot3i3SGdoB7gH2FfX99gX6AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIiEjoqGg5CdmYybjo2Ef3F7hXeOeYx3f3x7jX2Mi36Be3t7fIGEfn59iYSGi3WCiYKLe3d9apBml4N+lHGIaYd2eYRxjHKPcY99lIiVgZJ/i46Ci4OChIaHgYhyjHCMcY6BjoKLhX5xgIGAin6JhIaJhH96e36FiYiOhH96hnWHeIV5iH6JfoaDh4SAgYV9i3mFfIt5hnZ+d3h5hHSHdoN1jniNgIeCgYF9g4F+hXWFdH97hX6Ed4d2h3p7foJ6gnmFeIZ/hoCGf4J/hHyCe395hXd/eX56gH2AfX1/fIJ6f3x+gIF6g3yCfod9hoCDe4R8g4GCeIGAfn5/dod/gIR+hYR8ho2DioCAgICAgICAgICAgICAgICAgICAgIB/gnyKgIt/d4KGeId6dYKAh5iOo5V5i2eAe4R+gX+BfYF9g5t9sX99gH56e3l8eHuAdHt3d3t3gHt0e3J2dHGIe3+Fc4l5iYd8hHyIhIGId4t8koSJhYCHfYSBhICHgYd+hn6Ff4eCf4d+g4d/g4KBhH+EhXyCeIF7g4F/hH+Dgn6GfYB/gH+Df4J9gH5+eIN7gnx+eX50gnx+gHV/gn6EeH99jnx2fnZ0eYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICKiYGCfICAgICAgICAgICAgICAgICAgICAgICAgICEfYN/hX2Fe4F8fH+BfoWAhHOAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH5+hIiPiZWRkYKOhZmThoSDg4mMhoiDgIV0hWqIjYOKgnqFb4SFeoh9gYR8fYSBgJCJiYSNb5RpqXqYlWyaWHpkanpokG6mcKV+noaXf4mEgJKFhIZ8iX6LgoZ7hXR/eIN6hnyNiYN9f3qChoWGhYOJh459h4WEhn+Sf4V8i32Feod5gnqHe4t9hneGdYZ0iXaBfIKIiIaGhH16iniNeIOBgoWEhoWFf4KAfYV+iX6Ifn57gXeLfIaBhn5/e4J+h32Ke4N9hYGJe4N3h3qEfIJ7hn5/e4J5gX59f36AfX+Bfn+CfoN/gn+FfoV2g4KBfIJ4g3+BfIB/iXSGe4N/hYKDhHyIfIiBg4CAgICAgICAgICAgICAgICAgICAgIB9fnyEiomDfH2EjYOIfIB+gnqUio6Df32AdoB7gH6BfYCAfnqAtH95fHGAdHmEenp5c35/fX2BfoR0gHl/foh7kXmKcYN4goWEiol9i4SCf4t5joKNjIyIhoiDhYWGhYOHg4SBgYOAgIJ+gIV8f358gH6AhoCFgYKAf313enp8fYCFfX98foCBf4F/f359fH+AgICAfX5/g4F8fHp4hHyFgX2EfYWAfXx4enZ8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIWCfX2HgICAgICAgICAgICAgICAgICAgICAgICAgn6CfIGFfH6ChH6FgIB/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4OOkYuTh4CGgoeElJuAgoWEh4aHhol1fWx9ho6IjXiGcYKIgJN7fYJ5g4OGdIV6jo6IdoZ3jIB7joCSdnFxa4hhpGeodp+BkpCMhX2Pg5CQfo59fIN/g4Z9f4F5fXh9gYGFh4uJiIKEhYJ+fYJ+hnyDfoZ/jYGLe4qAiICHf4WAf4OLgod+iHqHd4R6hYCAgn2FgoaHgYaAjH+Gg3yAfX6If4KCg36GfoZ8h3+Ff4B6iHuGgX+FhIGDfYJ/hICIgn+BhX2FfYV9gH6CfYV8gXt/f3+BgoB+gIB+gX99gnuFe4d/hn+HfYN6g4CEfoV5g32Ieol/f4CDe4d4g3t7hYCKgICAgICAgICAgICAgICAgICAgICAgICAgICAgHuAfIB4fnuAfoJ7g3l/fH54hYGJgXt3e3d9fYGAfoCAe4F/qn55fmp0gneMfnaCbn+EiYGJeoV3gISEe4hrhX2EfoV6hYCMgYl2hYeDh4d4g4WChYqFkIWQfZF/kIKLi4eEgYGAen+EgIR9gHx4eYB0hn6Eh4GHf39+enx+fH2EgIR8gXiEeYJ/fnqBeIB7g3mEeYN0g3mBeXx4gH2DfH19fXp+eH16fHl7dHtwfICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgYOEhH+AgICAgICAgICAgICAgICAgICAgICAgICAgH2EgoF+fYOAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAf4OEiZKZjIOJgYiBj4yRmoWGhYCKgYZ9fHV/eYp8iX98fHKDgYiKeX2Ce4B2cnl6foh5eXR4d4B5hn17fXWCf5htr4KnjZmYjp2CiH2DhoKJfn+Qf4CEfIGKfJF6hXp9gX+LiIuRhYaCioGJgIl/iHuJeIh3iXqKhomEg4eCiIaHhYOIgomAhYKJgYaDf4R/f357hHuHfoGCiYSAf4B9gXyHfIB+g4CEgId9h32CfoKBh4CFgXuAf4CEf4GAg4J/fn6Ahn+DgYF/fn2DfYV+gn+AfX9+f4B8gn+BgX97fHd4eXp6gXuGeYZ3i3aNdYx8in2GdX5/hneFfod5jHl+ioCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIJ/gn2CeoR7gXt+fn5+g36Ff4l+f32CgICCf3t9eId0n3eAeIhpi22BfnFwe213c4B2gnWFfImFe4hrgYOGfYJzhXyFfICDh4OJgIZ2hYKBgIV6iICDc4B0hXOIgoV/ioGBfHyEhIGFe350eH56gn58hICIf4N9eXdyeXl9fYSBhn6Cfnx7fnt/fYB9hH6Ff4N+g3+EeoR9foJ/hICBe4B+gHp9dnt1fHt3eXJ5gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIKAf4KEgYCAgICAgICAgICAgICAgICAgICAgICAgIJ/g36HfoR0gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAhIaNjIyJgIuCi4aVmJaPjHyQepSKgnx4dXR6bIZ0f3t7fH54gXiCeYF6dHB3eIJ3gXh9f36Bg3t5bnl2eHuJi56JloeffpeFinl+e4B/g3+SgX5+h3mJgY2Hi4WAhH6ChIWPfJOFg42GiY+Ii4qOhIyBiYOJhYaFf4WDhIaGiIaMhIuCgoKJiIaLgoGIfIR8hH6CfIF+g4CEgIR+fX+Dg4OBfYF+f39/fIV/g39/goWBfn9/fX9/gIF+gH1/eoCBgoOBfYN7f3qDe4B8gHyAe397fnt8eX58fn58e317fXx7gHqEeod3hXKEdY93kHqJeoaAg26Id316eoh8ioCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgoB9foODjoaMgoGBgoCAgH6CfYuRs3t4epB8iYp1iW55gXZ8d4Z4fXWBfYKAgoJ3goGJfIp3g4F/gXx/hnuJgYZ8jH6MeYl1gn1ye3t2gXB+gHN9eoV3inGEen97fXx+eYB4gnmBg4GEfoN+dnh1d3t+eIF/fn18enx3fnaBeH59f319fIB4gHl/dYB3fHeAdYB5fXl9eX94e3t3end3dHF5gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHyCfIN1gnp+gICAgICAgICAgICAgICEfYWBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX+CfYF/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYOAhoSJiIqJfop8i4CKhZGCmomScpKPjJJ2gWqBcX5zeXB9c390fH+EhH2BeHp7eHqAfnx7eXt6hXKCeXN7e26HaI5qknSSd5J6knmNeIN9iYWLf3yFfnyGc4lyiXKCdoeCiYSJjIaLdoWCiYyLhIyHkYqQiIqIjIOIf4h/ioSGgIWEh4qGhYSJhIKCiIGMgoSEhoODgIV7gH6Ff39+f32Ce4B6fnyBe4R8gHl/eYJ6gX1+eoN7gH+AfYR9hX19fX+AgXqDeX98f3yFe4V4g3aAd394gnt8eX13fXp8eYB6e3p7fH1+fIJ5gXuEdIJxhniLfYl5iGqAgIOFh4OAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGEgYSTk5+beYV8eI5whXV8mH1xd4l2hXyGe4R8f32Df4N/gH6Be4eCgo5/jHeKf4p/i3yIe4F7f32CeYZ+iHKGgYiCgYR/iX6Kf4SBgIGDf4V/hX5+eoJ8fniEen94enqCeoV5h3yDd4N1iHWHen14gHqAdoV0g3SEd4F6f3h+fH98eX5+eYB4gHR5c3xyfHV5gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAf4iAjXuJdodzfn57gICAgICAgICLfYt7iXmKgYqCi4eIgIeBhoSFjICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGCg4OOh4eJfol7iIOKh4SDh4CNe4J7jqiMlX6FcnxtfnV6d3qFa5GAjICScpKQg315g2+Ebn10h3KAdHRriWKRX41ohnmJgYx7kHiNfYN5hnaNdX55eoKIfYl4iX2EgIeBhYOHgoGDf4OGgol9gYN9h36GgYuHgYKDf4J4hYCFfX5+gX9+gX+CfH99hIKChYGEh4KDgYd9hXyFfIh5f3yDfYV7gHmFfIJ9f3x/en95f3l9foJ/gn6DgISAgX+CeYN3hHyEe35/f3uDfIR+hH9/fX16f3d8eIB4gHeAen58d358fIF7foJ5gX+EfH9xhHmCdIR3iWqAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAhoWHho6PqpygiX1uen+GhIh6e41thHd6foZ6hYSAh4qEiYSIgYaKgIt/gYOBe4Z9jIGHg3+BfXuAe4N9g3iFd4uDiYh+iH56h4CCin59gnqFhHyKdIV0f3Z9en5+gX6Ff4J/fYN5hId/jIN/gYR8fn5/eoR5hHqAgX6Bf3yCfIJ4fnZ/en15fnl/c35zgHN+cH6AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgoaChIWCg4SAiHuEcIdwhHaEh4WCf4h8hIODf3yGeXl9g31+gIOFh3+Df4qEjISAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfYCIfouGhYaDfoJ+jICNj4qFiYGCgICDkY+pm6SQm4SZfpV9jXx8aHCAdINehlmJaYBvhXiGeXh7g3qDcYBoknCLeYN3dnlzfZN6l4Z+l32Ek3KNdYKAd5eBipJ6g4B1iYWSh4SVh4SIh4KFgIKHgYGDe3+CeoKAgouBhIWAh4GCiniGeIV8hX+FfYV+g3+DgIKChoKIf4h/h4CEgoaAhX2IfIh4h3qDe4F7gXqBfIF8f3x+doZ4gn6DfoV+gn+JfYh8hoKGgYF8f3uFe4F8gH1+fYN7hnp9e4B8g3yBfX58dX5+f4ODeoN4hYGFdIh8gnqFe4N2gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICHh4iFiIKSn4qJgoGGdIl/g5GBg4Rtf4Z8fYB4gX+GiYWMhoWEgIOChIKCenx5fX2DhIWBinmIfoR9gXt8e3Z+fop+iH1zenSEiYJ9eXd2g3aOcodxgnZ1gX1/iISHh3+Efnp8d4aBh3h/eYh7fXx9foZ+gn17f3t8hXqGe4N+hH2Den97e3l8foV4gXZ+c350f3aAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgoGGhYOGhIZ5hYCGhISChX+IfoWAiIKMgoiEh3+DeIiAhX2Df396f4N8hHyCfoOChIeMgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfn2EcoOFg4KCgIaBj4KUhZGJkIOFfYOBhIGEg5+HtIKmf657qZmQint7d4ptmG2Cd3J6gnyGe3t0gnKIbohui3KEdoRzgGd7boV+h4VggoF0q3uSgHiBZoJ4iqR7hH16cYdwh3WSd4J6d4qEg416h3yKe4F8f4KEeoWCgoR9hHyAl3yOfYOFe4yGioqJgoWLgoaAhIKHgYmAg3+Gfop+h32EfYR/iHuCfYV8f39/fX59gH2DfYV8gn9/gYJ+hX6HgYaCgYGCgIR9gn2HfIR3hnd5eoB+g3x+e32AgIF/gHx+fXx7f3mDfYB2hHqHdoB6goCGfYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAiYaNiJ6kiol+bXd5hYyKeol2gI98fnt6cIJzhHiHc4dzeI54koSEhX6CfoF+gYRwjXaJin6JfoR8g35+jYqJjYR6hWmQh4SJeXx0enqEg4l/gn90eIF5hnyBeIB3iX2FfYKBgoJ+gYaAfnmCd4R8g3t/d4B5hH2Bf36CfISCf4d3gnR9d356fnt8fIB4fXR5gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICCg4WFhIWGhod2g4KEfoF/fHp8fXx7fX58eoCAfoJ9eH17fnmCeYSAfIR+hYF7gn2Df3+JgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH98fn19eoOCioCOf4p3iX6JgYyIjYuMiYyHf4GDg4F+gH98gXR+go6kkaOYiouKlYqFfnJ7e36Ie4d5g3+Ge5F3gIJ6lnehh5uAmHmHjG9zX5Ful3l/iXSNaXZ+eqN+kXuCf4x7jXuQfId8eXppjJ1/jXyGe356gXmDgIF8f4JxhYqDl4WOiIKDenqFf4KCgoeEi4GJhIKFg4eGhoOHgYOCg36EfId7hnuDeoV8hXqFeoN8hH2CgYCAgnuCe4GAhX6Df4F8gH2DfoV7gXuCfoSDhX9/fIF4gXeBdH10eXZ+c353e3h9enZ6fIF4gXmBdn2AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDhY2TpK2ChHN7dYB4fXJ5e4WEbYaUeYp6eoWFi42FbYJXiZeGjIqFg4aChYJ8cYRxiHeAf36DgndyhHiNjoeGfmN9fYCUfX59c3t2fH+ChoSBdol3hH18e4Z2hX58hX2ChH6EfoZ/hH6MgX6CfH6Fe31+hXqAeX16fXuCgIZ9hXuAfX19fHx7e35/fH19jn+JeIt/jHqOhouGgIKAgICAgICAgICAgICAgICAgICEgYSAhn+Hg398foB/goJ8fnx7gH2HfIN7eXqCfX56fHt4c3d6dHt+fIF/f3p/e3mAf4KLgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH16fnh/fIJ9hXqFdoJ5gYSAgISCipuFgpGFkoWTeZeCi4CDgYCAfYd+go+YoaiKloqLhnh9f4KGmHqmgZyHmI6jfapeoGadgK6MnYqCr36JhIWOiY1wjmJ9iGqKco2Ck4OEgoh+hn+GhI2DgXpthYaOlZOBlYCTiIqOhY5+gnh1eYJ9j4WIioJ/iXmHfn+AgoB/fYF+hoCGhIOCgYOFgIV8hH2EfYZ9iH6GfoN/hH2EfoB+gH1/fH17gX2Ef35+gnyDfYV5hXiCe4J+gn6AfYR8gX6BeoJ7gnuDe397fHh7fnt/d3x+enl9eH54f3uGfICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICCf4KKhoyuqqyEk36Chn13hHmBdoN8n4KefJp5nYqRgn1fhYKOiIWKf4V9hHuId4N7hXt8fnl/hX96cXhug3Z8gWiAgX2Ne3qBdYB/eIh1gHyHfYh/gXx9foJ8g4B7e4d4h3eHd4J3hICCgX97f3yFf3t/hYGAgX97gXx/fH18fn19enl7fnqAfX19eoF2mXyFe4KAf3yDfYqJh4uUgZGLjYWTgpCIhIiDhIiGgICCgYV/gXuEgYSAg36GfYB4f3mAdYCEh4J7fn99e3l7e3x7d391fGWFb3VxhW+DcnVzeX6EfX+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAhH2Ce4F4gXd7eYB+foWAgICAhZWHg4h5h4GJfYt2kYqOj4V7gICAgHx8g46uq6uPlISdbK1spGeVhaORrYWvfZWBbIdvenV7fZyHrJN7p2qjhpmGkHF9o3STdYR6h4KHgoaHh4x7lXeThoh5iHiGj3aIcIR4g4WUjpCMiYZ7e4l5hHx9f4Z8jnyHe36DgYCNfY6AhIOChoKEgoCEfoV/g3uGeIh6h32HfoSAgH+BfoB8gX9/foF/g3+Ce4F6gHuCfIF9g4KDg4SAhICCf4N+hX+DgoCAgX2CfX98fnx5fnN9fHiAf3d+enx8fn98gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAe4OEgYWDf5d/qp+fnJh1sGWzeqponXeHk5ptoJOLlYZpkmadjZGTh4qChYGLgYOGfYd5iH+Lf45+in2CgYZ2j2SGi4SOfnhzfHB7fIJ5gHZ7g4N7gHCEd32Bgnh/foV8gXuKe4R9gH1/eoR6g3qBfH58f318f4J/gnuBfH96fXt7ent6fn19fniLeoN3gICAgICAgICBfYGDhoeDf4aHhYmBf3+Ie4t1goF5in6Ofoh/goCBhYCCfnaBfIV5gnd/en2CgoZ/fIJ8fXx9eH1/e4F5foCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIN/iYGQdIh6g4KCin6Ff4KAgHaCc4CKg4aEf4iEfoCCgoWHkYN4jY2HhH9+e3mFfp6PuYiacnmDa35uf3SEcX53f3SihICGcoGFfZCVkpF7cIN0hIJ/fYWMlZ+UnH6Xf5aFmIybh5Z9iH6AlH1+fn12l3mHe3t/c4aDgYaHi4aEiYiIiYV6gX2EjIaKgoR+hX+MgoyEiYaHioqHiYKJg4WChH+HgYqDhIKCgYR9gHuDeoJ5g3l/f32AgICBfYF9g3yFe4V8gHx7f3uFgoKHgIV/fYB9f4B8hH2BgH6Cfn97e3h1fnh/dHR4eX58foSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfoB9gYaBhHp6eYWakqp0jXp0nmxdd5t6jWNyX498i4Bme1eHdZyjjpiAhoh5kHuLeIx9jWucbqmCpIqUjJBuiHCBhYOZfId7c4hykHKHh4F9fX2JhYyEhIJ0g3iAfH1/gn2EfYGBfIF/f3+AgYF+f35/gnx/fH97gH1/fIB6gnl8eH16en16enuAgICAgICAgICAgICAgH98hoGCfn2Ed4V3hXuHend8eYdzhHaGfYSAhIaGhISBf35/e4F4gHp7enqDfYCCgYGAg3p9f3yAdYGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOAfYJ5hH1+doR3jX6HiIGDgIB8fXKFf4uHfoGFhYKCgIGCgImDioh+iYKIknyFfXp8gXx/h4aDjoOSgnyFcIKBgYt3fYeHkH2Dd3mLd411iH+IiYSCd4R6gImDg4iEiYd/iHqHe4l9ioCIgIiAlYqEiHyHmIeAiXKEe4B+eoJ/gYOBhYaIh4WGgoB+goWHiYWHhoCGgIWBhIaBg4OEhYmFhH99gICEf4B9gH2Bf4J9gHqAeYF+g4GBfIN8hHuBen97gnqEfIN8hXyCeoN9fYB/fYF7eXh+d398foF9f35+fX6Be4B7e4N1hn2CeX59gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfoGAfn+Dhn6GeoN3hHWAdIGGmZ5njYiglat5sIOii5Vsj2VqdWiAj5Woiq90uXqzjKeEj3t+XXmDfpCJkIx4fYB4iXWKhX+QaY9kiYCHk3uIeHd8dIN8hI5+ioCCeX1+fX6HfIF+fXuEen16gHuBen58f3t8eoF3f3aAeX18fXqBd395fHt6e36AgICAgICAgICAgICAgIF3foODgYCDfn9+fICIg3x/d4Byf3yAgIKGg4GEg35+f4GBfoJ+fXx8fHiCgICEfoOBfHlzenmBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4KDfXd9e3yDhIB/fn59g4CBgIB/g3mEfoWFjYiKhoeAiXx7hIiGgoB2dn5/kYCDeG+CgX+BinuNgZeHl4CJgHyGfIaDf4GCg4B5hn6FioePgYODfYd7d311hoqBiXuAf4aAh3qKd4t0f36Df46AjYKBhYKRipmCkYOEjHyGg4aCf4N8iXmIgoqGiIaCiYKEhoaChIaFgoGEgn9/gIGBhYCAfYB7gHyEeoV5gX1/fYB9gnuBeoN6gX2BfIF/goCEf4J+gX2Af4CAgYGBfoR/hnqFf4SEfICFfoF8fHp8e317f3p9gH2Ce3t+dnx3eYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX6Gg4eBh36FfISAgn9/f3l+bJd6dY9pjH2lkap0l4+Nk4pziW6FbYx1hnuGgY+JjJl9bnqHfY99iHt5i32VmoiIh3GFaXt0d4F8lX6PfnZ9dIB9gIuHiYeFf4F2fXiBgICBfICCeoR0g3l9e357f3x+fXqDgXqHeHx+fXuBd395fXp6eXuAgICAgICAgICAgICAgICAf3t/fX+AhX6Hdod+hXuAeX6BgX+DgImDhX+Ef4V/fYB/fYF+gn17hYCAgICDgIF+g4GBe3l7fYN6g3uBgICAgICAgICAgICAgICAgH6AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIaCeXd9gH9+gICAgICAgIB8f3+DfISJiYmHjYSQhomFhX6FfYN5fn+GjoWDhXJ6eYV1hXmHhXuAeX2FfZCNjYWMcoqDhYKFhoeBhYF/hIOAg4iJeYJ5goaLjImOgoiEiIaFiImKgISFhIuBkXt/fIB+iH6Le4t9hoaKhoiHgYd4h3qKgIqFiIWGhoeEh4eEgoaBiICGhoKCfoJ9iYCGfYR7g3mHd4Z5g3qEfYB9gX5/fIR8gH6AgIJ7fXp/eoF6f3qAe4B9fnuBeYF8hH6LfYF+e4CAf4F/fn99e4B4fH1/eXt1f3Z5e3t/eICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYV+hnyAf32Afn98foGHj5CQdHiAfX6DfId7ioGijaNxlYOVhYd1gnqGhICIj4qTgI2Nk4WRjY2BenR+koyZlHOIeHh5eIB/g4yDjXmHe4N8eoOCgYV8iHeFhoh9hYN9g3t8goaGgoR6gnt+hnZ/dnJ5en2Ed393e3p8en93f3d8eXaAgICAgICAgICAgICAgICAfnp6e356f3aBe392fnp9f4J9hoKEgIF+f4B+gH5+gICCfoF9fIR8goCAgICAgICAgICAf4CAhYCDf4SAgIGBg3uBfH+AgHp/e4GBfoGEf4V+g4KBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfnuEg4eJjIGJfomAinqFfoCAgIB/gpiRi4CDc3t2fXeIiYCMg3eHaYp7kIaNeIeGjYmLgouAiIaHfI14joiEe4J/foN9foGDg4uGk36Gf4CEfIyHjoiSj4uLhnqJi4GNf4R9foCBf35+gIN7hnqNfIx8jn2KhYKDgn6FfIJ+g4GHgoiFh4mJh4mJiIKIhoKJgoN7h3h/fX9+fnx8fHt9eXqAfIV7hXx/fYZ4gXl+eIJ6hHuCfIN8hIGGg4B6gHt+fn98fHp8f4N/gH2Bf3yAfIF2gHt7dICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB9g3x8fH2CfId6ioOJin+HfIR7en14gHqHfIl5jYOMhIOAhnyFjIqBiYF+f4yOjYmRhJGMcYtpgm59eHp8in2GfnqQdZGBkXqOe4WEfoh2g3p8fHqEhod+goF7jXl4fYB8gXt4eX9+hX2Ee4J7f32FfYR5gXZ+eX95gnZ9eXiAgICAgICAgICAgICAgICAgICAgICAgXp8gHl9eYKAhIaEgoF/fniCfYKBgICAf4J7fXiCeoF8goCAgICAgICAgICAgICAg4CFfoN8g31/g3t9e3t7fH9+gIB/e4GBhYCCgXyEgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB+hoSKh4OEhIeCiHiFfIqDh4mAg4GAgX59hHp/eXx6fYl/kHiGfIV+gX5+eoV6i4SPhYyBjoOHfIJ0hIaIf4N7ioeHfoB9f4GGk5COi36GfHqHf4eDiYyKiYGJjYmMi32LhIGDgoKCf4R6h3OLcYh3iXuOf4yDioKIf4Z/gX6AfYOBhIODgoaCiH+FgYiChn2EgX5+en94fnp9en54fnaBeoJ7gHyAfIZ7hHt/e4V9hHuDeoJ8gnuDfoN9hX2EfoB5gXt+fH1/fn5/fnx/eHt4dXx5c4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBfYJ7gneCcoZviHyMe4h+hoCAgn57f3mAdYJ4inaIgIl/hICMgoaDgIJ9dXuHc5t3gIV6mZ2Ilnt8aWiDeo2Sf3F/dH+Ef4F/gISAhYl9d4V6fX2CgoJ/gnmDiX9/fX5+e4F+f4yAfYF9e4d7fYGAf359hXuAd4B7gXh/cX52g3qDfIV/hX+EgIV7gICAgICAgICAfHt7gHqAend6e3t7f4V9gICAg4GBg4CEfX99gH6BgICAgICAgICAgICAgICAgICAgXuGf4J8fXyCeoF5gIB/gH99hHyDe4J8gIJ4hHuFgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDhoWAgIyAgX99gIZ+g4Z/gn2EeYKAgICAgX19fnt4eHV5f3+EgYKEcH50gHyFfoV/hIaKi4J6f4J9hn96gX6ChISAfIB+hoWKin+KgoWNfIN9hH2DfYCDhoiDhIGFhIWJgX+GeYmGinqLdY90jHqLgouBhYGEgoB/hoCDfoJ9hX6Ef4F/gn+GgIeAg4KEfYJ8gn2DfYN9f4B/hIF/f4V8gn2Cf4N+g36DfYZ9g3iCfIN7gXqGfoSBgYKBgIJ/f3yAfX59fYB+f3t6e3t3gX16bXh6gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHx9gHt9en54goCEfoV9g4CCg399f3yBeIV1h3aGe4l9hoCGf4eBhYCAfICCkZSViIBwf4SejaeSkn58bYaHjIhviHJ5enyAeoh5joWPfYV7fHd8hX+BgH+BgYGHgX2Ac398gouFe32HeoN6fX18fnx8gH6Bf4J8fH2DfIN7g36CgYKEg4CFfoR/e4CAgICAgICAgICAgICAgICAgHt5fIN8goCAg4CCgIB+f36AgICAgICAgICAgICAgICAgICAgICAgICFfIeBhX+FfYRzgXp/gYB/fnqCeoCBf4iAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfYOBgIB6hnqHg4CKgISSaYl1hHyFgYJ9f358fX1+g3uCfXx8e3qAd4Z/hHiJfY1/i4qPgI57h4CBgIOAgnqBf4CHgICDfIeEiId+h3p+gH1/e4GEg3+EgoOGhn6BeXp8f3yGdYZwiHqSgJF6kHyPgYmDhIWChYJ+g3+EfYV/hn+GfYN/g4GDeoB8f3l7d3x9fIB+gH18fYN8gH59fnyBf4GBgYaBhIKAgoZ+hn6Bf35+fX9/gn2BfX59fnx8fXh+e3t8enp4eXl7cX1vgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICCeoJ2g3yBf4B/hX6BgH5/e3x8eIF0hXyJe4aAg4KEgYSBhYKCgXp8fICKjo2AjW50jHCEdo9zeHl4e4WEiIV9gHuJen53foOIh4l6jnmFh4d5ioSIhoaEgoF8gHyDfX59e4CGgIR/gH19fH9+fn57eoJ6gXl9fH+AgX+AfYN+hXyIfoCDfH6BgICAgICAgICAgICAgICAgICAgICAgICAgIGBfXyBgICAgICAgICAgICAgICAgICAgICAgICAgICAgIJ/hH6AeoJ4gn2BgYGAgX+CgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB/gIB+f32Hf4eAh4GGdH58g3uDf359goGBfX5+e3t7f4N8jHqFd4R+hoCCfYN8h3+Jf4t9jIaMhI15ioaBfoSCiH6FfoF+g4KHh4l9g4CFgYKFgIJ/goKFhX+DgH56d3h9doJ3iXaReo56iX6IgIiCiISIhoR/hIKBf35+hIGDgYKAg36CfIJ9g3mCfIOBg4J+g31/f4J/g3+BfX98fXx+f32BeoB9hIGDf3+Bf35+fIF5gniAe4F6fn19fXt/fX19gH97fHx/c3x/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBfIN8gYKGg4SAhHl9e4B4inqJfYh+hoCJgIeChoWDg3+CenaBhIN/h3uRiJF8jIaHk2+RaXpzbnt+fn12f32EeH2Afol0f4SDf4l6iIyPfoh7f4KCiH98hnl/hYGGg4B+foB5goN8eXp9fIF+fX9/f4SAfXt/e4F/hISCg4KAfYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAhn6FeYV8g3+BgIGAgX6Af4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHmDfXx/e4l4hnh9gIN9fnt6hHpvgYOBfoB+f31+en14fn+Afn94gX+EfIh7iX2Jgod5hHyIf4d/h4CJgoSChXeGfoKEfICFfYt9hYSEfoR6hoCFfIV9g3uEe4J+g3qGeYZ5iHqLfo2Ci4KKgYeEhYSHgIWBgoODgoV8hoGGf4SEgoJ/fXx+fXx+eoF7g3yEfYN5hXuGg4CFfoJ8gXuBfH95gHp+e3uAfYR9gX19e3p5enx+e316f3t+fn+AfoB9fnx+fnWAdW96gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgISGgICAgICAgYB/fYB5gH6EfYV/gYJ5hHx7g3yIgYWBiIaLfYmAhYKAhICAgXZ/foF/hHWDeH6ObItrfY2Mm4GUe4iCgHB8iYJyj3+Le32BgYSEf4F1iHyLhoB+iHuGiYV7f3p+hXx+foCAgXp5eIF3f3iCe4B7f3mAeX94fXeBeoF+fnx+e3+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB+gICAgYGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfYB/f4B4gHl/fX2Be317gX6Cd4KBe4R8hYOAgnt5enx6f3p6fnh+eX15g3mHhYt9iHiHfol9hnyDgoaBhHWEeoOGgn+Idol8iIWJfYZ+hIKEeoJ6g3eCeH97gHqBe4SAh3SIeY6AjoCLhIqEiYSDgoB+gIF/fX98g3uEd4h+in6KfYiCgYKAgn6Bgnx/fX99g3eFgIaFgYV/f3+BgIN9gn6Af36AeYF9f4B/gX1/fIF+fX5/fnt+fn99fX18eoZ8gnl4fXt7gH2AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIWEg4OAgYB9f36CfH11g3mFfIR/hoODgYCAgICAgICAioKLgomDhX2GeIh6inqLfIt6h3eCgoGNjpaQen92enZ9foWDg4KFg4NseoB7hH6Di3aMhYl4h3OGkYR+fHqBiIKDgHWGfoaEhHuGhH2Ae358gHyAfH96ent9fIJ8f3yAeoB6gnuEeYF8f4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB+g3yAfoB7fHt+gn+Dfn98g4SBfYF8f4CChIJ+gIB/fX9xgnaFhIWIfmuBe4Z9h3mJfoZ+hH2EfYR9g3iCd4aCinuJeIl8jYKMgoiFh4OFgYN4h3uFfIF8gHuCfIV/iHSEeoZ/hn+JgoqDh4SFhoOAgIF/gICAfoF/fYN6hniHeol8iH6HfYaAg3+BfoB8gHqFfYl9h3+Ff4V9hH+DgoGAfIF8f3t+fH5/foCCfX99foF+gH56fXt/en+CbH2AfISBfIJ7gH2AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAhoOIf4V8h3yFe4R1g3yDfYR8h36IhYyJhoCJfYx/i4GMfouFiICCeYJ4hXeHe4t+gYaDgoqBiYGJgImOg3uBfoWBhoGJeH98foCGhIh6fXt8gYF+g3yCioSDhXyPfZODiIF+gXx+fHx9hICDfIB8f3l9eH92eXx7gXuCe3x+e31/foF+fH1/foB+f4B+gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHyEgYOCfn58gn2Afn99foGAfYJ7hH2Fe4SBgH9/gHx5dXJ8eYl/jH+Kd4t9jHeGf4V9hXuDgYF7hX2BgICJg4KLcoqChYKGhISFg4SDgIZ8dn57fn98g32EeoV8hn+FfYiEh4OGhISGgIR+gn2Af4OAfIF7g3uEfIR8hHiEeoJ9hH6FfoaBhXyBf39+g3+DfoGAgn+BfIB+gH2DfYKBg4F9gnmAfH6BfYGBfn1+e39+fYJ8fX17gHaAdoGAfYCIfYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHx7e3t/foJ7gn2EfIN+gn6DgImFg3+Ee4Z/jYCNgYWChICDeYV4hXmKfoiGjpOAeoR+fIR5hX2DfYCBfIl7hX+DgYJ9hH2EgYSDhXmHgYR3h36Oh5B/jHuCg3qEgYCHfYh3gYmAgH+BfoF6gXh9e397eX51gXiDfnx8fH56fXt7enx8eX96gXyAfoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHp+gIWCf4B3gH6CfoB+gH+CeoB+f32Be4CAgICBg4OCfnp5cXpzgX+Ie4R8g3mHhImAhX+Dg4Z7gYB+ioSLh4KAdoCEgIh6hnyAe4N4gHZ9f357gH1/e395f3V9dIB2gH1+hH+Hgn+Ggn6Fg4CFeYF7fnt+enl9eoJ9hXmFeoZ8hn6GgIeAhYKFgoeChYSAhoOEf4V9gHyAfH1+fIJ5hH9/gn+Ae39+f3t/eHp5e3x8fn98fXt9fXt9eYCAfICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHmAfYF8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB/gIKFgoCEeYd8jHqLgouDhoCIe4Z/g32FgYmBjJGOg4p+hYaHfYSBgX5+eXx2hYSKe453inuHhIKCfn99goN4fn+Ae4OBgIN/jIZ6j3uFiYKCfoGAgYF/gX99gH6Ae4J5gHZ6e3V9fn2CeoR4f3t9e36AgICAgn6BfYJ/gYF9hICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHd4fYKBhH15fH9/foJ/gYB+fnuAfnp+e398f4J/gH6AgYF9fnt/dnh9b4qAinuEgYaChn+JgoyFjoiRjI+Fi4SGiH2GfIR/in6EfoR/fn97goCFgIN9hX6FgX+Bfn+BfYCAfYF7fnuBeHl1fnqFfoN/hH2GfXx8eX58g3mFe4Z2iHeHfIWDhYOFgIeBh4OHf4eAhoWEhYKDf4F+fn96gH+Cf3+BfIB9foGCgnx8fn19fnh9foF3gHyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICGeoN7f3l+eH94gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICId4p6ioCGhYmAjICGhYSGhH6GgYSEh4eNgYOCgIN/foKCgnx+fYB5gnuHeIt3in6HgImAinuJgYN6hoaHdol/i4OLhYt4iYSMgZKHjYSJeoOBhXuCfXiDd4R7gnuAgIB5eHx6gYF+goCAgICAgICAgICAfYCDfoWAiYF/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX+AgH14gn+Bf4GAg4R/gX6BfoF/fYB+gH6AgICDgoKAgHx9gH+AboRzgYSAhIOAg3+EhISEgoeAiXyMeoZ7in+Hf4WDgoSBhYCGgoR/gnuFgoV+g3+Cg4OAhHt/e399f36BfIJ+gH9/fnh9c3lye3SBdn14ent6fnSDdod6iXiGe4p+ioCIf4Z/hoOFfYR+hIKHhYaDhYSFgIN8fniCen+De4B5fH9+foJ+f4Fzfnh/eIF8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB/eIF4gXd/dX10gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH+DgoaHfod/hH6Kfot9hoeGiIWGhICEhIWBhYOBgoKBgoCBf4KBfIB9fX16g3mJeYl9in+HgYN/hIGEhIR/hYSId4F7g4SGfId7gIV/foB7jIWOf4iAiYCFen59fIF+gnx+f3yAgH97fH98fX59fX2AgIF/gH9+f3yAeYR5g36DeYNzhXmDfISAgH+AgIB/gX6BgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB+gYF+goSAgIF8g32De4Vtf3qAe4N6hHyHfoWEhH+DfoKAg4CDf4KFgYSAgIF/fn58d311gYSBh4GGgId+iX+Ff4h+ioKHgoaBhICMf4KAfICBe3x+f3+AgnqEf4V8hn6Bgn+AgnmCgH99e39+eIN7goF9g35/gHyAfn98fHp7eH56gHR6c312g3qHfYh8hoCEgoKCg3uEgIOAhYSFgoSChIKBhYSFf318fIB8g3yCfH6Ee4R/e4J7gXuAeoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBdYJzf3iAc4aBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB9goCEiH2IhoWDhoGEfoOFgod/iH+HfYB+gYCBf4R/gYB9gXiDe4R9f3x+e4N4iHSOdomChoKAgH99gnuDe4R7hYOHfYl/hoCBgoKBiICJfIV7gXiCgIKBhoCGf39/fXx/foB9f3+AgH17fH1+fX96fX6FfoF9f319f32AfoF+gXyCfYF+hX2Ef4Z/hnuDe4B8gnyDfIJ9gXyBf4KAgn2Bf4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAhXyGf4N+hYKJfIF4gH6HeYN3fnp9eoB7gXmDe4N8gXuCe4V6hH2DfoCIgICAgICAeIJ7hXl+e3l/hn6Jfod+iICEf4OBhYGIgoSCh4eDi4OHg4WAiH2CfYF7gHuAfYF8gnuCgIF7f32AhIKCh3yFeICAgoGDgX9+fnyBfYR/gn+Df4R9gnuDfYF3fXd5dnp4gn2HgYmDhX2AgYCCgoOEhIWIgn5/gX1+fXt8e35+fHt9fnyHfnmAeH6BgYGEe4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAiHiHeYd5h32IdoV1fnp8eX9/hYiFiICAgICAgICAgICAgICAgICAgICAgICAgICAgICAf36BhH2FgoZ7iICLhIyEhYKAg4CFfoh8iHuGeoB8fXt8fnt/en15f3mBdYF4gXyCdYF5h3mLeot9hX6DfoF/gX2Cf4R4hn+FfoR+goOChoV9hn6FfoV6hoKHfomAin+LhImFhH2Cd4SAgn+Af32Afnx9fIB9i3iDgX9/f4CCgYCBgIB/gX5/e356fnx/goiFhYOFgIOAfn1+fX2AgH+Df4F/gX2Cf3+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfnt+fYB8fXqBdod6hX6Gf4B9en97fH17fX19fYB+gXyBeYN5gYCBgYOOgICAgICAgICAgIGAf319f4KEgoODhIKCgoWCg4KCg4WBhIF+gISBgYJ/hX2Df399e3x4gHp6f3uCgX98fnWAgIB/gYCBf4J/gn+BfX57fXx7en55gnyFf4iAhH6FfIZ7g3yDfoB/fXx7dX58g4GChH+GfYJ+g4iIjYCFgoJ3gnmFgH6Bf3V7f4B9gX1+eX+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAhnqFeIF4f3d9eH94gnyDfH1+en19eX52gIGDj4CAgICAgICAgICAgICAgICAgICAgICAgICAgIB+gYN6gXqBf4Z7gYF+gXuFfIl8iHuGfop9iX6EfoJ7gnqBf3yBe4N5gXd/eIF6gX2EeoV8h3yGgIN+g36CfX9+gn+AfoF7gn+FgIR/gYWFfId6hICDgoh6iYGKeop8iX+If4eCh4SBf4GCgoB+gn5/fn+AgIN9hnqFgImDiYiEhnyDfIF8g3qBfH96gXyBgICCgoWCgYmMhXt+eoB/fICBfIB9gX+CfoGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH19fHyAfoF8gH6AgXuCeYB5fn2Af4GCf4R7g3uAe4N7g4SEhoiPhYiAgICAgICAgICAgISAhnqBf3yBhYGDf4B/gIN/g3+GgIZ7hH2DfoN8gnmCfIB/iYGHfYZyhH9/foWBhHuFfoN/g4KCgYGCfoF/fn97f3x9e318gX2CfYB8hICBgoWChX6AgIKAg3+Ce3p3d3h5e4GEhIOHf4Z+hoaDhYN6f3l+goJ9f35+gYB+f4GAfoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIaBg3+Afn2AfIR5g3yDgoN/gH6Af32CfIB6eHt5fX98kYCAgICAgICAgICAgICAgICAgICAgICAgICAgoKCeoF4g3mDeoB+gIR/g36IgIp9jYCDf4R+hn+DgX6AgoCFf4Z+goGBgH9/f4J9gn6DfYV/h3+GgoWBgnyDe4R/g4CFgYZ/ioSJgIeChIiEe4V4g4SFf4V8h3+Je4l9iX+HgYeDhn+Hg4OAhIKBgIKAgYGAgoCFgIKAfIB/hIGEg3+Bf4KAgX6AfHt8eYF9g36CgYGIfIiAgICAgICAfYF/gYSAhH+GfYF8gX6Cf4WAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfHt9eX18f4GAgn1/e3x8e358gHuBfX19en5+f39+foOBgoOJhIeGgYCAgICAgICAg4aGiY2Dh3iEgYCJgH2AhH6EgIGBgX5+fn5/foB+gnyDfIR8gX6EgYJ4fnp9fIB+g3+CgYGBf4B+gn+Bf3+Afn59fn5/fIB9gIGBgYGBgoCAgYGAgICDgYB+gYGCgH5/fn9+eX17e3aCfoCCeoF9hHyBfYB+fX98gHqBfYGAgYCBfYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYCAg4OCgYF+gHyEeoN5g4CBg35/f4F+gn2DfYN7f3p8doKAgICAgICAgICAgICAgH6AfoR/hn+EgICAgIGEgnyAfH17gnKAfoSAgIZ/gn+GfId8g32AfYZ9goCDfXl8fnx/foR6f39/fYN7gYB7hYGEf4OBgoSCfYOCg3+DgYJ+g36EgIaAhH+EgoR9g42EeoR4hoCMhIaChn6EfIZ9hYGGgIeChH+CgIOCg4CEgIN+gYKEfoCAfH1/f32Bf36Bf4F8gn19hHaKd4J/eXpufnaBgH+OgICAgICAgICBf4B+fn6EgYKFf4J8gH6AfoGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHdyfH5/gH99fXx9e319e4B6g3uEeoV6hHuBfoB8f35+goKGg4WDhIOAgIGDgYKChICAe39/goSLhIGCgIN/gXuCfIZ+hIF/fn97gnuBgn15f36Ae4B6gXyDfYN+gn+AgH+AgIB/foCAf39+fn5/fYB9f4CBgoGAgYCAgYGAgICAgIB/f4CAf4N+gX5+f39/fX2BfX14f3uCf4F/f4F/gICAf4N4gICAgISCgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICCgIR9hH2Df4KBfoF9fH18gICAgX5+eXx5f3x+eX5+gXx+eneAgICAgICAgICAgICAgICAgIOCgoSChImBhYGDgYB/gYduf3mAf3+BfYR9hH2HfYV7gX1+fYOCf4KAf391i3CDb4RwfHNzenh+fn58f359foB/gnuDfIKBhHyFhYaCgXyAeYJ8g3+Ff4R+iH6KgYiEh36IeIiLhIOEe4WCgoODgYGChH+EfYOAgn+Ef4R/hX+EgIWCgnt+fn9/g3yDfYN8g4B/iIGFg4eAgICAgH5/gH+GgICAgICAgICAgH+AgoCCfIF/fn98fnx+en58f32Af4F+gX9/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB8fX59f35/f3t/eIF5gnyCfYJ/gnmBdIJ7fHx+f4CAgYCCfoR/h4CEgIOAgoGFgIh8gn+CgYSEfod8hICDe4N7hX6Ef4F/gXmGf4Z5fIB7f3t/e31/fYF+goKEgIOBgYGCf4B/gIGBfoF/f4KAgICEgICAgICAgICAgICAgICAgICAg4KBgICAgICBgYGBgYOAgoGCgH6BgoGBgIB/goCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDgYWAgoCBfoF/f359fX59f39/f3+Afn58fnt7en17f31+fXaAgICAgICAgICAgIB/h4GCgYCAgoCCgoqFhYp7ioWLd4J2f359fYGBgH9+hX2Df32Dg398f3x3iG+Ib4N3hX6Ef35+enpteHB8eHx7fH58f31+gH6CfYWEg32Ff4iDiIKFf4J9g36EfoeAh36FgIuFiYSChYOHhn+DfoGDgYSDhoJ/gH1/fH9/gn+De4Z8iHuLfIyGhYCBfX98gn2Df4J/g3yCh3+Egn6AgICAgICAgICAgICAgICAgICAgIWChYGCgYGDf4J9gX9/e358f32Af4F/gH+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB4eHV8eIB9gX2EeYZ3hH6GhIiAhH+BgIV/gYCBgH6BfoR+h3+Ef4B/fn6AfIJ8hHx9f3uBfYN9gX1/foCAgIF/gn+Ef4WEhoKEf4KAg4CCgYF/goKAgICAgICAgICAgICAgICAgICAgICAgICAfoCAf4CBgoCEgoSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX+BfIF8gH1/fX9+f39/f4B/f31/e398fnx8e31/fX6AgICAgICAgH6IfoaAgYGCgIN9gnyDfYSCdIB8foB/gH54fnyBf3p7eX55fnx8fX+AgnyBc4x3iXyDgICAgICAgICAgHpxd3B5dXp6fHx8fn19fYB8hH6AgIOCgIOChIiFiIOHgIKAf4GCgoOAg4CDgYSBgYF/foN/gIB7goGCe4OAg3yCfYF+gnyDfIJ6hXyCdYKAin6LgYZ/g32GfIR6gIeDgYWFgICAgICAgICAgICAgICAgICAgICAgISAhIN+hH6EgYGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAdXp7gHyDfIR9gXd6foSDhoSAgICAgICAgICAgICAgICEgYeBh4GJg4OAf36AgH+BgYWCgIKAgYSAgYGAgYCEgIaCiYKKgoeChH+EhoOFgYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBfn99fX9+gH59gXqAfH1+e4B8fnx/fYB+fX5/fH5/hX+Heol/h4WGh4GFgISAgn6DfIR9hH2EfYN9fnd4eX9+eoF8fnx8eX16fXx9fnt+fHx4hHeKeoN7gICAgICAgICAgICAgIOAfXF8dnt2fH19fn6BfYF7hX2CfYB/gX+EgImAhoCJgId8hXqDeoV7g3yAfIB9gH1+fH+Be4GAgoGBgH99gX2AfYB+g3uFeoh8iXiLdoV9hHuFfYaFiH6JfYiDiIaIhIh/hoCAf4CAgICAgICAgICAgICAgICAgICAgYGBgoCDgIWAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICFgIJ+gICAgICAgICAgICAgICAgICAgICFg4R/gX59foB+goOBg4KChIOAgYB+g4CEgoSChoGFgoaIhIaDhoKKg4WDgIOAgoGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDf396gHx+gH+CfoB/fIB+f39/fn+Cfnt+fXx+gX+AgoCBgYKAhICGfYWCgICAf4J9g3uFf4OCgoJ+f3t8e3l1fXt+fXx8e356gHt9eoB6hHyBgH6AgICAgICAgICAgICAgICAeXx2bHl7d351fHV5en9+gn6CgIJ9hHuDeop6iH6Kfod/g3+CgIR/hH6Bfn+AgIR/hH+Ce4J8gXuBgYF1f3uDe4p8i32Ndop8i3SHeYd7iX6KgYl8hXyDfoJ+hoOKgY2GjISJhIWBhIF9gIF/gICAgICAgICAgICAgIKBg4GBf4J/f36AgICAgICAgICAgICAgICAgICAgICAgICAe4B6f4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAdoF8f4CBgYCAf4GCfoR8i3mJhIiKhoaEh4GLfY95ineIe4N8hHx/foGBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAf316fYCAfn6AgICAfn6HeoB4f3t8fnt8eYR8g36BfINzhneHgICAgICAgICAgH+BgYV/hoOAgYKAen+EeHF8c398fn1/fH59foKAhn6BgICAgICAgICAgICAgICAgICAg4B8eHp0f3t/fHx+d3t3e3h/eoF/gYCBgouBjH2HfoR+hHyEfIJ+gn+AgICAgICAgICIgYJ+gX+AfoJ9hnaEfIV7h3uHfYd8h3yFe4V8hX2HfYN8gXuFfYWGiXaMfYqLiIOHhIiFh4ODgYR/gICAgICAgICAgICAgICAgIF/gIJ+g32Afn+AgICAgICAgICAgICAgICAgIB9hH+CfIN7f31/fH+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAf4WBf3yAfH5+gIGAfn99gYCAgIB/f4CEg4eEjIGWeo9+hoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH58fHt7fX99e3t+d4F7gH+Af398gn2CgoKCgX+AgICAgICAgICAgICAgX+CfYZ8h4SAgX6Ad3yBfHR8dX13fnl9fXyBfYZ/h4CAgICAgICAgICAgICAgICAgICAgICDf3x8d3d1hXWAeHd5fnV+cn9zf3SDd399hICIf4h6gnuAfn+AgX99goCBgYCAgICAgICAg3uBfYB8g3yEf4aAhX6GfoZ8hH2Df4KAg4GGgYR+iH2Gf4x/h36HgIiOioGJgYmBhIWFhIOEgISAgICAgICAgICAgICAgICAg4WDhIGDgH+Af4CAgICAgICAgICAgICAgICAfYF/goN+gnqCeH94gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHl+f4R9gICAgICAgIB/gYGAgIR+goGAjYOViIOGhIWGhYiBhYCEf4SAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgoB+fIB+f3t7dYJ7hYGGfoZ7g4CAhIGEgX+CgoOBgICAgICAgICAgH2Cf4SAgICAgIGDeYV9g3t/eH1ufHx6fHqAfYWAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYCAfHx5f3yDfYJ8c3yCeoRzg3N8e4F+gIKCgoKCf4B5gX+DfoN+g3yEfYR7hHiFeYV5hnyGhIWGgIWAgoGAgXyCfYR7h3uGfYWFgoCBgYOChIKEgomKioSHhYiGhoOEhIOJgYN+gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIKChYKCg36DgoaDgYmBgoN9hIGGeoR8gX1+f4GCf4N/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB+gH19fHt8e4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX6De4N7goCCfoCAfId/i4GKgoaAin2JfYt7iYCDgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICCgoKBgn+GfoN9gYCAgICAgICAgICAgHeBd4B3f359fn2AgICAgIGAgICAgICAgICAgICDeICAf4aAgICAgICCfYJ1g3yEfoWBhIN/hH2AfX5/goCGgICAgICAgICAgICAgYOEgoeAiH6GeYGAgHqAeH98f356gHp/e3uAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9goCBd35/gYWEiIJ8fHZ7en11gH2BgYCAgH5/foB9gHyAfIN9hHuGeoR9g4CEhIOGgoh8hnuDgIOAgYCAgoCAhoGHgYWChISFgIWAhX+Bf4SDh4KIf4V/hX+FfoV/gn+HfIKAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBgICAgICAgICAgICAgICCgYSHhISBgoB9goCCfoSChYGFf4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH18fXp9eH56gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAeoZ9gXuAfH97gnuHfIZ7gHqCeoJ7hXyIf459in2Gg4GAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB9foCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfoN/g3+Ef4Z5g3aAeX57f3l+dX14eXaFfoSAhHqDeYB8fn56gHyBfoF+gICBf4CAgICAgIGCgIKDeX96fn6BiICAgICCfn94gnyCgIKBgoKAgoCEfoJ/goGBgICAgICAfoGBg4J/g4KGfYZ9gYCAfYB/hHmCfoCBfoJ8e3x9fX58gHt9gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX+Gf4aAgX2EhIh/hYWAfHeAc3h2cH18fn5+gX+BgYOCfYJ/gn+CfoSAgoGAgoCDgYGDhX+Cf4WBhn+Bf4V/hIGEgIZ9iH+DfYV9g32EfYN9g4CFgYSDgoOAhIWEhn+GfIKBgH+CgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAhHeCfoB/f32AgoCDgX6Be4N9g3uBfIN7hHyEfoOBhYGHgYWEgYCEfoWAh4KGhIKAgoGAgICAgICAgICAfIJ+g3+BgH+AgICAf4B/en96fH1/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICCfoWDgICAgICAgICAgICAgICAgICAe4Z4h3eEdoN2hXeJeIl6hn6Gf4V/hICFgIWDhYOBhIKEhoSHgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB+gH+Af4B8gH6BfYF9gH1+foCBgYCBf4J8gH2Bfn6AgH9/gH9+hHyGfoJ9g4GAgYSChoCHfYR7g3+Cf4eAgICAgICAgICAdXh4gHt/gICAgH99fXx9fH59fnx+f4J9gX2Bf4CAgHuAfoJ7gHqAd354f3qBgZF7iXqHeoN8hH6Cf4SBgYaBg4B/gICAgICAgICAgICAgoGCf4N/g3qEfYGBgYCBfoF9gn2Be4J+f4B/eXx+fXx/gIJ7gn2AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICEiY2KjH99fn13fH16d3x0fn+BgIGCgIKBgYGAgICCgYKEgoOBgYGCf4KAgYCHfIB/goCDgIV+iXmEe3h/fYGDg4iBg4J+g4CDgIN/goKDgoSEhoWFhYOCgoSAgX+Bf4CAgICAgICAgICAgICAgIR9h36FgYN9fnyCfn9+f358gnx/foB+gX9+gYCCfoF9gX+BgIJ/g36HfIR+hYCFf4Z+hoCEfYV9hX+Fh4KBgYSGf4KAg32Bf3+Af39+gH9/gICAgICAgICAfn1+fX18gH9/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH+BgIGAf4F+gHyEeoJ7f32Bf4B/gX+AgIB+g36DeIZ5hHWMd4p5iXuHfod/hX+Cf4F9g3yJe4d8g3yEe4Z9hX6EfYZ9hH2BfoN/g4CBgn+DgIqEgIKDgoCAf4F/gXuEfYN/gX+AfYB9gHyBfYF9gn6BfoJ/gn+Cf4B/gn+Bf4OAhICCgYKBgYGBgIGAgYCBgIGEf4CAf4KChH+Cf4OAhn+Ff4V9h32IfYR7gXyBfX99fnx5gICAgICAgICAgICAgIB+fX99gH2AeYB6gYKCf4F4gICAgICAhXV/eH17f3iCeINzg3mEf41+gHqAgIF+gICCg36CfomAgICAgICAgICAgICHgoaDg4SDgYR8hHuBgYB+gYKAfYB9gX1/fH57fnt+fYF9gnx+fn+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg35/f32Bf3+DgXt2eYN6d39ufn9+fYCAgoCEfoN9gX+AgH+CgIKAg4CCf4N+foCDgoCBfYCEgYWFg4p/hXyCgIOAgoSDf4R3gX2BgoN9hX+FgISAg3+Ch4ODhYOGgIWAhYWFhYSAg4KBgYJ/f4WDgYh6gnmBe4B/fnt/fn98f3x/eYF7gYJ/hH58gHyBfYF+gn6CfISBhIGDfIJ7gX2Bf4N9g32EfoZ+hoOGiYV7gn+CfYF7gXuBe4B9gH+AgICAgICAgICAgYOAg4CBgICAgICAgX+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfoJ/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIKAg4GDgoCAgICAgICAf4GAgIGBgYGBgoGFgIh+iXuEeoF9gXuFeod6h3qHfId5iHqHfYV8h32HgYOBg4OBg4CBgX+EgYKBg4GEgIV+hX+GgYaBg4CAf4B/gX+CgIOAhIGEgYWBhYGFgIV/hnyHe4R7g3yCfYJ8gn2CfYF9gXyBe4F7gHuAe4B6f3p/en97gHyAfIF8gH2AfoB/gH+AgICAf4B/f39/gX+Be39+gH+Bf4F/g36CgYKAgICAgICAgICAgICAgICBf36AgICAf319fX18fnp/eX96fnt/fH6CfnuFeIV6gXl+e357fHZ/e399g3B/fX6EgICAgICAgICAgICAgICAgICAgYCBgYKChoGFgIJ/hYCGgIOBgn6CgYJ9hH6Cf4B/gH9/fn19fXt9fX2BfoB9gH6BgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgH9/foB/gYGAgIJ8f4B/enpxe3h/fYB/gIKAgIB/gH+AgYKBgYKBgoCEgoSCgICAhISDfoWGhoOGgYGEgoCCeoGBg3+EfYJ8g4GHfod6hX2DgoGDgISBgoODhoGHgYZ9hXyDfIKBhYSEgIN7g32EfICAf3x+fn5+fn6CeoV2hneGeYJ8gX6BhYOEg4CCgH+Bf4CBf4B/gICBgH+Bfn+AfIGAgIB/gX99gH1/gIGCgoCDfoJ/g32CfYF+gH2Ae4F/gICAgIGEgIeAhoCAgX2Bf4J/gH+AgICAgH+Bf4B9gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXqBfICCgYWBfoGAgIGAgX9/f36BgICAgICAgICAgICAgICAgICAgICAgH+Bf4GAgoKCgoKCgoOBgoGDgoODgoKDgYSAhYCIgYmDioGLgIZ9hHuEfYeBh4OHg4qCi4KIgYSAgoCFhYKDg4GCgIOAhIGCgYF/gn6CfoJ+g36DfoN+gn+CfoF9gX2BfoF/gn+DfoR+hH2EfIR8g3uDe4J7gXuBe4F7gHyAe4B7f3p/en96f3p+e357fnt+en56fnt+e357fnt+e358fnx+e357fnt+foCAgYCAgICAgICAf39/f36BgICAgH+Af4B/gX+Bf4CAgH+AgH+AgIF/fnt8en55gHuAfYCAgIB/f39/fXt7fH57fH97eXx7e3WAgICAf3F9goCAgICAgICAfYB6f3qEd4B8gnyGgICGfYR9gIJ/gYN/gn6Bf4GDf4GAgYGAgXuBfYB+fn58f3x+fH5+gYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIKAg4OAgn+Bf35+gn91fHZ4fnp8fH18fXp9e3x8fX1/foB/gn+Df4N/hH+Cf4N/hH+DfoSAhIOEhX6BhYGFgYGCgYOChIGCgoGCf4SBh4KFgYGBf4GAgoCEfoR+hH2DfIF8gXyBe397f3l9eX+AgoCCe4N7g3mDeYJ4gXqBfIF/gYGBgoCCgIB/foCAf4GAf4GBf4GBgIKAgoOBgoCAgICBgoB/gYCDgIR/hICGf4V/gn2De4J8gn2CfoB8gYGDgX+CgoSDg4GDgX6Afn9/f39/gX+AgH+BfoCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgHt/e36Afn9/fn5+fn9/gH+Bfn98fnx9e4F7gXuAfYB9gH5/f3+Af4F+gn6BfoCCgIWBhYCEgIOAg4CDgIKBgoGEgoWChoKGgYaBhoGHgoeEh4SHg4WDhIKHgoaDhYOEhYOGgYWCf4J/gn+Cf4F+gn2CfoF+gX6BfYF9gX2BfYF9gX2BfIB8gH2AfIB8gHyAfIF7gXyBfIF8gnyCfIF8gXyBfIF8gHyAfIB8f3x/fH98f3t+fH58fnx9e318fnx+fH58fnx+fH59fn1+fH57fnt+fH5+gYCAgICAgICAgICAgH+Bf4GBgYGBgYGAgYCBgYGAgYCBgIGAgoGCfnt/e4B+gH+Af4F/gH+Af3+Afn6AgICAgIB7eXt+fHx6gXh/fnt7e32Bf4CFf4eEh4SPf5SFjoSJe4d+h32AhYCFgYSCgoN/gX6Cf4GDgIGAfoCBgH9/gX2AfX99fnuAfX1+gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDhIGAgoGDgYKEgIJ/gH55fXx+fXxzfXp+fXx6fXx/eYB8gYGAgICFgIF+g32BfIF8g36DfoF/f39/fn9/gYB/gIaAgoCBf4V+hX6EfoV/hYCJgICCgIJ9hH+Ef4J+gX+CgYKAgX+BgIKAgn+CfoF9gn2DfIN8g3uDeYN7g32DfoJ/gn+Agn1/fX57fXp9en17fH1+f3+AfoF/goGBg4GFgYGAgIOEg4SCgYN/hX6Ge4V6hXyDfIF8gX+Cf4KAgn+Gf4V+gYCChIR/hH6GfoZ7hnyIfYiEjIOFg4KBgX6CgH+BgX6AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBgIGBgoGCgYGAgYGBgYR9hYGFgIGBgICCgoKAgYCBgYKBg4CEgIKBgYGCgoB/fYR9gH6AfYB8gH2BfYB8gHyAe4F8gHx+eX96gXx/fH58f31/fX59fX19fH97gXyFfYR+gH+Af4V+hH+Df4J/gn+DgISBhIKEg4WDhYSGhIWEhoSGhIWFhISChIGEgYSBhIGDgYGCgIGAgYCAf4B/gH+Af4F+gX6BfoF+gH6AfoB9gH2AfYB9gH6AfYB9gX2BfYF9gX2BfYF9gn6BfoF9gX2BfYF9gH2AfYB9f31/fX99fn1+fX59fXx9fH19fX19fX19fn1+fX59fX19fX19fX1+fX5+gH+BgIGBgYGBgIGAgYGBgYCBgIGAgYGBgYGBgYGBgYGBgYGBgYGAgYCBgIF/gX+BgIGAgYCBfYCAgn+Ef4J/gXqFfIV9hICKgIp7iIGHfoaAhYOAgXt6e3x7fnuBgISAgoKCg4WDhoSEg4SBg4GCgIOAgoJ/g32CgICAf4B9gX1+fXx9e31/fX6AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAf36CgIB+fHx6gnV+dHR2b3l9fnx/eoF/g4GDgIKDgoSBg4GCgIKBg4GDgIKAg4GAgH6AgX99fn9+g32EfYh+g36CfH9/gIGGgIl/fICBf36BfoF/gX+CgIKAgn+CgIJ/gYB/f4GAgYGBfYJ8hH6FfYV9hXyCfIB/f35+fn19fX59gHx+e319en55gH2AfIB8gH1/gICCgoWCiIF/hH2IhIeCiIGJfop2iniJd4h5hXuFfoaChX+EfoWBhoOFgYV6hXyGfYZ6hn6GeoZ3hYOGfYaBhYqDhYOBgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4ODgYKAgoCEgIR+g4CDg4GCgIGBf4B+gYCCfoJ+gH2Bf4KAgn+Cf4KHg4WChH+BgIJ/g3yFeoF8f3yAfIB8f3x/fIB7f3x/fIB9gHyBfIF6gHp/eoB7gnqCe4F8gXyDfIF9gXyEfIV8hH2EfYR+hH+DgISAhICDgYOBg4KCgoKCg4OCg4KDgYKBgoGBgoCCgYCBgIGAgYCBgIGAgYCBgICAgICAgH+AgICAgICAf4B/gH+Af4B/gH6Af4B+gH6BfoB/gH+Af4B/gH+AfoB+gH+Afn9+f35/fn5+fn5+fn5+fX59fn1+fH58fXx+fH59fn1+fX59fn1+fX59fn1+fX9+gIGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgYB/gX+Bf4B/gH9/f4CAgIB/f4B/gH+AgIB+f36AgICAgIB/f4B/f39/gICEgIWAhX2IgIKBgoB7f3p/gn2DfIJ8gX+Agn+Ef4KBgX2AfIB9f39/fH99foB9fX17fHx7fX1+gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX+DeoJ+goR/hHyAe3x7e315fHd6d3p8fX2BfoOCgYaBhoGFgIV/gn+Ffod+hX+FfoN+gn6DfIJ7iHyBfX59gH99f399hHuBfn5/fn9+f3yAfYB9gX2BfoJ9g32CfoGAgH9/fX59f3+Af4GAgX6CfYN/g4CDgIN+g35/fn5/fH58f31/gH+DfoR7hXuGf4WCgoF/gH5+fX1/gIOAhYWGh4mJhYOKhIx+jHqLeIp5iXmIe4Z/h4KGhIWFhIGEgoWAhn6FgoWAhn6Hfoh+iH6GfIWEhYOFhYWHg4GEeoh9h36Ff4WBgoWAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDgoSBgn6ChIKDgn+Cf4N+hH+FgIaBhoCDgIKCgoCBgIKBgoGAgX+DgIJ+h32FfIJ+fn1/gICAgIB/fn+Af4B/fYF+gX2Be4J7gnuBe4J7hXuFfIN7gnx/fX9+gH+CgIOAg4CDgIOAg3+DfoR/g3+CgIKAgoCBgYGBgYGBgYGBgYCBgYGBgIGAgYCCgIKAgoCCf4J/gn+Cf4J/gn+Cf4J/gn+Cf4F/gX+Bf4F/gn+Cf4F/gX+Bf4F/gX+Bf4J/gn6CfoJ+gn6CfoJ+gn6CfoJ+gX6BfYF9gH2AfYB9f31/fX98f3x/fH98f3x/fH58f3x/fH98f3x/fH99gH+AgICAgICAgIGAgICAgICAgICAgICAgICAgIF/gX+Bf4F/gH+Af4B/gH+Af4B/gX+Af4B/gH+AgICAf3+Af4B/gH+BfoB/f4B8f3x+foN+goCCgH98gX6CfH96g3x/fn2Ae356fn19fn9+f317fn5+eoF8f31/fn99gH+AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBf4J9g4GDhYKEgYCCfYJ5gXmBe4J+gn2AeH1/fnt9hX2CfIR+g3qBfXx/g4B+gYGBgX6FfYN8hH1/fn2AfX59fIR+gn99gHuCfIB9gHt/fH99f3yAe4F8gHx/fX9/f35/f39/gH6AgICAgX+Cf4J+gn2DfYJ9gX6AfYB9gHyBfYJ9g4KDf4N5gnqAe4B+g4SFhoSAg32CeIF0g3OIeoyEj4eRf458j4eRgpSFlZKIgYZ/h3mIgIeFhoSGh4aDhoKEgIZ/h4CGgYd/iICJgIiAh4OGg4WDh4OGfoZ/h32JfIp7jYSMg4uAioOMhIyDjISHiYGGgICAgICAgICBgYKBgoCCgIJ/gX6Af4F9gX2CgIOBhIGEf4SBhYGFgIWBhX6FgIWBhICDf4OBg4OEgoSAg4GBhIGFgoKAgYCCgIKAgX+AfoJ9gX2BfYJ+gn+CfoF+gX6BfoJ+g36Df4J/g3+CfoJ9gX2BfYF9gH2BfIJ8g3yDfIN9gn6CfoF/gX+Bf4GAgYCBgIGAgYGBgYCBgIGAf4B/f4B/gH+Af4B/gX+BfoF+gX6BfoF+gn6CfoJ+gn2DfYR9hH2EfYR9hH2EfYV9hX2EfYV9hXyFfIV8hXyEfIR8hXyFfIV8hnuGe4Z7hXuFe4V7hHyEfIN8g3yCfIJ8gXyBfIF8gHyAfIB8gHyAfYB9gH6Af4B/gH+Af4CAgICAgICAgICAgICAgICAgIB/gX+Bf4F/gH+Af4B/gH+Af4B/gH+Af4B/gH+Af4B/gH+Af4B/gX+Bf4CAgYCAgICAgICAgICAgIB/gIB9gICBfYFwgH5/g4B8gH5/fn5+f4CBgIGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYF9g4CCg4GDgYOBf4OBhH6FfYZ8hnuGfYZ7hH2FhIV5hHyDgIB/goN/gn18fnx9fn6FfoN+gICAfoJ8gHx9fX1+en99gH+Af4B+f3uAf4B/gH5+fnx7fX2AfoN/g32Bfn98f3t/gH6Af3+AfoB/gH6AfYB8gHx/fH98fn5+fn+AgH+BfYB7fnx+fX99f32BfoJ/hICFfYV5hXaGcoZ7iIGKhYqEin+JfYl9jH+PgI19hYKDhYOEhYKEfoJ/hYKHhIaGhYSGgId9iXyJgIl/iXyKfomDiYaHgoZ+hHqEd4V4iHuKgIyBjn+Nf46CjYWOho+JkI6Uh5N9jHyKfYqAiYGIgIiAh4CGf4Z+hnyHfIh8iH6Hf4iBh4CGgIWAhICFgIaBh4OHhYWFhYaGhIeDiIOHhIWEg4SCg4GDgYKAgn+EfoV+hX2DfoJ+gX+Bf4F/gH+Bf4J/g36DfYN9gn2CfoJ+gn6CfoF+gX6BfoF+gX6BfoF+gX6BfoF+gX6BfoF/gH+Af4B/gH+Af4B/gH+AfoB+f39/f39/fn9+f35/fn9+f31/fX99gH2AfYF8gXyBfIF8gnyCfIJ8gnyDfIN8hHyEfIR8hHyDfYR8hXuFe4Z6hnuGe4Z7hnuGe4Z7hnuGe4d7h3uHe4d7h3uHe4d7h3uGe4Z7hXuFe4R8hHyDfYN9gn6Cf4J/gn+Bf4F/gX+Bf4F/gX+BgIGAgYCBf4F/gX+Bf4F/gICAf4B/gH+AgIF/gX+Af4F/gX+Bf4F/gX+BgIGAgYCBf4F/gH+Af4CAgICAgICAgICAgICAgICDf4N6gHmCe4B8fn1/fYB+gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAf4J6g32EgYSBhICFf4R+hHyEeoV6h3yJe4l9in2Leop3h3yFf4R7gnx/fn19gH2BgICCgX6AgX2IgIeAfYB7gHp8eoB/gYCCf4CAfHqAfYB/gHuBfoB+f35/fYB9gHyAfoB9f31+fn5+fn1+fX99f3uAfIB8gHt/e398fn1+fX5/f4J/fn98gX2BfYJ8gn2Be4F9g36FfYh8h32De4F9fnx9gHyCe4R9hH6CfX58fX9/gYCBfoKAgoSDiIKHgYeDhIZ+h32IfIh8iX2Jf4uBi32KfomCiYOJhoiFh4CGfIV6hHqFeYd+iH+HgIeDiIWHh4iEj4CMf4mBh4GHgIaCh4KHgYiBiIGIgoiCiIGGgIWAhIGDgYOBgoGCgIKAgYCBf4F/gX+Bf4KAgoCDgIOBg4GEgYSBg4GCgYKBgoCBgYCCgISBhIGCgYKBgYGBgYCAgYCBgIF/gn+Cf4F/gX+Bf4F/gX+Bf4F/gH+Af4B/gH+Af4B/gH+Af4B+gH6AfoB+gH6AfoB+gH6AfoB+gH6Af35/fn9/f39/fn9+f35/fn99f31/fX59fnx+fH58fnx+fH58f3x/e398f3yAfIB8gXuBe4F7gXuCe4N7g3qDe4R7hHuEe4R7hHqFeoV6hXqFeoZ6hnqGeoZ6h3qHeoh7iHuIe4h7iHuIe4h8iHyIfYd+h36Hfod/hn+Gf4V/hX+Ff4R/g3+Df4J/gn+Cf4J/gX+Bf4F/gX+Af4B/gH+Bf4F/gX+Bf4GAgYCBgICAgICAgICAgICAgIF/gX+BgIF/gICAgICAgICAgICAgICAf4J/gX+AfoB9f32BfYB+gX+BgICAgYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB+fnt/gIF+g36DfYN6gniAd4F5gnyEeYR3hnmIc4l0iHaHeYV5hHqEe4R0gnmAf4GAgoKBjYGCgH2AfoB+hX+DgIN9gX6Df4Zzh3GFd4R5hHuBeX16fHp9eX15fnp/e399gH5/fn99f3x+fH57fnt+e357fnx+fH57f3t+f31+fn9+fn5+fn59fHx8fH5+fn9+gH2BfH97gHt/e396f3p/fH99gH6Af4CAgYCBgIOAg3+Ef4SAhYKEh4WMhYaGgoeAh4GGgId/iX+JgIp/ioGJgYiEiIKIgoiBhoCFgIV9g36BgX+BgIKAgIGAhYWIhImEiYGHgYeBiIOIg4iDiIKHgoaChYKFgYWBhYGEgYSAhIGEgISAhICEgIOAg4CDgIN/g3+Df4N/hH+Ef4N/g3+DgIOAg4CDgIOAg4CDgIOAg4CDf4OAg4CDgIJ/goCBgYGBgYGAgYCBgICAgICAgICAgICAgIB/gH+AfoB+gH5/fn9+f35/fn9+f35/fn9+f35/fn9+f35/f39/f39/gH5/fn9+f36Afn99gH2AfYB9f31/fX99f31/fX58fnx+fH58fnx+fH98f3x/fH97f3t/e397f3t/e4B7gHqAeoF6gXqCeoJ6g3qDeYN5hHqEeoR5hXmFeYZ5hnmGeYd5h3qHeoh6iXuJe4l8iXyJfYl9iX6Jfol+iX6Jfol+iX6Jf4l/iH+If4h/h3+Gf4V/hX+Ef4N/g3+Cf4J/gn+Bf4F/gX+Cf4F/gYCAgICAgICAgICAgYCBgIGAgYCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAfYF7gXmAen96fnt+fICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDgoSAhIKEgoWBgn+AfIF5g3iDeIR2hm6EboJ3gneCeIN3g3eCeoF7gXuAe359fYB+goCCgX+CgIJ9gXyAfYB7gHp+e396fnx+fIB4f3h/fIB8gXqAeoB5fnd8eX16fnt+fH19fX19fX19fHx9fH18fXx+e357fnt+fX1+fH58fXx+fH18e3x9fX1+fn9+f31/fn1/fH19f36CfH9+f3+CgIOChISEhoSHg4iDiIGIgIiAhoOFkIiJhoGGgoaBh4KJg4mDiYOIgoiDiIOHg4eDh4OFgoWEhoOGhIWGgoSBgYCAgIODgISAhoGHg4iDiIOIg4eDh4OHg4aDhoKGgoaChYKFgYWBhYGFgYWAhICEgISAhICEgISAhICEgISAhICEf4R/hH+Ef4N/g3+Df4N/g4CDgIOAg4CDgIOAhICEgISAhH+Df4N/g3+Cf4J/gn+Bf4F/gX+Bf4F/gH+Af4B+gH6Af4B/gH+Af39/f39/fn9+f35/f39/f35/foB+gH6AfoB+gH9/f39/f36AfoB+gH6AfoB+gH2AfYB9gH2AfYB9f31/fX98f3x/fH98f3t/e397f3t/e397f3x/fH97f3t/e4B6gHqAeoF6gXqBeYJ5gnmDeYN5g3mDeYN5hHmEeYR5hHmEeYV5hXqFeoV6hXqFeoV7hnuGfIZ8h32IfYh+iX6Jfol+iX+Kf4p/in+Kf4p/in+Kf4l/iX+JgImAiYCIgIiAh4CHgIaAhYCFgIR/g3+Df4J/gn6BgIGAgICBgIGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9f3yAeYB3f3p+fH15gICAgICAgICAgICAgICAgICAgICAgICAf4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgICBgIGAgYCBgIGBgIGBgIF/gH5/fH57fnp+en94f3Z+dX12fXd9eHx5fHl8eX14fXh8eHx4fHh8eXx5fHl8eHx3fXh8d3x3fXh9eH15fXp+en56fnp9eX15fXl8eHx3fHh9eX56fnt+e359fn5+fn99f31/fX99f3x/fH99f39/gH1/fX58gHuBe4F8gH2Afn9+f36Afn9+gX6BfoJ/goCFgYeBh4KGgoaCh4OIg4eEhoSGhIaEh4OIg4eCi4WLhoaFgoWChIOFhIWEhYSFhYWEhYSGhIWFhYaFhYWEhoOHg4aFh4WHg4aDhoCHgYeChoOGgoaChoOGg4WDhYKFgoaChoKFgYWBhYGFgYWBhYCFgISAhICEgISAhICEgISAhICEf4R/hH+Ef4R/hH+Ef4R/hH+Ef4R/hH+Ef4R/hH+Ef4R/hH+Ef4R/g3+Df4OAg3+Df4N/g3+Df4J/gn+Cf4F/gX+BfoF+gX6BfoF+gX6BfoF+gX6BfoF+gX6BfoF+gX6AfoB+gH2AfYB+f35/fn9+gX6BfoF9gX2BfYF9gX2BfYF9gX2BfYF9gX2BfIF8gXyBfIB8gHuAe4B7gHuAe4B7gHuAeoB6gXqBeoF6gXqBeoF6gXqBeoJ6gnqCeoJ6gnqCeoJ6g3qDeoN6g3qDeoN6g3qDeoN6g3qEe4R7hHuEe4V7hXyFfIZ8hn2GfYZ9hn2HfYd9h36Ifoh+iH6If4h/iX+Jf4mAiYCJgImAioCKgYqBioGJgYmBiICHgId/h3+GfoV+hX6FfoR+g36DfoN/g3+Cf4F/gX+BgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIB/gH9/fn5+f35/fn9+gH6AfoB+gH6Bf4B/gH+Af4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGAg4CDgYKAgYCBgICAgICBgIF/gX+Af4B/gH6AfoB+gH2AfIF7gXqBeYF4gHiAeIB4f3d/d352fnZ+dn92fnZ9dn12fHZ7dnt2e3Z7dXt1e3Z7dnt2e3Z7dnx3e3d8d3x3fHh8eHx4fHh8eXx5fHl8eXx5fHl8eXx6fHp8enx7fHt8fH19fX58fnx+fH98f3t+e397f3t/e397f3t/e4B7f3t/e4F8gn2CfoJ+gX6Afn9+gH2BfYJ9g32DfYR9hX2FfoZ/hn+GgIWAhYCFgYWBhYGFgoWDhYOEhISEhISEhISEhISEhISEhISDhIOFg4WDhYKFgoSChIKEgoSChIKEgoSChIGEgYWBhYGFgYSBhIGEgYWBhYGEgYSBhIGEgISAhYCFgIWAhYCEgISAhICEgISAhICEf4R/hH+Ef4R/hH+Ef4R/hH+Ef4R/hH+Ef4R/hH+Ef4R/hH+Ef4R/hH+EgISAhH+Ef4R/hH+Ef4R/hH+Df4N/g3+Df4N+g36DfoJ+gn6CfoJ+gn6CfoJ+gn6CfoJ+gn6BfoF+gn6CfoJ+gn6CfoJ+gn2CfYN9g32DfYN9gn2CfYJ9gn2CfYJ9gn2CfIJ8gnyCe4J7gnuCe4J7gnuCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ6g3qDeoN7g3uDe4N7g3uDe4R7hHuEe4R7hHyEfIV8hXyFfIV8hX2FfYZ9hn2GfYZ9hn2GfYZ9hn2HfYd9h32Hfod+h36Hfoh+iH6If4h/iH+If4h/iH+If4h/iH+Ifoh+iH6Ifoh+iH6Ifoh9iH2HfYd9h32HfYZ9hn2HfYZ9hX2FfYV9hX2FfYR9hH2EfYR9hH2DfYN9g32DfYN9g32DfoN+g36DfoN+gn6CfoF+gX6BfoF+gX6AfoB+gH6AfoB+gH6AfoB+gH6BfoF+gX6BfoF+gX6BfoF+gX6BfoF+gH6AfoB+gH6AfYB8gHuBe4F6gXqAeYF4gXiBd4F3gHd/d393fnZ+dX51fnR+dH9zf3N+dH11e3V7dXt0fHR8dHx0fHR9dH10fXV8dXx1fHZ8dnx2fHZ9eHx4fHl7eXt5fHl8eXx5fHl8enx6fHp8e3x7fHt8e3x8fHx7fXt9fH58fnx/fH98f3yAe4B7f3t/e4B7f3uAe4B7gHqAeoB7gHuAfIF8gnyCfYJ9gn2DfYN+gn+Cf4N/g3+Df4R/hICEgISAhICEgYSCg4KEg4WDhIOEhIWEhYSFhIWEhYSFhISFhIWEhYSFhIWDhYOFg4SDhYOFg4WChYKFgoWChYKEgYWBhYGFgYWBhYGFgYWAhYCFgIWAhYCFgIWAhYCFgIWAhYCEgISAhICEgISAhH+Ef4R/hH+Ef4V/hX+Ff4R/hH6EfoR+hH6EfoR/hH+Ef4R/hH+Ef4R/hH+Ef4R/hH+Ef4R/hH+Ef4R+hH6Ef4R/hH+EfoR+hH6EfoR+hH6EfoR+g36DfoN+g36DfoN+g36DfoN+g36DfoN+g36CfYJ9gXyBfIF8gnyCfIJ7gnuCe4J7gnuCe4J7gnuCe4J7gnuDeoN6g3qDeoN6g3qDeoN6gnqCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ7g3uDe4N7g3uDe4N7g3uDe4N7g3uDe4R7hHyEfIR8hHyEfIR8hH2FfYV9hX2FfYV9hX2FfYV9hX2FfYV9hX6FfoZ+hn6GfoZ+hn6GfoZ+hn6GfoZ+hn6GfoZ+hn6Hfod+h36Hfod+h36Hfod+iH6Ifoh9iH2IfYh9h32HfYd9h32HfYd9h32HfYd9h32IfYh8iHyHfId8h32HfYd8h3yHfId8h3yHfId8h3yGfIZ8hnyGfIZ8hnyGfIZ8hnyGfIZ8hnyGfIZ7hnuGe4Z6hXqFeoV6hHuEe4R7hHuDe4N7g3uDe4N7g3uDe4N7g3qDeoN6g3mDeYN5gnmCeIJ4gniCeIJ3gXeBd4F2gXaAdoB1gHWAdH90f3R/dH90fnR+dH50fnN+c350fnR9dX11fHV8dnx2e3d7d3t3e3h7eHx5fHl7ent6e3p8e3t7e3t7e3t7e3t7fHt8e3x7fHt9fH58fnt/fH98f3x/fIB7gHuAfIB8gHyAfIB8gHyAfIB8gHyAfIB8gHuAfIB8gXyBfIJ9gn2BfoJ+gn6DfoN+g3+Df4N/hH+EgISAhYCFgIWBhYGFgoWChYKFg4WDhYSEhIWEhYSFhIWEhYSFhYWFhYWEhYSFhIWEhYSFg4WDhYOFgoWChYKFgYWBhYGFgYWBhYGFgYWBhYCFgIWAhYCFgISAhICEgISAhICEgISAhICEf4R/hH+Ef4R/hH+Ef4R/hH+EfoR+hH6EfoR+hH6EfoR+hH6EfoN/g3+Df4N/g3+DfoN+hH6EfoR+hH6EfoR+hH6EfoR+hH6DfoN+hH6DfoN+g32DfYN9g36DfoN+g36DfYJ9gn2CfYJ9gn2CfYJ9gn2BfYF9g3qDeoN6g3qDeoN6g3qDeoN6gnqCeoJ6gnqCeoJ6g3qDeoN6g3qDeoN6g3qDeoN6gnqCeoJ6gnuDe4N6g3qDe4N7g3uDe4N7g3uDe4N7g3uDe4N7g3yCfIJ8gnyCfYJ9gn2DfYN9g32DfYN9hH2EfYR9hH2EfYR+hH6EfoR+hH6EfoR+hH6FfoV+hX6FfoV+hX6FfoV+hX6FfoV+hX6FfoV+hX6FfoV+hX6GfoZ+hn6GfoZ+hn6GfoZ+hn6GfoZ+hn6GfoZ+hn6GfYZ9h32HfYd9hn2GfYZ9hn2HfYd9h32HfYd9h32HfYd9h3yHfId8h3yHfId8h3yHfId8h3yHfId8h3uHe4d7h3uHe4d7h3uHe4d7h3uGe4Z6hnqGeoZ6hnqFeoV6hXqFeoV6hXqFeoR6hHqEeoR5hHmEeYR5hHmDeYN5g3mDeIN4g3iDd4N2gnaCdYJ1gnWBdYF1gXWBdYB1gHWAdX91f3V/dX51fnV+dn12fXZ8d3x4fHh8eHt4e3h7eHt4e3h7eHt5e3l7eXt6enp6e3p7e3t7fHt8e317fXt9e317fXt9fH58fnx+fH58fnx/fH98gHyAfIB8gXuBfIB8gHyAfIB8gXyBfIF9gX2BfYF+gX6BfoF+gX6BfoF+gX6CfoJ+gn6CfoJ/g3+DgIOAg4CEgISAhIGEgYSBhIGEgYWChYKFgoWChIKEg4SDhIOEhISEhISEhISEhISEhYOFg4WDhYOFg4WChYKFgoWChYKFgoWBhYGFgYWBhYGFgIWAhYCFgIWAhYCFgIV/hX+Ff4V/hX+Ff4V/hX+Ff4V+hX6FfoV+hX6FfoV+hX6EfoR+hH6EfoR+hH6DfoN+g36DfoN+hH6EfoR+hH6EfoR+hH6EfYR9g32DfYN9g32DfYN9g32DfYN9g32DfYN9g32CfYJ8gnyCfIJ8gnyCfIJ8gnuCe4J7g3uDeoN6gnqCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ6gnuCe4J7gnuCe4J7gnuCe4J7gnuCe4J8gnyCfIF8gXyBfIF9gX2BfYF9gX2BfYF9gn2CfYJ9gn2CfYJ9gn2DfoN+g36DfoN+g36DfoN+g36DfoN+hH6EfoR+hH6EfoR+hH6EfoR+hH+Ef4R/hH+Ef4R/hH+EfoR+hX6FfoV+hX6FfoV+hX6FfoV+hX6FfoV+hX6FfoV+hX6FfoV+hX2FfYV9hX2FfYV9hX2FfYV9hX2FfYV9hX2FfYV9hX2FfYV9hX2FfYV9hnyGfIZ8hnyGfIZ8hnyGe4Z7hnuGe4Z7hnuGe4Z7hnuGe4V7hXuFe4V7hXuFeoV6hXqFeoV6hXqFeoR6hHmEeYR5hHmEeYR5hHmEeYN4g3iDeIN4g3iDeIN4gniCeIJ4gniCeIF4gXiBeIF4gHiAeIB4gHh/eH94f3h+eH54fnh+eX55fXl9eX15fXl9eX16fXp9en16fXt9e317fHt8fHx8fHx8fHx9fH18fXx9fH18fXx9fH18fXx+fX59fnx+fH58f3x/fH98gHyAfIB8gHyAfYB9gH2AfYB9gH2AfYB9gH2BfoF+gX6BfoF/gX+Bf4F/gX6BfoF+gX6Bf4F/goCCgIKAgoCCgIKAgoCCgIKAgoCCgYKBgoGCgYKBgoGCgYKBgoGCgoKCgoKCgoKCgoOCg4KDgYOBg4GDgYSBhIGEgYSBhIGEgYSBhICEgISAhICEgISAhH+Ef4R/hX+Ff4R/hH+Ef4R/hH6EfoR+hH6EfoR+hH6EfoR+hH6DfoN+g36DfoN+g36DfoJ+gn6CfoJ+gn6CfoJ+gn2CfYJ9g3yDfIN8g3uDe4N7g3uDe4N7g3uDe4N7g3uDe4J6gnqCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ6gXmBeYF5gXmBeoF6gXqBeoF6gXqBeoF6gXqBeoF6gXqBe4F7gXuBe4F7gXuBe4F7gXuBe4F7gXyBfIF8gXyBfIB8gH2AfYB9gX2BfYF9gX2BfYF9gX2BfYF9gX2BfYF+gX6BfoF+gX6CfoJ+gn6CfoJ/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4N/g3+Df4N/g3+Df4N/g3+Df4N/g3+Df4N/g3+Df4N/g3+Df4R/hH+Ef4R/hH+Ef4R/hH+Ef4R+hH6EfoR+hH6EfoR+hH6EfoR+hH6EfoR+hH6EfoR9hH2EfYR9hH2EfYR9hH2EfYR9hHyEfIR8hHyEfIR8hHyEfIR8hHyEe4R7hHuEe4R7hHuEe4R7hHuEe4N7g3uDe4N7g3uDe4N7g3uDeoN6g3qDeoJ6gnqCeoJ6gnqCeoJ6gnqBeoF6gXqBeoF6gXqBeoF6gHqAeoB6gHqAeoB6gHqAeoB6f3p/en96f3t/e397f3t+e357fnt+e358fnx+fH58fnx+fH58fnx+fH58fnx+fH58fXx9fX19fX19fX19fX19fX19fX19fX1+fX59fn1+fX59fn1+fX59f31/fX99gH2AfYB9gH2AfYB9gH2AfoB+gX6Bf4F/gX+BgIGAgYCBgIGAgYCBgIGAgYGCgYKBgoGCgoKCgoKCgoKCgoKBgoGCgYKBgoGCgYKBgoGCgYKBgoGCgIOAg4CDgIOAg4CDgIOAg4CDgIOAg4CDgIOAg4CDgIN/g3+Df4N/g3+Df4N/g3+Df4N+g36DfoN+g36DfoN+g36DfoN+g36DfoN+gn6CfoJ+gn6CfoJ+gn2CfYJ9gn2CfYJ9gn2CfYJ9gn2CfIJ8gnyCfIN8g3uDe4N7g3uDe4N6gnqCeoJ6gnqCeoJ6gnqCeYJ5gnmCeYJ5gnmCeYJ5gnmCeYJ5gnmCeYJ5gnmCeYJ5gnmCeYJ5gnmCeYF5gXuBe4F7gXuBe4F7gXuBe4F7gXuBe4F7gXuBfIF8gHyAfIB8gHyAfIB8gHyAfIB9gH2AfYB9gH2AfYB9gH2AfYB9gH2AfoB+gH6AfoB+gH6AfoB+gH6AfoB+gH6BfoF+gX6BfoF+gX+Bf4F/gX+Bf4F/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Df4N/g3+Df4N/g3+Df4N/g3+Df4N/g3+Df4N/g3+Df4N/g3+Df4N/g3+DfoN+g36DfoN+g36DfoN+g36DfoN+g36DfoN+g32DfYN9g32DfYN9g32DfYN9gn2CfYJ9gn2CfYJ9gn2CfYJ9gn2CfYJ9gn2CfYJ9gnyCfIJ8gnyBfIF8gXyBfIF8gXyBfIF8gXyBfIF8gXyBfIF8gXyAfIB8gHyAfIB8gHyAfIB8gHyAfIB8gHyAfIB8f3x/fH98f3x/fH98f3x/fH98f3x/fH98f3x/fX99f31/fX59fn1+fX59fn1+fX59fn1+fX59fn1+fX59fn1+fX59fn1+fX59fn1+fX1+fX59fn1+fX59fn1+fn9+f35/fn9+f35/fn9+f35/fn9+f36AfoB+gH6AfoB/gH+AgIGAgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGCgYKCgoKCgoKBgoGCgYKBgoGCgYOBg4GDgYOBg4GDgIOAg4CDgIOAg4CDgISAhICEgISAhH+Ef4R/hH+Ef4R/hH+Ef4R/hH+Ef4R/hH+Ef4R/hH+EfoR+hH6EfoR+hH6EfoR+hH6EfoR+hH6EfoR+hH6EfoR+hH2EfYR9hH2EfYR9hHyEfIR8hHyEfIR8hHyEfIR8hHyDfIN7g3uDe4N7g3uDe4N7g3uDe4N7g3uDe4N7g3uDe4N7g3uCe4J7gnuCe4J7gnuCe4J7gnuCe4J7gnuCe4J7gnuCe4F7gX+Bf4F/gX+Bf4F/gX+Bf4F/gX+Bf4F/gX+Bf4F/gX+Bf4F/gX+Bf4F/gX+Bf4F/gX+Bf4F/gX+Bf4F/gX+Bf4GAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J+gn6CfoJ+gn6CfoJ+gn6CfoJ+gn6CfoJ+gn6CfoJ+gn6CfoJ+gn6CfoJ+gn6CfoJ+gX6BfoF+gX6BfoF+gX2BfYF9gX2BfYF9gX2BfYF9gX2BfYF9gX2BfYF9gX2BfYF9gX2BfYB9gH2AfYB9gH2AfYB9gH2AfYB9gH2AfYB9gH2AfYB9gH2AfYB9gH1/fX99f31/fX99f31/fX99f31/fX99f31/fX99f31/fX99f31/fX9+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5/fn9+f35/fn9+f35/fn9+f35/fn9+f35/fn9+f35/foB+gH6AfoB+gH6AfoB+gH6AfoB+gH6AfoB+gH6AfoB/gX+Bf4F/gX+Bf4F/gX+Bf4F/gX+BgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGAgYCBgIGAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gX+Bf4F/gX+Bf4F/gX+Bf4F/');

      // Clear synthetic field built by stampPath above
      U.fill(0); V.fill(0); Wt.fill(0); CLS.fill(0);
      for(let c=0;c<NCLS;c++) CWt[c].fill(0);
      for(let c=0;c<4;c++) spawnByClass[c].length=0;  // clear ocean spawn lists (keep wind 4-6)

      // Bilinear interpolation: 1° input grid → 1.5° working grid
      for(let y=0;y<GH;y++){
        const la=-90+(y+0.5)*CELL;
        const gy=la+90;
        const y0=Math.max(0,Math.min(GH2-2,Math.floor(gy)));
        const y1=y0+1;
        const fy=gy-y0;
        for(let x=0;x<GW;x++){
          const lo=-180+(x+0.5)*CELL;
          const gx=((lo+180)%360+360)%360;
          const x0=Math.floor(gx)%GW2;
          const x1=(x0+1)%GW2;
          const fx=gx-Math.floor(gx);
          // Bilinear sample U
          const i00=(y0*GW2+x0)*2, i01=(y0*GW2+x1)*2;
          const i10=(y1*GW2+x0)*2, i11=(y1*GW2+x1)*2;
          const u=((raw.charCodeAt(i00  )-HALF)*(1-fx)*(1-fy)+
                   (raw.charCodeAt(i01  )-HALF)*fx    *(1-fy)+
                   (raw.charCodeAt(i10  )-HALF)*(1-fx)*fy    +
                   (raw.charCodeAt(i11  )-HALF)*fx    *fy    )*SCALE;
          const v=((raw.charCodeAt(i00+1)-HALF)*(1-fx)*(1-fy)+
                   (raw.charCodeAt(i01+1)-HALF)*fx    *(1-fy)+
                   (raw.charCodeAt(i10+1)-HALF)*(1-fx)*fy    +
                   (raw.charCodeAt(i11+1)-HALF)*fx    *fy    )*SCALE;
          const k=y*GW+x;
          if(LAND[k]) continue;          // skip land cells
          const spd=Math.hypot(u,v);
          // Do NOT skip near-zero-speed cells here — that used to exclude
          // them from CLS/spawnByClass entirely, leaving grid-aligned dark
          // patches with no particles (common near the equator, e.g. weak
          // equatorial countercurrent zones). The spd<0.08 "slow -> gyre"
          // branch below already covers near-zero speed as a subset.
          U[k]=u; V[k]=v; Wt[k]=spd;
          // Classify cell: 0=warm(poleward), 1=cold(equatorward), 2=ACC(high-lat), 3=gyre(slow)
          const absLat=Math.abs(la);
          let cls;
          if(absLat>45)                         cls=2;  // high latitude → ACC-style
          else if(spd<0.08)                     cls=3;  // slow → gyre
          else if((v>0&&la>0)||(v<0&&la<0))    cls=0;  // poleward → warm
          else                                  cls=1;  // equatorward → cold
          CLS[k]=cls; CWt[cls][k]=spd;
          spawnByClass[cls].push([lo,la]);
        }
      }
      // Smooth warm/cold classification noise: the sign of v (meridional
      // velocity) decides warm vs cold, but v is small/noisy anywhere flow
      // is mostly zonal (e.g. near the equator), so adjacent cells can end
      // up in different classes even though the current is continuous —
      // a 3x3 majority-vote pass over CLS (not over U/V; particle physics
      // is untouched) smooths that out. See _smoothOceanClass definition.
      _smoothOceanClass();
      // Gyre ellipse ring points → class 3 spawn list
      (GF.GYRES||[]).forEach(g=>{
        (g._ringPts||[]).forEach(([lon,lat])=>{
          if(lat>=-89&&lat<=89) spawnByClass[3].push([lon,lat]);
        });
      });
      console.log('[CMEMS velocity] loaded. Ocean cells:',
        U.reduce((n,v,i)=>n+(v!==0?1:0),0));
    })();

    // Build immediately — land mask is now synchronous
    rebuildSpawnWeights();

    // ════ REAL JET STREAM DATA ═══════════════════════════════════════
    // Replaces analytical Rossby-wave geometry with real ERA5 300 hPa winds.
    // Source: ERA5 monthly mean, 300 hPa u+v, 1°×1° annual mean
    // Encoding: uint8, -80…+80 m/s → 0…255 (128 = zero wind)
    // window._jetU / _jetV: Float32Arrays (GH×GW = 180×360), m/s
    (function(){
      const JVMAX=80, JHALF=128, JSCALE=JVMAX/127.5;
      const JGW=360, JGH=180;
      const raw=atob('gYGBgYGBgYGBgYGBgYGBgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIJ/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gn+Cf4J/gX+Bf4F/gX+Bf4F/gX+BfoF+gX6BfoF+gX6BfoF+gX6BfoF+gX6BfoF+gX6BfoF+gX6BfoF+gX6BfoB+gH6AfoB+gH6AfoB+gH6AfoB+gH6AfoB+gH6AfoB+gH5/fn9+f35/fn9+f35/fn9+f35/fn9+f35/fn9+f35+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn59f31/fX99f31/fX99f31/fX99f31/fX99f31/fX99gH2AfYB9gH2AfYB9gH2AfYB9gH2AfYB9gH2AfYB9gX2BfYF9gX2BfYF9gX2BfYF9gX2BfYF9gX2BfYF9gX2CfYJ9gn2CfYJ9gn2CfoJ+gn6CfoJ+gn6CfoJ+gn6CfoJ+gn6CfoJ+gn6DfoN+g36DfoN/g3+Df4N/g3+Df4N/g3+Df4N/g3+Df4N/g3+Df4N/g3+DgIOAg4CDgIOAg4CDgIOAg4CDgIOAg4CDgIOAg4CDgIOAg4CCgIKAgoGCgYKBgoGCgYKBgoGCgYKBgoGCgYKBgoGCgYKBgoGCgYKBgoGCgYKBgoGCgYKBgoGCgYKBgoGCgYKBgoGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgICAgICAgICAgICAgICAgICAgICAgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoGCgYKBgoGCgYKBgoGCgYKBgoGCgYKBgoGCgYKBgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCg4KDgoOCg4GDgYOBg4GDgYOBg4GDgYOBg4GDgYOAg4CDgIOAg4CDgIOAg4CDgIN/g3+Df4N/g3+Df4N/g3+DfoN+g36DfoN+g36DfoN+g36DfYN9gn2CfYJ9gn2CfYJ9gn2CfYJ9gn2BfIF8gXyBfIF8gXyBfIB8gHyAfIB8gHyAfIB8f3x/fH98f3x/fH98fnx+fH58fnx+fH58fXx9fH18fXx9fH18fXx8fHx9fH18fXx9fH18fXt9e317fXt9e357fnt+e357fnp+en56f3p/en96f3p/en96f3qAeoB6gHqAeoB6gHqBeoF6gXqBeoF6gXqCeoJ6gnqCeoJ6gnqDeoN6g3qDeoN6g3qDeoR6hHqEeoR7hHuEe4R7hHuFe4V7hXuFe4V8hXyFfIV8hXyFfIZ8hn2GfYZ9hn2GfYZ9hn2GfoZ+hn6GfoZ+hn6Gf4Z/hn+Gf4Z/hn+Gf4aAhoCGgIaAhoCGgIaBhoGGgYaBhoGFgYWBhYGFgYWChYKFgoWChYKFgoWChIKEgoSChIKEgoSDhIOEg4SDg4ODg4ODg4ODg4ODg4ODg4KDgoOCg4KDgoOCg4KDgoOCg4KDgYOBg4GDgYOBg4GDgYOBg4GDgYOBg4GDgYOAg4CDgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIKAgoCCgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgICAgICAgICAgICAf36AfoB+gH6AfoB+gH6AfoB+gH6BfoF+gX6BfoF+gX6BfoF+gX6BfoJ+gn6CfoJ+gn6CfoJ+gn6CfoN+g36DfoN+g36DfoN+g36DfoN+g36EfoR+hH+Ef4R/hH+Ef4R/hH+Ef4R/hH+Ef4SAhYCFgIWAhYCFgIWAhYCFgIWBhYGFgYWBhYGFgYWBhYGFgoWChYKFgoWChYKFgoWDhYOFg4SDhIOEg4SDhISEhISEhISEhISEhISDhIOFg4WDhYOFg4WDhYKFgoWChYKFgoWChYGFgYWBhYGFgYWAhYCFgIWAhYCFgIV/hX+Ff4V/hX+FfoV+hX6FfoV+hH6EfYR9hH2EfYR9hH2EfYN8g3yDfIN8g3yCfIJ8gnuCe4J7gXuBe4F7gXuAe4B7gHp/en96f3p/en56fnp+en56fXt9e317fXt8e3x7fHt8e3t7e3t7e3t7enx6fHp8enx6fHl8eXx5fXl9eX14fXh9eH54fnh+eH54f3d/d393f3eAd4B3gHeAd4F3gXeBd4F3gneCd4J3gneDd4N3g3eDd4R3hHeEd4R4hXiFeIV4hXiGeIZ4hnmGeYZ5h3mHeYd5h3qHeod6h3qIe4h7iHuIe4h7iHyIfIh8iHyIfYh9iH2IfYh+iH6Ifoh+iH+If4h/iH+IgIiAiICIgIiBiIGIgYiBiIKHgoeCh4KHgoeCh4OHg4eDhoOGg4aDhoOGhIaEhoSFhIWEhYSFhIWEhYSFhISFhIWEhYSFhIWEhYOFg4WDhYOFgoWChYKFgoWChYGFgYWBhYGFgYWBhYCFgISAhICEgISAhICEgIR/hH+Ef4R/hH+Ef4R/hH+Df4N/g3+Df4N+g36DfoN+g36DfoN+gn6CfoJ+gn6CfoJ+gn6CfoF+gX6BfoF+gX6BfoF+gH6AfoB+gH6AfoB/gH+Af4B/f39/f39/f39/f39/f39/f39/f39/f32AfYB9gH2AfIB8gHyAfIB8gXyBfIF8gXyBfIF8gnyCfIJ8gnyCfIJ8gnyCfIJ8g3yDfIN8g3yDfIR8hHyEfIR8hHyEfYR9hX2FfYV9hX2FfYV9hX2FfYV9hX2GfYZ9hn2GfoZ+hn6GfoZ+hn6GfoZ/hn+Hf4d/h3+Hf4d/h4CHgIeAh4CHgIeAh4GHgYeBh4GHgYeBh4KHgoeCh4KHgoaChoOGg4aDhoOGhIaEhoSGhIaFhoWGhYaFhoWGhoWGhYaFhoWGhYaFh4SHhIeEh4SHhIeEh4OHg4eDh4OHgoeCh4KHgoeBh4GHgYeBh4CHgIeAh4CHf4d/h3+Hf4Z/hn6GfoZ+hn6GfYV9hX2FfYV8hHyEfIR8hHuDe4N7g3uCe4J6gnqBeoF6gXqAeoB6gHp/en96f3p+en56fXp9en16fHp8enx6e3p7ent6enp6enp6eXt5e3l7eHt4e3h8eHx3fHd8d313fXZ9dn12fnZ+dn52f3V/dX91gHWAdYB1gXWBdYF1gnWCdYJ1g3WDdYN1hHWEdYR1hXWFdYV1hnWGdoZ2hnaHdod2h3aHd4d3iHeIeIh4iHiIeIl5iXmJeYl6iXqJeol7iXuJe4l8iXyKfIp9in2KfYp+in6Jfol/iX+Jf4mAiYCJgImBiYGJgYmCiIKIgoiCiIOIg4iDiIOHhIeEh4SHhIeEhoSGhYaFhoWGhYWFhYWFhYWGhYaEhoSGhIaEhoSGhIaDhoOGg4aDhoOHgoeCh4KHgoeCh4GHgYeBh4GHgIeAh4CGgIaAhn+Gf4Z/hn+Gf4Z+hn6GfoZ+hX6FfoV+hX2FfYV9hH2EfYR9hH2EfYR9g32DfYN9g32DfIJ8gnyCfIJ8gnyBfIF8gXyBfIF8gH2AfYB9gH2AfX99f31/fX99f31/fX5+fn5+fn5+fn5+fn5+fn5+fn5+fX99f31/fX99f31/fX99f3t/e397gHuAe4B7gHuAe4B7gXuBe4F7gXuBe4F7gXuCe4J7gnuCe4J7gnuDe4N7g3uDe4N7g3uEe4R7hHuEe4R7hHuEe4V7hXuFe4V7hXuGe4Z7hnyGfIZ8h3yHfId8h3yIfYh9iH2IfYh9iH2Ifol+iX6Jfol+iX+Jf4l/iX+JgImAiYCJgImAiYGJgYmBiYGJgYmCiYKJgomCiYKJg4mDiYOJg4iDiIOIhIiEiISIhIiEiISHhYeFh4WHhYeFh4aHhoeGh4aHhoaHhoeGh4aHhoeGh4aIhoiGiIWIhYiFiIWIhYiEiISJhImDiYOJg4mDiYKJgomCiYGJgYmBiICIgIiAiICIf4h/h3+Hfod+h32GfYZ9hnyFfIV8hXyEe4R7g3uDe4N6gnqCeoF6gXqAeYB5f3l/eX55fnl9eX15fHl8eXt5e3l7eXp6enp5enl6eXp4enh7d3t3e3d7dnx2fHZ8dn11fXV9dX50fnR+dH90f3R/c4BzgHOBc4FzgXOCc4JzgnODc4Nzg3OEc4RzhHOFc4VzhXSGdIZ0hnSGdIZ1h3WHdYd2h3aHdoh3iHeId4h4iHiIeIh5iXmJeol6iXqJe4l7iXyJfIl8iX2JfYl+iX6Jfol/iX+Jf4mAiYCJgYmBiIGIgoiCiIKIg4iDiIOIhIeEh4SHhYeFh4WHhYaFhoaGhoaGhYaFhoWGhYaFhoSHhIeEh4SHg4eDh4OHg4eCh4KHgoeCh4KHgYiBiIGIgYiBiICIgIiAiICIf4h/iH+If4h/iH6Ifoh+iH6IfYd9h32HfYd9h3yHfIZ8hnyGfIZ8hXyFe4V7hHuEe4R7hHuDe4N7g3uDe4J7gnuCe4J7gXuBe4F7gXuAe4B7gHuAe397f3t/e397f3t+e358fnx+fH58fnx+fH18fXx9fX19fX19fX19fH18fnx+fH58fnx+fH58fnx/e397fnp+en96f3p/en96gHqAeoB6gHqAeoB6gXqBeoF6gXqBeoF6gnqCeoJ6gnqCeoN6g3qDeoN6g3qDeoN6hHqEeoR6hHqEeoV6hXqFeoV6hnqGeoZ6hnqHeod6h3qHeoh6iHqIe4h7iXuJe4l7iXyKfIp8inyKfYp9i32LfYt+i36Lfot/i3+Lf4uAi4CLgIuBi4GLgYuCi4KLgouDi4OLg4uDi4SKhIqEioSKhIqFioWKhYqFiYWJhYmFiYaJhoiGiIaIhoiGiIaIhoeGh4aHhoeHh4eHh4eHh4eHh4eHh4iGiIaIhoiGiIaJhomGiYWJhYmFioWKhIqEioSKhIqDioOKg4qCioKKgoqBioGJgYmAiYCJf4h/iH+Hfod+h36GfYZ9hX2FfIR8hHyDe4N7gnuCe4F7gXqAen96f3p+en56fXp8enx6e3p7enp6enp5e3l7eHt4e3d7d3x2fHZ8dXx1fXR9dH10fXN+c35zfnN/cn9ygHKAcoBygXKBcYFxgnGCcYJxg3GDcoNyhHKEcoRyhHKFcoVzhXOFc4VzhnSGdIZ0hnWHdYd1h3aHdod3h3eHd4h4iHiIeYh5iHqIeoh6iHuIe4h8iHyIfYh9iH2Ifoh+iH+If4h/iICIgIiBiIGHgYeCh4KHgoeDh4OHhIeEhoSGhYaFhoWGhoaGhoaFhoWGhYeFh4WHhIeEh4SHhIiEiIOIg4iDiIOIgoiCiIKIgoiBiIGIgYiBiICIgImAiYCJf4l/iX+Jf4l+iX6Jfol+iX2JfYl9iX2JfIl8iXyIfIh8iHuIe4h7h3uHe4d7h3uGeoZ6hnqFeoV6hXqEeoR6hHqDeYN5g3mCeYJ5gnmBeYF5gXmAeYB5gHmAeX95f3l/eX96f3p+en56fnp9en16fXp9e317fHt8e3x7fHt8e3x7e3x7fHt8e3x7fXt9e317fXt9e317fnp+en56fXl+eX55fnl/eX95f3l/eYB5gHmAeYB5gXmBeYF5gXmBeYJ5gnmCeYJ5gnmDeYN5g3mDeYN5hHmEeYR5hHmEeYV5hXmFeYV5hXmFeYV5hnmGeYZ5hnmGeYd5h3mHeYh5iHmIeYl5iXmJeop6inqKeot7i3uLe4t7jHyMfIx9jH2Mfo1+jX6Nf41/jYCNgI2BjYGNgY2CjYKNgo2DjYONg42EjISMhIyFjIWLhYuFi4aLhoqGioaKhoqGioaJhomGiYaJhomGiYaJhoiGiIaIhoiGiIaIh4iHiIeIh4iHh4eHiIeIh4iHiIeIh4iHiYeJhomGiYaJhoqGioaKhoqFioWKhYqFioSKhIqEioSKhIqDioOKg4qCiYKJgomCiIGIgYeBh4CGgIaAhX+Ff4R/hH6DfoJ+gn6BfYB9gH1/fX59fn19fX18fHx7fHt8en15fXl9eH14fXd9d312fXZ9dX11fnR+dH5zfnN+c39yf3J/cn9xgHGAcYBxgXGBcYFxgnGCcYJxg3GDcYNxg3KEcoRyhHKEcoRzhXOFc4VzhXSGdIZ0hnWGdYZ2hnaHdod3h3eHeId4h3mHeYd6h3qHe4h7iHyIfIh9h32HfYd+h36Hf4d/h3+HgIeAh4GHgYeBh4KGgoaDhoOGg4aEhoSGhIWFhYWFhYWGhYaFhoWGhIaEh4SHhIeEh4SHg4iDiIOIg4iDiIKJgomCiYKJgYmBiYGJgYmAiYCJgImAiX+Kf4p/in+Kfop+in6Kfop9in2KfYp9iXyJfIl8iXyJfIl7iXuJe4l7iXuJe4h6iHqIeoh6h3mHeYd5hnmGeYV5hXmFeYR5hHmDeYN5g3iCeIJ4gniBeIF4gXiAeIB4gHh/eH94f3h+eH54fnh9eX15fHl8eXx5fHl8eXt5e3p7ent6e3p7ent6e3t7e3t7e3t7e3p8enx6fHp8enx6fXp9en15fXh+eH54fnh+eH94f3h/eIB4gHiAeIF4gXiBeIF4gnmCeYJ5gnmDeYN5g3mDeYN5hHmEeYR5hHmEeYR5hXmFeYV5hXmFeYV5hXmGeYZ5hnmGeIZ4h3iHeId4h3iIeIh4iHiJeIl4iXiKeIp4inmKeYt5i3qMeox6jHuMe418jXyNfY19jn6Ofo5/jn+OgI6BjoGOgo6CjoOOg42EjYSNhI2FjYWNhY2GjIaMhoyGjIaLh4uHi4eKh4qHioeKh4qHiYaJhomGiYaJhomGiIaIhoiGiIaIhoiHiIeIh4iHiIeIh4iHiIeIiIiIiIiIiIiIiIiIiIiIiIiIiYiJiImIiYiJh4mHiYeKh4qHioeKh4qHioeKhoqGiYaJhomFiYWJhYiEiISIhIiEh4OHg4aDhoKFgoSChIKDgYKBgYGBgYCAf4B/gH6AfYB8f3x/e396f3p/eX95f3h/d393f3d/dn92f3V/dX90f3R/c39yf3J/cYBxgHGAcYBwgXCBcIFwgXCCcIJwgnCDcYNxg3GDcoRyhHKEcoRzhHOEc4VzhXSFdIV0hXWFdYV2hnaGd4Z3hniGeIZ5hnmGeod6h3uHe4d8h3yHfYZ9hn6GfoZ/hn+Gf4aAhoCGgYaBhoGGgoWChYOFg4WDhYSFhISEhIWEhYSFhIWEhoSGg4aDhoOHg4eDh4OHg4eCiIKIgoiCiIKIgomBiYGJgYmBiYGJgImAiYCKgIqAin+Kf4p/in+Kf4p/in6Kfop+in6KfYp9in2KfYp8inyKfIp8inyKe4l7iXuJe4l7iXqJeol6iXqJeoh5iHmIeYd5h3mGeYZ5hXmFeIV4hHiEeIN4g3iCeIJ4gniBeIF4gXiAeIB4gHh/eH94fnh+eH54fXh9eHx4fHh8eHx4e3l7eXt5e3l7eXt5e3l7ent6enp6enp7ent6e3l7eXx5fHl8eXx5fXl9eH14f3h/eIB4gHeAd4B3gHeBd4F3gXiBeIF4gXiCeIJ4gniCeIJ4gniCeIJ4g3iDeIN4g3mDeYN5g3mEeYR5hHmEeYR5hXmFeYV5hXiFeIZ4hniGeIZ4h3iHd4d3h3eId4h3iHeId4l3iXeJd4p4iniLeIt4i3mMeYx5jHqMeo16jXuNe418jX2NfY5+jn+OgI6AjoGOgo6DjoOOhI6EjoWOhY2GjYaNho2HjIeMh4yHjIeMh4uHi4eLh4uHi4eKh4qHioeKh4qHiYeJh4mHiYeIhoiGiIaIhoiGiIaIhoeGh4eHh4eHiIeIh4iHiIeIh4iHiIeIh4iHiIeIh4iHiYeJh4mIiYiJiImIioiKiIqJiomKiYqJiYmJiYmJiYmJiYmJiYmIiIiIiIiHiIeHh4eHh4aGhoaGhYWFhYSFg4WDhIKEgoSBg4CDf4N/gn6CfYJ8gnyCe4F6gXqBeYF4gXiAd4B3gHaAdoB1gHWAdIBzgHOAcoBygHKAcYBxgHGAcIBwgXCBcIFwgXCCcIJwgnGDcYNxg3KDcoNyhHOEc4RzhHSEdIR1hHWFdYV2hXaFd4V3hXiFeIV5hXqFeoV7hXuFfIV8hX2FfYV+hX6Ff4V/hYCFgIWAhYGEgYSBhIKEgoSDhIOEg4SEg4SDhIOFg4WDhYOFg4aChoKGgoaChoKHgoeCh4KHgoiBiIGIgYiBiIGJgYmAiYCJgImAiYCJgImAiYCJf4l/iX+Kf4p/in+Kf4p/in6Kfop+in6Kfop+in6Kfop9in2KfYp9inyKfIp8inyJfIl7iXuJe4l7iXuJeol6iXqIeoh6h3mHeYd5hnmGeYV5hHmEeIN4g3iCeIJ4gniBeIF4gXiAeIB4gHh/eH94fnl+eX55fXl9eX15fHl8eXx5e3l7ent6e3p7enp6enp6e3p7ent5fHl8eXx5fHl9eX14fXh+eH54fnh/eH94gneCd4J3g3eDeIN4g3iDeIN4g3iDeIN5g3mDeYN5g3mDeYN5g3mDeYN5gnmCeYJ5gnmCeIN4g3iDeIN4g3iDeIN4hHiEeIR4hHiEeIV4hXiFeIV3hneGd4Z3h3eHdod2iHaIdol2iXaJdop2inaLd4t3i3iMeIx5jHmMeox6jHuNe418jX2NfY1+jX6Of46AjoGOgY6CjoOOg46EjoWOhY6GjoaOh46HjYiNiI2IjYiMiIyIjIiMiIuIi4eLh4uHi4eKh4qHioeKh4mHiYeJh4mHiYeIhoiGiIaIhoiGiIaIhoiGiIaIhoiGiYWJhYmFiYWJhYmFiYWKhYqFioWKhYuFi4aLhouGjIaMh4yHjIeMiIyIjIiMiIyJjImMiYyJjImMiYyJi4iLiIuIi4iKiIqHioeKh4mGiYaJhYiFiISHhIeDhoKGgoWBhYCFgIR/hH6EfYN8g3yDe4J6gnqCeoF5gXmBeIF3gXeBdoF1gXWBdIB0gHOAc4BygHKAcoBxgHGBcYFxgXCBcYFxgXGCcYJygnKCc4Jzg3ODdIN0g3SDdYN1g3aDdoR2hHeEd4R4hHiEeYR6hHqEe4R7hHyEfYR9hH6DfoN/g3+DgIOAg4CDgYOBg4GDgoOCg4KCg4KDgoOChIKEgoSChIKFgYWBhYGFgYaBhoGGgYaBhoGHgYeAh4CHgIeAh4CIgIiAiICIgIiAiYCJgImAiYCJgImAiYCJf4l/iX+Jf4l/iX+Jf4l/iX+Jf4l/iX+Jf4l/iX6Jfol+in6Kfop+in2KfYp9in2KfYp9inyKfIp8iXyJfIl8iXuIe4h7iHuHe4d7hnuGeoV6hXqEeoR6g3qDeoJ6gnqBeoF6gXqAeoB6f3t/e397fnt+e317fXt9e3x7fHx8fHx8e3x7fHt8enx6fHp9en15fXl9eX55fnh+eH94f3iAeIB3gHeBd4F3gXeCd4J3hXeFd4V4hXiFeIV4hXiGeYZ5hnmGeYV6hXqFeoV6hXqFeoR6hHqEeoR6g3qDeoN6g3qCeoJ5gnmCeYJ5gniCeIJ4gniCeIJ4g3iDeIN3g3eEdoR2hXaFdYV1hnWGdId0h3SIdIh0iXSJdIp1inWKdYt2i3aLd4t4jHiMeYx5jHqNeo17jXyNfI59jn6Ofo5/joCPgI+Bj4KPg4+Dj4SPhY+Fj4aPho+Hj4iPiI6IjomOiY6JjomNiI2IjYiMh4yHjIeMh4yHi4eLh4uHi4eLh4uHi4eLhouGi4aLhouFi4WLhYuFi4WMhIyEjISMhIyEjISMhI2EjYSNhI2EjYSNhI6EjoSOhI6EjoWOhY6GjoaOh4+Hj4ePiI+Ij4iPiI+Jj4mPiY+Jj4mPiY+JjomOiY6JjYmNiIyIjIiMh4uHi4aKhoqFiYWIhIiDh4OHgoaBhoGFgIV/hH6EfYR9g3yDfIN7gnuCeoJ5gniCeIJ3gXaBdoF1gXWBdIF0gXOBc4FygXKBcoFxgXGBcYFxgXKBcoFygXOCc4JzgnSCdIJ0gnWCdYJ1gnaCdoJ3gneCeIJ4gnmCeoJ6gnuCe4J8gn2CfYJ+gn6Cf4J/gn+CgIGAgYCBgYGBgYKBgoGCgYOAg4CDgISAhICEgISAhYCFgIV/hX+Ff4Z/hn+Gf4Z+hn6GfoZ+hn+Hf4d/h36Hfod+h36Hfod+h36If4h/iH+Hf4h/iH+If4h/iH+If4h/iH+If4h/iH+If4h/iX+Jf4l/iX+Jfol+iX6Jfop+in6Kfop+in6Kfop+in6Kfop9iX2JfYl9iX2IfYh9iH2HfYd9h32GfYZ8hXyEfIR8g3yDfIJ8gnyBfYF9gH2AfX99f31+fn5+fn59fn1+fX59f3x/fH98f3t/e397f3qAeoB6gHqAeYB5gXmBeIF4gniCd4J3g3eDd4N3hHeEd4R3hHeEd4V3h3eHeId4h3iHeYd5h3mHeYd6h3qHeoZ7hnuGe4Z7hXyFfIV8hXyFfIR8hHyEfIR8g3uDe4N7g3qDeoN6g3qCeoJ6gnmCeYJ4gniCd4J3g3aDdoN1g3WEdIR0hXOFc4Zzh3OHc4hziHOJdIl0inWKdYp2i3aLd4t3jHiMeY15jXqNeo57jnuOfI58j32PfY9+j3+Pf4+Aj4GPgo+Cj4OPhI+Fj4WPho+Gj4ePh4+Ij4iPiI+Ij4iPiI+IjoiOiI6HjoeOh46HjoeOh42HjYaNho2GjYWNhY2FjoWOhI6EjoSOhI6EjoOOg4+Dj4OPg4+Dj4OPgpCCkIKQgpCDkIOQg5CDkIOQhJCEkYSRhZGFkYWRhpGGkYaQhpCHkIeRh5GIkYiRiJGIkYmRiZGJkYmQiZCKkIqQio+Kj4qOio6JjYmMiYyIi4eKh4qGiYWJhYiEh4OHgoaChoGFgIV/hH+EfoR9g3yDe4N7gnqCeYJ5gniCd4J3gXaBdoF1gXWBdIF0gXOBc4FzgXOBc4BzgHOAc4BzgHOAdIB0gHSAdYB1gXWBdoF2gHaAd4B3gHiBeIF5gXqBeoF7gXuBfIF9gH2AfoB+gH6Af4B/gICAgICAgIGAgYCCf4J/gn+Df4N/hH+EfoR+hH6EfoV+hX6FfYV9hX2FfYV9hX2GfYZ9hn2GfYZ9hn2GfYZ9hn2GfYZ9hn2GfYd9h32HfYZ9hn2GfYZ9hn2HfYd9h32HfYd9h32Hfoh9iH2IfYh9iH2IfYh9iH2IfYl+iX6Jfol+iX6Jfol+iX6Jfol+iX6Jfol/iX+If4h/iH+If4h/h3+Hf4d/hn+Gf4V/hX+Ef4R/g3+Cf4J/gX+Bf4B/f39/gH+AfoB+gH2AfYF9gXyBfIJ8gnuCe4J7g3uDeoN6g3qDeoN5hHmEeYR4hHiEeIV3hXeFd4V3hneGdoZ2hnaGd4Z3hneGd4d3iHiIeIh5iHmIeoh6h3qHe4d7h3uHfIZ8hnyGfIZ8hn2GfYV9hX2FfYV9hX2FfYV9hH2EfIR8hHyEe4R7hHuEe4N6g3qDeoN5g3mDeIN3g3aEdoR1hHSFdIVzhnKGcodxh3GIcYhyiXKJcolzinSKdIt1i3aLdox3jHeNeI15jXmNeo57jnuOfI58j32PfY9+j36Pf49/j4CPgY+Cj4OPg4+Ej4WPhY+Gj4aPho+Hj4ePh4+Hj4ePh4+Hj4ePh5CHkIeQh5CGkIaQhpCGkIaQhZCFkIWQhJCEkISQg5GDkYORg5GDkYORg5GCkYKRgpGCkYKRgpGCkYKRgpGCkYKSgpKDkoOSg5KDkoSShJKEkoWShZKGkoaRhpGGkYeRh5GHkYeRiJGIkYmRiZGJkYmRipCKkIqQi5CLj4uPi46LjouNi42LjIqLiouJioiJh4mGiIaIhYeEh4OGgoWChYGEgIR/g36DfYN8gnuCe4J6gnmCeYJ4gXeBd4F2gXaAdYB1gHSAdIB0gHR/dH90f3R/dH90f3R+dH51fnV+dX52fnZ+dn53fnd+eH54fnl+eX56f3p/e397f3x/fH99f31/fn9+f35/f39/f39/gH+Af4F/gX6CfoN+g36DfoR+hH6EfYV9hX2FfYV9hX2FfIV8hXyFfIV8hXyFfIV8hXyFe4V7hXyFfIV8hXyFfIV8hnyGfIZ8hnyGfIZ8hnyGe4Z7hnuGe4Z8hnyGfIZ8hnyHfId8h3yHfId8h3yHfId8h3yHfYd9h32HfYd9h32Hfod+h36Hfod/h3+Hf4d/h4CHgIeAh4CHgYaBhoGGgYaBhoGFgYWBhIKEgoOCg4KCgoGCgYKAgn+Cf4J+g36DfYN9g3yDfIR7hHuEe4V7hXqFeoZ6hnqGeod6h3qHeod5h3mHeId4h3iId4h3iHeId4h3iHeId4l3iXeJd4h3iHeId4h4iXmJeol6iXuIe4h7iHuIfIh8h3yHfYd9h32HfYZ+hn6GfoZ+hn6GfoV+hX6FfoV+hX6FfYV9hX2EfIR8hHyEfIR7hHuEe4V6hXmEeIR4hHeFdoV1hXSGc4ZyhnKHcYdxh3GIcYhxiXGJcopyinOKdIt0i3WLdox2jHeNd414jXmNeY16jXqOe458jnyOfY99j36Pf49/j4CPgI+Bj4KPgo+Dj4SPhJCFkIWQhZCGkIaQhpCGkIaQhpCGkIaQhpCFkYWRhZGFkYWRhZGFkYWRhZKEkoSShJKDkoOSg5KDkoOSg5ODk4OTg5ODk4OSg5KCkoKSgpKCkoKSgpKCkoKSgpKCkoORg5GDkYSRhJGEkYWRhZGGkYaRhpGHkYeRh5CHkIeQiJCIkIiQiZCJkIqPio+Kj4uPi46MjoyOjY2NjY2MjYyMi4yLjIqLioqJiYmJiIiIh4eGh4WGhYWEhYOEgoSBg4CDf4J+gn2CfIJ7gnuBeoF5gXmAeIB4gHh/d393f3Z+dn52fnV+dX11fXV9dX11fXZ8dnx2fHZ8dnx2fXd9d313fHh8eHx4fHl9eX16fXp9e317fXx+fH59fn1+fn5+fn5+f35/fn9+gH6AfoF+gn6CfoN+g36EfoR+hX6FfoV9hX2FfYV9hX2FfYV9hX2FfYV8hXyFfIV8hXyEfIR7hHuEe4R7hHuFe4V7hXuFe4V7hXuGe4V7hXuFe4V7hXuFe4V7hXuFe4V7hnuGeoZ7hnuGe4Z7hnuGe4Z7hnuGe4Z8hnyGfIZ8hn2GfYZ9hn6GfoV/hX+Ff4WAhYCFgIWBhYGFgYWChYKFgoSDhIOEg4SDg4ODg4KEgoSBhICEgIR/hH+EfoV9hX2FfIV8hnuGe4Z6h3qHeod6h3qIeoh6iHqIeoh5iXmJeYl5iXmJeYl4iXiJd4l3iXeKd4p3ineKd4p3ineKeIp4iniKeIp5inqKe4l7iXyJfIl8iHyIfIh9iH2IfYd9h36Hfod+h3+Gf4Z/hn+Gf4Z/hn+Gf4Z/hn6GfoZ+hn2GfYZ9hnyGfIZ7hnuGe4Z6hnmGeYZ4hneGdod1h3SHc4dyiHKIcYhxiHGIcYlxiXGJcolyinOKc4p0i3SLdYt2jHeMd4x4jHiMeYx5jHqNeo17jXuOfI59jn2Pfo9+j3+PgI+Aj4GPgY+Cj4OPg4+Ej4SPhY+Fj4WPhY+Fj4WPhY+Fj4WQhZCEkISRhJGEkYSRhJGEkoSSg5KDkoOTg5ODk4OTg5ODk4OTg5ODk4OTg5ODlIOUg5ODk4OTg5ODk4OSg5KDkoOSg5KDkYORg5GEkYSRhJGFkYWQhpCGkIeQh4+Hj4iPiI6IjoiOiI6IjoiNiY2JjYqNio2KjIuMi4yMjI2LjYuOi46KjoqNio2JjYmMiYuIi4iKh4mHiYaIhoeFh4WGhIWEhIODg4GDgIJ/gn6CfYF9gXyBe4B7gHt/en96f3p+eX55fXl9eH14fHd8d3t3e3d7d3t3e3d7d3t3e3d7d3t3e3d7d3t3e3d7eHx4fHl8eXx5fHp9en17fXt9fH18fX1+fX59fn5+fn5/fn9/gH+Af4F/gX+Cf4J/g3+Ef4R/hH+Ff4V/hX+Ff4V/hX+Ff4V/hX+Ff4V/hX6FfoV+hX6FfYR9hH2EfYR9hHyEfIR8hXyFfIV8hXuFe4V7hXuFe4V7hXuFeoV6hXqFeoV6hXqFeoV6hXqFeoV6hXqFeoV6hXqFe4V7hHuEfIR8hHyEfYR9g36DfoN+g3+Df4OAg4CDgYOBg4GDgoOCg4ODg4ODg4SChIKEgoSBhIGFgYWAhYCFf4V+hX6GfYZ8hnyGe4d7h3qHeoh5iHmIeYh5iXmJeYl5iXmJeYp5inmKeYp5inmLeYt5iniKeIp4ineKd4p3ineKd4t4i3iLeIp4inmKeYp6iXuJfIl8iXyJfYl9iX2IfYh9iH6Ifoh+iH6If4h/iH+Hf4d/h4CHgId/h3+Hf4d/h36Hfoh+iH2IfYh9iH2IfIh8iHuIe4h6iHqIeYl4iXeJdol1iXWJdIlziXOKc4lyiXKJcolyiXKJcopyinOKc4t0i3SLdYt1i3aLd4t4jHiMeIx5jXmNeo16jXuOfI58jn2OfY5+jn6Of46AjoGOgY6CjoKOg46DjoSOhI6Ej4SPhI+EjoSOhI+Ej4SPhI+Dj4OQg5CDkIORg5GDkoOSgpKCkoOSg5ODk4OTg5ODk4OTg5ODlIOUg5SDlIOTg5ODk4OThJOEk4STg5KDkoOShJKEkoSRhJGEkYWRhZCFkIaQho+Hj4ePiI6IjomNiY2JjImMiYyJi4mLiYuJioqKioqLiouKjImMiYyJjYmNiY2IjYiNiI2IjYeNh4yHi4aLhoqGiYWJhYiFh4SHhIaEhYOEg4OCgoKBgoCBf4F+gH1/fX99f3x+fH58fnt9e317fXt8enx6fHl7eXt5e3h7eHt4e3h6eHp3end6d3p3end6d3t3e3d7d3t3e3h8eHx4fHl9eX16fXt+e358fnx+fX59f31/fn9+f3+Af4CAgICAgYGBgYKBgoGDgYOBhIKEgoSChIKEgoSChIKEgoSChIKEgoWBhYGFgYWBhYCFgIWAhYCFf4R/hH+EfoV+hX2FfYV9hXyGfIZ8hnuFe4V7hXuFeoV6hXqFeoV5hXmFeYV5hXmFeYR5hHmEeYR5g3mDeoN6g3qCe4J7gnyCfIF9gX2BfoF/gX+BgIGAgYGBgYGCgYKBg4GDgYSBhIGEgYWBhYGFgIaAhoCGf4d/h36Hfod9h32IfIh7iHuIeoh6iXmJeYl5iXiKeIp4iniKeIt4i3iLeIt4i3iLeIt4jHiMeYx5jHmMeYx5i3iLeIt4i3iLeIt4inmKeYp5inqKeop6inyKfIp9in2KfYl+iX6Jfol+iX6Jfol/iX+Jf4l/iX+Jf4l/iYCJgImAiYCJf4l/iX6Jfol9in2KfYp9in2KfIp8inyKe4p6i3qLeYt4i3iLd4t2i3aLdYt1i3SLdItzi3OLc4tzi3OKc4tzi3OLdIt0i3WLdYt2i3eLd4x4jHiMeI14jXmNeY16jXuNe418jXyNfY1+jX6Nf41/jYCNgY2BjYKNgo2DjYONhI2EjYSOhI6EjoOOg46DjoOOgo+Cj4KPgpCCkIKQgZCBkYGRgZGBkoGSgpOCk4KUgpSClIKUg5SDlYOVg5WElYSUhJSFk4WThJOEk4SThJOEk4SShJKFkoWShZKFkYWRhpGHkIeQiI+Ij4mOio6KjYqMioyKi4qLioqKioqJiomKiYqIi4iLiIyIjIeMh42HjYeNh42GjYaNho2GjYaNhoyGi4WLhYqFiYWJhYiEiISHhIaEhoOFg4SDg4KCgoGBgICAgH9/f39+f35+fn59fn19fX19fXx9fH17fHt8enx6fHl8eXx5fHl7eXt4e3h8eHx4fHd8d3x3fHd8d3x3fHd8eH14fXh+eX55fnl+en56f3t/e398f3yAfYB9gH6BfoF/gX+CgIKAgoGDgoOCg4OEg4SDhIOEhISEhYSFhIWEhYSFhIWEhYSFhISFhIWDhYOFg4WChYKFgoWBhYGFgIWAhn+Gf4Z+hn6GfYZ9hnyGfIZ8hXuFe4V7hXqFeoV6hXmFeYV5hXmEeYR5g3mDeYN5gnmCeoJ6gXqBe4B7gHyAfH99f35/fn9/foB+gX6BfoJ+g36DfoR+hX+Ff4Z/hn+Hf4d/iH+If4h+iX6Jfol+iX2KfYp8inyKe4p6i3qLeYt5i3mLeIt4i3iLeIx4jHiMeIx4jHiMeIx4jXiNeI14jXmNeY15jXmNeY15jXmNeYx5jHmMeYt6i3qLeot6i3uKe4p7i32LfYt9i36Lfot+in6Kf4p/in+Kf4p/in+Kf4p/in+Lf4t/i3+Lf4t/i3+Lf4x+jH6MfY19jX2NfY18jXyNfI18jXyNe417jXqNeY14jXiOd453jneOdo52jnaNdY11jXSNdI10jXSNdI10jXSNdYx2jHaMd4x3jHiMeIx4jHiMeIx4jHmMeox6jHuMe4x8jH2MfYx+jH6Mf4x/jICMgYyBjIKMgo2DjYONg42DjYONg42DjYOOgo6CjoKOgo+Cj4GPgY+BkIGQgZCBkYCRgJGAkoCSgJOBk4GUgZSBlIKVgpWDlYOVg5SElISUhZSFlIWThZOFlIWUhZSFlIWThZOFk4WThpOGkoeSh5KIkYmRipCKkIuPi4+MjoyNjI2MjIuLi4qLiouJi4mLiIuIi4iMh4yHjIeMho2GjYaNho2GjYaNho2GjYaMhoyGi4aKhoqGiYaJhoiFiIWHhYeEhoSFhIWDhIOEgoOCgoGBgYGAgICAgIB/f39/f35/fn9+f31/fH58fnt+e356fnp+en56fnl9eX15fXl+eX54fnd9d313fXd9d353fnd+eH94f3iAeYB5gHmAeYB6gHqBe4F7gXuBfIF8gX2BfYF+gn6Cf4J/g3+DgISAhIGFgYWChoKGgoaDh4OHg4eEh4SHhIeEh4WHhYeFhoWGhoWGhYaEhoSGg4aDhoKGgoaBh4GHgIeAh3+Hf4d+h36HfYd9hnyGfIZ8hnyGe4Z7hnuFe4V7hXqEeoR6g3qDeoJ6gnqBe4B7gHt/fH99fn1+fn1+fX98gHyBfIF8gnuDe4R7hXyGfIZ8h3yIfIh8iX2JfYp9i32LfYt9jH2MfIx8jXyNe417jXqNeo16jXmNeY15jXiNeI14jXiNeI13jXeNd453jneOeI54jniOeI55jnmOeY55jnmOeo56jnqOeo56jnqOe417jXuMe4x7jHyMfIt8jH2Mfox+jH6Mfox/jH+Mf4t/i4CLgIt/jH+Mf4x/jH+Mfox+jX6Nfo1+jn6OfY99j32PfJB8kHyQfJB8kHyQfI98j3yPe497kHqQeZB4kHiQd5B3kHeQd5F2kXaRdpF2kXWRdZF1kXWRdZB1kHaQd493j3iOeY15jXmNeIx4jHiMeIx5jHqMe4x7i3yLfIt9i32LfYt+i36Lf4t/i4CLgYuBjIKMgoyCjIOMg4yCjIKMgo2CjYKNgo2BjoGOgY6Bj4GPgJCAkICRf5F/kn+Sf5N/k4CTgJSAlICUgZWBlYKVgpWDlYOUg5SElISUhJSElIWUhZSFlIWUhZSFlIWUhZSFlIaUhpOHk4eTiJOJk4qSi5KLkYyRjZCNkI2PjY6Njo2NjYyNi42KjIqMiYyJjIiMiIyIjIiMh4yHjIeMh4yHjIeMh4uHi4iLiIuIioiKiIqHiYeJh4mHiIaIhoeGh4WGhYaFhYSFhISEg4ODg4KCgoKBgoGBgIGAgX+Bf4F+gX6AfYB8gHyAe4B7gHuAe396f3p+e397f3t/en95f3h/eH93f3d/d4B3gHeAd4B3gXiCeIJ4gniCeYN5g3qDeoR7hHuEfIR9hH2EfYR+g36DfoR+hH+Ef4R/hH+EgIWAhYCFgYaBhoKGgoaDh4OHhIeEh4WHhYeGh4aGh4aHhYeFh4WHhIeEh4SHg4eDh4KHgoiBiIGIgIiAiH+Hf4d/hn+GfoZ+hn6GfoV+hX2FfYV9hX2EfYR9g32DfYJ9gX2BfYB9f31+fn5+fX58f3x/e4B6gHqBeoJ5g3mEeYR5hXmGeYd6h3qIeol6inuLe4x7jHuNe457jnuPe497kHuQe5B6kHqQepB6kHmQeZB5kHmQeZB4kHiQeI94j3iPeI94j3iPeI94j3iPeY55jnmOeY55jnmOeo96j3uPe497j3uOfI58jnyNfY19jX2MfYx9jX6Nfo1+jX6Nf41/jX+Nf42AjYCNgI1/jX+Nf41/jn6Ofo5+j32PfZB9kHyQfJF8kXuSe5J7knySfJJ8knySfJN8k3ySfJJ7knuSepJ5kniTeJN3k3eTd5R3lHeUdpR2lHaUdpR2lHaUdpN2k3eTeJJ5knqRe5F7kHuPeo56jnqNeo16jHuMfIx9i32LfYt+i36Lfot+i36Lf4t/i4CLgYuBi4GLgouCi4KLgouCi4GMgYyBjYCNgI2AjoCOgI+Aj3+Qf5B/kX+RfpF+kn6TfpN/k3+Uf5SAlYCVgZWBlYKVgpWDlYOVg5SDlIOUg5WElYSVhJWFlYWVhZWFlYWVhpWGlIaUh5SHlIiUiJSJlIqTi5OMk42SjZKOkY6Rj5CPkI+Pj46OjY6MjouNi42KjIqMioyJjImMiYyIjIiMiIuJi4mKiYqJiomKioqJiomKiYqJiYmJiImIiYiIiIiIh4iHh4aHhoeFh4WGhIaEhYOFgoSChIKEgYOBg4CCgIJ/gn6CfoF9gX2BfYF8gXyBfIB7gHuAe4B7gXqBeoF5gXiBeIJ4gniCd4J3gneCeIN4g3iDeIR4hHiEeIR4hXmFeoZ6hnuGfId8h32Hfod+h36Hfod+h3+Hf4Z/hn+Gf4Z/hoCGgIaAhoGGgYaChoOGg4aEhoWGhoaGhoeFh4WHhYeFh4WIhYiFiIWIhYiFiIWIhYiEiISIg4iDiIOHgoeChoKGgYaBhYGFgYWBhYGFgIWAhICEgISAg4CDgIJ/gn+Bf4B/f39+f31/fX98f3uAeoB5gXiCeIJ3g3eEd4R4hXiGeId4iHiJeIl4iniLeIx4jXiOeI95kHmQeZF5kXmRepJ6knqSepJ6knmSeZJ5knmSeJJ4kniSeJJ4kniSeJF4kXiQeZB5kHmPeY96jnqOeo56jnqOeo57jnuNfI18jXyNfY59jX2Nfo1+jX6Nfo1+jX6Nfo5+jn+Of45/jn+Of49/j3+Pf49/j3+Pfo9+j36PfZB9kH2QfJF8kXuSe5J7k3uTe5R7lHuUe5V7lXuVe5Z7lnuWe5Z7lnuWepZ6lnmWeJZ4lneWd5Z3lneXdpd2l3aXdpd2l3eWd5Z4lnmVepV7lHyUfZN9k32SfZF9kHyPfI58jn2NfY1+jX6Mfox+jH+Lf4t/in+Kf4qAioCKgIqBioGKgYqBi4KLgYuBjICMgIx/jX+Nf41/jn+Pf49+kH6QfpB+kX6RfpF+kX6SfpJ+kn6Tf5N/k4CUgZSBlIKVgpWClYOUg5ODlIOUg5WDlYOWhJaElYWVhZWFlYaVhpWGlYaVh5WHlYiUiZSKlIqUi5SMlI2UjpOOk4+Tj5KPkpCRkJCQj4+Oj46OjY6NjYyNjI2LjIuMioyKjIqLi4qLiouKi4qLiYuKi4qLiouKi4qKiYqJiomKiIqIioiKh4qHioaJhomFiYWJhYiFiISHg4eDhoKGgoaChYGFgYSAhICDf4N/gn6CfoJ9gn2CfYJ8gnyBe4F7gnqCeYJ5g3mDeYN4g3iDeIN4hHiEeIV4hXiFeIV4hniGeIZ4hniHeYd5iHqIe4l8iXyKfYp+i36Lf4p/in+Kf4p/in+KgImAiYCJgYiBiIKIgoeCh4OHg4eEhoWGhYaGhoaGh4aHhoeHh4eHh4iHiIeIh4iHiIeIh4iHiIeIh4iHiIaHhoeGh4WGhYaFhoWFhIWEhYSFhIWEhISEg4SDhIODg4OCgoKBgoGBgIF/gX6BfYF8gXuCeoJ5g3iDd4R3hHeFdoV2hnaHdoh1iXWKdYt1jHWNdo52jnaPdpB3kHeRd5F4kniSeZN5k3mTeZR5lHmVeZV5lXiVeJV4lHmUeZR5lHqUepN6k3qSepJ7kXuQe5B7kHuQe497j3uPe498jnyOfY59jX2NfY1+jX6Nfo1+jX6Nfo1+jn6Ofo5/jn+Pf49/j3+Pf5B/kH+Qf5B+kH6QfpB9kX2RfZF8knySfJN7k3qTepR5lHmVeZZ5lnmXeZd6mHqYepl6mXqZepl7mXuZe5l6mXqZeZl4mXiZd5l3mXaZdpl2mXaZdpl3mXeZeJl5mHqYe5h9l36XfpZ/ln+Vf5R/k3+SfpJ+kX6Qf49/j3+Of46AjYCNgIyBi4GLgYuAi4CKgIqAioCKgIuAi4CMgIyAjICMgI1/jX+Nf41+jn6Ofo99j32PfZB+kH6QfpB+kX6RfpF+kX6Rf5F/kn+SgJOBk4GUgZSClIKUgpSClIKUgpWDlYOVg5aEloWWhZaFloaWhpaGlYeVh5WIlYiUiZSJlIqUi5SMlI2UjZSOlI6Uj5SQk5CTkZKRkpCRkJCPj4+Pjo6Njo2NjI2MjYuMi4yKjIqMiYyJjImMiYyKjIqMiYyJjImMiYyIjIiMiIyIjIiLiIuHi4eKhoqGioaJhomFiYWIhIiDiIKHgoeCh4KGgoaBhYGFgYSBhICDf4J/gn6BfoF9gXyBe4J7gnqCeYN5g3mDeYR5hHmEeIV4hXiGeIZ4hniHd4d3h3eIeIh4iXiJeIl5inmKeYt6i3uMfIx8jX2Nfo5/jn+Of46AjoCNgI2BjYGMgYyCi4KLg4qDioOJhImEiYWJhYiGiIaIhoiGiIaJh4mHiYeJiImIiYiJiImHiYeJh4mHiYeKh4qHioeJhomGiYaJhomFiIWIhYiFiIWHhYeFh4WHhIaEhoOGg4aChYGFgIV/hX6FfIV7hXqGeYZ4hniGd4d3h3aIdoh1iXWKdIt0i3SMdI1zjXSOdI90kHWRdZF2knaSdpN3lHeUd5V4lXiWeJZ4lniWeJZ5lnmWeZZ5lnmWepZ6lnuVe5V7lXuUfJR8k3yTfJJ8knySfJJ8kXyRfZB9kH6Qfo9+j3+Pf45/jn6Ofo5+jn6Ofo5+j36Pfo9/j3+Qf5B/kH+QfpF+kX6RfpF+kX2SfZJ9knyTfJN7k3uUepV6lnmWeZd4l3iXeJh4mXiZeJp4mnibeZt5m3mcepx6nHqdep16nXqdeZ15nXmdeJ14nHecd5x3nHebd5t3m3ibeZp6mnuafJl+mX6Zf5mAmICYgJeBl4GWgZWBlIGTgZKBkYGRgZCBj4GPgo6CjoKNgoyCjIGMgYuAi4CLgIt/jH+Mf4x/jX+Nf41/jX+Nf41+jn6OfY59jn2OfY59jn2PfY99j36Pfo9+j36QfpB/kH+Rf5J/koCTgJOAkoGSgZOBlIGUgpWClYKVg5WElYSVhZWFlYWVhZWGlYaVh5WHlYiViJWJlYmVipWLlYyUjZSNlY6VjpWPlZCVkZSRlJGUkZORkpCRj5GOkI2QjI+Mj4uOi46KjomOiY6JjomOiY6JjomPiY+Ij4iOiI6IjoiOiI6IjYmNiYyIjIiLh4uHi4eKhoqGioWKhYqEiYOIg4iDh4KHgoaChoKFgoWChIGEgYOAg3+CfoJ9gnyCe4N6g3mDeIR4hHiFeIV4hniGd4d3h3eId4l3iXeKeIp4iniLeIt4i3iMeIx4jHmNeY15jXqOeo57j3yPfI99j36Pf49/j4CPgI+Bj4GPgo6CjoOOhI2EjYSMhIyEjIWLhYuGioaKhYqGioaJhoqHioeKh4qHioeKh4uHi4eLhouGi4aMhoyGjIWMhYyFjIWMhYyFjIWMhYyFjIWMhYyFjIWLhIuEi4OLg4uCi4GLgIt/in6KfYp8inuKeop5iniKd4p3i3aLdot1jHWMdI10jnOOc49yj3KPc5BzkXSSdJN0lHSVdZV1lnaXdpd3l3eYd5h3mHiYeJh5mHmYeZh5mHqYeph7l3uXfJd8l32WfZZ9lX2VfpR+k36TfpN+k36SfpJ/kX+Rf5GAkICQf5B/kH+Qf49/j3+Pfo9+kH6QfpF+kX+Rf5J/kn6SfpJ+kn6TfpN9k32TfJR8lHuVe5V6lnmXeZd5mHiYeJl3mXeZd5p3mnebd5x3nHiceJ14nXmeeZ55n3mfeaB5oHmgeaB5oHmgeaB5oHigeKB4n3ifeJ95nnqdep17nHycfZt+m3+bgJqAmoGagZmCmYOYg5iDl4OWg5WClIKTgpKDkYORg5CDkIOPg4+DjoKNgo2BjICMgIx/jH+Mf4x/jX+Nf41/jX+Nf41+jn6Ofo19jX2NfY19jX2NfY19jn6Ofo5+jn6Ofo9+j36QfpB+kX+Rf5J/koCRgJKAk4CUgJSBlYGUgpSDlISUhJWFlYWVhZWGlYaVh5SHlIeViJWIlYmVipWKlYuVjJWMlY2VjZWOlY+VkJWRlZGVkZWRlZGUkJSPk46SjZKMkYyRi5CKkIqQiZCIkIiQiJCIkYiRiJGIkYiRiJGIkYmQiZCJkImPiY+JjomOiI2IjYeMh4yGi4aLhYqFioWJhYiEiISHhIeDhoOGg4WChYKFgYWBhYCFf4V9hXyFeoV5hniGeIZ3h3eHd4h3iHeJdol2ineKd4t3jHeMd4x3jXeNd413jXiOeI54jniPeY95j3mPeo96kHuQfJB8kH2QfpB/kH+QgJCAkIGQgZCCkIOQhI+Fj4WOhY6FjYWNhoyGjIaLhouGioaKhoqGioaLhouGi4aMhoyGjYaNho2FjYWOhY6FjoWOhY6FjoWPhY+Fj4WPhY+FkISQhJCEkISQhJCDkIOQg5CCkIGQgI+Aj3+Ofo59jnyOeo55jXiNeI13jXaOdo51jnWPdI9zkHOQc5FykXKRcpJyk3OUc5RylXOWc5dzmHSZdZl1mXaadpp3mniaeJp5mnmaepp6mnuae5p8mXyZfZl9mH6Yf5h/l3+Xf5Z/lX+Vf5R/lH+Tf5OAk4CTgJKAkoCRgJGAkYCRgJGAkX+Qf5B+kn6SfpJ+kn6TfpN+k36UfpR+lH2UfZR9lHyVfJZ7lnqXeZh5mHiYeJl3mXead5p3mnebd5t3m3ecd5x3nXedeJ14nnefd593oHigeKF5oXmheaF5oXmieaJ5onmieaF5oXmheqB6n3uffJ58nn2efp1/nYCdgJyBnIKbg5uDmoSahJqEmoSZhJiEl4SWhZWElISThJKEkoSRhJCEkIOPg4+CjoGOgI2AjX+Nf41+jX6Nfo1/jX+Nf41+jX6Nfo1+jH6Mfox9jH2MfYx9jX2NfY19jX2OfY59jn2PfZB9kH2RfZJ9kn6SfpN+k3+Uf5WAlYGVgZWClYOVhJaEloWWhZWGlYaVhpWHlYeVh5aHloiWiZWKlYqVi5WLlYyVjJWNlY6Vj5WQlZCWkZaRlpGWkJaPlo6VjZWNlIyUi5SKlIqUiZOIk4iTiJOIk4iTiJOIk4iTiJOIk4iTiZOJkomSipGKkYqQiY+Jj4mOiI2HjYeMhouGioaKhomGiIaIhYeEh4OHg4eCh4KHgYeAh3+Ifoh9iHyIeol5iXiJd4l3iXeKdop2i3aLdox2jHaNdo12jnaOd493j3ePd5B4kHiQeJF4kXiReZJ5knqSepJ7knuSfJJ8kn2SfZJ+kn+Sf5KAkoGSgpGDkYSRhZCGkIaPho+GjoaOho2GjYaNho2GjYaNho2GjYaNhY2FjYWNhI2EjoSOhY+Fj4SPhI+Ej4SPhI+EkISQg5GDkYOSg5KDk4OTg5ODk4OUg5SDlIOUgpSClIGTgZOAkn+SfpF+kXyRe5F6kXmReJB4kHeQdpF2kXWRdJJzknOTcpNyk3KUcpRylXKWcZdxl3GYcZlymnObdJt1nHWcdpx2nXedeJx5nHmcept7m3ubfJt8m32bfpp/mn+af5l/mYCZgJmBmYGYgZiBl4GXgZaBloKWgpWClIKUgpOBk4GTgJKAkoCSf5J/lX+UfpR9lH2VfZV9ln2WfZZ9ln2WfZZ8lnuXe5h6mHmZeZl4mXiZeJl3mneadpp2mnabdpt2m3acdpx2nXadd552nnafdqB3oHeheKF4oXmieKJ4onmieaN5o3qjeqJ6onqie6F7oXygfaB+oH6gf5+An4GegZ6CnYOdg5yEnISchZuFm4WahZqGmYaZhpiGl4aWhpWGk4WShZKEkYSRg5CDkIKPgo+Bj4COgI5/jX+Nf4x/jH+Nf41/jH+Mf4x/jH6Mfot9i32LfYx9jH2MfYx8jXyNfI58jnyPfJB8kXySfJN8k3yUfZR9lH2VfpV/loCWgZeBl4KXg5eDl4SXhZeFl4WXhpeGl4aXhpeHl4iXiZaJloqWi5aLlouVjJWMlY2VjpaPlo+Wj5aQl4+Xj5eOmI6YjZiMmIuYipiKl4qXiZeJl4mXiJaIloiWiJWIlYiViJWIlYmUiZSJlIqUipSLk4uTi5KKkYqQiZCJj4mOiI2IjIiLh4qHioeJhomFiYSJg4mCiYGJgYmAin6KfYt8i3uLeot5jHiMd4x2jHaNdo11jXWOdY91j3WQdZB2kHaRd5F3kXeSeJN3k3eUd5R3lHiVeJV5lXqVepV7lXuVfJV8lX2VfZV+lX6Vf5WAlYGUgpSEk4WThpOGkoeSh5GHkYeQh5CHkIeQh5CGkIaPhY+Fj4WQhY+Fj4SPhI+Ej4OPg4+DkISQhJGEkYORg5GDkoKSgpKCk4KTgpSClIKUgpSClYKVgpWClYKWgpWClYKVgZSBlICTf5N+k32TfJN7k3qTeZN5k3iTd5N2k3WTdJNzlHOUcpRylXGWcZZxl3CYcJlwmnCacJtxnHKcc510nXWedp53nnieeZ56nnqde518nXydfZx9nH6cf5x/nICcgJyAnICcgZyBnIGcgpyCm4Kbg5uDmoOag5mDmYSYg5iDl4KXgZaBloCVgJWAmX+Yfph+mH2YfZh9mH2YfZh9mHyYfJl7mXqZepl5mXmZeJp4mniaeJp3mnead5p2m3abdpx1nHWcdZx1nXaddp52n3afdqB2oXahd6F3oniieKJ4onijeKN5o3mjeqR6o3ujfKN8on2ifqJ/oX+ggKCBoIKfg5+DnoOehJ2EnYWdhZyGnIabhpuHmoeZh5mImIeXh5aHlYeUhpSGk4WShJKDkYOQg5CCkIKPgY+BjoCNgI2AjYCNgI2AjYCMf4x/jH+Mfox+jH2MfYx9jHyMfIx8jXuNe456j3qPepB6kXqRepJ6k3uTe5R8lH2VfZV+ln+WgJeAl4GYgpiCmYOZhJmEmYWZhZqFmoaah5mHmYiYiZiJl4qXipeKl4uXi5eMl42XjZeOl46YjpiOmY2ajZqNm4ybi5yLnIqcipyKnIqciZuJm4maiZqJmYmZiZiImImXiZeJlomWiZWJlYqVipWLlYuVi5SLlIuTi5KLkYuQio+KjomOiY2IjIeMhoyFjISMg4yCjIGMgIx/jH6MfI17jXqNeY15jniOd452jnWOdY91kHWQdZB1kXWRdZJ2knaSdpN2lHaUd5V3lneWd5Z3l3iXeJd5mHqYeph7mXyZfJl9mX2ZfZl+mX+ZgJmBmYKYg5iEl4WXhpeHloiWiJWHlYeUh5SHk4eTh5OGk4aThZKFkoWShZKFkoWRhJGEkYSRg5GDkYOSg5KDkoOTg5OCk4KUgZSBlIGUgZSBlYKVgpWBlYGVgZWBloGWgpaCloKWgpaClYGVgJV/lX6VfZR8lHuUepR5lHiUeJR3lHaUdZVzlXOVcpZxl3CXcJhwmXCab5tvnG+cb51wnXGecp5zn3Wfdp93n3ifeZ96n3uffJ98n32ffZ9+nn6efp5/noCegJ6AnoCegZ6Bn4Gfgp+DnoOehJ6EnoSehJ6FnYWdhJyEnIObgpuCmoGagZmAnYCdf5x+nH6cfpt+m32bfZt9m3ybe5p7mnqaepp5mnmaeZt5m3mbeJt4m3ebd5x2nHacdp11nXWddZ11nnWedZ51n3WgdaF1oXaidqJ3oniieKJ4onijeKN4o3mkeqR7pHykfaN+o3+jf6KAooGhgqGCoIOgg6CEn4SfhJ6Fnoadh5yHnIebh5uImoiaiJmJmImYiJeIl4iWh5WHlYaUhZSFk4SShJGDkYOQgpCCj4GPgY6AjoCOgI6AjoCOgI5/jn+Of45+jn2OfY59jnyOfI57jnuOeo96j3mPeZB5kHmReZF5knqTepN7lHyVfZV+ln6Xfpd/mH+YgJmBmoKbgpuDm4SbhJuFm4abh5uIm4ibiZuJmoqaipqKmoqai5qLmoybjZuNm42cjJ2MnYyejJ6Lnoueip6Kn4mfiZ+Jn4qeip6KnYqdipyKnImbiZuJmomaipmKmIqYipeKl4qWipaLlouWjJWMlYyVjJSMk4ySjJGLkYuRipCJkIiPh4+Gj4SPg4+Cj4GPgI9/j36PfI97j3qPeY95j3iPd5B2kHWQdJF0kXSSdZJ1knWTdZR1lHWVdZZ1l3WYdZh2mXaad5p3mnibeJt5m3mcepx7nHudfJ19nX2efZ5+nn+dgZ2CnYOchJyFnIach5uIm4ibiJqImoiZiJiImIeYh5eHl4eWhpaGlYaVhpSFlIWUhJSEk4STg5ODk4OUg5SDlIKUgpWClYKVgZWBlYGVgZWBlYGVgZaBloCWgJaAloGXgZeBl4KYgpiCmIKYgZeAl3+WfpZ9lnyWe5Z6lnmWeJZ3lXaWdZZzlnKXcZhxmXCZb5pvm2+cbp1unm6fb59wn3GgcqBzoXWhdqF3oniieaN6o3ujfKN9o32jfqN+o3+jf6N/ooCigKKBooGigaKBooGigqKDooOihKKFooWhhaGGoYaghaCFn4Sfg5+DnoKegp6BoYGhgKCAn3+ff55+nn6efZ59nX2dfJx7nHucepx5nHmceZx5nXmdeJ14nXedd513nnaedp52nnWedZ51n3WfdZ90oHWgdaF1onWidqJ3o3ejeKN4o3ijeKN5o3mjeqN7o3ykfaR+pICjgKOBo4Kig6KDoYOhhKGEoYSghZ+Gn4eeiJ2InIibiZuJmomaiZmKmYmYiZiJmImXiJeIloeWh5WGlIaThZOFkoSSg5GDkYKRgpCBkIGPgY+Bj4CPgI9/j3+PfpB+kH2QfZB9kH2QfJB7kHuQepB6kHmQeZF5kXmSeZJ5k3mTeZR6lHuVe5Z8l3yXfZh9mH6Zfpp/m4CbgZyBnYKdg52EnYadh52InYieiZ6JnomeiZ6JnomfiZ+Kn4qgi6GLoYuii6KLoouii6KKooqiiqKKoYmhiaCJoIqgi5+Ln4ufi56Knoqdip2KnIubi5uKmoqZipmKmYqYi5iLmIyXjJeMloyWjZWNlY2UjZSMk4uTipOKk4mTh5KGkoWSg5KCkoGSgJF/kX6RfZB7kHqQeZF5kXiRd5F2knWSdZJ0k3WTdZR0lHSVdJZ0lnSXdJh0mXOadJt0nHWddp52nnefeJ94oHmgeqF6oXuhfKJ8on2jfaN+o4CjgaKCooSihaGGoYehiKGJoImfip+Knoqeip2JnYiciJuIm4iaiJmHmYeYhpiGl4WWhZaEloSWhJaDloOWgpeCl4KXgpeCmIKYgZiBmIGYgZiBmIGYgZiAmICYgJiAmIGZgJmAmYGZgZmBmYGZgZmBmYCZf5l9mHyYe5h6mHmYeJh3mHaZdJlzmnKacZtwnG+dbp5un26gbqBuoW6ib6JwonGjcqNzpHSldaZ3pninead6qHuofKh9qH6ofqh/qH+ogKiAp4CngaeBp4GngaeCp4KngqeDpoSmhaWFpYalhqSGpIakhqSFo4WihKKEoYOhg6GCpIKjgaOBooCif6F/oH+gfqB+n32ffZ58nnyee556nnmeeZ55nnmfeJ94n3ifd593n3efdp92n3WfdZ91oHWgdKB0oHWhdaF1onWidqN3o3ejeKN4o3ikeKR5pHqke6R7pHykfaR+pICkgaSCpIKkg6SEo4SjhKKFoYWghqCHn4ieiZ6JnYmcipuKm4qaipqKmoqZipmJmYmYiZiIl4iXiJaHloeVhpWGlIWUhJOEk4OTg5ODkoKSgpGBkYGRgJF/kH+QfpB+kX2RfJF8knySfJJ7knqTepN5k3mUeJR4lHiUeJV4lXiVeJV4lnmXeZd5mHqZe5l8mnybfZx+nH+df56AnoGfgp+En4WghqCHoIihiKGIoYihiKGIooiiiKOIpImkiaSJpYqliqWKpYuli6WLpYukiqSKo4qiiqKKoouhi6GLoYuhi6CLoIufi56Lnoydi5yLnIubipuKm4qbi5qMmoyZjZmNmI2YjZeNl46XjZaMlouVi5WKlYmVh5WGlYWVg5WClYGUgJR/lH+UfZN8k3qTeZN4k3eTdpR2lHWVdZV0lXSWdJd0l3SYc5hzmXKacptynHKccp5znnOfdKB1oXajd6R3pHileaZ5pnqne6d8qHyofah+qX+pgamDqYSohaiGp4eniaeKpoumi6WLpIuji6KLoYqgip+Jn4meiZ2JnIiciJuHmoaahpmFmYSZhJmDmoOagpqCmoKagpqCmoKbgZuBm4GbgZuBm4CcgJyBnIGcgZyBnIGbgZuBm4CbgJuBnIGcgJyAnICcf5x+m32bfJt7m3mbeJt3nHacdJ1znnGecJ9vn26gbqFtoW2ibaNtpG6lbqVvpnCmcadyqHOpdKp1q3ereKx5rHqte618rX2tfq1/rX+tgK2ArYGtgayBrIGsgayCq4Krg6uEqoWqhqqGqYeph6iHqIenhqeGpoalhqWFpISkg6SCpYOlgqSCpIGjgaOAooCif6F/oX6gfqB9oHyge6B6oHmgeaB5oHigeKB4oHigd6F3oXehdqF2oHWgdaF1oXShdKF0oXSidKJ1onWjdqR2pHekd6R3pHeld6V4pXmleqV7pXylfaV+pX+lgaWBpYKlhKSFpIWkhaOGooehiKCJoImfip+Kn4qeip2KnIuci5uLm4ubipqJmomaiJmImYiZiJiImIeYh5iHl4eXhpaFloWWhJWDlYOUg5SClIGTgZOAk3+Tf5N+k32TfJN8k3yUe5R6lXqWeZZ5l3iXeJd4mHeYd5l4mXeZd5l3mnebeJt4nHmdeZ16nnuee598oH2hfqF/ooGigqKDooSihqOHo4ejh6SHpIekh6WHpYemh6aHpoeniKeIqImoiqeKp4uni6eLp4umi6aLpYuki6SKo4qji6OLoouii6GMoYygjKCMoIygjJ+Mn4uei56LnYudi52MnI2cjZuNm46ajpqOmo6ZjpmNmYyYi5iKmIiYh5iGmISYg5iCmIGXgJeAl3+Xfpd9lnuWepZ4l3eXdpd2l3WYdZh0mXSZdJpzmnObc5xynXGdcZ5xn3GgcaFxonKjcqRzpXSmdad2qHaqd6t4rHmseq17rnyufK9+r3+vga+Dr4Wvhq6IrYmsiqyLrIyrjKqMqYypjaeNpo2ljKSMoouhiqCKoIqfiZ+Inoeehp6GnoSdhJ2DnYOdg52CnYKdgp2CnYGdgZ2BnYGegZ6AnoCegJ6An4CfgZ+BnoGegZ6BnoGegJ+An4CfgJ+An4Cff55/nn6efJ57n3mfeJ93oHWgdKFzoXGicKNvo26kbaVtpWymbKdsqG2pbqlvqnCrcatxrHKtc651rneveK95sHqwe7B8sX2xfrF/sX+xgLGAsYGxgrCCsIKwgq+Dr4OvhK6Froauhq2HrIisiKuIq4eqh6mHqYeoh6iGp4WmhKaDp4Smg6aDpYKkgqSCo4GjgKKAon+hfqF9oXyhe6F6oXqheaF5oXmheaJ4oniieKJ3oneidqJ2oXWhdaJ1onWjdaN1pHWkdKR0pHWldaV2pnemd6Z3pnemd6d4p3mme6Z8p3ynfaZ+pn+mgKWBpYOlhKWFpIWkhaOGooeiiKKJoYqhiqCKoIufi5+Lnoudi52LnYudipyJnImciJyInIiciJuIm4iah5qHmoeah5mGmYaZhZiEmISXhJeDloKWgpaBlYCVf5V+lX2VfJV8lnuXeph5mXmZeZp4mnead5t3m3ebdpx2nHeddp12nnaedp93oHeheKF5onmieqJ7onyjfaN+pICkgaSDpYSlhaWGpoamhqaGp4anhqiGqIaohqiGqYeph6mIqomqiqqLqYupi6mLqIuojKiMp4ynjKeLpouli6SMpIyjjKOMooyijKKMooyijKKMooyhjKGMoIyfjJ6Mno2ejZ6OnY6djp2OnY6cjZyNnIucipyKm4mbh5qGmoWahJqDmoKZgZmAmX+Zfpl9mXuZeZp4mneadpp2mnWbdZt0nHScc51znXKecZ9xoHCicKNvpG+lb6Zwp3Cpcapxq3Ksc61zrnSvdbB2sXeyeLN5s3uzfLN+tIC0gbSDtIW0h7OJsoqxi7GMsI2wja+Oro6tjqyPq4+qj6iOp42mjKWMpIujiqOJooeihqKGoYWhhKCEoISfg5+Dn4Kfgp+Cn4GfgZ+Bn4CggKCAoICggKCAoICggaCBoIGggaCBoIGggKCAoICggKCAoICgf6B/oH2hfKJ6onijd6N2pHWkdKVypnGncKdvqG6pbalsqmyqbKtsq2ysba1urm+vcK9xsHKwc7B0sXayeLJ5snqze7N8s32zfrR/s4CzgLOBs4GzgrKCsoOyg7KEsYSxhbCGsIavh6+Ir4muia2JrImriauIqoiqiKqHqYaohaeFp4WnhaaEpoSlhKSDpIKkgaOAo3+jfqN9o3yjeqN6o3qjeaN5o3ikeKV4pXekd6R3pHekd6R2pHWkdKR0pXSldKV0pXWldaV1pXWldqZ2pnemd6Z3pneneKd5p3qne6d8p3ynfaZ+poCmgaWCpYOlhKWGpIajhqKHooihiKGJoYqhiqGLoIufjJ+Mn4ufi5+Ln4qfip+Jn4mfiJ+In4ifiZ6JnoidiJ2InYidh52HnYachZyFm4WbhZuEmoSag5mCmYGZgJl/mX2ZfJp7m3qceZ14nnieeJ54nneed552n3afdqB2oHWhdqF1onWidaN2pHakdqV3pXileaV7pXylfaV+pX+mgaaCpoOnhKiFqIWphqmGqYaphqmGqoaqhaqGqoaqh6qIqomqiqqLqouqjKmMqIyojKiNqI2ojKiMp4ynjKaMpoymjKWMpYyljKWMpYyljKWMpYykjKSNo42ijaGNoY2hjaGNoI6gjqCOoI2gjaCMoIyfi5+Kn4meiJ2HnYWchJyDnIKcgpuBm3+cfpx8nHuceZx4nHecd5x2nXaddZ50nnSfc6ByoXGjcKRvpW6mbqhtqW2rbqxurW6ubrBvsXCxcbJys3O0c7V0tnW3d7h4uHq5fLl+uYC4gbiDuIW4h7iJt4u3jLaNtY60j7OPso+xkLCQr5Guka2QrI+qjqmNqIyoi6eKpoilh6SGpIajhaOFooWihKGDoYKhgqGCoYKhgqGBoYChgKGAoYCggKGAoYChgKGBoYGhgaGBoYGggKCAoICggKCAoX+hf6J+onyjeqV4pnemdqd1qHSpc6lyqnCrb6xurW2ubK5sr2yvbK9ssG2wbrBvsW+ycLJxsnKzdLN1s3azd7N5tHq0e7R8tX21frWAtYC0gbSBtIK0grODs4OzhLKFsoWxhrGHsIiviK+Jr4quiq2LrIqsiquJq4mriKqIqYeph6iGp4amhaaFpoSlhKWEpIOkgaSApH+kfqR8pHukeqR5pHmleaV5pXileKV4pXild6V3pXemdqZ2pnWmdaZ0pnSmdKZ0pnWmdaZ1pnamdqZ3pnemd6Z3pneneKd5p3qne6Z8pnymfaZ/pYClgaWCpYOlhaSGpIajh6KIooiiiKGJoYmhiqGLoYygjKCMoIugi6CKoIqgiqCJoImgiKGIoYihiaCJoImfiJ+In4egh6CHoIaghp+Fn4WfhZ+Fn4SfhJ6DnoKegJ5/n32fe6B5oXiheKJ4oniieKJ4oneid6J3onejdqN1pHWkdaR1pHWldaV1pXWmdaZ2p3ineah7qHyofah+qH+ngKiBqIKpg6mEqoSrhauFq4arhquFq4WrhquGqoeqh6qIqYmpiqmLqYypjamNqI2ojaiNqI2ojKiMqIynjKeMp4ynjKeMp4ynjaaNpo2mjKaMpoymjKaNpo2mjqWOpY2kjaSOpI6kjqSOpI2kjaOMo4yji6KKooqhiaCIn4efhZ6EnoOegp6An3+ffZ98n3ufep95n3ifd592n3agdaF0onOjcaRwpm+nbqltqmysbK1srmywbLFssWyzbLRttW62cLZxt3G4crlzunW6drt3vHm9e719vYC8gryEvIa7iLuKuou6jbmOuI+4kLeRtZG0kbOSspKykrGRsJCvj66OrY2sjKqLqYqoiKeHpoelhqWGpIWkhaOEo4Ojg6KCooKigqKCoYGhgaCBoIGggaCAoYChgKGBoYGhgaKBooGhgaGAoYCif6J/o36kfaV8pnqneKh3qXWqdKtzrHOtcq5wr2+wbrBtsW2xbLJssmyybbJts26zbrNvs3CzcbNytHK0dLV1tXe1eLV5tXq1e7V8tX21frWAtYG1grWCtIK0grODs4SzhbOGsoayh7GIsImvia6Krouti6yMrIuri6uKq4qqiaqJqYioiKiHpoelhqWFpYWlhKSEpIOkgaSApH6lfaV8pXuleqV6pXmleaV4pXileKV4pXeld6V3pnamdqZ1pnWmdaZ1pnWmdaZ1pXWldaV1pnamdqZ3pnimeKZ4pnimeKZ6pnume6V8pH2kfqR/pICkgaOCo4SjhaOGo4ejh6OIo4iiiKKJoomiiqKLooyjjKOMooyii6GKoYqhiaGJoYihiKGIoYihiaGJoYihh6GHoYahhqGGooaihqKFooWihaKEo4SjhKODpIKkgaR+pXyleqZ5pnimeKZ4pnimeKZ4pnimeKZ4pnemd6Z2pXWldaV2pXaldaV1pnWmdqZ2pninead7p3yofah+qH+pf6mAqYGqgqqDq4SrhKuFrIashqyGrIashquHqoiqiaqJqoqpi6mLqIyojaiNqI2ojaiMqIyojKiNqI2njKeMqIyojaiNqI2ojaiNp42ojKiMqIynjKiMqI2ojaiOqI6ojqiOqI6ojaiNqI2ojaeNpoymjKWLpYqkiqSJo4iihqGEoYOhgaGAoX6hfaJ7onuieqJ5oniid6J2onWjdKRypnGob6luqm2sbK5rr2qwarFqsmqza7RqtWq2a7dsuW25b7pvu3C8cb1zvXW9dr53vnm+e75+voC+gr6FvYe9iLyKvIy7jbqPupC5kbmSuJK3k7aTtZS1k7SSs5GykLKQsJCvjq2NrIuqiqmJqIinh6aHpYalhqSFpISkg6SDo4Ojg6ODooKigaGBoYGhgaKAooCigKKAo4GjgaOBo4GkgaSApIClf6V9p3yoe6l6qnirdqx1rXOucq9ysHGxcLJvsm6zbrNutG20bbRttG20bbRttG61b7VwtXG1cbVytXO1dLV1tXe1ebR6tHu0e7R9tH60f7OAs4G0grODs4Ozg7ODs4SzhbKGsoixibCKr4qui62LrIyrjKuNqoyqi6mLqYqpiqiJqImniKeIpYelhqWFpIWlhKWDpYKlgaWApX6lfaV8pXyle6V6pXmleaV5pXileKV3pXeld6V3pXeldqZ1pnWmdKZ1pXWldqV2pXWldaV1pXaldqV3pXileKV4pXikeKR6pHukfKN8o32if6KAooCigaGCooSihaKGooajh6OHo4ijiKOJpImkiqSKpIuljKWMpYyki6SLo4qiiqKJooihiKKIooiiiKKIooeih6KGooajhqOFpIWlhaWFpIWlhKaEpoOng6iDqYKpgKp+qnyqeqt5q3mqeKp4qnmqeal5qXiqeKl5qHioeKh3p3end6d2pnamdqZ1pXald6V3pXileaV7pnumfKd9qH6of6mAqYGpgaqCq4OrhKuFq4WshqyGrIash6uHqoiqiaqKqoupi6mMqIynjaeNp42ojaiMqIyojKiNqI2ojKiMqIyojKmMqYypjKqNqoyqjKqMqoyqjKqMqo2qjaqNq42rjauNq42rjauNq42rjquOqo2pjKmMqIuniqeJp4imh6WFpYOlgaWApX6kfaR7pHukeqR5pHild6V1pnSocqlwq26sba1sr2uwarFpsmizaLRptWm2abdpuGm5arpru2y8bb1uvm++cb5zvnW+dr54vnq+fL5+voG+g76FvYi9ir2LvIy7jruPupC6krmTuZO5lLiUt5S3lLaTtZO1krSSspGxkK+Pro2sjKuLqoqpiaiIp4emhqaFpoWlhKSEpISjhKODo4KjgqOCo4KjgaOBpIGkgKSApYGlgaWBpoGmgKeAqH+ofql8q3qsea14rnawdLFzsnKzcbNxtHC0cLVvtW61brZutm62brdut262brZutm+2b7ZwtnG2crVztXS1dbV2tHi0ebN6s3uzfLN9sn+ygLGAsYGxgrGCsYOxg7GDsYSwhrCIr4muiq2LrIyrjKuMqoypjamNqI2ojKeLp4umiqaKpomliKWIpIikh6SGpIWkhKWDpYKlgaWApX+lfqV9pHyle6V6pXmkeaR5pHild6V3pXeldqV3pXeldqV1pXWldaV1pXaldqR2pHWkdaR1pHakd6R3pHijeKN5onmieaJ6oXyhfKF9oH6gf6CAoICggaCDoISghaGFoYWihqOGo4ejh6SIpIiliaWKpYqli6WLpYyljKWLpYukiqOJo4mjiaKIooiiiKKIooejhqOFo4WkhKSEpYSmhKeEp4Sog6mCqoKrgqyBroGuf699r3yve696r3mvea56rnqueq16rXqseat5qnmqeap5qXioeKd4p3emd6Z3pXeleKV4pXmleaV6pnumfKd8qH2pfql/qoCqgaqCqoKrg6uEq4WrhauGq4arh6qIqomqiqmKqYupjKiNp42njaeNp42njKeMp4yojKiMqI2pjKmMqYypi6qLq4urjKyMrIysjK2MrYuti62MroyujK6NroyujK6Nr42vja+Nro6ujq6OrY6sjayMrIyri6uKqomqh6qGqYOpgaiAqH+nfad8p3umeqZ5p3eodap0q3Ksb65ur22wa7FqsmqzabRotWi2aLZot2i4aLlpumm7abtqvGy8bbxuvXC9cr10vXW9d755vnu+fb2AvYK9hL2GvYi9ir2MvI28jruPu5C6krqTupO6lLmUuZW4lbeUtpS2k7WTtJOzkrGRsI+vjq2NrIyri6qKqYmoiKiHp4amhqaFpYWlhKSDpYOlgqWCpYKlgqWBpYGmgKeAp4CngaiBqYCqf6p+q32tfK56r3mwd7J2s3S1crVytnG2cbdwt2+3b7dvt2+3b7dvuG64brhuuG+3b7dvt3C3cLZxtnK1c7V0tHW0drN3sniyebJ6snuxfbF+sH+vgK+AroGuga6BroKug66ErYWth62JrIqsi6uLqoyqjamNqI2ojaeNpo2mjaWMpYuliqSKpImkiaSIo4ijh6OFpISkg6WCpYGlgaWApX+lf6V9pXyle6V6pXqkeqR5pHikd6N3o3ejd6N3o3ekdqR1pHWkdaR1pHakdqN2o3WjdaN1o3ajd6N4oniieaF5oXqhe6B8oHyffp9+n36ff5+An4Gfgp+Dn4SghKGFoYWihaOFo4akh6WHpYeliKWJpYqli6WLpYumi6aLpouliqSKpImkiaOIo4ijiKOHo4ejhqSFpISlg6WCpoKngqmCqoKrgayBrYGugK+AsH+xfrF9sXyxe7F7sXqyerJ7snuye7F7r3uue617q3yre6p6qXqoeqd5pnmmeaZ5pnimeKd4p3mnead5qHqoeql7qnyqfat+q3+rgKuBq4Krg6uEq4WrhaqGqoaqh6mIqYmpiqiLp4ynjKaNpo2mjaaMpoymjKaLpouni6eLqIupi6mLqouriqyKrIqti66Lr4uwi7CLsIqxirGLsouyjLKMso2yjLKMso2yjbKOso+xj7GPsY+xjrCNsIywi6+Kr4muiK6HrYSsgquBqn+qfqp9qnyqeqp4q3asdK1yrnCwbrFtsmu0arVptmm2aLdot2e4Z7hnuWe6aLppumm6abtqu2y7bbtuu3G8c7x0vHW8d715vXu9fr2AvYO9hL2GvYi9ir2MvY29j7yQvJG7kruTu5O6lLmVuZW4lriVt5W3lLaUtpS1k7SSspKxkbCPro6tjayMq4qqiamIqIeoh6eGp4amhaaDpoOmgqeCp4KngqeBp4GogKmAqoCqgKt/rH+tfa58r3uwerF4s3e1drZ0t3O3crhyuHG4cLhwuHC4cLdwt3C3cLdwt3C3b7dvt3C3cLdwt3G2cbZztXS0dLN1s3ayeLF5sXqweq97r3yvfa5+rn+tgK2BrIGsgayBrIOshKuFq4aqh6qJqYqpi6mLqYyojaeOpo6mjaWNpY2ljaSMpIukiqSKo4qjiaOJooeihqKFo4OjgqSCpIGkgaSApX+lfqV+pX2lfKR7pHuje6N5onmieKJ4oXehd6F3onaidaN1o3WjdqN2o3ejd6N3o3aidqJ2onahd6F4oHmgeqB6oHuffJ99n36ffp5/nn+ef56AnoGfgp+Dn4Ofg6CEoYSihKKFo4WkhqSGpYeliKSJpIqkiqSKpIqliqWLpoumi6aKpYqliaSIpIikh6SHpIakhaWEpYOmgqeBqIGpgKqArH+tf61/rn+vf69/sH6xfbJ8snyye7J7s3uze7R7tHy0fbF+sH6vfq1+rH2rfap7qXupe6h6qHqneqd5p3ioeKh4qXipeah5qXqpeql7qnyqfKt+q3+rgKuBq4Krg6uEq4WqhqqGqYeoh6iJqIqniqeLpoymjKaNpo2mjKaMpoumi6eKp4qniqiKqYqqiquKrImtiK6Jr4mwirGJsYmyirOKtIm0ibWKtYq1i7WMtY21jbWMtYy1jbWOtY61jrWPtY+1jrWNtI20jLOLsoqyibGIsIavhK6CroCtfq19rnyueq54r3Wwc7Fwsm6zbbVrtmq3abdouGi4aLlouWi5aLlnuWi5ablpuWm5arprumy6bbpvunG7c7t0u3W7d7x6vHy8fryBvIO8hb2GvYe9ib2LvY29j72QvJG8kbySu5O6lLqUuZW5lbiVuJW3lLeUt5S2lLWUtJOzk7KRsZCvj66OrYysi6uKqomqiKqHqYaohaiEqIOogqmCqYKpgqmBqoCqgKt/rH6tfq5+r32wfLF7s3mzeLV3tna3dLdzuHK4crhyuHG4cbhxuHG3cbdxt3G2cbZxtnG2cLZwtnC2cLZxtXK1c7R0s3WzdrJ3sXixebB6r3uufK18rX2sfqt/q4CrgaqBqoGqgaqCqYOphKmFqYepiKiJp4qniqeLp4ymjaWOpY6kjqSOpI2kjaSMpIujiqOKo4qiiaKJoYehhaGEooOigqKBo4CjgKR/pH+kf6R/pH2kfKN8o3uie6J7oXqgeaB4oHigd6B2oHahdaF1oXWidqJ2onejeKN4onehd6F3oHegeJ95n3qfe597nnyefZ5+nn+ef55/nn+ef56AnoGegZ+Cn4Kfg6CDoYSihKOEo4SjhaSGpIekiKSJpImkiqSJpImkiaWJpYmmiqaKpomliaWJpIikh6SGpIWlhKWDpoKngaiAqX+qf6t+rX6tfq5+rn+vf69+sH2wfbF8sXyxe7F7snuze7N8s32yf6+Ar4CugK1/rH+rfqt9qnyqfKl7qXqoeqh5qHioeKh4qHmoeah5qHqoeqh7qXupfKl9qX6qf6qBqoKqhKqFqoWphqmHqIeniKeJpoqmi6WMpYyljKaMpoymi6eLp4uniqeKp4qniaiJqYiriKyIrYeuh66Hr4exh7KIs4i0ibSItYi1iLaJtoq2ireLuIy5jLmMuYy5jLmNuY65jrmPuY+4jriNuI23jbeMtoq1irSIs4eyhbKDsYCxf7F9sXuyebJ2s3S0cbVvtm23bLhruGm4ablouWi5aLlpuWi5aLhouGm4abhquGq4arlsuW65b7lwuXK5c7l1uXa6eLp6uny6fruBu4K7hLuFvIe8ibyKvIy9jr2PvJC8kbySu5O7lLqUupW6lbmVuJW4lbeVtpW2lLaUtZS0lLSTs5KxkbCPr46ujK2LrYqsiayIq4erhqqEqoOqgquCrIGsgayArX+uf69+sH2xfbF8snuzerR5tXi2drd1t3S3dLdzt3O3c7hzuHO3crdzt3K3crdyt3K2crZytnK2cbZxtXG1cbRytHOzdbJ1snaxd7B4r3mue618rHyrfat+qn6pf6l/qICogaeBp4GngaeCp4OnhKeFp4eniKeJpoqmiqWLpYyljaSOpI6jjqONo42jjKOMo4yii6KLoYqhiaGIoIaghaCEoYOhgqKAooCjf6N/o3+jf6N/o32jfKN8onyifKF8oHufep95n3ifeJ93n3afdaB1oHWhdaF2oneieKJ4oXiheKB4oHifeZ56nnuefJ58nn2dfZ5+nn+ef55/nn+ef56AnoGegZ+BoIGhgqGCooOjg6ODpIOkhKSFpIalh6WIpYmliaWIpYiliKWIpYiliKaJpommiaaJpoimh6aFpoSmg6eCp4GogKl/qn6qfat9rH2tfq1+rn6ufq5+r32vfa59rnyvfK97sHywfK99r36vgKyBrIGsgayAq4Crf6t+qn2qfKp7qXqpeal5qHmoeah5p3mneqd6p3qoeqh7p3ynfKd9p36nf6eAp4KnhKeEp4WnhqeHpoimiaWKpIuki6SMpIyki6SLpIuli6WKpYqmiqaJp4moiamIqoerh6yHrYauhq6Gr4WwhbGGsoe0h7WHtYe2iLeIt4i4ibqKu4u7i7yMvIy8jLyNvI68jryPvI+8j7uOuo65jbmMuIy4i7eJtoi1hrSDtIG0f7V8tXq2eLZ2tnO3cLduuGy5a7lquWm5ablpumm6abppumm5ablpuWm5arhquGu4bLhuuW+5cLhxuHK4dLh2uHe4ebl7uX25frmAuYK6g7qFuoe6iLqKuoy6jbuOu5C7kbuSupO6k7qUupS6lbmVuZW4lbeVt5W2lLaVtpW2lLWUtZOzkrKRso+xjbCMr4uuiq6JrYithq2ErYOtgq6BroGvgK9/sH6xfbJ8snyyfLN7tHq0eLV3tna2drZ1tnS2dLZ0tnO3dLd0t3S3c7d0tnS2c7ZztnO2crZytnK1crVytHK0crN0s3WydrF3sHivea56rHurfKp9qX6ofqh+p3+ngKaApoGlgaSBpIGkgaSBpYKlg6WEpYaliKWJpImkiqSLpIykjaSNpI2jjaONo42ijKKMoYyhi6GLoIqgiaCIoIaghaCEoYKhgaGAoX+if6J/ooCigKJ/on6ifaJ9oX2gfaB9n3yee556nnmeeJ53nnaedZ91oHWgdaB2oXeheKF4oXmheaB5n3meep57nnyefJ59nn2efZ5+nn+ef55/nn+egJ6AnoCfgJ+AoIChgKKAo4GkgqSCpIOkhKWFpYalh6WHpYimiKWIpYelh6SIpYilh6WHpoemh6eHp4eohqiFqISogqiBqYCpf6l+qX2pfap9qn2qfat+q36sfqx+rH6sfqx9rH2sfKx8rH2rfat+q3+rgKmBqIKpgamBqYCqf6p+qn2qfKl7qXqoeqh6p3qne6d6p3qneqd6p3une6Z7pnymfaZ9pX6lfqWApYKlg6WEpIWkhqSHpIijiaOKo4uijKKMooyii6KKooqiiqKKo4mkiaSIpYinh6iHqYaqhquFrIWtha+EsISxhLKEs4W0hbWGtoa3hriHuYe5iLqJu4q8iryLvIy8jLyNvI68jryOvI+8kLuQuo+6jbmNuYy5i7mKuIm3h7eEt4G4frh8uHm5d7l1uXO5cLluum26a7pqumq6abppumm6abpqumq6arlquWq5a7lruWy5bblvunC5cblyuHO4dbh3t3m3erd7t323freAt4K3g7eFt4e3iLeKuIu4jLiNuI64kLmRuJK4k7mTuZS5lbiVuJW4lbeVt5W3lLaUt5S3lLaUtpS1k7WRtJCzj7KNsoyxi7CJsIewhbCEsYOxgrGBsoCyf7J9snyyfLN7s3u0erR5tXi1d7V3tna2drZ1tnW2dbZ0tnS2dLZ0tnW2dbZ1tXS1dLVztXO1c7VztHO0c7Rzs3OydLF1sHeveK55rXqse6t8qn2ofad+pn+mf6V/pYCkgaSBpIKjgqOBooGigKKAooGig6KEooajiKOJo4miiqKKoouijKOMo42jjaONo4yjjKKLoouhi6GLoIqgiaGHoYahhaGEoYOhgqGBoYChgKGAoYChgKJ/oX6hfqB+oH6gfp9+n32ffJ57nnqeeZ13nnaedZ90n3SgdaB2oXeheKF5onmheqF6oHqfe558nn2efZ59nn2efp5+nn6ef55/noCegJ6AnoCef59/oH+hf6GAooCigKOBo4Kkg6SEpYWlhqWGpYemh6aHpYelh6WHpYelh6WGpYalhqaFp4WohaiEqIOogqmAqX+pfql+qX2ofah8qHyofKl9qX2pfqp+qn6qfqp+qn2pfal9qH6of6h/qICogaaCpYGngaeBqH+pfql9qXyofKh7p3uneqd6p3une6d7pnqmeqZ6pnume6Z8pnymfaV9pH6kf6OAooKig6KEooWihqGHoYihiaGKoYuhjKGMoIygi6CKoIqgiaCJoIihh6KHo4alhqeFqISpg6uDrIOtg6+CsIKxgrKCs4O0hLWEtYW2hbeFuIa5h7qIu4m8iryLvYu9jLyNvI68jryPvI+7kLuQu4+6jrqNuoy6i7qKuom5hrqDuoC6fbp7u3m7eLt1unO7cLtuu227bLtrumq6arpqumq6arpqumq6arprumy6bLpsuW25brlvuXG5crhzt3W3d7Z5tnq1e7V8tX20f7SAtIK0hLSFtIa0iLSJtIq1i7WNtY61j7WQtpG2kraTtpO2lLaUtpS2lbaVtpS2lLWUtpO2k7aTtpO2k7aStpG2kLWOtYy1i7SJtIe0hbSDtIK0gbWBtYC0f7R9tH20fLR7tXq2ebZ5tni2d7Z2tna2drZ2tna3dbZ1tnW2dbZ1tXW1drV2tHW0dLR0tHS0dLN0s3Syc7J0sXSwda93rXiseat6qnuqfKh+p3+mf6WApICkgKOAo4GigaKCooKhgqGCoIGggJ+An4Gfgp+EoIWgh6GIoYihiaGKoouii6KLo4ujjKOMo4yjjKOLoouhi6GLoYqhiKGHooaihaKEooOhgqGBoYGggKGAoYChgaGAoH+gf6B+oX6hf6B/oH6gfKB8n3qfeZ54nnaedZ90oHSgdaF2oXeheKF5oXqheqB7n3yefJ58nn2efp5+nn6efp5+nn6ef55/noCdgJ2AnoCef55/nn+ff59/n3+gf6CAoYGigqKDooSjhaOGpIakhqWHpYalhqWHpIelh6WGpYalhaaEpoSng6iDqIOpgamAqX+qfqp+qX2pfal8qXypfah9qX2pfal+qH6ofqh+p36mfqZ+pX+lf6WApoGlgaSBo4ClgKZ/pn6nfad9p32mfaZ8pnume6Z7pnume6Z7pnqmeqZ6pnume6Z8pn2lfqV+pH+jgKKBoYKhg6CEoIWghp+HoIigiaCKoIugi6CMoIygi6CLn4qfiZ+IoIeghqGFooWkhKWDpoKogqqBrIGtga6Br4CwgLGBsoGzgrSDtYS2hLeFt4W4hrmHuoi7ibuKvIu8jLyNvI67jruOu4+7j7uQu5C7jruNu4y7i7uKu4i7hbyCvIC8fbx7vHq7eLt1u3O7cbtvu267bbtsu2y6a7prumu6a7lruWu5a7lrumy6bbluuW+5cLhxt3K3c7Z1tXa0eLR6s3uyfbJ9sX6xf7GBsIKwhLCFsIawiLCIsImxi7GMsY2xjrKPspCykbORs5K0k7STtJS1lLWUtZO1k7WTtZK1krWStpK2kraSt5G3kLeOt4y4iriIuYa5hLmDuYO5grmBuIC4f7h+uH23fbh7uHq4ebh4uHi4d7h2t3a3drd3t3e3d7d2tna2dbV2tXa1drR2tHazdrN1snWydbF1sHWwda51rXasd6t4qnmpe6h8p32mfqV/pICjgKKAooGhgaCBoIGggqCBoIKggp+Cn4KegZ2BnYGdgp6DnoSfhp+HoIegiKCJoYmhiqKKoouii6KLoouii6KLoouhi6GLoYmhiKGHo4WjhaOEooOigqGBoYGhgKGAoYChgaGAoX+hfqF+oX+hf6F/oX6ifaF9oXuheqB4oHagdaB0oHSgdaB2oXeheKF5oHqfe598nn2efZ59nX6dfp1+nn6efp5+nX+df52AnYCdgZ2AnYCdgJ2AnX+df51/nX6df56AnoGfgp+DoISghKGFooaihqKGooaihqKGo4akhqSFpYWlhKaDpoKngqiCqIGpgKp/qn6qfqp+qn2qfap9qX2pfah9qH2ofqd+p3+mf6Z/pX+kf6SAo4CigKKAo4GjgaKBon+jfqR9pH2kfaR9pH6kfaR8pHyke6R7pXqleqV7pXqleqV6pXulfKR9pH2jfqN/ooChgaGCoIOghKCFoIWghqCHoIegiKGJoYqhi6GLoYuhi6GLoIqgiaCHoIWhhKGDooOjgqWCpoGogKl/q3+sf65/r3+wf7GAsYCzgbSCtYK1g7aDt4S4hbmGuYe6iLqJuoq7i7uNu427jruOu467j7uPu468jbyMvIy8i7uJvIe8hLyCvIC8frx8u3q7eLt1vHO7cbtwu2+7brttu226bLpsumy6bLpsuWy5bLlsuW25b7hvt3C2cbZztXS0dbN3snixerB7sH2vfq5/rn+tgK2BrIOshKyFq4arh6yIrImtiq2MrY2tja6Oro+vkK+QsJGxkbKSs5Ozk7OStJK0krSSs5KzkbSRtJG1kbWQtpC3j7iNuYu6ibuHu4a7hbuEu4O6grqBuoC5f7l+uX65fbl7uXq5ebl5uXi4d7h2uHa4d7d4t3i3eLd3tne2d7V3tXe1d7R3s3eyd7F2sHawdq92rnatd6t3qnipeah6p3umfKV9pH6jf6KAoYGggaCBn4Kegp6CnoGegZ6BnoKegp2DnYKdgp2BnYGcgp2CnYSdhZ6Fnoaeh5+In4igiKCJoIqgiqCKoYqhi6GKoYuii6KKoomiiKKGo4WjhKOEo4OigqKCooGigKGAon+igKOAo3+ifqJ+on+if6N/o36jfaN9o3yieqJ4oXehdaF0oHSgdaB2oHefeZ96n3uefJ58nn2efZ1+nX6dfZ5+nn6efp5+nX+dgJ2AnYCdgJ2BnYCdgJyAnICcf5x/nH6cfp1/nYCdgp2CnoOfhJ+En4WghqCGoIahhqGGooWjhaSEpYOmg6aCp4KngaiAqX+qf6t+q36rfqp+qn6qfqp+qX6ofqd+pn6mf6Z/pYClgKSApICjgaKBoYGhgaGBoYChgKF/oH6ifaF8oX2ifqJ+on6ifaJ7onuje6N6o3qkeqR7o3ujeqR7pHyjfaN+on6hf6GAoIGggqCDoIOghJ+EoIWfhZ+GoIagh6CIoYmhiqGLoYuii6KLooqiiKKHooWihKODpIKmgaeAp3+of6l+qn6rfa19rn6ufq9/sX+yf7OAtIG1gbaBt4K4g7iFuYa5h7mIuoq6i7qMuo27jbuOu467jruOu427jbuMu4u7iruIu4a7g7uCu4C7frt9u3u7ebt2u3S7c7txu3C7b7puum66bbltuW25brhuuG64brdut2+2cLZxtXK0c7N0snaxd7B5rnqtfK19rH6sf6t/qoCqgamCqIOohKiFqIaoh6mIqYmpiqmLqYyqjKqNq46rjqyPrY+vj7CQsJGxkbGRspGykrKRspGykLOQtJC0kLSPtY63jbmMuYq6iLqHuoW6hbqEuoO5grmBuYG5f7h+uH24fLh7uHq4ebh5uHi4d7h3uHe3eLd4t3i3eLZ4tni1eLV4tHi0eLJ5sXmweK94rneud614q3iqeal5p3qmeqV7pX2jfqJ/oYCggJ+BnoGdgp2CnIOcg5yCnIGcgZyBnIGcgpyDnIOcgpyBm4GbgpuCm4ObhJuFm4WchpyHnYediJ2JnomeiZ6Jn4mgiqCKoYqhiqKJo4ijh6OFo4SihKKEo4OjgqSBpIGkgKR/pH6kf6V/pYCkf6R+o3+jf6N+pH6kfaR8pHyke6N6oniidqJ1oXWhdaB3oHifeZ97n3yffZ59nn2efp5+nX6efZ5+nn6efp5/nn+egJ6AnoCdgZ2BnYGdgJ2AnICdf51/nH6df51/nYCdgZ6CnoOeg56EnoSfhZ+FoIWghaGEooSjg6SDpYKmgaeAqICof6l+qX6qfqp+qn+qf6l/qX+pf6l/qH+of6eApn+lf6WApYGkgaOBo4GigqKCoYKggqCBoIChf6B/oH6gfJ98n32gfaB+oX6hfaF7oXuhe6F6onqieqJ6o3qjeqN7o3yjfqN/ooChgaCBoIKgg6CDoISfhJ+En4WfhZ6Fn4afh6CIoImhiqGKoomiiqOJo4ikiKSHpIWlg6aCp4Cof6h/qH6pfqp9qnyre6x8rXyufa99sH2wfrF/soC0gLWAtoC3gbeDt4W4hriIuIm5i7mMuYy5jbmNuY65jrqNuo26jLmLuYq6ibqHuoW6g7qCuoC6frp9unu6ebp2unW7c7pyunG6cLlvuW+5brhuuG63b7dvtm+2b7VvtHC0cbNzs3SydbF2sHiuea16q3yrfap+qX+ogKeAp4GmgaWCpYSkhaWFpYalh6aIpoimiqaLpouni6eMqIypjaqMq4ysjayPrZCukK6Qr5CvkLCQsI+xj7KPso+yjrONtYu2ireJuIi5iLmHuYa4hbiEuIS4g7iCuIG3f7d+t323fLd7t3q3ebd5t3i3d7d4t3i3eLd5tnm2ebV5tXm0ebN5snmxebB6r3queq16rHmreap5qXqoeqd7pXukfKN9on6hgJ+AnoGdgZyCm4Oag5qDmYOZgpmBmYCagZqBmoGagpuCm4KagpmBmYGYgpiCmIOYhJmEmYSZhZqGmoebiJuInIiciZyJnYmeiJ+Jn4mgiaGIooajhaOFoYSig6OCo4GkgKWApYClgKV/pX+lf6Z/pYClf6V+pX+lfqR+pH2lfKV8pXyle6R6pHmkd6N2o3ajd6J4onmheqF7oHygfaB9n32ffp9+n36ffp9/n3+ff59/n4CfgJ6BnoGegZ2BnYGdgZyAnICcf5x/nH6cf5yAnICdgJ2BnoKeg56Dn4SghKCEoYSig6ODpIOlgqWBpoCnf6h+qH6ofah+qH6ofql+qn+qf6l/qX+pgKmAqICogaeBpoGlgaWBpIKjgqOCooKigqGCoYKggqCBoIChf6B/n36ffZ59nX2efZ9+n36gfaB7oHugeqB5oXmheaJ6onqieqJ8on2jfqOAooKhgqGDoIOgg5+Dn4SfhJ+En4SehZ6Fn4WfhqCHoYmiiaKJo4mjiaSIpIelh6aGpoSngqiBqYCpf6l/qX6qfat8rHuse6x7rXytfK58r3yvfbB+sX6zfrR/tX+1gbWCtoS2hbeHt4m3ireLt4y3jLeNt424jriNuI24jLiLuIm4iLiGuYW5g7iCuIC4frh8uXq5ebp3unW5dLlzuXK5cblwuHC4b7dvtm+2cLVwtHC0cLNxsnKxc7F0sHWvdq54rXmre6p8qX2ofqd/poClgaWBpIKjgqKDoYSihaKFooaihqKHooiiiqOKo4qkiqWKpYumi6eLqYupjKqOqo+rj6yPrY+tj66Pro6ujq+Or46xjLKLs4m0ibSItYi2h7aHtoa2hraFtoS2g7aCtoG2gLZ+tn22fLZ7tnq2ebZ4tni2eLZ5tnm2ebZ5tXm0ebR6s3qye7F7sHqve657rXuse6t7qnupe6h7p3ulfKR8pH2jfaF/oICfgZ2CnIKag5mDmYOYg5iDl4OXgpaAloCXgJiBmIGYgpiCl4KXgZeBl4KWgpaCloKXg5eEmISYhZiGmIeZh5mImoibiJyInIidiJ6Inoifh6CGoYWhhKGEoYOigqOCo4GkgKR/pX+mf6Z/pn+nf6Z/pn+mf6Z/pn+mf6Z+pn2mfKZ8pnyme6Z6pnmmeKZ3pnemeKZ5pXqke6N8o3yjfaN+on6ifqJ+oX+hf6F/oX+ggKCAn4CfgZ6BnoGdgZ2BnIKcgZyAm4CbgJt/m3+bf5t/nH+cf52AnoGfgp+CoIOhg6GDooOjgqSCpIGkgaWApn6nfqd9qH2ofah+qH6pfql+qn+qf6p/qoCqgKmBqYGogqeCpoOlgqSCo4Ojg6ODooOig6GDoYOhgqCBoYChf6B/n36efZ1+nX6dfp5+nn2ffJ97n3qfeZ95n3ifeaB5oHqge6F9oX6hf6KBoYKhg6GEoYOgg6CDn4SfhJ6En4WfhZ+FoIWghqGHooijiKSIpIiliKWHpoemhqeEqIKpgamAqX+of6l+qn2rfKt7rHqse6x7rXuue657r3yvfLB8sX2yfbN+s3+zgbOCs4SzhbSGtIe1ibaKtou2jLaMtoy2jbeMt4y3i7eKt4m3h7eGuIS4g7iCuIC4f7h9uHq5eLl3uXa5dbh0uHK4cbdxt3C2cLVwtXG0cbRxs3GycrFzsXOwdK91rneteKx5q3uqfal+qH+nf6aApIGjgqKDoYOgg5+Dn4SfhZ+Fn4WfhZ+Hn4igiaCJoYmiiaOJo4mkiqWKpoqni6eMqI2ojqmOqo+rj6uOq46sjayNrYyuiq+JsIiwh7GGsYayhrKHsoayhrOFs4Szg7OCtIG0gLR+tH21fLV7tXu1erV5tHi1ebR5tHq0erR5s3myerJ7sHuvfK98rnuufK18q3yqfal9qH2nfaV9pH2jfaJ+oX6gf5+BnoKdg5uEmoSZhJeEloSVhJWElIOUgpSBlICVgZWBlYGVgZSBlIGUgZSBlYKUgpSClYKVgpWDloSWhZeGl4aXh5iHmYeah5uHnIedh52Hnoafhp+GoISgg6GDoYKigqOBo4GkgKR/pH6lfaZ9pn6nfqh+p3+nf6d/p3+ofqh9qH2pfKh8qXupe6l6qXmoeKl3qXepeKh6qHunfKd8pn2mfaV9pX6lfqR+o3+jgKKAoYCggaCBn4GegZ6BnYKdgp2CnIKbgZuBm4GbgJt/mn+afpt+nH6dfp1/noCfgaCBoYGhgqKBooGjgaOApICkgKV/pX6mfaZ9pn2nfah9qX2pfql+qn+qf6qAqoCpgamBqYKog6eDpoSlhKWEpISkhKOEooSihKGEoYOhg6CBoICgf6B+n36efp1/nH6dfp19nnyee596n3qfeZ55n3mfeJ94n3qfe6B9oH6ggKCBoIKghKCEoIShg6GEoYWghaCFoIWhhaGFoYShhaKHo4ekh6WHpoenh6eGp4WohKiDqYKpgamAqX+pfqp9q32sfKx7rHuseq16rXque697r3uwe7F8sXyxfLF+soCygbGDsYOyhLKFs4aziLOJtIq0irWLtou2i7eMt4u3ireKt4m3h7iFuIS3greBuIC4f7h9uHq4eLl3uHa4dbh0t3O2crZytXK0crRys3Kzc7NysnOxdLB1sHWvdq13rHireqp7qXyofqd/poClgaSCo4OhhKCEn4SfhJ+En4WfhZ+Fn4WehZ6GnoeeiJ+Hn4egh6GHooiiiKOIpImliqWLpoymjaeNp46ojqmNqY2pjKqLq4qriauIrIeshq2FrYWthq2Groauha+Er4Swg7CCsYGxf7J+sn2yfLN8s3uyerJ5snmyebF6sXqxerF6sHqwe697r3yvfK58rX2sfat+qn6pfqh/p3+lf6R/on+hf6B/n4CegZ2Cm4OahJmFmIaXhpaFlIWThZKEkoOSgpKBkoGRgZGBkYCRgJGAkoGSgZKBk4KTgpOClIKUgpWDlYSWhZaFloWXhZiGmYaahpuFm4WchZ2FnoWfhZ+FoIOhgqGCpIGkgaWBpYCmf6Z+pn2nfad9p32ofah+qX6pfqh+qX6qfqp9qn2qfKp7q3ureqt6qnmqeKp3qnipeal7qXypfKl9qX2ofqd+pn6mf6WApICjgaKBoYGggqCCn4Kegp6CnYKcgpyCm4KbgZuBm4GbgJt/m3+bfpx9nH2dfZ1+n36gf6CAoYCigKKBo4CjgKOAo3+kf6V+pX6lfaV9pn2nfKh8qXyqfap+qn+qgKqBqYGpgamBqYKog6iEp4SmhaWFpIWjhaOFooWhhaGEoIOggp+Bn4Cff59+nn6df51/nX+dfp19nXydep55nnmeeZ55n3ifeJ95n3qgfKB9oH6ggKCBoIKhhKGEoYShhKKEooWihaKEooSjhaOFo4WjhaSGpYalhqaGp4aohqiGqIWohKmDqYKpgamAqX+qfqp9q3yrfKx7rHqteq16rXqueq96r3qve7B8sHywfLB+sICwgbCCsIKwg7GEsIWxhrGIsoizibSJtYm1ibaKt4q3ibeJt4i3hbeEt4O3greBuH+4frh8uHq4eLh3t3a3drd1tnS1c7VztHO0c7Nzs3Ozc7J0sXSwda92rneteKx5qnqpe6h9p36mgKWApIGjgqKEoYWghZ+Fn4Seg5+Dn4SfhJ+En4SehZ6Gnoaeh5+Gn4aghqGGoYeiiKOIo4mjiqOLpIuki6WMpYymjKaMp4ymi6eKp4moiKiHqYephqmFqYaphqqGqoWqhKuEq4Ksgq2BroCvf7B+sH2wfLB7sHuwerB6sHqveq96r3qve657rnuue658rnytfa1+rH6rf6p/qX+ogKeApoGkgKOAooChgZ+BnYGcgpuDmYSYhZiGl4eWh5WGk4aShpGFkISPgo+Bj4GPgY+Aj4CPgJCAkICQgZGBkoGSgZOBlIGUgZSClYOXg5eEmISZhJqFm4WchJ2EnYSehJ6En4SghKCDooKjgaOBp4CogamAqYCpf6l+qX2pfKl8qXyqfap9qn2qfat+q32rfat9q32rfKt7q3ureqt6q3qreap4qXmpeql8qXyqfap9qn6of6d/poCmgaWBpIKjg6KDoYOghJ+DnoOeg52DnIOcg5uDm4KbgZyBnICcgJx/nX6dfpx9nX2dfZ59nn2ffqB/oYChgKKAon+if6N/o3+kfqR+pH2lfaZ8p3yofKl8qXyqfap+qn+qgKmAqYGpgqmCqIOohKeFpoWlhqSGo4aihqGGoYaghaCEn4Segp6BnoCdf51+nX+cf5x/nH+cfp19nXudep54nnieeZ55n3ifeJ95oHqgfKF9oX6hf6GBoYKig6KEo4SjhKOEpISkhaSEpISkhaWFpYWmhaaFpoWmhaaFpoWnhaiFqISpg6mCqoGqgaqAqn+rfat9q32rfKx7rXqteq16rnmuea55rnque698r3yufa5+roCvga+Cr4Kugq6Dr4SvhbCGsIayhrOHs4e0h7WHtoe2iLaHtoa2hLaDtoK3greBt3+2fbd8t3q3eLd3tne2drV2tXW0dLR0tHS0dLN0snSxdbB2r3aud614q3mreqp7qHynfaZ+pYCkgaOBooKhg6GEoIWghaCFoISfg5+Dn4Oegp6DnoOehJ+Fn4WfhZ+FoIShhKGFooaih6OIo4ijiaKJo4qjiqOLpIukjKWMpIuki6WKpoimh6aHp4anhqaGpoanhqeGqIWohKmDqoGrgKx/rX6tfq59r32vfK97r3uveq57rnuueq57rnute617rXute618rH2sfqt+qn+qf6mAqIGngaaBpYKkgqKCoYKgg56DnYObhJmFmIaXhpaHloeVh5SIk4iRh4+GjoWNgo2BjIGMgYyAjX+Nf45/jn+PgJCAkYCSgJKBk4GTgZSBloGYgpmCmoObg52DnoOfg5+Dn4Ogg6GDooOigqOBpYCmgKeAq3+sgK2AroCugK5/rX2sfax9q3ysfKx9rH2sfax+rH2tfa18rXytfKx7rHuse6x7rHureqt5qnqqfKp9qn2qfap+qoCpgaiBp4Kmg6WDpISjhaKFoYWghZ+FnoSdhJyEnIScg5yDnIKcgZyAnX+df55+nn6dfp19nnyefJ58nn2ffp9+oH+gf6F/oX+ifqN+o36kfqR+pX2mfad8qHuoe6p7q3yrfat+qoCqgKqBqYGogqiDp4SmhaWGpIajh6KHooehh6CHoIafhp6FnYSdgpyBnICbf5x+nH6bf5t/m3+bfpx8nXqdeZ54nneeeJ94oHigeKB6oHqhfKF9oX6hf6KAooKig6ODpIOkg6WDpYSlhKWEpYSmhKeEp4SnhaeFp4WmhaaFp4WnhaiFqISpg6mCqoGqgaqAq3+rfat9q32rfKx6rXmtea15rnmuea55rnque657rXytfa1+rYCtga2BrYKtgqyDrYOthK6Er4SwhbCFsYWyhbOFtIa1hrWGtYW1hLWDtoK2gbaAtn+2fbZ8tnq2ebV4tXe1d7R3tHa0dbR1tHWzdbJ1sXavd653rXireKp5qXqofKd9pn6lf6SAo4GjgaKCoYKhg6GEoYShhKKEooShhJ+En4Ofg5+EnoSehJ6EnoWfhZ+En4OghKGEoYWihqKHooiiiKKJoomiiqKKo4ujjKSMpIukiqWJpYilh6SHpYelh6WGpYamhaeFqISpgqqBq4CsgKx/rH6tfa18rnyue697r3uue657rnuue657rnuue657rnutfKx9q36rfqp/qoCpgKiBp4KmgqWCpIOjg6GEoISfhZ2Fm4aahpiHl4eWiJWIlIiUiJOJkomQiI+HjoaNg4yBjIGMgYyAjH+Mf41+jX6OfpB/kYCSgJKAk4CVgJaAmICagJyAnoGfgaCCoYKigqOCo4GkgaWBpoGngKh/qX+qfqt/r32wfrF/sX+xf7F/sX6wfq9+rX6ufK59rX6tfq1+rX2tfK18rnyufK58rnyufK58rXyte6x6rHurfat9q32rfqp/qoGpgamCp4OmhKWFpIajhqKHoYeghp+GnoWdhZyEnIScg5yDnIKcgZ2AnX+efp5+nn6efZ59nnyefZ59nn2efp9+n36ff6B/oH6hfqJ+o32kfqV+pn2nfKh7qXqqeqp7q3yrfat/qoCqgamCqIOng6eEpoWlhqSGo4ejh6KIoYigiKCIn4eehp2FnYWdg5yCm4Gbf5x+nH6bf5t/m36cfZ17nnmeeJ93oHagd6B3oXiheaF6oXuifKJ9on2if6KAo4GjgqSCpYKlgqWDpYOmg6aDp4Sng6eDp4OmhKaEpoWmhaaFp4SnhKeEp4OogqiBqICpgKmAqn6qfap9qnyrfKt6rHmtea15rnmuea16rXusfKx8q32rfqt/qoCqgaqBqoKqgqqCqoKrgqyDrYOuhK+EsISxhLKEs4S0hLWEtoS2g7eCt4G3gLd/t3+3frd8tnu2erZ5tXi0eLR4tHezdrN2snaxdrB3rniteKt5qnmpeqd7pnymfaV+pH+jgKKBooKhgqGCoYKhgqGDoYSihKKEooWhhZ+Fn4SehJ6EnYWdhJ2EnYSehJ6EnoOfg6CEoISghaGHoYiiiKGIoYmhiqGKooqii6OLo4ujiqSJpIikh6SHpIelhqaFp4SnhKiDqYOqgqqBq4Crf6x+rX2tfK57rnuue657rnuue697r3uwe697rnuvfK98rnytfax9rH6rf6qAqYGogaeCpoOlhKSEo4WihaCFn4aehpyHm4eZiJiIl4iWiJWJlImTiZOJkomRiZCIkIePhI+Cj4GPgY+Aj3+Qf5B+kH6QfZF9k36Uf5Z/l36Zfpt9nX2ffqB+oX6jf6SApICmgKeAqH+pf6p/q36sfq19rn2ufa99sn2yfrJ+sn+yf7J/sn+xgLGAsX+wfq9+r36ufq59rnyvfK58rnyvfK98r32ufa59rnytfK18rXytfa19rX6sf6yAq4GqgqmDqIWnhqaHpYejh6KHoYegh5+Hnoaehp6FnYSdhJyDnYKdgZ2Ann+efp5+nn2dfZ19nX2dfZ59nn2efp9+n36ffp9+oH6hfaJ9o32kfaV9p3ype6p6qnqqeqp7q3yrfap/qoCpgqiDqISnhKWFpIajhqOHooehiKGIoIigiJ+In4ieh56GnYWdhJyCm4Gbf5x+nX6dfpx/m36de556n3igd6F2onaidqN3o3ijeaN5o3qje6R8o32jfqOApIClgaWBpoGmgqaCp4KngqeCpoOmg6aDpYOkg6WEpYWlhaWEpYSlhKWDpoOmgaaBp4Cnf6h/qH6pfal8qXyqe6t5q3mreax5rHmseqx7q3yrfap9qn6pf6mAqIGogaiBqIGpgamBqYGqgauBrYKugq+CsIKygrOCtIK1g7aCt4K4gbiBuYC5gLl/uX64frh9uHy3e7d7tnq1erR5s3izeLF3sHeveK55rHqreql7qHunfKZ9pH2kfqN/ooChgaGCoYKggqCBoIGhgaGCoYOihKKFoYWhhqCFn4WfhZ+FnoWehZ6EnoSehJ6DnoOeg56DnoSehZ+GoIegiKCIoImgiaCJoYmiiaKKo4qjiaOIo4ekh6SGpYWlhaaEp4OogqiCqYKqgauAq3+sfq19rnuue657rnqueq96r3uwe7F7sXuxe7B8sHywfK99rn2tfq1+rH+rgKqBqYKog6aEpYWkhaOGooahhqCHn4ediJyImomZiZiJl4mWipaJlYqUiZSJlIqTiZOIkoaShJKCk4CUgJR/lH+Vf5Z+l36XfZh8mXybfZ18nnygfKJ7pHulfKZ8p3yofal+qn6rfqx+rX6ufq99sHyxfLF8snyyfLJ8tX21frV/tX+1gLSAs4CzgLOAsn+yf7GAsX+vf699r32vfa98r32vfa99r32ufa59rn2tfa19rX2tfa59rn6tgK2ArIKrg6qEqYaoh6eIpYikiKOIooihiKCHoIefhp+FnoWehJ6DnoKegZ6BnoCdf519nX2dfZ19nn2efZ59nn2efp5+n36ffaB+oX2ifaN9pHymfKd7qXuqeqp6qnqqe6p8qX2pfqh/qIGngqeEpoWmhqSHo4ejh6KIoYigiJ+In4ieiJ6Inoieh56HnYadhZ2CnIGcf51+nn2ffp1+nH2dep95oHihdqJ2o3WjdqR3pHileaV5pnqle6V8pX2lfqV/pYClgKaApoGmgaaBpoGmgaaCpoKlg6WDpIOjhKOEo4SjhKSEpIOkhKSDpIKlgaWApn+mf6d+p32ofah8qXuqeqp5qnmqeap6qnqqe6l8qX2pfql+qX+ogKiAqIGogamBqYGqgKuArICtgK6Ar4CwgLGAsYCygLOAs4G0gbaAt4C4gLmAun+6f7p/uX+5frh9uH23fLd8tny2e7R7s3qyerF5sHmueq17q3yqfKh9p32lfqR+o3+igKGBoIGggqCDoIOfgp+Bn4GggaCCoYOhhKGFoIWghaCGoYahhqGGoYahhaGFoISfhJ+DnoOeg52EnYSdhZ6Gnoaeh5+Hn4igiKCIoYihiKKJoomiiKOHo4ejhqSFpYSmg6eDqIKpgaqBq4GsgK1/rX6ufa98r3uverB6sHqxerF6sXqye7J7snuyfLJ8sX2xfrB+r3+uf62ArIGrgaqCqYOnhKaFpIajh6KHoYegiJ+InomcipuKmoqZipiKl4uXi5aKloqWipaKlomWiZaHl4aXhJeBl3+Xf5h+mH6afZt9nHyee597oHqheqN6pHqmeal5q3qseq17rnuufLB8sXyyfLN8tHy1fLZ8tnu2e7Z7tny1fLV8uH23frd/t4C2gLaBtYC1gLSAtICzgLOBsoGygLF/sH6vfq99sH2wfrB9r36vfq59rn2tfa59rn2tfa1+rX+sgKuBq4Krg6qFqYeoiKeJpomliaSJo4miiKKIoYehhqCGn4WfhZ6EnoOegp2BnYCdf5x9nH2dfJ58nn2efZ59nn2efp9+oH2hfaJ9o32kfaV8pnuoe6l6qXqpe6l7qXupe6l8qH2ofqeApoGlg6WEpYWlh6SHo4iiiKGJoYmgiZ+JnoieiJ6InoieiJ6InoefhZ6CnoGef55+n32hfaB9nXueeaB4oXehdqJ1o3WkdqR3pXemeKV5pXulfKV9pX2lfqR+pH+kgKSApICkgKSApYClgaWBpYKkg6SDpISkhKSEo4WjhKODooOig6OCo4GkgKR/pH+lfqZ9pnynfKh7qXqpeal5qXmpeql6qXqoe6h8p32nfqd+p3+ogKiAqICpgKt/rH+tf61/rn+vfq9+sH6xf7F/sn+yf7N/tH+1frZ+tn63frh/uH+4gLiAuH+3f7d+tn62fbV9tX20fLN8snyxfLB8r3ytfax9qn6ofqd+pYCkgKOAooChgaCCn4Kfgp+DnoOegp6BnoGegZ+Cn4OfhKCEoIWghaGGoYaihqOGo4ajhqKGoYWghKCEn4OehJ2EnYWdhZ2FnYadhp2Hnoefh6CHoYehh6GIooijh6OGpIWlhaaDp4KogqiBqYCqgKyArX+vf69+sH2xfLF7sXuyerJ6s3qzerN6s3qze7N7s3yzfLN9sn6xf7GAsICuga2CrIOrg6qEqYWnhqaHpIijiKKJoImfiZ6KnIubi5qMmYuZi5iLmIuYi5iKl4qYiZiJmIiZiJmHmoWag5qBmn+afpt9nX2ffKB7onmjeaV5pnioeKl4q3etd693sXeyeLN5tXq2erd6uHq5erp7unu7e7t7unu6e7p7uXy5fLh9uH64f7iAt4C2gbaBtYG1gbSAtIGzgbOBsoGygLKAsn+yf7F+sX6wfrB+sH6wfq9+rn6ufq59rX2sfqx/q3+qgKmBqYOphKiGp4imiaaKpYqkiqSKo4mjiKKIoYihh6CHn4aehZ2FnYScg5yBm4Ccf5x+nH2dfJ18nnyefZ59nn6efqB9oX2ifaN8pHylfKZ7p3qoeql6qXqpe6l7qHuofKh9p36nf6aApYKlg6WEpYWkh6SIo4iiiKGJoYmgiaCJn4ifiJ6Inoefh5+HoIaghaCCn4Ggf6B+oX2jfaJ8n3qfeaB4oXeidqJ1o3WjdaN2pHekeaR6pHukfKR9o36jfqJ/on+igKKAon+if6N/o4CjgKOAo4Kjg6ODo4SjhKOFo4WihKKDooOigqKBo4Cjf6N/pH6kfqV9pnyme6d6p3qoeqd6qHqoeqd6p3une6Z8pn2mfqd+p36of6l/qn+rf6x+rX6tfq5+rn6vfa99sH2wfbF+sX6yfbJ9s32zfbR9tH20frV+tX+1f7V/tX+1f7R/tH+0frN+sn6yfbF9sX2wfq5+rX6rf6p/qICngKWBpIGjgqGCoIKggp+DnoOdg52EnYOcgpyBnIGcgpyCnYOeg56En4SghaGFooWihaOFo4WjhqKGooaihaGFoIWfhZ6FnoWdhZ2FnYWdhp6GnoafhqCGoIahhqKGo4akhaWFpoSng6iCqYGpgKqAq3+sf65+r36wfbF9snyze7N7tHu0e7R6tHu0e7R7tHu0e7N7s3yzfbJ+sn+xgLGBsIKvgq6DrYSshauGqYeoiKeIpYmkiqKLoIufjJ2Mm42ajZmMmYyZi5mLmYuZi5mKmYmZiZqIm4ebhpuFnIScg52AnX6ffJ97oXqjeaV4p3epdqt2rHaudq92sXWzdbR1tnW3drl3uni7eLt4vHm8er16vXq9e717vHy7e7t7uny5fLl9uH64f7iAt4G2graBtYG0gbOBs4GzgbOBs4GygLJ/sn+yfrJ+sn6xfrF+sX+wf7B+r36ufq5+rH+rf6p/qoCpgaiDp4SnhaaHpYikiaSKpIqjiqOKooqhiaGJoIifh56InYech5yGm4Sbg5qCmoCbf5t+m32cfJ17nXydfZ59n32gfaB9onyjfKR8pXume6d7qHqoeqh6qHuoe6h7qHyofad+p3+mgKWBpYKlg6SEpIWjh6OIo4ijiaKJoomhiaGJoIigiKCHoIeghqGGooWihKGCoYGhf6J9o32mfKR8oXuieaJ4oneid6N2o3aidqJ3o3ijeaN6pHujfKN9o36ifqJ/oX+hf6F/oX+hf6F/oX+hf6KAoYKhg6GEoYShhKKFoYShg6GDoYOhgqKBon+ifqN+o32kfaR8pXyme6Z6pnqneqd6p3qmeqZ7pXumfKZ8pn2nfah9qX2pfap9q36rfqx+rX2tfa19rnyufK58rnyufK98r3ywfLB8sH2wfbB9sH2xfrF/sX+yf7J/sn+xf7GAsYCxgLF/sH+wf69+rn6tf6x/q4CqgamBp4KmgqSDo4Oig6CDn4OehJ2EnISchJuEm4OagpqBmoGbgZuBnIKcgp2DnoOfhKCDoYShhKKEooWihaKGooahhqGGoIafhp+Gn4WfhZ+Fn4WfhZ+Fn4WghaGFooWjhaOFpISmg6aDp4KogqmBqoCrf6x/rX6ufa99sHyxfLJ8s3u0e7R7tHu1e7V7tXu0e7R7tHu0fLN8s32yfbF/sYCwgbCCsIOvg6+Eroath6yIqompiqiKp4uljKONoY2gjZ+NnY2cjZyMm4ybjJuLm4ubipuJm4mciJyHnYadhZ6En4OggKF+onyjeqR5pnendql2q3WtdK90sHOyc7RztXO2c7dzuHO5dLp1u3a7drx3vHi9eb15vXq9e718vHy8fbt9un25fbh+uIC4gLiBt4K3g7aDtYK0gbOCsoKygbKBsoCyf7J+sn6yfrJ+sX6xfrF+sH+wf69/rn+tf62Aq4CqgKqBqYKog6eEpoWlhqSIo4mjiaKKooqhiqCLoIqfiZ6JnomdiJyInIibh5qGmoSag5qCm4Cbf5x+nH2cfJx8nHydfZ59n32gfKF8onuje6R7pXqmeqd6p3qoeqh6qHqoe6h8p32nfqZ+pX+lgKSBpIKkg6SEo4ajh6OIooiiiaKJoomiiaKJoYmhh6GHooaihaKEo4Skg6SCpICkfqR9pnyofKh9pHykeqR6pHmjeKN4oneid6J4onmieaJ6onuifKJ9on6if6F/oX+hf6F/oH+gf6B/n3+ff5+Bn4KggqCDn4SghKCEoIOgg6CDoIKhgaGAoX+ifqJ9on2jfKR8pHuleqZ7pnume6Z6pnqle6V7pXulfKV8pnynfKh8qHypfKl9qn2rfat9rH2rfat8q3yre6t7rHuse6x7rHusfK18rXytfa19rX2tfa1+rn6ufq5/rYCtgK2ArYCugK6ArX+tf61/rICrgKqAqYGogqeDpoOkhKOEoYSghZ6FnYWchZuFmoWahJmEmYOYgpiCmIGZgJqAmoGbgpyCnYKdgp6Cn4Ogg6CDoISghKGFoYWhhqGGoIaghqCGoIWghaCFoIWhhaGFooSjhKOEpIOlg6aDp4KogqiBqYGqgKyArH+tfq59rnyvfLB8sXuye7J7snuze7R7tHu0e7R7tHu0e7R7s3yzfLJ9sn6xf7CAsICwgq+Dr4OvhK+FroeuiK2Jq4qqi6mMp42mjqWOo4+ij6KOoY2gjaCMn4yejJ6LnoqeiZ6Jnoifh5+GoIWgg6KCo4Ckf6V9pnuneqh4qnarda10r3OwcrJys3G0cLVxtnG3cbdyuHO4dLl1unW6drt3vHe8eLx5vXq8e7x8u327fbp9uX65frh/t4C3gbeCtoO1g7SDs4OzgrKCsYKxgbGAsX+xfrF9sX2xfrB+sH6vfq5/roCtgK2ArICrgKqAqoGpgaiCp4Kmg6aFpYakh6KIoYmhiqCKn4qfi56KnYqcipyKm4mbiZqJmoiah5qGmoSagpqBmoCbfpx9nHycfJx8nH2dfZ18nnyffKF7onqjeqR6pXqleaZ5p3mnead6p3qne6Z8pn2lfqV/pICkgaSCo4Ojg6KFooaih6KIooiiiKKJoomiiaKJooiih6OFo4WkhKSDpYKmgqaCpoClf6V+p3ype6p8pnyme6Z7pnqleqR5o3mieaJ5onqheqF7oXyhfKF9oH6gf6B/oH+gf59/n3+ff55/nX+dgJ2BnoKeg56DnoSehJ6Dn4Ofg5+Cn4GggKB/oX6ifaJ8onyjfKN8pHuke6V7pXule6V7pHuke6R8pHyke6V7pnune6d7p3unfKh8qX2pfal8qXypfKl8qXupe6l7qXupe6l7qXuqe6p8qnyqfap9qX2pfql+qX6pf6l/qYCpgKmAqoCqgKqAq3+qf6qAqoCogaeCp4Omg6SEo4WihaCFn4aehpyGmoaZhpmFmIWYhJiEl4OXgpeBmICYf5iAmYCagZuBm4GcgZ2BnYKdgp6CnoOfg6CEoISghaCFoYWhhaGFoYWhhaKEo4SkhKWDpoOmg6eDqIKpgqmBqoGrgayArYCuf69+sH2wfLF8sXuxe7J7s3uzerN6s3uze7N7s3uze7J7snuyfLF8sXyxfbB+sH+vgK+Ar4Gugq6DroSuha2GrYesiayKq4urjKqNqY6nj6ePpo+mj6WOpY6kjaOMo4yii6KKoomjiKOIo4ekh6SFpIOlgqaAqH+pfqp8q3usea13r3awdLFzsnK0cLVvtW+2b7ZwtnC3cbdxt3K4c7l0uXW5drp3uni6ebp5unq5e7l8uH24fbh9t363frd/tIG0grSDtIOzhLKEsoSxg7CDsIKvga+Arn+ufq5+rn6ufq1+rX+sf6uAq4CqgaqBqYGogaiCp4KmgqWCpIOkhKOGooehiKCJn4qeip2LnIuci5uLm4qbipqKmoqZiZmImYiZh5qFmoSagpuBm3+cfpx9m32bfZx9nH2dfZ58n3ugeqF6oXmieaN5pHmleKV4pXmleaV6pXulfKR8pH2kfqN/o4CigaKCooOhhKGEoYWhhqGHoYehh6GIoYihiKKHo4akhaSEpISlg6WCpYKlgaaBpoCmf6Z9p3yofKt6qHunfKZ7pnule6R7o3qieqJ6oXuhe6B7oHyffZ99n36ff55/nn+ef55/nn+df52AnICcgZyCnIKdg52DnYOdg52DnYOegp6Bn4Cff6B+oX2ifKJ8onyifKJ8o3yjfKN7o3ujfKN8onyjfKN8o3uke6V6pnqmeqZ7pnumfKZ8pnymfKd8pnymfKZ8pnume6Z7pnume6Z7pnume6Z8pnymfaZ9pX6lfqV+pX6lf6Z/pn+mgKaApoCngKd/p3+ngKaBpoGlgqSDpISjhaKFoYaghp6HnYebiJqHmYeYh5eGl4WXhZaEloOWgZd/l3+Yf5h/mYCZgJmAmoCbgJuAnIGcgZ2BnYKegp+Cn4Ofg6CEoISghKGEooSjg6SDpYKmgqiCqYKqgquBq4Gsga2ArYCuf7B+sX6xfbJ8s3yze7N7s3u0erR7tHuze7N7s3uze7J7snuxe7B8sHyvfK98rn2ufa1+rX+tgKyBrIGsgqyDrISrhauGq4eriauKq4urjKqNqo6pj6mPqY+oj6iOqI6ojaeNp4yni6eKp4iniKeHqIeohamEqoOqgat/q36tfa58r3qwebF3snWzc7RytXC2b7Zutm62brZvt3C3cLdyuHO3c7d0t3W3drd2t3i3ebZ6tnu1fLR8tHy0fbV9tH20frR/sYCxgbGCsYOwhLCEr4Sug66DrYKtgayBrICrf6t/q3+qgKp/qYCogKiBqIKogqeCpoKlgqSDpIOjg6KDoYSghp+HnomdiZyKnIubi5qLmYuZi5mLmYuZi5mKmYqYiZiImIiZhpqFm4ObgZyAnH+cfpx9m32bfZt9nHydfJ57n3qgeaB5oXiieKN4o3ikeKR4o3mjeaN6o3uifKJ8on2ifqJ/oYChgaGCoYOghKCEn4Wfhp+HoIegh6CHoIehh6KGo4WjhKSEo4Ojg6SCpIGkgaSApYClf6Z9pnyoe6p6qnqnfKZ8pn2lfKN8onyhfKF8oHygfJ98n32efp5+nX+df51/nX+cf5x/nH+bgJuAm4CbgZuCm4KbgpyCnIOcg52CnYKegZ+Bn4CgfqF9oX2hfKF8oXyhfKF8oXyifKF8oXyifKJ8onyifKJ7o3ukeqR5pHqkeqR7pHykfKR8pHykfKR8pHykfKR8pHykfKR7o3uje6N7o3yjfKJ8on2ifaF+oX6hfqF+on6ifqJ/o3+jf6N/pH+kf6R/o4CjgaKCooOig6GEoYWghZ+Gn4eeiJyIm4maiZmImIiXh5eHloaWhZWElYGWf5d/l3+Yf5h/mH+Yf5h/mX+Zf5l/moCbgJuAnICdgZ6Bn4KfgqCDoIOhg6KDo4KkgqWBp4GogKqAq4CrgKyArYCtgK5/r36wfbF9snyze7R7tHu0e7R7s3uze7N7snuye7F7sXyxfLB8r3yvfK59rn2tfa19rH6sfqt/q4CrgaqBqoGqgqqDqoOqhKqGqoeqiaqKqouqjKqNq46rj6uPq4+rj6qPqo6qjqqNqoyqi6qKqomqiKuHq4ashKyDrYGtgK5/rn2vfLF6snmzd7R1tHS1crVxtnC3b7dvtm+2b7ZwtnC1cbZytnO1dLV0tHW0drN3s3izebJ6snuxfLB8sHyxfLF9sX6xfrF/rICsgayCrIOshKyErISshKuDq4KqgqmCqYKogaiAp4GngaaBpoGlgaSBpIKkgqSCo4Kjg6GDoISghJ+EnYach5uImomaipmLmIuYi5iMmIyYjJeLl4uXi5eKl4qYiZiImYeahpqEm4OcgZyAnH+cfpt+m36bfZt8nHude556nnmfeaB5oHihd6F3oneid6J4onmieaF6oXuhfKB8oH2gfqB/oICggZ+Cn4OfhJ+EnoWehp2GnYeeh5+Hn4aghqCFoYSihKKDooOigqKBo4GjgKOApH+kfqR9pHyle6d6qXqme6V9o32ifaF9oX2gfKB8n32ffZ59nn6dfpx+nH6cf5x/m3+bf5p/mn+agJmAmYCagZqBmoKagpqCmoKbgpyBnYCegJ6An3+ffp99oH2gfKB8oHygfKF8oXygfaF8oXyhe6F7oXuhe6J7oXqheqF5oXqheqF7oXuhfKF8oXyhfKF8oXyhfaF9oXygfKB8oHuge6B8oHyffJ98nn2efZ5+nn6efp5+n36ffp9/oH+gf6B/oX+gf6CAn4Gfgp+DnoOehJ2Fnoadhp2HnIibiJqJmomZiZiJl4iXiJaHloaWhZaEloGXf5d+l3+Yf5h/mH+Yf5h/mH+Yfph/mX+af5t/nICdgJ6An4GfgqCCoYKhgqKCo4GlgKd/qH+pfqp+q36rf6x/rX+tfq5+r32wfLF7sXqyerJ6snuye7F7sXuwfK98r3yvfK58rnytfK19rH2sfat9q36rfqt+qn6qf6qAqYCpgamBqIKogqiCqIOohKmFqYapiKqJqoqqi6qMq42rjqyOrI6sjqyOrI6sjqyNrIysi6yKrImth62GroWuhK6Cr4Cwf7B9sXyyerN5tHe1drV0tnO2cbZwtnC2b7ZwtnC1cLVxtHG0crRzs3SzdbJ2sHawd694r3mveq57rnytfK18rXytfa19rX6sfq1/qICogaiCqIKog6iEqISohKiEp4Omg6WDpYKlgqWCpIKjgqOCo4KigqKCooKhg6GDoIOgg56EnYSdhZyGmoeZiJiJl4qXi5aLlouWi5aLloyWjJaLloqWipaKl4mXiJiHmYaahZuEm4OcgpyBm4Cbf5t/m36bfZt8nHudep55nnmeeZ94n3egdqB2oHagd6B4oHmgeqB7oHugfJ99n32efp5/noCegZ6CnYOdhJ2FnIWchZyGnIadhZ2GnYadhZ6Fn4Sfg5+DoIKhgqGBoYCigKKAon+if6J+on2jfKR7pXukfKN9oH6ffZ99n32ffZ99nn2efp1/nX+cf5t/m3+bf5p/moCagJl/mX+YgJiAmICYgZmBmYGZgpmCmoKagZt/nH+cf51+nX6dfp59nn2efZ98n3yffKB8n3yffKB8oHyfe597n3ufe596n3qeeZ56nnqeep57nnuee598nnyefJ59nn2efZ19nX2dfJ18nHycfJx8nHycfZt9m32bfpt+m36bfpx+nH6cf5x/nH+df5x/nH+cgJyAm4GbgpuDm4SahZuFm4WahpqHmoiZiJmJmImYiZiJl4mXiJeHl4aXhZeDl4GXf5d/l3+Xf5d/l3+Xf5d/l36Xfph+mX6Zfpt+nH6df51/noCfgaCBoYGigKOApH6mfqd9p32ofah9qX2pfqp+q36rfax8rXuueq96r3mvea96r3que617rXysfKx8q3yrfat9qn2qfqp+qX6pfql+qX6of6h/qH+ogKeAp4GngaaCpoKmg6aDpoOnhKeEp4Woh6mIqYmqiqqLq4ysja2NrY6tjq6Oro6ujq6Nroyui66Jroiuh6+Fr4Svg6+BsICxfrJ8snuzebR3tXa1dbV0tXO1cbVxtHCzcLNxs3GzcbJysnKyc7F0sXWwdq53rXiseKx5q3mreqp7qnyqfKp9qn2pfal9qX2ofqh/pICjgaOBo4Kjg6ODo4OjhKOEo4SihKKDoYOhg6GDoIOgg6CDn4Ofg5+DnoOeg56DnYOcg5uEmoWahpmHmIiXiZaKlYuVi5SLk4uTipSKlIuVi5WLlYqVipWKlYmWiJeHmIaZhZmEmoOagpqBm4CagJt/mn6bfZt7nHucep15nXideJ13nnaedZ52nnaed554nnmfep96n3uefJ59nn6dfpx/nICcgZuCm4ObhJqFmoWbhZuFm4WbhZuFm4WbhZyEnISdg52CnoKfgZ+BoICggKCAoICgf6B/oH6hfaF8onyhfKB9nn2cfZ19nX2dfZ1+nX6cf5x/m4CbgJuAm4CagJqAmYCZgJiAmH+YgJeAl4CXgJiAmIGZgZmAmYCaf5p+mn6bfZt9m32cfZ19nX2dfJ58nnyefJ58nnyefJ58nXude516nHuce5x6nHqceZx6m3qbept6m3ube5t8m3ybfZt9mn2afZl9mX2ZfZl8mXyZfJl8mH2YfZh9l36Xfpd+mH6Yfph+mH+Yf5l/mH+Yf5h/mH+Yf5eAmIGYgpiDmIOYhJiFmIWYhpiHmIeYiJeIl4mXiZeJmIiYiJeHl4aXhZeDl4GXgJd/l3+Wf5Z/ln+WgJZ/ln6Xfph+mX6afZp9m36cfpx/nX+egJ6An4Cgf6F+on2jfKR7pXule6V8pnymfad9qHypfKp7qnqreat5q3mreap6qnqpe6h7qHyofKh8p32nfad9p36mfqZ/pn+mf6Z/pn+mgKWApYClgaSBpIGkgqSCpIOkg6SEpISkhKWEpoWmhaeHqIipiamKqoqri6yMrI2tja6Oro6uja+Nr4yvi6+Jr4iwhrCFsISwgrCBsH+xfbJ8snqzeLN3tHa0dbR0s3Oyc7JzsXOwcq9yr3Kvcq5yrnOudK51rXaseKt4qnmpeah5p3qne6Z8pnymfKZ9pX2lfaR9pX2kfqR/n4CfgJ+BnoKegp6CnoOfg5+En4SehZ6EnYSdhJyEnYSdhJyEnIOcg5uEm4Sbg5qDmYOYhJiFl4aXh5aIlYmVipSLk4ySjJKLkYqRipKKkoqTi5SLlIqUipSJlImViJaHl4aXhZiEmIOZgpmBmoCagJp/mn6bfJt7m3qbeZt4m3ibd5x2nHWcdZ11nXadd514nXmdeZx6nHucfJx9nH6bf5t/moCagZmCmYOZhJiEmYWahJqFmoWZhZmFmYSahJqEm4ObgpyCnIKdgZ6BnoCegJ6Ann+ff59/n36ffZ99n3yffJ18nHyafZt9m36bfpt/m3+af5p/moCagJuAm4CagJmBmYGZgJiAl4CXgJd/l3+Xf5eAmICYf5h/mX+Zfpl9mn2afZp9m32bfZx9nHycfJx7nHucfJx8nHybe5t7m3ube5p7mnqZepl6mXmZepl6mHqYeph6l3uXe5d8l32XfZd9l36WfpZ9ln2WfZZ9lX2VfZV9lH2UfZR+lH6UfpR+lH6UfpV+lX6VfpR+lH6Uf5R/lH+UgJSAlYGVgpWCloOWhJaEloWWhpaGloeWh5aHloiWiJaIl4iXiJeHl4aXhJeDl4KWgJaAloCWgJZ/ln+WgJZ/l36Xfph+mH2ZfZl9mn6afpt/m3+bf5x/nX6efZ98oHugeqF6onuie6J8o3yjfKR8pXumeqZ6p3mnead5pnmleaV6pHuke6R7o3yjfKN8o32jfaJ+on6ifqJ/on+if6KAooCigKKBooGhgaGBoYKhgqKDooOihKKEooSihKKEo4SkhaWGpoenh6eIqImpiqmLqourjKyMrY2tjK6MrouvirCJsIiwh7CFsISwgrCBsH+vfbB7sHmweLF3sXaxdbB1sHSvdK50rnSsdKt0q3Orc6t0qnWpdql3qHioead5pnqleqV6pHuje6N8o3yifKJ8oX2hfaF9oX2gfqB/m4CbgJuBmoKagpqDmoObg5qEmoWahZqFmYWZhZiEmISYhJiEmISYhJiEmISXhJeEloSVhZWGlYeUh5OJk4qSi5GMkIyQjJCLkIqQiZCJkYqRipKKk4qTipOJlIiUh5WGlYWWhJaDl4KXgpiAmH+Yf5l+mnyae5p6mnmaeJp4mniad5p1mnSbdJt1m3abd5t4m3maeZp6mnqae5p8mX6Zf5mAmIGYgpeCl4OXhJeEmISYhJiFmIWYhZiEmISYg5mDmoKagpuBm4GbgZyBnYCdgJ1/nX+df51/nX6dfp19nX2efZx8m32afZp+mn+Zf5l/mX+Zf5l/moCagJqAmoGagZmBmIGXgZeBl4CWgJZ/ln+Xf5d/mH6Yfpl+mX6ZfZl9mn2afJp8mnybfJt9m3ybe5t7mnyafJp7mXuZe5l7mHuYe5d7l3qWepd6lnqWepZ7lXuVe5V7lHuUfJR8k32TfZN+k36TfpJ+kn6SfpJ+kn6RfpF+kH6QfpB+kH6QfpB9kX2RfpF+kH6QfpB+kH6QfpB+kH+Rf5GAkoGSgZKCk4OTg5OEk4WThZOGlIaUhpSHlIeVh5WHlYeWh5aGloWWhJaDloKVgZWAlYCWgJZ/ln+Xf5h/l36Yfph+mH6Xfpd9mH6Yfpl+mX6Zfpp+m32ce516nXqeep57n3ufe598n3yge6B7oXqieaJ5onmieaF5oHqgep97n3ufe597nnyefJ59nX2dfp1+nX6dfp1/nn+egJ6AnoCegJ2BnYGdgZ2BnoKegp6DnoOfhJ+En4SfhJ+EoISghKGFooWjhqSHpYimiKeJqImpiqqKqouri6yLrIqtia2Iroevhq+Fr4Svg66Brn+tfa18rXqtea14rXesdqx2q3Wrdap2qnapdqh2qHSndad1pnald6V4pHmkeaN6onqheqF8oHygfKB8n3yffJ59nn2efZ1+nX6cfpx/l4CXgZaCloOWg5aDloSWhJaEloWWhZaFlYWVhZSElISUhJSElISUhJSElISUhJOFk4WThpKHkoiRiZCKj4qPi46MjoyOjI+Lj4qPiY+Jj4mQiZCKkYqSiZKIk4eThpSFlYSVg5WClYKWgZeAl3+Yfph9mHyZepl6mXmZeJl4mHiYdpl1mXSZdJl1mXaZd5l4mHmYeZh6mHqYe5h8l36Xf5eAloGWgpWDlYOVg5aEloSWhJeFl4SXhJeEl4SXg5iCmIGZgZmBmYCagJuAnH+cf5x/nH+cf5x/nH6cfpx+nH2bfZt9mn6Zfpl/mICXgJeAl4CYgJiAmICYgJmBmYKYg5iDl4OWgpaCloGWgJZ/ln6Xfph9mH2YfZl9mX2ZfJp8mnyafJp8mnyafJl8mnyae5l7mHyYfJh7mHuXe5d7lnuVe5V7lHuUe5R6lHqTe5N7k3uSfJJ8kXyRfJF9kH2QfZB9kH6QfpB+kH6Pfo9/jn+Of41/jX6Nfo5+jX6Nfo19jX2Nfox9jH2Nfo1+jX6NfY19jn6Of49/j4CPgZCBkIKQg5CDkYSRhZGFkYWShZKGk4aThpOGlIaUhpSFlIWUhJSDlYKVgZWAlYCVf5Z/l3+Xf5h/l36XfpZ+ln6WfpZ9ln2WfZZ9l32XfZh9mHyZepp6mnqbe5t7m3ubfJx8nHyce516nXqeeZ55nXmcepx6m3ube5t7mnyafJp8mX2ZfZh+mH6Yfph+mH6Zfpl/mX+ZgJmAmYCZgZmBmYGZgZmBmoGagpqCmoObhJuEm4SchJyEnISdhJ6En4WghaGFooajh6SHpYiliKaJp4moiaiJqYipiKqHqoarhquEq4OrgquBq3+rfqp8qXuoeqh5qHind6d3p3end6Z3pnileKV3pHajd6J3oniheKF5oHmfep56nXucfJx8nHycfJt8m3ybfJt9mn2afZl+mX6Yf5iAlIGTgZODk4OSg5KEkoSThJOEkoWShZGFkYWRhJGEkYSQhJCEkIOQhJCEkIWQhZCFkIaQh4+Ij4iOiY2KjIuMi4yMjIyNjI2LjYmNiI2IjoiOiI+JkImQiJGHkoaThZSElIOUgpSBlYGVgJZ/ln6Xfpd9l3yXepd5l3iXeJd4l3eXdpd1mHSYdZd1l3aXd5d4l3mXeZd6lnqWe5Z8ln2Vf5WAlIGUgpSClIKUgpSDlISUhJWElYSVhJWEloOWgpaBl4GXgJiAmX+Zf5p/m36bfpt+m36bfpt+m36bfpt+m36afpl+mH+YgJeAloGWgZaBloGWgJeAl4CXgZeCl4KXg5eDloOWg5WClYGVgJV/lX6WfZZ9l32XfZh8mHyZfJl8mXyZfJl8mX2YfZl8mXyYfJd8l3yWfJZ8lnyVfJR8lHyUfJN7knuSe5F7kXuRe5F8kHyQfZB9j32PfY59jn2Nfo1+jX6Ofo1+jX+Mf4yAi4CLf4t/i3+Mfox+i36Lfot+in6Kfol9in2KfYp9inyLfIt9i36Mfox/jICMgI2BjYGNgo6CjoOPg4+EkISQhJGFkYWRhZKFkoaShZKFkoSSg5OCk4GUgJSAlH+Uf5R+lX6VfpV/lH+UfpN+k36TfpN9k32TfZN9lH2UfJV8lXuWepZ7l3uXe5d7l3uXfJh8mHyZe5l6mXmZepl6mHqYepd7l3yXfJZ8lnyVfJV9lH6UfpN+k36UfpR+lH6VfpR/lICUgJSAlICUgJWAlYGVgZWBlYGVgZaCloOWg5eDl4SYhJiEmYSZhJqEm4SchJ2FnoWfhp+GoIahh6KHooejh6SHpIelh6WGpoWmhKaDp4KngaeAp3+mfqZ9pXyke6R6pHmkeaR4o3ijeKJ4oniheKF4oHifeZ55nXmdeZx5m3qaepl7mXyYfJh8mH2YfJd8l3yXfJd9l36WfpV+lX+Vf5SAkIKQgo+Dj4OPhI+Ej4SPhY+Fj4WOhY6FjoWOhI6DjoSOhI6EjYSNhI2FjYWMhYyGjIeMh4yIjImLiouKi4uKi4qLi4uLi4yKjImMiIyHjYeNh46Hj4ePhpCGkYWShJODlIOUgZSAlICVf5V+lX2WfZZ8lnyWepZ5lniWd5Z3l3eXdpd1l3WWdZZ2lnaVd5V4lXmVeZV6lXqVe5R8lH2Uf5SBk4KSgpKCkoKSgpKDkoOTg5OEk4SUhJSDlIOVgZWBloCXf5h/mH+Zf5p+mn6afpp+mn6afpp+mn6afpp+mX6Zf5h/l4CWgJWBlIGUgZWBlYGVgJWAlYCVgZWClYKVg5WElYSVhJSDlIGUgJR/lH6VfZZ9ln2WfZd9l32YfJh8mHyYfJd9l32XfJd8l3yWfZV9lHyUfJR8k3yTfJJ9kn2RfJF8kHyQfI98j3yOfI58jn2OfY59jX6Nfox+i36Lfot+i36Lfop/in+KgIqAiX+Jf4l/iX+Jf4l/iH+Ifoh+iH6IfYh8iXyIfIh8iHyIfYh9iX2Jfol+iX+Jf4qAioCKgYuBjIKNgo2DjoOOhI6Ej4WPhY+Fj4WQhJCDkIORgpGBkYCSgJJ/kn+Rf5F/kX+Rf5B/kH+Qf49+j36Pfo99j32PfZB9kHyRfJF7knuSe5J7k3uTe5N7k3uUfJR8lXuVe5V6lXuUe5R7lHuTe5N8k3yTfJJ8kn2RfZF+kH6Pfo9+kH6QfpB+kH6QfpB/kH+QgJCAkICQgJCAkICRgZGBkYGRgZGCkoKSg5ODk4SUhJSElYSVhJaEl4SXhJiEmYSahZuFm4WchZ2GnYaehp+Gn4aghqCFoYShhKKDooKigaKAon+ifqF9oX2hfKF8oHqgeqB5n3mfeZ55nnmdeZ16nHqbepp6mXqZeph6l3uWe5V8lXyVfZR9lH2UfZR9lH2TfZN9k36TfpJ/kn+RgJGBjYKNg4yDjIOMhIyEjISMhIyFjIWLhYuEi4SLg4uDi4OLhIuEi4SLhYqFioWKhoqGioeKiIqJiYqJiomKiYqJiomKioqKioqJi4mLiIyGjIaMho2GjoWPhZCEkYSSg5OCk4GUgZSAlH+VfpR9lH2VfZV8lXuVepV5lXiWeJZ4lneWdpZ2lnaVdpV2lXeVeJV4lXmVepV6lHuUfJN8k36Tf5KBkoKRgpGCkYKRgpGCkYORg5GEkoSSg5OCk4KUgZWAln+Wf5d/l3+Yf5l+mX6Zfpl+mn6Zfpp+mn6Zfpl/mICXgJaAlYGUgZOBk4GTgZOBk4GTgJOAk4GTgpOCk4OUg5SElISUhJSDlIGUgJR/lH6UfZR9lX2VfZZ9ln2WfJZ9ln2VfZV9lnyVfJV8lH2TfZJ9kn2RfZF9kH2QfZB+kH2PfY59jn2OfY19jX2MfYx9jH6Mfot+i36Kfol+iX6Jfol+iX6Jf4l/iH+IgIiAh4CHf4d/h3+Gf4Z/hn+GfoZ+h32HfYd8h3yHfId8h3yHfYd9h32GfYZ+hn6Hf4d/iH+IgImBiYGKgoqCi4OLg4yEjISNhI2EjoSOg4+Dj4KPgY+Bj4CPgI9/jn+Of45/jX+Nf41/jH+Mf4t/jH6Mfox9jH2MfI18jXyNfI58jnyOe457jnuPe497j3uQfJB8kXyRe5F8kHuQe5B7kHyQfI98j32PfY59jn2Nfo1+jH+Mfox+jX2NfY1+jH6Mfox+jH+Lf4t/jH+MgIyAjICMgIyBjYGNgY2CjoKOg4+Dj4OQg5CDkYORhJKEkoOTg5SDlYSVhJaEloSXhJiFmIWZhZqFm4WbhZyEnISdg52CnYKdgJ5/nn6efp5+nX6dfZ19nXyde5x6nHqbepp6mnqZepl6mHuXe5Z7lXuVe5R8k3ySfJJ8kXyRfZF9kX2QfZB9kH2QfZB+kH+Pf49/j4COgY6Ci4KKg4qDiYOJg4mEiYSJhImFiYWJhYmEiYSIhIiDiISIg4mDiYSIhImFiYWJhomHiYeJiIiJiIqIioiKiIqIioiKiImJiYmIioiKhouFi4WLhYyEjYOOg4+DkIORgpKBkoCTgJN/k36TfpN9k3yUfJR8lHuVepV5lXiVeJV3lXeWd5Z3lXeVdpV3lXeUeJR4lHmUepR7k3uTfJJ9kX6Rf5GBkYKQg5CDj4KPgo+Cj4OQg5CDkYORgpKCk4GTgJR/lX+VfpZ/l36Xfph+mH6Yfph/mH+Yf5h/l3+XgJaAlYCUgJOBkoGSgZGBkYGRgZGBkYCRgJGAkYGRgZKCkoKSg5KEk4STg5ODlIGTgJN/k3+TfpN+k32TfZN9k32TfJN9k32TfZN9k32SfZF9kX6Qfo9+j36Ofo5+jX6Nfo1/jX6Mfox/jH+Mfox+i36Lfop+in6Kfol+iX6Ifoh+iH6Ifod/h3+Hf4d/hoCGgIWAhYCFgIWAhICEgIR/hX6FfoV9hnyGfIZ8hnyGfIZ8hn2GfYZ9hX2FfoV+hX+Ff4V/hoCHgIeAh4GIgYiCiIKJgoqDioOLg4yDjIOMg4yDjIKNgY2BjYCMgIyAjH+Lf4t/ioCKgImAiYCJgIl/iX6Jfol9iXyJfIp9in2KfYp9inyKfIp7inuKeot7i3uLfIx8jXyNfIx8jHyMfIx8jHyMfYt9i32LfYp+in6Kfol/iX+Jfol9in2JfYl9iX6Ifoh+iH+If4h/iH+If4h/iICIgIiAiICJgYmBioKKgouDi4OMg4yDjYONg46Dj4OPg5CDkIORg5GDkYOSg5OEk4SUhJWEloSXhJeDl4OYgpmBmYGZf5p/mn6afpp+mn6afZp9mn2afJl7mHuXe5d6lnuVe5V7lHuTe5J7kXuRfJF8kHyPfI58jn2OfY19jX6Ofo19jX2Nfo1+jH+MgIyAjIGMgYuCiIOIg4eDh4OHg4eEhoSHhIaFh4WHhYaFhoWGhIaEhoSGg4eDhoSGhIeFh4WHhoiGh4eHiIeJh4mHioeJh4mHiYiJiImJiYmIioeKhoqFi4SMg4yDjIKNgo6Cj4GQgZCBkICRf5F/kX6SfZJ8knyTfJR7lHqUepV5lXiVeJV4lXiVd5V3lXeVd5V3lXeUeJR5lHmTepN7knySfZF+kH+QgI+CkIOPhI+EjoOOg46DjoOOg4+DkIORgpGBkoCSf5N/lH6UfpV+lX6VfpV+lX6Vf5Z/loCVgJWAlICTgJOAkoCRgJCAkIGQgY+Bj4GPgY+Aj4CQgJCAkICQgZCBkIKRg5GDkoOSg5KDkoKSgZKAkn+RfpF+kX6QfpF+kH2QfZB9kH6QfZB9j32Pfo5+jn6Nf41/jH+Mf4t/i3+Lf4t/ioCKf4p/in+Kf4l/iX+If4h/iH6Hfod+h36Hfod+h36GfoZ/hX+Ff4SAhICDgYKBgoCCgIOAg4CDf4R+hH2FfYV8hXuGe4V7hXyEfIV8hH2EfYR9hH2DfoN/g3+Ef4R/hYCFgIWAhYGGgYaCh4KHgoiCiYKJgomCiYKKgoqCioKKgYqAioCKf4mAiYCIgIeAh4CHgIeBh4CHgId/h36Hfod9hn2GfYZ9hn2GfYZ8hnyGfIZ7hnuGe4Z7h3uIe4h7iXyIfIh8iHyIfIh8iHyIfYh9h36Hfod+h36GfoZ+hn6GfYZ9hn2FfYV9hX6FfoR+hH+Ef4R/hH+Ef4R/hICEgISAhICFgYWBhoKGgoeCh4KIgoiCiYKJgoqCi4KLgoyCjIKMg42DjYKOgo6Dj4OQg5GDkYOSg5OClIGUgZWAlYCWf5Z+ln6WfpZ+ln6WfpZ9ln2WfZV8lXuUe5R7k3ySe5F7kHyOfI58jnyNfI18jX2MfYt9i32Lfop+in6Lfop+in6Kf4p/iYCJgImAiYGJgomChoOFg4WDhYSFhIWFhISEhISFhIWEhYSFhIWEhYSEhISFg4WEhISFhYWFhYaFhoaGhoeGiIaJhomGiYeJh4iHiIiJiIiJiIqHi4aLhouFi4SLg4uCjIGNgY2AjoCOgI9/j3+PfpB9kX2RfJJ8k3uTe5R6lXqVeZV5lXiVeJV4lXeVd5V2lXaVd5R3lHiUeJN5k3qSe5J8kX2RfpB/kICPgY6CjoOOhI6FjoSNg42DjYONg46Cj4KPgZCAkH+Qf5F+kn6SfpJ+kn6SfpJ+k36Tf5OAk4CSgJGAkYCQgJCBj4CPgI6AjoCOgI6AjYCNgI6Ajn+PgI+Aj4CPgY+Bj4GPgpCDkIOQg5GDkYKQgZCAj3+Pf45+jn6Ofo5+jX6Nfo1+jX6Nfo1+jH6Mf4x/i3+LgIuAioCKgImAiYCJgImAiYCIgIiAiH+Hf4d/h3+Gf4Z/hX+FfoV+hX6FfYV+hX6Ef4N/g4CCgIKAgYGBgYGBgYCBgIF/gX6CfYN8hHuFe4V7hXuEe4R7hHyDfIN9g32CfYJ9gn6CfoJ/gn+DgIOAg4CDgIOAhIGFgYWChYKGgoaChoKGgoaChoKHgoeCh4GHgIeAh4CGgIaAhoGFgYWBhIGEgYSBhICEf4R+hH6EfoR+g36DfoN+g36DfYN8g3yCfIJ7gnuDe4N7g3uEe4R7hHyEfIR8hXyFfIV8hHyEfYR9hH6DfoN+g36DfoN+g36DfYN9gn2CfYJ+gn6CfoF+gn6Cf4F/gX+Bf4F/gX+Bf4GAgYCCgIKBgoGDgYOChIGEgYWBhYGFgYaBh4GIgYiBiYKJgoqCioKKgouCjIGMgY2BjoGPgZCBkIGRgJGAkX+SfpJ+kn6SfpJ+k32TfZN9k32SfZJ8knyRfJB8kHyPfI58jHyLfYt8i3yLfYp9iX6Ifoh+iH6Ifod+h36Ifoh/h3+Hf4d/h4CGgIaAhoGGgoaDg4ODhIOEgoWChYOFg4SChIKEg4WChYKFg4WDhYOFhIWEhIOEg4WDhYOFhIWEhYSGhIeFh4WIhomGiYeIiIiIiImIiYiJh4qHi4aLhouFi4SKgoqBi4CMgIx/jX+Ofo5+jn6OfY99kHyRe5J7k3uTepR6lHmUeZR5lHiUeJR3lHeUd5R2lHeTd5N3k3iSeZJ6kXqRfJF9kX6Qf5CAj4GPgo6DjoSOhY6FjoSNhI2DjYONgo2CjoGOgY+Aj3+Pfo9+j36Pfo9+j36Pfo9+kH6Qf5CAj4CPgI6AjYCNgI2AjIGMgYyAjICMgIyAjICMgI1/jX+Nf42AjYCNgI2BjYGNgo6CjoOOg46DjoOOgY6AjX+Nf4x+jH6Mfox/i36Kf4p/in6Kfop+iX+Jf4mAiYCJgImBiYCIgIiAiICHgIeAh4CHgIaAhn+Ff4V/hX+Ef4R/hH+EfoR9hH2EfoN+gn+CgIGAgICAgH+Bf4F/gX+Bf4CAf4F+gXyCe4N6hHqEeoR6g3qCe4J8gnyBfYF9gX2BfYB9gH6AfoF/gX+Bf4KAgoCCgIKBg4GDgYOChIGEgYSChIGEgYSChIKEgoSBhIGEgISAg4CDgIOBg4GCgYKBgoGCgYKBgoCCf4F+gX6AfoB+gH6AfoB+gH6Afn99f31/fX98f3x/e4B7gHuBe4B7gHyBfIF8gXyBfIF8gH2AfYB9gH6AfoB+gH6AfoB+gH6AfoB+gH1/fn9+f35/fn9+f35/f39/f39/f35/fn9+f36Af4B/gH+AgICBgIGBgYGBgYGBgoGCgIOAhICFgIaAhoCHgYiBiIGIgYmAiYCJgImAioCLgIyAjICMgI1/jn+Ofo5+jn6Ofo9+j32PfY99j32PfY98j3yOfY19jX2MfYp9in2JfYh9iH2HfYd+hn+Ff4V+hX6FfoV+hX6FfoR/hH+Ef4R/g3+DgIOAg4GDgoODgYSBhIGFgYWBhYGFgYSBhIGFgoWChYGFgoWChYKFgoWDhYKFgoWChYKFg4WDhoOGg4aEh4SIhYeGiIeIiIiJiImIiYiJh4qGi4aLhYqEi4OLgouAi3+Lfox+jH6NfY19jX2OfY98kHuRe5J6knqTepN5k3mTeZN5k3iTd5N3lHeTd5N3kneSd5F3kXiReZF6kHuQfJB9kH6QgI+Bj4KOg46EjoSOhY2FjYWNhI2DjYONgo2BjYGNgI5/jn6Nfo1+jX6Nfox+jH6Mfox+jH+Mf4x/jICMgIuAi4CLgIuBi4GLgIuAi4CLgIuAi4CLgIuAi3+Lf4uAi4CLgIuBi4KLgoqDi4OLg4uDi4OLgYuAi3+Lf4p/in+Kf4l/iX+If4h/iH+If4h/h3+IgIiAiICIgYiBiIGHgYeBh4CGgIaAhoCGgIWAhYCEf4R/hH+Ef4R/hH6DfoN9g36CfoF/gYCAgH+Af4B+gX6CfoJ+gX+Af3+AfoF9gXyCe4J6g3mDeoJ6gXuAfIB9gH1/fYB9gH2Afn9+f35/fn9/gH+Af4GAgYCBgIGBgoGCgYKBgoGCgYKBgoGCgoKCgoKCgoKBgYGBgIGAgICAgICBgIGAgYGBgYKAgoCBf4B+f35/fX98fnx+fH59fn1+fX58fnx+fH18fXx8fHx9e317fXt9e317fXt9e357fnt+fH18fXx9fX19fX59fn1+fX59fn1+fX5+fn5+fX59fn19fX59fn1+fX59fn1+fX59fnx+fH98f31/fX99f32AfoB/gH+AgICAgICAgICBgIGAgoCDgIOAhICFgIWAhoCGgYaAhoCGgIaAhoCHgIiAiICJgIp/in6Lfot+i36LfYx9jH2MfYx9i32LfYt8i32LfYp+iX6Ifod+h36GfYZ9hX6EfoN/g3+Df4J/gn+CfoJ+gn6Cf4J/gX+Bf4F/gH+Bf4GAgYGBgoGDf4R/hICFgIWBhYGFgYWBhYGFgYWBhYGFgYWBhYGEgYWBhYGFgoWChYKFgoWChYKGg4aDhoSHhoaGh4eHh4eIh4iIiIeJhoqGioaKhYqEioKKgYqAin+Lfot9jH2MfY18jXyOfI57j3uQepB6kXmReZJ5knmSeZJ4kniSd5J3kneSd5F3kHeQd5B4kHiQeZB6kHuQfJB9j36PgI+BjoKOg46EjoWOhY6FjoWOhI6EjoOOgo2BjYCNf4x+jH6Mfot+i36Kfop+in6Kfop+in+Kf4l/iX+Jf4l/iYCJgImBiYCJgImAiX+KgIqAioCKgIqAiX+Jf4mAiYCJgYmBiIKIgoiDiIOIg4iDiYKJgYmAiX+Jf4l/iICIgIiAh4CHgIaAhn+Gf4aAhoCGgIaAhoGGgIeBh4GGgYaBhoCFgIWAhYCFgIWBhICEgISAg3+Df4N/g36DfoJ+gX6Bf4CAf4F/gX6BfoF9gX2CfoF+gX+Af3+AfoF8gXuBeoJ6gnqBeoB7f3x/fX59fn1+fX59fn5+fn9+f35/fn9/f39/f3+AgIGAgYCBgYGBgoGBgYKBgYGCgIKBgoGCgIKAgn+Bf4F+gX6AfoB+gH6AfoF/gX+CfoN+gn2BfYF8gHt/en96f3p/en96f3p/en96f3p+en56fXp8enx7e3t7e3t7e3t7e3t7e3t7e3t7fHt8en16fXt9e357fnt+e358fXx9e317fnt+e397fnt+e357fnt+e356fnp+e357fnt+e357f3t/e397f3x/fX9+gH+Af4B/gICAgICAgIF/gX+BgIJ/gn+CgIOAg4CEgISAhICEgISAhICEgIWAhn+Gf4d+h36IfYh9iH2IfYl9iX2JfYh9iH2IfYh9iH2HfoZ+hn+Ff4V/hH6DfoJ+gn6Bf4F/gYCAf39/f39/f39/gH5/f39/fn9/f39/fn9/f3+Af4F/gn+DfoR+hH+Ef4SAhIGEgYWChYGFgYWBhYGEgYWBhYGFgYWBhYGFgYWChYKFgoWChYKFg4WEhoWGhYWFhoaHhoeHh4eHiIeIhomGiYWKhYqDioKKgIp/in6Kfot9i3yLfIx7jHuNe456j3qPeo95kHmQeZF5kXmReJF4kXiRd5B3kHeQd493j3ePd494j3mPeo96j3uPfI99j3+PgI+BjoKOg46EjYWNhY2GjoWOhY6EjoONgo2BjICLf4t+in2KfYp9iX2Jfoh9iH6Ifoh+iH6Hfod+h36Hfod/h3+HgIeAh3+Hf4iAiICIgIiAiICHgIeAh3+HgIeAh4GHgYaBhoGFgoWChYOFg4WChoKGgYeAh3+Hf4eAh4CHgYaBhoGFgIWAhX+FgIWAhIGEgYWBhYCFgIWAhoGFgYWBhYGFgYSBhIGEgYSBhICEgISAg4CDf4N+gn6CfoF+gH+AgH+BfoF+gX6CfYJ9gn2BfoF+gH+AgH+AfoB8gHuBe4F6gHuAfH99fn19fn1+fX59fn1+fX59f35/fn5+fn5/fn9+gH+Bf4GAgYCBgIKAgoCCgIKAgn+Df4N/g3+Df4N/gn6BfYF9gXyAfIB8gHyAfIF9gn2DfIN8g3uCe4F6gHmAeYB5gHl/eX95f3l/eX95f3l/eX55fXl9eHx5e3l6ent6e3p7ent6e3l7eXt5fHl8eHx4fHh9eH15fXl9eX16fXp9en15fnl+eX55fnl9eX55fnh+eX55fnl+eX56fnl+eX55fnl+en56fnt/e398f36AfoB/gH+Af4CAf4B/gH+Af4B/gICAgIF/gX+Bf4F/goCCgIKAgoCCgIN/g36DfoR+hH2FfYV9hX2FfYV9hn6GfoV+hX2FfYR9hH6EfoN/g3+CgIF/gX+Bf4B/gH9/gH+AfoF9gX2AfX99f31/fX99f3x/fH99f31/fH98f3yAfYF9gn2DfYN+g36EfoR/hICEgYSBhYKFgoWBhYGFgYWBhYGFgYWBhYGFgoWChYKFg4SDhIOEhIWEhYWFhYWFhYaGhoaGhoeGh4aIhoiFiYSJhImDiYGKgIp/in6KfYp8inuLe4t7jHuNeo16jnqPeo95j3mQeY95j3iPeI94j3iPd453jneOd453jneOd454jnmOeY56jnuPfI99jn6OgI6BjoKNg42EjYWMhYyFjYWNhY2EjIOMgouBi4CKf4p+iX2JfYh9iH2IfYd9h32Hfod+hn6GfoV+hn6FfoV+hX6Ff4Z/hX+Ff4Z/hoCGgIaAhYCFgIWAhYCFgIWAhYCEgYSBhIGDgoOChIKEgoOChIGFgIV/hn+GgIaBhoGGgYWBhYGEgYSAhICEgISBg4GEgYSAhICEgIWAhYGFgYSBhIGEgYSBhIGEgYSBhICDgIOAg4CDf4N+gn6BfoB/gH9/gH+BfoJ+gn2CfYJ9gX2BfYF+gH+Af39/fn99gHyAfIB8f3x+fX1+fX59fn1/fH98fnt+e358fnx+fH58fnx/fX99gH6BfoF/gn+Cf4J/gn+CfoJ+g36DfoN+hH+DfoJ+gn2CfIJ8gXuAe4B7gHuBe4J7gnuDe4N6g3qCeYF5gXmBeYF4gHiAeIB3gHeAd394f3h/eH54fnd9d3x3e3h7eHp4e3h7eHx4fHd8d3x3fHd8d3x3fXd9d313fXd9eH54fnh9eH54fnh+eH13fXd+d353fnd+d353fXd+eH54fnh+eH54fnh+eX55fnl+en96f3t/fIB9gH2AfoB+f35/fn9+f35/fn9/f39/f39/f39/f39/f39/f3+Af4B/gX6BfYF9gX2BfYJ9gn2CfYN+g3+Cf4J+gn6CfoF+gX6Bf4F/gICAgICAf4B/gH6AfoB+gX2CfIJ7gnuBfIB7f3t/e357f3t/e397f3t/e397gHuAe4F8gn2DfYN9g32EfoR+hH+EgIWBhYKFgoWChIKFgYWBhYGFgYWBhYKFgoWChIOEhISEhISEhYSFhYWFhoWGhYaFhoWHhoeGh4aIhYiFiYSJg4mCiYGKf4p+in2KfIp8inuLeot6jHqMeo16jnmOeY95j3mOeI54jniNeI14jXiNd413jXaNdo13jXeNeI14jXmNeY16jXuNfI59jn+NgI2BjIKMg4yEi4SLhYuFi4SLhIuDioKKgoqBioGKgIl/iH6Ifoh9h32HfYZ9hn2GfYV+hX6EfoV+hH6EfoR+hH6EfoR/hH+Ef4R/hICEgISAhICEgIOAg4CDgIOAgoCCgYKBgoKCgoKCgoKCgoKBg4GEgIR/hICFgIWBhYGFgYWBhIGDgYOAgoCCgIOBg4GEgISAhICEgISAhIGEgYSBhIGEgYSBhIGEgYSBhIGDgYOAg4CCf4J+gX6Af39/f4B/gX6BfoJ+gn2CfYJ8gX2BfYF+gX6Afn9+fn59fn1/fX59fn19fn1+fH58f3t/e397fnp+en56fnp+e317fnt+e398gH2AfYF+gn6CfoJ+gn2DfYN9hH2EfYR9hH2DfYJ8gnyCe4J7gXuBeoB6gXqBeoJ6gnqDeoN5g3mCeIF4gXiBeIF3gXeBd4B3gHeAdn93f3d+eH54fXh9d3x3e3Z7dnt2e3Z7d3t3fHd8dnx2fHZ8dn11fXV9dX12fXZ9d353fnd+d352fnZ+dn52fXZ9dX51fnZ9dn12fXZ9d313fnd+d313fXd+d353fnh/eH94f3l/eX96gHuAfIB8f3x/fH97fnt+e358fnx+fH58fnx/fH98f31/fX99f35+fn5+fX99fn1/fX99f31/foB+gH9/f4B+f35/fn9+f39/f3+AfoB+gH6AfoB9gH2BfYJ8gnuDe4N7gnuBeoB6gHp/en56f3p/en96f3p/en96gHqBe4F7gnyCfIJ8g32EfoR+hH+EgYSBhYKEgoSDhIOFg4WDhYOFgoWChYOFhISEg4SDhYOFg4WEhoSGhIaFhoWGhYeFh4WHhYeFiIWIhYmFiYSJg4mBiYCJf4p9in2KfIt7i3qLeot6i3qMeYx5jXmNeY15jXmMeYx4jHiMeIx4jHiMd4x3i3aLdot3i3eLeIt4i3mLeYt6jHuMfIx9jH+LgIuBi4KKg4qEioSKhIqEioSKg4qDiYKJgomBiYGJgIiAiH+Hfod+hn6GfYV9hX2FfoR+hH6DfoR+hH+EfoN+g3+Cf4J/gn+Cf4J/goCCgIKAgoCCgIKAgoCCgIGAgICBgYGBgIKAgoGCgYKBgoGBgoCDf4N/g4CEgISBhIGEgYOCg4GDgYKBgoGCgIKAg4CDf4R/hH+EgISAhIGEgYSBhIGEgYSBhIGEgYSBg4GDgYOAgoCCf4F/gH9/gH+AfoB+gX6BfYJ9gn2CfYJ9gXyBfYF9gX2BfIB8f31+fX59fnx+fH58fnt/e396f3p/en56fnl+en56fnp+en16fXp9e357f3uAfIF8gXyCfIJ8gnyDfIR8hHyEe4R7hHuDfIN7gnuCe4J7gXuBeoF6gXmBeYJ5gnmCeYJ4gniCd4J3gneCd4J2gnaBdoF3gHeAdn92f3d/d354fXl+eH53fXZ8dXx1e3V7dXt1fHV9dX12fXV9dX10fXR9dH11fXV9dX11fnV+dX51fnV+dX51fnR+dH50fXV+dX11fXV9dn12fXZ9dn12fXZ+dn52fnZ+d353fnd/d394gHiAeX95f3l/eX95fnl+eX55fXp9en16fXp+eX96f3p/e397fnx+fH18fXx9fXx+fX19fX19fn1+fX59fn1+fX59fn1+fX98gH2BfYF8gXyBfYF8gnyCfIN7g3uDeoN6gnqBeoF5gHl/en56fnp/en96f3p/eoB6gHuBe4F7gnuCe4N7g3yDfYR+hH+EgYSBhIKEgoSEhISEhYSFhIWFhYWFhYWEhYSGg4aDhoOHg4aDhoSGhIeEh4SHhIeEh4SIhIiFiISIhImEiYOJgomBiX+Jfop9inyLfIt7i3qLeot6i3mMeYx5jHmMeYx5i3mLeYt4i3iLeIt4i3iKd4p3iXeJd4l3iXeJeIl4iXmJeYp6inuKfIl+iX+JgIiBiIKIg4iEiISJhImEiYOJg4mDiYKJgoiBiIGIgIeAh3+Gf4Z/hn6FfoV+hH6EfoN/g3+Df4N/gn+Df4J/gn+Bf4GAgYCBgIGAgYCBgIGBgYCBgYGBgYGBgYCAf4B/gX+Bf4J/gn+CgIKAgYCAgYCBgIKAgn+CgIOAgoGDgYOBgoGCgoKCgoGBgYKAgn+Df4N/hH+Ef4SAhICEgISBhIGEgYSBg4GDgYOBg4GCgYKAgYCBgICAf4B+gH6AfoF9gX2BfYJ9gn2CfYJ8gnyCfIJ8gnuBe4B7f3t/e397f3t/e397f3t/en96f3p+eX55fnl+eX55fnl+eX15fXl+en56f3qAe4F7gXuCe4J7gnuDeoR6hHqEeoR6g3qDeoN6gnqCeoJ6gXqBeoF6gXmBeYF5gXiBeIJ3gneDd4N3g3eDdoJ2gnaBdoB2gHd/dn92f3d+d353fnd+d352fnV9dXx0fHR8dHx0fXR9dH50fnR9dH5zfXN9c31zfXR9dH1zfXN+dH50f3R/dH90fnN+c35zfnN+dH10fXR9dH10fXR9dH11fnV+dX51fnV+dX51fnV+dn92f3Z/dn93f3d/d393fnd9d313fXd9eH13fXd+d353fnh+eH55fnl9eX16fXt9e317fXx9e317fnt+fH58f3x+fH57fnt/en96gHuAe4B7gXuBe4J7g3uDeoN6g3qDeoN6gnqBeoF5gHp/en56fnp/en96f3p/en96gHqBeoJ6gnqCe4J7gnyCfYN+g3+DgYOChIOEg4SEhIWEhoSGhIaEh4WHhYeEh4OIg4iDiIOIg4eDh4SHhIeEh4SIhIiEiISIhIiDiYOJg4mDiYKKgYqAin+Kfot9i3yLfIt7i3qLeYt5i3mLeYt5i3mLeYp5inmJeYp5inmKeYp4iXiJd4l3iHeIeId4h3iHeId4h3mHeod6h3uHfYd+h3+GgIaBhoKGg4eDh4OHhIeDiIOIg4eCiIKIgoiBh4GHgIeAhoCGf4Z/hX+Ff4R/hH+Df4N/g4CDgIKAgoCBf4GAgYCAgICAgIB/gICAgICAgYCAgIGAgYCBgIF/gX+BfoF+gX6BfoJ+gX6Bf4F/gYCAgICBgIGAgYCBgIGAgYGBgYKBgoGBgoGCgYKBgYKAgn+DfoN+g36Df4N/hH+EgISAg4GDgYOBgoGCgYKBgoGBgYGAgIB/gH+BfoF+gX2BfYF8gXyBfIJ9gn2CfIJ8gnuCe4J7gnqBeoB6f3p/en96f3p/en96f3p/en96f3l+eX55fnl+eX55fnl9eX54fnl+eX95f3mAeYF6gnqCeoJ5gnmDeYN5g3mDeIN4g3mDeIN5gnmCeYF5gXqBeoF5gXmBeIF4gXiBd4F3gneCd4N3g3eDd4J3gneCdoF2f3Z/dX51fnV+dn51fnV+dX51fnV+dH5zfHJ8cnxyfXJ+cn5yfnJ+cn5yfnJ+cn5yfnJ+cn5yfnJ+cn5yfnJ/c39zfnN+cn5yfnJ9c31zfXN9cn1yfXJ9c35yfnJ+c35zfnN+c35zfnN+c390f3R/dH91f3V/dX51fnV9dX11fXV9dX11fXV9dX12fnZ+dn13fXd9eH14fXh9eH15fXl9eX55fnp+en57fnp+e396f3l/eX95gHmAeoB6gXqBeoN7g3qDeoN6g3qDe4N7gnqBeoB6gHp/en55fnl+eX95f3p/eoB6gHqBeoF6gnqCfIJ8gn2CfoJ/g4CDgYOCg4ODhIOFg4WEhoSHhIeEh4SHhIiDiIOIg4iDiIOIg4iDiIOIhImEiYOJg4mDiYOJg4mCioKKgoqBi4GLgIt/i36LfYt9i3yLe4t6i3qLeYt5i3mLeYt5inmKeYl5iXmIeYh5iHmIeYh5iHmHeId4h3iGeIZ4hniFeIZ4hnmFeoV7hXyFfYV+hX+FgYWBhYKFgoWDhoOGg4aDhoOGg4aChoKGgoaBhoGGgYaAhoCFgIWAhICDgIOAg4CCgIKAgoCBgIGAgICAf4B/gIB/gH+Af4B/gH+Af4B/gX+Af4F/gX+Cf4J/gX6CfoJ+gn2CfYJ9gn6BfoF+gX+Bf4GAgICAgIB/gICAgICAgYCBgIGAgoCCgYKBgYKAgn+CfoN+g36DfoN/g3+DgIKBgoGCgYGBgYGBgYGBgIGAgX+Bf4F+gX6BfYF9gXyBfIF7gXuBfIF8gnyCfIJ7gnuCeoJ6gXqAeoB5f3l/en96f3l/eX95f3l/eX95fnl+eX55fnl+eX54fnl9eH54fnh/eH94gHiAeIF5gXmCeYJ5gniCeIN4g3iDd4N4g3iDeIN4gniCeIJ5gXmBeYF4gXiBeIF3gXeBd4F3gneCd4J3gniCeIJ3gneCdoF2gHZ/dX51f3R/dH90f3R/c39zf3N/c39zfXJ9cn1xfnF+cX5xf3F/cH9wfnF+cX5xfnF+cX5xfnF+cX5xfnJ/cn9yf3J+cX5xfnF+cX1yfXJ9cX1yfXJ9cX5xfnB+cH5xfnF+cX5xfnJ/cn9yf3J/c39zfnN+dH50fXR9dH10fXR9dH10fnR9dH10fXV+dX52fXV9dn12fXZ9d313fXd9d354fnh+eH54fnl+eX95f3h/eIB5gHmAeYB5gXmCeYJ6g3qCeoJ6gnuCe4J7gXqBeoF5gHl/eX55fnl+eX95f3p/eoB6gHqAeoF6gnuCfYJ+gn6Cf4KAgoGCgoODg4SDhYOGg4aDh4OHg4eDiIOIg4iDiIKIgoiCiIKIg4iDiIOJg4mDioOKg4qCioKKgYqBi4GLgYuBjICMgIx/jH6LfYt8i3yLe4t6jHmMeYt5i3mKeYp5iXmJeYh5h3mHeYd5h3mHeYd5h3qGeYZ5hnmFeIV4hXmEeIR5hHmEeoN7g3yDfYN+g3+DgIOBg4GDgoSChIKEgoSDhIOEg4SChIKEgoSBhIGEgYSAhIGEgIOAgoCCgIKBgYGBgYGBgYGAgYCBgIF/gH9/f4B/gH+AfoB+gX6BfoF+gX6BfoF+gX6CfoJ+gn6CfYJ9gn2CfYJ9gn2BfYF+gX6BfoF/gX+Bf4F+gX6AfoF/gX+Bf4GAgYCBgYGBgIKAgn+CfoJ9gn2CfoJ+gn+BgIGBgYGAgYCBgIF/gn+Cf4J/gX6BfoF9gX2CfIF8gXuBeoF6gnuBe4F7gnuCe4J6gnqCeoJ5gXmAeX95f3l+eX55fnl/eX95f3l/eX95fnl+eX54fnh9eH14fXh9eH54f3h/eH94gHiAd4F3gXiBeIJ4gniCeIJ3g3eDd4N3g3iDeIN4gniCeIJ4gniBeIF4gXiBd4F3gXeBd4F3gXeBd4F3gniCeIJ4gneBd4F2gHZ/dn91f3V/dH9zf3KAcn9yf3J/cn9yfnJ+cn5xf3F/cX9xgHGAcH9wf3B+cH5wfnB+cH5wfnB+cH9wf3F/cX9xf3F/cH9wfnB+cH5wfnB9cX1wfnB+cH9wf3B+cH5wfnB+cH5xfnF/cX9yf3J+cn5yfnJ+cn5yfXJ9c35zfnN+c35zfnR+dH50fnR+dH50fnR9dH11fXV9dH11fXZ+dn52fnd+d353fnd+d354f3iAd4B4gHiAeIB4gXiBeYJ5gnqBeoF6gXqBeoF6gXqBeoB5gHl/eX55fnp/en96f3p/en96gHqAeoF7gXyBfoF/gX+BgYKCgoKCg4KEgoWChYKGgoeCh4KHgoeDiIOIg4iCiIKIgoiCiIKIgoiCiYKJgomCioKKgoqBi4GLgYuBi4GMgIuAi4CLgIx/jH6MfYt8jHuLe4t6jHqLeot6i3qKeol6iHqHeod6hnqGeoZ6hnqFeoV6hXqFeoV6hXqEeYR5hHmDeIN5gnmCeoJ7gXyCfYJ9gn6Cf4KAgoCCgYKBgoKCgoKCgoKCgoKCg4KDgoOBgoGCgIKAgoCCgIKAgYGBgYCBgIKAgoCBgIJ/gn+Bf4F+gH6AfoB+gH6AfYF9gX2BfIJ9gX2BfYF9gn2CfYJ9gn2CfYJ8g3yDfIN9gn2BfYF9gX2AfYB9gX6BfoJ9gX2BfYF+gX6Bf4F/gYCAgICBgIJ/gn6CfYJ9gn2BfoF/gH+AgH+Af4F/gX6BfoF+gn2CfYJ9gn2CfIJ8gnyCe4F6gnqCeYJ5gnmCeoJ6gnqCeoJ6gnqCeYF5gXmAeH94fnh+eH54fnh+eH54fnh/eX95fnh+eH54fXh9eH14fXh9eH54fnd/d393gHeAd4F3gXeBd4F3gXeCd4J3gneDd4N4g3iDeIN4gniCeIJ4gniCeIF4gXiBd4F4gXeBd4F4gXiBeIF4gXiBeIF4gXeBd4B3gHd/d392f3Z/dYB0gHOAc4BygHKAcoBxf3J/cn9yf3J/cYBxgHGAcIBwf29/b39vfnB+cH5wfnB/cH9wf3B/cH9wf3F/cH9wf3B+b35vfnB+cH5wf29/b4Bvf29/cH9vf3B+cH9wf3B/cH9xf3F+cX5xfnF/cX9xfnF+cn5yfnN+c35zf3N+c35zfnN+c35zfnR+dH5zfXN+dH50fnR+dX51fnZ+dn52f3Z/dn93f3eAd4B3gHeAd4B4gHiBeYF5gXqBeoF6gXqBeoF6gXqAeoB6f3p/en96fnp/en97f3t/e4B7gHuAfIF8gX2Bf4GAgYGBgoGDgYOBhIGFgYaCh4KHgoiCiIKIgoiCiIKIgoiCiIGIgYiBiIGIgYiCiYGJgYmBiYGKgYqBioCLgIuAjICMgIuAi4CLf4x/jH6LfYt8i3uLe4t7i3qLeop7inuJe4h7h3uGe4V7hXuFe4V6hXqEeoR6hHqEeoR6hHqEeoN5g3mCeYJ5gXmBeoF7gHyAfYF9gX6BfoF/gYCBgYGBgYGBgYGBgYKBgoGCgYKBgYGBgYGBgICAgICAgICAgIGAgX+Cf4J/gn+Cf4J/gn6CfYF9gX2BfYF9gX2BfIF8gXyCfIJ8gnyBfIJ8gnyCfIJ8gnyCfIN8g3yDfIN8gnyBfIF8gXyAfIF8gXyBfIJ8gXyBfYF9gX6AfoB/gH+AgH+Bf4F+gX6BfoF9gH6Afn9/f39+gH6AfoB9gX2BfYF8gnyCfIJ8gnyDe4N7gnuCeoJ5gnmCeYJ5gniCeYJ5gnmDeYN5g3mCeYF4gXiAd393fnd+eH14fnh+eH54fnh+eH54fnh9eH14fXh9eH14fXh9eH13fnd/d393gHeAdoB2gHaBdoF3gXeCd4J3gneCd4J3g3iDeIN4gniCeIJ4gniCeIJ4gXiBeIF4gXiBeIF4gXiBeIF4gXiBeIF4gXiAeIB4f3d/d393f3aAdoB1gHSAdIFzgXOBcoFygHKAcn9yf3OAcoBygXGBcYFwgG+Ab39vf29+b35vfm9+b39vf29/b39wfnB/cH9wf3B+cH5wf29+cH9vf2+Ab4BvgG9/b39vf29/b39vf29/b39wf3B/cH5wf3B/cH9xf3B/cH9xf3F/cn9yf3N+cn9yf3J+cn5zf3N/c39zfnN/c390f3R/dH90fnV+dX52f3V/dn92f3Z/doB3gHeAd4B3gHiAeIB5gHmAeoB6gHqBeoF7gXuAe4B7f3t/e357fnt+e397f3t/fIB8gHyAfIF9gX6Bf4GAgYKBgoCDgISAhICFgYaBh4GHgYeBh4KHgoiCiIKIgoiBiIGJgYmBiYGJgYmBiYGJgYmBiYGJgIqAioCKgIuAi4CLgIuAi3+Lf4t+i36LfYt8i3uLe4t7i3uLe4p8iXyIfId8hnyFfIR8hHuEe4R7hHuEeoR6g3qDe4N7g3qDeoJ6gnmCeYF5gHqAeoB7gHyAfIB9gH6AfoB/gICAgYCBgIGAgYCBgIGAgYCBgIGAgYCBgIF/gH+Af4B/gH+Af4F/gX+Bf4J/g36DfoJ+g36DfYJ8gnyCfIJ8gnyCfIF7gnuCe4J7gnuCe4J7gnuCe4J7gnuCfIN8gnyDe4N7g3uCe4F7gXuBe4F7gXuCe4J7gnyBfIF9gX2AfoB+f39/f3+AfoB+gH6Afn9+f35+f31/fX99gH2AfIF8gXuBe4F7gnuCe4J7g3qDeoN6g3qDeYJ5gnmCeIJ4gniCeIN4g3iDeYN5g3mCeIF4gXiAd393fnd+d313fXd+d353fXd9eH14fXh9eH14fXh9eH14fXh9d313fnd/d393gHeAdoB2gHaBdoF3gXaBdoF2gXeBd4J3gneDeIN4g3iDeYJ5gnmCeYF5gXmBeYF5gXmBeYF6gXmBeYF5gXmBeYF5gXiAeIB4f3h+eH53f3eAdoB2gXWBdYF0gXSBdIFzgXSBdIBzgHSBc4FzgXKBcYFxgXCBb4Bvf25/bn5ufm5+bn5ufm5+bn5vfm9+cH5vf29+b39vf29/b39vgG+AboBvgG+AboBuf29/b39vfm9/b39vfm9+b39uf25/bn9vf29/b39vf29/cIBxf3F/cX9xf3J/cn9zf3OAc39zf3OAc4Bzf3N/c390f3R/dH91f3V/dX91f3Z/dn93gHeAd4B3gHh/eH95f3mAeYB6gHqAe4B7gHyAfIB8f3x+fH58fnx+e358f3x/fX99gH2AfYF+gX6BgICBgIKAgoCDgISAhICFgIWAhoCGgYeBh4GIgoiCiIKIgYmBiYCJgImAiYCJgYmBiYCJgImAiYCJgIqAioCKf4qAioCLf4t/i3+Lf4t+i32LfYt8i3yLe4t8i3yKfIp9iH2HfYZ9hX2EfYR9hHyEfIR7hHuDe4N7g3uCe4J7gnuCeoJ6gXqBeYB5f3p/en97f3t/fH99f35/f39/f4B/gH+Bf4F/gX+Bf4F/gX+Bf4F/gX6BfoF+gH6AfoB+gH6AfoF+gX6CfoJ+g36DfYN+g32DfIN8g3yDe4N7g3uCe4J7g3uDe4N7gnuCeoJ6gnqCeYJ6gnqCe4J7gnuCe4J7g3uCeoJ6gXqBeoJ6gXuBe4J7gXuBfIB8gH2AfYB+f35/f35/fn9+fn5+fn5+fX99f32AfIB8gHuBe4F6gXqCeoJ6gnqCeoN5g3mDeYN5g3mDeYN5gniDeIJ4gniCeIN5g3mDeYN5g3mCeYJ4gXiAeH93fnd9d313fXd9dn12fXd8d3x4fHh9eH14fXh9d313fXd9d313fXd+d393f3eAd4B2gHaBd4F3gHeAd4B2gXaBdoF3gneCd4J4gniCeYJ5gnmBeYF5gXmBeYF5gXqBeoF6gXqBeoF6gXmBeYF5gHmAeX94f3h+d393gHaAdoF2gXaBdoJ1gnWCdYF0gXSBc4FzgXSBc4JzgnKBcoFygXGBcIFwgHCAb39vfm9+bn5tfm1+bX5ufW5+b35vfm5+bn9uf25/boBugG6AboBugG6Abn9uf29/b39vf29/b39uf25/bn9tf21/bYBtgG2AbYBtgG6AboBvgG+AcIBwgHGAcoBygHKAcYBxgHKBcoFygXOAc4BzgHOAdIB0f3V/dX91f3Z/dn93f3d/d394f3h/eH55f3l/eX96gHqAe4B8gHyAfH99f31+fX59fn1+fX59fn1/fX99f32AfoB+gH+AgICBgIKAgoCDf4N/hH+EgIWAhYCFgIaBh4GHgYiBiIGJgImAiICIgIh/iICIgIiAiH+Jf4l/iX+Jf4l/iX+Kf4p/in+Kf4p/in+Kfop+in2LfIt8i3uLfIt8i32KfYl+iH6HfoZ+hX6EfoN9g32DfIN8g3uDe4J7gnuCe4F7gXuBe4F6gHqAen95fnp+en57fnx+fX59f35+f35/fYB9gH2BfoF+gX6BfoF+gX6BfYF9gX2BfYB9gH2AfYB9gH2AfYF9gn2CfYN9g32EfYN9g3yEfIN8hHuEe4R7g3uDe4N7g3qDe4N7g3uCeoJ6g3mDeYN5g3mDeYJ6gnqCeoJ7gnqCeoJ6gXqBeoF6gXqBe4F7gXuBfIB8gHx/fX99f31+fn5+fn1+fn5+fn1/fX98gHyAfIF7gXqCeoJ5gnmCeYN5g3mDeYN4g3iCeIN5g3iDeIN4g3iDeIJ4gniCeYN5g3mDeYN5g3mCeYJ5gXmAeH94fnh+d313fXd8dnx2fHd8d3x3fHd8d3x3fHh8d313fXd9eH13fXd+d353f3d/doB2gHaAd4B3gHeAdoB2gHaBdoF2gXaBd4F3gXiBeIF5gXmBeYF5gHmAeYB6gXqBeoF6gXqBeoF6gXqBeoB6gHqAeX95f3h/d393gHaBdoF2gXaCdYJ2gnaCdYJ0gnOCc4JzgnOCc4JzgnKCcoFygXGCcIJwgXCAcIBwf29/bn9ufm19bX1tfW59bn1ufW5+bn9uf26AboBvgG+Ab4BvgG6AboBugG9/b39vf29/bn9uf25/bn9tf22AbYBtgG2AbYBtgG2AboBugG+Ab4FvgW+BcIFwgXCBcIFwgXGBcYFygXKBc4FygHKAc390f3R/dX92f3Z/d393f3d/eH94f3h+eX55f3p/en96f3t/e398f31/fX99fn1/fX59fn59fX19fn1+fn9+f36AfoB/gH+AgICBf4F/gn+Cf4N/g3+Df4SAhICFgIWAhoCGgIeAh4CIgIiAh4CHf4d/h3+Hf4d/h3+Hf4h/iH+If4h+iH6Jfol+iX6Jfol+iX6Jfol9inyKfIt8i3yLfYt9i36Kf4l/iH+Hf4V/hH+Df4N+g32DfYN8g3yDe4J8gnyCfIF8gHuAe4B7f3p+en55fXp9en57fnx9fX1+fX99gH2AfIB8gXyBfIF8gX2BfYF9gXyBfIB8gHyAfIB8gHx/fH98gHyAfIF8gnyCfIN8g3yEfYR9hHyEfIR8hHyFfIR8hHuEe4R7hHuEe4N7g3uDe4N6g3qDeYN5g3mDeYN5gnqCeoJ7gnuCe4J7gXuBeoF7gXuBe4B7gHyAfIB9f31/fH58fn1+fX59fn1+fX59f32AfIB8gXuBe4F7gnqCeYJ5gnmCeYN5g3mDeYN4g3iDeIN4g3iDeIN4g3iDeIJ4gniCeYN5g3mDeYN5g3qCeoJ6gXqAen95fnl+eH13fXd8d3x3fHd8d3x3fHd8d3x4fHh8d313fXd9d313fnd+dn52fnZ/dn92gHaAdoB2gHaAdoB2gHaAdYB2gHaBdoF3gXeAeIB4gHmAeYB5f3p/eoB6gHuAe4B6gHqBe4F6gXqAeoB6gHqAeX95gHiAeIB3gXeBdoJ2gnaCdYJ1g3WDdYN0g3ODc4JygnKCcoJygnKCcoFygnGCcIJwgnCBcIBwgG+Ab39ufm59bn1ufW59bn1ufW5+bn5uf25/boBvgG+Ab4BvgG+Ab4BvgG+AboBugG6Abn9uf25/bX9tgG2AbYFtgW2BbYFtgW2BboFugW6BboFugW6BboFvgW+BcIFwgXCBcYFxgXKBcoFygHKAc390f3R+dn52fnd/d393f3h/eH94fnl+eX56fnt/e397f3t/e398f31+fX5+fn5+fn5+fn59fn1+fn5+fn9+f39/f4B/gICAgH+BfoF+gX6CfoJ/gn+Cf4N/g3+Df4SAhICFgIWAhX+Ff4V/hX+Ff4V/hX+Ff4V/hX6GfoZ/hn+Gfod+h36Hfod+h36Ifoh+iH6IfYl9iXyKfIt8i32Lfot+in+KgImAiICHgIWAhICDf4N+g36DfYN9g3yDfIJ8gnyBfIF8gHyAe397fnt9en16fXp8e318fX18fnx/fH98gHyAfIF8gXyBfIB8gXyBfIB8gHyAe4B7gHuAe4B7gHt/e397gHuAe4F7gnuDe4N7g3yEfYR9hHyFfIV8hXyFfYV9hXyEfIR8hHuEe4R7hHuEe4R7hHqDeoR5hHmDeYN5gnqCeoJ7gnuCe4F8gXuBe4F8gHyAfIB8gH2AfYB9f31/fX59fn1+fX59fnx/fH98f3uBe4F7gXqCeoJ6g3qCeoJ6gnqCeoN5g3mDeYN4g3iDeIN4g3iDeIJ4gniCeIJ5gnmCeYJ5gnmDeoN6gnqCeoF6gXqAen96fnp+eX14fXh9eH13fHd8d3x3fHd8eHx4fHh9eH14fXh+eH53fnd+d352fnZ+dn91f3V/dX91gHWAdYB2gHWAdYB2gHaAdoB3gHeAd4B4gHh/eH95f3l/eX96f3qAeoB6gHqAeoB6gHqAeoB6gHmAeYB5gHiAeIF4gXeBd4J3gnaDdYN1g3WEdIR0hHOEc4NygnKCcoJygnKCcYJwg3CDb4Nvgm+Cb4FvgW+Ab39vf29+b35ufW59bn1vfW9+b35vfm9/b39wf3B/cH9wf29/boBugG+AboBugW2AbYBtgG2AbYBtgG2AbYFtgW2BbYFtgm2CbYJtgW2BbYFugW6BboFvgW+BcIFwgXGBcYFygnKBcoFzgHOAc390f3V+dn52fnd/eH94f3h/eX95f3p+en57fnt/e398f3x/fH98f31+fX5+fn5+fn5+fn5+fn59fn5+fn9/f39/f3+Af4B/gH6AfoB+gH6AfoB/gX+Bf4F/gn+Cf4J/gn+Cf4N/g3+Df4N/g3+Df4N/g3+Df4N/hH+EfoV+hX6FfoV+hX6FfoZ+hn6GfoZ+hn6HfYh9iX2JfYp9in2Kfop/ioCJgYiBh4GGgYWBhICDgIN/g36DfoN9g32CfYJ9gn2BfYF9gH2AfH58fnt9e3x6fHp8e3t8fH18fnx/fH98gHuAe4B7gHuAfIB8gHyAfIB7gHuAe4B7gHyAe4B7f3t/e397gHuBeoJ6g3qDeoN7g3uEfIR+hX2FfYV+hX6FfoV9hX2EfYR9hX2EfIR8hHyEfIR8hHuEe4R6hHqEeoN6gnqCe4J7gnyBfIF9gX2AfYB9gH2AfYB9f32AfYB9f31/fH98f31/fX99f3yAfIB7gHuBeoF6gnqDeoN6g3qCeoJ6gnuCe4J6gnqDeYN5g3iDeIN4gniCeYJ5gnmCeYF5gnmCeoJ6gnqCeoJ7gnuCe4J7gXuAeoB6f3p+eX14fXh9eH14fHh8eHx4fHh8eHx4fHh9eH14fXh9eH53fnd+d352fnZ+dX91f3V/dX91f3V/dX91f3V/dX91f3Z/dn93f3d/d4B3f3d/d394fnh+eX55fnl/eX96gHqAeoB6gHqAeoB5gHmAeYB5gHiBeIF4gneCd4N2g3WEdYR0hHSEdIV0hHSEc4Ryg3KCcoJygnKCcYJwg3CDcINvg2+Cb4JvgW+BcIBwf29/b35vfm99b31vfW9+b35vfnB+cH9xf3F/cX9xf3B/b39vgG+Ab4FvgW6BboFtgG6AbYBugG6BbYFtgW2BbYJtgm2CbYJtgW6BboFugW+Bb4FvgW+BcIFxgXGCcoJygnOBc4F0gXSAdYB1f3Z/dn53fnd+eH54fnl/eX96f3p+e357fnx+fH58f3x/fH98f31/fX99fn5/fn9+f35/fn99f35/fn9+f35/fn9/f39+f31/fX99f36AfoB+gH+Af4B/gH+Af4B/gH+Bf4F+gX+Cf4J/gn+CfoJ+gn6CfoN+g36EfoR+hH6EfoR+hH6EfoR9hH2FfYV+hn6HfYd9iH2IfYl9iX2Jfol/iYCJgYiCh4KFgoSChIGDgYOAg3+CfoJ9gn2CfoF+gX6BfoB+gH1/fX58fXx8e3x7e3t6e3p8en17fnt/e397gHqAe4B7gHuAe4B8f3uAe4B7f3t/e397gHyAfIB8gHuAe397gHuBeoJ6g3qDeoN7g3uEfIR+hH6FfoZ+hn+Ff4V/hX6FfoV+hX6EfoR+hH2EfYR9hH2EfIR7g3uDe4N7g3uCfIJ8gX2BfoB+gH6Af39/f39/f4B/gH+AfoB+gH2AfYB9gH2AfoB9gXyBfIF8gXuBe4F7gnuDe4N7gnyCe4J8gnyCfIJ8gnuCe4J6g3mDeYN5gnqCeoF6gXqBeoF6gXqBeoJ7gnuCe4J7gnuCe4J7gXuBe4B7f3p+en15fXl9eX14fHh8eHx4fHh8eHx4fHh8eHx4fXh9eH14fnh+d352fnZ/dX91fnV+dX51f3V/dH90f3R/dX91f3Z/dn92f3d/d393f3d/eH94fnh+eH55fnl/eX95f3qAeoB6gHmAeX95f3mAeYB5gXiBeIJ3gneCdoN1hHWEdIV0hXSFdIV0hXSEc4Rzg3KCcoJygnKDcYNxhHCDcINwg3CCcIJwgm+Bb4FvgG+Ab39vfm9+b31vfW99cH5wfnF+cX5xf3F/cYBxf3B/b39vgG+Bb4FvgW+BboFugW6AboFugW6BboFugW2BbYFtgW6CboJugW6Bb4FvgW+BcIFvgW+BcIFxgXGBcoJygnOBdIF0gXWAdYB2gHd/d393fnh+eH54fnl/en96fnt/e398fnx+fX59f31/fIB9gH1/fX99fn5/fn9+f35/fn9+f35/fn9+f35/fn9+fn5+fn1/fX9+f35/foB+gH+Af4B/gH9/fn9+gH6AfoB/gH+Bf4F/gX6BfoF+gn6CfoN+g32EfoR+hH6EfoR+hH6EfoR9hH2EfYV9hn2GfYd9h32HfYh9iH2Ifol/iYCJgoiDhoOFg4SCg4KDgYOBg4CCf4J/gX+Bf4CAgH+AfoB+f35+fX59fXx8e3t7e3x6fHl9eX55f3p/eX95gHl/en96gHuAe4B6gHqAeoB6f3p/e397f3uAfIB8gXuBe4B7gHqBeoJ6g3qDeoR7hHyEfYR+hH6GfoV/hX+FgIV/hX+Ff4V/hX+Ef4R/hH+EfoR+hH6EfYR9hHyDfIN9g32CfYF9gX6Bf4CAgIB/gH+Bf4B/gICAgICAgICAgH+Af4B/gX+Bf4F/gn6CfoJ+gn2DfYJ9gn2DfYJ9gn6BfoJ+gn6Cf4J+gn6CfYJ8gnyDe4J7gnyCe4F7gXuBe4F7gXuBfIJ8gnyBfIF8gnyCfIJ8gnyBe4B7gHt/e356fXp9en16fXp8eXx5fHl8eXx5fHh8eHx3fHd9eH14fnh+eH93f3Z/dn51fnV+dX51fnV/dX90f3R/dH91fnV+dn52fnd+d393f3h/eH94fnh+eH55fnl+eX95f3l/eX95f3l/eX94f3iAeIB4gXiBd4J2gnWDdYN0hHSEdIR0hHOEc4RzhHOEc4RzhHKDcoNyg3GDcYRwhHCEcINxg3GDcYJxgnCCb4FvgW+Ab39vfm9+b31vfXB9cH1xfnF+cX9xf3F/cYBxgHCAcIBvgG+Bb4FvgW+Ab4FvgW+Bb4FvgW+Bb4FvgW+Bb4FvgW+Bb4FvgXCBcIFwgXCBcIFwgXCBcIFxgHKBcoFzgnOBdIF1gHaAdoB3gHh/eH94fnl/eX55fnp+en97f3x/fH99f31+fX9+f36AfYB+gH6Afn9+f39/f4B/gH+Af39/f35/fn9+f35/f39+fn5+gH6AfoB+gX6BfoB/gX+Af4B/gH+Afn9+f35/fn9/gH+Af4B/gX6BfoJ+gn6BfoJ+g36EfoR+hH6EfoV+hX6FfoV+hX2FfYZ9h3yGfIZ9h3yHfIh8iH2Ifoh/iICIgoiDh4SGg4WDhIKEgoSBg4GDgYKAgYCBgIGAgYCAf4B+f35+fn1+fX18fHt8e3x6fXl+eH54f3h/eH94gHh/eX95f3l/eYB5gHiAeYB5gHmAeoB6gHuAe4B7gXyBe4F7gXuBeoJ7gnuEe4R8hXyEfYR+hH+FfoV/hX+EgIWAhYCFgIWAhYCEgISAhICEf4R/hH+Ef4R/hH+DfoN/gn+Cf4GAgICAgICBf4J/gn+Df4N/g3+DgIOAg4CCgIKBgYGBgYGCgYKBgoGCgYKBg4GDgIOBg4GDgYKBgYCCgYKBgoGCgYKBgoCCgYKAgn+CfoJ+gn6CfoJ9gX2BfYF9gX2BfYF9gX6BfoF+gn6CfoJ9gX2BfYB8gHx/fH58fnx9fH18fXt9e3x7fHp8eXx5fHl8eHx4fHh8eH14fnd+d353fnd+dn52fnZ+dn52fnZ/dn91f3V/dX51fnV+dn52fnd+d354fnh+eH54fnh+eH55fnl+eX95f3l/eX95f3h/eIB4gHeAd4B3gHeBdoJ1gnWCdIN0g3SDdIN0hHSEc4NzhHOEc4RzhHKEcoRyhHGEcIRwhHCEcIRwg3GCcIJwgnCCcIFwgXCAcH9vfm9+b31vfW99cH1wfnF+cX5xf3F/cX9xf3GAcIBwgHCBcIFwgW+Ab4FvgW+Bb4FvgXCBcIFwgXGBcYFxgXCBcIFxgXGBcYBxgXGBcYFxgXGBcoBzgHOAc4B0gXSBdYB2gHZ/d394f3l/eX96fnt+e358fnx+fH59fn5/fn9+f35/fn9+gH6Af4F/gYCAgICAgICAgIGAgYCBf4CAgICAgIB/gH9/gH+AfoB+gn6CfoJ+gn6CfoF/gX+Bf4B/gX+Af4B+gH6AfoB+gH6AfoF+gX6CfYJ+gn6CfoJ9g32DfoV+hX6FfoV+hn6GfoZ9h32HfYd9h3yHfId8h3yHfId8h3yHfYd+iICIgYiDh4SGhIaDhYOFgoSChIKDgoOCg4KDgYKAgYCBf4B/f39+f35/fX58fnt9e316fnl+eH94gHiAeIB3gHd/d393f3eAd4B3gHeAd4B3gHiAeIB5f3l/eoB6gHuBfIF7gXuBe4J7gnyDfIR8hH2EfYN+g36Ef4R/hH+EgISBhIGFgYWBhYKFgYSBhICEgISAhICEgISAg4CDgIKBgYGBgYCCgIJ/g3+Df4R/hH+Ff4V/hn+GgIWAhYCFgIWBhYGEgoSChYKEgoSDhIOEg4SDhIOEg4SChIKDgoOCg4KDgoOChIKDgoOCgoKCgoKCgYKBgYGBgYGAgX+Bf4F/gX+Bf4F/gX+BfoF/gn+Cf4J+gX6BfoB9gH1/fX99f31+fX59fn19fX18fXt8e3x7fXp9eXx4fHh8eH14fnd+d353fnd+d313fnd+eH53fnd+d353fnZ+dn52fnd+d353fnd+eH54fnh+eX55fnl+eX15fXl+eX55f3l/eX95f3h/eIB3gHeAd4F3gXeBdoF2gnWCdYJ1g3SDdIN0g3SDdINzg3OEcoRyhHKEcoRxhHGEcIRwhHCEcYRxhHCDcIJwgnCCcIFwgHCAcIBwf3B+cH5wfXB9cH1xfXF+cX5xfnF+cX5xf3KAcYBxgHGBcYFxgXCBcIFwgXCBcIFwgXCBcYFxgXGBcoFygXKBcoBzgHOAc4BzgHKAcoFzgHOAc4B0gHWBdYB1gHWAdX92f3d/eH95f3p/e398fnx+fX5+fX59f31/fYB+gH6Af4B/gICAgICAgICBgIGAgYGBgYCBgIGBgYGBgYGBgYGAgYCBgIJ/gn+CfoJ+hH6EfoR+hH6Df4N/gn+Cf4F/gX+Af4B/gX+BfoF+gX6BfoJ+gn2DfYN9g32DfYN9g32DfYR+hX6FfoZ+hn6GfoZ+h32IfYd8h3yHfIZ8hnyGfIZ8hnyGfYZ+h3+HgYeDh4SHhIaEhoOFg4WDhIOFhISDhIKEgYOBgoCCgIGAgYB/gH6Afn99f3x/en56f3l/eYB4gHiAeIB4gHeAd392f3Z/d4B3gHeAd4B4gHiAeH94f3l/eYB6gHuBfIB8gHyBfIF8gn2DfoR+hH2DfYN+gn6Df4OAg4CDgIOBhIGEgoWChYKFgoSChIKEgYSBhIGEgoOBg4KCgoGCgYOAg3+Ef4R/hX+Ff4Z+hn6Hfod/iH+IgIiAiIGIgYiBiIKHgoeCh4KHg4eDh4OHg4iDiIOIg4iDh4KHgoaChoKGgoaDhYOFg4SChIKEgoSChIKEgYSBg4GDgYKCgYKBgoGBgIGAgYCBgIGAgYCBgIGAgX+Bf4B/gH9/f39/f35/fn9+fn5+fn1+fX19fX18fXx9e316fXp8eX15fnh+eH54fnh9eH14fnh+eH55fnl+eX54fnh+eH54fnh+eH54fnl+eX55fnl+eX55fnl9eX15fXp+en56f3p/eX95gHmAeIB4gHiAd4B3gXeBd4F3gXaCdoJ1gnWCdYJ1gnWDdIN0g3OEc4RzhHKEcoRyhHGEcYNxg3GEcYRxg3GDcYJxgnGCcIFwgHGAcYBxf3J+cX5xfnF9cn1yfnF+cX5xfnF+cn5yfnJ/c4BygHKBcYFxgXGBcYFwgXCAcYFxgXGBcYBygHKAc4BzgHOAc4B0gHSAdIB0gHOAc4F0gHSAdIB1gXWBdoF2gHeAd394f3h+eX56fnt+fH59fn5+f36AfoB9gH2BfYF+gn+Cf4KAgoCCgIKAgoCCgIKBgoGCgYKBgoKCgYKBgoGCgIOAg3+Df4R/hH+Ef4R+hn6GfoZ+hn+Ff4WAhICEgIOAg3+Cf4KAgoCCf4J+gn6CfYJ9g32DfYN9hH2EfoN9hH2EfYV9hX6FfoZ+hn6Gfod9h32IfYd9h32HfYZ9hn2GfIZ8hn2GfYZ+hX+FgYWDhoSGhIaEhoSFg4WDhYSFhIWDhIKEgoSCg4GCgYKBgYGAgX+BfYF8gXyBe4B6gHmBeYF5gXmBeIF5gHiBd4B3gHaAd4B3gHeAd394f3h/eH95f3l+eX96f3uAfIB8gHyAfYF9gn6Df4R/g3+Cf4J/gn+CgIKAgoGCgYOBg4GEgoSChYKFg4SDhIOEg4SDhIODg4ODgoOCg4GEgIR/hX+Ff4Z+hn6Hfod+iH6Ifol/iX+KgIqAioGKgYqCioKKgoqCioKKgoqCioOKg4qCi4KLgoqCioKJgomCiIKIgoiDh4OHg4aDhoKGgoaCh4GHgYaBhoGFgYSChIKDgoOBgoGCgYKBgoGCgYKCgYKBgoCCgIGAgICAgH+Af3+Af39/fn9+f31/fX99fn1+fX19fH18fXt9e316fnp+en56fXp9en16fnp+en56fnp+en56fnl+eX55fnp+en56fnp+en56fnp+en56fnp9en15fXp+en56f3p/eoB5gHmAeYB5gXiBeIF4gXiBeIF4gXiBd4J3gneCdoJ2gnaDdoN1g3WDdIN0hHOEc4RzhHODc4Nzg3KDc4Nzg3ODcoJygnKCcoFygXKAc4Bzf3N+c35zfnN+c35zfnN+cn5yfnJ+c35zfnN+c39zgHOAc4FzgXKBcoFygXKAcYBxgHKAcoBygHOAdIB0gHSAdIB0gHR/dH90gHSAdIF0gHWAdYB2gHaAdoB3gHeAeIB4f3l+en17fXx9fX1+fX99gH2BfYF9gn2CfYN+g3+DgIOAg4CDgIOAhICEgISAhICFgISBhIGEgYSBhICEgIR/hH+FfoV+hn6GfoZ+iH6Ifoh+iH+HgIeAhoGFgYSBhICEgIOAg4CCf4N/g36DfYN9hH2EfYR9hH6EfoR9hX2FfYV9hX2FfoZ+hn6GfYd9iH2IfYd9h32HfYd9hn2FfIV8hX2FfoV/hYCFgYWChYSFhIaEhYSFhIWEhYSFhISDhIOEg4SDg4KCgoKCgYKAgn+CfoJ9gn2CfIJ7gnqCeoJ6gXmCeYJ5gXiCeIF3gXeAd4B3f3h/eH94f3l+eX55fnl+eX56fnt+e357f3x/fYF+gX6Df4OBgoGCgYGBgYGBgYGBgoGCgYKBg4KDgoSChIKEg4SDhIOEhIOEg4SDhIOFgoWBhYGFgIZ/hn6Hfod+h36Ifoh+iX6Jfop/in+Kf4uAi4CLgYuBi4KMgoyCjIKMg4yCjIKMgoyCjYKMgoyCjIKLgoqCioKJgomCiYOJg4iDiIKIgoiCiIOJgoiCh4KHgoaChoKFgoWBhYGEgYSBhIKEgoOCgoKCgoKCgoGCgIKAgoCBgIGAgX+Bf4F+gX6BfYF9gH2AfX99f31+fX1+fX58fnx+e357fXt9fH58fnx+fH58fnx+e357fnt+e357fnt+e357fnt+e357fnt+e357fnp+en56fnp+en56f3p/eoB6gHqAeYF5gXmBeYF5gXmBeYF5gXmBeYF4gXeCd4J3gneCdoJ2gnaDdYN1g3WDdYN1g3WDdIJ0gnSCdIJ0gnSCdIJ0gnSCc4JzgXOAdH90f3R/dH50fnR+dX51fnR+dH50fnR+dH50fnR+dH90f3WAdYB0gXSBdIF0gXSAc4Bzf3N/dH90gHSAdIB1gHWAdYB1f3V/dX91gHWBdoF2gXaAd4B3gHiAeIB4gHl/eX95fnp9enx7fHx7fXt+e398gHyBfIJ8gnyCfYJ+g36Ef4SAhYCFgIWAhX+Ff4Z/hn+GgIaBhoGGgYeAhoCGf4Z/hn+Hfod+h36Hfoh+in6Kfol+iX+If4iAh4GHgYaBhoGGgIWAhYCEf4V/hX6FfoV9hH2EfYV9hX2FfYV9hX2FfYV9hX6GfYZ9hn2GfYd9h32HfYd9hn2GfYZ9hn2FfYV9hH2EfoR/hICEgoSDhIOEhIWEhYWFhYWEhYSEg4SDhIODhIODg4OCg4GDgIOAhH+Ef4N+g36DfYN8g3yDe4N7gnqDeoN6g3qDeYJ4gniBeH94f3l/eX95fnl+eX55fnp9en17fXt9fH18fXx+fIB9gX+BgIGBgYKBgoGCgYOAgoCCgIKBgoKCgoKDgoOCg4OEg4SDg4SDhYOFgoaChoKGgoaBhoCHf4d/iH6Ifoh+iH6Jf4l/in6Kfop+i36Lfox/jH+MgIyAjIGNgo2CjYKOgo6CjoKOgo6CjoKOgo2DjYONg4yCi4KLgoqCioKKg4qDioOJg4mDioOKgomCiYKJgoiCiIKHgoeCh4GHgYaChoKGgoWChYKEgoSBhIGEgYSBhIGEgISAhH+Df4N+g36DfoN+gn6CfYJ9gX2AfoB+f35/fn5+fn5+fn5+fn5+fn5+fn5+fn5+fX59fn1+fH58fnx+fH59fnx+fH58fnt+e357fnt+e357fnt+e357f3qAeoB6gHqBeoF6gXqBeoF6gXqBeoF6gXqBeoJ5gnmCeIJ3gneCd4J2gnaDdoN3gneDdoN3g3aCdoJ2gnWCdYJ0gnSCdYJ1gnWCdIF1gXWBdYB1f3Z/dX51fnZ+dn53fnZ+dn52fnZ+dn52fnZ+dn52f3Z/doB2gXWBdYF1gXWBdYB1gHV/dn92f3Z/dn92f3Z/dn92f3Z/dn92f3aAdoB2gHeAd4B4gHiAeYB5f3p/en56fXt8e3t8e317fXt+e397gHuBe4J8gnyCfIN9hH6EfoV/hYCGgIaAhn+Hf4d/h3+IgIiAiYGJgYmAiX+Jf4l/iX+Jfol+iX2JfYl9i36Kfop+iX6Jf4iAiIGIgYiBiIGIgYeAh4CHgId/h36HfoZ9hn2FfYZ8hnyGfYV9hXyFfIV8hX2GfYZ9hn2GfYZ8hnyGfIZ8hnyFfYV9hX2FfYV9hH2DfoR/hIGEgoSDhYOFg4WEhYWFhIWEhYSEg4OEg4SDhIODgoOCg4GDgISAhH+Ef4R/g3+DfoR9hH2EfIN8hHyDe4N7hHuEe4N6gnqBeoB6f3p+en56fnp+en57fnt9e317fHt9fHx8fXx+fX9+gH+AgICCgIKAgoCDgIOAg4CDgIOBg4GDgoOCg4ODg4SDhIOFgoWChYKGgoaBh4GHgYeBiICIf4l/iX6Jfol+in+Kf4p+in6Lfot+jH6Mfo1+jX6Nf41/joCOgI+Bj4GPgZCBkIGQgpCCj4KPgo+Dj4OPg46DjoONgo2CjIKMgoyDi4SLhIuEi4OLg4uCi4KLgoqDioKJgomCiYKJgomCiIKIgoiCiIKHgoeCh4GHgYeBh4GHgYeAh3+Gf4Z/hX6FfoV+hH6EfoR+g36Df4J/gn+Bf4F+gX6BfoF+gH6AfoB/gH+Af4B+f35/fn5+fn5+fn5+fn5+fn5+fX59fn1+fX58fnx+fH57fnt+e397f3t/e4B7gHuBe4F7gXuBe4F7gnuCe4J6gnqCeoJ6gnqCeYJ5gniCeIJ4gniCeIN4g3iCeIJ4gniCeIJ3gneCd4J3gnaCdoF2gnaCd4F3gXeBd4F3gHd/d393fnh+eH54f3h/d393f3d/d353fnd+d353f3eAd4B3gXeBd4J3gXaBd4B3gHd/d394f3h/eH94f3iAeIB4gHh/eH94f3eAd4B3gHeAeIB5gHmAeoB7f3t/e358fXx8fHt9e317fnp/en96gHqBe4J7gnyDfIR8hH2FfoV+hn+GgId/iH+If4h/iX+Kf4p/i4CLf4t/i3+Lf4t+i36Lfot+i36Lfot+i36Lfop+in+Jf4mAioGKgYqAioCKgYqBioGKgIl/iX+Jfoh9h32HfIZ8h3yHfIZ8hnyFfIV8hXyGfIZ9hnyGfIZ8hnyFfIV8hXyFfIV9hX2FfYV9hX2EfoR/hIGEgoSDhYOFg4WEhoSGhIaEhYSFhISEg4SDhIKEgoOBg4CEgISAhH+Ff4SAhH+EfoV+hX6FfYV9hX2EfIR8hHyEfIR8g3yBfIB8f3x+fH58fnx+fH58fXx9fH18fHx8fHx8fH19fX5+f4B/gX+BgIKAg4CDgYOBg4CDgISBhIGEgoSChIKFgoWChYKGgoaBhoGGgYeBh4CIgIiAiYCKf4p/in6Kfop+i3+Lf4t+i36MfYx9jX2Nfo59jn6Pfo9/j3+PgJCAkYGRgZGBkYGRgZGCkYKRgpGDkIOQhJCEkISQg5CDj4KOgo6DjoSNhY2FjISMg4yDjIOMg4yDjIOMg4yDjIKLgouCi4KLg4uDioKKgoqCioKKgoqCioGJgYmAioCJf4l/iH+If4h/h36Hfod+hn+Gf4V/hX+Ef4R/hH+Df4N/g3+Df4J/gn+Cf4J/gX6BfoB+gH9/fn9+f35/f39/f39/f35+fn5+f31+fX99f31/fH98f3x/fIB8gHyBfIF8gXyBfIF8gnyCfIJ8gnyDfIN8g3uDe4N6g3qDeoN6g3qDeoN6g3mDeoN6gnqCeoJ6gnqBeoF6gXqBeoF6gXmCeYJ4gniCeIF4gHmAeX95fnp+en95f3l/eoB5f3l/eX95fnl+eX95f3mAeYB5gXmCeYJ4gXiBeIB4f3h/eX95f3p/en96f3qAeoB6f3p/eoB6gHqAeYB5gHmAeYB6gHuAe398f3x+fX59fX18fXt+e356f3p/eX95gHmBeoJ6gnuDe4R7hXyGfYd+h3+Hf4h/iH+Jf4p/i3+Mf4x/jX+Nf42AjICMf4x/jH6Mfot+i36Lfot+i36Lfot/in+Kf4uAjICMgIyAjICMgI2AjYCNgIx/i3+Lfot9in2JfIh8h3yHfId8hnyFfIV8hXyFfIZ8hnyGfIV8hXyFfIV8hHyEfIR8hX2FfYV9hX2FfYV/hoGGgoWDhYOFg4aDhoSGhIaEhoWFhYWFhISEhIOFgoSChYGFgISAhICFgIWBhICFf4Z/hn+Gf4Z+hn6FfoV+hX6EfoR+g36CfoB+f35+fn5+fn5+fn5+fn59fn1+fX58fnx9fH59fn1/foB+gX+Bf4KAg4GDgYOBg4GEgYWAhYGFgYWBhYGGgoaChoKHgYeAh4CHgIiAiICJf4p/in+Kf4t+i36Lfot+jH6Mf41+jX6NfY59jn2PfY99kH6QfpB/kH+Rf5GAkoCSgJOBk4GTgZOCk4KTg5ODk4SShJKEkoSShJKEkoORg5CEkIWPhY+FjoWOhI6EjoOOg46DjoOOg46DjoKOgo6DjoOOg46DjYONgoyCjIKMgoyCjIGMgYyBjICMgIuAi3+Lf4t/in+Kf4p/iX+Jf4iAiICHgIeAh4CHgIZ/hn+GgIWAhYCFgIR/hH+Df4N/gn+Bf4F/gX+Bf4B/gH+Af4B/f39/f39+fn9+f35/fn9+f36AfoB+gH6BfoF+gX+Bf4J/gn+Cf4N+g36DfoN+g36DfYN9g3yDfIN8g3yDfIN8g3yDfIN9gn2CfYF9gX2BfYF9gX2BfYJ8gnyCe4N7gnqCeoF6gHt/e397fnt+fH57f3t/e4B7gHuAen96f3t/e397f3uAeoB7gHuBe4J7gXqBeoB6gHp/en97f3t/fIB8gHyAfYB9f31/fX99f3yAfIB8gHuAe4B8f3x/fX99f35+fn5/fX98f3t/e396gHqAeYB5gHmBeYF6gnqCe4N7hXuGfId9iH6Ifoh+iX6Jfop+jH6Nfo5+jn+OgI6AjoCOgI6Ajn+Nf4x/jH6Mfot+jX6Mfox+jH+Mf41/jn+Of4+Aj4CPgI+Aj4CPgI6Ajn+Nfo19jH2LfYp8inyJfIh8h3yGfIZ8hnyGfIZ8hnyGfIZ8hXyFe4V8hXyEfIR8hHyEfIV8hXyGfYZ/hoGGgoaChoOGg4aDhoSGhYeFhoWGhIaEhYSFhYSFhIWDhoKFgoWChIKEgoSChIKFgYaBh4GHgIaAhoCFgIWAhoCFgISAg4CCgICAf4B9f32AfoB+gH6AfoB9gH2AfYB8f31/fX99f32AfYF+gX6Cf4N/g4CEgISAhYCFgIaAhoCGgYaBhoGHgYeBh4GHgIiAiH+If4h/iX+Kf4p/i3+Lfot+jH6Mfox+jX6Nfo5+j32PfY99j32QfZB+kH6QfpB/kX+Rf5J/kn+TgJOBlIGUgpSClIKUg5SDlISUhJSFlIWUhZSFlISThJKEkoWRhZGGkYWRhZGEkISQhJCDkIOQg5CDkIKQgpCDkIOQg5CDkIOPg4+Dj4OPgo+Cj4KOgY6BjoGOgI6AjoCNf41/jX+NgIyAjICLgIuAi4CLgIqAioCKgIqAiYCJgImAiICIgIeAhoCGgIWAhICDgIOAg4CDf4J/gn+Cf4F/gX+Bf4F+gH+Af39/f39/f3+AgICAgIGAgYGBgYGBgYKCgoKCgoOCg4KEgYSBhIGEgISAhH+Ef4N/g36DfoJ+gn6Cf4J/goCBgIGAgX+BgIGAgYCCf4J/g36DfoN+g32CfYF9gH5/fn9+fn5+fn5+f31/fX99gH2AfX98f3x/fH99f32AfYB9gH2BfYF9gX2BfIF8gHx/fH98f31/fX9+gH+Af4B/f39/f39/f3+Af4B+gH5/fn9+fn5+f35/fn99gH2AfYB8gXuBe4F6gXmBeYF5gXmCeYJ5gnqCeoN6g3qFeoZ7h3yIfYl9iX2KfYt9jH2Nfo5+j36Pf5CAkICQgZCBkICPgI6Ajn+Nf41+j36Ofo5+j36PfpB+kH+Rf5GAkYCSgZKBkYCRgJF/kH+Qfo99j32OfY19jH2LfYp8iXyIfIh8h3yHfIh8iHyHfId8hnyGfIV8hX2FfIV8hXyFfIV8hnyGfYZ+h4CHgoeCh4KHg4eDiISIhIeFh4WHhYeEhoSGhYWGhYaFhoWGhIWEhISEhISEhISFg4eDiIOHg4aChoKGgoaChoKFgoSCg4OCg4CDf4J9gn2CfYJ+gn6CfoJ9gn2CfIJ8gnyCfYJ9gn2CfYJ+g36DfoR/hYCGgIaAhoCHgIeAh4CHgYeBh4GIgYiAiICIf4h/iX6Jfol+in6Lfot+i36Mfox+jX2NfY59jn6Ofo99kH2QfZB9kH6Pfo9/j36Pf49/kH+QfpF+kX+Sf5OAk4GUgZWBlYKWg5aEloSWhJaFloWWhZaFloWVhZWFlIWThZOFk4WThZOEk4SThJKDkoOSg5KDkoOSgpKDkoOSg5KDkoOSg5KDkoOSgpGCkYKRgpGCkYGRgZCBkICQgJCAj4CPgI+Aj4CPgI6BjoGOgY6BjoGNgY2BjYGMgYyBi4GLgYqBiYGIgYeBh4GGgYWBhYCFgIV/hH+Ef4R/g3+Df4N/g3+Df4J/gn+Cf4J/goCCgIOAg4CDgISBhIGEgoSChIOFhIWEhYWFhYSFhIWEhYOEg4SCg4KDgoKCgoKCgoGCgYKBgoGCgYKBg4KDgoOCgoOCg4KDgYOBg4CCgIF/gYCAgH+AfoF/gX+Bf4B/gH+Af4CAgIB/gH+Af4B/gH+Af4B/gH+Bf4GAgX+Bf4F/gX+Af39/f39/gH+Af4GAgoCCf4J/goCCgIKAgoCCgIJ/gX+BfoB9gX6BfYF9gn2CfIJ8gnuCeoJ6gnqDeYN5g3mDeYN5g3qCeoN6g3mDeYR6hXuGfIh8iXyKfIt8jHyNfY59j32Pfo9/kH+RgJGAkoCRgJGAkH+Pf49+kH6QfpB+kX6RfpJ+k3+Tf5SAlICUgJSAlICTgJKAkoCRf5F+kH6PfY9+jn2NfYx9i3yLfYp8iXyJfIl8iXyIfIh8h3yHfId9hn2GfYZ8hnyGfIZ8hnyGfYZ+h4CHgYiCiIKIgoiDiIOIg4iEiIWIhYiFh4WHhYeGh4aGhoeGh4WHhYeEh4SHhIaFhoeFh4WHhYaEhoSGhIaEhYWFhYSFhIWChYCFf4V+hH2EfYR+hH6FfoV+hX2FfYV9hH2FfYR9hH2EfYR9hH2EfoV+hn6Hf4h/iH+If4h/iICIgIiAiYGIgIiAiYCJf4l/in6Kfot+i36Mfox9jH2NfY59jn2OfY99j32PfY99kH2Pfo9+j36Of45/jn+Of45+j36PfpB+kH6Rf5J/k3+UgJWAloGXgpeDmISYhZiFmIaYhpiGmIaXhpeGloaWhpWGlYaVhZWFlYSVhJWElYOUg5SDlIOUg5SDlIOUg5SDlYOVg5WDlIKUgpSClIKUgpSCk4KTgZOBkoGSgJKAkoCSgJKAkoCSgJGBkYGRgZGBkYGQgZCCkIKPgo+CjoKOgo2CjIKMgouCioKJgoiCiIGHgYeAh4CGgIZ/hn+Ff4V/hX+Ff4V/hX+Ff4V/hX+Ff4V/hYCFgIaAhoGGgoeCh4OHhIeFiIWIhoiGiIaHhoeFhoSGhIWDhYOFgoWChYKFgYWBhoGGgoWChYKGgoaDhoOFg4WDhIOEg4OCgoKCgYOAg4CDf4N/g4CDgIOAg4CDf4OAg4CDgIKAgoCCgIKAgoCCgYKBgoGDgoOCg4GDgYOAgoCDf4N/g3+Ef4R/hX+Ff4WAhYCGgIaAhYCFgIWAhX+EfoR+hH2EfoR9hX2FfIR7hHuEeoR6hHqEeYR5hHqEeYR6hHqDeoN6g3mDeYN5hHqGe4d7iHuJe4t7jHuNfI18jn2OfY5+j36Qf5F/koCSgJKAkX+Qf5B/kn6SfpJ9k32TfZR+lX6VfpV/lYCVgJWAlYCUgJSAk4CTf5J/kn+RfpB+kH6Pfo59jX2MfYx9i32KfIp8iXyJfYl9iH2IfYh9iH2IfYh9h3yHfId8h3yHfYd+h4CIgYiCiIKJgomDiIKIg4iDiYSJhImEiIWHhYeGiIaIhoiFiIWJhYmFiYWJhYiGiIiIh4iHiIaHhoeGh4WHhYeEh4SIg4iCiIGIf4h+h36Hfod+h36Hfoh+iH6HfYd9h32HfYd9h32HfYZ9hn2GfYZ9h36Hfoh+iX6Jf4l/in+KgIqAioCKgIqAioCKf4p/in6Lfot9jH2MfY19jX2OfI98j3yPfI98j32PfY99j32Ofo5+jX6Nfo5+jn6Ofo5+jn6OfY99kH2QfZF+k36UfpR/lYCXgZeDmISZhJmFmYaahpqHmoeZiJmHmIeYh5iHmIaXhpeFmIWYhJeEl4SXg5eDl4OXg5eDl4OXg5eDl4OXg5eCl4KXgpeCl4GXgZeBloGWgpaBlYGVgZWBlYGVgZWBlYGUgZSBlIGUgpSClIKTgpOCk4KSgpKCkYORg5CDj4KPgo6CjYKNgoyCi4KLgYqBiYGJgImAiICIgId/iH+If4h/h3+Hf4d/iH6Ifoh+iH+If4iAiIGJgomCiYOKhIqFioaLhouHi4eLh4qGiYWJhYiEiIOIg4iCiYKJgomBiYGJgomCiYKJg4mDiYOIg4iDh4OGg4aDhoKGgYaBhoGGgIaAhoCGgIaAhoCGgIaAhoCGgIaAhoCGgYaBhoGGgYaBhoGGgoeCh4GHgYeAh4CHf4d/iH6If4h/iX+Jf4mAiYCJgImAiYCJgImAiX+If4h+iH6Ifoh9iH2HfId8h3uHe4Z6hnqGeYZ6hXqFeoV6hXuEe4R7hHqEeYR5hHmFeoZ6h3qJeop6jHuNe418jnyOfY59jn6Pfo9/kH+Rf5F/kX+RfpF+k32TfZR9lX2VfZV9ln6WfpZ/loCWgZaAlYCUgZSAlICUgJR/k3+TgJJ/kX+Rf5B+jn6NfY19i32KfYp9iX2JfYl9iX2IfYh9iH2JfYl9iX2IfYh9iHyIfYh+iICJgYmCiYKJg4mDiYOJg4mDiYSJhImFiYWIhYiGiIWIhYmFiYWKhIqFi4WLhYqHioiLh4uGi4aLhouGi4WKhIuEi4SLg4uCi4GLgIt/in+Kfop+in6Kfop+in6Kfop9in2KfYp9in2JfYl+iX6IfYl9iX2JfYl+in6Kfop+i3+LgIuAi4GLgYuBi4CLgIt/i36MfYx9jHyNfI58jnyOfI58jnyOfI59j32OfY59jX6Nfo1+jX6NfY5+jn6Ofo5+jn2OfI58j3yQfJF8kn2TfZR+lH+VgJaBl4KYhJmFmYaZhpqHmoeaiJmImYiah5qHmYaZhpmFmoWahJqEmoSahJqEmoOag5qDmoOag5qDmoKag5qCm4KbgpqCmoKagZqBmYGZgZmBmYGYgZiBmIGYgZiCmIKXgpeCl4KXgpaDloOWg5aDlYOVg5WDlIOUg5ODk4OSg5GDkYKQgpCCj4KOgo6CjYGMgYuAi4CKgIqAioCKf4p/in+Kfop+in6Lfot+i36Lf4t/jICMgYyCjIOMhI2EjYWNho6HjoeNh42HjYaMhYyFjISLg4uDi4OMgoyCjIKMgoyCjIKMg4yDjIOLg4uDioOKg4mDiYOJgomBiYGJgYmAiYCJgImAioCKgIqAin+KgImAiYCJgYmAiYCKgIqBioGLgYuBjIGMgIyAjYCNf4x/jH6Mfox/jX+Nf41/jX+Nf42AjYCNgI2AjICMf4x/i36Lfop+in2KfIp8inuJe4l7iXqIeod6h3qGeoZ7hXuFe4R7hXqFeYR4hHiFeYZ5hnmIeIl4i3mMe417jXyNfY59jn6Pfo9+kH6Qf5F+kX6SfZJ9lHyUfJV8lXyWfJZ9ln2WfpV/lYCVgZWBlYGUgZSBlIGVgJSAlICTgJKAkoCRf5B/j3+Ofo19jH2LfYp9in2KfYp9in2JfYl9iX2Jfol+in2JfYl9iX2JfYl+iX+KgYqCioOLg4uDi4OKg4qDioOKhIqFioWKhomGioaKhYqFioSLhIuEjIWMhYyGjYeNh42GjYaOho6GjoWOhI6EjoSPg4+Cj4KOgI5/jn+Nf41+jX6Nfo1+jX6Nfo1+jX6NfY19jH6Mfox+jH6Lfot9i32LfYt+i36Lfot+jH+MgIyBjIGMgYyBjICMgIx/jH6MfY18jXyNe457jnuOe418jXyNfY59jn2NfY1+jH6Mfox+jX2NfY19jX6Nfo59jn2OfI97kHqQe5F7knuSfJJ8k36Uf5SAloGXgpeEmIWZhpmGmoeaiJqImYiah5qHmoaahpuFm4SbhJyEnISdhJ2EnYOdg52DnYOdg52DnYOeg56DnoOegp6CnoKdgp2CnYGdgZyBnIGcgZyBm4KbgpuDm4Oag5qDmoOag5mDmYOZg5mEmISYhJiEl4SXhJeEloSWg5WDlIOUg5ODk4KSgpGCkIGPgY6BjoCNgI2AjICMf41/jX+Nf41+jX6Nfo1+jn6Ofo5/jn+PgI+Bj4KPg4+EkIWQhpCGkIeQh4+HkIeQho+Fj4SPhI6DjoOOg46CjoKOgo+Cj4KPgo+Dj4OPg4+DjoONg42DjYKNgo2CjYGNgY2AjYGOgY6AjoCOgI6Ajn+OgI2AjYCNgI2AjYCOgI6AjoCPgI+AkICQf5F/kX+Rf5F/kX6RfpF+kX6RfpF+kX6RfpJ+kn+RgJGAkYCQgI+Aj3+Ofo5+jX6NfY18jHyMfIt7i3uKeol6iHuIe4d8hnyGfIV7hXqFeYV4hXiFeIZ4h3iId4l2ineLeYt7jHuNfI19jn2PfpB+kH6RfpJ9kn2TfZN8lXuVe5V7lXuWfJZ9ln2VfpV/lYCUgZSBlIKUgpSClYKVgZSBk4GSgZGAkYCQgI+Aj3+Of41+jX6MfYt9in2KfIt8inyKfIt9i32Lfot+i36Kfop+in6Kfop+in+LgYuCjIKNg42DjYOMg4yDjIOLg4uEi4WLhYuFjIWMhYyEjISMg4yEjYSNhY6FjoaPho+FkIWQhZGFkYSRhJGDkYORg5GCkYKRgZGAkX+Qf5B+kH6QfpB+kH6QfpB+kH6Qfo9+j36Pfo9+jn6Ofo5+jn6Nfo1+jX6Mfox+jH+MgIyBjIGMgYyBjICMgIx/jX6NfIx8jXuNe417jXuNe418jXyNfI19jX2Mfox+jH6Mfox9jH2NfI19jX2NfY59j3yPe496kHqQepF6kXuRe5F8kX2SfpJ+k4CUgZWDl4SYhZiGmYeZiJqImoiaiJqHm4abhZuEnISchJ2EnoSehJ+Dn4Ogg6CDoIOgg6GDoYOhg6GDoYOhg6KDooKhgqGCoIKggp+Cn4Kfgp+DnoOeg56DnoOdhJ2EnYSdhJ2EnISchJyEm4SbhJuEm4SahJqEmoSZhJmEmISXg5eDloOVg5SClIGTgZKBkoCRgJCAkH+Qf5B/kH+QfpB+kH6QfpB+kH6QfpF+kX+Rf5J/koCSgpKDkoSThZOGk4eTh5KHkoeShpKFkoWShJGEkYORg5GDkYKRgpGCkYKRgpGDkYOSg5KDkYORg5GDkIKRgpGBkYGRgJGAkYCSgZKBk4CSgJKAkoCSf5J/kYCSgJKAkoCSgJKAk4CTgJSAlH+Vf5V+lX6Vf5V/lX6VfpV+lH6VfpV+lX6VfpV+lX6Vf5WAlICUgJOAkoCRf5B/kH6Qfo99jn2OfY58jXuMe4t7i3uKfIl9iH2IfId7h3uHeoZ4hniHeId3iHeJdol2inaKeIt5jHqMfI18jnyPfZB9kX2SfZN8k3yUfJR7lXuVe5V7lXyVfJZ9ln2VfpWAlIGUgZSClIKUgpWCloKWgpWDlYKTgpKBkYGQgJCAj3+Ofo5+jX6Nfox9jH2MfIx8jHyMfIx8jHyMfYx+jH+Mf4x/i36Lfot/i3+LgIyBjYKOg46DjoSOhI6EjYONg42EjISNhY2FjoWOhY6EjoSPhI+Ej4OPg4+EkIWQhZGFkoWThJOEk4STg5ODk4OTgpOClIGUgZSAk4CTf5N/k36TfpN9k32TfpN+k36SfpJ+kn6RfpF/kX+Rf5F/kH6Pfo9+j36Ofo1/jYCMgYyBjIKMgYyBi4GLgIx/jH2MfIx8jHuMe4x6jHqMeox7jHuMfI18jH2Mfox+jH6MfY19jXyNfI19jn2OfY98j3uQepB6kHqRepB6kHuQe5B8kHyQfZB+kX+RgJOBlIOWhJeFmIaYh5mImoiaiJuHm4abhJyEnIOdg52DnoOfg6CDoYOhg6KDooOjg6SDpIOkg6SDpIOkg6SDpIOkg6SDo4Ojg6KDooOihKGEoYShhKGEoYShhKGEoYWghaCFoISghJ+En4SfhJ6FnoWdhZ2EnYSdhJyEnISbhJqEmYSZg5iDl4KXgpaBloCVgJV/lH+Uf5N+k36TfpN9k32SfZJ9k32TfpN+lH6Uf5V/lYCVgZWClYOVhJaFloaWhpaHloeWh5WGlYWVhZSElIOUg5ODk4OTgpOCk4KTgpODk4OUg5SDlIOVg5WDlIKUgZWBlYCVgJWAlYCVgJaBl4GXgZaBloCWgJaAloCWgJaAl4CXgJeAl3+Xf5h/mH+Zf5l+mn6afpp+mX+Zf5l+mH6Yfph+mH6Yfph+l36Xf5iAmIGXgZaAlYCUgJR/k3+Tf5J+kX6RfpB9j3yOfI58jXyMfYx9i32KfYp8iXuJeol5iXiJd4l3inaKdop1inaLd4x4jHmNeo57j3yQfJF8kXySfJN8lHyVe5V7lnyWfJZ8ln2WfZV+lX6Vf5WAlIGUgpSClYGVgZaBloKXg5eEl4SWg5SCk4KSgZKBkYCQf49+jn6Ofo59jX2NfY18jXuNfI18jXyNfY1+jX6Of45/jX+Nf41/jH+MgIyAjYGOgo+Dj4SQhJCEj4SPhI+Ej4SPhI+Ej4SQhJGEkYSRhJGEkYORg5GDkYOSg5OEk4SUhJSDlIOUg5WDlYOVgpWCloKXgZaBloGWgJZ/ln+WfpV+lX2VfpV+lX+Vf5V/lH+Uf5R/lH+Uf5N/kn+Sf5F/kH+Pf46AjYCNgYyCjIKMgoyCi4GLgIt/i32LfYt8i3uLe4p6inqLeot7i3uLe4t8i32Lfot+jH6MfY18jXuNfI18jnyPfJB8kHuQepB6kXqRepB6kHuQe5B8j32PfY99j36Pf5CAkIGRg5OElYWXhpiHmYeah5uGnIWchJyDnIOdg56CnoKfgqCBoYKjgqSCpYKlgqaDpoOmg6aEpoSmg6aDpoOmhKaEpYSlhKWEpIWkhaSFpIWkhKSEpIWkhaSFo4WjhaOFo4WjhaOEooSihKGFoYWghaCEn4SfhJ+En4SehJ2EnIOcg5yDm4OagpqBmoCZgJl/mH+Yf5d+ln6WfZZ9ln2VfZZ9lX2WfpZ+ln6Xfpd/mICYgZiCmIKYg5iEmIWYhpmGmYeZh5mHmIaYhZiEmISXg5eDl4KXgpaCloKWgpaCloOWg5eCl4KXgpiCl4KXgZeBmICYf5h/mH+YgJmBmoGagpqCmoGagZqAmoCagJuAm4CbgJuAm3+cf5x/nX+df51+nn6efp5/nn+df51/nH6cfpx+nH6cf5x/m3+bgJuAm4GbgZqBmYGYgJiAl3+Wf5V/lH+UfpN+kn2RfJB8kH2Pfo5+jn6NfY18jHqMeox5jHiMd4x3jHaMdYx1jHaMdo13jXiOeY96kHuRe5J8knyTfJR8lXuWe5Z7l3yWfZZ9ln2WfpZ+ln+Wf5WAlYGVgZWBloGWgJaAloGWgpeEmIWXhZaElYOVgpSBk4CSf5J/kX6RfpB9j32PfY58jnyNfI18jXyNfI59jn6Of45/joCOgI6AjoCNgY2AjYGNgY6Cj4OQhJGEkYSRhZGFkoSShJKEkoOSg5ODk4OTg5ODk4OTgpOCk4KTg5ODlIOVg5WDloOWg5eDl4OXgpeDmIKZgpmBmYGZgJl/mX+Yf5h+mH6Yfpd/l3+Xf5d/l3+Xf5Z/loCWgJWAlYCUgJOAk4CRgY+BjoGNgo2CjIKMgoyCjIGLgIt/i32KfIt8i3uKe4p7iXuJe4l7iXuJfIl8iX2Jfop+in2LfIt7jHuMe417jnuPe5B7kHuPepB6kHmQeZF6kXuRe5B8kH2PfY5+jX6Nf41/jYCOgY+CkIKSg5SEloWYhZmFmoSbg5uCnIKcgpyBnYCegJ+AoYCigKOApYGmgqeCqIOog6iEp4SnhKeEp4WnhaeFpoWmhaaFpoWmhaaFpoWmhKeEp4WnhaeFp4amhqaGpoWmhaWFpYWlhaSFpIWjhaOFooSihKGEoYSghKCEn4SehJ6DnYOdgp2CnYGcgJuAm3+af5p+mX6ZfZl9mX2ZfZl9mX2ZfZl9mX2Zfpl+moCagJqBmoKbg5uDm4SbhZyFnIadh52HnIechpyFnISbhJuDmoOag5mDmYOZg5mDmYOZg5qCmoKagpqCmoKbgZuBm4CbgJx/m3+af5uAnIGdgZ6BnoGegp6BnoGfgZ+An4CfgJ+AoH+gf6F/oX+hf6J+on6jfqKAooChgKF/oH+gf59+n3+ff59/n4CfgJ6BnoGegp6CnYKcgZyAm4CagJl/mH+Xf5Z/lX6UfZN9kn6Sf5F+kX6RfZB8kHuQeo95j3iPeI93j3aOdo51jnWOdo52j3ePeJB5kXmSepN6lHuVe5V7lXuWfJZ8l32WfZZ9ln2Wfpd+l3+XgJeBloGWgZaBloCWf5Z/loCXgpeDmISYhZiEl4OXgpaBlYGVgJR/lH+Tf5N+kn6RfpB9j32PfI58jnyOfI18jn2Pfo9/j3+PgI+Aj4CPgY+BjoGOgY6BjoKPgpGCkoOThJSElISUhJWDlYOVg5WDlYKVg5aDloOWg5aClYKUgpWClYKVg5aDl4OYg5iDmYOZg5mDmoObgpuBm4GbgJx/m3+bf5t/m3+bf5p/mn+af5p/mX+Zf5mAmICYgJiAl4GWgZWBlYKUgpKDkIOOgo6DjYOMgoyCjIGLgIt/i36LfIt7inyKfIl8iXyIfIh8h3yHfId9iH2IfYl9inyKfIt7i3qMe4x6jXqOeo57j3qOeo55jnmPeJB5kXqQe5B8j32Pfo5+jn6Nf4yAjICNgY2BjYGOgo+CkIKSgpSCloKXgpiBmYGZgJp/mn+bfp19nn2gfqJ+o3+lgKaCp4OohKiEp4WnhaeFp4WnhaaFpoamhqaFp4WnhaeFqIWohKmEqYSqhaqFqoWqhqqGqYWohaiFp4WnhaeFpoWlhaWFpIWkhaOFo4WihaKEoYSghJ+En4Ofg5+Cn4KfgZ6AnoCdf51/nH6cfpx9nH2cfZx9nH2cfZx9nH2cfZx+nH+cgJyAnYGdgp6DnoSfhJ+EoIWghqCGoIeghqCGoIWghJ+EnoSehJ2EnYSdhJ2DnYOdgp2CnYKcgpyBnYGegZ6Bn4GfgKCAnoCdf55+nn+fgKCBoYGigqKCo4KjgaOApICkgKSApH+lf6V/pn+mf6Z+p36nfqaBpoGmgKWApYCkf6N/o4CjgKOAooGigaKBooKigqKDoYOggqCCn4GegZ2AnICbgJqAmX+Yfpd+ln+Wf5V+lX6VfZR8lHuTepN5k3mTeJJ4kneRdpF2kHWQdpB2kXeReJJ4kniTeJR5lXqWepZ7lnyWfJd8ln2WfZd9l32XfZd+l3+YgJiBmIGYgZiBl4GXf5Z/ln+WgJeCmIOZhZmEmYSZgpiCmIGYgZeAl4CWgJZ/lX+Uf5N/kn6RfpF8kHyPfI98j3yPfY9/kICQgJCAkICQgZCBkIGPgY+Bj4GQgZGBkoGTgpWCloOXgpiCmIOZg5iDmIOXg5eDl4OXg5eDl4KWgpaCloKWgpeDl4OYg5mDmoOag5uDnIOcgp2BnYGegJ6AnoCegJ6AnX+dgJ1/nYCcgJyAnICcgJuBm4GbgZqCmYKYg5eDl4SWhJSEk4SRhJCDj4SOg46DjYGMgIx/jH6LfIp7inyJfIl8iHyIfId8h3yHfYd9h32IfIl8inuLe4t6i3qMeox6jHqMeo16jXqNeY15jniOeI94j3mPe459jn6Of45/jn+NgI2AjICNgI2AjYCNgY6Bj4GPgZGAkoCUgJWAloCXf5h+mH2ZfJp7nHude598oX2if6OBpIOlhKaEpoWmhaaGpoamhqWGpYamhqeGqIWohaiEqYSqhKqEq4SrhauFq4WrhquGq4WrhaqFqoWphaiFqIWnhqaGpoalhqWGpYWkhaSGo4WjhKKEooOig6KDoYKhgaGBoYCggKB/n3+ffp99n32ffZ99n3yefJ59nn2ffZ9+n3+fgJ+Bn4GggqGDoYOig6KEooSjhaOGo4akhqSGpIWkhaOFooWihKGEoYShhKGDoIOggqGCoIKggp+BoIGggKCAoYCigKOAoYChf6F+oX6hfqF/o4CkgaaBpoKngaeAp4CogKiAqH+pf6p/qn6qfqt+q36rf6qBqoKpgamBqIGngKeAp4CmgaaBpoGmgqaCpoKlg6WDpYSlhKSDo4KjgqKBoYGggZ+BnoCdf5x/m3+bf5p+mX6ZfZh8mHyYepd5l3mXeZZ4lniVd5R3lHaTdpN2k3eTd5R3lHeUd5V4lniWeZd6l3uXfJd9mH2YfZh9mH2ZfZl+mX+agJqAmoGagpqCmoGZgJh/l3+XgJiBmYKZhJqEmoObg5uCm4GbgZqBmoCagJmAmYCYgJaAlYCUf5N+k32SfJF8kXyRfZF+kX+RgJGBkYGRgZGBkYGRgZGBkYCSgJKAk4CUgJWAl4CYgJqAmoKbg5uDmoOZg5mDmIOYg5iDmIKXgpeCl4KXgpeCmIKZg5qDm4OcgpyCnYKegp+Cn4GggKCAoICggKCBn4CfgJ+An4CfgZ6AnoCegJ6BnoKdgp2DnISbhJqFmYWYhZeGloaUhZOFkoSRhJCDj4KOgY1/jH6LfYp8inyKfIl8iXyIfIh8iH2IfYd9iHyJfIl7inqLeot6i3qLeot6i3mLeYx5jHmMeYx4jXeOd453jnmNe459jn6Nf41/joCNgI2AjYCNgI2AjYCNgI6AjoCPgI9/kH+RfpJ+k36VfpZ9lnuXepl5mnmceZ16nnugfqGAooKig6OEpIWkhaSFo4WkhqSGpYamhqeFqIWphKqEqoOrg6uEq4SshKyFrIWshqyGrYWshayFrIWrhaqFqoWphqiGqIanhqeGpoamhqaGpoWlhaWEpIOkg6SDpIKkgqOCo4GjgaOAo3+ifqF9oX2hfKF8oHygfKB8oH2gfaF+oX+hf6GAooCigaOCo4Okg6WEpYSlhaaFpoanhqeGp4anhaeFpoWmhaWFpYWlhKSDpIOjgqOCpIKkgaSBo4CjgKOApH+lf6Z/pH6jfqN9pH2jfaN+pX+mf6iAqYCqgKqAqoCrgKx/rH6tfq1+rn6ufq9+r36ugK2DrYOsg6yCq4KrgqqCqoKqgqmCqYKpgqmDqYOpg6mEqYWphamEqIOng6eCpYKlgqSBo4GigKGAoICgf59+nn6efZ19nXyce5x6nHqbepp6mXmYeJh3l3eXd5d2lnaWd5Z3lneWd5d3l3iXeJh5mHuYfZh9mn2afZp9mn2afZt+m3+cf5yAnIGdgZ2CnYKcgpuBmoCZgJmAmoGag5uDnIOdgp6CnoKdgp2BnIGcgZyBm4GbgpqCmYGYgZaAlX6VfpR9k3yTfZJ9k36TgJKBkoKSgZKBkoCSf5OAlH+Uf5R/lX+VfpZ+l36Yfpl/moCbgpuDm4Sbg5qDmYOZg5mDmIKYgpeCl4KYgpiCmYGagpqCnIKdgp+BoIGhgaKBooCigKKAooCigKGBoYGhgaGBoYGhgaGBoYGhgaCCoIKgg5+EnoWehp2GnIebh5qHmYeXh5aGlIWThZOEkYOQgo+Ajn6MfYt8inyKfIp9inyKfIl9iX2JfYl9iXyJe4l6iXmKeYp5i3qLeot5i3mLeIx4jHiNeI13jXaOdo53jXmNe419jX6Nf41/jYCOgI6AjoCOgY6AjoCPgI+Aj3+Pf5B/kH6QfZF9kn2TfJR7lnqXeJh3mHeaeJt5nHqcfJ1/n4Ggg6CDoYShhaKFooWjhaSFpYWmhKeEqISpg6qDqoOrg6uDq4OrhKyErYSuha6FroWuha2FrYWshauGqoaqhqqGqYaohqiHqIenhqeGp4anhaaFpoSmhKaDpoOlg6WCpYKlgaWApX+kfqR9o32ifKJ8onyifKJ8oXyhfaJ9on6if6N/o4CkgaWBpYKmg6eDp4SohaiFqIaphqmGqYaphaqFqoWqhaqGqYWphaiDp4KngaaAp4CmgKeApoClgKaAp4CngKd/pn6lfaZ9pn2mfaZ9p32nfah+qn+rf6x/rX+tf65+rn6vfq9+sH6wfrB+sH+wgrCEsISwhK+EroSuhK2ErYSthKyDrIOsg62ErYSthK2FrYauhq2FrYWshKyDqoOpgqmCqIKngaaBpYClgKSAo3+ifqJ9oXyhe6B6n3qeep56nXqceZt4mnead5p3mneZdpl2mXaZdpl2mXeZd5l4mXuZfZl9m32bfZx9nH2dfZ19nX6ef56An4CfgZ+Bn4Kfg56DnYGcgZyBnIGcgp2CnoOegp+Cn4Kfgp+Cn4Kegp6CnYOdg5yDnIKbgpmBmH+Xfpd+ln2VfZR9lH6UgJSCk4GTgZOAlH+Uf5R+lX+VfpV+lX6WfZd9l32XfZh9mH+ZgZqDmoSahJmEmYOZg5iCmIKYgpiCmIGZgZmBmoGcgJ2AnoGggKGAooCjgKSApICkgKOAo4CjgKOBooGigaKBooGigaKBooGigaKCooOig6GFoYagh5+In4ieiJyIm4iaiJmHl4eWhpWFk4SSg5GBkICOfo19jH2LfYt9i32LfYt9i32KfYt8inyKe4p6iXmJeYl5inmKeot5i3iLd4x3jHeNd452jnWNdY53jnqOe459jn6Of45/joCOgI+AkICQgJGAkYCRgJF/kYCRf5F+kX2RfZF8knyTe5N5lXiWd5Z2lnaXdph3mHmZe5p9nICdgp6Dn4SghKCEoYSihKOEpISlg6WCpoKngqiCqYKqg6uDq4Ksg6yDrYOthK6FroWuhq6GrYashquGq4aqhqqHqoeph6mHqYeoh6iHqIaohqiFp4WnhKeEp4Ong6aCpoKmgaaBpYClf6R+o32jfaN8onyifKJ8onyifaJ9on2jfqR+pH+lgKaApoGngqiDqYSphaqFqoaqhquGq4arhqyGrYathq2GrYWshayEq4OqgamBqYCpgKmAqX+of6h/qX+pf6h+qH2nfKh8qHynfKh9qHyofKl9qn2sfq1+rX6ufq5+r36vfrB+sH6xf7J/soCyg7KFsoWyhbKGsYaxhbCFsIWwha+Er4Svg6+Er4SwhLGFsYaxh7CHsIavha+FroWthKyDrIKrgqqBqoGpgKiAqICnf6Z+pX2kfKN8onuhe6F7oHqfep54nnidd513nXecdpx2m3abdpt2m3abd5t4mnqafJp9nHydfZ59nnyefJ59n32ffp9/oH+hgKGAoYKhg6GEoYOfg5+Cn4Kegp6Cn4Kfgp+CoIKhgqGCoIOhg6GEoISfhJ+EnoSdg5yCm4Caf5l+mH6XfpZ+lX6VgZWClYGVgJV/lX6VfpV+lX6VfpV9lnyWfJd7lnyWfJZ9ln6WgJaBl4OXhJeEl4OXg5iCmIKYgZiBmYGagJuAnICdf59/oX+if6N/pH+kf6WApYClgaSBpIGkgaSBpIGkgaOBo4GjgaOBpIGkgaSCo4OjhKKFooehiKGJoYmgip+KnoqcipuJmoiYh5eGlYaUhJODkoGQgI5/jX6NfY19jX2MfYx9jH2MfYx8jHyMe4t6i3mKeYp5inmLeYt5jHiMd4x2jXaOdo51jnSOdY53jnmPfI59jn6Pf49/j3+Pf5B/kX+Sf5J/k3+Tf5N/lH+UgJR/k36TfZN8k3uTeZR4lHeUdpV1lXSVdZV2lniXepd8mX+agJuCnYOeg5+DoIOhg6GDooKjgqOBpIGlgKaAp4GogqqCq4GrgqyCrIOthK2EroWthq6GrYeth6yHq4erh6qHqoeqh6qHqYeph6mHqYeohqiGp4anhaeEp4Sng6aDpoKmgqWBpYCkf6R+o36ifaJ8oXyhfKF8oXyhfKF8on2jfaR9pH6lfqZ/p4CngaiBqIOphKqFqoWrhqyGrIeth6+Hr4avha+Fr4Wuha6ErYOtg6yCq4GqgaqBqoCqf6p+qn6qfal9qnype6l7qXupe6l8qXype6l7qnyrfat9rH6sfq1+rn6vfrB9sH6xf7KAs4CzgrOFtIW0hrSHtIezhrOGs4ayhrKFsoWyhLGFsYWyhLOFs4aziLOHsoeyh7KGsYaxhbCEroKtgq2CrIGsgKuAq4Cqf6l+qH6nfaZ9pXykfKN7o3uie6F5oXigd6B3n3efd592nnaedp12nXadd515nHucfJx8nnyefJ98n3yffJ98oH2gfqB/oX+hf6GAoYGigqKEooSihKGDoYOggp+Cn4KggaCBooKigqOCo4Ojg6OEo4WihaGFoYWfhZ6DnYKcgZuAmn+Zf5h+ln+WgJaCloGWgJZ/lX6VfZV9lX6WfpZ8lXyVe5V6lXuVfJV9lH6Uf5OAlIKVg5aDl4OXg5eCmIGYgZmAmoCbf5x/nX6ffqF9on2kfqR/pX+lgKWApYClgKWBpYGlgaWBpYGmgaaBpYGlgaWBpoGmgaWCpYOkhaSGpIijiaKKoouhi6GLoIuei52LnIqaipmIl4eWhpWElIOSgpGAj3+Ofo59jn2OfY59jn2OfY58jnuNe417jXqMeYx5jHiMeIx4jXeNdo51jnWOdI90j3SPdY53jniOe499j36QfpB/kH+RfpF+kn6TfpN+lH6Vf5V/lX+Wf5Z/ln6VfZV8lXuUeZR3lHaUdZR0lHOUdJR1lHeVeZZ7l32Xf5mBmoKbgp2CnYKegp6Cn4GggaGAo4Ckf6V/poCngKiAqICpgamBqoKqg6qEq4WrhayGrIesh6yHrIerh6qHqoeph6mIqYipiKmHqIeoh6eHp4amhqaFpoSlhKWDpYOkg6SCpIGjgKN/on6hfaF9oHygfKB8oHuge6F7onuifKN8pHykfaV+pn6mf6eAp4Kog6mEqoWqhqyGrYeuh6+Gr4avha+Er4Wvha+FroSthKyDrIOrg6uDq4GrgKt/q36qfap9qXype6l7qXupe6l8qHypfKl7qXuqfKt9rH6tfq5+r36vfrB+sH6xfrJ/s3+zgbSEtIW1hrWGtYe1h7WGtYa1hrWFtYW0hbSFtIW0hbWFtYa1iLWItIi0iLWItIezhrKFsYSvgq+CroKtgqyBq4CrgKp/qX+ofqd+pn2mfaZ8pXyke6R6o3iieKF3oXiheKB3oHegdp93n3efeJ56nnyefJ58oHygfKF8oXuge6B8oH2gfqF+oX+hf6GAoYChgqKDooSjhaKEooShg6GCoYGhgaKBo4GkgqWDpYSlhKWFpIakhqOHo4eih6CFn4Seg52CnIGagJmAmICYgJiBmIGXgJd/ln+WfpV9lX2VfZV8lHuUepR6k3qTfJN9k36Tf5OAlICVgZaCl4KYgpiCmYGZgJp/m36cfp59n32gfKJ8o3ykfaV+pX+lgKaApoCmgKeAp4CngaeBqIGogKiBqIGogKiAqICogaeCpoOmhaaHpYmliqSLo4ujjKOMoYyhjaCNnoydjJyLmomZiJiGl4WVhJSCkoGRf5B+j32PfY98j3yPfI97kHuQfJB7j3qPeY55jniOeI93j3aPdpB1kHSQdJBzj3SPdY93jniOeo98j3yQfZF+kX6SfpJ9k32TfZR9lX2VfpZ+ln6Xf5d/l36Xfpd9lnyWepV4lHaTdZN0knOSdJJ1knaTeJR6lXyVfpaAl4GYgZmCmoKbgpuBnICdf59/oX+ifqN+pH6lfqV/pYCmgKaBpoKmg6aEp4SohKiFqYWqhquHq4iqiKmIqIioiKeIp4iniKeIpoimiKaHpYekhqSGpIWjhKOEooOig6KCooGigKGAoX6gfqB9oHyge6B6oHqgeqB6oXqheqJ7onujfKN8pH2kfqV/pYGmgqaEp4Woh6qHrIesh62GrYWthK2FrYWtha2FroWuha2ErYSshKyErISsgqyBq4CrgKt/qn6qfqp9qnyqfKp8qn2rfKt7q3ure6t8rX2ufa99sH2xfbF9sX2yfrJ+s360gLSDtYS1hbWGtYe2h7eGt4a3hbeGt4a3hbaFtoW2hbaGt4e3ibeJtom2iraKtom1h7SGs4ayhLCDr4Ougq2CrIGsgKuAq3+qf6h+qH6nfqd9pnyme6V6pHmkeKN4o3ijeKN4oneid6J3oXigeKB6oHygfKB8onyifKJ8oXyhe6F8oX2hfaF+oX+hf6GAoYGhgqKDooSihKKFooWihKKDo4GjgKSApIGlgqaDpYSlhaWGpYelh6WIpIijiaOIoYaghZ+EnoOcgpuBmYGZgZmBmYGYgJh/mH+Xf5Z+ln2VfJV8lHuUepN6k3qTe5N9k3+Uf5SAlICVgZaBl4GYgZqBmoGbgJx/nX2efJ97oHuie6N6o3qkfKR9pX6mf6Z/p3+ngKeAp4GogaiAqYCpgamBqYCqgKqAqoCqgamCqYSohqiHqImniqeMpoyljaWNpI6jjqKOoo6hjqCNnoydipyImoaZhZeEloKVgZR/k36SfZF9kXyQe5F7kXuSfJJ7kXuRepB5kHiQd5B2kXaRdZF0kXSRdJFzkHSQdY93j3iPeY97j3yQfJB9kX2SfZN9k3yUfJR8lH2UfZV+lX6VfpZ+ln6WfpZ9lnyWe5R5k3eSdZF0kXSQdJB1kHaQeJF5knuSfZN/lICVgZaBl4GYgZmAmn+cfp19nn2ffaB9oX2ifqJ/on+igKKBooOig6ODo4Okg6WDpoSnhaeHqIioiaeKpoqmiqWJpImkiaSIpIijiKOIooiih6GHoYaghaCEoIOfg5+CoIGggaCAoH+gfqB9oHyge6B6oHmfeaB5oHmgeaF5oXqheqF7onyifaJ+o4CjgqOEpIamh6eIqIephqmFqYSphKmFqoWqhauFq4WshayFrYWthayFrISshKyDrIKsgayArH+sf619rXytfK18rHyte617rHqseqx6rXuue698sHywfLB9sX2xfbJ9sn6zgLOCtIS0hbWGtoe2h7eGt4a2hreGuIa4hriFuIa4hriGuIe3ibiKt4q2i7aLtoq2iLWHtIazhbKEsYSwg6+DroKtga2BrICrgKt/qn6pfqh9qHyne6d6pnqmeaZ4pXileKV3pXekd6R4o3ijeaN7onyifKJ8o3yjfKJ8onyhfKF8oHygfaB+oH6gf6CAoIChgqGCoYShhKGFooSjhKODo4GkgKSApYClgqaDp4WmhqaHp4iniKaJpomliaSJo4ijh6KGoYWfhZ6EnYObgpqBmoGZgJmAmYCYgJd/ln6WfZZ9lXyVe5V6lHuUfJN9lH+Uf5WAlYCWgJeAmH+Zf5t/nH+dfp59n3yge6F6onmjeaN5onqje6N8pH2lfaZ+p36nfqd/qICpgKmAqYCpgKmAqn+qf6uAq4CrgauCq4SrhquHqomqiqmMqY2ojqePpo+lkKWQpJCkkKOPoo6hjKCLnomdiJyGmoSZgpeBln+VfpV9lHyTe5N6k3qTe5N7k3uSepJ5kniSd5J2k3WTdJN0knSSdJJ0kXSQdpB3kHmPeY96kHuRfJF8knySfJN9k3yUfJR8lX2VfZR+lH2UfZR9lX6VfpV9lX2UfJN6kniRdpB1j3SPdI51jnaOd454jnqPfJB+kYCSgJOAlYCWf5h+mX2afJx8nHyde557n3yefZ5+nn6ffp+An4Kfg6CDoIKhgqKCo4KjhKSGpIeliaSLpIuji6OKooqiiaGJoYigiKCIn4ifiJ+Inoeehp6FnoSeg56CnoGfgJ9/n36gfqB8oHugeqB5oHmgeaB4oHigeKB5oHmgeaB6oHugfKB+oICfgqCFoYajh6SIpYelhaWEpYSlhKWEpoSnhKeEqIWphaqFq4SshKyErISshKyErYOtgq2ArX+tfq5+rn2ufK58rnuue656rXqteq16rXuue657r3ywfLB9sH2wfbB9sH6wgLCCsYOyhLOFtIa0hrWGtYa1hreGt4a4hriFuIa4hriGt4e3ibeJt4q3i7aLtoq2ibaItYe0hrOFsoWxhLCDr4Ougq2BrYGsgKyAq3+rfqp+qn2pfKl7qHqpeql5qHioeKd3p3end6Z4pnileaV7pHykfKR8pXyjfaJ9on2hfaB8n3yffaB+oH+ff5+AoIGggqCDoIOhhKGEoYSig6OCo4GjgKR/pH+lgaaDp4Wnh6eIqIioiaiJqIqniqaKpYmkiKSHo4eihqGFoISfhJ2CnIKcgZuAmoGZgZmAmH+Yfpd9l3yWe5V7lXuUfJR9lH6Vf5V/ln+Xf5h/mX6bfpx9nX2ffJ98oHugeqF5oXiid6J4oXmheqJ6o3ukfKV8pn2nfah+qX+pf6qAqn+qf6p/qn+rfqt/q4CrgayBrIOtha2Hromti6yNrI+rkKqQqZGokaeSp5GnkaaQpY+kjaONooyhiqCIn4Weg5yCm4Gaf5l+mH2XfJZ7lXqVe5V7lXuVepV4lXeVd5R2lHWUdZR0lHSTc5N0k3WSd5F4kHmQepB6kHqRepJ7k3uTe5N8lHyUfJR8lH2UfpR+k32TfZN9k32TfZN9lH2TfJN7knmQd491jnWNdY12jHaMd4x4jXmNe459j3+Qf5J/k3+UfpZ9l3yZe5p7mnube5t7mnyafZt9m32bfZt/nIGcgp2CnYKegZ+Bn4Kfg6CEoIahiKKLooyijaGMoIugip+JnoidiJyInImciJyInYedhp2FnYSdgp2BnYCdf55/nn6ffaB8oHugeqF5oHmgeaB4oHegd6B4oHigeZ96n3uffZ5/nYGdg56Fn4egiKKHoYWhhKKEo4Ojg6KDo4Okg6WEpoSnhKiEqYSqg6qDqoOrhKuErIOsg62BrYCtf65/rn6vfa58rnyufK97rnqueq56rnuve697r3uufK58rnyufa1+rX+tgK6BroKvg7CEsYWxhbKFs4a0hrWGtYW2hbaFtoa1hbWGtIi1ibWJtYq2i7aKtom2ibaItYe0h7OGs4ayhbGEsIOvg66CrYGtga2ArX+tfqx+rH2rfKt8q3ureqt5q3ird6p3qneqeKl4qHmoead7p3ymfKV8pX2jfqJ9oX6gfqB+n36efp5+nn6efp9/n4GggqCDoIOhg6GEoYOigqKBo4Cjf6N+pH+kgKWCpoSnhqiHqYipiamKqYupi6iLp4qmiaaJpYilh6SHo4aihaGEoIOfgp6BnIGcgZuAm3+afpp9mXyYfJd8lXyUfZR9lH6VfpR+lX6Xfph9mX2bfJ18nXuee596n3mgeaB3n3efd6B4oHigeKF5onqjeqV7pnunfKh+qH+pf6l/qn+qfqp+qn6qfqt+q3+sgKyBrYOuha+HsImvi6+Or5CukaySrJOqk6mTqZOpkqmRqJCoj6eOpo2ljKSKpIeihaGDoIKfgJ5/nH2bfZp8mHuYe5h7mHuYeph4l3iXd5d2lnWWdZZ0lnSVdJV0lHaTeJJ5knqSepF6knmSeZN5k3qUepR7lXyVfJV9lH6TfpN+k36SfpJ9kn2SfZJ9kn2TfJN7knmRd492jnaNdox2jHaLdot3jHiMeox8jn2PfpB+kX6SfZN7lHqVepZ6l3qXe5Z8lnyWfZZ8lnyXfJd/mICZgZmBmYGagZqBm4Kbg5uEm4Wdh56Jn4ugjZ+Nn4yei52KnIqbiZuJmoibiJuHm4achZyFnIOcgpyBnYCdf51+nn2ffKB6oHqgeaF5oHmheKB4oHigd6B3oHigeZ96nnuefZ1/nYKchJ2Gnoefhp+En4Sfg6CDoYOhgqKCooKjg6SDpYOlhKaEp4Ong6iDqIOpg6qDq4Otgq6BroCuf69/r36wfbB9sHywfLB7r3qvea95rnqteq17rHusfKx8rHysfax+rX6uf66BroKvg7CEsIWxhbGFsoazhrOFs4WzhbOGs4ayhrKGsYeyiLKJs4q0i7WLtYq1irWKtIi0iLSHs4ayhbGEsISvg6+Dr4Kuga+Ar3+vf69+r32vfa58rnuueq15rXiteK13rHeseKx5q3mqeql8qH2nfaZ9pH+jf6J+oX6ffp9+nn+ef51+nH6dfp1/noCfgqCDoISghKGDooOigqOAo3+jfqR+pH+lgKaCpoSnhamGqoiriauKqourjKqNqYupi6mKqIqoiaeIpoelh6WGpISig6GCoIKfgZ6BnoCdf5x+m32afph+l36WfpV9lX2VfZV8lXyXfJh7mXuaept6nHqdeZ15nnieeJ52nXaddp52n3egeKF3onijeaR5pXqmfKd9qH2pfql+qn6qfqp9qn2qfap9q36sf62ArYOuha+Hr4ivi6+Or5Gvk66UrZStlKyVrJSslKuSq5GrkaqQqY+pjaiLp4mmh6WFpISjgqKAoX+ffp19nHycfJt7m3qceZt4mniad5l3mHWYdZh0mHSXdJZ1lXeUeZN5knmTeZN5lHmUeJR4lXmVeZV6lXyWfJV9lX6Uf5N/k36SfpJ9kn2RfZF9kXySfJJ7knqReZB4j3eOd413jHeMd4t3i3iLeYx7jHuNfI58kHyRe5J6knmTeZR4lHqUe5R8lHyUfZR8lHuVe5V9ln+XgJeAl4CXgJeBl4KXg5iEmIWZhpqIm4qcjJ2OnY6djpyMm4ybipuKm4ibh5uGm4WchZyEnIOdgp2Bnn+efp59n3yfe6B6oHmgeKB4oHigeKB3oHegd6B3n3ieeZ57nX2cf5yBnIKchJ2FnoSehJ6Dn4Ogg6GDooKigqKCooKjgqOCpIKkgqWDpYOmgqaCp4KogqqBq4GsgK5/rn+vfrB9sHywfLB8sHuve696rnqteqx6q3qre6t7rHuse618rXyufa5+r36vf7CAsIKxgrKEsoWyhbKFsoWzhrOFs4SyhrKGsYaxhrGGsYewiLCJsYqyi7OLs4uzirSKtIm0iLSHtIezhrKFsYSxhLGDsYKwgbCAsH+wf7F+sX2xfbF8sXywe7B6r3mveK94r3iueK55rXqse6p9qX+of6Z/pIGjgaKAoICff55/nn+dgJ2AnH+cf5x+nH+egJ+DoISghKGDooKjgaOAo3+kfqR9pX6lfqeBqIKpg6uFrIetia2KrIutjK2NrYyti6yLrIqriqqJqYioh6iHp4WmhKSDo4OjgqKBoYGggZ+AnYCbgJp/mX+Yf5d/l36WfZZ8lnuXepd6l3qYeph5mXibeJt4nHicd5x2nHWcdJ11nnafdqB2oXejeKR5pHqle6Z7p3yofKh9qX2pfap8q3yrfKt9q32rfax/rIKshayHrYmtiq2NrZCuk6+Vr5Wvlq+VrpWula6UrZOtk62SrJCsjquMqoupiaiHp4Wng6aCpIGjgKF/oH6ffZ97n3qeeZ14nXideJx3m3aadZp1mXWZdZd3lXmVeZR5lHmUeJV3lXeWd5Z4lXiWeJZ6lnyWfZZ+lX+Vf5R/lH+Tf5N+kn2SfJJ9knySe5F7kXqRepB5j3iOeI14jXiMd4x3i3iLeYt5jHqNeo56j3qQepF5knmSeJN4knqTe5N8k3yTfZN8lHuUe5V8lX6Wf5aAloCWgJaBloOXg5aEloSXhZeHl4mYi5mNmo6bjpuOm42cjJyKnIich5yFnYSdhJ2DnoKfgZ+An3+ffqB8oHuge6B6oHmfeJ94n3efd593n3efd553nXicept8m36bgJuBnIKchJ2EnoSeg5+DoIOhgqKCooKjgaOBo4GjgaSBpIKkgaSCpYKmgaaBp4CogKl/qn6rfqt+rH2tfa18rXyte617rHure6p7qnqqeqp6q3qreqx6rXmteq56r3uwfLF9sX6yf7KAs4GzgrODs4SzhbOFsoayhrOFsoWyhrKHsYexiLGHsYewiK+Jr4mwirGLsYuyirOJtIm0iLOIs4ezh7OGs4WzhLKDsoKygbGBsYCxf7J+sn6zfbN8s3yye7F7sXqxerF5sHmwea95rnqsfKp/qYCngKaApIKjgqGCoIGfgZ6AnoCdgZ2BnICcf5x+nH6cf52Bn4Kgg6GDooKjgKR/pH6lfKV8pnynfah+qoCrgqyErIatiK6KrouvjK+Nr4yvjK+Lr4uuiq2KrImriKuHqoaphqiFpoSlg6SDooKhgqCCn4KdgpyBm4CagJmAmH6XfZd8l3uXepZ6l3qXeZd4mHeZd5l3mneadpp1m3ScdJx0nXSfdKB0oXWjd6N4o3mkeaR6pXqmeqd7qHypfKp7qnyrfKt8q32rfqp/qoGphKqIqoqri6uNrJCtk66Vr5awlrCWsJaxlrCWsJWvlLCTr5KvkK+Oroyti6yJq4ephaiEp4OmgqWApH+jfaN8onuhep95n3meeJ53nXacdpt2m3aad5l4l3qXeZd5l3iXeJd3l3aXdpd3l3eXd5d5lnuXfJd+l3+WgZWBlYGUgJV/lX2UfJR9k32SfJJ7kXuRe5F6kHmPeY15jXmMeIt4i3iLeIt4jHiNeI55j3mQeZF4kniReJF4kXqRepJ7knySfJN8k3uUepV7lnyWfpZ/loCWgJaBloOWhJaElYSVhpWIlYmVipaMl42ZjpqNm42cjJyKnYidhp6FnoOfgp+CoIGggaCAoH+gfaB8oHufep96n3mfeJ94nneed553nnedd514nHmbe5p8mn6agJuBnIGcgp2DnoKggqGCoYKigqKBo4GjgaSBpIGkgaSBpYGlgaWBpYGlgaaApn+nfqd+qH2ofal8qXypfKl8qHyne6d7p3ynfKd7qHqpeap5q3mseK15rnmveLB4sXmye7N8tH20frSAtIGzgbKDsoSyhbKFsYWxhbGFsYawh7CHsIixibGIsIiwiLCIsImwibGKsYuxirGJsomzibOJsoiziLOHs4azhbOEsoOygrKBs4Czf7N+s360fbR8tHy0fLN8s3uze7J7sXuwe697rXyrfqmAqIKmgqWCo4Oig6CDoIKfgZ6BnYGcgZyBm4Cbf5t/m36bf5yAnoGfgqCCoYGigKN+pXyle6Z6p3qoeql8qn6rgKuCrIWth66Jr4qwi7GMsYyyi7GLsYywi7CLr4quia2IrIiqiKmHqIanhaWFo4WhhKCEn4SfhJ6DnIKbgZqAmX+Yfph8mHuXepd5l3qXeZd4lnaWdpd2mHaZdJpzmnObc5xynXGecZ9yn3SgdqB3oXiieKN4pHmleaZ6p3qoe6l7qXuqfKp8qn2qf6mAqYGphKmIqYupjKqNqo+skq2Ur5WwlbGWspazlrOWs5aylbKUspKykbKQsY6wjK+Lroith6yGq4Wqg6iCp4CmfqZ9pXyke6J6oXmfeJ94nnidd5x3nHebeJp6mXqZeZl4mXiYeJh3mHaYdph2mHeYd5h4mHqYfJh9l3+XgZeCl4KXgZaAln6WfZV9lX6UfpN8knySfJF7kHuPeo56jXqMeox5i3eLd4t3jHeNd413jnePd5F3kXiQeJB5kHmQepB7kXuSfJJ7k3qTeZN6lHuVfpZ/ln+WgJaBloKWhJWFlIaUhpSIlImUipWLlYyWjJiNmYyai5uKnYiehp+En4KggaGBoYGhgaGAoX+gfqB8n3ufep96nnmeeJ54nnedd513nXiceJt5mnqae5p8mn2af5uAnIGcgZ2BnoGfgaCBoYGigaKBooGjgaOBo4GjgaOBpIGkgaSApIClgKWApX+lfqZ9pn2mfKZ8pXulfKR9pH2jfKN7pHqkeqV5p3moeKl4q3esdq52r3awd7F3sniyebN7tHy0fbR/tIG0grOEsoSxhbCFsIWvha+Froeuh66Ir4ivia+Jr4mwibCIsIixibGJsYqwirCJsYmxibGJsYixh7KHsoayhbKEsoOygrKBs4Czf7N+tH20fLR8tXy0fbV8tXy1fLR8sn2wfa59rH+qgaiCpoOlg6SDooSghaCEn4Oeg52CnIKbgpuBmoGagJp/mn+afpp/m4CdgZ6Bn4ChfqN9pHuleqV5pnmnead6qHypfqmBqoSshq2Hr4iwirGLsYyyi7GLsYyxjLCMsIyvi66KrYmsiaqJqYmniKaIpIeih6GGoIafhp6FnYSbgpqBmYCZfph8mHuXepZ5lnmWeZZ3lXaUdpV0l3SYc5lymXKacZtxm2+bcJxxnHOcdZ11nnagdqJ3o3ekeKR5pXmleqZ6p3qne6h8qH2pfqmAqYKphKiIqYupjamNqo6rkaySrpOwlLKVs5a0lrWWtZa1lbWUtZO1krWRtI+zjrKMsYqwia+IroethayDqoGpf6h+p32mfaV7o3qieqF5oHmfeZ55nnmdeZx6nHqbepp5mnmZeJl4mXeZdph2mHaYd5h4mHqYfJh9mX+ZgJmCmYKZgpmAmH+YfpZ+ln+Vf5R+k32SfZF9kHyPfI58jnuOeo55jHiMd4t2jHaMdox2jnaPdo93j3iPeY95j3mPeZB6kXuRe5F6kXqReZF5knuSfZN+lH6Uf5SBlIKUhJWGlYeUiJSJk4mTipOLlIuVi5aMl4uYipqJm4edhZ6Dn4GggKB/oIChgaGAoICffp99nnyee556nnmeeJ14nXedd5x3nHibeZp6mnqae5p8mn2afpt/nICdgZ2AnYCdgJ6An4CfgKCAoICggaCBoIGggaCBoIGhgKGAon+if6N+o36jfaJ8onyjfKJ8onyifKJ8onyie6N6pHmkeKZ3p3eodqp1q3WtdK50r3SwdbB1sXWyd7N5s3qzfLN+s4Gyg7KEsYWwhq+Hroeuhq2GrIashqyHrIisiKyJrYqtiq2JroiviK+Jr4mviq+Kr4qvia+JsIiwh7CGsYWxhLGDsYOxgrKBsoCzf7N9s32zfLN8tH20fbR9s32zfbJ+sH+uf6x/q4Gpg6eEpYWkhaOFoIefh56GnoWdhJ2DnIObgpuCmoGZgZmAmH+Yfph+mX6af5x/nX6ffKB7onmieKN3pHekd6V5pXqmfKZ+qIGpg6uFrIeuiK+JsIqxirGLsYyxjbCNsI2vjK6MrYusi6uLqYuoi6eKpYmkiaOJoYmgiJ+HnoadhJyDm4GZf5h9mHyXe5Z6lXmVeJV4lXeVdZV0lnKXcphxmHGZcJlwmW+Zb5lxmXKacpxznXSedJ91oHahd6J4onmjeaN5pHmleqZ7pnynfah/qIKohaeIp4uojamOqo+rj62Qr5GxkrOTtZS2lbeWt5a3lbeUuJO4kreRtpC1j7WNtIu0irKKsYiwhq+EroKsgKt/qX+pfqd9pXyke6N7o3qieqB6n3qeep16nHqcepx5m3mbeZt3m3ebd5p2mneZd5l4mXmZe5l9mn6agJqBm4KbgZqBmoCZf5d/loCVgJSAk3+Rf5B+j32OfY58jnyOeo55jniNd4x3jHaMdYx1jXWNdo13jXiNeY55jniOeI95j3qQepB6j3qPeZB5kHqQe5F9kn2Sf5OAk4KThJOGk4eTiJSJk4qTipOLlIuUi5WLloqXiZiImYaahJuCnICcf5x/nICdgJ6BnYCdf519nXyde516nXmdeJ13nHecd5t4mnmaeZp6mnuae5p8m32bfZt/nICcgJyAnIGcgJx/nX+df51/nYCdgZ2BnYGcgZyBnYGdgJ5/nn+ffp99oH2hfKF8oXyifKJ8onyifKJ7onujeaN4pHeldqZ1qHWpdKpzq3Kscq1yrnKvcrBzsHSwdbF3sXmxe7F+sIGwg7CFr4avh66IromtiKyHq4eqhqqHqoipiKmJqYmqiqqJq4iriKuIq4isiK2JrYmuiK6Iroivh6+Gr4WwhbCDsIKwgbGBsYCxfrF9sXyxe7F7sXyxfbB9r36uf62ArICqgamBp4KmhaSGooeih6GHnomdiZ2InYechpyFm4Sbg5qDmoOZgpiBl4CXf5d+l32YfJp8m3ucep15nnifd6B1oHWgdqF3onmie6N8pH6lgKeCqISqhquIrYmuia+Lr4yvja+Oro6tjq2NrI2rjKqMqYyojKeMpouli6OLoouhi6CKn4meh5yFm4OagJl/mH6XfJZ7lnmVeJV4lXaWdZVzlnKXcJdwmHCYcJlvmW6Yb5hwmXCacZtxnHKcc51znXSddZ52n3egd6F4onijeaN6pHukfaV+pYGlhaWIpYumjKeNqY6rjqyPro+xkLORtZO2lLiVuZW5lbmUuZS5k7mSuZG4j7iOt4y3i7aLtYq0iLOGsYSwgq6ArH+rf6p/qH6nfaZ8pXuke6J8oXyge597n3ueep56nnqdeZ13nHecdpx2nHebd5p4mnmae5p8m36bgJyBnIKcgpuBm4GZgZiBloGUgpOBkoGRgZCAj4COf459jnyOeo55jnmOeI13jHaMdYx1jHWMdox3jHiMeI14jXiOd454jnmPeo96j3qPeY95j3mPeo97kH2QfpGAkoKShJKGk4iTiZOKk4qUipSLlYuVi5WLloqWiZeHmIWYg5mBmYCZf5l+mX+ZgJqAm4Cbfpt9m3yce5x5nHiceJx4m3eaeJp5mnmaeZl6mXuae5p8m3ybfZt+m4CcgZuAnICcgJyAnH+cf5yAm4CbgZuBm4GbgZuBm4Gbf5x/nX6efp99n3ygfKB8oHyhfKB8oXuhe6F6oXmieKN3pXamdKdzqHKpcqpxq3CrcKxwrXCucK5xrXOudK52rnite61+rYGtg62FrYetiK2JrImriaqIqoipiKiIqIiniaeJp4mniaeJqImoiKiIqIiph6qHq4esh6yHrIeth66Groauha+Dr4Kuga+Ar3+vfq99rnyue617rHyrfat+qoCpgaiCpoKmgqSCo4OihqGIoIigiJ+InYqdip2JnYmciJyHnIWbhJqEmoOZg5iDl4KXgJd+l3yXe5h6mXmbeJt3nHaddZ10nXSddZ12nneeeZ96oHuhfaJ/pIGlhKeGqIepiamKqoyqjaqOqo+pj6mOqI6ojqeNpo6mjqWNpI2kjaONoo2hjZ+Mn4ueip2Hm4WagpmAmH+XfZZ7lnmWeJZ3lnaWdZZzlnGXcJdvmG+Yb5hvmG+Yb5hvmXCZcJpwmnKacppzmnSadJp0m3WcdZ12n3agd6B5oXuifKJ+ooGihaOIo4qki6WMpoypjKqNrI2ujrGPs5C1kbeSuZO5lLqVu5W8k7ySvJG7kLqPuo65jbiMt4u3ibaItIayhLGCr4GugayAq4Cqf6l+p36mfqR9o32jfKJ7onuhe6F7oHqgeaB3n3eed553nXideZx5m3mbept7m32cf5yAnIKcgpyCm4KZg5iDl4OVg5SDk4OSg5GCkIGPgI9+jnyOeo15jXiNeI13jXaMdox1i3WLdYt3jHeMeI13jXeOd454jniOeY95j3qPeY54jXiNeY17jXyOfY9/kIGRg5GEkoeTiZSKlIqUipWKlYuWi5aLloqXiZeHmISYgpiBmICXf5d/mH6Yf5l/mn+afpt9m3ybept5m3ibeJp4mniZeJl5mXmYeZh6mHqYe5l7mnyafZt+m3+cgJyAnYCdgJ2AnYGdgZyBnIGcgZyBm4GcgZyBnIGcgJx/nH+dfp19nnyefJ58n3ufe6B7oHugeqF5oXiidqN1pHSlc6Zyp3GncKhvqW+pbqluqm6qb6pwqnKpdKl2qXipe6l9qYCqg6qFqoeqiKqKqoqpiqmJqImniaeJpomliaWJpImkiaWIpYmliaWIpoemh6eGqIWohqmGqoarhqyFrISshKyDrIKsgayArH+sfqt9q3ypfKh8p32nfqZ/pYGkgqSDo4OihKKEoIWgh5+InomeiZ2JnYqdipyKnYmdiZ2HnYachpuFmoWahJmEmIOXgpd/l32Xepd4l3eYd5l2mXWadJp0mnSadZp1mnabd5t4nHmdep58n36ggaKDo4ajiKOKpIykjaWOpI+kj6OPo4+kjqOOo46jj6KOoo6hj6GPoJCfkJ6Pno6djJyKm4eahZmCmIGXf5d8lnqWeZZ4lnaWdJZzl3GXb5dvl2+XbphumG+YbphvmG+Yb5hwmHKXcpdzl3OYc5hzmXOac5tznHSddZ53n3mfe59+oIGghaGIoYqjiqSKpYqniqmLq4utjK+NsY2yjrSQtpG3k7mUu5W8lLyTvJK8kbuRupC6jrqNuYu5iriKt4i1hbSEsoOwg66CrYGsgaqAqYCngKd+pn2mfKV7pHuke6R7pHmjeKN4oniheKB4n3mfeZ56nXqde517nHycfZ2AnYKcg5yEm4SahZiFl4WWhZWFk4SShJGEkIKQgZB/j32Pe455jXiNeI13jXeMdox2i3WKdYt1i3aMd4x3jXaOdo93j3iPeI95j3qPeY15jHmLeot6jHuNfI59jn+PgZGDkYWSh5SJlYqVipaKloqWipaKl4qYiJmGmYSYg5iBmICYgJh/mH6Yfpl+mX6afZp8mnuaepp5mniZeJl4mXmYeZh5mHmXepd6l3qYeph6mXuafJp9m36cf51/noCegZ6BnYGegp6CnYKdgZ2BnYGdgZ2BnYCdgJ2AnH+cfZ18nXyde557nnuee556n3qfeaB4oHahdaJzo3KkcaRxpXCmbqZupm6mbaZtp26nb6ZwpXGldKR3pHmke6R8pX+lgqaFpoemiKaKpoumi6aLpoqliqSLo4uji6OKo4miiaKJo4mjiKOIpIekhqWGpYWmhaaFp4WohKmEqYOpg6mDqIKogaeAp3+mf6V+pX2kfqN9on2ifqKAooGhg6GDoISghJ+Fn4aeiJ6InYmdip2KnYudi52LnYqdiJ6Inoedh5yGnIWbhZqFmoSZg5mAmH6Xe5d5lneWdpZ1l3SXdJZzlnSWdJd0l3WXdpd3mHiZeZl6mnybfpyBnYOehp6Jn4ufjJ+OoI+gkKCQn4+fj6CPoI+gj5+Pn5CekJ6RnZKdkpyRnJCcjpuMmomah5mEmIKYgJd9l3qWeZZ3l3WXc5hxmHCYb5humG6ZbZhumG+Yb5hvmG+YcJdxlnKWcpZzlnOXcphymHKZcppymnKbc5x1nXieep59n4GghKGIooijiaSJpYmmiaeJqYqriq2Lr4ywjbGOs5C1kbeSuJO5k7mTuZO5krmSuZC5j7mNuIy4i7iLt4m2h7SGs4ayhrCFr4Stg6yCq4GqgKp/qX2ofKd8p3yme6Z6pnmmeaV5pHmjeqJ5oXqgeqB7n3ufe558nnydfp2AnYKchJyFmoaZh5mHl4eXhpaGlIaThpOFkoORgZGAkH6Qe496jniOeI13jXeMd4x2i3aKdYp1inWLdYt1jHWMdY12jnePd494j3qOeo56jXqMeox6jHqNe418jn6Of4+BkISRhZOHlIiViZaKloqXipeJl4mYh5mGmoSag5qCmoGagJp/mn+Zfpl+mX2ZfZl8mXuZeph5mHmXeZd5lnmWeZZ5lnqWepZ5l3mXeZh5mXqaept7nHydfp1/nYCdgZ6BnYKdgp6CnoKegp6CnYGdgZ2BnIGcgJ2AnX6cfZx8nXude517nnqeep56nnifd592n3WgdKFyonGicKNvo26jbqNuo22kbaRtpG6jb6JxoXKgdaB3oHmgeqB9oX+hgaGEoYaih6KJoouii6OLooyijKGLoYuhi6GLoIqgiaCJoImgiKGIoYeihqKFooWihaKFo4SjhKSEpISkhKSEpIOjgqKBoYChf6B/oH+gf59/nn6ef55/noCfgp+EnoSehZ6GnoeeiJ6JnYmdip2Lnoueip+Kn4qfiZ+Inoieh52HnYachpuGm4Wbg5qCmn+ZfZh6l3iWdpV1lHSUc5Nzk3OTc5Nzk3STdZR1lHaVd5Z4lnqXfZh/mIGZg5qHm4mcjJyOnI+dkJyRnJCcj5uQm5Cbj5uQm5GbkpuTm5SblJuTmpGaj5qNmoqaiJqFmYOZgZh9mHuXeZd3mHWYcplwmW+Zbpltmm2abZlumW6Yb5hvmG+YcJdxlnKVcpZylnGXcJhwmHGYcJlwmXGac5t1nHedep58noCgg6GGooejiKOIpIimiKeIqIioiKqJrImuiq+MsY6yj7OQtJG1krWTtpO2k7aSt5C3j7eOto22jLaLtYm0iLOIs4iyiLGHr4auha2ErYOsgqyAq3+rfap8qXype6h6qHmoeaZ6pXule6R7o3uie6J8oXyhfKB9n32ffp6AnYKchZuGmoiZiZmJmImXiJaIloeVh5SGlISTgpKBkn+RfJF7kHqPeY14jXiMd4t2inaKdYp0iXOKc4t0jHOMc410jXWOd454jnqOe457jnqNeo16jXqNeo17jn2Ofo5/j4GQg5GFkoeTiJSJlYmWiZeJmIiZh5mGmoWahJqCmoGagJqAmn+af5p+mX2ZfZh8mHuYepd6l3mWeZZ5lXmVeZV5lXmVeZV4lneXd5h3mXiZeJp5mnubfJt+m4CcgZyCnIKcgpyDnIKcgpyCnIKcgpyBnIGcgJx/nH6cfJx7nHqdep16nXqdep15nXiedp51nnSfcp9xoG+gb6BuoG2gbaBtoG2gbZ9tn26fcJ5ynXOddZx4nHmcepx9nH+cgZyDnYadiJ2Jnoqei56MnoyejJ+Mnoufi56Lnoqeip6KnomfiZ+Jn4ifhp+Gn4WfhZ+Fn4SfhKCEoISghKCEoISgg5+Cn4GegJ1/nX+cgJx/nH+bf5t/m4CcgZyDnYWdhp2HnYidiZ2JnYqdi52LnYueip+Kn4mfiZ+Jn4ieiJ2InYich5yGnIachJuDm4Gaf5h8l3qWeJV3lHWTdJJzknKRcpFzkXOSdJJ0knSTdZN2k3iUe5R9lX+WgpaFl4iYi5mNmY+akZqRmZGZkZiRmJGXkJeQmJGYkpmTmZWalZqUmpKakJmNmYuaiJqGmoOagJp9mXuZeZp3mnSacppvmW6ZbZpsmmyZbJltmG6Yb5hvmHCXcZZyl3KWcpdxl3CXb5hvmG+Zb5lvmXCZcZlzmnWbeJx7nX2fgKCDoYaih6OHo4ekh6WGpoanh6iHqYeqiKuKrIyujq+PsJGykrOTtJO0krSRtZC1j7WOtY60jbSLtIqzibOJsoqyirGJsIevhq6FroOtgq2BrYCsfqx9rHyrfKt7qnupe6h8p3yne6Z8pXykfKR8o32ifaF+oH6fgJ+BnoSchpuIm4qai5mLmYuYi5iKl4mXiJeHloaWhJWClICUfpN8kXuQeo95jXmMeIt3i3aKdYp0inOKcopyi3KLcoxyjXSNdo14jXqNeo16jXqNeo16jXqMeox6jHyNfY1/joCOgY+DkIWRhpKHk4iUiJaIloeXhpeFmIWYhJiDmYGZgJmAmX+Zfpl+mX2YfZh8mHuYe5d6l3qWepV6lXmVeZV5lXmVeJZ3lnaXdpd2mHaYd5h4mHqYfJl+mX+ZgZmBmYKZgpqDmYKagpqCmoGagZqBm4Cbf5t+m32bfJx6nHqcepx6m3qbeZt4m3ecdpx0nXKdcZ1vnW6dbp1tnW2cbJxtm22bbZttmm+acJpymXSZdZl3mXmZe5l9mX+ZgZmDmoaaiJqJmoqbi5uLm4ycjJyMnIuci5uKm4qbipyKnImdiZ2InYidh52GnYWehZ6FnoSehJ6EnoSehJ2EnYSdg52DnYGcgJuAmoCagJmAmYCZgJmAmICYgZmCmoSahZqHm4ibiZuKnIqci5yLnIqdiZ2JnomdiZ6JnYmdiZyKnImciJyHnIechpuEm4OagZh+l3yWepV4lHaTdZJzkXKRcpBykHOQc5FzkXORc5F1kXeRepF8kn6SgZODlIaUiZWMlo6WkJaSlpKWkpaSlZKUkpSRlJGVkpaTl5SYlJmUmpKakJmNmouciJ2GnYOdgJx9nHuceZx2nHSbcppvmm6abZlrmWuYbJhtl26Xbpdvl3CXcZdxl3GYcZhwmG+YbplumW6ZbphumG+YcJhymHSZdpt4nHudfp6Bn4OfhaCFoYWihaOFo4WkhaWFpoamh6eJqIupjKqOrI+tka+SsZKykrKRspCykLKPso6yjbKMsouyirKLsoyxi7GKsImwh6+Gr4Svg66CroCufq19rXytfK18rHyrfap+qX2ofad9p32mfaV9pH2jfqF/oICfgZ6DnoWdh5yJm4ubjJuMm4yajJmLmYqZiZmImIeYhZeDl4GWgJV+k36RfZB7jnqNeY14jHaLdYt0inKLcYtwi3CLcIxxjHKNdY13jXmNeo16jXqNeox6jHqMeot6i3uLfIx9jX6NgI6CjoSPhZCGkoaSh5OHlIeUhpWFlYSWg5aCl4GXgZeAl3+Xfpd+l36XfZd8l3uXe5Z7lXuVepV6lXmVeZV5lXiVd5V2lnWWdJZ1lnWWdpZ4lnqWfJZ+ln+WgJaBl4KXgpeCl4KXgpeBl4GXgZiAmH+Zfpp9mnuae5p6mnqaepp6mnqaeZp3mnabdJtzm3GbcJtvm26bbZttmmyZbJltmG2YbZdul2+WcZZzlnSWdZd3l3mYe5h9mH+YgZiEmIaYiZiJmIqYi5iMmIyZjJmMmYuZi5mKmYqaipqKmomaiZuIm4ibh5yHnIachZyFnIWchJyEnIOcg5yDnIOcg5yCm4KbgZqBmYGZgZmBmIGYgJiAl4GXgZeCmIOYhJmGmYiZiZqJmoqaipuKm4mbiJuJm4mbiZuJm4qbi5uKm4qbiZyJm4ebhpqGmoSZgpiAl36WfJR5k3eTdpJ0kXOQco9yj3KPco9yj3KPc490j3aPeJB7kH2QgJGCkoWSiJKLko6TkJSRlJOUk5SUlJSTlJOTk5OUkpWSlpOXk5iSmZGaj5uNnIueiJ+Fn4KegJ19nXudeJ12nXSccptvm26abZlrmGyYbJhtl22Xbpdvl3CXcJhwmHCZcJpvmm6ZbZltmW2ZbZhul2+Xb5ZxlnKXdJh2mXmafJt/nIGdg56En4SfhKCEoIOgg6GEooWjhqOIpIqki6WMpo6nj6mQq5Cska6RrpGvkK+Qr46wjbCNsIywi7CMsIywi7CKsIqwiLCHsIavhK+Dr4Gvf659rn2ufK19rX2sfqx+q36qfql+p36mf6V/pH+jf6GAoIGfg56FnYediZyKnIycjJyNnI2cjZuNm4ubipuJmoiah5mFmYOXgpaBlICSf5F+kHyPeo55jXeNdYx0jHGMcIxvjG6Mbo1vjXGOdI52jXiNeY16jXqNeo16jHqMeox6jHqMe4x8jH6Nf42BjoOOhI+Fj4aQhpGGkoaShZOFlISUg5SClIGUgJV/lX+VfpZ+ln6WfZZ9lnyVe5V7lXuUe5R6lHmUeZR5lHiUd5R1k3STdJR0lHWTdpR4lHqUe5R+k3+Tf5OBk4GTgpOClIKUgpSBlICUgJV/ln6WfJd7mHuYeph5mXmZeZl5mXmZeJl3mXWZdJlzmnGab5pumm2ZbZltmG2XbZdtlm2WbpVvlXCUcZRylXOVdZV2lniWe5Z9ln+WgZaDloaXiJeKl4qXi5eMl4yXjJeMmIyYjJiLmIqZipmJmomaiJqImoibh5uGm4abhZuFm4WbhJuEm4Obg5uDm4Obg5qDmoKagpmBmYGZgZmCmYGYgZiBl4KXgpeCl4KXhJeGl4iYiZmKmYqaipuJmomaiZmJmImYipiKmIuZi5mLmYqaipqKmoiZh5iGmIWYg5eBln+VfZR7kniSd5F1kHSPc45yjXKNcY1xjXKNco5zjnWPd496j3yPf5CBkISQiJCLkI6Rj5GQkZKSlJOVk5WTlZSUlJSVk5eSl5KXkZiRmY+bjp2Mnoqfh6CFn4KegJ5+nnueeJ12nXSdcpxwm26bbZpsmW2YbZhtl22XbZdul26YbphumW+ab5pumm6abZltmW2Ybpdvl2+Wb5ZxlnGVc5V0lnaXeZl9mn+bgZyDnYSehJ6DnoOeg5+Dn4SghqCIoYmhiqGMoo2jjqSOpo+nj6eQqJCpkKqPq46sja2NrYytja2NrYyui66Lr4qviLCHsIavha+Dr4Gvf65+rn2ufa19rX6tfqx/q4CqgKiAp4CmgKWBpIGigaGCoIOfhZ6HnYicipyLnIycjZ2NnY2djZ2NnY2di5yKnImciJyHm4WZhJeEloOUgpKAkX2RfJB6j3iOdo50jnKOcI5ujm2ObY5vjXGOc452jniOeY56jXqNeo17jXuNeo16jXqNe4x8jX2Nfo2AjYKNhI6Ej4WPhZCFkYWRhZKEkoSSg5KCkoGTgJN/k3+TfpR+lH6UfZR9lHyUe5N7k3uUepR5lHmTeZN5k3iTd5N1k3STc5Nzk3SSdpN4k3qSfJJ+koCRgJCBkIKRgpCCkIKRgpGBkYCSf5N+k32Ue5V6lnqWepd5l3mXeZd4l3iYd5d2mHWYdJhymXCZb5humG2YbZdtl22WbZZulG6Ub5Nvk3CTcZJxknKTdJN2k3iTepJ9kn+SgZODlIWUh5WJlYqWi5WMloyWjJaMl4yXi5iKmIqZipmJmomaiJuIm4ebh5uGm4abhZuFm4WahZqEmoOag5qDmoOahJqEmoOZgpmCmYKYgpiCmIKYgZiCmIKXgpeCloOWhJaGl4iYipmKmYqaipqJmYqYipeKl4qXipaKlouWi5aLlouWipeKl4mXiJeHl4aWhJWDlYGUf5N8knuReZB3j3WOdI1zjHKMcYxxjHCNcY1yjXSNdo15jnuOfo6BjoWOiI6Mjo6Pj4+QkJKQlJGVkpWTlZSVlZSWk5eSmJGZkZmQm46cjZ6Ln4mfh5+En4KfgJ99n3ufeJ92n3Secp1wnW6cbpttmm2ZbZhtmG2YbZhtmG2ZbZltmm2abZptmW6ZbZlumG6Xbpdvlm+Wb5ZwlnGVcpVzlXWWd5d6mH2agJuBnIKdg56DnoOfg5+EnoSfhp+Hn4ifiqCLoIyhjaKOoo+jj6OPpI+lj6aOp46ojaiNqY2pjamNqoyqi6uKrImtiK6Hroauha6DroGuf65+rn6ufq19rX6rf6qAqYGogqeCpoKlg6SDooOhg5+DnoWdh5yJm4qbipuLm4ycjJ2Mno2fjZ+Nn42fjZ+MnoueiZ6InYebh5mHmIaWhZWCk3+TfZJ7knmRd5F0kHKQcI9uj22Pbo5vjnGOc452j3iPeY56jnqOeo56jnqOeo56jnqOe419jX6Mf4yBjIKMg42EjoSPhJCFkIWRhJGEkYSRg5KCkoGSgJN/k3+TfpJ+kn2TfZN8k3uTe5N7k3uUepR5lHiTeJN4k3iTd5N1k3STdJN0knWRdpF4kXqRfJB/kICQgY+Cj4OPgo+Cj4KPgo+Bj3+QfpF9kXuSepN5lHmUeZR5lXmVeJV3lnaWdpZ1l3OXcpdxl2+Xbpdtl22WbJZtlm6VbpRvk3CScJJwkXGQcZBxkHKPc491j3iPeo98j36PgJCCkISRhpKIkoqTi5SMlIyVjJWMloyWi5eKmImZiZmJmomaiJuHm4ebh5uHm4abhpqGmoaahZqFmoSahJqEmYSZhJmFmYSZg5iCmIKYgpmCmIKYgpiCmIKXg5eEloSWhZaGl4iYiZmKmYqZipmKmIuXi5aMlYuVi5SLlIuTi5OLk4uTipSJlImTiZSIlIeThpOEk4KTgJJ+kXyQeo94jneOdY1zjHKMcYxwjHCMcIxyjHSMdox4jHqMfYyBjIWMiIyMjY6Nj46Rj5KQk5GUkpWUlZWVl5SYk5iRmZCZkJqPnI2djJ6Kn4ifhZ+DoIKgf6B9oHqgd6B1oHSfcp9xnm+dbp1unG6bbpptmm2abZptmm2abJpsmW2ZbZhtl22XbpZulm6VbpVvlW+Vb5VvlXCVcZVylXOVdpZ4l3uYfZp/m4CcgZ2CnYKdg52EnYWdhp2HnYidiZ6KnoufjJ+NoI6hj6GPoo+jjqSOpI6ljaWNpY2mjaeMp4uoi6mKqoiqh6uGq4WshKyCrYCtf6x+rX6tfqx+q3+pgKeCpoOlhKSEo4SihaGFoIWehZ2Gm4eaiJqKmoqaipqKmoqbi5yMnoyfjZ+NoI2gjaCNn4yfi56KnYqcipuJmomZh5iFloGVfpV8lHqUd5N1knKRcJBukG6Pbo9vjnGOc451jneOeY96j3qPeo96j3qPeo95j3qOfI59jX+NgIyBjIOMg42DjYOOg4+EkISQhJCEkYSRg5KBkoCSf5J/kn6SfpJ+kn2SfJN8k3uTe5R7lHqUeZR5lHiUeJR4lHiUd5V1lHWUdZN1kneReJB5j3uOfY5/joGOgo6DjoOOg46CjoKOgY6Aj3+PfY97kHqQepF5kXiSeJJ4k3iUd5R3lXaWdZZzlnKXcZdwl2+XbpdtlmyWbJVtlW6Ub5NxknGRcZBxj3GPcY5xjnKNc411jHeMeYx7jH2Mf42BjYOOhY6Hj4iRipKLk4uUi5WLlYuWipeJl4mYiZiJmYiZh5mHmYeZh5mHmYeZhpmGmYaZhpmFmIWYhZiFmIWYhZiFmISYg5iCmIKYgpiCmIKYgpiCmIOXg5eEl4SXhZaGloiXiZiJmYqZipmLloyWjZWNlIyTjJKMkYyRjJCMkIuQipGKkYqRiZGIkYeRhpGEkYORgpGAkH6QfI96j3iOdo50jXONcYxwjHCMcItyi3SLdop4inqKfYqAioSLiIuLi42Mj42RjpKQkpGTkpSUlJaUmJOYkpmRmZCaj5uOnI2di52JnoaehJ+Cn4CgfqB8oXmhd6F1oHSgc6Bxn3Cfb55unW6dbp1tnGycbJtsm2yabJltmG2YbZdtlm6VbpVulG6TbpNuk26TbpNuk2+UcJRxlHKUdJV3lnmWe5d9mH+ZgJqBm4Kbg5uEm4WbhpyInIiciZyKnYudjJ2Nno6fj6CPoY+ijqONo46jjqOOo46kjaSMpYumiqeJp4iohqiFqYSpg6mBqYCpf6l+qX6of6Z/pYCjgqKDoYWghp+Gn4adhp2HnIech5uImYiZipmKmYqaipqJm4mcipyKnYuejJ+Mn42gjaCNoI2fjJ6MnYyci5uLm4qbiZqHmYOYgJd+lnuWeJV2lHOTcZJwkG+Qb49wj3GOc451j3ePeI95kHmPeo95j3mQeZB6kHuPfY9+joCOgY6CjoOOg46DjoKPg4+Dj4SPhJCEkIORgpGBkX+RfpJ+kn2SfZJ9knySfJJ7k3uTepR6lHqTeZR5lHiUd5R3lXeVdpV2lXaUd5N3kniRepB7jn2Ofo2AjYGNgo2DjYSNg42DjoKOgY+Aj36PfI97j3qPeY95j3iQeJB3knaTdpR1lHSVc5VylnGWcJdvl26Xbpdtlm2WbJVtlG+TcJJykXKRcpByjnKNcoxyjHKLdIp2iXiKeYp7inyLfouAi4KMhIyGjYeOiI+JkYqSipOKlIqViZWIloiWiJaIloiWh5aHloeWiJaIloeWh5aHloeWhpaGl4WXhZeFmIWYhZiFmISYg5iCmIKYgpiCmIKYgpiCl4OXhJeEl4WWhpaHloeXiJeImImYipeLlY2UjZOOko6RjZCNkI2QjI+Mj4uPi4+Kj4qPiZCIkIiQh5CFkISQgpCBkH+QfJB6j3iOd451jnSNc4xyi3GKcYpyinSJdol4iXuIfYiAiYOJh4qKi4yMjo2PjpGQkZGSk5OVk5aTl5KYkZmQmo+bj5yNnYydip6In4afhKCBoH+hfaF7oXmhd6F1oXShcqFxoHGgcJ9unm6ebp5tnmydbJtsmm2ZbZltmG6Xbpdulm6VbpRvlG+TbpJukm2SbZJukm6Sb5Nwk3GTc5N1lHeVepZ8ln2XfpeAmIGZg5mEmoWahpuHnIiciZuKnIucjJyNnY6ejp6OoI6hjaGNoo2ijqKOo46jjaSMpIukiqSJpIekhqSFpYOlgqWBpYCkf6R/o4ChgKCBn4KehJ2FnYech5yHm4eah5mImYiZiJmImYmZiZmJmYqZiZqJmombiZuJnIqdi52LnoyejZ+Nn46fjp6OnY6cjZyMnIybipqImoWZgpl/mH2XepZ3lXWUc5NxkXCQb49wj3GOc450j3aQd5B4kHiReZF5kXmReZF6kXyQfZB/j4GPgZCCkIOQg5GDkIOQg5CDkISQhJGEkYORgZGAkX+SfZJ9k32TfZN8knyTe5N7k3qTepN5k3mUeZR4lHiUd5V2lXaVdpV2lXeUeJN5knuQfI99jn+OgI2BjYGNgo2DjYSOg46Cj4GQgJB/kX6RfJB7kHqPeo95j3iQeJF3kXWSdJN0k3OUcpVxlXCWb5Zvl26Xbpdtlm2VbZVuk3CScZFzkHSPdY50jXSMdIt0inSJdYh2iHeIeYl6iXuJfYp/ioGKg4uEjIaNh46Ij4iQiJGIkoiTiJSHlIeUh5SHlIiUiJSIk4iTiJOIk4iTh5OHlIaVhpWFlYWWhZaFloWWhZaEl4OXg5eDl4KXgpeCl4KXg5eDl4OWhJaFlYaVhpWHlYeWh5aIlYqVi5WMko6SjpGPkI+Qj4+Pj46PjY+Mj4yPi4+LkIqQiY+Ij4iPh5CGkISPgo+Bj3+QfY97j3mOd452jnWNdIxzi3KKcolziXSIdoh4h3uHfYiAiIOIhoqJi4uMjI2Ojo+QkZGSk5KUkpWRlpCYkJmPmo6cjZyMnYqfiaCHoYWig6KBon+ifaJ7onmid6J1onShcqFxoXCgb6Bun26fbZ5tnW2cbZttmm2ZbphumG6Xb5ZvlW+Vb5Rvk2+Tb5Jukm6RbZFtkW6RbpJvknCScZJzk3aUeJV7lXyVfZV/loGWgpeDmIWZhpmHmoiaipqLmoybjJuMnI2djZ6Nn42gjKCMoY2hjaKNo46jjaOMo4ujiqOJo4eihqKFooOigqKCoYGhgaCBn4GegpyDm4SbhZqGmoiaiZmJmImYiJeIl4iXiJeIl4iXiZeJmImYiZiJmYiZiJmImoibiZuLm4ycjJyNnI6dj5yQnJCbj5uOm42bjJqKmoaag5mAmH6Ye5d5lXeUdJNykXGQcJBxj3GPco9zj3WQdpB3kXeReJF5kXmReZF7kX2RfpGAkYGRgpGCkoOSg5KEkoSShJKEkoSShJKEk4OTgZOAlH6UfZN9k32TfZN8k3ySe5J6knqSeZJ5k3iTeJN4lHeUdpR2lHWUdZV2lHeUeZN7kn2QfpB/j4CPgY6BjoKNgo6CjoKPgpCBkICRgJJ/kn6SfJJ7knuRe5F6kXiSd5J2k3WTdJNzlHKUcZVwlW+VbpZulm2WbZZtlm2VbpRvk3CScpF0kHaPdo52jXaMdot2inWJdoh2iHeIeIh5iXuJfYp/ioGLgouDjISNhY2GjoePh5CHkYeRh5GHkYeRh5GHkYiQiJCIkYmRiJKIkoeSh5OGlIaUhZSFlIWUhZSFlIWUhZSElYOVg5WDlYKWgpWClYKVg5WDlISUhZOGk4eTh5OIk4iTiJOJk4uTjJONkJCQkJCQj5CPkI+Qj4+Pjo+Nj4yPjI+LkIqQiZCJkIiQh5CGkISQg5CBkH+QfZB8j3qPeI53jnaNdYx0i3OKc4l0iHWIdod4h3uGfYeAh4KIhYmHiomLi4yNjo6Pj5GQkpCUkJWPlo+XjpmNmoyci52Knomgh6KGo4SjgqSBpH+kfaR7pHqkeKN2o3Sic6JyoXCgb6Bvn26fbp5tnW2cbptumm6Zbphvl2+Xb5ZwlXCUcJRwk3CSb5JvkW6RbpFtkW2RbZFukW+RcJFykXSRd5J5knuTfZN+lICUgZSDlYSWhZaGl4iYiZmKmYuai5uLm4uci52Mnoufi6CLoIyhjKGMooyijaKMoouiiqKJooiihqGFoYShg6CDn4Kegp2CnIObg5qEmYWZhpiHmImYipiKl4qWipaKlomWiZaIloiWiZaJlomXiJeIl4iXiJiImIiYiJiKmIuYjJmNmY6Zj5qRmpCbj5uPm46bjZqLmYeZhZiCmH+XfZZ7lXiUdpNzknKRcZFxkXGQcZBykHORdZF2kXeReJF4kXiReZF7kXyRfpKAkoGSgpKCk4OThJOEk4SThJSElISUhJSDlIKUgZSAlH+UfpR+k32TfZJ9knySfJF7kXqSeZJ4kniTd5N3k3aUdpR1lXWUdZR2k3iTepJ8kX6RgJCAkIGQgY+Bj4KQgpCCkIGRgJGAkn+Sf5N+lH2UfJR7lHuUepR6lHmUd5R1lHSUc5VylXGVcJVvlW6WbZZtlm2WbZZtlm6Vb5RwlHGSc5F1kHePeI53jneNeIx4i3eLd4p3ineKd4p4inmKfIp+i4CLgYyCjIONhI2EjYWOho6GjoeOh46Hj4ePh4+IjoiOiY+Jj4iQiJCHkYeSh5OGk4WThZOFkoWShZKFk4WThJODk4OTg5SDlIKUgpOCk4OThJKFkYaRhpGHkYiRiZGJkYmRiZGKkYyQjpCPj5CPkI+Rj5GPkY+Qj5CQj5COkI2Qi5CKkImQiZCJkYiRh5GGkYSRg5GBkH+QfpB9j3yPeo54jXeNd4t2i3aKdYl1iHaHd4d5hnuGfYaAhoKHhIiGiYeLioyLjoyPjZCOko6UjpWOl42YjJqLm4qciZ6IoIehhaKEo4OkgaSApX+lfqV8pXqkeaR3o3WidKJyoXGhcKBvoG+fbp5unW+cb5tvmm+YcJdwlnCWcJVxlHGTcJNwknCSb5JvkW+RbpFtkW2RbZBukG+QcJBykHSPdpB4kHqQfJF9kX+SgJKBk4OThJSFlYaWh5eImYmaipqKm4qbi5yLnYqeip6Ln4ufi6CLoIuhjKGMoouiiqKJoYihh6GGoIafhZ6FnYSbhJqEmYSYhZeFl4aWhpaHloiXiZeKl4uWi5WKlYqViZWJlYmViZSIlYiViJWHloiWiJaIloiWiZWKlouWjJaNlo6Xj5iQmJCZkJmPmY+ZjpmMmYqZh5iEmIGXf5d8lnqWd5V1lHOTcpNxknGScZFykXKSc5J1k3eTeJN4kniSeZJ7knySfpJ/koGTgpODkoSThJOEk4SUhJSElYWVhZWElYOVgpWBlYCUf5R+k36SfpJ9kX2RfJJ7knqSeZJ4kneTd5N2k3aUdZR1lHWUdpN3knmSe5F9kX+RgJGBkYGRgZGCkYKSgpKBk4GTgJOAlH+UfpV9lXyWe5Z7lnuWepZ6lniWd5Z1lnSWc5ZylnGXcJdvl26XbZZtlm2VbZVtlW6Ub5Rxk3OSdZJ3kXiQeZB5j3mOeY55jXiNeIx3jHeMd4t4i3mLe4t9jH+MgIyCjYONg42EjYSNhY2GjYaNho2GjYaNh42HjYeOiI6Ij4ePh5CHkIaRhZGFkYWQhZCFkIWRhZKFkoSShJKDkoOSgpKCkoOSg5GEkYSQhZCGj4ePiI+Ij4mPiY+Jj4mPio6Ljo2Pjo+Qj5GPkY+Sj5KPkY+RkJCQj5COkI2RjJGKkYqRiZGIkYiRh5GGkYSRgpGBkICQf5B+j32Pe496jnmNeYx4i3iKd4p3iHeHeIZ6hnyFfYV/hoGHg4iEiYaKh4yJjoqPi5GLk4uUi5aLmIuaipuKnImeh5+GoYWig6OCpIGlgKV/pX6lfaZ8pXukeqR4o3aidaJzoXKhcaBwn3CecJ1wnHCbcZpxmHGXcZZxlXGUcZRyk3GTcZJwknCSb5FvkW+QbpBukG2Qbo9uj2+PcI5yjnSOdo53jnmOe458j36Pf5CAkIGQgpGDkoOUhZWGloaXh5iImYmZipqKmoqbipyKnIqdip2Knoqfi6CLoIuhiqCKoImgiJ+Inoidh5yHm4aZh5iHl4aWh5WHlIeUh5SHlIiViZWKlouWi5aLlYqVipWJlYmViZWIlYiVh5WHlYeVh5WIlYmVipSLlIyVjZWOlY6Vj5WQlpCXkJiQmJCYj5iNmIuYiJmFmIOYgJh9l3qXeJZ2lXSUcpNxk3GScZJxknGScZNzk3aTd5N3k3iTeZN7knySfZJ/koGSgpKDk4SThZSFlISUhJSElYSVhJWDloOWgpWBlYCUgJN/k3+Sf5J+kn2Se5N6k3mTeJN3k3aTdpR2lHWUdZN1k3aSd5J5kXqRe5B9kX6Rf5KAkoGSgZKBk4GTgJSAlYCVf5Z/ln6XfZd8l3uYe5h7mHqZepl5mXiZd5l1mHSYc5hxmHCYb5hul22XbZdtlm2WbZVulG+UcJNyknSSdpF3kXiReZF5kXqQepB6j3mPeI54jneNeIx4jHmMe4x9jH6MgIyBjIKMg42EjIWMhYyGjIaMhoyHjIaMh4yHjIeMh42HjYaOho6GjoWOhY6FjoWPhY+Fj4WPhJCEkISQhJCEkYOQg5CDj4SPhI+FjoWOho6HjoeOiI6JjomOio6KjYqNi42MjY2Oj4+Qj5GPkpCSkJKQkpCRkJCQj5COkI2QjJCLkYqRiZKIkoeSh5KFkYSRg5GCkYCQgJB/kH2PfI97j3qOeo16jHqLeop5iXmIeod7h3yHfYd/iICIgYmCioOLhY2GjoeQiJKJk4mViZeImYibiJyHnoefhaCEooOjgqSApH+lf6V+pX2lfaV8pHukeqR5o3ejdqJ0oXOgcp9ynnKdcZxym3KZcphyl3OWc5VylXKUcpRyk3KTcZNxknCScJFwkHCQb49uj26Obo5vjXCMcYxyjHSMdYx3jHiLeYt7jH2Mfox/jYCNgY6Bj4KQgpGDkoSThZSGlYeWiJeIl4mYiZiJmYmZiZqKm4qbipyKnIqci5yLnIqbipqKmoqZiZiJl4mWiZWJlImTiZKJkoiSiJKIkoiTiJOJlIqVi5WLlYuVipWKlYmViZWIlYiVh5WHloeWh5WIlYmUi5SMlI2UjpSOlI+Uj5SPlY+Wj5aPl5CYkJiOmYyZiZmGmYSYgZh+mHuXeZd3lnWVc5Rxk3GTcZNwknCScZJyknSTdZN3k3eSeZJ6knuSfZJ/koGSgpKCk4OThJOElIWUhJWElYSVhJWDlYOVgpWClIGUgZSAlICUf5R+lH2Ve5V5lXmVeJV3lXaUdpR2lHWTdZN2kneReJF5kXqRfJF9kX6SfpJ/koCTgJSAlICVf5Z/ln6Wfpd9mH2ZfJl7mnuaepp6mnqbept5m3ibd5t2m3WadJpymnGZcJlvmG6Ybpdulm6VbpVvlHCTcZJzknSRdpF3kniSeZJ5knqRepF6kXqQeZB5j3iPeY55jXqNe418jH6MgIyBjIKMg4yEjIWMhoyGjIaMhouHi4eLh4uHi4eLhoyGjIaMhYyFjIWMhY2FjYWNhI2EjYWOhI6EjoSPhI+Ej4SOg46EjYWNhY2GjYaNho2HjYeNiI2JjYqNio2LjYyNjI2NjY2Njo6PjpCOkY+SkJKQkpCRkJGQkJCOkI2QjJGLkYqRiJGHkYeShpKGkoWShJGCkYGRgJB/kH6QfZB8j3yPe457jXuNe4x7i3uKe4p7iXyJfIp9in2KfouAjIGNgo6Cj4ORhJOElIWWhZiFmYSahJyEnoSfg6GCoYGigKJ/on6jfqN9o32jfKN8o3ujeqN5oniid6F2oHWfdZ50nXScdJt0mnSZdJh0l3SWdJZzlXOVc5RzlHKUcZNxknGScZFxkXGQcI9wjm+NcIxwi3GKcopziXSJdYl2iXeJeYl6iXyJfYp9in6Lf4t/jICNgY2BjoKOg4+EkIWRhpKHkoeTiJSIlYiViJWJlomWipaKlouWi5aMloyWi5WLlYuVi5SLlIuTi5KLkYuRipGKkYmRiJGIkYiSiJKJk4qTi5SLlIuUi5SKlYmViZWJlYiViJWIlYiViJSJlIqUi5OMlI6Uj5SPlI+UkJSPlY+VjpaPlpCXj5iOmYyZipqHmoSagpl/mXyZeph4mHaXdJZylXGUcZRwk3CScZJykXORdJF2kXeReJF6kXuSfJJ+koCTgZOCk4KThJOElISUhZSElISUhJWElYOUg5SDlIKUgZSBlICUf5V9lnuWepZ5lniVeJV3lHeUdpN2k3aTdpN2kniSeZF6kXuRfJF8kX2SfZJ+k3+Uf5V/ln+Wfpd9l32XfZh8mXyZe5l6mXqaepp6m3mbeZx5nHicd5x2nHWcdJxym3KbcZpwmm+Zb5hvl2+Vb5Rwk3GTc5J0knWRdpF3kXiReJJ5knqSepJ7kXqRepF6kHqPeo97jnuOfI19jX6NgI2BjYOMg4yEjIWMhoyGjIaLh4uHi4eLh4uHi4eLhouGi4WLhYyEjISMhY2FjYSNhY2EjYSNhI2DjYONhI2EjYWNhYyFjIWMhoyGjIeMh4yHjIiNiY2JjYqNi42LjYyNjY2OjY6Nj42PjZCNkI6Rj5KPkpCRkJGRkJGOkY6RjZGMkYqRiZGIkYeRhpKFkoSShJKDkoGSgJKAkn+SfpF9kX2QfZB8j3yPfI58jnyNfI18jHuMe4x8jHyNfY1+jn+Pf5CAkYCSgJSBlYGWgZeBmIGagZuBnYGegZ+An3+gfqB+oH2hfaF8oXyhfKF8oXuhe6F6oXmheKB4n3eed513nHabdpp2mnaZdph2mHWXdZZ0lnSWc5VzlXOUcpNyknKRcpBykHKPco5yjXGMcYtyinOJc4h0iHSHdYd2h3eHeYd6h3uHfId8iH2Ifoh+iH6Jf4qAioGLgouDjISMhY2FjYaOho+Hj4ePiI+Ij4mPio+Lj4yPjI+Mj42QjJCMkIyQjI+Mj4yPjI6MjoyOi46KjoqOiY+Ij4iQiJCIkYmSipOLk4uTipOKlImUiZWJlYmUiZSJlImTipSKk4uTjJONk46Uj5SPlJCUkJWQlY+Wj5aPl4+Xj5iNmYyaiZqHm4Sagpp/mn2aepl4mXaZdZhzl3KWcZVxlHKTcpNzknSSdJF1kXeReJF4kXqRfJJ+kn+SgJOBk4KTg5OEk4SUhJSFlISUhJSElISUg5SDlIKUgpSBlH+UfpV8lHqUepR5lHmUeJR4k3eTd5N2k3aTdpJ2kniSeZJ6knuSfJJ8k3yTfZR9lH2VfpZ+ln6Xfpd9l32XfJh8mHuYe5h6mXmZeZp5mnmbeJt4nHecdp12nXWddJ1znXKdcpxxm3GacZlxmHGXcZVylHOTdJN1knaSdpJ3kXeReJF5kXmRepF7kXuRe5B7kHuPfI98jnyOfY1+jX+NgI2CjIOMhIyFjIaLhouGi4eKh4uHi4eLh4uHi4eLhoyFjISMhI2EjYSNhI2EjYSNhI2EjYSNhI2EjYSNhI2FjYWNhYyFjIWMhoyGjIeNh42IjYiNiY2JjYqNi42MjY2Njo2OjY+Nj42PjZCNkI2QjpCPkJCQkJCRj5GPko6SjpKMkouSiZKIkoeShpKFk4STg5OCk4GTgZOAk3+TfpN+k32SfZJ9kX2RfZF9kH2QfJB8kHyPfI98j3yQfJB9kX2RfZJ9k36UfpV+ln6Xf5h/mX+af5t/nH+dfp1+nn6ffZ99n3yffJ98n3ufe597oHugeqB6oHmgeZ95nnmeeZ14nHibd5p3mneZd5l3mHaXdpd1lnSWdJV0lXSUdJN0knSRdJB0j3SOdI1zjHOLc4p0iXSIdYd1h3aGdoZ3hXiFeYV6hXuFe4V8hXyGfYZ9hn6Gf4aAh4GHgYeCiIOIg4iEiYSJhYmGioeKh4qIiYmJiomLiYyJjImNio2KjYqNio2KjYqNio2KjIqMi4yLi4yLjIqNiY2IjoePh4+IkIiRiZKKk4uTi5SKlImUiZSJlImUipOKk4uTi5OLkoySjJKNk46Tj5OPlI+Uj5SPlY+Wj5aPl4+YjpiMmoqbiJuHm4WbgpuAm36be5t5mneadZl0mHOXc5ZzlXOUdJR0k3SSdZJ2kXeRd5F4kXmRe5F9kn6Sf5KAkoGSgpKDk4OThJSElISUhJSElISVg5WDlIKUgpSBlH+UfpR8lHuUepR5lHiTeJN3k3eTdpR2lHaUdpN2k3eTeJN5lHqUe5R7lHyVfJV9ln2WfZZ9l32XfJd8mH2YfJh8mXuZe5p6mnmbeZt4m3ecd5x2nXaddZ51nnSedJ50nnOdc51znHObc5pzmXOYdJd1lnWUdpN3k3eSd5J4kXiReZB5kHqPeo96j3uPe498jnyOfY59jX6Nfox/jICMgYuCi4SLhYuGi4aLh4uHi4eLh4uHi4eMhoyGjIaNhY2EjYSNhI2DjYSNhI2EjYSOhI2EjYSNhY2FjYWNhY2FjYWNhY2GjYaNho2GjYaNh42HjYiOiI6JjoqOi42MjY2Njo2PjY+Nj42QjpCOkI6QjpCPj5CPkI+RjpKPko6TjpOMlIuUipSIlIeUhZSElIOUg5SClIGUgZSAlH+Uf5R+lH6UfZR9k32TfpN+k36TfZN9k3yTfJN8k3yTfJN8k3yTfJR8lHyVfJZ8ln2XfZh9mX2afZt9m3ycfJx8nXydfJ17nXude557nnueep96n3qfeZ95n3meeZ15nXqcepx6m3mbeJp4mXiZd5l3mHeYdph2l3WWdZZ1lXWUdZN2knaRdpB2jnaNdox2i3aKdol2iHaHd4Z3hneFeIR4hHmEeoR6hHuEe4R8hHyEfYV+hX6Ff4WAhYCFgYWBhYKFg4WDhYSFhYWFhYaFh4WIhYmFioWLhIyEjISNhY2FjYWNhY2FjYaNho2GjIeMiIyJi4mKiomMiIyHjYeOh46Hj4eQiJCIkYmSiZOJk4mTiZOJk4qSipKLkoySjJKMk4yTjZKOk46Tj5OPk5CUj5SPlY+Vj5aPl46XjZiLmYqaiJuGm4Wcg5yAnH6ce5t5mniad5l2mHWXdZd1lnSVdZV1lHWTdpJ2kneSd5F4kXmRepF8kX2SfpKAkoGSgpKCk4KTg5ODk4OUg5SDlIOUg5SDlIOUgpSBlH+UfpR8lHuUepR5lHiUd5V3lXaVdZV1lXWVdpR2lHeUeJR5lHqVepV7lXuWfJZ8lnyXfJd8l3yYfJh8mXyZe5l7mnube5t6nHmceJ13nXeddp11nnSedJ50nnSedJ50nnSddJ11nHWbdZp2mXaYd5d3lniVeJR5lHmTeZJ5knmRepB7kHuPe457jnyNfI18jH2MfYt+i36Lf4qAioCKgYqCioSLhYuGi4eLh4uHi4eMh4yHjIaMho2FjoWOhI6Ej4SOhI6EjoSOhI6EjoSNhI2EjYWNhY2FjYWNhY2GjYaNho2GjYaNho2GjYaNho2HjYeNiI2JjYqNjI2NjY6Njo2PjY+Nj42QjpCPkI+Qj4+Qj5COkY2SjZKNk42UjJSLlYuViZWIlYeVhZWFlYSUg5SClIGVgZWAlX+Vf5V+lX2VfZV9lX2VfpV+lX6WfpZ9ln2WfZZ8lXyVfJV8lXyVfJZ8lnuWe5d8l3uYe5h7mXqaepp7mnuae5p7m3ube5t6nHqcepx6nXqdeZ55nnmeeZ15nXqcepx6m3ubept6mnmaeZp4mniZeJl3mHeYd5d3lneWd5V3lHeTd5J4kniReJB4jnmNeIx4i3iKeIl5iHmHeYZ4hXiFeYR5hHqEeoR6hHuEe4R8hHyEfIV9hX6Ff4WAhYCFgYWBhYKEg4SDhISEhYOGg4aDh4KJgoqCi4KMgY2BjYGNgY6CjoKOgo6CjYONg4yEi4WLhoqHioiJiYiKh4uGjIaMho2GjoaOh4+Hj4iQiJCIkImQiZCKkIuRi5GLkYyRjJKMko2SjZKOko+Tj5OQk5CTj5SPlI+Vj5WPlo6XjZeLmImZiJqGm4SbgpuAm36bfJp6mnmZeJl4mHeYdpd2lnWWdpV2lHeTd5N3kneSeJF4kXmQepB7kXyRfpF/kYCSgZKBk4KTgpOCk4OTg5KDkoOSg5ODk4KTgZSAlH+UfZR8lHuUepR5lXiVd5V2lXWVdZV1lXWUdZR2lHeUeJR4lHmVeZV6lnqWe5d7l3uYe5h7mHuZe5l6mnqaepp6m3qceZx5nXidd513nXaddZ11nXWcdJx0nHScdJx1m3Wbdpp2mnaZd5h4l3iXeZZ6lXqVepR6k3qTepJ7kXuRfJB8j32OfY19jX2Mfot+i36Kfop/in+JgImAioGKgoqCi4OLhYuGi4eMh4yHjIeNh42HjYaOhY6EjoSOhI6EjoSOhI6EjYSNhI2FjYWNhYyFjIWMhYyFjIWNhY2FjYaNho2GjYaNho2GjYaNh42HjYiMiIyJjIqMjIyNjY6Njo2Pjo+Oj46QkJCQkJGQkY+RjpKOko2SjJOMk4yUi5SLlYqViZaIloeVhpWFlYWVhJWDlYKVgJWAlX+VfpV+lX2VfZV9lX2VfZV9ln2WfZZ9l32XfZd8l3yXfJd8l3uXe5d7l3uXeph6mHqYepl5mXmYeph6mHqYeph6mXqZeZl5mnmaeZp5mnmaeZp5mnmaeZp5mXqZepl7mXuZe5l6mXqZeZl5mHiYeJd4l3iWeJZ4lXiUeJN5knmSeZF5kHmQeo97jnuNe4x7i3uKe4l7iHuHeod6hnmGeoV6hXqEeoR6hHqEe4R7hHuEfIR8hX2FfoV/hYCFgYWChYOFg4SEhIWDhoOHgoiCiYGKgYuBjICNgI2AjYCNgI6AjoGOgY6BjYKMg4yDi4SKhYmGiIaIh4eIhomFioWLhouGjIaMho2GjYeOh46IjomOio6Lj4uPi5CLkIuQjJCMkIyQjZGNkY6Sj5KPk5CUkJSPlY+Vj5aOlo6XjJiLmImZh5mFmoSagpqBmn+afZl8mXuYeph4mHeXd5Z2lneVd5R4lHiTeJN4knmSeZF5kXqQepB7kHyQfZB+kX+RgJGAkoGSgpKCkoKSg5KDkoOSg5KCkoKSgZOAk36TfZN8lHqUeZR4lHeVdpV1lXWVdJV0lHWUdZR2lHaUd5R3lHeUeJV4lXmWepZ6l3qXeph6mXqZeZl5mnmaeZp4m3ibeJt3nHecd5t3m3abdpt2mnWadZl1mXWYdZh2l3aXd5Z3lniVeZV5lHqUe5N7k3ySfJJ8kXyQfJB8j3yOfY5+jX+Mf4x/i3+Kf4p/in+Kf4p/in+KgIqAioGLgouCjIOMhI2FjYaNh46HjoeOh46GjoaOhY6FjoSOhI6FjYWNhY2FjYWNhYyFjIWMhYyFjIWMhYyFjIWMhYyFjIWMhoyHjYeNh42HjYeNh4yHjIiMiIuJi4qLi4yMjY2Njo6Pjo+Pj4+QkI+Rj5GPko+SjpKOko2SjJKLk4uTi5SKlImViZaIloeWh5aGloWWhJaCloGWgZaAlX+Vf5V+lH6UfZR9lH2UfZR8lHyUfJV8lXyVe5V7lnuWe5d7l3uXepd6l3qXepd6l3qXepd5l3qWepZ6lnqWepZ5lnmWeZZ4lniWeJd4l3mWeZZ5lnmWeZZ5lnmWeZZ6lnqWepd6l3qXeZZ5lnmVeZV5lHmUeZN6k3qSepJ6kXqQeo96j3qOe458jX2NfYx9i32KfYp9iXyIfIh7h3uHe4Z7hnuGe4Z7hXuFe4V7hXuEe4R8hHyEfYV+hX+FgIWChYOFhISFhIaDh4OIgomCi4KMgY2BjoCOgI6AjoCOgY6BjoGOgo6CjYOMg4uEioSKhYiGh4aGh4WIhYmEiYSJhIqFioWKhYuGjIaMh4yIjYmNio6KjouOi46Lj4uPjI+Mj4yPjZCNkI6RjpKPko+Tj5SPlY+Vj5aOlo2XjJiKmIiZhpmFmYSZg5mBmYCZfpl9mXyYeph5mHiXeJZ4lXiVeJR4lHiTeJN5knmSepJ6kXqRe5F8kX2RfZF+kX6Rf5GAkYGRgZGCkYKRgpGCkYKRgpGCkoGSgJN/k36TfJN7k3qUeJR3lHaUdZR1lHSUdJN1k3WTdZN2k3aTdpN2k3eTd5N3lHiUeJR4lXiVeJZ4lniXeJd4mHeYd5h3mHeYd5h3mHeYd5h3mHeXdpd2l3aWdpZ2lXaUdpN3k3eSeJJ4kXmRepB6kHuQe5B8j3yOfY59jX2NfYx+jH6Lfot/i3+KgIqAioCJgImAiX+Jf4p/in+Kf4p/i4CLgIyBjYKNg46FjoaOh46Hj4iOh46HjoaOho6FjYWNhY2FjYWNhYyGjIaMhoyGjIaMhoyFjIWMhYyFi4WLhYuFi4aLhouHi4eMh4yHjIeMiIuIi4iLiYuJi4qLiouLi4yMjY2Njo6PjpCPj42QjpGOkY+SjpKOk42TjJOLlIuUipSJlYmViJWHlYeWhpaFloSWg5aClYKVgZWBlICUgJR/k3+TfpN9k32TfJN8k3yTe5N7lHqUepR6lHqUepR6lXqVepV6lXqVepV6lXqUepR6lHqTepN6k3qTeZN5k3mTeZJ4kniTeJN4k3iTeJJ4kniSeZJ5knmSeZJ5knmTeZN5k3mTeJN5k3mSeZJ5knqRepF6kXuQe5B8j3yPfI58jnyNfIx8jH2Mf4x/i3+Lf4p+in6JfYl9iHyHfId7h3uHe4Z7hnuGe4Z7hXyFfIV8hX2EfoR/hICEgYSChIOEhYSGhIeEiIOKg4uDjIKNgo6Cj4KPgo+Cj4KOg46DjoOOhI2EjYSMhIuFioWJhoeGhoeFh4SIhIiDiIOIhImEiYWJhYqFioaLhouHi4eMiIyJjIqNio2LjYuOjI6Mjo2PjY+NkI6QjpGOko6TjpSOlI6VjpaOl42Xi5iKmIiYhpiFmYSZgpmBmYCYf5h+mHyYe5d6l3mXeZZ5lnmWeZV5lHmTeZN5k3mSepJ6kXuRfJF8kX2QfZB+kH+Qf5CAkICQgZCBkIKQgpGCkYKRgZKBkoCSf5J+kn2Se5J6knmTeJN3k3aTdZJ1knWSdZF1kXWRdZF1kXWRdZF1kXaSdpJ3kneSd5N3k3eTd5N3k3eTd5R2lHaUdpR2lHeUd5R3lHeUdpN2k3aTd5J3kneSd5F3kXiQeI94j3iOeY55jXqNeox7jHuMfIt8i32LfYt+in6Kfol/iX+Jf4iAiICIgIiAiICIgIh/iX+Jf4l/iX+Kfop/in+Lf4uAjIGMg4yEjYaNh42HjoiOiI6HjoeOho2GjYaNho2GjYaMhoyGjIaMhoyGjIaMhoyGi4aLhouGi4aKhoqGioaKhoqHioeKh4qHioiKiIqIiomKiYqKioqLiouLi4uMi4yMjYyOjI+Nj4yPjZCNkI2RjZKNkoyTjJOLk4qTipSJlImUiJWHlYaVhpWFlYWVhJWDlIOUgpSBlIGUgJR/lH+TfpN9k32TfJN8k3uSe5J7knqTepN6k3qTepN6k3qSepJ6knqSepJ6kXqRepF6kHqQepB6kHqQeY95j3iPeI94j3iOeI53jneOeI54jniOeI54jniOeI54j3iPeI93j3eQeJB4kHiQeJB5j3qPeo96j3uPe458jn2OfY19jX2MfYx9i36Lf4uAi4CLgIuAin+Kfop+iX2JfYh8iHyIfId8h3yHfId8h3yGfYZ9hX2FfoV/hYCEgYSCg4SDhYOGhIiEiYSKhIyEjYSNhI6Ej4SQhJCEkIWPhY+FjoWOho2GjYaMhouGiYeIh4eHhoiFiISIg4iDiYOJhIiEiYSJhImEioSKhYqFioaLh4uIi4mLioyKjIuNi42MjoyOjI+NkI2RjZGNko2TjZONlI2VjZaNl4yYi5iJmIiYh5iGmISYg5iCmICYf5h+mH2YfJd7l3qWepZ6lnqWepV6lXqUepR6k3qSe5J7kXuRfJF8kX2QfpB+kH+Qf4+Aj4CPgY+Bj4GPgZCCkIGQgZCBkICRf5F9kXyRe5F5kXiRd5F2kXWRdZB1kHSQdJB1kHSQdJB0kHWQdZB1kHWQdZB1kXaRdpF2kXaRdpF2kXaRdpF2kHaQdpB2kHaQdpB2j3aPd493jneOd453jXiNeIx4jHiMeYt5i3mLeop6inuKe4p7iXuJfIl8iH2IfYh+iH+If4h/h4CHgIeAh4CHgIeAh4CHf4d/iH+Ifoh+iH6Jfol+iX6Jf4mAioGKgoqEi4WLhoyHjIiMiIyIjYeMh4yHjIaMh4yHjIeMh4yHjIaMhouGi4aLh4uHioeKh4qHiYeJh4mHiYeJh4mHiIeIh4iIiIiIiIiIiYiJiYmJiomKiYuKi4qMioyKjYuOi46MjYqOi46Lj4yPjJCMkYuRi5KKkoqSiZOJk4iTiJSHlIaUhpSFlIWUhJSElIOVgpWClYGVgJSAlH+UfpR9k32TfJN8knuSe5J7knuRepF6kXqRepF6kHqQepB6j3uPe457jnuOe457jnqNeo16jXmNeYx5jHmMeYx4i3iLeIt3i3eLeIt4i3iLeIt4i3iMd4x3jHeMdox2jHaNd413jXeNeI14jXmNeo16jXuNfI18jX2Nfo1+jX6Mf4x/i4CLgIuBi4GLgYuAi4CLf4t/i36Kfop9iX2JfYh8iH2IfYh9h32HfoZ+hn6Ff4V/hYCFgYSDhISEhoSHhIiEiYSKhYyFjYWOhY6Fj4aQhpCHkIeQh4+Hj4eOh42IjIiLiIqJiYmIiYeJhomFiYSJg4mDiYOJg4mDiYOJg4mDiYSKhIqFioaKh4qIiomKiYuKjIqMi42LjouOjI+MkIyQjJGMkYySjJOMk4yUjJWLloqWipeJmIiYh5iGmIWYg5iCmICYf5h+l32XfZZ8lnuWepV6lXqVepV6lHuUe5N7knySfJF8kXyQfZB9kH6Pfo9/j3+OgI6AjoGNgY2BjYGNgY6BjoGOgI6Ajn+Pfo99j3uPeo95j3ePdo91j3WPdI9zj3OPc490jnSOdI50jnSOdI50jnSOdI50jnWOdY52jnaOdo52jnaNdo12jXaNdox2jHaMdot3i3eLd4p3ineKd4l4iXiIeIh5iHmHeYd6h3qHeod7hnuGe4Z7hnyGfIZ9hn2GfoZ+hn6Gf4Z/hn+GgIaAhoCGgIaAhn+Hf4d+h36HfYd9iH2IfYh+iH6If4iAiIGHgoeDiISIhYmGiYeKiIqIioeKh4qHioeKh4qHioeKh4qHioeKh4qHioiJiImIiYiJiImIiYiJiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiYiJiImJiomKiYuJi4mMioyKiomLiYyKjYqNio6KjoqPiZCJkImRiJGIkYeSh5KGk4aThZSFlISUhJSDlIOUgpSClIGUgZSAlICUf5R+k36TfZJ9knyRfJF8kHyQfI97j3uOe457jnuNe417jXuNe4x7jHuMe4t7i3uLeot6inqKeYp5inmKeYl4iXiJeIl4iXeJd4l3iXeJd4p3inaKdop2inaKdop2inaKdop2i3aLd4t4i3mLeYt6i3uMe4x8jH2Mfo1/jH+MgIyAjIGMgYuCi4KLgYuBi4CLgIuAi3+Lf4p+in6Kfol+iX6Jfoh+iH6Hf4d/hoCGgIaBhYKFg4WEhYWFhoWHhYiFiYaKhoyGjYeOh4+Hj4eQh5CIkIiQiI+JjomNio2KjIqLi4qLiYuIi4eLhouFi4SLhIuDi4OKg4qDioOKg4mEiYSJhImFioaKh4qHioiLiIuJjImMiY2KjoqOio+Lj4uQi5CLkIuRi5KLk4uTipSKlYmViZaIloeXh5eGl4WXg5eCl4GXgJd/ln+WfpZ9lXyVfJV8lXuUe5R8k3ySfZJ9kX2QfZB9j36Ofo5/jX+Nf4yAjICMgIuBi4GLgYuBi4GLgYyBjICMgIx/jH6NfY18jXqNeY14jXaNdY11jXSMc4xyjHKMcoxzjHOMc4xzjHOMc4xzjHOMdIt0i3SLdYt1i3aKdop2inaKdol2iXaJdol2iHeId4d3h3eHd4Z3hniFeIV4hXiEeYR5g3mDeYN6g3qDeoN7g3uDe4N7g3uDfIN8g32DfoN+hH6Ef4R/hH+Ef4V/hX+Ff4V/hn+Gf4Z+hn2GfYZ9hn2GfYZ+hX6Ff4WAhYGFgoWDhYSFhYWFhoWGhoeGh4eHh4eHiIeIh4eHh4eHiIeIh4iHiIeIh4iHiIeIh4iHiIeIh4iHiIeIh4iHiIeIh4mHiYeJh4iIiIiIiIiIiIiIiIiIiIiIiIiIiImIiYmKiYqJiYiKiIqIi4iLiIyIjYiNiI6IjoePh4+GkIaQhZGFkYWShJKEkoSThJODk4OTgpOCk4GTgZOBk4CTgJN/kn+Sf5J+kX6RfpB9kH2PfY99jn2OfY19jXyMfIx8jHyMfIt8i3yLfIp8inuJe4l6iXqJeol5iXmJeIl4iXiJd4l3iXeJd4l2iXaJdol2iXaJdol1iXWJdYl1iXWJdYl1iXaKdop3ineKeIt5i3mLeot7jHyMfYx+jH+MgIyBjIGMgoyCjIKMgoyCjIGMgYuAi4CLgIp/in+Kf4p/in+Jf4l/iX+IgIiBh4GHgoaChoOFhIWFhYWFhoaHhoiGiYaKh4uHjYiOiI+Ij4iQiZCJkImPiY6KjoqNi4yLjIyLjIqMiYyIjIeMhoyGjIWLhYuFi4SLhIuEi4SKhIqFioWKhYqGioaKh4qHi4eLh4yIjIiNiI2JjYmOio6KjoqPio+KkIqQipGJkomSiZOJk4iUiJSIlIeVhpWFlYSVg5WClYGVgZWAlICUf5R+k36TfpJ9kn2RfpF+kH6Qf49/jn+Of41/jYCMgIyAi4CLgIuBioGKgYqBioGKgYqBioGKgYqAioCKf4t+i32LfIx7jHmMeIx3jHaMdYt0i3OLcotyi3GLcYtyi3KLcopyinKKc4lziXOJdIh0iHSIdYd1h3aHdod2h3aGdoZ2hneFd4V3hXeEeIR4g3iDeIN4gniCeIF5gXmBeYB5gHmAeX96f3qAeoB6gHqAeoB6gHuAe4B8gXyBfYF9gn6CfoJ+gn6DfoN+g36EfoR+hH6EfoR+hH2EfYR9g36DfoN/g3+CgIKBgoGCgoKDgoODhIOFg4WDhYOFg4aEhoSGhIeEh4SHhYiFiIWIhYiFiIaIhoiGiIaIhoiGiIaIhoiGiIaIhoiGiIaJhomGiYaJh4mHiIeIh4iHiIeIh4iIiIiIiIiIiIiIiYiJiImIiYeKh4qHioeLhoyGjIaNho2GjoaOho+Fj4WQhJCEkIORg5GDkYORgpKCkoKSgpKCkoGSgZKBkoCSgJKAkYCRf5F/kX+Qf5B/kH+Pf49+j36Ofo5+jX6NfY19jH2MfYt9i32LfYp9inyKfIp7inqKeop5inmKeIp4ineKd4p3inaKdop2inaKdot2i3WLdYt1i3WLdYp0inSKdIp0inWKdYp2inaKd4p4iniLeYt6i3qLfIx9jH6MgIyBjIGNgo2CjYKNgo2CjYKNgoyBjIGMgYyAi4CLgIuAioCKgImAiYGJgYiCiIOIg4eEh4SHhYeFh4aHhoeHh4iHiYeKh4uIjIiNiY6Jj4qQipCKkIuPi46LjYuNjIyMi4yLjIqMiYyIjIeMhoyGjIaMhYyFjIWMhIyEjISMhIyFjIWLhYuGi4aLh4yHjIeMh4yHjYeNiI2IjYmNiY6JjoqPio+JkImQiZGIkYiSiJKIkoiSh5OHk4aThpOFk4STg5ODk4KTgpKBkoGSgJGAkX+Qf5B/j3+Pf46AjoCNgI2AjYCMgYyBi4GLgYuBioGKgYqBioKKgoqCiYKJgYmBioGKgIqAin+Kfot9i3yLe4t6i3mLeIt3i3aLdYt0i3OLcotxinGKcYpxiXGJcolyiHKIc4dzh3SGdIZ1hnWFdYV2hXaEdoR2hHeDd4N3g3eCeIJ4gniBeIF4gHiAeYB5f3l/eX55fnl+eX16fXp9en15fXl9eX15fXl9eX15fXl9en56fnt+e398f3x/fIB9gH2AfYF9gX2BfYF9gn2CfYJ+gn6BfoF+gX6Bf4F/gYCBgYGBgYKBgoGCgYOBhIGEgYWBhYGFgYaBhoGGgYaCh4KHgoeCh4KHg4iDiIOIg4iDiISIhIiEiYSJhImEiYSIhYiFiIWIhYiFiIaJhomGiIaIhoiGiIaIh4iHiIeIh4iIiIiIiIiJiImHiYaKhoqGi4WLhYuFjIWMhY2EjYSOhI6Ej4SPg4+DkIOQgpCCkIKQgZGBkYGRgZGBkYGRgZGBkYGRgZGBkYGQgZCAkICQgI+Aj4CPgI+Ajn+Of45/jn+Nf41/jX+Nf41+jH6MfYx9jHyMfIx7jHqMeox5jHiMeIx3jHeNd412jXaNdo12jHaMdox1jXWNdYx1jHWMdIx0jHSLdIt0i3SKdYp1inaKdop3ineKeIp4i3mLeot8i32Mfox/jYCNgI2BjYKNgo2CjYKNgo2CjYKNgo2CjIKMgouCi4KKgoqCioKJg4mDiISIhIiFiIWIhoiGiIaIh4iHiIiIiIiJiYuJjIqNio2LjouPjI+Mj4yPjI6NjY2NjYyNjI2LjYqNiY2IjYeNh42GjYWNhY2FjYSNhI2EjYSNhY2FjYWNho2GjYaNho2GjoeOh46HjoiOiI6IjomOiY+Jj4mPiY+JkIiQiJCIkIiQiJGIkYeRh5GHkoaShpKFkoWShJKEkoORg5GCkYKRgpCBkIGPgY+BjoGOgY2BjYGNgoyCjIKLg4uDi4OLg4qDioOKg4qCioKKgoqCioKKgYqBi4CLgIt/i36LfYt8i3uLeot5i3iLd4t2i3WLdItzi3KKcopxiXGJcYhxiHKIcodyh3OGc4Z0hXSEdYR1hHWDdoN2g3aCdoJ3gneBd4F3gXiAeIB5f3l/eX55fnl9eX16fXp8enx6fHp8ent6e3p7ent5e3l7eXt5e3h7eHt4e3h7eHt5fHl8eX16fXp9e357fnx/fH98f3x/fIB8gH2AfYB9gH6Afn9+f39/f3+Af4B/gX+Bf4J/gn+Df4N/g3+EgISAhYCFgIWAhoCGgIaBhoGHgYeBh4GHgYeBh4GHgYiBiIKIgoiCiIKIg4iDiIOIg4eEh4SHhIeFiIWIhYiGiIaIhoiGh4eHh4eHh4eHh4eIh4iHiIeJhomGioWKhYqEi4SLhIyEjIOMg42DjYONgo2CjoKOgo6Cj4GPgY+Bj4GPgY+Bj4CPgI+Bj4GQgZCBkIGQgpCCkIKPgo+Cj4KPgY+Bj4GPgY6BjoCOgI6Ajn+Of45/jn+Of45/jn6Ofo59jnyOfI57jnuOeo55jniOeI53jnaOdo52jnaOdY51jnWOdY51jXWNdI10jXSNdI10jHSMdIx0i3WLdYt1inWKdop2inaKd4p3iniKeYp6inuLfIt9i36Mf4yAjICMgYyCjYKNgo2DjYONg4yDjIOMg4uDi4OLhIqEioSKhIqEiYWJhYmGiYaJh4mHiYeJh4mIiYiJiYmJioqKi4qMi4yLjYyOjI6Njo2Ojo6OjY6NjoyOi4+Lj4qPio+Jj4iPh4+HjoaOhY6EjoSOhI6EjoSOhI6FjoWOhY6GjoaOho6Gj4ePh4+Ij4iPiI+Ij4iPiI+IkIiQiJCIkIiQiJCIkIiQiJCHkIeQh5GHkYaRhpGGkYWRhZGEkYSRg5CDkIOQg4+Dj4OOg46DjoONg42DjIOMg4yDjIOLhIuEi4SLhIuEi4SLg4uDi4KLgouCi4GMgYyBjICMf4x+jH6MfYx7jHqMeYx4jHeLdot1i3WLdItzinOKcolyiHKIcohyh3KGc4ZzhXSEdIR1hHWDdYN1gnaCdoJ2gXeBd4B3gHeAeH94f3l+eX55fnp9en17fHt8e3x7e3p7ent6e3p7ent6e3p7eXt5e3l7eXt4e3h7eHt4e3h7d3t3e3h8eHx4fHh9eX15fXp+en57fnt+e358fnx+fH59f31/fn9+f39+f36AfoF+gX6CfoJ+g36DfoN/g3+Ef4R/hH+Ff4WAhoCGgIaAh4CHgIeAh4GHgYeBiIGIgYiBiIGHgoeCh4KHg4eDh4SHhIeEh4SGhYaFh4WHhYeGh4aHhoeGhoeGh4aHhoeGiIaIhoiGiYaJhYmFioSKg4qDi4OLg4uDi4OMgoyCjIKMgYyBjIGNgI2AjYCNgI2AjYCOgI6BjoGOgY6BjoGOgY6BjoKOgo6CjoKOgo6CjoKOgo+Cj4GPgY6BjoGOgI6AjoCOf49/j3+Pf49/kH6QfpB9kHyQfJB7kHqQepB5kHiQd5B3kHaQdo91j3WPdY91j3WPdY91jnWOdI50jnSNdI10jXSMdIx1jHWLdYt1i3aKdop2iXaJdol3iXeJeIh5iXqJe4l8iX2JfYp+in+KgIqAi4GLgouCi4OLg4uDi4SLhIuFi4WLhYuFi4aKhoqGioaKhoqGioeKh4qHioeKiIqIioiLiYuJi4qLi4uLjIuMjI2MjY2OjY6Nj42PjY+MkIyQi5CKkIqQiZGJkYiRiJGHkYaRhpGFkIWQhJCEj4SPhY+Fj4aPho+Gj4aOho6HjoeOh46HjoeOiI6IjoiOiI+Ij4iPiI+Ij4iPiI+Ij4iPh4+Hj4ePh5CHkIaQhpCGkIaQho+Fj4WPhI+EjoSOhI6EjoSOhI2EjYSNhIyEjISMhIyEjISMhIyEjISMhIyEjIOMg4yDjIKMgoyCjIGMgYyAjICMf4x+jH2MfIx7jHqMeYx4jHeLdot2i3WKdYp0inSJdIhziHOHc4Z0hnSFdIV0hHWEdYN1g3aCdoJ2gXeBd4B3gHd/eH94f3h+eH55fnl9en17fXt9e3x7fHt8e3x7fHt8enx6fHp8eXx5fHl8eXx5fHl8eHx4fHh8eHx4fHd8d3x3fHd8d3x3fHd8eHx4fXl9eX15fXp9en57fnt+e358fn1+fX5+fn9+gH6AfoF+gX6CfoJ+g36DfoN+g3+Ef4R/hH+Ff4V/hYCGgIaAhoCHgIeBh4GHgYeBh4KHgoeCh4OHg4aDhoOGhIaEhoSGhYaFhoWGhYaFhoaGhoaGhoaGhoaHhoeGh4aHhoiFiIWIhYiFiYSJhImEioOKgoqCioKKgouCi4KLgouCi4GMgYyBjIGMgIyAi4CLgIuAi4CLgIuAi4CLgYyBjIGMgYyBjIGMgo2CjYKNgo2CjYKNgo6CjoGOgY6BjoCOgI6Ajn+Pf49/j36PfpB+kH2QfZB9kHyQfJB7kHqQepB5kHiQeJB3kHaPdo92j3WPdY91j3WPdI50jnSOdI50jXSNdIx0jHWLdYt1inWKdop2iXaJdol2iHeId4h3iHeHeId4h3mHeod7h3uHfId9h36If4h/iICIgYmCiYKJg4mDiYSJhImFiYWKhYqGioaKh4qHioeKh4qHioeLh4uHi4eLiIuIjIiMiYyJjIqMio2KjYuNi46LjoyPjI+MkIyQjJGLkYuRipGKkYqRiZGJkYmRiZGIkYiRh5GHkYaQhpCGj4aPho6GjoaOh46HjYeNh42HjYiNiI2IjYiNiI2IjYiNiI2JjYiNiI2IjYiNiI6IjoiOiI6IjoiOh46HjoeOh46HjoeOho2GjYaNhY2FjYWMhYyFjIWMhYyFjIWMhYyFi4WLhYuFi4WMhYyFjISMhIyEjIOMg4yDjIKMgoyCjIGMgYyAjICMf4x+jX2NfI17jHqMeYx4i3iLd4t2inaKdol1iXWIdYh1h3WHdYZ1hXaFdoR2hHaDdoN3gneCd4F3gXeBeIB4gHh/eH95f3l+eX56fnp+en17fXt9e317fXt9e316fXp9en15fXl9eX54fnh+eH54fnh+eH54fnd+d353fnd+d353fnd9d313fXd9eH14fXh9eH15fXl9eX16fXp9e318fXx9fX1+fX99f32AfYF9gX6CfoJ+gn6DfoN+g36Ef4R/hH+Ef4V/hYCFgIaAhoCGgYaBhoGGgYeChoKGg4aDhoOGhIaEhoSFhIWFhYWFhYWFhYWFhoWGhYaFhoWGhYeFh4WHhYeFh4WIhYiFiISIhIiEiYOJg4mDiYKJgomBiYGJgYqBioGKgYqBioGKgIuAi4CLgIuAi4CLgIqAioCKf4p/ioCKgIqAi4CLgIuAi4CLgYyBjIGMgYyBjYGNgY2BjoGOgY6AjoCOgI5/jn+Pfo9+j36PfY99j32PfI98kHuQe5B6kHqQeZB5kHiQd493j3aPdo92j3WPdY51jnSNdI10jXWMdYx1i3WLdop2inaKdol2iXaJdol2iHaId4h3h3eHd4d3h3iHeIZ4hnmGeYV6hXuFe4V8hX2GfYZ+hn+Gf4aAhoGGgYaChoOHg4eEh4SIhYiFiIaJhomGiYaJh4qHioeKh4qHioiLiIuIi4iLiIyIjIiMiY2JjYmNio6KjouOi4+Lj4uPi5CLkIuQi5CLkIqPio+Kj4qPiY+Jj4mPiY+Jj4iOiI6IjoiNiI2IjYiNiIyIjIiMiIyIjImMiIyIjIiMiIyJjImMiYyJjImMiYyJjImMiYyJjImMiYyJjImMiIyIjIiMiIyIjIiMh4yHjIeMh4uGi4aLhouGi4WLhYuGi4aLhouGi4aLhouGi4WLhYuFjISMhIyEjIOMg4yDjIKMgoyCjIGMgYyAjH+Mfox+jH2MfIx7jHqLeot5i3mLeIp4ineJd4l2iHaIdod2h3aGd4Z3hXeFd4R3hHeDeIN4gniCeIJ4gXiBeYF5gHmAeYB5f3p/en96f3p/en97f3t/e396f3p/en96f3l/eX95f3h/eH94f3d/d393f3d/d393f3Z/dn92f3Z/d353fnd+d353fnh+eH54fXh9eH14fXh9eX15fXp9e3x7fHx8fXx+fH59f32AfYB9gX2BfYJ+gn6CfoN+g36DfoR/hH+Ef4R/hX+FgIWAhYCFgIWBhYGFgYWChYKFgoWDhYOFg4WEhYSEhISEhIWEhYSFhIWEhYSGhIaEhoSGhIaEhoSHhIeEh4SHhIiEiISIg4iDiIOIgomCiIGIgYiBiIGIgImAiYCJgImAiYCJgImAiYCJgImAiYCJgImAioCKgIp/in+Kf4p/in+Kf4p/i3+Lf4t/i3+Mf4x/jH+Nf41/jX+Nf41/jn+Of45+jn6Ofo59jn2OfY58jnyOfI57jnuOeo56jnmOeY54jniOd453jneNdo12jXaNdYx1jHWLdYt1i3aKdop2iXaJdol2iXeId4h3iHeId4d3h3eHd4Z3hniGeIZ4hniGeYV5hXmFeoV6hHqEe4R7hHyEfYR9hH6Ef4R/hICFgYWBhYKFg4WDhYSGhIaEhoWHhYeFh4aHhoiGiIaIh4iHiIeJh4mHiYeJh4mHioeKiIqIioiLiYuJi4qLioyKjIuMi4yLjIuMi4yLjIuMi4yLjIuMi42LjIqMioyKjIqMioyKjIqMioyKjIqMioyJjImLiYuJi4mLiYuJi4mLiYuJi4mLiYuJi4mLiouKi4qLioyKjIqMioyKi4qLiouKi4mLiYuJi4mLiYuIi4iLiIuIi4eLh4uHi4eLhoqGioaKhouGi4aLhouFi4WLhYuEjISMhIyDjIOMg4yDjIOMgoyBjIGMgIyAjH+Mfox+jH2MfIt8i3uLe4p6inqKeYl5iXiJeIh4iHiHeId4h3iGeIZ4hXiFeIR5hHmDeYN5gnmCeYJ5gnmBeYF5gXmBeoF6gXqBeoF6gXqBeoF6gXqBeoF6gXmBeYF5gXmBeIF4gXiBd4F3gHeAd4B3gHaAdoB2gHaAdoB2f3Z/dn93f3d/d393f3d+d354fnh+eH54fnh9eX15fXp9en17fHx8fXx9fH59fn1/fX99gH2AfYF9gX2CfoJ+gn6DfoN/g3+Ef4R/hICEgISAhYCFgIWBhYGFgYSChIKEgoSChIOEg4SDhIOEhIOEg4SDhIOEg4WDhYOFg4WDhYOGg4aDhoOGg4aDh4OHg4eDh4OHg4iCiIKIgoiCiIGIgIiAiICIgIiAiICIf4h/iH+If4h/iH+If4l/iX+Jf4l/iX+Jf4l/in+Kf4p/in6Kfot+i36Lfot+i36Lfox+jH6Mfox+jH6Mfox9jX2NfY19jX2NfY19jX2NfY18jXyNfI17jXuMeox6jHmMeYx5jHiMeIx4i3eLd4t3ineKd4p3iXeJd4l3iHeId4h3h3eHd4d3h3eHd4d3hneGd4Z3hniFeIV4hXiFeIV5hXmEeYR5hHqEeoR6hHqDe4N7g3yDfIN9g32DfoN/g3+DgIOBhIGEgoSChIOEg4SEhYSFhYWFhYWFhYaGhoaGhoaGhoaGh4aHhoeGh4eHh4eHiIeIh4iHiIeJh4mIiYiKiIqIi4iLiYuJi4mLiYuKi4qLiouKi4qLiouKi4qLiouKi4qLiouKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi4qLiouKi4uLi4uLiouKi4qLiouKi4mLiYuJi4mLiIuIi4iLh4uHi4eLh4uHi4aLhouFi4WLhYuEi4SLhIuEi4OLg4uDi4OLgouCi4GLgIuAi3+Lf4t+i36Lfot9in2KfIp8inuJe4l6iXqIeoh6h3qHeYZ5hnmFeoV6hXqEeoR6hHqDeoN6g3qDeoN6g3qCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ5gnmCeYJ5gnmCeIJ4gniCeIJ3gneCd4J3gnaCdoJ2gXaBdoF2gXaBdoB2gHaAdoB2gHd/d393f3d/d394fnh+eH54fnl+eX15fXp9en17fXt9fH19fX19fn1+fX99f31/fYB9gH6AfoF+gX6Bf4J/gn+Df4OAg4CDgISAhIGEgYSBhIGEgoSCg4KDgoODg4ODg4ODg4SDhIOEg4SDhIOEg4SDhYOFgoWChYKFgoWChoKGgoaDhoOGg4eCh4KHgoeCh4KHgYeBh4CHgId/h3+If4h/iH+If4h/iH+Ifoh+iH6Ifol+iX6Jfol+iX6Jfol+in2KfYp9in2KfYt9i32LfYt9i32LfYt9i32LfYt9i32LfYt9i32LfYt9i3yLfIt8i3yLfIt8i3yLfIt8i3uLe4t7inqKeop6inmJeYl5iXmJeYh4iHiIeIh4h3iHeId4h3iHeIZ4hniGeIZ4hXiFeIV4hXiFeIR4hHiEeIR5hHmEeYN5g3mDeYN6g3qCeoJ7gnuCe4J8gnyCfIJ9gn2CfoJ+gn+CgIKAgoGCgYKCgoKCg4KDgoSDhIOFg4WDhYOGg4aDhoOGhIeDh4OHg4iDiISIhIiEiISJhImEiYSJhYmFiYWJhYqFioWKhoqGi4aLhouHi4eLh4uHjIeMh4yHjIiMiIyIjIiMiIuIi4iLiIuIi4iLiIuIi4iLiIuIi4iLiIuIi4iLiIuIi4iLiIuJi4mLiYuJi4mLiYuJi4mLiYuJi4mLiouKi4qLiouKi4qKioqKioqKi4mLiYuJi4mLiIuIi4iLh4uHioeKh4qGioaKhYqFi4WLhIuEi4OLg4uDi4KLgouBi4GLgYuAi4CLgIt/i3+Lf4p+in6Kfop9iX2JfYh8iHyHfId8h3uGe4Z7hnuFe4V7hXuEe4R7hHuEe4R6hHqEeoR6g3qDeoN6g3qDeoN5g3mDeYN5g3mDeYN4g3iDeIN4g3iDd4N3g3eDd4N3g3aDdoN2g3aCdoJ2gnaCdoJ2gnaBdoF2gXaBdoB3gHeAd4B3gHd/eH94f3h/eH95f3l/eX55fnp+en57fnt+fH58fnx+fX59fn5+fn9+f39/f39/f39/gICAgICAgYCBgIGBgoGCgYKBgoKCgoKCgoKDg4ODgoOCg4KEgoSChIKEgoSChIKEgoWChYKFgoWChYKFgoWChYKGgoaChoKGgoaChoKGgoaCh4GHgYeBh4GHgYeAiH+If4h/iH6Ifoh+iH6Ifoh+iH6Ifol9iX2JfYl9iX2JfYl9iX2KfYp8inyKfIp8inyKfIp8inyKfIp8inyKfIp8inyKfIp8inyKfIp8inyKfIp8inyKfIp8inyKfIp8inyKfIp8inyKfIp7iXuJe4l7iXuJeoh6iHqIeoh6iHqHeYd5h3mHeYZ5hnmGeYZ5hXmFeYV5hXmFeYR5hHmEeYR5hHmDeYN5g3qDeoJ6gnqCeoJ6gXuBe4F7gXuBfIB8gHyAfIB9gH2AfoB+gH+Af4CAgICAgYCBgIKAgoCDgIOAhICEgYWBhYGFgYaBhoGGgYeBh4GHgoiCiIKIgomCiYKJgomCiYOJg4qDioOKg4qDioOKg4qDi4OLg4uEi4SLhIuEjISMhIyFjIWMhYyFjIWMhYyFjIWMhYyFjIaMhoyGjIaMhoyGjIaMhoyGjIeMh4yHjIeMh4yHjIeMh4yHjIiMiIyIjIiMiIyIjIiMiIyJjImLiYuJi4mLiYuKioqKioqKioqJiomKiYqJiomKiIqIioiKh4qHioaKhoqGioWKhYqEioSKg4qDioKKgoqCioGKgYqBioCKgIqAiYCJf4l/iX+Jf4l/iH6Ifoh+iH6IfYd9h32HfYd8h3yGfIZ8hnyGe4Z7hnuGe4Z6hXqFeoV6hXqFeoV5hXmFeYV5hXmFeIV4hXiFeIV4hXeFd4V3hHeEd4R2hHaEdoR2hHaEdoN2g3aDdoN2g3aDdoJ2gnaCdoJ2gnaCd4F3gXeBd4F3gXiBeIF4gXiAeYB5gHmAeYB6gHqAeoB6gHuAe4B7gHyAfIB8gH2AfYB9gH6AfoB+gH6Af4F/gX+BgIGAgYCBgIGAgoGCgYKBgoGCgYOBg4GDgYOBg4GEgYSBhIGEgYSBhYGFgYWBhYGFgYWBhYGGgYaBhoGGgYaBhoGGgYeBh4GHgYeBh4GHgYiAiICIgIiAiH6Ifoh+iH6IfYh9iH2IfYh9iH2IfYh9iH2IfIh8iHyIfIh8iHyIfIh8iHyIfIh8iHyIe4h7iHuIe4h7iHuIe4h7iHuIe4h7iHuIfIh8iHyIfIh8iHyIfIh8iHyIfIh8iHuIe4h7iHuIe4h7iHuIe4h7iHuIe4h7iHuIe4h7h3uHe4d7h3uGe4Z7hnuFe4V7hXuFe4V6hHqEeoR6g3uDe4N7g3uCe4J7gnuCe4F7gXuBfIF8gHyAfIB8gHx/fH99f31/fX99f35/fn9/f39/f3+AfoB+gX6BfoJ+gn+Df4N/hH+Ef4V/hX+Gf4Z/hn+Hf4eAh4CIgIiAiICJgImAiYCJgYqBioGKgYqBioGKgYqBi4GLgYuBi4GLgYuBi4GMgYyCjIKMgoyCjIKMgoyDjIOMg4yDjIOMg4yDjIOMhIyEjISMhIyEjISMhIyEjISMhIyFjYWNhY2FjYWNhY2GjYaNho2GjYaNh4yHjIeMh4yIjIiMiIyIi4iLiIuJi4mLiYuJiomKiYqJiomKiYmKiYqJioiKiIqIioeKh4qGioaKhYqFioSKhIqEioOKg4qCioKKgoqBioGKgYqBiYCJgImAiX+Jf4l/iX+Jf4l+iX6Jfol+iH6IfYh9iH2IfIh8iHyIe4h7iHuIeoh6iHqIeoh5iHmHeYd5h3mHeId4h3iHeId4h3eHd4d3hneGd4Z2hnaGdoZ2hXaFdoV2hXaFdoV2hHaEdoR2hHaEdoR2hHaDdoN2g3aDdoN3g3eDd4J3gneCeIJ4gniCeIJ5gnmCeYJ6gnqCeoJ6gXqBe4F7gXuBe4F8gXyBfIF8gX2BfYF9gX6CfoJ+gn6Cf4J/gn+Cf4J/g3+Df4OAg4CDgIOAg4CDgISAhICEgISAhICEgISAhICEgIWAhYCFgIWAhYCFgIWAhoCGgIaAhoCGgIeAh4CHgIeAh4CHf4h/iH+If4h/h32HfYd9h32HfYd8h3yHfId8h3yHfId8h3yHfId8h3yHfId7h3uHe4d7h3uHe4d7h3uHe4d7h3uHe4d7h3uHe4d7h3uHe4d7hnuGe4d7h3uHe4d7hnuGe4Z7hnuGe4Z7hnuGe4Z7hnuGe4Z7hnuGe4Z7hnuGe4Z7hXuFe4V8hXyFfIV8hXyFfIR8hHyEfIR8hHyDfIN8g3yDfIJ8gnyCfIJ8gXyBfYF9gX2BfYB9gH2AfYB9gH5/fn9+f35/fn9+fn5+f35/fn9+f36AfoB9gH2BfYF9gn2CfYJ9g32DfYR9hH2FfYV9hn2GfYZ9h32Hfoh+iH6Ifol+iX6Jfol+in6Kfop+in6Lfot/i3+Lf4t/i3+Mf4x/jH+Mf4yAjICMgIyAjYCNgI2BjYGNgY2BjYKNgo2CjYKNgo2CjYKNg42DjYONg42DjYONg42DjYONg42EjYSNhI2EjYSNhY2FjYWNhY2FjYaNho2GjYaNh42HjYeMh4yHjIiMiIyIjIiLiIuIi4mLiYuJiomKioqKiYqJiomKiIuIi4eLh4uHi4aLhouFi4WLhYuEi4SLhIuDi4OLg4uCi4KLgouBi4GLgYuAi4CLgIuAi3+Lf4t/i36Lfot+i36LfYt9i32LfIt8i3yLe4t7inuKeop6inqKeYp5inmKeYp5iniJeIl4iXiJeIl3iXeId4h3iHeId4h2h3aHdod2h3aHdoZ2hnaGdoZ2hnaFdoV2hXaFdoV2hXaFdoR2hHeEd4R3hHeEd4R3g3eDeIN4g3iDeIN4g3mDeYN5g3mDeoN6g3qDeoN7g3uDe4N7g3uDfIN8g3yDfIN8g32DfYN9g32DfYN9g36DfoN+g36DfoN+g36Df4N/hH+Ef4R/hH+Ef4R/hH+Ef4R/hH+Ff4V/hX+Ff4V/hX+Ff4V/hX+Gf4Z/hn+Gf4Z+hn6GfoZ+h36Hfod+h36Hfod9hnyGfIZ8hnyGfIZ7hnuGe4Z7hnuGe4Z7hnuGe4Z7hnuGe4Z7hnuGe4Z7hnuGe4Z7hnuGe4V6hXqFeoV6hXqFeoV6hXqFeoV6hXqFeoV6hHqEeoR6hHqEeoR6hHqEeoN6g3uDe4N7g3uDe4N7g3uCe4J7gnuCfIJ8gnyCfIJ8gXyBfIF9gX2BfYF9gX2BfYF9gH2AfYB9gH2AfYB9f31/fX9+f35/fn9+f35/fn5+fn9+f35/fn9+f35/fYB9gH2AfYB9gH2BfYF9gXyBfIJ8gnyCfIN8g3yDfIR8hHyFfIV8hXyGfIZ8hnyHfId8iHyIfIh8iXyJfIl8iXyKfIp8inyKfYt9i32LfYt9i32Mfox+jH6Mfox+jH+Mf4x/jH+Nf42AjYCNgI2AjYCNgY2BjYGNgY2BjoKOgo6CjoKOgo6CjoOOg46DjoOOg46DjoOOhI6EjoSOhI6EjoWOhY6FjoWOhY6GjoaNho2GjYeNh42HjYeNh42IjIiMiIyIjImMiYuJi4mLioqKioqKiomLiYuJi4iLiIuIi4eMh4yHjIaMhoyGjIWMhYyFjISNhI2EjYSNg42DjYONgo2CjYKNgY2BjYGNgI2AjYCNf41/jX+Nfo1+jX6NfY19jX2NfI18jXyNfIx7jHuMe4x6jHqMeox6jHmLeYt5i3mLeYt4i3iKeIp4iniKd4p3iXeJd4l3iXeJd4h3iHaIdoh2iHaHdod2h3aHdod2hnaGdoZ2hnaGdoV3hXeFd4V3hXeFd4V3hHeEeIR4hHiEeIR4hHiEeYR5g3mDeYN5g3mDeoN6g3qDeoN6g3uDe4N7g3uDe4N7g3yDfIN8g3yDfIN8g32DfYN9g32DfYN9hH2EfYR9hH2EfYR9hH2EfYR9hH2EfYR9hH2EfYR9hX2FfYV9hX2FfYV9hX2FfYV9hX2FfYV9hX2GfYZ9hn2GfIZ8hnyGfIZ8hHuEe4R7hHuEeoR6hHqEeoR6g3qDeoN6g3qDeoN6g3qDeoN6g3qDeoN6g3qDeoN6g3qDeoN6gnqCeoJ6gnqCeoJ6gnqCeoJ6gXqBeoF6gXqBeoF6gXqBeoB6gHuAe4B7gHuAe4B7gHt/e397f3t/fH98f3x/fH58fnx+fH58fn1+fX59fn19fX19fX19fX1+fX59fn1+fH58fnx+fH58fnx+fH98f3x/fH98f3yAe4B7gHuAe4B7gXuBe4F7gXuCe4J7gnuCe4N7g3qDeoR6hHqEeoV6hXqFeoV6hnqGeoZ6h3qHeod6iHuIe4h7iXuJe4l7iXuKe4p7inyKfIp8inyLfIt8i3yLfYt9i32LfYx9jH6Mfox+jH6Mfox/jX+Nf41/jX+NgI2AjYCNgI6AjoGOgY6BjoGOgo6CjoKOgo6CjoOOg46DjoOOg46EjoSOhI6EjoSOhY6FjoWOhY6GjoaOho2GjYeNh42HjYiNiI2IjIiMiYyJjImMiYuKi4qLiouKiouKi4qLiouJi4mMiYyIjIiMiIyIjIeNh42HjYaNho2GjYaNhY2FjYWOhI6EjoSOhI6DjoOOg46CjoKOgo6BjoGOgY6AjoCOgI5/jn+Of45+jn6Ofo59jn2OfY59jnyNfI18jXyNe417jXuNeo16jHqMeox6jHmMeYx5jHmLeYt4i3iLeIt4i3iKeIp4ineKd4p3iXeJd4l3iXeId4h3iHeId4h3h3eHd4d3h3eHd4Z3hneGd4Z3hneGd4V3hXeFeIV4hXiFeIV4hXiEeIR4hHiEeYR5hHmEeYR5hHmEeYN5g3mDeoN6g3qDeoN6g3qDeoN6g3uDe4N7g3uDe4N7g3uDe4N7g3uDe4N8g3yDfIN8g3yEfIR8hHyEfIR8hHyEfIR8hHyEfIR7hHuEe4R7hHuEe4R7hHuEe4R7hHuEe4R7hHuEe4R7hHuEe4R7gXqBeoF6gXqBeoF6gXqBeoF6gXqAeoB6gHqAeoB6gHqAeoB6gHqAeoB6gHp/en96f3p/en96f3p/en96f3p/en56fnp+en56fnp+en56fnt+e317fXt9e317fXt9e317fXt8fHx8fHx8fHx8fHx8fHx8e317fXt9e317fXt9e317fnp+en56fnp+en56fnp/en96f3p/en96f3p/eoB5gHmAeYB5gHmAeYF5gXmBeYF5gXmCeYJ5gnmCeYN5g3mDeYN5hHmEeYR5hHmFeYV5hXmFeYZ5hnmGeYd5h3mHeYd5iHmIeoh6iHqJeol6iXqJeol6inuKe4p7inuKe4t7i3yLfIt8i3yLfIt8jH2MfYx9jH2MfYx+jH6Mfo1+jX6Nf41/jX+Nf41/jYCNgI2AjoCOgY6BjoGOgY6CjoKOgo6CjoOOg46DjoOOhI6EjoSOhI6FjoWNhY2FjYaNho2GjYaNh42HjYeNh4yIjIiMiIyIjImMiYuJi4mLiouKi4qKioqKiouKi4qLiYuJi4mMiYyIjIiMiIyIjIeNh42HjYeNho2GjYaNhY2FjoWOhY6EjoSOhI6DjoOOg46CjoKOgo6CjoGOgY6BjoCOgI6Ajn+Of45/jn6Ofo5+jn6OfY59jn2OfY58jXyNfI18jXuNe417jXuNe4x6jHqMeox6jHqMeYt5i3mLeYt5i3mLeYp4iniKeIp4iniKeIl4iXiJeIl3iXeJd4h3iHeId4h3iHeHd4d3h3eHd4d3h3eGd4Z3hneGd4Z3hneGeIV4hXiFeIV4hXiFeIV4hXiFeIV4hHiEeIR4hHiEeIR5hHmEeYR5hHmEeYR5hHmDeYN5g3mDeYN5g3mDeYN5g3mDeYN5g3qDeoN6g3qDeoN6g3qDeoN6g3qDeoN6g3qCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoJ6gnqCeoF6f3l/eX55fnl+eX55fnl+eX55fnl+eX15fXl9eX15fXl9eX15fXl9enx6fHp8enx6fHp8enx6fHp8ent6e3p7ent7e3t7e3t7e3t7e3p7ent6e3p7enx6fHp8enx6fHl8eXx5fXl9eX15fXl9eX15fXl+eX54fnh+eH54fnh+eH94f3h/eH94f3h/eIB4gHiAeIB4gHiAeIF4gXiBd4F3gXeBd4J3gneCd4J3gneDd4N3g3eDd4N3hHeEd4R3hHeEeIV4hXiFeIV4hniGeIZ4hniGeId4h3iHeId4h3mIeYh5iHmIeYl5iXmJeYl6iXqKeop6inqKeop7inuLe4t7i3uLfIt8i3yMfIx8jH2MfYx9jH2MfYx+jH6Nfo1+jX+Nf41/jX+NgI2AjYCNgI2BjYGNgY2BjYKNgo2CjYKNg42DjYONg42EjYSNhI2EjYWNhY2FjYWNho2GjYaNhoyHjIeMh4yHjIiMiIyIjIiLiIuJi4mLiYuJi4mKioqKioqKioqKiYuJi4mLiYuJi4iMiIyIjIiMh4yHjIeMh4yGjYaNho2GjYWNhY2FjYWNhI2EjYSNhI2DjoOOg46DjoKOgo6CjoKOgY6BjoGOgI6AjoCOgI5/jn+Of41/jX6Nfo1+jX6Nfo19jX2NfY19jXyNfI18jXyMfIx7jHuMe4x7jHuMe4x6i3qLeot6i3qLeot5i3mKeYp5inmKeYp5iniJeIl4iXiJeIl4iXiJeIh4iHiIeIh4iHiId4d3h3eHd4d3h3eHd4Z3hneGd4Z3hneGd4Z3hXeFd4V3hXeFd4V3hXeEd4R3hHeEd4R3hHeEd4R3hHeDd4N3g3eDd4N3g3eDd4N3g3eCd4J3gneCeIJ4gniCeIJ4gniCeIF4gXiBeIF4gXiBeIF4gXiBeIF4gHiAeIB4gHiAeIB4gHiAeIB4gHiAeH94f3h/eH94f3h/eX95fHd7d3t3e3d7d3t4e3h7eHt4enh6eHp4enh6eHp4enl6eXl5eXl5eXl5eXl5eXl5eXp4enh6eHp4enh6eHp4e3h7eHt4e3d7d3t3e3d8d3x3fHd8d3x3fHd9d313fXd9d312fXZ+dn52fnZ+dn52fnZ/dn92f3Z/dn92f3aAdoB2gHaAdoB2gXaBdoF2gXaBdoF2gnaCdoJ2gnaCdoN2g3aDdoN2g3aEdoR2hHaEdoR2hHaFd4V3hXeFd4V3hneGd4Z3hneGd4d3h3eHeId4h3iHeIh4iHiIeIh4iHmIeYl5iXmJeYl5iXmJeop6inqKeop6inqKe4p7i3uLe4t7i3yLfIt8i3yLfIt9i32MfYx9jH2Mfox+jH6Mfox/jH+Mf4x/jH+MgIyAjICMgIyBjIGMgYyBjIGMgoyCjIKMgoyDjIOMg4yDjISMhIyEjISMhIyFjIWMhYyFjIaLhouGi4aLhouHi4eLh4uHi4eKiIqIioiKiIqIiomKiYmJiYmJiYmJiYqJioiKiIqIioiKiIqHi4eLh4uHi4eLhouGi4aLhouGjIWMhYyFjIWMhYyEjISMhIyEjISMg4yDjIOMg4yCjIKMgoyCjIKMgYyBjIGMgYyAjICMgIyAjICMf4x/jH+Mf4x/jH6Mfox+jH6MfYx9jH2MfYx9jH2MfIx8i3yLfIt8i3uLe4t7i3uLe4t7i3qKeop6inqKeop6inmKeYp5iXmJeYl5iXmJeYl4iXiIeIh4iHiIeIh4iHiIeId3h3eHd4d3h3eHd4Z3hneGd4Z3hneGdoZ2hXaFdoV2hXaFdoV2hHaEdoR2hHaEdoR2g3aDdoN2g3aDdoN2gnaCdoJ2gnaCdoJ2gXaBdoF2gXaBdoF2gHaAdoB2gHaAdoB2f3Z/dn92f3Z/dn92fnZ+dn52fnZ+dn52fXZ9dn12fXZ9d313fHd8d3x3fHd8d3x3');
      const jU=new Float32Array(JGH*JGW), jV=new Float32Array(JGH*JGW);
      for(let i=0;i<JGH*JGW;i++){
        jU[i]=(raw.charCodeAt(i*2  )-JHALF)*JSCALE;
        jV[i]=(raw.charCodeAt(i*2+1)-JHALF)*JSCALE;
      }
      window._jetU=jU; window._jetV=jV;
      window._jetGW=JGW; window._jetGH=JGH; window._jetVMAX=JVMAX;
      // Precompute jet speed field for contouring (used by globe-adv.js)
      const jSpd=new Float32Array(JGH*JGW);
      for(let i=0;i<JGH*JGW;i++) jSpd[i]=Math.sqrt(jU[i]*jU[i]+jV[i]*jV[i]);
      window._jetSpd=jSpd;
      // Quick QC: find global max
      let mx=0,mxi=0;
      for(let i=0;i<jSpd.length;i++) if(jSpd[i]>mx){mx=jSpd[i];mxi=i;}
      const mxLat=-90+(Math.floor(mxi/JGW)+0.5), mxLon=-180+(mxi%JGW+0.5);
      console.log('[ERA5 jet] loaded. Max speed:',mx.toFixed(1),'m/s at',
        mxLon.toFixed(1)+'°E,',mxLat.toFixed(1)+'°N');
    })();

    // ════ REAL JET STREAM DATA → CHANNEL 3 (own velocity field) ══════════
    // Resamples the embedded ERA5 300 hPa jet field onto the working
    // GW×GH grid into JU/JV — a velocity array completely separate from
    // U/V (ocean) and WU/WV (wind), and populates spawnByClass[7] (jets'
    // own fixed class) with speed-weighted points across the WHOLE grid
    // (not just a high-speed "core" threshold — matches how the field
    // looked when shown via compare mode, which the visual check
    // confirmed was correct). Called once, eagerly, right after
    // definition — regardless of whether the jets toggle is on — so the
    // GPU spawn table is sized correctly from pipeline init. NEVER writes
    // to WU/WV/WCls, so this can't affect ocean/wind classification or
    // rendering no matter what state the jets toggle is in.
    function _buildJetVelocityField(){
      if(!window._jetSpd) return;
      const JGW=window._jetGW||360, JGH=window._jetGH||180;
      const jU=window._jetU, jV=window._jetV;
      spawnByClass[7]=spawnByClass[7]||[];
      spawnByClass[7].length=0;
      let n=0;
      for(let y=0;y<GH;y++){
        const la=-90+(y+0.5)*CELL;
        const gy=la+90;
        const y0=Math.max(0,Math.min(JGH-2,Math.floor(gy)));
        const y1=y0+1, fy=gy-y0;
        for(let x=0;x<GW;x++){
          const lo=-180+(x+0.5)*CELL;
          const gx=((lo+180)%360+360)%360;
          const x0=Math.floor(gx)%JGW, x1=(x0+1)%JGW, fx=gx-Math.floor(gx);
          const i00=y0*JGW+x0, i01=y0*JGW+x1, i10=y1*JGW+x0, i11=y1*JGW+x1;
          const u=jU[i00]*(1-fx)*(1-fy)+jU[i01]*fx*(1-fy)+jU[i10]*(1-fx)*fy+jU[i11]*fx*fy;
          const v=jV[i00]*(1-fx)*(1-fy)+jV[i01]*fx*(1-fy)+jV[i10]*(1-fx)*fy+jV[i11]*fx*fy;
          const k=y*GW+x;
          JU[k]=u; JV[k]=v;
          const spd=Math.hypot(u,v);
          if(spd<3) continue; // skip near-still cells entirely
          // Weight denser spawn where the jet is fastest, same pattern as
          // buildWeightedSpawn() uses for ocean/wind classes.
          const reps=Math.max(1,Math.round(1+spd/12));
          for(let r=0;r<reps;r++){ spawnByClass[7].push([lo,la]); n++; }
        }
      }
      console.log('[ERA5 jet] channel-3 velocity field ready. Spawn points:',n);
    }
    _buildJetVelocityField();
    rebuildSpawnWeights();
    window._setJetsActive=function(on){
      // Density/slot sizing already recomputes every frame from state.jets
      // (see cDensity in frame()) — this just refreshes the CPU-mirror's
      // weighted spawn cache so a freshly-toggled jets layer doesn't wait
      // for some other class to trigger a rebuild first.
      rebuildSpawnWeights();
      return true;
    };

    const maxAge=320;  // long streaks without infinite overlap smudging
    function respawnParticle(i){
      // Determine layer from slot index: i < oDensitySlot → ocean,
      // oDensitySlot <= i < wDensitySlot → wind, else → jets (channel 3).
      const _od=frame._oDensitySlot||12000;
      const _wd=frame._wDensitySlot??_od;
      const isJetSlot=i>=_wd;
      const isWindSlot=!isJetSlot&&i>=_od;
      if(isJetSlot){
        // Channel 3 is always the single fixed class 7 — no pool pick needed.
        const lst=(_spawnReady&&spawnW[7]&&spawnW[7].length)?spawnW[7]:spawnByClass[7];
        if(!lst||!lst.length){pAlive[i]=0;return;}
        const s=lst[(rand()*lst.length)|0];
        pLon[i]=s[0]+(rand()-0.5)*CELL;
        pLat[i]=s[1]+(rand()-0.5)*CELL;
        pAge[i]=(rand()*maxAge)|0;
        pCls[i]=7; pAlive[i]=1;
        return;
      }
      const en=clsEnabled();
      // Only pick from the correct layer's class range
      const pools=[];
      if(isWindSlot){
        for(let c=4;c<7;c++) if(en[c]&&spawnByClass[c].length) pools.push(c);
      } else {
        for(let c=0;c<4;c++) if(en[c]&&spawnByClass[c].length) pools.push(c);
      }
      // Fallback: if no enabled classes in this layer, kill particle
      if(!pools.length){pAlive[i]=0;return;}
      const c=pools[(rand()*pools.length)|0];
      const lst=_spawnReady?spawnW[c]:spawnByClass[c];
      if(!lst||!lst.length){pAlive[i]=0;return;}
      const s=lst[(rand()*lst.length)|0];
      pLon[i]=s[0]+(rand()-0.5)*CELL;
      pLat[i]=s[1]+(rand()-0.5)*CELL;
      pAge[i]=(rand()*maxAge)|0;
      pCls[i]=c; pAlive[i]=1;
    }
    // Seed all particles
    for(let i=0;i<MAXP;i++) respawnParticle(i);

    // ── Stage 6: Speed-dependent colour (class base colour + alpha by mag) ──
    // Pre-parsed RGBA for each class
    // Speed-magnitude colour function (nullschool style)
    // mag is in grid units; thresholds tuned to our speed range (0.05–2.0)
    function speedColor(mag, cls){
      if(cls<=3){
        // Reference palette: deep navy → blue → cyan → white-cyan (eddy cores)
        // → cyan-green → orange → red. Mirrors NASA/JPL ocean current imagery.
        const t=Math.min(1,mag/1.5);
        if(t<0.18){
          const f=t/0.18;
          return [Math.round(28+f*18),Math.round(72+f*55),Math.round(165+f*75)];
        } else if(t<0.38){ // blue → bright cyan
          const f=(t-0.18)/0.20;
          return [Math.round(30+f*5),Math.round(100+f*135),Math.round(210+f*45)];
        } else if(t<0.58){ // cyan → white-cyan (eddy cores glow)
          const f=(t-0.38)/0.20;
          return [Math.round(35+f*220),Math.round(235+f*20),Math.round(255)];
        } else if(t<0.75){ // white-cyan → orange
          const f=(t-0.58)/0.17;
          return [Math.round(255),Math.round(255-f*130),Math.round(255-f*255)];
        } else {            // orange → red-orange
          const f=(t-0.75)/0.25;
          return [Math.round(255),Math.round(125-f*100),Math.round(12+f*8)];
        }
      }
      // Jet streams (300 hPa, 25-80 m/s) get their own violet→white ramp so
      // they read as visually distinct from surface wind (blue→cyan→green→
      // yellow below) even though both share the same particle channel.
      if(cls===7){
        const tj=Math.min(1,typeof mag==='number'?mag:0);
        if(tj<0.5){ const f=tj/0.5; return [Math.round(90+f*60),Math.round(60+f*80),Math.round(230+f*20)]; }
        const f=(tj-0.5)/0.5;
        return [Math.round(150+f*105),Math.round(140+f*115),Math.round(250+f*5)];
      }
      // Wind speed-colour ramp (blue→cyan→green→yellow) - for both the
      // generic wind themes and the 'winds' theme (cls=99). Fixed per-class
      // colours only apply when building weighted spawn lists.
      if(cls>=4){
        const tw=Math.min(1,typeof mag==='number'?mag:0);
        if(tw<0.33){ const f=tw/0.33; return [Math.round(20+f*20),Math.round(60+f*160),Math.round(180+f*50)]; }
        if(tw<0.66){ const f=(tw-0.33)/0.33; return [Math.round(40+f*160),Math.round(220+f*20),Math.round(230-f*180)]; }
        const f=(tw-0.66)/0.34;
        return [Math.round(200+f*55),Math.round(240-f*120),Math.round(50-f*50)];
      }
      return [200,220,240]; // fallback
    }

    // Canvas rotation tracking — frame() manages its own canvas clearing
    let _canvasRot0=null, _canvasRot1=null, _flowRotAccum=0;
    window._flowRotated=()=>{ _canvasRot0=null; _flowRotAccum=999; paintOcean(); };

    // Use d3 projection directly — it's fast (~0.24µs per call, 2.8ms for 12k particles).
    // Wrap to return physical pixels and null for far-side (unclipped) points.
    function proj(lon,lat){
      const p=projection([lon,lat]);
      if(!p) return null;
      return [p[0]*dpr, p[1]*dpr];
    }

    // ════════════════════════════════════════════════════════════
    //  GPU-RESIDENT PARTICLE SYSTEM (WebGPU compute + render)
    //  Particle state (pos, prevPos, age, cls, alive, mag) lives in
    //  ONE GPU storage buffer, permanently. Per frame, in a single
    //  command encoder:
    //    1. compute pass  — respawn + advect every particle in place
    //    2. trail pass    — fade persistent trail texture (dst *=
    //                       retention via blend-constant), then draw
    //                       each segment as a feathered quad, vertex
    //                       shader reading the particle buffer directly
    //    3. blit pass     — present trail texture to a dedicated
    //                       WebGPU canvas (above the 2D ocean canvas)
    //  The CPU NEVER reads particle data back — no mapAsync, no stale
    //  positions, none of the rubber-banding the first attempt had.
    //  Toggling off: hide canvas, pAlive.fill(0), CPU path resumes.
    // ════════════════════════════════════════════════════════════
    const _gpuP={ready:false,initializing:false,failed:false,wgslVer:0,dev:null,
      canvas:null,gctx:null,fmt:null,windCanvas:null,windGctx:null,
      partBuf:null,paramsBuf:null,
      bgCompute:null,bgLine:null,bgBlit:null,bgBlitWind:null,computePipe:null,linePipe:null,
      fadePipe:null,blitPipe:null,trailTex:null,trailView:null,trailW:0,trailH:0,
      trailTexW:null,trailViewW:null,trailWW:0,trailWH:0,
      lut:null,lutKey:'',spawnCounts:null,zeroSeed:null,
      clearTrail:true,clearTrailW:true,resetParticles:true};

    const _GPU_WGSL_VER=5; // bump to force pipeline rebuild after shader edits
    async function _gpuPInit(){
      if(_gpuP.initializing||_gpuP.ready||_gpuP.failed) return;
      _gpuP.initializing=true;
      try{
        let dev=window.GlobeAPI?._wgpuDevice||null;
        if(!dev&&navigator.gpu){
          const ad=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
          if(ad) dev=await ad.requestDevice();
        }
        if(!dev) throw new Error('no WebGPU device');
        _gpuP.dev=dev;
        // Capture ALL validation errors during setup. WebGPU validation
        // failures don't throw JS exceptions — without this scope, a bad
        // pipeline would report ready=true and every draw would silently
        // no-op (blank canvas). With it, we throw → failed=true → CPU path.
        dev.pushErrorScope('validation');

        // Dedicated presentation canvas — REUSED across re-inits. Field
        // reloads invalidate the GPU system (ready=false) so init runs
        // again; creating a fresh canvas each time stacked canvases, and
        // the previous one (later in DOM order) kept painting its stale
        // frame ON TOP — which made custom-field loads look like no-ops.
        let c=_gpuP.canvas;
        if(!c){
          c=document.createElement('canvas');
          c.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;display:none;';
          document.body.insertBefore(c,cnv.nextSibling);
        }
        const gctx=_gpuP.gctx||c.getContext('webgpu');
        if(!gctx) throw new Error('no webgpu canvas context');
        const fmt=navigator.gpu.getPreferredCanvasFormat();
        gctx.configure({device:dev,format:fmt,alphaMode:'premultiplied'});
        _gpuP.canvas=c; _gpuP.gctx=gctx; _gpuP.fmt=fmt;
        let wc=_gpuP.windCanvas;
        if(!wc){
          wc=document.createElement('canvas');
          wc.id='wind-flow-gpu';
          wc.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:16;pointer-events:none;background:transparent;display:none;';
          const labelSvg=document.getElementById('globe-labels');
          if(labelSvg) document.body.insertBefore(wc,labelSvg);
          else {
            const gEl=document.getElementById('globe');
            if(gEl) document.body.insertBefore(wc,gEl.nextSibling);
            else document.body.appendChild(wc);
          }
        }
        const wGctx=_gpuP.windGctx||wc.getContext('webgpu');
        if(!wGctx) throw new Error('no webgpu wind canvas context');
        wGctx.configure({device:dev,format:fmt,alphaMode:'premultiplied'});
        _gpuP.windCanvas=wc; _gpuP.windGctx=wGctx;

        const code=`
const GW:i32=${GW};
const GH:i32=${GH};
const CELL:f32=${CELL};
const D2:f32=0.017453292519943295;
struct Params {
  oDensity:u32, nAct:u32, seed:u32, enMask:u32,
  maxAgeO:f32, maxAgeW:f32, oSpeed:f32, wSpeed:f32,
  oTurb:f32, wTurb:f32, lonC:f32, cosT:f32,
  sinT:f32, cx:f32, cy:f32, R:f32,
  sizeW:f32, sizeH:f32, dprV:f32, lwO:f32,
  lwW:f32, alphaW:f32, oClsPack:u32, oClsCnt:u32,
  wClsPack:u32, wClsCnt:u32, fadeSub:f32, pad1:f32,
  // cmpOceanFrac/cmpWindFrac: 0.0 = compare off; otherwise the target
  // fraction (0-1] of that layer's pool routed through the custom field,
  // derived from the Loaded-currents/winds Particles slider relative to
  // the embedded one — was a fixed 50/50 bool before, which meant that
  // slider had no effect at all during compare mode.
  wDensity:u32, cDensity:u32, cmpOceanFrac:f32, cmpWindFrac:f32,
  baseAlpha:vec4f,
  // Compare-mode (loaded currents/winds) appearance overrides — mirrors
  // the CPU path's apCustom-driven effSpeed/effTurb/alpha/width selection,
  // which previously had no GPU equivalent (compare particles just reused
  // the embedded layer's settings regardless of the Loaded-field sliders).
  cmpOceanSpeed:f32, cmpWindSpeed:f32, cmpOceanTurb:f32, cmpWindTurb:f32,
  cmpOceanAlphaScale:f32, cmpWindAlpha:f32, cmpOceanLw:f32, cmpWindLw:f32,
};
struct Part { a:vec4f, b:vec4f };
@group(0) @binding(0) var<uniform> P:Params;
@group(0) @binding(1) var<storage,read> velG:array<vec4f>;
// Merged ocean-class (.x) + wind-class (.y) grids into one buffer — with
// velCmp added for compare mode, the compute stage was at 9 storage
// buffers, one over the default maxStorageBuffersPerShaderStage(8) that
// most hardware ships with. Merging these two read-only, never-both-
// touched-at-once grids gets back under the limit without requesting
// elevated device limits (which not all adapters grant).
@group(0) @binding(2) var<storage,read> clsWclsG:array<vec2i>;
@group(0) @binding(4) var<storage,read> landG:array<u32>;
@group(0) @binding(5) var<storage,read> spawnTab:array<vec2f>;
@group(0) @binding(6) var<storage,read> spawnMeta:array<vec2u>;
@group(0) @binding(7) var<storage,read_write> parts:array<Part>;
@group(0) @binding(8) var<storage,read> velC:array<vec2f>;
@group(0) @binding(9) var lutTex:texture_2d<f32>;
@group(0) @binding(10) var trailTex:texture_2d<f32>;
// Compare-mode custom field (user-loaded, side-by-side with embedded):
// .xy=custom-ocean u/v, .zw=custom-wind u/v — same vec4 packing as velG.
@group(0) @binding(11) var<storage,read> velCmp:array<vec4f>;
fn imod(a:i32,m:i32)->i32{ let r=a%m; return select(r,r+m,r<0); }
fn gridIndex(lon:f32,lat:f32)->u32{
  var x=i32(floor((lon+180.0)/CELL));
  var y=i32(floor((lat+90.0)/CELL));
  x=imod(x,GW); y=clamp(y,0,GH-1);
  return u32(y*GW+x);
}
fn sampleVel(lon:f32,lat:f32,isWind:bool)->vec2f{
  let gx=(lon+180.0)/CELL-0.5; let gy=(lat+90.0)/CELL-0.5;
  let x0=i32(floor(gx)); let y0=i32(floor(gy));
  let fx=gx-f32(x0); let fy=gy-f32(y0);
  let x0w=imod(x0,GW); let x1w=imod(x0w+1,GW);
  let y0c=clamp(y0,0,GH-1); let y1c=clamp(y0+1,0,GH-1);
  let k00=u32(y0c*GW+x0w); let k01=u32(y0c*GW+x1w);
  let k10=u32(y1c*GW+x0w); let k11=u32(y1c*GW+x1w);
  let v00=velG[k00]; let v01=velG[k01]; let v10=velG[k10]; let v11=velG[k11];
  let a=select(v00.xy,v00.zw,isWind); let b=select(v01.xy,v01.zw,isWind);
  let c=select(v10.xy,v10.zw,isWind); let d=select(v11.xy,v11.zw,isWind);
  return (a*(1.0-fx)+b*fx)*(1.0-fy)+(c*(1.0-fx)+d*fx)*fy;
}
// Channel 3 ("custom"): currently jets only, always class 7 — a fixed,
// single-class slot, so unlike ocean/wind it needs no per-cell class
// lookup or class-pack selection, just a straight velocity sample.
fn sampleVelC(lon:f32,lat:f32)->vec2f{
  let gx=(lon+180.0)/CELL-0.5; let gy=(lat+90.0)/CELL-0.5;
  let x0=i32(floor(gx)); let y0=i32(floor(gy));
  let fx=gx-f32(x0); let fy=gy-f32(y0);
  let x0w=imod(x0,GW); let x1w=imod(x0w+1,GW);
  let y0c=clamp(y0,0,GH-1); let y1c=clamp(y0+1,0,GH-1);
  let k00=u32(y0c*GW+x0w); let k01=u32(y0c*GW+x1w);
  let k10=u32(y1c*GW+x0w); let k11=u32(y1c*GW+x1w);
  let v00=velC[k00]; let v01=velC[k01]; let v10=velC[k10]; let v11=velC[k11];
  return (v00*(1.0-fx)+v01*fx)*(1.0-fy)+(v10*(1.0-fx)+v11*fx)*fy;
}
// Compare-mode custom field — mirrors sampleVel but reads velCmp. Only
// odd-indexed particles within the embedded ocean/wind slots route here
// (see cmain's useCmp), matching the CPU path's interleaved 50/50 split.
fn sampleVelCmp(lon:f32,lat:f32,isWind:bool)->vec2f{
  let gx=(lon+180.0)/CELL-0.5; let gy=(lat+90.0)/CELL-0.5;
  let x0=i32(floor(gx)); let y0=i32(floor(gy));
  let fx=gx-f32(x0); let fy=gy-f32(y0);
  let x0w=imod(x0,GW); let x1w=imod(x0w+1,GW);
  let y0c=clamp(y0,0,GH-1); let y1c=clamp(y0+1,0,GH-1);
  let k00=u32(y0c*GW+x0w); let k01=u32(y0c*GW+x1w);
  let k10=u32(y1c*GW+x0w); let k11=u32(y1c*GW+x1w);
  let v00=velCmp[k00]; let v01=velCmp[k01]; let v10=velCmp[k10]; let v11=velCmp[k11];
  let a=select(v00.xy,v00.zw,isWind); let b=select(v01.xy,v01.zw,isWind);
  let c=select(v10.xy,v10.zw,isWind); let d=select(v11.xy,v11.zw,isWind);
  return (a*(1.0-fx)+b*fx)*(1.0-fy)+(c*(1.0-fx)+d*fx)*fy;
}
fn hash(i:u32,salt:u32)->f32{
  var x=i*747796405u+salt*2891336453u+P.seed;
  x=(x^(x>>16u))*2246822519u;
  x=(x^(x>>13u))*3266489917u;
  x=x^(x>>16u);
  return f32(x)/4294967295.0;
}
fn frontDot(lon:f32,lat:f32)->f32{
  let lam=(lon+P.lonC)*D2; let phi=lat*D2;
  return cos(phi)*cos(lam)*P.cosT+sin(phi)*P.sinT;
}
fn respawn(i:u32,isWindSlot:bool)->Part{
  var out:Part;
  var pack:u32; var cnt:u32; var maxAgeL:f32;
  if(isWindSlot){ pack=P.wClsPack; cnt=P.wClsCnt; maxAgeL=P.maxAgeW; }
  else { pack=P.oClsPack; cnt=P.oClsCnt; maxAgeL=P.maxAgeO; }
  out.a=vec4f(0.0); out.b=vec4f(0.0);
  if(cnt==0u){ return out; }
  for(var att:u32=0u;att<4u;att++){
    let r0=hash(i,att*7u+1u);
    let cidx=min(u32(r0*f32(cnt)),cnt-1u);
    let cls=(pack>>(8u*cidx))&255u;
    let smeta=spawnMeta[cls];
    if(smeta.y==0u){ continue; }
    let r1=hash(i,att*7u+2u);
    let si=min(u32(r1*f32(smeta.y)),smeta.y-1u);
    let e=spawnTab[smeta.x+si];
    let lon=e.x+(hash(i,att*7u+3u)-0.5)*CELL;
    let lat=e.y+(hash(i,att*7u+4u)-0.5)*CELL;
    // Prefer front-hemisphere spawn points (CPU churns dead frames on
    // far-side picks; we retry up to 3 times, accept anything on the 4th)
    if(frontDot(lon,lat)<0.0&&att<3u){ continue; }
    out.a=vec4f(lon,lat,lon,lat);
    out.b=vec4f(hash(i,att*7u+5u)*maxAgeL,f32(cls),1.0,0.0);
    return out;
  }
  return out;
}
// Channel 3 (jets) is always the single fixed class 7 — no class-pack
// selection needed, just pull straight from its own spawn table entry.
// Reuses P.maxAgeW (wind's fade timing) per "same appearance settings as
// wind" — jets don't get their own separate density/speed/fade sliders.
fn respawnJet(i:u32)->Part{
  var out:Part;
  out.a=vec4f(0.0); out.b=vec4f(0.0);
  let smeta=spawnMeta[7];
  if(smeta.y==0u){ return out; }
  for(var att:u32=0u;att<4u;att++){
    let r1=hash(i,att*7u+2u);
    let si=min(u32(r1*f32(smeta.y)),smeta.y-1u);
    let e=spawnTab[smeta.x+si];
    let lon=e.x+(hash(i,att*7u+3u)-0.5)*CELL;
    let lat=e.y+(hash(i,att*7u+4u)-0.5)*CELL;
    if(frontDot(lon,lat)<0.0&&att<3u){ continue; }
    out.a=vec4f(lon,lat,lon,lat);
    out.b=vec4f(hash(i,att*7u+5u)*P.maxAgeW,7.0,1.0,0.0);
    return out;
  }
  return out;
}
// Channel 3 (jets): a self-contained slot range AFTER wind, sampling its
// own velocity buffer, always class 7, no cell reclassification (jets
// don't move between "sub-classes" the way wind transitions between
// trades/westerlies/polar). Kept in its own function so ocean/wind's
// logic below is untouched — jets never share their slot, buffer, or
// classification, so a bug here can't affect currents/wind rendering.
fn cmainJet(i:u32){
  var p=parts[i];
  var ok=p.b.z>0.5;
  if(ok){
    let lon0=p.a.x; let lat0=p.a.y;
    if(frontDot(lon0,lat0)<0.0){ ok=false; }
    if(ok){
      let uv0=sampleVelC(lon0,lat0);
      let mag=length(uv0);
      let age=p.b.x+1.0;
      if(mag<5.0||age>P.maxAgeW){ ok=false; }
      else {
        // Jets run 25-80 m/s vs wind's ~20 m/s ceiling — scale against
        // their own ceiling so step size matches wind's visual range
        // instead of jumping ~4x farther per frame.
        let magN=mag*(2.5/80.0);
        let stp=(0.08+magN*0.52)*P.wSpeed;
        let cm=max(0.5,cos(lat0*D2)); // see cmain: raised floor curbs polar longitude-jump jaggedness
        let turb=P.wTurb;
        // RK4 — see cmain for the full rationale.
        let hStp=stp*0.5;
        var p2l=lon0+uv0.x*hStp/cm+(hash(i,11u)-0.5)*turb*0.5;
        var p2t=lat0+uv0.y*hStp+(hash(i,12u)-0.5)*turb*0.5;
        if(p2l>180.0){ p2l-=360.0; } if(p2l<-180.0){ p2l+=360.0; }
        if(p2t>89.0||p2t<-89.0){ ok=false; }
        else {
          let uv1=sampleVelC(p2l,p2t);
          var p3l=lon0+uv1.x*hStp/cm+(hash(i,15u)-0.5)*turb*0.5;
          var p3t=lat0+uv1.y*hStp+(hash(i,16u)-0.5)*turb*0.5;
          if(p3l>180.0){ p3l-=360.0; } if(p3l<-180.0){ p3l+=360.0; }
          if(p3t>89.0||p3t<-89.0){ ok=false; }
          else {
            let uv2=sampleVelC(p3l,p3t);
            var p4l=lon0+uv2.x*stp/cm+(hash(i,17u)-0.5)*turb;
            var p4t=lat0+uv2.y*stp+(hash(i,18u)-0.5)*turb;
            if(p4l>180.0){ p4l-=360.0; } if(p4l<-180.0){ p4l+=360.0; }
            if(p4t>89.0||p4t<-89.0){ ok=false; }
            else {
              let uv3=sampleVelC(p4l,p4t);
              let ufin=(uv0.x+2.0*uv1.x+2.0*uv2.x+uv3.x)/6.0;
              let vfin=(uv0.y+2.0*uv1.y+2.0*uv2.y+uv3.y)/6.0;
              var nl=lon0+ufin*stp/cm+(hash(i,13u)-0.5)*turb;
              var nt=lat0+vfin*stp+(hash(i,14u)-0.5)*turb;
              if(nl>180.0){ nl-=360.0; } if(nl<-180.0){ nl+=360.0; }
              if(nt>89.0||nt<-89.0){ ok=false; }
              else if(frontDot(nl,nt)<0.0){ ok=false; }
              else {
                parts[i]=Part(vec4f(nl,nt,lon0,lat0),vec4f(age,7.0,1.0,mag));
                return;
              }
            }
          }
        }
      }
    }
  }
  parts[i]=respawnJet(i);
}
@compute @workgroup_size(64)
fn cmain(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;
  if(i>=P.nAct){ return; }
  let jetStart=P.oDensity+P.wDensity;
  if(i>=jetStart){ cmainJet(i); return; }
  let isWindSlot=i>=P.oDensity;
  // Compare mode: odd-indexed particles within the embedded ocean/wind
  // slots advect through the user-loaded custom field instead — mirrors
  // the CPU path's interleaved 50/50 split (see _cmpA/useCmp in frame()).
  // Class/land-mask/respawn logic is untouched; only the velocity source
  // differs, so this needed no new particle slots or spawn tables.
  // Deterministic per-index membership (not random) so a particle's
  // embedded/custom identity stays stable frame to frame instead of
  // flickering. i%100 vs frac*100 approximates the target fraction at 1%
  // granularity — replaces the old fixed-50/50 (i&1u) split.
  let cmpFrac=select(P.cmpOceanFrac,P.cmpWindFrac,isWindSlot);
  let useCmp=cmpFrac>0.0&&(f32(i%100u)<cmpFrac*100.0);
  var p=parts[i];
  var ok=p.b.z>0.5;
  if(ok){
    let cls0=u32(p.b.y);
    if((cls0>=4u)!=isWindSlot){ ok=false; }
    else if(((P.enMask>>cls0)&1u)==0u){ ok=false; }
  }
  if(ok){
    let lon0=p.a.x; let lat0=p.a.y;
    if(frontDot(lon0,lat0)<0.0){ ok=false; }
    if(ok){
      var uv0:vec2f; if(useCmp){ uv0=sampleVelCmp(lon0,lat0,isWindSlot); } else { uv0=sampleVel(lon0,lat0,isWindSlot); }
      let mag=length(uv0);
      let maxAgeL=select(P.maxAgeO,P.maxAgeW,isWindSlot);
      let age=p.b.x+1.0;
      if(mag<0.03||age>maxAgeL){ ok=false; }
      else {
        let gk=gridIndex(lon0,lat0);
        var ncls:u32=0u;
        if(isWindSlot){
          let wc=clsWclsG[gk].y;
          if(wc<0){
            // Latitude belt fallback when grid class unset (coast blend, custom fields).
            let absLat=abs(lat0);
            if(absLat>82.0||mag<0.5){ ok=false; }
            else if(absLat<28.0){ ncls=4u; }
            else if(absLat<58.0){ ncls=5u; }
            else { ncls=6u; }
          } else { ncls=u32(wc); }
        } else { ncls=u32(clsWclsG[gk].x); }
        if(ok&&((P.enMask>>ncls)&1u)==0u){ ok=false; }
        if(ok){
          // Jets run 25-80 m/s vs regular wind's ~20 m/s ceiling — reusing
          // wind's mag*(2.5/20) scale would give jets a ~4x larger advection
          // step than wind, causing huge per-frame jumps that either look
          // jittery or blow the vertex shader's d2>1600 segment-length
          // discard (particles flickering in and out). Scale jets against
          // their own 80 m/s ceiling so step size matches wind's range.
          var magN=mag;
          if(isWindSlot){ magN=select(mag*(2.5/20.0),mag*(2.5/80.0),ncls==7u); }
          // Compare-mode particles use the "Loaded currents/winds" speed
          // slider instead of the embedded layer's — matches CPU's
          // apCustom-driven effSpeed selection (see frame()'s main loop).
          var spd=select(P.oSpeed,P.wSpeed,isWindSlot);
          if(useCmp){ spd=select(P.cmpOceanSpeed,P.cmpWindSpeed,isWindSlot); }
          let stp=(0.08+magN*0.52)*spd;
          // Floor raised from 0.25→0.5: wind reaches much higher lat/speed
          // combinations than ocean ever does, and the old floor let its
          // longitude step stretch up to 4× near the poles — long, jagged,
          // often-culled (d2>1600) segments. Ocean rarely nears the poles
          // at speed, so it never showed this; the floor was simply never
          // tuned for wind's range. Halving the max stretch to 2× keeps
          // polar wind segments short enough to read as smooth streamlines.
          let cm=max(0.5,cos(lat0*D2));
          var turb=select(P.oTurb,P.wTurb,isWindSlot);
          if(useCmp){ turb=select(P.cmpOceanTurb,P.cmpWindTurb,isWindSlot); }
          // Classic 4-stage Runge-Kutta (upgraded from RK2 midpoint): k1
          // is uv0 (already sampled); k2/k3 at two half-step trial
          // positions, k4 at a full-step trial; final displacement uses
          // the weighted average (k1+2k2+2k3+k4)/6 — 4th-order accurate
          // vs RK2's 2nd, so particles track eddies/retroflections more
          // faithfully over their lifetime. No curve-rendering changes
          // here (GPU draws straight quads, same as before RK4) — an
          // earlier experiment added a Part-buffer midpoint field to bend
          // the GPU quad strip and found no visible difference at normal
          // per-frame step sizes, so that plumbing stays reverted; CPU's
          // cheap Path2D-based curve (no buffer changes needed there)
          // still uses its own RK-refined midpoint.
          let hStp=stp*0.5;
          var p2l=lon0+uv0.x*hStp/cm+(hash(i,11u)-0.5)*turb*0.5;
          var p2t=lat0+uv0.y*hStp+(hash(i,12u)-0.5)*turb*0.5;
          if(p2l>180.0){ p2l-=360.0; } if(p2l<-180.0){ p2l+=360.0; }
          if(p2t>89.0||p2t<-89.0){ ok=false; }
          else {
            var uv1:vec2f; if(useCmp){ uv1=sampleVelCmp(p2l,p2t,isWindSlot); } else { uv1=sampleVel(p2l,p2t,isWindSlot); }
            var p3l=lon0+uv1.x*hStp/cm+(hash(i,15u)-0.5)*turb*0.5;
            var p3t=lat0+uv1.y*hStp+(hash(i,16u)-0.5)*turb*0.5;
            if(p3l>180.0){ p3l-=360.0; } if(p3l<-180.0){ p3l+=360.0; }
            if(p3t>89.0||p3t<-89.0){ ok=false; }
            else {
              var uv2:vec2f; if(useCmp){ uv2=sampleVelCmp(p3l,p3t,isWindSlot); } else { uv2=sampleVel(p3l,p3t,isWindSlot); }
              var p4l=lon0+uv2.x*stp/cm+(hash(i,17u)-0.5)*turb;
              var p4t=lat0+uv2.y*stp+(hash(i,18u)-0.5)*turb;
              if(p4l>180.0){ p4l-=360.0; } if(p4l<-180.0){ p4l+=360.0; }
              if(p4t>89.0||p4t<-89.0){ ok=false; }
              else {
                var uv3:vec2f; if(useCmp){ uv3=sampleVelCmp(p4l,p4t,isWindSlot); } else { uv3=sampleVel(p4l,p4t,isWindSlot); }
                let ufin=(uv0.x+2.0*uv1.x+2.0*uv2.x+uv3.x)/6.0;
                let vfin=(uv0.y+2.0*uv1.y+2.0*uv2.y+uv3.y)/6.0;
                var nl=lon0+ufin*stp/cm+(hash(i,13u)-0.5)*turb;
                var nt=lat0+vfin*stp+(hash(i,14u)-0.5)*turb;
                if(nl>180.0){ nl-=360.0; } if(nl<-180.0){ nl+=360.0; }
                if(nt>89.0||nt<-89.0){ ok=false; }
                else if(!isWindSlot&&landG[gridIndex(nl,nt)]!=0u){ ok=false; }
                else if(frontDot(nl,nt)<0.0){ ok=false; }
                else {
                  parts[i]=Part(vec4f(nl,nt,lon0,lat0),vec4f(age,f32(ncls),1.0,mag));
                  return;
                }
              }
            }
          }
        }
      }
    }
  }
  parts[i]=respawn(i,isWindSlot);
}
struct VOut { @builtin(position) pos:vec4f, @location(0) col:vec4f, @location(1) ep:vec2f, @location(2) spd:f32, @location(3) isW:f32 };
fn projPt(lon:f32,lat:f32)->vec3f{
  let lam=(lon+P.lonC)*D2; let phi=lat*D2;
  let cp=cos(phi); let sp=sin(phi);
  let x=(P.cx+P.R*cp*sin(lam))*P.dprV;
  let y=(P.cy-P.R*(P.cosT*sp-P.sinT*cp*cos(lam)))*P.dprV;
  let d=cp*cos(lam)*P.cosT+sp*P.sinT;
  return vec3f(x,y,d);
}
@vertex fn lvs(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32,
               @location(0) pa:vec4f,@location(1) pb:vec4f)->VOut{
  var o:VOut;
  o.pos=vec4f(2.0,2.0,2.0,1.0); o.col=vec4f(0.0); o.ep=vec2f(0.0); o.spd=0.0; o.isW=0.0;
  if(pb.z<0.5||pb.w<=0.0){ return o; }
  let A=projPt(pa.z,pa.w);
  let B=projPt(pa.x,pa.y);
  if(A.z<0.0||B.z<0.0){ return o; }
  let d=B.xy-A.xy;
  let d2=dot(d,d);
  if(d2>1600.0){ return o; }
  if(d2<1e-9){ return o; }
  let dir=d*inverseSqrt(d2);
  let nrm=vec2f(-dir.y,dir.x);
  let jetStart=P.oDensity+P.wDensity;
  let isJet=ii>=jetStart;
  let isWind=!isJet&&ii>=P.oDensity;
  // Compare-mode particles (odd-indexed within the embedded ocean/wind
  // slots, see cmain's useCmp) use the "Loaded currents/winds" sliders
  // for line width/alpha too, not just advection — computed once here and
  // reused below for lw, LUT row, and alpha so all three stay consistent.
  // Must match cmain's useCmp formula exactly (same particle index ii==i)
  // so compute and render agree on which particles are "custom".
  let cmpFracV=select(P.cmpOceanFrac,P.cmpWindFrac,isWind);
  let isCmp=!isJet&&cmpFracV>0.0&&(f32(ii%100u)<cmpFracV*100.0);
  // Jets reuse wind's line-width/alpha settings ("same appearance as
  // wind"), but need their own colour-bucket ceiling — tnorm=20 (wind's
  // ~20 m/s max) would clamp every jet particle (25-80 m/s) to t≈1, a
  // single saturated colour with no speed variation across the jet core.
  var lw=select(P.lwO,P.lwW,isWind||isJet);
  if(isCmp){ lw=select(P.cmpOceanLw,P.cmpWindLw,isWind); }
  var tnorm=select(1.5,20.0,isWind); if(isJet){ tnorm=80.0; }
  let t=min(0.999,pb.w/tnorm);
  let t2=t*t;
  let isWJ=isWind||isJet;
  // Speed-dependent width — class-aware, same reasoning as lfs_glow's
  // heat curve: ocean's typical fast currents sit close to its tnorm
  // (1.5 m/s) so a t² width curve still lets real cores widen, but wind's
  // typical 5-10 m/s sits at t≈0.25-0.5 of its 20 m/s tnorm, where t² is
  // 0.06-0.25 — the t² curve pinned virtually ALL wind to the minimum
  // width, rendering hairline "whiskers". Wind/jets use a linear-t curve
  // instead: base lifted above the old low-t hairline range, but SLOPE
  // kept shallow — quad fill cost scales with width, and an earlier
  // steeper curve (0.62+0.88t), together with a density bump, tripled
  // wind's fill-rate and tanked GPU frame rate (4 vs 82 frames/10s in an
  // A/B bisect). This flattens the top end (max 1.13 vs ocean's 1.67)
  // where the cost is biggest and the extra width reads as "busy".
  let speedW=select(0.52+1.15*t2,0.58+0.55*t,isWJ);
  // Wind/jets get a higher width floor (0.68 vs ocean's 0.55): at typical
  // (non-retina) dpr, lw*0.48 sits BELOW 0.55 for both layers, so this
  // floor was silently overriding the theme/slider width entirely — but
  // wind belts cover a much larger area with less background contrast
  // than ocean currents (no speed-paint backdrop to help it read), so
  // pinning it to the SAME minimum as ocean made it look sparse/faint.
  let hwCore=max(select(0.55,0.68,isWJ),lw*0.48)*speedW;
  let hw=hwCore+0.42+0.38*t;
  // Longer caps bridge sub-pixel gaps into continuous streamlines —
  // extended (0.72→0.9, +0.38→+0.55) so consecutive per-frame segments
  // meeting at an angle overlap enough to hide the angular notch that
  // read as "polygonal", mimicking the CPU path's round caps.
  let capExt=hwCore*0.9+0.55;
  var tpar:f32; var side:f32;
  switch(vi){
    case 0u:{tpar=0.0;side=-1.0;}
    case 1u:{tpar=1.0;side=-1.0;}
    case 2u:{tpar=0.0;side=1.0;}
    case 3u:{tpar=0.0;side=1.0;}
    case 4u:{tpar=1.0;side=-1.0;}
    default:{tpar=1.0;side=1.0;}
  }
  let px=mix(A.xy,B.xy,tpar)+nrm*side*hw+dir*(tpar*2.0-1.0)*capExt;
  let ndc=vec2f(px.x/P.sizeW*2.0-1.0,1.0-px.y/P.sizeH*2.0);
  o.pos=vec4f(ndc,0.0,1.0);
  // Speed normalization differs by layer: ocean peaks ~1.5 m/s (Gulf
  // Stream), wind peaks ~20 m/s. Using /1.5 for wind saturated every wind
  // particle to the LUT endpoint (all same colour, no speed variation) —
  // that plus a near-zero alpha is why wind was invisible in GPU mode.
  // Rows 0-6 = per-class colormap (warm/cold/acc/gyres/trades/wester/polar,
  // Earth Systems picker or the ocean/wind default), row 7 = jets (fixed
  // ramp, never overridden). pb.y already IS the class (0-7), so no
  // separate isWind/isJet branching is needed for the base case.
  var row:i32=i32(pb.y);
  // Compare-mode particles get their own LUT rows (8=ocean-compare,
  // 9=wind-compare) so the custom field visually reads as distinct from
  // the embedded one — matching the CPU path's getCompareTheme() treatment.
  if(isCmp){ row=select(8,9,isWind); }
  let rgb=textureLoad(lutTex,vec2i(i32(t*255.0),row),0).rgb;
  var a:f32;
  if(isCmp){
    // Wind-compare has no per-class buckets (alphaW is a single value);
    // ocean-compare reuses the embedded baseAlpha buckets, rescaled by
    // the ratio between the loaded field's opacity slider and the
    // embedded layer's (see cmpOceanAlphaScale in _gpuPFrame).
    if(isWind){ a=P.cmpWindAlpha; } else { a=P.baseAlpha[min(u32(pb.y),3u)]*P.cmpOceanAlphaScale; }
  } else if(isWJ){ a=P.alphaW; }
  else { a=P.baseAlpha[min(u32(pb.y),3u)]; }
  // Speed-dependent alpha — fast currents (t²) punch through the field.
  // Class-aware like speedW above: wind's t rarely exceeds ~0.5, so the
  // t² term kept nearly all wind near the dim 0.72 floor — linear t
  // restores the intended speed-brightness gradient across wind belts.
  let speedA=select(0.72+0.50*t2,0.72+0.50*t,isWJ);
  a=a*speedA*(0.78+0.22*t);
  o.col=vec4f(rgb*a,a);
  o.ep=vec2f(side*hw,hwCore);
  o.spd=t2;
  o.isW=select(0.0,1.0,isWJ);
  return o;
}
// Two fragment entry points sharing the same vertex stage, drawn as two
// separate passes with different blend modes — this mirrors the CPU
// path's two-pass technique (solid strokes, then a thin additive glow
// overlay) rather than doing everything in one additive pass.
//
// Why: these particles typically move well under a pixel per frame. Under
// pure ADDITIVE blending, a stroke that barely moves just re-brightens the
// SAME pixels every frame with no bound — the line never gets a chance to
// visually "extend" into new territory, so it saturates into a bright
// dot instead of a streak. NORMAL alpha blending doesn't have that runaway:
// anti-aliased partial coverage at a shifting edge is what actually paints
// a continuous line out of sub-pixel motion, frame after frame — exactly
// how the working CPU canvas version does it. Additive is reserved for a
// second, much fainter pass that adds density glow on top of already-solid
// coverage, instead of being asked to create the coverage by itself.
@fragment fn lfs_core(in:VOut)->@location(0) vec4f{
  let dist=abs(in.ep.x);
  // SDF smoothstep falloff — cleaner anti-aliased stroke edges than linear.
  // Feather widened (+1.15/-0.38 → +1.5/-0.3): a softer edge blends
  // consecutive segments' overlap regions instead of stacking two hard
  // edges at the joint, which is what made GPU streaks look faceted.
  let core=smoothstep(in.ep.y+1.5,in.ep.y-0.3,dist);
  return in.col*core;
}
@fragment fn lfs_glow(in:VOut)->@location(0) vec4f{
  let dist=abs(in.ep.x);
  let edge=1.0-smoothstep(0.0,in.ep.y+0.85,dist);
  // Glow curve is class-aware (in.isW, set in lvs): ocean's tnorm
  // (1.5 m/s) sits close to its own typical fast-current speeds, so a
  // steep speed⁴ curve still lets real cores bloom — but wind's tnorm
  // (20 m/s) is far above typical 10m wind speeds (usually 5-10 m/s), so
  // the SAME steep curve left wind's glow almost never firing (t rarely
  // exceeds ~0.5, where t⁴ is negligible), reading as flat/dark on
  // screen despite the base alphaW being reasonable. Wind/jets get a
  // gentler speed² curve and a higher floor instead.
  let heatOcean=in.spd*in.spd;
  let heat=select(heatOcean,in.spd,in.isW>0.5);
  // Wind glow floor trimmed 0.22→0.19 in the same "slightly tempered"
  // polish pass as the density-boost clamp — halves the perceived
  // brightness bump without touching stroke geometry.
  let floorV=select(0.16,0.19,in.isW>0.5);
  let scaleV=select(0.42,0.46,in.isW>0.5);
  let halo=(floorV+scaleV*heat)*edge*edge;
  return in.col*halo;
}
@vertex fn fsvs(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f{
  var p=array(vec2f(-1.0,-3.0),vec2f(-1.0,1.0),vec2f(3.0,1.0));
  return vec4f(p[vi],0.0,1.0);
}
@fragment fn fadeMulFs()->@location(0) vec4f{ return vec4f(0.0); }
@fragment fn fadefs()->@location(0) vec4f{
  // Emits the per-frame subtractive floor (P.fadeSub). Used with a
  // reverse-subtract blend (dst - src) so a fixed small amount is removed
  // from the trail each frame AFTER the multiplicative fade. Multiply alone
  // decays asymptotically and, in 8-bit, pins faint pixels at value 1
  // forever — the ghost/smudge residue. The subtract guarantees low values
  // cross zero and clear; bright active trails are barely affected.
  return vec4f(P.fadeSub,P.fadeSub,P.fadeSub,P.fadeSub);
}
@fragment fn blitfs(@builtin(position) fp:vec4f)->@location(0) vec4f{
  return textureLoad(trailTex,vec2i(fp.xy),0);
}
@fragment fn blitWindfs(@builtin(position) fp:vec4f)->@location(0) vec4f{
  let c=textureLoad(trailTex,vec2i(fp.xy),0);
  // Premultiply for transparent wind overlay above the land layer.
  return vec4f(c.rgb*c.a,c.a);
}`;
        const module=dev.createShaderModule({code});
        module.getCompilationInfo&&module.getCompilationInfo().then(info=>{
          for(const m of info.messages||[]){
            if(m.type==='error') console.error('[particles WGSL] line '+m.lineNum+': '+m.message);
          }
        });
        _gpuP.computePipe=dev.createComputePipeline({layout:'auto',compute:{module,entryPoint:'cmain'}});
        const lineVertexState={module,entryPoint:'lvs',buffers:[{
          arrayStride:32,stepMode:'instance',attributes:[
            {shaderLocation:0,offset:0,format:'float32x4'},
            {shaderLocation:1,offset:16,format:'float32x4'}]}]};
        // CORE pass: normal alpha blending. This is what actually paints a
        // continuous line out of sub-pixel per-frame motion (see the long
        // comment above lfs_core/lfs_glow in the WGSL for why additive
        // alone can't do this — it was producing a field of bright dots).
        _gpuP.linePipe=dev.createRenderPipeline({layout:'auto',
          vertex:lineVertexState,
          fragment:{module,entryPoint:'lfs_core',targets:[{format:'rgba8unorm',
            blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},
                   alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},
          primitive:{topology:'triangle-list'}});
        // GLOW pass: additive, drawn on top of the already-solid core in the
        // same trail texture. This is the accent that makes dense/fast flow
        // regions luminous, matching the CPU version's low-alpha 'lighter'
        // glow overlay — never the sole source of a line's visibility.
        _gpuP.lineGlowPipe=dev.createRenderPipeline({layout:'auto',
          vertex:lineVertexState,
          fragment:{module,entryPoint:'lfs_glow',targets:[{format:'rgba8unorm',
            blend:{color:{srcFactor:'one',dstFactor:'one'},
                   alpha:{srcFactor:'one',dstFactor:'one'}}}]},
          primitive:{topology:'triangle-list'}});
        // MULTIPLY pass: trail *= blendConstant (asymptotic decay, keeps the
        // shape of the fade). Uses a null fragment output; only the blend
        // constant matters here, so a trivial shader entry is fine.
        _gpuP.fadePipe=dev.createRenderPipeline({layout:'auto',
          vertex:{module,entryPoint:'fsvs'},
          fragment:{module,entryPoint:'fadeMulFs',targets:[{format:'rgba8unorm',
            blend:{color:{srcFactor:'zero',dstFactor:'constant'},
                   alpha:{srcFactor:'zero',dstFactor:'constant'}}}]},
          primitive:{topology:'triangle-list'}});
        // SUBTRACT pass: trail = trail - fadeSub (reverse-subtract: dst-src),
        // run right after the multiply. This is the true-zero floor that
        // clears faint ghost residue the multiply alone leaves behind.
        _gpuP.fadeSubPipe=dev.createRenderPipeline({layout:'auto',
          vertex:{module,entryPoint:'fsvs'},
          fragment:{module,entryPoint:'fadefs',targets:[{format:'rgba8unorm',
            blend:{color:{operation:'reverse-subtract',srcFactor:'one',dstFactor:'one'},
                   alpha:{operation:'reverse-subtract',srcFactor:'one',dstFactor:'one'}}}]},
          primitive:{topology:'triangle-list'}});
        _gpuP.blitPipe=dev.createRenderPipeline({layout:'auto',
          vertex:{module,entryPoint:'fsvs'},
          fragment:{module,entryPoint:'blitfs',targets:[{format:fmt}]},
          primitive:{topology:'triangle-list'}});
        _gpuP.blitWindPipe=dev.createRenderPipeline({layout:'auto',
          vertex:{module,entryPoint:'fsvs'},
          fragment:{module,entryPoint:'blitWindfs',targets:[{format:fmt}]},
          primitive:{topology:'triangle-list'}});

        // ── Static grids (uploaded once; fixed after initFlowField) ──
        const NCELLS=GW*GH;
        const velData=new Float32Array(NCELLS*4);
        for(let k=0;k<NCELLS;k++){
          velData[k*4]=U[k]; velData[k*4+1]=V[k];
          velData[k*4+2]=WU[k]; velData[k*4+3]=WV[k];
        }
        const velBuf=dev.createBuffer({size:velData.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
        dev.queue.writeBuffer(velBuf,0,velData);
        _gpuP.velBuf=velBuf;  // stored so _applyFieldState can re-upload after a field swap
        // Merged into one vec2i-per-cell buffer (.x=ocean class,.y=wind
        // class) — see clsWclsG in WGSL for why (storage-buffer-count limit).
        const clsWclsData=new Int32Array(NCELLS*2);
        for(let k=0;k<NCELLS;k++){ clsWclsData[k*2]=CLS[k]; clsWclsData[k*2+1]=WCls[k]; }
        const clsWclsBuf=dev.createBuffer({size:clsWclsData.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
        dev.queue.writeBuffer(clsWclsBuf,0,clsWclsData);
        const landData=new Uint32Array(NCELLS); for(let k=0;k<NCELLS;k++)landData[k]=LAND[k];
        const landBuf=dev.createBuffer({size:landData.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
        dev.queue.writeBuffer(landBuf,0,landData);

        // ── Spawn tables (weighted lists, flattened, per-class offsets) ──
        const tab=[]; const meta=new Uint32Array(NCLS*2); const counts=new Uint32Array(NCLS);
        let off=0;
        for(let cc=0;cc<NCLS;cc++){
          const lst=(_spawnReady&&spawnW[cc]&&spawnW[cc].length)?spawnW[cc]:spawnByClass[cc];
          meta[cc*2]=off; meta[cc*2+1]=lst.length; counts[cc]=lst.length;
          for(let j=0;j<lst.length;j++){ tab.push(lst[j][0],lst[j][1]); }
          off+=lst.length;
        }
        _gpuP.spawnCounts=counts;
        const tabArr=new Float32Array(tab.length?tab:[0,0]);
        const spawnTabBuf=dev.createBuffer({size:tabArr.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
        dev.queue.writeBuffer(spawnTabBuf,0,tabArr);
        const spawnMetaBuf=dev.createBuffer({size:meta.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
        dev.queue.writeBuffer(spawnMetaBuf,0,meta);

        // ── Particle + params buffers, LUT texture ──
        // STORAGE for the compute pass, VERTEX for the instanced draw —
        // reading particles as vertex attributes (not vertex-stage storage,
        // which has a zero limit on many devices and fails validation).
        _gpuP.partBuf=dev.createBuffer({size:40000*32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
        _gpuP.zeroSeed=new Float32Array(40000*8); // sized to max MAXP
        _gpuP.paramsBuf=dev.createBuffer({size:176,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
        // 10 rows: 0-3=ocean classes,4-6=wind classes,7=jets,
        // 8=ocean-compare,9=wind-compare. Rows 0-6 each independently
        // honour a per-class colormap override (Earth Systems picker).
        _gpuP.lut=dev.createTexture({size:[256,10],format:'rgba8unorm',
          usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});

        // Channel 3 (jets) velocity buffer — vec2f per cell, always uploaded
        // (zeros when jets is off; cheap, avoids a buffer-recreate + bind
        // group rebuild every time the toggle flips).
        const velCData=new Float32Array(NCELLS*2);
        for(let k=0;k<NCELLS;k++){ velCData[k*2]=JU[k]; velCData[k*2+1]=JV[k]; }
        const velCBuf=dev.createBuffer({size:velCData.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
        dev.queue.writeBuffer(velCBuf,0,velCData);
        _gpuP.velCBuf=velCBuf;

        // Compare-mode custom field — vec4f per cell (.xy=custom-ocean,
        // .zw=custom-wind), always uploaded (zeros when compare is off).
        // Seeded from whatever's already in Uc/Vc/WUc/WVc so a field
        // loaded+compared before the first WebGPU init still shows correctly.
        const velCmpData=new Float32Array(NCELLS*4);
        for(let k=0;k<NCELLS;k++){
          velCmpData[k*4]=Uc[k]; velCmpData[k*4+1]=Vc[k];
          velCmpData[k*4+2]=WUc[k]; velCmpData[k*4+3]=WVc[k];
        }
        const velCmpBuf=dev.createBuffer({size:velCmpData.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
        dev.queue.writeBuffer(velCmpBuf,0,velCmpData);
        _gpuP.velCmpBuf=velCmpBuf;

        _gpuP.bgCompute=dev.createBindGroup({layout:_gpuP.computePipe.getBindGroupLayout(0),entries:[
          {binding:0,resource:{buffer:_gpuP.paramsBuf}},
          {binding:1,resource:{buffer:velBuf}},
          {binding:2,resource:{buffer:clsWclsBuf}},
          {binding:4,resource:{buffer:landBuf}},
          {binding:5,resource:{buffer:spawnTabBuf}},
          {binding:6,resource:{buffer:spawnMetaBuf}},
          {binding:7,resource:{buffer:_gpuP.partBuf}},
          {binding:8,resource:{buffer:velCBuf}},
          {binding:11,resource:{buffer:velCmpBuf}},
        ]});
        _gpuP.bgLine=dev.createBindGroup({layout:_gpuP.linePipe.getBindGroupLayout(0),entries:[
          {binding:0,resource:{buffer:_gpuP.paramsBuf}},
          {binding:9,resource:_gpuP.lut.createView()},
        ]});
        // 'auto' bind-group layouts are per-pipeline in WebGPU — a bind group
        // built against linePipe's layout is not valid for lineGlowPipe even
        // though the WGSL bindings are identical, so this needs its own.
        _gpuP.bgLineGlow=dev.createBindGroup({layout:_gpuP.lineGlowPipe.getBindGroupLayout(0),entries:[
          {binding:0,resource:{buffer:_gpuP.paramsBuf}},
          {binding:9,resource:_gpuP.lut.createView()},
        ]});
        // Subtract-fade pass needs params (P.fadeSub) at binding 0.
        _gpuP.bgFadeSub=dev.createBindGroup({layout:_gpuP.fadeSubPipe.getBindGroupLayout(0),entries:[
          {binding:0,resource:{buffer:_gpuP.paramsBuf}},
        ]});
        const verr=await dev.popErrorScope();
        if(verr) throw new Error('WebGPU validation during init: '+verr.message);
        _gpuP.clearTrail=true; _gpuP.clearTrailW=true; _gpuP.resetParticles=true; _gpuP.lutKey='';
        _gpuP.frameCount=0;
        // blitPipe is brand-new every init, but bgBlit is only rebuilt lazily
        // in _gpuPFrame() when the trail canvas size changes. Force that check
        // to fail on the next frame so bgBlit is always rebuilt against this
        // init's blitPipe, never a stale one from a previous init.
        _gpuP.trailW=-1; _gpuP.trailH=-1;
        _gpuP.trailWW=-1; _gpuP.trailWH=-1;
        _gpuP.wgslVer=_GPU_WGSL_VER;
        _gpuP.ready=true;
        console.log('[particles] GPU-resident particle system ready.');
      }catch(e){
        console.warn('[particles] GPU particle init failed — staying on CPU:',e.message);
        _gpuP.failed=true;
        if(_gpuP.canvas){ try{_gpuP.canvas.remove();}catch(_){} _gpuP.canvas=null; }
      }
      _gpuP.initializing=false;
    }

    function _gpuPBuildLUT(){
      const cfg=window._flowCfg||{};
      const cft=window._customFieldTheme||{};
      const cfa=window._customFieldActive||{};
      const ccm=window._classColormap||{};
      // Per-class keys (rows 0-6) included unconditionally; compare rows
      // (8,9) depend on the loaded-field colormap picks regardless of swap
      // state, unlike the plain per-class rows which only honour cft in
      // swap mode (via getOceanTheme/getWindTheme's own cfa check).
      const key=(cfg.oceanTheme||'ocean')+'|'+(cfg.windTheme||'wind_white')+'|'+(cfa.ocean?(cft.ocean||''):'')+'|'+(cfa.wind?(cft.wind||''):'')+'|cmp:'+(cft.ocean||'')+','+(cft.wind||'')+'|cls:'+[0,1,2,3,4,5,6,7].map(c=>ccm[c]||'').join(',');
      if(_gpuP.lutKey===key) return;
      _gpuP.lutKey=key;
      const oc=getOceanTheme(), wc=getWindTheme();
      const cmpOc=getCompareTheme('ocean'), cmpWc=getCompareTheme('wind');
      const data=new Uint8Array(256*10*4);
      function pickCol(t,cls,layerTheme){
        const ov=classCmapOverride(cls);
        if(ov&&ov.cmap) return ov.cmap(t);
        // Flat-streak themes (wind_yellow/wind_cyan/wind_white) have no
        // cmap function, just a fixed color — honour that too, or picking
        // one of them from the per-class dropdown would silently no-op.
        if(ov&&ov.streak) return ov.streak;
        if(layerTheme.cmap) return layerTheme.cmap(t);
        if(layerTheme.streak) return layerTheme.streak;
        return speedColor(t*1.5,cls);
      }
      for(let i2=0;i2<256;i2++){
        const t=Math.min(0.999,i2/255);
        // Rows 0-3: ocean classes (warm/cold/acc/gyres) — per-class override
        // or the ocean theme's own colormap/streak/default.
        for(let cls=0;cls<4;cls++){
          const col=pickCol(t,cls,oc);
          const o=(cls*256+i2)*4;
          data[o]=col[0];data[o+1]=col[1];data[o+2]=col[2];data[o+3]=255;
        }
        // Rows 4-6: wind classes (trades/westerlies/polar) — same, wind theme.
        for(let cls=4;cls<7;cls++){
          const col=pickCol(t,cls,wc);
          const o=(cls*256+i2)*4;
          data[o]=col[0];data[o+1]=col[1];data[o+2]=col[2];data[o+3]=255;
        }
        // Row 7: jets — per-class override if picked, else the dedicated
        // violet→white ramp (jets have no "layer theme" to fall back to,
        // unlike ocean/wind classes, since they were never swappable via
        // the main theme selectors).
        const jov=classCmapOverride(7);
        const jcol=(jov&&jov.cmap)?jov.cmap(t):(jov&&jov.streak)?jov.streak:speedColor(t*1.5,7);
        const o3=(7*256+i2)*4;
        data[o3]=jcol[0];data[o3+1]=jcol[1];data[o3+2]=jcol[2];data[o3+3]=255;
        // Rows 8/9: compare-mode custom ocean/wind — distinct colormap so
        // the loaded field visually stands apart from the embedded one.
        let ccol;
        if(cmpOc.cmap) ccol=cmpOc.cmap(t);
        else if(cmpOc.streak) ccol=cmpOc.streak;
        else ccol=speedColor(t*1.5,0);
        const o4=(8*256+i2)*4;
        data[o4]=ccol[0];data[o4+1]=ccol[1];data[o4+2]=ccol[2];data[o4+3]=255;
        let wccol;
        if(cmpWc.cmap) wccol=cmpWc.cmap(t);
        else if(cmpWc.streak) wccol=cmpWc.streak;
        else wccol=speedColor(t*1.5,4);
        const o5=(9*256+i2)*4;
        data[o5]=wccol[0];data[o5+1]=wccol[1];data[o5+2]=wccol[2];data[o5+3]=255;
      }
      _gpuP.dev.queue.writeTexture({texture:_gpuP.lut},data,{bytesPerRow:256*4,rowsPerImage:10},[256,10]);
    }

    function _gpuPFrame(en,cfg,active,oDensity,fade,oceanOp,windOp,oceanSwapActive,windSwapActive,wDensity,cDensity,cmpOcean,cmpWind){
      const dev=_gpuP.dev, c=_gpuP.canvas, wc=_gpuP.windCanvas;
      const wCount=Math.max(0,active-oDensity);
      const windOn=en[4]||en[5]||en[6]||en[7];
      // Match the 2D canvas' device-pixel size
      const W=cnv.width,H=cnv.height;
      if(c.width!==W||c.height!==H){ c.width=W; c.height=H; _gpuP.trailW=0; }
      if(wc&&(wc.width!==W||wc.height!==H)){ wc.width=W; wc.height=H; _gpuP.trailWW=0; }
      if(_gpuP.trailW!==W||_gpuP.trailH!==H){
        try{_gpuP.trailTex?.destroy();}catch(_){}
        _gpuP.trailTex=dev.createTexture({size:[W,H],format:'rgba8unorm',
          usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
        _gpuP.trailView=_gpuP.trailTex.createView();
        _gpuP.bgBlit=dev.createBindGroup({layout:_gpuP.blitPipe.getBindGroupLayout(0),entries:[
          {binding:10,resource:_gpuP.trailView}]});
        _gpuP.trailW=W; _gpuP.trailH=H; _gpuP.clearTrail=true;
      }
      if(_gpuP.trailWW!==W||_gpuP.trailWH!==H){
        try{_gpuP.trailTexW?.destroy();}catch(_){}
        _gpuP.trailTexW=dev.createTexture({size:[W,H],format:'rgba8unorm',
          usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
        _gpuP.trailViewW=_gpuP.trailTexW.createView();
        _gpuP.bgBlitWind=dev.createBindGroup({layout:_gpuP.blitWindPipe.getBindGroupLayout(0),entries:[
          {binding:10,resource:_gpuP.trailViewW}]});
        _gpuP.trailWW=W; _gpuP.trailWH=H; _gpuP.clearTrailW=true;
      }
      c.style.display='';
      if(wc) wc.style.display=(windOn&&wCount>0)?'':'none';
      if(dragging){
        // Same as CPU path: no particles during drag, ocean disc repainted.
        ctx.clearRect(0,0,cnv.width,cnv.height); paintOcean(); _canvasRot0=null;
        _gpuP.clearTrail=true; _gpuP.clearTrailW=true;
        const enc0=dev.createCommandEncoder();
        const p0=enc0.beginRenderPass({colorAttachments:[{view:_gpuP.gctx.getCurrentTexture().createView(),
          clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
        p0.end();
        if(wc){
          const p1=enc0.beginRenderPass({colorAttachments:[{view:_gpuP.windGctx.getCurrentTexture().createView(),
            clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
          p1.end();
        }
        dev.queue.submit([enc0.finish()]);
        return;
      }
      // Zoom/translate change → repaint disc + clear trails (shared trackers)
      const tr=projection.translate(), sc=projection.scale();
      if(_flowTr0===null||Math.abs(tr[0]-_flowTr0)>0.5||Math.abs(tr[1]-_flowTr1)>0.5||Math.abs(sc-_flowSc0)>0.5){
        _canvasRot0=null;
        _flowTr0=tr[0]; _flowTr1=tr[1]; _flowSc0=sc;
      }
      if(window._syncFlowClip) window._syncFlowClip(tr[0],tr[1],sc);
      const cr=projection.rotate();
      if(_canvasRot0===null) _flowRotAccum=999;
      else {
        let dLon=Math.abs(cr[0]-_canvasRot0), dLat=Math.abs(cr[1]-_canvasRot1);
        if(dLon>180) dLon=360-dLon;
        _flowRotAccum+=Math.hypot(dLon,dLat);
      }
      const rotated=_flowRotAccum>=7;
      if(rotated){
        ctx.clearRect(0,0,cnv.width,cnv.height); paintOcean();
        _canvasRot0=cr[0]; _canvasRot1=cr[1]; _flowRotAccum=0;
        _gpuP.clearTrail=true; _gpuP.clearTrailW=true;
      }
      if(_gpuP.resetParticles){
        dev.queue.writeBuffer(_gpuP.partBuf,0,_gpuP.zeroSeed);
        _gpuP.resetParticles=false;
      }
      _gpuPBuildLUT();
      // ── Params ──
      const th=getOceanTheme(), wth=getWindTheme();
      // When a layer's custom field has fully swapped in for the embedded
      // baseline (no side-by-side compare), use its own "Loaded
      // currents/winds" appearance settings instead of the regular tab's.
      const oSpeedEff=oceanSwapActive?(cfg.cOceanSpeed??1):(cfg.oSpeed??1);
      const wSpeedEff=windSwapActive?(cfg.cWindSpeed??1.1):(cfg.wSpeed??1.1);
      const oTurbEff=oceanSwapActive?(cfg.cOceanTurb??0.012):(cfg.oTurb??0.018);
      const wTurbEff=windSwapActive?(cfg.cWindTurb??0.018):(cfg.wTurb??0.018);
      const oWidthEff=oceanSwapActive?(cfg.cOceanWidth??0.9):(cfg.oWidth??1.0);
      const wWidthEff=windSwapActive?(cfg.cWindWidth??0.75):(cfg.wWidth??0.7);
      const wFadeEff=windSwapActive?(cfg.cWindFade??0.968):(cfg.wFade??0.968);
      // Compare-mode (side-by-side loaded field) appearance — always reads
      // the cOcean*/cWind* "Loaded currents/winds" sliders directly (not
      // swap-gated like oSpeedEff/etc above, since compare and swap are
      // mutually exclusive: when compare is on, swap is always off for
      // that target). Mirrors the CPU path's apCustom branch exactly.
      const cmpOcTheme=getCompareTheme('ocean'), cmpWcTheme=getCompareTheme('wind');
      const cmpOceanSpeed=cfg.cOceanSpeed??1.0;
      const cmpWindSpeedV=cfg.cWindSpeed??1.1;
      const cmpOceanTurb=cfg.cOceanTurb??0.012;
      const cmpWindTurbV=cfg.cWindTurb??0.018;
      // Ocean-compare reuses the embedded per-class baseAlpha buckets,
      // scaled by the ratio between the loaded field's opacity slider and
      // the embedded layer's — keeps the same warm/cold/acc/gyres relative
      // variation while still responding to cOceanOp independently.
      const cmpOceanAlphaScale=(cfg.cOceanOp??oceanOp)/Math.max(0.0001,oceanOp);
      // Wind-compare has no per-class buckets to scale (alphaW is a single
      // value), so compute it directly — same formula as the embedded
      // alphaW line below, just against cWindOp instead of windOp.
      const cmpWindAlpha=Math.min(0.95,0.62*((cfg.cWindOp??windOp)*2));
      const cmpOceanLw=cmpOcTheme.lineWidth*(cfg.cOceanWidth??cfg.oWidth??1.0)*dpr;
      const cmpWindLw=cmpWcTheme.lineWidth*(cfg.cWindWidth??cfg.wWidth??0.7)*dpr;
      // GPU trail boost: longer particle life + slower fade = filament overlap
      // and coherent vortices matching the WebGL canvas path.
      // Reduced 5% from 1.55 per performance/visual-balance request.
      const trailBoost=1.4725;
      const maxAgeO=Math.round(maxAge*trailBoost);
      const maxAgeW=Math.round(Math.round(maxAge*(wFadeEff??0.920)/0.960)*trailBoost);
      let enMask=0; for(let cc=0;cc<NCLS;cc++) if(en[cc]) enMask|=(1<<cc);
      let oPack=0,oCnt=0,wPack=0,wCnt=0;
      for(let cc=0;cc<4;cc++) if(en[cc]&&_gpuP.spawnCounts[cc]>0){ oPack|=(cc<<(8*oCnt)); oCnt++; }
      // Class 7 (jets) deliberately excluded — it's channel 3's own fixed
      // class now (own slot, own velocity buffer, own respawnJet()), not
      // one of wind's pickable sub-classes.
      for(let cc=4;cc<7;cc++) if(en[cc]&&_gpuP.spawnCounts[cc]>0){ wPack|=(cc<<(8*wCnt)); wCnt++; }
      const phi0r=-cr[1]*Math.PI/180;
      // Persistent scratch — allocating a fresh ArrayBuffer+DataView every
      // frame (60/s) was pure GC churn; contents are fully overwritten below.
      const ab=(_gpuP.paramsAB||(_gpuP.paramsAB=new ArrayBuffer(176)));
      const dv=(_gpuP.paramsDV||(_gpuP.paramsDV=new DataView(ab)));
      let o=0;
      dv.setUint32(o,oDensity,true);o+=4; dv.setUint32(o,active,true);o+=4;
      dv.setUint32(o,(Math.random()*4294967295)>>>0,true);o+=4; dv.setUint32(o,enMask,true);o+=4;
      dv.setFloat32(o,maxAgeO,true);o+=4; dv.setFloat32(o,maxAgeW,true);o+=4;
      // Wind advection trimmed on the GPU path only (0.85, then a further
      // 15% to 0.72 per eyeballed polish feedback): GPU mode holds a
      // steady 60fps where the CPU canvas path typically runs slower, so
      // the SAME per-frame step reads visibly faster/busier there. Applies
      // to embedded wind + jets (P.wSpeed); the Loaded-winds compare
      // slider (cmpWindSpeed) stays untouched — that one is user-set.
      dv.setFloat32(o,oSpeedEff,true);o+=4; dv.setFloat32(o,wSpeedEff*0.72,true);o+=4;
      dv.setFloat32(o,oTurbEff,true);o+=4; dv.setFloat32(o,wTurbEff,true);o+=4;
      dv.setFloat32(o,cr[0],true);o+=4; dv.setFloat32(o,Math.cos(phi0r),true);o+=4;
      dv.setFloat32(o,Math.sin(phi0r),true);o+=4; dv.setFloat32(o,tr[0],true);o+=4;
      dv.setFloat32(o,tr[1],true);o+=4; dv.setFloat32(o,sc,true);o+=4;
      dv.setFloat32(o,W,true);o+=4; dv.setFloat32(o,H,true);o+=4;
      dv.setFloat32(o,dpr,true);o+=4; dv.setFloat32(o,th.lineWidth*oWidthEff*dpr,true);o+=4;
      dv.setFloat32(o,wth.lineWidth*wWidthEff*dpr,true);o+=4;
      // alphaW: bumped again (0.62->0.78 coefficient) — even with the
      // density-cap and line-width-floor fixes above, wind covers a much
      // larger screen area per particle than ocean and has no speed-paint
      // backdrop to lean on, so it needs a genuinely higher base alpha to
      // read clearly rather than just matching ocean's.
      dv.setFloat32(o,Math.min(0.95,0.78*(windOp*2)),true);o+=4; // alphaW
      dv.setUint32(o,oPack,true);o+=4; dv.setUint32(o,oCnt,true);o+=4;
      dv.setUint32(o,wPack,true);o+=4; dv.setUint32(o,wCnt,true);o+=4;
      // fadeSub: must guarantee ≥0.5 8-bit levels of total decay per frame
      // or the render target's rounding pins values in place. Lower value
      // here allows faint filament overlap to persist longer before clearing.
      dv.setFloat32(o,0.002,true);o+=4; dv.setFloat32(o,0,true);o+=4;
      dv.setUint32(o,wDensity,true);o+=4; dv.setUint32(o,cDensity,true);o+=4;
      // Fraction of the pool routed through the custom field, proportional
      // to the Loaded-currents/winds Particles slider vs the embedded
      // one — was a fixed 50/50 split regardless of that slider before.
      const cmpOceanFrac=cmpOcean?Math.max(0,Math.min(1,(cfg.cOceanDensity??14000)/((cfg.oDensity??14000)+(cfg.cOceanDensity??14000)))):0;
      const cmpWindFracV=cmpWind?Math.max(0,Math.min(1,(cfg.cWindDensity??3500)/((cfg.wDensity??3500)+(cfg.cWindDensity??3500)))):0;
      dv.setFloat32(o,cmpOceanFrac,true);o+=4; dv.setFloat32(o,cmpWindFracV,true);o+=4;
      const bA=[0.55,0.68,0.80,0.92];
      for(let cc=0;cc<4;cc++){ dv.setFloat32(o,Math.min(1,bA[cc]*oceanOp*1.25),true);o+=4; }
      dv.setFloat32(o,cmpOceanSpeed,true);o+=4; dv.setFloat32(o,cmpWindSpeedV,true);o+=4;
      dv.setFloat32(o,cmpOceanTurb,true);o+=4; dv.setFloat32(o,cmpWindTurbV,true);o+=4;
      dv.setFloat32(o,cmpOceanAlphaScale,true);o+=4; dv.setFloat32(o,cmpWindAlpha,true);o+=4;
      dv.setFloat32(o,cmpOceanLw,true);o+=4; dv.setFloat32(o,cmpWindLw,true);o+=4;
      dev.queue.writeBuffer(_gpuP.paramsBuf,0,ab);
      const wFade=wFadeEff??0.968;
      const oceanEffFade=Math.min(0.9992,1.0-(1.0-fade)*0.40);
      // Wind fade rate matches ocean's (0.40). An earlier attempt slowed
      // this to 0.28 to raise the trail's steady-state density, but
      // combined with the density/width/alpha fixes below it made the
      // buildup read as too aggressive (streaks over-thicken over time
      // instead of settling) — the width/alpha/density fixes alone were
      // already enough to fix the original "whisker" sparseness, so the
      // fade rate itself didn't need to change too.
      const windEffFade=Math.min(0.9992,1.0-(1.0-wFade)*0.40);
      function _gpuTrailFade(tp,clearFlag,effFade){
        if(clearFlag) return;
        tp.setPipeline(_gpuP.fadePipe);
        tp.setBlendConstant({r:effFade,g:effFade,b:effFade,a:effFade});
        tp.draw(3);
        tp.setPipeline(_gpuP.fadeSubPipe);
        tp.setBindGroup(0,_gpuP.bgFadeSub);
        tp.draw(3);
      }
      // ── One encoder: compute → ocean trail → wind trail → blits ──
      // Watch the first few frames with a validation scope: runtime
      // validation errors don't throw, so without this a broken frame
      // renders as a silent blank. Any error → log + revert to CPU.
      const watch=(_gpuP.frameCount||0)<8;
      if(watch) dev.pushErrorScope('validation');
      const enc=dev.createCommandEncoder();
      const cp=enc.beginComputePass();
      cp.setPipeline(_gpuP.computePipe); cp.setBindGroup(0,_gpuP.bgCompute);
      cp.dispatchWorkgroups(Math.ceil(active/64)); cp.end();
      const tp=enc.beginRenderPass({colorAttachments:[{view:_gpuP.trailView,
        clearValue:{r:0,g:0,b:0,a:0},
        loadOp:_gpuP.clearTrail?'clear':'load',storeOp:'store'}]});
      _gpuTrailFade(tp,_gpuP.clearTrail,oceanEffFade);
      tp.setVertexBuffer(0,_gpuP.partBuf);
      tp.setPipeline(_gpuP.linePipe); tp.setBindGroup(0,_gpuP.bgLine);
      tp.draw(6,oDensity,0,0);
      tp.setPipeline(_gpuP.lineGlowPipe); tp.setBindGroup(0,_gpuP.bgLineGlow);
      tp.draw(6,oDensity,0,0);
      tp.end();
      const bp=enc.beginRenderPass({colorAttachments:[{view:_gpuP.gctx.getCurrentTexture().createView(),
        clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
      bp.setPipeline(_gpuP.blitPipe); bp.setBindGroup(0,_gpuP.bgBlit);
      bp.draw(3); bp.end();
      if(windOn&&wCount>0&&wc){
        const tpw=enc.beginRenderPass({colorAttachments:[{view:_gpuP.trailViewW,
          clearValue:{r:0,g:0,b:0,a:0},
          loadOp:_gpuP.clearTrailW?'clear':'load',storeOp:'store'}]});
        _gpuTrailFade(tpw,_gpuP.clearTrailW,windEffFade);
        tpw.setVertexBuffer(0,_gpuP.partBuf);
        tpw.setPipeline(_gpuP.linePipe); tpw.setBindGroup(0,_gpuP.bgLine);
        tpw.draw(6,wCount,0,oDensity);
        tpw.setPipeline(_gpuP.lineGlowPipe); tpw.setBindGroup(0,_gpuP.bgLineGlow);
        tpw.draw(6,wCount,0,oDensity);
        tpw.end();
        const bpw=enc.beginRenderPass({colorAttachments:[{view:_gpuP.windGctx.getCurrentTexture().createView(),
          clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
        bpw.setPipeline(_gpuP.blitWindPipe); bpw.setBindGroup(0,_gpuP.bgBlitWind);
        bpw.draw(3); bpw.end();
      }
      dev.queue.submit([enc.finish()]);
      if(watch){
        _gpuP.frameCount=(_gpuP.frameCount||0)+1;
        dev.popErrorScope().then(err=>{
          if(err&&!_gpuP.failed){
            console.warn('[particles] WebGPU validation error — reverting to CPU:',err.message);
            _gpuP.failed=true;
            if(_gpuP.canvas) _gpuP.canvas.style.display='none';
            if(_gpuP.windCanvas) _gpuP.windCanvas.style.display='none';
          }
        });
      }
      _gpuP.clearTrail=false; _gpuP.clearTrailW=false;
    }

    // ════ CUSTOM VELOCITY FIELD LOADER ═══════════════════════════
    // Loads an external uint8-quantized velocity field — same scheme as
    // the embedded CMEMS ocean / ERA5 wind data (b64 string of interleaved
    // [u,v] byte pairs, row-major over a global nx×ny grid, decoded as
    // value=(byte-128)*(vmax/127.5)) — and substitutes it for either the
    // ocean or wind field. Meant for comparing trajectories from a custom
    // field (e.g. a different time period or model run) against the
    // embedded long-term-mean data. The CPU particle path picks up changes
    // immediately (it reads these arrays fresh every frame); the GPU path
    // is invalidated so it re-uploads its static grid buffers next frame.
    const _origField={
      ocean:{U:U.slice(),V:V.slice(),CLS:CLS.slice(),spawn:spawnByClass.slice(0,4).map(a=>a.slice())},
      wind:{WU:WU.slice(),WV:WV.slice(),WCls:WCls.slice(),spawn:spawnByClass.slice(4,7).map(a=>a.slice())}
    };
    function _resampleCustomField(json){
      const b64=json.b64; if(!b64) throw new Error('JSON has no "b64" field');
      const nx=json.nx||json.nlon||360, ny=json.ny||json.nlat||180;
      const vmax=json.vmax??json.VMAX??2.5;
      const HALF=128, SCALE=vmax/127.5;
      const raw=atob(b64);
      const need=nx*ny*2;
      if(raw.length<need) throw new Error(`b64 too short: ${raw.length} bytes, need ${need} for nx=${nx} ny=${ny}`);
      // Bilinear resample from the source nx×ny global grid onto our
      // working GW×GH grid — identical scheme to the CMEMS/ERA5 decoders
      // above, generalised from their hardcoded 360×180 to arbitrary nx/ny.
      const outU=new Float32Array(GW*GH), outV=new Float32Array(GW*GH);
      for(let y=0;y<GH;y++){
        const la=-90+(y+0.5)*CELL;
        const gy=(la+90)*ny/180;
        const y0=Math.max(0,Math.min(ny-2,Math.floor(gy)));
        const y1=y0+1;
        const fy=gy-y0;
        for(let x=0;x<GW;x++){
          const lo=-180+(x+0.5)*CELL;
          const gx=(((lo+180)%360+360)%360)*nx/360;
          const x0=Math.floor(gx)%nx;
          const x1=(x0+1)%nx;
          const fx=gx-Math.floor(gx);
          const i00=(y0*nx+x0)*2, i01=(y0*nx+x1)*2;
          const i10=(y1*nx+x0)*2, i11=(y1*nx+x1)*2;
          const u=((raw.charCodeAt(i00  )-HALF)*(1-fx)*(1-fy)+
                   (raw.charCodeAt(i01  )-HALF)*fx    *(1-fy)+
                   (raw.charCodeAt(i10  )-HALF)*(1-fx)*fy    +
                   (raw.charCodeAt(i11  )-HALF)*fx    *fy    )*SCALE;
          const v=((raw.charCodeAt(i00+1)-HALF)*(1-fx)*(1-fy)+
                   (raw.charCodeAt(i01+1)-HALF)*fx    *(1-fy)+
                   (raw.charCodeAt(i10+1)-HALF)*(1-fx)*fy    +
                   (raw.charCodeAt(i11+1)-HALF)*fx    *fy    )*SCALE;
          outU[y*GW+x]=u; outV[y*GW+x]=v;
        }
      }
      return {outU,outV};
    }
    function _invalidateFieldCaches(){
      // GPU-resident buffers (velocity/class/land grids) are only uploaded
      // once at init — flip these flags so _gpuPInit() rebuilds them from
      // the current U/V/WU/WV/CLS/WCls arrays on the next frame.
      _gpuP.ready=false; _gpuP.initializing=false;
      try{ if(_gpuP.canvas) _gpuP.canvas.style.display='none'; }catch(e){}
      pAlive.fill(0);        // force every CPU particle to respawn into the new field
      _canvasRot0=null;      // clear stale trails so old/new fields don't smear together
      // _gpuPInit() rebuilds ALL pipelines fresh (fadePipe, linePipe, blitPipe...),
      // but _gpuP.bgBlit is only rebuilt lazily in _gpuPFrame() when the trail
      // canvas size changes. Since the canvas size is usually unchanged across a
      // field reload, bgBlit would otherwise keep pointing at the just-destroyed
      // old blitPipe's bind-group layout while blitPipe itself is a brand-new
      // pipeline object — triggering a "bind group not created by this pipeline"
      // WebGPU validation error on the next blit draw. Forcing a size mismatch
      // here guarantees bgBlit gets rebuilt against the fresh blitPipe.
      _gpuP.trailW=-1; _gpuP.trailH=-1;
      _gpuP.trailWW=-1; _gpuP.trailWH=-1;
    }
    // Exposed so panel controls (e.g. the custom-field colormap picker) can
    // force a clean repaint after changing how a field is drawn.
    window._invalidateFieldCaches=_invalidateFieldCaches;
    // Cache of resampled custom fields, kept in memory so the Earth Systems
    // toggle can flip between "custom" and "embedded" instantly without
    // re-reading the file. Populated by _loadCustomVelocityField.
    window._customFieldCache={ocean:null,wind:null};
    // Warm(0)/cold(1) classification branches on the SIGN of v (meridional
    // velocity) — a fine distinction for currents with a genuine north-
    // south component (Gulf Stream, Kuroshio), but near the equator (and
    // anywhere flow is mostly zonal, e.g. the Equatorial Countercurrent)
    // v is small and its sign is essentially noise, so adjacent cells can
    // land in different classes even though the underlying current field
    // is continuous. That's what shows up as a checkerboard/grid-aligned
    // patchwork once a high-contrast colormap makes the class boundary
    // visible. A 3x3 majority-vote pass over CLS (not over U/V — particle
    // physics is untouched) smooths that noise out while leaving genuinely
    // coherent regions (ACC, gyres, real warm/cold boundaries) unchanged,
    // since a real region's neighborhood already agrees with itself.
    function _smoothOceanClass(){
      const src=CLS.slice();
      const counts=new Int32Array(4);
      for(let y=0;y<GH;y++){
        for(let x=0;x<GW;x++){
          const k=y*GW+x;
          if(LAND[k]) continue;
          counts.fill(0);
          for(let dy=-1;dy<=1;dy++){
            const ny=y+dy; if(ny<0||ny>=GH) continue;
            for(let dx=-1;dx<=1;dx++){
              const nx=((x+dx)%GW+GW)%GW;
              const nk=ny*GW+nx;
              if(LAND[nk]) continue;
              counts[src[nk]]++;
            }
          }
          let best=src[k], bestCount=-1;
          for(let c=0;c<4;c++){ if(counts[c]>bestCount){ bestCount=counts[c]; best=c; } }
          CLS[k]=best;
        }
      }
      for(let c=0;c<4;c++) spawnByClass[c].length=0;
      for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
        const k=y*GW+x; if(LAND[k]) continue;
        spawnByClass[CLS[k]].push([-180+(x+0.5)*CELL,-90+(y+0.5)*CELL]);
      }
    }
    function _classifyOcean(){
      for(let c=0;c<4;c++) spawnByClass[c].length=0;
      for(let k=0;k<GW*GH;k++){
        if(LAND[k]) continue;
        const spd=Math.hypot(U[k],V[k]);
        const y=Math.floor(k/GW), x=k-y*GW;
        const la=-90+(y+0.5)*CELL, lo=-180+(x+0.5)*CELL;
        // Previously `continue`d here before reaching the spawnByClass push
        // below — slow-current cells (spd<0.02, common near the equator,
        // e.g. weak equatorial countercurrent zones) got a class (0) but
        // could never actually spawn a particle. Since buildWeightedSpawn's
        // reps=max(1,round(1+mag*5)) already handles near-zero speed with
        // a single spawn point, the exclusion was pure loss — it's what
        // produced the grid-aligned dark patches near the equator.
        let cls;
        if(spd<0.02){ cls=0; }
        else {
          const absLat=Math.abs(la);
          if(absLat>45) cls=2;
          else if(spd<0.08) cls=3;
          else if((V[k]>0&&la>0)||(V[k]<0&&la<0)) cls=0;
          else cls=1;
        }
        CLS[k]=cls;
        spawnByClass[cls].push([lo,la]);
      }
      _smoothOceanClass();
    }
    function _classifyWind(){
      for(let k=0;k<GW*GH;k++){
        const y=Math.floor(k/GW), la=-90+(y+0.5)*CELL, absLat=Math.abs(la);
        // Same fix as _classifyOcean: a cell whose quantized wind rounds to
        // exactly (0,0) still gets a latitude-band class instead of -1, so
        // it stays spawnable (same single-spawn-point floor from
        // buildWeightedSpawn as any other slow cell). The >82° pole-strip
        // exclusion is intentional — left alone (grid singularity there).
        WCls[k]=absLat<28?4:(absLat<58?5:(absLat<82?6:-1));
      }
      for(let c=4;c<7;c++) spawnByClass[c].length=0;
      for(let k=0;k<GW*GH;k++){
        const c=WCls[k]; if(c<0) continue;
        const y=Math.floor(k/GW), x=k-y*GW;
        spawnByClass[c].push([-180+(x+0.5)*CELL,-90+(y+0.5)*CELL]);
      }
    }
    // Applies either the cached custom field or the embedded backup to the
    // live U/V/CLS (or WU/WV/WCls) arrays — this is what the Earth Systems
    // toggle calls, and it's instant (no re-parsing, no re-resampling).
    // Also re-uploads the GPU vel buffer so WebGPU particles see the new
    // field without needing a full pipeline rebuild.
    function _gpuPushVelBuf(){
      // Push the current U/V/WU/WV arrays into the GPU-resident velBuf so
      // WebGPU particles read the correct field without a full pipeline reinit.
      // If the GPU isn't ready or the buffer hasn't been allocated yet
      // (init races the first custom-field load), this is a no-op; the
      // regular _invalidateFieldCaches() path will rebuild from scratch.
      if(!_gpuP.ready||!_gpuP.velBuf||!_gpuP.dev) return;
      try{
        const NCELLS=GW*GH;
        const velData=new Float32Array(NCELLS*4);
        for(let k=0;k<NCELLS;k++){
          velData[k*4]=U[k]; velData[k*4+1]=V[k];
          velData[k*4+2]=WU[k]; velData[k*4+3]=WV[k];
        }
        _gpuP.dev.queue.writeBuffer(_gpuP.velBuf,0,velData);
        // Force all GPU particles to respawn so stale trajectories from the
        // old field don't persist under the new data.
        _gpuP.resetParticles=true; _gpuP.clearTrail=true; _gpuP.clearTrailW=true;
        console.log('[custom field] GPU velBuf updated — particles will respawn');
      }catch(e){ console.warn('[custom field] GPU velBuf update failed:',e.message); }
    }
    window._customFieldActive={ocean:false,wind:false};
    window._applyFieldState=function(target,useCustom){
      const cache=window._customFieldCache[target];
      if(useCustom&&!cache) return false;
      // Swap and compare are mutually exclusive views of the same slot —
      // switching to a plain swap turns compare off for this target.
      if(window._compareActive) window._compareActive[target]=false;
      if(target==='wind'){
        if(useCustom){ WU.set(cache.WU); WV.set(cache.WV); }
        else { WU.set(_origField.wind.WU); WV.set(_origField.wind.WV); }
        _classifyWind();
      } else {
        if(useCustom){ U.set(cache.U); V.set(cache.V); }
        else { U.set(_origField.ocean.U); V.set(_origField.ocean.V); }
        _classifyOcean();
      }
      window._customFieldActive[target]=!!useCustom;
      rebuildSpawnWeights();
      // Push new field data to GPU without a full pipeline reinit — the
      // embedded velBuf is used regardless of compare state (compare now
      // has its own GPU channel too, see _gpuPushCmpVelBuf).
      _gpuPushVelBuf();
      _invalidateFieldCaches();
      return true;
    };
    function _gpuPushCmpVelBuf(){
      // Mirrors _gpuPushVelBuf but for the compare-mode custom channel
      // (velCmp): pushes current Uc/Vc/WUc/WVc so GPU-resident compare
      // particles see the loaded field without a full pipeline reinit.
      if(!_gpuP.ready||!_gpuP.velCmpBuf||!_gpuP.dev) return;
      try{
        const NCELLS=GW*GH;
        const velCmpData=new Float32Array(NCELLS*4);
        for(let k=0;k<NCELLS;k++){
          velCmpData[k*4]=Uc[k]; velCmpData[k*4+1]=Vc[k];
          velCmpData[k*4+2]=WUc[k]; velCmpData[k*4+3]=WVc[k];
        }
        _gpuP.dev.queue.writeBuffer(_gpuP.velCmpBuf,0,velCmpData);
        _gpuP.resetParticles=true; _gpuP.clearTrail=true; _gpuP.clearTrailW=true;
        console.log('[custom field] GPU velCmpBuf updated — particles will respawn');
      }catch(e){ console.warn('[custom field] GPU velCmpBuf update failed:',e.message); }
    }
    // Copy the cached custom field into the parallel compare channel
    // (Uc/Vc or WUc/WVc) that both the CPU advect loop and the GPU velCmp
    // buffer read for the "custom" half of the particle pool.
    function _fillCompareChannel(target){
      const cache=window._customFieldCache[target];
      if(!cache) return false;
      if(target==='wind'){ WUc.set(cache.WU); WVc.set(cache.WV); }
      else { Uc.set(cache.U); Vc.set(cache.V); }
      _gpuPushCmpVelBuf();
      return true;
    }
    // Turn side-by-side compare on/off for a target. When on, the embedded
    // baseline is restored to the live field (so it flows on the even half
    // of the pool) and the custom field is loaded into the compare channel
    // (odd half). Returns false if no custom field is loaded for the target.
    window._setCompareState=function(target,on){
      if(on){
        if(!window._customFieldCache[target]) return false;
        // Ensure the embedded baseline is what's live in U/V (undo any swap).
        window._customFieldActive[target]=false;
        if(target==='wind'){ WU.set(_origField.wind.WU); WV.set(_origField.wind.WV); _classifyWind(); }
        else { U.set(_origField.ocean.U); V.set(_origField.ocean.V); _classifyOcean(); }
        _fillCompareChannel(target);
        window._compareActive[target]=true;
        // Compare runs CPU-only; GPU will resume automatically when compare
        // is turned off (gpuWant in frame() re-enables it).
      } else {
        window._compareActive[target]=false;
        // If no other compare is active, push current U/V/WU/WV back to the
        // GPU velBuf so WebGPU resumes with the restored embedded data.
        const cmpNow=window._compareActive||{};
        if(!cmpNow.ocean&&!cmpNow.wind) _gpuPushVelBuf();
      }
      rebuildSpawnWeights();
      _invalidateFieldCaches();
      return true;
    };
    // Lazily builds the "Custom velocity fields" group in the Earth Systems
    // tab (inside #groups, which initWorkspacePanel moves into the earth
    // pane). Built here in the globe block at first load — the DOM is fully
    // assembled by then, unlike the earlier globe-adv attempt which raced
    // the workspace reorg and never appeared.
    function _ensureCustomFieldGroup(){
      let sec=document.getElementById('custom-field-grp');
      if(sec) return sec;
      const groupsEl=document.getElementById('groups');
      if(!groupsEl){ console.warn('[custom field] #groups not found'); return null; }
      sec=document.createElement('div');
      sec.className='grp collapsible';
      sec.id='custom-field-grp';
      sec.innerHTML='<div class="grp-head"><span class="grp-caret">▸</span>'+
        '<span class="grp-name">Loaded Fields</span></div>'+
        '<div class="grp-body" style="display:none"></div>';
      const body=sec.querySelector('.grp-body');
      [['ocean','🌊 Loaded Currents'],['wind','💨 Loaded Winds']].forEach(([target,label])=>{
        // Wrapper hidden until a field for this slot is loaded.
        const wrap=document.createElement('div');
        wrap.className='cf-wrap'; wrap.dataset.target=target;
        wrap.style.display='none';

        // Toggle row (swap custom field in/out)
        const row=document.createElement('div');
        row.className='row off'; row.dataset.target=target;
        row.innerHTML='<span class="chk">✓</span><span class="sw"></span>'+
          '<span class="lbl" style="font-size:12px;">'+label+'</span>';
        row.title='Toggle: swap loaded field in place of the embedded '+target+' data';
        row.addEventListener('click',()=>{
          const turningOn=!row.classList.contains('on');
          if(window._applyFieldState&&window._applyFieldState(target,turningOn)){
            row.classList.toggle('on',turningOn);
            row.classList.toggle('off',!turningOn);
            cmpBtn.classList.remove('on'); cmpBtn.textContent='⇄ Compare';
          }
        });
        wrap.appendChild(row);

        // Compare button row
        const cmpRow=document.createElement('div');
        cmpRow.style.cssText='padding:3px 0 6px 22px;';
        const cmpBtn=document.createElement('button');
        cmpBtn.className='btn cf-compare';
        cmpBtn.textContent='⇄ Compare';
        cmpBtn.title='Side-by-side: show both the embedded field and the loaded field simultaneously';
        cmpBtn.style.cssText='font-size:10px;padding:3px 10px;width:100%;';
        cmpBtn.addEventListener('click',(e)=>{
          e.stopPropagation();
          const turningOn=!cmpBtn.classList.contains('on');
          if(window._setCompareState&&window._setCompareState(target,turningOn)){
            cmpBtn.classList.toggle('on',turningOn);
            cmpBtn.textContent=turningOn?'⇄ Comparing…':'⇄ Compare';
            if(turningOn){ row.classList.remove('on'); row.classList.add('off'); }
          }
        });
        cmpRow.appendChild(cmpBtn);
        wrap.appendChild(cmpRow);
        body.appendChild(wrap);
      });
      sec.querySelector('.grp-head').addEventListener('click',()=>{
        const hidden=body.style.display==='none';
        body.style.display=hidden?'':'none';
        sec.querySelector('.grp-caret').textContent=hidden?'▾':'▸';
      });
      groupsEl.appendChild(sec);
      console.log('[custom field] Earth Systems group created');
      return sec;
    }
    // Create the Earth Systems group at startup (rows stay hidden until a
    // field loads) so the section is discoverable — and so its presence or
    // the '#groups not found' warning is visible in console immediately.
    setTimeout(_ensureCustomFieldGroup,1500);
    setTimeout(_ensureCustomFieldGroup,5000);
    window._loadCustomVelocityField=function(json,target){
      try{
        if(typeof json==='string') json=JSON.parse(json);
        const {outU,outV}=_resampleCustomField(json);
        window._customFieldCache[target]=target==='wind'
          ?{WU:outU,WV:outV,meta:json}
          :{U:outU,V:outV,meta:json};
        window._applyFieldState(target,true);
        console.log('[custom field] loaded into',target,'—',json.description||json.source||'(no description)','| nx='+(json.nx||json.nlon||360),'ny='+(json.ny||json.nlat||180),'vmax='+(json.vmax??json.VMAX??2.5));
        // Diagnostic: sample a handful of cells so it's visible from the console
        // whether the custom field actually differs from the embedded baseline —
        // if these numbers match (or are very close), the swap worked but the
        // custom data is just similar to the embedded field, which is why no
        // visible change would show up on the globe.
        try{
          const origU=target==='wind'?_origField.wind.WU:_origField.ocean.U;
          const origV=target==='wind'?_origField.wind.WV:_origField.ocean.V;
          const n=outU.length;
          const idxs=[Math.floor(n*0.25),Math.floor(n*0.5),Math.floor(n*0.75)];
          const sample=idxs.map(i=>`cell ${i}: embedded (${origU[i]?.toFixed(2)},${origV[i]?.toFixed(2)}) → custom (${outU[i].toFixed(2)},${outV[i].toFixed(2)})`).join(' | ');
          console.log('[custom field] sample comparison —',sample);
        }catch(diagErr){ console.warn('[custom field] diagnostic sampling failed:',diagErr.message); }
        // Rendering no longer depends on the lat-band class checkboxes at all —
        // clsEnabled() treats an active custom field as its own visibility
        // toggle (see definition above), so nothing further is needed here.
        const sec=_ensureCustomFieldGroup();
        if(sec){
          const wrap=sec.querySelector('.cf-wrap[data-target="'+target+'"]');
          if(wrap){
            wrap.style.display='';
            const row=wrap.querySelector('.row');
            row.classList.add('on'); row.classList.remove('off');
            const defName=json.description||json.source||((json.nx||360)+'×'+(json.ny||180)+' field');
            window._customFieldLabel[target]=defName;
            row.title=defName+' — click to swap in place of the embedded '+target+' field';
          }
          // If this target is currently being compared, refresh the compare
          // channel so the newly loaded field flows immediately.
          if(window._compareActive&&window._compareActive[target]) _fillCompareChannel(target);
          // Reveal the per-field appearance sub-panel in Flow Appearance.
          if(window._showCfPanel) window._showCfPanel(target);
        }
        return true;
      }catch(e){
        console.error('[custom field] load failed:',e.message);
        alert('Could not load velocity field: '+e.message);
        return false;
      }
    };
    window._resetVelocityField=function(target){
      window._applyFieldState(target,false);
      // Clear the cache so the field is truly gone — the toggle row can no
      // longer re-enable it until a new field is loaded.
      if(window._customFieldCache) window._customFieldCache[target]=null;
      // Reset the colormap choice for this slot back to Auto
      if(window._customFieldTheme) window._customFieldTheme[target]=null;
      // Hide the Loaded Fields wrap row in Earth Systems
      const wrap=document.querySelector('.cf-wrap[data-target="'+target+'"]');
      if(wrap) wrap.style.display='none';
      // Hide the Flow Appearance sub-panel
      const appPnl=document.getElementById('cf-app-'+target);
      if(appPnl) appPnl.style.display='none';
      console.log('[custom field] reset',target,'— cache cleared, UI hidden');
    };

    // ==== JET STREAMS: true 3rd GPU channel (in progress) ===================
    // Reusing "compare mode" here was rejected: it forced the WHOLE wind
    // system into its CPU-only fallback and coupled jets' on/off state to
    // the regular wind belts. Being replaced with a genuine 3rd velocity
    // channel in the compute/vertex shaders (ocean, wind, custom) so jets
    // (and the existing load-a-custom-field compare view) can both run on
    // WebGPU without touching ocean/wind's own channels or classification.

    function frame(){
      requestAnimationFrame(frame);
      const en=clsEnabled();
      const oceanOn=en[0]||en[1]||en[2]||en[3];
      if(!en.some(Boolean)){
        if(cnv.style.display!=='none'){
          cnv.style.display='none';
          ctx.clearRect(0,0,cnv.width,cnv.height);
        }
        if(windCnv.style.display!=='none'){
          windCnv.style.display='none';
          windCtx.clearRect(0,0,windCnv.width,windCnv.height);
        }
        if(_gpuP.canvas&&_gpuP.canvas.style.display!=='none') _gpuP.canvas.style.display='none';
        if(_gpuP.windCanvas&&_gpuP.windCanvas.style.display!=='none') _gpuP.windCanvas.style.display='none';
        frame._oceanWasOn=false;
        return;
      }
      if(frame._oceanWasOn && !oceanOn){
        ctx.clearRect(0,0,cnv.width,cnv.height);
        paintOceanFlat(getOceanTheme());
        _canvasRot0=null;
      }
      frame._oceanWasOn=oceanOn;
      if(cnv.style.display==='none'){ cnv.style.display=''; ctx.clearRect(0,0,cnv.width,cnv.height); }
      const windOn=en[4]||en[5]||en[6]||en[7];
      const gpuWantEarly=!!(window.GlobeAPI?._ncUseWebGPU);
      const gpuLiveEarly=gpuWantEarly&&_gpuP.ready&&!_gpuP.failed;
      // CPU wind canvas — hide when WebGPU wind canvas is active (avoids a
      // stale opaque 2D layer sitting on top of land).
      if(gpuLiveEarly){
        windCnv.style.display='none';
      } else if(windOn){
        windCnv.style.display='';
      } else {
        windCnv.style.display='none';
      }

      const cfg=window._flowCfg||{};
      // Compare/swap state, needed early: a fully-swapped layer (custom data
      // replacing embedded, no side-by-side compare) uses the "Loaded
      // currents/winds" appearance settings (cOcean*/cWind*) instead of the
      // regular Ocean/Wind tab settings for that whole layer.
      const _cmpNow=window._compareActive||{};
      const _cfaNow=window._customFieldActive||{};
      const oceanSwapActive=!!_cfaNow.ocean&&!_cmpNow.ocean;
      const windSwapActive =!!_cfaNow.wind &&!_cmpNow.wind;
      // gpuBoost: 2.0 when the GPU-resident particle path is live.
      // Reduced 5% from 2.0 per performance/visual-balance request.
      const gpuBoost=(frame._gpuMode===true)?1.9:(cfg._gpuBoost||1);
      const fade=oceanSwapActive?(cfg.cOceanFade??cfg.oFade??0.960):(cfg.oFade??0.960);
      // Reserve sized to the wind clamp below (guards against the WebGPU
      // "Instance range requires a larger buffer" overflow → silent CPU
      // revert): worst
      // case wind+jets is now 7000*1.18=8260. Invariant: oDensityCap +
      // wDensityCap*1.18 ≤ MAXP → 31500 + 8260 = 39760 ≤ 40000 ✓.
      const oDensity=Math.min(MAXP-8500,Math.round((oceanSwapActive?(cfg.cOceanDensity??14000):(cfg.oDensity??14000))*gpuBoost*_mobileParticleScale));
      // Wind boost clamp 1.5 / cap 7000 — measured middle ground. The
      // full-1.9-boost + 9500-cap experiment (6650 wind quads at default,
      // combined with the wider per-quad geometry below) tripled wind's
      // fill-rate and blew the GPU frame budget: an A/B bisect in the same
      // environment measured 4 frames/10s with it vs 82 frames/10s
      // without. Default slider (3500) now yields 5250 — ~11% above the
      // pre-regression 4725, visibly fuller without the jank. CPU fallback
      // unaffected (its boost is at most 1.2, below the clamp).
      // Boost clamp trimmed 1.5→1.35 per polish feedback ("slightly
      // tempered"): default slider (3500) in GPU mode now yields 4725 —
      // the exact count of the round the user signed off on — while the
      // width/alpha whisker fixes stay, so it reads calmer, not sparser.
      const wDensity=Math.min(7000,Math.round((windSwapActive?(cfg.cWindDensity??3000):(cfg.wDensity??3000))*Math.min(gpuBoost,1.35)*_mobileParticleScale));
      // Jets are a sparser accent layer, not full coverage — sized as a
      // fraction of wind's own density (so the "wind" density slider still
      // governs it, per "same appearance settings as wind"), zero when off.
      const cDensity=(state.jets&&window._jetSpd)?Math.round(wDensity*0.18):0;
      const active=oDensity+wDensity+cDensity;
      // Round joins/caps unconditionally on BOTH canvases (was gated on
      // gpuBoost>1.05 and ocean-only): butt caps leave visible angular
      // notches where consecutive per-frame segments meet at an angle —
      // a big part of the "polygonal" look, worst on fast wind/jets.
      // Cheap to state-set every frame; canvas resizes reset it anyway.
      ctx.imageSmoothingEnabled=true;
      ctx.lineJoin='round';
      ctx.lineCap='round';
      windCtx.lineJoin='round';
      windCtx.lineCap='round';
      frame._oDensitySlot=oDensity;  // tell respawnParticle the layer boundary
      frame._wDensitySlot=oDensity+wDensity;  // wind→jets boundary
      // ── Ghost/smudge prevention ──────────────────────────────
      // 1. Clear when any class toggles on/off
      // 2. Clear when particle counts drop (stale trails remain)
      // 3. Periodic hard clear every 300 frames to purge asymptotic fade ghosts
      // 4. Track a hash of all cfg values — any slider change triggers clear
      if(!frame._fc) frame._fc={en:'',act:active,od:oDensity,wd:wDensity,cfg:''};
      const enStr=en.join(',');
      // Only track settings that LEAVE GHOSTS when changed:
      // theme changes (colour shift), opacity increases (old dim trails now visible)
      // DO NOT include fade/speed/turb/width — those don't leave ghost pixels
      const cfgHash=`${cfg.oceanTheme||'ocean'},${cfg.windTheme||'wind_white'},${Math.round((cfg.oceanOp??1)*10)},${Math.round((cfg.windOp??0.5)*10)}`;
      const fc=frame._fc;
      const needClear=(
        enStr!==fc.en ||           // class toggled on/off
        active<fc.act-200 ||       // total particles dropped
        oDensity<fc.od-100 ||      // ocean density dropped
        wDensity<fc.wd-100 ||      // wind density dropped
        cfgHash!==fc.cfg           // any theme/setting changed
      );
      if(needClear){
        _canvasRot0=null;
        if(cfgHash!==fc.cfg || enStr!==fc.en){
          ctx.clearRect(0,0,cnv.width,cnv.height);
          if(oceanOn&&oceanFlowOn()) paintOcean();
          else paintOceanFlat(getOceanTheme());
        }
      }
      fc.en=enStr; fc.act=active; fc.od=oDensity; fc.wd=wDensity; fc.cfg=cfgHash;
      const oceanOp = oceanSwapActive?(cfg.cOceanOp??1.0):(cfg.oceanOp ?? 1.0);
      const windOp  = windSwapActive?(cfg.cWindOp??0.6):(cfg.windOp  ?? 0.5);
      const lwidth  = cfg.width   ?? 1.0;

      // ── GPU-resident particle path (see _gpuPInit above) ──────
      // Compare mode's custom channel now has its own GPU binding (velCmp,
      // see cmain's useCmp) so it no longer needs to force a CPU fallback.
      const gpuWant=!!(window.GlobeAPI?._ncUseWebGPU);
      if(gpuWant&&_gpuP.wgslVer!==_GPU_WGSL_VER&&(_gpuP.ready||_gpuP.failed)){
        _gpuP.ready=false; _gpuP.failed=false; _gpuP.initializing=false;
      }
      if(gpuWant&&!_gpuP.ready&&!_gpuP.initializing&&!_gpuP.failed) _gpuPInit();
      const gpuLive=gpuWant&&_gpuP.ready&&!_gpuP.failed;
      if(frame._gpuMode!==gpuLive){
        frame._gpuMode=gpuLive;
        if(gpuLive){
          // Entering GPU mode: wipe CPU trails, seed all GPU particles dead
          // (compute respawns the whole population on its first dispatch).
          _canvasRot0=null;
          _gpuP.clearTrail=true; _gpuP.clearTrailW=true; _gpuP.resetParticles=true;
        } else {
          // Leaving GPU mode: hide GPU canvas, force-respawn all CPU
          // particles (their pLon/pLat were never touched while GPU ran,
          // so they're stale — a full respawn gives an instant fresh field).
          if(_gpuP.canvas) _gpuP.canvas.style.display='none';
          if(_gpuP.windCanvas) _gpuP.windCanvas.style.display='none';
          pAlive.fill(0);
          _canvasRot0=null;
        }
      }
      if(gpuLive){
        try{
          _gpuPFrame(en,cfg,active,oDensity,fade,oceanOp,windOp,oceanSwapActive,windSwapActive,wDensity,cDensity,_cmpNow.ocean,_cmpNow.wind);
        }catch(e){
          console.warn('[particles] GPU frame failed — reverting to CPU:',e.message);
          _gpuP.failed=true;
          if(_gpuP.canvas) _gpuP.canvas.style.display='none';
          if(_gpuP.windCanvas) _gpuP.windCanvas.style.display='none';
        }
        return;
      }

      if(dragging){ ctx.clearRect(0,0,cnv.width,cnv.height); windCtx.clearRect(0,0,windCnv.width,windCnv.height); paintOcean(); _canvasRot0=null; return; }

      // ── Clip canvas to globe disc ──────────────────────────────
      const tr=projection.translate(), sc=projection.scale();
      if(_flowTr0===null||Math.abs(tr[0]-_flowTr0)>0.5||Math.abs(tr[1]-_flowTr1)>0.5||Math.abs(sc-_flowSc0)>0.5){
        _canvasRot0=null;
        _flowTr0=tr[0]; _flowTr1=tr[1]; _flowSc0=sc;
      }
      if(window._syncFlowClip) window._syncFlowClip(tr[0],tr[1],sc);
      ctx.save();
      ctx.beginPath();
      ctx.arc(tr[0]*dpr, tr[1]*dpr, sc*dpr, 0, 2*Math.PI);
      if(ctx.clip) ctx.clip();

      // ── Canvas management: clear on rotation, fade when still ──
      const cr=projection.rotate();
      if(_canvasRot0===null) _flowRotAccum=999;
      else {
        let dLon=Math.abs(cr[0]-_canvasRot0), dLat=Math.abs(cr[1]-_canvasRot1);
        if(dLon>180) dLon=360-dLon;
        _flowRotAccum+=Math.hypot(dLon,dLat);
      }
      const wFade=windSwapActive?(cfg.cWindFade??0.968):(cfg.wFade??0.968);
      const rotated=_flowRotAccum>=7;
      if(rotated){
        ctx.clearRect(0,0,cnv.width,cnv.height); paintOcean();
        windCtx.clearRect(0,0,windCnv.width,windCnv.height);
        _canvasRot0=cr[0]; _canvasRot1=cr[1]; _flowRotAccum=0;
      } else {
        const thFade=getOceanTheme();
        // Anti-smudge deep-fade pulse (mirrors the wind canvas's frame._wff
        // pattern): plain proportional destination-out decays asymptotically
        // and, in 8-bit, pins faint/dense residue in place instead of
        // reaching true zero — this is the source of the "blob" buildup in
        // fast-current corridors (high particle density + high stroke alpha
        // never fully clear between frames). A periodic flat top-up forces
        // it through the pinning floor every 24 frames.
        frame._ff=(frame._ff||0)+1;
        const fadeAmt=Math.max(1-fade,0.01)+((frame._ff%24===0)?0.05:0);
        ctx.globalCompositeOperation='destination-out';
        ctx.fillStyle='rgba(0,0,0,'+Math.min(1,fadeAmt)+')';
        ctx.fillRect(0,0,cnv.width,cnv.height);
        ctx.globalCompositeOperation='source-over';
        if(thFade.bgSpeed&&oceanOn&&oceanFlowOn()) restoreSpeedBg();
      }
      if(windOn){
        windCtx.save();
        windCtx.beginPath();
        windCtx.arc(tr[0]*dpr, tr[1]*dpr, sc*dpr, 0, 2*Math.PI);
        if(windCtx.clip) windCtx.clip();
        if(!rotated){
          // destination-out: fade trails without painting opaque black into
          // empty pixels (source-over black fill would slowly blanket land).
          windCtx.globalCompositeOperation='destination-out';
          frame._wff=(frame._wff||0)+1;
          const wBaseA=Math.max(1-wFade,0.012)+((frame._wff%24===0)?0.05:0);
          windCtx.fillStyle='rgba(0,0,0,'+Math.min(1,wBaseA)+')';
          windCtx.fillRect(0,0,windCnv.width,windCnv.height);
          windCtx.globalCompositeOperation='source-over';
        }
      }

      // ── Hemisphere culling + inline projection constants ──────
      // d3 orthographic after rotate([λ0,φ0]):
      //   dot  = cos(φ)·cos(λ-λ0*)·cos(φ0*) + sin(φ)·sin(φ0*)   where λ0*=-cr[0], φ0*=-cr[1]
      //   if dot < 0 → far side, cull
      //   x = cx + R·cos(φ)·sin(λ-λ0*)
      //   y = cy - R·[cos(φ0*)·sin(φ) - sin(φ0*)·cos(φ)·cos(λ-λ0*)]
      const D2=Math.PI/180;
      // View centre: lon=-cr[0], lat=-cr[1]
      // Relative lon for particle: (pLon + cr[0]) * D2
      const lonC=cr[0];     // add to particle lon to get relative lon (in degrees)
      const phi0r=-cr[1]*D2; // tilt: phi0 = -cr[1] degrees = vc[1]
      const cosT=Math.cos(phi0r), sinT=Math.sin(phi0r);
      const cx=tr[0], cy=tr[1], R=sc;

      // ── Reset segment buffers ───────────────────────────────────
      segN.fill(0); segNC.fill(0);

      // ── Compare mode (embedded + custom shown together) ─────────
      // When active for a layer, odd-indexed particles in that layer's pool
      // are advected through the custom channel (Uc/Vc or WUc/WVc) and drawn
      // separately with the custom colormap, so both fields flow at once.
      const _cmpA=window._compareActive||{};
      const _cmpOcean=!!_cmpA.ocean, _cmpWind=!!_cmpA.wind;
      // Fraction of the pool routed through the custom field, proportional
      // to the Loaded-currents/winds Particles slider vs the embedded one
      // (mirrors the GPU cmain change) — was a fixed 50/50 split via
      // (i&1)===1 regardless of that slider before.
      const _cmpOceanFrac=_cmpOcean?Math.max(0,Math.min(1,(cfg.cOceanDensity??14000)/((cfg.oDensity??14000)+(cfg.cOceanDensity??14000)))):0;
      const _cmpWindFrac=_cmpWind?Math.max(0,Math.min(1,(cfg.cWindDensity??3500)/((cfg.wDensity??3500)+(cfg.cWindDensity??3500)))):0;

      // ── Particle loop ───────────────────────────────────────────
      // Slots 0..oDensity-1 = ocean (classes 0-3)
      // Slots oDensity..active-1 = wind (classes 4-6)
      const _wDensitySlot=frame._wDensitySlot??oDensity;
      for(let i=0;i<active;i++){
        if(!pAlive[i]){ respawnParticle(i); continue; }
        const cls=pCls[i];
        const slotIsJet=i>=_wDensitySlot;
        const slotIsWind=!slotIsJet&&i>=oDensity;
        // Kill if particle is in wrong layer slot
        if(slotIsJet&&cls!==7){ pAlive[i]=0; continue; }
        if(slotIsWind&&(cls<4||cls===7)){ pAlive[i]=0; continue; }
        if(!slotIsWind&&!slotIsJet&&cls>=4){ pAlive[i]=0; continue; }
        if(!en[cls]){ pAlive[i]=0; continue; }

        // ── HEMISPHERE CULL ────────────────────────────────────
        let _rl=pLon[i]+lonC; while(_rl>180)_rl-=360; while(_rl<-180)_rl+=360;
        const lamA=_rl*D2;  // normalized relative lon
        const phiA=pLat[i]*D2;
        const cPA=Math.cos(phiA), sPA=Math.sin(phiA);
        const cLA=Math.cos(lamA);
        const dotA=cPA*cLA*cosT+sPA*sinT;
        if(dotA<0){ pAlive[i]=0; continue; }  // far side — kill immediately

        const isJet=cls===7;
        const isWind=cls>=4; // includes jets — lets jets ride wind's fade/speed/turb/alpha settings below
        // Compare routing: in a compare-active layer, odd slots advect through
        // the custom channel; everything else stays on the embedded field.
        // Jets never participate — they're additive, not a swap of wind.
        // Deterministic per-index membership (not random) so a particle's
        // embedded/custom identity stays stable frame to frame. i%100 vs
        // frac*100 approximates the target fraction at 1% granularity.
        const _cmpFrac=isWind?_cmpWindFrac:_cmpOceanFrac;
        const useCmp=!isJet&&_cmpFrac>0&&((i%100)<_cmpFrac*100);
        // apCustom: true for any particle currently showing custom-field
        // content — either because the whole layer has swapped to custom
        // data (oceanSwapActive/windSwapActive) or, in compare mode, this
        // is one of the odd-slot particles routed through the custom
        // channel. Drives which appearance settings (speed/turb/fade) apply.
        const apCustom=isJet?false:(isWind?(windSwapActive||useCmp):(oceanSwapActive||useCmp));
        let mag,nl,nt,ml,mt;
        {
          // ── Velocity sample (inlined bilinear from velFrom) ─────
          // Inlined here to eliminate the [u,v] array allocation that
          // velFrom returned — 15000 particles × 60fps = ~900k allocs/sec
          // of GC pressure removed from the hot loop.
          // Jets sample their own JU/JV channel — never WU/WV — so this
          // can't be affected by (or affect) the regular wind field.
          const UU=isJet?JU:(isWind?(useCmp?WUc:WU):(useCmp?Uc:U));
          const VV=isJet?JV:(isWind?(useCmp?WVc:WV):(useCmp?Vc:V));
          const _plon=pLon[i], _plat=pLat[i];
          const _gx=(_plon+180)/CELL-0.5, _gy=(_plat+90)/CELL-0.5;
          const _gx0=Math.floor(_gx), _gy0=Math.floor(_gy);
          const _gfx=_gx-_gx0, _gfy=_gy-_gy0;
          const _gx0w=((_gx0%GW)+GW)%GW, _gx1w=(_gx0w+1)%GW;
          const _gy0c=_gy0<0?0:(_gy0>GH-1?GH-1:_gy0);
          const _gy1c=(_gy0+1)<0?0:((_gy0+1)>GH-1?GH-1:(_gy0+1));
          const _k00=_gy0c*GW+_gx0w,_k01=_gy0c*GW+_gx1w,_k10=_gy1c*GW+_gx0w,_k11=_gy1c*GW+_gx1w;
          const _fxm=1-_gfx, _fym=1-_gfy;
          const u=(UU[_k00]*_fxm+UU[_k01]*_gfx)*_fym+(UU[_k10]*_fxm+UU[_k11]*_gfx)*_gfy;
          const v=(VV[_k00]*_fxm+VV[_k01]*_gfx)*_fym+(VV[_k10]*_fxm+VV[_k11]*_gfx)*_gfy;
          mag=Math.sqrt(u*u+v*v);
          if(mag<(isJet?3:0.03)){ respawnParticle(i); continue; }
          // Resolve effective physics params — custom-content particles use
          // the Loaded currents/winds settings, embedded particles use the
          // regular Ocean/Wind tab settings. Jets always use the plain
          // wind settings (apCustom is forced false above).
          const effWFade=apCustom&&isWind?(cfg.cWindFade??cfg.wFade??0.920):(cfg.wFade??0.920);
          const layerMaxAge=Math.round((isWind?Math.round(maxAge*(effWFade)/0.960):maxAge)*Math.min(gpuBoost,1.35));
          if(++pAge[i]>layerMaxAge){ respawnParticle(i); continue; }

          // ── Re-classify ────────────────────────────────────────
          // Jets never reclassify — they're always the fixed class 7,
          // unlike wind which transitions between trades/westerlies/polar
          // as a particle drifts across latitude bands.
          if(isJet){
            if(!en[7]){ respawnParticle(i); continue; }
          } else {
            const gk=gi(pLon[i],pLat[i]);
            if(!isWind){
              pCls[i]=CLS[gk];
              if(!en[pCls[i]]){ respawnParticle(i); continue; }
            } else {
              let wc=WCls[gk];
              if(wc<0){
                const absLat=Math.abs(pLat[i]);
                if(absLat>82||mag<0.5){ respawnParticle(i); continue; }
                wc=absLat<28?4:(absLat<58?5:6);
              }
              pCls[i]=wc; if(!en[wc]){ respawnParticle(i); continue; }
            }
          }

          // ── Advance position (RK4) ────────────────────────────────
          // Normalise mag to equivalent ocean scale (VMAX_ocean=2.5) for consistent step.
          // Jets (25-80 m/s) get their own ceiling — reusing wind's /20.0
          // would give jets a ~4x larger step than wind per frame.
          const magN=isWind?mag*(2.5/(isJet?80.0:20.0)):mag;
          const effSpeed=apCustom?(isWind?(cfg.cWindSpeed??1.1):(cfg.cOceanSpeed??1.0)):
                                  (isWind?(cfg.wSpeed??1):(cfg.oSpeed??1));
          const step=(0.08+magN*0.52)*effSpeed;
          // Floor raised 0.25→0.5 (mirrors the GPU cmain change): wind's
          // higher speed + higher-latitude range let the old floor stretch
          // its longitude step up to 4× near the poles, producing long,
          // jagged, often-culled segments that ocean's slower/lower-lat
          // particles never triggered.
          const cm=Math.max(0.5,Math.cos(pLat[i]*D2));
          const effTurb=apCustom?(isWind?(cfg.cWindTurb??0.018):(cfg.cOceanTurb??0.012)):
                                 (isWind?(cfg.wTurb??0.018):(cfg.oTurb??0.018));
          const ptb=effTurb;
          // Classic 4-stage Runge-Kutta (upgraded from RK2 midpoint): k1 is
          // the velocity already sampled at the start (u,v); k2 and k3 are
          // sampled at two half-step trial positions, k4 at a full-step
          // trial; the final displacement uses the weighted average
          // (k1+2k2+2k3+k4)/6, which is 4th-order accurate vs RK2's 2nd —
          // a real trajectory-accuracy improvement (particles track the
          // true flow field more closely over their lifetime, matters most
          // for tightly curving features like eddies and retroflections).
          // The k3 stage position (closer to the path's true midpoint than
          // RK2's single k2 estimate) feeds the SAME quadratic-through-
          // midpoint curve rendering already in place — no new rendering
          // machinery, since the earlier experiment found that a visibly
          // curved single-frame segment needs the long-segment gating
          // that's already here, not a higher-order sample count.
          const hStp=step*0.5;
          let p2lon=pLon[i]+u*hStp/cm+(rand()-0.5)*ptb*0.5;
          let p2lat=pLat[i]+v*hStp+(rand()-0.5)*ptb*0.5;
          if(p2lon>180)p2lon-=360; if(p2lon<-180)p2lon+=360;
          if(p2lat>89||p2lat<-89){ respawnParticle(i); continue; }
          const _g2x=(p2lon+180)/CELL-0.5, _g2y=(p2lat+90)/CELL-0.5;
          const _g2x0=Math.floor(_g2x), _g2y0=Math.floor(_g2y);
          const _g2fx=_g2x-_g2x0, _g2fy=_g2y-_g2y0;
          const _g2x0w=((_g2x0%GW)+GW)%GW, _g2x1w=(_g2x0w+1)%GW;
          const _g2y0c=_g2y0<0?0:(_g2y0>GH-1?GH-1:_g2y0);
          const _g2y1c=(_g2y0+1)<0?0:((_g2y0+1)>GH-1?GH-1:(_g2y0+1));
          const _g2k00=_g2y0c*GW+_g2x0w,_g2k01=_g2y0c*GW+_g2x1w,_g2k10=_g2y1c*GW+_g2x0w,_g2k11=_g2y1c*GW+_g2x1w;
          const _g2fxm=1-_g2fx, _g2fym=1-_g2fy;
          const u2=(UU[_g2k00]*_g2fxm+UU[_g2k01]*_g2fx)*_g2fym+(UU[_g2k10]*_g2fxm+UU[_g2k11]*_g2fx)*_g2fy;
          const v2=(VV[_g2k00]*_g2fxm+VV[_g2k01]*_g2fx)*_g2fym+(VV[_g2k10]*_g2fxm+VV[_g2k11]*_g2fx)*_g2fy;

          let p3lon=pLon[i]+u2*hStp/cm+(rand()-0.5)*ptb*0.5;
          let p3lat=pLat[i]+v2*hStp+(rand()-0.5)*ptb*0.5;
          if(p3lon>180)p3lon-=360; if(p3lon<-180)p3lon+=360;
          if(p3lat>89||p3lat<-89){ respawnParticle(i); continue; }
          const _g3x=(p3lon+180)/CELL-0.5, _g3y=(p3lat+90)/CELL-0.5;
          const _g3x0=Math.floor(_g3x), _g3y0=Math.floor(_g3y);
          const _g3fx=_g3x-_g3x0, _g3fy=_g3y-_g3y0;
          const _g3x0w=((_g3x0%GW)+GW)%GW, _g3x1w=(_g3x0w+1)%GW;
          const _g3y0c=_g3y0<0?0:(_g3y0>GH-1?GH-1:_g3y0);
          const _g3y1c=(_g3y0+1)<0?0:((_g3y0+1)>GH-1?GH-1:(_g3y0+1));
          const _g3k00=_g3y0c*GW+_g3x0w,_g3k01=_g3y0c*GW+_g3x1w,_g3k10=_g3y1c*GW+_g3x0w,_g3k11=_g3y1c*GW+_g3x1w;
          const _g3fxm=1-_g3fx, _g3fym=1-_g3fy;
          const u3=(UU[_g3k00]*_g3fxm+UU[_g3k01]*_g3fx)*_g3fym+(UU[_g3k10]*_g3fxm+UU[_g3k11]*_g3fx)*_g3fy;
          const v3=(VV[_g3k00]*_g3fxm+VV[_g3k01]*_g3fx)*_g3fym+(VV[_g3k10]*_g3fxm+VV[_g3k11]*_g3fx)*_g3fy;

          let p4lon=pLon[i]+u3*step/cm+(rand()-0.5)*ptb;
          let p4lat=pLat[i]+v3*step+(rand()-0.5)*ptb;
          if(p4lon>180)p4lon-=360; if(p4lon<-180)p4lon+=360;
          if(p4lat>89||p4lat<-89){ respawnParticle(i); continue; }
          const _g4x=(p4lon+180)/CELL-0.5, _g4y=(p4lat+90)/CELL-0.5;
          const _g4x0=Math.floor(_g4x), _g4y0=Math.floor(_g4y);
          const _g4fx=_g4x-_g4x0, _g4fy=_g4y-_g4y0;
          const _g4x0w=((_g4x0%GW)+GW)%GW, _g4x1w=(_g4x0w+1)%GW;
          const _g4y0c=_g4y0<0?0:(_g4y0>GH-1?GH-1:_g4y0);
          const _g4y1c=(_g4y0+1)<0?0:((_g4y0+1)>GH-1?GH-1:(_g4y0+1));
          const _g4k00=_g4y0c*GW+_g4x0w,_g4k01=_g4y0c*GW+_g4x1w,_g4k10=_g4y1c*GW+_g4x0w,_g4k11=_g4y1c*GW+_g4x1w;
          const _g4fxm=1-_g4fx, _g4fym=1-_g4fy;
          const u4=(UU[_g4k00]*_g4fxm+UU[_g4k01]*_g4fx)*_g4fym+(UU[_g4k10]*_g4fxm+UU[_g4k11]*_g4fx)*_g4fy;
          const v4=(VV[_g4k00]*_g4fxm+VV[_g4k01]*_g4fx)*_g4fym+(VV[_g4k10]*_g4fxm+VV[_g4k11]*_g4fx)*_g4fy;

          const uf=(u+2*u2+2*u3+u4)/6, vf=(v+2*v2+2*v3+v4)/6;
          nl=pLon[i]+uf*step/cm+(rand()-0.5)*ptb;
          nt=pLat[i]+vf*step+(rand()-0.5)*ptb;
          if(nl>180)nl-=360; if(nl<-180)nl+=360;
          if(nt>89||nt<-89){ respawnParticle(i); continue; }
          if(!isWind&&LAND[gi(nl,nt)]){ respawnParticle(i); continue; }
          ml=p3lon; mt=p3lat;
        }

        // ── Inline screen projection (no d3 call) ──────────────
        // x = cx + R·cos(φ)·sin(λ+λC)   y = cy - R·[cosT·sin(φ) - sinT·cos(φ)·cos(λ+λC)]
        const sLA=Math.sin(lamA);
        const ax=(cx+R*cPA*sLA)*dpr;
        const ay=(cy-R*(cosT*sPA-sinT*cPA*cLA))*dpr;

        // Project + cull new position.
        let _rl2=nl+lonC; while(_rl2>180)_rl2-=360; while(_rl2<-180)_rl2+=360;
        const lamB=_rl2*D2, phiB=nt*D2;
        const cPB=Math.cos(phiB), sPB=Math.sin(phiB), cLB=Math.cos(lamB);
        const dotB=cPB*cLB*cosT+sPB*sinT;
        if(dotB<0){ respawnParticle(i); continue; }
        const bx=(cx+R*cPB*Math.sin(lamB))*dpr;
        const by=(cy-R*(cosT*sPB-sinT*cPB*cLB))*dpr;

        pLon[i]=nl; pLat[i]=nt;

        const dx=bx-ax, dy=by-ay;
        const segLen2=dx*dx+dy*dy;
        if(segLen2>1600) continue;

        // Curved-segment midpoint: the RK2 half-step position (ml,mt) is
        // already computed for physics; projecting it (4 extra trig) is
        // only worth doing when the segment is long enough for curvature
        // to be visible (>~7px — fast currents, jets, storm winds). Short
        // segments get the straight midpoint, which draws identically to
        // a line. A sanity clamp falls back to straight if the projected
        // midpoint is implausible (behind hemisphere / seam wrap).
        let mx=(ax+bx)*0.5, my=(ay+by)*0.5;
        if(segLen2>49){
          let _rlM=ml+lonC; while(_rlM>180)_rlM-=360; while(_rlM<-180)_rlM+=360;
          const lamM=_rlM*D2, phiM=mt*D2;
          const cPM=Math.cos(phiM), sPM=Math.sin(phiM), cLM=Math.cos(lamM);
          if(cPM*cLM*cosT+sPM*sinT>=0){
            const pmx=(cx+R*cPM*Math.sin(lamM))*dpr;
            const pmy=(cy-R*(cosT*sPM-sinT*cPM*cLM))*dpr;
            if(Math.abs(pmx-mx)<40&&Math.abs(pmy-my)<40){ mx=pmx; my=pmy; }
          }
        }

        const c2=pCls[i];
        if(useCmp){
          const ni=segNC[c2], n6=ni*6;
          if(n6+6<=segBufC[c2].length){
            segBufC[c2][n6]=ax; segBufC[c2][n6+1]=ay;
            segBufC[c2][n6+2]=mx; segBufC[c2][n6+3]=my;
            segBufC[c2][n6+4]=bx; segBufC[c2][n6+5]=by;
            segMagC[c2][ni]=mag;
            segNC[c2]++;
          }
        } else {
          const ni=segN[c2], n6=ni*6;
          if(n6+6<=segBuf[c2].length){
            segBuf[c2][n6]=ax; segBuf[c2][n6+1]=ay;
            segBuf[c2][n6+2]=mx; segBuf[c2][n6+3]=my;
            segBuf[c2][n6+4]=bx; segBuf[c2][n6+5]=by;
            segMag[c2][ni]=mag;
            segN[c2]++;
          }
        }
      }

      // ── Draw ocean currents (classes 0-3) ──────────────────────
      ctx.globalCompositeOperation='source-over';
      const th=getOceanTheme(), wth=getWindTheme();
      const useSpeedColor=th.streak===null;
      const [sr,sg,sb]=th.streak||[255,255,255];
      const useWindSpeedColor=wth.streak===null;
      const [wr,wg,wb]=wth.streak||[200,215,235];
      const qualityFlow=!!cfg._gpuQuality; // currently always false — see _applyFlowGpuBoost note
      const speedBins=qualityFlow?12:8;
      function strokeSpeedBuckets(buf,magBuf,n,theme,alpha,cls,targetCtx){
        // Per-class override (Earth Systems colormap picker) wins over the
        // layer's own theme cmap. Some THEMES entries (wind_yellow,
        // wind_cyan, wind_white) use a flat `streak` color instead of a
        // `cmap` function — wrap it as a constant-returning cmap so picking
        // one of those from the per-class dropdown actually takes effect
        // (previously only ov.cmap was checked, so streak-only picks like
        // "Yellow" silently did nothing).
        const ov=classCmapOverride(cls);
        const ovCmap=ov&&(ov.cmap||(ov.streak?(()=>ov.streak):null));
        const useCmap=!!ovCmap||!!theme.cmap;
        const cmapFn=ovCmap||theme.cmap||speedColor;
        // Jets run 25-80 m/s vs surface wind's ~20 m/s ceiling — reusing the
        // wind tnorm would clamp every jet particle into the single hottest
        // bin with no speed variation.
        const tnorm=cls===7?80:(cls>=4?20:1.5);
        const paths=new Array(speedBins);
        for(let j=0;j<n;j++){
          const t=Math.min(0.999,magBuf[j]/tnorm);
          const b=(t*speedBins)|0;
          const P2=paths[b]||(paths[b]=new Path2D());
          // Quadratic through the stored RK2 midpoint: control point
          // C = 2M − (A+B)/2 makes the curve pass exactly through M at
          // its half-way point, so long segments bend with the flow.
          const j6=j*6;
          const ax=buf[j6],ay=buf[j6+1],mx=buf[j6+2],my=buf[j6+3],bx2=buf[j6+4],by2=buf[j6+5];
          P2.moveTo(ax,ay);
          P2.quadraticCurveTo(2*mx-(ax+bx2)*0.5,2*my-(ay+by2)*0.5,bx2,by2);
        }
        for(let b=0;b<speedBins;b++){
          if(!paths[b]) continue;
          const tMid=(b+0.5)/speedBins;
          const col=useCmap?cmapFn(tMid):speedColor(tMid*1.5,cls);
          const binA=alpha*(1-Math.pow(tMid,1.4)*0.22);
          targetCtx.strokeStyle=`rgba(${col[0]},${col[1]},${col[2]},${binA})`;
          targetCtx.stroke(paths[b]);
        }
        // "Emulsion" highlight pass: additive near-white overdraw whose
        // intensity is a smooth power curve over the WHOLE speed range,
        // not a hard cutoff. The old `if(tMid<0.7) continue` created a
        // stark on/off line — any moderately-energetic patch (e.g. the
        // equatorial NECC/Guinea confluence, which legitimately has quick
        // local eddies) hit full "hot core" treatment at the same
        // intensity as the Gulf Stream, making it look just as (or more)
        // energetic. pow(tMid,N) stays low through the mid-range and only
        // ramps up near the top, so only genuinely exceptional cores
        // bloom strongly — and a floor gives slow flow a slight,
        // continuous shimmer instead of being perfectly flat ("emulsion").
        // Exponent/floor are class-aware: ocean's tnorm (1.5 m/s) sits
        // close to its own typical fast-current speeds, so a steep curve
        // (pow 5) still lets real cores through — but wind's tnorm
        // (20 m/s) is far above typical 10m wind speeds (usually 5-10
        // m/s), so the SAME steep curve left wind's highlight pass almost
        // never firing (tMid rarely exceeds ~0.5, where pow(x,5) is
        // negligible), reading as flat/dark despite the base stroke alpha
        // being fine. Gentler exponent + higher floor for wind/jets.
        const isWindCls=cls>=4;
        const heatExp=isWindCls?2.2:5;
        const heatFloor=isWindCls?0.09:0.035;
        const heatScale=isWindCls?0.34:0.32;
        targetCtx.save();
        targetCtx.globalCompositeOperation='lighter';
        targetCtx.lineWidth=Math.max(0.4,targetCtx.lineWidth*0.4);
        for(let b=0;b<speedBins;b++){
          if(!paths[b]) continue;
          const tMid=(b+0.5)/speedBins;
          const heat=Math.pow(tMid,heatExp);
          const hA=alpha*(heatFloor+heatScale*heat);
          targetCtx.strokeStyle=`rgba(255,248,240,${hA})`;
          targetCtx.stroke(paths[b]);
        }
        targetCtx.restore();
      }
      function strokeFixed(buf,n,r,g,b,alpha,targetCtx){
        targetCtx.strokeStyle=`rgba(${r},${g},${b},${alpha})`;
        targetCtx.beginPath();
        for(let j=0;j<n;j++){
          const j6=j*6;
          const ax=buf[j6],ay=buf[j6+1],mx=buf[j6+2],my=buf[j6+3],bx2=buf[j6+4],by2=buf[j6+5];
          targetCtx.moveTo(ax,ay);
          targetCtx.quadraticCurveTo(2*mx-(ax+bx2)*0.5,2*my-(ay+by2)*0.5,bx2,by2);
        }
        targetCtx.stroke();
      }

      ctx.lineWidth=th.lineWidth*(oceanSwapActive?(cfg.cOceanWidth??0.9):(cfg.oWidth??1.0))*dpr;
      // Raised floor again (was 0.34) — currents were still reading as
      // flat/static against the speed-paint background rather than
      // visibly moving, especially the slow end where nothing else makes
      // up the difference (no glow boost, no speed-color punch).
      const baseAlphas=[0.46,0.58,0.72,0.88];
      const streakBoost=th.bgSpeed&&!useSpeedColor?(th.streak?1.28:1.2):1;
      for(let c=0;c<4;c++){
        const n=segN[c]; if(!n) continue;
        const buf=segBuf[c], magBuf=segMag[c];
        const alpha=Math.min(1,baseAlphas[c]*oceanOp*streakBoost);
        if(classCmapOverride(c)||useSpeedColor||th.cmap) strokeSpeedBuckets(buf,magBuf,n,th,alpha,c,ctx);
        else strokeFixed(buf,n,sr,sg,sb,alpha,ctx);
      }
      // Additive glow on all classes (including slow, c=0 — previously
      // skipped, which was part of why slow filaments didn't pop) when
      // speed tint is active. bgSpeed themes (currents/viridis/plasma/
      // teal/warm) used to get the WEAKEST glow (0.07) of the three
      // branches, backwards from what's needed — a moving streak has to
      // cut through a busy painted-speed background to read as motion at
      // all, so those two branches are now the strongest, not the weakest.
      if(!th.bgSpeed){
        ctx.save();
        ctx.globalCompositeOperation='lighter';
        ctx.lineWidth=Math.max(0.5*dpr,th.lineWidth*(oceanSwapActive?(cfg.cOceanWidth??0.9):(cfg.oWidth??1.0))*dpr*0.34);
        for(let c=0;c<4;c++){
          const n=segN[c]; if(!n) continue;
          strokeFixed(segBuf[c],n,180,230,255,0.11*oceanOp,ctx);
        }
        ctx.restore();
      } else if(th.streak){
        ctx.save();
        ctx.globalCompositeOperation='lighter';
        ctx.lineWidth=Math.max(0.5*dpr,th.lineWidth*(oceanSwapActive?(cfg.cOceanWidth??0.9):(cfg.oWidth??1.0))*dpr*0.4);
        for(let c=0;c<4;c++){
          const n=segN[c]; if(!n) continue;
          strokeFixed(segBuf[c],n,220,235,255,0.16*oceanOp,ctx);
        }
        ctx.restore();
      } else {
        // cmap-based bgSpeed themes (currents/viridis/plasma) had no
        // luminescent glow pass at all — th.streak is null for these so the
        // branch above never ran. Tint the glow from the theme's own
        // colormap (sampled bright) so it stays on-palette per theme.
        ctx.save();
        ctx.globalCompositeOperation='lighter';
        ctx.lineWidth=Math.max(0.5*dpr,th.lineWidth*(oceanSwapActive?(cfg.cOceanWidth??0.9):(cfg.oWidth??1.0))*dpr*0.4);
        const cmapFn=th.cmap||oceanSpeedBg;
        const gc=cmapFn(0.85);
        const gr=Math.min(255,gc[0]+35), gg=Math.min(255,gc[1]+35), gb=Math.min(255,gc[2]+35);
        for(let c=0;c<4;c++){
          const n=segN[c]; if(!n) continue;
          strokeFixed(segBuf[c],n,gr,gg,gb,0.16*oceanOp,ctx);
        }
        ctx.restore();
      }
      ctx.restore();
      // ── Compare pass: custom ocean field alongside embedded (classes 0-3) ──
      if(_cmpOcean){
        const cth=getCompareTheme('ocean');
        ctx.save();
        ctx.globalCompositeOperation='source-over';
        ctx.lineWidth=cth.lineWidth*(cfg.cOceanWidth??cfg.oWidth??1.0)*dpr;
        const cUseStreak=cth.streak!==null; const cs=cth.streak||[255,255,255];
        for(let c=0;c<4;c++){
          const n=segNC[c]; if(!n) continue;
          const buf=segBufC[c], magBuf=segMagC[c];
          const alpha=Math.min(1,baseAlphas[c]*(cfg.cOceanOp??oceanOp));
          if(!cUseStreak||cth.cmap) strokeSpeedBuckets(buf,magBuf,n,cth,alpha,c,ctx);
          else strokeFixed(buf,n,cs[0],cs[1],cs[2],alpha,ctx);
        }
        ctx.restore();
      }
      // ── Draw wind belts (classes 4-7: trades/westerlies/polar/jets) on overlay canvas above land ──
      if(windOn){
        const effWWidth=windSwapActive?(cfg.cWindWidth??0.75):(cfg.wWidth??0.7);
        windCtx.lineWidth=wth.lineWidth*effWWidth*dpr*(qualityFlow?1.08:1);
        for(let ci=0;ci<4;ci++){
          const c=ci+4; const n=segN[c]; if(!n) continue;
          const buf=segBuf[c], magBuf=segMag[c];
          // Matches the GPU path's alphaW formula (was flat 0.28*windOp —
          // ~4x dimmer than ocean's 0.34-0.78 base alphas, which is why
          // wind read as "too subtle" even after the earlier 0.18→0.28 bump).
          const alpha=Math.min(0.95,0.62*(windOp*2));
          // Pass the real class (not hardcoded 4) so jets (c=7) resolve to
          // their own violet→white ramp in speedColor() instead of the
          // shared trades/westerlies/polar blue→yellow ramp.
          if(classCmapOverride(c)||useWindSpeedColor||wth.cmap) strokeSpeedBuckets(buf,magBuf,n,wth,alpha,c,windCtx);
          else strokeFixed(buf,n,wr,wg,wb,alpha,windCtx);
        }
        // Compare pass: custom wind field alongside embedded belts.
        if(_cmpWind){
          const cth=getCompareTheme('wind');
          const cUseStreak=cth.streak!==null; const cs=cth.streak||[255,255,255];
          windCtx.lineWidth=cth.lineWidth*(cfg.cWindWidth??cfg.wWidth??0.7)*dpr*(qualityFlow?1.08:1);
          for(let ci=0;ci<3;ci++){
            const c=ci+4; const n=segNC[c]; if(!n) continue;
            const buf=segBufC[c], magBuf=segMagC[c];
            const alpha=Math.min(0.95,0.62*((cfg.cWindOp??windOp)*2)); // matches embedded pass
            if(!cUseStreak||cth.cmap) strokeSpeedBuckets(buf,magBuf,n,cth,alpha,4,windCtx);
            else strokeFixed(buf,n,cs[0],cs[1],cs[2],alpha,windCtx);
          }
        }
        windCtx.restore();
      }
    }
    frame();
  }

  // flow appearance settings
  (function(){
    // Original defaults — slider thumb sits at 50 %, mapped to these values.
    window._flowCfg={oceanTheme:'currents',windTheme:'winds',oDensity:14000,wDensity:3500,
  oFade:0.984,wFade:0.968,oSpeed:1.0,wSpeed:1.1,oceanOp:1.0,windOp:0.6,oWidth:0.9,wWidth:0.75,oTurb:0.012,wTurb:0.018,
  // Loaded-field defaults — start the same as embedded so loading doesn't
  // suddenly change appearance; users can tweak them per-field.
  cOceanDensity:14000,cOceanFade:0.984,cOceanSpeed:1.0,cOceanOp:1.0,cOceanWidth:0.9,cOceanTurb:0.012,
  cWindDensity:3500,cWindFade:0.968,cWindSpeed:1.1,cWindOp:0.6,cWindWidth:0.75,cWindTurb:0.018};
    const _flowSliders=[
      ['oDensity','Particles',2000,22000,14000,true],
      ['oFade','Trail length',0.85,0.998,0.984,false],
      ['oSpeed','Speed',0.2,3.0,1.0,false],
      ['oceanOp','Opacity',0.1,1.5,1.0,false],
      ['oWidth','Streak width',0.3,3.0,0.9,false],
      ['oTurb','Turbulence',0,0.08,0.012,false],
      ['wDensity','Particles',0,5000,3500,true],
      ['wFade','Trail length',0.85,0.998,0.968,false],
      ['wSpeed','Speed',0.2,3.0,1.1,false],
      ['windOp','Opacity',0.0,1.5,0.6,false],
      ['wWidth','Streak width',0.2,2.0,0.75,false],
      ['wTurb','Turbulence',0,0.08,0.018,false],
    ];
    // Sliders for loaded-field appearance (same ranges/defaults as their
    // embedded equivalents, but write cOcean*/cWind* cfg keys). Only used
    // while that layer's custom field is fully swapped in (density has no
    // effect during compare mode, which splits the embedded tab's Particles
    // count 50/50 between embedded and custom).
    const _cfSliders={
      ocean:[
        ['cOceanDensity','Particles',2000,22000,14000,true],
        ['cOceanFade','Trail length',0.85,0.998,0.984,false],
        ['cOceanSpeed','Speed',0.2,3.0,1.0,false],
        ['cOceanOp','Opacity',0.1,1.5,1.0,false],
        ['cOceanWidth','Streak width',0.3,3.0,0.9,false],
        ['cOceanTurb','Turbulence',0,0.08,0.012,false],
      ],
      wind:[
        ['cWindDensity','Particles',0,5000,3500,true],
        ['cWindFade','Trail length',0.85,0.998,0.968,false],
        ['cWindSpeed','Speed',0.2,3.0,1.1,false],
        ['cWindOp','Opacity',0.0,1.5,0.6,false],
        ['cWindWidth','Streak width',0.2,2.0,0.75,false],
        ['cWindTurb','Turbulence',0,0.08,0.018,false],
      ],
    };
    function _flowPosToVal(pos,min,def,max,asInt){
      pos=+pos;
      let v;
      if(pos<=50) v=def-(def-min)*(50-pos)/50;
      else v=def+(max-def)*(pos-50)/50;
      return asInt?Math.round(v):v;
    }
    function _flowMkSlider([k,l,min,max,def,asInt],accent){
      return '<label style="display:block;margin-bottom:6px;font-size:8.5px;">'+l+
        '<input data-k="'+k+'" data-vmin="'+min+'" data-vdef="'+def+'" data-vmax="'+max+'"'+
        (asInt?' data-int="1"':'')+
        ' type="range" min="0" max="100" step="1" value="50"'+
        ' style="width:100%;accent-color:'+accent+';margin-top:2px;display:block;"></label>';
    }
    // Build a collapsible "Loaded Currents / Loaded Winds" sub-section
    // containing sliders for the custom-field appearance. The section is
    // initially hidden; _showCfPanel(target) reveals it once a field loads.
    function _mkCfAppPanel(target,accentColor){
      const icon=target==='ocean'?'🌊':'💨';
      const label=target==='ocean'?'LOADED CURRENTS':'LOADED WINDS';
      // Hardcoded per-target option lists — avoids a cross-IIFE timing dependency
      // on window._THEMES being populated before this function runs.
      const cmapEntries=target==='ocean'
        ?[['currents','🌊 Currents (speed)'],['ocean','⬜ White'],['dark','⬛ Dark'],
          ['viridis','🟩 Viridis'],['plasma','🟣 Plasma'],['turbo','🌈 Turbo'],
          ['teal','🟦 Teal'],['warm','🟤 Warm'],['infra','🔴 Infrared']]
        :[['winds','💨 Winds (speed)'],['wind_white','⬜ White'],['wind_cyan','🩵 Cyan'],
          ['wind_yellow','🟡 Yellow'],['turbo','🌈 Turbo'],['infra','🔴 Infrared'],['plasma','🟣 Plasma']];
      const themeSelHtml='<div style="font-size:8.5px;color:#7fa0b8;margin-bottom:3px;">Theme</div>'+
        `<select class="cf-theme-sel" data-target="${target}" style="width:100%;margin-bottom:8px;padding:3px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;font-size:9px;">`+
        '<option value="">Auto (match embedded)</option>'+
        cmapEntries.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')+
        '</select>';
      const sliderHtml=_cfSliders[target].map(s=>_flowMkSlider(s,accentColor)).join('');
      const panelId=`cf-app-${target}`;
      return `<div id="${panelId}" style="display:none;margin-top:8px;padding:8px;border-radius:6px;`+
        `background:rgba(0,255,180,0.04);border:1px solid rgba(80,220,180,0.18);">`+
        `<div style="font-size:8px;letter-spacing:0.12em;color:#7fdfc9;margin-bottom:8px;">${icon} ${label}</div>`+
        themeSelHtml+sliderHtml+`</div>`;
    }
    const box=document.createElement('div');
    box.id='gp-flow-box';
    box.style.cssText='width:100%;border-radius:8px;'+
      'padding:4px 0;font-family:IBM Plex Mono,monospace;font-size:9px;color:#9fb6c9;';
    // Three-tab header: Ocean · Wind — tab for each embedded layer.
    // Loaded-field panels appear inside their respective tab, below the
    // embedded sliders, when a field for that layer is loaded.
    box.innerHTML=
      '<div style="letter-spacing:0.15em;margin-bottom:8px;color:#cfe3f2;font-size:9.5px;">FLOW APPEARANCE</div>'+
      '<div style="display:flex;gap:4px;margin-bottom:10px;">'+
        '<button id="tab-ocean" style="padding:3px 0;border-radius:4px;border:none;cursor:pointer;font-size:8px;font-weight:600;letter-spacing:.05em;width:48%;background:var(--acc);color:#050d16;">🌊 OCEAN</button>'+
        '<button id="tab-wind"  style="padding:3px 0;border-radius:4px;border:none;cursor:pointer;font-size:8px;font-weight:600;letter-spacing:.05em;width:48%;background:rgba(30,50,70,0.8);color:#7fa0b8;">💨 WIND</button>'+
      '</div>'+
      // ── Ocean panel ──────────────────────────────────────────────
      '<div id="pnl-ocean">'+
        '<div style="font-size:8.5px;color:#7fa0b8;margin-bottom:3px;">Theme</div>'+
        '<select id="ocean-theme-sel" style="width:100%;margin-bottom:8px;padding:3px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;font-size:9px;">'+
        [['currents','🌊 Currents (speed)'],['ocean','⬜ White'],['dark','⬛ Dark'],['viridis','🟩 Viridis'],['plasma','🟣 Plasma'],['turbo','🌈 Turbo'],['teal','🟦 Teal'],['warm','🟤 Warm'],['infra','🔴 Infrared']].map(([v,l])=>`<option value="${v}">${l}</option>`).join('')+
        '</select>'+
        _flowSliders.slice(0,6).map(s=>_flowMkSlider(s,'#7fd0ff')).join('')+
        // Loaded Currents sub-panel — hidden until a custom ocean field loads
        _mkCfAppPanel('ocean','#7fdfc9')+
      '</div>'+
      // ── Wind panel ───────────────────────────────────────────────
      '<div id="pnl-wind" style="display:none;">'+
        '<div style="font-size:8.5px;color:#7fa0b8;margin-bottom:3px;">Theme</div>'+
        '<select id="wind-theme-sel" style="width:100%;margin-bottom:8px;padding:3px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;font-size:9px;">'+
        [['winds','💨 Winds (speed)'],['wind_white','⬜ White'],['wind_cyan','🩵 Cyan'],['wind_yellow','🟡 Yellow'],['turbo','🌈 Turbo'],['infra','🔴 Infrared'],['plasma','🟣 Plasma']].map(([v,l])=>`<option value="${v}">${l}</option>`).join('')+
        '</select>'+
        _flowSliders.slice(6).map(s=>_flowMkSlider(s,'#98d4ff')).join('')+
        // Loaded Winds sub-panel — hidden until a custom wind field loads
        _mkCfAppPanel('wind','#c9d4ff')+
      '</div>'+
      // ── Load / Reset buttons — always visible ────────────────────
      // Not inside a tab panel so .click() works when the panel is visible
      // (a file input inside display:none is silently ignored in Safari/FF).
      '<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(120,170,205,0.2);">'+
        '<div style="display:flex;gap:4px;margin-bottom:4px;">'+
          '<button id="cf-load-ocean" style="flex:1;padding:4px 0;border-radius:4px;border:1px solid rgba(120,170,205,0.3);cursor:pointer;font-size:8px;background:rgba(30,50,70,0.8);color:#cfe3f2;">🌊 Load Currents</button>'+
          '<button id="cf-load-wind"  style="flex:1;padding:4px 0;border-radius:4px;border:1px solid rgba(120,170,205,0.3);cursor:pointer;font-size:8px;background:rgba(30,50,70,0.8);color:#cfe3f2;">💨 Load Winds</button>'+
        '</div>'+
        '<div style="display:flex;gap:4px;">'+
          '<button id="cf-reset-ocean" style="flex:1;padding:3px 0;border-radius:4px;border:1px solid rgba(120,170,205,0.2);cursor:pointer;font-size:7.5px;background:transparent;color:#7fa0b8;">Reset currents</button>'+
          '<button id="cf-reset-wind"  style="flex:1;padding:3px 0;border-radius:4px;border:1px solid rgba(120,170,205,0.2);cursor:pointer;font-size:7.5px;background:transparent;color:#7fa0b8;">Reset winds</button>'+
        '</div>'+
        '<div id="cf-status" style="font-size:7.5px;color:#6a8298;margin-top:5px;min-height:11px;"></div>'+
      '</div>';
    box.querySelectorAll('input[data-k]').forEach(inp=>{
      inp.addEventListener('input',()=>{
        const v=_flowPosToVal(inp.value,+inp.dataset.vmin,+inp.dataset.vdef,+inp.dataset.vmax,!!inp.dataset.int);
        window._flowCfg[inp.dataset.k]=v;
      });
    });
    // Loaded-field colormap select — writes window._customFieldTheme so
    // getOceanTheme()/getWindTheme()/getCompareTheme() pick it up, and
    // forces both the CPU repaint and the GPU LUT to rebuild.
    box.querySelectorAll('select.cf-theme-sel').forEach(sel=>{
      sel.addEventListener('change',()=>{
        const target=sel.dataset.target;
        window._customFieldTheme[target]=sel.value||null;
        if(window._invalidateFieldCaches) window._invalidateFieldCaches();
        if(window._flowClear) window._flowClear();
      });
    });
    // Reveal the Loaded Currents / Loaded Winds sub-panel when a custom
    // field finishes loading. Also switch to the right tab so it's visible.
    window._showCfPanel=function(target){
      const panelId='cf-app-'+target;
      const pnl=box.querySelector('#'+panelId);
      if(pnl) pnl.style.display='';
      // Sync the colormap select to whatever's currently set (e.g. if a
      // field was reloaded and a colormap choice already exists).
      const sel=box.querySelector('select.cf-theme-sel[data-target="'+target+'"]');
      if(sel) sel.value=(window._customFieldTheme&&window._customFieldTheme[target])||'';
      // Switch to the matching tab so the user immediately sees it.
      const tabO=box.querySelector('#tab-ocean'), tabW=box.querySelector('#tab-wind');
      const pnlO=box.querySelector('#pnl-ocean'), pnlW=box.querySelector('#pnl-wind');
      if(target==='ocean'&&tabO){
        pnlO.style.display=''; pnlW.style.display='none';
        tabO.style.background='var(--acc)'; tabO.style.color='#050d16';
        tabW.style.background='rgba(30,50,70,0.8)'; tabW.style.color='#7fa0b8';
      } else if(target==='wind'&&tabW){
        pnlO.style.display='none'; pnlW.style.display='';
        tabW.style.background='var(--acc)'; tabW.style.color='#050d16';
        tabO.style.background='rgba(30,50,70,0.8)'; tabO.style.color='#7fa0b8';
      }
    };
    const oSel=box.querySelector('#ocean-theme-sel');
    const wSel=box.querySelector('#wind-theme-sel');
    // Sync dropdown selection to the actual cfg default (currents/winds).
    if(oSel) oSel.value=window._flowCfg.oceanTheme||'currents';
    if(wSel) wSel.value=window._flowCfg.windTheme||'winds';
    if(oSel) oSel.addEventListener('change',()=>{
      window._flowCfg.oceanTheme=oSel.value;
      if(window._flowClear) window._flowClear();
    });
    if(wSel) wSel.addEventListener('change',()=>{ window._flowCfg.windTheme=wSel.value; });
    // Tab switching
    const tabO=box.querySelector('#tab-ocean'), tabW=box.querySelector('#tab-wind');
    const pnlO=box.querySelector('#pnl-ocean'), pnlW=box.querySelector('#pnl-wind');
    if(tabO) tabO.addEventListener('click',()=>{
      pnlO.style.display=''; pnlW.style.display='none';
      tabO.style.background='var(--acc)'; tabO.style.color='#050d16';
      tabW.style.background='rgba(30,50,70,0.8)'; tabW.style.color='#7fa0b8';
    });
    if(tabW) tabW.addEventListener('click',()=>{
      pnlO.style.display='none'; pnlW.style.display='';
      tabW.style.background='var(--acc)'; tabW.style.color='#050d16';
      tabO.style.background='rgba(30,50,70,0.8)'; tabO.style.color='#7fa0b8';
    });
    window._repaintOcean=()=>{ if(window._flowClear) window._flowClear(); };
    // File input lives at document.body level (never inside a hidden
    // container) so .click() works reliably across browsers.
    const _cfFileInput=document.createElement('input');
    _cfFileInput.type='file';
    _cfFileInput.accept='.json,application/json';
    _cfFileInput.style.display='none';
    _cfFileInput.id='cf-file-input';
    document.body.appendChild(_cfFileInput);
    // Custom velocity field loader wiring
    (function(){
      const fileInput=_cfFileInput;
      const status=box.querySelector('#cf-status');
      let pendingTarget=null;
      function setStatus(msg,isErr){
        if(!status) return;
        status.textContent=msg;
        status.style.color=isErr?'#ff8a8a':'#7fd0ff';
      }
      function pick(target){
        pendingTarget=target;
        console.log('[custom field] pick('+target+') — opening file dialog');
        if(fileInput){ fileInput.click(); }
        else { console.error('[custom field] file input element missing'); setStatus('File input unavailable',true); }
      }
      const bO=box.querySelector('#cf-load-ocean'), bW=box.querySelector('#cf-load-wind');
      const rO=box.querySelector('#cf-reset-ocean'), rW=box.querySelector('#cf-reset-wind');
      console.log('[custom field] wiring buttons — ocean:',!!bO,'wind:',!!bW,'input:',!!fileInput);
      if(bO) bO.addEventListener('click',()=>pick('ocean'));
      if(bW) bW.addEventListener('click',()=>pick('wind'));
      function syncEarthSystemsRow(target,on){
        const row=document.querySelector('#custom-field-grp .row[data-target="'+target+'"]');
        if(row&&row.style.display!=='none'){
          row.classList.toggle('on',on); row.classList.toggle('off',!on);
        }
      }
      if(rO) rO.addEventListener('click',()=>{
        if(window._resetVelocityField){ window._resetVelocityField('ocean'); setStatus('Ocean reset to embedded data'); syncEarthSystemsRow('ocean',false); }
      });
      if(rW) rW.addEventListener('click',()=>{
        if(window._resetVelocityField){ window._resetVelocityField('wind'); setStatus('Wind reset to embedded data'); syncEarthSystemsRow('wind',false); }
      });
      function loadFile(f,target){
        if(!f){ setStatus('No file',true); return; }
        console.log('[custom field] reading',f.name,'→',target);
        setStatus('Loading '+f.name+'…');
        const reader=new FileReader();
        reader.onload=()=>{
          try{
            const json=JSON.parse(reader.result);
            console.log('[custom field] parsed JSON, keys:',Object.keys(json).join(','));
            const fn=window._loadCustomVelocityField;
            if(typeof fn!=='function'){ console.error('[custom field] _loadCustomVelocityField not defined'); setStatus('Loader not ready',true); return; }
            const ok=fn(json,target);
            setStatus(ok?('Loaded into '+target+': '+(json.description||f.name)):'Load failed — see console',!ok);
          }catch(e){
            console.error('[custom field] parse/load error:',e);
            setStatus('Error: '+e.message,true);
          }
        };
        reader.onerror=()=>{ console.error('[custom field] FileReader error'); setStatus('Could not read file',true); };
        reader.readAsText(f);
      }
      if(fileInput) fileInput.addEventListener('change',()=>{
        const f=fileInput.files&&fileInput.files[0];
        const target=pendingTarget; pendingTarget=null;
        fileInput.value='';
        console.log('[custom field] change fired — file:',f&&f.name,'target:',target);
        if(f&&target) loadFile(f,target);
      });
      // Drag-and-drop fallback onto the flow panel — more robust than the
      // file dialog (which can be blocked in some contexts). Drop a JSON
      // while the Ocean tab is active → ocean; Wind tab active → wind.
      box.addEventListener('dragover',e=>{ e.preventDefault(); box.style.outline='1px dashed var(--acc)'; });
      box.addEventListener('dragleave',()=>{ box.style.outline=''; });
      box.addEventListener('drop',e=>{
        e.preventDefault(); e.stopPropagation(); box.style.outline='';
        const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];
        if(!f){ return; }
        const target=(box.querySelector('#pnl-wind')&&box.querySelector('#pnl-wind').style.display!=='none')?'wind':'ocean';
        console.log('[custom field] file dropped →',target);
        loadFile(f,target);
      });
    })();
    const mount=document.getElementById('gp-flow-mount');
    (mount||document.body).appendChild(box);
  })();
  // dedicated zoom control
  (function(){
    function zoomBy(f){scale=Math.max(baseScale*0.85,Math.min(baseScale*MAX_ZOOM,scale*f));redraw();}
    const z=document.createElement('div');
    z.className='gp-zoomctrl';
    z.style.cssText='position:fixed;right:18px;top:18px;z-index:55;display:flex;flex-direction:column;gap:6px;';
    [['＋',()=>zoomBy(1.3)],['－',()=>zoomBy(1/1.3)],['⌂',()=>{
      // Previously only reset `scale`, leaving the globe wherever the user
      // had last dragged/rotated it — after zooming into a small regional
      // grid (Alaska, Puerto Rico, the Great Lakes...) clicking "home"
      // would zoom back out but stay pointed at that region, which reads
      // as broken since it doesn't return to the actual home view.
      scale=baseScale; rotate=[-17,-2,0]; redraw();
    }]].forEach(([t,fn])=>{
      const b=document.createElement('button');
      b.textContent=t;b.title=t==='⌂'?'Reset view':(t==='＋'?'Zoom in':'Zoom out');
      b.style.cssText='width:34px;height:34px;border-radius:8px;border:1px solid rgba(120,170,205,0.35);'+
        'background:rgba(8,20,33,0.85);color:#cfe3f2;font-size:15px;cursor:pointer;line-height:1;';
      b.addEventListener('mouseenter',()=>b.style.borderColor='var(--acc)');
      b.addEventListener('mouseleave',()=>b.style.borderColor='rgba(120,170,205,0.35)');
      b.addEventListener('click',fn);
      z.appendChild(b);
    });
    document.body.appendChild(z);
  })();
  svg.addEventListener('wheel',(e)=>{
    e.preventDefault();
    scale=Math.max(baseScale*0.85,Math.min(baseScale*MAX_ZOOM,scale*(1-e.deltaY*0.0012)));
    redraw();
  },{passive:false});
  // Guard against popup click-through: menus/dialogs that dismiss on
  // mousedown leave the follow-up 'click' (fired at mouseup) targeting
  // whatever sits underneath the cursor — the globe — so picking an item
  // from a popup box was ALSO opening the feature info panel. Track where
  // each mousedown actually started (capture phase, window-level, so it
  // sees the event even when the popup stops propagation) and only honour
  // globe clicks whose press began on the globe itself.
  window.addEventListener('mousedown',(e)=>{
    window._downOnGlobe=svg.contains(e.target);
  },true);
  svg.addEventListener('click',(e)=>{
    if(dragging) return;
    if(window._downOnGlobe===false) return;
    let el=e.target;
    while(el&&el!==svg){
      const id=el.getAttribute&&el.getAttribute('data-info');
      if(id&&infoData[id]){showInfoPanel(id);return;}
      el=el.parentNode;
    }
  });
  function applyFlowAnim(){
    for(const it of items){
      if(it.flow && it.node.style.display!=='none'){
        it.node.setAttribute('stroke-dashoffset',
          String(-(flowTick*it.flowSpeed)%(it.flowPeriod||28)));
      }
    }
  }

  function tick(){
    flowTick++; frameCount++;
    applyFlowAnim();
    if(frameCount%4===0 && window.GlobeAPI?.onRedraw && !dragging)
      window.GlobeAPI.onRedraw();
    requestAnimationFrame(tick);
  }

  /* ============================================================ CONTROL PANEL */
  const GROUPS=[
    {id:'ocean',name:'Ocean',items:[
      {id:'warm',label:'Warm currents',sw:['l','var(--warm)'],on:true},
      {id:'cold',label:'Cold currents',sw:['l','var(--cold)'],on:true},
      {id:'acc',label:'Antarctic Circumpolar Current',sw:['b','var(--acc)'],on:true},
      {id:'gyres',label:'Subtropical gyres',sw:['l','rgba(150,200,225,0.8)'],on:true},
      {id:'upwell',label:'Upwelling zones',sw:['h','#38e0a0'],on:false}
    ]},
    {id:'atmos',name:'Atmosphere',items:[
      {id:'pressure',label:'Pressure systems (H / L)',sw:['g','var(--warm)','H'],on:false},
      {id:'trades',label:'Trade winds',sw:['l','var(--trade)'],on:false},
      {id:'wester',label:'Westerlies',sw:['l','var(--wester)'],on:false},
      {id:'polar',label:'Polar easterlies',sw:['l','var(--polar)'],on:false},
      {id:'jets',label:'Jet streams',sw:['l','var(--jet-pol)'],on:false}
    ]},
    {id:'enso',name:'ENSO · Pacific',items:[
      {id:'pool',label:'W. Pacific Warm Pool',sw:['b','#ff6a4d'],on:false},
      {id:'nino',label:'Niño index regions',sw:['x','#ffd24a'],on:false}
    ]}
  ];
  const PRESETS=[
    {id:'oceans',name:'Oceans',layers:['graticule','reflines','basins','warm','cold','acc','upwell','gyres']},
    {id:'atmos',name:'Atmosphere',layers:['graticule','reflines','basins','s-itcz','pressure','trades','wester','polar','jets']},
    {id:'enso',name:'ENSO',layers:['graticule','reflines','basins','warm','cold','pool','nino']},
    {id:'all',name:'Everything',layers:'ALL'}
  ];
  function swHTML(sw){
    const t=sw[0],c=sw[1];
    if(t==='l') return `<span class="swl" style="border-top-color:${c};box-shadow:0 0 5px ${c}"></span>`;
    if(t==='d') return `<span class="swd" style="border-top-color:${c}"></span>`;
    if(t==='b') return `<span class="swb" style="background:${c};box-shadow:0 0 5px ${c}"></span>`;
    if(t==='x') return `<span class="swx" style="border-color:${c};background:${c}22"></span>`;
    if(t==='h') return `<span class="swh" style="border-color:${c};background:repeating-linear-gradient(45deg,transparent,transparent 3px,${c} 3px,${c} 4.4px)"></span>`;
    if(t==='c') return `<span class="swc" style="background:${c};box-shadow:0 0 6px ${c}"></span>`;
    if(t==='g') return `<span class="swg" style="background:${c}">${sw[2]||''}</span>`;
    return '';
  }
  const CHK='<svg viewBox="0 0 12 12"><path d="M2 6.5 L5 9.5 L10 3" fill="none" stroke="#061119" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // Per-class colormap picker (Earth Systems): maps the 7 customizable
  // current/wind-belt layer ids to the numeric particle class used by
  // classCmapOverride() in the globe block. Jets excluded — fixed ramp.
  const CLASS_NUM={warm:0,cold:1,acc:2,gyres:3,trades:4,wester:5,polar:6,jets:7};
  // Short row labels used only when a colormap picker is present, so
  // label+select fit on one row without truncation or wrapping to a
  // second row (full names still surface via the row's title attribute).
  const CLASS_SHORT_LABEL={warm:'Warm',cold:'Cold',acc:'ACC',gyres:'Gyres',trades:'Trades',wester:'Westerlies',polar:'Polar',jets:'Jets'};
  const CMAP_OPTIONS=[['','Default'],['currents','Currents'],['dark','Dark'],
    ['viridis','Viridis'],['plasma','Plasma'],['teal','Teal'],['warm','Warm'],
    ['infra','Infrared'],['turbo','Turbo'],['winds','Speed (blue-yellow)'],
    ['wind_cyan','Cyan'],['wind_yellow','Yellow']];
  const CMAP_OPTIONS_HTML=CMAP_OPTIONS.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');

  function buildPanel(){
    const ctrl=document.getElementById('ctrl');
    // The standalone month slider that used to sit here was MERGED into
    // the sync TIMELINE block (GlobeTimeline.buildPanel) — having a month
    // control at the top AND a timeline at the bottom of the same pane
    // was two UIs for one concept. The timeline covers both roles: its
    // month chips/slider drive the seasonal layers (it broadcasts month
    // via subscribe → currentMonth), and once data overlays are loaded it
    // switches to real dates and syncs every layer's frame. setMonth()
    // still null-guards #month-slider/#month-label so nothing else broke.

    // collapsible group sections
    const groupsEl=document.getElementById('groups');
    GROUPS.forEach((g,gi)=>{
      const sec=document.createElement('div'); sec.className='grp collapsible';
      const open = false; // all sections start collapsed — cleaner first paint
      sec.innerHTML=`<div class="grp-head" data-grp="${g.id}">
        <span class="grp-caret">${open?'▾':'▸'}</span>
        <span class="grp-name">${g.name}</span>
        <span class="toggle-all" data-grp="${g.id}">all</span>
      </div><div class="grp-body" style="display:${open?'':'none'}"></div>`;
      const body=sec.querySelector('.grp-body');
      g.items.forEach(it=>{
        state[it.id]=it.on;
        const row=document.createElement('div');
        row.className='row'+(it.on?' on':' off'); row.dataset.layer=it.id;
        const clsNum=CLASS_NUM[it.id];
        // Rows with a colormap picker use a short label (full name moves to
        // the row's title tooltip) so label+select both fit on one row —
        // a full name like "Antarctic Circumpolar Current" plus a select
        // has no room on this panel's width without truncating one or the
        // other or wrapping to a second row (tried both, both looked worse).
        const rowLabel=clsNum===undefined?it.label:(CLASS_SHORT_LABEL[it.id]||it.label);
        const cmapSel=clsNum===undefined?'':
          `<select class="nc-sel cls-cmap-sel" data-cls="${clsNum}" title="Colormap for ${it.label}" style="width:auto;max-width:118px;padding:2px 4px;font-size:10.5px;margin-left:auto;flex:0 0 auto;">${CMAP_OPTIONS_HTML}</select>`;
        row.innerHTML=`<span class="chk">${CHK}</span><span class="sw">${swHTML(it.sw)}</span>`+
          `<span class="lbl" style="display:flex;align-items:center;gap:6px;min-width:0;">`+
          `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${rowLabel}</span>${cmapSel}</span>`;
        if(clsNum!==undefined) row.title=it.label;
        row.addEventListener('click',()=>{setLayer(it.id,!state[it.id]);syncPresets();});
        if(clsNum!==undefined){
          const sel=row.querySelector('.cls-cmap-sel');
          sel.addEventListener('click',e=>e.stopPropagation());
          sel.addEventListener('change',e=>{
            e.stopPropagation();
            window._classColormap=window._classColormap||{};
            if(sel.value) window._classColormap[clsNum]=sel.value;
            else delete window._classColormap[clsNum];
          });
        }
        body.appendChild(row);
      });
      groupsEl.appendChild(sec);
      // collapse/expand on header click (but not on the "all" toggle)
      sec.querySelector('.grp-head').addEventListener('click',e=>{
        if(e.target.classList.contains('toggle-all'))return;
        const b=sec.querySelector('.grp-body'),caret=sec.querySelector('.grp-caret');
        const hidden=b.style.display==='none';
        b.style.display=hidden?'':'none'; caret.textContent=hidden?'▾':'▸';
      });
    });
    groupsEl.querySelectorAll('.toggle-all').forEach(el2=>el2.addEventListener('click',e=>{
      e.stopPropagation();
      const g=GROUPS.find(x=>x.id===el2.dataset.grp);
      const anyOff=g.items.some(it=>!state[it.id]);
      g.items.forEach(it=>setLayer(it.id,anyOff)); syncPresets();
    }));
    // presets
    const pe=document.getElementById('presets');
    PRESETS.forEach(p=>{
      const b=document.createElement('button'); b.textContent=p.name; b.dataset.preset=p.id;
      b.addEventListener('click',()=>applyPreset(p)); pe.appendChild(b);
    });
  }
  function startPlay(){
    const pb=document.getElementById('play-btn'); if(pb) pb.textContent='⏸';
    playTimer=setInterval(()=>setMonth((currentMonth+1)%12),950);
  }
  function stopPlay(){
    clearInterval(playTimer); playTimer=null;
    const pb=document.getElementById('play-btn'); if(pb) pb.textContent='▶';
  }
  function setLayer(id,on){
    state[id]=on;
    const row=document.querySelector(`.row[data-layer="${id}"]`);
    if(row){row.classList.toggle('on',on);row.classList.toggle('off',!on);}
    if(id==='jets'&&window._setJetsActive) window._setJetsActive(on);
    redraw();
  }
  function applyPreset(p){
    const allIds=GROUPS.flatMap(g=>g.items.map(i=>i.id));
    const want=(p.layers==='ALL'?allIds:p.layers);
    // Toggle: if ALL preset layers are already ON, turn them OFF; else turn them ON
    // Don't touch layers outside this preset — allow independent stacking
    const allOn=want.every(id=>!!state[id]);
    want.forEach(id=>setLayer(id,!allOn));
    syncPresets();
  }
  function syncPresets(){
    const cur=GROUPS.flatMap(g=>g.items.map(i=>i.id)).filter(id=>state[id]).sort().join(',');
    document.querySelectorAll('.presets button').forEach(b=>{
      const p=PRESETS.find(x=>x.id===b.dataset.preset);
      if(!p) return; // skip buttons without a matching preset (e.g. Seasonal)
      const allIds=GROUPS.flatMap(g=>g.items.map(i=>i.id));
      const want=(p.layers==='ALL'?allIds:p.layers).slice().sort().join(',');
      b.classList.toggle('on',want===cur);
    });
  }
  function setSwitch(id,on){const s=document.getElementById(id);if(s)s.classList.toggle('on',on);}
  let hintFaded=false;
  function fadeHint(){if(hintFaded)return;hintFaded=true;const h=document.getElementById('hint');if(h){h.style.opacity='0';setTimeout(()=>h.remove(),500);}}
  function wireOpts(){

    document.getElementById('night').addEventListener('click',function(){night=!night;this.classList.toggle('on',night);redraw();});
    document.getElementById('reset').addEventListener('click',()=>{rotate=[-17,-2,0];scale=baseScale;redraw();});
    document.getElementById('info-close').addEventListener('click',()=>{
      const panel=document.getElementById('info-panel');
      panel.classList.remove('visible');
      setTimeout(()=>{panel.style.display='none';},300);
    });
  }

  /* ============================================================ INIT */
  async function init(){
    // Reference layers have no panel section anymore — set their defaults here
    // (graticule/reflines/basins always on; borders/names live in Geography + zoom LOD)
    state.graticule=true; state.reflines=true; state.basins=true;
    // Country borders + names default ON since the label-collision culling
    // landed (labels no longer pile up over Europe/Caribbean at far zoom).
    if(state.countries===undefined)state.countries=true;
    if(state['country-names']===undefined)state['country-names']=true;
    if(state['user-geo']===undefined)state['user-geo']=false;
    for(let i=items.length-1;i>=0;i--){
      if(items[i].layer==='places'||items[i].kind==='place-dot'){
        items[i].node.remove();
        items.splice(i,1);
      }
    }
    buildPanel(); wireOpts(); syncPresets();
    initFlowField();
    resize();
    window.GlobeAPI={
      items,state,infoData,gMain,gLabels,svg,defs,A,C,d3,world:null,
      addLine,addPoly,addLabel,addMark,addDynamic,addDynamicLabel,
      ellipseLoop,ninoRing,marker,redraw,setMonth,setLayer,GROUPS,LONS,
      globeViewport,applyUserGeoLayer,clearUserGeoLayer,
      get currentMonth(){return currentMonth;},
      get path(){return path;},
      get projection(){return projection;},
      get isDragging(){return dragging;},

      get flowTick(){return flowTick;}
    };
    try{
      const atlasUrl = window.__worldAtlasUrl || 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json';
      const bordersUrl = window.__countriesAtlasUrl || atlasUrl.replace('land-110m','countries-110m');
      const [l, c] = await Promise.all([
        fetch(atlasUrl).then(r=>r.json()),
        fetch(bordersUrl).then(r=>r.json()).catch(()=>null)
      ]);
      world = {
        land: topojson.feature(l, l.objects.land),
        borders: c ? topojson.mesh(c, c.objects.countries, (a,b)=>a!==b) : null,
        countries: c ? topojson.feature(c, c.objects.countries) : null
      };
      window.GlobeAPI.world = world;
      document.getElementById('loading').remove();
      populate();
      if(window.AdvancedGlobe) window.AdvancedGlobe(window.GlobeAPI);
      try{
        if(window.GlobeNC) window.GlobeNC(window.GlobeAPI);
      }catch(e){ console.error('[Globe] GlobeNC failed:', e); }
      if(window.GlobeAnnotations) window.GlobeAnnotations(window.GlobeAPI);
      if(window.GlobeRegion) window.GlobeRegion(window.GlobeAPI);
      if(!window._globeFeedsDone&&window.GlobeFeeds){window._globeFeedsDone=1;window.GlobeFeeds(window.GlobeAPI);}
      if(window.GlobeTimeline){
        window.GlobeTimeline.buildPanel(document.getElementById('ctrl'));
        window.GlobeTimeline.subscribe((month)=>{
          if(currentMonth!==month){currentMonth=month;redraw();}
        });
      }
      if(window.finalizeGlobeNcPanel) window.finalizeGlobeNcPanel();
      else if(window.reorgWorkspacePanel) window.reorgWorkspacePanel();
    }catch(err){
      console.error(err);
      const ld=document.getElementById('loading');
      if(ld){
        ld.classList.add('err');
        const lm=document.getElementById('loadmsg');
        if(lm) lm.textContent='Could not load map data — check connection.';
        const ring=ld.querySelector('.ring');
        if(ring) ring.style.display='none';
      }
    }finally{
      resize();
      window.addEventListener('resize',resize);
      tick();
    }
  }
  init().catch(err=>{
    console.error('[Globe init failed]', err);
    try{
      const ld=document.getElementById('loading');
      if(ld){ld.classList.add('err');const lm=document.getElementById('loadmsg');if(lm)lm.textContent='Init error: '+err.message;}
    }catch(e2){}
  });
})();

