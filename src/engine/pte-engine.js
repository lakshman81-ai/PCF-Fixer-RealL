import { vec } from '../math/VectorMath.js';
import { getEntryPoint, getExitPoint } from './GraphBuilder.js';
import { getElementVector } from './AxisDetector.js';

export function runPTEEngine(dataTable, config, logger) {
    const pteMode = config.pteMode || { autoMultiPassMode: true, sequentialMode: true, lineKeyMode: true, lineKeyColumn: 'pipelineRef' };
    logger.push({ type: "Info", message: "═══ RUNNING PTE ENGINE ═══" });

    const enrichRowWithLineKey = (row) => {
        let keyVal = null;
        if (pteMode.lineKeyColumn === 'pipelineRef') keyVal = row.pipelineRef;
        else if (pteMode.lineKeyColumn === 'text') keyVal = row.text;
        else if (pteMode.lineKeyColumn === 'ca97') keyVal = row.ca?.[97];
        else if (pteMode.lineKeyColumn === 'ca98') keyVal = row.ca?.[98];

        const enrichedRow = { ...row };

        if (keyVal && typeof keyVal === 'string' && keyVal.trim() !== '') {
            enrichedRow._lineKey = keyVal.trim();
            enrichedRow._pteMode = 'B(a)'; // Sequential + Line_Key
        } else {
            enrichedRow._lineKey = null;
            enrichedRow._pteMode = 'B(b)'; // Sequential + No Line_Key
        }

        if (!pteMode.lineKeyMode) {
             enrichedRow._lineKey = null;
             enrichedRow._pteMode = 'B(b)';
        }

        return enrichedRow;
    };

    // Need to protect the incoming dataTable by making a shallow copy before .map
    // to prevent modifying the frozen properties passed by React.
    let processedTable = [...dataTable].map(enrichRowWithLineKey);

    if (!pteMode.sequentialMode) {
         processedTable = processedTable.map(row => {
             const updatedRow = { ...row };
             updatedRow._pteMode = updatedRow._lineKey ? 'D(a)' : 'D(b)';
             return updatedRow;
         });
    }

    return processedTable;
}

export function sweepForNeighbor(element, kdTreeOrArray, config) {
    const elemPt = getExitPoint(element) || getEntryPoint(element);
    if (!elemPt) return null;
    const radiusMax = config.pteMode?.sweepRadiusMax ?? 13000;

    const weights = config.smartFixer?.weights || { lineKey: 10, sizeRatio: 5, elementalAxis: 3, globalAxis: 2 };
    const minApprovalScore = config.smartFixer?.minApprovalScore ?? 10;

    let bestMatch = null;

    if (kdTreeOrArray && typeof kdTreeOrArray.findNearest === 'function') {
        bestMatch = kdTreeOrArray.findNearest(elemPt, radiusMax, element._rowIndex);
    } else {
        // Fallback array search
        const dataTable = kdTreeOrArray;
        const radiusMin = (config.pteMode?.sweepRadiusMinMultiplier ?? 0.2) * (element.bore || 100);
        let minScore = Infinity;

        for (const other of dataTable) {
            if (other._rowIndex === element._rowIndex) continue;

            const otherPt = getEntryPoint(other) || getExitPoint(other);
            if (!otherPt) continue;

            const dist = vec.dist(elemPt, otherPt);

            if (dist >= radiusMin && dist <= radiusMax) {
                let score = dist;
                const ev1 = getElementVector(element);
                const ev2 = getElementVector(other);
                if (!vec.isZero(ev1) && !vec.isZero(ev2)) {
                    const norm1 = vec.normalize(ev1);
                    const norm2 = vec.normalize(ev2);
                    const dot = Math.abs(vec.dot(norm1, norm2));
                    score -= (dot * 1000);
                }
                if (score < minScore) {
                    minScore = score;
                    bestMatch = other;
                }
            }
        }
    }

    // Now apply the topology score check before returning
    if (bestMatch) {
        let topologyScore = 0;

        // Line key
        if (element._lineKey === bestMatch._lineKey) topologyScore += weights.lineKey;
        else if (!config.pteMode?.lineKeyMode) topologyScore += weights.lineKey;

        // Bore ratio
        if (element.bore && bestMatch.bore) {
            const ratio = element.bore / bestMatch.bore;
            if (ratio >= 0.5 && ratio <= 2.0) topologyScore += weights.sizeRatio;
        }

        // Proximity/Axis
        const otherPt = getEntryPoint(bestMatch) || getExitPoint(bestMatch);
        if (otherPt) {
            const dx = Math.abs(elemPt.x - otherPt.x);
            const dy = Math.abs(elemPt.y - otherPt.y);
            const dz = Math.abs(elemPt.z - otherPt.z);
            const maxDev = Math.max(dx, dy, dz);
            const others = dx + dy + dz - maxDev;
            if (others < 5) topologyScore += weights.elementalAxis;
        }

        if (topologyScore >= minApprovalScore) {
            return bestMatch;
        } else {
            // Did not meet minimum topology score
            return null;
        }
    }

    return null;
}
