import ExcelJS from 'exceljs';
import { COLS } from './columns';
import { mean, std } from './calc';
import type { CalcOptions, SpecimenRow } from './types';

const round = (v: number, d = 4): number | null => (Number.isFinite(v) ? +v.toFixed(d) : null);

const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFB0B0B0' } },
  bottom: { style: 'thin', color: { argb: 'FFB0B0B0' } },
  left: { style: 'thin', color: { argb: 'FFB0B0B0' } },
  right: { style: 'thin', color: { argb: 'FFB0B0B0' } },
};

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3EAF5' } };
  row.eachCell((c) => (c.border = BORDER));
  row.alignment = { horizontal: 'center', vertical: 'middle' };
}

/** имя листа: <=31 символа, без : \ / ? * [ ], уникальное */
function sheetName(base: string, i: number, used: Set<string>): string {
  let name = base.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 28) || `Обр_${i + 1}`;
  if (!used.has(name)) return used.add(name), name;
  for (let k = 2; ; k++) {
    const cand = `${name.slice(0, 25)}_${k}`;
    if (!used.has(cand)) return used.add(cand), cand;
  }
}

export interface XlsxOpts {
  specimenSheets?: boolean; // листы по образцам (по умолчанию нет)
  stats?: boolean;          // строки Среднее/СКО (по умолчанию да)
  params?: boolean;         // блок «Параметры расчёта» (по умолчанию да)
  summary?: boolean;        // лист «Сводка» (по умолчанию да)
}

export async function buildXlsx(
  rows: SpecimenRow[],
  opts: CalcOptions,
  ex: XlsxOpts = {},
): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'instron-tensile';
  wb.created = new Date();

  // ---------- лист «Сводка» ----------
  if (ex.summary !== false) {
    const ws = wb.addWorksheet('Сводка', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [{ width: 16 }, { width: 30 }, ...COLS.map(() => ({ width: 13 }))];
    const head = ws.addRow(['Метка', 'Файл', ...COLS.map((c) => c.title), 'Правка']);
    styleHeader(head);

    for (const row of rows) {
      const r = ws.addRow([
        row.s.label,
        row.s.fileName,
        ...COLS.map((c) => round(c.isPct ? c.get(row) * 100 : c.get(row), c.isPct ? 1 : c.d ?? 3)),
        [row.r.manual ? 'участок вручную' : '', row.r.manualTrim ? 'обрезка вручную' : '']
          .filter(Boolean)
          .join('; '),
      ]);
      r.eachCell((c) => (c.border = BORDER));
    }

    if (ex.stats !== false) {
      const statRow = (name: string, fn: (v: number[]) => number) => {
        const r = ws.addRow([
          name,
          '',
          ...COLS.map((c) => {
            const v = fn(rows.map((row) => c.get(row)));
            return round(c.isPct ? v * 100 : v, c.isPct ? 1 : c.d ?? 3);
          }),
          '',
        ]);
        r.font = { bold: true };
        r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F0E4' } };
        r.eachCell((c) => (c.border = BORDER));
      };
      statRow('Среднее', mean);
      statRow('СКО', std);
    }

    if (ex.params !== false) {
      ws.addRow([]);
      const pr = ws.addRow(['Параметры расчёта']);
      pr.font = { bold: true };
      ws.addRow(['Порог обрезки начала (доля N_max)', opts.trimK]);
      ws.addRow(['Порог обрезки хвоста (доля N_max)', opts.tailK]);
      ws.addRow(['Мин. R² линейного участка', opts.r2Min]);
      ws.addRow(['Мин. окно участка (доля точек)', opts.winFrac]);
      ws.addRow(['Допустимый спад наклона участка', opts.slopeFrac]);
      const algoName = { first: 'первый участок', steepest: 'самый крутой участок', secant: 'секущая ε₁→ε₂' }[opts.algo];
      ws.addRow(['Алгоритм поиска участка', algoName]);
      if (opts.algo === 'secant')
        ws.addRow(['Границы секущей ε, %', `${(opts.epsSec0 * 100).toFixed(3)} – ${(opts.epsSec1 * 100).toFixed(3)}`]);
      ws.addRow(['Образцов в выгрузке', rows.length]);
    }
  }

  // ---------- листы по образцам ----------
  const used = new Set<string>(['Сводка']);
  if (ex.specimenSheets) rows.forEach(({ s, r }, i) => {
    const sh = wb.addWorksheet(sheetName(s.label, i, used));
    sh.columns = [
      { width: 24 }, { width: 14 }, { width: 14 }, { width: 12 },
      { width: 12 }, { width: 12 }, { width: 12 }, { width: 18 },
    ];

    sh.addRow([`Образец: ${s.label}`]).font = { bold: true, size: 13 };
    sh.addRow([`Файл: ${s.fileName}`]);
    sh.addRow([]);
    sh.addRow(['Геометрия']).font = { bold: true };
    sh.addRow(['Длина l₀, мм', s.geometry.l0]);
    sh.addRow(['Ширина b₀, мм', s.geometry.b0]);
    sh.addRow(['Толщина h_ср, мм', s.geometry.hcp]);
    sh.addRow([]);
    sh.addRow(['Результаты']).font = { bold: true };
    sh.addRow(['N_max (сырой), Н', round(r.nMax)]);
    sh.addRow(['σ_max, МПа', round(r.sigmaMax)]);
    sh.addRow(['ε_max, %', round(r.epsMax * 100, 1)]);
    sh.addRow(['ε@σ_max, %', round(r.epsAtSigmaMax * 100, 1)]);
    sh.addRow(['E_тан, МПа', round(r.eTan, 1)]);
    sh.addRow(['R² участка', round(r.r2, 4)]);
    sh.addRow(['Границы участка ε, %',
      `${(r.eps[r.region.i0] * 100).toFixed(2)} – ${(r.eps[r.region.i1] * 100).toFixed(2)}`]);
    sh.addRow(['Линейный участок', r.manual ? 'задан вручную' : 'авто']);
    sh.addRow(['E_сек1, МПа', round(r.eSec1, 1)]);
    sh.addRow(['E_сек2, МПа', round(r.eSec2, 1)]);
    sh.addRow([
      'Обрезка',
      `начало: ${r.trimIndex} тч., хвост: ${s.series.n.length - 1 - r.endIndex} тч.${r.manualTrim ? ' — задана вручную' : ''}`,
    ]);
    sh.addRow([]);

    const dh = sh.addRow([
      'Время, с', 'Удлинение (сыр.), мм', 'Нагрузка (сыр.), Н',
      'Δl, мм', 'N, Н', 'ε, %', 'σ, МПа', 'Участок',
    ]);
    styleHeader(dh);

    const { t, dl: dlRaw, n: nRaw } = s.series;
    for (let k = 0; k < t.length; k++) {
      const kept = k >= r.trimIndex && k <= r.endIndex;
      const j = k - r.trimIndex;
      sh.addRow([
        round(t[k]),
        round(dlRaw[k]),
        round(nRaw[k]),
        kept ? round(r.dl[j]) : null,
        kept ? round(r.n[j]) : null,
        kept ? round(r.eps[j] * 100, 3) : null,
        kept ? round(r.sigma[j]) : null,
        kept ? 'данные' : k < r.trimIndex ? 'обрезано (начало)' : 'обрезано (хвост)',
      ]);
    }
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
