/**
 * GeoCentric - Web Game Engine (Vanilla JS)
 * -----------------------------------------
 * Handles:
 * 1. Dataset loading (fetch API)
 * 2. Mercator trigonometry & Haversine distance calculations
 * 3. Capacity-aware clue selection algorithm
 * 4. SVG Compass rendering
 * 5. Guess validation, hint reveals, and game state
 */

// ==============================================================================
// 1. GAME STATE
// ==============================================================================

const STATE = {
  allCities: [],
  currentTier: 100,      // Default: Medium (Top 100)
  targetCity: null,      // The mystery center city
  clues: [],             // 5 reference cities around target
  revealedHints: new Set(), // Set of clue indices whose distances are revealed
  guesses: [],           // Player attempts (max 6)
  maxGuesses: 6,
  maxHints: 3,
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
// 4. SVG COMPASS RENDERER (Collision-Free Radial Placement Solver)
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

  // Defs: Reusable Crisp Arrowhead Marker
  const defs = createSvgElement("defs");
  const marker = createSvgElement("marker", {
    id: "arrowhead",
    markerWidth: "10",
    markerHeight: "10",
    refX: "8",
    refY: "5",
    orient: "auto",
  });
  const polygon = createSvgElement("polygon", {
    points: "0 2, 8 5, 0 8",
    fill: "#94a3b8",
  });
  marker.appendChild(polygon);
  defs.appendChild(marker);
  svg.appendChild(defs);

  // ----------------------------------------------------------------------------
  // COLLISION-FREE RADIAL SOLVER (Scaled Pills + Exact Boundary Contact)
  // ----------------------------------------------------------------------------
  const placedPills = []; // Stores { x, y, halfW, halfH, R }

  clues.forEach((clue, idx) => {
    const angleRad = (clue.bearing * Math.PI) / 180;
    const isHinted = STATE.revealedHints.has(idx);

    // Scaled pill dimensions (+12-15% bigger)
    const longestTextLen = Math.max(clue.name.length + 4, clue.state.length);
    const pillW = Math.max(120, Math.min(176, longestTextLen * 8.2 + 24));
    const pillH = isHinted ? 52 : 42;
    const halfW = pillW / 2 + 8; // 8px collision margin
    const halfH = pillH / 2 + 8;

    // Start at comfortable base radius
    let currentR = 190;

    const checkCollision = (testX, testY) => {
      return placedPills.some((p) => {
        return Math.abs(testX - p.x) < halfW + p.halfW && Math.abs(testY - p.y) < halfH + p.halfH;
      });
    };

    let posX = cx + currentR * Math.sin(angleRad);
    let posY = cy - currentR * Math.cos(angleRad);

    while (checkCollision(posX, posY) && currentR < 350) {
      currentR += 14;
      posX = cx + currentR * Math.sin(angleRad);
      posY = cy - currentR * Math.cos(angleRad);
    }

    // Mathematical Ray-Pill Boundary Intersection:
    // Calculates exact distance from pill center to its edge along the bearing ray
    const absSin = Math.abs(Math.sin(angleRad)) + 0.001;
    const absCos = Math.abs(Math.cos(angleRad)) + 0.001;
    const edgeDist = Math.min((pillW / 2) / absSin, (pillH / 2) / absCos);

    placedPills.push({
      clue,
      idx,
      angleRad,
      isHinted,
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

  // Draw Radiating Clues (Arrows + City Pills)
  placedPills.forEach((item) => {
    const { clue, idx, angleRad, isHinted, pillW, pillH, edgeDist, x: pillX, y: pillY, R } = item;

    // Arrow length is calculated so the arrowhead tip JUST touches the pill's outer rim!
    const arrowStopR = R - edgeDist - 4;
    const arrowLength = Math.max(20, arrowStopR - centerRadius);

    // Arrow starts at edge of center circle
    const startX = cx + centerRadius * Math.sin(angleRad);
    const startY = cy - centerRadius * Math.cos(angleRad);

    // Arrow ends precisely at the outer rim of the pill
    const endX = cx + (centerRadius + arrowLength) * Math.sin(angleRad);
    const endY = cy - (centerRadius + arrowLength) * Math.cos(angleRad);

    // Line with arrow head
    const line = createSvgElement("line", {
      x1: startX,
      y1: startY,
      x2: endX,
      y2: endY,
      class: "svg-arrow-line",
      "marker-end": "url(#arrowhead)",
    });
    svg.appendChild(line);

    // Group for Pill + Text
    const pillGroup = createSvgElement("g", {
      class: "svg-clue-group",
      style: "cursor: pointer;",
    });

    const radius = pillH / 2;
    const rect = createSvgElement("rect", {
      x: pillX - pillW / 2,
      y: pillY - pillH / 2,
      width: pillW,
      height: pillH,
      rx: radius,
      ry: radius,
      class: "svg-clue-pill",
    });

    if (isHinted) {
      rect.style.stroke = "#f59e0b";
      rect.style.fill = "rgba(40, 30, 20, 0.85)";
    }

    pillGroup.appendChild(rect);

    // City Name (Title)
    const titleText = createSvgElement("text", {
      x: pillX,
      y: isHinted ? pillY - 11 : pillY - 5,
      class: "svg-clue-text-title",
    });
    titleText.textContent = `🇮🇳 ${clue.name}`;
    pillGroup.appendChild(titleText);

    // State / Distance (Sub)
    const subText = createSvgElement("text", {
      x: pillX,
      y: isHinted ? pillY + 6 : pillY + 12,
      class: "svg-clue-text-sub",
    });
    subText.textContent = clue.state;
    pillGroup.appendChild(subText);

    // If hinted, display distance badge
    if (isHinted) {
      const distText = createSvgElement("text", {
        x: pillX,
        y: pillY + 20,
        class: "svg-clue-text-sub",
        style: "fill: #fbbf24; font-weight: 700; font-size: 11px;",
      });
      distText.textContent = `📏 ${clue.distanceKm} km away`;
      pillGroup.appendChild(distText);
    }

    // Clicking a pill directly reveals its distance (uses 1 hint)
    pillGroup.addEventListener("click", () => revealClueHint(idx));

    svg.appendChild(pillGroup);
  });

  // Center Mystery Circle

  const centerCircle = createSvgElement("circle", {

    cx,
    cy,
    r: centerRadius,
    class: "svg-center-circle",
  });
  svg.appendChild(centerCircle);

  // Center Text: "City ?"
  const centerText1 = createSvgElement("text", {
    x: cx,
    y: cy - 8,
    class: "svg-center-text",
  });
  centerText1.textContent = "City";
  svg.appendChild(centerText1);

  const centerText2 = createSvgElement("text", {
    x: cx,
    y: cy + 16,
    class: "svg-center-text",
    style: "font-size: 24px; fill: #38bdf8;",
  });
  centerText2.textContent = "?";
  svg.appendChild(centerText2);
}

// ==============================================================================
// 5. GAME LIFECYCLE & USER INTERACTIONS
// ==============================================================================

async function initGame() {
  try {
    // 1. Fetch JSON dataset from frontend/data/cities_india.json
    const res = await fetch("data/cities_india.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load dataset`);
    STATE.allCities = await res.json();

    // 2. Start a fresh round
    startNewRound();

    // 3. Setup UI Event Listeners
    setupEventListeners();
  } catch (err) {
    console.error("Initialization error:", err);
    alert("Error loading city dataset! Make sure the HTTP server is running.");
  }
}

function startNewRound() {
  STATE.isGameOver = false;
  STATE.guesses = [];
  STATE.revealedHints.clear();

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

  console.log(`[Cheat Code / Debug] Mystery City: ${STATE.targetCity.name} (${STATE.targetCity.state})`);
}

function updateStatusUI() {
  document.getElementById("guesses-count").textContent = `${STATE.guesses.length} / ${STATE.maxGuesses}`;

  const hintBtns = document.querySelectorAll(".hint-btn");
  hintBtns.forEach((btn, idx) => {
    btn.disabled = idx < STATE.revealedHints.size || STATE.revealedHints.size >= STATE.maxHints;
  });
}

function updateGuessesUI() {
  for (let i = 0; i < STATE.maxGuesses; i++) {
    const slot = document.getElementById(`slot-${i}`);
    slot.className = "guess-slot";
    slot.textContent = "";

    if (i < STATE.guesses.length) {
      const guessedName = STATE.guesses[i];
      slot.textContent = guessedName;

      if (guessedName.toLowerCase() === STATE.targetCity.name.toLowerCase()) {
        slot.classList.add("correct");
      } else {
        slot.classList.add("wrong");
      }
    }
  }
}

function revealClueHint(clueIndex) {
  if (STATE.isGameOver) return;
  if (STATE.revealedHints.has(clueIndex)) return;
  if (STATE.revealedHints.size >= STATE.maxHints) {
    alert("You have used all 3 hints!");
    return;
  }

  STATE.revealedHints.add(clueIndex);
  renderCompass(STATE.clues);
  updateStatusUI();
}

function submitGuess(cityName) {
  if (STATE.isGameOver || !cityName) return;

  const cleanName = cityName.trim();
  // Check if city exists in dataset
  const match = STATE.allCities.find((c) => c.name.toLowerCase() === cleanName.toLowerCase());
  if (!match) {
    alert(`"${cleanName}" is not in our city database! Please pick from suggestions.`);
    return;
  }

  // Record guess
  STATE.guesses.push(match.name);
  updateGuessesUI();
  updateStatusUI();

  // Clear input
  const cityInput = document.getElementById("city-input");
  cityInput.value = "";
  hideSuggestions();

  // Check Win condition
  if (match.name.toLowerCase() === STATE.targetCity.name.toLowerCase()) {
    endGame(true);
    return;
  }

  // Check Loss condition (exhausted 6 attempts)
  if (STATE.guesses.length >= STATE.maxGuesses) {
    endGame(false);
  }
}

function endGame(isWin) {
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
  if (centerText2) centerText2.textContent = isWin ? "🎉" : "❌";

  // Show Game Over Modal
  const modal = document.getElementById("game-over-modal");
  const title = document.getElementById("game-over-title");
  const desc = document.getElementById("game-over-desc");
  const sol = document.getElementById("game-over-solution");

  title.textContent = isWin ? "Outstanding!" : "Nice Try!";
  desc.textContent = isWin
    ? `You solved the compass in ${STATE.guesses.length} attempt(s)!`
    : `You ran out of guesses. The mystery city was:`;
  sol.textContent = `📍 ${STATE.targetCity.name}, ${STATE.targetCity.state}`;

  modal.classList.remove("hidden");
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
  const refreshBtn = document.getElementById("refresh-btn");
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

    // Filter cities matching search query
    const matches = STATE.allCities
      .filter((c) => c.name.toLowerCase().includes(query))
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

  // Refresh practice puzzle
  refreshBtn.addEventListener("click", () => startNewRound());

  // Hint Buttons
  document.querySelectorAll(".hint-btn").forEach((btn, idx) => {
    btn.addEventListener("click", () => {
      // Find first unrevealed clue and reveal its distance
      for (let i = 0; i < STATE.clues.length; i++) {
        if (!STATE.revealedHints.has(i)) {
          revealClueHint(i);
          break;
        }
      }
    });
  });

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
