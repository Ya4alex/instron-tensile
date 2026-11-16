import type { Specimen } from './types';

const num = (s: string): number =>
  parseFloat(s.trim().replace(/^"|"$/g, '').replace(',', '.'));

function decode(bytes: Uint8Array): string {
  // Instron пишет CP1251; если файл валидный UTF-8 — берём его
  try {
    const t = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (t.includes('�')) throw new Error('replacement chars');
    return t;
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

const splitCells = (line: string): string[] =>
  line.split(';').map((c) => c.trim().replace(/^"|"$/g, ''));

export function specimenIndexFromName(fileName: string): number | null {
  const m = /(\d+)(?=\.csv$)/i.exec(fileName);
  return m ? parseInt(m[1], 10) : null;
}

export function parseSpecimenCsv(fileName: string, bytes: Uint8Array): Specimen {
  const text = decode(bytes);
  const lines = text.split(/\r?\n/);

  const meta: Record<string, string> = {};
  const geometry = { l0: NaN, b0: NaN, hcp: NaN };
  let declaredMaxLoad: number | null = null;

  let dataStart = -1;
  let timeCol = 0,
    dlCol = 1,
    nCol = 2;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = splitCells(line);
    const key = cells[0];

    // строка заголовков таблицы данных
    if (/время/i.test(key) && cells.some((c) => /удлинение/i.test(c))) {
      timeCol = cells.findIndex((c) => /время/i.test(c));
      dlCol = cells.findIndex((c) => /удлинение/i.test(c));
      nCol = cells.findIndex((c) => /нагрузка|сила/i.test(c));
      if (nCol < 0) throw new Error('не найдена колонка нагрузки (Нагрузка/Сила)');
      // следующая непустая строка — единицы измерения "(s);(mm);(N)"
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && /^\(?[a-zа-я]+\)?$/i.test(splitCells(lines[j])[0])) j++;
      dataStart = j;
      break;
    }

    if (cells.length >= 2) {
      meta[key] = cells[1];
      const v = num(cells[1]);
      if (/^длина/i.test(key)) geometry.l0 = v;
      else if (/^ширина/i.test(key)) geometry.b0 = v;
      else if (/^толщина/i.test(key)) geometry.hcp = v;
      else if (/максимум\s+нагрузка/i.test(key)) declaredMaxLoad = v;
    }
  }

  if (dataStart < 0) throw new Error('не найдена таблица данных (Время;Удлинение;Нагрузка)');
  if (![geometry.l0, geometry.b0, geometry.hcp].every((v) => Number.isFinite(v) && v > 0))
    throw new Error('не найдена геометрия образца (Длина/Ширина/Толщина)');

  const t: number[] = [],
    dl: number[] = [],
    n: number[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = splitCells(line);
    const maxCol = Math.max(timeCol, dlCol, nCol);
    if (cells.length <= maxCol) break;
    const tv = num(cells[timeCol]),
      dv = num(cells[dlCol]),
      nv = num(cells[nCol]);
    if (![tv, dv, nv].every(Number.isFinite)) break;
    t.push(tv);
    dl.push(dv);
    n.push(nv);
  }
  if (t.length < 3) throw new Error(`слишком мало точек данных: ${t.length}`);

  return {
    id: fileName + '#' + Math.random().toString(36).slice(2, 8),
    fileName,
    label: fileName.replace(/\.csv$/i, ''),
    index: specimenIndexFromName(fileName),
    geometry,
    meta,
    declaredMaxLoad,
    series: { t, dl, n },
  };
}

/** Метки образцов из *.is_tens_Results.csv (индекс строки → метка) */
export function parseResultsCsv(bytes: Uint8Array): Map<number, string> {
  const labels = new Map<number, string>();
  const text = decode(bytes);
  for (const line of text.split(/\r?\n/)) {
    const cells = splitCells(line);
    if (cells.length < 2) continue;
    const idx = parseInt(cells[0], 10);
    if (!Number.isFinite(idx)) continue;
    const label = cells[1];
    if (label) labels.set(idx, label);
  }
  return labels;
}

export const isResultsCsv = (name: string) => /results\.csv$/i.test(name);
