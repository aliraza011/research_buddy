async function loadSummaries() {
  const statusMsg = document.getElementById("status-msg");
  statusMsg.textContent = "Loading…";
  try {
    const response = await chrome.runtime.sendMessage({ type: "getSummaries" });
    if (!response?.ok) {
      throw new Error(response?.error || "Unknown error");
    }
    renderSummaries(response.summaries || []);
    const lastRun = document.getElementById("last-run");
    lastRun.textContent = `Last run: ${response.lastFetched ? new Date(response.lastFetched).toLocaleString() : "never"}`;
    const activeTerms = document.getElementById("active-terms");
    activeTerms.textContent = response.lastTerms?.length
      ? `Search terms: ${response.lastTerms.join(", ")}`
      : "Search terms: auto (general AI)";
    statusMsg.textContent = response.summaries?.length ? "" : "No summaries yet.";
  } catch (error) {
    statusMsg.textContent = `Error: ${error.message}`;
  }
}

function renderSummaries(summaries) {
  const container = document.getElementById("results");
  container.innerHTML = "";
  summaries.forEach((summary) => {
    const card = document.createElement("article");
    card.className = "summary-card";

    const title = document.createElement("h2");
    title.textContent = summary.title;
    card.appendChild(title);

    if (summary.scholarMatch?.matched) {
      const match = document.createElement("p");
      match.className = "match-badge";
      match.textContent = "Matches your Google Scholar work";
      card.appendChild(match);

      const related = document.createElement("p");
      related.className = "related-line";
      related.textContent = `Related to: ${summary.scholarMatch.title}`;
      card.appendChild(related);
    }

    const digest = document.createElement("p");
    digest.className = "digest";
    digest.textContent = summary.digest || summary.summary;
    card.appendChild(digest);

    const link = document.createElement("a");
    link.href = summary.link;
    link.target = "_blank";
    link.textContent = "View on arXiv";
    card.appendChild(link);

    container.appendChild(card);
  });
}

async function manualCheck() {
  const button = document.getElementById("refresh");
  const statusMsg = document.getElementById("status-msg");
  button.disabled = true;
  statusMsg.textContent = "Checking…";
  try {
    const response = await chrome.runtime.sendMessage({ type: "manualCheck" });
    if (!response?.ok) {
      throw new Error(response?.error || "Manual check failed");
    }
    renderSummaries(response.summaries || []);
    const activeTerms = document.getElementById("active-terms");
    activeTerms.textContent = response.lastTerms?.length
      ? `Search terms: ${response.lastTerms.join(", ")}`
      : "Search terms: auto (general AI)";
    statusMsg.textContent = response.hadNew ? "New papers added." : "No new arXiv articles.";
  } catch (error) {
    statusMsg.textContent = `Error: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

document.getElementById("refresh").addEventListener("click", manualCheck);
document.addEventListener("DOMContentLoaded", loadSummaries);

