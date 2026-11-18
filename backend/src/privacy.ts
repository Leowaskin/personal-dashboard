import { sqlite } from './db/index.js';

export const integrationNames = ['google', 'whatsapp', 'search', 'news'] as const;
export type Integration = typeof integrationNames[number];
sqlite.exec(`CREATE TABLE IF NOT EXISTS privacy_permissions (name TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0)`);
export function allowed(name: Integration) { return (sqlite.prepare('SELECT enabled FROM privacy_permissions WHERE name=?').get(name) as { enabled: number } | undefined)?.enabled === 1; }
export function permissions() { return Object.fromEntries(integrationNames.map(name => [name, allowed(name)])) as Record<Integration, boolean>; }
export function setPermission(name: Integration, enabled: boolean) { sqlite.prepare('INSERT INTO privacy_permissions(name,enabled) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET enabled=excluded.enabled').run(name, Number(enabled)); }
