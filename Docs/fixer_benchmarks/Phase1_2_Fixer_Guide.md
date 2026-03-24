# PCF Smart Fixer - Phase 1 & 2 Benchmark Suite

This suite contains 3 distinct PCF benchmark cases designed specifically to test the behavior of the `PCF-Converter-Fixer_M_P1` engine, mimicking real-world extreme anomalies observed in `054513.png`, `055200.png`, and `054314.png`.

## Case 1: Phase 1 Gaps, Overlaps & Foldbacks (`BM_P1_Gaps_Overlaps.pcf`)
* **Mimics:** Screenshot `054513.png`
* **Scenarios Injected:**
  * Valid Gaps: 1mm (Pipe-to-Pipe), 5mm (Pipe-to-Valve), 70mm (Valve-to-Pipe), 1000mm (Pipe-to-Bend).
  * Valid Overlap: 200mm Pipe-to-Pipe overlap.
  * Foldback: A pipe that doubles back on itself (`PIPE-6`).
  * Invalid/Extreme Cases: A 5000mm massive gap, and a 4000mm massive overlap.
* **Validation Expected (Fixer Action):**
  * **1-70mm gaps:** Should be auto-snapped by stretching the corresponding pipe segment in Phase 1. Valves should translate to close the gap on the connecting side.
  * **1000mm gap:** Should inject a synthetic `PIPE` spool to bridge the gap (stretch threshold exceeded).
  * **200mm overlap:** Should trim the overlapping pipe.
  * **Foldback (`PIPE-6`):** The engine should detect a zero-length net progression and delete/merge the foldback segment.
  * **Extreme Cases (5000mm gap, 4000mm overlap):** The engine **must** flag these as invalid/anomalies in the UI (Stage-2 Errors) and require manual user approval. They should NOT be auto-fixed by default.

## Case 2: Phase 1 Huge Skews & Missing Components (`BM_P1_HugeSkews_Missing.pcf`)
* **Mimics:** Screenshot `055200.png`
* **Scenarios Injected:**
  * Missing Tee: A branch pipe starts on the main run, but the main run doesn't break and no TEE exists.
  * Massive Skew: A pipe endpoint jumps diagonally 10,000mm across the X, Y, and Z axes incorrectly.
  * "Dots No Pipes": Isolated Flanges and Valves suspended in space with 1950mm and 2700mm gaps between them.
  * Missing Olet: A small bore pipe branch starts 50mm off the surface of a larger pipe without an OLET fitting.
* **Validation Expected (Fixer Action):**
  * **Missing Tee:** The engine must detect the intersection, shatter the main pipe into `PIPE-1` and `PIPE-1-SPLIT`, and inject `SYNTH-TEE-1`.
  * **Massive Skew:** The engine must flag the `PIPE-SKEW` as an invalid geometry anomaly. It must **not** attempt to auto-orthogonalize a 10km skew without explicit user approval.
  * **Dots No Pipes:** Phase 1 should bridge these large voids between non-pipe components by injecting synthetic pipes (`SYNTH-PIPE-1`, `SYNTH-PIPE-2`) to reconnect the fittings.
  * **Missing Olet:** Inject `SYNTH-OLET-1`, snapping to the exact pipe surface (OD calculation).

## Case 3: Phase 2 Fittings & Missing Valves (`BM_P2_Fittings_MissingValves.pcf`)
* **Mimics:** Screenshot `054314.png`
* **Scenarios Injected:**
  * Flange-to-Flange gaps: 1mm, 3mm, 50mm, and 500mm.
  * Broken Geometry at Bend: A 10mm gap leading into an elbow, a missing CP, and a 10mm skew coming out of the elbow.
  * Floating Olet: An OLET placed 80mm from the center, where the pipe OD is actually 75mm (floating 5mm off the pipe surface).
* **Validation Expected (Fixer Action):**
  * **1mm Flange Gap:** Snap flange faces together (translation).
  * **3mm Flange Gap:** Inject a synthetic `GASKET` (Standard thickness resolution).
  * **50mm Flange Gap:** Too large for a gasket. Inject a small synthetic spool pipe.
  * **500mm Flange Gap:** A massive gap between two flanges strongly implies a missing Valve or Strainer. Inject a `SYNTH-VAL-1` to act as a placeholder.
  * **Broken Bend:** Snap the disjointed pipes to orthogonal vectors, reconstructing the missing `CENTRE-POINT` using ray intersections.
  * **Floating Olet:** Correct the OLET start point by calculating the exact `(Bore / 2)` of the main pipe and snapping it 5mm down to rest exactly on the pipe OD.
