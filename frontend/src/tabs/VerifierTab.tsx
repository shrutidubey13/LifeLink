/**
 * Tab 3 — the verifier portal.
 *
 * Stands in for a bank or an employer HR system. It receives a presentation
 * plus the consent id, and the server answers with granted/denied, the checks
 * it ran, and ONLY the fields the citizen agreed to share.
 *
 * After sharing from the wallet, this tab is pre-filled automatically.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { fieldLabel, formatValue } from '../lib/catalog';
import { formatDateTime, prettyJson } from '../lib/format';
import { useAction, useRequest } from '../lib/hooks';
import { decodePresentation } from '../lib/sdjwt';
import type { CheckId, CheckResult, ShareResult, VerifyResponse, Verifier } from '../lib/types';
import { Badge, Card, Field, InlineError, LoadingBlock, Select, Spinner } from '../components/ui';

/** The four checks a relying party cares about, in the order the API runs them. */
const HEADLINE: CheckId[] = ['issuer_trusted', 'signature_valid', 'not_revoked', 'consent_valid'];
/** The disclosure-digest check is shown as a detail of the signature card. */
const SUB_OF: Partial<Record<CheckId, CheckId>> = { disclosure_integrity: 'signature_valid' };

export function VerifierTab({ pending, onConsumed }: { pending: ShareResult | null; onConsumed: () => void }) {
  const verifiers = useRequest(() => api.verifiers(), 'verifiers');
  const [verifierId, setVerifierId] = useState<number | ''>('');
  const [consentId, setConsentId] = useState('');
  const [presentation, setPresentation] = useState('');
  const [result, setResult] = useState<VerifyResponse | null>(null);

  const verify = useAction(api.verify);

  // Auto-fill as soon as the wallet hands something over.
  useEffect(() => {
    if (!pending) return;
    setVerifierId(pending.verifier.id);
    setConsentId(String(pending.consent.id));
    setPresentation(pending.presentation);
    setResult(null);
    onConsumed();
  }, [pending, onConsumed]);

  const verifierList: Verifier[] = verifiers.data?.verifiers ?? [];
  const preview = useMemo(() => (presentation ? decodePresentation(presentation) : null), [presentation]);

  const canVerify = verifierId !== '' && consentId.trim() !== '' && presentation.trim() !== '';

  async function runVerify() {
    const response = await verify.run({
      verifierId: Number(verifierId),
      consentId: Number(consentId),
      presentation,
    });
    setResult(response);
  }

  return (
    <div className="space-y-4">
      {verifiers.loading && <LoadingBlock label="Loading verifiers…" />}

      <Card
        title="Verify a citizen"
        subtitle="No forms, no uploads. Paste (or auto-fill) the presentation the citizen shared."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Verifier" htmlFor="verifier-pick">
            <Select id="verifier-pick" value={verifierId} onChange={setVerifierId} disabled={verify.pending}>
              <option value="">Choose a verifier…</option>
              {verifierList.map((verifier) => (
                <option key={verifier.id} value={verifier.id}>
                  {verifier.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Consent id" htmlFor="consent-id">
            <input
              id="consent-id"
              className="input"
              inputMode="numeric"
              placeholder="e.g. 1"
              value={consentId}
              disabled={verify.pending}
              onChange={(event) => setConsentId(event.target.value)}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field
            label="Presentation"
            htmlFor="presentation"
            hint="Format: signed JWT, then the chosen disclosures. Anything the citizen did not consent to is not in here."
          >
            <textarea
              id="presentation"
              className="input h-28 font-mono text-[11px]"
              spellCheck={false}
              placeholder="<jwt>~<disclosure>~…  (use the Wallet tab's “Share…” button to generate one)"
              value={presentation}
              disabled={verify.pending}
              onChange={(event) => setPresentation(event.target.value)}
            />
          </Field>
        </div>

        {/* Show the citizen exactly what is about to be sent. */}
        {preview && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Preview of this presentation
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-slate-700">
                  {preview.disclosures.length} disclosure(s) included
                </p>
                <ul className="mt-1 space-y-0.5">
                  {preview.disclosures.map((disclosure) => (
                    <li key={disclosure.key} className="text-xs text-slate-700">
                      • {fieldLabel(disclosure.key)}:{' '}
                      <span className="font-mono">{formatValue(disclosure.value)}</span>
                    </li>
                  ))}
                  {preview.disclosures.length === 0 && (
                    <li className="text-xs text-rose-600">No readable disclosures found.</li>
                  )}
                </ul>
              </div>
              <div className="text-xs text-slate-500">
                <p>
                  The signed JWT holds {preview.digestCount} SHA-256 digest(s) in <code>_sd</code> and no
                  claim values at all.
                </p>
                {preview.payload && (
                  <p className="mt-1 break-all font-mono text-[10px]">
                    iss={String(preview.payload.iss)} status=#{String(preview.payload.status)}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <InlineError error={verify.error} />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void runVerify()}
            disabled={!canVerify || verify.pending}
          >
            {verify.pending ? (
              <>
                <Spinner /> Checking…
              </>
            ) : (
              'Verify now'
            )}
          </button>
          {presentation && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setPresentation('');
                setConsentId('');
                setResult(null);
                verify.clearError();
              }}
            >
              Clear
            </button>
          )}
        </div>
      </Card>

      {result && <VerificationResult result={result} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function VerificationResult({ result }: { result: VerifyResponse }) {
  const granted = result.result === 'granted';

  const checkById = new Map<CheckId, CheckResult>(result.checks.map((check) => [check.id, check]));
  const subChecks = (id: CheckId) => result.checks.filter((check) => SUB_OF[check.id] === id);

  return (
    <div className="space-y-4">
      {/* Verdict */}
      <div
        className={`animate-fade-in rounded-2xl border p-5 ${
          granted ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className={`text-2xl font-bold ${granted ? 'text-emerald-800' : 'text-rose-800'}`}>
              {granted ? '✓ Access granted' : '✕ Access denied'}
            </h2>
            <p className={`mt-1 text-sm ${granted ? 'text-emerald-800' : 'text-rose-800'}`}>
              {granted
                ? `${result.consent.credentialTypeLabel ?? 'Credential'} confirmed for ${result.credential.issuer.name}.`
                : 'The verifier received no personal data. See the failing check below.'}
            </p>
          </div>
          <Badge tone={granted ? 'granted' : 'denied'}>
            {result.checks.filter((c) => c.passed).length}/{result.checks.length} checks passed
          </Badge>
        </div>
        <p className={`mt-2 text-xs ${granted ? 'text-emerald-700' : 'text-rose-700'}`}>
          Verified {formatDateTime(result.verifiedAt)} · credential #{result.credential.id} · consent #
          {result.consent.id} · purpose “{result.consent.purpose}”
        </p>
      </div>

      {/* The checks */}
      <Card title="What the verifier checked" subtitle="Run in this exact order by POST /verifier/verify.">
        <div className="grid gap-3 sm:grid-cols-2">
          {HEADLINE.map((id) => {
            const check = checkById.get(id);
            if (!check) return null;
            const subs = subChecks(id);
            return (
              <div
                key={id}
                className={`rounded-xl border p-3 ${
                  check.passed ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/50'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                      check.passed ? 'bg-emerald-500' : 'bg-rose-500'
                    }`}
                  >
                    {check.passed ? '✓' : '✕'}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{check.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{check.detail}</p>
                    {subs.map((sub) => (
                      <p
                        key={sub.id}
                        className={`mt-1.5 flex items-start gap-1.5 border-t pt-1.5 text-[11px] ${
                          sub.passed ? 'border-emerald-200 text-emerald-700' : 'border-rose-200 text-rose-700'
                        }`}
                      >
                        <span aria-hidden="true">{sub.passed ? '✓' : '✕'}</span>
                        <span>
                          <strong>{sub.label}:</strong> {sub.detail}
                        </span>
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* What was actually revealed */}
      <Card
        title={granted ? 'What the citizen shared' : 'What the citizen shared'}
        subtitle={
          granted
            ? `${result.revealedFields.length} field(s) revealed — and nothing else.`
            : 'Nothing was revealed because access was denied.'
        }
      >
        {granted && Object.keys(result.revealed).length > 0 ? (
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            {Object.entries(result.revealed).map(([key, value]) => (
              <div
                key={key}
                className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5"
              >
                <dt className="text-sm text-slate-500">{fieldLabel(key)}</dt>
                <dd className="text-sm font-semibold text-slate-900">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-slate-500">
            {granted ? 'No claims were included in this presentation.' : 'The verifier got an empty response.'}
          </p>
        )}

        {granted && result.withheldFields.length > 0 && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Kept private by the citizen
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {result.withheldFields.map((key) => (
                <Badge key={key} tone="neutral">
                  {fieldLabel(key)}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              These fields exist inside the signed credential, but they were never sent — this verifier
              cannot see them, and cannot ask for them without a new consent.
            </p>
          </div>
        )}
      </Card>

      {/* Before / after */}
      <Card title="LifeLink vs the traditional way" subtitle="Same question, two very different answers.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">With LifeLink</p>
            <p className="mt-1 text-lg font-bold text-emerald-900">
              {result.comparison.lifelink.summary}
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-emerald-800">
              <li>• {result.revealedFields.length} field(s) disclosed, chosen by the citizen</li>
              <li>• {result.comparison.lifelink.formsFilled} forms filled</li>
              <li>• Cryptographic proof, no document handling</li>
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Traditional</p>
            <p className="mt-1 text-lg font-bold text-slate-700">{result.comparison.traditional.summary}</p>
            <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
              <li>• {result.comparison.traditional.verificationTime} of manual checks</li>
              <li>• {result.comparison.traditional.documentsUploaded}+ documents re-uploaded</li>
              <li>• Citizen has no record of who kept what</li>
            </ul>
          </div>
        </div>
      </Card>

      <details>
        <summary className="cursor-pointer text-xs font-semibold text-slate-500">
          Show the full verifier response (JSON)
        </summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-slate-900 p-3 font-mono text-[10px] leading-relaxed text-slate-100">
          {prettyJson(result)}
        </pre>
      </details>
    </div>
  );
}
