import axios from 'axios';

// Deliberately independent of OLLAMA_URL: private reply text must stay local.
const base = 'http://127.0.0.1:11434';
export const speechSetup = 'Start Ollama 0.40.11+ and run: ollama pull phonon';
export const speechSupported = () => process.platform === 'darwin' && process.arch === 'arm64';

export async function speechInfo() {
  if (!speechSupported()) return { supported: false, ready: false, voices: ['default'], message: 'Voice requires macOS on Apple Silicon.' };
  try {
    const response = await axios.post(`${base}/api/show`, { model: 'phonon' }, { timeout: 5000 });
    const voices: unknown = response.data.voices;
    return { supported: true, ready: true, voices: [...new Set(['default', ...(Array.isArray(voices) ? voices.filter((voice): voice is string => typeof voice === 'string') : [])])], message: '' };
  } catch {
    return { supported: true, ready: false, voices: ['default'], message: speechSetup };
  }
}

export async function synthesizeSpeech(input: string, voice: string, signal: AbortSignal) {
  const response = await axios.post(`${base}/v1/audio/speech`, {
    model: 'phonon', input, voice, response_format: 'wav',
  }, { responseType: 'arraybuffer', timeout: 90_000, signal, maxContentLength: 32 * 1024 * 1024 });
  if (!String(response.headers['content-type']).includes('audio/')) throw new Error('Ollama did not return audio');
  return Buffer.from(response.data);
}
