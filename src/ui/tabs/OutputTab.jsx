import React, { useMemo } from 'react';
import { useAppContext } from '../../store/AppContext';
import { generatePCFText } from '../../utils/ImportExport';
import { generateHtmlReport } from '../../utils/HtmlReporter';

export function OutputTab() {
  const { state } = useAppContext();

  // Use stage2Data if available (has fixes applied), otherwise fall back to stage1 dataTable
  const sourceData = (state.stage2Data && state.stage2Data.length > 0) ? state.stage2Data : state.dataTable;
  const sourceLabel = (state.stage2Data && state.stage2Data.length > 0) ? "Stage 2 (Fixed)" : "Stage 1 (Raw)";

  const pcfText = useMemo(() => {
    if (!sourceData || sourceData.length === 0) return "No data loaded.";
    return generatePCFText(sourceData, state.config);
  }, [sourceData, state.config]);

  const { dispatch } = useAppContext();

  const handleCopy = () => {
    navigator.clipboard.writeText(pcfText);
    dispatch({ type: "SET_STATUS_MESSAGE", payload: "Copied to clipboard!" });
  };

  const handleExportHtml = () => {
    const html = generateHtmlReport(state.dataTable, state.stage2Data, state.log || []);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PCF-Report-${new Date().toISOString().slice(0,19).replace(/[:.]/g,'-')}.html`;
    a.click();
    URL.revokeObjectURL(url);
    dispatch({ type: "SET_STATUS_MESSAGE", payload: "HTML report exported!" });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] bg-slate-50 border border-slate-200 rounded overflow-hidden">
      <div className="flex justify-between items-center p-4 bg-white border-b border-slate-200 shrink-0 shadow-sm">
        <h2 className="font-semibold text-slate-800">Generated PCF Preview <span className="text-xs font-normal text-slate-500 ml-2">({sourceLabel})</span></h2>
        <div className="space-x-2">
          <button
            onClick={handleExportHtml}
            disabled={!state.dataTable || state.dataTable.length === 0}
            className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded transition font-medium disabled:opacity-50"
          >
            Export HTML Report
          </button>
          <button
            onClick={handleCopy}
            disabled={!sourceData || sourceData.length === 0}
            className="px-3 py-1.5 text-sm bg-slate-200 hover:bg-slate-300 text-slate-700 rounded transition font-medium disabled:opacity-50"
          >
            Copy Text
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <pre className="font-mono text-xs md:text-sm leading-relaxed text-slate-700 bg-white p-6 rounded shadow-inner border border-slate-200 min-h-full whitespace-pre-wrap">
          {pcfText}
        </pre>
      </div>
    </div>
  );
}
