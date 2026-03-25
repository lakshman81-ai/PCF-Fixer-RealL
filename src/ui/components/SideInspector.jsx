import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { useAppContext } from '../../store/AppContext';

export const SideInspector = () => {
  const { state: appState, dispatch } = useAppContext();
  const selectedElementId = useStore(state => state.selectedElementId);
  const dataTable = useStore(state => state.dataTable);
  const setSelected = useStore(state => state.setSelected);
  const pushHistory = useStore(state => state.pushHistory);

  const [formData, setFormData] = useState(null);
  const [isChanged, setIsChanged] = useState(false);

  useEffect(() => {
    if (selectedElementId) {
      const el = dataTable.find(r => r._rowIndex === selectedElementId);
      if (el) {
        setFormData({
          ep1: el.ep1 ? { ...el.ep1 } : null,
          ep2: el.ep2 ? { ...el.ep2 } : null,
          cp: el.cp ? { ...el.cp } : null,
          bp: el.bp ? { ...el.bp } : null,
          bore: el.bore || '',
          CA1: el.CA1 || '',
          CA2: el.CA2 || '',
          CA3: el.CA3 || '',
          CA4: el.CA4 || '',
          CA5: el.CA5 || '',
          CA6: el.CA6 || '',
          CA7: el.CA7 || '',
          CA8: el.CA8 || '',
          CA9: el.CA9 || '',
          CA10: el.CA10 || '',
          CA97: el.CA97 || '',
          CA98: el.CA98 || '',
          PIPING_CLASS: el.PIPING_CLASS || '',
          RATING: el.RATING || '',
          LINENO_KEY: el.LINENO_KEY || '',
          skey: el.skey || '',
          pipelineRef: el.pipelineRef || '',
          type: el.type || '',
          _rowIndex: el._rowIndex
        });
        setIsChanged(false);
      }
    } else {
      setFormData(null);
    }
  }, [selectedElementId, dataTable]);

  const handleChange = (field, subfield, value) => {
    setFormData(prev => {
      const updated = { ...prev };
      if (subfield) {
        updated[field] = { ...updated[field], [subfield]: parseFloat(value) || value };
      } else {
        updated[field] = value;
      }
      return updated;
    });
    setIsChanged(true);
  };

  const handleApply = () => {
    if (!formData) return;

    pushHistory('Inspector Edit');

    // Update both stores
    dispatch({
      type: 'UPDATE_STAGE2_ROW_COORDS',
      payload: {
        rowIndex: formData._rowIndex,
        coords: formData
      }
    });

    const updatedTable = dataTable.map(r =>
      r._rowIndex === formData._rowIndex ? { ...r, ...formData } : r
    );
    useStore.getState().setDataTable(updatedTable);

    dispatch({ type: "ADD_LOG", payload: { stage: "INSPECTOR", type: "Applied/Fix", message: `Updated properties for row ${formData._rowIndex}.` } });

    setIsChanged(false);
  };

  const copyCoords = () => {
    if (!formData) return;
    const { ep1, ep2 } = formData;
    let text = `Row ${formData._rowIndex}\n`;
    if (ep1) text += `EP1: (${ep1.x}, ${ep1.y}, ${ep1.z})\n`;
    if (ep2) text += `EP2: (${ep2.x}, ${ep2.y}, ${ep2.z})`;
    navigator.clipboard.writeText(text);
    // Optional: toast here
  };

  const handleZoomToSelection = () => {
    if (!formData) return;
    const { ep1, ep2 } = formData;

    // Fallback if no EPs
    if (!ep1 && !ep2) return;

    let midX, midY, midZ, distance;

    if (ep1 && ep2) {
        midX = (ep1.x + ep2.x) / 2;
        midY = (ep1.y + ep2.y) / 2;
        midZ = (ep1.z + ep2.z) / 2;

        const dx = ep1.x - ep2.x;
        const dy = ep1.y - ep2.y;
        const dz = ep1.z - ep2.z;
        distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
    } else {
        const pt = ep1 || ep2;
        midX = pt.x;
        midY = pt.y;
        midZ = pt.z;
        distance = 1000;
    }

    // Prevent zero distance causing issues
    if (distance < 500) distance = 1000;

    window.dispatchEvent(new CustomEvent('canvas-focus-point', { detail: { x: midX, y: midY, z: midZ, dist: distance } }));
  };

  if (!selectedElementId || !formData) return null;

  return (
    <div className={`absolute top-4 left-4 z-20 w-72 bg-slate-900 border border-slate-700 shadow-2xl rounded-lg overflow-hidden transition-transform transform translate-x-0 flex flex-col max-h-[calc(100vh-6rem)]`}>
      {/* Header */}
      <div className="flex justify-between items-center bg-slate-800 p-3 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-100 bg-blue-600 px-2 py-0.5 rounded uppercase">{formData.type}</span>
          <span className="text-slate-400 text-xs">Row {formData._rowIndex}</span>
        </div>
        <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-white" title="Deselect">
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="p-4 flex-1 overflow-y-auto space-y-4">

        {/* Actions */}
        <div className="flex justify-between gap-2">
            <button
                onClick={handleZoomToSelection}
                className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs py-1.5 rounded transition"
            >
                🔍 Zoom to Selection
            </button>
        </div>

        {/* Endpoints */}
        <div className="space-y-2">
          <h3 className="text-slate-300 text-sm font-semibold border-b border-slate-700 pb-1 flex justify-between">
            Endpoints
            <button onClick={copyCoords} className="text-xs text-blue-400 hover:text-blue-300" title="Copy Coords">📋 Copy</button>
          </h3>
          {['ep1', 'ep2', 'cp', 'bp'].map(ep => formData[ep] && (
            <div key={ep} className="bg-slate-800/50 p-2 rounded">
              <span className="text-xs text-slate-400 uppercase">{ep}</span>
              <div className="grid grid-cols-3 gap-1 mt-1">
                {['x', 'y', 'z'].map(axis => (
                  <input
                    key={axis}
                    type="number"
                    value={formData[ep][axis] || 0}
                    onChange={(e) => handleChange(ep, axis, e.target.value)}
                    className="w-full bg-slate-950 text-slate-200 text-xs p-1 rounded border border-slate-700 focus:border-blue-500"
                    placeholder={axis.toUpperCase()}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Attributes */}
        <div className="space-y-2">
          <h3 className="text-slate-300 text-sm font-semibold border-b border-slate-700 pb-1">Attributes</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Bore</label>
              <input type="number" value={formData.bore} onChange={(e) => handleChange('bore', null, e.target.value)} className="bg-slate-950 text-slate-200 text-xs p-1 rounded border border-slate-700" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Pipeline Ref</label>
              <input type="text" value={formData.pipelineRef} onChange={(e) => handleChange('pipelineRef', null, e.target.value)} className="bg-slate-950 text-slate-200 text-xs p-1 rounded border border-slate-700" />
            </div>
            {['skey', 'PIPING_CLASS', 'RATING', 'LINENO_KEY'].map(attr => (
              <div key={attr} className="flex flex-col gap-1">
                <label className="text-xs text-slate-400 truncate" title={attr}>{attr}</label>
                <input type="text" value={formData[attr]} onChange={(e) => handleChange(attr, null, e.target.value)} className="bg-slate-950 text-slate-200 text-xs p-1 rounded border border-slate-700" />
              </div>
            ))}
            {['CA97', 'CA98', 'CA1', 'CA2', 'CA3', 'CA4', 'CA5', 'CA6', 'CA7', 'CA8', 'CA9', 'CA10'].map(attr => (
              <div key={attr} className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">{attr}</label>
                <input type="text" value={formData[attr]} onChange={(e) => handleChange(attr, null, e.target.value)} className="bg-slate-950 text-slate-200 text-xs p-1 rounded border border-slate-700" />
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Footer */}
      <div className="p-3 bg-slate-800 border-t border-slate-700 flex justify-end">
        <button
          onClick={handleApply}
          disabled={!isChanged}
          className={`px-4 py-1.5 rounded text-sm font-medium transition ${isChanged ? 'bg-amber-600 hover:bg-amber-500 text-white' : 'bg-slate-700 text-slate-400 cursor-not-allowed'}`}
        >
          {isChanged ? 'Apply Changes' : 'Applied'}
        </button>
      </div>
    </div>
  );
};
