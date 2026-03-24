# Technical Audit: PCF-CSV-Table-Formatter vs PTE_CONVERSION_RULES_v2.md

This document serves as a technical audit of the `PCF-CSV-Table-Formatter` repository (specifically the `src/core/pte/` modules) against the specifications detailed in `PTE_CONVERSION_RULES_v2.md` (PCF-PTE-002 Rev.0).

---

## 1. Identified Missing Functionality

The current implementation has significant gaps when compared to the strict logic defined in the `PTE_CONVERSION_RULES_v2.md` specification.

### 1.1 Incomplete Implementation of Case B (Sequential Generation)
- **Generic Handling of Complex Components:** In `caseB.js`, `OLET`, `TEE`, and `ELBO` are grouped together and given "generic 1 points to satisfy pipeline". This directly violates **R-PTE-36** and **R-PTE-37**, which mandate the calculation of `CP` (Center Point) and `BP` (Branch Point) for TEEs/BENDs, and zero-length header definitions for OLETs.
- **Incomplete PPoint Inversion (R-PTE-33):** The `determinePPointEntry` function in `caseB.js` attempts to implement §3.2 (Invert at flange pairs) but admits in comments: *"Need prev_prev to be checked in real logic, but without full chain access here we do best effort"*. This means flanged assemblies with gaskets (FLANGE -> GASKET -> VALVE) will incorrectly assign PPoints, breaking directional flow.
- **Missing Implicit Pipes (R-PTE-35):** The spec requires that an `ANCI` or `OLET` followed by a non-point type must generate an *implicit pipe* between them. This generation logic is completely absent in `caseB.js`.

### 1.2 Incomplete Implementation of Case D (Orphan Sweep)
- **Missing Sub-Chain Recovery:** In `pureOrphanSweep` (`caseD.js`), Step 3 of the specification (Handle remaining orphans by attempting sub-chains) is missing. It simply returns `remainingOrphans` without attempting to link them together if they form a disconnected island.
- **Missing Bore Consistency Checks:** The axis sweep scoring (`sweepForNeighbor` in `caseD.js`) implements the 70% axis bonus and 5x fold-back penalty, but the optional (yet highly recommended) bore consistency check (`if candidate.bore == current.bore: score *= 0.9`) is omitted, increasing the risk of attaching a 50mm branch pipe to a 350mm header end simply due to spatial proximity.

---

## 2. Bugs in Present Code

1.  **Broken Return Signature in `pureOrphanSweep`:**
    - `twoPassOrphanSweep` returns `{ orderedChains }`.
    - `pureOrphanSweep` returns `{ pureChains: chains, remainingOrphans }`.
    - However, `runPTEConversion` in `index.js` assigns both directly to `resultTable` without destructuring. This means when `pureOrphanSweep` runs, `resultTable` becomes an object instead of an array, causing the downstream `mapToDataTable` (which expects an iterable array of elements) to crash or fail silently.
2.  **Missing Log Reference in Sweep Ambiguity:**
    - In `caseD.js`, the `sweepForNeighbor` function checks for ambiguities: `if (closeMatches.length > 1 && config && config.log) { // Could log ambiguity warning here if log array is available }`.
    - The `log` array is passed to `twoPassOrphanSweep` and `pureOrphanSweep` from `index.js`, but it is **not** passed down into the `orphanSweep` or `sweepForNeighbor` functions. Thus, ambiguity warnings (required by **R-PTE-54**) are never recorded.

---

## 3. Debug & Logging Improvements

The current logging is superficial (e.g., `PTE Conversion started. Detected Case: CASE_D_a`). To meet enterprise standards and the spec's requirements, the logging framework must be overhauled:

1.  **Sweep Radius Tracing:** When a sweep escalates to a wider radius (e.g., from `1.0*NB` to `10.0*NB`), it must emit a `[Trace]` log indicating the radius expansion and the ID of the orphaned component.
2.  **Score Breakdowns:** When attaching an orphan in Pass 2 of `CASE_D_a`, the log must emit the exact distance and the penalty/bonus applied (e.g., `[Info] Attached Seq 4 to Line 100 at pos 2. Dist: 45mm. Score: 13.5 (50% Axis Penalty)`).
3.  **Cross-Line Warnings:** In `pureOrphanSweep` (`CASE_D_b`), a critical `[Warning]` must be emitted at the start of execution: *"Non-sequential data without Line_Key. Topology-only reconstruction. Higher risk of cross-line errors."* as mandated by the spec.

---

## 4. Solid Benchmarking Methods

To ensure the PTE engine behaves correctly, you must establish isolated benchmark datasets covering the specific cases defined in `PTE_CONVERSION_RULES_v2.md`.

### Proposed Benchmarking Method
Implement a Jest-based test suite that feeds raw CSV row arrays into `runPTEConversion` and asserts the resulting topology connections.

**Sample Benchmark 1: Sequential Flow with PPoint Inversion (Case B)**
*Input CSV (Simulated):*
```csv
Type,Line_Key,Bore,coord
PIPE,L1,100,"(0,0,0)"
FLANGE,L1,100,"(1000,0,0)"
GASKET,L1,100,"(1010,0,0)"
VALVE,L1,100,"(1013,0,0)"
```
*Expected Output Assertions:*
- PIPE `EP1` is (0,0,0), `EP2` is (1000,0,0).
- FLANGE `PPoint` is 1.
- VALVE `PPoint` is 2 (Inverted due to FLANGE+GASKET proximity).

**Sample Benchmark 2: Non-Sequential Orphan Sweep (Case D)**
*Input CSV (Simulated - Randomized Order):*
```csv
Sequence,Type,Bore,coord
1,PIPE,100,"(0,0,0)"
2,PIPE,100,"(2000,0,0)"
3,FLANGE,100,"(1000,0,0)"
```
*Expected Output Assertions:*
- The engine must reconstruct the chain as `Seq 1 -> Seq 3 -> Seq 2` based purely on coordinate proximity and the 0.2xNB / 1.0xNB sweep radii.

---

## 5. Further Recommendations

1.  **Implement a Lookbehind Buffer for Case B:** To correctly implement the flange/gasket PPoint inversion rule, `caseB.js` cannot rely solely on the immediate `prev` element. It needs access to a moving window of the last 3 elements added to the chain.
2.  **Unify the Return Signatures:** Fix the bug in `caseD.js` so that all sweep functions return a standardized flat array of ordered component sequences, which `assembleElements` can then correctly process.
3.  **Extract Scoring Logic:** The hardcoded `score *= 0.3` multipliers in `caseD.js` should be pulled from `config.pte.scoring` as defined in Section 12 of the spec, allowing users to tweak the aggressiveness of the topology sweep via UI configurations.