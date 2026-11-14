/**
 * Layer 1: Cloud Run detection shared by the Anthropic auth and Slack.
 */
import { describe, expect, it } from '@jest/globals';
import { isCloudRun } from '@/lib/utils/cloud-run';

describe('isCloudRun', () => {
  it('is true on a Cloud Run Service (K_SERVICE) or Job (CLOUD_RUN_JOB)', () => {
    expect(isCloudRun({ K_SERVICE: 'ai-writer' })).toBe(true);
    expect(isCloudRun({ CLOUD_RUN_JOB: 'ai-writer-job' })).toBe(true);
  });

  it('is false when neither is set, or both are blank', () => {
    expect(isCloudRun({})).toBe(false);
    expect(isCloudRun({ K_SERVICE: '  ', CLOUD_RUN_JOB: '' })).toBe(false);
  });
});
