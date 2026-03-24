// @ts-check
/** @typedef {import('./types.js').PcfCoord} PcfCoord */
/** @typedef {import('./types.js').PcfComponent} PcfComponent */

/**
 * Pathfinder.js
 *
 * 3D axis-aligned A* pathfinder for routing pipe segments around component
 * bounding-box obstacles.  Used by GapOverlap.analyzeGap() for multi-axis
 * gaps where a single straight fill is not possible.
 *
 * The world is discretised into a voxel grid (cell size = gridResolution mm).
 * Component bounding boxes are inflated by one cell and marked as obstacles.
 * The path is restricted to axis-aligned (+X/-X/+Y/-Y/+Z/-Z) moves only,
 * producing segments that are always orthogonal — compatible with piping runs.
 *
 * Public API
 * ──────────
 *   findPath(start, end, obstacles, options) → PathResult | null
 *
 *   PathResult = {
 *     waypoints: [{x,y,z}, ...],   // includes start and end
 *     segments:  [{from,to,axis,dir,length}, ...],
 *   }
 *
 * Options
 * ───────
 *   gridResolution  mm per cell   (default 100)
 *   maxCells        search limit  (default 8000)
 *   maxDistance     skip if start-end > this mm (default 20000)
 */

// ─────────────────────────────────────────────────────────────
// Tiny min-heap (priority queue)
// ─────────────────────────────────────────────────────────────
class MinHeap {
  constructor() { this._d = []; }
  push(item) {
    this._d.push(item);
    this._bubbleUp(this._d.length - 1);
  }
  pop() {
    const top = this._d[0];
    const last = this._d.pop();
    if (this._d.length > 0) { this._d[0] = last; this._siftDown(0); }
    return top;
  }
  get size() { return this._d.length; }
  _bubbleUp(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._d[p].f <= this._d[i].f) break;
      [this._d[p], this._d[i]] = [this._d[i], this._d[p]]; i = p;
    }
  }
  _siftDown(i) {
    const n = this._d.length;
    for (;;) {
      let m = i, l = 2*i+1, r = 2*i+2;
      if (l < n && this._d[l].f < this._d[m].f) m = l;
      if (r < n && this._d[r].f < this._d[m].f) m = r;
      if (m === i) break;
      [this._d[m], this._d[i]] = [this._d[i], this._d[m]]; i = m;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function dist3(a, b) {
  const dx = a.x-b.x, dy = a.y-b.y, dz = a.z-b.z;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

function manDist(ax, ay, az, bx, by, bz) {
  return Math.abs(ax-bx) + Math.abs(ay-by) + Math.abs(az-bz);
}

/** World coordinate → grid cell index */
function w2g(v, origin, res) {
  return Math.round((v - origin) / res);
}

/** Grid cell index → world coordinate (cell centre) */
function g2w(i, origin, res) {
  return origin + i * res;
}

const DIRS = [
  [1,0,0,'X', 1], [-1,0,0,'X',-1],
  [0,1,0,'Y', 1], [0,-1,0,'Y',-1],
  [0,0,1,'Z', 1], [0,0,-1,'Z',-1],
];

// ─────────────────────────────────────────────────────────────
// Build obstacle set from bounding boxes
// ─────────────────────────────────────────────────────────────
/**
 * @param {Array<{min:{x,y,z}, max:{x,y,z}}>} boxes
 * @param {{x,y,z}} origin  — grid origin (world)
 * @param {number} res      — mm per cell
 * @returns {Set<string>}   — "ix,iy,iz" strings
 */
function buildObstacleSet(boxes, origin, res) {
  const obs = new Set();
  for (const { min, max } of boxes) {
    const x0 = Math.floor((min.x - origin.x) / res) - 1;
    const y0 = Math.floor((min.y - origin.y) / res) - 1;
    const z0 = Math.floor((min.z - origin.z) / res) - 1;
    const x1 = Math.ceil ((max.x - origin.x) / res) + 1;
    const y1 = Math.ceil ((max.y - origin.y) / res) + 1;
    const z1 = Math.ceil ((max.z - origin.z) / res) + 1;
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++)
        for (let iz = z0; iz <= z1; iz++)
          obs.add(`${ix},${iy},${iz}`);
  }
  return obs;
}

/**
 * Derive axis-aligned bounding boxes from PCF component rows.
 * Uses ep1/ep2/cp/bp to construct AABB with a small margin.
 *
 * @param {PcfComponent[]} rows
 * @param {number} margin   — extra clearance in mm
 * @returns {Array<{min:PcfCoord, max:PcfCoord}>}
 */
export function rowsToBoundingBoxes(rows, margin = 50) {
  const boxes = [];
  for (const r of rows) {
    const pts = [r.ep1, r.ep2, r.cp, r.bp].filter(Boolean);
    if (pts.length === 0) continue;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const p of pts) {
      const x = p.x ?? 0, y = p.y ?? 0, z = p.z ?? 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    // Inflate by bore radius + margin for a clearance envelope
    const inflate = (r.bore ? r.bore / 2 : 0) + margin;
    boxes.push({
      min: { x: minX - inflate, y: minY - inflate, z: minZ - inflate },
      max: { x: maxX + inflate, y: maxY + inflate, z: maxZ + inflate },
    });
  }
  return boxes;
}

// ─────────────────────────────────────────────────────────────
// A* search
// ─────────────────────────────────────────────────────────────
/**
 * Find an axis-aligned path from `start` to `end` avoiding `obstacles`.
 *
 * @param {PcfCoord} start
 * @param {PcfCoord} end
 * @param {Array<{min:PcfCoord, max:PcfCoord}>} obstacles   — bounding boxes
 * @param {{ gridResolution?: number, maxCells?: number, maxDistance?: number }} options
 * @returns {{ waypoints: PcfCoord[], segments: {from:PcfCoord, to:PcfCoord, axis:string, dir:number, length:number}[] } | null}
 */
export function findPath(start, end, obstacles = [], options = {}) {
  const res    = options.gridResolution ?? 100;
  const maxN   = options.maxCells      ?? 8000;
  const maxD   = options.maxDistance   ?? 20000;

  // Bail if too far apart
  if (dist3(start, end) > maxD) return null;

  // Grid origin = min corner of start/end bounding box with padding
  const origin = {
    x: Math.min(start.x, end.x) - res * 4,
    y: Math.min(start.y, end.y) - res * 4,
    z: Math.min(start.z, end.z) - res * 4,
  };

  const obs = buildObstacleSet(obstacles, origin, res);

  // Snap start/end to grid
  const sx = w2g(start.x, origin.x, res);
  const sy = w2g(start.y, origin.y, res);
  const sz = w2g(start.z, origin.z, res);
  const ex = w2g(end.x,   origin.x, res);
  const ey = w2g(end.y,   origin.y, res);
  const ez = w2g(end.z,   origin.z, res);

  if (sx === ex && sy === ey && sz === ez) {
    // Already at destination on grid
    return { waypoints: [start, end], segments: buildSegments([start, end]) };
  }

  const startKey = `${sx},${sy},${sz}`;
  const endKey   = `${ex},${ey},${ez}`;

  const gScore = new Map([[startKey, 0]]);
  const cameFrom = new Map();
  const open = new MinHeap();
  open.push({ f: manDist(sx,sy,sz,ex,ey,ez), ix: sx, iy: sy, iz: sz });

  let evaluated = 0;
  while (open.size > 0 && evaluated < maxN) {
    const { ix, iy, iz } = open.pop();
    evaluated++;
    const key = `${ix},${iy},${iz}`;

    if (key === endKey) {
      // Reconstruct path
      const gridPath = [];
      let cur = endKey;
      while (cur) {
        const [gx, gy, gz] = cur.split(',').map(Number);
        gridPath.push({ x: g2w(gx, origin.x, res), y: g2w(gy, origin.y, res), z: g2w(gz, origin.z, res) });
        cur = cameFrom.get(cur);
      }
      gridPath.reverse();
      // Replace snapped start/end with exact world coords
      gridPath[0] = start;
      gridPath[gridPath.length - 1] = end;
      const simplified = simplifyPath(gridPath);
      return { waypoints: simplified, segments: buildSegments(simplified) };
    }

    const g = gScore.get(key) ?? Infinity;

    for (const [dx, dy, dz] of DIRS) {
      const nx = ix+dx, ny = iy+dy, nz = iz+dz;
      const nk = `${nx},${ny},${nz}`;
      if (obs.has(nk)) continue;
      const ng = g + 1;
      if (ng >= (gScore.get(nk) ?? Infinity)) continue;
      gScore.set(nk, ng);
      cameFrom.set(nk, key);
      open.push({ f: ng + manDist(nx,ny,nz,ex,ey,ez), ix: nx, iy: ny, iz: nz });
    }
  }

  return null; // No path found within search budget
}

// ─────────────────────────────────────────────────────────────
// Path post-processing
// ─────────────────────────────────────────────────────────────

/** Remove collinear intermediate waypoints (same axis direction). */
function simplifyPath(pts) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = out[out.length - 1];
    const cur  = pts[i];
    const next = pts[i + 1];
    // Keep if direction changes
    const d1x = Math.sign(cur.x - prev.x), d1y = Math.sign(cur.y - prev.y), d1z = Math.sign(cur.z - prev.z);
    const d2x = Math.sign(next.x - cur.x), d2y = Math.sign(next.y - cur.y), d2z = Math.sign(next.z - cur.z);
    if (d1x !== d2x || d1y !== d2y || d1z !== d2z) out.push(cur);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Convert waypoint list into segment descriptors. */
function buildSegments(pts) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const from = pts[i], to = pts[i + 1];
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    let axis, dir, length;
    if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) >= Math.abs(dz)) {
      axis = 'X'; dir = Math.sign(dx); length = Math.abs(dx);
    } else if (Math.abs(dy) >= Math.abs(dz)) {
      axis = 'Y'; dir = Math.sign(dy); length = Math.abs(dy);
    } else {
      axis = 'Z'; dir = Math.sign(dz); length = Math.abs(dz);
    }
    if (length > 0.5) segs.push({ from, to, axis, dir, length });
  }
  return segs;
}
