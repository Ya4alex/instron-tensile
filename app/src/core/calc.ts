import type { CalcOptions, CalcResult, Specimen } from './types';

export const DEFAULT_OPTS: CalcOptions = {
  trimK: 0.005, tailK: 0.25, r2Min: 0.99, winFrac: 0.1, slopeFrac: 0.7,
  algo: 'steepest', epsSec0: 0.0005, epsSec1: 0.0025,
};

/** Максимум массива циклом — спред Math.max(...xs) падает на >~100 тыс. точек */
const amax = (xs: number[]): number => {
  let m = -Infinity;
  for (let i = 0; i < xs.length; i++) if (xs[i] > m) m = xs[i];
  return m;
};

/** Среднее арифметическое (2.7) */
export const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

/** СКО по методичке (2.8): деление на n */
export const std = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
};

/**
 * Линейная регрессия на префиксных суммах для окна [i0, i1] включительно.
 * Возвращает { slope, intercept, r2 }.
 */
function windowFit(px: number[], py: number[], pxy: number[], px2: number[], py2: number[], i0: number, i1: number) {
  const n = i1 - i0 + 1;
  const sx = px[i1 + 1] - px[i0];
  const sy = py[i1 + 1] - py[i0];
  const sxy = pxy[i1 + 1] - pxy[i0];
  const sx2 = px2[i1 + 1] - px2[i0];
  const sy2 = py2[i1 + 1] - py2[i0];
  const denom = n * sx2 - sx * sx;
  const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  const intercept = (sy - slope * sx) / n;
  const rden = denom * (n * sy2 - sy * sy);
  const r2 = rden > 0 ? ((n * sxy - sx * sy) ** 2) / rden : 0;
  return { slope, intercept, r2 };
}

/** ALG-1: индекс первой точки с N >= порога */
function findTrimIndex(n: number[], nTr: number): number {
  for (let i = 0; i < n.length; i++) if (n[i] >= nTr) return i;
  return n.length - 1;
}

/** ALG-2: выбор линейного участка σ(ε) для E_tan — три стратегии (opts.algo).
 *  'first'    — первый непрерывно-линейный отрезок от начала кривой (основной).
 *  'steepest' — самый крутой непрерывно-линейный отрезок до пика (toe-зоны).
 *  'secant'   — хорда между заданными деформациями epsSec0..epsSec1 (ISO 527,
 *               для J-образных кривых без выраженного линейного участка).
 *  Общая механика 'first'/'steepest': окно растёт от старта i0, пока
 *  r2 >= r2Min и наклон >= slopeFrac·ref(i0); стоп — при серии из 3
 *  провалов подряд (выброс переживаем, перегиб ловим; сканировать за
 *  провалом нельзя — R² длинного окна после перегиба восстанавливается).
 *  'first' дополнительно требует slopeFrac·G (G — макс. начальный наклон):
 *  позднее плато идеально линейно, но пологое → ворота отсекают.
 *  Fallback: тот же рост с ослабленным R², затем — минимальное окно. */
function findLinearRegion(
  eps: number[],
  sigma: number[],
  iPeak: number,
  opts: CalcOptions,
): { i0: number; i1: number; slope: number; intercept: number; r2: number } {
  const end = Math.min(iPeak, sigma.length - 1);
  const m = end + 1;
  const px = new Array(m + 1).fill(0),
    py = new Array(m + 1).fill(0),
    pxy = new Array(m + 1).fill(0),
    px2 = new Array(m + 1).fill(0),
    py2 = new Array(m + 1).fill(0);
  for (let i = 0; i < m; i++) {
    px[i + 1] = px[i] + eps[i];
    py[i + 1] = py[i] + sigma[i];
    pxy[i + 1] = pxy[i] + eps[i] * sigma[i];
    px2[i + 1] = px2[i] + eps[i] * eps[i];
    py2[i + 1] = py2[i] + sigma[i] * sigma[i];
  }
  const minW = Math.min(Math.max(5, Math.ceil(opts.winFrac * m)), m);
  const toeMax = Math.min(Math.floor(m * 0.05), 10);
  const baseW = Math.min(5, m);
  const fit = (a: number, b: number) => windowFit(px, py, pxy, px2, py2, a, b);

  // локальный референсный наклон от i0 — самый крутой короткий отрезок
  const refSlope = (i0: number): number => {
    let ref = 0;
    for (let k = baseW; k <= minW && i0 + k - 1 <= end; k++) {
      const s = fit(i0, i0 + k - 1).slope;
      if (s > ref) ref = s;
    }
    return ref;
  };

  // рост окна от i0: пока r2 и наклон в допуске; стоп при СЕРИИ провалов
  // (одиночный выброс не обрывает участок, истинный перегиб — обрывает;
  // сканировать дальше нельзя — R² длинного окна после перегиба
  // восстанавливается и «перескочит» на следующий участок)
  const grow = (i0: number, r2Need: number, minSlope: number): number => {
    let last = -1;
    let failRun = 0;
    for (let i1 = i0 + baseW - 1; i1 <= end; i1++) {
      const f = fit(i0, i1);
      if (f.r2 >= r2Need && f.slope >= minSlope) {
        last = i1;
        failRun = 0;
      } else if (++failRun >= 3) break;
    }
    return last;
  };

  const degenerate = () => {
    const i1 = Math.min(minW - 1, end);
    return { i0: 0, i1, ...fit(0, i1) };
  };
  const r2Loose = Math.min(opts.r2Min - 0.02, 0.95);

  // --- секущий модуль: хорда между заданными деформациями (ISO 527) ---
  if (opts.algo === 'secant') {
    const near = (e: number): number => {
      let b = 0;
      for (let i = 1; i <= end; i++) if (Math.abs(eps[i] - e) < Math.abs(eps[b] - e)) b = i;
      return b;
    };
    let i0 = near(Math.min(opts.epsSec0, opts.epsSec1));
    let i1 = near(Math.max(opts.epsSec0, opts.epsSec1));
    if (i1 <= i0) {
      i1 = Math.min(i0 + 1, end);
      i0 = Math.max(i1 - 1, 0);
    }
    const f = fit(i0, i1);
    const dE = eps[i1] - eps[i0];
    const slope = dE !== 0 ? (sigma[i1] - sigma[i0]) / dE : f.slope;
    return { i0, i1, slope, intercept: sigma[i0] - slope * eps[i0], r2: f.r2 };
  }

  // --- самый крутой участок: макс. наклон среди непрерывно-линейных окон ---
  if (opts.algo === 'steepest') {
    for (const r2Need of [opts.r2Min, r2Loose]) {
      let best: { i0: number; i1: number; slope: number; intercept: number; r2: number } | null = null;
      for (let i0 = 0; i0 + baseW - 1 <= end; i0++) {
        const ref = refSlope(i0);
        const last = grow(i0, r2Need, ref > 0 ? ref * opts.slopeFrac : 0);
        if (last < i0 + baseW - 1) continue;
        const f = fit(i0, last);
        if (!best || f.slope > best.slope) best = { i0, i1: last, ...f };
      }
      if (best) return best;
    }
    return degenerate();
  }

  // --- 'first': первый линейный участок от начала кривой ---
  // G — модуль упругого участка: максимальный наклон в начальной зоне.
  // Ворота slopeFrac·G отсекают поздние пологие участки (плато текучести
  // идеально линейно, но его наклон далёк от упругого → не пройдёт).
  let G = 0;
  for (let i0 = 0; i0 <= toeMax && i0 + baseW - 1 <= end; i0++) {
    const s = refSlope(i0);
    if (s > G) G = s;
  }
  const gMin = G * opts.slopeFrac;

  // самый ранний i0, чей участок непрерывно-линеен и имеет упругий наклон
  const pass = (r2Need: number) => {
    for (let i0 = 0; i0 <= toeMax && i0 + baseW - 1 <= end; i0++) {
      const ref = refSlope(i0);
      const last = grow(i0, r2Need, ref > 0 ? ref * opts.slopeFrac : 0);
      if (last < i0 + baseW - 1) continue;
      const f = fit(i0, last);
      if (f.slope >= gMin) return { i0, i1: last, ...f };
    }
    return null;
  };

  // строгий проход → ослабленный R² → вырожденный fallback
  return pass(opts.r2Min) ?? pass(r2Loose) ?? degenerate();
}

/** МНК + R² по диапазону индексов [i0, i1] включительно */
export function regionFit(
  eps: number[],
  sigma: number[],
  i0: number,
  i1: number,
): { slope: number; intercept: number; r2: number } {
  const n = i1 - i0 + 1;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
  for (let i = i0; i <= i1; i++) {
    sx += eps[i]; sy += sigma[i];
    sxy += eps[i] * sigma[i]; sx2 += eps[i] * eps[i]; sy2 += sigma[i] * sigma[i];
  }
  const denom = n * sx2 - sx * sx;
  const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  const intercept = (sy - slope * sx) / n;
  const rden = denom * (n * sy2 - sy * sy);
  const r2 = rden > 0 ? ((n * sxy - sx * sy) ** 2) / rden : 0;
  return { slope, intercept, r2 };
}

/**
 * Ручная коррекция линейного участка: eps0/eps1 — желаемые границы по оси ε
 * (в отн. ед., любой порядок). Границы за пределами пика разрешены.
 * Пересчитывает E_тан, R², секущие; помечает результат manual.
 */
export function applyManualRegion(r: CalcResult, eps0: number, eps1: number): CalcResult {
  if (eps0 > eps1) [eps0, eps1] = [eps1, eps0];
  const { eps, sigma } = r;
  const nearest = (v: number) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < eps.length; i++) {
      const d = Math.abs(eps[i] - v);
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  };
  const i0 = nearest(eps0);
  const i1 = Math.max(nearest(eps1), i0 + 1); // минимум 2 точки
  const f = regionFit(eps, sigma, i0, i1);
  const sec = (from: number, dir: 1 | -1) => {
    for (let i = from; i >= 0 && i < eps.length; i += dir)
      if (eps[i] !== 0) return sigma[i] / eps[i];
    return NaN;
  };
  return {
    ...r,
    region: { i0, i1 },
    fit: { slope: f.slope, intercept: f.intercept },
    eTan: f.slope,
    eSec1: sec(i0, 1),
    eSec2: sec(i1, -1),
    r2: f.r2,
    manual: true,
  };
}

/** Общий путь после выбора границ обрезки: сдвиг в (0,0), ε/σ, участок, модули */
function finish(
  s: Specimen,
  opts: CalcOptions,
  trimIndex: number,
  endIndex: number,
  nTr: number,
  manualTrim: boolean,
): CalcResult {
  const { dl: dlRaw, n: nRaw } = s.series;
  const { l0, b0, hcp } = s.geometry;
  const area = hcp * b0;
  const nMaxAll = amax(nRaw);

  const dl = dlRaw.slice(trimIndex, endIndex + 1).map((v) => v - dlRaw[trimIndex]);
  const n = nRaw.slice(trimIndex, endIndex + 1).map((v) => v - nRaw[trimIndex]);

  let iPeak = 0;
  for (let i = 1; i < n.length; i++) if (n[i] > n[iPeak]) iPeak = i;

  const eps = dl.map((v) => v / l0);
  const sigma = n.map((v) => v / area);

  const region = findLinearRegion(eps, sigma, iPeak, opts);
  // секущий модуль из начала координат: идём от границы к первой точке с ε>0
  const sec = (from: number, dir: 1 | -1) => {
    for (let i = from; i >= 0 && i < eps.length; i += dir)
      if (eps[i] !== 0) return sigma[i] / eps[i];
    return NaN;
  };

  return {
    trimIndex,
    endIndex,
    nTr,
    dl,
    n,
    eps,
    sigma,
    nMax: nMaxAll, // σ_max по сырой силе разрыва (2.3), не по сбалансированной кривой
    sigmaMax: nMaxAll / area,
    epsMax: amax(eps),
    epsAtSigmaMax: eps[iPeak],
    region: { i0: region.i0, i1: region.i1 },
    fit: { slope: region.slope, intercept: region.intercept },
    eTan: region.slope,
    eSec1: sec(region.i0, 1),
    eSec2: sec(region.i1, -1),
    r2: region.r2,
    manualTrim,
  };
}

export function compute(s: Specimen, opts: CalcOptions = DEFAULT_OPTS): CalcResult {
  const { n: nRaw } = s.series;
  const nMaxAll = amax(nRaw);
  const nTr = opts.trimK * nMaxAll;
  const trimIndex = findTrimIndex(nRaw, nTr);

  // сдвинутая сила для поиска пика и хвоста
  const n0 = nRaw[trimIndex];
  const n = nRaw.slice(trimIndex).map((v) => v - n0);
  let iPeak = 0;
  for (let i = 1; i < n.length; i++) if (n[i] > n[iPeak]) iPeak = i;

  // ALG-1b: обрезка хвоста — с конца ряда назад до последней точки с N >= tailK·N_peak.
  // Машина после разрыва останавливается вручную → за пиком идёт «пустой» хвост.
  const nTail = opts.tailK * Math.max(n[iPeak], 0);
  let iEnd = n.length - 1;
  while (iEnd > iPeak && n[iEnd] < nTail) iEnd--;
  iEnd = Math.min(iEnd + 1, n.length - 1); // +1 точка — показать спад при разрыве

  return finish(s, opts, trimIndex, trimIndex + iEnd, nTr, false);
}

/**
 * Ручная обрезка: i0/i1 — границы в индексах сырого ряда (любой порядок).
 * Дальше тот же путь, что и у авто-обрезки; результат помечается manualTrim.
 */
export function applyManualTrim(
  s: Specimen,
  opts: CalcOptions,
  i0: number,
  i1: number,
): CalcResult {
  const last = s.series.n.length - 1;
  const lo = Math.min(Math.round(i0), Math.round(i1));
  const hi = Math.max(Math.round(i0), Math.round(i1));
  const endIndex = Math.min(Math.max(hi, 1), last);
  const trimIndex = Math.min(Math.max(lo, 0), endIndex - 1);
  const nTr = opts.trimK * amax(s.series.n);
  return finish(s, opts, trimIndex, endIndex, nTr, true);
}
