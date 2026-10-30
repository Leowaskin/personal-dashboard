import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { speechInfo, synthesizeSpeech } from './speech.js';
import { speechChunks } from '../../frontend/src/speech.js';

afterEach(() => vi.restoreAllMocks());

describe('local voice output', () => {
  it('preserves a long reply in order with bounded requests and sentence boundaries', () => {
    const text = 'First sentence. Another sentence.\n\n' + 'A lengthy reply with many words. '.repeat(200);
    const chunks = speechChunks(text);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.length <= 700)).toBe(true);
    expect(chunks.join(' ').replace(/\s+/g, ' ').trim()).toBe(text.replace(/\s+/g, ' ').trim());
    expect(chunks[0]).toBe('First sentence. Another sentence.');
    expect(speechChunks('x'.repeat(5000)).every((chunk) => chunk.length <= 700)).toBe(true);
    expect(speechChunks('')).toEqual([]);
  });

  it('sends only speech parameters to loopback and carries cancellation through', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: Buffer.from('audio'), headers: { 'content-type': 'audio/wav' } });
    const controller = new AbortController();
    expect(await synthesizeSpeech('Hello', 'Hugh', controller.signal)).toEqual(Buffer.from('audio'));
    expect(post).toHaveBeenCalledWith('http://127.0.0.1:11434/v1/audio/speech',
      { model: 'phonon', input: 'Hello', voice: 'Hugh', response_format: 'wav' },
      expect.objectContaining({ signal: controller.signal }));
  });

  it('does not treat non-audio output as playable audio', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({ data: '{}', headers: { 'content-type': 'application/json' } });
    await expect(synthesizeSpeech('Hello', 'default', new AbortController().signal)).rejects.toThrow('did not return audio');
  });

  it('reports unavailable Ollama without throwing into the assistant flow', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('Connection refused'));
    const info = await speechInfo();
    expect(info.ready).toBe(false);
    expect(info.message).toMatch(/Ollama|macOS/);
  });
});
