# WORK INSTRUCTION — PCF Validator, Fixer & Converter v2.0

## Document ID: WI-PCF-002 Rev.0
## For: AI Coding Agent
## SUPERSEDES: WI-PCF-VALIDATOR-001, WI-PCF-SMARTFIX-001
## REFERENCES:
##   - PCF Consolidated Master v2.0 (Parts A–D)
##   - PTE Conversion Rules v2 (PCF-PTE-002)
##   - PTE Findings from Real Data (PCF-PTE-001 Addendum)

---

# PART 0 — EXECUTIVE SUMMARY

## 0.1 What This App Does

A single-page React web application that:

1. **Accepts 3 input types:** Point CSV/Excel, Element CSV/Excel, or PCF text.
2. **Converts** point data to elements (if point input).
3. **Parses** into a unified **Data Table** (the single source of truth).
4. **Validates** using 20 structural checks (V1–V20) + 57 smart rules (R-GEO through R-AGG).
5. **Fixes** errors via the Chain Walker Smart Fixer.
6. **Exports** corrected PCF text from the Data Table.

## 0.2 Data Flow

```
INPUT PATH 1          INPUT PATH 2          INPUT PATH 3
Point CSV/Excel       Element CSV/Excel     PCF Text File
     │                      │                     │
     ▼                      ▼                     ▼
┌──────────┐         ┌──────────┐          ┌──────────┐
│ PTE      │         │ Fuzzy    │          │ PCF Text │
│ Converter│         │ Header   │          │ Parser   │
│ (§3)     │         │ Match    │          │ (§5)     │
└────┬─────┘         └────┬─────┘          └────┬─────┘
     │                    │                     │
     ▼                    ▼                     ▼
┌────────────────────────────────────────────────────┐
│              UNIFIED DATA TABLE                     │
│         (Single Source of Truth)                     │
│         42 columns per PCF Syntax Master v1.2       │
├────────────────────────────────────────────────────┤
│                                                     │
│   Step 1-4:  Basic Fixer (identifiers, bore, etc.) │
│   Step 4A-F: Smart Fixer (chain walker, 57 rules)  │
│   Step 5-13: Recalc, validation, PCF generation     │
│                                                     │
└──────────────────────┬─────────────────────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   OUTPUT: PCF   │
              │   (CRLF, v1.2)  │
              └─────────────────┘
```

## 0.3 Tech Stack

```
Framework:    Vite + React (single .jsx artifact where possible,
              split into modules if >3000 lines)
Styling:      Tailwind CSS
Excel Import: SheetJS (xlsx) + PapaParse (CSV)
Excel Export: exceljs (styled cells with colors)
Fuzzy Match:  Custom Levenshtein (~15 lines)
Vector Math:  Custom vec utility (~40 lines)
Backend:      None — 100% browser-side
```

## 0.4 How to Prevent Missing Rules

The previous WI missed 17 rules during implementation. This version prevents that with:

1. **Rule Registry** — every rule has an ID, and the code must register each rule at initialization. A startup check verifies all rules are registered.
2. **Implementation Gates** — the app will NOT build/run if any rule is unregistered.
3. **Developer Debug Tab** — shows rule coverage, execution counts, and test results. OFF in production.
4. **Benchmark Test Suite** — 120+ micro-tests (§13) that each target specific rules. Tests run automatically on build.

---

# PART 1 — APPLICATION ARCHITECTURE

## 1.1 Tab Structure

```
┌──────────────────────────────────────────────────────────────┐
│  HEADER: [Import ▼] (Point/Element/PCF)    App Title         │
├──────────────────────────────────────────────────────────────┤
│  TABS: [Data Table] [Config] [Debug] [Output] [Dev 🔧]      │
│                                                 ^^^^^^^^^^   │
│                                                 Hidden in    │
│                                                 production   │
├──────────────────────────────────────────────────────────────┤
│                    TAB CONTENT                                │
├──────────────────────────────────────────────────────────────┤
│  STATUS BAR + ACTION BUTTONS                                 │
│  [Run Validator ▶] [Smart Fix 🔧] [Apply Fixes ✓]           │
│  [Export Data Table ↓] [Export PCF ↓]                        │
└──────────────────────────────────────────────────────────────┘
```

## 1.2 State Management

```javascript
const initialState = {
  // ─── Input ───
  inputType: null,           // "point_csv" | "element_csv" | "pcf_text"
  rawInput: null,            // Original file content
  
  // ─── Point-to-Element (only for point input) ───
  pteMode: null,             // "CASE_A" | "CASE_B_a" | "CASE_B_b" | "CASE_D_a" | "CASE_D_b"
  pteIntermediateRows: [],   // Raw point rows before conversion
  pteConversionLog: [],      // PTE-specific log entries
  
  // ─── Core ───
  headerRows: [],            // PCF header lines (ISOGEN-FILES, UNITS-*, etc.)
  dataTable: [],             // Array of row objects (THE source of truth)
  config: { ...DEFAULT_CONFIG },
  
  // ─── Processing ───
  log: [],                   // Master log: all entries from all stages
  validationResults: [],     // V1–V20 results
  
  // ─── Smart Fixer ───
  smartFix: {
    status: "idle",
    graph: null,
    chains: [],
    orphans: [],
    summary: null,
  },
  
  // ─── Output ───
  finalPcf: "",
  
  // ─── Tally ───
  tallyBefore: {},
  tallyAfter: {},
  
  // ─── UI ───
  activeTab: "datatable",
  devMode: false,            // Toggle via config or URL param ?dev=1
  
  // ─── Rule Registry (for enforcement) ───
  ruleRegistry: {},          // Populated at init — see §11
};
```

## 1.3 Row Object Schema (Data Table)

Every row in `dataTable`:

```javascript
{
  _rowIndex: 0,
  _modified: {},              // {field: "reason"} for changed cells
  _logTags: [],               // ["Calculated", "Mock", "Error", ...]
  _source: "PTE" | "CSV" | "PCF",  // How this row was created

  // Identity
  csvSeqNo: null,
  type: "PIPE",
  text: "",                   // MESSAGE-SQUARE text
  pipelineRef: "",
  refNo: "",
  bore: 0,

  // Geometry
  ep1: {x:0, y:0, z:0},
  ep2: {x:0, y:0, z:0},
  cp:  null,                  // {x,y,z} or null
  bp:  null,                  // {x,y,z} or null
  branchBore: null,

  // Fitting
  skey: "",

  // Support
  supportCoor: null,
  supportName: "",
  supportGuid: "",

  // Attributes
  ca: {1:null, 2:null, 3:null, 4:null, 5:null, 6:null,
       7:null, 8:null, 9:null, 10:null, 97:null, 98:null},

  fixingAction: "",           // Populated by Smart Fixer

  // Calculated
  len1:null, axis1:null, len2:null, axis2:null, len3:null, axis3:null,
  brlen:null, deltaX:null, deltaY:null, deltaZ:null,
  diameter:null, wallThick:null,
  bendPtr:null, rigidPtr:null, intPtr:null,

  // Smart Fixer
  fixingAction: null,
  fixingActionTier: null,
  fixingActionRuleId: null,
}
```

---

# PART 2 — IMPORT SYSTEM

## 2.1 Import Dialog

Single **[Import ▼]** dropdown with 3 options:

```
┌──────────────────────────┐
│  Import Point CSV/Excel  │ → File dialog (.csv, .xlsx, .xls)
│  Import Element CSV/Excel│ → File dialog (.csv, .xlsx, .xls)
│  Import PCF Text         │ → File dialog (.pcf, .txt)
└──────────────────────────┘
```

## 2.2 Import Detection Logic

After file is loaded:

```javascript
function detectImportType(headers, firstRows, fileExtension) {
  // PCF text file
  if (fileExtension === '.pcf' || fileExtension === '.txt') {
    if (firstRows[0]?.includes('ISOGEN-FILES') || firstRows[0]?.includes('UNITS-')) {
      return "pcf_text";
    }
  }
  
  // Point-based CSV/Excel: has "Point" column with values {0,1,2,3}
  const pointCol = fuzzyMatchHeader("Point", headers);
  if (pointCol) {
    const pointValues = new Set(firstRows.map(r => r[pointCol]).filter(Boolean));
    if (pointValues.has('0') || pointValues.has('1') || pointValues.has('3')) {
      return "point_csv";
    }
  }
  
  // Element-based CSV/Excel: has EP1/EP2 columns
  const ep1Col = fuzzyMatchHeader("EP1 COORDS", headers);
  const ep2Col = fuzzyMatchHeader("EP2 COORDS", headers);
  if (ep1Col && ep2Col) return "element_csv";
  
  // Fallback: check for Real_Type + coordinates (minimal point data)
  const typeCol = fuzzyMatchHeader("Type", headers);
  const eastCol = fuzzyMatchHeader("East", headers);
  if (typeCol && eastCol) return "point_csv";
  
  return "unknown";
}
```

## 2.3 Preview Modal

Show for ALL import types before processing:

```
┌──────────────────────────────────────────────────────┐
│  Import Preview                                [✕]   │
├──────────────────────────────────────────────────────┤
│  File: export_sys-1.csv                              │
│  Detected: Point-Based Format (CAESAR II style)      │
│  Rows: 114  Columns: 26                             │
│                                                      │
│  Column Mapping:                                     │
│  ┌─────────────┬───────────────┬──────────────────┐  │
│  │ File Column │ Mapped To     │ Confidence       │  │
│  ├─────────────┼───────────────┼──────────────────┤  │
│  │ Sequence    │ Sequence      │ ✓ Exact          │  │
│  │ Type        │ Real_Type     │ ✓ Exact          │  │
│  │ East        │ X Coordinate  │ ✓ Alias          │  │
│  │ North       │ Y Coordinate  │ ✓ Alias          │  │
│  │ Up          │ Z Coordinate  │ ✓ Alias          │  │
│  │ Point       │ Point         │ ✓ Exact          │  │
│  │ ???         │ (select ▼)    │ ✗ No match       │  │
│  └─────────────┴───────────────┴──────────────────┘  │
│                                                      │
│  PTE Settings:                                       │
│  Sequential Data: [ON ▼]                             │
│  Line_Key:        [OFF ▼]  Column: [— ▼]            │
│  Detected Case:   B(b) — derive Ref/Pt/PPt from     │
│                   coords + Real_Type                  │
│                                                      │
│  First 10 rows preview:                              │
│  ┌─────┬──────┬────────┬──────────┬──────────┐      │
│  │ Seq │ Type │ Point  │ East     │ North    │ ...  │
│  │ 1   │ BRAN │ 1      │ 96400    │ 17989.4  │      │
│  │ ... │      │        │          │          │      │
│  └─────┴──────┴────────┴──────────┴──────────┘      │
│                                                      │
│  [Cancel]                          [Confirm Import]  │
└──────────────────────────────────────────────────────┘
```

---

# PART 3 — INPUT PATH 1: POINT CSV/EXCEL → PTE CONVERTER

## 3.1 PTE Conversion Pipeline

```
Point CSV → Detect PTE Case → Group by RefNo/Real_Type →
  Walk/Sweep → Assemble Elements → Detect Implicit Pipes →
  Calculate CP/BP → Populate Data Table
```

## 3.2 PTE Case Selection

Per PCF-PTE-002 §0:

```javascript
function selectPTECase(headers, rows, config) {
  const hasRef = hasColumn(headers, "RefNo");
  const hasPoint = hasColumn(headers, "Point");
  const hasPPoint = hasColumn(headers, "PPoint");
  const hasLineKey = config.pte.lineKeyEnabled && hasColumn(headers, config.pte.lineKeyColumn);
  const isSequential = config.pte.sequentialData;
  
  if (hasRef && hasPoint && hasPPoint) {
    return "CASE_A";  // Enrich with Real_Type
  }
  if (isSequential && hasLineKey) return "CASE_B_a";
  if (isSequential && !hasLineKey) return "CASE_B_b";
  if (!isSequential && hasLineKey) return "CASE_D_a";
  return "CASE_D_b";
}
```

## 3.3 Core PTE Algorithms

Implement EXACTLY as specified in PCF-PTE-002:

| Section | Algorithm | Gate ID |
|---------|-----------|---------|
| PTE-002 §2 | Case A: enrich_with_real_type | GATE-PTE-01 |
| PTE-002 §3 | Case B(a): derive with Line_Key | GATE-PTE-02 |
| PTE-002 §4 | Case B(b): derive without Line_Key | GATE-PTE-03 |
| PTE-002 §5 | TEE point assignment | GATE-PTE-04 |
| PTE-002 §6 | BEND point assignment | GATE-PTE-05 |
| PTE-002 §7 | OLET point assignment | GATE-PTE-06 |
| PTE-002 §8 | Case D(a): two-pass orphan sweep | GATE-PTE-07 |
| PTE-002 §9 | Case D(b): pure orphan sweep | GATE-PTE-08 |
| PTE-002 §10 | Axis sweep scoring | GATE-PTE-09 |
| PTE-001 Findings | TEE branch starts at CP (R-PTE-20) | GATE-PTE-10 |
| PTE-001 Findings | OLET EP1=EP2=CP (R-PTE-21) | GATE-PTE-11 |
| PTE-001 Findings | NodeNo as connection key (R-PTE-31) | GATE-PTE-12 |

**Rules to implement:** R-PTE-01 through R-PTE-63 (all 40+ PTE rules).

## 3.4 PTE Output

After conversion, the PTE module outputs rows in the **same schema as §1.3** with `_source: "PTE"`. These go directly into `state.dataTable`.

---

# PART 4 — INPUT PATH 2: ELEMENT CSV/EXCEL

## 4.1 Processing

Standard element-based import per PCF Consolidated Master v2.0 Part A §13:

1. Fuzzy header matching (3-pass: exact → substring → Levenshtein).
2. Map columns to canonical names.
3. Parse coordinate strings `"96400.0, 17986.4, 101968.0"` into `{x, y, z}`.
4. Parse bore (handle "400mm", "16in", bare numbers).
5. Populate Data Table rows with `_source: "CSV"`.

**Validation still required** even for element input — coordinates may have errors, CPs may be wrong, SKEY may be missing, etc.

---

# PART 5 — INPUT PATH 3: PCF TEXT

## 5.1 PCF Parser

Line-by-line state machine per PCF Consolidated Master v2.0 Part A §14 and WI-001 §2.3.

Parse: header lines, MESSAGE-SQUARE blocks, component keywords, END-POINT, CENTRE-POINT, BRANCH1-POINT, CO-ORDS, `<SKEY>`, `<SUPPORT_NAME>`, `<SUPPORT_GUID>`, COMPONENT-ATTRIBUTE, ANGLE, BEND-RADIUS, FLAT-DIRECTION, PIPELINE-REFERENCE (inside PIPE block).

Output: Data Table rows with `_source: "PCF"`.

---

# PART 6 — PROCESSING PIPELINE

## 6.1 Complete Pipeline (All Input Paths Merge Here)

```
ALL INPUTS → Data Table populated
  │
  ▼
Step 1:  Parse MESSAGE-SQUARE → cross-verify with component data
Step 2:  Fill missing identifiers (CSV SEQ NO, REF NO., CA97, CA98)
Step 3:  Bore unit conversion (inch → mm detection)
Step 4:  TEXT auto-generation (MESSAGE-SQUARE formula)
  │
  │  ┌─── [Smart Fix 🔧] button click ───┐
  ▼  ▼                                    │
Step 4A: Build connectivity graph          │
Step 4B: Walk all chains                   │
Step 4C: Run 57 rules (R-GEO..R-AGG)     │
Step 4D: Populate Fixing Action column    │
Step 4E: User reviews in Data Table       │
Step 4F: [Apply Fixes ✓] → execute T1+T2 │
  │                                        │
  ▼  ◄────────────────────────────────────┘
Step 5:  Bi-directional coordinate recalc (EP ↔ DELTA ↔ LEN)
Step 6:  CP/BP calculation (TEE midpoint, BEND corner, OLET)
Step 7:  BRLEN fallback lookup (ASME B16.9 database)
Step 8:  Branch bore fallback
Step 9:  SUPPORT mapping (Friction/Gap → Name, UCI: prefix)
Step 10: Pointer calculation (BEND_PTR, RIGID_PTR, INT_PTR)
Step 11: MESSAGE-SQUARE regeneration
Step 12: Validation V1–V20 (full checklist)
Step 13: Tally generation (before vs after)
  │
  ▼
[Export PCF ↓] → Generate PCF from Data Table (CRLF, decimal consistency)
```

## 6.2 Steps 1–4: Basic Fixer

Implement per PCF Consolidated Master v2.0 Part C §5.2–5.5 (cross-verify, identifiers, bore, TEXT).

## 6.3 Steps 4A–4F: Smart Fixer

Implement per PCF Consolidated Master v2.0 Part C §4–13 (graph, walker, 57 rules, fix application, Fixing Action preview).

## 6.4 Steps 5–13: Post-Fix Processing

Implement per PCF Consolidated Master v2.0 Part A §8, §9, §10, §12, §14, §18 and Part C §5.6–5.10.

---

# PART 7 — DATA TABLE TAB

## 7.1 Display

42 columns per PCF Syntax Master v1.2 §13 + Fixing Action column (§12A of Smart Fixer Rules).

Cell coloring:

| Cell State | Background | Meaning |
|-----------|-----------|---------|
| Normal | White | Unchanged |
| Modified (by fixer) | `#FFF3CD` amber | Value was changed |
| Calculated (derived) | `#D1ECF1` cyan | Computed from other data |
| Mock (assumed) | `#F8D7DA` red-light | Assumed value (e.g., origin 0,0,0) |
| Error | `#F5C6CB` red | Failed validation |
| PTE Implicit | `#E2E3F1` lavender | Created by PTE converter (implicit pipe) |

**Fixing Action column** uses tier-colored badges (Part B §12A of consolidated master).

## 7.2 Export Data Table

`exceljs` export with cell coloring preserved. Auto-download as `PCF_DataTable_{timestamp}.xlsx`.

---

# PART 8 — CONFIG TAB

All settings from:

- PCF Syntax Master v1.2 §21 (decimals, aliases, BRLEN database, etc.)
- Smart Fixer Rules §14 (57 thresholds and scoring weights)
- PTE Conversion Rules v2 §12 (sweep stages, scoring, PTE mode)

Organized as collapsible sections with editable fields.

---

# PART 9 — DEBUG TAB

## 9.1 Layout

```
┌────────────────────────────────────────────────────────────┐
│  FILTER: [All] [Error●] [Warning●] [Calculated●] [Mock●]  │
│          [Info●] [Applied●] [PTE●]                         │
├────────────────────────────────────────────────────────────┤
│  LOG TABLE (sortable by Seq, Rule, Tier, Tag)              │
│  ┌─────┬────────┬─────────┬──────┬────────────────────────┐│
│  │ Row │ Tag    │ Rule ID │ Tier │ Message                ││
│  ├─────┼────────┼─────────┼──────┼────────────────────────┤│
│  │  —  │[PTE]   │R-PTE-20 │  —   │ Branch BRAN at CP...  ││
│  │  5  │[Calc]  │ —       │  —   │ LEN1 derived: -654    ││
│  │  8  │[Error] │R-CHN-01 │  4   │ Axis change without.. ││
│  │ 12  │[Applied]│R-GAP-02│  2   │ Inserted 15mm pipe    ││
│  └─────┴────────┴─────────┴──────┴────────────────────────┘│
├────────────────────────────────────────────────────────────┤
│  TALLY TABLE                                               │
│  ┌─────────────────────┬───────────┬───────────┐           │
│  │ Metric              │ Imported  │ Processed │           │
│  ├─────────────────────┼───────────┼───────────┤           │
│  │ Total Lines         │    87     │    92     │           │
│  │ Components (total)  │    17     │    19     │           │
│  │ PIPE (count / len)  │ 6 / 3054m│ 8 / 3069m│           │
│  │ FLANGE (count)      │    5      │    5      │           │
│  │ VALVE (count)       │    1      │    1      │           │
│  │ TEE (count)         │    1      │    1      │           │
│  │ BEND (count)        │    1      │    1      │           │
│  │ OLET (count)        │    0      │    0      │           │
│  │ REDUCER-C (count)   │    0      │    0      │           │
│  │ REDUCER-E (count)   │    0      │    0      │           │
│  │ SUPPORT (count)     │    1      │    1      │           │
│  ├─────────────────────┼───────────┼───────────┤           │
│  │ Smart Fix: T1 fixes │     —     │    3      │           │
│  │ Smart Fix: T2 fixes │     —     │    1      │           │
│  │ Smart Fix: Warnings │     —     │    2      │           │
│  │ Smart Fix: Errors   │     —     │    0      │           │
│  │ Chains found        │     —     │    2      │           │
│  │ Orphans             │     —     │    0      │           │
│  └─────────────────────┴───────────┴───────────┘           │
└────────────────────────────────────────────────────────────┘
```

---

# PART 10 — OUTPUT TAB

Monospace syntax-highlighted PCF preview with **[📋 Copy]** button (top-right).

**[Export PCF ↓]** generates PCF from Data Table per Consolidated Master Part A §14, joins with `\r\n`, downloads as `.pcf` file.

Syntax coloring: component keywords (blue), MESSAGE-SQUARE (green), geometry lines (teal), `<SKEY>` (purple), CAs (gray), numbers (orange).

---

# PART 11 — RULE ENFORCEMENT SYSTEM

## 11.1 The Problem

In the previous WI, the AI agent missed implementing 17 out of 57 rules. Rules were described in prose but no mechanism verified their implementation.

## 11.2 The Solution: Rule Registry + Implementation Gates

### 11.2.1 Rule Registry

At application startup, every rule must be registered:

```javascript
// ═══════════════════════════════════════════
// RULE REGISTRY — Every rule must be here
// ═══════════════════════════════════════════

const RULE_REGISTRY = {
  // ─── Validation Rules (V1–V20) ───
  "V1":  { name: "No (0,0,0) coordinates",        severity: "ERROR",   implemented: false },
  "V2":  { name: "Decimal consistency",            severity: "ERROR",   implemented: false },
  "V3":  { name: "Bore consistency",               severity: "ERROR",   implemented: false },
  "V4":  { name: "BEND CP ≠ EP1",                  severity: "ERROR",   implemented: false },
  "V5":  { name: "BEND CP ≠ EP2",                  severity: "ERROR",   implemented: false },
  "V6":  { name: "BEND CP not collinear",          severity: "ERROR",   implemented: false },
  "V7":  { name: "BEND CP equidistant",            severity: "WARNING", implemented: false },
  "V8":  { name: "TEE CP = midpoint",              severity: "ERROR",   implemented: false },
  "V9":  { name: "TEE CP bore = EP bore",          severity: "ERROR",   implemented: false },
  "V10": { name: "TEE BP perpendicular",           severity: "WARNING", implemented: false },
  "V11": { name: "OLET no END-POINTs",             severity: "ERROR",   implemented: false },
  "V12": { name: "SUPPORT no CAs",                 severity: "ERROR",   implemented: false },
  "V13": { name: "SUPPORT bore = 0",               severity: "ERROR",   implemented: false },
  "V14": { name: "<SKEY> presence",                 severity: "WARNING", implemented: false },
  "V15": { name: "Coordinate continuity",           severity: "WARNING", implemented: false },
  "V16": { name: "CA8 scope",                       severity: "WARNING", implemented: false },
  "V17": { name: "CRLF line endings",               severity: "ERROR",   implemented: false },
  "V18": { name: "Bore unit detection",              severity: "WARNING", implemented: false },
  "V19": { name: "SUPPORT MESSAGE-SQUARE",           severity: "WARNING", implemented: false },
  "V20": { name: "GUID prefix UCI:",                 severity: "ERROR",   implemented: false },

  // ─── Smart Fixer Rules (R-GEO through R-AGG) ───
  "R-GEO-01": { name: "Micro-element deletion",     tier: "1/4", implemented: false },
  "R-GEO-02": { name: "Bore continuity",            tier: "4",   implemented: false },
  "R-GEO-03": { name: "Single-axis element rule",   tier: "2/4", implemented: false },
  "R-GEO-04": { name: "Fitting dimension sanity",   tier: "3",   implemented: false },
  "R-GEO-05": { name: "Bend radius sanity",         tier: "3",   implemented: false },
  "R-GEO-06": { name: "Valve face-to-face",         tier: "3",   implemented: false },
  "R-GEO-07": { name: "Zero-length element",        tier: "4",   implemented: false },
  "R-GEO-08": { name: "Coordinate magnitude",       tier: "3/4", implemented: false },
  "R-TOP-01": { name: "Dead-end detection",          tier: "3",   implemented: false },
  "R-TOP-02": { name: "Orphan element detection",    tier: "4",   implemented: false },
  "R-TOP-03": { name: "Duplicate element detection",  tier: "4",   implemented: false },
  "R-TOP-04": { name: "Flange pair check",           tier: "3",   implemented: false },
  "R-TOP-05": { name: "Valve flange sandwich",       tier: "3",   implemented: false },
  "R-TOP-06": { name: "Support on-pipe validation",  tier: "4",   implemented: false },
  "R-TOP-07": { name: "Tee CP on header segment",    tier: "4",   implemented: false },
  "R-CHN-01": { name: "Axis change without bend",    tier: "4",   implemented: false },
  "R-CHN-02": { name: "Fold-back detection",         tier: "2/4", implemented: false },
  "R-CHN-03": { name: "Elbow-elbow proximity",       tier: "3",   implemented: false },
  "R-CHN-04": { name: "Sequence number ordering",    tier: "info", implemented: false },
  "R-CHN-05": { name: "Elevation drift",             tier: "2/3", implemented: false },
  "R-CHN-06": { name: "Shared-axis snapping",        tier: "1/2/4", implemented: false },
  "R-GAP-01": { name: "Negligible gap (<1mm)",       tier: "1",   implemented: false },
  "R-GAP-02": { name: "Axial gap ≤25mm",             tier: "2",   implemented: false },
  "R-GAP-03": { name: "Axial gap >25mm",             tier: "3/4", implemented: false },
  "R-GAP-04": { name: "Lateral gap",                 tier: "2/4", implemented: false },
  "R-GAP-05": { name: "Multi-axis negligible lat",   tier: "2",   implemented: false },
  "R-GAP-06": { name: "Multi-axis significant",      tier: "4",   implemented: false },
  "R-GAP-07": { name: "Gap at tee junction",         tier: "2",   implemented: false },
  "R-GAP-08": { name: "Only pipes fill gaps",        tier: "rule", implemented: false },
  "R-OVR-01": { name: "Simple axial overlap pipe",   tier: "2/3", implemented: false },
  "R-OVR-02": { name: "Overlap rigid current",       tier: "2/4", implemented: false },
  "R-OVR-03": { name: "Rigid-on-rigid overlap",      tier: "4",   implemented: false },
  "R-OVR-04": { name: "Enveloping overlap",          tier: "4",   implemented: false },
  "R-OVR-05": { name: "Overlap at tee boundary",     tier: "2/3", implemented: false },
  "R-OVR-06": { name: "Overlap negative pipe",       tier: "2",   implemented: false },
  "R-BRN-01": { name: "Branch bore > header bore",   tier: "4",   implemented: false },
  "R-BRN-02": { name: "Olet size ratio",             tier: "3/4", implemented: false },
  "R-BRN-03": { name: "Branch same axis as header",  tier: "4",   implemented: false },
  "R-BRN-04": { name: "Branch perpendicularity",     tier: "3/4", implemented: false },
  "R-BRN-05": { name: "Branch chain continuation",   tier: "4",   implemented: false },
  "R-SPA-01": { name: "Elevation consistency",        tier: "2/3", implemented: false },
  "R-SPA-02": { name: "Shared-axis coord snap",      tier: "1/2/4", implemented: false },
  "R-SPA-03": { name: "Gravity-aware support",       tier: "3",   implemented: false },
  "R-SPA-04": { name: "Collinear pipe merge",        tier: "info", implemented: false },
  "R-SPA-05": { name: "Suspicious placeholder",      tier: "3",   implemented: false },
  "R-DAT-01": { name: "Precision consistency",        tier: "3",   implemented: false },
  "R-DAT-02": { name: "Suspicious round numbers",    tier: "3",   implemented: false },
  "R-DAT-03": { name: "Material continuity",         tier: "3",   implemented: false },
  "R-DAT-04": { name: "Design condition continuity",  tier: "3",   implemented: false },
  "R-DAT-05": { name: "CA8 weight scope",            tier: "3",   implemented: false },
  "R-DAT-06": { name: "SKEY prefix mismatch",        tier: "3",   implemented: false },
  "R-AGG-01": { name: "Total pipe length sanity",    tier: "3/4", implemented: false },
  "R-AGG-02": { name: "Min tangent between bends",   tier: "3",   implemented: false },
  "R-AGG-03": { name: "Route closure check",         tier: "3/4", implemented: false },
  "R-AGG-04": { name: "Dead-end detection",          tier: "3",   implemented: false },
  "R-AGG-05": { name: "Flange pair completeness",    tier: "3",   implemented: false },
  "R-AGG-06": { name: "Component count sanity",      tier: "3",   implemented: false },

  // ─── PTE Rules ───
  "R-PTE-01": { name: "Same RefNo = same component", implemented: false },
  "R-PTE-02": { name: "Point semantics (1,2,0,3)",   implemented: false },
  "R-PTE-03": { name: "Gap = implicit pipe",          implemented: false },
  "R-PTE-04": { name: "Only PIPE is implicit",        implemented: false },
  "R-PTE-05": { name: "BRAN = chain origin",          implemented: false },
  "R-PTE-06": { name: "ANCI = point element",         implemented: false },
  "R-PTE-07": { name: "GASK < 6mm skip",              implemented: false },
  "R-PTE-08": { name: "Zero-length point discard",    implemented: false },
  "R-PTE-09": { name: "Implicit pipe inherits props",  implemented: false },
  "R-PTE-10": { name: "Support GUID = UCI:+NodeName",  implemented: false },
  "R-PTE-11": { name: "Bore string parsing",           implemented: false },
  "R-PTE-12": { name: "East→X, North→Y, Up→Z",        implemented: false },
  "R-PTE-20": { name: "Branch BRAN at TEE CP",         implemented: false },
  "R-PTE-21": { name: "OLET EP1=EP2=CP",               implemented: false },
  "R-PTE-29": { name: "PCOM → PIPE",                   implemented: false },
  "R-PTE-31": { name: "NodeNo connection key",          implemented: false },
  "R-PTE-34": { name: "Dual identity of coordinates",   implemented: false },
  "R-PTE-41": { name: "Line_Key optional",              implemented: false },
  "R-PTE-42": { name: "Gap-fill within same Line_Key",  implemented: false },
  "R-PTE-50": { name: "Orphan sweep from terminal",     implemented: false },
  "R-PTE-51": { name: "Progressive sweep stages",       implemented: false },
  "R-PTE-52": { name: "Axis scoring: same-dir bonus",   implemented: false },
};

const TOTAL_RULES = Object.keys(RULE_REGISTRY).length;
// Expected: 20 (V) + 57 (R-smart) + ~20 (R-PTE) ≈ 97 rules
```

### 11.2.2 Registration Function

Each rule implementation must call `registerRule`:

```javascript
function registerRule(ruleId) {
  if (!RULE_REGISTRY[ruleId]) {
    console.error(`UNKNOWN RULE: ${ruleId} — not in registry!`);
    return;
  }
  RULE_REGISTRY[ruleId].implemented = true;
  RULE_REGISTRY[ruleId].executionCount = 0;
}

function logRuleExecution(ruleId, rowIndex, message) {
  if (RULE_REGISTRY[ruleId]) {
    RULE_REGISTRY[ruleId].executionCount = (RULE_REGISTRY[ruleId].executionCount || 0) + 1;
  }
  // Add to master log...
}
```

### 11.2.3 Implementation Gate — Build-Time Check

```javascript
function verifyAllRulesImplemented() {
  const missing = Object.entries(RULE_REGISTRY)
    .filter(([id, r]) => !r.implemented)
    .map(([id, r]) => `${id}: ${r.name}`);
  
  if (missing.length > 0) {
    const msg = `IMPLEMENTATION GATE FAILED!\n` +
      `${missing.length} rules not implemented:\n` +
      missing.map(m => `  ✗ ${m}`).join('\n');
    
    console.error(msg);
    
    // In dev mode: show alert, don't block
    // In production: this should be caught in CI/CD
    return { passed: false, missing, total: TOTAL_RULES };
  }
  
  return { passed: true, missing: [], total: TOTAL_RULES };
}

// Call at app startup:
const gateResult = verifyAllRulesImplemented();
```

---

# PART 12 — DEVELOPER DEBUG TAB (Dev 🔧)

## 12.1 Visibility

- **Hidden by default** in production mode.
- **Shown** when `?dev=1` URL parameter or `config.devMode = true`.
- Tab label: `Dev 🔧` (appears after Output tab).

## 12.2 Layout

```
┌────────────────────────────────────────────────────────────────┐
│  DEVELOPER DEBUG TAB                         [Toggle: ON/OFF] │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ▼ RULE COVERAGE REPORT                                       │
│  ┌───────────┬─────────────────────────────────┬─────┬───────┐│
│  │ Rule ID   │ Name                            │Impl?│ Runs  ││
│  ├───────────┼─────────────────────────────────┼─────┼───────┤│
│  │ V1        │ No (0,0,0) coordinates          │ ✓   │  17   ││
│  │ V2        │ Decimal consistency              │ ✓   │   1   ││
│  │ ...       │                                  │     │       ││
│  │ R-GEO-01  │ Micro-element deletion           │ ✓   │   3   ││
│  │ R-GEO-02  │ Bore continuity                  │ ✗   │   0   ││ ← RED!
│  │ ...       │                                  │     │       ││
│  │ R-PTE-20  │ Branch BRAN at TEE CP            │ ✓   │   2   ││
│  └───────────┴─────────────────────────────────┴─────┴───────┘│
│                                                                │
│  Summary: 94/97 rules implemented ⚠️  3 MISSING               │
│  Missing: R-GEO-02, R-TOP-03, R-PTE-52                       │
│                                                                │
│  ▼ BENCHMARK TEST RESULTS                                     │
│  ┌───────────┬────────────────────────────────┬────────┐      │
│  │ Test ID   │ Description                    │ Result │      │
│  ├───────────┼────────────────────────────────┼────────┤      │
│  │ BM-V-01   │ V1: detect (0,0,0) in EP1      │ ✓ PASS │      │
│  │ BM-V-02   │ V1: allow (0, 5000, 3000)      │ ✓ PASS │      │
│  │ BM-V-03   │ V3: reducer bore differ         │ ✗ FAIL │ ← RED│
│  │ ...       │                                 │        │      │
│  │ BM-PTE-01 │ PTE: BRAN skip as delimiter     │ ✓ PASS │      │
│  │ BM-PTE-02 │ PTE: GASK < 6mm skipped         │ ✓ PASS │      │
│  └───────────┴────────────────────────────────┴────────┘      │
│                                                                │
│  Summary: 118/122 tests passed. 4 FAILED.                     │
│                                                                │
│  ▼ CHAIN WALKER VISUALIZATION (optional)                      │
│  Chain 1: Flange→Pipe(654)→[SUPPORT]→Pipe(295)→TEE→...       │
│  Chain 2 (branch): Pipe(200)→Flange→Valve→Flange→...          │
│                                                                │
│  ▼ RAW STATE DUMP                                             │
│  { dataTable: [...], config: {...}, smartFix: {...} }          │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## 12.3 Rule Coverage Tracking

```javascript
function RuleCoveragePanel({ ruleRegistry }) {
  const rules = Object.entries(ruleRegistry);
  const implemented = rules.filter(([_, r]) => r.implemented);
  const executed = rules.filter(([_, r]) => (r.executionCount || 0) > 0);
  const missing = rules.filter(([_, r]) => !r.implemented);
  
  return (
    <div>
      <h3>Rule Coverage: {implemented.length}/{rules.length} implemented</h3>
      {missing.length > 0 && (
        <div style={{background:"#F8D7DA", padding:8, borderRadius:4}}>
          <strong>MISSING RULES:</strong>
          {missing.map(([id, r]) => <div key={id}>✗ {id}: {r.name}</div>)}
        </div>
      )}
      <h4>Executed this session: {executed.length}/{implemented.length}</h4>
      <table>
        {rules.map(([id, r]) => (
          <tr key={id} style={{
            background: !r.implemented ? "#F8D7DA" : 
                        (r.executionCount || 0) === 0 ? "#FFF3CD" : "white"
          }}>
            <td>{id}</td>
            <td>{r.name}</td>
            <td>{r.implemented ? "✓" : "✗"}</td>
            <td>{r.executionCount || 0}</td>
          </tr>
        ))}
      </table>
    </div>
  );
}
```

---

# PART 13 — BENCHMARK TEST SUITE

## 13.1 Design Philosophy

Each benchmark is a **micro-test** targeting ONE specific rule or transformation. The test provides minimal input data and expected output. Tests are grouped by stage.

## 13.2 Benchmark Structure

```javascript
const BENCHMARK = {
  id: "BM-V-01",
  group: "validation",        // "validation" | "smartfix" | "pte" | "pcf_gen"
  rule: "V1",                 // Which rule this tests
  description: "V1: Detect (0,0,0) in EP1",
  input: {
    dataTable: [
      { type: "PIPE", ep1: {x:0,y:0,z:0}, ep2: {x:1000,y:0,z:0}, bore: 350 }
    ]
  },
  expected: {
    validationResult: { ruleId: "V1", severity: "ERROR", row: 0 }
  },
  run: (app) => {
    const results = app.runValidation(BENCHMARK.input.dataTable);
    const v1hit = results.find(r => r.id === "V1" && r.row === 0);
    return v1hit ? "PASS" : "FAIL";
  }
};
```

## 13.3 Complete Benchmark Catalog

### GROUP 1: Validation Rules (BM-V) — 40 tests

| Test ID | Rule | Input | Expected |
|---------|------|-------|----------|
| BM-V-01 | V1 | PIPE with EP1=(0,0,0) | ERROR flagged |
| BM-V-02 | V1 | PIPE with EP1=(0,5000,3000) | No error (single zero OK) |
| BM-V-03 | V1 | SUPPORT CO-ORDS=(0,0,0) | ERROR flagged |
| BM-V-04 | V2 | EP coordinates 4-decimal, bore integer | ERROR (decimal mismatch) |
| BM-V-05 | V2 | All 4-decimal including bore | PASS |
| BM-V-06 | V3 | REDUCER with EP1 bore=400, EP2 bore=400 | ERROR (same bore) |
| BM-V-07 | V3 | REDUCER with EP1 bore=400, EP2 bore=350 | PASS |
| BM-V-08 | V3 | PIPE with EP1 bore=400, EP2 bore=350 | ERROR (non-reducer bore change) |
| BM-V-09 | V4 | BEND with CP=EP1 | ERROR |
| BM-V-10 | V5 | BEND with CP=EP2 | ERROR |
| BM-V-11 | V6 | BEND with CP on EP1-EP2 line (collinear) | ERROR |
| BM-V-12 | V6 | BEND with CP off-line (valid) | PASS |
| BM-V-13 | V7 | BEND dist(CP,EP1)=500, dist(CP,EP2)=505 | WARNING (>1mm) |
| BM-V-14 | V7 | BEND dist(CP,EP1)=500, dist(CP,EP2)=500 | PASS |
| BM-V-15 | V8 | TEE CP ≠ midpoint(EP1,EP2) by 5mm | ERROR |
| BM-V-16 | V8 | TEE CP = exact midpoint | PASS |
| BM-V-17 | V9 | TEE CP bore=350, EP bore=400 | ERROR |
| BM-V-18 | V10 | TEE BP not perpendicular (30° off) | WARNING |
| BM-V-19 | V10 | TEE BP perpendicular (< 1° off) | PASS |
| BM-V-20 | V11 | OLET with EP1 populated | ERROR |
| BM-V-21 | V11 | OLET with only CP+BP | PASS |
| BM-V-22 | V12 | SUPPORT with CA1 populated | ERROR |
| BM-V-23 | V12 | SUPPORT with no CAs | PASS |
| BM-V-24 | V13 | SUPPORT bore=350 | ERROR |
| BM-V-25 | V13 | SUPPORT bore=0 | PASS |
| BM-V-26 | V14 | FLANGE with empty SKEY | WARNING |
| BM-V-27 | V14 | PIPE with empty SKEY | PASS (not required) |
| BM-V-28 | V15 | Two pipes: EP2[0] ≠ EP1[1] by 5mm | WARNING |
| BM-V-29 | V15 | Two pipes: EP2[0] = EP1[1] exactly | PASS |
| BM-V-30 | V16 | PIPE with CA8 populated | WARNING |
| BM-V-31 | V16 | FLANGE without CA8 | INFO |
| BM-V-32 | V17 | PCF output with \n not \r\n | ERROR |
| BM-V-33 | V18 | Bore=16 (likely inches) | WARNING |
| BM-V-34 | V18 | Bore=400 (clearly mm) | PASS |
| BM-V-35 | V19 | SUPPORT MSG-SQ with LENGTH token | WARNING |
| BM-V-36 | V19 | SUPPORT MSG-SQ with only RefNo/SeqNo | PASS |
| BM-V-37 | V20 | SUPPORT_GUID="PS00178.1" (no UCI:) | ERROR |
| BM-V-38 | V20 | SUPPORT_GUID="UCI:PS00178.1" | PASS |
| BM-V-39 | V3 | PIPE EP1 bore=350, EP2 bore=350 | PASS (non-reducer, same bore OK) |
| BM-V-40 | V14 | TEE with SKEY=TEBW | PASS |

### GROUP 2: Smart Fixer Rules (BM-SF) — 40 tests

| Test ID | Rule | Input Scenario | Expected Action |
|---------|------|---------------|-----------------|
| BM-SF-01 | R-GEO-01 | 3mm pipe element | DELETE (Tier 1) |
| BM-SF-02 | R-GEO-01 | 10mm pipe element | No action (> 6mm) |
| BM-SF-03 | R-GEO-02 | Bore 400→350 without reducer | ERROR flagged |
| BM-SF-04 | R-GEO-03 | Pipe with 1mm off-axis drift | SNAP (Tier 2) |
| BM-SF-05 | R-GEO-03 | Pipe running diagonally (50mm on 2 axes) | ERROR flagged |
| BM-SF-06 | R-GEO-07 | Zero-length flange (EP1=EP2) | ERROR flagged |
| BM-SF-07 | R-CHN-01 | Pipe changes from Y-axis to Z-axis | ERROR (missing bend) |
| BM-SF-08 | R-CHN-02 | 5mm fold-back pipe | DELETE (Tier 2) |
| BM-SF-09 | R-CHN-02 | 50mm fold-back pipe | ERROR (too large) |
| BM-SF-10 | R-CHN-03 | Two bends with 0mm pipe between | WARNING |
| BM-SF-11 | R-CHN-06 | 0.5mm Y-drift on X-axis pipe | SNAP silent (Tier 1) |
| BM-SF-12 | R-CHN-06 | 5mm Y-drift on X-axis pipe | SNAP + warning (Tier 2) |
| BM-SF-13 | R-CHN-06 | 15mm Y-drift on X-axis pipe | ERROR (too large) |
| BM-SF-14 | R-GAP-01 | 0.3mm gap between elements | SNAP (Tier 1) |
| BM-SF-15 | R-GAP-02 | 15mm axial gap along travel | INSERT pipe (Tier 2) |
| BM-SF-16 | R-GAP-03 | 50mm axial gap | WARNING (Tier 3) |
| BM-SF-17 | R-GAP-03 | 150mm axial gap | ERROR (Tier 4) |
| BM-SF-18 | R-GAP-04 | 1mm lateral offset | SNAP (Tier 2) |
| BM-SF-19 | R-GAP-04 | 8mm lateral offset | ERROR (Tier 4) |
| BM-SF-20 | R-GAP-05 | Multi-axis: 10mm axial + 0.5mm lateral | INSERT (Tier 2) |
| BM-SF-21 | R-GAP-06 | Multi-axis: 10mm axial + 5mm lateral | ERROR (Tier 4) |
| BM-SF-22 | R-OVR-01 | 10mm pipe-pipe overlap | TRIM (Tier 2) |
| BM-SF-23 | R-OVR-01 | 30mm pipe-pipe overlap | WARNING (Tier 3) |
| BM-SF-24 | R-OVR-02 | Flange overlaps pipe by 5mm | TRIM next pipe (Tier 2) |
| BM-SF-25 | R-OVR-03 | Flange overlaps flange by 5mm | ERROR (rigid-on-rigid) |
| BM-SF-26 | R-OVR-06 | Trim creates 2mm remaining pipe | DELETE after trim |
| BM-SF-27 | R-BRN-01 | TEE branch bore 500 > header bore 400 | ERROR |
| BM-SF-28 | R-BRN-02 | OLET ratio 0.6 (> 0.5) | WARNING |
| BM-SF-29 | R-BRN-03 | TEE branch same axis as header | ERROR |
| BM-SF-30 | R-BRN-04 | TEE branch 20° from perpendicular | ERROR |
| BM-SF-31 | R-TOP-01 | Chain ending at bare pipe | WARNING |
| BM-SF-32 | R-TOP-02 | Disconnected element | ERROR (orphan) |
| BM-SF-33 | R-TOP-04 | Single mid-chain flange (odd count) | WARNING |
| BM-SF-34 | R-TOP-06 | Support 10mm off pipe axis | ERROR |
| BM-SF-35 | R-DAT-03 | Material changes without flange joint | WARNING |
| BM-SF-36 | R-DAT-06 | FLANGE with SKEY="VBFL" (wrong prefix) | WARNING |
| BM-SF-37 | R-AGG-01 | Chain with zero total pipe length | ERROR |
| BM-SF-38 | R-AGG-03 | Route closure error 30mm | WARNING |
| BM-SF-39 | R-AGG-05 | 3 mid-chain flanges (odd) | WARNING |
| BM-SF-40 | R-GAP-08 | Verify gap-fill creates PIPE not fitting | Filler type = PIPE |

### GROUP 3: PTE Conversion (BM-PTE) — 30 tests

| Test ID | Rule | Input Scenario | Expected |
|---------|------|---------------|----------|
| BM-PTE-01 | R-PTE-05 | BRAN Pt=1 row | Skip (chain start, not a component) |
| BM-PTE-02 | R-PTE-07 | GASK 3mm | Skip (< 6mm) |
| BM-PTE-03 | R-PTE-07 | GASK 8mm | Convert to short PIPE |
| BM-PTE-04 | R-PTE-06 | ANCI row | Create SUPPORT + implicit pipe |
| BM-PTE-05 | R-PTE-03 | 654mm gap between FLAN tail and ANCI | Implicit PIPE 654mm |
| BM-PTE-06 | R-PTE-01 | Two FLAN rows same RefNo | Grouped as one flange |
| BM-PTE-07 | R-PTE-02 | TEE with Pt=1,2,0,3 | EP1, EP2, CP, BP correctly assigned |
| BM-PTE-08 | R-PTE-20 | Branch BRAN at TEE CP (NodeNo match) | BRLEN subtracted from gap |
| BM-PTE-09 | R-PTE-21 | OLET with EP1=EP2=CP | Zero-length on header confirmed |
| BM-PTE-10 | R-PTE-22 | OLET BP only distinct point | BRLEN = dist(CP, BP) |
| BM-PTE-11 | R-PTE-29 | PCOM type in input | Maps to PIPE |
| BM-PTE-12 | R-PTE-11 | Bore="400mm" | Parsed as 400 |
| BM-PTE-13 | R-PTE-11 | Bore="16in" | Parsed as 406.4 |
| BM-PTE-14 | R-PTE-12 | East=96400, North=17989, Up=101968 | x=96400, y=17989, z=101968 |
| BM-PTE-15 | R-PTE-31 | TEE CP NodeNo=40, BRAN NodeNo=40 | Branch linked to TEE |
| BM-PTE-16 | R-PTE-34 | Sequential: row B is EP2 of A and EP1 of B | Both elements created |
| BM-PTE-17 | R-PTE-41 | Line_Key=OFF | Conversion still works (topology only) |
| BM-PTE-18 | R-PTE-42 | Gap between different Line_Keys | NOT a gap (line boundary) |
| BM-PTE-19 | R-PTE-50 | Unordered data, orphan sweep | Correct chain reconstructed |
| BM-PTE-20 | R-PTE-52 | Same-axis-same-dir neighbor | Gets 70% scoring bonus |
| BM-PTE-21 | R-PTE-52 | Fold-back neighbor | Gets 5× scoring penalty |
| BM-PTE-22 | Case A | Full data with Ref/Pt/PPt | Real_Type correctly added |
| BM-PTE-23 | Case B(a) | Sequential + Line_Key, no Ref/Pt | All derived correctly |
| BM-PTE-24 | Case B(b) | Sequential, no Line_Key, no Ref/Pt | All derived correctly |
| BM-PTE-25 | Case D(a) | Non-sequential + Line_Key | Two-pass sweep works |
| BM-PTE-26 | Case D(b) | Non-sequential, no Line_Key | Pure sweep works |
| BM-PTE-27 | PPoint | Flange pair detected | Inverted PPoint on mating flange |
| BM-PTE-28 | Implicit | Support doesn't break pipe | Pipes on both sides of ANCI |
| BM-PTE-29 | TEE CP | Verify CP = midpoint(EP1,EP2) | Within 0.1mm on all axes |
| BM-PTE-30 | BEND CP | CP at corner (90° bend) | dist(CP,EP1) = dist(CP,EP2) |

### GROUP 4: PCF Generation (BM-PCF) — 12 tests

| Test ID | Input | Expected PCF Output |
|---------|-------|-------------------|
| BM-PCF-01 | Single PIPE element | Correct END-POINT lines, CRLF |
| BM-PCF-02 | FLANGE with SKEY | `<SKEY>  FLWN` (angle brackets) |
| BM-PCF-03 | SUPPORT element | CO-ORDS bore=0, no CAs, UCI: prefix |
| BM-PCF-04 | TEE element | All 4 geometry lines + MESSAGE-SQUARE |
| BM-PCF-05 | OLET element | Only CP + BP, no END-POINTs |
| BM-PCF-06 | REDUCER-ECCENTRIC | Different bores + FLAT-DIRECTION |
| BM-PCF-07 | Decimal=4 setting | All coords 4-decimal including bore |
| BM-PCF-08 | PIPE with PIPELINE-REFERENCE | Sub-line present |
| BM-PCF-09 | MESSAGE-SQUARE for PIPE | Correct comma-separated format |
| BM-PCF-10 | MESSAGE-SQUARE for SUPPORT | No Material/LENGTH/Direction |
| BM-PCF-11 | Full pipeline (10 elements) | Complete valid PCF, all rules pass |
| BM-PCF-12 | Re-import exported PCF | Round-trip: export→re-import→compare |

## 13.4 Benchmark Runner

```javascript
function runBenchmarks(app) {
  const results = [];
  
  for (const test of ALL_BENCHMARKS) {
    try {
      const result = test.run(app);
      results.push({
        id: test.id,
        rule: test.rule,
        description: test.description,
        status: result === "PASS" ? "PASS" : "FAIL",
        detail: result,
      });
    } catch (err) {
      results.push({
        id: test.id,
        rule: test.rule,
        description: test.description,
        status: "ERROR",
        detail: err.message,
      });
    }
  }
  
  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status !== "PASS").length;
  
  console.log(`BENCHMARKS: ${passed}/${results.length} passed, ${failed} failed.`);
  
  return { results, passed, failed, total: results.length };
}
```

## 13.5 Benchmark Data Files

Each benchmark includes its own minimal data inline. For integration tests (BM-PCF-11, BM-PCF-12), include a small but complete PCF:

```javascript
const BENCHMARK_PCF_SMALL = `ISOGEN-FILES ISOGEN.FLS
UNITS-BORE MM
UNITS-CO-ORDS MM
UNITS-WEIGHT KGS
UNITS-BOLT-DIA MM
UNITS-BOLT-LENGTH MM
PIPELINE-REFERENCE export test-line-1
    PROJECT-IDENTIFIER P1
    AREA A1

MESSAGE-SQUARE
    FLANGE, A106-B, LENGTH=146MM, SOUTH, RefNo:=TEST/001, SeqNo:1
FLANGE
    END-POINT    96400.0000 17986.4000 101968.0000 400.0000
    END-POINT    96400.0000 17840.4000 101968.0000 400.0000
    <SKEY>  FLWN
    COMPONENT-ATTRIBUTE1    700 KPA
    COMPONENT-ATTRIBUTE3    A106-B
    COMPONENT-ATTRIBUTE97    =TEST/001
    COMPONENT-ATTRIBUTE98    1

MESSAGE-SQUARE
    PIPE, A106-B, LENGTH=654MM, SOUTH, RefNo:=TEST/002, SeqNo:2
PIPE
    END-POINT    96400.0000 17840.4000 101968.0000 400.0000
    END-POINT    96400.0000 17186.4000 101968.0000 400.0000
    COMPONENT-ATTRIBUTE1    700 KPA
    COMPONENT-ATTRIBUTE3    A106-B
    COMPONENT-ATTRIBUTE97    =TEST/002
    COMPONENT-ATTRIBUTE98    2

MESSAGE-SQUARE
    SUPPORT, RefNo:=TEST/003, SeqNo:3, CA150, UCI:PS00178.1
SUPPORT
    CO-ORDS    96400.0000 17186.4000 101968.0000 0.0000
    <SUPPORT_NAME>    CA150
    <SUPPORT_GUID>    UCI:PS00178.1
`;
```

---

# PART 14 — IMPLEMENTATION ORDER AND GATES

## 14.1 Phase Plan

| Phase | Module | Gate | Benchmark Group |
|-------|--------|------|-----------------|
| P1 | App shell, tabs, state, config | — | — |
| P2 | Vector math utilities | — | — |
| P3 | Rule Registry + Dev Debug Tab | GATE-REG | — |
| P4 | PCF text parser | — | BM-PCF-01..06 |
| P5 | Element CSV import + fuzzy match | — | — |
| P6 | Data Table display | — | — |
| P7 | Basic fixer (Steps 1–4) | — | BM-V-33,34 (bore) |
| P8 | Validation V1–V20 | GATE-V | BM-V-01..40 |
| P9 | Smart Fixer: graph + walker | — | — |
| P10 | Smart Fixer: 57 rules | GATE-SF | BM-SF-01..40 |
| P11 | Smart Fixer: fix application | — | — |
| P12 | Smart Fixer: Fixing Action UI | — | — |
| P13 | PCF generator + Output tab | GATE-PCF | BM-PCF-07..12 |
| P14 | PTE converter (all 5 cases) | GATE-PTE | BM-PTE-01..30 |
| P15 | Export (exceljs + PCF file) | — | BM-PCF-12 |
| P16 | Full integration + polish | GATE-ALL | All 122 benchmarks |

## 14.2 Gate Definitions

| Gate | Condition | Block? |
|------|-----------|--------|
| GATE-REG | All RULE_REGISTRY entries present in code | YES — won't proceed to P8+ |
| GATE-V | All 20 V rules registered + BM-V tests pass | YES — won't proceed to P9 |
| GATE-SF | All 57 R rules registered + BM-SF tests pass | YES — won't proceed to P13 |
| GATE-PTE | All PTE rules registered + BM-PTE tests pass | YES — won't proceed to P15 |
| GATE-PCF | PCF generation tests pass | YES — won't proceed to P16 |
| GATE-ALL | All 122 benchmarks pass + 0 missing rules | Final gate |

---

# PART 15 — ANTI-DRIFT RULES

## 15.1 Mandatory Constraints

1. **Data Table is THE source of truth.** PCF is always generated FROM the Data Table. Never edit PCF strings directly.
2. **Only PIPE elements can be created, trimmed, or deleted** by auto-fix. Fittings are rigid.
3. **Component data > MESSAGE-SQUARE.** Always.
4. **`<SKEY>` not `SKEY`.** Angle brackets everywhere.
5. **`UCI:` prefix mandatory** on all `<SUPPORT_GUID>`.
6. **CRLF (`\r\n`)** on all PCF output.
7. **Decimal consistency:** bore matches coordinate precision (both `.1` or both `.4`).
8. **No (0,0,0)** in any coordinate field.
9. **Case-insensitive** type matching (normalize to uppercase).
10. **Line_Key is optional.** Every code path must work with and without it.
11. **Every rule must call `registerRule()`** at implementation time.
12. **Every rule execution must call `logRuleExecution()`** for tracking.
13. **Tier 3/4 findings are NEVER auto-fixed.** Preview only.
14. **Gap-fill pipes inherit** bore, CA1–CA6, CA9–CA10 from upstream. Never CA8.
15. **After Apply Fixes, always re-run Steps 5–13.**

## 15.2 Code Quality Rules

1. **No magic numbers.** All thresholds come from config.
2. **No external API calls.** 100% browser-side.
3. **No localStorage.** React state only.
4. **`exceljs` for export** (styled cells required).
5. **Custom Levenshtein for fuzzy match** (~15 lines, no library).
6. **Custom `vec` utility for math** (~40 lines, no library).

---

# PART 16 — FILE SIZE ESTIMATE

| Module | Lines | Notes |
|--------|-------|-------|
| App shell + tabs + state | ~300 | React framework |
| Vector math utilities | ~40 | `vec` object |
| Rule Registry + enforcement | ~200 | All rule IDs |
| PCF parser | ~250 | Line-by-line state machine |
| Element CSV import + fuzzy | ~200 | 3-pass matcher |
| PTE converter (all 5 cases) | ~600 | Cases A, B(a/b), D(a/b) + orphan sweep |
| Data Table tab | ~200 | 42-column display + cell coloring |
| Config tab | ~300 | All collapsible sections |
| Basic fixer (Steps 1–4) | ~200 | Identifiers, bore, TEXT |
| Validation V1–V20 | ~300 | All 20 checks |
| Smart Fixer engine | ~1400 | Graph + walker + 57 rules + application |
| Fixing Action UI | ~100 | Column render + tier badges |
| PCF generator | ~200 | Output from Data Table |
| Debug tab + tally | ~200 | Log table + tally panel |
| Dev Debug tab | ~200 | Rule coverage + benchmark runner |
| Benchmark data + runner | ~400 | 122 test definitions |
| Export (exceljs + PCF) | ~150 | Styled export |
| **TOTAL** | **~5,300** | Split into modules if needed |

If >3000 lines in single file: split into `App.jsx`, `engine/` folder with separate modules. Keep imports within the Vite project.

---

*End of Work Instruction WI-PCF-002 Rev.0*
