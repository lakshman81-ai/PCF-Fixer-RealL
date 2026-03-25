import { create } from 'zustand';

// Decoupled, Atomic Zustand store primarily aimed at driving high-performance
// visual updates for the 3D Canvas without forcing global React Context re-renders.

export const useStore = create((set, get) => ({
  // The global source of truth for raw pipe geometries
  dataTable: [],

  // Wave 2 - Canvas Mode Machine
  canvasMode: 'VIEW', // 'VIEW' | 'CONNECT' | 'BREAK' | 'INSERT_SUPPORT' | 'MEASURE' | 'ASSIGN_PIPELINE' | 'MARQUEE_SELECT' | 'MARQUEE_ZOOM'
  setCanvasMode: (mode) => set({ canvasMode: mode }),

  // Wave 2 - Undo Stack
  history: [],
  historyIdx: -1,
  pushHistory: (label) => set((state) => {
    const newHistory = state.history.slice(0, state.historyIdx + 1);
    newHistory.push({ label, snapshot: JSON.parse(JSON.stringify(state.dataTable)) });
    if (newHistory.length > 20) newHistory.shift(); // Keep last 20
    return { history: newHistory, historyIdx: newHistory.length - 1 };
  }),
  undo: () => set((state) => {
    if (state.historyIdx < 0) return state; // Nothing to undo
    const snapshotToRestore = state.history[state.historyIdx].snapshot;

    // Dispatch event so AppContext can sync
    setTimeout(() => window.dispatchEvent(new CustomEvent('zustand-undo')), 0);

    return {
      dataTable: JSON.parse(JSON.stringify(snapshotToRestore)),
      historyIdx: state.historyIdx - 1
    };
  }),

  // Wave 2 - Selection, Toggles, Measure
  multiSelectedIds: [],
  toggleMultiSelect: (id) => set((state) => {
      const isSelected = state.multiSelectedIds.includes(id);
      return {
          multiSelectedIds: isSelected
              ? state.multiSelectedIds.filter(i => i !== id)
              : [...state.multiSelectedIds, id],
          selectedElementId: !isSelected ? id : (state.selectedElementId === id ? null : state.selectedElementId)
      };
  }),
  setMultiSelect: (ids) => set({ multiSelectedIds: ids }),
  clearMultiSelect: () => set({ multiSelectedIds: [] }),
  deleteElements: (ids) => set((state) => {
      const updated = state.dataTable.filter(el => !ids.includes(el._rowIndex));
      const reindexed = updated.map((el, i) => ({ ...el, _rowIndex: i + 1 }));
      return { dataTable: reindexed, multiSelectedIds: [], selectedElementId: null };
  }),

  dragAxisLock: null, // 'X' | 'Y' | 'Z' | null
  setDragAxisLock: (axis) => set({ dragAxisLock: axis }),

  showEPLabels: false,
  setShowEPLabels: (show) => set({ showEPLabels: show }),

  showGapRadar: false,
  setShowGapRadar: (show) => set({ showGapRadar: show }),

  measurePts: [],
  addMeasurePt: (pt) => set((state) => {
      if (state.measurePts.length >= 2) return { measurePts: [pt] };
      return { measurePts: [...state.measurePts, pt] };
  }),
  clearMeasure: () => set({ measurePts: [] }),

  // Cursor Snap Layer State
  cursorSnapPoint: null,
  setCursorSnapPoint: (pt) => set({ cursorSnapPoint: pt }),

  // Color Modes and Ortho
  colorMode: 'TYPE',
  setColorMode: (mode) => set({ colorMode: mode }),
  orthoMode: false,
  toggleOrthoMode: () => set((state) => ({ orthoMode: !state.orthoMode })),

  // Visibility toggles
  hiddenElementIds: [],
  hideSelected: () => set((state) => {
      const idsToHide = state.multiSelectedIds.length > 0 ? state.multiSelectedIds : (state.selectedElementId ? [state.selectedElementId] : []);
      return { hiddenElementIds: [...new Set([...state.hiddenElementIds, ...idsToHide])], multiSelectedIds: [], selectedElementId: null };
  }),
  isolateSelected: () => set((state) => {
      const idsToKeep = state.multiSelectedIds.length > 0 ? state.multiSelectedIds : (state.selectedElementId ? [state.selectedElementId] : []);
      if (idsToKeep.length === 0) return state;
      const allIds = state.dataTable.map(r => r._rowIndex);
      const idsToHide = allIds.filter(id => !idsToKeep.includes(id));
      return { hiddenElementIds: idsToHide };
  }),
  unhideAll: () => set({ hiddenElementIds: [] }),

  clippingPlaneEnabled: false,
  setClippingPlaneEnabled: (enabled) => set({ clippingPlaneEnabled: enabled }),

  // Camera Persistence
  cameraPersistenceEnabled: false,
  setCameraPersistenceEnabled: (enabled) => set({ cameraPersistenceEnabled: enabled }),

  // Highlighting/Interaction state for the canvas
  selectedElementId: null,
  hoveredElementId: null,

  // Interaction handlers
  setSelected: (id) => set({ selectedElementId: id }),
  setHovered: (id) => set({ hoveredElementId: id }),

  // Proposals emitted from the SmartFixer
  proposals: [],

  // Method to approve/reject a proposal directly from Canvas
  setProposalStatus: (rowIndex, status) => set((state) => {
      // Find proposal matching the row and update its status
      const updatedProposals = state.proposals.map(prop => {
          if (prop.elementA?._rowIndex === rowIndex || prop.elementB?._rowIndex === rowIndex) {
              return { ...prop, _fixApproved: status };
          }
          return prop;
      });
      // Also sync back to dataTable so it is reflected globally when re-synced
      const updatedTable = state.dataTable.map(r =>
          r._rowIndex === rowIndex ? { ...r, _fixApproved: status } : r
      );

      // Need a way to tell the app context to sync from zustand.
      // We will dispatch a custom window event that StatusBar/AppContext can listen to.
      window.dispatchEvent(new CustomEvent('zustand-fix-status-changed', {
          detail: { rowIndex, status }
      }));

      return { proposals: updatedProposals, dataTable: updatedTable };
  }),

  // Highlighting/Interaction state for the canvas
  selectedElementId: null,
  hoveredElementId: null,

  // Sync function to mirror AppContext if required,
  // or act as the standalone state manager.
  setDataTable: (table) => set({ dataTable: table }),

  setProposals: (proposals) => set({ proposals }),

  // Interaction handlers
  setSelected: (id) => set({ selectedElementId: id }),
  setHovered: (id) => set({ hoveredElementId: id }),

  // A helper method that safely retrieves pipes only
  getPipes: () => get().dataTable.filter(r => (r.type || "").toUpperCase() === 'PIPE'),

  // A helper method that safely retrieves all non-PIPE components for distinct 3D rendering
  getImmutables: () => get().dataTable.filter(r => (r.type || "").toUpperCase() !== 'PIPE' && (r.type || "").toUpperCase() !== 'SUPPORT'),

  // All draggable components (pipes + fittings, excluding SUPPORT)
  getAllDraggable: () => get().dataTable.filter(r => (r.type || "").toUpperCase() !== 'SUPPORT'),
}));
