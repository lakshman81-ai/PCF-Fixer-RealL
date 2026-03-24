import { vec } from '../../math/VectorMath.js';
import { getEntryPoint, getExitPoint } from '../GraphBuilder.js';

export function runAggRules(chain, context, config, log) {
  const cfg = config.smartFixer || {};
  const chainId = context.chainId;
  const startRow = chain[0]?.element?._rowIndex;

  // R-BRN-05: Branch Chain Continuation
  for (let i = 0; i < chain.length; i++) {
    const link = chain[i];
    if (link.element.type === "TEE" && link.branchChain && link.branchChain.length > 0) {
      checkRBRN05(link.element, link.branchChain, config, log);
    }
  }

  // R-AGG-01: Total pipe length sanity
  if (context.pipeLengthSum <= 0 && chain.length > 0) {
    log.push({ type: "Error", ruleId: "R-AGG-01", tier: 4, row: startRow,
      message: `ERROR [R-AGG-01]: ${chainId} has zero pipe length. Fundamentally broken.` });
  }

  // R-AGG-03: Route closure check
  if (chain.length >= 2) {
    const startPt = getEntryPoint(chain[0].element);
    const endPt = getExitPoint(chain[chain.length - 1].element);

    if (startPt && endPt) {
      const expected = vec.sub(endPt, startPt);
      const actual = context.cumulativeVector;
      const error = vec.mag(vec.sub(expected, actual));
      const closureWarn = Number(cfg.closureWarningThreshold ?? 5.0);
      const closureErr = Number(cfg.closureErrorThreshold ?? 50.0);

      if (error > closureErr) {
        log.push({ type: "Error", ruleId: "R-AGG-03", tier: 4, row: startRow,
          message: `ERROR [R-AGG-03]: ${chainId} closure error ${error.toFixed(1)}mm.` });
      } else if (error > closureWarn) {
        log.push({ type: "Warning", ruleId: "R-AGG-03", tier: 3, row: startRow,
          message: `WARNING [R-AGG-03]: ${chainId} closure error ${error.toFixed(1)}mm.` });
      }
    }
  }

  // R-TOP-01 (Part of AGG check): Dead-end detection
  if (chain.length > 0) {
    const lastElem = chain[chain.length - 1].element;
    const lastType = (lastElem.type || "").toUpperCase();
    if (lastType === "PIPE") {
      log.push({ type: "Warning", ruleId: "R-TOP-01", tier: 3, row: lastElem._rowIndex,
        message: `WARNING [R-TOP-01]: ${chainId} ends at bare PIPE. Expected terminal fitting.` });
    }
  }

  // R-AGG-05: Flange pair completeness
  const midFlanges = chain.filter((link, i) => {
    return (link.element.type || "").toUpperCase() === "FLANGE" && i > 0 && i < chain.length - 1;
  });
  if (midFlanges.length % 2 !== 0) {
    log.push({ type: "Warning", ruleId: "R-AGG-05", tier: 3, row: midFlanges[0]?.element?._rowIndex,
      message: `WARNING [R-AGG-05]: ${chainId} has ${midFlanges.length} mid-chain flanges (odd). Missing mating flange?` });
  }

  // R-AGG-06: No supports on long chain
  const chainLenM = vec.mag(context.cumulativeVector) / 1000;
  const noSupportThresh = Number(cfg.noSupportAlertLength ?? 10000) / 1000;
  if (chainLenM > noSupportThresh) {
    log.push({ type: "Warning", ruleId: "R-AGG-06", tier: 3, row: startRow,
      message: `WARNING [R-AGG-06]: ${chainId} is ${chainLenM.toFixed(1)}m long. Verify supports are included.` });
  }
}

function checkRBRN05(teeElement, branchChain, config, log) {
  if (!teeElement.bp || !branchChain || branchChain.length === 0) return;

  const branchFirst = branchChain[0].element;
  const branchEP1 = getEntryPoint(branchFirst);
  if (!branchEP1) return;

  const gap = vec.dist(teeElement.bp, branchEP1);
  const tolerance = config.smartFixer?.connectionTolerance ?? 25.0;

  if (gap > tolerance) {
    log.push({ type: "Error", ruleId: "R-BRN-05", tier: 4, row: branchFirst._rowIndex,
      message: `ERROR [R-BRN-05 T4]: TEE branch point does not connect to first branch element. Gap=${gap.toFixed(1)}mm (tolerance=${tolerance}mm).` });
  }

  // Also check bore continuity at branch start
  if (branchFirst.bore && teeElement.branchBore &&
      branchFirst.bore !== teeElement.branchBore) {
    log.push({ type: "Warning", ruleId: "R-BRN-05", tier: 3, row: branchFirst._rowIndex,
      message: `WARNING [R-BRN-05]: TEE branch bore (${teeElement.branchBore}mm) ≠ first branch element bore (${branchFirst.bore}mm).` });
  }
}

export function detectOrphans(components, visited, log) {
  const orphans = components.filter(c =>
    !visited.has(c._rowIndex) &&
    (c.type || "").toUpperCase() !== "SUPPORT"
  );

  for (const orphan of orphans) {
    log.push({ type: "Error", ruleId: "R-TOP-02", tier: 4, row: orphan._rowIndex,
      message: `ERROR [R-TOP-02 T4]: ${orphan.type} (Row ${orphan._rowIndex}) is orphaned — not connected to any chain.` });
  }

  return orphans;
}

export function detectDuplicates(components, config, log) {
  const tolerance = 2.0; // mm — two elements at same location = duplicate
  const duplicates = [];

  for (let i = 0; i < components.length; i++) {
    const a = components[i];
    if (!a.ep1 || !a.ep2) continue;
    const aType = (a.type || "").toUpperCase();

    for (let j = i + 1; j < components.length; j++) {
      const b = components[j];
      if (!b.ep1 || !b.ep2) continue;
      const bType = (b.type || "").toUpperCase();

      // Same type and overlapping spatial extent
      if (aType === bType &&
          vec.approxEqual(a.ep1, b.ep1, tolerance) &&
          vec.approxEqual(a.ep2, b.ep2, tolerance)) {
        duplicates.push({ rowA: a._rowIndex, rowB: b._rowIndex, type: aType });
        log.push({ type: "Error", ruleId: "R-TOP-03", tier: 4, row: b._rowIndex,
          message: `ERROR [R-TOP-03 T4]: Duplicate ${aType} — Row ${a._rowIndex} and Row ${b._rowIndex} occupy identical space. Delete one.` });
      }
    }
  }

  return duplicates;
}
