'use strict';

// Unit tests for the INSPECTED ("Patikrinta") status rule:
// a completed stocking is INSPECTED only when it has BOTH a signature AND an
// assigned inspector (officer); otherwise it is FINISHED ("Įžuvinta").
import { getStatus, isInspected } from '../../utils/functions';
import { FishStockingStatus } from '../../types';

const reviewedBatches = [{ reviewAmount: 5 }] as any;
const unreviewedBatches = [{ reviewAmount: null }] as any;
const settings = { maxTimeForRegistration: 10 } as any;
const ctx = {} as any;

const stocking = (over: any = {}) =>
  ({
    canceledAt: null,
    signatures: null,
    inspector: null,
    eventTime: new Date(),
    ...over,
  } as any);

describe('fishStocking status — INSPECTED requires signature + inspector', () => {
  it('signature + inspector -> INSPECTED', () => {
    const fs = stocking({ signatures: [{ signedBy: 'x' }], inspector: { id: 1 } });
    expect(isInspected(fs, reviewedBatches)).toBe(true);
    expect(getStatus(ctx, fs, reviewedBatches, settings)).toBe(FishStockingStatus.INSPECTED);
  });

  it('signature but NO inspector -> FINISHED', () => {
    const fs = stocking({ signatures: [{ signedBy: 'x' }], inspector: null });
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
    const fs = stocking({ signatures: [{ signedBy: 'x' }], inspector: { id: 1 } });
    expect(isInspected(fs, unreviewedBatches)).toBe(false);
  });
});
