import { z } from 'zod';

// Soft Coercion to handle empty strings "" which z.coerce.number() fails on
const softNumber = z.union([
    z.number(),
    z.string().transform(v => (v.trim() === '' ? undefined : Number(v))).pipe(z.number().optional()),
    z.undefined(),
    z.null()
]);

// Strict Archetypal Casting for vectors
const VectorSchema = z.object({
  x: softNumber,
  y: softNumber,
  z: softNumber,
});

// Primary validation schema for PCF rows
const PcfElementSchema = z.object({
  _rowIndex: z.number().int(),
  type: z.string().transform((str) => str.toUpperCase()),
  bore: softNumber,
  branchBore: softNumber,
  cpBore: softNumber,
  ep1: VectorSchema.optional().nullable(),
  ep2: VectorSchema.optional().nullable(),
  cp: VectorSchema.optional().nullable(),
  bp: VectorSchema.optional().nullable(),
  supportCoor: VectorSchema.optional().nullable(),
  skey: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
  supportGuid: z.string().optional().nullable(),
  supportName: z.string().optional().nullable(),
  ca: z.record(z.string(), z.any()).optional().nullable(),
  csvSeqNo: z.coerce.string().optional().nullable(),
}).passthrough(); // Allow other keys but strictly type the known ones

export function validatePcfData(dataTable, logger) {
  logger.push({ stage: "TRANSLATION", type: "Info", message: "═══ RUNNING ZOD VALIDATION BARRIER ═══" });

  const validatedTable = [];
  let errorCount = 0;

  for (const row of dataTable) {
    const result = PcfElementSchema.safeParse(row);
    if (result.success) {
      validatedTable.push(result.data);
    } else {
      errorCount++;
      let issues = 'Unknown Zod Error';
      if (result.error && result.error.issues) {
          issues = result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      }
      logger.push({
        stage: "TRANSLATION",
        type: "Error",
        row: row._rowIndex,
        message: `ERROR [ZOD]: Invalid payload casting. Discarding row. Details: ${issues}`
      });
    }
  }

  logger.push({ stage: "TRANSLATION", type: "Info", message: `Zod Validation Complete: ${validatedTable.length} valid rows, ${errorCount} rejected rows.` });

  return validatedTable;
}
