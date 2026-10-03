/**
 * The verifier portal.
 *
 * Stands in for a bank or an employer HR system. You act ONLY as your own
 * logged-in account: the profile card shows what you have verified, and the
 * verify form checks presentations students shared specifically with you.
 *
 * After the student shares from the wallet (and you switch accounts), the form
 * auto-fills from the stashed share — no retyping a 2KB presentation.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  ShieldCheck,
  RotateCcw,
  Sparkles,
  FileText,
} from 'lucide-react';
import { api } from '../lib/api';
import { takeStashedShare } from '../lib/auth';
import { fieldLabel, formatValue } from '../lib/catalog';
import { formatDateTime } from '../lib/format';
import { useAction, useRequest } from '../lib/hooks';
import { decodePresentation } from '../lib/sdjwt';
import type { CheckId, CheckResult, VerifyResponse } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorBlock,
  Field,
  InlineError,
  PageHeader,
  SkeletonCard,
  TruncatedHash,
  useToast,
} from '../components/ui';
import { useTitle } from '../lib/useTitle';
import { FileViewer } from '../components/FileViewer';
import { KeyValueDisplay } from '../components/ClaimsEditor';

/** The four checks a relying party cares about, in the order the API runs them. */
const HEADLINE: CheckId[] = ['issuer_trusted', 'signature_valid', 'not_revoked', 'consent_valid'];
/** The disclosure-digest check is shown as a detail of the signature card. */
const SUB_OF: Partial<Record<CheckId, CheckId>> = { disclosure_integrity: 'signature_valid' };

export function VerifierTab({ userId }: { userId: number }) {
  useTitle('Verifier Portal');
  const { toast } = useToast();
  const profile = useRequest(() => api.verifierProfile(), `verifier-profile-${userId}`);
  const [presentation, setPresentation] = useState('');
  const [result, setResult] = useState<VerifyResponse | null>(null);

  const verify = useAction(api.verify);

  // Auto-fill from the wallet's stashed share.
  useEffect(() => {
    const stashed = takeStashedShare();
    if (stashed) {
      setPresentation(stashed.presentation);
      setResult(null);
      toast.info('Auto-filled presentation from your recent wallet share!');
    }
  }, [userId, toast]);

  const preview = useMemo(() => (presentation ? decodePresentation(presentation) : null), [presentation]);
  const canVerify = presentation.trim() !== '';

  async function runVerify() {
    const response = await verify.run(presentation.trim());
    setResult(response);
    if (response) {
      if (response.result === 'granted') {
        toast.success('Access granted! All cryptographic checks passed.');
      } else {
        toast.error('Access denied. One or more cryptographic checks failed.');
      }
      profile.reload();
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={profile.data ? profile.data.verifier.name : 'Verifier Portal'}
        subtitle="Verify presentations shared with you. Zero-knowledge and selective disclosure verification."
        badge={
          profile.data && (
            <Badge tone="trusted" size="md">
              Verified Relying Party
            </Badge>
          )
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCcw className="h-4 w-4" />}
            onClick={() => profile.reload()}
          >
            Refresh
          </Button>
        }
      />

      {profile.loading && !profile.data && <SkeletonCard lines={2} />}
      {profile.error && <ErrorBlock message={profile.error} onRetry={profile.reload} />}

      {profile.data && (
        <Card className="border-blue-100 bg-gradient-to-r from-blue-50/50 to-indigo-50/30">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/60">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
                Verifier DID:
              </span>
              <TruncatedHash value={profile.data.verifier.did} start={14} end={8} />
            </div>
            {profile.data.verifier.email && (
              <span className="text-sm font-medium text-slate-600 font-mono">
                {profile.data.verifier.email}
              </span>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
            <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs">
              <p className="text-2xl font-bold text-slate-900">{profile.data.stats.total}</p>
              <p className="text-sm font-semibold uppercase tracking-wider text-slate-500 mt-1">Total Checked</p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs">
              <p className="text-2xl font-bold text-emerald-600">{profile.data.stats.granted}</p>
              <p className="text-sm font-semibold uppercase tracking-wider text-slate-500 mt-1">Granted</p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs">
              <p className="text-2xl font-bold text-rose-600">{profile.data.stats.denied}</p>
              <p className="text-sm font-semibold uppercase tracking-wider text-slate-500 mt-1">Denied</p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-2xs">
              <p className="text-2xl font-bold text-blue-700">{profile.data.stats.citizensServed}</p>
              <p className="text-sm font-semibold uppercase tracking-wider text-slate-500 mt-1">Students Served</p>
            </div>
          </div>

          {profile.data.stats.credentialTypes.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5 pt-3 border-t border-slate-200/50">
              <span className="text-sm text-slate-500 font-medium mr-1">Accepted Types:</span>
              {profile.data.stats.credentialTypes.map((type) => (
                <Badge key={type} tone="info">
                  {type}
                </Badge>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Verify Presentation Card */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-blue-600" />
              <span>Verify Student Presentation</span>
            </CardTitle>
            <CardDescription>
              No manual uploads or forms. Paste the SD-JWT presentation or let it auto-fill from the wallet share.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Field
            label="Presentation Token (SD-JWT + Key Binding)"
            htmlFor="presentation"
            hint="Format: signed JWT, then selective disclosure digests (~). Only student-consented claims exist here."
          >
            <textarea
              id="presentation"
              className="w-full rounded-xl border border-slate-300 bg-white p-3 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-28"
              spellCheck={false}
              placeholder="eyJhbGciOi...~WyJ...~eyJhbGciOi..."
              value={presentation}
              disabled={verify.pending}
              onChange={(event) => setPresentation(event.target.value)}
            />
          </Field>

          {/* Presentation preview */}
          {preview && (
            <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-blue-800">
                <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                <span>Presentation Preview</span>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {preview.disclosures.length} selective disclosure(s) included:
                  </p>
                  <ul className="mt-1 space-y-1">
                    {preview.disclosures.map((disclosure) => (
                      <li key={disclosure.key} className="text-sm text-slate-700 flex justify-between gap-2 border-b border-blue-100 py-0.5">
                        <span className="text-slate-500">{fieldLabel(disclosure.key)}:</span>{' '}
                        <span className="font-semibold">{formatValue(disclosure.value)}</span>
                      </li>
                    ))}
                    {preview.disclosures.length === 0 && (
                      <li className="text-sm text-rose-600">No disclosures found.</li>
                    )}
                  </ul>
                </div>
                <div className="text-sm text-slate-600">
                  <p>
                    The SD-JWT holds {preview.digestCount} SHA-256 digest(s) in <code>_sd</code>. Undisclosed claims are mathematically unreadable.
                  </p>
                  {preview.payload && (
                    <div className="mt-2 rounded-lg bg-white p-2 font-mono text-xs text-slate-500 border border-blue-100">
                      iss: {String(preview.payload.iss)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <InlineError error={verify.error} />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="md"
              loading={verify.pending}
              disabled={!canVerify}
              onClick={() => void runVerify()}
              icon={<CheckCircle2 className="h-4 w-4" />}
            >
              Verify Presentation
            </Button>
            {presentation && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setPresentation('');
                  setResult(null);
                  verify.clearError();
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {result && <VerificationResult result={result} />}

      {/* History */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            <span>Verification Activity History</span>
          </h2>
          {profile.data && profile.data.history.length > 0 && (
            <Badge tone="neutral">{profile.data.history.length} Verified</Badge>
          )}
        </div>

        {profile.data && profile.data.history.length === 0 && (
          <EmptyState
            icon={<ShieldCheck className="h-6 w-6" />}
            title="No verifications yet"
            description="When students share document presentations with your organization and you verify them, the log will appear here."
          />
        )}

        {profile.data && profile.data.history.length > 0 && (
          <div className="space-y-2.5">
            {profile.data.history.map((entry) => (
              <Card
                key={entry.eventId}
                className={`p-4 border ${
                  entry.result === 'granted'
                    ? 'border-emerald-200 hover:border-emerald-300'
                    : 'border-rose-200 hover:border-rose-300'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-bold text-slate-900">
                      {entry.citizen.name}
                      <span className="font-normal text-slate-500">
                        {' '}· {entry.credential?.typeLabel ?? 'Document'}
                        {entry.consentId ? ` · Consent #${entry.consentId}` : ''}
                      </span>
                    </p>
                    {entry.purpose && (
                      <p className="mt-0.5 text-sm text-slate-600">“{entry.purpose}”</p>
                    )}
                  </div>
                  <Badge tone={entry.result === 'granted' ? 'granted' : 'denied'}>
                    {entry.result === 'granted' ? '✓ Granted' : '✕ Denied'}
                  </Badge>
                </div>

                {entry.result === 'granted' && entry.revealedFields.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {entry.revealedFields.map((field) => (
                      <Badge key={field} tone="info">
                        {fieldLabel(field)}
                      </Badge>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-400">
                  {formatDateTime(entry.createdAt)}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VerificationResult({ result }: { result: VerifyResponse }) {
  const granted = result.result === 'granted';
  const checkById = new Map<CheckId, CheckResult>(result.checks.map((check) => [check.id, check]));
  const subChecks = (id: CheckId) => result.checks.filter((check) => SUB_OF[check.id] === id);

  return (
    <div className="space-y-4">
      {/* Verdict */}
      <div
        className={`animate-fade-in rounded-2xl border p-5 ${
          granted
            ? 'border-emerald-300 bg-emerald-50/90 text-emerald-900'
            : 'border-rose-300 bg-rose-50/90 text-rose-900'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {granted ? (
              <CheckCircle2 className="h-7 w-7 text-emerald-600 shrink-0" />
            ) : (
              <XCircle className="h-7 w-7 text-rose-600 shrink-0" />
            )}
            <div>
              <h2 className="text-xl font-bold">
                {granted ? 'Access Granted' : 'Access Denied'}
              </h2>
              <p className="mt-0.5 text-sm opacity-90">
                {granted
                  ? `${result.consent?.credentialTypeLabel ?? result.credential?.typeLabel ?? 'Document'} confirmed${result.credential?.issuer ? ` from ${result.credential.issuer.name}` : ''}.`
                  : 'The verifier received no personal data. One or more checks failed.'}
              </p>
            </div>
          </div>
          <Badge tone={granted ? 'granted' : 'denied'} size="md">
            {result.checks.filter((c) => c.passed).length}/{result.checks.length} Checks Passed
          </Badge>
        </div>
        <p className="mt-3 text-xs opacity-75 font-mono">
          Verified at {formatDateTime(result.verifiedAt)}
          {result.credential ? ` · Document #${result.credential.id}` : ''}
          {result.consent ? ` · Consent #${result.consent.id}` : ''}
        </p>
      </div>

      {/* Verified Attachment if shared */}
      {granted && result.attachment && (
        <Card className="p-5 border-blue-200">
          <CardHeader className="px-0 pt-0 pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-slate-900">
              <FileText className="h-5 w-5 text-blue-600" />
              <span>Verified Attached Document: {result.attachment.name}</span>
            </CardTitle>
            <CardDescription className="text-sm">
              Type: {result.attachment.mime} · Size: {(result.attachment.size / 1024).toFixed(1)} KB · Decrypted and verified with active student consent
            </CardDescription>
          </CardHeader>
          <div className="h-96 mt-2 rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
            <FileViewer
              url={api.verifierAttachmentUrl(result.attachment.id)}
              fileName={result.attachment.name}
              mimeType={result.attachment.mime}
              fileSize={result.attachment.size}
            />
          </div>
        </Card>
      )}

      {/* The checks */}
      <Card>
        <CardHeader>
          <CardTitle>Core Cryptographic Checks</CardTitle>
          <CardDescription>All 9 cryptographic rules executed in sequential order.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {HEADLINE.map((id) => {
              const check = checkById.get(id);
              if (!check) return null;
              const subs = subChecks(id);
              return (
                <div
                  key={id}
                  className={`rounded-xl border p-3.5 flex items-start gap-2.5 ${
                    check.passed
                      ? 'border-emerald-200 bg-emerald-50/50'
                      : 'border-rose-200 bg-rose-50/50'
                  }`}
                >
                  {check.passed ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900">{check.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{check.detail}</p>
                    {subs.map((sub) => (
                      <div
                        key={sub.id}
                        className={`mt-1.5 flex items-start gap-1.5 border-t pt-1.5 text-xs ${
                          sub.passed ? 'border-emerald-200 text-emerald-700' : 'border-rose-200 text-rose-700'
                        }`}
                      >
                        <span>{sub.passed ? '✓' : '✕'}</span>
                        <span>
                          <strong>{sub.label}:</strong> {sub.detail}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* What was actually revealed */}
      <Card>
        <CardHeader>
          <CardTitle>Disclosed Fields (Student Consent)</CardTitle>
          <CardDescription>
            {granted
              ? `${result.revealedFields.length} field(s) revealed. Protected fields remained confidential.`
              : 'No fields were disclosed due to failed verification.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {granted && Object.keys(result.revealed).length > 0 ? (
            <KeyValueDisplay data={result.revealed} />
          ) : (
            <p className="text-sm text-slate-500">
              {granted
                ? 'No fields were included in this presentation.'
                : 'The verifier got an empty response.'}
            </p>
          )}

          {granted && result.withheldFields.length > 0 && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <p className="text-sm font-bold uppercase tracking-wider text-slate-500">
                Kept Private by the Student
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {result.withheldFields.map((key) => (
                  <Badge key={key} tone="neutral">
                    {fieldLabel(key)}
                  </Badge>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                These fields exist inside the signed document, but they were never disclosed. The verifier cannot see them.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Traditional vs GitLink comparison */}
      {result.comparison && (
        <Card>
          <CardHeader>
            <CardTitle>GitLink vs. Traditional Verification</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">With GitLink</p>
                <p className="mt-1 text-lg font-bold text-emerald-900">
                  {result.comparison.gitlink.summary}
                </p>
                <ul className="mt-2 space-y-1 text-sm text-emerald-800">
                  <li>• {result.revealedFields.length} field(s) disclosed, chosen by the student</li>
                  <li>• {result.comparison.gitlink.formsFilled} forms filled</li>
                  <li>• Cryptographic instant proof, zero document handling</li>
                </ul>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Traditional Process</p>
                <p className="mt-1 text-lg font-bold text-slate-700">
                  {result.comparison.traditional.summary}
                </p>
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  <li>• {result.comparison.traditional.verificationTime} of manual check delay</li>
                  <li>• {result.comparison.traditional.documentsUploaded}+ documents re-uploaded</li>
                  <li>• Student has no consent or revocation control</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Audit verification summary */}
      <details className="pt-2">
        <summary className="cursor-pointer text-sm font-semibold text-slate-600 hover:text-slate-900">
          Show cryptographic verification summary
        </summary>
        <div className="mt-2">
          <KeyValueDisplay
            data={{
              result: result.result,
              verifiedAt: result.verifiedAt,
              checksRun: `${result.checks.filter((c) => c.passed).length} of ${result.checks.length} passed`,
              revealedFieldsCount: result.revealedFields.length,
              withheldFieldsCount: result.withheldFields.length,
              attachmentIncluded: result.attachment ? `Yes (${result.attachment.name}, ${(result.attachment.size / 1024).toFixed(1)} KB)` : 'No',
            }}
          />
        </div>
      </details>
    </div>
  );
}
