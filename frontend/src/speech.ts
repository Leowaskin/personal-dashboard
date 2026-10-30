import { useEffect, useRef, useState } from 'react';

export function speechChunks(text: string, limit = 700): string[] {
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    let rest = paragraph.trim();
    while (rest.length > limit) {
      const prefix = rest.slice(0, limit);
      const sentence = [...prefix.matchAll(/[.!?](?:\s|$)/g)].at(-1);
      const boundary = sentence ? sentence.index! + 1 : prefix.lastIndexOf(' ');
      const cut = boundary > 0 ? boundary : limit;
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) chunks.push(rest);
  }
  return chunks;
}

export function useSpeech() {
  const [enabled, setEnabled] = useState(false);
  const [voice, setVoice] = useState('default');
  const [info, setInfo] = useState<{ supported: boolean; ready: boolean; voices: string[]; message: string }>();
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const enabledRef = useRef(false);
  const voiceRef = useRef('default');
  const controller = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const refresh = async () => {
    try {
      const response = await fetch('/api/v1/speech');
      if (!response.ok) throw new Error();
      setInfo(await response.json());
    } catch { setError('Could not check local voice support. Start Ollama and run: ollama pull phonon'); }
  };
  useEffect(() => { void refresh(); return () => { controller.current?.abort(); audio.current?.pause(); }; }, []);

  const stop = () => {
    controller.current?.abort();
    controller.current = null;
    audio.current?.pause();
    audio.current = null;
    setPlaying(false);
  };
  const speak = async (text: string, manual = false) => {
    stop();
    if ((!manual && !enabledRef.current) || !info?.supported) return;
    const current = new AbortController();
    controller.current = current;
    setPlaying(true); setError('');
    try {
      for (const chunk of speechChunks(text)) {
        const response = await fetch('/api/v1/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: chunk, voice: voiceRef.current }), signal: current.signal });
        if (!response.ok) throw new Error((await response.json()).message || 'Speech unavailable. Start Ollama and run: ollama pull phonon');
        const blob = await response.blob();
        if (current.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        const player = new Audio(url);
        audio.current = player;
        try {
          await new Promise<void>((resolve, reject) => {
            const finish = (reason?: Error) => {
              player.onended = null; player.onerror = null;
              current.signal.removeEventListener('abort', aborted);
              if (reason) reject(reason); else resolve();
            };
            const aborted = () => { player.pause(); finish(new DOMException('Stopped', 'AbortError')); };
            player.onended = () => finish();
            player.onerror = () => finish(new Error('Audio playback failed. Try Play again.'));
            current.signal.addEventListener('abort', aborted, { once: true });
            player.play().catch(() => finish(new Error('Your browser blocked playback. Click Play to hear the reply.')));
          });
        } finally { player.pause(); player.removeAttribute('src'); URL.revokeObjectURL(url); }
      }
    } catch (cause) {
      if (!current.signal.aborted) setError(cause instanceof Error ? cause.message : 'Voice unavailable. Start Ollama and run: ollama pull phonon');
    } finally {
      if (controller.current === current) { controller.current = null; audio.current = null; setPlaying(false); }
    }
  };
  return { enabled, voice, info, error, playing, refresh, stop, speak,
    toggle: (value: boolean) => { enabledRef.current = value; setEnabled(value); if (!value) stop(); },
    changeVoice: (value: string) => { stop(); voiceRef.current = value; setVoice(value); },
  };
}
