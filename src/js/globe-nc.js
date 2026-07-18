/* globe-nc */
/* ============================================================
   globe-nc.js  –  Multi-overlay NetCDF engine (frames edition)
   ─────────────────────────────────────────────────────────────
   Each overlay card holds a FRAME LIST — time steps merged from
   one or more .nc files. This lets you load e.g.:
     SST_Jan.nc → SST_Feb.nc → SST_Mar.nc → … as one timeline.
   Up to 4 overlay cards run simultaneously; each card has its
   own colour map, opacity, range, and variable picker.
   Global "▶ Play all" advances every card in sync.
   ============================================================ */
(function () {

/* ============================================================ COLOUR MAPS */
function lut(stops) {
  const a = new Uint8Array(768), n = stops.length - 1;
  for (let i = 0; i < 256; i++) {
    const t=i/255, seg=Math.min(n-1,Math.floor(t*n)), f=t*n-seg;
    const [r0,g0,b0]=stops[seg],[r1,g1,b1]=stops[seg+1];
    a[i*3]=Math.round(r0+f*(r1-r0));a[i*3+1]=Math.round(g0+f*(g1-g0));a[i*3+2]=Math.round(b0+f*(b1-b0));
  }
  return a;
}
const CMAPS = {
  'viridis':  lut([[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]]),
  'plasma':   lut([[13,8,135],[126,3,168],[204,71,120],[248,149,64],[240,249,33]]),
  'inferno':  lut([[0,0,4],[87,16,110],[188,55,84],[249,142,9],[252,255,164]]),
  'magma':    lut([[0,0,4],[81,18,124],[183,55,121],[252,141,84],[252,253,191]]),
  'coolwarm': lut([[59,76,192],[133,173,232],[221,221,221],[238,141,117],[180,4,38]]),
  'RdBu':     lut([[178,24,43],[239,138,98],[247,247,247],[103,169,207],[33,102,172]]),
  'RdBu_r':   lut([[33,102,172],[103,169,207],[247,247,247],[239,138,98],[178,24,43]]),
  'jet':      lut([[0,0,127],[0,0,255],[0,127,255],[0,255,255],[127,255,127],[255,255,0],[255,127,0],[255,0,0],[127,0,0]]),
  'Greens':   lut([[247,252,245],[199,233,192],[116,196,118],[49,163,84],[0,109,44]]),
  'Blues':    lut([[247,251,255],[198,219,239],[107,174,214],[33,113,181],[8,48,107]]),
  'Oranges':  lut([[255,245,235],[254,190,134],[253,141,60],[217,71,1],[127,39,4]]),
  'Purples':  lut([[252,251,253],[218,218,235],[158,154,200],[106,81,163],[63,0,125]]),
  /* Nullschool Earth–inspired palettes */
  'earth_temp':    lut([[0,0,80],[0,60,180],[0,160,220],[80,200,80],[220,200,0],[220,80,0],[180,0,0],[255,220,180]]),
  'earth_wind':    lut([[20,20,60],[30,60,140],[20,140,160],[60,180,80],[200,200,40],[220,120,20],[180,40,80],[120,20,120]]),
  'earth_ocean':   lut([[2,8,32],[8,32,80],[16,72,140],[40,140,180],[120,200,220],[220,240,255]]),
  'earth_current': lut([[8,16,48],[20,60,120],[40,120,160],[80,180,140],[200,200,60],[240,140,40]]),
  'earth_humidity':lut([[180,120,40],[200,180,60],[120,180,120],[60,160,180],[40,100,180],[20,40,120]]),
  'earth_pressure':lut([[0,40,120],[60,120,200],[200,220,240],[240,180,120],[200,60,40],[120,0,0]]),
  'earth_precip':  lut([[240,240,240],[180,210,255],[100,160,240],[40,180,120],[200,220,40],[240,120,20],[180,0,0]]),
  'earth_cloud':   lut([[16,24,40],[40,56,80],[80,100,120],[140,150,160],[200,205,210],[240,242,245]]),
  'earth_sst':     lut([[60,0,80],[120,0,100],[0,60,160],[0,140,180],[40,180,100],[200,200,60],[240,120,40],[200,40,20]]),
  'earth_ice':     lut([[240,248,255],[200,220,240],[140,180,220],[80,140,200],[40,80,160],[20,40,100]]),
  'earth_diverge': lut([[40,80,180],[120,170,220],[230,235,240],[240,190,130],[220,100,50],[160,30,30]]),
  'earth_neon':    lut([[0,255,200],[0,200,255],[80,120,255],[200,80,255],[255,80,160],[255,160,60],[255,255,100]]),
};
const CMAP_KEYS = Object.keys(CMAPS);

/* ============================================================ FORMAT DETECTION */
function detectFormat(buf) {
  const h=new Uint8Array(buf,0,8);
  if(h[0]===0x43&&h[1]===0x44&&h[2]===0x46) return 'nc3';
  if(h[0]===0x89&&h[1]===0x48&&h[2]===0x44&&h[3]===0x46) return 'hdf5';
  if(h[0]===0x47&&h[1]===0x52&&h[2]===0x49&&h[3]===0x42){
    // Check GRIB edition byte (offset 7): 1=GRIB1, 2=GRIB2
    return h[7]===1?'grib1':'grib2';
  }
  for(let i=0;i<Math.min(8192,h.length-4);i++){if(h[i]===0x47&&h[i+1]===0x52&&h[i+2]===0x49&&h[i+3]===0x42){return h[i+7]===1?'grib1':'grib2';}}
  return 'unknown';
}

/* NetCDF-3 wrapper — adds getTimeSlice so multi-dimensional classic files
   (e.g. air time×level×lat×lon) slice without loading the full variable
   on every frame change.
   netcdfjs's own parser nests AT MOST one level deep: a record (unlimited-
   dimension) variable comes back as Array(nRecords), where EACH element is
   already a fully FLAT array spanning every remaining dimension (e.g.
   level×lat×lon in C order) — never a further-nested [level][lat][lon]
   structure. A non-record variable is just one flat array. So the only
   "nested" index to peel off is the record (time) dimension; everything
   else is a stride computation into that one flat sub-array. */
function wrapNC3Reader(reader,fname){
  reader._fname=fname;
  reader._rawCache=reader._rawCache||{};
  reader._sliceCache=reader._sliceCache||{};
  reader.getTimeSlice=function(varName,tIdx,timeI,levIdx,levI){
    const v=reader.variables.find(x=>x.name===varName); if(!v) return null;
    const dimNames=reader.dimensions.map(d=>d.name);
    const dims=(v.dimensions||[]).map(i=>typeof i==='number'?dimNames[i]:String(i));
    // NetCDF-3's unlimited (record) dimension reports size=0 in the raw header —
    // the real current record count lives on reader.recordDimension.length.
    const recLen=reader.recordDimension?.length||0;
    const shape=dims.map(name=>{const d=reader.dimensions.find(x=>x.name===name);
      if(!d) return 1;
      return d.size>0?d.size:(recLen||1);
    });
    const nd=shape.length;
    let tI=timeI>=0?timeI:dims.findIndex(d=>/^time$|^t$|^mt$|^date$|valid_time|forecast_time/i.test(d));
    let lI=levI>=0?levI:dims.findIndex(d=>/level|lev|plev|pressure|depth|sigma|hybrid/i.test(d));
    let latI=dims.findIndex(d=>/lat/i.test(d));
    let lonI=dims.findIndex(d=>/lon/i.test(d));
    if(latI<0) latI=nd-2; if(lonI<0) lonI=nd-1;
    const nLat=shape[latI],nLon=shape[lonI];
    const ti=tI>=0?Math.min(Math.max(0,tIdx|0),shape[tI]-1):0;
    const li=lI>=0?Math.min(Math.max(0,levIdx??0),shape[lI]-1):0;
    const cacheKey=varName+'|'+ti+'|'+li;
    if(reader._sliceCache[cacheKey]) return reader._sliceCache[cacheKey];
    let raw=reader._rawCache[varName];
    if(!raw){raw=reader.getDataVariable(varName);if(raw==null)return null;reader._rawCache[varName]=raw;}

    // netcdfjs returns RECORD variables as a JS array nested one level per
    // record (raw[ti] = the remaining dims), but FIXED-dim variables (time
    // written as a normal dimension — xarray/CDO output does this
    // routinely) come back as ONE flat array over ALL dims including time.
    // The old check treated ANY plain Array as record-nested, so for
    // fixed-dim-time files `raw[ti]` plucked a single NUMBER out of the
    // flat array and every timestep decoded as garbage (one value + fill).
    // Discriminate by element type and index the flat case with an
    // explicit time stride instead.
    let rec=raw, baseOff=0;
    const nested=tI>=0&&Array.isArray(raw)&&raw.length>0&&typeof raw[0]!=='number'&&raw.length===shape[tI];
    let recDims,recShape;
    if(nested){
      rec=raw[ti]; if(rec==null) return null;
      recDims=dims.filter((_,d)=>d!==tI);
      recShape=shape.filter((_,d)=>d!==tI);
    } else {
      recDims=dims; recShape=shape;
    }
    const rLatI=recDims.indexOf(dims[latI]);
    const rLonI=recDims.indexOf(dims[lonI]);
    const rLevI=lI>=0?recDims.indexOf(dims[lI]):-1;
    if(rLatI<0||rLonI<0) return null;
    const flat=toFlatArray(rec,recShape); if(!flat) return null;
    const rnd=recShape.length;
    const strides=new Array(rnd); {let s=1;for(let d=rnd-1;d>=0;d--){strides[d]=s;s*=recShape[d];}}
    if(!nested&&tI>=0){ const rTI=recDims.indexOf(dims[tI]); if(rTI>=0) baseOff=ti*strides[rTI]; }
    const levOff=rLevI>=0?li*strides[rLevI]:0;
    const latStride=strides[rLatI], lonStride=strides[rLonI];
    const out=new Float32Array(nLat*nLon); let di=0;
    for(let ilat=0;ilat<nLat;ilat++)for(let ilon=0;ilon<nLon;ilon++){
      out[di++]=flat[baseOff+levOff+ilat*latStride+ilon*lonStride];
    }
    reader._sliceCache[cacheKey]=out;
    const nCached=Object.keys(reader._sliceCache).length;
    if(nCached>32){const drop=Object.keys(reader._sliceCache)[0];delete reader._sliceCache[drop];}
    return out;
  };
  reader.getAttribute=function(vn,an){
    try{const v=reader.variables.find(x=>x.name===vn);if(!v?.attributes)return null;
      const a=v.attributes.find(x=>x.name===an);return a?a.value:null;}catch(e){return null;}
  };
  return reader;
}

/* ============================================================ HDF5 ADAPTER */
function inferDimNames(shape, coordVars) {
  const PRIO=['time','t','time_counter','latitude','lat','y','nav_lat','longitude','lon','x','nav_lon','depth','lev','level'];
  const used=new Set();
  return shape.map(size=>{
    for(const p of PRIO){const c=coordVars.find(v=>v.name.toLowerCase()===p&&v.size===size&&!used.has(v.name));if(c){used.add(c.name);return c.name;}}
    const any=coordVars.find(v=>v.size===size&&!used.has(v.name));if(any){used.add(any.name);return any.name;}
    return 'dim'+size;
  });
}
class NC4Adapter {
  constructor(h5file,fname,FS){
    this._h=h5file;this._fname=fname;this._FS=FS;this.dimensions=[];this.variables=[];
    const keys=h5file.keys?h5file.keys():[];const coordVars=[];
    keys.forEach(k=>{try{const ds=h5file.get(k);if(!ds||ds.type!=='Dataset')return;
      if(ds.shape.length===1){coordVars.push({name:k,size:ds.shape[0]});this.dimensions.push({name:k,size:ds.shape[0]});}
    }catch(e){}});
    keys.forEach(k=>{try{const ds=h5file.get(k);if(!ds||ds.type!=='Dataset')return;
      this.variables.push({name:k,dimensions:inferDimNames(ds.shape,coordVars),size:ds.shape.reduce((a,b)=>a*b,1)});
    }catch(e){}});
  }
  getDataVariable(n){try{const v=this._h.get(n);return v?v.value:null;}catch(e){return null;}}
  // Read ONE time step via HDF5 hyperslab — avoids decoding the whole variable
  // (a 600MB multi-time file would otherwise be read in full on EVERY frame).
  //
  // Chunk-block cache: xarray/cfgrib-exported files (ERA5, CDS extracts —
  // both real-world files this was verified against) commonly chunk the
  // TIME axis in groups of 10-30+ steps per physical HDF5 chunk. h5wasm has
  // no cross-call cache underneath ds.slice() — every single-index hyperslab
  // request re-decompresses the WHOLE chunk from scratch, even for the very
  // next frame sitting in the same physical chunk. Measured on a synthetic
  // file with the same chunking shape as the attached datasets: every frame
  // cost the same ~38ms regardless of position in the chunk, proving zero
  // reuse — for a 91-frame/31-steps-per-chunk file that's ~30x more
  // decompression than necessary, which is what turned "load a wind
  // overlay" into "the tab hangs." Only safe to expand the read to the full
  // chunk when time is the OUTERMOST dimension (timeI===0), which is the
  // near-universal CF convention and true for both files this fixes — that
  // guarantees each time index's data is one contiguous block in the flat
  // result, so slicing a frame back out is a plain subarray, not a stride.
  getTimeSlice(n,tIdx,timeI,levIdx,levI){
    try{
      const ds=this._h.get(n); if(!ds||!ds.slice) return null;
      const lev=levI??-1;
      const chunks=ds.metadata&&ds.metadata.chunks;
      const chunkT=(timeI===0&&chunks)?chunks[timeI]:1;
      if(chunkT>1){
        const nT=ds.shape[timeI];
        const chunkIdx=Math.floor(tIdx/chunkT);
        const cacheKey=n+'|'+chunkIdx+'|'+(lev>=0?(levIdx??0):'');
        this._chunkCache=this._chunkCache||new Map();
        let blk=this._chunkCache.get(cacheKey);
        if(blk){this._chunkCache.delete(cacheKey);this._chunkCache.set(cacheKey,blk);}
        if(!blk){
          const t0=chunkIdx*chunkT, t1=Math.min(nT,t0+chunkT);
          const blkRanges=ds.shape.map((s,d)=>{
            if(d===timeI) return [t0,t1];
            if(lev>=0&&d===lev) return [levIdx??0,(levIdx??0)+1];
            return [0,s];
          });
          const raw=ds.slice(blkRanges);
          if(!raw) return null;
          const spatial=blkRanges.reduce((a,r,d)=>d===timeI?a:a*(r[1]-r[0]),1);
          blk={data:raw,t0,spatial};
          this._chunkCache.set(cacheKey,blk);
          // Bound memory to ~300MB resident — mirrors the frame-preload
          // cache budget used elsewhere in this app for the same reason.
          let total=0; for(const v of this._chunkCache.values()) total+=v.data.length*4;
          while(total>300e6&&this._chunkCache.size>1){
            const oldestKey=this._chunkCache.keys().next().value;
            total-=this._chunkCache.get(oldestKey).data.length*4;
            this._chunkCache.delete(oldestKey);
          }
        }
        const localT=tIdx-blk.t0;
        return blk.data.subarray(localT*blk.spatial,(localT+1)*blk.spatial);
      }
      const ranges=ds.shape.map((s,d)=>{
        if(d===timeI) return [tIdx,tIdx+1];
        if(lev>=0&&d===lev) return [levIdx??0,(levIdx??0)+1];
        return [0,s];
      });
      return ds.slice(ranges);
    }catch(e){return null;}
  }
  // Strided 2-D read for huge curvilinear lat/lon (e.g. RTOFS 3298×4500).
  // Returns a flat array of ceil(nRow/factor) × ceil(nCol/factor) values.
  getDecimated2D(n,nRow,nCol,factor){
    try{
      const ds=this._h.get(n); if(!ds||!ds.slice) return null;
      const step=Math.max(1,factor|0);
      return ds.slice([[0,nRow,step],[0,nCol,step]]);
    }catch(e){return null;}
  }
  getAttribute(vn,an){try{const ds=this._h.get(vn);if(!ds)return null;const attr=ds.attrs[an];if(!attr)return null;
    const v=attr.value;if(v==null)return null;if(ArrayBuffer.isView(v)||Array.isArray(v))return v.length===1?v[0]:v;return v;
  }catch(e){return null;}}
  close(){this._chunkCache=null;try{this._h.close();}catch(e){}try{if(this._FS)this._FS.unlink(this._fname);}catch(e){}}
}

/* ============================================================
   GRIB2Adapter — wraps window.GRIB2.parse() output in the same
   reader interface as NC4Adapter / netcdfjs so all downstream
   code (discoverGrid, extractSlice, buildFrames, hover, region
   export) works unchanged on GRIB2 files.
   ============================================================ */
class GRIB2Adapter {
  constructor(messages, fname){
    this._fname=fname;
    const groups={};
    messages.forEach(m=>{
      if(m.error||!m.grid||!m.data) return;
      const pdt=m.pdt||{};
      const key=m.discipline+'_'+(pdt.paramCat||0)+'_'+(pdt.paramNum||0)+'_'+(pdt.typeOfLevel||0);
      if(!groups[key]) groups[key]={msgs:[],name:this._varName(m.discipline,pdt,pdt.typeOfLevel)};
      groups[key].msgs.push(m);
    });
    Object.values(groups).forEach(grp=>grp.msgs.sort((a,b)=>(a.pdt?.levelValue||0)-(b.pdt?.levelValue||0)));
    this._groups=groups;
    const first=messages.find(m=>!m.error&&m.grid);
    this._grd=first?first.grid:null;
    const g=this._grd, Ny=g?g.Ny:0, Nx=g?g.Nx:0;
    this.dimensions=[{name:'time',size:1},{name:'lat',size:Ny},{name:'lon',size:Nx}];
    this.variables=Object.entries(groups).map(([key,grp])=>{
      const nT=grp.msgs.length;
      const _glt=(grp.msgs[0]?.pdt?.typeOfLevel)||0;
      const _lvls=_gribUniqueLevels(grp.msgs,_glt);
      return {name:grp.name,dimensions:['time','lat','lon'],size:nT*Ny*Nx,_levels:_lvls,_levUnits:(_glt===100?'hPa':''),
        attributes:[{name:'units',value:this._units(grp.msgs[0])},{name:'long_name',value:this._longName((grp.msgs[0]||{}).discipline||0,(grp.msgs[0]||{}).pdt||{})}],
        _key:key,_nT:nT};
    });
    if(g){
      this.variables.push({name:'lat',dimensions:['lat'],size:Ny,_coord:'lat',attributes:[{name:'units',value:'degrees_north'}]});
      this.variables.push({name:'lon',dimensions:['lon'],size:Nx,_coord:'lon',attributes:[{name:'units',value:'degrees_east'}]});
      const times=messages.filter(m=>!m.error&&m.refTime).map(m=>{const rt=m.refTime;return Date.UTC(rt.year,rt.month-1,rt.day,rt.hour,rt.minute,rt.second||0)/3600000;});
      const uniqTimes=[...new Set(times)].sort((a,b)=>a-b);
      this._times=new Float64Array(uniqTimes.length?uniqTimes:[0]);
      this.variables.push({name:'time',dimensions:['time'],size:this._times.length,_coord:'time',attributes:[{name:'units',value:'hours since 1970-01-01'}]});
      this.dimensions[0].size=this._times.length;
    }
  }
  static _GP={'0_0_0':['tmp','Temperature'],'0_0_2':['ptmp','Potential Temperature'],'0_0_4':['tmax','Max Temperature'],'0_0_5':['tmin','Min Temperature'],'0_0_6':['dpt','Dew Point'],'0_0_10':['lhtfl','Latent Heat Net Flux'],'0_0_11':['shtfl','Sensible Heat Net Flux'],'0_1_0':['spfh','Specific Humidity'],'0_1_1':['rh','Relative Humidity'],'0_1_3':['pwat','Precipitable Water'],'0_1_7':['prate','Precipitation Rate'],'0_1_8':['apcp','Total Precipitation'],'0_1_11':['snod','Snow Depth'],'0_1_42':['snowc','Snow Cover'],'0_1_193':['tprate','Total Precipitation Rate'],'0_2_1':['wspd','Wind Speed'],'0_2_2':['ugrd','U-component of Wind'],'0_2_3':['vgrd','V-component of Wind'],'0_2_8':['vvel','Vertical Velocity'],'0_2_17':['uflx','Momentum Flux U'],'0_2_18':['vflx','Momentum Flux V'],'0_3_0':['pres','Pressure'],'0_3_1':['mslp','MSLP'],'0_3_5':['hgt','Geopotential Height'],'0_4_192':['dswrf','Downward SW Radiation'],'0_4_193':['uswrf','Upward SW Radiation'],'0_5_192':['dlwrf','Downward LW Radiation'],'0_5_193':['ulwrf','Upward LW Radiation'],'0_6_0':['cbase','Cloud Base'],'0_6_1':['tcc','Total Cloud Cover'],'0_6_3':['lcc','Low Cloud Cover'],'0_6_4':['mcc','Medium Cloud Cover'],'0_6_5':['hcc','High Cloud Cover'],'0_7_0':['cape','CAPE'],'0_7_1':['cin','CIN'],'0_7_6':['bli','Best Lifted Index'],'0_7_192':['lftx','Lifted Index'],'0_13_192':['pmtc','Particulate Matter (Coarse)'],'0_13_193':['pmtf','Particulate Matter (Fine)'],'0_14_0':['tozne','Total Ozone'],'0_19_1':['albedo','Albedo'],'0_20_0':['chmcdn','Aerosol Mass Density'],'0_20_1':['colmd','Column-Integrated Mass Density'],'0_20_2':['mxmr','Aerosol Mass Mixing Ratio'],'0_20_4':['adens','Aerosol Number Density'],'0_20_100':['aotk','Aerosol Optical Thickness'],'0_20_101':['eatk','Aerosol Extinction Coefficient'],'0_20_102':['aotk055','AOT at 0.55 µm'],'0_20_103':['ssalb','Single Scattering Albedo'],'0_20_104':['asysf','Asymmetry Factor'],'0_20_112':['sctaot','Scattering AOT'],'2_0_0':['land','Land Cover'],'2_0_2':['tsoil','Soil Temperature'],'2_0_192':['soilw','Volumetric Soil Moisture'],'2_0_193':['gflux','Ground Heat Flux'],
    // Discipline 10 (Oceanographic), verified against WMO GRIB2 Table 4.2-10-x.
    // Category 0 = Waves. Category 1 = Currents. Category 2 = Ice.
    // Category 3 = Surface properties. Category 4 = Sub-surface properties.
    // NOTE: an earlier version of this table had 10_0_3 (HTSGW, wave height)
    // mislabeled as Sea Surface Temperature, and 10_1_0 (current direction)
    // mislabeled as wave height — both are fixed below. Real SST is 10_3_0
    // (WTMP, water temperature) per the spec.
    '10_0_0':['wvsp1','Wave Spectra (1)'],'10_0_1':['wvsp2','Wave Spectra (2)'],'10_0_2':['wvsp3','Wave Spectra (3)'],
    '10_0_3':['htsgw','Significant Height of Combined Wind Waves and Swell'],'10_0_4':['wvdir','Direction of Wind Waves'],
    '10_0_5':['wvhgt','Significant Height of Wind Waves'],'10_0_6':['wvper','Mean Period of Wind Waves'],
    '10_0_7':['swdir','Direction of Swell Waves'],'10_0_8':['swell','Significant Height of Swell Waves'],
    '10_0_9':['swper','Mean Period of Swell Waves'],'10_0_10':['dirpw','Primary Wave Direction'],
    '10_0_11':['perpw','Primary Wave Mean Period'],'10_0_12':['dirsw','Secondary Wave Direction'],
    '10_0_13':['persw','Secondary Wave Mean Period'],'10_0_14':['wwsdir','Direction of Combined Wind Waves and Swell'],
    '10_0_15':['mwsper','Mean Period of Combined Wind Waves and Swell'],'10_0_34':['wstp','Peak Wave Period'],
    '10_1_0':['dircu','Current Direction'],'10_1_1':['spcu','Current Speed'],
    '10_1_2':['ucur','U-component of Current'],'10_1_3':['vcur','V-component of Current'],
    '10_2_0':['icec','Ice Cover'],'10_2_1':['icetk','Ice Thickness'],'10_2_2':['diced','Direction of Ice Drift'],
    '10_2_3':['siced','Speed of Ice Drift'],'10_2_4':['uice','U-component of Ice Drift'],'10_2_5':['vice','V-component of Ice Drift'],
    '10_2_6':['iceg','Ice Growth Rate'],'10_2_7':['icedv','Ice Divergence'],
    '10_3_0':['wtmp','Water Temperature'],'10_3_1':['dslm','Deviation of Sea Level from Mean'],
    '10_4_0':['wtmpss','Sub-surface Water Temperature'],'10_4_1':['salin','Salinity'],
    '10_4_2':['wdens','Water Density'],'10_4_6':['wvelz','Geometric Vertical Velocity'],
    '10_0_25':['invmwf','Inverse Mean Wave Frequency'],
    // Well-documented NCEP local-table additions (identical across GFS/NAM/HRRR/AQM).
    '0_1_192':['crain','Categorical Rain'],'0_1_193':['cfrzr','Categorical Freezing Rain'],
    '0_1_194':['cicep','Categorical Ice Pellets'],'0_1_195':['csnow','Categorical Snow'],
    '0_2_0':['wdir','Wind Direction'],
    '0_2_9':['dzdt','Vertical Velocity (Geometric)'],'0_2_10':['absv','Absolute Vorticity'],
    '0_2_12':['relv','Relative Vorticity'],'0_2_13':['reld','Relative Divergence'],
    '0_2_22':['gust','Wind Speed (Gust)'],'0_6_13':['ceil','Ceiling'],
    '0_19_0':['vis','Visibility'],'0_7_7':['shwinx','Showalter Index'],
    // WMO-standard radiation flux codes — distinct from the NCEP-local
    // 192/193 codes above (same physical quantities, different table).
    '0_5_3':['ulwrf','Upward Long-Wave Radiation Flux'],'0_5_4':['dlwrf','Downward Long-Wave Radiation Flux'],
    '0_4_7':['dswrf','Downward Short-Wave Radiation Flux'],'0_4_8':['uswrf','Upward Short-Wave Radiation Flux']};
  // WMO Table 4.2 category names, keyed 'discipline_category' — used as a
  // fallback label for any param not in _GP above so unmapped fields show
  // something legible ("Moisture (param 197) @ ...") instead of a bare
  // "d0_c1_p197" code. Far more numerous than the params we can name
  // precisely (NCEP alone has hundreds of local-table codes across its
  // operational models), so this is deliberately honest about not knowing
  // the exact parameter rather than guessing and risking another
  // HTSGW/SST-style mislabel.
  static _CATNAME={
    '0_0':'Temperature','0_1':'Moisture','0_2':'Momentum','0_3':'Mass','0_4':'Short-wave Radiation',
    '0_5':'Long-wave Radiation','0_6':'Cloud','0_7':'Thermodynamic Stability','0_13':'Aerosols',
    '0_14':'Trace Gases','0_15':'Radar','0_16':'Forecast Radar Imagery','0_17':'Electrodynamics',
    '0_18':'Nuclear/Radiology','0_19':'Physical Atmospheric Properties',
    '0_20':'Atmospheric Chemical Constituents','0_191':'Miscellaneous','0_192':'Covariance',
    '1_0':'Hydrology Basic Products','1_1':'Hydrology Probabilistic Products',
    '1_2':'Inland Water/Sediment Properties',
    '2_0':'Vegetation/Biomass','2_1':'Agricultural/Aquacultural Products',
    '2_2':'Transportation-related Products','2_3':'Soil Products','2_4':'Fire Weather Products',
    '3_192':'Simulated Satellite Imagery',
    '10_0':'Waves','10_1':'Currents','10_2':'Ice','10_3':'Surface Properties',
    '10_4':'Sub-surface Properties'};
  _varName(discipline,pdt,levelType){
    const k=discipline+'_'+(pdt.paramCat||0)+'_'+(pdt.paramNum||0);
    const gp=GRIB2Adapter._GP[k];
    const _lvl=levelType??pdt.typeOfLevel??0;
    const _sfx={1:'_sfc',10:'_atm',100:'_isobar',103:'_hag',105:'_hyb',200:'_atm',7:'_trop',8:'_toa'}[_lvl]||(_lvl?'_L'+_lvl:'');
    if(gp)return gp[0]+_sfx;
    const _dn=['met','hyd','lnd','','','','','','','','ocn'][discipline]||'d'+discipline;
    return _dn+'_c'+(pdt.paramCat||0)+'_p'+(pdt.paramNum||0)+_sfx;
  }
  _longName(discipline,pdt){
    const k=discipline+'_'+(pdt.paramCat||0)+'_'+(pdt.paramNum||0);
    const gp=GRIB2Adapter._GP[k];
    const _lvl=pdt.typeOfLevel??0;
    const _ld={1:'Surface',10:'Entire atmosphere',100:'Isobaric',103:'Height above ground',105:'Hybrid level',200:'Entire atmosphere'}[_lvl];
    let _ls;
    if(gp) _ls=gp[1];
    else{
      const catName=GRIB2Adapter._CATNAME[discipline+'_'+(pdt.paramCat||0)];
      // Not in the exact-name table (NCEP alone has hundreds of local
      // codes) — fall back to the WMO category name plus the raw param
      // number, e.g. "Moisture (param 197)", rather than a bare numeric
      // code or (worse) a guessed name that might be wrong.
      _ls=catName?(catName+' (param '+(pdt.paramNum||0)+')'):('Disc '+discipline+' Cat '+(pdt.paramCat||0)+' Param '+(pdt.paramNum||0));
    }
    return _ld?(_ls+' @ '+_ld):_ls;
  }
  _units(msg){
    const k=msg.discipline+'_'+((msg.pdt||{}).paramCat||0)+'_'+((msg.pdt||{}).paramNum||0);
    return({'0_0_0':'K','0_1_1':'%','0_2_1':'m/s','0_2_2':'m/s','0_2_3':'m/s',
      '0_3_0':'Pa','0_2_31':'m/s','0_2_32':'m/s',
      // Momentum additions (kept in sync with _GP above) — note param 10
      // is Absolute Vorticity (/s), not Wind Speed (that's param 1, m/s).
      '0_2_0':'deg','0_2_9':'m/s','0_2_10':'/s','0_2_12':'/s','0_2_13':'/s','0_2_22':'m/s','0_6_13':'m',
      '0_19_0':'m','0_7_7':'K','0_5_3':'W/m2','0_5_4':'W/m2','0_4_7':'W/m2','0_4_8':'W/m2',
      '10_0_25':'s',
      // Discipline 10 (Oceanographic) — kept in sync with _GP above.
      '10_0_3':'m','10_0_4':'deg','10_0_5':'m','10_0_6':'s','10_0_7':'deg','10_0_8':'m','10_0_9':'s',
      '10_0_10':'deg','10_0_11':'s','10_0_12':'deg','10_0_13':'s','10_0_14':'deg','10_0_15':'s','10_0_34':'s',
      '10_1_0':'deg','10_1_1':'m/s','10_1_2':'m/s','10_1_3':'m/s',
      '10_2_0':'proportion','10_2_1':'m','10_2_2':'deg','10_2_3':'m/s','10_2_4':'m/s','10_2_5':'m/s','10_2_6':'m/s',
      '10_3_0':'K','10_3_1':'m','10_4_0':'K','10_4_1':'kg/kg','10_4_2':'kg/m3','10_4_6':'m/s'})[k]||'';
  }
  get grid(){ return this._grd; }
  getAttribute(varName,attrName){
    const v=this.variables.find(x=>x.name===varName);if(!v)return null;
    const a=v.attributes&&v.attributes.find(x=>x.name===attrName);return a?a.value:null;
  }
  getDataVariable(varName){
    const v=this.variables.find(x=>x.name===varName);if(!v)return null;
    if(v._coord==='lat')return this._grd?this._grd.lats:null;
    if(v._coord==='lon')return this._grd?this._grd.lons:null;
    if(v._coord==='time')return this._times;
    const grp=this._groups[v._key];if(!grp)return null;
    const {Ny,Nx}=this._grd,nT=v._nT,N=Ny*Nx;
    const out=new Float32Array(nT*N);
    grp.msgs.forEach((m,ti)=>out.set(m.data.slice(0,N),ti*N));
    return out;
  }
  getTimeSlice(varName,tIdx,timeI,levIdx,levI){
    const v=this.variables.find(x=>x.name===varName);if(!v)return null;
    const grp=this._groups[v._key];if(!grp)return null;
    const msgs=grp.msgs;
    const li=levIdx??0;
    if(v._levels&&msgs.length>1){
      const uTimes=_gribUniqueTimeKeys(msgs);
      if(uTimes.length>1){
        const tk=uTimes[Math.min(Math.max(0,tIdx|0),uTimes.length-1)];
        const atT=msgs.filter(m=>_gribMsgTimeKey(m)===tk)
          .sort((a,b)=>(a.pdt?.levelValue||0)-(b.pdt?.levelValue||0));
        return atT[Math.min(Math.max(0,li),atT.length-1)]?.data??null;
      }
      const sorted=[...msgs].sort((a,b)=>(a.pdt?.levelValue||0)-(b.pdt?.levelValue||0));
      return sorted[Math.min(Math.max(0,li),sorted.length-1)]?.data??null;
    }
    return msgs[Math.min(Math.max(0,tIdx|0),msgs.length-1)]?.data??null;
  }
  close(){}
}

// openGRIB2: decodes in a Web Worker so J2K never blocks the main thread.
// Falls back to main-thread batched decode (batch=1, yields between messages).
function _buildGRIB2Worker(){
  try{
    // The jpx_bundle and grib2 script tags have data-id attributes set during build
    const jpxEl=document.querySelector('script[data-grib="jpx"]');
    const g2El =document.querySelector('script[data-grib="core"]');
    if(!jpxEl||!g2El) return null;
    const fix=s=>s.replace(/window\.GRIB2/g,'self.GRIB2')
                   .replace(/window\.JpxImage/g,'self.JpxImage')
                   .replace(/typeof window!=='undefined'\?window:this/g,'self');
    const src=fix(jpxEl.textContent)+'\n'+fix(g2El.textContent)+`
self.onmessage=function(e){
  const {buf,offsets}=e.data;
  for(let i=0;i<offsets.length;i++){
    const {off,len}=offsets[i];
    try{
      const slice=buf.subarray(off,off+len);
      const msg=self.GRIB2.parseOne(slice);
      const tr=msg.data?[msg.data.buffer]:[];
      self.postMessage({type:'msg',idx:i,total:offsets.length,msg},tr);
    }catch(err){
      self.postMessage({type:'msg',idx:i,total:offsets.length,msg:{error:err.message}});
    }
  }
  self.postMessage({type:'done'});
};`;
    return new Worker(URL.createObjectURL(new Blob([src],{type:'application/javascript'})));
  }catch(e){ return null; }
}
function openGRIB2(ab, fname, opts){
  return new Promise((resolve,reject)=>{
    const buf=ab instanceof Uint8Array?ab:new Uint8Array(ab);
    // Fast offset scan (main thread, <1ms)
    const offsets=[];
    for(let i=0;i<buf.length-4;i++){
      if(buf[i]===0x47&&buf[i+1]===0x52&&buf[i+2]===0x49&&buf[i+3]===0x42&&buf[i+7]===2){
        const hi=(buf[i+8]<<24|buf[i+9]<<16|buf[i+10]<<8|buf[i+11])>>>0;
        const lo=(buf[i+12]<<24|buf[i+13]<<16|buf[i+14]<<8|buf[i+15])>>>0;
        const len=hi*4294967296+lo;
        offsets.push({off:i,len});
        i+=Math.max(16,len-1);
      }
    }
    if(!offsets.length) return reject(new Error('No GRIB2 messages found in file'));
    const total=offsets.length;
    const msgs=new Array(total).fill(null);
    let received=0;
    const onProgress=opts?.onProgress;
    const finish=()=>{
      const good=msgs.filter(m=>m&&!m.error&&m.grid&&m.data);
      const errs=msgs.filter(m=>m?.error).map(m=>m.error);
      const unsupported=msgs.filter(m=>m&&!m.error&&(!m.grid||!m.data));
      if(!good.length){
        const gdtNums=[...new Set(msgs.filter(m=>m&&!m.error).map(m=>m._gdtNum||'?'))];
        return reject(new Error(
          'No valid GRIB2 messages decoded.\n'+
          (errs.length?'Errors: '+errs.slice(0,3).join('; ')+'\n':'')+
          (unsupported.length?unsupported.length+' messages had no grid/data (GDT: '+gdtNums.join(',')+')':'')
        ));
      }
      resolve(new GRIB2Adapter(msgs,fname));
    };
    const worker=_buildGRIB2Worker();
    if(worker){
      worker.onmessage=function(e){
        const d=e.data;
        if(d.type==='msg'){
          msgs[d.idx]=d.msg;
          received++;
          if(onProgress) onProgress(received,total);
          if(received===total){worker.terminate();finish();}
        }
      };
      worker.onerror=function(err){
        console.warn('[GRIB2 Worker error, falling back to main thread]',err.message);
        worker.terminate();
        _openGRIB2Sync(buf,offsets,fname,msgs,onProgress,finish);
      };
      // Transfer a copy so we keep the original buffer accessible
      const _wbuf=new Uint8Array(buf.slice(0));worker.onerror=function(err){console.warn('[GRIB2 worker error]',err.message);worker.terminate();_openGRIB2Sync(_wbuf,offsets,fname,msgs,onProgress,finish);};worker.postMessage({buf,offsets},[buf.buffer]);
    } else {
      _openGRIB2Sync(buf,offsets,fname,msgs,onProgress,finish);
    }
  });
}
function _openGRIB2Sync(buf,offsets,fname,msgs,onProgress,finish){
  if(!window.GRIB2){finish();return;}
  const CHUNK=10;let idx=0;
  (function next(){
    const end=Math.min(idx+CHUNK,offsets.length);
    for(;idx<end;idx++){const{off,len}=offsets[idx];try{msgs[idx]=window.GRIB2.parseOne(buf.subarray(off,off+len));}catch(e){msgs[idx]={error:e.message};}if(onProgress)onProgress(idx+1,offsets.length);}
    if(idx<offsets.length)requestAnimationFrame(next);else finish();
  })();
}

async function openHDF5(buf,filename){
  const hw=window.h5wasm;
  if(!hw) throw new Error('h5wasm not available — HDF5/NetCDF-4 needs a network connection on first use.');
  // In modern h5wasm, the filesystem (FS) lives on the object returned by ready(),
  // not on the module itself. Capture it and stash for later cleanup.
  const mod = await hw.ready;
  const FS = (mod && mod.FS) || hw.FS;
  const fname='/tmp/'+filename.replace(/[^a-zA-Z0-9._-]/g,'_');
  FS.writeFile(fname,new Uint8Array(buf));
  return new NC4Adapter(new hw.File(fname,'r'),fname,FS);
}

/* ============================================================ GRID DISCOVERY */
/* Universal attribute reader — works whether the parser exposes attributes via
   getAttribute() (older netcdfjs / HDF5 adapter) or only via variable.attributes[]
   (newer netcdfjs). Returns the attribute value or null. */
function getAttr(reader, varName, attrName){
  // 1. Try the parser's own getAttribute if it returns something useful
  try {
    const v = reader.getAttribute ? reader.getAttribute(varName, attrName) : null;
    if (v != null) return v;
  } catch(e) {}
  // 2. Fall back to scanning the variable's attributes array
  try {
    const variable = reader.variables.find(x => x.name === varName);
    if (variable && variable.attributes) {
      const a = variable.attributes.find(x => x.name === attrName);
      if (a) return a.value;
    }
  } catch(e) {}
  return null;
}

/* Flatten h5wasm / nested JS arrays into a typed buffer for slice extraction. */
function toFlatArray(raw, shape){
  if(raw==null) return null;
  // BigInt typed arrays must be converted element-by-element to Float32
  if(raw instanceof BigInt64Array||raw instanceof BigUint64Array){
    const out=new Float32Array(raw.length);
    for(let i=0;i<raw.length;i++) out[i]=Number(raw[i]);
    return out;
  }
  if(ArrayBuffer.isView(raw)) return raw;
  const size=shape?shape.reduce((a,b)=>a*b,1):0;
  const out=new Float32Array(size||65536);
  let i=0;
  (function walk(a){
    if(i>=out.length) return;
    // BigInt typed array nested inside array structure
    if(a instanceof BigInt64Array||a instanceof BigUint64Array){
      for(let k=0;k<a.length&&i<out.length;k++) out[i++]=Number(a[k]);
      return;
    }
    if(ArrayBuffer.isView(a)){ out.set(a,i); i+=a.length; return; }
    if(Array.isArray(a)){ for(const x of a) walk(x); return; }
    out[i++]=typeof a==='bigint'?Number(a):+a;
  })(raw);
  return size?out.subarray(0,size):out.subarray(0,i);
}
function coordValues(reader, name){
  const raw=reader.getDataVariable(name);
  if(raw==null) return [];
  // BigInt typed arrays (BigInt64Array / BigUint64Array) must be converted explicitly
  if(raw instanceof BigInt64Array||raw instanceof BigUint64Array){
    return Array.from(raw, v=>Number(v));
  }
  if(ArrayBuffer.isView(raw)) return Array.from(raw);
  if(Array.isArray(raw)) return raw.flat(Infinity).map(v=>typeof v==='bigint'?Number(v):+v);
  return Array.from(raw, v=>typeof v==='bigint'?Number(v):+v);
}
function pickSurfaceLevIndex(levels, units){
  if(!levels||!levels.length) return 0;
  const u=(units||'').toLowerCase();
  if(/hpa|pascal|millibar|mb|bar/.test(u)){
    let best=0,bestV=-Infinity;
    for(let i=0;i<levels.length;i++){ const v=+levels[i]; if(v>bestV){ bestV=v; best=i; } }
    return best;
  }
  if(/m above|height|altitude|geopotential/.test(u)) return 0;
  return 0;
}

// Row-wise lon unwrap: prevents antimeridian jumps (HYCOM/RTOFS tripolar) from
// collapsing the decimated 2-D lon texture into stripes on the globe.
function normalizeLon(lon){
  if(!Number.isFinite(lon)) return lon;
  let L=((lon%360)+360)%360; if(L>180) L-=360; return L;
}
function unwrapCurvilinearLons(lons,nRow,nCol){
  const out=new Float32Array(lons.length);
  for(let r=0;r<nRow;r++){
    const base=r*nCol; let acc=Number(lons[base]); out[base]=normalizeLon(acc);
    for(let c=1;c<nCol;c++){
      let L=Number(lons[base+c]);
      while(L-acc>180) L-=360; while(L-acc<-180) L+=360;
      acc=L; out[base+c]=normalizeLon(L);
    }
  }
  return out;
}
// Lazily read + decimate 2-D curvilinear lat/lon coordinates; cached per factor.
function loadDecimatedCoords(reader,latV,lonV,nRow,nCol,factor){
  const cacheKey=latV+'|'+lonV+'|'+factor;
  reader._coordDecCache=reader._coordDecCache||{};
  if(reader._coordDecCache[cacheKey]) return reader._coordDecCache[cacheKey];
  const rRow=Math.ceil(nRow/factor), rCol=Math.ceil(nCol/factor);
  let lats=null, lons=null;
  if(reader.getDecimated2D){
    const rl=reader.getDecimated2D(latV,nRow,nCol,factor);
    const rn=reader.getDecimated2D(lonV,nRow,nCol,factor);
    if(rl&&rn){
      const fL=toFlatArray(rl,[rRow,rCol]), fN=toFlatArray(rn,[rRow,rCol]);
      if(fL&&fN){
        lats=new Float32Array(rRow*rCol); lons=new Float32Array(rRow*rCol);
        for(let k=0;k<lats.length;k++){lats[k]=fL[k]; lons[k]=fN[k];}
      }
    }
  }
  if(!lats||!lons){
    // Read the full 2D coordinate arrays then stride-sample every factor-th row/col.
    // toFlatArray called with full [nRow,nCol] returns the raw TypedArray as-is
    // (zero-copy) for NC3, or flattens a nested HDF5 array into one buffer.
    const rawLat=reader.getDataVariable(latV);
    const rawLon=reader.getDataVariable(lonV);
    if(!rawLat||!rawLon) return null;
    const fL=toFlatArray(rawLat,[nRow,nCol]);
    const fN=toFlatArray(rawLon,[nRow,nCol]);
    if(!fL||!fN) return null;
    lats=new Float32Array(rRow*rCol); lons=new Float32Array(rRow*rCol);
    for(let r=0;r<rRow;r++){
      const sr=Math.min(r*factor,nRow-1);
      for(let c=0;c<rCol;c++){
        const k=r*rCol+c;
        lats[k]=fL[sr*nCol+Math.min(c*factor,nCol-1)];
        lons[k]=fN[sr*nCol+Math.min(c*factor,nCol-1)];
      }
    }
  }
  const unwrapped=unwrapCurvilinearLons(lons,rRow,rCol);
  const out={lats,lons:unwrapped,nLat:rRow,nLon:rCol};
  reader._coordDecCache[cacheKey]=out;
  return out;
}

// Y/X/i/j-style grid-index dimensions must never be mistaken for lat/lon
// coordinates or vertical levels — they're plain array indices, not degrees
// or pressure. RTOFS/HYCOM curvilinear files declare their real geographic
// coordinates as separate 2-D "Latitude"/"Longitude" variables.
const GRID_INDEX_DIM_NAMES=new Set([
  'x','y','i','j','ii','jj','ni','nj','nx','ny','nxx','nyy','xc','yc','xg','yg',
  'xlon','ylat','rlon','rlat','npts','ncells','node','nodes','element','nvertex'
]);

function discoverGrid(reader){
  // Compatibility: some netcdfjs versions return variable.dimensions as numeric
  // indices into reader.dimensions rather than name strings. Normalize to names
  // once, here, so all downstream code can treat dimensions as string arrays.
  const _dimNamesByIndex = reader.dimensions.map(d => d.name);
  reader.variables.forEach(v => {
    if (v.dimensions && v.dimensions.length && typeof v.dimensions[0] === 'number') {
      v.dimensions = v.dimensions.map(i => _dimNamesByIndex[i]);
    }
  });
  const dimMap={};reader.dimensions.forEach(d=>dimMap[d.name]=d.size);
  const LAT=new Set(['latitude','lat','nav_lat','rlat','ylat','yc','yg']);
  const LON=new Set(['longitude','lon','nav_lon','rlon','xlon','xc','xg']);
  const TIME=new Set(['time','t','time_counter','valid_time','forecast_time','time_bounds','time1','reftime','mt']);
  const LEVEL=new Set(['depth','lev','level','plev','pressure','pressure_level','height','height_above_ground','height_above_ground1','hybrid','isobaric','isobaric1','isobaricinhpa','isobaricInhPa','isobaricinhPa','z','sigma','nlevels','depth_below_surface_layer','depth_below_surface_layer1','depthu','depthv','deptht','depth_0']);
  const SKIP=new Set(['depth','lev','level','plev','pressure','pressure_level','bnds','nbnds','bounds_lat','bounds_lon','lat_bnds','lon_bnds','time_bnds','height_above_ground','height_above_ground1','depth_below_surface_layer','depth_below_surface_layer1','hybrid','reftime','time_bounds','time1','isobaric','isobaric1','isobaricinhpa','isobaricInhPa','isobaricinhPa','depthu','depthv','deptht','depth_0','x','y']);
  let latV=null,lonV=null,timeV=null,levV=null;
  // Pass 1 — explicit geographic coordinate names (avoid Y/X grid indices).
  reader.variables.forEach(v=>{const n=v.name.toLowerCase();
    if(!latV&&LAT.has(n))latV=v.name;if(!lonV&&LON.has(n))lonV=v.name;if(!timeV&&TIME.has(n))timeV=v.name;if(!levV&&LEVEL.has(n))levV=v.name;});
  // Pass 2 — 2-D arrays whose standard_name is latitude/longitude (RTOFS-class).
  if(!latV||!lonV){reader.variables.forEach(v=>{
    if((v.dimensions||[]).length!==2) return;
    const sn=(getAttr(reader,v.name,'standard_name')||'').toLowerCase();
    if(!latV&&sn==='latitude') latV=v.name;
    if(!lonV&&sn==='longitude') lonV=v.name;
  });}
  if(!levV){for(const d of(reader.dimensions||[])){const nl=d.name.toLowerCase();
    if(GRID_INDEX_DIM_NAMES.has(nl)) continue;
    if(LEVEL.has(nl)||nl.startsWith('depth')||nl.startsWith('isobar')||nl.startsWith('lev')||nl==='z'||nl==='nz'){levV=d.name;break;}}}
  if(!latV||!lonV){reader.variables.forEach(v=>{if(v.dimensions.length!==1)return;
    if(GRID_INDEX_DIM_NAMES.has(v.name.toLowerCase()))return;
    const vals=coordValues(reader,v.name); if(!vals.length) return;
    const mn=Math.min(...vals),mx=Math.max(...vals);
    if(!latV&&mn>=-90&&mx<=90&&vals.length>=2)latV=v.name;
    if(!lonV&&mn>=-180&&mx<=360&&vals.length>=2)lonV=v.name;});}
  const coordSet=new Set([latV,lonV,timeV,levV].filter(Boolean));
  let dataVars=reader.variables.filter(v=>{
    const n=v.name.toLowerCase();
    if(coordSet.has(v.name)) return false;
    if(SKIP.has(n)||n.endsWith('_bnds')||n.endsWith('_bounds')||n.includes('bounds')) return false;
    return v.dimensions.length>=2;
  });
  const PREF=['sst','sea_surface','anom','air','tmean','t2m','temperature','temp','precip','u10','v10','wind'];
  dataVars.sort((a,b)=>{
    const ai=PREF.findIndex(p=>a.name.toLowerCase().includes(p));
    const bi=PREF.findIndex(p=>b.name.toLowerCase().includes(p));
    return (ai<0?99:ai)-(bi<0?99:bi);
  });
  let lats=null, lons=null, curvGrid=null;
  if(latV&&lonV){
    const latVar=reader.variables.find(v=>v.name===latV);
    const lat2D=(latVar?.dimensions||[]).length>1;
    if(lat2D){
      const nRow=dimMap[String(latVar.dimensions[0])]||0;
      const nCol=dimMap[String(latVar.dimensions[1])]||0;
      if(nRow>0&&nCol>0) curvGrid={nRow,nCol};
    }
    if(!curvGrid){
      lats=coordValues(reader,latV);
      lons=coordValues(reader,lonV);
    }
  }

  let times = null, timeUnits = '';
  if (timeV) {
    times = coordValues(reader, timeV);
    // Try standard 'units' attr first, then GRIB2 conventions
    timeUnits = getAttr(reader, timeV, 'units') ||
                getAttr(reader, timeV, 'GRIB_units') || '';
    // ERA5 valid_time has no 'units' but stores Unix epoch seconds
    // Detect by checking if values look like Unix timestamps (>1e9)
    if (!timeUnits && times && times.length > 0 && Number(times[0]) > 1e9) {
      timeUnits = 'seconds since 1970-01-01';
    }
  }

  let levels=null,levUnits='';
  if(levV){
    levels=coordValues(reader,levV);
    levUnits=getAttr(reader,levV,'units')||'';
    if(!levels||!levels.length){const dimDef=(reader.dimensions||[]).find(d=>d.name===levV);if(dimDef&&dimDef.size>1){levels=Array.from({length:dimDef.size},(_,i)=>i);levUnits='';}}}

  // Fix unlimited dimensions using coordinate variable lengths
  // For projected grids (2D lat/lon arrays), use Nx/Ny not the flat array length
  const _grd = reader.grid;
  if(_grd && _grd.proj && _grd.proj!=='latlon'){
    if(latV) dimMap[latV]=_grd.Ny;
    if(lonV) dimMap[lonV]=_grd.Nx;
  } else {
    if(curvGrid){
      if(latV) dimMap[latV]=curvGrid.nRow;
      if(lonV) dimMap[lonV]=curvGrid.nCol;
    } else {
      if (latV && lats?.length) dimMap[latV] = lats.length;
      if (lonV && lons?.length) dimMap[lonV] = lons.length;
    }
  }
  if (timeV && times?.length) dimMap[timeV] = times.length;
  if (levV && levels?.length) dimMap[levV] = levels.length;

  const defaultLevI = pickSurfaceLevIndex(levels, levUnits);
  const proj=curvGrid?'curvilinear':((reader.grid&&reader.grid.proj)||'latlon');
  return {latV,lonV,timeV,levV,lats,lons,times,timeUnits,levels,levUnits,defaultLevI,dataVars,dimMap,proj,curvGrid};
}

/* ============================================================ FRAMES
   A frame = one renderable time-step. It points to:
     reader  — the open NC reader that owns it
     grid    — that reader's grid metadata
     varName — which variable to render
     localT  — time index within that reader's variable
     sortKey — numeric value for chronological sorting
     label   — human-readable date string
*/
/* ── Time unit parsing ──────────────────────────────────────────────────────
   sortKey = days since Unix epoch (1970-01-01), used by nearestFrame.
   Handles: "seconds since …", "hours since …", "days since …",
            "minutes since …", and raw step numbers as fallback.
   Epoch strings tolerate trailing UTC / timezone / fractional seconds.
   ─────────────────────────────────────────────────────────────────────── */
function parseEpochDays(units) {
  /* Returns a function: rawValue → days since 1970-01-01  (or null on fail) */
  if (!units) return null;
  const m = units.match(/^(\w+)\s+since\s+(.+)/i);
  if (!m) return null;
  // Strip trailing timezone words that confuse new Date() in some environments
  const epochStr = m[2].trim()
    .replace(/\s*UTC$/i, '')
    .replace(/\s*\+00:?00$/i, '')
    .replace(/\.0+(\s|$)/, '$1')   // drop fractional seconds ".0"
    .trim();
  const origin = new Date(epochStr);
  if (isNaN(origin)) return null;
  const originDays = origin.getTime() / 86400000;
  const u = m[1].toLowerCase();
  let toDays;
  if      (u.startsWith('sec'))  toDays = v => v / 86400;
  else if (u.startsWith('min'))  toDays = v => v / 1440;
  else if (u.startsWith('hour')) toDays = v => v / 24;
  else                           toDays = v => v;       // already days
  return v => originDays + toDays(v);
}



function _gribMsgTimeKey(m){
  const rt=m.refTime, ft=m.pdt?.forecastTime??0;
  if(!rt) return 't'+ft;
  return Date.UTC(rt.year,rt.month-1,rt.day,rt.hour,rt.minute,rt.second||0)+'_'+ft;
}
function _gribUniqueTimeKeys(msgs){
  return [...new Set(msgs.map(_gribMsgTimeKey))].sort((a,b)=>{
    const pa=a.split('_').map(Number), pb=b.split('_').map(Number);
    return pa[0]!==pb[0]?pa[0]-pb[0]:(pa[1]||0)-(pb[1]||0);
  });
}
function _gribUniqueLevels(msgs, levelType){
  const raw=[...new Set(msgs.map(m=>m.pdt?.levelValue??0))].sort((a,b)=>a-b);
  if(raw.length<=1) return null;
  const glt=levelType??((msgs[0]?.pdt?.typeOfLevel)||0);
  return raw.map(v=>glt===100?+(v/100).toFixed(4):v);
}
function _gribFrameLabel(m){
  if(!m?.refTime) return 'Step 1';
  const rt=m.refTime;
  const sk=Date.UTC(rt.year,rt.month-1,rt.day,rt.hour,rt.minute,rt.second||0)/86400000;
  let lab=new Date(sk*86400000).toISOString().slice(0,10);
  const ft=m.pdt?.forecastTime;
  if(ft) lab+=' +'+ft+'h';
  return lab;
}

function buildFrames(reader, grid, varName) {
  const frames = [];
  const v=(reader.variables||[]).find(x=>x.name===varName);
  if(!v)return frames;
  if(reader.getTimeSlice&&v._nT>1){
    const grp=reader._groups?.[v._key];
    const msgs=grp?.msgs||[];
    const uTimes=_gribUniqueTimeKeys(msgs);
    if(uTimes.length>1){
      for(let ti=0;ti<uTimes.length;ti++){
        const tk=uTimes[ti];
        const m0=msgs.find(m=>_gribMsgTimeKey(m)===tk);
        let sortKey=ti, label='Step '+(ti+1);
        if(m0?.refTime){
          const rt=m0.refTime;
          sortKey=Date.UTC(rt.year,rt.month-1,rt.day,rt.hour,rt.minute,rt.second||0)/86400000;
          label=_gribFrameLabel(m0);
        }
        frames.push({reader,grid,varName,localT:ti,sortKey,label});
      }
    } else {
      const m0=msgs[0];
      let sortKey=0, label='Step 1';
      if(m0?.refTime){
        const rt=m0.refTime;
        sortKey=Date.UTC(rt.year,rt.month-1,rt.day,rt.hour,rt.minute,rt.second||0)/86400000;
        label=_gribFrameLabel(m0);
      } else if(reader._times?.length){
        const h=Number(reader._times[0]);
        sortKey=h/24;
        label=new Date(h*3600000).toISOString().slice(0,10);
      }
      frames.push({reader,grid,varName,localT:0,sortKey,label});
    }
    return frames;
  }
  const dims=(v.dimensions||[]).map(d=>String(d));
  const shape = dims.map(d => grid.dimMap[d] || 1);

  const lnTime = (grid.timeV || '').toLowerCase();
  const lnLev = (grid.levV || '').toLowerCase();

  const timeI = dims.findIndex(d => {
    const n = String(d).toLowerCase();
    return n === lnTime || n === 'time' || n === 't' || n === 'time_counter' || n === 'valid_time';
  });

  const levI = dims.findIndex(d => {
    const n = String(d).toLowerCase();
    return n === lnLev || ['depth','lev','level','plev','pressure','pressure_level','height','isobaric','isobaric1','isobaricinhPa','z','sigma','nlevels'].includes(n);
  });

  if (timeI >= 0 && grid.times && grid.times.length > 1) {
    shape[timeI] = grid.times.length;
  }

  const nTime = timeI >= 0 ? shape[timeI] : 1;
  const nLev = levI >= 0 ? shape[levI] : 1;
  const toDaysFn = parseEpochDays(grid.timeUnits);

  
  for (let t = 0; t < nTime; t++) {
    const raw = grid.times && grid.times.length > t ? Number(grid.times[t]) : t;
    let sortKey = t;
    let label = `Step ${t + 1}`;

    if (toDaysFn && grid.times && isFinite(raw)) {
      const d = toDaysFn(raw);
      if (isFinite(d)) {
        sortKey = d;
        label = new Date(d * 86400000).toISOString().slice(0, 10);
      }
    } else if (grid.times && isFinite(raw) && !toDaysFn) {
      // Fallback: treat raw value as Unix epoch seconds (ERA5 valid_time convention)
      // Valid Unix timestamps are > 0 and plausible (after 1970, before 2100)
      const asDate = new Date(raw * 1000);
      const yr = asDate.getUTCFullYear();
      if (yr >= 1950 && yr <= 2100) {
        sortKey = raw / 86400;
        label = asDate.toISOString().slice(0, 10);
      } else {
        // Try as milliseconds (some files store ms directly)
        const asDateMs = new Date(raw);
        const yrMs = asDateMs.getUTCFullYear();
        if (yrMs >= 1950 && yrMs <= 2100) {
          sortKey = raw / 86400000;
          label = asDateMs.toISOString().slice(0, 10);
        }
      }
    }
    

    frames.push({
      reader,
      grid,
      varName,
      localT: t,
      localLev: nLev > 1 ? (grid.defaultLevI ?? 0) : null,
      sortKey,
      label
    });
  }

  return frames;
}

function formatTimeLabel(t, units) {
  /* Legacy helper kept for any external callers */
  const fn = parseEpochDays(units);
  if (fn) {
    const days = fn(+t);
    if (isFinite(days)) return new Date(days * 86400000).toISOString().slice(0, 10);
  }
  return 'T+' + t;
}

/* ============================================================ SLICE EXTRACTION */
function extractSlice(reader, grid, varName, timeIdx, decimateStep, levIdx) {
  const v=reader.variables.find(x=>x.name===varName); if(!v) return null;
  const _fv=getAttr(reader,varName,'_FillValue')??getAttr(reader,varName,'missing_value');
  const _fvN=_fv!=null?Number(_fv):null;
  const fill=(_fvN!=null&&isNaN(_fvN))?null:_fvN;
  const sc=Number(getAttr(reader,varName,'scale_factor')??1);
  const off=Number(getAttr(reader,varName,'add_offset')??0);
  const units=getAttr(reader,varName,'units')||'';
  const longName=getAttr(reader,varName,'long_name')||varName;
  const dims=v.dimensions,shape=dims.map(d=>grid.dimMap[d]||1),nd=dims.length;
  const lnLat=(grid.latV||'').toLowerCase(),lnLon=(grid.lonV||'').toLowerCase(),lnTime=(grid.timeV||'').toLowerCase(),lnLev=(grid.levV||'').toLowerCase();
  const LEVEL_DIM=new Set(['depth','lev','level','plev','pressure','pressure_level','height','isobaric','isobaric1','isobaricinhPa','z','sigma','nlevels']);
  let latI=dims.findIndex(d=>d.toLowerCase()===lnLat||d==='y'||d==='j');
  let lonI=dims.findIndex(d=>d.toLowerCase()===lnLon||d==='x'||d==='i');
  let timeI=dims.findIndex(d=>d.toLowerCase()===lnTime||d==='t');
  let levI=dims.findIndex(d=>d.toLowerCase()===lnLev||LEVEL_DIM.has(d.toLowerCase()));
  if(latI<0)latI=nd-2;if(lonI<0)lonI=nd-1;
  const nLat=shape[latI],nLon=shape[lonI];
  const nTime=timeI>=0?shape[timeI]:1;
  const nLev=levI>=0?(grid.levels?.length||shape[levI]||1):1;
  const tIdx=Math.min(Math.max(0,timeIdx),nTime-1);
  const vLevCount=v._levels?.length||0;
  const hasGribLev=vLevCount>1&&typeof reader.getTimeSlice==='function';
  const lIdx=hasGribLev
    ?Math.min(Math.max(0,levIdx??0),vLevCount-1)
    :(levI>=0?Math.min(Math.max(0,levIdx??grid.defaultLevI??0),nLev-1):0);
  let raw=null,sliced=false;
  if(reader.getTimeSlice){raw=reader.getTimeSlice(varName,timeIdx,timeI,lIdx,levI);if(raw)sliced=true;}
  else if((timeI>=0&&nTime>1)||(levI>=0&&nLev>1)){}
  if(!raw){
    reader._rawCache=reader._rawCache||{};
    raw=reader._rawCache[varName]||(reader._rawCache[varName]=reader.getDataVariable(varName));
  }
  raw=toFlatArray(raw,shape);
  if(!raw) return null;
  const strides=new Array(nd); {let s=1;for(let d=nd-1;d>=0;d--){strides[d]=(sliced&&(d===timeI||d===levI))?0:s;if(!(sliced&&(d===timeI||d===levI)))s*=shape[d];}}
  const baseOff=(timeI>=0&&!sliced)?tIdx*strides[timeI]:0;
  const levOff=(levI>=0&&!sliced)?lIdx*strides[levI]:0;
  const latStride=strides[latI], lonStride=strides[lonI];
  const step=Math.max(1,(decimateStep|0)||1);
  const oLat=Math.ceil(nLat/step), oLon=Math.ceil(nLon/step);
  const data=new Float32Array(oLat*oLon);
  const fillChk=fill!=null,fTol=fillChk?1e-4*(Math.abs(fill)||1):0;
  let di=0;
  if(latStride===nLon&&lonStride===1&&!sliced&&step===1&&sc===1&&off===0&&!fillChk&&raw.subarray){
    const s0=baseOff+levOff;for(let i=0;i<nLat*nLon;i++)data[i]=raw[s0+i];
  } else {
    for(let ilat=0;ilat<nLat;ilat+=step){const rowOff=baseOff+levOff+ilat*latStride;
      for(let ilon=0;ilon<nLon;ilon+=step){const rv=raw[rowOff+ilon*lonStride];data[di++]=(fillChk&&Math.abs(rv-fill)<fTol)?NaN:rv*sc+off;}}
  }
  return {data,nLat:oLat,nLon:oLon,units,longName,step,levIdx:lIdx};
}

/* ============================================================ SAMPLE */
// True when a longitude axis covers the full globe (e.g. 0..359.75 or
// -180..179.5) with one grid-step missing at the wrap point. Used to close
// that gap with cyclic sampling/padding instead of leaving a hard seam.
function _isGlobalLonAxis(lons,nLon){
  if(!lons||nLon<2) return false;
  const step=Math.abs((lons[nLon-1]-lons[0])/(nLon-1));
  return step>0 && (Math.abs(lons[nLon-1]-lons[0])+step)>=359.5;
}
function sampleAt(lon,lat,slice,lats,lons){
  if(!slice||!lats||!lons) return NaN;
  const {data,nLat,nLon}=slice;
  // Projected grid (2D flat lat/lon, e.g. polar stereographic from GRIB2 GDT 3.20)
  if(lats.length===nLat*nLon){
    const step=Math.max(1,Math.round(Math.sqrt(nLat*nLon)/300));
    let bestD=Infinity,bestK=-1;
    for(let k=0;k<nLat*nLon;k+=step){
      const dlat=lats[k]-lat;if(Math.abs(dlat)>8)continue;
      const dlon=normalizeLon(lons[k])-normalizeLon(lon),d=dlon*dlon+dlat*dlat;
      if(d<bestD){bestD=d;bestK=k;}
    }
    if(bestK<0)return NaN;
    const bj=Math.floor(bestK/nLon),bi=bestK%nLon,R2=Math.ceil(20/step)+4;
    const j0=Math.max(0,bj-R2),j1=Math.min(nLat-1,bj+R2),i0=Math.max(0,bi-R2),i1=Math.min(nLon-1,bi+R2);
    bestD=Infinity;bestK=-1;
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      const k=j*nLon+i,dlat=lats[k]-lat,dlon=normalizeLon(lons[k])-normalizeLon(lon),d=dlon*dlon+dlat*dlat;
      if(d<bestD){bestD=d;bestK=k;}
    }
    return bestK>=0&&!isNaN(data[bestK])?data[bestK]:NaN;
  }
  const lonA=lons[0],lonB=lons[nLon-1];
  const isGlobalLon=_isGlobalLonAxis(lons,nLon);
  const latFlip=lats[0]>lats[nLat-1];
  const latMin=latFlip?lats[nLat-1]:lats[0],latMax=latFlip?lats[0]:lats[nLat-1];
  let fx,x0,x1;
  if(isGlobalLon){
    // Longitude axis is cyclic: wrap into [lonA, lonA+360) so the seam
    // between the last and first columns blends instead of leaving a gap.
    const absStep=Math.abs((lonB-lonA)/(nLon-1))||1, span=absStep*nLon;
    const Lw=((lon-lonA)%span+span)%span;
    fx=Lw/absStep;
    x0=Math.min(nLon-1,Math.floor(fx));
    x1=(x0+1)%nLon;
  } else {
    let L=lon;
    if(lonA>=0&&L<0)L+=360;else if(lonB<=0&&L>0)L-=360;
    const lonMin=Math.min(lonA,lonB),lonMax=Math.max(lonA,lonB);
    fx=(L-lonMin)/(lonMax-lonMin||1)*(nLon-1);
    x0=Math.floor(fx);x1=Math.min(x0+1,nLon-1);
  }
  const fy=latFlip?(latMax-lat)/(latMax-latMin||1)*(nLat-1):(lat-latMin)/(latMax-latMin||1)*(nLat-1);
  const y0=Math.floor(fy),y1=Math.min(y0+1,nLat-1);
  if((!isGlobalLon&&x0<0)||y0<0) return NaN;
  const qx=fx-x0,qy=fy-y0;
  const v00=data[y0*nLon+x0],v01=data[y0*nLon+x1],v10=data[y1*nLon+x0],v11=data[y1*nLon+x1];
  if(isNaN(v00)||isNaN(v01)||isNaN(v10)||isNaN(v11))return [v00,v01,v10,v11].find(x=>!isNaN(x))??NaN;
  return v00*(1-qx)*(1-qy)+v01*qx*(1-qy)+v10*(1-qx)*qy+v11*qx*qy;
}
window.sampleAt = sampleAt;

/* ============================================================ AUTO RANGE */
function computeAutoRange(slice){
  const d=slice.data,step=Math.max(1,Math.floor(d.length/8000)),vals=[];
  for(let i=0;i<d.length;i+=step){if(!isNaN(d[i]))vals.push(d[i]);}
  if(!vals.length)return[0,1];
  vals.sort((a,b)=>a-b);
  return[vals[Math.floor(vals.length*0.02)],vals[Math.floor(vals.length*0.98)]];
}

/* ---- Contouring: high-res lat/lon field → d3.contours → geoPath on globe ---- */
const _CTR_STYLES={
  // Slightly brighter/warmer gold than before (was 205,90,0.95) — now that
  // opacity is decoupled from the overlay's data-opacity slider (see
  // doRender), this is the contour's actual on-screen strength rather than
  // getting crushed down by whatever the data opacity happens to be set to.
  synoptic:{stroke:'rgba(255,218,110,1)',halo:'rgba(0,0,0,0.42)',width:1.15},
  white:   {stroke:'rgba(255,255,255,0.92)',halo:'rgba(0,0,0,0.35)',width:1.0},
  dark:    {stroke:'rgba(28,32,42,0.88)',   halo:'rgba(255,255,255,0.55)',width:1.1},
  cyan:    {stroke:'rgba(100,220,255,0.92)',halo:'rgba(0,0,0,0.4)',  width:1.05},
};
// Boost a contour style's stroke colour/width for the "Geography over data"
// appearance boost (mirrors the coast/border boost treatment).
function _boostCtrStyle(style,widthBoost,brightBoost){
  if(!widthBoost&&!brightBoost) return style;
  let stroke=style.stroke;
  const m=/rgba?\(([^)]+)\)/.exec(stroke);
  if(m&&brightBoost){
    const p=m[1].split(',').map(s=>parseFloat(s));
    const r=Math.min(255,p[0]+brightBoost*80), g=Math.min(255,p[1]+brightBoost*80), b=Math.min(255,p[2]+brightBoost*80);
    const a=Math.min(1,(p[3]==null?1:p[3])+brightBoost*0.2);
    stroke='rgba('+Math.round(r)+','+Math.round(g)+','+Math.round(b)+','+a.toFixed(3)+')';
  }
  return {stroke,halo:style.halo,width:style.width+widthBoost*1.3};
}
function _niceContourStep(range, nLev, unitHint){
  const n=Math.max(3,nLev|0);
  const raw=range/(n+1);
  if(unitHint&&unitHint>0){
    const mult=Math.max(1,Math.round(raw/unitHint));
    return unitHint*mult;
  }
  return _niceRound(raw);
}
function _niceRound(x){
  if(!isFinite(x)||x<=0) return 1e-6;
  const pow=Math.pow(10,Math.floor(Math.log10(x)));
  for(const f of [1,2,2.5,5,10]) if(x<=f*pow) return f*pow;
  return 10*pow;
}
function _contourThresholds(mn, mx, nLev, meta){
  const range=(mx-mn)||1;
  const n=Math.max(3,nLev|0);
  const custom=meta?.customStep;
  if(custom!=null&&custom>0){
    // Safety valve only — prevents a mistyped near-zero interval from
    // generating an unbounded number of levels and hanging the tab. Real
    // datasets that legitimately need many levels stay well under this.
    const MAXLINES=1000;
    const t0=Math.ceil(mn/custom)*custom, thr=[];
    for(let t=t0;t<mx-custom*0.01&&thr.length<MAXLINES;t+=custom) thr.push(+t.toFixed(4));
    if(thr.length>=2) return thr;
  }
  // No custom step: use exact linear spacing so the contour-count slider is
  // always deterministic and immediately visible.
  const st=range/(n+1);
  const prec=st<0.5?3:st<5?2:1;
  const thr=[];
  for(let i=1;i<=n;i++) thr.push(+(mn+st*i).toFixed(prec));
  return thr;
}
function _contourStepHint(meta){
  const units=(meta?.units||'').toLowerCase();
  const ln=((meta?.longName||'')+' '+(meta?.varName||'')).toLowerCase();
  const blob=units+' '+ln;
  if(/gpm|geopotential|geopot|hgt/.test(blob)) return 'gpm';
  if(/hpa|millibar|pascal/.test(blob)) return 'hPa';
  if(/kelvin|temp/.test(blob)) return 'K';
  if(/m\/s|wind/.test(blob)) return 'm/s';
  return units||'';
}
function _normLon(L){L=((L%360)+360)%360;if(L>180)L-=360;return L;}
function _buildContourField(rs, maxDim){
  const {nLat,nLon,lats,lons,data}=rs;
  const latMin=Math.min(lats[0],lats[nLat-1]), latMax=Math.max(lats[0],lats[nLat-1]);
  const latDesc=lats[0]>lats[nLat-1];
  const norm=new Float64Array(nLon);
  for(let j=0;j<nLon;j++) norm[j]=_normLon(lons[j]);
  const perm=Array.from(norm.keys()).sort((a,b)=>norm[a]-norm[b]);
  const sortedLons=perm.map(j=>norm[j]);
  const lonSpan=sortedLons[nLon-1]-sortedLons[0];
  const isGlobal=lonSpan>=300;
  const step=Math.max(1,Math.ceil(Math.max(nLat,nLon)/(maxDim||480)));
  // 2x-upsampled marching-squares field (capped) — isolines are extracted
  // from a denser grid, so their vertex spacing matches the bicubic-smooth
  // shaded field instead of the raw data resolution.
  const cC=Math.min(960,Math.max(2,Math.ceil(nLon/step)*2));
  const cR=Math.min(600,Math.max(2,Math.ceil(nLat/step)*2));
  const values=new Float64Array(cC*cR);
  const colLons=new Float64Array(cC);
  // NaN-aware bilinear resampling (was nearest-neighbour, which aliased
  // the field before contouring and made every isoline step-jagged).
  const srcRowOf=r=>latDesc?r:(nLat-1-r);
  for(let ir=0;ir<cR;ir++){
    const fi=ir*(nLat-1)/(cR-1);
    const r0=Math.min(nLat-1,Math.floor(fi)), r1=Math.min(nLat-1,r0+1), fr=fi-r0;
    const row0=srcRowOf(r0)*nLon, row1=srcRowOf(r1)*nLon;
    for(let ic=0;ic<cC;ic++){
      const fj=ic*(nLon-1)/(cC-1);
      const c0=Math.min(nLon-1,Math.floor(fj)), c1=Math.min(nLon-1,c0+1), fc=fj-c0;
      const v00=data[row0+perm[c0]], v01=data[row0+perm[c1]];
      const v10=data[row1+perm[c0]], v11=data[row1+perm[c1]];
      let sum=0,wsum=0;
      if(!isNaN(v00)){const w=(1-fc)*(1-fr);sum+=v00*w;wsum+=w;}
      if(!isNaN(v01)){const w=fc*(1-fr);sum+=v01*w;wsum+=w;}
      if(!isNaN(v10)){const w=(1-fc)*fr;sum+=v10*w;wsum+=w;}
      if(!isNaN(v11)){const w=fc*fr;sum+=v11*w;wsum+=w;}
      values[ir*cC+ic]=wsum>1e-9?sum/wsum:NaN;
      if(!ir) colLons[ic]=sortedLons[c0]+(sortedLons[c1]-sortedLons[c0])*fc;
    }
  }
  // One NaN-aware 3x3 binomial smoothing pass: softens marching-squares
  // steps without shifting isoline positions perceptibly.
  if(cC*cR<=700000){
    const sm=new Float64Array(cC*cR);
    for(let ir=0;ir<cR;ir++){
      for(let ic=0;ic<cC;ic++){
        const k=ir*cC+ic;
        if(isNaN(values[k])){sm[k]=NaN;continue;}
        let sum=0,wsum=0;
        for(let dr=-1;dr<=1;dr++){
          const rr=ir+dr; if(rr<0||rr>=cR)continue;
          for(let dc=-1;dc<=1;dc++){
            const cc2=ic+dc; if(cc2<0||cc2>=cC)continue;
            const v=values[rr*cC+cc2]; if(isNaN(v))continue;
            const w=(dr===0?2:1)*(dc===0?2:1);
            sum+=v*w; wsum+=w;
          }
        }
        sm[k]=sum/wsum;
      }
    }
    values.set(sm);
  }
  if(isGlobal&&cC>=4){
    const padC=Math.max(2,Math.min(8,Math.ceil(cC*0.06)));
    const pC=cC+2*padC;
    const padded=new Float64Array(pC*cR);
    const pColLons=new Float64Array(pC);
    for(let ic=0;ic<pC;ic++){
      let si;
      if(ic<padC) si=cC-padC+ic;
      else if(ic>=padC+cC) si=ic-padC-cC;
      else si=ic-padC;
      let lon=colLons[si];
      if(ic<padC) lon-=360;
      else if(ic>=padC+cC) lon+=360;
      pColLons[ic]=lon;
    }
    for(let ir=0;ir<cR;ir++){
      for(let ic=0;ic<pC;ic++){
        let si;
        if(ic<padC) si=cC-padC+ic;
        else if(ic>=padC+cC) si=ic-padC-cC;
        else si=ic-padC;
        padded[ir*pC+ic]=values[ir*cC+si];
      }
    }
    return {values:padded,cC:pC,cR,lonMin:pColLons[0],lonMax:pColLons[pC-1],latMin,latMax,isGlobal,colLons:pColLons,padC};
  }
  return {values,cC,cR,lonMin:colLons[0],lonMax:colLons[cC-1],latMin,latMax,isGlobal,colLons};
}
function _gridRingToLonLat(ring,cC,cR,lonMin,lonMax,latMin,latMax,colLons){
  const denom=Math.max(1,cC-1);
  return ring.map(([gx,gy])=>{
    const x=Math.min(Math.max(0,gx),cC-1);
    const ic0=Math.floor(x), ic1=Math.min(cC-1,ic0+1), f=x-ic0;
    let lon;
    if(colLons&&ic0<colLons.length) lon=colLons[ic0]+(colLons[ic1]-colLons[ic0])*f;
    else lon=lonMin+(x/denom)*(lonMax-lonMin);
    lon=_normLon(lon);
    return [lon, latMax-(gy/(cR-1))*(latMax-latMin)];
  });
}
function _unwrapRingLons(ring){
  if(ring.length<2) return ring;
  const out=[[ring[0][0],ring[0][1]]];
  for(let i=1;i<ring.length;i++){
    let lon=ring[i][0], lat=ring[i][1], prev=out[out.length-1][0];
    while(lon-prev>180) lon-=360;
    while(lon-prev<-180) lon+=360;
    out.push([lon,lat]);
  }
  return out;
}
function _splitRingsAtSeam(rings){
  const out=[];
  rings.forEach(ring=>{
    ring=_unwrapRingLons(ring);
    let seg=[];
    for(let i=0;i<ring.length;i++){
      if(i>0&&Math.abs(ring[i][0]-ring[i-1][0])>30){
        if(seg.length>=2) out.push(seg);
        seg=[];
      }
      seg.push(ring[i]);
    }
    if(seg.length>=2) out.push(seg);
  });
  return out.filter(r=>r.length>=2);
}
function _dropDatelineArtifacts(rings){
  return rings.filter(ring=>{
    if(ring.length<2) return false;
    const near=ring.filter(p=>Math.abs(p[0])>177).length;
    if(near>=ring.length*0.7) return false;
    if(ring.length<=5&&near>=2) return false;
    let flips=0,maxJump=0;
    for(let i=1;i<ring.length;i++){
      const d=Math.abs(ring[i][0]-ring[i-1][0]);
      if(d>maxJump) maxJump=d;
      if(d>30) flips++;
    }
    if(flips>=2&&near>=1) return false;
    if(maxJump>120&&near>=1) return false;
    return true;
  });
}
function _densifyGeoRing(ring,maxDeg){
  if(ring.length<2) return ring;
  maxDeg=maxDeg||0.45;
  const out=[];
  for(let i=0;i<ring.length-1;i++){
    const a=ring[i],b=ring[i+1];
    out.push(a);
    const d=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const n=Math.max(1,Math.ceil(d/maxDeg));
    for(let j=1;j<n;j++){
      const f=j/n;
      out.push([a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]);
    }
  }
  out.push(ring[ring.length-1]);
  return out;
}
function _dropZonalArtifacts(rings,lonMin,lonMax,latMin,latMax){
  const lonSpan=Math.max(1e-6,lonMax-lonMin);
  const latSpan=Math.max(1e-6,latMax-latMin);
  return rings.filter(ring=>{
    if(!ring||ring.length<3) return true;
    let minLat=Infinity,maxLat=-Infinity,minLon=Infinity,maxLon=-Infinity,latSum=0;
    for(const p of ring){
      const lo=p[0],la=p[1];
      if(la<minLat)minLat=la;if(la>maxLat)maxLat=la;
      if(lo<minLon)minLon=lo;if(lo>maxLon)maxLon=lo;
      latSum+=la;
    }
    const latSpread=maxLat-minLat, lonSpread=maxLon-minLon;
    if(latSpread<Math.max(0.4,latSpan*0.015)&&lonSpread>lonSpan*0.3) return false;
    const latMean=latSum/ring.length;
    let latVar=0;
    for(const p of ring) latVar+=(p[1]-latMean)**2;
    const latStd=Math.sqrt(latVar/ring.length);
    if(latStd<0.3&&lonSpread>lonSpan*0.22) return false;
    let flatSeg=0;
    for(let i=1;i<ring.length;i++){
      if(Math.abs(ring[i][1]-ring[i-1][1])<0.08&&Math.abs(ring[i][0]-ring[i-1][0])>lonSpan*0.08) flatSeg++;
    }
    if(flatSeg>=Math.max(2,Math.floor(ring.length*0.25))) return false;
    if(Math.abs(latMean-latMin)<0.05||Math.abs(latMean-latMax)<0.05) return false;
    return true;
  });
}
function _thinContourRing(ring,maxPts){
  if(!ring||ring.length<=maxPts) return ring;
  const step=Math.ceil(ring.length/maxPts), out=[];
  for(let i=0;i<ring.length;i+=step) out.push(ring[i]);
  if(out.length&&ring.length&&out[out.length-1]!==ring[ring.length-1]) out.push(ring[ring.length-1]);
  return out;
}
function _isContourBoundaryArtifact(ring,lonMin,lonMax,latMin,latMax){
  if(!ring||ring.length<3) return true;
  const lonSpan=Math.max(1e-6,lonMax-lonMin), latSpan=Math.max(1e-6,latMax-latMin);
  let edge=0,horiz=0,minLat=Infinity,maxLat=-Infinity,minLon=Infinity,maxLon=-Infinity;
  const latTol=Math.max(0.12,latSpan*0.006), lonTol=Math.max(0.2,lonSpan*0.004);
  for(let i=0;i<ring.length;i++){
    const p=ring[i], lo=p[0], la=p[1];
    if(la<minLat)minLat=la;if(la>maxLat)maxLat=la;if(lo<minLon)minLon=lo;if(lo>maxLon)maxLon=lo;
    if(Math.abs(la-latMin)<latTol||Math.abs(la-latMax)<latTol||Math.abs(lo-lonMin)<lonTol||Math.abs(lo-lonMax)<lonTol) edge++;
    if(i>0&&Math.abs(la-ring[i-1][1])<0.05&&Math.abs(lo-ring[i-1][0])>lonSpan*0.04) horiz++;
  }
  const latSpread=maxLat-minLat, lonSpread=maxLon-minLon;
  if(edge/ring.length>0.22) return true;
  if(latSpread<Math.max(0.25,latSpan*0.01)&&lonSpread>lonSpan*0.18) return true;
  if(horiz>Math.max(2,ring.length*0.18)) return true;
  return false;
}
// Convert a closed d3-contour polygon ring (given in GRID-INDEX coordinates)
// into open lon/lat polylines. Boundary-follow segments — the artificial edges
// that run along the data grid's outer border (poles at top/bottom, and the
// left/right columns, which for a wrapped global field are the antimeridian
// pad seam) — are detected in GRID space (before longitude normalization) and
// removed. This preserves ALL interior isolines, including legitimate zonal
// (east–west) contours such as temperature bands, while eliminating the
// rectangle-edge and seam artifacts. Finally each piece is seam-split so the
// antimeridian wrap never draws a spurious horizontal jump.
function _gridRingToPolylines(ring, cC, cR, lonMin, lonMax, latMin, latMax, colLons, isGlobal){
  const eps=0.55;
  const denom=Math.max(1,cC-1), rDen=Math.max(1,cR-1);
  const pts=ring.map(([gx,gy])=>{
    const onLeft=gx<=eps, onRight=gx>=cC-1-eps;
    const onTop=gy<=eps, onBot=gy>=cR-1-eps;
    const x=Math.min(Math.max(0,gx),cC-1);
    const ic0=Math.floor(x), ic1=Math.min(cC-1,ic0+1), f=x-ic0;
    let lon;
    if(colLons&&ic0<colLons.length) lon=colLons[ic0]+(colLons[ic1]-colLons[ic0])*f;
    else lon=lonMin+(x/denom)*(lonMax-lonMin);
    lon=_normLon(lon);
    const lat=latMax-(Math.min(Math.max(0,gy),cR-1)/rDen)*(latMax-latMin);
    return {lon,lat,onLeft,onRight,onTop,onBot};
  });
  const pieces=[]; let cur=[];
  for(let i=0;i<pts.length;i++){
    const p=pts[i], prev=i>0?pts[i-1]:null;
    if(prev){
      // Boundary-follow edge: both endpoints hug the SAME grid border.
      // Poles (top/bot) and the left/right columns (pad seam for global,
      // real data edge for regional) are all artifacts we cut at.
      const cut=(p.onTop&&prev.onTop)||(p.onBot&&prev.onBot)||
                (p.onLeft&&prev.onLeft)||(p.onRight&&prev.onRight);
      if(cut){ if(cur.length>=2) pieces.push(cur); cur=[p]; continue; }
    }
    cur.push(p);
  }
  if(cur.length>=2) pieces.push(cur);
  // Seam-split each piece (handles the normalized-lon dateline jump)
  const out=[];
  for(const pc of pieces){
    const ll=pc.map(q=>[q.lon,q.lat]);
    for(const s of _splitRingsAtSeam([ll])) if(s.length>=2) out.push(s);
  }
  return out;
}
// Chaikin corner-cutting for open polylines: each round replaces every
// segment with its 1/4 and 3/4 points, converting marching-squares angles
// into smooth curves while preserving endpoints. Safe post-seam-split
// (longitudes are continuous within each piece, so averaging can't wrap).
function _chaikinOpen(pts,rounds){
  for(let r=0;r<rounds;r++){
    if(!pts||pts.length<3) return pts;
    const out=[pts[0]];
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i],b=pts[i+1];
      out.push([a[0]*0.75+b[0]*0.25,a[1]*0.75+b[1]*0.25]);
      out.push([a[0]*0.25+b[0]*0.75,a[1]*0.25+b[1]*0.75]);
    }
    out.push(pts[pts.length-1]);
    pts=out;
  }
  return pts;
}
function _contourRings(rs, thresholds, maxDim, lite){
  if(!window.d3?.contours) return [];
  thresholds=(thresholds||[]).filter(Number.isFinite);
  if(!thresholds.length) return [];
  const {values,cC,cR,lonMin,lonMax,latMin,latMax,colLons,isGlobal}=_buildContourField(rs,maxDim);
  const gen=d3.contours().size([cC,cR]).thresholds(thresholds);
  const out=[], maxPts=lite?240:380;
  for(const c of gen(values)){
    const polylines=[];
    for(const poly of (c.coordinates||[])){
      for(const ring of poly){
        for(let seg of _gridRingToPolylines(ring,cC,cR,lonMin,lonMax,latMin,latMax,colLons,isGlobal)){
          // Chaikin (2 rounds) smooths the marching-squares angles, then
          // thinning caps the point count for geoPath draw cost.
          if(seg.length>=2) polylines.push(_thinContourRing(_chaikinOpen(seg,1),maxPts));
        }
      }
    }
    if(polylines.length) out.push({value:c.value,rings:polylines});
  }
  return out;
}
function _drawGeoContourLevel(ctx,rings,geoPath,style,dpr,lonMin,lonMax,latMin,latMax,budget){
  const lw=Math.max(0.7,style.width/dpr);
  ctx.lineJoin='round';ctx.lineCap='round';ctx.setLineDash([]);
  const filtered=rings;
  const skipHalo=!!(budget&&budget.skipHalo);
  for(const ring of filtered){
    if(budget&&Date.now()>budget.deadline) return false;
    if(!ring||ring.length<2) continue;
    const geom={type:'LineString',coordinates:ring};
    if(!skipHalo){
      ctx.beginPath();geoPath(geom);
      ctx.lineWidth=lw+1.1/dpr;ctx.strokeStyle=style.halo;ctx.stroke();
    }
    ctx.beginPath();geoPath(geom);
    ctx.lineWidth=lw;ctx.strokeStyle=style.stroke;ctx.stroke();
    if(budget&&++budget.rings>=budget.maxRings) return false;
  }
  return true;
}
function _plotContourStyle(name){
  return _CTR_STYLES[name]||_CTR_STYLES.synoptic;
}
function _filterPlotRingArtifacts(rings,lonMin,lonMax,latMin,latMax){
  // For the 2D map we prefer preserving scientific contour geometry.
  // Keep filtering minimal and only drop obviously bad rings.
  return (rings||[]).filter(ring=>{
    if(!ring||ring.length<2) return false;
    for(let i=0;i<ring.length;i++){
      const p=ring[i];
      if(!p||!isFinite(p[0])||!isFinite(p[1])) return false;
    }
    return true;
  });
}
function _strokePlotRings(ctx,rings,L,T,pw,ph,lonMin,lonMax,latMin,latMax,style){
  const span=Math.max(1e-6,lonMax-lonMin);
  const coords=_filterPlotRingArtifacts(rings.filter(r=>r.length>=2),lonMin,lonMax,latMin,latMax);
  if(!coords.length) return;
  const xOf=lo=>L+(lo-lonMin)/span*pw;
  const yOf=la=>T+(latMax-la)/(latMax-latMin)*ph;
  const normLon=(lon,prevLon)=>{
    let L2=lon;
    while(L2<lonMin) L2+=360;
    while(L2>lonMax) L2-=360;
    if(prevLon!=null){
      while(L2-prevLon>180) L2-=360;
      while(prevLon-L2>180) L2+=360;
    }
    return L2;
  };
  const shouldBreak=(lon,lat,prev)=>{
    if(!prev) return false;
    const dLon=Math.abs(lon-prev[0]);
    // break only on true seam jumps, not on broad zonal contours
    return dLon>Math.max(170,span*0.85);
  };
  ctx.lineJoin='round';ctx.lineCap='round';ctx.setLineDash([]);
  ctx.beginPath();
  coords.forEach(ring=>{
    let started=false, prev=null;
    for(let i=0;i<ring.length;i++){
      const lat=ring[i][1];
      const lon=normLon(ring[i][0], prev?prev[0]:null);
      if(lon<lonMin-1||lon>lonMax+1||lat<latMin-1||lat>latMax+1){ started=false; prev=null; continue; }
      if(shouldBreak(lon,lat,prev)) started=false;
      const x=xOf(lon),y=yOf(lat);
      if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);
      prev=[lon,lat];
    }
  });
  ctx.lineWidth=style.width+0.8;ctx.strokeStyle=style.halo;ctx.stroke();
  ctx.beginPath();
  coords.forEach(ring=>{
    let started=false, prev=null;
    for(let i=0;i<ring.length;i++){
      const lat=ring[i][1];
      const lon=normLon(ring[i][0], prev?prev[0]:null);
      if(lon<lonMin-1||lon>lonMax+1||lat<latMin-1||lat>latMax+1){ started=false; prev=null; continue; }
      if(shouldBreak(lon,lat,prev)) started=false;
      const x=xOf(lon),y=yOf(lat);
      if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);
      prev=[lon,lat];
    }
  });
  ctx.lineWidth=style.width;ctx.strokeStyle=style.stroke;ctx.stroke();
}

/* ============================================================ MODULE */
window.GlobeNC = function(api) {
  const overlays=[];
  // Exposed so other modules sharing this api object (e.g. the value probe
  // in globe-ann, which runs after GlobeNC) can read the live overlay list
  // without duplicating the render-slice/units bookkeeping.
  api._overlaysForProbe=overlays;
  api.sampleAt=sampleAt;
  let playTimer=null, playFps=2;
  const perfMode='quality';
  let gpuEnabled=true;     // WebGL2 default
  let useWebGPU=false;   // opt-in WebGPU
  let _glProbed=false, _glOK=false, _glMaxDim=null;
  let _wgpuDevice=null, _wgpuProbed=false, _wgpuOK=false;
  let _wgpuFailStreak=0;
  function _updateRendererStatus(){
    const st=document.getElementById('nc-hw-status');
    const wst=document.getElementById('nc-wgpu-status');
    const wtog=document.getElementById('nc-webgpu-toggle');
    if(st){
      if(useWebGPU&&_wgpuOK) st.textContent='WebGPU overlay + WebGPU particles';
      else if(_glOK) st.textContent='WebGL2 (default)';
      else st.textContent='CPU fallback (no WebGL2)';
      st.style.color=gpuEnabled&&_glOK?'var(--acc)':'var(--warm)';
    }
    if(wst){
      if(!_wgpuOK) wst.textContent='Unavailable';
      else if(useWebGPU) wst.textContent='Active';
      else wst.textContent='Ready (off)';
      wst.style.color=useWebGPU&&_wgpuOK?'var(--acc)':'';
    }
    if(wtog){
      wtog.classList.toggle('on',useWebGPU&&_wgpuOK);
      wtog.style.opacity=_wgpuOK?'1':'0.45';
    }
    document.getElementById('nc-hw-toggle')?.classList.toggle('on',gpuEnabled&&_glOK);
    if(window.GlobeAPI){
      window.GlobeAPI._ncGPULive=(useWebGPU&&_wgpuOK)||(gpuEnabled&&_glOK);
      window.GlobeAPI._ncUseWebGPU=useWebGPU&&_wgpuOK;
      window.GlobeAPI._ncGpuEnabled=gpuEnabled;
      window.GlobeAPI._ncWebGPUOk=_wgpuOK;
    }
    _applyFlowGpuBoost();
  }
  function _applyFlowGpuBoost(){
    const cfg=window._flowCfg;
    if(!cfg) return;
    // NOTE: particle advection still runs entirely on the CPU (frame() in the
    // globe block). The WebGPU device here is only used for the overlay's dead
    // _renderWGPU path (unused — doRender always takes WebGL2). Previously this
    // multiplied particle density 1.65x and doubled speed-color draw passes
    // whenever WebGPU was "on", which added CPU work without any GPU offload —
    // that's why enabling WebGPU made things slower, not faster. Keep these at
    // neutral values until particle advection is actually moved to a compute
    // shader (see _particleComputeStep), at which point boost can safely reflect
    // real headroom freed up by moving the physics off the main thread.
    const boost=(_glOK?1.2:1);
    const quality=false;
    if(cfg._gpuBoost===boost&&cfg._gpuQuality===quality) return;
    cfg._gpuBoost=boost;
    cfg._gpuQuality=quality;
    // Guard: only repaint if the globe projection is ready (positive scale).
    // Calling repaintOcean before the projection initialises causes a negative
    // radius in ctx.arc() → IndexSizeError on startup.
    const sc=window.GlobeAPI?.projection?.scale?.()??-1;
    if(sc>0){
      if(window._repaintOcean) window._repaintOcean();
      if(window._flowClear) window._flowClear();
    }
  }
  async function _probeWebGPU(){
    if(_wgpuProbed) return _wgpuOK;
    _wgpuProbed=true;
    try{
      if(!navigator.gpu) return false;
      const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
      if(!adapter) return false;
      _wgpuDevice=await adapter.requestDevice();
      _wgpuOK=!!_wgpuDevice;
      // Expose the device so the particle engine (globe block) can also use
      // it for compute — it inits after this module, so it reads this lazily.
      if(window.GlobeAPI) window.GlobeAPI._wgpuDevice=_wgpuDevice;
    }catch(e){_wgpuOK=false;}
    _updateRendererStatus();
    return _wgpuOK;
  }
  function _autoEnableGPU(){
    _probeWebGL();
    // WebGL2 is the always-on internal default — no manual CPU toggle.
    // gpuEnabled stays true; doRender falls back to CPU automatically and
    // logs a warning if WebGL2 turns out to be unavailable at render time.
    gpuEnabled=true;
    const tog=document.getElementById('nc-hw-toggle');
    if(tog){
      tog.classList.toggle('on',true);
      const row=tog.closest('.hwaccel-row');
      if(row) row.style.display='none'; // hide the whole manual toggle row
    }
    _probeWebGPU();
    _updateRendererStatus();
  }

  // Probe WebGL2 support once — returns true if usable.
  function _probeWebGL(){
    if(_glProbed) return _glOK;
    _glProbed=true;
    try{
      const c=document.createElement('canvas');
      const gl=c.getContext('webgl2');
      if(!gl){_glOK=false;return false;}
      _glOK=true; // WebGL2 alone is enough — we encode data as RGBA8 (universally filterable)
      // Mobile GPUs commonly cap render-target size far below desktop (e.g.
      // 4096 vs 16384) — a full-viewport*dpr overlay canvas (esp. with
      // several layers/large tablets at dpr 2-3) can exceed that cap and
      // fail to allocate, which is a plausible source of mobile-only
      // WebGL crashes. Cache the real limit so _getGL can route oversized
      // requests to the existing CPU fallback instead of forcing a bad
      // allocation.
      const dims=gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      _glMaxDim=Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE),dims[0],dims[1]);
    }catch(e){_glOK=false;}
    return _glOK;
  }
  const MAX=8;

  function layoutViewport(){
    if(window.GlobeAPI?.globeViewport) return window.GlobeAPI.globeViewport();
    const dpr=window.devicePixelRatio||1;
    return {w:innerWidth,h:innerHeight,dpr};
  }
  function resizeAll(){
    const v=layoutViewport();
    const w=Math.round(v.w*v.dpr), h=Math.round(v.h*v.dpr);
    overlays.forEach(ov=>{ov.canvas.width=w; ov.canvas.height=h; if(ov._wgpuCanvas){ov._wgpuCanvas.width=w;ov._wgpuCanvas.height=h;} schedRender(ov);});
  }
  window.addEventListener('resize',resizeAll);
  window.visualViewport?.addEventListener('resize',resizeAll);
  window.visualViewport?.addEventListener('scroll',resizeAll);
  api.onRedraw=()=>{
    _drawRegionBox();
    overlays.forEach(ov=>{
      if(!ov.enabled) return;
      // Always rAF-batch. doRender reads live projection state directly, and the
      // overlay always renders via WebGL2 now (see doRender) — there is no
      // WebGPU-specific drift to work around, so there's no reason to bypass
      // frame batching. Un-throttled renderOverlayNow was firing a full render
      // per pointer-move event during drags with WebGPU on, which is the main
      // cause of WebGPU-mode sluggishness.
      schedRender(ov);
    });
  };

  /* global drop → first empty slot or new card */
  window.addEventListener('dragover',e=>{if([...e.dataTransfer.items].some(i=>i.kind==='file'))e.preventDefault();});
  window.addEventListener('drop',async e=>{
    e.preventDefault();
    const files=[...e.dataTransfer.files].filter(f=>{const ext=(f.name.split('.').pop()||'').toLowerCase();return /^(nc|nc4|grb|grb2|grib|grib2|h5|hdf5)$/.test(ext)||/^f\d+$/.test(ext)||!f.name.includes('.');});
    if(!files.length) return;
    let target=overlays.find(ov=>!ov.frames.length);
    if(!target){if(overlays.length>=MAX){alert('Max '+MAX+' overlays. Remove one first.');return;}target=createOverlay();}
    openOvBody(target);
    for(const f of files) await appendFileToOverlay(target,f);
  });

  buildNcPanel();

  /* ---- CREATE overlay ---- */
  // ── Derived layer dialog: named terms + formula ──────────────
  // Each term binds a letter (A, B, C…) to (overlay, variable, level,
  // time). The formula combines terms with +-*/, ^, and Math functions.
  // Presets cover the standard meteorological derived quantities.
  const _DERIVE_PRESETS=[
    ['','— presets —'],
    ['sqrt(A*A+B*B)','Wind speed  √(A²+B²)'],
    ['atan2(A,B)*180/PI','Wind direction  atan2(A,B)°'],
    ['A-B','Difference  A − B'],
    ['abs(A-B)','|A − B|'],
    ['(A+B)/2','Mean  (A+B)/2'],
    ['A*B','Product / flux  A × B'],
    ['A/B','Ratio  A ÷ B'],
    ['A*pow(1000/B,0.286)','Potential temp  A·(1000/B)^0.286'],
    ['A*(1+0.61*B)','Virtual temp  A·(1+0.61·B)'],
  ];
  function _openDeriveDialog(){
    const withData=overlays.filter(o=>!o._derived&&o.readers&&o.readers.length&&o.varOptions.length);
    if(!withData.length){ alert('Load at least one data overlay first (drop a .nc or GRIB2 file).'); return; }
    const back=document.createElement('div');
    back.className='nc-derive-dlg';
    back.style.cssText='position:fixed;inset:0;background:rgba(3,8,14,0.72);z-index:200;display:flex;align-items:center;justify-content:center;font-family:IBM Plex Mono,monospace;';
    const card=document.createElement('div');
    card.style.cssText='background:#0a1622;border:1px solid rgba(120,170,205,0.35);border-radius:10px;padding:18px 20px;width:520px;max-height:80vh;overflow:auto;color:#cfe3f2;font-size:12px;box-shadow:0 12px 40px rgba(0,0,0,0.5);';
    const ovOpts=withData.map(o=>'<option value="'+o.id+'">'+((o.name||o.id).slice(0,40))+'</option>').join('');
    function termRowHTML(letter){
      return '<div class="der-term" data-id="'+letter+'" style="display:grid;grid-template-columns:18px 1.4fr 1.2fr 60px 90px;gap:6px;align-items:center;margin-bottom:6px;">'+
        '<span style="color:#7fd0ff;font-weight:600;">'+letter+'</span>'+
        '<select class="der-ov" style="padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:5px;font-size:10px;">'+ovOpts+'</select>'+
        '<select class="der-var" style="padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:5px;font-size:10px;"></select>'+
        '<select class="der-lev" title="Level" style="padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:5px;font-size:10px;"></select>'+
        '<select class="der-time" style="padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:5px;font-size:10px;">'+
          '<option value="sync">sync time</option><option value="0">t = 0</option></select>'+
      '</div>';
    }
    card.innerHTML=
      '<div style="font-size:13px;letter-spacing:0.08em;margin-bottom:10px;color:#eaf4fb;">DERIVED LAYER</div>'+
      '<div style="font-size:10px;color:#8fb0c8;margin-bottom:6px;">Terms — each letter binds to (overlay · variable · level index · time)</div>'+
      '<div id="der-terms">'+termRowHTML('A')+termRowHTML('B')+'</div>'+
      '<button id="der-addterm" style="padding:3px 10px;margin-bottom:12px;border-radius:5px;border:1px solid rgba(120,170,205,0.3);background:transparent;color:#8fb0c8;cursor:pointer;font-size:10px;">＋ term</button>'+
      '<div style="font-size:10px;color:#8fb0c8;margin-bottom:4px;">Formula</div>'+
      '<div style="display:flex;gap:6px;margin-bottom:6px;">'+
        '<input id="der-formula" type="text" value="A-B" spellcheck="false" style="flex:1;padding:6px;background:#0a1828;color:#eaf4fb;border:1px solid rgba(120,170,205,0.35);border-radius:5px;font-size:12px;font-family:inherit;">'+
        '<select id="der-preset" style="width:170px;padding:4px;background:#0a1828;color:#8fb0c8;border:1px solid rgba(120,170,205,0.3);border-radius:5px;font-size:10px;">'+
          _DERIVE_PRESETS.map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('')+
        '</select>'+
      '</div>'+
      '<div style="font-size:9px;color:#6a8298;margin-bottom:12px;line-height:1.45;">Functions: '+_FORMULA_FNS.join(', ')+', PI, E. Use ^ for powers. Terms after A are resampled onto the grid of A. NaN in any term masks the cell. "sync time" follows the source overlay\u2019s time slider; a number pins a fixed frame (e.g. anomaly vs t=0).</div>'+
      '<div id="der-err" style="font-size:9.5px;color:#ff8a8a;margin-bottom:6px;min-height:12px;"></div>'+
      '<div id="der-stats" style="font-size:9.5px;color:#8fd0ae;margin-bottom:8px;min-height:14px;line-height:1.5;"></div>'+
      '<div style="display:flex;gap:8px;justify-content:flex-end;">'+
        '<button id="der-cancel" style="padding:6px 14px;border-radius:6px;border:1px solid rgba(120,170,205,0.3);background:transparent;color:#8fb0c8;cursor:pointer;font-size:11px;">Cancel</button>'+
        '<button id="der-compare" style="padding:6px 14px;border-radius:6px;border:1px solid rgba(140,220,180,0.4);background:transparent;color:#8fd0ae;cursor:pointer;font-size:11px;">Compare A · B</button>'+
        '<button id="der-create" style="padding:6px 14px;border-radius:6px;border:none;background:var(--acc,#7fd0ff);color:#04121f;cursor:pointer;font-size:11px;font-weight:600;">Create</button>'+
      '</div>';
    back.appendChild(card);
    document.body.appendChild(back);
    const close=()=>back.remove();
    function fillLevTime(row){
      const ovSel=row.querySelector('.der-ov'), varSel=row.querySelector('.der-var');
      const levSel=row.querySelector('.der-lev'), timeSel=row.querySelector('.der-time');
      const src=withData.find(o=>o.id===ovSel.value)||withData[0];
      const frames=_termFrames(src,varSel.value);
      const g=frames.length?frames[0].grid:null;
      // Levels: actual coordinate values (e.g. 1000 hPa), not raw indices —
      // plus vertical mean / sum aggregations across all levels.
      // NetCDF-style files expose levels on the grid itself (g.levels), but
      // GRIB2 files loaded as separate per-level messages expose them on the
      // variable instead (v._levels) — same fallback the overlay card's own
      // level control (getGribLevels) already uses, mirrored here so the
      // derive dialog picks up isobaric levels too.
      let levs=(g&&g.levels&&g.levels.length>1)?g.levels:null;
      let lu=(g&&g.levUnits)?(' '+g.levUnits):'';
      if(!levs){
        const gv=frames[0]?.reader?.variables?.find(x=>x.name===varSel.value);
        if(gv?._levels?.length>1){ levs=gv._levels; lu=' '+(src._gribLevUnits||'hPa'); }
      }
      levs=levs||[];
      levSel.innerHTML=
        (levs.length?levs.map((v,i)=>'<option value="'+i+'">'+v+lu+'</option>').join('')
                    :'<option value="0">surface</option>')+
        (levs.length>1?'<option value="mean">mean of levels</option><option value="sum">sum of levels</option>':'');
      // Times: actual frame timestamps instead of bare indices.
      timeSel.innerHTML='<option value="sync">sync time</option>'+
        frames.slice(0,120).map((f,i)=>'<option value="'+i+'">'+(f.label||('t='+i))+'</option>').join('');
    }
    function fillVars(row){
      const ovSel=row.querySelector('.der-ov'), varSel=row.querySelector('.der-var');
      const src=withData.find(o=>o.id===ovSel.value)||withData[0];
      varSel.innerHTML=src.varOptions.map(v=>'<option value="'+v.name+'">'+(v.label||v.name)+'</option>').join('');
      if(src.selVar) varSel.value=src.selVar;
      fillLevTime(row);
    }
    function wireRow(row){
      fillVars(row);
      row.querySelector('.der-ov').addEventListener('change',()=>fillVars(row));
      row.querySelector('.der-var').addEventListener('change',()=>fillLevTime(row));
    }
    card.querySelectorAll('.der-term').forEach(wireRow);
    if(withData.length>1) {
      const rows=card.querySelectorAll('.der-term');
      rows[1].querySelector('.der-ov').selectedIndex=1;
      fillVars(rows[1]);
    }
    const LETTERS='ABCDEF';
    card.querySelector('#der-addterm').addEventListener('click',()=>{
      const n=card.querySelectorAll('.der-term').length;
      if(n>=LETTERS.length) return;
      const holder=document.createElement('div');
      holder.innerHTML=termRowHTML(LETTERS[n]);
      const row=holder.firstChild;
      card.querySelector('#der-terms').appendChild(row);
      wireRow(row);
    });
    card.querySelector('#der-preset').addEventListener('change',e=>{
      if(e.target.value) card.querySelector('#der-formula').value=e.target.value;
    });
    card.querySelector('#der-cancel').addEventListener('click',close);
    back.addEventListener('click',e=>{ if(e.target===back) close(); });
    // Compare A·B: Pearson correlation, mean bias, RMSE — a quick numeric
    // sanity-check before committing to a full derived layer (e.g. "does
    // reanalysis wind agree with my custom field?" without building sqrt(A²+B²)
    // first). Uses the same term/resample machinery as the real computation.
    card.querySelector('#der-compare').addEventListener('click',()=>{
      const statsEl=card.querySelector('#der-stats'), err=card.querySelector('#der-err');
      err.textContent='';
      const rows=[...card.querySelectorAll('.der-term')].slice(0,2);
      if(rows.length<2){ err.textContent='Need at least terms A and B to compare.'; return; }
      const mk=row=>({
        ovId:row.querySelector('.der-ov').value,
        varName:row.querySelector('.der-var').value,
        levIdx:(v=>(v==='mean'||v==='sum')?v:(parseInt(v,10)||0))(row.querySelector('.der-lev').value),
        timeMode:(v=>v==='sync'?'sync':(parseInt(v,10)||0))(row.querySelector('.der-time').value)
      });
      const Ta=mk(rows[0]), Tb=mk(rows[1]);
      const srcA=overlays.find(o=>o.id===Ta.ovId), srcB=overlays.find(o=>o.id===Tb.ovId);
      if(!srcA||!srcB){ err.textContent='Pick both overlays.'; return; }
      const fA=_termFrames(srcA,Ta.varName), fB=_termFrames(srcB,Tb.varName);
      if(!fA.length||!fB.length){ err.textContent='Variable not found in one of the overlays.'; return; }
      const tA=(Ta.timeMode==='sync')?srcA.selTime:(Ta.timeMode|0);
      const tB=(Tb.timeMode==='sync')?srcB.selTime:(Tb.timeMode|0);
      const slA=_decodeTermSlice(fA,tA,Ta.levIdx), slB=_decodeTermSlice(fB,tB,Tb.levIdx);
      if(!slA||!slB){ err.textContent='Could not decode one of the terms.'; return; }
      const dataB=_resampleOntoA(slB,slA);
      let n=0,sa=0,sb=0,saa=0,sbb=0,sab=0,sdiff=0,sdiff2=0;
      for(let k=0;k<slA.data.length;k++){
        const a=slA.data[k], b=dataB[k];
        if(isNaN(a)||isNaN(b)) continue;
        n++; sa+=a; sb+=b; saa+=a*a; sbb+=b*b; sab+=a*b;
        const d=a-b; sdiff+=d; sdiff2+=d*d;
      }
      if(n<4){ statsEl.textContent='Not enough overlapping finite cells to compare.'; return; }
      const ma=sa/n, mb=sb/n;
      const cov=sab/n-ma*mb, va=saa/n-ma*ma, vb=sbb/n-mb*mb;
      const r=(va>0&&vb>0)?cov/Math.sqrt(va*vb):NaN;
      const bias=sdiff/n, rmse=Math.sqrt(sdiff2/n);
      statsEl.textContent='n='+n+' · Pearson r = '+(isNaN(r)?'n/a':r.toFixed(4))+' · mean bias (A−B) = '+bias.toPrecision(4)+' · RMSE = '+rmse.toPrecision(4);
    });
    card.querySelector('#der-create').addEventListener('click',()=>{
      const err=card.querySelector('#der-err');
      const rows=[...card.querySelectorAll('.der-term')];
      const formula=card.querySelector('#der-formula').value.trim();
      // Only include terms actually referenced by the formula — spares the
      // user deleting unused default rows.
      const used=new Set((formula.match(/[A-Za-z_][A-Za-z_0-9]*/g)||[]).filter(id=>id.length===1));
      const terms=[];
      for(const row of rows){
        const id=row.dataset.id;
        if(!used.has(id)) continue;
        terms.push({
          id,
          ovId:row.querySelector('.der-ov').value,
          varName:row.querySelector('.der-var').value,
          levIdx:(v=>(v==='mean'||v==='sum')?v:(parseInt(v,10)||0))(row.querySelector('.der-lev').value),
          timeMode:(v=>v==='sync'?'sync':(parseInt(v,10)||0))(row.querySelector('.der-time').value)
        });
      }
      if(!terms.length){ err.textContent='Formula references no terms.'; return; }
      try{ _compileFormula(formula,terms.map(T=>T.id)); }
      catch(e){ err.textContent=e.message; return; }
      close();
      _createDerivedOverlay(terms,formula);
    });
  }
  // ── Per-cell linear trend map ─────────────────────────────────
  // Ordinary least-squares slope of value vs. frame-index at every grid
  // cell. Supports full-series, equal splits, custom date ranges, and
  // rolling windows — each producing one or more trend frames.
  // Student-t two-tailed 5% critical values, interpolated in 1/df — used by
  // the optional "mask insignificant trends" fit option below.
  const _T05=[[1,12.706],[2,4.303],[3,3.182],[4,2.776],[5,2.571],[6,2.447],[8,2.306],[10,2.228],[15,2.131],[20,2.086],[30,2.042],[60,2.000],[120,1.980]];
  // Two-tailed p-value from a t-statistic — the regularized incomplete
  // beta function via a continued-fraction expansion (the standard
  // Numerical-Recipes routine). _tCrit05 above only answers "significant
  // at the 5% level or not"; the regression p-value MAP needs an actual
  // continuous p per cell, hence this fuller (but still compact) version.
  function _logGamma(x){
    const cof=[76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];
    let y=x,tmp=x+5.5; tmp-=(x+0.5)*Math.log(tmp);
    let ser=1.000000000190015;
    for(let j=0;j<6;j++){y+=1;ser+=cof[j]/y;}
    return -tmp+Math.log(2.5066282746310005*ser/x);
  }
  function _betacf(a,b,x){
    const MAXIT=100,EPS=3e-7,FPMIN=1e-30;
    const qab=a+b,qap=a+1,qam=a-1;
    let c=1,d=1-qab*x/qap;
    if(Math.abs(d)<FPMIN)d=FPMIN;
    d=1/d; let h=d;
    for(let m=1;m<=MAXIT;m++){
      const m2=2*m;
      let aa=m*(b-m)*x/((qam+m2)*(a+m2));
      d=1+aa*d; if(Math.abs(d)<FPMIN)d=FPMIN;
      c=1+aa/c; if(Math.abs(c)<FPMIN)c=FPMIN;
      d=1/d; h*=d*c;
      aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));
      d=1+aa*d; if(Math.abs(d)<FPMIN)d=FPMIN;
      c=1+aa/c; if(Math.abs(c)<FPMIN)c=FPMIN;
      d=1/d; const del=d*c; h*=del;
      if(Math.abs(del-1)<EPS)break;
    }
    return h;
  }
  function _betai(a,b,x){
    if(x<=0)return 0; if(x>=1)return 1;
    const bt=Math.exp(_logGamma(a+b)-_logGamma(a)-_logGamma(b)+a*Math.log(x)+b*Math.log(1-x));
    if(x<(a+1)/(a+b+2)) return bt*_betacf(a,b,x)/a;
    return 1-bt*_betacf(b,a,1-x)/b;
  }
  function _tTestPValue(t,df){
    if(!isFinite(t)||df<=0) return NaN;
    const x=df/(df+t*t);
    return _betai(df/2,0.5,x);
  }
  function _tCrit05(df){
    if(df<=1) return 12.706;
    if(df>=120) return 1.96;
    for(let i=1;i<_T05.length;i++){
      if(df<=_T05[i][0]){
        const d0=_T05[i-1][0],c0=_T05[i-1][1],d1=_T05[i][0],c1=_T05[i][1];
        const f=(1/df-1/d0)/((1/d1)-(1/d0));
        return c0+(c1-c0)*f;
      }
    }
    return 1.96;
  }
  function _medianGapDays(sks){
    if(sks.length<2) return null;
    const gaps=[];
    for(let i=1;i<sks.length;i++) gaps.push(sks[i]-sks[i-1]);
    gaps.sort((a,b)=>a-b);
    return gaps[Math.floor(gaps.length/2)];
  }
  // Human-readable label for the SOURCE data's time spacing, derived from
  // the median gap between consecutive frame timestamps (in days). Shown
  // up front in the trend dialog and folded into the fitted layer's units
  // string, so the reported rate's basis is never a mystery.
  function _cadenceLabel(sks){
    const med=_medianGapDays(sks);
    if(med==null) return '';
    if(med<0.06) return '~'+Math.round(med*1440)+'-min steps';
    if(med<0.9) return '~'+(med*24).toFixed(med*24<3?1:0)+'-hourly steps';
    if(med<1.5) return 'daily steps';
    if(med<6.5) return '~'+Math.round(med)+'-day steps';
    if(med<10.5) return 'weekly steps';
    if(med<20) return '~2-week steps';
    if(med<45) return 'monthly steps';
    if(med<100) return 'quarterly steps';
    if(med<250) return 'seasonal (multi-month) steps';
    return '~'+(Math.round(med/365.25*10)/10)+'-year steps';
  }
  // Which unit to REPORT trend slopes in, given the source data's own
  // cadence — replacing an earlier design that always annualized. Always
  // converting to "per year" reads as a much bigger stretch for a slope
  // fit from, say, 2 weeks of daily frames: multiplying a rate observed
  // over 14 days by 26 to get an annual figure implicitly assumes the
  // trend holds linearly for a full year, which the data has said
  // nothing about. Reporting in the data's own native step size (day,
  // month, or year) keeps the number honestly scoped to what was
  // actually observed, per user feedback. sub-daily/daily/weekly/~2-week
  // all collapse to "day" (a week-old wobble reported "per week" reads
  // stranger than "per day"); quarterly/seasonal collapse to "year"
  // since a handful-of-quarters fit is already approaching annual scale
  // and "per quarter" is not a common unit for anyone to reason about.
  function _nativeTrendUnit(medianDays){
    if(medianDays==null) return {label:'frame',days:null};
    if(medianDays<20) return {label:'day',days:1};
    if(medianDays<200) return {label:'month',days:30.4375};
    return {label:'year',days:365.25};
  }
  async function _fitTrendSlice(ov, t0, t1, opts){
    opts=opts||{};
    const probe=_cacheGet(ov,t0);
    if(!probe) return null;
    const rs0=probe.renderSlice;
    const srcUnits=probe.activeSlice?.units||'';
    const N=rs0.nLat*rs0.nLon;
    const n=t1-t0+1;
    // X axis: real time in YEARS when frames carry timestamps (sortKey is
    // days-since-epoch for dated files — always a large number, vs the
    // bare 0..n-1 index fallback), else frame index. Real time makes the
    // fit robust to irregular spacing (missing months, mixed cadences)
    // and yields physically meaningful "<units> per year" slopes.
    const sks=[];
    let dated=true;
    for(let t=t0;t<=t1;t++){
      const sk=ov.frames[t]?.sortKey;
      if(typeof sk!=='number'||!isFinite(sk)){ dated=false; break; }
      sks.push(sk);
    }
    if(dated){
      let mx=-Infinity,inc=true;
      for(let i=0;i<sks.length;i++){ if(sks[i]>mx) mx=sks[i]; else inc=false; }
      // Distinguishing real dates from a bare frame-index fallback
      // (0,1,2,…, which is ALSO monotonic) used to compare the raw
      // sortKey magnitude against the fit-window size (mx<=n*10) — but
      // that conflates two unrelated things: a large fit window (many
      // frames, big n) could push n*10 past a perfectly legitimate but
      // numerically modest sortKey (e.g. a file dated relative to a
      // recent epoch), silently discarding real daily/monthly cadence
      // and falling back to "per frame". buildFrames already determined
      // this exactly once, when it built each frame's label: a real date
      // always starts "YYYY-MM-DD" (see buildFrames/_gribFrameLabel);
      // the bare-index fallback label is "Step N". Reusing that instead
      // of re-guessing from sortKey's magnitude is exact for any window
      // size or date convention.
      const looksDated=/^\d{4}-\d{2}-\d{2}/.test(String(ov.frames[t0]?.label||''));
      if(!inc||!looksDated) dated=false;
    }
    const xs=new Float64Array(n);
    for(let i=0;i<n;i++) xs[i]=dated?(sks[i]-sks[0])/365.25:i;
    const sumX=new Float64Array(N),sumY=new Float64Array(N),sumXY=new Float64Array(N),
          sumX2=new Float64Array(N),sumY2=new Float64Array(N),cnt=new Int32Array(N);
    for(let t=t0;t<=t1;t++){
      const fr=_cacheGet(ov,t); if(!fr) continue;
      const d=fr.renderSlice.data;
      const x=xs[t-t0];
      for(let k=0;k<N;k++){
        const v=d[k]; if(isNaN(v)) continue;
        sumX[k]+=x; sumY[k]+=v; sumXY[k]+=x*v; sumX2[k]+=x*x; sumY2[k]+=v*v; cnt[k]++;
      }
      // Yield every few frames so long fits (especially derived layers,
      // which compute their field per timestep) don't freeze the page.
      if(((t-t0)&7)===7){
        if(opts.onProgress) opts.onProgress(t-t0+1,n);
        await new Promise(r=>setTimeout(r,0));
      }
    }
    // Report the fit in the data's own native cadence (day/month/year)
    // rather than always annualizing — see _nativeTrendUnit. The fit
    // itself still runs against real elapsed YEARS internally (xs above),
    // which is what makes it robust to irregular spacing; only the final
    // scale factor changes, converting "per year" to "per <native unit>".
    const cadence=dated?_cadenceLabel(sks):'';
    const unit=dated?_nativeTrendUnit(_medianGapDays(sks)):{label:'frame',days:null};
    const unitScale=(dated&&unit.days)?(unit.days/365.25):1;
    const slope=new Float32Array(N);
    for(let k=0;k<N;k++){
      const c=cnt[k];
      if(c<3){ slope[k]=NaN; continue; }
      const varX=c*sumX2[k]-sumX[k]*sumX[k];
      if(Math.abs(varX)<1e-9){ slope[k]=NaN; continue; }
      const covXY=c*sumXY[k]-sumX[k]*sumY[k];
      slope[k]=(covXY/varX)*unitScale;
      if(opts.sig){
        // Two-tailed t-test on the correlation (equivalent to testing the
        // OLS slope against zero): mask cells not significant at p<0.05.
        // Unaffected by unitScale — r² is scale-invariant.
        const varY=c*sumY2[k]-sumY[k]*sumY[k];
        const r2=(varY>1e-12)?(covXY*covXY)/(varX*varY):0;
        const df=c-2;
        const t2=r2>=1?Infinity:r2*df/(1-r2);
        const tc=_tCrit05(df);
        if(t2<tc*tc) slope[k]=NaN;
      }
    }
    return {data:slope,nLat:rs0.nLat,nLon:rs0.nLon,lats:rs0.lats,lons:rs0.lons,n,
            xUnits:dated?('per '+unit.label):'per frame',srcUnits,cadence};
  }
  function _frameLabel(ov,i){
    const f=ov.frames[i];
    return f&&(f.label||('frame '+i))||('frame '+i);
  }
  function _buildTrendOverlay(ov, slices, titlePrefix){
    const nv=createOverlay();
    if(!nv) return null;
    nv._trend={srcId:ov.id,frames:slices,nLat:slices[0].nLat,nLon:slices[0].nLon,
      lats:slices[0].lats,lons:slices[0].lons};
    nv.name=titlePrefix||('Trend: '+(ov.name||ov.selVar||'layer'));
    nv.selVar='trend';
    nv.varOptions=[{name:'trend',label:nv.name}];
    nv.selCmap='RdBu';
    nv.frames=slices.map((s,i)=>({label:s.label||('slice '+i),localT:i,virtual:true,trendSlice:i,sortKey:i}));
    // maxTime is a COUNT here (matches every regular file-loaded overlay,
    // e.g. appendFileToOverlay's ov.maxTime=ov.frames.length) — NOT the max
    // valid index. updateTimeControls's slider bound is sl.max=maxTime-1,
    // derived from the count convention; this used to store frames.length-1
    // (the index) instead, so that line subtracted 1 a SECOND time and the
    // very last split/frame became permanently unreachable from the ◀/▶
    // buttons and slider — "computed 5 splits, only 4 ever showed up".
    nv.maxTime=nv.frames.length;
    nv.selTime=0;
    nv._fcache=new Map();
    rebuildSlice(nv);
    if(nv.cardEl){
      refreshCardVarPicker(nv);
      const body=nv.cardEl.querySelector('.nc-cb'); if(body) body.style.display='';
      const sw=nv.cardEl.querySelector('.nc-series-wrap'); if(sw) sw.style.display='none';
      const db=nv.cardEl.querySelector('.nc-drop-btn'); if(db) db.style.display='none';
      const badge=nv.cardEl.querySelector('.nc-cname');
      if(badge){ badge.textContent='📈 '+nv.name; badge.classList.remove('nc-empty'); }
      const cmSel=nv.cardEl.querySelector('.nc-cm'); if(cmSel){ cmSel.value=nv.selCmap; updateCmapPrev(nv); }
      updateTimeControls(nv);
    }
    renumberCards(); schedRender(nv);
    document.getElementById('nc-body').style.display='';
    document.getElementById('nc-tog').textContent='▾';
    return nv;
  }
  async function _computeTrendMap(ov, spec){
    spec=spec||{mode:'full'};
    const n=ov.frames.length;
    if(n<3){ alert('Need at least 3 time frames to fit a trend.'); return; }
    const slices=[];
    const fitOpts={sig:!!spec.sig,onProgress:(i,nn)=>_hintTrend('Fitting trend '+Math.round(i/nn*100)+'%…')};
    if(spec.mode==='full'){
      _hintTrend('Fitting trend 0%…');
      const sl=await _fitTrendSlice(ov,0,n-1,fitOpts);
      _hintTrend(null);
      if(!sl){ alert('Could not compute trend.'); return; }
      sl.label='Full series ('+n+' frames)';
      slices.push(sl);
    } else if(spec.mode==='splits'){
      const parts=Math.max(2,Math.min(n-2,Math.round(+spec.parts)||2));
      const chunk=Math.floor(n/parts);
      for(let p=0;p<parts;p++){
        const t0=p*chunk, t1=p===parts-1?n-1:Math.min(n-1,(p+1)*chunk-1);
        if(t1-t0<2) continue;
        _hintTrend('Fitting split '+(p+1)+'/'+parts+'…');
        await new Promise(r=>setTimeout(r,0));
        const sl=await _fitTrendSlice(ov,t0,t1,{sig:!!spec.sig});
        if(!sl) continue;
        sl.label='Split '+(p+1)+': '+_frameLabel(ov,t0)+' → '+_frameLabel(ov,t1)+' ('+(t1-t0+1)+' fr)';
        sl.t0=t0; sl.t1=t1;
        slices.push(sl);
      }
      _hintTrend(null);
    } else if(spec.mode==='range'){
      const ranges=Array.isArray(spec.ranges)&&spec.ranges.length
        ?spec.ranges
        :[{t0:spec.t0,t1:spec.t1}];
      for(let ri=0;ri<ranges.length;ri++){
        const t0=Math.max(0,Math.min(n-1,Math.round(+ranges[ri].t0)||0));
        const t1=Math.max(t0+2,Math.min(n-1,Math.round(+ranges[ri].t1)||n-1));
        _hintTrend('Fitting range '+(ri+1)+'/'+ranges.length+'…');
        await new Promise(r=>setTimeout(r,0));
        const sl=await _fitTrendSlice(ov,t0,t1,{sig:!!spec.sig});
        if(!sl) continue;
        sl.label='Range '+(ri+1)+': '+_frameLabel(ov,t0)+' → '+_frameLabel(ov,t1);
        sl.t0=t0; sl.t1=t1;
        slices.push(sl);
      }
      _hintTrend(null);
    } else if(spec.mode==='rolling'){
      const win=Math.max(3,Math.min(n,Math.round(+spec.window)||12));
      const step=Math.max(1,Math.round(+spec.step)||1);
      const starts=[];
      for(let t0=0;t0+win<=n;t0+=step) starts.push(t0);
      // The stepped loop above can stop short of a window ending at the
      // MOST RECENT frame whenever step doesn't evenly divide (n-win) —
      // e.g. n=100,win=12,step=7 stops at t0=84 (ending 12 frames before
      // the series end) and never reaches t0=88, silently dropping the
      // one window most people actually open a rolling trend for: the
      // latest. Appending it explicitly (skipped if the loop already
      // landed there) costs at most one extra fit and never removes any
      // of the regularly-spaced windows already computed.
      const lastStart=n-win;
      if(!starts.length||starts[starts.length-1]!==lastStart) starts.push(lastStart);
      let idx=0;
      for(const t0 of starts){
        const t1=t0+win-1;
        _hintTrend('Rolling window '+(++idx)+'/'+starts.length+'…');
        await new Promise(r=>setTimeout(r,0));
        const sl=await _fitTrendSlice(ov,t0,t1,{sig:!!spec.sig});
        if(!sl) continue;
        sl.label='Roll '+_frameLabel(ov,t0)+' → '+_frameLabel(ov,t1)+' (w='+win+')';
        sl.t0=t0; sl.t1=t1;
        slices.push(sl);
      }
      _hintTrend(null);
      if(!slices.length){ alert('Rolling window larger than series or too few frames.'); return; }
    }
    if(!slices.length){ alert('No trend slices could be computed.'); return; }
    const prefix='Trend'+(slices.length>1?' ('+slices.length+' frames)':'')+': '+(ov.name||ov.selVar||'layer');
    _buildTrendOverlay(ov,slices,prefix);
    console.log('[trend]',slices.length,'slice(s) for',ov.name);
  }
  function _openTrendDialog(ov){
    if(!ov.frames||ov.frames.length<3){ alert('Need at least 3 time frames to fit a trend.'); return; }
    document.querySelectorAll('.nc-trend-dlg').forEach(d=>d.remove());
    const n=ov.frames.length;
    const dlg=document.createElement('div');
    dlg.className='nc-trend-dlg';
    dlg.style.cssText='position:fixed;inset:0;z-index:500;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);';
    const box=document.createElement('div');
    box.style.cssText='background:rgba(6,17,28,0.98);border:1px solid rgba(127,208,255,0.4);border-radius:10px;padding:16px 18px;max-width:480px;width:92%;font-family:IBM Plex Mono,monospace;font-size:11px;color:#cfe3f2;box-shadow:0 12px 40px rgba(0,0,0,0.5);';
    const opts=[
      {id:'full',label:'Full series',desc:'One trend map across all '+n+' loaded frames'},
      {id:'splits',label:'Equal splits',desc:'Divide the series into N contiguous chunks, one trend per chunk'},
      {id:'range',label:'Custom date ranges',desc:'Define one or more start/end periods — one trend map per range'},
      {id:'rolling',label:'Rolling window',desc:'Slide a fixed-length window across the series'}
    ];
    // Detected cadence, shown UP FRONT before the user commits to a fit —
    // the reported slope's unit now MATCHES this cadence (per day for
    // daily/weekly data, per month for month-ish spacing, per year once
    // frames are that far apart), rather than always annualizing — see
    // _nativeTrendUnit for why. Still worth stating plainly up front
    // rather than leaving the user to notice the unit only after fitting.
    const _dlgSks=ov.frames.map(f=>f.sortKey).filter(sk=>typeof sk==='number'&&isFinite(sk));
    const _dlgDated=_dlgSks.length===ov.frames.length&&_dlgSks.length>1&&
      _dlgSks.every((v,i)=>i===0||v>_dlgSks[i-1])&&_dlgSks[_dlgSks.length-1]>n*10;
    const _dlgUnit=_dlgDated?_nativeTrendUnit(_medianGapDays(_dlgSks)):null;
    const cadenceNote=_dlgDated
      ? 'Detected source spacing: <b style="color:#eaf3fb">'+_cadenceLabel(_dlgSks)+'</b> · fitted slopes will read <b style="color:#eaf3fb">per '+_dlgUnit.label.toUpperCase()+'</b> — matched to this spacing (real elapsed time, not frame count), not forced to a yearly rate.'
      : '<span style="color:#ffb870">No usable dates found on these frames</span> — fitted slopes will read <b style="color:#eaf3fb">per FRAME-STEP</b>, not real time. If this file has a time coordinate, that should have been picked up automatically; treat the slope as relative (frame-to-frame).';
    box.innerHTML='<div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#eaf3fb;">📈 Trend analysis</div>'+
      '<div style="font-size:9.5px;color:#7fa0b8;margin-bottom:8px;line-height:1.45;">Each option creates one or more trend frames you can scrub, plot, extract regions from, and export.</div>'+
      '<div style="font-size:9.5px;color:#9fc4dd;margin-bottom:12px;line-height:1.5;padding:8px 10px;border-radius:6px;background:rgba(127,208,255,0.06);border:1px solid rgba(127,208,255,0.18);">'+cadenceNote+'</div>'+
      opts.map(o=>'<label style="display:block;margin-bottom:8px;cursor:pointer;padding:8px;border-radius:6px;border:1px solid rgba(120,170,205,0.2);background:rgba(10,24,40,0.5);">'+
        '<input type="radio" name="trend-mode" value="'+o.id+'" '+(o.id==='full'?'checked':'')+' style="margin-right:8px;accent-color:#7fd0ff;">'+
        '<span style="font-weight:600;">'+o.label+'</span><br><span style="font-size:9px;color:#7fa0b8;margin-left:22px;">'+o.desc+'</span></label>').join('')+
      '<div id="trend-params" style="margin:10px 0 12px;padding:10px;border-radius:6px;background:rgba(0,0,0,0.2);border:1px solid rgba(120,170,205,0.15);"></div>'+
      '<label style="display:block;margin:0 0 12px;font-size:10px;cursor:pointer;color:#9fc4dd;">'+
        '<input type="checkbox" id="trend-sig" style="margin-right:7px;accent-color:#7fd0ff;">'+
        'Mask insignificant cells (two-tailed t-test on the slope, p ≥ 0.05 → transparent)</label>'+
      '<div style="display:flex;gap:8px;justify-content:flex-end;">'+
        '<button type="button" id="trend-cancel" style="padding:6px 12px;border-radius:5px;border:1px solid rgba(120,170,205,0.3);background:transparent;color:#9fb6c9;cursor:pointer;">Cancel</button>'+
        '<button type="button" id="trend-run" style="padding:6px 14px;border-radius:5px;border:none;background:#7fd0ff;color:#050d16;font-weight:600;cursor:pointer;">Compute</button></div>';
    dlg.appendChild(box);
    document.body.appendChild(dlg);
    const params=box.querySelector('#trend-params');
    const frameOpts=()=>ov.frames.map((f,i)=>'<option value="'+i+'">'+_frameLabel(ov,i)+'</option>').join('');
    const rangeFieldStyle='width:100%;margin-top:4px;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;';
    function syncRangeRows(){
      const cnt=Math.max(1,Math.min(12,+(params.querySelector('#trend-range-count')?.value||1)));
      const list=params.querySelector('#trend-range-list');
      if(!list) return;
      const saved=[];
      list.querySelectorAll('.trend-range-row').forEach((row,i)=>{
        saved[i]={t0:row.querySelector('.trend-r-t0')?.value,t1:row.querySelector('.trend-r-t1')?.value};
      });
      list.innerHTML='';
      const opts2=frameOpts();
      for(let i=0;i<cnt;i++){
        const row=document.createElement('div');
        row.className='trend-range-row';
        row.style.cssText='margin-bottom:8px;padding:8px;border-radius:6px;background:rgba(10,24,40,0.45);border:1px solid rgba(120,170,205,0.15);';
        row.innerHTML=
          '<div style="font-size:9.5px;font-weight:600;color:#9fc4dd;margin-bottom:6px;">Range '+(i+1)+'</div>'+
          '<label style="display:block;margin-bottom:4px;font-size:9.5px;">Start<select class="trend-r-t0" style="'+rangeFieldStyle+'">'+opts2+'</select></label>'+
          '<label style="display:block;font-size:9.5px;">End<select class="trend-r-t1" style="'+rangeFieldStyle+'">'+opts2+'</select></label>';
        const t0=row.querySelector('.trend-r-t0'), t1=row.querySelector('.trend-r-t1');
        if(saved[i]){
          t0.value=saved[i].t0??'0';
          t1.value=saved[i].t1??String(n-1);
        } else {
          const chunk=Math.max(1,Math.floor(n/cnt));
          t0.value=String(Math.min(n-1,i*chunk));
          t1.value=String(i===cnt-1?n-1:Math.min(n-1,(i+1)*chunk-1));
        }
        list.appendChild(row);
      }
    }
    function syncParams(){
      const mode=box.querySelector('input[name="trend-mode"]:checked')?.value||'full';
      if(mode==='splits'){
        params.innerHTML='<label style="display:block;margin-bottom:6px;">Number of splits<input type="number" id="trend-parts" min="2" max="'+Math.min(n,24)+'" value="'+Math.min(4,Math.max(2,Math.floor(n/3)))+'" style="width:100%;margin-top:4px;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;"></label>';
      } else if(mode==='range'){
        params.innerHTML=
          '<label style="display:block;margin-bottom:8px;">Number of date ranges<input type="number" id="trend-range-count" min="1" max="12" value="3" style="width:100%;margin-top:4px;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;"></label>'+
          '<div id="trend-range-list" style="max-height:220px;overflow-y:auto;"></div>';
        params.querySelector('#trend-range-count').addEventListener('input',syncRangeRows);
        syncRangeRows();
      } else if(mode==='rolling'){
        params.innerHTML=
          '<label style="display:block;margin-bottom:6px;">Window size (frames)<input type="number" id="trend-win" min="3" max="'+n+'" value="'+Math.min(12,Math.max(3,Math.floor(n/4)))+'" style="width:100%;margin-top:4px;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;"></label>'+
          '<label style="display:block;">Step (frames)<input type="number" id="trend-step" min="1" max="'+n+'" value="1" style="width:100%;margin-top:4px;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;"></label>';
      } else params.innerHTML='<span style="font-size:9.5px;color:#7fa0b8;">Uses all '+n+' frames as one period.</span>';
    }
    box.querySelectorAll('input[name="trend-mode"]').forEach(r=>r.addEventListener('change',syncParams));
    syncParams();
    const close=()=>dlg.remove();
    box.querySelector('#trend-cancel').addEventListener('click',close);
    // Close only when BOTH the press and the release land on the bare
    // backdrop — a plain 'click' check alone also fires when a drag that
    // starts on a text field inside the dialog (e.g. selecting/highlighting
    // a lag number by dragging) happens to release outside that field,
    // since the resulting click's target is wherever the mouse came up,
    // not where the drag began.
    let _backdropDown=false;
    dlg.addEventListener('mousedown',e=>{ _backdropDown=(e.target===dlg); });
    dlg.addEventListener('click',e=>{ if(e.target===dlg&&_backdropDown) close(); });
    box.querySelector('#trend-run').addEventListener('click',async()=>{
      const mode=box.querySelector('input[name="trend-mode"]:checked')?.value||'full';
      const spec={mode,sig:!!box.querySelector('#trend-sig')?.checked};
      if(mode==='splits') spec.parts=+(box.querySelector('#trend-parts')?.value||2);
      if(mode==='range'){
        const rows=box.querySelectorAll('.trend-range-row');
        spec.ranges=[];
        rows.forEach(row=>{
          spec.ranges.push({
            t0:+(row.querySelector('.trend-r-t0')?.value||0),
            t1:+(row.querySelector('.trend-r-t1')?.value||n-1),
          });
        });
        if(!spec.ranges.length) spec.ranges=[{t0:0,t1:n-1}];
      }
      if(mode==='rolling'){
        spec.window=+(box.querySelector('#trend-win')?.value||12);
        spec.step=+(box.querySelector('#trend-step')?.value||1);
      }
      close();
      await _computeTrendMap(ov,spec);
    });
  }
  function _hintTrend(msg){
    let el=document.getElementById('gp-trend-hint');
    if(!msg){ if(el) el.remove(); return; }
    if(!el){
      el=document.createElement('div'); el.id='gp-trend-hint';
      el.style.cssText='position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:400;'+
        'background:rgba(6,14,22,0.9);border:1px solid rgba(127,208,255,0.35);border-radius:6px;'+
        'padding:5px 12px;font-family:IBM Plex Mono,monospace;font-size:10.5px;color:#cfe3f2;';
      document.body.appendChild(el);
    }
    el.textContent=msg;
  }

  /* ============================================================ CORRELATION / TELECONNECTION MAPS
     Click a reference point on any loaded field, then correlate that
     point's time series (optionally lagged) against every cell of a
     target field — the same field (self-teleconnection, e.g. an ENSO-SST
     map) or a different one (e.g. an SST index vs. a precipitation
     field). Mirrors the trend-analysis pipeline above almost exactly:
     _fitTrendSlice/_computeTrendMap/_buildTrendOverlay have direct
     analogues here, producing the same kind of virtual-frame result
     overlay — except "frame" = one lag value instead of one time window,
     so the existing scrub/animate transport doubles as the lag slider
     the correlation-map / lag-correlation request asked for, for free. */
  async function _extractPointSeries(ov,lon,lat){
    const n=ov.frames.length;
    const sortKeys=[],values=[];
    for(let t=0;t<n;t++){
      const fr=_cacheGet(ov,t); if(!fr) continue;
      const rs=fr.renderSlice;
      const v=sampleAt(lon,lat,rs,rs.lats,rs.lons);
      if(isNaN(v)) continue;
      const sk=ov.frames[t]?.sortKey;
      sortKeys.push(typeof sk==='number'&&isFinite(sk)?sk:t);
      values.push(v);
      if((t&15)===15) await new Promise(r=>setTimeout(r,0));
    }
    // "Dated" here means every frame (not just the ones with a valid
    // sample at this point) carries a real calendar sortKey — same test
    // _fitTrendSlice uses, applied to the full frame list rather than the
    // filtered series, since a few NaN/land-masked samples shouldn't
    // disqualify an otherwise perfectly dated file from lag correlation.
    const allSks=ov.frames.map(f=>f.sortKey).filter(sk=>typeof sk==='number'&&isFinite(sk));
    const looksDated=/^\d{4}-\d{2}-\d{2}/.test(String(ov.frames[0]?.label||''));
    const dated=looksDated&&allSks.length===n&&allSks.length>1&&allSks.every((v,i)=>i===0||v>allSks[i-1]);
    return {sortKeys,values,dated,ovName:ov.name||ov.selVar||'layer'};
  }
  // Linear-interpolate a time series at an arbitrary query time (real
  // days-since-epoch when the series is dated). Clamps at the ends
  // rather than extrapolating — a lag that pushes past either end of the
  // reference series just holds the nearest edge value.
  function _interpAtTime(series,tq){
    const sk=series.sortKeys,v=series.values,m=sk.length;
    if(!m) return null;
    // Outside the reference series' actual date coverage — don't clamp to
    // an edge value (that would silently pair, say, a 2020 target frame
    // with a 1854 index value just because 1854 is the first one on file).
    // Callers already skip null/NaN matches, so this correctly restricts
    // matching to the real overlap period between the two datasets.
    if(tq<sk[0]||tq>sk[m-1]) return null;
    let lo=0,hi=m-1;
    while(hi-lo>1){ const mid=(lo+hi)>>1; if(sk[mid]<=tq) lo=mid; else hi=mid; }
    const t0=sk[lo],t1=sk[hi];
    const f=(t1>t0)?(tq-t0)/(t1-t0):0;
    return v[lo]*(1-f)+v[hi]*f;
  }
  async function _fitCorrelationSlice(targetOv,refSeries,lagOffsetDays,opts,bothDated){
    opts=opts||{};
    const probe=_cacheGet(targetOv,0);
    if(!probe) return null;
    const rs0=probe.renderSlice;
    const N=rs0.nLat*rs0.nLon;
    const n=targetOv.frames.length;
    const stride=Math.max(1,opts.stride||1);
    let matched=0;
    const sumX=new Float64Array(N),sumY=new Float64Array(N),sumXY=new Float64Array(N),
          sumX2=new Float64Array(N),sumY2=new Float64Array(N),cnt=new Int32Array(N);
    for(let t=0;t<n;t+=stride){
      const fr=_cacheGet(targetOv,t); if(!fr) continue;
      let xv;
      if(bothDated){
        const tsk=targetOv.frames[t]?.sortKey;
        if(typeof tsk!=='number'||!isFinite(tsk)) continue;
        xv=_interpAtTime(refSeries,tsk-lagOffsetDays);
      } else {
        // No reliable real-date alignment on one or both sides — fall
        // back to matching by frame POSITION (the t-th target frame vs.
        // the t-th valid reference sample). Lag is meaningless here
        // (there's no real time axis to shift along), so callers only
        // reach this path with lagOffsetDays effectively 0.
        xv=t<refSeries.values.length?refSeries.values[t]:null;
      }
      if(xv==null||isNaN(xv)) continue;
      matched++;
      const d=fr.renderSlice.data;
      for(let k=0;k<N;k++){
        const yv=d[k]; if(isNaN(yv)) continue;
        sumX[k]+=xv; sumY[k]+=yv; sumXY[k]+=xv*yv; sumX2[k]+=xv*xv; sumY2[k]+=yv*yv; cnt[k]++;
      }
      if((Math.floor(t/stride)&7)===7){ if(opts.onProgress) opts.onProgress(t+1,n); await new Promise(r=>setTimeout(r,0)); }
    }
    const r=new Float32Array(N);
    for(let k=0;k<N;k++){
      const c=cnt[k];
      if(c<3){ r[k]=NaN; continue; }
      const varX=c*sumX2[k]-sumX[k]*sumX[k];
      const varY=c*sumY2[k]-sumY[k]*sumY[k];
      if(varX<=1e-9||varY<=1e-9){ r[k]=NaN; continue; }
      const covXY=c*sumXY[k]-sumX[k]*sumY[k];
      let rr=Math.max(-1,Math.min(1,covXY/Math.sqrt(varX*varY)));
      if(opts.sig){
        // Two-tailed t-test on r itself (equivalent to the slope test in
        // _fitTrendSlice — r² is the same quantity either way).
        const r2=rr*rr, df=c-2;
        const t2=r2>=1?Infinity:r2*df/(1-r2);
        const tc=_tCrit05(df);
        if(t2<tc*tc){ r[k]=NaN; continue; }
      }
      r[k]=rr;
    }
    return {data:r,nLat:rs0.nLat,nLon:rs0.nLon,lats:rs0.lats,lons:rs0.lons,n,matchedN:matched,stride};
  }
  function _fmtLL(lon,lat){
    return (lat>=0?lat.toFixed(1)+'°N':(-lat).toFixed(1)+'°S')+' '+(lon>=0?lon.toFixed(1)+'°E':(-lon).toFixed(1)+'°W');
  }
  async function _computeCorrelationMap(refOv,lon,lat,targetOv,spec){
    if(!targetOv.frames||targetOv.frames.length<3){ alert('Target layer needs at least 3 time frames.'); return; }
    _hintTrend('Sampling reference series…');
    const refSeries=await _extractPointSeries(refOv,lon,lat);
    if(!refSeries.values.length){ _hintTrend(null); alert('No data at that point in the reference layer.'); return; }
    if(refSeries.values.length<3){ _hintTrend(null); alert('Reference series has fewer than 3 valid time steps at that point.'); return; }
    const tgtSks=targetOv.frames.map(f=>f.sortKey).filter(sk=>typeof sk==='number'&&isFinite(sk));
    const tgtLooksDated=/^\d{4}-\d{2}-\d{2}/.test(String(targetOv.frames[0]?.label||''));
    const targetDated=tgtLooksDated&&tgtSks.length===targetOv.frames.length&&tgtSks.length>1&&tgtSks.every((v,i)=>i===0||v>tgtSks[i-1]);
    const bothDated=refSeries.dated&&targetDated;
    const lags=bothDated?(spec.lags||[0]):[0];
    if(!bothDated&&spec.lags&&spec.lags.length>1){
      console.warn('[correlation] target layer lacks usable real dates — lag disabled, computing a single frame-position-aligned correlation instead');
    }
    const slices=[];
    for(let i=0;i<lags.length;i++){
      const lag=lags[i];
      _hintTrend(lags.length>1?('Correlating lag '+(i+1)+'/'+lags.length+'…'):'Correlating…');
      await new Promise(r=>setTimeout(r,0));
      const sl=await _fitCorrelationSlice(targetOv,refSeries,lag*(spec.unitDays||0),{sig:!!spec.sig,stride:spec.stride},bothDated);
      if(!sl) continue;
      sl.label=lags.length>1?('Lag '+(lag>0?'+':'')+lag+' '+(spec.unitLabel||'')):(bothDated?'r (zero lag)':'r (frame-aligned, no dates)');
      sl.lag=lag;
      slices.push(sl);
    }
    _hintTrend(null);
    if(!slices.length){ alert('No correlation slices could be computed.'); return; }
    const prefix='Corr: '+refSeries.ovName+' @ '+_fmtLL(lon,lat)+' ↔ '+(targetOv.name||targetOv.selVar||'layer');
    _buildCorrelationOverlay(targetOv,slices,prefix);
    console.log('[correlation]',slices.length,'lag slice(s) for',prefix);
  }
  function _buildCorrelationOverlay(targetOv,slices,titlePrefix){
    const nv=createOverlay();
    if(!nv) return null;
    nv._corr={srcId:targetOv.id,frames:slices,nLat:slices[0].nLat,nLon:slices[0].nLon,
      lats:slices[0].lats,lons:slices[0].lons};
    nv.name=titlePrefix||('Correlation: '+(targetOv.name||targetOv.selVar||'layer'));
    nv.selVar='correlation';
    nv.varOptions=[{name:'correlation',label:nv.name}];
    nv.selCmap='RdBu';
    nv.frames=slices.map((s,i)=>({label:s.label||('lag '+i),localT:i,virtual:true,corrSlice:i,sortKey:i}));
    nv.maxTime=nv.frames.length;
    const zeroIdx=slices.findIndex(s=>s.lag===0);
    nv.selTime=zeroIdx>=0?zeroIdx:0;
    nv._fcache=new Map();
    rebuildSlice(nv);
    if(nv.cardEl){
      refreshCardVarPicker(nv);
      const body=nv.cardEl.querySelector('.nc-cb'); if(body) body.style.display='';
      const sw=nv.cardEl.querySelector('.nc-series-wrap'); if(sw) sw.style.display='none';
      const db=nv.cardEl.querySelector('.nc-drop-btn'); if(db) db.style.display='none';
      const badge=nv.cardEl.querySelector('.nc-cname');
      if(badge){ badge.textContent='🔗 '+nv.name; badge.classList.remove('nc-empty'); }
      const cmSel=nv.cardEl.querySelector('.nc-cm'); if(cmSel){ cmSel.value=nv.selCmap; updateCmapPrev(nv); }
      updateTimeControls(nv);
    }
    renumberCards(); schedRender(nv);
    document.getElementById('nc-body').style.display='';
    document.getElementById('nc-tog').textContent='▾';
    return nv;
  }
  function _openCorrelationDialog(ov,lon,lat){
    document.querySelectorAll('.nc-corr-dlg').forEach(d=>d.remove());
    const targets=overlays.filter(o=>o.frames&&o.frames.length>=3);
    if(!targets.length){ alert('No loaded layer with 3+ time frames to correlate against.'); return; }
    const dlg=document.createElement('div');
    dlg.className='nc-corr-dlg';
    dlg.style.cssText='position:fixed;inset:0;z-index:500;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);';
    const box=document.createElement('div');
    box.style.cssText='background:rgba(6,17,28,0.98);border:1px solid rgba(127,208,255,0.4);border-radius:10px;padding:16px 18px;max-width:460px;width:92%;font-family:IBM Plex Mono,monospace;font-size:11px;color:#cfe3f2;box-shadow:0 12px 40px rgba(0,0,0,0.5);';
    const sks=ov.frames.map(f=>f.sortKey).filter(sk=>typeof sk==='number'&&isFinite(sk));
    const looksDated=/^\d{4}-\d{2}-\d{2}/.test(String(ov.frames[0]?.label||''));
    const dated=looksDated&&sks.length===ov.frames.length&&sks.length>1&&sks.every((v,i)=>i===0||v>sks[i-1]);
    const unit=dated?_nativeTrendUnit(_medianGapDays(sks)):null;
    const cadenceNote=dated
      ? 'Detected reference spacing: <b style="color:#eaf3fb">'+_cadenceLabel(sks)+'</b> — lag steps below are in <b style="color:#eaf3fb">'+unit.label.toUpperCase()+'S</b>. (If the target layer turns out not to carry real dates too, lag is dropped automatically at compute time.)'
      : '<span style="color:#ffb870">No usable dates found on this layer</span> — lag is disabled; this computes one frame-position-aligned correlation.';
    box.innerHTML='<div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#eaf3fb;">🔗 Correlation map</div>'+
      '<div style="font-size:9.5px;color:#7fa0b8;margin-bottom:8px;line-height:1.45;">Reference point <b style="color:#eaf3fb">'+_fmtLL(lon,lat)+'</b> on <b style="color:#eaf3fb">'+(ov.name||ov.selVar||'layer')+'</b> — correlates its time series against every cell of the target layer below.</div>'+
      '<div style="font-size:9.5px;color:#9fc4dd;margin-bottom:12px;line-height:1.5;padding:8px 10px;border-radius:6px;background:rgba(127,208,255,0.06);border:1px solid rgba(127,208,255,0.18);">'+cadenceNote+'</div>'+
      '<label style="display:block;margin-bottom:10px;">Target layer<select id="corr-target" style="width:100%;margin-top:4px;padding:5px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;">'+
        targets.map(o=>'<option value="'+o.id+'"'+(o.id===ov.id?' selected':'')+'>'+(o.name||o.selVar||'layer')+'</option>').join('')+
      '</select></label>'+
      (dated?(
      '<div style="display:flex;gap:8px;margin-bottom:6px;">'+
        '<label style="flex:1;">Lag min<input type="number" id="corr-lmin" value="-12" style="width:100%;margin-top:4px;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;"></label>'+
        '<label style="flex:1;">Lag max<input type="number" id="corr-lmax" value="12" style="width:100%;margin-top:4px;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;"></label>'+
        '<label style="flex:1;">Step<input type="number" id="corr-lstep" value="1" min="1" style="width:100%;margin-top:4px;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;"></label>'+
      '</div>'+
      '<div style="font-size:9px;color:#7a93a8;margin-bottom:10px;">Positive lag = reference LEADS the target (e.g. +3 tests whether the reference '+unit.label+'s ago predicts the target now, per the ENSO→rainfall style relationship). One correlation map per step — scrub through them afterwards with the normal time slider/animate button.</div>'
      ):'')+
      '<label style="display:block;margin:0 0 12px;font-size:10px;cursor:pointer;color:#9fc4dd;">'+
        '<input type="checkbox" id="corr-sig" style="margin-right:7px;accent-color:#7fd0ff;">'+
        'Mask insignificant cells (two-tailed t-test, p ≥ 0.05 → transparent)</label>'+
      '<label style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">Frame stride'+
        '<input type="number" id="corr-stride" value="'+_suggestCorrStride(ov)+'" min="1" step="1" style="width:64px;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;">'+
        '<span style="font-size:9px;color:#7a93a8;">use every Nth target frame</span></label>'+
      '<div style="font-size:9px;color:#7a93a8;margin-bottom:10px;">A full daily record swept across many lags is genuinely a lot of arithmetic (frames × lags × grid cells) — this is pre-set to keep it responsive. Set to 1 for the full native-resolution record (slower); raise it further for a quicker first look.</div>'+
      '<div style="display:flex;gap:8px;justify-content:flex-end;">'+
        '<button type="button" id="corr-cancel" style="padding:6px 12px;border-radius:5px;border:1px solid rgba(120,170,205,0.3);background:transparent;color:#9fb6c9;cursor:pointer;">Cancel</button>'+
        '<button type="button" id="corr-run" style="padding:6px 14px;border-radius:5px;border:none;background:#7fd0ff;color:#050d16;font-weight:600;cursor:pointer;">Compute</button></div>';
    dlg.appendChild(box);
    document.body.appendChild(dlg);
    // The reference-point marker (_showRegionPoint, below) has no natural
    // "done" moment of its own the way a region-extract's 6s auto-hide
    // does — picking happens BEFORE this dialog even opens. Tie its
    // removal to the dialog closing (Cancel, backdrop click, or Compute)
    // instead, or it was left on the globe indefinitely.
    const close=()=>{dlg.remove();_hideRegionBox();};
    box.querySelector('#corr-cancel').addEventListener('click',close);
    // Close only when BOTH the press and the release land on the bare
    // backdrop — a plain 'click' check alone also fires when a drag that
    // starts on a text field inside the dialog (e.g. selecting/highlighting
    // a lag number by dragging) happens to release outside that field,
    // since the resulting click's target is wherever the mouse came up,
    // not where the drag began.
    let _backdropDown=false;
    dlg.addEventListener('mousedown',e=>{ _backdropDown=(e.target===dlg); });
    dlg.addEventListener('click',e=>{ if(e.target===dlg&&_backdropDown) close(); });
    box.querySelector('#corr-run').addEventListener('click',async()=>{
      const targetId=box.querySelector('#corr-target').value;
      const targetOv=overlays.find(o=>o.id===targetId)||ov;
      const sig=!!box.querySelector('#corr-sig')?.checked;
      let lags=[0],unitDays=0,unitLabel='';
      if(dated){
        const lminRaw=Math.round(+(box.querySelector('#corr-lmin')?.value||0));
        const lmaxRaw=Math.round(+(box.querySelector('#corr-lmax')?.value||0));
        const lstep=Math.max(1,Math.round(+(box.querySelector('#corr-lstep')?.value||1)));
        const lmin=Math.min(lminRaw,lmaxRaw),lmax=Math.max(lminRaw,lmaxRaw);
        lags=[];
        for(let l=lmin;l<=lmax;l+=lstep) lags.push(l);
        if(!lags.length) lags=[0];
        if(lags.length>61){ alert('That is '+lags.length+' lag steps — narrow the range or increase the step (max 61).'); return; }
        unitDays=unit.days; unitLabel=unit.label;
      }
      const stride=Math.max(1,Math.round(+(box.querySelector('#corr-stride')?.value||1)));
      close();
      await _computeCorrelationMap(ov,lon,lat,targetOv,{lags,unitDays,unitLabel,sig,stride});
    });
  }
  // Exhaustive lagged correlation is O(frames × lags × grid cells) — a
  // multi-year daily record swept across a couple dozen lags is genuinely
  // billions of basic ops in single-threaded JS. Pre-suggest a stride
  // (process every Nth frame) that keeps a first look responsive; 1 always
  // remains available for a full-resolution run. Assumes the default
  // ±12/step-1 = 25-lag sweep since the actual lag count isn't chosen yet
  // when this dialog opens.
  function _suggestCorrStride(ov){
    const n=ov.frames?.length||0;
    const assumedLags=25;
    const budget=50000; // frames × lags kept under this (~500M cell-visits at a ~10k-cell grid)
    return Math.max(1,Math.ceil((n*assumedLags)/budget));
  }
  let _corrPick=null;
  const _corrCoordPanel=document.createElement('div');
  _corrCoordPanel.style.cssText='position:fixed;display:none;z-index:350;left:50%;top:54px;transform:translateX(-50%);'+
    'align-items:center;gap:6px;background:rgba(6,17,28,0.95);border:1px solid rgba(255,210,127,0.55);border-radius:8px;'+
    'padding:6px 10px;font-family:IBM Plex Mono,monospace;font-size:10.5px;color:#ffd27f;';
  _corrCoordPanel.innerHTML='<span>or enter coords:</span>'+
    '<input type="number" id="corr-coord-lat" placeholder="lat" step="0.1" min="-90" max="90" style="width:62px;padding:3px 5px;background:#0a1828;color:#ffe9c2;border:1px solid rgba(255,210,127,0.4);border-radius:4px;">'+
    '<input type="number" id="corr-coord-lon" placeholder="lon" step="0.1" min="-180" max="180" style="width:62px;padding:3px 5px;background:#0a1828;color:#ffe9c2;border:1px solid rgba(255,210,127,0.4);border-radius:4px;">'+
    '<button type="button" id="corr-coord-go" style="padding:3px 10px;border-radius:4px;border:none;background:#ffd27f;color:#2a1a00;font-weight:600;cursor:pointer;">Go</button>';
  document.body.appendChild(_corrCoordPanel);
  function _corrCoordGo(){
    if(!_corrPick)return;
    const latEl=_corrCoordPanel.querySelector('#corr-coord-lat'),lonEl=_corrCoordPanel.querySelector('#corr-coord-lon');
    const lat=parseFloat(latEl.value),lon=parseFloat(lonEl.value);
    if(!isFinite(lat)||!isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180){alert('Enter a valid latitude (-90 to 90) and longitude (-180 to 180).');return;}
    const cp=_corrPick; _corrPick=null; if(api) api._globeRegionPicking=false; _hintRegion(null); _corrCoordPanel.style.display='none';
    latEl.value=''; lonEl.value='';
    _showRegionPoint([lon,lat]);
    _openCorrelationDialog(cp.ov,lon,lat);
  }
  _corrCoordPanel.querySelector('#corr-coord-go').addEventListener('click',_corrCoordGo);
  _corrCoordPanel.addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();_corrCoordGo();} });
  function startCorrPick(ov){
    if(!ov.frames||ov.frames.length<3){alert('Load at least 3 time frames first.');return;}
    _corrPick={ov};
    if(api) api._globeRegionPicking=true;
    _hintRegion('CORRELATION MAP — click a reference point on the globe, or enter coords below (Esc cancels)');
    _corrCoordPanel.style.display='flex';
  }
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&_corrPick){_corrPick=null;if(api)api._globeRegionPicking=false;_hintRegion(null);_corrCoordPanel.style.display='none';} });
  document.addEventListener('click',e=>{
    if(!_corrPick)return;
    if(e.target.closest('.ctrl,.nc-plot-win,.nc-csv-menu,.nc-corr-dlg,#info-panel,.gf-feed-detail'))return;
    if(_corrCoordPanel.contains(e.target))return;
    const proj=api.projection,[pcx,pcy]=proj.translate(),pR=proj.scale();
    const dx=e.clientX-pcx,dy=e.clientY-pcy; if(dx*dx+dy*dy>pR*pR)return;
    const ll=proj.invert([e.clientX,e.clientY]); if(!ll)return;
    const cp=_corrPick; _corrPick=null; if(api) api._globeRegionPicking=false; _hintRegion(null); _corrCoordPanel.style.display='none';
    _showRegionPoint(ll);
    _openCorrelationDialog(cp.ov,ll[0],ll[1]);
  },true);

  /* ============================================================ COMPOSITE ANALYSIS
     "Mean field for El Niño years" style analysis: sample a reference
     index (any REGION_PRESETS box/diff, or a custom box) from a chosen
     layer, classify every target-layer frame by whether that index was
     running high or low at the matching time, then average the target
     field separately over the high-phase and low-phase frames — plus
     their difference, usually the most diagnostic view. Reuses _boxSeries
     (box-mean, already cos-lat weighted and cached) for the index and the
     same virtual-overlay pattern as _corr/_trend for the result. */
  async function _extractBoxIndexSeries(ov,boxSpec,progressPrefix){
    let means;
    if(boxSpec.diff){
      const A=await _boxSeries(ov,boxSpec.diff[0],(progressPrefix||'Computing ')+'A ');
      const B=await _boxSeries(ov,boxSpec.diff[1],(progressPrefix||'Computing ')+'B ');
      means=A.means.map((v,i)=>v-B.means[i]);
    } else {
      means=(await _boxSeries(ov,boxSpec,progressPrefix||'Computing ',boxSpec.clipFeature)).means;
    }
    const allSks=ov.frames.map(f=>f.sortKey).filter(sk=>typeof sk==='number'&&isFinite(sk));
    const looksDated=/^\d{4}-\d{2}-\d{2}/.test(String(ov.frames[0]?.label||''));
    const dated=looksDated&&allSks.length===ov.frames.length&&allSks.length>1&&allSks.every((v,i)=>i===0||v>allSks[i-1]);
    const sortKeys=[],values=[];
    for(let i=0;i<means.length;i++){
      if(isNaN(means[i])) continue;
      const sk=ov.frames[i]?.sortKey;
      sortKeys.push(typeof sk==='number'&&isFinite(sk)?sk:i);
      values.push(means[i]);
    }
    return {sortKeys,values,dated,ovName:boxSpec.name||ov.name||ov.selVar||'index'};
  }
  const _SEASON_MONTHS={DJF:[12,1,2],MAM:[3,4,5],JJA:[6,7,8],SON:[9,10,11]};
  async function _fitCompositeSlice(targetOv,idxSeries,opts,bothDated){
    opts=opts||{};
    const seasonMonths=opts.season&&_SEASON_MONTHS[opts.season];
    const probe=_cacheGet(targetOv,0);
    if(!probe) return null;
    const rs0=probe.renderSlice;
    const srcUnits=probe.activeSlice?.units||'';
    const N=rs0.nLat*rs0.nLon;
    const n=targetOv.frames.length;
    // Pass 1: match each target frame to an index value (season-filtered),
    // so the classification threshold is computed over the SAME set of
    // timesteps actually being composited (a DJF composite shouldn't be
    // thresholded against the full-year index distribution).
    const matched=[];
    for(let t=0;t<n;t++){
      let xv,month=0;
      if(bothDated){
        const tsk=targetOv.frames[t]?.sortKey;
        if(typeof tsk!=='number'||!isFinite(tsk)) continue;
        const m=/^\d{4}-(\d{2})-\d{2}/.exec(String(targetOv.frames[t]?.label||''));
        month=m?+m[1]:0;
        if(seasonMonths&&!seasonMonths.includes(month)) continue;
        xv=_interpAtTime(idxSeries,tsk);
      } else {
        xv=t<idxSeries.values.length?idxSeries.values[t]:null;
      }
      if(xv==null||isNaN(xv)) continue;
      matched.push({t,xv});
    }
    if(matched.length<4) return null;
    const mean=matched.reduce((a,m)=>a+m.xv,0)/matched.length;
    const variance=matched.reduce((a,m)=>a+(m.xv-mean)*(m.xv-mean),0)/matched.length;
    const sd=Math.sqrt(variance);
    const k=opts.k||0.5;
    const hiThresh=mean+k*sd, loThresh=mean-k*sd;
    // Accumulate a per-cell climatology (mean over EVERY matched timestep,
    // not just the classified ones) alongside the hi/lo sums, in the same
    // pass — decoding each frame once. Composite-ing raw absolute values
    // (e.g. actual SST in °C) is dominated by whatever spatial pattern is
    // large and constant across ALL timesteps (for SST: the ~30°C
    // pole-to-equator gradient), which swamps the much smaller signal
    // that actually differs between phases (an ENSO SST signal is
    // typically 1-3°C) — the positive- and negative-phase maps end up
    // looking almost identical at a glance even though the underlying
    // numbers differ. Subtracting this per-cell climatology (the standard
    // practice for composite/anomaly analysis in climate science) removes
    // the shared baseline and leaves just the phase-dependent signal, so
    // positive vs. negative phase are visibly — and correctly — mirror
    // images of each other. The difference frame is mathematically
    // unaffected either way (the climatology cancels out on subtraction).
    const sumAll=new Float64Array(N),cntAll=new Int32Array(N);
    const sumHi=new Float64Array(N),cntHi=new Int32Array(N);
    const sumLo=new Float64Array(N),cntLo=new Int32Array(N);
    let nHi=0,nLo=0;
    for(let i=0;i<matched.length;i++){
      const {t,xv}=matched[i];
      const isHi=xv>hiThresh, isLo=xv<loThresh;
      const fr=_cacheGet(targetOv,t); if(!fr) continue;
      const d=fr.renderSlice.data;
      for(let k2=0;k2<N;k2++){
        const v=d[k2]; if(isNaN(v)) continue;
        sumAll[k2]+=v; cntAll[k2]++;
        if(isHi){ sumHi[k2]+=v; cntHi[k2]++; }
        else if(isLo){ sumLo[k2]+=v; cntLo[k2]++; }
      }
      if(isHi) nHi++; else if(isLo) nLo++;
      if((i&7)===7) await new Promise(r=>setTimeout(r,0));
    }
    if(!nHi&&!nLo) return null;
    const hi=new Float32Array(N),lo=new Float32Array(N),diff=new Float32Array(N);
    for(let k2=0;k2<N;k2++){
      const clim=cntAll[k2]?sumAll[k2]/cntAll[k2]:NaN;
      const hm=cntHi[k2]?sumHi[k2]/cntHi[k2]:NaN;
      const lm=cntLo[k2]?sumLo[k2]/cntLo[k2]:NaN;
      hi[k2]=(cntHi[k2]&&!isNaN(clim))?hm-clim:NaN;
      lo[k2]=(cntLo[k2]&&!isNaN(clim))?lm-clim:NaN;
      diff[k2]=(cntHi[k2]&&cntLo[k2])?hm-lm:NaN;
    }
    return {nLat:rs0.nLat,nLon:rs0.nLon,lats:rs0.lats,lons:rs0.lons,
      hi,lo,diff,nHi,nLo,mean,sd,k,matchedN:matched.length,srcUnits};
  }
  function _buildCompositeOverlay(targetOv,fit,titlePrefix){
    const nv=createOverlay();
    if(!nv) return null;
    const u=fit.srcUnits||'value';
    const hiDesc='mean anomaly (vs. the '+fit.matchedN+'-timestep period mean) over '+fit.nHi+' timesteps where the index was above its own mean by ≥'+fit.k+'σ';
    const loDesc='mean anomaly (vs. the '+fit.matchedN+'-timestep period mean) over '+fit.nLo+' timesteps where the index was below its own mean by ≥'+fit.k+'σ';
    const slices=[
      {label:'Positive phase anomaly (n='+fit.nHi+')',data:fit.hi,kind:'hi',
        units:'Δ'+u+' — '+hiDesc},
      {label:'Negative phase anomaly (n='+fit.nLo+')',data:fit.lo,kind:'lo',
        units:'Δ'+u+' — '+loDesc},
      {label:'Positive − Negative',data:fit.diff,kind:'diff',
        units:'Δ'+u+' — positive-phase composite minus negative-phase composite (raw values, not anomalies — the period mean cancels out in the subtraction either way)'}
    ];
    nv._composite={srcId:targetOv.id,frames:slices,nLat:fit.nLat,nLon:fit.nLon,lats:fit.lats,lons:fit.lons};
    nv.name=titlePrefix||('Composite: '+(targetOv.name||targetOv.selVar||'layer'));
    nv.selVar='composite';
    nv.varOptions=[{name:'composite',label:nv.name}];
    nv.selCmap='RdBu';
    nv.frames=slices.map((s,i)=>({label:s.label,localT:i,virtual:true,compSlice:i,sortKey:i}));
    nv.maxTime=nv.frames.length;
    nv.selTime=2; // default to the difference map — usually the point of the exercise
    nv._fcache=new Map();
    rebuildSlice(nv);
    if(nv.cardEl){
      refreshCardVarPicker(nv);
      const body=nv.cardEl.querySelector('.nc-cb'); if(body) body.style.display='';
      const sw=nv.cardEl.querySelector('.nc-series-wrap'); if(sw) sw.style.display='none';
      const db=nv.cardEl.querySelector('.nc-drop-btn'); if(db) db.style.display='none';
      const badge=nv.cardEl.querySelector('.nc-cname');
      if(badge){ badge.textContent='🧮 '+nv.name; badge.classList.remove('nc-empty'); }
      const cmSel=nv.cardEl.querySelector('.nc-cm'); if(cmSel){ cmSel.value=nv.selCmap; updateCmapPrev(nv); }
      updateTimeControls(nv);
    }
    renumberCards(); schedRender(nv);
    document.getElementById('nc-body').style.display='';
    document.getElementById('nc-tog').textContent='▾';
    return nv;
  }
  async function _computeCompositeMap(refOv,boxSpec,targetOv,opts){
    if(!targetOv.frames||targetOv.frames.length<4){ alert('Target layer needs at least 4 time frames.'); return; }
    // _boxSeries (called inside _extractBoxIndexSeries) reports its own
    // progress through _hintRegion — a SEPARATE hint element from the
    // _hintTrend one used for the stage messages below. Both must be
    // cleared on every exit path (including an unexpected throw, which
    // would otherwise leave the UI stuck showing stale progress text with
    // no visible error) — hence the try/finally wrapping the whole body.
    try{
      _hintTrend('Sampling index series…');
      const idxSeries=await _extractBoxIndexSeries(refOv,boxSpec,'Index: ');
      if(idxSeries.values.length<4){ alert('Reference index has fewer than 4 valid time steps.'); return; }
      const tgtSks=targetOv.frames.map(f=>f.sortKey).filter(sk=>typeof sk==='number'&&isFinite(sk));
      const tgtLooksDated=/^\d{4}-\d{2}-\d{2}/.test(String(targetOv.frames[0]?.label||''));
      const targetDated=tgtLooksDated&&tgtSks.length===targetOv.frames.length&&tgtSks.length>1&&tgtSks.every((v,i)=>i===0||v>tgtSks[i-1]);
      const bothDated=idxSeries.dated&&targetDated;
      if(!bothDated&&opts.season){ console.warn('[composite] target layer lacks usable real dates — season filter and date alignment disabled, falling back to frame-position matching'); opts={...opts,season:null}; }
      _hintTrend('Compositing…');
      await new Promise(r=>setTimeout(r,0));
      const fit=await _fitCompositeSlice(targetOv,idxSeries,opts,bothDated);
      if(!fit){ alert('Not enough matched, classified frames to composite (need at least a few in each phase).'); return; }
      const prefix='Composite: '+idxSeries.ovName+(opts.season?(' '+opts.season):'')+' ↔ '+(targetOv.name||targetOv.selVar||'layer');
      _buildCompositeOverlay(targetOv,fit,prefix);
      console.log('[composite]',prefix,'n_hi='+fit.nHi,'n_lo='+fit.nLo,'mean='+fit.mean.toFixed(3),'sd='+fit.sd.toFixed(3));
    }catch(err){
      console.error('[composite] failed:',err);
      alert('Composite analysis failed: '+(err?.message||err));
    }finally{
      _hintTrend(null);
      _hintRegion(null);
    }
  }
  // opts carries whatever should survive a "reopen after pick/prompt/country
  // lookup" round-trip: the custom box just resolved (customBox) plus the
  // dropdown/threshold/season values the user had already set (preserved so
  // switching to "Enter coordinates…" etc. doesn't reset the rest of the form).
  function _openCompositeDialog(ov,opts){
    opts=opts||{};
    document.querySelectorAll('.nc-comp-dlg').forEach(d=>d.remove());
    const refCandidates=overlays.filter(o=>o.frames&&o.frames.length>=4);
    if(!refCandidates.length){ alert('No loaded layer with 4+ time frames to build an index from.'); return; }
    const targets=refCandidates;
    const dlg=document.createElement('div');
    dlg.className='nc-comp-dlg';
    dlg.style.cssText='position:fixed;inset:0;z-index:500;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);';
    const box=document.createElement('div');
    box.style.cssText='background:rgba(6,17,28,0.98);border:1px solid rgba(127,208,255,0.4);border-radius:10px;padding:16px 18px;max-width:480px;width:92%;max-height:88vh;overflow:auto;font-family:IBM Plex Mono,monospace;font-size:11px;color:#cfe3f2;box-shadow:0 12px 40px rgba(0,0,0,0.5);';
    const customBox=opts.customBox||null;
    let grpHtml='<option value="pick">◰ Pick corners on globe…</option>'+
      '<option value="coords">⌨ Enter coordinates…</option>'+
      '<option value="country">🌍 Country / region…</option>',lastGrp='';
    const oniIdx=REGION_PRESETS.findIndex(p=>p.name.indexOf('ONI')===0);
    REGION_PRESETS.forEach((p,i)=>{
      if(p.group&&p.group!==lastGrp){ if(lastGrp) grpHtml+='</optgroup>'; grpHtml+='<optgroup label="'+p.group+'">'; lastGrp=p.group; }
      grpHtml+='<option value="'+i+'"'+((!customBox&&i===oniIdx)?' selected':'')+'>'+p.name+'</option>';
    });
    if(lastGrp) grpHtml+='</optgroup>';
    if(customBox) grpHtml+='<option value="custom" selected>'+(customBox.name||'Custom region')+'</option>';
    box.innerHTML='<div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#eaf3fb;">🧮 Composite analysis</div>'+
      '<div style="font-size:9.5px;color:#7fa0b8;margin-bottom:12px;line-height:1.45;">Classifies the target layer\'s frames by whether a reference index was running high or low at that time, then averages each group\'s deviation from the whole compositing period\'s own mean — e.g. mean rainfall anomaly for El Niño vs La Niña periods. Anomalies (not raw values) so a signal like ENSO isn\'t swamped by a much larger constant pattern (e.g. the pole-to-equator SST gradient).</div>'+
      '<label style="display:block;margin-bottom:10px;">Index source layer<select id="comp-refsrc" style="width:100%;margin-top:4px;padding:5px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;">'+
        refCandidates.map(o=>'<option value="'+o.id+'"'+(o.id===(opts.refsrc||ov.id)?' selected':'')+'>'+(o.name||o.selVar||'layer')+'</option>').join('')+
      '</select></label>'+
      '<label style="display:block;margin-bottom:10px;">Index region<select id="comp-region" style="width:100%;margin-top:4px;padding:5px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;">'+grpHtml+'</select></label>'+
      '<label style="display:block;margin-bottom:10px;">Target layer (what gets composited)<select id="comp-target" style="width:100%;margin-top:4px;padding:5px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;">'+
        targets.map(o=>'<option value="'+o.id+'"'+(o.id===(opts.target||ov.id)?' selected':'')+'>'+(o.name||o.selVar||'layer')+'</option>').join('')+
      '</select></label>'+
      '<div style="display:flex;gap:8px;margin-bottom:10px;">'+
        '<label style="flex:1;">Threshold (×σ)<input type="number" id="comp-k" value="'+(opts.k!=null?opts.k:0.5)+'" step="0.1" min="0.1" style="width:100%;margin-top:4px;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;"></label>'+
        '<label style="flex:1;">Season<select id="comp-season" style="width:100%;margin-top:4px;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;">'+
          ['','DJF','MAM','JJA','SON'].map(v=>'<option value="'+v+'"'+(v===(opts.season||'')?' selected':'')+'>'+(v||'All months')+'</option>').join('')+
        '</select></label>'+
      '</div>'+
      '<div style="font-size:9px;color:#7a93a8;margin-bottom:12px;">Positive/negative phase = index above/below its own mean by the threshold (in standard deviations), computed over the matched, season-filtered timesteps. Produces 3 frames — positive composite, negative composite, and their difference — scrub with the normal time slider.</div>'+
      '<div style="display:flex;gap:8px;justify-content:flex-end;">'+
        '<button type="button" id="comp-cancel" style="padding:6px 12px;border-radius:5px;border:1px solid rgba(120,170,205,0.3);background:transparent;color:#9fb6c9;cursor:pointer;">Cancel</button>'+
        '<button type="button" id="comp-run" style="padding:6px 14px;border-radius:5px;border:none;background:#7fd0ff;color:#050d16;font-weight:600;cursor:pointer;">Compute</button></div>';
    dlg.appendChild(box);
    document.body.appendChild(dlg);
    const close=()=>dlg.remove();
    box.querySelector('#comp-cancel').addEventListener('click',close);
    // Close only when BOTH the press and the release land on the bare
    // backdrop — a plain 'click' check alone also fires when a drag that
    // starts on a text field inside the dialog (e.g. selecting/highlighting
    // a lag number by dragging) happens to release outside that field,
    // since the resulting click's target is wherever the mouse came up,
    // not where the drag began.
    let _backdropDown=false;
    dlg.addEventListener('mousedown',e=>{ _backdropDown=(e.target===dlg); });
    dlg.addEventListener('click',e=>{ if(e.target===dlg&&_backdropDown) close(); });
    const regionSel=box.querySelector('#comp-region');
    const currentFields=()=>({
      refsrc:box.querySelector('#comp-refsrc').value,
      target:box.querySelector('#comp-target').value,
      k:+(box.querySelector('#comp-k')?.value||0.5),
      season:box.querySelector('#comp-season').value||null
    });
    regionSel.addEventListener('change',()=>{
      const v=regionSel.value;
      if(v!=='pick'&&v!=='coords'&&v!=='country'&&v!=='custom') _flashPresetRegion(REGION_PRESETS[+v]);
      if(v==='pick'){
        const fields=currentFields();
        close();
        startCompositeBoxPick(ov,fields);
        return;
      }
      if(v==='coords'){
        const inp=prompt('Index region as lon0,lat0,lon1,lat1 (°E, °N; west-negative OR 0–360).\nIf lon0 > lon1 the box wraps the antimeridian.\nExample Niño 3.4:  -170,-5,-120,5');
        regionSel.value=customBox?'custom':(''+oniIdx);
        if(!inp) return;
        const v2=inp.split(',').map(Number);
        if(v2.length!==4||v2.some(isNaN)){ alert('Need four numbers: lon0,lat0,lon1,lat1'); return; }
        const [LO0,LA0,LO1,LA1]=v2;
        const fields=currentFields();
        const newBox={name:'Custom ('+inp+')',lon0:LO0,lon1:LO1,lat0:Math.min(LA0,LA1),lat1:Math.max(LA0,LA1),wrap:LO0>LO1};
        close();
        _openCompositeDialog(ov,{...fields,customBox:newBox});
        return;
      }
      if(v==='country'){
        const cn=(prompt('Country or region name:\n(e.g. Brazil, India, Arctic)\nCountries use their bounding box on the data grid.')||'').trim();
        regionSel.value=customBox?'custom':(''+oniIdx);
        if(!cn) return;
        const feat=_findCountryFeature(cn)||_findUserGeoFeature(cn);
        const fields=currentFields();
        if(feat){
          const b=d3.geoBounds(feat);
          const p=feat.properties||{};
          const newBox={name:(p.name||p.NAME||p.Name||cn),lon0:b[0][0],lat0:b[0][1],lon1:b[1][0],lat1:b[1][1],wrap:b[0][0]>b[1][0],clipFeature:feat};
          close();
          _openCompositeDialog(ov,{...fields,customBox:newBox});
          return;
        }
        const mtch=REGION_PRESETS.find(p=>p.name.toLowerCase().includes(cn.toLowerCase()));
        if(mtch){ close(); _openCompositeDialog(ov,{...fields,customBox:mtch}); return; }
        alert('"'+cn+'" not found. Try any country name (e.g. Peru, Vietnam, Germany), or: '+REGION_PRESETS.filter(p=>p.group==='Countries').map(p=>p.name).join(', '));
        return;
      }
    });
    box.querySelector('#comp-run').addEventListener('click',async()=>{
      const refId=box.querySelector('#comp-refsrc').value;
      const refOv=overlays.find(o=>o.id===refId)||ov;
      const targetId=box.querySelector('#comp-target').value;
      const targetOv=overlays.find(o=>o.id===targetId)||ov;
      const rv=regionSel.value;
      const boxSpec=_resolvePresetBox((rv==='custom'&&customBox)?customBox:REGION_PRESETS[+rv]);
      if(!boxSpec){ alert('Pick an index region first.'); return; }
      const k=Math.max(0.05,+(box.querySelector('#comp-k')?.value||0.5));
      const season=box.querySelector('#comp-season').value||null;
      close();
      await _computeCompositeMap(refOv,boxSpec,targetOv,{k,season});
    });
  }
  let _compBoxPick=null;
  function startCompositeBoxPick(ov,saved){
    _compBoxPick={ov,pts:[],saved:saved||{}};
    if(api) api._globeRegionPicking=true;
    _hintRegion('COMPOSITE INDEX REGION — click the FIRST corner on the globe (Esc cancels)');
  }
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&_compBoxPick){_compBoxPick=null;if(api)api._globeRegionPicking=false;_hintRegion(null);} });
  document.addEventListener('click',e=>{
    if(!_compBoxPick)return;
    if(e.target.closest('.ctrl,.nc-plot-win,.nc-csv-menu,.nc-comp-dlg,#info-panel,.gf-feed-detail'))return;
    const proj=api.projection,[pcx,pcy]=proj.translate(),pR=proj.scale();
    const dx=e.clientX-pcx,dy=e.clientY-pcy; if(dx*dx+dy*dy>pR*pR)return;
    const ll=proj.invert([e.clientX,e.clientY]); if(!ll)return;
    _compBoxPick.pts.push(ll);
    if(_compBoxPick.pts.length===1){
      _showRegionPoint(ll);
      _hintRegion('Now click the SECOND (opposite) corner');
    } else {
      const cp=_compBoxPick; _compBoxPick=null; if(api) api._globeRegionPicking=false; _hintRegion(null);
      const [p1,p2]=cp.pts;
      const lon0=Math.min(p1[0],p2[0]),lon1=Math.max(p1[0],p2[0]),lat0=Math.min(p1[1],p2[1]),lat1=Math.max(p1[1],p2[1]);
      _showRegionBox(lon0,lon1,lat0,lat1,false);
      setTimeout(_hideRegionBox,6000);
      const newBox={name:'Custom box',lon0,lat0,lon1,lat1};
      _openCompositeDialog(cp.ov,{...cp.saved,customBox:newBox});
    }
  },true);

  /* ============================================================ EOF / PCA
     Finds the dominant spatial modes of variability in a field over a
     region: build a (time × valid-cell) anomaly matrix, then extract the
     top few singular vectors via block power iteration (never forming a
     full covariance matrix — that's what makes this tractable in-browser
     for a large daily record). Each mode becomes a spatial "loading" frame
     on the usual virtual-overlay time slider, paired with a principal-
     component time series reachable via Region extract on that frame. */
  async function _fitEofSlice(targetOv,boxSpec,opts){
    opts=opts||{};
    const nModes=Math.max(1,Math.min(8,opts.nModes||4));
    const detrend=!!opts.detrend, standardize=!!opts.standardize;
    const latWeight=opts.latWeight||'cos';
    const probe=_cacheGet(targetOv,0);
    if(!probe) return {error:'Could not read the source layer.'};
    const rs0=probe.renderSlice;
    const srcUnits=probe.activeSlice?.units||'';
    const isCurv0=rs0.lats.length===rs0.data.length&&rs0.lons.length===rs0.data.length;
    const lon0=boxSpec.lon0, lon1=boxSpec.lon1;
    const lat0=Math.min(boxSpec.lat0,boxSpec.lat1), lat1=Math.max(boxSpec.lat0,boxSpec.lat1);
    const a0=((lon0%360)+360)%360, a1=((lon1%360)+360)%360;
    const fullGlobeLon=(lon1-lon0)>=360;
    const inPoly=boxSpec.clipFeature?(lo,la)=>d3.geoContains(boxSpec.clipFeature,[lo,la]):null;
    function cellMask(rs,isCurv){
      const idx=[];
      if(isCurv){
        for(let k=0;k<rs.data.length;k++){
          const la=rs.lats[k]; if(la<lat0||la>lat1)continue;
          const lo=rs.lons[k]; const loN=((lo%360)+360)%360;
          const inLon=fullGlobeLon||(a0<=a1?(loN>=a0&&loN<=a1):(loN>=a0||loN<=a1));
          if(!inLon)continue;
          if(inPoly&&!inPoly(lo,la))continue;
          idx.push(k);
        }
      } else {
        for(let i=0;i<rs.nLat;i++){
          const la=rs.lats[i]; if(la<lat0||la>lat1)continue;
          for(let j=0;j<rs.nLon;j++){
            const lo=rs.lons[j]; const loN=((lo%360)+360)%360;
            const inLon=fullGlobeLon||(a0<=a1?(loN>=a0&&loN<=a1):(loN>=a0||loN<=a1));
            if(!inLon)continue;
            if(inPoly&&!inPoly(lo,la))continue;
            idx.push(i*rs.nLon+j);
          }
        }
      }
      return idx;
    }
    const boxIdx=cellMask(rs0,isCurv0);
    if(boxIdx.length<4) return {error:'Selected region has fewer than 4 grid cells.'};
    // Time stride safety cap: T×S kept under a compute budget (an
    // 8000-frame daily record over a several-thousand-cell region is
    // otherwise tens of billions of ops for the SVD below) — mirrors the
    // same idea as the correlation map's frame-stride option.
    const nFramesTotal=targetOv.frames.length;
    const rawBudget=opts.maxElements||20000000;
    const stride=Math.max(1,Math.ceil((nFramesTotal*boxIdx.length)/rawBudget));
    const tIdx=[]; for(let t=0;t<nFramesTotal;t+=stride) tIdx.push(t);
    const T=tIdx.length, S0=boxIdx.length;
    if(T<8) return {error:'Fewer than 8 timesteps available after time-striding — widen the record or shrink the region.'};
    _hintTrend('EOF: reading frames 0%…');
    await new Promise(r=>setTimeout(r,0));
    // Pass 1: a cell survives if it has valid (non-NaN) data across at
    // least MIN_VALID_FRAC of the sampled record — NOT necessarily every
    // single timestep. Real satellite products commonly ship as
    // "uninterpolated": every day has scattered per-pixel gaps from swath
    // coverage/cloud QC (NOAA's daily OLR is a working example — 15-35% of
    // cells missing on a typical day, spread essentially randomly across
    // the grid, not concentrated in a handful of bad days). Requiring
    // 100% completeness against that kind of record leaves ZERO surviving
    // cells regardless of region — not a rare edge case, but the norm for
    // this class of dataset. Remaining scattered gaps in a kept cell are
    // filled with 0 (i.e. "at that cell's own mean/trend line") after
    // anomaly removal below — standard naive imputation for EOF with
    // sporadic missing data.
    const MIN_VALID_FRAC=0.5;
    const raw=new Float32Array(T*S0);
    const validCount=new Int32Array(S0);
    for(let ti=0;ti<T;ti++){
      const t=tIdx[ti];
      const fr=_cacheGet(targetOv,t);
      const base=ti*S0;
      if(!fr){ for(let s=0;s<S0;s++) raw[base+s]=NaN; }
      else{
        const d=fr.renderSlice.data;
        for(let s=0;s<S0;s++){
          const v=d[boxIdx[s]];
          raw[base+s]=v;
          if(!isNaN(v)) validCount[s]++;
        }
      }
      if((ti&15)===15){ _hintTrend('EOF: reading frames '+Math.round((ti+1)/T*100)+'%…'); await new Promise(r=>setTimeout(r,0)); }
    }
    const finalCols=[]; for(let s=0;s<S0;s++) if(validCount[s]>=MIN_VALID_FRAC*T) finalCols.push(s);
    const S=finalCols.length;
    if(S<4) return {error:'Fewer than 4 grid cells have at least '+Math.round(MIN_VALID_FRAC*100)+'% valid data across the sampled record in this region.'};
    const A=new Float64Array(T*S);
    for(let ti=0;ti<T;ti++){
      const base=ti*S0, obase=ti*S;
      for(let s=0;s<S;s++) A[obase+s]=raw[base+finalCols[s]];
    }
    // Per-cell mean (or linear trend, if requested) is fit from that
    // cell's own VALID samples only, then removed from those samples;
    // any remaining gap in the cell is set to exactly 0 (no anomaly
    // signal) rather than participating in the fit.
    const tIdxF=new Float64Array(T); for(let i=0;i<T;i++) tIdxF[i]=i;
    for(let s=0;s<S;s++){
      let sumT=0,sumTT=0,sumV=0,sumTV=0,n=0;
      for(let ti=0;ti<T;ti++){
        const v=A[ti*S+s]; if(isNaN(v)) continue;
        const tv=tIdxF[ti];
        sumT+=tv; sumTT+=tv*tv; sumV+=v; sumTV+=tv*v; n++;
      }
      const meanV=n?sumV/n:0;
      if(detrend&&n>2){
        const meanT=sumT/n, varT=sumTT-n*meanT*meanT;
        const slope=varT>1e-9?(sumTV-n*meanT*meanV)/varT:0;
        const intercept=meanV-slope*meanT;
        for(let ti=0;ti<T;ti++){
          const v=A[ti*S+s];
          A[ti*S+s]=isNaN(v)?0:(v-(intercept+slope*tIdxF[ti]));
        }
      } else {
        for(let ti=0;ti<T;ti++){
          const v=A[ti*S+s];
          A[ti*S+s]=isNaN(v)?0:(v-meanV);
        }
      }
    }
    if(standardize){
      for(let s=0;s<S;s++){
        let ss=0; for(let ti=0;ti<T;ti++) ss+=A[ti*S+s]*A[ti*S+s];
        const sd=Math.sqrt(ss/T);
        if(sd>1e-9) for(let ti=0;ti<T;ti++) A[ti*S+s]/=sd;
      }
    }
    // Latitude weighting: on a lat/lon grid a high-latitude cell covers far
    // less real-world area than a tropical one but counts as one column
    // exactly the same as a tropical column — weighting by (sqrt of)
    // cos(latitude) before the SVD is the standard climate-science fix so
    // the extracted modes reflect actual geographic area, not grid-cell
    // count. The weighting is divided back out of the spatial pattern
    // afterwards so the displayed loadings stay in physical units.
    const colWeight=new Float64Array(S);
    for(let s=0;s<S;s++){
      const cellIdx=boxIdx[finalCols[s]];
      const la=isCurv0?rs0.lats[cellIdx]:rs0.lats[Math.floor(cellIdx/rs0.nLon)];
      const c=Math.max(0,Math.cos(la*Math.PI/180));
      colWeight[s]=latWeight==='none'?1:(latWeight==='sqrtcos'?Math.sqrt(c):c);
    }
    if(latWeight!=='none'){
      for(let s=0;s<S;s++){ const w=colWeight[s]; if(w!==1) for(let ti=0;ti<T;ti++) A[ti*S+s]*=w; }
    }
    // ---- Truncated SVD via block/orthogonal power iteration ----
    // Only the top nModes singular vectors are needed, so a full S×S (or
    // T×T) eigendecomposition would be wasted work at this scale — this
    // instead applies A and Aᵀ purely as matrix-vector products (never
    // materialising a covariance matrix) and refines nModes candidate
    // vectors together, re-orthonormalising every step so the modes stay
    // independent. Standard technique for pulling a handful of leading
    // EOFs out of a dataset too large to fully diagonalise in-browser.
    let V=new Float64Array(S*nModes);
    { let seed=12345; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
      for(let i=0;i<S*nModes;i++) V[i]=rnd()-0.5; }
    function orthonormalize(M,rows,cols){
      for(let c=0;c<cols;c++){
        for(let p=0;p<c;p++){
          let dot=0; for(let r=0;r<rows;r++) dot+=M[c*rows+r]*M[p*rows+r];
          for(let r=0;r<rows;r++) M[c*rows+r]-=dot*M[p*rows+r];
        }
        let norm=0; for(let r=0;r<rows;r++) norm+=M[c*rows+r]*M[c*rows+r];
        norm=Math.sqrt(norm);
        if(norm<1e-9){
          for(let r=0;r<rows;r++) M[c*rows+r]=Math.random()-0.5;
          norm=0; for(let r=0;r<rows;r++) norm+=M[c*rows+r]*M[c*rows+r]; norm=Math.sqrt(norm)||1;
        }
        for(let r=0;r<rows;r++) M[c*rows+r]/=norm;
      }
    }
    orthonormalize(V,S,nModes);
    const maxIter=opts.maxIter||30;
    let prevEig=new Float64Array(nModes);
    for(let iter=0;iter<maxIter;iter++){
      const U=new Float64Array(T*nModes);
      for(let ti=0;ti<T;ti++){
        const abase=ti*S;
        for(let c=0;c<nModes;c++){
          let s=0; const vbase=c*S;
          for(let j=0;j<S;j++) s+=A[abase+j]*V[vbase+j];
          U[ti*nModes+c]=s;
        }
      }
      const W=new Float64Array(S*nModes);
      for(let ti=0;ti<T;ti++){
        const abase=ti*S, ubase=ti*nModes;
        for(let c=0;c<nModes;c++){
          const u=U[ubase+c]; if(u===0) continue;
          const wbase=c*S;
          for(let j=0;j<S;j++) W[wbase+j]+=A[abase+j]*u;
        }
      }
      const eig=new Float64Array(nModes);
      for(let c=0;c<nModes;c++){ let n2=0; for(let r=0;r<S;r++) n2+=W[c*S+r]*W[c*S+r]; eig[c]=n2; }
      orthonormalize(W,S,nModes);
      V=W;
      let maxDelta=0;
      for(let c=0;c<nModes;c++) maxDelta=Math.max(maxDelta,Math.abs(Math.sqrt(eig[c])-prevEig[c])/(prevEig[c]||1));
      prevEig=new Float64Array(nModes); for(let c=0;c<nModes;c++) prevEig[c]=Math.sqrt(eig[c]);
      if((iter&3)===3){ _hintTrend('EOF: solving modes — iter '+(iter+1)+'/'+maxIter+'…'); await new Promise(r=>setTimeout(r,0)); }
      if(iter>5&&maxDelta<1e-4) break;
    }
    const PC=new Float64Array(T*nModes);
    for(let ti=0;ti<T;ti++){
      const abase=ti*S;
      for(let c=0;c<nModes;c++){
        let s=0; const vbase=c*S;
        for(let j=0;j<S;j++) s+=A[abase+j]*V[vbase+j];
        PC[ti*nModes+c]=s;
      }
    }
    const sigma=new Float64Array(nModes);
    for(let c=0;c<nModes;c++){ let ss=0; for(let ti=0;ti<T;ti++) ss+=PC[ti*nModes+c]*PC[ti*nModes+c]; sigma[c]=Math.sqrt(ss); }
    let totalVar=0; for(let i=0;i<A.length;i++) totalVar+=A[i]*A[i];
    const N=rs0.nLat*rs0.nLon;
    const modes=[];
    for(let c=0;c<nModes;c++){
      const pattern=new Float32Array(N).fill(NaN);
      for(let s=0;s<S;s++){
        const cellIdx=boxIdx[finalCols[s]];
        const w=colWeight[s];
        pattern[cellIdx]=w>1e-9?V[c*S+s]/w:V[c*S+s];
      }
      const pct=totalVar>1e-12?(sigma[c]*sigma[c]/totalVar*100):0;
      const pcValues=new Float64Array(T);
      for(let ti=0;ti<T;ti++) pcValues[ti]=PC[ti*nModes+c];
      modes.push({pattern,pct,sigma:sigma[c],pc:pcValues});
    }
    const pcLabels=tIdx.map(t=>targetOv.frames[t]?.label||('t'+t));
    const pcSortKeys=tIdx.map(t=>targetOv.frames[t]?.sortKey);
    return {nLat:rs0.nLat,nLon:rs0.nLon,lats:rs0.lats,lons:rs0.lons,modes,srcUnits,
      S,T,stride,matchedN:T,pcLabels,pcSortKeys,regionName:boxSpec.name||'region'};
  }
  function _buildEofOverlay(targetOv,fit,titlePrefix){
    const nv=createOverlay();
    if(!nv) return null;
    const u=fit.srcUnits||'value';
    const slices=fit.modes.map((m,i)=>({
      label:'EOF '+(i+1)+' ('+m.pct.toFixed(1)+'% var)',
      data:m.pattern,
      units:'loading (Δ'+u+' per unit PC'+(i+1)+') — '+m.pct.toFixed(1)+'% of variance explained over '+fit.matchedN+' timesteps'+(fit.stride>1?' (time-strided ×'+fit.stride+')':''),
      pc:m.pc, pct:m.pct
    }));
    nv._eof={srcId:targetOv.id,frames:slices,nLat:fit.nLat,nLon:fit.nLon,lats:fit.lats,lons:fit.lons,
      pcLabels:fit.pcLabels,pcSortKeys:fit.pcSortKeys,regionName:fit.regionName};
    nv.name=titlePrefix||('EOF: '+(targetOv.name||targetOv.selVar||'layer'));
    nv.selVar='eof';
    nv.varOptions=[{name:'eof',label:nv.name}];
    nv.selCmap='RdBu';
    nv.frames=slices.map((s,i)=>({label:s.label,localT:i,virtual:true,eofSlice:i,sortKey:i}));
    nv.maxTime=nv.frames.length;
    nv.selTime=0; // EOF1 (dominant mode) is the natural default view
    nv._fcache=new Map();
    rebuildSlice(nv);
    if(nv.cardEl){
      refreshCardVarPicker(nv);
      const body=nv.cardEl.querySelector('.nc-cb'); if(body) body.style.display='';
      const sw=nv.cardEl.querySelector('.nc-series-wrap'); if(sw) sw.style.display='none';
      const db=nv.cardEl.querySelector('.nc-drop-btn'); if(db) db.style.display='none';
      const badge=nv.cardEl.querySelector('.nc-cname');
      if(badge){ badge.textContent='📊 '+nv.name; badge.classList.remove('nc-empty'); }
      const cmSel=nv.cardEl.querySelector('.nc-cm'); if(cmSel){ cmSel.value=nv.selCmap; updateCmapPrev(nv); }
      updateTimeControls(nv);
    }
    renumberCards(); schedRender(nv);
    document.getElementById('nc-body').style.display='';
    document.getElementById('nc-tog').textContent='▾';
    return nv;
  }
  async function _computeEofMap(targetOv,boxSpec,opts){
    if(!targetOv.frames||targetOv.frames.length<8){ alert('This layer needs at least 8 time frames for EOF analysis.'); return; }
    try{
      _hintTrend('EOF: preparing…');
      await new Promise(r=>setTimeout(r,0));
      const fit=await _fitEofSlice(targetOv,boxSpec,opts);
      if(!fit||fit.error){ alert(fit?.error||'EOF analysis failed — not enough valid data in this region.'); return; }
      const prefix='EOF: '+(boxSpec.name||'region')+' ↔ '+(targetOv.name||targetOv.selVar||'layer');
      _buildEofOverlay(targetOv,fit,prefix);
      console.log('[eof]',prefix,fit.modes.map((m,i)=>'EOF'+(i+1)+'='+m.pct.toFixed(1)+'%').join(' '));
    }catch(err){
      console.error('[eof] failed:',err);
      alert('EOF analysis failed: '+(err?.message||err));
    }finally{
      _hintTrend(null);
    }
  }
  function _openEofDialog(ov,opts){
    opts=opts||{};
    document.querySelectorAll('.nc-eof-dlg').forEach(d=>d.remove());
    if(!ov.frames||ov.frames.length<8){ alert('This layer needs at least 8 time frames to run EOF analysis.'); return; }
    const dlg=document.createElement('div');
    dlg.className='nc-eof-dlg';
    dlg.style.cssText='position:fixed;inset:0;z-index:500;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);';
    const box=document.createElement('div');
    box.style.cssText='background:rgba(6,17,28,0.98);border:1px solid rgba(127,208,255,0.4);border-radius:10px;padding:16px 18px;max-width:480px;width:92%;max-height:88vh;overflow:auto;font-family:IBM Plex Mono,monospace;font-size:11px;color:#cfe3f2;box-shadow:0 12px 40px rgba(0,0,0,0.5);';
    const customBox=opts.customBox||null;
    let grpHtml='<option value="pick">◰ Pick corners on globe…</option>'+
      '<option value="coords">⌨ Enter coordinates…</option>'+
      '<option value="country">🌍 Country / region…</option>'+
      '<option value="global">🌐 Global</option>',lastGrp='';
    REGION_PRESETS.forEach((p,i)=>{
      if(p.diff) return; // EOF needs a single field-region, not a two-box difference index
      if(p.group&&p.group!==lastGrp){ if(lastGrp) grpHtml+='</optgroup>'; grpHtml+='<optgroup label="'+p.group+'">'; lastGrp=p.group; }
      grpHtml+='<option value="'+i+'">'+p.name+'</option>';
    });
    if(lastGrp) grpHtml+='</optgroup>';
    if(customBox) grpHtml+='<option value="custom" selected>'+(customBox.name||'Custom region')+'</option>';
    box.innerHTML='<div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#eaf3fb;">📊 EOF / PCA analysis</div>'+
      '<div style="font-size:9.5px;color:#7fa0b8;margin-bottom:12px;line-height:1.45;">Finds the dominant spatial patterns of variability in this field over the selected region — e.g. run on tropical Pacific SST and EOF1 typically comes back looking like ENSO. Produces spatial mode maps (scrub with the time slider) plus a principal-component time series per mode, reachable via Region extract while that mode is selected.</div>'+
      '<label style="display:block;margin-bottom:10px;">Field (this layer)<div style="margin-top:4px;padding:5px;background:rgba(127,208,255,0.06);border:1px solid rgba(127,208,255,0.18);border-radius:4px;color:#eaf3fb;">'+(ov.name||ov.selVar||'layer')+'</div></label>'+
      '<label style="display:block;margin-bottom:10px;">Region<select id="eof-region" style="width:100%;margin-top:4px;padding:5px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;">'+grpHtml+'</select></label>'+
      '<div style="display:flex;gap:8px;margin-bottom:10px;">'+
        '<label style="flex:1;">Modes<input type="number" id="eof-modes" value="'+(opts.nModes||4)+'" min="1" max="8" style="width:100%;margin-top:4px;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;"></label>'+
        '<label style="flex:1;">Lat weighting<select id="eof-latw" style="width:100%;margin-top:4px;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;">'+
          '<option value="cos"'+((opts.latWeight||'cos')==='cos'?' selected':'')+'>cos(latitude)</option>'+
          '<option value="sqrtcos"'+(opts.latWeight==='sqrtcos'?' selected':'')+'>√cos(latitude)</option>'+
          '<option value="none"'+(opts.latWeight==='none'?' selected':'')+'>None</option>'+
        '</select></label>'+
      '</div>'+
      '<label style="display:block;margin:0 0 6px;font-size:10px;cursor:pointer;color:#9fc4dd;">'+
        '<input type="checkbox" id="eof-detrend" style="margin-right:7px;accent-color:#7fd0ff;"'+(opts.detrend?' checked':'')+'> Remove linear trend per cell (in addition to the mean)</label>'+
      '<label style="display:block;margin:0 0 12px;font-size:10px;cursor:pointer;color:#9fc4dd;">'+
        '<input type="checkbox" id="eof-standardize" style="margin-right:7px;accent-color:#7fd0ff;"'+(opts.standardize?' checked':'')+'> Standardise each grid cell (divide by its own std dev)</label>'+
      '<div style="font-size:9px;color:#7a93a8;margin-bottom:10px;">The mean is always removed per cell first. A very large region on a long, fine-resolution record is auto-strided in time to stay responsive — the result reports the effective sample count used.</div>'+
      '<div style="display:flex;gap:8px;justify-content:flex-end;">'+
        '<button type="button" id="eof-cancel" style="padding:6px 12px;border-radius:5px;border:1px solid rgba(120,170,205,0.3);background:transparent;color:#9fb6c9;cursor:pointer;">Cancel</button>'+
        '<button type="button" id="eof-run" style="padding:6px 14px;border-radius:5px;border:none;background:#7fd0ff;color:#050d16;font-weight:600;cursor:pointer;">Run EOF analysis</button></div>';
    dlg.appendChild(box);
    document.body.appendChild(dlg);
    const close=()=>dlg.remove();
    box.querySelector('#eof-cancel').addEventListener('click',close);
    // Close only when BOTH the press and the release land on the bare
    // backdrop — a plain 'click' check alone also fires when a drag that
    // starts on a text field inside the dialog (e.g. selecting/highlighting
    // a lag number by dragging) happens to release outside that field,
    // since the resulting click's target is wherever the mouse came up,
    // not where the drag began.
    let _backdropDown=false;
    dlg.addEventListener('mousedown',e=>{ _backdropDown=(e.target===dlg); });
    dlg.addEventListener('click',e=>{ if(e.target===dlg&&_backdropDown) close(); });
    const regionSel=box.querySelector('#eof-region');
    const currentFields=()=>({
      nModes:Math.max(1,Math.min(8,Math.round(+(box.querySelector('#eof-modes')?.value||4)))),
      latWeight:box.querySelector('#eof-latw').value||'cos',
      detrend:!!box.querySelector('#eof-detrend')?.checked,
      standardize:!!box.querySelector('#eof-standardize')?.checked
    });
    regionSel.addEventListener('change',()=>{
      const v=regionSel.value;
      if(v!=='pick'&&v!=='coords'&&v!=='country'&&v!=='custom'&&v!=='global') _flashPresetRegion(REGION_PRESETS[+v]);
      if(v==='pick'){
        const fields=currentFields();
        close();
        startEofBoxPick(ov,fields);
        return;
      }
      if(v==='coords'){
        const inp=prompt('Region as lon0,lat0,lon1,lat1 (°E, °N; west-negative OR 0–360).\nIf lon0 > lon1 the box wraps the antimeridian.\nExample tropical Pacific:  120,-20,-80,20');
        regionSel.value=customBox?'custom':'global';
        if(!inp) return;
        const v2=inp.split(',').map(Number);
        if(v2.length!==4||v2.some(isNaN)){ alert('Need four numbers: lon0,lat0,lon1,lat1'); return; }
        const [LO0,LA0,LO1,LA1]=v2;
        const fields=currentFields();
        const newBox={name:'Custom ('+inp+')',lon0:LO0,lon1:LO1,lat0:Math.min(LA0,LA1),lat1:Math.max(LA0,LA1),wrap:LO0>LO1};
        close();
        _openEofDialog(ov,{...fields,customBox:newBox});
        return;
      }
      if(v==='country'){
        const cn=(prompt('Country or region name:\n(e.g. Brazil, India, Arctic)\nCountries use their bounding box on the data grid.')||'').trim();
        regionSel.value=customBox?'custom':'global';
        if(!cn) return;
        const feat=_findCountryFeature(cn)||_findUserGeoFeature(cn);
        const fields=currentFields();
        if(feat){
          const b=d3.geoBounds(feat);
          const p=feat.properties||{};
          const newBox={name:(p.name||p.NAME||p.Name||cn),lon0:b[0][0],lat0:b[0][1],lon1:b[1][0],lat1:b[1][1],wrap:b[0][0]>b[1][0],clipFeature:feat};
          close();
          _openEofDialog(ov,{...fields,customBox:newBox});
          return;
        }
        const mtch=REGION_PRESETS.find(p=>!p.diff&&p.name.toLowerCase().includes(cn.toLowerCase()));
        if(mtch){ close(); _openEofDialog(ov,{...fields,customBox:mtch}); return; }
        alert('"'+cn+'" not found. Try any country name (e.g. Peru, Vietnam, Germany), or: '+REGION_PRESETS.filter(p=>p.group==='Countries').map(p=>p.name).join(', '));
        return;
      }
    });
    box.querySelector('#eof-run').addEventListener('click',async()=>{
      const rv=regionSel.value;
      const boxSpec=_resolvePresetBox((rv==='custom'&&customBox)?customBox:
        (rv==='global'?{name:'Global',lon0:-180,lon1:180,lat0:-90,lat1:90}:REGION_PRESETS[+rv]));
      if(!boxSpec){ alert('Pick a region first.'); return; }
      const fields=currentFields();
      close();
      await _computeEofMap(ov,boxSpec,fields);
    });
  }
  let _eofBoxPick=null;
  function startEofBoxPick(ov,saved){
    _eofBoxPick={ov,pts:[],saved:saved||{}};
    if(api) api._globeRegionPicking=true;
    _hintRegion('EOF REGION — click the FIRST corner on the globe (Esc cancels)');
  }
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&_eofBoxPick){_eofBoxPick=null;if(api)api._globeRegionPicking=false;_hintRegion(null);} });
  document.addEventListener('click',e=>{
    if(!_eofBoxPick)return;
    if(e.target.closest('.ctrl,.nc-plot-win,.nc-csv-menu,.nc-eof-dlg,#info-panel,.gf-feed-detail'))return;
    const proj=api.projection,[pcx,pcy]=proj.translate(),pR=proj.scale();
    const dx=e.clientX-pcx,dy=e.clientY-pcy; if(dx*dx+dy*dy>pR*pR)return;
    const ll=proj.invert([e.clientX,e.clientY]); if(!ll)return;
    _eofBoxPick.pts.push(ll);
    if(_eofBoxPick.pts.length===1){
      _showRegionPoint(ll);
      _hintRegion('Now click the SECOND (opposite) corner');
    } else {
      const cp=_eofBoxPick; _eofBoxPick=null; if(api) api._globeRegionPicking=false; _hintRegion(null);
      const [p1,p2]=cp.pts;
      const lon0=Math.min(p1[0],p2[0]),lon1=Math.max(p1[0],p2[0]),lat0=Math.min(p1[1],p2[1]),lat1=Math.max(p1[1],p2[1]);
      _showRegionBox(lon0,lon1,lat0,lat1,false);
      setTimeout(_hideRegionBox,6000);
      const newBox={name:'Custom box',lon0,lat0,lon1,lat1};
      _openEofDialog(cp.ov,{...cp.saved,customBox:newBox});
    }
  },true);

  /* ============================================================ MULTIPLE REGRESSION
     Fits target = β0 + β1·pred1 + β2·pred2 + … at every grid cell via
     ordinary least squares, so each predictor's coefficient map shows its
     relationship with the target CONTROLLING FOR the other predictors —
     e.g. ENSO's independent effect on rainfall once IOD and SAM are
     accounted for, which a plain correlation map can't separate out.
     Predictors are region-mean index series (same mechanism as
     Composite's index picker, reused via _extractBoxIndexSeries). The key
     efficiency trick: the design matrix X is identical for every grid
     cell (only the target values differ), so (XᵀX)⁻¹ is inverted exactly
     ONCE and reused — per-cell work is then just a couple of small
     matrix-vector products, not a fresh regression solve per cell. */
  function _gaussJordanInverse(Mflat,n){
    const w=2*n;
    const A=new Float64Array(n*w);
    for(let i=0;i<n;i++){
      for(let j=0;j<n;j++) A[i*w+j]=Mflat[i*n+j];
      A[i*w+n+i]=1;
    }
    for(let col=0;col<n;col++){
      let piv=col,best=Math.abs(A[col*w+col]);
      for(let r=col+1;r<n;r++){ const v=Math.abs(A[r*w+col]); if(v>best){best=v;piv=r;} }
      if(best<1e-10) return null; // singular — predictors are collinear
      if(piv!==col){ for(let j=0;j<w;j++){ const tmp=A[col*w+j]; A[col*w+j]=A[piv*w+j]; A[piv*w+j]=tmp; } }
      const pv=A[col*w+col];
      for(let j=0;j<w;j++) A[col*w+j]/=pv;
      for(let r=0;r<n;r++){
        if(r===col) continue;
        const f=A[r*w+col];
        if(f===0) continue;
        for(let j=0;j<w;j++) A[r*w+j]-=f*A[col*w+j];
      }
    }
    const inv=new Float64Array(n*n);
    for(let i=0;i<n;i++) for(let j=0;j<n;j++) inv[i*n+j]=A[i*w+n+j];
    return inv;
  }
  async function _fitRegressionSlice(targetOv,predSeries,opts){
    opts=opts||{};
    const lagDays=opts.lagDays||0, standardize=!!opts.standardize;
    const k=predSeries.length;
    const probe=_cacheGet(targetOv,0);
    if(!probe) return {error:'Could not read the target layer.'};
    const rs0=probe.renderSlice;
    const srcUnits=probe.activeSlice?.units||'';
    const N=rs0.nLat*rs0.nLon;
    const tgtSks=targetOv.frames.map(f=>f.sortKey).filter(sk=>typeof sk==='number'&&isFinite(sk));
    const tgtLooksDated=/^\d{4}-\d{2}-\d{2}/.test(String(targetOv.frames[0]?.label||''));
    const targetDated=tgtLooksDated&&tgtSks.length===targetOv.frames.length&&tgtSks.length>1&&tgtSks.every((v,i)=>i===0||v>tgtSks[i-1]);
    if(!targetDated||predSeries.some(s=>!s.dated)){
      return {error:'Regression needs real calendar dates on the target layer AND every predictor — at least one of these lacks usable dates.'};
    }
    const n=targetOv.frames.length;
    const matched=[];
    for(let t=0;t<n;t++){
      const tsk=targetOv.frames[t]?.sortKey;
      if(typeof tsk!=='number'||!isFinite(tsk)) continue;
      const xs=new Array(k);
      let ok=true;
      for(let j=0;j<k;j++){
        const v=_interpAtTime(predSeries[j],tsk-lagDays);
        if(v==null||isNaN(v)){ok=false;break;}
        xs[j]=v;
      }
      if(!ok) continue;
      matched.push({t,xs});
    }
    const T=matched.length;
    const df=T-k-1;
    if(df<3) return {error:'Only '+T+' matched timesteps for '+k+' predictor(s) — need more date overlap (df='+df+', want at least 3).'};
    // Design matrix X (T × (k+1)), column 0 = intercept. Standardising
    // the predictors (subtract mean, divide by std, over the matched set)
    // makes β read as "per 1σ of the predictor" — directly comparable
    // across predictors with different natural units/scales — and keeps
    // the small matrix inversion below numerically well-conditioned.
    const predMean=new Float64Array(k), predSd=new Float64Array(k).fill(1);
    if(standardize){
      for(let j=0;j<k;j++){
        let s=0; for(let i=0;i<T;i++) s+=matched[i].xs[j];
        predMean[j]=s/T;
        let ss=0; for(let i=0;i<T;i++){ const d=matched[i].xs[j]-predMean[j]; ss+=d*d; }
        predSd[j]=Math.sqrt(ss/T)||1;
      }
    }
    const kk=k+1;
    const X=new Float64Array(T*kk);
    for(let i=0;i<T;i++){
      X[i*kk]=1;
      for(let j=0;j<k;j++){
        const raw=matched[i].xs[j];
        X[i*kk+1+j]=standardize?(raw-predMean[j])/predSd[j]:raw;
      }
    }
    const XtX=new Float64Array(kk*kk);
    for(let i=0;i<T;i++){
      for(let a=0;a<kk;a++){
        const xa=X[i*kk+a];
        for(let b=0;b<kk;b++) XtX[a*kk+b]+=xa*X[i*kk+b];
      }
    }
    const C=_gaussJordanInverse(XtX,kk);
    if(!C) return {error:'Predictors are collinear (near-perfectly correlated with each other) — the regression matrix can\'t be inverted. Try fewer or less-similar predictors.'};
    // Frame-outer accumulation: SumY, SumYY and XᵀY per cell are the
    // sufficient statistics for β/R²/SE per cell — accumulating these
    // avoids ever storing a full (time × cells) matrix in memory.
    //
    // A missing target value at one (timestep, cell) pair is skipped for
    // just that pair — NOT treated as disqualifying the whole cell for
    // every other timestep. Real daily satellite products (this was found
    // against NOAA's uninterpolated OLR) routinely have a handful of
    // fully-blank days plus scattered per-pixel gaps everywhere else; an
    // earlier version of this flagged a cell permanently invalid on its
    // FIRST missing day, which for a multi-year daily record with >1%
    // scattered missingness meant essentially every cell in the grid was
    // eventually touched by at least one gap — silently producing a
    // blank (all-NaN) regression map with no error shown. A per-cell
    // valid-sample COUNT with a completeness floor tolerates that
    // scattered pattern; β/R² are still fit from the (correctly reduced)
    // sufficient statistics, and each cell's own valid-sample count sets
    // its degrees of freedom for the t-test/p-value, rather than assuming
    // the full T for every cell regardless of how much of it is missing.
    const sumY=new Float64Array(N), sumYY=new Float64Array(N);
    const XtY=new Float64Array(kk*N);
    const validN=new Int32Array(N);
    for(let i=0;i<T;i++){
      const fr=_cacheGet(targetOv,matched[i].t);
      if(!fr) continue;
      const d=fr.renderSlice.data;
      const xoff=i*kk;
      for(let c=0;c<N;c++){
        const y=d[c];
        if(isNaN(y)) continue;
        sumY[c]+=y; sumYY[c]+=y*y; validN[c]++;
        for(let a=0;a<kk;a++) XtY[a*N+c]+=X[xoff+a]*y;
      }
      if((i&7)===7){ _hintTrend('Regression: fitting '+Math.round((i+1)/T*100)+'%…'); await new Promise(r=>setTimeout(r,0)); }
    }
    const minValidN=Math.max(kk+2,Math.ceil(0.5*T));
    const beta=[]; for(let a=0;a<kk;a++) beta.push(new Float32Array(N).fill(NaN));
    const tstat=[]; for(let j=0;j<k;j++) tstat.push(new Float32Array(N).fill(NaN));
    const pval=[]; for(let j=0;j<k;j++) pval.push(new Float32Array(N).fill(NaN));
    const r2=new Float32Array(N).fill(NaN);
    const bc=new Float64Array(kk);
    for(let c=0;c<N;c++){
      const nc=validN[c];
      if(nc<minValidN) continue;
      const dfC=nc-kk;
      for(let a=0;a<kk;a++){
        let s=0; for(let b=0;b<kk;b++) s+=C[a*kk+b]*XtY[b*N+c];
        bc[a]=s;
      }
      let xtyDotB=0; for(let a=0;a<kk;a++) xtyDotB+=bc[a]*XtY[a*N+c];
      const sse=Math.max(0,sumYY[c]-xtyDotB);
      const meanY=sumY[c]/nc;
      const sst=Math.max(1e-12,sumYY[c]-nc*meanY*meanY);
      r2[c]=1-sse/sst;
      const sigma2=sse/dfC;
      for(let a=0;a<kk;a++) beta[a][c]=bc[a];
      for(let j=0;j<k;j++){
        const se=Math.sqrt(Math.max(0,sigma2*C[(j+1)*kk+(j+1)]));
        const t=se>1e-12?bc[j+1]/se:0;
        tstat[j][c]=t;
        const p=_tTestPValue(t,dfC);
        pval[j][c]=p;
        if(opts.sig&&!(p<0.05)){ beta[j+1][c]=NaN; tstat[j][c]=NaN; }
      }
    }
    return {nLat:rs0.nLat,nLon:rs0.nLon,lats:rs0.lats,lons:rs0.lons,
      beta,tstat,pval,r2,k,T,df,srcUnits,standardize,lagDays,
      predNames:predSeries.map(s=>s.name),
      regionName:predSeries.map(s=>s.name).join(' + ')};
  }
  // fits: one or more per-lag results from _fitRegressionSlice (same
  // target/predictors, each just re-run at a different lagDays, paired
  // with a display-ready lagLabel already in the record's own native
  // cadence unit). Unlike Correlation (a single "r" variable, so lag can
  // just be the flat frame list), regression has several DIFFERENT maps
  // per lag (β per predictor, R², t per predictor, p per predictor) — so
  // here the STATISTIC is the selectable "variable" (like a normal
  // overlay's var dropdown) and LAG is what the time slider scrubs,
  // letting you pick "β(ONI)" once and then step through every lag
  // without also stepping through R²/t/p at each one.
  function _buildRegressionOverlay(targetOv,fits,titlePrefix){
    const nv=createOverlay();
    if(!nv) return null;
    const fit0=fits[0];
    const u=fit0.srcUnits||'value';
    const stats=[];
    for(let j=0;j<fit0.k;j++){
      stats.push({key:'beta'+j,label:'β '+fit0.predNames[j],
        dataPerLag:fits.map(f=>f.beta[j+1]),
        unitsPerLag:fits.map(f=>'Δ'+u+' per '+(f.standardize?'1σ of ':'unit ')+f.predNames[j]+' (controlling for the other predictors) — df='+f.df)});
    }
    stats.push({key:'r2',label:'R²',
      dataPerLag:fits.map(f=>f.r2),
      unitsPerLag:fits.map(f=>'fraction of variance explained by all '+f.k+' predictor(s) together (0–1) — df='+f.df)});
    for(let j=0;j<fit0.k;j++){
      stats.push({key:'t'+j,label:'t-stat '+fit0.predNames[j],
        dataPerLag:fits.map(f=>f.tstat[j]),
        unitsPerLag:fits.map(f=>'t-statistic on β('+f.predNames[j]+'), df='+f.df)});
    }
    for(let j=0;j<fit0.k;j++){
      stats.push({key:'p'+j,label:'p-value '+fit0.predNames[j],
        dataPerLag:fits.map(f=>f.pval[j]),
        unitsPerLag:fits.map(f=>'two-tailed p-value on β('+f.predNames[j]+') — smaller = more significant, df='+f.df)});
    }
    nv._regress={srcId:targetOv.id,stats,lags:fits.map(f=>f.lagDays),
      nLat:fit0.nLat,nLon:fit0.nLon,lats:fit0.lats,lons:fit0.lons,regionName:fit0.regionName};
    nv.name=titlePrefix||('Regression: '+(targetOv.name||targetOv.selVar||'layer'));
    nv.selVar=stats[0].key; // first predictor's β
    nv.varOptions=stats.map(s=>({name:s.key,label:s.label}));
    nv.selCmap='RdBu';
    nv.frames=fits.map((f,i)=>({label:f.lagLabel||('lag '+i),localT:i,virtual:true,regressLag:i,sortKey:i}));
    nv.maxTime=nv.frames.length;
    nv.selTime=0; // first lag (or the only one, for a single-lag run)
    nv._fcache=new Map();
    rebuildSlice(nv);
    if(nv.cardEl){
      refreshCardVarPicker(nv);
      const body=nv.cardEl.querySelector('.nc-cb'); if(body) body.style.display='';
      const sw=nv.cardEl.querySelector('.nc-series-wrap'); if(sw) sw.style.display='none';
      const db=nv.cardEl.querySelector('.nc-drop-btn'); if(db) db.style.display='none';
      const badge=nv.cardEl.querySelector('.nc-cname');
      if(badge){ badge.textContent='📈 '+nv.name; badge.classList.remove('nc-empty'); }
      const cmSel=nv.cardEl.querySelector('.nc-cm'); if(cmSel){ cmSel.value=nv.selCmap; updateCmapPrev(nv); }
      updateTimeControls(nv);
    }
    renumberCards(); schedRender(nv);
    document.getElementById('nc-body').style.display='';
    document.getElementById('nc-tog').textContent='▾';
    return nv;
  }
  async function _computeRegressionMap(targetOv,predictors,opts){
    if(!targetOv.frames||targetOv.frames.length<8){ alert('Target layer needs at least 8 time frames.'); return; }
    try{
      _hintTrend('Regression: sampling predictors…');
      await new Promise(r=>setTimeout(r,0));
      const predSeries=[];
      for(let i=0;i<predictors.length;i++){
        const p=predictors[i];
        const s=await _extractBoxIndexSeries(p.srcOv,p.boxSpec,'Predictor '+(i+1)+': ');
        if(s.values.length<8){ alert('Predictor "'+(p.boxSpec.name||'?')+'" has fewer than 8 valid time steps.'); return; }
        predSeries.push({...s,name:p.boxSpec.name||('predictor'+(i+1))});
      }
      const lags=opts.lags&&opts.lags.length?opts.lags:[opts.lagDays||0];
      const lagLabels=opts.lagLabels&&opts.lagLabels.length===lags.length?opts.lagLabels:lags.map(l=>'Lag '+(l>0?'+':'')+l+'d');
      const fits=[],errs=[];
      for(let i=0;i<lags.length;i++){
        _hintTrend(lags.length>1?('Regression: fitting '+lagLabels[i]+' ('+(i+1)+'/'+lags.length+')…'):'Regression: fitting…');
        await new Promise(r=>setTimeout(r,0));
        const fit=await _fitRegressionSlice(targetOv,predSeries,{...opts,lagDays:lags[i]});
        if(!fit||fit.error) errs.push(lagLabels[i]+': '+(fit?.error||'failed'));
        else{ fit.lagLabel=lagLabels[i]; fits.push(fit); }
      }
      if(!fits.length){ alert('Regression failed at every lag —\n'+errs.join('\n')); return; }
      if(errs.length) console.warn('[regression] some lags skipped:',errs.join(' | '));
      const prefix='Regression: '+(targetOv.name||targetOv.selVar||'layer')+' ~ '+predSeries.map(s=>s.name).join(' + ');
      _buildRegressionOverlay(targetOv,fits,prefix);
      console.log('[regression]',prefix,'lags='+fits.length,'df='+fits[0].df,'matched='+fits[0].T);
    }catch(err){
      console.error('[regression] failed:',err);
      alert('Regression failed: '+(err?.message||err));
    }finally{
      _hintTrend(null);
      _hintRegion(null);
    }
  }
  function _openRegressionDialog(ov,opts){
    opts=opts||{};
    document.querySelectorAll('.nc-regr-dlg').forEach(d=>d.remove());
    const srcCandidates=overlays.filter(o=>o.frames&&o.frames.length>=8);
    if(!srcCandidates.length){ alert('No loaded layer with 8+ time frames to use as a predictor source.'); return; }
    if(!ov.frames||ov.frames.length<8){ alert('This layer needs at least 8 time frames as a regression target.'); return; }
    // Lag is entered in whatever native time step the TARGET's own dates
    // resolve to (day/month/year) — a hardcoded "days" field was wrong
    // for e.g. a monthly SST record, where "lag 30" reads as one step
    // instead of one month. Mirrors Correlation's cadence detection.
    const sks=ov.frames.map(f=>f.sortKey).filter(sk=>typeof sk==='number'&&isFinite(sk));
    const looksDated=/^\d{4}-\d{2}-\d{2}/.test(String(ov.frames[0]?.label||''));
    const dated=looksDated&&sks.length===ov.frames.length&&sks.length>1&&sks.every((v,i)=>i===0||v>sks[i-1]);
    const lagUnit=dated?_nativeTrendUnit(_medianGapDays(sks)):{label:'day',days:1};
    const lagUnitAbbrev={day:'d',month:'mo',year:'yr',frame:'fr'}[lagUnit.label]||lagUnit.label;
    const dlg=document.createElement('div');
    dlg.className='nc-regr-dlg';
    dlg.style.cssText='position:fixed;inset:0;z-index:500;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);';
    const box=document.createElement('div');
    box.style.cssText='background:rgba(6,17,28,0.98);border:1px solid rgba(127,208,255,0.4);border-radius:10px;padding:16px 18px;max-width:520px;width:92%;max-height:88vh;overflow:auto;font-family:IBM Plex Mono,monospace;font-size:11px;color:#cfe3f2;box-shadow:0 12px 40px rgba(0,0,0,0.5);';
    let presetHtml='',lastGrp='';
    REGION_PRESETS.forEach((p,i)=>{
      if(p.group&&p.group!==lastGrp){ if(lastGrp) presetHtml+='</optgroup>'; presetHtml+='<optgroup label="'+p.group+'">'; lastGrp=p.group; }
      presetHtml+='<option value="'+i+'">'+p.name+'</option>';
    });
    if(lastGrp) presetHtml+='</optgroup>';
    const srcHtml=srcCandidates.map(o=>'<option value="'+o.id+'">'+(o.name||o.selVar||'layer')+'</option>').join('');
    box.innerHTML='<div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#eaf3fb;">📈 Multiple regression</div>'+
      '<div style="font-size:9.5px;color:#7fa0b8;margin-bottom:12px;line-height:1.45;">Fits target = β₀ + β₁·pred₁ + β₂·pred₂ + … at every grid cell, so each predictor\'s map shows its relationship with the target CONTROLLING FOR the others — e.g. ENSO\'s independent effect on rainfall once IOD and SAM are accounted for. Predictors are region-mean indices (same mechanism as Composite\'s index picker) — presets only here, per-predictor pick/coords/country regions aren\'t available yet.</div>'+
      '<label style="display:block;margin-bottom:10px;">Target (this layer)<div style="margin-top:4px;padding:5px;background:rgba(127,208,255,0.06);border:1px solid rgba(127,208,255,0.18);border-radius:4px;color:#eaf3fb;">'+(ov.name||ov.selVar||'layer')+'</div></label>'+
      '<div id="regr-preds" style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px;"></div>'+
      '<button type="button" id="regr-add" style="width:100%;padding:6px;border-radius:5px;border:1px dashed rgba(127,208,255,0.35);background:transparent;color:#7fd0ff;cursor:pointer;font-family:IBM Plex Mono,monospace;font-size:10px;margin-bottom:12px;">+ Add predictor</button>'+
      '<div style="display:flex;gap:8px;margin-bottom:6px;">'+
        '<label style="flex:1;">Lag min ('+lagUnit.label+'s)<input type="number" id="regr-lmin" value="0" step="1" style="width:100%;margin-top:4px;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;"></label>'+
        '<label style="flex:1;">Lag max ('+lagUnit.label+'s)<input type="number" id="regr-lmax" value="0" step="1" style="width:100%;margin-top:4px;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;"></label>'+
        '<label style="flex:1;">Step<input type="number" id="regr-lstep" value="1" min="1" style="width:100%;margin-top:4px;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;"></label>'+
      '</div>'+
      '<div style="font-size:9px;color:#7a93a8;margin-bottom:10px;">Detected target spacing: <b style="color:#eaf3fb">'+_cadenceLabel(sks)+'</b> — lag steps above are in <b style="color:#eaf3fb">'+lagUnit.label.toUpperCase()+'S</b>. Positive lag = predictors LEAD the target by that many '+lagUnit.label+'s (e.g. ENSO 2 months ahead of rainfall). Leave min=max=0 for a single simultaneous fit (fast). A wider sweep re-runs the full per-cell fit once per lag step — each step costs as much as one regression, so a dozen steps takes roughly a dozen times as long; max 15 steps.</div>'+
      '<label style="display:block;margin:0 0 6px;font-size:10px;cursor:pointer;color:#9fc4dd;">'+
        '<input type="checkbox" id="regr-std" checked style="margin-right:7px;accent-color:#7fd0ff;"> Standardise predictors (β becomes "per 1σ of the predictor")</label>'+
      '<label style="display:block;margin:0 0 12px;font-size:10px;cursor:pointer;color:#9fc4dd;">'+
        '<input type="checkbox" id="regr-sig" style="margin-right:7px;accent-color:#7fd0ff;"> Mask insignificant cells on β/t maps (p ≥ 0.05 → transparent)</label>'+
      '<div style="display:flex;gap:8px;justify-content:flex-end;">'+
        '<button type="button" id="regr-cancel" style="padding:6px 12px;border-radius:5px;border:1px solid rgba(120,170,205,0.3);background:transparent;color:#9fb6c9;cursor:pointer;">Cancel</button>'+
        '<button type="button" id="regr-run" style="padding:6px 14px;border-radius:5px;border:none;background:#7fd0ff;color:#050d16;font-weight:600;cursor:pointer;">Run regression</button></div>';
    dlg.appendChild(box);
    document.body.appendChild(dlg);
    const close=()=>dlg.remove();
    box.querySelector('#regr-cancel').addEventListener('click',close);
    // Close only when BOTH the press and the release land on the bare
    // backdrop — a plain 'click' check alone also fires when a drag that
    // starts on a text field inside the dialog (e.g. selecting/highlighting
    // a lag number by dragging) happens to release outside that field,
    // since the resulting click's target is wherever the mouse came up,
    // not where the drag began.
    let _backdropDown=false;
    dlg.addEventListener('mousedown',e=>{ _backdropDown=(e.target===dlg); });
    dlg.addEventListener('click',e=>{ if(e.target===dlg&&_backdropDown) close(); });
    const predsWrap=box.querySelector('#regr-preds');
    const MAX_PRED=6;
    function addPredRow(srcId,presetIdx){
      if(predsWrap.children.length>=MAX_PRED) return;
      const row=document.createElement('div');
      row.className='regr-pred-row';
      row.style.cssText='display:flex;gap:6px;align-items:center;';
      row.innerHTML='<select class="regr-src" style="flex:1.2;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;">'+srcHtml+'</select>'+
        '<select class="regr-region" style="flex:1.5;padding:4px;background:#0a1828;color:#cfe3f2;border:1px solid rgba(120,170,205,0.3);border-radius:4px;">'+presetHtml+'</select>'+
        '<button type="button" class="regr-rm" style="flex-shrink:0;width:22px;height:22px;border-radius:4px;border:1px solid rgba(255,120,120,0.4);background:transparent;color:#ff9d9d;cursor:pointer;">×</button>';
      if(srcId) row.querySelector('.regr-src').value=srcId;
      if(presetIdx!=null) row.querySelector('.regr-region').value=String(presetIdx);
      row.querySelector('.regr-rm').addEventListener('click',()=>{
        if(predsWrap.children.length>1) row.remove();
      });
      predsWrap.appendChild(row);
    }
    const oniIdx=REGION_PRESETS.findIndex(p=>p.name.indexOf('ONI')===0);
    const naoIdx=REGION_PRESETS.findIndex(p=>p.name.indexOf('NAO')===0);
    addPredRow(ov.id,oniIdx>=0?oniIdx:0);
    addPredRow(ov.id,naoIdx>=0?naoIdx:0);
    box.querySelector('#regr-add').addEventListener('click',()=>addPredRow(ov.id,0));
    predsWrap.addEventListener('change',e=>{
      if(e.target.classList.contains('regr-region')) _flashPresetRegion(REGION_PRESETS[+e.target.value]);
    });
    box.querySelector('#regr-run').addEventListener('click',async()=>{
      const rows=[...predsWrap.querySelectorAll('.regr-pred-row')];
      const predictors=rows.map(row=>{
        const srcId=row.querySelector('.regr-src').value;
        const presetIdx=+row.querySelector('.regr-region').value;
        const srcOv=overlays.find(o=>o.id===srcId);
        const boxSpec=_resolvePresetBox(REGION_PRESETS[presetIdx]);
        return srcOv&&boxSpec?{srcOv,boxSpec}:null;
      }).filter(Boolean);
      if(predictors.length<1){ alert('Add at least one predictor.'); return; }
      const lminRaw=Math.round(+(box.querySelector('#regr-lmin')?.value||0));
      const lmaxRaw=Math.round(+(box.querySelector('#regr-lmax')?.value||0));
      const lstep=Math.max(1,Math.round(+(box.querySelector('#regr-lstep')?.value||1)));
      const lmin=Math.min(lminRaw,lmaxRaw),lmax=Math.max(lminRaw,lmaxRaw);
      const lagsNative=[]; for(let l=lmin;l<=lmax;l+=lstep) lagsNative.push(l);
      if(!lagsNative.length) lagsNative.push(0);
      if(lagsNative.length>15){ alert('That is '+lagsNative.length+' lag steps — narrow the range or increase the step (max 15).'); return; }
      // Sweep values are entered in the target's native cadence (lagUnit)
      // but _fitRegressionSlice shifts against real sortKey DAYS — convert
      // once here, and keep the native value+unit around just for labels.
      const lags=lagsNative.map(l=>Math.round(l*lagUnit.days));
      const lagLabels=lagsNative.map(l=>'Lag '+(l>0?'+':'')+l+lagUnitAbbrev);
      const standardize=!!box.querySelector('#regr-std')?.checked;
      const sig=!!box.querySelector('#regr-sig')?.checked;
      close();
      await _computeRegressionMap(ov,predictors,{lags,lagLabels,standardize,sig});
    });
  }

  function _createDerivedOverlay(terms,formula){
    if(overlays.length>=MAX){ alert('Max '+MAX+' overlays. Remove one first.'); return; }
    const ov=createOverlay();
    if(!ov) return;
    ov._derived={terms,formula};
    ov.name=formula.length>34?formula.slice(0,31)+'…':formula;
    ov.selVar='derived';
    ov.varOptions=[{name:'derived',label:formula}];
    // Plain difference reads best on a diverging map.
    if(/^\s*[A-F]\s*-\s*[A-F]\s*$/.test(formula)) ov.selCmap='RdBu';
    // Virtual time axis: label-only frame stubs matching the LONGEST term
    // source. This makes the derived layer a first-class time series — its
    // own time slider scrubs the computation, Hovmöller (Time–Lat/Lon)
    // plots iterate it, and region time-series extraction covers every
    // timestamp — all through the existing _cacheGet(ov,t) path.
    const longest=terms.map(T=>{
      const s=overlays.find(o=>o.id===T.ovId);
      return s?_termFrames(s,T.varName):[];
    }).reduce((a,b)=>b.length>a.length?b:a,[]);
    // sortKey carried over from the source frames: it's days-since-epoch
    // for dated files, which lets trend analysis on this derived layer fit
    // against real time (slope per YEAR) instead of bare frame index.
    ov.frames=longest.map((f,i)=>({label:f.label||('t='+i),localT:i,virtual:true,
      sortKey:(typeof f.sortKey==='number'&&isFinite(f.sortKey))?f.sortKey:i}));
    // maxTime is a COUNT (see _buildTrendOverlay's comment on the same
    // fix) — this used to store the max index instead, making the
    // derived layer's last frame unreachable from the ◀/▶ buttons/slider.
    ov.maxTime=ov.frames.length;
    ov.selTime=0;
    ov._fcache=new Map();
    updateTimeControls(ov);
    rebuildSlice(ov);
    if(ov.cardEl){
      refreshCardVarPicker(ov);
      const body=ov.cardEl.querySelector('.nc-cb'); if(body) body.style.display='';
      const sw=ov.cardEl.querySelector('.nc-series-wrap'); if(sw) sw.style.display='none';
      const db=ov.cardEl.querySelector('.nc-drop-btn'); if(db) db.style.display='none';
      const badge=ov.cardEl.querySelector('.nc-cname');
      if(badge){ badge.textContent='➗ '+ov.name; badge.classList.remove('nc-empty'); }
    }
    renumberCards();
    schedRender(ov);
    document.getElementById('nc-body').style.display='';
    document.getElementById('nc-tog').textContent='▾';
    console.log('[derived] created:',formula,'terms:',terms.map(T=>T.id+'='+T.varName+'@lev'+T.levIdx).join(', '));
  }

  function createOverlay(){
    if(overlays.length>=MAX){alert('Max '+MAX+' overlays.');return overlays[overlays.length-1];}
    const canvas=document.createElement('canvas');
    const v=layoutViewport();
    canvas.width=Math.round(v.w*v.dpr);canvas.height=Math.round(v.h*v.dpr);
    canvas._dpr=v.dpr;
    canvas.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;display:block;z-index:'+(22+overlays.length*2)+';';
    document.body.insertBefore(canvas,document.body.firstChild);
    const ov={
      id:'ov_'+Date.now(),
      frames:[],       // ← the frame list (merged from 1+ files)
      readers:[],      // open reader handles for cleanup
      selVar:null,     // active variable name
      varOptions:[],   // [{name, label}] from first loaded file
      selLevIdx:null,
      selTime:0, maxTime:0,
      selCmap:CMAP_KEYS[overlays.length%CMAP_KEYS.length],selOpacity:0.45,
      vminOvr:null,vmaxOvr:null,cachedMin:null,cachedMax:null,
      activeSlice:null,canvas,ctx:canvas.getContext('2d'),
      enabled:true,name:'',renderPending:false,cardEl:null,_loopMode:'time',_animFps:2,
      showContours:false,contourCount:12,contourStyle:'synoptic',contourStep:null,_ctrAuto:true,
      selBright:1,selContrast:1,selSaturate:1
    };
    overlays.push(ov);
    buildCard(ov);
    renumberCards();
    return ov;
  }

  /* ---- REMOVE overlay ---- */
  function removeOverlay(ov){
    stopPlay();
    unregisterOverlayFrames(ov);
    ov.readers.forEach(r=>{try{r.close();}catch(e){}});
    ov.ctx.clearRect(0,0,ov.canvas.width,ov.canvas.height);
    if(ov._animTimer)clearInterval(ov._animTimer);
    ov.canvas.remove();
    // The WebGPU overlay lives on its own canvas — remove it too, or a
    // "ghost" of the deleted layer stays painted on screen.
    if(ov._wgpuCanvas){ov._wgpuCanvas.remove();ov._wgpuCanvas=null;ov._wgpu=null;}
    ov.cardEl?.remove();
    const i=overlays.indexOf(ov);if(i>=0)overlays.splice(i,1);
    overlays.forEach((o,idx)=>{
      const z=22+idx*2;
      o.canvas.style.zIndex=z;
      if(o._wgpuCanvas)o._wgpuCanvas.style.zIndex=z-1;
    });
    renumberCards();
    _updateLandFill();
  }

  /* ---- LOAD / APPEND a file to an overlay ---- */
  async function appendFileToOverlay(ov,file,isSeries){
    const isFirst=ov.frames.length===0;
    const label=isFirst?('Reading '+file.name):('Adding '+file.name+'…');
    // Overlay files can take a while to read/decode (large HDF5/GRIB2
    // grids especially) with no other on-screen sign anything is
    // happening — mirror the top-center "working…" banner already used
    // for the NOMADS URL loader and date-range batch loader so it reads
    // consistently across every long-running load in the app.
    const setStatus=(msg,err)=>{ setOvStatus(ov,msg,err); _hintRegion(err?null:msg); };
    setStatus(label);
    try{
      // Sniff format from a tiny header peek before paying for a full read —
      // detectFormat only ever looks at the first 8 bytes internally, so a
      // small slice gives an identical answer to passing the whole buffer.
      const head=await file.slice(0,16).arrayBuffer();
      const fmt=detectFormat(head);
      // h5wasm's WASM heap is hard-capped at 2GB (WebAssembly.Memory
      // maximum — see openHDF5) and the ENTIRE file gets copied into that
      // same capped heap via FS.writeFile before HDF5 can even start
      // decompressing, so a file near/over the cap can never load here
      // regardless of the machine's actual RAM. Catching this up front
      // — before the potentially multi-minute full read — turns a silent
      // hang into an immediate, actionable message.
      const HDF5_SIZE_CAP=1.7*1024*1024*1024;
      if(fmt==='hdf5'&&file.size>HDF5_SIZE_CAP){
        throw new Error('This HDF5/NetCDF-4 file is '+(file.size/1e9).toFixed(2)+' GB — the in-browser HDF5 engine this app uses has a hard ~1.7GB ceiling (its WebAssembly memory is capped at 2GB, and the whole file has to fit inside that cap alongside its own decompression working memory).\n\nSplit it into smaller pieces first, e.g. with NCO:\n  ncks -d valid_time,0,199 "'+file.name+'" part1.nc\nthen load the parts as separate files/series — the app merges them by time automatically.');
      }
      const buf=await file.arrayBuffer();
      let reader;
      if(fmt==='grib1'){
        // GRIB1: convert via Unidata NCSS or advise user
        throw new Error('GRIB1 not yet supported for direct decode. Convert to NetCDF using:\n'+
          '  • Unidata THREDDS/NCSS: https://thredds.ucar.edu\n'+
          '  • eccodes: grib_to_netcdf file.grib output.nc\n'+
          '  • wgrib2: wgrib2 file.grib1 -netcdf output.nc\n'+
          'Then drop the .nc file here.');
      } else if(fmt==='grib2'){
        setStatus(label+' (GRIB2 — decoding 0%…)');
        reader=await openGRIB2(new Uint8Array(buf),file.name,{
          onProgress:(i,n)=>setStatus(label+' (GRIB2 — decoding '+Math.round(i/n*100)+'%…)')
        });
      }
      else if(fmt==='hdf5'){setStatus(label+' (HDF5)');reader=await openHDF5(buf,file.name);}
      else if(fmt==='nc3'){
        // netcdfjs exports the constructor differently across versions:
      // v1.x: window.netcdfjs (the constructor itself)
      // v2.x: window.netcdfjs.NetCDFReader
      // bundled: window.NetCDFReader
      const Cls = window.NetCDFReader
               || window.netcdfjs?.NetCDFReader
               || (typeof window.netcdfjs === 'function' ? window.netcdfjs : null);
      if(!Cls) {
        const msg = 'NetCDF parser not found. window.netcdfjs=' + typeof window.netcdfjs + ', window.NetCDFReader=' + typeof window.NetCDFReader;
        console.error('[GlobeNC]', msg);
        throw new Error(msg);
      }
        reader=wrapNC3Reader(new Cls(buf),file.name);
      } else throw new Error('Unrecognised format (not NetCDF-3 or HDF5)');

      ov.readers.push(reader);
      const grid=discoverGrid(reader);

      if(isFirst){
        // populate variable list from first file
        ov.varOptions=grid.dataVars.map(v=>({name:v.name,
          label:v.name+(getAttr(reader,v.name,'long_name')?' — '+getAttr(reader,v.name,'long_name'):'')
               +(getAttr(reader,v.name,'units')?' ('+getAttr(reader,v.name,'units')+')':'')}));
        ov.selVar=ov.varOptions[0]?.name||null;
        ov.selLevIdx=grid.defaultLevI??0;
        ov.name=file.name;
        const _initGv=(reader.variables||[]).find(x=>x.name===ov.selVar);
        if(_initGv?._levels){ov._gribLevels=_initGv._levels;ov._gribLevUnits=_initGv._levUnits||'hPa';}
        refreshCardVarPicker(ov);
        refreshLevelControls(ov,grid);
      }

      // build frames for the current selVar (match by name if possible)
      const vName=ov.selVar&&grid.dataVars.find(v=>v.name===ov.selVar)?ov.selVar:
                  grid.dataVars[0]?.name;
      if(!vName) throw new Error('No usable data variables found in '+file.name);

      const newFrames=buildFrames(reader,grid,vName);
      ov.frames.push(...newFrames);
      // sort frames chronologically
      ov.frames.sort((a,b)=>a.sortKey-b.sortKey);
      ov.maxTime=ov.frames.length;

      updateTimeControls(ov);
      if(isFirst){ov.cachedMin=null;ov.cachedMax=null;if(ov._fcache)ov._fcache.clear();}
      rebuildSlice(ov);schedRender(ov);
      registerOverlayFrames(ov);

      const nFiles=ov.readers.length,nF=ov.frames.length;
      // Filename is already shown right above by .nc-cname \u2014 repeating it
      // here just made this line overflow and wrap mid-word in the header.
      setStatus('\u2713 '+nF+' frame'+(nF>1?'s':'')+(nFiles>1?' \u00b7 '+nFiles+' files':''));
      _hintRegion(null);
      openOvBody(ov);
    }catch(err){
      console.error('[GlobeNC]',err);
      setStatus('\u26A0 '+file.name+': '+(err.message||String(err)),true);
    }
  }

  /* ---- variable selection ---- */
  function selectVar(ov,name){
    ov.selVar=name;ov.selTime=0;ov.selLevIdx=0;ov.activeSlice=null;ov.renderSlice=null;ov.cachedMin=null;ov.cachedMax=null;
    if(ov._fcache)ov._fcache.clear();
    const _gv=ov.readers?.flatMap(r=>r.variables||[]).find(x=>x.name===name);
    if(_gv?._levels){ov._gribLevels=_gv._levels;ov._gribLevUnits=_gv._levUnits||'hPa';}
    else{ov._gribLevels=null;ov._gribLevUnits='';}
    ov.frames=[];
    ov.readers.forEach(r=>{
      const grid=discoverGrid(r);
      const vName=grid.dataVars.find(v=>v.name===name)?name:grid.dataVars[0]?.name;
      if(vName){ov.frames.push(...buildFrames(r,grid,vName));refreshLevelControls(ov,grid);}
    });
    ov.frames.sort((a,b)=>a.sortKey-b.sortKey);
    ov.maxTime=ov.frames.length;
    updateTimeControls(ov);rebuildSlice(ov);schedRender(ov);registerOverlayFrames(ov);
  }

  /* ---- rebuild current slice from frames ---- */
  /* ---- Build a decimated copy for fast rendering when the grid is huge.
     Full-res slice is kept for CSV extraction; rendering uses this. ---- */
  function buildRenderSlice(slice, lats, lons){
    const { data, nLat, nLon } = slice;
    const MAXDIM = 1024;
    const factor = Math.max(1, Math.ceil(Math.max(nLat, nLon) / MAXDIM));
    if (factor === 1) return { data, nLat, nLon, lats, lons };
    const rLat = Math.ceil(nLat / factor), rLon = Math.ceil(nLon / factor);
    const rData = new Float32Array(rLat * rLon);
    const rLats = new Float32Array(rLat), rLons = new Float32Array(rLon);
    for (let i = 0; i < rLat; i++){
      const si = Math.min(nLat - 1, i * factor); rLats[i] = lats[si];
      for (let j = 0; j < rLon; j++){
        const sj = Math.min(nLon - 1, j * factor);
        if (i === 0) rLons[j] = lons[sj];
        rData[i * rLon + j] = data[si * nLon + sj];
      }
    }
    return { data: rData, nLat: rLat, nLon: rLon, lats: rLats, lons: rLons };
  }

  const FRAME_CACHE_MAX=24;   // floor when a frame is too big to budget many of; see _frameCacheCap
  // Budget-based cache sizing — mirrors the 300MB budget the "Preload
  // frames" button already uses. A flat 24-frame cap meant any animation
  // longer than 24 steps (the norm — a daily-mean month is 28-31, the
  // 250mb wind extracts here are 91, winds.nc is 555) thrashed forever:
  // every loop past frame ~24 evicted-and-redecoded on EVERY pass, which
  // is what "a lot of staggering" during animation with contours on
  // traced back to. Sizing the cap from the actual decoded frame's byte
  // size means realistically-gridded animations now fit ENTIRELY without
  // requiring the manual Preload step; only very large grids fall back
  // toward the old fixed floor.
  function _frameCacheCap(bytesPerFrame,floor){
    return Math.max(floor||FRAME_CACHE_MAX, Math.floor(300e6/Math.max(1,bytesPerFrame)));
  }

  function _decodeFrame(ov,t){
    const f=ov.frames[t];
    const isCurv=!!f.grid.curvGrid||f.grid.proj==='curvilinear';
    const isProjected=(f.grid.proj&&f.grid.proj!=='latlon'&&!isCurv);
    const MAXDIM=isProjected||isCurv?420:1024;
    const cg=f.grid.curvGrid;
    // For projected (Lambert/polar-stereo/etc.) grids, grid.lats/lons are
    // FLAT per-point arrays (length Nx*Ny) — the true row/col counts live
    // in dimMap (populated by discoverGrid from the parser's own Nx/Ny),
    // NOT in lats.length (which would just be the total point count).
    const srcRows=cg?cg.nRow:(isProjected&&f.grid.latV?(f.grid.dimMap[f.grid.latV]||0):(f.grid.lats?f.grid.lats.length:0));
    const srcCols=cg?cg.nCol:(isProjected&&f.grid.lonV?(f.grid.dimMap[f.grid.lonV]||0):(f.grid.lons?f.grid.lons.length:0));
    // Projected grids used to always decode/render at full native
    // resolution (factor pinned to 1) because decimating a flat per-point
    // coordinate array needs special handling that wasn't wired up — for a
    // 1300x900 polar-stereo grid or a ~1800x1900 Lambert grid that's over a
    // million points individually forward-projected (each a few trig calls)
    // on EVERY render. That's what made large regional GRIB2 overlays
    // (HRRR-AK, GEFS, NAEFS, AQM, GLWU...) freeze the tab. Cap them exactly
    // like lat/lon and curvilinear grids already are.
    const factor=Math.max(1,Math.ceil(Math.max(srcRows||1,srcCols||1)/MAXDIM));
    const act=extractSlice(f.reader,f.grid,f.varName,f.localT,factor,ov.selLevIdx??f.grid.defaultLevI??0);
    if(!act) return null;
    let lats=f.grid.lats, lons=f.grid.lons;
    if(isCurv&&cg&&f.grid.latV&&f.grid.lonV){
      const cc=loadDecimatedCoords(f.reader,f.grid.latV,f.grid.lonV,cg.nRow,cg.nCol,factor);
      if(cc){lats=cc.lats;lons=cc.lons;}
    } else if(isProjected&&factor>1&&lats&&lons&&lats.length===srcRows*srcCols){
      const sl=new Float32Array(act.nLat*act.nLon), so=new Float32Array(act.nLat*act.nLon);
      for(let i=0;i<act.nLat;i++){
        const si=Math.min(srcRows-1,i*factor);
        for(let j=0;j<act.nLon;j++){
          const sj=Math.min(srcCols-1,j*factor), k=si*srcCols+sj;
          sl[i*act.nLon+j]=lats[k]; so[i*act.nLon+j]=lons[k];
        }
      }
      lats=sl; lons=so;
    } else if(!isProjected&&factor>1){
      const gLat=srcRows, gLon=srcCols;
      const sl=new Float32Array(act.nLat), so=new Float32Array(act.nLon);
      for(let i=0;i<sl.length;i++) sl[i]=lats[Math.min(gLat-1,i*factor)];
      for(let j=0;j<so.length;j++) so[j]=lons[Math.min(gLon-1,j*factor)];
      lats=sl; lons=so;
    }
    return {activeSlice:act,
            renderSlice:{data:act.data,nLat:act.nLat,nLon:act.nLon,lats,lons}};
  }
  // ══ GENERALIZED DERIVED LAYERS ═══════════════════════════════
  // A derived layer is defined by named TERMS + a FORMULA:
  //   terms:   [{id:'A', ovId, varName, levIdx, timeMode:'sync'|<int>}]
  //   formula: 'sqrt(A*A+B*B)'   (whitelist-compiled, Math.* functions)
  // Each term can reference ANY variable / level / time of ANY overlay —
  // wind speed from U+V, thickness across two pressure levels, potential
  // temperature from TMP+PRES, anomalies across two times, etc.
  // Term slices are extracted straight from the readers (independent of
  // what variable the source overlay is displaying), all terms after the
  // first are NaN-aware-bilinear resampled onto term A's grid, and the
  // formula is evaluated cellwise; NaN in any operand → NaN out.
  function _termFrames(srcOv,varName){
    srcOv._termFrames=srcOv._termFrames||{};
    if(srcOv._termFrames[varName]) return srcOv._termFrames[varName];
    const frames=[];
    (srcOv.readers||[]).forEach(r=>{
      try{
        const grid=discoverGrid(r);
        if(grid.dataVars.find(v=>v.name===varName)) frames.push(...buildFrames(r,grid,varName));
      }catch(e){}
    });
    frames.sort((a,b)=>a.sortKey-b.sortKey);
    srcOv._termFrames[varName]=frames;
    return frames;
  }
  function _decodeTermSlice(frames,t,levSpec){
    const f=frames[Math.max(0,Math.min(t,frames.length-1))];
    if(!f) return null;
    const isProjected=(f.grid.proj&&f.grid.proj!=='latlon');
    const MAXDIM=isProjected?420:1024;
    // Same distinction as _decodeFrame: for projected grids lats/lons are
    // flat per-point arrays, so their true row/col counts come from dimMap
    // (Ny/Nx), not from lats.length (the total point count).
    const gLat=isProjected&&f.grid.latV?(f.grid.dimMap[f.grid.latV]||0):(f.grid.lats?f.grid.lats.length:0);
    const gLon=isProjected&&f.grid.lonV?(f.grid.dimMap[f.grid.lonV]||0):(f.grid.lons?f.grid.lons.length:0);
    const factor=Math.max(1,Math.ceil(Math.max(gLat,gLon)/MAXDIM));
    let act;
    if(levSpec==='mean'||levSpec==='sum'){
      // Vertical aggregation across ALL levels — enables thickness-style
      // and column-integrated (IVT-like) quantities directly in a term.
      // Level count: prefer NetCDF-style grid.levels; fall back to the
      // GRIB2 per-variable level list (each level is a separate message),
      // same source the level dropdown itself now uses.
      const gv=f.reader?.variables?.find(x=>x.name===f.varName);
      const nl=(f.grid.levels&&f.grid.levels.length)||(gv?._levels?.length)||1;
      let acc=null,ref=null,cnt=0;
      for(let li=0;li<nl;li++){
        const a=extractSlice(f.reader,f.grid,f.varName,f.localT,factor,li);
        if(!a) continue;
        if(!acc){acc=new Float32Array(a.data.length);ref=a;}
        for(let k=0;k<acc.length;k++){
          const v=a.data[k];
          if(isNaN(acc[k])) continue;
          if(isNaN(v)) acc[k]=NaN; else acc[k]+=v;
        }
        cnt++;
      }
      if(!acc||!cnt) return null;
      if(levSpec==='mean'){ for(let k=0;k<acc.length;k++) acc[k]/=cnt; }
      act={data:acc,nLat:ref.nLat,nLon:ref.nLon,units:ref.units};
    } else {
      act=extractSlice(f.reader,f.grid,f.varName,f.localT,factor,(levSpec|0)??f.grid.defaultLevI??0);
    }
    if(!act) return null;
    let lats=f.grid.lats, lons=f.grid.lons;
    if(isProjected&&factor>1&&lats&&lons&&lats.length===gLat*gLon){
      const sl=new Float32Array(act.nLat*act.nLon), so=new Float32Array(act.nLat*act.nLon);
      for(let i=0;i<act.nLat;i++){
        const si=Math.min(gLat-1,i*factor);
        for(let j=0;j<act.nLon;j++){
          const sj=Math.min(gLon-1,j*factor), k=si*gLon+sj;
          sl[i*act.nLon+j]=lats[k]; so[i*act.nLon+j]=lons[k];
        }
      }
      lats=sl; lons=so;
    } else if(!isProjected&&factor>1){
      const sl=new Float32Array(act.nLat), so=new Float32Array(act.nLon);
      for(let i=0;i<sl.length;i++) sl[i]=lats[Math.min(gLat-1,i*factor)];
      for(let j=0;j<so.length;j++) so[j]=lons[Math.min(gLon-1,j*factor)];
      lats=sl; lons=so;
    }
    return {data:act.data,nLat:act.nLat,nLon:act.nLon,lats,lons,units:act.units||''};
  }
  // NaN-aware bilinear resample of slice B onto slice A's grid.
  function _resampleOntoA(B,A){
    if(B.nLat===A.nLat&&B.nLon===A.nLon&&B.lats===A.lats&&B.lons===A.lons) return B.data;
    const out=new Float32Array(A.nLat*A.nLon);
    const bLat0=B.lats[0], bLat1=B.lats[B.lats.length-1];
    const bLon0=B.lons[0], bLon1=B.lons[B.lons.length-1];
    const bLonStep=B.nLon>1?(bLon1-bLon0)/(B.nLon-1):0;
    // Global lon axis (spans ~360° end-to-end, one more step closing the
    // circle) — true for essentially every whole-earth grid whether stored
    // 0..359.x (common GRIB/reanalysis convention) or -180..179.x (common
    // NetCDF convention). A derived layer can combine terms from sources
    // that use different conventions (this app normalises GRIB lons at
    // ingest but not every NetCDF source uses the same axis) — without
    // wrapping the target lon into B's own window first, points past B's
    // start meridian clamped to B's edge column instead of the correct
    // wrapped cell, corrupting roughly half of any cross-convention result.
    const bWraps=B.nLon>2&&Math.abs(Math.abs(bLon1-bLon0)+Math.abs(bLonStep)-360)<1.0;
    for(let r=0;r<A.nLat;r++){
      const la=A.lats[r];
      let fr=(la-bLat0)/((bLat1-bLat0)||1)*(B.nLat-1);
      fr=Math.max(0,Math.min(B.nLat-1,fr));
      const r0=Math.floor(fr), r1=Math.min(B.nLat-1,r0+1), rf=fr-r0;
      for(let c=0;c<A.nLon;c++){
        let lo=A.lons[c];
        if(bWraps) lo=bLon0+(((lo-bLon0)%360)+360)%360;
        let fc=(lo-bLon0)/((bLon1-bLon0)||1)*(B.nLon-1);
        fc=Math.max(0,Math.min(B.nLon-1,fc));
        const c0=Math.floor(fc), c1=bWraps?(c0+1)%B.nLon:Math.min(B.nLon-1,c0+1), cf=fc-c0;
        const b00=B.data[r0*B.nLon+c0], b01=B.data[r0*B.nLon+c1];
        const b10=B.data[r1*B.nLon+c0], b11=B.data[r1*B.nLon+c1];
        let s=0,w=0;
        if(!isNaN(b00)){const ww=(1-cf)*(1-rf);s+=b00*ww;w+=ww;}
        if(!isNaN(b01)){const ww=cf*(1-rf);s+=b01*ww;w+=ww;}
        if(!isNaN(b10)){const ww=(1-cf)*rf;s+=b10*ww;w+=ww;}
        if(!isNaN(b11)){const ww=cf*rf;s+=b11*ww;w+=ww;}
        out[r*A.nLon+c]=w>1e-9?s/w:NaN;
      }
    }
    return out;
  }
  const _FORMULA_FNS=['sqrt','abs','pow','min','max','log','exp','sin','cos','tan','atan2','floor','ceil','round','sign','hypot'];
  function _compileFormula(expr,termIds){
    let cleaned=String(expr).trim().replace(/\^/g,'**');
    // whitelist characters first
    if(!/^[\s0-9+\-*/%().,A-Za-z_]*$/.test(cleaned)) throw new Error('Formula contains invalid characters');
    // every identifier must be a term id or an allowed function/constant
    const ids=cleaned.match(/[A-Za-z_][A-Za-z_0-9]*/g)||[];
    for(const id of ids){
      if(termIds.includes(id)) continue;
      if(_FORMULA_FNS.includes(id)||id==='PI'||id==='E') continue;
      throw new Error('Unknown symbol in formula: "'+id+'" (terms: '+termIds.join(', ')+')');
    }
    const body='return '+cleaned
      .replace(new RegExp('\\b('+_FORMULA_FNS.join('|')+')\\b','g'),'Math.$1')
      .replace(/\bPI\b/g,'Math.PI').replace(/\bE\b/g,'Math.E')+';';
    return new Function(...termIds,body);
  }
  function _computeDerivedSlice(ov,t){
    const spec=ov._derived; if(!spec||!spec.terms||!spec.terms.length) return null;
    const termSlices=[];
    for(const T of spec.terms){
      const srcOv=overlays.find(o=>o.id===T.ovId);
      if(!srcOv||!srcOv.readers||!srcOv.readers.length) return null;
      const frames=_termFrames(srcOv,T.varName);
      if(!frames.length) return null;
      // 'sync' follows the DERIVED layer's own time slider: scrubbing the
      // derived overlay recomputes at every timestamp, and Hovmöller /
      // region tools iterate its full time axis like any other overlay.
      const tt=(T.timeMode==='sync')?Math.min(t,frames.length-1):(T.timeMode|0);
      const sl=_decodeTermSlice(frames,tt,T.levIdx);
      if(!sl) return null;
      termSlices.push(sl);
    }
    const A0=termSlices[0];
    // Quality: resample everything onto the FINEST grid among the terms,
    // not blindly term A's. If A is 1° reanalysis and B is 0.25° GFS the
    // old behaviour degraded the whole result to 1°.
    let A=A0;
    for(const sl of termSlices){ if(sl.nLat*sl.nLon>A.nLat*A.nLon) A=sl; }
    const datas=termSlices.map(sl=>sl===A?sl.data:_resampleOntoA(sl,A));
    // Units heuristic: linear combinations (+/- and scalar constants) of
    // same-unit terms keep the unit, as does the wind-speed form
    // sqrt(A*A+B*B). Anything else (products, ratios, mixed units) → blank.
    let units='';
    {
      const us=termSlices.map(sl=>sl.units||'');
      const sameU=us.length&&us.every(u=>u===us[0])&&us[0];
      if(sameU){
        const linear=/^[\sA-F0-9.+\-*/()]*$/.test(spec.formula)&&!/[A-F]\s*[*/]\s*[A-F]/.test(spec.formula);
        const speed=/^\s*sqrt\(\s*[A-F]\s*\*\s*[A-F]\s*\+\s*[A-F]\s*\*\s*[A-F]\s*\)\s*$/.test(spec.formula);
        if(linear||speed) units=us[0];
      }
    }
    let fn;
    try{ fn=spec._fn||(spec._fn=_compileFormula(spec.formula,spec.terms.map(T=>T.id))); }
    catch(e){ console.warn('[derived] formula error:',e.message); return null; }
    const N=A.nLat*A.nLon, out=new Float32Array(N);
    const nT=datas.length, vals=new Array(nT);
    for(let i=0;i<N;i++){
      let bad=false;
      for(let k=0;k<nT;k++){ const v=datas[k][i]; if(isNaN(v)){bad=true;break;} vals[k]=v; }
      if(bad){ out[i]=NaN; continue; }
      const r=fn(...vals);
      out[i]=(typeof r==='number'&&isFinite(r))?r:NaN;
    }
    return {activeSlice:{data:out,nLat:A.nLat,nLon:A.nLon,units,lats:A.lats,lons:A.lons},
            renderSlice:{data:out,nLat:A.nLat,nLon:A.nLon,lats:A.lats,lons:A.lons}};
  }
  function _cacheGet(ov,t){
    if(ov._trend){
      const tr=ov._trend;
      const slices=tr.frames||[{data:tr.data,n:tr.n,label:'Full series'}];
      const si=Math.max(0,Math.min(slices.length-1,t|0));
      const sl=slices[si];
      const cacheKey='T|'+si;
      if(ov._fcache&&ov._fcache.has(cacheKey)) return ov._fcache.get(cacheKey);
      // Units string is deliberately verbose: a trend slope is meaningless
      // without knowing (a) what real-world time step it's normalized to,
      // and (b) how far apart the source frames actually were. The report
      // unit MATCHES the data's own cadence (per day for daily/sub-daily/
      // weekly data, per month for month-ish spacing, per year only once
      // frames are that far apart or farther) — annualizing a slope fit
      // from e.g. 2 weeks of daily frames would extrapolate a linear
      // trend across a span ~26x longer than what was actually observed.
      const _xu=sl.xUnits&&sl.xUnits!=='per frame'
        ? sl.xUnits.toUpperCase()+' (real dates'+(sl.cadence?', '+sl.cadence:'')+')'
        : 'per FRAME-STEP (no dates found — NOT real time; source cadence unknown)';
      const d={activeSlice:{data:sl.data,nLat:tr.nLat,nLon:tr.nLon,
                 units:(sl.srcUnits?sl.srcUnits+' ':'')+_xu+' — '+sl.n+' frames fitted'},
               renderSlice:{data:sl.data,nLat:tr.nLat,nLon:tr.nLon,lats:tr.lats,lons:tr.lons}};
      if(!ov._fcache) ov._fcache=new Map();
      ov._fcache.set(cacheKey,d);
      return d;
    }
    if(ov._corr){
      const cr=ov._corr;
      const slices=cr.frames;
      const si=Math.max(0,Math.min(slices.length-1,t|0));
      const sl=slices[si];
      const cacheKey='C|'+si;
      if(ov._fcache&&ov._fcache.has(cacheKey)) return ov._fcache.get(cacheKey);
      const d={activeSlice:{data:sl.data,nLat:cr.nLat,nLon:cr.nLon,
                 units:'r (Pearson) — '+(sl.matchedN??sl.n)+' matched frames'+(sl.stride>1?' (stride '+sl.stride+')':'')},
               renderSlice:{data:sl.data,nLat:cr.nLat,nLon:cr.nLon,lats:cr.lats,lons:cr.lons}};
      if(!ov._fcache) ov._fcache=new Map();
      ov._fcache.set(cacheKey,d);
      return d;
    }
    if(ov._composite){
      const cp=ov._composite;
      const slices=cp.frames;
      const si=Math.max(0,Math.min(slices.length-1,t|0));
      const sl=slices[si];
      const cacheKey='M|'+si;
      if(ov._fcache&&ov._fcache.has(cacheKey)) return ov._fcache.get(cacheKey);
      const d={activeSlice:{data:sl.data,nLat:cp.nLat,nLon:cp.nLon,units:sl.units||sl.label},
               renderSlice:{data:sl.data,nLat:cp.nLat,nLon:cp.nLon,lats:cp.lats,lons:cp.lons}};
      if(!ov._fcache) ov._fcache=new Map();
      ov._fcache.set(cacheKey,d);
      return d;
    }
    if(ov._eof){
      const ef=ov._eof;
      const slices=ef.frames;
      const si=Math.max(0,Math.min(slices.length-1,t|0));
      const sl=slices[si];
      const cacheKey='E|'+si;
      if(ov._fcache&&ov._fcache.has(cacheKey)) return ov._fcache.get(cacheKey);
      const d={activeSlice:{data:sl.data,nLat:ef.nLat,nLon:ef.nLon,units:sl.units||sl.label},
               renderSlice:{data:sl.data,nLat:ef.nLat,nLon:ef.nLon,lats:ef.lats,lons:ef.lons}};
      if(!ov._fcache) ov._fcache=new Map();
      ov._fcache.set(cacheKey,d);
      return d;
    }
    if(ov._regress){
      const rg=ov._regress;
      const stat=rg.stats.find(s=>s.key===ov.selVar)||rg.stats[0];
      const li=Math.max(0,Math.min(rg.lags.length-1,t|0));
      const cacheKey='RG|'+stat.key+'|'+li;
      if(ov._fcache&&ov._fcache.has(cacheKey)) return ov._fcache.get(cacheKey);
      const data=stat.dataPerLag[li], units=stat.unitsPerLag[li]||stat.label;
      const d={activeSlice:{data,nLat:rg.nLat,nLon:rg.nLon,units},
               renderSlice:{data,nLat:rg.nLat,nLon:rg.nLon,lats:rg.lats,lons:rg.lons}};
      if(!ov._fcache) ov._fcache=new Map();
      ov._fcache.set(cacheKey,d);
      return d;
    }
    if(ov._derived){
      // Derived layers compute on demand; the cache key captures every
      // input that affects the result — each term's binding plus, for
      // 'sync' terms, the source overlay's current time — so the layer
      // recomputes exactly when a relevant source changes and not before.
      if(!ov._fcache) ov._fcache=new Map();
      const spec=ov._derived;
      const key='D|'+t+'|'+spec.formula+'|'+(spec.terms||[]).map(T=>{
        const s=overlays.find(o=>o.id===T.ovId);
        return T.id+':'+T.ovId+':'+T.varName+':'+T.levIdx+':'+T.timeMode+':'+(s?(s.frames?.length||0):0);
      }).join('|');
      if(ov._fcache.has(key)){ const v=ov._fcache.get(key); ov._fcache.delete(key); ov._fcache.set(key,v); return v; }
      let dv=null; try{ dv=_computeDerivedSlice(ov,t); }catch(e){ console.warn('[derived] compute failed:',e.message); dv=null; }
      if(dv){
        // LRU-cap instead of clearing: region time-series, Hovmöller and
        // CSV-all iterate every timestep — a single-entry cache forced a
        // full recompute (raw decode included) per step per tool.
        ov._fcache.set(key,dv);
        const cap=Math.max(_frameCacheCap((dv.renderSlice?.data?.length||0)*4,24), ov._cacheMax||0);
        ov._frameCacheCap=cap;
        while(ov._fcache.size>cap) ov._fcache.delete(ov._fcache.keys().next().value);
      }
      return dv;
    }
    if(!ov._fcache) ov._fcache=new Map();
    const key=(ov.selVar||'')+'|'+t+'|'+(ov.selLevIdx??0);
    if(ov._fcache.has(key)){const v=ov._fcache.get(key);ov._fcache.delete(key);ov._fcache.set(key,v);return v;}
    let v=null;
    try{ v=_decodeFrame(ov,t); }catch(e){ v=null; }
    if(v){
      ov._fcache.set(key,v);
      const cap=Math.max(_frameCacheCap((v.renderSlice?.data?.length||0)*4,FRAME_CACHE_MAX), ov._cacheMax||0);
      ov._frameCacheCap=cap;
      while(ov._fcache.size>cap) ov._fcache.delete(ov._fcache.keys().next().value);
    }
    return v;
  }
  function rebuildSlice(ov){
    // Derived layers own no frames — they compute from their sources, so
    // skip the frame-count guard and always attempt a derived slice.
    if(!ov._derived && !ov._trend && !ov._corr && !ov._composite && !ov._eof && !ov._regress && (!ov.frames.length||ov.selTime>=ov.frames.length)){ov.activeSlice=null;ov.renderSlice=null;return;}
    if(ov._derived || ov._composite || ov._corr || ov._trend || ov._eof || ov._regress){
      // Each "frame" of these virtual overlays can carry a completely
      // different natural value range — composite's raw-units hi/lo
      // composites vs. its small delta diff frame, correlation's r per
      // lag, trend's slope per date-range window. A range cached from
      // one frame is meaningless (or actively clips/washes out) applied
      // to another, so recompute fresh on every frame switch instead of
      // reusing whatever was cached when the overlay was first built.
      ov.cachedMin=null; ov.cachedMax=null;
    }
    const hit=_cacheGet(ov,ov.selTime);
    if(hit){
      ov.activeSlice=hit.activeSlice; ov.renderSlice=hit.renderSlice;
      if(ov.cachedMin==null){
        const [mn,mx]=computeAutoRange(ov.activeSlice);ov.cachedMin=mn;ov.cachedMax=mx;
        syncRangeInputs(ov);
      }
      // Prefetch the next frame in the background so playback never stalls.
      // Skipped for derived layers: their cache key differs, so the check
      // below always missed and the compute evicted the visible frame.
      if(!ov._derived && ov.frames.length>1){
        const nt=(ov.selTime+1)%ov.frames.length;
        const nkey=(ov.selVar||'')+'|'+nt+'|'+(ov.selLevIdx??0);
        if(!ov._fcache.has(nkey) && !ov._prefetching){
          ov._prefetching=true;
          setTimeout(()=>{ try{_cacheGet(ov,nt);}finally{ov._prefetching=false;} },25);
        }
      }
    } else { ov.activeSlice=null; ov.renderSlice=null; }
    if(ov._syncStepHint) ov._syncStepHint();
    _notifyFrameChange(ov);
  }
  /* live updates: open plot windows + hover readout follow frame changes */
  const _plotWins=[];
  let _lastMouse=null;
  window._refreshAllPlotWins=()=>{for(const p of _plotWins){try{p.refresh();}catch(e){}}};
  function _notifyFrameChange(ov){
    for(const p of _plotWins){ if(p.ov===ov){ try{p.refresh();}catch(e){} } }
    if(_lastMouse) _updateHoverAt(_lastMouse.x,_lastMouse.y);
  }

  /* ---- RENDER ---- */
  /* ---- RENDER — uses d3's own proj.invert() so it aligns with ANY
     file and any projection state. DPR-aware for HiDPI displays. ---- */
  function schedRender(ov){
    ov._renderDirty=true;
    ov._renderSnap={
      rotate:api.projection.rotate().slice(),
      translate:api.projection.translate().slice(),
      scale:api.projection.scale(),
      dpr:window.devicePixelRatio||ov.canvas._dpr||1
    };
    if(ov._renderBusy) return;
    ov._renderBusy=true;
    // Deferred one extra tick past the rAF callback (setTimeout, which
    // browsers schedule after the current frame's paint) before running
    // doRender — a month/timeline change (invalidateSlice + rebuildSlice,
    // possibly a cache-miss data decode) used to run synchronously inside
    // the SAME rAF callback slot the particle system's independent frame()
    // loop competes for; if either one runs long, the other's callback for
    // that tick gets pushed out, reading as the flow animation "staggering"
    // whenever an overlay animation/timeline change fires. Letting the
    // browser paint first means the two heavy loops take turns across
    // frames instead of fighting over the same one.
    //
    // With 2+ overlays active, a single timeline change invalidates all
    // of them at once — they'd all land in this SAME deferred tick and
    // still serialize back-to-back, just shifted by one frame instead of
    // fixing the underlying contention. Stagger each overlay's defer by
    // its index (~1 extra frame apart, capped) so a multi-overlay render
    // spreads across several frames instead of bunching into one.
    const _ovIdx=overlays.indexOf(ov);
    const _staggerMs=Math.min(_ovIdx,4)*16;
    requestAnimationFrame(()=>{
      const _run=async()=>{
        while(ov._renderDirty){
          ov._renderDirty=false;
          await doRender(ov);
        }
        ov._renderBusy=false;
      };
      // The setTimeout stage's whole purpose is dodging contention with the
      // particle frame() loop sharing this rAF tick — but frame() itself
      // SKIPS particle rendering entirely while dragging (see the `if
      // (dragging){...return;}` early-out in _gpuPFrame/frame()), so there
      // is no contention to dodge during a drag. Paying the extra macrotask
      // hop anyway there just adds pure latency between the pointer moving
      // and the overlay catching up — the "overlay doesn't track the globe,
      // there's a delay" symptom. Skip straight to rendering while dragging;
      // keep the deferred/staggered path for everything else (timeline
      // changes, multi-overlay animation) where the contention is real.
      if(api.isDragging) _run();
      else setTimeout(_run,_staggerMs);
    });
  }
  async function renderOverlayNow(ov){
    if(ov._renderNowBusy){ ov._renderNowDirty=true; return; }
    ov._renderNowBusy=true;
    do{
      ov._renderNowDirty=false;
      ov._renderSnap={
        rotate:api.projection.rotate().slice(),
        translate:api.projection.translate().slice(),
        scale:api.projection.scale(),
        dpr:window.devicePixelRatio||ov.canvas._dpr||1
      };
      await doRender(ov);
    }while(ov._renderNowDirty);
    ov._renderNowBusy=false;
  }

  /* ===== WebGL2 GPU renderer (opt-in) =====
     Uses the SAME verified rotation matrix as the CPU path:
     M = Ry(-lam0)*Rx(phi0)*Rz(gam0), validated against d3.projection.invert()
     for 212 pixels at max error 0.0000°. Renders into an offscreen GL canvas,
     then composites onto the 2D overlay canvas. Any failure → return false. */
  function _getGL(ov,W,H){
    if(_glMaxDim&&(W>_glMaxDim||H>_glMaxDim)){
      if(!_getGL._warnedSize){
        console.warn('[globe-nc] overlay render size '+W+'x'+H+' exceeds this GPU\'s max WebGL2 render-target size ('+_glMaxDim+'px) — using CPU rendering for this overlay.');
        _getGL._warnedSize=true;
      }
      return null;
    }
    if(ov._gl && ov._glCanvas && ov._glCanvas.width===W && ov._glCanvas.height===H) return ov._gl;
    const c=ov._glCanvas||document.createElement('canvas');
    if(!ov._glCanvas){
      // Losing a context (common on mobile under GPU memory pressure, e.g.
      // several full-viewport overlay layers at once) previously left this
      // overlay silently blank/broken for the rest of the session. Recover
      // by dropping the cached handles so the next render call rebuilds a
      // fresh context+program instead of hammering a dead one.
      c.addEventListener('webglcontextlost',(e)=>{
        e.preventDefault();
        console.warn('[globe-nc] WebGL2 context lost for an overlay (likely GPU memory pressure) — will rebuild and retry.');
        ov._gl=null; ov._glCanvas=null;
      });
      c.addEventListener('webglcontextrestored',()=>{ schedRender(ov); });
    }
    c.width=W;c.height=H; ov._glCanvas=c;
    const gl=c.getContext('webgl2',{premultipliedAlpha:false,alpha:true,preserveDrawingBuffer:true});
    if(!gl){
      if(!_getGL._warned){
        console.warn('[globe-nc] WebGL2 context creation FAILED — overlay is using slow per-pixel CPU rendering. Check hardware acceleration in browser settings.');
        _getGL._warned=true;
      }
      return null;
    }
    const vs=`#version 300 es
      in vec2 p; out vec2 uv;
      void main(){ uv=p*0.5+0.5; gl_Position=vec4(p,0.0,1.0); }`;
    const fs=`#version 300 es
      precision highp float;
      in vec2 uv; out vec4 frag;
      uniform sampler2D dataTex, cmapTex;
      uniform vec2 centre, size; uniform float R;
      uniform vec3 rot; uniform float alpha;
      uniform vec4 grid;
      uniform float latFlip;
      uniform float uMoving;
      const float PI=3.14159265359;
      // Catmull-Rom cubic weights (no ringing, smooth, 4-tap)
      // w0..w3 for taps at offset -1,0,+1,+2 from floor
      void cubicWeights(float t, out float w0,out float w1,out float w2,out float w3){
        float t2=t*t, t3=t2*t;
        w0=-0.5*t3+     t2-0.5*t;
        w1= 1.5*t3-2.5*t2     +1.0;
        w2=-1.5*t3+2.0*t2+0.5*t;
        w3= 0.5*t3-0.5*t2;
      }
      float sampleTex(vec2 uv2){ return texture(dataTex,uv2).a>0.5?texture(dataTex,uv2).r:-1.0; }
      void main(){
        vec2 px=uv*size;
        vec2 d=(px-centre)/R;
        float r2=dot(d,d);
        float edgeFade=clamp((1.0-sqrt(r2))*R/1.5,0.0,1.0);
        if(r2>1.0){frag=vec4(0);return;}
        float dz=sqrt(1.0-r2);
        vec3 pv=vec3(d.x,d.y,dz);
        float D=PI/180.0;
        float cl=cos(rot.x*D),sl=sin(rot.x*D);
        float cp=cos(rot.y*D),sp=sin(rot.y*D);
        float cg=cos(rot.z*D),sg=sin(rot.z*D);
        mat3 M=mat3(
          cl*cg-sl*sg*sp, sg*cp, sl*cg+cl*sg*sp,
         -cl*sg-sl*cg*sp, cg*cp,-sl*sg+cl*cg*sp,
         -sl*cp,-sp,cl*cp);
        vec3 q=M*pv;
        float lat=asin(clamp(q.y,-1.0,1.0))/D;
        float lon=atan(q.x,q.z)/D;
        float L=lon;
        if(L<grid.x)L+=360.0; if(L>grid.y)L-=360.0;
        if(L<grid.x)L+=360.0; if(L>grid.y)L-=360.0;
        float fx=(L-grid.x)/(grid.y-grid.x+1e-6);
        float fy=latFlip>0.5?(grid.w-lat)/(grid.w-grid.z+1e-6):(lat-grid.z)/(grid.w-grid.z+1e-6);
        if(fx<0.0||fx>1.0||fy<0.0||fy>1.0){frag=vec4(0);return;}
        // grid.x/y/z/w are grid-POINT (cell-CENTER) coordinates — lons[0]..
        // lons[nLon-1] span only (nLon-1) intervals, not the texture's full
        // nLon-texel width. Feeding that raw [0,1] fraction straight into
        // texture()'s UV (which addresses texel EDGES, i.e. 0..1 spans N
        // texels, not N-1) shifts every sample by half a texel toward the
        // lon/lat origin corner. Half a texel is invisible on a fine grid
        // (1440 columns → ~0.125° shift) but glaring on a coarse one (180
        // columns → a full 1° shift) — exactly what made a low-res SST
        // file's coastline look offset from the country-border overlay.
        // Rescaling onto texel-CENTER addressing fixes every resolution
        // the same way.
        vec2 dim=vec2(textureSize(dataTex,0));
        fx=(fx*(dim.x-1.0)+0.5)/dim.x;
        fy=(fy*(dim.y-1.0)+0.5)/dim.y;
        vec4 sBase=texture(dataTex,vec2(fx,fy));
        if(sBase.a<0.5){frag=vec4(0);return;}
        float t=0.0;
        if(uMoving>0.5){
          t=clamp(sBase.r,0.0,1.0);
        } else {
          vec2 texPos=vec2(fx,fy)*dim-0.5;
          vec2 tf=fract(texPos);
          vec2 base=(floor(texPos)+0.5)/dim;
          vec2 sx=vec2(1.0/dim.x,0.0);
          vec2 sy=vec2(0.0,1.0/dim.y);
          float wx0,wx1,wx2,wx3,wy0,wy1,wy2,wy3;
          cubicWeights(tf.x,wx0,wx1,wx2,wx3);
          cubicWeights(tf.y,wy0,wy1,wy2,wy3);
          // Fully unrolled 4x4 bicubic — no dynamic indexing, maximum compatibility
          float s,r0,r1,r2v,r3,rw;
          // Row -1
          s=sampleTex(base-sy-sx);   r0=(s>=0.0?s:sBase.r)*wx0;
          s=sampleTex(base-sy);      r0+=(s>=0.0?s:sBase.r)*wx1;
          s=sampleTex(base-sy+sx);   r0+=(s>=0.0?s:sBase.r)*wx2;
          s=sampleTex(base-sy+2.0*sx); r0+=(s>=0.0?s:sBase.r)*wx3;
          // Row 0
          s=sampleTex(base-sx);      r1=(s>=0.0?s:sBase.r)*wx0;
          s=sampleTex(base);         r1+=(s>=0.0?s:sBase.r)*wx1;
          s=sampleTex(base+sx);      r1+=(s>=0.0?s:sBase.r)*wx2;
          s=sampleTex(base+2.0*sx);  r1+=(s>=0.0?s:sBase.r)*wx3;
          // Row +1
          s=sampleTex(base+sy-sx);   r2v=(s>=0.0?s:sBase.r)*wx0;
          s=sampleTex(base+sy);      r2v+=(s>=0.0?s:sBase.r)*wx1;
          s=sampleTex(base+sy+sx);   r2v+=(s>=0.0?s:sBase.r)*wx2;
          s=sampleTex(base+sy+2.0*sx); r2v+=(s>=0.0?s:sBase.r)*wx3;
          // Row +2
          s=sampleTex(base+2.0*sy-sx);  r3=(s>=0.0?s:sBase.r)*wx0;
          s=sampleTex(base+2.0*sy);     r3+=(s>=0.0?s:sBase.r)*wx1;
          s=sampleTex(base+2.0*sy+sx);  r3+=(s>=0.0?s:sBase.r)*wx2;
          s=sampleTex(base+2.0*sy+2.0*sx); r3+=(s>=0.0?s:sBase.r)*wx3;
          t=clamp(r0*wy0+r1*wy1+r2v*wy2+r3*wy3,0.0,1.0);
        }
        vec3 rgb=texture(cmapTex,vec2(t,0.5)).rgb;
        frag=vec4(rgb*edgeFade,alpha*edgeFade);
      }`;
    function sh(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
    const prog=gl.createProgram();
    gl.attachShader(prog,sh(gl.VERTEX_SHADER,vs));
    gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,fs));
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const quad=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,quad);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(prog,'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    const dataTex=gl.createTexture(), cmapTex=gl.createTexture();
    ov._gl={gl,prog,dataTex,cmapTex,u:{
      centre:gl.getUniformLocation(prog,'centre'), size:gl.getUniformLocation(prog,'size'),
      R:gl.getUniformLocation(prog,'R'), rot:gl.getUniformLocation(prog,'rot'),
      alpha:gl.getUniformLocation(prog,'alpha'), grid:gl.getUniformLocation(prog,'grid'),
      latFlip:gl.getUniformLocation(prog,'latFlip'),
      uMoving:gl.getUniformLocation(prog,'uMoving'),
      dataTex:gl.getUniformLocation(prog,'dataTex'), cmapTex:gl.getUniformLocation(prog,'cmapTex')
    },lastSlice:null,lastCmap:null,lastMn:null,lastMx:null};
    return ov._gl;
  }

  function _renderGL(ov,W,H,cx,cy,R,rot,rs,mn,mx,cmap,moving){
    const G=_getGL(ov,W,H); if(!G) return false;
    const {gl,prog,dataTex,cmapTex,u}=G;
    gl.viewport(0,0,W,H);
    gl.useProgram(prog);

    // upload data texture as RGBA8 (universally LINEAR-filterable).
    // RG = 16-bit normalized value, A = valid flag. Re-upload when slice OR range changes.
    const isGlobalLon=_isGlobalLonAxis(rs.lons,rs.nLon);
    const texW=isGlobalLon?rs.nLon+1:rs.nLon;
    if(G.lastSlice!==rs || G.lastMn!==mn || G.lastMx!==mx){
      const {data,nLat,nLon}=rs;
      const range=(mx-mn)||1;
      // When the grid is global, pad one extra column that duplicates column 0
      // so linear filtering blends smoothly across the antimeridian/prime-meridian
      // seam instead of leaving a hard transparent gap (grid.y below is widened
      // to match, so every longitude maps inside the texture).
      const buf=new Uint8Array(nLat*texW*4);
      for(let row=0;row<nLat;row++){
        for(let col=0;col<texW;col++){
          const srcCol=(isGlobalLon&&col===nLon)?0:col;
          const v=data[row*nLon+srcCol];
          const di=(row*texW+col)*4;
          if(isNaN(v)){ buf[di+3]=0; continue; }
          let t=(v-mn)/range; t=t<0?0:t>1?1:t;
          buf[di]=Math.round(t*255);  // normalized value → .r
          buf[di+3]=255;              // valid flag
        }
      }
      gl.bindTexture(gl.TEXTURE_2D,dataTex);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,texW,nLat,0,gl.RGBA,gl.UNSIGNED_BYTE,buf);
      G.lastSlice=rs; G.lastMn=mn; G.lastMx=mx;
    }
    // upload colormap texture (256x1 RGB)
    if(G.lastCmap!==cmap){
      const cm=new Uint8Array(256*3);
      for(let i=0;i<256*3;i++)cm[i]=cmap[i];
      gl.bindTexture(gl.TEXTURE_2D,cmapTex);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB8,256,1,0,gl.RGB,gl.UNSIGNED_BYTE,cm);
      G.lastCmap=cmap;
    }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,dataTex); gl.uniform1i(u.dataTex,0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,cmapTex); gl.uniform1i(u.cmapTex,1);
    gl.uniform2f(u.centre,cx,cy); gl.uniform2f(u.size,W,H); gl.uniform1f(u.R,R);
    gl.uniform3f(u.rot,rot[0],rot[1],rot[2]||0);
    // Output OPAQUE colour; the single CSS opacity on ov.canvas dims it once
    // (previously this alpha × CSS opacity double-dimmed → washed-out look).
    gl.uniform1f(u.alpha,1.0);
    const lats=rs.lats,lons=rs.lons;
    gl.uniform4f(u.grid,lons[0],isGlobalLon?(lons[0]+360):lons[lons.length-1],
      Math.min(lats[0],lats[lats.length-1]),Math.max(lats[0],lats[lats.length-1]));
    gl.uniform1f(u.latFlip,lats[0]>lats[lats.length-1]?1:0);
    gl.uniform1f(u.uMoving,moving?1.0:0.0);
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    // composite onto 2D canvas — globalAlpha scoped to just this draw (reset
    // right after) so opacity dims the data image only; contours, drawn
    // into this same 2D context afterward by the caller, are unaffected.
    ov.ctx.clearRect(0,0,W,H);
    ov.ctx.globalAlpha=Math.max(0,Math.min(1,ov.selOpacity??1));
    ov.ctx.drawImage(ov._glCanvas,0,0);
    ov.ctx.globalAlpha=1;
    return true;
  }

  // _renderWGPUCanvas renders via WebGPU directly onto its own dedicated
  // <canvas> using a real GPUCanvasContext — presented by the compositor,
  // zero CPU readback per frame (the WebGL path still pays a per-frame
  // drawImage GPU→2D-canvas copy; this path doesn't even pay that).
  // The WGSL fragment shader below is a LINE-FOR-LINE transliteration of
  // the working GLSL shader in _getGL — same uv orientation (no Y flip),
  // same +q.y latitude sign, same double longitude wrap, same Catmull-Rom
  // unrolled 4×4 bicubic, same edgeFade and uMoving fast path. The earlier
  // "inverted overlay" came from this shader using a flipped uv and a
  // negated q.y relative to the GLSL — both are now identical, so WebGPU
  // output is pixel-equivalent to WebGL, minus one canvas copy per frame.
  // ov.canvas (2D) stays on top for contours + legend only.
  function _renderWGPUCanvas(ov,W,H,cx,cy,R,rot,rs,mn,mx,cmap,moving){
    if(!_wgpuDevice||_wgpuFailStreak>8) return false;
    try{
      if(!ov._wgpuCanvas){
        const c=document.createElement('canvas');
        c.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;display:block;z-index:'+(parseInt(ov.canvas.style.zIndex||'22',10)-1)+';';
        document.body.insertBefore(c,ov.canvas);
        const gctx=c.getContext('webgpu');
        if(!gctx) return false;
        const format=navigator.gpu.getPreferredCanvasFormat();
        gctx.configure({device:_wgpuDevice,format,alphaMode:'premultiplied'});
        ov._wgpuCanvas=c; ov._wgpuCtx=gctx; ov._wgpuFormat=format;
      }
      if(ov._wgpuCanvas.width!==W||ov._wgpuCanvas.height!==H){
        ov._wgpuCanvas.width=W; ov._wgpuCanvas.height=H;
      }
      const G=ov._wgpu||(ov._wgpu={});
      const _WGSL_VER=14; // transliterated-from-GLSL fragment, native canvas
      if(!G.ready||G.wgslVer!==_WGSL_VER||G.fmt!==ov._wgpuFormat){
        G.wgslVer=_WGSL_VER; G.fmt=ov._wgpuFormat; G.ready=false;
        const code=`
struct U {
  centre : vec2f,
  size   : vec2f,
  grid   : vec4f,
  rot    : vec3f,
  R      : f32,
  alphaV : f32,
  latFlip: f32,
  uMoving: f32,
  pad0   : f32,
};
@group(0) @binding(0) var dataTex:texture_2d<f32>;
@group(0) @binding(1) var cmapTex:texture_2d<f32>;
@group(0) @binding(2) var samp:sampler;
@group(0) @binding(3) var<uniform> u:U;
struct VSOut { @builtin(position) clipPos:vec4f, @location(0) uv:vec2f };
@vertex fn vs(@builtin(vertex_index) i:u32)->VSOut {
  var p=array(vec2f(-1.0,-1.0),vec2f(1.0,-1.0),vec2f(-1.0,1.0),vec2f(1.0,1.0));
  var o:VSOut;
  o.clipPos=vec4f(p[i],0.0,1.0);
  // Identical to GLSL: uv = p*0.5+0.5, NO y flip. WebGPU clip space matches
  // WebGL here (y up, canvas presents y=+1 at top), so uv conventions carry
  // straight over — flipping uv here is what inverted the old version.
  o.uv=p[i]*0.5+vec2f(0.5,0.5);
  return o;
}
fn cubicWeights(t:f32)->vec4f{
  let t2=t*t; let t3=t2*t;
  return vec4f(
    -0.5*t3+     t2-0.5*t,
     1.5*t3-2.5*t2     +1.0,
    -1.5*t3+2.0*t2+0.5*t,
     0.5*t3-0.5*t2);
}
fn sampleTex(uv2:vec2f)->f32{
  let s=textureSampleLevel(dataTex,samp,uv2,0.0);
  return select(-1.0,s.r,s.a>0.5);
}
@fragment fn fs(in:VSOut)->@location(0) vec4f {
  let px=in.uv*u.size;
  let d=(px-u.centre)/u.R;
  let r2=dot(d,d);
  let edgeFade=clamp((1.0-sqrt(r2))*u.R/1.5,0.0,1.0);
  if(r2>1.0){ return vec4f(0.0); }
  let dz=sqrt(1.0-r2);
  let pv=vec3f(d.x,d.y,dz);
  let D=0.017453292519943295;
  let cl=cos(u.rot.x*D); let sl=sin(u.rot.x*D);
  let cp=cos(u.rot.y*D); let sp=sin(u.rot.y*D);
  let cg=cos(u.rot.z*D); let sg=sin(u.rot.z*D);
  let M=mat3x3f(
    vec3f(cl*cg-sl*sg*sp, sg*cp, sl*cg+cl*sg*sp),
    vec3f(-cl*sg-sl*cg*sp, cg*cp,-sl*sg+cl*cg*sp),
    vec3f(-sl*cp,-sp,cl*cp));
  let q=M*pv;
  let lat=asin(clamp(q.y,-1.0,1.0))/D;
  let lon=atan2(q.x,q.z)/D;
  var L=lon;
  if(L<u.grid.x){L+=360.0;} if(L>u.grid.y){L-=360.0;}
  if(L<u.grid.x){L+=360.0;} if(L>u.grid.y){L-=360.0;}
  var fx=(L-u.grid.x)/(u.grid.y-u.grid.x+1e-6);
  var fy=select((lat-u.grid.z)/(u.grid.w-u.grid.z+1e-6),
                (u.grid.w-lat)/(u.grid.w-u.grid.z+1e-6),
                u.latFlip>0.5);
  if(fx<0.0||fx>1.0||fy<0.0||fy>1.0){ return vec4f(0.0); }
  // u.grid's xyzw are grid-POINT (cell-CENTER) coordinates — see the GLSL
  // renderer's comment on the identical fix for the full explanation. The
  // raw fraction above addresses texel EDGES (0..1 spans N texels); grid
  // points only span N-1 intervals, so every sample was off by half a
  // texel — invisible on a fine grid, a full 1° shift on a 180-column one.
  let dim=vec2f(textureDimensions(dataTex));
  fx=(fx*(dim.x-1.0)+0.5)/dim.x;
  fy=(fy*(dim.y-1.0)+0.5)/dim.y;
  let sBase=textureSampleLevel(dataTex,samp,vec2f(fx,fy),0.0);
  if(sBase.a<0.5){ return vec4f(0.0); }
  var t=0.0;
  if(u.uMoving>0.5){
    t=clamp(sBase.r,0.0,1.0);
  } else {
    let texPos=vec2f(fx,fy)*dim-0.5;
    let tf=fract(texPos);
    let base=(floor(texPos)+vec2f(0.5,0.5))/dim;
    let sx=vec2f(1.0/dim.x,0.0);
    let sy=vec2f(0.0,1.0/dim.y);
    let wx=cubicWeights(tf.x);
    let wy=cubicWeights(tf.y);
    var s:f32; var r0:f32; var r1:f32; var r2v:f32; var r3:f32;
    // Fully unrolled 4x4 bicubic — identical to the GLSL version
    s=sampleTex(base-sy-sx);        r0 =select(sBase.r,s,s>=0.0)*wx.x;
    s=sampleTex(base-sy);           r0+=select(sBase.r,s,s>=0.0)*wx.y;
    s=sampleTex(base-sy+sx);        r0+=select(sBase.r,s,s>=0.0)*wx.z;
    s=sampleTex(base-sy+2.0*sx);    r0+=select(sBase.r,s,s>=0.0)*wx.w;
    s=sampleTex(base-sx);           r1 =select(sBase.r,s,s>=0.0)*wx.x;
    s=sampleTex(base);              r1+=select(sBase.r,s,s>=0.0)*wx.y;
    s=sampleTex(base+sx);           r1+=select(sBase.r,s,s>=0.0)*wx.z;
    s=sampleTex(base+2.0*sx);       r1+=select(sBase.r,s,s>=0.0)*wx.w;
    s=sampleTex(base+sy-sx);        r2v =select(sBase.r,s,s>=0.0)*wx.x;
    s=sampleTex(base+sy);           r2v+=select(sBase.r,s,s>=0.0)*wx.y;
    s=sampleTex(base+sy+sx);        r2v+=select(sBase.r,s,s>=0.0)*wx.z;
    s=sampleTex(base+sy+2.0*sx);    r2v+=select(sBase.r,s,s>=0.0)*wx.w;
    s=sampleTex(base+2.0*sy-sx);    r3 =select(sBase.r,s,s>=0.0)*wx.x;
    s=sampleTex(base+2.0*sy);       r3+=select(sBase.r,s,s>=0.0)*wx.y;
    s=sampleTex(base+2.0*sy+sx);    r3+=select(sBase.r,s,s>=0.0)*wx.z;
    s=sampleTex(base+2.0*sy+2.0*sx);r3+=select(sBase.r,s,s>=0.0)*wx.w;
    t=clamp(r0*wy.x+r1*wy.y+r2v*wy.z+r3*wy.w,0.0,1.0);
  }
  let rgb=textureSampleLevel(cmapTex,samp,vec2f(t,0.5),0.0).rgb;
  // Premultiplied output for the canvas compositor: matches GLSL's
  // frag=vec4(rgb*edgeFade, alpha*edgeFade) under premultiplied alphaMode.
  let aOut=u.alphaV*edgeFade;
  return vec4f(rgb*edgeFade*aOut,aOut);
}`;
        const module=_wgpuDevice.createShaderModule({code});
        module.getCompilationInfo&&module.getCompilationInfo().then(info=>{
          for(const m of info.messages||[]){
            if(m.type==='error') console.error('[overlay WGSL] line '+m.lineNum+': '+m.message);
          }
        });
        G.pipe=_wgpuDevice.createRenderPipeline({
          layout:'auto',
          vertex:{module,entryPoint:'vs'},
          fragment:{module,entryPoint:'fs',targets:[{format:ov._wgpuFormat}]},
          primitive:{topology:'triangle-strip'}
        });
        G.cmapTex=_wgpuDevice.createTexture({size:[256,1],format:'rgba8unorm',
          usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
        G.samp=_wgpuDevice.createSampler({magFilter:'linear',minFilter:'linear',
          addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
        G.ubuf=_wgpuDevice.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
        G.ready=true; G.lastSlice=null; G.lastCmap=null;
        G.lastMn=null; G.lastMx=null; G.texW=0; G.nLat=0; G.dataTex=null; G.bgroup=null;
      }
      // ── Data texture: same 8-bit .r + alpha-flag packing and the same
      //    global-longitude seam column as the WebGL path ──
      const {data,nLat,nLon}=rs;
      const isGlobalLon=_isGlobalLonAxis(rs.lons,nLon);
      const texW=isGlobalLon?nLon+1:nLon;
      if(!G.dataTex||G.lastSlice!==rs||G.lastMn!==mn||G.lastMx!==mx||G.texW!==texW||G.nLat!==nLat){
        if(!G.dataTex||G.texW!==texW||G.nLat!==nLat){
          try{G.dataTex?.destroy();}catch(e){}
          G.dataTex=_wgpuDevice.createTexture({size:[texW,nLat],format:'rgba8unorm',
            usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
          G.bgroup=_wgpuDevice.createBindGroup({layout:G.pipe.getBindGroupLayout(0),entries:[
            {binding:0,resource:G.dataTex.createView()},
            {binding:1,resource:G.cmapTex.createView()},
            {binding:2,resource:G.samp},
            {binding:3,resource:{buffer:G.ubuf}}
          ]});
          G.texW=texW; G.nLat=nLat;
        }
        const range=(mx-mn)||1, buf=new Uint8Array(nLat*texW*4);
        for(let row=0;row<nLat;row++){
          for(let col=0;col<texW;col++){
            const srcCol=(isGlobalLon&&col===nLon)?0:col;
            const v=data[row*nLon+srcCol];
            const di=(row*texW+col)*4;
            if(isNaN(v)){buf[di+3]=0;continue;}
            let t=(v-mn)/range; t=t<0?0:t>1?1:t;
            buf[di]=Math.round(t*255); buf[di+3]=255;
          }
        }
        _wgpuDevice.queue.writeTexture({texture:G.dataTex},buf,{bytesPerRow:texW*4},[texW,nLat]);
        G.lastSlice=rs; G.lastMn=mn; G.lastMx=mx;
      }
      if(G.lastCmap!==cmap){
        const cm=new Uint8Array(256*4);
        for(let i=0;i<256;i++){cm[i*4]=cmap[i*3];cm[i*4+1]=cmap[i*3+1];cm[i*4+2]=cmap[i*3+2];cm[i*4+3]=255;}
        _wgpuDevice.queue.writeTexture({texture:G.cmapTex},cm,{bytesPerRow:256*4},[256,1]);
        G.lastCmap=cmap;
      }
      // ── Uniforms: same values the WebGL path uploads, same grid.y widening
      //    for the seam column ──
      const lats=rs.lats,lons=rs.lons;
      const latMin=Math.min(lats[0],lats[lats.length-1]), latMax=Math.max(lats[0],lats[lats.length-1]);
      const lonStep=nLon>1?Math.abs(lons[1]-lons[0]):1;
      const gridY=isGlobalLon?(lons[0]+360):(lons[lons.length-1]);
      const udata=new Float32Array(16);
      udata[0]=cx; udata[1]=cy;                 // centre
      udata[2]=W;  udata[3]=H;                  // size
      udata[4]=lons[0]; udata[5]=gridY;         // grid.xy
      udata[6]=latMin;  udata[7]=latMax;        // grid.zw
      udata[8]=rot[0]; udata[9]=rot[1]; udata[10]=rot[2]||0; // rot (vec3, 16-aligned)
      udata[11]=R;                              // R packs into vec3 pad slot
      udata[12]=ov.selOpacity??1;               // alphaV
      udata[13]=(lats[0]>lats[lats.length-1])?1:0; // latFlip
      udata[14]=moving?1:0;                     // uMoving
      udata[15]=0;
      _wgpuDevice.queue.writeBuffer(G.ubuf,0,udata);
      const enc=_wgpuDevice.createCommandEncoder();
      const pass=enc.beginRenderPass({colorAttachments:[{
        view:ov._wgpuCtx.getCurrentTexture().createView(),
        clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'
      }]});
      pass.setPipeline(G.pipe); pass.setBindGroup(0,G.bgroup); pass.draw(4); pass.end();
      _wgpuDevice.queue.submit([enc.finish()]);
      ov._wgpuCanvas.style.display='';
      // Clear the 2D canvas' colour layer so only contours/legend remain on it
      _wgpuFailStreak=0;
      return true;
    }catch(e){
      _wgpuFailStreak++;
      console.warn('[globe-nc] WebGPU canvas render failed:',e.message);
      if(ov._wgpuCanvas) ov._wgpuCanvas.style.display='none';
      return false;
    }
  }




  function _updateLandFill(){
    const hasActiveOverlay=overlays.some(o=>o.enabled&&o.frames&&o.frames.length>0);
    const hasContours=overlays.some(o=>o.enabled&&o.showContours&&o.frames.length>0);
    const prevActive=window._ncDataActive;
    const prevContours=window._ncContoursOn;
    if(window._landNode)window._landNode.setAttribute('fill',hasActiveOverlay?'none':'#243d52');
    window._ncDataActive=hasActiveOverlay;
    window._ncContoursOn=hasContours;
    if((prevActive!==hasActiveOverlay||prevContours!==hasContours)&&typeof api.redraw==='function') api.redraw();
    if(hasActiveOverlay&&!prevActive&&window._flowClear) window._flowClear();
    else if(!hasActiveOverlay&&prevActive&&window._flowRotated) window._flowRotated();
  }

  function _drawContours(ov,mn,mx,proj,dpr,moving){
    const rs=ov.renderSlice;if(!rs||!rs.data||!rs.lats||!rs.lons)return;
    if(moving&&perfMode!=='quality') return;
    const nLev=ov.contourCount||12;
    const meta={units:ov.activeSlice?.units,longName:ov.activeSlice?.longName,varName:ov.selVar,customStep:ov.contourStep};
    const thr=_contourThresholds(mn,mx,nLev,meta);
    if(!thr.length) return;
    // Cache key is DATA-ONLY — does NOT include projection/rotation.
    // d3.geoPath re-projects the cached GeoJSON every frame, so the globe can
    // spin freely without any flicker or cache miss.
    const ckey=(ov.selVar||'')+'|'+ov.selTime+'|'+(ov.selLevIdx??0)+'|'+mn.toFixed(3)+'|'+mx.toFixed(3)+'|'+thr.join(',');
    // Ring LRU (Map, insertion-ordered): a LOOPING animation revisits the
    // same timesteps every pass, but the old single-slot cache only ever
    // held the latest frame's rings — so every loop pass re-ran the full
    // marching-squares rebuild for every frame, forever. Keeping recent
    // ring sets (capped below, sized off the raster cache) makes the
    // SECOND and later passes of a loop pure cache hits (zero contour
    // compute). Ring sets are a few hundred KB each at most — comfortably
    // under the raster frame cache's own (now budget-based) size.
    if(!ov._ctrRingLRU) ov._ctrRingLRU=new Map();
    const _lru=ov._ctrRingLRU;
    const _lruGet=(k)=>{ if(!_lru.has(k)) return null; const v=_lru.get(k); _lru.delete(k); _lru.set(k,v); return v; };
    // Track the raster frame cache's own (now budget-based) cap rather than
    // a flat number — ring sets are cheap, but caching more of them than
    // the raster cache holds frames for is wasted: redrawing the contour
    // lines still needs the color-fill decode underneath, so once THAT's
    // been evicted the ring-cache hit doesn't avoid a frame stall anyway.
    const _ringCap=Math.max(60,ov._frameCacheCap||FRAME_CACHE_MAX);
    const _lruSet=(k,v)=>{ _lru.set(k,v); while(_lru.size>_ringCap) _lru.delete(_lru.keys().next().value); };
    if(!ov._ctrGeoCache||ov._ctrGeoCache.key!==ckey){
      const hit=_lruGet(ckey);
      if(hit){ ov._ctrGeoCache={key:ckey,contours:hit}; }
      else{
      const maxDim=perfMode==='quality'?720:480;
      // During overlay ANIMATION every timestep is a fresh cache key, so
      // the full marching-squares rebuild (resample + d3.contours + ring
      // smoothing, easily 50-150ms) used to run synchronously inside the
      // same task as the colour-layer render — the single biggest cause of
      // the flow particles "staggering" each animation tick, worse with
      // 2+ overlays. While an animation is playing, rebuild in a separate
      // macrotask instead: this frame draws the PREVIOUS timestep's rings
      // (identical geometry quality, just ~one tick of temporal lag), and
      // the fresh rings repaint via schedRender the moment they're ready.
      // Paused/static behaviour is unchanged — synchronous, deterministic.
      // Two independent ways frames advance: an overlay's own per-card ▶
      // button (sets ov._animTimer), or the shared master Timeline at the
      // top of Earth Systems (window.GlobeTimeline, its own setInterval —
      // never touches any overlay's _animTimer). Checking only _animTimer
      // meant every Timeline-driven step — the normal way to animate
      // MULTIPLE synced overlays, and the likely path for a first-time
      // walkthrough of a freshly loaded series — always took the
      // synchronous 50-150ms marching-squares rebuild on the critical
      // path instead of the deferred one below, regardless of how large
      // the ring cache was sized. That was the dominant stagger source
      // the frame-cache-sizing fix didn't touch.
      const animating=((typeof overlays!=='undefined')&&overlays.some(o=>o&&o._animTimer))
        ||!!(window.GlobeTimeline&&window.GlobeTimeline.playing);
      if(animating){
        if(ov._ctrJobKey!==ckey){
          ov._ctrJobKey=ckey;
          // Measured on a 360×181 grid at the default master-timeline
          // rate (4 fps = 250ms/step): the full rebuild took 200-350ms —
          // more than one step interval, and worse with a tighter contour
          // interval (more threshold levels: this app's contourStep lets
          // a user request far more than the default 12, e.g. 29 levels
          // at a 35-unit step over a ~1000-unit range). Moving it off the
          // blocking path (above) stops it stalling the frame, but if it
          // still can't FINISH before the next step supersedes it, the
          // rebuild for this timestep never lands — contour lines stay
          // stuck on a stale frame while the colour fill keeps animating
          // underneath, which still reads as staggering/lag.
          //
          // Cutting maxDim alone barely helped (720→420 was only ~5%
          // faster in testing) — most loaded grids are already well
          // under 420 cells per side after _decodeFrame's own decimation,
          // so maxDim wasn't the active constraint. Level COUNT was: time
          // scales with cells×levels, and a fine contourStep can 2-3x the
          // level count on its own. Fixing both — a maxDim low enough to
          // force real downsampling even on already-modest grids, AND
          // thinning to a bounded level count for this deferred pass only
          // — measured 48-150ms in the same test, comfortably inside a
          // 250ms step. The static (non-animating) branch below is
          // untouched: full resolution AND every requested level the
          // moment playback stops.
          const maxDimAnim=200;
          const ANIM_MAXLEV=16;
          let thrAnim=thr;
          if(thr.length>ANIM_MAXLEV){
            const step=thr.length/ANIM_MAXLEV, seen=new Set();
            thrAnim=[];
            for(let i=0;i<ANIM_MAXLEV;i++){
              const v=thr[Math.min(thr.length-1,Math.round(i*step))];
              if(!seen.has(v)){seen.add(v);thrAnim.push(v);}
            }
          }
          setTimeout(()=>{
            if(ov._ctrJobKey!==ckey||!ov.renderSlice) return; // superseded by a newer step
            const contours=_contourRings(ov.renderSlice,thrAnim,maxDimAnim,true);
            ov._ctrGeoCache={key:ckey,contours};
            _lruSet(ckey,contours);
            ov._ctrJobKey=null;
            schedRender(ov); // repaint with the fresh rings (cache now hits)
          },0);
        }
        if(!ov._ctrGeoCache) return; // first-ever draw: nothing stale to show yet
      } else {
        ov._ctrJobKey=null;
        const contours=_contourRings(rs,thr,maxDim,false);
        ov._ctrGeoCache={key:ckey,contours};
        _lruSet(ckey,contours);
      }
      }
    }
    const {contours}=ov._ctrGeoCache;
    if(!contours.length) return;
    const baseStyle=_CTR_STYLES[ov.contourStyle]||_CTR_STYLES.synoptic;
    const gcfg=window._geoAppearCfg;
    const style=(gcfg&&gcfg.autoBoost)?_boostCtrStyle(baseStyle,gcfg.ctrW||0,gcfg.ctrBright||0):baseStyle;
    const ctx2=ov.ctx;
    ctx2.save();
    ctx2.scale(dpr,dpr);
    const geoPath=d3.geoPath().projection(proj).context(ctx2);
    // When the globe is still, draw EVERY level to completion so the result is
    // deterministic (no flicker). Only apply a time budget while moving, where a
    // dropped frame is invisible anyway.
    // While moving, contours may only take a small slice of the 16.7ms frame
    // budget — the old 40-60ms allowance let contour stroking eat multiple
    // whole frames and visibly starved the particle animation loop.
    const deadline=moving?Date.now()+(perfMode==='quality'?12:8):Infinity;
    const budget={deadline,rings:0,maxRings:Infinity,skipHalo:moving};
    for(const c of contours){
      if(Date.now()>deadline) break;
      _drawGeoContourLevel(ctx2,c.rings,geoPath,style,dpr,null,null,null,null,budget);
    }
    ctx2.restore();
  }

  // Curvilinear/projected grids (RTOFS, polar stereographic, etc.) carry one
  // lat and one lon per data cell — the texture shaders need separable 1-D axes
  // and can't handle these.  Forward-project each cell individually instead.
  // Block size (half-width, in device px) for splatting one curvilinear
  // cell: half the WORST projected gap observed between neighbouring
  // decimated grid cells, sampled at a spread of points across the grid
  // (rows AND columns, several positions each — not just one probe) so a
  // grid with genuinely non-uniform density (RTOFS's tripolar ocean grid
  // is ~2.5x coarser at the equator than near the poles) still gets a
  // block big enough to close its widest gaps, wherever the globe is
  // currently rotated to. The old version used a fixed canvas-size-only
  // heuristic that never adapted to ZOOM: cells stayed a constant pixel
  // size while the globe grew on zoom-in, so the projected gap between
  // them widened on every zoom step with nothing compensating — visible
  // as a hatched/grid pattern, worse the closer you zoomed.
  function _curvilinearBlock(rs,proj,dpr,fallback){
    const nLat=rs.nLat||0, nLon=rs.nLon||0;
    if(nLat<2||nLon<2) return fallback;
    const projPt=(k)=>{
      const la=rs.lats[k]; if(!Number.isFinite(la)) return null;
      const lo=normalizeLon(rs.lons[k]);
      const p=proj([lo,la]); return p&&Number.isFinite(p[0])&&Number.isFinite(p[1])?p:null;
    };
    let maxGap=0;
    const ROWS=6, COLS=6;
    for(let ri=0;ri<ROWS;ri++){
      const r=Math.min(nLat-2,Math.round(ri/(ROWS-1)*(nLat-2)));
      for(let ci=0;ci<COLS;ci++){
        const c=Math.min(nLon-2,Math.round(ci/(COLS-1)*(nLon-2)));
        const p0=projPt(r*nLon+c); if(!p0) continue;
        const pRight=projPt(r*nLon+c+1);
        if(pRight){ const g=Math.hypot((pRight[0]-p0[0])*dpr,(pRight[1]-p0[1])*dpr); if(g>maxGap&&g<W_GAP_CAP) maxGap=g; }
        const pDown=projPt((r+1)*nLon+c);
        if(pDown){ const g=Math.hypot((pDown[0]-p0[0])*dpr,(pDown[1]-p0[1])*dpr); if(g>maxGap&&g<W_GAP_CAP) maxGap=g; }
      }
    }
    // W_GAP_CAP rejects antimeridian-wrap outliers (two cells that are
    // geographically adjacent but land on opposite sides of the visible
    // disc after projection) — those aren't real rendering gaps to cover,
    // just an artifact of sampling across the seam, and including them
    // would blow the block size up to cover half the globe.
    return maxGap>0?Math.max(1,Math.ceil(maxGap/2)):fallback;
  }
  const W_GAP_CAP=400;
  function _renderCurvilinear(ov,rs,mn,mx,cmap,proj,W,H,dpr){
    if(!rs?.lats||rs.lats.length!==rs.data.length||rs.lons?.length!==rs.data.length) return false;
    if(!ov._buf||ov._buf.width!==W||ov._buf.height!==H) ov._buf=ov.ctx.createImageData(W,H);
    else ov._buf.data.fill(0);
    const px=ov._buf.data, range=(mx-mn)||1;
    // Baked into the data's own alpha, not canvas-wide CSS opacity — see
    // doRender's opacity comment.
    const alpha=Math.round(255*Math.max(0,Math.min(1,ov.selOpacity??1)));
    const fallback=Math.max(1,Math.ceil(Math.min(W,H)/500));
    const block=_curvilinearBlock(rs,proj,dpr,fallback);
    // A bare proj([lon,lat]) call (unlike d3.geoPath, used for coastlines
    // etc., which clips via the projection's stream) has no notion of
    // occlusion — it happily returns a screen position for FAR-hemisphere
    // points too, landing them on top of near-side pixels. That's a
    // "hollow globe" — far-side ocean data bleeding straight through
    // (reported for RTOFS: became much more visible once the gap fix
    // above gave every cell a bigger paint block). Reject any cell more
    // than 90° from the point currently facing the viewer before
    // projecting it — same cutoff d3's clipAngle(90) applies internally,
    // via the cheap cos(angular-distance) form so it skips the acos in
    // d3.geoDistance. This also skips proj() entirely for the ~half of
    // cells on the far side, so it's a net wash or win for render time,
    // not an added cost.
    const rot=proj.rotate();
    const lam0=-rot[0]*Math.PI/180, phi0=-rot[1]*Math.PI/180;
    const sinPhi0=Math.sin(phi0), cosPhi0=Math.cos(phi0), D2R=Math.PI/180;
    for(let k=0;k<rs.data.length;k++){
      const v=rs.data[k],lat=rs.lats[k],lon=normalizeLon(rs.lons[k]);
      if(!Number.isFinite(v)||!Number.isFinite(lat)||!Number.isFinite(lon)) continue;
      if(lat<-90||lat>90) continue;
      const phi=lat*D2R, lam=lon*D2R;
      const cosc=sinPhi0*Math.sin(phi)+cosPhi0*Math.cos(phi)*Math.cos(lam-lam0);
      if(cosc<0) continue; // far hemisphere — not visible from here
      const p=proj([lon,lat]); if(!p) continue;
      const x=Math.round(p[0]*dpr), y=Math.round(p[1]*dpr);
      if(x<0||x>=W||y<0||y>=H) continue;
      const t=Math.max(0,Math.min(1,(v-mn)/range)), ci=Math.round(t*255)*3;
      for(let yy=Math.max(0,y-block);yy<=Math.min(H-1,y+block);yy++)
        for(let xx=Math.max(0,x-block);xx<=Math.min(W-1,x+block);xx++){
          const q=(yy*W+xx)*4; px[q]=cmap[ci]; px[q+1]=cmap[ci+1]; px[q+2]=cmap[ci+2]; px[q+3]=alpha;
        }
    }
    ov.ctx.putImageData(ov._buf,0,0);
    return true;
  }

  function doRender(ov){
    const W=ov.canvas.width, H=ov.canvas.height;
    const moving = api.isDragging;
    ov.ctx.clearRect(0,0,W,H);
    _updateLandFill();
    if(!ov.enabled) return;
    // Opacity used to be a single CSS style.opacity on this whole canvas —
    // but contours are drawn into this SAME canvas/context, after the data,
    // for every render path (CPU raster, WebGL2's drawImage compositing,
    // and the contour+legend layer WebGPU draws on top of its own data
    // canvas). A canvas-wide CSS opacity dims everything painted on it
    // equally, so turning the data down also turned contour lines down by
    // the same amount — contours should stay legible even at low data
    // opacity. Left at 1 here; each render path below bakes ov.selOpacity
    // into the DATA specifically (per-pixel alpha for CPU/curvilinear, a
    // scoped ctx.globalAlpha around just the WebGL2 image composite, or —
    // for WebGPU — the existing shader-side alphaV, already independent of
    // this canvas), so contours drawn afterward are unaffected.
    ov.canvas.style.opacity='1';
    const _fx=(ov.selSaturate!==1||ov.selBright!==1||ov.selContrast!==1)
      ? 'saturate('+ov.selSaturate+') brightness('+ov.selBright+') contrast('+ov.selContrast+')' : '';
    ov.canvas.style.filter=_fx;
    if(ov._wgpuCanvas) ov._wgpuCanvas.style.display='none';
    if(!ov.renderSlice && ov.frames.length) rebuildSlice(ov);
    const rs=ov.renderSlice;
    if(!rs || !rs.lats || !rs.lons) return;

    const proj=api.projection;
    // For GPU modes: always capture the LIVE projection state at the exact moment
    // doRender executes — never use a stale snap. This prevents the overlay from
    // rendering at a different rotation than the globe SVG in the same RAF frame.
    const dpr=window.devicePixelRatio||ov.canvas._dpr||1;
    const tr=proj.translate();
    const rot=proj.rotate();
    const sc=proj.scale();
    const cx=tr[0]*dpr, cy=tr[1]*dpr, R=sc*dpr;
    const cmap=CMAPS[ov.selCmap]||CMAPS.viridis;
    // Baked into the DATA's own alpha channel now (see doRender's opacity
    // comment above) — was a flat 255 relying on the canvas-wide CSS
    // opacity to dim it, which also dimmed contours drawn afterward.
    const alpha=255*Math.max(0,Math.min(1,ov.selOpacity??1));
    const mn=ov.vminOvr??ov.cachedMin??0, mx=ov.vmaxOvr??ov.cachedMax??1, range=(mx-mn)||1;
    const R2=R*R;
    const drawContours=()=>{
      if(!ov.showContours||!ov.renderSlice) return;
      // proj is already at live rotation — draw contours directly
      _drawContours(ov,mn,mx,proj,dpr,moving);
    };

    // Curvilinear grids (RTOFS, polar stereo, etc.): each cell has its own
    // lat/lon — the GPU shaders need separable 1-D axes and can't handle these.
    // Forward-project every cell onto the globe canvas instead.
    if(rs.lats.length===rs.data.length&&rs.lons.length===rs.data.length){
      if(ov._wgpuCanvas) ov._wgpuCanvas.style.display='none';
      if(_renderCurvilinear(ov,rs,mn,mx,cmap,proj,W,H,dpr)){
        drawContours(); drawLegend(ov,mn,mx); return;
      }
    }

    // ---- Overlay: WebGPU (native canvas) → WebGL2 → CPU ----
    // WebGPU (toggle on): renders straight to a dedicated canvas presented
    // by the compositor — no per-frame drawImage copy at all. The WGSL is a
    // line-for-line transliteration of the GLSL below, so output is pixel-
    // identical; the old inversion came from mismatched uv/lat signs, now
    // fixed. WebGL2 is the always-on internal default; CPU only if both
    // GPU paths are unavailable.
    if(useWebGPU&&_wgpuOK){
      try{
        if(_renderWGPUCanvas(ov,W,H,cx,cy,R,rot,rs,mn,mx,cmap,moving)){
          if(doRender._pathLogged!=='webgpu'){
            console.info('[globe-nc] overlay rendering path: WebGPU (native canvas)');
            doRender._pathLogged='webgpu';
          }
          if(ov._wgpuCanvas){
            // Opacity is already applied in the WGSL shader (alphaV); CSS opacity would double-dim.
            ov._wgpuCanvas.style.opacity='1';
            ov._wgpuCanvas.style.filter=_fx;
          }
          // 2D canvas keeps only contours + legend above the WebGPU layer
          ov.ctx.clearRect(0,0,W,H);
          drawContours();
          drawLegend(ov,mn,mx);
          return;
        }
      }catch(e){
        console.warn('[globe-nc] WebGPU overlay failed, falling back to WebGL2:',e.message);
      }
    }
    if(ov._wgpuCanvas) ov._wgpuCanvas.style.display='none';
    try{
      if(gpuEnabled&&_glOK&&_renderGL(ov,W,H,cx,cy,R,rot,rs,mn,mx,cmap,moving)){
        if(doRender._pathLogged!=='webgl2'){
          console.info('[globe-nc] overlay rendering path: WebGL2 (GPU)');
          doRender._pathLogged='webgl2';
        }
        drawContours();
        drawLegend(ov,mn,mx);
        return;
      }
      if(doRender._pathLogged!=='cpu'){
        console.warn('[globe-nc] overlay rendering path: CPU (slow). webgl2Probe='+_glOK+' — if webgl2Probe is true but this still shows, WebGL2 context creation failed at render time.');
        doRender._pathLogged='cpu';
      }
    }catch(e){
      console.warn('[globe-nc] WebGL render failed, using CPU:',e.message);
      ov.canvas.style.filter=_fx;
      ov.ctx.clearRect(0,0,W,H);
    }

    // CPU fallback: stride=1 when still (quality), stride=2 when moving (4× faster).
    // stride=2 means 2×2 pixel blocks — imperceptible at normal viewing distance
    // and far better than the old stride=6-9 that caused visible block artefacts.
    // Soft disc edge applied at every sampled pixel regardless of stride.
    const cpuStride=moving?2:1;
    const bx0=Math.max(0,Math.floor(cx-R-2)), bx1=Math.min(W,Math.ceil(cx+R+2));
    const by0=Math.max(0,Math.floor(cy-R-2)), by1=Math.min(H,Math.ceil(cy+R+2));
    if(!ov._buf || ov._buf.width!==W || ov._buf.height!==H){
      ov._buf=ov.ctx.createImageData(W,H);
    } else { ov._buf.data.fill(0); }
    const px=ov._buf.data;
    const lats=rs.lats, lons=rs.lons;
    for(let spy=by0;spy<by1;spy+=cpuStride)for(let spx=bx0;spx<bx1;spx+=cpuStride){
      const dx=spx-cx,dy=spy-cy;
      const r2px=dx*dx+dy*dy;
      if(r2px>R2) continue;
      const ll=proj.invert([spx/dpr, spy/dpr]); if(!ll) continue;
      const val=sampleAt(ll[0],ll[1],rs,lats,lons);
      if(isNaN(val)) continue;
      const t=Math.max(0,Math.min(1,(val-mn)/range)), ci=Math.round(t*255)*3;
      const cr=cmap[ci],cg2=cmap[ci+1],cb=cmap[ci+2];
      // Fill cpuStride×cpuStride block; apply soft edge only at disc boundary
      for(let dy2=0;dy2<cpuStride;dy2++)for(let dx2=0;dx2<cpuStride;dx2++){
        const py2=spy+dy2,px2=spx+dx2; if(py2>=H||px2>=W) continue;
        const ddx=px2-cx,ddy=py2-cy,r2b=ddx*ddx+ddy*ddy;
        if(r2b>R2) continue;
        const edgeFade=Math.min(1,(R-Math.sqrt(r2b))/1.5);
        const idx2=(py2*W+px2)*4;
        px[idx2]=cr; px[idx2+1]=cg2; px[idx2+2]=cb;
        px[idx2+3]=Math.round(alpha*edgeFade);
      }
    }
    ov.ctx.putImageData(ov._buf,0,0);
    drawContours();
    drawLegend(ov,mn,mx);
  }


  function drawLegend(ov,mn,mx){
    const lc=ov.cardEl?.querySelector('.nc-lc');if(!lc)return;
    const lut=CMAPS[ov.selCmap]||CMAPS.viridis,x=lc.getContext('2d');
    const id=x.createImageData(220,14);const d=id.data;
    for(let i=0;i<220;i++){const ci=Math.round(i/219*255)*3;
      for(let j=0;j<14;j++){const idx=(j*220+i)*4;d[idx]=lut[ci];d[idx+1]=lut[ci+1];d[idx+2]=lut[ci+2];d[idx+3]=210;}}
    x.putImageData(id,0,0);
    const ll=ov.cardEl?.querySelector('.nc-ll');if(!ll)return;
    const fmt=v=>Math.abs(v)>=1e4||(Math.abs(v)<0.001&&v!==0)?v.toExponential(1):Number(v.toPrecision(4)).toString();
    ll.innerHTML=`<span>${fmt(mn)}</span><span>${fmt((mn+mx)/2)}</span><span>${fmt(mx)}</span>`;
    const lu=ov.cardEl?.querySelector('.nc-lu');if(lu&&ov.activeSlice?.units)lu.textContent=ov.activeSlice.units;
  }

  /* ---- PLAYBACK — delegate to GlobeTimeline when available ---- */
  function startPlay(){
    if(window.GlobeTimeline){window.GlobeTimeline.startPlay();return;}
    if(playTimer)return;
    playTimer=setInterval(()=>{
      let any=false;
      overlays.forEach(ov=>{
        if(!ov.enabled||!ov.frames.length) return;
        if(effectiveLoopMode(ov)==='level'){
          if(getLevelCount(ov)<=1) return;
          applyDimensionStep(ov,1); any=true;
        } else {
          if(ov.maxTime<=1) return;
          applyDimensionStep(ov,1); any=true;
        }
      });
      if(!any)stopPlay();
    },1000/playFps);
  }
  function stopPlay(){
    if(window.GlobeTimeline){window.GlobeTimeline.stopPlay();return;}
    clearInterval(playTimer);playTimer=null;
  }

  function getGribLevels(ov){
    if(ov._gribLevels?.length>1) return ov._gribLevels;
    const v=ov.frames[0]?.reader?.variables?.find(x=>x.name===ov.selVar);
    return v?._levels?.length>1?v._levels:null;
  }
  function getLevelCount(ov){
    const gl=getGribLevels(ov);
    if(gl) return gl.length;
    const ls=ov.cardEl?.querySelector('.nc-lev');
    if(ls&&ls.options.length>1) return ls.options.length;
    const g=ov.frames[0]?.grid;
    if(g?.levels?.length>1) return g.levels.length;
    return 1;
  }
  function getLevelLabel(ov){
    const idx=ov.selLevIdx??0;
    const gl=getGribLevels(ov);
    if(gl){
      const lv=gl[idx];
      return lv!=null?lv+' '+(ov._gribLevUnits||'hPa'):'Level '+(idx+1);
    }
    const ls=ov.cardEl?.querySelector('.nc-lev');
    if(ls&&ls.options.length>1) return ls.options[idx]?.textContent||('Level '+(idx+1));
    const g=ov.frames[0]?.grid;
    if(g?.levels?.length>1){
      const u=g.levUnits||'';
      return String(g.levels[idx])+(u?' '+u:'');
    }
    return '';
  }
  function hasMultiTime(ov){ return (ov.maxTime||0)>1; }
  function hasMultiLevel(ov){ return getLevelCount(ov)>1; }
  function canChooseLoopMode(ov){ return hasMultiTime(ov)&&hasMultiLevel(ov); }
  function effectiveLoopMode(ov){
    if(canChooseLoopMode(ov)) return ov._loopMode||'time';
    if(hasMultiLevel(ov)&&!hasMultiTime(ov)) return 'level';
    return 'time';
  }
  function updateLevelUI(ov){
    const ls=ov.cardEl?.querySelector('.nc-lev');
    if(ls&&ls.options.length) ls.value=String(ov.selLevIdx??0);
  }
  function invalidateSlice(ov){
    ov.activeSlice=null;ov.renderSlice=null;
    if(ov._fcache) ov._fcache.clear();
    ov._contourCache=null;ov._screenContourCache=null;ov._ctrGeoCache=null;
    ov.cachedMin=null;ov.cachedMax=null;
  }
  function stepLevel(ov,dir){
    const n=getLevelCount(ov);
    if(n<=1) return;
    ov.selLevIdx=((ov.selLevIdx??0)+dir+n)%n;
    updateLevelUI(ov);
    // Preserve _ctrGeoCache across the invalidation (its key includes
    // selLevIdx so it can't be wrongly reused) — during level-loop
    // animation the stale rings are drawn while the new level's rings
    // rebuild asynchronously; see stepTime for the full rationale.
    const _keepRings=ov._ctrGeoCache;
    invalidateSlice(ov);
    ov._ctrGeoCache=_keepRings;
    rebuildSlice(ov);syncTimeUI(ov);schedRender(ov);
  }
  function applySliderValue(ov,v){
    const mode=effectiveLoopMode(ov);
    if(mode==='level'){
      ov.selLevIdx=Math.max(0,Math.min(getLevelCount(ov)-1,v));
      updateLevelUI(ov);
      invalidateSlice(ov);  // level change: full invalidation needed
    } else {
      ov.selTime=Math.max(0,Math.min((ov.maxTime||1)-1,v));
      // Keep _fcache so prefetched frames survive slider scrubbing
      ov.activeSlice=null;ov.renderSlice=null;
      ov._contourCache=null;ov._screenContourCache=null;ov._ctrGeoCache=null;
    }
    rebuildSlice(ov);syncTimeUI(ov);schedRender(ov);
  }
  function applyDimensionStep(ov,dir){
    if(effectiveLoopMode(ov)==='level') stepLevel(ov,dir);
    else stepTime(ov,dir);
  }

  /* ============================================================ CARD UI */
  // Overlay-toolbar icon set — thin-stroke line icons (currentColor, 24x24
  // viewBox) matching the reference design. Tooltips stay on the button's
  // title attribute exactly as before; only the glyph markup changes.
  const NC_ICON_SVG_OPEN='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">';
  const NC_ICONS={
    eye: NC_ICON_SVG_OPEN+'<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    addLayer: NC_ICON_SVG_OPEN+'<polygon points="10 4 18 8.5 10 13 2 8.5"/><polyline points="2 12.5 10 17 18 12.5"/><line x1="19.5" y1="2" x2="19.5" y2="7.5"/><line x1="16.75" y1="4.75" x2="22.25" y2="4.75"/></svg>',
    plot: NC_ICON_SVG_OPEN+'<line x1="3" y1="20" x2="3" y2="4"/><line x1="3" y1="20" x2="21" y2="20"/><rect x="5.5" y="14" width="2.4" height="6" rx="0.4"/><rect x="9.5" y="10" width="2.4" height="10" rx="0.4"/><rect x="13.5" y="16" width="2.4" height="4" rx="0.4"/><circle cx="17.5" cy="9" r="1"/><circle cx="19.8" cy="6" r="1"/><circle cx="20.8" cy="11" r="1"/></svg>',
    region: NC_ICON_SVG_OPEN+'<rect x="3" y="5" width="14" height="14" rx="1" stroke-dasharray="3 2.6"/><line x1="19.5" y1="2" x2="19.5" y2="7.5"/><line x1="16.75" y1="4.75" x2="22.25" y2="4.75"/></svg>',
    preload: NC_ICON_SVG_OPEN+'<path d="M6.5 13.7a3.5 3.5 0 0 1 .5-6.9 4.6 4.6 0 0 1 8.7 1.6 3 3 0 0 1-.6 5.3"/><line x1="11" y1="9" x2="11" y2="15"/><polyline points="8.5 12.5 11 15 13.5 12.5"/><rect x="5" y="18.3" width="12" height="2" rx="0.5"/><rect x="7" y="21.3" width="8" height="1.4" rx="0.5"/></svg>',
    trend: NC_ICON_SVG_OPEN+'<line x1="3" y1="21" x2="3" y2="3"/><line x1="3" y1="21" x2="21" y2="21"/><polyline points="5 16 10 11 14 14 20 6"/><polyline points="15 6 20 6 20 11"/></svg>',
    correlate: NC_ICON_SVG_OPEN+'<circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="8" stroke-dasharray="2.5 2.5"/><line x1="12" y1="1.5" x2="12" y2="5" stroke-dasharray="2 2"/><line x1="12" y1="19" x2="12" y2="22.5" stroke-dasharray="2 2"/><line x1="1.5" y1="12" x2="5" y2="12" stroke-dasharray="2 2"/><line x1="19" y1="12" x2="22.5" y2="12" stroke-dasharray="2 2"/></svg>',
    animate: NC_ICON_SVG_OPEN+'<rect x="3" y="5" width="18" height="14" rx="2"/><polygon points="10 9 16 12 10 15" fill="currentColor" stroke="none"/><line x1="3" y1="8.5" x2="6" y2="8.5"/><line x1="3" y1="15.5" x2="6" y2="15.5"/><line x1="18" y1="8.5" x2="21" y2="8.5"/><line x1="18" y1="15.5" x2="21" y2="15.5"/></svg>',
    pause: NC_ICON_SVG_OPEN+'<rect x="3" y="5" width="18" height="14" rx="2"/><line x1="10" y1="9" x2="10" y2="15"/><line x1="14" y1="9" x2="14" y2="15"/></svg>',
    download: NC_ICON_SVG_OPEN+'<line x1="12" y1="3" x2="12" y2="15"/><polyline points="7 10 12 15 17 10"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    trash: NC_ICON_SVG_OPEN+'<line x1="4" y1="7" x2="20" y2="7"/><path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    contour: NC_ICON_SVG_OPEN+'<path d="M2 8.5c3-4 5-4 8 0s5 4 8 0"/><path d="M2 13c3-4 5-4 8 0s5 4 8 0" opacity="0.55"/><path d="M2 17.5c3-4 5-4 8 0s5 4 8 0" opacity="0.3"/></svg>'
  };
  function buildCard(ov){
    const list=document.getElementById('nc-overlay-list');
    const card=document.createElement('div');card.className='nc-card';card.dataset.id=ov.id;
    card.innerHTML=`
<div class="nc-ch">
  <div class="nc-name-row">
    <span class="nc-cnum">01</span>
    <div class="nc-title-block">
      <span class="nc-cname nc-empty">empty — drop a .nc file</span>
      <span class="nc-st2"></span>
    </div>
    <div class="nc-head-actions">
      <button class="nc-swatch nc-hbtn" title="Colours &amp; style — quick access"><span class="nc-swatch-chip"></span></button>
      <button class="nc-eye nc-hbtn" title="Toggle visibility">${NC_ICONS.eye}</button>
      <button class="nc-rm nc-hbtn" title="Remove layer">${NC_ICONS.trash}</button>
    </div>
  </div>
  <div class="nc-ctools">
    <button class="nc-drop-btn nc-tbtn2" title="Load file">${NC_ICONS.addLayer}</button>
    <button class="nc-ctr-btn nc-tbtn2" title="Contour lines">${NC_ICONS.contour}</button>
    <button class="nc-plot nc-tbtn2" title="2-D plot">${NC_ICONS.plot}</button>
    <button class="nc-region nc-tbtn2" title="Region extract">${NC_ICONS.region}</button>
    <button class="nc-trend nc-tbtn2" title="Trend analysis">${NC_ICONS.trend}</button>
    <button class="nc-corr nc-tbtn2" title="Teleconnection tools (correlation map / composite analysis)">${NC_ICONS.correlate}</button>
    <button class="nc-pre nc-tbtn2" title="Preload frames">${NC_ICONS.preload}</button>
    <button class="nc-anim nc-tbtn2" title="Animate">${NC_ICONS.animate}</button>
    <button class="nc-csv nc-tbtn2" title="Export CSV">${NC_ICONS.download}</button>
  </div>
</div>
<div class="nc-cb" style="display:none">
  <!-- File series list — collapses to just the add-file control for the
       common single-file case, since the filename/frame count are already
       shown in the card header; the full per-file breakdown only earns its
       space once a series actually has more than one file. -->
  <div class="nc-series-wrap">
    <div class="nc-series-label"><span class="nc-series-label-txt">Files</span><span class="nc-fc">0 file(s) · 0 frames</span></div>
    <div class="nc-file-list"></div>
    <button class="btn nc-add-file" style="width:100%;margin-top:6px;font-size:12px;padding:6px 10px">＋ Add more files to this series</button>
  </div>

  <div class="nc-ctrls" style="display:none">
    <div style="display:flex;align-items:center;gap:6px">
    <label class="nl" style="flex:1">Variable<select class="nc-var nc-sel"></select></label>
    <button class="nc-send-var nc-tbtn2" title="Open variable in new overlay" style="display:none;white-space:nowrap;font-size:11px;padding:4px 8px;margin-top:14px">+ New overlay</button>
  </div>
    <label class="nl nc-lev-row" style="display:none">Level / height<select class="nc-lev nc-sel"></select></label>
    <div class="nc-tr" style="display:none">
      <div class="nl" style="margin-bottom:4px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:8px">
            <label class="nc-loop-dim-lbl" style="display:none;align-items:center;gap:4px;font-size:9px;color:var(--ink-faint);white-space:nowrap">
              Animate
              <select class="nc-loop-dim nc-sel" style="font-size:9px;padding:1px 4px;min-width:0">
                <option value="time">time</option>
                <option value="level">levels</option>
              </select>
            </label>
            <label class="nc-fps-lbl" style="display:flex;align-items:center;gap:4px;font-size:9px;color:var(--ink-faint);white-space:nowrap">
              FPS
              <input type="number" class="nc-fps nc-ni" min="0.5" max="30" step="0.5" value="2" style="width:38px;font-size:9px;padding:1px 3px">
            </label>
          </div>
          <span class="nc-tv nc-tvbig">—</span>
        </div>
        <div class="nc-tv-fixed" style="font-size:9px;color:var(--ink-faint);margin-top:2px;min-height:11px"></div>
      </div>
      <div class="nc-tc"><button class="nc-tp nc-tb">◀</button>
        <input type="range" class="nc-ts month-slider" min="0" max="0" value="0" style="flex:1">
        <button class="nc-tn nc-tb">▶</button>
      </div>
    </div>
    <div class="nc-op-row">
      <span class="nc-op-lab">Opacity</span>
      <input type="range" class="nc-op month-slider" min="0" max="100" value="65">
      <span class="nc-ov">65%</span>
    </div>
    <!-- Contour on/off now lives as an icon toggle in the tools row above
         (.nc-ctr-btn) — this checkbox stays in the DOM purely as the
         existing state/wiring target, but is visually hidden. -->
    <input type="checkbox" class="nc-ctr" style="display:none">
    <div class="nc-ctr-wrap" style="display:none">
      <div class="nc-ctr-sl-wrap">
        <span style="font-size:9px;color:var(--ink-faint);flex-shrink:0">Intvl</span>
        <input type="range" class="nc-ctr-sl month-slider" min="0.01" max="100" step="0.01" value="1" style="flex:1">
        <input type="number" class="nc-ctr-step nc-ni" placeholder="auto" step="any" min="0" style="width:54px;font-size:10px;flex-shrink:0">
        <span class="nc-ctr-step-u" style="font-size:9px;color:var(--ink-faint);flex-shrink:0"></span>
      </div>
      <div class="nc-ctr-style-wrap">
        <label class="nl" style="margin:0">Line style<select class="nc-ctr-style nc-sel" style="font-size:10px">
          <option value="synoptic">Synoptic (amber)</option>
          <option value="white">White</option>
          <option value="cyan">Cyan</option>
          <option value="dark">Dark</option>
        </select></label>
      </div>
      <div class="nc-ctr-lvln"></div>
    </div>
    <div class="nc-leg" title="Colour scale — click to edit colours & style">
      <canvas class="nc-lc" width="220" height="14" style="border-radius:3px"></canvas>
      <div class="nc-ll"></div><div class="nc-lu"></div>
    </div>
    <div class="nc-style-head nc-style-toggle">▸ Colours &amp; style</div>
    <div class="nc-style-block" style="display:none">
    <label class="nl">Colour map<select class="nc-cm nc-sel">${CMAP_KEYS.map(k=>`<option>${k}</option>`).join('')}</select></label>
    <div class="nc-cp"></div>
    <div class="nc-fx-grid">
    <label class="nl nc-fx-cell">Brightness
      <div class="nc-sr"><input type="range" class="nc-bright month-slider" min="40" max="180" value="100"><span class="nc-brightv">100%</span></div>
    </label>
    <label class="nl nc-fx-cell">Contrast
      <div class="nc-sr"><input type="range" class="nc-contrast month-slider" min="40" max="200" value="100"><span class="nc-contrastv">100%</span></div>
    </label>
    <label class="nl nc-fx-cell">Saturation
      <div class="nc-sr"><input type="range" class="nc-sat month-slider" min="0" max="250" value="100"><span class="nc-satv">100%</span></div>
    </label>
    </div>
    <div class="nc-rr">
      <span class="nl" style="align-self:center">Range</span>
      <label class="nc-al"><input type="checkbox" class="nc-au" checked>Auto</label>
      <input type="number" class="nc-rn nc-ni" placeholder="min" step="any" disabled>
      <input type="number" class="nc-rx nc-ni" placeholder="max" step="any" disabled>
    </div>
    <button class="nc-fx-reset" style="width:100%;margin:4px 0 2px;font-size:9.5px;padding:4px 6px;background:rgba(127,208,255,0.08);border:1px solid rgba(127,208,255,0.25);border-radius:5px;color:#9fc4dd;cursor:pointer">↺ Reset appearance</button>
    </div>
  </div>
</div>`;
    ov.cardEl=card;list.appendChild(card);
    wireCard(ov);
  }

  function wireCard(ov){
    const c=ov.cardEl,q=sel=>c.querySelector(sel);
    c.querySelector('.nc-ch').addEventListener('click',e=>{
      if(e.target.closest('button'))return;
      const b=q('.nc-cb');b.style.display=b.style.display==='none'?'':'none';
    });
    q('.nc-plot').addEventListener('click',()=>quickPlot(ov));
    q('.nc-region').addEventListener('click',function(e){
      e.stopPropagation();
      // An EOF mode's spatial pattern has no sub-region to pick — the one
      // interesting time series IS the whole mode's PC score, so Region
      // extract jumps straight to that instead of a sub-region picker with
      // nothing meaningful to select. Regression outputs (β/R²/t/p maps)
      // stay on the normal region-mean flow below — averaging a coefficient
      // map over a sub-box is a perfectly real, useful operation.
      if(ov._eof){
        const ef=ov._eof, sl=ef.frames[ov.selTime];
        if(!sl||!sl.pc){alert('No PC series on this frame.');return;}
        _openTimeseriesWin({...ov,activeSlice:{units:'PC score (dimensionless)'}},ef.pcLabels,Array.from(sl.pc),
          ef.regionName,sl.label+' PC score');
        return;
      }
      regionMenu(ov,this);
    });
    q('.nc-trend')?.addEventListener('click',function(e){e.stopPropagation();
      // Derived layers are fully supported now: _cacheGet(ov,t) computes
      // the derived field at every virtual timestep, so the OLS fit
      // iterates them exactly like decoded frames (e.g. trend of wind
      // speed sqrt(A²+B²), or of an anomaly A−B). Only trend-of-a-trend
      // stays blocked — its "time" axis is a list of fit windows, not time.
      if(ov._trend){alert('Trend maps can’t be fitted to a trend layer — run the fit on its source layer with a different window instead.');return;}
      _openTrendDialog(ov);
    });
    q('.nc-corr')?.addEventListener('click',function(e){e.stopPropagation();teleMenu(ov,this);});
    q('.nc-pre').addEventListener('click',async function(){
      if(!ov.frames||ov.frames.length<2){alert('Only one frame loaded.');return;}
      if(this._busy)return; this._busy=true;
      let n=ov.frames.length;
      // cap preload by memory (~300MB of cached frames)
      const probe=_cacheGet(ov,ov.selTime);
      if(probe){
        const bytes=probe.renderSlice.data.length*4;
        const maxByMem=Math.max(8,Math.floor(300e6/bytes));
        if(n>maxByMem){
          if(!confirm(n+' frames × '+(bytes/1e6).toFixed(1)+'MB exceeds the cache budget — preload the most recent '+maxByMem+' instead?')){this._busy=false;return;}
          n=maxByMem;
        }
      }
      ov._cacheMax=Math.max(ov._cacheMax||0,n);
      for(let t=0;t<n;t++){
        _cacheGet(ov,t);
        this.textContent=Math.round((t+1)/n*100)+'%';
        await new Promise(r=>setTimeout(r,0)); // yield so UI stays responsive
      }
      this.textContent='✓'; this._busy=false;
      setTimeout(()=>{this.innerHTML=NC_ICONS.preload;},1800);
    });
    q('.nc-anim').addEventListener('click',function(){
      if(ov._animTimer){clearInterval(ov._animTimer);ov._animTimer=null;this.innerHTML=NC_ICONS.animate;return;}
      if(!ov.frames||ov.frames.length<2){alert('Add more time steps to this overlay first (📂 or drop more files).');return;}
      this.innerHTML=NC_ICONS.pause;
      ov._animTimer=setInterval(()=>{ applyDimensionStep(ov,1); },1000/(ov._animFps||2));
    });
    const fpsIn=q('.nc-fps');
    if(fpsIn){
      fpsIn.value=String(ov._animFps||2);
      fpsIn.addEventListener('change',()=>{
        const v=parseFloat(fpsIn.value);
        ov._animFps=(v>0&&isFinite(v))?Math.min(30,v):2;
        fpsIn.value=String(ov._animFps);
        // Live-restart the timer at the new rate if animation is currently playing.
        if(ov._animTimer){
          clearInterval(ov._animTimer);
          ov._animTimer=setInterval(()=>{ applyDimensionStep(ov,1); },1000/ov._animFps);
        }
      });
    }
    q('.nc-csv').addEventListener('click',function(e){e.stopPropagation();exportCSVMenu(ov,this);});
    q('.nc-eye').addEventListener('click',()=>{
      ov.enabled=!ov.enabled;q('.nc-eye').style.opacity=ov.enabled?'1':'0.35';
      if(!ov.enabled){
        ov.ctx.clearRect(0,0,ov.canvas.width,ov.canvas.height);
        // Also hide the WebGPU canvas — clearing the 2D ctx alone left the
        // GPU-rendered overlay fully visible when hiding a layer.
        if(ov._wgpuCanvas) ov._wgpuCanvas.style.display='none';
        _updateLandFill();
      } else {
        if(ov._wgpuCanvas) ov._wgpuCanvas.style.display='';
        schedRender(ov);
      }
    });
    q('.nc-drop-btn').addEventListener('click',()=>pickFiles(ov,false));
    q('.nc-add-file').addEventListener('click',()=>pickFiles(ov,true));
    q('.nc-rm').addEventListener('click',()=>{
      if(!ov.frames.length&&overlays.length<=1)return;
      if(ov.frames.length&&!confirm('Remove this overlay and all its loaded files?'))return;
      removeOverlay(ov);
    });
    q('.nc-var').addEventListener('change',e=>{
      // Regression's "variables" are statistic maps (β/R²/t/p) computed
      // once up front, not file variables to re-decode — switching one
      // just repoints which precomputed array is shown; the lag axis
      // (ov.frames/selTime) is untouched, same as changing colormap.
      if(ov._regress){
        ov.selVar=e.target.value; ov.cachedMin=null; ov.cachedMax=null;
        if(ov._fcache) ov._fcache.clear();
        rebuildSlice(ov); schedRender(ov);
        return;
      }
      selectVar(ov,e.target.value);
    });
    q('.nc-send-var')?.addEventListener('click',function(e){
      e.stopPropagation();
      if(overlays.length>=MAX){alert('Max '+MAX+' overlays.');return;}
      // Picker menu: choose WHICH variable becomes a new overlay — the file
      // is already open, so no re-load; the new overlay shares the readers.
      document.querySelectorAll('.nc-varpick').forEach(m=>m.remove());
      const menu=document.createElement('div');
      menu.className='nc-varpick';
      const r0=this.getBoundingClientRect();
      menu.style.cssText='position:fixed;z-index:400;left:'+Math.round(r0.left)+'px;top:'+Math.round(r0.bottom+4)+'px;'+
        'background:rgba(8,20,32,0.98);border:1px solid rgba(127,208,255,0.4);border-radius:7px;padding:4px;'+
        'font-family:IBM Plex Mono,monospace;font-size:9.5px;color:#cfe3f2;box-shadow:0 8px 30px rgba(0,0,0,0.6);max-height:260px;overflow:auto;';
      ov.varOptions.forEach(v=>{
        const it=document.createElement('div');
        it.textContent=(v.name===ov.selVar?'◉ ':'○ ')+(v.label||v.name);
        it.style.cssText='padding:4px 10px;cursor:pointer;border-radius:4px;white-space:nowrap;';
        it.addEventListener('mouseenter',()=>it.style.background='rgba(127,208,255,0.14)');
        it.addEventListener('mouseleave',()=>it.style.background='');
        it.addEventListener('click',()=>{
          menu.remove();
          const newOv=createOverlay();ov.readers.forEach(r=>newOv.readers.push(r));
          newOv.varOptions=[...ov.varOptions];newOv.name=ov.name;
          newOv.selVar=v.name;refreshCardVarPicker(newOv);
          ov.readers.forEach(r=>{const g=discoverGrid(r);const vn=g.dataVars.find(x=>x.name===v.name)?v.name:g.dataVars[0]?.name;if(vn){newOv.frames.push(...buildFrames(r,g,vn));newOv.selLevIdx=g.defaultLevI??0;refreshLevelControls(newOv,g);}});
          newOv.frames.sort((a,b)=>a.sortKey-b.sortKey);newOv.maxTime=newOv.frames.length;
          updateTimeControls(newOv);rebuildSlice(newOv);schedRender(newOv);registerOverlayFrames(newOv);
          setOvStatus(newOv,'✓ '+ov.name+' · '+v.name);openOvBody(newOv);
        });
        menu.appendChild(it);
      });
      document.body.appendChild(menu);
      const close=ev=>{ if(!menu.contains(ev.target)){menu.remove();document.removeEventListener('mousedown',close);} };
      setTimeout(()=>document.addEventListener('mousedown',close),0);
    });
    q('.nc-lev')?.addEventListener('change',e=>{
      ov.selLevIdx=+e.target.value;
      invalidateSlice(ov);
      rebuildSlice(ov);schedRender(ov);syncTimeUI(ov);
      const sl=ov.cardEl?.querySelector('.nc-ts');
      if(sl&&effectiveLoopMode(ov)==='level') sl.value=String(ov.selLevIdx);
    });
    q('.nc-cm').value=ov.selCmap;
    q('.nc-cm').addEventListener('change',e=>{ov.selCmap=e.target.value;updateCmapPrev(ov);schedRender(ov);});
    updateCmapPrev(ov);
    const styleToggle=q('.nc-style-toggle'), styleBlock=q('.nc-style-block');
    if(styleToggle&&styleBlock){
      styleToggle.addEventListener('click',e=>{
        e.stopPropagation();
        const open=styleBlock.style.display==='none';
        styleBlock.style.display=open?'':'none';
        styleToggle.textContent=(open?'▾':'▸')+' Colours & style';
      });
      // The always-visible colour legend doubles as the entry point to the
      // collapsed style section — clicking the scale is the natural "I want
      // to change these colours" gesture (same idea as NASA Worldview's
      // clickable palette bar).
      q('.nc-leg')?.addEventListener('click',e=>{e.stopPropagation();styleToggle.click();});
      // Header quick-access swatch — one click from the collapsed card
      // straight into a palette grid, no need to open the body first and
      // hunt for the (easy-to-miss) "Colours & style" toggle manually.
      q('.nc-swatch')?.addEventListener('click',e=>{
        e.stopPropagation();
        openCmapSwatchMenu(ov,e.currentTarget);
      });
    }
    const ctrCb=q('.nc-ctr'), ctrBtn=q('.nc-ctr-btn');
    ctrBtn?.addEventListener('click',e=>{
      e.stopPropagation();
      openOvBody(ov);
      ctrCb.checked=!ctrCb.checked;
      ctrCb.dispatchEvent(new Event('change'));
    });
    q('.nc-op').value=Math.round(ov.selOpacity*100);
    q('.nc-op').addEventListener('input',e=>{ov.selOpacity=e.target.value/100;q('.nc-ov').textContent=e.target.value+'%';schedRender(ov);});
    const wireFx=(cls,valCls,prop)=>{
      const el=q(cls); if(!el) return;
      el.addEventListener('input',e=>{
        const pct=+e.target.value; ov[prop]=pct/100;
        const lab=q(valCls); if(lab) lab.textContent=pct+'%';
        schedRender(ov);
      });
    };
    wireFx('.nc-bright','.nc-brightv','selBright');
    wireFx('.nc-contrast','.nc-contrastv','selContrast');
    wireFx('.nc-sat','.nc-satv','selSaturate');
    q('.nc-fx-reset')?.addEventListener('click',()=>{
      ov.selBright=1;ov.selContrast=1;ov.selSaturate=1;ov.selOpacity=0.65;
      const set=(cls,valCls,v,suffix)=>{const el=q(cls);if(el)el.value=v;const lab=q(valCls);if(lab)lab.textContent=v+(suffix||'%');};
      set('.nc-bright','.nc-brightv',100);
      set('.nc-contrast','.nc-contrastv',100);
      set('.nc-sat','.nc-satv',100);
      set('.nc-op','.nc-ov',65);
      schedRender(ov);
    });
    q('.nc-ctr').addEventListener('change',e=>{
      ov.showContours=e.target.checked;
      const wrap=q('.nc-ctr-wrap');
      if(wrap) wrap.style.display=e.target.checked?'':'none';
      ctrBtn?.classList.toggle('on',e.target.checked);
      _updateLandFill();
      schedRender(ov);
    });
    const ctrSl=q('.nc-ctr-sl'), ctrStep=q('.nc-ctr-step'), ctrStepU=q('.nc-ctr-step-u'), ctrLvlN=q('.nc-ctr-lvln');
    ov.contourCount=12; // only used to pick an initial auto interval before data loads
    if(ov.contourStep==null) ov._ctrAuto=true;
    const GLOBE_CTR_MAX_LINES=32;
    const globeCtrBounds=(mn,mx)=>{
      const range=(mn!=null&&mx!=null)?Math.max(mx-mn,1e-9):null;
      if(range==null) return {lo:1e-6,hi:1,def:1,maxLines:GLOBE_CTR_MAX_LINES};
      const nCtrOvs=Math.max(1,overlays.filter(o=>o.enabled&&o.showContours).length);
      const maxLines=Math.max(8,Math.floor(GLOBE_CTR_MAX_LINES/nCtrOvs));
      const lo=Math.max(_niceRound(range/120),range/maxLines);
      const hi=Math.max(lo*2,_niceRound(range/5));
      const def=_niceContourStep(range,Math.min(ov.contourCount||12,maxLines-1));
      return {lo,hi,def:Math.max(lo,Math.min(hi,def)),maxLines};
    };
    const fmtStep=v=>{
      if(v==null||!isFinite(v)) return '';
      const a=Math.abs(v), d=a<1?3:a<10?2:a<100?1:0;
      return (+v.toFixed(d)).toString();
    };
    // The slider IS the interval (no artificial cap) — its range is rescaled
    // to the active variable's data range so it stays meaningful across very
    // different datasets (e.g. 0.5 hPa vs 60 gpm vs 2 K).
    const syncCtrUi=()=>{
      const mn=ov.cachedMin, mx=ov.cachedMax;
      const range=(mn!=null&&mx!=null)?Math.max(mx-mn,1e-9):null;
      const {lo,hi,def,maxLines}=globeCtrBounds(mn,mx);
      if(range!=null){
        if(ctrSl){ ctrSl.min=String(lo); ctrSl.max=String(hi); ctrSl.step=String(_niceRound((hi-lo)/80)||lo); }
        if(ov._ctrAuto||ov.contourStep==null){
          ov.contourStep=def;
        } else if(!(ov.contourStep>0)||!isFinite(ov.contourStep)){
          // Only reset a genuinely invalid step (<=0, NaN, Infinity) back to
          // auto. A valid custom step is kept exactly as the user set it —
          // it used to get silently re-clamped into [lo,hi] here every time
          // the data range changed (new frame/level) or another overlay's
          // contours got toggled (which shrinks the shared line budget and
          // shifts lo/hi), so a "reasonable" value could vanish without
          // any visible cause.
          ov.contourStep=def;
        }
      }
      if(ctrSl){
        // Keep the slider's own handle within its (possibly narrower) range
        // even when the stored step is a wider custom value — clamping the
        // widget, not the underlying value.
        const sv=Math.max(lo,Math.min(hi,ov.contourStep||def));
        if(sv>0) ctrSl.value=String(sv);
      }
      if(ctrStep){ ctrStep.min=String(1e-6); ctrStep.removeAttribute('max'); }
      if(ctrStep) ctrStep.value=ov._ctrAuto?'':fmtStep(ov.contourStep);
      const hint=_contourStepHint({units:ov.activeSlice?.units,longName:ov.activeSlice?.longName,varName:ov.selVar});
      if(ctrStepU) ctrStepU.textContent=hint||'';
      if(ctrLvlN&&range!=null&&ov.contourStep>0){
        const n=Math.max(1,Math.round(range/ov.contourStep)-1);
        const warn=n>maxLines?' · ⚠ many lines':'';
        ctrLvlN.textContent=(ov._ctrAuto?'auto · ':'')+'≈'+n+' contour line'+(n===1?'':'s')+warn;
      }
    };
    if(ctrSl){
      const applySlider=()=>{
        const {lo,hi}=globeCtrBounds(ov.cachedMin,ov.cachedMax);
        ov.contourStep=Math.max(lo,Math.min(hi,+ctrSl.value));
        ov._ctrAuto=false;
        ov._contourCache=null; ov._screenContourCache=null; ov._ctrGeoCache=null;
        syncCtrUi();
        if(ov.showContours) schedRender(ov);
      };
      ctrSl.addEventListener('input',applySlider);
    }
    const ctrStyle=q('.nc-ctr-style');
    if(ctrStyle){
      ctrStyle.value=ov.contourStyle||'synoptic';
      ctrStyle.addEventListener('change',e=>{
        ov.contourStyle=e.target.value;
        // style change doesn't affect the ring geometry — only redraw needed
        schedRender(ov);
      });
    }
    if(ctrStep){
      let stepTimer=null;
      const applyStep=()=>{
        // Accept the typed value as-is (only reject <=0/NaN/Infinity) — it
        // used to be force-clamped into the slider's [lo,hi] window here,
        // which silently substituted a different number than what the user
        // typed whenever their value fell outside that window.
        const v=parseFloat(ctrStep.value);
        if(v>0&&isFinite(v)){ ov.contourStep=v; ov._ctrAuto=false; }
        else { ov._ctrAuto=true; }
        ov._contourCache=null; ov._screenContourCache=null; ov._ctrGeoCache=null;
        syncCtrUi();
        if(ov.showContours) schedRender(ov);
      };
      ctrStep.addEventListener('input',()=>{
        clearTimeout(stepTimer);
        stepTimer=setTimeout(applyStep,450);
      });
      ctrStep.addEventListener('change',applyStep);
    }
    ov._syncStepHint=syncCtrUi;
    syncCtrUi();
    q('.nc-ts').addEventListener('input',e=>{ applySliderValue(ov,+e.target.value); });
    q('.nc-tp').addEventListener('click',()=>applyDimensionStep(ov,-1));
    q('.nc-tn').addEventListener('click',()=>applyDimensionStep(ov,+1));
    q('.nc-loop-dim')?.addEventListener('change',e=>{
      ov._loopMode=e.target.value;
      updateTimeControls(ov);
      syncTimeUI(ov);
      invalidateSlice(ov);
      rebuildSlice(ov);
      schedRender(ov);
    });
    q('.nc-au').addEventListener('change',e=>{
      const a=e.target.checked;q('.nc-rn').disabled=a;q('.nc-rx').disabled=a;
      if(a){ov.vminOvr=null;ov.vmaxOvr=null;}schedRender(ov);
    });
    q('.nc-rn').addEventListener('change',e=>{ov.vminOvr=parseFloat(e.target.value)||null;schedRender(ov);});
    q('.nc-rx').addEventListener('change',e=>{ov.vmaxOvr=parseFloat(e.target.value)||null;schedRender(ov);});
  }

  function pickFiles(ov,addMode){
    const inp=document.createElement('input');inp.type='file';inp.accept='.nc,.nc4,.grb,.grb2,.grib,.grib2,.h5,.hdf5';inp.multiple=true;
    inp.onchange=async e=>{
      const files=[...e.target.files];if(!files.length)return;
      if(!addMode){
        // clear existing frames+readers first
        ov.readers.forEach(r=>{try{r.close();}catch(e){}});ov.readers=[];ov.frames=[];ov.selVar=null;
        ov.activeSlice=null;ov.renderSlice=null;ov.cachedMin=null;ov.cachedMax=null;
        if(ov._fcache)ov._fcache.clear();
        // Wipe both render surfaces so no "ghost" of the previous dataset
        // lingers underneath the newly loaded one (WebGPU keeps its own canvas).
        ov.ctx.clearRect(0,0,ov.canvas.width,ov.canvas.height);
        ov._ctrGeoCache=null;ov._contourCache=null;ov._screenContourCache=null;
        if(ov._wgpuCanvas) ov._wgpuCanvas.style.display='none';
        ov.cardEl.querySelector('.nc-file-list').innerHTML='';
      }
      for(const f of files) await appendFileToOverlay(ov,f,true);
    };
    // Append to body briefly so browser allows the programmatic click
    document.body.appendChild(inp);
    inp.click();
    setTimeout(()=>{ try{document.body.removeChild(inp);}catch(e){} },30000);
  }

  function stepTime(ov,dir){
    const n=ov.maxTime||1;
    if(n<=1) return;
    ov.selTime=((ov.selTime??0)+dir+n)%n;
    // Keep _fcache so prefetched adjacent frames survive the step.
    // _ctrGeoCache is deliberately KEPT too: its cache key includes selTime
    // so it can never be wrongly reused, but during animation the stale
    // rings are what _drawContours shows while the new timestep's rings
    // rebuild asynchronously — nulling it here made contours blink off
    // for a tick on every animation step.
    ov.activeSlice=null;ov.renderSlice=null;
    ov._contourCache=null;ov._screenContourCache=null;
    rebuildSlice(ov);syncTimeUI(ov);schedRender(ov);
  }
  function openOvBody(ov){
    const b=ov.cardEl?.querySelector('.nc-cb');if(b)b.style.display='';
    // Style section intentionally stays collapsed on load — opacity, the
    // contour toggle and the colour legend cover the common cases, and the
    // legend/▸ header opens the full colour & style controls on demand.
  }
  function setOvStatus(ov,msg,err){
    const el=ov.cardEl?.querySelector('.nc-st2');if(!el)return;
    el.textContent=msg||'';
    el.style.color=err?'var(--warm)':'var(--acc)';
    if(!err&&ov.frames.length){
      const nameEl=ov.cardEl.querySelector('.nc-cname');
      if(nameEl){nameEl.textContent=ov.name;nameEl.classList.remove('nc-empty');}
    }
  }
  function refreshCardVarPicker(ov){
    const sel=ov.cardEl?.querySelector('.nc-var');if(!sel)return;
    sel.innerHTML=ov.varOptions.map(o=>`<option value="${o.name}">${o.label}</option>`).join('');
    if(ov.selVar) sel.value=ov.selVar;
    // "Send variable to new overlay" re-decodes from ov.readers — nonsense
    // for a virtual overlay's precomputed stat/mode variables, which have
    // no file reader behind them at all.
    const _isVirtual=ov._trend||ov._corr||ov._composite||ov._eof||ov._regress||ov._derived;
    const _sb=ov.cardEl?.querySelector('.nc-send-var');if(_sb)_sb.style.display=(ov.varOptions.length>1&&!_isVirtual)?'':'none';
    ov.cardEl.querySelector('.nc-ctrls').style.display='';
    ov.cardEl.querySelector('.nc-cname').textContent=ov.name;
    ov.cardEl.querySelector('.nc-cname').classList.remove('nc-empty');
  }
  function refreshLevelControls(ov,grid){
    const row=ov.cardEl?.querySelector('.nc-lev-row');
    const sel=ov.cardEl?.querySelector('.nc-lev');
    if(!row||!sel)return;
    const gl=getGribLevels(ov);
    const lvls=grid?.levels?.length>1?grid.levels:gl;
    const units=(grid?.levels?.length>1?grid.levUnits:ov._gribLevUnits)||'';
    if(!lvls||lvls.length<=1){row.style.display='none';return;}
    sel.innerHTML=lvls.map((lv,i)=>`<option value="${i}">${lv}${units?' '+units:''}</option>`).join('');
    sel.value=String(ov.selLevIdx??grid.defaultLevI??0);
    row.style.display='';
  }
  function updateTimeControls(ov){
    const c=ov.cardEl;if(!c)return;
    const row=c.querySelector('.nc-tr');
    const multiT=hasMultiTime(ov), multiL=hasMultiLevel(ov);
    if(!multiT&&!multiL){row.style.display='none';return;}
    row.style.display='';
    const mode=effectiveLoopMode(ov);
    const sl=c.querySelector('.nc-ts');
    if(sl){
      if(mode==='level'){
        sl.max=Math.max(0,getLevelCount(ov)-1);
        sl.value=ov.selLevIdx??0;
      } else {
        sl.max=Math.max(0,ov.maxTime-1);
        sl.value=ov.selTime;
      }
    }
    const loopLbl=c.querySelector('.nc-loop-dim-lbl');
    const loopSel=c.querySelector('.nc-loop-dim');
    if(loopLbl) loopLbl.style.display=canChooseLoopMode(ov)?'flex':'none';
    if(loopSel) loopSel.value=ov._loopMode||'time';
    syncTimeUI(ov);
    const fc=c.querySelector('.nc-fc');
    if(fc) fc.textContent=ov.readers.length+' file(s) \u00b7 '+ov.frames.length+' frame'+(ov.frames.length!==1?'s':'');
    // The per-file breakdown (label, count) only adds information beyond
    // the card header once a series actually spans more than one file \u2014
    // for the common single-file case it just repeats the header verbatim.
    const seriesWrap=c.querySelector('.nc-series-wrap');
    if(seriesWrap) seriesWrap.classList.toggle('nc-series-multi',ov.readers.length>1);
    const fl=c.querySelector('.nc-file-list');
    if(fl){
      fl.innerHTML='';
      ov.readers.forEach((r,i)=>{
        const nm=ov.frames.filter(f=>f.reader===r);
        const row2=document.createElement('div');row2.className='nc-file-row';
        row2.innerHTML=`<span class="nc-fnum">${String(i+1).padStart(2,'0')}</span><span class="nc-fname">${r._fname?r._fname.split('/').pop():('file'+(i+1))}</span><span class="nc-ffr">${nm.length}fr</span>`;
        fl.appendChild(row2);
      });
    }
  }
  function syncTimeUI(ov){
    const c=ov.cardEl;if(!c)return;
    const mode=effectiveLoopMode(ov);
    const sl=c.querySelector('.nc-ts');
    if(sl) sl.value=mode==='level'?(ov.selLevIdx??0):ov.selTime;
    const tv=c.querySelector('.nc-tvbig');if(!tv)return;
    let label='—';
    if(mode==='level') label=getLevelLabel(ov)||('Level '+(ov.selLevIdx+1));
    else {
      const f=ov.frames[ov.selTime];
      label=f?f.label:'—';
    }
    tv.textContent=label;
    const fix=c.querySelector('.nc-tv-fixed');
    if(fix){
      if(canChooseLoopMode(ov)){
        fix.textContent=mode==='level'
          ?('Fixed time: '+(ov.frames[ov.selTime]?.label||'—'))
          :('Fixed level: '+(getLevelLabel(ov)||'—'));
      } else fix.textContent='';
    }
    const loopLbl=c.querySelector('.nc-loop-dim-lbl');
    if(loopLbl) loopLbl.style.display=canChooseLoopMode(ov)?'flex':'none';
  }
  function syncRangeInputs(ov){
    const c=ov.cardEl;if(!c)return;
    const fmt=v=>v!=null?Number(v.toPrecision(5)).toString():'';
    c.querySelector('.nc-rn').placeholder=fmt(ov.cachedMin);
    c.querySelector('.nc-rx').placeholder=fmt(ov.cachedMax);
  }
  // Quick-access colour swatch: a compact grid of every palette as a small
  // gradient block, so a colour change is one click from the collapsed
  // card instead of expanding the body and scrolling to the full style
  // section. "More style options…" at the bottom still reaches that full
  // section (opacity/contrast/range etc.) for anything beyond the palette.
  function openCmapSwatchMenu(ov,anchor){
    document.querySelectorAll('.nc-cmap-menu').forEach(m=>m.remove());
    const r=anchor.getBoundingClientRect();
    const m=document.createElement('div');
    m.className='nc-cmap-menu';
    const menuW=196;
    const spaceBelow=window.innerHeight-r.bottom-8, spaceAbove=r.top-8;
    const openUp=spaceBelow<230&&spaceAbove>spaceBelow;
    const topCss=openUp?'bottom:'+(window.innerHeight-r.top+4)+'px;':'top:'+(r.bottom+4)+'px;';
    m.style.cssText='position:fixed;z-index:400;left:'+Math.max(8,Math.min(window.innerWidth-menuW-8,r.left-80))+'px;'+topCss+
      'background:rgba(6,17,28,0.97);border:1px solid rgba(127,208,255,0.4);border-radius:8px;'+
      'padding:8px;font-family:IBM Plex Mono,monospace;color:#cfe3f2;width:'+menuW+'px;'+
      'box-shadow:0 10px 30px rgba(0,0,0,0.5);';
    let html='<div style="color:#7fa0b8;font-size:9px;letter-spacing:0.08em;margin-bottom:6px;">COLOUR MAP</div>'+
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;">';
    CMAP_KEYS.forEach(key=>{
      const lutArr=CMAPS[key];
      const stops=[];
      for(let i=0;i<=4;i++){const ci=Math.round(i/4*255)*3;stops.push('rgb('+lutArr[ci]+','+lutArr[ci+1]+','+lutArr[ci+2]+')');}
      const on=key===ov.selCmap;
      html+='<div class="nc-cmap-opt" data-k="'+key+'" title="'+key+'" style="height:20px;border-radius:4px;cursor:pointer;'+
        'background:linear-gradient(90deg,'+stops.join(',')+');'+
        'box-shadow:0 0 0 '+(on?'2px #ffd27f':'1px rgba(255,255,255,0.15)')+' inset;"></div>';
    });
    html+='</div>'+
      '<div class="nc-cmap-more" style="margin-top:8px;padding:6px;text-align:center;cursor:pointer;border-radius:5px;color:#7fd0ff;border-top:1px solid rgba(127,208,255,0.15);font-size:9.5px;">⚙ More style options…</div>';
    m.innerHTML=html;
    m.querySelectorAll('.nc-cmap-opt').forEach(el=>{
      el.addEventListener('mouseenter',()=>el.style.transform='scale(1.1)');
      el.addEventListener('mouseleave',()=>el.style.transform='');
      el.addEventListener('click',()=>{
        ov.selCmap=el.dataset.k;
        const cmSel=ov.cardEl?.querySelector('.nc-cm'); if(cmSel) cmSel.value=el.dataset.k;
        updateCmapPrev(ov); schedRender(ov);
        m.remove();
      });
    });
    m.querySelector('.nc-cmap-more').addEventListener('click',()=>{
      m.remove();
      openOvBody(ov);
      const styleToggle=ov.cardEl?.querySelector('.nc-style-toggle'), styleBlock=ov.cardEl?.querySelector('.nc-style-block');
      if(styleToggle&&styleBlock){
        if(styleBlock.style.display==='none') styleToggle.click();
        requestAnimationFrame(()=>styleBlock.scrollIntoView({block:'center',behavior:'smooth'}));
      }
    });
    document.body.appendChild(m);
    setTimeout(()=>document.addEventListener('click',function h(e){if(!m.contains(e.target)){m.remove();document.removeEventListener('click',h);}}),0);
  }
  function updateCmapPrev(ov){
    const lut=CMAPS[ov.selCmap]||CMAPS.viridis;
    const prev=ov.cardEl?.querySelector('.nc-cp');
    if(prev){
      const cv=document.createElement('canvas');cv.width=220;cv.height=10;
      const x=cv.getContext('2d'),id=x.createImageData(220,10);
      for(let i=0;i<220;i++){const ci=Math.round(i/219*255)*3;
        for(let j=0;j<10;j++){const idx=(j*220+i)*4;id.data[idx]=lut[ci];id.data[idx+1]=lut[ci+1];id.data[idx+2]=lut[ci+2];id.data[idx+3]=255;}}
      x.putImageData(id,0,0);prev.innerHTML='';prev.appendChild(cv);
    }
    // Header quick-access swatch — a lightweight CSS gradient (not a canvas)
    // so the current colormap stays visible even while the card body, and
    // therefore the legend/style block, are collapsed.
    const chip=ov.cardEl?.querySelector('.nc-swatch-chip');
    if(chip){
      const stops=[];
      for(let i=0;i<=6;i++){const ci=Math.round(i/6*255)*3;stops.push('rgb('+lut[ci]+','+lut[ci+1]+','+lut[ci+2]+')');}
      chip.style.background='linear-gradient(90deg,'+stops.join(',')+')';
    }
  }
  function renumberCards(){
    overlays.forEach((ov,i)=>{const el=ov.cardEl?.querySelector('.nc-cnum');if(el)el.textContent=String(i+1).padStart(2,'0');});
  }

  /* ============================================================ TIMELINE SYNC */
  function subscribeTimeline(){
    if(!window.GlobeTimeline) return;
    window.GlobeTimeline.subscribe((month, date) => {
      overlays.forEach(ov => {
        if(!ov.frames.length) return;
        if(effectiveLoopMode(ov)!=='time') return;
        const idx = window.GlobeTimeline.nearestFrame(ov.frames);
        if(idx !== ov.selTime){
          ov.selTime=idx;
          invalidateSlice(ov);
          syncTimeUI(ov); schedRender(ov);
        }
      });
    });
  }

  function registerOverlayFrames(ov){
    if(window.GlobeTimeline && ov.frames.length)
      window.GlobeTimeline.registerFrames(ov.frames, ov.id);
  }
  function unregisterOverlayFrames(ov){
    if(window.GlobeTimeline)
      window.GlobeTimeline.unregisterFrames(ov.id);
  }

  /* ============================================================ GLOBAL PANEL */
  function mountBoundaryToGeography(sect){
    const el=sect||document.getElementById('gp-user-geo-sect');
    if(!el) return false;
    const groups=document.getElementById('groups');
    const geoBody=(groups||document).querySelector('.grp-head[data-agrp="Geography"]')?.closest('.grp')?.querySelector('.grp-body');
    if(!geoBody) return false;
    if(!geoBody.contains(el)){
      el.classList.add('nc-geo-boundary-sect');
      geoBody.appendChild(el);
    }
    // Deliberately does NOT auto-expand the Geography group anymore: this
    // runs during startup workspace reorg, and force-opening it broke the
    // "every menu starts collapsed" first paint. The boundary section is
    // still right there when the user opens Geography themselves.
    return true;
  }

  function reorgWorkspacePanel(){
    const ctrl=document.getElementById('ctrl');
    if(!ctrl?.dataset.gpReady) return;
    const earth=ctrl.querySelector('.gp-pane[data-tab=earth]');
    if(earth){
      // Timeline goes FIRST — it's the master clock for the whole pane
      // (drives seasonal layers by month AND syncs overlay frames by
      // date), so it reads as a header control, not a footnote. It also
      // replaced the old standalone month slider that used to sit here.
      const tl=document.getElementById('tl-section');
      if(tl&&earth.firstChild!==tl) earth.insertBefore(tl,earth.firstChild);
      ['ann-section','rgn-section'].forEach(id=>{
        const el=document.getElementById(id);
        if(el&&!earth.contains(el)) earth.appendChild(el);
      });
    }
    mountBoundaryToGeography();
    const flowBox=document.getElementById('gp-flow-box');
    const flowMount=document.getElementById('gp-flow-mount');
    if(flowBox&&flowMount&&!flowMount.contains(flowBox)) flowMount.appendChild(flowBox);
  }
  window.reorgWorkspacePanel=reorgWorkspacePanel;

  function _parseUserGeoJSON(text){
    const raw=JSON.parse(String(text).replace(/^\uFEFF/,'').trim());
    if(raw.type==='Topology'&&typeof topojson!=='undefined'){
      const objs=raw.objects||{};
      const key=Object.keys(objs).find(k=>objs[k]&&(objs[k].geometries||objs[k].type==='GeometryCollection'))||Object.keys(objs)[0];
      if(!key) throw new Error('TopoJSON has no geometry objects');
      const fc=topojson.feature(raw, objs[key]);
      return fc.type==='FeatureCollection'?fc:{type:'FeatureCollection',features:[fc]};
    }
    if(raw.type==='Feature') return {type:'FeatureCollection',features:[raw]};
    if(raw.type==='FeatureCollection'){
      const features=(raw.features||[]).filter(f=>f&&f.geometry);
      if(!features.length) throw new Error('No valid features in file');
      return {type:'FeatureCollection',features};
    }
    if(raw.type==='GeometryCollection'){
      return {type:'FeatureCollection',features:(raw.geometries||[]).filter(Boolean).map(g=>({type:'Feature',properties:{},geometry:g}))};
    }
    if(raw.type==='Polygon'||raw.type==='MultiPolygon'||raw.type==='LineString'||raw.type==='MultiLineString'){
      return {type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:raw.type,coordinates:raw.coordinates}}]};
    }
    throw new Error('Need GeoJSON Feature, FeatureCollection, or TopoJSON');
  }
  function initWorkspacePanel(){
    const ctrl=document.getElementById('ctrl');
    if(!ctrl) return;
    if(ctrl.dataset.gpReady && ctrl.classList.contains('gp-shell')) return;
    ctrl.dataset.gpReady='1';
    ctrl.classList.add('gp-shell');
    const month=document.getElementById('month-ctrl');
    const presets=document.getElementById('presets');
    const groups=document.getElementById('groups');
    const opts=ctrl.querySelector('.opts');
    const nc=document.getElementById('nc-section');
    const ioStore=document.getElementById('gp-io-store');
    const perfStore=document.getElementById('gp-perf-store');
    const h2=ctrl.querySelector('h2');
    if(h2) h2.remove();
    const rail=document.createElement('div');
    rail.className='gp-rail';
    [['earth','◉'],['layers','▤'],['style','◎']].forEach(([id,ic])=>{
      const b=document.createElement('button');
      b.textContent=ic; b.title=id; b.dataset.tab=id;
      if(id==='earth') b.classList.add('on');
      rail.appendChild(b);
    });
    const tabbar=document.createElement('div');
    tabbar.className='gp-tabbar';
    const tabs=[['earth','Earth Systems'],['layers','Layers'],['style','Appearance']];
    let active='earth';
    tabs.forEach(([id,label])=>{
      const b=document.createElement('button');
      b.textContent=label; b.dataset.tab=id;
      if(id===active) b.classList.add('on');
      tabbar.appendChild(b);
    });
    const body=document.createElement('div');
    body.className='gp-body';
    const panes={};
    tabs.forEach(([id])=>{
      const p=document.createElement('div');
      p.className='gp-pane'+(id===active?' on':'');
      p.dataset.tab=id;
      panes[id]=p;
      body.appendChild(p);
    });
    const geoLoadSect=document.createElement('div');
    geoLoadSect.className='gp-sect';
    geoLoadSect.id='gp-user-geo-sect';
    geoLoadSect.innerHTML=
      '<div class="gp-sect-title">Boundary data (optional)</div>'+
      '<div style="font-family:IBM Plex Mono,monospace;font-size:9px;color:#7a93a8;line-height:1.45;margin-bottom:8px;">Load a GeoJSON or JSON FeatureCollection for admin boundaries. Used for region extraction and optional map overlays — nothing is fetched unless you choose a file.</div>'+
      '<label style="display:block;font-family:IBM Plex Mono,monospace;font-size:9.5px;color:#9fb6c9;margin-bottom:6px;cursor:pointer">'+
        '<input type="file" id="gp-user-geo-file" accept=".geojson,.json,application/geo+json,application/json" style="font-size:9px;color:#cfe3f2;width:100%">'+
      '</label>'+
      '<div id="gp-user-geo-status" style="font-family:IBM Plex Mono,monospace;font-size:9px;color:#5d7488;margin-bottom:6px;min-height:14px"></div>'+
      '<label style="display:flex;align-items:center;gap:6px;font-family:IBM Plex Mono,monospace;font-size:9.5px;color:#9fb6c9;cursor:pointer;margin-bottom:4px">'+
        '<input type="checkbox" id="gp-user-geo-show" disabled style="accent-color:#7fd0ff"> Show on globe'+
      '</label>'+
      '<button type="button" id="gp-user-geo-clear" disabled style="font-family:IBM Plex Mono,monospace;font-size:9px;background:none;border:1px solid rgba(127,208,255,0.35);color:#cfe3f2;cursor:pointer;padding:3px 8px;border-radius:4px;margin-top:4px">Clear</button>';
    [month,presets,groups,opts].forEach(el=>{if(el)panes.earth.appendChild(el);});
    if(!mountBoundaryToGeography(geoLoadSect)) panes.earth.appendChild(geoLoadSect);
    const geoFileIn=geoLoadSect.querySelector('#gp-user-geo-file');
    const geoStatus=geoLoadSect.querySelector('#gp-user-geo-status');
    const geoShow=geoLoadSect.querySelector('#gp-user-geo-show');
    const geoClear=geoLoadSect.querySelector('#gp-user-geo-clear');
    const _syncUserGeoUi=()=>{
      const ug=window._userGeoLayer;
      const has=!!(ug&&ug.geo&&ug.geo.features&&ug.geo.features.length);
      geoShow.disabled=!has;
      geoClear.disabled=!has;
      geoShow.checked=has&&!!ug.enabled;
      geoStatus.textContent=has?(ug.name+' · '+ug.geo.features.length+' features'):'No boundary file loaded.';
      const row=document.querySelector('.row[data-layer="user-geo"]');
      if(row) row.style.display=has?'':'none';
      if(window._refreshAllPlotWins) window._refreshAllPlotWins();
    };
    geoFileIn?.addEventListener('change',async e=>{
      const f=e.target.files&&e.target.files[0];
      if(!f) return;
      geoStatus.textContent='Loading '+f.name+'…';
      try{
        const fc=_parseUserGeoJSON(await f.text());
        if(!window.GlobeAPI?.applyUserGeoLayer) throw new Error('Globe not ready — wait for map to finish loading');
        window._userGeoLayer={name:f.name.replace(/\.(geojson|json)$/i,''),geo:fc,enabled:true,labels:null};
        window.GlobeAPI.applyUserGeoLayer();
        if(window.GlobeAPI.state) window.GlobeAPI.state['user-geo']=true;
        const row=document.querySelector('.row[data-layer="user-geo"]');
        if(row){row.classList.add('on');row.classList.remove('off');}
        _syncUserGeoUi();
      }catch(err){
        console.error('[user-geo load]', err);
        geoStatus.textContent='Load failed: '+(err.message||String(err));
        geoFileIn.value='';
      }
    });
    geoShow?.addEventListener('change',e=>{
      if(!window._userGeoLayer) return;
      window._userGeoLayer.enabled=e.target.checked;
      if(window.GlobeAPI?.state) window.GlobeAPI.state['user-geo']=e.target.checked;
      if(window.GlobeAPI?.redraw) window.GlobeAPI.redraw();
      _syncUserGeoUi();
    });
    geoClear?.addEventListener('click',()=>{
      if(window.GlobeAPI?.clearUserGeoLayer) window.GlobeAPI.clearUserGeoLayer();
      geoFileIn.value='';
      _syncUserGeoUi();
    });
    window._syncUserGeoUi=_syncUserGeoUi;
    _syncUserGeoUi();
    if(nc) panes.layers.appendChild(nc);
    if(ioStore){
      const sect=document.createElement('div');
      sect.className='gp-sect';
      sect.innerHTML='<div class="gp-sect-title">Load data</div>';
      while(ioStore.firstChild) sect.appendChild(ioStore.firstChild);
      panes.layers.appendChild(sect);
      ioStore.remove();
    }
    if(!window._geoAppearCfg){
      window._geoAppearCfg={autoBoost:true,coastW:0.35,coastBright:0.55,countryW:0.25,countryBright:0.4,ctrW:0.3,ctrBright:0.35,nameBright:0.5,nameSize:9.5};
    }
    const gcfg=window._geoAppearCfg;
    const stylePane=panes.style;
    if(perfStore){
      const perfSect=document.createElement('div');
      perfSect.className='gp-sect';
      perfSect.innerHTML='<div class="gp-sect-title">Rendering &amp; performance</div>';
      while(perfStore.firstChild) perfSect.appendChild(perfStore.firstChild);
      stylePane.appendChild(perfSect);
      perfStore.remove();
    }
    const geoSect=document.createElement('div');
    geoSect.className='gp-sect';
    geoSect.innerHTML=
      '<div class="gp-sect-title">Geography over data</div>'+
      '<div class="gp-appear" id="gp-geo-appear">'+
      '<label><input type="checkbox" id="gp-auto-boost" '+(gcfg.autoBoost?'checked':'')+'> Boost borders, coastlines, contours &amp; labels</label>'+
      [['coastW','Coast width boost',0,1.2,gcfg.coastW],['coastBright','Coast brightness',0,1,gcfg.coastBright],
       ['countryW','Border width boost',0,1,gcfg.countryW],['countryBright','Border brightness',0,1,gcfg.countryBright],
       ['ctrW','Contour width boost',0,1.2,gcfg.ctrW],['ctrBright','Contour brightness boost',0,1,gcfg.ctrBright],
       ['nameBright','Label brightness',0,1,gcfg.nameBright],['nameSize','Label size boost (px)',8,12,gcfg.nameSize]]
      // Step coarsened 40→15→8 divisions: even at 15 divisions each single
      // notch (e.g. ~0.067 of a 0-1 brightness boost) was too small a change
      // to read as a visible difference against the geography/data underneath.
      .map(([k,l,a,b,v])=>'<label>'+l+'<input data-gk="'+k+'" type="range" min="'+a+'" max="'+b+'" step="'+((b-a)/8)+'" value="'+v+'"></label>').join('')+
      '</div>';
    stylePane.appendChild(geoSect);
    const flowSect=document.createElement('div');
    flowSect.className='gp-sect';
    flowSect.innerHTML='<div class="gp-sect-title">Flow particles</div><div id="gp-flow-mount"></div>';
    stylePane.appendChild(flowSect);
    const _refreshBoost=()=>{
      // redraw() updates the SVG borders/coast/labels; onRedraw() re-renders
      // each NC overlay's own canvas so contour-boost changes are visible too.
      if(window.GlobeAPI?.redraw) window.GlobeAPI.redraw();
      if(window.GlobeAPI?.onRedraw) window.GlobeAPI.onRedraw();
    };
    stylePane.querySelector('#gp-auto-boost')?.addEventListener('change',e=>{
      gcfg.autoBoost=e.target.checked; _refreshBoost();
    });
    stylePane.querySelectorAll('input[data-gk]').forEach(inp=>{
      inp.addEventListener('input',()=>{ gcfg[inp.dataset.gk]=+inp.value; _refreshBoost(); });
    });
    const flowMount=stylePane.querySelector('#gp-flow-mount');
    const flowBox=document.getElementById('gp-flow-box');
    if(flowBox&&flowMount) flowMount.appendChild(flowBox);
    const collapse=document.createElement('button');
    collapse.className='gp-collapse';
    collapse.textContent='‹';
    collapse.title='Collapse panel';
    ctrl.insertBefore(rail, ctrl.firstChild);
    ctrl.insertBefore(tabbar, rail.nextSibling);
    ctrl.insertBefore(body, tabbar.nextSibling);
    ctrl.appendChild(collapse);
    const setTab=id=>{
      active=id;
      tabbar.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.tab===id));
      rail.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.tab===id));
      body.querySelectorAll('.gp-pane').forEach(p=>p.classList.toggle('on',p.dataset.tab===id));
      if(!ctrl.classList.contains('gp-collapsed')) body.style.display='';
    };
    tabbar.addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(b)setTab(b.dataset.tab);});
    // Collapse geometry is applied as INLINE styles (not just the
    // .gp-collapsed CSS class): the collapsed rail used to keep the
    // panel's normal top position, where its 44px sliver sat exactly on
    // top of the header's NOMADS/Help buttons — parked at the vertical
    // center of the left edge instead. Inline wins over any cascade.
    const setCollapsed=(c)=>{
      ctrl.classList.toggle('gp-collapsed',c);
      collapse.textContent=c?'›':'‹';
      if(c){ ctrl.style.width='44px'; ctrl.style.minWidth='44px'; ctrl.style.top='50%'; ctrl.style.transform='translateY(-50%)'; }
      else { ctrl.style.width=''; ctrl.style.minWidth=''; ctrl.style.top=''; ctrl.style.transform=''; }
    };
    rail.addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(b){setCollapsed(false);setTab(b.dataset.tab);}});
    collapse.addEventListener('click',()=>{
      setCollapsed(!ctrl.classList.contains('gp-collapsed'));
    });
    // Deliberately no auto-collapse-on-mouseleave: the panel used to
    // vanish to its icon rail ~2s after the cursor moved to the globe to
    // click something, which reads as broken rather than "smart" — you
    // move to interact with your own data and the controls disappear out
    // from under you. Reference apps (Windy, NASA Worldview) keep the
    // panel open until the user explicitly collapses it; do the same here.
    // Narrow/mobile viewports still start collapsed, since there's no
    // hover state on a touchscreen to reveal it again if it opened full.
    if(window.matchMedia('(max-width:640px)').matches) setCollapsed(true);
    reorgWorkspacePanel();
  }
  function wireRendererControls(){
    const ctrl=document.getElementById('ctrl');
    if(!ctrl||ctrl.dataset.rendererWired) return;
    ctrl.dataset.rendererWired='1';
    ctrl.addEventListener('click',e=>{
      const row=e.target.closest('.hwaccel-row');
      const hwT=row?.querySelector('#nc-hw-toggle')||e.target.closest('#nc-hw-toggle');
      const wgpuT=row?.querySelector('#nc-webgpu-toggle')||e.target.closest('#nc-webgpu-toggle');
      if(hwT){
        // Manual CPU/WebGL toggle removed — WebGL2 is the internal default
        // with automatic CPU fallback. Row is hidden; ignore stray clicks.
        return;
      }
      if(wgpuT){
        if(!_wgpuOK){ alert('WebGPU is not available in this browser.'); return; }
        useWebGPU=!useWebGPU;
        _wgpuFailStreak=0;
        _updateRendererStatus();
        overlays.forEach(ov=>{ov._wgpu=null;ov._contourCache=null;ov._screenContourCache=null;ov._ctrGeoCache=null;schedRender(ov);});
      }
    });
    _updateRendererStatus();
  }
  function finalizeGlobeNcPanel(){
    const steps=[
      ['gpu',()=>{_autoEnableGPU();}],
      ['workspace',()=>{initWorkspacePanel();}],
      ['renderer',()=>{wireRendererControls();}],
      ['reorg',()=>{reorgWorkspacePanel();}],
      ['overlay',()=>{if(!overlays.length) createOverlay();}],
      ['timeline',()=>{subscribeTimeline();}]
    ];
    for(const [name,fn] of steps){
      try{ fn(); }
      catch(e){ console.error('[GlobeNC] Panel step failed ('+name+'):', e); }
    }
  }
  window.finalizeGlobeNcPanel=finalizeGlobeNcPanel;
  window.wireGlobeRendererControls=wireRendererControls;

  function buildNcPanel(){
    if(document.getElementById('nc-section')) return;
    const ctrl=document.getElementById('ctrl');
    const sec=document.createElement('div');sec.id='nc-section';
    sec.innerHTML=`
<div class="nc-head" id="nc-head">
  <span>DATA OVERLAYS <span class="nc-badge">.nc</span></span>
  <span class="nc-tog" id="nc-tog">▾</span>
</div>
<div id="nc-body">
  <div id="nc-overlay-list"></div>
  <button class="btn nc-add-btn" id="nc-add" style="width:100%;margin-top:8px">＋ Add overlay</button>
  <button class="btn" id="nc-derive" style="width:100%;margin-top:4px;margin-bottom:16px;font-size:10.5px">➗ Derived layer (A op B)</button>
</div>`;
    ctrl.appendChild(sec);
    const sysStore=document.createElement('div');
    sysStore.id='gp-io-store';
    sysStore.innerHTML=`
<button class="btn" id="nc-nomads" style="width:100%;margin-top:6px">🌐 Load weather/ocean data (NOMADS)</button>
<button class="btn" id="nc-url" style="width:100%;margin-top:6px">🔗 Load from URL (.nc / .grib2)</button>
<button class="btn" id="nc-batch" style="width:100%;margin-top:4px;font-size:10.5px">📅 Load date range from NOMADS…</button>
<div style="display:flex;gap:6px;margin-top:4px;align-items:center">
  <button id="nc-proxy" style="flex:1;font-size:11px;opacity:0.7">⚙️ Set CORS proxy URL</button>
  <label style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--ink-faint);white-space:nowrap;cursor:pointer" title="Force fetches through proxy">
    <input type="checkbox" id="nc-proxy-force" style="accent-color:#7fd0ff">force
  </label>
</div>
<button class="btn" id="nc-measure" style="width:100%;margin-top:10px">📏 Measure distance</button>
<button class="btn" id="nc-png" style="width:100%;margin-top:6px">📷 Export view as PNG</button>`;
    ctrl.appendChild(sysStore);
    const perfStore=document.createElement('div');
    perfStore.id='gp-perf-store';
    perfStore.innerHTML=`
<div class="hwaccel-row">
  <div class="hw-label">WebGL2 renderer
    <small>Default GPU path. CPU only if WebGL unavailable.</small>
    <div class="hw-status" id="nc-hw-status">Probing…</div>
  </div>
  <div class="switch on" id="nc-hw-toggle"></div>
</div>
<div class="hwaccel-row" style="margin-top:8px">
  <div class="hw-label">WebGPU renderer
    <small>Experimental — uses WebGPU when available, falls back to WebGL2.</small>
    <div class="hw-status" id="nc-wgpu-status">Checking…</div>
  </div>
  <div class="switch" id="nc-webgpu-toggle"></div>
</div>`;
    ctrl.appendChild(perfStore);
    document.getElementById('nc-batch')?.addEventListener('click',async()=>{
      const ex='e.g. https://nomads.ncep.noaa.gov/cgi-bin/filter_gdas_0p25.pl?dir=%2Fgdas.20260620%2F00%2Fatmos&file=gdas.t00z.pgrb2.0p25.f000&var_TMP=on&lev_500_mb=on';
      const templateUrl=prompt('NOMADS GRIB filter URL for ONE date (dates iterated automatically):\n\n'+ex);
      if(!templateUrl)return;
      const d0str=prompt('Start date (YYYYMMDD):');if(!d0str)return;
      const d1str=prompt('End date (YYYYMMDD):');if(!d1str)return;
      let u;try{u=new URL(templateUrl);}catch{alert('Invalid URL');return;}
      const fp=u.searchParams.get('file')||'',dpT=decodeURIComponent(u.searchParams.get('dir')||'');
      if(!fp||!dpT){alert('Could not parse dir= and file=');return;}
      const dateMatch=dpT.match(/\.?(\d{8})\//);if(!dateMatch){alert('No YYYYMMDD in dir=');return;}
      const dsM=dpT.match(/\/([a-z]+)\.(\d{8})\//i),ds=(dsM?dsM[1]:'gfs').toLowerCase();
      const bk={'gfs':'noaa-gfs-bdp-pds','gdas':'noaa-gfs-bdp-pds','nam':'noaa-nam-pds','hrrr':'noaa-hrrr-pds','rap':'noaa-rap-pds'}[ds]||'noaa-gfs-bdp-pds';
      const d0=new Date(d0str.slice(0,4)+'-'+d0str.slice(4,6)+'-'+d0str.slice(6,8));
      const d1=new Date(d1str.slice(0,4)+'-'+d1str.slice(4,6)+'-'+d1str.slice(6,8));
      if(isNaN(d0)||isNaN(d1)||d1<d0){alert('Invalid dates');return;}
      const days=Math.round((d1-d0)/86400000)+1;
      if(days>31&&!confirm('Loading '+days+' days. Continue?'))return;
      const ov=createOverlay();openOvBody(ov);let loaded=0,errors=0;
      for(let d=new Date(d0);d<=d1;d.setDate(d.getDate()+1)){
        const ds2=d.toISOString().slice(0,10).replace(/-/g,'');
        const dp2=dpT.replace(dateMatch[0],'.'+ds2+'/');
        const s3Base='https://'+bk+'.s3.amazonaws.com'+dp2+'/'+fp;
        _hintRegion('Batch: '+ds2+' ('+(loaded+errors+1)+'/'+days+')…');
        try{
          let ab=null;
          try{
            const ir=await fetch(s3Base+'.idx',{mode:'cors'});
            if(ir.ok){
              const it=await ir.text();
              const wv=[...u.searchParams.keys()].filter(k=>k.startsWith('var_')&&u.searchParams.get(k)==='on').map(k=>k.slice(4).toUpperCase());
              const wl=[...u.searchParams.keys()].filter(k=>k.startsWith('lev_')&&u.searchParams.get(k)==='on').map(k=>k.slice(4).replace(/_/g,' '));
              const il=it.trim().split('\n');
              const en=il.map((l,i)=>{const p=l.split(':');return{offset:+p[1],v:(p[3]||'').trim().toUpperCase(),lv:(p[4]||'').trim().toLowerCase(),next:i+1<il.length?+il[i+1].split(':')[1]:null};});
              const mt=en.filter(e=>(wv.length===0||wv.includes(e.v))&&(wl.length===0||wl.some(w=>e.lv===w.toLowerCase())));
              if(mt.length){const cks=[];for(const m of mt){const rr=await fetch(s3Base,{mode:'cors',headers:{Range:'bytes='+m.offset+'-'+(m.next?m.next-1:'')}});if(rr.ok||rr.status===206)cks.push(await rr.arrayBuffer());}if(cks.length){const tot=cks.reduce((s,c)=>s+c.byteLength,0);const mg=new Uint8Array(tot);let p2=0;for(const c of cks){mg.set(new Uint8Array(c),p2);p2+=c.byteLength;}ab=mg.buffer;}}
            }
          }catch(ie){/* idx failed */}
          if(!ab){const r=await fetch(s3Base,{mode:'cors'});if(r.ok)ab=await r.arrayBuffer();}
          if(ab){await appendFileToOverlay(ov,new File([ab],ds2+'_'+fp+'.grib2'),true);loaded++;}else errors++;
        }catch(e){console.warn('[Batch]',ds2,e.message);errors++;}
      }
      _hintRegion(null);
      setOvStatus(ov,'✓ '+ds.toUpperCase()+' '+d0str+'–'+d1str+': '+loaded+' days'+(errors?' ('+errors+' failed)':''));
      updateTimeControls(ov);rebuildSlice(ov);schedRender(ov);
    });
    document.getElementById('nc-proxy')?.addEventListener('click',()=>{
      const cur=localStorage.getItem('lp_cors_proxy')||'';
      const val=prompt('CORS proxy URL (leave blank to clear):\nCurrent: '+(cur||'(none)'),cur);
      if(val===null)return;
      if(val.trim()){localStorage.setItem('lp_cors_proxy',val.trim().replace(/\/+$/,''));alert('Proxy set.');}
      else{localStorage.removeItem('lp_cors_proxy');alert('Cleared.');}
    });
    document.getElementById('nc-tog').addEventListener('click',()=>{
      const b=document.getElementById('nc-body'),t=document.getElementById('nc-tog');
      const v=b.style.display!=='none';b.style.display=v?'none':'';t.textContent=v?'▸':'▾';
    });
    document.getElementById('nc-add').addEventListener('click',()=>{
      if(overlays.length>=MAX){alert('Max '+MAX+' overlays.');return;}
      createOverlay();
      document.getElementById('nc-body').style.display='';
      document.getElementById('nc-tog').textContent='▾';
    });
    const derBtn=document.getElementById('nc-derive');
    if(derBtn) derBtn.addEventListener('click',()=>_openDeriveDialog());
    document.getElementById('nc-png').addEventListener('click',exportPNG);
    document.getElementById('nc-url').addEventListener('click',async ()=>{
      const url=prompt('Enter a URL to load:\n• GFS S3: https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.YYYYMMDD/HH/atmos/gfs.tHHz.pgrb2.0p25.f000\n• ERDDAP: https://coastwatch.pfeg.noaa.gov/erddap/griddap/...\nNOMADS GRIB filter URLs auto-convert to S3 with idx range fetch.');
      if(!url)return;
      try{
        const _cpVal=localStorage.getItem('lp_cors_proxy');
        const _forceP=document.getElementById('nc-proxy-force')?.checked&&!!_cpVal;
        const isNomads=/nomads\.ncep\.noaa\.gov.*filter_/i.test(url);
        const isGribUrl=/\.grb2?|\.grib2?|filter_|pgrb|grib/i.test(url);
        let fetchUrl=url;
        if(isNomads&&!_forceP){
          try{
            const u=new URL(url),fp=u.searchParams.get('file')||'',dp=decodeURIComponent(u.searchParams.get('dir')||'');
            if(fp&&dp){
              const ds=((dp.match(/^\/([a-z]+)\./i)||[])[1]||'').toLowerCase();
              const bk={'gfs':'noaa-gfs-bdp-pds','gdas':'noaa-gfs-bdp-pds','nam':'noaa-nam-pds','hrrr':'noaa-hrrr-pds','rap':'noaa-rap-pds'}[ds]||null;
              if(bk){
                const s3Base='https://'+bk+'.s3.amazonaws.com'+dp+'/'+fp;
                try{
                  const ir=await fetch(s3Base+'.idx',{mode:'cors'});
                  if(ir.ok){
                    const it=await ir.text();
                    const op=new URL(url).searchParams;
                    const wv=[...op.keys()].filter(k=>k.startsWith('var_')&&op.get(k)==='on').map(k=>k.slice(4).toUpperCase());
                    const wl=[...op.keys()].filter(k=>k.startsWith('lev_')&&op.get(k)==='on').map(k=>k.slice(4).replace(/_/g,' '));
                    const il=it.trim().split('\n');
                    const en=il.map((l,i)=>{const p=l.split(':');return{offset:+p[1],v:(p[3]||'').trim().toUpperCase(),lv:(p[4]||'').trim().toLowerCase(),next:i+1<il.length?+il[i+1].split(':')[1]:null};});
                    const mt=en.filter(e=>(wv.length===0||wv.includes(e.v))&&(wl.length===0||wl.some(w=>e.lv===w.toLowerCase())));
                    if(mt.length>0){
                      const cks=[];for(const m of mt){_hintRegion('→ '+m.v+' '+m.lv+'…');const rr=await fetch(s3Base,{mode:'cors',headers:{Range:'bytes='+m.offset+'-'+(m.next?m.next-1:'')}});if(rr.ok||rr.status===206)cks.push(await rr.arrayBuffer());}
                      if(cks.length>0){const tot=cks.reduce((s,c)=>s+c.byteLength,0);const mg=new Uint8Array(tot);let p2=0;for(const c of cks){mg.set(new Uint8Array(c),p2);p2+=c.byteLength;}
                        _hintRegion('Decoding…');const ov2=createOverlay();await appendFileToOverlay(ov2,new File([mg.buffer],fp+'.grib2'),false);_hintRegion(null);return;}}
                  }
                }catch(ie){console.warn('[idx]',ie.message);}
                fetchUrl=s3Base;_hintRegion('→ S3…');
              }
            }
          }catch(e){console.error('[NOMADS]',e);}
        }
        const fname=decodeURIComponent(fetchUrl.split('/').pop().split('?')[0]||'remote.nc');
        if(fetchUrl===url)_hintRegion('Downloading '+fname+'…');
        const tryF=async(fu,lb)=>{const r=await fetch(fu,{mode:'cors'});if(!r.ok)throw new Error('HTTP '+r.status+' '+lb);return r;};
        const _cp=_cpVal;
        let resp=null,lastErr='';
        const proxies=_forceP&&_cp?[[_cp+'?url='+encodeURIComponent(fetchUrl),'proxy(forced)']]
          :([[fetchUrl,'direct'],...(_cp?[[_cp+'?url='+encodeURIComponent(fetchUrl),'proxy']]:[])])
            .concat([['https://corsproxy.io/?url='+encodeURIComponent(fetchUrl),'corsproxy.io'],['https://api.allorigins.win/raw?url='+encodeURIComponent(fetchUrl),'allorigins']]);
        for(const [pu,pl] of proxies){try{resp=await tryF(pu,pl);console.log('[Globe] OK via',pl);break;}catch(e){lastErr=e.message;resp=null;}}
        if(!resp){
          if(confirm((fetchUrl!==url?'S3 unavailable.\n\n':'CORS blocked.\n\n')+'Open in new tab to download, then drop onto globe.\nLast error: '+lastErr))window.open(url,'_blank');
          _hintRegion(null);return;
        }
        let ab;const cl=+resp.headers.get('content-length')||0;
        if(cl>5*1024*1024&&resp.body){
          const rd=resp.body.getReader();const cks2=[];let recv=0;
          while(true){const{done,value}=await rd.read();if(done)break;cks2.push(value);recv+=value.length;
            _hintRegion('Downloading '+fname+': '+(cl?Math.round(recv/1048576)+'/'+(cl/1048576).toFixed(0)+' MB ('+(recv/cl*100|0)+'%)':((recv/1048576).toFixed(1)+' MB')));}
          const mg2=new Uint8Array(recv);let p3=0;for(const c of cks2){mg2.set(c,p3);p3+=c.length;}ab=mg2.buffer;
        }else ab=await resp.arrayBuffer();
        _hintRegion('Decoding '+fname+'…');
        const oN=isGribUrl&&!fname.match(/\.gr[ib2b]+$/i)?fname.replace(/\.nc$/,'')+'.grib2':fname;
        const ov=createOverlay();await appendFileToOverlay(ov,new File([ab],oN),false);_hintRegion(null);
      }catch(err){_hintRegion(null);alert('Could not load:\n'+err.message);}});
    document.getElementById('nc-measure').addEventListener('click',()=>{
      _measurePick=[];
      if(api) api._globeMeasurePicking=true;
      _hintRegion('MEASURE — click the FIRST point on the globe (Esc cancels)');
    });
  }

  /* ===== Hover readout — shows lon/lat + data values under the cursor ===== */
  const hoverEl=document.createElement('div');
  hoverEl.id='nc-hover';
  hoverEl.style.cssText='position:fixed;display:none;pointer-events:none;z-index:200;'+
    'background:rgba(6,17,28,0.92);border:1px solid rgba(127,208,255,0.35);border-radius:7px;'+
    'padding:7px 10px;font-family:"IBM Plex Mono",monospace;font-size:10.5px;line-height:1.55;'+
    'color:#cfe3f2;box-shadow:0 4px 18px rgba(0,0,0,0.5);max-width:280px;';
  document.body.appendChild(hoverEl);
  let hoverRAF=null;
  function _updateHoverAt(mx,my){
    const live=overlays.filter(o=>o.enabled&&o.renderSlice);
    if(!live.length){hoverEl.style.display='none';return;}
    const proj=api.projection,[pcx,pcy]=proj.translate(),pR=proj.scale();
    const dx=mx-pcx,dy=my-pcy;
    if(dx*dx+dy*dy>pR*pR){hoverEl.style.display='none';return;}
    const ll=proj.invert([mx,my]);
    if(!ll){hoverEl.style.display='none';return;}
    const lonS=(ll[0]>=0?ll[0].toFixed(2)+'°E':(-ll[0]).toFixed(2)+'°W');
    const latS=(ll[1]>=0?ll[1].toFixed(2)+'°N':(-ll[1]).toFixed(2)+'°S');
    let html='<span style="color:#7fd0ff">'+lonS+' · '+latS+'</span>';
    let any=false;
    live.forEach(ov=>{
      const rs=ov.renderSlice;
      const v=sampleAt(ll[0],ll[1],rs,rs.lats,rs.lons);
      if(!isNaN(v)){
        any=true;
        const u=(ov.activeSlice&&ov.activeSlice.units)||'';
        const meta=[];
        const fLab=ov.frames?.[ov.selTime]?.label;
        if(fLab&&hasMultiTime(ov)) meta.push(fLab);
        if(hasMultiLevel(ov)){
          const levLab=getLevelLabel(ov)||('Level '+(ov.selLevIdx+1));
          meta.push(levLab);
        }
        const metaS=meta.length?(' <span style="color:#6a8298">['+meta.join(' · ')+']</span>'):'';
        html+='<br><span style="color:#9fb6c9">'+(ov.name||'overlay').slice(0,28)+':</span> '+
          '<b style="color:#ffd27f">'+(Math.abs(v)<0.01||Math.abs(v)>=1e5?v.toExponential(3):v.toFixed(3))+'</b> '+u+metaS;
      }
    });
    if(!any){hoverEl.style.display='none';return;}
    hoverEl.innerHTML=html;
    hoverEl.style.display='block';
    const pad=14, w=hoverEl.offsetWidth, h=hoverEl.offsetHeight;
    hoverEl.style.left=Math.min(innerWidth-w-8, mx+pad)+'px';
    hoverEl.style.top =Math.min(innerHeight-h-8, my+pad)+'px';
  }
  document.addEventListener('mousemove',e=>{
    _lastMouse={x:e.clientX,y:e.clientY};
    if(hoverRAF) return;
    hoverRAF=requestAnimationFrame(()=>{hoverRAF=null;_updateHoverAt(_lastMouse.x,_lastMouse.y);});
  });

  /* ===== Exports (Panoply-style) ===== */
  function _downloadCSV(parts,fname){
    const blob=new Blob(parts,{type:'text/csv'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=fname;
    a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  }
  function _sliceToCSV(rs,parts,timeLabel){
    for(let i=0;i<rs.nLat;i++){
      let line='';
      for(let j=0;j<rs.nLon;j++){
        const v=rs.data[i*rs.nLon+j];
        if(isNaN(v))continue;
        line+=(timeLabel!==undefined?timeLabel+',':'')+rs.lons[j].toFixed(4)+','+rs.lats[i].toFixed(4)+','+v.toPrecision(7)+'\n';
      }
      if(line)parts.push(line);
    }
  }
  function exportCSVCurrent(ov){
    const rs=ov.renderSlice; if(!rs){alert('No data loaded.');return;}
    const fLab=(ov.frames&&ov.frames[ov.selTime])?('_'+ov.frames[ov.selTime].label.replace(/[^\w.-]/g,'_')):'';
    const parts=['lon,lat,value\n'];
    _sliceToCSV(rs,parts);
    _downloadCSV(parts,(ov.name||'overlay').replace(/[^\w.-]/g,'_')+fLab+'.csv');
  }
  async function exportCSVAll(ov,btn){
    const n=ov.frames.length;
    if(n>40 && !confirm(n+' frames — the combined CSV may be large. Continue?')) return;
    ov._cacheMax=Math.max(ov._cacheMax||0,n);
    const parts=['time,lon,lat,value\n'];
    for(let t=0;t<n;t++){
      const fr=_cacheGet(ov,t); if(!fr)continue;
      _sliceToCSV(fr.renderSlice,parts,ov.frames[t].label||t);
      if(btn)btn.textContent=Math.round((t+1)/n*100)+'%';
      await new Promise(r=>setTimeout(r,0));
    }
    if(btn)btn.textContent='⬇';
    _downloadCSV(parts,(ov.name||'overlay').replace(/[^\w.-]/g,'_')+'_all_frames.csv');
  }
  function teleMenu(ov,anchor){
    document.querySelectorAll('.nc-csv-menu').forEach(m=>m.remove());
    if(!ov.frames||ov.frames.length<3){alert('Load at least 3 time frames first.');return;}
    const r=anchor.getBoundingClientRect();
    const m=document.createElement('div');
    m.className='nc-csv-menu';
    m.style.cssText='position:fixed;z-index:400;left:'+Math.max(8,r.left-170)+'px;top:'+(r.bottom+4)+'px;'+
      'background:rgba(6,17,28,0.97);border:1px solid rgba(127,208,255,0.4);border-radius:8px;'+
      'padding:5px;font-family:IBM Plex Mono,monospace;font-size:10px;color:#cfe3f2;width:210px;';
    m.innerHTML=
      '<div class="m1" style="padding:6px 10px;cursor:pointer;border-radius:5px;">🔗 Correlation map…</div>'+
      '<div class="m2" style="padding:6px 10px;cursor:pointer;border-radius:5px;">🧮 Composite analysis…</div>'+
      '<div class="m3" style="padding:6px 10px;cursor:pointer;border-radius:5px;">📊 EOF / PCA…</div>'+
      '<div class="m4" style="padding:6px 10px;cursor:pointer;border-radius:5px;">📈 Multiple regression…</div>';
    m.querySelectorAll('div').forEach(d=>{d.addEventListener('mouseenter',()=>d.style.background='rgba(127,208,255,0.12)');d.addEventListener('mouseleave',()=>d.style.background='');});
    m.querySelector('.m1').addEventListener('click',()=>{m.remove();startCorrPick(ov);});
    m.querySelector('.m2').addEventListener('click',()=>{m.remove();_openCompositeDialog(ov);});
    m.querySelector('.m3').addEventListener('click',()=>{m.remove();_openEofDialog(ov);});
    m.querySelector('.m4').addEventListener('click',()=>{m.remove();_openRegressionDialog(ov);});
    setTimeout(()=>document.addEventListener('click',function h(e){if(!m.contains(e.target)){m.remove();document.removeEventListener('click',h);}}),0);
    document.body.appendChild(m);
  }
  function exportCSVMenu(ov,anchor){
    document.querySelectorAll('.nc-csv-menu').forEach(m=>m.remove());
    if(!ov.frames||ov.frames.length<2){exportCSVCurrent(ov);return;}
    const r=anchor.getBoundingClientRect();
    const m=document.createElement('div');
    m.className='nc-csv-menu';
    m.style.cssText='position:fixed;z-index:400;left:'+Math.max(8,r.left-150)+'px;top:'+(r.bottom+4)+'px;'+
      'background:rgba(6,17,28,0.97);border:1px solid rgba(127,208,255,0.4);border-radius:8px;'+
      'padding:5px;font-family:IBM Plex Mono,monospace;font-size:10px;color:#cfe3f2;';
    const fLab=(ov.frames[ov.selTime]&&ov.frames[ov.selTime].label)||'';
    m.innerHTML=
      '<div class="m1" style="padding:6px 10px;cursor:pointer;border-radius:5px;">Current frame ('+fLab+')</div>'+
      '<div class="m2" style="padding:6px 10px;cursor:pointer;border-radius:5px;">All '+ov.frames.length+' frames (time,lon,lat,value)</div>';
    m.querySelectorAll('div').forEach(d=>{d.addEventListener('mouseenter',()=>d.style.background='rgba(127,208,255,0.12)');d.addEventListener('mouseleave',()=>d.style.background='');});
    m.querySelector('.m1').addEventListener('click',()=>{m.remove();exportCSVCurrent(ov);});
    m.querySelector('.m2').addEventListener('click',()=>{m.remove();exportCSVAll(ov,anchor);});
    setTimeout(()=>document.addEventListener('click',function h(e){if(!m.contains(e.target)){m.remove();document.removeEventListener('click',h);}}),0);
    document.body.appendChild(m);
  }

  /* Panoply-style plotting: titled lon-lat map with graticule, coastline,
     gray missing-data, axis ticks and a labelled colorbar; zonal/meridional
     line plots; and a Hovmöller (time-latitude) diagram over all frames. */
  let _plotLand=null, _plotCountries=null, _plotGeoPending=[];
  function _getPlotLand(cb){
    if(_plotLand){cb(_plotLand);return;}
    _plotGeoPending.push(cb);
    if(_plotGeoPending.length>1) return;
    fetch('land-110m').then(r=>r.json()).then(t=>{
      _plotLand=window.topojson.mesh(t,t.objects.land).coordinates;
      const cbs=_plotGeoPending.splice(0); cbs.forEach(fn=>fn(_plotLand));
    }).catch(()=>{const cbs=_plotGeoPending.splice(0); cbs.forEach(fn=>fn(null));});
  }
  function _getPlotCountries(cb){
    if(_plotCountries){cb(_plotCountries);return;}
    fetch('countries-110m').then(r=>r.json()).then(t=>{
      _plotCountries=window.topojson.mesh(t,t.objects.countries,(a,b)=>a!==b).coordinates;
      cb(_plotCountries);
    }).catch(()=>cb(null));
  }
  _getPlotLand(()=>{});
  _getPlotCountries(()=>{});
  function _drawColorbar(x2,cmap,x,y,w,h,mn,mx,units){
    for(let i=0;i<w;i++){
      const ci=Math.round(i/(w-1)*255)*3;
      x2.fillStyle='rgb('+cmap[ci]+','+cmap[ci+1]+','+cmap[ci+2]+')';
      x2.fillRect(x+i,y,1.5,h);
    }
    x2.strokeStyle='rgba(160,185,205,0.7)';x2.strokeRect(x,y,w,h);
    x2.fillStyle='#9fb6c9';x2.font='9px IBM Plex Mono,monospace';x2.textAlign='center';
    for(let t2=0;t2<=4;t2++){
      const vv=mn+(mx-mn)*t2/4, px2=x+w*t2/4;
      x2.fillText(vv.toPrecision(4),px2,y+h+11);
      x2.beginPath();x2.moveTo(px2,y+h);x2.lineTo(px2,y+h+3);x2.stroke();
    }
    if(units)x2.fillText(units,x+w/2,y+h+22);
  }
  function _drawPlotContours(ctx,rs,mn,mx,L,T,pw,ph,lonMin,lonMax,latMin,latMax,nLev,styleName,meta,lite){
    const n=nLev||12;
    const thr=_contourThresholds(mn,mx,n,meta);
    if(!thr.length) return;
    const ckey=(meta?.varName||'')+'|'+(mn).toFixed(3)+'|'+(mx).toFixed(3)+'|'+thr.join(',');
    if(!rs._ctrCache||rs._ctrCache.key!==ckey){
      const maxDim=lite?380:(n>28?760:620);
      rs._ctrCache={key:ckey,contours:_contourRings(rs,thr,maxDim,lite)};
    }
    const {contours}=rs._ctrCache;
    if(!contours.length) return;
    const style=_plotContourStyle(styleName);
    const deadline=Date.now()+(lite?16:55);
    for(const c of contours){
      if(Date.now()>deadline) break;
      _strokePlotRings(ctx,c.rings,L,T,pw,ph,lonMin,lonMax,latMin,latMax,style);
    }
  }
  function quickPlot(ov){
    if(!ov.renderSlice){alert('No data loaded.');return;}
    const units=(ov.activeSlice&&ov.activeSlice.units)||'';
    const nWin=document.querySelectorAll('.nc-plot-win').length;
    const wrap=document.createElement('div');
    wrap.className='nc-plot-win';
    wrap.style.cssText='position:fixed;z-index:300;background:rgba(6,17,28,0.97);'+
      'border:1px solid rgba(127,208,255,0.4);border-radius:10px;padding:12px;'+
      'box-shadow:0 10px 40px rgba(0,0,0,0.7);max-width:96vw;'+
      'left:'+(60+nWin*30)+'px;top:'+(60+nWin*30)+'px;';
    wrap.innerHTML='<div class="pw-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;cursor:move;'+
      'font-family:IBM Plex Mono,monospace;font-size:10.5px;color:#9fb6c9;">'+
      '<span class="pw-title" style="min-width:0;overflow-wrap:break-word;margin-right:8px;"></span>'+
      '<div class="pw-head-btns" style="flex-shrink:0;">'+
      '<button type="button" class="pw-png" style="background:none;border:1px solid rgba(127,208,255,0.35);color:#cfe3f2;cursor:pointer;font-size:9px;font-family:IBM Plex Mono,monospace;padding:2px 7px;border-radius:4px;">↓ PNG</button>'+
      '<button type="button" class="pw-expand" style="background:none;border:1px solid rgba(127,208,255,0.35);color:#cfe3f2;cursor:pointer;font-size:11px;font-family:IBM Plex Mono,monospace;padding:1px 7px;border-radius:4px;" title="Expand / restore">⤢</button>'+
      '<button type="button" class="pw-x" style="background:none;border:none;color:#cfe3f2;cursor:pointer;font-size:14px;">✕</button></div></div>'+
      '<div class="pw-tabs" style="display:flex;gap:5px;margin-bottom:8px;pointer-events:auto;">'+
        ['Map','Zonal avg','Meridional avg','Time–Lat','Time–Lon','Histogram'].map((t,i)=>'<button type="button" data-pt="'+i+'" style="font-family:IBM Plex Mono,monospace;font-size:9.5px;letter-spacing:0.06em;padding:3px 9px;border-radius:5px;cursor:pointer;border:1px solid rgba(127,208,255,'+(i===0?'0.7':'0.25')+');background:'+(i===0?'rgba(127,208,255,0.18)':'none')+';color:#cfe3f2;">'+t+'</button>').join('')+
      '</div>'+
      '<div class="pw-map-opts" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px;font-family:IBM Plex Mono,monospace;font-size:9px;color:#7a93a8;pointer-events:auto;">'+
        '<label>Map <select class="pw-map-style" style="font-size:9px;background:rgba(255,255,255,0.05);border:1px solid rgba(127,208,255,0.25);border-radius:4px;color:#cfe3f2;padding:1px 4px">'+
          '<option value="filled">Colour fill</option>'+
          '<option value="filled-contours">Fill + contours</option>'+
          '<option value="contour">Contours only</option>'+
        '</select></label>'+
        '<label>Lines <select class="pw-ctr-style" style="font-size:9px;background:rgba(255,255,255,0.05);border:1px solid rgba(127,208,255,0.25);border-radius:4px;color:#cfe3f2;padding:1px 4px">'+
          '<option value="synoptic">Synoptic amber</option>'+
          '<option value="dark">Dark</option>'+
          '<option value="white">White</option>'+
          '<option value="cyan">Cyan</option>'+
        '</select></label>'+
        '<label style="display:flex;align-items:center;gap:4px">Interval <input type="range" class="pw-ctr-sl" style="width:72px;accent-color:#7fd0ff">'+
        '<input type="number" class="pw-ctr-step" placeholder="auto" step="any" min="0" style="width:52px;font-size:9px;background:rgba(255,255,255,0.05);border:1px solid rgba(127,208,255,0.25);border-radius:4px;color:#cfe3f2;padding:1px 3px">'+
        '<span class="pw-ctr-hint" style="font-size:8px;color:#5d7488"></span></label>'+
        '<label>Borders <select class="pw-border" style="font-size:9px;background:rgba(255,255,255,0.05);border:1px solid rgba(127,208,255,0.25);border-radius:4px;color:#cfe3f2;padding:1px 4px">'+
          '<option value="1">Normal</option>'+
          '<option value="0.55">Subtle</option>'+
          '<option value="1.6">Bold</option>'+
          '<option value="0">Off</option>'+
        '</select></label>'+
        '<label style="display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" class="pw-ctr-top" style="accent-color:#7fd0ff">lines on top</label>'+
        '<label class="pw-user-geo-wrap" style="display:none;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" class="pw-user-geo" checked style="accent-color:#7fd0ff"><span class="pw-user-geo-lbl">boundaries</span></label>'+
        '<button type="button" class="pw-zoom-reset" title="Reset zoom" style="display:none;font-family:IBM Plex Mono,monospace;font-size:9px;background:none;border:1px solid rgba(127,208,255,0.35);color:#cfe3f2;cursor:pointer;padding:1px 7px;border-radius:4px;">⤢ reset zoom</button>'+
      '</div>'+
      '<div class="pw-hist-opts" style="display:none;align-items:center;gap:6px;margin-bottom:8px;font-family:IBM Plex Mono,monospace;font-size:9px;color:#7a93a8;pointer-events:auto;">'+
        '<label style="display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" class="pw-hist-excl" style="accent-color:#7fd0ff">exclude flagged outliers</label>'+
        '<span class="pw-hist-excl-hint" style="font-size:8px;color:#5d7488"></span>'+
      '</div>'+
      '<div class="pw-stats" style="font-family:IBM Plex Mono,monospace;font-size:9px;color:#7a93a8;margin-bottom:6px;overflow-wrap:break-word;width:100%;box-sizing:border-box;"></div>';
    const cv=document.createElement('canvas');
    wrap.appendChild(cv);
    document.body.appendChild(wrap);
    let curMode=0;
    wrap._mapStyle='filled';
    wrap._ctrStyle=ov.contourStyle||'synoptic';
    wrap._ctrStep=ov.contourStep??null;
    wrap._ctrAuto=ov._ctrAuto!==false;
    const mapStyleSel=wrap.querySelector('.pw-map-style');
    const ctrStyleSel=wrap.querySelector('.pw-ctr-style');
    const ctrSl=wrap.querySelector('.pw-ctr-sl');
    const ctrStepIn=wrap.querySelector('.pw-ctr-step');
    const ctrHint=wrap.querySelector('.pw-ctr-hint');
    const PLOT_CTR_MAX_LINES=32;
    const fmtPlotStep=v=>{if(v==null||!isFinite(v))return'';const a=Math.abs(v),d=a<1?3:a<10?2:a<100?1:0;return(+v.toFixed(d)).toString();};
    const plotCtrBounds=(mn,mx)=>{
      const range=(mn!=null&&mx!=null)?Math.max(mx-mn,1e-9):null;
      if(range==null) return {lo:1e-6,hi:1,def:1};
      const lo=Math.max(_niceRound(range/120),range/PLOT_CTR_MAX_LINES);
      const hi=Math.max(lo*2,_niceRound(range/5));
      const def=_niceContourStep(range,8);
      return {lo,hi,def:Math.max(lo,Math.min(hi,def))};
    };
    const syncPlotCtrUi=()=>{
      const mn=ov.cachedMin??ov.vminOvr,mx=ov.cachedMax??ov.vmaxOvr;
      const {lo,hi,def}=plotCtrBounds(mn,mx);
      if(ctrSl){ctrSl.min=String(lo);ctrSl.max=String(hi);ctrSl.step=String(_niceRound((hi-lo)/80)||lo);}
      if(wrap._ctrAuto||wrap._ctrStep==null) wrap._ctrStep=def;
      wrap._ctrStep=Math.max(lo,Math.min(hi,wrap._ctrStep||def));
      if(ctrSl&&wrap._ctrStep>0) ctrSl.value=String(wrap._ctrStep);
      if(ctrStepIn){ctrStepIn.min=String(lo);ctrStepIn.max=String(hi);}
      if(ctrStepIn) ctrStepIn.value=wrap._ctrAuto?'':fmtPlotStep(wrap._ctrStep);
      if(ctrHint && mn!=null && mx!=null && wrap._ctrStep>0){
        const n=Math.max(1,Math.round((mx-mn)/wrap._ctrStep)-1);
        ctrHint.textContent=(_contourStepHint({units:ov.activeSlice?.units,longName:ov.activeSlice?.longName,varName:ov.selVar})||'')+
          (n>PLOT_CTR_MAX_LINES?' · ⚠ many lines':(' · ≈'+n+' lines'));
      } else if(ctrHint) ctrHint.textContent=_contourStepHint({units:ov.activeSlice?.units,longName:ov.activeSlice?.longName,varName:ov.selVar})||'';
    };
    syncPlotCtrUi();
    if(ctrSl) ctrSl.addEventListener('input',()=>{
      const mn=ov.cachedMin??ov.vminOvr,mx=ov.cachedMax??ov.vmaxOvr;
      const {lo,hi}=plotCtrBounds(mn,mx);
      wrap._ctrStep=Math.max(lo,Math.min(hi,+ctrSl.value));
      wrap._ctrAuto=false;
      if(ov.renderSlice)ov.renderSlice._ctrCache=null;
      syncPlotCtrUi();refresh();
    });
    if(ctrStepIn){
      let stepT=null;
      const applyPlotStep=()=>{
        const mn=ov.cachedMin??ov.vminOvr,mx=ov.cachedMax??ov.vmaxOvr;
        const {lo,hi}=plotCtrBounds(mn,mx);
        const v=parseFloat(ctrStepIn.value);
        if(v>0&&!isNaN(v)){wrap._ctrStep=Math.max(lo,Math.min(hi,v));wrap._ctrAuto=false;}
        else{wrap._ctrAuto=true;}
        if(ov.renderSlice)ov.renderSlice._ctrCache=null;
        syncPlotCtrUi();refresh();
      };
      ctrStepIn.addEventListener('input',()=>{clearTimeout(stepT);stepT=setTimeout(applyPlotStep,400);});
      ctrStepIn.addEventListener('change',applyPlotStep);
    }
    if(mapStyleSel) mapStyleSel.value=wrap._mapStyle;
    if(ctrStyleSel) ctrStyleSel.value=wrap._ctrStyle;
    mapStyleSel?.addEventListener('change',e=>{wrap._mapStyle=e.target.value;refresh();});
    ctrStyleSel?.addEventListener('change',e=>{wrap._ctrStyle=e.target.value;refresh();});
    wrap._borderStrength=1; wrap._ctrOnTop=false; wrap._showUserGeo=true;
    const borderSel=wrap.querySelector('.pw-border');
    const ctrTopChk=wrap.querySelector('.pw-ctr-top');
    const userGeoWrap=wrap.querySelector('.pw-user-geo-wrap');
    const userGeoChk=wrap.querySelector('.pw-user-geo');
    const _syncPlotUserGeoUi=()=>{
      const ug=window._userGeoLayer;
      const has=!!(ug&&ug.geo&&ug.geo.features&&ug.geo.features.length);
      if(userGeoWrap) userGeoWrap.style.display=has?'flex':'none';
      const lbl=wrap.querySelector('.pw-user-geo-lbl');
      if(lbl&&has) lbl.textContent=ug.name||'boundaries';
    };
    _syncPlotUserGeoUi();
    borderSel?.addEventListener('change',e=>{wrap._borderStrength=+e.target.value;refresh();});
    borderSel?.addEventListener('mousedown',e=>e.stopPropagation());
    ctrTopChk?.addEventListener('change',e=>{wrap._ctrOnTop=e.target.checked;refresh();});
    userGeoChk?.addEventListener('change',e=>{wrap._showUserGeo=e.target.checked;refresh();});
    const histExclChk=wrap.querySelector('.pw-hist-excl');
    histExclChk?.addEventListener('change',e=>{wrap._histExcludeOutliers=e.target.checked;refresh();});
    const stopBubble=e=>e.stopPropagation();
    wrap.querySelector('.pw-map-opts')?.addEventListener('mousedown',stopBubble);
    wrap.querySelector('.pw-hist-opts')?.addEventListener('mousedown',stopBubble);
    wrap.querySelector('.pw-tabs')?.addEventListener('mousedown',stopBubble);
    wrap.querySelector('.pw-map-opts')?.addEventListener('click',stopBubble);
    wrap.querySelector('.pw-hist-opts')?.addEventListener('click',stopBubble);
    wrap.querySelector('.pw-tabs')?.addEventListener('click',stopBubble);
    mapStyleSel?.addEventListener('mousedown',stopBubble);
    ctrStyleSel?.addEventListener('mousedown',stopBubble);
    mapStyleSel?.addEventListener('click',stopBubble);
    ctrStyleSel?.addEventListener('click',stopBubble);
    ctrSl?.addEventListener('mousedown',stopBubble);
    ctrStepIn?.addEventListener('mousedown',stopBubble);

    function header(){
      const fLab=ov.frames?.[ov.selTime]?.label;
      const levLab=getLevelLabel(ov);
      const parts=[ov.name||'overlay', ov.activeSlice?.longName||''];
      if(fLab) parts.push(fLab);
      if(levLab&&hasMultiLevel(ov)) parts.push('@ '+levLab);
      wrap.querySelector('.pw-title').textContent=parts.filter(Boolean).join(' · ');
      const rs=ov.renderSlice; if(!rs)return;
      let smn=1e30,smx=-1e30,ssum=0,sn=0;
      for(let i=0;i<rs.data.length;i++){const v=rs.data[i];if(!isNaN(v)){if(v<smn)smn=v;if(v>smx)smx=v;ssum+=v;sn++;}}
      wrap.querySelector('.pw-stats').textContent=sn?('min '+smn.toFixed(2)+' · mean '+(ssum/sn).toFixed(2)+' · max '+smx.toFixed(2)+(units?' '+units:'')):'no valid data';
    }
    function plotFrame(x2,L,T,pw,ph,lonMin,lonMax,latMin,latMax,onTop){
      x2.strokeStyle='rgba(120,150,175,0.45)';x2.lineWidth=1;x2.strokeRect(L,T,pw,ph);
      const xOf=lon=>L+(lon-lonMin)/(lonMax-lonMin)*pw;
      const yOf=lat=>T+(latMax-lat)/(latMax-latMin)*ph;
      if(!onTop){
        x2.fillStyle='#9fb6c9';x2.font='9px IBM Plex Mono,monospace';
        x2.textAlign='center';
        for(let lo=Math.ceil(lonMin/30)*30;lo<=lonMax;lo+=30){
          x2.strokeStyle='rgba(120,150,175,0.22)';
          x2.beginPath();x2.moveTo(xOf(lo),T);x2.lineTo(xOf(lo),T+ph);x2.stroke();
          x2.fillText((((lo+180)%360+360)%360-180).toFixed(0)+'°',xOf(lo),T+ph+12);
        }
        x2.textAlign='right';
        for(let la=Math.ceil(latMin/30)*30;la<=latMax;la+=30){
          x2.strokeStyle='rgba(120,150,175,0.22)';
          x2.beginPath();x2.moveTo(L,yOf(la));x2.lineTo(L+pw,yOf(la));x2.stroke();
          x2.fillText(la.toFixed(0)+'°',L-5,yOf(la)+3);
        }
      }
      const drawCoast=(coords,stroke,w)=>{
        if(!coords)return;
        x2.strokeStyle=stroke;x2.lineWidth=w;
        x2.beginPath();
        coords.forEach(line=>{
          let prev=null;
          line.forEach(([lo,la])=>{
            if(lo<lonMin-0.01||lo>lonMax+0.01||la<latMin||la>latMax){prev=null;return;}
            const x=xOf(lo),y=yOf(la);
            if(prev&&Math.abs(x-prev[0])<pw*0.45){x2.moveTo(prev[0],prev[1]);x2.lineTo(x,y);}
            prev=[x,y];
          });
        });
        x2.stroke();
      };
      const bs=(wrap._borderStrength==null)?1:wrap._borderStrength;
      if(bs<=0) return;   // borders off
      const ca=Math.min(1,(onTop?0.95:0.75)*bs);      // coastline alpha
      const cw=(onTop?2.0:1.1)*Math.min(1.4,bs);      // coastline width
      const coastCol=onTop?'rgba(225,242,255,'+ca+')':'rgba(35,48,62,'+ca+')';
      if(_plotLand) drawCoast(_plotLand,coastCol,cw);
      else _getPlotLand(coords=>{drawCoast(coords,coastCol,cw);if(onTop&&curMode===0)refresh();});
      if(onTop){
        const na=Math.min(1,0.9*bs), nw=1.4*Math.min(1.4,bs);
        const nCol='rgba(190,220,245,'+na+')';
        if(_plotCountries) drawCoast(_plotCountries,nCol,nw);
        else _getPlotCountries(coords=>{drawCoast(coords,nCol,nw);if(curMode===0)refresh();});
      }
    }
    function _drawPlotUserGeo(x2,L,T,pw,ph,lonMin,lonMax,latMin,latMax){
      const ug=window._userGeoLayer;
      if(!ug||!ug.geo||!ug.geo.features) return;
      const spanLon=Math.max(1e-6,lonMax-lonMin), spanLat=Math.max(1e-6,latMax-latMin);
      const xOf=lon=>L+(lon-lonMin)/spanLon*pw, yOf=lat=>T+(latMax-lat)/spanLat*ph;
      const inBox=(lon,lat)=>lon>=lonMin&&lon<=lonMax&&lat>=latMin&&lat<=latMax;
      const drawRing=ring=>{
        let started=false;
        for(const [lon,lat] of ring){
          if(!inBox(lon,lat)){ started=false; continue; }
          const x=xOf(lon), y=yOf(lat);
          if(!started){ x2.beginPath(); x2.moveTo(x,y); started=true; }
          else x2.lineTo(x,y);
        }
        if(started) x2.stroke();
      };
      x2.save();
      x2.strokeStyle='rgba(255,210,127,0.55)'; x2.lineWidth=0.8;
      for(const f of ug.geo.features){
        const g=f.geometry; if(!g) continue;
        if(g.type==='Polygon') g.coordinates.forEach(drawRing);
        else if(g.type==='MultiPolygon') g.coordinates.forEach(poly=>poly.forEach(drawRing));
      }
      if(spanLon<55){
        const labels=ug.labels||ug.geo.features.map(f=>{
          const p=f.properties||{};
          const n=p.name||p.NAME||p.Name||p.admin; if(!n) return null;
          try{const c=d3.geoCentroid(f);return [n,c[0],c[1]];}catch(e){return null;}
        }).filter(Boolean);
        const maxLabels=Math.max(4,Math.min(40,Math.round(1200/spanLon)));
        x2.font='8px IBM Plex Mono,monospace'; x2.textBaseline='middle';
        const placed=[]; let shown=0;
        for(const [name,lon,lat] of labels){
          if(!inBox(lon,lat)) continue;
          const x=xOf(lon), y=yOf(lat);
          if(shown>=maxLabels) break;
          const tw=x2.measureText(name).width;
          const boxL=x+4, boxT=y-5, boxW=tw+2, boxH=10;
          if(placed.some(r=>!(boxL+boxW<r.x0||boxL>r.x1||boxT+boxH<r.y0||boxT>r.y1))) continue;
          x2.lineWidth=2; x2.strokeStyle='rgba(4,11,19,0.85)'; x2.strokeText(name,boxL,y);
          x2.fillStyle='rgba(255,220,160,0.92)'; x2.fillText(name,boxL,y);
          placed.push({x0:boxL-1,y0:boxT,x1:boxL+boxW,y1:boxT+boxH}); shown++;
        }
      }
      x2.restore();
    }
    function _lonPerm(lons){
      // permutation that re-orders columns into a normalised −180..180 frame
      // (puts Greenwich/Africa at the centre regardless of file convention)
      const norm=new Float64Array(lons.length);
      for(let j=0;j<lons.length;j++){let L2=((lons[j]%360)+360)%360;if(L2>180)L2-=360;norm[j]=L2;}
      const perm=Array.from(norm.keys()).sort((a,b)=>norm[a]-norm[b]);
      return {perm,norm:perm.map(j=>norm[j])};
    }
    function drawMap(){
      const rs=ov.renderSlice; if(!rs)return;
      const mn=ov.vminOvr??ov.cachedMin??0, mx=ov.vmaxOvr??ov.cachedMax??1, range=(mx-mn)||1;
      const cmap=CMAPS[ov.selCmap]||CMAPS.viridis;
      // Curvilinear grids (RTOFS/HYCOM, etc.) carry one lat/lon per data cell —
      // rs.lats/rs.lons are the SAME length as rs.data, not separable nLat/nLon
      // axes. The row/col fill logic below assumes a rectilinear grid and
      // produces garbage (or a blank plot) if used directly, so scatter-plot
      // each cell at its own lon/lat instead.
      const isCurv=rs.lats.length===rs.data.length&&rs.lons.length===rs.data.length;
      let latDesc,perm,norm,fullLonMin,fullLonMax,fullLatMin,fullLatMax;
      if(isCurv){
        latDesc=false;
        fullLonMin=Infinity;fullLonMax=-Infinity;fullLatMin=Infinity;fullLatMax=-Infinity;
        for(let k=0;k<rs.lats.length;k++){
          const la=rs.lats[k],lo=normalizeLon(rs.lons[k]);
          if(!Number.isFinite(la)||!Number.isFinite(lo)) continue;
          if(la<fullLatMin)fullLatMin=la; if(la>fullLatMax)fullLatMax=la;
          if(lo<fullLonMin)fullLonMin=lo; if(lo>fullLonMax)fullLonMax=lo;
        }
        if(!Number.isFinite(fullLonMin)){fullLonMin=-180;fullLonMax=180;fullLatMin=-90;fullLatMax=90;}
      } else {
        latDesc=rs.lats[0]>rs.lats[rs.nLat-1];
        ({perm,norm}=_lonPerm(rs.lons));
        fullLonMin=norm[0];fullLonMax=norm[norm.length-1];
        fullLatMin=Math.min(rs.lats[0],rs.lats[rs.nLat-1]);fullLatMax=Math.max(rs.lats[0],rs.lats[rs.nLat-1]);
      }
      // Active drag-to-zoom window (clamped to the data extent); null = full view.
      let z=wrap._zoom;
      if(z){
        z={
          lonMin:Math.max(fullLonMin,Math.min(z.lonMin,z.lonMax)),
          lonMax:Math.min(fullLonMax,Math.max(z.lonMin,z.lonMax)),
          latMin:Math.max(fullLatMin,Math.min(z.latMin,z.latMax)),
          latMax:Math.min(fullLatMax,Math.max(z.latMin,z.latMax))
        };
        if(!(z.lonMax>z.lonMin&&z.latMax>z.latMin)) z=null;
      }
      const lonMin=z?z.lonMin:fullLonMin, lonMax=z?z.lonMax:fullLonMax;
      const latMin=z?z.latMin:fullLatMin, latMax=z?z.latMax:fullLatMax;
      const resetBtn=wrap.querySelector('.pw-zoom-reset');
      if(resetBtn) resetBtn.style.display=z?'inline-block':'none';
      const mapStyle=wrap._mapStyle||'filled-contours';
      const showFill=mapStyle!=='contour';
      // Contour tracing (_contourRings) assumes a rectilinear grid; skip it for
      // curvilinear data rather than tracing garbage isolines.
      const showCtr=!isCurv&&(mapStyle==='contour'||mapStyle==='filled-contours'||(ov.showContours&&mapStyle==='filled'));
      const L=46,Rr=16,T=10,CB=52;
      let pw,ph;
      if(wrap._userW&&wrap._userH){pw=Math.max(200,wrap._userW-L-Rr);ph=Math.max(100,wrap._userH-T-18-CB);}
      else{pw=Math.min(620,Math.max(420,rs.nLon));ph=Math.round(pw*(latMax-latMin)/Math.max(1e-6,(lonMax-lonMin)));}
      cv.width=L+pw+Rr;cv.height=T+ph+18+CB;
      cv.style.cssText='width:'+cv.width+'px;height:'+cv.height+'px;display:block;';
      const x2=cv.getContext('2d');
      x2.fillStyle=mapStyle==='contour'?'#1a2838':'rgba(4,11,19,0.95)';
      x2.fillRect(0,0,cv.width,cv.height);
      if(showFill){
        const off=document.createElement('canvas');off.width=rs.nLon;off.height=rs.nLat;
        const ictx=off.getContext('2d');
        if(isCurv){
          // Scatter each cell onto the offscreen raster at its own lon/lat,
          // mapped into the [fullLonMin,fullLonMax]x[fullLatMin,fullLatMax]
          // bounding box — the rest of the pipeline (zoom crop, colorbar,
          // brightness filter) then treats this like any rectilinear fill.
          ictx.fillStyle='rgba(158,164,170,1)';ictx.fillRect(0,0,rs.nLon,rs.nLat);
          const spanLo=Math.max(1e-6,fullLonMax-fullLonMin), spanLa=Math.max(1e-6,fullLatMax-fullLatMin);
          const block=Math.max(1,Math.ceil(Math.min(rs.nLon,rs.nLat)/250));
          for(let k=0;k<rs.data.length;k++){
            const v=rs.data[k],la=rs.lats[k],lo=normalizeLon(rs.lons[k]);
            if(isNaN(v)||!Number.isFinite(la)||!Number.isFinite(lo)) continue;
            const px=Math.round((lo-fullLonMin)/spanLo*(rs.nLon-1));
            const py=Math.round((fullLatMax-la)/spanLa*(rs.nLat-1));
            if(px<0||px>=rs.nLon||py<0||py>=rs.nLat) continue;
            const t=Math.max(0,Math.min(1,(v-mn)/range)),ci=Math.round(t*255)*3;
            ictx.fillStyle='rgb('+cmap[ci]+','+cmap[ci+1]+','+cmap[ci+2]+')';
            ictx.fillRect(Math.max(0,px-block),Math.max(0,py-block),block*2+1,block*2+1);
          }
        } else {
        const im=ictx.createImageData(rs.nLon,rs.nLat);
        for(let i=0;i<rs.nLat;i++){
          const srcRow=latDesc?i:(rs.nLat-1-i);
          for(let j=0;j<rs.nLon;j++){
            const v=rs.data[srcRow*rs.nLon+perm[j]], pi=(i*rs.nLon+j)*4;
            if(isNaN(v)){im.data[pi]=158;im.data[pi+1]=164;im.data[pi+2]=170;im.data[pi+3]=255;continue;}
            const t=Math.max(0,Math.min(1,(v-mn)/range)),ci=Math.round(t*255)*3;
            im.data[pi]=cmap[ci];im.data[pi+1]=cmap[ci+1];im.data[pi+2]=cmap[ci+2];im.data[pi+3]=255;
          }
        }
        ictx.putImageData(im,0,0);
        }
        x2.save();
        x2.globalAlpha=mapStyle==='filled-contours'?0.38:0.82;
        x2.imageSmoothingEnabled=true;
        // Mirror the overlay's brightness/contrast/saturation onto the 2D fill
        // so the plot window matches what's shown on the globe.
        const fx=[];
        if(ov.selBright!=null&&ov.selBright!==1) fx.push('brightness('+ov.selBright+')');
        if(ov.selContrast!=null&&ov.selContrast!==1) fx.push('contrast('+ov.selContrast+')');
        if(ov.selSaturate!=null&&ov.selSaturate!==1) fx.push('saturate('+ov.selSaturate+')');
        if(fx.length) x2.filter=fx.join(' ');
        // Crop the offscreen fill to the active zoom window (identity crop when unzoomed).
        const spanLon=Math.max(1e-6,fullLonMax-fullLonMin), spanLat=Math.max(1e-6,fullLatMax-fullLatMin);
        const sx=(lonMin-fullLonMin)/spanLon*rs.nLon, sw=Math.max(1,(lonMax-lonMin)/spanLon*rs.nLon);
        const sy=(fullLatMax-latMax)/spanLat*rs.nLat, sh=Math.max(1,(latMax-latMin)/spanLat*rs.nLat);
        x2.drawImage(off,sx,sy,sw,sh,L,T,pw,ph);
        if(fx.length) x2.filter='none';
        x2.restore();
      }
      const meta={units:ov.activeSlice?.units,longName:ov.activeSlice?.longName,varName:ov.selVar,customStep:wrap._ctrStep};
      const drawCtr=()=>_drawPlotContours(x2,rs,mn,mx,L,T,pw,ph,lonMin,lonMax,latMin,latMax,ov.contourCount||12,wrap._ctrStyle||'synoptic',meta,!!wrap._plotLite);
      plotFrame(x2,L,T,pw,ph,lonMin,lonMax,latMin,latMax,false);
      // Default: contours UNDER the bright borders (borders read clearly).
      // "lines on top" draws them above so isolines dominate.
      if(showCtr&&!wrap._ctrOnTop) drawCtr();
      plotFrame(x2,L,T,pw,ph,lonMin,lonMax,latMin,latMax,true);
      if(showCtr&&wrap._ctrOnTop) drawCtr();
      if(showFill) _drawColorbar(x2,cmap,L+pw*0.1,T+ph+24,pw*0.8,9,mn,mx,units);
      if(wrap._showUserGeo) _drawPlotUserGeo(x2,L,T,pw,ph,lonMin,lonMax,latMin,latMax);
      if(z){
        x2.save();x2.fillStyle='rgba(127,208,255,0.9)';x2.font='9px IBM Plex Mono,monospace';x2.textAlign='left';
        x2.fillText('🔍 zoomed — drag to re-zoom, double-click to reset',L+4,T+11);
        x2.restore();
      }
      // Geometry snapshot used by the hover readout and drag-to-zoom handlers below.
      wrap._plotGeom={L,T,pw,ph,lonMin,lonMax,latMin,latMax};
    }
    function drawLinePlot(mode){
      const rs=ov.renderSlice; if(!rs)return;
      // Honor an expanded/resized window (see drawMap) — previously
      // hardcoded, so clicking ⤢ resized the wrap div but this canvas
      // stayed pinned at 560×320, making "expand" look broken on every
      // tab except Map.
      const W2=wrap._userW||560,H2=wrap._userH||320,L=58,B=34,T=12,Rr=14;
      cv.width=W2;cv.height=H2;cv.style.cssText='width:'+W2+'px;height:'+H2+'px;display:block;';
      const x2=cv.getContext('2d');
      x2.fillStyle='rgba(4,11,19,0.9)';x2.fillRect(0,0,W2,H2);
      const n=mode==='zonal'?rs.nLat:rs.nLon;
      drawLinePlot._perm=(mode==='merid')?_lonPerm(rs.lons):null;
      const xs=new Float64Array(n), ys=new Float64Array(n);
      let vmin=1e30,vmax=-1e30;
      for(let k=0;k<n;k++){
        let s=0,c=0;
        if(mode==='zonal'){
          for(let j=0;j<rs.nLon;j++){const v=rs.data[k*rs.nLon+j];if(!isNaN(v)){s+=v;c++;}}
          xs[k]=rs.lats[k];
        } else {
          const srcK=drawLinePlot._perm?drawLinePlot._perm.perm[k]:k;
          for(let i=0;i<rs.nLat;i++){
            const v=rs.data[i*rs.nLon+srcK];
            if(!isNaN(v)){const w=Math.cos(rs.lats[i]*Math.PI/180);s+=v*w;c+=w;}
          }
          xs[k]=drawLinePlot._perm?drawLinePlot._perm.norm[k]:rs.lons[k];
        }
        ys[k]=c?s/c:NaN;
        if(c){if(ys[k]<vmin)vmin=ys[k];if(ys[k]>vmax)vmax=ys[k];}
      }
      const vr=(vmax-vmin)||1;
      const xmin=Math.min(xs[0],xs[n-1]), xmax=Math.max(xs[0],xs[n-1]);
      const px=x=>L+(x-xmin)/(xmax-xmin)*(W2-L-Rr);
      const py=v=>H2-B-(v-vmin)/vr*(H2-T-B);
      x2.strokeStyle='rgba(127,170,205,0.45)';x2.lineWidth=1;
      x2.strokeRect(L,T,W2-L-Rr,H2-T-B);
      x2.fillStyle='#7a93a8';x2.font='9px IBM Plex Mono,monospace';x2.textAlign='center';
      for(let t2=0;t2<=7;t2++){const xv=xmin+(xmax-xmin)*t2/7;
        x2.fillText(xv.toFixed(0)+'°',px(xv),H2-B+14);
        x2.strokeStyle='rgba(127,170,205,0.12)';x2.beginPath();x2.moveTo(px(xv),T);x2.lineTo(px(xv),H2-B);x2.stroke();}
      x2.textAlign='right';
      for(let t2=0;t2<=4;t2++){const vv=vmin+vr*t2/4;
        x2.fillText(vv.toPrecision(4),L-6,py(vv)+3);
        x2.strokeStyle='rgba(127,170,205,0.12)';x2.beginPath();x2.moveTo(L,py(vv));x2.lineTo(W2-Rr,py(vv));x2.stroke();}
      x2.textAlign='center';
      x2.fillText(mode==='zonal'?'latitude':'longitude',(L+W2-Rr)/2,H2-6);
      x2.save();x2.translate(11,(T+H2-B)/2);x2.rotate(-Math.PI/2);
      x2.fillText('mean'+(units?' ('+units+')':''),0,0);x2.restore();
      x2.strokeStyle='#7fd0ff';x2.lineWidth=1.6;x2.beginPath();
      let started=false;
      for(let k=0;k<n;k++){
        if(isNaN(ys[k])){started=false;continue;}
        if(!started){x2.moveTo(px(xs[k]),py(ys[k]));started=true;}
        else x2.lineTo(px(xs[k]),py(ys[k]));
      }
      x2.stroke();
    }
    async function drawHov(axis){
      const rs0=ov.renderSlice; if(!rs0)return;
      const nF=ov.frames.length;
      if(nF<2){wrap.querySelector('.pw-stats').textContent='Hovmöller needs multiple time frames.';return;}
      const key=(ov.selVar||'')+'|'+nF+'|'+(ov.selLevIdx??0)+'|'+axis;
      if(!ov._hov||ov._hov.key!==key){
        const probe=_cacheGet(ov,0);
        if(!probe)return;
        const rs0a=probe.renderSlice;
        const lonP=axis==='lon'?_lonPerm(rs0a.lons):null;
        const nAx=axis==='lat'?rs0a.nLat:rs0a.nLon;
        const coords=axis==='lat'?rs0a.lats:lonP.norm;
        const bytes=rs0a.data.length*4;
        ov._cacheMax=Math.max(ov._cacheMax||0,Math.min(nF,Math.max(8,Math.floor(300e6/bytes))));
        const H=new Float32Array(nF*nAx), labels=[];
        for(let t=0;t<nF;t++){
          const fr=_cacheGet(ov,t);
          if(fr){
            const rs=fr.renderSlice;
            if(axis==='lat'){
              for(let i=0;i<rs.nLat;i++){      // zonal mean: unweighted along a latitude circle
                let s=0,c=0;
                for(let j=0;j<rs.nLon;j++){const v=rs.data[i*rs.nLon+j];if(!isNaN(v)){s+=v;c++;}}
                H[t*nAx+i]=c?s/c:NaN;
              }
            } else {
              for(let k=0;k<rs.nLon;k++){      // meridional mean: cos(lat)-weighted
                const srcK=lonP.perm[k];
                let s=0,c=0;
                for(let i=0;i<rs.nLat;i++){
                  const v=rs.data[i*rs.nLon+srcK];
                  if(!isNaN(v)){const w=Math.cos(rs.lats[i]*Math.PI/180);s+=v*w;c+=w;}
                }
                H[t*nAx+k]=c?s/c:NaN;
              }
            }
          } else for(let i=0;i<nAx;i++)H[t*nAx+i]=NaN;
          labels.push(ov.frames[t].label||('t'+t));
          wrap.querySelector('.pw-stats').textContent='Computing Hovmöller ('+(axis==='lat'?'time–latitude':'time–longitude')+')… '+Math.round((t+1)/nF*100)+'%';
          if(t%2)await new Promise(r=>setTimeout(r,0));
        }
        ov._hov={key,H,nLat:nAx,lats:coords,labels,axis};
      }
      const {H,nLat,lats,labels}=ov._hov;
      let mn=1e30,mx=-1e30;
      for(let i=0;i<H.length;i++){const v=H[i];if(!isNaN(v)){if(v<mn)mn=v;if(v>mx)mx=v;}}
      const range=(mx-mn)||1;
      const cmap=CMAPS[ov.selCmap]||CMAPS.viridis;
      const L=52,Rr=16,T=10,B2=46,CB=50;
      // Honor an expanded/resized window — see drawLinePlot for why.
      const pw=wrap._userW?Math.max(200,wrap._userW-L-Rr):560;
      const ph=wrap._userH?Math.max(120,wrap._userH-T-B2-CB):300;
      cv.width=L+pw+Rr;cv.height=T+ph+B2+CB;
      cv.style.cssText='width:'+cv.width+'px;height:'+cv.height+'px;display:block;';
      const x2=cv.getContext('2d');
      x2.fillStyle='rgba(4,11,19,0.95)';x2.fillRect(0,0,cv.width,cv.height);
      const latDesc=lats[0]>lats[nLat-1];
      const off=document.createElement('canvas');off.width=nF;off.height=nLat;
      const ictx=off.getContext('2d');const im=ictx.createImageData(nF,nLat);
      for(let i=0;i<nLat;i++){
        const li=latDesc?i:(nLat-1-i); // north at top
        for(let t=0;t<nF;t++){
          const v=H[t*nLat+li], pi=(i*nF+t)*4;
          if(isNaN(v)){im.data[pi]=158;im.data[pi+1]=164;im.data[pi+2]=170;im.data[pi+3]=255;continue;}
          const tt=Math.max(0,Math.min(1,(v-mn)/range)),ci=Math.round(tt*255)*3;
          im.data[pi]=cmap[ci];im.data[pi+1]=cmap[ci+1];im.data[pi+2]=cmap[ci+2];im.data[pi+3]=255;
        }
      }
      ictx.putImageData(im,0,0);
      x2.imageSmoothingEnabled=true;
      x2.drawImage(off,L,T,pw,ph);
      x2.strokeStyle='rgba(120,150,175,0.5)';x2.strokeRect(L,T,pw,ph);
      // axes: y = latitude
      x2.fillStyle='#9fb6c9';x2.font='9px IBM Plex Mono,monospace';x2.textAlign='right';
      const latMin=Math.min(lats[0],lats[nLat-1]),latMax=Math.max(lats[0],lats[nLat-1]);
      for(let la=Math.ceil(latMin/30)*30;la<=latMax;la+=30){
        const y=T+(latMax-la)/(latMax-latMin)*ph;
        x2.fillText(la.toFixed(0)+'°',L-5,y+3);
        x2.strokeStyle='rgba(120,150,175,0.2)';x2.beginPath();x2.moveTo(L,y);x2.lineTo(L+pw,y);x2.stroke();
      }
      // x = time (sparse rotated labels)
      const nticks=Math.min(6,nF);x2.textAlign='right';
      for(let t2=0;t2<nticks;t2++){
        const k=Math.round(t2*(nF-1)/Math.max(1,nticks-1));
        const x=L+(nF<2?0:k/(nF-1))*pw;
        x2.save();x2.translate(x,T+ph+8);x2.rotate(-Math.PI/4);
        x2.fillText(String(labels[k]).slice(0,12),0,8);x2.restore();
        x2.strokeStyle='rgba(120,150,175,0.2)';x2.beginPath();x2.moveTo(x,T);x2.lineTo(x,T+ph);x2.stroke();
      }
      x2.textAlign='center';
      x2.save();x2.translate(12,T+ph/2);x2.rotate(-Math.PI/2);
      x2.fillText((ov._hov.axis==='lat'?'latitude — zonal mean':'longitude — meridional mean')+(units?' ('+units+')':''),0,0);x2.restore();
      _drawColorbar(x2,cmap,L+pw*0.1,T+ph+B2,pw*0.8,9,mn,mx,units);
      header();
      wrap.querySelector('.pw-stats').textContent=
        (ov._hov.axis==='lat'?'Hovmöller · time–latitude (zonal mean)':'Hovmöller · time–longitude (meridional mean, cos-weighted)')+
        ' · min '+mn.toFixed(2)+' · max '+mx.toFixed(2)+(units?' '+units:'');
    }
    // Histogram of the CURRENT slice: distribution + robust stats. For
    // research use: spot skew/bimodality, sanity-check units & outliers.
    // Computes every histogram/stat quantity from a flat array of finite
    // values. Pulled out of drawHistogram so it can be run TWICE when the
    // "exclude flagged outliers" toggle is on: once on the full data (to
    // detect the spike at all) and again on the filtered remainder (to
    // render/report the clean view) — same math either way.
    function _histCompute(vals,n0){
      const n=vals.length;
      let mn=vals[0],mx=vals[0],s=0,s2=0;
      for(let i=0;i<n;i++){const v=vals[i];s+=v;s2+=v*v;if(v<mn)mn=v;if(v>mx)mx=v;}
      const mean=s/n, std=Math.sqrt(Math.max(0,s2/n-mean*mean));
      const q=p=>vals[Math.min(n-1,Math.floor(p*(n-1)))];
      const med=q(0.5),p05=q(0.05),p95=q(0.95),p01=q(0.01),p99=q(0.99);
      let sk=0; if(std>0){for(let i=0;i<n;i++){const z=(vals[i]-mean)/std;sk+=z*z*z;} sk/=n;}
      const clip=(p99>p01);
      const bmn=clip?p01:mn, bmx=clip?p99:mx;
      const BINS=56,counts=new Float64Array(BINS);
      for(let i=0;i<n;i++){
        const cv=Math.min(bmx,Math.max(bmn,vals[i]));
        let b=Math.floor((cv-bmn)/(bmx-bmn)*BINS);if(b>=BINS)b=BINS-1;if(b<0)b=0;counts[b]++;
      }
      let cmax=0;for(let b=0;b<BINS;b++)if(counts[b]>cmax)cmax=counts[b];
      // Spike detection: a real dataset can have MORE than one dominant
      // bin — e.g. sea-surface temperature piles up at both a land/ocean
      // mask sentinel AND the physical seawater freezing floor (~-1.8°C),
      // two unrelated causes producing two separate spikes. Checking only
      // the single tallest bin against the second-tallest missed the
      // smaller one. This instead ranks ALL bins by count and walks down
      // from the top, flagging any bin that's both far above the
      // distribution's own typical (median nonzero) bin AND holds a
      // non-trivial share of the data — stopping the first time a bin
      // fails either test, since bins are visited tallest-first so
      // nothing further down would pass either. The 3% share floor (down
      // from an earlier 15%-of-total, single-bin-only version) is what
      // catches smaller genuine secondary spikes without flagging
      // ordinary histogram noise.
      const nonZero=Array.from(counts).filter(c=>c>0).sort((a,b)=>a-b);
      const baseline=nonZero.length?nonZero[Math.floor(nonZero.length*0.5)]:0;
      const order=counts.map((c,i)=>i).sort((a,b)=>counts[b]-counts[a]);
      const spikeBins=[];
      for(const b of order){
        const c=counts[b];
        if(c>0&&c>Math.max(baseline*4,1)&&c>n*0.03) spikeBins.push(b);
        else break;
      }
      const logScale=spikeBins.length>0;
      let spikes=[],totalSpikeShare=0,zeroCount=0;
      if(logScale){
        spikes=spikeBins.map(b=>{
          const lo=bmn+b/BINS*(bmx-bmn), hi=bmn+(b+1)/BINS*(bmx-bmn);
          return {lo,hi,share:counts[b]/n*100};
        }).sort((a,b)=>a.lo-b.lo);
        totalSpikeShare=spikes.reduce((s2,sp)=>s2+sp.share,0);
        for(let i=0;i<n;i++)if(Math.abs(vals[i])<1e-6)zeroCount++;
      }
      return {n,n0:n0??n,mn,mx,mean,std,med,p05,p95,p01,p99,sk,clip,bmn,bmx,BINS,counts,cmax,logScale,spikes,totalSpikeShare,zeroCount};
    }
    function drawHistogram(){
      const rs=ov.renderSlice; if(!rs) return;
      // Honor an expanded/resized window — see drawLinePlot. Previously
      // this read cv.width/height without ever setting them, so the
      // canvas silently kept whatever size the last tab happened to
      // leave it at instead of tracking the window.
      const W2=wrap._userW||560,H2=wrap._userH||330;
      cv.width=W2;cv.height=H2;cv.style.cssText='width:'+W2+'px;height:'+H2+'px;display:block;';
      // wrap's own width is pinned to the canvas centrally in refresh()
      // (covers every tab, not just this one) — see the comment there.
      const x2=cv.getContext('2d');
      x2.fillStyle='rgba(7,14,22,0.98)';x2.fillRect(0,0,W2,H2);
      const N=rs.data.length, stride=Math.max(1,Math.floor(N/240000));
      const vals=[];
      for(let k=0;k<N;k+=stride){const v=rs.data[k];if(!isNaN(v))vals.push(v);}
      if(vals.length<4){x2.fillStyle='#7a93a8';x2.fillText('No finite data.',20,30);return;}
      vals.sort((a,b)=>a-b);
      // First pass: detect a spike in the FULL data — this is what the
      // toggle's enabled state and "N flagged" hint are based on,
      // regardless of whether exclusion is currently on.
      const full=_histCompute(vals);
      // Default to excluding flagged spikes — undefined means "no explicit
      // user choice yet", which defaults to on whenever something IS
      // flagged. Once the user actually clicks the checkbox it becomes a
      // real true/false and that choice sticks (including "I want to see
      // the spike, leave it in") across frame/tab changes in this popup.
      const excludeActive=(wrap._histExcludeOutliers===undefined)?full.logScale:(wrap._histExcludeOutliers&&full.logScale);
      const histExclChk=wrap.querySelector('.pw-hist-excl');
      const hintEl=wrap.querySelector('.pw-hist-excl-hint');
      if(histExclChk){
        histExclChk.disabled=!full.logScale;
        histExclChk.checked=excludeActive;
      }
      let excluded=0, r=full;
      if(excludeActive){
        // Drop everything landing in ANY flagged spike's bin range, then
        // redo the SAME computation on what's left — same math, smaller
        // input. This never touches ov.renderSlice/activeSlice, only this
        // plot's own view: flip the toggle off and the untouched full
        // data is right back, so nothing is lost by excluding.
        const filtered=vals.filter(v=>!full.spikes.some(sp=>v>=sp.lo&&v<=sp.hi));
        excluded=vals.length-filtered.length;
        if(filtered.length>=4) r=_histCompute(filtered,vals.length);
      }
      if(hintEl) hintEl.textContent=full.logScale?(excludeActive?'('+excluded+' cells excluded)':'('+full.totalSpikeShare.toFixed(0)+'% flagged)'):'(no outliers flagged)';
      const {n,mn,mx,mean,std,med,p05,p95,clip,bmn,bmx,BINS,counts,cmax,logScale}=r;
      // Bin over [p01,p99] rather than the true [min,max] — see the note
      // this used to carry: a heavy tail (e.g. soil moisture legitimately
      // running up near a ~760mm model cap) shouldn't crush the bulk of
      // the distribution into 1-2 bins. Bar heights are additionally
      // log-scaled only when a genuine dominant spike is present (not
      // just clipped range) — see _histCompute's threshold.
      const hOf=c=>cmax>0?((logScale?Math.log(1+c)/Math.log(1+cmax):c/cmax)*ph):0;
      const L=54,Rm=16,T=26,Bm=40,pw=W2-L-Rm,ph=H2-T-Bm;
      x2.strokeStyle='rgba(127,208,255,0.3)';x2.strokeRect(L,T,pw,ph);
      if(logScale){x2.fillStyle='#6c8299';x2.font='9px IBM Plex Mono,monospace';x2.fillText('count (log scale — '+(r.spikes.length>1?r.spikes.length+' bins dominate':'one bin dominates')+')',L+3,T+11);}
      for(let b=0;b<BINS;b++){
        const h=hOf(counts[b]);
        x2.fillStyle='rgba(127,208,255,0.65)';
        x2.fillRect(L+b/BINS*pw+1,T+ph-h,pw/BINS-2,h);
      }
      // mean & median markers (clamped onto the visible axis when clipped)
      const px=v=>L+(Math.min(bmx,Math.max(bmn,v))-bmn)/(bmx-bmn)*pw;
      x2.strokeStyle='#ffb35c';x2.beginPath();x2.moveTo(px(mean),T);x2.lineTo(px(mean),T+ph);x2.stroke();
      x2.strokeStyle='#8dffb0';x2.setLineDash([4,3]);x2.beginPath();x2.moveTo(px(med),T);x2.lineTo(px(med),T+ph);x2.stroke();x2.setLineDash([]);
      x2.fillStyle='#9fb6c9';x2.font='9.5px IBM Plex Mono,monospace';
      x2.fillText((clip&&bmn>mn?'≤':'')+bmn.toPrecision(4),L,H2-24);
      const mxs=(clip&&bmx<mx?'≥':'')+bmx.toPrecision(4);x2.fillText(mxs,L+pw-x2.measureText(mxs).width,H2-24);
      x2.fillStyle='#ffb35c';x2.fillText('mean',px(mean)+3,T+10);
      x2.fillStyle='#8dffb0';x2.fillText('median',Math.min(px(med)+3,W2-52),T+22);
      // When one or more dominant bins triggered log-scaling (on whichever
      // data is ACTIVE — full or, with the toggle on, the filtered
      // remainder), say what value(s) they're at and how much of the data
      // they hold. A spike at (or very near) exactly zero is the single
      // most common cause: land or ocean cells that should be NaN but are
      // stored as a literal 0 instead (no _FillValue/missing_value
      // declared, or it wasn't matched) — called out specifically since
      // it's actionable. Other spikes (e.g. seawater's physical freezing
      // floor around -1.8°C piling up across polar cells) are named but
      // not blamed on masking, since they're often real. This doesn't
      // touch the data, just names the pattern so it's not left as an
      // unexplained bar.
      let spikeNote='';
      if(logScale){
        const zeroIsSpike=r.zeroCount>n*0.1&&r.spikes.some(sp=>sp.lo<=0&&sp.hi>=-1e-6);
        const parts=[];
        if(zeroIsSpike) parts.push((r.zeroCount/n*100).toFixed(0)+'% of cells are exactly 0 — likely unmasked land/ocean cells (check the file’s _FillValue/missing_value attribute)');
        const otherSpikes=r.spikes.filter(sp=>!(zeroIsSpike&&sp.lo<=0&&sp.hi>=-1e-6));
        if(otherSpikes.length===1){
          const sp=otherSpikes[0];
          parts.push('one bin (~'+sp.lo.toPrecision(4)+' to '+sp.hi.toPrecision(4)+') holds '+sp.share.toFixed(0)+'% of the data — worth checking whether that’s a real mode (e.g. a physical floor/ceiling) or an unmasked fill value');
        } else if(otherSpikes.length>1){
          parts.push(otherSpikes.length+' separate bins ('+otherSpikes.map(sp=>'~'+sp.lo.toPrecision(3)+'–'+sp.hi.toPrecision(3)+': '+sp.share.toFixed(0)+'%').join(', ')+') each dominate their neighbours — worth checking whether these are real modes or unmasked fill values');
        }
        spikeNote=' · '+parts.join(' · ');
      }
      const exclNote=(excludeActive&&excluded>0)?' · '+excluded+' flagged cells excluded from this view ('+full.totalSpikeShare.toFixed(0)+'% of the full '+full.n+') — untoggle to include them':'';
      const st=wrap.querySelector('.pw-stats');
      if(st) st.textContent='n='+n+(stride>1?' (sampled 1/'+stride+')':'')+' · mean '+mean.toPrecision(5)+' · median '+med.toPrecision(5)+' · σ '+std.toPrecision(4)+' · skew '+r.sk.toFixed(2)+' · p05 '+p05.toPrecision(4)+' · p95 '+p95.toPrecision(4)+' · range ['+mn.toPrecision(4)+', '+mx.toPrecision(4)+']'+(clip&&(bmn>mn||bmx<mx)?' · histogram clipped to p01–p99 ['+bmn.toPrecision(4)+', '+bmx.toPrecision(4)+']':'')+spikeNote+exclNote;
    }
    function refresh(){
      header();
      const opts=wrap.querySelector('.pw-map-opts');
      if(opts) opts.style.display=curMode===0?'flex':'none';
      const histOpts=wrap.querySelector('.pw-hist-opts');
      if(histOpts) histOpts.style.display=curMode===5?'flex':'none';
      if(curMode===0)drawMap();
      else if(curMode===3)drawHov('lat');
      else if(curMode===4)drawHov('lon');
      else if(curMode===5)drawHistogram();
      else drawLinePlot(curMode===1?'zonal':'merid');
      // Pin the popup's own width to whatever the canvas actually ended
      // up (every tab, not just Histogram) — a long stats line (e.g. a
      // trend layer's verbose units string: "K per DAY (real dates,
      // daily)…") otherwise wins the shrink-to-fit width computation and
      // balloons the whole popup out to ~96vw instead of staying
      // canvas-width. Read AFTER the draw call above, once cv.width is
      // whatever THIS tab's draw function decided (they don't all agree
      // on margins), so this works the same regardless of which tab is
      // active.
      wrap.style.width=(cv.width+26)+'px';
      wrap._plotLite=false;
    }
    let _plotRAF=null;
    function scheduleRefresh(lite){
      if(lite) wrap._plotLite=true;
      if(_plotRAF) return;
      _plotRAF=requestAnimationFrame(()=>{_plotRAF=null; refresh();});
    }
    refresh();
    const reg={ov,refresh:()=>{ if(curMode===3||curMode===4) header(); else refresh(); }};
    _plotWins.push(reg);
    wrap.querySelectorAll('.pw-tabs button').forEach(b=>b.addEventListener('click',function(){
      wrap.querySelectorAll('.pw-tabs button').forEach(x=>{x.style.borderColor='rgba(127,208,255,0.25)';x.style.background='none';});
      this.style.borderColor='rgba(127,208,255,0.7)';this.style.background='rgba(127,208,255,0.18)';
      curMode=+this.dataset.pt; cv.style.cursor=curMode===0?'crosshair':'default'; refresh();
    }));
    cv.style.cursor='crosshair';
    wrap.querySelector('.pw-x').addEventListener('click',()=>{
      const i=_plotWins.indexOf(reg); if(i>=0)_plotWins.splice(i,1);
      if(wrap._releaseDoc)wrap._releaseDoc(); // unhook document-level drag/resize listeners
      wrap.remove();
    });
    const grip=document.createElement('div');grip.className='pw-resize-grip';grip.style.cssText='position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:se-resize;background:linear-gradient(135deg,transparent 50%,rgba(127,208,255,0.35) 50%);border-radius:0 0 10px 0;';wrap.appendChild(grip);
    wrap.querySelector('.pw-png').addEventListener('click',()=>{const a=document.createElement('a');a.href=cv.toDataURL('image/png');a.download=(ov.name||'plot')+'_'+(['map','zonal','merid','hovlat','hovlon'][curMode]||'plot')+'.png';a.click();});
    function _canvasPos(e){
      const r2=cv.getBoundingClientRect();
      return {x:(e.clientX-r2.left)*(cv.width/r2.width), y:(e.clientY-r2.top)*(cv.height/r2.height)};
    }
    function _pxToLonLat(px,py){
      const g=wrap._plotGeom; if(!g) return null;
      return {lon:g.lonMin+(px-g.L)/g.pw*(g.lonMax-g.lonMin), lat:g.latMax-(py-g.T)/g.ph*(g.latMax-g.latMin)};
    }
    let zoomDrag=null;
    cv.addEventListener('mousemove',e=>{
      if(zoomDrag){
        const g=wrap._plotGeom; if(!g)return;
        const p=_canvasPos(e);
        zoomDrag.x1=Math.max(g.L,Math.min(g.L+g.pw,p.x));
        zoomDrag.y1=Math.max(g.T,Math.min(g.T+g.ph,p.y));
        drawMap();
        const rx=Math.min(zoomDrag.x0,zoomDrag.x1),ry=Math.min(zoomDrag.y0,zoomDrag.y1);
        const rw=Math.abs(zoomDrag.x1-zoomDrag.x0),rh=Math.abs(zoomDrag.y1-zoomDrag.y0);
        const x2=cv.getContext('2d');
        x2.save();x2.strokeStyle='rgba(127,208,255,0.9)';x2.lineWidth=1.2;x2.setLineDash([4,3]);
        x2.strokeRect(rx,ry,rw,rh);
        x2.fillStyle='rgba(127,208,255,0.14)';x2.fillRect(rx,ry,rw,rh);
        x2.restore();
        return;
      }
      if(curMode!==0||!ov.renderSlice||!wrap._plotGeom)return;
      const p=_canvasPos(e),g=wrap._plotGeom;
      if(p.x<g.L||p.x>g.L+g.pw||p.y<g.T||p.y>g.T+g.ph)return;
      const {lon,lat}=_pxToLonLat(p.x,p.y);
      const rs=ov.renderSlice;
      const val=sampleAt(lon,lat,rs,rs.lats,rs.lons),units=(ov.activeSlice&&ov.activeSlice.units)||'';
      wrap.querySelector('.pw-stats').textContent='lon '+lon.toFixed(2)+'° lat '+lat.toFixed(2)+'° → '+(isNaN(val)?'—':val.toFixed(4)+(units?' '+units:''));
    });cv.addEventListener('mouseleave',()=>{if(curMode===0)header();});
    cv.addEventListener('mousedown',e=>{
      if(curMode!==0||!ov.renderSlice||!wrap._plotGeom)return;
      const g=wrap._plotGeom,p=_canvasPos(e);
      if(p.x<g.L||p.x>g.L+g.pw||p.y<g.T||p.y>g.T+g.ph)return;
      zoomDrag={x0:p.x,y0:p.y,x1:p.x,y1:p.y};
      e.preventDefault();e.stopPropagation();
    });
    window.addEventListener('mouseup',e=>{
      if(!zoomDrag||!wrap.isConnected)return;
      const dx=Math.abs(zoomDrag.x1-zoomDrag.x0),dy=Math.abs(zoomDrag.y1-zoomDrag.y0);
      if(dx>6&&dy>6){
        const a=_pxToLonLat(zoomDrag.x0,zoomDrag.y0),b=_pxToLonLat(zoomDrag.x1,zoomDrag.y1);
        if(a&&b) wrap._zoom={lonMin:Math.min(a.lon,b.lon),lonMax:Math.max(a.lon,b.lon),latMin:Math.min(a.lat,b.lat),latMax:Math.max(a.lat,b.lat)};
      }
      zoomDrag=null;
      refresh();
    });
    cv.addEventListener('dblclick',e=>{
      if(curMode!==0||!wrap._zoom)return;
      wrap._zoom=null;refresh();
    });
    wrap.querySelector('.pw-zoom-reset')?.addEventListener('click',()=>{wrap._zoom=null;refresh();});
    wrap.querySelector('.pw-zoom-reset')?.addEventListener('mousedown',stopBubble);
    let mx0=0,my0=0,ox0=0,oy0=0,drag=false,resizing=false,rw0=0,rh0=0;
    grip.addEventListener('mousedown',e=>{
      resizing=true;mx0=e.clientX;my0=e.clientY;
      rw0=wrap._userW||(cv.width||620);rh0=wrap._userH||(cv.height||300);
      e.preventDefault();e.stopPropagation();
    });
    const dragHead=wrap.querySelector('.pw-head');
    dragHead?.addEventListener('mousedown',e=>{
      if(e.target.closest('button'))return;
      drag=true;mx0=e.clientX;my0=e.clientY;ox0=wrap.offsetLeft;oy0=wrap.offsetTop;e.preventDefault();
    });
    // NAMED document-level handlers, removed in the close handler (which
    // calls wrap._releaseDoc — see the .pw-x wiring). Anonymous versions
    // leaked: every popup ever opened kept BOTH listeners registered for
    // the life of the page, each closure pinning the popup's DOM and its
    // canvas buffers in memory, and each still executing its drag/resize
    // checks on every document mousemove — including every globe drag —
    // long after the popup was gone.
    const _docMove=e=>{
      if(drag){
        // Clamp so the header (and its close button) can never be
        // dragged fully off-screen — previously unbounded, so dragging
        // the window above the viewport top (e.g. behind the title bar)
        // pushed the close button to a negative Y coordinate with no way
        // to click it, forcing a page reload to recover.
        const nx=ox0+e.clientX-mx0, ny=oy0+e.clientY-my0;
        wrap.style.left=Math.max(-(wrap.offsetWidth-60),Math.min(window.innerWidth-60,nx))+'px';
        wrap.style.top=Math.max(4,Math.min(window.innerHeight-40,ny))+'px';
      }
      if(resizing){
        wrap._userW=Math.max(300,rw0+(e.clientX-mx0));
        wrap._userH=Math.max(200,rh0+(e.clientY-my0));
        scheduleRefresh(true);
      }
    };
    const _docUp=()=>{
      if(resizing){resizing=false;wrap._plotLite=false;refresh();}
      drag=false;
    };
    document.addEventListener('mousemove',_docMove);
    document.addEventListener('mouseup',_docUp);
    wrap._releaseDoc=()=>{
      document.removeEventListener('mousemove',_docMove);
      document.removeEventListener('mouseup',_docUp);
    };
    if(window.GlobePlotExpand) window.GlobePlotExpand.attach(wrap,cv,scheduleRefresh,{normalW:cv.width||620,normalH:cv.height||300});
  }

  function exportPNG(){
    // Composite in the SAME z-order as the live page: SVG globe at the bottom,
    // overlay canvases on top (they sit at z-index 11+ above the SVG).
    const svgEl=document.getElementById('globe');
    const dpr=window.devicePixelRatio||1;
    const W=Math.round(innerWidth*dpr),H=Math.round(innerHeight*dpr);
    const out=document.createElement('canvas');out.width=W;out.height=H;
    const octx=out.getContext('2d');
    octx.fillStyle='#04090f';octx.fillRect(0,0,W,H);
    // Clone the SVG and inline every CSS custom property (--warm, --cold, …)
    // onto its root — serialized SVG otherwise loses the document's :root vars
    // and all var()-driven colors render black/transparent.
    const clone=svgEl.cloneNode(true);
    const cs=getComputedStyle(document.documentElement);
    let vars='';
    for(let i=0;i<cs.length;i++){const p=cs[i];if(p.startsWith('--'))vars+=p+':'+cs.getPropertyValue(p)+';';}
    clone.setAttribute('style',(clone.getAttribute('style')||'')+';'+vars);
    clone.setAttribute('width',W);clone.setAttribute('height',H);
    clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
    const xml=new XMLSerializer().serializeToString(clone);
    const img=new Image();
    img.onload=()=>{
      octx.drawImage(img,0,0,W,H);                                  // globe first
      overlays.forEach(ov=>{ if(ov.enabled) octx.drawImage(ov.canvas,0,0,W,H); }); // data on top
      octx.fillStyle='rgba(190,210,225,0.55)';
      octx.font=(10.5*dpr)+'px "IBM Plex Mono", monospace';
      octx.textAlign='right';
      octx.fillText('Preneshen Naicker',W-12*dpr,H-10*dpr);
      const a=document.createElement('a');
      a.href=out.toDataURL('image/png');
      a.download='globe_'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.png';
      a.click();
    };
    img.onerror=()=>alert('PNG export failed (SVG serialisation).');
    img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(xml);
  }

  /* ===== Region time-series: pick two corners on the globe → cos(lat)-weighted
     mean over the box for EVERY frame, plotted against time ===== */
  let _regionPick=null;
  const _regionHint=document.createElement('div');
  _regionHint.style.cssText='position:fixed;display:none;z-index:350;left:50%;top:18px;transform:translateX(-50%);'+
    'background:rgba(6,17,28,0.95);border:1px solid rgba(255,210,127,0.55);border-radius:8px;'+
    'padding:8px 16px;font-family:IBM Plex Mono,monospace;font-size:11px;color:#ffd27f;';
  document.body.appendChild(_regionHint);
  function _hintRegion(msg){ if(msg){_regionHint.textContent=msg;_regionHint.style.display='block';} else _regionHint.style.display='none'; }
  // Standard index regions researchers extract (NOAA/CPC & JAMSTEC definitions).
  // wrap=true → box crosses the antimeridian; lon0 is the WESTERN edge.
  const REGION_PRESETS=[
    {group:'ENSO',name:'Niño 1+2',lon0:-90,lon1:-80,lat0:-10,lat1:0},
    {group:'ENSO',name:'Niño 3',lon0:-150,lon1:-90,lat0:-5,lat1:5},
    {group:'ENSO',name:'Niño 3.4',lon0:-170,lon1:-120,lat0:-5,lat1:5},
    {group:'ENSO',name:'Niño 4',lon0:160,lon1:-150,lat0:-5,lat1:5,wrap:true},
    {group:'ENSO',name:'W. Pacific Warm Pool',lon0:120,lon1:160,lat0:-10,lat1:10},
    {group:'Indian Ocean',name:'IOD West',lon0:50,lon1:70,lat0:-10,lat1:10},
    {group:'Indian Ocean',name:'IOD East',lon0:90,lon1:110,lat0:-10,lat1:0},
    {group:'Indian Ocean',name:'IOD dipole (West−East)',diff:[{lon0:50,lon1:70,lat0:-10,lat1:10},{lon0:90,lon1:110,lat0:-10,lat1:0}]},
    {group:'Atlantic',name:'ATL3 — Atlantic Niño',lon0:-20,lon1:0,lat0:-3,lat1:3},
    {group:'Atlantic',name:'TNA — Trop. N Atlantic',lon0:-55,lon1:-15,lat0:5,lat1:25},
    {group:'Atlantic',name:'TSA — Trop. S Atlantic',lon0:-30,lon1:10,lat0:-20,lat1:0},
    {group:'Atlantic',name:'N Atlantic subpolar',lon0:-60,lon1:-10,lat0:45,lat1:65},
    // Indices below reuse the exact same box-mean / box-diff machinery as
    // everything above — they're just well-known named combinations of it.
    // ONI and AMO are plain box means (same math as a Niño box); NAO and
    // SOI are literally the station-pressure-difference definition, just
    // with each "station" widened to a small box so it lands on real grid
    // cells; AO and SAM use the standard simplified zonal-mean-SLP proxy
    // (Arctic/Antarctic band minus the surrounding mid-latitude band) in
    // place of the official EOF-based index, which this app has no way to
    // compute. QBO is a plain equatorial zonal-wind band mean — it only
    // makes sense against a loaded U-wind file with the right pressure
    // level already selected (30/50 hPa), which isn't something a preset
    // can enforce. None of these replace the official published index
    // (NOAA/CPC apply detrending, fixed base periods, or full EOF
    // decomposition); they're the same-shaped raw proxy computed from
    // whatever's currently loaded, which is what correlation/composite
    // analysis actually needs.
    {group:'Climate Indices',name:'ONI (≈ Niño 3.4 box)',lon0:-170,lon1:-120,lat0:-5,lat1:5},
    {group:'Climate Indices',name:'AMO — N Atlantic SST (0–60°N)',lon0:-80,lon1:0,lat0:0,lat1:60},
    {group:'Climate Indices',name:'NAO (Azores − Iceland, proxy)',diff:[{lon0:-27.7,lon1:-23.7,lat0:35.7,lat1:39.7},{lon0:-24.7,lon1:-20.7,lat0:63.1,lat1:67.1}]},
    {group:'Climate Indices',name:'SOI (Tahiti − Darwin, proxy)',diff:[{lon0:-151.6,lon1:-147.6,lat0:-19.65,lat1:-15.65},{lon0:128.9,lon1:132.9,lat0:-14.4,lat1:-10.4}]},
    {group:'Climate Indices',name:'AO (zonal SLP proxy)',diff:[{lon0:-180,lon1:180,lat0:35,lat1:45},{lon0:-180,lon1:180,lat0:60,lat1:70}]},
    {group:'Climate Indices',name:'SAM (zonal SLP proxy)',diff:[{lon0:-180,lon1:180,lat0:-50,lat1:-40},{lon0:-180,lon1:180,lat0:-70,lat1:-60}]},
    {group:'Climate Indices',name:'QBO (equatorial U-wind, needs right level loaded)',lon0:-180,lon1:180,lat0:-5,lat1:5},
    {group:'Polar/Global',name:'Arctic',lon0:-180,lon1:180,lat0:66,lat1:90},
    {group:'Polar/Global',name:'Antarctic',lon0:-180,lon1:180,lat0:-90,lat1:-66},
    {group:'Polar/Global',name:'Southern Ocean',lon0:-180,lon1:180,lat0:-65,lat1:-45},
    {group:'Polar/Global',name:'Tropics (30°S–30°N)',lon0:-180,lon1:180,lat0:-30,lat1:30},
    {group:'Polar/Global',name:'N Hemisphere',lon0:-180,lon1:180,lat0:0,lat1:90},
    {group:'Polar/Global',name:'S Hemisphere',lon0:-180,lon1:180,lat0:-90,lat1:0},
    {group:'Polar/Global',name:'Global mean',lon0:-180,lon1:180,lat0:-90,lat1:90},
    {group:'Ocean Basins',name:'Pacific',lon0:120,lon1:-70,lat0:-60,lat1:65,wrap:true},
    {group:'Ocean Basins',name:'Atlantic',lon0:-100,lon1:20,lat0:-60,lat1:70},
    {group:'Ocean Basins',name:'Indian Ocean',lon0:20,lon1:120,lat0:-60,lat1:30},
    // `country:` names the exact Natural-Earth polygon (from the same 110m atlas
    // used for the globe's country borders) so extraction follows the actual
    // coastline/border instead of a lon/lat box — see _findCountryFeature().
    // Presets WITHOUT `country` are genuinely box-shaped regions (contiguous US
    // excludes AK/HI, "Sahara" and "Amazon basin" span many countries, etc.) so
    // they intentionally keep the rectangle behaviour.
    {group:'Countries',name:'South Africa',country:'South Africa',lon0:16,lon1:33,lat0:-35,lat1:-22},
    {group:'Countries',name:'USA (contiguous)',lon0:-125,lon1:-66,lat0:24,lat1:50},
    {group:'Countries',name:'Brazil',country:'Brazil',lon0:-74,lon1:-34,lat0:-34,lat1:6},
    {group:'Countries',name:'India',country:'India',lon0:68,lon1:98,lat0:6,lat1:38},
    {group:'Countries',name:'China',country:'China',lon0:73,lon1:135,lat0:18,lat1:54},
    {group:'Countries',name:'Australia',country:'Australia',lon0:113,lon1:154,lat0:-44,lat1:-10},
    {group:'Countries',name:'Europe',lon0:-25,lon1:45,lat0:35,lat1:72},
    {group:'Countries',name:'Russia',country:'Russia',lon0:27,lon1:180,lat0:41,lat1:82},
    {group:'Countries',name:'Canada',country:'Canada',lon0:-141,lon1:-52,lat0:42,lat1:84},
    {group:'Countries',name:'N Africa / Sahara',lon0:-18,lon1:37,lat0:15,lat1:38},
    {group:'Countries',name:'Amazon basin',lon0:-80,lon1:-44,lat0:-18,lat1:6},
    {group:'Countries',name:'Indonesia',country:'Indonesia',lon0:95,lon1:141,lat0:-11,lat1:6},
    {group:'Countries',name:'Japan',country:'Japan',lon0:129,lon1:146,lat0:30,lat1:46},
    {group:'Countries',name:'Nigeria',country:'Nigeria',lon0:2,lon1:15,lat0:4,lat1:14},
    {group:'Countries',name:'Kenya',country:'Kenya',lon0:34,lon1:42,lat0:-5,lat1:5},
    {group:'Countries',name:'Argentina',country:'Argentina',lon0:-74,lon1:-52,lat0:-56,lat1:-22},
    {group:'Countries',name:'UK / British Isles',country:'United Kingdom',lon0:-11,lon1:3,lat0:49,lat1:61},
  ];
  // Common aliases → exact Natural-Earth 110m country "name" property, so the
  // free-text country search matches everyday names too.
  const _COUNTRY_ALIASES={
    'usa':'united states of america','us':'united states of america','united states':'united states of america',
    'uk':'united kingdom','great britain':'united kingdom','britain':'united kingdom',
    'south korea':'south korea','republic of korea':'south korea','n korea':'north korea',
    'ivory coast':'ivory coast',"cote d'ivoire":'ivory coast',
    'drc':'dem. rep. congo','congo-kinshasa':'dem. rep. congo','democratic republic of the congo':'dem. rep. congo',
    'congo-brazzaville':'congo','republic of the congo':'congo',
    'czechia':'czech rep.','czech republic':'czech rep.',
    'uae':'united arab emirates',
    'russia':'russia','russian federation':'russia',
    'myanmar':'myanmar','burma':'myanmar',
    'vietnam':'vietnam','viet nam':'vietnam',
    'laos':'laos',
    'syria':'syria','tanzania':'tanzania','bolivia':'bolivia','venezuela':'venezuela',
    'north macedonia':'macedonia','macedonia':'macedonia'
  };
  function _countryFeatures(){ return (window.GlobeAPI&&window.GlobeAPI.world&&window.GlobeAPI.world.countries&&window.GlobeAPI.world.countries.features)||[]; }
  function _findCountryFeature(name){
    const feats=_countryFeatures(); if(!feats.length) return null;
    const raw=(name||'').trim().toLowerCase(); if(!raw) return null;
    const key=_COUNTRY_ALIASES[raw]||raw;
    let f=feats.find(ft=>((ft.properties&&ft.properties.name)||'').toLowerCase()===key);
    if(!f) f=feats.find(ft=>((ft.properties&&ft.properties.name)||'').toLowerCase()===raw);
    if(!f) f=feats.find(ft=>((ft.properties&&ft.properties.name)||'').toLowerCase().includes(key));
    return f||null;
  }
  function _findUserGeoFeature(name){
    const feats=(window._userGeoLayer&&window._userGeoLayer.geo&&window._userGeoLayer.geo.features)||[];
    if(!feats.length) return null;
    const raw=(name||'').trim().toLowerCase(); if(!raw) return null;
    const _names=(props)=>{
      if(!props) return [];
      return [props.name,props.NAME,props.Name,props.name_en,props.namealt,props.name_local,
        props.admin,props.ADM1,props.region,props.gn_name,props.woe_name,props.abbrev,props.postal,
        props.iso_3166_2,props.code_hasc,props.gn_a1_code]
        .filter(Boolean).map(s=>String(s).toLowerCase());
    };
    let f=feats.find(ft=>_names(ft.properties).some(n=>n===raw));
    if(!f) f=feats.find(ft=>_names(ft.properties).some(n=>n.includes(raw)||raw.includes(n)));
    return f||null;
  }
  // A REGION_PRESETS entry picked from a dropdown LIST only carries a
  // `country:` name string, not the resolved polygon — unlike the free-text
  // "Country / region…" search path, which always looks the name up and
  // attaches `clipFeature` before use. Left alone, the same "Brazil" preset
  // meant two different regions depending on which UI path picked it: the
  // list gave you its raw bounding rectangle (ocean margin on both coasts
  // included), the search gave you the actual border-clipped polygon.
  // Every run-time consumer of a preset (composite/EOF/regression) should
  // route through here so list selection and search always agree.
  function _resolvePresetBox(p){
    if(!p||!p.country||p.clipFeature) return p;
    const feat=_findCountryFeature(p.country);
    return feat?{...p,clipFeature:feat}:p;
  }
  // Brief on-globe visual confirmation of whatever region a dropdown just
  // selected — presets otherwise gave zero feedback until you clicked
  // Compute/Run, unlike the box-pick and country-search flows which already
  // flash via _showRegionBox/_showRegionPolygon.
  function _flashPresetRegion(p){
    if(!p) return;
    const rp=_resolvePresetBox(p);
    if(rp.diff) _showRegionBox(rp.diff[0].lon0,rp.diff[0].lon1,rp.diff[0].lat0,rp.diff[0].lat1,false);
    else if(rp.clipFeature) _showRegionPolygon(rp.clipFeature);
    else _showRegionBox(rp.lon0,rp.lon1,rp.lat0,rp.lat1,!!(rp.wrap||rp.lon0>rp.lon1));
    setTimeout(_hideRegionBox,2500);
  }
  function regionMenu(ov,anchor){
    document.querySelectorAll('.nc-csv-menu').forEach(m=>m.remove());
    if(!ov.frames||!ov.frames.length){alert('Load data first.');return;}
    const r=anchor.getBoundingClientRect();
    const m=document.createElement('div');
    m.className='nc-csv-menu';
    // Open upward when there's more room above the anchor than below —
    // for an overlay card near the bottom of the (scrollable) layers
    // panel, r.bottom sits close to the viewport edge, and the old
    // unconditional "open below" positioning pushed most of the menu
    // past the bottom of the screen. max-height alone didn't fix it:
    // that caps the BOX's own height so it scrolls internally, but the
    // box was still anchored low enough that most of it — anything past
    // whatever sliver remained above the viewport edge — was never
    // reachable at all, scrollbar or not.
    const spaceBelow=window.innerHeight-r.bottom-8, spaceAbove=r.top-8;
    const openUp=spaceBelow<220&&spaceAbove>spaceBelow;
    const maxH=Math.max(120,Math.min(400,openUp?spaceAbove:spaceBelow));
    const topCss=openUp?'bottom:'+(window.innerHeight-r.top+4)+'px;':'top:'+(r.bottom+4)+'px;';
    m.style.cssText='position:fixed;z-index:400;left:'+Math.max(8,Math.min(window.innerWidth-208,r.left-200))+'px;'+topCss+
      'background:rgba(6,17,28,0.97);border:1px solid rgba(127,208,255,0.4);border-radius:8px;'+
      'padding:5px;font-family:IBM Plex Mono,monospace;font-size:10px;color:#cfe3f2;max-height:'+maxH+'px;overflow:auto;';
    let html='<div data-act="pick" style="padding:6px 10px;cursor:pointer;border-radius:5px;color:#ffd27f;">◰ Pick corners…</div>'+
      '<div data-act="coords" style="padding:6px 10px;cursor:pointer;border-radius:5px;color:#ffd27f;">⌨ Enter coordinates…</div>'+
      '<div data-act="country" style="padding:6px 10px;cursor:pointer;border-radius:5px;color:#ffd27f;">🌍 Country / region…</div>';
    let lastGrp='';
    REGION_PRESETS.forEach((p,i)=>{
      if(p.group&&p.group!==lastGrp){html+='<div style="padding:4px 10px;color:#5d7488;font-size:8.5px;letter-spacing:0.12em;margin-top:4px;border-top:1px solid rgba(127,208,255,0.1);">'+p.group.toUpperCase()+'</div>';lastGrp=p.group;}
      html+='<div data-act="'+i+'" style="padding:4px 10px 4px 18px;cursor:pointer;border-radius:5px;">'+p.name+'</div>';
    });
    m.innerHTML=html;
    m.querySelectorAll('[data-act]').forEach(d=>{
      d.addEventListener('mouseenter',()=>d.style.background='rgba(127,208,255,0.12)');
      d.addEventListener('mouseleave',()=>d.style.background='');
      d.addEventListener('click',()=>{
        m.remove();
        if(d.dataset.act==='pick'){startRegionPick(ov);return;}
        if(d.dataset.act==='country'){
          const cn=(prompt('Country or region name:\n(e.g. Brazil, India, Arctic)\nCountries use their bounding box on the data grid.')||'').trim();
          if(!cn)return;
          // Try an exact country polygon first (border-accurate, any of the
          // ~180 countries in the atlas — the SAME atlas the preset list
          // above resolves `country:` entries against, so list and search
          // always agree) before falling back to a custom-loaded boundary
          // layer, then the curated rectangular index/region presets.
          const feat=_findCountryFeature(cn);
          if(feat){ _countryTimeseries(ov,feat,feat.properties.name); return; }
          const userFeat=_findUserGeoFeature(cn);
          if(userFeat){
            const p=userFeat.properties||{};
            const lbl=(p.name||p.NAME||p.Name||cn)+(p.admin?' ('+p.admin+')':'');
            _countryTimeseries(ov,userFeat,lbl); return;
          }
          const m=REGION_PRESETS.find(p=>p.name.toLowerCase().includes(cn.toLowerCase()));
          if(m){if(m.diff){_showRegionBox(m.diff[0].lon0,m.diff[0].lon1,m.diff[0].lat0,m.diff[0].lat1,false);_diffTimeseries(ov,m);}else{const wr=!!(m.wrap||m.lon0>m.lon1);_showRegionBox(m.lon0,m.lon1,m.lat0,m.lat1,wr);_regionTimeseries(ov,[m.lon0,m.lat0],[m.lon1,m.lat1],{wrap:wr,name:m.name});}}
          else alert('"'+cn+'" not found. Try any country name (e.g. Peru, Vietnam, Germany), or: '+REGION_PRESETS.filter(p=>p.group==='Countries').map(p=>p.name).join(', '));
          return;
        }
        if(d.dataset.act==='coords'){
          const inp=prompt('Region as lon0,lat0,lon1,lat1 (°E, °N; west-negative OR 0–360).\nIf lon0 > lon1 the box wraps the antimeridian.\nExample Niño 3.4:  -170,-5,-120,5');
          if(!inp)return;
          const v2=inp.split(',').map(Number);
          if(v2.length!==4||v2.some(isNaN)){alert('Need four numbers: lon0,lat0,lon1,lat1');return;}
          const [LO0,LA0,LO1,LA1]=v2;
          const wrap2=LO0>LO1;
          _showRegionBox(LO0,LO1,Math.min(LA0,LA1),Math.max(LA0,LA1),wrap2);
          _regionTimeseries(ov,[LO0,LA0],[LO1,LA1],{wrap:wrap2,name:inp+'  (custom)'});
          return;
        }
        const p=REGION_PRESETS[+d.dataset.act];
        if(p.diff){
          _showRegionBox(p.diff[0].lon0,p.diff[0].lon1,p.diff[0].lat0,p.diff[0].lat1,false);
          _diffTimeseries(ov,p);
        } else if(p.country){
          const feat=_findCountryFeature(p.country);
          if(feat){ _countryTimeseries(ov,feat,p.name); }
          else { // atlas not loaded yet / name mismatch — fall back to the box
            _showRegionBox(p.lon0,p.lon1,p.lat0,p.lat1,!!(p.wrap||p.lon0>p.lon1));
            _regionTimeseries(ov,[p.lon0,p.lat0],[p.lon1,p.lat1],{wrap:p.wrap||p.lon0>p.lon1,name:p.name});
          }
        } else {
          _showRegionBox(p.lon0,p.lon1,p.lat0,p.lat1,!!(p.wrap||p.lon0>p.lon1));
          _regionTimeseries(ov,[p.lon0,p.lat0],[p.lon1,p.lat1],{wrap:p.wrap||p.lon0>p.lon1,name:p.name});
        }
      });
    });
    setTimeout(()=>document.addEventListener('click',function h(e){if(!m.contains(e.target)){m.remove();document.removeEventListener('click',h);}}),0);
    document.body.appendChild(m);
  }
  function startRegionPick(ov){
    if(!ov.frames||!ov.frames.length){alert('Load data first.');return;}
    _regionPick={ov,pts:[]};
    if(api) api._globeRegionPicking=true;
    _hintRegion('REGION TIME-SERIES — click the FIRST corner on the globe (Esc cancels)');
  }
  /* visual feedback for region selection: amber box drawn on the globe,
     re-projected on every redraw so it tracks rotation/zoom */
  let _regionBoxGeo=null, _regionBoxEl=null;
  function _boxGeo(lon0,lon1,lat0,lat1,wrap){
    // densified ring (CW for correct d3 spherical interior); wrap → lon1+360
    const L1=wrap?lon1+360:lon1;
    const ring=[];
    const step=2;
    for(let lo=lon0;lo<L1;lo+=step)ring.push([lo,lat0]);
    for(let la=lat0;la<lat1;la+=step)ring.push([L1,la]);
    for(let lo=L1;lo>lon0;lo-=step)ring.push([lo,lat1]);
    for(let la=lat1;la>lat0;la-=step)ring.push([lon0,la]);
    ring.push(ring[0]);
    // ensure CW winding (shoelace>0 = CCW → reverse)
    let a2=0;for(let i=0;i<ring.length-1;i++)a2+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];
    return {type:'Feature',geometry:{type:'Polygon',coordinates:[a2>0?ring.slice().reverse():ring]}};
  }
  function _showRegionBox(lon0,lon1,lat0,lat1,wrap){
    if(!_regionBoxEl){
      const svg=document.getElementById('globe');
      _regionBoxEl=document.createElementNS('http://www.w3.org/2000/svg','path');
      _regionBoxEl.setAttribute('fill','rgba(255,210,127,0.10)');
      _regionBoxEl.setAttribute('stroke','#ffd27f');
      _regionBoxEl.setAttribute('stroke-width','1.4');
      _regionBoxEl.setAttribute('stroke-dasharray','6 4');
      _regionBoxEl.style.pointerEvents='none';
      svg.appendChild(_regionBoxEl);
    }
    _regionBoxGeo=_boxGeo(lon0,lon1,lat0,lat1,wrap);
    _drawRegionBox();
  }
  function _showRegionPoint(ll){
    if(!_regionBoxEl){_showRegionBox(ll[0]-0.01,ll[0]+0.01,ll[1]-0.01,ll[1]+0.01,false);return;}
    _regionBoxGeo={type:'Feature',geometry:{type:'Point',coordinates:ll}};
    _drawRegionBox();
  }
  // Same visual feedback as _showRegionBox, but traces the actual country
  // polygon (border-accurate) rather than a lon/lat rectangle.
  function _showRegionPolygon(feature){
    if(!_regionBoxEl){
      const svg=document.getElementById('globe');
      _regionBoxEl=document.createElementNS('http://www.w3.org/2000/svg','path');
      _regionBoxEl.setAttribute('fill','rgba(255,210,127,0.14)');
      _regionBoxEl.setAttribute('stroke','#ffd27f');
      _regionBoxEl.setAttribute('stroke-width','1.4');
      _regionBoxEl.setAttribute('stroke-dasharray','6 4');
      _regionBoxEl.style.pointerEvents='none';
      svg.appendChild(_regionBoxEl);
    }
    _regionBoxGeo=feature;
    _drawRegionBox();
  }
  function _hideRegionBox(){_regionBoxGeo=null;if(_regionBoxEl)_regionBoxEl.setAttribute('d','');}
  function _drawRegionBox(){
    if(!_regionBoxEl)return;
    if(!_regionBoxGeo){_regionBoxEl.setAttribute('d','');return;}
    try{_regionBoxEl.setAttribute('d',api.path(_regionBoxGeo)||'');}catch(e){}
  }
  let _measurePick=null;
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&(_regionPick||_measurePick)){_regionPick=null;_measurePick=null;if(api){api._globeRegionPicking=false;api._globeMeasurePicking=false;}_hintRegion(null);_hideRegionBox();} });
  document.addEventListener('click',e=>{
    if(!_measurePick)return;
    if(e.target.closest('.ctrl,.nc-plot-win,.nc-csv-menu,#info-panel,.gf-feed-detail'))return;
    const proj=api.projection,[pcx,pcy]=proj.translate(),pR=proj.scale();
    const dx=e.clientX-pcx,dy=e.clientY-pcy; if(dx*dx+dy*dy>pR*pR)return;
    const ll=proj.invert([e.clientX,e.clientY]); if(!ll)return;
    _measurePick.push(ll);
    if(_measurePick.length===1){_hintRegion('Now click the SECOND point');return;}
    const [a,b]=_measurePick; _measurePick=null;
    if(api) api._globeMeasurePicking=false;
    const d3g=window.d3;
    const distKm=d3g.geoDistance(a,b)*6371.0088;   // mean Earth radius (km)
    // initial great-circle bearing from a to b
    const D=Math.PI/180;
    const dl=(b[0]-a[0])*D, la1=a[1]*D, la2=b[1]*D;
    const brg=(Math.atan2(Math.sin(dl)*Math.cos(la2),
      Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dl))/D+360)%360;
    const fmt=p=>(p[0]>=0?p[0].toFixed(2)+'°E':(-p[0]).toFixed(2)+'°W')+' '+(p[1]>=0?p[1].toFixed(2)+'°N':(-p[1]).toFixed(2)+'°S');
    _hintRegion('📏 '+fmt(a)+' → '+fmt(b)+' : '+
      (distKm>=1000?(distKm/1000).toFixed(3)+'×10³ km':distKm.toFixed(1)+' km')+
      ' · bearing '+brg.toFixed(1)+'°');
    setTimeout(()=>_hintRegion(null),9000);
  },true);
  document.addEventListener('click',e=>{
    if(!_regionPick)return;
    if(e.target.closest('.ctrl,.nc-plot-win,.nc-csv-menu,#info-panel,.gf-feed-detail'))return;
    const proj=api.projection,[pcx,pcy]=proj.translate(),pR=proj.scale();
    const dx=e.clientX-pcx,dy=e.clientY-pcy; if(dx*dx+dy*dy>pR*pR)return;
    const ll=proj.invert([e.clientX,e.clientY]); if(!ll)return;
    _regionPick.pts.push(ll);
    if(_regionPick.pts.length===1){
      _showRegionPoint(ll);
      _hintRegion('Now click the SECOND (opposite) corner');
    } else {
      const rp=_regionPick; _regionPick=null; if(api) api._globeRegionPicking=false; _hintRegion(null);
      const [p1,p2]=rp.pts;
      _showRegionBox(Math.min(p1[0],p2[0]),Math.max(p1[0],p2[0]),
                     Math.min(p1[1],p2[1]),Math.max(p1[1],p2[1]),false);
      _regionTimeseries(rp.ov,p1,p2);
    }
  },true);
  async function _boxSeries(ov,box,progressPrefix,clipFeature){
    // cos(lat)-weighted box mean per frame; lon test in normalised 0–360 space
    const wrap=!!box.wrap||box.lon0>box.lon1;
    const lon0=box.lon0, lon1=box.lon1, lat0=Math.min(box.lat0,box.lat1), lat1=Math.max(box.lat0,box.lat1);
    const n=ov.frames.length;
    ov._cacheMax=Math.max(ov._cacheMax||0,n);
    const labels=[],means=[];
    const a0=((lon0%360)+360)%360, a1=((lon1%360)+360)%360;
    // See _regionTimeseries for why: a box spanning the full 360° collapses
    // both normalized edges to the same value, so the plain inLon test
    // below would match almost nothing instead of everything.
    const fullGlobeLon=(lon1-lon0)>=360;
    // Optional exact-polygon clip (country/region extraction): the box
    // above is only ITS BOUNDING RECTANGLE, which for anything but a
    // perfect rectangle includes real area outside the actual shape —
    // e.g. South America's bounding box reaches from the Pacific to the
    // Atlantic and includes a wide margin of ocean on both sides. Without
    // this, an SST "South America" extract wasn't reading unmasked land
    // data (land IS correctly NaN'd elsewhere) — it was correctly
    // averaging the real ocean cells that happen to fall inside the
    // BOUNDING BOX, then mislabeling that as the country's own value.
    // d3.geoContains does the actual point-in-spherical-polygon test.
    const inPoly=clipFeature?(lon,la)=>d3.geoContains(clipFeature,[lon,la]):null;
    // Track how many cells actually contributed each frame — a country
    // extract can look like a normal number while really resting on a
    // handful of coastal pixels (see _countryTimeseries: land and ocean
    // masks come from two independently-drawn coastlines, so a country's
    // polygon boundary and an ocean product's own land-sea mask don't
    // line up exactly at the coast — a real, unavoidable mismatch, not a
    // bug). Surfacing the count lets that be judged instead of hidden.
    const counts=[];
    // Geometry (which cells fall inside the box AND the clip polygon) is
    // identical for every frame of a fixed grid — only the DATA changes.
    // Without this cache the spherical point-in-polygon test re-ran per
    // cell per FRAME: for a Brazil-sized polygon on a 0.25° grid over a
    // 166-frame series that's ~800k d3.geoContains calls (each walking
    // the full polygon ring) doing identical work 166 times over —
    // multi-second stalls for what's really a one-off mask build. Same
    // pattern _regionTimeseries already uses; keyed by grid signature so
    // a mixed-resolution series (rare, but frames CAN come from different
    // files) rebuilds only when the grid actually changes shape.
    let maskSig=null, maskIdx=null, maskW=null;
    function buildClipMask(rs,isCurv){
      const idx=[],ws=[];
      if(isCurv){
        for(let k=0;k<rs.data.length;k++){
          const la=rs.lats[k]; if(la<lat0||la>lat1)continue;
          const lo=rs.lons[k];
          const loN=((lo%360)+360)%360;
          const inLon=fullGlobeLon||(a0<=a1?(loN>=a0&&loN<=a1):(loN>=a0||loN<=a1));
          if(!inLon)continue;
          if(inPoly&&!inPoly(lo,la))continue;
          idx.push(k); ws.push(Math.cos(la*Math.PI/180));
        }
      } else {
        for(let i=0;i<rs.nLat;i++){
          const la=rs.lats[i]; if(la<lat0||la>lat1)continue;
          const cw=Math.cos(la*Math.PI/180);
          for(let j=0;j<rs.nLon;j++){
            const lo=rs.lons[j];
            const loN=((lo%360)+360)%360;
            const inLon=fullGlobeLon||(a0<=a1?(loN>=a0&&loN<=a1):(loN>=a0||loN<=a1));
            if(!inLon)continue;
            if(inPoly&&!inPoly(lo,la))continue;
            idx.push(i*rs.nLon+j); ws.push(cw);
          }
        }
      }
      return {idx,ws};
    }
    let _ly0=performance.now();
    for(let t=0;t<n;t++){
      if(n>8&&performance.now()-_ly0>16){await new Promise(r=>setTimeout(r,0));_ly0=performance.now();}
      const fr=_cacheGet(ov,t);
      if(fr){
        const rs=fr.renderSlice;
        const isCurv=rs.lats.length===rs.data.length&&rs.lons.length===rs.data.length;
        const sig=(isCurv?'curv|':'')+rs.nLat+'x'+rs.nLon;
        if(sig!==maskSig){ const m=buildClipMask(rs,isCurv); maskIdx=m.idx; maskW=m.ws; maskSig=sig; }
        let s=0,w=0,cnt=0;
        for(let mi=0;mi<maskIdx.length;mi++){
          const v=rs.data[maskIdx[mi]];
          if(isNaN(v))continue;
          const cw=maskW[mi];
          s+=v*cw;w+=cw;cnt++;
        }
        labels.push(ov.frames[t].label||('t'+t)); means.push(w?s/w:NaN); counts.push(cnt);
      } else { labels.push(ov.frames[t].label||('t'+t)); means.push(NaN); counts.push(0); }
      _hintRegion(progressPrefix+Math.round((t+1)/n*100)+'%…');
    }
    return {labels,means,counts};
  }
  async function _countryBoxSeries(ov,feature,progressPrefix){
    const b=d3.geoBounds(feature);
    return _boxSeries(ov,{
      lon0:b[0][0], lat0:b[0][1], lon1:b[1][0], lat1:b[1][1],
      wrap:b[0][0]>b[1][0]
    }, progressPrefix, feature);
  }
  async function _countryTimeseries(ov,feature,label){
    _showRegionPolygon(feature);
    _hintRegion('Computing 0%…');
    const {labels,means,counts}=await _countryBoxSeries(ov,feature,'Computing ');
    _hintRegion(null); setTimeout(_hideRegionBox,6000);
    // A land-locked or nearly-all-land country run against an ocean-only
    // variable (or vice versa) can end up averaging a handful of coastal
    // pixels where the country polygon and the data's own land-sea mask
    // disagree — technically correct, but easy to mistake for a real
    // interior value. Flag it in the window title when the sample is
    // thin rather than let it look like an ordinary result.
    const typicalCount=counts.length?counts.slice().sort((a,b)=>a-b)[Math.floor(counts.length/2)]:0;
    const thinSample=typicalCount>0&&typicalCount<30;
    const flaggedLabel=thinSample
      ? label+' ⚠ n≈'+typicalCount+' cells — likely coastal fringe only, not the interior (the data\'s own land/sea mask and this boundary don\'t align pixel-for-pixel)'
      : label;
    _openTimeseriesWin(ov,labels,means,flaggedLabel);
  }
  async function _diffTimeseries(ov,p){
    const A=await _boxSeries(ov,p.diff[0],'Computing west box ');
    const B=await _boxSeries(ov,p.diff[1],'Computing east box ');
    _hintRegion(null); setTimeout(_hideRegionBox,6000);
    const means=A.means.map((v,i)=>v-B.means[i]);
    _openTimeseriesWin(ov,A.labels,means,p.name);
  }
  async function _regionTimeseries(ov,a,b,opts){
    // opts.wrap: lon box crosses the antimeridian (lon0 east of lon1, e.g. Niño 4)
    const wrap=!!(opts&&opts.wrap);
    const lon0=wrap?a[0]:Math.min(a[0],b[0]), lon1=wrap?b[0]:Math.max(a[0],b[0]);
    const lat0=Math.min(a[1],b[1]),lat1=Math.max(a[1],b[1]);
    const n=ov.frames.length;
    ov._cacheMax=Math.max(ov._cacheMax||0,n);
    _hintRegion('Computing 0%…');
    const labels=[],means=[];
    const a0=((lon0%360)+360)%360, a1=((lon1%360)+360)%360;
    // A box spanning the full 360° (e.g. the "Global mean" preset:
    // lon0=-180, lon1=180) normalizes BOTH edges to the same value after
    // the %360 wrap (-180 and 180 are the same meridian) — a0 and a1 end
    // up equal, and the inLon test below then only matches the single
    // exact-180 column instead of every column, so "Global mean" was
    // silently masking out nearly the entire grid and reporting no data.
    // Detect the full-span case directly from the un-normalized box width
    // and skip the (broken, for this case) normalized comparison.
    const fullGlobeLon=(lon1-lon0)>=360;
    // Precompute per-slice masks ONCE and reuse across frames. The old loop
    // scanned every cell of the full grid for every frame and recomputed the
    // longitude test each time — O(frames × nLat × nLon). Grid geometry is
    // constant across frames, so we cache the in-box row list (with cos-lat
    // weights) and column list per grid signature, then each frame only
    // touches cells actually inside the box.
    let maskSig=null, rowIdx=null, rowW=null, colIdx=null, curvMask=null;
    function buildCurvMask(rs){
      const idx=[],w=[];
      for(let k=0;k<rs.data.length;k++){
        const la=rs.lats[k]; if(la<lat0||la>lat1) continue;
        const loN=((rs.lons[k]%360)+360)%360;
        const inLon=fullGlobeLon||(a0<=a1?(loN>=a0&&loN<=a1):(loN>=a0||loN<=a1));
        if(!inLon) continue;
        idx.push(k); w.push(Math.cos(la*Math.PI/180));
      }
      return {idx,w};
    }
    function buildMask(rs){
      const rows=[],rws=[],cols=[];
      for(let i=0;i<rs.nLat;i++){
        const la=rs.lats[i];
        if(la<lat0||la>lat1) continue;
        rows.push(i); rws.push(Math.cos(la*Math.PI/180));
      }
      for(let j=0;j<rs.nLon;j++){
        const loN=((rs.lons[j]%360)+360)%360;
        const inLon=fullGlobeLon||(a0<=a1?(loN>=a0&&loN<=a1):(loN>=a0||loN<=a1));
        if(inLon) cols.push(j);
      }
      return {rows,rws,cols};
    }
    let _ly1=performance.now();
    for(let t=0;t<n;t++){
      if(n>8&&performance.now()-_ly1>16){await new Promise(r=>setTimeout(r,0));_ly1=performance.now();}
      const fr=_cacheGet(ov,t);
      if(fr){
        const rs=fr.renderSlice;
        const isCurv=rs.lats.length===rs.data.length&&rs.lons.length===rs.data.length;
        const sig=(isCurv?'curv|':'')+rs.nLat+'x'+rs.nLon;
        if(sig!==maskSig){
          if(isCurv){ curvMask=buildCurvMask(rs); rowIdx=rowW=colIdx=null; }
          else { const m=buildMask(rs); rowIdx=m.rows; rowW=m.rws; colIdx=m.cols; curvMask=null; }
          maskSig=sig;
        }
        let s=0,w=0;
        if(isCurv){
          for(let mi=0;mi<curvMask.idx.length;mi++){
            const v=rs.data[curvMask.idx[mi]];
            if(!isNaN(v)){s+=v*curvMask.w[mi];w+=curvMask.w[mi];}
          }
        } else {
        for(let ri=0;ri<rowIdx.length;ri++){
          const i=rowIdx[ri], cw=rowW[ri], base=i*rs.nLon;
          for(let ci=0;ci<colIdx.length;ci++){
            const v=rs.data[base+colIdx[ci]];
            if(!isNaN(v)){s+=v*cw;w+=cw;}
          }
        }
        }
        labels.push(ov.frames[t].label||('t'+t)); means.push(w?s/w:NaN);
      }
      _hintRegion('Computing '+Math.round((t+1)/n*100)+'%…');
    }
    _hintRegion(null);
    setTimeout(_hideRegionBox,6000);  // keep the box visible briefly for context
    _openTimeseriesWin(ov,labels,means,
      (opts&&opts.name)?opts.name:
      (lon0.toFixed(1)+'–'+lon1.toFixed(1)+'°E, '+lat0.toFixed(1)+'–'+lat1.toFixed(1)+'°N'));
  }
  function _openTimeseriesWin(ov,labels,ys,boxLabel,kindLabel){
    const units=(ov.activeSlice&&ov.activeSlice.units)||'';
    const nWin=document.querySelectorAll('.nc-plot-win').length;
    const wrap=document.createElement('div');
    wrap.className='nc-plot-win';
    wrap.style.cssText='position:fixed;z-index:300;background:rgba(6,17,28,0.97);'+
      'border:1px solid rgba(127,208,255,0.4);border-radius:10px;padding:12px;'+
      'box-shadow:0 10px 40px rgba(0,0,0,0.7);max-width:96vw;'+
      'left:'+(80+nWin*30)+'px;top:'+(80+nWin*30)+'px;';
    wrap._userW=620; wrap._userH=300;
    wrap.innerHTML='<div class="pw-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;cursor:move;'+
      'font-family:IBM Plex Mono,monospace;font-size:10.5px;color:#9fb6c9;">'+
      '<span style="min-width:0;overflow-wrap:break-word;margin-right:8px;">'+(ov.name||'overlay')+' — '+(kindLabel||'region mean')+' · '+boxLabel+'</span>'+
      '<div class="pw-head-btns" style="flex-shrink:0;">'+
      '<button type="button" class="pw-csv" title="Export series CSV" style="background:none;border:1px solid rgba(127,208,255,0.35);color:#7fd0ff;cursor:pointer;font-size:11px;font-family:IBM Plex Mono,monospace;padding:1px 7px;border-radius:4px;">⬇ CSV</button>'+
      '<button type="button" class="pw-expand" style="background:none;border:1px solid rgba(127,208,255,0.35);color:#cfe3f2;cursor:pointer;font-size:11px;font-family:IBM Plex Mono,monospace;padding:1px 7px;border-radius:4px;" title="Expand / restore">⤢</button>'+
      '<button type="button" class="pw-x" style="background:none;border:none;color:#cfe3f2;cursor:pointer;font-size:14px;">✕</button></div></div>'+
      '<div class="pw-tabs" style="display:flex;gap:5px;margin-bottom:6px;pointer-events:auto;">'+
        '<button data-pt="0" style="border:1px solid rgba(127,208,255,0.7);background:rgba(127,208,255,0.18);color:#cfe3f2;cursor:pointer;font-size:9.5px;font-family:IBM Plex Mono,monospace;padding:2px 8px;border-radius:4px;">Series</button>'+
        '<button data-pt="1" style="border:1px solid rgba(127,208,255,0.25);background:none;color:#cfe3f2;cursor:pointer;font-size:9.5px;font-family:IBM Plex Mono,monospace;padding:2px 8px;border-radius:4px;">Histogram</button>'+
      '</div>';
    const cv=document.createElement('canvas');
    cv.style.cssText='display:block;';
    wrap.appendChild(cv);
    const statsEl=document.createElement('div');
    statsEl.className='pw-stats';
    statsEl.style.cssText='font-family:IBM Plex Mono,monospace;font-size:9.5px;color:#9fb6c9;margin-top:6px;min-height:12px;overflow-wrap:break-word;width:100%;box-sizing:border-box;';
    wrap.appendChild(statsEl);
    document.body.appendChild(wrap);
    const stopBubble=e=>e.stopPropagation();
    wrap.querySelector('.pw-tabs')?.addEventListener('mousedown',stopBubble);
    wrap.querySelector('.pw-tabs')?.addEventListener('click',stopBubble);
    let mx0=0,my0=0,ox0=0,oy0=0,drag=false;
    const dragHead=wrap.querySelector('.pw-head');
    dragHead?.addEventListener('mousedown',e=>{
      if(e.target.closest('button'))return;
      drag=true;mx0=e.clientX;my0=e.clientY;ox0=wrap.offsetLeft;oy0=wrap.offsetTop;e.preventDefault();e.stopPropagation();
    });
    // Named + removed on close — see quickPlot's _docMove/_docUp for why
    // (leaked listeners pinning closed popups and running on every
    // document mousemove for the rest of the session).
    const _docMove=e=>{
      if(!drag)return;
      // See the main quickPlot drag handler for why this is clamped —
      // same unclosable-off-screen-window bug applies here.
      const nx=ox0+e.clientX-mx0, ny=oy0+e.clientY-my0;
      wrap.style.left=Math.max(-(wrap.offsetWidth-60),Math.min(window.innerWidth-60,nx))+'px';
      wrap.style.top=Math.max(4,Math.min(window.innerHeight-40,ny))+'px';
    };
    const _docUp=()=>{drag=false;};
    document.addEventListener('mousemove',_docMove);
    document.addEventListener('mouseup',_docUp);
    wrap._releaseDoc=()=>{
      document.removeEventListener('mousemove',_docMove);
      document.removeEventListener('mouseup',_docUp);
    };
    wrap.querySelector('.pw-x').addEventListener('click',()=>{
      // _releaseDoc may have been extended by GlobePlotExpand.attach with
      // its own resize-listener cleanup — read it at click time, not now.
      if(wrap._releaseDoc)wrap._releaseDoc();
      wrap.remove();
    });
    const x2=cv.getContext('2d');
    let curMode=0;
    function plotDims(){
      const W2=wrap._userW||620, H2=wrap._userH||300;
      cv.width=W2; cv.height=H2;
      cv.style.width=W2+'px'; cv.style.height=H2+'px';
      return {W2,H2,L:62,B:46,T:12,Rr:14};
    }
    function drawSeries(){
      const {W2,H2,L,B,T,Rr}=plotDims();
      x2.fillStyle='rgba(4,11,19,0.9)';x2.fillRect(0,0,W2,H2);
      let vmin=1e30,vmax=-1e30;
      ys.forEach(v=>{if(!isNaN(v)){if(v<vmin)vmin=v;if(v>vmax)vmax=v;}});
      if(vmin>vmax){x2.fillStyle='#9fb6c9';x2.fillText('no valid data in region',W2/2-60,H2/2);statsEl.textContent='';return;}
      const vr=(vmax-vmin)||1;
      const n=ys.length;
      const px=k=>L+(n<2?0:k/(n-1))*(W2-L-Rr);
      const py=v=>H2-B-(v-vmin)/vr*(H2-T-B);
      x2.strokeStyle='rgba(127,170,205,0.45)';x2.strokeRect(L,T,W2-L-Rr,H2-T-B);
      x2.fillStyle='#7a93a8';x2.font='9px IBM Plex Mono,monospace';
      x2.textAlign='right';
      for(let t2=0;t2<=4;t2++){const vv=vmin+vr*t2/4;
        x2.fillText(vv.toPrecision(4),L-6,py(vv)+3);
        x2.strokeStyle='rgba(127,170,205,0.12)';x2.beginPath();x2.moveTo(L,py(vv));x2.lineTo(W2-Rr,py(vv));x2.stroke();}
      const nticks=Math.min(8,n);
      x2.textAlign='right';
      for(let t2=0;t2<nticks;t2++){
        const k=Math.round(t2*(n-1)/Math.max(1,nticks-1));
        x2.save();x2.translate(px(k),H2-B+8);x2.rotate(-Math.PI/4);
        x2.fillText(String(labels[k]).slice(0,12),0,8);x2.restore();
        x2.strokeStyle='rgba(127,170,205,0.12)';x2.beginPath();x2.moveTo(px(k),T);x2.lineTo(px(k),H2-B);x2.stroke();
      }
      x2.textAlign='center';
      x2.save();x2.translate(12,(T+H2-B)/2);x2.rotate(-Math.PI/2);
      x2.fillText('region mean'+(units?' ('+units+')':''),0,0);x2.restore();
      x2.strokeStyle='#ffd27f';x2.lineWidth=1.7;x2.beginPath();
      let started=false;
      for(let k=0;k<n;k++){
        if(isNaN(ys[k])){started=false;continue;}
        if(!started){x2.moveTo(px(k),py(ys[k]));started=true;}
        else x2.lineTo(px(k),py(ys[k]));
      }
      x2.stroke();
      x2.fillStyle='#ffd27f';
      for(let k=0;k<n;k++) if(!isNaN(ys[k])){x2.beginPath();x2.arc(px(k),py(ys[k]),2,0,7);x2.fill();}
      statsEl.textContent='n='+n+(units?' · units '+units:'');
    }
    function drawHist(){
      const {W2,H2}=plotDims();
      x2.fillStyle='rgba(7,14,22,0.98)';x2.fillRect(0,0,W2,H2);
      const vals=ys.filter(v=>!isNaN(v)).slice().sort((a,b)=>a-b);
      const n=vals.length;
      if(n<4){x2.fillStyle='#7a93a8';x2.fillText('Not enough valid points for a histogram.',20,30);statsEl.textContent='';return;}
      const mn=vals[0],mx=vals[n-1];
      if(!(mx>mn)){x2.fillStyle='#7a93a8';x2.fillText('All values identical — no spread to histogram.',20,30);statsEl.textContent='';return;}
      let s=0,s2=0; for(const v of vals){s+=v;s2+=v*v;}
      const mean=s/n, std=Math.sqrt(Math.max(0,s2/n-mean*mean));
      const q=p=>vals[Math.min(n-1,Math.floor(p*(n-1)))];
      const med=q(0.5),p05=q(0.05),p95=q(0.95);
      let sk=0; if(std>0){for(const v of vals){const z=(v-mean)/std;sk+=z*z*z;} sk/=n;}
      const BINS=Math.min(56,Math.max(6,Math.round(Math.sqrt(n)*2)));
      const counts=new Float64Array(BINS);
      for(const v of vals){let b=Math.floor((v-mn)/(mx-mn)*BINS);if(b>=BINS)b=BINS-1;counts[b]++;}
      let cmax=0;for(let b=0;b<BINS;b++)if(counts[b]>cmax)cmax=counts[b];
      const L2=54,Rm=16,T2=26,Bm=40,pw=W2-L2-Rm,ph=H2-T2-Bm;
      x2.strokeStyle='rgba(127,208,255,0.3)';x2.strokeRect(L2,T2,pw,ph);
      for(let b=0;b<BINS;b++){
        const h=counts[b]/cmax*ph;
        x2.fillStyle='rgba(127,208,255,0.65)';
        x2.fillRect(L2+b/BINS*pw+1,T2+ph-h,pw/BINS-2,h);
      }
      const px=v=>L2+(v-mn)/(mx-mn)*pw;
      x2.strokeStyle='#ffb35c';x2.beginPath();x2.moveTo(px(mean),T2);x2.lineTo(px(mean),T2+ph);x2.stroke();
      x2.strokeStyle='#8dffb0';x2.setLineDash([4,3]);x2.beginPath();x2.moveTo(px(med),T2);x2.lineTo(px(med),T2+ph);x2.stroke();x2.setLineDash([]);
      x2.fillStyle='#9fb6c9';x2.font='9.5px IBM Plex Mono,monospace';
      x2.fillText(mn.toPrecision(4),L2,H2-24);
      const mxs=mx.toPrecision(4);x2.fillText(mxs,L2+pw-x2.measureText(mxs).width,H2-24);
      x2.fillStyle='#ffb35c';x2.fillText('mean',px(mean)+3,T2+10);
      x2.fillStyle='#8dffb0';x2.fillText('median',Math.min(px(med)+3,W2-52),T2+22);
      statsEl.textContent='n='+n+' · mean '+mean.toPrecision(5)+' · median '+med.toPrecision(5)+' · σ '+std.toPrecision(4)+' · skew '+sk.toFixed(2)+' · p05 '+p05.toPrecision(4)+' · p95 '+p95.toPrecision(4)+' · range ['+mn.toPrecision(4)+', '+mx.toPrecision(4)+']';
    }
    function refresh(){
      curMode===0?drawSeries():drawHist();
      // Same fix as the main quick-plot popup: pin wrap's width to the
      // canvas so a long stats/title line can't balloon the popup out to
      // ~96vw via shrink-to-fit sizing — see that refresh() for the fuller
      // explanation.
      wrap.style.width=(cv.width+26)+'px';
    }
    wrap.querySelectorAll('.pw-tabs button').forEach(b=>b.addEventListener('click',function(){
      wrap.querySelectorAll('.pw-tabs button').forEach(x=>{x.style.borderColor='rgba(127,208,255,0.25)';x.style.background='none';});
      this.style.borderColor='rgba(127,208,255,0.7)';this.style.background='rgba(127,208,255,0.18)';
      curMode=+this.dataset.pt; refresh();
    }));
    refresh();
    wrap.querySelector('.pw-csv').addEventListener('click',()=>{
      const parts=['time,region_mean\n'];
      for(let k=0;k<ys.length;k++)parts.push(labels[k]+','+(isNaN(ys[k])?'':ys[k].toPrecision(7))+'\n');
      _downloadCSV(parts,(ov.name||'overlay').replace(/[^\w.-]/g,'_')+'_region_timeseries.csv');
    });
    if(window.GlobePlotExpand) window.GlobePlotExpand.attach(wrap,cv,refresh,{normalW:620,normalH:300});
  }

  // Expose overlays array so globe-region.js can access NC data
  if (window.GlobeAPI) {
    window.GlobeAPI._ncOverlays = overlays;
    window.GlobeAPI.sampleOverlayPointSeries = async function sampleOverlayPointSeries(lon, lat) {
      const OV_COLORS = ['#ffd27f', '#7fd0ff', '#a78bfa', '#4ade80', '#fb923c', '#f472b6'];
      const tabs = [];
      let oi = 0;
      for (const ov of overlays) {
        if (!ov || ov.enabled === false || !ov.frames?.length) continue;
        const units = ov.activeSlice?.units || '';
        const varName = ov.activeSlice?.longName || ov.selVar || 'value';
        const points = [];
        const n = ov.frames.length;
        ov._cacheMax = Math.max(ov._cacheMax || 0, n);
        let _ly2=performance.now();
        for (let t = 0; t < n; t++) {
          if(n>8&&performance.now()-_ly2>16){await new Promise(r=>setTimeout(r,0));_ly2=performance.now();}
          const fr = _cacheGet(ov, t);
          if (!fr?.renderSlice) continue;
          const rs = fr.renderSlice;
          const v = sampleAt(lon, lat, rs, rs.lats, rs.lons);
          const lbl = ov.frames[t]?.label || `t${t}`;
          const parsed = Date.parse(lbl);
          points.push({ t: Number.isFinite(parsed) ? parsed : t, v });
        }
        const valid = points.filter((p) => Number.isFinite(p.v) && !isNaN(p.v));
        if (!valid.length) continue;
        tabs.push({
          id: `ov-${ov.id}`,
          label: `${ov.name || 'overlay'} · ${varName}`,
          unit: units,
          xLabel: 'Time',
          group: 'overlay',
          series: [{
            label: ov.name || varName,
            points: valid,
            color: OV_COLORS[oi % OV_COLORS.length],
          }],
        });
        oi++;
      }
      return tabs;
    };
  }
};
})();

