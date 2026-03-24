import { vec } from '../../math/VectorMath.js';
import { detectElementAxis } from '../AxisDetector.js';

export function runSupportRules(support, chain, context, config, log) {
  const ri = support._rowIndex;
  const coor = support.supportCoor;
  if (!coor) return;

  // R-TOP-06: Support on-pipe validation
  let minDist = Infinity;
  for (const link of chain) {
    if ((link.element.type || "").toUpperCase() !== "PIPE") continue;
    const ep1 = link.element.ep1;
    const ep2 = link.element.ep2;
    if (!ep1 || !ep2) continue;

    const pipeVec = vec.sub(ep2, ep1);
    const pipeLen = vec.mag(pipeVec);
    if (pipeLen < 0.1) continue;

    const toSupport = vec.sub(coor, ep1);
    const t = vec.dot(toSupport, pipeVec) / (pipeLen * pipeLen);
    const projection = vec.add(ep1, vec.scale(pipeVec, Math.max(0, Math.min(1, t))));
    const perpDist = vec.dist(coor, projection);

    if (perpDist < minDist) minDist = perpDist;
  }

  if (minDist > 5.0 && minDist < Infinity) {
    log.push({ type: "Error", ruleId: "R-TOP-06", tier: 4, row: ri,
      message: `ERROR [R-TOP-06]: Support is ${minDist.toFixed(1)}mm off the nearest pipe axis.` });
  }

  // R-SPA-03: Support on vertical run
  if (context.travelAxis === "Z") {
    log.push({ type: "Warning", ruleId: "R-SPA-03", tier: 3, row: ri,
      message: `WARNING [R-SPA-03]: Support on vertical pipe run. Verify support type.` });
  }
}
