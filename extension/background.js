const DEFAULT_SETTINGS = {
  profileText: "",
  keywords: [],
  scanIntervalMinutes: 60,
  llmBaseUrl: "http://localhost:11434/v1",
  llmApiKey: "",
  llmModel: "gpt-4o-mini",
  scholarProfileUrl: "",
  matchScholar: false,
  lastSeenIds: [],
  maxSummaries: 5
};

const SCHOLAR_CACHE_KEY = "scholarData";
const SCHOLAR_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => resolve(items));
  });
}

async function setSettings(data) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(data, () => resolve());
  });
}

async function getCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ lastSummaries: [], lastFetched: null, lastTerms: [] }, (items) => resolve(items));
  });
}

async function setCache(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, () => resolve());
  });
}

function buildArxivQuery(keywords) {
  const terms = (keywords || []).map((kw) => kw.trim()).filter(Boolean);
  if (!terms.length) {
    return encodeURIComponent(`all:"artificial intelligence"`);
  }

  const clauses = terms.map((term) => {
    const safe = term.replace(/"/g, "");
    if (safe.includes(" ")) {
      return `(ti:"${safe}" OR abs:"${safe}")`;
    }
    return `(ti:${safe} OR abs:${safe})`;
  });

  return encodeURIComponent(clauses.join("+AND+"));
}

function deriveKeywordsFromProfile(profileText, maxTerms = 5) {
  if (!profileText) {
    return [];
  }
  const stopwords = new Set([
    "the",
    "and",
    "with",
    "that",
    "this",
    "from",
    "into",
    "using",
    "for",
    "research",
    "study",
    "approach",
    "method",
    "methods",
    "focus",
    "application",
    "applications",
    "based",
    "model",
    "models"
  ]);

  const words = profileText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !stopwords.has(word));

  const counts = new Map();
  for (const word of words) {
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  const topSingles = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([word]) => word);

  const phrases = [];
  for (let i = 0; i < words.length - 1 && phrases.length < maxTerms; i++) {
    const first = words[i];
    const second = words[i + 1];
    if (
      first.length >= 4 &&
      second.length >= 4 &&
      !stopwords.has(first) &&
      !stopwords.has(second)
    ) {
      phrases.push(`${first} ${second}`);
    }
  }

  return Array.from(new Set([...phrases, ...topSingles]));
}

function deriveSearchTerms(settings) {
  const explicit = (settings.keywords || []).map((kw) => kw.trim()).filter(Boolean);
  if (explicit.length) {
    return explicit;
  }
  const derived = deriveKeywordsFromProfile(settings.profileText, 6);
  return derived.length ? derived : ["artificial intelligence"];
}

async function getScholarCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [SCHOLAR_CACHE_KEY]: null }, (items) => resolve(items[SCHOLAR_CACHE_KEY]));
  });
}

async function setScholarCache(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SCHOLAR_CACHE_KEY]: data }, () => resolve());
  });
}

async function ensureScholarData(settings, forceRefresh = false) {
  if (!settings.matchScholar || !settings.scholarProfileUrl) {
    return null;
  }
  const current = await getScholarCache();
  const now = Date.now();
  const isFresh =
    current?.fetchedAt && now - new Date(current.fetchedAt).getTime() < SCHOLAR_CACHE_TTL_MS && !forceRefresh;
  if (isFresh) {
    return current;
  }
  const html = await fetchScholarProfile(settings.scholarProfileUrl);
  const publications = parseScholarTitles(html);
  const payload = {
    fetchedAt: new Date().toISOString(),
    publications
  };
  await setScholarCache(payload);
  return payload;
}

async function fetchScholarProfile(profileUrl) {
  const url = profileUrl.startsWith("http") ? profileUrl : `https://${profileUrl}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ResearchBuddy/0.2 (Chrome Extension)",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  if (!response.ok) {
    throw new Error(`Scholar request failed: ${response.status}`);
  }
  return response.text();
}

function parseScholarTitles(html) {
  const results = [];
  const titleRegex = /class="gsc_a_at"[^>]*>(.*?)<\/a>/g;
  let match;
  while ((match = titleRegex.exec(html)) !== null) {
    const raw = match[1];
    const title = decodeHTMLEntities(stripHtml(raw)).trim();
    if (!title) continue;
    const normalized = normalizeTitle(title);
    const tokens = tokenizeTitle(normalized);
    results.push({ title, normalized, tokens });
  }
  return results;
}

function stripHtml(text) {
  return text.replace(/<[^>]+>/g, "");
}

function decodeHTMLEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenizeTitle(normalizedTitle) {
  return normalizedTitle.split(" ").filter((token) => token.length >= 3);
}

function computeTokenOverlap(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) {
    return 0;
  }
  const setA = new Set(aTokens);
  const setB = new Set(bTokens);
  let shared = 0;
  setA.forEach((token) => {
    if (setB.has(token)) {
      shared += 1;
    }
  });
  const denom = Math.max(setA.size, setB.size);
  return shared / denom;
}

function findScholarMatch(title, scholarData) {
  if (!scholarData?.publications?.length) {
    return { matched: false };
  }
  const normalizedTitle = normalizeTitle(title);
  const tokens = tokenizeTitle(normalizedTitle);
  if (!tokens.length) {
    return { matched: false };
  }

  let bestMatch = null;
  for (const publication of scholarData.publications) {
    if (!publication.normalized) continue;
    if (
      normalizedTitle.includes(publication.normalized) ||
      publication.normalized.includes(normalizedTitle)
    ) {
      return { matched: true, title: publication.title, score: 1 };
    }
    const score = computeTokenOverlap(tokens, publication.tokens);
    if (score >= 0.55 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { matched: true, title: publication.title, score };
    }
  }
  return bestMatch || { matched: false };
}

function annotateWithScholarMatches(papers, scholarData) {
  if (!papers || !papers.length || !scholarData) {
    return papers || [];
  }
  return papers.map((paper) => ({
    ...paper,
    scholarMatch: findScholarMatch(paper.title, scholarData)
  }));
}

async function fetchArxivEntries(keywords, maxResults = 10) {
  const query = buildArxivQuery(keywords);
  const url = `https://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ResearchBuddy/0.1 (Chrome Extension)"
    }
  });
  if (!response.ok) {
    throw new Error(`arXiv request failed: ${response.status}`);
  }
  const xml = await response.text();
  return parseArxivFeed(xml);
}

function parseArxivFeed(xmlText) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xmlText)) !== null) {
    const entryText = match[1];
    const id = getTagValue(entryText, "id");
    const title = cleanWhitespace(getTagValue(entryText, "title"));
    const summary = cleanWhitespace(getTagValue(entryText, "summary"));
    const published = getTagValue(entryText, "published");
    const link = getLink(entryText);
    const authors = getTagValues(entryText, "name");
    entries.push({ id, title, summary, published, link, authors });
  }
  return entries;
}

function getTagValue(block, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = block.match(regex);
  return match ? match[1].trim() : "";
}

function getTagValues(block, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const values = [];
  let match;
  while ((match = regex.exec(block)) !== null) {
    values.push(match[1].trim());
  }
  return values;
}

function getLink(block) {
  const regex = /<link[^>]*href="([^"]+)"[^>]*rel="alternate"[^>]*>/i;
  const match = block.match(regex);
  return match ? match[1] : "";
}

function cleanWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

async function summarizePapers(papers, settings) {
  const summaries = [];
  for (const paper of papers) {
    try {
      const digest = await summarizePaper(paper, settings);
      summaries.push({ ...paper, digest });
    } catch (error) {
      console.warn("Failed to summarize paper", paper.id, error);
      summaries.push({ ...paper, digest: paper.summary.slice(0, 280) + "..." });
    }
  }
  return summaries;
}

async function summarizePaper(paper, settings) {
  if (!settings.llmBaseUrl || !settings.llmApiKey) {
    return `${paper.summary.slice(0, 200)}...`;
  }
  const messages = [
    {
      role: "system",
      content:
        "You are a research assistant that produces concise 3-sentence Summary highlighting novelty, method, and match with givenuser goals."
    },
    {
      role: "user",
      content: `
User research profile:
${settings.profileText || "General AI researcher"}

Paper:
Title: ${paper.title}
Authors: ${paper.authors.join(", ")}
Published: ${paper.published}
Abstract: ${paper.summary}

Please summarize in less than 50 words and mention alignment with the profile.`
    }
  ];
  const response = await invokeLLM(settings, messages);
  return response;
}

async function invokeLLM(settings, messages) {
  const url = `${settings.llmBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const payload = {
    model: settings.llmModel || "gpt-4o-mini",
    messages,
    temperature: 0.3,
    max_tokens: 256
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.llmApiKey}`
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    throw new Error(`LLM request failed: ${resp.status}`);
  }
  const json = await resp.json();
  return json.choices?.[0]?.message?.content?.trim() || "";
}

async function fetchResearchUpdates(trigger = "scheduled") {
  const settings = await getSettings();
  const cache = await getCache();
  const searchTerms = deriveSearchTerms(settings);
  const entries = await fetchArxivEntries(searchTerms, settings.maxSummaries);
  const newEntries = entries.filter((entry) => !settings.lastSeenIds.includes(entry.id));
  const fetchedAt = new Date().toISOString();
  let scholarData = null;
  try {
    scholarData = await ensureScholarData(settings, false);
  } catch (error) {
    console.warn("Scholar refresh failed", error);
  }

  if (newEntries.length === 0) {
    console.info("No new arXiv entries");
    const enrichedSummaries = scholarData
      ? annotateWithScholarMatches(cache.lastSummaries || [], scholarData)
      : cache.lastSummaries;
    await setCache({
      lastSummaries: enrichedSummaries,
      lastFetched: fetchedAt,
      lastTerms: searchTerms
    });
    return {
      summaries: enrichedSummaries,
      hadNew: false,
      lastTerms: searchTerms,
      lastFetched: fetchedAt,
      scholarLastFetched: scholarData?.fetchedAt || null
    };
  }

  const annotatedEntries = annotateWithScholarMatches(newEntries, scholarData);
  const summaries = await summarizePapers(annotatedEntries.slice(0, settings.maxSummaries), settings);
  const enrichedExisting = scholarData
    ? annotateWithScholarMatches(cache.lastSummaries || [], scholarData)
    : cache.lastSummaries;
  const updatedIds = Array.from(new Set([...newEntries.map((e) => e.id), ...settings.lastSeenIds])).slice(
    0,
    50
  );

  await setSettings({ lastSeenIds: updatedIds });
  const latest = [...summaries, ...(enrichedExisting || [])].slice(0, settings.maxSummaries);
  await setCache({
    lastSummaries: latest,
    lastFetched: fetchedAt,
    lastTerms: searchTerms
  });

  notifySummaries(summaries, trigger);
  return {
    summaries: latest,
    hadNew: true,
    lastTerms: searchTerms,
    lastFetched: fetchedAt,
    scholarLastFetched: scholarData?.fetchedAt || null
  };
}

function notifySummaries(summaries, trigger) {
  summaries.forEach((summary) => {
    const matchNote = summary.scholarMatch?.matched
      ? `Matches your publication: ${summary.scholarMatch.title}`
      : "";
    const body = summary.digest || summary.summary.slice(0, 200);
    const message = matchNote ? `${body}\n${matchNote}` : body;
    chrome.notifications.create(
      `arxiv-${summary.id}-${Date.now()}`,
      {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: summary.title,
        message,
        contextMessage: trigger === "manual" ? "Manual check" : "Scheduled scan"
      },
      () => chrome.runtime.lastError && console.warn(chrome.runtime.lastError)
    );
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  chrome.alarms.create("research-buddy-scan", {
    periodInMinutes: Math.max(15, Number(settings.scanIntervalMinutes) || 60)
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "research-buddy-scan") {
    fetchResearchUpdates("scheduled").catch((err) => console.error(err));
  }
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.type === "manualCheck") {
    fetchResearchUpdates("manual")
      .then((result) =>
        sendResponse({
          ok: true,
          summaries: result.summaries,
          hadNew: result.hadNew,
          lastTerms: result.lastTerms,
          lastFetched: result.lastFetched,
          scholarLastFetched: result.scholarLastFetched
        })
      )
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (request?.type === "getSummaries") {
    getCache()
      .then((cache) =>
        sendResponse({
          ok: true,
          summaries: cache.lastSummaries,
          lastFetched: cache.lastFetched,
          lastTerms: cache.lastTerms
        })
      )
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (request?.type === "refreshScholar") {
    getSettings()
      .then((settings) => ensureScholarData(settings, request.force))
      .then((data) =>
        sendResponse({
          ok: true,
          refreshedAt: data?.fetchedAt || null,
          publications: data?.publications?.length || 0
        })
      )
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});




