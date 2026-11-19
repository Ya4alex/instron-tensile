import { useMemo } from 'react';
import type { CalcOptions } from '../core/types';
import type { Figure } from '../core/figures';
import { specimenFigures, overlayFigures } from '../core/figures';
import { exportSpecimenCsv } from '../core/tableExport';
import type { Row } from './ResultsTable';
import { PlotCard } from './PlotCard';
import { RegionEditorPanel, TrimEditorPanel } from './RegionEditor';
import { fmt, pct } from '../utils';

export const scrollToSpecimen = (id: string) =>
  document.getElementById(`plots-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export function PlotsSection({
  rows,
  excluded,
  onToggle,
  flashId,
  onManual,
  onManualTrim,
  opts,
  showMid,
}: {
  rows: Row[];
  excluded: Set<string>;
  onToggle: (id: string) => void;
  flashId: string | null;
  onManual: (id: string, v: { eps0: number; eps1: number } | null) => void;
  onManualTrim: (id: string, v: { i0: number; i1: number } | null) => void;
  opts: CalcOptions;
  showMid: boolean; // промежуточные графики (обрезанная сила, σ(ε))
}) {
  const activeRows = useMemo(() => rows.filter((r) => !excluded.has(r.s.id)), [rows, excluded]);
  const overlays = useMemo<Figure[]>(() => overlayFigures(activeRows), [activeRows]);
  // фигуры мемоизированы по строкам — иначе Plotly перерисовывается на каждый mousemove разделителя
  const figsById = useMemo(
    () => new Map(rows.map((row) => [row.s.id, specimenFigures(row.s, row.r)])),
    [rows],
  );
  if (!rows.length) return null;
  return (
    <div className="plots-section">
      <div className="plots-toolbar">
        <div className="chips">
          {rows.map((r) => (
            <button
              key={r.s.id}
              className={`chip ${excluded.has(r.s.id) ? 'chip-off' : ''}`}
              onClick={() => scrollToSpecimen(r.s.id)}
            >
              {r.s.label}
            </button>
          ))}
        </div>
      </div>
      {rows.map((row) => {
        const off = excluded.has(row.s.id);
        return (
          <section
            key={row.s.id}
            id={`plots-${row.s.id}`}
            className={`specimen-plots ${off ? 'off' : ''} ${flashId === row.s.id ? 'flash' : ''}`}
          >
            <h3>
              <label className="spec-toggle" title="Включить/исключить из обработки">
                <input type="checkbox" checked={!off} onChange={() => onToggle(row.s.id)} />
              </label>
              <span className="spec-name">{row.s.label}</span>
              <span className="fname">{row.s.fileName}</span>
              <span className="spec-badges">
                {row.r.manualTrim && (
                  <span className="badge manual" title="Обрезка задана вручную">✎ обрезка</span>
                )}
                <span className="badge"><i>σ_max</i>{fmt(row.r.sigmaMax, 2)} МПа</span>
                <span className="badge"><i>ε_max</i>{pct(row.r.epsMax)}%</span>
                <span
                  className={`badge ${row.r.manual ? 'manual' : ''}`}
                  title={row.r.manual ? 'Линейный участок задан вручную' : 'Линейный участок найден автоматически'}
                >
                  <i>E_тан</i>{row.r.manual ? '✎ ' : ''}{fmt(row.r.eTan, 0)} МПа
                </span>
              </span>
              <button
                className="spec-export"
                title="Выгрузить таблицу точек этого образца (CSV)"
                onClick={(e) => {
                  e.stopPropagation();
                  exportSpecimenCsv(row);
                }}
              >
                ⬇ CSV
              </button>
            </h3>
            {!off && (
              <div className={`plot-grid ${showMid ? '' : 'plot-grid-two'}`}>
                {figsById
                  .get(row.s.id)!
                  .filter((f) => showMid || f.name === 'raw_force' || f.name === 'modulus')
                  .map((f) => (
                  <PlotCard
                    key={f.name}
                    figure={f}
                    editLabel={f.name === 'raw_force' ? '✎ обрезка' : '✎ участок'}
                    editor={
                      f.name === 'raw_force'
                        ? (done) => (
                            <TrimEditorPanel
                              figure={f}
                              row={row}
                              opts={opts}
                              onApply={(a, b) => onManualTrim(row.s.id, { i0: a, i1: b })}
                              onReset={() => onManualTrim(row.s.id, null)}
                              onDone={done}
                            />
                          )
                        : f.name === 'modulus'
                          ? (done) => (
                              <RegionEditorPanel
                                figure={f}
                                row={row}
                                onApply={(a, b) => onManual(row.s.id, { eps0: a, eps1: b })}
                                onReset={() => onManual(row.s.id, null)}
                                onDone={done}
                              />
                            )
                          : undefined
                    }
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
      <h2>Сводные графики</h2>
      <div className="plot-grid plot-grid-two">
        {overlays.map((f) => (
          <PlotCard key={f.name} figure={f} />
        ))}
      </div>
    </div>
  );
}
