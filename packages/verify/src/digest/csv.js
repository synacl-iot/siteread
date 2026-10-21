// RFC 4180 CSV, enough for a Search Console export: quoted fields, "" escapes, CRLF or LF,
// a UTF-8 BOM. No dependencies.

/** Rows of a CSV text as arrays of strings. Blank lines are dropped. */
export function parseCsv(text) {
    const s = String(text ?? '').replace(/^﻿/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quoted) {
            if (c === '"') {
                if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
            } else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && s[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.some(f => f !== '')) rows.push(row);
            row = [];
        } else field += c;
    }
    row.push(field);
    if (row.some(f => f !== '')) rows.push(row);
    return rows;
}

/** The CSV as objects keyed by its header row. */
export function parseCsvObjects(text) {
    const [head, ...rows] = parseCsv(text);
    if (!head) return { header: [], rows: [] };
    const header = head.map(h => h.trim());
    return { header, rows: rows.map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}
