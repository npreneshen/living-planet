/* globe-info */
/* globe-info.js — feature explanation database */
window.GlobeInfo = {
  'gulf-stream': { name: 'Gulf Stream',
    html: `<div class="icat ocean">Warm Current</div>
    <p>One of the world's strongest ocean currents — a "river" of warm, blue water flowing north along the US East Coast before veering northeast across the Atlantic.</p>
    <p><strong>Why it exists:</strong> Trade winds push warm equatorial water into the Gulf of Mexico. The Florida Strait funnels it north; the Coriolis force steers it offshore and poleward.</p>
    <p><strong>Season:</strong> Relatively stable year-round. The temperature contrast with surrounding water peaks in winter, making its heat release to Europe's climate most felt Dec–Feb.</p>`
  },
  'n-atlantic-drift': { name: 'North Atlantic Drift',
    html: `<div class="icat ocean">Warm Current</div>
    <p>The continuation of the Gulf Stream after it leaves the continental shelf — a broad, slow drift of warm water toward NW Europe.</p>
    <p><strong>Climate impact:</strong> Keeps the British Isles and Norway 5–10 °C warmer than equivalent latitudes elsewhere. Part of the Atlantic Meridional Overturning Circulation (AMOC).</p>`
  },
  'kuroshio': { name: 'Kuroshio Current',
    html: `<div class="icat ocean">Warm Current</div>
    <p>The Pacific counterpart of the Gulf Stream — Japan's "Black Current" (kuroshio = black tide) flowing north along Japan's coast, carrying heat from the tropics to mid-latitudes.</p>
    <p><strong>Why so strong:</strong> The North Pacific subtropical gyre's western boundary current; intensified by the β-effect (western intensification).</p>`
  },
  'humboldt': { name: 'Humboldt / Peru Current',
    html: `<div class="icat ocean">Cold Current</div>
    <p>A cold, nutrient-rich current flowing north along South America's west coast — one of the world's most productive fisheries.</p>
    <p><strong>Why cold:</strong> Southerly winds drive coastal upwelling, pulling deep, cold, nutrient-rich water to the surface.</p>
    <p><strong>ENSO link:</strong> During El Niño, this current weakens dramatically as trade winds relax, suppressing upwelling and crashing fish stocks.</p>`
  },
  'benguela': { name: 'Benguela Current',
    html: `<div class="icat ocean">Cold Current</div>
    <p>Cold, upwelling-driven current along SW Africa's coast. Supports the Benguela ecosystem — one of the world's richest fishing grounds — and creates the hyper-arid Namib desert immediately inland.</p>`
  },
  'california-current': { name: 'California Current',
    html: `<div class="icat ocean">Cold Current</div>
    <p>Southward-flowing cold current along the western US coast, driven by the North Pacific gyre. Creates persistent summer fog along California — onshore flow lifts cold upwelled water, chilling the marine layer.</p>`
  },
  'agulhas': { name: 'Agulhas Current',
    html: `<div class="icat ocean">Warm Current</div>
    <p>The Indian Ocean's western boundary current — one of Earth's fastest ocean currents, flowing south along Africa's east coast. Famous for massive retroflection at the southern tip of Africa, where it "leaks" rings of warm water into the South Atlantic.</p>`
  },
  'east-australian': { name: 'East Australian Current',
    html: `<div class="icat ocean">Warm Current</div>
    <p>Australia's western boundary current, flowing south along the Queensland coast. Carries warm tropical water poleward; its strengthening due to climate change has shifted the poleward range of many marine species by hundreds of kilometres.</p>`
  },
  'acc': { name: 'Antarctic Circumpolar Current',
    html: `<div class="icat ocean">Circumpolar Current</div>
    <p>The world's largest ocean current — the only one that flows completely around the globe without interruption by land. Carries ~150 times the flow of all Earth's rivers combined.</p>
    <p><strong>Why it exists:</strong> No land barrier at these latitudes; driven by the powerful Southern Ocean westerlies ("Roaring Forties/Furious Fifties").</p>
    <p><strong>Role:</strong> Connects all three ocean basins; crucial to global thermohaline circulation and Earth's heat budget.</p>`
  },
  'itcz': { name: 'Intertropical Convergence Zone (ITCZ)',
    html: `<div class="icat atmos">Atmospheric</div>
    <p>A belt of rising air and heavy convective rainfall near the equator where the Northeast and Southeast Trade Winds converge. The engine of the tropical water cycle.</p>
    <p><strong>Seasonal migration:</strong> Follows the sun — migrates to about 10°N in July–August (northern hemisphere summer) and dips to near 2°S in January. This migration drives the monsoon rains across Africa and Asia.</p>
    <p><strong>In the Advanced view:</strong> The seasonal ITCZ layer shows its actual monthly position — drag the month slider to watch it migrate!</p>`
  },
  'pressure-high': { name: 'Subtropical High (H)',
    html: `<div class="icat atmos">Atmospheric</div>
    <p>Semi-permanent high-pressure cells near 25–35° latitude. Air descends here, warming and drying as it sinks — producing the world's great deserts directly beneath them (Sahara, Arabian, Australian, Atacama, Kalahari).</p>
    <p><strong>Season:</strong> Strengthen and expand poleward in summer; weaken and retreat equatorward in winter.</p>`
  },
  'pressure-low': { name: 'Subpolar Low (L)',
    html: `<div class="icat atmos">Atmospheric</div>
    <p>Semi-permanent low-pressure cells at ~60° latitude. Rising moist air creates persistent storminess. The Aleutian and Icelandic Lows are the "storm factories" of the mid-latitude North Pacific and North Atlantic.</p>
    <p><strong>Season:</strong> Deepest and most active in winter; weaker in summer.</p>`
  },
  'warm-pool': { name: 'Western Pacific Warm Pool',
    html: `<div class="icat enso">ENSO</div>
    <p>The largest body of persistently warm surface water on Earth — a vast region of the western Pacific and eastern Indian Ocean where sea-surface temperatures exceed 28°C year-round.</p>
    <p><strong>Role:</strong> The "boiler" of global atmospheric circulation. Its deep convection drives the Walker Circulation and the upper-level winds that connect the tropics to mid-latitudes.</p>
    <p><strong>ENSO link:</strong> During El Niño, warm water "sloshes" eastward, spreading the warm pool across the central Pacific and disrupting global weather patterns.</p>`
  },
  'seaice': { name: 'Polar Sea Ice',
    html: `<div class="icat polar">Seasonal</div>
    <p>Frozen seawater covering the polar oceans. Unlike glacial ice (which forms from snow), sea ice forms from the ocean surface and is typically 1–3 m thick.</p>
    <p><strong>Arctic:</strong> Maximum extent in March (~14 million km²); minimum in September (~4 million km²). Long-term trends show rapid decline in summer minimum.</p>
    <p><strong>Antarctic:</strong> Maximum in September (~18 million km²); minimum in February (~3 million km²) — a six-month offset from the Arctic due to opposite seasons.</p>
    <p><strong>Drag the slider</strong> to watch both ice caps pulse through the year.</p>`
  },
  'monsoon': { name: 'Asian & African Monsoon',
    html: `<div class="icat seasonal">Seasonal</div>
    <p>A seasonal reversal of surface winds driven by the differential heating of land and ocean. In summer, hot continental air rises, drawing in moist oceanic air (bringing heavy rain). In winter, cool dense air over land flows out to sea (dry and cool).</p>
    <p><strong>SW Monsoon (Jun–Sep):</strong> Arrows point NE — onshore flow brings the life-giving rains to South Asia, SE Asia, and West Africa.</p>
    <p><strong>NE Monsoon (Oct–May):</strong> Arrows reverse SW — offshore, dry flow dominates.</p>
    <p><strong>Drag the slider</strong> to watch the arrows flip direction twice each year.</p>`
  },
  'cyclones': { name: 'Tropical Cyclone Basins',
    html: `<div class="icat seasonal">Seasonal</div>
    <p>Tropical storms (hurricanes, typhoons, cyclones) form over warm ocean water (>26 °C) when atmospheric conditions allow sustained rotation. Each basin has a distinct season.</p>
    <p><strong>Atlantic:</strong> June–November (peak September)<br>
    <strong>Eastern Pacific:</strong> May–November<br>
    <strong>Western Pacific:</strong> Year-round, peak July–October<br>
    <strong>N. Indian Ocean:</strong> April–December<br>
    <strong>Southern Hemisphere:</strong> November–April</p>
    <p>Drag the slider to see which basins are active each month.</p>`
  },
  'mountains': { name: 'Major Mountain Ranges',
    html: `<div class="icat geo">Geography</div>
    <p>Mountain ranges profoundly shape ocean currents and atmospheric circulation: they block prevailing winds (creating rain shadows), deflect jet streams (generating Rossby waves), and channel cold polar air outbreaks.</p>
    <p><strong>Himalaya & Tibetan Plateau:</strong> Deflect the subtropical jet stream and intensify the South Asian monsoon.<br>
    <strong>Andes:</strong> Block easterly trade winds, supporting the hyper-arid Atacama desert on their leeward side.<br>
    <strong>Rockies:</strong> A major source of Rossby wave troughs in the North American jet stream.</p>`
  },
  'deserts': { name: 'Major Deserts',
    html: `<div class="icat geo">Geography</div>
    <p>Each great desert sits beneath a subtropical high-pressure system where air descends, warms adiabatically, and suppresses rainfall.</p>
    <p><strong>Sahara:</strong> Largest hot desert — maintained by the Azores and North African high.<br>
    <strong>Atacama:</strong> Driest desert on Earth — cold Humboldt Current stabilises the atmosphere above; Andes blocks moisture from the east.<br>
    <strong>Namib:</strong> Ancient coastal desert fed by the cold Benguela upwelling.</p>`
  },
  'forests': { name: 'Tropical Rainforests',
    html: `<div class="icat geo">Geography</div>
    <p>Located beneath the ITCZ where convection is deepest and rainfall exceeds 2000 mm/year. Together they represent ~50% of global biodiversity and are critical regulators of the global carbon and water cycles.</p>
    <p><strong>Amazon:</strong> Generates its own rainfall through transpiration — a "flying river" of moisture that also influences Andes glaciers and La Plata basin hydrology.<br>
    <strong>Congo:</strong> Drives the West African monsoon moisture return flow.</p>`
  },
  'ringfire': { name: 'Ring of Fire & Mid-Ocean Ridges',
    html: `<div class="icat geo">Tectonics</div>
    <p>The Ring of Fire traces the subduction zones encircling the Pacific — where oceanic plates dive beneath continental and other oceanic plates, generating >90% of Earth's earthquakes and most of its volcanic activity.</p>
    <p><strong>Mid-ocean ridges</strong> mark where new oceanic crust is created at spreading centres (the Mid-Atlantic Ridge spreads ~2.5 cm/year). Hydrothermal vent ecosystems exist along these ridges.</p>`
  },
  'windlats': { name: 'Named Wind Latitude Zones',
    html: `<div class="icat atmos">Atmospheric</div>
    <p>Mariners named these zones for their characteristic winds — critical knowledge before engine power.</p>
    <p><strong>Doldrums (±8°):</strong> ITCZ zone; light, variable winds; oppressive heat and becalming.<br>
    <strong>Horse Latitudes (±30°):</strong> Sinking air of the subtropical highs; calm; ships sometimes stranded for weeks (horses thrown overboard to save water — hence the name).<br>
    <strong>Roaring Forties (40–50°S):</strong> Unimpeded westerlies circle the globe.<br>
    <strong>Furious Fifties (50–60°S):</strong> Stronger still.<br>
    <strong>Screaming Sixties (60–70°S):</strong> The stormiest seas on Earth.</p>`
  },
  's-jets': { name: 'Seasonal Jet Streams',
    html: `<div class="icat seasonal">Seasonal</div>
    <p>The polar-front jet stream migrates with the seasons, following the boundary between cold polar and warm subtropical air masses.</p>
    <p><strong>Winter (Dec–Feb):</strong> Jet dips to ~45°N/S, strengthens, meanders deeply — bringing cold outbreaks, blocking patterns, and storm tracks far equatorward.<br>
    <strong>Summer (Jun–Aug):</strong> Jet retreats to ~65°N/S, weakens, becomes more zonal — weather patterns more persistent but storms less intense.<br>
    Drag the slider to watch the jet migrate.</p>`
  }
};

