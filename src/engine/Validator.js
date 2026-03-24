import { vec } from '../math/VectorMath.js';

export function runValidationChecklist(dataTable, config, logger, stage = "1") {
  logger.push({ stage: "VALIDATION", type: "Info", message: "═══ RUNNING V1-V20 VALIDATION CHECKLIST ═══" });

  let errorCount = 0;
  let warnCount = 0;

  // Auto-detect precision standard from the first 20 rows
  let floatCount = 0;
  let intCount = 0;
  for (let i = 0; i < Math.min(20, dataTable.length); i++) {
      const r = dataTable[i];
      if (r.ep1) {
          if (!Number.isInteger(r.ep1.x) || !Number.isInteger(r.ep1.y) || !Number.isInteger(r.ep1.z)) floatCount++;
          else intCount++;
      }
  }
  const isGlobalFloatStandard = floatCount > intCount;

  for (const row of dataTable) {
    const type = (row.type || "").toUpperCase();
    const ri = row._rowIndex;

    if (type === "UNKNOWN" || !type) continue;

    const enabledChecks = config.enabledChecks || {};

    // Helper to see if a rule should run
    const shouldRun = (ruleId) => enabledChecks[ruleId] !== false; // default true if missing

    // V2: Decimal Consistency (Auto-detected)
    if (shouldRun('V2') && row.ep1) {
        const isLocalFloat = !Number.isInteger(row.ep1.x) || !Number.isInteger(row.ep1.y) || !Number.isInteger(row.ep1.z);
        if (!isGlobalFloatStandard && isLocalFloat) {
            logger.push({ stage: "VALIDATION", type: "Warning", ruleId: "V2", tier: 3, row: ri, message: `WARNING [V2]: Decimal consistency violation. Expected integers based on file standard.` });
            warnCount++;
        }
    }

    // V17: No EP should be blank or "-"
    if (shouldRun('V17')) {
        const checkEP = (ep, name) => {
            if (ep === undefined || ep === null || ep === "" || ep === "-") {
                logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V17", tier: 4, row: ri, message: `ERROR [V17]: ${name} is missing, blank, or "-".` });
                errorCount++;
            }
        };
        // Exclude components that legitimately do not have end-points like SUPPORT (handled else where/not strictly required to have EP),
        // but typically all connectable physical components should have at least EP1.
        // Actually the rule just says "No EP should be blank or -". Let's apply it generally to physical components that have parsed EPs.
        // If it's undefined, maybe it wasn't parsed. If it's a structural component, it needs it.
        const nonEpComps = ["OLET", "SUPPORT", "PIPELINE-REFERENCE", "MESSAGE-SQUARE"];
        if (!nonEpComps.includes(type) && !type.startsWith("UNITS-")) {
            checkEP(row.ep1, "EP1");
            checkEP(row.ep2, "EP2");
        }
    }

    // V3: Bore Consistency
    if (shouldRun('V3')) {
        if (type.includes("REDUCER")) {
            if (row.bore === row.branchBore) {
                logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V3", tier: 4, row: ri, message: `ERROR [V3]: REDUCER EP1 bore = EP2 bore. Must differ.` });
                errorCount++;
            }
        } else if (["PIPE", "FLANGE", "VALVE", "BEND", "TEE"].includes(type)) {
            if (row._rowIndex > 1) {
                const prevRow = dataTable.find(r => r._rowIndex === row._rowIndex - 1);

                // Fix: Check if this row is actually connected to the previous row before comparing bores.
                // If it's a branch from somewhere else (like Row 6 connecting to Row 3 branch), the bore might legitimately differ from the sequential previous row.
                let isSequentiallyConnected = false;
                if (prevRow && prevRow.ep2 && row.ep1 && (Math.abs(prevRow.ep2.x - row.ep1.x) < 1 && Math.abs(prevRow.ep2.y - row.ep1.y) < 1 && Math.abs(prevRow.ep2.z - row.ep1.z) < 1)) {
                    isSequentiallyConnected = true;
                }

                if (isSequentiallyConnected && prevRow && !prevRow.type.includes("REDUCER") && prevRow.bore && row.bore && prevRow.bore !== row.bore) {
                     logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V3", tier: 4, row: ri, message: `ERROR [V3]: PIPE bore changes without being reducer.` });
                     errorCount++;
                }
            }
        }
    }

    // V9: TEE CP bore = EP bore
    if (shouldRun('V9') && type === "TEE" && row.cpBore !== undefined && row.cpBore !== row.bore) {
        logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V9", tier: 4, row: ri, message: "ERROR [V9]: TEE CP bore != EP bore." });
        errorCount++;
    }

    // V12, V13, V19, V20: SUPPORT Checks
    if (type === "SUPPORT") {
        if (shouldRun('V12')) {
            let hasCA = false;
            for (const k of Object.keys(row.ca || {})) {
                const caNum = parseInt(k, 10);
                if (caNum >= 1 && caNum <= 10 && row.ca[k] !== undefined && row.ca[k] !== null && row.ca[k] !== "") hasCA = true;
            }
            if (hasCA) {
                logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V12", tier: 4, row: ri, message: "ERROR [V12]: SUPPORT must not have CA1 through CA10." });
                errorCount++;
            }
        }

        // V13: SUPPORT bore = 0
        if (shouldRun('V13') && row.bore !== 0 && row.bore !== undefined && row.bore !== null && row.bore !== "") {
             logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V13", tier: 4, row: ri, message: "ERROR [V13]: SUPPORT bore must be 0." });
             errorCount++;
        }

        // V19: SUPPORT MSG-SQUARE
        if (shouldRun('V19') && row.text && (row.text.includes("LENGTH=") || row.text.includes("MM") || row.text.includes("NORTH") || row.text.includes("SOUTH") || row.text.includes("EAST") || row.text.includes("WEST") || row.text.includes("UP") || row.text.includes("DOWN"))) {
             logger.push({ stage: "VALIDATION", type: "Warning", ruleId: "V19", tier: 3, row: ri, message: "WARNING [V19]: SUPPORT MSG-SQ contains invalid tokens." });
             warnCount++;
        }

        // V20: GUID Prefix
        if (shouldRun('V20') && row.supportGuid && !row.supportGuid.startsWith("UCI:")) {
             logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V20", tier: 4, row: ri, message: "ERROR [V20]: SUPPORT GUID must start with UCI:." });
             errorCount++;
        }
    }

    // V16: CA8 Scope
    if (shouldRun('V16') && row.ca && row.ca[8]) {
        if (["PIPE", "SUPPORT"].includes(type)) {
            logger.push({ stage: "VALIDATION", type: "Warning", ruleId: "V16", tier: 3, row: ri, message: `WARNING [V16]: CA8 populated for ${type}.` });
            warnCount++;
        }
    }

    // V15: Coordinate Continuity (Only in Stage 2/3)
    if (stage !== "1" && shouldRun('V15') && type !== "SUPPORT" && row._rowIndex > 1) {
        const prevRow = dataTable.find(r => r._rowIndex === row._rowIndex - 1);
        if (prevRow && prevRow.ep2 && row.ep1 && !vec.approxEqual(row.ep1, prevRow.ep2, 1.0)) {
            const dist = vec.dist(row.ep1, prevRow.ep2);
            logger.push({ stage: "VALIDATION", type: "Warning", ruleId: "V15", tier: 3, row: ri, message: `WARNING [V15]: Coordinate discontinuity at EP1 by ${dist.toFixed(1)}mm.` });
            warnCount++;
        }
    }

    // If we are in Stage 2 or beyond, DO NOT run the basic syntax V-rules, EXCEPT V15.
    if (stage !== "1") continue;

    // V1: No (0,0,0) coords
    // If a point is exactly (0,0,0), it usually means it was not exported properly.
    // We should log a warning/error, and then the Fixer can calculate it based on previous row and length.
    const checkV1 = (pt, name) => {
      if (pt && vec.isZero(pt)) {
        row.fixingAction = `[V1] ${name} is (0,0,0). Will attempt to calculate via Prev/Next EP and component length.`;
        row.fixingActionTier = 3;
        logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V1", tier: 4, row: ri, message: `ERROR [V1]: ${name} coordinate is exactly (0,0,0). Needs calculation.` });
        errorCount++;
      }
    };
    checkV1(row.ep1, "EP1");
    checkV1(row.ep2, "EP2");
    checkV1(row.cp, "CP");
    checkV1(row.bp, "BP");
    checkV1(row.supportCoor, "CO-ORDS");

    // V4, V5, V6, V7, V22, V24: BEND checks
    if (type === "BEND") {
      if (row.cp && row.ep1 && vec.approxEqual(row.cp, row.ep1, 0.1)) {
        logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V4", tier: 4, row: ri, message: "ERROR [V4]: BEND CP equals EP1." });
        errorCount++;
      }
      if (row.cp && row.ep2 && vec.approxEqual(row.cp, row.ep2, 0.1)) {
        logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V5", tier: 4, row: ri, message: "ERROR [V5]: BEND CP equals EP2." });
        errorCount++;
      }
      if (row.cp && row.ep1 && row.ep2) {
        const v1 = vec.sub(row.ep1, row.cp);
        const v2 = vec.sub(row.ep2, row.cp);
        if (shouldRun('V6') && vec.mag(vec.cross(v1, v2)) < 0.001) {
          logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V6", tier: 4, row: ri, message: "ERROR [V6]: BEND CP is collinear with EPs." });
          errorCount++;
        }
        const r1 = vec.dist(row.cp, row.ep1);
        const r2 = vec.dist(row.cp, row.ep2);
        if (Math.abs(r1 - r2) > 1.0) {
          logger.push({ stage: "VALIDATION", type: "Warning", ruleId: "V7", tier: 3, row: ri, message: `WARNING [V7]: BEND not equidistant. R1=${r1.toFixed(1)}, R2=${r2.toFixed(1)}.` });
          warnCount++;
        }

        if (shouldRun('V22')) {
            // Check Bend Radius
            if (r1 < 1 || r2 < 1) {
                 logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V22", tier: 4, row: ri, message: `ERROR [V22]: BEND Radius is unrealistically small (<1mm).` });
                 errorCount++;
            }
        }

        if (shouldRun('V24')) {
            const magV1 = vec.mag(v1);
            const magV2 = vec.mag(v2);
            if (magV1 > 0 && magV2 > 0) {
                const dot = vec.dot(v1, v2) / (magV1 * magV2);
                if (dot > 0.99) {
                     logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V24", tier: 4, row: ri, message: `ERROR [V24]: BEND angle invalid (0-degree foldback).` });
                     errorCount++;
                } else if (dot < -0.99) {
                     logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V24", tier: 4, row: ri, message: `ERROR [V24]: BEND angle invalid (180-degree straight pipe).` });
                     errorCount++;
                }
            }
        }
      }
    }

    // V8, V9, V10, V21: TEE checks
    if (type === "TEE") {
      if (row.cp && row.ep1 && row.ep2) {
        const mid = vec.mid(row.ep1, row.ep2);
        if (!vec.approxEqual(row.cp, mid, 1.0)) {
          logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V8", tier: 4, row: ri, message: "ERROR [V8]: TEE CP is not at midpoint of EP1-EP2." });
          errorCount++;
        }
      }
      if (row.bp && row.cp && row.ep1 && row.ep2) {
        const branchVec = vec.sub(row.bp, row.cp);
        const headerVec = vec.sub(row.ep2, row.ep1);
        const dotProd = Math.abs(vec.dot(branchVec, headerVec));
        const threshold = 0.01 * vec.mag(branchVec) * vec.mag(headerVec);
        if (dotProd > threshold) {
          logger.push({ stage: "VALIDATION", type: "Warning", ruleId: "V10", tier: 3, row: ri, message: "WARNING [V10]: TEE Branch is not perpendicular to header." });
          warnCount++;
        }
      }
      if (shouldRun('V21')) {
          if (!row.bp) {
              logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V21", tier: 4, row: ri, message: "ERROR [V21]: TEE is missing Branch Point (BP)." });
              errorCount++;
          } else if (row.cp && vec.approxEqual(row.cp, row.bp, 0.1)) {
              logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V21", tier: 4, row: ri, message: "ERROR [V21]: TEE BP is coincident with CP." });
              errorCount++;
          } else if (row.cp && row.brlen && Math.abs(vec.dist(row.cp, row.bp) - row.brlen) > 1.0) {
              logger.push({ stage: "VALIDATION", type: "Warning", ruleId: "V21", tier: 3, row: ri, message: "WARNING [V21]: TEE BP distance from CP does not match BRLEN." });
              warnCount++;
          }
      }
    }

    // V11: OLET checks
    if (type === "OLET") {
      if (row.ep1 || row.ep2) {
        logger.push({ stage: "VALIDATION", type: "Error", ruleId: "V11", tier: 4, row: ri, message: "ERROR [V11]: OLET must not have END-POINTs." });
        errorCount++;
      }
    }

    // V14: SKEY Presence
    const skeyRequired = ["FLANGE", "VALVE", "BEND", "TEE", "OLET", "REDUCER-CONCENTRIC", "REDUCER-ECCENTRIC"];
    if (skeyRequired.includes(type) && !row.skey) {
      logger.push({ stage: "VALIDATION", type: "Warning", ruleId: "V14", tier: 3, row: ri, message: `WARNING [V14]: Missing <SKEY> for ${type}.` });
      warnCount++;
    }

    // V18: Bore Unit
    if (row.bore > 0 && row.bore <= 48) {
      const standardMm = [15, 20, 25, 32, 40, 50, 65, 80, 90, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600, 750, 900, 1050, 1200];
      if (!standardMm.includes(row.bore)) {
        logger.push({ stage: "VALIDATION", type: "Warning", ruleId: "V18", tier: 3, row: ri, message: `WARNING [V18]: Bore ${row.bore} may be in inches. Ensure all values are MM.` });
        warnCount++;
      }
    }
  }

  logger.push({ stage: "VALIDATION", type: "Info", message: `═══ VALIDATION COMPLETE: ${errorCount} Errors, ${warnCount} Warnings ═══` });

  return { errorCount, warnCount };
}
