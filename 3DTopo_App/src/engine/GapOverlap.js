import { vec } from '../math/VectorMath.js';
import { getExitPoint, getEntryPoint } from './GraphBuilder.js';

export function analyzeGap(gapVector, context, current, next, config, log) {
  const currentPass = config.currentPass || 1;
  const isTargetPipe = (current.type === "PIPE" || next.type === "PIPE");
  const isTargetFitting = (current.type !== "PIPE" && next.type !== "PIPE");

  if (currentPass === 1 && !isTargetPipe) {
      return null;
  }

  if (currentPass === 2 && isTargetPipe) {
      return null; // Skip pipes on 2nd pass
  }

  if (currentPass === 1 && !isTargetPipe && !isTargetFitting) {
      // First pass targets PIPE manipulations (at least one end is pipe usually, or we only stretch pipes)
  }

  // Bore constraint (0.7 to 1.5)
  if (current.bore && next.bore) {
      const ratio = current.bore / next.bore;
      if (ratio < 0.7 || ratio > 1.5) {
          return { type: "ERROR", ruleId: "R-BORE-CONSCIOUS", tier: 4,
            description: `ERROR: Bore ratio ${ratio.toFixed(2)} is outside allowed 0.7-1.5 range. Disallowing automated fix.`,
            current, next };
      }
  }

  // Line_Key constraint
  if (config.pteMode?.lineKeyMode && current._lineKey && next._lineKey) {
      if (current._lineKey !== next._lineKey) {
          return { type: "ERROR", ruleId: "R-LINEKEY", tier: 4,
            description: `ERROR: Line_Key mismatch (${current._lineKey} vs ${next._lineKey}). Crossing line boundary.`,
            current, next };
      }
  }
  const cfg = config.smartFixer || {};
  const negligible = Number(cfg.negligibleGap ?? 1.0);
  const autoFillMax = Number(cfg.autoFillMaxGap ?? 25.0);
  const reviewMax = Number(cfg.reviewGapMax ?? 100.0);
  const silentSnap = Number(cfg.silentSnapThreshold ?? 2.0);

  const gapMag = vec.mag(gapVector);

  if (gapMag <= negligible) {
    if (gapMag >= 0.1) {
      return { type: "SNAP", ruleId: "R-GAP-01", tier: 1,
        description: `SNAP [R-GAP-01]: Close ${gapMag.toFixed(2)}mm micro-gap by snapping endpoints.`,
        gapVector, current, next };
    }
    return null; // Perfect connection
  }

  const axes = decomposeGap(gapVector, Number(cfg.offAxisThreshold ?? 0.5));
  const alongTravel = axes.find(a => a.axis === context.travelAxis);
  const lateral = axes.filter(a => a.axis !== context.travelAxis);
  const totalLateral = lateral.reduce((s, a) => s + Math.abs(a.delta), 0);
  const alongDelta = alongTravel ? alongTravel.delta : 0;
  const isOverlap = (alongDelta * context.travelDirection) < 0;

  if (isOverlap && axes.length === 1 && axes[0].axis === context.travelAxis) {
    const overlapAmt = Math.abs(alongDelta);
    return analyzeOverlap(overlapAmt, context, current, next, cfg, log);
  }

  // Single-axis gap along travel
  if (axes.length === 1 && axes[0].axis === context.travelAxis) {
    const gapAmt = Math.abs(alongDelta);
    const dir = directionLabel(context.travelAxis, context.travelDirection);

    if (gapAmt > 20000) {
      return { type: "ERROR", ruleId: "R-MAX-SEGMENT", tier: 4,
        description: `ERROR [R-MAX-SEGMENT]: ${gapAmt.toFixed(1)}mm gap exceeds 20000mm absolute maximum threshold. Auto Rejected.`,
        current, next };
    }

    if (gapAmt <= autoFillMax) {
      return { type: "INSERT", ruleId: "R-GAP-02", tier: 2,
        description: buildInsertDescription(gapAmt, dir, context, current),
        gapAmount: gapAmt, fillAxis: context.travelAxis, fillDir: context.travelDirection, current, next };
    }
    if (gapAmt <= reviewMax) {
      return { type: "REVIEW", ruleId: "R-GAP-03", tier: 3,
        description: `REVIEW [R-GAP-03]: ${gapAmt.toFixed(1)}mm gap along ${dir}. Exceeds ${autoFillMax}mm auto-fill threshold. Manual review.`,
        current, next };
    }
    return { type: "ERROR", ruleId: "R-GAP-03", tier: 4,
      description: `ERROR [R-GAP-03]: ${gapAmt.toFixed(1)}mm gap along ${dir}. Major gap — likely missing component(s).`,
      current, next };
  }

  // Single-axis gap on NON-travel axis (lateral)
  if (axes.length === 1 && axes[0].axis !== context.travelAxis) {
    const latAmt = Math.abs(axes[0].delta);
    if (latAmt < silentSnap) {
      return { type: "SNAP", ruleId: "R-GAP-04", tier: 2,
        description: `SNAP [R-GAP-04]: Lateral offset ${latAmt.toFixed(1)}mm on ${axes[0].axis}-axis (travel is ${context.travelAxis}). Snapping to align.`,
        current, next };
    }
    return { type: "ERROR", ruleId: "R-GAP-04", tier: 4,
      description: `ERROR [R-GAP-04]: Lateral offset ${latAmt.toFixed(1)}mm on ${axes[0].axis}-axis. Pipe has shifted sideways. Manual review.`,
      current, next };
  }

  // Multi-axis gap with negligible lateral
  if (axes.length >= 2 && totalLateral < silentSnap && Math.abs(alongDelta) <= autoFillMax) {
    const gapAmt = Math.abs(alongDelta);
    const dir = directionLabel(context.travelAxis, context.travelDirection);
    return { type: "INSERT", ruleId: "R-GAP-05", tier: 2,
      description: `INSERT [R-GAP-05]: Multi-axis gap (axial=${gapAmt.toFixed(1)}mm, lateral=${totalLateral.toFixed(1)}mm). Lateral snapped, axial filled with ${gapAmt.toFixed(1)}mm pipe ${dir}.`,
      gapAmount: gapAmt, fillAxis: context.travelAxis, fillDir: context.travelDirection, current, next };
  }

  return { type: "ERROR", ruleId: "R-GAP-06", tier: 4,
    description: `ERROR [R-GAP-06]: Multi-axis gap (${formatGapAxes(axes)}). Cannot auto-fill. Rigorous manual review required.`,
    current, next };
}

export function analyzeOverlap(overlapAmt, context, current, next, cfg, log) {
  const autoTrimMax = Number(cfg.autoTrimMaxOverlap ?? 25.0);
  const currType = (current.type || "").toUpperCase();
  const nextType = (next.type || "").toUpperCase();
  const dir = directionLabel(context.travelAxis, context.travelDirection);

  // Enveloping Overlap (R-OVR-04) check logic can be inferred implicitly if needed, but handled explicitly if overlap is fully enveloping
  // We handle R-OVR-04 outside this typically or here if overlapping perfectly
  if (overlapAmt > 500 && Math.abs(vec.dist(getEntryPoint(current), getEntryPoint(next))) < 5) {
      return { type: "ERROR", ruleId: "R-OVR-04", tier: 4,
          description: `ERROR [R-OVR-04]: Enveloping overlap detected. Element B starts before element A.`,
          current, next };
  }

  // R-OVR-05: Overlap at Tee Boundary
  if ((currType === "PIPE" && nextType === "TEE") || (currType === "TEE" && nextType === "PIPE")) {
    const tee = currType === "TEE" ? current : next;
    const pipe = currType === "PIPE" ? current : next;

    // Look up tee C dimension (center-to-end, run)
    const teeBore = tee.bore || 0;
    // mock DB lookup using a typical configuration or calculation if DB not present
    // Fallback logic, as the specific Addon assumes `config.brlenEqualTee` might exist
    const teeEntry = cfg.brlenEqualTee?.find(e => e.bore === teeBore);
    const halfC = teeEntry ? teeEntry.C / 2 : null;

    if (halfC && Math.abs(overlapAmt - halfC) < 3.0) {
      const trimTarget = currType === "PIPE" ? "current" : "next";

      return {
        type: "TRIM", ruleId: "R-OVR-05", tier: 2,
        description: `TRIM [R-OVR-05]: Pipe trimmed by ${halfC.toFixed(1)}mm (tee half-C dimension) to accommodate TEE at Row ${tee._rowIndex}.`,
        trimAmount: halfC,
        trimTarget,
        current, next,
      };
    }

    if (halfC) {
      return {
        type: "REVIEW", ruleId: "R-OVR-05", tier: 3,
        description: `REVIEW [R-OVR-05]: ${overlapAmt.toFixed(1)}mm pipe-tee overlap. Half-C=${halfC.toFixed(1)}mm.`,
        current, next,
      };
    }
  }

  // R-OVR-03: Rigid-on-rigid
  if (currType !== "PIPE" && nextType !== "PIPE") {
    return { type: "ERROR", ruleId: "R-OVR-03", tier: 4,
      description: `ERROR [R-OVR-03]: ${currType} overlaps ${nextType} by ${overlapAmt.toFixed(1)}mm. Both are rigid fittings. Cannot auto-trim.`,
      current, next };
  }

  // R-OVR-01: Current is PIPE — trim it
  if (currType === "PIPE" && overlapAmt <= autoTrimMax) {
    return { type: "TRIM", ruleId: "R-OVR-01", tier: 2,
      description: buildTrimDescription(overlapAmt, dir, current, next, "current"),
      trimAmount: overlapAmt, trimTarget: "current", current, next };
  }

  // R-OVR-02: Current is rigid, next is PIPE — trim next
  if (currType !== "PIPE" && nextType === "PIPE" && overlapAmt <= autoTrimMax) {
    return { type: "TRIM", ruleId: "R-OVR-02", tier: 2,
      description: buildTrimDescription(overlapAmt, dir, current, next, "next"),
      trimAmount: overlapAmt, trimTarget: "next", current, next };
  }

  // Large overlap
  return { type: "REVIEW", ruleId: "R-OVR-01", tier: 3,
    description: `REVIEW [R-OVR-01]: ${overlapAmt.toFixed(1)}mm overlap between ${currType} (Row ${current._rowIndex}) and ${nextType} (Row ${next._rowIndex}). Exceeds ${autoTrimMax}mm auto-trim threshold.`,
    current, next };
}

export function decomposeGap(gapVec, threshold) {
  const result = [];
  if (Math.abs(gapVec.x) > threshold) result.push({ axis: "X", delta: gapVec.x });
  if (Math.abs(gapVec.y) > threshold) result.push({ axis: "Y", delta: gapVec.y });
  if (Math.abs(gapVec.z) > threshold) result.push({ axis: "Z", delta: gapVec.z });
  return result;
}

export function directionLabel(axis, dir) {
  const map = { X: ["+X(East)", "-X(West)"], Y: ["+Y(North)", "-Y(South)"], Z: ["+Z(Up)", "-Z(Down)"] };
  return axis ? (dir > 0 ? map[axis][0] : map[axis][1]) : "unknown";
}

function formatGapAxes(axes) {
  return axes.map(a => `${a.axis}=${a.delta.toFixed(1)}mm`).join(", ");
}

function buildInsertDescription(gapAmt, direction, context, upstream) {
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

function buildTrimDescription(overlapAmt, direction, current, next, target) {
  const trimRow = target === "current" ? current : next;
  const otherRow = target === "current" ? next : current;
  return `TRIM [${target === "current" ? "R-OVR-01" : "R-OVR-02"}]: ` +
         `Reduce ${trimRow.type} by ${overlapAmt.toFixed(1)}mm along ${direction}\n` +
         `  Row ${trimRow._rowIndex}: ${target === "current" ? "EP2" : "EP1"} adjusted\n` +
         `  Overlap with ${otherRow.type} (Row ${otherRow._rowIndex}) resolved`;
}
