# ADDON — Corrections, High-ROI Rules & Graph Strategy Update

## Document ID: PCF-ADDON-003 Rev.0
## Applies To: WI-PCF-002, PCF Consolidated Master v2.0
## Status: MANDATORY — implement before next benchmark run

---

## 1. RULE ID CORRECTIONS — AGENT MUST FIX

The forensic audit report contained rule ID mismatches against the authoritative rulebook. These must be corrected before any further work.

### 1.1 R-GEO-08 — Wrong Implementation

```
AGENT IMPLEMENTED:  "Ensured REDUCER components have differing Entry/Exit bores"
ACTUAL R-GEO-08:    "Coordinate magnitude / (0,0,0) check"
```

**What R-GEO-08 actually is:**

```javascript
// R-GEO-08: Coordinate Magnitude and Zero Check
registerRule("R-GEO-08");

function checkRGEO08(element, log) {
  const fields = [
    { name: "ep1", val: element.ep1 },
    { name: "ep2", val: element.ep2 },
    { name: "cp", val: element.cp },
    { name: "bp", val: element.bp },
    { name: "supportCoor", val: element.supportCoor },
  ];

  for (const { name, val } of fields) {
    if (!val) continue;

    // Check (0,0,0) — ERROR
    if (val.x === 0 && val.y === 0 && val.z === 0) {
      logRuleExecution("R-GEO-08", element._rowIndex,
        `ERROR [R-GEO-08]: ${name} is (0,0,0) — prohibited.`);
    }

    // Check magnitude > 500,000mm — WARNING
    for (const axis of ["x", "y", "z"]) {
      if (Math.abs(val[axis]) > 500000) {
        logRuleExecution("R-GEO-08", element._rowIndex,
          `WARNING [R-GEO-08]: ${name}.${axis}=${val[axis].toFixed(0)}mm (${(val[axis]/1000).toFixed(1)}m) — unusually large.`);
      }
    }
  }
}
```

**The reducer bore check the agent implemented is V3** — which should already exist in the validation engine. Verify V3 is correctly registered and that the agent has not double-counted it under R-GEO-08.

### 1.2 R-OVR Numbering — No R-OVR-07 Exists

```
AGENT REFERENCED:  R-OVR-04, R-OVR-05, R-OVR-06, R-OVR-07
ACTUAL RULEBOOK:   R-OVR-01 through R-OVR-06 only. No R-OVR-07.
```

**The actual six overlap rules:**

| ID | Name | Description |
|----|------|-------------|
| R-OVR-01 | Simple axial overlap on pipe | Pipe overlaps next element along travel axis. TRIM pipe EP2. |
| R-OVR-02 | Overlap where current is rigid | Current is fitting, next is pipe. TRIM next pipe EP1. |
| R-OVR-03 | Rigid-on-rigid overlap | Both are fittings. NEVER auto-fix. ERROR. |
| R-OVR-04 | Enveloping overlap | Element B starts before element A — complete spatial overlap. ERROR. |
| R-OVR-05 | Overlap at tee boundary | Pipe-to-tee overlap ≈ half tee C dimension. TRIM pipe by half-C. |
| R-OVR-06 | Overlap creates negative pipe | After trimming, pipe length < 0 or < 6mm. DELETE the pipe. |

**Action:** If the agent created an R-OVR-07, delete it. Map the agent's overlap logic onto these six IDs exactly. If the agent's "deep collision check" for identical centerlines is R-OVR-04 (enveloping overlap), register it as R-OVR-04, not as a new rule.

### 1.3 R-BRN-04 — Wrong Angle Threshold

```
AGENT IMPLEMENTED:  "Flagged OLETs/Branches deviating from 90° or 45° insertion angles"
ACTUAL R-BRN-04:    "Branch perpendicularity — 5° warning, 15° error from 90°"
```

**45° is never a valid branch angle in our system.** Plant piping tees are always 90° perpendicular. The rule checks how far from 90° the actual angle is:

```javascript
// R-BRN-04: Branch Perpendicularity
registerRule("R-BRN-04");

function checkRBRN04(teeElement, config, log) {
  if (!teeElement.ep1 || !teeElement.ep2 || !teeElement.cp || !teeElement.bp) return;

  const headerVec = vec.sub(teeElement.ep2, teeElement.ep1);
  const branchVec = vec.sub(teeElement.bp, teeElement.cp);
  const hMag = vec.mag(headerVec);
  const bMag = vec.mag(branchVec);
  if (hMag < 0.1 || bMag < 0.1) return;

  const cosAngle = Math.abs(vec.dot(headerVec, branchVec)) / (hMag * bMag);
  const angleDeg = Math.acos(Math.min(cosAngle, 1.0)) * 180 / Math.PI;
  const offPerp = Math.abs(90 - angleDeg);

  const warnThreshold = config.smartFixer?.branchPerpendicularityWarn ?? 5.0;
  const errThreshold = config.smartFixer?.branchPerpendicularityError ?? 15.0;

  if (offPerp > errThreshold) {
    logRuleExecution("R-BRN-04", teeElement._rowIndex,
      `ERROR [R-BRN-04]: Branch ${offPerp.toFixed(1)}° from perpendicular. Exceeds ${errThreshold}° threshold.`);
  } else if (offPerp > warnThreshold) {
    logRuleExecution("R-BRN-04", teeElement._rowIndex,
      `WARNING [R-BRN-04]: Branch ${offPerp.toFixed(1)}° from perpendicular. Exceeds ${warnThreshold}° threshold.`);
  }
}
```

**Action:** Remove any 45° logic. The only reference angle is 90°. Deviations are measured from 90°.

### 1.4 R-CHN-06 — Missing SNAP Action (Critical)

```
AGENT IMPLEMENTED:  "Flagged Z-axis offsets greater than reviewGapMax"  (error only)
ACTUAL R-CHN-06:    "Shared-axis coordinate snapping" — 3-tier with SNAP action
```

The agent implemented only the error case. **The SNAP action (Tier 1 and 2) is the high-value part** — it's what cleans coordinate drift from the data.

**Complete R-CHN-06:**

```javascript
// R-CHN-06: Shared-Axis Coordinate Snapping
registerRule("R-CHN-06");

function checkRCHN06(element, prevElement, context, config, log) {
  if (!prevElement || !context.travelAxis) return;

  const exitPt = getExitPoint(prevElement);
  const entryPt = getEntryPoint(element);
  if (!exitPt || !entryPt) return;

  const silentSnap = config.smartFixer?.silentSnapThreshold ?? 2.0;
  const warnSnap = config.smartFixer?.warnSnapThreshold ?? 10.0;

  // Check ALL non-travel axes (not just Z)
  const nonTravelAxes = ["x", "y", "z"].filter(a => a !== context.travelAxis.toLowerCase());

  for (const axis of nonTravelAxes) {
    const drift = Math.abs(entryPt[axis] - exitPt[axis]);

    if (drift > 0.1 && drift < silentSnap) {
      // TIER 1: Silent snap — auto-fix, minimal log
      element.ep1[axis] = exitPt[axis];
      markModified(element, "ep1", "SmartFix:R-CHN-06:snap");
      logRuleExecution("R-CHN-06", element._rowIndex,
        `SNAP [R-CHN-06 T1]: ${axis.toUpperCase()} drifted ${drift.toFixed(1)}mm. Silently snapped to ${exitPt[axis].toFixed(1)}.`);
    }
    else if (drift >= silentSnap && drift < warnSnap) {
      // TIER 2: Snap with warning — auto-fix but visible
      element.ep1[axis] = exitPt[axis];
      markModified(element, "ep1", "SmartFix:R-CHN-06:snap-warn");
      logRuleExecution("R-CHN-06", element._rowIndex,
        `SNAP [R-CHN-06 T2]: ${axis.toUpperCase()} drifted ${drift.toFixed(1)}mm. Snapped to ${exitPt[axis].toFixed(1)}. Verify not intentional offset.`);
    }
    else if (drift >= warnSnap) {
      // TIER 4: Error — too large, do NOT snap
      logRuleExecution("R-CHN-06", element._rowIndex,
        `ERROR [R-CHN-06 T4]: ${axis.toUpperCase()} offset ${drift.toFixed(1)}mm from previous element. Too large for auto-snap. Manual review.`);
    }
  }
}
```

**Action:** Replace the agent's Z-only error-flag with this 3-tier all-axes implementation. This single fix will eliminate 50–70% of false lateral-offset warnings in the log.

---

## 2. GRAPH BUILDER — DUAL STRATEGY (AGREED)

The agent's dual-strategy approach is correct. Formalize it as follows.

### 2.1 Strategy Selection

```javascript
// Config:
//   config.smartFixer.chainingStrategy: "strict_sequential" | "spatial"
//   Default: "strict_sequential"

function buildConnectivityGraph(dataTable, config) {
  const strategy = config.smartFixer?.chainingStrategy ?? "strict_sequential";

  if (strategy === "strict_sequential") {
    return buildSequentialGraph(dataTable, config);
  } else {
    return buildSpatialGraph(dataTable, config);
  }
}
```

### 2.2 Strict Sequential Strategy (Default)

```javascript
function buildSequentialGraph(dataTable, config) {
  const tolerance = config.smartFixer?.connectionTolerance ?? 25.0;
  const reviewMax = config.smartFixer?.reviewGapMax ?? 100.0;
  const components = filterToComponents(dataTable);

  const edges = new Map();
  const branchEdges = new Map();
  const hasIncoming = new Set();

  for (let i = 0; i < components.length - 1; i++) {
    const curr = components[i];
    const next = components[i + 1];
    const type = (curr.type || "").toUpperCase();

    // Skip: SUPPORT is a point element — chain passes through it
    if (type === "SUPPORT") continue;

    const exitPt = getExitPoint(curr);
    const entryPt = getEntryPoint(next);

    if (!exitPt || !entryPt) continue;

    const gap = vec.dist(exitPt, entryPt);

    // Always link sequential elements — but log the gap
    edges.set(curr._rowIndex, next);
    hasIncoming.add(next._rowIndex);

    if (gap > reviewMax) {
      // Large gap between sequential elements — this IS a real gap, not a broken chain
      // Log it but still chain them (sequential order is authoritative)
      // The gap analyzer will handle it in the walk phase
    }

    // TEE branch: look for next element whose EP1 is near BP
    if (type === "TEE" && curr.bp) {
      const branchStart = findNearestByCoord(components, curr.bp, tolerance, curr._rowIndex);
      if (branchStart) {
        branchEdges.set(curr._rowIndex, branchStart);
        hasIncoming.add(branchStart._rowIndex);
      }
    }
  }

  const terminals = components.filter(c => !hasIncoming.has(c._rowIndex) && c.type !== "SUPPORT");

  return { components, edges, branchEdges, terminals, strategy: "strict_sequential" };
}
```

### 2.3 Spatial Strategy (Fallback)

The original spatial graph builder using grid-snap spatial index. Retained as-is for non-sequential data (Case D in PTE).

### 2.4 When to Use Each

| Data Source | Default Strategy | Reason |
|------------|-----------------|--------|
| PCF text import | `strict_sequential` | PCF files are inherently sequential |
| Element CSV (sequential) | `strict_sequential` | Rows are in route order |
| Point CSV (sequential) | `strict_sequential` | After PTE conversion, elements are in order |
| Point CSV (non-sequential, Case D) | `spatial` | Data is unordered — must use coordinate topology |
| User override via config | Either | User knows their data best |

```javascript
// Auto-select strategy based on input type and PTE case
function autoSelectStrategy(inputType, pteCase) {
  if (pteCase === "CASE_D_a" || pteCase === "CASE_D_b") return "spatial";
  return "strict_sequential";
}
```

---

## 3. HIGH-ROI RULE IMPLEMENTATIONS

Implement in this exact order. Each rule includes complete code.

### 3.1 R-SPA-02 — Shared-Axis Coordinate Snap (HIGHEST ROI)

**Why highest ROI:** Eliminates 50–70% of false warnings. Every modeling tool produces sub-mm drift on non-travel axes. Without this rule, the log is flooded with noise.

**Note:** This rule overlaps with R-CHN-06 (§1.4 above). They are the same logic applied at different points. R-CHN-06 fires during the chain walk (element-to-element). R-SPA-02 can be applied as a post-walk cleanup pass across the entire Data Table.

```javascript
registerRule("R-SPA-02");

function applyRSPA02(dataTable, chains, config, log) {
  // Post-walk pass: for each chain, snap non-travel coordinates to chain median
  const silentSnap = config.smartFixer?.silentSnapThreshold ?? 2.0;
  const warnSnap = config.smartFixer?.warnSnapThreshold ?? 10.0;
  let snapCount = 0;

  for (const chain of chains) {
    if (chain.length < 2) continue;

    // Group consecutive elements by travel axis
    let runStart = 0;
    while (runStart < chain.length) {
      const runAxis = chain[runStart].travelAxis;
      if (!runAxis) { runStart++; continue; }

      // Find the extent of this straight run (same travel axis)
      let runEnd = runStart;
      while (runEnd < chain.length - 1 && chain[runEnd + 1].travelAxis === runAxis) {
        runEnd++;
      }

      if (runEnd > runStart) {
        // We have a run of elements on the same axis
        const nonTravelAxes = ["x", "y", "z"].filter(a => a !== runAxis.toLowerCase());

        for (const axis of nonTravelAxes) {
          // Collect all values on this non-travel axis
          const values = [];
          for (let j = runStart; j <= runEnd; j++) {
            const elem = chain[j].element;
            if (elem.ep1) values.push(elem.ep1[axis]);
            if (elem.ep2) values.push(elem.ep2[axis]);
          }

          if (values.length < 2) continue;

          // Calculate median
          const sorted = [...values].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];

          // Snap outliers to median
          for (let j = runStart; j <= runEnd; j++) {
            const elem = chain[j].element;
            for (const pt of ["ep1", "ep2"]) {
              if (!elem[pt]) continue;
              const drift = Math.abs(elem[pt][axis] - median);

              if (drift > 0.1 && drift < silentSnap) {
                elem[pt][axis] = median;
                markModified(elem, pt, "SmartFix:R-SPA-02:snap");
                snapCount++;
              } else if (drift >= silentSnap && drift < warnSnap) {
                elem[pt][axis] = median;
                markModified(elem, pt, "SmartFix:R-SPA-02:snap-warn");
                snapCount++;
                logRuleExecution("R-SPA-02", elem._rowIndex,
                  `SNAP [R-SPA-02 T2]: ${axis.toUpperCase()} drifted ${drift.toFixed(1)}mm from run median ${median.toFixed(1)}. Snapped.`);
              } else if (drift >= warnSnap) {
                logRuleExecution("R-SPA-02", elem._rowIndex,
                  `ERROR [R-SPA-02 T4]: ${axis.toUpperCase()} offset ${drift.toFixed(1)}mm from run median. Too large.`);
              }
            }
          }
        }
      }

      runStart = runEnd + 1;
    }
  }

  log.push({ type: "Info", message: `R-SPA-02: Snapped ${snapCount} coordinates across all chains.` });
}
```

**When to run:** After chain walk, before fix application. This cleans coordinates so that gap/overlap analysis operates on clean data.

### 3.2 R-TOP-02 — Orphan Element Detection

**Why high ROI:** 5 lines of code, catches fundamentally broken data.

```javascript
registerRule("R-TOP-02");

function detectOrphans(components, visited, log) {
  const orphans = components.filter(c =>
    !visited.has(c._rowIndex) &&
    (c.type || "").toUpperCase() !== "SUPPORT"
  );

  for (const orphan of orphans) {
    logRuleExecution("R-TOP-02", orphan._rowIndex,
      `ERROR [R-TOP-02 T4]: ${orphan.type} (Row ${orphan._rowIndex}) is orphaned — not connected to any chain.`);
  }

  return orphans;
}
```

**When to run:** After `walkAllChains()` completes. The `visited` set is populated during walking.

### 3.3 R-SPA-01 — Elevation Consistency in Horizontal Runs

```javascript
registerRule("R-SPA-01");

function checkRSPA01(chain, config, log) {
  const silentSnap = config.smartFixer?.silentSnapThreshold ?? 2.0;
  const warnSnap = config.smartFixer?.warnSnapThreshold ?? 10.0;

  // Only applies to horizontal runs (travel axis X or Y)
  // Track Z values across the run
  let runZValues = [];
  let runStartIdx = 0;

  for (let i = 0; i < chain.length; i++) {
    const link = chain[i];
    const axis = link.travelAxis;

    if (axis === "X" || axis === "Y") {
      // Horizontal run — track Z
      if (link.element.ep1) runZValues.push({ idx: i, z: link.element.ep1.z, pt: "ep1" });
      if (link.element.ep2) runZValues.push({ idx: i, z: link.element.ep2.z, pt: "ep2" });
    } else {
      // Non-horizontal (vertical or unknown) — process accumulated run
      if (runZValues.length >= 4) {
        snapElevation(runZValues, chain, silentSnap, warnSnap, log);
      }
      runZValues = [];
    }
  }

  // Process final run
  if (runZValues.length >= 4) {
    snapElevation(runZValues, chain, silentSnap, warnSnap, log);
  }
}

function snapElevation(zValues, chain, silentSnap, warnSnap, log) {
  const sorted = [...zValues].map(v => v.z).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  for (const entry of zValues) {
    const drift = Math.abs(entry.z - median);
    const elem = chain[entry.idx].element;

    if (drift > 0.1 && drift < silentSnap) {
      elem[entry.pt].z = median;
      markModified(elem, entry.pt, "SmartFix:R-SPA-01:elev-snap");
    } else if (drift >= silentSnap && drift < warnSnap) {
      elem[entry.pt].z = median;
      markModified(elem, entry.pt, "SmartFix:R-SPA-01:elev-snap-warn");
      logRuleExecution("R-SPA-01", elem._rowIndex,
        `SNAP [R-SPA-01 T2]: Elevation Z drifted ${drift.toFixed(1)}mm from horizontal run median ${median.toFixed(1)}. Snapped.`);
    } else if (drift >= warnSnap) {
      logRuleExecution("R-SPA-01", elem._rowIndex,
        `WARNING [R-SPA-01 T3]: Elevation Z changes ${drift.toFixed(1)}mm in horizontal run. Intentional slope or error?`);
    }
  }
}
```

### 3.4 R-TOP-03 — Duplicate Element Detection

```javascript
registerRule("R-TOP-03");

function detectDuplicates(components, config, log) {
  const tolerance = 2.0; // mm — two elements at same location = duplicate
  const duplicates = [];

  for (let i = 0; i < components.length; i++) {
    const a = components[i];
    if (!a.ep1 || !a.ep2) continue;
    const aType = (a.type || "").toUpperCase();

    for (let j = i + 1; j < components.length; j++) {
      const b = components[j];
      if (!b.ep1 || !b.ep2) continue;
      const bType = (b.type || "").toUpperCase();

      // Same type and overlapping spatial extent
      if (aType === bType &&
          vec.approxEqual(a.ep1, b.ep1, tolerance) &&
          vec.approxEqual(a.ep2, b.ep2, tolerance)) {
        duplicates.push({ rowA: a._rowIndex, rowB: b._rowIndex, type: aType });
        logRuleExecution("R-TOP-03", b._rowIndex,
          `ERROR [R-TOP-03 T4]: Duplicate ${aType} — Row ${a._rowIndex} and Row ${b._rowIndex} occupy identical space. Delete one.`);
      }
    }
  }

  return duplicates;
}
```

**When to run:** Before chain walk (pre-processing). Duplicates confuse the graph builder.

### 3.5 R-OVR-05 — Overlap at Tee Boundary

```javascript
registerRule("R-OVR-05");

function checkROVR05(current, next, overlapAmt, context, config, log) {
  // Only applies when one element is PIPE and the other is TEE
  const currType = (current.type || "").toUpperCase();
  const nextType = (next.type || "").toUpperCase();

  if (!((currType === "PIPE" && nextType === "TEE") ||
        (currType === "TEE" && nextType === "PIPE"))) {
    return null; // Not a pipe-tee boundary
  }

  const tee = currType === "TEE" ? current : next;
  const pipe = currType === "PIPE" ? current : next;

  // Look up tee C dimension (center-to-end, run) from ASME B16.9 database
  const teeBore = tee.bore || 0;
  const teeEntry = config.brlenEqualTee?.find(e => e.bore === teeBore);
  const halfC = teeEntry ? teeEntry.C / 2 : null;

  if (halfC && Math.abs(overlapAmt - halfC) < 3.0) {
    // Overlap matches tee half-C — pipe wasn't trimmed for tee insertion
    const trimTarget = currType === "PIPE" ? "current" : "next";
    const dir = directionLabel(context.travelAxis, context.travelDirection);

    logRuleExecution("R-OVR-05", pipe._rowIndex,
      `TRIM [R-OVR-05 T2]: Pipe overlaps TEE by ${overlapAmt.toFixed(1)}mm ≈ half-C (${halfC.toFixed(1)}mm). Trimming pipe.`);

    return {
      type: "TRIM", ruleId: "R-OVR-05", tier: 2,
      description: `TRIM [R-OVR-05]: Pipe trimmed by ${halfC.toFixed(1)}mm (tee half-C dimension) to accommodate TEE at Row ${tee._rowIndex}.`,
      trimAmount: halfC,
      trimTarget,
      current, next,
    };
  }

  // Overlap doesn't match tee dimension
  logRuleExecution("R-OVR-05", pipe._rowIndex,
    `WARNING [R-OVR-05 T3]: Pipe overlaps TEE by ${overlapAmt.toFixed(1)}mm (tee half-C=${halfC ? halfC.toFixed(1) : "unknown"}mm). Non-standard overlap.`);

  return {
    type: "REVIEW", ruleId: "R-OVR-05", tier: 3,
    description: `REVIEW [R-OVR-05]: ${overlapAmt.toFixed(1)}mm pipe-tee overlap. Half-C=${halfC ? halfC.toFixed(1) : "?"}mm.`,
    current, next,
  };
}
```

**Integration:** Call from `analyzeOverlap()` in the gap/overlap analyzer when one side is a TEE and the other is a PIPE. This should be checked BEFORE the generic R-OVR-01/02 logic:

```javascript
function analyzeOverlap(overlapAmt, context, current, next, cfg, log) {
  // Check tee boundary FIRST (R-OVR-05)
  const teeResult = checkROVR05(current, next, overlapAmt, context, cfg, log);
  if (teeResult) return teeResult;

  // Then generic overlap logic (R-OVR-01, R-OVR-02, R-OVR-03)
  // ... existing code ...
}
```

### 3.6 R-BRN-05 — Branch Chain Continuation

```javascript
registerRule("R-BRN-05");

function checkRBRN05(teeElement, branchChain, config, log) {
  if (!teeElement.bp || !branchChain || branchChain.length === 0) return;

  const branchFirst = branchChain[0].element;
  const branchEP1 = getEntryPoint(branchFirst);
  if (!branchEP1) return;

  const gap = vec.dist(teeElement.bp, branchEP1);
  const tolerance = config.smartFixer?.connectionTolerance ?? 25.0;

  if (gap > tolerance) {
    logRuleExecution("R-BRN-05", branchFirst._rowIndex,
      `ERROR [R-BRN-05 T4]: TEE branch point does not connect to first branch element. Gap=${gap.toFixed(1)}mm (tolerance=${tolerance}mm).`);
  }

  // Also check bore continuity at branch start
  if (branchFirst.bore && teeElement.branchBore &&
      branchFirst.bore !== teeElement.branchBore) {
    logRuleExecution("R-BRN-05", branchFirst._rowIndex,
      `WARNING [R-BRN-05]: TEE branch bore (${teeElement.branchBore}mm) ≠ first branch element bore (${branchFirst.bore}mm).`);
  }
}
```

**Integration:** Call inside `walkChain()` at the branch handling section (step F), after the branch chain is walked:

```javascript
// ─── F. BRANCH HANDLING (TEE) ───
if (type === "TEE") {
  const branchStart = graph.branchEdges.get(current._rowIndex);
  if (branchStart && !visited.has(branchStart._rowIndex)) {
    // ... create branch context, walk branch ...
    const branchChain = walkChain(branchStart, graph, branchCtx, visited, config, log);
    chain[chain.length - 1].branchChain = branchChain;

    // R-BRN-05: Validate branch connection
    checkRBRN05(current, branchChain, config, log);
  }
}
```

---

## 4. PROCESSING ORDER UPDATE

These rules integrate into the existing pipeline at specific points:

```
Step 4A: Build connectivity graph (dual strategy — §2)
  ├── R-TOP-03: Duplicate detection (pre-walk cleanup)
  │
Step 4B: Walk all chains
  ├── Per-element: R-CHN-06 (shared-axis snap — corrected §1.4)
  ├── Per-element: R-GEO-08 (coordinate magnitude — corrected §1.1)
  ├── Per-element: R-BRN-04 (branch perpendicularity — corrected §1.3)
  ├── Per-TEE:     R-BRN-05 (branch continuation — §3.6)
  ├── Per-chain:   R-SPA-01 (elevation consistency — §3.3)
  │
Step 4B.5 (NEW): Post-walk coordinate cleanup
  ├── R-SPA-02: Shared-axis snap across all chains (§3.1)
  ├── R-TOP-02: Orphan detection (§3.2)
  │
Step 4C: Run remaining rules (gap/overlap analysis)
  ├── R-OVR-05: Tee boundary overlap — check BEFORE generic R-OVR-01/02 (§3.5)
  │
Step 4D: Populate Fixing Action column
Step 4E: User reviews
Step 4F: Apply fixes
```

---

## 5. BENCHMARK TESTS FOR NEW RULES

Add these to the benchmark suite:

| Test ID | Rule | Input | Expected |
|---------|------|-------|----------|
| BM-SF-41 | R-SPA-02 | 5 pipes on Y-axis, one has X drifted 0.8mm | SNAP silent, X corrected |
| BM-SF-42 | R-SPA-02 | 5 pipes on Y-axis, one has X drifted 5mm | SNAP with warning |
| BM-SF-43 | R-SPA-02 | 5 pipes on Y-axis, one has X drifted 15mm | ERROR, no snap |
| BM-SF-44 | R-TOP-02 | 3 pipes connected + 1 at (50000,50000,50000) | Orphan flagged |
| BM-SF-45 | R-SPA-01 | Horizontal Y-run, one Z drifts 1.5mm | SNAP silent |
| BM-SF-46 | R-SPA-01 | Horizontal Y-run, one Z drifts 8mm | SNAP with warning |
| BM-SF-47 | R-TOP-03 | Two identical PIPE elements at same coords | Duplicate flagged |
| BM-SF-48 | R-OVR-05 | Pipe overlaps TEE by half-C (152mm for 300mm bore) | TRIM by half-C |
| BM-SF-49 | R-OVR-05 | Pipe overlaps TEE by 30mm (not half-C) | WARNING |
| BM-SF-50 | R-BRN-05 | TEE BP at (96400,16586,102273), branch EP1 at (96400,16586,102500) | ERROR (227mm gap) |
| BM-SF-51 | R-GEO-08 | Element with coordinate 600000mm | WARNING (>500k) |
| BM-SF-52 | R-BRN-04 | TEE branch 3° from perpendicular | PASS (< 5° threshold) |
| BM-SF-53 | R-BRN-04 | TEE branch 12° from perpendicular | WARNING (> 5°, < 15°) |
| BM-SF-54 | R-CHN-06 | 1.2mm Y-drift on X-axis pipe | SNAP silent (< 2mm) |
| BM-SF-55 | R-CHN-06 | 7mm Y-drift on X-axis pipe | SNAP with warning (2-10mm) |

---

## 6. RULE REGISTRY UPDATE

After implementing all corrections and new rules, the registry check should show:

```
Total rules: 97+
  V1–V20:     20 rules (all implemented)
  R-GEO-01–08: 8 rules (R-GEO-08 CORRECTED)
  R-TOP-01–07: 7 rules (R-TOP-02, R-TOP-03 NEW)
  R-CHN-01–06: 6 rules (R-CHN-06 CORRECTED)
  R-GAP-01–08: 8 rules
  R-OVR-01–06: 6 rules (R-OVR-05 NEW, no R-OVR-07)
  R-BRN-01–05: 5 rules (R-BRN-04 CORRECTED, R-BRN-05 NEW)
  R-SPA-01–05: 5 rules (R-SPA-01, R-SPA-02 NEW)
  R-DAT-01–06: 6 rules
  R-AGG-01–06: 6 rules
  R-PTE-*:     20+ rules
```

**Run `verifyAllRulesImplemented()` after applying these changes. Zero missing rules is the gate for proceeding.**

---

*End of Addon PCF-ADDON-003 Rev.0*
