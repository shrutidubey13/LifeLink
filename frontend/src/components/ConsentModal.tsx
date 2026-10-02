/**
 * The consent screen.
 *
 * The citizen decides four things, and the screen always shows the plain-language
 * consequence of those choices before they approve:
 *   WHO    — which verifier
 *   WHY    — the purpose
 *   WHICH  — exactly which fields (everything else stays encrypted-ish: it is
 *            simply never put into the presentation)
 *   HOW LONG — how long the access lasts
 *
 * Approving creates a consent record and a presentation that physically cannot
 * contain an unselected field.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import {
  DURATIONS,
  PURPOSE_SUGGESTIONS,
  fieldLabel,
  formatValue,
  typeLabel,
} from '../lib/catalog';
import { useAction } from '../lib/hooks';
import type { Credential, ShareResult, Verifier } from '../lib/types';
import { Badge, DidTag, Field, InlineError, Select, Spinner, Toggle } from './ui';

export function ConsentModal({
  credential,
  verifiers,
  citizenId,
  onApprove,
  onClose,
}: {
  credential: Credential;
  verifiers: Verifier[];
  citizenId: number;
  onApprove: (result: ShareResult) => void;
  onClose: () => void;
}) {
  const [verifierId, setVerifierId] = useState<number | ''>('');
  const [purpose, setPurpose] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [duration, setDuration] = useState('30m');
  const dialogRef = useRef<HTMLDivElement>(null);

  const share = useAction(api.share);
  const allFields = useMemo(() => Object.keys(credential.claims), [credential.claims]);
  const chosenVerifier = verifiers.find((v) => v.id === verifierId) ?? null;

  // Escape closes the dialog, and the page behind it must not scroll.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !share.pending) onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, share.pending]);

  const toggleField = (key: string) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const problems: string[] = [];
  if (!verifierId) problems.push('Choose who you are sharing with.');
  if (purpose.trim().length < 3) problems.push('Add a short reason for sharing.');
  if (selected.length === 0) problems.push('Select at least one field to share.');
  const canApprove = problems.length === 0;

  const durationText = DURATIONS.find((d) => d.value === duration)?.label ?? duration;

  async function approve() {
    if (!canApprove || verifierId === '') return;
    const result = await share.run({
      citizenId,
      verifierId: Number(verifierId),
      credentialId: credential.id,
      purpose: purpose.trim(),
      fields: selected,
      duration,
    });
    if (result) onApprove(result);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share credential"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !share.pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="animate-fade-in flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        {/* header */}
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900">Share your {typeLabel(credential.type)}</h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {credential.issuer.name} · {allFields.length} fields inside
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={share.pending}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {/* body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5">
          {/* 1. WHO */}
          <Field label="1. Who is asking?" htmlFor="consent-verifier">
            <Select id="consent-verifier" value={verifierId} onChange={setVerifierId} disabled={share.pending}>
              <option value="">Choose a verifier…</option>
              {verifiers.map((verifier) => (
                <option key={verifier.id} value={verifier.id}>
                  {verifier.name}
                </option>
              ))}
            </Select>
            {chosenVerifier && (
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <DidTag did={chosenVerifier.did} />
              </p>
            )}
          </Field>

          {/* 2. WHY */}
          <Field label="2. Why are you sharing?" htmlFor="consent-purpose">
            <input
              id="consent-purpose"
              className="input"
              placeholder="e.g. Open a bank account (KYC)"
              value={purpose}
              maxLength={300}
              disabled={share.pending}
              onChange={(event) => setPurpose(event.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PURPOSE_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={share.pending}
                  onClick={() => setPurpose(suggestion)}
                  className="rounded-full border border-slate-300 px-2.5 py-1 text-[11px] text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </Field>

          {/* 3. WHICH */}
          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="label mb-0">3. Which fields may they see?</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={share.pending}
                  onClick={() => setSelected(allFields)}
                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  Select all
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  disabled={share.pending}
                  onClick={() => setSelected([])}
                  className="text-[11px] font-semibold text-slate-500 hover:text-slate-700"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {allFields.map((key) => (
                <Toggle
                  key={key}
                  checked={selected.includes(key)}
                  onChange={() => toggleField(key)}
                  label={fieldLabel(key)}
                  description={
                    <span className="font-mono text-[11px] text-slate-600">
                      {formatValue(credential.claims[key])}
                    </span>
                  }
                />
              ))}
            </div>
          </div>

          {/* 4. HOW LONG */}
          <div>
            <span className="label">4. How long may they keep it?</span>
            <div className="grid grid-cols-3 gap-2">
              {DURATIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={share.pending}
                  onClick={() => setDuration(option.value)}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                    duration === option.value
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {option.short}
                </button>
              ))}
            </div>
          </div>

          {/* PLAIN-LANGUAGE SUMMARY */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
            <p className="text-sm font-semibold text-indigo-900">In plain language</p>
            <p className="mt-1 text-sm text-indigo-800">
              {chosenVerifier ? (
                <>
                  <strong>{chosenVerifier.name}</strong> will see{' '}
                  <strong>
                    {selected.length} of {allFields.length} field{allFields.length === 1 ? '' : 's'}
                  </strong>{' '}
                  for <strong>{durationText}</strong>
                  {purpose.trim() ? (
                    <>
                      , for the purpose “<strong>{purpose.trim()}</strong>”
                    </>
                  ) : null}
                  .
                </>
              ) : (
                'Choose a verifier to see exactly what will be shared.'
              )}
            </p>

            {selected.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {selected.map((key) => (
                  <li key={key}>
                    <Badge tone="info">
                      {fieldLabel(key)}: {formatValue(credential.claims[key])}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}

            {allFields.length - selected.length > 0 && (
              <p className="mt-2 text-xs text-indigo-700">
                <strong>{allFields.length - selected.length} field(s) stay private:</strong>{' '}
                {allFields
                  .filter((key) => !selected.includes(key))
                  .map((key) => fieldLabel(key))
                  .join(', ')}
              </p>
            )}
          </div>

          <InlineError error={share.error} />
          {problems.length > 0 && !share.pending && (
            <ul className="space-y-1">
              {problems.map((problem) => (
                <li key={problem} className="text-xs text-slate-500">
                  • {problem}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* footer */}
        <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={share.pending}>
            Deny
          </button>
          <button type="button" className="btn-primary" onClick={() => void approve()} disabled={!canApprove || share.pending}>
            {share.pending ? (
              <>
                <Spinner /> Creating consent…
              </>
            ) : (
              <>Approve &amp; share {selected.length || ''}</>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
