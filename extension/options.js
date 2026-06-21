const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");
const keywordsInput = document.getElementById("keywords");
const scholarStatusEl = document.getElementById("scholar-status");
const scholarUrlInput = document.getElementById("scholarProfileUrl");
const matchScholarCheckbox = document.getElementById("matchScholar");
const refreshScholarBtn = document.getElementById("refreshScholar");
const scholarPreview = document.getElementById("scholar-preview");

const fields = [
  "profileText",
  "keywords",
  "scanIntervalMinutes",
  "maxSummaries",
  "llmBaseUrl",
  "llmModel",
  "llmApiKey",
  "scholarProfileUrl",
  "matchScholar"
];

const STOPWORDS = new Set([
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
  "models",
  "data",
  "results"
]);

function deriveKeywordsFromProfile(text, maxTerms = 6) {
  if (!text) {
    return [];
  }
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));

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
      !STOPWORDS.has(first) &&
      !STOPWORDS.has(second)
    ) {
      phrases.push(`${first} ${second}`);
    }
  }

  const combined = Array.from(new Set([...phrases, ...topSingles]));
  return combined.slice(0, maxTerms);
}

async function loadSettings() {
  const defaults = {};
  fields.forEach((field) => (defaults[field] = ""));
  defaults.scanIntervalMinutes = 60;
  defaults.maxSummaries = 5;
  defaults.llmBaseUrl = "http://localhost:11434/v1";
  defaults.llmModel = "gpt-4o-mini";
  defaults.matchScholar = false;

  chrome.storage.sync.get(defaults, (data) => {
    document.getElementById("profileText").value = data.profileText || "";
    keywordsInput.value = (data.keywords || []).join(", ");
    document.getElementById("scanIntervalMinutes").value = data.scanIntervalMinutes || 60;
    document.getElementById("maxSummaries").value = data.maxSummaries || 5;
    document.getElementById("llmBaseUrl").value = data.llmBaseUrl || "http://localhost:11434/v1";
    document.getElementById("llmModel").value = data.llmModel || "gpt-4o-mini";
    document.getElementById("llmApiKey").value = data.llmApiKey || "";
    scholarUrlInput.value = data.scholarProfileUrl || "";
    matchScholarCheckbox.checked = Boolean(data.matchScholar);
    loadScholarPreview();
  });
}

async function extractKeywordsWithLLM(profileText, llmBaseUrl, llmModel, llmApiKey) {
  if (!profileText || !llmBaseUrl || !llmModel || !llmApiKey) {
    return [];
  }
  const url = `${llmBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const messages = [
    {
      role: "system",
      content:
        "You are a helpful assistant that extracts 5-8 precise research keywords for arXiv queries. Provide output as a JSON array of strings."
    },
    {
      role: "user",
      content: `Research profile:\n${profileText}\n\nRespond ONLY with JSON, e.g. ["multi-agent systems","LLM planning"].`
    }
  ];
  const payload = {
    model: llmModel || "gpt-4o-mini",
    temperature: 0.2,
    messages,
    max_tokens: 200
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${llmApiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    throw new Error(`LLM keyword extraction failed: ${resp.status}`);
  }

  const json = await resp.json();
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch (err) {
    // fall back to splitting
  }

  return text
    .split(/[,;\n]/)
    .map((kw) => kw.replace(/["\[\]]/g, "").trim())
    .filter(Boolean);
}

async function saveSettings(event) {
  event.preventDefault();
  const profileText = document.getElementById("profileText").value.trim();
  const llmBaseUrl = document.getElementById("llmBaseUrl").value.trim();
  const llmModel = document.getElementById("llmModel").value.trim() || "gpt-4o-mini";
  const llmApiKey = document.getElementById("llmApiKey").value.trim();
  const scholarProfileUrl = scholarUrlInput.value.trim();
  const matchScholar = matchScholarCheckbox.checked && Boolean(scholarProfileUrl);

  let keywords = keywordsInput.value
    .split(",")
    .map((kw) => kw.trim())
    .filter(Boolean);

  let autoKeywords = false;
  let keywordSource = "fallback";
  if (!keywords.length) {
    autoKeywords = true;
    try {
      keywords = await extractKeywordsWithLLM(profileText, llmBaseUrl, llmModel, llmApiKey);
      keywordSource = "llm";
    } catch (error) {
      console.warn("LLM keyword extraction failed, falling back.", error);
    }

    if (!keywords.length) {
      keywords = deriveKeywordsFromProfile(profileText);
      keywordSource = "heuristic";
    }
    if (!keywords.length) {
      keywords = ["artificial intelligence"];
    }
  }

  const payload = {
    profileText,
    keywords,
    scanIntervalMinutes: Math.max(15, Number(document.getElementById("scanIntervalMinutes").value) || 60),
    maxSummaries: Math.min(20, Math.max(1, Number(document.getElementById("maxSummaries").value) || 5)),
    llmBaseUrl,
    llmModel,
    llmApiKey,
    scholarProfileUrl,
    matchScholar
  };

  chrome.storage.sync.set(payload, () => {
    keywordsInput.value = payload.keywords.join(", ");
    if (autoKeywords) {
      if (keywordSource === "llm") {
        statusEl.textContent = `Saved. Keywords derived via LLM: ${payload.keywords.join(", ")}`;
      } else if (keywordSource === "heuristic") {
        statusEl.textContent = `Saved. LLM unavailable, heuristics used: ${payload.keywords.join(", ")}`;
      } else {
        statusEl.textContent = `Saved with default keywords: ${payload.keywords.join(", ")}`;
      }
    } else {
      statusEl.textContent = "Saved.";
    }
    chrome.alarms.create("research-buddy-scan", {
      periodInMinutes: payload.scanIntervalMinutes
    });
    if (payload.matchScholar && payload.scholarProfileUrl) {
      requestScholarRefresh(true);
    }
    setTimeout(() => (statusEl.textContent = ""), 4000);
  });
}

function requestScholarRefresh(force = false) {
  const url = scholarUrlInput.value.trim();
  if (!url) {
    scholarStatusEl.textContent = "Add your Scholar profile URL first.";
    setTimeout(() => (scholarStatusEl.textContent = ""), 3000);
    return;
  }
  scholarStatusEl.textContent = "Refreshing Scholar data…";
  chrome.runtime.sendMessage(
    { type: "refreshScholar", force },
    (response) => {
      if (chrome.runtime.lastError) {
        scholarStatusEl.textContent = `Error: ${chrome.runtime.lastError.message}`;
        return;
      }
      if (!response?.ok) {
        scholarStatusEl.textContent = response?.error ? `Error: ${response.error}` : "Failed to refresh.";
        return;
      }
      scholarStatusEl.textContent = `Scholar data updated (${new Date(response.refreshedAt).toLocaleString()}).`;
      loadScholarPreview();
      setTimeout(() => (scholarStatusEl.textContent = ""), 4000);
    }
  );
}

function loadScholarPreview() {
  chrome.storage.local.get({ scholarData: null }, (items) => {
    const data = items.scholarData;
    if (!data?.publications?.length) {
      scholarPreview.textContent = "No Scholar data cached yet. Click Refresh to fetch your publications.";
      return;
    }
    const list = data.publications.slice(0, 10);
    const lines = [
      `Last fetched: ${new Date(data.fetchedAt).toLocaleString()}`,
      `Cached titles: ${data.publications.length}`,
      "<ul>" + list.map((pub) => `<li>${pub.title}</li>`).join("") + "</ul>"
    ];
    scholarPreview.innerHTML = lines.join("<br/>");
  });
}

form.addEventListener("submit", saveSettings);
document.addEventListener("DOMContentLoaded", loadSettings);
refreshScholarBtn.addEventListener("click", () => requestScholarRefresh(true));

