export function runDatRules(element, context, prevElement, elemAxis, elemDir, config, log) {
  const type = (element.type || "").toUpperCase();
  const ri = element._rowIndex;

  // R-DAT-03: Material continuity
  const elemMat = element.ca?.[3] || "";
  if (context.currentMaterial && elemMat && elemMat !== context.currentMaterial) {
    const prevType = prevElement ? (prevElement.type || "").toUpperCase() : "";
    if (!["FLANGE", "VALVE"].includes(prevType)) {
      log.push({ type: "Warning", ruleId: "R-DAT-03", tier: 3, row: ri,
        message: `WARNING [R-DAT-03]: Material changes ${context.currentMaterial}→${elemMat} without joint.` });
    }
  }

  // R-DAT-06: SKEY prefix consistency
  if (element.skey) {
    const prefixMap = { FLANGE: "FL", VALVE: "V", BEND: "BE", TEE: "TE", OLET: "OL" };
    const expected = prefixMap[type];
    if (expected && !element.skey.startsWith(expected)) {
      log.push({ type: "Warning", ruleId: "R-DAT-06", tier: 3, row: ri,
        message: `WARNING [R-DAT-06]: SKEY '${element.skey}' prefix mismatch for ${type} (expected '${expected}...').` });
    }
  }
}
