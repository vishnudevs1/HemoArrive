// Request record as a PDF: summary, patients, hospitals, delivery reports, re-route decisions, timeline.
// Built in the browser with jsPDF. No patient identity exists in HemoArrive, so none is printed.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { COMPONENTS, tempInRange } from '../core/blood';
import { conditionOf } from '../core/conditions';
import { describeLine, minutes, type Engine } from '../core/engine';
import type { Part } from '../core/types';
import { downloadBlob } from './download';

const RED: [number, number, number] = [198, 40, 40];
const MUTED: [number, number, number] = [95, 101, 112];

/** Standard PDF fonts only cover Latin-1, so swap symbols they can't draw. */
const clean = (s: string) =>
  s
    .replace(/→/g, '->')
    .replace(/[—–]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/−/g, '-')
    .replace(/≤/g, '<=')
    .replace(/[^\x00-\xFF]/g, '')
    .trim();

const when = (ms?: number) =>
  ms == null
    ? '-'
    : new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const time = (ms?: number) => (ms == null ? '-' : new Date(ms).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }));

const PART_STATUS: Record<Part['status'], string> = {
  awaiting_approval: 'Waiting for approval',
  approved: 'Approved',
  in_transit: 'On the way',
  arrived: 'Arrived',
  received: 'Received, report pending',
  reported: 'Delivered and reported',
  declined: 'Declined',
  timed_out: 'No answer in 5 min',
  conflict: 'Stock taken by another hospital',
  cancelled: 'Withdrawn',
};

const REQUEST_STATUS: Record<string, string> = {
  searching: 'Searching',
  planning: 'Planning',
  in_progress: 'In progress',
  closed: 'Closed',
  no_match: 'No blood found',
  cancelled: 'Cancelled',
};

export function buildRecordPdf(e: Engine): jsPDF {
  const s = e.state;
  const req = s.request!;
  const receiver = e.org(req.requesterOrgId);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = M;

  // ---------- header ----------
  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...RED).text('HemoArrive', M, y + 6);
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(30, 30, 30).text('Blood request record', M + 110, y + 6);
  doc.setFontSize(9).setTextColor(...MUTED).text(clean(`${req.id} - generated ${when(s.now)} IST`), W - M, y + 6, { align: 'right' });
  y += 18;
  doc.setDrawColor(...RED).setLineWidth(1.2).line(M, y, W - M, y);
  y += 14;
  const disclaimer = doc
    .setFontSize(8.5)
    .splitTextToSize(
      'Simulated data. Coordination record, not a patient record: HemoArrive stores no patient names or IDs. Clinical decisions remain with the treating team.',
      W - 2 * M,
    ) as string[];
  doc.setTextColor(...MUTED).text(disclaimer, M, y);
  y += disclaimer.length * 11 + 14;

  const section = (title: string) => {
    if (y > doc.internal.pageSize.getHeight() - 90) {
      doc.addPage();
      y = M;
    }
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(30, 30, 30).text(title, M, y);
    y += 6;
  };
  const table = (head: string[], body: (string | number)[][], opts: Partial<Parameters<typeof autoTable>[1]> = {}) => {
    autoTable(doc, {
      startY: y,
      head: [head],
      body: body.map((r) => r.map((c) => clean(String(c)))),
      margin: { left: M, right: M },
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 4, textColor: [30, 30, 30], lineColor: [227, 230, 234], overflow: 'linebreak' },
      headStyles: { fillColor: RED, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 248, 250] },
      ...opts,
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
  };

  // ---------- summary ----------
  const done = req.parts.filter((p) => p.status === 'reported');
  const needed = req.lines.reduce((a, l) => a + l.units, 0);
  const got = req.lines.reduce((a, l) => a + Math.min(e.committed(l.id), l.units), 0);
  section('Summary');
  table(
    ['Item', 'Detail'],
    [
      ['Requesting hospital', `${receiver.name}, ${receiver.area}`],
      ['Status', REQUEST_STATUS[req.status] ?? req.status],
      ['Urgency', req.urgency],
      ['Raised', when(req.createdAt)],
      ['Closed', when(req.closedAt)],
      ['Total time', req.closedAt ? `${minutes((req.closedAt - req.createdAt) / 1000)} min` : '-'],
      ['Units', `${got} of ${needed} received`],
      ['Search area', `${req.radiusKm} km - ${req.broadcasts.length} verified hospitals alerted`],
      ['Hospitals that supplied', done.length ? [...new Set(done.map((p) => e.org(p.supplierOrgId).name))].join(', ') : 'none'],
    ],
    { columnStyles: { 0: { cellWidth: 140, fontStyle: 'bold' } } },
  );

  // ---------- patients ----------
  section('Patients (no identity stored)');
  table(
    ['#', 'Need', 'Blood needed for', 'ICD-10', 'Needed', 'Received', 'Result'],
    req.lines.map((l, i) => {
      const received = req.parts
        .filter((p) => p.status === 'reported')
        .reduce((a, p) => a + p.items.filter((it) => it.lineId === l.id).reduce((x, it) => x + it.units, 0), 0);
      return [
        i + 1,
        `${l.group} ${COMPONENTS[l.component].label}`,
        conditionOf(l.reason).label,
        conditionOf(l.reason).icd,
        l.units,
        received,
        received >= l.units ? 'All received' : received > 0 ? `${l.units - received} short` : 'Not received',
      ];
    }),
  );

  // ---------- hospitals ----------
  if (req.parts.length) {
    section('Hospitals and deliveries');
    table(
      ['Hospital', 'Units carried', 'Status', 'Sent', 'Approved', 'Arrived', 'Driver(s)', 'Distance'],
      req.parts.map((p) => {
        // every leg of this share: the original trip, plus a hand-off or re-supply leg after a re-route
        const legs = s.deliveries.filter((d) => d.partId === p.id);
        const leg = (d: (typeof legs)[number]) =>
          `${d.driver.name} (${d.driver.phone})${d.kind === 'handoff' ? ' - hand-off' : d.kind === 'fresh' ? ' - re-supply' : ''}${d.status === 'cancelled' || d.status === 'handed_off' ? ' - stopped' : ''}`;
        return [
          e.org(p.supplierOrgId).name,
          p.items.map((it) => describeLine({ ...e.line(it.lineId), group: e.offer(it.offerId)!.group, units: it.units })).join(', '),
          PART_STATUS[p.status],
          time(p.sentAt),
          time(p.approvedAt),
          time(p.arrivedAt),
          legs.length ? legs.map(leg).join('\n') : '-',
          legs.length ? `${(legs.reduce((a, d) => a + d.travelledM, 0) / 1000).toFixed(1)} km driven` : '-',
        ];
      }),
    );
  }

  // ---------- delivery reports ----------
  const reports = req.parts.filter((p) => p.report);
  if (reports.length) {
    section('Delivery reports');
    table(
      ['From', 'Received by', 'Units', 'Temp. on arrival', 'Bag numbers', 'Condition', 'Notes', 'Filed'],
      reports.map((p) => {
        const r = p.report!;
        const inRange = p.items.every((it) => tempInRange(e.line(it.lineId).component, r.tempOnArrival));
        return [
          e.org(p.supplierOrgId).name,
          r.receivedBy,
          `${r.unitsReceived} of ${p.units}`,
          `${r.tempOnArrival} °C ${inRange ? '(in range)' : '(OUT OF RANGE)'}`,
          r.bagNumbers,
          r.condition,
          r.notes || '-',
          time(r.filedAt),
        ];
      }),
      { columnStyles: { 4: { cellWidth: 90 } } },
    );
  }

  // ---------- re-route decisions ----------
  if (s.decisions.length) {
    section('Re-route decisions');
    table(
      ['Time', 'Trigger', 'Trip done', 'Rule', 'Options (ETA)', 'Chosen', 'Why'],
      s.decisions.map((d) => [
        time(d.at),
        d.trigger === 'breakdown' ? 'Vehicle breakdown' : 'Delay over 10 min',
        `${d.travelledPct}%`,
        `Case ${d.caseNo}`,
        d.options.map((o) => `${o.label}: ${o.etaMin != null ? `${o.etaMin} min` : 'n/a'}`).join('\n'),
        d.chosen === 'fresh' ? 'Fresh units' : d.chosen === 'handoff' ? 'Hand-off' : 'Keep going',
        d.explanation,
      ]),
      { columnStyles: { 4: { cellWidth: 120 }, 6: { cellWidth: 150 } } },
    );
  }

  // ---------- timeline ----------
  section('Timeline (audit trail)');
  table(
    ['Time', 'Who', 'What happened'],
    s.timeline.map((t) => [time(t.at), t.actor, t.text]),
    { columnStyles: { 0: { cellWidth: 45 }, 1: { cellWidth: 60 } } },
  );

  // ---------- footer on every page ----------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const H = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
    doc.text(clean(`HemoArrive MVP - ${req.id} - simulated data`), M, H - 20);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 20, { align: 'right' });
  }
  return doc;
}

export function downloadRecordPdf(e: Engine) {
  const req = e.state.request;
  if (!req) return;
  // not doc.save(): it clicks a detached link from a timer, which browsers can silently block
  downloadBlob(buildRecordPdf(e).output('blob'), `${req.id}-record.pdf`);
}
