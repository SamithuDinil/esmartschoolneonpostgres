/** Plays the E-SmartSchool three-note notification motif (C5–E5–G5). */
export function playNotificationChime(): void {
  if (typeof window === "undefined") return;
  try {
    const legacyWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
    const AudioContextConstructor = window.AudioContext ?? legacyWindow.webkitAudioContext;
    if (!AudioContextConstructor) return;

    const context = new AudioContextConstructor();
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    const master = context.createGain();
    master.gain.setValueAtTime(0.72, context.currentTime);
    master.connect(context.destination);

    const notes = [
      { frequency: 523.25, offset: 0 },
      { frequency: 659.25, offset: 0.14 },
      { frequency: 783.99, offset: 0.28 },
    ];
    let remainingOscillators = notes.length * 2;

    for (const { frequency, offset } of notes) {
      for (const partial of [
        { multiplier: 1, level: 0.115 },
        { multiplier: 2, level: 0.022 },
      ]) {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        const start = context.currentTime + 0.025 + offset;
        const end = start + 0.43;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency * partial.multiplier, start);
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(partial.level, start + 0.018);
        envelope.gain.exponentialRampToValueAtTime(partial.level * 0.42, start + 0.13);
        envelope.gain.exponentialRampToValueAtTime(0.0001, end);
        oscillator.connect(envelope);
        envelope.connect(master);
        oscillator.start(start);
        oscillator.stop(end + 0.015);
        oscillator.onended = () => {
          remainingOscillators -= 1;
          if (remainingOscillators === 0 && context.state !== "closed") void context.close();
        };
      }
    }
  } catch {
    // Audio is optional and browsers may block it until the user interacts with the page.
  }
}
