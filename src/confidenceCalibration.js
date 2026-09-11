/**
 * confidenceCalibration.js
 * A tiny persistent ledger of "for this error class, how often has a
 * test-passing fix later needed a human revert?" Used to decide whether
 * a passing fix should auto-merge or wait for human approval.
 *
 * Storage is a flat JSON file for simplicity — swap for a real DB in prod.
 */

const fs = require('fs');
const path = require('path');

const LEDGER_PATH = path.join(__dirname, '..', 'workspace', 'calibration-ledger.json');

function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveLedger(ledger) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2), 'utf8');
}

/**
 * @param {string} errorClass - e.g. "null-or-undefined-ref"
 * @returns {number} reliability score in [0,1]; defaults to 0.5 (neutral) for unseen classes
 */
function getReliability(errorClass) {
  const ledger = loadLedger();
  const entry = ledger[errorClass];
  if (!entry || entry.totalMerged === 0) return 0.5;
  return entry.heldUp / entry.totalMerged;
}

/**
 * Records the outcome of a merged fix so future confidence scores improve.
 * @param {string} errorClass
 * @param {boolean} heldUp - true if the fix was never reverted/complained about
 */
function recordOutcome(errorClass, heldUp) {
  const ledger = loadLedger();
  if (!ledger[errorClass]) ledger[errorClass] = { totalMerged: 0, heldUp: 0 };
  ledger[errorClass].totalMerged += 1;
  if (heldUp) ledger[errorClass].heldUp += 1;
  saveLedger(ledger);
}

/**
 * Seeds the ledger with plausible historical data so a demo doesn't start
 * from a cold, uninteresting 0.5 for every class. Safe to call once at
 * startup; no-ops if the ledger already has data for a class.
 */
function seedDemoData() {
  const ledger = loadLedger();
  const seed = {
    'null-or-undefined-ref': { totalMerged: 40, heldUp: 37 }, // ~92%
    'missing-env-var': { totalMerged: 22, heldUp: 21 }, // ~95%
    'type-mismatch': { totalMerged: 18, heldUp: 12 }, // ~67%
  };
  for (const [k, v] of Object.entries(seed)) {
    if (!ledger[k]) ledger[k] = v;
  }
  saveLedger(ledger);
}

function decideMergeAction(errorClass, threshold = parseFloat(process.env.AUTO_MERGE_CONFIDENCE_THRESHOLD || '0.85')) {
  const reliability = getReliability(errorClass);
  return {
    reliability,
    threshold,
    action: reliability >= threshold ? 'auto-merge' : 'hold-for-human-approval',
  };
}

module.exports = { getReliability, recordOutcome, seedDemoData, decideMergeAction };
