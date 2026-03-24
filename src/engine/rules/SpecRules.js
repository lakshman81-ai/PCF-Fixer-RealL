// @ts-check
/** @typedef {import('../types.js').PcfComponent} PcfComponent */
/** @typedef {import('../types.js').WalkContext} WalkContext */
/** @typedef {import('../types.js').Config} Config */
/** @typedef {import('../types.js').Logger} Logger */

/**
 * SpecRules.js
 *
 * Material & Spec validation rules.
 * Cross-references each component's SKEY against the configurable piping
 * spec database (config.specDatabase).  If the database is empty or
 * disabled, all rules are skipped silently.
 *
 * Spec database shape (config.specDatabase):
 * {
 *   "<SKEY>": {
 *     type:        string   — expected component type, e.g. "FLANGE"
 *     bore:        number   — expected nominal bore in mm
 *     description: string   — human-readable label (informational only)
 *     material:    string?  — optional material/grade string
 *   },
 *   ...
 * }
 *
 * Rules provided:
 *  SPEC-01  SKEY not in spec database
 *  SPEC-02  Component type does not match spec entry
 *  SPEC-03  Component bore does not match spec entry
 *  SPEC-04  Component material (CA3) does not match spec entry
 */

const BORE_TOLERANCE_PCT = 0.05; // 5 % tolerance for bore mismatch

/**
 * @param {PcfComponent} element
 * @param {WalkContext} context
 * @param {PcfComponent|null} prevElement
 * @param {string|null} elemAxis
 * @param {number|null} elemDir
 * @param {Config} config
 * @param {Logger} log
 */
export function runSpecRules(element, context, prevElement, elemAxis, elemDir, config, log) {
  const db = config?.specDatabase;
  if (!db || typeof db !== 'object' || Object.keys(db).length === 0) return;
  if (config?.specValidationEnabled === false) return;

  const ri = element._rowIndex;
  const type = (element.type || '').toUpperCase();

  // Skip component types that never carry a physical SKEY
  if (['SUPPORT', 'INSTRUMENT'].includes(type)) return;

  const skey = (element.skey || '').trim();

  // SPEC-01: SKEY missing from spec database
  if (!skey) return; // V14 already handles missing SKEY
  if (!Object.prototype.hasOwnProperty.call(db, skey)) {
    log.push({
      stage: 'VALIDATION',
      type: 'Warning',
      ruleId: 'SPEC-01',
      tier: 3,
      row: ri,
      message: `WARNING [SPEC-01]: SKEY '${skey}' on row ${ri} (${type}) is not in the piping spec database.`,
    });
    return; // No point checking bore/type if SKEY is unknown
  }

  const entry = db[skey];

  // SPEC-02: Component type mismatch
  if (entry.type && entry.type.toUpperCase() !== type) {
    log.push({
      stage: 'VALIDATION',
      type: 'Warning',
      ruleId: 'SPEC-02',
      tier: 3,
      row: ri,
      message: `WARNING [SPEC-02]: SKEY '${skey}' expects type ${entry.type.toUpperCase()} but component is ${type}.`,
    });
  }

  // SPEC-03: Bore mismatch
  if (entry.bore != null && element.bore != null) {
    const diff = Math.abs(Number(element.bore) - Number(entry.bore));
    const rel = Number(entry.bore) > 0 ? diff / Number(entry.bore) : diff;
    if (rel > BORE_TOLERANCE_PCT) {
      log.push({
        stage: 'VALIDATION',
        type: 'Warning',
        ruleId: 'SPEC-03',
        tier: 3,
        row: ri,
        message: `WARNING [SPEC-03]: SKEY '${skey}' spec bore is ${entry.bore}mm but component bore is ${element.bore}mm.`,
      });
    }
  }

  // SPEC-04: Material mismatch (element.ca?.[3] holds the material string)
  if (entry.material) {
    const elemMat = (element.ca?.[3] || '').trim().toUpperCase();
    const specMat = entry.material.trim().toUpperCase();
    if (elemMat && elemMat !== specMat) {
      log.push({
        stage: 'VALIDATION',
        type: 'Warning',
        ruleId: 'SPEC-04',
        tier: 3,
        row: ri,
        message: `WARNING [SPEC-04]: SKEY '${skey}' spec material is '${entry.material}' but component has '${element.ca?.[3]}'.`,
      });
    }
  }
}
