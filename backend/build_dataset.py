"""
GeoCentric Dataset Builder
--------------------------
Step-by-step script to fetch, clean, and build:
backend/data/cities_india.json
"""

import io             # Treats bytes in memory like an open file (BytesIO)
import json           # Parses and writes JSON
import os             # File paths and directories
import urllib.request # Performs HTTP requests
import zipfile        # Unzips .zip archives directly in memory

# Source URLs from GeoNames (free open data under CC-BY 4.0)
GEONAMES_STATES_URL = "https://download.geonames.org/export/dump/admin1CodesASCII.txt"
GEONAMES_CITIES_URL = "https://download.geonames.org/export/dump/cities15000.zip"

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "data", "cities_india.json")


def get_india_states() -> dict[str, str]:
    """
    Downloads and parses GeoNames admin1 codes to map code -> State/UT name.
    Example: '16' -> 'Maharashtra', '07' -> 'Delhi'
    """
    print("[1/4] Fetching Indian state codes mapping from GeoNames...")
    req = urllib.request.Request(GEONAMES_STATES_URL, headers={"User-Agent": "GeoCentric/1.0"})
    
    with urllib.request.urlopen(req) as response:
        # decode('utf-8') converts raw bytes into a Python string
        text = response.read().decode("utf-8")

    states = {}
    for line in text.splitlines():
        # Each line is tab-separated: "IN.16\tMaharashtra\tMaharashtra\t..."
        if line.startswith("IN."):
            parts = line.split("\t")
            code = parts[0].split(".")[1]  # 'IN.16' -> '16'
            state_name = parts[1]          # 'Maharashtra'
            states[code] = state_name

    print(f"      Mapped {len(states)} States and Union Territories.")
    return states

def get_india_cities(code_to_state_map: dict[str, str]) -> list[dict]:
    """
    Downloads and parses GeoNames cities15000.zip to extract only cities located in India.
    """
    print("[2/4] Fetching and filtering Indian cities from GeoNames...")

    req = urllib.request.Request(GEONAMES_CITIES_URL, headers={"User-Agent": "GeoCentric/1.0"})
    
    with urllib.request.urlopen(req) as response:
        archive_bytes = response.read()
    
    print("[3/4] Parsing Indian cities and linking state names...")

    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as z:
        # Read the text file inside the zip
        with z.open("cities15000.txt") as f:
            lines = f.read().decode("utf-8").splitlines()
    
    cities_india = []
    
    for line in lines:
        parts = line.split("\t")
        if len(parts) > 14 and parts[8] == 'IN' and parts[7]!='PPLX' :
            name = parts[2].strip()
            lat = float(parts[4])
            lon = float(parts[5])
            admin1_code = parts[10]
            population = int(parts[14]) if parts[14].isdigit() else 0

            state = code_to_state_map.get(admin1_code, "India")

            cities_india.append({
                "name": name,
                "lat": lat,
                "lon": lon,
                "state": state,
                "country": "India",
                "scope": "INDIA",
                "population": population
            })

    print(f"      Extracted {len(cities_india)} Indian cities from dataset.")
    return cities_india

def sort_cities_and_assign_tier(cities:list[dict]) -> list[dict]:
    """
    sort the cities in decreasing order of population.

    assign tier:
        top 50 get teir = '50'
        top 100 get tier = '100'
        top 350 get tier = '350'
        top 500 get tier = '500'
        else get tier '0'
    """
    
    sorted_cities = sorted(cities, key=lambda x: x["population"], reverse=True)
    tiers = [50, 100, 350, 500]

    # assign tier
    for i, city in enumerate(sorted_cities):
        if i < tiers[0]:
            city["tier"] = 50
        elif i < tiers[1]:
            city["tier"] = 100
        elif i < tiers[2]:
            city["tier"] = 350
        elif i < tiers[3]:
            city["tier"] = 500
        else:
            city["tier"] = 0
        city["rank"] = i+1
    return sorted_cities


def save_cities_to_json(cities: list[dict], filepath: str, limit: int = 500) -> None:
    """
    Saves the top `limit` cities to a formatted JSON file.
    """
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    
    export_cities = cities[:limit] if limit else cities
    
    print(f"[4/4] Saving Top {len(export_cities)} cities to {filepath}...")
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(export_cities, f, indent=2, ensure_ascii=False)
        
    size_kb = os.path.getsize(filepath) // 1024
    print(f"      Successfully generated dataset! Size: {size_kb} KB.")


if __name__ == "__main__":
    states_map = get_india_states()
    cities = get_india_cities(states_map)
    cities = sort_cities_and_assign_tier(cities)
    
    # Save the Top 500 cities to backend/data/cities_india.json
    save_cities_to_json(cities, OUTPUT_PATH, limit=500)
