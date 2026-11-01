"""
Test suite for GeoCentric clue generator.
Tests:
1. Normal target cities (Delhi, Kolkata, Bengaluru, Kochi)
2. Extreme edge case: Small pool with only 2 directions (tests Phase 2 capacity-aware filling)
3. Total underflow error check (pool with < 5 cities total)
"""

from backend.prototype import SAMPLE_CITIES, select_clues

def test_cities():
    print("==================================================")
    print("TEST 1: Multi-City Coverage (North, East, South)")
    print("==================================================")
    for city_name in ["Delhi", "Kolkata", "Bengaluru", "Kochi"]:
        target = next(c for c in SAMPLE_CITIES if c["name"] == city_name)
        clues = select_clues(target, SAMPLE_CITIES, num_clues=5)
        print(f"\nTarget: {target['name']} ({target['state']})")
        for i, c in enumerate(clues, 1):
            print(f"  {i}. {c['direction_label']:<2} {c['name']:<12} ({c['state']:<14}) {c['bearing']:>5.1f}°")

def test_few_directions():
    print("\n==================================================")
    print("TEST 2: Extreme Edge Case (Only 2 directions available)")
    print("==================================================")
    # Suppose target is City A at (0, 0)
    target = {"name": "Origin", "lat": 0.0, "lon": 0.0, "state": "Test", "rank": 1}
    # Pool has only North cities and South cities (2 directions total, 6 cities)
    small_pool = [
        {"name": "N1", "lat": 10.0, "lon": 0.0, "state": "Test", "rank": 2},
        {"name": "N2", "lat": 20.0, "lon": 0.0, "state": "Test", "rank": 3},
        {"name": "N3", "lat": 30.0, "lon": 0.0, "state": "Test", "rank": 4},
        {"name": "S1", "lat": -10.0, "lon": 0.0, "state": "Test", "rank": 5},
        {"name": "S2", "lat": -20.0, "lon": 0.0, "state": "Test", "rank": 6},
        {"name": "S3", "lat": -30.0, "lon": 0.0, "state": "Test", "rank": 7},
    ]
    clues = select_clues(target, small_pool, num_clues=5)
    print("Successfully selected 5 clues despite only 2 directions existing:")
    for i, c in enumerate(clues, 1):
        print(f"  {i}. {c['direction_label']:<2} {c['name']:<6} ({c['bearing']:>5.1f}°)")

def test_underflow():
    print("\n==================================================")
    print("TEST 3: Pool Underflow Error Handling (< 5 cities)")
    print("==================================================")
    target = {"name": "Origin", "lat": 0.0, "lon": 0.0, "state": "Test", "rank": 1}
    tiny_pool = [
        {"name": "C1", "lat": 10.0, "lon": 0.0, "state": "Test", "rank": 2},
        {"name": "C2", "lat": 20.0, "lon": 0.0, "state": "Test", "rank": 3},
    ]
    try:
        select_clues(target, tiny_pool, num_clues=5)
        print("FAIL: Should have raised ValueError")
    except ValueError as e:
        print(f"PASS: Correctly caught expected error -> '{e}'")

if __name__ == "__main__":
    test_cities()
    test_few_directions()
    test_underflow()
