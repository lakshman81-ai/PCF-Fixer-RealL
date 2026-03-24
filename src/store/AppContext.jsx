import React, { createContext, useReducer, useContext } from 'react';

const initialState = {
  dataTable: [], // Will now serve as stage 1 data table source of truth to avoid breaking legacy code where possible
  stage2Data: [], // Geometry focus data table
  stage3Data: [], // Final check data table
  config: {
    decimals: 4,
    angleFormat: "degrees",
    enabledChecks: JSON.parse(localStorage.getItem('enabledValidationChecks')) || {
        V1: true, V2: true, V3: true, V4: true, V5: true,
        V6: true, V7: true, V8: true, V9: true, V10: true,
        V11: true, V12: true, V13: false, V14: true, V15: true,
        V16: true, V17: true, V18: true, V19: false, V20: true,
        V21: true, V22: true, V23: true, V24: true
    },
    pteMode: {
      autoMultiPassMode: true,
      sequentialMode: true,
      lineKeyMode: false,
      lineKeyColumn: "pipelineRef",
      boreRatioMin: 0.7,
      boreRatioMax: 1.5,
      sweepRadiusMinMultiplier: 0.2,
      sweepRadiusMax: 13000,
    },
    smartFixer: {
      dynamicScoring: false,
      rayShooter: {
        enabled: true,
        tubeTolerance: 25.0,
        pass1SameBore: true,
        pass2AnyBore: true,
        pass3Resolved: false,
        pass4GlobalAxis: true
      },
      minGap: 6,
      connectionTolerance: 25.0,
      gridSnapResolution: 1.0,
      maxSinglePlaneRun: 12000,
      maxOverlap: 1000,
      minPipeSize: 0,
      minComponentSize: 3,
      threePlaneSkewLimit: 2000,
      twoPlaneSkewLimit: 3000,
      maxDiagonalGap: 6000,
      microPipeThreshold: 0.0,
      microFittingThreshold: 1.0,
      negligibleGap: 1.0,
      autoFillMaxGap: 25.0,
      reviewGapMax: 100.0,
      autoTrimMaxOverlap: 25.0,
      silentSnapThreshold: 2.0,
      warnSnapThreshold: 10.0,
      enablePass3A: true,
      minApprovalScore: 10,
      weights: {
        lineKey: 10,
        sizeRatio: 5,
        elementalAxis: 3,
        globalAxis: 2
      },
      autoDeleteFoldbackMax: 25.0,
      pathfindingEnabled: true,
      pathfindingGridResolution: 100,
      pathfindingMaxCells: 6000,
      pathfindingMaxDistance: 15000,
      offAxisThreshold: 0.5,
      diagonalMinorThreshold: 2.0,
      fittingDimensionTolerance: 0.20,
      bendRadiusTolerance: 0.05,
      minTangentMultiplier: 1.0,
      closureWarningThreshold: 0.0,
      closureErrorThreshold: 50.0,
      maxBoreForInchDetection: 48,
      oletMaxRatioWarning: 0.5,
      oletMaxRatioError: 0.8,
      branchPerpendicularityWarn: 5.0,
      branchPerpendicularityError: 15.0,
      horizontalElevationDrift: 2.0,
      minPipeRatio: 0.10,
      noSupportAlertLength: 10000.0,
    },
    pipe_OD: {},
    catalog_dimensions: {},
    valve_ftf: {},
    tee_C_dimension: {},
    specValidationEnabled: false,
    specDatabase: {},
  },
  log: [],
  history: [],
  smartFix: {
    status: "idle",
    pass: 1,
    graph: null,
    chains: [],
    proposedFixes: [],
    appliedFixes: [],
    chainSummary: null,
    fixSummary: null,
    validationDone: false,   // true after Phase 1 runs → unlocks Smart Fix
    smartFixPass: 0,         // 1 after first Apply Fixes → unlocks Second Pass
  }
};

function reducer(state, action) {
  switch (action.type) {
    case "RESET_ALL":
      return {
          ...state,
          dataTable: [],
          stage2Data: [],
          stage3Data: [],
          log: [],
          history: [],
          statusMessage: "Ready",
          smartFix: { status: "idle", validationDone: false, smartFixPass: 0, graph: null, chains: null, chainSummary: null }
      };
    case "SET_DATA_TABLE":
      // We assume SET_DATA_TABLE maps to stage 1 (Syntax base) on import
      return { ...state, dataTable: action.payload, history: [] }; // Reset history on new file
    case "SET_STAGE_2_DATA":
      return { ...state, stage2Data: action.payload, history: [] };
    case "UPDATE_STAGE2_ROW_COORDS": {
      // Payload: { rowIndex, coords: { ep1?, ep2?, cp?, bp? } }
      const updated = state.stage2Data.map(row =>
        row._rowIndex === action.payload.rowIndex
          ? { ...row, ...action.payload.coords }
          : row
      );
      return { ...state, stage2Data: updated };
    }
    case "SET_STAGE_3_DATA":
      return { ...state, stage3Data: action.payload };
    case "SET_CONFIG":
      return { ...state, config: { ...state.config, ...action.payload } };
    case "ADD_LOG":
      return { ...state, log: [...state.log, action.payload] };
    case "CLEAR_LOG":
      return { ...state, log: [] };
    case "SET_STATUS_MESSAGE":
      return { ...state, statusMessage: action.payload };
    case "SET_SMART_FIX_STATUS":
      return { ...state, smartFix: { ...state.smartFix, status: action.status } };
    case "SET_VALIDATION_DONE":
      return { ...state, smartFix: { ...state.smartFix, validationDone: true, status: "validated" } };
    case "SMART_FIX_COMPLETE":
      return {
        ...state,
        smartFix: {
          ...state.smartFix,
          status: "previewing",
          graph: action.payload.graph,
          chains: action.payload.chains,
          chainSummary: action.payload.summary,
        },
        log: [...state.log]
      };
    case "FIXES_APPLIED": {
      const newPass = (state.smartFix.smartFixPass || 0) + 1;
      return {
        ...state,
        history: [...state.history, structuredClone(state.stage2Data)],
        stage2Data: action.payload.updatedTable,
        smartFix: {
          ...state.smartFix,
          status: "applied",
          smartFixPass: newPass,
          appliedFixes: action.payload.applied,
          fixSummary: {
            deleteCount: action.payload.deleteCount,
            insertCount: action.payload.insertCount,
            totalApplied: action.payload.applied.length,
          },
        },
      };
    }
    case "UNDO_FIXES":
      if (state.history.length === 0) return state;
      const prevTable = state.history[state.history.length - 1];
      const newHistory = state.history.slice(0, -1);
      return {
        ...state,
        stage2Data: prevTable,
        history: newHistory,
        smartFix: {
          ...state.smartFix,
          status: "previewing",
          smartFixPass: Math.max(0, (state.smartFix.smartFixPass || 1) - 1),
        }
      };
    default:
      return state;
  }
}

const AppContext = createContext();

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  return useContext(AppContext);
}
