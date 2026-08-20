/**
 * Program-aware transmit: routes a T2 engagement through CIF and an AT1
 * engagement through Net File. Keeps the `transmit` action thin.
 */
import { createError } from '@classytic/repo-core/errors';
import engagementYearRepository from '#resources/engagement/engagement-year/engagement-year.repository.js';
import type { Certification } from '../engine/at1-netfile.service.js';
import { transmitAt1 } from './at1-transmit.service.js';
import { transmitCo17 } from './co17-transmit.service.js';
import { transmitT2Cif } from './t2-transmit.service.js';

export async function transmitReturn(params: {
  engagementId: string;
  orgId: string;
  userId: string;
  certification: Certification;
}) {
  const engagement = await engagementYearRepository.getOne({
    _id: params.engagementId,
    organizationId: params.orgId,
  });
  if (!engagement) throw createError(404, 'Engagement year not found');
  if (engagement.program === 'T2') return transmitT2Cif(params);
  if (engagement.program === 'CO17') return transmitCo17(params);
  return transmitAt1(params);
}
