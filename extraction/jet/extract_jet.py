#!/usr/bin/env python3
"""
ERA5 Jet Stream Extractor
==========================
Reads an ERA5 NetCDF file containing 300 hPa u/v wind components,
subsamples to 1°×1°, quantizes to uint8, and writes base64 ready
for embedding.  The result captures real jet stream structure
(subtropical jet ~30°, polar-front jet ~50–60°, Rossby wave troughs).

CONFIGURE THE PATHS BELOW, then run directly in your IDE.

Typical ERA5 variable names: 'u', 'v'  (or 'u_component_of_wind')
Pressure level 300 hPa is jet-stream level; 250 hPa also works.
"""
import os, base64, json
import numpy as np
import netCDF4 as nc

# ════════════════════════════════════════════════════════════════
#  CONFIGURE THESE
# ════════════════════════════════════════════════════════════════
INPUT_NC   = r"C:\Users\P\Downloads\Weather Data\combined_file.nc"  # your ERA5 nc file
OUTPUT_DIR = r"C:\Users\P\Downloads\Extractions\jet"                  # output folder
PRESSURE_LEVEL = 300   # hPa — set to None if file has only one level
# ════════════════════════════════════════════════════════════════

VMAX = 80.0   # m/s clamp — covers all jet stream speeds (>70 m/s rare)


def find_var(ds, candidates):
    """Return first matching variable name (case-insensitive)."""
    dvars = {k.lower(): k for k in ds.variables}
    for c in candidates:
        if c.lower() in dvars:
            return dvars[c.lower()]
    return None


def process_file(fpath, out_dir, plev=PRESSURE_LEVEL):
    os.makedirs(out_dir, exist_ok=True)
    print(f"Opening: {fpath}")
    ds = nc.Dataset(fpath)
    print(f"Variables : {list(ds.variables.keys())}")
    print(f"Dimensions: {dict(ds.dimensions)}")

    # ── Find U and V ─────────────────────────────────────────────
    u_name = find_var(ds, ['u','u_component_of_wind','eastward_wind','u_wind','ugrd'])
    v_name = find_var(ds, ['v','v_component_of_wind','northward_wind','v_wind','vgrd'])

    if u_name is None or v_name is None:
        print("⚠  Could not auto-detect U/V. Available:", list(ds.variables.keys()))
        ds.close(); return None

    print(f"U variable: {u_name}, V variable: {v_name}")

    # ── Find lat/lon ──────────────────────────────────────────────
    lat_name = find_var(ds, ['latitude','lat','nav_lat','y'])
    lon_name = find_var(ds, ['longitude','lon','nav_lon','x'])
    lat = np.array(ds.variables[lat_name][:])
    lon = np.array(ds.variables[lon_name][:])
    print(f"Lat: {lat.shape}  {lat.min():.1f}→{lat.max():.1f}")
    print(f"Lon: {lon.shape}  {lon.min():.1f}→{lon.max():.1f}")

    u_var = ds.variables[u_name]
    v_var = ds.variables[v_name]
    print(f"U dims: {u_var.dimensions}  shape: {u_var.shape}")

    # ── Build index ───────────────────────────────────────────────
    def make_index(var):
        idx = []
        for d in var.dimensions:
            dl = d.lower()
            if 'level' in dl or 'pres' in dl or 'plev' in dl:
                # Find the index of the requested pressure level
                lev_name = d
                lev_vals = np.array(ds.variables[lev_name][:])
                if plev is not None:
                    diffs = np.abs(lev_vals - plev)
                    li = int(np.argmin(diffs))
                    print(f"  Pressure level {lev_vals[li]:.0f} hPa (index {li})")
                    idx.append(li)
                else:
                    idx.append(0)
            elif 'time' in dl:
                idx.append(slice(None))
            else:
                idx.append(slice(None))
        return tuple(idx)

    print("Reading U...")
    u_raw = np.array(u_var[make_index(u_var)], dtype=np.float32)
    print("Reading V...")
    v_raw = np.array(v_var[make_index(v_var)], dtype=np.float32)

    for arr in (u_raw, v_raw):
        arr[np.abs(arr) > 1e10] = np.nan
        arr[np.abs(arr) > 200]  = np.nan   # unrealistic

    # Time-average if needed
    if u_raw.ndim == 3:
        print(f"Averaging {u_raw.shape[0]} time steps...")
        u_mean = np.nanmean(u_raw, axis=0)
        v_mean = np.nanmean(v_raw, axis=0)
    elif u_raw.ndim == 4:
        # shape: time × level × lat × lon — already indexed level, so 3D
        u_mean = np.nanmean(u_raw, axis=0)
        v_mean = np.nanmean(v_raw, axis=0)
    else:
        u_mean, v_mean = u_raw, v_raw

    print(f"U range: {np.nanmin(u_mean):.1f} to {np.nanmax(u_mean):.1f} m/s")
    print(f"V range: {np.nanmin(v_mean):.1f} to {np.nanmax(v_mean):.1f} m/s")

    # ── ERA5 latitude convention ──────────────────────────────────
    # ERA5 lat runs 90→-90; we need -90→90. Flip if needed.
    if lat[0] > lat[-1]:
        print("Flipping latitude (north-first → south-first)")
        u_mean = u_mean[::-1, :]
        v_mean = v_mean[::-1, :]
        lat = lat[::-1]

    # ── ERA5 longitude convention ─────────────────────────────────
    # ERA5 lon runs 0→360; we need -180→180. Roll if needed.
    if lon.min() >= 0 and lon.max() > 180:
        print("Rolling longitude (0-360 → -180-180)")
        shift = np.searchsorted(lon, 180)
        u_mean = np.roll(u_mean, -shift, axis=1)
        v_mean = np.roll(v_mean, -shift, axis=1)
        lon = np.concatenate([lon[shift:]-360, lon[:shift]])

    # ── Resample to 1°×1° (360×180) using ACTUAL lat/lon coordinates ──
    # A naive reshape-by-index (old approach: chop the array into
    # sh[0]//180 row-chunks starting at index 0) silently assumes the
    # native grid spans exactly -90..90 with a row/col count that evenly
    # divides the target grid. That assumption broke badly on a CMEMS
    # ocean-current source whose native lat range was -80..90 (missing
    # southern coverage) — it shifted the entire field by ~10 degrees
    # with no warning. This source (ERA5) happens to span the full
    # globe cleanly, but binning on the real coordinate values instead
    # of raw index makes this correct for ANY source grid shape, offset,
    # or coverage gap, not just this one file.
    NY, NX = 180, 360
    lat_edges = np.linspace(-90.0, 90.0, NY + 1)
    lon_edges = np.linspace(-180.0, 180.0, NX + 1)
    lat_bin = np.clip(np.digitize(lat, lat_edges) - 1, 0, NY - 1)
    lon_bin = np.clip(np.digitize(lon, lon_edges) - 1, 0, NX - 1)
    print(f"Coordinate-based binning: lat rows map to output rows "
          f"{lat_bin.min()}..{lat_bin.max()} (of {NY}), "
          f"lon cols map to output cols {lon_bin.min()}..{lon_bin.max()} (of {NX})")

    flat_bin = (lat_bin[:, None].astype(np.int64) * NX + lon_bin[None, :].astype(np.int64))
    flat_bin = np.broadcast_to(flat_bin, u_mean.shape)

    def area_average(field):
        # np.bincount is ~20-50x faster than np.add.at for this
        # scatter-sum (add.at is notoriously slow); results identical.
        valid = ~np.isnan(field)
        idx = flat_bin[valid]
        sums = np.bincount(idx, weights=field[valid].astype(np.float64), minlength=NY * NX)
        counts = np.bincount(idx, minlength=NY * NX).astype(np.float64)
        out = np.full(NY * NX, np.nan, dtype=np.float64)
        has_data = counts > 0
        out[has_data] = sums[has_data] / counts[has_data]
        return out.reshape(NY, NX), counts.reshape(NY, NX)

    u1, cover = area_average(u_mean)
    v1, _ = area_average(v_mean)
    empty_bins = int((cover == 0).sum())
    print(f"Final grid: {u1.shape}  ({empty_bins} of {NY*NX} output cells have zero native "
          f"coverage — will read as 0 m/s)")

    # ── Quantize to uint8 ─────────────────────────────────────────
    # -VMAX → 0,  0 → 128,  +VMAX → 255
    def quantize(arr):
        arr = np.clip(arr, -VMAX, VMAX)
        arr = np.nan_to_num(arr, nan=0.0)
        return np.round((arr / VMAX * 127.5) + 128).astype(np.uint8)

    u_q = quantize(u1)
    v_q = quantize(v1)

    # Interleave: [u0,v0, u1,v1, ...] row-major lat(-89.5→89.5), lon(-179.5→179.5)
    combined = np.empty(180 * 360 * 2, dtype=np.uint8)
    combined[0::2] = u_q.flatten()
    combined[1::2] = v_q.flatten()
    b64 = base64.b64encode(combined.tobytes()).decode('ascii')

    print(f"\nOutput: {len(combined)} bytes → {len(b64)} chars base64 (~{len(b64)//1024} KB)")

    # ── Spot-check known jet locations ────────────────────────────
    print("\nSpot checks (expect strong westerlies at jet latitudes):")
    checks = [
        ("N. Atlantic polar jet core",  -40, 55),
        ("N. Pacific polar jet core",   -160, 50),
        ("N. American sub-tropical jet", -90, 30),
        ("Asian subtropical jet",         90, 28),
        ("S. Hemisphere jet (SH summer)",  0,-50),
        ("Equatorial region (slow~0)",     0,  5),
    ]
    for name, lon_deg, lat_deg in checks:
        ix = int((lon_deg + 180)) % 360
        iy = max(0, min(179, int(lat_deg + 90)))
        u_ms = (float(u_q[iy, ix]) - 128) / 127.5 * VMAX
        v_ms = (float(v_q[iy, ix]) - 128) / 127.5 * VMAX
        spd  = np.sqrt(u_ms**2 + v_ms**2)
        print(f"  {name:38s} ({lon_deg:6.1f}°E,{lat_deg:5.1f}°N): "
              f"u={u_ms:+5.1f} v={v_ms:+5.1f} spd={spd:5.1f} m/s")

    # ── Write outputs ─────────────────────────────────────────────
    b64_path  = os.path.join(out_dir, "jet_b64.txt")
    json_path = os.path.join(out_dir, "jet_field.json")
    with open(b64_path, 'w') as f: f.write(b64)
    with open(json_path, 'w') as f:
        json.dump({'b64':b64,'nx':360,'ny':180,'vmax':VMAX,
                   'source':os.path.basename(fpath),'level_hpa':plev,
                   'description':'300hPa jet wind 1°x1° uint8'}, f)

    print(f"\nSaved → {b64_path}")
    print(f"Saved → {json_path}")
    print("Next step: run embed_jet.py")
    ds.close()
    return b64


if __name__ == "__main__":
    process_file(INPUT_NC, OUTPUT_DIR)
