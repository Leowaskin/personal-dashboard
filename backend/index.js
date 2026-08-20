require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());

const PORT = process.env.PORT || 5000;
const TOKEN_PATH = path.join(__dirname, 'token.json');

// --- Google OAuth Setup ---
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Load existing token if it exists
if (fs.existsSync(TOKEN_PATH)) {
  const token = fs.readFileSync(TOKEN_PATH);
  oauth2Client.setCredentials(JSON.parse(token));
  console.log('Google API credentials loaded from token.json');
}

// 1. Redirect to Google Login
app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/gmail.readonly'
    ],
  });
  res.redirect(url);
});

// 2. Handle Google Callback
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    // Save token to disk for future executions
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    res.redirect(`${process.env.FRONTEND_URL}?auth=success`);
  } catch (error) {
    console.error('Error retrieving access token', error);
    res.redirect(`${process.env.FRONTEND_URL}?auth=error`);
  }
});

// 3. API Route to get Auth Status
app.get('/api/auth/status', (req, res) => {
  if (fs.existsSync(TOKEN_PATH)) {
    res.json({ authenticated: true });
  } else {
    res.json({ authenticated: false });
  }
});

// --- Google Calendar Endpoints ---
app.get('/api/calendar/events', async (req, res) => {
  if (!fs.existsSync(TOKEN_PATH)) {
    return res.status(401).json({ error: 'Not authenticated with Google' });
  }
  
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  
  // Get events for today
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      maxResults: 15,
      singleEvents: true,
      orderBy: 'startTime',
    });
    
    const events = response.data.items || [];
    res.json({ events });
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    if (error.response?.data?.error === 'invalid_grant' || error.message?.includes('invalid_grant')) {
      if (fs.existsSync(TOKEN_PATH)) {
        try { fs.unlinkSync(TOKEN_PATH); } catch (e) {}
      }
      return res.status(401).json({ error: 'Google session expired. Please reconnect your account.', authenticated: false });
    }
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

app.post('/api/calendar/events', async (req, res) => {
  if (!fs.existsSync(TOKEN_PATH)) {
    return res.status(401).json({ error: 'Not authenticated with Google' });
  }
  const { summary, start, end } = req.body;
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  
  try {
    const event = {
      summary,
      start: { dateTime: start, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      end: { dateTime: end, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    };
    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });
    res.json({ event: response.data });
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// --- Daily Routine Tasks Endpoints ---
const TASKS_FILE = path.join(__dirname, 'tasks.json');

app.get('/api/tasks', (req, res) => {
  if (fs.existsSync(TASKS_FILE)) {
    res.json({ tasks: JSON.parse(fs.readFileSync(TASKS_FILE)) });
  } else {
    res.json({ tasks: [] });
  }
});

app.post('/api/tasks', (req, res) => {
  const { id, title, completed } = req.body;
  let tasks = [];
  if (fs.existsSync(TASKS_FILE)) {
    tasks = JSON.parse(fs.readFileSync(TASKS_FILE));
  }
  
  const existingIndex = tasks.findIndex(t => t.id === id);
  if (existingIndex > -1) {
    tasks[existingIndex] = { id, title, completed };
  } else {
    tasks.push({ id: id || Date.now().toString(), title, completed: !!completed });
  }
  
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
  res.json({ tasks });
});

app.delete('/api/tasks/:id', (req, res) => {
  if (fs.existsSync(TASKS_FILE)) {
    let tasks = JSON.parse(fs.readFileSync(TASKS_FILE));
    tasks = tasks.filter(t => t.id !== req.params.id);
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
    res.json({ tasks });
  } else {
    res.json({ tasks: [] });
  }
});

// --- Gmail Endpoints ---
app.get('/api/gmail/important', async (req, res) => {
  if (!fs.existsSync(TOKEN_PATH)) {
    return res.status(401).json({ error: 'Not authenticated with Google' });
  }
  
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  
  try {
    // Fetch up to 5 important, unread emails
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:important is:unread',
      maxResults: 5,
    });
    
    const messages = response.data.messages || [];
    
    // Fetch details (subject, sender) for each email
    const emailDetails = await Promise.all(messages.map(async (msg) => {
      const msgData = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From'],
      });
      
      const headers = msgData.data.payload.headers;
      const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
      // Clean up the "From" field (e.g., "John Doe <john@example.com>" -> "John Doe")
      let from = headers.find(h => h.name === 'From')?.value || 'Unknown Sender';
      from = from.split('<')[0].trim();
      
      return { id: msg.id, subject, from };
    }));
    
    res.json({ emails: emailDetails });
  } catch (error) {
    console.error('Error fetching emails:', error);
    if (error.response?.data?.error === 'invalid_grant' || error.message?.includes('invalid_grant')) {
      if (fs.existsSync(TOKEN_PATH)) {
        try { fs.unlinkSync(TOKEN_PATH); } catch (e) {}
      }
      return res.status(401).json({ error: 'Google session expired. Please reconnect your account.', authenticated: false });
    }
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// Logout / Disconnect Google
app.post('/api/auth/logout', (req, res) => {
  if (fs.existsSync(TOKEN_PATH)) {
    try { fs.unlinkSync(TOKEN_PATH); } catch (e) {}
  }
  res.json({ success: true, authenticated: false });
});

// --- WhatsApp & Automations ---
// --- WhatsApp & Automations ---
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const { queryOllama } = require('./aiService');

// Variables to track WhatsApp connection state
let latestQr = null;
let whatsappStatus = 'INITIALIZING';

// Initialize WhatsApp Client (Saves session locally)
const whatsappClient = new Client({
  authStrategy: new LocalAuth(),
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html',
  },
  puppeteer: {
    headless: true,
    protocolTimeout: 0,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-component-update',
      '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    ]
  }
});

whatsappClient.on('loading_screen', (percent, message) => {
  console.log(`⏳ [WhatsApp] Loading: ${percent}% - ${message || ''}`);
});

whatsappClient.on('qr', (qr) => {
  latestQr = qr;
  whatsappStatus = 'QR_READY';
  console.log('\n==================================================');
  console.log('🤖 SCAN THIS QR CODE WITH YOUR WHATSAPP APP');
  console.log('Go to Settings > Linked Devices > Link a Device');
  console.log('==================================================\n');
  qrcode.generate(qr, { small: true });
});

whatsappClient.on('authenticated', () => {
  latestQr = null;
  whatsappStatus = 'AUTHENTICATED';
  console.log('🔑 WhatsApp Authenticated successfully!');
});

whatsappClient.on('ready', () => {
  latestQr = null;
  whatsappStatus = 'READY';
  console.log('✅ WhatsApp Web Client is connected and ready!');
});

whatsappClient.on('auth_failure', (msg) => {
  whatsappStatus = 'AUTH_FAILURE';
  console.error('❌ WhatsApp Authentication Failed:', msg);
});

whatsappClient.on('disconnected', (reason) => {
  whatsappStatus = 'DISCONNECTED';
  console.log('⚠️ WhatsApp Disconnected:', reason);
});

// Endpoint to check WhatsApp Connection Status & retrieve QR string
app.get('/api/whatsapp/status', (req, res) => {
  res.json({ status: whatsappStatus, qr: latestQr });
});

// Webhook for incoming WhatsApp messages
app.use(express.urlencoded({ extended: true }));

async function getBriefingText() {
  let text = "";
  
  // 1. Fetch Calendar Events
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
      const response = await calendar.events.list({
        calendarId: 'primary', timeMin: startOfDay.toISOString(), timeMax: endOfDay.toISOString(),
        maxResults: 10, singleEvents: true, orderBy: 'startTime',
      });
      const events = response.data.items || [];
      text += "📅 *Today's Schedule:*\n";
      if (events.length > 0) {
        events.forEach(e => {
          const time = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'}) : 'All Day';
          text += `- ${e.summary} (${time})\n`;
        });
      } else {
        text += "No events scheduled today.\n";
      }
    } else {
      text += "📅 Google Calendar not connected.\n";
    }
  } catch (err) { text += "📅 Error fetching schedule.\n"; }

  text += "\n";
  
  // 2. Fetch Tasks
  try {
    const TASKS_FILE = path.join(__dirname, 'tasks.json');
    if (fs.existsSync(TASKS_FILE)) {
      const tasks = JSON.parse(fs.readFileSync(TASKS_FILE));
      const pending = tasks.filter(t => !t.completed);
      text += "✅ *Daily Routine (Pending):*\n";
      if (pending.length > 0) {
        pending.forEach(t => text += `- [ ] ${t.title}\n`);
      } else {
        text += "All routine tasks completed!\n";
      }
    }
  } catch (err) {}
  
  return text.trim();
}

// Bot-sent message tracking to prevent infinite loops in message_create
const botSentMessageIds = new Set();
const botSentTexts = new Set();

function registerBotMessage(msgId, text) {
  if (msgId) botSentMessageIds.add(msgId);
  if (text) {
    botSentTexts.add(text.trim());
    setTimeout(() => {
      botSentTexts.delete(text.trim());
    }, 60000);
  }
}

// Listen for all created messages (strictly responding only in your Message Yourself chat)
whatsappClient.on('message_create', async msg => {
  // Ignore status updates or empty messages
  if (msg.isStatus || !msg.body) return;

  // 1. Strictly ignore all incoming messages sent by other contacts/groups
  if (!msg.fromMe) return;

  // 2. Ignore messages sent by our bot itself (loop protection)
  if (botSentMessageIds.has(msg.id?._serialized) || botSentTexts.has(msg.body.trim())) {
    if (msg.id?._serialized) botSentMessageIds.delete(msg.id._serialized);
    return;
  }

  // 3. Extract remote chat & recipient synchronously
  const remote = msg.id?.remote || msg.to || '';
  const myWid = whatsappClient.info?.wid?._serialized;
  const myUser = whatsappClient.info?.wid?.user;
  
  const recipient = msg.to || remote;
  const recipientUser = recipient.split('@')[0].split(':')[0];

  // A. Direct 1-on-1 self-chat (@c.us with your own number)
  const isDirectSelfChat = 
    msg.to === msg.from || 
    (myWid && (recipient === myWid || remote === myWid)) || 
    (myUser && recipientUser === myUser);

  // B. 1-on-1 Chat with ANOTHER person (@c.us): Strictly DO NOT reply unless explicitly prefixed with !ai
  const isOtherPersonChat = remote.endsWith('@c.us') && !isDirectSelfChat;
  const hasPrefix = msg.body.trim().startsWith('!ai') || msg.body.trim().startsWith('!bot');
  
  if (isOtherPersonChat && !hasPrefix) {
    return; // Stay completely silent when texting friends, family, or colleagues
  }

  // C. Group chats (@g.us): Only reply if it is a command, question, or assistant prompt (allows Message-Yourself group notes while ignoring group banter)
  if (remote.endsWith('@g.us')) {
    const lower = msg.body.trim().toLowerCase();
    const isAssistantPrompt = 
      /^(schedule|routine|tasks?|emails?|hi|hello|hey|help|!ai|!bot)\b/i.test(lower) ||
      /\b(who is|who was|what is|what are|tell me|latest|news|weather|how does|why is|explain)\b/i.test(lower) ||
      msg.body.includes('?') ||
      hasPrefix;

    if (!isAssistantPrompt) {
      return; // Ignore casual group banter
    }
  }

  const cleanPrompt = hasPrefix ? msg.body.replace(/^!(ai|bot)\s*/i, '').trim() : msg.body.trim();
  const incomingMsg = cleanPrompt.toLowerCase();
  const targetChat = remote || recipient;

  console.log(`📩 [WhatsApp Assistant] Processing prompt in ${targetChat}: "${cleanPrompt}"`);

  try {
    let reply = '';
    
    if (incomingMsg === 'schedule' || incomingMsg === 'routine') {
      reply = await getBriefingText();
    } else if (incomingMsg === 'email' || incomingMsg === 'emails') {
      reply = '📧 You have a few important emails waiting for you. Please check the dashboard.';
    } else if (incomingMsg === 'hi' || incomingMsg === 'hello' || incomingMsg === 'hey' || incomingMsg === 'help') {
      reply = `👋 Hi Leo! I'm your Personal Assistant.\n\nHere are some things you can ask me:\n• *schedule* - Get your calendar schedule for today\n• *routine* - View pending daily tasks\n• *emails* - Summary of important emails\n• Or ask any general question to search the web and chat with AI!`;
    } else {
      console.log("Routing to Local LLM (Ollama)...");
      reply = await queryOllama(cleanPrompt, oauth2Client, TOKEN_PATH);
    }

    // Register reply to prevent echo loop, then send
    registerBotMessage(null, reply);
    const sent = await whatsappClient.sendMessage(targetChat, reply);
    if (sent?.id?._serialized) {
      registerBotMessage(sent.id._serialized, reply);
    }
    console.log(`✅ [WhatsApp] Reply sent successfully to Message-Yourself chat`);
  } catch (err) {
    console.error('❌ Error processing WhatsApp self-chat message:', err);
  }
});

// Start the WhatsApp Client
whatsappClient.initialize();

// Expose Chat API for the Frontend Dashboard
app.post('/api/chat', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
  
  try {
    const reply = await queryOllama(prompt, oauth2Client, TOKEN_PATH);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: 'Failed to query LLM' });
  }
});

// CRON Job: Send a morning briefing every day at 8:00 AM
cron.schedule('0 8 * * *', async () => {
  const chatId = process.env.YOUR_WHATSAPP_NUMBER;
  if (!chatId) {
    console.log('CRON: Missing YOUR_WHATSAPP_NUMBER in .env, skipping morning briefing.');
    return;
  }
  
  try {
    const briefing = await getBriefingText();
    // whatsapp-web.js expects format '14155551234@c.us'
    const formattedChatId = chatId.includes('@c.us') ? chatId : `${chatId.replace('+', '')}@c.us`;
    
    await whatsappClient.sendMessage(formattedChatId, `*Good morning, Leo!*\nHere is your briefing for today:\n\n${briefing}`);
    console.log('Morning briefing sent via WhatsApp.');
  } catch (err) {
    console.error('Error sending morning briefing:', err);
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});

// Graceful cleanup for nodemon restarts and process termination
const cleanup = async () => {
  try {
    if (whatsappClient) {
      await whatsappClient.destroy();
    }
  } catch (err) {}
};

process.on('SIGINT', async () => {
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(0);
});

process.once('SIGUSR2', async () => {
  await cleanup();
  process.kill(process.pid, 'SIGUSR2');
});
