import { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { Figure } from '../core/figures';
import { applyManualRegion, applyManualTrim } from '../core/calc';
import type { CalcOptions, SpecimenRow } from '../core/types';
import { fmt } from '../utils';

const CONFIG = {
  displaylogo: false,
  responsive: true,
  scrollZoom: true,
  // drag на полотне = панорама (иначе рамка зума/выделения путается с перетаскиванием границ)
  modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d'],
};

interface Geom { l: number; t: number; w: number; h: number; r: [number, number]; }

const clampI = (v: number, xs: number[], i: number) => Math.min(Math.max(v, xs[0]), xs[i]);

/**
 * Общий редактор двух границ на графике: ручки + поля + черновое применение
 * (изменения уходят наружу только по «Применить»/Enter).
 */
export function BoundsEditor({
  figure,
  xs,
  bounds,
  unitK,
  unitLabel,
  title,
  preview,
  onApply,
  onReset,
  onDone,
}: {
  figure: Figure;
  xs: number[]; // ось абсцисс данных — для клампа ручек
  bounds: [number, number]; // применённые границы в единицах xs
  unitK: number; // множитель для отображения в полях (ε→% = 100, мм = 1)
  unitLabel: string;
  title: React.ReactNode;
  preview: (a: number, b: number) => React.ReactNode;
  onApply: (a: number, b: number) => void;
  onReset: () => void;
  onDone: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<Geom | null>(null);
  const [draft, setDraft] = useState<[number, number]>(bounds);
  const drag = useRef<0 | 1 | null>(null);

  // синхронизация полей с применённым результатом
  useEffect(() => setDraft(bounds), [bounds[0], bounds[1]]);

  const readGeom = () => {
    const gd = host.current as any;
    const sz = gd?._fullLayout?._size;
    const rng = gd?._fullLayout?.xaxis?.range;
    if (sz && rng) setGeom({ l: sz.l, t: sz.t, w: sz.w, h: sz.h, r: rng as [number, number] });
  };

  useEffect(() => {
    const gd = host.current as any;
    if (!gd) return;
    let alive = true;
    Promise.resolve(
      Plotly.react(
        gd,
        figure.data,
        { ...figure.layout, uirevision: 'bounds-edit', dragmode: 'pan' },
        CONFIG,
      ),
    ).then(() => {
      if (!alive) return;
      readGeom();
      // перечитываем геометрию после зума/пана — иначе ручки уедут;
      // подписываться можно только после инициализации graph-div
      gd.removeListener?.('plotly_relayout', readGeom);
      gd.on?.('plotly_relayout', readGeom);
    });
    const ro = new ResizeObserver(readGeom);
    ro.observe(gd);
    return () => {
      alive = false;
      gd.removeListener?.('plotly_relayout', readGeom);
      ro.disconnect();
    };
  }, [figure]);

  const px = (e: number) => (geom ? geom.l + ((e - geom.r[0]) / (geom.r[1] - geom.r[0])) * geom.w : 0);
  const xAt = (p: number) =>
    geom ? geom.r[0] + ((p - geom.l) / geom.w) * (geom.r[1] - geom.r[0]) : 0;

  const startDrag = (which: 0 | 1) => (e: React.PointerEvent) => {
    drag.current = which;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag.current === null || !host.current || !geom) return;
    const rect = host.current.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - rect.left, geom.l), geom.l + geom.w);
    const v = clampI(xAt(x), xs, xs.length - 1);
    setDraft((d) => {
      const n: [number, number] = [...d];
      n[drag.current!] = v;
      return n;
    });
  };
  // применяем сразу на отпускании ручки / Enter / blur — без кнопки «Применить»
  const commit = (d: [number, number]) => {
    const [a, b] = d;
    if (Math.abs(b - a) > 1e-12) onApply(Math.min(a, b), Math.max(a, b));
  };
  const endDrag = () => {
    if (drag.current === null) return;
    drag.current = null;
    commit(draft);
  };

  const num = (v: number) => (v * unitK).toFixed(unitK === 100 ? 3 : 2);
  const setBound = (which: 0 | 1, text: string) => {
    const v = parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(v)) return;
    setDraft((d) => {
      const n: [number, number] = [...d];
      n[which] = clampI(v / unitK, xs, xs.length - 1);
      return n;
    });
  };

  const lo = Math.min(draft[0], draft[1]);
  const hi = Math.max(draft[0], draft[1]);
  const bx = (e: number) => (geom ? Math.min(Math.max(px(e) - geom.l, 0), geom.w) : 0);
  const hx = (e: number) => (geom ? Math.min(Math.max(px(e) - geom.l - 7, -7), geom.w - 7) : 0);

  return (
    <div
      className="region-panel"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDone();
      }}
    >
      <div className="region-title">{title}</div>
      <div className="region-wrap">
        <div ref={host} className="region-plot" />
        {geom && (
          <div
            className="region-overlay"
            style={{ left: geom.l, top: geom.t, width: geom.w, height: geom.h }}
          >
            <div
              className="region-band"
              style={{ left: bx(lo), width: Math.max(bx(hi) - bx(lo), 2), top: 0, height: geom.h }}
            />
            {[0, 1].map((i) => (
              <div
                key={i}
                className="region-handle"
                style={{ left: hx(draft[i]), top: 0, height: geom.h }}
                onPointerDown={startDrag(i as 0 | 1)}
                onPointerMove={onMove}
                onPointerUp={endDrag}
                title="Потяните, чтобы сдвинуть границу"
              >
                <div className="region-grip" />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="region-controls">
        <label>
          {unitLabel}₀{' '}
          <input
            defaultValue={num(draft[0])}
            key={`a${bounds[0]}`} // перемонтирование только при смене применённого значения — не теряем фокус при вводе
            onChange={(e) => setBound(0, e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => e.key === 'Enter' && commit(draft)}
          />
        </label>
        <label>
          {unitLabel}₁{' '}
          <input
            defaultValue={num(draft[1])}
            key={`b${bounds[1]}`}
            onChange={(e) => setBound(1, e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => e.key === 'Enter' && commit(draft)}
          />
        </label>
        <span className="region-preview">{preview(lo, hi)}</span>
        <span className="exp-actions">
          <button className="ghost" onClick={onReset}>Авто</button>
        </span>
      </div>
    </div>
  );
}

/** Редактор линейного участка (ε, %) */
export function RegionEditorPanel({
  figure,
  row,
  onApply,
  onReset,
  onDone,
}: {
  figure: Figure;
  row: SpecimenRow;
  onApply: (eps0: number, eps1: number) => void;
  onReset: () => void;
  onDone: () => void;
}) {
  const r = row.r;
  const preview = useMemo(() => {
    return (a: number, b: number) => {
      const p = applyManualRegion(r, a, b);
      return (
        <>
          E_тан = {fmt(p.eTan, 1)} МПа · R² = {p.r2.toFixed(4)}
        </>
      );
    };
  }, [r]);
  return (
    <BoundsEditor
      figure={figure}
      xs={r.eps}
      bounds={[r.eps[r.region.i0], r.eps[r.region.i1]]}
      unitK={100}
      unitLabel="ε, % "
      title={
        <>
          Линейный участок — {row.s.label}
          {r.manual && <span className="manual-tag">✎ задан вручную</span>}
        </>
      }
      preview={preview}
      onApply={onApply}
      onReset={() => { onReset(); onDone(); }}
      onDone={onDone}
    />
  );
}

/** Редактор границ обрезки (Δl, мм) — по сырой кривой */
export function TrimEditorPanel({
  figure,
  row,
  opts,
  onApply,
  onReset,
  onDone,
}: {
  figure: Figure;
  row: SpecimenRow;
  opts: CalcOptions;
  onApply: (i0: number, i1: number) => void;
  onReset: () => void;
  onDone: () => void;
}) {
  const { s, r } = row;
  const dl = s.series.dl;
  const nearest = (v: number) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < dl.length; i++) {
      const d = Math.abs(dl[i] - v);
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  };
  const preview = (a: number, b: number) => {
    const i0 = nearest(a), i1 = Math.max(nearest(b), i0 + 1);
    const p = applyManualTrim(s, opts, i0, i1);
    return (
      <>
        σ_max = {fmt(p.sigmaMax, 2)} МПа · ε_max = {(p.epsMax * 100).toFixed(1)}% · {p.dl.length} тч.
      </>
    );
  };
  return (
    <BoundsEditor
      figure={figure}
      xs={dl}
      bounds={[dl[r.trimIndex], dl[r.endIndex]]}
      unitK={1}
      unitLabel="Δl, мм "
      title={
        <>
          Обрезка данных — {row.s.label}
          {r.manualTrim && <span className="manual-tag">✎ задана вручную</span>}
        </>
      }
      preview={preview}
      onApply={(a, b) => onApply(nearest(a), Math.max(nearest(b), nearest(a) + 1))}
      onReset={() => { onReset(); onDone(); }}
      onDone={onDone}
    />
  );
}
