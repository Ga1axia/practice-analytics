import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { fmtUSD, fmtUSDk, palette } from '../lib/format';

ChartJS.register(
  DoughnutController,
  BarController,
  LineController,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Filler,
);

export function DoughnutChart({
  labels,
  values,
  colors,
  borderWidths,
}: {
  labels: string[];
  values: number[];
  colors: string[];
  borderWidths?: number[];
}) {
  return (
    <Chart
      type="doughnut"
      data={{
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors,
            borderWidth: borderWidths || 2,
            borderColor: '#FFFFFF',
          },
        ],
      }}
      options={{
        cutout: '68%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { family: 'IBM Plex Mono', size: 10.5 }, boxWidth: 10 },
          },
          tooltip: { callbacks: { label: (c) => c.label + ': ' + fmtUSD(Number(c.raw)) } },
        },
      }}
    />
  );
}

export function HBarChart({
  labels,
  values,
  color,
}: {
  labels: string[];
  values: number[];
  color: string;
}) {
  return (
    <Chart
      type="bar"
      data={{
        labels,
        datasets: [{ data: values, backgroundColor: color, borderRadius: 2 }],
      }}
      options={{
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => fmtUSD(Number(c.raw)) } },
        },
        scales: {
          x: {
            ticks: { callback: (v) => fmtUSDk(Number(v)), font: { family: 'IBM Plex Mono', size: 10 } },
            grid: { color: '#E4E8EE' },
          },
          y: { ticks: { font: { size: 10.5 } }, grid: { display: false } },
        },
      }}
    />
  );
}

export function StackedHoursChart({
  labels,
  bill,
  nb,
}: {
  labels: string[];
  bill: number[];
  nb: number[];
}) {
  return (
    <Chart
      type="bar"
      data={{
        labels,
        datasets: [
          { label: 'Billable', data: bill, backgroundColor: palette.teal, stack: 's' },
          { label: 'Non-Billable', data: nb, backgroundColor: palette.rust, stack: 's' },
        ],
      }}
      options={{
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { family: 'IBM Plex Mono', size: 9.5 } } },
          y: { stacked: true, grid: { color: '#E4E8EE' } },
        },
      }}
    />
  );
}

export function EfficiencyLineChart({ labels, values }: { labels: string[]; values: number[] }) {
  return (
    <Chart
      type="line"
      data={{
        labels,
        datasets: [
          {
            label: 'Efficiency',
            data: values,
            borderColor: palette.gold,
            backgroundColor: 'rgba(168,120,58,0.15)',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
          },
        ],
      }}
      options={{
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => Number(c.raw).toFixed(1) + '%' } },
        },
        scales: {
          y: { ticks: { callback: (v) => v + '%' }, grid: { color: '#E4E8EE' } },
          x: { ticks: { font: { family: 'IBM Plex Mono', size: 9.5 } } },
        },
      }}
    />
  );
}

export function RevenueChart({
  labels,
  gross,
  paid,
}: {
  labels: string[];
  gross: number[];
  paid: number[];
}) {
  return (
    <Chart
      type="bar"
      data={{
        labels,
        datasets: [
          { type: 'bar', label: 'Gross Billed', data: gross, backgroundColor: '#B9C2CF' },
          {
            type: 'line',
            label: 'Cash Collected',
            data: paid,
            borderColor: palette.gold,
            backgroundColor: palette.gold,
            tension: 0.25,
            pointRadius: 2,
          },
        ],
      }}
      options={{
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { family: 'IBM Plex Mono', size: 10 } },
          },
        },
        scales: {
          x: {
            ticks: {
              font: { family: 'IBM Plex Mono', size: 8.5 },
              maxRotation: 90,
              minRotation: 90,
            },
          },
          y: { ticks: { callback: (v) => fmtUSDk(Number(v)) }, grid: { color: '#E4E8EE' } },
        },
      }}
    />
  );
}

export function HoursHBar({ labels, values }: { labels: string[]; values: number[] }) {
  return (
    <Chart
      type="bar"
      data={{
        labels,
        datasets: [{ data: values, backgroundColor: palette.navy, borderRadius: 2 }],
      }}
      options={{
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: '#E4E8EE' } },
          y: { ticks: { font: { size: 10.5 } }, grid: { display: false } },
        },
      }}
    />
  );
}
