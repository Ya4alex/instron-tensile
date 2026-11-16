import type { SpecimenRow } from './types';

export interface Col {
  key: string;
  title: string;
  get: (r: SpecimenRow) => number;
  d?: number;
  isPct?: boolean;
}

export const COLS: Col[] = [
  { key: 'l0', title: 'l₀, мм', get: ({ s }) => s.geometry.l0, d: 2 },
  { key: 'b0', title: 'b₀, мм', get: ({ s }) => s.geometry.b0, d: 2 },
  { key: 'hcp', title: 'h_ср, мм', get: ({ s }) => s.geometry.hcp, d: 3 },
  { key: 'nMax', title: 'N_max, Н', get: ({ r }) => r.nMax, d: 3 },
  { key: 'sigmaMax', title: 'σ_max, МПа', get: ({ r }) => r.sigmaMax, d: 3 },
  { key: 'epsMax', title: 'ε_max, %', get: ({ r }) => r.epsMax, isPct: true },
  { key: 'epsAtSigmaMax', title: 'ε@σ_max, %', get: ({ r }) => r.epsAtSigmaMax, isPct: true },
  { key: 'eTan', title: 'E_тан, МПа', get: ({ r }) => r.eTan, d: 1 },
  { key: 'eSec1', title: 'E_сек1, МПа', get: ({ r }) => r.eSec1, d: 1 },
  { key: 'eSec2', title: 'E_сек2, МПа', get: ({ r }) => r.eSec2, d: 1 },
];
