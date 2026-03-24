# PCF SYNTAX MASTER — Builder Reference v1.2

**Purpose:** Definitive syntax rules, formulas, fallbacks, Smart Parser logic, and Config database for converting between the Data Table (Excel) and PCF text format.

**Change Log v1.2:** Pipeline-ref fallback = filename. Case-insensitive keyword mapping. PIPE gets PIPELINE-REFERENCE. SUPPORT configurable mapping + MESSAGE-SQUARE. BRLEN fallback database (ASME B16.9 TEE + Weldolet). Branch bore fallback. Column alias system with fuzzy header parsing. Bi-directional EP/LEN/DELTA calc. Unit conversion (in→mm).

---

## 0. FILE FORMAT RULE

**All PCF output files MUST use Windows line endings (CRLF = `\r\n`).**

```python
with open("output.pcf", "w", newline="\r\n") as f:
    f.write(pcf_content)
```

---

## 1. PCF FILE STRUCTURE

```
ISOGEN-FILES ISOGEN.FLS
UNITS-BORE MM
UNITS-CO-ORDS MM
UNITS-WEIGHT KGS
UNITS-BOLT-DIA MM
UNITS-BOLT-LENGTH MM
PIPELINE-REFERENCE <pipeline_ref>
    PROJECT-IDENTIFIER P1
    AREA A1

<COMPONENT BLOCK 1>
<COMPONENT BLOCK 2>
...
```

### 1.1 Header Section (Rows 1–7 in Data Table)

| # | Type | TEXT | Notes |
|---|------|------|-------|
| 1 | ISOGEN-FILES | ISOGEN.FLS | Fixed |
| 2 | UNITS-BORE | MM | Fixed |
| 3 | UNITS-CO-ORDS | MM | Fixed |
| 4 | UNITS-WEIGHT | KGS | Fixed |
| 5 | UNITS-BOLT-DIA | MM | Fixed |
| 6 | UNITS-BOLT-LENGTH | MM | Fixed |
| 7 | PIPELINE-REFERENCE | *(see §2)* | Derived |

### 1.2 Component Block Pattern

```
MESSAGE-SQUARE
    <one-liner comment text>
<COMPONENT_KEYWORD>
    <geometry lines>
    <SKEY line>           ← angle-bracket syntax
    <CA lines>            ← optional
```

**Rule:** Every component row in the Data Table produces exactly **one MESSAGE-SQUARE block + one COMPONENT block** — including SUPPORT (see §12).

---

## 2. PIPELINE-REFERENCE LOGIC

The `PIPELINE-REFERENCE` value is determined by priority:

1. **If Line Number is available** in the Data Table (column `PIPELINE-REFERENCE`): Use it directly with `export` prefix → `export <LineNo>`
2. **Fallback:** Use the source **filename without extension** → `export <filename_without_ext>`

```
PIPELINE-REFERENCE export 12-HC-1234-1A1-N
    PROJECT-IDENTIFIER P1
    AREA A1
```

**Note:** `PIPELINE-REFERENCE` also appears as a sub-line within PIPE component blocks — see §5.3.

---

## 3. MESSAGE-SQUARE — UNIVERSAL COMMENT SYNTAX

Each component (including SUPPORT) is preceded by a `MESSAGE-SQUARE` block.

### 3.1 Generic Syntax (Non-SUPPORT Components)

```
MESSAGE-SQUARE
    <Type>, <Material>, LENGTH=<Len>MM, <Direction>, RefNo:=<RefNo>, SeqNo:<SeqNo>[, BrLen=<BrLen>MM][, Bore=<Bore>]
```

| Token | Source Column | Include When |
|-------|-------------|--------------|
| `Type` | Type (col 2) | Always |
| `Material` | CA 3 (col 16) | If non-blank |
| `LENGTH=<val>MM` | LEN 1/2/3 (first non-zero) | If any LEN is non-zero |
| `Direction` | AXIS 1/2/3 (matching LEN) | If LEN is non-zero |
| `RefNo:=<val>` | CA 97, fallback REF NO. | Always |
| `SeqNo:<val>` | CA 98, fallback CSV SEQ NO | Always |
| `BrLen=<val>MM` | BRLEN (col 33) | Only for TEE/OLET |
| `Bore=<val>` | BORE (col 6) | Only for REDUCER (both bores) |

**Omission rule:** If a heading's data is blank/zero/NaN, skip that token entirely.

### 3.2 SUPPORT MESSAGE-SQUARE Syntax

```
MESSAGE-SQUARE
    SUPPORT, RefNo:=<RefNo>, SeqNo:<SeqNo>, <SUPPORT_NAME>, <SUPPORT_GUID>
```

For SUPPORT: `Material`, `LENGTH`, and `Direction` tokens are **not applicable** — omit them. Include only Type, RefNo, SeqNo, SUPPORT_NAME, and SUPPORT_GUID.

### 3.3 Direction Mapping (Axis Values)

| Delta Sign | Axis | Direction Label |
|-----------|------|----------------|
| ΔX > 0 | X | EAST |
| ΔX < 0 | X | WEST |
| ΔY > 0 | Y | NORTH |
| ΔY < 0 | Y | SOUTH |
| ΔZ > 0 | Z | UP |
| ΔZ < 0 | Z | DOWN |

---

## 4. COMPONENT KEYWORD MAPPING

**All lookups are CASE-INSENSITIVE.** Normalize input to uppercase before matching.

| PCF Keyword | Data Table Type Code | CSV Type Codes |
|-------------|---------------------|----------------|
| PIPE | PIPE | BRAN, PIPE |
| BEND | BEND | ELBO, BEND |
| TEE | TEE | TEE |
| FLANGE | FLANGE | FLAN |
| VALVE | VALVE | VALV |
| OLET | OLET | OLET |
| REDUCER-CONCENTRIC | REDUCER-CONCENTRIC | REDC, REDU |
| REDUCER-ECCENTRIC | REDUCER-ECCENTRIC | REDE |
| SUPPORT | SUPPORT | ANCI, SUPPORT |

```python
def map_to_pcf_keyword(type_code):
    key = type_code.strip().upper()
    mapping = {
        "PIPE": "PIPE", "BRAN": "PIPE",
        "BEND": "BEND", "ELBO": "BEND",
        "TEE": "TEE",
        "FLANGE": "FLANGE", "FLAN": "FLANGE",
        "VALVE": "VALVE", "VALV": "VALVE",
        "OLET": "OLET",
        "REDC": "REDUCER-CONCENTRIC", "REDU": "REDUCER-CONCENTRIC",
        "REDE": "REDUCER-ECCENTRIC",
        "ANCI": "SUPPORT", "SUPPORT": "SUPPORT",
    }
    return mapping.get(key, None)  # None = unknown type, flag warning
```

---

## 5. GEOMETRY LINES — PER COMPONENT

### 5.1 Coordinate Token Format — DECIMAL CONSISTENCY RULE

Every coordinate line outputs **4 space-separated tokens**: `X  Y  Z  Bore`

**CRITICAL: Bore MUST use the same decimal precision as X, Y, Z.** Either ALL `.1` or ALL `.4`.

| Precision Mode | Example |
|---------------|---------|
| 4-decimal | `96400.0000 17986.4000 101968.0000 400.0000` |
| 1-decimal | `96400.0 17986.4 101968.0 400.0` |

Global config — once chosen, applies everywhere.

### 5.2 Zero-Coordinate Prohibition

**NO spatial coordinate (X, Y, Z) in any EP, CP, BP, or CO-ORDS may be (0, 0, 0).**

Individual axes CAN be zero (e.g., `(0, 5000, 3000)` is valid). Only all-three-zero is prohibited.

### 5.3 Component Geometry Templates

#### PIPE / BRANCH PIPE

```
PIPE
    END-POINT    96400.0000 17840.4000 101968.0000 400.0000
    END-POINT    96400.0000 17186.4000 101968.0000 400.0000
    PIPELINE-REFERENCE export 12-HC-1234-1A1-N
```

- Two END-POINT lines.
- **`PIPELINE-REFERENCE`** is applicable to PIPE only — populate **only if available** in the Data Table or imported data. If not available, omit the line entirely.
- No `<SKEY>` (unless overridden).
- No CA8 (weight) for pipes.

#### FLANGE

```
FLANGE
    END-POINT    96400.0000 17986.4000 101968.0000 400.0000
    END-POINT    96400.0000 17840.4000 101968.0000 400.0000
    <SKEY>  FLWN
```

#### VALVE

```
VALVE
    END-POINT    96400.0000 16586.4000 102619.0000 350.0000
    END-POINT    96400.0000 16586.4000 103384.0000 350.0000
    <SKEY>  VBFL
```

#### BEND / ELBOW

```
BEND
    END-POINT    96400.0000 16586.4000 103827.0000 350.0000
    END-POINT    95867.0000 16586.4000 104360.0000 350.0000
    CENTRE-POINT 96400.0000 16586.4000 104360.0000 350.0000
    <SKEY>  BEBW
```

- **CP must NOT equal EP1 or EP2.**
- CP bore must match EP bore.

#### TEE

```
TEE
    END-POINT     96400.0000 16891.4000 101968.0000 400.0000
    END-POINT     96400.0000 16281.4000 101968.0000 400.0000
    CENTRE-POINT  96400.0000 16586.4000 101968.0000 400.0000
    BRANCH1-POINT 96400.0000 16586.4000 102273.0000 350.0000
    <SKEY>  TEBW
```

- **CP = midpoint(EP1, EP2).** CP bore = EP bore.

#### OLET

```
OLET
    CENTRE-POINT  50000.0000 12500.0000 8000.0000 400.0000
    BRANCH1-POINT 50000.0000 12500.0000 8180.0000 100.0000
    <SKEY>  OLWL
```

- **NO END-POINT lines.**

#### REDUCER-CONCENTRIC

```
REDUCER-CONCENTRIC
    END-POINT    96400.0000 17000.0000 101968.0000 400.0000
    END-POINT    96400.0000 16800.0000 101968.0000 350.0000
    <SKEY>  RCBW
```

#### REDUCER-ECCENTRIC

```
REDUCER-ECCENTRIC
    END-POINT    96400.0000 17000.0000 101968.0000 400.0000
    END-POINT    96400.0000 16800.0000 101968.0000 350.0000
    <SKEY>  REBW
    FLAT-DIRECTION  DOWN
```

#### SUPPORT

```
SUPPORT
    CO-ORDS    96400.0000 17186.4000 101968.0000 0.0000
    <SUPPORT_NAME>    CA150
    <SUPPORT_GUID>    UCI:PS00178.1
```

- Bore = `0` (formatted to match decimal precision).
- **NO CA lines.**
- `<SUPPORT_GUID>` prefix `UCI:` is **standard and mandatory**.
- See §12 for full SUPPORT config rules.

### 5.4 BEND Special Attributes

| Attribute | Rule |
|-----------|------|
| ANGLE | If `angleFormat = "hundredths"` → degrees × 100 integer. If `"degrees"` (default) → decimal. |
| BEND-RADIUS | From CSV/config Radius column if available. |

---

## 6. COMPONENT-ATTRIBUTE (CA) LINES

### 6.1 CA Definitions

| CA# | Content | Unit Pattern | Example |
|-----|---------|-------------|---------|
| CA1 | Design Pressure | `<val> KPA` | `700 KPA` |
| CA2 | Design Temperature | `<val> C` | `120 C` |
| CA3 | Material Grade | plain text | `A106-B` |
| CA4 | Wall Thickness | `<val> MM` | `9.53 MM` |
| CA5 | Corrosion Allowance | `<val> MM` | `0 MM` |
| CA6 | Insulation Density | `<val> KG/M3` | `210 KG/M3` |
| CA7 | (User-defined) | varies | — |
| CA8 | Component Weight | `<val> KG` | `100 KG` |
| CA9 | Fluid Density | `<val> KG/M3` | `1000 KG/M3` |
| CA10 | Test Pressure | `<val> KPA` | `1500 KPA` |
| CA97 | Reference Number | `=<RefNo>` | `=67130482/1666` |
| CA98 | Sequence Number | plain number | `4` |

### 6.2 CA Rules

1. **CA1–CA10 are NOT mandatory.** If blank, omit the line.
2. **CA97/CA98** fallback: CA97→REF NO., CA98→CSV SEQ NO.
3. **CA8** only for FLANGE, VALVE, fittings. Never PIPE or SUPPORT.
4. **SUPPORT has NO CA lines at all.**

---

## 7. `<SKEY>` RULES

PCF keyword is `<SKEY>` (with angle brackets).

| Component | Mandatory? | Common Values |
|-----------|-----------|---------------|
| PIPE | No | — |
| FLANGE | Yes | FLWN, FLSO, FLBL, FLLJ |
| VALVE | Yes | VBFL, VGAT, VGLB, VCHK, VBAL |
| BEND | Yes | BEBW, BESW |
| TEE | Yes | TEBW, TESW |
| OLET | Yes | OLWL, OLSO |
| REDUCER-C | Yes | RCBW |
| REDUCER-E | Yes | REBW |
| SUPPORT | No | — |

---

## 8. FORMULAS — CALCULATED COLUMNS

### 8.1 LEN and AXIS from Coordinates

```
DELTA_X = EP2.x - EP1.x    →  LEN1 = DELTA_X (if ≠ 0), AXIS1 = East/West
DELTA_Y = EP2.y - EP1.y    →  LEN2 = DELTA_Y (if ≠ 0), AXIS2 = North/South
DELTA_Z = EP2.z - EP1.z    →  LEN3 = DELTA_Z (if ≠ 0), AXIS3 = Up/Down
```

### 8.2 BI-DIRECTIONAL CALCULATION (EP ↔ LEN ↔ DELTA)

**Any one of the three sets can derive the other two:**

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│ EP1, EP2 │ ──► │ DELTA_X  │ ──► │ LEN1     │
│          │ ◄── │ DELTA_Y  │ ◄── │ AXIS1    │
│          │     │ DELTA_Z  │     │ LEN2...  │
└──────────┘     └──────────┘     └──────────┘
```

**Path A: EPs available → Calculate DELTA and LEN/AXIS**

```python
delta_x = EP2.x - EP1.x
delta_y = EP2.y - EP1.y
delta_z = EP2.z - EP1.z

LEN1 = delta_x if delta_x != 0 else None
AXIS1 = "East" if delta_x > 0 else "West" if delta_x < 0 else None
# Same for LEN2/AXIS2 (Y) and LEN3/AXIS3 (Z)
```

**Path B: DELTA available → Calculate LEN/AXIS and EPs**

```python
LEN1 = delta_x  # (signed)
AXIS1 = "East" if delta_x > 0 else "West" if delta_x < 0 else None

# EPs via chaining (first element starts at origin or given start):
EP2.x = EP1.x + delta_x
EP2.y = EP1.y + delta_y
EP2.z = EP1.z + delta_z
```

**Path C: LEN/AXIS available → Calculate DELTA and EPs**

```python
def axis_to_sign(axis):
    return {"East":+1, "West":-1, "North":+1, "South":-1, "Up":+1, "Down":-1}[axis]

delta_x = abs(LEN1) * axis_to_sign(AXIS1) if LEN1 else 0
delta_y = abs(LEN2) * axis_to_sign(AXIS2) if LEN2 else 0
delta_z = abs(LEN3) * axis_to_sign(AXIS3) if LEN3 else 0

EP2 = (EP1.x + delta_x, EP1.y + delta_y, EP1.z + delta_z)
```

**Chaining for EP generation:** First element EP1 starts at origin `(0, 0, 0)` — *but only if no absolute coordinates are provided.* Each subsequent element's EP1 = previous element's EP2 (elemental connectivity).

### 8.3 BRLEN (Branch Length for TEE/OLET)

```
BRLEN = magnitude(BP - CP)
      = sqrt((bp_x - cp_x)² + (bp_y - cp_y)² + (bp_z - cp_z)²)
```

**If BRLEN is missing, use the dimension database fallback — see §9A.**

### 8.4 DIAMETER and WALL_THICK

```
DIAMETER = BORE (column 6)
WALL_THICK = CA4 (column 17)
```

### 8.5 Pointer Columns (BEND_PTR, RIGID_PTR, INT_PTR)

| Pointer | Increments When To-Component Is |
|---------|-------------------------------|
| BEND_PTR | BEND |
| RIGID_PTR | FLANGE or VALVE |
| INT_PTR | TEE or OLET |

---

## 9. FALLBACK RULES

### 9.1 Centre-Point (CP) Fallback

**TEE:** `CP = midpoint(EP1, EP2)`. CP bore = EP bore.
**BEND:** Requires bend radius — see §10.5.4. Cannot use midpoint.

### 9.2 Branch-Point (BP) Fallback

`BP = CP + BRLEN * direction_unit_vector`

If BRLEN missing → use §9A database. If direction unknown → flag incomplete.

### 9.3 OLET CP/BP Fallback

CP = point on parent pipe axis. CP bore = parent pipe bore.
BP bore = olet branch bore from Data Table.

### 9.4 Bore Fallback for CP

`CP_bore = EP1_bore` (for both BEND and TEE).

### 9.5 REF NO. / CA97 / CA98 Fallback

```
CA97 → REF NO. → "<PipelineRef>_<RowNumber>"
CA98 → CSV SEQ NO → running row counter
REF NO. → if blank, use CSV SEQ NO
```

### 9.6 Branch Bore Fallback

**When branch bore is unavailable or undetectable:**

| Component | Fallback Rule |
|-----------|--------------|
| TEE | Branch bore = Header bore (equal tee assumed) |
| OLET | Branch bore = 50 mm (default minimum) |

---

## 9A. BRLEN FALLBACK DATABASE (Config Tab)

When BRLEN is not available in the Data Table, look up from these standard dimension tables. All values stored in Config as editable tables.

### 9A.1 Equal Tee — ASME B16.9 (BRLEN = M)

Source: ASME B16.9 Straight Tee Dimensions

`BRLEN = M` (Centre-to-End, Outlet) in mm.

| NPS (inch) | Bore (mm) | OD (mm) | C (mm) | **M (mm)** |
|-----------|----------|--------|--------|-----------|
| 1/2 | 15 | 21.3 | 25 | **25** |
| 3/4 | 20 | 26.7 | 29 | **29** |
| 1 | 25 | 33.4 | 38 | **38** |
| 1-1/4 | 32 | 42.2 | 48 | **48** |
| 1-1/2 | 40 | 48.3 | 57 | **57** |
| 2 | 50 | 60.3 | 64 | **64** |
| 2-1/2 | 65 | 73.0 | 76 | **76** |
| 3 | 80 | 88.9 | 86 | **86** |
| 3-1/2 | 90 | 101.6 | 95 | **95** |
| 4 | 100 | 114.3 | 105 | **105** |
| 5 | 125 | 141.3 | 124 | **124** |
| 6 | 150 | 168.3 | 143 | **143** |
| 8 | 200 | 219.1 | 178 | **178** |
| 10 | 250 | 273.1 | 216 | **216** |
| 12 | 300 | 323.9 | 254 | **254** |
| 14 | 350 | 355.6 | 279 | **279** |
| 16 | 400 | 406.4 | 305 | **305** |
| 18 | 450 | 457.2 | 343 | **343** |
| 20 | 500 | 508.0 | 381 | **381** |
| 24 | 600 | 610.0 | 432 | **432** |
| 30 | 750 | 762.0 | 559 | **559** |
| 36 | 900 | 914.0 | 660 | **660** |
| 42 | 1050 | 1067.0 | 762 | **762** |
| 48 | 1200 | 1219.0 | 864 | **864** |

**Lookup logic:** Match on header bore (NPS). For equal tee, `M = BRLEN`. For reducing tee, M varies — use reducing tee table below.

### 9A.2 Reducing Tee — ASME B16.9 (BRLEN = M)

For reducing tees, M depends on both header size and branch size. Representative values (mm):

| Header NPS | Branch NPS | **M (mm)** |
|-----------|-----------|-----------|
| 4 × 4 × 3 | 4 / 3 | **102** |
| 4 × 4 × 2 | 4 / 2 | **95** |
| 6 × 6 × 4 | 6 / 4 | **130** |
| 6 × 6 × 3 | 6 / 3 | **124** |
| 8 × 8 × 6 | 8 / 6 | **168** |
| 8 × 8 × 4 | 8 / 4 | **156** |
| 10 × 10 × 8 | 10 / 8 | **206** |
| 10 × 10 × 6 | 10 / 6 | **194** |
| 12 × 12 × 10 | 12 / 10 | **244** |
| 12 × 12 × 8 | 12 / 8 | **232** |
| 12 × 12 × 6 | 12 / 6 | **219** |
| 14 × 14 × 10 | 14 / 10 | **264** |
| 14 × 14 × 8 | 14 / 8 | **254** |
| 16 × 16 × 12 | 16 / 12 | **295** |
| 16 × 16 × 10 | 16 / 10 | **283** |
| 18 × 18 × 14 | 18 / 14 | **330** |
| 18 × 18 × 12 | 18 / 12 | **321** |
| 20 × 20 × 16 | 20 / 16 | **368** |
| 20 × 20 × 14 | 20 / 14 | **356** |
| 24 × 24 × 20 | 24 / 20 | **419** |
| 24 × 24 × 16 | 24 / 16 | **406** |

**Config note:** This table is editable in the Config tab. Users can add project-specific sizes.

### 9A.3 Weldolet — Schedule STD Dimensions (BRLEN Formula)

Source: MSS SP-97 / Manufacturer standards

**Formula:** `BRLEN = A + 0.5 × Header_Bore_OD`

Where `A` = height of weldolet (from pipe surface to branch end).

| Header NPS | Branch NPS | A (mm) | Header OD (mm) | **BRLEN (mm)** |
|-----------|-----------|--------|---------------|----------------|
| 2 | 3/4 | 38.1 | 60.3 | **68.3** |
| 2 | 1 | 38.1 | 60.3 | **68.3** |
| 3 | 1 | 44.4 | 88.9 | **88.9** |
| 3 | 1-1/2 | 44.4 | 88.9 | **88.9** |
| 3 | 2 | 50.8 | 88.9 | **95.3** |
| 4 | 1 | 50.8 | 114.3 | **108.0** |
| 4 | 1-1/2 | 50.8 | 114.3 | **108.0** |
| 4 | 2 | 57.2 | 114.3 | **114.4** |
| 4 | 3 | 63.5 | 114.3 | **120.7** |
| 6 | 1 | 57.2 | 168.3 | **141.4** |
| 6 | 2 | 63.5 | 168.3 | **147.7** |
| 6 | 3 | 76.2 | 168.3 | **160.4** |
| 6 | 4 | 82.6 | 168.3 | **166.8** |
| 8 | 2 | 69.8 | 219.1 | **179.4** |
| 8 | 3 | 82.6 | 219.1 | **192.2** |
| 8 | 4 | 88.9 | 219.1 | **198.5** |
| 8 | 6 | 101.6 | 219.1 | **211.2** |
| 10 | 2 | 76.2 | 273.1 | **212.8** |
| 10 | 3 | 88.9 | 273.1 | **225.5** |
| 10 | 4 | 95.2 | 273.1 | **231.8** |
| 10 | 6 | 108.0 | 273.1 | **244.6** |
| 10 | 8 | 127.0 | 273.1 | **263.6** |
| 12 | 2 | 82.6 | 323.9 | **244.6** |
| 12 | 3 | 95.2 | 323.9 | **257.2** |
| 12 | 4 | 101.6 | 323.9 | **263.6** |
| 12 | 6 | 114.3 | 323.9 | **276.3** |
| 12 | 8 | 133.4 | 323.9 | **295.4** |
| 12 | 10 | 152.4 | 323.9 | **314.4** |
| 14 | 3 | 101.6 | 355.6 | **279.4** |
| 14 | 4 | 108.0 | 355.6 | **285.8** |
| 14 | 6 | 120.6 | 355.6 | **298.4** |
| 14 | 8 | 139.7 | 355.6 | **317.5** |
| 14 | 10 | 158.8 | 355.6 | **336.6** |
| 16 | 3 | 108.0 | 406.4 | **311.2** |
| 16 | 4 | 114.3 | 406.4 | **317.5** |
| 16 | 6 | 127.0 | 406.4 | **330.2** |
| 16 | 8 | 146.0 | 406.4 | **349.2** |
| 16 | 10 | 165.1 | 406.4 | **368.3** |
| 16 | 12 | 184.2 | 406.4 | **387.4** |

**Lookup logic:**

```python
def weldolet_brlen(header_nps, branch_nps, config_table):
    """Look up A from config table, compute BRLEN."""
    row = config_table.lookup(header_nps, branch_nps)
    if row:
        return row.A + 0.5 * row.header_OD
    else:
        # Interpolation or flag as missing
        return None
```

### 9A.4 BRLEN Fallback Priority

```
1. BRLEN from Data Table (direct value)
2. BRLEN calculated from BP − CP coordinates
3. TEE: Look up M from §9A.1 (equal) or §9A.2 (reducing)
4. OLET: Calculate A + 0.5 × Header OD from §9A.3
5. If all fail → flag as incomplete data
```

---

## 10. SMART PARSER — BI-DIRECTIONAL SYNC

### 10.1 Mode A: EP1/EP2 Available → Calculate LEN/AXIS/Delta

See §8.2 Path A.

### 10.2 Mode B: Delta Available → Calculate LEN/AXIS and EPs

See §8.2 Path B.

### 10.3 Mode C: LEN/AXIS Available → Calculate DELTA and EPs

See §8.2 Path C.

### 10.4 Elemental Connectivity (Chaining Rule)

**Rule:** EP1[current] = EP2[previous connected element].

**TEE branching:**

```
TEE.BP  →  next_branch_pipe.EP1
TEE.EP2 →  next_header_pipe.EP1
```

### 10.5 CP/BP Calculation for TEE/BEND/OLET — WITH WORKED EXAMPLES

*(Retained from v1.1 — see full worked examples in §10.5.1 through §10.5.4 of v1.1)*

#### 10.5.1 TEE — CP = midpoint(EP1, EP2)

```
CP = ((EP1.x+EP2.x)/2, (EP1.y+EP2.y)/2, (EP1.z+EP2.z)/2)
CP_bore = EP1_bore
```

**Example:**

```
EP1 = (96400.0, 16891.4, 101968.0) Bore=400
EP2 = (96400.0, 16281.4, 101968.0) Bore=400
CP  = (96400.0, 16586.4, 101968.0) Bore=400 ✓
```

#### 10.5.2 TEE/OLET — BP Estimation

BP = CP + BRLEN × branch_unit_vector (perpendicular to header).

| Branch Direction | BP Calculation |
|-----------------|----------------|
| East (+X) | `BP = (CP.x + BRLEN, CP.y, CP.z)` |
| West (−X) | `BP = (CP.x − BRLEN, CP.y, CP.z)` |
| North (+Y) | `BP = (CP.x, CP.y + BRLEN, CP.z)` |
| South (−Y) | `BP = (CP.x, CP.y − BRLEN, CP.z)` |
| Up (+Z) | `BP = (CP.x, CP.y, CP.z + BRLEN)` |
| Down (−Z) | `BP = (CP.x, CP.y, CP.z − BRLEN)` |

**Example — branch Up, BRLEN=305:**

```
CP = (96400.0, 16586.4, 101968.0)
BP = (96400.0, 16586.4, 102273.0)  Bore=350 ✓
```

#### 10.5.3 OLET — CP from parent pipe, BP via BRLEN

```
CP = tap point on parent pipe axis, Bore = parent bore
BP = CP + BRLEN × branch_direction, Bore = branch bore (default 50 if unknown)
```

#### 10.5.4 BEND — CP at corner intersection

For 90° bends: CP shares one coord with EP1 and another with EP2.

```
EP1=(96400.0, 16586.4, 103827.0), EP2=(95867.0, 16586.4, 104360.0)
Incoming: +Z, Outgoing: −X
CP.x = EP1.x = 96400.0
CP.z = EP2.z = 104360.0
CP.y = EP1.y = 16586.4
CP = (96400.0, 16586.4, 104360.0)  R=533 ✓
```

**Validation:** dist(CP,EP1) = dist(CP,EP2) = bend_radius.

---

## 11. REDUCER DETECTION LOGIC

```python
def detect_reducer(bore1, bore2, csv_type):
    if bore1 == bore2: return "DATA_ERROR"
    key = csv_type.strip().upper()
    if key in ("REDE",): return "REDUCER-ECCENTRIC"
    return "REDUCER-CONCENTRIC"
```

---

## 12. SUPPORT BLOCK RULES

### 12.1 SUPPORT PCF Output

SUPPORT **does** get a MESSAGE-SQUARE block (unlike v1.0/v1.1):

```
MESSAGE-SQUARE
    SUPPORT, RefNo:=67130482/SP001, SeqNo:13, CA150, UCI:PS00178.1
SUPPORT
    CO-ORDS    96400.0000 17186.4000 101968.0000 0.0000
    <SUPPORT_NAME>    CA150
    <SUPPORT_GUID>    UCI:PS00178.1
```

### 12.2 MESSAGE-SQUARE for SUPPORT

Uses the universal syntax minus the inapplicable tokens:

```
MESSAGE-SQUARE
    SUPPORT, RefNo:=<RefNo>, SeqNo:<SeqNo>, <SUPPORT_NAME_Value>, <SUPPORT_GUID_Value>
```

**NOT included:** Material, LENGTH, Direction (not applicable to a point restraint).

### 12.3 SUPPORT Mapping Logic (Config Tab)

The Config tab controls how `<SUPPORT_NAME>` and `<SUPPORT_GUID>` are derived from the Data Table's Friction and Gap properties.

**Config Structure:**

```
┌─────────────────────────────────────────────────────────┐
│  SUPPORT MAPPING CONFIGURATION                          │
├─────────────────────────────────────────────────────────┤
│  GUID Source Column:   [SUPPORT GUID]  ← editable       │
│  GUID Prefix:          UCI:            ← mandatory       │
│  Fallback Name:        RST             ← editable        │
├─────────────────────────────────────────────────────────┤
│  MAPPING BLOCKS:                                         │
│                                                          │
│  Block 1: Friction = Empty or 0.3  AND  Gap = Empty      │
│    → <SUPPORT_NAME> = "ANC"  (Anchor)                    │
│    → <SUPPORT_GUID> = UCI:<NodeName>                     │
│                                                          │
│  Block 2: Friction = 0.15                                │
│    → <SUPPORT_NAME> = "GDE"  (Guide)                     │
│    → <SUPPORT_GUID> = UCI:<NodeName>                     │
│                                                          │
│  Block 3: Friction = 0.3  AND  Gap > 0                   │
│    → <SUPPORT_NAME> = "RST"  (Restraint with Gap)        │
│    → <SUPPORT_GUID> = UCI:<NodeName>                     │
│                                                          │
│  Fallback (no match):                                    │
│    → <SUPPORT_NAME> = config.fallback_name ("RST")       │
│    → <SUPPORT_GUID> = UCI:<NodeName>                     │
└─────────────────────────────────────────────────────────┘
```

**Mapping Pseudocode:**

```python
def resolve_support(friction, gap, node_name, config):
    guid = f"UCI:{node_name}"  # Prefix always "UCI:"
    
    if (friction is None or friction == "" or friction == 0.3) and (gap is None or gap == ""):
        name = "ANC"
    elif friction == 0.15:
        name = "GDE"
    elif friction == 0.3 and gap is not None and float(gap) > 0:
        name = "RST"
    else:
        name = config.support_fallback_name  # default "RST"
    
    return name, guid
```

**All mapping blocks, fallback name, and GUID prefix are editable in Config.**

### 12.4 SUPPORT Key Differences Summary

| Feature | Other Components | SUPPORT |
|---------|-----------------|---------|
| Geometry | Element (2+ points) | **Single point (CO-ORDS)** |
| Bore | Actual | **Always 0** |
| CA lines | Optional | **NONE** |
| MESSAGE-SQUARE | Yes (with Material/Length) | **Yes (without Material/Length)** |
| `<SUPPORT_GUID>` prefix | N/A | **UCI: (mandatory)** |

---

## 13. DATA TABLE COLUMN REFERENCE — WITH ALIASES AND SMART RULES

### 13.1 Column Alias System (Config Tab)

Each column has a canonical name and a list of **aliases** for fuzzy header matching. All aliases are **editable in Config**.

| Col | Canonical Name | Default Aliases (Config — Editable) | Smart Rule |
|-----|---------------|-------------------------------------|------------|
| 0 | # | `#, Row, Row No, RowNo, Row Number, SN, S.N., S.No, S No` | Optional |
| 1 | CSV SEQ NO | `CSV SEQ NO, SEQ NO, Seq No, SL.NO, Sl No, SL NO, SeqNo, Seq, Sequence, Sequence No, Item No` | If blank → use running row number |
| 2 | Type | `Type, Component, Comp Type, CompType, Component Type, Fitting, Item` | **Mandatory** |
| 3 | TEXT | `TEXT, Text, Description, Desc, Comment, MSG` | If blank → auto-create from MESSAGE-SQUARE formula (§3) |
| 4 | PIPELINE-REFERENCE | `PIPELINE-REFERENCE, Pipeline Ref, Line No, Line Number, Line No., LineNo, PIPE, Pipe Line` | Header rows + PIPE component only. Use if matched. |
| 5 | REF NO. | `REF NO., Ref No, RefNo, Reference No, Reference Number, Ref, Tag No, TagNo` | If blank → use CSV SEQ NO |
| 6 | BORE | `BORE, Bore, NPS, Nominal Bore, Dia, Diameter, Size, Pipe Size, DN` | **Mandatory.** Ensure mm unit — if `≤ 48` and appears to be inches, convert: `bore_mm = bore_in × 25.4` |
| 7 | EP1 COORDS | `EP1 COORDS, EP1, Start Point, From, From Coord, Start Coord, EP1_X EP1_Y EP1_Z` | If blank but LEN/DELTA available → calculate (§8.2). First element at `(0,0,0)` for delta-only input. |
| 8 | EP2 COORDS | `EP2 COORDS, EP2, End Point, To, To Coord, End Coord, EP2_X EP2_Y EP2_Z` | Same derivation logic as EP1 |
| 9 | CP COORDS | `CP COORDS, CP, Centre Point, Center Point, Centre, Center, CenterPt` | Mandatory for TEE/BEND |
| 10 | BP COORDS | `BP COORDS, BP, Branch Point, Branch, Branch1, BranchPt` | Mandatory for TEE/OLET |
| 11 | SKEY | `SKEY, Skey, S-Key, Component Key, Fitting Key` | Mandatory for FLANGE/VALVE/BEND/TEE/OLET/REDUCER |
| 12 | SUPPORT COOR | `SUPPORT COOR, Support Coord, Support Point, Restraint Coord, RestPt` | Mandatory for SUPPORT |
| 13 | SUPPORT GUID | `SUPPORT GUID, Support GUID, GUID, Node Name, NodeName, UCI` | Optional |
| 14–23 | CA 1–10 | `CA1, CA 1, Attr1, Attribute 1, Attribute1, ...` (pattern for each) | Optional |
| 24 | CA 97 | `CA97, CA 97, Ref No Attr, RefAttr` | Fallback: = REF NO. |
| 25 | CA 98 | `CA98, CA 98, Seq No Attr, SeqAttr` | Fallback: = CSV SEQ NO |
| 26 | Fixing Action | `Fixing Action, Fix, Action, FixAction, Overlap, Gap Fill` | Optional |
| 27 | LEN 1 | `LEN 1, Len1, Length X, LenX, Dx, DX, Delta X, DeltaX` | Calculated. Bi-directional with EP/DELTA. |
| 28 | AXIS 1 | `AXIS 1, Axis1, Dir X, DirX, Direction X` | Calculated |
| 29–32 | LEN 2, AXIS 2, LEN 3, AXIS 3 | *(same pattern as LEN1/AXIS1 for Y and Z)* | Calculated |
| 33 | BRLEN | `BRLEN, BrLen, Branch Length, Branch Len, Br Len` | Calculated or from §9A database |
| 34–36 | DELTA_X/Y/Z | `DELTA_X, DeltaX, Delta X, Dx, dX, ...` | Bi-directional with EP/LEN |
| 37 | DIAMETER | `DIAMETER, Dia, OD, Outer Diameter` | = BORE |
| 38 | WALL_THICK | `WALL_THICK, Wall Thick, WT, Wall Thickness, Thk` | = CA4 |
| 39–41 | BEND_PTR, RIGID_PTR, INT_PTR | *(as named)* | Calculated counters |

### 13.2 Fuzzy Header Matching Logic

When importing an Excel file, the parser must match column headers to canonical names using fuzzy matching:

```python
import re
from difflib import SequenceMatcher

def normalize(text):
    """Lowercase, strip whitespace, remove special chars."""
    return re.sub(r'[^a-z0-9]', '', str(text).lower().strip())

def fuzzy_match_header(header_text, alias_config, threshold=0.75):
    """
    Match a header cell to a canonical column name.
    alias_config: dict of {canonical_name: [alias1, alias2, ...]}
    Returns: canonical_name or None
    """
    norm_header = normalize(header_text)
    
    # Pass 1: Exact match on normalized aliases
    for canonical, aliases in alias_config.items():
        for alias in aliases:
            if normalize(alias) == norm_header:
                return canonical
    
    # Pass 2: Substring containment
    for canonical, aliases in alias_config.items():
        for alias in aliases:
            norm_alias = normalize(alias)
            if norm_alias in norm_header or norm_header in norm_alias:
                return canonical
    
    # Pass 3: Fuzzy ratio (SequenceMatcher)
    best_match = None
    best_score = 0
    for canonical, aliases in alias_config.items():
        for alias in aliases:
            score = SequenceMatcher(None, norm_header, normalize(alias)).ratio()
            if score > best_score and score >= threshold:
                best_score = score
                best_match = canonical
    
    return best_match  # None if no match above threshold
```

**Config display:** The alias list is shown in the Config tab as an editable table. Users can add project-specific short forms, alternative spellings, or different languages.

### 13.3 Bore Unit Detection and Conversion

```python
def ensure_bore_mm(bore_value, unit_hint=None):
    """
    If bore appears to be in inches (≤ 48 and not a standard mm value),
    convert to mm. Standard mm bores: 15, 20, 25, 32, 40, 50, 65, 80, 90,
    100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600, 750, 900, 1050, 1200
    """
    standard_mm = {15,20,25,32,40,50,65,80,90,100,125,150,200,250,300,
                   350,400,450,500,600,750,900,1050,1200}
    
    val = float(bore_value)
    
    if unit_hint == "in" or unit_hint == "inch":
        return val * 25.4
    
    if val <= 48 and val not in standard_mm:
        # Likely inches → convert
        return val * 25.4
    
    return val  # Already mm
```

### 13.4 EP/DELTA/LEN Bi-Directional Auto-Calculation

On import, the Smart Parser checks which data is available and fills the rest:

```python
def auto_calculate_coordinates(row, prev_ep2=None):
    """
    Given a row, determine what's available and compute the rest.
    Priority: EP1/EP2 > DELTA_X/Y/Z > LEN1+AXIS1 / LEN2+AXIS2 / LEN3+AXIS3
    """
    has_eps = row.EP1 is not None and row.EP2 is not None
    has_deltas = row.DELTA_X is not None  # at least one delta
    has_lens = row.LEN1 is not None or row.LEN2 is not None or row.LEN3 is not None
    
    if has_eps:
        # Path A: Calculate deltas and lens from EPs
        row.DELTA_X = row.EP2.x - row.EP1.x
        row.DELTA_Y = row.EP2.y - row.EP1.y
        row.DELTA_Z = row.EP2.z - row.EP1.z
        row.LEN1, row.AXIS1 = delta_to_len_axis(row.DELTA_X, "X")
        row.LEN2, row.AXIS2 = delta_to_len_axis(row.DELTA_Y, "Y")
        row.LEN3, row.AXIS3 = delta_to_len_axis(row.DELTA_Z, "Z")
    
    elif has_deltas:
        # Path B: Calculate EPs and lens from deltas
        row.EP1 = prev_ep2 if prev_ep2 else (0, 0, 0)
        row.EP2 = (row.EP1.x + (row.DELTA_X or 0),
                   row.EP1.y + (row.DELTA_Y or 0),
                   row.EP1.z + (row.DELTA_Z or 0))
        row.LEN1, row.AXIS1 = delta_to_len_axis(row.DELTA_X, "X")
        row.LEN2, row.AXIS2 = delta_to_len_axis(row.DELTA_Y, "Y")
        row.LEN3, row.AXIS3 = delta_to_len_axis(row.DELTA_Z, "Z")
    
    elif has_lens:
        # Path C: Calculate deltas and EPs from LEN/AXIS
        row.DELTA_X = len_axis_to_delta(row.LEN1, row.AXIS1)
        row.DELTA_Y = len_axis_to_delta(row.LEN2, row.AXIS2)
        row.DELTA_Z = len_axis_to_delta(row.LEN3, row.AXIS3)
        row.EP1 = prev_ep2 if prev_ep2 else (0, 0, 0)
        row.EP2 = (row.EP1.x + row.DELTA_X,
                   row.EP1.y + row.DELTA_Y,
                   row.EP1.z + row.DELTA_Z)

def delta_to_len_axis(delta, axis_label):
    if delta is None or delta == 0:
        return None, None
    axis_map = {"X": ("East","West"), "Y": ("North","South"), "Z": ("Up","Down")}
    pos, neg = axis_map[axis_label]
    return delta, pos if delta > 0 else neg

def len_axis_to_delta(length, axis):
    if length is None or axis is None:
        return 0
    sign = {"East":+1,"West":-1,"North":+1,"South":-1,"Up":+1,"Down":-1}
    return abs(length) * sign.get(axis, 0)
```

---

## 14. PCF GENERATION PSEUDOCODE

```python
def generate_pcf(data_table, config):
    lines = []
    dec = config.decimals  # 1 or 4
    
    # === HEADER ===
    lines.append("ISOGEN-FILES ISOGEN.FLS")
    lines.append("UNITS-BORE MM")
    lines.append("UNITS-CO-ORDS MM")
    lines.append("UNITS-WEIGHT KGS")
    lines.append("UNITS-BOLT-DIA MM")
    lines.append("UNITS-BOLT-LENGTH MM")
    lines.append(f"PIPELINE-REFERENCE {resolve_pipeline_ref(config)}")
    lines.append("    PROJECT-IDENTIFIER P1")
    lines.append("    AREA A1")
    lines.append("")
    
    for row in data_table.component_rows():
        comp_type = row.Type.strip().upper()
        
        # MESSAGE-SQUARE for ALL components (including SUPPORT)
        msg = build_message_square(row, comp_type)
        lines.append("MESSAGE-SQUARE  ")
        lines.append(f"    {msg}")
        
        if comp_type == "SUPPORT":
            name, guid = resolve_support(row.friction, row.gap, row.node_name, config)
            lines.append("SUPPORT")
            lines.append(f"    CO-ORDS    {fmt_coord(row.coor, 0, dec)}")
            lines.append(f"    <SUPPORT_NAME>    {name}")
            lines.append(f"    <SUPPORT_GUID>    {guid}")
            lines.append("")
            continue
        
        pcf_kw = map_to_pcf_keyword(comp_type)
        lines.append(pcf_kw)
        
        # GEOMETRY
        if comp_type == "OLET":
            lines.append(f"    CENTRE-POINT  {fmt_coord(row.CP, row.main_bore, dec)}")
            lines.append(f"    BRANCH1-POINT {fmt_coord(row.BP, row.branch_bore, dec)}")
        else:
            lines.append(f"    END-POINT    {fmt_coord(row.EP1, row.bore, dec)}")
            lines.append(f"    END-POINT    {fmt_coord(row.EP2, row.bore, dec)}")
            if comp_type in ("BEND", "TEE"):
                cp = row.CP if row.CP else calc_cp(row, comp_type)
                lines.append(f"    CENTRE-POINT  {fmt_coord(cp, row.bore, dec)}")
            if comp_type == "TEE":
                lines.append(f"    BRANCH1-POINT {fmt_coord(row.BP, row.branch_bore, dec)}")
        
        # PIPELINE-REFERENCE for PIPE only
        if comp_type == "PIPE" and row.pipeline_ref:
            lines.append(f"    PIPELINE-REFERENCE {row.pipeline_ref}")
        
        if row.skey:
            lines.append(f"    <SKEY>  {row.skey}")
        
        if comp_type == "BEND" and row.angle:
            lines.append(f"    ANGLE  {format_angle(row.angle, config.angleFormat)}")
        if comp_type == "BEND" and row.bend_radius:
            lines.append(f"    BEND-RADIUS  {row.bend_radius}")
        if comp_type == "REDUCER-ECCENTRIC" and row.flat_direction:
            lines.append(f"    FLAT-DIRECTION  {row.flat_direction}")
        
        for ca_num in [1,2,3,4,5,6,7,8,9,10,97,98]:
            val = row.get_ca(ca_num)
            if val is not None and val != "":
                lines.append(f"    COMPONENT-ATTRIBUTE{ca_num}    {val}")
        
        lines.append("")
    
    return "\r\n".join(lines)
```

---

## 15. COORDINATE FORMAT — SUMMARY

**Decimal consistency mandatory.** All X, Y, Z AND Bore use same precision.

| 4-decimal | `96400.0000 17986.4000 101968.0000 400.0000` |
|-----------|----------------------------------------------|
| 1-decimal | `96400.0 17986.4 101968.0 400.0` |

---

## 16. INDENT AND SPACING RULES

| Line Type | Indent |
|-----------|--------|
| Top-level keyword (PIPE, FLANGE, etc.) | 0 |
| Geometry lines (END-POINT, CENTRE-POINT, CO-ORDS) | 4 spaces |
| `<SKEY>`, ANGLE, BEND-RADIUS, FLAT-DIRECTION | 4 spaces |
| COMPONENT-ATTRIBUTE lines | 4 spaces |
| PIPELINE-REFERENCE (in PIPE block) | 4 spaces |
| PROJECT-IDENTIFIER, AREA | 4 spaces |
| MESSAGE-SQUARE text content | 4 spaces |
| SUPPORT sub-lines | 4 spaces |

**Line endings:** Windows CRLF (`\r\n`) always.

---

## 17. BEND ANGLE CALCULATION

```python
v1 = EP1 - CP
v2 = EP2 - CP
cos_angle = dot(v1, v2) / (mag(v1) * mag(v2))
angle_deg = acos(cos_angle) * 180 / pi

if config.angleFormat == "hundredths":
    output = int(angle_deg * 100)
else:  # "degrees" (default/CAESAR II)
    output = f"{angle_deg:.4f}"
```

---

## 18. VALIDATION CHECKLIST

| # | Check | Rule | Severity |
|---|-------|------|----------|
| V1 | **No (0,0,0) coords** | EP1, EP2, CP, BP, CO-ORDS — all three spatial values cannot be zero | ERROR |
| V2 | **Decimal consistency** | Every token (X, Y, Z, Bore) same precision | ERROR |
| V3 | **Bore consistency** | REDUCER: EP1_bore ≠ EP2_bore. Others: EP1_bore == EP2_bore | ERROR |
| V4 | **BEND: CP ≠ EP1** | Degenerate bend check | ERROR |
| V5 | **BEND: CP ≠ EP2** | Degenerate bend check | ERROR |
| V6 | **BEND: CP not collinear** | CP not on EP1–EP2 line | ERROR |
| V7 | **BEND: CP equidistant** | dist(CP,EP1) ≈ dist(CP,EP2) = R | WARNING |
| V8 | **TEE: CP = midpoint** | CP = (EP1+EP2)/2 | ERROR |
| V9 | **TEE: CP bore = EP bore** | Must match | ERROR |
| V10 | **TEE: BP perpendicular** | (BP−CP) ⊥ (EP2−EP1) | WARNING |
| V11 | **OLET: no EPs** | Must have CP+BP only | ERROR |
| V12 | **SUPPORT: no CAs** | CO-ORDS only, no COMPONENT-ATTRIBUTE | ERROR |
| V13 | **SUPPORT: bore = 0** | Formatted to decimal precision | ERROR |
| V14 | **`<SKEY>` presence** | Mandatory for FLANGE/VALVE/BEND/TEE/OLET/REDUCER | WARNING |
| V15 | **Coordinate continuity** | EP1[n] ≈ EP2[n-1] | WARNING |
| V16 | **CA8 scope** | Only FLANGE/VALVE. Never PIPE/SUPPORT | WARNING |
| V17 | **CRLF** | File uses `\r\n` throughout | ERROR |
| V18 | **Bore unit** | All bores in mm. Flag if ≤ 48 and not standard mm | WARNING |
| V19 | **SUPPORT MESSAGE-SQUARE** | Must be present, must not contain Material/Length/Direction | WARNING |
| V20 | **GUID prefix** | `<SUPPORT_GUID>` must start with `UCI:` | ERROR |

---

## 19. QUICK REFERENCE — BLOCK TEMPLATES

### PIPE (with optional PIPELINE-REFERENCE)
```
MESSAGE-SQUARE
    PIPE, A106-B, LENGTH=654MM, SOUTH, RefNo:=67130482/1666_pipe, SeqNo:5
PIPE
    END-POINT    96400.0000 17840.4000 101968.0000 400.0000
    END-POINT    96400.0000 17186.4000 101968.0000 400.0000
    PIPELINE-REFERENCE export 12-HC-1234-1A1-N
    COMPONENT-ATTRIBUTE1    700 KPA
    ...
    COMPONENT-ATTRIBUTE98    5
```

### FLANGE
```
MESSAGE-SQUARE
    FLANGE, A106-B, LENGTH=146MM, SOUTH, RefNo:=67130482/1666, SeqNo:4
FLANGE
    END-POINT    96400.0000 17986.4000 101968.0000 400.0000
    END-POINT    96400.0000 17840.4000 101968.0000 400.0000
    <SKEY>  FLWN
    COMPONENT-ATTRIBUTE1    700 KPA
    ...
    COMPONENT-ATTRIBUTE8    100 KG
    ...
    COMPONENT-ATTRIBUTE98    4
```

### BEND
```
MESSAGE-SQUARE
    BEND, A106-B, LENGTH=754MM, UP, RefNo:=67130482/1164, SeqNo:33
BEND
    END-POINT    96400.0000 16586.4000 103827.0000 350.0000
    END-POINT    95867.0000 16586.4000 104360.0000 350.0000
    CENTRE-POINT 96400.0000 16586.4000 104360.0000 350.0000
    <SKEY>  BEBW
    COMPONENT-ATTRIBUTE1    700 KPA
    ...
```

### TEE
```
MESSAGE-SQUARE
    TEE, A106-B, LENGTH=610MM, SOUTH, RefNo:=67130482/1667, SeqNo:7, BrLen=305MM
TEE
    END-POINT     96400.0000 16891.4000 101968.0000 400.0000
    END-POINT     96400.0000 16281.4000 101968.0000 400.0000
    CENTRE-POINT  96400.0000 16586.4000 101968.0000 400.0000
    BRANCH1-POINT 96400.0000 16586.4000 102273.0000 350.0000
    <SKEY>  TEBW
    COMPONENT-ATTRIBUTE1    700 KPA
    ...
```

### OLET
```
MESSAGE-SQUARE
    OLET, A106-B, BrLen=180MM, UP, RefNo:=XXX, SeqNo:10
OLET
    CENTRE-POINT  50000.0000 12500.0000 8000.0000 400.0000
    BRANCH1-POINT 50000.0000 12500.0000 8180.0000 100.0000
    <SKEY>  OLWL
    COMPONENT-ATTRIBUTE1    700 KPA
    ...
```

### REDUCER-CONCENTRIC
```
MESSAGE-SQUARE
    REDUCER-CONCENTRIC, A106-B, LENGTH=200MM, SOUTH, RefNo:=XXX, SeqNo:10, Bore=400/350
REDUCER-CONCENTRIC
    END-POINT    96400.0000 17000.0000 101968.0000 400.0000
    END-POINT    96400.0000 16800.0000 101968.0000 350.0000
    <SKEY>  RCBW
    COMPONENT-ATTRIBUTE1    700 KPA
    ...
```

### REDUCER-ECCENTRIC
```
MESSAGE-SQUARE
    REDUCER-ECCENTRIC, A106-B, LENGTH=200MM, SOUTH, RefNo:=XXX, SeqNo:12, Bore=400/350
REDUCER-ECCENTRIC
    END-POINT    96400.0000 17000.0000 101968.0000 400.0000
    END-POINT    96400.0000 16800.0000 101968.0000 350.0000
    <SKEY>  REBW
    FLAT-DIRECTION  DOWN
    COMPONENT-ATTRIBUTE1    700 KPA
    ...
```

### SUPPORT (with MESSAGE-SQUARE)
```
MESSAGE-SQUARE
    SUPPORT, RefNo:=67130482/SP001, SeqNo:13, CA150, UCI:PS00178.1
SUPPORT
    CO-ORDS    96400.0000 17186.4000 101968.0000 0.0000
    <SUPPORT_NAME>    CA150
    <SUPPORT_GUID>    UCI:PS00178.1
```

---

## 20. MESSAGE-SQUARE FORMULA (MACHINE-PARSEABLE)

```python
def build_message_square(row, comp_type):
    tokens = []
    tokens.append(comp_type)
    
    if comp_type == "SUPPORT":
        # SUPPORT: no Material, Length, Direction
        ref = row.CA97 or row.REF_NO or ""
        seq = row.CA98 or row.CSV_SEQ_NO or ""
        if ref:   tokens.append(f"RefNo:{ref}")
        if seq:   tokens.append(f"SeqNo:{seq}")
        if row.support_name: tokens.append(row.support_name)
        if row.support_guid: tokens.append(row.support_guid)
        return ", ".join(tokens)
    
    # Non-SUPPORT components
    if row.CA3:       tokens.append(row.CA3)
    
    length = abs(row.LEN1 or row.LEN2 or row.LEN3 or 0)
    axis = row.AXIS1 or row.AXIS2 or row.AXIS3 or ""
    if length:        tokens.append(f"LENGTH={int(length)}MM")
    if axis:          tokens.append(axis.upper())
    
    ref = row.CA97 or row.REF_NO or ""
    seq = row.CA98 or row.CSV_SEQ_NO or ""
    if ref:           tokens.append(f"RefNo:{ref}")
    if seq:           tokens.append(f"SeqNo:{seq}")
    
    if row.BRLEN:     tokens.append(f"BrLen={int(abs(row.BRLEN))}MM")
    
    if "REDUCER" in comp_type and row.bore_large and row.bore_small:
        tokens.append(f"Bore={row.bore_large}/{row.bore_small}")
    
    if row.CA8:       tokens.append(f"Wt={row.CA8}")
    
    return ", ".join(tokens)
```

---

## 21. CONFIG TAB — SUMMARY OF EDITABLE SETTINGS

| Config Section | Key Settings |
|---------------|-------------|
| **General** | Decimal precision (1 or 4), Angle format (degrees/hundredths), CRLF mode |
| **Pipeline Ref** | Default filename, PROJECT-IDENTIFIER, AREA |
| **Column Aliases** | Full alias list per canonical column name (§13.1) |
| **Fuzzy Match** | Threshold (default 0.75), enable/disable passes |
| **SUPPORT Mapping** | Mapping blocks (Friction/Gap → Name), Fallback Name, GUID prefix ("UCI:") |
| **BRLEN Database** | Equal Tee M table (§9A.1), Reducing Tee M table (§9A.2), Weldolet A table (§9A.3) |
| **Branch Bore Fallback** | TEE default = header bore, OLET default = 50 mm |
| **Bore Unit** | Auto-detect inch vs mm, standard mm bore list |
| **Component Mapping** | Type code → PCF keyword (case-insensitive, §4) |

---

*End of PCF Syntax Master v1.2*
