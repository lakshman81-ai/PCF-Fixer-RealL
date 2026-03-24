import { vec } from '../math/VectorMath.js';

export function detectElementAxis(element, config) {
  const threshold = Number(config?.smartFixer?.offAxisThreshold ?? 0.5);
  const type = (element.type || "").toUpperCase();

  if (type === "SUPPORT" || type === "OLET") return [null, null];

  const ep1 = element.ep1;
  const ep2 = element.ep2;
  if (!ep1 || !ep2) return [null, null];

  const dx = Number(ep2.x) - Number(ep1.x);
  const dy = Number(ep2.y) - Number(ep1.y);
  const dz = Number(ep2.z) - Number(ep1.z);

  const axes = [];
  if (Math.abs(dx) > threshold) axes.push(["X", dx]);
  if (Math.abs(dy) > threshold) axes.push(["Y", dy]);
  if (Math.abs(dz) > threshold) axes.push(["Z", dz]);

  if (axes.length === 0) return [null, null];

  if (axes.length === 1) {
    return [axes[0][0], axes[0][1] > 0 ? 1 : -1];
  }

  // Multi-axis: for BEND this is expected (return outgoing axis)
  if (type === "BEND") {
    // Outgoing axis = the axis with the EP2-dominant delta
    // that differs from the incoming axis
    const sorted = [...axes].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    return [sorted[0][0], sorted[0][1] > 0 ? 1 : -1];
  }

  // For straight elements (PIPE, FLANGE, VALVE, REDUCER): pick dominant axis
  const dominant = axes.reduce((a, b) => Math.abs(a[1]) > Math.abs(b[1]) ? a : b);
  return [dominant[0], dominant[1] > 0 ? 1 : -1];
}

export function detectBranchAxis(teeElement) {
  if (!teeElement.bp || !teeElement.cp) return null;
  const bv = vec.sub(teeElement.bp, teeElement.cp);
  const axes = [["X", Math.abs(Number(bv.x))], ["Y", Math.abs(Number(bv.y))], ["Z", Math.abs(Number(bv.z))]];
  const dominant = axes.reduce((a, b) => a[1] > b[1] ? a : b);
  return dominant[0];
}

export function detectBranchDirection(teeElement) {
  if (!teeElement.bp || !teeElement.cp) return null;
  const bv = vec.sub(teeElement.bp, teeElement.cp);
  const axis = detectBranchAxis(teeElement);
  if (!axis) return null;
  return Number(bv[axis.toLowerCase()]) > 0 ? 1 : -1;
}

export function getElementVector(element) {
  const type = (element.type || "").toUpperCase();
  if (type === "SUPPORT" || type === "OLET") return { x: 0, y: 0, z: 0 };
  if (!element.ep1 || !element.ep2) return { x: 0, y: 0, z: 0 };
  return vec.sub(element.ep2, element.ep1);
}
