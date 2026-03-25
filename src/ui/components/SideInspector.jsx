import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { useAppContext } from '../../store/AppContext';

export const SideInspector = () => {
    const selectedElementId = useStore(state => state.selectedElementId);
    const dataTable = useStore(state => state.dataTable);
    const pushHistory = useStore(state => state.pushHistory);
    const setSelected = useStore(state => state.setSelected);
    const { dispatch } = useAppContext();

    const [isCollapsed, setIsCollapsed] = useState(false);
    const [formData, setFormData] = useState(null);

    // Sync formData when selection changes
    useEffect(() => {
        if (selectedElementId) {
            const el = dataTable.find(r => r._rowIndex === selectedElementId);
            if (el) setFormData(JSON.parse(JSON.stringify(el)));
            else setFormData(null);
            setIsCollapsed(false); // Auto-open on new selection
        } else {
            setFormData(null);
        }
    }, [selectedElementId, dataTable]);

    if (!selectedElementId || !formData) return null;

    const handleInputChange = (field, subfield, value) => {
        setFormData(prev => {
            const next = { ...prev };
            if (subfield) {
                if (!next[field]) next[field] = {};
                next[field][subfield] = value;
            } else {
                next[field] = value;
            }
            return next;
        });
    };

    const handleApply = () => {
        pushHistory('Inspector Edit');

        // Ensure coordinates are numbers
        const cleanedData = { ...formData };
        ['ep1', 'ep2', 'cp', 'bp'].forEach(epKey => {
            if (cleanedData[epKey]) {
                cleanedData[epKey] = {
                    x: parseFloat(cleanedData[epKey].x) || 0,
                    y: parseFloat(cleanedData[epKey].y) || 0,
                    z: parseFloat(cleanedData[epKey].z) || 0,
                };
            }
        });

        // Update Zustand
        const updatedTable = dataTable.map(r => r._rowIndex === cleanedData._rowIndex ? cleanedData : r);
        useStore.getState().setDataTable(updatedTable);

        // Update AppContext
        dispatch({
            type: "UPDATE_STAGE2_ROW_COORDS",
            payload: {
                rowIndex: cleanedData._rowIndex,
                coords: {
                    ep1: cleanedData.ep1,
                    ep2: cleanedData.ep2,
                    cp: cleanedData.cp,
                    bp: cleanedData.bp
                }
            }
        });

        // Since we also allow attribute edits, we should just dispatch a full replace for simplicity,
        // or a specific attribute update. Let's do a full replace via APPLY_GAP_FIX which replaces the whole table.
        dispatch({ type: 'APPLY_GAP_FIX', payload: { updatedTable } });

        dispatch({ type: "ADD_LOG", payload: { stage: "INTERACTIVE", type: "Applied/Fix", message: `Updated Row ${cleanedData._rowIndex} via Inspector.` } });
    };

    const handleCopy = () => {
        let text = `Row ${formData._rowIndex} (${formData.type})\n`;
        if (formData.ep1) text += `EP1: ${formData.ep1.x}, ${formData.ep1.y}, ${formData.ep1.z}\n`;
        if (formData.ep2) text += `EP2: ${formData.ep2.x}, ${formData.ep2.y}, ${formData.ep2.z}\n`;
        navigator.clipboard.writeText(text);
        dispatch({ type: "ADD_LOG", payload: { stage: "UI", type: "Info", message: "Coordinates copied to clipboard." } });
    };

    const CoordInput = ({ label, field, subfield }) => {
        const val = formData[field] ? formData[field][subfield] : '';
        const originalVal = dataTable.find(r => r._rowIndex === formData._rowIndex)?.[field]?.[subfield];
        const isChanged = val != originalVal;

        return (
            <div className="flex items-center gap-2 mb-1">
                <span className="text-slate-400 w-4 text-xs">{label}</span>
                <input
                    type="number"
                    value={val}
                    onChange={(e) => handleInputChange(field, subfield, e.target.value)}
                    className={`flex-1 bg-slate-950 border ${isChanged ? 'border-amber-500 text-amber-400' : 'border-slate-700 text-slate-300'} text-xs px-2 py-1 rounded outline-none focus:border-indigo-500`}
                />
            </div>
        );
    };

    const AttrInput = ({ label, field }) => {
        const val = formData[field] || '';
        const originalVal = dataTable.find(r => r._rowIndex === formData._rowIndex)?.[field] || '';
        const isChanged = val != originalVal;

        return (
            <div className="flex items-center gap-2 mb-1">
                <span className="text-slate-400 w-16 text-xs">{label}</span>
                <input
                    type="text"
                    value={val}
                    onChange={(e) => handleInputChange(field, null, e.target.value)}
                    className={`flex-1 bg-slate-950 border ${isChanged ? 'border-amber-500 text-amber-400' : 'border-slate-700 text-slate-300'} text-xs px-2 py-1 rounded outline-none focus:border-indigo-500`}
                />
            </div>
        );
    };

    return (
        <div className={`absolute top-4 left-4 z-20 flex transition-transform duration-300 ${isCollapsed ? '-translate-x-[18rem]' : 'translate-x-0'}`}>
            <div className="w-72 bg-slate-900/95 border border-slate-700 rounded-lg shadow-2xl backdrop-blur-md flex flex-col max-h-[calc(100vh-6rem)]">

                {/* Header */}
                <div className="flex justify-between items-center p-3 border-b border-slate-700 bg-slate-800/50 rounded-t-lg">
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-indigo-600 text-white">
                            {formData.type}
                        </span>
                        <span className="text-slate-300 text-sm font-bold">Row {formData._rowIndex}</span>
                    </div>
                    <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-white p-1 rounded transition">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                <div className="p-3 overflow-y-auto custom-scrollbar">
                    {/* Endpoints */}
                    <div className="mb-4">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Endpoints</h3>
                            <button onClick={handleCopy} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                Copy
                            </button>
                        </div>
                        {formData.ep1 && (
                            <div className="mb-2 p-2 bg-slate-800/50 rounded border border-slate-700/50">
                                <div className="text-[10px] text-slate-500 mb-1">EP1</div>
                                <CoordInput label="X" field="ep1" subfield="x" />
                                <CoordInput label="Y" field="ep1" subfield="y" />
                                <CoordInput label="Z" field="ep1" subfield="z" />
                            </div>
                        )}
                        {formData.ep2 && (
                            <div className="mb-2 p-2 bg-slate-800/50 rounded border border-slate-700/50">
                                <div className="text-[10px] text-slate-500 mb-1">EP2</div>
                                <CoordInput label="X" field="ep2" subfield="x" />
                                <CoordInput label="Y" field="ep2" subfield="y" />
                                <CoordInput label="Z" field="ep2" subfield="z" />
                            </div>
                        )}
                    </div>

                    {/* Attributes */}
                    <div>
                        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">Attributes</h3>
                        <div className="p-2 bg-slate-800/50 rounded border border-slate-700/50">
                            <AttrInput label="Bore" field="bore" />
                            <AttrInput label="Pipe Ref" field="pipelineRef" />
                            <AttrInput label="SKEY" field="skey" />
                            <AttrInput label="CA1" field="CA1" />
                            <AttrInput label="CA2" field="CA2" />
                            <AttrInput label="CA3" field="CA3" />
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="p-3 border-t border-slate-700 bg-slate-800/50 rounded-b-lg flex gap-2">
                    <button
                        onClick={handleApply}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-sm py-1.5 rounded transition font-medium"
                    >
                        Apply Changes
                    </button>
                </div>
            </div>

            {/* Collapse Toggle Handle */}
            <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="absolute top-1/2 -right-6 -translate-y-1/2 bg-slate-800 border-y border-r border-slate-700 p-1 rounded-r-md text-slate-400 hover:text-white shadow-lg"
            >
                {isCollapsed ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                )}
            </button>
        </div>
    );
};
