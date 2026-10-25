const PREFERENCE_KEY = 'bizchat:offer-sound';

/** Whether this browser plays a sound for new offers (on unless the consultant muted it). */
export function offerSoundEnabled(): boolean {
  try {
    return window.localStorage.getItem(PREFERENCE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setOfferSoundEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(PREFERENCE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* Storage may be unavailable; the sound simply stays on. */
  }
}

let context: AudioContext | undefined;

/**
 * A short two-note chime, synthesised so no audio file is shipped. Browsers block audio until the
 * page has had a user gesture; the chime then fails silently and the visual card still shows.
 */
export function playOfferChime(): void {
  if (!offerSoundEnabled() || typeof window.AudioContext !== 'function') return;
  try {
    context ??= new window.AudioContext();
    const start = context.currentTime;
    for (const [offset, frequency] of [
      [0, 880],
      [0.16, 1175],
    ] as const) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.25);
    }
  } catch {
    /* Audio is a convenience only. */
  }
}
