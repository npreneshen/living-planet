
/* ==== NOMADS DIRECT LOADER =================================================
   Fetches GRIB2 fields straight from NOAA's open-data S3 mirrors (which,
   unlike nomads.ncep.noaa.gov itself, send CORS headers so a browser page
   may read the bytes). Uses the .idx sidecar to locate just the selected
   variable/level messages and issues HTTP Range requests for those bytes
   only — a 2-variable load moves ~100-500 KB instead of a 500 MB file.
   The assembled blob is handed to the app through the same drop pipeline
   as a user-dropped .grib2 file, so decoding/overlay behaviour is
   identical to a manual load. */
(function(){
  const NOMADS_VAR_INFO = {"4LFTX": {"name": "Best lifted index", "desc": "Best (most unstable) lifted index in °C. Negative values suggest greater thunderstorm potential."}, "5WAVH": {"name": "5-wave geopotential height", "desc": "5-wave geopotential height anomaly — large-scale atmospheric wave pattern aloft."}, "ABSV": {"name": "Absolute vorticity", "desc": "Absolute vorticity (rotation of the air) in s⁻¹. Highlights troughs, jets, and cyclonic spin."}, "ACOND": {"name": "Aerodynamic conductance", "desc": "Aerodynamic conductance — how easily heat/moisture can transfer between surface and atmosphere."}, "ACPCP": {"name": "Convective Precipitation", "desc": "Convective precipitation accumulated over the forecast period (showers/thunderstorms)."}, "ALBDO": {"name": "Albedo", "desc": "Surface albedo — fraction of incoming sunlight reflected by the ground (0–1)."}, "AOTK": {"name": "Aerosol Optical Thickness", "desc": "Aerosol optical thickness — how much airborne particles attenuate sunlight."}, "APCP": {"name": "Total Precipitation", "desc": "Total accumulated precipitation (rain plus melted snow/ice) over the forecast period."}, "APTMP": {"name": "Apparent Temperature", "desc": "Apparent temperature — “feels like” temperature combining heat and humidity/wind."}, "ASYSFK": {"name": "Asymmetry Factor", "desc": "Asymmetric system-scale kinetic energy — large-scale flow asymmetry in the atmosphere."}, "BRTMP": {"name": "Brightness temperature", "desc": "Brightness temperature from satellite-style channels — proxy for cloud/top temperature."}, "CAPE": {"name": "Convective available potential energy", "desc": "Convective Available Potential Energy (J/kg) — fuel available for buoyant updrafts and thunderstorms."}, "CDUVB": {"name": "Clear sky UV-B downward solar flux", "desc": "Clear-sky UV index — sunburn risk if clouds were absent."}, "CFRZR": {"name": "Categorical freezing rain", "desc": "Categorical freezing rain (yes/no) at the surface."}, "CICEP": {"name": "Categorical ice pellets", "desc": "Categorical ice pellets/sleet (yes/no) at the surface."}, "CIN": {"name": "Convective inhibition", "desc": "Convective Inhibition (J/kg) — cap suppressing updrafts; high CIN limits storm development."}, "CLWMR": {"name": "Cloud mixing ratio", "desc": "Cloud liquid water mixing ratio — liquid water content within clouds."}, "CNWAT": {"name": "Plant canopy surface water", "desc": "Plant canopy water — water stored on vegetation surfaces."}, "COLMD": {"name": "Column-Integrated Mass Density", "desc": "Pressure level of the lifted condensation level — cloud base height proxy."}, "CPOFP": {"name": "Percent frozen precipitation", "desc": "Probability of frozen precipitation (%)."}, "CPRAT": {"name": "Convective precipitation rate", "desc": "Convective precipitation rate — instantaneous rain rate from convection (mm/s)."}, "CRAIN": {"name": "Categorical rain", "desc": "Categorical rain (yes/no) at the surface."}, "CSDLF": {"name": "Clear Sky downward long wave flux", "desc": "Clear-sky downward longwave radiation — infrared emitted by atmosphere to surface."}, "CSDSF": {"name": "Clear Sky Downward Solar Flux", "desc": "Clear-sky downward shortwave radiation — sunlight reaching surface without clouds."}, "CSNOW": {"name": "Categorical snow", "desc": "Categorical snow (yes/no) at the surface."}, "CSULF": {"name": "Clear Sky Downward Solar Flux", "desc": "Clear-sky upward longwave radiation — infrared emitted from surface to space."}, "CSUSF": {"name": "Clear Sky Upward Solar Flux", "desc": "Clear-sky upward shortwave radiation — sunlight reflected from surface."}, "CWAT": {"name": "Cloud water", "desc": "Total column cloud water — integrated liquid water in the atmospheric column."}, "CWORK": {"name": "Cloud work function", "desc": "Cloud work function — energy measure related to cloud vertical development."}, "DLWRF": {"name": "Downward long-wave radiation flux", "desc": "Downward longwave (infrared) radiation flux at the surface — “greenhouse” heating from sky."}, "DPT": {"name": "Dew point temperature", "desc": "Dew point temperature — temperature to which air must cool to become saturated."}, "DSWRF": {"name": "Downward short-wave radiation flux", "desc": "Downward shortwave (solar) radiation flux at the surface — sunlight energy received."}, "DUVB": {"name": "UV-B downward solar flux", "desc": "UV-B radiation flux at the surface — biologically active ultraviolet sunlight."}, "DZDT": {"name": "Vertical velocity", "desc": "Vertical motion stability term (vertical gradient of geopotential) — related to atmospheric stability."}, "EVBS": {"name": "Direct evaporation from bare soil", "desc": "Direct evaporation from bare soil moisture."}, "EVCW": {"name": "Canopy water evaporation", "desc": "Canopy water evaporation — evaporation from water on leaves."}, "FLDCP": {"name": "Field capacity", "desc": "Field capacity of soil — maximum soil moisture before runoff begins."}, "FRICV": {"name": "Surface friction velocity", "desc": "Frictional velocity — surface turbulence scale related to stress and mixing."}, "GFLUX": {"name": "Ground heat flux", "desc": "Ground heat flux — heat conducted into or out of the soil (W/m²)."}, "GRLE": {"name": "Graupel", "desc": "Graupel (soft hail) mixing ratio in clouds."}, "GUST": {"name": "Wind speed (gust)", "desc": "Wind speed of gusts — short-lived peak wind above sustained speed."}, "HCDC": {"name": "High Cloud Cover", "desc": "High cloud cover fraction (cirrus-type clouds, typically above ~6 km)."}, "HGT": {"name": "Geopotential height", "desc": "Geopotential height of a pressure surface — standard field for upper-air weather maps."}, "HINDEX": {"name": "HINDEX", "desc": "Haines Index — fire-weather severity based on stability and dryness."}, "HLCY": {"name": "Storm relative helicity", "desc": "Storm-relative helicity — rotation potential for supercells (m²/s²)."}, "HPBL": {"name": "Planetary boundary layer height", "desc": "Planetary boundary layer height — depth of the mixed surface layer."}, "ICAHT": {"name": "ICAO standard atmosphere reference height", "desc": "ICAO standard atmosphere height — aircraft/flight-level reference altitude."}, "ICEC": {"name": "Ice cover", "desc": "Ice cover fraction on surface water (0–1)."}, "ICEG": {"name": "Ice Growth Rate", "desc": "Ice age category on sea/lake ice."}, "ICETK": {"name": "Ice thickness", "desc": "Ice thickness on surface water bodies."}, "ICETMP": {"name": "Ice temperature", "desc": "Ice surface temperature."}, "ICIP": {"name": "Icing", "desc": "Icing severity index — potential for aircraft icing."}, "ICMR": {"name": "Ice water mixing ratio", "desc": "Ice crystal mixing ratio in clouds."}, "ICSEV": {"name": "Icing severity", "desc": "Icing severity category for aviation."}, "LAND": {"name": "Land cover", "desc": "Land cover mask (land vs water)."}, "LCDC": {"name": "Low Cloud Cover", "desc": "Low cloud cover fraction (stratus/stratocumulus, typically below ~2 km)."}, "LFTX": {"name": "Surface lifted index", "desc": "Surface-based lifted index (°C) — stability indicator for thunderstorms."}, "LHTFL": {"name": "Latent heat net flux", "desc": "Latent heat flux — energy carried by evaporation/condensation (W/m²)."}, "MCDC": {"name": "Middle Cloud Cover", "desc": "Middle cloud cover fraction (altostratus/altocumulus, ~2–6 km)."}, "MNTSF": {"name": "Montgomery stream function", "desc": "Montgomery stream function — specialized dynamical variable on isentropic surfaces."}, "MSLET": {"name": "MSLP (Eta model reduction)", "desc": "Mean sea level pressure (ETA reduction method) — surface pressure adjusted to sea level."}, "NBDSF": {"name": "Near IR beam downward solar flux", "desc": "Near-IR beam downward solar flux at surface (direct sunlight component)."}, "NCPCP": {"name": "Large scale precipitation (non-conv.)", "desc": "Large-scale (non-convective) accumulated precipitation."}, "NDDSF": {"name": "Near IR diffuse downward solar flux", "desc": "Near-IR diffuse downward solar flux at surface (scattered sunlight)."}, "O3MR": {"name": "Ozone mixing ratio", "desc": "Ozone mixing ratio — stratospheric/tropospheric ozone concentration."}, "PEVPR": {"name": "Potential Evaporation Rate", "desc": "Potential evaporation rate — maximum possible evaporation given energy supply."}, "PLI": {"name": "Parcel lifted index (to 500 hPa)", "desc": "Parcel lifted index — thunderstorm stability from a lifted parcel."}, "PLPL": {"name": "Pressure of level from which parcel was lifted", "desc": "Pressure of parcel equilibrium level — top of positive buoyancy for a lifted parcel."}, "PMTC": {"name": "Particulate matter (coarse)", "desc": "Particulate matter (coarse) — aerosol mass concentration proxy."}, "PMTF": {"name": "Particulate matter (fine)", "desc": "Particulate matter (fine) — aerosol mass concentration proxy."}, "POT": {"name": "Potential Temperature", "desc": "Potential temperature — temperature a parcel would have if brought adiabatically to 1000 mb."}, "PRATE": {"name": "Precipitation Rate", "desc": "Precipitation rate — instantaneous rain/snow rate (kg/m²/s, often shown as mm/hr)."}, "PRES": {"name": "Pressure", "desc": "Air pressure at the selected level."}, "PRMSL": {"name": "Pressure Reduced to MSL", "desc": "Pressure reduced to mean sea level — classic surface weather map field (hPa)."}, "PVORT": {"name": "Potential vorticity", "desc": "Potential vorticity — combines rotation and stability; tracks air masses and jet dynamics."}, "PWAT": {"name": "Precipitable Water", "desc": "Precipitable water — total column water vapor if condensed (mm); moisture availability."}, "QMAX": {"name": "Maximum specific humidity at 2m", "desc": "Maximum specific humidity in the column."}, "QMIN": {"name": "Minimum specific humidity at 2m", "desc": "Minimum specific humidity in the column."}, "REFC": {"name": "Composite reflectivity", "desc": "Composite radar reflectivity — simulated echo intensity through the column (dBZ)."}, "REFD": {"name": "Reflectivity", "desc": "Radar reflectivity at a level — simulated precipitation echo strength."}, "RH": {"name": "Relative Humidity", "desc": "Relative humidity (%) — actual vapor pressure as fraction of saturation at that level."}, "RWMR": {"name": "Rain Mixing Ratio", "desc": "Rain water mixing ratio — liquid rain content in the air."}, "SBSNO": {"name": "Sublimation (evaporation from snow)", "desc": "Sub-surface snow melt — melting below the snow surface."}, "SCTAOTK": {"name": "Scattering Aerosol Optical Thickness", "desc": "Scattering aerosol optical thickness — particle effect on sunlight."}, "SFCR": {"name": "Surface roughness", "desc": "Surface roughness length — terrain roughness affecting friction and wind."}, "SFEXC": {"name": "Sedimentation Mass Flux", "desc": "Exchange coefficient for surface flux calculations."}, "SHTFL": {"name": "Sensible Heat Net Flux", "desc": "Sensible heat flux — direct heating of air by warm/cold surface (W/m²)."}, "SLTYP": {"name": "Surface slope type", "desc": "Soil type category from land-surface model."}, "SNMR": {"name": "Snow Mixing Ratio", "desc": "Snow mixing ratio — snowflake content in the air."}, "SNOD": {"name": "Snow Depth", "desc": "Snow depth on the ground (m)."}, "SNOHF": {"name": "Snow phase-change heat flux", "desc": "Snow phase change heat flux — energy from melting/freezing snow."}, "SNOWC": {"name": "Snow Cover", "desc": "Snow cover fraction on land (0–1)."}, "SOILL": {"name": "Liquid volumetric soil moisture (non-frozen)", "desc": "Liquid soil moisture content by layer."}, "SOILM": {"name": "Soil moisture content", "desc": "Total soil moisture in the column."}, "SOILW": {"name": "Volumetric Soil Moisture Content", "desc": "Volumetric soil moisture — water fraction in soil layers."}, "SOTYP": {"name": "Soil type (as in Zobler)", "desc": "Surface type (land use/vegetation category)."}, "SPFH": {"name": "Specific Humidity", "desc": "Specific humidity — mass of water vapor per mass of moist air (kg/kg)."}, "SSALBK": {"name": "Single Scattering Albedo", "desc": "Sea salt aerosol optical thickness over oceans."}, "SSRUN": {"name": "Storm Surface runoff (non-infiltrating)", "desc": "Storm surface runoff — water leaving land during precipitation events."}, "SUNSD": {"name": "Sunshine Duration", "desc": "Sunshine duration — time sun is visible (when applicable)."}, "TCDC": {"name": "Total Cloud Cover", "desc": "Total cloud cover fraction (all layers combined, 0–100%)."}, "TMAX": {"name": "Maximum Temperature", "desc": "Maximum temperature over the accumulation period."}, "TMIN": {"name": "Minimum Temperature", "desc": "Minimum temperature over the accumulation period."}, "TMP": {"name": "Temperature", "desc": "Air temperature at the selected level or height (K in GRIB; often converted to °C)."}, "TOZNE": {"name": "Total ozone", "desc": "Total column ozone — integrated ozone from surface to top of atmosphere."}, "TRANS": {"name": "Transpiration", "desc": "Transmissivity — fraction of radiation passing through the atmosphere."}, "TSOIL": {"name": "Soil Temperaure", "desc": "Soil temperature by layer."}, "U-GWD": {"name": "Zonal flux of gravity wave stress", "desc": "East-west gravity wave drag stress on the atmosphere."}, "UFLX": {"name": "Momentum flux, u component", "desc": "East-west component of surface stress (momentum flux to atmosphere)."}, "UGRD": {"name": "U-Component of Wind", "desc": "U-component of wind — eastward wind speed (m/s); positive = from west."}, "ULWRF": {"name": "Upward long wave rad. flux", "desc": "Upward longwave radiation flux at the surface."}, "USTM": {"name": "u-component of storm motion", "desc": "U-component of storm motion — eastward storm translation speed."}, "USWRF": {"name": "Upward short wave radiation flux", "desc": "Upward shortwave (reflected solar) radiation flux at the surface."}, "V-GWD": {"name": "Meridional flux of gravity wave stress", "desc": "North-south gravity wave drag stress on the atmosphere."}, "VBDSF": {"name": "Visible beam downward solar flux", "desc": "Visible beam downward solar flux — direct visible sunlight at surface."}, "VDDSF": {"name": "Visible diffuse downward solar flux", "desc": "Visible diffuse downward solar flux — scattered visible sunlight."}, "VEG": {"name": "Vegetation", "desc": "Vegetation cover fraction."}, "VFLX": {"name": "Momentum flux, v component", "desc": "North-south component of surface stress."}, "VGRD": {"name": "V-Component of Wind", "desc": "V-component of wind — northward wind speed (m/s); positive = from south."}, "VGTYP": {"name": "Vegetation type", "desc": "Vegetation type category."}, "VIS": {"name": "Visibility", "desc": "Visibility — horizontal distance you can see (m); lower in fog/haze/precip."}, "VRATE": {"name": "Ventilation Rate", "desc": "Ventilation rate — air exchange in the boundary layer."}, "VSTM": {"name": "v-component of storm motion", "desc": "V-component of storm motion — northward storm translation speed."}, "VVEL": {"name": "Vertical velocity (pressure)", "desc": "Vertical velocity (Pa/s) — omega; negative often means rising air."}, "VWSH": {"name": "Vertical speed shear", "desc": "Vertical wind shear — change of wind with height; important for storm organization."}, "WATR": {"name": "Water runoff", "desc": "Water runoff from land surface."}, "WEASD": {"name": "Water equiv. of accum. snow depth", "desc": "Water equivalent of accumulated snow depth (snow-water equivalent, mm)."}, "WILT": {"name": "Wilting point", "desc": "Wilting point soil moisture — threshold below which plants cannot extract water."}, "WIND": {"name": "Wind Speed", "desc": "Wind speed (magnitude of horizontal wind)."}};
  const NOMADS_LEV_INFO = {"0-0.1_m_below_ground": {"name": "0-0.1 m below ground", "desc": "Subsurface level 0-0.1 m below ground — soil or ground layer used in land-surface models."}, "0-2_m_below_ground": {"name": "0-2 m below ground", "desc": "Subsurface level 0-2 m below ground — soil or ground layer used in land-surface models."}, "0.01_mb": {"name": "0.01 mb", "desc": "Constant pressure surface at 0.01 hPa (millibars) — standard meteorological height level."}, "0.02_mb": {"name": "0.02 mb", "desc": "Constant pressure surface at 0.02 hPa (millibars) — standard meteorological height level."}, "0.04_mb": {"name": "0.04 mb", "desc": "Constant pressure surface at 0.04 hPa (millibars) — standard meteorological height level."}, "0.07_mb": {"name": "0.07 mb", "desc": "Constant pressure surface at 0.07 hPa (millibars) — standard meteorological height level."}, "0.1-0.4_m_below_ground": {"name": "0.1-0.4 m below ground", "desc": "Subsurface level 0.1-0.4 m below ground — soil or ground layer used in land-surface models."}, "0.1_mb": {"name": "0.1 mb", "desc": "Constant pressure surface at 0.1 hPa (millibars) — standard meteorological height level."}, "0.2_mb": {"name": "0.2 mb", "desc": "Constant pressure surface at 0.2 hPa (millibars) — standard meteorological height level."}, "0.33-1_sigma_layer": {"name": "0.33-1 sigma layer", "desc": "Model sigma coordinate layer 0.33-1 sigma layer — terrain-following vertical level."}, "0.4-1_m_below_ground": {"name": "0.4-1 m below ground", "desc": "Subsurface level 0.4-1 m below ground — soil or ground layer used in land-surface models."}, "0.44-0.72_sigma_layer": {"name": "0.44-0.72 sigma layer", "desc": "Model sigma coordinate layer 0.44-0.72 sigma layer — terrain-following vertical level."}, "0.44-1_sigma_layer": {"name": "0.44-1 sigma layer", "desc": "Model sigma coordinate layer 0.44-1 sigma layer — terrain-following vertical level."}, "0.4_mb": {"name": "0.4 mb", "desc": "Constant pressure surface at 0.4 hPa (millibars) — standard meteorological height level."}, "0.72-0.94_sigma_layer": {"name": "0.72-0.94 sigma layer", "desc": "Model sigma coordinate layer 0.72-0.94 sigma layer — terrain-following vertical level."}, "0.7_mb": {"name": "0.7 mb", "desc": "Constant pressure surface at 0.7 hPa (millibars) — standard meteorological height level."}, "0.995_sigma_level": {"name": "0.995 sigma level", "desc": "Model sigma coordinate layer 0.995 sigma level — terrain-following vertical level."}, "0C_isotherm": {"name": "0C isotherm", "desc": "Height/level where temperature equals 0°C."}, "1-2_m_below_ground": {"name": "1-2 m below ground", "desc": "Subsurface level 1-2 m below ground — soil or ground layer used in land-surface models."}, "1000_m_above_ground": {"name": "1000 m above ground", "desc": "Fixed height 1000 m above ground — values represent conditions at that altitude above local ground."}, "1000_mb": {"name": "1000 mb", "desc": "Near-surface pressure level (~100 m elevation)."}, "100_m_above_ground": {"name": "100 m above ground", "desc": "100 meters above ground — hub-height wind for turbines and mixing layer."}, "100_mb": {"name": "100 mb", "desc": "Lower stratosphere (~16 km) — ozone and high-altitude flow."}, "10_hybrid_level": {"name": "10 hybrid level", "desc": "Model hybrid vertical coordinate 10 hybrid level."}, "10_m_above_ground": {"name": "10 m above ground", "desc": "10 meters above ground — standard height for sustained surface wind."}, "10_m_above_mean_sea_level": {"name": "10 m above mean sea level", "desc": "Vertical level: 10 m above mean sea level."}, "10_mb": {"name": "10 mb", "desc": "Upper stratosphere (~30 km)."}, "11_hybrid_level": {"name": "11 hybrid level", "desc": "Model hybrid vertical coordinate 11 hybrid level."}, "120-90_mb_above_ground": {"name": "120-90 mb above ground", "desc": "Fixed height 120-90 mb above ground — values represent conditions at that altitude above local ground."}, "125_mb": {"name": "125 mb", "desc": "Constant pressure surface at 125 hPa (millibars) — standard meteorological height level."}, "12_hybrid_level": {"name": "12 hybrid level", "desc": "Model hybrid vertical coordinate 12 hybrid level."}, "13_hybrid_level": {"name": "13 hybrid level", "desc": "Model hybrid vertical coordinate 13 hybrid level."}, "14_hybrid_level": {"name": "14 hybrid level", "desc": "Model hybrid vertical coordinate 14 hybrid level."}, "150-120_mb_above_ground": {"name": "150-120 mb above ground", "desc": "Fixed height 150-120 mb above ground — values represent conditions at that altitude above local ground."}, "150_mb": {"name": "150 mb", "desc": "High atmosphere pressure level (~13.5 km)."}, "15_hybrid_level": {"name": "15 hybrid level", "desc": "Model hybrid vertical coordinate 15 hybrid level."}, "15_mb": {"name": "15 mb", "desc": "Constant pressure surface at 15 hPa (millibars) — standard meteorological height level."}, "16_hybrid_level": {"name": "16 hybrid level", "desc": "Model hybrid vertical coordinate 16 hybrid level."}, "175_mb": {"name": "175 mb", "desc": "Constant pressure surface at 175 hPa (millibars) — standard meteorological height level."}, "17_hybrid_level": {"name": "17 hybrid level", "desc": "Model hybrid vertical coordinate 17 hybrid level."}, "180-0_mb_above_ground": {"name": "180-0 mb above ground", "desc": "Fixed height 180-0 mb above ground — values represent conditions at that altitude above local ground."}, "180-150_mb_above_ground": {"name": "180-150 mb above ground", "desc": "Fixed height 180-150 mb above ground — values represent conditions at that altitude above local ground."}, "1829_m_above_mean_sea_level": {"name": "1829 m above mean sea level", "desc": "Vertical level: 1829 m above mean sea level."}, "18_hybrid_level": {"name": "18 hybrid level", "desc": "Model hybrid vertical coordinate 18 hybrid level."}, "19_hybrid_level": {"name": "19 hybrid level", "desc": "Model hybrid vertical coordinate 19 hybrid level."}, "1_hybrid_level": {"name": "1 hybrid level", "desc": "Model hybrid vertical coordinate 1 hybrid level."}, "1_mb": {"name": "1 mb", "desc": "Constant pressure surface at 1 hPa (millibars) — standard meteorological height level."}, "200_mb": {"name": "200 mb", "desc": "Upper-level pressure level (~11.8 km) — jet core and aviation routing."}, "20_hybrid_level": {"name": "20 hybrid level", "desc": "Model hybrid vertical coordinate 20 hybrid level."}, "20_m_above_ground": {"name": "20 m above ground", "desc": "Fixed height 20 m above ground — values represent conditions at that altitude above local ground."}, "20_mb": {"name": "20 mb", "desc": "Constant pressure surface at 20 hPa (millibars) — standard meteorological height level."}, "21_hybrid_level": {"name": "21 hybrid level", "desc": "Model hybrid vertical coordinate 21 hybrid level."}, "225_mb": {"name": "225 mb", "desc": "Constant pressure surface at 225 hPa (millibars) — standard meteorological height level."}, "22_hybrid_level": {"name": "22 hybrid level", "desc": "Model hybrid vertical coordinate 22 hybrid level."}, "23_hybrid_level": {"name": "23 hybrid level", "desc": "Model hybrid vertical coordinate 23 hybrid level."}, "24_hybrid_level": {"name": "24 hybrid level", "desc": "Model hybrid vertical coordinate 24 hybrid level."}, "250_mb": {"name": "250 mb", "desc": "Upper-level pressure level (~10.5 km) — strong jet stream winds."}, "255-0_mb_above_ground": {"name": "255-0 mb above ground", "desc": "Fixed height 255-0 mb above ground — values represent conditions at that altitude above local ground."}, "25_hybrid_level": {"name": "25 hybrid level", "desc": "Model hybrid vertical coordinate 25 hybrid level."}, "26_hybrid_level": {"name": "26 hybrid level", "desc": "Model hybrid vertical coordinate 26 hybrid level."}, "2743_m_above_mean_sea_level": {"name": "2743 m above mean sea level", "desc": "Vertical level: 2743 m above mean sea level."}, "275_mb": {"name": "275 mb", "desc": "Constant pressure surface at 275 hPa (millibars) — standard meteorological height level."}, "27_hybrid_level": {"name": "27 hybrid level", "desc": "Model hybrid vertical coordinate 27 hybrid level."}, "28_hybrid_level": {"name": "28 hybrid level", "desc": "Model hybrid vertical coordinate 28 hybrid level."}, "29_hybrid_level": {"name": "29 hybrid level", "desc": "Model hybrid vertical coordinate 29 hybrid level."}, "2_hybrid_level": {"name": "2 hybrid level", "desc": "Model hybrid vertical coordinate 2 hybrid level."}, "2_m_above_ground": {"name": "2 m above ground", "desc": "2 meters above ground — standard height for near-surface temperature and humidity."}, "2_mb": {"name": "2 mb", "desc": "Constant pressure surface at 2 hPa (millibars) — standard meteorological height level."}, "30-0_mb_above_ground": {"name": "30-0 mb above ground", "desc": "Fixed height 30-0 mb above ground — values represent conditions at that altitude above local ground."}, "3000-0_m_above_ground": {"name": "3000-0 m above ground", "desc": "Fixed height 3000-0 m above ground — values represent conditions at that altitude above local ground."}, "300_mb": {"name": "300 mb", "desc": "Upper-level pressure level (~9 km) — jet stream altitude."}, "305_m_above_mean_sea_level": {"name": "305 m above mean sea level", "desc": "Vertical level: 305 m above mean sea level."}, "30_hybrid_level": {"name": "30 hybrid level", "desc": "Model hybrid vertical coordinate 30 hybrid level."}, "30_m_above_ground": {"name": "30 m above ground", "desc": "Fixed height 30 m above ground — values represent conditions at that altitude above local ground."}, "30_mb": {"name": "30 mb", "desc": "Constant pressure surface at 30 hPa (millibars) — standard meteorological height level."}, "310_K_isentropic_level": {"name": "310 K isentropic level", "desc": "Vertical level: 310 K isentropic level."}, "31_hybrid_level": {"name": "31 hybrid level", "desc": "Model hybrid vertical coordinate 31 hybrid level."}, "320_K_isentropic_level": {"name": "320 K isentropic level", "desc": "Vertical level: 320 K isentropic level."}, "325_mb": {"name": "325 mb", "desc": "Constant pressure surface at 325 hPa (millibars) — standard meteorological height level."}, "32_hybrid_level": {"name": "32 hybrid level", "desc": "Model hybrid vertical coordinate 32 hybrid level."}, "33_hybrid_level": {"name": "33 hybrid level", "desc": "Model hybrid vertical coordinate 33 hybrid level."}, "34_hybrid_level": {"name": "34 hybrid level", "desc": "Model hybrid vertical coordinate 34 hybrid level."}, "350_K_isentropic_level": {"name": "350 K isentropic level", "desc": "Vertical level: 350 K isentropic level."}, "350_mb": {"name": "350 mb", "desc": "Constant pressure surface at 350 hPa (millibars) — standard meteorological height level."}, "35_hybrid_level": {"name": "35 hybrid level", "desc": "Model hybrid vertical coordinate 35 hybrid level."}, "3658_m_above_mean_sea_level": {"name": "3658 m above mean sea level", "desc": "Vertical level: 3658 m above mean sea level."}, "36_hybrid_level": {"name": "36 hybrid level", "desc": "Model hybrid vertical coordinate 36 hybrid level."}, "375_mb": {"name": "375 mb", "desc": "Constant pressure surface at 375 hPa (millibars) — standard meteorological height level."}, "37_hybrid_level": {"name": "37 hybrid level", "desc": "Model hybrid vertical coordinate 37 hybrid level."}, "38_hybrid_level": {"name": "38 hybrid level", "desc": "Model hybrid vertical coordinate 38 hybrid level."}, "39_hybrid_level": {"name": "39 hybrid level", "desc": "Model hybrid vertical coordinate 39 hybrid level."}, "3_hybrid_level": {"name": "3 hybrid level", "desc": "Model hybrid vertical coordinate 3 hybrid level."}, "3_mb": {"name": "3 mb", "desc": "Constant pressure surface at 3 hPa (millibars) — standard meteorological height level."}, "4000_m_above_ground": {"name": "4000 m above ground", "desc": "Fixed height 4000 m above ground — values represent conditions at that altitude above local ground."}, "400_mb": {"name": "400 mb", "desc": "Upper-mid pressure level (~7.2 km)."}, "40_hybrid_level": {"name": "40 hybrid level", "desc": "Model hybrid vertical coordinate 40 hybrid level."}, "40_m_above_ground": {"name": "40 m above ground", "desc": "Fixed height 40 m above ground — values represent conditions at that altitude above local ground."}, "40_mb": {"name": "40 mb", "desc": "Constant pressure surface at 40 hPa (millibars) — standard meteorological height level."}, "41_hybrid_level": {"name": "41 hybrid level", "desc": "Model hybrid vertical coordinate 41 hybrid level."}, "425_mb": {"name": "425 mb", "desc": "Constant pressure surface at 425 hPa (millibars) — standard meteorological height level."}, "42_hybrid_level": {"name": "42 hybrid level", "desc": "Model hybrid vertical coordinate 42 hybrid level."}, "43_hybrid_level": {"name": "43 hybrid level", "desc": "Model hybrid vertical coordinate 43 hybrid level."}, "44_hybrid_level": {"name": "44 hybrid level", "desc": "Model hybrid vertical coordinate 44 hybrid level."}, "450_K_isentropic_level": {"name": "450 K isentropic level", "desc": "Vertical level: 450 K isentropic level."}, "450_mb": {"name": "450 mb", "desc": "Constant pressure surface at 450 hPa (millibars) — standard meteorological height level."}, "4572_m_above_mean_sea_level": {"name": "4572 m above mean sea level", "desc": "Vertical level: 4572 m above mean sea level."}, "457_m_above_mean_sea_level": {"name": "457 m above mean sea level", "desc": "Vertical level: 457 m above mean sea level."}, "45_hybrid_level": {"name": "45 hybrid level", "desc": "Model hybrid vertical coordinate 45 hybrid level."}, "46_hybrid_level": {"name": "46 hybrid level", "desc": "Model hybrid vertical coordinate 46 hybrid level."}, "475_mb": {"name": "475 mb", "desc": "Constant pressure surface at 475 hPa (millibars) — standard meteorological height level."}, "47_hybrid_level": {"name": "47 hybrid level", "desc": "Model hybrid vertical coordinate 47 hybrid level."}, "48_hybrid_level": {"name": "48 hybrid level", "desc": "Model hybrid vertical coordinate 48 hybrid level."}, "49_hybrid_level": {"name": "49 hybrid level", "desc": "Model hybrid vertical coordinate 49 hybrid level."}, "4_hybrid_level": {"name": "4 hybrid level", "desc": "Model hybrid vertical coordinate 4 hybrid level."}, "500_mb": {"name": "500 mb", "desc": "Mid-level pressure level (~5.5 km) — primary synoptic weather map level."}, "50_hybrid_level": {"name": "50 hybrid level", "desc": "Model hybrid vertical coordinate 50 hybrid level."}, "50_m_above_ground": {"name": "50 m above ground", "desc": "Fixed height 50 m above ground — values represent conditions at that altitude above local ground."}, "50_mb": {"name": "50 mb", "desc": "Mid-stratosphere (~20 km)."}, "51_hybrid_level": {"name": "51 hybrid level", "desc": "Model hybrid vertical coordinate 51 hybrid level."}, "525_mb": {"name": "525 mb", "desc": "Constant pressure surface at 525 hPa (millibars) — standard meteorological height level."}, "52_hybrid_level": {"name": "52 hybrid level", "desc": "Model hybrid vertical coordinate 52 hybrid level."}, "53_hybrid_level": {"name": "53 hybrid level", "desc": "Model hybrid vertical coordinate 53 hybrid level."}, "54_hybrid_level": {"name": "54 hybrid level", "desc": "Model hybrid vertical coordinate 54 hybrid level."}, "550_K_isentropic_level": {"name": "550 K isentropic level", "desc": "Vertical level: 550 K isentropic level."}, "550_mb": {"name": "550 mb", "desc": "Constant pressure surface at 550 hPa (millibars) — standard meteorological height level."}, "55_hybrid_level": {"name": "55 hybrid level", "desc": "Model hybrid vertical coordinate 55 hybrid level."}, "56_hybrid_level": {"name": "56 hybrid level", "desc": "Model hybrid vertical coordinate 56 hybrid level."}, "575_mb": {"name": "575 mb", "desc": "Constant pressure surface at 575 hPa (millibars) — standard meteorological height level."}, "57_hybrid_level": {"name": "57 hybrid level", "desc": "Model hybrid vertical coordinate 57 hybrid level."}, "58_hybrid_level": {"name": "58 hybrid level", "desc": "Model hybrid vertical coordinate 58 hybrid level."}, "59_hybrid_level": {"name": "59 hybrid level", "desc": "Model hybrid vertical coordinate 59 hybrid level."}, "5_hybrid_level": {"name": "5 hybrid level", "desc": "Model hybrid vertical coordinate 5 hybrid level."}, "5_mb": {"name": "5 mb", "desc": "Constant pressure surface at 5 hPa (millibars) — standard meteorological height level."}, "60-30_mb_above_ground": {"name": "60-30 mb above ground", "desc": "Fixed height 60-30 mb above ground — values represent conditions at that altitude above local ground."}, "6000-0_m_above_ground": {"name": "6000-0 m above ground", "desc": "Fixed height 6000-0 m above ground — values represent conditions at that altitude above local ground."}, "600_mb": {"name": "600 mb", "desc": "Mid-level pressure level (~4.2 km)."}, "60_hybrid_level": {"name": "60 hybrid level", "desc": "Model hybrid vertical coordinate 60 hybrid level."}, "610_m_above_mean_sea_level": {"name": "610 m above mean sea level", "desc": "Vertical level: 610 m above mean sea level."}, "61_hybrid_level": {"name": "61 hybrid level", "desc": "Model hybrid vertical coordinate 61 hybrid level."}, "625_mb": {"name": "625 mb", "desc": "Constant pressure surface at 625 hPa (millibars) — standard meteorological height level."}, "62_hybrid_level": {"name": "62 hybrid level", "desc": "Model hybrid vertical coordinate 62 hybrid level."}, "63_hybrid_level": {"name": "63 hybrid level", "desc": "Model hybrid vertical coordinate 63 hybrid level."}, "64_hybrid_level": {"name": "64 hybrid level", "desc": "Model hybrid vertical coordinate 64 hybrid level."}, "650_K_isentropic_level": {"name": "650 K isentropic level", "desc": "Vertical level: 650 K isentropic level."}, "650_mb": {"name": "650 mb", "desc": "Constant pressure surface at 650 hPa (millibars) — standard meteorological height level."}, "675_mb": {"name": "675 mb", "desc": "Constant pressure surface at 675 hPa (millibars) — standard meteorological height level."}, "6_hybrid_level": {"name": "6 hybrid level", "desc": "Model hybrid vertical coordinate 6 hybrid level."}, "700_mb": {"name": "700 mb", "desc": "Mid-low pressure level (~3 km) — rising motion and cloud formation zone."}, "70_mb": {"name": "70 mb", "desc": "Constant pressure surface at 70 hPa (millibars) — standard meteorological height level."}, "725_mb": {"name": "725 mb", "desc": "Constant pressure surface at 725 hPa (millibars) — standard meteorological height level."}, "750_mb": {"name": "750 mb", "desc": "Constant pressure surface at 750 hPa (millibars) — standard meteorological height level."}, "775_mb": {"name": "775 mb", "desc": "Constant pressure surface at 775 hPa (millibars) — standard meteorological height level."}, "7_hybrid_level": {"name": "7 hybrid level", "desc": "Model hybrid vertical coordinate 7 hybrid level."}, "7_mb": {"name": "7 mb", "desc": "Constant pressure surface at 7 hPa (millibars) — standard meteorological height level."}, "800_mb": {"name": "800 mb", "desc": "Constant pressure surface at 800 hPa (millibars) — standard meteorological height level."}, "80_m_above_ground": {"name": "80 m above ground", "desc": "Fixed height 80 m above ground — values represent conditions at that altitude above local ground."}, "825_mb": {"name": "825 mb", "desc": "Constant pressure surface at 825 hPa (millibars) — standard meteorological height level."}, "850_mb": {"name": "850 mb", "desc": "Low-level pressure level (~1.5 km) — moisture, warm advection, and winter precipitation."}, "875_mb": {"name": "875 mb", "desc": "Constant pressure surface at 875 hPa (millibars) — standard meteorological height level."}, "8_hybrid_level": {"name": "8 hybrid level", "desc": "Model hybrid vertical coordinate 8 hybrid level."}, "90-0_mb_above_ground": {"name": "90-0 mb above ground", "desc": "Fixed height 90-0 mb above ground — values represent conditions at that altitude above local ground."}, "90-60_mb_above_ground": {"name": "90-60 mb above ground", "desc": "Fixed height 90-60 mb above ground — values represent conditions at that altitude above local ground."}, "900_mb": {"name": "900 mb", "desc": "Constant pressure surface at 900 hPa (millibars) — standard meteorological height level."}, "914_m_above_mean_sea_level": {"name": "914 m above mean sea level", "desc": "Vertical level: 914 m above mean sea level."}, "925_mb": {"name": "925 mb", "desc": "Low-level pressure level (~760 m) — warm-sector and low-level jet analysis."}, "950_mb": {"name": "950 mb", "desc": "Constant pressure surface at 950 hPa (millibars) — standard meteorological height level."}, "975_mb": {"name": "975 mb", "desc": "Constant pressure surface at 975 hPa (millibars) — standard meteorological height level."}, "9_hybrid_level": {"name": "9 hybrid level", "desc": "Model hybrid vertical coordinate 9 hybrid level."}, "PV=-1.5e-06_(Km^2/kg/s)_surface": {"name": "PV=-1.5e-06 (Km^2/kg/s) surface", "desc": "Vertical level: PV=-1.5e-06 (Km^2/kg/s) surface."}, "PV=-1e-06_(Km^2/kg/s)_surface": {"name": "PV=-1e-06 (Km^2/kg/s) surface", "desc": "Vertical level: PV=-1e-06 (Km^2/kg/s) surface."}, "PV=-2e-06_(Km^2/kg/s)_surface": {"name": "PV=-2e-06 (Km^2/kg/s) surface", "desc": "Vertical level: PV=-2e-06 (Km^2/kg/s) surface."}, "PV=-5e-07_(Km^2/kg/s)_surface": {"name": "PV=-5e-07 (Km^2/kg/s) surface", "desc": "Vertical level: PV=-5e-07 (Km^2/kg/s) surface."}, "PV=1.5e-06_(Km^2/kg/s)_surface": {"name": "PV=1.5e-06 (Km^2/kg/s) surface", "desc": "Vertical level: PV=1.5e-06 (Km^2/kg/s) surface."}, "PV=1e-06_(Km^2/kg/s)_surface": {"name": "PV=1e-06 (Km^2/kg/s) surface", "desc": "Vertical level: PV=1e-06 (Km^2/kg/s) surface."}, "PV=2e-06_(Km^2/kg/s)_surface": {"name": "PV=2e-06 (Km^2/kg/s) surface", "desc": "Vertical level: PV=2e-06 (Km^2/kg/s) surface."}, "PV=5e-07_(Km^2/kg/s)_surface": {"name": "PV=5e-07 (Km^2/kg/s) surface", "desc": "Vertical level: PV=5e-07 (Km^2/kg/s) surface."}, "boundary_layer_cloud_layer": {"name": "boundary layer cloud layer", "desc": "Layer representing low stratiform cloud decks."}, "cloud_ceiling": {"name": "cloud ceiling", "desc": "Height of the lowest cloud base obscuring the sky."}, "convective_cloud_bottom_level": {"name": "convective cloud bottom level", "desc": "Vertical level: convective cloud bottom level."}, "convective_cloud_layer": {"name": "convective cloud layer", "desc": "Vertical level: convective cloud layer."}, "convective_cloud_top_level": {"name": "convective cloud top level", "desc": "Vertical level: convective cloud top level."}, "entire_atmosphere": {"name": "entire atmosphere", "desc": "Column-integrated or whole-atmosphere quantity."}, "entire_atmosphere_(considered_as_a_single_layer)": {"name": "entire atmosphere (considered as a single layer)", "desc": "Single-layer column total (e.g. total precipitable water)."}, "high_cloud_bottom_level": {"name": "high cloud bottom level", "desc": "Vertical level: high cloud bottom level."}, "high_cloud_layer": {"name": "high cloud layer", "desc": "Layer for high (cirrus-type) clouds."}, "high_cloud_top_level": {"name": "high cloud top level", "desc": "Vertical level: high cloud top level."}, "highest_tropospheric_freezing_level": {"name": "highest tropospheric freezing level", "desc": "Altitude of the 0°C isotherm — rain/snow transition level."}, "low_cloud_bottom_level": {"name": "low cloud bottom level", "desc": "Vertical level: low cloud bottom level."}, "low_cloud_layer": {"name": "low cloud layer", "desc": "Layer for low clouds."}, "low_cloud_top_level": {"name": "low cloud top level", "desc": "Vertical level: low cloud top level."}, "max_wind": {"name": "max wind", "desc": "Vertical level: max wind."}, "mean_sea_level": {"name": "mean sea level", "desc": "Standard reference height for sea-level pressure fields."}, "middle_cloud_bottom_level": {"name": "middle cloud bottom level", "desc": "Vertical level: middle cloud bottom level."}, "middle_cloud_layer": {"name": "middle cloud layer", "desc": "Layer for mid-level clouds."}, "middle_cloud_top_level": {"name": "middle cloud top level", "desc": "Vertical level: middle cloud top level."}, "planetary_boundary_layer": {"name": "planetary boundary layer", "desc": "Vertical level: planetary boundary layer."}, "surface": {"name": "surface", "desc": "Earth surface (land, water, or ice) — used for fluxes, soil, and surface weather."}, "top_of_atmosphere": {"name": "top of atmosphere", "desc": "Vertical level: top of atmosphere."}, "tropopause": {"name": "tropopause", "desc": "Vertical level: tropopause."}};
  var MODELS=[
    {id:'gfs025', name:'GFS 0.25°',  bucket:'https://noaa-gfs-bdp-pds.s3.amazonaws.com', tpl:'gfs.{d}/{c}/atmos/gfs.t{c}z.pgrb2.0p25.f{f}', maxFh:384, note:'hourly to 120h, 3-hourly to 384h'},
    {id:'gfs050', name:'GFS 0.50°',  bucket:'https://noaa-gfs-bdp-pds.s3.amazonaws.com', tpl:'gfs.{d}/{c}/atmos/gfs.t{c}z.pgrb2.0p50.f{f}', maxFh:384, note:'3-hourly'},
    {id:'gfs100', name:'GFS 1.00°',  bucket:'https://noaa-gfs-bdp-pds.s3.amazonaws.com', tpl:'gfs.{d}/{c}/atmos/gfs.t{c}z.pgrb2.1p00.f{f}', maxFh:384, note:'3-hourly'},
    {id:'gdas025',name:'GDAS 0.25° (analysis)', bucket:'https://noaa-gfs-bdp-pds.s3.amazonaws.com', tpl:'gdas.{d}/{c}/atmos/gdas.t{c}z.pgrb2.0p25.f{f}', maxFh:9, note:'f000-f009'},
    {id:'geavg',  name:'GEFS 0.50° ens. mean', bucket:'https://noaa-gefs-pds.s3.amazonaws.com', tpl:'gefs.{d}/{c}/atmos/pgrb2ap5/geavg.t{c}z.pgrb2a.0p50.f{f}', maxFh:384, note:'6-hourly'},
    {id:'gec00',  name:'GEFS 0.50° control',   bucket:'https://noaa-gefs-pds.s3.amazonaws.com', tpl:'gefs.{d}/{c}/atmos/pgrb2ap5/gec00.t{c}z.pgrb2a.0p50.f{f}', maxFh:384, note:'6-hourly'}
  ];
  var $=function(id){return document.getElementById(id);};
  var inv=null;     // {entries, url, model, dateStr, cyc} — preview fetch for the START date only
  var abortFlag=false;
  var CONCURRENCY=4; // simultaneous (date×hour) file fetches during Load
  function model(){ return MODELS.find(function(m){return m.id===$('ndl-model').value;})||MODELS[0]; }
  function pad3(n){ n=String(n); while(n.length<3) n='0'+n; return n; }
  function dstr(){ return ($('ndl-date').value||'').replace(/-/g,''); }
  function fileUrl(m,d,cyc,fh){ return m.bucket+'/'+m.tpl.replace(/\{d\}/g,d).replace(/\{c\}/g,cyc).replace(/\{f\}/g,pad3(fh)); }
  function status(msg,err){ var el=$('ndl-status'); el.textContent=msg||''; el.className='ndl-status'+(err?' err':''); }
  function varDesc(code){ var v=NOMADS_VAR_INFO[String(code).toUpperCase()]; return v?v.desc:''; }
  function levDesc(raw){ var v=NOMADS_LEV_INFO[String(raw).trim().replace(/\s+/g,'_')]; return v?v.desc:''; }
  function parseIdx(txt){
    var lines=txt.trim().split('\n'), out=[];
    for(var i=0;i<lines.length;i++){
      var f=lines[i].split(':');
      if(f.length<5) continue;
      out.push({start:+f[1], varC:f[3], lev:f[4], end:null});
    }
    for(var j=0;j<out.length;j++) out[j].end=(j+1<out.length)?out[j+1].start-1:null;
    return out;
  }
  // Inclusive list of YYYYMMDD strings from start to end (order-tolerant).
  function dateRangeList(startStr,endStr){
    var a=new Date(startStr+'T00:00:00Z'), b=new Date((endStr||startStr)+'T00:00:00Z');
    if(isNaN(a)||isNaN(b)) return [];
    if(b<a){ var t=a; a=b; b=t; }
    var out=[];
    for(var d=new Date(a); d<=b; d=new Date(d.getTime()+86400000)){
      out.push(d.toISOString().slice(0,10).replace(/-/g,''));
    }
    return out;
  }
  function initUi(){
    var sel=$('ndl-model');
    sel.innerHTML=MODELS.map(function(m){return '<option value="'+m.id+'">'+m.name+'</option>';}).join('');
    var now=new Date(Date.now()-6*3600*1000); // cycles publish ~4-6h behind real time
    var todayIso=now.toISOString().slice(0,10);
    $('ndl-date').value=todayIso;
    $('ndl-date-end').value=todayIso;
    $('ndl-cycle').value='00';
    sel.addEventListener('change',function(){ var m=model(); status(m.note||''); });
    $('ndl-latest').addEventListener('click',probeLatest);
    $('ndl-inv').addEventListener('click',fetchInventory);
    $('ndl-load').addEventListener('click',loadData);
    $('ndl-cancel').addEventListener('click',function(){ abortFlag=true; });
    $('ndl-vfilter').addEventListener('input',function(){ filterList('ndl-vars',this.value); });
    $('ndl-lfilter').addEventListener('input',function(){ filterList('ndl-levs',this.value); });
    $('ndl-date-end').addEventListener('change',updateEst);
    $('ndl-date').addEventListener('change',updateEst);
  }
  function filterList(id,q){
    q=(q||'').toLowerCase();
    $(id).querySelectorAll('label').forEach(function(l){
      l.style.display=(!q||l.dataset.f.indexOf(q)>=0)?'':'none';
    });
  }
  async function probeLatest(){
    var m=model();
    status('Probing NOAA for the latest published cycle…');
    for(var back=0;back<4;back++){
      var d=new Date(Date.now()-back*86400000);
      var ds=d.toISOString().slice(0,10).replace(/-/g,'');
      var cycles=['18','12','06','00'];
      for(var ci=0;ci<cycles.length;ci++){
        try{
          var r=await fetch(fileUrl(m,ds,cycles[ci],0)+'.idx',{method:'GET'});
          if(r.ok){
            var iso=ds.slice(0,4)+'-'+ds.slice(4,6)+'-'+ds.slice(6,8);
            $('ndl-date').value=iso;
            if(!$('ndl-date-end').value||$('ndl-date-end').value<iso) $('ndl-date-end').value=iso;
            $('ndl-cycle').value=cycles[ci];
            status('Latest available: '+ds+' '+cycles[ci]+'Z');
            return;
          }
        }catch(e){}
      }
    }
    status('Could not find a published cycle in the last 4 days — NOAA may be unreachable.',true);
  }
  async function fetchInventory(){
    // Fetches ONE file's field list (start date, f0 of the selected cycle)
    // as a representative preview — the same model publishes the same
    // fields on every cycle/day, so this is enough to build the picker
    // without a round trip per day. Actual loading still fetches each
    // date's own .idx (offsets shift daily), this is preview-only.
    var m=model(), ds=dstr(), cyc=$('ndl-cycle').value, fh0=Math.max(0,+$('ndl-fh0').value||0);
    if(!ds){ status('Pick a start date first.',true); return; }
    status('Fetching inventory ('+m.name+' '+ds+' '+cyc+'Z f'+pad3(fh0)+')…');
    var url=fileUrl(m,ds,cyc,fh0);
    var r;
    try{ r=await fetch(url+'.idx'); }
    catch(e){ status('Network error — are you online?',true); return; }
    if(!r.ok){ status('Not found ('+r.status+') — that cycle may not be published yet. Try "Use latest".',true); return; }
    var idxText=await r.text();
    var entries=parseIdx(idxText);
    if(!entries.length){
      // Distinguish "file exists but the index is empty/unparseable" from
      // the earlier 404 case — same "nothing to load" outcome for the
      // user, but a genuinely different cause, so a different message
      // (an unfamiliar model's .idx could use a layout parseIdx doesn't
      // expect; worth saying so rather than silently showing an empty
      // variable picker that just looks broken).
      status('This file has no readable field index — the model/date combination may not have data (or uses an index format this loader doesn’t recognise yet). Try a different model or date.',true);
      $('ndl-pick').style.display='none';
      $('ndl-foot').style.display='none';
      inv=null;
      return;
    }
    inv={entries:entries,url:url,model:m,dateStr:ds,cyc:cyc};
    // variables — each row's description comes from NOMADS' own published
    // metadata (NOMADS_VAR_INFO), shown as a native hover tooltip.
    var byVar={};
    entries.forEach(function(e){ (byVar[e.varC]=byVar[e.varC]||[]).push(e); });
    var vnames=Object.keys(byVar).sort();
    $('ndl-vars').innerHTML=vnames.map(function(v){
      var nice=(NOMADS_VAR_INFO[v.toUpperCase()]||{}).name||'';
      var desc=varDesc(v);
      return '<label data-f="'+(v+' '+nice).toLowerCase()+'"'+(desc?' title="'+desc.replace(/"/g,'&quot;')+'"':'')+'>'+
        '<input type="checkbox" data-var="'+v+'">'+
        '<code>'+v+'</code> '+(nice?'<span class="ndl-var-desc">'+nice+'</span>':'')+'<span class="cnt">'+byVar[v].length+' lvl</span></label>';
    }).join('');
    $('ndl-vars').querySelectorAll('input').forEach(function(cb){ cb.addEventListener('change',syncLevels); });
    $('ndl-levs').innerHTML='<div style="color:#5f7d93;padding:6px 2px;">Select variables first.</div>';
    $('ndl-pick').style.display='';
    $('ndl-foot').style.display='';
    updateEst();
    status(entries.length+' fields available (preview: '+ds+' '+cyc+'Z). Pick variables, then levels.');
  }
  function selVars(){ return [...$('ndl-vars').querySelectorAll('input:checked')].map(function(cb){return cb.dataset.var;}); }
  function selLevs(){ return [...$('ndl-levs').querySelectorAll('input:checked')].map(function(cb){return cb.dataset.lev;}); }
  function syncLevels(){
    if(!inv) return;
    var vs=selVars();
    var keep=new Set(selLevs());
    var levs=[], seen=new Set();
    inv.entries.forEach(function(e){
      if(vs.indexOf(e.varC)>=0&&!seen.has(e.lev)){ seen.add(e.lev); levs.push(e.lev); }
    });
    $('ndl-levs').innerHTML=levs.map(function(l){
      var chk=keep.has(l)?' checked':'';
      var desc=levDesc(l);
      return '<label data-f="'+l.toLowerCase()+'"'+(desc?' title="'+desc.replace(/"/g,'&quot;')+'"':'')+'>'+
        '<input type="checkbox" data-lev="'+l.replace(/"/g,'&quot;')+'"'+chk+'>'+l+'</label>';
    }).join('')||'<div style="color:#5f7d93;padding:6px 2px;">No levels.</div>';
    $('ndl-levs').querySelectorAll('input').forEach(function(cb){ cb.addEventListener('change',updateEst); });
    updateEst();
  }
  function matches(entries){
    var vs=selVars(), ls=new Set(selLevs());
    return entries.filter(function(e){ return vs.indexOf(e.varC)>=0&&ls.has(e.lev); });
  }
  function hoursList(m){
    var fh0=Math.max(0,+$('ndl-fh0').value||0), fh1=Math.max(fh0,+$('ndl-fh1').value||fh0);
    var stp=Math.max(1,+$('ndl-fhs').value||3);
    fh1=Math.min(fh1,m.maxFh);
    var out=[]; for(var f=fh0;f<=fh1;f+=stp) out.push(f);
    return out;
  }
  function selectedDates(){ return dateRangeList($('ndl-date').value,$('ndl-date-end').value||$('ndl-date').value); }
  function updateEst(){
    if(!inv) return;
    var ms=matches(inv.entries);
    var bytes=0;
    ms.forEach(function(e){ if(e.end!=null) bytes+=e.end-e.start+1; else bytes+=2e6; });
    var hours=hoursList(inv.model), dates=selectedDates();
    var tot=bytes*hours.length*dates.length;
    $('ndl-est').textContent=ms.length? (ms.length+' field(s) × '+dates.length+' day(s) × '+hours.length+' hour(s) ≈ '+(tot/1e6).toFixed(1)+' MB'):'';
  }
  function coalesce(ms){
    // idx entries sorted by start; merge byte-adjacent picks into one request
    var sorted=ms.slice().sort(function(a,b){return a.start-b.start;});
    var runs=[];
    sorted.forEach(function(e){
      var last=runs[runs.length-1];
      if(last&&last.end!=null&&e.start===last.end+1) last.end=e.end;
      else runs.push({start:e.start,end:e.end});
    });
    return runs;
  }
  // Bounded-concurrency map: runs `worker` over `items` with at most
  // `limit` in flight at once. A single failing item does NOT abort the
  // batch — its slot resolves to null and the caller filters those out
  // (matches nc-batch's existing "skip and report" behaviour, just faster).
  function pMapLimit(items,limit,worker){
    return new Promise(function(resolve){
      var ret=new Array(items.length), next=0, active=0, done=0;
      if(!items.length){ resolve(ret); return; }
      function kick(){
        while(active<limit&&next<items.length){
          (function(i){
            active++;
            Promise.resolve().then(function(){ return worker(items[i],i); })
              .then(function(v){ ret[i]=v; },function(){ ret[i]=null; })
              .then(function(){ active--; done++; if(done===items.length) resolve(ret); else kick(); });
          })(next++);
        }
      }
      kick();
    });
  }
  // Fetches ONE (date,fh) file's selected fields → a File, or null if that
  // timestep isn't published / has no matching fields / errored.
  async function fetchOneFile(m,dateStr,cyc,fh,vars,levs){
    if(abortFlag) return null;
    var url=fileUrl(m,dateStr,cyc,fh);
    var entries;
    try{
      var ir=await fetch(url+'.idx');
      if(!ir.ok) return null;
      entries=parseIdx(await ir.text());
    }catch(e){ return null; }
    var ms=entries.filter(function(e){ return vars.indexOf(e.varC)>=0&&levs.has(e.lev); });
    if(!ms.length) return null;
    var runs=coalesce(ms), parts=[];
    for(var ri=0;ri<runs.length;ri++){
      if(abortFlag) return null;
      var rangeEnd=runs[ri].end!=null?runs[ri].end:'';
      var rr;
      try{ rr=await fetch(url,{headers:{'Range':'bytes='+runs[ri].start+'-'+rangeEnd}}); }
      catch(e){ return null; }
      if(!rr.ok&&rr.status!==206) return null;
      parts.push(await rr.arrayBuffer());
    }
    var fname=m.id+'_'+dateStr+'_'+cyc+'z_f'+pad3(fh)+'.grib2';
    return {file:new File([new Blob(parts)],fname,{type:'application/octet-stream'}),dateStr:dateStr,fh:fh};
  }
  async function loadData(){
    if(!inv){ status('Fetch the inventory first.',true); return; }
    var vars=selVars(), levs=new Set(selLevs());
    if(!vars.length||!levs.size){ status('Select at least one variable and one level.',true); return; }
    var m=inv.model, hours=hoursList(m), dates=selectedDates(), cyc=inv.cyc;
    if(!dates.length){ status('Invalid date range.',true); return; }
    var tasks=[];
    dates.forEach(function(d){ hours.forEach(function(fh){ tasks.push({d:d,fh:fh}); }); });
    var estMB=(function(){
      var ms=matches(inv.entries), b=0;
      ms.forEach(function(e){ b+=(e.end!=null?e.end-e.start+1:2e6); });
      return b*tasks.length/1e6;
    })();
    if(tasks.length>400&&!confirm('This selection is '+tasks.length+' timestep(s) — that may take a long time and hit NOAA rate limits. Continue?')) return;
    else if(estMB>150&&!confirm('This selection is ~'+estMB.toFixed(0)+' MB across '+tasks.length+' timestep(s). Continue?')) return;
    abortFlag=false;
    $('ndl-cancel').style.display=''; $('ndl-load').disabled=true;
    var bar=$('ndl-bar'); bar.style.width='0%';
    var doneCount=0;
    try{
      status('Fetching '+tasks.length+' timestep(s) ('+CONCURRENCY+' at a time)…');
      var results=await pMapLimit(tasks,CONCURRENCY,async function(t){
        var r=await fetchOneFile(m,t.d,cyc,t.fh,vars,levs);
        doneCount++;
        bar.style.width=Math.round(doneCount/tasks.length*100)+'%';
        status('Fetching timestep '+doneCount+'/'+tasks.length+'…');
        return r;
      });
      if(abortFlag) throw new Error('cancelled');
      var got=results.filter(Boolean);
      got.sort(function(a,b){ return a.dateStr===b.dateStr?a.fh-b.fh:(a.dateStr<b.dateStr?-1:1); });
      if(!got.length) throw new Error('nothing downloaded — no matching fields in any requested timestep (cycles may not be published yet for some dates)');
      status('Decoding '+got.length+' of '+tasks.length+' timestep(s) into an overlay…');
      var dt=new DataTransfer();
      got.forEach(function(g){ dt.items.add(g.file); });
      window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));
      bar.style.width='100%';
      var missing=tasks.length-got.length;
      status('✓ Loaded '+got.length+' timestep(s)'+(missing?(' ('+missing+' unavailable/skipped)'):'')+'. See the Data Overlays panel — the modal can be closed.');
    }catch(e){
      status(e.message==='cancelled'?'Cancelled.':('Failed: '+(e.message||e)),e.message!=='cancelled');
    }finally{
      $('ndl-cancel').style.display='none'; $('ndl-load').disabled=false;
    }
  }
  function openNomadsModal(){
    if(!$('ndl-model').options.length) initUi();
    $('nomads-modal').classList.add('show');
  }
  function closeNomadsModal(){ $('nomads-modal').classList.remove('show'); }
  document.addEventListener('click',function(e){
    if(e.target.closest('#nomads-open-btn,#nc-nomads')) openNomadsModal();
    else if(e.target.id==='nomads-modal-close') closeNomadsModal();
    else if(e.target.id==='nomads-modal') closeNomadsModal();
    else if(e.target.closest('#help-open-btn')) $('help-modal').classList.add('show');
    else if(e.target.id==='help-modal-close'||e.target.id==='help-modal') $('help-modal').classList.remove('show');
  },true);
  window.addEventListener('keydown',function(e){
    if(e.key!=='Escape') return;
    if($('nomads-modal').classList.contains('show')) closeNomadsModal();
    if($('help-modal').classList.contains('show')) $('help-modal').classList.remove('show');
  });
})();
