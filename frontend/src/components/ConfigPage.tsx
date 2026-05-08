import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, Loader2, Plus, RefreshCw, Save, SlidersHorizontal, Table2, Trash2 } from 'lucide-react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { API_URL } from '../config';
import type { DbTableInfo, EntryStrategySettings } from '../types';
import { cn } from '../utils';

type TableRowsResponse = {
  info: DbTableInfo;
  rows: Record<string, unknown>[];
};

const CHART_COLORS = ['#ffb84d', '#3dd7c4', '#ff6b7a', '#8bd450', '#5ea0ff', '#ffd166'];

export default function ConfigPage() {
  const [tables, setTables] = useState<DbTableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [tableData, setTableData] = useState<TableRowsResponse | null>(null);
  const [loadingTables, setLoadingTables] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [editorText, setEditorText] = useState('{}');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingEntrySettings, setSavingEntrySettings] = useState(false);
  const [entryForm, setEntryForm] = useState({
    directEntryMinScore: '70',
    directEntryMinLiquidityUsd: '50000',
  });
  const [error, setError] = useState('');

  const fetchTables = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const response = await fetch(`${API_URL}/db/tables`);
      if (!response.ok) {
        throw new Error(`table list failed: ${response.status}`);
      }
      const payload = await response.json() as DbTableInfo[];
      setTables(payload);
      setSelectedTable(current => current || payload[0]?.name || '');
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoadingTables(false);
      setRefreshing(false);
    }
  }, []);

  const fetchEntrySettings = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/strategy/entry-settings`);
      if (!response.ok) {
        throw new Error(`entry settings failed: ${response.status}`);
      }
      const payload = await response.json() as EntryStrategySettings;
      setEntryForm({
        directEntryMinScore: String(payload.directEntryMinScore),
        directEntryMinLiquidityUsd: String(payload.directEntryMinLiquidityUsd),
      });
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    }
  }, []);

  const fetchTableRows = useCallback(async (tableName: string) => {
    if (!tableName) return;
    setLoadingRows(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/db/table/${encodeURIComponent(tableName)}?limit=100`);
      if (!response.ok) {
        throw new Error(`table rows failed: ${response.status}`);
      }
      const payload = await response.json() as TableRowsResponse;
      setTableData(payload);
      if (payload.rows[0]) {
        setSelectedRow(payload.rows[0]);
        setEditorText(JSON.stringify(payload.rows[0], null, 2));
      } else {
        setSelectedRow(null);
        setEditorText('{}');
      }
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    void fetchTables();
  }, [fetchTables]);

  useEffect(() => {
    void fetchEntrySettings();
  }, [fetchEntrySettings]);

  useEffect(() => {
    if (selectedTable) {
      void fetchTableRows(selectedTable);
    }
  }, [fetchTableRows, selectedTable]);

  const chartData = useMemo(() => tables.map((table, index) => ({
    name: table.name,
    rows: table.rowCount,
    fill: CHART_COLORS[index % CHART_COLORS.length],
  })), [tables]);

  const saveRow = async () => {
    if (!selectedTable) return;
    setSaving(true);
    setError('');
    try {
      const payload = JSON.parse(editorText) as Record<string, unknown>;
      const response = await fetch(`${API_URL}/db/table/${encodeURIComponent(selectedTable)}/row`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: `save failed: ${response.status}` }));
        throw new Error(typeof data.error === 'string' ? data.error : `save failed: ${response.status}`);
      }
      await fetchTables();
      await fetchTableRows(selectedTable);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async () => {
    if (!selectedTable || !selectedRow) return;
    setDeleting(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/db/table/${encodeURIComponent(selectedTable)}/row`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedRow),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: `delete failed: ${response.status}` }));
        throw new Error(typeof data.error === 'string' ? data.error : `delete failed: ${response.status}`);
      }
      await fetchTables();
      await fetchTableRows(selectedTable);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDeleting(false);
    }
  };

  const saveEntryStrategySettings = async () => {
    setSavingEntrySettings(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/strategy/entry-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'unified',
          directEntryMinScore: Number(entryForm.directEntryMinScore),
          directEntryMinLiquidityUsd: Number(entryForm.directEntryMinLiquidityUsd),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: `entry settings save failed: ${response.status}` }));
        throw new Error(typeof data.error === 'string' ? data.error : `entry settings save failed: ${response.status}`);
      }

      const payload = await response.json() as EntryStrategySettings;
      setEntryForm({
        directEntryMinScore: String(payload.directEntryMinScore),
        directEntryMinLiquidityUsd: String(payload.directEntryMinLiquidityUsd),
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingEntrySettings(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="terminal-panel rounded-2xl border border-border bg-bg-card p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5 text-primary" />
              <h2 className="panel-title text-lg font-semibold text-text-primary">开仓策略</h2>
            </div>
            <p className="mt-2 text-sm text-text-secondary">
              满足基础准入后进入观察池，动量确认后开仓。高分并达到流动性门槛的标的允许直接开仓。
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border/70 bg-bg-primary/40 p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">直接开仓最低分</p>
            <input
              type="number"
              value={entryForm.directEntryMinScore}
              onChange={event => setEntryForm(current => ({ ...current, directEntryMinScore: event.target.value }))}
              className="mt-3 w-full rounded-xl border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
            />
          </div>

          <div className="rounded-2xl border border-border/70 bg-bg-primary/40 p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">直接开仓最低流动性 (USD)</p>
            <input
              type="number"
              value={entryForm.directEntryMinLiquidityUsd}
              onChange={event => setEntryForm(current => ({ ...current, directEntryMinLiquidityUsd: event.target.value }))}
              className="mt-3 w-full rounded-xl border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={() => void saveEntryStrategySettings()}
            disabled={savingEntrySettings}
            className="rounded-xl bg-primary/90 px-4 py-2.5 text-sm font-medium text-slate-950 transition-colors hover:bg-primary disabled:opacity-50"
          >
            {savingEntrySettings ? '保存中' : '保存'}
          </button>
        </div>
      </section>

      <section className="terminal-panel rounded-2xl border border-border bg-bg-card p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-center gap-3">
            <Database className="h-5 w-5 text-primary" />
            <div>
              <h2 className="panel-title text-lg font-semibold text-text-primary">数据库工作台</h2>
              <p className="text-xs text-text-muted">显示并编辑后端所有 SQLite 表，顶部图表展示当前表规模，右侧提供行级 JSON 编辑。</p>
            </div>
          </div>
          <button
            onClick={() => void fetchTables(true)}
            disabled={refreshing}
            className="h-10 w-10 rounded-xl border border-border text-text-muted transition-colors hover:bg-bg-primary hover:text-text-primary"
          >
            <RefreshCw className={cn('mx-auto h-4 w-4', refreshing && 'animate-spin')} />
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <SummaryCard label="表数量" value={String(tables.length)} hint="当前后端所有业务表" />
          <SummaryCard label="选中表" value={selectedTable || '—'} hint="左侧列表当前选中" />
          <SummaryCard label="行数" value={String(tableData?.info.rowCount ?? 0)} hint="当前选中表总行数" />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Table2 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-text-primary">表规模可视化</h3>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis dataKey="name" stroke="#8f9bb3" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
              <YAxis stroke="#8f9bb3" tick={{ fontSize: 11 }} />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                contentStyle={{ background: '#11161f', border: '1px solid #273041', borderRadius: 12, color: '#eef3ff' }}
              />
              <Bar dataKey="rows" radius={[10, 10, 0, 0]}>
                {chartData.map(entry => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[260px_1fr_420px]">
        <div className="space-y-2 rounded-2xl border border-border bg-bg-card p-3">
          {loadingTables ? (
            <div className="py-10 text-center">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-primary" />
              <p className="text-xs text-text-muted">加载表列表...</p>
            </div>
          ) : (
            tables.map(table => (
              <button
                key={table.name}
                onClick={() => setSelectedTable(table.name)}
                className={cn(
                  'w-full rounded-2xl border px-4 py-3 text-left transition-all',
                  selectedTable === table.name
                    ? 'border-primary/20 bg-primary/10'
                    : 'border-transparent hover:bg-bg-card-hover'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-text-primary">{table.name}</p>
                  <span className="rounded-full bg-bg-primary px-2 py-1 text-[10px] text-text-muted">{table.rowCount}</span>
                </div>
                <p className="mt-1 text-[11px] text-text-muted">{table.columns.length} 列</p>
              </button>
            ))
          )}
        </div>

        <div className="rounded-2xl border border-border bg-bg-card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="panel-title text-base font-semibold text-text-primary">{selectedTable || '未选择数据表'}</h3>
              <p className="text-xs text-text-muted">展示最近 100 行。点击任意行会在右侧装载 JSON 编辑器。</p>
            </div>
            <button
              onClick={() => {
                setSelectedRow(null);
                setEditorText('{}');
              }}
              className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-primary hover:text-text-primary"
            >
              <span className="inline-flex items-center gap-2">
                <Plus className="h-4 w-4" />
                新建行
              </span>
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          <div className="mb-4 flex flex-wrap gap-2">
            {(tableData?.info.columns ?? []).map(column => (
              <span key={column.name} className="rounded-full bg-bg-primary px-2 py-1 text-[11px] text-text-secondary">
                {column.name}:{column.type || 'TEXT'}{column.pk ? ' PK' : ''}
              </span>
            ))}
          </div>

          {loadingRows ? (
            <div className="py-12 text-center">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-primary" />
              <p className="text-xs text-text-muted">加载表数据...</p>
            </div>
          ) : !tableData || tableData.rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="text-sm text-text-primary">当前表没有数据</p>
              <p className="mt-1 text-xs text-text-muted">可以直接在右侧 JSON 编辑器里创建一行。</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-text-muted">
                    {tableData.info.columns.map(column => (
                      <th key={column.name} className="px-3 py-3 text-left font-medium">{column.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {tableData.rows.map((row, index) => (
                    <tr
                      key={String(row._rowid ?? index)}
                      onClick={() => {
                        setSelectedRow(row);
                        setEditorText(JSON.stringify(row, null, 2));
                      }}
                      className={cn(
                        'cursor-pointer transition-colors hover:bg-bg-card-hover',
                        selectedRow?._rowid === row._rowid && 'bg-primary/8'
                      )}
                    >
                      {tableData.info.columns.map(column => (
                        <td key={column.name} className="max-w-[220px] truncate px-3 py-3 text-text-secondary">
                          {formatCell(row[column.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-bg-card p-5">
          <div className="mb-4">
            <h3 className="panel-title text-base font-semibold text-text-primary">行编辑器</h3>
            <p className="text-xs text-text-muted">直接编辑当前行 JSON，然后保存到后端表。删除会按主键或 `_rowid` 执行。</p>
          </div>
          <textarea
            value={editorText}
            onChange={event => setEditorText(event.target.value)}
            rows={26}
            className="w-full rounded-xl border border-border bg-bg-primary px-3 py-3 font-mono text-xs text-text-primary outline-none focus:border-primary"
          />
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => void saveRow()}
              disabled={saving || !selectedTable}
              className="flex-1 rounded-xl bg-primary/90 px-4 py-2.5 text-sm font-medium text-slate-950 transition-colors hover:bg-primary disabled:opacity-50"
            >
              <span className="inline-flex items-center gap-2">
                <Save className="h-4 w-4" />
                {saving ? '保存中' : '保存'}
              </span>
            </button>
            <button
              onClick={() => void deleteRow()}
              disabled={deleting || !selectedRow}
              className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger/15 disabled:opacity-50"
            >
              <span className="inline-flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                {deleting ? '删除中' : '删除'}
              </span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-bg-primary/60 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">{label}</p>
      <p className="panel-title mt-2 text-xl font-semibold text-text-primary">{value}</p>
      <p className="mt-1 text-[11px] text-text-muted">{hint}</p>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
