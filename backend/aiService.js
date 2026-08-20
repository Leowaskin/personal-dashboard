const axios = require('axios');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// Helper to strip HTML tags from search snippets
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>?/gm, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// Helper to fetch live news from Google News RSS
async function fetchNews(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-US&gl=US&ceid=US:en`;
    const response = await axios.get(url, { timeout: 4000 });
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response.data);
    
    if (!result.rss || !result.rss.channel || !result.rss.channel[0].item) {
      return null;
    }

    const items = result.rss.channel[0].item.slice(0, 4);
    let newsSummary = `📰 Latest News for "${query}":\n`;
    items.forEach((item, index) => {
      const pubDate = item.pubDate ? ` [${new Date(item.pubDate[0]).toLocaleDateString()}]` : '';
      newsSummary += `${index + 1}. ${item.title[0]}${pubDate}\n`;
    });
    
    return newsSummary;
  } catch (error) {
    return null;
  }
}

// Helper to fetch encyclopedic facts and summary from Wikipedia
async function fetchWikipediaFacts(query) {
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&srlimit=2`;
    const searchRes = await axios.get(searchUrl, {
      headers: { 'User-Agent': 'PersonalDashboardBot/1.0' },
      timeout: 4000
    });
    
    const items = searchRes.data?.query?.search || [];
    if (items.length === 0) return null;

    let factSummary = `📚 Wikipedia Facts for "${query}":\n`;
    
    // Fetch detailed summary for top article
    try {
      const topTitle = items[0].title;
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topTitle)}`;
      const sumRes = await axios.get(summaryUrl, {
        headers: { 'User-Agent': 'PersonalDashboardBot/1.0' },
        timeout: 4000
      });
      if (sumRes.data?.extract) {
        factSummary += `• ${topTitle}: ${sumRes.data.extract}\n`;
      }
    } catch (e) {
      // Fallback to search snippets if REST summary fails
      items.forEach(item => {
        const cleanSnippet = stripHtml(item.snippet);
        factSummary += `• ${item.title}: ${cleanSnippet}...\n`;
      });
    }

    return factSummary;
  } catch (error) {
    return null;
  }
}

// Extract keywords & intent to determine if a web search is needed
function extractSearchQuery(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;
  const p = prompt.trim();
  const lower = p.toLowerCase();
  
  // Exclude simple greetings and internal dashboard commands
  const ignoredPatterns = [
    /^(hi|hello|hey|yo|greetings|help|ping|test)\b/i,
    /^(schedule|routine|tasks?|emails?|calendar)\b/i
  ];
  if (ignoredPatterns.some(rgx => rgx.test(lower))) {
    return null;
  }

  // Question / search trigger words
  const searchTriggers = [
    /\b(news|latest|today|recent|current|update|updates|breaking)\b/i,
    /\b(who is|who was|who are|what is|what are|what was|when is|when was|where is|how does|why is)\b/i,
    /\b(price of|cost of|weather|score of|winner of|released|founded)\b/i,
    /\b(tell me about|explain|search for|lookup|look up)\b/i,
    /\b(definition of|meaning of|history of|overview of)\b/i
  ];

  const matchesTrigger = searchTriggers.some(rgx => rgx.test(lower));
  
  // If prompt has a question mark or matches trigger patterns, clean it and use as query
  if (matchesTrigger || p.includes('?')) {
    // Strip common leading conversational phrases
    let cleaned = p
      .replace(/^(can you|please|could you|tell me|search for|look up|what is|who is|what are|who are|tell me about)\s+/i, '')
      .replace(/\?+$/, '')
      .trim();
    
    // Determine whether to prioritize news or facts
    const isNews = /\b(news|latest|today|recent|update|breaking)\b/i.test(lower);
    return {
      rawPrompt: p,
      query: cleaned.length > 0 ? cleaned : p,
      isNews
    };
  }

  return null;
}

// Unified Web Search orchestrator
async function performWebSearch(searchIntent) {
  if (!searchIntent || !searchIntent.query) return "";

  const { query, isNews } = searchIntent;
  console.log(`🌐 Performing live web search (Query: "${query}", isNews: ${isNews})...`);

  try {
    const [newsData, wikiData] = await Promise.all([
      fetchNews(query),
      fetchWikipediaFacts(query)
    ]);

    let combinedContext = "\n--- LIVE WEB SEARCH & REAL-TIME FACTS ---\n";
    let hasContent = false;

    if (isNews && newsData) {
      combinedContext += newsData + "\n";
      hasContent = true;
    }

    if (wikiData) {
      combinedContext += wikiData + "\n";
      hasContent = true;
    }

    if (!isNews && newsData) {
      combinedContext += newsData + "\n";
      hasContent = true;
    }

    if (!hasContent) {
      return "";
    }

    combinedContext += "Use the live web search facts and news above to answer the user's question accurately.\n";
    return combinedContext;
  } catch (err) {
    console.error("Web Search error:", err.message);
    return "";
  }
}

// Generate the RAG Context (Calendar + Tasks + Emails)
async function getContext(oauth2Client, TOKEN_PATH) {
  let context = `Today's Date and Time: ${new Date().toLocaleString('en-US', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}\n\n`;
  
  // 1. Calendar
  context += "--- YOUR SCHEDULE TODAY ---\n";
  try {
    if (fs.existsSync(TOKEN_PATH) && oauth2Client) {
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
      const response = await calendar.events.list({
        calendarId: 'primary', timeMin: startOfDay.toISOString(), timeMax: endOfDay.toISOString(),
        maxResults: 10, singleEvents: true, orderBy: 'startTime',
      });
      const events = response.data.items || [];
      if (events.length > 0) {
        events.forEach(e => {
          const time = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'}) : 'All Day';
          context += `- ${e.summary} (${time})\n`;
        });
      } else {
        context += "No events scheduled today.\n";
      }
    } else {
      context += "Google Calendar not connected.\n";
    }
  } catch (e) { context += "Could not fetch calendar.\n"; }

  // 2. Tasks
  context += "\n--- PENDING DAILY ROUTINE TASKS ---\n";
  try {
    const TASKS_FILE = path.join(__dirname, 'tasks.json');
    if (fs.existsSync(TASKS_FILE)) {
      const tasks = JSON.parse(fs.readFileSync(TASKS_FILE));
      const pending = tasks.filter(t => !t.completed);
      if (pending.length > 0) {
        pending.forEach(t => context += `- ${t.title}\n`);
      } else {
        context += "All routine tasks completed!\n";
      }
    }
  } catch (e) { context += "Could not fetch tasks.\n"; }

  // 3. Emails (Optional: fetch unread important emails)
  context += "\n--- IMPORTANT UNREAD EMAILS ---\n";
  try {
    if (fs.existsSync(TOKEN_PATH) && oauth2Client) {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const response = await gmail.users.messages.list({ userId: 'me', q: 'is:important is:unread', maxResults: 3 });
      const messages = response.data.messages || [];
      if (messages.length > 0) {
        context += `You have ${messages.length} important unread emails waiting for you.\n`;
      } else {
        context += "No important unread emails.\n";
      }
    }
  } catch (e) { context += "Could not fetch emails.\n"; }

  return context;
}

// Call the Local Ollama Model with Augmented Context (Personal RAG + Web RAG)
async function queryOllama(prompt, oauth2Client, TOKEN_PATH) {
  try {
    // 1. Check if we need to search the web for live facts or news
    const searchIntent = extractSearchQuery(prompt);
    let webContext = "";
    if (searchIntent) {
      webContext = await performWebSearch(searchIntent);
    }

    // 2. Gather Personal Context (RAG: Calendar + Tasks + Emails)
    const personalContext = await getContext(oauth2Client, TOKEN_PATH);
    
    // 3. Construct the System Prompt
    const systemPrompt = `You are Leo's highly intelligent and helpful Personal Assistant, accessible via his Dashboard and WhatsApp.
Your goal is to help him manage his day, provide summaries of his schedule, answer general questions, and keep him up to date with the world.
Keep your answers concise, friendly, and formatted nicely for WhatsApp (use markdown like *bold*). If live web facts or schedule context are provided below, use them to answer accurately.

Here is the context of Leo's life and the world right now:
${personalContext}
${webContext}`;

    // 4. Call Ollama API
    const response = await axios.post('http://localhost:11434/api/generate', {
      model: 'llama3', // Must match the model downloaded
      prompt: prompt,
      system: systemPrompt,
      stream: false
    });

    return response.data.response;
  } catch (error) {
    console.error("Error communicating with Ollama:", error.message);
    if (error.code === 'ECONNREFUSED') {
      return "⚠️ The local AI engine (Ollama) is not running. Please make sure the Ollama app is open on your Mac and the model is downloaded.";
    }
    return "I ran into an issue trying to process your request. Please try again.";
  }
}

module.exports = { queryOllama, extractSearchQuery, performWebSearch };
