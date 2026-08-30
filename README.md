# 🌟 Personal Dashboard & AI WhatsApp Assistant

A comprehensive, self-hosted personal productivity dashboard and automated AI assistant built with **React (Vite)**, **Node.js (Express)**, **Local LLM (Ollama / Llama 3)**, **Google Workspace APIs (Calendar & Gmail)**, and **WhatsApp Web (`whatsapp-web.js`)**.

---

## 🚀 Key Features

### 🖥️ Modern Web Dashboard
- **Modern Glassmorphic UI**: Beautiful, responsive dark glassmorphism design.
- **Seamless Page Transitions**: Built with `react-router-dom` and native browser **View Transitions API**.
- **🤖 AI Assistant (Home Page)**: Interactive chat interface powered by a local Ollama model augmented with personal context (schedule, tasks, emails) and live internet search.
- **📅 Today's Schedule**: Google Calendar integration that displays today's events, including **recurring classes and multi-day events**, with the ability to add new events directly.
- **✅ Daily Routine & Tasks**: Persistent daily task and habit tracker with instant completion toggling.
- **📧 Important Emails**: Gmail integration fetching unread high-priority emails with senders and subjects.
- **🔐 One-Click Google OAuth**: Seamless Google account authentication with automatic token expiration detection and reconnect prompts.

### 📱 Self-Hosted WhatsApp Assistant (`whatsapp-web.js`)
- **100% Free & Self-Hosted**: Replaces paid sandbox services like Twilio with direct WhatsApp Web client integration.
- **Persistent Session**: Uses `LocalAuth` so you only scan the QR code once.
- **"Message Yourself" Integration**: Chat directly with your assistant in your personal WhatsApp note-to-self chat.
- **Privacy & Contact Isolation**: The bot strictly listens only to your commands in your personal self-chat and remains completely silent in chats with friends or groups.
- **Instant Quick Commands**:
  - `schedule` or `routine` $\rightarrow$ Returns your schedule for today and pending daily tasks.
  - `emails` $\rightarrow$ Returns a quick summary of important unread emails.
  - `hi`, `hello`, or `help` $\rightarrow$ Displays available commands and quick-start guide.
  - *Any natural language question* $\rightarrow$ Answered by your local AI engine with live web search.
- **Automated Morning Briefing**: Optional cron job via `node-cron` to automatically deliver your daily agenda each morning.

### 🧠 Advanced RAG & Web Search Engine
- **Local Privacy**: Runs on your local machine using **Ollama** (`llama3`) without sending personal data to third-party cloud LLM APIs.
- **Live Internet Facts & Breaking News**:
  - **Google News Live Search**: Pulls breaking headlines, publications, and dates for current event queries.
  - **Wikipedia Knowledge API**: Pulls verified definitions and encyclopedic background context for questions about people, companies, science, and history.
- **Context Blending**: Blends your real-time schedule, daily tasks, unread emails, and live web search data directly into the system prompt for personalized answers.

---

## 🛠️ Project Structure

```
Personal Dashboard/
├── package.json               # Root launcher with concurrently scripts
├── README.md                  # Project documentation
│
├── backend/                   # Node.js & Express API Server
│   ├── index.js               # Main server, API endpoints, WhatsApp bot & Cron jobs
│   ├── aiService.js           # RAG pipeline: Ollama, Google News & Wikipedia search
│   ├── nodemon.json           # Nodemon config ignoring WhatsApp session files
│   ├── tasks.json             # Persistent local task storage
│   ├── package.json           # Backend dependencies
│   └── .env                   # Environment variables & Google OAuth credentials
│
└── frontend/                  # React + Vite Single-Page Application
    ├── index.html             # HTML entry point
    ├── vite.config.js         # Vite configuration
    ├── package.json           # Frontend dependencies
    └── src/
        ├── App.jsx            # Main app router, data fetching & Google auth state
        ├── index.css          # Glassmorphic UI styling & responsive theme
        ├── components/
        │   └── Sidebar.jsx    # Navigation sidebar with View Transitions
        └── pages/
            ├── Home.jsx       # AI Assistant chat view
            ├── Schedule.jsx   # Google Calendar view & event creation modal
            ├── Routine.jsx    # Daily routine task management view
            └── Emails.jsx     # Important unread emails view
```

---

## 📋 Prerequisites

Before starting, ensure you have the following installed on your machine:

1. **[Node.js](https://nodejs.org/)** (v18 or higher)
2. **[Google Chrome](https://www.google.com/chrome/)** (installed on macOS for Puppeteer WhatsApp integration)
3. **[Ollama](https://ollama.com/)** with the `llama3` model:
   ```bash
   ollama run llama3
   ```
4. **Google Cloud Console Credentials**:
   - A Google Cloud project with **Google Calendar API** and **Gmail API** enabled.
   - An OAuth 2.0 Client ID with redirect URI: `http://localhost:5001/auth/google/callback`.

---

## ⚙️ Configuration (`backend/.env`)

Create a `.env` file inside the `backend/` directory with the following configuration:

```env
PORT=5001
FRONTEND_URL=http://localhost:5173
SESSION_SECRET=your_super_secret_session_key

# Google OAuth 2.0 Credentials
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5001/auth/google/callback

# (Optional) WhatsApp phone number for scheduled morning cron briefings
YOUR_WHATSAPP_NUMBER=+1234567890
```

---

## 🚀 Installation & Getting Started

### 1. Install Dependencies
Run the unified installer from the project root:
```bash
npm run install-all
```
*(Alternatively, run `npm install` in root, `backend/`, and `frontend/` separately).*

### 2. Start the Application
Start both the backend server and frontend development server concurrently:
```bash
npm start
```

- **Frontend Dashboard**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:5001](http://localhost:5001)

### 3. Link Your Services
1. **Google Account**: Open the dashboard at [http://localhost:5173](http://localhost:5173), click **"Connect Google Account"** in the header or schedule tab, and sign in.
2. **WhatsApp Bot**: When running `npm start`, check your terminal for the QR code:
   - Open WhatsApp on your phone $\rightarrow$ **Settings** $\rightarrow$ **Linked Devices** $\rightarrow$ **Link a Device**.
   - Scan the terminal QR code.
   - Once connected, open your **"Message Yourself"** chat in WhatsApp and send `hello` or `schedule`!

---

## 💡 Usage Examples

### On WhatsApp ("Message Yourself"):
| Message | Action |
|---|---|
| `schedule` | Retrieves today's Google Calendar agenda and classes |
| `routine` | Lists all pending daily routine tasks |
| `emails` | Summarizes unread important Gmail messages |
| `help` | Shows available commands |
| `What is the latest news on AI?` | Triggers real-time Google News search + Ollama answer |
| `Who is Sam Altman?` | Triggers Wikipedia factual lookup + Ollama answer |

### On the Web Dashboard:
- **AI Assistant**: Type any question in the bottom input bar to converse with your local assistant.
- **Schedule**: View today's schedule and click the `+` button to create new Google Calendar events.
- **Routine**: Check off completed habits or add new routine items.
- **Emails**: Review high-priority emails directly from your dashboard.

---

## 🛡️ License
ISC License. Built for personal productivity and automation.
