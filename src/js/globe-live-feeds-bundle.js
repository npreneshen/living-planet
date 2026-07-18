
/* globe-live-feeds bundle */
/* Open-Meteo API bundles, models, bbox, pressure levels, 15-min data */
window.OpenMeteo = (() => {
  "use strict";

  const WEATHER_MODELS = [
    { id: "best_match", label: "Best match (auto)", bbox: false, resDeg: null },
    { id: "ecmwf_ifs", label: "ECMWF IFS (~9 km)", bbox: true, resDeg: 0.1 },
    { id: "icon_global", label: "DWD ICON Global", bbox: true, resDeg: 0.13 },
    { id: "gfs_global", label: "NOAA GFS Global", bbox: false, resDeg: 0.25 },
    { id: "gem_global", label: "GEM Canada Global", bbox: true, resDeg: 0.15 },
    { id: "bom_access_global", label: "BOM ACCESS Global", bbox: true, resDeg: 0.2 },
    { id: "ukmo_global_deterministic_10km", label: "UK Met Office 10 km", bbox: true, resDeg: 0.1 },
    { id: "cma_grapes_global", label: "CMA GRAPES Global", bbox: true, resDeg: 0.12 },
    { id: "icon_eu", label: "DWD ICON EU", bbox: false, resDeg: 0.06 },
    { id: "icon_d2", label: "DWD ICON D2 (Central EU)", bbox: false, resDeg: 0.02 },
    { id: "meteofrance_arome_france", label: "Météo-France AROME", bbox: false, resDeg: 0.01 },
    { id: "jma_gsm", label: "JMA GSM", bbox: false, resDeg: 0.2 },
    { id: "metno_nordic", label: "MET Norway Nordic", bbox: false, resDeg: 0.05 },
  ];

  const PRESSURE_LEVELS = [1000, 850, 700, 500, 300, 250, 200];

  const FORECAST_CURRENT = [
    "temperature_2m", "relative_humidity_2m", "dew_point_2m", "apparent_temperature",
    "precipitation", "weather_code", "surface_pressure", "cloud_cover",
    "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
  ].join(",");

  const FORECAST_HOURLY = [
    "temperature_2m", "relative_humidity_2m", "dew_point_2m", "apparent_temperature",
    "precipitation_probability", "precipitation", "rain", "showers", "snowfall", "snow_depth",
    "weather_code", "surface_pressure", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "cloud_cover",
    "visibility", "evapotranspiration", "et0_fao_evapotranspiration", "vapour_pressure_deficit",
    "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
    "wind_speed_80m", "wind_speed_120m", "temperature_80m", "temperature_120m",
    "shortwave_radiation", "direct_radiation", "diffuse_radiation",
    "soil_temperature_0cm", "soil_temperature_6cm", "soil_temperature_18cm",
    "soil_moisture_0_to_1cm", "soil_moisture_1_to_3cm", "soil_moisture_3_to_9cm",
  ].join(",");

  const FORECAST_PRESSURE_HOURLY = PRESSURE_LEVELS.flatMap((hPa) => [
    `temperature_${hPa}hPa`,
    `wind_speed_${hPa}hPa`,
    `wind_direction_${hPa}hPa`,
    `geopotential_height_${hPa}hPa`,
    `relative_humidity_${hPa}hPa`,
  ]).join(",");

  const FORECAST_MINUTELY_15 = [
    "temperature_2m", "relative_humidity_2m", "dew_point_2m", "apparent_temperature",
    "precipitation", "rain", "snowfall", "weather_code",
    "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
    "shortwave_radiation", "direct_radiation", "diffuse_radiation",
  ].join(",");

  const FORECAST_DAILY = [
    "weather_code", "temperature_2m_max", "temperature_2m_min",
    "precipitation_sum", "rain_sum", "showers_sum", "snowfall_sum",
    "wind_speed_10m_max", "wind_gusts_10m_max", "wind_direction_10m_dominant",
    "sunrise", "sunset", "daylight_duration",
  ].join(",");

  const FORECAST_CURRENT_LITE = [
    "temperature_2m", "relative_humidity_2m", "apparent_temperature",
    "precipitation", "weather_code", "surface_pressure", "cloud_cover",
    "wind_speed_10m", "wind_gusts_10m",
  ].join(",");

  const BBOX_HOURLY_LITE = "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,surface_pressure";

  const AQ_CURRENT = "us_aqi,european_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,ozone,dust,uv_index";
  const AQ_HOURLY = "us_aqi,european_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,dust,uv_index";
  const AQ_CURRENT_LITE = "us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide";

  const MARINE_CURRENT = "wave_height,wave_direction,wave_period,sea_surface_temperature,ocean_current_velocity";
  const MARINE_HOURLY = "wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,sea_surface_temperature,ocean_current_velocity";

  const ARCHIVE_DAILY = [
    "temperature_2m_max", "temperature_2m_min", "temperature_2m_mean",
    "apparent_temperature_max", "apparent_temperature_min",
    "precipitation_sum", "rain_sum", "snowfall_sum", "precipitation_hours",
    "wind_speed_10m_max", "wind_gusts_10m_max",
    "shortwave_radiation_sum", "et0_fao_evapotranspiration", "sunshine_duration",
  ].join(",");

  const COLORS = ["#fbbf24", "#fb923c", "#f87171", "#60a5fa", "#38bdf8", "#4ade80", "#a78bfa", "#f472b6"];

  function modelById(id) {
    return WEATHER_MODELS.find((m) => m.id === id) || WEATHER_MODELS[0];
  }

  function estimateBboxCells(bbox, modelId) {
    const m = modelById(modelId);
    const res = m.resDeg || 0.25;
    const latCells = Math.max(1, Math.ceil((bbox.north - bbox.south) / res));
    const lonCells = Math.max(1, Math.ceil((bbox.east - bbox.west) / res));
    return latCells * lonCells;
  }

  function series(times, values, gc) {
    return gc.hourlySeries(times, values);
  }

  function tab(id, label, unit, seriesList, extra = {}) {
    return { id, label, unit, series: seriesList, dualAxis: extra.dualAxis !== false, yLabelRight: extra.yLabelRight };
  }

  function line(label, points, color, yAxis) {
    const s = { label, points, color };
    if (yAxis) s.yAxis = yAxis;
    return s;
  }

  function buildForecastParams(opts = {}) {
    const full = opts.full !== false;
    const params = {
      forecast_days: opts.forecastDays ?? 16,
      past_days: opts.pastDays ?? 7,
      current: opts.lite ? FORECAST_CURRENT_LITE : FORECAST_CURRENT,
      hourly: opts.lite ? BBOX_HOURLY_LITE : FORECAST_HOURLY,
      daily: opts.lite ? undefined : FORECAST_DAILY,
    };
    if (opts.bbox) {
      params.timezone = "GMT";
    } else {
      params.timezone = "auto";
    }
    if (full && !opts.lite) {
      params.hourly = `${FORECAST_HOURLY},${FORECAST_PRESSURE_HOURLY}`;
      params.minutely_15 = FORECAST_MINUTELY_15;
      params.forecast_minutely_15 = opts.forecastMinutely15 ?? 96;
      params.past_minutely_15 = opts.pastMinutely15 ?? 96;
    }
    const model = opts.model;
    if (model && model !== "best_match") params.models = model;
    if (opts.bbox) {
      const { south, west, north, east } = opts.bbox;
      params.bounding_box = `${south},${west},${north},${east}`;
    } else {
      params.latitude = opts.lat;
      params.longitude = opts.lon;
    }
    for (const k of Object.keys(params)) {
      if (params[k] === undefined) delete params[k];
    }
    return params;
  }

  function buildMinutely15Charts(wx, gc) {
    const m = wx?.minutely_15;
    if (!m?.time?.length) return [];
    return [
      tab("m15temp", "15-min temperature", "°C", [
        line("2 m", series(m.time, m.temperature_2m, gc), "#fbbf24"),
        line("Feels like", series(m.time, m.apparent_temperature, gc), "#fb923c"),
        line("Dew point", series(m.time, m.dew_point_2m, gc), "#60a5fa"),
      ]),
      tab("m15precip", "15-min precipitation", "mm", [
        line("Total", series(m.time, m.precipitation, gc), "#38bdf8"),
        line("Rain", series(m.time, m.rain, gc), "#3b82f6"),
        line("Snow", series(m.time, m.snowfall, gc), "#e2e8f0"),
      ]),
      tab("m15wind", "15-min wind", "km/h", [
        line("Speed", series(m.time, m.wind_speed_10m, gc), "#4ade80"),
        line("Gusts", series(m.time, m.wind_gusts_10m, gc), "#22c55e"),
      ]),
      tab("m15solar", "15-min solar", "W/m²", [
        line("Shortwave", series(m.time, m.shortwave_radiation, gc), "#fbbf24"),
        line("Direct", series(m.time, m.direct_radiation, gc), "#f59e0b"),
        line("Diffuse", series(m.time, m.diffuse_radiation, gc), "#fcd34d"),
      ]),
    ];
  }

  function buildPressureCharts(wx, gc) {
    const h = wx?.hourly;
    if (!h?.time?.length) return [];
    const tabs = [];
    const tempSeries = PRESSURE_LEVELS.map((hPa, i) =>
      line(`${hPa} hPa`, series(h.time, h[`temperature_${hPa}hPa`], gc), COLORS[i % COLORS.length])
    ).filter((s) => s.points.length);
    if (tempSeries.length) {
      tabs.push(tab("pltemp", "Pressure-level temperature", "°C", tempSeries));
    }
    const windSeries = [850, 500, 300].map((hPa, i) =>
      line(`${hPa} hPa`, series(h.time, h[`wind_speed_${hPa}hPa`], gc), COLORS[i % COLORS.length])
    ).filter((s) => s.points.length);
    if (windSeries.length) {
      tabs.push(tab("plwind", "Pressure-level wind", "km/h", windSeries));
    }
    const ghSeries = [850, 500, 300].map((hPa, i) =>
      line(`${hPa} hPa`, series(h.time, h[`geopotential_height_${hPa}hPa`], gc), COLORS[i % COLORS.length])
    ).filter((s) => s.points.length);
    if (ghSeries.length) {
      tabs.push(tab("plheight", "Geopotential height", "m", ghSeries));
    }
    const rhSeries = [1000, 850, 700, 500].map((hPa, i) =>
      line(`${hPa} hPa`, series(h.time, h[`relative_humidity_${hPa}hPa`], gc), COLORS[i % COLORS.length])
    ).filter((s) => s.points.length);
    if (rhSeries.length) {
      tabs.push(tab("plrh", "Pressure-level humidity", "%", rhSeries));
    }
    return tabs;
  }

  function buildWeatherCharts(wx, archive, gc) {
    const tabs = [];
    const h = wx?.hourly;
    const d = wx?.daily;
    if (!h?.time?.length) return tabs;

    tabs.push(tab("temp", "Temperature (hourly)", "°C", [
      line("2 m", series(h.time, h.temperature_2m, gc), "#fbbf24"),
      line("Feels like", series(h.time, h.apparent_temperature, gc), "#fb923c"),
      line("Dew point", series(h.time, h.dew_point_2m, gc), "#60a5fa"),
      line("80 m", series(h.time, h.temperature_80m, gc), "#f87171"),
      line("120 m", series(h.time, h.temperature_120m, gc), "#dc2626"),
    ]));

    tabs.push(tab("humidity", "Humidity & pressure", "%", [
      line("Humidity", series(h.time, h.relative_humidity_2m, gc), "#38bdf8", "left"),
      line("Pressure", series(h.time, h.surface_pressure, gc), "#a78bfa", "right"),
    ], { yLabelRight: "hPa" }));

    tabs.push(tab("precip", "Precipitation", "mm", [
      line("Total", series(h.time, h.precipitation, gc), "#38bdf8"),
      line("Rain", series(h.time, h.rain, gc), "#3b82f6"),
      line("Showers", series(h.time, h.showers, gc), "#60a5fa"),
      line("Snow", series(h.time, h.snowfall, gc), "#e2e8f0"),
    ]));

    if (h.precipitation_probability) {
      tabs.push(tab("precipprob", "Precip probability", "%", [
        line("Probability", series(h.time, h.precipitation_probability, gc), "#818cf8"),
      ]));
    }

    tabs.push(tab("wind", "Wind", "km/h", [
      line("Speed 10 m", series(h.time, h.wind_speed_10m, gc), "#4ade80"),
      line("Speed 80 m", series(h.time, h.wind_speed_80m, gc), "#22c55e"),
      line("Speed 120 m", series(h.time, h.wind_speed_120m, gc), "#16a34a"),
      line("Gusts", series(h.time, h.wind_gusts_10m, gc), "#86efac"),
    ]));

    tabs.push(tab("cloud", "Cloud & visibility", "%", [
      line("Total", series(h.time, h.cloud_cover, gc), "#94a3b8", "left"),
      line("Low", series(h.time, h.cloud_cover_low, gc), "#64748b", "left"),
      line("Mid", series(h.time, h.cloud_cover_mid, gc), "#475569", "left"),
      line("High", series(h.time, h.cloud_cover_high, gc), "#cbd5e1", "left"),
      line("Visibility", series(h.time, h.visibility, gc), "#e2e8f0", "right"),
    ], { yLabelRight: "km" }));

    if (h.shortwave_radiation) {
      tabs.push(tab("solar", "Solar radiation", "W/m²", [
        line("Shortwave", series(h.time, h.shortwave_radiation, gc), "#fbbf24"),
        line("Direct", series(h.time, h.direct_radiation, gc), "#f59e0b"),
        line("Diffuse", series(h.time, h.diffuse_radiation, gc), "#fcd34d"),
      ]));
    }

    if (h.snow_depth || h.snowfall) {
      tabs.push(tab("snow", "Snow", "cm", [
        line("Snowfall", series(h.time, h.snowfall, gc), "#e2e8f0", "left"),
        line("Snow depth", series(h.time, h.snow_depth, gc), "#94a3b8", "right"),
      ], { yLabelRight: "m" }));
    }

    if (h.evapotranspiration || h.vapour_pressure_deficit) {
      tabs.push(tab("evap", "Evapotranspiration & VPD", "mm", [
        line("Evapotransp.", series(h.time, h.evapotranspiration, gc), "#4ade80", "left"),
        line("ET₀ FAO", series(h.time, h.et0_fao_evapotranspiration, gc), "#22c55e", "left"),
        line("VPD", series(h.time, h.vapour_pressure_deficit, gc), "#f472b6", "right"),
      ], { yLabelRight: "kPa" }));
    }

    if (h.soil_temperature_0cm || h.soil_moisture_0_to_1cm) {
      tabs.push(tab("soil", "Soil", "°C", [
        line("Temp 0 cm", series(h.time, h.soil_temperature_0cm, gc), "#ea580c", "left"),
        line("Temp 6 cm", series(h.time, h.soil_temperature_6cm, gc), "#c2410c", "left"),
        line("Temp 18 cm", series(h.time, h.soil_temperature_18cm, gc), "#9a3412", "left"),
        line("Moist 0–1 cm", series(h.time, h.soil_moisture_0_to_1cm, gc), "#854d0e", "right"),
        line("Moist 1–3 cm", series(h.time, h.soil_moisture_1_to_3cm, gc), "#713f12", "right"),
        line("Moist 3–9 cm", series(h.time, h.soil_moisture_3_to_9cm, gc), "#5c3310", "right"),
      ], { yLabelRight: "m³/m³" }));
    }

    if (d?.time?.length) {
      tabs.push(tab("daily", "Daily summary", "°C", [
        line("Max temp", gc.dailySeries(d.time, d.temperature_2m_max), "#f87171", "left"),
        line("Min temp", gc.dailySeries(d.time, d.temperature_2m_min), "#60a5fa", "left"),
        line("Precip sum", gc.dailySeries(d.time, d.precipitation_sum), "#38bdf8", "right"),
      ], { yLabelRight: "mm" }));
    }

    if (archive?.daily?.time?.length) {
      const ad = archive.daily;
      tabs.push(tab("archive-temp", "History — temperature", "°C", [
        line("Max", gc.dailySeries(ad.time, ad.temperature_2m_max), "#f87171"),
        line("Mean", gc.dailySeries(ad.time, ad.temperature_2m_mean), "#fbbf24"),
        line("Min", gc.dailySeries(ad.time, ad.temperature_2m_min), "#60a5fa"),
        line("Feels max", gc.dailySeries(ad.time, ad.apparent_temperature_max), "#fb923c"),
        line("Feels min", gc.dailySeries(ad.time, ad.apparent_temperature_min), "#818cf8"),
      ]));
      tabs.push(tab("archive-precip", "History — precipitation", "mm", [
        line("Precip sum", gc.dailySeries(ad.time, ad.precipitation_sum), "#38bdf8", "left"),
        line("Rain", gc.dailySeries(ad.time, ad.rain_sum), "#3b82f6", "left"),
        line("Snow", gc.dailySeries(ad.time, ad.snowfall_sum), "#e2e8f0", "left"),
        line("Precip hours", gc.dailySeries(ad.time, ad.precipitation_hours), "#818cf8", "right"),
      ], { yLabelRight: "h" }));
      tabs.push(tab("archive-wind", "History — wind", "km/h", [
        line("Speed max", gc.dailySeries(ad.time, ad.wind_speed_10m_max), "#4ade80"),
        line("Gusts max", gc.dailySeries(ad.time, ad.wind_gusts_10m_max), "#86efac"),
      ]));
      tabs.push(tab("archive-solar", "History — solar & ET", "MJ/m²", [
        line("Shortwave sum", gc.dailySeries(ad.time, ad.shortwave_radiation_sum), "#fbbf24", "left"),
        line("ET₀ FAO", gc.dailySeries(ad.time, ad.et0_fao_evapotranspiration), "#22c55e", "right"),
      ], { yLabelRight: "mm" }));
    }

    tabs.push(...buildMinutely15Charts(wx, gc));
    tabs.push(...buildPressureCharts(wx, gc));
    return tabs;
  }

  function buildAirQualityCharts(aq, gc) {
    const h = aq?.hourly;
    if (!h?.time?.length) return [];
    return [
      tab("aqi", "Air quality index", "AQI", [
        line("US AQI", series(h.time, h.us_aqi, gc), "#38bdf8"),
        line("European AQI", series(h.time, h.european_aqi, gc), "#818cf8"),
      ]),
      tab("pm", "Particulates", "µg/m³", [
        line("PM2.5", series(h.time, h.pm2_5, gc), "#f472b6"),
        line("PM10", series(h.time, h.pm10, gc), "#fb7185"),
        line("Dust", series(h.time, h.dust, gc), "#d97706"),
      ]),
      tab("gases", "Gases & ozone", "µg/m³", [
        line("O₃", series(h.time, h.ozone, gc), "#4ade80"),
        line("NO₂", series(h.time, h.nitrogen_dioxide, gc), "#a78bfa"),
        line("SO₂", series(h.time, h.sulphur_dioxide, gc), "#facc15"),
        line("CO", series(h.time, h.carbon_monoxide, gc), "#94a3b8"),
      ]),
      tab("uv", "UV index", "", [
        line("UV", series(h.time, h.uv_index, gc), "#fbbf24"),
      ]),
    ];
  }

  function buildMarineCharts(marine, gc) {
    const h = marine?.hourly;
    if (!h?.time?.length) return [];
    return [
      tab("waves", "Waves", "m", [
        line("Wave height", series(h.time, h.wave_height, gc), "#38bdf8"),
        line("Swell height", series(h.time, h.swell_wave_height, gc), "#60a5fa"),
      ]),
      tab("period", "Wave period", "s", [
        line("Wave period", series(h.time, h.wave_period, gc), "#4ade80"),
        line("Swell period", series(h.time, h.swell_wave_period, gc), "#22c55e"),
      ]),
      tab("sst", "Sea surface temp", "°C", [
        line("SST", series(h.time, h.sea_surface_temperature, gc), "#f472b6"),
      ]),
      tab("current", "Ocean current", "km/h", [
        line("Current", series(h.time, h.ocean_current_velocity, gc), "#a78bfa"),
      ]),
    ];
  }

  function buildAllCharts(wx, archive, aq, marine, gc) {
    return [
      ...buildWeatherCharts(wx, archive, gc),
      ...buildAirQualityCharts(aq, gc),
      ...buildMarineCharts(marine, gc),
    ];
  }

  function summarizeCurrent(cur) {
    if (!cur) return {};
    return {
      temp: cur.temperature_2m,
      feelsLike: cur.apparent_temperature,
      humidity: cur.relative_humidity_2m,
      dewPoint: cur.dew_point_2m,
      precip: cur.precipitation,
      pressure: cur.surface_pressure,
      cloud: cur.cloud_cover,
      wind: cur.wind_speed_10m,
      windDir: cur.wind_direction_10m,
      gusts: cur.wind_gusts_10m,
      weatherCode: cur.weather_code,
      time: cur.time ? new Date(cur.time).getTime() : null,
    };
  }

  function summarizeAq(cur) {
    if (!cur) return {};
    return {
      aqi: cur.us_aqi,
      euAqi: cur.european_aqi,
      pm25: cur.pm2_5,
      pm10: cur.pm10,
      ozone: cur.ozone,
      no2: cur.nitrogen_dioxide,
      co: cur.carbon_monoxide,
      dust: cur.dust,
      uv: cur.uv_index,
      time: cur.time ? new Date(cur.time).getTime() : null,
    };
  }

  function normGridCell(row, model) {
    const s = summarizeCurrent(row?.current);
    return {
      kind: "weathergrid",
      id: `wxgrid-${row.latitude?.toFixed(3)}-${row.longitude?.toFixed(3)}`,
      name: `${row.latitude?.toFixed(2)}, ${row.longitude?.toFixed(2)}`,
      lat: row.latitude,
      lon: row.longitude,
      model: model || row.model || null,
      elevation: row.elevation,
      ...s,
      forecast: row,
      time: s.time,
    };
  }

  async function fetchForecast(api, opts = {}) {
    return api("openmeteo", "/v1/forecast", buildForecastParams(opts));
  }

  async function fetchForecastFull(api, lat, lon, opts = {}) {
    return fetchForecast(api, { ...opts, lat, lon, full: true, lite: false });
  }

  async function fetchBboxGrid(api, bbox, model, opts = {}) {
    const m = modelById(model);
    if (!m.bbox) throw new Error(`Model "${m.label}" does not support bounding_box. Pick ECMWF, ICON Global, GEM, etc.`);
    const est = estimateBboxCells(bbox, model);
    if (est > 1000) throw new Error(`BBox ~${est} cells (max 1000). Draw a smaller box or pick a coarser model.`);
    const data = await fetchForecast(api, {
      bbox, model, lite: true, full: false,
      forecastDays: opts.forecastDays ?? 2,
      pastDays: opts.pastDays ?? 1,
    });
    const rows = Array.isArray(data) ? data : [data];
    return rows.map((row) => normGridCell(row, model));
  }

  async function fetchAirQualityFull(api, lat, lon, opts = {}) {
    return api("openmeteoAq", "/v1/air-quality", {
      latitude: lat, longitude: lon,
      current: AQ_CURRENT, hourly: AQ_HOURLY,
      timezone: "auto",
      forecast_days: opts.forecastDays ?? 5,
      past_days: opts.pastDays ?? 7,
    });
  }

  async function fetchMarineFull(api, lat, lon, opts = {}) {
    return api("openmeteoMarine", "/v1/marine", {
      latitude: lat, longitude: lon,
      current: MARINE_CURRENT, hourly: MARINE_HOURLY,
      timezone: "auto",
      forecast_days: opts.forecastDays ?? 7,
      past_days: opts.pastDays ?? 3,
    });
  }

  async function fetchArchive(api, lat, lon, days = 30) {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    return api("openmeteoArchive", "/v1/archive", {
      latitude: lat, longitude: lon,
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
      daily: ARCHIVE_DAILY, timezone: "auto",
    });
  }

  function getSelectedModel(selectEl) {
    return selectEl?.value || "best_match";
  }

  async function fetchPointBundle(api, lat, lon, opts = {}) {
    const model = opts.model;
    const [weather, airQuality, marine] = await Promise.all([
      fetchForecastFull(api, lat, lon, { forecastDays: 7, pastDays: 7, model }),
      fetchAirQualityFull(api, lat, lon).catch(() => null),
      fetchMarineFull(api, lat, lon, { forecastDays: 7, pastDays: 3 }).catch(() => null),
    ]);
    return { weather, airQuality, marine, lat, lon, model };
  }

  return {
    WEATHER_MODELS, PRESSURE_LEVELS,
    FORECAST_CURRENT, FORECAST_CURRENT_LITE, FORECAST_HOURLY, FORECAST_DAILY,
    FORECAST_PRESSURE_HOURLY, FORECAST_MINUTELY_15,
    AQ_CURRENT, AQ_CURRENT_LITE, AQ_HOURLY,
    MARINE_CURRENT, MARINE_HOURLY, ARCHIVE_DAILY,
    modelById, estimateBboxCells, getSelectedModel, normGridCell,
    buildWeatherCharts, buildMinutely15Charts, buildPressureCharts,
    buildAirQualityCharts, buildMarineCharts, buildAllCharts,
    summarizeCurrent, summarizeAq,
    fetchForecast, fetchForecastFull, fetchBboxGrid,
    fetchAirQualityFull, fetchMarineFull, fetchArchive, fetchPointBundle,
  };
})();

/* CORS-direct global layer fetchers — browser fetch only, no proxy */
window.GlobalLayers = (() => {
  "use strict";

  const WORLD_CITIES = [
    ["New York", 40.71, -74.01], ["Los Angeles", 34.05, -118.24], ["Chicago", 41.88, -87.63],
    ["London", 51.51, -0.13], ["Paris", 48.86, 2.35], ["Berlin", 52.52, 13.41],
    ["Madrid", 40.42, -3.70], ["Rome", 41.90, 12.50], ["Moscow", 55.76, 37.62],
    ["Istanbul", 41.01, 28.98], ["Cairo", 30.04, 31.24], ["Lagos", 6.52, 3.38],
    ["Nairobi", -1.29, 36.82], ["Johannesburg", -26.20, 28.04], ["Dubai", 25.20, 55.27],
    ["Mumbai", 19.08, 72.88], ["Delhi", 28.61, 77.21], ["Bangkok", 13.76, 100.50],
    ["Singapore", 1.35, 103.82], ["Jakarta", -6.21, 106.85], ["Beijing", 39.90, 116.41],
    ["Shanghai", 31.23, 121.47], ["Tokyo", 35.68, 139.69], ["Seoul", 37.57, 126.98],
    ["Sydney", -33.87, 151.21], ["Melbourne", -37.81, 144.96], ["São Paulo", -23.55, -46.63],
    ["Mexico City", 19.43, -99.13], ["Buenos Aires", -34.60, -58.38], ["Toronto", 43.65, -79.38],
    ["Vancouver", 49.28, -123.12], ["Reykjavik", 64.15, -21.94], ["Oslo", 59.91, 10.75],
    ["Stockholm", 59.33, 18.07], ["Helsinki", 60.17, 24.94], ["Anchorage", 61.22, -149.90],
    ["Honolulu", 21.31, -157.86], ["Miami", 25.76, -80.19], ["San Francisco", 37.77, -122.42],
    ["Lima", -12.05, -77.04], ["Bogotá", 4.71, -74.07], ["Santiago", -33.45, -70.67],
    ["Cape Town", -33.92, 18.42], ["Casablanca", 33.57, -7.59], ["Tehran", 35.69, 51.39],
    ["Karachi", 24.86, 67.00], ["Dhaka", 23.81, 90.41], ["Manila", 14.60, 120.98],
    ["Taipei", 25.03, 121.57], ["Hong Kong", 22.32, 114.17], ["Auckland", -36.85, 174.76],
  ];

  const COASTAL_CITIES = [
    ["Honolulu", 21.31, -157.86], ["San Francisco", 37.77, -122.42], ["Los Angeles", 33.74, -118.27],
    ["Miami", 25.76, -80.19], ["New York", 40.58, -73.94], ["Vancouver", 49.28, -123.12],
    ["Sydney", -33.87, 151.21], ["Melbourne", -37.81, 144.96], ["Tokyo", 35.45, 139.77],
    ["Oslo", 59.91, 10.75], ["Reykjavik", 64.15, -21.94], ["Lisbon", 38.72, -9.14],
    ["Barcelona", 41.39, 2.20], ["Athens", 37.94, 23.64], ["Istanbul", 41.01, 29.01],
    ["Dubai", 25.27, 55.30], ["Mumbai", 18.94, 72.83], ["Singapore", 1.26, 103.85],
    ["Jakarta", -6.12, 106.85], ["Manila", 14.58, 120.97], ["Auckland", -36.84, 174.77],
    ["Cape Town", -33.90, 18.42], ["Rio de Janeiro", -22.91, -43.17], ["Buenos Aires", -34.61, -58.37],
    ["Anchorage", 61.22, -149.90], ["Seattle", 47.61, -122.34], ["Boston", 42.36, -71.06],
  ];

  function bboxCentroid(bbox) {
    if (!bbox || bbox.length < 4) return null;
    return { lon: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2 };
  }

  function ringCentroid(ring) {
    if (!ring?.length) return null;
    let lat = 0, lon = 0, n = 0;
    for (const c of ring) {
      if (!Array.isArray(c) || c.length < 2) continue;
      lon += c[0]; lat += c[1]; n++;
    }
    return n ? { lon: lon / n, lat: lat / n } : null;
  }

  function geomCentroid(geom) {
    if (!geom) return null;
    if (geom.type === "Point") return { lon: geom.coordinates[0], lat: geom.coordinates[1] };
    if (geom.type === "Polygon" && geom.coordinates?.[0]) return ringCentroid(geom.coordinates[0]);
    if (geom.type === "MultiPolygon" && geom.coordinates?.[0]?.[0]) return ringCentroid(geom.coordinates[0][0]);
    return null;
  }

  function normQuake(feature) {
    const p = feature.properties || {};
    const [lon, lat, depth] = feature.geometry?.coordinates || [0, 0, 0];
    return {
      kind: "earthquake",
      id: p.id || feature.id || `eq-${p.time}-${lat}`,
      title: p.title || p.place || "Earthquake",
      lat, lon, depth, mag: p.mag ?? null,
      time: p.time ? new Date(p.time).getTime() : null,
      place: p.place || "", url: p.url || "", alert: p.alert || "",
      tsunami: p.tsunami || 0, sig: p.sig || 0, raw: feature,
    };
  }

  function normVolcano(raw, status = {}) {
    const lat = parseFloat(raw.latitude ?? raw.lat ?? status.lat);
    const lon = parseFloat(raw.longitude ?? raw.long ?? status.long);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const vnum = String(raw.vnum || status.vnum || "");
    const alertLevel = status.alertLevel || raw.alertLevel || null;
    const colorCode = status.colorCode || raw.colorCode || null;
    const elevated = alertLevel && !/NORMAL|UNASSIGNED/i.test(alertLevel)
      && colorCode && !/GREEN|UNASSIGNED/i.test(colorCode);
    return {
      kind: "volcano", id: `volcano-${vnum}`,
      name: raw.vName || raw.volcanoName || status.vName || vnum,
      vnum, country: raw.country || "", region: raw.subregion || status.region || "",
      lat, lon, elevation: raw.elevation_m ?? null,
      alertLevel, colorCode, monitored: !!(alertLevel || status.obs),
      elevated: !!elevated, threat: status.nvewsThreat || null,
      synopsis: status.noticeSynopsis || null,
      url: status.volcanoUrl || raw.volcanoUrl || raw.webpage || "",
      noticeUrl: status.noticeUrl || null, raw,
    };
  }

  function isElevatedVolcano(v) {
    return v.elevated || (v.colorCode && /ORANGE|RED/i.test(v.colorCode))
      || (v.alertLevel && /WATCH|WARNING|ADVISORY/i.test(v.alertLevel));
  }

  function batchCoords(cities) {
    return {
      lats: cities.map((c) => c[1]).join(","),
      lons: cities.map((c) => c[2]).join(","),
    };
  }

  const QUAKE_PERIOD_DAYS = { day: 1, week: 7, month: 30 };
  const QUAKE_SUMMARY_FEEDS = new Set([
    "1.0_day", "1.0_week", "1.0_month",
    "2.5_day", "2.5_week", "2.5_month",
    "4.5_day", "4.5_week", "4.5_month",
  ]);

  async function fetchEarthquakes(api, opts) {
    const feedId = `${opts.mag}_${opts.period}`;
    const periodDays = QUAKE_PERIOD_DAYS[opts.period] || 7;
    const minMag = parseFloat(opts.minMag ?? opts.mag) || 0;
    let data;
    if (opts.useCustom || !QUAKE_SUMMARY_FEEDS.has(feedId)) {
      const end = new Date();
      const start = new Date(end.getTime() - (opts.days || periodDays) * 86400000);
      data = await api("earthquake", "/fdsnws/event/1/query", {
        format: "geojson",
        starttime: start.toISOString().slice(0, 19),
        endtime: end.toISOString().slice(0, 19),
        minmagnitude: minMag,
        orderby: "time",
        limit: 20000,
      });
    } else {
      try {
        data = await api("earthquake", `/earthquakes/feed/v1.0/summary/${feedId}.geojson`, {});
      } catch (err) {
        const end = new Date();
        const start = new Date(end.getTime() - periodDays * 86400000);
        data = await api("earthquake", "/fdsnws/event/1/query", {
          format: "geojson",
          starttime: start.toISOString().slice(0, 19),
          endtime: end.toISOString().slice(0, 19),
          minmagnitude: minMag,
          orderby: "time",
          limit: 20000,
        });
      }
    }
    const items = new Map();
    for (const f of data?.features || []) {
      const e = normQuake(f);
      items.set(e.id, e);
    }
    return items;
  }

  async function fetchRegionalQuakes(api, lat, lon, opts = {}) {
    const days = opts.days || 30;
    const radius = opts.radiusKm || 100;
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const data = await api("earthquake", "/fdsnws/event/1/query", {
      format: "geojson",
      starttime: start.toISOString().slice(0, 19),
      endtime: end.toISOString().slice(0, 19),
      latitude: lat, longitude: lon, maxradiuskm: radius,
      minmagnitude: opts.minMag ?? 2,
      orderby: "time",
    });
    return (data?.features || []).map(normQuake);
  }

  async function fetchVolcanoes(api, opts) {
    const [gvp, statusGeo] = await Promise.all([
      api("volcanoes", "/vsc/api/volcanoApi/volcanoesGVP", {}),
      api("volcanoes", "/vsc/api/volcanoApi/geojson", {}).catch(() => ({ features: [] })),
    ]);
    const statusByVnum = {};
    for (const f of statusGeo?.features || []) {
      const p = f.properties || {};
      if (p.vnum) statusByVnum[p.vnum] = {
        ...p, lat: f.geometry?.coordinates?.[1], long: f.geometry?.coordinates?.[0],
      };
    }
    const items = new Map();
    for (const raw of Array.isArray(gvp) ? gvp : []) {
      const v = normVolcano(raw, statusByVnum[raw.vnum] || {});
      if (!v) continue;
      if (opts.filter === "monitored" && !v.monitored) continue;
      if (opts.filter === "elevated" && !isElevatedVolcano(v)) continue;
      items.set(v.id, v);
    }
    return items;
  }

  async function fetchTsunami(api) {
    const items = new Map();
    const [hist, alerts] = await Promise.all([
      api("ncei", "/arcgis/rest/services/web_mercator/hazards/MapServer/0/query", {
        where: "YEAR>=2000", outFields: "ID,YEAR,MONTH,DAY,LOCATION_NAME,TS_INTENSITY,CAUSE,EVENT_VALIDITY",
        returnGeometry: true, resultRecordCount: 500, f: "geojson",
      }).catch(() => ({ features: [] })),
      api("nws", "/alerts/active", { event: "Tsunami Warning,Tsunami Advisory,Tsunami Watch" })
        .catch(() => ({ features: [] })),
    ]);
    for (const f of hist?.features || []) {
      const p = f.properties || {};
      const [lon, lat] = f.geometry?.coordinates || [];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const id = `tsunami-${p.ID || p.YEAR}-${lat}`;
      items.set(id, {
        kind: "tsunami", id,
        name: p.LOCATION_NAME || `Tsunami ${p.YEAR}`,
        lat, lon, year: p.YEAR, month: p.MONTH, day: p.DAY,
        intensity: p.TS_INTENSITY, cause: p.CAUSE, validity: p.EVENT_VALIDITY,
        source: "NCEI", time: p.YEAR ? new Date(p.YEAR, (p.MONTH || 1) - 1, p.DAY || 1).getTime() : null,
        raw: p,
      });
    }
    for (const f of alerts?.features || []) {
      const p = f.properties || {};
      const c = geomCentroid(f.geometry);
      if (!c) continue;
      const id = `tsunami-alert-${p.id || p.sent}`;
      items.set(id, {
        kind: "tsunami", id,
        name: p.event || p.headline || "Active tsunami alert",
        lat: c.lat, lon: c.lon, severity: p.severity, urgency: p.urgency,
        source: "NWS", active: true,
        time: p.sent ? new Date(p.sent).getTime() : Date.now(),
        raw: p, geometry: f.geometry,
      });
    }
    return items;
  }

  async function fetchNwsAlerts(api) {
    const data = await api("nws", "/alerts/active", {});
    const items = new Map();
    for (const f of data?.features || []) {
      const p = f.properties || {};
      const c = geomCentroid(f.geometry);
      if (!c) continue;
      const id = `nws-${p.id || p.sent}`;
      items.set(id, {
        kind: "nwsalert", id,
        name: p.headline || p.event || "Weather alert",
        event: p.event, severity: p.severity, urgency: p.urgency,
        lat: c.lat, lon: c.lon,
        area: p.areaDesc, sender: p.senderName,
        time: p.sent ? new Date(p.sent).getTime() : null,
        expires: p.expires ? new Date(p.expires).getTime() : null,
        description: p.description, instruction: p.instruction,
        geometry: f.geometry, raw: p,
      });
    }
    return items;
  }

  async function fetchAirQuality(api) {
    const { lats, lons } = batchCoords(WORLD_CITIES);
    const om = window.OpenMeteo;
    const data = await api("openmeteoAq", "/v1/air-quality", {
      latitude: lats, longitude: lons,
      current: om.AQ_CURRENT_LITE,
    });
    const rows = Array.isArray(data) ? data : [data];
    const items = new Map();
    rows.forEach((row, i) => {
      const city = WORLD_CITIES[i];
      if (!city) return;
      const [, lat, lon] = city;
      const aq = om.summarizeAq(row?.current);
      items.set(`aq-${city[0]}`, {
        kind: "airquality", id: `aq-${city[0]}`,
        name: city[0], lat, lon,
        aqi: aq.aqi, euAqi: aq.euAqi,
        pm25: aq.pm25, pm10: aq.pm10,
        ozone: aq.ozone, no2: aq.no2, uv: aq.uv,
        time: aq.time, raw: row,
      });
    });
    return items;
  }

  async function fetchWeather(api, opts = {}) {
    const { lats, lons } = batchCoords(WORLD_CITIES);
    const om = window.OpenMeteo;
    const params = {
      latitude: lats, longitude: lons,
      current: om.FORECAST_CURRENT_LITE,
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code",
      timezone: "auto", forecast_days: 7,
    };
    if (opts.model && opts.model !== "best_match") params.models = opts.model;
    const data = await api("openmeteo", "/v1/forecast", params);
    const rows = Array.isArray(data) ? data : [data];
    const items = new Map();
    rows.forEach((row, i) => {
      const city = WORLD_CITIES[i];
      if (!city) return;
      const [, lat, lon] = city;
      const s = om.summarizeCurrent(row?.current);
      items.set(`wx-${city[0]}`, {
        kind: "weather", id: `wx-${city[0]}`,
        name: city[0], lat, lon,
        temp: s.temp, feelsLike: s.feelsLike,
        humidity: s.humidity, wind: s.wind, gusts: s.gusts,
        pressure: s.pressure, cloud: s.cloud,
        weatherCode: s.weatherCode, precip: s.precip,
        time: s.time, forecast: row,
      });
    });
    return items;
  }

  async function fetchMarine(api) {
    const { lats, lons } = batchCoords(COASTAL_CITIES);
    const om = window.OpenMeteo;
    const data = await api("openmeteoMarine", "/v1/marine", {
      latitude: lats, longitude: lons,
      current: om.MARINE_CURRENT,
      hourly: om.MARINE_HOURLY,
      timezone: "auto", forecast_days: 7, past_days: 3,
    });
    const rows = Array.isArray(data) ? data : [data];
    const items = new Map();
    rows.forEach((row, i) => {
      const city = COASTAL_CITIES[i];
      if (!city) return;
      const [, lat, lon] = city;
      const cur = row?.current || {};
      items.set(`marine-${city[0]}`, {
        kind: "marine", id: `marine-${city[0]}`,
        name: city[0], lat, lon,
        waveHeight: cur.wave_height, waveDir: cur.wave_direction,
        wavePeriod: cur.wave_period,
        sst: cur.sea_surface_temperature, current: cur.ocean_current_velocity,
        time: cur.time ? new Date(cur.time).getTime() : null,
        forecast: row,
      });
    });
    return items;
  }

  async function fetchPointWeather(api, lat, lon, opts = {}) {
    return window.OpenMeteo.fetchPointBundle(api, lat, lon, opts);
  }

  async function fetchWeatherBbox(api, bbox, model, opts = {}) {
    const cells = await window.OpenMeteo.fetchBboxGrid(api, bbox, model, opts);
    const items = new Map();
    for (const cell of cells) {
      if (!Number.isFinite(cell.lat) || !Number.isFinite(cell.lon)) continue;
      items.set(cell.id, cell);
    }
    return items;
  }

  async function fetchWeatherFull(api, lat, lon, opts) {
    return window.OpenMeteo.fetchForecastFull(api, lat, lon, opts);
  }

  async function fetchAirQualityFull(api, lat, lon, opts) {
    return window.OpenMeteo.fetchAirQualityFull(api, lat, lon, opts);
  }

  async function fetchMarineFull(api, lat, lon, opts) {
    return window.OpenMeteo.fetchMarineFull(api, lat, lon, opts);
  }

  async function fetchWeatherArchive(api, lat, lon, days = 30) {
    return window.OpenMeteo.fetchArchive(api, lat, lon, days);
  }

  async function fetchAirQualityHistory(api, lat, lon, pastDays = 7) {
    return window.OpenMeteo.fetchAirQualityFull(api, lat, lon, { pastDays, forecastDays: 3 });
  }

  async function fetchSpaceWeather(api) {
    const [kp1m, kp3h, solarWind, xrays] = await Promise.all([
      api("swpc", "/json/planetary_k_index_1m.json", {}).catch(() => []),
      api("swpc", "/products/noaa-planetary-k-index.json", {}).catch(() => []),
      api("swpc", "/json/rtsw/rtsw_wind_1m.json", {}).catch(() => []),
      api("swpc", "/json/goes/primary/xrays-6-hour.json", {}).catch(() => []),
    ]);
    const r1 = Array.isArray(kp1m) && kp1m.length ? kp1m[kp1m.length - 1] : null;
    const r3 = Array.isArray(kp3h) && kp3h.length ? kp3h[kp3h.length - 1] : null;
    const kIndex = r1?.kp_index ?? r1?.estimated_kp ?? r3?.Kp ?? null;
    const kp3hSeries = (Array.isArray(kp3h) ? kp3h : [])
      .map((r) => ({ t: new Date(r.time_tag).getTime(), v: r.Kp }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
    const kp1mSeries = (Array.isArray(kp1m) ? kp1m : []).slice(-180)
      .map((r) => ({ t: new Date(r.time_tag).getTime(), v: r.kp_index ?? r.estimated_kp }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));

    let windSpeed = null;
    let windTime = null;
    const swRows = Array.isArray(solarWind) ? solarWind : [];
    if (swRows.length) {
      const last = swRows[swRows.length - 1];
      windSpeed = last?.proton_speed ?? null;
      windTime = last?.time_tag ?? null;
    }
    const windSeries = swRows.slice(-240)
      .map((r) => ({ t: new Date(r.time_tag).getTime(), v: r.proton_speed }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));

    const xraySeries = (Array.isArray(xrays) ? xrays : []).slice(-120)
      .map((r) => ({ t: new Date(r.time_tag).getTime(), v: r.flux }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));

    return {
      kIndex,
      kpBand: r1?.kp ?? null,
      time: r1?.time_tag ?? r3?.time_tag ?? null,
      aIndex: r3?.a_running ?? null,
      kp3h: r3?.Kp ?? null,
      source: r1 ? "1-minute" : "3-hour",
      kpSeries: kp3hSeries,
      kp1mSeries,
      solarWindSpeed: windSpeed,
      solarWindTime: windTime,
      windSeries,
      xraySeries,
    };
  }

  async function fetchAurora(api) {
    const data = await api("swpc", "/json/ovation_aurora_latest.json", {});
    const items = new Map();
    const coords = data?.coordinates || [];
    let i = 0;
    for (const [lon, lat, prob] of coords) {
      if (prob < 20 || lat < 35) continue;
      if (i++ % 12 !== 0) continue;
      const id = `aurora-${lon}-${lat}`;
      items.set(id, {
        kind: "aurora", id,
        name: `Aurora ${prob}%`, lat, lon, probability: prob,
        observationTime: data["Observation Time"], forecastTime: data["Forecast Time"],
      });
    }
    return items;
  }

  async function fetchEarthImagery(api) {
    const end = new Date();
    const start = new Date(end.getTime() - 2 * 86400000);
    const data = await api("earthsearch", "/v1/search", {
      limit: 30,
      datetime: `${start.toISOString().slice(0, 19)}Z/${end.toISOString().slice(0, 19)}Z`,
    });
    const items = new Map();
    for (const f of data?.features || []) {
      const c = bboxCentroid(f.bbox);
      if (!c) continue;
      const p = f.properties || {};
      const id = `stac-${f.id}`;
      items.set(id, {
        kind: "earthimagery", id,
        name: p["sat:platform_international_designator"] || f.collection || f.id,
        lat: c.lat, lon: c.lon,
        collection: f.collection, datetime: p.datetime || p.start_datetime,
        cloudCover: p["eo:cloud_cover"], platform: p.platform,
        raw: { id: f.id, bbox: f.bbox, collection: f.collection },
      });
    }
    return items;
  }

  const WMO_CODES = {
    0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog", 51: "Light drizzle", 53: "Drizzle",
    55: "Dense drizzle", 61: "Slight rain", 63: "Rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Snow", 75: "Heavy snow", 80: "Rain showers",
    81: "Rain showers", 82: "Violent rain showers", 95: "Thunderstorm",
    96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
  };

  function weatherLabel(code) {
    return WMO_CODES[code] || (code != null ? `Code ${code}` : "—");
  }

  return {
    WORLD_CITIES, COASTAL_CITIES,
    isElevatedVolcano, normQuake, normVolcano, weatherLabel, geomCentroid,
    fetchEarthquakes, fetchRegionalQuakes, fetchVolcanoes, fetchTsunami,
    fetchNwsAlerts, fetchAirQuality, fetchWeather, fetchMarine,
    fetchPointWeather, fetchWeatherBbox, fetchWeatherFull, fetchAirQualityFull, fetchMarineFull,
    fetchWeatherArchive, fetchAirQualityHistory,
    fetchSpaceWeather, fetchAurora, fetchEarthImagery,
  };
})();

/* Canvas chart helpers — multi-series time series for Global Feeds */
window.GlobalCharts = (() => {
  "use strict";

  const COLORS = ["#38bdf8", "#f472b6", "#4ade80", "#fbbf24", "#a78bfa", "#fb923c"];

  function fmtTick(v, step) {
    if (!Number.isFinite(v)) return "";
    // Decimal count derives from the tick STEP, not the individual value's
    // own magnitude — otherwise a narrow-range series (e.g. 15.1-15.4°C)
    // rounds every tick to the same integer and the axis shows "15 15 15
    // 15 15", which reads as broken. Deriving from step means ticks always
    // stay distinguishable regardless of the values' absolute size.
    const d = step > 0 ? Math.max(0, Math.ceil(-Math.log10(step))) : (Math.abs(v) < 1 ? 2 : Math.abs(v) < 10 ? 1 : 0);
    return (+v.toFixed(Math.min(d, 6))).toString();
  }

  // "Nice" round-number tick step (1/2/5 × 10^k), matching the D3/Excel/
  // matplotlib convention — avoids ugly axis labels like 17.3, 34.6, 51.9
  // from a naive linear split of the range into N equal parts.
  function niceStep(range, targetCount) {
    if (!(range > 0)) return 1;
    const rawStep = range / Math.max(1, targetCount);
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  }
  function niceTicks(vMin, vMax, targetCount) {
    const step = niceStep(vMax - vMin, targetCount);
    if (!(step > 0)) return { ticks: [vMin, vMax], step: Math.max(1e-9, vMax - vMin) };
    const start = Math.ceil(vMin / step) * step;
    const ticks = [];
    for (let v = start; v <= vMax + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
    if (!ticks.length) ticks.push(vMin, vMax);
    return { ticks, step };
  }

  function fmtTime(t) {
    const d = new Date(t);
    if (isNaN(d)) return "";
    const mo = d.toLocaleString("en", { month: "short" });
    return `${mo} ${d.getDate()}`;
  }

  function seriesRange(s) {
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const p of s.points || []) {
      if (Number.isFinite(p.v)) { vMin = Math.min(vMin, p.v); vMax = Math.max(vMax, p.v); }
    }
    if (!Number.isFinite(vMin)) { vMin = 0; vMax = 1; }
    const span = vMax - vMin;
    // Flat span (incl. single-point series) needs synthetic padding — scale it
    // to the value's own magnitude instead of an arbitrary fixed ±1, which
    // looks absurdly wide for small quantities and absurdly narrow for large ones.
    const vPad = span > 0 ? span * 0.08 : Math.max(Math.abs(vMax) * 0.1, 0.5);
    // A quantity that never goes negative in the data (humidity, wind speed,
    // ice thickness, AQI, etc.) shouldn't get a padded axis floor below zero —
    // that's physically meaningless and just wastes vertical space.
    const paddedMin = vMin >= 0 ? Math.max(0, vMin - vPad) : vMin - vPad;
    const paddedMax = vMax + vPad;
    return { vMin: paddedMin, vMax: paddedMax, range: Math.max(1e-9, paddedMax - paddedMin) };
  }

  function assignAxes(active, opts) {
    const meta = active.map((s) => ({ s, ...seriesRange(s) }));
    if (meta.length < 2 || opts.dualAxis === false) return { left: meta, right: [] };
    const ranges = meta.map((m) => m.range).filter((r) => r > 0);
    const maxR = Math.max(...ranges);
    const left = [];
    const right = [];
    for (const m of meta) {
      if (m.s.yAxis === "right") right.push(m);
      else if (m.s.yAxis === "left") left.push(m);
      else if (m.range > 0 && maxR / m.range > 2.5 && m.range < maxR * 0.35) right.push(m);
      else left.push(m);
    }
    if (!right.length || !left.length) return { left: meta, right: [] };
    return { left, right };
  }

  function draw(canvas, seriesList, opts = {}) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const active = (seriesList || []).filter((s) => s.points?.length);
    if (!active.length) {
      ctx.fillStyle = "#64748b";
      ctx.font = "12px Segoe UI, system-ui, sans-serif";
      ctx.fillText(opts.emptyText || "No data", 48, h / 2);
      return;
    }

    const { left, right } = assignAxes(active, opts);
    const hasRight = right.length > 0;
    const pad = { l: 48, r: hasRight ? 48 : 12, t: 20, b: 32 };

    // Pre-compute legend line-wrapping BEFORE finalizing pad.t: the legend
    // used to advance left-to-right with no bounds check at all, so with 3+
    // series (a common case for dual-axis weather/marine charts) entries
    // just ran off the right edge of the canvas past pad.r instead of
    // wrapping — and even when they did fit, they were squeezed into a
    // fixed 6px gap that could overlap the plot's own top border.
    const showLegend = opts.legend !== false && active.length > 1;
    const legendLineH = 12;
    let legendLines = 1;
    if (showLegend) {
      ctx.font = "9px IBM Plex Mono, monospace";
      const legendW = w - pad.l - pad.r;
      let lx = 0;
      active.forEach((s, i) => {
        const label = (s.label || `Series ${i + 1}`) + " (R)"; // worst-case width incl. right-axis suffix
        const itemW = 13 + ctx.measureText(label).width + 24;
        if (lx > 0 && lx + itemW > legendW) { legendLines++; lx = 0; }
        lx += itemW;
      });
    }
    pad.t = 12 + (showLegend ? legendLines * legendLineH + 6 : 8);
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    let tMin = Infinity;
    let tMax = -Infinity;
    let hasTime = false;
    for (const s of active) {
      for (const p of s.points) {
        if (p.t != null) { hasTime = true; tMin = Math.min(tMin, p.t); tMax = Math.max(tMax, p.t); }
      }
    }
    if (!Number.isFinite(tMin)) { tMin = 0; tMax = 1; hasTime = false; }
    const tRange = Math.max(1, tMax - tMin);
    const xAt = (t) => pad.l + ((t - tMin) / tRange) * plotW;

    const leftR = left.reduce((acc, m) => ({
      vMin: Math.min(acc.vMin, m.vMin),
      vMax: Math.max(acc.vMax, m.vMax),
    }), { vMin: Infinity, vMax: -Infinity });
    const lRange = Math.max(1e-9, leftR.vMax - leftR.vMin);
    const yAtL = (v) => pad.t + plotH - ((v - leftR.vMin) / lRange) * plotH;

    let rightR = null;
    let yAtR = null;
    if (hasRight) {
      rightR = right.reduce((acc, m) => ({
        vMin: Math.min(acc.vMin, m.vMin),
        vMax: Math.max(acc.vMax, m.vMax),
      }), { vMin: Infinity, vMax: -Infinity });
      const rRange = Math.max(1e-9, rightR.vMax - rightR.vMin);
      yAtR = (v) => pad.t + plotH - ((v - rightR.vMin) / rRange) * plotH;
    }

    ctx.strokeStyle = "rgba(127,170,205,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.l, pad.t, plotW, plotH);

    const drawYTicks = (vMin, vMax, yAt, side) => {
      // Nice round-number ticks (see niceTicks above) instead of a naive
      // linear split into 4 equal parts, which produced ugly non-round
      // labels and, for a narrow-range series, ticks that all rounded to
      // the same displayed number.
      const { ticks, step } = niceTicks(vMin, vMax, 4);
      ctx.font = "9px IBM Plex Mono, monospace";
      ctx.textBaseline = "middle";
      ctx.textAlign = side === "right" ? "left" : "right";
      for (const v of ticks) {
        const y = yAt(v);
        if (y < pad.t - 0.5 || y > pad.t + plotH + 0.5) continue;
        ctx.strokeStyle = "rgba(127,170,205,0.12)";
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(pad.l + plotW, y);
        ctx.stroke();
        ctx.fillStyle = "#7a93a8";
        const tx = side === "right" ? pad.l + plotW + 5 : pad.l - 5;
        ctx.fillText(fmtTick(v, step), tx, y);
      }
    };

    drawYTicks(leftR.vMin, leftR.vMax, yAtL, "left");
    if (hasRight && rightR && yAtR) drawYTicks(rightR.vMin, rightR.vMax, yAtR, "right");

    const nX = hasTime ? Math.min(6, Math.max(3, Math.floor(plotW / 70))) : 0;
    if (nX > 0) {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let i = 0; i < nX; i++) {
        const t = tMin + (tRange * i) / Math.max(1, nX - 1);
        const x = xAt(t);
        ctx.strokeStyle = "rgba(127,170,205,0.12)";
        ctx.beginPath();
        ctx.moveTo(x, pad.t);
        ctx.lineTo(x, pad.t + plotH);
        ctx.stroke();
        ctx.fillStyle = "#7a93a8";
        ctx.save();
        ctx.translate(x, pad.t + plotH + 4);
        ctx.rotate(-Math.PI / 5);
        ctx.fillText(fmtTime(t), 0, 0);
        ctx.restore();
      }
    }

    const leftUnit = opts.unit || left[0]?.s?.unit || "";
    ctx.save();
    ctx.translate(14, pad.t + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillStyle = "#7a93a8";
    ctx.font = "9px IBM Plex Mono, monospace";
    ctx.fillText(opts.yLabel || leftUnit || "Value", 0, 0);
    ctx.restore();

    if (hasRight && rightR) {
      const rUnit = right[0]?.s?.unit || "";
      ctx.save();
      ctx.translate(w - 10, pad.t + plotH / 2);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = "center";
      ctx.fillStyle = "#fbbf24";
      ctx.font = "9px IBM Plex Mono, monospace";
      ctx.fillText(opts.yLabelRight || rUnit || "Value", 0, 0);
      ctx.restore();
    }

    if (hasTime) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#7a93a8";
      ctx.fillText(opts.xLabel || "Time", pad.l + plotW / 2, h - 4);
    }

    const drawLine = (s, yAt, color) => {
      const sorted = [...s.points].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
      ctx.strokeStyle = color;
      ctx.lineWidth = s.width || 2;
      if (sorted.length === 1) {
        // moveTo with no lineTo strokes nothing — a single-frame overlay
        // (e.g. RTOFS forecast-hour-0 files) would render an invisible chart.
        const p = sorted[0];
        const x = p.t != null ? xAt(p.t) : pad.l + plotW / 2;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, yAt(p.v), 3.5, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.beginPath();
      sorted.forEach((p, idx) => {
        const x = p.t != null ? xAt(p.t) : pad.l + (idx / Math.max(1, sorted.length - 1)) * plotW;
        const y = yAt(p.v);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      if (s.scatter) {
        ctx.fillStyle = color;
        sorted.forEach((p) => {
          const x = p.t != null ? xAt(p.t) : pad.l;
          ctx.beginPath();
          ctx.arc(x, yAt(p.v), 2.5, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    };

    left.forEach((m, i) => {
      const color = m.s.color || COLORS[i % COLORS.length];
      drawLine(m.s, yAtL, color);
    });
    right.forEach((m, i) => {
      const color = m.s.color || COLORS[(i + 3) % COLORS.length];
      drawLine(m.s, yAtR, color);
    });

    if (showLegend) {
      let lx = pad.l;
      let line = 0;
      const legendW = w - pad.l - pad.r;
      ctx.font = "9px IBM Plex Mono, monospace";
      ctx.textAlign = "left";
      active.forEach((s, i) => {
        const color = s.color || COLORS[i % COLORS.length];
        const onRight = right.some((m) => m.s === s);
        const label = (s.label || `Series ${i + 1}`) + (onRight ? " (R)" : "");
        const itemW = 13 + ctx.measureText(label).width + 24;
        if (lx > pad.l && lx - pad.l + itemW > legendW) { line++; lx = pad.l; }
        const ly = 10 + line * legendLineH + 8;
        ctx.fillStyle = color;
        ctx.fillRect(lx, ly - 8, 10, 3);
        ctx.fillStyle = "#94a3b8";
        ctx.fillText(label, lx + 13, ly);
        lx += itemW;
      });
    }
  }

  function hourlySeries(times, values) {
    const vals = values || [];
    return (times || [])
      .map((t, i) => ({ t: new Date(t).getTime(), v: vals[i] }))
      .filter((p) => Number.isFinite(p.v));
  }

  function dailySeries(times, values) {
    return hourlySeries(times, values);
  }

  return { draw, hourlySeries, dailySeries, COLORS };
})();

/* Expand / resize chrome for nc-plot-win windows */
window.GlobePlotExpand = (() => {
  "use strict";

  const btnStyle =
    "background:none;border:1px solid rgba(127,208,255,0.35);color:#cfe3f2;cursor:pointer;" +
    "font-size:11px;font-family:IBM Plex Mono,monospace;padding:1px 7px;border-radius:4px;";

  function attach(wrap, cv, refreshFn, opts = {}) {
    if (!wrap || wrap.dataset.plotChrome) return;
    wrap.dataset.plotChrome = "1";
    const minW = opts.minW ?? 300;
    const minH = opts.minH ?? 200;
    const normalW = opts.normalW ?? (cv.width || 620);
    const normalH = opts.normalH ?? (cv.height || 300);

    let expBtn = wrap.querySelector(".pw-expand");
    if (!expBtn) {
      expBtn = document.createElement("button");
      expBtn.type = "button";
      expBtn.className = "pw-expand";
      expBtn.title = "Expand / restore";
      expBtn.textContent = "⤢";
      expBtn.style.cssText = btnStyle;
      const btnRow = wrap.querySelector(".pw-head-btns");
      const closeBtn = wrap.querySelector(".pw-x");
      if (btnRow) btnRow.insertBefore(expBtn, closeBtn || null);
      else if (closeBtn) closeBtn.before(expBtn);
      else wrap.querySelector(".pw-head")?.appendChild(expBtn);
    }

    let expanded = false;
    let saved = null;
    let resizeRAF = null;

    expBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!expanded) {
        saved = {
          left: wrap.style.left, top: wrap.style.top,
          width: wrap.style.width, height: wrap.style.height,
          userW: wrap._userW, userH: wrap._userH,
        };
        wrap.style.left = "2vw";
        wrap.style.top = "4vh";
        wrap.style.width = "96vw";
        wrap.style.height = "92vh";
        wrap.style.maxWidth = "none";
        wrap._userW = Math.max(minW, Math.round(window.innerWidth * 0.94));
        wrap._userH = Math.max(minH, Math.round(window.innerHeight * 0.82));
        expanded = true;
        expBtn.textContent = "⤡";
      } else {
        wrap.style.left = saved?.left || "";
        wrap.style.top = saved?.top || "";
        wrap.style.width = saved?.width || "";
        wrap.style.height = saved?.height || "";
        wrap._userW = saved?.userW ?? normalW;
        wrap._userH = saved?.userH ?? normalH;
        expanded = false;
        expBtn.textContent = "⤢";
      }
      wrap._plotLite = false;
      if (typeof refreshFn === "function") refreshFn();
    });

    if (!wrap.querySelector(".pw-resize-grip")) {
      const grip = document.createElement("div");
      grip.className = "pw-resize-grip";
      grip.style.cssText =
        "position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:se-resize;z-index:30;" +
        "background:linear-gradient(135deg,transparent 50%,rgba(127,208,255,0.45) 50%);border-radius:0 0 10px 0;";
      wrap.style.position = wrap.style.position || "fixed";
      wrap.appendChild(grip);

      let mx0 = 0, my0 = 0, rw0 = 0, rh0 = 0, resizing = false;
      const startResize = (e) => {
        if (e.button != null && e.button !== 0) return;
        resizing = true;
        mx0 = e.clientX; my0 = e.clientY;
        rw0 = wrap._userW || cv?.width || normalW;
        rh0 = wrap._userH || cv?.height || normalH;
        e.preventDefault(); e.stopPropagation();
      };
      grip.addEventListener("mousedown", startResize);
      grip.addEventListener("pointerdown", startResize);
      const onMove = (e) => {
        if (!resizing) return;
        wrap._userW = Math.max(minW, rw0 + (e.clientX - mx0));
        wrap._userH = Math.max(minH, rh0 + (e.clientY - my0));
        wrap.style.width = `${wrap._userW}px`;
        wrap.style.height = `${wrap._userH}px`;
        wrap.style.maxWidth = "none";
        wrap.style.maxHeight = "none";
        wrap._plotLite = true;
        if (!resizeRAF) {
          resizeRAF = requestAnimationFrame(() => {
            resizeRAF = null;
            if (typeof refreshFn === "function") refreshFn(true);
          });
        }
      };
      const onUp = () => {
        if (!resizing) return;
        resizing = false;
        wrap._plotLite = false;
        if (typeof refreshFn === "function") refreshFn();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      // Chain onto the popup's document-listener release hook (created by
      // the popup's own drag wiring; called from its ✕ handler) so these
      // four go away with the window too instead of leaking — same issue
      // as the drag handlers: closed popups otherwise stay pinned in
      // memory and keep running on every document mousemove.
      const prevRelease = wrap._releaseDoc;
      wrap._releaseDoc = () => {
        if (prevRelease) prevRelease();
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
    }
  }

  return { attach };
})();

/* Globe Live Feeds — earthquakes, marine, point-click (global-cors style detail) */
window.GlobeFeeds = function (api) {
  "use strict";
  if (!api?.projection || !api?.gLabels) {
    console.warn("[GlobeFeeds] GlobeAPI not ready");
    return;
  }

  const GL = () => window.GlobalLayers;
  const GC = () => window.GlobalCharts;
  const OM = () => window.OpenMeteo;
  const sampleFn = () => api.sampleAt || window.sampleAt;
  const extractSlice = window.extractSlice;

  const API_BASES = {
    earthquake: "https://earthquake.usgs.gov",
    openmeteo: "https://api.open-meteo.com",
    openmeteoAq: "https://air-quality-api.open-meteo.com",
    openmeteoMarine: "https://marine-api.open-meteo.com",
    openmeteoArchive: "https://archive-api.open-meteo.com",
  };

  async function dataApi(service, path, params = {}) {
    const base = API_BASES[service];
    if (!base) throw new Error(`Unknown service: ${service}`);
    const p = path.startsWith("/") ? path : `/${path}`;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v != null) qs.append(k, String(v));
    }
    const url = qs.toString() ? `${base}${p}?${qs}` : `${base}${p}`;
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "GlobeFeeds/1.0" },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  const feed = {
    enabled: new Set(),
    data: new Map(),
    quakeMag: "2.5",
    quakePeriod: "week",
    pointClick: true,
    loading: false,
    pendingRefresh: false,
    selected: null,
    chartState: null,
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
  };

  const KIND_COLOR = { earthquake: "#ff6b4a", marine: "#38e0a0" };
  const CHK = '<svg viewBox="0 0 12 12"><path d="M2 6.5 L5 9.5 L10 3" fill="none" stroke="#061119" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let feedSvg = null;
  const gFeed = (() => {
    feedSvg = document.getElementById("globe-feed-markers");
    if (!feedSvg) {
      feedSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      feedSvg.id = "globe-feed-markers";
      feedSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      // z-index 19: above the globe/coastline-label layers (15-17) so
      // markers still sit correctly over the sphere, but BELOW the
      // workspace panel (20) — was 25 (above the panel), which let feed
      // markers visually punch straight through an open panel, making its
      // controls hard to read/use (worse on mobile, where the panel and
      // the visible globe overlap far more of the screen).
      feedSvg.style.cssText =
        "position:fixed;inset:0;width:100%;height:100%;z-index:19;pointer-events:none;overflow:visible;";
      document.body.appendChild(feedSvg);
    }
    const g = api.A.el("g", { id: "gf-markers", "pointer-events": "all" }, feedSvg);
    g.style.pointerEvents = "all";
    return g;
  })();
  feed.markerSvg = feedSvg;

  let statusEl = null;
  let panelEl = null;
  let panelDrag = null;
  let uiRows = {};

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtCoord(lon, lat) {
    return `${Math.abs(lon).toFixed(3)} ${lon >= 0 ? "E" : "W"}, ${Math.abs(lat).toFixed(3)} ${lat >= 0 ? "N" : "S"}`;
  }

  function dlRow(label, value) {
    if (value == null || value === "") return "";
    return `<dt>${esc(label)}</dt><dd>${value}</dd>`;
  }

  function lonLatOnGlobe(e) {
    const proj = api.projection;
    const [pcx, pcy] = proj.translate();
    const pR = proj.scale();
    const dx = e.clientX - pcx;
    const dy = e.clientY - pcy;
    if (dx * dx + dy * dy > pR * pR) return null;
    const ll = proj.invert([e.clientX, e.clientY]);
    if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return null;
    return ll;
  }

  function globeBusy() {
    return !!(api._globeRegionPicking || api._globeMeasurePicking);
  }

  function isFloatingPanelOpen() {
    if (panelEl?.classList.contains("show")) return true;
    // panelEl itself carries the "nc-plot-win" class (to inherit the
    // drag/resize/expand chrome) but stays in the DOM permanently once
    // created, just hidden via the "show" toggle above. Excluding it here
    // stops every future point-click from being blocked once a single
    // earthquake/point popup has ever been opened.
    for (const w of document.querySelectorAll(".nc-plot-win")) {
      if (w !== panelEl) return true;
    }
    if (document.querySelector(".nc-trend-dlg")) return true;
    // Derived-layer dialog: same full-screen backdrop pattern as the trend
    // dialog (position:fixed;inset:0), but its dropdowns weren't excluded
    // from the globe's point-click weather lookup — picking a term/variable
    // in it also opened the weather-feed popup underneath (pointerup fires
    // on whatever's under the cursor once the click's mousedown target,
    // the backdrop, is gone).
    if (document.querySelector(".nc-derive-dlg")) return true;
    if (document.querySelector(".nc-corr-dlg")) return true;
    if (document.querySelector(".nc-comp-dlg")) return true;
    if (document.querySelector(".nc-eof-dlg")) return true;
    if (document.querySelector(".nc-regr-dlg")) return true;
    // Any other floating UI counts too: while a window/menu/dialog is open,
    // a globe click should never spawn the point-weather popup on top of
    // (or underneath) it — one open window at a time.
    if (document.getElementById("nomads-modal")?.classList.contains("show")) return true;
    if (document.getElementById("help-modal")?.classList.contains("show")) return true;
    const infoP = document.getElementById("info-panel");
    if (infoP && infoP.style.display !== "none") return true;
    if (document.querySelector(".nc-csv-menu")) return true;
    const annF = document.getElementById("ann-form");
    if (annF && annF.style.display !== "none") return true;
    return false;
  }

  function overlayList() {
    // GlobeNC exposes its live array as _overlaysForProbe during startup.
    // _ncOverlays is a later alias and may be absent when modules boot in a
    // different order, so always fall back to the canonical live reference.
    const canonical = api._overlaysForProbe;
    const alias = api._ncOverlays;
    if (Array.isArray(canonical) && canonical.length) return canonical;
    if (Array.isArray(alias)) return alias;
    return Array.isArray(canonical) ? canonical : [];
  }

  function pickFeedAtScreen(clientX, clientY) {
    const proj = api.projection;
    const TR = Math.PI / 180;
    const cv = proj.invert(proj.translate());
    const cSin = cv ? Math.sin(cv[1] * TR) : 0;
    const cCos = cv ? Math.cos(cv[1] * TR) : 1;
    const cLon = cv ? cv[0] * TR : 0;
    let best = null;
    let bestD = Infinity;
    for (const item of feed.data.values()) {
      const show =
        (item.kind === "earthquake" && feed.enabled.has("earthquakes")) ||
        (item.kind === "marine" && feed.enabled.has("marine"));
      if (!show) continue;
      const pt = proj([item.lon, item.lat]);
      if (!pt) continue;
      if (cv && Math.sin(item.lat * TR) * cSin + Math.cos(item.lat * TR) * cCos * Math.cos(item.lon * TR - cLon) < 0) continue;
      const hitR = item.kind === "earthquake" ? magRadius(item.mag) + 12 : 16;
      const d = Math.hypot(clientX - pt[0], clientY - pt[1]);
      if (d <= hitR && d < bestD) { best = item; bestD = d; }
    }
    return best;
  }

  function sampleActiveOverlays(lon, lat) {
    const ovs = overlayList();
    const hits = [];
    const fn = sampleFn();
    if (typeof fn !== "function") return hits;
    for (const ov of ovs) {
      if (!ov || ov.enabled === false || !ov.renderSlice) continue;
      const rs = ov.renderSlice;
      const v = fn(lon, lat, rs, rs.lats, rs.lons);
      const frame = ov.frames?.[ov.selTime]?.label || "";
      hits.push({
        name: ov.name || "overlay",
        varName: ov.activeSlice?.longName || ov.selVar || "",
        value: v,
        units: ov.activeSlice?.units || "",
        frame,
      });
    }
    return hits;
  }

  function buildOverlaySection(hits) {
    if (!hits?.length) return "";
    return (
      `<div class="gf-detail-section"><div class="gf-detail-section-title">Overlay at point</div><dl>` +
      hits.map((h) => dlRow(
        `${esc(h.name)}${h.frame ? ` · ${esc(h.frame)}` : ""}${h.varName ? ` (${esc(h.varName)})` : ""}`,
        isNaN(h.value) ? "—" : `${Number(h.value).toPrecision(5)}${h.units ? " " + esc(h.units) : ""}`
      )).join("") +
      `</dl></div>`
    );
  }

  function syncOnlineUi() {
    const on = feed.online;
    [uiRows.eq, uiRows.marine].forEach((row) => {
      if (row) row.classList.toggle("offline-disabled", !on);
    });
    const ptLbl = uiRows.point?.querySelector(".lbl");
    if (ptLbl) ptLbl.textContent = on ? "Point-click lookup" : "Point-click (overlay values)";
    const fetchBtn = document.getElementById("gf-fetch");
    if (fetchBtn) fetchBtn.disabled = !on;
    if (statusEl && !feed.loading) {
      statusEl.textContent = on ? (feed.data.size ? `Ready · ${feed.data.size} markers` : "Online — enable layers and Fetch") : "Offline — live feeds need network";
    }
  }

  function setOnlineState(on) {
    feed.online = on;
    if (!on) {
      feed.enabled.delete("earthquakes");
      feed.enabled.delete("marine");
    }
    syncRows();
    syncOnlineUi();
    drawMarkers();
  }

  window.addEventListener("online", () => setOnlineState(true));
  window.addEventListener("offline", () => setOnlineState(false));

  function positionPanel(clientX, clientY) {
    const el = ensurePanel();
    refreshFeedPanel();
    el.classList.add("show");
    const w = el.offsetWidth || Math.min(el._userW || 420, window.innerWidth - 16);
    const h = Math.min(el.offsetHeight || el._userH || 380, window.innerHeight - 16);
    const x = clientX != null ? clientX - 12 : 120;
    const y = clientY != null ? clientY - 12 : 120;
    el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - h - 8))}px`;
  }

  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement("div");
    panelEl.id = "gf-feed-detail";
    panelEl.className = "gf-feed-detail nc-plot-win";
    panelEl._userW = 420;
    panelEl._userH = 380;
    panelEl.innerHTML =
      '<div class="gf-feed-head">' +
      '<h3 class="gf-feed-title"></h3>' +
      '<div class="pw-head-btns">' +
      '<button type="button" class="gf-feed-csv" title="Export all chart data as CSV">⬇ CSV</button>' +
      '<button type="button" class="pw-expand" title="Expand / restore">⤢</button>' +
      '<button type="button" class="gf-feed-close" title="Close">×</button></div></div>' +
      '<div class="gf-feed-scroll">' +
      '<div class="gf-feed-body"></div>' +
      '<div class="gf-feed-chart-tabs hidden"></div>' +
      '<div class="gf-feed-chart-label"></div>' +
      '<canvas class="gf-feed-chart hidden" height="200"></canvas></div>';
    document.body.appendChild(panelEl);
    panelEl.querySelector(".gf-feed-close").addEventListener("click", () => {
      panelEl.classList.remove("show");
      feed.selected = null;
      hideCharts();
      drawMarkers();
    });
    panelEl.querySelector(".gf-feed-csv").addEventListener("click", (e) => {
      e.stopPropagation();
      exportAllChartData();
    });
    const head = panelEl.querySelector(".gf-feed-head");
    let mx0 = 0, my0 = 0, ox0 = 0, oy0 = 0;
    head.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      panelDrag = true;
      mx0 = e.clientX;
      my0 = e.clientY;
      ox0 = panelEl.offsetLeft;
      oy0 = panelEl.offsetTop;
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!panelDrag) return;
      // Clamp so the header/close button can't be dragged fully
      // off-screen — see the quick-plot popup's drag handler for the
      // same fix and why it matters (unclosable window otherwise).
      const nx = ox0 + e.clientX - mx0, ny = oy0 + e.clientY - my0;
      panelEl.style.left = `${Math.max(-(panelEl.offsetWidth-60), Math.min(window.innerWidth-60, nx))}px`;
      panelEl.style.top = `${Math.max(4, Math.min(window.innerHeight-40, ny))}px`;
    });
    document.addEventListener("mouseup", () => { panelDrag = false; });
    if (window.GlobePlotExpand) {
      const chartCv = panelEl.querySelector(".gf-feed-chart");
      window.GlobePlotExpand.attach(panelEl, chartCv, refreshFeedPanel, {
        normalW: 420, normalH: 380, minW: 280, minH: 220,
      });
    }
    return panelEl;
  }

  function resizeFeedChart() {
    const cv = panelEl?.querySelector(".gf-feed-chart");
    if (!cv || cv.classList.contains("hidden")) return;
    const h = Math.max(160, Math.min((panelEl._userH || 380) - 260, 520));
    cv.style.height = `${h}px`;
  }

  function refreshFeedPanel() {
    if (!panelEl) return;
    const uw = panelEl._userW || 420;
    const uh = panelEl._userH || 380;
    panelEl.style.width = `${Math.min(uw, window.innerWidth - 16)}px`;
    panelEl.style.maxWidth = "none";
    panelEl.style.height = `${Math.min(uh, window.innerHeight - 16)}px`;
    panelEl.style.maxHeight = "none";
    const scroll = panelEl.querySelector(".gf-feed-scroll");
    if (scroll) scroll.style.maxHeight = `${Math.max(140, uh - 48)}px`;
    resizeFeedChart();
    const state = feed.chartState;
    if (!state?.tabs?.length) return;
    const tab = state.tabs.find((t) => t.id === state.activeId) || state.tabs[0];
    if (tab) renderChartTab(tab, state.tabs);
  }

  function hideCharts() {
    const tabs = panelEl?.querySelector(".gf-feed-chart-tabs");
    const label = panelEl?.querySelector(".gf-feed-chart-label");
    const cv = panelEl?.querySelector(".gf-feed-chart");
    if (tabs) { tabs.classList.add("hidden"); tabs.innerHTML = ""; }
    if (label) { label.textContent = ""; label.classList.remove("show"); }
    if (cv) cv.classList.add("hidden");
    feed.chartState = null;
  }

  function tabBtnLabel(t) {
    if (t.group === "overlay") return `▣ ${t.label}`;
    if (t.group === "openmeteo") return `☁ ${t.label}`;
    return t.label;
  }

  function showChartTabs(tabs, activeId) {
    const el = ensurePanel();
    const tabsEl = el.querySelector(".gf-feed-chart-tabs");
    if (!tabs?.length) { tabsEl.classList.add("hidden"); return; }
    tabsEl.classList.remove("hidden");
    const groups = [
      { key: "overlay", title: "▣ Overlays (loaded files)" },
      { key: "openmeteo", title: "☁ Open-Meteo (online)" },
      { key: "", title: "Charts" },
    ];
    let html = '<label class="gf-chart-sel-lbl">Chart <select class="gf-feed-chart-sel">';
    for (const g of groups) {
      const items = tabs.filter((t) => (t.group || "") === g.key);
      if (!items.length) continue;
      html += `<optgroup label="${esc(g.title)}">` +
        items.map((t) =>
          `<option value="${esc(t.id)}"${t.id === activeId ? " selected" : ""}>${esc(t.label)}</option>`
        ).join("") +
        "</optgroup>";
    }
    html += `</select></label><span class="gf-chart-count">${tabs.length} chart${tabs.length === 1 ? "" : "s"}</span>`;
    tabsEl.innerHTML = html;
    const sel = tabsEl.querySelector("select");
    sel.addEventListener("change", () => {
      const tab = tabs.find((t) => t.id === sel.value);
      if (tab) renderChartTab(tab, tabs);
    });
    sel.addEventListener("mousedown", (e) => e.stopPropagation());
    sel.addEventListener("click", (e) => e.stopPropagation());
  }

  function renderChartTab(tab, tabs) {
    const el = ensurePanel();
    const label = el.querySelector(".gf-feed-chart-label");
    const cv = el.querySelector(".gf-feed-chart");
    feed.chartState = { tabs, activeId: tab.id };
    label.textContent = tab.label || "";
    label.classList.add("show");
    cv.classList.remove("hidden");
    resizeFeedChart();
    GC().draw(cv, tab.series, {
      unit: tab.unit,
      legend: tab.series?.length > 1,
      yLabel: tab.unit || tab.label,
      yLabelRight: tab.yLabelRight,
      xLabel: tab.xLabel || "Time",
      dualAxis: tab.dualAxis !== false,
    });
    const sel = el.querySelector(".gf-feed-chart-sel");
    if (sel && sel.value !== tab.id) sel.value = tab.id;
  }

  function autosizePanelForChart() {
    if (!panelEl || !panelEl.classList.contains("show")) return;
    const target = Math.min(window.innerHeight - 24, 620);
    if ((panelEl._userH || 380) < target) panelEl._userH = target;
    if ((panelEl._userW || 420) < 440) panelEl._userW = Math.min(window.innerWidth - 16, 460);
    refreshFeedPanel();
    const rect = panelEl.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 8) {
      panelEl.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
    }
    if (rect.right > window.innerWidth - 8) {
      panelEl.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
    }
    const cv = panelEl.querySelector(".gf-feed-chart");
    if (cv && !cv.classList.contains("hidden")) {
      setTimeout(() => { try { cv.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) {} }, 40);
    }
  }

  function showMultiChart(tabs, activeId) {
    if (!tabs?.length) { hideCharts(); return; }
    const first = tabs.find((t) => t.id === activeId) || tabs[0];
    showChartTabs(tabs, first.id);
    renderChartTab(first, tabs);
    autosizePanelForChart();
  }

  function buildQuakeTimeline(regional) {
    const rows = (regional || [])
      .filter((q) => q.time)
      .sort((a, b) => b.time - a.time)
      .slice(0, 40);
    if (!rows.length) return "";
    return (
      `<div class="gf-detail-section"><div class="gf-detail-section-title">Regional timeline (150 km, 30d)</div>` +
      `<div class="gf-timeline">` +
      rows.map((q) =>
        `<div class="gf-timeline-row">` +
        `<span class="gf-timeline-time">${new Date(q.time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>` +
        `<span>M${q.mag?.toFixed(1) ?? "?"}</span>` +
        `<span>${esc(q.place || q.title || "—")}</span></div>`
      ).join("") +
      `</div></div>`
    );
  }

  async function loadPointCharts(item) {
    const label = panelEl?.querySelector(".gf-feed-chart-label");
    if (label) { label.textContent = "Loading charts…"; label.classList.add("show"); }
    const overlayTabs = typeof api.sampleOverlayPointSeries === "function"
      ? await api.sampleOverlayPointSeries(item.lon, item.lat)
      : [];
    if (!feed.online || !feed.pointClick) {
      if (overlayTabs.length) showMultiChart(overlayTabs, overlayTabs[0].id);
      else hideCharts();
      return;
    }
    if (overlayTabs.length) showMultiChart(overlayTabs, overlayTabs[0].id);
    try {
      const [wx, archive, aq, marine] = await Promise.all([
        GL().fetchWeatherFull(dataApi, item.lat, item.lon, { forecastDays: 16, pastDays: 7 }),
        GL().fetchWeatherArchive(dataApi, item.lat, item.lon, 90).catch(() => null),
        GL().fetchAirQualityFull(dataApi, item.lat, item.lon).catch(() => null),
        GL().fetchMarineFull(dataApi, item.lat, item.lon).catch(() => null),
      ]);
      const metTabs = OM().buildAllCharts(wx, archive, aq, marine, GC()).map((t) => ({
        ...t,
        group: "openmeteo",
        label: t.label,
      }));
      const all = [...overlayTabs, ...metTabs];
      const curId = feed.chartState?.activeId;
      const keep = curId && all.some((t) => t.id === curId) ? curId : null;
      if (all.length) showMultiChart(all, keep || overlayTabs[0]?.id || metTabs[0]?.id || all[0].id);
      else hideCharts();
    } catch (err) {
      console.warn("[GlobeFeeds] point charts:", err.message);
      if (overlayTabs.length) showMultiChart(overlayTabs, overlayTabs[0].id);
      else hideCharts();
    }
  }

  async function loadHistory(item) {
    if (item?.kind === "pointlookup") return loadPointCharts(item);
    if (!feed.online) { hideCharts(); return; }
    const label = panelEl?.querySelector(".gf-feed-chart-label");
    if (label) { label.textContent = "Loading charts…"; label.classList.add("show"); }
    try {
      if (item.kind === "earthquake") {
        const regional = await GL().fetchRegionalQuakes(dataApi, item.lat, item.lon, { days: 30, radiusKm: 150 });
        const timeline = buildQuakeTimeline(regional);
        if (timeline && panelEl) {
          const body = panelEl.querySelector(".gf-feed-body");
          if (body && !body.querySelector(".gf-timeline")) body.insertAdjacentHTML("beforeend", timeline);
        }
        const points = regional.filter((q) => q.mag != null && q.time).map((q) => ({ t: q.time, v: q.mag }));
        if (points.length) {
          showMultiChart([
            {
              id: "regional",
              label: `Magnitude timeline — ${points.length} events (150 km, 30d)`,
              unit: "Magnitude",
              xLabel: "Time",
              series: [{ label: "Magnitude", points, color: "#e17055", scatter: true }],
            },
            {
              id: "depth",
              label: "Depth vs time",
              unit: "km",
              xLabel: "Time",
              series: [{
                label: "Depth",
                points: regional.filter((q) => q.depth != null && q.time).map((q) => ({ t: q.time, v: q.depth })),
                color: "#74b9ff",
                scatter: true,
              }],
            },
          ], "regional");
          return;
        }
      }
      if (item.kind === "marine") {
        const marine = item.forecast?.hourly
          ? item.forecast
          : await GL().fetchMarineFull(dataApi, item.lat, item.lon).catch(() => null);
        const tabs = OM().buildMarineCharts(marine, GC());
        if (tabs.length) {
          const p = panelEl?.querySelector(".gf-detail-desc");
          if (p) p.remove();
          showMultiChart(tabs, "waves");
          return;
        }
      }
    } catch (err) {
      console.warn("[GlobeFeeds] chart load:", err.message);
    }
    hideCharts();
  }

  function openDetail(title, bodyHtml, item, clientX, clientY) {
    const el = ensurePanel();
    feed.currentItem = item || null;
    el.querySelector(".gf-feed-title").textContent = title;
    el.querySelector(".gf-feed-body").innerHTML = bodyHtml;
    positionPanel(clientX, clientY);
    if (item) loadHistory(item);
    else hideCharts();
  }

  function csvQ(s) {
    s = String(s ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportAllChartData() {
    const tabs = feed.chartState?.tabs || [];
    const rows = ["group,chart,series,unit,time_iso,value"];
    for (const t of tabs) {
      for (const s of t.series || []) {
        for (const p of s.points || []) {
          if (!Number.isFinite(p.v)) continue;
          const iso = p.t != null && Number.isFinite(p.t) ? new Date(p.t).toISOString() : String(p.t ?? "");
          rows.push([t.group || "feed", csvQ(t.label), csvQ(s.label), csvQ(t.unit || ""), iso, p.v].join(","));
        }
      }
    }
    if (rows.length <= 1) {
      setStatus("No chart data to export yet");
      return;
    }
    const item = feed.currentItem;
    let name = "feed";
    if (item?.kind === "pointlookup") name = `point_${(+item.lat).toFixed(3)}_${(+item.lon).toFixed(3)}`;
    else if (item?.id) name = String(item.id).replace(/[^\w.-]/g, "_");
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `globe_${name}_all_data.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
  }

  function showQuakeDetail(item, clientX, clientY) {
    feed.selected = item.id;
    drawMarkers();
    openDetail(
      item.title || `M${item.mag} — ${item.place}`,
      `<div class="gf-detail-section"><div class="gf-detail-section-title">Earthquake</div><dl>` +
      dlRow("Magnitude", `M${item.mag?.toFixed(1) ?? "?"}`) +
      dlRow("Depth", item.depth != null ? `${item.depth} km` : "—") +
      dlRow("Time", item.time ? new Date(item.time).toLocaleString() : "—") +
      dlRow("Place", esc(item.place)) +
      dlRow("Alert", esc(item.alert || "—")) +
      dlRow("Tsunami", item.tsunami ? "Possible" : "No") +
      `</dl>${item.url ? `<p class="gf-ext-link"><a href="${esc(item.url)}" target="_blank" rel="noopener">USGS event page ↗</a></p>` : ""}</div>`,
      item,
      clientX,
      clientY
    );
  }

  function showMarineDetail(item, clientX, clientY) {
    feed.selected = item.id;
    drawMarkers();
    openDetail(
      item.name || "Marine",
      `<div class="gf-detail-section"><div class="gf-detail-section-title">Marine (Open-Meteo)</div><dl>` +
      dlRow("Location", esc(item.name || fmtCoord(item.lon, item.lat))) +
      dlRow("Wave height", item.waveHeight != null ? `${item.waveHeight} m` : null) +
      dlRow("Wave period", item.wavePeriod != null ? `${item.wavePeriod} s` : null) +
      dlRow("SST", item.sst != null ? `${item.sst.toFixed(1)} °C` : null) +
      dlRow("Current", item.current != null ? `${item.current} m/s` : null) +
      `</dl><p class="gf-detail-desc">Loading marine forecast charts…</p></div>`,
      item,
      clientX,
      clientY
    );
  }

  function showPointDetail(lon, lat, clientX, clientY) {
    feed.selected = null;
    drawMarkers();
    const title = fmtCoord(lon, lat);
    const overlayHits = sampleActiveOverlays(lon, lat);
    const overlayHtml = buildOverlaySection(overlayHits);
    const wantMeteo = feed.online && feed.pointClick;

    if (!wantMeteo) {
      const note = !feed.online
        ? "Offline — no network connection. Load and enable an NC overlay to read grid values at this point."
        : "Point-click lookup is toggled off — showing overlay values only. Enable \u201CPoint-click lookup\u201D for live Open-Meteo data.";
      const body = overlayHtml
        ? overlayHtml + `<div class="gf-detail-section"><p class="gf-detail-desc gf-offline-note">${note}</p></div>`
        : `<div class="gf-detail-section"><p class="gf-detail-desc">${note}</p></div>`;
      openDetail(
        title,
        body,
        { kind: "pointlookup", lat, lon, id: `pt-${lat}-${lon}` },
        clientX,
        clientY
      );
      return;
    }

    openDetail(
      title,
      overlayHtml +
        `<div class="gf-detail-section"><div class="gf-detail-section-title">Live weather (Open-Meteo)</div>` +
        `<p class="gf-detail-desc">Loading weather, air quality &amp; marine…</p></div>`,
      { kind: "pointlookup", lat, lon, id: `pt-${lat}-${lon}` },
      clientX,
      clientY
    );
    GL().fetchPointWeather(dataApi, lat, lon).then((bundle) => {
      const c = bundle?.weather?.current || {};
      const m = bundle?.marine?.current || {};
      const aq = bundle?.airQuality?.current || {};
      const wx = GL().weatherLabel(c.weather_code);
      const body = overlayHtml +
        `<div class="gf-detail-section"><div class="gf-detail-section-title">Weather</div><dl>` +
        dlRow("Conditions", esc(wx)) +
        dlRow("Temperature", c.temperature_2m != null ? `${c.temperature_2m.toFixed(1)} °C` : null) +
        dlRow("Wind", c.wind_speed_10m != null ? `${c.wind_speed_10m} km/h` : null) +
        dlRow("Humidity", c.relative_humidity_2m != null ? `${c.relative_humidity_2m}%` : null) +
        `</dl></div>` +
        (m.sea_surface_temperature != null || m.wave_height != null
          ? `<div class="gf-detail-section"><div class="gf-detail-section-title">Marine</div><dl>` +
            dlRow("SST", m.sea_surface_temperature != null ? `${m.sea_surface_temperature.toFixed(1)} °C` : null) +
            dlRow("Wave height", m.wave_height != null ? `${m.wave_height} m` : null) +
            dlRow("Current", m.ocean_current_velocity != null ? `${m.ocean_current_velocity} m/s` : null) +
            `</dl></div>` : "") +
        (aq.us_aqi != null || aq.pm2_5 != null
          ? `<div class="gf-detail-section"><div class="gf-detail-section-title">Air quality</div><dl>` +
            dlRow("US AQI", aq.us_aqi != null ? String(aq.us_aqi) : null) +
            dlRow("PM2.5", aq.pm2_5 != null ? `${aq.pm2_5} µg/m³` : null) +
            `</dl></div>` : "");
      panelEl.querySelector(".gf-feed-body").innerHTML = body;
    }).catch((err) => {
      const isOffline = !navigator.onLine || err instanceof TypeError;
      const msg = isOffline
        ? 'Weather data unavailable — check your connection'
        : esc(err.message);
      panelEl.querySelector(".gf-feed-body").innerHTML = overlayHtml +
        `<div class="gf-detail-section"><p class="gf-detail-desc" style="color:#fca5a5">${msg}</p></div>`;
    });
  }

  function showFeedDetail(item, clientX, clientY) {
    if (item.kind === "earthquake") return showQuakeDetail(item, clientX, clientY);
    if (item.kind === "marine") return showMarineDetail(item, clientX, clientY);
  }

  function magRadius(mag) {
    return Math.max(4, Math.min(14, 3 + (mag || 0) * 1.8));
  }

  function drawMarkers() {
    if (feed.markerSvg) feed.markerSvg.style.display = api.isDragging ? "none" : "";
    while (gFeed.firstChild) gFeed.removeChild(gFeed.firstChild);
    const proj = api.projection;
    const TR = Math.PI / 180;
    const cv = proj.invert(proj.translate());
    const cSin = cv ? Math.sin(cv[1] * TR) : 0;
    const cCos = cv ? Math.cos(cv[1] * TR) : 1;
    const cLon = cv ? cv[0] * TR : 0;
    for (const item of feed.data.values()) {
      const show =
        (item.kind === "earthquake" && feed.enabled.has("earthquakes")) ||
        (item.kind === "marine" && feed.enabled.has("marine"));
      if (!show) continue;
      const pt = proj([item.lon, item.lat]);
      if (!pt) continue;
      if (cv && Math.sin(item.lat * TR) * cSin + Math.cos(item.lat * TR) * cCos * Math.cos(item.lon * TR - cLon) < 0) continue;
      const col = KIND_COLOR[item.kind] || "#fff";
      const sel = feed.selected === item.id;
      const g = api.A.el("g", {
        "data-feed-id": item.id,
        transform: `translate(${pt[0]},${pt[1]})`,
        "pointer-events": "all",
      }, gFeed);
      g.style.cursor = "pointer";
      const hitR = item.kind === "earthquake" ? magRadius(item.mag) + 12 : 16;
      api.A.el("circle", {
        r: hitR, fill: "transparent", stroke: "none", "pointer-events": "all",
      }, g);
      if (item.kind === "earthquake") {
        const r = magRadius(item.mag);
        api.A.el("circle", {
          r, fill: col, "fill-opacity": sel ? 0.95 : 0.55,
          stroke: col, "stroke-width": sel ? 2 : 1, "pointer-events": "none",
        }, g);
        if (item.mag != null) {
          api.A.el("text", {
            y: 3, "text-anchor": "middle", fill: "#061119",
            "font-size": Math.max(7, r * 0.75), "font-weight": 700,
            text: String(item.mag.toFixed(1)), "pointer-events": "none",
          }, g);
        }
      } else {
        api.A.el("circle", {
          r: sel ? 7 : 5, fill: col, "fill-opacity": 0.85,
          stroke: "#061119", "stroke-width": 1, "pointer-events": "none",
        }, g);
      }
    }
  }

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || "";
  }

  function syncRows() {
    if (uiRows.eq) {
      uiRows.eq.classList.toggle("on", feed.enabled.has("earthquakes"));
      uiRows.eq.classList.toggle("off", !feed.enabled.has("earthquakes"));
    }
    if (uiRows.marine) {
      uiRows.marine.classList.toggle("on", feed.enabled.has("marine"));
      uiRows.marine.classList.toggle("off", !feed.enabled.has("marine"));
    }
    if (uiRows.point) {
      uiRows.point.classList.toggle("on", feed.pointClick);
      uiRows.point.classList.toggle("off", !feed.pointClick);
    }
  }

  function purgeFeedKind(kind) {
    for (const [k, v] of feed.data) {
      if (v.kind === kind) feed.data.delete(k);
    }
  }

  async function refreshFeeds() {
    if (feed.loading) {
      feed.pendingRefresh = true;
      return;
    }
    if (!feed.online) {
      setStatus("Offline — cannot fetch live feeds");
      return;
    }
    feed.loading = true;
    setStatus("Fetching…");
    const tasks = [];
    if (feed.enabled.has("earthquakes")) {
      purgeFeedKind("earthquake");
      drawMarkers();
      tasks.push(
        GL().fetchEarthquakes(dataApi, { mag: feed.quakeMag, period: feed.quakePeriod, useCustom: false })
          .then((m) => m.forEach((v, k) => feed.data.set(k, v)))
      );
    } else {
      purgeFeedKind("earthquake");
      drawMarkers();
    }
    if (feed.enabled.has("marine")) {
      purgeFeedKind("marine");
      if (!feed.enabled.has("earthquakes")) drawMarkers();
      tasks.push(GL().fetchMarine(dataApi).then((m) => m.forEach((v, k) => feed.data.set(k, v))));
    } else {
      purgeFeedKind("marine");
      if (!feed.enabled.has("earthquakes")) drawMarkers();
    }
    try {
      await Promise.all(tasks);
      const nEq = [...feed.data.values()].filter((v) => v.kind === "earthquake").length;
      const nMar = [...feed.data.values()].filter((v) => v.kind === "marine").length;
      const parts = [];
      if (feed.enabled.has("earthquakes")) parts.push(`${nEq} quakes (M${feed.quakeMag}+ · ${feed.quakePeriod})`);
      if (feed.enabled.has("marine")) parts.push(`${nMar} marine`);
      setStatus(`Updated ${new Date().toLocaleTimeString()}${parts.length ? " · " + parts.join(" · ") : ""}`);
      drawMarkers();
    } catch (err) {
      setStatus(`Error: ${err.message}`);
      console.error("[GlobeFeeds]", err);
      drawMarkers();
    } finally {
      feed.loading = false;
      if (feed.pendingRefresh) {
        feed.pendingRefresh = false;
        refreshFeeds();
      }
    }
  }

  function toggleLayer(id, on) {
    if (id === "pointclick") {
      feed.pointClick = on;
      syncRows();
      return;
    }
    if ((id === "earthquakes" || id === "marine") && on && !feed.online) {
      setStatus("Offline — connect to network for live feeds");
      return;
    }
    if (on) feed.enabled.add(id);
    else feed.enabled.delete(id);
    syncRows();
    if (feed.enabled.size) refreshFeeds();
    else drawMarkers();
  }

  function buildUi() {
    if (document.getElementById("gf-feeds-grp")) return true;
    const groupsEl = document.getElementById("groups");
    if (!groupsEl) return false;

    const sec = document.createElement("div");
    sec.className = "grp collapsible";
    sec.id = "gf-feeds-grp";
    sec.innerHTML =
      '<div class="grp-head" data-grp="live-feeds">' +
      '<span class="grp-caret">▸</span>' +
      '<span class="grp-name">Live data feeds</span>' +
      '<span class="toggle-all" data-grp="live-feeds">all</span>' +
      "</div><div class=\"grp-body\" style=\"display:none\"></div>";
    const body = sec.querySelector(".grp-body");

    function addRow(id, label, swHtml, on) {
      const row = document.createElement("div");
      row.className = "row" + (on ? " on" : " off");
      row.dataset.gfLayer = id;
      row.innerHTML = `<span class="chk">${CHK}</span><span class="sw">${swHtml}</span><span class="lbl">${label}</span>`;
      row.addEventListener("click", () => toggleLayer(id, id === "pointclick" ? !feed.pointClick : !feed.enabled.has(id)));
      body.appendChild(row);
      return row;
    }

    uiRows.eq = addRow("earthquakes", "Earthquakes (USGS)", '<span class="swc" style="background:#ff6b4a;box-shadow:0 0 6px #ff6b4a"></span>', false);
    uiRows.marine = addRow("marine", "Marine coastal (27)", '<span class="swc" style="background:#38e0a0;box-shadow:0 0 6px #38e0a0"></span>', false);
    uiRows.point = addRow("pointclick", "Point-click lookup", '<span class="swc" style="background:#7fd0ff;box-shadow:0 0 6px #7fd0ff"></span>', true);
    feed.pointClick = true;

    const ctrl = document.createElement("div");
    ctrl.className = "gf-feed-ctrl";
    ctrl.innerHTML =
      '<label>Mag <select id="gf-quake-mag"><option value="2.5">M2.5+</option><option value="4.5">M4.5+</option><option value="1.0">M1.0+</option></select></label>' +
      '<label>Period <select id="gf-quake-period"><option value="day">Day</option><option value="week" selected>Week</option><option value="month">Month</option></select></label>' +
      '<button type="button" id="gf-fetch">Fetch now</button>' +
      '<div class="gf-status" id="gf-status"></div>';
    body.appendChild(ctrl);
    statusEl = ctrl.querySelector("#gf-status");
    ctrl.querySelector("#gf-quake-mag").value = feed.quakeMag;
    ctrl.querySelector("#gf-quake-period").value = feed.quakePeriod;

    ctrl.querySelector("#gf-quake-mag").addEventListener("change", (e) => {
      feed.quakeMag = e.target.value;
      if (feed.enabled.has("earthquakes")) refreshFeeds();
    });
    ctrl.querySelector("#gf-quake-period").addEventListener("change", (e) => {
      feed.quakePeriod = e.target.value;
      if (feed.enabled.has("earthquakes")) refreshFeeds();
    });
    ctrl.querySelector("#gf-quake-mag").addEventListener("mousedown", (e) => e.stopPropagation());
    ctrl.querySelector("#gf-quake-period").addEventListener("mousedown", (e) => e.stopPropagation());
    ctrl.querySelector("#gf-quake-mag").addEventListener("click", (e) => e.stopPropagation());
    ctrl.querySelector("#gf-quake-period").addEventListener("click", (e) => e.stopPropagation());
    ctrl.querySelector("#gf-fetch").addEventListener("click", (e) => {
      e.stopPropagation();
      if (!feed.enabled.has("earthquakes") && !feed.enabled.has("marine")) {
        feed.enabled.add("earthquakes");
        syncRows();
      }
      refreshFeeds();
    });

    sec.querySelector(".grp-head").addEventListener("click", (e) => {
      if (e.target.classList.contains("toggle-all")) return;
      const b = sec.querySelector(".grp-body");
      const caret = sec.querySelector(".grp-caret");
      const hidden = b.style.display === "none";
      b.style.display = hidden ? "" : "none";
      caret.textContent = hidden ? "▾" : "▸";
    });
    sec.querySelector(".toggle-all").addEventListener("click", (e) => {
      e.stopPropagation();
      const anyOff = !feed.enabled.has("earthquakes") || !feed.enabled.has("marine");
      toggleLayer("earthquakes", anyOff);
      toggleLayer("marine", anyOff);
    });

    groupsEl.appendChild(sec);
    syncOnlineUi();
    return true;
  }

  let _globePick = null;
  window.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".ctrl,.gf-feed-detail,.nc-plot-win,#info-panel,[data-info],.pw-tabs,.pw-map-opts,.gp-zoomctrl")) return;
    _globePick = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }, true);

  window.addEventListener("pointerup", (e) => {
    if (!_globePick || e.pointerId !== _globePick.id) return;
    const moved = Math.hypot(e.clientX - _globePick.x, e.clientY - _globePick.y);
    _globePick = null;
    if (moved > 10 || globeBusy()) return;
    if (e.target.closest(".ctrl,.gf-feed-detail,.nc-plot-win,#info-panel,[data-info],.nc-trend-dlg,.nc-derive-dlg,.nc-corr-dlg,.nc-comp-dlg,.nc-eof-dlg,.nc-regr-dlg,#nomads-modal,#help-modal,.nc-csv-menu,.ann-form,.gp-zoomctrl")) return;

    const feedG = e.target.closest("[data-feed-id]");
    const domHit = feedG ? feed.data.get(feedG.getAttribute("data-feed-id")) : null;
    const hit = domHit || pickFeedAtScreen(e.clientX, e.clientY);
    if (hit) {
      e.preventDefault();
      e.stopPropagation();
      showFeedDetail(hit, e.clientX, e.clientY);
      return;
    }

    const ll = lonLatOnGlobe(e);
    if (!ll) return;

    // Overlay grid values are always inspectable, even with point-click
    // lookup toggled off or while offline; the toggle only gates Open-Meteo.
    const overlaysOn = overlayList().some((o) => o?.enabled !== false && o.renderSlice);
    // With lookup disabled, an active overlay is the only reason to inspect.
    // No overlay + toggle off deliberately leaves ordinary globe clicks alone.
    if (!feed.pointClick && !overlaysOn) return;
    if (isFloatingPanelOpen()) return;

    e.preventDefault();
    e.stopPropagation();
    showPointDetail(ll[0], ll[1], e.clientX, e.clientY);
  }, true);

  // Belt-and-braces marker sync: drawMarkers() is cheap (it only repositions
  // the handful of existing <g> elements against the live projection), so
  // rather than rely solely on this module's onRedraw hook firing at the
  // right moment in the chain of wrapped redraw callbacks, also re-sync on
  // every animation frame while any feed layer is enabled. This guarantees
  // markers stay glued to the globe through rotation/zoom/resize even if a
  // future change breaks or reorders the onRedraw chain upstream.
  let _markerSyncRAF = null;
  let _markerSyncLastRot = null;
  function _markerSyncTick() {
    _markerSyncRAF = null;
    if (feed.enabled.size && feed.data.size && !api.isDragging) {
      const rot = api.projection?.rotate?.();
      const rotKey = rot ? rot.join(",") + "|" + api.projection.scale() : null;
      if (rotKey !== _markerSyncLastRot) {
        _markerSyncLastRot = rotKey;
        drawMarkers();
      }
    }
    _markerSyncRAF = requestAnimationFrame(_markerSyncTick);
  }
  _markerSyncTick();

  const prevRedraw = api.onRedraw;
  api.onRedraw = function () {
    if (typeof prevRedraw === "function") prevRedraw();
    if (api.isDragging) {
      if (feed.markerSvg) feed.markerSvg.style.display = "none";
      return;
    }
    if (feed.markerSvg) feed.markerSvg.style.display = "";
    drawMarkers();
  };

  function tryBuildUi() {
    if (document.getElementById("gf-feeds-grp")) return true;
    return buildUi();
  }
  if (!tryBuildUi()) {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (tryBuildUi() || Date.now() - t0 > 8000) clearInterval(iv);
    }, 200);
    const _origReorg = window.reorgWorkspacePanel;
    window.reorgWorkspacePanel = function () {
      if (_origReorg) _origReorg();
      tryBuildUi();
    };
  }
  api.redraw();
  window.GlobeFeedsAPI = { refresh: refreshFeeds, showPoint: showPointDetail, feed };
  console.log("[GlobeFeeds] ready");
};

(function bootGlobeFeeds() {
  function boot() {
    if (window._globeFeedsDone || !window.GlobeAPI || !window.GlobeFeeds) return;
    window._globeFeedsDone = 1;
    window.GlobeFeeds(window.GlobeAPI);
  }
  boot();
  let n = 0;
  const iv = setInterval(() => {
    boot();
    if (window._globeFeedsDone || ++n > 100) clearInterval(iv);
  }, 50);
})();

