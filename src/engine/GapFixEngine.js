/**
 * Pure math engine for all gap/break/insert ops.
 * Zero-Trust Coordinates — Always parseFloat() every coordinate before arithmetic.
 * Null Guards — Every ep1, ep2, cp, bp access is null-checked.
 */

// Helper: Safely calculate 3D distance between two points
const getDist = (ptA, ptB) => {
    if (!ptA || !ptB) return null;
    const dx = parseFloat(ptA.x) - parseFloat(ptB.x);
    const dy = parseFloat(ptA.y) - parseFloat(ptB.y);
    const dz = parseFloat(ptA.z) - parseFloat(ptB.z);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

// Helper: Clone a point safely
const clonePt = (pt) => pt ? { x: parseFloat(pt.x), y: parseFloat(pt.y), z: parseFloat(pt.z) } : null;

// Directive 1.1 — fix6mmGaps(dataTable)
export const fix6mmGaps = (dataTable) => {
    if (!dataTable || dataTable.length === 0) return { updatedTable: [], fixLog: [] };

    // Create a deep copy of the table to avoid mutating input
    const table = JSON.parse(JSON.stringify(dataTable));
    const fixLog = [];
    let fixCount = 0;

    // Helper to determine priority: PIPE > FLANGE > OTHERS
    const getPriority = (type) => {
        const t = (type || '').toUpperCase().trim();
        if (t === 'PIPE') return 3;
        if (t === 'FLANGE') return 2;
        return 1;
    };

    // First pass
    for (let i = 0; i < table.length - 1; i++) {
        const elA = table[i];
        const elB = table[i + 1];

        if (!elA.ep2 || !elB.ep1) continue;

        const dist = getDist(elA.ep2, elB.ep1);
        if (dist > 0 && dist <= 6.0) {
            const prioA = getPriority(elA.type);
            const prioB = getPriority(elB.type);

            if (prioA >= prioB) {
                // Extend A's ep2 to match B's ep1
                elA.ep2 = clonePt(elB.ep1);
                fixLog.push({ type: 'Applied/Fix', stage: 'ENGINE', message: `Fixed ${dist.toFixed(1)}mm gap between Row ${elA._rowIndex} and Row ${elB._rowIndex} (Extended Row ${elA._rowIndex}).` });
            } else {
                // Extend B's ep1 to match A's ep2
                elB.ep1 = clonePt(elA.ep2);
                fixLog.push({ type: 'Applied/Fix', stage: 'ENGINE', message: `Fixed ${dist.toFixed(1)}mm gap between Row ${elA._rowIndex} and Row ${elB._rowIndex} (Extended Row ${elB._rowIndex}).` });
            }
            fixCount++;
        }
    }

    // IMPROVEMENT: Second pass to catch cascading micro-gaps created by the first pass.
    // If moving an endpoint created a new gap with the previous/next element.
    // In a sequential list, fixing i and i+1 might break i-1 and i if i was moved.
    // Since we only move the adjacent endpoint (ep2 of A or ep1 of B), it shouldn't disconnect A's ep1 or B's ep2,
    // but a second pass ensures stability.
    let secondPassFixes = 0;
    for (let i = 0; i < table.length - 1; i++) {
        const elA = table[i];
        const elB = table[i + 1];
        if (!elA.ep2 || !elB.ep1) continue;
        const dist = getDist(elA.ep2, elB.ep1);
        if (dist > 0 && dist <= 6.0) {
            const prioA = getPriority(elA.type);
            const prioB = getPriority(elB.type);
            if (prioA >= prioB) elA.ep2 = clonePt(elB.ep1);
            else elB.ep1 = clonePt(elA.ep2);
            secondPassFixes++;
        }
    }

    if (secondPassFixes > 0) {
        fixLog.push({ type: 'Info', stage: 'ENGINE', message: `Second pass resolved ${secondPassFixes} cascading micro-gaps.` });
    }

    if (fixCount === 0) {
        fixLog.push({ type: 'Info', stage: 'ENGINE', message: 'No gaps ≤ 6.0mm found.' });
    }

    return { updatedTable: table, fixLog };
};

// Directive 1.2 — fix25mmGapsWithPipe(dataTable, refPrefix)
export const fix25mmGapsWithPipe = (dataTable, refPrefix = 'GAPFIX') => {
    if (!dataTable || dataTable.length === 0) return { updatedTable: [], fixLog: [] };

    const table = JSON.parse(JSON.stringify(dataTable));
    const fixLog = [];
    const updatedTable = [];
    let insertCount = 0;

    for (let i = 0; i < table.length; i++) {
        const elA = table[i];
        updatedTable.push(elA); // Add current element

        if (i < table.length - 1) {
            const elB = table[i + 1];

            if (elA.ep2 && elB.ep1) {
                const dist = getDist(elA.ep2, elB.ep1);

                if (dist > 6.0 && dist <= 25.0) {
                    // Synthesize a new PIPE row
                    const newPipe = {
                        type: 'PIPE',
                        ep1: clonePt(elA.ep2),
                        ep2: clonePt(elB.ep1),
                        bore: parseFloat(elA.bore || elB.bore || 100),
                        pipelineRef: elA.pipelineRef || elB.pipelineRef || 'UNKNOWN',
                        skey: 'PIPE', // Default skey for pipe
                        tag: `${refPrefix}_25mmGapfix`,
                        // Inherit CA attributes
                        CA1: elA.CA1 || '', CA2: elA.CA2 || '', CA3: elA.CA3 || '',
                        CA4: elA.CA4 || '', CA5: elA.CA5 || '', CA6: elA.CA6 || '',
                        CA7: elA.CA7 || '', CA8: elA.CA8 || '', CA9: elA.CA9 || '', CA10: elA.CA10 || '',
                    };

                    updatedTable.push(newPipe); // Insert exactly between elA and elB
                    insertCount++;
                    fixLog.push({ type: 'Applied/Fix', stage: 'ENGINE', message: `Inserted ${dist.toFixed(1)}mm spool between Row ${elA._rowIndex} and Row ${elB._rowIndex}.` });
                }
            }
        }
    }

    // Re-index all elements
    const reindexedTable = updatedTable.map((row, index) => ({
        ...row,
        _rowIndex: index + 1
    }));

    if (insertCount === 0) {
        fixLog.push({ type: 'Info', stage: 'ENGINE', message: 'No gaps 6.0-25.0mm found.' });
    } else if (insertCount > 5) {
        // IMPROVEMENT: Warn if too many pipes inserted (data quality issue)
        fixLog.push({ type: 'Warning', stage: 'ENGINE', message: `Inserted ${insertCount} gap-pipes. This high number may indicate systemic survey/data quality issues rather than isolated gaps.` });
    }

    return { updatedTable: reindexedTable, fixLog };
};

// Directive 1.3 — breakPipeAtPoint(pipeRow, breakPoint)
export const breakPipeAtPoint = (pipeRow, breakPoint) => {
    if (!pipeRow || !breakPoint || (pipeRow.type || '').toUpperCase().trim() !== 'PIPE' || !pipeRow.ep1 || !pipeRow.ep2) {
        return null;
    }

    const ep1 = { x: parseFloat(pipeRow.ep1.x), y: parseFloat(pipeRow.ep1.y), z: parseFloat(pipeRow.ep1.z) };
    const ep2 = { x: parseFloat(pipeRow.ep2.x), y: parseFloat(pipeRow.ep2.y), z: parseFloat(pipeRow.ep2.z) };
    const bp = { x: parseFloat(breakPoint.x), y: parseFloat(breakPoint.y), z: parseFloat(breakPoint.z) };

    // Project breakPoint onto the ep1 -> ep2 line segment
    const dx = ep2.x - ep1.x;
    const dy = ep2.y - ep1.y;
    const dz = ep2.z - ep1.z;
    const lengthSquared = dx * dx + dy * dy + dz * dz;

    let t = 0;
    if (lengthSquared > 0) {
        t = ((bp.x - ep1.x) * dx + (bp.y - ep1.y) * dy + (bp.z - ep1.z) * dz) / lengthSquared;
    }

    // Clamp t between 0 and 1
    t = Math.max(0, Math.min(1, t));

    let closestPoint = {
        x: ep1.x + t * dx,
        y: ep1.y + t * dy,
        z: ep1.z + t * dz
    };

    const distA = getDist(ep1, closestPoint);
    const distB = getDist(closestPoint, ep2);

    // Reject if sub-pipe would be negligibly short (< 1mm)
    if (distA <= 1.0 || distB <= 1.0) {
        // IMPROVEMENT: Snap it to a minimum 10mm from the endpoint rather than rejecting.
        // If an engineer slightly misclicks near the end, we still break it, just at a safe 10mm distance.
        const totalDist = getDist(ep1, ep2);
        if (totalDist > 20.0) { // Only adjust if pipe is long enough to support two 10mm sections
            if (distA <= 1.0) {
                const safeT = 10.0 / totalDist;
                closestPoint = {
                    x: ep1.x + safeT * dx,
                    y: ep1.y + safeT * dy,
                    z: ep1.z + safeT * dz
                };
            } else if (distB <= 1.0) {
                const safeT = 1.0 - (10.0 / totalDist);
                closestPoint = {
                    x: ep1.x + safeT * dx,
                    y: ep1.y + safeT * dy,
                    z: ep1.z + safeT * dz
                };
            }
        } else {
             return null; // Pipe is too short to break at all
        }
    }

    const snapBreak = { x: closestPoint.x, y: closestPoint.y, z: closestPoint.z };

    const rowA = JSON.parse(JSON.stringify(pipeRow));
    rowA.ep2 = clonePt(snapBreak);

    const rowB = JSON.parse(JSON.stringify(pipeRow));
    rowB.ep1 = clonePt(snapBreak);

    return [rowA, rowB];
};

// Directive 1.4 — insertSupportAtPipe(pipeRow, position, attrs)
export const insertSupportAtPipe = (pipeRow, position, attrs = {}) => {
    if (!pipeRow || !pipeRow.ep1 || !pipeRow.ep2) return null;

    let pos = position;
    if (!pos) {
        // Default to midpoint
        const ep1 = { x: parseFloat(pipeRow.ep1.x), y: parseFloat(pipeRow.ep1.y), z: parseFloat(pipeRow.ep1.z) };
        const ep2 = { x: parseFloat(pipeRow.ep2.x), y: parseFloat(pipeRow.ep2.y), z: parseFloat(pipeRow.ep2.z) };
        pos = {
            x: (ep1.x + ep2.x) / 2.0,
            y: (ep1.y + ep2.y) / 2.0,
            z: (ep1.z + ep2.z) / 2.0
        };
    }

    const posParsed = { x: parseFloat(pos.x), y: parseFloat(pos.y), z: parseFloat(pos.z) };
    const stubEnd = { x: posParsed.x, y: posParsed.y + 100.0, z: posParsed.z }; // +Y100mm stub

    const supportRow = {
        type: 'SUPPORT',
        ep1: posParsed,
        ep2: stubEnd,
        bore: parseFloat(pipeRow.bore || 100),
        pipelineRef: pipeRow.pipelineRef || 'UNKNOWN',
        skey: 'SUPP',
        // CA from attrs
        CA1: attrs.CA1 || pipeRow.CA1 || '',
        CA2: attrs.CA2 || pipeRow.CA2 || '',
        CA3: attrs.CA3 || pipeRow.CA3 || '',
        CA4: attrs.CA4 || pipeRow.CA4 || '',
        CA5: attrs.CA5 || pipeRow.CA5 || '',
        CA6: attrs.CA6 || pipeRow.CA6 || '',
        CA7: attrs.CA7 || pipeRow.CA7 || '',
        CA8: attrs.CA8 || pipeRow.CA8 || '',
        CA9: attrs.CA9 || pipeRow.CA9 || '',
        CA10: attrs.CA10 || pipeRow.CA10 || '',
        tag: attrs.tag || `${pipeRow.pipelineRef || 'UNKNOWN'}_Support`
    };

    return supportRow;
};
