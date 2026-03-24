// @ts-check
/** @typedef {import('./types.js').PcfComponent} PcfComponent */
/** @typedef {import('./types.js').WalkContext} WalkContext */
/** @typedef {import('./types.js').Config} Config */
/** @typedef {import('./types.js').Logger} Logger */

import { vec } from '../math/VectorMath.js';
import { detectElementAxis, detectBranchAxis, detectBranchDirection, getElementVector } from './AxisDetector.js';
import { getEntryPoint, getExitPoint } from './GraphBuilder.js';
import { analyzeGap } from './GapOverlap.js';
import { sweepForNeighbor } from './pte-engine.js';
import { runElementRules, runSupportRules, runAggRules } from './rules/RuleRunner.js';
import { detectDuplicates, detectOrphans } from './rules/AggRules.js';
import { runSpaRules } from './rules/SpaRules.js';

/**
 * @param {{ components: PcfComponent[], terminals: PcfComponent[], edges: Map<number,PcfComponent>, branchEdges: Map<number,PcfComponent> }} graph
 * @param {Config} config
 * @param {Logger} log
 * @returns {Array<Array<object>>}
 */
export function walkAllChains(graph, config, log) {
  const visited = new Set();
  const allChains = [];

  // Pre-walk duplicate check
  detectDuplicates(graph.components, config, log);

  for (const terminal of graph.terminals) {
    if (visited.has(terminal._rowIndex)) continue;

    const context = createInitialContext(terminal, allChains.length);
    context.allRows = graph.components; // for A* obstacle detection in analyzeGap
    const chain = walkChain(terminal, graph, context, visited, config, log);
    allChains.push(chain);
  }

  const orphans = graph.components.filter(c => {
    if (c.type === "SUPPORT") return false;
    if (!visited.has(c._rowIndex)) return true;

    const isTerminal = graph.terminals.includes(c);
    const hasNext = graph.edges.has(c._rowIndex) || graph.branchEdges.has(c._rowIndex);

    if (isTerminal && !hasNext) {
        return true;
    }
    return false;
  });
  // First Pass (Stage 2 - Constrained Orphan Sweep)
  if (config.currentPass === 1 && orphans.length > 0) {
      log.push({ type: "Info", message: "Starting Stage 2: Constrained Orphan Sweep for non-sequential matches..." });
      for (let i = orphans.length - 1; i >= 0; i--) {
          const orphan = orphans[i];
          // Pass the KD tree to the sweep engine instead of array
          const neighbor = sweepForNeighbor(orphan, graph.entryTree, config);
          if (neighbor) {
              log.push({ type: "Info", message: `Orphan ${orphan.type} (Row ${orphan._rowIndex}) matched to ${neighbor.type} (Row ${neighbor._rowIndex}) via axis_sweep.` });
              // Simulate chaining
              orphans.splice(i, 1);
          }
      }
  }

  const finalOrphans = detectOrphans(graph.components, visited, log);

  // Post-walk spatial coordinate cleanup
  runSpaRules(graph.components, allChains, config, log);

  return { chains: allChains, orphans: finalOrphans };
}

function createInitialContext(startElement, chainIndex) {
  return {
    travelAxis: null,
    travelDirection: null,
    currentBore: startElement.bore || 0,
    currentMaterial: startElement.ca?.[3] || "",
    currentPressure: startElement.ca?.[1] || "",
    currentTemp: startElement.ca?.[2] || "",
    chainId: `Chain-${chainIndex + 1}`,
    cumulativeVector: { x: 0, y: 0, z: 0 },
    pipeLengthSum: 0,
    lastFittingType: null,
    elevation: startElement.ep1?.z || 0,
    depth: 0,
    pipeSinceLastBend: Infinity,
  };
}

export function walkChain(startElement, graph, context, visited, config, log) {
  const chain = [];
  let current = startElement;
  let prevElement = null;

  while (current && !visited.has(current._rowIndex)) {
    visited.add(current._rowIndex);
    const type = (current.type || "").toUpperCase();

    if (type === "SUPPORT") {
      runSupportRules(current, chain, context, config, log);
      current = graph.edges.get(current._rowIndex) || null;
      continue;
    }

    const [elemAxis, elemDir] = detectElementAxis(current, config);
    runElementRules(current, context, prevElement, elemAxis, elemDir, config, log);

    if (elemAxis) {
      context.travelAxis = elemAxis;
      context.travelDirection = elemDir;
    }
    if (current.bore) context.currentBore = current.bore;
    if (current.ca?.[3]) context.currentMaterial = current.ca[3];

    const elemVec = getElementVector(current);
    context.cumulativeVector = vec.add(context.cumulativeVector, elemVec);

    if (type === "PIPE") {
      const len = vec.mag(elemVec);
      context.pipeLengthSum += len;
      context.pipeSinceLastBend += len;
    }
    if (type === "BEND") context.pipeSinceLastBend = 0;
    if (!["PIPE", "SUPPORT"].includes(type)) context.lastFittingType = type;

    const nextElement = graph.edges.get(current._rowIndex) || null;
    let gapVector = null;
    let fixAction = null;

    if (nextElement) {
      const exitPt = getExitPoint(current);
      const entryPt = getEntryPoint(nextElement);
      if (exitPt && entryPt) {
        gapVector = vec.sub(entryPt, exitPt);
        fixAction = analyzeGap(gapVector, context, current, nextElement, config, log);
      }
    }

    chain.push({
      element: current,
      elemAxis, elemDir,
      travelAxis: context.travelAxis,
      travelDirection: context.travelDirection,
      gapToNext: gapVector,
      fixAction,
      nextElement,
      branchChain: null,
    });

    if (type === "TEE") {
      const branchStart = graph.branchEdges.get(current._rowIndex);
      if (branchStart && !visited.has(branchStart._rowIndex)) {
        const branchCtx = {
          ...structuredClone(context),
          travelAxis: detectBranchAxis(current),
          travelDirection: detectBranchDirection(current),
          currentBore: current.branchBore || current.bore,
          depth: context.depth + 1,
          chainId: `${context.chainId}.B`,
          pipeLengthSum: 0,
          cumulativeVector: { x: 0, y: 0, z: 0 },
          pipeSinceLastBend: Infinity,
        };
        const branchChain = walkChain(branchStart, graph, branchCtx, visited, config, log);
        chain[chain.length - 1].branchChain = branchChain;
      }
    }

    prevElement = current;
    current = nextElement;
  }

  runAggRules(chain, context, config, log);

  return chain;
}
