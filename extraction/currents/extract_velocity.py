#!/usr/bin/env python3
"""
ORAS5 / CMEMS Velocity Field Extractor
================================
Reads an ORAS5/CMEMS NetCDF file containing zonal/meridional surface
velocity, subsamples to 1°x1°, quantizes to uint8, and outputs base64
ready to embed.

CONFIGURE THE PATHS BELOW, then run directly in your IDE.
"""
import os, base64, json
import numpy as np
import netCDF4 as nc

# ════════════════════════════════════════════════════════════
#  CONFIGURE THESE
# ════════════════════════════════════════════════════════════
INPUT_NC   = r"C:\Users\P\Downloads\Extractions\currents\sea.nc"   # path to your ORAS5/CMEMS nc file
OUTPUT_DIR = r"C:\Users\P\Downloads\Extractions\currents"          # folder to write results into
# ════════════════════════════════════════════════════════════

VMAX = 2.5   # m/s clamp for quantization (covers all ocean currents)


def find_var(ds, candidates):
    """Return the first matching variable name (case-insensitive)."""
    dvars = {k.lower(): k for k in ds.variables}
    for c in candidates:
        if c.lower() in dvars:
            return dvars[c.lower()]
    return None


def process_file(fpath, out_dir):
    os.makedirs(out_dir, exist_ok=True)

    print(f"Opening: {fpath}")
    ds = nc.Dataset(fpath)
    print(f"Variables : {list(ds.variables.keys())}")
    print(f"Dimensions: {dict(ds.dimensions)}")

    # ── Find U and V ────────────────────────────────────────
    u_name = find_var(ds, [
        'vozocrtx', 'uo', 'u', 'urot', 'u_surf',
        'rotated_zonal_velocity', 'zonal_velocity', 'uo_rotated',
        'sea_water_x_velocity', 'water_u',
    ])
    v_name = find_var(ds, [
        'vomecrty', 'vo', 'v', 'vrot', 'v_surf',
        'rotated_meridional_velocity', 'meridional_velocity', 'vo_rotated',
        'sea_water_y_velocity', 'water_v',
    ])

    if u_name is None or v_name is None:
        print("\nWARNING: Could not auto-detect U/V variable names.")
        print("Available variables:", list(ds.variables.keys()))
        print("Edit the find_var() candidate lists at the top of the script.")
        ds.close()
        return None

    print(f"U variable: {u_name}")
    print(f"V variable: {v_name}")

    # ── Find lat/lon ─────────────────────────────────────────
    lat_name = find_var(ds, ['latitude', 'lat', 'nav_lat', 'y'])
    lon_name = find_var(ds, ['longitude', 'lon', 'nav_lon', 'x'])
    lat = np.array(ds.variables[lat_name][:], dtype=np.float64)
    lon = np.array(ds.variables[lon_name][:], dtype=np.float64)
    print(f"Lat shape: {lat.shape}  range: {lat.min():.3f} to {lat.max():.3f}")
    print(f"Lon shape: {lon.shape}  range: {lon.min():.3f} to {lon.max():.3f}")

    # ── Read data ─────────────────────────────────────────────
    u_var = ds.variables[u_name]
    v_var = ds.variables[v_name]
    print(f"U dims: {u_var.dimensions}  shape: {u_var.shape}")

    # Build index: take first depth level, all time, all lat/lon
    def make_index(var):
        idx = []
        for d in var.dimensions:
            dl = d.lower()
            if 'depth' in dl or 'lev' in dl or 'z' == dl:
                idx.append(0)           # surface level only
            elif 'time' in dl:
                idx.append(slice(None)) # all time steps
            else:
                idx.append(slice(None)) # all lat/lon
        return tuple(idx)

    print("Reading U...")
    u_raw = np.ma.filled(np.array(u_var[make_index(u_var)]), np.nan).astype(np.float32)
    print("Reading V...")
    v_raw = np.ma.filled(np.array(v_var[make_index(v_var)]), np.nan).astype(np.float32)

    # Mask fill values and outliers
    for arr in (u_raw, v_raw):
        arr[np.abs(arr) > 1e10] = np.nan
        arr[np.abs(arr) > 20]   = np.nan

    # Time-average if multiple steps
    if u_raw.ndim == 3:
        print(f"Averaging {u_raw.shape[0]} time steps...")
        u_mean = np.nanmean(u_raw, axis=0)
        v_mean = np.nanmean(v_raw, axis=0)
    else:
        u_mean = u_raw
        v_mean = v_raw

    print(f"U range after average: {np.nanmin(u_mean):.3f} to {np.nanmax(u_mean):.3f} m/s")
    print(f"V range after average: {np.nanmin(v_mean):.3f} to {np.nanmax(v_mean):.3f} m/s")

    # ── Resample to 1°x1° (360x180) using ACTUAL lat/lon coordinates ──
    # Previous version reshaped by raw array INDEX (sh[0]//180 row-chunks
    # starting at index 0), silently assuming the native grid spans exactly
    # -90..90. This source's native lat range is -80..90 (no data below
    # -80S — common for CMEMS surface-current products near Antarctica),
    # so that reshape put native row 0 (lat -80) into output row 0, which
    # every downstream consumer (this script's own quantizer, the HTML
    # decoder) treats as lat -89.5 — a silent ~10° north/south
    # misregistration of the entire field. It also truncated 61 native
    # rows (2041 not evenly divisible by any clean step) without accounting
    # for where they actually were.
    #
    # Fixed by binning on the real coordinate values: build the target
    # grid's bin edges from -90..90 / -180..180, use np.digitize against
    # the actual lat/lon arrays to find which output cell each native
    # pixel truly falls in, then area-average (nanmean, so partially
    # land/masked bins still average correctly over their valid pixels)
    # via a vectorized bincount-style accumulation. Correct regardless of
    # the source grid's shape, offset, or coverage gaps.
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
          f"coverage — land or outside the source's lat range, will read as 0 m/s)")

    # ── Quantize to uint8 ────────────────────────────────────
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
    print(f"\nOutput: {len(combined)} bytes -> {len(b64)} chars base64 "
          f"(~{len(b64)/1024:.0f} KB added to HTML)")

    # ── Spot-check known current locations ───────────────────
    print("\nSpot checks (should match published current speeds):")
    checks = [
        ("Gulf Stream core",          -70, 38),
        ("Kuroshio core",             140, 34),
        ("ACC / Drake Passage",       -60,-55),
        ("N Atlantic gyre (slow)",    -35, 30),
        ("Equatorial Pacific SEC",   -140,  0),
        ("NECC",                     -120,  8),
        ("Benguela Current",           15,-25),
        ("Mid-Pacific (should~0)",   -160, 20),
    ]
    for name, lon_deg, lat_deg in checks:
        ix = int((lon_deg + 180)) % 360
        iy = max(0, min(179, int(lat_deg + 90)))
        u_ms = (float(u_q[iy, ix]) - 128) / 127.5 * VMAX
        v_ms = (float(v_q[iy, ix]) - 128) / 127.5 * VMAX
        spd  = np.sqrt(u_ms**2 + v_ms**2)
        print(f"  {name:35s} ({lon_deg:7.1f}°E, {lat_deg:5.1f}°N): "
              f"u={u_ms:+.2f}  v={v_ms:+.2f}  speed={spd:.2f} m/s")

    # ── Write outputs ─────────────────────────────────────────
    b64_path  = os.path.join(out_dir, "velocity_b64.txt")
    json_path = os.path.join(out_dir, "velocity_field.json")

    with open(b64_path, 'w') as f:
        f.write(b64)
    with open(json_path, 'w') as f:
        json.dump({
            'b64'        : b64,
            'nx'         : 360,
            'ny'         : 180,
            'vmax'       : VMAX,
            'source'     : os.path.basename(fpath),
            'description': 'Surface velocity 1°x1° uint8 quantized'
        }, f)

    print(f"\nSaved base64 -> {b64_path}")
    print(f"Saved JSON   -> {json_path}")
    print("\nNext step: run embed_velocity.py")

    ds.close()
    return b64


if __name__ == "__main__":
    process_file(INPUT_NC, OUTPUT_DIR)
