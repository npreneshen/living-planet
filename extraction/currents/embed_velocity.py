#!/usr/bin/env python3
"""
ORAS5/CMEMS Velocity Embedder
========================
Reads the base64 velocity file produced by extract_velocity.py and
embeds it into the globe HTML, replacing the previous embedded ocean
current field.

The velocity block is inserted AFTER CLS, spawnByClass and LAND are
all declared and initialised — so no ReferenceError on startup.

CONFIGURE THE PATHS BELOW, then run directly in your IDE.
"""
import re, os, shutil

# ════════════════════════════════════════════════════════════
#  CONFIGURE THESE
# ════════════════════════════════════════════════════════════
B64_FILE = r"C:\Users\P\Downloads\Extractions\currents\velocity_b64.txt"
HTML_IN  = r"C:\Users\P\Downloads\Interactive_Globe_Offline_V3_GPU_Edit_v6_-Independent_fix_-v1i.html"
HTML_OUT = r"C:\Users\P\Downloads\Interactive_Globe_Offline_V3_GPU_Edit_v6_-Independent_fix_-v1i.html"  # can be same file
# ════════════════════════════════════════════════════════════



def safe(s):
    return s.replace('</script>', r'<\/script>')


# Block marker — strip previous velocity embed before inserting fresh data
VELOCITY_BLOCK_RE = re.compile(
    r'    // ════ REAL SURFACE VELOCITY FIELD \(CMEMS\).*?    \}\)\(\);\n\n',
    re.DOTALL,
)


def strip_existing_blocks(src):
    """Remove any previously embedded velocity blocks (wind left intact)."""
    n = len(VELOCITY_BLOCK_RE.findall(src))
    if n:
        src = VELOCITY_BLOCK_RE.sub('', src)
        print(f"  Removed {n} existing velocity block(s)")
    return src


def embed(b64_file=B64_FILE, html_in=HTML_IN, html_out=HTML_OUT):
    b64 = open(b64_file).read().strip()
    print(f"Loaded {len(b64)} chars of base64 velocity data (~{len(b64)//1024} KB)")

    html = open(html_in, encoding='utf-8').read()

    # ── Extract the globe script block ───────────────────────
    m = re.search(r'(<script>/\* globe \*/\n)(.*?)(\n</script>)', html, re.DOTALL)
    assert m, "ERROR: Could not find '/* globe */' script block in HTML"
    src = m.group(2).replace(r'<\/script>', '</script>')
    src = strip_existing_blocks(src)

    # ── Verify required sections exist ───────────────────────
    required = [
        ('CLS declaration',    'const CLS=new Int8Array'),
        ('spawnByClass',       'const spawnByClass='),
        ('land mask bitfield', 'atob(b64)'),
        ('rebuildSpawnWeights','rebuildSpawnWeights();'),
        ('smoothing pass',     'function _smoothOceanClass'),
    ]
    for label, marker in required:
        assert marker in src, f"ERROR: Cannot find '{label}' marker: {marker!r}"
        print(f"  OK Found: {label}")

    # ── Insertion point: just before rebuildSpawnWeights() ───
    # At this point CLS, spawnByClass, LAND are all declared AND filled.
    # The velocity block clears them and refills from real data.
    INSERT_MARKER = '    // Build immediately — land mask is now synchronous\n    rebuildSpawnWeights();'
    assert INSERT_MARKER in src, \
        "ERROR: Cannot find insertion point before rebuildSpawnWeights(). " \
        "Try searching for 'rebuildSpawnWeights' in the HTML and update INSERT_MARKER."

    velocity_block = f'''
    // ════ REAL SURFACE VELOCITY FIELD (CMEMS) ════════════════
    // Replaces the synthetic stamped field with measured ocean velocities.
    // Source: CMEMS Global Ocean Physics, uo+vo, surface level, 1°x1° mean
    // (area-averaged from native 0.083° using actual lat/lon coordinate
    // binning — see extract_velocity.py; a prior version used naive
    // index-based reshaping that silently mis-registered the whole field
    // by ~10° since the source's native lat range is -80..90, not -90..90)
    // Encoding: uint8, -2.5…+2.5 m/s → 0…255 (128 = zero velocity)
    (function(){{
      const VMAX=2.5, HALF=128, SCALE=VMAX/127.5;
      const GW2=360, GH2=180;
      const raw=atob('{b64}');

      // Clear synthetic field built by stampPath above
      U.fill(0); V.fill(0); Wt.fill(0); CLS.fill(0);
      for(let c=0;c<NCLS;c++) CWt[c].fill(0);
      for(let c=0;c<4;c++) spawnByClass[c].length=0;  // clear ocean spawn lists (keep wind 4-6)

      // Bilinear interpolation: 1° input grid → 1.5° working grid
      for(let y=0;y<GH;y++){{
        const la=-90+(y+0.5)*CELL;
        const gy=la+90;
        const y0=Math.max(0,Math.min(GH2-2,Math.floor(gy)));
        const y1=y0+1;
        const fy=gy-y0;
        for(let x=0;x<GW;x++){{
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
        }}
      }}
      // Smooth warm/cold classification noise: the sign of v (meridional
      // velocity) decides warm vs cold, but v is small/noisy anywhere flow
      // is mostly zonal (e.g. near the equator), so adjacent cells can end
      // up in different classes even though the current is continuous —
      // a 3x3 majority-vote pass over CLS (not over U/V; particle physics
      // is untouched) smooths that out. See _smoothOceanClass definition.
      _smoothOceanClass();
      // Gyre ellipse ring points → class 3 spawn list
      (GF.GYRES||[]).forEach(g=>{{
        (g._ringPts||[]).forEach(([lon,lat])=>{{
          if(lat>=-89&&lat<=89) spawnByClass[3].push([lon,lat]);
        }});
      }});
      console.log('[CMEMS velocity] loaded. Ocean cells:',
        U.reduce((n,v,i)=>n+(v!==0?1:0),0));
    }})();

'''

    src = src.replace(INSERT_MARKER, velocity_block + INSERT_MARKER)

    # ── Write result ─────────────────────────────────────────
    rebuilt = m.group(1) + safe(src) + m.group(3)
    html_new = html[:m.start()] + rebuilt + html[m.end():]

    # Backup original if writing to same file
    if os.path.abspath(html_in) == os.path.abspath(html_out):
        backup = html_out.replace('.html', '_pre_ocean_reextract_backup.html')
        if not os.path.exists(backup):
            shutil.copy(html_in, backup)
            print(f"Backup saved -> {backup}")
        else:
            print(f"Backup already exists, not overwriting -> {backup}")

    with open(html_out, 'w', encoding='utf-8') as f:
        f.write(html_new)

    sz = os.path.getsize(html_out) / 1024 / 1024
    print(f"\nWritten -> {html_out}  ({sz:.1f} MB)")
    print("Open the HTML and check the browser console for:")
    print("  [CMEMS velocity] loaded. Ocean cells: NNNNN")


if __name__ == "__main__":
    embed()
