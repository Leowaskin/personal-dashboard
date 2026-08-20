# whatsapp-web.js & Calendar Integration Guidelines

When building or maintaining local WhatsApp bots with `whatsapp-web.js` and Google Calendar in Node.js environments:

## 1. Nodemon & LocalAuth Session Isolation
- Always configure `nodemon.json` to ignore `.wwebjs_auth`, `.wwebjs_cache`, or restrict watching to specific entry/service files (e.g. `index.js`, `aiService.js`).
- Without this, nodemon restarts immediately upon auth file creation, causing `Error: The browser is already running...` due to stale `SingletonLock` files.

## 2. Headless Chrome Flags on macOS
- When configuring Puppeteer for `whatsapp-web.js` on macOS, always supply:
  - System Chrome path if local Puppeteer Chromium encounters Apple Silicon dynamic library issues (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`).
  - Essential launch args: `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`.
  - A standard desktop `--user-agent` string to prevent WhatsApp Web from hanging indefinitely before emitting the QR code.

## 3. "Message Yourself" Support & Contact Isolation via `message_create`
- The `client.on('message')` event strictly fires for incoming messages from other contacts (`msg.fromMe === false`).
- To allow users to interact with their assistant in the "Message Yourself" chat from their phone, listen to `client.on('message_create')`.
- **Strict Privacy Isolation**: Always check `if (!msg.fromMe) return;` so the bot NEVER replies to incoming messages from other contacts or group members.
- **Avoid `msg.getChat()` on Self-Messages**: Do NOT call `await msg.getChat()` on self-messages as WhatsApp Web throws Puppeteer evaluation errors (`r: r`). Instead, use synchronous properties (`msg.id.remote`, `msg.to`).
- **Friend Chat Protection (@c.us)**: If `remote.endsWith('@c.us')` and the recipient is not the user's own number, stay completely silent unless explicitly prefixed with `!ai`.
- **Message-Yourself & Groups (@g.us)**: Many WhatsApp clients create "Message Yourself" as a 1-person `@g.us` group. Allow assistant prompts (commands, questions, search triggers) while ignoring casual banter in real groups.
- Maintain a Set of sent message IDs / text hashes to prevent the bot from entering an infinite loop responding to its own outgoing messages.
- Route responses to `targetChat` (`remote || recipient`).

## 4. Google Calendar Recurring Events
- When querying daily schedules from the Google Calendar API (`calendar.events.list`), always pass `singleEvents: true` and `orderBy: 'startTime'`.
- Without `singleEvents: true`, recurring event rules (RRULEs) like bi-weekly classes will not expand into individual instances for today.
