import React, { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import * as THREE from 'three';

export const SceneHealthHUD = () => {
    const dataTable = useStore(state => state.dataTable);
    const showGapRadar = useStore(state => state.showGapRadar);
    const setShowGapRadar = useStore(state => state.setShowGapRadar);

    const stats = useMemo(() => {
        let pipes = 0;
        let supports = 0;
        let fixableGaps = 0; // <= 6mm
        let insertGaps = 0;  // >6mm <= 25mm
        let disconnected = 0; // > 25mm
        let maxGap = 0;

        // Count elements
        dataTable.forEach(el => {
            const t = (el.type || '').toUpperCase().trim();
            if (t === 'PIPE') pipes++;
            else if (t === 'SUPPORT') supports++;
        });

        // Compute gaps sequentially
        if (dataTable.length > 1) {
            for (let i = 0; i < dataTable.length - 1; i++) {
                const elA = dataTable[i];
                const elB = dataTable[i + 1];

                if (elA.ep2 && elB.ep1) {
                    const ptA = new THREE.Vector3(parseFloat(elA.ep2.x), parseFloat(elA.ep2.y), parseFloat(elA.ep2.z));
                    const ptB = new THREE.Vector3(parseFloat(elB.ep1.x), parseFloat(elB.ep1.y), parseFloat(elB.ep1.z));
                    const dist = ptA.distanceTo(ptB);

                    if (dist > 0.1) {
                        maxGap = Math.max(maxGap, dist);

                        if (dist <= 6.0) fixableGaps++;
                        else if (dist <= 25.0) insertGaps++;
                        else disconnected++;
                    }
                }
            }
        }

        const totalGaps = fixableGaps + insertGaps;

        return { pipes, supports, totalGaps, fixableGaps, insertGaps, disconnected, maxGap };
    }, [dataTable]);

    return (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex bg-slate-900/90 border border-slate-700 rounded-full shadow-lg backdrop-blur-md px-1 py-1 text-xs items-center gap-1 transition-all">

            {/* Pipes Badge */}
            <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 rounded-full">
                <span className="text-slate-400 font-medium">Pipes:</span>
                <span className="text-blue-400 font-bold">{stats.pipes}</span>
            </div>

            {/* Supports Badge */}
            <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 rounded-full">
                <span className="text-slate-400 font-medium">Supports:</span>
                <span className="text-slate-300 font-bold">{stats.supports}</span>
            </div>

            <div className="w-px h-4 bg-slate-700 mx-1"></div>

            {/* Gaps Badge (Clickable to toggle radar) */}
            <button
                onClick={() => setShowGapRadar(!showGapRadar)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full transition-colors ${
                    stats.totalGaps > 0
                        ? (showGapRadar ? 'bg-orange-600 hover:bg-orange-500' : 'bg-orange-900/50 hover:bg-orange-800 text-orange-400 border border-orange-800/50')
                        : 'bg-green-900/30 text-green-400 border border-green-800/30'
                }`}
            >
                <span className={stats.totalGaps > 0 && showGapRadar ? 'text-white' : 'text-slate-400'}>Gaps (≤25mm):</span>
                <span className={`font-bold ${stats.totalGaps > 0 ? (showGapRadar ? 'text-white' : 'text-orange-400') : 'text-green-400'}`}>
                    {stats.totalGaps}
                </span>
            </button>

            {/* Max Gap Badge */}
            <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 rounded-full">
                <span className="text-slate-400 font-medium">Max Gap:</span>
                <span className="text-amber-400 font-bold">{stats.maxGap.toFixed(1)}mm</span>
            </div>

            <div className="w-px h-4 bg-slate-700 mx-1"></div>

            {/* Disconnected Badge (The 5th badge requested) */}
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full ${stats.disconnected > 0 ? 'bg-red-900/30 border border-red-800/50' : 'bg-slate-800'}`}>
                <span className="text-slate-400 font-medium">Disconnected:</span>
                <span className={`font-bold ${stats.disconnected > 0 ? 'text-red-400' : 'text-slate-500'}`}>{stats.disconnected}</span>
            </div>

        </div>
    );
};