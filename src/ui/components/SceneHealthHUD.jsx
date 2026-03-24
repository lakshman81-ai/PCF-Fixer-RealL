import React, { useMemo } from 'react';
import { useStore } from '../../store/useStore';

const getDist = (p1, p2) => {
  if (!p1 || !p2) return Infinity;
  const dx = parseFloat(p1.x) - parseFloat(p2.x);
  const dy = parseFloat(p1.y) - parseFloat(p2.y);
  const dz = parseFloat(p1.z) - parseFloat(p2.z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

export const SceneHealthHUD = () => {
  const dataTable = useStore(state => state.dataTable);
  const setShowGapRadar = useStore(state => state.setShowGapRadar);

  const stats = useMemo(() => {
    let pipes = 0;
    let gaps = 0;
    let maxGap = 0;
    let supports = 0;
    let disconnected = 0;

    if (!Array.isArray(dataTable) || dataTable.length === 0) {
        return { pipes, gaps, maxGap, supports, disconnected };
    }

    for (let i = 0; i < dataTable.length; i++) {
        const row = dataTable[i];
        const type = (row.type || '').toUpperCase().trim();

        if (type === 'PIPE') pipes++;
        if (type === 'SUPPORT') supports++;

        // Gap calculation (adjacent rows only)
        if (i < dataTable.length - 1) {
            const nextRow = dataTable[i + 1];
            if (row.ep2 && nextRow.ep1) {
                const dist = getDist(row.ep2, nextRow.ep1);
                if (dist > 0) {
                    if (dist <= 25.0) {
                        gaps++;
                        if (dist > maxGap) maxGap = dist;
                    } else {
                        disconnected++;
                    }
                }
            }
        }
    }

    return { pipes, gaps, maxGap, supports, disconnected };
  }, [dataTable]);

  if (dataTable.length === 0) return null;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex bg-slate-900/90 backdrop-blur-md rounded-full shadow-lg border border-slate-700/50 p-1 text-xs select-none">

      <div className="flex items-center gap-1.5 px-3 py-1 border-r border-slate-700/50">
        <span className="text-slate-400 font-medium">Pipes</span>
        <span className="text-slate-200 font-bold bg-slate-800 px-1.5 py-0.5 rounded-full">{stats.pipes}</span>
      </div>

      <div
        className={`flex items-center gap-1.5 px-3 py-1 border-r border-slate-700/50 cursor-pointer transition ${stats.gaps > 0 ? 'hover:bg-amber-900/30 group' : ''}`}
        onClick={() => stats.gaps > 0 && setShowGapRadar(true)}
        title={stats.gaps > 0 ? "Click to show Gap Radar" : "No fixable gaps"}
      >
        <span className={`${stats.gaps > 0 ? 'text-amber-400 group-hover:text-amber-300' : 'text-green-500'} font-medium`}>Gaps</span>
        <span className={`${stats.gaps > 0 ? 'bg-amber-900/50 text-amber-200' : 'bg-green-900/30 text-green-400'} font-bold px-1.5 py-0.5 rounded-full`}>
            {stats.gaps}
        </span>
      </div>

      <div className="flex items-center gap-1.5 px-3 py-1 border-r border-slate-700/50">
        <span className="text-slate-400 font-medium">Max Gap</span>
        <span className={`${stats.maxGap > 0 ? 'text-amber-400 font-bold' : 'text-slate-500'}`}>{stats.maxGap.toFixed(1)}mm</span>
      </div>

      <div className="flex items-center gap-1.5 px-3 py-1 border-r border-slate-700/50">
        <span className="text-slate-400 font-medium">Supports</span>
        <span className="text-slate-300 font-bold bg-slate-800 px-1.5 py-0.5 rounded-full">{stats.supports}</span>
      </div>

      <div className="flex items-center gap-1.5 px-3 py-1">
        <span className={`${stats.disconnected > 0 ? 'text-red-400' : 'text-slate-500'} font-medium`}>Disconnected</span>
        <span className={`${stats.disconnected > 0 ? 'bg-red-900/40 text-red-300' : 'text-slate-600 bg-slate-800/50'} font-bold px-1.5 py-0.5 rounded-full`}>
            {stats.disconnected}
        </span>
      </div>

    </div>
  );
};
