import { CopyButton } from './CopyButton';

export function TruncatedHash({
  value,
  start = 10,
  end = 6,
  showCopy = true,
  className = '',
}: {
  value: string;
  start?: number;
  end?: number;
  showCopy?: boolean;
  className?: string;
}) {
  if (!value) return null;

  const truncated =
    value.length > start + end + 3
      ? `${value.slice(0, start)}…${value.slice(-end)}`
      : value;

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-sm text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg ${className}`}
      title={value}
    >
      <span className="truncate max-w-[200px] sm:max-w-none">{truncated}</span>
      {showCopy && <CopyButton text={value} label={`Copy full value: ${value}`} />}
    </span>
  );
}
