// renderer/src/utils/receiptOcr.js
//
// Best-effort field extraction from an uploaded bank receipt photo/scan,
// using Tesseract.js configured to run entirely offline (confirmed
// directly — no CDN calls, all model/worker/core files loaded from the
// local assets/tesseract/ folder bundled with the app).
//
// This is deliberately framed as SUGGESTIONS, not automatic filling.
// Bank slip formats vary by bank and photo quality varies a lot more —
// OCR text extraction itself is quite reliable on a clear image, but
// deciding "which number on this receipt is the amount vs. the account
// number vs. the reference" is inherently a best guess from heuristics,
// not a guarantee. The calling UI must let the person review/correct
// every suggested value before it's actually used.

const KNOWN_BANKS = [
  'First National Bank', 'FNB', 'Standard Bank', 'Bank Windhoek',
  'Nedbank', 'Capricorn', 'Letshego', 'Trustco'
];

let cachedWorker = null;

async function getWorker() {
  if (cachedWorker) return cachedWorker;
  const { createWorker } = await import('tesseract.js');
  cachedWorker = await createWorker('eng', 1, {
    // Relative to renderer/index.html (the document these paths resolve
    // against), not to this file or to dist/bundle.js — deliberately
    // never a CDN URL, so this keeps working with no internet connection,
    // matching the rest of this app's design.
    workerPath: 'assets/tesseract/worker.min.js',
    corePath: 'assets/tesseract/tesseract-core-lstm.wasm.js',
    langPath: 'assets/tesseract',
    gzip: true
  });
  return cachedWorker;
}

/** Runs OCR on an image (a data: URL or a File/Blob) and returns both the
 * raw recognized text and a best-effort parse of likely field values.
 * Every suggestion can be wrong — this is a starting point for a human
 * to check against the actual document, not a verified result. */
export async function extractReceiptFields(imageSource) {
  const worker = await getWorker();
  const { data: { text } } = await worker.recognize(imageSource);
  return { rawText: text, suggestions: parseReceiptText(text) };
}

export function parseReceiptText(text) {
  const suggestions = { amount: null, reference: null, date: null, bankName: null, senderAccountRef: null };

  // Amount — look for an explicit "Amount:" label first (most reliable),
  // fall back to the largest N$/R-prefixed number found anywhere.
  const amountLabelMatch = text.match(/amount[:\s]*[NR]?\$?\s*([\d,]+\.\d{2})/i);
  if (amountLabelMatch) {
    suggestions.amount = parseFloat(amountLabelMatch[1].replace(/,/g, ''));
  } else {
    const allAmounts = [...text.matchAll(/[NR]\$\s*([\d,]+\.\d{2})/g)].map((m) => parseFloat(m[1].replace(/,/g, '')));
    if (allAmounts.length > 0) suggestions.amount = Math.max(...allAmounts);
  }

  // Reference — an explicit "Reference:"/"Ref:" label, alphanumeric token
  // right after it (bank references are usually letters+digits, no
  // spaces within the token itself).
  const refMatch = text.match(/ref(?:erence)?[:\s]*([A-Za-z0-9\-\/]{4,})/i);
  if (refMatch) suggestions.reference = refMatch[1].trim();

  // Date — a handful of common formats; normalized to YYYY-MM-DD when
  // the parts are unambiguous, left as-found otherwise for a human to
  // interpret rather than silently guessing DD/MM vs MM/DD.
  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    suggestions.date = isoMatch[1];
  } else {
    const slashMatch = text.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\b/);
    if (slashMatch) suggestions.date = `${slashMatch[3]}-${slashMatch[2].padStart(2, '0')}-${slashMatch[1].padStart(2, '0')}`;
  }

  // Bank name — simple keyword match against known banks. "FNB" maps to
  // its full name for consistency in what gets stored.
  const foundBank = KNOWN_BANKS.find((b) => text.toLowerCase().includes(b.toLowerCase()));
  if (foundBank) suggestions.bankName = foundBank === 'FNB' ? 'First National Bank' : foundBank;

  // Sender account reference — deliberately only the last-4-ish pattern
  // (**** 1234 / xxxx1234), never a full account number even if one is
  // visible in the text. The point of this field is cross-checking, not
  // storing full banking details the school has no real need to hold.
  const acctMatch = text.match(/(?:\*{2,}|[xX]{2,})[\s\-]?(\d{3,4})\b/);
  if (acctMatch) suggestions.senderAccountRef = `****${acctMatch[1]}`;

  return suggestions;
}

export async function terminateOcrWorker() {
  if (cachedWorker) {
    await cachedWorker.terminate();
    cachedWorker = null;
  }
}
