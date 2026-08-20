import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

type PdfKvRow = [string, string | number];

/** Download a simple titled key/value report as PDF. */
export function downloadKvPdf(opts: {
  filename: string;
  title: string;
  subtitle?: string;
  rows: PdfKvRow[];
}) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 48;
  let y = margin;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(opts.title, margin, y);
  y += 18;

  if (opts.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text(opts.subtitle, margin, y);
    doc.setTextColor(0);
    y += 16;
  }

  autoTable(doc, {
    startY: y,
    head: [['Field', 'Value']],
    body: opts.rows.map(([k, v]) => [k, String(v)]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [40, 55, 70], textColor: 255 },
    columnStyles: { 0: { cellWidth: 220 }, 1: { cellWidth: 280 } },
    margin: { left: margin, right: margin },
  });

  doc.save(opts.filename.endsWith('.pdf') ? opts.filename : `${opts.filename}.pdf`);
}

/** Download a tabular report as PDF. */
export function downloadTablePdf(opts: {
  filename: string;
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
}) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const margin = 36;
  let y = margin;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(opts.title, margin, y);
  y += 16;

  if (opts.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(opts.subtitle, margin, y);
    doc.setTextColor(0);
    y += 14;
  }

  autoTable(doc, {
    startY: y,
    head: [opts.headers],
    body: opts.rows.map((r) => r.map((c) => (c == null ? '' : String(c)))),
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [40, 55, 70], textColor: 255 },
    margin: { left: margin, right: margin },
  });

  doc.save(opts.filename.endsWith('.pdf') ? opts.filename : `${opts.filename}.pdf`);
}
