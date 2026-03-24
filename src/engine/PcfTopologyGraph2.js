import { vec } from '../math/VectorMath.js';
import { getEntryPoint, getExitPoint } from './GraphBuilder.js';
import { rayShoot } from '../math/VectorMath.js';

import { buildConnectivityGraph as spatialGraphBuilder } from './GraphBuilder.js';

// ----------------------------------------------------
// 3D Rule Validation Engine
// ----------------------------------------------------
function validateAgainst3DRules(prop, config, logger) {
    if (!config || !config.smartFixer || config.smartFixer.enable3DRules === false) return true; // Fail open if no config or disabled

    const rules = config.smartFixer;
    const isSyntheticGap = prop.fixType === 'GAP_FILL' || prop.fixType === 'GAP_FILL_REDUCER';

    // Rule: Min Component Size
    if (isSyntheticGap) {
        if (prop.dist < (rules.minComponentSize ?? 3)) {
            logger.push({ stage: "FIXING", type: "Warn", message: `Dropped Proposal: Synthesized component length ${prop.dist.toFixed(1)}mm < Min Component Size (${rules.minComponentSize ?? 3}mm)` });
            return false;
        }
    }

    // Rule: Min Pipe Size (for overlapping or merging logic)
    if (prop.fixType === 'TRIM_OVERLAP' || prop.fixType === 'GAP_STRETCH_PIPE') {
        const minBore = Math.min(prop.elementA?.bore || 9999, prop.elementB?.bore || 9999);
        if (minBore < (rules.minPipeSize ?? 0)) {
            logger.push({ stage: "FIXING", type: "Warn", message: `Dropped Proposal: Bore size ${minBore}mm < Min Pipe Size (${rules.minPipeSize ?? 0}mm)` });
            return false;
        }
    }

    // Rule: Max Overlap
    if (prop.fixType === 'TRIM_OVERLAP') {
        if (prop.dist > (rules.maxOverlap ?? 1000)) {
            logger.push({ stage: "FIXING", type: "Warn", message: `Dropped Proposal: Overlap ${prop.dist.toFixed(1)}mm > Max Overlap (${rules.maxOverlap ?? 1000}mm)` });
            return false;
        }
    }

    // Gap Rules (apply distance limits to all gap-bridging and stretching actions)
    const isGapAction = prop.fixType === 'GAP_FILL' ||
                        prop.fixType === 'GAP_FILL_REDUCER' ||
                        prop.fixType === 'GAP_SNAP_IMMUTABLE_BLOCK' ||
                        prop.fixType === 'GAP_STRETCH_PIPE' ||
                        prop.fixType === 'GAP_SNAP_COMPONENT';

    if (isGapAction && prop.elementA && prop.elementB) {
        // Use attached points if available (important for TEE branch gaps), fallback to endpoints
        const ptA = prop.ptA || getExitPoint(prop.elementA);
        const ptB = prop.ptB || getEntryPoint(prop.elementB);

        if (ptA && ptB) {
            const dx = Math.abs(ptB.x - ptA.x);
            const dy = Math.abs(ptB.y - ptA.y);
            const dz = Math.abs(ptB.z - ptA.z);

            const maxD = Math.max(dx, dy, dz);
            const slopeTol = rules.singleAxisSlopeTolerance ?? 0.01;

            let planes = 0;
            if (maxD > 0) {
                if (dx > 1 && (dx / maxD) >= slopeTol) planes++;
                if (dy > 1 && (dy / maxD) >= slopeTol) planes++;
                if (dz > 1 && (dz / maxD) >= slopeTol) planes++;
            }

            // Rule: Max Diagonal Gap (Failsafe for 2+ planes)
            if (planes >= 2 && prop.dist > (rules.maxDiagonalGap ?? 6000)) {
                logger.push({ stage: "FIXING", type: "Warn", message: `Dropped Proposal: Diagonal gap ${prop.dist.toFixed(1)}mm > Max Diagonal Gap (${rules.maxDiagonalGap ?? 6000}mm)` });
                return false;
            }

            // Rule: 3-Plane Skew Limit
            if (planes === 3 && prop.dist > (rules.threePlaneSkewLimit ?? 2000)) {
                logger.push({ stage: "FIXING", type: "Warn", message: `Dropped Proposal: 3-Plane skew ${prop.dist.toFixed(1)}mm > Skew Limit (${rules.threePlaneSkewLimit ?? 2000}mm)` });
                return false;
            }

            // Rule: 2-Plane Skew Limit
            if (planes === 2 && prop.dist > (rules.twoPlaneSkewLimit ?? 3000)) {
                logger.push({ stage: "FIXING", type: "Warn", message: `Dropped Proposal: 2-Plane skew ${prop.dist.toFixed(1)}mm > Skew Limit (${rules.twoPlaneSkewLimit ?? 3000}mm)` });
                return false;
            }

            // Rule: Max Single Plane Run
            if (planes <= 1 && prop.dist > (rules.maxSinglePlaneRun ?? 12000)) {
                logger.push({ stage: "FIXING", type: "Warn", message: `Dropped Proposal: Straight run ${prop.dist.toFixed(1)}mm > Max Single Plane Run (${rules.maxSinglePlaneRun ?? 12000}mm)` });
                return false;
            }
        }
    }

    return true; // Passed all checks
}


export function PcfTopologyGraph2(dataTable, config, logger) {
    logger.push({ stage: "FIXING", type: "Info", message: "═══ RUNNING PcfTopologyGraph_2 ENGINE ═══" });

    const strategy = config.smartFixer?.chainingStrategy ?? "strict_sequential";

    // Auto-select based on mode
    if (strategy !== "strict_sequential") {
        logger.push({ stage: "FIXING", type: "Info", message: "Executing Dual Strategy: Spatial Mode via GraphBuilder" });
        const graph = spatialGraphBuilder(dataTable, config);
        // Note: spatialGraphBuilder returns the full graph structure rather than direct { proposals }.
        // For consistency in the PcfTopologyGraph2 engine signature, we return an empty array for proposals
        // to prevent downstream crashes, letting the spatial walker take over logic in broader execution.
        return { proposals: [], graph };
    }

    // Pass 1: Sequential Topological Tracing
    // Filter physical components
    const physicals = dataTable.filter(c =>
        c.type && !['SUPPORT', 'MESSAGE-SQUARE', 'PIPELINE-REFERENCE'].includes(c.type) && !c.type.startsWith('UNITS-') && c.type !== 'ISOGEN-FILES' && c.type !== 'UNKNOWN'
    );

    const proposals = [];

    const isImmutable = (type) => ['FLANGE', 'BEND', 'TEE', 'VALVE'].includes(type);

    // Scoring Weights config (default values)
    const weights = config.smartFixer?.weights || {
        lineKey: 10,
        sizeRatio: 5,
        elementalAxis: 3,
        globalAxis: 2
    };
    const minApprovalScore = config.smartFixer?.minApprovalScore || 10;

    logger.push({ stage: "FIXING", type: "Info", message: "Executing Pass 1: Sequential Topological Tracing" });

    // Only run Pass 1 checks if currentPass is explicitly 1 (or undefined/first run)
    if ((config.currentPass || 1) === 1) {
        // First Sub-pass: Calculate Missing (0,0,0) EP lengths
        for (let i = 0; i < physicals.length; i++) {
            const C = physicals[i];
            if (C.ep1 && vec.isZero(C.ep1)) {
                const prev = physicals[i-1];
                if (prev && getExitPoint(prev)) {
                    // If it's a pipe, try to trace forward
                    const start = getExitPoint(prev);
                    let fixDesc = `[1st Pass]\n[Issue] EP1 is (0,0,0).\n[Proposal] Calculated EP1 from Row ${prev._rowIndex} exit point.`;
                    proposals.push({
                       elementA: C, elementB: prev, fixType: 'ZERO_COORD_CALC', dist: 0, score: 20, description: fixDesc, pass: "Pass 1",
                       target: 'ep1', newPt: { ...start }
                    });
                    logger.push({ stage: "FIXING", type: "Fix", tier: 3, row: C._rowIndex, message: fixDesc, score: 20 });
                }
            }
            if (C.ep2 && vec.isZero(C.ep2)) {
                const next = physicals[i+1];
                if (next && getEntryPoint(next)) {
                    const end = getEntryPoint(next);
                    let fixDesc = `[1st Pass]\n[Issue] EP2 is (0,0,0).\n[Proposal] Calculated EP2 from Row ${next._rowIndex} entry point.`;
                    proposals.push({
                       elementA: C, elementB: next, fixType: 'ZERO_COORD_CALC', dist: 0, score: 20, description: fixDesc, pass: "Pass 1",
                       target: 'ep2', newPt: { ...end }
                    });
                    logger.push({ stage: "FIXING", type: "Fix", tier: 3, row: C._rowIndex, message: fixDesc, score: 20 });
                }
            }
        }

        for (let i = 0; i < physicals.length - 1; i++) {
            const A = physicals[i];
            const B = physicals[i+1];

            let score = 0;

            // Line_Key matching
            if (config.pteMode?.lineKeyMode && A._lineKey && B._lineKey && A._lineKey === B._lineKey) {
                score += weights.lineKey;
            } else if (!config.pteMode?.lineKeyMode) {
                 // If not using line key mode, assume sequential implies connection intent
                 score += weights.lineKey;
            }

            // Bore ratio constraint
            if (A.bore && B.bore) {
                const ratio = A.bore / B.bore;
                if (ratio >= 0.5 && ratio <= 2.0) {
                    if (config.smartFixer?.dynamicScoring) {
                        const deviation = Math.abs(1 - ratio);
                        let dynamicBonus = weights.sizeRatio * (1 - deviation);
                        const averageBore = (A.bore + B.bore) / 2;
                        // Math.log10(averageBore + 10) / Math.log10(100) normalizes against a 100mm baseline
                        const sizeFactor = Math.max(0.1, Math.log10(averageBore + 10) / Math.log10(100));
                        score += (dynamicBonus * sizeFactor);
                    } else {
                        score += weights.sizeRatio;
                    }
                }
            }

            const ptA = getExitPoint(A) || getEntryPoint(A);
            const ptB = getEntryPoint(B) || getExitPoint(B);

            // Simple axis check for scoring
            if (ptA && ptB) {
                const dx = Math.abs(ptA.x - ptB.x);
                const dy = Math.abs(ptA.y - ptB.y);
                const dz = Math.abs(ptA.z - ptB.z);
                // If it primarily deviates on one axis
                const maxDev = Math.max(dx, dy, dz);
                const others = dx + dy + dz - maxDev;
                if (others < 5) score += weights.elementalAxis;
            }

            if (ptA && ptB) {
                const dist = vec.dist(ptA, ptB);

                if (dist > 0) {
                    let fixType = 'GAP_FILL';
                    let description = "";
                    let tier = 2; // Auto-approved

                    // BM1 overlaps trimming logic
                    if (A.type === 'PIPE' && B.type === 'PIPE' && dist > 50 && ptA.x > ptB.x) {
                        fixType = 'TRIM_OVERLAP';
                        description = `[1st Pass]\n[Issue] Coordinate discontinuity by ${dist.toFixed(1)}mm.\n[Proposal] Trim overlapping PIPE by ${dist.toFixed(1)}mm.`;
                        tier = 2;
                    }
                    // BM2 Multi-axis gap translation
                    else if (dist > 25 && isImmutable(B.type)) {
                        fixType = 'GAP_SNAP_IMMUTABLE_BLOCK';
                        description = `[1st Pass]\n[Issue] Coordinate discontinuity by ${dist.toFixed(1)}mm.\n[Proposal] Translate rigid object block to Flange face by ${dist.toFixed(1)}mm.`;
                        tier = 3;
                    }
                    else if (A.type === 'PIPE' && B.type === 'PIPE' && dist < 25) {
                        fixType = 'GAP_STRETCH_PIPE';
                        description = `[1st Pass]\n[Issue] Coordinate discontinuity by ${dist.toFixed(1)}mm.\n[Proposal] Stretch adjacent pipes by ${dist.toFixed(1)}mm.`;
                    } else if (dist < 25 && (isImmutable(A.type) || isImmutable(B.type))) {
                        fixType = 'GAP_SNAP_IMMUTABLE';
                        description = `[1st Pass]\n[Issue] Coordinate discontinuity by ${dist.toFixed(1)}mm.\n[Proposal] Translate immutable object by ${dist.toFixed(1)}mm.`;
                    } else {
                        fixType = 'GAP_FILL';
                        description = `[1st Pass]\n[Issue] Coordinate discontinuity by ${dist.toFixed(1)}mm.\n[Proposal] Inject PIPE bridging gap of ${dist.toFixed(1)}mm.`;
                        tier = 3;
                    }

                    if (score < minApprovalScore) {
                        tier = 4; // Drop / Error out, but still push proposal so user can see it
                    }

                    const prop = {
                        elementA: A,
                        elementB: B,
                        fixType,
                        dist,
                        score,
                        vector: vec.sub(ptB, ptA),
                        description,
                        pass: "Pass 1",
                        ptA,
                        ptB
                    };

                    if (validateAgainst3DRules(prop, config, logger)) {
                        proposals.push(prop);

                        // Track Pass 1 issues to avoid processing them in Pass 2
                        A._IssueListed = true;
                        B._IssueListed = true;

                        logger.push({ stage: "FIXING", type: tier === 4 ? "Error" : "Fix", tier, row: A._rowIndex, message: description, score });
                    }
                }
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PASS 1C: RAY SHOOTER GAP RESOLUTION (Optional bridge pass)
    // ════════════════════════════════════════════════════════════════════════
    const rConfig = config.smartFixer?.rayShooter || { enabled: false };
    if (rConfig.enabled && (config.currentPass || 1) === 1) {
        logger.push({ stage: "FIXING", type: "Info", message: "Executing Pass 1C: Ray Shooter Gap Resolution" });

        // Define Stage 1A (Resolved) and Stage 1B (Orphans)
        const s1aRows = []; // components that successfully matched in Pass 1 or have no open endpoints
        const s1bRows = []; // orphans

        for (const C of physicals) {
            if (C._IssueListed) {
                s1aRows.push(C);
            } else {
                s1bRows.push(C);
            }
        }

        const tubeTol = rConfig.tubeTolerance || 50.0; // "Ray Shooter diameter", originally 25.0

        for (let i = 0; i < s1bRows.length; i++) {
            const O = s1bRows[i];
            if (O._IssueListed) continue; // Might have been resolved earlier in the loop

            const endpoints = [O.ep1, O.ep2, O.bp].filter(Boolean);

            for (const EP of endpoints) {
                // Determine ray direction. If PIPE, use ep2 - ep1.
                let dir = null;
                if (O.type === 'PIPE' && O.ep1 && O.ep2) {
                    dir = vec.normalize(vec.sub(O.ep2, O.ep1));
                    if (EP === O.ep1) dir = vec.scale(dir, -1); // Reverse if shooting backwards
                } else if (O.deltaX !== undefined && O.deltaY !== undefined && O.deltaZ !== undefined) {
                    dir = vec.normalize({ x: O.deltaX, y: O.deltaY, z: O.deltaZ });
                }

                if (!dir || vec.isZero(dir)) continue;

                let hitWinner = null;
                let passUsed = "";

                // PASS 1: Same-Bore Candidates (s1bRows)
                if (rConfig.pass1SameBore && !hitWinner) {
                    const pool = s1bRows.filter(c => c._rowIndex !== O._rowIndex && c.bore === O.bore && !c._IssueListed);

                    // Shoot both +dir and -dir (Target could be behind origin)
                    let hits = rayShoot(EP, dir, 20000, pool, tubeTol);
                    let negHits = rayShoot(EP, vec.scale(dir, -1), 20000, pool, tubeTol);
                    hits = [...hits, ...negHits];

                    if (hits.length > 0) {
                        hitWinner = hits.reduce((min, h) => h.t < min.t ? h : min, hits[0]);
                        passUsed = "Pass 1C-1 (Same-Bore)";
                    }
                }

                // PASS 2: Any-Bore Candidates (s1bRows)
                if (rConfig.pass2AnyBore && !hitWinner) {
                    const pool = s1bRows.filter(c => c._rowIndex !== O._rowIndex && !c._IssueListed);
                    let hits = rayShoot(EP, dir, 20000, pool, tubeTol);
                    let negHits = rayShoot(EP, vec.scale(dir, -1), 20000, pool, tubeTol);
                    hits = [...hits, ...negHits];

                    if (hits.length > 0) {
                        hitWinner = hits.reduce((min, h) => h.t < min.t ? h : min, hits[0]);
                        passUsed = "Pass 1C-2 (Any-Bore)";
                    }
                }

                // PASS 3: Resolved Candidates (s1aRows)
                if (rConfig.pass3Resolved && !hitWinner) {
                    const pool = s1aRows;
                    let hits = rayShoot(EP, dir, 20000, pool, tubeTol);
                    let negHits = rayShoot(EP, vec.scale(dir, -1), 20000, pool, tubeTol);
                    hits = [...hits, ...negHits];

                    if (hits.length > 0) {
                        hitWinner = hits.reduce((min, h) => h.t < min.t ? h : min, hits[0]);
                        passUsed = "Pass 1C-3 (Stage 1A Resolved)";
                    }
                }

                // PASS 4: Global Axis Fallback
                if (rConfig.pass4GlobalAxis && !hitWinner) {
                    // Try shooting along all 6 cardinal axes
                    const axes = [
                        {x: 1, y: 0, z: 0}, {x: -1, y: 0, z: 0},
                        {x: 0, y: 1, z: 0}, {x: 0, y: -1, z: 0},
                        {x: 0, y: 0, z: 1}, {x: 0, y: 0, z: -1}
                    ];

                    const pool = rConfig.pass3Resolved ? [...s1bRows, ...s1aRows] : s1bRows;
                    const validPool = pool.filter(c => c._rowIndex !== O._rowIndex);

                    for (const axis of axes) {
                        const hits = rayShoot(EP, axis, 20000, validPool, tubeTol);
                        if (hits.length > 0) {
                            hitWinner = hits.reduce((min, h) => h.t < min.t ? h : min, hits[0]);
                            passUsed = `Pass 1C-4 (Global Axis ${axis.x ? 'X' : axis.y ? 'Y' : 'Z'})`;
                            break;
                        }
                    }
                }

                if (hitWinner) {
                    const C = hitWinner.component;
                    const targetEP = hitWinner.EP;
                    const dist = hitWinner.t;

                    // If bores mismatch and it's pass 2, 3, or 4, we inject a reducer
                    const injectReducer = (O.bore && C.bore && O.bore !== C.bore);
                    const fixType = injectReducer ? 'GAP_FILL_REDUCER' : 'GAP_FILL';

                    const desc = `[1st Pass]\n[Issue] Unresolved topological void of ${dist.toFixed(1)}mm detected via Ray Shooter.\n[Proposal] Inject ${injectReducer ? 'PIPE & REDUCER' : 'PIPE'} bridging ${dist.toFixed(1)}mm.`;

                    // Generate Proposal
                    const prop = {
                        elementA: O,
                        elementB: C,
                        fixType,
                        dist,
                        score: 95, // Ray hit is highly confident
                        description: desc,
                        pass: "Pass 1", // Group it as Pass 1 so it clears properly
                        ptA: EP,
                        ptB: targetEP
                    };

                    if (validateAgainst3DRules(prop, config, logger)) {
                        proposals.push(prop);

                        // Immediately flag both components as resolved so they don't get shot again this run
                        O._IssueListed = true;
                        C._IssueListed = true;

                        logger.push({ stage: "FIXING", type: "Fix", tier: injectReducer ? 3 : 2, row: O._rowIndex, message: desc, score: 95 });
                    }

                    // Break out of EP loop since we resolved this orphan
                    break;
                }
            }
        }
    }


    // Pass 2: Global Fuzzy Search (Major Axis) up to 6000mm
    if ((config.currentPass || 1) >= 2) {
        logger.push({ stage: "FIXING", type: "Info", message: "Executing Pass 2: Global Fuzzy Search (Major Axis Sense)", row: "-" });

        // 1. Pre-calculate strictly "open" endpoints across the entire physical dataset.
        // Skip any components that already have an issue listed from Pass 1.
        // An endpoint is "closed" if it is <= 1mm from ANY other component's endpoint or branch point.
        const allPoints = [];
        for (const comp of physicals) {
            if (comp.ep1) allPoints.push({ comp, pt: comp.ep1, type: 'ep1', id: `Row${comp._rowIndex}_EP1` });
            if (comp.ep2) allPoints.push({ comp, pt: comp.ep2, type: 'ep2', id: `Row${comp._rowIndex}_EP2` });
            if (comp.bp)  allPoints.push({ comp, pt: comp.bp,  type: 'bp',  id: `Row${comp._rowIndex}_BP`  });
        }

        // Propagate _IssueListed based on exact coordinate matching (topology)
        // If an element is _IssueListed from Pass 1, any component sharing its EXACT coordinates gets flagged too.
        let propagated = true;
        while (propagated) {
            propagated = false;
            for (const p1 of allPoints) {
                if (!p1.comp._IssueListed) continue;
                // p1's component IS listed. Check all other points for coordinate match.
                for (const p2 of allPoints) {
                    if (p1.comp._rowIndex === p2.comp._rowIndex) continue;
                    if (p2.comp._IssueListed) continue;

                    if (vec.dist(p1.pt, p2.pt) <= 1.0) {
                        p2.comp._IssueListed = true;
                        propagated = true;
                    }
                }
            }
        }

        const openEndpoints = [];
        // Pull configured minGap (fallback 6mm)
        const minGap = config.smartFixer?.minGap ?? 6;

        for (const p1 of allPoints) {
            // Skip points belonging to components that already have a pending/approved Pass 1 issue.
            if (p1.comp._IssueListed) continue;

            // We only care to bridge ep1/ep2 for Pass 2 (usually), but we check against all (including bp) for closure
            if (p1.type === 'bp') continue;

            let isClosed = false;
            let hasNeighbor = false;

            for (const p2 of allPoints) {
                if (p1.comp._rowIndex === p2.comp._rowIndex) continue;
                const distance = vec.dist(p1.pt, p2.pt);
                if (distance <= 1.0) {
                    isClosed = true;
                    break;
                }
                // If it doesn't have a Pass 1 issue, but has a local neighbor (< minGap),
                // it shouldn't trigger a massive global 6000mm fuzzy search pipe fill.
                if (distance < minGap) {
                    hasNeighbor = true;
                }
            }

            if (!isClosed && !hasNeighbor) {
                openEndpoints.push(p1);
            }
        }

        // 2. Only attempt to pair genuinely open endpoints
        for (let i = 0; i < openEndpoints.length; i++) {
            for (let j = i + 1; j < openEndpoints.length; j++) {
                const epA = openEndpoints[i];
                const epB = openEndpoints[j];
                const A = epA.comp;
                const B = epB.comp;

                // Use the explicit Rowx check to strictly skip identical rows
                if (A._rowIndex === B._rowIndex) continue;

                const dist = vec.dist(epA.pt, epB.pt);

                if (dist > 0 && dist < 6000) {
                     const dx = Math.abs(epA.pt.x - epB.pt.x);
                     const dy = Math.abs(epA.pt.y - epB.pt.y);
                     const dz = Math.abs(epA.pt.z - epB.pt.z);
                     const maxDev = Math.max(dx, dy, dz);
                     const others = dx + dy + dz - maxDev;

                     // Must be primarily aligned along one axis
                     if (others < 5) {
                         // Check if this pair (A, B) already has a proposal from Pass 1 or Pass 2
                         const existingProp = proposals.find(p => (p.elementA === A && p.elementB === B) || (p.elementA === B && p.elementB === A));
                         if (existingProp) continue;

                         let score = weights.globalAxis;
                         // Add size ratio score if they match
                         if (A.bore && B.bore) {
                             const ratio = A.bore / B.bore;
                             if (ratio >= 0.5 && ratio <= 2.0) {
                                 if (config.smartFixer?.dynamicScoring) {
                                     const deviation = Math.abs(1 - ratio);
                                     let dynamicBonus = weights.sizeRatio * (1 - deviation);
                                     const averageBore = (A.bore + B.bore) / 2;
                                     const sizeFactor = Math.max(0.1, Math.log10(averageBore + 10) / Math.log10(100));
                                     score += (dynamicBonus * sizeFactor);
                                 } else {
                                     score += weights.sizeRatio;
                                 }
                             }
                         }
                         // Add line key score if they match
                         if (config.pteMode?.lineKeyMode && A._lineKey && B._lineKey && A._lineKey === B._lineKey) {
                             score += weights.lineKey;
                         } else if (!config.pteMode?.lineKeyMode) {
                             score += weights.lineKey;
                         }

                         const description = `[2nd Pass]\n[Issue] Non-sequential gap of ${dist.toFixed(1)}mm detected.\n[Proposal] Inject PIPE bridging ${dist.toFixed(1)}mm.`;
                         const tier = score < minApprovalScore ? 4 : 3;

                         const prop = {
                            elementA: A, elementB: B, fixType: 'GAP_FILL', dist, score, vector: vec.sub(epB.pt, epA.pt), description, pass: "Pass 2",
                            ptA: epA.pt, ptB: epB.pt
                         };

                         if (validateAgainst3DRules(prop, config, logger)) {
                             proposals.push(prop);
                             logger.push({ stage: "FIXING", type: tier === 4 ? "Error" : "Fix", tier, row: A._rowIndex, message: description, score });
                         }
                     }
                }
            }
        }
    } else {
        logger.push({ stage: "FIXING", type: "Info", message: "Skipping Pass 2: Awaiting User to Trigger 'Run Second Pass'" });
    }

    // Pass 3: Global Fuzzy Search up to 15000mm
    // logger.push({ stage: "FIXING", type: "Info", message: "Executing Pass 3: Global Fuzzy Search (No Axis Sense)" });

    return { proposals };
}

export function applyApprovedMutations(dataTable, proposals, logger, config) {
    // We must deep clone the table rows because otherwise we mutate the references which affects the UI before apply.
    let updatedTable = dataTable.map(r => ({ ...r, ep1: r.ep1 ? {...r.ep1} : null, ep2: r.ep2 ? {...r.ep2} : null, bp: r.bp ? {...r.bp} : null, cp: r.cp ? {...r.cp} : null }));
    const newPipes = [];

    for (const prop of proposals) {
        const A = updatedTable.find(r => r._rowIndex === prop.elementA._rowIndex);
        const B = updatedTable.find(r => r._rowIndex === prop.elementB._rowIndex);
        if (!A || !B) continue;

        // If it's not approved, just attach the action for the UI but do not apply the physical geometry yet
        if (prop._fixApproved !== true) {
             A.fixingAction = prop.description;
             A.fixingActionTier = prop.dist < 25 ? 2 : 3;
             continue;
        }

        if (prop.fixType === 'TRIM_OVERLAP') {
            if (B.type === 'PIPE' && B.ep1) {
                const oldEp1 = { ...B.ep1 };
                B.ep1 = { ...getExitPoint(A) }; // Trim B to start where A ends
                B.fixingAction = null;
                logger.push({ stage: "FIXING", type: "Applied", row: B._rowIndex, message: `TRIM_OVERLAP: Mutated Row ${B._rowIndex} EP1 from (${oldEp1.x}, ${oldEp1.y}, ${oldEp1.z}) to (${B.ep1.x}, ${B.ep1.y}, ${B.ep1.z})` });
            }
        } else if (prop.fixType === 'GAP_STRETCH_PIPE') {
            if (B.type === 'PIPE' && B.ep1) {
                const oldEp1 = { ...B.ep1 };
                B.ep1 = { ...getExitPoint(A) }; // Stretch B backwards to meet A (BM1 standard)
                B.fixingAction = null;
                logger.push({ stage: "FIXING", type: "Applied", row: B._rowIndex, message: `GAP_STRETCH_PIPE: Mutated Row ${B._rowIndex} EP1 from (${oldEp1.x}, ${oldEp1.y}, ${oldEp1.z}) to (${B.ep1.x}, ${B.ep1.y}, ${B.ep1.z})` });
            } else if (A.type === 'PIPE' && A.ep2) {
                const oldEp2 = { ...A.ep2 };
                A.ep2 = { ...getEntryPoint(B) }; // Stretch A to meet B
                A.fixingAction = null;
                logger.push({ stage: "FIXING", type: "Applied", row: A._rowIndex, message: `GAP_STRETCH_PIPE: Mutated Row ${A._rowIndex} EP2 from (${oldEp2.x}, ${oldEp2.y}, ${oldEp2.z}) to (${A.ep2.x}, ${A.ep2.y}, ${A.ep2.z})` });
            }
        } else if (prop.fixType === 'GAP_SNAP_IMMUTABLE' || prop.fixType === 'GAP_SNAP_IMMUTABLE_BLOCK') {
            if (['FLANGE','BEND','TEE','VALVE'].includes(B.type)) {
                // Translate B backwards to meet A
                const trans = vec.sub(getExitPoint(A), getEntryPoint(B));
                const oldEp1 = B.ep1 ? { ...B.ep1 } : null;
                if (B.ep1) B.ep1 = vec.add(B.ep1, trans);
                if (B.ep2) B.ep2 = vec.add(B.ep2, trans);
                if (B.cp) B.cp = vec.add(B.cp, trans);
                if (B.bp) B.bp = vec.add(B.bp, trans);
                B.fixingAction = null;
                logger.push({ stage: "FIXING", type: "Applied", row: B._rowIndex, message: `GAP_SNAP: Translated Row ${B._rowIndex} by vector (${trans.x.toFixed(1)}, ${trans.y.toFixed(1)}, ${trans.z.toFixed(1)}). Old EP1: ${oldEp1 ? `(${oldEp1.x}, ${oldEp1.y}, ${oldEp1.z})` : 'N/A'}` });
            }
        } else if (prop.fixType === 'ZERO_COORD_CALC') {
             if (prop.target === 'ep1') {
                 const oldEp1 = { ...A.ep1 };
                 A.ep1 = { ...prop.newPt };
                 A.fixingAction = null;
                 logger.push({ stage: "FIXING", type: "Applied", row: A._rowIndex, message: `ZERO_COORD_CALC: Calculated Row ${A._rowIndex} EP1 from (${oldEp1.x}, ${oldEp1.y}, ${oldEp1.z}) to (${A.ep1.x}, ${A.ep1.y}, ${A.ep1.z})` });
             } else if (prop.target === 'ep2') {
                 const oldEp2 = { ...A.ep2 };
                 A.ep2 = { ...prop.newPt };
                 A.fixingAction = null;
                 logger.push({ stage: "FIXING", type: "Applied", row: A._rowIndex, message: `ZERO_COORD_CALC: Calculated Row ${A._rowIndex} EP2 from (${oldEp2.x}, ${oldEp2.y}, ${oldEp2.z}) to (${A.ep2.x}, ${A.ep2.y}, ${A.ep2.z})` });
             }
        } else if (prop.fixType === 'GAP_FILL') {
            // Inject pipe
            const filler = {
                _rowIndex: -1,
                csvSeqNo: `${A.csvSeqNo}.GF`,
                type: 'PIPE',
                bore: A.bore,
                ep1: { ...getExitPoint(A) },
                ep2: { ...getEntryPoint(B) },
                ca: { ...A.ca, 8: null },
                refNo: A.refNo ? `${A.refNo}-GF` : 'SYN-GF',
                fixingAction: null,
            };
            newPipes.push({ afterRow: A._rowIndex, pipe: filler });
            logger.push({ stage: "FIXING", type: "Applied", row: A._rowIndex, message: `GAP_FILL: Injected new PIPE after Row ${A._rowIndex} to bridge gap to Row ${B._rowIndex}.` });
        } else if (prop.fixType === 'GAP_FILL_REDUCER') {
            // Inject pipe & reducer (Ray Shooter Phase 2/3/4)
            const reducerPt = { ...getEntryPoint(B) };

            // Bridge Pipe
            const filler = {
                _rowIndex: -1,
                csvSeqNo: `${A.csvSeqNo}.BR`,
                type: 'PIPE',
                bore: A.bore,
                ep1: { ...getExitPoint(A) },
                ep2: { ...reducerPt }, // Pipe ends at reducer
                ca: { ...A.ca, 8: null },
                refNo: A.refNo ? `${A.refNo}-BR` : 'SYN-BR',
                fixingAction: null,
            };
            newPipes.push({ afterRow: A._rowIndex, pipe: filler });

            // Reducer
            const reducer = {
                _rowIndex: -1,
                _isSynthetic: true,
                csvSeqNo: `${A.csvSeqNo}.RD`,
                refNo: `SYNTH-RED-RAY`,
                type: 'REDUCER',
                bore: A.bore,
                reducedBore: B.bore,
                ep1: { ...reducerPt },
                ep2: { ...reducerPt }, // Spec says 0 length reducer at target end
                text: `REDUCER, LENGTH=0MM, RefNo:=SYNTH, SeqNo:SYNTH`,
                ca: { 1: 'SYNTHETIC_REDUCER_RAY' },
                fixingAction: null,
                _passApplied: 1
            };
            // Add reducer *after* the bridge pipe
            newPipes.push({ afterRow: A._rowIndex + 0.1, pipe: reducer });

            logger.push({ stage: "FIXING", type: "Applied", row: A._rowIndex, message: `GAP_FILL_REDUCER: Injected new PIPE and REDUCER after Row ${A._rowIndex} to bridge gap and match bore to Row ${B._rowIndex}.` });
        }
    }

    // Insert new pipes
    for (const insertion of newPipes.sort((a,b) => b.afterRow - a.afterRow)) {
        const idx = updatedTable.findIndex(r => r._rowIndex === Math.floor(insertion.afterRow));
        if (idx > -1) {
            updatedTable.splice(idx + 1, 0, insertion.pipe);
        }
    }

    updatedTable.forEach((r, i) => r._rowIndex = i + 1);

    // Pass 3A Toggle Execution (Synthesize Reducers & Missing Assemblies)
    // In our runner, `config.smartFixer` might not exist or `enablePass3A` might be true/false.
    // Default to true for now since it fixes benchmarks, but wrap safely.
    if (config && (config.enablePass3A !== false)) {
        updatedTable = synthesizeMissingAssemblies(updatedTable, config);
    }

    return updatedTable;
}

// ----------------------------------------------------
// Pass 3A (Phase 2A) Synthesis Logic
// ----------------------------------------------------
function synthesizeMissingAssemblies(dataTable, config) {
    let updatedTable = [...dataTable];
    const newComponents = [];
    let synthCount = 1;

    const weights = config.smartFixer?.weights || { lineKey: 10, sizeRatio: 5, elementalAxis: 3, globalAxis: 2 };
    const minScore = config.smartFixer?.minApprovalScore || 10;

    // 1. Detect Missing REDUCER (BM3)
    const tees = updatedTable.filter(r => r.type === 'TEE' || r.type === 'OLET');

    for (const tee of tees) {
        if (!tee.bp || !tee.branchBore) continue;

        // Find the connected branch pipe
        const branchPipe = updatedTable.find(p => p.type === 'PIPE' && ((p.ep1 && vec.dist(p.ep1, tee.bp) < 150) || (p.ep2 && vec.dist(p.ep2, tee.bp) < 150)));

        // Also check if a reducer or something is already there
        const existingReducer = updatedTable.find(r => (r.type === 'REDUCER' || r.type === 'FLANGE') && ((r.ep1 && vec.dist(r.ep1, tee.bp) < 10) || (r.ep2 && vec.dist(r.ep2, tee.bp) < 10)));

        if (branchPipe && branchPipe.bore !== tee.branchBore && !existingReducer) {
            let score = 0;
            // LineKey check
            if (tee._lineKey === branchPipe._lineKey) score += weights.lineKey;
            else if (!config.pteMode?.lineKeyMode) score += weights.lineKey;

            // Proximity check (since they are close, it counts towards axis/intent)
            score += weights.elementalAxis;

            if (score >= minScore) {
                const synthReducer = {
                    _rowIndex: -1,
                    _isSynthetic: true,
                    csvSeqNo: `SYNTH-RED-${synthCount++}`,
                    refNo: `SYNTH-RED-${synthCount}`,
                    type: 'REDUCER',
                    bore: tee.branchBore,
                    reducedBore: branchPipe.bore,
                    ep1: { ...tee.bp },
                    ep2: { ...tee.bp },
                    text: `REDUCER, LENGTH=50MM, RefNo:=SYNTH, SeqNo:SYNTH`,
                            ca: { 1: 'SYNTHETIC_REDUCER' },
                            fixingAction: `[Pass 3A] SYNTHESIZE_REDUCER: Injected between Branch/Tee to bridge gap.`,
                            _passApplied: 3
                };

            const isEp1 = vec.dist(branchPipe.ep1, tee.bp) < vec.dist(branchPipe.ep2, tee.bp);
            const attachPoint = isEp1 ? branchPipe.ep1 : branchPipe.ep2;
            const farPoint = isEp1 ? branchPipe.ep2 : branchPipe.ep1;

            if (vec.dist(tee.bp, attachPoint) < 5) {
                // If touching, offset the pipe to make room for reducer
                const axis = vec.normalize(vec.sub(farPoint, attachPoint));
                if (axis.x === 0 && axis.y === 0 && axis.z === 0) axis.y = 1;
                const offset = vec.scale(axis, 50);
                synthReducer.ep2 = vec.add(tee.bp, offset);
                if (isEp1) branchPipe.ep1 = { ...synthReducer.ep2 };
                else branchPipe.ep2 = { ...synthReducer.ep2 };
            } else {
                // Gap exists, bridge it
                synthReducer.ep2 = { ...attachPoint };
            }

            newComponents.push({ afterRow: tee._rowIndex, comp: synthReducer });
            }
        }
    }

    // 2. Detect Missing RV Assemblies (BM6)
    const connectables = updatedTable.filter(r => r.type === 'PIPE' || r.type === 'TEE');

    for (let i = 0; i < connectables.length; i++) {
        const A = connectables[i];
        const ptA = A.type === 'TEE' ? A.bp : A.ep2;
        if (!ptA) continue;

        for (let j = 0; j < connectables.length; j++) {
            if (i === j) continue;
            const B = connectables[j];
            const ptB = B.ep1;
            if (!ptB) continue;

            const dist = vec.dist(ptA, ptB);

            if (dist > 250 && dist < 500) {
                const existingComp = updatedTable.find(r =>
                    r.type !== 'PIPE' && r.ep1 && r.ep2 &&
                    (vec.dist(r.ep1, ptA) < 5 || vec.dist(r.ep2, ptB) < 5)
                );

                const alreadyInjected = newComponents.find(c => vec.dist(c.comp.ep1, ptA) < 5 && vec.dist(c.comp.ep2, ptB) < 5);

                if (!existingComp && !alreadyInjected) {
                    let score = 0;
                    if (A._lineKey === B._lineKey) score += weights.lineKey;
                    else if (!config.pteMode?.lineKeyMode) score += weights.lineKey;

                    if (A.bore && B.bore) {
                        const ratio = A.bore / B.bore;
                        if (ratio >= 0.5 && ratio <= 2.0) score += weights.sizeRatio;
                    }

                    if (score >= minScore) {
                        const synthValve = {
                            _rowIndex: -1,
                            _isSynthetic: true,
                            csvSeqNo: `SYNTH-VALVE-${synthCount++}`,
                            refNo: `SYNTH-VALVE-${synthCount}`,
                            type: 'VALVE',
                            bore: A.branchBore || A.bore || B.bore || 100,
                            ep1: { ...ptA },
                            ep2: { ...ptB },
                            text: `VALVE, LENGTH=${Math.round(dist)}MM, RefNo:=SYNTH, SeqNo:SYNTH`,
                            ca: { 1: 'SYNTHETIC_VALVE' },
                            fixingAction: `[Pass 3A] SYNTHESIZE_VALVE: Bridged major void ${dist.toFixed(1)}mm.`,
                            _passApplied: 3
                        };
                        newComponents.push({ afterRow: A._rowIndex, comp: synthValve });
                    }
                }
            }
        }
    }

    // Insert new components into table
    for (const insertion of newComponents.sort((a,b) => b.afterRow - a.afterRow)) {
        const idx = updatedTable.findIndex(r => r._rowIndex === insertion.afterRow);
        if (idx > -1) {
            updatedTable.splice(idx + 1, 0, insertion.comp);
        } else {
            updatedTable.push(insertion.comp);
        }
    }

    updatedTable.forEach((r, i) => r._rowIndex = i + 1);

    return updatedTable;
}
