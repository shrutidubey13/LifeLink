/**
 * Admin: trust registry (approve/suspend/revoke organizations, register new
 * ones) + system-wide audit. Only ADMIN tokens can call these endpoints.
 */
import { useState } from 'react';
import {
  Shield,
  RotateCcw,
  PlusCircle,
  Building,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useRequest } from '../lib/hooks';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  ErrorBlock,
  Field,
  InlineError,
  PageHeader,
  SkeletonList,
  TruncatedHash,
  useToast,
} from '../components/ui';
import { useTitle } from '../lib/useTitle';

const STATUSES = ['PENDING', 'TRUSTED', 'SUSPENDED', 'REVOKED'] as const;

export function AdminTab() {
  useTitle('Trust Registry');
  const { toast } = useToast();
  const issuers = useRequest(() => api.adminIssuers(), 'admin-issuers');
  const setStatus = useAction(api.adminSetIssuerStatus);
  const create = useAction(api.adminCreateIssuer);

  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgType, setOrgType] = useState('University');

  // Destructive action confirmation state
  const [confirmStatusChange, setConfirmStatusChange] = useState<{
    id: number;
    name: string;
    targetStatus: string;
  } | null>(null);

  async function handleStatus(id: number, status: string) {
    if (status === 'SUSPENDED' || status === 'REVOKED') {
      const org = issuers.data?.issuers.find((o) => o.id === id);
      setConfirmStatusChange({
        id,
        name: org?.name ?? `Organization #${id}`,
        targetStatus: status,
      });
      return;
    }

    const res = await setStatus.run(id, status);
    if (res) {
      toast.success(`Organization status changed to ${status}`);
      issuers.reload();
    }
  }

  async function confirmStatusAction() {
    if (!confirmStatusChange) return;
    const res = await setStatus.run(
      confirmStatusChange.id,
      confirmStatusChange.targetStatus,
    );
    if (res) {
      toast.success(
        `${confirmStatusChange.name} set to ${confirmStatusChange.targetStatus}.`,
      );
      setConfirmStatusChange(null);
      issuers.reload();
    }
  }

  async function handleCreate() {
    const res = await create.run({
      name: name.trim(),
      domain: domain.trim().toLowerCase(),
      email: email.trim(),
      password,
      orgType,
    });
    if (res) {
      toast.success(
        `Registered ${res.issuer.name} as PENDING. Set TRUSTED to activate.`,
      );
      setName('');
      setDomain('');
      setEmail('');
      setPassword('');
      issuers.reload();
    }
  }

  const list = issuers.data?.issuers ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trust Registry"
        subtitle="Manage approved cryptographic issuers and verifiers. Only trusted organizations can sign verifiable credentials."
        badge={
          list.length > 0 && (
            <Badge tone="trusted" size="md">
              {list.length} Registered
            </Badge>
          )
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={() => issuers.reload()}
          >
            Refresh
          </Button>
        }
      />

      {/* Organizations Registry List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            <span>Registered Organizations</span>
          </h2>
        </div>

        {issuers.loading && !issuers.data && <SkeletonList count={3} />}
        {issuers.error && <ErrorBlock message={issuers.error} onRetry={issuers.reload} />}

        {issuers.data && list.length === 0 && (
          <EmptyState
            icon={<Building className="h-6 w-6" />}
            title="No organizations registered"
            description="Use the form below to register universities, employers, banks, or governments."
          />
        )}

        <div className="space-y-3">
          {list.map((org) => {
            const statusTone =
              org.status === 'TRUSTED'
                ? 'trusted'
                : org.status === 'PENDING'
                ? 'pending'
                : 'untrusted';

            return (
              <Card key={org.id} className="p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-slate-900">
                        {org.name}
                      </span>
                      <Badge tone={statusTone} size="md">
                        {org.status}
                      </Badge>
                      <Badge tone="info">{org.orgType ?? 'Organization'}</Badge>
                      <Badge tone="neutral">
                        Can Issue: {org.canIssue ? 'Yes' : 'No'}
                      </Badge>
                      {typeof org.credentialsIssued === 'number' && (
                        <Badge tone="neutral">
                          {org.credentialsIssued} issued
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-500">
                      <span>DID:</span>
                      <TruncatedHash value={org.did} start={14} end={8} />
                    </div>
                  </div>

                  {/* Status transition buttons */}
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {STATUSES.filter((s) => s !== org.status).map((s) => {
                      const isDestructive = s === 'SUSPENDED' || s === 'REVOKED';
                      return (
                        <Button
                          key={s}
                          variant={isDestructive ? 'danger-outline' : 'secondary'}
                          size="xs"
                          disabled={setStatus.pending}
                          onClick={() => void handleStatus(org.id, s)}
                        >
                          → {s}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
        <InlineError error={setStatus.error} />
      </div>

      {/* Register Organization Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-blue-600" />
            <span>Register New Organization</span>
          </CardTitle>
          <CardDescription>
            Generates an Ed25519 cryptographic keypair, did:key identity, W3C Bitstring Status List, and PENDING status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Organization Name" htmlFor="ad-name">
              <input
                id="ad-name"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. State University"
              />
            </Field>

            <Field label="Domain / Realm" htmlFor="ad-domain">
              <input
                id="ad-domain"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="university.example.edu"
              />
            </Field>

            <Field label="Login Email" htmlFor="ad-email">
              <input
                id="ad-email"
                type="email"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@university.example.edu"
              />
            </Field>

            <Field label="Initial Password" htmlFor="ad-pass" hint="Minimum 8 characters">
              <input
                id="ad-pass"
                type="password"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>

            <Field label="Organization Type" htmlFor="ad-type">
              <select
                id="ad-type"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={orgType}
                onChange={(e) => setOrgType(e.target.value)}
              >
                {[
                  'University',
                  'College',
                  'School',
                  'Employer',
                  'Bank',
                  'Hospital',
                  'Government',
                ].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <InlineError error={create.error} />

          <div className="mt-5 flex justify-end">
            <Button
              variant="primary"
              size="md"
              loading={create.pending}
              disabled={
                !name.trim() ||
                !domain.trim() ||
                !email.trim() ||
                password.length < 8
              }
              onClick={() => void handleCreate()}
            >
              Register Organization (PENDING)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Dialog for Destructive Status Change */}
      {confirmStatusChange && (
        <ConfirmDialog
          isOpen
          title={`Set status to ${confirmStatusChange.targetStatus}?`}
          description={
            confirmStatusChange.targetStatus === 'REVOKED'
              ? `Are you sure you want to REVOKE trust for ${confirmStatusChange.name}? Any credentials previously signed by this organization will fail trust checks.`
              : `Are you sure you want to SUSPEND ${confirmStatusChange.name}? They will not be able to issue credentials while suspended.`
          }
          confirmLabel={`Confirm ${confirmStatusChange.targetStatus}`}
          tone="danger"
          loading={setStatus.pending}
          onClose={() => setConfirmStatusChange(null)}
          onConfirm={confirmStatusAction}
        />
      )}
    </div>
  );
}
