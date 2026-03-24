import React, { useState } from 'react';
import { useAppContext } from '../../store/AppContext';

export function CoreProcessorTab() {
  const { state } = useAppContext();
  const { log, smartFix } = state;
  const [stageFilter, setStageFilter] = useState('ALL');

  const STAGES = ['ALL', 'IMPORT', 'TRANSLATION', 'VALIDATION', 'FIXING', 'EXPORT', 'UNKNOWN'];

  const filteredLogs = stageFilter === 'ALL'
    ? log
    : log.filter(entry => (entry.stage || 'UNKNOWN') === stageFilter);

  const getStageColor = (stage) => {
    switch(stage) {
      case 'IMPORT': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'TRANSLATION': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'VALIDATION': return 'bg-pink-100 text-pink-800 border-pink-200';
      case 'FIXING': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'EXPORT': return 'bg-teal-100 text-teal-800 border-teal-200';
      default: return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] overflow-hidden">

      {/* Filters */}
      <div className="mb-4 flex items-center gap-4 bg-white p-3 rounded-lg border border-slate-200 shadow-sm shrink-0">
        <label className="text-sm font-semibold text-slate-700">Filter by Stage:</label>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
        >
          {STAGES.map(stage => (
            <option key={stage} value={stage}>{stage === 'ALL' ? 'All Stages' : stage}</option>
          ))}
        </select>
      </div>

      {smartFix.chainSummary && (
        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 mb-6 shadow-sm shrink-0">
          <h4 className="font-semibold text-slate-800 mb-4 border-b pb-2">Smart Fix Summary</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="space-y-2">
              <div className="flex justify-between"><span className="text-slate-500">Chains found</span><span className="font-mono font-medium">{smartFix.chainSummary.chainCount}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Elements walked</span><span className="font-mono font-medium">{smartFix.chainSummary.elementsWalked}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Orphan elements</span><span className="font-mono font-medium text-red-600">{smartFix.chainSummary.orphanCount}</span></div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between border-l pl-4 border-slate-200">
                <span className="text-slate-500">Tier 1 (auto-silent)</span>
                <span className="font-mono font-medium text-green-600">{smartFix.chainSummary.tier1}</span>
              </div>
              <div className="flex justify-between border-l pl-4 border-slate-200">
                <span className="text-slate-500">Tier 2 (auto-logged)</span>
                <span className="font-mono font-medium text-amber-600">{smartFix.chainSummary.tier2}</span>
              </div>
              <div className="flex justify-between border-l pl-4 border-slate-200">
                <span className="text-slate-500">Tier 3 (warnings)</span>
                <span className="font-mono font-medium text-orange-600">{smartFix.chainSummary.tier3}</span>
              </div>
              <div className="flex justify-between border-l pl-4 border-slate-200">
                <span className="text-slate-500">Tier 4 (errors)</span>
                <span className="font-mono font-medium text-red-600">{smartFix.chainSummary.tier4}</span>
              </div>
            </div>
            <div className="col-span-2 space-y-2">
              <div className="flex items-center p-3 bg-white rounded border border-slate-200 shadow-sm justify-between">
                 <span className="font-semibold text-slate-700">Rows with proposed fixes</span>
                 <span className="text-xl font-bold text-blue-600">{smartFix.chainSummary.rowsWithActions}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto bg-white border border-slate-200 rounded-lg shadow-sm font-mono text-sm leading-relaxed p-4">
        {log.length === 0 ? (
          <div className="text-slate-400 italic">No logs available. Run Smart Fix to generate logs.</div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 z-10 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2">Timestamp</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Rule</th>
                <th className="px-3 py-2">Row</th>
                <th className="px-3 py-2">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.map((entry, index) => {
                const timeString = entry.timestamp ? entry.timestamp.substring(11, 23) : new Date().toISOString().substring(11, 23);
                const stage = entry.stage || 'UNKNOWN';
                return (
                  <tr key={index} className={`hover:bg-slate-50 ${entry.type === 'Error' ? 'bg-red-50/20' : entry.type === 'Warning' ? 'bg-orange-50/20' : ''}`}>
                    <td className="px-3 py-2 text-slate-400 text-xs whitespace-nowrap">{timeString}</td>
                    <td className="px-3 py-2">
                       <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${getStageColor(stage)}`}>
                         {stage}
                       </span>
                    </td>
                    <td className={`px-3 py-2 font-medium ${entry.type === 'Error' ? 'text-red-600' : entry.type === 'Warning' ? 'text-orange-600' : entry.type === 'Fix' ? 'text-amber-600' : entry.type === 'Applied' ? 'text-green-600' : 'text-blue-600'}`}>{entry.type}</td>
                    <td className="px-3 py-2 text-slate-500">{entry.ruleId || '-'}</td>
                    <td className="px-3 py-2 text-slate-500">{entry.row || '-'}</td>
                    <td className="px-3 py-2 text-slate-800 break-words">{entry.message}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
