"""
GeoCentric - Core Math & Clue Generation Prototype
--------------------------------------------------
This script implements:
1. Mercator projection coordinate conversion and angle calculation.
2. 8-octant compass binning (N, NE, E, SE, S, SW, W, NW).
3. Clue selection algorithm matching the specifications in game _design.txt.
"""

import math
import random

# ==============================================================================
# 1. THE MATH: Mercator Angle Calculation
# ==============================================================================

def mercator_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculates the compass angle (in degrees, 0 to 360) from City 1 to City 2
    using the Web Mercator projection so it matches a standard 2D flat map.

    Bearing definition:
      0°   = North (Straight Up)
      90°  = East  (Right)
      180° = South (Straight Down)
      270° = West  (Left)
    """
    # Step A: Convert latitude & longitude from degrees to radians
    phi1 = math.radians(lat1)
    lam1 = math.radians(lon1)
    phi2 = math.radians(lat2)
    lam2 = math.radians(lon2)

    # Step B: Mercator formulas
    # x = longitude (in radians)
    # y = ln(tan(pi/4 + lat/2))
    x1 = lam1
    y1 = math.log(math.tan(math.pi / 4 + phi1 / 2))

    x2 = lam2
    y2 = math.log(math.tan(math.pi / 4 + phi2 / 2))

    dx = x2 - x1
    dy = y2 - y1

    # Step C: atan2(dx, dy)
    # Notice: In standard Cartesian math, angle = atan2(dy, dx) where 0° = +X (East).
    # But for a geographic compass, 0° = +Y (North), and angles increase clockwise!
    # By swapping arguments to atan2(dx, dy), 0° points North and 90° points East.
    angle_rad = math.atan2(dx, dy)
    angle_deg = math.degrees(angle_rad)

    # Normalize to [0, 360)
    return (angle_deg + 360) % 360


def angle_to_octant(angle_deg: float) -> int:
    """
    Maps an angle [0, 360) into one of 8 octants (0 to 7):
      0: North     (337.5° - 22.5°)
      1: NorthEast (22.5°  - 67.5°)
      2: East      (67.5°  - 112.5°)
      3: SouthEast (112.5° - 157.5°)
      4: South     (157.5° - 202.5°)
      5: SouthWest (202.5° - 247.5°)
      6: West      (247.5° - 292.5°)
      7: NorthWest (292.5° - 337.5°)
    """
    # Adding 22.5 shifts the boundary so octant 0 is centered at 0° (North)
    shifted = (angle_deg + 22.5) % 360
    return int(shifted // 45)

OCTANT_NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


# ==============================================================================
# 2. SAMPLE DATASET (Represented as a list of Python dictionaries)
# ==============================================================================

SAMPLE_CITIES = [
    {"name": "Mumbai",       "state": "Maharashtra",   "lat": 19.0760, "lon": 72.8777, "rank": 1},
    {"name": "Delhi",        "state": "Delhi",         "lat": 28.6139, "lon": 77.2090, "rank": 2},
    {"name": "Bengaluru",    "state": "Karnataka",     "lat": 12.9716, "lon": 77.5946, "rank": 3},
    {"name": "Kolkata",      "state": "West Bengal",   "lat": 22.5726, "lon": 88.3639, "rank": 4},
    {"name": "Surat",        "state": "Gujarat",       "lat": 21.1702, "lon": 72.8311, "rank": 5},
    {"name": "Bhiwandi",     "state": "Maharashtra",   "lat": 19.2967, "lon": 73.0631, "rank": 6},
    {"name": "Pune",         "state": "Maharashtra",   "lat": 18.5204, "lon": 73.8567, "rank": 7},
    {"name": "Bhubaneswar",  "state": "Odisha",        "lat": 20.2961, "lon": 85.8245, "rank": 8},
    {"name": "Panaji",       "state": "Goa",           "lat": 15.4909, "lon": 73.8278, "rank": 9},
    {"name": "Hyderabad",    "state": "Telangana",     "lat": 17.3850, "lon": 78.4867, "rank": 10},
    {"name": "Chennai",      "state": "Tamil Nadu",    "lat": 13.0827, "lon": 80.2707, "rank": 11},
    {"name": "Ahmedabad",    "state": "Gujarat",       "lat": 23.0225, "lon": 72.5714, "rank": 12},
    {"name": "Jaipur",       "state": "Rajasthan",     "lat": 26.9124, "lon": 75.7873, "rank": 13},
    {"name": "Bhopal",       "state": "Madhya Pradesh","lat": 23.2599, "lon": 77.4126, "rank": 14},
    {"name": "Patna",        "state": "Bihar",         "lat": 25.5941, "lon": 85.1376, "rank": 15},
    {"name": "Nagpur",       "state": "Maharashtra",   "lat": 21.1458, "lon": 79.0882, "rank": 16},
    {"name": "Nashik",       "state": "Maharashtra",   "lat": 19.9975, "lon": 73.7898, "rank": 17},
    {"name": "Indore",       "state": "Madhya Pradesh","lat": 22.7196, "lon": 75.8577, "rank": 18},
    {"name": "Varanasi",     "state": "Uttar Pradesh", "lat": 25.3176, "lon": 82.9739, "rank": 19},
    {"name": "Kochi",        "state": "Kerala",        "lat": 9.9312,  "lon": 76.2673, "rank": 20},
]


# ==============================================================================
# 3. CLUE FINDING ALGORITHM (Your exact specification)
# ==============================================================================

def select_clues(target_city: dict, city_pool: list[dict], num_clues: int = 5) -> list[dict]:
    """
    Selects `num_clues` reference cities around `target_city` ensuring wide angular diversity.
    """
    # Step 1: Bucket candidate cities into their respective octant (0..7) wrt target_city
    # We use a dictionary where key is octant index (0..7) and value is a list of candidate cities.
    octant_buckets = {i: [] for i in range(8)}

    for city in city_pool:
        # Never pick the target city as its own clue
        if city["name"] == target_city["name"]:
            continue

        bearing = mercator_bearing(target_city["lat"], target_city["lon"], city["lat"], city["lon"])
        octant = angle_to_octant(bearing)

        # Attach computed metadata to the city object for presentation
        city_with_bearing = {
            **city,
            "bearing": round(bearing, 1),
            "octant": octant,
            "direction_label": OCTANT_NAMES[octant]
        }
        octant_buckets[octant].append(city_with_bearing)

    # Step 2: Filter non-empty segments
    available_octants = [octant for octant, cities in octant_buckets.items() if len(cities) > 0]

    if not available_octants:
        raise ValueError("Not enough cities in pool to generate clues!")

    # Step 3: Choose segments based on availability
    # Case A: More than 5 available -> choose 5 distinct segments uniformly at random
    if len(available_octants) > num_clues:
        chosen_octants = random.sample(available_octants, num_clues)
    # Case B: Exactly 5 available -> choose all 5
    elif len(available_octants) == num_clues:
        chosen_octants = list(available_octants)
    # Case C: Less than 5 available -> choose all available, then sample from them to fill the rest
    else:
        chosen_octants = list(available_octants)
        while len(chosen_octants) < num_clues:
            chosen_octants.append(random.choice(available_octants))

    # Step 4: Pick 1 unique city from each chosen segment
    selected_clues = []
    # To prevent duplicate city picks, maintain a copy of each bucket that we can pop from
    remaining_pool = {octant: list(cities) for octant, cities in octant_buckets.items()}

    for octant in chosen_octants:
        # If this octant still has available cities, pick one
        if remaining_pool[octant]:
            picked_city = random.choice(remaining_pool[octant])
            remaining_pool[octant].remove(picked_city)
            selected_clues.append(picked_city)
        else:
            # Fallback: If this octant ran out of cities, pick from any remaining non-empty octant
            non_empty_octants = [o for o, c in remaining_pool.items() if len(c) > 0]
            if non_empty_octants:
                fallback_octant = random.choice(non_empty_octants)
                picked_city = random.choice(remaining_pool[fallback_octant])
                remaining_pool[fallback_octant].remove(picked_city)
                selected_clues.append(picked_city)

    # Sort clues clockwise by bearing for clean display around the compass
    selected_clues.sort(key=lambda c: c["bearing"])
    return selected_clues


# ==============================================================================
# 4. TEST RUN (Target = Mumbai)
# ==============================================================================

if __name__ == "__main__":
    mumbai = next(c for c in SAMPLE_CITIES if c["name"] == "Mumbai")

    print("==================================================")
    print(f"TARGET CITY: {mumbai['name']} ({mumbai['lat']}° N, {mumbai['lon']}° E)")
    print("==================================================")

    clues = select_clues(mumbai, SAMPLE_CITIES, num_clues=5)

    print("\nGenerated Clues (sorted clockwise):")
    for i, clue in enumerate(clues, 1):
        arrow = {
            "N": "↑", "NE": "↗", "E": "→", "SE": "↘",
            "S": "↓", "SW": "↙", "W": "←", "NW": "↖"
        }.get(clue['direction_label'], "•")
        
        print(f"  {i}. {arrow} {clue['name']:<12} ({clue['state']:<14}) | Bearing: {clue['bearing']:>5.1f}° [{clue['direction_label']}]")
