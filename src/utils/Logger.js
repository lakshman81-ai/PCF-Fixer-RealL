export const createLogger = () => {
  const log = [];

  const push = (entry) => {
    // entry: { type: "Fix"|"Error"|"Warning"|"Applied"|"Info", ruleId?: string, tier?: number, row?: number, message: string, stage?: 'IMPORT' | 'TRANSLATION' | 'VALIDATION' | 'FIXING' | 'EXPORT' }
    const logEntry = {
      timestamp: new Date().toISOString(),
      stage: entry.stage || 'UNKNOWN',
      ...entry,
    };
    log.push(logEntry);
    const rowStr = logEntry.row && logEntry.row !== "-" ? ` Row ${logEntry.row}:` : "";
    console.log(`[${logEntry.stage}][${logEntry.type}]${logEntry.ruleId ? ` [${logEntry.ruleId}]` : ''}${rowStr} ${logEntry.message}`);
  };

  const getLog = () => log;
  const clearLog = () => { log.length = 0; };

  return { push, getLog, clearLog };
};
