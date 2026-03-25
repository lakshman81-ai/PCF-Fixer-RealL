import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../../store/AppContext';

export const LogDrawer = () => {
    const { state: appState } = useAppContext();
    const logs = appState.logs || [];

    const [isExpanded, setIsExpanded] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const prevLogsLength = useRef(logs.length);
    const drawerRef = useRef(null);

    // Auto-expand and unread tracking
    useEffect(() => {
        if (logs.length > prevLogsLength.current) {
            const newLogs = logs.slice(prevLogsLength.current);
            const hasImportant = newLogs.some(l => l.type === 'Error' || l.type === 'Warning');

            if (!isExpanded) {
                setUnreadCount(prev => prev + newLogs.length);
                if (hasImportant) setIsExpanded(true); // Auto expand on error/warning
            }
        }
        prevLogsLength.current = logs.length;
    }, [logs, isExpanded]);

    // Reset unread when expanded
    useEffect(() => {
        if (isExpanded) setUnreadCount(0);
    }, [isExpanded]);

    // Scroll to bottom when new logs arrive (if expanded)
    useEffect(() => {
        if (isExpanded && drawerRef.current) {
            drawerRef.current.scrollTop = drawerRef.current.scrollHeight;
        }
    }, [logs, isExpanded]);

    const getLogColor = (type) => {
        switch (type) {
            case 'Error': return 'text-red-400';
            case 'Warning': return 'text-yellow-300';
            case 'Applied/Fix': return 'text-green-400';
            case 'Info': default: return 'text-slate-400';
        }
    };

    const getLogBg = (type) => {
        switch (type) {
            case 'Error': return 'bg-red-900/10 border-red-900/30';
            case 'Warning': return 'bg-yellow-900/10 border-yellow-900/30';
            case 'Applied/Fix': return 'bg-green-900/10 border-green-900/30';
            case 'Info': default: return 'bg-slate-800/30 border-slate-700/50';
        }
    };

    return (
        <div className={`absolute bottom-0 left-0 right-0 z-30 transition-all duration-300 ease-in-out ${isExpanded ? 'h-40' : 'h-7'}`}>
            <div className="bg-slate-900/95 border-t border-slate-700 h-full flex flex-col backdrop-blur-md shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">

                {/* Header Strip */}
                <div
                    className="flex justify-between items-center px-4 h-7 cursor-pointer hover:bg-slate-800 transition-colors shrink-0"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <div className="flex items-center gap-2">
                        {isExpanded ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"><polyline points="6 9 12 15 18 9"/></svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"><polyline points="18 15 12 9 6 15"/></svg>
                        )}
                        <span className="text-xs font-bold text-slate-300 tracking-wide">
                            LOGS
                        </span>
                        {!isExpanded && unreadCount > 0 && (
                            <span className="bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded-full animate-pulse font-bold">
                                {unreadCount} NEW
                            </span>
                        )}
                    </div>

                    {/* Compact preview of last log if collapsed */}
                    {!isExpanded && logs.length > 0 && (
                        <div className={`text-xs truncate max-w-[50%] ${getLogColor(logs[logs.length-1].type)} opacity-70`}>
                            {logs[logs.length-1].message}
                        </div>
                    )}
                </div>

                {/* Expanded Content */}
                <div
                    ref={drawerRef}
                    className={`flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar ${isExpanded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200 delay-100`}
                >
                    {logs.length === 0 ? (
                        <div className="text-center text-slate-500 text-xs mt-4 italic">No logs generated yet.</div>
                    ) : (
                        // Render last 25 logs
                        logs.slice(-25).map((log, i) => (
                            <div key={i} className={`flex text-xs p-1.5 rounded border ${getLogBg(log.type)} items-start gap-2`}>
                                <div className={`w-20 shrink-0 font-bold uppercase text-[10px] ${getLogColor(log.type)}`}>
                                    [{log.type}]
                                </div>
                                <div className="text-slate-500 shrink-0 w-24 uppercase text-[10px]">
                                    {log.stage}
                                </div>
                                <div className="text-slate-300 font-mono flex-1">
                                    {log.message}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
