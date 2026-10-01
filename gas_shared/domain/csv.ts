// One CSV cell — the encoding every register's export goes through.
//
// WHY A CSV NEEDS DEFENDING AT ALL. An export is opened in Excel, Sheets or LibreOffice, and
// all three read a cell that begins with `=`, `+`, `-` or `@` as a FORMULA, not as text. The
// values exported here are not ours: titles, package names, file paths and repository names
// arrive from Wiz, i.e. from whatever a scanned repository or image contains, and the ledger
// is a Google Sheet an operator can type into. A finding titled `=HYPERLINK("https://…","x")`
// becomes a live link — or a data-exfiltrating formula — in the auditor's spreadsheet the
// moment they open the export. (CWE-1236, "CSV injection".)
//
// THE DEFENCE is OWASP's: prefix such a cell with `'`, so its first character is no longer
// one a spreadsheet evaluates. Tab and carriage return are in OWASP's set as well as the four
// formula characters.
//
// A NUMBER IS NEVER PREFIXED; a string (or anything else) is. `-2` as a number is a value a spreadsheet
// should treat as a number (a delta, a negative day count); `"-2"` as a string came from
// somewhere text comes from, and text is exactly what this guards. So the test is on the
// JS type, never on whether the characters happen to look numeric.
//
// Quoting is unchanged: a cell holding `"`, `,`, CR or LF is wrapped in double quotes with
// inner quotes doubled (RFC 4180). null and undefined are an empty cell.

const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v !== "number" && FORMULA_LEAD.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
