import { vec } from '../../math/VectorMath.js';
import { getElementVector } from '../AxisDetector.js';
import { getExitPoint, getEntryPoint } from '../GraphBuilder.js';

export function runChnRules(element, context, prevElement, elemAxis, elemDir, config, log) {
  const type = (element.type || "").toUpperCase();
  const cfg = config.smartFixer || {};
  const ri = element._rowIndex;

  // R-CHN-01: Axis change without bend
  if (context.travelAxis && elemAxis && elemAxis !== context.travelAxis) {
    if (!["BEND", "TEE", "OLET", "REDUCER-ECCENTRIC"].includes(type)) {
      log.push({ type: "Error", ruleId: "R-CHN-01", tier: 4, row: ri,
        message: `ERROR [R-CHN-01]: Axis changed ${context.travelAxis}→${elemAxis} at ${type}. Missing BEND?` });
    }
  }

  // R-CHN-02: Fold-back
  if (context.travelAxis && elemAxis === context.travelAxis && elemDir !== context.travelDirection) {
    if (type === "PIPE") {
      const foldLen = vec.mag(getElementVector(element));
      const foldMax = Number(cfg.autoDeleteFoldbackMax ?? 25.0);
      if (foldLen < foldMax) {
        log.push({ type: "Fix", ruleId: "R-CHN-02", tier: 2, row: ri,
          message: `DELETE [R-CHN-02]: Fold-back pipe ${foldLen.toFixed(1)}mm on ${elemAxis}-axis.` });
        element._proposedFix = { type: "DELETE", ruleId: "R-CHN-02", tier: 2 };
      } else {
        log.push({ type: "Error", ruleId: "R-CHN-02", tier: 4, row: ri,
          message: `ERROR [R-CHN-02]: Fold-back ${foldLen.toFixed(1)}mm on ${elemAxis}-axis. Too large to auto-delete.` });
      }
    } else if (type !== "BEND") {
      log.push({ type: "Error", ruleId: "R-CHN-02", tier: 4, row: ri,
        message: `ERROR [R-CHN-02]: ${type} reverses direction on ${elemAxis}-axis.` });
    }
  }

  // R-CHN-03: Elbow-elbow proximity
  if (type === "BEND" && context.lastFittingType === "BEND") {
    const minTangent = Number(cfg.minTangentMultiplier ?? 1.0) * Number(element.bore || 0) * 0.0254; // Rough approximation
    if (context.pipeSinceLastBend < minTangent) {
      log.push({ type: "Warning", ruleId: "R-CHN-03", tier: 3, row: ri,
        message: `WARNING [R-CHN-03]: Only ${context.pipeSinceLastBend.toFixed(0)}mm pipe between bends. Short tangent.` });
    }
  }

  // R-CHN-06: Shared-axis coordinate snapping
  if (prevElement && context.travelAxis) {
    const exitPt = getExitPoint(prevElement);
    const entryPt = getEntryPoint(element);
    if (exitPt && entryPt) {
      const silentSnap = Number(cfg.silentSnapThreshold ?? 2.0);
      const warnSnap = Number(cfg.warnSnapThreshold ?? 10.0);

      const nonTravelAxes = ["x", "y", "z"].filter(a => a !== context.travelAxis.toLowerCase());

      for (const axis of nonTravelAxes) {
        const drift = Math.abs(entryPt[axis] - exitPt[axis]);

        if (drift > 0.1 && drift < silentSnap) {
          // TIER 1: Silent snap — auto-fix, minimal log
          element.ep1[axis] = exitPt[axis];
          log.push({ type: "Fix", ruleId: "R-CHN-06", tier: 1, row: ri,
            message: `SNAP [R-CHN-06 T1]: ${axis.toUpperCase()} drifted ${drift.toFixed(1)}mm. Silently snapped to ${exitPt[axis].toFixed(1)}.` });
        }
        else if (drift >= silentSnap && drift < warnSnap) {
          // TIER 2: Snap with warning — auto-fix but visible
          element.ep1[axis] = exitPt[axis];
          log.push({ type: "Fix", ruleId: "R-CHN-06", tier: 2, row: ri,
            message: `SNAP [R-CHN-06 T2]: ${axis.toUpperCase()} drifted ${drift.toFixed(1)}mm. Snapped to ${exitPt[axis].toFixed(1)}. Verify not intentional offset.` });
        }
        else if (drift >= warnSnap) {
          // TIER 4: Error — too large, do NOT snap
          log.push({ type: "Error", ruleId: "R-CHN-06", tier: 4, row: ri,
            message: `ERROR [R-CHN-06 T4]: ${axis.toUpperCase()} offset ${drift.toFixed(1)}mm from previous element. Too large for auto-snap. Manual review.` });
        }
      }
    }
  }
}
