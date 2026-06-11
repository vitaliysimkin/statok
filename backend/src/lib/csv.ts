/**
 * csv.ts — minimal RFC 4180 CSV builder with UTF-8 BOM (ST-031, FR-49/FR-50).
 *
 * Rules:
 *  - UTF-8 BOM (0xEF 0xBB 0xBF) prepended so Excel opens the file correctly.
 *  - Fields containing comma, double-quote or line-break are enclosed in
 *    double-quotes; inner double-quotes are escaped as "".
 *  - null / undefined → empty field.
 *  - Numbers emitted as plain numeric strings (no locale formatting).
 */

const BOM = '﻿'

function escapeField(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  // RFC 4180: if field contains DQUOTE, COMMA or CRLF/LF, enclose in DQUOTE.
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replaceAll('"', '""') + '"'
  }
  return s
}

/** Build a CSV string (UTF-8 BOM + header row + data rows). */
export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines: string[] = [BOM + headers.map(escapeField).join(',')]
  for (const row of rows) {
    lines.push(row.map(escapeField).join(','))
  }
  return lines.join('\r\n')
}
