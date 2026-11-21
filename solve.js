function fitWidth(fields, width, errors, line, row) {
  if (fields.length < width) {
    errors.push({ code: 'short_row', line, row, fields: fields.length });
    while (fields.length < width) fields.push('');
  } else {
    const extra = fields.slice(width);
    fields.length = width;
    errors.push({ code: 'long_row', line, row, extra });
  }
}

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  // Without quotes or stray CRs, native splits preserve field and record boundaries.
  return /"|\r(?!\n)/.test(text) ? readGeneral(text, start, header) : readPlain(text, start, header);
}

function readPlain(text, start, header) {
  let row = 0;
  const errors = [];
  let columns = null;
  let width = -1;
  const rows = text.slice(start).split('\n');
  for (let i = 0; i < rows.length; i++) {
    let record = rows[i];
    if (record.endsWith('\r')) record = record.slice(0, -1);
    if (record === '') continue;
    const fields = record.split(',');
    if (width < 0) {
      width = fields.length;
      if (header) {
        columns = fields;
        continue;
      }
    }
    if (fields.length !== width) fitWidth(fields, width, errors, i + 1, row);
    rows[row++] = fields;
  }
  rows.length = row;
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

function readGeneral(text, start, header) {
  const rows = [];
  const errors = [];
  let columns = null;
  let width = -1;
  const length = text.length;
  const separators = /[,\r\n]/g;
  let pos = start;
  let line = 1;

  while (pos < length) {
    // Skip physically empty records before allocating fields.
    const first = text[pos];
    if (first === '\n' || (first === '\r' && text[pos + 1] === '\n')) {
      pos += first === '\n' ? 1 : 2;
      line++;
      continue;
    }

    const recordLine = line;
    const row = header && columns === null ? null : rows.length;
    const fields = [];
    let separator;
    let quoted;
    do {
      quoted = text[pos] === '"';
      let value = '';
      let closed = false;
      if (quoted) {
        const open = pos++;
        const openLine = line;
        let chunk = pos;
        // Scan code units without creating one-character strings for quoted text.
        while (pos < length) {
          const code = text.charCodeAt(pos++);
          if (code === 34) { // double quote
            value += text.slice(chunk, pos - 1);
            if (text.charCodeAt(pos) !== 34) {
              closed = true;
              break;
            }
            value += '"';
            chunk = ++pos;
          } else if (code === 13) { // CR or CRLF
            value += text.slice(chunk, pos - 1) + '\n';
            if (text.charCodeAt(pos) === 10) pos++;
            chunk = pos;
            line++;
          } else if (code === 10) { // LF
            line++;
          }
        }
        if (!closed) {
          // Replay from the opening quote so speculative line counts do not leak.
          errors.push({ code: 'unterminated_quote', line: recordLine, row });
          pos = open + 1;
          line = openLine;
          value = '"';
        }
      }

      const initialLength = value.length;
      for (;;) {
        const from = pos;
        separator = text[pos];
        if (separator !== ',' && separator !== '\n' && separator !== '\r' && pos < length) {
          separators.lastIndex = pos + 1;
          pos = separators.test(text) ? separators.lastIndex - 1 : length;
          separator = text[pos];
        }
        if (pos !== from) value += text.slice(from, pos);
        if (separator === '\r' && text[pos + 1] !== '\n') {
          errors.push({ code: 'stray_cr', line: recordLine, row });
          pos++;
          continue;
        }
        break;
      }
      if (closed && value.length !== initialLength) {
        errors.push({ code: 'quote_junk', line: recordLine, row });
      }
      if (separator !== undefined) {
        pos += separator === '\r' ? 2 : 1;
        if (separator !== ',') line++;
      }
      fields.push(value);
    } while (separator === ',');

    // A record made only of stray CRs has errors but contributes no row.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    if (width < 0) width = fields.length;
    if (row === null) {
      columns = fields;
      continue;
    }
    if (fields.length !== width) fitWidth(fields, width, errors, recordLine, row);
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
