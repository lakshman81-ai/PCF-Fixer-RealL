# Revised Smart Fixer Logic & PTE Engine Architecture

## 1. Multi-Pass Workflow Context
The Smart Fixer operates in an explicit Two-Pass state machine natively handling "Safe" topological actions versus "Destructive/Ambiguous" geometry modifications.

**State Machine Execution:**
1. **Import & Validate (V1-V20):** Baseline logic checking element formats.
2. **PTE Setup:** Point-to-Element sweeps assign logic cases (A, B, D) based on `Line_Key` tracking before structural modifications occur.
3. **First Pass (Pipe Manipulation Only):**
   - Applies strict constraints (Bore Ratio limits between `0.7` and `1.5`).
   - Line_Key enforcement blocks disjointed branch pipelines from connecting inappropriately to main lines.
   - Gap checks trigger actions to Stretch or Trim strictly **only on `PIPE` elements**.
   - Generates proposals.
4. **Auto/Manual Approval:**
   - Structural fixes < `25mm` are designated for "Auto Approve First Pass".
   - Fixes > `20000mm` trigger Hard Rejections to prevent completely disconnected system loops.
   - User interacts with Data Table UI to Approve or Reject individually.
5. **Apply Fixes:**
   - Executing First Pass approvals natively modifies data, tagging rows conceptually (`_passApplied = 1`) yielding **Cyan color highlighting**.
6. **Second Pass (Fittings Manipulation):**
   - Enabled only after First Pass is complete.
   - Identical logic sweeps, but allows manipulation and analysis against non-pipe elements using derived proximity from Stage 1 resolutions.
   - Applied second-pass fixes are coded with **Purple color highlighting**.

## 2. Point-to-Element (PTE) Engine Implementation
The `pte-engine.js` operates structurally before geometric validation starts, assigning specific behavioral tracking parameters to each row:

* **CASE A/B(a):** Elements natively mapping to sequential Line_Key headers.
* **CASE B(b):** Elements sequentially linked but missing strict Line_Key definitions (fallback).
* **CASE D:** Elements identified as structural Orphans.

**Non-Sequential Sweep (Stage 2):**
CASE D elements initiate radial bounding volume queries relative to their known end points (`radiusMin` = `0.2 * Nominal Bore`, `radiusMax` = `13000mm`). Candidate lists are filtered algorithmically by `axis_sweep_score` maximizing collinear alignment between endpoints avoiding perpendicular misconfigurations.

## 3. Line_Key Configuration Settings
UI Config tabs explicitly govern PTE parameters:
* `AutoMultiPassMode`: Enables the sequential multi-pass application workflow.
* `Line_Key Target Column`: Maps the string key defining line isolation. Mappable from PIPELINE-REFERENCE, CA97 (RefNo), or CA98 (SeqNo).
* `Bore Ratio`: Clamped universally at 0.7 Min / 1.5 Max to prevent incompatible branching logic fixes.
