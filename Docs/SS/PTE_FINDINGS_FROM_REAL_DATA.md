# POINT-TO-ELEMENT CONVERTER — Findings from Real Data Analysis

## Addendum to: PCF-PTE-001 Rev.0
## Source Data: export_sys-1.csv (114 rows, 3 chains, 2 TEEs, 3 OLETs)

---

## FINDING 1: CHAIN TOPOLOGY — BRAN Pairs Define Chain Boundaries

The data contains **3 chains**, each bounded by a BRAN Pt=1 (start) and BRAN Pt=2 (end) with the **same RefNo**:

```
Chain 1: RefNo /1664
  START  Seq=1   NodeNo=—   (96400, 17989.4, 101968)  Bore=400mm
  END    Seq=17  NodeNo=60  (96400, 15486.4, 101968)
  Spans: Seq 1→17 (main header, runs South along Y-axis)

Chain 2: RefNo /1151
  START  Seq=18  NodeNo=40  (96400, 16586.4, 101968)  Bore=350mm
  END    Seq=44  NodeNo=120 (95683, 16586.4, 104360)
  Spans: Seq 18→44 (TEE branch, runs Up then West)

Chain 3: RefNo /1662
  START  Seq=45  NodeNo=120 (95683, 16586.4, 104360)  Bore=350mm
  END    Seq=114 NodeNo=420 (115945, -13000, 101968)
  Spans: Seq 45→114 (continuation, long run East then South)
```

**Rules derived:**

```
R-PTE-16: BRAN Pt=1 and BRAN Pt=2 with SAME RefNo define one chain's boundaries.
R-PTE-17: Chain 2's START NodeNo (40) matches TEE CP's NodeNo (40) — 
          this is how branches link to their parent TEE.
R-PTE-18: Chain 3's START coordinate matches Chain 2's END coordinate —
          chains can be sequential continuations (same RefNo end/start coords).
R-PTE-19: BRAN is never a physical component. It is purely a chain delimiter.
```

---

## FINDING 2: TEE BRANCHING — Branch BRAN Starts at TEE CP, NOT BP

This is the most important discovery and **corrects the PTE document §6.6**.

### TEE /1667 (Rows 7–10):

```
Pt=1 EP1: (96400, 16891.4, 101968)  bore=400  ← header entry
Pt=3 BP:  (96400, 16586.4, 102273)  bore=350  ← branch point (goes Up, Z+305)
Pt=0 CP:  (96400, 16586.4, 101968)  bore=400  NodeNo=40  ← centre
Pt=2 EP2: (96400, 16281.4, 101968)  bore=400  ← header exit

Header axis: Y (South, dy=-610mm)
Branch vector: dz=+305mm (Up)
CP = midpoint(EP1,EP2) ✓  (16891.4+16281.4)/2 = 16586.4 ✓
BRLEN = dist(CP,BP) = 305mm
```

### Branch chain /1151 starts at:

```
BRAN Seq=18 Pt=1: (96400, 16586.4, 101968)  bore=350  NodeNo=40
```

**This coordinate is the TEE CP, NOT the TEE BP!**

```
TEE CP  = (96400, 16586.4, 101968)  ← BRAN starts HERE
TEE BP  = (96400, 16586.4, 102273)  ← Branch endpoint is 305mm away

The 305mm from CP to BP is the TEE's branch body.
```

### What follows the branch BRAN:

```
BRAN (Seq=18): (96400, 16586.4, 101968)    ← CP, bore=350
FLAN (Seq=19): (96400, 16586.4, 102473)    ← first fitting on branch
  Gap = 102473 - 101968 = 505mm

This 505mm includes:
  TEE branch body:  305mm (CP to BP, which is the tee fitting itself)
  Implicit pipe:    200mm (BP to flange EP1)
```

### Conversion Rule:

```
R-PTE-20: When a branch BRAN starts at a TEE CP coordinate:
  1. The gap from BRAN to next component INCLUDES the TEE branch body (BRLEN).
  2. Subtract BRLEN from the gap to get the true implicit pipe length.
  3. The implicit pipe starts at TEE BP, NOT at TEE CP.

  Applied to this example:
    Raw gap: 505mm (BRAN to FLAN)
    BRLEN:   305mm (CP to BP, already part of the TEE element)
    True implicit pipe: 505 - 305 = 200mm (from BP to FLAN EP1)
    
    Pipe EP1 = TEE BP = (96400, 16586.4, 102273)
    Pipe EP2 = FLAN EP1 = (96400, 16586.4, 102473)
    Length = 200mm ✓
```

### TEE /22107 (Rows 97–100) — Second TEE confirms pattern:

```
Pt=1 EP1: (118384.2, -5880.2, 101968)  bore=350
Pt=3 BP:  (118114.2, -6159.2, 101968)  bore=300  ← branch goes West (dx=-270)
Pt=0 CP:  (118384.2, -6159.2, 101968)  bore=350  NodeNo=360
Pt=2 EP2: (118384.2, -6438.2, 101968)  bore=350

Header: Y-axis (South, dy=-558mm)
Branch: X-axis (West, dx=-270mm) — perpendicular ✓
CP = midpoint ✓
BRLEN = 270mm
Header bore=350, Branch bore=300 (reducing tee)
```

No branch BRAN found for this TEE in the data (branch chain likely in a separate file or not exported).

---

## FINDING 3: OLET — Pure Point Element on Header

All 3 OLETs in the data show the same pattern:

### OLET /1558 (Rows 29–32):

```
Pt=1 EP1: (96400, 16586.4, 103677)  bore=350
Pt=3 BP:  (96400, 16370.5, 103677)  bore=50    ← branch goes South (dy=-215.9)
Pt=0 CP:  (96400, 16586.4, 103677)  bore=350   NodeNo=90
Pt=2 EP2: (96400, 16586.4, 103677)  bore=350

EP1 = CP = EP2 = (96400, 16586.4, 103677) ← ALL IDENTICAL
Only BP is distinct.
```

### OLET /1576 (Rows 66–69):

```
EP1 = CP = EP2 = (105267.4, -2650.0, 107327.8)  bore=350
BP = (105267.4, -2650.0, 107543.7)  bore=50  ← branch goes Up (dz=+215.9)
```

### OLET /1594 (Rows 105–108):

```
EP1 = CP = EP2 = (117551.2, -13000.0, 101968.0)  bore=350
BP = (117551.2, -13000.0, 101752.1)  bore=50  ← branch goes Down (dz=-215.9)
```

**Rules derived:**

```
R-PTE-21: OLET has EP1 = EP2 = CP (all identical coordinate). 
          It is a ZERO-LENGTH element on the header axis.
          
R-PTE-22: OLET BP is the ONLY distinct point. It defines the branch direction.
          BRLEN = dist(CP, BP). All 3 examples show BRLEN = 215.9mm.
          
R-PTE-23: OLET does NOT break the header pipe chain. The header pipe 
          passes THROUGH the olet location. Implicit pipes are created 
          on BOTH sides:
          
          Before: [prev component EP2] → [OLET CP] = implicit pipe
          After:  [OLET CP] → [next component EP1] = implicit pipe
          
          Example (OLET /1558):
            Before: FLAN EP2 (103527) → OLET (103677) = 150mm Up
            After:  OLET (103677) → ELBO EP1 (103827) = 150mm Up
            
R-PTE-24: OLET branches (50mm bore) do NOT generate continuation chains.
          No BRAN Pt=1 exists for olet branches — they are stub connections
          (instrument taps, drain/vent connections).

R-PTE-25: In PCF output, OLET uses ONLY CP and BP (no END-POINTs):
          OLET
              CENTRE-POINT  96400.0000 16586.4000 103677.0000 350.0000
              BRANCH1-POINT 96400.0000 16370.5000 103677.0000 50.0000
```

---

## FINDING 4: PPoint Inversion — Mating Flange Orientation

When `Point ≠ PPoint`, the component is the **mating/downstream flange** in a bolted joint pair.

### Pattern:

```
Normal orientation:      Pt=1,PPt=1 → Pt=2,PPt=2  (head first, tail last)
Inverted orientation:    Pt=1,PPt=2 → Pt=2,PPt=1  (written reversed)
```

### All inverted components in the data:

```
Seq=11,12  FLAN /1668  (Pt=1,PPt=2 / Pt=2,PPt=1) — mating flange after TEE
Seq=19,20  FLAN /1154  (inverted) — first flange on branch after BRAN
Seq=23,24  VALV /1152  (inverted) — valve is inverted relative to flow direction  
Seq=36,37  FLAN /1540  (inverted) — flange after elbow
Seq=70,71  FLAN /1570  (inverted) — flange after olet
Seq=77,78  FLAN /1580  (inverted) — flange after long pipe run
Seq=84,85  FLAN /1567  (inverted) — flange after support
Seq=110,111 FLAN /4059 (inverted) — terminal flange
```

### What PPoint means:

```
Pt=1, PPt=2: "My entry face (Point 1) connects to the EXIT (Point 2) of another component"
Pt=2, PPt=1: "My exit face (Point 2) connects to the ENTRY (Point 1) of another component"
```

This is **connection topology metadata**. It tells you WHICH face of the adjacent component this face connects to.

### Rule:

```
R-PTE-26: PPoint indicates the connection target point on the adjacent component.
          Pt=PPt → normal orientation (entry-to-entry, exit-to-exit topology).
          Pt≠PPt → inverted orientation (this is the mating side of a joint).
          
R-PTE-27: For element conversion, PPoint inversion does NOT affect coordinates.
          EP1 is still the first listed point and EP2 is the second, regardless
          of Pt/PPt values. The inversion only indicates design intent/flow direction.

R-PTE-28: PPoint can be used to VALIDATE connections:
          If component A has exit Pt=2,PPt=2 and component B has entry Pt=1,PPt=1:
            → B.EP1 should ≈ A.EP2 (direct connection)
          If component A has exit Pt=2,PPt=2 and component B has entry Pt=1,PPt=2:
            → B is a mating flange. Still connected but inverted orientation noted.
```

---

## FINDING 5: PCOM Type — Piping Component (Short Spool/Pup Piece)

Rows 40–41: Type=PCOM, RefNo=/1538

```
Pt=1: (95721, 16586.4, 104360)  bore=350
Pt=2: (95686, 16586.4, 104360)  bore=350
Length: 95721 - 95686 = 35mm (West along X-axis)
```

**Context:** This sits between two gaskets in a flanged joint area (between gasket/flange pairs). It's a short **piping component** — likely a pup piece, spacer spool, or expansion bellows.

```
R-PTE-29: PCOM (Piping Component) maps to PIPE in PCF output.
          It is a short spool piece or pup piece.
          Treat identically to explicit PIPE: EP1→EP2, inherits bore/material.
          
          Add to type mapping config:
          PCOM → PIPE
```

---

## FINDING 6: Gasket Lengths Vary — Not Always < 6mm

| RefNo | Length | Action |
|-------|--------|--------|
| /1665 | 3.0mm | Skip (< 6mm) |
| /1669 | 3.0mm | Skip |
| /1153 | 3.0mm | Skip |
| /1155 | 3.0mm | Skip |
| /1539 | 3.0mm | Skip |
| /1541 | 3.0mm | Skip |
| /1571 | 3.0mm | Skip |
| /1568 | 3.0mm | Skip |
| /1581 | 7.8mm | **Keep as short PIPE** (> 6mm) |
| /4058 | 3.0mm | Skip |

```
R-PTE-30: Gasket /1581 is 7.8mm — exceeds the 6mm micro-element threshold.
          This is a thicker gasket (likely ring-type joint or insulating gasket).
          Convert to a short PIPE element. Do NOT silently skip.
          
          The 6mm threshold in R-PTE-07 correctly handles this:
          gaskets < 6mm → skip, gaskets ≥ 6mm → convert to PIPE.
```

---

## FINDING 7: NodeNo as Connection Identifier

NodeNo is the **stress analysis node number**, sparse-numbered (10, 20, 30, 40...). It serves as the connection key between chains:

```
TEE CP at Seq=9 has NodeNo=40
Branch BRAN at Seq=18 has NodeNo=40  ← SAME! This is how branches link.

Chain 2 END at Seq=44 has NodeNo=120
Chain 3 START at Seq=45 has NodeNo=120  ← SAME! This is how chains continue.
```

```
R-PTE-31: NodeNo is the universal connection identifier.
          When building the connectivity graph:
          1. Index all points by NodeNo.
          2. Points with same NodeNo are at the same physical location.
          3. Use NodeNo matching (not just coordinate proximity) 
             to link chains to TEE branches.
             
R-PTE-32: For SUPPORT/ANCI, NodeNo also maps to the GUID:
          <SUPPORT_GUID> = "UCI:" + NodeName
          where NodeName comes from the NodeName column (e.g., PS00178.1).
          NodeNo is the numeric ID; NodeName is the string identifier.
```

---

## FINDING 8: Implicit Pipe Lengths — Complete Accounting

Walking Chain 1 (main header /1664):

```
Seq  Type   Coord(Y)     Gap from prev    What it is
1    BRAN   17989.4      —                Chain start (origin)
2-3  GASK   17989.4→17986.4  3mm          Gasket (SKIP, <6mm)
4-5  FLAN   17986.4→17840.4  0mm          Flange (146mm, direct)
6    ANCI   17186.4      654mm            IMPLICIT PIPE (654mm South)
                                          + SUPPORT at 17186.4
7-10 TEE    16891.4→16281.4  295mm        IMPLICIT PIPE (295mm South)
                                          + TEE (610mm header body)
11-12 FLAN  15781.4→15635.4  500mm        IMPLICIT PIPE (500mm South)
                                          + FLANGE (146mm, but inverted Pt/PPt)
13-14 GASK  15635.4→15632.4  0mm          Gasket (SKIP, 3mm)
15-16 FLAN  15632.4→15486.4  0mm          Flange (146mm, direct)
17   BRAN   15486.4      0mm              Chain end
```

**Total header run:** 17989.4 − 15486.4 = **2503mm South**

Breakdown:
- Gasket (skipped): 3mm
- Flange /1666: 146mm
- **Implicit pipe**: 654mm
- Support (point): 0mm
- **Implicit pipe**: 295mm
- TEE /1667 header: 610mm
- **Implicit pipe**: 500mm
- Flange /1668: 146mm (inverted)
- Gasket (skipped): 3mm
- Flange /1670: 146mm
- Total: 3 + 146 + 654 + 295 + 610 + 500 + 146 + 3 + 146 = **2503mm ✓**

---

## FINDING 9: Updated Type Mapping

From the actual data, these types appear:

| Input Type | Occurrences | PCF Mapping | Notes |
|-----------|------------|-------------|-------|
| BRAN | 6 | *(skip — chain delimiter)* | Always Point=1 (start) or Point=2 (end) |
| GASK | 20 | *(skip if < 6mm, else PIPE)* | All are 3mm except one at 7.8mm |
| FLAN | 32 | FLANGE | Some inverted (Pt≠PPt) |
| ANCI | 10 | SUPPORT | Point=0 always, has NodeName for GUID |
| TEE | 8 | TEE | 4 points per TEE (2 TEEs in data) |
| OLET | 12 | OLET | EP1=EP2=CP, only BP distinct (3 OLETs) |
| ELBO | 18 | BEND | 3 points per ELBO (6 elbows in data) |
| VALV | 2 | VALVE | Inverted Pt/PPt |
| PCOM | 2 | PIPE | Short spool piece (35mm) |

---

## FINDING 10: Corrected Conversion Algorithm for TEE Branches

The Phase 2 algorithm in PTE-001 §3.2 section D.1 needs this correction for branch handling:

```
// ── D.1 CORRECTED: IMPLICIT PIPE before component (with TEE branch awareness) ──

IF prev_exit_point AND component_ep1:
  gap = distance(prev_exit_point, component_ep1)
  
  // Check: is prev_exit_point a TEE CP? (i.e., are we starting a branch?)
  IF current_chain_started_at_tee_cp:
    // The gap includes the TEE branch body (BRLEN)
    // Subtract BRLEN to get the true pipe length
    parent_tee = find_parent_tee_by_NodeNo(chain_start_nodeNo)
    tee_brlen = parent_tee.brlen  // distance(CP, BP)
    tee_bp = parent_tee.bp_coord
    
    true_pipe_gap = gap - tee_brlen
    
    IF true_pipe_gap > 6mm:
      // Create pipe from TEE BP to this component's EP1
      elements.append(create_implicit_pipe(
        ep1 = tee_bp,           // Start at BP, NOT at CP
        ep2 = component_ep1,
        bore = prev_exit_bore,
        source = "Implicit pipe after TEE branch (adjusted for BRLEN)"
      ))
      Log: "[Calculated] Branch pipe: {true_pipe_gap:.1f}mm 
             (raw gap {gap:.1f}mm minus BRLEN {tee_brlen:.1f}mm)"
    ELIF true_pipe_gap > 0.1mm AND true_pipe_gap <= 6mm:
      Log: "[Info] Micro-gap {true_pipe_gap:.1f}mm after TEE branch — snapped"
    ELIF true_pipe_gap <= 0.1mm:
      Log: "[Info] Component directly at TEE BP — no pipe needed"
    ELSE:
      // true_pipe_gap is negative → component EP1 is INSIDE the tee body
      Log: "[Warning] Component EP1 overlaps TEE body by {abs(true_pipe_gap):.1f}mm"
    
    current_chain_started_at_tee_cp = false  // Reset flag
  
  ELSE:
    // Normal case — no TEE branch adjustment needed
    IF gap > 6mm:
      elements.append(create_implicit_pipe(
        ep1 = prev_exit_point,
        ep2 = component_ep1,
        bore = prev_exit_bore,
        source = "Implicit pipe"
      ))
```

---

## SUMMARY OF ALL NEW RULES

| Rule | Description |
|------|-------------|
| R-PTE-16 | BRAN Pt=1/Pt=2 with same RefNo define chain boundaries |
| R-PTE-17 | Branch BRAN NodeNo matches parent TEE CP NodeNo — this is the branch link |
| R-PTE-18 | Sequential chains share endpoint/startpoint coordinates |
| R-PTE-19 | BRAN is never a physical component (pure delimiter) |
| R-PTE-20 | Branch BRAN starts at TEE CP. Subtract BRLEN from gap to get true pipe length. Pipe starts at BP. |
| R-PTE-21 | OLET has EP1=EP2=CP (all identical). Zero-length on header. |
| R-PTE-22 | OLET BP is the only distinct point. Defines branch direction. |
| R-PTE-23 | OLET does not break header pipe. Implicit pipes on both sides. |
| R-PTE-24 | OLET branches (small bore) have no continuation chain (stub connections). |
| R-PTE-25 | PCF OLET output uses only CP and BP (no END-POINTs). |
| R-PTE-26 | PPoint indicates connection target on adjacent component (topology metadata). |
| R-PTE-27 | PPoint inversion does not affect coordinate assignment (EP1=first, EP2=second). |
| R-PTE-28 | PPoint can validate connections (matching Pt/PPt between adjacent components). |
| R-PTE-29 | PCOM maps to PIPE (short spool piece / pup piece). |
| R-PTE-30 | Gaskets ≥ 6mm are kept as short PIPE (thick gaskets exist). |
| R-PTE-31 | NodeNo is the universal connection identifier across chains and TEE branches. |
| R-PTE-32 | For SUPPORT: GUID = "UCI:" + NodeName, not NodeNo. |

---

*End of Findings — PCF-PTE-001 Addendum*
