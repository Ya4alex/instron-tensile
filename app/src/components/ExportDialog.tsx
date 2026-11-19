import { useEffect, useState } from 'react';
import type { CalcOptions, SpecimenRow } from '../core/types';
import { buildCsvText, exportCsv } from './ResultsTable';
import { buildXlsx } from '../core/xlsx';
import { exportSpecimenZip } from '../core/tableExport';
import { download } from '../utils';

export function ExportDialog({
  rows,
  opts,
  onClose,
}: {
  rows: SpecimenRow[];
  opts: CalcOptions;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [summary, setSummary] = useState(true);
  const [stats, setStats] = useState(true);
  const [params, setParams] = useState(true);
  const [perSpec, setPerSpec] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const ok = (summary || perSpec) && !busy;
  const date = new Date().toISOString().slice(0, 10);

  const go = async () => {
    setBusy(true);
    try {
      if (format === 'xlsx') {
        const blob = await buildXlsx(rows, opts, {
          summary,
          stats,
          params,
          specimenSheets: perSpec,
        });
        download(blob, `results_${date}.xlsx`);
      } else {
        const csvOpts = { stats, params: params ? opts : null };
        if (perSpec) {
          await exportSpecimenZip(rows, summary ? buildCsvText(rows, csvOpts) : null);
        } else {
          exportCsv(rows, csvOpts, `results_${date}.csv`);
        }
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Экспорт таблиц</h3>
        <div className="exp-group">
          <div className="exp-title">Формат</div>
          <label>
            <input type="radio" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} /> XLSX
            <span className="hint">Excel / LibreOffice Calc</span>
          </label>
          <label>
            <input type="radio" checked={format === 'csv'} onChange={() => setFormat('csv')} /> CSV
            <span className="hint">UTF-8, разделитель «;»</span>
          </label>
        </div>
        <div className="exp-group">
          <div className="exp-title">Состав</div>
          <label>
            <input type="checkbox" checked={summary} onChange={(e) => setSummary(e.target.checked)} />
            Итоговая таблица{format === 'xlsx' ? ' (лист «Сводка»)' : ''}
          </label>
          <label>
            <input
              type="checkbox"
              checked={stats}
              disabled={!summary}
              onChange={(e) => setStats(e.target.checked)}
            />
            Строки статистики (X̄, СКО)
          </label>
          <label>
            <input
              type="checkbox"
              checked={params}
              disabled={!summary}
              onChange={(e) => setParams(e.target.checked)}
            />
            Параметры расчёта
          </label>
          <label>
            <input type="checkbox" checked={perSpec} onChange={(e) => setPerSpec(e.target.checked)} />
            Таблицы по образцам
            <span className="hint">{format === 'xlsx' ? 'лист на образец: сырые точки + обрезанные + ε/σ' : 'ZIP с CSV по каждому образцу'}</span>
          </label>
        </div>
        <div className="exp-actions">
          <button onClick={go} disabled={!ok}>
            {busy ? '…' : 'Скачать'}
          </button>
          <button className="ghost" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
