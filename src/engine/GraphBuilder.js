import { vec } from '../math/VectorMath.js';
import { KDTree } from '../math/KDTree.js';

export function buildConnectivityGraph(dataTable, config) {
  const tolerance = Number(config?.smartFixer?.connectionTolerance ?? 25.0);

  // Step 1: Classify connection points per component
  const components = dataTable
    .filter(row => row.type && !["ISOGEN-FILES","UNITS-BORE","UNITS-CO-ORDS",
      "UNITS-WEIGHT","UNITS-BOLT-DIA","UNITS-BOLT-LENGTH",
      "PIPELINE-REFERENCE","MESSAGE-SQUARE"].includes(row.type.toUpperCase()))
    .map(row => ({
      ...row,
      entryPoint: getEntryPoint(row),
      exitPoint: getExitPoint(row),
      branchExitPoint: getBranchExitPoint(row), // null except for TEE
    }));

  // Step 2: Build O(N log N) spatial KD-Tree for entry points
  const kdPoints = [];
  for (const comp of components) {
    if (comp.entryPoint && !vec.isZero(comp.entryPoint)) {
      kdPoints.push({ coord: comp.entryPoint, element: comp });
    }
  }
  const entryTree = new KDTree(kdPoints);

  // Step 3: Match exits to entries (build edges)
  const edges = new Map();      // comp._rowIndex → next comp
  const branchEdges = new Map(); // comp._rowIndex → branch start comp (TEE only)
  const hasIncoming = new Set(); // row indices that have an incoming connection

  for (const comp of components) {
    if (!comp.exitPoint || vec.isZero(comp.exitPoint)) continue;

    const match = entryTree.findNearest(comp.exitPoint, tolerance, comp._rowIndex);
    if (match) {
      edges.set(comp._rowIndex, match);
      hasIncoming.add(match._rowIndex);
    }

    // Branch edge for TEE
    if (comp.branchExitPoint && !vec.isZero(comp.branchExitPoint)) {
      const brMatch = entryTree.findNearest(comp.branchExitPoint, tolerance, comp._rowIndex);
      if (brMatch) {
        branchEdges.set(comp._rowIndex, brMatch);
        hasIncoming.add(brMatch._rowIndex);
      }
    }
  }

  // Step 4: Find chain terminals (no incoming connection)
  const terminals = components.filter(c =>
    !hasIncoming.has(c._rowIndex) && c.type !== "SUPPORT"
  );

  return { components, edges, branchEdges, terminals, entryTree };
}

export function getEntryPoint(row) {
  const t = (row.type || "").toUpperCase();
  if (t === "SUPPORT") return row.supportCoor || null;
  if (t === "OLET")    return row.cp || null;  // OLET enters at CP
  return row.ep1 || null;
}

export function getExitPoint(row) {
  const t = (row.type || "").toUpperCase();
  if (t === "SUPPORT") return null;            // SUPPORT has no exit
  if (t === "OLET")    return row.bp || null;  // OLET exits at BP
  return row.ep2 || null;
}

export function getBranchExitPoint(row) {
  const t = (row.type || "").toUpperCase();
  if (t === "TEE") return row.bp || null;      // TEE branches at BP
  return null;
}

// `findNearestEntry` removed; superseded by KDTree's `findNearest` method
