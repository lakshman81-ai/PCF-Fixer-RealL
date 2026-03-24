import { vec } from '../math/VectorMath.js';
import { getExitPoint, getEntryPoint } from './GraphBuilder.js';
import { getElementVector } from './AxisDetector.js';

export function applyFixes(dataTable, chains, config, log) {
  const applied = [];
  const newRows = [];
  const deleteRows = new Set();

  for (const chain of chains) {
    for (const link of chain) {
      const elem = link.element;
      if (elem._proposedFix?.type === "DELETE" && elem._proposedFix.tier <= 2 && elem._fixApproved === true) {
        deleteRows.add(elem._rowIndex);
        applied.push({ ruleId: elem._proposedFix.ruleId, row: elem._rowIndex, action: "DELETE" });
        log.push({ type: "Applied", ruleId: elem._proposedFix.ruleId, row: elem._rowIndex,
          message: `APPLIED: Deleted ${elem.type} at Row ${elem._rowIndex}.` });
      }
    }
  }

  for (const chain of chains) {
    for (const link of chain) {
      const elem = link.element;
      if (elem._proposedFix?.type === "SNAP_AXIS" && elem._proposedFix.tier <= 2 && elem._fixApproved === true) {
        const axis = elem._proposedFix.dominantAxis;
        snapToSingleAxis(elem, axis);
        markModified(elem, "ep1", "SmartFix:R-GEO-03"); elem._passApplied = config.currentPass || 1;
        markModified(elem, "ep2", "SmartFix:R-GEO-03");
        applied.push({ ruleId: "R-GEO-03", row: elem._rowIndex, action: "SNAP_AXIS" });
      }
    }
  }

  for (const chain of chains) {
    for (const link of chain) {
      if (!link.fixAction) continue;
      if (link.fixAction.type === "SNAP" && link.fixAction.tier <= 2 && link.element._fixApproved === true) {
        snapEndpoints(link.element, link.nextElement);
        markModified(link.element, "ep2", `SmartFix:${link.fixAction.ruleId}`); link.element._passApplied = config.currentPass || 1;
        markModified(link.nextElement, "ep1", `SmartFix:${link.fixAction.ruleId}`);
        applied.push({ ruleId: link.fixAction.ruleId, row: link.element._rowIndex, action: "SNAP" });
      }
    }
  }

  for (const chain of chains) {
    for (const link of chain) {
      if (!link.fixAction) continue;
      if (link.fixAction.type === "TRIM" && link.element._fixApproved === true) {
        const target = link.fixAction.trimTarget === "current" ? link.element : link.nextElement;
        if ((target.type || "").toUpperCase() === "PIPE") {
          trimPipe(target, link.fixAction.trimAmount, link.travelAxis, link.travelDirection, link.fixAction.trimTarget);
          markModified(target, link.fixAction.trimTarget === "current" ? "ep2" : "ep1", `SmartFix:${link.fixAction.ruleId}`); target._passApplied = config.currentPass || 1;
          applied.push({ ruleId: link.fixAction.ruleId, row: target._rowIndex, action: "TRIM" });
          log.push({ type: "Applied", ruleId: link.fixAction.ruleId, row: target._rowIndex,
            message: `APPLIED: Trimmed ${target.type} by ${link.fixAction.trimAmount.toFixed(1)}mm.` });

          const remaining = vec.mag(getElementVector(target));
          const microThresh = Number(config.smartFixer?.microPipeThreshold ?? 6.0);
          if (remaining < microThresh) {
            deleteRows.add(target._rowIndex);
            log.push({ type: "Applied", ruleId: "R-OVR-06", row: target._rowIndex,
              message: `APPLIED: Pipe reduced to ${remaining.toFixed(1)}mm after trim. Deleted.` });
          }
        }
      }
    }
  }

  for (const chain of chains) {
    for (const link of chain) {
      if (!link.fixAction) continue;
      if (link.fixAction.type === "INSERT" && link.element._fixApproved === true) {
        const fillerPipe = createFillerPipe(link, config);
        newRows.push({ insertAfterRow: link.element._rowIndex, pipe: fillerPipe });
        applied.push({ ruleId: link.fixAction.ruleId, row: link.element._rowIndex, action: "INSERT" });
        log.push({ type: "Applied", ruleId: link.fixAction.ruleId, row: link.element._rowIndex,
          message: `APPLIED: Inserted ${link.fixAction.gapAmount.toFixed(1)}mm gap-fill pipe after Row ${link.element._rowIndex}.` });
      }
    }
  }

  let updatedTable = dataTable.filter(row => !deleteRows.has(row._rowIndex));

  for (const insertion of newRows.sort((a, b) => b.insertAfterRow - a.insertAfterRow)) {
    const idx = updatedTable.findIndex(r => r._rowIndex === insertion.insertAfterRow);
    if (idx >= 0) {
      updatedTable.splice(idx + 1, 0, insertion.pipe);
    } else {
      updatedTable.push(insertion.pipe);
    }
  }

  updatedTable.forEach((row, i) => { row._rowIndex = i + 1; });

  updatedTable.forEach(row => {
    if (row._fixApproved === true) {
      row.fixingAction = null;
      row.fixingActionTier = null;
      row.fixingActionRuleId = null;
    }
  });

  return { updatedTable, applied, deleteCount: deleteRows.size, insertCount: newRows.length };
}

function snapEndpoints(elemA, elemB) {
  const mid = vec.mid(getExitPoint(elemA), getEntryPoint(elemB));
  if (elemA.ep2) { elemA.ep2 = { ...mid }; }
  if (elemB.ep1) { elemB.ep1 = { ...mid }; }
}

function snapToSingleAxis(element, dominantAxis) {
  if (!element.ep1 || !element.ep2) return;
  const axes = ["x", "y", "z"];
  const domKey = dominantAxis.toLowerCase();
  for (const key of axes) {
    if (key !== domKey) {
      element.ep2[key] = element.ep1[key];
    }
  }
}

function trimPipe(pipe, amount, travelAxis, travelDir, which) {
  const axisKey = travelAxis.toLowerCase();
  if (which === "current") {
    pipe.ep2[axisKey] -= amount * travelDir;
  } else {
    pipe.ep1[axisKey] += amount * travelDir;
  }
}

function createFillerPipe(chainLink, config) {
  const upstream = chainLink.element;
  const downstream = chainLink.nextElement;
  const exitPt = getExitPoint(upstream);
  const entryPt = getEntryPoint(downstream);

  return {
    _rowIndex: -1,
    _modified: { ep1: "SmartFix:GapFill", ep2: "SmartFix:GapFill", type: "SmartFix:GapFill" },
    _passApplied: config.currentPass || 1,
    _logTags: ["Calculated"],
    csvSeqNo: `${upstream.csvSeqNo || 0}.GF`,
    type: "PIPE",
    text: "",
    refNo: `${upstream.refNo || "UNKNOWN"}_GapFill`,
    bore: upstream.bore || 0,
    ep1: { ...exitPt },
    ep2: { ...entryPt },
    cp: null, bp: null, branchBore: null,
    skey: "",
    supportCoor: null, supportName: "", supportGuid: "",
    ca: { ...upstream.ca, 8: null, 97: null, 98: null },
    fixingAction: "GAPFILLING",
    fixingActionTier: null,
    fixingActionRuleId: null,
    len1: null, axis1: null, len2: null, axis2: null, len3: null, axis3: null,
    brlen: null, deltaX: null, deltaY: null, deltaZ: null,
    diameter: upstream.bore, wallThick: upstream.ca?.[4] || null,
    bendPtr: null, rigidPtr: null, intPtr: null,
  };
}

function markModified(row, field, reason) {
  if (!row._modified) row._modified = {};
  row._modified[field] = reason;
}
