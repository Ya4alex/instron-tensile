import JSZip from 'jszip';
import { csvNum, download } from '../utils';
import type { SpecimenRow } from './types';

/** Один образец → CSV-текст (метаданные комментариями + таблица точек) */
export function specimenCsvText({ s, r }: SpecimenRow): string {
  const meta = [
    `# Образец: ${s.label}`,
    `# Файл: ${s.fileName}`,
    `# l0=${s.geometry.l0} мм; b0=${s.geometry.b0} мм; h_ср=${s.geometry.hcp} мм`,
    `# sigma_max=${csvNum(r.sigmaMax)} МПа; eps_max=${csvNum(r.epsMax * 100, 1)}%; eps@sigma_max=${csvNum(r.epsAtSigmaMax * 100, 1)}%`,
    `# E_тан=${csvNum(r.eTan, 1)} МПа; R2=${csvNum(r.r2)}; E_сек1=${csvNum(r.eSec1, 1)}; E_сек2=${csvNum(r.eSec2, 1)}${r.manual ? ' — участок задан вручную' : ''}`,
    `# обрезка: начало ${r.trimIndex} тч., хвост ${s.series.n.length - 1 - r.endIndex} тч.${r.manualTrim ? ' — задана вручную' : ''}`,
  ];
  const head = [
    'Время, с', 'Удлинение (сыр.), мм', 'Нагрузка (сыр.), Н',
    'Δl, мм', 'N, Н', 'ε, %', 'σ, МПа', 'Участок',
  ];
  const lines = [...meta, head.map((c) => `"${c}"`).join(';')];
  const { t, dl: dlRaw, n: nRaw } = s.series;
  for (let k = 0; k < t.length; k++) {
    const kept = k >= r.trimIndex && k <= r.endIndex;
    const j = k - r.trimIndex;
    lines.push(
      [
        csvNum(t[k]),
        csvNum(dlRaw[k]),
        csvNum(nRaw[k]),
        kept ? csvNum(r.dl[j]) : '',
        kept ? csvNum(r.n[j]) : '',
        kept ? csvNum(r.eps[j] * 100, 3) : '',
        kept ? csvNum(r.sigma[j]) : '',
        kept ? 'данные' : k < r.trimIndex ? 'обрезано (начало)' : 'обрезано (хвост)',
      ]
        .map((c) => `"${c}"`)
        .join(';'),
    );
  }
  return '﻿' + lines.join('\r\n');
}

const safeName = (s: string) => s.replace(/[:\\/?*[\]"<>|]/g, '_').slice(0, 60);

export function exportSpecimenCsv(row: SpecimenRow) {
  const name = `${safeName(row.s.label) || row.s.fileName.replace(/\.csv$/i, '')}.csv`;
  download(new Blob([specimenCsvText(row)], { type: 'text/csv;charset=utf-8' }), name);
}

/** ZIP: сводная таблица (опционально) + CSV по каждому образцу */
export async function exportSpecimenZip(rows: SpecimenRow[], summaryCsv: string | null) {
  const zip = new JSZip();
  if (summaryCsv) zip.file('summary.csv', summaryCsv);
  const used = new Set<string>();
  for (const row of rows) {
    let name = `${safeName(row.s.label) || `specimen_${row.s.id}`}.csv`;
    for (let k = 2; used.has(name); k++) name = name.replace(/\.csv$/, `_${k}.csv`);
    used.add(name);
    zip.file(name, specimenCsvText(row));
  }
  download(await zip.generateAsync({ type: 'blob' }), 'specimen_tables.zip');
}
