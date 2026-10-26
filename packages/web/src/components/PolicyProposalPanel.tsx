import { useT } from '../i18n/context.tsx';
import type { TableController } from '../state/useTable.ts';

/**
 * Post-start room-policy consent (docs/SPEC.md §5.8).
 *
 * Rendered in the lobby *and* during play: after start a policy change is a
 * proposal that needs every original seat's consent, and a player who is
 * already at the board must still be able to see and answer it.
 */
export function PolicyProposalPanel({ controller }: { controller: TableController }) {
  const t = useT();
  const { state, actions } = controller;
  const room = state.room;
  const proposal = room?.pendingPolicy ?? null;
  if (!room || !proposal) return null;

  const approved = proposal.consents.length;
  const total = room.members.length;

  return (
    <section className="card" aria-labelledby="proposal-heading" data-testid="policy-proposal">
      <h2 id="proposal-heading">{t('lobby.policyProposal')}</h2>
      <p className="muted" data-testid="policy-consent-count">
        {t('lobby.policyConsentCount', { approved, total })}
      </p>
      <ul>
        <li>
          {t('lobby.policy.turnClockSeconds')}: {proposal.before.turnClockSeconds} →{' '}
          {proposal.after.turnClockSeconds}
        </li>
        <li>
          {t('lobby.policy.disconnectGraceSeconds')}: {proposal.before.disconnectGraceSeconds} →{' '}
          {proposal.after.disconnectGraceSeconds}
        </li>
        <li>
          {t('lobby.policy.allowAbandonment')}:{' '}
          {proposal.after.allowAbandonment ? t('app.yes') : t('app.no')}
        </li>
      </ul>
      <button
        type="button"
        className="button button--primary"
        data-testid="policy-approve"
        onClick={() => void actions.respondPolicy(proposal.id, true)}
      >
        {t('lobby.policyApprove')}
      </button>
      <button
        type="button"
        className="button"
        data-testid="policy-reject"
        onClick={() => void actions.respondPolicy(proposal.id, false)}
      >
        {t('lobby.policyReject')}
      </button>
    </section>
  );
}
