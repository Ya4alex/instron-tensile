export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const fmt = (v: number | undefined, d = 3): string =>
  v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d);

/** Число для русского Excel: десятичная запятая */
export const csvNum = (v: number | undefined, d = 4): string =>
  v === undefined || !Number.isFinite(v) ? '' : v.toFixed(d).replace('.', ',');

export const pct = (v: number | undefined): string => fmt(v === undefined ? v : v * 100, 1);
