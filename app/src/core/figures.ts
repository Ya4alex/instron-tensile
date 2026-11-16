import Plotly from 'plotly.js-dist-min';
import JSZip from 'jszip';
import type { CalcResult, Specimen } from './types';
import { download } from '../utils';

export interface Figure {
  name: string; // ключ/имя файла при экспорте
  fileName?: string; // имя файла при одиночной выгрузке (с меткой образца)
  title: string;
  data: any[];
  layout: any;
}

const AXIS_N = 'Сила N, Н';
const AXIS_DL = 'Удлинение Δl, мм';
const AXIS_SIG = 'Напряжение σ, МПа';
const AXIS_EPS = 'Деформация ε, отн. ед.';

const baseLayout = (xTitle: string, yTitle: string): any => ({
  margin: { t: 40, r: 20, b: 55, l: 70 },
  xaxis: { title: xTitle, zeroline: true, gridcolor: '#e8e8e8', rangemode: 'tozero' },
  yaxis: { title: yTitle, zeroline: true, gridcolor: '#e8e8e8' },
  plot_bgcolor: '#fff',
  paper_bgcolor: '#fff',
  showlegend: false,
});

const line = (x: number[], y: number[], extra: any = {}) => ({
  x, y, type: 'scatter', mode: 'lines', line: { color: '#1f5fb4', width: 1.5 }, ...extra,
});

/** Четыре графика образца: рис. 2.4, 2.5, 2.6, 2.7–2.9 */
export function specimenFigures(s: Specimen, r: CalcResult): Figure[] {
  const { dl: dlRaw, n: nRaw } = s.series;
  const { i0, i1 } = r.region;
  const eps0 = r.eps[i0], eps1 = r.eps[i1];
  const sig0 = r.sigma[i0], sig1 = r.sigma[i1];

  const cutStyle = { line: { color: 'rgba(220,60,60,0.55)', width: 1.5 } };
  const fig1data: any[] = [
    line(dlRaw.slice(r.trimIndex, r.endIndex + 1), nRaw.slice(r.trimIndex, r.endIndex + 1), { name: 'данные' }),
  ];
  if (r.trimIndex > 0)
    fig1data.push({ x: dlRaw.slice(0, r.trimIndex + 1), y: nRaw.slice(0, r.trimIndex + 1), type: 'scatter', mode: 'lines', name: 'обрезано', ...cutStyle });
  if (r.endIndex < nRaw.length - 1)
    fig1data.push({ x: dlRaw.slice(r.endIndex), y: nRaw.slice(r.endIndex), type: 'scatter', mode: 'lines', name: 'обрезано (хвост)', ...cutStyle });
  const fig1: Figure = {
    name: 'raw_force',
    title: 'Сила от удлинения (исходные данные)',
    data: fig1data,
    layout: {
      ...baseLayout(AXIS_DL, AXIS_N),
      title: { text: 'Исходная зависимость N(Δl)', font: { size: 14 } },
      showlegend: true,
      legend: { orientation: 'h', y: 1.12, font: { size: 11 } },
    },
  };

  const fig2: Figure = {
    name: 'trimmed_force',
    title: 'Сила от удлинения (после обрезки)',
    data: [line(r.dl, r.n)],
    layout: { ...baseLayout(AXIS_DL, AXIS_N), title: { text: 'N(Δl) после обрезки', font: { size: 14 } } },
  };

  const fig3: Figure = {
    name: 'stress_strain',
    title: 'Напряжение от деформации',
    data: [line(r.eps, r.sigma)],
    layout: { ...baseLayout(AXIS_EPS, AXIS_SIG), title: { text: 'σ(ε)', font: { size: 14 } } },
  };

  const pad = (eps1 - eps0) * 0.15;
  const fx = [eps0 - pad, eps1 + pad];
  const fy = fx.map((x) => r.fit.slope * x + r.fit.intercept);
  // зелёные секущие рисуем к тем же точкам, по которым считается E_сек
  // (первая точка с ε≠0 от границы участка — иначе луч уходит вертикально)
  const secIdx = (from: number, dir: 1 | -1) => {
    for (let i = from; i >= 0 && i < r.eps.length; i += dir) if (r.eps[i] !== 0) return i;
    return -1;
  };
  const sj0 = secIdx(i0, 1),
    sj1 = secIdx(i1, -1);
  const secant = (j: number) =>
    j >= 0
      ? {
          x: [0, r.eps[j]],
          y: [0, r.sigma[j]],
          type: 'scatter',
          mode: 'lines',
          line: { color: '#2a2', width: 1.5, dash: 'dot' },
        }
      : null;
  const fig4: Figure = {
    name: 'modulus',
    title: 'Аппроксимация линейного участка',
    data: [
      line(r.eps, r.sigma),
      { x: fx, y: fy, type: 'scatter', mode: 'lines', line: { color: '#d33', width: 2, dash: 'dash' } },
      secant(sj0),
      secant(sj1),
      { x: [eps0, eps1], y: [sig0, sig1], type: 'scatter', mode: 'markers', marker: { color: '#d33', size: 8, symbol: 'circle-open' } },
    ].filter(Boolean),
    layout: {
      ...baseLayout(AXIS_EPS, AXIS_SIG),
      title: { text: 'Линейный участок, касательный и секущие модули', font: { size: 14 } },
      annotations: [{
        x: eps1, y: sig1 * 0.6, xanchor: 'right',
        text: `E_тан = ${r.eTan.toFixed(1)} МПа<br>E_сек1 = ${r.eSec1.toFixed(1)}<br>E_сек2 = ${r.eSec2.toFixed(1)}<br>R² = ${r.r2.toFixed(4)}`,
        showarrow: false, font: { size: 12 }, align: 'right',
        bgcolor: 'rgba(255,255,255,0.85)', bordercolor: '#ccc', borderwidth: 1,
      }],
      shapes: [{
        type: 'rect', xref: 'x', yref: 'paper',
        x0: eps0, x1: eps1, y0: 0, y1: 1,
        fillcolor: 'rgba(60,180,60,0.08)', line: { width: 0 },
      }],
    },
  };

  // идентификатор образца в имени файла при одиночной выгрузке
  const tag = s.label.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  for (const f of [fig1, fig2, fig3, fig4]) f.fileName = `${tag}_${f.name}`;
  return [fig1, fig2, fig3, fig4];
}

/** Экспорт всех графиков активных образцов в ZIP с SVG */
export async function exportAllFigures(items: { s: Specimen; r: CalcResult }[]) {
  const zip = new JSZip();
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_');
  const put = async (fig: Figure, path: string) => {
    const url: string = await Plotly.toImage(
      { data: fig.data, layout: { ...fig.layout, width: 1000, height: 640, autosize: false } },
      { format: 'svg', width: 1000, height: 640 },
    );
    zip.file(path + '.svg', decodeURIComponent(url.slice(url.indexOf(',') + 1)));
  };
  for (const { s, r } of items)
    for (const fig of specimenFigures(s, r)) await put(fig, `${safe(s.label)}/${fig.name}`);
  for (const fig of overlayFigures(items)) await put(fig, `overlay/${fig.name}`);
  download(await zip.generateAsync({ type: 'blob' }), 'graphs_svg.zip');
}

/** Сводные графики по активным образцам */
export function overlayFigures(items: { s: Specimen; r: CalcResult }[]): Figure[] {
  const colorway = ['#1f5fb4', '#d33', '#2a2', '#e80', '#808', '#0aa', '#a52', '#555'];
  const traces = (xs: (r: CalcResult) => number[], ys: (r: CalcResult) => number[]) =>
    items.map(({ s, r }, i) => ({
      x: xs(r), y: ys(r), type: 'scatter', mode: 'lines',
      name: s.label, line: { color: colorway[i % colorway.length], width: 1.3 },
    }));

  return [
    {
      name: 'overlay_force',
      title: 'Сводный: сила от удлинения (все активные)',
      data: traces((r) => r.dl, (r) => r.n),
      layout: { ...baseLayout(AXIS_DL, AXIS_N), title: { text: 'Сводный N(Δl)', font: { size: 14 } }, showlegend: true, legend: { font: { size: 10 } } },
    },
    {
      name: 'overlay_stress',
      title: 'Сводный: напряжение от деформации (все активные)',
      data: traces((r) => r.eps, (r) => r.sigma),
      layout: { ...baseLayout(AXIS_EPS, AXIS_SIG), title: { text: 'Сводный σ(ε)', font: { size: 14 } }, showlegend: true, legend: { font: { size: 10 } } },
    },
  ];
}
