import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { useAppContext } from '../../store/AppContext';

export const SupportPropertyPanel = () => {
  const { dispatch } = useAppContext();
  const dataTable = useStore(state => state.dataTable);
  const multiSelectedIds = useStore(state => state.multiSelectedIds);
  const clearMultiSelect = useStore(state => state.clearMultiSelect);
  const deleteElements = useStore(state => state.deleteElements);
  const pushHistory = useStore(state => state.pushHistory);

  const [attrs, setAttrs] = useState({ SUPPORT_NAME: '', CA1: '', CA2: '', CA3: '' });

  const selectedSupports = multiSelectedIds.filter(id => {
    const row = dataTable.find(r => r._rowIndex === id);
    return row && (row.type || '').toUpperCase() === 'SUPPORT';
  });

  const isVisible = multiSelectedIds.length > 0 && selectedSupports.length === multiSelectedIds.length;

  useEffect(() => {
    if (isVisible && selectedSupports.length > 0) {
      const firstSupport = dataTable.find(r => r._rowIndex === selectedSupports[0]);
      if (firstSupport) {
        setAttrs({
          SUPPORT_NAME: firstSupport.skey || '',
          CA1: firstSupport.CA1 || '',
          CA2: firstSupport.CA2 || '',
          CA3: firstSupport.CA3 || ''
        });
      }
    }
  }, [isVisible, selectedSupports, dataTable]);

  const handleApply = () => {
    pushHistory('Support Attr Edit');

    const mappedAttrs = {
      skey: attrs.SUPPORT_NAME,
      CA1: attrs.CA1,
      CA2: attrs.CA2,
      CA3: attrs.CA3
    };

    // Dispatch to AppContext
    dispatch({
      type: 'BATCH_UPDATE_SUPPORT_ATTRS',
      payload: { rowIndices: selectedSupports, attrs: mappedAttrs }
    });

    // Mirror to Zustand
    const updatedTable = dataTable.map(r =>
      selectedSupports.includes(r._rowIndex) ? { ...r, ...mappedAttrs } : r
    );
    useStore.getState().setDataTable(updatedTable);

    dispatch({ type: "ADD_LOG", payload: { stage: "BATCH_EDIT", type: "Applied/Fix", message: `Batch updated CA attributes for ${selectedSupports.length} supports.` } });
    clearMultiSelect();
  };

  const handleDelete = () => {
    if (window.confirm(`Delete ${selectedSupports.length} supports?`)) {
      pushHistory('Delete Supports');

      dispatch({
        type: 'DELETE_ELEMENTS',
        payload: { rowIndices: selectedSupports }
      });

      // Mirror to Zustand
      const updatedTable = dataTable
        .filter(r => !selectedSupports.includes(r._rowIndex))
        .map((row, idx) => ({ ...row, _rowIndex: idx + 1 })); // Re-index after delete
      useStore.getState().setDataTable(updatedTable);

      dispatch({ type: "ADD_LOG", payload: { stage: "BATCH_DELETE", type: "Applied/Fix", message: `Deleted ${selectedSupports.length} supports.` } });
      clearMultiSelect();
    }
  };

  if (!isVisible) return null;

  return (
    <div className="absolute bottom-16 left-4 z-20 w-64 bg-slate-900 border border-slate-700 shadow-2xl rounded-lg overflow-hidden flex flex-col transition-all">
      <div className="bg-slate-800 p-3 border-b border-slate-700 flex justify-between items-center">
        <span className="text-slate-200 font-bold text-sm">{selectedSupports.length} Supports Selected</span>
        <button onClick={clearMultiSelect} className="text-slate-400 hover:text-white" title="Deselect All">✕</button>
      </div>

      <div className="p-4 space-y-3">
        {['SUPPORT_NAME', 'CA1', 'CA2', 'CA3'].map(attr => (
          <div key={attr} className="flex flex-col gap-1">
            <label className="text-xs text-slate-400 uppercase font-medium">{attr.replace('_', ' ')}</label>
            <input
              type="text"
              value={attrs[attr]}
              onChange={e => setAttrs({ ...attrs, [attr]: e.target.value })}
              className="bg-slate-950 text-slate-200 text-sm p-2 rounded border border-slate-700 focus:border-blue-500 transition-colors"
              placeholder={`Enter ${attr.replace('_', ' ')}`}
            />
          </div>
        ))}
      </div>

      <div className="p-3 bg-slate-800/50 border-t border-slate-700 flex flex-col gap-2">
        <button
          onClick={handleApply}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 rounded text-sm transition-colors"
        >
          Apply to All
        </button>
        <button
          onClick={handleDelete}
          className="w-full bg-red-900/40 hover:bg-red-900/80 text-red-400 font-medium py-1.5 rounded text-sm border border-red-800/50 transition-colors"
        >
          Delete Selected
        </button>
      </div>
    </div>
  );
};
