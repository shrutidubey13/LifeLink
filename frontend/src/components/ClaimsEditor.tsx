import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Input } from './ui';

export interface ClaimsEditorProps {
  initialClaims?: Record<string, unknown>;
  onChange: (claims: Record<string, unknown>) => void;
  disabled?: boolean;
}

interface ClaimRow {
  id: string;
  key: string;
  value: string;
}

function objectToRows(obj: Record<string, unknown> = {}): ClaimRow[] {
  const entries = Object.entries(obj);
  if (entries.length === 0) {
    return [{ id: '1', key: '', value: '' }];
  }
  return entries.map(([k, v], idx) => ({
    id: `${idx}-${k}`,
    key: k,
    value: typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v),
  }));
}

function rowsToObject(rows: ClaimRow[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    const trimmedKey = row.key.trim();
    if (!trimmedKey) continue;
    const trimmedVal = row.value.trim();
    // Auto-parse numbers and booleans if appropriate
    if (trimmedVal === 'true') {
      result[trimmedKey] = true;
    } else if (trimmedVal === 'false') {
      result[trimmedKey] = false;
    } else if (!Number.isNaN(Number(trimmedVal)) && trimmedVal !== '' && !trimmedVal.startsWith('+') && !trimmedVal.startsWith('0') || trimmedVal === '0') {
      result[trimmedKey] = Number(trimmedVal);
    } else {
      result[trimmedKey] = trimmedVal;
    }
  }
  return result;
}

export function ClaimsEditor({ initialClaims, onChange, disabled }: ClaimsEditorProps) {
  const [rows, setRows] = useState<ClaimRow[]>(() => objectToRows(initialClaims));

  useEffect(() => {
    if (initialClaims) {
      setRows(objectToRows(initialClaims));
    }
  }, [initialClaims]);

  function updateRow(id: string, field: 'key' | 'value', val: string) {
    const updated = rows.map((r) => (r.id === id ? { ...r, [field]: val } : r));
    setRows(updated);
    onChange(rowsToObject(updated));
  }

  function addRow() {
    const newId = `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const updated = [...rows, { id: newId, key: '', value: '' }];
    setRows(updated);
    onChange(rowsToObject(updated));
  }

  function removeRow(id: string) {
    if (rows.length === 1) {
      const updated = [{ id: rows[0].id, key: '', value: '' }];
      setRows(updated);
      onChange({});
      return;
    }
    const updated = rows.filter((r) => r.id !== id);
    setRows(updated);
    onChange(rowsToObject(updated));
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2">
            <div className="flex-1">
              <Input
                placeholder="Field name (e.g. documentName)"
                value={row.key}
                onChange={(e) => updateRow(row.id, 'key', e.target.value)}
                disabled={disabled}
                className="h-10 text-sm font-medium"
              />
            </div>
            <div className="flex-1">
              <Input
                placeholder="Value (e.g. Bachelor of Technology)"
                value={row.value}
                onChange={(e) => updateRow(row.id, 'value', e.target.value)}
                disabled={disabled}
                className="h-10 text-sm"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-10 w-10 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
              onClick={() => removeRow(row.id)}
              disabled={disabled || (rows.length === 1 && !row.key && !row.value)}
              title="Remove field"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        icon={<Plus className="h-3.5 w-3.5" />}
        onClick={addRow}
        disabled={disabled}
      >
        Add field
      </Button>
    </div>
  );
}

export function KeyValueDisplay({
  data,
  emptyMessage = 'No fields available',
  className = '',
}: {
  data: Record<string, unknown> | null | undefined;
  emptyMessage?: string;
  className?: string;
}) {
  if (!data || Object.keys(data).length === 0) {
    return <p className="text-sm text-slate-500 italic py-2">{emptyMessage}</p>;
  }

  return (
    <dl className={`divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white overflow-hidden text-sm ${className}`}>
      {Object.entries(data).map(([key, value]) => {
        let displayValue: string;
        if (value === null || value === undefined) displayValue = '—';
        else if (typeof value === 'boolean') displayValue = value ? 'Yes' : 'No';
        else if (typeof value === 'object') displayValue = JSON.stringify(value);
        else displayValue = String(value);

        return (
          <div key={key} className="flex flex-col sm:flex-row sm:items-center justify-between px-3.5 py-2.5 hover:bg-slate-50/50">
            <dt className="font-medium text-slate-600 capitalize">
              {key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}
            </dt>
            <dd className="font-semibold text-slate-900 mt-0.5 sm:mt-0 font-mono text-xs sm:text-sm break-all">
              {displayValue}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
