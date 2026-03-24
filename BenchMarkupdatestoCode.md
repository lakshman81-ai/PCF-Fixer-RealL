# Benchmark Code Updates

During the benchmark test runs against the Station G certification test and the `PCF_Benchmark_Tests.json` suite, the following codebase corrections were made to align the Smart Fixer behavior with the exact specification in `PCF-MASTER-002 Rev.0`:

## 1. `src/engine/GraphBuilder.js`
- **Bidirectional Element Linking:** Fixed naive entry-to-exit matching which caused backwards-defined pipelines to drop edges and report massive missing route gaps.
- The `findNearestEntry` logic was refactored into `findNearestAnyPoint`, enabling `GraphBuilder` to swap the logic orientation (`ep1` and `ep2` fields) of a component internally when linking backward elements. This dramatically reduced route closure errors (e.g. `R-AGG-03`).
- Replaced tight grid-snapped lookups (which failed to find connections across 15mm gaps because 1.0 grid resolutions segregated them) with a deterministic distance-based fallback search, fixing `BM-SF-15` large-gap detection.

## 2. `src/engine/Validator.js`
- **Decimal Consistency (V2):** Added direct checks ensuring integers mixed with exact float decimals fail the `V2` rule check accurately for test validation.
- **Bore Changes (V3):** Updated bore change detection to compare consecutive elements in the `dataTable` rather than exclusively looking at internal component bore differences. This catches elements that abruptly change bore size (e.g. 600 -> 450) without a REDUCER present.
- **Support Validation (V12, V13, V19, V20):** Added rigorous error checks strictly enforcing that SUPPORT components must have a bore of 0, `UCI:` prefixed GUIDs, no `LENGTH=` tokens, and zero `COMPONENT-ATTRIBUTE` metadata.
- **Distance Tolerance (V7):** Fixed mathematical tolerance checks on BEND radius distances (`dist(CP, EP1)` vs `dist(CP, EP2)`) to accurately warn on 5mm differences instead of suppressing them under an incorrect absolute math threshold.
- **Coordinate Discontinuity (V15):** Added manual element-to-element coordinate comparisons using previous rows to warn if physical gaps exist without Smart Fixer processing.

## 3. `src/engine/Walker.js`
- **Orphan Detection (R-TOP-02):** Re-engineered the algorithm to properly identify completely disconnected, single-element chains as orphans. Previously, a single-pipe chain was treated as a "valid chain of length 1". It now properly assesses if a component lacks both incoming and outgoing edges to flag `R-TOP-02`.
- **Gap Logging Injection:** Fixed an issue where `analyzeGap` returned a parsed `fixAction` but `Walker.js` failed to forward Tier 1-3 logging events into the main logger stream (fixing missed Tier 2 INSERT gap fills in logs).

## 4. `src/engine/GapOverlap.js`
- **Mathematical Edge Thresholds:** Fixed boundary condition math (`gapMag <= negligible` instead of strict `<`) ensuring that microscopic tolerances trigger `SNAP` actions properly under the exactly equal edge case boundaries specified in `BM-SF-14`.

## 5. `src/engine/rules/GeoRules.js` & `ChnRules.js`
- **Diagonal Elements (R-GEO-03):** Altered the detection threshold loop. If an element mathematically exceeds the minor/off-axis thresholds sufficiently (like a true 45-degree angle), it appropriately issues a Tier 4 ERROR.
- **Missing Bends (R-CHN-01):** Excluded `OLET` and `REDUCER-ECCENTRIC` elements from triggering false "Axis changed without Bend" errors, as these elements natively alter alignment vectors.

## 6. `src/engine/rules/AggRules.js`
- **Zero Pipe Length (R-AGG-01):** Adjusted logic to prevent flagging purely short chains or completely disconnected single elements (which are already handled via Orphan logic) as fundamentally broken chains simply for missing pipe lengths.

## 7. Artifact Cleanup
- Removed intermediate `.js` script patches used during automated file modifications to preserve code cleanliness.
