/**
 * GeoCentric - Web Game Engine (Vanilla JS)
 * -----------------------------------------
 * Handles:
 * 1. Dataset loading (fetch API)
 * 2. Mercator trigonometry & Haversine distance calculations
 * 3. Capacity-aware clue selection algorithm
 * 4. Collision-free SVG Compass rendering with dynamic scaling
 * 5. Hint additions, wrong guess compass plotting, and game state
 */

// ==============================================================================
// 1. GAME STATE
// ==============================================================================

const STATE = {
  allCities: [],
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

// Helper: Calculates shortest angular distance between two angles [0, 360)
function angularDistance(a1, a2) {
  const diff = Math.abs(a1 - a2) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// ==============================================================================
// 3. CLUE SELECTION ALGORITHM (Pure Two-Phase Capacity-Aware)
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
// 4. SVG COMPASS RENDERER (Dynamic Scaling + Layered Elements)
// ==============================================================================

function renderCompass(clues) {
  const svg = document.getElementById("compass-svg");
  svg.innerHTML = ""; // Clear existing SVG contents

  const cx = 300;
  const cy = 300;
  const centerRadius = 54;

  // SVG Helper: Create an element with namespace
  const createSvgElement = (tag, attrs = {}) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, val] of Object.entries(attrs)) {
      el.setAttribute(key, val);
    }
    return el;
  };

  // Defs: Reusable Crisp Arrowhead Markers for standard, hint, and wrong guess
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

  defs.appendChild(createMarker("arrowhead", "#94a3b8"));
  defs.appendChild(createMarker("arrowhead-hint", "#f59e0b"));
  defs.appendChild(createMarker("arrowhead-wrong", "#ef4444"));
  svg.appendChild(defs);

  // SVG Layers to ensure proper z-index order:
  // 1. Arrows Layer (bottom)
  // 2. Pills Layer (middle)
  // 3. Center Circle Layer (top)
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

    // Clean pill sizing (no emoji)
    const longestTextLen = Math.max(clue.name.length + 2, clue.state.length);
    const pillW = Math.max(124, Math.min(180, longestTextLen * 8.4 + 24));
    const pillH = 44;
    const halfW = pillW / 2 + 10; // 10px horizontal collision clearance
    const halfH = pillH / 2 + 8;  // 8px vertical collision clearance

    // Start radius
    let currentR = 190;

    const checkCollision = (testX, testY) => {
      return placedPills.some((p) => {
        return Math.abs(testX - p.x) < halfW + p.halfW && Math.abs(testY - p.y) < halfH + p.halfH;
      });
    };

    let posX = cx + currentR * Math.sin(angleRad);
    let posY = cy - currentR * Math.cos(angleRad);

    // Expand outward radially as much as needed to guarantee zero overlaps
    while (checkCollision(posX, posY) && currentR < 700) {
      currentR += 14;
      posX = cx + currentR * Math.sin(angleRad);
      posY = cy - currentR * Math.cos(angleRad);
    }

    // Mathematical Ray-Pill Boundary Intersection:
    // Calculates exact distance from pill center to its edge along the bearing ray
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

    // Arrowhead tip touches the outer rim of the pill
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

    // City Name (Title) - Clean text without emojis
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
    style: "font-size: 24px; fill: #38bdf8;",
  });
  centerText2.textContent = "?";
  centerLayer.appendChild(centerText2);
}

// ==============================================================================
// 5. GAME LIFECYCLE & USER INTERACTIONS
// ==============================================================================

async function initGame() {
  try {
    const res = await fetch("data/cities_india.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load dataset`);
    STATE.allCities = await res.json();

    startNewRound();
    setupEventListeners();
  } catch (err) {
    console.error("Initialization error:", err);
    alert("Error loading city dataset! Make sure the HTTP server is running.");
  }
}

function startNewRound() {
  STATE.isGameOver = false;
  STATE.guesses = [];
  STATE.hintsUsed = 0;

  // Filter pool by chosen tier (e.g., tier <= 100)
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

  // Names of cities already on compass or target
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

  // Pick candidate city whose bearing from target is closest to the gap's bisector
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
// 6. AUTOCOMPLETE & UI LISTENERS
// ==============================================================================

function setupEventListeners() {
  const cityInput = document.getElementById("city-input");
  const submitBtn = document.getElementById("submit-btn");
  const suggestionsList = document.getElementById("suggestions-list");
  const tierSelect = document.getElementById("tier-select");
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
