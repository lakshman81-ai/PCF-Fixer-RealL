# Ray Shooter Integration Plan

## 1. Concept Mapping to Current Architecture
The provided "Ray Shooter v1" design spec introduces a vector-based collision detection approach to gap filling, conceptually splitting the data into "Stage 1A" (resolved) and "Stage 1B" (unresolved/orphans).

In our current `PcfTopologyGraph2` engine, this conceptually maps to:
*   **Stage 1A (Resolved):** Components that successfully paired sequentially in `Pass 1` (or have no open endpoints).
*   **Stage 1B (Orphans):** Components that still have un-bridged, open endpoints after Pass 1 (what our engine currently processes in Pass 2).

The core of the "Ray Shooter" is projecting a vector (the ray) from an open endpoint (`ray_start`) along a specified direction (`dir`) up to a maximum distance (`t_max`, 20000mm) and finding the closest valid endpoint within a perpendicular "tube" (`tube_tol`, 25mm).

## 2. Integration into `PcfTopologyGraph2`
The Ray Shooter will be implemented as a new specific pass — **Pass 1C: Ray Shooter Gap Resolution**. It will execute *after* Pass 1 (Sequential) and *before* Pass 2 (Fuzzy Global Search). By doing so, it attempts to bridge multi-axis or long-distance linear gaps mathematically before falling back to the less-accurate proximity-based "fuzzy" sweeps.

### 2.1 Configuration Additions
We will add a new nested object to `AppContext.jsx` -> `config.smartFixer`:
```javascript
rayShooter: {
    enabled: true,
    tubeTolerance: 25.0,
    pass1SameBore: true,
    pass2AnyBore: true,
    pass3Resolved: false,
    pass4GlobalAxis: true,
}
```
These settings will be exposed in `ConfigTab.jsx`.

### 2.2 Endpoint Logic & Direction Vectors
Currently, our components calculate `deltaX/Y/Z` in the Data Processor. To support the Ray Shooter, we will need to extract the normalized direction vector (`Len_Vec` cosines) for each component.
- For `PIPE`, the vector is simply `normalize(ep2 - ep1)`.
- The "known sequential match" direction (as per the spec) can be derived by checking if the orphan was previously connected on its *other* endpoint. If a component `A` is connected to `B` at `ep1`, but `ep2` is an orphan, the "known direction" for `ep2` is `normalize(A.ep2 - A.ep1)`.

### 2.3 The `shoot()` Function
We will create a new utility function `rayShoot(start, dir, tMax, pool, tubeTol)` in `PcfTopologyGraph2.js`.
```javascript
function rayShoot(start, dir, tMax, pool, tubeTol) {
    let hits = [];
    for (const C of pool) {
        const endpoints = [C.ep1, C.ep2, C.bp].filter(Boolean); // Only check valid open endpoints
        for (const EP of endpoints) {
            // Vector from start to target EP
            const diff = vec.sub(EP, start);

            // t is the projection length of diff onto the ray direction (dot product)
            const t = vec.dot(diff, dir);
            if (t <= 0 || t > tMax) continue; // Behind ray or too far

            // perpendicular distance = || diff - t * dir ||
            const projection = vec.scale(dir, t);
            const perpDist = vec.mag(vec.sub(diff, projection));

            if (perpDist <= tubeTol) {
                hits.push({ component: C, EP, t, perpDist });
            }
        }
    }
    return hits;
}
```

### 2.4 Implementing Passes 1-4
Inside `PcfTopologyGraph2`:
1.  **Identify Orphans:** Gather all components with endpoints that are not part of an existing `Pass 1` proposal and have no immediate touching neighbors.
2.  **Iterate Orphans:** For each orphan endpoint:
    -   *Pass 1:* `shoot()` against other orphans with exact `bore` match. If hit -> generate `GAP_FILL` proposal.
    -   *Pass 2:* `shoot()` against other orphans of *any* bore. If hit -> generate `GAP_FILL` proposal + Flag for REDUCER injection.
    -   *Pass 3:* `shoot()` against all resolved components (risky, if config enabled).
    -   *Pass 4:* If no hits, shoot along cardinal axes (+X, -X, +Y, -Y, +Z, -Z).
3.  **Reducer Injection:** The spec calls for injecting a `REDUCER`. We will map this to our existing Pass 3A synthesis logic, or create a specific `GAP_FILL_REDUCER` action type that `applyApprovedMutations` understands.

## 3. Proposal Action
Once the plan is approved, I will:
1. Update `AppContext.jsx` and `ConfigTab.jsx` with the UI toggles.
2. Build the `rayShoot` math function.
3. Integrate "Pass 1C: Ray Shooter" into `PcfTopologyGraph2.js`.