import React from 'react';
import { useAppContext } from '../../store/AppContext';
import { useStore } from '../../store/useStore';
import { runValidationChecklist } from '../../engine/Validator';
import { createLogger } from '../../utils/Logger';
import { exportToExcel, generatePCFText } from '../../utils/ImportExport';

export function DataTableTab({ stage = "1" }) {
  const { state, dispatch } = useAppContext();
  const [filterAction, setFilterAction] = React.useState('ALL');

  let currentData;
  if (stage === "1") currentData = state.dataTable;
  else if (stage === "2") currentData = state.stage2Data;
  else if (stage === "3") currentData = state.stage3Data;

  const dataTable = currentData;

  const handleApprove = (rowIndex, approve) => {
      const updatedTable = [...dataTable];
      const rowIdx = updatedTable.findIndex(r => r._rowIndex === rowIndex);
      if (rowIdx > -1) {
          updatedTable[rowIdx] = { ...updatedTable[rowIdx], _fixApproved: approve };
          if (stage === "1") dispatch({ type: "SET_DATA_TABLE", payload: updatedTable });
          if (stage === "2") dispatch({ type: "SET_STAGE_2_DATA", payload: updatedTable });
          if (stage === "3") dispatch({ type: "SET_STAGE_3_DATA", payload: updatedTable });

          const actionText = approve ? 'Approved' : 'Rejected';
          const rowDescription = updatedTable[rowIdx].fixingAction ? updatedTable[rowIdx].fixingAction.substring(0, 50) + "..." : "";

          dispatch({ type: "ADD_LOG", payload: {
             stage: "FIXING",
             type: approve ? "Applied" : "Warning",
             row: rowIndex,
             message: `User ${actionText} Fix: ${rowDescription}`
          }});

          // Ensure Zustand proposals match this state so 3D canvas popups turn green
          if (stage === "2") useStore.getState().setProposalStatus(rowIndex, approve);
      }
  };

  const handleAutoApproveAll = () => {
      const updatedTable = dataTable.map(r => {
          if (r.fixingActionTier && r.fixingActionTier <= 2) {
              if (stage === "2") useStore.getState().setProposalStatus(r._rowIndex, true);
              return { ...r, _fixApproved: true };
          }
          return r;
      });
      if (stage === "1") dispatch({ type: "SET_DATA_TABLE", payload: updatedTable });
      if (stage === "2") dispatch({ type: "SET_STAGE_2_DATA", payload: updatedTable });
      if (stage === "3") dispatch({ type: "SET_STAGE_3_DATA", payload: updatedTable });
  };


  const handleCalculateMissingGeometry = () => {
       let bendPtr = 0, rigidPtr = 0, intPtr = 0;
       let updatedItems = { bore: 0, boreFb: 0, cp: 0, delta: 0, len: 0, ptr: 0 };

       const getAxis = (ep1, ep2) => {
            const dx = ep2.x - ep1.x;
            const dy = ep2.y - ep1.y;
            const dz = ep2.z - ep1.z;
            const absX = Math.abs(dx);
            const absY = Math.abs(dy);
            const absZ = Math.abs(dz);
            if (absX > absY && absX > absZ) return dx > 0 ? 'East' : 'West';
            if (absY > absX && absY > absZ) return dy > 0 ? 'Up' : 'Down';
            if (absZ > absX && absZ > absY) return dz > 0 ? 'North' : 'South';
            return 'U';
       };

       const dist = (ep1, ep2) => Math.sqrt((ep2.x-ep1.x)**2 + (ep2.y-ep1.y)**2 + (ep2.z-ep1.z)**2);

       const updatedTable = dataTable.map((row, index, arr) => {
            const r = { ...row };
            const t = r.type || "";

            // Auto inherit bore from previous row if missing
            if ((!r.bore || r.bore === "") && index > 0) {
                 const prev = arr[index - 1];
                 if (prev.bore) {
                     r.bore = prev.bore;
                     r._modified = r._modified || {};
                     r._modified.bore = "Inherited";
                     updatedItems.bore++;
                 }
            }
            // Missing Bore fallback for PIPES
            if ((!r.bore || r.bore === "") && t === "PIPE" && r.ep1 && r.ep2) {
                r.bore = 100;
                r._modified = r._modified || {};
                r._modified.bore = "Fallback";
                updatedItems.boreFb++;
            }
            // Missing CP for TEES
            if (t === "TEE" && (!r.cp || (r.cp.x === undefined && r.cp.y === undefined && r.cp.z === undefined) || (r.cp.x === 0 && r.cp.y === 0 && r.cp.z === 0)) && r.ep1 && r.ep2) {
                r.cp = {
                    x: (r.ep1.x + r.ep2.x) / 2,
                    y: (r.ep1.y + r.ep2.y) / 2,
                    z: (r.ep1.z + r.ep2.z) / 2
                };
                r._modified = r._modified || {};
                r._modified.cp = "Calculated Midpoint";
                updatedItems.cp++;
            }

            // Calculate Vector Deltas (Axis) if missing
            if (r.ep1 && r.ep2 && (r.deltaX === undefined || r.deltaY === undefined || r.deltaZ === undefined)) {
                r.deltaX = r.ep2.x - r.ep1.x;
                r.deltaY = r.ep2.y - r.ep1.y;
                r.deltaZ = r.ep2.z - r.ep1.z;
                r._modified = r._modified || {};
                r._modified.deltaX = "Calc";
                updatedItems.delta++;
            }

            // Calculate LEN/AXIS
            if (r.ep1 && r.ep2) {
                if (r.len1 === undefined) {
                    r.len1 = dist(r.ep1, r.ep2);
                    r.axis1 = getAxis(r.ep1, r.ep2);
                    r._modified = r._modified || {};
                    r._modified.len1 = "Calc";
                    updatedItems.len++;
                }
            }
            if (t === "TEE" && r.cp && r.bp) {
                if (r.brlen === undefined) {
                    r.brlen = dist(r.cp, r.bp);
                    r._modified = r._modified || {};
                    r._modified.brlen = "Calc";
                    updatedItems.len++;
                }
            }
            if (t === "BEND" && r.ep1 && r.ep2 && r.cp) {
                 if (r.len1 === undefined) { r.len1 = dist(r.cp, r.ep1); r.axis1 = getAxis(r.cp, r.ep1); r._modified = r._modified || {}; r._modified.len1 = "Calc"; updatedItems.len++; }
                 if (r.len2 === undefined) { r.len2 = dist(r.cp, r.ep2); r.axis2 = getAxis(r.cp, r.ep2); r._modified = r._modified || {}; r._modified.len2 = "Calc"; updatedItems.len++; }
            }

            // Pointers
            if (t === "BEND") {
                if (!r.bendPtr) { r.bendPtr = ++bendPtr; r._modified = r._modified || {}; r._modified.bendPtr = "Calc"; updatedItems.ptr++; }
            } else if (t === "FLANGE" || t === "VALVE") {
                if (!r.rigidPtr) { r.rigidPtr = ++rigidPtr; r._modified = r._modified || {}; r._modified.rigidPtr = "Calc"; updatedItems.ptr++; }
            } else if (t === "TEE" || t === "OLET") {
                if (!r.intPtr) { r.intPtr = ++intPtr; r._modified = r._modified || {}; r._modified.intPtr = "Calc"; updatedItems.ptr++; }
            }

            // Dimensions lookup (mocked or fallback to ca data)
            if (!r.diameter && r.bore) {
                r.diameter = r.bore; // basic approx
                r._modified = r._modified || {};
                r._modified.diameter = "Calc";
            }

            return r;
       });
       if (stage === "1") dispatch({ type: "SET_DATA_TABLE", payload: updatedTable });
       if (stage === "2") dispatch({ type: "SET_STAGE_2_DATA", payload: updatedTable });
       if (stage === "3") dispatch({ type: "SET_STAGE_3_DATA", payload: updatedTable });

       // Trigger a sync so StatusBar knows table changed if needed
       if (stage === "2") window.dispatchEvent(new CustomEvent('zustand-force-sync'));

       const alertLines = [];
       if (updatedItems.bore > 0) alertLines.push(`Bores: ${updatedItems.bore}`);
       if (updatedItems.boreFb > 0) alertLines.push(`Pipe Fallbacks: ${updatedItems.boreFb}`);
       if (updatedItems.cp > 0) alertLines.push(`TEE CPs: ${updatedItems.cp}`);
       if (updatedItems.delta > 0) alertLines.push(`Deltas: ${updatedItems.delta}`);
       if (updatedItems.len > 0) alertLines.push(`Lengths/Axis: ${updatedItems.len}`);
       if (updatedItems.ptr > 0) alertLines.push(`Ptrs: ${updatedItems.ptr}`);

       const msg = alertLines.length > 0 ? `Missing Geo Check: Calculated ${alertLines.join(', ')}` : "Missing Geo Check: No missing geometry found.";
       dispatch({ type: "SET_STATUS_MESSAGE", payload: msg });
  };

  const handlePullStage1 = () => {
      // Pulls Data Table from Stage 1 into Stage 2 minus fixingAction
      const stage1Data = state.dataTable.map(r => {
          const newRow = { ...r };
          delete newRow.fixingAction;
          delete newRow.fixingActionTier;
          delete newRow.fixingActionRuleId;
          delete newRow._fixApproved;
          delete newRow._passApplied;
          return newRow;
      });
      dispatch({ type: "SET_STAGE_2_DATA", payload: stage1Data });
      dispatch({ type: "SET_STATUS_MESSAGE", payload: "Successfully pulled Stage 1 data into Stage 2." });
  };

  const handleSyntaxFix = () => {
      let capsFixed = 0;
      let zeroFixed = 0;

      const updatedTable = dataTable.map(r => {
          const newRow = { ...r };
          let actionsTaken = [];

          if (newRow.type && newRow.type !== newRow.type.toUpperCase().trim()) {
              newRow.type = newRow.type.toUpperCase().trim();
              capsFixed++;
              actionsTaken.push("Type Caps");
          }
          if (newRow.skey && newRow.skey !== newRow.skey.toUpperCase().trim()) {
              newRow.skey = newRow.skey.toUpperCase().trim();
              capsFixed++;
              actionsTaken.push("SKEY Caps");
          }

          const isZero = (pt) => pt && pt.x === 0 && pt.y === 0 && pt.z === 0;
          if (isZero(newRow.ep1)) { newRow.ep1 = null; zeroFixed++; actionsTaken.push("EP1 (0,0,0)"); }
          if (isZero(newRow.ep2)) { newRow.ep2 = null; zeroFixed++; actionsTaken.push("EP2 (0,0,0)"); }
          if (isZero(newRow.cp)) { newRow.cp = null; zeroFixed++; actionsTaken.push("CP (0,0,0)"); }
          if (isZero(newRow.bp)) { newRow.bp = null; zeroFixed++; actionsTaken.push("BP (0,0,0)"); }

          if (actionsTaken.length > 0) {
               if (r.fixingAction && !r.fixingAction.includes('[Cleared]')) {
                   newRow.fixingAction = `${r.fixingAction} — [Cleared] ${actionsTaken.join(', ')}`;
                   newRow.fixingActionTier = 1;
               } else if (!r.fixingAction) {
                   newRow.fixingAction = `[Cleared] ${actionsTaken.join(', ')}`;
                   newRow.fixingActionTier = 1;
               }
          }

          return newRow;
      });
      dispatch({ type: "SET_DATA_TABLE", payload: updatedTable });
      dispatch({ type: "SET_STATUS_MESSAGE", payload: `Syntax Fix Complete: Caps Fixed (${capsFixed}), (0,0,0) cleared (${zeroFixed})` });
  };

  const handleValidateSyntax = () => {
      const logger = createLogger();
      const results = runValidationChecklist(dataTable, state.config, logger, stage);

      logger.getLog().forEach(entry => dispatch({ type: "ADD_LOG", payload: entry }));

      const ruleCounts = {};
      let updatedTable = [...dataTable];
      logger.getLog().forEach(entry => {
        if (entry.ruleId) {
             ruleCounts[entry.ruleId] = (ruleCounts[entry.ruleId] || 0) + 1;
        }
        if (entry.row && entry.tier) {
          const row = updatedTable.find(r => r._rowIndex === entry.row);
          if (row) {
             // Preserve existing proposals if any, otherwise set validation message
             if (!row.fixingAction || row.fixingAction.includes('ERROR') || row.fixingAction.includes('WARNING')) {
                row.fixingAction = entry.message;
                row.fixingActionTier = entry.tier;
                row.fixingActionRuleId = entry.ruleId;
             }
          }
        }
      });

      if (stage === "1") {
          updatedTable = updatedTable.map(r => {
              const row = { ...r };
              let expectedFixes = [];
              if (row.type && row.type !== row.type.toUpperCase().trim()) expectedFixes.push("Type Caps");
              if (row.skey && row.skey !== row.skey.toUpperCase().trim()) expectedFixes.push("SKEY Caps");

              const isZero = (pt) => pt && pt.x === 0 && pt.y === 0 && pt.z === 0;
              if (isZero(row.ep1)) expectedFixes.push("EP1 (0,0,0)");
              if (isZero(row.ep2)) expectedFixes.push("EP2 (0,0,0)");
              if (isZero(row.cp)) expectedFixes.push("CP (0,0,0)");
              if (isZero(row.bp)) expectedFixes.push("BP (0,0,0)");

              if (expectedFixes.length > 0) {
                  const fixStr = `Clear ${expectedFixes.join(', ')}`;
                  if (row.fixingAction && !row.fixingAction.includes('—')) {
                      row.fixingAction = `${row.fixingAction} — ${fixStr}`;
                  } else if (!row.fixingAction) {
                      row.fixingAction = `Syntax Check — ${fixStr}`;
                      row.fixingActionTier = 2;
                  }
              }
              return row;
          });
      }

      if (stage === "1") dispatch({ type: "SET_DATA_TABLE", payload: updatedTable });
      if (stage === "2") dispatch({ type: "SET_STAGE_2_DATA", payload: updatedTable });
      if (stage === "3") dispatch({ type: "SET_STAGE_3_DATA", payload: updatedTable });

      const summaryText = Object.entries(ruleCounts).map(([rule, count]) => `${rule}(${count})`).join(', ');
      dispatch({ type: "SET_STATUS_MESSAGE", payload: `Validation Complete: ${results.errorCount} Errors, ${results.warnCount} Warnings. Rules: ${summaryText || 'None'}` });
  };

  const fixingActionStats = React.useMemo(() => {
    let approvedP1 = 0, rejectedP1 = 0, pendingP1 = 0;
    let approvedP2 = 0, rejectedP2 = 0, pendingP2 = 0;
    let errPass1 = 0, warnPass1 = 0;
    let errPass2 = 0, warnPass2 = 0;

    if (dataTable) {
        dataTable.forEach(r => {
          if (r.fixingAction) {
            const isP2 = r._passApplied === 2 || r._currentPass === 2 || r.fixingAction.includes('[2nd Pass]');
            const isErr = r.fixingActionTier === 4 || r.fixingAction.includes('ERROR');
            const isWarn = r.fixingActionTier === 3 || r.fixingAction.includes('WARNING');

            // Check Validation stats
            if (isP2) {
                if (isErr) errPass2++;
                if (isWarn) warnPass2++;
            } else {
                if (isErr) errPass1++;
                if (isWarn) warnPass1++;
            }

            // Check Action stats
            if (!isErr && !isWarn) {
                if (isP2) {
                    if (r._fixApproved === true || r._passApplied === 2) approvedP2++;
                    else if (r._fixApproved === false) rejectedP2++;
                    else pendingP2++;
                } else {
                    if (r._fixApproved === true || r._passApplied === 1) approvedP1++;
                    else if (r._fixApproved === false) rejectedP1++;
                    else pendingP1++;
                }
            }
          }
        });
    }
    return { approvedP1, rejectedP1, pendingP1, errPass1, warnPass1, approvedP2, rejectedP2, pendingP2, errPass2, warnPass2 };
  }, [state.dataTable]);

  const filteredDataTable = React.useMemo(() => {
     if (!dataTable) return [];
     if (filterAction === 'ALL') return dataTable;
     if (filterAction === 'ERRORS_WARNINGS') return dataTable.filter(r => r.fixingAction && (r.fixingAction.includes('ERROR') || r.fixingAction.includes('WARNING')));
     if (filterAction === 'PROPOSALS') return dataTable.filter(r => r.fixingAction && !r.fixingAction.includes('ERROR') && !r.fixingAction.includes('WARNING'));
     if (filterAction === 'PENDING') return dataTable.filter(r => r.fixingAction && r._fixApproved === undefined);
     if (filterAction === 'APPROVED') return dataTable.filter(r => r._fixApproved === true);
     if (filterAction === 'REJECTED') return dataTable.filter(r => r._fixApproved === false);
     if (filterAction === 'HAS_FIXING_ACTION') return dataTable.filter(r => r.fixingAction);
     return dataTable;
  }, [dataTable, filterAction]);

  if (stage === "3" && (!currentData || currentData.length === 0)) {
      return (
          <div className="flex flex-col items-center justify-center h-[calc(100vh-12rem)] text-slate-500 p-8">
              <h2 className="text-xl font-bold mb-2 text-slate-700">Stage 3: Final Checking</h2>
              <p className="max-w-xl text-center">This is the final validation stage where VXX syntax rules and RXX topological rules are executed one last time before export to ensure no regressions were introduced during Stage 2 fixing.</p>
              <button onClick={() => {
                  dispatch({ type: "SET_STAGE_3_DATA", payload: state.stage2Data });
              }} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded font-medium shadow">
                  Pull Data from Stage 2
              </button>
          </div>
      );
  }

  if (!dataTable || dataTable.length === 0) {
    if (stage === "2") {
       return (
          <div className="flex flex-col items-center justify-center h-[calc(100vh-12rem)] text-slate-500 p-8">
              <h2 className="text-xl font-bold mb-2 text-slate-700">Stage 2: Topology & Fixing</h2>
              <p className="max-w-xl text-center mb-6">Data for Stage 2 (Topology & Fixing) must be explicitly pulled from Stage 1 after syntax checks are complete.</p>
              <button onClick={handlePullStage1} disabled={!state.dataTable || state.dataTable.length === 0} className="mt-4 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded font-bold shadow disabled:opacity-50">
                  Pull Data from Stage 1
              </button>
              {(!state.dataTable || state.dataTable.length === 0) && <p className="text-xs mt-2 text-red-500">Stage 1 has no data.</p>}
          </div>
       );
    }
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-12rem)] text-slate-500">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-4 text-slate-400">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
        <h2 className="text-xl font-medium mb-2">No Data Loaded</h2>
        <p className="max-w-md text-center">Import a PCF, CSV, or Excel file using the buttons in the header to populate the Data Table.</p>
      </div>
    );
  }

  const renderFixingAction = (row) => {
    if (!row.fixingAction) return <span className="text-slate-400">—</span>;

    const tierColors = {
      1: { bg: "bg-green-50", text: "text-green-800", border: "border-green-500", label: "AUTO T1" },
      2: { bg: "bg-amber-50", text: "text-amber-800", border: "border-amber-500", label: "FIX T2" },
      3: { bg: "bg-orange-50", text: "text-orange-800", border: "border-orange-500", label: "REVIEW T3" },
      4: { bg: "bg-red-50", text: "text-red-800", border: "border-red-500", label: "ERROR T4" },
    };

    let colors = tierColors[row.fixingActionTier] || tierColors[3];
    if (row._passApplied > 0) {
      colors = { bg: "bg-green-100", text: "text-green-900", border: "border-green-600", label: "FIX APPLIED" };
    }

    // Attempt to split into validation warning and proposal/action.
    // E.g., Validator puts "[V2] ERROR...", SmartFixer appends action.
    let validationMsg = row.fixingActionOriginalError || "";
    let actionMsg = row.fixingAction;

    // Check for our explicit multiline format: [Pass X] [Issue] ... \n[Proposal] ...
    const hasExplicitTags = actionMsg.includes('[Issue]') && actionMsg.includes('[Proposal]');

    if (hasExplicitTags) {
        const parts = actionMsg.split('\n[Proposal]');
        validationMsg = parts[0].replace(/^\[Pass\s*\w+\]\s*/i, '').replace('[Issue]', '').trim();
        actionMsg = parts[1] ? parts[1].trim() : "";
    } else if (!row.fixingActionOriginalError && (row.fixingAction.includes('ERROR') || row.fixingAction.includes('WARNING') || row.fixingAction.includes('Syntax Check'))) {
         // It's primarily a validation message or it hasn't been split yet
         if (row.fixingAction.includes('—')) {
             const parts = row.fixingAction.split('—');
             validationMsg = parts[0].trim();
             actionMsg = parts.slice(1).join('—').trim();

             // Check if actionMsg duplicates validationMsg (e.g. Cleared message)
             if (validationMsg.includes(actionMsg) || actionMsg.includes(validationMsg) || validationMsg.replace(/[^a-zA-Z0-9]/g, '') === actionMsg.replace(/[^a-zA-Z0-9]/g, '')) {
                 actionMsg = ""; // Prevent duplication
             }
         } else {
             validationMsg = row.fixingAction;
             actionMsg = "";
         }
    }

    if (actionMsg) {
        // Remove existing standard score patterns e.g. (Score: 10)
        actionMsg = actionMsg.replace(/\(Score:\s*[\d.]+\)/g, '').trim();
        // Catch inline 'Score 8 < 10' format that was persisting
        actionMsg = actionMsg.replace(/Score\s*[\d.]+(\s*<\s*\d+)?/gi, '').trim();
        // Catch any trailing [Pass X] that was persisting
        actionMsg = actionMsg.replace(/\[Pass\s*\d+A?\]/gi, '').trim();
        // Catch any trailing dots or dashes from previous replaces
        actionMsg = actionMsg.replace(/^[-\s]+|[-\s]+$/g, '').trim();
        if (!hasExplicitTags) {
            actionMsg = actionMsg.replace(/^\[Pass\s*\w+\]\s*/i, '').trim();
            const splitIdx = actionMsg.indexOf(':');
            if (splitIdx > -1 && splitIdx < 30) {
                actionMsg = actionMsg.substring(splitIdx + 1).trim();
            }
        }
    }

    let passPrefix = (row._passApplied === 2 || (row.fixingAction && row.fixingAction.includes('[Pass 2]'))) ? "[2nd Pass]" : "[1st Pass]";
    if (row.fixingAction && row.fixingAction.includes('[Pass 3A]')) passPrefix = "[3rd Pass]";

    // Final clean up for validationMsg
    if (validationMsg) {
        validationMsg = validationMsg.replace(/^\[Pass\s*\w+\]\s*/i, '').replace('[Issue]', '').trim();
        // Catch trailing pass identifiers
        validationMsg = validationMsg.replace(/\[Pass\s*\d+A?\]/gi, '').trim();
    }

    return (
      <div className={`${colors.bg} ${colors.text} border-l-4 ${colors.border} p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap rounded-r shadow-sm min-w-[280px]`}>
        <div className="font-semibold mb-1 flex items-start flex-col">
             {stage !== "1" && <span className="text-slate-600 mb-1 whitespace-nowrap">{passPrefix}</span>}
             <div className="flex-1 w-full">
                 {validationMsg && stage !== "1" && <span className="text-slate-500 mr-1 font-bold">[Issue]</span>}
                 <span className="font-normal">{validationMsg}</span>
             </div>
        </div>
        {actionMsg && (
            <div className={`mt-1`}>
                 <span className="font-bold mr-1 text-slate-500">{row._passApplied > 0 ? "[Action Taken]" : "[Proposal]"}</span>
                 <span className={`font-normal ${row._fixApproved === false ? "line-through opacity-70 text-blue-600" : ""}`}>{actionMsg}</span>
            </div>
        )}
        {stage !== "1" && row._passApplied === undefined && !row._isPassiveFix && actionMsg && (
             <div className="flex space-x-2 mt-2 items-center flex-wrap gap-y-1">
                {row._fixApproved === true ? (
                    <span className="text-green-600 font-bold flex items-center bg-green-50 px-2 py-1 rounded border border-green-200">✓ Approved</span>
                ) : row._fixApproved === false ? (
                    <span className="text-red-600 font-bold flex items-center bg-red-50 px-2 py-1 rounded border border-red-200">✗ Rejected</span>
                ) : (
                    <>
                        <button onClick={() => handleApprove(row._rowIndex, true)} className={`px-2 py-1 text-xs rounded shadow-sm transition-colors bg-white text-slate-700 hover:bg-slate-50 border border-slate-300 flex items-center font-medium`}><span className="text-green-600 mr-1 font-bold">✓</span> Approve</button>
                        <button onClick={() => handleApprove(row._rowIndex, false)} className={`px-2 py-1 text-xs rounded shadow-sm transition-colors bg-white text-slate-700 hover:bg-slate-50 border border-slate-300 flex items-center font-medium`}><span className="text-red-600 mr-1 font-bold">✗</span> Reject</button>
                        {row.fixingActionScore !== undefined && (
                            <span className="text-[10px] text-slate-500 ml-1 font-medium" title="Topology Engine Score">
                                (Score {Math.round(row.fixingActionScore)} {row.fixingActionScore < 10 ? '< 10' : ''})
                            </span>
                        )}
                    </>
                )}
            </div>
        )}
      </div>
    );
  };

  const fmtCoord = (c) => c ? `${c.x?.toFixed(1)}, ${c.y?.toFixed(1)}, ${c.z?.toFixed(1)}` : '—';
  const getCellClass = (row, field) => {
    if (row._modified && row._modified[field]) {
        // Color coding based on pass
        if (row._passApplied === 1) return 'bg-cyan-50 text-cyan-800 font-semibold';
        if (row._passApplied === 2) return 'bg-purple-50 text-purple-800 font-semibold';
        return 'bg-cyan-50 text-cyan-800 font-semibold';
    }
    if (row._modified && row._modified[field]) return 'bg-cyan-50 text-cyan-800 font-semibold';
    return 'text-slate-600';
  };

  return (
    <>
      <div className="mb-2 flex flex-col xl:flex-row justify-between xl:items-end gap-2">
        <div className="flex flex-col gap-1 text-xs font-medium w-full xl:w-auto">
            {stage !== "1" && (
                <>
                    <div className="flex flex-wrap gap-2 mb-1">
                        <div className="text-slate-600 bg-slate-100 px-3 py-1 rounded border border-slate-200 shadow-sm flex items-center">
                            Validation [Pass 1]:
                            <span className="text-red-600 ml-2 font-bold">Errors({fixingActionStats.errPass1})</span>,
                            <span className="text-orange-500 ml-2 font-bold">Warnings({fixingActionStats.warnPass1})</span>
                        </div>
                        <div className="text-slate-600 bg-indigo-50 px-3 py-1 rounded border border-indigo-200 shadow-sm flex items-center">
                            Smart Fixing Action [Pass 1]:
                            <span className="text-green-600 ml-2 font-bold">Approved({fixingActionStats.approvedP1})</span>,
                            <span className="text-slate-500 ml-2 font-bold">Rejected({fixingActionStats.rejectedP1})</span>,
                            <span className="text-amber-600 ml-2 font-bold">Pending({fixingActionStats.pendingP1})</span>
                        </div>
                    </div>
                    {(fixingActionStats.errPass2 > 0 || fixingActionStats.warnPass2 > 0 || fixingActionStats.approvedP2 > 0 || fixingActionStats.pendingP2 > 0) && (
                        <div className="flex flex-wrap gap-2">
                            <div className="text-slate-600 bg-slate-100 px-3 py-1 rounded border border-slate-200 shadow-sm flex items-center">
                                Validation [Pass 2]:
                                <span className="text-red-600 ml-2 font-bold">Errors({fixingActionStats.errPass2})</span>,
                                <span className="text-orange-500 ml-2 font-bold">Warnings({fixingActionStats.warnPass2})</span>
                            </div>
                            <div className="text-slate-600 bg-purple-50 px-3 py-1 rounded border border-purple-200 shadow-sm flex items-center">
                                Smart Fixing Action [Pass 2]:
                                <span className="text-green-600 ml-2 font-bold">Approved({fixingActionStats.approvedP2})</span>,
                                <span className="text-slate-500 ml-2 font-bold">Rejected({fixingActionStats.rejectedP2})</span>,
                                <span className="text-amber-600 ml-2 font-bold">Pending({fixingActionStats.pendingP2})</span>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
        <div className="flex flex-wrap items-center gap-2 bg-white px-2 py-1 rounded border border-slate-300 shadow-sm">
            {stage === "2" && (
                <button onClick={handlePullStage1} className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded text-xs font-bold border border-amber-200 transition-all shadow-sm mr-2 whitespace-nowrap">
                    📥 Pull from Stage 1
                </button>
            )}

            {stage !== "1" && (
                <div className="flex items-center space-x-2 border-r border-slate-200 pr-3 mr-1">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">FILTER:</span>
                    <select value={filterAction} onChange={e => setFilterAction(e.target.value)} className="text-sm bg-slate-50 text-slate-700 border-none outline-none cursor-pointer py-1 px-1 rounded font-medium">
                        <option value="ALL">All Rows</option>
                        <option value="HAS_FIXING_ACTION">Has Fixing Action</option>
                        <option value="ERRORS_WARNINGS">Errors & Warnings</option>
                        <option value="PROPOSALS">Smart Fix Proposals</option>
                        <option value="PENDING">Pending Approval</option>
                        <option value="APPROVED">Approved</option>
                        <option value="REJECTED">Rejected</option>
                    </select>
                </div>
            )}

            <div className="flex items-center space-x-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mr-1 hidden md:inline-block">Tools:</span>

                {stage === "1" && (
                    <>
                        <button onClick={handleCalculateMissingGeometry} className="px-2.5 py-1 bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-700 rounded text-xs font-semibold border border-transparent hover:border-blue-200 transition-all shadow-sm mr-1" title="Calculate missing bores, midpoints, and vectors">
                            <span className="mr-1">📐</span>Calc Missing Geo
                        </button>
                        <button onClick={handleValidateSyntax} className="px-2.5 py-1 bg-white hover:bg-teal-50 text-slate-600 hover:text-teal-700 rounded text-xs font-semibold border border-transparent hover:border-teal-200 transition-all shadow-sm mr-1" title="Run strict Data Table validation checks">
                            <span className="mr-1">🛡️</span>Check Syntax
                        </button>
                        <button onClick={handleSyntaxFix} className="px-2.5 py-1 bg-white hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 rounded text-xs font-semibold border border-transparent hover:border-indigo-200 transition-all shadow-sm" title="Standardize strings and fix basic syntax errors">
                            <span className="mr-1">🔧</span>Syntax Fix
                        </button>
                    </>
                )}

                {(stage === "2" || stage === "3") && (
                    <>
                        <button disabled className="px-2.5 py-1 bg-slate-50 text-slate-400 rounded text-xs font-semibold border border-slate-200 shadow-sm opacity-50 cursor-not-allowed" title="Run strict Data Table validation checks">
                            <span className="mr-1 opacity-50">🛡️</span>Validate Rules
                        </button>
                        <button disabled className="px-2.5 py-1 bg-slate-50 text-slate-400 rounded text-xs font-semibold border border-slate-200 shadow-sm opacity-50 cursor-not-allowed" title="Acknowledge and dismiss all current warnings">
                            <span className="mr-1 opacity-50">👁️‍🗨️</span>Ignore Warnings
                        </button>
                        <button onClick={handleAutoApproveAll} className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-xs font-bold border border-indigo-200 transition-all shadow-sm ml-2" title="Approve all Tier 1/2 automated fixes">
                            <span className="mr-1">⚡</span>Auto Approve (&lt;25mm)
                        </button>
                    </>
                )}

                {stage === "3" && (
                    <>
                        <button onClick={async () => {
                            try {
                                await exportToExcel(dataTable);
                                dispatch({ type: "ADD_LOG", payload: { type: "Info", message: "Exported Data Table to Excel." }});
                            } catch (err) {
                                dispatch({ type: "SET_STATUS_MESSAGE", payload: "Error exporting Excel: " + err.message });
                            }
                        }} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded text-xs font-bold border border-slate-900 transition-all shadow-sm ml-2">
                            Export Data Table ↓
                        </button>
                        <button onClick={() => {
                            const text = generatePCFText(dataTable, state.config);
                            const blob = new Blob([text], { type: 'text/plain' });
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'export.pcf';
                            a.click();
                            window.URL.revokeObjectURL(url);
                            dispatch({ type: "ADD_LOG", payload: { type: "Info", message: "Exported PCF file." }});
                        }} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded text-xs font-bold border border-slate-900 transition-all shadow-sm ml-1">
                            Export PCF ↓
                        </button>
                    </>
                )}
            </div>
        </div>
      </div>
  <div className="overflow-auto h-[calc(100vh-16rem)] border rounded shadow-sm bg-white relative">
      <table className="min-w-max divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-100 sticky top-0 z-20 shadow-sm whitespace-nowrap">
          <tr>
            {/* Identity & Reference */}
            <th className="px-3 py-2 text-left font-semibold text-slate-700 border-r border-slate-300 sticky left-0 z-30 bg-slate-100"># Row</th>
            <th className="px-3 py-2 text-left font-semibold text-slate-700 border-r border-slate-300 sticky left-[60px] z-30 bg-slate-100">CSV SEQ NO</th>
            <th className="px-3 py-2 text-left font-semibold text-slate-700 border-r border-slate-300 sticky left-[160px] z-30 bg-slate-100">Type</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200">TEXT (MSG)</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200">PIPELINE-REF</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200">REF NO.</th>

            {/* Geometry */}
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200 bg-blue-50/50">BORE</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200 bg-blue-50/50">EP1</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200 bg-blue-50/50">EP2</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200 bg-blue-50/50">CP</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200 bg-blue-50/50">BP</th>

            {/* Fitting & Support */}
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200">SKEY</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200">SUPPORT COOR</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200">SUPPORT GUID</th>

            {/* Smart Fix */}
            <th className="px-3 py-2 text-left font-semibold text-slate-700 border-r border-slate-300 bg-amber-50">Fixing Action</th>

            {/* Calculated Deltas & Lens */}
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200 bg-slate-50">LEN1</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200 bg-slate-50">AXIS1</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200 bg-slate-50">LEN2</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200 bg-slate-50">AXIS2</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200 bg-slate-50">LEN3</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200 bg-slate-50">AXIS3</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200 bg-slate-50">BRLEN</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200 bg-slate-50">DELTA X</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200 bg-slate-50">DELTA Y</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200 bg-slate-50">DELTA Z</th>

            {/* Derived & Pointers */}
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200">DIAMETER</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200">WALL_THICK</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200">BEND_PTR</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200">RIGID_PTR</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500 border-r border-slate-200">INT_PTR</th>

            {/* CAs */}
            {[1,2,3,4,5,6,7,8,9,10,97,98].map(n => (
                <th key={`ca${n}`} className="px-3 py-2 text-left font-medium text-slate-400 border-r border-slate-200">CA{n}</th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-slate-200">
          {filteredDataTable.map((row) => {
            const isDeleted = row._isDeleted || (row.fixingAction && row.fixingAction.includes('DELETE') && row._passApplied > 0);
            const rowClass = isDeleted ? 'bg-red-50/50 opacity-60 line-through' : 'bg-white hover:bg-slate-50 transition-colors';

            return (
            <tr key={row._rowIndex} className={`${rowClass} whitespace-nowrap`}>
              <td className={`px-3 py-2 text-slate-500 border-r border-slate-200 sticky left-0 z-10 font-mono ${isDeleted ? 'bg-red-50' : 'bg-white'}`}>{row._rowIndex}</td>
              <td className={`px-3 py-2 border-r border-slate-200 sticky left-[60px] z-10 font-mono ${getCellClass(row, 'csvSeqNo')} ${isDeleted ? 'bg-red-50' : 'bg-white'}`}>{row.csvSeqNo || '—'}</td>
              <td className={`px-3 py-2 font-medium text-slate-900 border-r border-slate-300 sticky left-[160px] z-10 ${isDeleted ? 'bg-red-50' : 'bg-white'}`}>{row.type}</td>
              <td className="px-3 py-2 text-slate-500 border-r border-slate-200 truncate max-w-[200px]" title={row.text}>{row.text || '—'}</td>
              <td className="px-3 py-2 text-slate-500 border-r border-slate-200">{row.pipelineRef || '—'}</td>
              <td className={`px-3 py-2 border-r border-slate-200 ${getCellClass(row, 'refNo')}`}>{row.refNo || '—'}</td>

              <td className={`px-3 py-2 font-mono border-r border-slate-200 ${getCellClass(row, 'bore')}`}>{row.bore || '—'}</td>
              <td className={`px-3 py-2 font-mono border-r border-slate-200 ${getCellClass(row, 'ep1')}`}>{fmtCoord(row.ep1)}</td>
              <td className={`px-3 py-2 font-mono border-r border-slate-200 ${getCellClass(row, 'ep2')}`}>{fmtCoord(row.ep2)}</td>
              <td className={`px-3 py-2 font-mono border-r border-slate-200 ${getCellClass(row, 'cp')}`}>{fmtCoord(row.cp)}</td>
              <td className={`px-3 py-2 font-mono border-r border-slate-200 ${getCellClass(row, 'bp')}`}>{fmtCoord(row.bp)}</td>

              <td className="px-3 py-2 font-mono text-slate-600 border-r border-slate-200">{row.skey || '—'}</td>
              <td className="px-3 py-2 font-mono text-slate-600 border-r border-slate-200">{fmtCoord(row.supportCoor)}</td>
              <td className="px-3 py-2 font-mono text-slate-600 border-r border-slate-200">{row.supportGuid || '—'}</td>

              <td className="px-3 py-2 border-r border-slate-200 align-top">{renderFixingAction(row)}</td>

              <td className="px-3 py-2 font-mono text-cyan-700 border-r border-slate-200 bg-slate-50/50">{row.len1?.toFixed(1) || '—'}</td>
              <td className="px-3 py-2 text-cyan-700 border-r border-slate-200 bg-slate-50/50">{row.axis1 || '—'}</td>
              <td className="px-3 py-2 font-mono text-cyan-700 border-r border-slate-200 bg-slate-50/50">{row.len2?.toFixed(1) || '—'}</td>
              <td className="px-3 py-2 text-cyan-700 border-r border-slate-200 bg-slate-50/50">{row.axis2 || '—'}</td>
              <td className="px-3 py-2 font-mono text-cyan-700 border-r border-slate-200 bg-slate-50/50">{row.len3?.toFixed(1) || '—'}</td>
              <td className="px-3 py-2 text-cyan-700 border-r border-slate-200 bg-slate-50/50">{row.axis3 || '—'}</td>
              <td className="px-3 py-2 font-mono text-cyan-700 border-r border-slate-200 bg-slate-50/50">{row.brlen?.toFixed(1) || '—'}</td>
              <td className="px-3 py-2 font-mono text-cyan-700 border-r border-slate-200 bg-slate-50/50">{row.deltaX?.toFixed(1) || '—'}</td>
              <td className="px-3 py-2 font-mono text-cyan-700 border-r border-slate-200 bg-slate-50/50">{row.deltaY?.toFixed(1) || '—'}</td>
              <td className="px-3 py-2 font-mono text-cyan-700 border-r border-slate-200 bg-slate-50/50">{row.deltaZ?.toFixed(1) || '—'}</td>

              <td className="px-3 py-2 text-slate-500 border-r border-slate-200">{row.diameter || '—'}</td>
              <td className="px-3 py-2 text-slate-500 border-r border-slate-200">{row.wallThick || '—'}</td>
              <td className="px-3 py-2 font-mono text-slate-400 border-r border-slate-200">{row.bendPtr || '—'}</td>
              <td className="px-3 py-2 font-mono text-slate-400 border-r border-slate-200">{row.rigidPtr || '—'}</td>
              <td className="px-3 py-2 font-mono text-slate-400 border-r border-slate-200">{row.intPtr || '—'}</td>

              {[1,2,3,4,5,6,7,8,9,10,97,98].map(n => (
                  <td key={`ca${n}`} className="px-3 py-2 text-slate-500 border-r border-slate-200">{row.ca?.[n] || '—'}</td>
              ))}
            </tr>
          )})}
        </tbody>
          </table>
    </div>
    </>
  );
}
