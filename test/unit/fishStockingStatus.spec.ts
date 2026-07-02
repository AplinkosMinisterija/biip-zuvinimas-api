'use strict';

// Unit tests for the INSPECTED ("Patikrinta") status rule:
// a completed stocking is INSPECTED only when it has an assigned inspector
// (officer) who ACTUALLY SIGNED (a signature entry carrying a real signature
// value); otherwise it is FINISHED ("Įžuvinta"). The review form pre-fills the
// inspector's name/organization with an empty `signature`, so a non-empty
// signatures array alone must NOT count as inspected.
import { getStatus, isInspected } from '../../utils/functions';
import { FishStockingStatus } from '../../types';

const reviewedBatches = [{ reviewAmount: 5 }] as any;
const unreviewedBatches = [{ reviewAmount: null }] as any;
const settings = { maxTimeForRegistration: 10 } as any;
const ctx = {} as any;

const signed = [{ signedBy: 'x', organization: 'org', signature: 'data:image/png;base64,AAAA' }];
// Pre-filled inspector slot the fish-stocker submitted without the inspector
// actually drawing a signature.
const unsigned = [{ signedBy: 'x', organization: 'org', signature: '' }];

const stocking = (over: any = {}) =>
  ({
    canceledAt: null,
    signatures: null,
    inspector: null,
    eventTime: new Date(),
    ...over,
  } as any);

describe('fishStocking status — INSPECTED requires assigned inspector signature', () => {
  it('real inspector signature + inspector -> INSPECTED', () => {
    const fs = stocking({ signatures: signed, inspector: { id: 1 } });
    expect(isInspected(fs, reviewedBatches)).toBe(true);
    expect(getStatus(ctx, fs, reviewedBatches, settings)).toBe(FishStockingStatus.INSPECTED);
  });

  it('assigned inspector but signature NOT drawn (empty signature) -> FINISHED', () => {
    const fs = stocking({ signatures: unsigned, inspector: { id: 1 } });
    expect(isInspected(fs, reviewedBatches)).toBe(false);
    expect(getStatus(ctx, fs, reviewedBatches, settings)).toBe(FishStockingStatus.FINISHED);
  });

  it('real signature but NO inspector -> FINISHED', () => {
    const fs = stocking({ signatures: signed, inspector: null });
    expect(isInspected(fs, reviewedBatches)).toBe(false);
    expect(getStatus(ctx, fs, reviewedBatches, settings)).toBe(FishStockingStatus.FINISHED);
  });

  it('inspector but NO signature -> FINISHED', () => {
    const fs = stocking({ signatures: null, inspector: { id: 1 } });
    expect(getStatus(ctx, fs, reviewedBatches, settings)).toBe(FishStockingStatus.FINISHED);
  });

  it('empty signature array -> FINISHED', () => {
    const fs = stocking({ signatures: [], inspector: { id: 1 } });
    expect(getStatus(ctx, fs, reviewedBatches, settings)).toBe(FishStockingStatus.FINISHED);
  });

  it('not reviewed -> not INSPECTED', () => {
    const fs = stocking({ signatures: signed, inspector: { id: 1 } });
    expect(isInspected(fs, unreviewedBatches)).toBe(false);
  });
});
