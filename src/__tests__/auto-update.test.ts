import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => JSON.stringify({
    version: '3.5.2',
    installedAt: '2026-01-01T00:00:00.000Z',
    installMethod: 'npm'
  })),
  writeFileSync: vi.fn()
}));

vi.mock('child_process', () => ({
  execFileSync: mocks.execFileSync
}));

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync
}));

import {
  NPM_PACKAGE_NAME,
  normalizeReleaseVersion,
  performUpdate
} from '../features/auto-update.js';

function mockRelease(tagName: string): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      tag_name: tagName,
      name: tagName,
      published_at: '2026-01-02T00:00:00.000Z',
      html_url: 'https://example.invalid/release',
      body: '',
      prerelease: false,
      draft: false
    })
  }));
}

describe('auto-update security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('normalizes complete semantic release versions', () => {
    expect(normalizeReleaseVersion('v3.5.3')).toBe('3.5.3');
    expect(normalizeReleaseVersion('3.6.0-rc.1')).toBe('3.6.0-rc.1');
  });

  it.each([
    'latest',
    'v3.5',
    'v3.5.3; touch /tmp/pwned',
    'v3.5.3 || echo unsafe',
    'v03.5.3'
  ])('rejects an unsafe or incomplete release version: %s', (version: string) => {
    expect(() => normalizeReleaseVersion(version)).toThrow('Invalid release version');
  });

  it('installs the exact release through npm without invoking a shell', async () => {
    mockRelease('v3.5.3');

    const result = await performUpdate();

    expect(result.success).toBe(true);
    expect(result.newVersion).toBe('3.5.3');
    expect(mocks.execFileSync).toHaveBeenCalledTimes(1);
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['install', '--global', `${NPM_PACKAGE_NAME}@3.5.3`],
      expect.objectContaining({ windowsHide: true })
    );
    expect(mocks.execFileSync.mock.calls[0]?.[2]).not.toHaveProperty('shell');
  });

  it('does not execute npm when release metadata contains an invalid version', async () => {
    mockRelease('v3.5.3; touch /tmp/pwned');

    const result = await performUpdate();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid release version');
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });
});
