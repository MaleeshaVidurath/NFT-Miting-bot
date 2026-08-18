import type { Detector } from './types.js';
import { openSeaCollectionsDetector } from './openSeaDrops.js';
import { seaDropEventDetector } from './seaDropEvents.js';
import { log } from '../../core/logger.js';

/** Active detection strategies. Add new ones here. */
export const detectors: Detector[] = [
  // Earliest signal: fires when a drop is scheduled, before it opens.
  seaDropEventDetector(),
  // Secondary: new collections listed on OpenSea. Needs OPENSEA_API_KEY.
  openSeaCollectionsDetector(),
];

export function assertDetectorsConfigured(): void {
  if (detectors.length === 0) {
    log.warn('No detectors registered - the hunter will idle. Add one in src/detect/index.ts');
  }
}

export type { Detector, MintCandidate, CandidateHandler } from './types.js';
