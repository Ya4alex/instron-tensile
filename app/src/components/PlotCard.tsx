import { useEffect, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { Figure } from '../core/figures';
import { download } from '../utils';

const EXPORT_W = 1000,
  EXPORT_H = 640;

export function PlotCard({
  figure,
  eager = false,
  editor,
  editLabel = '✎ участок',
}: {
  figure: Figure;
  eager?: boolean;
  editor?: (done: () => void) => React.ReactNode;
  editLabel?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(eager);
  const [zoomed, setZoomed] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const down = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (eager) return;
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => es.some((e) => e.isIntersecting) && setMounted(true),
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [eager]);

  useEffect(() => {
    if (!mounted || !host.current) return;
    // в миниатюрах прячем заголовок/легенду/аннотации, modebar и интерактив —
    // в экспорте и подробном просмотре всё видно
    const layout = eager
      ? figure.layout
      : { ...figure.layout, title: { text: '' }, showlegend: false, annotations: [], dragmode: false };
    Plotly.react(host.current, figure.data, layout, {
      displaylogo: false,
      responsive: true,
      displayModeBar: eager,
      scrollZoom: eager,
      doubleClick: eager ? 'reset' : false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'],
    });
  }, [mounted, figure, eager]);

  // перерисовка при изменении размера контейнера (сплит-панели, сайдбары)
  useEffect(() => {
    if (!mounted || !host.current) return;
    const ro = new ResizeObserver(() => {
      if (host.current) Plotly.Plots.resize(host.current);
    });
    ro.observe(host.current);
    return () => ro.disconnect();
  }, [mounted]);

  const figForExport = () => ({
    data: figure.data,
    layout: { ...figure.layout, width: EXPORT_W, height: EXPORT_H, autosize: false },
  });

  const outName = figure.fileName ?? figure.name;
  const exportSvg = async () => {
    const url = await Plotly.toImage(figForExport(), { format: 'svg', width: EXPORT_W, height: EXPORT_H });
    download(await (await fetch(url)).blob(), `${outName}.svg`);
  };
  const exportPng = async () => {
    const url = await Plotly.toImage(figForExport(), { format: 'png', width: EXPORT_W, height: EXPORT_H, scale: 3 });
    download(await (await fetch(url)).blob(), `${outName}.png`);
  };
  const copyPng = async () => {
    const url = await Plotly.toImage(figForExport(), { format: 'png', width: EXPORT_W, height: EXPORT_H, scale: 3 });
    const blob = await (await fetch(url)).blob();
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {
      download(blob, `${outName}.png`);
    }
  };

  // Esc закрывает подробный просмотр / выходит из редактирования
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (editMode) setEditMode(false);
      else setZoomed(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [zoomed, editMode]);

  // редактируемые графики открываются сразу в режиме редактирования
  const open = () => {
    setEditMode(!!editor);
    setZoomed(true);
  };

  return (
    <div className="plot-card" ref={box}>
      <div className="plot-head">
        <span className="plot-title">{figure.title}</span>
        <span className="plot-actions">
          {editor && !eager && (
            <button onClick={() => { setEditMode(true); setZoomed(true); }} title={editLabel}>
              ✎
            </button>
          )}
          {!eager && <button onClick={open} title="Подробный просмотр">⤢</button>}
          <button onClick={exportSvg} title="SVG (вектор)">SVG</button>
          <button onClick={exportPng} title="PNG 600 dpi">PNG</button>
          <button onClick={copyPng} title="Копировать PNG в буфер">⧉</button>
        </span>
      </div>
      <div
        ref={host}
        className="plot-body"
        onPointerDown={(e) => {
          down.current = { x: e.clientX, y: e.clientY };
        }}
        onClick={(e) => {
          if (eager || !down.current) return;
          const dx = e.clientX - down.current.x;
          const dy = e.clientY - down.current.y;
          if (dx * dx + dy * dy < 36) open(); // только короткий клик
        }}
      >
        {!mounted && <div className="plot-placeholder">…</div>}
      </div>
      {zoomed && (
        <div className="modal" onClick={() => setZoomed(false)}>
          <div className="modal-inner" onClick={(e) => e.stopPropagation()}>
            <div className="modal-bar">
              <span className="modal-title">{figure.title}</span>
              {editor && (
                <button onClick={() => setEditMode((m) => !m)}>
                  {editMode ? '← просмотр' : editLabel}
                </button>
              )}
              <button className="modal-x" onClick={() => setZoomed(false)}>✕</button>
            </div>
            <div className="modal-body">
              {editMode && editor ? (
                editor(() => setEditMode(false))
              ) : (
                <PlotCard figure={figure} eager />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
