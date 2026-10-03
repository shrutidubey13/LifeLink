/**
 * Admin: trust registry (approve/suspend/revoke organizations, register new
 * ones) + system-wide audit. Only ADMIN tokens can call these endpoints.
 */
import { useState } from 'react';
import { api } from '../lib/api';
import { useAction, useRequest } from '../lib/hooks';
import { Badge, Card, DidTag, ErrorBlock, Field, InlineError, LoadingBlock, SectionTitle, Spinner } from '../components/ui';

const STATUSES = ['PENDING', 'TRUSTED', 'SUSPENDED', 'REVOKED'] as const;

export function AdminTab() {
  const issuers = useRequest(() => api.adminIssuers(), 'admin-issuers');
  const setStatus = useAction(api.adminSetIssuerStatus);
  const create = useAction(api.adminCreateIssuer);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgType, setOrgType] = useState('University');
  const [flash, setFlash] = useState<string | null>(null);

  async function handleStatus(id: number, status: string) {
    const res = await setStatus.run(id, status);
    if (res) issuers.reload();
  }

  async function handleCreate() {
    setFlash(null);
    const res = await create.run({ name: name.trim(), domain: domain.trim().toLowerCase(), email: email.trim(), password, orgType });
    if (res) {
      setFlash(`Created ${res.issuer.name} as PENDING. Set TRUSTED to activate.`);
      setName('');
      setDomain('');
      setEmail('');
      setPassword('');
      issuers.reload();
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <SectionTitle hint={issuers.data ? `${issuers.data.issuers.length} organizations` : undefined}>
          Trust registry — organizations
        </SectionTitle>
        {issuers.loading && <LoadingBlock label="Loading organizations…" />}
        {issuers.error && <ErrorBlock message={issuers.error} onRetry={issuers.reload} />}
        <div className="space-y-2">
          {(issuers.data?.issuers ?? []).map((org) => (
            <Card key={org.id} className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{org.name}</span>
                    <Badge tone={org.status === 'TRUSTED' ? 'trusted' : org.status === 'PENDING' ? 'info' : 'untrusted'}>{org.status}</Badge>
                    <Badge tone="neutral">{org.orgType ?? 'Organization'}</Badge>
                    <Badge tone="neutral">issue:{org.canIssue ? 'y' : 'n'} verify:{org.canVerify ? 'y' : 'n'}</Badge>
                    {typeof org.credentialsIssued === 'number' && <Badge tone="neutral">{org.credentialsIssued} issued</Badge>}
                  </div>
                  <p className="mt-1"><DidTag did={org.did} /></p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {STATUSES.filter((s) => s !== org.status).map((s) => (
                    <button key={s} type="button" className="btn-secondary" disabled={setStatus.pending} onClick={() => void handleStatus(org.id, s)}>
                      → {s}
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
        <InlineError error={setStatus.error} />
      </div>

      <Card title="Register organization" subtitle="Creates a fresh encrypted signing key, PENDING status, and empty status list.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="ad-name"><input id="ad-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ABC College" /></Field>
          <Field label="Domain" htmlFor="ad-domain"><input id="ad-domain" className="input font-mono text-xs" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="college.example.com" /></Field>
          <Field label="Login email" htmlFor="ad-email"><input id="ad-email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="college@lifelink.demo" /></Field>
          <Field label="Password" htmlFor="ad-pass"><input id="ad-pass" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 8 chars" /></Field>
          <Field label="Organization type" htmlFor="ad-type">
            <select id="ad-type" className="input" value={orgType} onChange={(e) => setOrgType(e.target.value)}>
              {['University', 'College', 'School', 'Employer', 'Bank', 'Hospital', 'Government'].map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
          </Field>
        </div>
        <InlineError error={create.error} />
        {flash && <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</p>}
        <button type="button" className="btn-primary mt-3" disabled={create.pending || !name.trim() || !domain.trim() || !email.trim() || password.length < 8} onClick={() => void handleCreate()}>
          {create.pending ? <Spinner /> : null} Register (PENDING)
        </button>
      </Card>
    </div>
  );
}
