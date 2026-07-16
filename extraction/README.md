# Extraction scripts — regenerating the embedded fields

The globe's built-in particle layers (ocean surface currents, ERA5 10 m
winds, 300 hPa jet stream) are **real reanalysis data**, quantized to uint8
and embedded in the HTML as base64. These scripts reproduce that pipeline so
you can refresh the fields with a different year, month or dataset.

Each field has an **extract** step (NetCDF → compact base64 + JSON metadata)
and an **embed** step (splice the base64 into the globe HTML, replacing the
previous block — the embedders are idempotent, so re-running is safe).

```
currents/  extract_velocity.py   ORAS5 / CMEMS surface velocity  → velocity_b64.txt
           embed_velocity.py     …spliced into the HTML
jet/       extract_jet.py        ERA5 300 hPa u/v (jet stream)   → jet_b64.txt
           embed_jet.py          …spliced into the HTML
wind/      extract_era5_wind.py  ERA5 10 m u/v wind              → wind_b64.txt
           embed_era5_wind.py    …spliced into the HTML
```

## Requirements

```bash
pip install numpy netCDF4
```

## Where to get the source data

| field | dataset | source |
|---|---|---|
| currents | ORAS5 or CMEMS global ocean reanalysis, surface u/v | [Copernicus Marine](https://marine.copernicus.eu/) |
| wind | ERA5 monthly means, single levels: `u10`, `v10` | [Copernicus CDS](https://cds.climate.copernicus.eu/) |
| jet | ERA5 pressure levels: u/v at 300 hPa | [Copernicus CDS](https://cds.climate.copernicus.eu/) |

Global coverage, NetCDF format. A year of monthly means is typically
8–15 MB per field.

## Workflow

1. Download the NetCDF file for the field you want to refresh.
2. Open the matching `extract_*.py`, set `INPUT_NC` / `OUTPUT_DIR` at the
   top (clearly marked `CONFIGURE THESE`), and run it. It subsamples to
   1°×1°, averages the requested months, clamps + quantizes to uint8, and
   writes `*_b64.txt` plus a `*_field.json` sidecar with the metadata.
3. Open the matching `embed_*.py`, point it at the `*_b64.txt` and at your
   globe HTML (use `dist/interactive-globe.html` built from this repo, or
   the standalone directly), and run it. It locates the previous embedded
   block and replaces it in place.
4. If you edited the standalone directly rather than the `src/` modules,
   re-split or hand-port the change back into `src/` so `build.py` output
   stays the source of truth.

The `.nc` inputs and the generated `*_b64.txt` / `*_field.json`
intermediates are deliberately **not** checked into the repo (see
`.gitignore`) — they're large and fully reproducible from the sources above.
