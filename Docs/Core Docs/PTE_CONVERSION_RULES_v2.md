# POINT-TO-ELEMENT CONVERSION RULES — Complete Logic

## Document ID: PCF-PTE-002 Rev.0
## Supersedes: PCF-PTE-001 §3 (Algorithm section)
## For: AI Coding Agent

---

## 0. OVERVIEW

This document defines how to convert **point-based piping data** into **element-based Data Table rows** under every combination of data availability.

### Decision Matrix

```
                            Sequential Data
                      ON                    OFF
                 ┌──────────────────┬──────────────────┐
     Available   │  CASE A          │  (not applicable │
  Ref/Pt/PPt     │  Enrich only     │  — if Ref/Pt/PPt │
                 │  (add Real_Type) │  exist, data is  │
                 │                  │  inherently       │
                 │                  │  sequential)      │
                 ├──────────────────┼──────────────────┤
  Line_Key ON    │  CASE B(a)       │  CASE D(a)       │
  Not Available  │  Derive Ref/Pt/  │  Orphan sweep    │
  Ref/Pt/PPt     │  PPt from coords │  with Line_Key   │
                 │  + Real_Type     │  matching         │
                 │  + Line_Key      │                   │
                 ├──────────────────┼──────────────────┤
  Line_Key OFF   │  CASE B(b)       │  CASE D(b)       │
  Not Available  │  Derive Ref/Pt/  │  Orphan sweep    │
  Ref/Pt/PPt     │  PPt from coords │  without Line_Key │
                 │  + Real_Type only│                   │
                 └──────────────────┴──────────────────┘
```

### Config Settings

```
┌─────────────────────────────────────────────────────────┐
│  POINT-TO-ELEMENT CONVERSION CONFIG                     │
├─────────────────────────────────────────────────────────┤
│  Sequential Data:     [ON ▼]  / OFF                     │
│  Line_Key:            [ON ▼]  / OFF                     │
│  Line_Key Column:     [Line No ▼] (dropdown from CSV    │
│                        headers, configurable)            │
│  Ref/Pt/PPt Available: [Auto-detect ▼] / YES / NO      │
│                                                          │
│  Orphan Sweep Settings (Case D):                        │
│    Initial sweep multiplier:  [10] × NB                 │
│    Second sweep multiplier:   [20] × NB                 │
│    Max sweep radius:          [13000] mm                 │
│    Fuzzy tolerance:           [0.2] × NB                 │
│    Min sweep radius:          [0.2 × NB] mm             │
└─────────────────────────────────────────────────────────┘
```

### Auto-Detection

```python
def detect_data_mode(headers, first_100_rows):
    """Auto-detect which case applies."""
    
    has_ref = fuzzy_match("RefNo", headers) is not None
    has_point = fuzzy_match("Point", headers) is not None
    has_ppoint = fuzzy_match("PPoint", headers) is not None
    has_linekey = config.lineKeyColumn and fuzzy_match(config.lineKeyColumn, headers)
    
    ref_pt_available = has_ref and has_point and has_ppoint
    
    # Check if data appears sequential (coordinates progress monotonically)
    is_sequential = check_sequential(first_100_rows)
    
    if ref_pt_available and is_sequential:
        return "CASE_A"
    elif not ref_pt_available and is_sequential and has_linekey:
        return "CASE_B_a"
    elif not ref_pt_available and is_sequential and not has_linekey:
        return "CASE_B_b"
    elif not is_sequential and has_linekey:
        return "CASE_D_a"
    else:
        return "CASE_D_b"
```

---

## 1. COMMON DEFINITIONS

### 1.1 Real_Type

**Real_Type** = the component type whose HEAD (EP1) starts at this point.

Every point in the data answers: "What component begins here?" The element between point[i] and point[i+1] has type = point[i].Real_Type.

```
Point:     A ────────── B ────────── C ──── D ────────── E
Real_Type: FLAN         PIPE         ANCI   TEE          PIPE

Element:   [  FLANGE  ] [   PIPE   ] •SUP  [   TEE    ] [PIPE...
           A→B          B→C                 D→E
```

### 1.2 Line_Key

**Line_Key** = the piping line number (e.g., `12-HC-1234-1A1-N`). This identifies which physical piping line a point belongs to.

Benefits when available:
- **RefNo grouping:** Points on the same Line_Key with the same Type likely belong to the same component.
- **Chain walking safety:** When filling gaps or trimming, only points on the SAME Line_Key are candidates. Prevents cross-line errors.
- **Branch detection:** TEE branch and OLET branch connect to a DIFFERENT Line_Key. Change of Line_Key = branch boundary.

When absent:
- Must rely purely on coordinates and topology.
- Risk of cross-line contamination in dense piping areas.

### 1.3 NB (Nominal Bore)

NB is used throughout as a scaling factor for sweep radii and tolerances. It represents the current pipe's nominal bore in mm.

```
Example: NB = 350mm pipe
  0.2 × NB = 70mm    (fuzzy tolerance)
  10 × NB  = 3500mm  (first sweep radius)
  20 × NB  = 7000mm  (second sweep radius)
```

---

## 2. CASE A — Sequential, Ref/Pt/PPt Available

### 2.1 What We Have

| Column | Available | Example |
|--------|-----------|---------|
| Sequence | ✓ | 1, 2, 3, ... |
| Type | ✓ | FLAN, TEE, ANCI, ... |
| RefNo | ✓ | =67130482/1666 |
| Point | ✓ | 0, 1, 2, 3 |
| PPoint | ✓ | 0, 1, 2, 3 |
| Coordinates | ✓ | East, North, Up |
| Bore | ✓ | 400mm |
| Real_Type | **ADD** | *(derived)* |

### 2.2 Algorithm: Add Real_Type Column

This is the simplest case — enrich existing data with Real_Type.

```
ALGORITHM: enrich_with_real_type(rows)

FOR each row[i] WHERE Point == 1:
  // This is a component head — Real_Type = its own Type
  row[i].Real_Type = row[i].Type

FOR each row[i] WHERE Point == 2:
  // This is a component tail — Real_Type = NEXT component's Type
  next_head = find_next_row_with_point_1(rows, i)
  IF next_head:
    row[i].Real_Type = next_head.Type
  ELSE:
    row[i].Real_Type = "END"  // Chain terminal

FOR each row[i] WHERE Point == 0:
  // Centre point — Real_Type = its own Type
  row[i].Real_Type = row[i].Type
  // But also: if ANCI/SUPPORT, the Real_Type represents what's coming next
  IF row[i].Type IN ("ANCI", "RSTR"):
    next = find_next_non_zero_point(rows, i)
    row[i].Real_Type = next.Type IF next ELSE row[i].Type

FOR each row[i] WHERE Point == 3:
  // Branch point — Real_Type = branch start type
  row[i].Real_Type = row[i].Type  // (TEE branch point)
```

### 2.3 Line_Key Enhancement (if available)

```
IF Line_Key column available:
  FOR each row:
    row.Line_Key = row[config.lineKeyColumn]
  
  // Validate: all points of same RefNo should have same Line_Key
  FOR each RefNo group:
    line_keys = unique Line_Keys in group
    IF len(line_keys) > 1:
      LOG "[Warning] RefNo {ref} spans multiple lines: {line_keys}. Possible data error."
```

**Output:** Existing data + Real_Type column + optional Line_Key. Ready for standard PTE conversion (PCF-PTE-001 §3).

---

## 3. CASE B(a) — Sequential, No Ref/Pt/PPt, Line_Key Available

### 3.1 What We Have

| Column | Available | Example |
|--------|-----------|---------|
| Sequence | ✓ | 1, 2, 3, ... |
| Real_Type | ✓ | FLAN, PIPE, ANCI, TEE, ... |
| Coordinates | ✓ | East, North, Up |
| Bore | ✓ | 400mm |
| Line_Key | ✓ | 12-HC-1234-1A1-N |
| RefNo | **DERIVE** | |
| Point | **DERIVE** | |
| PPoint | **DERIVE** | |

### 3.2 Algorithm

```
ALGORITHM: derive_ref_pt_ppt_with_linekey(rows)

refCounter = {}   // Per-type running counter for RefNo generation
current_line = null
element_counter = 0

FOR i = 0 to len(rows) - 1:
  curr = rows[i]
  next = rows[i + 1] IF i + 1 < len(rows) ELSE null
  prev = rows[i - 1] IF i > 0 ELSE null
  
  rtype = curr.Real_Type.upper()
  line = curr.Line_Key
  
  // ─── Track line changes ───
  IF line != current_line:
    LOG "[Info] Line_Key changed: {current_line} → {line} at Seq {i+1}"
    current_line = line
  
  // ─── BRAN — Chain delimiter ───
  IF rtype == "BRAN":
    curr.RefNo = generate_ref("BRAN", line, refCounter)
    curr.Point = determine_bran_point(curr, rows, i)
    curr.PPoint = curr.Point
    curr.Type = "BRAN"
    CONTINUE
  
  // ─── ANCI — Point element ───
  IF rtype IN ("ANCI", "RSTR", "SUPPORT"):
    curr.RefNo = generate_ref("ANCI", line, refCounter)
    curr.Point = 0
    curr.PPoint = 0
    curr.Type = "ANCI"
    CONTINUE
  
  // ─── OLET — Zero-length on header ───
  IF rtype == "OLET":
    ref = generate_ref("OLET", line, refCounter)
    assign_olet_points(curr, rows, i, ref, line)
    CONTINUE
  
  // ─── TEE — 4-point component ───
  IF rtype == "TEE":
    ref = generate_ref("TEE", line, refCounter)
    assign_tee_points(curr, rows, i, ref, line)
    CONTINUE
  
  // ─── ELBO/BEND — 3-point component ───
  IF rtype IN ("ELBO", "BEND"):
    ref = generate_ref("ELBO", line, refCounter)
    assign_bend_points(curr, rows, i, ref)
    CONTINUE
  
  // ─── 2-POINT COMPONENTS (FLAN, VALV, PIPE, GASK, PCOM, REDC, REDE) ───
  ref = generate_ref(rtype, line, refCounter)
  
  curr.RefNo = ref
  curr.Point = 1
  curr.Type = rtype
  
  // PPoint determination
  curr.PPoint = determine_ppoint_entry(curr, prev, rtype)
  
  // The NEXT row becomes Point=2 of THIS component
  // BUT: next row is also Point=1 of its OWN component (dual identity)
  // We create a VIRTUAL Point=2 record (or annotate for the element builder)
  curr._ep2_coord = next.coord IF next ELSE null
  curr._ep2_ppoint = determine_ppoint_exit(curr, next, rtype)


def generate_ref(type_code, line_key, counter):
    """Generate RefNo using Line_Key for grouping."""
    key = f"{line_key}_{type_code}"
    counter[key] = counter.get(key, 0) + 1
    return f"={line_key}/{type_code}_{counter[key]:04d}"


def determine_ppoint_entry(curr, prev, rtype):
    """Determine PPoint for Point=1 (entry face)."""
    if not prev:
        return 1  // First in chain — normal orientation
    
    prev_type = prev.Real_Type.upper()
    
    // Mating flange detection (using Line_Key for safety)
    if rtype == "FLAN":
        if prev_type == "FLAN" and prev.Line_Key == curr.Line_Key:
            return 2  // Inverted — mating flange
        if prev_type == "GASK":
            // Check one more back
            prev_prev = get_prev_non_gask(prev)
            if prev_prev and prev_prev.Real_Type.upper() == "FLAN":
                return 2  // Inverted — after gasket in flange pair
    
    // Valve after gasket (flanged valve)
    if rtype == "VALV" and prev_type == "GASK":
        return 2  // Flanged valve, inverted orientation
    
    return 1  // Default normal


def determine_ppoint_exit(curr, next, rtype):
    """Determine PPoint for Point=2 (exit face)."""
    // Mirrors entry logic — if entry is inverted (PPt=2), exit is PPt=1
    if curr.PPoint == 2:
        return 1  // Inverted pair
    return 2  // Default normal
```

### 3.3 Line_Key Benefits During Gap Filling

```
RULE: When Line_Key is available, gap-fill and trim operations MUST 
verify that both the current and next element share the same Line_Key.

IF curr.Line_Key != next.Line_Key:
  // Elements are on DIFFERENT piping lines
  // This is NOT a gap — it's a line boundary
  LOG "[Info] Line_Key boundary at Seq {i}: {curr.Line_Key} → {next.Line_Key}. 
         Not a gap — different piping lines."
  DO NOT create gap-fill pipe.

IF curr.Line_Key == next.Line_Key:
  // Same line — safe to gap-fill or trim
  Proceed with normal gap/overlap analysis.

EXCEPTION: TEE branch and OLET branch may connect to a different Line_Key.
  IF curr.Type == "TEE" AND curr.Point == 3 (branch point):
    // Branch may go to a different line — this is expected
    Allow cross-line connection at branch points only.
```

---

## 4. CASE B(b) — Sequential, No Ref/Pt/PPt, No Line_Key

### 4.1 What We Have

| Column | Available | Example |
|--------|-----------|---------|
| Sequence | ✓ | 1, 2, 3, ... |
| Real_Type | ✓ | FLAN, PIPE, ANCI, TEE, ... |
| Coordinates | ✓ | East, North, Up |
| Bore | ✓ | 400mm |
| RefNo | **DERIVE** | |
| Point | **DERIVE** | |
| PPoint | **DERIVE** | |
| Line_Key | **NOT AVAILABLE** | |

### 4.2 Algorithm

Same as Case B(a) but:

1. **RefNo generation** uses a simple running counter instead of Line_Key prefix:
   ```
   RefNo = "={type_code}_{global_counter:04d}"
   Example: =FLAN_0001, =PIPE_0002, =TEE_0003
   ```

2. **Gap-fill safety** has no Line_Key guard:
   - Must rely on coordinate proximity and axis continuity alone.
   - Higher risk of cross-line contamination in dense piping.
   - Log: `"[Warning] No Line_Key available — gap-fill based on topology only."` 

3. **PPoint determination** identical to B(a) since it's based on adjacent Real_Types.

4. **All other logic** identical to Case B(a).

---

## 5. TEE POINT ASSIGNMENT (Used by Cases B and D)

### 5.1 Sequential TEE (Data is in order)

```
ALGORITHM: assign_tee_points(curr_row, all_rows, idx, ref, line_key)

// In sequential data, TEE head row gives EP1.
// The NEXT row (different Real_Type) gives EP2 of the TEE header.

ep1_coord = curr_row.coord
bore_header = curr_row.bore

// Find EP2: the next row in sequence that is NOT part of this TEE
next_non_tee = find_next_row_where(all_rows, idx + 1, 
  lambda r: r.Real_Type.upper() != "TEE" or r.Line_Key != line_key)

IF NOT next_non_tee:
  LOG "[Error] TEE at Seq {idx+1} has no EP2 (end of data)"
  RETURN

ep2_coord = next_non_tee.coord

// Calculate CP
cp_coord = midpoint(ep1_coord, ep2_coord)

// Determine branch direction and BP
branch = detect_branch_direction_sequential(
  cp_coord, bore_header, all_rows, idx, line_key)

// Generate the 4 point records
emit_point(ref, "TEE", 1, 1, ep1_coord, bore_header)            // EP1
emit_point(ref, "TEE", 3, 3, branch.bp, branch.bore)            // BP
emit_point(ref, "TEE", 0, 0, cp_coord, bore_header)             // CP
emit_point(ref, "TEE", 2, 2, ep2_coord, bore_header)            // EP2
```

### 5.2 Branch Detection — Sequential with Line_Key

```
ALGORITHM: detect_branch_direction_sequential(cp, header_bore, rows, tee_idx, line_key)

// Strategy 1: Look for a row further in the data where:
//   - Line_Key DIFFERS from the TEE's line (it's a branch line)
//   - Coordinate shares 2 axes with CP but differs on the 3rd
//   - It appears after the TEE in sequence

IF line_key available:
  FOR j = tee_idx + 1 to min(tee_idx + 50, len(rows)):
    candidate = rows[j]
    IF candidate.Line_Key == line_key:
      CONTINUE  // Same line — this is header continuation, not branch
    
    // Different line — could be the branch
    axis_match_count, differ_axis, offset = compare_to_cp(candidate.coord, cp)
    IF axis_match_count == 2 AND abs(offset) > 10:
      // Found! Branch goes along differ_axis
      brlen = lookup_brlen(header_bore, candidate.bore, config)
      sign = +1 if offset > 0 else -1
      bp = calc_branch_point(cp, brlen, differ_axis, sign)
      RETURN { bp, bore: candidate.bore, direction: differ_axis, sign, confidence: "HIGH" }

// Strategy 2: No Line_Key or no match found — use perpendicular rule
header_axis = dominant_axis(vec_sub(ep2, ep1))
perp_axes = [a for a in ["X","Y","Z"] if a != header_axis]

// Default: first perpendicular axis, positive direction
// Heuristic: prefer +Z (Up) for horizontal headers (most common branch direction)
branch_axis = "Z" if header_axis in ("X","Y") else perp_axes[0]
branch_sign = +1
brlen = lookup_brlen(header_bore, header_bore, config)  // Equal tee assumed
bp = calc_branch_point(cp, brlen, branch_axis, branch_sign)

LOG "[Mock] TEE branch direction assumed: +{branch_axis}. BRLEN={brlen:.0f}mm. Verify."
RETURN { bp, bore: header_bore, direction: branch_axis, sign: branch_sign, confidence: "LOW" }
```

### 5.3 Branch Detection — Sequential without Line_Key

```
// Without Line_Key, we cannot distinguish branch lines from header continuation.
// Strategy: Look for coordinate that is perpendicular to header axis

FOR j = tee_idx + 1 to len(rows):
  candidate = rows[j]
  
  // Is this candidate's coordinate offset perpendicular to the TEE header?
  header_axis = dominant_axis(vec_sub(ep2_coord, ep1_coord))
  offset_vec = vec_sub(candidate.coord, cp)
  
  // Check: is the offset purely along a perpendicular axis?
  perp_component = magnitude of offset_vec on non-header axes
  axial_component = magnitude of offset_vec on header axis
  
  IF perp_component > 50 AND axial_component < 10:
    // This point is perpendicular to the header — likely branch start
    branch_axis = dominant perpendicular axis of offset_vec
    sign = sign of offset on that axis
    brlen = lookup_brlen(header_bore, candidate.bore, config)
    bp = calc_branch_point(cp, brlen, branch_axis, sign)
    RETURN { bp, bore: candidate.bore, direction: branch_axis, sign, confidence: "MEDIUM" }

// Fallback: use default perpendicular
...same as §5.2 fallback...
```

---

## 6. BEND POINT ASSIGNMENT (Used by Cases B and D)

```
ALGORITHM: assign_bend_points(curr_row, all_rows, idx, ref)

ep1_coord = curr_row.coord
bore = curr_row.bore

// EP2 = next row's coordinate (bend spans to next point)
next = all_rows[idx + 1] IF idx + 1 < len(all_rows) ELSE null
IF NOT next: LOG "[Error] BEND at end of chain"; RETURN
ep2_coord = next.coord

// CP = calculated from incoming/outgoing axes
prev = all_rows[idx - 1] IF idx > 0 ELSE null
after = all_rows[idx + 2] IF idx + 2 < len(all_rows) ELSE null

cp = calc_bend_cp_from_context(ep1_coord, ep2_coord, prev, after)

emit_point(ref, "ELBO", 1, 1, ep1_coord, bore)
emit_point(ref, "ELBO", 0, 0, cp, bore)
emit_point(ref, "ELBO", 2, 2, ep2_coord, bore)
```

---

## 7. OLET POINT ASSIGNMENT (Used by Cases B and D)

```
ALGORITHM: assign_olet_points(curr_row, all_rows, idx, ref, line_key)

cp_coord = curr_row.coord  // OLET is at this location on the header
bore_header = curr_row.bore

// Detect branch direction
branch = detect_olet_branch(cp_coord, bore_header, all_rows, idx, line_key)

// OLET: EP1 = EP2 = CP (all identical — zero length on header)
emit_point(ref, "OLET", 1, 1, cp_coord, bore_header)
emit_point(ref, "OLET", 3, 3, branch.bp, branch.bore)
emit_point(ref, "OLET", 0, 0, cp_coord, bore_header)
emit_point(ref, "OLET", 2, 2, cp_coord, bore_header)


def detect_olet_branch(cp, header_bore, rows, idx, line_key):
    // Similar to TEE branch detection but:
    // - OLET branches are small bore (typically 50mm)
    // - Branch does NOT have a continuation chain
    // - Default to perpendicular axis, downward (-Z for drains)
    
    header_axis = detect_header_axis_from_neighbors(rows, idx)
    perp_axes = [a for a in ["X","Y","Z"] if a != header_axis]
    
    // Default: -Z (Down) for drain, -Y (South) if vertical header
    branch_axis = perp_axes[0]
    branch_sign = -1  // Default downward
    
    brlen = lookup_olet_brlen(header_bore, config.oletDefaultBore, config)
    bp = calc_branch_point(cp, brlen, branch_axis, branch_sign)
    
    LOG "[Mock] OLET branch assumed: -{branch_axis}. Bore={config.oletDefaultBore}mm. Verify."
    RETURN { bp, bore: config.oletDefaultBore, confidence: "LOW" }
```

---

## 8. CASE D(a) — Non-Sequential, Line_Key Available (ORPHAN SWEEP)

### 8.1 The Problem

Data is NOT in piping route order. Points may be randomly arranged (e.g., exported from AutoCAD attribute table, or from a database query without ORDER BY).

We must reconstruct the piping topology from unordered coordinates using the **Orphan Sweep** algorithm.

### 8.2 Pre-Processing: Group by Line_Key

```
ALGORITHM: preprocess_by_linekey(rows)

// Step 1: Group all points by Line_Key
line_groups = {}
for row in rows:
    line = row.Line_Key or "UNKNOWN"
    line_groups[line] = line_groups.get(line, []) + [row]

// Step 2: Within each line group, these points form ONE piping chain
// But they are in random order — we need to sort them into route order

FOR each line_key, points in line_groups:
    sorted_chain = orphan_sweep(points)
    // sorted_chain is now in correct piping route order
    
    // Step 3: Apply Case B(a) logic to the sorted chain
    derive_ref_pt_ppt_with_linekey(sorted_chain)
```

### 8.3 Orphan Sweep Algorithm — Core

```
ALGORITHM: orphan_sweep(points, line_key=null)

INPUT:  Unordered list of point rows (optionally filtered by Line_Key)
OUTPUT: Ordered list of point rows in piping route sequence

// ─── STEP 1: Find the origin ───
// The origin is the "most orphaned" point — one end of the chain.
// Heuristic: find the point with the fewest neighbors within 10×NB

origin = find_chain_terminal(points)
NB = origin.bore or 350  // default bore for sweep radius

// ─── STEP 2: Initialize chain ───
ordered = [origin]
remaining = set(all points) - {origin}
current = origin
travel_axis = null
travel_direction = null

// ─── STEP 3: Walk by finding nearest neighbor ───
WHILE remaining is not empty:
  
  neighbor = sweep_for_neighbor(
    current.coord, 
    remaining, 
    NB,
    travel_axis, 
    travel_direction,
    line_key
  )
  
  IF neighbor is null:
    // No more neighbors found — chain is complete (or broken)
    LOG "[Info] Chain walk ended at ({current.coord}). 
           {len(remaining)} points remaining (orphans or other chains)."
    BREAK
  
  // Update travel context from the found connection
  new_vec = vec_sub(neighbor.coord, current.coord)
  new_axis, new_dir = dominant_axis_and_direction(new_vec)
  travel_axis = new_axis
  travel_direction = new_dir
  
  ordered.append(neighbor)
  remaining.remove(neighbor)
  current = neighbor

// ─── STEP 4: Check for remaining orphans ───
IF remaining:
  // These points couldn't be connected to the main chain
  // They might be on branch lines or truly orphaned
  LOG "[Warning] {len(remaining)} orphan points after sweep."
  
  // Attempt to form sub-chains from orphans
  sub_chains = []
  WHILE remaining:
    sub_origin = find_chain_terminal(remaining)
    sub_chain = orphan_sweep(remaining, line_key)
    sub_chains.append(sub_chain)
    remaining -= set(sub_chain)

RETURN ordered
```

### 8.4 Sweep for Neighbor — The Heart of Orphan Sweep

```
ALGORITHM: sweep_for_neighbor(current_coord, candidates, NB, travel_axis, travel_dir, line_key)

// Sweep progressively wider until a neighbor is found.
// Each sweep checks along the expected travel axis FIRST, then other axes.

// ─── PASS 1: Line_Key filtered (if available) ───
IF line_key:
  filtered = [c for c in candidates if c.Line_Key == line_key]
ELSE:
  filtered = candidates

// ─── DEFINE SWEEP STAGES ───
stages = [
  { radius: 0.2 * NB,   label: "micro (tolerance)" },     // Stage 0: < 0.2×NB
  { radius: 1.0 * NB,   label: "adjacent fitting" },       // Stage 1: < 1×NB
  { radius: 5.0 * NB,   label: "nearby" },                 // Stage 2: < 5×NB
  { radius: 10.0 * NB,  label: "normal pipe span" },       // Stage 3: < 10×NB
  { radius: 20.0 * NB,  label: "long pipe span" },         // Stage 4: < 20×NB
  { radius: 7000,        label: "very long span" },         // Stage 5: < 7000mm
  { radius: 13000,       label: "maximum span" },           // Stage 6: < 13000mm
]

FOR stage in stages:
  results = []
  
  FOR candidate in filtered:
    dist = distance(current_coord, candidate.coord)
    IF dist < stage.radius AND dist > 0.01:  // Not same point
      
      // ─── AXIS PRIORITY CHECK ───
      // If we know the travel axis, prefer candidates along that axis
      delta = vec_sub(candidate.coord, current_coord)
      cand_axis, cand_dir = dominant_axis_and_direction(delta)
      
      // Score: lower is better
      axis_penalty = 0
      IF travel_axis:
        IF cand_axis == travel_axis AND cand_dir == travel_dir:
          axis_penalty = 0      // Perfect: continues same direction
        ELIF cand_axis == travel_axis AND cand_dir != travel_dir:
          axis_penalty = 5000   // Fold-back: heavily penalized
        ELSE:
          axis_penalty = 1000   // Axis change: could be bend, moderate penalty
      
      score = dist + axis_penalty
      
      // ─── SINGLE-AXIS PREFERENCE ───
      // Strongly prefer candidates that differ on only 1 axis
      non_zero_axes = count_non_zero_axes(delta, threshold=0.5)
      IF non_zero_axes == 1:
        score *= 0.5   // 50% bonus for single-axis alignment
      ELIF non_zero_axes == 2:
        score *= 0.8   // 20% bonus for 2-axis (could be bend)
      // 3-axis = diagonal = suspicious, no bonus
      
      results.append({ candidate, dist, score, cand_axis, cand_dir })
  
  IF results:
    // Pick the candidate with the BEST (lowest) score
    best = min(results, key=lambda r: r.score)
    
    // ─── AMBIGUITY CHECK ───
    // If multiple candidates within 10% of best score, log warning
    close_matches = [r for r in results if r.score < best.score * 1.1]
    IF len(close_matches) > 1:
      LOG "[Warning] Ambiguous sweep: {len(close_matches)} candidates within 10% at 
             stage '{stage.label}'. Picking closest."
    
    RETURN best.candidate

// ─── No neighbor found at any stage ───
RETURN null


def find_chain_terminal(points):
    """Find the point most likely to be a chain end (fewest neighbors)."""
    best = null
    min_neighbors = Infinity
    
    for p in points:
        NB = p.bore or 350
        neighbors = count_points_within(points, p.coord, 10 * NB, excluding=p)
        
        // Terminal heuristic: fewer neighbors = more likely chain end
        // Also prefer points with Real_Type = BRAN or FLAN (typical terminals)
        type_bonus = 0
        if p.Real_Type.upper() in ("BRAN", "FLAN"):
            type_bonus = -5  // Prefer flanges and BRAN as terminals
        
        score = neighbors + type_bonus
        if score < min_neighbors:
            min_neighbors = score
            best = p
    
    return best
```

### 8.5 Two-Pass Orphan Sweep (Case D(a) specific)

```
ALGORITHM: two_pass_orphan_sweep(all_rows)

// ─── FIRST PASS: Line_Key matched ───
// Group by Line_Key, sweep within each group
line_groups = group_by(all_rows, "Line_Key")
ordered_chains = {}

FOR line_key, points in line_groups:
  sorted = orphan_sweep(points, line_key=line_key)
  ordered_chains[line_key] = sorted
  LOG "[Info] Pass 1: Line {line_key} — {len(sorted)} points ordered, 
         {len(points)-len(sorted)} orphans."

// Collect all orphans from pass 1
all_orphans = []
FOR line_key, points in line_groups:
  ordered = ordered_chains[line_key]
  orphans = [p for p in points if p not in ordered]
  all_orphans.extend(orphans)

// ─── SECOND PASS: No Line_Key constraint ───
// Try to attach orphans to ANY chain by coordinate proximity
IF all_orphans:
  LOG "[Info] Pass 2: {len(all_orphans)} orphans. Sweeping without Line_Key..."
  
  FOR orphan in all_orphans:
    // Find the closest point in ANY ordered chain
    best_chain = null
    best_position = null
    min_dist = Infinity
    
    FOR line_key, chain in ordered_chains:
      FOR i, point in enumerate(chain):
        d = distance(orphan.coord, point.coord)
        IF d < min_dist:
          min_dist = d
          best_chain = line_key
          best_position = i
    
    IF min_dist < 13000:  // max sweep radius
      // Insert orphan into the chain at the best position
      insert_point_into_chain(ordered_chains[best_chain], orphan, best_position)
      LOG "[Info] Pass 2: Orphan (Seq {orphan.Sequence}) attached to Line {best_chain} 
             at position {best_position}. Distance: {min_dist:.1f}mm."
    ELSE:
      LOG "[Error] Pass 2: Orphan (Seq {orphan.Sequence}) at ({orphan.coord}) 
             could not be attached to any chain. Min distance: {min_dist:.1f}mm."

RETURN ordered_chains
```

---

## 9. CASE D(b) — Non-Sequential, No Line_Key (Pure Orphan Sweep)

### 9.1 Algorithm

Same as Case D(a) but with only a single pass and no Line_Key grouping:

```
ALGORITHM: pure_orphan_sweep(all_rows)

// All points are one big pool — no line grouping possible.
// Must build chains purely from coordinate topology.

LOG "[Warning] Non-sequential data without Line_Key. 
       Topology-only reconstruction. Higher risk of cross-line errors."

// Step 1: Find all potential chain terminals
terminals = find_all_terminals(all_rows)
// Terminals: points with Real_Type in (BRAN, FLAN) at coordinate extremes

// Step 2: Start from each terminal, sweep outward
chains = []
remaining = set(all_rows)

FOR terminal in terminals:
  IF terminal not in remaining:
    CONTINUE  // Already assigned to a chain
  
  chain = orphan_sweep(list(remaining), line_key=null)
  
  IF len(chain) >= 2:  // Minimum viable chain
    chains.append(chain)
    remaining -= set(chain)

// Step 3: Handle remaining orphans
IF remaining:
  LOG "[Error] {len(remaining)} points could not be assigned to any chain."
  // Attempt sub-chains from orphans
  ...same as §8.3 Step 4...

// Step 4: Apply Case B(b) logic to each chain
FOR chain in chains:
  derive_ref_pt_ppt_without_linekey(chain)

RETURN chains
```

### 9.2 Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Cross-line contamination | Single-axis preference in sweep scoring reduces risk |
| Wrong chain ordering | Axis continuity scoring penalizes fold-backs |
| Branch miss-assignment | Bore change detection helps identify TEE branch starts |
| Duplicate chains | Post-process: merge chains that share endpoints |

---

## 10. AXIS SWEEP ORDER

The sweep always checks directions in this priority order:

```
FROM current point, search in this order:

1. FORWARD along travel axis (continue same direction)
     If travel = +Y(North): search +Y first

2. BACKWARD along travel axis (fold-back — heavily penalized)
     If travel = +Y(North): search -Y

3. PERPENDICULAR axes (potential bend or branch)
     If travel = +Y(North): search ±X then ±Z
     Order: +X, -X, +Z, -Z (East, West, Up, Down)

4. ALL 6 directions if nothing found in #1-#3
     This is the "desperate" search at wider radii
```

Implementation via scoring:

```python
def axis_sweep_score(delta_vec, travel_axis, travel_dir, distance):
    """Score a candidate neighbor. Lower = better."""
    
    cand_axis, cand_dir = dominant_axis_and_direction(delta_vec)
    non_zero = count_non_zero_axes(delta_vec, 0.5)
    
    # Base score = distance
    score = distance
    
    # Axis alignment bonuses/penalties
    if travel_axis is None:
        pass  # No context yet — pure distance
    elif cand_axis == travel_axis and cand_dir == travel_dir:
        score *= 0.3   # 70% bonus — continuing same direction
    elif cand_axis == travel_axis and cand_dir != travel_dir:
        score *= 5.0   # 5× penalty — fold-back
    elif cand_axis != travel_axis:
        score *= 1.5   # 50% penalty — axis change (bend/branch)
    
    # Single-axis bonus (piping runs along 1 axis)
    if non_zero == 1:
        score *= 0.5   # 50% bonus — clean single axis
    elif non_zero == 2:
        score *= 0.9   # 10% bonus — could be at a bend
    elif non_zero >= 3:
        score *= 2.0   # Penalty — diagonal, likely wrong
    
    # Bore consistency bonus (optional)
    # if candidate.bore == current.bore: score *= 0.9
    
    return score
```

---

## 11. SUMMARY OF ALL RULES

### Core Rules (All Cases)

| Rule | Description |
|------|-------------|
| R-PTE-34 | Each row's coord = EP2 of prev element, EP1 of this element (dual identity) |
| R-PTE-35 | ANCI/OLET + next non-point type → implicit pipe between them |
| R-PTE-36 | TEE/BEND intermediate points (CP, BP) must be calculated |
| R-PTE-37 | OLET is zero-length on header (EP1=EP2=CP) |
| R-PTE-33 | Default PPoint = Point. Invert at flange pairs heuristically. |

### Line_Key Rules

| Rule | Description |
|------|-------------|
| R-PTE-41 | Line_Key is OPTIONAL. Code must function with or without it. |
| R-PTE-42 | When ON: gap-fill only within same Line_Key. Cross-line gap = NOT a gap. |
| R-PTE-43 | When ON: TEE branch detection uses Line_Key change as branch indicator. |
| R-PTE-44 | When ON: RefNo incorporates Line_Key prefix for grouping. |
| R-PTE-45 | When OFF: all logic falls back to coordinate-only topology. |
| R-PTE-46 | Line_Key column name is configurable via Config tab. |

### Orphan Sweep Rules

| Rule | Description |
|------|-------------|
| R-PTE-50 | Start sweep from chain terminal (fewest neighbors, prefer BRAN/FLAN). |
| R-PTE-51 | Sweep stages: 0.2×NB → 1×NB → 5×NB → 10×NB → 20×NB → 7000mm → 13000mm. |
| R-PTE-52 | Continue same axis gets 70% bonus. Fold-back gets 5× penalty. |
| R-PTE-53 | Single-axis alignment gets 50% bonus. Diagonal gets 2× penalty. |
| R-PTE-54 | If >1 candidate within 10% score: pick closest, log ambiguity warning. |
| R-PTE-55 | Case D(a): First pass with Line_Key match, second pass without. |
| R-PTE-56 | Case D(b): Single pass, pure topology. Log cross-line risk warning. |
| R-PTE-57 | Chain minimum = 2 points. Single orphan points are flagged as errors. |

### Derived Field Rules

| Rule | Description |
|------|-------------|
| R-PTE-60 | RefNo: with Line_Key → `={LineKey}/{Type}_{counter}`. Without → `={Type}_{counter}`. |
| R-PTE-61 | Point: assigned based on component type and position (§§5–7). |
| R-PTE-62 | PPoint: default = Point. Invert at mating flanges and flanged valves (§3.2). |
| R-PTE-63 | Real_Type: always the TYPE column value from the input row. |

---

## 12. CONFIG DEFAULTS

```javascript
const PTE_CONFIG = {
  // Mode selection
  sequentialData: true,          // ON/OFF
  lineKeyEnabled: false,         // ON/OFF
  lineKeyColumn: "Line No",     // Column name in CSV/Excel
  refPtPptAvailable: "auto",    // "auto" / "yes" / "no"
  
  // Orphan sweep parameters
  sweep: {
    microTolerance: 0.2,         // × NB (mm)
    stage1: 1.0,                 // × NB
    stage2: 5.0,                 // × NB
    stage3: 10.0,                // × NB (first major sweep)
    stage4: 20.0,                // × NB (second major sweep)
    stage5: 7000,                // mm (absolute)
    stage6: 13000,               // mm (maximum)
  },
  
  // Scoring weights
  scoring: {
    sameAxisSameDir: 0.3,        // 70% bonus
    sameAxisReverseDir: 5.0,     // 5× penalty (fold-back)
    differentAxis: 1.5,          // 50% penalty (bend/branch)
    singleAxisBonus: 0.5,        // 50% bonus
    twoAxisBonus: 0.9,           // 10% bonus
    diagonalPenalty: 2.0,        // 2× penalty
  },
  
  // PPoint heuristics
  invertPPointAtFlangePairs: true,
  invertPPointAtFlangedValves: true,
};
```

---

*End of Point-to-Element Conversion Rules — PCF-PTE-002 Rev.0*
