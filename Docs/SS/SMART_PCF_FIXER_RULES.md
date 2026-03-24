# SMART PCF FIXER — Chain Walker Rule Engine v1.0

## Companion to: PCF Syntax Master v1.2
## Document ID: PCF-SMARTFIX-001 Rev.0
## For: AI Coding Agent and PCF Validator App

---

## 0. PURPOSE AND PHILOSOPHY

Traditional PCF fixers process coordinates point-by-point. They see numbers. They miss intent.

The Smart Fixer processes **element-by-element**, walking the piping route like a human engineer would — carrying forward the knowledge of which direction the pipe is traveling, what bore it is, what material it's made of, and what the last fitting was.

This document defines:

- **The Chain Walker** — the traversal engine that walks element chains.
- **60+ rules** organized into 9 categories.
- **4-tier auto-fix classification** — what gets fixed silently, what gets logged, what gets flagged.

**Core principle:** The program must think in **elements and routes**, not in **points and distances**.

---

## 1. CHAIN WALKER ARCHITECTURE

### 1.1 Why Walk, Not Scan

| Point-by-Point (Traditional) | Chain Walker (Smart Fixer) |
|------------------------------|---------------------------|
| Sees EP2 and EP1 as two coordinates | Sees "Pipe-5 exits South, Pipe-6 enters South" |
| Gap = distance between points | Gap = axial shortfall along travel direction |
| No concept of routing direction | Carries travel_axis and travel_direction |
| Cannot distinguish axial vs lateral gap | Decomposes gap relative to travel context |
| Treats all elements the same | Knows PIPE is flexible, fittings are rigid |
| Doesn't detect fold-back | Detects direction reversal on same axis |
| Handles branches confusingly | Forks cleanly at TEE, walks each branch |

### 1.2 The Walk Context Object

At every step of the walk, the walker carries a context:

```
WalkContext:
  travel_axis:      "X" | "Y" | "Z" | null
  travel_direction: +1 | -1 | null
  current_bore:     number (mm)
  current_material: string (CA3)
  current_pressure: string (CA1)
  current_temp:     string (CA2)
  chain_id:         string (header vs branch identifier)
  cumulative_vector: {x, y, z}  (running sum of all element vectors)
  pipe_length_sum:  number (total pipe length in chain so far)
  last_fitting_type: string (previous non-pipe component type)
  elevation:        number (current Z for horizontal runs)
  depth:            number (branch nesting level, 0=main header)
```

### 1.3 Building the Connectivity Graph

Before walking, construct the graph:

```
ALGORITHM: build_connectivity_graph(components)

Input:  Unordered list of parsed components
Output: Directed graph of element connections + list of chain start terminals

Step 1: INDEX all connection points
  For each component:
    - PIPE/FLANGE/VALVE/REDUCER: entry=EP1, exit=EP2
    - BEND:  entry=EP1, exit=EP2 (CP is internal, not a connection)
    - TEE:   entry=EP1, exit=EP2 (header), branch_exit=BP
    - OLET:  parent_attach=CP, branch_exit=BP (no entry/exit in header sense)
    - SUPPORT: position only, not a flow element

  Build spatial index:
    entry_map[snap(EP1)] → component  (for each component with EP1)

Step 2: MATCH exits to entries
  For each component's exit point (EP2, or BP for TEE branch):
    Search entry_map for nearest EP1 within tolerance (default 25mm)
    If found: create directed edge (current → next)
    If not found: mark as chain terminal (dead end or boundary)

Step 3: IDENTIFY chain start terminals
  Terminals are components whose EP1 has no incoming connection.
  Typical terminals: first flange, nozzle connection, open pipe end.
  
  Sort terminals by:
    1. Components with SKEY matching nozzle/flange patterns (preferred start)
    2. Components with lowest sequence number
    3. Components at extremes of coordinate space

Step 4: HANDLE TEE branching
  For each TEE:
    - Header connection: EP2 → next header element (already matched in Step 2)
    - Branch connection: BP → next branch element (match BP to entry_map)
    - Store branch_start as a deferred chain to walk later

Step 5: DETECT orphans
  Any component not reachable from any terminal → orphan element.
  Flag immediately.

Return: { graph, terminals, orphans, tee_branches }
```

### 1.4 The Walk Algorithm

```
ALGORITHM: walk_chain(start_terminal, graph, context)

Input:  Starting component, connectivity graph, initial WalkContext
Output: Ordered ChainLink list with gap analysis and fix actions

chain = []
current = start_terminal
visited = set()

WHILE current is not null AND current.id not in visited:
  
  visited.add(current.id)
  
  // ─── A. DETECT ELEMENT AXIS ───
  elem_axis, elem_dir = detect_element_axis(current)
  
  // ─── B. PRE-RULES: Check element itself ───
  Run element-level rules:
    R-GEO-01: Micro-element check (< 6mm)
    R-GEO-04: Fitting dimension sanity
    R-GEO-05: Bend radius sanity
    R-GEO-06: Valve face-to-face check
    R-DAT-01: Coordinate precision consistency
    R-DAT-02: Suspicious round numbers
  
  // ─── C. AXIS CONTINUITY CHECK ───
  IF context.travel_axis is set AND elem_axis is set:
    IF elem_axis != context.travel_axis:
      IF current.type NOT IN (BEND, TEE):
        Flag R-CHN-01: "Axis change without bend"
  
  // ─── D. BORE CONTINUITY CHECK ───
  IF current.bore != context.current_bore:
    IF previous element was NOT a REDUCER:
      Flag R-GEO-02: "Missing reducer"
  
  // ─── E. MATERIAL/DESIGN CONTINUITY ───
  Run continuity rules:
    R-DAT-03: Material continuity
    R-DAT-04: Design condition continuity
  
  // ─── F. UPDATE CONTEXT ───
  IF elem_axis:
    context.travel_axis = elem_axis
    context.travel_direction = elem_dir
  context.current_bore = current.bore (or EP2 bore for reducer)
  context.current_material = current.ca[3]
  context.cumulative_vector += element_vector(current)
  IF current.type == "PIPE":
    context.pipe_length_sum += element_length(current)
  IF current.type NOT IN ("PIPE", "SUPPORT"):
    context.last_fitting_type = current.type
  
  // ─── G. FIND NEXT ELEMENT ───
  next = graph.get_next(current)
  gap_vector = null
  IF next:
    gap_vector = next.entry_point - current.exit_point
  
  // ─── H. GAP/OVERLAP ANALYSIS ───
  fix_action = null
  IF gap_vector:
    fix_action = analyze_gap_with_context(
      gap_vector, context, current, next
    )
  
  // ─── I. RECORD CHAIN LINK ───
  chain.append(ChainLink(
    element = current,
    context_snapshot = copy(context),
    gap_to_next = gap_vector,
    fix_action = fix_action,
    next_element = next
  ))
  
  // ─── J. BRANCH HANDLING ───
  IF current.type == "TEE":
    branch_start = graph.get_branch(current)
    IF branch_start AND branch_start.id NOT IN visited:
      branch_context = copy(context)
      branch_context.travel_axis = detect_branch_axis(current)
      branch_context.travel_direction = detect_branch_direction(current)
      branch_context.current_bore = current.branchBore
      branch_context.depth += 1
      branch_context.chain_id = context.chain_id + ".B" + str(branch_count)
      
      branch_chain = walk_chain(branch_start, graph, branch_context)
      chain[-1].branch_chain = branch_chain
  
  // ─── K. ADVANCE ───
  current = next

END WHILE

// ─── L. POST-WALK AGGREGATE CHECKS ───
Run chain-level rules:
  R-AGG-01: Total pipe length sanity
  R-AGG-02: Minimum tangent between bends
  R-AGG-03: Route closure check
  R-AGG-04: Dead-end detection (on last element)
  R-AGG-05: Flange pair completeness

RETURN chain
```

### 1.5 The Complete Walk Sequence (Visualized)

For a typical pipeline:

```
MAIN WALK:

  Terminal → Flange-1 ──────────────────────────────── context: Y-axis, South
       │
       ▼
  Pipe-1 (654mm South) ────────────────────────────── check gap: 0mm ✓
       │
       ▼
  [SUPPORT noted at Y=17186.4] ────────────────────── R-SPA-03: on pipe axis? ✓
       │
       ▼
  Pipe-2 (295mm South) ────────────────────────────── check gap: 0mm ✓
       │
       ▼
  Tee-1 ───┬─── header continues South ────────────── context stays Y, South
            │
            └─── BRANCH FORK → queue branch walk
       │
       ▼  (header)
  Pipe-3 (500mm South) ────────────────────────────── check gap: 0mm ✓
       │
       ▼
  Flange-2 → Flange-3 → END ──────────────────────── R-AGG-04: flange terminal ✓
  
  
BRANCH WALK (from Tee-1 BP):

  context: Z-axis, Up, bore=350, depth=1

  Pipe-4 (505mm Up) ──────────────────────────────── same axis ✓
       │
       ▼
  Flange-4 (146mm Up) ────────────────────────────── R-TOP-04: paired? check
       │
       ▼
  Valve-1 (765mm Up) ─────────────────────────────── R-TOP-05: flanges on sides? ✓
       │
       ▼
  Flange-5 (143mm Up) ────────────────────────────── R-TOP-04: paired ✓
       │
       ▼
  Pipe-5 (150mm Up) → Pipe-6 (150mm Up) ──────────── R-SPA-04: collinear merge? 
       │
       ▼
  Bend-1 (turn Up→West) ──────────────────────────── axis change at bend ✓
       │                                               context → X-axis, West
       ▼
  Flange-6 (146mm West) → END ────────────────────── R-AGG-04: flange terminal ✓
```

---

## 2. RULE CATEGORIES

Rules are organized into 9 categories:

| Prefix | Category | Count |
|--------|----------|-------|
| R-GEO | Geometric Sanity | 8 rules |
| R-TOP | Topological Checks | 7 rules |
| R-CHN | Chain Continuity | 6 rules |
| R-GAP | Gap Analysis | 8 rules |
| R-OVR | Overlap Analysis | 6 rules |
| R-BRN | Branch-Specific | 5 rules |
| R-SPA | Spatial Reasoning | 5 rules |
| R-DAT | Data Quality | 6 rules |
| R-AGG | Chain Aggregate | 6 rules |

**Total: 57 rules**

---

## 3. GEOMETRIC SANITY RULES (R-GEO)

### R-GEO-01: Micro-Element Deletion

```
IF element.type == "PIPE" AND element_length(element) < 6.0mm:
  ACTION: DELETE element
  TIER: 1 (auto-fix silently)
  LOG: "[Fix] Deleted micro-pipe at Row {n}: length {len}mm < 6mm threshold."

IF element.type != "PIPE" AND element_length(element) < 1.0mm:
  ACTION: FLAG for review (cannot delete a fitting)
  TIER: 4 (error, no auto-fix)
  LOG: "[Error] Row {n}: {type} has near-zero length ({len}mm). Coordinate error."
```

**Rationale:** Micro-pipes arise from modeling artifacts — tiny slivers at intersections. They serve no structural or routing purpose and cause problems in stress analysis.

### R-GEO-02: Bore Continuity Along Chain

```
AT each chain step, compare current.bore vs context.current_bore:

IF bore changes AND previous element is NOT REDUCER-CONCENTRIC/ECCENTRIC:
  IF bore change matches a known reducer size pair (config table):
    ACTION: FLAG as missing reducer
    TIER: 4 (error)
    LOG: "[Error] Row {n}: Bore changes {old}→{new} without reducer. 
           Insert REDUCER between Row {n-1} and Row {n}."
  ELSE:
    ACTION: FLAG as data error
    TIER: 4 (error)
    LOG: "[Error] Row {n}: Unexpected bore change {old}→{new}. 
           Not a standard reducer size pair."
```

**Rationale:** Bore can only physically change at a reducer. Any other bore change along a chain indicates a missing component or data error.

### R-GEO-03: Single-Axis Element Rule

```
FOR element WHERE type IN (PIPE, FLANGE, VALVE, REDUCER):
  deltas = decompose(EP2 - EP1)
  non_zero_axes = [axis for axis in deltas if abs(delta) > 0.5mm]
  
  IF len(non_zero_axes) > 1:
    dominant = axis with max(abs(delta))
    minor_axes = all other non-zero axes
    total_minor = sum of abs(minor deltas)
    
    IF total_minor < 2.0mm:
      ACTION: SNAP minor axes to zero (align to dominant axis)
      TIER: 2 (auto-fix with log)
      LOG: "[Fix] Row {n}: {type} had {total_minor:.1f}mm off-axis drift. 
             Snapped to pure {dominant}-axis."
    ELSE:
      ACTION: FLAG as diagonal element
      TIER: 4 (error)
      LOG: "[Error] Row {n}: {type} runs diagonally across {axes}. 
             Pipes and fittings must align to a single global axis."
```

**Rationale:** In plant piping, straight elements (pipes, flanges, valves, reducers) run along a single global axis. Diagonal elements are data errors except in extremely rare cases (which the engineer can manually accept).

### R-GEO-04: Fitting Dimension Sanity

```
FOR element WHERE type IN (FLANGE, VALVE, TEE, BEND, REDUCER):
  measured_length = element_length(element)
  catalog_range = config.catalog_dimensions[type][bore]
  
  IF catalog_range is defined:
    IF measured_length < catalog_range.min * 0.8:
      ACTION: FLAG as undersized
      TIER: 3 (warning)
      LOG: "[Warning] Row {n}: {type} length {measured}mm is {pct}% below 
             catalog minimum {min}mm for bore {bore}."
    
    IF measured_length > catalog_range.max * 1.2:
      ACTION: FLAG as oversized
      TIER: 3 (warning)
      LOG: "[Warning] Row {n}: {type} length {measured}mm is {pct}% above 
             catalog maximum {max}mm for bore {bore}."
```

**Rationale:** Every fitting has a known dimension range from standards (B16.5 flanges, API 600 valves, B16.9 tees). Deviations beyond 20% indicate coordinate errors.

### R-GEO-05: Bend Radius Sanity

```
FOR element WHERE type == "BEND":
  R_measured = distance(CP, EP1)  // should equal distance(CP, EP2)
  R_15D = 1.5 * config.pipe_OD[bore]   // long radius
  R_10D = 1.0 * config.pipe_OD[bore]   // short radius
  
  // Check CP equidistant
  R_to_EP1 = distance(CP, EP1)
  R_to_EP2 = distance(CP, EP2)
  IF abs(R_to_EP1 - R_to_EP2) > 1.0mm:
    LOG: "[Error] Row {n}: BEND CP not equidistant from EPs. 
           dist(CP,EP1)={R1:.1f}, dist(CP,EP2)={R2:.1f}."
    TIER: 4
  
  // Check against standard radii
  IF abs(R_measured - R_15D) < R_15D * 0.05:
    LOG: "[Info] Row {n}: BEND radius {R:.1f}mm matches 1.5D ({R15:.1f}mm)."
  ELIF abs(R_measured - R_10D) < R_10D * 0.05:
    LOG: "[Info] Row {n}: BEND radius {R:.1f}mm matches 1.0D ({R10:.1f}mm)."
  ELSE:
    LOG: "[Warning] Row {n}: BEND radius {R:.1f}mm does not match 
           standard 1.5D ({R15:.1f}) or 1.0D ({R10:.1f}). Non-standard bend?"
    TIER: 3
```

### R-GEO-06: Valve Face-to-Face Check

```
FOR element WHERE type == "VALVE":
  measured_ftf = element_length(element)
  catalog_ftf = config.valve_ftf[skey][bore][class]
  
  IF catalog_ftf is defined AND abs(measured_ftf - catalog_ftf) > catalog_ftf * 0.1:
    LOG: "[Warning] Row {n}: Valve face-to-face {measured}mm vs catalog {catalog}mm 
           for {skey} bore {bore}. Deviation > 10%."
    TIER: 3
```

### R-GEO-07: Zero-Length Element

```
FOR any element:
  IF element_length(element) == 0 (EP1 == EP2):
    IF type == "SUPPORT":
      SKIP (supports are point elements)
    ELIF type == "OLET":
      SKIP (olets use CP/BP, not EPs)
    ELSE:
      LOG: "[Error] Row {n}: {type} has zero length (EP1 = EP2). 
             Coordinate error or duplicate."
      TIER: 4
```

### R-GEO-08: Coordinate Magnitude Sanity

```
FOR any coordinate value (X, Y, or Z) in any EP/CP/BP/COOR:
  IF abs(value) > 500000:
    LOG: "[Warning] Row {n}: Coordinate magnitude {value:.0f}mm 
           (={value/1000:.1f}m) seems unusually large. Verify units."
    TIER: 3
  
  IF value == 0.0 and this is the ONLY axis that is zero:
    SKIP (single zero axis is fine)
  
  IF all three spatial values == 0.0:
    LOG: "[Error] Row {n}: Coordinate (0,0,0) — prohibited."
    TIER: 4
```

---

## 4. TOPOLOGICAL CHECKS (R-TOP)

### R-TOP-01: Dead-End Detection

```
AT chain terminal (last element in walk):
  IF element.type == "PIPE":
    // Pipe ending without a fitting = suspicious
    LOG: "[Warning] Chain {id} ends at bare PIPE (Row {n}). 
           Expected terminal fitting (flange, cap, nozzle)."
    TIER: 3
  
  ELIF element.type IN ("FLANGE", "VALVE"):
    LOG: "[Info] Chain {id} terminates at {type} (Row {n}). Normal terminal."
    TIER: — (info only)
  
  ELSE:
    LOG: "[Warning] Chain {id} ends at {type} (Row {n}). 
           Unusual terminal. Verify connection."
    TIER: 3
```

### R-TOP-02: Orphan Element Detection

```
AFTER all chains are walked:
  orphans = all_components - visited_components
  
  FOR each orphan:
    LOG: "[Error] Row {n}: {type} is an orphan — not connected to any chain. 
           Likely modeling error or missing connection."
    TIER: 4
```

### R-TOP-03: Duplicate Element Detection

```
FOR each pair of components (i, j) where i < j:
  IF same type AND coords_approx_equal(i.EP1, j.EP1, tol=2mm) 
                AND coords_approx_equal(i.EP2, j.EP2, tol=2mm):
    LOG: "[Error] Row {i} and Row {j}: Duplicate {type} elements 
           occupying same spatial extent. Delete one."
    ACTION: Mark j as candidate for deletion
    TIER: 4 (flag, do not auto-delete — let user choose which)
```

### R-TOP-04: Flange Pair Check

```
DURING walk, track flanges:
  IF current.type == "FLANGE" AND NOT is_terminal(current, chain):
    // Mid-chain flange — should have a mating flange adjacent
    prev = chain[n-1].element (if exists)
    next = chain[n+1].element (if exists)
    
    IF prev.type != "FLANGE" AND next.type != "FLANGE":
      LOG: "[Warning] Row {n}: Mid-chain FLANGE has no mating flange. 
             Flange joints require a pair."
      TIER: 3
    
    IF prev.type == "FLANGE":
      // Verify they are face-to-face (EP2 of prev = EP1 of current, ~0mm gap)
      IF gap > 3mm:
        LOG: "[Warning] Row {n}: Flange pair gap {gap:.1f}mm. 
               Expected face-to-face contact."
        TIER: 3
```

### R-TOP-05: Valve Flange Sandwich Check

```
DURING walk:
  IF current.type == "VALVE" AND current.skey starts with "VB" (flanged valve):
    prev = previous non-pipe element in chain (skip pipes)
    next = next non-pipe element in chain (skip pipes)
    
    IF prev.type != "FLANGE":
      LOG: "[Warning] Row {n}: Flanged valve ({skey}) has no upstream flange. 
             Expected flange before flanged valve."
      TIER: 3
    
    IF next.type != "FLANGE":
      LOG: "[Warning] Row {n}: Flanged valve ({skey}) has no downstream flange. 
             Expected flange after flanged valve."
      TIER: 3
```

### R-TOP-06: Support On-Pipe Validation

```
FOR each SUPPORT in the chain:
  Find the pipe element whose axis the support should lie on:
    - Search adjacent pipes in the chain
    - Project support CO-ORDS onto pipe axis (EP1→EP2 line)
    - Calculate perpendicular distance from support to pipe axis
  
  IF perpendicular_distance > 5mm:
    LOG: "[Error] Row {n}: SUPPORT is {dist:.1f}mm off the pipe axis. 
           Support must lie on or near a pipe."
    TIER: 4
  
  // Check if support falls between pipe EP1 and EP2 (not outside)
  IF projection_parameter < 0 OR projection_parameter > 1:
    LOG: "[Warning] Row {n}: SUPPORT projects outside the adjacent pipe extent. 
           Verify support location."
    TIER: 3
```

### R-TOP-07: Tee Centre-Point On-Header

```
FOR each TEE:
  // CP must lie on EP1→EP2 segment
  t = project_point_onto_line(CP, EP1, EP2)
  
  IF t < -0.01 OR t > 1.01:
    LOG: "[Error] Row {n}: TEE centre-point is outside the header 
           EP1→EP2 segment (t={t:.3f}). CP must lie between EP1 and EP2."
    TIER: 4
  
  IF abs(t - 0.5) > 0.02:
    LOG: "[Warning] Row {n}: TEE centre-point is not at midpoint 
           (t={t:.3f}, expected 0.5). Standard tees have CP at centre."
    TIER: 3
```

---

## 5. CHAIN CONTINUITY RULES (R-CHN)

### R-CHN-01: Axis Change Without Bend

```
DURING walk, when travel_axis changes:
  IF causing element is NOT BEND and NOT TEE branch entry:
    LOG: "[Error] Row {n}: Travel axis changed from {old_axis} to {new_axis} 
           at {type}. Only BENDs and TEE branches can change axis. 
           Missing BEND between Row {n-1} and Row {n}?"
    TIER: 4
```

**Rationale:** The most common cause of broken PCFs. A pipe appears to turn a corner because coordinates are wrong, not because there's actually a turn.

### R-CHN-02: Fold-Back Detection

```
DURING walk:
  IF context.travel_axis == elem_axis AND context.travel_direction != elem_dir:
    // Same axis, reversed direction = fold-back
    
    IF current.type == "PIPE":
      fold_length = element_length(current)
      IF fold_length < 25mm:
        ACTION: DELETE fold-back pipe
        TIER: 2 (auto-fix with log)
        LOG: "[Fix] Row {n}: Fold-back pipe ({fold_length:.1f}mm) on 
               {axis}-axis deleted."
      ELSE:
        ACTION: FLAG for review
        TIER: 4 (error)
        LOG: "[Error] Row {n}: Pipe folds back {fold_length:.1f}mm on 
               {axis}-axis. Too large to auto-delete. Manual review needed."
    
    ELIF current.type == "BEND":
      // 180° return bend — check if intentional
      LOG: "[Info] Row {n}: 180° return bend detected on {axis}-axis. 
             Verify this is intentional (U-bend / expansion loop)."
      TIER: — (info)
    
    ELSE:
      LOG: "[Error] Row {n}: {type} reverses direction on {axis}-axis. 
             Fittings cannot fold back."
      TIER: 4
```

### R-CHN-03: Elbow-Elbow Proximity

```
DURING walk:
  IF current.type == "BEND" AND context.last_fitting_type == "BEND":
    // Two bends with no pipe between them
    prev_bend = find_previous_bend(chain)
    pipe_between = total_pipe_length_between(prev_bend, current)
    
    IF pipe_between == 0:
      LOG: "[Warning] Row {n}: Two adjacent bends with no pipe between them. 
             Compound bend or modeling error? Verify."
      TIER: 3
    ELIF pipe_between < 1.0 * config.pipe_OD[bore]:
      LOG: "[Warning] Row {n}: Only {pipe_between:.0f}mm pipe between bends. 
             Minimum tangent for stress analysis may not be met."
      TIER: 3
```

### R-CHN-04: Sequence Number Ordering

```
DURING walk:
  IF current.csvSeqNo < previous.csvSeqNo AND both are valid numbers:
    LOG: "[Info] Row {n}: Sequence number {curr_seq} is less than 
           previous {prev_seq}. Data ordering may not match routing direction."
    TIER: — (info)
    
    // Count total reversals in chain
    AT end of chain:
    IF reversal_count > chain_length * 0.3:
      LOG: "[Warning] Chain {id}: {pct}% of sequence numbers are out of order. 
             Consider re-sequencing to match routing direction."
      TIER: 3
```

### R-CHN-05: Elevation Drift in Horizontal Runs

```
DURING walk on a horizontal run (travel_axis = X or Y):
  Track Z values across consecutive elements.
  
  IF all Z values in the last N elements are within 2mm of each other:
    // Stable horizontal run — check for drift
    median_Z = median of recent Z values
    
    IF abs(current.ep1.z - median_Z) > 2mm AND abs(current.ep1.z - median_Z) < 10mm:
      // Small drift — snap to median
      ACTION: SNAP Z to median_Z
      TIER: 2 (auto-fix with log)
      LOG: "[Fix] Row {n}: Z drifted to {z:.1f} (median {med:.1f}). 
             Snapped to {med:.1f} for horizontal run consistency."
    
    ELIF abs(current.ep1.z - median_Z) >= 10mm:
      // Large Z change in a horizontal run — intentional slope or error?
      LOG: "[Warning] Row {n}: Z changes by {delta:.1f}mm in horizontal run. 
             Intentional slope or elevation error?"
      TIER: 3
```

### R-CHN-06: Shared-Axis Coordinate Snapping

```
FOR two consecutive elements on the same travel_axis:
  // The two non-travel coordinates should match exactly.
  // E.g., if travelling along Y, then X and Z should be identical.
  
  non_travel_axes = axes other than travel_axis
  
  FOR each non_travel_axis:
    val_prev = previous.exit_point[axis]
    val_curr = current.entry_point[axis]
    drift = abs(val_curr - val_prev)
    
    IF drift > 0.1mm AND drift < 2.0mm:
      ACTION: SNAP to previous value
      TIER: 1 (auto-fix silently)
      LOG: "[Fix] Row {n}: {axis} drifted {drift:.1f}mm on shared axis. 
             Snapped to {val_prev:.1f}."
    
    ELIF drift >= 2.0mm AND drift < 10.0mm:
      ACTION: SNAP with warning
      TIER: 2 (auto-fix with log)
      LOG: "[Fix] Row {n}: {axis} drifted {drift:.1f}mm. Snapped to {val_prev:.1f}. 
             Verify this is not an intentional offset."
    
    ELIF drift >= 10.0mm:
      ACTION: FLAG — do not auto-fix
      TIER: 4 (error)
      LOG: "[Error] Row {n}: {axis} offset {drift:.1f}mm from previous element. 
             Too large for auto-snap. Lateral offset or data error."
```

---

## 6. GAP ANALYSIS RULES (R-GAP)

### R-GAP-01: Zero/Negligible Gap

```
gap_magnitude = sqrt(gx² + gy² + gz²)

IF gap_magnitude < 1.0mm:
  ACTION: OK — no fix needed
  TIER: 1 (silent)
  IF gap_magnitude > 0.1mm:
    // Snap to close the micro-gap
    ACTION: Extend current EP2 to match next EP1
    LOG: "[Fix] Row {n}→{n+1}: Micro-gap {gap:.2f}mm closed by snapping."
```

### R-GAP-02: Single-Axis Gap Along Travel (≤ 25mm)

```
gap_axes = decompose(gap_vector, threshold=0.5mm)

IF len(gap_axes) == 1 AND gap_axes[0].axis == context.travel_axis:
  gap_delta = gap_axes[0].delta
  
  IF abs(gap_delta) <= 25.0mm:
    IF gap_delta * context.travel_direction > 0:
      // Gap in travel direction — insert filler pipe
      ACTION: GAP_FILL_AUTO
      TIER: 2 (auto-fix with log)
      LOG: "[Fix] Row {n}→{n+1}: {abs(gap_delta):.1f}mm gap along 
             {axis}-axis {direction}. Filled with pipe."
    ELSE:
      // Gap in reverse direction — this IS an overlap (see R-OVR rules)
      Delegate to overlap rules.
```

### R-GAP-03: Single-Axis Gap Along Travel (> 25mm)

```
IF len(gap_axes) == 1 AND gap_axes[0].axis == context.travel_axis:
  IF abs(gap_delta) > 25.0mm AND abs(gap_delta) <= 100.0mm:
    ACTION: FLAG for review, suggest pipe fill
    TIER: 3 (warning)
    LOG: "[Warning] Row {n}→{n+1}: {abs(gap_delta):.1f}mm gap along 
           {axis}-axis. Exceeds 25mm auto-fill. Fill with pipe? (manual confirm)"
  
  IF abs(gap_delta) > 100.0mm:
    ACTION: FLAG as major gap
    TIER: 4 (error)
    LOG: "[Error] Row {n}→{n+1}: {abs(gap_delta):.1f}mm gap along 
           {axis}-axis. Major gap — likely missing component(s)."
```

### R-GAP-04: Single-Axis Gap on Non-Travel Axis (Lateral Gap)

```
IF len(gap_axes) == 1 AND gap_axes[0].axis != context.travel_axis:
  // Lateral offset — pipe has shifted sideways
  lateral_delta = abs(gap_axes[0].delta)
  
  IF lateral_delta < 2.0mm:
    ACTION: SNAP (align coordinates)
    TIER: 2 (auto-fix with log)
    LOG: "[Fix] Row {n}→{n+1}: Lateral offset {lateral_delta:.1f}mm on 
           {axis}-axis (travel is {travel_axis}). Snapped to align."
  ELSE:
    ACTION: FLAG — lateral shift
    TIER: 4 (error)
    LOG: "[Error] Row {n}→{n+1}: Lateral offset {lateral_delta:.1f}mm on 
           {axis}-axis. Pipe has shifted sideways. Manual review required."
```

### R-GAP-05: Multi-Axis Gap — Negligible Lateral

```
IF len(gap_axes) >= 2:
  along_travel = component of gap along context.travel_axis
  lateral_total = sum of abs(components on other axes)
  
  IF lateral_total < 2.0mm AND abs(along_travel) <= 25.0mm:
    // Lateral is noise, treat as pure axial gap
    ACTION: GAP_FILL_AUTO + SNAP lateral
    TIER: 2 (auto-fix with log)
    LOG: "[Fix] Row {n}→{n+1}: Multi-axis gap (axial={along:.1f}mm, 
           lateral={lat:.1f}mm). Lateral snapped, axial filled with pipe."
```

### R-GAP-06: Multi-Axis Gap — Significant Components

```
IF len(gap_axes) >= 2:
  IF lateral_total >= 2.0mm OR abs(along_travel) > 25.0mm:
    ACTION: FLAG — rigorous check required
    TIER: 4 (error)
    LOG: "[Error] Row {n}→{n+1}: Multi-axis gap ({format_gap(gap_axes)}). 
           Cannot auto-fill. Rigorous manual review required."
```

### R-GAP-07: Gap at TEE Header Junction

```
IF next.type == "TEE" OR current.type == "TEE":
  // Gap near tees is often caused by not accounting for tee C dimension
  tee = whichever is the TEE
  C_dimension = config.tee_C_dimension[tee.bore]
  
  IF C_dimension AND abs(gap_magnitude - C_dimension * 0.5) < 5mm:
    LOG: "[Info] Row {n}: Gap near TEE ({gap:.1f}mm) approximately equals 
           half the tee C dimension ({C_half:.1f}mm). 
           Likely tee body not accounted for in pipe length."
    ACTION: Adjust pipe length to account for tee C
    TIER: 2
```

### R-GAP-08: Only Pipes Fill Gaps

```
CRITICAL RULE — enforced in all gap-fill actions:

  When inserting a filler element:
    - ALWAYS create a PIPE element.
    - NEVER create a fitting (flange, valve, bend, etc.) to fill a gap.
    - Filler pipe inherits bore, material (CA3), design conditions (CA1, CA2) 
      from the upstream element.
    - Filler pipe gets a generated RefNo: "{upstream_ref}_GapFill"
    - Filler pipe is tagged with Fixing Action = "GAPFILLING"
    - LOG: "[Fix] Injected gap-fill PIPE: {length:.1f}mm {axis} {direction}, 
             bore={bore}, after Row {n}."
```

---

## 7. OVERLAP ANALYSIS RULES (R-OVR)

### R-OVR-01: Simple Axial Overlap on Pipe

```
IF gap is negative (overlap) along travel_axis:
  overlap = abs(gap_delta)
  
  IF current.type == "PIPE" AND overlap <= 25.0mm:
    ACTION: TRIM current pipe EP2 back by overlap amount
    TIER: 2 (auto-fix with log)
    LOG: "[Fix] Row {n}: Pipe trimmed by {overlap:.1f}mm to resolve 
           {axis}-axis overlap with Row {n+1}."
    
    // Update EP2:
    current.ep2[travel_axis] -= overlap * travel_direction
  
  ELIF current.type == "PIPE" AND overlap > 25.0mm:
    ACTION: FLAG — large overlap
    TIER: 3 (warning)
    LOG: "[Warning] Row {n}: Pipe overlaps next element by {overlap:.1f}mm. 
           Exceeds 25mm auto-trim threshold. Manual review."
```

### R-OVR-02: Overlap Where Current is a Fitting (Rigid)

```
IF gap is negative AND current.type NOT IN ("PIPE"):
  // Cannot trim a fitting — it has fixed catalog dimensions
  
  IF next.type == "PIPE":
    // Try trimming the NEXT pipe instead
    ACTION: TRIM next pipe EP1 forward by overlap amount
    TIER: 2 (auto-fix with log)
    LOG: "[Fix] Row {n+1}: Pipe trimmed at start by {overlap:.1f}mm to resolve 
           overlap with upstream {type} (Row {n})."
  ELSE:
    // Both are rigid — cannot auto-fix
    ACTION: FLAG
    TIER: 4 (error)
    LOG: "[Error] Row {n}→{n+1}: Rigid-on-rigid overlap ({current.type} → 
           {next.type}). Neither can be trimmed. {overlap:.1f}mm overlap. 
           Requires coordinate correction."
```

### R-OVR-03: Rigid-on-Rigid Overlap

```
IF current.type NOT IN ("PIPE") AND next.type NOT IN ("PIPE"):
  ACTION: NEVER auto-fix
  TIER: 4 (error)
  LOG: "[Error] Row {n}→{n+1}: {current.type} overlaps {next.type} by 
         {overlap:.1f}mm. Both are rigid fittings with catalog dimensions. 
         Cannot trim either. Investigate pipe between them or coordinate error."
```

### R-OVR-04: Enveloping Overlap

```
// Element B starts before Element A ends AND extends past A's extent
// This means B's EP1 is "behind" A's EP1 in travel direction

IF next.ep1 is "behind" current.ep1 in travel direction:
  // B starts before A even begins — complete spatial overlap
  ACTION: FLAG as major error
  TIER: 4 (error)
  LOG: "[Error] Row {n+1} ({next.type}) envelops Row {n} ({current.type}). 
         Elements are spatially stacked. One is likely misplaced entirely."
```

### R-OVR-05: Overlap at Tee Boundaries

```
IF current.type == "PIPE" AND next.type == "TEE":
  overlap = abs(gap_delta)
  tee_half_C = config.tee_C_dimension[next.bore] / 2
  
  IF abs(overlap - tee_half_C) < 3mm:
    // Overlap equals tee half-body — pipe wasn't trimmed for tee insertion
    ACTION: TRIM pipe by tee half-C
    TIER: 2 (auto-fix with log)
    LOG: "[Fix] Row {n}: Pipe trimmed by {tee_half_C:.1f}mm 
           (half tee C dimension) to accommodate TEE at Row {n+1}."
  ELSE:
    // Overlap doesn't match tee dimension — something else is wrong
    LOG: "[Warning] Row {n}: Pipe overlaps TEE by {overlap:.1f}mm 
           (tee half-C = {tee_half_C:.1f}mm). Non-standard overlap."
    TIER: 3
```

### R-OVR-06: Overlap Creates Negative Pipe Length

```
AFTER trimming a pipe (R-OVR-01 or R-OVR-02):
  remaining_length = element_length(trimmed_pipe)
  
  IF remaining_length < 0:
    // Trimming would make pipe go negative — pipe is entirely inside overlap
    ACTION: DELETE the pipe entirely
    TIER: 2 (auto-fix with log)
    LOG: "[Fix] Row {n}: Pipe entirely consumed by overlap ({overlap:.1f}mm > 
           original length {original:.1f}mm). Pipe deleted."
  
  ELIF remaining_length < 6.0mm:
    // After trimming, pipe is micro-sized — delete it (R-GEO-01)
    ACTION: DELETE
    TIER: 2
    LOG: "[Fix] Row {n}: Pipe reduced to {remaining:.1f}mm after trim. 
           Below 6mm threshold. Deleted."
```

---

## 8. BRANCH-SPECIFIC RULES (R-BRN)

### R-BRN-01: Branch Bore Cannot Exceed Header Bore

```
FOR each TEE:
  IF branchBore > bore (header bore):
    LOG: "[Error] Row {n}: TEE branch bore ({branchBore}mm) exceeds 
           header bore ({bore}mm). Header and branch may be swapped, 
           or tee data is corrupt."
    TIER: 4
```

### R-BRN-02: Olet Size Ratio Check

```
FOR each OLET:
  ratio = branchBore / bore  (branch / header)
  
  IF ratio > 0.5:
    LOG: "[Warning] Row {n}: OLET branch/header ratio = {ratio:.2f} (> 0.5). 
           Consider using a TEE instead of olet for this size combination."
    TIER: 3
  
  IF ratio > 0.8:
    LOG: "[Error] Row {n}: OLET branch/header ratio = {ratio:.2f} (> 0.8). 
           Olets are not suitable for near-equal bore ratios. Use TEE."
    TIER: 4
```

### R-BRN-03: Branch Direction Must Differ From Header

```
FOR each TEE:
  header_axis = detect_element_axis(TEE using EP1, EP2)
  branch_vector = BP - CP
  branch_axis = dominant_axis(branch_vector)
  
  IF branch_axis == header_axis:
    LOG: "[Error] Row {n}: TEE branch axis ({branch_axis}) is same as 
           header axis ({header_axis}). Branch must be perpendicular to header."
    TIER: 4
```

### R-BRN-04: Branch Perpendicularity

```
FOR each TEE:
  header_vec = normalize(EP2 - EP1)
  branch_vec = normalize(BP - CP)
  
  dot_product = dot(header_vec, branch_vec)
  angle_from_perpendicular = abs(acos(abs(dot_product)) - pi/2) in degrees
  
  IF angle_from_perpendicular > 5.0 degrees:
    LOG: "[Warning] Row {n}: TEE branch is {angle:.1f}° from perpendicular 
           to header. Expected 90°. Wye fitting or data error?"
    TIER: 3
  
  IF angle_from_perpendicular > 15.0 degrees:
    LOG: "[Error] Row {n}: TEE branch is {angle:.1f}° from perpendicular. 
           Severely non-perpendicular. Data error."
    TIER: 4
```

### R-BRN-05: Branch Chain Continuation Validation

```
AFTER walking a branch chain from TEE BP:
  branch_first = first element in branch chain
  
  IF distance(TEE.BP, branch_first.EP1) > 25mm:
    LOG: "[Error] Row {n}: TEE branch point does not connect to next branch 
           element. Gap = {gap:.1f}mm. Branch chain may be broken."
    TIER: 4
  
  // Also check bore continuity at branch start
  IF branch_first.bore != TEE.branchBore:
    LOG: "[Warning] Row {n}: TEE branch bore ({TEE.branchBore}mm) does not 
           match first branch element bore ({branch_first.bore}mm)."
    TIER: 3
```

---

## 9. SPATIAL REASONING RULES (R-SPA)

### R-SPA-01: Elevation Consistency in Horizontal Runs

*(See R-CHN-05 — duplicated here for completeness under spatial category)*

Track Z across horizontal runs. Snap drifts < 2mm. Warn on drifts 2–10mm. Error on > 10mm.

### R-SPA-02: Coordinate Snapping on Shared Axes

*(See R-CHN-06 — duplicated here)*

When two elements share a travel axis, their non-travel coordinates must match. Snap < 2mm, warn 2–10mm, error > 10mm.

### R-SPA-03: Gravity-Aware Support Placement

```
FOR each SUPPORT:
  // Determine if support is on a vertical run
  adjacent_pipe = find_containing_pipe(support.coor, chain)
  
  IF adjacent_pipe:
    pipe_axis = detect_element_axis(adjacent_pipe)
    
    IF pipe_axis == "Z":
      LOG: "[Warning] Row {n}: Support on vertical pipe run ({axis}-axis). 
             Verify support type is appropriate for vertical loading 
             (e.g., trunnion, spring hanger, not a simple rest)."
      TIER: 3
```

### R-SPA-04: Collinear Pipe Merging Suggestion

```
FOR two adjacent PIPE elements:
  IF same travel_axis AND same travel_direction 
     AND gap < 1.0mm (or zero)
     AND same bore AND same CA3 AND same CA4 AND same CA1 AND same CA2:
    
    combined_length = element_length(pipe1) + element_length(pipe2)
    
    LOG: "[Info] Row {n} and Row {n+1}: Two collinear pipes with identical 
           properties. Can be merged into single {combined_length:.0f}mm pipe. 
           (Not auto-merged — may have deliberate stress analysis node points.)"
    TIER: — (info/suggestion only, never auto-merge)
```

### R-SPA-05: Suspicious Placeholder Coordinates

```
FOR any coordinate value:
  suspicious_values = [0.0, 100000.0, 99999.0, 999999.0, -1.0, 1.0]
  
  IF value IN suspicious_values AND value appears as X, Y, or Z:
    // Check if the value is consistent with adjacent elements
    IF adjacent elements do NOT have similar values in this axis:
      LOG: "[Warning] Row {n}: Coordinate {axis}={value:.0f} looks like a 
             placeholder or default value. Adjacent elements use {axis}≈{avg:.0f}."
      TIER: 3
```

---

## 10. DATA QUALITY RULES (R-DAT)

### R-DAT-01: Coordinate Precision Consistency

```
FOR all elements in a chain:
  // Check how many decimal places each coordinate uses
  precisions = set()
  FOR each coordinate value:
    decimal_places = count_decimal_places(value)
    precisions.add(decimal_places)
  
  IF len(precisions) > 1:
    dominant_precision = mode(all_precisions)
    outlier_rows = rows where precision != dominant_precision
    
    FOR each outlier:
      LOG: "[Warning] Row {n}: Coordinate precision ({prec} decimals) differs 
             from chain standard ({dominant} decimals). 
             Possible data source inconsistency."
      TIER: 3
```

### R-DAT-02: Suspicious Round Numbers

*(See R-GEO-08 — the coordinate magnitude and placeholder check)*

### R-DAT-03: Material Continuity

```
DURING walk:
  IF current.ca[3] != context.current_material AND both are non-empty:
    IF previous element is FLANGE or VALVE:
      // Material change at a joint — acceptable
      LOG: "[Info] Row {n}: Material changes from {old} to {new} at 
             {prev_type} joint. Verified transition point."
    ELSE:
      LOG: "[Warning] Row {n}: Material changes from {old} to {new} 
             mid-pipe (no flange/joint between). 
             Possible data merge from different line numbers."
      TIER: 3
```

### R-DAT-04: Design Condition Continuity

```
DURING walk:
  IF current.ca[1] != context.current_pressure OR current.ca[2] != context.current_temp:
    IF both are non-empty and differ:
      LOG: "[Warning] Row {n}: Design conditions change. 
             Pressure: {old_p}→{new_p}, Temp: {old_t}→{new_t}. 
             Verify this is not a data merge from different line specs."
      TIER: 3
```

### R-DAT-05: CA8 Weight Scope

```
FOR each element:
  IF ca[8] is populated AND type IN ("PIPE", "SUPPORT"):
    LOG: "[Warning] Row {n}: CA8 (weight) is populated for {type}. 
           CA8 should only be on fittings (FLANGE, VALVE, etc.)."
    ACTION: Consider removing CA8 for PIPE/SUPPORT
    TIER: 3
  
  IF ca[8] is NOT populated AND type IN ("FLANGE", "VALVE"):
    LOG: "[Info] Row {n}: {type} has no CA8 (weight). 
           Consider adding component weight for analysis."
    TIER: — (info)
```

### R-DAT-06: SKEY Consistency with Component Type

```
FOR each element with skey:
  expected_prefix = {
    "FLANGE": ["FL"],
    "VALVE": ["V"],
    "BEND": ["BE"],
    "TEE": ["TE"],
    "OLET": ["OL"],
    "REDUCER-CONCENTRIC": ["RC"],
    "REDUCER-ECCENTRIC": ["RE"],
  }
  
  prefixes = expected_prefix.get(type, [])
  IF prefixes AND NOT any(skey.startswith(p) for p in prefixes):
    LOG: "[Warning] Row {n}: SKEY '{skey}' does not match expected prefix 
           for {type} (expected: {prefixes}). Wrong SKEY or wrong type?"
    TIER: 3
```

---

## 11. CHAIN AGGREGATE RULES (R-AGG)

### R-AGG-01: Total Pipe Length Sanity

```
AT end of chain walk:
  total_pipe_length = context.pipe_length_sum
  
  // Check for zero or negative total
  IF total_pipe_length <= 0:
    LOG: "[Error] Chain {id}: Total pipe length is {total:.0f}mm (≤ 0). 
           Chain has no effective piping. Fundamentally broken."
    TIER: 4
  
  // Check pipe-to-fitting ratio
  total_chain_length = magnitude(context.cumulative_vector)
  total_fitting_length = total_chain_length - total_pipe_length
  
  IF total_chain_length > 0 AND total_pipe_length / total_chain_length < 0.1:
    LOG: "[Warning] Chain {id}: Pipe is only {pct:.0f}% of total chain length. 
           Unusually high fitting density. Verify data."
    TIER: 3
```

### R-AGG-02: Minimum Tangent Between Bends

```
DURING walk, track distance since last bend:
  pipe_since_bend = pipe length accumulated since last BEND
  
  AT each new BEND:
    min_tangent = 1.0 * config.pipe_OD[bore]  // 1D minimum tangent
    
    IF pipe_since_bend < min_tangent AND pipe_since_bend > 0:
      LOG: "[Warning] Row {n}: Only {pipe_since_bend:.0f}mm straight pipe 
             before this bend. Minimum tangent for stress analysis is 
             {min_tangent:.0f}mm (1D). May cause flexibility analysis issues."
      TIER: 3
    
    pipe_since_bend = 0  // reset counter
```

### R-AGG-03: Route Closure Check

```
AT end of chain walk:
  // If chain connects two known terminal points (nozzles, tie-ins):
  start_point = chain[0].element.ep1
  end_point = chain[-1].element.ep2 (or last exit point)
  
  expected_vector = end_point - start_point
  actual_vector = context.cumulative_vector
  
  closure_error = magnitude(expected_vector - actual_vector)
  
  IF closure_error > 5.0mm:
    LOG: "[Warning] Chain {id}: Route closure error = {error:.1f}mm. 
           Sum of element vectors does not close to terminal points. 
           Cumulative coordinate drift detected.
           Expected: ({ex:.1f}, {ey:.1f}, {ez:.1f})
           Actual:   ({ax:.1f}, {ay:.1f}, {az:.1f})
           Error:    ({dx:.1f}, {dy:.1f}, {dz:.1f})"
    TIER: 3
  
  IF closure_error > 50.0mm:
    // Upgrade to error
    LOG: "[Error] Chain {id}: Route closure error = {error:.1f}mm. 
           Major cumulative error — missing elements or coordinate errors."
    TIER: 4
```

### R-AGG-04: Dead-End Detection

*(See R-TOP-01 — applied at chain end)*

### R-AGG-05: Flange Pair Completeness

```
AT end of chain walk:
  // Count all flanges in chain
  flanges = [link for link in chain if link.element.type == "FLANGE"]
  terminal_flanges = flanges at chain start or end
  mid_flanges = flanges not at terminals
  
  // Mid-chain flanges should come in pairs
  IF len(mid_flanges) % 2 != 0:
    LOG: "[Warning] Chain {id}: Odd number of mid-chain flanges ({count}). 
           Flange joints require pairs. One mating flange may be missing."
    TIER: 3
```

### R-AGG-06: Component Count Sanity

```
AT end of chain walk:
  // Very short chains with many fittings are suspicious
  IF len(chain) <= 2 AND all elements are fittings (no pipes):
    LOG: "[Warning] Chain {id}: Chain has only fittings, no pipe. 
           Missing pipe elements between fittings?"
    TIER: 3
  
  // Very long chains with no supports
  support_count = count supports in chain
  chain_length_m = magnitude(cumulative_vector) / 1000
  
  IF chain_length_m > 10.0 AND support_count == 0:
    LOG: "[Warning] Chain {id}: {chain_length_m:.1f}m of piping with 
           no supports. Verify support data is included."
    TIER: 3
```

---

## 12. FIX APPLICATION ENGINE

### 12.1 Fix Priority Order

When multiple fixes apply to the same region, apply in this order:

```
Priority 1: DELETE micro-elements (R-GEO-01) — remove noise first
Priority 2: DELETE fold-backs (R-CHN-02) — remove reversed elements
Priority 3: SNAP coordinates (R-CHN-06, R-GAP-01) — align axes
Priority 4: TRIM overlaps (R-OVR-01, R-OVR-02) — resolve overlaps
Priority 5: FILL gaps (R-GAP-02, R-GAP-05) — insert filler pipes
Priority 6: RECALCULATE derived data (LEN, AXIS, DELTA, BRLEN, pointers)
```

### 12.2 Fix Application Rules

```
RULE F-01: Only PIPE elements can be created, trimmed, or deleted by auto-fix.
RULE F-02: Fittings (FLANGE, VALVE, BEND, TEE, OLET, REDUCER) are RIGID. 
            Their coordinates come from catalog dimensions. Never modify fitting length.
RULE F-03: When trimming a pipe, adjust EP2 (exit end) by default, not EP1 
            (to preserve the connection with the upstream element).
RULE F-04: When a pipe is trimmed to below 6mm, delete it entirely (triggers R-GEO-01).
RULE F-05: When inserting a filler pipe, inherit ALL properties 
            (bore, CA1-CA10 except CA8, material) from the upstream element.
RULE F-06: Filler pipes get Fixing Action = "GAPFILLING".
RULE F-07: Deleted elements get Fixing Action = "DELETED".
RULE F-08: Trimmed elements get Fixing Action = "TRIMMED".
RULE F-09: After all fixes, re-run coordinate calculations (§8.2 of PCF Syntax Master)
            to ensure LEN, AXIS, DELTA, and BRLEN are consistent.
RULE F-10: After all fixes, re-run validation checklist (V1-V20 of PCF Syntax Master)
            to verify no fixes introduced new errors.
```

### 12.3 Filler Pipe Template

```
When creating a gap-filler PIPE:

  csvSeqNo:     "{upstream_seq}.GF"
  type:         "PIPE"
  refNo:        "{upstream_ref}_GapFill"
  bore:         (from upstream element)
  ep1:          (upstream element EP2 — the gap start)
  ep2:          (downstream element EP1 — the gap end)
  skey:         null
  ca[1..10]:    (copy from upstream, except CA8 = null)
  ca[97]:       "={refNo}"
  ca[98]:       "{csvSeqNo}"
  fixingAction: "GAPFILLING"
  _logTags:     ["Calculated"]
```

---

## 13. AUTO-FIX TIER CLASSIFICATION

### Tier 1 — Auto-Fix Silently

Fixes so minor they need no user attention. Applied automatically, logged for record only.

| Rule | Fix |
|------|-----|
| R-GAP-01 | Close micro-gaps < 1mm by snapping |
| R-CHN-06 (< 2mm) | Snap shared-axis drift < 2mm |
| R-GEO-01 (< 6mm pipe) | Delete micro-pipes silently |

### Tier 2 — Auto-Fix With Log

Fixes that are safe but the user should know about. Applied automatically, prominently logged.

| Rule | Fix |
|------|-----|
| R-GAP-02 | Fill axial gaps ≤ 25mm with pipe |
| R-GAP-05 | Fill multi-axis gap where lateral < 2mm |
| R-GAP-07 | Adjust pipe for tee C dimension |
| R-OVR-01 | Trim pipe overlap ≤ 25mm |
| R-OVR-02 | Trim adjacent pipe when fitting overlaps |
| R-OVR-05 | Trim pipe for tee half-C |
| R-OVR-06 | Delete pipe consumed by overlap |
| R-CHN-02 (< 25mm) | Delete small fold-back pipes |
| R-CHN-05 (< 2mm) | Snap Z-drift in horizontal runs |
| R-CHN-06 (2–10mm) | Snap shared-axis drift with warning |
| R-GEO-03 (< 2mm) | Snap minor off-axis drift on elements |

### Tier 3 — Flag as Warning

Issues that may need attention but are not critical errors.

| Rule | Issue |
|------|-------|
| R-GAP-03 | Axial gap 25–100mm (suggest fill, don't auto-fix) |
| R-OVR-01 (> 25mm) | Large pipe overlap |
| R-GEO-04 | Fitting dimension deviation > 20% |
| R-GEO-05 | Non-standard bend radius |
| R-GEO-06 | Valve face-to-face mismatch |
| R-CHN-03 | Adjacent bends without adequate tangent |
| R-CHN-05 (2–10mm) | Moderate elevation drift |
| R-TOP-01 | Dead end at bare pipe |
| R-TOP-04 | Missing mating flange |
| R-TOP-05 | Flanged valve without adjacent flanges |
| R-BRN-02 (ratio > 0.5) | Olet where tee might be better |
| R-DAT-01 | Precision inconsistency |
| R-DAT-03 | Material change without joint |
| R-DAT-04 | Design condition discontinuity |
| R-DAT-06 | SKEY prefix mismatch |
| R-AGG-01 | Low pipe-to-fitting ratio |
| R-AGG-02 | Short tangent between bends |
| R-AGG-03 (5–50mm) | Route closure error |
| R-AGG-05 | Odd number of mid-chain flanges |
| R-AGG-06 | No supports on long chain |
| R-SPA-03 | Support on vertical run |
| R-SPA-05 | Suspicious placeholder coordinate |

### Tier 4 — Flag as Error (No Auto-Fix)

Critical issues requiring human intervention.

| Rule | Issue |
|------|-------|
| R-GAP-03 (> 100mm) | Major gap — missing components |
| R-GAP-04 | Lateral offset > 2mm |
| R-GAP-06 | Multi-axis gap with significant components |
| R-OVR-03 | Rigid-on-rigid overlap |
| R-OVR-04 | Enveloping overlap |
| R-GEO-01 (fitting) | Near-zero-length fitting |
| R-GEO-02 | Missing reducer at bore change |
| R-GEO-03 (> 2mm) | Diagonal pipe element |
| R-GEO-07 | Zero-length element |
| R-GEO-08 | Coordinate (0,0,0) |
| R-CHN-01 | Axis change without bend |
| R-CHN-02 (> 25mm) | Large fold-back pipe |
| R-CHN-06 (> 10mm) | Large lateral offset between consecutive elements |
| R-TOP-02 | Orphan element |
| R-TOP-03 | Duplicate element |
| R-TOP-06 | Support off pipe axis |
| R-TOP-07 | Tee CP outside header segment |
| R-BRN-01 | Branch bore > header bore |
| R-BRN-02 (ratio > 0.8) | Olet at near-equal bore |
| R-BRN-03 | Branch same axis as header |
| R-BRN-04 (> 15°) | Severely non-perpendicular branch |
| R-BRN-05 | Branch chain disconnected from tee BP |
| R-AGG-03 (> 50mm) | Major route closure error |

---

## 14. CONFIG PARAMETERS FOR SMART FIXER

All thresholds are editable in the Config tab:

```
smartFixer: {
  // Connectivity
  connectionTolerance: 25.0,       // mm — max distance to consider two points "connected"
  gridSnapResolution: 1.0,         // mm — spatial index grid cell size
  
  // Micro-element
  microPipeThreshold: 6.0,         // mm — pipes below this are deleted
  microFittingThreshold: 1.0,      // mm — fittings below this are flagged
  
  // Gap thresholds
  negligibleGap: 1.0,              // mm — gaps below this are snapped silently
  autoFillMaxGap: 25.0,            // mm — axial gaps up to this are auto-filled
  reviewGapMax: 100.0,             // mm — gaps up to this are warned; above = error
  
  // Overlap thresholds
  autoTrimMaxOverlap: 25.0,        // mm — pipe overlaps up to this are auto-trimmed
  
  // Snapping thresholds
  silentSnapThreshold: 2.0,        // mm — drift below this snapped silently
  warnSnapThreshold: 10.0,         // mm — drift below this snapped with warning
  
  // Fold-back
  autoDeleteFoldbackMax: 25.0,     // mm — fold-back pipes up to this are deleted
  
  // Axis detection
  offAxisThreshold: 0.5,           // mm — deltas below this are treated as zero
  diagonalMinorThreshold: 2.0,     // mm — minor axis deltas below this are snapped
  
  // Fitting dimensions
  fittingDimensionTolerance: 0.20, // 20% deviation from catalog triggers warning
  
  // Bend
  bendRadiusTolerance: 0.05,       // 5% deviation from 1.0D or 1.5D
  
  // Tangent
  minTangentMultiplier: 1.0,       // minimum tangent = multiplier × OD
  
  // Route closure
  closureWarningThreshold: 5.0,    // mm
  closureErrorThreshold: 50.0,     // mm
  
  // Bore
  maxBoreForInchDetection: 48,     // bore values ≤ this may be inches
  
  // Branch
  oletMaxRatioWarning: 0.5,        // branch/header ratio above this = warning
  oletMaxRatioError: 0.8,          // branch/header ratio above this = error
  branchPerpendicularityWarn: 5.0, // degrees from 90°
  branchPerpendicularityError: 15.0,
  
  // Elevation
  horizontalElevationDrift: 2.0,   // mm — Z drift in horizontal run
  
  // Aggregate
  minPipeRatio: 0.10,              // minimum pipe / total chain length ratio
  noSupportAlertLength: 10000.0,   // mm (10m) — warn if no supports above this
}
```

---

## 15. INTEGRATION WITH WORK INSTRUCTION

### 15.1 Processing Pipeline Update

The Smart Fixer inserts into the PCF Validator processing pipeline (WI-PCF-VALIDATOR-001) as follows:

```
Step 1:  Parse MESSAGE-SQUARE → pre-populate Data Table
Step 2:  Cross-verify MESSAGE-SQUARE vs Component Data
Step 3:  Fill missing identifiers
Step 4:  Bore unit conversion

  ┌──────────────────────────────────────────────────────┐
  │  NEW: Step 4A — BUILD CONNECTIVITY GRAPH (§1.3)      │
  │  NEW: Step 4B — WALK ALL CHAINS (§1.4)               │
  │  NEW: Step 4C — RUN ALL 57 RULES (§3–§11)            │
  │  NEW: Step 4D — APPLY TIER 1 + TIER 2 FIXES (§12)   │
  │  NEW: Step 4E — LOG ALL TIER 3 + TIER 4 FINDINGS     │
  └──────────────────────────────────────────────────────┘

Step 5:  Bi-directional coordinate calculation (RECALC after fixes)
Step 6:  CP/BP calculation
Step 7:  BRLEN fallback lookup
Step 8:  Branch bore fallback
Step 9:  SUPPORT mapping
Step 10: Pointer calculation
Step 11: MESSAGE-SQUARE regeneration
Step 12: Run Validation Checklist (V1–V20)
Step 13: Generate tally
```

### 15.2 Debug Tab Enhancement

The Debug tab's log table gains new columns for Smart Fixer output:

| Column | Description |
|--------|-------------|
| Chain | Chain ID (e.g., "Header", "Branch-1") |
| Walk Step | Position in chain walk (1, 2, 3...) |
| Rule | Rule ID (e.g., "R-GAP-02") |
| Tier | 1, 2, 3, or 4 |
| Fix Applied? | ✓ (Tier 1/2) or ✗ (Tier 3/4) |

### 15.3 Tally Table Enhancement

Add Smart Fixer summary to tally:

```
┌──────────────────────────┬───────────┐
│ Smart Fixer Summary      │ Count     │
├──────────────────────────┼───────────┤
│ Chains found             │     2     │
│ Total elements walked    │    17     │
│ Orphan elements          │     0     │
│ ─────────────────────────│───────────│
│ Tier 1 fixes (silent)    │     3     │
│ Tier 2 fixes (logged)    │     1     │
│ Tier 3 warnings          │     2     │
│ Tier 4 errors            │     0     │
│ ─────────────────────────│───────────│
│ Pipes inserted (gap fill)│     1     │
│ Pipes deleted (micro)    │     0     │
│ Pipes trimmed (overlap)  │     1     │
│ Coordinates snapped      │     3     │
│ ─────────────────────────│───────────│
│ Route closure error (mm) │     0.3   │
└──────────────────────────┴───────────┘
```

---

## 16. RULE QUICK REFERENCE (SORTED BY ID)

| ID | Category | Brief Description | Tier |
|----|----------|-------------------|------|
| R-GEO-01 | Geometric | Micro-element deletion (< 6mm pipe, < 1mm fitting) | 1/4 |
| R-GEO-02 | Geometric | Bore continuity — missing reducer | 4 |
| R-GEO-03 | Geometric | Single-axis element rule — diagonal detection | 2/4 |
| R-GEO-04 | Geometric | Fitting dimension sanity vs catalog | 3 |
| R-GEO-05 | Geometric | Bend radius vs 1.0D / 1.5D | 3 |
| R-GEO-06 | Geometric | Valve face-to-face check | 3 |
| R-GEO-07 | Geometric | Zero-length element | 4 |
| R-GEO-08 | Geometric | Coordinate magnitude / (0,0,0) check | 3/4 |
| R-TOP-01 | Topological | Dead-end detection | 3 |
| R-TOP-02 | Topological | Orphan element detection | 4 |
| R-TOP-03 | Topological | Duplicate element detection | 4 |
| R-TOP-04 | Topological | Flange pair check | 3 |
| R-TOP-05 | Topological | Valve flange sandwich | 3 |
| R-TOP-06 | Topological | Support on-pipe validation | 4 |
| R-TOP-07 | Topological | Tee CP on header segment | 4 |
| R-CHN-01 | Chain | Axis change without bend | 4 |
| R-CHN-02 | Chain | Fold-back detection | 2/4 |
| R-CHN-03 | Chain | Elbow-elbow proximity | 3 |
| R-CHN-04 | Chain | Sequence number ordering | Info |
| R-CHN-05 | Chain | Elevation drift in horizontal runs | 2/3 |
| R-CHN-06 | Chain | Shared-axis coordinate snapping | 1/2/4 |
| R-GAP-01 | Gap | Zero/negligible gap (< 1mm) | 1 |
| R-GAP-02 | Gap | Single-axis gap along travel ≤ 25mm | 2 |
| R-GAP-03 | Gap | Single-axis gap along travel > 25mm | 3/4 |
| R-GAP-04 | Gap | Lateral gap on non-travel axis | 2/4 |
| R-GAP-05 | Gap | Multi-axis gap, negligible lateral | 2 |
| R-GAP-06 | Gap | Multi-axis gap, significant components | 4 |
| R-GAP-07 | Gap | Gap at tee header junction | 2 |
| R-GAP-08 | Gap | Only pipes fill gaps | — (rule) |
| R-OVR-01 | Overlap | Simple axial overlap on pipe | 2/3 |
| R-OVR-02 | Overlap | Overlap where current is rigid | 2/4 |
| R-OVR-03 | Overlap | Rigid-on-rigid overlap | 4 |
| R-OVR-04 | Overlap | Enveloping overlap | 4 |
| R-OVR-05 | Overlap | Overlap at tee boundaries | 2/3 |
| R-OVR-06 | Overlap | Overlap creates negative pipe | 2 |
| R-BRN-01 | Branch | Branch bore > header bore | 4 |
| R-BRN-02 | Branch | Olet size ratio check | 3/4 |
| R-BRN-03 | Branch | Branch direction = header direction | 4 |
| R-BRN-04 | Branch | Branch perpendicularity | 3/4 |
| R-BRN-05 | Branch | Branch chain continuation | 4 |
| R-SPA-01 | Spatial | Elevation consistency | 2/3 |
| R-SPA-02 | Spatial | Coordinate snapping on shared axes | 1/2/4 |
| R-SPA-03 | Spatial | Gravity-aware support placement | 3 |
| R-SPA-04 | Spatial | Collinear pipe merge suggestion | Info |
| R-SPA-05 | Spatial | Suspicious placeholder coordinates | 3 |
| R-DAT-01 | Data Quality | Coordinate precision consistency | 3 |
| R-DAT-02 | Data Quality | Suspicious round numbers | 3 |
| R-DAT-03 | Data Quality | Material continuity | 3 |
| R-DAT-04 | Data Quality | Design condition continuity | 3 |
| R-DAT-05 | Data Quality | CA8 weight scope | 3 |
| R-DAT-06 | Data Quality | SKEY prefix mismatch | 3 |
| R-AGG-01 | Aggregate | Total pipe length sanity | 3/4 |
| R-AGG-02 | Aggregate | Minimum tangent between bends | 3 |
| R-AGG-03 | Aggregate | Route closure check | 3/4 |
| R-AGG-04 | Aggregate | Dead-end detection | 3 |
| R-AGG-05 | Aggregate | Flange pair completeness | 3 |
| R-AGG-06 | Aggregate | Component count sanity | 3 |

---

*End of Smart PCF Fixer — Chain Walker Rule Engine v1.0*
