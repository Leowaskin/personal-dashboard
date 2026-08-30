# Personal Planning Agent Architecture

The application is a local TypeScript modular monolith. The React client calls the Express API through `/api/v1`. SQLite is the source of truth for tasks, settings, plans, briefings, and audit history. Google Calendar remains the source of truth for fixed commitments.

## Safety boundary

The planner treats primary-calendar events as immutable busy intervals. It writes only to a dedicated **Personal Agent Plan** calendar. Every owned event has the private `personalAgentBlockId` marker; synchronization will not update or delete an event without that marker.

Ollama converts language into validated intents. It cannot access persistence or Google directly. The application validates the intent and calls a bounded task tool.

## Runtime flow

1. A task enters through the dashboard or WhatsApp self-chat.
2. The task service validates and stores it in SQLite.
3. A debounced replan reads fixed Google events and onboarding preferences.
4. The deterministic planner places pending tasks into free intervals.
5. When auto-plan is enabled, the calendar adapter synchronizes owned blocks.
6. The scheduler generates one briefing after the configured time and catches up after a restart.

## Local operation

Copy `backend/.env.example` to `backend/.env`, add Google credentials and the WhatsApp number, then run:

```bash
npm run install-all
npm start
```

Run `npm test` for the backend API/planner tests and frontend type/lint checks. Run `npm run build` for production builds.

The Mac must be logged in for WhatsApp Web. If it is asleep at briefing time, the scheduler sends a single catch-up briefing after the process resumes.

After verifying the app manually, install the launch-on-login service with `./scripts/install-launch-agent.sh`. This writes a user LaunchAgent and starts the production build; rerunning it safely replaces the previous service definition.
