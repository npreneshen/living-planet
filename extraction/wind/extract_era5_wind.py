#!/usr/bin/env python3
"""
ERA5 Surface Wind Extractor
============================
Reads an ERA5 NetCDF file containing 10m u/v wind components,
subsamples to 1°×1°, computes a monthly or annual mean,
quantizes to uint8, and outputs base64 ready to embed in the globe HTML.

Download from: https://cds.climate.copernicus.eu/
  Dataset: ERA5 monthly averaged data on single levels
  Variables: 10m u-component of wind (u10), 10m v-component of wind (v10)
  Time: select all 12 months of any single year (e.g. 2020)
  Area: global
  Format: NetCDF

Typical file size: ~8–15 MB for a single year of monthly means (u+v).

CONFIGURE THE PATHS BELOW, then run directly in your IDE.
"""
import os, base64, json
import numpy as np
import netCDF4 as nc

# ════════════════════════════════════════════════════════════
#  CONFIGURE THESE
# ════════════════════════════════════════════════════════════
INPUT_NC   = r"C:\Users\P\Downloads\Extractions\wind\wind.nc"
OUTPUT_DIR = r"C:\Users\P\Downloads\Extractions\wind"
# Optional: if you only want a single month, set MONTH_INDEX (0=Jan, 11=Dec)
# Set to None to average ALL months in the file
MONTH_INDEX = None
# ════════════════════════════════════════════════════════════

VMAX = 20.0  # m/s clamp — 10m winds can reach 20+ m/s in storms


def find_var(ds, candidates):
    dvars = {k.lower(): k for k in ds.variables}
    for c in candidates:
        if c.lower() in dvars:
            return dvars[c.lower()]
    return None


def process_file(fpath, out_dir, month_index=None):
    os.makedirs(out_dir, exist_ok=True)

    print(f"Opening: {fpath}")
    ds = nc.Dataset(fpath)
    print(f"Variables : {list(ds.variables.keys())}")
    print(f"Dimensions: {dict(ds.dimensions)}")

    # ── Find U10 and V10 ────────────────────────────────────
    u_name = find_var(ds, [
        'u10', 'u_10m', '10u', 'uas', 'ua10m', 'eastward_wind',
        'u_component_of_wind_10m', 'uwnd', 'u_wind_10m'
    ])
    v_name = find_var(ds, [
        'v10', 'v_10m', '10v', 'vas', 'va10m', 'northward_wind',
        'v_component_of_wind_10m', 'vwnd', 'v_wind_10m'
    ])

    if u_name is None or v_name is None:
        print("\n⚠  Could not auto-detect U/V variable names.")
        print("Available variables:", list(ds.variables.keys()))
        print("Edit the find_var() candidate lists in the script.")
        ds.close()
        return None

    print(f"U variable: {u_name}")
    print(f"V variable: {v_name}")

    # ── Find lat/lon ─────────────────────────────────────────
    lat_name = find_var(ds, ['latitude', 'lat', 'y'])
    lon_name = find_var(ds, ['longitude', 'lon', 'x'])
    lat = np.array(ds.variables[lat_name][:])
    lon = np.array(ds.variables[lon_name][:])
    print(f"Lat: {lat.shape}  {lat.min():.1f} to {lat.max():.1f}")
    print(f"Lon: {lon.shape}  {lon.min():.1f} to {lon.max():.1f}")

    # ── Read data ─────────────────────────────────────────────
    u_var = ds.variables[u_name]
    v_var = ds.variables[v_name]
    print(f"U dims: {u_var.dimensions}  shape: {u_var.shape}")

    # ERA5 is typically [time, lat, lon] — no depth dimension
    def make_index(var):
        idx = []
        for d in var.dimensions:
            dl = d.lower()
            if 'time' in dl:
                if month_index is not None:
                    idx.append(month_index)  # single month
                else:
                    idx.append(slice(None))  # all months
            else:
                idx.append(slice(None))
        return tuple(idx)

    print(f"Reading U ({'single month' if month_index is not None else 'all months'})...")
    u_raw = np.array(u_var[make_index(u_var)], dtype=np.float32)
    print("Reading V...")
    v_raw = np.array(v_var[make_index(v_var)], dtype=np.float32)

    # Mask fill values
    for arr in (u_raw, v_raw):
        arr[np.abs(arr) > 1e10] = np.nan
        arr[np.abs(arr) > 100]  = np.nan  # wind can't exceed 100 m/s

    # Time-average if multiple time steps
    if u_raw.ndim == 3:
        print(f"Averaging {u_raw.shape[0]} time steps (monthly mean)...")
        u_mean = np.nanmean(u_raw, axis=0)
        v_mean = np.nanmean(v_raw, axis=0)
    else:
        u_mean = u_raw
        v_mean = v_raw

    print(f"U range: {np.nanmin(u_mean):.2f} to {np.nanmax(u_mean):.2f} m/s")
    print(f"V range: {np.nanmin(v_mean):.2f} to {np.nanmax(v_mean):.2f} m/s")

    # ── ERA5 lat is usually N→S (90→-90), need to flip to S→N ──
    if lat[0] > lat[-1]:
        print("Flipping lat axis N→S to S→N...")
        lat     = lat[::-1]
        u_mean  = u_mean[::-1, :]
        v_mean  = v_mean[::-1, :]

    # ERA5 lon is usually 0→360, convert to -180→180
    if lon.max() > 180:
        print("Converting lon 0-360 → -180-180...")
        shift = np.searchsorted(lon, 180)
        lon    = np.concatenate([lon[shift:]-360, lon[:shift]])
        u_mean = np.concatenate([u_mean[:,shift:], u_mean[:,:shift]], axis=1)
        v_mean = np.concatenate([v_mean[:,shift:], v_mean[:,:shift]], axis=1)

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

    # ── Quantize to uint8 ────────────────────────────────────
    # -VMAX → 0,  0 → 128,  +VMAX → 255
    def quantize(arr):
        arr = np.clip(arr, -VMAX, VMAX)
        arr = np.nan_to_num(arr, nan=0.0)
        return np.round((arr / VMAX * 127.5) + 128).astype(np.uint8)

    u_q = quantize(u1)
    v_q = quantize(v1)

    # Interleave [u0,v0, u1,v1, ...] lat(-89.5→89.5), lon(-179.5→179.5)
    combined = np.empty(180*360*2, dtype=np.uint8)
    combined[0::2] = u_q.flatten()
    combined[1::2] = v_q.flatten()

    b64 = base64.b64encode(combined.tobytes()).decode('ascii')
    print(f"\nOutput: {len(combined)} bytes → {len(b64)} chars base64 "
          f"(~{len(b64)//1024} KB added to HTML)")

    # ── Spot checks ──────────────────────────────────────────
    print("\nSpot checks:")
    checks = [
        ("NE Trade winds (Atlantic)",   -30,  15),  # expect u<0,v<0 (from NE)
        ("SE Trade winds (S Atlantic)", -20, -10),  # expect u<0,v>0 (from SE)
        ("Westerlies (N Atlantic)",     -30,  50),  # expect u>0 (westward)
        ("Westerlies (S Ocean)",        -30, -50),  # expect u>0
        ("ITCZ (weakest winds)",          0,   3),  # expect near-zero
        ("Monsoon (Indian Ocean Aug)",   70,  10),  # depends on month
        ("Polar winds (Arctic)",          0,  75),  # variable
    ]
    for name, lon_deg, lat_deg in checks:
        ix = int((lon_deg+180))%360
        iy = max(0,min(179,int(lat_deg+90)))
        u_ms=(float(u_q[iy,ix])-128)/127.5*VMAX
        v_ms=(float(v_q[iy,ix])-128)/127.5*VMAX
        spd=np.sqrt(u_ms**2+v_ms**2)
        print(f"  {name:35s}: u={u_ms:+.1f}  v={v_ms:+.1f}  speed={spd:.1f} m/s")

    # ── Write outputs ─────────────────────────────────────────
    b64_path  = os.path.join(out_dir, "wind_b64.txt")
    json_path = os.path.join(out_dir, "wind_field.json")

    with open(b64_path, 'w') as f:
        f.write(b64)
    with open(json_path, 'w') as f:
        json.dump({'b64':b64,'nx':360,'ny':180,'vmax':VMAX,
                   'source':os.path.basename(fpath),
                   'description':'ERA5 10m wind 1°x1° uint8'}, f)

    print(f"\nSaved → {b64_path}")
    print("Next: run embed_era5_wind.py")
    ds.close()
    return b64


if __name__ == "__main__":
    process_file(INPUT_NC, OUTPUT_DIR, MONTH_INDEX)
