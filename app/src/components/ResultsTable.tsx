import type { CalcOptions, SpecimenRow } from '../core/types';
import { COLS, type Col } from '../core/columns';
import { mean, std } from '../core/calc';
import { fmt, pct, csvNum, download } from '../utils';
import { Sparkline } from './Sparkline';

export type Row = SpecimenRow;

export interface CsvOpts {
  stats?: boolean; // строки Среднее/СКО внизу (по умолчанию да)
  params?: CalcOptions | null; // параметры расчёта комментариями в шапке
}

export function buildCsvText(rows: Row[], o: CsvOpts = {}): string {
  const lines: string[][] = [];
  const meta: string[] = [];
  if (o.params) {
    meta.push(
      `# параметры: trimK=${o.params.trimK}; tailK=${o.params.tailK}; r2Min=${o.params.r2Min}; winFrac=${o.params.winFrac}`,
      `# образцов: ${rows.length}`,
    );
  }
  lines.push(['Метка', 'Файл', ...COLS.map((c) => c.title), 'Правка']);
  const val = (c: Col, row: Row) =>
    c.isPct ? csvNum(c.get(row) * 100, 1) : csvNum(c.get(row), c.d);
  for (const row of rows)
    lines.push([
      row.s.label,
      row.s.fileName,
      ...COLS.map((c) => val(c, row)),
      [row.r.manual ? 'участок вручную' : '', row.r.manualTrim ? 'обрезка вручную' : '']
        .filter(Boolean)
        .join('; '),
    ]);
  if (o.stats !== false) {
    for (const [name, fn] of [['Среднее', mean], ['СКО', std]] as const) {
      lines.push([
        name,
        '',
        ...COLS.map((c) => {
          const v = fn(rows.map((r2) => c.get(r2)));
          return csvNum(c.isPct ? v * 100 : v, c.isPct ? 1 : c.d ?? 1);
        }),
        '',
      ]);
    }
  }
  return '﻿' + [...meta, ...lines.map((l) => l.map((c) => `"${c}"`).join(';'))].join('\r\n');
}

export function exportCsv(rows: Row[], o: CsvOpts = {}, fileName = 'results.csv') {
  download(new Blob([buildCsvText(rows, o)], { type: 'text/csv;charset=utf-8' }), fileName);
}

export type Sort = { key: string; dir: 1 | -1 } | null;

export function sortRows(rows: Row[], sort: Sort): Row[] {
  if (!sort) return rows;
  const col = COLS.find((c) => c.key === sort.key);
  const get = (r: Row): number | string =>
    sort.key === 'label' ? r.s.label : sort.key === 'file' ? r.s.fileName : col ? col.get(r) : 0;
  return [...rows].sort((a, b) => {
    const va = get(a), vb = get(b);
    const cmp =
      typeof va === 'string' || typeof vb === 'string'
        ? String(va).localeCompare(String(vb), 'ru')
        : va - (vb as number);
    return cmp * sort.dir;
  });
}

export function ResultsTable({
  rows,
  errors,
  excluded,
  onToggle,
  onLabel,
  onSelect,
  flashId,
  sort,
  onSort,
}: {
  rows: Row[];
  errors: { fileName: string; error: string }[];
  excluded: Set<string>;
  onToggle: (id: string) => void;
  onLabel: (id: string, v: string) => void;
  onSelect: (id: string) => void;
  flashId: string | null;
  sort: Sort;
  onSort: (key: string) => void;
}) {
  const active = rows.filter((r) => !excluded.has(r.s.id));
  const stat = (fn: (xs: number[]) => number) =>
    COLS.map((c) => fn(active.map((r) => c.get(r))));
  const render = (c: Col, v: number) => (c.isPct ? pct(v) : fmt(v, c.d));
  const means = stat(mean);
  const stds = stat(std);

  const arrow = (key: string) => (sort?.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th title="Включён в обработку">✓</th>
            <th className="sortable" onClick={() => onSort('label')}>Метка{arrow('label')}</th>
            <th className="sortable" onClick={() => onSort('file')}>Файл{arrow('file')}</th>
            {COLS.map((c) => (
              <th key={c.key} className="num sortable" onClick={() => onSort(c.key)}>
                {c.title}{arrow(c.key)}
              </th>
            ))}
            <th>σ(ε)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const off = excluded.has(row.s.id);
            return (
              <tr
                key={row.s.id}
                className={`${off ? 'excluded' : ''} ${flashId === row.s.id ? 'flash' : ''}`}
                onClick={(e) => {
                  const t = e.target as HTMLElement;
                  if (!t.closest('input,button,select')) onSelect(row.s.id);
                }}
              >
                <td>
                  <input type="checkbox" checked={!off} onChange={() => onToggle(row.s.id)} />
                </td>
                <td>
                  <input
                    className="label-input"
                    value={row.s.label}
                    onChange={(e) => onLabel(row.s.id, e.target.value)}
                  />
                </td>
                <td className="fname" title={row.s.fileName}>{row.s.fileName}</td>
                {COLS.map((c) => (
                  <td
                    key={c.key}
                    className={`num ${c.key === 'eTan' && row.r.manual ? 'manual-cell' : ''}`}
                    title={c.key === 'eTan' && row.r.manual ? 'Линейный участок задан вручную' : undefined}
                  >
                    {c.isPct ? pct(c.get(row)) : fmt(c.get(row), c.d)}
                    {c.key === 'eTan' && row.r.manual ? ' ✎' : ''}
                  </td>
                ))}
                <td>
                  <button className="spark-btn" onClick={() => onSelect(row.s.id)} title="К графикам образца">
                    <Sparkline x={row.r.eps} y={row.r.sigma} h={24} />
                  </button>
                </td>
              </tr>
            );
          })}
          {errors.map((e) => (
            <tr key={e.fileName} className="error-row">
              <td />
              <td className="fname" colSpan={2}>{e.fileName}</td>
              <td colSpan={COLS.length + 1} className="error-cell">ошибка: {e.error}</td>
            </tr>
          ))}
        </tbody>
        {active.length > 0 && (
          <tfoot>
            <tr className="stat-row">
              <td />
              <td colSpan={2}><b>X̄ ± 2σ</b></td>
              {means.map((m, i) => (
                <td key={i} className="num">
                  <b>{render(COLS[i], m)} ± {render(COLS[i], 2 * stds[i])}</b>
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
