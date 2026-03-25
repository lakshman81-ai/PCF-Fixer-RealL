/**
 * GapFixEngine.js
 * Pure math engine for gap/break/insert operations.
 * Coordinates are in millimeters. Zero-Trust Coordinates applied.
 */

// Helper: Calculate 3D distance safely
const getDist = (p1, p2) => {
  if (!p1 || !p2) return Infinity;
  const dx = parseFloat(p1.x) - parseFloat(p2.x);
  const dy = parseFloat(p1.y) - parseFloat(p2.y);
  const dz = parseFloat(p1.z) - parseFloat(p2.z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

// Helper: Prioritize element types for extension (PIPE > FLANGE > OTHERS)
const getPriority = (type) => {
  const t = (type || '').toUpperCase().trim();
  if (t === 'PIPE') return 1;
  if (t === 'FLANGE') return 2;
  return 3;
};

/**
 * fix6mmGaps
 * Extends the higher-priority element's endpoint to close 0-6mm gaps.
 */
export const fix6mmGaps = (dataTable) => {
  if (!Array.isArray(dataTable)) return { updatedTable: [], fixLog: [] };
  const updatedTable = dataTable.map(r => ({ ...r, ep1: r.ep1 ? { ...r.ep1 } : null, ep2: r.ep2 ? { ...r.ep2 } : null }));
  const fixLog = [];

  for (let i = 0; i < updatedTable.length - 1; i++) {
    const elA = updatedTable[i];
    const elB = updatedTable[i + 1];
    if (!elA.ep2 || !elB.ep1) continue;

    const dist = getDist(elA.ep2, elB.ep1);
    if (dist > 0 && dist <= 6.0) {
      const prioA = getPriority(elA.type);
      const prioB = getPriority(elB.type);

      if (prioA <= prioB) {
        elA.ep2 = { ...elB.ep1 };
        fixLog.push({ type: 'Applied/Fix', stage: 'GAP_FIX_6MM', message: `Row ${elA._rowIndex}: Extended ep2 to close ${dist.toFixed(1)}mm gap.` });
      } else {
        elB.ep1 = { ...elA.ep2 };
        fixLog.push({ type: 'Applied/Fix', stage: 'GAP_FIX_6MM', message: `Row ${elB._rowIndex}: Extended ep1 to close ${dist.toFixed(1)}mm gap.` });
      }
    }
  }

  // IMPROVEMENT: A second pass could catch cascading gaps if A pulled B away from C.
  // For now, sequentially iterating fixes current local pairs accurately.

  if (fixLog.length === 0) {
      fixLog.push({ type: 'Info', stage: 'GAP_FIX_6MM', message: 'No gaps ≤ 6mm found.' });
  }

  return { updatedTable, fixLog };
};

/**
 * fix25mmGapsWithPipe
 * Inserts a new PIPE row for 6-25mm gaps.
 */
export const fix25mmGapsWithPipe = (dataTable, refPrefix = 'GAPFIX') => {
  if (!Array.isArray(dataTable)) return { updatedTable: [], fixLog: [] };
  let updatedTable = [];
  const fixLog = [];
  let insertCount = 0;

  for (let i = 0; i < dataTable.length; i++) {
    updatedTable.push({ ...dataTable[i] });

    if (i < dataTable.length - 1) {
      const elA = dataTable[i];
      const elB = dataTable[i + 1];
      if (!elA.ep2 || !elB.ep1) continue;

      const dist = getDist(elA.ep2, elB.ep1);
      if (dist > 6.0 && dist <= 25.0) {
        insertCount++;
        const prefix = elA.pipelineRef || refPrefix || 'GAPFIX';
        const newPipe = {
          _rowIndex: -1, // Temporary, will be re-indexed
          type: 'PIPE',
          ep1: { ...elA.ep2 },
          ep2: { ...elB.ep1 },
          bore: parseFloat(elA.bore) || 0,
          pipelineRef: prefix,
          tag: `${prefix}_3DTopoBridge_25mmfix`,
          skey: elA.skey || 'PIPE',
          CA1: elA.CA1, CA2: elA.CA2, CA3: elA.CA3,
          name: `${prefix}_3DTopoBridge_25mmfix`
        };
        updatedTable.push(newPipe);
        fixLog.push({ type: 'Applied/Fix', stage: 'GAP_FIX_25MM', message: `Inserted Pipe between Row ${elA._rowIndex} & ${elB._rowIndex} (${dist.toFixed(1)}mm gap).` });
      }
    }
  }

  // IMPROVEMENT: Warn if too many gap pipes inserted.
  if (insertCount > 5) {
      fixLog.push({ type: 'Warning', stage: 'GAP_FIX_25MM', message: `Inserted ${insertCount} gap pipes. May indicate underlying data quality issues.` });
  }

  if (insertCount === 0) {
      fixLog.push({ type: 'Info', stage: 'GAP_FIX_25MM', message: 'No gaps 6-25mm found.' });
  }

  // Re-index
  updatedTable = updatedTable.map((row, idx) => ({ ...row, _rowIndex: idx + 1 }));

  return { updatedTable, fixLog };
};

/**
 * breakPipeAtPoint
 * Breaks a pipe into two at a specified point on its segment.
 */
export const breakPipeAtPoint = (pipeRow, breakPoint) => {
  if (!pipeRow || !pipeRow.ep1 || !pipeRow.ep2 || !breakPoint) return null;

  const ep1 = { x: parseFloat(pipeRow.ep1.x), y: parseFloat(pipeRow.ep1.y), z: parseFloat(pipeRow.ep1.z) };
  const ep2 = { x: parseFloat(pipeRow.ep2.x), y: parseFloat(pipeRow.ep2.y), z: parseFloat(pipeRow.ep2.z) };
  const bp = { x: parseFloat(breakPoint.x), y: parseFloat(breakPoint.y), z: parseFloat(breakPoint.z) };

  // Calculate segment vector and length
  const vx = ep2.x - ep1.x;
  const vy = ep2.y - ep1.y;
  const vz = ep2.z - ep1.z;
  const lenSq = vx * vx + vy * vy + vz * vz;
  if (lenSq === 0) return null;

  // Parametric t
  const wx = bp.x - ep1.x;
  const wy = bp.y - ep1.y;
  const wz = bp.z - ep1.z;
  let t = (wx * vx + wy * vy + wz * vz) / lenSq;

  // Clamp t to [0, 1]
  t = Math.max(0, Math.min(1, t));

  let snapX = ep1.x + t * vx;
  let snapY = ep1.y + t * vy;
  let snapZ = ep1.z + t * vz;
  let snapBreak = { x: snapX, y: snapY, z: snapZ };

  const dist1 = getDist(ep1, snapBreak);
  const dist2 = getDist(snapBreak, ep2);
  const totalLen = Math.sqrt(lenSq);

  // If the pipe itself is shorter than 20mm, log an error (caller handles logging) and reject.
  if (totalLen < 20.0) {
      return null;
  }

  // If within 10mm of endpoints, clamp to 10mm.
  if (dist1 < 10.0) {
      const ratio = 10.0 / totalLen;
      snapBreak = { x: ep1.x + ratio * vx, y: ep1.y + ratio * vy, z: ep1.z + ratio * vz };
  } else if (dist2 < 10.0) {
      const ratio = (totalLen - 10.0) / totalLen;
      snapBreak = { x: ep1.x + ratio * vx, y: ep1.y + ratio * vy, z: ep1.z + ratio * vz };
  }

  // Re-check distances after clamping
  if (getDist(ep1, snapBreak) <= 1.0 || getDist(snapBreak, ep2) <= 1.0) {
      return null;
  }

  const baseTag = pipeRow.tag || pipeRow.name || 'PIPE';
  const rowA = { ...pipeRow, ep2: snapBreak, tag: `${baseTag}_1`, name: `${baseTag}_1` };
  const rowB = { ...pipeRow, ep1: snapBreak, tag: `${baseTag}_2`, name: `${baseTag}_2` };
  return [rowA, rowB];
};

/**
 * insertSupportAtPipe
 * Creates a SUPPORT row at a point along a pipe.
 */
export const insertSupportAtPipe = (pipeRow, position = null, attrs = {}) => {
  if (!pipeRow || !pipeRow.ep1 || !pipeRow.ep2) return null;

  let pos = position;
  if (!pos) {
    pos = {
      x: (parseFloat(pipeRow.ep1.x) + parseFloat(pipeRow.ep2.x)) / 2,
      y: (parseFloat(pipeRow.ep1.y) + parseFloat(pipeRow.ep2.y)) / 2,
      z: (parseFloat(pipeRow.ep1.z) + parseFloat(pipeRow.ep2.z)) / 2
    };
  }

  pos = { x: parseFloat(pos.x), y: parseFloat(pos.y), z: parseFloat(pos.z) };

  const prefix = pipeRow.pipelineRef || 'UNKNOWN';

  const supportRow = {
    type: 'SUPPORT',
    ep1: { ...pos },
    ep2: { x: pos.x, y: pos.y + 100.0, z: pos.z }, // Fixed +100mm Y stub
    bore: parseFloat(pipeRow.bore) || 0,
    pipelineRef: prefix,
    tag: `${prefix}_3DTopoSupport`,
    name: `${prefix}_3DTopoSupport`,
    ...attrs
  };

  return supportRow;
};
