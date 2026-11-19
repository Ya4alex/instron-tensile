import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSpecimenCsv, parseResultsCsv } from './parse';
import {
  compute, mean, std, applyManualRegion, applyManualTrim, regionFit, DEFAULT_OPTS,
} from './calc';

const DATA = join(__dirname, '../../testdata');
const RAW = join(DATA, 'RawData');

const load = (dir: string, name: string) =>
  new Uint8Array(readFileSync(join(dir, name)));

describe('parse', () => {
  const s = parseSpecimenCsv('Specimen_RawData_1.csv', load(RAW, 'Specimen_RawData_1.csv'));

  it('декодирует CP1251 и читает геометрию', () => {
    expect(s.geometry).toEqual({ l0: 30, b0: 2, hcp: 0.61 });
    expect(s.meta['Дата начала']).toContain('ноября');
    expect(s.index).toBe(1);
  });

  it('читает таблицу данных', () => {
    const { t, dl, n } = s.series;
    expect(t.length).toBeGreaterThan(10);
    expect(t.length).toBe(dl.length);
    expect(dl[0]).toBe(0);
    // контроль: максимум ряда N совпадает с шапкой «Максимум Нагрузка»
    expect(Math.max(...n)).toBeCloseTo(s.declaredMaxLoad!, 4);
  });

  it('парсит все 10 образцов', () => {
    for (const f of readdirSync(RAW)) {
      expect(() => parseSpecimenCsv(f, load(RAW, f))).not.toThrow();
    }
  });

  it('читает метки из Results.csv', () => {
    const labels = parseResultsCsv(load(DATA, '23-17-46-11_1.is_tens_Results.csv'));
    expect(labels.get(1)).toBe('1');
    expect(labels.get(6)).toBe('3'); // метки повторяются — храним как есть
    expect(labels.get(10)).toBe('7');
    expect(labels.size).toBe(10);
  });
});

describe('calc', () => {
  const s = parseSpecimenCsv('Specimen_RawData_1.csv', load(RAW, 'Specimen_RawData_1.csv'));
  const r = compute(s);

  it('обрезает и сдвигает в начало координат', () => {
    expect(r.trimIndex).toBeGreaterThanOrEqual(0);
    expect(r.dl[0]).toBe(0);
    expect(r.n[0]).toBe(0);
  });

  it('обрезает хвост после разрыва', () => {
    // у образца 5 — длинный хвост (403 точки, машина шла до ручной остановки)
    const s5 = parseSpecimenCsv('Specimen_RawData_5.csv', load(RAW, 'Specimen_RawData_5.csv'));
    const r5 = compute(s5);
    expect(r5.endIndex).toBeLessThan(s5.series.n.length - 1);
    // у хорошего образца 1 хвост короткий, но тоже есть
    expect(r.endIndex).toBeLessThan(s.series.n.length - 1);
    // epsMax — деформация в точке разрыва, а не в конце записи
    expect(r.epsMax).toBeLessThanOrEqual(s.series.dl[s.series.dl.length - 1] / s.geometry.l0 + 1e-9);
  });

  it('σ_max = N_p/(h·b)', () => {
    expect(r.nMax).toBeCloseTo(17.40438, 4);
    expect(r.sigmaMax).toBeCloseTo(17.40438 / (0.61 * 2), 3); // ≈14.27 МПа
  });

  it('деформации', () => {
    expect(r.epsMax).toBeGreaterThan(0);
    expect(r.epsAtSigmaMax).toBeGreaterThan(0);
    expect(r.epsAtSigmaMax).toBeLessThanOrEqual(r.epsMax + 1e-12);
  });

  it('находит линейный участок и модули', () => {
    expect(r.r2).toBeGreaterThan(0.9);
    expect(r.eTan).toBeGreaterThan(0);
    expect(r.eSec1).toBeGreaterThan(0);
    expect(r.eSec2).toBeGreaterThan(0);
    expect(r.region.i0).toBeLessThan(r.region.i1);
    // участок в предпиковой области
    const iPeak = r.sigma.indexOf(Math.max(...r.sigma));
    expect(r.region.i1).toBeLessThanOrEqual(iPeak);
  });

  it('все образцы считаются без NaN в ключевых величинах', () => {
    for (const f of readdirSync(RAW)) {
      const r2 = compute(parseSpecimenCsv(f, load(RAW, f)));
      for (const v of [r2.sigmaMax, r2.epsMax, r2.eTan, r2.eSec1, r2.eSec2])
        expect(Number.isFinite(v), `${f}`).toBe(true);
    }
  });
});

describe('stats', () => {
  it('mean / std по методичке (деление на n)', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(std([2, 4, 6])).toBeCloseTo(Math.sqrt(8 / 3), 6); // σ = sqrt(((−2)²+0+2²)/3)
    expect(std([5])).toBe(0);
  });
});

describe('manual region', () => {
  it('applyManualRegion пересчитывает E_тан/R² и ставит флаг', () => {
    const s = parseSpecimenCsv('Specimen_RawData_1.csv', load(RAW, 'Specimen_RawData_1.csv'));
    const r = compute(s);
    const eps0 = r.eps[2], eps1 = r.eps[Math.min(8, r.eps.length - 1)];
    const m = applyManualRegion(r, eps1, eps0); // порядок границ не важен
    expect(m.manual).toBe(true);
    expect(Number.isFinite(m.eTan)).toBe(true);
    expect(m.region.i1).toBeGreaterThan(m.region.i0);
    expect(m.region.i1 - m.region.i0).toBeLessThanOrEqual(8);
    // авто-результат не затронут
    expect(r.manual).toBeUndefined();
  });
});

describe('manual trim', () => {
  it('applyManualTrim пересчитывает ряд по заданным границам', () => {
    const s = parseSpecimenCsv('Specimen_RawData_1.csv', load(RAW, 'Specimen_RawData_1.csv'));
    const r = compute(s);
    const m = applyManualTrim(s, DEFAULT_OPTS, 5, 20);
    expect(m.manualTrim).toBe(true);
    expect(m.trimIndex).toBe(5);
    expect(m.endIndex).toBe(20);
    expect(m.dl.length).toBe(16);
    expect(m.dl[0]).toBe(0);
    expect(m.n[0]).toBe(0);
    expect(Number.isFinite(m.eTan)).toBe(true);
    expect(r.manualTrim).toBeFalsy();
  });
});

/* ---------- полная проверка матчасти на всех реальных данных ---------- */

const FILES = readdirSync(RAW).filter((f) => f.toLowerCase().endsWith('.csv'));
const SPECS = FILES.map((f) => parseSpecimenCsv(f, load(RAW, f)));
const RESULTS = SPECS.map((s) => compute(s));

/** эталонный МНК «в лоб» — независимая реализация для сверки */
function naiveFit(eps: number[], sigma: number[], i0: number, i1: number) {
  const n = i1 - i0 + 1;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
  for (let i = i0; i <= i1; i++) {
    sx += eps[i]; sy += sigma[i];
    sxy += eps[i] * sigma[i]; sx2 += eps[i] * eps[i]; sy2 += sigma[i] * sigma[i];
  }
  const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
  const intercept = (sy - slope * sx) / n;
  const rden = (n * sx2 - sx * sx) * (n * sy2 - sy * sy);
  const r2 = rden > 0 ? ((n * sxy - sx * sy) ** 2) / rden : 0;
  return { slope, intercept, r2 };
}

/** индекс первой точки с eps!=0 от границы — та же логика, что у секущих */
const secIdx = (eps: number[], from: number, dir: 1 | -1) => {
  for (let i = from; i >= 0 && i < eps.length; i += dir) if (eps[i] !== 0) return i;
  return -1;
};

describe('матчасть — сверка на всех образцах', () => {
  it('загружены все 10 файлов', () => {
    expect(SPECS.length).toBe(10);
  });

  it('толщина из сырых файлов совпадает с Results.csv', () => {
    const text = readFileSync(join(DATA, '23-17-46-11_1.is_tens_Results.csv'));
    const lines = new TextDecoder('windows-1251').decode(text).split(/\r?\n/);
    const thick = new Map<number, number>();
    for (const line of lines) {
      const c = line.split(';').map((x) => x.trim().replace(/^"|"$/g, ''));
      const idx = parseInt(c[0], 10);
      const h = parseFloat((c[2] || '').replace(',', '.'));
      if (Number.isFinite(idx) && Number.isFinite(h)) thick.set(idx, h);
    }
    expect(thick.size).toBe(10);
    for (const s of SPECS) {
      expect(thick.get(s.index!), `${s.fileName}`).toBeCloseTo(s.geometry.hcp, 6);
    }
  });

  it('σ = N/(h·b) и ε = Δl/l₀ покоординатно', () => {
    for (const { s, r } of SPECS.map((s, i) => ({ s, r: RESULTS[i] }))) {
      const area = s.geometry.hcp * s.geometry.b0;
      for (let i = 0; i < r.dl.length; i++) {
        expect(r.eps[i]).toBeCloseTo(r.dl[i] / s.geometry.l0, 12);
        expect(r.sigma[i]).toBeCloseTo(r.n[i] / area, 12);
        // сдвиг в (0,0): n[i] = rawN[trimIndex+i] − rawN[trimIndex]
        expect(r.n[i]).toBeCloseTo(s.series.n[r.trimIndex + i] - s.series.n[r.trimIndex], 9);
        expect(r.dl[i]).toBeCloseTo(s.series.dl[r.trimIndex + i] - s.series.dl[r.trimIndex], 9);
      }
    }
  });

  it('σ_max/ε_max/ε@σ_max по формулам', () => {
    for (const { s, r } of SPECS.map((s, i) => ({ s, r: RESULTS[i] }))) {
      const area = s.geometry.hcp * s.geometry.b0;
      const nMax = Math.max(...s.series.n);
      expect(r.nMax).toBeCloseTo(nMax, 12);
      expect(r.sigmaMax).toBeCloseTo(nMax / area, 12);
      expect(r.epsMax).toBeCloseTo(Math.max(...r.eps), 12);
      const iPeak = r.n.indexOf(Math.max(...r.n));
      expect(r.epsAtSigmaMax).toBeCloseTo(r.eps[iPeak], 12);
      // точка пика лежит внутри обрезанного ряда
      const iRawPeak = s.series.n.indexOf(nMax);
      expect(iRawPeak).toBeGreaterThanOrEqual(r.trimIndex);
      expect(iRawPeak).toBeLessThanOrEqual(r.endIndex);
    }
  });

  it('фит участка совпадает с независимым МНК', () => {
    for (const r of RESULTS) {
      const f = naiveFit(r.eps, r.sigma, r.region.i0, r.region.i1);
      expect(r.fit.slope).toBeCloseTo(f.slope, 6);
      expect(r.fit.intercept).toBeCloseTo(f.intercept, 6);
      expect(r.eTan).toBe(r.fit.slope); // E_тан = наклон фита участка
      expect(r.r2).toBeCloseTo(f.r2, 9);
      expect(r.r2).toBeGreaterThanOrEqual(0);
      expect(r.r2).toBeLessThanOrEqual(1 + 1e-9);
      // согласованность двух реализаций: префиксные суммы vs прямой подсчёт
      const g = regionFit(r.eps, r.sigma, r.region.i0, r.region.i1);
      expect(g.slope).toBeCloseTo(r.fit.slope, 9);
      expect(g.r2).toBeCloseTo(r.r2, 9);
    }
  });

  it('участок в предпиковой области и якорится у начала кривой', () => {
    for (const r of RESULTS) {
      const iPeak = r.sigma.indexOf(Math.max(...r.sigma));
      expect(r.region.i0).toBeGreaterThanOrEqual(0);
      expect(r.region.i0).toBeLessThan(r.region.i1);
      expect(r.region.i1).toBeLessThanOrEqual(iPeak);
      // ALG-2 ищет упругий участок от начала σ(ε), допуск toe — первые ~5% точек
      expect(r.region.i0).toBeLessThanOrEqual(Math.max(10, Math.floor(iPeak * 0.1)));
    }
  });

  it('ALG-2 берёт ПЕРВЫЙ линейный участок, а не длинное плато', () => {
    // билинейная кривая: крутой упругий участок (E≈2000, ~10 точек),
    // затем длинное пологое плато (E≈20, ~290 точек) — старый критерий
    // «самое длинное линейное окно» ошибочно выбирал плато
    const dl: number[] = [];
    const n: number[] = [];
    for (let i = 0; i <= 300; i++) {
      const d = (i / 300) * 3; // Δl 0→3 мм, ε 0→0.03
      dl.push(d);
      n.push(d < 0.1 ? 200 * d : 20 + 2 * (d - 0.1));
    }
    const syn = {
      id: 'syn', fileName: 'syn.csv', label: 'syn', index: null,
      geometry: { l0: 100, b0: 10, hcp: 1 }, meta: {}, declaredMaxLoad: null,
      series: { t: dl.map((_, i) => i * 0.01), dl, n },
    };
    const r = compute(syn, { ...DEFAULT_OPTS, tailK: 0.99 });
    // участок заканчивается в районе перегиба (ε≈0.001), а не на плато (ε→0.03)
    expect(r.eps[r.region.i1]).toBeLessThan(0.005);
    expect(r.eTan).toBeGreaterThan(1000); // модуль упругого участка, не плато
  });

  it('секущие = σ/ε в точках границ (с пропуском ε=0)', () => {
    for (const r of RESULTS) {
      const j1 = secIdx(r.eps, r.region.i0, 1);
      const j2 = secIdx(r.eps, r.region.i1, -1);
      expect(r.eSec1).toBeCloseTo(r.sigma[j1] / r.eps[j1], 9);
      expect(r.eSec2).toBeCloseTo(r.sigma[j2] / r.eps[j2], 9);
      expect(r.eSec1).toBeGreaterThan(0);
      expect(r.eSec2).toBeGreaterThan(0);
    }
  });

  it('все ключевые величины конечны и разумны', () => {
    for (const [i, r] of RESULTS.entries()) {
      for (const v of [r.sigmaMax, r.epsMax, r.epsAtSigmaMax, r.eTan, r.eSec1, r.eSec2, r.r2, r.nTr])
        expect(Number.isFinite(v), `${FILES[i]}`).toBe(true);
      expect(r.sigmaMax).toBeGreaterThan(0);
      expect(r.epsMax).toBeGreaterThan(0);
      expect(r.epsAtSigmaMax).toBeLessThanOrEqual(r.epsMax + 1e-12);
      expect(r.trimIndex).toBeLessThanOrEqual(r.endIndex);
      expect(r.dl.length).toBe(r.endIndex - r.trimIndex + 1);
    }
  });

  it('compute детерминирован', () => {
    for (const s of SPECS.slice(0, 3)) {
      const a = compute(s), b = compute(s);
      expect(a).toEqual(b);
    }
  });

  it('applyManualTrim на авто-границах даёт тот же расчёт', () => {
    const s = SPECS[0];
    const r = compute(s);
    const m = applyManualTrim(s, DEFAULT_OPTS, r.trimIndex, r.endIndex);
    for (const k of ['sigmaMax', 'epsMax', 'epsAtSigmaMax', 'eTan', 'eSec1', 'eSec2', 'r2'] as const)
      expect(m[k]).toBeCloseTo(r[k], 12);
    expect(m.region).toEqual(r.region);
    expect(m.manualTrim).toBe(true);
    expect(r.manualTrim).toBeFalsy();
  });

  it('applyManualTrim: порядок границ и кламп к ряду', () => {
    const s = SPECS.find((x) => x.series.n.length > 40)!;
    const last = s.series.n.length - 1;
    const hi = Math.min(30, last), lo = 10;
    const a = applyManualTrim(s, DEFAULT_OPTS, hi, lo); // перепутаны
    expect(a.trimIndex).toBe(lo);
    expect(a.endIndex).toBe(hi);
    const b = applyManualTrim(s, DEFAULT_OPTS, -50, last + 500); // за пределами
    expect(b.trimIndex).toBe(0);
    expect(b.endIndex).toBe(last);
  });

  it('applyManualRegion совпадает с независимым МНК', () => {
    const r = RESULTS[0];
    const i0 = 3, i1 = Math.min(15, r.eps.length - 1);
    const m = applyManualRegion(r, r.eps[i0], r.eps[i1]);
    const f = naiveFit(r.eps, r.sigma, i0, i1);
    expect(m.region).toEqual({ i0, i1 });
    expect(m.eTan).toBeCloseTo(f.slope, 9);
    expect(m.r2).toBeCloseTo(f.r2, 9);
    // границы за пиком разрешены — проверяем что не падает и конечно
    const iPeak = r.sigma.indexOf(Math.max(...r.sigma));
    const m2 = applyManualRegion(r, r.eps[iPeak], r.eps[r.eps.length - 1]);
    expect(Number.isFinite(m2.eTan)).toBe(true);
  });

  it('regionFit устойчив к вырожденным данным', () => {
    // константный x: знаменатель = 0 — раньше давал NaN
    const f = regionFit([1, 1, 1, 1], [2, 3, 4, 5], 0, 3);
    expect(Number.isFinite(f.slope)).toBe(true);
    expect(Number.isFinite(f.r2)).toBe(true);
  });
});
