import { DisabledAttachmentScanner, parseClamavResponse } from './attachment-scanner.service';

describe('parseClamavResponse', () => {
  it('accepts a clean stream', () => {
    expect(parseClamavResponse('stream: OK\0')).toEqual({ clean: true });
  });

  it('extracts the signature of an infected stream', () => {
    expect(parseClamavResponse('stream: Eicar-Test-Signature FOUND')).toEqual({
      clean: false,
      signature: 'Eicar-Test-Signature',
    });
  });

  it('rejects an unrecognized response', () => {
    expect(() => parseClamavResponse('stream: something else')).toThrow();
  });
});

describe('DisabledAttachmentScanner', () => {
  it('reports every upload as clean', async () => {
    await expect(new DisabledAttachmentScanner().scan()).resolves.toEqual({ clean: true });
  });
});
