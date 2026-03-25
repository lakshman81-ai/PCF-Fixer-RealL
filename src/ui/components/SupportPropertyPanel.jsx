import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { useAppContext } from '../../store/AppContext';

export const SupportPropertyPanel = () => {
    const multiSelectedIds = useStore(state => state.multiSelectedIds);
    const dataTable = useStore(state => state.dataTable);
    const pushHistory = useStore(state => state.pushHistory);
    const deleteElements = useStore(state => state.deleteElements);
    const clearMultiSelect = useStore(state => state.clearMultiSelect);
    const { dispatch } = useAppContext();

    const [isCollapsed, setIsCollapsed] = useState(false);
    const [attrs, setAttrs] = useState({ CA1: '', CA2: '', CA3: '', CA4: '', CA5: '', CA6: '', CA7: '', CA8: '', CA9: '', CA10: '' });

    // Determine if we should show this panel
    const selectedSupports = multiSelectedIds
        .map(id => dataTable.find(r => r._rowIndex === id))
        .filter(el => el && (el.type || '').toUpperCase() === 'SUPPORT');

    const isVisible = selectedSupports.length > 0 && selectedSupports.length === multiSelectedIds.length;

    // Reset attrs when selection changes
    useEffect(() => {
        if (isVisible) {
            // Find common attributes to populate inputs
            const first = selectedSupports[0];
            let commonCA1 = first.CA1 || '';
            let commonCA2 = first.CA2 || '';
            let commonCA3 = first.CA3 || '';
            let commonCA4 = first.CA4 || '';
            let commonCA5 = first.CA5 || '';
            let commonCA6 = first.CA6 || '';
            let commonCA7 = first.CA7 || '';
            let commonCA8 = first.CA8 || '';
            let commonCA9 = first.CA9 || '';
            let commonCA10 = first.CA10 || '';

            // If attributes vary among selection, set placeholder to blank
            for (let i = 1; i < selectedSupports.length; i++) {
                if (selectedSupports[i].CA1 !== commonCA1) commonCA1 = '';
                if (selectedSupports[i].CA2 !== commonCA2) commonCA2 = '';
                if (selectedSupports[i].CA3 !== commonCA3) commonCA3 = '';
                if (selectedSupports[i].CA4 !== commonCA4) commonCA4 = '';
                if (selectedSupports[i].CA5 !== commonCA5) commonCA5 = '';
                if (selectedSupports[i].CA6 !== commonCA6) commonCA6 = '';
                if (selectedSupports[i].CA7 !== commonCA7) commonCA7 = '';
                if (selectedSupports[i].CA8 !== commonCA8) commonCA8 = '';
                if (selectedSupports[i].CA9 !== commonCA9) commonCA9 = '';
                if (selectedSupports[i].CA10 !== commonCA10) commonCA10 = '';
            }

            setAttrs({ CA1: commonCA1, CA2: commonCA2, CA3: commonCA3, CA4: commonCA4, CA5: commonCA5, CA6: commonCA6, CA7: commonCA7, CA8: commonCA8, CA9: commonCA9, CA10: commonCA10 });
            setIsCollapsed(false); // Auto open
        }
    }, [multiSelectedIds, isVisible]);

    if (!isVisible) return null;

    const handleApply = () => {
        pushHistory('Support Attr Edit');

        // Clean attrs (only apply non-empty)
        const updates = {};
        if (attrs.CA1) updates.CA1 = attrs.CA1;
        if (attrs.CA2) updates.CA2 = attrs.CA2;
        if (attrs.CA3) updates.CA3 = attrs.CA3;
        if (attrs.CA4) updates.CA4 = attrs.CA4;
        if (attrs.CA5) updates.CA5 = attrs.CA5;
        if (attrs.CA6) updates.CA6 = attrs.CA6;
        if (attrs.CA7) updates.CA7 = attrs.CA7;
        if (attrs.CA8) updates.CA8 = attrs.CA8;
        if (attrs.CA9) updates.CA9 = attrs.CA9;
        if (attrs.CA10) updates.CA10 = attrs.CA10;

        dispatch({
            type: 'BATCH_UPDATE_SUPPORT_ATTRS',
            payload: { rowIndices: multiSelectedIds, attrs: updates }
        });

        // Mirror to Zustand
        const updatedTable = dataTable.map(r =>
            multiSelectedIds.includes(r._rowIndex) ? { ...r, ...updates } : r
        );
        useStore.getState().setDataTable(updatedTable);

        dispatch({ type: "ADD_LOG", payload: { stage: "INTERACTIVE", type: "Applied/Fix", message: `Batch updated ${selectedSupports.length} supports.` } });
        clearMultiSelect();
    };

    const handleDelete = () => {
        if (window.confirm(`Delete ${selectedSupports.length} supports?`)) {
            pushHistory('Delete Supports');

            dispatch({ type: 'DELETE_ELEMENTS', payload: { rowIndices: multiSelectedIds } });
            deleteElements(multiSelectedIds);

            dispatch({ type: "ADD_LOG", payload: { stage: "INTERACTIVE", type: "Applied/Fix", message: `Deleted ${selectedSupports.length} supports.` } });
        }
    };

    return (
        <div className={`absolute bottom-12 left-4 z-20 flex flex-col items-start transition-transform duration-300 ${isCollapsed ? 'translate-y-64' : 'translate-y-0'}`}>

            {/* Collapse Toggle Handle */}
            <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="bg-slate-800 border-x border-t border-slate-700 px-3 py-1 rounded-t-md text-slate-400 hover:text-white shadow-lg flex items-center gap-2 text-xs font-bold"
            >
                {isCollapsed ? '▲ SUPPORT PROPERTIES' : '▼ SUPPORT PROPERTIES'}
            </button>

            <div className="w-80 bg-slate-900/95 border border-slate-700 rounded-b-lg rounded-tr-lg shadow-2xl backdrop-blur-md flex flex-col">

                {/* Header */}
                <div className="flex justify-between items-center p-3 border-b border-slate-700 bg-slate-800/50">
                    <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-slate-600 text-white">
                            {selectedSupports.length} Selected
                        </span>
                        <span className="text-slate-300 text-sm font-bold">Supports</span>
                    </div>
                    <button onClick={clearMultiSelect} className="text-slate-400 hover:text-white p-1 rounded transition">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                {/* Form Body */}
                <div className="p-4 grid grid-cols-2 gap-3 max-h-[300px] overflow-y-auto custom-scrollbar">
                    {['CA1', 'CA2', 'CA3', 'CA4', 'CA5', 'CA6', 'CA7', 'CA8', 'CA9', 'CA10'].map(ca => (
                        <div key={ca} className="flex flex-col gap-1">
                            <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">{ca}</span>
                            <input
                                type="text"
                                value={attrs[ca]}
                                onChange={(e) => setAttrs({ ...attrs, [ca]: e.target.value })}
                                placeholder="-- Varying --"
                                className="bg-slate-950 border border-slate-700 text-slate-300 text-xs px-2 py-1.5 rounded outline-none focus:border-indigo-500 transition-colors"
                            />
                        </div>
                    ))}
                </div>

                {/* Footer Actions */}
                <div className="p-3 border-t border-slate-700 bg-slate-800/50 rounded-b-lg flex gap-2">
                    <button
                        onClick={handleApply}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs py-2 rounded transition font-bold"
                    >
                        Apply to All
                    </button>
                    <button
                        onClick={handleDelete}
                        className="bg-red-900/40 hover:bg-red-800 text-red-400 hover:text-white border border-red-800/50 text-xs px-4 py-2 rounded transition font-bold"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};