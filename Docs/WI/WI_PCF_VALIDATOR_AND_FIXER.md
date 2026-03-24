# WORK INSTRUCTION — PCF Validator and Fixer (Web App)

## Document ID: WI-PCF-VALIDATOR-001 Rev.0
## For: AI Coding Agent
## Reference: PCF Syntax Master v1.2

---

## 0. EXECUTIVE SUMMARY

Build a **single-page React web application** called **"PCF Validator and Fixer"** that:

1. Imports a raw PCF text file (or Data Table via Excel/CSV).
2. Parses it into an intermediate **Data Table** using PCF Syntax Master v1.2 rules.
3. Runs validation (checklist V1–V20), fixes errors, logs everything.
4. Outputs a corrected PCF text file.

The app has **4 tabs**: Data Table, Config, Debug, Output.

**Tech stack:** React (single `.jsx` artifact), Tailwind CSS, SheetJS (for Excel), PapaParse (for CSV). No backend. Everything runs in-browser.

---

## 1. APPLICATION ARCHITECTURE

```
┌──────────────────────────────────────────────────────────────┐
│                    HEADER BAR                                 │
│  [Import PCF ▼]  [Import Excel/CSV ▼]       App Title        │
├──────────────────────────────────────────────────────────────┤
│  [ Data Table ]  [ Config ]  [ Debug ]  [ Output ]    ← tabs │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                    TAB CONTENT AREA                           │
│                                                              │
│                                                              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  STATUS BAR: "Ready" | "Parsed 17 components" | errors count │
│  [Export Data Table]  [Export PCF]              ← action btns │
└──────────────────────────────────────────────────────────────┘
```

### 1.1 State Management

Use React `useReducer` for centralized state:

```javascript
const initialState = {
  // Source data
  rawPcf: "",                    // Original imported PCF text
  rawExcel: null,                // Original imported Excel/CSV data

  // Core data
  headerRows: [],                // Rows 1-7 (ISOGEN-FILES, UNITS-*, PIPELINE-REF)
  dataTable: [],                 // Array of component row objects
  config: { ...defaultConfig },  // All config settings

  // Processing
  log: [],                       // Array of {type, message, rowIndex, field}
  validationResults: [],         // Array of {id, check, rule, severity, rowIndex, status}
  tallyBefore: {},               // Component counts from import
  tallyAfter: {},                // Component counts after processing

  // Output
  finalPcf: "",                  // Generated corrected PCF text

  // UI
  activeTab: "datatable",        // "datatable" | "config" | "debug" | "output"
  importMode: null,              // "pcf" | "excel" | null
};
```

### 1.2 Data Table Row Object Schema

Each row in `dataTable` is an object:

```javascript
{
  _rowIndex: 0,                // Internal running number
  _modified: {},               // Set of field names that were changed {field: "reason"}
  _logTags: [],                // ["Calculated", "Mock", "Error", "Warning", "Info"]

  csvSeqNo: null,              // CSV SEQ NO (or running number if blank)
  type: "PIPE",                // Component type (uppercase)
  text: "",                    // MESSAGE-SQUARE text
  pipelineRef: "",             // PIPELINE-REFERENCE (for PIPE and header)
  refNo: "",                   // REF NO.
  bore: 0,                     // Bore in mm (converted if needed)

  ep1: {x:0, y:0, z:0},       // EP1 coordinates
  ep2: {x:0, y:0, z:0},       // EP2 coordinates
  cp:  {x:0, y:0, z:0},       // Centre-Point (TEE, BEND)
  bp:  {x:0, y:0, z:0},       // Branch-Point (TEE, OLET)
  branchBore: null,            // Branch bore (TEE, OLET)

  skey: "",                    // <SKEY> value
  supportCoor: {x:0,y:0,z:0}, // SUPPORT CO-ORDS
  supportName: "",             // <SUPPORT_NAME>
  supportGuid: "",             // <SUPPORT_GUID>

  ca: {1:null, 2:null, 3:null, 4:null, 5:null, 6:null,
       7:null, 8:null, 9:null, 10:null, 97:null, 98:null},

  fixingAction: "",

  // Calculated fields
  len1: null, axis1: null,
  len2: null, axis2: null,
  len3: null, axis3: null,
  brlen: null,
  deltaX: null, deltaY: null, deltaZ: null,
  diameter: null, wallThick: null,
  bendPtr: null, rigidPtr: null, intPtr: null,
}
```

---

## 2. PHASE 1 — IMPORT AND PARSING

### 2.1 Import Dialog

Two import paths accessed via buttons in the header bar:

**Path A: Import PCF Text**
- Open a file dialog accepting `.pcf`, `.txt`, `.PCF` files.
- Read file as text. Store in `state.rawPcf`.
- Trigger PCF Parser (§2.3).

**Path B: Import Excel/CSV**
- Open a file dialog accepting `.xlsx`, `.xls`, `.csv`, `.tsv` files.
- For Excel: Use SheetJS (`XLSX.read()`) to parse. Use first sheet.
- For CSV: Use PapaParse.
- Show a **preview modal** of the first 20 rows before confirming import.
- On confirm: Run Fuzzy Header Matching (§2.4) → populate `dataTable`.

### 2.2 Excel/CSV Preview Modal

```
┌─────────────────────────────────────────────┐
│  Preview: "piping_data.xlsx"    [✕ Close]   │
├─────────────────────────────────────────────┤
│  Detected 42 columns, 127 rows              │
│  Header row: Row 1 (auto-detected)          │
│  ┌─────┬──────┬──────┬─────────┐            │
│  │ #   │ Type │ Bore │ EP1...  │            │
│  ├─────┼──────┼──────┼─────────┤            │
│  │ 1   │ PIPE │ 400  │ 96400...│            │
│  │ ... │      │      │         │            │
│  └─────┴──────┴──────┴─────────┘            │
│                                              │
│  Column Mapping (editable):                  │
│  Col A → Type ✓                              │
│  Col B → BORE ✓ (fuzzy: "Dia" → BORE)       │
│  Col C → ??? (unmatched — select manually)   │
│                                              │
│  [Cancel]                    [Confirm Import]│
└─────────────────────────────────────────────┘
```

**Implementation rules:**
- Auto-detect header row (first row with >50% non-numeric, non-empty cells).
- Run fuzzy matching on each header cell against the alias config (§13.1 of PCF Syntax Master v1.2).
- Show match confidence. Allow manual override via dropdown for unmatched columns.
- On confirm: map columns to canonical names, populate `dataTable`.

### 2.3 PCF Text Parser

Parse raw PCF text into `dataTable` rows. This is the **core parser**.

```
ALGORITHM: parse_pcf(text)

1. Split text by lines (handle both \r\n and \n).
2. Initialize headerRows = [], components = [], currentBlock = null.
3. For each line:
   a. Trim whitespace.
   b. If line starts with known header keyword (ISOGEN-FILES, UNITS-*, 
      PIPELINE-REFERENCE, PROJECT-IDENTIFIER, AREA):
      → Add to headerRows.
   
   c. If line == "MESSAGE-SQUARE" (case-insensitive):
      → Start new block. Next non-empty indented line = message text.
      → Parse message text into preview fields (Type, Material, Length, etc.)
   
   d. If line matches a COMPONENT KEYWORD (PIPE, BEND, TEE, FLANGE, VALVE, 
      OLET, REDUCER-CONCENTRIC, REDUCER-ECCENTRIC, SUPPORT):
      → Set currentBlock.type = keyword.
   
   e. If line starts with "    END-POINT" (4-space indent):
      → Parse 4 tokens (X, Y, Z, Bore). Assign to EP1 or EP2 in order.
   
   f. If line starts with "    CENTRE-POINT":
      → Parse 4 tokens → CP.
   
   g. If line starts with "    BRANCH1-POINT":
      → Parse 4 tokens → BP (bore → branchBore).
   
   h. If line starts with "    CO-ORDS":
      → Parse 4 tokens → supportCoor.
   
   i. If line starts with "    <SKEY>":
      → Parse value → skey.
   
   j. If line starts with "    <SUPPORT_NAME>":
      → Parse value → supportName.
   
   k. If line starts with "    <SUPPORT_GUID>":
      → Parse value → supportGuid. Validate "UCI:" prefix.
   
   l. If line starts with "    COMPONENT-ATTRIBUTE":
      → Extract number and value. Store in ca[number].
   
   m. If line starts with "    PIPELINE-REFERENCE" (inside component, not header):
      → Store as pipelineRef on current PIPE block.
   
   n. If line starts with "    ANGLE":
      → Store bend angle.
   
   o. If line starts with "    BEND-RADIUS":
      → Store bend radius.
   
   p. If line starts with "    FLAT-DIRECTION":
      → Store flat direction.
   
   q. Blank line or new MESSAGE-SQUARE/COMPONENT → finalize current block,
      push to components[].

4. Return { headerRows, components }.
```

**CRITICAL — Message-Square Cross-Verification (§Error Fixing, Step 1):**

After parsing, the data from MESSAGE-SQUARE text is treated as **advisory only**. The actual component data (EP1, EP2, CA values, etc.) from the component block lines is **authoritative**. If MESSAGE-SQUARE says `LENGTH=654MM` but EP-derived calculation gives 650mm, the EP data wins.

Log discrepancies as `[Info]`:
```
[Info] Row 5 (PIPE): MESSAGE-SQUARE LENGTH=654 vs EP-calculated=650. Using EP data.
```

### 2.4 Fuzzy Header Matching (for Excel/CSV)

Implement the 3-pass fuzzy matcher from PCF Syntax Master v1.2 §13.2:

```javascript
function fuzzyMatchHeader(headerText, aliasConfig, threshold = 0.75) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const normHeader = norm(headerText);
  
  // Pass 1: Exact match on normalized aliases
  for (const [canonical, aliases] of Object.entries(aliasConfig)) {
    if (aliases.some(a => norm(a) === normHeader)) return canonical;
  }
  
  // Pass 2: Substring containment
  for (const [canonical, aliases] of Object.entries(aliasConfig)) {
    for (const alias of aliases) {
      const na = norm(alias);
      if (na.includes(normHeader) || normHeader.includes(na)) return canonical;
    }
  }
  
  // Pass 3: Similarity ratio
  let bestMatch = null, bestScore = 0;
  for (const [canonical, aliases] of Object.entries(aliasConfig)) {
    for (const alias of aliases) {
      const score = similarity(normHeader, norm(alias));
      if (score > bestScore && score >= threshold) {
        bestScore = score;
        bestMatch = canonical;
      }
    }
  }
  return bestMatch;
}
```

---

## 3. PHASE 2 — DATA TABLE TAB

### 3.1 Layout

Full-width scrollable table with:
- Sticky header row.
- Sticky first 3 columns (#, CSV SEQ NO, Type).
- Horizontal scroll for remaining columns.
- **Modified cells highlighted** in a distinct color (light amber/yellow background).
- Cell tooltip shows modification reason on hover.

### 3.2 Columns to Display

Show all 42 columns from PCF Syntax Master v1.2 §13.1. Group visually:

| Group | Columns |
|-------|---------|
| Identity | #, CSV SEQ NO, Type, TEXT |
| Reference | PIPELINE-REFERENCE, REF NO. |
| Geometry | BORE, EP1, EP2, CP, BP |
| Fitting | SKEY |
| Support | SUPPORT COOR, SUPPORT GUID |
| Attributes | CA1–CA10, CA97, CA98 |
| Actions | Fixing Action |
| Calculated | LEN1, AXIS1, LEN2, AXIS2, LEN3, AXIS3, BRLEN |
| Deltas | DELTA_X, DELTA_Y, DELTA_Z |
| Derived | DIAMETER, WALL_THICK |
| Pointers | BEND_PTR, RIGID_PTR, INT_PTR |

### 3.3 Cell Styling Rules

| Condition | Background Color | Text Color |
|-----------|-----------------|------------|
| Normal (unchanged) | White | Black |
| Modified by fixer | `#FFF3CD` (amber-50) | Black |
| Calculated (derived) | `#D1ECF1` (cyan-50) | `#0C5460` |
| Mock (assumed zero) | `#F8D7DA` (red-50) | `#721C24` |
| Error cell | `#F5C6CB` (red-100) | `#721C24` bold |
| Header row (ISOGEN etc.) | `#E2E3E5` (gray-100) | `#383D41` |

### 3.4 Interactivity

- Cells are **read-only** by default (this is a validator, not an editor — editing happens via re-import or config changes).
- Hovering a modified cell shows tooltip: `"[Calculated] LEN1 derived from EP2.y - EP1.y = -654"`.
- Clicking a row highlights it and scrolls Debug tab to corresponding log entries.

### 3.5 Export Data Table Button

Located in the bottom status bar. On click:
- Generate an Excel file (`.xlsx`) from current `dataTable` state using SheetJS.
- Apply the cell coloring from §3.3.
- Auto-download as `PCF_DataTable_<timestamp>.xlsx`.

---

## 4. PHASE 3 — CONFIG TAB

### 4.1 Layout

Vertical scrollable panel with collapsible sections:

```
┌─────────────────────────────────────────────────┐
│  ▼ GENERAL SETTINGS                             │
│    Decimal Precision: [4 ▼]  (1 or 4)           │
│    Angle Format:      [degrees ▼]               │
│    CRLF Mode:         [✓] (always on)           │
│                                                  │
│  ▼ PIPELINE REFERENCE                            │
│    Default Filename:  [export sys-1]             │
│    PROJECT-IDENTIFIER: [P1]                      │
│    AREA:              [A1]                       │
│                                                  │
│  ▼ COLUMN ALIASES                                │
│    ┌─────────────┬───────────────────────────┐   │
│    │ Canonical    │ Aliases (comma-separated) │   │
│    ├─────────────┼───────────────────────────┤   │
│    │ CSV SEQ NO  │ SEQ NO, Seq No, SL.NO,   │   │
│    │             │ Sl No, Sequence No...     │   │
│    ├─────────────┼───────────────────────────┤   │
│    │ Type        │ Component, Comp Type,     │   │
│    │             │ Fitting, Item...          │   │
│    │ ...         │ ...                       │   │
│    └─────────────┴───────────────────────────┘   │
│    [Reset to Defaults]                           │
│                                                  │
│  ▼ COMPONENT TYPE MAPPING                        │
│    ┌──────────┬────────────────────────┐         │
│    │ CSV Code │ PCF Keyword            │         │
│    ├──────────┼────────────────────────┤         │
│    │ BRAN     │ PIPE                   │         │
│    │ ELBO     │ BEND                   │         │
│    │ FLAN     │ FLANGE                 │         │
│    │ ...      │ ...                    │         │
│    └──────────┴────────────────────────┘         │
│                                                  │
│  ▼ SUPPORT MAPPING                               │
│    GUID Prefix:    [UCI:]  (mandatory)           │
│    Fallback Name:  [RST]                         │
│    ┌──────────────────────────┬──────────────┐   │
│    │ Condition                │ Support Name │   │
│    ├──────────────────────────┼──────────────┤   │
│    │ Friction=Empty/0.3,     │              │   │
│    │   Gap=Empty             │ ANC          │   │
│    ├──────────────────────────┼──────────────┤   │
│    │ Friction=0.15           │ GDE          │   │
│    ├──────────────────────────┼──────────────┤   │
│    │ Friction=0.3, Gap>0     │ RST          │   │
│    └──────────────────────────┴──────────────┘   │
│                                                  │
│  ▼ BRLEN DATABASE — EQUAL TEE (ASME B16.9)      │
│    ┌─────┬──────┬─────┬──────┬───────────┐      │
│    │ NPS │ Bore │ OD  │ C    │ M (BRLEN) │      │
│    ├─────┼──────┼─────┼──────┼───────────┤      │
│    │ 1/2 │  15  │21.3 │  25  │    25     │      │
│    │ 3/4 │  20  │26.7 │  29  │    29     │      │
│    │ ... │      │     │      │           │      │
│    └─────┴──────┴─────┴──────┴───────────┘      │
│    [Add Row] [Reset to ASME B16.9 Defaults]      │
│                                                  │
│  ▼ BRLEN DATABASE — REDUCING TEE                 │
│    (similar editable table)                      │
│                                                  │
│  ▼ BRLEN DATABASE — WELDOLET                     │
│    Formula: BRLEN = A + 0.5 × Header OD          │
│    (editable A values table)                     │
│                                                  │
│  ▼ BRANCH BORE FALLBACK                          │
│    TEE default bore: [= Header Bore]             │
│    OLET default bore: [50] mm                    │
│                                                  │
│  ▼ BORE UNIT SETTINGS                            │
│    Auto-detect inch: [✓]                         │
│    Standard mm bores: [15,20,25,32,40,50,...]    │
│                                                  │
│  ▼ FUZZY MATCH SETTINGS                          │
│    Threshold: [0.75]                             │
│    Enable Pass 2 (substring): [✓]                │
│    Enable Pass 3 (similarity): [✓]               │
└─────────────────────────────────────────────────┘
```

### 4.2 Config Persistence

Store config in React state (via `useReducer`). Provide:
- **[Save Config]** button → exports config as JSON file.
- **[Load Config]** button → imports JSON file to restore settings.
- **[Reset All]** button → restores factory defaults from PCF Syntax Master v1.2.

---

## 5. PHASE 4 — ERROR FIXING PROCESS

This is the **core engine**. It runs automatically after import, or on-demand via a **[Run Validator]** button.

### 5.1 Processing Pipeline (Strict Order)

```
Step 1: Parse MESSAGE-SQUARE → Pre-populate Data Table
Step 2: Cross-verify MESSAGE-SQUARE vs Component Data
Step 3: Fill missing identifiers (REF NO., CA97, CA98, CSV SEQ NO)
Step 4: Bore unit conversion (inch → mm)
Step 5: Bi-directional coordinate calculation (EP ↔ DELTA ↔ LEN)
Step 6: CP/BP calculation (TEE, BEND, OLET)
Step 7: BRLEN fallback lookup
Step 8: Branch bore fallback
Step 9: SUPPORT mapping
Step 10: Pointer calculation (BEND_PTR, RIGID_PTR, INT_PTR)
Step 11: MESSAGE-SQUARE regeneration
Step 12: Run Validation Checklist (V1–V20)
Step 13: Generate tally (before vs after)
```

### 5.2 Step 1 — Parse MESSAGE-SQUARE into Data Table

```javascript
function parseMessageSquare(msgText) {
  // Split on ", " to get tokens
  const tokens = msgText.split(/,\s*/);
  const result = {};

  for (const token of tokens) {
    if (token.startsWith("LENGTH="))     result.length = parseInt(token.replace("LENGTH=","").replace("MM",""));
    else if (token.startsWith("RefNo:")) result.refNo = token.replace("RefNo:","");
    else if (token.startsWith("SeqNo:")) result.seqNo = token.replace("SeqNo:","");
    else if (token.startsWith("BrLen=")) result.brlen = parseInt(token.replace("BrLen=","").replace("MM",""));
    else if (token.startsWith("Bore="))  result.bores = token.replace("Bore=",""); // e.g., "400/350"
    else if (token.startsWith("Wt="))    result.weight = token.replace("Wt=","");
    else if (["EAST","WEST","NORTH","SOUTH","UP","DOWN"].includes(token.toUpperCase()))
      result.direction = token.toUpperCase();
    else if (isComponentType(token.toUpperCase())) result.type = token.toUpperCase();
    else result.material = token; // fallback = material (CA3)
  }
  return result;
}
```

### 5.3 Step 2 — Cross-Verify MESSAGE-SQUARE vs Component Data

For every row:

```javascript
function crossVerify(row, msgData, log) {
  // Component block data is AUTHORITATIVE. MESSAGE-SQUARE is advisory.

  // Check Type match
  if (msgData.type && msgData.type !== row.type) {
    log.push({type:"Info", row: row._rowIndex,
      message: `MESSAGE-SQUARE type "${msgData.type}" differs from component type "${row.type}". Using component data.`});
  }

  // Check Material match
  if (msgData.material && row.ca[3] && msgData.material !== row.ca[3]) {
    log.push({type:"Info", row: row._rowIndex,
      message: `MESSAGE-SQUARE material "${msgData.material}" vs CA3 "${row.ca[3]}". Using CA3.`});
  }

  // Check Length match (compare EP-derived vs MSG-stated)
  const epLength = calculateTotalLength(row);
  if (msgData.length && epLength && Math.abs(msgData.length - Math.abs(epLength)) > 1) {
    log.push({type:"Info", row: row._rowIndex,
      message: `MESSAGE-SQUARE LENGTH=${msgData.length} vs EP-calculated=${Math.abs(epLength)}. Using EP data.`});
  }

  // RefNo cross-check
  if (msgData.refNo && row.ca[97] && msgData.refNo !== row.ca[97]) {
    log.push({type:"Info", row: row._rowIndex,
      message: `MESSAGE-SQUARE RefNo differs from CA97. Using CA97.`});
  }
}
```

### 5.4 Step 3 — Fill Missing Identifiers

```javascript
function fillIdentifiers(dataTable, log) {
  let runningSeq = 1;
  for (const row of dataTable) {
    // CSV SEQ NO fallback
    if (!row.csvSeqNo) {
      row.csvSeqNo = runningSeq;
      markModified(row, "csvSeqNo", "Calculated");
      log.push({type:"Calculated", row: row._rowIndex,
        message: `CSV SEQ NO was blank. Assigned running number ${runningSeq}.`});
    }
    runningSeq++;

    // REF NO. fallback
    if (!row.refNo) {
      row.refNo = String(row.csvSeqNo);
      markModified(row, "refNo", "Calculated");
      log.push({type:"Calculated", row: row._rowIndex,
        message: `REF NO. was blank. Using CSV SEQ NO: ${row.refNo}.`});
    }

    // CA97 fallback
    if (!row.ca[97]) {
      row.ca[97] = row.refNo.startsWith("=") ? row.refNo : `=${row.refNo}`;
      markModified(row, "ca97", "Calculated");
    }

    // CA98 fallback
    if (!row.ca[98]) {
      row.ca[98] = row.csvSeqNo;
      markModified(row, "ca98", "Calculated");
    }

    // TEXT fallback (auto-create MESSAGE-SQUARE text)
    if (!row.text) {
      row.text = buildMessageSquare(row);
      markModified(row, "text", "Calculated");
      log.push({type:"Calculated", row: row._rowIndex,
        message: `TEXT was blank. Auto-generated MESSAGE-SQUARE text.`});
    }
  }
}
```

### 5.5 Step 4 — Bore Unit Conversion

```javascript
function convertBoreUnits(dataTable, config, log) {
  const stdMm = new Set([15,20,25,32,40,50,65,80,90,100,125,150,
    200,250,300,350,400,450,500,600,750,900,1050,1200]);

  for (const row of dataTable) {
    if (row.bore && row.bore <= 48 && !stdMm.has(row.bore) && config.autoDetectInch) {
      const oldBore = row.bore;
      row.bore = Math.round(row.bore * 25.4 * 10) / 10;
      markModified(row, "bore", "Calculated");
      log.push({type:"Warning", row: row._rowIndex,
        message: `Bore ${oldBore} appears to be inches. Converted to ${row.bore} mm.`});
    }
  }
}
```

### 5.6 Step 5 — Bi-Directional Coordinate Calculation

```javascript
function calculateCoordinates(dataTable, log) {
  let prevEP2 = null;

  for (const row of dataTable) {
    if (row.type === "SUPPORT") continue; // SUPPORT uses CO-ORDS, skip
    if (row.type === "OLET") continue;    // OLET has CP/BP only, skip

    const hasEPs = isValidCoord(row.ep1) && isValidCoord(row.ep2);
    const hasDeltas = row.deltaX != null || row.deltaY != null || row.deltaZ != null;
    const hasLens = row.len1 != null || row.len2 != null || row.len3 != null;

    if (hasEPs) {
      // Path A: EPs → Deltas → LEN/AXIS
      row.deltaX = row.ep2.x - row.ep1.x;
      row.deltaY = row.ep2.y - row.ep1.y;
      row.deltaZ = row.ep2.z - row.ep1.z;
      assignLenAxis(row, log, "Calculated");

    } else if (hasDeltas) {
      // Path B: Deltas → EPs + LEN/AXIS
      if (!isValidCoord(row.ep1)) {
        row.ep1 = prevEP2 ? {...prevEP2} : {x:0, y:0, z:0};
        markModified(row, "ep1", prevEP2 ? "Calculated" : "Mock");
        log.push({type: prevEP2 ? "Calculated" : "Mock", row: row._rowIndex,
          message: `EP1 derived from ${prevEP2 ? "previous EP2" : "origin (0,0,0)"}.`});
      }
      row.ep2 = {
        x: row.ep1.x + (row.deltaX || 0),
        y: row.ep1.y + (row.deltaY || 0),
        z: row.ep1.z + (row.deltaZ || 0)
      };
      markModified(row, "ep2", "Calculated");
      assignLenAxis(row, log, "Calculated");

    } else if (hasLens) {
      // Path C: LEN/AXIS → Deltas → EPs
      row.deltaX = lenAxisToDelta(row.len1, row.axis1);
      row.deltaY = lenAxisToDelta(row.len2, row.axis2);
      row.deltaZ = lenAxisToDelta(row.len3, row.axis3);
      markModified(row, "deltaX", "Calculated");
      markModified(row, "deltaY", "Calculated");
      markModified(row, "deltaZ", "Calculated");

      if (!isValidCoord(row.ep1)) {
        row.ep1 = prevEP2 ? {...prevEP2} : {x:0, y:0, z:0};
        markModified(row, "ep1", prevEP2 ? "Calculated" : "Mock");
      }
      row.ep2 = {
        x: row.ep1.x + row.deltaX,
        y: row.ep1.y + row.deltaY,
        z: row.ep1.z + row.deltaZ
      };
      markModified(row, "ep2", "Calculated");

    } else {
      // Nothing available
      log.push({type:"Error", row: row._rowIndex,
        message: `No coordinate data (EP, Delta, or LEN) available. Cannot calculate geometry.`});
    }

    // Track for chaining
    if (isValidCoord(row.ep2)) prevEP2 = {...row.ep2};
  }
}
```

### 5.7 Step 6 — CP/BP Calculation

```javascript
function calculateCpBp(dataTable, config, log) {
  for (const row of dataTable) {

    // === TEE ===
    if (row.type === "TEE") {
      // CP = midpoint(EP1, EP2)
      if (!isValidCoord(row.cp) && isValidCoord(row.ep1) && isValidCoord(row.ep2)) {
        row.cp = midpoint(row.ep1, row.ep2);
        markModified(row, "cp", "Calculated");
        log.push({type:"Calculated", row: row._rowIndex,
          message: `TEE CP calculated as midpoint: (${fmtCoord(row.cp)}).`});
      }

      // BP fallback
      if (!isValidCoord(row.bp) && isValidCoord(row.cp)) {
        const brlen = row.brlen || lookupBrlen(row, config);
        const brDir = detectBranchDirection(row, dataTable);
        if (brlen && brDir) {
          row.bp = calcBranchPoint(row.cp, brlen, brDir);
          row.brlen = brlen;
          markModified(row, "bp", "Calculated");
          log.push({type:"Calculated", row: row._rowIndex,
            message: `TEE BP calculated: CP + ${brlen}mm ${brDir} = (${fmtCoord(row.bp)}).`});
        } else {
          log.push({type:"Warning", row: row._rowIndex,
            message: `TEE BP cannot be calculated. Missing BRLEN or branch direction.`});
        }
      }

      // Branch bore fallback
      if (!row.branchBore) {
        row.branchBore = row.bore; // Equal tee assumed
        markModified(row, "branchBore", "Calculated");
        log.push({type:"Calculated", row: row._rowIndex,
          message: `Branch bore defaulted to header bore (${row.bore}mm) — equal tee assumed.`});
      }
    }

    // === BEND ===
    if (row.type === "BEND") {
      if (!isValidCoord(row.cp) && isValidCoord(row.ep1) && isValidCoord(row.ep2)) {
        const cp = calcBendCp(row.ep1, row.ep2, dataTable, row._rowIndex);
        if (cp) {
          row.cp = cp;
          markModified(row, "cp", "Calculated");
          log.push({type:"Calculated", row: row._rowIndex,
            message: `BEND CP calculated at corner: (${fmtCoord(row.cp)}).`});
        } else {
          log.push({type:"Error", row: row._rowIndex,
            message: `BEND CP cannot be determined. Need incoming/outgoing axis info.`});
        }
      }
    }

    // === OLET ===
    if (row.type === "OLET") {
      if (!row.branchBore) {
        row.branchBore = config.oletDefaultBore; // default 50
        markModified(row, "branchBore", "Mock");
        log.push({type:"Mock", row: row._rowIndex,
          message: `OLET branch bore assumed as ${config.oletDefaultBore}mm (default).`});
      }
    }
  }
}
```

### 5.8 Step 7 — BRLEN Fallback Lookup

```javascript
function lookupBrlen(row, config) {
  const headerBore = row.bore;
  const branchBore = row.branchBore || headerBore;

  if (row.type === "TEE") {
    if (headerBore === branchBore) {
      // Equal tee → lookup M from §9A.1
      const entry = config.brlenEqualTee.find(e => e.bore === headerBore);
      return entry ? entry.M : null;
    } else {
      // Reducing tee → lookup from §9A.2
      const entry = config.brlenReducingTee.find(
        e => e.headerBore === headerBore && e.branchBore === branchBore);
      return entry ? entry.M : null;
    }
  }

  if (row.type === "OLET") {
    // Weldolet: BRLEN = A + 0.5 * headerOD
    const entry = config.brlenWeldolet.find(
      e => e.headerBore === headerBore && e.branchBore === branchBore);
    if (entry) return entry.A + 0.5 * entry.headerOD;
    return null;
  }

  return null;
}
```

### 5.9 Step 8–11 — Remaining Processing

**Step 8 (Branch bore fallback):** Already handled in Step 6.

**Step 9 (SUPPORT mapping):** Apply config rules from §12.3 of PCF Syntax Master v1.2.

**Step 10 (Pointers):** Walk the component chain, increment counters:
```javascript
let bendCount = 0, rigidCount = 0, intCount = 0;
for (let i = 0; i < dataTable.length - 1; i++) {
  const nextType = dataTable[i + 1]?.type;
  if (nextType === "BEND") { bendCount++; dataTable[i].bendPtr = bendCount; }
  if (nextType === "FLANGE" || nextType === "VALVE") { rigidCount++; dataTable[i].rigidPtr = rigidCount; }
  if (nextType === "TEE" || nextType === "OLET") { intCount++; dataTable[i].intPtr = intCount; }
}
```

**Step 11 (MESSAGE-SQUARE regeneration):** Rebuild TEXT for all rows using the `buildMessageSquare()` function with corrected data.

### 5.10 Step 12 — Validation Checklist

Run all 20 checks from PCF Syntax Master v1.2 §18:

```javascript
function runValidation(dataTable, config, log) {
  const results = [];

  for (const row of dataTable) {
    // V1: No (0,0,0) coordinates
    for (const field of ["ep1","ep2","cp","bp","supportCoor"]) {
      const c = row[field];
      if (c && c.x === 0 && c.y === 0 && c.z === 0 && isUsedField(row.type, field)) {
        results.push({id:"V1", severity:"ERROR", row: row._rowIndex,
          message: `${field.toUpperCase()} is (0,0,0) — prohibited.`});
      }
    }

    // V2: Decimal consistency — checked at PCF generation time

    // V3: Bore consistency
    if (row.type.includes("REDUCER")) {
      if (row.bore === row.branchBore) {
        results.push({id:"V3", severity:"ERROR", row: row._rowIndex,
          message: `REDUCER EP1 bore = EP2 bore (${row.bore}). Must differ.`});
      }
    }

    // V4, V5: BEND CP ≠ EP1, CP ≠ EP2
    if (row.type === "BEND" && isValidCoord(row.cp)) {
      if (coordsEqual(row.cp, row.ep1))
        results.push({id:"V4", severity:"ERROR", row: row._rowIndex,
          message: `BEND CP equals EP1 — degenerate bend.`});
      if (coordsEqual(row.cp, row.ep2))
        results.push({id:"V5", severity:"ERROR", row: row._rowIndex,
          message: `BEND CP equals EP2 — degenerate bend.`});
    }

    // V8: TEE CP = midpoint
    if (row.type === "TEE" && isValidCoord(row.cp) &&
        isValidCoord(row.ep1) && isValidCoord(row.ep2)) {
      const expected = midpoint(row.ep1, row.ep2);
      if (!coordsApproxEqual(row.cp, expected, 1.0)) {
        results.push({id:"V8", severity:"ERROR", row: row._rowIndex,
          message: `TEE CP is not midpoint of EP1/EP2. Expected (${fmtCoord(expected)}).`});
      }
    }

    // V9: TEE CP bore = EP bore
    // V10: TEE BP perpendicular
    // V11: OLET no EPs
    // V12: SUPPORT no CAs
    // V13: SUPPORT bore = 0
    // V14: <SKEY> presence
    // V15: Coordinate continuity
    // V16: CA8 scope
    // V18: Bore unit
    // V19: SUPPORT MESSAGE-SQUARE
    // V20: GUID prefix
    // ... (implement each per §18 of PCF Syntax Master v1.2)
  }

  // V17: CRLF — checked at PCF generation time
  return results;
}
```

---

## 6. PHASE 5 — DEBUG TAB

### 6.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│  FILTER: [All ▼] [Error ◉] [Warning ◉] [Calculated ◉] │
│          [Mock ◉] [Info ◉]                              │
├─────────────────────────────────────────────────────────┤
│  LOG TABLE                                              │
│  ┌─────┬────────┬─────┬──────────────────────────────┐  │
│  │ Row │ Tag    │ Sev │ Message                      │  │
│  ├─────┼────────┼─────┼──────────────────────────────┤  │
│  │  5  │[Calc]  │ —   │ LEN1 derived from EP: -654   │  │
│  │  5  │[Info]  │ —   │ MSG LENGTH=654 vs EP=654 OK  │  │
│  │  8  │[Error] │ ERR │ BEND CP = EP1 (degenerate)   │  │
│  │ 12  │[Mock]  │ WRN │ OLET bore assumed 50mm       │  │
│  │ ... │        │     │                              │  │
│  └─────┴────────┴─────┴──────────────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  TALLY TABLE                                            │
│  ┌──────────────────┬───────────┬───────────┐           │
│  │ Metric           │ Imported  │ Processed │           │
│  ├──────────────────┼───────────┼───────────┤           │
│  │ Total Lines      │    87     │    92     │           │
│  │ Total Characters │  4,521    │  4,803    │           │
│  ├──────────────────┼───────────┼───────────┤           │
│  │ PIPE (total len) │ 3,054 mm  │ 3,054 mm  │           │
│  │ PIPE (count)     │    6      │    6      │           │
│  │ FLANGE (count)   │    5      │    5      │           │
│  │ VALVE (count)    │    1      │    1      │           │
│  │ TEE (count)      │    1      │    1      │           │
│  │ BEND (count)     │    1      │    1      │           │
│  │ OLET (count)     │    0      │    0      │           │
│  │ REDUCER-C (cnt)  │    0      │    0      │           │
│  │ REDUCER-E (cnt)  │    0      │    0      │           │
│  │ SUPPORT (count)  │    1      │    1      │           │
│  └──────────────────┴───────────┴───────────┘           │
└─────────────────────────────────────────────────────────┘
```

### 6.2 Log Tag Colors

| Tag | Badge Color | Text |
|-----|------------|------|
| `[Error]` | Red (`#DC3545`) white text | Error requiring manual review |
| `[Warning]` | Orange (`#FD7E14`) white text | Potential issue, auto-handled |
| `[Calculated]` | Blue (`#0D6EFD`) white text | Value computed from available data |
| `[Mock]` | Pink (`#E91E63`) white text | Assumed value (expect zero occurrences ideally) |
| `[Info]` | Gray (`#6C757D`) white text | Cross-verification note |

### 6.3 Tally Calculation

```javascript
function calculateTally(dataTable, rawPcf, finalPcf) {
  const tally = {
    imported: { lines: 0, chars: 0, components: {} },
    processed: { lines: 0, chars: 0, components: {} },
  };

  // Imported counts
  if (rawPcf) {
    tally.imported.lines = rawPcf.split(/\r?\n/).length;
    tally.imported.chars = rawPcf.length;
  }

  // Processed counts
  if (finalPcf) {
    tally.processed.lines = finalPcf.split(/\r?\n/).length;
    tally.processed.chars = finalPcf.length;
  }

  // Component-wise counts
  const types = ["PIPE","FLANGE","VALVE","TEE","BEND","OLET",
    "REDUCER-CONCENTRIC","REDUCER-ECCENTRIC","SUPPORT"];

  for (const t of types) {
    const rows = dataTable.filter(r => r.type === t);
    tally.processed.components[t] = {
      count: rows.length,
      totalLength: t === "PIPE" ?
        rows.reduce((sum, r) => sum + Math.abs(r.deltaX||0) + Math.abs(r.deltaY||0) + Math.abs(r.deltaZ||0), 0)
        : null
    };
  }

  return tally;
}
```

### 6.4 Tally for Imported PCF

Parse imported PCF minimally to count components and pipe lengths before the fixer runs, so the "Imported" column reflects the original state.

---

## 7. PHASE 6 — OUTPUT TAB

### 7.1 Layout

```
┌──────────────────────────────────────────────────────────┐
│  OUTPUT PCF PREVIEW                          [📋 Copy]   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ISOGEN-FILES ISOGEN.FLS                                 │
│  UNITS-BORE MM                                           │
│  UNITS-CO-ORDS MM                                        │
│  UNITS-WEIGHT KGS                                        │
│  UNITS-BOLT-DIA MM                                       │
│  UNITS-BOLT-LENGTH MM                                    │
│  PIPELINE-REFERENCE export 12-HC-1234-1A1-N              │
│      PROJECT-IDENTIFIER P1                               │
│      AREA A1                                             │
│                                                          │
│  MESSAGE-SQUARE                                          │
│      FLANGE, A106-B, LENGTH=146MM, SOUTH, RefNo:=...    │
│  FLANGE                                                  │
│      END-POINT    96400.0000 17986.4000 101968.0000 ...  │
│      ...                                                 │
│                                                          │
│  (monospace font, syntax highlighted, line numbers)      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 7.2 PCF Generation (Export PCF Button)

When **[Export PCF]** is clicked:

1. Run `generatePcf(dataTable, headerRows, config)` per §14 of PCF Syntax Master v1.2.
2. Join all lines with `\r\n` (CRLF).
3. Store in `state.finalPcf`.
4. Update the Output tab preview.
5. Auto-download as `.pcf` file.

### 7.3 Copy Button

Top-right corner of the preview panel. On click:
- Copy `state.finalPcf` to clipboard.
- Show brief toast: "Copied to clipboard ✓".

### 7.4 PCF Generator Function

```javascript
function generatePcf(dataTable, headerRows, config) {
  const dec = config.decimals;
  const fmt = (v) => v.toFixed(dec);
  const fmtLine = (x,y,z,b) => `${fmt(x)} ${fmt(y)} ${fmt(z)} ${fmt(b)}`;
  const lines = [];

  // Header
  for (const h of headerRows) lines.push(h.raw);
  lines.push("");

  // Components
  for (const row of dataTable) {
    // MESSAGE-SQUARE
    lines.push("MESSAGE-SQUARE  ");
    lines.push(`    ${row.text}`);

    if (row.type === "SUPPORT") {
      lines.push("SUPPORT");
      lines.push(`    CO-ORDS    ${fmtLine(row.supportCoor.x, row.supportCoor.y, row.supportCoor.z, 0)}`);
      lines.push(`    <SUPPORT_NAME>    ${row.supportName}`);
      lines.push(`    <SUPPORT_GUID>    ${row.supportGuid}`);
      lines.push("");
      continue;
    }

    lines.push(row.type); // Component keyword

    // Geometry
    if (row.type === "OLET") {
      lines.push(`    CENTRE-POINT  ${fmtLine(row.cp.x, row.cp.y, row.cp.z, row.bore)}`);
      lines.push(`    BRANCH1-POINT ${fmtLine(row.bp.x, row.bp.y, row.bp.z, row.branchBore)}`);
    } else {
      lines.push(`    END-POINT    ${fmtLine(row.ep1.x, row.ep1.y, row.ep1.z, row.bore)}`);
      lines.push(`    END-POINT    ${fmtLine(row.ep2.x, row.ep2.y, row.ep2.z,
        row.type.includes("REDUCER") ? row.branchBore : row.bore)}`);

      if (row.type === "BEND" || row.type === "TEE") {
        lines.push(`    CENTRE-POINT  ${fmtLine(row.cp.x, row.cp.y, row.cp.z, row.bore)}`);
      }
      if (row.type === "TEE") {
        lines.push(`    BRANCH1-POINT ${fmtLine(row.bp.x, row.bp.y, row.bp.z, row.branchBore)}`);
      }
    }

    // PIPELINE-REFERENCE for PIPE
    if (row.type === "PIPE" && row.pipelineRef) {
      lines.push(`    PIPELINE-REFERENCE ${row.pipelineRef}`);
    }

    // <SKEY>
    if (row.skey) lines.push(`    <SKEY>  ${row.skey}`);

    // BEND extras
    if (row.type === "BEND") {
      if (row.angle) lines.push(`    ANGLE  ${formatAngle(row.angle, config.angleFormat)}`);
      if (row.bendRadius) lines.push(`    BEND-RADIUS  ${row.bendRadius}`);
    }

    // REDUCER-ECCENTRIC
    if (row.type === "REDUCER-ECCENTRIC" && row.flatDirection) {
      lines.push(`    FLAT-DIRECTION  ${row.flatDirection}`);
    }

    // CAs
    for (const n of [1,2,3,4,5,6,7,8,9,10,97,98]) {
      if (row.ca[n] != null && row.ca[n] !== "") {
        lines.push(`    COMPONENT-ATTRIBUTE${n}    ${row.ca[n]}`);
      }
    }

    lines.push("");
  }

  return lines.join("\r\n");
}
```

### 7.5 Syntax Highlighting in Preview

Apply simple color rules to the monospace preview:

| Pattern | Color |
|---------|-------|
| Component keywords (PIPE, FLANGE, etc.) | Bold blue |
| MESSAGE-SQUARE | Bold green |
| END-POINT, CENTRE-POINT, BRANCH1-POINT, CO-ORDS | Teal |
| `<SKEY>`, `<SUPPORT_NAME>`, `<SUPPORT_GUID>` | Purple |
| COMPONENT-ATTRIBUTE lines | Gray |
| Header lines (ISOGEN, UNITS, PIPELINE) | Dark gray italic |
| Numbers (coordinates, bore) | Orange |

---

## 8. UI/UX DESIGN SPECIFICATIONS

### 8.1 Visual Theme

**Direction:** Industrial/Utilitarian — clean, dense, data-focused. Think engineering workstation, not marketing landing page.

- **Font:** `"JetBrains Mono"` for data/code, `"DM Sans"` for UI labels.
- **Background:** `#1A1D23` (dark charcoal) for the main frame. `#FFFFFF` for data areas.
- **Accent:** `#0077B6` (engineering blue) for active tabs, buttons, highlights.
- **Error red:** `#DC3545`. Warning orange: `#FD7E14`. Success green: `#198754`.
- **Tab bar:** Horizontal tabs with bottom border indicator. Active tab has bold blue underline.
- **Tables:** Dense rows (28px height), thin grid lines (`#E9ECEF`), zebra striping on hover.

### 8.2 Responsive Behavior

- Minimum width: 1024px (engineering tools are desktop-first).
- Data Table tab: Full horizontal scroll with frozen columns.
- Config tab: Single column scrollable.
- Debug tab: Split panel (log top 60%, tally bottom 40%).
- Output tab: Full-width monospace preview.

### 8.3 Status Bar

Always visible at bottom. Shows:

```
Left:  "Ready" | "Parsing..." | "Validated: 3 errors, 5 warnings" | "PCF Generated"
Right: [Export Data Table ↓]  [Export PCF ↓]  [Run Validator ▶]
```

---

## 9. ANTI-DRIFT RULES FOR AI AGENT

### 9.1 Mandatory Constraints

1. **Single file artifact.** The entire app must be one `.jsx` file. No separate CSS/JS files.
2. **No localStorage.** Use React state only. Config persistence via JSON export/import.
3. **CRLF in output.** Every PCF output string must use `\r\n`. Verify with a check.
4. **`<SKEY>` not `SKEY`.** Angle brackets in all PCF output. Escape properly in JSX (`{'<SKEY>'}`).
5. **Decimal consistency.** Bore format matches coordinate format. Test with assertion.
6. **No (0,0,0).** Validation V1 must always run. Flag, never silently accept.
7. **Case-insensitive matching.** All type lookups normalize to uppercase first.
8. **Component data > MESSAGE-SQUARE.** Always. Log discrepancies, never override component data.
9. **SUPPORT gets MESSAGE-SQUARE.** Unlike common PCF convention, our format requires it.
10. **UCI: prefix mandatory.** `<SUPPORT_GUID>` must always start with `UCI:`.

### 9.2 Decision Gates

| Gate | Condition | Action if Fail |
|------|-----------|---------------|
| G1: Import valid? | File is non-empty and parseable | Show error toast, don't proceed |
| G2: Header found? | At least ISOGEN-FILES and one UNITS line | Warn, create defaults |
| G3: Components found? | At least 1 component block parsed | Error, show empty state |
| G4: Coordinates sane? | No (0,0,0) in authoritative fields | Flag V1, mark [Error] |
| G5: All mandatory fields? | Type present for every row | Error, skip row with warning |
| G6: PCF generation clean? | No unresolved [Error] in log | Warn user before export |

### 9.3 Testing Checklist

After building, verify these scenarios work:

| # | Test | Expected |
|---|------|----------|
| T1 | Import sample PCF from prompt | All 17 components parse correctly |
| T2 | Import with missing LEN, only EPs | LEN/AXIS/DELTA calculated, logged as [Calculated] |
| T3 | Import with only LEN/AXIS, no EPs | EPs derived from chaining, first EP1 = (0,0,0) [Mock] |
| T4 | BEND with missing CP | CP calculated at corner, logged as [Calculated] |
| T5 | TEE with missing BP | BP derived from BRLEN lookup + direction |
| T6 | SUPPORT mapping | Friction/Gap rules produce correct names |
| T7 | Bore in inches (e.g., 16) | Converted to 406.4mm, [Warning] logged |
| T8 | MESSAGE-SQUARE mismatch | Discrepancy logged as [Info], component data wins |
| T9 | Export PCF | Output matches v1.2 format exactly, CRLF verified |
| T10 | Export Data Table | Excel file with color-coded cells downloads |
| T11 | Copy button | Clipboard contains PCF text |
| T12 | Config change | BRLEN table edit reflected in next validation run |
| T13 | Debug filter | Clicking [Error] shows only error rows |
| T14 | Tally comparison | Imported vs Processed counts match expectations |

---

## 10. DEFAULT CONFIG VALUES

Embed these as constants in the app:

```javascript
const DEFAULT_CONFIG = {
  decimals: 4,
  angleFormat: "degrees",
  crlfMode: true,
  pipelineRef: { default: "export sys-1", projectId: "P1", area: "A1" },

  // Column aliases (abbreviated — full list per §13.1 of PCF Syntax Master v1.2)
  columnAliases: {
    "CSV SEQ NO": ["CSV SEQ NO","SEQ NO","Seq No","SL.NO","Sl No","SL NO","SeqNo","Sequence","Sequence No","Item No"],
    "Type": ["Type","Component","Comp Type","CompType","Component Type","Fitting","Item"],
    "TEXT": ["TEXT","Text","Description","Desc","Comment","MSG"],
    "PIPELINE-REFERENCE": ["PIPELINE-REFERENCE","Pipeline Ref","Line No","Line Number","Line No.","LineNo","PIPE","Pipe Line"],
    "REF NO.": ["REF NO.","Ref No","RefNo","Reference No","Reference Number","Ref","Tag No","TagNo"],
    "BORE": ["BORE","Bore","NPS","Nominal Bore","Dia","Diameter","Size","Pipe Size","DN"],
    // ... (all 42 columns per §13.1)
  },

  // Component type mapping (case-insensitive)
  typeMapping: {
    "PIPE":"PIPE","BRAN":"PIPE","BEND":"BEND","ELBO":"BEND",
    "TEE":"TEE","FLANGE":"FLANGE","FLAN":"FLANGE",
    "VALVE":"VALVE","VALV":"VALVE","OLET":"OLET",
    "REDC":"REDUCER-CONCENTRIC","REDU":"REDUCER-CONCENTRIC",
    "REDE":"REDUCER-ECCENTRIC","ANCI":"SUPPORT","SUPPORT":"SUPPORT",
  },

  // Support mapping
  supportMapping: {
    guidPrefix: "UCI:",
    fallbackName: "RST",
    blocks: [
      { condition: "friction_empty_or_03_gap_empty", name: "ANC" },
      { condition: "friction_015", name: "GDE" },
      { condition: "friction_03_gap_gt0", name: "RST" },
    ]
  },

  // BRLEN database (equal tee)
  brlenEqualTee: [
    {nps:"1/2", bore:15, od:21.3, C:25, M:25},
    {nps:"3/4", bore:20, od:26.7, C:29, M:29},
    {nps:"1",   bore:25, od:33.4, C:38, M:38},
    {nps:"1-1/4",bore:32, od:42.2, C:48, M:48},
    {nps:"1-1/2",bore:40, od:48.3, C:57, M:57},
    {nps:"2",   bore:50, od:60.3, C:64, M:64},
    {nps:"2-1/2",bore:65, od:73.0, C:76, M:76},
    {nps:"3",   bore:80, od:88.9, C:86, M:86},
    {nps:"3-1/2",bore:90, od:101.6, C:95, M:95},
    {nps:"4",   bore:100,od:114.3, C:105, M:105},
    {nps:"5",   bore:125,od:141.3, C:124, M:124},
    {nps:"6",   bore:150,od:168.3, C:143, M:143},
    {nps:"8",   bore:200,od:219.1, C:178, M:178},
    {nps:"10",  bore:250,od:273.1, C:216, M:216},
    {nps:"12",  bore:300,od:323.9, C:254, M:254},
    {nps:"14",  bore:350,od:355.6, C:279, M:279},
    {nps:"16",  bore:400,od:406.4, C:305, M:305},
    {nps:"18",  bore:450,od:457.2, C:343, M:343},
    {nps:"20",  bore:500,od:508.0, C:381, M:381},
    {nps:"24",  bore:600,od:610.0, C:432, M:432},
    {nps:"30",  bore:750,od:762.0, C:559, M:559},
    {nps:"36",  bore:900,od:914.0, C:660, M:660},
    {nps:"42",  bore:1050,od:1067.0,C:762, M:762},
    {nps:"48",  bore:1200,od:1219.0,C:864, M:864},
  ],

  // Branch bore fallback
  teeDefaultBore: "header", // "header" = use header bore
  oletDefaultBore: 50,

  // Bore unit
  autoDetectInch: true,
  standardMmBores: [15,20,25,32,40,50,65,80,90,100,125,150,200,250,300,350,400,450,500,600,750,900,1050,1200],

  // Fuzzy match
  fuzzyThreshold: 0.75,
  fuzzyEnablePass2: true,
  fuzzyEnablePass3: true,
};
```

---

## 11. FILE STRUCTURE SUMMARY

```
Single artifact: PCF_Validator_and_Fixer.jsx

Sections within the file (top to bottom):
  1. Imports (React, lucide-react icons)
  2. Constants (DEFAULT_CONFIG, BRLEN tables, aliases)
  3. Utility functions (fmt, midpoint, coordsEqual, etc.)
  4. Parser functions (parsePcf, parseMessageSquare, fuzzyMatchHeader)
  5. Fixer functions (Steps 1-12)
  6. Generator function (generatePcf)
  7. Tally function
  8. UI Components:
     a. ImportDialog
     b. ExcelPreviewModal
     c. DataTableTab
     d. ConfigTab
     e. DebugTab (LogTable + TallyTable)
     f. OutputTab
     g. StatusBar
  9. Main App component (tabs, state, dispatch)
  10. Export default
```

**Estimated size:** 2500–3500 lines of JSX.

---

## 12. IMPLEMENTATION ORDER

| Phase | What to Build | Depends On |
|-------|--------------|------------|
| P1 | App shell, tabs, state management | Nothing |
| P2 | PCF text parser | P1 |
| P3 | Data Table tab (display only) | P2 |
| P4 | Config tab (with defaults) | P1 |
| P5 | Error fixing engine (Steps 1-12) | P2, P4 |
| P6 | Debug tab (log + tally) | P5 |
| P7 | PCF generator + Output tab | P5 |
| P8 | Excel/CSV import + preview | P1, fuzzy matcher |
| P9 | Export buttons (Data Table XLSX, PCF file) | P3, P7 |
| P10 | Syntax highlighting in Output preview | P7 |
| P11 | Polish: tooltips, toast, copy button | All |

**Critical path:** P1 → P2 → P5 → P7. Build this chain first, then add UI polish.

---

*End of Work Instruction WI-PCF-VALIDATOR-001 Rev.0*
