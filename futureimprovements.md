# Future Enhancements & Major Fixes

Based on the execution of the PCF Smart Fixer Accuracy Benchmark Suite (`BM1` through `BM6`), several complex topological anomalies require major architectural additions to the `SmartFixer` engine. These capabilities fall outside the scope of minor heuristics and demand dedicated logic modules.

## 1. Complex Synthesis: Injecting Synthetic Reducers (BM3)
Currently, when the topological graph encounters a sudden, un-bridged change in bore size (e.g., from `200mm` main line to `100mm` branch pipe), it flags an error but does not mutate the geometry.
**Required Enhancement:**
- The `PcfTopologyGraph2` or `GapOverlap` engine needs a dedicated "Bore Discrepancy" pass.
- When an immutable component (like a TEE) with a specific branch bore connects directly to a pipe of a different bore, the engine must automatically generate and inject a `REDUCER` component object.
- The `REDUCER` must correctly align its `ep1` and `ep2` based on the vector between the TEE and the PIPE, and accurately apply the `bore` to `ep1` and the `reducedBore` to `ep2`.

## 2. Complex Synthesis: Missing Component Assemblies (BM6)
The engine currently struggles to heal massive geometric gaps (e.g., >300mm) effectively when they occur on perpendicular axes or in complex branch assemblies. BM6 highlights a scenario where entire assemblies (like Relief Valves - RVs) are missing from the input PCF.
**Required Enhancement:**
- A new heuristics layer (potentially `AssemblySynthesis.js`) is needed to analyze large, multi-axis voids in the pipeline.
- Instead of just blindly injecting a `PIPE` to bridge a gap, the engine must recognize specific topological "signatures" (e.g., a void between two flanges, or a perpendicular branch drop).
- Based on these signatures, it should synthesize missing immutable components. For BM6, this means detecting the perpendicular gaps and injecting `SYNTH-VALVE-1` and `SYNTH-VALVE-2` into the `dataTable` to restore continuous flow without relying on linear pipe stretches.

## 3. Advanced Vector Priority for Multi-Axis Snapping
While BM2 dominant axis snapping was partially implemented, edge cases involving simultaneous rotations or non-orthogonal gaps require a more robust matrix-based snapping algorithm.
**Required Enhancement:**
- Upgrade `VectorMath.js` to handle strict orthogonal constraints (snapping to nearest 90/45 degree axis) when translating rigid blocks, to prevent the pipeline from skewing diagonally when healing gaps.

## 4. Phase 1 & 2 Advanced Sub-Topology Scenarios (`BM_P1_*`, `BM_P2_*`)
Based on the execution of `Phase1_2_Fixer_Guide.md`, several intricate routing failures require dedicated algorithms rather than simple endpoint distance checks:
* **Inline Intersections (Missing TEEs/OLETs):**
  - **The Gap:** The engine currently only looks at `ep1` and `ep2` of elements. It does not iterate over the full internal length of a `PIPE` vector to see if another pipe's endpoint falls exactly on its OD surface (a classic missing OLET or TEE scenario).
  - **Required Action:** Implement a ray-collision detection pass that checks all open `ep1`/`ep2` nodes against the internal volume/vector of all other pipes. If a collision is found, "shatter" the parent pipe into two segments and synthesize a `TEE` or `OLET` at the collision coordinates.
* **Foldback Detection:**
  - **The Gap:** A pipe that routes out 500mm and then routes exactly backwards 500mm (same coordinates, opposite vector) creates a 0 net-progression loop, often caused by bad CAD user clicks.
  - **Required Action:** Add a topological sanity check in `Validator.js` or `PcfTopologyGraph2.js` that flags any pipe whose `ep1` and `ep2` result in a delta vector that is the exact mathematical inverse of the preceding pipe, and propose a `DELETE` or `MERGE_FOLDBACK` action.
* **Flange-to-Flange Gap Interpolation:**
  - **The Gap:** Two flanges facing each other with a 3mm gap will currently either fail or attempt to stretch.
  - **Required Action (User Guideline Note):** The requirement stated that we *could* either inject a `GASKET` for 3mm gaps *or* stretch an EP. Since Flanges are immutable, stretching a Flange is physically impossible in reality (it's a cast iron/steel component). Therefore, the *sound technical reasoning* dictates we either:
    1. Translate the Flange block 3mm (if the downstream pipe can stretch to absorb it).
    2. Or explicitly inject a `GASKET` component into the data table.
    We will pursue the `GASKET` injection for small `< 5mm` flange gaps in future phases to preserve immutable lengths.
