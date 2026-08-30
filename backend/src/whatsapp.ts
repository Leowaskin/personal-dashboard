import qrcode from 'qrcode-terminal';
import whatsappWeb from 'whatsapp-web.js';
import type { Client as WhatsAppClient, Message } from 'whatsapp-web.js';
import { config } from './config.js';
import { runAgent } from './agent.js';

const { Client, LocalAuth } = whatsappWeb;

let client: WhatsAppClient | null = null;
let status = config.ENABLE_WHATSAPP === 'true' ? 'INITIALIZING' : 'DISABLED';
let latestQr: string | null = null;
const sentTexts = new Set<string>();
let lastInbound: { at: string; outcome: string; remote: string; to: string; fromMe: boolean } | null = null;
const ownChatIds = new Set<string>();

export function whatsappState() { return { status, qr: latestQr, lastInbound }; }

export async function sendWhatsApp(text: string, targetChat?: string) {
  if (!client || status !== 'READY' || (!targetChat && !config.YOUR_WHATSAPP_NUMBER)) return false;
  const chatId = targetChat ?? (config.YOUR_WHATSAPP_NUMBER!.includes('@c.us') ? config.YOUR_WHATSAPP_NUMBER! : `${config.YOUR_WHATSAPP_NUMBER!.replace('+', '')}@c.us`);
  sentTexts.add(text.trim());
  setTimeout(() => sentTexts.delete(text.trim()), 60_000);
  await client.sendMessage(chatId, text);
  return true;
}

function widUser(value?: string) {
  return value?.split('@')[0]?.split(':')[0] ?? '';
}

function normalizedWid(value?: string) {
  return value?.toLowerCase() ?? '';
}

export function startWhatsApp() {
  if (config.ENABLE_WHATSAPP !== 'true') return;
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true, protocolTimeout: 0,
      executablePath: process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas',
        '--no-first-run', '--no-zygote', '--disable-gpu', '--disable-extensions', '--disable-component-update',
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      ],
    },
  });
  client.on('loading_screen', (percent: number, message: string) => console.log(`[WhatsApp] Loading ${percent}% ${message ?? ''}`));
  client.on('qr', (qr: string) => { latestQr = qr; status = 'QR_READY'; qrcode.generate(qr, { small: true }); });
  client.on('authenticated', () => { latestQr = null; status = 'AUTHENTICATED'; console.log('[WhatsApp] Authenticated'); });
  client.on('ready', async () => {
    latestQr = null;
    status = 'READY';
    const ownPhoneId = client?.info?.wid?._serialized;
    if (ownPhoneId) ownChatIds.add(normalizedWid(ownPhoneId));
    try {
      // WhatsApp now uses LIDs for many “Message yourself” chats. Resolve the LID
      // associated with this account once, rather than accepting arbitrary LIDs.
      const identities = ownPhoneId ? await client?.getContactLidAndPhone([ownPhoneId]) : [];
      for (const identity of identities ?? []) {
        if (identity.lid) ownChatIds.add(normalizedWid(identity.lid));
        if (identity.pn) ownChatIds.add(normalizedWid(identity.pn));
      }
    } catch (error) {
      console.warn('[WhatsApp] Could not resolve own LID; direct self-chat IDs still work', error);
    }
    console.log(`[WhatsApp] Ready (self IDs: ${ownChatIds.size})`);
  });
  client.on('auth_failure', () => { status = 'AUTH_FAILURE'; console.error('[WhatsApp] Authentication failed'); });
  client.on('disconnected', (reason: string) => { status = 'DISCONNECTED'; console.warn(`[WhatsApp] Disconnected: ${reason}`); });
  client.on('message_create', async (message: Message) => {
    const remote = message.id?.remote ?? message.to ?? '';
    const myUser = client?.info?.wid?.user;
    // WhatsApp represents “Message yourself” differently across clients. Compare the
    // destination's phone-number portion rather than requiring its exact serialized ID.
    const isDirectSelfChat = Boolean(myUser && (
      message.to === message.from ||
      widUser(remote) === myUser ||
      widUser(message.to) === myUser ||
      ownChatIds.has(normalizedWid(remote)) ||
      ownChatIds.has(normalizedWid(message.to))
    ));
    const diagnostic = { at: new Date().toISOString(), remote, to: message.to ?? '', fromMe: message.fromMe };
    if (!message.body || message.isStatus) { lastInbound = { ...diagnostic, outcome: 'IGNORED_EMPTY_OR_STATUS' }; return; }
    if (sentTexts.has(message.body.trim())) { lastInbound = { ...diagnostic, outcome: 'IGNORED_BOT_ECHO' }; return; }
    if (!isDirectSelfChat) { lastInbound = { ...diagnostic, outcome: 'IGNORED_NON_SELF_CHAT' }; return; }
    lastInbound = { ...diagnostic, outcome: 'PROCESSING_SELF_CHAT' };
    console.log(`[WhatsApp] Processing self-chat message (fromMe=${message.fromMe})`);
    try {
      const result = await runAgent(message.body.trim(), 'whatsapp');
      let reply = result.reply;
      if (result.action === 'ADD_TASK' || result.action === 'COMPLETE_TASK') {
        try {
          const { replanAfterTaskChange } = await import('./orchestrator.js');
          const plan = await replanAfterTaskChange(`whatsapp-${result.action.toLowerCase()}`);
          if (plan) reply += '\n\nI’ve updated your Google Calendar.';
        } catch (error) {
          console.error('[Calendar] WhatsApp task was saved but could not be synced', error);
          const detail = error instanceof Error ? error.message : 'unknown error';
          reply += `\n\nYour task was saved, but Google Calendar could not be updated: ${detail}`;
        }
      }
      await sendWhatsApp(reply, remote || message.to);
      lastInbound = { ...diagnostic, outcome: 'REPLIED' };
    } catch {
      lastInbound = { ...diagnostic, outcome: 'FAILED' };
      await sendWhatsApp('I could not process that request. Please check the dashboard health page.', remote || message.to);
    }
  });
  client.initialize().catch(() => { status = 'FAILED'; });
}

export async function stopWhatsApp() {
  if (client) await client.destroy().catch(() => undefined);
}
