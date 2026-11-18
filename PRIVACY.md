# Privacy and data flow

AI inference stays on this machine. This is **not** a promise that the application has no network traffic.

## Defaults and explicit exceptions

The API binds to `127.0.0.1`. Model requests accept only literal `127.0.0.1` or IPv6 loopback hosts, disable proxies, and refuse redirects. Set `OLLAMA_URL=http://127.0.0.1:11434` (the former `localhost` spelling is deliberately rejected). Failed inference never falls back to a cloud provider. Phonon always uses `127.0.0.1:11434`.

Every external integration starts disabled, even with saved tokens or old environment flags. Enable each one in **Privacy**:

| Connection | Data crossing the boundary |
|---|---|
| Google | OAuth exchange, requested Gmail messages/calendar events; confirmed schedule titles and times sent back to Calendar |
| WhatsApp/Meta | Linked browser session and self-chat messages/replies |
| Search | Search text derived from the question; provider results returned locally |
| News | Configured news topics; retrieved news results |

Google consent remains broad enough to manage the dedicated agent calendar. Email access is read-only. The app never sends email, marks it read, archives it, downloads attachments, loads embedded images, or follows email links. Gmail messages are fetched manually, at most 25 unread inbox messages per run. MIME plain text (or a snippet fallback) is capped before local inference. This is not full HTML email rendering.

Enable search only if you accept sharing search queries with external services. Queries may contain personal information you typed. News and interactive search have separate switches. A request already in flight may finish after a switch is disabled; disabling does not revoke already transmitted data. WhatsApp browser traffic is controlled by that integration, not an OS firewall.

## Local data and retention

SQLite stores tasks, calendar blocks, reviewed email summaries/action excerpts, triage errors, and short-lived previews. It does not persist raw email bodies or generated WAV audio. Action diagnostics omit prompts and model output. The Privacy page shows database and Google token paths; WhatsApp's linked-session directory is local too. These paths and `.env` variants are ignored by Git.

Triage summaries expire after 30 days; expired records are removed at startup, on triage reads/runs, and during the scheduler tick. Previews expire for application after five minutes and are purged after one day. Accepted source IDs remain to prevent duplicate task creation. Tasks and existing plan history have no automatic expiry.

**Delete local analysis history** clears triage, previews, activity/search records and briefing history. It retains tasks, accepted-proposal IDs, credentials and linked sessions. Deletion is logical SQLite deletion, not a guarantee of forensic erasure from WAL files, backups, or disk snapshots. Existing history created before this release can contain prompts; use this control to remove it. Disconnect Google to remove its saved token; revoke access at Google to invalidate previously issued credentials.

The model sees the supplied email and date/time, not arbitrary database contents. Extracted evidence must appear in the source text. Schema and date checks reject malformed outputs, but neither validation nor prompt wording proves semantic accuracy or defeats every prompt injection. Review uncertain dates and all proposals before applying. The deterministic planner enforces time constraints rather than trusting model-selected blocks.

## Benchmark exception

The benchmark CLI is separate from application routes and does not import `.env`, read the user database, or load arbitrary prompts/files. It uses a disposable SQLite database and the versioned synthetic fixtures in the repository. Cloud execution requires `--cloud`, an explicit model, pricing source/rates, and an environment API key. Only synthetic text crosses this boundary. The $5 limit is a conservative estimate based on supplied rates, not a provider billing guarantee; use a provider-side project limit as an additional control.

Downloading models, installing packages, Google OAuth, opening external links and browser/OS background services can also use the network. This application does not provide machine-wide traffic isolation, disk encryption, or multi-user authentication. Run it for a single local user; do not expose its API through a tunnel or reverse proxy.
