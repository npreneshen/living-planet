#!/usr/bin/env python3
"""
Embeds real ERA5 jet stream data into the v1i globe HTML. Idempotent: safe
to re-run after changing INPUT_NC/re-running extract_jet.py — it detects
and removes a PREVIOUSLY embedded jet block (not just the untouched
placeholder) before inserting the fresh one, so repeated runs don't pile
up duplicate blocks or fail because the placeholder text is already gone.
"""
import os, re, shutil

B64_FILE = r"C:\Users\P\Downloads\Extractions\jet\jet_b64.txt"
HTML_IN  = r"C:\Users\P\Downloads\Interactive_Globe_Offline_V3_GPU_Edit_v6_-Independent_fix_-v1i.html"
HTML_OUT = HTML_IN

MARKER = "    // ════ REAL JET STREAM DATA ═══════════════════════════════════════"

# Matches the marker comment through the end of whatever follows it:
# either the untouched placeholder (ends in "(Placeholder ...)") or a
# previously embedded IIFE (ends in the matching "})();"). Non-greedy so
# it stops at the FIRST closing IIFE / placeholder line, not some later
# unrelated one further down the file.
EXISTING_BLOCK_RE = re.compile(
    re.escape(MARKER) + r".*?\n(?:    \(function\(\)\{.*?\n    \}\)\(\);|    // \(Placeholder.*?\))\n?",
    re.DOTALL,
)

b64 = open(B64_FILE).read().strip()
print(f"Loaded {len(b64)} chars of base64 jet data (~{len(b64)//1024} KB)")

html = open(HTML_IN, encoding='utf-8').read()

matches = EXISTING_BLOCK_RE.findall(html)
n = len(EXISTING_BLOCK_RE.findall(html))
assert n <= 1, f"ERROR: found {n} existing jet blocks, expected 0 or 1 — aborting, fix HTML_IN manually first"
assert n == 1, "ERROR: no placeholder or existing embedded jet block found in v1i — aborting, no changes made"

removed_kind = "embedded IIFE" if "(function(){" in EXISTING_BLOCK_RE.search(html).group(0) else "placeholder"
print(f"Found existing {removed_kind} block — will replace it")

jet_block = f'''    // ════ REAL JET STREAM DATA ═══════════════════════════════════════
    // Replaces analytical Rossby-wave geometry with real ERA5 300 hPa winds.
    // Source: ERA5 monthly mean, 300 hPa u+v, 1°×1° annual mean
    // Encoding: uint8, -80…+80 m/s → 0…255 (128 = zero wind)
    // window._jetU / _jetV: Float32Arrays (GH×GW = 180×360), m/s
    (function(){{
      const JVMAX=80, JHALF=128, JSCALE=JVMAX/127.5;
      const JGW=360, JGH=180;
      const raw=atob('{b64}');
      const jU=new Float32Array(JGH*JGW), jV=new Float32Array(JGH*JGW);
      for(let i=0;i<JGH*JGW;i++){{
        jU[i]=(raw.charCodeAt(i*2  )-JHALF)*JSCALE;
        jV[i]=(raw.charCodeAt(i*2+1)-JHALF)*JSCALE;
      }}
      window._jetU=jU; window._jetV=jV;
      window._jetGW=JGW; window._jetGH=JGH; window._jetVMAX=JVMAX;
      // Precompute jet speed field for contouring (used by globe-adv.js)
      const jSpd=new Float32Array(JGH*JGW);
      for(let i=0;i<JGH*JGW;i++) jSpd[i]=Math.sqrt(jU[i]*jU[i]+jV[i]*jV[i]);
      window._jetSpd=jSpd;
      // Quick QC: find global max
      let mx=0,mxi=0;
      for(let i=0;i<jSpd.length;i++) if(jSpd[i]>mx){{mx=jSpd[i];mxi=i;}}
      const mxLat=-90+(Math.floor(mxi/JGW)+0.5), mxLon=-180+(mxi%JGW+0.5);
      console.log('[ERA5 jet] loaded. Max speed:',mx.toFixed(1),'m/s at',
        mxLon.toFixed(1)+'°E,',mxLat.toFixed(1)+'°N');
    }})();
'''

html_new = EXISTING_BLOCK_RE.sub(jet_block, html, count=1)

backup = HTML_OUT.replace('.html', '_pre_jet_backup.html')
if not os.path.exists(backup):
    shutil.copy(HTML_IN, backup)
    print(f"Backup saved -> {backup}")
else:
    print(f"Backup already exists, not overwriting -> {backup}")

with open(HTML_OUT, 'w', encoding='utf-8') as f:
    f.write(html_new)

sz = os.path.getsize(HTML_OUT) / 1024 / 1024
print(f"Written -> {HTML_OUT}  ({sz:.1f} MB)")
