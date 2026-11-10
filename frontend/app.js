/**
 * GeoCentric - Web Game Engine (Vanilla JS)
 * -----------------------------------------
 * Handles:
 * 1. Dataset & Daily Palettes loading (fetch API)
 * 2. Mercator trigonometry & Haversine distance calculations
 * 3. Capacity-aware clue selection algorithm
 * 4. Collision-free SVG Compass rendering with dynamic scaling
 * 5. Hint additions, wrong guess compass plotting, and dynamic themes
 */

// ==============================================================================
// 1. GAME STATE
// ==============================================================================

const STATE = {
  allCities: [],
  palettes: {},          // Loaded from daily_palettes.json (312 curated palettes)
  currentTheme: "classic", // "classic", "daily", "random", or date key
  currentTier: 100,      // Default: Medium (Top 100)
  targetCity: null,      // The mystery center city
  clues: [],             // Initial reference cities + hints + wrong guesses
  guesses: [],           // Player attempts (max 6)
  maxGuesses: 6,
  hintsUsed: 0,
  maxHints: 2,           // Maximum 2 hints per round
  isGameOver: false,
};

const OCTANT_NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

// ==============================================================================
// 2. THE MATH: Mercator Bearing & Haversine Distance
// ==============================================================================

function mercatorBearing(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180;
  const lam1 = (lon1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const lam2 = (lon2 * Math.PI) / 180;

  const x1 = lam1;
  const y1 = Math.log(Math.tan(Math.PI / 4 + phi1 / 2));
  const x2 = lam2;
  const y2 = Math.log(Math.tan(Math.PI / 4 + phi2 / 2));

  const dx = x2 - x1;
  const dy = y2 - y1;

  // Swap dx and dy so 0° points North and angles increase clockwise
  const angleRad = Math.atan2(dx, dy);
  const angleDeg = (angleRad * 180) / Math.PI;
  return (angleDeg + 360) % 360;
}

function angleToOctant(angleDeg) {
  const shifted = (angleDeg + 22.5) % 360;
  return Math.floor(shifted / 45);
}

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's mean radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function angularDistance(a1, a2) {
  const diff = Math.abs(a1 - a2) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// ==============================================================================
// 3. COLOR & THEME SYSTEM (Dynamic 5-Slot Semantic Injection)
// ==============================================================================

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h = Math.round(h * 60);
  }
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
}

function getRelativeLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getDailyPaletteKey(date = new Date()) {
  if (!STATE.palettes || Object.keys(STATE.palettes).length === 0) return null;

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const exactKey = `${yyyy}-${mm}-${dd}`;
  if (STATE.palettes[exactKey]) return exactKey;

  const mdKey = `2026-${mm}-${dd}`;
  if (STATE.palettes[mdKey]) return mdKey;

  // Stable daily rotation across the 312 palette collection
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((date - startOfYear) / (24 * 60 * 60 * 1000));
  const keys = Object.keys(STATE.palettes);
  return keys[Math.abs(dayOfYear) % keys.length];
}

function applyTheme(themeKey) {
  const root = document.documentElement;

  if (themeKey === "classic" || !STATE.palettes || Object.keys(STATE.palettes).length === 0) {
    STATE.currentTheme = "classic";
    localStorage.setItem("geocentric_theme", "classic");

    // Clear dynamic properties to cleanly revert to original :root CSS variables
    const customProps = [
      "--bg-dark", "--bg-card", "--bg-input", "--bg-hover",
      "--accent", "--accent-glow", "--secondary", "--border-focus",
      "--center-circle-fill", "--center-circle-stroke", "--center-question",
      "--arrow-stroke", "--pill-fill", "--pill-border", "--pill-hover-fill",
      "--text-main", "--text-muted", "--btn-text",
    ];
    customProps.forEach((prop) => root.style.removeProperty(prop));

    const themeSelect = document.getElementById("theme-select");
    if (themeSelect) {
      themeSelect.value = "classic";
      const dailyOpt = themeSelect.querySelector('option[value="daily"]');
      if (dailyOpt) dailyOpt.textContent = "Theme: Daily Palette";
    }
    if (STATE.clues.length > 0) renderCompass(STATE.clues);
    return;
  }

  let paletteEntry = null;
  let resolvedKey = themeKey;

  if (themeKey === "daily") {
    resolvedKey = getDailyPaletteKey();
    paletteEntry = STATE.palettes[resolvedKey];
  } else if (themeKey === "random") {
    const keys = Object.keys(STATE.palettes);
    resolvedKey = keys[Math.floor(Math.random() * keys.length)];
    paletteEntry = STATE.palettes[resolvedKey];
  } else if (STATE.palettes[themeKey]) {
    paletteEntry = STATE.palettes[themeKey];
  }

  if (!paletteEntry || !paletteEntry.colors) return;

  STATE.currentTheme = themeKey;
  localStorage.setItem("geocentric_theme", themeKey);

  const { primary, secondary, accent, light_shade, dark_shade } = paletteEntry.colors;

  // 1. Dark Shade: Rich ambient canvas tint
  const dRgb = hexToRgb(dark_shade.hex);
  const dHsl = rgbToHsl(dRgb.r, dRgb.g, dRgb.b);
  const baseHue = dHsl.h;
  const baseSat = Math.min(dHsl.s, 32);

  // 2. Semantic Contrast Engine (Slots: a=primary, b=secondary, c=accent, d=light, e=dark)
  const pRgb = hexToRgb(primary.hex);
  const aRgb = hexToRgb(accent.hex);
  const sRgb = hexToRgb(secondary.hex);

  const pLum = getRelativeLuminance(pRgb.r, pRgb.g, pRgb.b);

  // If Slot A (primary) is too dark on the dark background, shift button to Slot C (accent)
  let btnBg = primary.hex;
  let btnCandidates = [accent.hex, secondary.hex, light_shade.hex, "#ffffff", "#0f172a"];

  if (pLum < 0.18) {
    btnBg = accent.hex; // Slot C
    btnCandidates = [primary.hex, dark_shade.hex, secondary.hex, "#0f172a", "#ffffff"]; // Slot C has contrast to Slot A / Slot E
  }

  // Calculate WCAG contrast ratio between two hex colors
  const getContrast = (c1, c2) => {
    const rgb1 = hexToRgb(c1);
    const rgb2 = hexToRgb(c2);
    const l1 = getRelativeLuminance(rgb1.r, rgb1.g, rgb1.b);
    const l2 = getRelativeLuminance(rgb2.r, rgb2.g, rgb2.b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  let btnTextColor = "#ffffff";
  for (const cand of btnCandidates) {
    if (getContrast(btnBg, cand) >= 2.8) {
      btnTextColor = cand;
      break;
    }
  }

  const heroColor = btnBg;
  const heroRgb = hexToRgb(heroColor);

  // 3. Inject CSS Variables
  root.style.setProperty("--bg-dark", `hsl(${baseHue}, ${baseSat}%, 7%)`);
  root.style.setProperty("--bg-card", `hsla(${baseHue}, ${Math.min(baseSat, 26)}%, 14%, 0.75)`);
  root.style.setProperty("--bg-input", `hsla(${baseHue}, ${Math.min(baseSat, 24)}%, 11%, 0.95)`);
  root.style.setProperty("--bg-hover", `hsla(${baseHue}, ${Math.min(baseSat, 28)}%, 19%, 0.9)`);

  root.style.setProperty("--accent", heroColor);
  root.style.setProperty("--border-focus", heroColor);
  root.style.setProperty("--accent-glow", `rgba(${heroRgb.r}, ${heroRgb.g}, ${heroRgb.b}, 0.32)`);

  root.style.setProperty("--center-circle-fill", `hsla(${baseHue}, ${Math.min(baseSat, 30)}%, 10%, 0.95)`);
  root.style.setProperty("--center-circle-stroke", heroColor);
  root.style.setProperty("--center-question", accent.hex === heroColor ? primary.hex : accent.hex);

  root.style.setProperty("--arrow-stroke", secondary.hex);
  root.style.setProperty("--pill-fill", `hsla(${baseHue}, ${Math.min(baseSat, 30)}%, 12%, 0.72)`);
  root.style.setProperty("--pill-border", `rgba(${sRgb.r}, ${sRgb.g}, ${sRgb.b}, 0.28)`);
  root.style.setProperty("--pill-hover-fill", `hsla(${baseHue}, ${Math.min(baseSat, 30)}%, 18%, 0.85)`);

  // 4. Guess Button: Text contrasts against the button background
  root.style.setProperty("--btn-text", btnTextColor);

  // Update theme dropdown label
  const themeSelect = document.getElementById("theme-select");
  if (themeSelect) {
    themeSelect.value = themeKey === "random" ? "random" : (themeKey === "daily" ? "daily" : "classic");
    const dailyOpt = themeSelect.querySelector('option[value="daily"]');
    if (dailyOpt && (themeKey === "daily" || themeKey === "random")) {
      dailyOpt.textContent = `Daily: ${primary.name}`;
    }
  }

  // Re-render compass with the updated theme colors
  if (STATE.clues.length > 0) {
    renderCompass(STATE.clues);
  }
}

// ==============================================================================
// 4. CLUE SELECTION ALGORITHM (Pure Two-Phase Capacity-Aware)
// ==============================================================================

function selectClues(targetCity, pool, numClues = 5) {
  // Step 1: Bucket candidate cities into their respective octant (0..7)
  const octantBuckets = Array.from({ length: 8 }, () => []);

  for (const city of pool) {
    if (city.name.toLowerCase() === targetCity.name.toLowerCase()) continue;

    const bearing = mercatorBearing(targetCity.lat, targetCity.lon, city.lat, city.lon);
    const octant = angleToOctant(bearing);
    const distanceKm = haversineDistanceKm(targetCity.lat, targetCity.lon, city.lat, city.lon);

    octantBuckets[octant].push({
      ...city,
      bearing: Math.round(bearing * 10) / 10,
      octant,
      directionLabel: OCTANT_NAMES[octant],
      distanceKm,
    });
  }

  // Step 2: Total capacity check
  const totalAvailable = octantBuckets.reduce((sum, b) => sum + b.length, 0);
  if (totalAvailable < numClues) {
    throw new Error(`Not enough cities in pool (${totalAvailable}) to pick ${numClues} clues!`);
  }

  // Step 3: Initialize remaining pools
  const remainingPools = {};
  octantBuckets.forEach((cities, octant) => {
    if (cities.length > 0) remainingPools[octant] = [...cities];
  });

  const selectedClues = [];

  function pickCityFromOctant(octant) {
    const bucket = remainingPools[octant];
    if (!bucket || bucket.length === 0) return null;
    const randIdx = Math.floor(Math.random() * bucket.length);
    const [city] = bucket.splice(randIdx, 1);
    if (bucket.length === 0) delete remainingPools[octant];
    return city;
  }

  // Step 4: Phase 1 - Angular Diversity across available directions
  const availableOctants = Object.keys(remainingPools).map(Number);
  let firstPassOctants = [];

  if (availableOctants.length >= numClues) {
    const shuffled = [...availableOctants].sort(() => 0.5 - Math.random());
    firstPassOctants = shuffled.slice(0, numClues);
  } else {
    firstPassOctants = [...availableOctants];
  }

  firstPassOctants.forEach((oct) => {
    const city = pickCityFromOctant(oct);
    if (city) selectedClues.push(city);
  });

  // Step 5: Phase 2 - Fill remaining slots from any non-empty octants
  while (selectedClues.length < numClues && Object.keys(remainingPools).length > 0) {
    const eligible = Object.keys(remainingPools).map(Number);
    const randOctant = eligible[Math.floor(Math.random() * eligible.length)];
    const city = pickCityFromOctant(randOctant);
    if (city) selectedClues.push(city);
  }

  // Sort clockwise starting from 0° (North)
  selectedClues.sort((a, b) => a.bearing - b.bearing);
  return selectedClues;
}

// ==============================================================================
// 5. SVG COMPASS RENDERER (Dynamic Scaling + Theme Color Support)
// ==============================================================================

function renderCompass(clues) {
  const svg = document.getElementById("compass-svg");
  svg.innerHTML = ""; // Clear existing SVG contents

  const cx = 300;
  const cy = 300;
  const centerRadius = 54;

  const createSvgElement = (tag, attrs = {}) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, val] of Object.entries(attrs)) {
      el.setAttribute(key, val);
    }
    return el;
  };

  // Defs: Reusable Crisp Arrowhead Markers
  const defs = createSvgElement("defs");

  const createMarker = (id, color) => {
    const m = createSvgElement("marker", {
      id,
      markerWidth: "10",
      markerHeight: "10",
      refX: "8",
      refY: "5",
      orient: "auto",
    });
    const p = createSvgElement("polygon", {
      points: "0 2, 8 5, 0 8",
      fill: color,
    });
    m.appendChild(p);
    return m;
  };

  const arrowColor =
    getComputedStyle(document.documentElement).getPropertyValue("--arrow-stroke").trim() ||
    "#94a3b8";

  defs.appendChild(createMarker("arrowhead", arrowColor));
  defs.appendChild(createMarker("arrowhead-hint", "#f59e0b"));
  defs.appendChild(createMarker("arrowhead-wrong", "#ef4444"));
  svg.appendChild(defs);

  // SVG Layers to guarantee proper z-index order:
  const arrowsLayer = createSvgElement("g", { class: "arrows-layer" });
  const pillsLayer = createSvgElement("g", { class: "pills-layer" });
  const centerLayer = createSvgElement("g", { class: "center-layer" });

  svg.appendChild(arrowsLayer);
  svg.appendChild(pillsLayer);
  svg.appendChild(centerLayer);

  // ----------------------------------------------------------------------------
  // COLLISION-FREE RADIAL SOLVER (Unrestricted Outward Expansion)
  // ----------------------------------------------------------------------------
  const placedPills = [];

  clues.forEach((clue, idx) => {
    const angleRad = (clue.bearing * Math.PI) / 180;

    const longestTextLen = Math.max(clue.name.length + 2, clue.state.length);
    const pillW = Math.max(124, Math.min(180, longestTextLen * 8.4 + 24));
    const pillH = 44;
    const halfW = pillW / 2 + 10;
    const halfH = pillH / 2 + 8;

    let currentR = 190;

    const checkCollision = (testX, testY) => {
      return placedPills.some((p) => {
        return Math.abs(testX - p.x) < halfW + p.halfW && Math.abs(testY - p.y) < halfH + p.halfH;
      });
    };

    let posX = cx + currentR * Math.sin(angleRad);
    let posY = cy - currentR * Math.cos(angleRad);

    while (checkCollision(posX, posY) && currentR < 700) {
      currentR += 14;
      posX = cx + currentR * Math.sin(angleRad);
      posY = cy - currentR * Math.cos(angleRad);
    }

    const absSin = Math.abs(Math.sin(angleRad)) + 0.0001;
    const absCos = Math.abs(Math.cos(angleRad)) + 0.0001;
    const edgeDist = Math.min((pillW / 2) / absSin, (pillH / 2) / absCos);

    placedPills.push({
      clue,
      idx,
      angleRad,
      pillW,
      pillH,
      edgeDist,
      x: posX,
      y: posY,
      halfW,
      halfH,
      R: currentR,
    });
  });

  // ----------------------------------------------------------------------------
  // DYNAMIC VIEWBOX COMPUTATION (Maximizes size to fill all available space)
  // ----------------------------------------------------------------------------
  let minX = cx - centerRadius;
  let maxX = cx + centerRadius;
  let minY = cy - centerRadius;
  let maxY = cy + centerRadius;

  placedPills.forEach((p) => {
    minX = Math.min(minX, p.x - p.pillW / 2);
    maxX = Math.max(maxX, p.x + p.pillW / 2);
    minY = Math.min(minY, p.y - p.pillH / 2);
    maxY = Math.max(maxY, p.y + p.pillH / 2);
  });

  const padding = 20;
  const maxSpan = Math.max(
    Math.abs(minX - cx),
    Math.abs(maxX - cx),
    Math.abs(minY - cy),
    Math.abs(maxY - cy)
  ) + padding;

  const vbX = Math.round(cx - maxSpan);
  const vbY = Math.round(cy - maxSpan);
  const vbSize = Math.round(maxSpan * 2);
  svg.setAttribute("viewBox", `${vbX} ${vbY} ${vbSize} ${vbSize}`);

  // ----------------------------------------------------------------------------
  // DRAW ARROWS INTO ARROWS LAYER
  // ----------------------------------------------------------------------------
  placedPills.forEach((item) => {
    const { clue, angleRad, edgeDist, R } = item;

    const arrowStopR = R - edgeDist - 4;
    const arrowLength = Math.max(20, arrowStopR - centerRadius);

    const startX = cx + centerRadius * Math.sin(angleRad);
    const startY = cy - centerRadius * Math.cos(angleRad);
    const endX = cx + (centerRadius + arrowLength) * Math.sin(angleRad);
    const endY = cy - (centerRadius + arrowLength) * Math.cos(angleRad);

    let markerId = "arrowhead";
    let lineClass = "svg-arrow-line";
    if (clue.isWrongGuess) {
      markerId = "arrowhead-wrong";
      lineClass += " wrong-guess-arrow";
    } else if (clue.isHint) {
      markerId = "arrowhead-hint";
      lineClass += " hint-arrow";
    }

    const line = createSvgElement("line", {
      x1: startX,
      y1: startY,
      x2: endX,
      y2: endY,
      class: lineClass,
      "marker-end": `url(#${markerId})`,
    });
    arrowsLayer.appendChild(line);
  });

  // ----------------------------------------------------------------------------
  // DRAW PILLS INTO PILLS LAYER
  // ----------------------------------------------------------------------------
  placedPills.forEach((item) => {
    const { clue, pillW, pillH, x: pillX, y: pillY } = item;

    const pillGroup = createSvgElement("g", {
      class: "svg-clue-group",
    });

    let pillClass = "svg-clue-pill";
    if (clue.isWrongGuess) pillClass += " wrong-guess-pill";
    else if (clue.isHint) pillClass += " hint-pill";

    const radius = pillH / 2;
    const rect = createSvgElement("rect", {
      x: pillX - pillW / 2,
      y: pillY - pillH / 2,
      width: pillW,
      height: pillH,
      rx: radius,
      ry: radius,
      class: pillClass,
    });
    pillGroup.appendChild(rect);

    // City Name (Title)
    const titleText = createSvgElement("text", {
      x: pillX,
      y: pillY - 4,
      class: "svg-clue-text-title",
    });
    titleText.textContent = clue.name;
    pillGroup.appendChild(titleText);

    // State / Tag (Sub)
    const subText = createSvgElement("text", {
      x: pillX,
      y: pillY + 12,
      class: "svg-clue-text-sub",
    });
    subText.textContent = clue.isWrongGuess
      ? `${clue.state} (Guess)`
      : clue.isHint
      ? `${clue.state} (Hint)`
      : clue.state;
    pillGroup.appendChild(subText);

    pillsLayer.appendChild(pillGroup);
  });

  // ----------------------------------------------------------------------------
  // DRAW CENTER MYSTERY CIRCLE
  // ----------------------------------------------------------------------------
  const centerCircle = createSvgElement("circle", {
    cx,
    cy,
    r: centerRadius,
    class: "svg-center-circle",
  });
  centerLayer.appendChild(centerCircle);

  // Center Text: "City ?"
  const centerText1 = createSvgElement("text", {
    x: cx,
    y: cy - 8,
    class: "svg-center-text",
  });
  centerText1.textContent = "City";
  centerLayer.appendChild(centerText1);

  const centerText2 = createSvgElement("text", {
    x: cx,
    y: cy + 16,
    class: "svg-center-text",
    style: "font-size: 24px; fill: var(--center-question, #38bdf8);",
  });
  centerText2.textContent = "?";
  centerLayer.appendChild(centerText2);
}

// ==============================================================================
// 6. GAME LIFECYCLE & USER INTERACTIONS
// ==============================================================================

async function initGame() {
  try {
    const [citiesRes, palettesRes] = await Promise.all([
      fetch("data/cities_india.json"),
      fetch("daily_palettes.json").catch(() => null),
    ]);

    if (!citiesRes.ok) throw new Error(`HTTP ${citiesRes.status}: Failed to load cities`);
    STATE.allCities = await citiesRes.json();

    if (palettesRes && palettesRes.ok) {
      STATE.palettes = await palettesRes.json();
    }

    // Apply saved theme preference (default: classic)
    const savedTheme = localStorage.getItem("geocentric_theme") || "classic";
    applyTheme(savedTheme);

    startNewRound();
    setupEventListeners();
  } catch (err) {
    console.error("Initialization error:", err);
    alert("Error loading dataset! Make sure the HTTP server is running.");
  }
}

function startNewRound() {
  STATE.isGameOver = false;
  STATE.guesses = [];
  STATE.hintsUsed = 0;

  // Filter pool by chosen tier
  const pool = STATE.allCities.filter((c) => c.tier <= STATE.currentTier && c.tier !== 0);

  // Pick a random target city from the active pool
  const randIdx = Math.floor(Math.random() * pool.length);
  STATE.targetCity = pool[randIdx];

  // Generate 5 balanced clues
  STATE.clues = selectClues(STATE.targetCity, pool, 5);

  // Reset UI components
  renderCompass(STATE.clues);
  updateStatusUI();
  updateGuessesUI();
  hideModals();

  const cityInput = document.getElementById("city-input");
  cityInput.value = "";
  cityInput.disabled = false;
  document.getElementById("submit-btn").disabled = false;
  cityInput.focus();

  console.log(`[GeoCentric] Mystery City: ${STATE.targetCity.name} (${STATE.targetCity.state})`);
}

function updateStatusUI() {
  document.getElementById("guesses-count").textContent = `${STATE.guesses.length} / ${STATE.maxGuesses}`;

  const hintBtn = document.getElementById("hint-btn");
  if (hintBtn) {
    const hintsLeft = STATE.maxHints - STATE.hintsUsed;
    hintBtn.textContent = `Hint (${hintsLeft} left)`;
    hintBtn.disabled = hintsLeft <= 0 || STATE.isGameOver;
  }
}

function updateGuessesUI() {
  const container = document.getElementById("guesses-list");
  if (!container) return;
  container.innerHTML = "";

  STATE.guesses.forEach((guessedName) => {
    const slot = document.createElement("div");
    slot.className = "guess-slot";

    if (guessedName.toLowerCase() === STATE.targetCity.name.toLowerCase()) {
      slot.classList.add("correct");
      slot.textContent = `${guessedName} (Correct)`;
    } else {
      slot.classList.add("wrong");
      slot.textContent = `${guessedName}`;
    }

    container.appendChild(slot);
  });
}

function addHintClue() {
  if (STATE.isGameOver || STATE.hintsUsed >= STATE.maxHints) return;

  const pool = STATE.allCities.filter((c) => c.tier <= STATE.currentTier && c.tier !== 0);

  const existingNames = new Set(STATE.clues.map((c) => c.name.toLowerCase()));
  existingNames.add(STATE.targetCity.name.toLowerCase());

  const candidates = pool.filter((c) => !existingNames.has(c.name.toLowerCase()));
  if (candidates.length === 0) {
    alert("No more eligible hint cities in this difficulty tier.");
    return;
  }

  // Find the largest angular gap between existing clues
  let maxGap = -1;
  let targetAngle = 0;

  for (let i = 0; i < STATE.clues.length; i++) {
    const curBearing = STATE.clues[i].bearing;
    const nextBearing =
      i === STATE.clues.length - 1
        ? STATE.clues[0].bearing + 360
        : STATE.clues[i + 1].bearing;
    const gap = nextBearing - curBearing;
    if (gap > maxGap) {
      maxGap = gap;
      targetAngle = (curBearing + gap / 2) % 360;
    }
  }

  let bestCity = null;
  let bestDiff = Infinity;
  let bestBearing = 0;
  let bestDist = 0;

  for (const c of candidates) {
    const b = mercatorBearing(STATE.targetCity.lat, STATE.targetCity.lon, c.lat, c.lon);
    const diff = angularDistance(b, targetAngle);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestCity = c;
      bestBearing = Math.round(b * 10) / 10;
      bestDist = haversineDistanceKm(STATE.targetCity.lat, STATE.targetCity.lon, c.lat, c.lon);
    }
  }

  if (!bestCity) return;

  STATE.hintsUsed++;
  STATE.clues.push({
    ...bestCity,
    bearing: bestBearing,
    distanceKm: bestDist,
    isHint: true,
  });

  STATE.clues.sort((a, b) => a.bearing - b.bearing);
  renderCompass(STATE.clues);
  updateStatusUI();
}

function submitGuess(cityName) {
  if (STATE.isGameOver || !cityName) return;

  const cleanName = cityName.trim();
  const match = STATE.allCities.find((c) => c.name.toLowerCase() === cleanName.toLowerCase());
  if (!match) {
    alert(`"${cleanName}" is not in our city database! Please pick from suggestions.`);
    return;
  }

  if (STATE.guesses.some((g) => g.toLowerCase() === match.name.toLowerCase())) {
    alert(`You already guessed ${match.name}! Try another city.`);
    return;
  }

  STATE.guesses.push(match.name);
  updateGuessesUI();

  const cityInput = document.getElementById("city-input");
  cityInput.value = "";
  hideSuggestions();

  // Check Win condition
  if (match.name.toLowerCase() === STATE.targetCity.name.toLowerCase()) {
    endGame(true, false);
    return;
  }

  // Wrong guess: plot onto compass
  const alreadyInClues = STATE.clues.some((c) => c.name.toLowerCase() === match.name.toLowerCase());
  if (!alreadyInClues) {
    const bearing = mercatorBearing(STATE.targetCity.lat, STATE.targetCity.lon, match.lat, match.lon);
    const distanceKm = haversineDistanceKm(STATE.targetCity.lat, STATE.targetCity.lon, match.lat, match.lon);

    STATE.clues.push({
      ...match,
      bearing: Math.round(bearing * 10) / 10,
      distanceKm,
      isWrongGuess: true,
    });

    STATE.clues.sort((a, b) => a.bearing - b.bearing);
    renderCompass(STATE.clues);
  }

  updateStatusUI();

  // Check Loss condition (exhausted 6 attempts)
  if (STATE.guesses.length >= STATE.maxGuesses) {
    endGame(false, false);
  }
}

function endGame(isWin, isGiveUp = false) {
  STATE.isGameOver = true;
  document.getElementById("city-input").disabled = true;
  document.getElementById("submit-btn").disabled = true;

  // Reveal center circle in SVG
  const centerCircle = document.querySelector(".svg-center-circle");
  if (centerCircle) {
    centerCircle.style.fill = isWin ? "#065f46" : "#7f1d1d";
    centerCircle.style.stroke = isWin ? "#10b981" : "#ef4444";
  }

  const centerText1 = document.querySelector(".svg-center-text");
  if (centerText1) centerText1.textContent = STATE.targetCity.name;

  const centerText2 = document.querySelectorAll(".svg-center-text")[1];
  if (centerText2) {
    centerText2.textContent = STATE.targetCity.state;
    centerText2.style.fontSize = "13px";
    centerText2.style.fill = "#94a3b8";
  }

  // Show Game Over Modal (strictly no emojis)
  const modal = document.getElementById("game-over-modal");
  const title = document.getElementById("game-over-title");
  const desc = document.getElementById("game-over-desc");
  const sol = document.getElementById("game-over-solution");

  title.textContent = isWin ? "Outstanding!" : (isGiveUp ? "Game Over" : "Nice Try!");
  desc.textContent = isWin
    ? `You solved the compass in ${STATE.guesses.length} attempt(s)!`
    : isGiveUp
    ? "You gave up. The mystery city was:"
    : "You ran out of guesses. The mystery city was:";
  sol.textContent = `${STATE.targetCity.name}, ${STATE.targetCity.state}`;

  modal.classList.remove("hidden");
  updateStatusUI();
}

function hideModals() {
  document.getElementById("help-modal").classList.add("hidden");
  document.getElementById("game-over-modal").classList.add("hidden");
}

// ==============================================================================
// 7. AUTOCOMPLETE & UI LISTENERS
// ==============================================================================

function setupEventListeners() {
  const cityInput = document.getElementById("city-input");
  const submitBtn = document.getElementById("submit-btn");
  const suggestionsList = document.getElementById("suggestions-list");
  const tierSelect = document.getElementById("tier-select");
  const themeSelect = document.getElementById("theme-select");
  const giveupBtn = document.getElementById("giveup-btn");
  const hintBtn = document.getElementById("hint-btn");
  const helpBtn = document.getElementById("help-btn");
  const closeModalBtn = document.getElementById("close-modal-btn");
  const playAgainBtn = document.getElementById("play-again-btn");

  // Autocomplete typing listener
  cityInput.addEventListener("input", (e) => {
    const query = e.target.value.trim().toLowerCase();
    if (query.length < 1) {
      hideSuggestions();
      return;
    }

    const matches = STATE.allCities
      .filter((c) => c.name.toLowerCase().includes(query) && c.tier <= STATE.currentTier)
      .slice(0, 6);

    renderSuggestions(matches);
  });

  // Submit on Button Click
  submitBtn.addEventListener("click", () => {
    submitGuess(cityInput.value);
  });

  // Submit on Enter key
  cityInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const activeSuggestion = suggestionsList.querySelector("li.active");
      if (activeSuggestion) {
        submitGuess(activeSuggestion.dataset.city);
      } else {
        submitGuess(cityInput.value);
      }
    }
  });

  // Tier change listener
  tierSelect.addEventListener("change", (e) => {
    STATE.currentTier = parseInt(e.target.value, 10);
    startNewRound();
  });

  // Theme change listener
  if (themeSelect) {
    themeSelect.addEventListener("change", (e) => {
      applyTheme(e.target.value);
    });
  }

  // Give up button listener
  if (giveupBtn) {
    giveupBtn.addEventListener("click", () => {
      if (!STATE.isGameOver) {
        endGame(false, true);
      }
    });
  }

  // Hint button listener
  if (hintBtn) {
    hintBtn.addEventListener("click", () => {
      addHintClue();
    });
  }

  // Help modal toggle
  helpBtn.addEventListener("click", () => {
    document.getElementById("help-modal").classList.remove("hidden");
  });
  closeModalBtn.addEventListener("click", () => {
    document.getElementById("help-modal").classList.add("hidden");
  });
  playAgainBtn.addEventListener("click", () => {
    startNewRound();
  });
}

function renderSuggestions(matches) {
  const suggestionsList = document.getElementById("suggestions-list");
  suggestionsList.innerHTML = "";

  if (matches.length === 0) {
    hideSuggestions();
    return;
  }

  matches.forEach((city, index) => {
    const li = document.createElement("li");
    if (index === 0) li.classList.add("active");
    li.dataset.city = city.name;
    li.innerHTML = `
      <span>${city.name}</span>
      <span class="city-state">${city.state}</span>
    `;

    li.addEventListener("click", () => {
      document.getElementById("city-input").value = city.name;
      submitGuess(city.name);
    });

    suggestionsList.appendChild(li);
  });

  suggestionsList.classList.remove("hidden");
}

function hideSuggestions() {
  const suggestionsList = document.getElementById("suggestions-list");
  suggestionsList.innerHTML = "";
  suggestionsList.classList.add("hidden");
}

// Start game when page loads
window.addEventListener("DOMContentLoaded", initGame);
