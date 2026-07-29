import { useMemo, useState } from 'react';
import { DoughnutChart, RevenueChart } from '../components/Charts';
import { KpiRow } from '../components/KpiRow';
import { QAPanel } from '../components/QAPanel';
import { fmtUSD, palette } from '../lib/format';
import type { ArClient, DashboardData } from '../lib/types';

type BucketKey = '' | 'd0_30' | 'd31_60' | 'd61_90' | 'd91_plus';

const bucketMeta: Record<string, { label: string }> = {
  '': { label: 'All Buckets' },
  d0_30: { label: '0–30 Days' },
  d31_60: { label: '31–60 Days' },
  d61_90: { label: '61–90 Days' },
  d91_plus: { label: '91+ Days' },
};

function computeAgingAsOf(data: DashboardData, dateStr: string) {
  const D = new Date(dateStr + 'T00:00:00').getTime();
  const DAY = 86400000;
  const clientMap: Record<string, ArClient> = {};
  data.invoice_ledger.forEach((r) => {
    if (!r.d) return;
    const invTime = new Date(r.d + 'T00:00:00').getTime();
    if (invTime > D) return;
    let outstanding: number;
    if (r.p) {
      const payTime = new Date(r.p + 'T00:00:00').getTime();
      outstanding = payTime <= D ? r.b || 0 : r.n || 0;
    } else {
      outstanding = r.b || 0;
    }
    if (!outstanding || outstanding <= 0.005) return;
    const days = Math.floor((D - invTime) / DAY);
    const bucket: keyof ArClient =
      days <= 30 ? 'd0_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd91_plus';
    if (!clientMap[r.c]) {
      clientMap[r.c] = {
        client: r.c,
        d0_30: 0,
        d31_60: 0,
        d61_90: 0,
        d91_plus: 0,
        credit: 0,
        balance: 0,
      };
    }
    clientMap[r.c][bucket] += outstanding;
    clientMap[r.c].balance += outstanding;
  });
  const clients = Object.values(clientMap);
  const totals = { d0_30: 0, d31_60: 0, d61_90: 0, d91_plus: 0, credit: 0, balance: 0 };
  clients.forEach((c) => {
    totals.d0_30 += c.d0_30;
    totals.d31_60 += c.d31_60;
    totals.d61_90 += c.d61_90;
    totals.d91_plus += c.d91_plus;
    totals.balance += c.balance;
  });
  return { clients, totals };
}

export function FinancialAR({ data }: { data: DashboardData }) {
  const [arBucket, setArBucket] = useState<BucketKey>('');
  const [asOfDate, setAsOfDate] = useState('');
  const [arSearch, setArSearch] = useState('');

  const dateBounds = useMemo(() => {
    const dates = data.invoice_ledger.map((r) => r.d).filter(Boolean).sort() as string[];
    return { min: dates[0] || '', max: dates[dates.length - 1] || '' };
  }, [data.invoice_ledger]);

  const arData = useMemo(() => {
    if (!asOfDate) return { clients: data.ar_clients, totals: data.ar_totals, mode: 'live' as const };
    const computed = computeAgingAsOf(data, asOfDate);
    return { clients: computed.clients, totals: computed.totals, mode: 'asof' as const };
  }, [data, asOfDate]);

  const { clients, totals: at, mode } = arData;

  const overdueRows = useMemo(() => {
    let rows = clients.slice();
    if (arBucket) {
      rows = rows
        .filter((c) => (c[arBucket] || 0) > 0)
        .sort((a, b) => (b[arBucket] || 0) - (a[arBucket] || 0))
        .slice(0, 15);
    } else {
      rows = rows.sort((a, b) => b.balance - a.balance).slice(0, 15);
    }
    return rows;
  }, [clients, arBucket]);

  const allRows = useMemo(() => {
    const q = arSearch.toLowerCase();
    let rows = clients.filter((c) => c.client.toLowerCase().includes(q));
    if (arBucket) {
      rows = rows
        .filter((c) => (c[arBucket] || 0) > 0)
        .sort((a, b) => (b[arBucket] || 0) - (a[arBucket] || 0));
    } else {
      rows = rows.sort((a, b) => b.balance - a.balance);
    }
    return rows;
  }, [clients, arBucket, arSearch]);

  const rev = data.monthly_revenue.slice(-30);
  const bucketKeys: BucketKey[] = ['d0_30', 'd31_60', 'd61_90', 'd91_plus'];
  const baseColors = [palette.teal, palette.gold, '#A8783A', palette.rust];
  const colors = bucketKeys.map((b, i) => (!arBucket || arBucket === b ? baseColors[i] : '#E4E8EE'));
  const borderW = bucketKeys.map((b) => (arBucket && arBucket === b ? 3 : 2));

  const summary =
    arBucket &&
    `${clients.filter((c) => (c[arBucket] || 0) > 0).length} clients outstanding in ${bucketMeta[arBucket].label} — ${fmtUSD(at[arBucket])} total`;

  return (
    <section className="sheet active">
      <div className="filters">
        <span className="f-label">Aging Bucket</span>
        <div
          style={{
            display: 'flex',
            border: '1px solid var(--border)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          {(
            [
              ['', 'All'],
              ['d0_30', '0–30'],
              ['d31_60', '31–60'],
              ['d61_90', '61–90'],
              ['d91_plus', '91+'],
            ] as const
          ).map(([b, label]) => (
            <button
              key={b || 'all'}
              type="button"
              className={`gran-btn ${arBucket === b ? 'active' : ''}`}
              onClick={() => setArBucket(b)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="f-label" style={{ marginLeft: 10 }}>
          As Of Date
        </span>
        <input
          type="date"
          min={dateBounds.min}
          max={dateBounds.max}
          value={asOfDate}
          onChange={(e) => setAsOfDate(e.target.value)}
        />
        <button type="button" className="reset-btn" onClick={() => setAsOfDate('')}>
          TODAY (LIVE)
        </button>
        <span className="f-label" style={{ marginLeft: 6 }}>
          {summary || ''}
        </span>
      </div>

      {mode === 'asof' ? (
        <div
          style={{
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 10.5,
            color: 'var(--ink-soft)',
            background: 'var(--gold-soft)',
            border: '1px solid var(--border)',
            padding: '6px 12px',
            margin: '-8px 0 14px',
          }}
        >
          Showing aging estimated as of {asOfDate} — reconstructed from invoice and payment history,
          not the live snapshot. Retainer credit isn't reconstructable this way and shows N/A.
        </div>
      ) : null}

      <KpiRow
        items={[
          { k: '0–30 Days', v: fmtUSD(at.d0_30), active: arBucket === 'd0_30' },
          {
            k: '31–60 Days',
            v: fmtUSD(at.d31_60),
            cls: 'accent-gold',
            active: arBucket === 'd31_60',
          },
          {
            k: '61–90 Days',
            v: fmtUSD(at.d61_90),
            cls: 'accent-rust',
            active: arBucket === 'd61_90',
          },
          {
            k: '91+ Days',
            v: fmtUSD(at.d91_plus),
            cls: 'accent-rust',
            active: arBucket === 'd91_plus',
          },
          {
            k: 'Retainer Credit on File',
            v: mode === 'live' ? fmtUSD(at.credit) : 'N/A',
            cls: 'accent-teal',
          },
          { k: 'Total Balance Due', v: fmtUSD(at.balance) },
        ]}
      />

      <QAPanel
        sheet="s3"
        chips={[
          'What is the total outstanding balance?',
          'Which client owes the most?',
          'How much is 91+ days overdue?',
          'How many clients have an overdue balance?',
        ]}
        examples={[
          'What is the balance for [client name]?',
          'How much is in the 31-60 day bucket?',
          'Which client owes the most?',
        ]}
        filters={{
          aging_bucket_filter: arBucket || 'All buckets',
          as_of_date: asOfDate || 'Live current snapshot',
          data_mode: mode,
        }}
      />

      <div className="grid grid-2">
        <div className="panel">
          <h3>
            Billed vs Cash Collected <span className="tag">monthly, all clients</span>
          </h3>
          <div className="chart-wrap tall">
            <RevenueChart
              labels={rev.map((r) => r.month)}
              gross={rev.map((r) => r.gross_billed)}
              paid={rev.map((r) => r.amount_paid)}
            />
          </div>
        </div>
        <div className="panel">
          <h3>
            A/R Aging Buckets{' '}
            <span className="tag">{asOfDate ? `as of ${asOfDate}, estimated` : 'firm-wide'}</span>
          </h3>
          <div className="chart-wrap tall">
            <DoughnutChart
              labels={['0–30', '31–60', '61–90', '91+']}
              values={[at.d0_30, at.d31_60, at.d61_90, at.d91_plus]}
              colors={colors}
              borderWidths={borderW}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <h3>
            Top Overdue Clients{' '}
            <span className="tag">
              {arBucket ? `by ${bucketMeta[arBucket].label} outstanding` : 'by balance'}
            </span>
          </h3>
          <div className="table-scroll" style={{ maxHeight: 420 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Client</th>
                  <th className="num">0–30</th>
                  <th className="num">31–60</th>
                  <th className="num">61–90</th>
                  <th className="num">91+</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {overdueRows.map((c) => (
                  <tr key={c.client}>
                    <td>{c.client}</td>
                    <td className="num" style={arBucket === 'd0_30' ? { fontWeight: 600 } : undefined}>
                      {fmtUSD(c.d0_30)}
                    </td>
                    <td className="num" style={arBucket === 'd31_60' ? { fontWeight: 600 } : undefined}>
                      {fmtUSD(c.d31_60)}
                    </td>
                    <td className="num" style={arBucket === 'd61_90' ? { fontWeight: 600 } : undefined}>
                      {fmtUSD(c.d61_90)}
                    </td>
                    <td
                      className="num"
                      style={arBucket === 'd91_plus' ? { fontWeight: 600 } : undefined}
                    >
                      {fmtUSD(c.d91_plus)}
                    </td>
                    <td className="num">{fmtUSD(c.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h3>
            All Clients — A/R Detail{' '}
            <span className="tag">
              {allRows.length} clients
              {arBucket ? ` with balance in ${bucketMeta[arBucket].label}` : ''}
            </span>
          </h3>
          <input
            type="text"
            value={arSearch}
            onChange={(e) => setArSearch(e.target.value)}
            placeholder="Search client…"
            style={{
              width: '100%',
              padding: '6px 10px',
              border: '1px solid var(--border)',
              margin: '0 0 8px',
              fontFamily: "'IBM Plex Sans',sans-serif",
              fontSize: 12.5,
            }}
          />
          <div className="table-scroll" style={{ maxHeight: 380 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Client</th>
                  <th className="num">0–30</th>
                  <th className="num">31–60</th>
                  <th className="num">61–90</th>
                  <th className="num">91+</th>
                  <th className="num">Credit</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {allRows.map((c) => (
                  <tr key={c.client}>
                    <td>{c.client}</td>
                    <td className="num">{fmtUSD(c.d0_30)}</td>
                    <td className="num">{fmtUSD(c.d31_60)}</td>
                    <td className="num">{fmtUSD(c.d61_90)}</td>
                    <td className="num">{fmtUSD(c.d91_plus)}</td>
                    <td className="num">{fmtUSD(c.credit)}</td>
                    <td className="num">{fmtUSD(c.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
