/**
 * Legacy issuer portal (kept so old imports keep compiling).
 * The unified ORGANIZATION dashboard (OrganizationTab) is now the supported
 * issuer UI: direct issuance lives there alongside document review.
 */
import { Card } from '../components/ui';

export function IssuerTab(_props: { citizens?: unknown[] }) {
  return (
    <Card
      title="Issuer portal moved"
      subtitle="Issuance now lives in the Organization dashboard (unified ORGANIZATION role)."
    >
      <p className="text-sm text-slate-600">
        Log in as an organization (e.g. university@lifelink.demo) to issue credentials directly,
        review citizen documents, and verify presentations.
      </p>
    </Card>
  );
}
