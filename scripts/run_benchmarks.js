import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateInputRows } from '../src/utils/ZodSchemas.js';
import { runDataProcessor } from '../src/engine/DataProcessor.js';
import { runValidationChecklist } from '../src/engine/Validator.js';
import { PcfTopologyGraph2, applyApprovedMutations } from '../src/engine/PcfTopologyGraph2.js';
import { applyFixes } from '../src/engine/FixApplicator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BENCHMARKS_DIR = path.join(__dirname, '../tests/benchmarks');

const config = {
    snapTolerance: 5,
    maxGapFill: 50,
    axisThreshold: 1.0,
    angleTolerance: 1.5,
    pcfAddon003: true,
    smartFixer: {
        chainingStrategy: "strict_sequential"
    }
};

class MockLogger {
    constructor() {
        this.logs = [];
    }
    push(log) {
        this.logs.push(log);
    }
    getLog() {
        return this.logs;
    }
    print() {
        this.logs.forEach(l => {
            if (l.type === 'Info') return;
            console.log(`[${l.type}] ${l.stage ? l.stage + ':' : ''} ${l.message}`);
        });
    }
}

// Minimal headless PCF parser (re-implemented from ImportExport.js to work in Node)
function parsePCFSync(text) {
    const lines = text.split(/\r?\n/);
    const rawRows = [];
    let currentRow = null;
    let rowIndex = 1;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (["ISOGEN-FILES", "UNITS-BORE", "UNITS-CO-ORDS", "UNITS-WEIGHT", "UNITS-BOLT-DIA", "UNITS-BOLT-LENGTH", "PIPELINE-REFERENCE", "PROJECT-IDENTIFIER", "AREA"].some(h => line.startsWith(h))) {
            continue;
        }

        if (line.startsWith("MESSAGE-SQUARE")) {
            if (currentRow) rawRows.push(currentRow);
            currentRow = { _rowIndex: rowIndex++, type: "UNKNOWN", ca: {}, _isMessageSquare: true };
            continue;
        }

        if (!line.startsWith(" ") && !line.startsWith("\t")) {
            if (currentRow && currentRow._isMessageSquare) {
                currentRow.type = trimmed;
                currentRow._isMessageSquare = false;
            } else {
                if (currentRow) rawRows.push(currentRow);
                currentRow = { _rowIndex: rowIndex++, type: trimmed, ca: {} };
            }
            continue;
        }

        if (currentRow) {
            const parts = trimmed.split(/\s+/);
        let key = parts[0];
            if (currentRow._isMessageSquare) {
                if (!currentRow.text) currentRow.text = trimmed;
            // Clean malformed OLET MSG SQUARE (BM5)
            if (currentRow.text.includes("X") && currentRow.text.includes("Y") && currentRow.text.includes("Z")) {
                currentRow.type = trimmed.split(/\s+/)[0]; // Extract the real type
                currentRow._isMessageSquare = false;
                key = currentRow.type;
            } else {
                continue;
            }
            }
            if (key !== "END-POINT" && key !== "CENTRE-POINT" && key !== "BRANCH1-POINT" && key !== "CO-ORDS" && !key.startsWith("<") && !key.startsWith("COMPONENT-ATTRIBUTE") && !key.startsWith("WEIGHT") && !key.startsWith("ITEM-CODE") && !key.startsWith("ITEM-DESCRIPTION") && !key.startsWith("FABRICATION-ITEM") && !key.startsWith("PIPING-SPEC") && !key.startsWith("TRACING-SPEC") && !key.startsWith("INSULATION-SPEC") && !key.startsWith("PAINTING-SPEC") && !key.startsWith("CONTINUATION")) {
                if (!currentRow.text) currentRow.text = trimmed;
            }

            if (key === "END-POINT" && parts.length >= 5) {
                const pt = { x: Number(parts[1]), y: Number(parts[2]), z: Number(parts[3]) };
                currentRow.bore = Number(parts[4]);
                if (!currentRow.ep1) currentRow.ep1 = pt;
                else currentRow.ep2 = pt;
            } else if (key === "CENTRE-POINT" && parts.length >= 5) {
                currentRow.cp = { x: Number(parts[1]), y: Number(parts[2]), z: Number(parts[3]) };
                if (!currentRow.bore) currentRow.bore = Number(parts[4]);
            } else if (key === "BRANCH1-POINT" && parts.length >= 5) {
                currentRow.bp = { x: Number(parts[1]), y: Number(parts[2]), z: Number(parts[3]) };
                currentRow.branchBore = Number(parts[4]);
            } else if (key === "CO-ORDS" && parts.length >= 5) {
                currentRow.supportCoor = { x: Number(parts[1]), y: Number(parts[2]), z: Number(parts[3]) };
            } else if (key === "<SKEY>") {
                currentRow.skey = parts[1];
            } else if (key === "<SUPPORT_NAME>") {
                currentRow.supportName = parts[1];
            } else if (key === "<SUPPORT_GUID>") {
                currentRow.supportGuid = parts[1];
            } else if (key.startsWith("COMPONENT-ATTRIBUTE")) {
                const caNum = key.replace("COMPONENT-ATTRIBUTE", "");
                currentRow.ca[caNum] = parts.slice(1).join(" ");
            }
        }
    }
    if (currentRow) rawRows.push(currentRow);
    return validateInputRows(rawRows);
}

function runBenchmark(file) {
    console.log(`\n======================================================`);
    console.log(`Running Benchmark: ${file}`);
    console.log(`======================================================`);

    const filePath = path.join(BENCHMARKS_DIR, file);
    const pcfText = fs.readFileSync(filePath, 'utf-8');

    const logger = new MockLogger();
    let dataTable = parsePCFSync(pcfText);

    console.log(`[PARSE] Parsed ${dataTable.length} rows.`);

    dataTable = runDataProcessor(dataTable, config, logger);
    console.log(`[PROCESS] Processed data table geometry/bores.`);

    runValidationChecklist(dataTable, config, logger, "1");
    const v1Log = logger.getLog().filter(l => l.stage === "VALIDATION" && (l.type === "Error" || l.type === "Warning"));
    console.log(`[VALIDATE] Found ${v1Log.length} syntax warnings/errors.`);

    // Smart Fix Phase
    const smartFixResult = PcfTopologyGraph2(dataTable, config, logger);
    console.log(`[TOPOLOGY] SmartFix pass 1 & 2 complete.`);

    // Check proposals
    const proposals = smartFixResult.proposals || [];
    console.log(`[PROPOSALS] Generated ${proposals.length} fixing proposals.`);
    proposals.forEach(p => {
        console.log(`  -> [${p.fixType}]: ${p.description}`);
    });

    // Auto-Approve all proposals
    proposals.forEach(p => p._fixApproved = true);

    const updatedTable = applyApprovedMutations(dataTable, proposals, logger, config);

    console.log(`[APPLY] FixApplicator applied changes.`);

    // Evaluate output accuracy (did the missing data get fixed?)
    evaluateAccuracy(file, updatedTable);
}

function evaluateAccuracy(file, finalTable) {
    console.log(`\n[ACCURACY EVALUATION: ${file}]`);
    let passed = 0;
    let failed = 0;

    const assertEq = (desc, actual, expected) => {
        if (actual === expected) {
            console.log(`  ✅ PASS: ${desc} (${actual})`);
            passed++;
        } else {
            console.log(`  ❌ FAIL: ${desc} (Expected ${expected}, got ${actual})`);
            failed++;
        }
    };
    const assertExists = (desc, obj) => {
        if (obj !== undefined && obj !== null) {
            console.log(`  ✅ PASS: ${desc} exists`);
            passed++;
        } else {
            console.log(`  ❌ FAIL: ${desc} is missing`);
            failed++;
        }
    };

    if (file === 'BM1_Gaps_Overlaps.pcf') {
        const pipe2 = finalTable.find(r => r.refNo === "2" || (r.type==="PIPE" && r.deltaX===1000 && r._rowIndex===2));
        assertEq("BM1: PIPE-2 snapped to PIPE-1 (Start X=1000)", pipe2?.ep1?.x, 1000);

        const pipe4 = finalTable.find(r => r._rowIndex===5); // originally overlapped by 500
        assertEq("BM1: PIPE-4 trimmed (Start X=2555)", pipe4?.ep1?.x, 2555);
    }

    if (file === 'BM2_MultiAxis_NonPipeGaps.pcf') {
        const pipe2 = finalTable.find(r => r._rowIndex===2);
        assertEq("BM2: Multi-Axis Gap snapped to PIPE-1 (Start X=1000)", pipe2?.ep1?.x, 1000);
        assertEq("BM2: Multi-Axis Gap snapped to PIPE-1 (Start Y=0)", pipe2?.ep1?.y, 0);

        const valve = finalTable.find(r => r.type === "VALVE");
        assertEq("BM2: Valve translated to Flange face (Start X=2060)", valve?.ep1?.x, 2060);
    }

    if (file === 'BM3_TeeAnomalies_MissingReducer.pcf') {
        const tee = finalTable.find(r => r.type === "TEE");
        assertEq("BM3: Tee Centre-Point X recalculated", tee?.cp?.x, 1100);
        assertEq("BM3: Tee Centre-Point Y recalculated", tee?.cp?.y, 0);
        assertEq("BM3: Tee Branch1-Point reconstructed", tee?.bp?.x, 1100);

        const reducer = finalTable.find(r => r.type === "REDUCER");
        assertExists("BM3: Synthetic REDUCER injected", reducer);
    }

    if (file === 'BM4_ElbowCP_MissingRefNo.pcf') {
        const bend = finalTable.find(r => r.type === "BEND");
        assertExists("BM4: BEND Centre-Point synthesized", bend?.cp);

        const pipe = finalTable.find(r => r.type === "PIPE");
        assertExists("BM4: Fallback RefNo generated for PIPE", pipe?.refNo);
        if (pipe?.refNo) {
            const hasUnknown = pipe.refNo.includes("UNKNOWN");
            assertEq("BM4: RefNo handling executed", hasUnknown, true);
        }
    }

    if (file === 'BM5_OletSyntax_MsgSquare.pcf') {
        const olet = finalTable.find(r => r.type === "OLET");
        assertEq("BM5: OLET Msg Square cleaned (type mapped)", olet?.type, "OLET");
        assertExists("BM5: OLET Centre-Point injected", olet?.cp);
        assertEq("BM5: OLET Bore inferred from branch", olet?.branchBore, 50);
    }

    if (file === 'BM6_MissingRVAssembly.pcf') {
        const synthValves = finalTable.filter(r => r.type === "VALVE" && r._isSynthetic);
        assertEq("BM6: 2 Synthetic Valves Injected", synthValves.length, 2);
    }

    if (file === 'BM_P1_Gaps_Overlaps.pcf') {
        const gapPipe = finalTable.find(r => r._isSynthetic && r.type === "PIPE");
        assertExists("New_BM1: Synthetic spool injected for 1000mm gap", gapPipe);

        // Foldback check
        const hasFoldback = finalTable.find(r => r.type === "PIPE" && Math.abs(r.ep1.x - r.ep2.x) === 0 && Math.abs(r.ep1.y - r.ep2.y) === 0);
        assertEq("New_BM1: Foldback pipe handled (deleted/merged)", hasFoldback !== undefined, false);
    }

    if (file === 'BM_P1_HugeSkews_Missing.pcf') {
        const synthTee = finalTable.find(r => r.type === "TEE" && r._isSynthetic);
        assertExists("New_BM2: Missing TEE synthesized", synthTee);

        const synthOlet = finalTable.find(r => r.type === "OLET" && r._isSynthetic);
        assertExists("New_BM2: Missing OLET synthesized", synthOlet);
    }

    if (file === 'BM_P2_Fittings_MissingValves.pcf') {
        const gasket = finalTable.find(r => r.type === "GASKET" && r._isSynthetic);
        assertExists("New_BM3: Missing Gasket injected for 3mm gap", gasket);

        const spool = finalTable.find(r => r.type === "PIPE" && r._isSynthetic && r.len1 && r.len1 < 100);
        assertExists("New_BM3: Missing small spool injected for 50mm flange gap", spool);
    }

    console.log(`[RESULT] Passed: ${passed}, Failed: ${failed}`);
}

const files = fs.readdirSync(BENCHMARKS_DIR).filter(f => f.endsWith('.pcf'));
for (const file of files) {
    try {
        runBenchmark(file);
    } catch (e) {
        console.error(`❌ CRASH while processing ${file}: ${e.message}`);
    }
}
