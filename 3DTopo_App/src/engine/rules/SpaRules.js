import { vec } from '../../math/VectorMath.js';
import { getEntryPoint, getExitPoint } from '../GraphBuilder.js';

export function runSpaRules(dataTable, chains, config, log) {
  // R-SPA-01 and R-SPA-02 execution
  applyRSPA02(dataTable, chains, config, log);

  for (const chain of chains) {
      checkRSPA01(chain, config, log);
  }
}

function applyRSPA02(dataTable, chains, config, log) {
  // Post-walk pass: for each chain, snap non-travel coordinates to chain median
  const silentSnap = config.smartFixer?.silentSnapThreshold ?? 2.0;
  const warnSnap = config.smartFixer?.warnSnapThreshold ?? 10.0;
  let snapCount = 0;

  for (const chain of chains) {
    if (chain.length < 2) continue;

    // Group consecutive elements by travel axis
    let runStart = 0;
    while (runStart < chain.length) {
      const runAxis = chain[runStart].travelAxis;
      if (!runAxis) { runStart++; continue; }

      // Find the extent of this straight run (same travel axis)
      let runEnd = runStart;
      while (runEnd < chain.length - 1 && chain[runEnd + 1].travelAxis === runAxis) {
        runEnd++;
      }

      if (runEnd > runStart) {
        // We have a run of elements on the same axis
        const nonTravelAxes = ["x", "y", "z"].filter(a => a !== runAxis.toLowerCase());

        for (const axis of nonTravelAxes) {
          // Collect all values on this non-travel axis
          const values = [];
          for (let j = runStart; j <= runEnd; j++) {
            const elem = chain[j].element;
            if (elem.ep1) values.push(elem.ep1[axis]);
            if (elem.ep2) values.push(elem.ep2[axis]);
          }

          if (values.length < 2) continue;

          // Calculate median
          const sorted = [...values].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];

          // Snap outliers to median
          for (let j = runStart; j <= runEnd; j++) {
            const elem = chain[j].element;
            for (const pt of ["ep1", "ep2"]) {
              if (!elem[pt]) continue;
              const drift = Math.abs(elem[pt][axis] - median);

              if (drift > 0.1 && drift < silentSnap) {
                elem[pt][axis] = median;
                if (!elem._proposedFix) elem._proposedFix = { type: "SNAP", ruleId: "R-SPA-02", tier: 1 };
                snapCount++;
              } else if (drift >= silentSnap && drift < warnSnap) {
                elem[pt][axis] = median;
                if (!elem._proposedFix) elem._proposedFix = { type: "SNAP", ruleId: "R-SPA-02", tier: 2 };
                snapCount++;
                log.push({ type: "Fix", ruleId: "R-SPA-02", tier: 2, row: elem._rowIndex,
                  message: `SNAP [R-SPA-02 T2]: ${axis.toUpperCase()} drifted ${drift.toFixed(1)}mm from run median ${median.toFixed(1)}. Snapped.` });
              } else if (drift >= warnSnap) {
                log.push({ type: "Error", ruleId: "R-SPA-02", tier: 4, row: elem._rowIndex,
                  message: `ERROR [R-SPA-02 T4]: ${axis.toUpperCase()} offset ${drift.toFixed(1)}mm from run median. Too large.` });
              }
            }
          }
        }
      }

      runStart = runEnd + 1;
    }
  }

  log.push({ type: "Info", message: `R-SPA-02: Snapped ${snapCount} coordinates across all chains.` });
}


function checkRSPA01(chain, config, log) {
  const silentSnap = config.smartFixer?.silentSnapThreshold ?? 2.0;
  const warnSnap = config.smartFixer?.warnSnapThreshold ?? 10.0;

  // Only applies to horizontal runs (travel axis X or Y)
  // Track Z values across the run
  let runZValues = [];
  let runStartIdx = 0;

  for (let i = 0; i < chain.length; i++) {
    const link = chain[i];
    const axis = link.travelAxis;

    if (axis === "X" || axis === "Y") {
      // Horizontal run — track Z
      if (link.element.ep1) runZValues.push({ idx: i, z: link.element.ep1.z, pt: "ep1" });
      if (link.element.ep2) runZValues.push({ idx: i, z: link.element.ep2.z, pt: "ep2" });
    } else {
      // Non-horizontal (vertical or unknown) — process accumulated run
      if (runZValues.length >= 4) {
        snapElevation(runZValues, chain, silentSnap, warnSnap, log);
      }
      runZValues = [];
    }
  }

  // Process final run
  if (runZValues.length >= 4) {
    snapElevation(runZValues, chain, silentSnap, warnSnap, log);
  }
}

function snapElevation(zValues, chain, silentSnap, warnSnap, log) {
  const sorted = [...zValues].map(v => v.z).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  for (const entry of zValues) {
    const drift = Math.abs(entry.z - median);
    const elem = chain[entry.idx].element;

    if (drift > 0.1 && drift < silentSnap) {
      elem[entry.pt].z = median;
    } else if (drift >= silentSnap && drift < warnSnap) {
      elem[entry.pt].z = median;
      log.push({ type: "Fix", ruleId: "R-SPA-01", tier: 2, row: elem._rowIndex,
        message: `SNAP [R-SPA-01 T2]: Elevation Z drifted ${drift.toFixed(1)}mm from horizontal run median ${median.toFixed(1)}. Snapped.` });
    } else if (drift >= warnSnap) {
      log.push({ type: "Warning", ruleId: "R-SPA-01", tier: 3, row: elem._rowIndex,
        message: `WARNING [R-SPA-01 T3]: Elevation Z changes ${drift.toFixed(1)}mm in horizontal run. Intentional slope or error?` });
    }
  }
}
