export interface RawSeries {
  t: number[]; // время, s
  dl: number[]; // удлинение, mm
  n: number[]; // сила, N
}

export interface Geometry {
  l0: number; // длина (база), mm
  b0: number; // ширина, mm
  hcp: number; // толщина средняя, mm
}

export interface Specimen {
  id: string;
  fileName: string;
  label: string; // редактируемая метка
  index: number | null; // номер образца из имени файла
  geometry: Geometry;
  meta: Record<string, string>;
  declaredMaxLoad: number | null; // контрольное «Максимум Нагрузка» из шапки
  series: RawSeries;
  error?: string;
}

export interface CalcResult {
  trimIndex: number; // индекс первой оставшейся точки в исходном ряду
  endIndex: number; // индекс последней оставшейся точки в исходном ряду (обрезка хвоста)
  nTr: number; // порог силы, N
  dl: number[]; // обрезанные, сдвинутые в (0,0)
  n: number[];
  eps: number[]; // деформация, отн. ед.
  sigma: number[]; // напряжение, МПа
  nMax: number;
  sigmaMax: number;
  epsMax: number; // макс. деформация (при разрыве), отн. ед.
  epsAtSigmaMax: number; // деформация в точке σ_max, отн. ед.
  region: { i0: number; i1: number }; // границы линейного участка
  fit: { slope: number; intercept: number }; // аппроксимация участка
  eTan: number; // касательный модуль Юнга, МПа
  eSec1: number;
  eSec2: number;
  r2: number; // R² линейного участка
  manual?: boolean; // линейный участок задан вручную (иначе авто-поиск)
  manualTrim?: boolean; // границы обрезки заданы вручную
}

export interface SpecimenRow {
  s: Specimen;
  r: CalcResult;
}

export interface CalcOptions {
  trimK: number; // доля N_max для порога обрезки начала (0.005)
  tailK: number; // доля N_max для порога обрезки хвоста после разрыва (0.25)
  r2Min: number; // минимальный R² линейного участка (0.99)
  winFrac: number; // доля точек для мин. окна (0.10)
  slopeFrac: number; // допустимый спад наклона от начального максимума (0.70)
}
