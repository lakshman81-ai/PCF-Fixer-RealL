import { vec } from '../../math/VectorMath.js';
import { getElementVector } from '../AxisDetector.js';

export function runGeoRules(element, context, prevElement, elemAxis, elemDir, config, log) {
  const type = (element.type || "").toUpperCase();
  const cfg = config.smartFixer || {};
  const ri = element._rowIndex;

  // R-GEO-01: Micro-element
  if (type === "PIPE") {
    const len = vec.mag(getElementVector(element));
    const threshold = Number(cfg.microPipeThreshold ?? 6.0);
    if (len < threshold && len > 0) {
      log.push({ type: "Fix", ruleId: "R-GEO-01", tier: 1, row: ri,
        message: `DELETE [R-GEO-01]: Micro-pipe ${len.toFixed(1)}mm < ${threshold}mm threshold.` });
      element._proposedFix = { type: "DELETE", ruleId: "R-GEO-01", tier: 1 };
    }
  }

  // R-GEO-02: Bore continuity
  if (prevElement && element.bore !== context.currentBore) {
    const prevType = (prevElement.type || "").toUpperCase();
    if (!prevType.includes("REDUCER")) {
      log.push({ type: "Error", ruleId: "R-GEO-02", tier: 4, row: ri,
        message: `ERROR [R-GEO-02]: Bore changes ${context.currentBore}→${element.bore} without reducer.` });
    }
  }

  // R-GEO-03: Single-axis rule for straight elements
  if (["PIPE", "FLANGE", "VALVE"].includes(type) && type !== "BEND") {
    const ev = getElementVector(element);
    const nonZero = [["X", ev.x], ["Y", ev.y], ["Z", ev.z]].filter(([_, d]) => Math.abs(d) > 0.5);
    if (nonZero.length > 1) {
      const dominant = nonZero.reduce((a, b) => Math.abs(a[1]) > Math.abs(b[1]) ? a : b);
      const minorTotal = nonZero.filter(a => a[0] !== dominant[0]).reduce((s, a) => s + Math.abs(a[1]), 0);
      const threshold = Number(cfg.diagonalMinorThreshold ?? 2.0);
      if (minorTotal < threshold) {
        log.push({ type: "Fix", ruleId: "R-GEO-03", tier: 2, row: ri,
          message: `SNAP [R-GEO-03]: ${type} off-axis drift ${minorTotal.toFixed(1)}mm. Snapping to pure ${dominant[0]}-axis.` });
        element._proposedFix = { type: "SNAP_AXIS", ruleId: "R-GEO-03", tier: 2, dominantAxis: dominant[0] };
      } else {
        log.push({ type: "Error", ruleId: "R-GEO-03", tier: 4, row: ri,
          message: `ERROR [R-GEO-03]: ${type} runs diagonally (${nonZero.map(([a,d]) => `${a}=${d.toFixed(1)}`).join(", ")}). Must align to single axis.` });
      }
    }
  }

  // R-GEO-07: Zero-length element
  if (!["SUPPORT", "OLET"].includes(type) && element.ep1 && element.ep2) {
    if (vec.approxEqual(element.ep1, element.ep2, 0.1)) {
      log.push({ type: "Error", ruleId: "R-GEO-07", tier: 4, row: ri,
        message: `ERROR [R-GEO-07]: ${type} has zero length (EP1 ≈ EP2).` });
    }
  }

  // R-GEO-08: Coordinate Magnitude and Zero Check (Magnitude > 500,000mm)
  const fields = [
    { name: "ep1", val: element.ep1 },
    { name: "ep2", val: element.ep2 },
    { name: "cp", val: element.cp },
    { name: "bp", val: element.bp },
    { name: "supportCoor", val: element.supportCoor },
  ];

  for (const { name, val } of fields) {
    if (!val) continue;

    for (const axis of ["x", "y", "z"]) {
      if (Math.abs(val[axis]) > 500000) {
        log.push({ type: "Warning", ruleId: "R-GEO-08", tier: 3, row: ri,
          message: `WARNING [R-GEO-08]: ${name}.${axis}=${val[axis].toFixed(0)}mm (${(val[axis]/1000).toFixed(1)}m) — unusually large.` });
      }
    }
  }
}
