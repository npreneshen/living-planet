/* grib2 */
/* ============================================================
   grib2.js — pure-JS GRIB2 reader (browser + Node)
   Supports: Grid Definition Templates 3.0 (lat/lon) and 3.20
   (polar stereographic). Data Representation Templates 5.0
   (simple packing), 5.3 (complex + spatial differencing),
   5.40/5.41 (JPEG2000/PNG — requires window.JpxImage from
   jpx_bundle.js to be loaded first).
   ============================================================ */
window.GRIB2 = (function(){
  function u(buf,o,n){ let v=0; for(let i=0;i<n;i++) v=v*256+buf[o+i]; return v; }
  function tc(buf,o,n){ let v=u(buf,o,n); const max=Math.pow(256,n); if(v>=max/2)v-=max; return v; }
  function sm(buf,o,n){ const top=buf[o]; const sign=(top&0x80)?-1:1; let v=(top&0x7f); for(let k=1;k<n;k++)v=v*256+buf[o+k]; return sign*v; }
  // GRIB2 Section 5 binary/decimal scale factors: WMO spec says two's-complement,
  // but some older files (CMC, some regional centres) use sign-magnitude encoding.
  // Try tc() first; if the magnitude is implausibly large for a scale factor fall
  // back to sm().  Scale factors outside ±100 are unphysical for any real field.
  function sf2(buf,o){ const v=tc(buf,o,2); return Math.abs(v)<=100?v:sm(buf,o,2); }
  function f32(buf,o){ const b=(buf[o]<<24|buf[o+1]<<16|buf[o+2]<<8|buf[o+3])>>>0; const sign=(b>>>31)?-1:1,exp=(b>>>23)&0xff,mant=b&0x7fffff; if(exp===0)return sign*mant*Math.pow(2,-149); return sign*(1+mant/0x800000)*Math.pow(2,exp-127); }
  function BitReader(buf,startByte){ let bitPos=startByte*8; return { read(n){ if(!n)return 0; let v=0; for(let k=0;k<n;k++){const by=bitPos>>3,bi=7-(bitPos&7);v=v*2+((buf[by]>>bi)&1);bitPos++;} return v; }, align(){ bitPos=(bitPos+7)&~7; } }; }

  function parseMessage(buf,off0){
    if(!(buf[off0]===0x47&&buf[off0+1]===0x52&&buf[off0+2]===0x49&&buf[off0+3]===0x42)) throw new Error('Not GRIB at '+off0);
    const edition=buf[off0+7]; if(edition!==2) throw new Error('Only GRIB2 supported');
    const totalLen=u(buf,off0+8,8);
    let p=off0+16;
    const msg={discipline:buf[off0+6],totalLen,refTime:null,grid:null,pdt:null,drt:null,data:null,bitmap:undefined};
    while(p<off0+totalLen-4){
      const secLen=u(buf,p,4), secNum=buf[p+4];
      if(secNum===1){
        msg.refTime={year:u(buf,p+12,2),month:buf[p+14],day:buf[p+15],hour:buf[p+16],minute:buf[p+17],second:buf[p+18]};
      } else if(secNum===3){
        // Section 3: nPts at p+6..9, gdtNum at p+12..13, template at p+14
        const nPts=u(buf,p+6,4), gdtNum=(buf[p+12]<<8|buf[p+13]);
        const tpl=p+14; // template byte 0 = WMO octet15
        if(gdtNum===0){
          const Nx=u(buf,tpl+16,4),Ny=u(buf,tpl+20,4);
          const La1=sm(buf,tpl+32,4)/1e6,Lo1=sm(buf,tpl+36,4)/1e6;
          const Di=u(buf,tpl+49,4)/1e6,Dj=u(buf,tpl+53,4)/1e6;
          const scan=buf[tpl+57];const iNeg=!!(scan&0x80),jPos=!!(scan&0x40);
          const lats=new Float64Array(Ny),lons=new Float64Array(Nx);
          for(let x=0;x<Nx;x++)lons[x]=Lo1+(iNeg?-1:1)*Di*x;
          for(let y=0;y<Ny;y++)lats[y]=(sm(buf,tpl+32,4)/1e6)+(jPos?1:-1)*Dj*y;
          // Grids whose first longitude is already ≥180 (e.g. NAM/RTOFS
          // regional subsets at 254°E) build monotonic axes like 254→434
          // that render off-globe. Shift the whole axis by -360: stays
          // monotonic, lands in the renderer's expected window.
          if(lons[0]>=180){ for(let x=0;x<Nx;x++) lons[x]-=360; }
          msg.grid={Nx,Ny,lats,lons,nPts,proj:'latlon'};
        } else if(gdtNum===1){
          // GDT 3.1 rotated lat-lon (RTOFS-class ocean models, many
          // regional NWP grids). Octets 15-72 are identical to GDT 3.0;
          // the rotation parameters (south-pole lat/lon + angle) follow.
          // Coordinates here are in ROTATED space — rendering them as
          // plain lat-lon puts the data in the wrong place (the
          // 'loads off screen' symptom), so mark proj:'rotated' and warn.
          const Nx=u(buf,tpl+16,4),Ny=u(buf,tpl+20,4);
          const La1=sm(buf,tpl+32,4)/1e6,Lo1=sm(buf,tpl+36,4)/1e6;
          const Di=u(buf,tpl+49,4)/1e6,Dj=u(buf,tpl+53,4)/1e6;
          const scan=buf[tpl+57];const iNeg=!!(scan&0x80),jPos=!!(scan&0x40);
          const spLat=sm(buf,tpl+58,4)/1e6,spLon=sm(buf,tpl+62,4)/1e6;
          const lats=new Float64Array(Ny),lons=new Float64Array(Nx);
          for(let x=0;x<Nx;x++)lons[x]=Lo1+(iNeg?-1:1)*Di*x;
          for(let y=0;y<Ny;y++)lats[y]=La1+(jPos?1:-1)*Dj*y;
          console.warn('[grib2] GDT 3.1 rotated lat-lon grid (south pole '+spLat.toFixed(1)+','+spLon.toFixed(1)+') — coordinates are in rotated space; overlay placement is approximate until unrotation is implemented.');
          msg.grid={Nx,Ny,lats,lons,nPts,proj:'rotated',spLat,spLon};
        } else if(gdtNum===40||gdtNum===41){
          const Nx=u(buf,tpl+16,4),Ny=u(buf,tpl+20,4);
          const La1=sm(buf,tpl+32,4)/1e6,Lo1=sm(buf,tpl+36,4)/1e6;
          const La2=sm(buf,tpl+41,4)/1e6,Di=u(buf,tpl+49,4)/1e6;
          const scan=buf[tpl+57];const iNeg=!!(scan&0x80),jPos=!!(scan&0x40);
          const Dj40=Math.abs(La2-La1)/(Ny>1?Ny-1:1);
          const lats=new Float64Array(Ny),lons=new Float64Array(Nx);
          for(let x=0;x<Nx;x++)lons[x]=Lo1+(iNeg?-1:1)*Di*x;
          for(let y=0;y<Ny;y++)lats[y]=La1+(jPos?1:-1)*Dj40*y;
          if(lons[0]>=180){ for(let x=0;x<Nx;x++) lons[x]-=360; }
          msg.grid={Nx,Ny,lats,lons,nPts,proj:'gaussian'};
        } else if(gdtNum===20){
          // GDT 3.20 polar stereographic
          // Offsets verified against raw hex of gdaswave file:
          // Ni(tpl+16..19), Nj(tpl+20..23), La1(tpl+24..27), Lo1(tpl+28..31),
          // resFlags(tpl+32), LoV(tpl+33..36), Dx(tpl+37..40), Dy(tpl+41..44),
          // projCentre(tpl+45), scan(tpl+46)
          const Nx=u(buf,tpl+16,4), Ny=u(buf,tpl+20,4);
          const La1_deg=tc(buf,tpl+24,4)/1e6, Lo1_deg=tc(buf,tpl+28,4)/1e6;
          const LoV_deg=tc(buf,tpl+33,4)/1e6;
          const Dx_mm=u(buf,tpl+37,4), Dy_mm=u(buf,tpl+41,4);
          const dxM=(Dx_mm>0?Dx_mm:Dy_mm)/1000, dyM=Dy_mm/1000;
          const Re=6371229, D2=Math.PI/180;
          const La1=La1_deg*D2, Lo1=Lo1_deg*D2, LoV=LoV_deg*D2;
          // Forward polar stereo to get (x0,y0) of first point
          const t0=Math.tan(Math.PI/4-La1/2), r0=2*Re*t0;
          const x0=r0*Math.sin(Lo1-LoV), y0=-r0*Math.cos(Lo1-LoV);
          // Inverse polar stereo
          function psInv(xi,yi){
            const r=Math.hypot(xi,yi); if(r<1)return{lat:90,lon:0};
            const lat=(Math.PI/2-2*Math.atan(r/(2*Re)))/D2;
            const lon_rad=LoV+Math.atan2(xi,-yi);
            let lon=lon_rad/D2; while(lon<-180)lon+=360; while(lon>180)lon-=360;
            return{lat,lon};
          }
          // Build flat lat/lon arrays: x=x0+i*dx, y=y0-j*dy (NCEP convention verified)
          const lonArr=new Float32Array(Nx*Ny), latArr=new Float32Array(Nx*Ny);
          for(let j=0;j<Ny;j++){
            const yi=y0-j*dyM;
            for(let i=0;i<Nx;i++){
              const xi=x0+i*dxM, {lat,lon}=psInv(xi,yi);
              latArr[j*Nx+i]=lat; lonArr[j*Nx+i]=lon;
            }
          }
          msg.grid={Nx,Ny,lats:latArr,lons:lonArr,nPts,proj:'ps',La1:La1_deg,Lo1:Lo1_deg,LoV:LoV_deg,Dx:dxM,Dy:dyM};
        } else {
          throw new Error('Grid Definition Template 3.'+gdtNum+' not supported (3.0 lat/lon and 3.20 polar stereo supported)');
        }
      } else if(secNum===4){
        const pdtNum=(buf[p+7]<<8|buf[p+8]);
        const _cat=buf[p+9],_num=buf[p+10],_lvlType=buf[p+22];
        const _lvlSF=buf[p+23],_lvlRaw=u(buf,p+24,4);
        const _lvlVal=(_lvlSF===0||_lvlSF===255)?_lvlRaw:(_lvlRaw/Math.pow(10,_lvlSF));
        msg.pdt={num:pdtNum,paramCat:_cat,paramNum:_num,typeOfLevel:_lvlType,levelValue:_lvlVal,
                 forecastTime:u(buf,p+18,4),forecastUnit:buf[p+17]};
      } else if(secNum===5){
        const N=u(buf,p+5,4), drtNum=(buf[p+9]<<8|buf[p+10]);
        const R=f32(buf,p+11), E=sf2(buf,p+15), D=sf2(buf,p+17), nbits=buf[p+19];
        msg.drt={num:drtNum,N,R,E,D,nbits,secBody:p+5};
      } else if(secNum===6){
        // Bit-Map Section. Indicator 0 = bitmap follows here (1 bit/grid
        // point, MSB first, zero-padded to a byte boundary); 255 = no
        // bitmap (every grid point has data — the common case, which is
        // why this went unnoticed for a long time); 254 = reuse the
        // previous message's bitmap (rare, not supported here).
        // Section 5's N (data point count) is only equal to the FULL grid
        // point count when there's no bitmap — with one present, N counts
        // just the flagged points, and the packed data array in Section 7
        // holds exactly N values with NO gaps. Without expanding it back
        // onto the full grid via this bitmap, those N values silently get
        // treated as the first N *flat* grid cells (row-major), which
        // reads as "data fills the first chunk of the sphere, then
        // abruptly stops" — a masked/partial field (e.g. land-only soil
        // temperature, common in GEFS/GFS b-file products) rendered as a
        // corrupted half-globe instead of the correct scattered mask.
        const bmInd=buf[p+5];
        if(bmInd===0){ msg.bitmap={start:p+6,nBytes:secLen-6}; }
        else if(bmInd===255){ msg.bitmap=null; }
        else{ console.warn('[grib2] bitmap indicator '+bmInd+' (predefined/reused) not supported — data may be misaligned'); }
      } else if(secNum===7){
        msg.dataStart=p+5; msg.dataLen=secLen-5;
      } else if(secNum===8){ break; }
      if(secLen===0)break; p+=secLen;
    }
    return msg;
  }

  function decodeData(buf,msg){
    const {N,R,E,D,nbits,num}=msg.drt;
    const bscale=Math.pow(2,E),dscale=Math.pow(10,-D);
    let packed;
    if(num===0) packed=decodeSimple(buf,msg,R,bscale,dscale,N,nbits);
    else if(num===3) packed=decodeComplex(buf,msg,R,bscale,dscale,N,nbits);
    else if(num===40||num===41) packed=decodeJpeg2000(buf,msg,R,bscale,dscale,N); // was passing undefined 'scale' as 6th arg — ReferenceError killed every JPEG2000-packed message (NOMADS climate/regional models)
    else throw new Error('Data Representation Template 5.'+num+' not supported');
    // Expand a bitmap-masked field back onto the full grid: Section 7 only
    // stores N values for the bitmap-flagged points (N < total grid points
    // whenever a bitmap is present), packed with no gaps. Without this,
    // callers indexing packed[row*nLon+col] silently read the WRONG point
    // for every masked field, which reads visually as "data fills part of
    // the sphere then abruptly stops" — see the Section 6 parsing comment.
    if(msg.bitmap){
      const total=msg.grid?msg.grid.nPts:null;
      if(!total) return packed; // no grid point count to expand against — best effort, leave as-is
      const out=new Float32Array(total).fill(NaN);
      const bmp=buf, base=msg.bitmap.start;
      let si=0;
      for(let k=0;k<total&&si<packed.length;k++){
        const byte=bmp[base+(k>>3)], bit=(byte>>(7-(k&7)))&1;
        if(bit) out[k]=packed[si++];
      }
      return out;
    }
    return packed;
  }

  function decodeSimple(buf,msg,R,bscale,dscale,N,nbits){
    const out=new Float32Array(N);const br=BitReader(buf,msg.dataStart);
    for(let k=0;k<N;k++)out[k]=(nbits===0)?(R*dscale):((R+br.read(nbits)*bscale)*dscale);
    return out;
  }

  function decodeComplex(buf,msg,R,bscale,dscale,N,nbits){
    // DRT 5.3 — complex packing with spatial differencing
    // WMO GRIB2 Manual on Codes Vol I.2 Table 5.3
    // All offsets from secBody (= section_start + 5):
    //   N:6-9, drtNum:10-11, R:12-15, E:16-17, D:18-19, nbits:20, origType:21
    //   groupSplit:22, missingMgmt:23, primaryMiss:24-27, secondaryMiss:28-31
    //   NG:32-35, groupWidthRef:36, groupWidthBits:37, groupLenRef:38-41
    //   groupLenIncr:42, groupLenLast:43-46, groupLenBits:47
    //   spatialOrder:48, os:49
    // secBody offsets (subtract 6 from above 1-based octets):
    const sb=msg.drt.secBody;
    const missingMgmt=buf[sb+17];
    if(missingMgmt!==0){
      // Ignore missing-value management — treat as simple decode
      console.warn('[GRIB2] DRT5.3 missing-value management='+missingMgmt+', continuing anyway');
    }
    const NG=u(buf,sb+26,4);
    if(!NG) throw new Error('Complex: NG=0');
    const groupWidthRef=buf[sb+30], groupWidthBits=buf[sb+31];
    const groupLenRef=u(buf,sb+32,4), groupLenIncr=buf[sb+36];
    const groupLenLast=u(buf,sb+37,4), groupLenBits=buf[sb+41];
    const spatialOrder=buf[sb+42], os=buf[sb+43];
    let pos=msg.dataStart;
    function readSM_v(n){const v=sm(buf,pos,n);pos+=n;return v;}
    let g0=0,g1=0,dMin=0;
    if(spatialOrder===1){g0=readSM_v(os);dMin=readSM_v(os);}
    else if(spatialOrder===2){g0=readSM_v(os);g1=readSM_v(os);dMin=readSM_v(os);}
    const br=BitReader(buf,pos);
    const refs=new Int32Array(NG);for(let k=0;k<NG;k++)refs[k]=br.read(nbits);br.align();
    const widths=new Uint8Array(NG);for(let k=0;k<NG;k++)widths[k]=groupWidthRef+br.read(groupWidthBits);br.align();
    const lens=new Uint32Array(NG);for(let k=0;k<NG;k++)lens[k]=groupLenRef+br.read(groupLenBits)*groupLenIncr;
    lens[NG-1]=groupLenLast;br.align();
    const seq=new Float64Array(N);let si=0;
    for(let k=0;k<NG&&si<N;k++){const w=widths[k],ref=refs[k],len=lens[k];for(let j=0;j<len&&si<N;j++)seq[si++]=(w===0)?ref:(ref+br.read(w));}
    const g=new Float64Array(N);
    if(spatialOrder===0){for(let k=0;k<N;k++)g[k]=seq[k];}
    else if(spatialOrder===1){g[0]=g0;let D1=0;for(let k=1;k<N;k++){g[k]=g[k-1]+D1;D1+=seq[k]+dMin;}}
    else{g[0]=g0;g[1]=g1;let D2=g1-g0;for(let k=2;k<N;k++){g[k]=g[k-1]+D2;D2+=seq[k]+dMin;}}
    const out=new Float32Array(N);
    for(let k=0;k<N;k++)out[k]=(R+g[k]*bscale)*dscale;
    return out;
  }

  function decodeJpeg2000(buf,msg,R,bscale,dscale,N){
    if(!window.JpxImage) throw new Error('JpxImage not loaded — include jpx_bundle.js before grib2.js');
    const j2k=buf.slice?buf.slice(msg.dataStart,msg.dataStart+msg.dataLen):buf.subarray(msg.dataStart,msg.dataStart+msg.dataLen);
    const img=new window.JpxImage(); img.parse(j2k);
    const items=img.tiles[0].items;
    const out=new Float32Array(Math.min(N,items.length));
    for(let k=0;k<out.length;k++)out[k]=(R+items[k]*bscale)*dscale;
    return out;
  }

  function parse(buf){
    if(!(buf instanceof Uint8Array)) buf=new Uint8Array(buf);
    const messages=[]; let off=0;
    while(off<buf.length-4){
      if(buf[off]===0x47&&buf[off+1]===0x52&&buf[off+2]===0x49&&buf[off+3]===0x42){
        try{ const msg=parseMessage(buf,off); msg.data=decodeData(buf,msg); messages.push(msg); off+=msg.totalLen; }
        catch(e){ messages.push({error:e.message,offset:off}); off+=16; }
      } else off++;
    }
    return messages;
  }

  // Parse and decode a single GRIB2 message from a subarray starting at byte 0
  function parseOne(buf){
    if(!(buf instanceof Uint8Array)) buf=new Uint8Array(buf);
    const msg=parseMessage(buf,0);
    msg.data=decodeData(buf,msg);
    return msg;
  }

  return {parse, parseOne:parseOne, decodeData,_internal:{f32,tc,sm,u}};
})();
/* NOT SUPPORTED: DRT 5.40 JPEG2000 from NOMADS high-res GFS pgrb2 would need
   the JpxImage decoder loaded (jpx_bundle.js). Many other GRIB2 sources
   (DWD, ECMWF, regional models) use 5.0/5.3 and work directly. */

