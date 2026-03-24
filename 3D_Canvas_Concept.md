# 3D Topology Canvas Concept

**Role:** The 3D Topology Canvas serves as the premier visualization interface for interpreting, validating, and mutating PCF Cartesian geometry in a tangible spatial context. It integrates directly into the Vite app, acting as a visual layer on top of the `PcfTopologyGraph_2` physics engine.

## 1. Technology Stack & State Management
- `@react-three/fiber` (R3F): React wrapper over `three.js`. Used to declare 3D scenes using components.
- `@react-three/drei`: Helper library for R3F providing essential utilities like `<OrbitControls>`, `<Line>`, and environment pre-sets.
- `three`: The core WebGL 3D rendering engine.

**State Decoupling (Critical Architecture Decision):**
Passing the massive, deeply nested `dataTable` and `smartFix` arrays through React Context into a `<Canvas>` will cause devastating performance bottlenecks. Every minor change to a single pipe would force the entire 3D scene to re-render.
*Recommendation:* Use a lightweight, atomic state manager like **Zustand**. The `<Canvas>` components should subscribe strictly to the specific slices of state they need (e.g., a specific pipe subscribing only to its own coordinates), preventing global scene re-renders.

## 2. Geometry Mapping, Rendering Logic & Performance

### Mapping Rules
The geometric mapping rules must be mathematically sound:
- **`PIPE`**: Rendered as a `<CylinderGeometry>`. Length is dynamically calculated by vector magnitude (`vec.dist(ep1, ep2)`). Orientation requires a Quaternion (`quaternion.setFromUnitVectors`) based on the direction vector, remembering to rotate the geometry by 90 degrees on the X-axis first, as Three.js cylinders default to aligning along the Y-axis.
- **`BEND`**: Mapped via `<Tube>` geometry along a quadratic Bezier curve using `ep1`, `cp`, and `ep2`, which is mathematically correct for piping.
- **`FLANGE` / `VALVE`**: Rendered as flat disks or distinct nodes at `EP1` and `EP2` boundaries.
- **`TEE`**: Rendered by connecting `EP1` to `EP2` (Header) and drawing a perpendicular mesh from `CP` to `BP` (Branch).

### Rendering Performance at Scale
Mapping over the array to create individual React `<PipeMesh>` components works for small files but will drop framerates to single digits due to draw-call overhead on industrial files (10,000+ components).
*Recommendation:* Implement `THREE.InstancedMesh` early in development. This allows rendering thousands of pipes in a single draw call by passing a `Matrix4` (containing position, rotation, and scale) for each instance.

## 3. Visual UI Overlays & Interactivity

### A. Rendering Gaps
When `GapOverlap.js` detects a gap, it produces an analysis object. The canvas renders this as a **glaring red `<Line>`** connecting the two disjointed endpoints, or as a semi-transparent red bounding box encapsulating the empty space.

### B. "Ghost" Fix Proposals
When the smart fixer proposes a fix (e.g., `GAP_SNAP_IMMUTABLE`), it calculates the vector translation. Before applying, the canvas renders a holographic (opacity 0.3, wireframe) mesh at the *proposed* new location, overlaying the solid current location. This gives the user immediate visual confirmation of the solver's intent.

### C. Canvas Interactivity
R3F supports `onClick` and `onPointerOver` events natively on meshes.
Clicking a gap (the red line) or a Ghost Proposal triggers a React state change that renders a floating `<Html>` dialog overlay (from `@react-three/drei`) directly anchored to that 3D coordinate.

**Performance Note for DOM Projection:**
Projecting DOM elements into the 3D scene using Drei's `<Html>` is powerful but very expensive if overused.
*Recommendation:* Only render the `<Html>` action dialog (with the Approve/Reject buttons) when a specific gap or ghost element is actively clicked. For passive labels (like component IDs or gap distances), use Drei's `<Text>` component, which renders text natively in WebGL and maintains high framerates.

## 4. Execution, State Updating & Animation
When "Apply Fixes" is dispatched, two separate timing mechanisms govern the response:
1. **Data State Update (0ms):** The underlying physics engine updates instantly. The `dataTable` state mutates in `0ms` so downstream calculations (like stress analysis) don't have to wait.
2. **Visual Animation (~500ms):** The visual `<Canvas>` independently observes this state change. Using `@react-spring/three`, it smoothly interpolates the positions from their broken coordinates to the snapped, validated coordinates over a `500ms` duration, providing excellent spatial context to the user.

---

## 5. React Component Skeleton (`src/ui/tabs/CanvasTabSkeleton.jsx`)

```jsx
// src/ui/tabs/CanvasTabSkeleton.jsx
/*
import React, { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line, Html } from '@react-three/drei';
import { useAppContext } from '../../store/AppContext';

// --- Sub-components ---

// Note: In production for large files, use InstancedMesh.
// This example uses individual meshes for conceptual clarity.
const PipeMesh = ({ element }) => {
  const meshRef = React.useRef();
  const { ep1, ep2, bore } = element;

  React.useEffect(() => {
    if (!ep1 || !ep2 || !meshRef.current) return;

    // 1. Calculate length
    const vecA = new THREE.Vector3(ep1.x, ep1.y, ep1.z);
    const vecB = new THREE.Vector3(ep2.x, ep2.y, ep2.z);
    const distance = vecA.distanceTo(vecB);

    // 2. Calculate midpoint
    const midPoint = vecA.clone().lerp(vecB, 0.5);
    meshRef.current.position.copy(midPoint);

    // 3. Cylinder Scale (Y-axis is length in Three.js cylinders)
    meshRef.current.scale.set(1, distance, 1);

    // 4. Quaternion Alignment
    // Three.js cylinders point UP (Y-axis) by default.
    const direction = vecB.clone().sub(vecA).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction);
    meshRef.current.quaternion.copy(quaternion);

  }, [ep1, ep2]);

  if (!ep1 || !ep2) return null;

  return (
    <mesh ref={meshRef}>
      <cylinderGeometry args={[bore ? bore / 2 : 5, bore ? bore / 2 : 5, 1, 16]} />
      <meshStandardMaterial color="blue" />
    </mesh>
  );
};

// Renders a Gap as a red dashed line and provides an interactive anchor
const GapOverlay = ({ gapProposal }) => {
  const [hovered, setHovered] = useState(false);
  const [clicked, setClicked] = useState(false);

  const { elementA, elementB, description } = gapProposal;
  // Assume exitPt A and entryPt B exist in the proposal
  const pA = [elementA.ep2.x, elementA.ep2.y, elementA.ep2.z];
  const pB = [elementB.ep1.x, elementB.ep1.y, elementB.ep1.z];

  // Midpoint for the HTML Dialog
  const midX = (pA[0] + pB[0]) / 2;
  const midY = (pA[1] + pB[1]) / 2;
  const midZ = (pA[2] + pB[2]) / 2;

  return (
    <group>
      <Line
        points={[pA, pB]}
        color={hovered ? "orange" : "red"}
        lineWidth={3}
        dashed={true}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onClick={() => setClicked(!clicked)}
      />

      {clicked && (
        <Html position={[midX, midY, midZ]} center>
          <div className="bg-white p-2 rounded shadow text-xs w-48 border border-red-300">
            <p className="font-bold text-red-600 mb-1">Gap Detected</p>
            <p className="mb-2 text-gray-700">{description}</p>
            <div className="flex gap-2">
              <button className="bg-green-500 text-white px-2 py-1 rounded w-full">Approve</button>
              <button className="bg-gray-300 text-black px-2 py-1 rounded w-full" onClick={() => setClicked(false)}>Reject</button>
            </div>
          </div>
        </Html>
      )}
    </group>
  );
};

// --- Main Tab ---

export function CanvasTab() {
  const { state } = useAppContext();
  const { dataTable, smartFix } = state;

  const pipes = useMemo(() => dataTable.filter(r => r.type === 'PIPE'), [dataTable]);
  const proposals = smartFix.proposedFixes || [];

  return (
    <div className="w-full h-[calc(100vh-12rem)] bg-slate-900 rounded-lg overflow-hidden border border-slate-700">
      <Canvas camera={{ position: [1000, 1000, 1000], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />

        // Render existing topology
        {pipes.map(p => (
          <PipeMesh key={p._rowIndex} element={p} />
        ))}

        // Render Gap / Fix Overlays
        {proposals.map((prop, idx) => (
          <GapOverlay key={`gap-${idx}`} gapProposal={prop} />
        ))}

        <OrbitControls makeDefault />
        <gridHelper args={[10000, 100]} />
        <axesHelper args={[5000]} />
      </Canvas>
    </div>
  );
}
*/
```