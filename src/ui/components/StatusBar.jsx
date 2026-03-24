import React from 'react';
import { useAppContext } from '../../store/AppContext';
import { runSmartFix } from '../../engine/Orchestrator';
import { applyFixes } from '../../engine/FixApplicator';
import { createLogger } from '../../utils/Logger';
import { runValidationChecklist } from '../../engine/Validator';
import { runDataProcessor } from '../../engine/DataProcessor';

import { PcfTopologyGraph2, applyApprovedMutations } from '../../engine/PcfTopologyGraph2';
import { useStore } from '../../store/useStore';
import { useTopologyWorker } from '../../workers/useTopologyWorker';

// Whether to offload Group 2 topology work to a Web Worker.
// Disable if your browser/environment doesn't support module workers.
const USE_WORKER = typeof Worker !== 'undefined';

export function StatusBar({ activeTab, activeStage }) {
  const [showModal, setShowModal] = React.useState(false);
  const [runGroup, setRunGroup] = React.useState('group1');
  const [isStatusExpanded, setIsStatusExpanded] = React.useState(false);
  const { state, dispatch } = useAppContext();
  const setZustandData = useStore(state => state.setDataTable);
  const setZustandProposals = useStore(state => state.setProposals);

  // ---- Worker integration ----
  // We keep a ref to the pending pass (1 or 2) so the callback knows which pass completed.
  const pendingPassRef = React.useRef(1);
  const pendingTableRef = React.useRef(null);

  const { runTopology, isRunning: isWorkerRunning } = useTopologyWorker({
    onProgress: (msg) => dispatch({ type: "SET_STATUS_MESSAGE", payload: msg }),

    onComplete: ({ proposals, logs }) => {
      const currentPass = pendingPassRef.current;
      const baseTable  = pendingTableRef.current || state.stage2Data;

      logs.forEach(entry => dispatch({ type: "ADD_LOG", payload: entry }));

      const activeProposals = currentPass === 2
        ? proposals.filter(p => !p.elementA?._passApplied && !p.elementB?._passApplied && p.pass === 'Pass 2')
        : proposals.filter(p => p.pass === 'Pass 1');

      setZustandProposals(activeProposals);

      const updatedTable = baseTable.map(r => ({ ...r }));
      logs.forEach(entry => {
        if (entry.row && entry.tier && entry.row !== '-') {
          const row = updatedTable.find(r => r._rowIndex === entry.row);
          if (row && !row._passApplied && (!row.fixingActionTier || entry.tier < row.fixingActionTier)) {
            row.fixingAction = entry.message;
            row.fixingActionTier = entry.tier;
            row.fixingActionRuleId = entry.ruleId;
            if (entry.score !== undefined) row.fixingActionScore = entry.score;
          }
        }
      });
      activeProposals.forEach(prop => {
        const row = updatedTable.find(r => r._rowIndex === prop.elementA?._rowIndex);
        if (row && !row._passApplied) {
          row.fixingAction = prop.description;
          row.fixingActionTier = (prop.dist ?? 999) < 25 ? 2 : 3;
          if (prop.score !== undefined) row.fixingActionScore = prop.score;
        }
      });

      dispatch({ type: "SET_STAGE_2_DATA", payload: updatedTable });
      setZustandData(updatedTable);
      dispatch({ type: "SMART_FIX_COMPLETE", payload: { pass: currentPass, summary: {} } });
      dispatch({
        type: "SET_STATUS_MESSAGE",
        payload: `[Worker] Pass ${currentPass} Complete: ${activeProposals.length} proposals generated.`,
      });
    },

    onError: (msg) => {
      dispatch({ type: "SET_STATUS_MESSAGE", payload: `[Worker] Topology error: ${msg}. Retrying on main thread…` });
      // Fallback: run synchronously on the main thread
      const logger = createLogger();
      const cfg = { ...state.config, currentPass: pendingPassRef.current };
      const { proposals } = PcfTopologyGraph2(pendingTableRef.current || state.stage2Data, cfg, logger);
      logger.getLog().forEach(e => dispatch({ type: "ADD_LOG", payload: e }));
      setZustandProposals(proposals);
      dispatch({ type: "SMART_FIX_COMPLETE", payload: { pass: pendingPassRef.current, summary: {} } });
    },
  });

  React.useEffect(() => {
    const handleSync = (e) => {
        const { rowIndex, status } = e.detail;
        // Just sync the approval flag — no geometry mutation here
        const updatedTable = state.stage2Data.map(r =>
            r._rowIndex === rowIndex ? { ...r, _fixApproved: status } : r
        );
        dispatch({ type: "SET_STAGE_2_DATA", payload: updatedTable });
    };
    window.addEventListener('zustand-fix-status-changed', handleSync);
    return () => window.removeEventListener('zustand-fix-status-changed', handleSync);
  }, [state.stage2Data, dispatch]);

  const handleSmartFix = () => {
    dispatch({ type: "SET_SMART_FIX_STATUS", status: "running" });
    const logger = createLogger();

    if (runGroup === 'group2') {
        // Use Web Worker if supported; fall back to sync if not
        if (USE_WORKER) {
          pendingPassRef.current = 1;
          pendingTableRef.current = state.stage2Data;
          dispatch({ type: "SET_STATUS_MESSAGE", payload: "Topology engine dispatched to Web Worker (Pass 1)…" });
          runTopology(state.stage2Data, state.config, 1);
          return;
        }

        // Enforce running Pass 1 explicitly by sending currentPass: 1
        const { proposals } = PcfTopologyGraph2(state.stage2Data, { ...state.config, currentPass: 1 }, logger);

        // Clear previous proposals for Pass 1 from Zustland before setting new
        // and also filter them down just in case
        const pass1Proposals = proposals.filter(p => p.pass === "Pass 1");
        setZustandProposals(pass1Proposals);

        let errorFixes = 0;
        let warnFixes = 0;

        // We map so we clear out any previous pass results and start fresh
        const updatedTable = state.stage2Data.map(r => {
            const row = { ...r };
            if (!row._passApplied) {
                delete row.fixingAction;
                delete row.fixingActionTier;
                delete row.fixingActionScore;
                delete row.fixingActionRuleId;
                delete row._fixApproved;
            }
            return row;
        });

        logger.getLog().forEach(entry => {
             dispatch({ type: "ADD_LOG", payload: entry });
             if (entry.tier && entry.tier <= 2) errorFixes++;
             if (entry.tier && entry.tier === 3) warnFixes++;
             if (entry.row && entry.tier && entry.row !== "-") {
                 const row = updatedTable.find(r => r._rowIndex === entry.row);
                 if (row && !row._passApplied && (!row.fixingActionTier || entry.tier < row.fixingActionTier)) {
                     row.fixingAction = entry.message;
                     row.fixingActionTier = entry.tier;
                     row.fixingActionRuleId = entry.ruleId;
                     if (entry.score !== undefined) row.fixingActionScore = entry.score;
                 }
             }
        });

        pass1Proposals.forEach(prop => {
            const row = updatedTable.find(r => r._rowIndex === prop.elementA._rowIndex);
            if (row && !row._passApplied) {
                row.fixingAction = prop.description;
                row.fixingActionTier = prop.dist < 25 ? 2 : 3;
                if (prop.score !== undefined) row.fixingActionScore = prop.score;
            }
        });
        dispatch({ type: "SET_STAGE_2_DATA", payload: updatedTable });
        setZustandData(updatedTable);
        dispatch({ type: "SMART_FIX_COMPLETE", payload: { pass: 1, summary: {} } });
        dispatch({ type: "SET_STATUS_MESSAGE", payload: `Analysis Complete (Group 2): Generated ${pass1Proposals.length} proposals.` });
    } else {
        const result = runSmartFix(state.stage2Data, state.config, logger);
        let errorFixes = 0;
        let warnFixes = 0;
        logger.getLog().forEach(entry => {
             dispatch({ type: "ADD_LOG", payload: entry });
             if (entry.tier && entry.tier <= 2) errorFixes++;
             if (entry.tier && entry.tier === 3) warnFixes++;
        });
        dispatch({ type: "SMART_FIX_COMPLETE", payload: result });
        dispatch({ type: "SET_STATUS_MESSAGE", payload: `Analysis Complete: ${errorFixes} Auto-Fixes (T1/2), ${warnFixes} Warnings (T3)` });
    }
  };

  const handleApplyFixes = () => {
    dispatch({ type: "SET_SMART_FIX_STATUS", status: "applying" });
    const logger = createLogger();

    // For Group 2 / proposals (from PcfTopologyGraph2), applying fixes means mutating the geometries that were approved.
    let tableToProcess = state.stage2Data;
    if (useStore.getState().proposals.length > 0) {
        tableToProcess = applyApprovedMutations(tableToProcess, useStore.getState().proposals, logger);
    }

    // `chains` may be undefined if we didn't run runSmartFix (Group 1), but applyFixes expects an iterable.
    const chainsToProcess = state.smartFix.chains || [];
    const result = applyFixes(tableToProcess, chainsToProcess, state.config, logger);

    logger.getLog().forEach(entry => dispatch({ type: "ADD_LOG", payload: entry }));

    setZustandData(result.updatedTable);
    dispatch({ type: "FIXES_APPLIED", payload: result });
  };

  const isDataLoaded = state.stage2Data && state.stage2Data.length > 0;
  const isValidationDone = state.smartFix.validationDone === true;
  const isRunning = state.smartFix.status === "running";
  const isApplying = state.smartFix.status === "applying";

  // Smart Fix should be disabled once clicked, unless we reset it.
  // We can track if the smartFixPass > 0 (meaning a pass was run) and disable the main Smart Fix button.
  const hasRunSmartFix = (state.smartFix.smartFixPass || 0) > 0;

  // Second Pass ready once Phase 1 Validator is done, no need to wait for Smart Fix 1 or Apply Fixes.
  const isSecondPassReady = isValidationDone && !isRunning && !isApplying && !isWorkerRunning;

  const canRunSmartFix = isDataLoaded && !isRunning && !isWorkerRunning && isValidationDone && !hasRunSmartFix;

  // Apply Fixes enabled if any row approved and not currently applying
  const hasApprovedFixes = state.stage2Data && state.stage2Data.some(r => r._fixApproved === true);
  const canApplyFixes = hasApprovedFixes && !isApplying;

  const handleSecondPass = () => {
    dispatch({ type: "SET_SMART_FIX_STATUS", status: "running" });
    const logger = createLogger();
    // Clear out prior fixingAction warnings/proposals from Pass 1 to give a clean slate for Pass 2
    // User requested: "when 'Run second pass' is clicked do not reset _Issuelisted but reset _fixApproved"
    // So we clear _fixApproved globally, and clear fixingAction so Pass 1 items don't clutter the UI during Pass 2 evaluation.
    const pass2Table = state.stage2Data.map(r => {
        const cleanRow = { ...r, _currentPass: 2 };

        // Remove old Pass 1 proposals that were not applied
        if (!cleanRow._passApplied) {
            delete cleanRow.fixingAction;
            delete cleanRow.fixingActionTier;
            delete cleanRow.fixingActionScore;
            delete cleanRow.fixingActionRuleId;
            delete cleanRow._fixApproved;
        }

        return cleanRow;
    });
    
    // We only pass the current Pass 2 config so the engine explicitly runs Pass 2
    if (runGroup === 'group2') {
        if (USE_WORKER) {
          pendingPassRef.current = 2;
          pendingTableRef.current = pass2Table;
          dispatch({ type: "SET_STAGE_2_DATA", payload: pass2Table });
          setZustandData(pass2Table);
          dispatch({ type: "SET_STATUS_MESSAGE", payload: "Topology engine dispatched to Web Worker (Pass 2)…" });
          runTopology(pass2Table, state.config, 2);
          return;
        }

        const { proposals } = PcfTopologyGraph2(pass2Table, { ...state.config, currentPass: 2 }, logger);

        // Filter proposals down to only the un-applied ones and enforce Pass 2 specific
        const activeProposals = proposals.filter(p => !p.elementA._passApplied && !p.elementB._passApplied && p.pass === "Pass 2");
        setZustandProposals(activeProposals);

        let hasPass2Proposals = false;

        // Attach new proposals to rows so they render correctly in the DataTable
        activeProposals.forEach(prop => {
            if (prop.pass === 'Pass 2') {
                hasPass2Proposals = true;
            }
            const row = pass2Table.find(r => r._rowIndex === prop.elementA._rowIndex);
            if (row && !row._passApplied) {
                row.fixingAction = prop.description;
                row.fixingActionTier = prop.dist < 25 ? 2 : 3;
                if (prop.score !== undefined) row.fixingActionScore = prop.score;
            }
        });

        logger.getLog().forEach(entry => {
             dispatch({ type: "ADD_LOG", payload: entry });
             if (entry.row && entry.tier && entry.row !== "-") {
                 const row = pass2Table.find(r => r._rowIndex === entry.row);
                 // Only overwrite if it's not a previously applied pass
                 if (row && !row._passApplied && (!row.fixingActionTier || entry.tier < row.fixingActionTier)) {
                     row.fixingAction = entry.message;
                     row.fixingActionTier = entry.tier;
                     row.fixingActionRuleId = entry.ruleId;
                     if (entry.score !== undefined) row.fixingActionScore = entry.score;
                 }
             }
        });

        if (!hasPass2Proposals) {
             dispatch({ type: "ADD_LOG", payload: { stage: "FIXING", type: "Info", message: "Pass 2 did not yield any new proposals for existing gaps.", row: "-" } });
             dispatch({ type: "SET_STATUS_MESSAGE", payload: "Pass 2 Analysis Complete: No new issues found." });
        } else {
             dispatch({ type: "SET_STATUS_MESSAGE", payload: `Pass 2 Analysis Complete: Generated ${activeProposals.filter(p=>p.pass==='Pass 2').length} proposals.` });
        }

        dispatch({ type: "SET_STAGE_2_DATA", payload: pass2Table });
        setZustandData(pass2Table);
        dispatch({ type: "SMART_FIX_COMPLETE", payload: { pass: 2, summary: {} } });
    } else {
        const result = runSmartFix(pass2Table, { ...state.config, currentPass: 2 }, logger);
        logger.getLog().forEach(entry => dispatch({ type: "ADD_LOG", payload: entry }));
        dispatch({ type: "SET_STAGE_2_DATA", payload: pass2Table });
        setZustandData(pass2Table);
        dispatch({ type: "SMART_FIX_COMPLETE", payload: { ...result, pass: 2 } });
        dispatch({ type: "SET_STATUS_MESSAGE", payload: "Second Pass analysis complete — review proposals and Apply Fixes." });
    }
  };

  // ------------------------------------------------------------------
  // One-Click Auto-Fix: runs the full pipeline automatically,
  // stops before Tier 3 (review-required) proposals.
  // ------------------------------------------------------------------
  const [autoFixRunning, setAutoFixRunning] = React.useState(false);

  const handleOneClickAutoFix = async () => {
    if (!state.stage2Data || state.stage2Data.length === 0) {
      dispatch({ type: "SET_STATUS_MESSAGE", payload: "Auto-Fix: No Stage 2 data. Pull data from Stage 1 first." });
      return;
    }
    setAutoFixRunning(true);
    dispatch({ type: "CLEAR_LOG" });
    dispatch({ type: "SET_STATUS_MESSAGE", payload: "Auto-Fix Pipeline: Step 1/4 — Running Data Processor…" });

    // Yield to React before heavy work
    await new Promise(r => setTimeout(r, 0));

    const logger = createLogger();

    // Step 1: Data Processor
    let processedTable = runDataProcessor(state.stage2Data, state.config, logger);

    await new Promise(r => setTimeout(r, 0));
    dispatch({ type: "SET_STATUS_MESSAGE", payload: "Auto-Fix Pipeline: Step 2/4 — Running Validation…" });

    // Step 2: Validation
    runValidationChecklist(processedTable, state.config, logger, "2");
    logger.getLog().forEach(entry => dispatch({ type: "ADD_LOG", payload: entry }));
    logger.getLog().forEach(entry => {
      if (entry.row && entry.tier) {
        const row = processedTable.find(r => r._rowIndex === entry.row);
        if (row && !row.fixingAction) {
          row.fixingAction = entry.message;
          row.fixingActionTier = entry.tier;
          row.fixingActionRuleId = entry.ruleId;
        }
      }
    });
    dispatch({ type: "SET_STAGE_2_DATA", payload: processedTable });
    setZustandData(processedTable);
    dispatch({ type: "SET_VALIDATION_DONE" });

    await new Promise(r => setTimeout(r, 0));
    dispatch({ type: "SET_STATUS_MESSAGE", payload: "Auto-Fix Pipeline: Step 3/4 — Running Smart Fix (Group 2)…" });

    // Step 3: Smart Fix (Group 2 topology engine)
    const logger2 = createLogger();
    const { proposals } = PcfTopologyGraph2(processedTable, state.config, logger2);
    setZustandProposals(proposals);

    const tableWithProposals = processedTable.map(r => ({ ...r }));
    logger2.getLog().forEach(entry => {
      dispatch({ type: "ADD_LOG", payload: entry });
      if (entry.row && entry.tier && entry.row !== "-") {
        const row = tableWithProposals.find(r => r._rowIndex === entry.row);
        if (row && !row._passApplied && (!row.fixingActionTier || entry.tier < row.fixingActionTier)) {
          row.fixingAction = entry.message;
          row.fixingActionTier = entry.tier;
          row.fixingActionRuleId = entry.ruleId;
          if (entry.score !== undefined) row.fixingActionScore = entry.score;
        }
      }
    });
    proposals.forEach(prop => {
      const row = tableWithProposals.find(r => r._rowIndex === prop.elementA._rowIndex);
      if (row && !row._passApplied) {
        row.fixingAction = prop.description;
        row.fixingActionTier = prop.dist < 25 ? 2 : 3;
        if (prop.score !== undefined) row.fixingActionScore = prop.score;
      }
    });

    // Auto-approve Tier 1 & 2 — Tier 3 requires manual review
    const tier3Count = tableWithProposals.filter(r => r.fixingActionTier === 3 && !r._passApplied).length;
    tableWithProposals.forEach(r => {
      if (!r._passApplied && r.fixingActionTier && r.fixingActionTier <= 2) {
        r._fixApproved = true;
        useStore.getState().setProposalStatus(r._rowIndex, true);
      }
    });

    dispatch({ type: "SET_STAGE_2_DATA", payload: tableWithProposals });
    setZustandData(tableWithProposals);
    dispatch({ type: "SMART_FIX_COMPLETE", payload: { pass: 1, summary: {} } });

    await new Promise(r => setTimeout(r, 0));

    // Step 4: Apply approved (Tier 1 & 2) fixes immediately
    const hasApproved = tableWithProposals.some(r => r._fixApproved === true);
    if (hasApproved) {
      dispatch({ type: "SET_STATUS_MESSAGE", payload: "Auto-Fix Pipeline: Step 4/4 — Applying Tier 1 & 2 fixes…" });
      const logger3 = createLogger();
      let tableToApply = tableWithProposals;
      if (proposals.length > 0) {
        tableToApply = applyApprovedMutations(tableToApply, proposals, logger3);
      }
      const result = applyFixes(tableToApply, state.smartFix.chains || [], state.config, logger3);
      logger3.getLog().forEach(e => dispatch({ type: "ADD_LOG", payload: e }));
      setZustandData(result.updatedTable);
      dispatch({ type: "FIXES_APPLIED", payload: result });
    }

    setAutoFixRunning(false);
    const msg = tier3Count > 0
      ? `Auto-Fix Complete: Tier 1/2 fixes applied. ${tier3Count} Tier 3 items require manual review in Stage 2.`
      : "Auto-Fix Complete: All fixes applied automatically. Review Stage 2 and export from Stage 3.";
    dispatch({ type: "SET_STATUS_MESSAGE", payload: msg });
  };

  const d = new Date();
  const verString = `Ver ${d.getDate().toString().padStart(2, '0')}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getFullYear()} (2)`;

  const handleExecute = () => {
      setShowModal(false);
      const logger = createLogger();
      // Only process geometry parsing and V15 validation (Stage 2) here
      // DataProcessor: only fill derived fields (bore, CP, deltas, lengths) — no pipe trimming/filling
      let processedTable = runDataProcessor(state.stage2Data, state.config, logger);
      // Validation: populates fixingAction with ERROR/WARNING messages — read-only, no coord changes
      runValidationChecklist(processedTable, state.config, logger, "2");

      let finalProposals = [];
      if (runGroup === 'group2') {
          // Generate Zustand proposals only — do NOT apply mutations yet
          const { proposals } = PcfTopologyGraph2(processedTable, state.config, logger);
          finalProposals = proposals;
          setZustandProposals(proposals);
          // proposals will be applied ONLY when user clicks "Apply Fixes"
      }

      logger.getLog().forEach(entry => dispatch({ type: "ADD_LOG", payload: entry }));

      // Attach validation messages to table rows (fixingAction)
      logger.getLog().forEach(entry => {
        if (entry.row && entry.tier) {
          const row = processedTable.find(r => r._rowIndex === entry.row);
          if (row && !row.fixingAction) {
            row.fixingAction = entry.message;
            row.fixingActionTier = entry.tier;
            row.fixingActionRuleId = entry.ruleId;
            if (entry.score !== undefined) row.fixingActionScore = entry.score;
          }
        }
      });

      // Override fixingAction with proposals from group2 so they show up
      if (runGroup === 'group2') {
          finalProposals.forEach(prop => {
              const row = processedTable.find(r => r._rowIndex === prop.elementA._rowIndex);
              if (row) {
                  row.fixingAction = prop.description;
                  row.fixingActionTier = prop.dist < 25 ? 2 : 3;
                  if (prop.score !== undefined) row.fixingActionScore = prop.score;
              }
          });
      }

      dispatch({ type: "SET_STAGE_2_DATA", payload: processedTable });
      setZustandData(processedTable);
      // Gate: unlock Smart Fix button
      dispatch({ type: "SET_VALIDATION_DONE" });
      const errorCount = logger.getLog().filter(e => e.tier <= 2).length;
      const warnCount  = logger.getLog().filter(e => e.tier === 3).length;
      dispatch({ type: "SET_STATUS_MESSAGE", payload: `Validation complete: ${errorCount} Errors, ${warnCount} Warnings. Run Smart Fix to generate proposals.` });
  };

  return (
    <>
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
          <div className="bg-white p-6 rounded-lg shadow-xl w-[500px] text-slate-800">
            <h2 className="text-xl font-bold mb-4">Select Validation Engine</h2>

            <div className="space-y-4 mb-6">
              <label className="flex items-start space-x-3 p-3 border rounded hover:bg-slate-50 cursor-pointer">
                <input type="radio" name="engineGroup" value="group1" checked={runGroup === 'group1'} onChange={() => setRunGroup('group1')} className="mt-1" />
                <div>
                  <div className="font-semibold">Group (1): Original Smart Fixer</div>
                  <div className="text-sm text-slate-500">Standard First Pass and Second Pass logic tracking components and applying rules.</div>
                </div>
              </label>

              <label className="flex items-start space-x-3 p-3 border rounded hover:bg-slate-50 cursor-pointer">
                <input type="radio" name="engineGroup" value="group2" checked={runGroup === 'group2'} onChange={() => setRunGroup('group2')} className="mt-1" />
                <div>
                  <div className="font-semibold">Group (2): PcfTopologyGraph_2</div>
                  <div className="text-sm text-slate-500">3-Pass System: Sequential Tracing, Global Sweep (Major Axis), Global Fuzzy Search. Includes Immutable Translations and Pipe Injection.</div>
                </div>
              </label>
            </div>

            <div className="flex justify-end space-x-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded hover:bg-slate-100 text-slate-700">Cancel</button>
              <button onClick={handleExecute} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium">Run Engine</button>
            </div>
          </div>
        </div>
      )}

    <div className="fixed bottom-0 left-0 right-0 h-12 bg-slate-800 text-white flex items-center justify-between px-4 text-sm z-50 shadow-lg">
      <div className="flex items-center space-x-2 relative h-full">
        {/* Collapsible Status Container */}
        <div
            className={`absolute bottom-0 left-0 bg-slate-700 border-t border-r border-slate-600 rounded-tr-lg shadow-xl transition-all duration-300 ease-in-out flex flex-col ${isStatusExpanded ? 'h-48 w-[500px] p-4' : 'min-h-[3rem] w-[360px] px-3 py-2 flex-row items-start cursor-pointer hover:bg-slate-600'}`}
            onClick={() => !isStatusExpanded && setIsStatusExpanded(true)}
        >
            <div className="flex justify-between items-center w-full mb-2">
                <span className={`font-mono text-slate-300 ${isStatusExpanded ? 'text-sm' : 'text-xs break-words whitespace-pre-wrap'}`}>
                    {state.statusMessage || "Ready"}
                </span>
                {isStatusExpanded && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setIsStatusExpanded(false); }}
                        className="text-slate-400 hover:text-white"
                    >
                        ✕
                    </button>
                )}
            </div>
            {isStatusExpanded && (
                <div className="flex-1 overflow-y-auto mt-2 text-xs text-slate-400 space-y-1">
                    {/* If we had a message history, we'd map it here. For now just show the current message wrapped. */}
                    <div className="bg-slate-800/50 p-2 rounded whitespace-pre-wrap font-mono">
                        {state.statusMessage || "System is idle."}
                    </div>
                </div>
            )}
        </div>

        {/* Push content past the status box when collapsed */}
        <div className="ml-[375px] flex items-center space-x-2">
        {(!state.dataTable || state.dataTable.length === 0) && (
            <button
                onClick={() => {
                  const mockData = [
                    { _rowIndex: 1, type: "PIPE", ep1: {x: 0, y: 0, z: 0}, ep2: {x: 1000, y: 0, z: 0}, bore: 100 },
                    { _rowIndex: 2, type: "PIPE", ep1: {x: 1005, y: 0, z: 0}, ep2: {x: 2000, y: 0, z: 0}, bore: 100 },
                    { _rowIndex: 3, type: "TEE", ep1: {x: 2000, y: 0, z: 0}, ep2: {x: 2300, y: 0, z: 0}, cp: {x: 2150, y: 0, z: 0}, bp: {x: 2150, y: 150, z: 0}, bore: 100, branchBore: 50 },
                    { _rowIndex: 4, type: "PIPE", ep1: {x: 2300, y: 0, z: 0}, ep2: {x: 3000, y: 0, z: 0}, bore: 100 },
                    { _rowIndex: 5, type: "PIPE", ep1: {x: 2980, y: 0, z: 0}, ep2: {x: 4000, y: 0, z: 0}, bore: 100 },
                    { _rowIndex: 6, type: "PIPE", ep1: {x: 2150, y: 150, z: 0}, ep2: {x: 2150, y: 154, z: 0}, bore: 50 },
                    { _rowIndex: 7, type: "VALVE", ep1: {x: 2150, y: 154, z: 0}, ep2: {x: 2150, y: 354, z: 0}, bore: 50, skey: "VBFL" },
                  ];
                  dispatch({ type: "SET_DATA_TABLE", payload: mockData });
                  useStore.getState().setDataTable(mockData);
                }}
                title="Load Mock Test Data"
                className="w-8 h-8 flex items-center justify-center bg-indigo-900/50 hover:bg-indigo-800 text-indigo-300 rounded transition border border-indigo-700/50 text-base"
            >
              🧪
            </button>
        )}

        {(activeTab === 'data' && activeStage === '2') && (
          <button
            onClick={() => setShowModal(true)}
            disabled={!isDataLoaded}
            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-50 h-8 flex items-center"
          >
            Run Phase 1 Validator (Only Pipe filling/Trimming) ▶
          </button>
        )}
        </div>
      </div>

      <div className="flex items-center space-x-2">

        {/* One-Click Auto-Fix — always visible when Stage 2 data is loaded */}
        {isDataLoaded && (
          <button
            onClick={handleOneClickAutoFix}
            disabled={autoFixRunning || isRunning || isApplying}
            className="px-3 py-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded font-bold shadow-sm disabled:opacity-50 transition-all text-sm flex items-center gap-1.5 border border-violet-700/40"
            title="Automatically run all stages: DataProcessor → Validation → Smart Fix → Apply Tier 1/2. Tier 3 items will need manual review."
          >
            {autoFixRunning ? (
              <><span className="animate-spin inline-block">⚙</span> Running…</>
            ) : (
              <><span>⚡</span> One-Click Auto-Fix</>
            )}
          </button>
        )}

        {/* Only show these action buttons in Stage 2 */}
        {(activeTab === 'data' && activeStage === '2') && (
            <>

                <button
                  onClick={() => {
                    dispatch({ type: "UNDO_FIXES" });
                    if (state.history.length > 0) {
                      const prevTable = state.history[state.history.length - 1];
                      setZustandData(prevTable);
                    }
                  }}
                  disabled={state.history.length === 0}
                  className="px-4 py-1.5 bg-yellow-600 hover:bg-yellow-500 rounded font-medium disabled:opacity-50 transition-colors text-white h-full"
                  title="Undo last applied fixes"
                >
                  ↶ Undo
                </button>

                <button
                  onClick={handleSmartFix}
                  disabled={!canRunSmartFix}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded font-medium disabled:opacity-50 transition-colors h-full"
                  title={!isValidationDone ? "Run Phase 1 Validator first" : hasRunSmartFix ? "Smart Fix already executed" : "Analyse data and generate fix proposals"}
                >
                  {isRunning ? "Analyzing..." : "Smart Fix 🔧"}
                </button>

                <button
                  onClick={handleApplyFixes}
                  disabled={!canApplyFixes}
                  className="px-4 py-1.5 bg-green-600 hover:bg-green-500 rounded font-medium disabled:opacity-50 transition-colors h-full"
                  title={!hasApprovedFixes ? "Approve at least one proposal first" : "Apply all approved fixes to geometry"}
                >
                  {isApplying ? "Applying..." : "Apply Fixes ✓"}
                </button>

                <button
                  onClick={handleSecondPass}
                  disabled={!isSecondPassReady}
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 rounded font-medium disabled:opacity-50 transition-colors h-full"
                  title={!isSecondPassReady ? "Run Phase 1 Validator first" : "Run Second Pass for non-Pipe components"}
                >
                  🚀 Run Second Pass
                </button>
            </>
        )}

        <span className="text-slate-400 font-mono text-xs">{verString}</span>
      </div>
    </div>
    </>
  );
}
