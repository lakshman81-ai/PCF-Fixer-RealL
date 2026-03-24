# PCF Smart Fixer Accuracy Benchmark Suite

This suite contains 6 specifically crafted PCF files designed to test the Smart Fixer engine against complex topological and syntactic anomalies. Each input file has a corresponding `_Fixed` file representing the ideal parsed and corrected state.

## BM1: Gaps & Overlaps (`BM1_Gaps_Overlaps.pcf`)
* **Expected Errors:**
    * 5mm gap between `PIPE-1` and `PIPE-2`.
    * 500mm gap between `FLG-2` and `PIPE-3`.
    * 500mm overlap between `PIPE-3` and `PIPE-4`.
* **Fixes to be taken:**
    * Snap the 5mm gap by translating the start point of `PIPE-2`.
    * Bridge the 500mm gap (either by extending `PIPE-3` backwards or inserting a synthetic pipe spool).
    * Trim the 500mm overlap by shortening `PIPE-4`.

## BM2: Complex Gaps (`BM2_MultiAxis_NonPipeGaps.pcf`)
* **Expected Errors:**
    * A multi-axis 3D gap between `PIPE-1` and `PIPE-2` (`dx=10, dy=20, dz=15`).
    * A 60mm gap between `FLG-1` and `VAL-1` (non-pipe component gap > 50mm).
* **Fixes to be taken:**
    * The multi-axis gap should snap the pipe end-points together, strictly prioritizing the dominant axis vector.
    * The 60mm gap between the rigid non-pipe components should trigger a block-translation to snap the Valve to the Flange face.

## BM3: Tee Anomalies & Missing Reducer (`BM3_TeeAnomalies_MissingReducer.pcf`)
* **Expected Errors:**
    * `TEE-1` has a corrupted `CENTRE-POINT` (`9999.0 9999.0 9999.0`).
    * `TEE-1` is entirely missing its `BRANCH1-POINT` declaration.
    * The branch pipe (`PIPE-3`) is 100mm bore, while the main line is 200mm bore, but no `REDUCER` exists to bridge them.
* **Fixes to be taken:**
    * Re-calculate the Tee Centre Point using line intersection maths.
    * Reconstruct the `BRANCH1-POINT` and infer its bore from the connected branch pipe.
    * Inject a synthetic `REDUCER` component to transition from 200mm to 100mm bore.

## BM4: Elbow Anomalies & Missing Ref Nos (`BM4_ElbowCP_MissingRefNo.pcf`)
* **Expected Errors:**
    * `ELB-1` is missing its `CENTRE-POINT` entirely.
    * Several components (`PIPE-1`, `FLG-1`) are missing `ITEM-CODE` and `PIPELINE-REFERENCE`.
* **Fixes to be taken:**
    * Synthesize the Elbow Centre Point using ray-tracing from the two end points.
    * Generate fallback Reference Numbers (`UNKNOWN-PIPE-1`, `UNKNOWN-FLANGE-1`) to prevent mapping crashes.

## BM5: Olet Syntax & Message Square (`BM5_OletSyntax_MsgSquare.pcf`)
* **Expected Errors:**
    * `OLET-1` has missing bore diameters on its End Points.
    * `OLET-1` has a malformed `MESSAGE-SQUARE` property (`X 1000.0 Y 0 Z 0`).
    * `OLET-1` is missing a `CENTRE-POINT`.
* **Fixes to be taken:**
    * Infer the Olet bores from the connected Main Pipe and Branch Pipe.
    * Strip the malformed `X/Y/Z` characters from the `MESSAGE-SQUARE` attribute and normalize the coordinates.
    * Inject the missing Centre Point based on the Main Line intersection.

## BM6: Missing RV Assembly (`BM6_MissingRVAssembly.pcf`)
* **Expected Errors:**
    * A complex branch setup with two 300mm geometric gaps occurring simultaneously on perpendicular axes (Z-axis and X-axis).
    * These gaps simulate two completely missing Relief Valves in an assembly.
* **Fixes to be taken:**
    * Detect the massive gaps and inject Synthetic Valves (`SYNTH-VALVE-1`, `SYNTH-VALVE-2`) to bridge the physical void and restore continuous topology flow.
