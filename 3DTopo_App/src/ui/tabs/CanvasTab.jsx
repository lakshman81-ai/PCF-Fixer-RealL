import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line, Html, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../../store/useStore';
import { useAppContext } from '../../store/AppContext';
import { applyFixes } from '../../engine/FixApplicator';
import { createLogger } from '../../utils/Logger';

// ----------------------------------------------------
// Performance Optimized Instanced Pipes Rendering
// ----------------------------------------------------
const InstancedPipes = () => {
  const getPipes = useStore(state => state.getPipes);
  const pipes = getPipes();
  const meshRef = useRef();

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!meshRef.current || pipes.length === 0) return;

    pipes.forEach((element, i) => {
      const { ep1, ep2, bore } = element;
      if (!ep1 || !ep2) return;

      const vecA = new THREE.Vector3(ep1.x, ep1.y, ep1.z);
      const vecB = new THREE.Vector3(ep2.x, ep2.y, ep2.z);
      const distance = vecA.distanceTo(vecB);
      if (distance === 0) return;

      // Position: Midpoint
      const midPoint = vecA.clone().lerp(vecB, 0.5);
      dummy.position.copy(midPoint);

      // Scale: Y-axis is length in Three.js cylinders
      // For visual clarity, scale the X and Z by bore/2
      const radius = bore ? bore / 2 : 5;
      dummy.scale.set(radius, distance, radius);

      // Orientation: Point from A to B
      const direction = vecB.clone().sub(vecA).normalize();
      // Three.js cylinders point UP (Y-axis) by default
      const up = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction);
      dummy.quaternion.copy(quaternion);

      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
    meshRef.current.computeBoundingSphere();
  }, [pipes, dummy]);

  const [selectedGeom, setSelectedGeom] = useState(null);

  const handlePointerDown = (e) => {
      e.stopPropagation();
      const instanceId = e.instanceId;
      if (instanceId !== undefined && pipes[instanceId]) {
          const pipe = pipes[instanceId];
          if (pipe.ep1 && pipe.ep2) {
              const midX = (pipe.ep1.x + pipe.ep2.x) / 2;
              const midY = (pipe.ep1.y + pipe.ep2.y) / 2;
              const midZ = (pipe.ep1.z + pipe.ep2.z) / 2;

              const vecA = new THREE.Vector3(pipe.ep1.x, pipe.ep1.y, pipe.ep1.z);
              const vecB = new THREE.Vector3(pipe.ep2.x, pipe.ep2.y, pipe.ep2.z);
              const distance = vecA.distanceTo(vecB);
              const radius = pipe.bore ? pipe.bore / 2 : 5;
              const direction = vecB.clone().sub(vecA).normalize();
              const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);

              setSelectedGeom({ pos: [midX, midY, midZ], dist: distance, radius, quat: quaternion });

              useStore.getState().setSelected(pipe._rowIndex);

              window.dispatchEvent(new CustomEvent('canvas-focus-point', { detail: { x: midX, y: midY, z: midZ, dist: distance } }));
          }
      }
  };

  const handlePointerMissed = () => {
      setSelectedGeom(null);
      useStore.getState().setSelected(null);
  };

  if (pipes.length === 0) return null;

  return (
    <group onPointerMissed={handlePointerMissed}>
        <instancedMesh ref={meshRef} args={[null, null, pipes.length]} onPointerDown={handlePointerDown}>
          <cylinderGeometry args={[1, 1, 1, 16]} />
          <meshStandardMaterial color="#3b82f6" />
        </instancedMesh>

        {/* Highlight Overlay */}
        {selectedGeom && (
             <mesh position={selectedGeom.pos} quaternion={selectedGeom.quat}>
                 <cylinderGeometry args={[selectedGeom.radius * 1.5, selectedGeom.radius * 1.5, selectedGeom.dist, 16]} />
                 <meshBasicMaterial color="#eab308" wireframe={true} />
             </mesh>
        )}
    </group>
  );
};

// ----------------------------------------------------
// Gap/Proposal Map Pin Visualization
// ----------------------------------------------------

// ----------------------------------------------------
// Active Issue Map Pin Visualization
// ----------------------------------------------------
const IssueMapPin = ({ activeIssue }) => {
  if (!activeIssue) return null;

  let pos = null;
  let label = "";
  let color = "#ef4444"; // red for validation

  if (activeIssue.type === 'validation' && activeIssue.data.ep1) {
      pos = [activeIssue.data.ep1.x, activeIssue.data.ep1.y, activeIssue.data.ep1.z];
      label = `Row ${activeIssue.data._rowIndex}`;
  } else if (activeIssue.type === 'proposal') {
      const prop = activeIssue.data;
      if (prop.ptA && prop.ptB) {
          pos = [(prop.ptA.x + prop.ptB.x)/2, (prop.ptA.y + prop.ptB.y)/2, (prop.ptA.z + prop.ptB.z)/2];
      } else if (prop.elementA && prop.elementA.ep1) {
          pos = [prop.elementA.ep1.x, prop.elementA.ep1.y, prop.elementA.ep1.z];
      }
      label = `Row ${prop.elementA?._rowIndex}`;
      color = "#3b82f6"; // blue for proposal
  }

  if (!pos) return null;

  return (
    <group position={pos}>
        {/* Pin Geometry */}
        <mesh position={[0, 150, 0]}>
            <sphereGeometry args={[50, 16, 16]} />
            <meshBasicMaterial color={color} />
        </mesh>
        <mesh position={[0, 75, 0]}>
            <coneGeometry args={[50, 150, 16]} rotation={[Math.PI, 0, 0]} />
            <meshBasicMaterial color={color} />
        </mesh>

        {/* Label Background */}
        <mesh position={[0, 250, 0]}>
            <planeGeometry args={[300, 100]} />
            <meshBasicMaterial color="white" side={THREE.DoubleSide} />
        </mesh>

        {/* Label Text */}
        <Text
            position={[0, 250, 1]}
            color="black"
            fontSize={60}
            anchorX="center"
            anchorY="middle"
            outlineWidth={2}
            outlineColor="white"
            fontWeight="bold"
        >
            {label}
        </Text>
    </group>
  );
};


// ----------------------------------------------------
// Smart Fix Proposal Rendering
// ----------------------------------------------------
const ProposalOverlay = ({ proposal }) => {
    if (!proposal || !proposal.ptA || !proposal.ptB) return null;

    const vecA = new THREE.Vector3(proposal.ptA.x, proposal.ptA.y, proposal.ptA.z);
    const vecB = new THREE.Vector3(proposal.ptB.x, proposal.ptB.y, proposal.ptB.z);
    const mid = new THREE.Vector3().addVectors(vecA, vecB).multiplyScalar(0.5);
    const dist = vecA.distanceTo(vecB);

    // Color based on action
    const action = proposal.fixType || proposal.action || '';

    // User requested: GAP_FILL (Pipe Fill) = Red translucent, TRIM (Pipe Trim) = Blue translucent
    let color = '#f59e0b'; // amber default
    if (action === 'GAP_FILL') color = '#ef4444'; // red
    if (action.includes('TRIM')) color = '#3b82f6'; // blue
    if (action === 'GAP_STRETCH_PIPE' || action === 'GAP_SNAP_IMMUTABLE_BLOCK') color = '#10b981'; // green

    // Cylinder orientation
    const dir = new THREE.Vector3().subVectors(vecB, vecA).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const bore = proposal.elementA?.bore || proposal.elementB?.bore || 50;

    return (
        <group>
            <Line points={[vecA, vecB]} color={color} lineWidth={3} dashed dashScale={10} dashSize={10} gapSize={10} />

            {/* Translucent Cylinder for Pipe Fill/Trim */}
            <mesh position={mid} quaternion={quaternion}>
                <cylinderGeometry args={[bore / 2, bore / 2, dist, 16]} />
                <meshStandardMaterial color={color} opacity={0.5} transparent depthWrite={false} side={THREE.DoubleSide} />
            </mesh>

            <mesh position={vecA}>
                <sphereGeometry args={[bore / 2 + 2, 8, 8]} />
                <meshBasicMaterial color={color} />
            </mesh>
            <mesh position={vecB}>
                <sphereGeometry args={[bore / 2 + 2, 8, 8]} />
                <meshBasicMaterial color={color} />
            </mesh>

            <mesh position={mid}>
                <planeGeometry args={[300, 80]} />
                <meshBasicMaterial color="#1e293b" side={THREE.DoubleSide} opacity={0.8} transparent />
            </mesh>
            <Text
                position={[mid.x, mid.y, mid.z + 1]}
                color={color}
                fontSize={35}
                anchorX="center"
                anchorY="middle"
                outlineWidth={1}
                outlineColor="#0f172a"
            >
                {action} ({dist.toFixed(1)}mm)
            </Text>
        </group>
    );
};


// ----------------------------------------------------
// Single Issue Navigation Panel
// ----------------------------------------------------
const SingleIssuePanel = ({ proposals, validationIssues, currentIssueIndex, setCurrentIssueIndex, onAutoCenter, onApprove, onReject }) => {
    const allIssues = [
        ...validationIssues.map(i => ({ type: 'validation', data: i })),
        ...proposals.map(p => ({ type: 'proposal', data: p }))
    ];

    const safeIndex = Math.max(0, Math.min(currentIssueIndex, allIssues.length - 1));
    const currentItem = allIssues[safeIndex];

    useEffect(() => {
        if (allIssues.length > 0 && onAutoCenter) {
            onAutoCenter();
        }
    }, [safeIndex, allIssues.length]);

    if (allIssues.length === 0) return null;

    const handlePrev = () => setCurrentIssueIndex(Math.max(0, currentIssueIndex - 1));
    const handleNext = () => setCurrentIssueIndex(Math.min(allIssues.length - 1, currentIssueIndex + 1));

    // Draggable state using simple absolute positioning
    const [pos, setPos] = useState({ x: 0, y: 0 }); // Note: We handle setting this dynamically
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const panelRef = useRef(null);

    // Initialize position to bottom center once
    useEffect(() => {
        if (panelRef.current && pos.x === 0 && pos.y === 0) {
             const parent = panelRef.current.parentElement;
             if (parent) {
                 const pRect = parent.getBoundingClientRect();
                 const cRect = panelRef.current.getBoundingClientRect();
                 setPos({
                     x: (pRect.width / 2) - (cRect.width / 2),
                     y: pRect.height - cRect.height - 32 // 32px from bottom (bottom-8)
                 });
             }
        }
    }, [pos.x, pos.y]);

    const handlePointerDown = (e) => {
        setIsDragging(true);
        const rect = panelRef.current.getBoundingClientRect();
        // Calculate offset from the top-left of the panel
        setDragOffset({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        });
        e.target.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e) => {
        if (!isDragging || !panelRef.current) return;
        const parent = panelRef.current.parentElement;
        if (!parent) return;

        const pRect = parent.getBoundingClientRect();

        // Calculate new X, Y relative to the parent container
        let newX = e.clientX - pRect.left - dragOffset.x;
        let newY = e.clientY - pRect.top - dragOffset.y;

        // Optional bounding box
        newX = Math.max(0, Math.min(newX, pRect.width - panelRef.current.offsetWidth));
        newY = Math.max(0, Math.min(newY, pRect.height - panelRef.current.offsetHeight));

        setPos({ x: newX, y: newY });
    };

    const handlePointerUp = (e) => {
        setIsDragging(false);
        e.target.releasePointerCapture(e.pointerId);
    };

    // If pos is still 0,0, apply a CSS class for centering, otherwise use absolute top/left
    const style = (pos.x !== 0 || pos.y !== 0)
        ? { left: pos.x, top: pos.y }
        : { bottom: '2rem', left: '50%', transform: 'translateX(-50%)' };

    return (
        <div
            ref={panelRef}
            style={style}
            className="absolute z-20 w-96 bg-slate-900/95 border border-slate-700 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden"
        >
            {/* Header / Drag Handle */}
            <div
                className="flex items-center justify-between px-4 py-2 bg-slate-800/80 border-b border-slate-700 cursor-move"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                <div className="flex items-center gap-2 pointer-events-none">
                    <span className="text-slate-300 font-bold text-sm">Issue {safeIndex + 1} of {allIssues.length}</span>
                </div>
                <div className="flex gap-1">
                    <button onClick={handlePrev} disabled={currentIssueIndex === 0} className="p-1 rounded hover:bg-slate-700 disabled:opacity-30 transition">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300"><path d="m15 18-6-6 6-6"/></svg>
                    </button>
                    <button onClick={onAutoCenter} className="p-1 rounded hover:bg-slate-700 transition" title="Focus Camera">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                    </button>
                    <button onClick={handleNext} disabled={currentIssueIndex === allIssues.length - 1} className="p-1 rounded hover:bg-slate-700 disabled:opacity-30 transition">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300"><path d="m9 18 6-6-6-6"/></svg>
                    </button>
                </div>
            </div>

            {/* Content Body */}
            <div className="p-4">
                {currentItem.type === 'validation' ? (
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-red-400 uppercase tracking-widest px-2 py-0.5 bg-red-900/30 rounded border border-red-800/50">Validation Issue</span>
                            <span className="text-slate-400 text-xs">Row {currentItem.data._rowIndex}</span>
                        </div>
                        <p className="text-sm text-slate-200 mb-1">{currentItem.data.type || 'Unknown Component'}</p>
                        <p className="text-xs text-slate-400 p-2 bg-slate-950 rounded border border-slate-800">{currentItem.data.fixingAction}</p>
                    </div>
                ) : (
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-amber-400 uppercase tracking-widest px-2 py-0.5 bg-amber-900/30 rounded border border-amber-800/50">Fix Proposal</span>
                            <span className="text-slate-400 text-xs">Row {currentItem.data.elementA?._rowIndex}</span>
                        </div>
                        <div className="p-2 bg-slate-950 rounded border border-slate-800">
                            <p className="text-sm text-slate-200 font-medium">{currentItem.data.description}</p>

                            {/* Detailed Proposal Info */}
                            {(() => {
                                const prop = currentItem.data;
                                return (
                                    <div className="mt-2 pt-2 border-t border-slate-800 flex justify-between items-end">
                                        <div>
                                           <div className="text-[10px] text-slate-500">Action: {prop.action}</div>
                                           {prop.dist !== undefined && <div className="text-[10px] text-slate-500">Delta: {prop.dist.toFixed(1)}mm</div>}
                                        </div>
                                        {prop.score !== undefined && (
                                            <div className="flex items-center">
                                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${prop.score >= 10 ? 'text-green-400 bg-green-900/30 border-green-800' : 'text-orange-400 bg-orange-900/30 border-orange-800'}`}>Score {prop.score}</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* Actions */}
                            <div className="mt-4 flex gap-2">
                                {currentItem.data._fixApproved === true ? (
                                    <div className="w-full text-center text-green-500 font-bold text-sm py-1 bg-green-900/20 rounded border border-green-800/30">✓ Approved</div>
                                ) : currentItem.data._fixApproved === false ? (
                                    <div className="w-full text-center text-red-500 font-bold text-sm py-1 bg-red-900/20 rounded border border-red-800/30">✗ Rejected</div>
                                ) : (
                                    <>
                                        <button className="flex-1 bg-green-800 hover:bg-green-700 text-white text-sm py-1.5 rounded transition" onClick={(e) => onApprove(e, currentItem.data)}>
                                            ✓ Approve
                                        </button>
                                        <button className="flex-1 bg-slate-700 hover:bg-slate-600 text-white text-sm py-1.5 rounded transition flex justify-center items-center gap-1" onClick={(e) => onReject(e, currentItem.data)}>
                                            ✗ Reject
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// Main Tab Component
// ----------------------------------------------------

const ControlsAutoCenter = () => {
    const controlsRef = useRef();
    const getPipes = useStore(state => state.getPipes);
    const [targetPos, setTargetPos] = useState(null);
    const [camPos, setCamPos] = useState(null);
    const isAnimating = useRef(false);

    // Smooth camera interpolation
    useFrame((state, delta) => {
        if (!controlsRef.current || !isAnimating.current || !targetPos || !camPos) return;

        // Lerp OrbitControls target
        controlsRef.current.target.lerp(targetPos, 5 * delta);
        // Lerp Camera position
        state.camera.position.lerp(camPos, 5 * delta);

        // Stop animating when close
        if (controlsRef.current.target.distanceTo(targetPos) < 1 && state.camera.position.distanceTo(camPos) < 1) {
            isAnimating.current = false;
        }

        controlsRef.current.update();
    });

    // Add custom event listener for auto-center
    useEffect(() => {
        const handleFocus = (e) => {
            if (!controlsRef.current) return;
            const { x, y, z, dist } = e.detail;
            const tPos = new THREE.Vector3(x, y, z);
            // Move camera closer to object based on its length/dist
            // Make sure the zoom distance isn't excessively far or close
            const zoomDist = Math.max(dist * 1.5, 300);

            // Current camera direction to object
            const dir = new THREE.Vector3().subVectors(controlsRef.current.object.position, tPos).normalize();
            if (dir.lengthSq() < 0.1) dir.set(1, 1, 1).normalize(); // Default offset if dead center

            const cPos = new THREE.Vector3().copy(tPos).addScaledVector(dir, zoomDist);

            setTargetPos(tPos);
            setCamPos(cPos);
            isAnimating.current = true;
        };

        const handleCenter = () => {
            const pipes = getPipes();
            if (pipes.length === 0 || !controlsRef.current) return;

            // Calculate bounding box of all pipes
            let minX = Infinity, minY = Infinity, minZ = Infinity;
            let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

            pipes.forEach(p => {
                if (p.ep1) {
                    minX = Math.min(minX, p.ep1.x); minY = Math.min(minY, p.ep1.y); minZ = Math.min(minZ, p.ep1.z);
                    maxX = Math.max(maxX, p.ep1.x); maxY = Math.max(maxY, p.ep1.y); maxZ = Math.max(maxZ, p.ep1.z);
                }
                if (p.ep2) {
                    minX = Math.min(minX, p.ep2.x); minY = Math.min(minY, p.ep2.y); minZ = Math.min(minZ, p.ep2.z);
                    maxX = Math.max(maxX, p.ep2.x); maxY = Math.max(maxY, p.ep2.y); maxZ = Math.max(maxZ, p.ep2.z);
                }
            });

            if (minX !== Infinity) {
                const centerX = (minX + maxX) / 2;
                const centerY = (minY + maxY) / 2;
                const centerZ = (minZ + maxZ) / 2;

                const tPos = new THREE.Vector3(centerX, centerY, centerZ);
                const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
                const cPos = new THREE.Vector3(centerX + maxDim, centerY + maxDim, centerZ + maxDim);

                setTargetPos(tPos);
                setCamPos(cPos);
                isAnimating.current = true;
            }
        };

        window.addEventListener('canvas-auto-center', handleCenter);
        window.addEventListener('canvas-focus-point', handleFocus);
        return () => {
            window.removeEventListener('canvas-auto-center', handleCenter);
            window.removeEventListener('canvas-focus-point', handleFocus);
        };
    }, [getPipes]);

    return <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.1} />;
};


export function CanvasTab() {
  const { state: appState, dispatch } = useAppContext();
  const proposals = useStore(state => state.proposals);
  const [currentIssueIndex, setCurrentIssueIndex] = useState(0);

  const validationIssues = (appState.stage2Data || []).filter(r =>
      typeof r.fixingAction === 'string' && (r.fixingAction.includes('ERROR') || r.fixingAction.includes('WARNING'))
  );

  const handleAutoCenter = () => {
      window.dispatchEvent(new CustomEvent('canvas-auto-center'));
  };

  const handleApprove = (e, prop) => {
      e.stopPropagation();

      const updatedTable = [...appState.stage2Data];
      const row = updatedTable.find(r => r._rowIndex === prop.elementA._rowIndex);
      if (row) {
          row._fixApproved = true;
          dispatch({ type: "SET_STAGE_2_DATA", payload: updatedTable });
          dispatch({ type: "ADD_LOG", payload: { stage: "FIXING", type: "Info", message: "Approved fix proposal for row " + row._rowIndex }});
          useStore.getState().setProposalStatus(row._rowIndex, true);
      }
  };

  const handleReject = (e, prop) => {
      e.stopPropagation();

      const updatedTable = [...appState.stage2Data];
      const row = updatedTable.find(r => r._rowIndex === prop.elementA._rowIndex);
      if (row) {
          row._fixApproved = false;
          dispatch({ type: "SET_STAGE_2_DATA", payload: updatedTable });
          dispatch({ type: "ADD_LOG", payload: { stage: "FIXING", type: "Info", message: "Rejected fix proposal for row " + row._rowIndex }});
          useStore.getState().setProposalStatus(row._rowIndex, false);
      }
  };

  const triggerZoomToCurrent = () => {
      // Logic is handled in the effect inside SingleIssuePanel,
      // but we can force re-trigger by re-setting index or just letting the user click the button.
      // Easiest is to dispatch a dummy event that the effect listens to, or just update state.
      // A trick: set index to itself. React might not re-render, so we can dispatch the event directly here if needed,
      // but SingleIssuePanel already handles auto-center via the onAutoCenter prop. Wait, SingleIssuePanel doesn't have the logic inside onAutoCenter.
      // Let's pass a function that gets the current item and triggers the focus event.

      const allIssues = [
          ...validationIssues.map(i => ({ type: 'validation', data: i })),
          ...proposals.map(p => ({ type: 'proposal', data: p }))
      ];
      if (allIssues.length === 0) return;
      const safeIndex = Math.max(0, Math.min(currentIssueIndex, allIssues.length - 1));
      const currentItem = allIssues[safeIndex];

      let focusPt = null;
      let focusDist = 2000;
      if (currentItem.type === 'validation' && currentItem.data.ep1) {
          focusPt = currentItem.data.ep1;
      } else if (currentItem.type === 'proposal') {
          const prop = currentItem.data;
          if (prop.ptA && prop.ptB) {
               focusPt = { x: (prop.ptA.x + prop.ptB.x)/2, y: (prop.ptA.y + prop.ptB.y)/2, z: (prop.ptA.z + prop.ptB.z)/2 };
               focusDist = Math.max(prop.dist * 3, 2000);
          } else if (prop.elementA && prop.elementA.ep1) {
               focusPt = prop.elementA.ep1;
          }
      }
      if (focusPt) {
          window.dispatchEvent(new CustomEvent('canvas-focus-point', { detail: { ...focusPt, dist: focusDist } }));
      }
  };


  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] w-full overflow-hidden bg-slate-950 rounded-lg border border-slate-800 shadow-inner relative">

      {/* Canvas Overlay UI */}
      <div className="absolute top-4 left-4 z-10 pointer-events-none">
        <h2 className="text-slate-200 font-bold text-lg drop-shadow-md">3D Topology Canvas</h2>
        <p className="text-slate-400 text-xs mt-1">Note: Visualization reflects data from Stage 2.</p>
        <p className="text-slate-500 text-[10px] mt-0.5">Left-click element to focus/orbit, Right-click pan, Scroll zoom.</p>
      </div>

      <div className="absolute top-4 right-4 z-10">
        <button
            onClick={handleAutoCenter}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded border border-slate-700 shadow flex items-center gap-2 text-sm transition-colors"
            title="Auto Center Camera"
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h6"/><path d="M3 3v6"/><path d="M21 3h-6"/><path d="M21 3v6"/><path d="M3 21h6"/><path d="M3 21v-6"/><path d="M21 21h-6"/><path d="M21 21v-6"/></svg>
            Auto Center
        </button>
      </div>


      <SingleIssuePanel
          proposals={proposals}
          validationIssues={validationIssues}
          currentIssueIndex={currentIssueIndex}
          setCurrentIssueIndex={setCurrentIssueIndex}
          onAutoCenter={triggerZoomToCurrent}
          onApprove={handleApprove}
          onReject={handleReject}
      />


      <Canvas camera={{ position: [5000, 5000, 5000], fov: 50, near: 1, far: 100000 }}>
        <color attach="background" args={['#020617']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[1000, 1000, 500]} intensity={1.5} />
        <directionalLight position={[-1000, -1000, -500]} intensity={0.5} />

        <InstancedPipes />


        {proposals.map((prop, idx) => {
            // Calculate global index to check if active
            const allIssues = [
                ...validationIssues.map(i => ({ type: 'validation', data: i })),
                ...proposals.map(p => ({ type: 'proposal', data: p }))
            ];
            const safeIndex = Math.max(0, Math.min(currentIssueIndex, allIssues.length - 1));
            const isActive = allIssues[safeIndex]?.type === 'proposal' && allIssues[safeIndex]?.data === prop;

            return isActive ? <ProposalOverlay key={`prop-${idx}`} proposal={prop} /> : null;
        })}



        {(() => {
            const allIssues = [
                ...validationIssues.map(i => ({ type: 'validation', data: i })),
                ...proposals.map(p => ({ type: 'proposal', data: p }))
            ];
            const safeIndex = Math.max(0, Math.min(currentIssueIndex, allIssues.length - 1));
            return <IssueMapPin activeIssue={allIssues[safeIndex]} />;
        })()}


        <ControlsAutoCenter />

        {/* World Reference */}
        <gridHelper args={[20000, 20, '#1e293b', '#0f172a']} position={[0, -1000, 0]} />
      </Canvas>

      {/* Small Axis Reference Overlay */}
      <div className="absolute bottom-4 right-4 w-24 h-24 pointer-events-none">
        <Canvas orthographic camera={{ position: [20, 20, 20], zoom: 5 }}>
            <ambientLight intensity={1} />
            <axesHelper args={[10]} />
            <Text position={[12, 0, 0]} color="red" fontSize={4}>X</Text>
            <Text position={[0, 12, 0]} color="green" fontSize={4}>Y</Text>
            <Text position={[0, 0, 12]} color="blue" fontSize={4}>Z</Text>
        </Canvas>
      </div>
    </div>
  );
}