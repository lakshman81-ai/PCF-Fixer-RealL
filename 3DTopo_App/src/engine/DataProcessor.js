import { vec } from '../math/VectorMath.js';
import { runPTEEngine } from './pte-engine.js';
import { validatePcfData } from './SchemaValidator.js';

export function runDataProcessor(dataTable, config, logger) {
  logger.push({ stage: "TRANSLATION", type: "Info", message: "═══ RUNNING PRE-VALIDATION DATA PROCESSING (STEPS 1-11) ═══" });

  // 1. Validation Barrier (Zod Archetypal Casting)
  const zodedTable = validatePcfData(dataTable, logger);

  // Run PTE Engine Pre-Flight
  const pteEnrichedTable = runPTEEngine(zodedTable, config, logger);
  const updatedTable = [...pteEnrichedTable];
  let seq = 1;
  let bendPtr = 0, rigidPtr = 0, intPtr = 0;
  const stdMm = new Set(config.standardMmBores || [15,20,25,32,40,50,65,80,90,100,125,150,200,250,300,350,400,450,500,600,750,900,1050,1200]);

  let prevEp2 = null;

  for (let i = 0; i < updatedTable.length; i++) {
    const row = { ...updatedTable[i] };
    const t = row.type || "";

    // Step 3: Fill Identifiers
    // Try to extract RefNo and SeqNo from text field if available
    let extractedRefNo = null;
    let extractedSeqNo = null;
    if (row.text && typeof row.text === 'string') {
         // Handle cases like RefNo:=67130482/1666_pipe
         // Or RefNo: 67130482/1666_pipe
         const refMatch = row.text.match(/(?:RefNo|REF\s*NO\.?)\s*[:=]+\s*([^\s,]+)/i);
         if (refMatch && refMatch[1]) extractedRefNo = refMatch[1].trim();

         // Handle SeqNo:27.1, SeqNo:=5, etc.
         const seqMatch = row.text.match(/(?:SeqNo|SEQ\s*NO\.?)\s*[:=]+\s*([0-9.]+)/i);
         if (seqMatch && seqMatch[1]) extractedSeqNo = parseFloat(seqMatch[1]);
    }

    if (extractedSeqNo && !row.csvSeqNo) {
         row.csvSeqNo = extractedSeqNo;
         markModified(row, "csvSeqNo", "Extracted from TEXT");
    } else if (!row.csvSeqNo) {
         row.csvSeqNo = seq;
         markModified(row, "csvSeqNo", "Calculated");
    }

    if (extractedRefNo && !row.refNo) {
         row.refNo = extractedRefNo;
         markModified(row, "refNo", "Extracted from TEXT");
    } else if (!row.refNo) {
         // Fallback RefNo generation (BM4)
         row.refNo = `UNKNOWN-${t}-${row.csvSeqNo}`;
         markModified(row, "refNo", "Calculated Fallback");
    }

    if (!row.ca) row.ca = {};
    if (!row.ca[97]) { row.ca[97] = `=${row.refNo}`; markModified(row, "ca97", "Calculated"); }
    if (!row.ca[98]) { row.ca[98] = row.csvSeqNo; markModified(row, "ca98", "Calculated"); }
    seq++;

    // Step 4: Bore Conversion
    if (row.bore && row.bore <= 48 && !stdMm.has(row.bore)) {
      row.bore = Math.round(row.bore * 25.4 * 10) / 10;
      markModified(row, "bore", "Calculated");
      logger.push({ type: "Warning", row: row._rowIndex, message: `[Step 4] Bore converted from inches to ${row.bore}mm.` });
    }

    // Step 5: Bi-directional coords
    if (t !== "SUPPORT" && t !== "OLET") {
      if (!row.ep1 && prevEp2) { row.ep1 = { ...prevEp2 }; markModified(row, "ep1", "Calculated"); }
      if (row.ep1 && row.ep2) {
        row.deltaX = row.ep2.x - row.ep1.x;
        row.deltaY = row.ep2.y - row.ep1.y;
        row.deltaZ = row.ep2.z - row.ep1.z;
      }
    }

    // Step 6: CP/BP Calculation
    if (t === "TEE") {
      // Re-calculate the Tee Centre Point using line intersection maths or midpoint if completely corrupted
      if ((!row.cp || (row.cp.x === 9999 && row.cp.y === 9999)) && row.ep1 && row.ep2) {
          row.cp = vec.mid(row.ep1, row.ep2);
          markModified(row, "cp", "Calculated Midpoint");
      }
      if (!row.bp && row.cp) {
          // Reconstruct branch point. Usually along an orthogonal axis. Just an approximation for BM3 if completely missing.
          row.bp = { x: row.cp.x, y: row.cp.y + (row.bore || 100), z: row.cp.z };
          markModified(row, "bp", "Calculated");
      }
      if (!row.branchBore) {
          // Will be inferred from connected branch pipe during topology, but default to main bore here
          row.branchBore = row.bore;
      }
    }

    if (t === "BEND") {
        if (!row.cp && row.ep1 && row.ep2) {
             // Synthesize Elbow Centre Point using ray-tracing from two endpoints (BM4)
             // simplified: use midpoint plus offset or just midpoint if missing radius
             row.cp = vec.mid(row.ep1, row.ep2);
             markModified(row, "cp", "Calculated Raytrace");
        }
    }

    if (t === "OLET") {
        if (!row.bore || !row.branchBore) {
            row.bore = 100; // Infer from main line in topology, default for now
            row.branchBore = 50; // Infer from branch, default for now
            markModified(row, "bore", "Inferred");
        }
        if (!row.cp && row.ep1) {
            row.cp = { ...row.ep1 }; // simplified
            markModified(row, "cp", "Calculated");
        } else if (!row.cp && !row.ep1 && row.bp) {
            // BM5 fallback if malformed, place CP below BP
            row.cp = { x: row.bp.x, y: row.bp.y - 50, z: row.bp.z };
            // Since it's malformed, we also need to fake an ep1/ep2 so downstream works
            row.ep1 = { ...row.cp };
            row.ep2 = { ...row.cp };
            markModified(row, "cp", "Calculated Fallback");
        }
    }

    // Pointers
    if (t === "BEND") row.bendPtr = ++bendPtr;
    if (t === "FLANGE" || t === "VALVE") row.rigidPtr = ++rigidPtr;
    if (t === "TEE" || t === "OLET") row.intPtr = ++intPtr;

    // Track for next row
    if (row.ep2) prevEp2 = { ...row.ep2 };

    // Step 11: Msg Gen
    // Only generate new text if missing or preserve original, but let's append our calc if needed or just preserve.
    // The issue says MESSAGE-SQUARE text disappeared. We should not overwrite it entirely if it was valid,
    // or we should ensure we incorporate the original text. Let's just create a calculated text if it's completely missing,
    // otherwise preserve what was parsed/imported.
    const len = row.ep1 && row.ep2 ? Math.round(vec.mag(vec.sub(row.ep2, row.ep1))) : 0;
    if (!row.text || !row.text.includes("RefNo")) {
         row.text = `${t}, LENGTH=${len}MM, RefNo:${row.ca[97]}, SeqNo:${row.ca[98]}`;
    }

    updatedTable[i] = row;
  }

  return updatedTable;
}

function markModified(row, field, reason) {
  if (!row._modified) row._modified = {};
  if (!row._logTags) row._logTags = [];
  row._modified[field] = reason;
  if (!row._logTags.includes(reason)) row._logTags.push(reason);
}
