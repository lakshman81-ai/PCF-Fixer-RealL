import React, { useRef } from 'react';
import { useAppContext } from '../../store/AppContext';
import { parsePCF } from '../../utils/ImportExport';
import { useStore } from '../../store/useStore';

export function Header() {
  const { state, dispatch } = useAppContext();
  const pcfInputRef = useRef(null);
  const setZustandData = useStore(state => state.setDataTable);
  const setZustandProposals = useStore(state => state.setProposals);

  const handlePcfClick = () => { if (pcfInputRef.current) pcfInputRef.current.click(); };

  const handlePcfChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      // Clear out all previous app state completely before loading
      dispatch({ type: "RESET_ALL" });
      setZustandData([]);
      setZustandProposals([]);

      const parsedData = await parsePCF(file, state.config);
      dispatch({ type: "SET_DATA_TABLE", payload: parsedData });
      dispatch({ type: "ADD_LOG", payload: { type: "Info", message: `Successfully imported ${parsedData.length} rows from ${file.name}` }});
    } catch (err) {
      dispatch({ type: "ADD_LOG", payload: { type: "Error", message: `Failed to import file: ${err.message}` }});
      dispatch({ type: "SET_STATUS_MESSAGE", payload: `Error importing file: ${err.message}` });
    }
    e.target.value = null;
  };

  const dataTable = useStore(state => state.dataTable);

  const [key1, setKey1] = React.useState('');
  const [key2, setKey2] = React.useState('');

  const uniquePipelineRefs = React.useMemo(() => {
    const refs = new Set();
    dataTable?.forEach(row => {
      if (row.pipelineRef) refs.add(row.pipelineRef);
    });
    return Array.from(refs).sort();
  }, [dataTable]);

  const lineKey = `${key1}${key1 && key2 ? '-' : ''}${key2}`;

  return (
    <header className="bg-slate-900 text-white shadow-md border-b border-slate-700">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-6">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-transparent flex items-baseline gap-2">
            PCF Validator & Smart Fixer <span className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">V0.9b</span>
          </h1>
          <nav className="flex space-x-2">
            <button
              onClick={handlePcfClick}
              className="px-3 py-1.5 text-sm font-medium rounded hover:bg-slate-800 transition-colors flex items-center"
            >
              Import PCF ▼
            </button>
            <input
              type="file"
              accept=".pcf"
              ref={pcfInputRef}
              onChange={handlePcfChange}
              style={{ display: 'none' }}
            />
          </nav>
        </div>

        {/* Line Key Header Placeholder */}
        <div className="flex items-center space-x-2 ml-4">
            <span className="text-xs text-slate-400 font-semibold uppercase">Line Key:</span>

            <select value={key1} onChange={(e) => setKey1(e.target.value)} className="bg-slate-800 text-slate-200 text-xs py-1 px-2 rounded border border-slate-700 outline-none">
                <option value="">Select Key1 (Ref)</option>
                {uniquePipelineRefs.map(ref => (
                    <option key={ref} value={ref}>{ref}</option>
                ))}
            </select>

            <select value={key2} onChange={(e) => setKey2(e.target.value)} className="bg-slate-800 text-slate-200 text-xs py-1 px-2 rounded border border-slate-700 outline-none">
                <option value="">Select Key2</option>
                <option value="A1">A1</option>
                <option value="B2">B2</option>
                <option value="C3">C3</option>
            </select>

            <div className="bg-slate-950 text-amber-400 font-mono text-xs py-1 px-3 border border-slate-700 rounded w-48 truncate" title={lineKey || 'N/A'}>
                {lineKey || '---'}
            </div>
        </div>

        <div className="flex items-center space-x-4 text-sm text-slate-400">
          <span>Project: <span className="text-slate-200">Default</span></span>
          <div className="h-4 w-px bg-slate-700"></div>
          <span className="flex items-center"><div className="w-2 h-2 rounded-full bg-green-500 mr-2"></div> Online</span>
        </div>
      </div>
    </header>
  );
}
