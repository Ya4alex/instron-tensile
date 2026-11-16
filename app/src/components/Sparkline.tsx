export function Sparkline({ x, y, w = 120, h = 32 }: { x: number[]; y: number[]; w?: number; h?: number }) {
  if (!x.length) return null;
  // min/max циклом — спред Math.min(...xs) падает на длинных рядах
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < x.length; i++) {
    if (x[i] < minX) minX = x[i];
    if (x[i] > maxX) maxX = x[i];
    if (y[i] < minY) minY = y[i];
    if (y[i] > maxY) maxY = y[i];
  }
  const sx = (v: number) => ((v - minX) / (maxX - minX || 1)) * (w - 4) + 2;
  const sy = (v: number) => h - 3 - ((v - minY) / (maxY - minY || 1)) * (h - 6);
  const pts = x.map((v, i) => `${sx(v).toFixed(1)},${sy(y[i]).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} className="sparkline">
      <polyline points={pts} fill="none" stroke="#1f5fb4" strokeWidth="1.2" />
    </svg>
  );
}
