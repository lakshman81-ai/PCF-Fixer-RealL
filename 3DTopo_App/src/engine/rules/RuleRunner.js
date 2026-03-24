import { runGeoRules } from './GeoRules.js';
import { runChnRules } from './ChnRules.js';
import { runBrnRules } from './BrnRules.js';
import { runDatRules } from './DatRules.js';
import { runSupportRules } from './SupportRules.js';
import { runAggRules } from './AggRules.js';

// If a row has been approved/acknowledged by the user for a specific fix,
// we should intercept the log to suppress re-throwing the same warning next pass.
function pushWithSuppression(log, element, entry) {
    if (element && element._fixApproved === true) {
        // If the user already approved the fixing action that was attached to this row,
        // do not log it again as a warning/error unless it's a completely different rule.
        // For simplicity, we suppress warnings/errors on fully approved rows in multi-pass.
        return;
    }
    // Skip checking rules for rows that already have a [1st Pass] fixing action
    if (element && element.fixingAction && element.fixingAction.includes('[1st Pass]')) {
        return;
    }

    // Add logic for 2nd Pass Text Generation
    if (entry && entry.pass === 2) {
        entry.message = entry.message.replace(/ERROR |WARNING /, '');
    }

    log.push(entry);
}

export function runElementRules(element, context, prevElement, elemAxis, elemDir, config, log) {
  const suppressedLog = { ...log, push: (entry) => pushWithSuppression(log, element, entry) };
  runGeoRules(element, context, prevElement, elemAxis, elemDir, config, suppressedLog);
  runChnRules(element, context, prevElement, elemAxis, elemDir, config, suppressedLog);
  runBrnRules(element, context, prevElement, elemAxis, elemDir, config, suppressedLog);
  runDatRules(element, context, prevElement, elemAxis, elemDir, config, suppressedLog);
}

export function runSupportRulesWithSuppression(element, chain, context, config, log) {
  const suppressedLog = { ...log, push: (entry) => pushWithSuppression(log, element, entry) };
  runSupportRules(element, chain, context, config, suppressedLog);
}

export function runAggRulesWithSuppression(chain, context, config, log) {
  const firstElement = chain[0]?.element;
  const suppressedLog = { ...log, push: (entry) => pushWithSuppression(log, firstElement, entry) };
  runAggRules(chain, context, config, suppressedLog);
}

export { runSupportRulesWithSuppression as runSupportRules, runAggRulesWithSuppression as runAggRules };