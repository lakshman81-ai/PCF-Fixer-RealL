// ══════════════════════════════════════════════
// SMART FIXER — VECTOR MATH (Region A)
// ══════════════════════════════════════════════

export const vec = {
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
    scale: (v, s) => ({ x: v.x * s, y: v.y * s, z: v.z * s }),
    dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
    cross: (a, b) => ({
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    }),
    mag: (v) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z),
    normalize: (v) => {
      const m = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      return m > 0 ? { x: v.x / m, y: v.y / m, z: v.z / m } : { x: 0, y: 0, z: 0 };
    },
    dist: (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2),
    mid: (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }),
    approxEqual: (a, b, tol = 1.0) =>
      Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.z - b.z) <= tol,
    isZero: (v) => v.x === 0 && v.y === 0 && v.z === 0,
  };

/**
 * Ray Shooter Implementation
 * @param {Object} start Origin of the ray {x,y,z}
 * @param {Object} dir Normalized direction vector of the ray {x,y,z}
 * @param {number} tMax Maximum projection distance along the ray
 * @param {Array} pool Array of candidate component objects
 * @param {number} tubeTol Maximum perpendicular distance to count as a hit
 * @returns {Array} Array of hits: { component, EP, t, perpDist }
 */
export function rayShoot(start, dir, tMax, pool, tubeTol) {
    let hits = [];
    for (const C of pool) {
        // Collect all potential open endpoints from the candidate
        const endpoints = [];
        if (C.ep1) endpoints.push(C.ep1);
        if (C.ep2) endpoints.push(C.ep2);
        if (C.bp) endpoints.push(C.bp); // Branch points are valid targets

        for (const EP of endpoints) {
            if (vec.approxEqual(start, EP, 0.1)) continue; // Don't shoot yourself

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
