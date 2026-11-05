import { getReleaseTagName, getReleaseTagUrl, isBetaAppVersion } from './appBuildIdentityFormat';

describe('appBuildIdentityFormat', () => {
  it('detects beta versions and strips the sha for the release tag', () => {
    expect(isBetaAppVersion('v2026.11.00-a1b2c3d')).toBe(true);
    expect(getReleaseTagName('v2026.11.00-a1b2c3d')).toBe('v2026.11.00');
    expect(getReleaseTagUrl('v2026.11.00-a1b2c3d')).toBe(
      'https://github.com/marginaliabible/Marginalia.UI/releases/tag/v2026.11.00'
    );
  });

  it('links prod tags to their release page without treating them as beta', () => {
    expect(isBetaAppVersion('v2026.11.00')).toBe(false);
    expect(getReleaseTagName('v2026.11.00')).toBe('v2026.11.00');
    expect(getReleaseTagUrl('v2026.11.00')).toBe(
      'https://github.com/marginaliabible/Marginalia.UI/releases/tag/v2026.11.00'
    );
  });

  it('leaves local/dev builds unlinked', () => {
    expect(isBetaAppVersion('dev')).toBe(false);
    expect(getReleaseTagName('dev')).toBeNull();
    expect(getReleaseTagUrl('dev')).toBeNull();
  });
});
