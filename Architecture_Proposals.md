# Architecture Proposals

## 1. Memory & Performance: O(N²) Optimization & The Spatial Search Dilemma

**Problem:**
Currently, spatial searches in `GraphBuilder.js` (`findNearestEntry`) and `pte-engine.js` (`sweepForNeighbor`) operate in an O(N) linear sweep for every element, resulting in an O(N²) time complexity. For PCF files exceeding 10,000 rows, this introduces significant UI freezing and runtime lag.

**Proposed Solution:**
Implement a space-partitioning data structure to reduce search complexity from O(N) to O(log N). Piping models (PCF files) are typically composed of extremely long, linear branches (pipelines) clustered along major axes, with vast amounts of empty space in between.

- **Octree vs. k-d Tree:** An Octree uniformly subdivides 3D space into cubes. Because pipes are so sparse and linear, an Octree wastes memory and traversal time on completely empty octants. Conversely, a **k-d tree (k=3)** partitions space based on the actual median distribution of the points. It perfectly adapts to long, dense linear pipe runs while ignoring empty space.
- **Implementation Strategy:**
  1. Write a bespoke 3D k-d tree (often <100 lines of code with zero dependencies).
  2. **Alternative (R-Tree Drop-in):** Utilize an off-the-shelf R-Tree implementation such as `rbush-3d`. Either structure will drop topological sweeps down to O(N log N).
- **Querying:** Before the `GraphBuilder` initiates its link-matching pass, load all valid `getEntryPoint()` and `getExitPoint()` coordinates into the tree for fast radius bounding-box searches.

## 2. Type Safety & Validation: Strict Payload Casting at the Ingestion Boundary

**Problem:**
JavaScript implicitly coercing `"150" + "150"` into `"150150"` instead of `300` is the root cause of countless silent failures in 3D math engines. Currently, implicit type coercion ruins vector math in complex files.

**Proposed Solution:**
Enforce the "Strict Archetypal Casting" doctrine using `Zod` as an absolute **Validation Barrier** (Anti-Corruption Layer) at the immediate entry point of file ingestion.
- **Transformation Pipeline:**
  ```javascript
  const VectorSchema = z.object({
    x: z.coerce.number(),
    y: z.coerce.number(),
    z: z.coerce.number()
  });

  const PcfElementSchema = z.object({
    type: z.string().toUpperCase(),
    bore: z.coerce.number().optional(),
    ep1: VectorSchema.optional(),
    ep2: VectorSchema.optional()
    // ...
  });
  ```
- **Validation Boundary:** By forcing `z.coerce.number()` at the edge, the entire internal engine (`GraphBuilder` and `SmartFixer`) can blindly trust that `ep1.x` is a guaranteed floating-point number. Discarding or flagging invalid rows *before* they hit the complex validation rules prevents cascading `NaN` explosions deep inside the multi-pass solver.