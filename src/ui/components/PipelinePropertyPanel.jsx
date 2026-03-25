import React, { useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { useAppContext } from '../../store/AppContext';

export const PipelinePropertyPanel = () => {
  const { dispatch } = useAppContext();
  const dataTable = useStore(state => state.dataTable);
  const multiSelectedIds = useStore(state => state.multiSelectedIds);
  const clearMultiSelect = useStore(state => state.clearMultiSelect);
  const canvasMode = useStore(state => state.canvasMode);
  const pushHistory = useStore(state => state.pushHistory);

  const [pipelineRef, setPipelineRef] = useState('');

  // Collect all unique pipeline refs for the dropdown
  const uniquePipelineRefs = useMemo(() => {
    const refs = new Set();
    dataTable.forEach(row => {
      if (row.pipelineRef) {
        refs.add(row.pipelineRef);
      }
    });
    return Array.from(refs).sort();
  }, [dataTable]);

  const isVisible = canvasMode === 'ASSIGN_PIPELINE' && multiSelectedIds.length > 0;

  const handleApply = () => {
    if (!pipelineRef.trim()) return;

    pushHistory('Assign Pipeline Ref');

    // Dispatch to AppContext (we can use BATCH_UPDATE_SUPPORT_ATTRS logic, just call it BATCH_UPDATE_ATTRS)
    dispatch({
      type: 'BATCH_UPDATE_SUPPORT_ATTRS', // Reusing this reducer since it does what we need (maps and applies attrs)
      payload: { rowIndices: multiSelectedIds, attrs: { pipelineRef } }
    });

    // Mirror to Zustand
    const updatedTable = dataTable.map(r =>
      multiSelectedIds.includes(r._rowIndex) ? { ...r, pipelineRef } : r
    );
    useStore.getState().setDataTable(updatedTable);

    dispatch({ type: "ADD_LOG", payload: { stage: "BATCH_EDIT", type: "Applied/Fix", message: `Assigned Pipeline Ref '${pipelineRef}' to ${multiSelectedIds.length} elements.` } });
    clearMultiSelect();
  };

  if (!isVisible) return null;

  return (
    <div className="absolute bottom-16 left-1/2 transform -translate-x-1/2 z-20 w-80 bg-slate-900 border border-slate-700 shadow-2xl rounded-lg overflow-hidden flex flex-col transition-all">
      <div className="bg-slate-800 p-3 border-b border-slate-700 flex justify-between items-center">
        <span className="text-slate-200 font-bold text-sm">Assign Pipeline Ref to {multiSelectedIds.length} Items</span>
        <button onClick={clearMultiSelect} className="text-slate-400 hover:text-white" title="Deselect All">✕</button>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-400 uppercase font-medium">Select Existing or Type New</label>

          <input
            type="text"
            list="pipeline-refs"
            value={pipelineRef}
            onChange={e => setPipelineRef(e.target.value)}
            className="w-full bg-slate-950 text-slate-200 text-sm p-2 rounded border border-slate-700 focus:border-blue-500 transition-colors"
            placeholder="e.g. 150-CS-1000"
          />
          <datalist id="pipeline-refs">
            {uniquePipelineRefs.map(ref => (
              <option key={ref} value={ref} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="p-3 bg-slate-800/50 border-t border-slate-700 flex justify-end">
        <button
          onClick={handleApply}
          disabled={!pipelineRef.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium px-4 py-2 rounded text-sm transition-colors"
        >
          Assign to Selected
        </button>
      </div>
    </div>
  );
};
