import { create } from 'zustand';

// Decoupled, Atomic Zustand store primarily aimed at driving high-performance
// visual updates for the 3D Canvas without forcing global React Context re-renders.

export const useStore = create((set, get) => ({
  // The global source of truth for raw pipe geometries
  dataTable: [],

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

  // Canvas Mode Machine
  canvasMode: 'VIEW', // 'VIEW' | 'CONNECT' | 'BREAK' | 'INSERT_SUPPORT' | 'MEASURE'
  setCanvasMode: (mode) => set({ canvasMode: mode }),

  // Undo Stack
  history: [],
  historyIdx: -1,
  pushHistory: (label) => set((state) => {
    // Take a deep snapshot of the current dataTable
    const snapshot = state.dataTable.map(r => ({
      ...r,
      ep1: r.ep1 ? { ...r.ep1 } : null,
      ep2: r.ep2 ? { ...r.ep2 } : null,
      cp: r.cp ? { ...r.cp } : null,
      bp: r.bp ? { ...r.bp } : null,
    }));

    // Slice off any redo history
    const newHistory = state.history.slice(0, state.historyIdx + 1);
    newHistory.push({ label, data: snapshot });

    // Buffer depth: 20
    if (newHistory.length > 20) {
      newHistory.shift();
    }
    return { history: newHistory, historyIdx: newHistory.length - 1 };
  }),
  undo: () => set((state) => {
    if (state.historyIdx < 0) return state; // Nothing to undo
    const snapshotToRestore = state.history[state.historyIdx].data;
    const newIdx = state.historyIdx - 1;

    window.dispatchEvent(new CustomEvent('zustand-undo'));

    return { dataTable: snapshotToRestore, historyIdx: newIdx };
  }),

  // Selection & Toggles
  multiSelectedIds: [],
  toggleMultiSelect: (id) => set((state) => {
    const isSelected = state.multiSelectedIds.includes(id);
    if (isSelected) {
      return { multiSelectedIds: state.multiSelectedIds.filter(selectedId => selectedId !== id) };
    } else {
      return { multiSelectedIds: [...state.multiSelectedIds, id] };
    }
  }),
  clearMultiSelect: () => set({ multiSelectedIds: [] }),
  deleteElements: (ids) => set((state) => {
    const updatedTable = state.dataTable.filter(r => !ids.includes(r._rowIndex));
    // Important: we also dispatch to AppContext in the CanvasTab
    return { dataTable: updatedTable, multiSelectedIds: [] };
  }),
  dragAxisLock: null, // 'X' | 'Y' | 'Z' | null
  setDragAxisLock: (axis) => set({ dragAxisLock: axis }),
  showEPLabels: false,
  setShowEPLabels: (show) => set({ showEPLabels: show }),
  showGapRadar: false,
  setShowGapRadar: (show) => set({ showGapRadar: show }),

  // Measure tool
  measurePts: [],
  addMeasurePt: (pt) => set((state) => {
    if (state.measurePts.length >= 2) return { measurePts: [pt] }; // reset on 3rd click
    return { measurePts: [...state.measurePts, pt] };
  }),
  clearMeasure: () => set({ measurePts: [] }),

  // Global snapping state
  cursorSnapPoint: null,
  setCursorSnapPoint: (pt) => set({ cursorSnapPoint: pt }),

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
  // Note: We now include SUPPORT components in immutables so they render visibly.
  getImmutables: () => get().dataTable.filter(r => (r.type || "").toUpperCase() !== 'PIPE'),

  // All draggable components (pipes + fittings, excluding SUPPORT)
  getAllDraggable: () => get().dataTable.filter(r => (r.type || "").toUpperCase() !== 'SUPPORT'),
}));
