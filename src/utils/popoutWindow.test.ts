import { parsePopoutFromHash, withPopoutParam, withoutPopoutParam } from '../App';
import {
  buildDocumentPopoutUrl,
  buildPopoutUrl,
  buildPopupFeatures,
  resolvePopupPlacement,
  type PopupMetrics,
} from './popoutWindow';

const features = (value: string): Record<string, string> => Object.fromEntries(
  value.split(',').map((entry) => entry.split('=') as [string, string])
);

const metrics: PopupMetrics = {
  anchorRect: { left: 1200, width: 480 },
  outerWidth: 1716,
  outerHeight: 1000,
  innerWidth: 1700,
  screenX: 100,
  screenY: 40,
  availLeft: 0,
  availTop: 0,
  availWidth: 2560,
  availHeight: 1400,
};

describe('popout hash route', () => {
  it('adds, reads, and removes popout=panel while keeping other params', () => {
    const hash = withPopoutParam('#/John/3/16?q=love');
    expect(hash).toBe('#/John/3/16?q=love&popout=panel');
    expect(parsePopoutFromHash(hash)).toBe('panel');
    expect(withoutPopoutParam(hash)).toBe('#/John/3/16?q=love');
  });

  it('handles empty and param-less hashes', () => {
    expect(withPopoutParam('')).toBe('#/?popout=panel');
    expect(parsePopoutFromHash('#/John/3/16')).toBeNull();
    expect(withoutPopoutParam('#/John/3/16')).toBe('#/John/3/16');
    expect(withPopoutParam('#/John/3?popout=panel')).toBe('#/John/3?popout=panel');
  });

  it('builds the popout URL without the open document', () => {
    expect(buildPopoutUrl({ pathname: '/app/', search: '?x=1', hash: '#/Romans/8/28?doc=abc&page=2' }))
      .toBe('/app/?x=1#/Romans/8/28?popout=panel');
  });

  it('builds the document popout URL as a regular verse route', () => {
    expect(buildDocumentPopoutUrl({ pathname: '/app/', search: '', hash: '#/Romans/8/28?doc=abc&page=2&popout=panel' }))
      .toBe('/app/#/Romans/8/28');
    expect(buildDocumentPopoutUrl({ pathname: '/', search: '', hash: '#/John/3?q=love' })).toBe('/#/John/3?q=love');
  });
});

describe('buildPopupFeatures', () => {
  it('opens over the docked panel at its width (plus window chrome) and the source height', () => {
    const result = features(buildPopupFeatures(metrics));
    expect(result).toMatchObject({
      popup: 'yes',
      width: '496',
      height: '1000',
      left: '1300',
      top: '40',
      resizable: 'yes',
    });
  });

  it('clamps the window onto the available screen', () => {
    const result = features(buildPopupFeatures({
      ...metrics,
      screenX: 1400,
      screenY: 600,
      availWidth: 1920,
      availHeight: 1080,
    }));
    expect(result).toMatchObject({ width: '496', height: '1000', left: '1424', top: '80' });
  });

  it('reopens at the remembered bounds when they still fit on the current screen', () => {
    const saved = { left: 200, top: 100, width: 640, height: 800, outerWidth: 656, outerHeight: 880 };
    expect(features(buildPopupFeatures(metrics, saved))).toMatchObject({
      width: '640',
      height: '800',
      left: '200',
      top: '100',
      resizable: 'yes',
    });
  });

  it('ignores remembered bounds that are off the current screen', () => {
    const saved = { left: 3000, top: 100, width: 640, height: 800, outerWidth: 656, outerHeight: 880 };
    expect(features(buildPopupFeatures(metrics, saved))).toMatchObject({ width: '496', left: '1300' });
  });

  it('with every screen known, defaults to the other screen and restores spots on any connected screen', () => {
    const secondary = { availLeft: 2560, availTop: 0, availWidth: 1920, availHeight: 1040 };
    const layout = {
      screens: [{ availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1400 }, secondary],
      other: secondary,
    };

    expect(resolvePopupPlacement(metrics, null, layout)).toEqual({
      width: 496,
      height: 1000,
      left: 2560 + 712,
      top: 20,
      source: 'other-screen',
    });

    const onSecondary = { left: 3000, top: 100, width: 640, height: 800, outerWidth: 656, outerHeight: 880 };
    expect(resolvePopupPlacement(metrics, onSecondary, layout)).toMatchObject({ left: 3000, source: 'saved' });

    const disconnected = { ...onSecondary, left: 5000 };
    expect(resolvePopupPlacement(metrics, disconnected, layout)).toMatchObject({ source: 'other-screen' });
  });

  it('shrinks a window that is too big for the other screen', () => {
    const small = { availLeft: -1280, availTop: 0, availWidth: 1280, availHeight: 720 };
    expect(resolvePopupPlacement(metrics, null, { screens: [small], other: small }))
      .toEqual({ width: 496, height: 720, left: -1280 + 392, top: 0, source: 'other-screen' });
  });

  it('falls back to a centered window when the panel cannot be measured', () => {
    const result = features(buildPopupFeatures({ ...metrics, anchorRect: null }));
    expect(result).toMatchObject({ width: '1400', height: '920', left: '258', top: '80' });
  });
});
