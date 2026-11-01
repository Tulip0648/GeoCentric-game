# Understanding the GeoNames Data Dump

This guide explains how **GeoNames** structures geographical data, how its schema works, and how we extract and filter cities for **GeoCentric**.

---

## 1. What is GeoNames?

**GeoNames** ([geonames.org](https://www.geonames.org/)) is the world's most widely used open-source geographical database. It powers location features in Wikipedia, weather services, GIS systems, and flight tracking software.

All coordinates in GeoNames use the **WGS 84** datum (the global GPS standard).

---

## 2. The 19-Column Schema of `cities15000.txt`

The file `cities15000.txt` contains every populated place in the world with a population over 15,000 (plus all national capitals). It is formatted as a **tab-delimited (`\t`)** plain text file without headers.

Here is the exact column specification (0-indexed in Python):

| Index | Field Name | Type | Example (Mumbai) | Description |
|:---:|:---|:---|:---|:---|
| **0** | `geonameid` | Integer | `1275339` | Unique permanent identifier in GeoNames |
| **1** | `name` | String | `Mumbai` | Canonical local UTF-8 name (may include diacritics like `Thāne`) |
| **2** | `asciiname` | String | `Mumbai` | Plain ASCII English name (e.g. `Thane`, `Rajkot`) |
| **3** | `alternatenames` | String (CSV) | `Bombay,Mombai,BOM,मुम्बई` | Comma-separated alternative names, former names, spellings in other languages, airport IATA codes |
| **4** | `latitude` | Float | `19.07283` | Latitude in decimal degrees (-90 to +90) |
| **5** | `longitude` | Float | `72.88261` | Longitude in decimal degrees (-180 to +180) |
| **6** | `feature class` | Char(1) | `P` | General category (see below: `P` = Populated place) |
| **7** | `feature code` | String | `PPLA` | Specific geographical role (see hierarchy below) |
| **8** | `country code` | String(2) | `IN` | ISO 3166-1 alpha-2 country code (`IN` = India, `US` = USA) |
| **9** | `cc2` | String | `""` | Alternate country codes (for border regions) |
| **10**| `admin1 code` | String | `16` | First-order administrative unit (State code, e.g. `16` = Maharashtra) |
| **11**| `admin2 code` | String | `519` | Second-order administrative unit (District code) |
| **12**| `admin3 code` | String | `""` | Third-order administrative unit (Tehsil / Taluka) |
| **13**| `admin4 code` | String | `""` | Fourth-order administrative unit |
| **14**| `population` | Integer | `12691836` | Census / estimate population |
| **15**| `elevation` | Integer | `8` | Elevation above sea level in meters |
| **16**| `dem` | Integer | `11` | Digital Elevation Model (SRTM3 or GTOPO30) |
| **17**| `timezone` | String | `Asia/Kolkata` | IANA Timezone identifier |
| **18**| `modification date` | String | `2023-08-11` | Date of last update (`YYYY-MM-DD`) |

---

## 3. Feature Classes & Feature Codes

### Feature Class (Column 6):
GeoNames divides all geographical entities into 9 high-level classes:
* **`P`** = Populated place (cities, towns, villages) $\leftarrow$ *What we care about*
* **`A`** = Administrative boundary (country, state, district)
* **`T`** = Mountain, hill, rock
* **`H`** = Water body (river, lake, bay)
* **`L`** = Park, reserve, region
* **`S`** = Building, spot, monument, railway station

---

### Feature Code Hierarchy (Column 7):
For class **`P`**, GeoNames uses a strict administrative hierarchy:

```
PPLC  ── National Capital (e.g., New Delhi, Washington D.C., Tokyo)
 │
 ├── PPLA  ── First-order State/Province Capital (e.g., Mumbai, Jaipur, Lucknow, Chennai)
 │    │
 │    ├── PPLA2 ── District Headquarters (e.g., Surat, Pune, Varanasi, Coimbatore)
 │    │    │
 │    │    ├── PPLA3 ── Taluk / Tehsil Headquarters
 │    │    │
 │    │    └── PPL ── General Populated Place / City / Town
 │
 └── PPLX ── Section of Populated Place (Suburb, Ward, Locality: Dharavi, Rohini, Borivli)
```

### Why filtering `parts[7] != 'PPLX'` was a game-changer:
When you filter out `PPLX`:
- **Included:** Independent cities, municipal corporations, district hubs.
- **Excluded:** Internal localities or wards like *Dharavi* (inside Mumbai) or *Rohini* (inside Delhi). This prevents confusing players by asking them to distinguish a suburb from its parent metropolis!

---

## 4. Resolving State Names (`admin1CodesASCII.txt`)

GeoNames does not write `"Maharashtra"` into every line of `cities15000.txt` to save file size. Instead, it writes `IN.16`.

The lookup file `admin1CodesASCII.txt` maps:
```text
IN.16    Maharashtra    Maharashtra    1269750
IN.07    Delhi          Delhi          1273293
IN.24    Rajasthan      Rajasthan      1258899
IN.25    Tamil Nadu     Tamil Nadu     1254359
```
* **Key:** `parts[0]` $\rightarrow$ `"IN.16"` (we split by `.` to get `"16"`).
* **Value:** `parts[1]` $\rightarrow$ `"Maharashtra"`.

This allows $O(1)$ dictionary lookups in Python: `states_map.get("16") -> "Maharashtra"`.

---

## 5. Supercharging the Guess System with `alternatenames` (Column 3)

In your `future_ideas.txt`, you noted:
> *"take the different names available in the GeoNames dump for cities to enhance the guess system (e.g. a city may have multiple names, spellings)."*

This is **Column 3 (`parts[3]`)**!

If we look at `parts[3]` for major Indian cities:
* **Mumbai:** includes `"Bombay"`, `"Mombai"`, `"मुम्बई"`, `"मुंबई"`, `"BOM"`
* **Bengaluru:** includes `"Bangalore"`, `"Bengalooru"`, `"बेंगलुरु"`, `"BLR"`
* **Kolkata:** includes `"Calcutta"`, `"कोलकाता"`, `"CCU"`
* **Chennai:** includes `"Madras"`, `"चेन्नई"`, `"MAA"`
* **Varanasi:** includes `"Benares"`, `"Banaras"`, `"Kashi"`
* **Prayagraj:** includes `"Allahabad"`, `"Ilahabad"`
* **Pune:** includes `"Poona"`
* **Kochi:** includes `"Cochin"`
* **Panaji:** includes `"Panjim"`

When players type their guesses in the frontend search bar, we can check both `name` and their `alternates`. If someone types *"Bangalore"*, the game matches it to **Bengaluru** seamlessly!
