import axios from 'axios';
import { config } from './config.js';

export function loopbackUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Model URL must use literal loopback (127.0.0.1 or [::1]) without credentials or a path');
  return url.origin;
}
export const localTransport = { proxy: false as const, maxRedirects: 0, timeout: 90_000, maxContentLength: 32 * 1024 * 1024 };
export async function localModelAvailable() {
  try { await axios.post(`${loopbackUrl(config.OLLAMA_URL)}/api/show`, { model: config.OLLAMA_MODEL }, { ...localTransport, timeout: 3000 }); return true; } catch { return false; }
}
export async function localCompletion(messages: Array<{ role: string; content: string }>, format?: object, model = config.OLLAMA_MODEL) {
  const response = await axios.post(`${loopbackUrl(config.OLLAMA_URL)}/api/chat`, { model, messages, stream: false, ...(format ? { format } : {}), options: { temperature: 0, num_predict: 2048 }, think: false }, localTransport);
  if (typeof response.data.message?.content !== 'string') throw new Error('Local model returned no text');
  return { text: response.data.message.content as string, promptTokens: response.data.prompt_eval_count as number | undefined, outputTokens: response.data.eval_count as number | undefined };
}
export async function localChat(messages: Array<{ role: string; content: string }>, format?: object, model = config.OLLAMA_MODEL) { return (await localCompletion(messages, format, model)).text; }
