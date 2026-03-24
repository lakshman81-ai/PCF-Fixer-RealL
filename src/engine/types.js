// @ts-check
/**
 * types.js
 *
 * Canonical JSDoc typedefs for the PCF Fixer engine.
 * Import these in any engine file with:
 *
 *   // @ts-check
 *   /** @typedef {import('./types.js').PcfCoord} PcfCoord *\/
 *
 * These types are checked by `tsconfig.json` (checkJs: true) and surfaced
 * as intellisense / inline errors in VS Code without requiring a TypeScript
 * migration.
 */

/**
 * A 3-D coordinate as stored in a PCF component row.
 * All fields default to 0 if omitted.
 * @typedef {{ x: number, y: number, z: number }} PcfCoord
 */

/**
 * A single PCF component row after import and sanitisation.
 *
 * @typedef {object} PcfComponent
 * @property {number}         _rowIndex       — 1-based row number from the source file
 * @property {string}         type            — component type: PIPE|BEND|FLANGE|VALVE|TEE|OLET|SUPPORT|…
 * @property {PcfCoord|null}  ep1             — End Point 1 (start of run)
 * @property {PcfCoord|null}  ep2             — End Point 2 (end of run)
 * @property {PcfCoord|null}  cp              — Centre Point (bend/tee pivot)
 * @property {PcfCoord|null}  bp              — Branch Point (tee/olet stub)
 * @property {number}         bore            — Nominal bore in mm
 * @property {number|null}    branchBore      — Branch bore for TEE/OLET (mm)
 * @property {string|null}    skey            — ISOGEN shape key
 * @property {string[]|null}  ca              — Component attributes (ca[1]=pressure, ca[2]=temp, ca[3]=material)
 * @property {string|null}    fixingAction    — Proposed fix description (populated by SmartFixer)
 * @property {number|null}    fixingActionTier — Tier of the proposed fix (1–4)
 * @property {boolean}        _fixApproved    — True if the user approved the fix
 * @property {number}         _passApplied    — Pass number when the fix was applied (0 = not applied)
 * @property {string|null}    _lineKey        — Line key for multi-pass routing
 * @property {string|null}    pipelineRef     — PIPELINE-REFERENCE attribute
 */

/**
 * Accumulated state passed along the chain walk.
 *
 * @typedef {object} WalkContext
 * @property {string|null}   travelAxis       — Dominant travel axis: "X"|"Y"|"Z"|null
 * @property {1|-1|null}     travelDirection  — +1 or -1 along travelAxis
 * @property {number}        currentBore      — Bore of the current run (mm)
 * @property {string}        currentMaterial  — Material string from CA3
 * @property {string}        currentPressure  — Pressure from CA1
 * @property {string}        currentTemp      — Temperature from CA2
 * @property {string}        chainId          — e.g. "Chain-1"
 * @property {PcfCoord}      cumulativeVector — Sum of all component vectors so far
 * @property {number}        pipeLengthSum    — Total pipe length in chain (mm)
 * @property {string|null}   lastFittingType  — Type of the most recent non-PIPE component
 * @property {number}        elevation        — Current Z elevation (mm)
 * @property {number}        depth            — Walk recursion depth
 * @property {number}        pipeSinceLastBend — Pipe length since last BEND (mm, starts Infinity)
 * @property {PcfComponent[]|null} allRows    — All components in the model (for A* obstacle detection)
 */

/**
 * SmartFixer configuration block (subset of the full Config).
 *
 * @typedef {object} SmartFixerConfig
 * @property {boolean}  dynamicScoring
 * @property {number}   minGap
 * @property {number}   connectionTolerance
 * @property {number}   gridSnapResolution
 * @property {number}   maxSinglePlaneRun
 * @property {number}   maxOverlap
 * @property {number}   minPipeSize
 * @property {number}   minComponentSize
 * @property {number}   threePlaneSkewLimit
 * @property {number}   twoPlaneSkewLimit
 * @property {number}   maxDiagonalGap
 * @property {number}   microPipeThreshold
 * @property {number}   microFittingThreshold
 * @property {number}   negligibleGap
 * @property {number}   autoFillMaxGap
 * @property {number}   reviewGapMax
 * @property {number}   autoTrimMaxOverlap
 * @property {number}   silentSnapThreshold
 * @property {number}   warnSnapThreshold
 * @property {boolean}  enablePass3A
 * @property {number}   minApprovalScore
 * @property {boolean}  pathfindingEnabled
 * @property {number}   pathfindingGridResolution
 * @property {number}   pathfindingMaxCells
 * @property {number}   pathfindingMaxDistance
 * @property {number}   offAxisThreshold
 * @property {number}   diagonalMinorThreshold
 */

/**
 * Piping spec database entry.
 *
 * @typedef {object} SpecEntry
 * @property {string}       type          — Expected component type (e.g. "FLANGE")
 * @property {number}       bore          — Expected nominal bore in mm
 * @property {string}       description   — Human-readable label
 * @property {string|null}  [material]    — Optional material/grade (e.g. "ASTM A105")
 */

/**
 * Full application configuration object.
 *
 * @typedef {object} Config
 * @property {number}                     decimals
 * @property {string}                     angleFormat
 * @property {Record<string,boolean>}     enabledChecks
 * @property {object}                     pteMode
 * @property {SmartFixerConfig}           smartFixer
 * @property {Record<string,object>}      pipe_OD
 * @property {Record<string,object>}      catalog_dimensions
 * @property {Record<string,object>}      valve_ftf
 * @property {Record<string,object>}      tee_C_dimension
 * @property {boolean}                    specValidationEnabled
 * @property {Record<string,SpecEntry>}   specDatabase
 * @property {number}                     [currentPass]   — injected at runtime by topology engine
 */

/**
 * A log entry pushed by rules and the walk engine.
 *
 * @typedef {object} LogEntry
 * @property {'Info'|'Warning'|'Error'|'Applied'|'Fix'} type
 * @property {string}         stage
 * @property {string}         [ruleId]
 * @property {number}         [tier]
 * @property {number|string}  [row]
 * @property {string}         message
 * @property {number}         [pass]
 */

/**
 * The log object passed to all rule runners.
 * Identical to LogEntry[], but exposed via a .push method so rules can be
 * tested with plain arrays.
 *
 * @typedef {{ push: (entry: LogEntry) => void }} Logger
 */

export {}; // keep this a module so VS Code treats typedef imports correctly
