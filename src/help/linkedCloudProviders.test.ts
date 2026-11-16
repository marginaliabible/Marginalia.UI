import { hasLinkedCloudProvider, setLinkedCloudProviders } from './linkedCloudProviders';

describe('linkedCloudProviders', () => {
  afterEach(() => {
    setLinkedCloudProviders({ google: false, microsoft: false, localFolders: false });
  });

  it('is false when nothing is linked', () => {
    setLinkedCloudProviders({ google: false, microsoft: false, localFolders: false });
    expect(hasLinkedCloudProvider()).toBe(false);
  });

  it('is true for Google or Microsoft', () => {
    setLinkedCloudProviders({ google: true, microsoft: false });
    expect(hasLinkedCloudProvider()).toBe(true);
    setLinkedCloudProviders({ google: false, microsoft: true });
    expect(hasLinkedCloudProvider()).toBe(true);
  });

  it('treats Local Folders machines as a linked notes source', () => {
    setLinkedCloudProviders({ google: false, microsoft: false, localFolders: true });
    expect(hasLinkedCloudProvider()).toBe(true);
  });
});
