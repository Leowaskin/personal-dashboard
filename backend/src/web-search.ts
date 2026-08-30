import axios from 'axios';
import { Parser } from 'xml2js';
import { config } from './config.js';
import { recordSearch } from './repository.js';

export type SearchStatus = 'not_needed' | 'success' | 'fallback' | 'unavailable';
export type SearchSource = { title: string; url: string; publishedAt?: string; provider: string };
export type SearchResult = SearchSource & { excerpt: string };
export type SearchResponse = { status: SearchStatus; query?: string; provider?: string; results: SearchResult[] };

const cache = new Map<string, { expiresAt: number; response: SearchResponse }>();
const explicitSearchPattern = /\b(search(?:\s+(?:for|online))?|look\s*up|find\s+(?:online|on\s+the\s+web)|web\s+search)\b/i;
const freshSearchPattern = /\b(latest|breaking|news|today|current|recent|updates?|right now|price|weather|score|election|released?)\b/i;

function cleanText(value: unknown, limit: number) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function safeUrl(value: unknown) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function shouldSearch(prompt: string) {
  return explicitSearchPattern.test(prompt) || freshSearchPattern.test(prompt);
}

export function isFreshQuery(prompt: string) {
  return freshSearchPattern.test(prompt);
}

export function searchQueryFromPrompt(prompt: string) {
  const query = prompt
    .trim()
    .replace(/^(?:can you |could you |please )?(?:search(?:\s+(?:for|online))?|look\s*up|find\s+(?:online|on\s+the\s+web))\s+/i, '')
    .replace(/[?!.]+$/, '')
    .trim();
  return (query || prompt.trim()).split(/\s+/).slice(0, 50).join(' ').slice(0, 400);
}

export function normalizeBraveResponse(data: unknown): SearchResult[] {
  const record = data as { grounding?: { generic?: Array<{ title?: unknown; url?: unknown; snippets?: unknown[] }>; map?: Array<{ title?: unknown; url?: unknown; snippets?: unknown[] }>; poi?: { title?: unknown; url?: unknown; snippets?: unknown[] } }; sources?: Record<string, { age?: unknown[] }> };
  const candidates = [...(record.grounding?.generic ?? []), ...(record.grounding?.map ?? []), ...(record.grounding?.poi ? [record.grounding.poi] : [])];
  const seen = new Set<string>();
  return candidates.flatMap((item) => {
    const url = safeUrl(item.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    const excerpt = (item.snippets ?? []).map((snippet) => cleanText(snippet, 450)).filter(Boolean).join(' ').slice(0, 650);
    if (!excerpt) return [];
    const age = record.sources?.[url]?.age?.[3] ?? record.sources?.[url]?.age?.[1];
    return [{ title: cleanText(item.title, 160) || new URL(url).hostname, url, excerpt, publishedAt: typeof age === 'string' ? age : undefined, provider: 'brave' }];
  }).slice(0, 4);
}

export function normalizeFirecrawlResponse(data: unknown): SearchResult[] {
  const record = data as { data?: { web?: Array<{ title?: unknown; url?: unknown; description?: unknown; markdown?: unknown; metadata?: { publishedTime?: unknown; modifiedTime?: unknown } }> } };
  const seen = new Set<string>();
  return (record.data?.web ?? []).flatMap((item) => {
    const url = safeUrl(item.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    // Search descriptions are sufficient grounding for a short assistant answer.
    // Do not request page scraping by default: it costs more and enlarges the
    // untrusted context passed to the local model.
    const excerpt = cleanText(item.description ?? item.markdown, 650);
    if (!excerpt) return [];
    const publishedAt = item.metadata?.publishedTime ?? item.metadata?.modifiedTime;
    return [{ title: cleanText(item.title, 160) || new URL(url).hostname, url, excerpt, publishedAt: typeof publishedAt === 'string' ? publishedAt : undefined, provider: 'firecrawl' }];
  }).slice(0, 4);
}

async function withRetry<T>(request: () => Promise<T>) {
  try { return await request(); } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    if (status !== 429 && (!status || status < 500)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return request();
  }
}

async function braveSearch(query: string, fresh: boolean) {
  if (!config.BRAVE_SEARCH_API_KEY) return [];
  const response = await withRetry(() => axios.post('https://api.search.brave.com/res/v1/llm/context', {
    q: query, count: 8, maximum_number_of_urls: 4, maximum_number_of_tokens: 3000,
    maximum_number_of_tokens_per_url: 900, context_threshold_mode: 'balanced', safesearch: 'moderate',
    enable_source_metadata: true, ...(fresh ? { freshness: /\b(recent|updates?)\b/i.test(query) ? 'pw' : 'pd' } : {}),
  }, { headers: { 'X-Subscription-Token': config.BRAVE_SEARCH_API_KEY, Accept: 'application/json' }, timeout: 12_000 }));
  return normalizeBraveResponse(response.data);
}

async function firecrawlSearch(query: string, fresh: boolean) {
  if (!config.FIRECRAWL_API_KEY) return [];
  const response = await withRetry(() => axios.post('https://api.firecrawl.dev/v2/search', {
    query, limit: 4, sources: ['web'], ...(fresh ? { tbs: /\b(recent|updates?)\b/i.test(query) ? 'qdr:w' : 'qdr:d' } : {}),
  }, { headers: { Authorization: `Bearer ${config.FIRECRAWL_API_KEY}`, Accept: 'application/json' }, timeout: 12_000 }));
  return normalizeFirecrawlResponse(response.data);
}

async function googleNews(query: string) {
  const response = await axios.get(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`, { timeout: 8_000 });
  const parsed = await new Parser().parseStringPromise(response.data) as { rss?: { channel?: Array<{ item?: Array<{ title?: string[]; link?: string[]; pubDate?: string[]; description?: string[] }> }> } };
  return (parsed.rss?.channel?.[0]?.item ?? []).flatMap((item) => {
    const url = safeUrl(item.link?.[0]);
    if (!url) return [];
    return [{ title: cleanText(item.title?.[0], 160) || new URL(url).hostname, url, excerpt: cleanText(item.description?.[0], 650), publishedAt: item.pubDate?.[0], provider: 'google-news-rss' }];
  }).slice(0, 4);
}

async function wikipedia(query: string) {
  const response = await axios.get('https://en.wikipedia.org/w/api.php', { params: { action: 'query', list: 'search', srsearch: query, format: 'json', srlimit: 4 }, timeout: 8_000, headers: { 'User-Agent': 'Dayflow/1.0' } });
  const items = response.data?.query?.search as Array<{ title?: unknown; snippet?: unknown }> | undefined;
  return (items ?? []).flatMap((item) => {
    const title = cleanText(item.title, 160);
    if (!title) return [];
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
    return [{ title, url, excerpt: cleanText(item.snippet, 650), provider: 'wikipedia' }];
  }).filter((item) => item.excerpt).slice(0, 4);
}

async function fallbackSearch(query: string, fresh: boolean) {
  const requests = fresh ? [googleNews(query), wikipedia(query)] : [wikipedia(query)];
  const settled = await Promise.allSettled(requests);
  return settled.flatMap((item) => item.status === 'fulfilled' ? item.value : []).slice(0, 4);
}

function cacheKey(query: string, fresh: boolean) { return `${fresh ? 'fresh' : 'general'}:${query.toLowerCase()}`; }

export async function searchWeb(prompt: string, source: 'dashboard' | 'whatsapp' | 'briefing'): Promise<SearchResponse> {
  const query = searchQueryFromPrompt(prompt);
  const fresh = isFreshQuery(prompt);
  const key = cacheKey(query, fresh);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.response;
  const started = Date.now();
  try {
    const firecrawl = await firecrawlSearch(query, fresh);
    if (firecrawl.length) {
      const response: SearchResponse = { status: 'success', query, provider: 'firecrawl', results: firecrawl };
      cache.set(key, { response, expiresAt: Date.now() + 10 * 60_000 });
      recordSearch({ query, provider: 'firecrawl', urls: firecrawl.map((result) => result.url), status: 'success', latencyMs: Date.now() - started, source });
      return response;
    }
  } catch (error) {
    console.warn('[Search] Firecrawl search unavailable', error instanceof Error ? error.message : error);
  }
  try {
    const brave = await braveSearch(query, fresh);
    if (brave.length) {
      const response: SearchResponse = { status: 'success', query, provider: 'brave', results: brave };
      cache.set(key, { response, expiresAt: Date.now() + 10 * 60_000 });
      recordSearch({ query, provider: 'brave', urls: brave.map((result) => result.url), status: 'success', latencyMs: Date.now() - started, source });
      return response;
    }
  } catch (error) {
    console.warn('[Search] Brave search unavailable', error instanceof Error ? error.message : error);
  }
  try {
    const fallback = await fallbackSearch(query, fresh);
    if (fallback.length) {
      const response: SearchResponse = { status: 'fallback', query, provider: fallback[0]?.provider, results: fallback };
      cache.set(key, { response, expiresAt: Date.now() + 10 * 60_000 });
      recordSearch({ query, provider: response.provider ?? 'fallback', urls: fallback.map((result) => result.url), status: 'fallback', latencyMs: Date.now() - started, source });
      return response;
    }
  } catch (error) {
    console.warn('[Search] Fallback search unavailable', error instanceof Error ? error.message : error);
  }
  recordSearch({ query, provider: config.FIRECRAWL_API_KEY ? 'firecrawl' : config.BRAVE_SEARCH_API_KEY ? 'brave' : 'fallback', urls: [], status: 'unavailable', latencyMs: Date.now() - started, source });
  return { status: 'unavailable', query, results: [] };
}

export async function searchNewsTopics(topics: string[]) {
  const query = `latest ${topics.join(', ')} news`;
  const response = await searchWeb(query, 'briefing');
  return response.results.slice(0, 3);
}

export function formatSources(sources: SearchSource[]) {
  if (!sources.length) return '';
  return `\n\nSources:\n${sources.map((source, index) => `${index + 1}. ${source.title} — ${source.url}`).join('\n')}`;
}

export function searchIntegrationStatus() {
  const provider = config.FIRECRAWL_API_KEY ? 'firecrawl' : config.BRAVE_SEARCH_API_KEY ? 'brave' : 'fallback-only';
  return { provider, configured: provider !== 'fallback-only' };
}
