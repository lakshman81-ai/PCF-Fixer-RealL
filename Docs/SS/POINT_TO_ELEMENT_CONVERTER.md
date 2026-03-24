# POINT-TO-ELEMENT CONVERTER — Smart Parser for Node-Based Input

## Addendum to: PCF Consolidated Master v2.0
## Document ID: PCF-PTE-001 Rev.0
## Purpose: Convert point-based piping data (CAESAR II node format) into the element-based Data Table used by the PCF Builder

---

## 0. THE FUNDAMENTAL PROBLEM

PCF is **element-based** — each row is a component with EP1 and EP2 (start and end).

CAESAR II / stress analysis exports are **point-based** — each row is a node (a single coordinate in space), and elements are implied by the space between consecutive nodes.

```
ELEMENT-BASED (PCF Data Table):         POINT-BASED (CAESAR II Export):
┌────────────────────────────┐          ┌──────────────────────┐
│ PIPE:  EP1────────────EP2  │          │ Point 1  (coord)     │
│ FLANGE: EP1──────EP2       │          │ Point 2  (coord)     │
│ PIPE:  EP1────────────EP2  │          │ Point 3  (coord)     │
└────────────────────────────┘          │ Point 4  (coord)     │
                                        │ Point 5  (coord)     │
Each row IS a component.                └──────────────────────┘
                                        Components are BETWEEN points.
```

This converter reads point data and constructs element rows.

---

## 1. INPUT FORMAT RECOGNITION

### 1.1 Column Mapping (Point-Based Format)

| Input Column | Alias Candidates | Meaning |
|-------------|-----------------|---------|
| Sequence | Seq, #, Row, SN | Running row number |
| NodeNo | Node No, Node, Node Number | Stress analysis node number (may be sparse: 10, 20, 30...) |
| NodeName | Node Name, Name | Named identifier (e.g., PS00178.1 for supports) |
| componentName | Component Name, Comp Name, Description | Human name of component |
| Type | Type, Comp Type | Component type code (BRAN, GASK, FLAN, ANCI, TEE, VALV, etc.) |
| RefNo | Ref No, Reference, Tag | Reference number (shared by all points of same component) |
| Point | Point, Pt, Point No, PtNo | **KEY FIELD** — position within component (1, 2, 0, 3) |
| PPoint | PPoint, Parent Point | Parent point reference |
| Bore | Bore, NPS, Size | Nominal bore with unit (e.g., "400mm") |
| O/D | OD, Outside Diameter | Outside diameter |
| Wall Thickness | WT, Wall Thick, Thk | Wall thickness |
| Corrosion Allowance | CA, Corr Allow | Corrosion allowance |
| Radius | Radius, Bend Radius, R | Bend radius (for elbows) |
| SIF | SIF, Stress Intensification | Stress intensification factor |
| Weight | Wt, Weight | Component weight |
| Material | Mat, Material, Grade | Material specification |
| Rigid | Rigid, Is Rigid | Rigid element flag |
| East | East, X, E | X-coordinate (East) |
| North | North, Y, N | Y-coordinate (North) |
| Up | Up, Z, U, Elevation | Z-coordinate (Up/Elevation) |
| Status | Status | START, END, or blank |
| Pressure | Pressure, Design Pressure | Design pressure |
| Restraint Type | Restraint Type, Rest Type, Support Type | Support/restraint classification |
| Restraint Stiffness | Stiffness, K | Spring rate |
| Restraint Friction | Friction, Mu, μ | Friction coefficient |
| Restraint Gap | Gap | Gap value for restraint |

### 1.2 Point Column Semantics

The `Point` field is the **Rosetta Stone** of this format:

| Point Value | Meaning | Maps To |
|------------|---------|---------|
| 1 | **Head/Entry** of component | EP1 of that component |
| 2 | **Tail/Exit** of component | EP2 of that component |
| 0 | **Centre** of component | CP (for TEE, BEND) or CO-ORDS (for SUPPORT/ANCI) |
| 3 | **Branch point** of component | BP (for TEE) |

### 1.3 How to Detect Point-Based vs Element-Based Input

```
IF input has a column matching "Point" or "Pt" or "PtNo":
  AND values in that column are {0, 1, 2, 3}:
  → POINT-BASED FORMAT — use this converter

IF input has columns matching "EP1 COORDS" and "EP2 COORDS":
  → ELEMENT-BASED FORMAT — use standard Data Table parser
```

---

## 2. THE DECODING RULES

### 2.1 Core Principle: Ownership at Boundaries

At the boundary between two components, the **Type field belongs to the fitting, not the pipe.**

```
... ─── FLANGE(tail, Point=2) ─── PIPE_START ─── ... ─── PIPE_END ─── ANCI(Point=0) ─── PIPE_START ─── ...
         ↑                                                              ↑
     Type = FLAN                                                    Type = ANCI
     (this is the flange's EP2,                                  (this is the support's location,
      not the pipe's EP1)                                         not the pipe's start)
```

**Translation rule:** The pipe between two fittings is NOT explicitly listed. It is the **gap between the tail of one component and the head of the next.**

### 2.2 Component Assembly — Same RefNo Points

Points sharing the same `RefNo` belong to the **same physical component**:

```
RefNo = =67130482/1666, Type = FLAN
  Point 1: (96400, 17986.4, 101968)  → EP1 of flange
  Point 2: (96400, 17840.4, 101968)  → EP2 of flange
  
  This IS the flange element: EP1→EP2, length = 146mm

RefNo = =67130482/1667, Type = TEE
  Point 1: (96400, 16891.4, 101968)  → EP1 of tee (header entry)
  Point 3: (96400, 16586.4, 102273)  → BP of tee (branch point)
  Point 0: (96400, 16586.4, 101968)  → CP of tee (centre)
  Point 2: (96400, 16281.4, 101968)  → EP2 of tee (header exit)
  
  This IS the tee element with all four points.
```

### 2.3 Implicit Pipe Detection — Gap Between Components

When the **EP2 of component A** does not coincide with the **EP1 of component B** (next in sequence), the space between them is an **implicit PIPE**:

```
Component A (FLAN):  EP2 = (96400, 17840.4, 101968)
Component B (ANCI):  Location = (96400, 17186.4, 101968)

Gap = 17840.4 - 17186.4 = 654mm (South along Y)

→ Implicit PIPE: EP1 = A.EP2, EP2 = B.Location, Length = 654mm
```

### 2.4 Zero-Length Points — Skip Rule

```
IF distance between consecutive points of the SAME component = 0mm:
  AND both points have same RefNo:
  → SKIP the duplicate point (keep the one with more data)
  → Log: "[Info] Skipped zero-length duplicate point at Row {n}"

IF distance between tail of component A and head of component B = 0mm:
  → No implicit pipe needed — components are directly connected
```

### 2.5 Support/Anchor (ANCI) — Point Element Rule

```
ANCI/SUPPORT is a POINT, not an element:
  - It has Point=0 (centre/location)
  - It does NOT consume length
  - It does NOT break the pipe chain
  
  The pipe PASSES THROUGH the support location:
    Pipe before support: EP2 = somewhere upstream
    Support location:    CO-ORDS = (x, y, z)
    Pipe after support:  EP1 = support location (or very close)
  
  The implicit pipe on EITHER side of the support is calculated from
  the previous component's exit to the support, and from the support
  to the next component's entry.
  
  BUT: The support does not split the pipe in the PCF output.
  Instead, the pipe runs continuously and the support is placed at
  its CO-ORDS location.
```

### 2.6 BRAN (Branch Origin) — Chain Start Marker

```
Type = BRAN with Point=1:
  - This is the ORIGIN of a pipe branch or main line
  - It is NOT a physical component
  - It marks the starting coordinate of the chain
  - Status = "START" confirms this
  
  Use this coordinate as EP1 of the first real component or
  the start of the first implicit pipe.
```

---

## 3. POINT-TO-ELEMENT CONVERSION ALGORITHM

### 3.1 Phase 1: Group Points by Component

```
ALGORITHM: group_points(point_rows)

1. Sort rows by Sequence number.

2. Group consecutive rows by RefNo:
   - All rows with same RefNo = one component group
   - A new RefNo = start of next component group
   
   Exception: BRAN with Status="START" is always its own group (origin marker).
   Exception: ANCI with Point=0 is always its own group (point element).

3. Within each group, classify points by Point value:
   {
     refNo: "=67130482/1667",
     type: "TEE",
     points: {
       1: {x: 96400, y: 16891.4, z: 101968, bore: 400},  // EP1
       2: {x: 96400, y: 16281.4, z: 101968, bore: 400},  // EP2
       0: {x: 96400, y: 16586.4, z: 101968, bore: 400},  // CP
       3: {x: 96400, y: 16586.4, z: 102273, bore: 350},  // BP
     }
   }

4. Discard zero-length groups (where all points have identical coordinates).

Return: ordered list of component groups.
```

### 3.2 Phase 2: Assemble Elements and Detect Implicit Pipes

```
ALGORITHM: assemble_elements(component_groups)

elements = []
prev_exit_point = null
prev_exit_bore = null

FOR each group in component_groups:

  // ─── A. ORIGIN MARKER ───
  IF group.type == "BRAN" AND group has Status "START":
    prev_exit_point = group.points[1].coord
    prev_exit_bore = group.points[1].bore
    // Do NOT create an element. Just set the chain start.
    Log: "[Info] Chain starts at ({x}, {y}, {z})"
    CONTINUE

  // ─── B. SUPPORT/ANCHOR (Point element) ───
  IF group.type == "ANCI":
    support_coord = group.points[0].coord
    
    // Check for implicit pipe BEFORE support
    IF prev_exit_point:
      pipe_length = distance(prev_exit_point, support_coord)
      IF pipe_length > 6mm:  // Not micro-pipe
        elements.append(create_implicit_pipe(
          ep1 = prev_exit_point,
          ep2 = support_coord,
          bore = prev_exit_bore,
          source = "Implicit pipe before SUPPORT"
        ))
    
    // Create support element
    elements.append({
      type: "SUPPORT",
      supportCoor: support_coord,
      supportName: derive_from_restraint_type(group),
      supportGuid: "UCI:" + group.nodeName,
      bore: 0,
    })
    
    // Support does NOT update prev_exit_point — pipe continues from support location
    prev_exit_point = support_coord
    // prev_exit_bore stays the same (support doesn't change bore)
    CONTINUE

  // ─── C. GASKET — Special handling ───
  IF group.type == "GASK":
    // Gaskets are thin elements (typically 3mm)
    // They exist in stress analysis but are NOT standard PCF components
    // Option 1: Convert to a very short PIPE (preserves length)
    // Option 2: Skip and absorb into adjacent flange
    // Default: Skip if length < 6mm (micro-element rule)
    
    gasket_ep1 = group.points[1]?.coord
    gasket_ep2 = group.points[2]?.coord
    
    IF gasket_ep1 AND gasket_ep2:
      length = distance(gasket_ep1, gasket_ep2)
      IF length < 6mm:
        Log: "[Info] Skipped gasket ({length:.1f}mm < 6mm) at RefNo {refNo}"
        prev_exit_point = gasket_ep2  // Advance past gasket
        CONTINUE
      ELSE:
        // Rare: thick gasket — treat as short pipe
        elements.append(create_implicit_pipe(
          ep1 = gasket_ep1, ep2 = gasket_ep2,
          bore = group.bore,
          source = "Gasket converted to pipe"
        ))
        prev_exit_point = gasket_ep2
        prev_exit_bore = group.bore
        CONTINUE
    
    // Zero-length gasket or single point
    IF gasket_ep1:
      prev_exit_point = gasket_ep1
    CONTINUE

  // ─── D. STANDARD COMPONENTS (FLAN, VALV, TEE, ELBO, etc.) ───
  
  component_ep1 = group.points[1]?.coord  // Point=1 → EP1
  component_ep2 = group.points[2]?.coord  // Point=2 → EP2
  component_cp  = group.points[0]?.coord  // Point=0 → CP (TEE, BEND)
  component_bp  = group.points[3]?.coord  // Point=3 → BP (TEE)
  
  // ── D.1: IMPLICIT PIPE before this component ──
  IF prev_exit_point AND component_ep1:
    gap = distance(prev_exit_point, component_ep1)
    IF gap > 6mm:
      elements.append(create_implicit_pipe(
        ep1 = prev_exit_point,
        ep2 = component_ep1,
        bore = prev_exit_bore,
        source = f"Implicit pipe before {group.type}"
      ))
    ELIF gap > 0.1mm AND gap <= 6mm:
      // Micro-gap — snap, don't create pipe
      Log: "[Info] Snapped {gap:.1f}mm gap before {group.type}"
    // gap ≈ 0: directly connected, no pipe needed
  
  // ── D.2: CREATE THE COMPONENT ELEMENT ──
  pcf_type = map_type_code(group.type)  // FLAN→FLANGE, VALV→VALVE, etc.
  
  element = {
    type: pcf_type,
    refNo: group.refNo,
    bore: parse_bore(group.bore),       // "400mm" → 400
    ep1: component_ep1,
    ep2: component_ep2,
    cp: component_cp,                   // null for PIPE/FLANGE/VALVE
    bp: component_bp,                   // null except TEE
    branchBore: group.points[3]?.bore,  // BP bore (TEE branch)
    skey: derive_skey(group),
    ca: extract_cas(group),
    // ... other fields
  }
  
  // Handle TEE specially: verify all 4 points present
  IF pcf_type == "TEE":
    IF NOT component_cp:
      element.cp = vec.mid(component_ep1, component_ep2)
      Log: "[Calculated] TEE CP derived as midpoint"
    IF NOT component_bp:
      Log: "[Warning] TEE missing branch point (Point=3)"
  
  // Handle BEND: Point=0 is the arc centre
  IF pcf_type == "BEND":
    element.cp = component_cp
    IF NOT component_cp:
      Log: "[Warning] BEND missing centre point (Point=0)"
  
  elements.append(element)
  
  // ── D.3: UPDATE CHAIN TRACKING ──
  prev_exit_point = component_ep2
  prev_exit_bore = element.bore
  
  // For TEE: also track branch exit for later branch walking
  IF pcf_type == "TEE" AND component_bp:
    register_branch_start(component_bp, element.branchBore)

RETURN elements
```

### 3.3 Phase 3: Post-Processing

After element assembly, run:

```
1. Calculate LEN/AXIS/DELTA for all elements (§8.2 of PCF Syntax Master)
2. Calculate BRLEN for TEE/OLET elements
3. Calculate pointers (BEND_PTR, RIGID_PTR, INT_PTR)
4. Generate MESSAGE-SQUARE text for all elements
5. Assign CSV SEQ NO (running numbers)
6. Run Validation V1–V20
```

---

## 4. TYPE CODE MAPPING — POINT FORMAT TO PCF

The point-based format uses different type codes than PCF. This mapping is case-insensitive and configurable:

| Point Format Type | PCF Type | Notes |
|------------------|----------|-------|
| BRAN | *(skip)* | Origin marker, not a component |
| GASK | *(skip or short PIPE)* | Gasket — absorb if < 6mm |
| FLAN | FLANGE | Standard mapping |
| VALV | VALVE | Standard mapping |
| TEE | TEE | Needs 4 points (1,2,0,3) |
| ELBO | BEND | Needs 3 points (1,2,0) |
| ANCI | SUPPORT | Point element with restraint data |
| PIPE | PIPE | Explicit pipe (rare in point format) |
| REDC | REDUCER-CONCENTRIC | Bore differs between Point=1 and Point=2 |
| REDE | REDUCER-ECCENTRIC | Same + FLAT-DIRECTION |
| OLET | OLET | Only CP(Point=0) and BP(Point=3), no EPs |
| BELO | BEND | Below-ground elbow variant → same as BEND |
| RSTR | SUPPORT | Restraint → same as ANCI |
| RIGD | *(rigid element)* | Convert to appropriate fitting or skip |

**Configurable in Config tab.** Users can add project-specific codes.

---

## 5. WORKED EXAMPLE — FULL CONVERSION

### 5.1 Input Data (Point-Based)

```
Seq  Type  RefNo              Pt  Bore    East    North     Up
1    BRAN  =67130482/1664      1  400mm   96400   17989.4   101968
2    GASK  =67130482/1665      1  400mm   96400   17989.4   101968
3    GASK  =67130482/1665      2  400mm   96400   17986.4   101968
4    FLAN  =67130482/1666      1  400mm   96400   17986.4   101968
5    FLAN  =67130482/1666      2  400mm   96400   17840.4   101968
6    ANCI  =67130482/2807      0  400mm   96400   17186.4   101968
7    TEE   =67130482/1667      1  400mm   96400   16891.4   101968
8    TEE   =67130482/1667      3  350mm   96400   16586.4   102273
9    TEE   =67130482/1667      0  400mm   96400   16586.4   101968
10   TEE   =67130482/1667      2  400mm   96400   16281.4   101968
```

### 5.2 Phase 1: Group by RefNo

```
Group 1: BRAN /1664 → {Pt1: (96400, 17989.4, 101968)} — ORIGIN
Group 2: GASK /1665 → {Pt1: (96400, 17989.4, 101968), Pt2: (96400, 17986.4, 101968)} — 3mm gasket
Group 3: FLAN /1666 → {Pt1: (96400, 17986.4, 101968), Pt2: (96400, 17840.4, 101968)} — 146mm flange
Group 4: ANCI /2807 → {Pt0: (96400, 17186.4, 101968)} — support point
Group 5: TEE  /1667 → {Pt1: (96400, 16891.4, 101968), Pt3: (96400, 16586.4, 102273),
                        Pt0: (96400, 16586.4, 101968), Pt2: (96400, 16281.4, 101968)} — tee
```

### 5.3 Phase 2: Walk and Assemble

```
Step 1: Group 1 (BRAN) → Set chain start: prev_exit = (96400, 17989.4, 101968), bore=400
        Log: "[Info] Chain starts at (96400, 17989.4, 101968)"

Step 2: Group 2 (GASK) → EP1=(96400, 17989.4, 101968), EP2=(96400, 17986.4, 101968)
        Gap before: distance(prev_exit, EP1) = 0mm → no implicit pipe
        Length: 3.0mm < 6mm threshold → SKIP
        Log: "[Info] Skipped gasket (3.0mm < 6mm) at RefNo /1665"
        Update: prev_exit = (96400, 17986.4, 101968)

Step 3: Group 3 (FLAN) → EP1=(96400, 17986.4, 101968), EP2=(96400, 17840.4, 101968)
        Gap before: distance(prev_exit, EP1) = 0mm → directly connected
        → CREATE ELEMENT: FLANGE, EP1→EP2, length=146mm, bore=400
        Update: prev_exit = (96400, 17840.4, 101968)

Step 4: Group 4 (ANCI) → Location=(96400, 17186.4, 101968)
        Gap before: distance(prev_exit, location) = 17840.4 - 17186.4 = 654mm
        654mm > 6mm → CREATE IMPLICIT PIPE: EP1=(96400, 17840.4, 101968) → EP2=(96400, 17186.4, 101968)
        Log: "[Calculated] Implicit pipe 654mm South before SUPPORT"
        → CREATE ELEMENT: SUPPORT, CO-ORDS=(96400, 17186.4, 101968)
        → Derive <SUPPORT_NAME> from Restraint Type/Friction/Gap config
        → <SUPPORT_GUID> = "UCI:PS00178.1" (from NodeName)
        Update: prev_exit = (96400, 17186.4, 101968)

Step 5: Group 5 (TEE) → EP1=(96400, 16891.4, 101968)
        Gap before: distance(prev_exit, EP1) = 17186.4 - 16891.4 = 295mm
        295mm > 6mm → CREATE IMPLICIT PIPE: EP1=(96400, 17186.4, 101968) → EP2=(96400, 16891.4, 101968)
        Log: "[Calculated] Implicit pipe 295mm South before TEE"
        → CREATE ELEMENT: TEE
            EP1 = (96400, 16891.4, 101968)  bore=400
            EP2 = (96400, 16281.4, 101968)  bore=400
            CP  = (96400, 16586.4, 101968)  bore=400
            BP  = (96400, 16586.4, 102273)  bore=350
        → Verify: CP = midpoint(EP1, EP2)?
            mid_y = (16891.4 + 16281.4) / 2 = 16586.4 ✓
        Update: prev_exit = (96400, 16281.4, 101968)
```

### 5.4 Output: Element-Based Data Table

| # | Type | RefNo | Bore | EP1 | EP2 | CP | BP | Source |
|---|------|-------|------|-----|-----|----|----|--------|
| 1 | FLANGE | /1666 | 400 | (96400, 17986.4, 101968) | (96400, 17840.4, 101968) | — | — | Direct from FLAN group |
| 2 | PIPE | /1666_pipe | 400 | (96400, 17840.4, 101968) | (96400, 17186.4, 101968) | — | — | **Implicit** (654mm South) |
| 3 | SUPPORT | /2807 | 0 | — | — | — | — | ANCI point → CO-ORDS |
| 4 | PIPE | /2807_pipe | 400 | (96400, 17186.4, 101968) | (96400, 16891.4, 101968) | — | — | **Implicit** (295mm South) |
| 5 | TEE | /1667 | 400 | (96400, 16891.4, 101968) | (96400, 16281.4, 101968) | (96400, 16586.4, 101968) | (96400, 16586.4, 102273) | Direct from TEE group |

---

## 6. SPECIAL CASES

### 6.1 TEE Point Ordering

TEE has 4 points that may appear in ANY order in the input. Always sort by Point value:

```
Point=1 → EP1 (header entry)
Point=2 → EP2 (header exit)
Point=0 → CP  (centre — must equal midpoint of EP1/EP2)
Point=3 → BP  (branch — bore may differ from header)
```

TEE header length = distance(EP1, EP2). BRLEN = distance(CP, BP).

### 6.2 BEND Point Ordering

BEND has 3 points:

```
Point=1 → EP1 (entry tangent point)
Point=2 → EP2 (exit tangent point)
Point=0 → CP  (arc centre — NOT midpoint, NOT on EP1-EP2 line)
```

Bend radius = distance(CP, EP1) = distance(CP, EP2).

### 6.3 OLET Point Handling

OLET has 2 points:

```
Point=0 → CP  (tap point on parent pipe)
Point=3 → BP  (branch end point)
```

No Point=1 or Point=2. No EP1/EP2 in PCF output.

### 6.4 REDUCER Detection

A reducer is identified when:

```
IF group.type IN ("REDC", "REDU", "REDE"):
  → Explicit reducer

IF group has Point=1 and Point=2 with DIFFERENT bore values:
  → Implicit reducer (bore change within one RefNo group)
```

### 6.5 Duplicate/Zero-Length Points Within Same Group

```
IF two points in the same group have identical coordinates:
  → Keep the one with the lower Point number
  → Discard the duplicate
  → Log: "[Info] Discarded duplicate point (Pt={n}) at RefNo {ref}"
```

### 6.6 Implicit Pipe vs Support Placement

When a support sits on a pipe run:

```
Input:
  Comp A (FLAN EP2) → 654mm gap → ANCI → 295mm gap → Comp B (TEE EP1)

Decision: Create ONE pipe or TWO?

Rule: Create TWO separate pipes split at the support location.
  Pipe 1: EP1 = FLAN.EP2 → EP2 = ANCI.location (654mm)
  SUPPORT: CO-ORDS = ANCI.location
  Pipe 2: EP1 = ANCI.location → EP2 = TEE.EP1 (295mm)

Reason: In CAESAR II, the support defines a node point that breaks
the pipe for stress analysis. The PCF should preserve this split
for node-to-node correspondence.

Alternative (config option): Create ONE pipe spanning the full 949mm
and place the support at its midpoint. Use this when PCF does not
need stress analysis node correspondence.
```

### 6.7 Status Field Handling

```
Status = "START" → Chain origin (with BRAN type). Set as first EP1.
Status = "END"   → Chain terminal. The component with this status is the last element.
Status = blank   → Normal mid-chain point.
```

### 6.8 Where Pipe is NOT Implicit — Edge Cases

Sometimes the point data DOES explicitly include pipe rows:

```
IF group.type == "PIPE" or group.type == "BRAN" (with Point=1 and Point=2):
  → This is an EXPLICIT pipe, not implicit
  → Create a PIPE element directly from its Point=1 and Point=2
  → Do NOT also create an implicit pipe for the same span
```

The converter must check: "Did I already cover this coordinate range with an explicit component?" before creating an implicit pipe.

---

## 7. COORDINATE SYSTEM MAPPING

The point-based format uses explicit axis names:

| Input Column | PCF Coordinate | Description |
|-------------|---------------|-------------|
| East | X | Easting (positive = East) |
| North | Y | Northing (positive = North) |
| Up | Z | Elevation (positive = Up) |

**Transform:** `EP = {x: row.East, y: row.North, z: row.Up}`

No rotation or transformation needed — direct mapping.

---

## 8. BORE PARSING

The point-based format often has bore as a string with unit: `"400mm"`, `"14in"`, `"350"`.

```javascript
function parseBore(boreStr) {
  if (!boreStr) return 0;
  const s = String(boreStr).trim().toLowerCase();
  
  // Extract number
  const num = parseFloat(s.replace(/[^0-9.]/g, ''));
  if (isNaN(num)) return 0;
  
  // Detect unit
  if (s.includes('in') || s.includes('"')) {
    return num * 25.4;  // Convert inches to mm
  }
  if (s.includes('mm') || num > 48) {
    return num;  // Already mm (or large enough to be mm)
  }
  
  // Ambiguous — apply standard mm bore check
  const stdMm = new Set([15,20,25,32,40,50,65,80,90,100,125,150,200,250,300,350,400,450,500,600,750,900,1050,1200]);
  if (stdMm.has(num)) return num;
  if (num <= 48) return num * 25.4;  // Likely inches
  return num;
}
```

---

## 9. SUPPORT PROPERTY EXTRACTION

The point-based format carries restraint details directly:

```javascript
function extractSupportProperties(group, config) {
  const name = deriveSupportName(
    group.restraintType,
    group.restraintFriction,
    group.restraintGap,
    config
  );
  
  const guid = group.nodeName
    ? `UCI:${group.nodeName}`
    : `UCI:NODE_${group.sequence}`;
  
  return { name, guid };
}

function deriveSupportName(restraintType, friction, gap, config) {
  // Priority 1: Use explicit Restraint Type if provided
  if (restraintType && restraintType.trim()) {
    return restraintType.trim();
  }
  
  // Priority 2: Derive from Friction/Gap per config mapping
  //   (Same logic as §12.3 of PCF Syntax Master v1.2)
  const f = parseFloat(friction);
  const g = parseFloat(gap);
  
  if ((isNaN(f) || f === 0.3) && isNaN(g)) return "ANC";
  if (f === 0.15) return "GDE";
  if (f === 0.3 && !isNaN(g) && g > 0) return "RST";
  
  return config.supportMapping?.fallbackName || "RST";
}
```

---

## 10. IMPLICIT PIPE PROPERTY INHERITANCE

When creating an implicit pipe, inherit properties from the **upstream component** (the last real component before this pipe):

```javascript
function createImplicitPipe(ep1, ep2, bore, upstreamElement, seqCounter) {
  return {
    _rowIndex: -1,  // Reassigned later
    _modified: { type: "PTE:Implicit" },
    _logTags: ["Calculated"],
    csvSeqNo: `${seqCounter}.P`,
    type: "PIPE",
    text: "",  // Generated later by MESSAGE-SQUARE builder
    refNo: `${upstreamElement.refNo || "UNKNOWN"}_pipe`,
    bore: bore,
    ep1: { ...ep1 },
    ep2: { ...ep2 },
    cp: null,
    bp: null,
    branchBore: null,
    skey: "",
    supportCoor: null,
    supportName: "",
    supportGuid: "",
    ca: {
      1: upstreamElement.ca?.[1] || null,   // Pressure
      2: upstreamElement.ca?.[2] || null,   // Temperature
      3: upstreamElement.ca?.[3] || null,   // Material
      4: upstreamElement.ca?.[4] || null,   // Wall thickness
      5: upstreamElement.ca?.[5] || null,   // Corrosion allowance
      6: upstreamElement.ca?.[6] || null,   // Insulation density
      7: null,
      8: null,  // No weight for pipe
      9: upstreamElement.ca?.[9] || null,   // Fluid density
      10: upstreamElement.ca?.[10] || null, // Test pressure
      97: null,  // Will be auto-generated
      98: null,  // Will be auto-generated
    },
    fixingAction: null,
    // Calculated fields populated in Phase 3
    len1: null, axis1: null, len2: null, axis2: null, len3: null, axis3: null,
    brlen: null, deltaX: null, deltaY: null, deltaZ: null,
    diameter: bore,
    wallThick: upstreamElement.ca?.[4] || null,
  };
}
```

---

## 11. INTEGRATION WITH EXISTING APP

### 11.1 New Import Path

```
EXISTING:
  [Import PCF ▼]  [Import Excel/CSV ▼]

UPDATED:
  [Import PCF ▼]  [Import Excel/CSV ▼]  [Import Point Data ▼]
                                          ^^^^^^^^^^^^^^^^^^^^^^^^
                                          NEW — accepts same Excel/CSV
                                          but routes through PTE converter
```

Or better: **auto-detect** within the existing Excel/CSV import:

```
When Excel/CSV is imported:
  1. Run fuzzy header matching (existing)
  2. IF a "Point" column is detected (values are 0,1,2,3):
       → Route to Point-to-Element Converter (this document)
       → Show conversion preview before populating Data Table
  3. ELSE:
       → Use standard element-based parser (existing)
```

### 11.2 Conversion Preview Modal

```
┌─────────────────────────────────────────────────────────┐
│  Point-to-Element Conversion Preview              [✕]   │
├─────────────────────────────────────────────────────────┤
│  Detected: Point-based format (CAESAR II style)         │
│  Input: 10 point rows                                   │
│  Output: 5 elements (1 flange, 2 pipes, 1 support,     │
│          1 tee)                                         │
│                                                         │
│  ┌────┬─────────┬────────────┬─────────────────────────┐│
│  │ #  │ Type    │ Length (mm)│ Source                   ││
│  ├────┼─────────┼────────────┼─────────────────────────┤│
│  │ 1  │ FLANGE  │ 146        │ Direct (FLAN /1666)     ││
│  │ 2  │ PIPE    │ 654        │ Implicit (gap fill)     ││
│  │ 3  │ SUPPORT │ —          │ ANCI /2807 → UCI:PS001  ││
│  │ 4  │ PIPE    │ 295        │ Implicit (gap fill)     ││
│  │ 5  │ TEE     │ 610        │ Direct (TEE /1667)      ││
│  └────┴─────────┴────────────┴─────────────────────────┘│
│                                                         │
│  Skipped: 1 gasket (3mm < 6mm threshold)                │
│  Skipped: 1 origin marker (BRAN)                        │
│                                                         │
│  [Cancel]                           [Confirm Conversion]│
└─────────────────────────────────────────────────────────┘
```

### 11.3 Config Additions

Add to Config tab:

```
▼ POINT-TO-ELEMENT CONVERTER
  Gasket skip threshold:    [6]  mm (gaskets below this are absorbed)
  Support splits pipe:      [✓]  (create two pipes at support, vs one through-pipe)
  Auto-detect point format: [✓]  (detect Point column automatically)
  
  Point Type Mapping (editable):
  ┌───────────┬───────────────────────┐
  │ Input Code│ PCF Type              │
  ├───────────┼───────────────────────┤
  │ BRAN      │ (skip — origin)       │
  │ GASK      │ (skip or short PIPE)  │
  │ FLAN      │ FLANGE                │
  │ VALV      │ VALVE                 │
  │ TEE       │ TEE                   │
  │ ELBO      │ BEND                  │
  │ ANCI      │ SUPPORT               │
  │ RSTR      │ SUPPORT               │
  │ OLET      │ OLET                  │
  │ REDC      │ REDUCER-CONCENTRIC    │
  │ REDE      │ REDUCER-ECCENTRIC     │
  └───────────┴───────────────────────┘
```

---

## 12. SUMMARY OF RULES

| Rule | Description |
|------|-------------|
| **R-PTE-01** | Points with same RefNo form one component |
| **R-PTE-02** | Point=1→EP1, Point=2→EP2, Point=0→CP, Point=3→BP |
| **R-PTE-03** | Gap between component exit and next component entry = implicit PIPE |
| **R-PTE-04** | Only PIPE is created implicitly. Never create implicit fittings. |
| **R-PTE-05** | BRAN with Status=START is chain origin, not a component |
| **R-PTE-06** | ANCI/SUPPORT is a point element. Pipe runs through it. |
| **R-PTE-07** | GASK < 6mm is skipped (absorbed into adjacent fitting) |
| **R-PTE-08** | Zero-length duplicate points within same RefNo are discarded |
| **R-PTE-09** | Implicit pipe inherits bore, material, design conditions from upstream |
| **R-PTE-10** | Support GUID = "UCI:" + NodeName. Name from Restraint Type or Friction/Gap mapping. |
| **R-PTE-11** | Bore string parsed: "400mm"→400, "16in"→406.4, bare number→inch/mm auto-detect |
| **R-PTE-12** | East→X, North→Y, Up→Z. Direct mapping, no rotation. |
| **R-PTE-13** | TEE must have all 4 point types. Missing CP→derive as midpoint. Missing BP→flag warning. |
| **R-PTE-14** | BEND must have 3 point types. Missing CP→flag error (cannot derive without radius). |
| **R-PTE-15** | After conversion, run full PCF validation (V1–V20) and Smart Fixer on the resulting Data Table. |

---

*End of Point-to-Element Converter — PCF-PTE-001 Rev.0*
