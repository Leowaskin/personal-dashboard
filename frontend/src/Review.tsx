import { useEffect, useState } from 'react';

async function call(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
}
type Proposal = { sourceId: string; task: { title: string; estimatedMinutes: number; deadline: string | null; priority: number } };
type Result = { id: string; subject: string; summary?: string; priority?: string; category?: string; uncertain?: boolean; error?: string; actions: Array<{ task: Proposal['task']; evidence: string }> };
type Preview = { id: string; expiresAt: string; plan: { blocks: Array<{ id: string; title: string; start: string; end: string }>; unscheduled: Array<{ title: string; reason: string }> } };

export function InboxReview() {
  const [results, setResults] = useState<Result[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [text, setText] = useState('');
  const [sync, setSync] = useState(false);
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const run = async (action: () => Promise<void>) => { setBusy(true); setMessage(''); try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Request failed'); } finally { setBusy(false); } };
  useEffect(() => { void run(async () => setResults((await call('/triage')).results)); }, []);
  const add = (proposal: Proposal) => { setPreview(undefined); setProposals(old => [...old.filter(p => p.sourceId !== proposal.sourceId), proposal]); };
  const edit = (index: number, values: Partial<Proposal['task']>) => { setPreview(undefined); setProposals(old => old.map((p, i) => i === index ? { ...p, task: { ...p.task, ...values } } : p)); };
  return <section><h2>Inbox & scheduling review</h2><p>Email analysis and scheduling interpretation run locally. Review every proposal before saving. Email is never modified.</p>
    <button disabled={busy} onClick={() => void run(async () => setResults((await call('/triage', 'POST')).results))}>Analyze unread inbox (up to 25)</button>
    {results.map(result => <article className="briefing" key={result.id}><h3>{result.subject}</h3><p>{result.priority} · {result.category} {result.uncertain ? '· Needs careful review' : ''}</p><p>{result.summary || result.error}</p>{result.actions.map((action, index) => <div key={index}><blockquote>{action.evidence}</blockquote><button disabled={busy} onClick={() => add({ sourceId: `${result.id}:${action.task.title.toLowerCase().trim()}`, task: action.task })}>Review: {action.task.title}</button></div>)}</article>)}
    <h3>Describe work to schedule</h3><textarea aria-label="Scheduling request" value={text} onChange={e => setText(e.target.value)} maxLength={12000} /><button disabled={busy || !text.trim()} onClick={() => void run(async () => { const data = await call('/reviews/interpret', 'POST', { text }); setMessage(data.summary + (data.uncertain ? ' — uncertain: check dates and constraints.' : '')); const id = crypto.randomUUID(); data.actions.forEach((a: { task: Proposal['task'] }, i: number) => add({ sourceId: `${id}:${i}`, task: a.task })); })}>Suggest tasks locally</button>
    <h3>Editable proposals</h3>{proposals.map((p, index) => <div className="task-builder" key={p.sourceId}><label>Title<input value={p.task.title} onChange={e => edit(index, { title: e.target.value })} /></label><label>Minutes<input type="number" min={5} max={720} value={p.task.estimatedMinutes} onChange={e => edit(index, { estimatedMinutes: Number(e.target.value) })} /></label><label>Priority (1–5)<input type="number" min={1} max={5} value={p.task.priority} onChange={e => edit(index, { priority: Number(e.target.value) })} /></label><label>Deadline (ISO date/time with offset)<input value={p.task.deadline || ''} onChange={e => edit(index, { deadline: e.target.value || null })} /></label><button onClick={() => { setPreview(undefined); setProposals(old => old.filter((_, i) => i !== index)); }}>Remove</button></div>)}
    <details><summary>All extracted task constraints</summary><pre>{JSON.stringify(proposals.map(p => p.task), null, 2)}</pre></details>
    <label>Planning date (your configured timezone)<input type="date" value={date} onChange={e => { setDate(e.target.value); setPreview(undefined); }} /></label><label><input type="checkbox" checked={sync} onChange={e => { setSync(e.target.checked); setPreview(undefined); }} /> Send confirmed blocks to Google Calendar</label><button disabled={busy} onClick={() => void run(async () => setPreview(await call('/reviews/preview', 'POST', { proposals, sync, date })))}>Preview plan</button>
    {preview && <article className="briefing"><h3>Review before applying</h3><p>Expires {new Date(preview.expiresAt).toLocaleTimeString()}. Saves {proposals.length} new tasks and replaces future local plan blocks.{sync ? ' Sends these blocks to Google Calendar.' : ''}</p>{preview.plan.blocks.map(b => <p key={b.id}>{b.title}: {new Date(b.start).toLocaleTimeString()}–{new Date(b.end).toLocaleTimeString()}</p>)}{preview.plan.unscheduled.map((u, i) => <p key={i}>{u.title}: {u.reason}</p>)}<button disabled={busy} onClick={() => void run(async () => { const data = await call('/reviews/apply', 'POST', { id: preview.id }); setMessage(data.message || `Saved locally. Calendar: ${data.calendarSync}`); setPreview(undefined); setProposals([]); })}>Confirm and apply</button></article>}
    {busy && <p role="status">Working locally…</p>}<p role="status">{message}</p>
  </section>;
}

type Privacy = { permissions: Record<string, boolean>; modelAvailable: boolean; model: string; retentionDays: number; storage: Record<string, string> };
export function PrivacyPage() {
  const [data, setData] = useState<Privacy>();
  const [message, setMessage] = useState('');
  const load = () => call('/privacy').then(setData).catch(() => setMessage('Could not check privacy status'));
  useEffect(() => { void load(); }, []);
  const descriptions: Record<string, string> = { google: 'Read Gmail and calendar events; explicitly confirmed schedule blocks are sent to Google.', whatsapp: 'Messages and replies travel through WhatsApp/Meta. Enabling may start a linked browser session.', search: 'Search queries are sent to search providers; excerpts return to the local model.', news: 'Configured news topics are sent to external news/search providers.' };
  return <section><h2>Privacy & connections</h2><p>AI processing stays on-device. Enabled integrations exchange data with their providers. This is not a completely offline application.</p><p>Model: {data?.model} · {data ? data.modelAvailable ? 'Available locally' : 'Unavailable — no cloud fallback' : 'Checking local model…'}</p>{data && Object.entries(data.permissions).map(([name, enabled]) => <article className="briefing" key={name}><label><input type="checkbox" checked={enabled} onChange={e => { const value = e.target.checked; void call('/privacy', 'PUT', { name, enabled: value }).then(result => setData({ ...data, permissions: result.permissions })).catch(() => setMessage('Could not update permission')); }} /> Enable {name}</label><p>{descriptions[name]}</p></article>)}<p>Triage summaries and proposals expire after 30 days. Raw email bodies and generated audio are not saved. Your tasks and accepted-proposal deduplication IDs remain until you remove them.</p>{data && Object.entries(data.storage).map(([name, path]) => <p key={name}>{name}: <code>{path}</code></p>)}<button onClick={() => void call('/privacy/history', 'DELETE').then(() => setMessage('Local triage, previews, briefing and activity history deleted. Tasks and integration credentials retained.')).catch(() => setMessage('Deletion failed'))}>Delete local analysis history</button><p role="status">{message}</p></section>;
}
