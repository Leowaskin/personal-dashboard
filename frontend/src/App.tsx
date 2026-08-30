import { FormEvent, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { CalendarAgentBlock, CalendarEvent, SearchSource, Settings, Task } from './types';

const weekdayOptions = [
  ['MO', 'Mon'], ['TU', 'Tue'], ['WE', 'Wed'], ['TH', 'Thu'], ['FR', 'Fri'], ['SA', 'Sat'], ['SU', 'Sun'],
] as const;

function dayStart(value: Date) { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; }
function addDays(value: Date, amount: number) { const date = new Date(value); date.setDate(date.getDate() + amount); return date; }
function isoDay(value: Date) { return dayStart(value).toISOString().slice(0, 10); }
function eventDay(value: string) { return value.slice(0, 10); }
function timeLabel(value: string) { return value.length === 10 ? 'All day' : new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }

function Shell({ children }: { children: React.ReactNode }) {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 30_000 });
  return <div className="dashboard-container">
    <aside className="glass-panel sidebar">
      <div><span className="eyebrow">LOCAL AGENT</span><h2>Dayflow</h2></div>
      <nav>{[['/', 'Today'], ['/calendar', 'Calendar'], ['/tasks', 'Tasks'], ['/assistant', 'Assistant'], ['/briefings', 'Briefings'], ['/settings', 'Settings']].map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>{label}</NavLink>)}</nav>
      <div className="health-pill"><span className={health.data?.status === 'ok' ? 'dot online' : 'dot'} />{health.data?.status === 'ok' ? 'Agent online' : 'Agent offline'}</div>
    </aside>
    <main className="main-content"><header className="page-header"><div><span className="eyebrow">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span><h1>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, Leo.</h1></div></header>{children}</main>
  </div>;
}

function Today() {
  const client = useQueryClient();
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: api.tasks });
  const plan = useQuery({ queryKey: ['plan'], queryFn: api.plan });
  const calendar = useQuery({ queryKey: ['calendar'], queryFn: () => api.calendar(), retry: false });
  const emails = useQuery({ queryKey: ['emails'], queryFn: api.emails, retry: false });
  const replan = useMutation({ mutationFn: api.replan, onSuccess: () => client.invalidateQueries({ queryKey: ['plan'] }) });
  const taskById = new Map(tasks.data?.tasks.map((task) => [task.id, task]));
  return <section><div className="section-heading"><div><h2>Today’s plan</h2><p>Your agent-owned focus blocks. Fixed events remain untouched.</p></div><button onClick={() => replan.mutate()} disabled={replan.isPending}>{replan.isPending ? 'Planning…' : 'Replan day'}</button></div>
    <div className="timeline">{plan.data?.blocks.length ? plan.data.blocks.map((block) => <article className="timeline-item" key={block.id}><time>{new Date(block.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time><div><h3>{taskById.get(block.taskId)?.title ?? 'Task'}</h3><p>{Math.round((new Date(block.end).getTime() - new Date(block.start).getTime()) / 60000)} min · Agent block</p></div></article>) : <Empty text="No blocks planned yet. Complete setup, then ask the agent to plan your day." />}</div>
    {replan.error && <p className="error">{replan.error.message}</p>}
    <div className="overview-grid"><div><h2>Fixed calendar</h2>{calendar.data?.events.length ? calendar.data.events.map((event, index) => <article className="compact-row" key={`${event.start}-${index}`}><time>{event.start.length === 10 ? 'All day' : new Date(event.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time><span>{event.title ?? 'Untitled event'}</span></article>) : <p className="muted">Connect Google to see fixed commitments.</p>}</div><div><h2>Important email</h2>{emails.data?.emails.length ? emails.data.emails.map((email) => <article className="compact-row" key={email.id}><span><strong>{email.subject}</strong><small>{email.from}</small></span></article>) : <p className="muted">No unread important messages.</p>}</div></div>
  </section>;
}

function CalendarPage() {
  const [view, setView] = useState<'day' | 'week'>('day');
  const [anchor, setAnchor] = useState(() => dayStart(new Date()));
  const start = view === 'week' ? addDays(anchor, -((anchor.getDay() + 6) % 7)) : anchor;
  const days = Array.from({ length: view === 'week' ? 7 : 1 }, (_, index) => addDays(start, index));
  const end = addDays(days.at(-1)!, 1);
  const query = useQuery({ queryKey: ['calendar-range', view, isoDay(start)], queryFn: () => api.calendar(start.toISOString(), end.toISOString()), retry: false });
  const previous = () => setAnchor((value) => addDays(value, view === 'week' ? -7 : -1));
  const next = () => setAnchor((value) => addDays(value, view === 'week' ? 7 : 1));
  const fixed = query.data?.events ?? [];
  const blocks = query.data?.agentBlocks ?? [];
  const rangeTitle = view === 'week' ? `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${days.at(-1)!.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : anchor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return <section><div className="section-heading"><div><h2>Calendar</h2><p>Fixed Google events and agent-created task blocks.</p></div><div className="calendar-controls"><div className="view-toggle"><button className={view === 'day' ? 'selected' : ''} onClick={() => setView('day')}>Daily</button><button className={view === 'week' ? 'selected' : ''} onClick={() => setView('week')}>Weekly</button></div><button onClick={previous}>‹</button><strong>{rangeTitle}</strong><button onClick={next}>›</button><button onClick={() => setAnchor(dayStart(new Date()))}>Today</button></div></div>
    {query.error ? <p className="error">{query.error.message}. Reconnect Google from Settings to refresh calendar permissions.</p> : <div className={view === 'week' ? 'week-calendar' : 'day-calendar'}>{days.map((day) => <CalendarColumn key={isoDay(day)} day={day} fixed={fixed} blocks={blocks} compact={view === 'week'} />)}</div>}
  </section>;
}

function CalendarColumn({ day, fixed, blocks, compact }: { day: Date; fixed: CalendarEvent[]; blocks: CalendarAgentBlock[]; compact: boolean }) {
  const key = isoDay(day);
  const entries = [
    ...fixed.filter((event) => eventDay(event.start) === key).map((event) => ({ ...event, kind: 'fixed' as const })),
    ...blocks.filter((block) => eventDay(block.start) === key).map((block) => ({ ...block, kind: 'agent' as const })),
  ].sort((a, b) => a.start.localeCompare(b.start));
  return <div className={`calendar-column ${compact ? 'compact' : ''}`}><header><span>{day.toLocaleDateString('en-US', { weekday: 'short' })}</span><strong>{day.getDate()}</strong></header><div className="calendar-events">{entries.length ? entries.map((entry) => <article className={`calendar-event ${entry.kind}`} key={`${entry.kind}-${entry.kind === 'agent' ? entry.id : entry.start}-${entry.title}`}><time>{timeLabel(entry.start)}</time><strong>{entry.title ?? 'Untitled event'}</strong><small>{entry.kind === 'agent' ? 'Task block' : 'Fixed event'}</small></article>) : <p className="muted">Nothing scheduled.</p>}</div></div>;
}

function Tasks() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['tasks'], queryFn: api.tasks });
  const [title, setTitle] = useState(''); const [minutes, setMinutes] = useState(30); const [taskType, setTaskType] = useState<Task['type']>('ONE_TIME'); const [selectedDays, setSelectedDays] = useState<string[]>(['MO']);
  const create = useMutation({ mutationFn: api.createTask, onSuccess: () => { setTitle(''); setMinutes(30); setTaskType('ONE_TIME'); setSelectedDays(['MO']); client.invalidateQueries({ queryKey: ['tasks'] }); } });
  const complete = useMutation({ mutationFn: api.completeTask, onSuccess: () => client.invalidateQueries({ queryKey: ['tasks'] }) });
  const classify = useMutation({ mutationFn: ({ id, type }: { id: string; type: Task['type'] }) => api.updateTask(id, { type, status: 'PENDING', recurrenceRule: type === 'ONE_TIME' ? null : 'FREQ=DAILY' }), onSuccess: () => client.invalidateQueries({ queryKey: ['tasks'] }) });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (taskType === 'RECURRING' && !selectedDays.length) return;
    const recurrenceRule = taskType === 'HABIT' ? 'FREQ=DAILY' : taskType === 'RECURRING' ? `FREQ=WEEKLY;BYDAY=${selectedDays.join(',')}` : null;
    create.mutate({ title, estimatedMinutes: minutes, type: taskType, recurrenceRule });
  };
  return <section><div className="section-heading"><div><h2>Tasks</h2><p>Capture work with enough detail for realistic scheduling.</p></div></div>
    <form className="task-builder" onSubmit={submit}><label>Task name<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What do you want to accomplish?" required /></label><label>Estimated minutes<input type="number" min="5" step="5" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></label><label>Repeat<select value={taskType} onChange={(event) => setTaskType(event.target.value as Task['type'])}><option value="ONE_TIME">One time</option><option value="HABIT">Daily</option><option value="RECURRING">Specific days</option></select></label>{taskType === 'RECURRING' && <fieldset><legend>Repeat on</legend><div className="weekday-picker">{weekdayOptions.map(([code, label]) => <label key={code}><input type="checkbox" checked={selectedDays.includes(code)} onChange={() => setSelectedDays((days) => days.includes(code) ? days.filter((day) => day !== code) : [...days, code])} />{label}</label>)}</div></fieldset>}<button disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add task'}</button>{taskType === 'RECURRING' && !selectedDays.length && <p className="error">Choose at least one day.</p>}</form>
    {query.data?.tasks.some((task) => task.status === 'DRAFT') && <p className="setup-note">Review imported drafts below. Classify each one before enabling onboarding.</p>}
    <div className="task-list">{query.data?.tasks.map((task) => <TaskRow key={task.id} task={task} onComplete={() => complete.mutate(task.id)} onClassify={(type) => classify.mutate({ id: task.id, type })} />)}</div></section>;
}

function TaskRow({ task, onComplete, onClassify }: { task: Task; onComplete: () => void; onClassify: (type: Task['type']) => void }) {
  const [type, setType] = useState<Task['type']>(task.type);
  return <article className="task-row"><button className={`check ${task.status === 'COMPLETED' ? 'done' : ''}`} onClick={onComplete} disabled={task.status === 'COMPLETED' || task.status === 'DRAFT'} aria-label="Complete task">✓</button><div><h3>{task.title}</h3><p>{task.estimatedMinutes} min · Priority {task.priority} · {task.status.toLowerCase()}</p></div>{task.status === 'DRAFT' ? <div className="classify"><select value={type} onChange={(event) => setType(event.target.value as Task['type'])}><option value="ONE_TIME">One-time</option><option value="HABIT">Daily habit</option><option value="RECURRING">Recurring</option></select><button onClick={() => onClassify(type)}>Activate</button></div> : <span className="tag">{task.type.replace('_', ' ')}</span>}</article>;
}

function Assistant() {
  type Message = { text: string; role: 'user' | 'agent'; sources?: SearchSource[]; searchStatus?: string };
  const client = useQueryClient(); const [prompt, setPrompt] = useState(''); const [messages, setMessages] = useState<Message[]>([{ text: 'Tell me what you need to do. I can add, complete, list tasks, or search the web for current information.', role: 'agent' }]);
  const chat = useMutation({ mutationFn: api.chat, onSuccess: (data) => { setMessages((old) => [...old, { text: data.reply, role: 'agent', sources: data.sources, searchStatus: data.searchStatus }]); client.invalidateQueries({ queryKey: ['tasks'] }); } });
  const submit = (event: FormEvent) => { event.preventDefault(); if (!prompt.trim()) return; setMessages((old) => [...old, { text: prompt, role: 'user' }]); chat.mutate(prompt); setPrompt(''); };
  return <section className="assistant-panel"><div className="messages">{messages.map((message, index) => <div className={message.role === 'user' ? 'user-message' : 'agent-message'} key={index}><p>{message.text}</p>{message.searchStatus === 'fallback' && <small className="search-note">Using fallback search sources.</small>}{message.searchStatus === 'unavailable' && <small className="search-note">Live search is unavailable.</small>}{message.sources?.length ? <ol className="source-list">{message.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>{source.publishedAt ? <small>{new Date(source.publishedAt).toLocaleDateString()}</small> : null}</li>)}</ol> : null}</div>)}</div><form className="chat-form" onSubmit={submit}><input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask for today’s AI news, or add a task…" /><button disabled={chat.isPending}>Send</button></form>{chat.error && <p className="error">{chat.error.message}</p>}</section>;
}

function Briefings() {
  const query = useQuery({ queryKey: ['briefings'], queryFn: api.briefings });
  return <section><div className="section-heading"><div><h2>Morning briefings</h2><p>Saved locally and delivered through WhatsApp.</p></div></div>{query.data?.briefings.length ? query.data.briefings.map((item) => <article className="briefing" key={item.id}><div><strong>{item.briefingDate}</strong><span className="tag">{item.deliveryStatus}</span></div><pre>{item.content}</pre></article>) : <Empty text="Your first briefing will appear after onboarding at the configured time." />}</section>;
}

function SettingsPage() {
  const client = useQueryClient(); const query = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const save = useMutation({ mutationFn: api.saveSettings, onSuccess: () => client.invalidateQueries({ queryKey: ['settings'] }) });
  if (!query.data) return <p>Loading settings…</p>;
  const settings = query.data.settings;
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); const newsTopics = String(data.get('newsTopics')).split(',').map((topic) => topic.trim()).filter(Boolean); save.mutate({ ...settings, timezone: String(data.get('timezone')), dayStart: String(data.get('dayStart')), dayEnd: String(data.get('dayEnd')), briefingTime: String(data.get('briefingTime')), eventBufferMinutes: Number(data.get('buffer')), maximumPlannedMinutes: Number(data.get('maximum')), onboardingComplete: true, autoPlanEnabled: Boolean(data.get('autoPlan')), includeNewsInBriefing: Boolean(data.get('includeNews')), newsTopics } as Settings); };
  return <section><div className="section-heading"><div><h2>Planning preferences</h2><p>Automation starts only after these rules are saved.</p></div></div><form className="settings-grid" onSubmit={submit}>
    <label>Timezone<input name="timezone" defaultValue={settings.timezone} /></label><label>Day starts<input name="dayStart" type="time" defaultValue={settings.dayStart} /></label><label>Day ends<input name="dayEnd" type="time" defaultValue={settings.dayEnd} /></label><label>Briefing time<input name="briefingTime" type="time" defaultValue={settings.briefingTime} /></label><label>Calendar buffer (minutes)<input name="buffer" type="number" min="0" defaultValue={settings.eventBufferMinutes} /></label><label>Maximum planned minutes<input name="maximum" type="number" min="30" defaultValue={settings.maximumPlannedMinutes} /></label><label>Morning news topics (comma-separated)<input name="newsTopics" defaultValue={settings.newsTopics.join(', ')} /></label><label className="toggle"><input name="autoPlan" type="checkbox" defaultChecked={settings.autoPlanEnabled} /> Automatically write agent blocks to Google Calendar</label><label className="toggle"><input name="includeNews" type="checkbox" defaultChecked={settings.includeNewsInBriefing} /> Include news in my morning WhatsApp briefing</label><button>Save and enable setup</button>
  </form><div className="integration-actions"><a className="button-link" href={`/auth/google?returnTo=${encodeURIComponent(window.location.origin)}`}>Connect Google</a><span>{settings.agentCalendarId ? 'Agent calendar ready' : 'Agent calendar will be created after connection'}</span><span>Add FIRECRAWL_API_KEY to backend/.env for broad web search.</span></div>{save.isSuccess && <p className="success">Preferences saved.</p>}{save.error && <p className="error">{save.error.message}</p>}</section>;
}

function Empty({ text }: { text: string }) { return <div className="empty"><p>{text}</p></div>; }

export default function App() {
  return <Shell><Routes><Route path="/" element={<Today />} /><Route path="/calendar" element={<CalendarPage />} /><Route path="/tasks" element={<Tasks />} /><Route path="/assistant" element={<Assistant />} /><Route path="/briefings" element={<Briefings />} /><Route path="/settings" element={<SettingsPage />} /></Routes></Shell>;
}
