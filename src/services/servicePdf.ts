import type { ReportLine } from '../domain/serviceReport';

// PDF 1.4, polices standard Helvetica / WinAnsi : aucune bibliothèque ni requête réseau.
const specials: Record<string, number> = { '€': 128, 'Œ': 140, 'œ': 156, '’': 146, '–': 150, '—': 151, '…': 133, '•': 149 };
function pdfText(text: string) {
  return [...text.replace(/[\u00a0\u202f]/g, ' ')].map((c) => {
    const code = specials[c] ?? c.charCodeAt(0);
    if (c === '(' || c === ')' || c === '\\') return '\\' + c;
    if (code >= 32 && code <= 126) return c;
    return '\\' + (code <= 255 ? code : 63).toString(8).padStart(3, '0');
  }).join('');
}
function wrap(text: string, max: number) {
  const result: string[] = []; let line = '';
  for (const word of text.split(/\s+/)) {
    for (let i = 0; i < word.length; i += max) {
      const part = word.slice(i, i + max);
      if (line && line.length + part.length + 1 > max) { result.push(line); line = ''; }
      line += (line ? ' ' : '') + part;
    }
  }
  if (line) result.push(line);
  return result;
}

/** A4 multipage ; tableaux label/montant, retours à la ligne et pagination explicites. */
export function buildServicePdf(pizzeria: string, lines: ReportLine[]): Uint8Array {
  const pages: string[] = []; let commands = '', y = 730;
  const text = (value: string, x: number, yy: number, size = 10, bold = false) => {
    commands += `BT /${bold ? 'F2' : 'F1'} ${size} Tf 0.12 0.14 0.16 rg ${x} ${yy} Td (${pdfText(value)}) Tj ET\n`;
  };
  const start = () => {
    commands = '0.8 0.04 0.08 rg 40 780 515 4 re f\n'; y = 730;
    text(pizzeria.slice(0, 60), 40, 803, 13, true);
    text('Bilan du service', 40, 752, 22, true);
  };
  const end = () => {
    text('Chiffres indicatifs - ni caisse ni comptabilité certifiée', 40, 32, 9);
    text(`Page ${pages.length + 1}`, 505, 32, 9);
    pages.push(commands);
  };
  start();
  for (const [index, line] of lines.entries()) {
    const rows = wrap(line.text, line.heading ? 64 : line.right ? 64 : 90);
    const height = rows.length * (line.heading ? 18 : 15) + (line.heading ? 15 : 6);
    let required = height;
    // Un titre reste avec au moins sa première ligne, même lors d'une double section.
    if (line.heading) for (const next of lines.slice(index + 1, index + 4)) {
      required += next.heading ? 39 : 27;
      if (!next.heading) break;
    }
    if (y - required < 65) { end(); start(); }
    if (line.heading) { y -= 14; commands += `0.88 0.89 0.90 RG 40 ${y - 5} m 555 ${y - 5} l S\n`; }
    for (const [i, row] of rows.entries()) {
      text(row, 40, y, line.heading ? 12 : 10, !!line.heading);
      if (i === 0 && line.right) text(line.right, 466, y, 10, true);
      y -= line.heading ? 18 : 15;
    }
    y -= 6;
  }
  end();
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  const kids: string[] = [];
  for (const stream of pages) {
    const page = objects.length + 1, content = page + 1;
    kids.push(`${page} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  }
  objects[1] = `<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(' ')}] >>`;
  let result = '%PDF-1.4\n'; const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(result.length); result += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = result.length;
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const n of offsets.slice(1)) result += `${String(n).padStart(10, '0')} 00000 n \n`;
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(result);
}
