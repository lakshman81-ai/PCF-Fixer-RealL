import { buildConnectivityGraph } from './GraphBuilder.js';
import { walkAllChains } from './Walker.js';
import { populateFixingActions } from './ActionDescriptor.js';

export function runSmartFix(dataTable, config, logger) {
  const currentPass = config.currentPass || 1;
  logger.push({ stage: "FIXING", type: "Info", message: `═══ SMART FIX: PASS ${currentPass} ═══` });

  logger.push({ stage: "FIXING", type: "Info", message: "═══ SMART FIX: Starting chain walker ═══" });

  logger.push({ stage: "FIXING", type: "Info", message: "Step 4A: Building connectivity graph..." });
  const graph = buildConnectivityGraph(dataTable, config);
  // Auto-Approval Tiers:
  // < 25mm = Auto Approved (Tier 2/1)
  // > 20000mm = Auto Rejected (Tier 4)
  logger.push({ stage: "FIXING", type: "Info",
    message: `Graph: ${graph.components.length} components, ${graph.terminals.length} terminals, ${graph.edges.size} connections.` });

  logger.push({ stage: "FIXING", type: "Info", message: "Step 4B: Walking element chains..." });

  // We need to pass logger so that internal rules can also push with stage: "FIXING" if needed.
  // Actually, we'll patch log.push in rules to ensure stage.
  const oldPush = logger.push;
  logger.push = (entry) => {
      oldPush({ stage: "FIXING", pass: currentPass, ...entry });
  };

  const { chains, orphans } = walkAllChains(graph, config, logger.getLog());

  // Restore logger.push
  logger.push = oldPush;

  const totalElements = chains.reduce((s, c) => s + c.length, 0);
  logger.push({ stage: "FIXING", type: "Info",
    message: `Walked ${chains.length} chains, ${totalElements} elements, ${orphans.length} orphans.` });

  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const entry of logger.getLog()) {
    if (entry.tier) tierCounts[entry.tier]++;
  }
  logger.push({ stage: "FIXING", type: "Info",
    message: `Rules complete: Tier1=${tierCounts[1]}, Tier2=${tierCounts[2]}, Tier3=${tierCounts[3]}, Tier4=${tierCounts[4]}` });

  logger.push({ stage: "FIXING", type: "Info", message: "Step 4D: Populating Fixing Action previews..." });
  populateFixingActions(dataTable, chains, logger.getLog());

  const actionCount = dataTable.filter(r => r.fixingAction).length;
  logger.push({ stage: "FIXING", type: "Info",
    message: `═══ SMART FIX COMPLETE: ${actionCount} rows have proposed fixes. Review in Data Table. ═══` });

  const summary = {
    chainCount: chains.length,
    elementsWalked: totalElements,
    orphanCount: orphans.length,
    tier1: tierCounts[1],
    tier2: tierCounts[2],
    tier3: tierCounts[3],
    tier4: tierCounts[4],
    rowsWithActions: actionCount,
  };

  return { graph, chains, orphans, summary };
}
