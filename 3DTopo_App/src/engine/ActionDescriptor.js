import { vec } from '../math/VectorMath.js';
import { getExitPoint } from './GraphBuilder.js';

export function populateFixingActions(dataTable, chains, log) {
  for (const row of dataTable) {
    row.fixingAction = null;
    row.fixingActionTier = null;
    row.fixingActionRuleId = null;
  }

  for (const chain of chains) {
    for (const link of chain) {
      const elem = link.element;

      if (elem._proposedFix) {
        const row = dataTable.find(r => r._rowIndex === elem._rowIndex);
        if (row) {
          row.fixingAction = formatProposedFix(elem._proposedFix, elem);
          row.fixingActionTier = elem._proposedFix.tier;
          row.fixingActionRuleId = elem._proposedFix.ruleId;
        }
      }

      if (link.fixAction) {
        const currRow = dataTable.find(r => r._rowIndex === link.element._rowIndex);
        const nextRow = link.nextElement ? dataTable.find(r => r._rowIndex === link.nextElement._rowIndex) : null;

        if (currRow && !currRow.fixingAction) {
          currRow.fixingAction = link.fixAction.description;
          currRow.fixingActionTier = link.fixAction.tier;
          currRow.fixingActionRuleId = link.fixAction.ruleId;
        }
        if (nextRow && !nextRow.fixingAction && link.fixAction.tier <= 3) {
          nextRow.fixingAction = `Passive Element: Automatically corrected by modifying Row ${currRow._rowIndex}.`;
          nextRow.fixingActionTier = link.fixAction.tier;
          nextRow.fixingActionRuleId = link.fixAction.ruleId;
          // Marking this helps the UI hide "Approve/Reject" if needed,
          // or at least informs the user they don't have to approve this twice.
          nextRow._isPassiveFix = true;
        }
      }

      if (link.branchChain) {
        populateFixingActionsFromChain(dataTable, link.branchChain); // Recurse
      }
    }
  }

  for (const entry of log) {
    if (entry.row && entry.tier && entry.tier <= 4) {
      const row = dataTable.find(r => r._rowIndex === entry.row);
      if (row && !row.fixingAction) {
        row.fixingAction = entry.message;
        row.fixingActionTier = entry.tier;
        row.fixingActionRuleId = entry.ruleId;
        if (entry.score !== undefined) row.fixingActionScore = entry.score;
      }
    }
  }
}

function populateFixingActionsFromChain(dataTable, chain) {
  // Simple wrapper to recurse into branches if needed
  populateFixingActions(dataTable, [chain], []);
}

export function formatProposedFix(fix, element) {
  const type = (element.type || "").toUpperCase();
  const ri = element._rowIndex;

  switch (fix.type) {
    case "DELETE":
      const len = element.ep1 && element.ep2 ? vec.mag(vec.sub(element.ep2, element.ep1)) : 0;
      return `DELETE [${fix.ruleId}]: Remove ${type} at Row ${ri}\n` +
             `  Length: ${len.toFixed(1)}mm, Bore: ${element.bore || 0}mm\n` +
             `  Reason: ${fix.ruleId === "R-GEO-01" ? "Micro-element below threshold" : "Fold-back element"}`;

    case "SNAP_AXIS":
      return `SNAP [${fix.ruleId}]: Align ${type} to pure ${fix.dominantAxis}-axis\n` +
             `  Row ${ri}: Off-axis components will be zeroed\n` +
             `  EP2 non-${fix.dominantAxis} coords → match EP1`;

    default:
      return `${fix.type} [${fix.ruleId}]: Row ${ri}`;
  }
}

export function buildInsertDescription(gapAmt, direction, context, upstream) {
  const exitPt = getExitPoint(upstream);
  const bore = upstream.bore || 0;
  const axisKey = context.travelAxis.toLowerCase();
  const endPt = { ...exitPt };
  endPt[axisKey] += gapAmt * context.travelDirection;

  return `INSERT [R-GAP-02]: Fill ${gapAmt.toFixed(1)}mm gap along ${direction}\n` +
         `  New PIPE: EP1=(${exitPt.x.toFixed(1)}, ${exitPt.y.toFixed(1)}, ${exitPt.z.toFixed(1)})\n` +
         `          → EP2=(${endPt.x.toFixed(1)}, ${endPt.y.toFixed(1)}, ${endPt.z.toFixed(1)})\n` +
         `  Length: ${gapAmt.toFixed(1)}mm, Bore: ${bore.toFixed(1)}mm\n` +
         `  Inherited from Row ${upstream._rowIndex}`;
}

export function buildTrimDescription(overlapAmt, direction, current, next, target) {
  const trimRow = target === "current" ? current : next;
  const otherRow = target === "current" ? next : current;
  return `TRIM [${target === "current" ? "R-OVR-01" : "R-OVR-02"}]: ` +
         `Reduce ${trimRow.type} by ${overlapAmt.toFixed(1)}mm along ${direction}\n` +
         `  Row ${trimRow._rowIndex}: ${target === "current" ? "EP2" : "EP1"} adjusted\n` +
         `  Overlap with ${otherRow.type} (Row ${otherRow._rowIndex}) resolved`;
}
