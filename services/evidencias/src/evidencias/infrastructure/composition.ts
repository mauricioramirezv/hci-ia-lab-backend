import type { Pool } from 'pg';
import type { Config } from '../../config.js';
import { EvidenceApplication } from '../application/use-cases.js';
import { PostgresEvidenceRepository } from './postgres-evidence.js';
import { LearningAccessHttpClient } from './learning-access-client.js';
import { CommunityAccessHttpClient } from './community-access-client.js';

export function createEvidenceApplication(pool: Pool, config: Config) {
  return new EvidenceApplication(
    new PostgresEvidenceRepository(pool),
    new LearningAccessHttpClient(config.learningBaseUrl, config.identityInternalToken),
    new CommunityAccessHttpClient(config.communityBaseUrl, config.identityInternalToken),
  );
}
