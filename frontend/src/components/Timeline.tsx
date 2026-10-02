/**
 * The life-stage journey: Education -> Employment -> Finance -> Healthcare.
 *
 * A step turns green when the citizen holds a VALID credential of that type.
 * A grey step means "nothing here yet"; an amber step means "you have one, but
 * it expired"; a rose step means "revoked, so it no longer counts".
 */
import { STAGES, type Stage } from '../lib/catalog';
import type { Credential } from '../lib/types';

type StepState = 'done' | 'expired' | 'revoked' | 'empty';

const RING: Record<StepState, string> = {
  done: 'bg-emerald-500 text-white ring-emerald-200',
  expired: 'bg-amber-400 text-white ring-amber-200',
  revoked: 'bg-rose-500 text-white ring-rose-200',
  empty: 'bg-slate-200 text-slate-500 ring-slate-100',
};

const TEXT: Record<StepState, string> = {
  done: 'text-emerald-700',
  expired: 'text-amber-700',
  revoked: 'text-rose-700',
  empty: 'text-slate-500',
};

const CAPTION: Record<StepState, string> = {
  done: 'Verified',
  expired: 'Expired',
  revoked: 'Revoked',
  empty: 'Not added',
};

function stateOf(credentials: Credential[], stage: Stage): StepState {
  const matching = credentials.filter((c) => c.type === stage.credentialType);
  if (matching.some((c) => c.status === 'valid')) return 'done';
  if (matching.some((c) => c.status === 'expired')) return 'expired';
  if (matching.some((c) => c.status === 'revoked')) return 'revoked';
  return 'empty';
}

export function Timeline({ credentials }: { credentials: Credential[] }) {
  const done = STAGES.filter((stage) => stateOf(credentials, stage) === 'done').length;

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Your life journey</h2>
        <p className="text-sm text-slate-500">
          {done} of {STAGES.length} stages verified
        </p>
      </div>

      <ol className="grid grid-cols-4 gap-1 sm:gap-3">
        {STAGES.map((stage, index) => {
          const state = stateOf(credentials, stage);
          return (
            <li key={stage.id} className="relative flex flex-col items-center text-center">
              {/* connector line to the previous step */}
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute right-1/2 top-5 -z-0 hidden h-0.5 w-full -translate-y-1/2 sm:block ${
                    state === 'done' ? 'bg-emerald-300' : 'bg-slate-200'
                  }`}
                />
              )}
              <span
                aria-hidden="true"
                className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full text-lg ring-4 transition ${RING[state]}`}
              >
                {stage.icon}
              </span>
              <span className={`mt-2 text-xs font-semibold sm:text-sm ${TEXT[state]}`}>{stage.label}</span>
              <span className="mt-0.5 text-[11px] text-slate-500">{CAPTION[state]}</span>
            </li>
          );
        })}
      </ol>

      <p className="mt-4 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
        One wallet, every stage. You never re-upload a document — you just share the exact fields a
        verifier asks for.
      </p>
    </div>
  );
}
