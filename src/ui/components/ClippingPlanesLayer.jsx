import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export const ClippingPlanesLayer = () => {
    const { gl, scene } = useThree();
    const clippingPlaneEnabled = useStore(state => state.clippingPlaneEnabled);

    // Three clipping planes (X, Y, Z)
    const [planes] = useState(() => [
        new THREE.Plane(new THREE.Vector3(-1, 0, 0), 10000),   // Max X
        new THREE.Plane(new THREE.Vector3(0, -1, 0), 10000),   // Max Y
        new THREE.Plane(new THREE.Vector3(0, 0, -1), 10000)    // Max Z
    ]);

    useEffect(() => {
        // Safe access for WebGLRenderer state changes
        try {
            if (gl && 'localClippingEnabled' in gl) {
                gl.localClippingEnabled = clippingPlaneEnabled;
            }
        } catch (e) {
            // Ignore strict mode mutability errors if wrapped in a hook system
        }

        const applyPlanes = () => {
            scene.traverse((child) => {
                if (child.isMesh && child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach(mat => {
                        // Skip text/UI layers that don't need clipping
                        if (mat.type !== 'MeshBasicMaterial' || !mat.transparent) {
                            mat.clippingPlanes = clippingPlaneEnabled ? planes : [];
                            mat.clipIntersection = false;
                            mat.needsUpdate = true;
                        }
                    });
                }
            });
        };

        applyPlanes();
    }, [clippingPlaneEnabled, gl, scene, planes]);

    // Expose plane update functions to global window for external UI slider component
    useEffect(() => {
        window.updateClippingPlanes = (axis, value) => {
            if (axis === 'x') planes[0].constant = value;
            if (axis === 'y') planes[1].constant = value;
            if (axis === 'z') planes[2].constant = value;
        };
        return () => { delete window.updateClippingPlanes; };
    }, [planes]);

    return null;
};

export const ClippingPanelUI = () => {
    const clippingPlaneEnabled = useStore(state => state.clippingPlaneEnabled);
    const setClippingPlaneEnabled = useStore(state => state.setClippingPlaneEnabled);

    const [positions, setPositions] = useState({ x: 10000, y: 10000, z: 10000 });

    const handleSlider = (axis, value) => {
        setPositions(prev => ({ ...prev, [axis]: value }));
        if (window.updateClippingPlanes) {
            window.updateClippingPlanes(axis, value);
        }
    };

    if (!clippingPlaneEnabled) return null;

    return (
        <div className="absolute top-40 left-4 z-20 w-64 bg-slate-900/90 backdrop-blur border border-slate-700 shadow-2xl rounded-lg p-4">
            <div className="flex justify-between items-center border-b border-slate-700 pb-2 mb-3">
                <span className="text-slate-200 font-bold text-sm">Section Box</span>
                <button onClick={() => setClippingPlaneEnabled(false)} className="text-slate-400 hover:text-white" title="Close">✕</button>
            </div>

            {['x', 'y', 'z'].map(axis => (
                <div key={axis} className="mb-3">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                        <span className="uppercase">{axis} Slice</span>
                        <span>{positions[axis]}mm</span>
                    </div>
                    <input
                        type="range"
                        min="-10000"
                        max="20000"
                        value={positions[axis]}
                        onChange={(e) => handleSlider(axis, parseInt(e.target.value))}
                        className="w-full accent-blue-500"
                    />
                </div>
            ))}
        </div>
    );
};
