# WORK INSTRUCTION — Smart PCF Fixer Add-On

## Document ID: WI-PCF-SMARTFIX-001 Rev.0
## For: AI Coding Agent
## References:
##   - PCF Syntax Master v1.2 (PCF_SYNTAX_MASTER_v1.2.md)
##   - Smart PCF Fixer Rules v1.0 (SMART_PCF_FIXER_RULES.md)
##   - PCF Validator App WI (WI_PCF_VALIDATOR_AND_FIXER.md)

---

## 0. SCOPE AND CONTEXT

This Work Instruction directs an AI agent to implement the **Smart PCF Fixer** as an add-on module to the existing PCF Validator and Fixer web application.

### What Already Exists

The base app (per WI-PCF-VALIDATOR-001) provides:

- PCF text import and parsing
- Excel/CSV import with fuzzy header matching
- Data Table display with 42 columns
- Config tab with all settings (decimals, aliases, BRLEN database, etc.)
- Debug tab with log and tally
- Output tab with PCF preview and export
- Basic validation (V1–V20)
- Basic error fixing (Steps 1–13: identifiers, bore conversion, coordinate calc, CP/BP, BRLEN, pointers, MESSAGE-SQUARE)

### What This Add-On Provides

A **[Smart Fix]** button that, when clicked:

1. Builds a connectivity graph from the Data Table.
2. Walks element chains carrying travel context.
3. Runs 57 rules (R-GEO through R-AGG) from the Smart Fixer Rules.
4. Populates the **"Fixing Action"** column with previews of proposed fixes.
5. User reviews proposed fixes in the Data Table.
6. User clicks **[Apply Fixes]** to execute approved Tier 1 + Tier 2 fixes.
7. Data Table updates with corrected values (highlighted cells).
8. PCF regenerates from the updated Data Table.

**This add-on does NOT replace the existing fixer steps.** It inserts AFTER Step 4 (bore conversion) and BEFORE Step 5 (coordinate recalculation) in the processing pipeline.

---

## 1. INTEGRATION POINT

### 1.1 Pipeline Position

```
EXISTING PIPELINE:
  Step 1:  Parse MESSAGE-SQUARE
  Step 2:  Cross-verify MSG vs Component Data
  Step 3:  Fill missing identifiers
  Step 4:  Bore unit conversion
                                          ┌─────────────────────────┐
  ──────── [Smart Fix] button click ────► │  Step 4A: Build Graph   │
                                          │  Step 4B: Walk Chains   │
                                          │  Step 4C: Run 57 Rules  │
                                          │  Step 4D: Populate       │
                                          │    Fixing Action column  │
                                          │  Step 4E: User Reviews   │
                                          │  Step 4F: [Apply Fixes]  │
                                          │    Execute Tier 1+2      │
                                          └─────────┬───────────────┘
                                                    │
  Step 5:  Bi-directional coordinate recalc ◄───────┘  (re-run after fixes)
  Step 6:  CP/BP calculation
  Step 7:  BRLEN fallback
  Step 8:  Branch bore fallback
  Step 9:  SUPPORT mapping
  Step 10: Pointer calculation
  Step 11: MESSAGE-SQUARE regeneration
  Step 12: Validation V1–V20
  Step 13: Tally
```

### 1.2 UI Integration

```
EXISTING HEADER BAR:
  [Import PCF ▼]  [Import Excel/CSV ▼]     App Title

UPDATED HEADER BAR:
  [Import PCF ▼]  [Import Excel/CSV ▼]     App Title

EXISTING STATUS BAR:
  "Ready"   [Export Data Table ↓]  [Export PCF ↓]  [Run Validator ▶]

UPDATED STATUS BAR:
  "Ready"   [Export Data Table ↓]  [Export PCF ↓]  [Run Validator ▶]  [Smart Fix 🔧]  [Apply Fixes ✓]
                                                                       ^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^^
                                                                       NEW              NEW (disabled
                                                                                        until Smart Fix
                                                                                        has run)
```

### 1.3 Button States

| App State | [Smart Fix] | [Apply Fixes] |
|-----------|------------|---------------|
| No data loaded | Disabled | Disabled |
| Data Table populated (no smart fix run) | **Enabled** | Disabled |
| Smart Fix running | Disabled (spinner) | Disabled |
| Smart Fix complete (Fixing Actions populated) | Enabled (re-run) | **Enabled** |
| Apply Fixes running | Disabled | Disabled (spinner) |
| Fixes applied | **Enabled** (re-run) | Disabled |

---

## 2. NEW STATE ADDITIONS

Add these to the existing `useReducer` state:

```javascript
// Add to initialState:
{
  // ...existing state...

  // Smart Fixer state
  smartFix: {
    status: "idle",              // "idle" | "running" | "previewing" | "applying" | "applied"
    graph: null,                 // Connectivity graph object
    chains: [],                  // Array of walked chain results
    proposedFixes: [],           // Array of { ruleId, tier, rowIndex, action, description }
    appliedFixes: [],            // Array of applied fix records (for undo/audit)
    chainSummary: null,          // { chainCount, elementsWalked, orphans, ... }
    fixSummary: null,            // { tier1: n, tier2: n, tier3: n, tier4: n, inserted: n, ... }
  }
}
```

Add `fixingAction` field to each Data Table row object:

```javascript
// Extend existing row schema:
{
  // ...existing fields...
  fixingAction: null,            // String: human-readable fix preview (or null)
  fixingActionTier: null,        // Number: 1, 2, 3, or 4 (or null)
  fixingActionRuleId: null,      // String: "R-GAP-02", "R-OVR-01", etc. (or null)
}
```

---

## 3. NEW MODULES TO CREATE

### 3.1 File Structure

Create these as separate functions/sections within the existing single-file app, or as clearly demarcated code regions:

```
NEW CODE REGIONS (within existing .jsx):

  // ══════════════════════════════════════════════
  // SMART FIXER — CHAIN WALKER ENGINE
  // ══════════════════════════════════════════════

  Region A: Vector Math Utilities        (~40 lines)
  Region B: Connectivity Graph Builder   (~120 lines)
  Region C: Chain Walker                 (~200 lines)
  Region D: Element Axis Detector        (~60 lines)
  Region E: Gap/Overlap Analyzer         (~180 lines)
  Region F: Rule Engine (57 rules)       (~400 lines)
  Region G: Fix Application Engine       (~150 lines)
  Region H: Fixing Action Descriptor     (~80 lines)
  Region I: Smart Fix Orchestrator       (~60 lines)
  Region J: UI Components (button, etc.) (~100 lines)

  Estimated total: ~1,400 lines added
```

---

## 4. REGION A: VECTOR MATH UTILITIES

```javascript
// ══════════════════════════════════════════════
// SMART FIXER — VECTOR MATH
// ══════════════════════════════════════════════

const vec = {
  sub:   (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  add:   (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  scale: (v, s) => ({ x: v.x * s, y: v.y * s, z: v.z * s }),
  dot:   (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),
  mag:   (v) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z),
  normalize: (v) => {
    const m = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return m > 0 ? { x: v.x / m, y: v.y / m, z: v.z / m } : { x: 0, y: 0, z: 0 };
  },
  dist:  (a, b) => Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2),
  mid:   (a, b) => ({ x: (a.x+b.x)/2, y: (a.y+b.y)/2, z: (a.z+b.z)/2 }),
  approxEqual: (a, b, tol = 1.0) =>
    Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.z - b.z) <= tol,
  isZero: (v) => v.x === 0 && v.y === 0 && v.z === 0,
};
```

---

## 5. REGION B: CONNECTIVITY GRAPH BUILDER

### 5.1 Algorithm

```javascript
function buildConnectivityGraph(dataTable, config) {
  const tolerance = config.smartFixer?.connectionTolerance ?? 25.0;
  const gridSnap = config.smartFixer?.gridSnapResolution ?? 1.0;

  // Snap coordinate to grid for indexing
  const snap = (coord) => ({
    x: Math.round(coord.x / gridSnap) * gridSnap,
    y: Math.round(coord.y / gridSnap) * gridSnap,
    z: Math.round(coord.z / gridSnap) * gridSnap,
  });
  const coordKey = (c) => `${c.x},${c.y},${c.z}`;

  // Step 1: Classify connection points per component
  const components = dataTable
    .filter(row => row.type && !["ISOGEN-FILES","UNITS-BORE","UNITS-CO-ORDS",
      "UNITS-WEIGHT","UNITS-BOLT-DIA","UNITS-BOLT-LENGTH",
      "PIPELINE-REFERENCE","MESSAGE-SQUARE"].includes(row.type.toUpperCase()))
    .map(row => ({
      ...row,
      entryPoint: getEntryPoint(row),
      exitPoint: getExitPoint(row),
      branchExitPoint: getBranchExitPoint(row), // null except for TEE
    }));

  // Step 2: Build entry-point spatial index
  const entryIndex = new Map();
  for (const comp of components) {
    if (comp.entryPoint && !vec.isZero(comp.entryPoint)) {
      const key = coordKey(snap(comp.entryPoint));
      if (!entryIndex.has(key)) entryIndex.set(key, []);
      entryIndex.get(key).push(comp);
    }
  }

  // Step 3: Match exits to entries (build edges)
  const edges = new Map();      // comp._rowIndex → next comp
  const branchEdges = new Map(); // comp._rowIndex → branch start comp (TEE only)
  const hasIncoming = new Set(); // row indices that have an incoming connection

  for (const comp of components) {
    if (!comp.exitPoint || vec.isZero(comp.exitPoint)) continue;

    const match = findNearestEntry(comp.exitPoint, entryIndex, snap, coordKey, tolerance, comp._rowIndex);
    if (match) {
      edges.set(comp._rowIndex, match);
      hasIncoming.add(match._rowIndex);
    }

    // Branch edge for TEE
    if (comp.branchExitPoint && !vec.isZero(comp.branchExitPoint)) {
      const brMatch = findNearestEntry(comp.branchExitPoint, entryIndex, snap, coordKey, tolerance, comp._rowIndex);
      if (brMatch) {
        branchEdges.set(comp._rowIndex, brMatch);
        hasIncoming.add(brMatch._rowIndex);
      }
    }
  }

  // Step 4: Find chain terminals (no incoming connection)
  const terminals = components.filter(c =>
    !hasIncoming.has(c._rowIndex) && c.type !== "SUPPORT"
  );

  // Step 5: Find orphans (will be detected after walking)
  // (Deferred — orphans = components not visited by any chain walk)

  return {
    components,
    edges,         // rowIndex → next component
    branchEdges,   // rowIndex → branch start component
    terminals,
    entryIndex,
  };
}
```

### 5.2 Helper Functions

```javascript
function getEntryPoint(row) {
  const t = (row.type || "").toUpperCase();
  if (t === "SUPPORT") return row.supportCoor || null;
  if (t === "OLET")    return row.cp || null;  // OLET enters at CP
  return row.ep1 || null;
}

function getExitPoint(row) {
  const t = (row.type || "").toUpperCase();
  if (t === "SUPPORT") return null;            // SUPPORT has no exit
  if (t === "OLET")    return row.bp || null;  // OLET exits at BP
  return row.ep2 || null;
}

function getBranchExitPoint(row) {
  const t = (row.type || "").toUpperCase();
  if (t === "TEE") return row.bp || null;      // TEE branches at BP
  return null;
}

function findNearestEntry(exitCoord, entryIndex, snap, coordKey, tolerance, excludeRowIndex) {
  // Search in snapped grid neighborhood
  const snapped = snap(exitCoord);
  const key = coordKey(snapped);

  // Direct grid hit
  const candidates = entryIndex.get(key) || [];
  let best = null;
  let bestDist = tolerance + 1;

  for (const cand of candidates) {
    if (cand._rowIndex === excludeRowIndex) continue;
    const d = vec.dist(exitCoord, cand.entryPoint);
    if (d < bestDist) { bestDist = d; best = cand; }
  }

  // Also search adjacent grid cells (±1 step) for near-misses
  if (!best) {
    const step = snap({ x: 1, y: 1, z: 1 }).x; // gridSnap value
    for (let dx = -step; dx <= step; dx += step) {
      for (let dy = -step; dy <= step; dy += step) {
        for (let dz = -step; dz <= step; dz += step) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const nk = coordKey({
            x: snapped.x + dx, y: snapped.y + dy, z: snapped.z + dz
          });
          for (const cand of (entryIndex.get(nk) || [])) {
            if (cand._rowIndex === excludeRowIndex) continue;
            const d = vec.dist(exitCoord, cand.entryPoint);
            if (d < bestDist) { bestDist = d; best = cand; }
          }
        }
      }
    }
  }

  return best;
}
```

---

## 6. REGION C: CHAIN WALKER

### 6.1 Main Walk Function

```javascript
function walkAllChains(graph, config, log) {
  const visited = new Set();
  const allChains = [];

  // Walk from each terminal
  for (const terminal of graph.terminals) {
    if (visited.has(terminal._rowIndex)) continue;

    const context = createInitialContext(terminal, allChains.length);
    const chain = walkChain(terminal, graph, context, visited, config, log);
    allChains.push(chain);
  }

  // Detect orphans
  const orphans = graph.components.filter(c =>
    !visited.has(c._rowIndex) && c.type !== "SUPPORT"
  );
  for (const orphan of orphans) {
    log.push({
      type: "Error", ruleId: "R-TOP-02", tier: 4,
      row: orphan._rowIndex,
      message: `Orphan: ${orphan.type} (Row ${orphan._rowIndex}) not connected to any chain.`
    });
  }

  return { chains: allChains, orphans };
}

function createInitialContext(startElement, chainIndex) {
  return {
    travelAxis: null,
    travelDirection: null,
    currentBore: startElement.bore || 0,
    currentMaterial: startElement.ca?.[3] || "",
    currentPressure: startElement.ca?.[1] || "",
    currentTemp: startElement.ca?.[2] || "",
    chainId: `Chain-${chainIndex + 1}`,
    cumulativeVector: { x: 0, y: 0, z: 0 },
    pipeLengthSum: 0,
    lastFittingType: null,
    elevation: startElement.ep1?.z || 0,
    depth: 0,
    pipeSinceLastBend: Infinity, // large initial value
  };
}
```

### 6.2 Single Chain Walk

```javascript
function walkChain(startElement, graph, context, visited, config, log) {
  const chain = [];
  let current = startElement;
  let prevElement = null;

  while (current && !visited.has(current._rowIndex)) {
    visited.add(current._rowIndex);
    const type = (current.type || "").toUpperCase();

    // Skip SUPPORTs in the chain walk (they are point elements, not flow elements)
    // But still validate them
    if (type === "SUPPORT") {
      runSupportRules(current, chain, context, config, log);
      current = graph.edges.get(current._rowIndex) || null;
      continue;
    }

    // ─── A. DETECT ELEMENT AXIS ───
    const [elemAxis, elemDir] = detectElementAxis(current, config);

    // ─── B. RUN ELEMENT-LEVEL RULES ───
    runElementRules(current, context, prevElement, elemAxis, elemDir, config, log);

    // ─── C. UPDATE CONTEXT ───
    if (elemAxis) {
      context.travelAxis = elemAxis;
      context.travelDirection = elemDir;
    }
    if (current.bore) context.currentBore = current.bore;
    if (current.ca?.[3]) context.currentMaterial = current.ca[3];
    const elemVec = getElementVector(current);
    context.cumulativeVector = vec.add(context.cumulativeVector, elemVec);
    if (type === "PIPE") {
      const len = vec.mag(elemVec);
      context.pipeLengthSum += len;
      context.pipeSinceLastBend += len;
    }
    if (type === "BEND") context.pipeSinceLastBend = 0;
    if (!["PIPE", "SUPPORT"].includes(type)) context.lastFittingType = type;

    // ─── D. FIND NEXT ELEMENT AND ANALYZE GAP ───
    const nextElement = graph.edges.get(current._rowIndex) || null;
    let gapVector = null;
    let fixAction = null;

    if (nextElement) {
      const exitPt = getExitPoint(current);
      const entryPt = getEntryPoint(nextElement);
      if (exitPt && entryPt) {
        gapVector = vec.sub(entryPt, exitPt);
        fixAction = analyzeGap(gapVector, context, current, nextElement, config, log);
      }
    }

    // ─── E. RECORD CHAIN LINK ───
    chain.push({
      element: current,
      elemAxis,
      elemDir,
      travelAxis: context.travelAxis,
      travelDirection: context.travelDirection,
      gapToNext: gapVector,
      fixAction,
      nextElement,
      branchChain: null,
    });

    // ─── F. BRANCH HANDLING (TEE) ───
    if (type === "TEE") {
      const branchStart = graph.branchEdges.get(current._rowIndex);
      if (branchStart && !visited.has(branchStart._rowIndex)) {
        const branchCtx = {
          ...structuredClone(context),
          travelAxis: detectBranchAxis(current),
          travelDirection: detectBranchDirection(current),
          currentBore: current.branchBore || current.bore,
          depth: context.depth + 1,
          chainId: `${context.chainId}.B`,
          pipeLengthSum: 0,
          cumulativeVector: { x: 0, y: 0, z: 0 },
          pipeSinceLastBend: Infinity,
        };
        const branchChain = walkChain(branchStart, graph, branchCtx, visited, config, log);
        chain[chain.length - 1].branchChain = branchChain;
      }
    }

    // ─── G. ADVANCE ───
    prevElement = current;
    current = nextElement;
  }

  // ─── H. POST-WALK AGGREGATE RULES ───
  runAggregateRules(chain, context, config, log);

  return chain;
}
```

---

## 7. REGION D: ELEMENT AXIS DETECTOR

```javascript
function detectElementAxis(element, config) {
  const threshold = config.smartFixer?.offAxisThreshold ?? 0.5;
  const type = (element.type || "").toUpperCase();

  if (type === "SUPPORT" || type === "OLET") return [null, null];

  const ep1 = element.ep1;
  const ep2 = element.ep2;
  if (!ep1 || !ep2) return [null, null];

  const dx = ep2.x - ep1.x;
  const dy = ep2.y - ep1.y;
  const dz = ep2.z - ep1.z;

  const axes = [];
  if (Math.abs(dx) > threshold) axes.push(["X", dx]);
  if (Math.abs(dy) > threshold) axes.push(["Y", dy]);
  if (Math.abs(dz) > threshold) axes.push(["Z", dz]);

  if (axes.length === 0) return [null, null];

  if (axes.length === 1) {
    return [axes[0][0], axes[0][1] > 0 ? 1 : -1];
  }

  // Multi-axis: for BEND this is expected (return outgoing axis)
  if (type === "BEND") {
    // Outgoing axis = the axis with the EP2-dominant delta
    // that differs from the incoming axis
    const sorted = [...axes].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    return [sorted[0][0], sorted[0][1] > 0 ? 1 : -1];
  }

  // For straight elements (PIPE, FLANGE, VALVE, REDUCER): pick dominant axis
  const dominant = axes.reduce((a, b) => Math.abs(a[1]) > Math.abs(b[1]) ? a : b);
  return [dominant[0], dominant[1] > 0 ? 1 : -1];
}

function detectBranchAxis(teeElement) {
  if (!teeElement.bp || !teeElement.cp) return null;
  const bv = vec.sub(teeElement.bp, teeElement.cp);
  const axes = [["X", Math.abs(bv.x)], ["Y", Math.abs(bv.y)], ["Z", Math.abs(bv.z)]];
  const dominant = axes.reduce((a, b) => a[1] > b[1] ? a : b);
  return dominant[0];
}

function detectBranchDirection(teeElement) {
  if (!teeElement.bp || !teeElement.cp) return null;
  const bv = vec.sub(teeElement.bp, teeElement.cp);
  const axis = detectBranchAxis(teeElement);
  if (!axis) return null;
  return bv[axis.toLowerCase()] > 0 ? 1 : -1;
}

function getElementVector(element) {
  const type = (element.type || "").toUpperCase();
  if (type === "SUPPORT" || type === "OLET") return { x: 0, y: 0, z: 0 };
  if (!element.ep1 || !element.ep2) return { x: 0, y: 0, z: 0 };
  return vec.sub(element.ep2, element.ep1);
}
```

---

## 8. REGION E: GAP/OVERLAP ANALYZER

```javascript
function analyzeGap(gapVector, context, current, next, config, log) {
  const cfg = config.smartFixer || {};
  const negligible = cfg.negligibleGap ?? 1.0;
  const autoFillMax = cfg.autoFillMaxGap ?? 25.0;
  const reviewMax = cfg.reviewGapMax ?? 100.0;
  const autoTrimMax = cfg.autoTrimMaxOverlap ?? 25.0;
  const silentSnap = cfg.silentSnapThreshold ?? 2.0;
  const warnSnap = cfg.warnSnapThreshold ?? 10.0;

  const gapMag = vec.mag(gapVector);

  // ─── R-GAP-01: Negligible gap ───
  if (gapMag < negligible) {
    if (gapMag > 0.1) {
      return { type: "SNAP", ruleId: "R-GAP-01", tier: 1,
        description: `SNAP [R-GAP-01]: Close ${gapMag.toFixed(2)}mm micro-gap by snapping endpoints.`,
        gapVector, current, next };
    }
    return null; // Perfect connection
  }

  // Decompose gap into axes
  const axes = decomposeGap(gapVector, cfg.offAxisThreshold ?? 0.5);
  const alongTravel = axes.find(a => a.axis === context.travelAxis);
  const lateral = axes.filter(a => a.axis !== context.travelAxis);
  const totalLateral = lateral.reduce((s, a) => s + Math.abs(a.delta), 0);
  const alongDelta = alongTravel ? alongTravel.delta : 0;
  const isOverlap = alongDelta * context.travelDirection < 0; // negative gap = overlap

  // ─── OVERLAP PATH ───
  if (isOverlap && axes.length === 1 && axes[0].axis === context.travelAxis) {
    const overlapAmt = Math.abs(alongDelta);
    return analyzeOverlap(overlapAmt, context, current, next, cfg, log);
  }

  // ─── GAP PATH ───

  // Single-axis gap along travel
  if (axes.length === 1 && axes[0].axis === context.travelAxis) {
    const gapAmt = Math.abs(alongDelta);
    const dir = directionLabel(context.travelAxis, context.travelDirection);

    if (gapAmt <= autoFillMax) {
      return { type: "INSERT", ruleId: "R-GAP-02", tier: 2,
        description: buildInsertDescription(gapAmt, dir, context, current),
        gapAmount: gapAmt, fillAxis: context.travelAxis, fillDir: context.travelDirection,
        current, next };
    }
    if (gapAmt <= reviewMax) {
      return { type: "REVIEW", ruleId: "R-GAP-03", tier: 3,
        description: `REVIEW [R-GAP-03]: ${gapAmt.toFixed(1)}mm gap along ${dir}. Exceeds ${autoFillMax}mm auto-fill threshold. Manual review.`,
        current, next };
    }
    return { type: "ERROR", ruleId: "R-GAP-03", tier: 4,
      description: `ERROR [R-GAP-03]: ${gapAmt.toFixed(1)}mm gap along ${dir}. Major gap — likely missing component(s).`,
      current, next };
  }

  // Single-axis gap on NON-travel axis (lateral)
  if (axes.length === 1 && axes[0].axis !== context.travelAxis) {
    const latAmt = Math.abs(axes[0].delta);
    if (latAmt < silentSnap) {
      return { type: "SNAP", ruleId: "R-GAP-04", tier: 2,
        description: `SNAP [R-GAP-04]: Lateral offset ${latAmt.toFixed(1)}mm on ${axes[0].axis}-axis (travel is ${context.travelAxis}). Snapping to align.`,
        current, next };
    }
    return { type: "ERROR", ruleId: "R-GAP-04", tier: 4,
      description: `ERROR [R-GAP-04]: Lateral offset ${latAmt.toFixed(1)}mm on ${axes[0].axis}-axis. Pipe has shifted sideways. Manual review.`,
      current, next };
  }

  // Multi-axis gap with negligible lateral
  if (axes.length >= 2 && totalLateral < silentSnap && Math.abs(alongDelta) <= autoFillMax) {
    const gapAmt = Math.abs(alongDelta);
    const dir = directionLabel(context.travelAxis, context.travelDirection);
    return { type: "INSERT", ruleId: "R-GAP-05", tier: 2,
      description: `INSERT [R-GAP-05]: Multi-axis gap (axial=${gapAmt.toFixed(1)}mm, lateral=${totalLateral.toFixed(1)}mm). Lateral snapped, axial filled with ${gapAmt.toFixed(1)}mm pipe ${dir}.`,
      gapAmount: gapAmt, fillAxis: context.travelAxis, fillDir: context.travelDirection,
      current, next };
  }

  // Multi-axis gap with significant components
  return { type: "ERROR", ruleId: "R-GAP-06", tier: 4,
    description: `ERROR [R-GAP-06]: Multi-axis gap (${formatGapAxes(axes)}). Cannot auto-fill. Rigorous manual review required.`,
    current, next };
}

function analyzeOverlap(overlapAmt, context, current, next, cfg, log) {
  const autoTrimMax = cfg.autoTrimMaxOverlap ?? 25.0;
  const currType = (current.type || "").toUpperCase();
  const nextType = (next.type || "").toUpperCase();
  const dir = directionLabel(context.travelAxis, context.travelDirection);

  // R-OVR-03: Rigid-on-rigid
  if (currType !== "PIPE" && nextType !== "PIPE") {
    return { type: "ERROR", ruleId: "R-OVR-03", tier: 4,
      description: `ERROR [R-OVR-03]: ${currType} overlaps ${nextType} by ${overlapAmt.toFixed(1)}mm. Both are rigid fittings. Cannot auto-trim.`,
      current, next };
  }

  // R-OVR-01: Current is PIPE — trim it
  if (currType === "PIPE" && overlapAmt <= autoTrimMax) {
    return { type: "TRIM", ruleId: "R-OVR-01", tier: 2,
      description: buildTrimDescription(overlapAmt, dir, current, next, "current"),
      trimAmount: overlapAmt, trimTarget: "current",
      current, next };
  }

  // R-OVR-02: Current is rigid, next is PIPE — trim next
  if (currType !== "PIPE" && nextType === "PIPE" && overlapAmt <= autoTrimMax) {
    return { type: "TRIM", ruleId: "R-OVR-02", tier: 2,
      description: buildTrimDescription(overlapAmt, dir, current, next, "next"),
      trimAmount: overlapAmt, trimTarget: "next",
      current, next };
  }

  // Large overlap
  return { type: "REVIEW", ruleId: "R-OVR-01", tier: 3,
    description: `REVIEW [R-OVR-01]: ${overlapAmt.toFixed(1)}mm overlap between ${currType} (Row ${current._rowIndex}) and ${nextType} (Row ${next._rowIndex}). Exceeds ${autoTrimMax}mm auto-trim threshold.`,
    current, next };
}

// ─── Gap decomposition ───
function decomposeGap(gapVec, threshold) {
  const result = [];
  if (Math.abs(gapVec.x) > threshold) result.push({ axis: "X", delta: gapVec.x });
  if (Math.abs(gapVec.y) > threshold) result.push({ axis: "Y", delta: gapVec.y });
  if (Math.abs(gapVec.z) > threshold) result.push({ axis: "Z", delta: gapVec.z });
  return result;
}

function directionLabel(axis, dir) {
  const map = { X: ["+X(East)", "-X(West)"], Y: ["+Y(North)", "-Y(South)"], Z: ["+Z(Up)", "-Z(Down)"] };
  return axis ? (dir > 0 ? map[axis][0] : map[axis][1]) : "unknown";
}

function formatGapAxes(axes) {
  return axes.map(a => `${a.axis}=${a.delta.toFixed(1)}mm`).join(", ");
}
```

---

## 9. REGION F: RULE ENGINE

The rule engine is organized as three runner functions called at different points in the walk.

### 9.1 Element-Level Rules (called per element)

```javascript
function runElementRules(element, context, prevElement, elemAxis, elemDir, config, log) {
  const type = (element.type || "").toUpperCase();
  const cfg = config.smartFixer || {};
  const ri = element._rowIndex;

  // R-GEO-01: Micro-element
  if (type === "PIPE") {
    const len = vec.mag(getElementVector(element));
    if (len < (cfg.microPipeThreshold ?? 6.0) && len > 0) {
      log.push({ type: "Fix", ruleId: "R-GEO-01", tier: 1, row: ri,
        message: `DELETE [R-GEO-01]: Micro-pipe ${len.toFixed(1)}mm < ${cfg.microPipeThreshold ?? 6}mm threshold.` });
      element._proposedFix = { type: "DELETE", ruleId: "R-GEO-01", tier: 1 };
    }
  }

  // R-GEO-02: Bore continuity
  if (prevElement && element.bore !== context.currentBore) {
    const prevType = (prevElement.type || "").toUpperCase();
    if (!prevType.includes("REDUCER")) {
      log.push({ type: "Error", ruleId: "R-GEO-02", tier: 4, row: ri,
        message: `ERROR [R-GEO-02]: Bore changes ${context.currentBore}→${element.bore} without reducer.` });
    }
  }

  // R-GEO-03: Single-axis rule for straight elements
  if (["PIPE", "FLANGE", "VALVE"].includes(type) && type !== "BEND") {
    const ev = getElementVector(element);
    const nonZero = [["X", ev.x], ["Y", ev.y], ["Z", ev.z]].filter(([_, d]) => Math.abs(d) > 0.5);
    if (nonZero.length > 1) {
      const dominant = nonZero.reduce((a, b) => Math.abs(a[1]) > Math.abs(b[1]) ? a : b);
      const minorTotal = nonZero.filter(a => a[0] !== dominant[0]).reduce((s, a) => s + Math.abs(a[1]), 0);
      if (minorTotal < (cfg.diagonalMinorThreshold ?? 2.0)) {
        log.push({ type: "Fix", ruleId: "R-GEO-03", tier: 2, row: ri,
          message: `SNAP [R-GEO-03]: ${type} off-axis drift ${minorTotal.toFixed(1)}mm. Snapping to pure ${dominant[0]}-axis.` });
        element._proposedFix = { type: "SNAP_AXIS", ruleId: "R-GEO-03", tier: 2, dominantAxis: dominant[0] };
      } else {
        log.push({ type: "Error", ruleId: "R-GEO-03", tier: 4, row: ri,
          message: `ERROR [R-GEO-03]: ${type} runs diagonally (${nonZero.map(([a,d]) => `${a}=${d.toFixed(1)}`).join(", ")}). Must align to single axis.` });
      }
    }
  }

  // R-GEO-07: Zero-length element
  if (!["SUPPORT", "OLET"].includes(type) && element.ep1 && element.ep2) {
    if (vec.approxEqual(element.ep1, element.ep2, 0.1)) {
      log.push({ type: "Error", ruleId: "R-GEO-07", tier: 4, row: ri,
        message: `ERROR [R-GEO-07]: ${type} has zero length (EP1 ≈ EP2).` });
    }
  }

  // R-CHN-01: Axis change without bend
  if (context.travelAxis && elemAxis && elemAxis !== context.travelAxis) {
    if (!["BEND", "TEE"].includes(type)) {
      log.push({ type: "Error", ruleId: "R-CHN-01", tier: 4, row: ri,
        message: `ERROR [R-CHN-01]: Axis changed ${context.travelAxis}→${elemAxis} at ${type}. Missing BEND?` });
    }
  }

  // R-CHN-02: Fold-back
  if (context.travelAxis && elemAxis === context.travelAxis && elemDir !== context.travelDirection) {
    if (type === "PIPE") {
      const foldLen = vec.mag(getElementVector(element));
      if (foldLen < (cfg.autoDeleteFoldbackMax ?? 25.0)) {
        log.push({ type: "Fix", ruleId: "R-CHN-02", tier: 2, row: ri,
          message: `DELETE [R-CHN-02]: Fold-back pipe ${foldLen.toFixed(1)}mm on ${elemAxis}-axis.` });
        element._proposedFix = { type: "DELETE", ruleId: "R-CHN-02", tier: 2 };
      } else {
        log.push({ type: "Error", ruleId: "R-CHN-02", tier: 4, row: ri,
          message: `ERROR [R-CHN-02]: Fold-back ${foldLen.toFixed(1)}mm on ${elemAxis}-axis. Too large to auto-delete.` });
      }
    } else if (type !== "BEND") {
      log.push({ type: "Error", ruleId: "R-CHN-02", tier: 4, row: ri,
        message: `ERROR [R-CHN-02]: ${type} reverses direction on ${elemAxis}-axis.` });
    }
  }

  // R-CHN-03: Elbow-elbow proximity
  if (type === "BEND" && context.lastFittingType === "BEND") {
    if (context.pipeSinceLastBend < (cfg.minTangentMultiplier ?? 1.0) * (element.bore || 0) * 0.0254) {
      // Using OD approximation; for real impl use config.pipe_OD[bore]
      log.push({ type: "Warning", ruleId: "R-CHN-03", tier: 3, row: ri,
        message: `WARNING [R-CHN-03]: Only ${context.pipeSinceLastBend.toFixed(0)}mm pipe between bends. Short tangent.` });
    }
  }

  // R-CHN-06: Shared-axis coordinate snapping
  if (prevElement && context.travelAxis && elemAxis === context.travelAxis) {
    const exitPt = getExitPoint(prevElement);
    const entryPt = getEntryPoint(element);
    if (exitPt && entryPt) {
      const nonTravelAxes = ["X", "Y", "Z"].filter(a => a !== context.travelAxis);
      for (const axis of nonTravelAxes) {
        const key = axis.toLowerCase();
        const drift = Math.abs(entryPt[key] - exitPt[key]);
        if (drift > 0.1 && drift < (cfg.silentSnapThreshold ?? 2.0)) {
          log.push({ type: "Fix", ruleId: "R-CHN-06", tier: 1, row: ri,
            message: `SNAP [R-CHN-06]: ${axis} drifted ${drift.toFixed(1)}mm. Silent snap.` });
        } else if (drift >= (cfg.silentSnapThreshold ?? 2.0) && drift < (cfg.warnSnapThreshold ?? 10.0)) {
          log.push({ type: "Fix", ruleId: "R-CHN-06", tier: 2, row: ri,
            message: `SNAP [R-CHN-06]: ${axis} drifted ${drift.toFixed(1)}mm. Snap with warning.` });
        } else if (drift >= (cfg.warnSnapThreshold ?? 10.0)) {
          log.push({ type: "Error", ruleId: "R-CHN-06", tier: 4, row: ri,
            message: `ERROR [R-CHN-06]: ${axis} offset ${drift.toFixed(1)}mm. Too large to snap.` });
        }
      }
    }
  }

  // R-DAT-03: Material continuity
  if (context.currentMaterial && element.ca?.[3] && element.ca[3] !== context.currentMaterial) {
    const prevType = prevElement ? (prevElement.type || "").toUpperCase() : "";
    if (!["FLANGE", "VALVE"].includes(prevType)) {
      log.push({ type: "Warning", ruleId: "R-DAT-03", tier: 3, row: ri,
        message: `WARNING [R-DAT-03]: Material changes ${context.currentMaterial}→${element.ca[3]} without joint.` });
    }
  }

  // R-BRN-01: Branch bore > header bore (for TEE)
  if (type === "TEE" && element.branchBore > element.bore) {
    log.push({ type: "Error", ruleId: "R-BRN-01", tier: 4, row: ri,
      message: `ERROR [R-BRN-01]: Branch bore (${element.branchBore}) > header bore (${element.bore}).` });
  }

  // R-BRN-04: Branch perpendicularity (for TEE)
  if (type === "TEE" && element.ep1 && element.ep2 && element.cp && element.bp) {
    const headerVec = vec.sub(element.ep2, element.ep1);
    const branchVec = vec.sub(element.bp, element.cp);
    const hMag = vec.mag(headerVec);
    const bMag = vec.mag(branchVec);
    if (hMag > 0 && bMag > 0) {
      const dotProd = Math.abs(vec.dot(headerVec, branchVec));
      const cosAngle = dotProd / (hMag * bMag);
      const angleDeg = Math.acos(Math.min(cosAngle, 1.0)) * 180 / Math.PI;
      const offPerp = Math.abs(90 - angleDeg);
      if (offPerp > (cfg.branchPerpendicularityError ?? 15.0)) {
        log.push({ type: "Error", ruleId: "R-BRN-04", tier: 4, row: ri,
          message: `ERROR [R-BRN-04]: Branch ${offPerp.toFixed(1)}° from perpendicular.` });
      } else if (offPerp > (cfg.branchPerpendicularityWarn ?? 5.0)) {
        log.push({ type: "Warning", ruleId: "R-BRN-04", tier: 3, row: ri,
          message: `WARNING [R-BRN-04]: Branch ${offPerp.toFixed(1)}° from perpendicular.` });
      }
    }
  }

  // R-DAT-06: SKEY prefix consistency
  if (element.skey) {
    const prefixMap = { FLANGE: "FL", VALVE: "V", BEND: "BE", TEE: "TE", OLET: "OL" };
    const expected = prefixMap[type];
    if (expected && !element.skey.startsWith(expected)) {
      log.push({ type: "Warning", ruleId: "R-DAT-06", tier: 3, row: ri,
        message: `WARNING [R-DAT-06]: SKEY '${element.skey}' prefix mismatch for ${type} (expected '${expected}...').` });
    }
  }
}
```

### 9.2 Support-Specific Rules

```javascript
function runSupportRules(support, chain, context, config, log) {
  const ri = support._rowIndex;
  const coor = support.supportCoor;
  if (!coor) return;

  // R-TOP-06: Support on-pipe validation
  // Find nearest pipe in chain and check perpendicular distance
  let minDist = Infinity;
  for (const link of chain) {
    if ((link.element.type || "").toUpperCase() !== "PIPE") continue;
    const ep1 = link.element.ep1;
    const ep2 = link.element.ep2;
    if (!ep1 || !ep2) continue;

    const pipeVec = vec.sub(ep2, ep1);
    const pipeLen = vec.mag(pipeVec);
    if (pipeLen < 0.1) continue;

    const toSupport = vec.sub(coor, ep1);
    const t = vec.dot(toSupport, pipeVec) / (pipeLen * pipeLen);
    const projection = vec.add(ep1, vec.scale(pipeVec, Math.max(0, Math.min(1, t))));
    const perpDist = vec.dist(coor, projection);

    if (perpDist < minDist) minDist = perpDist;
  }

  if (minDist > 5.0 && minDist < Infinity) {
    log.push({ type: "Error", ruleId: "R-TOP-06", tier: 4, row: ri,
      message: `ERROR [R-TOP-06]: Support is ${minDist.toFixed(1)}mm off the nearest pipe axis.` });
  }

  // R-SPA-03: Support on vertical run
  if (context.travelAxis === "Z") {
    log.push({ type: "Warning", ruleId: "R-SPA-03", tier: 3, row: ri,
      message: `WARNING [R-SPA-03]: Support on vertical pipe run. Verify support type.` });
  }
}
```

### 9.3 Aggregate Rules (called after full chain walk)

```javascript
function runAggregateRules(chain, context, config, log) {
  const cfg = config.smartFixer || {};
  const chainId = context.chainId;

  // R-AGG-01: Total pipe length sanity
  if (context.pipeLengthSum <= 0 && chain.length > 0) {
    log.push({ type: "Error", ruleId: "R-AGG-01", tier: 4, row: chain[0]?.element?._rowIndex,
      message: `ERROR [R-AGG-01]: ${chainId} has zero pipe length. Fundamentally broken.` });
  }

  // R-AGG-03: Route closure check
  if (chain.length >= 2) {
    const startPt = getEntryPoint(chain[0].element);
    const endPt = getExitPoint(chain[chain.length - 1].element);
    if (startPt && endPt) {
      const expected = vec.sub(endPt, startPt);
      const actual = context.cumulativeVector;
      const error = vec.mag(vec.sub(expected, actual));
      const closureWarn = cfg.closureWarningThreshold ?? 5.0;
      const closureErr = cfg.closureErrorThreshold ?? 50.0;
      if (error > closureErr) {
        log.push({ type: "Error", ruleId: "R-AGG-03", tier: 4, row: chain[0]?.element?._rowIndex,
          message: `ERROR [R-AGG-03]: ${chainId} closure error ${error.toFixed(1)}mm.` });
      } else if (error > closureWarn) {
        log.push({ type: "Warning", ruleId: "R-AGG-03", tier: 3, row: chain[0]?.element?._rowIndex,
          message: `WARNING [R-AGG-03]: ${chainId} closure error ${error.toFixed(1)}mm.` });
      }
    }
  }

  // R-AGG-04 / R-TOP-01: Dead-end detection
  if (chain.length > 0) {
    const lastElem = chain[chain.length - 1].element;
    const lastType = (lastElem.type || "").toUpperCase();
    if (lastType === "PIPE") {
      log.push({ type: "Warning", ruleId: "R-TOP-01", tier: 3, row: lastElem._rowIndex,
        message: `WARNING [R-TOP-01]: ${chainId} ends at bare PIPE. Expected terminal fitting.` });
    }
  }

  // R-AGG-05: Flange pair completeness
  const midFlanges = chain.filter((link, i) => {
    return (link.element.type || "").toUpperCase() === "FLANGE" && i > 0 && i < chain.length - 1;
  });
  if (midFlanges.length % 2 !== 0) {
    log.push({ type: "Warning", ruleId: "R-AGG-05", tier: 3, row: midFlanges[0]?.element?._rowIndex,
      message: `WARNING [R-AGG-05]: ${chainId} has ${midFlanges.length} mid-chain flanges (odd). Missing mating flange?` });
  }

  // R-AGG-06: No supports on long chain
  const chainLenM = vec.mag(context.cumulativeVector) / 1000;
  if (chainLenM > ((cfg.noSupportAlertLength ?? 10000) / 1000)) {
    // Count supports encountered (they were skipped in walk but we can check dataTable)
    // For now, flag based on pipe length
    log.push({ type: "Warning", ruleId: "R-AGG-06", tier: 3, row: chain[0]?.element?._rowIndex,
      message: `WARNING [R-AGG-06]: ${chainId} is ${chainLenM.toFixed(1)}m long. Verify supports are included.` });
  }
}
```

---

## 10. REGION G: FIX APPLICATION ENGINE

### 10.1 Apply Fixes to Data Table

This function executes when the user clicks **[Apply Fixes]**.

```javascript
function applyFixes(dataTable, chains, config, log) {
  const applied = [];
  const newRows = [];   // Gap-filler pipes to insert
  const deleteRows = new Set(); // Row indices to delete

  // ─── Priority 1: Collect DELETEs ───
  for (const chain of chains) {
    for (const link of chain) {
      const elem = link.element;
      if (elem._proposedFix?.type === "DELETE" && elem._proposedFix.tier <= 2) {
        deleteRows.add(elem._rowIndex);
        applied.push({ ruleId: elem._proposedFix.ruleId, row: elem._rowIndex, action: "DELETE" });
        log.push({ type: "Applied", ruleId: elem._proposedFix.ruleId, row: elem._rowIndex,
          message: `APPLIED: Deleted ${elem.type} at Row ${elem._rowIndex}.` });
      }
    }
  }

  // ─── Priority 2: Collect SNAP_AXIS fixes ───
  for (const chain of chains) {
    for (const link of chain) {
      const elem = link.element;
      if (elem._proposedFix?.type === "SNAP_AXIS" && elem._proposedFix.tier <= 2) {
        const axis = elem._proposedFix.dominantAxis;
        snapToSingleAxis(elem, axis);
        markModified(elem, "ep1", "SmartFix:R-GEO-03");
        markModified(elem, "ep2", "SmartFix:R-GEO-03");
        applied.push({ ruleId: "R-GEO-03", row: elem._rowIndex, action: "SNAP_AXIS" });
      }
    }
  }

  // ─── Priority 3: Collect SNAP gap fixes ───
  for (const chain of chains) {
    for (const link of chain) {
      if (!link.fixAction) continue;
      if (link.fixAction.type === "SNAP" && link.fixAction.tier <= 2) {
        snapEndpoints(link.element, link.nextElement);
        markModified(link.element, "ep2", `SmartFix:${link.fixAction.ruleId}`);
        markModified(link.nextElement, "ep1", `SmartFix:${link.fixAction.ruleId}`);
        applied.push({ ruleId: link.fixAction.ruleId, row: link.element._rowIndex, action: "SNAP" });
      }
    }
  }

  // ─── Priority 4: Collect TRIM fixes ───
  for (const chain of chains) {
    for (const link of chain) {
      if (!link.fixAction) continue;
      if (link.fixAction.type === "TRIM" && link.fixAction.tier <= 2) {
        const target = link.fixAction.trimTarget === "current" ? link.element : link.nextElement;
        if ((target.type || "").toUpperCase() === "PIPE") {
          trimPipe(target, link.fixAction.trimAmount, link.travelAxis, link.travelDirection, link.fixAction.trimTarget);
          markModified(target, link.fixAction.trimTarget === "current" ? "ep2" : "ep1",
            `SmartFix:${link.fixAction.ruleId}`);
          applied.push({ ruleId: link.fixAction.ruleId, row: target._rowIndex, action: "TRIM" });
          log.push({ type: "Applied", ruleId: link.fixAction.ruleId, row: target._rowIndex,
            message: `APPLIED: Trimmed ${target.type} by ${link.fixAction.trimAmount.toFixed(1)}mm.` });

          // R-OVR-06: Check if trim creates micro-pipe
          const remaining = vec.mag(getElementVector(target));
          if (remaining < (config.smartFixer?.microPipeThreshold ?? 6.0)) {
            deleteRows.add(target._rowIndex);
            log.push({ type: "Applied", ruleId: "R-OVR-06", row: target._rowIndex,
              message: `APPLIED: Pipe reduced to ${remaining.toFixed(1)}mm after trim. Deleted.` });
          }
        }
      }
    }
  }

  // ─── Priority 5: Collect INSERT fixes (gap-fill pipes) ───
  for (const chain of chains) {
    for (const link of chain) {
      if (!link.fixAction) continue;
      if (link.fixAction.type === "INSERT" && link.fixAction.tier <= 2) {
        const fillerPipe = createFillerPipe(link, config);
        newRows.push({ insertAfterRow: link.element._rowIndex, pipe: fillerPipe });
        applied.push({ ruleId: link.fixAction.ruleId, row: link.element._rowIndex, action: "INSERT" });
        log.push({ type: "Applied", ruleId: link.fixAction.ruleId, row: link.element._rowIndex,
          message: `APPLIED: Inserted ${link.fixAction.gapAmount.toFixed(1)}mm gap-fill pipe after Row ${link.element._rowIndex}.` });
      }
    }
  }

  // ─── Execute changes on dataTable ───

  // 1. Remove deleted rows
  let updatedTable = dataTable.filter(row => !deleteRows.has(row._rowIndex));

  // 2. Insert new rows (gap-fill pipes)
  for (const insertion of newRows.sort((a, b) => b.insertAfterRow - a.insertAfterRow)) {
    const idx = updatedTable.findIndex(r => r._rowIndex === insertion.insertAfterRow);
    if (idx >= 0) {
      updatedTable.splice(idx + 1, 0, insertion.pipe);
    } else {
      updatedTable.push(insertion.pipe);
    }
  }

  // 3. Re-number rows
  updatedTable.forEach((row, i) => { row._rowIndex = i + 1; });

  // 4. Clear all fixingAction previews (fixes have been applied)
  updatedTable.forEach(row => {
    row.fixingAction = null;
    row.fixingActionTier = null;
    row.fixingActionRuleId = null;
  });

  return { updatedTable, applied, deleteCount: deleteRows.size, insertCount: newRows.length };
}
```

### 10.2 Helper Functions for Fix Application

```javascript
function snapEndpoints(elemA, elemB) {
  // Snap A.EP2 and B.EP1 to their midpoint
  const mid = vec.mid(getExitPoint(elemA), getEntryPoint(elemB));
  if (elemA.ep2) { elemA.ep2 = { ...mid }; }
  if (elemB.ep1) { elemB.ep1 = { ...mid }; }
}

function snapToSingleAxis(element, dominantAxis) {
  if (!element.ep1 || !element.ep2) return;
  // Zero out non-dominant deltas by projecting EP2 onto EP1's non-dominant coords
  const axes = ["x", "y", "z"];
  const domKey = dominantAxis.toLowerCase();
  for (const key of axes) {
    if (key !== domKey) {
      element.ep2[key] = element.ep1[key]; // Force alignment
    }
  }
}

function trimPipe(pipe, amount, travelAxis, travelDir, which) {
  // which: "current" = trim EP2, "next" = trim EP1
  const axisKey = travelAxis.toLowerCase();
  if (which === "current") {
    pipe.ep2[axisKey] -= amount * travelDir;
  } else {
    pipe.ep1[axisKey] += amount * travelDir;
  }
}

function createFillerPipe(chainLink, config) {
  const upstream = chainLink.element;
  const downstream = chainLink.nextElement;
  const exitPt = getExitPoint(upstream);
  const entryPt = getEntryPoint(downstream);

  return {
    _rowIndex: -1,  // Will be reassigned during re-numbering
    _modified: { ep1: "SmartFix:GapFill", ep2: "SmartFix:GapFill", type: "SmartFix:GapFill" },
    _logTags: ["Calculated"],
    csvSeqNo: `${upstream.csvSeqNo || 0}.GF`,
    type: "PIPE",
    text: "",  // Will be regenerated by MESSAGE-SQUARE step
    refNo: `${upstream.refNo || "UNKNOWN"}_GapFill`,
    bore: upstream.bore || 0,
    ep1: { ...exitPt },
    ep2: { ...entryPt },
    cp: null, bp: null, branchBore: null,
    skey: "",
    supportCoor: null, supportName: "", supportGuid: "",
    ca: { ...upstream.ca, 8: null, 97: null, 98: null }, // Inherit CAs except weight/ref/seq
    fixingAction: "GAPFILLING",
    fixingActionTier: null,
    fixingActionRuleId: null,
    // Calculated fields will be filled by Step 5 (coordinate recalc)
    len1: null, axis1: null, len2: null, axis2: null, len3: null, axis3: null,
    brlen: null, deltaX: null, deltaY: null, deltaZ: null,
    diameter: upstream.bore, wallThick: upstream.ca?.[4] || null,
    bendPtr: null, rigidPtr: null, intPtr: null,
  };
}

function markModified(row, field, reason) {
  if (!row._modified) row._modified = {};
  row._modified[field] = reason;
}
```

---

## 11. REGION H: FIXING ACTION DESCRIPTOR

### 11.1 Populate Fixing Action Column

Called after chain walking, before user review.

```javascript
function populateFixingActions(dataTable, chains, log) {
  // Clear all existing fixing actions
  for (const row of dataTable) {
    row.fixingAction = null;
    row.fixingActionTier = null;
    row.fixingActionRuleId = null;
  }

  // From chain walk: element-level proposed fixes
  for (const chain of chains) {
    for (const link of chain) {
      const elem = link.element;

      // Element-level fix (DELETE, SNAP_AXIS)
      if (elem._proposedFix) {
        const row = dataTable.find(r => r._rowIndex === elem._rowIndex);
        if (row) {
          row.fixingAction = formatProposedFix(elem._proposedFix, elem);
          row.fixingActionTier = elem._proposedFix.tier;
          row.fixingActionRuleId = elem._proposedFix.ruleId;
        }
      }

      // Gap/Overlap fix (affects current AND next element)
      if (link.fixAction) {
        const currRow = dataTable.find(r => r._rowIndex === link.element._rowIndex);
        const nextRow = link.nextElement ? dataTable.find(r => r._rowIndex === link.nextElement._rowIndex) : null;

        if (currRow && !currRow.fixingAction) {
          currRow.fixingAction = link.fixAction.description;
          currRow.fixingActionTier = link.fixAction.tier;
          currRow.fixingActionRuleId = link.fixAction.ruleId;
        }
        if (nextRow && !nextRow.fixingAction && link.fixAction.tier <= 3) {
          nextRow.fixingAction = `← ${link.fixAction.description.split('\n')[0]}`; // Abbreviated back-reference
          nextRow.fixingActionTier = link.fixAction.tier;
          nextRow.fixingActionRuleId = link.fixAction.ruleId;
        }
      }

      // Process branch chain recursively
      if (link.branchChain) {
        populateFixingActionsFromChain(dataTable, link.branchChain);
      }
    }
  }

  // Also populate from log entries for rules without direct chain-link actions
  for (const entry of log) {
    if (entry.row && entry.tier && entry.tier <= 4) {
      const row = dataTable.find(r => r._rowIndex === entry.row);
      if (row && !row.fixingAction) {
        row.fixingAction = entry.message;
        row.fixingActionTier = entry.tier;
        row.fixingActionRuleId = entry.ruleId;
      }
    }
  }
}

function formatProposedFix(fix, element) {
  const type = (element.type || "").toUpperCase();
  const ri = element._rowIndex;

  switch (fix.type) {
    case "DELETE":
      const len = element.ep1 && element.ep2 ? vec.mag(vec.sub(element.ep2, element.ep1)) : 0;
      return `DELETE [${fix.ruleId}]: Remove ${type} at Row ${ri}\n` +
             `  Length: ${len.toFixed(1)}mm, Bore: ${element.bore || 0}mm\n` +
             `  Reason: ${fix.ruleId === "R-GEO-01" ? "Micro-element below threshold" : "Fold-back element"}`;

    case "SNAP_AXIS":
      return `SNAP [${fix.ruleId}]: Align ${type} to pure ${fix.dominantAxis}-axis\n` +
             `  Row ${ri}: Off-axis components will be zeroed\n` +
             `  EP2 non-${fix.dominantAxis} coords → match EP1`;

    default:
      return `${fix.type} [${fix.ruleId}]: Row ${ri}`;
  }
}

function buildInsertDescription(gapAmt, direction, context, upstream) {
  const exitPt = getExitPoint(upstream);
  const bore = upstream.bore || 0;
  const axisKey = context.travelAxis.toLowerCase();
  const endPt = { ...exitPt };
  endPt[axisKey] += gapAmt * context.travelDirection;

  return `INSERT [R-GAP-02]: Fill ${gapAmt.toFixed(1)}mm gap along ${direction}\n` +
         `  New PIPE: EP1=(${exitPt.x.toFixed(1)}, ${exitPt.y.toFixed(1)}, ${exitPt.z.toFixed(1)})\n` +
         `          → EP2=(${endPt.x.toFixed(1)}, ${endPt.y.toFixed(1)}, ${endPt.z.toFixed(1)})\n` +
         `  Length: ${gapAmt.toFixed(1)}mm, Bore: ${bore.toFixed(1)}mm\n` +
         `  Inherited from Row ${upstream._rowIndex}`;
}

function buildTrimDescription(overlapAmt, direction, current, next, target) {
  const trimRow = target === "current" ? current : next;
  const otherRow = target === "current" ? next : current;
  return `TRIM [${target === "current" ? "R-OVR-01" : "R-OVR-02"}]: ` +
         `Reduce ${trimRow.type} by ${overlapAmt.toFixed(1)}mm along ${direction}\n` +
         `  Row ${trimRow._rowIndex}: ${target === "current" ? "EP2" : "EP1"} adjusted\n` +
         `  Overlap with ${otherRow.type} (Row ${otherRow._rowIndex}) resolved`;
}
```

---

## 12. REGION I: SMART FIX ORCHESTRATOR

The top-level function called when **[Smart Fix]** is clicked.

```javascript
function runSmartFix(dataTable, config, log) {
  log.push({ type: "Info", message: "═══ SMART FIX: Starting chain walker ═══" });

  // Step 4A: Build connectivity graph
  log.push({ type: "Info", message: "Step 4A: Building connectivity graph..." });
  const graph = buildConnectivityGraph(dataTable, config);
  log.push({ type: "Info",
    message: `Graph: ${graph.components.length} components, ${graph.terminals.length} terminals, ${graph.edges.size} connections.` });

  // Step 4B: Walk all chains
  log.push({ type: "Info", message: "Step 4B: Walking element chains..." });
  const { chains, orphans } = walkAllChains(graph, config, log);
  const totalElements = chains.reduce((s, c) => s + c.length, 0);
  log.push({ type: "Info",
    message: `Walked ${chains.length} chains, ${totalElements} elements, ${orphans.length} orphans.` });

  // Step 4C: Rules already run during walk (element + aggregate)
  // Count findings by tier
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const entry of log) {
    if (entry.tier) tierCounts[entry.tier]++;
  }
  log.push({ type: "Info",
    message: `Rules complete: Tier1=${tierCounts[1]}, Tier2=${tierCounts[2]}, Tier3=${tierCounts[3]}, Tier4=${tierCounts[4]}` });

  // Step 4D: Populate Fixing Action column
  log.push({ type: "Info", message: "Step 4D: Populating Fixing Action previews..." });
  populateFixingActions(dataTable, chains, log);

  const actionCount = dataTable.filter(r => r.fixingAction).length;
  log.push({ type: "Info",
    message: `═══ SMART FIX COMPLETE: ${actionCount} rows have proposed fixes. Review in Data Table. ═══` });

  // Build summary
  const summary = {
    chainCount: chains.length,
    elementsWalked: totalElements,
    orphanCount: orphans.length,
    tier1: tierCounts[1],
    tier2: tierCounts[2],
    tier3: tierCounts[3],
    tier4: tierCounts[4],
    rowsWithActions: actionCount,
  };

  return { graph, chains, orphans, summary };
}
```

---

## 13. REGION J: UI INTEGRATION

### 13.1 Data Table "Fixing Action" Column

Add to the Data Table tab's column list:

```javascript
// In the Data Table column definitions, add after "Fixing Action" (col 26):
{
  header: "Smart Fix Preview",
  field: "fixingAction",
  width: 320,
  render: (value, row) => {
    if (!value) return "—";

    const tierColors = {
      1: { bg: "#D4EDDA", text: "#155724", border: "#28A745", label: "AUTO" },
      2: { bg: "#FFF3CD", text: "#856404", border: "#FFC107", label: "FIX" },
      3: { bg: "#FFE5D0", text: "#856404", border: "#FD7E14", label: "REVIEW" },
      4: { bg: "#F8D7DA", text: "#721C24", border: "#DC3545", label: "ERROR" },
    };
    const colors = tierColors[row.fixingActionTier] || tierColors[3];

    return (
      <div style={{
        background: colors.bg,
        color: colors.text,
        borderLeft: `3px solid ${colors.border}`,
        padding: "4px 8px",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.7rem",
        lineHeight: 1.4,
        whiteSpace: "pre-wrap",
        maxWidth: 320,
      }}>
        <span style={{
          display: "inline-block",
          background: colors.border,
          color: "white",
          padding: "1px 6px",
          borderRadius: 3,
          fontSize: "0.6rem",
          fontWeight: 700,
          marginBottom: 2,
        }}>
          {colors.label} T{row.fixingActionTier}
        </span>
        {" "}{row.fixingActionRuleId}
        <br/>
        {value}
      </div>
    );
  }
}
```

### 13.2 Buttons

```javascript
// Smart Fix button
<button
  onClick={() => {
    dispatch({ type: "SET_SMART_FIX_STATUS", status: "running" });
    const result = runSmartFix(state.dataTable, state.config, state.log);
    dispatch({ type: "SMART_FIX_COMPLETE", payload: result });
  }}
  disabled={!state.dataTable.length || state.smartFix.status === "running"}
  style={{ /* industrial blue button styling */ }}
>
  {state.smartFix.status === "running" ? "Analyzing..." : "Smart Fix 🔧"}
</button>

// Apply Fixes button
<button
  onClick={() => {
    dispatch({ type: "SET_SMART_FIX_STATUS", status: "applying" });
    const result = applyFixes(state.dataTable, state.smartFix.chains, state.config, state.log);
    dispatch({ type: "FIXES_APPLIED", payload: result });
    // After applying: trigger Steps 5-13 (coordinate recalc, CP/BP, pointers, etc.)
  }}
  disabled={state.smartFix.status !== "previewing"}
  style={{ /* green button styling when enabled */ }}
>
  {state.smartFix.status === "applying" ? "Applying..." : "Apply Fixes ✓"}
</button>
```

### 13.3 Reducer Actions

```javascript
case "SMART_FIX_COMPLETE":
  return {
    ...state,
    smartFix: {
      ...state.smartFix,
      status: "previewing",
      graph: action.payload.graph,
      chains: action.payload.chains,
      chainSummary: action.payload.summary,
    },
    log: [...state.log],
    // dataTable already mutated with fixingAction populated
  };

case "FIXES_APPLIED":
  return {
    ...state,
    dataTable: action.payload.updatedTable,
    smartFix: {
      ...state.smartFix,
      status: "applied",
      appliedFixes: action.payload.applied,
      fixSummary: {
        deleteCount: action.payload.deleteCount,
        insertCount: action.payload.insertCount,
        totalApplied: action.payload.applied.length,
      },
    },
  };
```

### 13.4 Debug Tab — Smart Fix Summary Panel

Add a collapsible section to the Debug tab:

```javascript
// Smart Fix Summary (shown after Smart Fix completes)
{state.smartFix.chainSummary && (
  <div style={{ background: "#F0F4F8", padding: 12, borderRadius: 6, marginBottom: 12 }}>
    <h4>Smart Fix Summary</h4>
    <table>
      <tbody>
        <tr><td>Chains found</td><td>{state.smartFix.chainSummary.chainCount}</td></tr>
        <tr><td>Elements walked</td><td>{state.smartFix.chainSummary.elementsWalked}</td></tr>
        <tr><td>Orphan elements</td><td>{state.smartFix.chainSummary.orphanCount}</td></tr>
        <tr style={{borderTop:"1px solid #ccc"}}><td>Tier 1 (auto-silent)</td>
            <td style={{color:"#28A745"}}>{state.smartFix.chainSummary.tier1}</td></tr>
        <tr><td>Tier 2 (auto-logged)</td>
            <td style={{color:"#FFC107"}}>{state.smartFix.chainSummary.tier2}</td></tr>
        <tr><td>Tier 3 (warnings)</td>
            <td style={{color:"#FD7E14"}}>{state.smartFix.chainSummary.tier3}</td></tr>
        <tr><td>Tier 4 (errors)</td>
            <td style={{color:"#DC3545"}}>{state.smartFix.chainSummary.tier4}</td></tr>
        <tr style={{borderTop:"1px solid #ccc"}}><td>Rows with proposed fixes</td>
            <td><b>{state.smartFix.chainSummary.rowsWithActions}</b></td></tr>
      </tbody>
    </table>
  </div>
)}
```

---

## 14. COMPLETE WORKFLOW — STEP BY STEP

```
USER ACTION                    APP BEHAVIOR
─────────────                  ────────────
1. Import PCF / Excel          → Parse into Data Table
                               → Run Steps 1-4 (basic fixes)
                               → Show Data Table

2. Click [Smart Fix 🔧]       → Step 4A: Build connectivity graph
                               → Step 4B: Walk all chains
                               → Step 4C: Run 57 rules (R-GEO..R-AGG)
                               → Step 4D: Populate "Fixing Action" column
                               → Data Table updates with colored previews
                               → Debug tab shows chain walk log
                               → [Apply Fixes] button becomes active

3. User reviews Data Table     → Scroll through "Smart Fix Preview" column
                               → Green (T1): will auto-fix silently
                               → Amber (T2): will auto-fix with log
                               → Orange (T3): warnings, no auto-fix
                               → Red (T4): errors, needs manual attention

4. Click [Apply Fixes ✓]      → Execute all Tier 1 + Tier 2 fixes:
                                  - DELETE micro-pipes, fold-backs
                                  - SNAP coordinates, close micro-gaps
                                  - TRIM pipe overlaps
                                  - INSERT gap-filler pipes
                               → Update Data Table with corrected values
                               → Highlight modified cells (cyan)
                               → Clear "Fixing Action" column on fixed rows
                               → Re-run Steps 5-13:
                                  - Coordinate recalculation
                                  - CP/BP recalculation
                                  - BRLEN lookup
                                  - Pointer recalculation
                                  - MESSAGE-SQUARE regeneration
                                  - Validation V1-V20

5. Review results              → Debug tab: full audit trail
                               → Tally: before vs after comparison
                               → Remaining T3/T4 items need manual attention

6. Click [Smart Fix 🔧] again → Re-run on corrected data (iterative)
   (optional)                  → Should find fewer issues each pass

7. Click [Export PCF ↓]       → Generate PCF from final Data Table
                               → CRLF, decimal consistency, all rules applied
```

---

## 15. ANTI-DRIFT RULES

### 15.1 Mandatory Constraints

1. **Only PIPE elements can be created, trimmed, or deleted by auto-fix.** Fittings are rigid catalog dimensions. Never modify a fitting's coordinates to resolve a gap/overlap.
2. **Component data > MESSAGE-SQUARE.** Always. Even after Smart Fix, the actual coordinates in the component block are authoritative.
3. **Fixes change the Data Table, not the PCF directly.** The PCF is always regenerated FROM the Data Table. Never edit PCF text as strings.
4. **Chain walker must carry context.** Every gap/overlap decision must use `travel_axis` and `travel_direction`. A 3mm gap along the travel axis is trivial; a 3mm gap perpendicular to it is an error. This distinction is the entire reason the chain walker exists.
5. **Tier 3 and Tier 4 findings are NEVER auto-fixed.** They populate the Fixing Action column for visibility only. The user must resolve them manually or by editing the source data and re-importing.
6. **Gap-fill pipes inherit properties.** Bore, material (CA3), design conditions (CA1, CA2), wall thickness (CA4), insulation density (CA6) — all inherited from the upstream element. CA8 (weight) is NOT inherited (pipes don't have catalog weight).
7. **After Apply Fixes, always re-run Steps 5–13.** The basic fixer must recalculate all derived fields (LEN, AXIS, DELTA, BRLEN, pointers) because coordinates have changed.
8. **`<SKEY>` not `SKEY`.** All PCF output uses angle-bracket syntax.
9. **`UCI:` prefix mandatory.** On all `<SUPPORT_GUID>` values.
10. **CRLF always.** Every PCF output uses `\r\n`.

### 15.2 Testing Checklist

| # | Test | Expected Result |
|---|------|----------------|
| T1 | Import sample PCF, click Smart Fix | Chains built, rules run, Fixing Action populated |
| T2 | PCF with 5mm axial gap | T2 INSERT: gap-fill pipe created |
| T3 | PCF with 0.5mm shared-axis drift | T1 SNAP: silently corrected |
| T4 | PCF with 30mm axial gap | T3 REVIEW: warning, no auto-fix |
| T5 | PCF with 150mm gap | T4 ERROR: major gap flagged |
| T6 | PCF with 10mm pipe overlap | T2 TRIM: pipe EP2 trimmed |
| T7 | Flange-flange overlap | T4 ERROR: rigid-on-rigid, no auto-fix |
| T8 | 3mm fold-back pipe | T2 DELETE: removed |
| T9 | Pipe changing axis without bend | T4 ERROR: R-CHN-01 flagged |
| T10 | TEE with branch bore > header | T4 ERROR: R-BRN-01 flagged |
| T11 | Orphan element (disconnected) | T4 ERROR: R-TOP-02 flagged |
| T12 | Click Apply Fixes | All T1+T2 fixes applied, Data Table updated |
| T13 | After Apply, click Smart Fix again | Fewer issues found (iterative improvement) |
| T14 | Export PCF after fixes | Clean PCF with CRLF, correct coordinates |

---

## 16. ESTIMATED SIZE AND EFFORT

| Region | Lines | Purpose |
|--------|-------|---------|
| A: Vector Math | ~40 | Pure utility functions |
| B: Connectivity Graph | ~120 | Build graph from Data Table |
| C: Chain Walker | ~200 | Walk algorithm + context management |
| D: Axis Detector | ~60 | Element axis + branch direction |
| E: Gap/Overlap Analyzer | ~180 | Core gap/overlap classification |
| F: Rule Engine | ~400 | 57 rules across 9 categories |
| G: Fix Application | ~150 | Apply Tier 1+2 fixes to Data Table |
| H: Action Descriptor | ~80 | Human-readable fix previews |
| I: Orchestrator | ~60 | Top-level Smart Fix function |
| J: UI Components | ~100 | Buttons, column render, summary panel |
| **Total** | **~1,400** | **Add to existing app** |

---

*End of Work Instruction WI-PCF-SMARTFIX-001 Rev.0*
