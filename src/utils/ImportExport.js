import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { validateInputRows } from './ZodSchemas.js';

export async function parseExcelOrCSV(file, config) {
  return new Promise((resolve, reject) => {
    const isCSV = file.name.toLowerCase().endsWith('.csv');

    if (isCSV) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const rawRows = results.data;
          resolve(mapHeadersAndValidate(rawRows, config));
        },
        error: (err) => reject(err)
      });
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(firstSheet);
        resolve(mapHeadersAndValidate(rawRows, config));
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    }
  });
}

function mapHeadersAndValidate(rawRows, config) {
  const normalizedRows = rawRows.map((row, index) => {
    const getVal = (keys) => {
      // Allow partial matches or exact lowercased matches
      const k = Object.keys(row).find(actualKey => {
        const normActual = actualKey.toLowerCase().trim();
        return keys.some(expected => normActual.includes(expected));
      });
      return k ? row[k] : undefined;
    };

    const parseCoord = (str) => {
      if (!str) return null;
      // Handle both string coordinates and objects if already parsed
      if (typeof str === 'object' && str.x !== undefined) return str;
      const parts = String(str).split(/[,\s]+/).map(Number).filter(n => !isNaN(n));
      if (parts.length >= 3) return { x: parts[0], y: parts[1], z: parts[2] };
      return null;
    };

    return {
      _rowIndex: index + 1,
      type: getVal(['type', 'component', 'fitting']) || 'UNKNOWN',
      bore: Number(getVal(['bore', 'size', 'dia'])) || 0,
      ep1: parseCoord(getVal(['ep1', 'ep1 coords', 'start'])),
      ep2: parseCoord(getVal(['ep2', 'ep2 coords', 'end'])),
      cp: parseCoord(getVal(['cp', 'cp coords', 'center'])),
      bp: parseCoord(getVal(['bp', 'bp coords', 'branch'])),
      ca: {
        1: getVal(['ca1', 'pressure']),
        2: getVal(['ca2', 'temp']),
        3: getVal(['ca3', 'material']),
        4: getVal(['ca4', 'thickness']),
      },
      skey: getVal(['skey']),
    };
  });

  return validateInputRows(normalizedRows);
}

export async function parsePCF(file, config) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split(/\r?\n/);

        const rawRows = [];
        let currentRow = null;
        let rowIndex = 1;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Ignore header items for data table parsing
          if (["ISOGEN-FILES", "UNITS-BORE", "UNITS-CO-ORDS", "UNITS-WEIGHT", "UNITS-BOLT-DIA", "UNITS-BOLT-LENGTH", "PIPELINE-REFERENCE", "PROJECT-IDENTIFIER", "AREA"].some(h => line.startsWith(h))) {
            continue;
          }

          if (line.startsWith("MESSAGE-SQUARE")) {
             // We can optionally store that a message square is coming, but wait for the actual block
             if (currentRow) rawRows.push(currentRow);
             currentRow = { _rowIndex: rowIndex++, type: "UNKNOWN", ca: {}, _isMessageSquare: true };
             continue;
          }

          if (!line.startsWith(" ") && !line.startsWith("\t")) {
            // New component
            if (currentRow && currentRow._isMessageSquare) {
               // This means we had a MESSAGE-SQUARE block, and now the actual component starts.
               // We should map the type.
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

               // BM5 Fallback: sometimes the message square contains the type and a malformed string
               if (currentRow.text.includes("X") && currentRow.text.includes("Y") && currentRow.text.includes("Z")) {
                   currentRow.type = trimmed.split(/\s+/)[0];
                   currentRow._isMessageSquare = false;
                   key = currentRow.type;

                   // BM5 Fix: we continue here so it doesn't process "OLET" as a component attribute or crash below.
                   continue;
               } else {
                   continue;
               }
            }

            if (key !== "END-POINT" && key !== "CENTRE-POINT" && key !== "BRANCH1-POINT" && key !== "CO-ORDS" && !key.startsWith("<") && !key.startsWith("COMPONENT-ATTRIBUTE") && !key.startsWith("WEIGHT") && !key.startsWith("ITEM-CODE") && !key.startsWith("ITEM-DESCRIPTION") && !key.startsWith("FABRICATION-ITEM") && !key.startsWith("PIPING-SPEC") && !key.startsWith("TRACING-SPEC") && !key.startsWith("INSULATION-SPEC") && !key.startsWith("PAINTING-SPEC") && !key.startsWith("CONTINUATION")) {
               // This might be the MESSAGE-SQUARE text or other text if not captured
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
        resolve(validateInputRows(rawRows));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsText(file);
  });
}

export async function exportToExcel(dataTable) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('PCF Data');

  sheet.columns = [
    { header: 'Row', key: '_rowIndex', width: 5 },
    { header: 'Type', key: 'type', width: 15 },
    { header: 'Bore', key: 'bore', width: 10 },
    { header: 'EP1', key: 'ep1', width: 30 },
    { header: 'EP2', key: 'ep2', width: 30 },
    { header: 'Fixing Action', key: 'fixingAction', width: 40 },
  ];

  dataTable.forEach(row => {
    const excelRow = sheet.addRow({
      _rowIndex: row._rowIndex,
      type: row.type,
      bore: row.bore,
      ep1: row.ep1 ? `${row.ep1.x} ${row.ep1.y} ${row.ep1.z}` : '',
      ep2: row.ep2 ? `${row.ep2.x} ${row.ep2.y} ${row.ep2.z}` : '',
      fixingAction: row.fixingAction || '',
    });

    if (row.fixingActionTier) {
      const cell = excelRow.getCell('fixingAction');
      if (row.fixingActionTier === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } };
      if (row.fixingActionTier === 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
      if (row.fixingActionTier === 3) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE5D0' } };
      if (row.fixingActionTier === 4) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'PCF_Data_Export.xlsx';
  a.click();
  window.URL.revokeObjectURL(url);
}

export function generatePCFText(dataTable, config) {
  let lines = [];
  lines.push("ISOGEN-FILES ISOGEN.FLS");
  lines.push("UNITS-BORE MM");
  lines.push("UNITS-CO-ORDS MM");
  lines.push("UNITS-WEIGHT KGS");
  lines.push("UNITS-BOLT-DIA MM");
  lines.push("UNITS-BOLT-LENGTH MM");
  lines.push("PIPELINE-REFERENCE export EX-LINE-001");
  lines.push("    PROJECT-IDENTIFIER P1");
  lines.push("    AREA A1");
  lines.push("");

  const formatCoord = (c, b) => {
    const d = config.decimals || 4;
    return `${c.x.toFixed(d)} ${c.y.toFixed(d)} ${c.z.toFixed(d)} ${b.toFixed(d)}`;
  };

  dataTable.forEach(row => {
    if (!row.type || row.type === "UNKNOWN") return;

    lines.push("MESSAGE-SQUARE  ");
    lines.push(`    ${row.type}, RefNo:Row-${row._rowIndex}, SeqNo:${row._rowIndex}`);

    if (row.type === "SUPPORT") {
      lines.push("SUPPORT");
      if (row.supportCoor) lines.push(`    CO-ORDS    ${formatCoord(row.supportCoor, 0)}`);
      lines.push(`    <SUPPORT_NAME>    ${row.supportName || 'RST'}`);
      lines.push(`    <SUPPORT_GUID>    ${row.supportGuid || 'UCI:SUP-1'}`);
    } else {
      lines.push(row.type.toUpperCase());

      if (row.type === "OLET") {
        if (row.cp) lines.push(`    CENTRE-POINT  ${formatCoord(row.cp, row.bore)}`);
        if (row.bp) lines.push(`    BRANCH1-POINT ${formatCoord(row.bp, row.branchBore || 50)}`);
      } else {
        if (row.ep1) lines.push(`    END-POINT    ${formatCoord(row.ep1, row.bore)}`);
        if (row.ep2) lines.push(`    END-POINT    ${formatCoord(row.ep2, row.bore)}`);
        if ((row.type === "BEND" || row.type === "TEE") && row.cp) {
          lines.push(`    CENTRE-POINT  ${formatCoord(row.cp, row.bore)}`);
        }
        if (row.type === "TEE" && row.bp) {
          lines.push(`    BRANCH1-POINT ${formatCoord(row.bp, row.branchBore || row.bore)}`);
        }
      }

      if (row.skey) {
        lines.push(`    <SKEY>  ${row.skey}`);
      }

      if (row.ca) {
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 97, 98].forEach(n => {
          if (row.ca[n] !== undefined && row.ca[n] !== null && row.ca[n] !== "") {
            lines.push(`    COMPONENT-ATTRIBUTE${n}    ${row.ca[n]}`);
          }
        });
      }
    }
    lines.push("");
  });

  return lines.join("\r\n");
}
