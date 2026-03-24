import { z } from "zod";

// Ensure no internal `.catch()` logic on older Zod structures
export const CoordSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  z: z.number().default(0),
}).nullable();

// Use basic primitives. `z.any()` prevents deep object resolution errors.
export const ComponentRowSchema = z.any();

// Schema for Walk Context
export const WalkContextSchema = z.object({
  travelAxis: z.enum(["X", "Y", "Z"]).nullable(),
  travelDirection: z.union([z.literal(1), z.literal(-1)]).nullable(),
  currentBore: z.number(),
  currentMaterial: z.string(),
  currentPressure: z.string(),
  currentTemp: z.string(),
  chainId: z.string(),
  cumulativeVector: CoordSchema,
  pipeLengthSum: z.number(),
  lastFittingType: z.string().nullable(),
  elevation: z.number(),
  depth: z.number(),
  pipeSinceLastBend: z.number(),
});

// Schema for Config
export const ConfigSchema = z.object({
  decimals: z.union([z.literal(1), z.literal(4)]).default(4),
  angleFormat: z.enum(["degrees", "hundredths"]).default("degrees"),
  smartFixer: z.object({
    connectionTolerance: z.number().default(25.0),
    gridSnapResolution: z.number().default(1.0),
    microPipeThreshold: z.number().default(6.0),
    microFittingThreshold: z.number().default(1.0),
    negligibleGap: z.number().default(1.0),
    autoFillMaxGap: z.number().default(25.0),
    reviewGapMax: z.number().default(100.0),
    autoTrimMaxOverlap: z.number().default(25.0),
    silentSnapThreshold: z.number().default(2.0),
    warnSnapThreshold: z.number().default(10.0),
    autoDeleteFoldbackMax: z.number().default(25.0),
    offAxisThreshold: z.number().default(0.5),
    diagonalMinorThreshold: z.number().default(2.0),
    fittingDimensionTolerance: z.number().default(0.20),
    bendRadiusTolerance: z.number().default(0.05),
    minTangentMultiplier: z.number().default(1.0),
    closureWarningThreshold: z.number().default(5.0),
    closureErrorThreshold: z.number().default(50.0),
    maxBoreForInchDetection: z.number().default(48),
    oletMaxRatioWarning: z.number().default(0.5),
    oletMaxRatioError: z.number().default(0.8),
    branchPerpendicularityWarn: z.number().default(5.0),
    branchPerpendicularityError: z.number().default(15.0),
    horizontalElevationDrift: z.number().default(2.0),
    minPipeRatio: z.number().default(0.10),
    noSupportAlertLength: z.number().default(10000.0),
  }).default({}),
  pipe_OD: z.record(z.number()).default({}), // Mock catalog for OD
  catalog_dimensions: z.record(z.any()).default({}), // Mock catalog for lengths
  valve_ftf: z.record(z.any()).default({}), // Mock catalog
  tee_C_dimension: z.record(z.number()).default({}), // Mock catalog
});

// Safe parse helper
export const validateInputRows = (rows) => {
  // Pure JavaScript sanitization instead of strict Zod parsing
  // to avoid unpredictable internal `_zod` state errors.
  return rows.map((r, i) => {
    // Preserve coordinate objects exactly to prevent wiping them out
    const cleanRow = {
      ...r,
      _rowIndex: r._rowIndex || i + 1,
      type: (r.type || 'UNKNOWN').toUpperCase().trim(),
      bore: Number(r.bore) || 0,
      branchBore: r.branchBore ? Number(r.branchBore) : null,
      skey: r.skey || '',
      ca: r.ca || {},
      _modified: r._modified || {},
      _logTags: r._logTags || [],
    };

    // Explicitly copy coordinates if they exist
    if (r.ep1) cleanRow.ep1 = r.ep1;
    if (r.ep2) cleanRow.ep2 = r.ep2;
    if (r.cp) cleanRow.cp = r.cp;
    if (r.bp) cleanRow.bp = r.bp;
    if (r.supportCoor) cleanRow.supportCoor = r.supportCoor;

    return cleanRow;
  });
};
