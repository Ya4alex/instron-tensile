import { useMemo, useRef, useState } from 'react';
import type { Specimen, CalcOptions } from './core/types';
import { parseSpecimenCsv, parseResultsCsv, isResultsCsv } from './core/parse';
import { compute, DEFAULT_OPTS, applyManualRegion, applyManualTrim } from './core/calc';
import { exportAllFigures } from './core/figures';
import { DropZone } from './components/DropZone';
import { ResultsTable, sortRows, type Row, type Sort } from './components/ResultsTable';
import { PlotsSection, scrollToSpecimen } from './components/PlotsSection';
import { ExportDialog } from './components/ExportDialog';

/** Метки должны быть различимы: при повторе — суффикс «·индекс» */
function dedupeLabels(list: Specimen[]) {
  const used = new Set<string>();
  for (const s of list) {
    if (used.has(s.label)) s.label += s.index !== null ? `·${s.index}` : '·2';
    used.add(s.label);
  }
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export default function App() {
  const [specimens, setSpecimens] = useState<Specimen[]>([]);
  const [errors, setErrors] = useState<{ fileName: string; error: string }[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [opts, setOpts] = useState<CalcOptions>(DEFAULT_OPTS);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [ratio, setRatio] = useState(0.7);
  const [optsOpen, setOptsOpen] = useState(false);
  const [showMid, setShowMid] = useState(true);
  const [busyZip, setBusyZip] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sort, setSort] = useState<Sort>(null);
  const [manual, setManualMap] = useState<Map<string, { eps0: number; eps1: number }>>(new Map());
  const [manualTrim, setManualTrimMap] = useState<Map<string, { i0: number; i1: number }>>(new Map());
  const splitRef = useRef<HTMLDivElement>(null);

  const onSort = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: -s.dir as 1 | -1 } : { key, dir: 1 }));

  const addFiles = async (files: File[]) => {
    const parsed: Specimen[] = [];
    const errs: typeof errors = [];
    const regular: File[] = [];
    let resultLabels = new Map<number, string>();
    for (const f of files) {
      if (isResultsCsv(f.name)) resultLabels = parseResultsCsv(new Uint8Array(await f.arrayBuffer()));
      else regular.push(f);
    }
    for (const f of regular) {
      try {
        const s = parseSpecimenCsv(f.name, new Uint8Array(await f.arrayBuffer()));
        if (s.index !== null && resultLabels.has(s.index)) s.label = resultLabels.get(s.index)!;
        parsed.push(s);
      } catch (e) {
        errs.push({ fileName: f.name, error: e instanceof Error ? e.message : String(e) });
      }
    }
    setSpecimens((prev) => {
      const next = [...prev, ...parsed];
      dedupeLabels(next);
      return next;
    });
    setErrors((prev) => [...prev, ...errs]);
  };

  const rows = useMemo<Row[]>(
    () =>
      specimens
        .map((s) => {
          try {
            const tm = manualTrim.get(s.id);
            let r = tm ? applyManualTrim(s, opts, tm.i0, tm.i1) : compute(s, opts);
            const m = manual.get(s.id);
            if (m) r = applyManualRegion(r, m.eps0, m.eps1);
            return { s, r };
          } catch {
            return null;
          }
        })
        .filter((x): x is Row => x !== null),
    [specimens, opts, manual, manualTrim],
  );

  const setManual = (id: string, v: { eps0: number; eps1: number } | null) =>
    setManualMap((m) => {
      const n = new Map(m);
      if (v) n.set(id, v);
      else n.delete(id);
      return n;
    });
  const setManualTrim = (id: string, v: { i0: number; i1: number } | null) =>
    setManualTrimMap((m) => {
      const n = new Map(m);
      if (v) n.set(id, v);
      else n.delete(id);
      return n;
    });
  const displayRows = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const activeRows = useMemo(() => rows.filter((r) => !excluded.has(r.s.id)), [rows, excluded]);

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const setLabel = (id: string, v: string) =>
    setSpecimens((prev) => prev.map((s) => (s.id === id ? { ...s, label: v } : s)));

  const focusSpecimen = (id: string) => {
    scrollToSpecimen(id);
    setFlashId(id);
    setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1300);
  };

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startR = ratio;
    const h = splitRef.current!.getBoundingClientRect().height;
    const move = (ev: MouseEvent) =>
      setRatio(clamp(startR + (ev.clientY - startY) / h, 0.15, 0.8));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const optInput = (key: keyof CalcOptions, step: string, title: string) => (
    <label className="opt" key={key}>
      {title}
      <input
        type="number"
        step={step}
        min="0"
        value={opts[key]}
        onChange={(e) => {
          const v = parseFloat(e.target.value.replace(',', '.'));
          if (Number.isFinite(v)) setOpts((o) => ({ ...o, [key]: v }));
        }}
      />
    </label>
  );

  const loaded = specimens.length > 0;

  return (
    <div className="app">
      {!loaded && (
        <div className="welcome">
          <h1>Обработка испытаний на одноосное растяжение</h1>
          <DropZone onFiles={addFiles} />
        </div>
      )}
      {loaded && (
        <div className="island">
          <span className="counts">
            {rows.length} обр. · {activeRows.length} акт.
            {errors.length > 0 && ` · ${errors.length} ош.`}
          </span>
          <DropZone compact onFiles={addFiles} />
          <label className="mid-toggle" title="Показывать графики 2–3: N(Δl) после обрезки и σ(ε)">
            <input type="checkbox" checked={showMid} onChange={(e) => setShowMid(e.target.checked)} />
            промежуточные
          </label>
          <button
            onClick={async () => {
              setBusyZip(true);
              try {
                await exportAllFigures(activeRows);
              } finally {
                setBusyZip(false);
              }
            }}
            disabled={busyZip || !activeRows.length}
            title="Все графики активных образцов — ZIP с SVG"
          >
            {busyZip ? '…' : 'Графики ZIP'}
          </button>
          <button
            onClick={() => setExportOpen(true)}
            disabled={!activeRows.length}
            title="Настройки экспорта таблиц — CSV / XLSX"
          >
            Экспорт…
          </button>
          <span className="opt-wrap">
            <button onClick={() => setOptsOpen((o) => !o)} title="Параметры обработки">⚙</button>
            {optsOpen && (
              <>
                <div className="pop-overlay" onClick={() => setOptsOpen(false)} />
                <div className="opt-pop">
                {optInput('trimK', '0.001', 'Порог начала')}
                {optInput('tailK', '0.05', 'Порог хвоста')}
                {optInput('r2Min', '0.005', 'R² участка')}
                {optInput('winFrac', '0.01', 'Мин. окно')}
                {optInput('slopeFrac', '0.05', 'Спад наклона')}
                </div>
              </>
            )}
          </span>
          <button
            className="danger"
            onClick={() => {
              if (confirm('Очистить все загруженные данные?')) {
                setSpecimens([]);
                setErrors([]);
                setExcluded(new Set());
              }
            }}
            title="Очистить"
          >
            ✕
          </button>
        </div>
      )}
      {loaded ? (
        <div className="split" ref={splitRef}>
          <div className="pane pane-top" style={{ flex: ratio }}>
            <PlotsSection
              rows={displayRows}
              excluded={excluded}
              onToggle={toggle}
              flashId={flashId}
              onManual={setManual}
              onManualTrim={setManualTrim}
              opts={opts}
              showMid={showMid}
            />
          </div>
          <div className="divider" onMouseDown={startDrag} title="Потяните, чтобы изменить высоту панелей">
            <div className="divider-grip" />
          </div>
          <div className="pane pane-bottom" style={{ flex: 1 - ratio }}>
            <ResultsTable
              rows={displayRows}
              errors={errors}
              excluded={excluded}
              onToggle={toggle}
              onLabel={setLabel}
              onSelect={focusSpecimen}
              flashId={flashId}
              sort={sort}
              onSort={onSort}
            />
          </div>
        </div>
      ) : (
        <p className="empty">
          Загрузите папку <code>*.is_tens_RawData</code> или отдельные CSV-файлы образцов.
        </p>
      )}
      {errors.length > 0 && !loaded && (
        <p className="empty error-cell">{errors.length} файл(ов) не удалось прочитать</p>
      )}
      {exportOpen && (
        <ExportDialog rows={activeRows} opts={opts} onClose={() => setExportOpen(false)} />
      )}
    </div>
  );
}
