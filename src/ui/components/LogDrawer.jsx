import React, { useState, useEffect } from 'react';
import { useAppContext } from '../../store/AppContext';

export const LogDrawer = () => {
  const { state } = useAppContext();
  const [isExpanded, setIsExpanded] = useState(false);

  // Auto-expand when a new Error or Warning entry is pushed
  useEffect(() => {
    if (state.log && state.log.length > 0) {
      const lastLog = state.log[state.log.length - 1];
      if (lastLog && (lastLog.type === 'Error' || lastLog.type === 'Warning' || lastLog.tier <= 2)) {
        setIsExpanded(true);
      }
    }
  }, [state.log]);

  const toggleExpand = () => setIsExpanded(!isExpanded);

  const getLogColor = (type, tier) => {
    if (type === 'Error' || tier <= 2) return 'text-red-400';
    if (type === 'Warning' || tier === 3) return 'text-yellow-300';
    if (type === 'Applied/Fix' || type === 'Fix') return 'text-green-400';
    return 'text-slate-400';
  };

  const logsToDisplay = (state.log || []).slice(-25).reverse();

  return (
    <div className={`absolute bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-700 shadow-[0_-4px_15px_rgba(0,0,0,0.5)] transition-all duration-300 ease-in-out z-30 flex flex-col ${isExpanded ? 'h-40' : 'h-8'}`}>

      {/* Header Tab */}
      <div
        className="flex justify-between items-center px-4 py-1.5 cursor-pointer bg-slate-800 hover:bg-slate-700 transition"
        onClick={toggleExpand}
      >
        <div className="flex items-center gap-2">
          <span className="text-slate-300 font-medium text-xs tracking-wider uppercase">
            {isExpanded ? '▼' : '▲'} Log
          </span>
          <span className="bg-slate-700 text-slate-200 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
            {(state.log || []).length}
          </span>
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="flex-1 overflow-y-auto p-2 bg-slate-950 font-mono text-[11px] leading-tight custom-scrollbar">
          {logsToDisplay.length === 0 ? (
            <div className="text-slate-500 italic p-2">No logs recorded in this session.</div>
          ) : (
            logsToDisplay.map((entry, idx) => (
              <div key={idx} className="flex gap-2 py-1 border-b border-slate-800/50 hover:bg-slate-900/50 px-2 transition-colors">
                <span className="text-slate-600 shrink-0 w-16">[{entry.stage || 'SYS'}]</span>
                <span className={`shrink-0 w-24 font-semibold ${getLogColor(entry.type, entry.tier)}`}>
                  {entry.type ? entry.type.toUpperCase() : (entry.tier <= 2 ? 'ERROR' : 'INFO')}
                </span>
                <span className="text-slate-300 break-words">{entry.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
