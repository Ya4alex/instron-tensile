import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { parseSpecimenCsv } from './parse';
import { compute, DEFAULT_OPTS } from './calc';
import { buildXlsx } from './xlsx';

const DIR = join(__dirname, '../../testdata/RawData');

function loadRows() {
  return [1, 2, 6, 7, 8].map((n) => {
    const name = `Specimen_RawData_${n}.csv`;
    const s = parseSpecimenCsv(name, new Uint8Array(readFileSync(join(DIR, name))));
    return { s, r: compute(s, DEFAULT_OPTS) };
  });
}

describe('xlsx export', () => {
  it('builds a workbook readable back by exceljs', async () => {
    const rows = loadRows();
    const blob = await buildXlsx(rows, DEFAULT_OPTS, { specimenSheets: true });
    expect(blob.size).toBeGreaterThan(5000);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());

    const names = wb.worksheets.map((w) => w.name);
    expect(names[0]).toBe('Сводка');
    expect(names.length).toBe(1 + rows.length);

    const ws = wb.getWorksheet('Сводка')!;
    // шапка: Метка, Файл + 10 колонок + «Правка»
    expect(ws.getRow(1).cellCount).toBe(2 + 10 + 1);
    // строки данных: 5 образцов → строки 2..6, далее Среднее/СКО
    expect(String(ws.getRow(7).getCell(1).value)).toBe('Среднее');
    expect(String(ws.getRow(8).getCell(1).value)).toBe('СКО');
    // σ_max первого образца как число
    const sig = Number(ws.getRow(2).getCell(6).value);
    expect(sig).toBeGreaterThan(0);

    // лист образца: таблица данных с флагом участка
    const sh = wb.worksheets.find((w) => w.name !== 'Сводка')!;
    let headerRow = -1;
    sh.eachRow((row, n) => {
      if (String(row.getCell(1).value) === 'Время, с') headerRow = n;
    });
    expect(headerRow).toBeGreaterThan(10);
    const firstData = sh.getRow(headerRow + 1);
    expect(Number(firstData.getCell(1).value)).toBeGreaterThanOrEqual(0);
  });
});
