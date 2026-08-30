import type { Briefing, CalendarAgentBlock, CalendarEvent, ChatResponse, PlanBlock, Settings, Task } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message ?? 'Request failed');
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const api = {
  health: () => request<{ status: string; database: string; google: string; whatsapp: string }>('/health'),
  tasks: () => request<{ tasks: Task[] }>('/tasks'),
  createTask: (body: Record<string, unknown>) => request<{ task: Task }>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id: string, body: Record<string, unknown>) => request<{ task: Task }>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  completeTask: (id: string) => request<{ task: Task }>(`/tasks/${id}/complete`, { method: 'POST' }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  settings: () => request<{ settings: Settings }>('/settings'),
  saveSettings: (body: Settings) => request<{ settings: Settings }>('/settings', { method: 'PUT', body: JSON.stringify(body) }),
  importLegacy: () => request<{ imported: number }>('/import/legacy-tasks', { method: 'POST' }),
  plan: () => request<{ blocks: PlanBlock[]; runs: unknown[] }>('/plans/today'),
  replan: () => request<{ plan: { blocks: PlanBlock[]; unscheduled: unknown[] } }>('/plans/recompute', { method: 'POST', body: JSON.stringify({ reason: 'dashboard' }) }),
  briefings: () => request<{ briefings: Briefing[] }>('/briefings'),
  calendar: (start?: string, end?: string) => request<{ events: CalendarEvent[]; agentBlocks: CalendarAgentBlock[] }>(`/calendar/events${start && end ? `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` : ''}`),
  emails: () => request<{ emails: Array<{ id: string; subject: string; from: string }> }>('/gmail/important'),
  chat: (prompt: string) => request<ChatResponse>('/chat', { method: 'POST', body: JSON.stringify({ prompt }) }),
};
