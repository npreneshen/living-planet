#!/usr/bin/env python3
"""
ERA5 Wind Embedder
===================
Embeds the ERA5 10m wind field into the globe HTML,
replacing the previous embedded wind field.

CONFIGURE THE PATHS BELOW, then run directly in your IDE.
"""
import re, os, shutil

# ════════════════════════════════════════════════════════════
#  CONFIGURE THESE
# ════════════════════════════════════════════════════════════
B64_FILE = r"C:\Users\P\Downloads\Extractions\wind\wind_b64.txt"
HTML_IN  = r"C:\Users\P\Downloads\Interactive_Globe_Offline_V3_GPU_Edit_v6_-Independent_fix_-v1i.html"
HTML_OUT = r"C:\Users\P\Downloads\Interactive_Globe_Offline_V3_GPU_Edit_v6_-Independent_fix_-v1i.html"  # can be same file
# ════════════════════════════════════════════════════════════

VMAX = 20.0  # must match extract_era5_wind.py VMAX


def safe(s):
    return s.replace('</script>', r'<\/script>')


# Block marker — strip previous wind embed before inserting fresh data
WIND_BLOCK_RE = re.compile(
    r'    // ════ REAL ERA5 10m WIND FIELD.*?    \}\)\(\);\n\n',
    re.DOTALL,
)


def strip_existing_blocks(src):
    """Remove any previously embedded wind blocks (velocity/jet left intact)."""
    n = len(WIND_BLOCK_RE.findall(src))
    if n:
        src = WIND_BLOCK_RE.sub('', src)
        print(f"  Removed {n} existing wind block(s)")
    return src


def embed(b64_file=B64_FILE, html_in=HTML_IN, html_out=HTML_OUT):
    b64 = open(b64_file).read().strip()
    print(f"Loaded {len(b64)} chars ERA5 wind base64 (~{len(b64)//1024} KB)")

    html = open(html_in, encoding='utf-8').read()

    m = re.search(r'(<script>/\* globe \*/\n)(.*?)(\n</script>)', html, re.DOTALL)
    assert m, "ERROR: globe script block not found"
    src = m.group(2).replace(r'<\/script>', '</script>')
    src = strip_existing_blocks(src)

    # Insertion point: same as ocean — just before rebuildSpawnWeights()
    # Wind block replaces WU/WV/WCls arrays built by the synthetic wind belt stamping
    INSERT_MARKER = '    // Build immediately — land mask is now synchronous\n    rebuildSpawnWeights();'
    assert INSERT_MARKER in src, "ERROR: Cannot find insertion point"

    wind_block = f'''
    // ════ REAL ERA5 10m WIND FIELD ═══════════════════════════════
    // Replaces synthetic zonal wind belts with real measured wind velocities.
    // Source: ERA5 monthly mean, 10m u/v, 1°x1° annual mean
    // (area-averaged from native coordinates — see extract_era5_wind.py)
    // Encoding: uint8, -{VMAX:.0f}…+{VMAX:.0f} m/s → 0…255 (128 = zero)
    (function(){{
      const VMAX={VMAX}, HALF=128, SCALE=VMAX/127.5;
      const GW2=360, GH2=180;
      const raw=atob('{b64}');

      // Clear synthetic wind belt field
      WU.fill(0); WV.fill(0); WCls.fill(-1);
      for(let c=4;c<7;c++) spawnByClass[c].length=0;

      for(let y=0;y<GH;y++){{
        const la=-90+(y+0.5)*CELL;
        const gy=la+90;
        const y0=Math.max(0,Math.min(GH2-2,Math.floor(gy)));
        const y1=y0+1, fy=gy-y0;
        for(let x=0;x<GW;x++){{
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
          // No speed/land exclusion here — a `spd<0.5 continue` used to
          // skip calm cells (and an older version skipped exact zeros)
          // entirely, leaving them out of WCls/spawnByClass and producing
          // grid-aligned dark patches with no particles wherever wind is
          // genuinely calm. Every cell gets a latitude-band class below
          // regardless of speed; wind blows over land too, so land isn't
          // excluded either (unlike ocean currents).
          WU[k]=u; WV[k]=v;
          // Classify wind: trades(4)=equatorial+easterly, wester(5)=mid-lat+westerly, polar(6)=high-lat
          const absLat=Math.abs(la);
          let wc;
          if(absLat>60)       wc=6;  // polar
          else if(absLat>25)  wc=5;  // westerlies
          else                wc=4;  // trades / equatorial
          WCls[k]=wc;
          spawnByClass[wc].push([lo,la]);
        }}
      }}
      console.log('[ERA5 wind] loaded. Wind cells:',
        WU.reduce((n,v)=>n+(v!==0?1:0),0));
    }})();

'''

    src = src.replace(INSERT_MARKER, wind_block + INSERT_MARKER)

    rebuilt = m.group(1) + safe(src) + m.group(3)
    html_new = html[:m.start()] + rebuilt + html[m.end():]

    if os.path.abspath(html_in) == os.path.abspath(html_out):
        backup = html_out.replace('.html', '_pre_wind_reextract_backup.html')
        if not os.path.exists(backup):
            shutil.copy(html_in, backup)
            print(f"Backup -> {backup}")
        else:
            print(f"Backup already exists, not overwriting -> {backup}")

    with open(html_out, 'w', encoding='utf-8') as f:
        f.write(html_new)

    sz = os.path.getsize(html_out)/1024/1024
    print(f"Written -> {html_out}  ({sz:.1f} MB)")
    print("Check browser console for: [ERA5 wind] loaded. Wind cells: NNNNN")


if __name__ == "__main__":
    embed()
