import React, { useState, useCallback } from 'react';
import { useAppContext } from '../../store/AppContext';
import { Tooltip } from '../components/Tooltip';

export function ConfigTab() {
  const { state, dispatch } = useAppContext();
  const [localConfig, setLocalConfig] = useState(state.config);

  const handleSave = () => {
    dispatch({ type: "SET_CONFIG", payload: localConfig });

    // Explicitly persist enabled validation checks
    if (localConfig.enabledChecks) {
        localStorage.setItem('enabledValidationChecks', JSON.stringify(localConfig.enabledChecks));
    }

    // Push a log for transparency
    dispatch({ type: "ADD_LOG", payload: { type: "Info", message: "Configuration updated successfully." }});
  };

  const updateSmartFixer = (key, val) => {
    setLocalConfig(prev => ({
      ...prev,
      smartFixer: {
        ...prev.smartFixer,
        [key]: parseFloat(val) || 0
      }
    }));
  };

  const [specDbText, setSpecDbText] = useState(() => {
    const db = state.config?.specDatabase;
    return db && Object.keys(db).length > 0 ? JSON.stringify(db, null, 2) : '';
  });
  const [specDbError, setSpecDbError] = useState('');

  const applySpecDb = useCallback(() => {
    if (!specDbText.trim()) {
      setLocalConfig(prev => ({ ...prev, specDatabase: {} }));
      setSpecDbError('');
      return;
    }
    try {
      const parsed = JSON.parse(specDbText);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Must be a JSON object.');
      setLocalConfig(prev => ({ ...prev, specDatabase: parsed }));
      setSpecDbError('');
    } catch (e) {
      setSpecDbError(e.message);
    }
  }, [specDbText]);

  return (
    <div className="p-6 h-[calc(100vh-12rem)] overflow-auto bg-white rounded shadow-sm border border-slate-200">
      <div className="flex justify-between items-center mb-6 border-b pb-4">
        <h2 className="text-xl font-bold text-slate-800">Engine Configuration</h2>
        <button
          onClick={handleSave}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow-sm transition"
        >
          Save Configuration
        </button>
      </div>

      {/* V1-V20 Checks List */}
      <div className="bg-white p-4 rounded border border-slate-200 shadow-sm mb-6">
        <h3 className="font-semibold text-slate-700 mb-3 border-b pb-2">Validation Rules Checklist (V1-V24)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
            {[
              { id: 'V1',  desc: 'Attempt to calculate (0,0,0) coordinates', tip: 'Detects components where all three coordinate fields are exactly zero, which usually indicates a parsing failure or placeholder value. The engine attempts to back-calculate the correct coordinates from neighboring components.' },
              { id: 'V2',  desc: 'Decimal consistency', tip: 'Checks that the number of decimal places used across EP1/EP2/CP coordinates is consistent with the configured precision (1 or 4 decimal places). Mixed precision often causes tolerance mismatches downstream.' },
              { id: 'V3',  desc: 'Bore consistency', tip: 'Flags components whose nominal bore differs from the adjacent piping run bore by more than the configured bore ratio range. Prevents reducers being silently skipped.' },
              { id: 'V4',  desc: 'BEND CP != EP1', tip: 'The Centre Point of a BEND must not coincide with End Point 1. If they are equal, the bend has zero tangent length on one side and will produce a degenerate geometry in stress analysis tools.' },
              { id: 'V5',  desc: 'BEND CP != EP2', tip: 'Symmetric check to V4 for End Point 2. A zero-length tangent on either leg of a bend is physically impossible.' },
              { id: 'V6',  desc: 'BEND CP not collinear', tip: 'Verifies that the CP of a BEND is NOT on the straight line joining EP1 and EP2. If the CP is collinear, the bend angle is effectively 180° or undefined.' },
              { id: 'V7',  desc: 'BEND equidistant legs', tip: 'Checks that dist(CP→EP1) ≈ dist(CP→EP2) within tolerance. Both tangent legs of a standard long-radius bend should be equal.' },
              { id: 'V8',  desc: 'TEE CP at midpoint', tip: 'The Centre Point of a TEE should lie at the midpoint of EP1-EP2 (i.e. on the header centreline). An offset CP indicates an incorrectly placed split point.' },
              { id: 'V9',  desc: 'TEE CP bore matches', tip: 'Ensures the header bore at the TEE CP matches the bore field. A mismatch usually means the wrong component SKEYs are referenced, producing a spurious reducer insertion.' },
              { id: 'V10', desc: 'TEE Branch perpendicular', tip: 'Verifies that the Branch Point vector (CP→BP) is perpendicular to the header axis (EP1→EP2) within the configured angularity threshold. Non-perpendicular branches cause stress analysis failures.' },
              { id: 'V11', desc: 'OLET has no end-points', tip: 'OLETs in ISOGEN PCF format define their position using CP and BP only — EP1/EP2 are not used. This rule flags any OLET that incorrectly carries end-point data.' },
              { id: 'V12', desc: 'SUPPORT has no CAs', tip: 'SUPPORT component attributes (CA fields) should only be populated with specific data (position, GUID). Generic CAs inherited from piping runs often indicate a mis-parse.' },
              { id: 'V13', desc: 'SUPPORT bore is 0', tip: 'Pipe supports do not carry a nominal bore — they are attached to the pipe, not in-line. A non-zero bore on a SUPPORT row is a data entry error.' },
              { id: 'V14', desc: 'Missing <SKEY>', tip: 'Every physical component must have an ISOGEN SKEY (Shape KEY) that maps to a valid symbol shape in the piping spec. A missing SKEY will cause ISOGEN to skip the component silently.' },
              { id: 'V15', desc: 'Coordinate continuity', tip: 'Checks that the end point of each component connects to the start point of the next component within the connection tolerance. Gaps/overlaps larger than the tolerance trigger a smart-fix proposal.' },
              { id: 'V16', desc: 'CA8 usage scope', tip: 'CA8 is a special ISOGEN attribute that must only appear on specific component types (VALVE, FLANGE). This rule flags CA8 usage on components where it is not valid per the ISOGEN spec.' },
              { id: 'V17', desc: 'No EP should be blank or -', tip: 'A coordinate field containing an empty string or literal hyphen "-" indicates the PCF was exported with unpopulated fields. These will cause null-reference errors in the topology engine.' },
              { id: 'V18', desc: 'Bore unit (MM/Inch check)', tip: 'Detects bores that appear to be in imperial inches rather than millimetres (values <= the maxBoreForInchDetection threshold). Cross-unit mixing in a single file causes all bore-ratio calculations to be wrong.' },
              { id: 'V19', desc: 'SUPPORT MSG-SQ tokens', tip: 'Validates that the MESSAGE-SQUARE text on SUPPORT rows uses the prescribed token format. Non-standard tokens are not parsed by downstream AVEVA tools.' },
              { id: 'V20', desc: 'SUPPORT GUID Prefix (UCI:)', tip: 'Support component GUIDs must carry the "UCI:" prefix to be recognized by the AVEVA support placement pipeline. Missing prefix means the support will not be linked to its structural attachment.' },
              { id: 'V21', desc: 'TEE BP Definition/Distance', tip: 'Checks that the Branch Point (BP) is defined and that its distance from the Centre Point (CP) is within a physically plausible range based on the nominal bore. An extreme BP distance usually points to a wrong coordinate frame.' },
              { id: 'V22', desc: 'BEND minimum radius', tip: 'Verifies that the calculated bend radius is at least 1×D (nominally 1.5×D for long-radius bends) based on the nominal bore. Radii below this threshold cannot be manufactured and will be rejected by the stress system.' },
              { id: 'V23', desc: 'OLET CP/BP definition', tip: 'An OLET must have both a Centre Point (the weld point on the header) and a Branch Point (the stub outlet). Missing either causes the ISOGEN symbol to render incorrectly.' },
              { id: 'V24', desc: 'BEND valid angle calculation', tip: 'Back-calculates the bend angle from the three points (EP1, CP, EP2) and checks it is a valid ISOGEN bend angle (e.g. 22.5°, 45°, 90°). Non-standard angles indicate coordinate or model errors.' },
            ].map(({ id, desc, tip }) => {
                const checked = localConfig.enabledChecks ? localConfig.enabledChecks[id] !== false : true;
                return (
                    <div key={id} className="flex items-start space-x-2 py-1">
                        <input
                            type="checkbox"
                            id={`chk-${id}`}
                            className="w-4 h-4 mt-0.5 text-blue-600 rounded border-gray-300"
                            checked={checked}
                            onChange={(e) => {
                                const newChecks = { ...(localConfig.enabledChecks || {}) };
                                newChecks[id] = e.target.checked;
                                setLocalConfig(prev => ({ ...prev, enabledChecks: newChecks }));
                            }}
                        />
                        <label htmlFor={`chk-${id}`} className="text-sm text-slate-700 cursor-pointer leading-tight">
                            <Tooltip text={tip} position="right">
                              <span className="font-semibold w-8 inline-block">{id}:</span> {desc}
                            </Tooltip>
                        </label>
                    </div>
                );
            })}
        </div>

        {/* R-Rule Documentation */}
        <div className="mt-4 pt-4 border-t border-slate-200">
             <h3 className="font-semibold text-slate-700 mb-3">Topological Rules (R-XX) Execution Pipeline</h3>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                 <div className="bg-blue-50 p-3 rounded border border-blue-200">
                     <h4 className="font-bold text-blue-800 mb-2 border-b border-blue-200 pb-1">Phase 1 (Pipe Trimming & Filling)</h4>
                     <ul className="list-disc pl-5 text-blue-900 space-y-1">
                         <li><span className="font-semibold">R1:</span> Pipe Segment Micro-Gap Deletion</li>
                         <li><span className="font-semibold">R2:</span> Pipe Segment Micro-Overlap Trimming</li>
                         <li><span className="font-semibold">V15:</span> Coordinate Continuity Enforcement</li>
                     </ul>
                 </div>
                 <div className="bg-purple-50 p-3 rounded border border-purple-200">
                     <h4 className="font-bold text-purple-800 mb-2 border-b border-purple-200 pb-1">Phase 2 (Topology & Fixes)</h4>
                     <ul className="list-disc pl-5 text-purple-900 space-y-1">
                         <li><span className="font-semibold">R3:</span> Fitting Off-Axis Snapping</li>
                         <li><span className="font-semibold">R4:</span> Orphaned Component Translation</li>
                         <li><span className="font-semibold">R5:</span> Flow Direction Reversal (BEND/FLANGE)</li>
                         <li><span className="font-semibold">R6:</span> Global Axis Topology Search</li>
                     </ul>
                 </div>
             </div>
        </div>
      </div>

      <div className="bg-blue-50 p-4 rounded border border-blue-200 shadow-sm mb-6">
        <h3 className="font-bold text-blue-800 mb-3">Multi-Pass PTE Mode & Line Key Routing</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center space-x-3">
              <input type="checkbox" checked={localConfig.pteMode?.autoMultiPassMode ?? true} onChange={(e) => setLocalConfig(p => ({...p, pteMode: {...p.pteMode, autoMultiPassMode: e.target.checked}}))} className="w-4 h-4 text-blue-600 rounded border-gray-300" />
              <label className="text-sm font-medium text-slate-700">Auto Multi-Pass Mode</label>
            </div>
            <div className="flex items-center space-x-3">
              <input type="checkbox" checked={localConfig.pteMode?.sequentialMode ?? true} onChange={(e) => setLocalConfig(p => ({...p, pteMode: {...p.pteMode, sequentialMode: e.target.checked}}))} className="w-4 h-4 text-blue-600 rounded border-gray-300" />
              <label className="text-sm font-medium text-slate-700">Sequential Walk ON</label>
            </div>
            <div className="flex items-center space-x-3">
              <input type="checkbox" checked={localConfig.pteMode?.lineKeyMode ?? true} onChange={(e) => setLocalConfig(p => ({...p, pteMode: {...p.pteMode, lineKeyMode: e.target.checked}}))} className="w-4 h-4 text-blue-600 rounded border-gray-300" />
              <label className="text-sm font-medium text-slate-700">Line_Key Constraints (if avialable) ON</label>
            </div>
        </div>
        <div className="mt-4 pt-4 border-t border-blue-100 flex items-center space-x-4">
            <label className="text-sm font-semibold text-slate-700">Line_Key Target Column:</label>
            <select
                className="p-1.5 border border-slate-300 rounded text-sm w-48"
                value={localConfig.pteMode?.lineKeyColumn ?? "pipelineRef"}
                onChange={(e) => setLocalConfig(p => ({...p, pteMode: {...p.pteMode, lineKeyColumn: e.target.value}}))}
            >
                <option value="pipelineRef">PIPELINE-REFERENCE</option>
                <option value="text">MESSAGE-SQUARE Text</option>
                <option value="ca97">CA97 (RefNo)</option>
                <option value="ca98">CA98 (SeqNo)</option>
            </select>
            <span className="text-xs text-slate-500 italic">Determines the boundary for multi-pass segment logic.</span>
        </div>
        <div className="mt-4 pt-4 border-t border-blue-100 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="flex flex-col">
              <label className="text-xs text-slate-600 mb-1">Bore Ratio Min</label>
              <input type="number" step="0.1" value={localConfig.pteMode?.boreRatioMin ?? 0.7} onChange={(e) => setLocalConfig(p => ({...p, pteMode: {...p.pteMode, boreRatioMin: parseFloat(e.target.value)}}))} className="p-1 border rounded text-sm font-mono w-full" />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-slate-600 mb-1">Bore Ratio Max</label>
              <input type="number" step="0.1" value={localConfig.pteMode?.boreRatioMax ?? 1.5} onChange={(e) => setLocalConfig(p => ({...p, pteMode: {...p.pteMode, boreRatioMax: parseFloat(e.target.value)}}))} className="p-1 border rounded text-sm font-mono w-full" />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-slate-600 mb-1">Sweep Radii Min (xNB)</label>
              <input type="number" step="0.1" value={localConfig.pteMode?.sweepRadiusMinMultiplier ?? 0.2} onChange={(e) => setLocalConfig(p => ({...p, pteMode: {...p.pteMode, sweepRadiusMinMultiplier: parseFloat(e.target.value)}}))} className="p-1 border rounded text-sm font-mono w-full" />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-slate-600 mb-1">Sweep Radii Max (mm)</label>
              <input type="number" step="10" value={localConfig.pteMode?.sweepRadiusMax ?? 13000} onChange={(e) => setLocalConfig(p => ({...p, pteMode: {...p.pteMode, sweepRadiusMax: parseFloat(e.target.value)}}))} className="p-1 border rounded text-sm font-mono w-full" />
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

        {/* Core Geometry Thresholds */}
        <div className="bg-slate-50 p-4 rounded border border-slate-200 shadow-sm">
          <h3 className="font-semibold text-slate-700 mb-3">Geometry & Heuristics Thresholds</h3>
          <div className="space-y-3">
            <div className="flex flex-col bg-blue-50/50 p-2 rounded gap-1">
              <div className="flex justify-between items-center">
                  <Tooltip text="Pass 3A runs a global fuzzy spatial search after the sequential pass. It attempts to resolve orphaned components that could not be connected during the directional walk by searching the entire model space. This is the most computationally expensive pass — disable on very large files if performance is an issue." position="right">
                    <label className="text-sm text-blue-800 font-medium">Enable Pass 3A (Complex Synthesis)</label>
                  </Tooltip>
                  <input type="checkbox" checked={localConfig.smartFixer.enablePass3A !== false} onChange={(e) => updateSmartFixer('enablePass3A', e.target.checked)} className="w-5 h-5 text-blue-600 bg-white border-slate-300 rounded" />
              </div>
            </div>
            <div className="flex flex-col bg-blue-50/50 p-2 rounded gap-1">
              <div className="flex justify-between items-center">
                  <Tooltip text="Proposals with a confidence score below this threshold are silently dropped. Score 0–100: a high score means the engine is very confident about the spatial connection. Increase this value to only see high-confidence proposals; decrease it to surface more speculative matches." position="right">
                    <label className="text-sm text-blue-800 font-medium">Min Topology Approval Score</label>
                  </Tooltip>
                  <input type="number" step="1" value={localConfig.smartFixer.minApprovalScore ?? 10} onChange={(e) => updateSmartFixer('minApprovalScore', parseFloat(e.target.value))} className="w-24 p-1 border rounded text-right text-sm font-mono" title="Threshold for proposing fixes. Drops below this score."/>
              </div>

              <div className="bg-slate-50 p-3 rounded border border-slate-200 mt-2 space-y-2">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-semibold text-slate-700">Use Dynamic Logarithmic Scoring</span>
                  <input type="checkbox" checked={localConfig.smartFixer.dynamicScoring ?? false} onChange={(e) => updateSmartFixer('dynamicScoring', e.target.checked)} className="form-checkbox h-4 w-4 text-blue-600 rounded"/>
                </label>
                <p className="text-xs text-slate-500 leading-relaxed">
                  When enabled, the <code>Size Ratio</code> score scales dynamically using a logarithmic curve based on actual pipe bore absolute sizes, rather than assigning a flat bonus. It severely penalizes mismatches on small bore piping while being forgiving on main headers.
                </p>
              </div>

              <p className="text-[10px] text-slate-500 italic mt-1 leading-tight">
                <strong>Score Basis:</strong> The engine scores proposals from 0-100 based on weighted metrics: Line_Key Match (30%), Element Axis Alignment (25%), Pipeline Bore Ratio Continuity (25%), Global Sweeping Radius (10%), and Immutable Bounds (10%). Proposals scoring below this threshold are automatically dropped.
              </p>
            </div>
            <div className="flex justify-between items-center">
              <Tooltip text="Pipe segments shorter than this length (mm) are automatically flagged for deletion. These micro-pipes usually arise from rounding errors in CAD exports and cause issues in flexibility analysis tools. Set to 0 to disable automatic micro-pipe deletion." position="right">
                <label className="text-sm text-slate-600">Micro-Pipe Deletion Threshold (mm)</label>
              </Tooltip>
              <input type="number" step="0.1" value={localConfig.smartFixer.microPipeThreshold} onChange={(e) => updateSmartFixer('microPipeThreshold', e.target.value)} className="w-24 p-1 border rounded text-right text-sm font-mono" />
            </div>
            <div className="flex justify-between items-center">
              <Tooltip text="Non-pipe fittings (BEND, FLANGE, VALVE) with a face-to-face length below this value (mm) generate a warning. Very short fittings are usually caused by a data translation error and may not be manufacturable." position="right">
                <label className="text-sm text-slate-600">Micro-Fitting Warning</label>
              </Tooltip>
              <input type="number" step="0.1" value={localConfig.smartFixer.microFittingThreshold} onChange={(e) => updateSmartFixer('microFittingThreshold', e.target.value)} className="w-24 p-1 border rounded text-right text-sm font-mono" />
            </div>
            <div className="flex justify-between items-center">
              <Tooltip text="If a fitting's minor axis offset (the component is slightly off the pipe centreline) is smaller than this value (mm), the engine automatically snaps it back onto the centreline without requiring user approval. A higher threshold is more aggressive — only increase if your data has known systematic off-axis offsets." position="right">
                <label className="text-sm text-slate-600">Off-Axis Snapping</label>
              </Tooltip>
              <input type="number" step="0.1" value={localConfig.smartFixer.diagonalMinorThreshold} onChange={(e) => updateSmartFixer('diagonalMinorThreshold', e.target.value)} className="w-24 p-1 border rounded text-right text-sm font-mono" />
            </div>
          </div>
        </div>

        {/* Ray Shooter Logic */}
        <div className="bg-slate-50 p-4 rounded border border-slate-200 shadow-sm">
          <h3 className="font-semibold text-slate-700 mb-3 flex items-center justify-between">
            <span>Ray Shooter Integration (Stage 1C)</span>
            <label className="flex items-center cursor-pointer">
               <span className="text-xs text-slate-500 mr-2 font-normal">Enable Ray Shooter</span>
               <input type="checkbox" checked={localConfig.smartFixer.rayShooter?.enabled ?? true} onChange={(e) => updateSmartFixer('rayShooter', { ...localConfig.smartFixer.rayShooter, enabled: e.target.checked })} className="form-checkbox h-4 w-4 text-blue-600 rounded"/>
            </label>
          </h3>
          <div className={`space-y-3 ${!(localConfig.smartFixer.rayShooter?.enabled ?? true) ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex justify-between items-center">
              <label className="text-sm text-slate-600" title="Max perpendicular distance from candidate endpoint to ray line">Tube Tolerance (mm)</label>
              <input type="number" step="0.1" value={localConfig.smartFixer.rayShooter?.tubeTolerance ?? 50.0} onChange={(e) => updateSmartFixer('rayShooter', { ...localConfig.smartFixer.rayShooter, tubeTolerance: parseFloat(e.target.value) })} className="w-24 p-1 border rounded text-right text-sm font-mono" />
            </div>

            <div className="pt-2 border-t border-slate-200">
               <label className="flex items-center justify-between cursor-pointer mb-2">
                 <span className="text-sm text-slate-600">Pass 1: Same-Bore Candidates</span>
                 <input type="checkbox" checked={localConfig.smartFixer.rayShooter?.pass1SameBore ?? true} onChange={(e) => updateSmartFixer('rayShooter', { ...localConfig.smartFixer.rayShooter, pass1SameBore: e.target.checked })} className="form-checkbox h-4 w-4 text-blue-600 rounded"/>
               </label>
               <label className="flex items-center justify-between cursor-pointer mb-2">
                 <span className="text-sm text-slate-600">Pass 2: Any-Bore Candidates (Injects Reducers)</span>
                 <input type="checkbox" checked={localConfig.smartFixer.rayShooter?.pass2AnyBore ?? true} onChange={(e) => updateSmartFixer('rayShooter', { ...localConfig.smartFixer.rayShooter, pass2AnyBore: e.target.checked })} className="form-checkbox h-4 w-4 text-blue-600 rounded"/>
               </label>
               <label className="flex items-center justify-between cursor-pointer mb-2">
                 <span className="text-sm text-slate-600" title="Shoot into already-resolved Stage 1A components">Pass 3: Resolved (Stage 1A) Candidates</span>
                 <input type="checkbox" checked={localConfig.smartFixer.rayShooter?.pass3Resolved ?? false} onChange={(e) => updateSmartFixer('rayShooter', { ...localConfig.smartFixer.rayShooter, pass3Resolved: e.target.checked })} className="form-checkbox h-4 w-4 text-blue-600 rounded"/>
               </label>
               <label className="flex items-center justify-between cursor-pointer">
                 <span className="text-sm text-slate-600" title="Shoot along cardinal axes if sequential vector fails">Pass 4: Global Axis Fallback</span>
                 <input type="checkbox" checked={localConfig.smartFixer.rayShooter?.pass4GlobalAxis ?? true} onChange={(e) => updateSmartFixer('rayShooter', { ...localConfig.smartFixer.rayShooter, pass4GlobalAxis: e.target.checked })} className="form-checkbox h-4 w-4 text-blue-600 rounded"/>
               </label>
            </div>
          </div>
        </div>

        {/* Common 3D Cleanup Rules */}
        <div className="bg-slate-50 p-4 rounded border border-slate-200 shadow-sm md:col-span-2">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-slate-700 text-orange-500">Common 3D Cleanup Rules</h3>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={localConfig.smartFixer.enable3DRules !== false}
                onChange={(e) => updateSmartFixer('enable3DRules', e.target.checked)}
                className="w-4 h-4 text-orange-500 border-slate-300 rounded focus:ring-orange-500"
              />
              <span className="text-sm font-medium text-slate-700">Enable 3D Rules</span>
            </label>
          </div>
          <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${localConfig.smartFixer.enable3DRules === false ? 'opacity-50 pointer-events-none' : ''}`}>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-sm font-medium text-slate-700">Max single plane Run (mm)</label>
              </div>
              <input type="number" step="1" value={localConfig.smartFixer.maxSinglePlaneRun ?? 12000} onChange={(e) => updateSmartFixer('maxSinglePlaneRun', parseFloat(e.target.value))} className="w-full p-2 border border-slate-300 rounded text-sm mb-1 bg-white font-mono" />
              <p className="text-xs text-slate-500 italic">Maximum allowed continuous straight length without a break or support.</p>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-sm font-medium text-slate-700">Max Overlap (mm)</label>
              </div>
              <input type="number" step="1" value={localConfig.smartFixer.maxOverlap ?? 1000} onChange={(e) => updateSmartFixer('maxOverlap', parseFloat(e.target.value))} className="w-full p-2 border border-slate-300 rounded text-sm mb-1 bg-white font-mono" />
              <p className="text-xs text-slate-500 italic">Maximum allowed distance two components can physically intersect.</p>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-sm font-medium text-slate-700">Min Pipe Size (mm)</label>
              </div>
              <input type="number" step="1" value={localConfig.smartFixer.minPipeSize ?? 0} onChange={(e) => updateSmartFixer('minPipeSize', parseFloat(e.target.value))} className="w-full p-2 border border-slate-300 rounded text-sm mb-1 bg-white font-mono" />
              <p className="text-xs text-slate-500 italic">Minimum Nominal Bore. Skips advanced merging logic for tubing below this size.</p>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-sm font-medium text-slate-700">Min Component Size (mm)</label>
              </div>
              <input type="number" step="1" value={localConfig.smartFixer.minComponentSize ?? 3} onChange={(e) => updateSmartFixer('minComponentSize', parseFloat(e.target.value))} className="w-full p-2 border border-slate-300 rounded text-sm mb-1 bg-white font-mono" />
              <p className="text-xs text-slate-500 italic">Prevents synthesizing impossible, paper-thin structural components.</p>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-sm font-medium text-slate-700">3-Plane Skew Limit (mm)</label>
              </div>
              <input type="number" step="1" value={localConfig.smartFixer.threePlaneSkewLimit ?? 2000} onChange={(e) => updateSmartFixer('threePlaneSkewLimit', parseFloat(e.target.value))} className="w-full p-2 border border-slate-300 rounded text-sm mb-1 bg-white font-mono" />
              <p className="text-xs text-slate-500 italic">Limits length of synthesized gaps skewed across all three X, Y, and Z axes.</p>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-sm font-medium text-slate-700">2-Plane Skew Limit (mm)</label>
              </div>
              <input type="number" step="1" value={localConfig.smartFixer.twoPlaneSkewLimit ?? 3000} onChange={(e) => updateSmartFixer('twoPlaneSkewLimit', parseFloat(e.target.value))} className="w-full p-2 border border-slate-300 rounded text-sm mb-1 bg-white font-mono" />
              <p className="text-xs text-slate-500 italic">Limits length of synthesized gaps skewed across two axes.</p>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-sm font-medium text-slate-700">Max Diagonal Gap (mm)</label>
              </div>
              <input type="number" step="1" value={localConfig.smartFixer.maxDiagonalGap ?? 6000} onChange={(e) => updateSmartFixer('maxDiagonalGap', parseFloat(e.target.value))} className="w-full p-2 border border-slate-300 rounded text-sm mb-1 bg-white font-mono" />
              <p className="text-xs text-slate-500 italic">Failsafe limit for bridging gaps strictly involving turning components.</p>
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-sm font-medium text-slate-700">Single Axis Slope Tolerance</label>
              </div>
              <input type="number" step="0.001" value={localConfig.smartFixer.singleAxisSlopeTolerance ?? 0.01} onChange={(e) => updateSmartFixer('singleAxisSlopeTolerance', parseFloat(e.target.value))} className="w-full p-2 border border-slate-300 rounded text-sm mb-1 bg-white font-mono" />
              <p className="text-xs text-slate-500 italic">Ratio (e.g. 0.01) to ignore mild slopes on horizontal runs.</p>
            </div>
          </div>
        </div>

        {/* Gap & Overlap Logic */}
        <div className="bg-slate-50 p-4 rounded border border-slate-200 shadow-sm">
          <h3 className="font-semibold text-slate-700 mb-3">Gap & Overlap Limits (mm)</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-sm text-slate-600">Silent Snap Micro-Gap</label>
              <input type="number" step="0.1" value={localConfig.smartFixer.negligibleGap} onChange={(e) => updateSmartFixer('negligibleGap', e.target.value)} className="w-24 p-1 border rounded text-right text-sm font-mono" />
            </div>
            <div className="flex justify-between items-center">
              <label className="text-sm text-slate-600">Auto-Fill Pipe Max Gap</label>
              <input type="number" step="0.1" value={localConfig.smartFixer.autoFillMaxGap} onChange={(e) => updateSmartFixer('autoFillMaxGap', e.target.value)} className="w-24 p-1 border rounded text-right text-sm font-mono" />
            </div>
            <div className="flex justify-between items-center">
              <label className="text-sm text-slate-600">Auto-Trim Max Overlap</label>
              <input type="number" step="0.1" value={localConfig.smartFixer.autoTrimMaxOverlap} onChange={(e) => updateSmartFixer('autoTrimMaxOverlap', e.target.value)} className="w-24 p-1 border rounded text-right text-sm font-mono" />
            </div>
            <div className="flex justify-between items-center">
              <label className="text-sm text-slate-600">Gap Review Warning</label>
              <input type="number" step="0.1" value={localConfig.smartFixer.reviewGapMax} onChange={(e) => updateSmartFixer('reviewGapMax', e.target.value)} className="w-24 p-1 border rounded text-right text-sm font-mono" />
            </div>
          </div>
        </div>

        {/* Topological Constraints */}
        <div className="bg-slate-50 p-4 rounded border border-slate-200 shadow-sm">
          <h3 className="font-semibold text-slate-700 mb-3">Topological Rules</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-sm text-slate-600">Topological Route Closure Alert (mm)</label>
              <input type="number" step="0.1" value={localConfig.smartFixer.closureWarningThreshold} onChange={(e) => updateSmartFixer('closureWarningThreshold', e.target.value)} className="w-24 p-1 border rounded text-right text-sm font-mono" />
            </div>
            <div className="flex justify-between items-center">
              <label className="text-sm text-slate-600">Topological Route Closure Max Gap (mm)</label>
              <input type="number" step="0.1" value={localConfig.smartFixer.closureErrorThreshold} onChange={(e) => updateSmartFixer('closureErrorThreshold', e.target.value)} className="w-24 p-1 border rounded text-right text-sm font-mono" />
            </div>
            <div className="flex justify-between items-center">
              <label className="text-sm text-slate-600">OLET Max Branch Ratio</label>
              <input type="number" step="0.01" value={localConfig.smartFixer.oletMaxRatioError} onChange={(e) => updateSmartFixer('oletMaxRatioError', e.target.value)} className="w-24 p-1 border rounded text-right text-sm font-mono" />
            </div>
             <div className="flex justify-between items-center">
              <label className="text-sm text-slate-600">Connection Tolerance (mm)</label>
              <input type="number" step="0.1" value={localConfig.smartFixer.connectionTolerance} onChange={(e) => updateSmartFixer('connectionTolerance', e.target.value)} className="w-24 p-1 border rounded text-right text-sm font-mono" />
            </div>
          </div>
        </div>

        {/* A* Pathfinding */}
        <div className="bg-green-50 p-4 rounded border border-green-200 shadow-sm">
          <h3 className="font-semibold text-green-900 mb-3 flex items-center justify-between">
            <span>A* Obstacle-Aware Gap Routing</span>
            <label className="flex items-center cursor-pointer gap-2">
              <span className="text-xs text-slate-500 font-normal">Enable</span>
              <input type="checkbox" checked={localConfig.smartFixer.pathfindingEnabled !== false} onChange={(e) => updateSmartFixer('pathfindingEnabled', e.target.checked)} className="w-4 h-4 text-green-600 rounded border-gray-300" />
            </label>
          </h3>
          <p className="text-xs text-green-800 mb-3 leading-relaxed">
            When a multi-axis gap cannot be filled with a single straight pipe, A* searches for an
            obstacle-avoiding axis-aligned route and proposes a multi-segment PATHFIND fix (R-GAP-07).
          </p>
          <div className={`space-y-2 ${localConfig.smartFixer.pathfindingEnabled === false ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex justify-between items-center">
              <label className="text-sm text-slate-600">Grid Resolution (mm/cell)</label>
              <input type="number" step="10" value={localConfig.smartFixer.pathfindingGridResolution ?? 100} onChange={(e) => updateSmartFixer('pathfindingGridResolution', e.target.value)} className="w-24 p-1 border rounded text-right text-sm font-mono" />
            </div>
            <div className="flex justify-between items-center">
              <label className="text-sm text-slate-600">Max Search Cells</label>
              <input type="number" step="500" value={localConfig.smartFixer.pathfindingMaxCells ?? 6000} onChange={(e) => updateSmartFixer('pathfindingMaxCells', e.target.value)} className="w-24 p-1 border rounded text-right text-sm font-mono" />
            </div>
            <div className="flex justify-between items-center">
              <label className="text-sm text-slate-600">Max Routing Distance (mm)</label>
              <input type="number" step="500" value={localConfig.smartFixer.pathfindingMaxDistance ?? 15000} onChange={(e) => updateSmartFixer('pathfindingMaxDistance', e.target.value)} className="w-24 p-1 border rounded text-right text-sm font-mono" />
            </div>
          </div>
        </div>

      </div>

      {/* Material & Spec Database */}
      <div className="bg-amber-50 p-4 rounded border border-amber-200 shadow-sm mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-amber-900">Material &amp; Spec Database (SKEY Cross-Reference)</h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-sm text-slate-600">Enable Spec Validation</span>
            <input
              type="checkbox"
              checked={localConfig.specValidationEnabled ?? false}
              onChange={(e) => setLocalConfig(prev => ({ ...prev, specValidationEnabled: e.target.checked }))}
              className="w-4 h-4 text-amber-600 rounded border-gray-300"
            />
          </label>
        </div>
        <p className="text-xs text-amber-800 mb-3 leading-relaxed">
          Paste a JSON object mapping SKEY codes to spec entries. When enabled, SPEC-01 through SPEC-04 rules
          will cross-reference each component against this database and warn on unknown SKEYs, type mismatches,
          bore mismatches, and material mismatches.
        </p>
        <p className="text-xs text-slate-500 mb-2 font-mono">
          {`{ "FL-WNRF-300": { "type": "FLANGE", "bore": 300, "description": "WN RF Flange 300nb", "material": "ASTM A105" }, ... }`}
        </p>
        <textarea
          className="w-full h-40 p-2 border border-amber-300 rounded font-mono text-xs bg-white resize-y"
          placeholder={'{\n  "FL-WNRF-0300": { "type": "FLANGE", "bore": 300, "description": "WN RF 300nb", "material": "ASTM A105" }\n}'}
          value={specDbText}
          onChange={(e) => setSpecDbText(e.target.value)}
          spellCheck={false}
        />
        {specDbError && (
          <p className="text-xs text-red-600 mt-1 font-semibold">JSON error: {specDbError}</p>
        )}
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={applySpecDb}
            className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded transition font-medium"
          >
            Apply Spec DB
          </button>
          <span className="text-xs text-slate-500">
            {localConfig.specDatabase ? `${Object.keys(localConfig.specDatabase).length} entries loaded` : '0 entries loaded'}
          </span>
        </div>
      </div>

    </div>
  );
}
