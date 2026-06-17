const CATEGORIES = [
  "Quantum", "PQC", "Cyber", "Cryptography", "Governance", "Resilience",
  "Transformation", "Delivery", "Assurance", "Cloud", "Identity", "DevSecOps",
  "Architecture", "Risk", "Compliance", "AI", "OT/ICS", "Data", "Protocols",
  "Hardware", "Threats", "Testing", "Validation"
];

const state = {
  entries: [],
  filtered: [],
  selectedCategories: new Set(),
  query: "",
  visibleLimit: 48,
  suggestionIndex: -1
};

const els = {
  themeToggle: document.querySelector("#themeToggle"),
  themeLabel: document.querySelector("#themeLabel"),
  searchInput: document.querySelector("#searchInput"),
  clearSearch: document.querySelector("#clearSearch"),
  suggestions: document.querySelector("#suggestions"),
  categoryFilters: document.querySelector("#categoryFilters"),
  resultCount: document.querySelector("#resultCount"),
  activeContext: document.querySelector("#activeContext"),
  clearFilters: document.querySelector("#clearFilters"),
  results: document.querySelector("#results"),
  loadMore: document.querySelector("#loadMore"),
  template: document.querySelector("#resultTemplate")
};

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9/+.#-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compact(value) {
  return normalize(value).replace(/\s+/g, "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
  }[char]));
}

function debounce(fn, wait = 80) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 4) return 99;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function isSubsequence(needle, haystack) {
  let cursor = 0;
  for (const char of haystack) {
    if (char === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return false;
}

function fuzzyScore(name, query) {
  if (query.length < 3) return 0;
  const nameCompact = compact(name);
  const queryCompact = compact(query);
  let best = 0;

  if (isSubsequence(queryCompact, nameCompact)) {
    best = Math.max(best, 1100 - Math.max(0, nameCompact.length - queryCompact.length) * 8);
  }

  const pieces = normalize(name).split(" ").filter(Boolean);
  for (const piece of pieces) {
    const sample = piece.length >= query.length ? piece.slice(0, query.length) : piece;
    const distance = levenshtein(sample, query);
    const ratio = 1 - distance / Math.max(sample.length, query.length);
    if (ratio >= 0.72) best = Math.max(best, Math.round(ratio * 1800));
  }

  if (queryCompact.length >= 5) {
    const windowed = nameCompact.slice(0, Math.min(nameCompact.length, queryCompact.length + 2));
    const distance = levenshtein(windowed, queryCompact);
    const ratio = 1 - distance / Math.max(windowed.length, queryCompact.length);
    if (ratio >= 0.68) best = Math.max(best, Math.round(ratio * 1500));
  }

  return best;
}

function rankEntry(entry, rawQuery) {
  const query = normalize(rawQuery);
  if (!query) return { score: 1, label: "Browse" };

  const name = entry._name;
  const related = entry._related;
  const definition = entry._definition;
  const fullText = entry._fullText;

  if (name === query) {
    return { score: 100000 - name.length, label: "Exact" };
  }
  if (name.startsWith(query)) {
    return { score: 80000 - name.length, label: "Prefix" };
  }
  if (name.includes(query)) {
    return { score: 60000 - Math.max(0, name.indexOf(query)), label: "Contains" };
  }
  if (related.includes(query)) {
    return { score: 50000 - Math.max(0, related.indexOf(query)), label: "Related" };
  }
  if (definition.includes(query) || fullText.includes(query)) {
    return { score: 40000 - Math.max(0, definition.indexOf(query)), label: "Definition" };
  }

  const fuzzy = fuzzyScore(entry.name, query);
  if (fuzzy > 0) {
    return { score: 20000 + fuzzy, label: "Fuzzy" };
  }

  return { score: 0, label: "" };
}

function prepareEntries(entries) {
  return entries.map((entry, index) => {
    const definition = [entry.technicalDefinition, entry.plainEnglish, entry.whyItMatters, entry.realWorldExample].join(" ");
    return {
      ...entry,
      _index: index,
      _name: normalize(entry.name),
      _related: normalize(entry.relatedTerms.join(" ")),
      _definition: normalize(definition),
      _fullText: normalize(`${entry.name} ${entry.category} ${definition} ${entry.relatedTerms.join(" ")}`)
    };
  });
}

function categoryMatches(entry) {
  return state.selectedCategories.size === 0 || state.selectedCategories.has(entry.category);
}

function applyFilters() {
  const query = state.query;
  const ranked = [];

  for (const entry of state.entries) {
    if (!categoryMatches(entry)) continue;
    const rank = rankEntry(entry, query);
    if (!query || rank.score > 0) ranked.push({ entry, ...rank });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.name.localeCompare(b.entry.name);
  });

  state.filtered = ranked;
  renderResults();
  renderStatus();
}

function renderCategories() {
  const counts = new Map(CATEGORIES.map(category => [category, 0]));
  for (const entry of state.entries) counts.set(entry.category, (counts.get(entry.category) || 0) + 1);

  els.categoryFilters.innerHTML = CATEGORIES.map(category => `
    <button class="category-chip" type="button" data-category="${escapeHtml(category)}" aria-pressed="false">
      ${escapeHtml(category)} <span aria-hidden="true">${counts.get(category) || 0}</span>
    </button>
  `).join("");
}

function syncCategoryButtons() {
  document.querySelectorAll(".category-chip").forEach(button => {
    const category = button.dataset.category;
    const active = category === "all" ? state.selectedCategories.size === 0 : state.selectedCategories.has(category);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderStatus() {
  const total = state.filtered.length;
  const query = state.query.trim();
  const categoryText = state.selectedCategories.size
    ? Array.from(state.selectedCategories).join(", ")
    : "all categories";
  const visible = Math.min(state.visibleLimit, total);

  els.resultCount.textContent = `${total.toLocaleString()} ${total === 1 ? "result" : "results"}`;
  els.activeContext.textContent = query
    ? `Showing ${visible.toLocaleString()} for "${query}" in ${categoryText}`
    : `Showing ${visible.toLocaleString()} of ${state.entries.length.toLocaleString()} terms in ${categoryText}`;

  els.clearFilters.classList.toggle("visible", state.selectedCategories.size > 0 || Boolean(query));
  els.clearSearch.classList.toggle("visible", Boolean(query));
  els.loadMore.classList.toggle("visible", total > state.visibleLimit);
}

function renderResults() {
  els.results.innerHTML = "";

  if (!state.entries.length) {
    els.results.innerHTML = `<div class="empty-state"><strong>Loading translator data</strong><span>Please wait a moment.</span></div>`;
    return;
  }

  if (!state.filtered.length) {
    els.results.innerHTML = `<div class="empty-state"><strong>No translation found</strong><span>Try a shorter phrase, a related term, or a different category.</span></div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of state.filtered.slice(0, state.visibleLimit)) {
    const { entry, label } = item;
    const node = els.template.content.cloneNode(true);
    node.querySelector(".category-label").textContent = entry.category;
    node.querySelector("h2").textContent = entry.name;
    node.querySelector(".match-label").textContent = label;
    node.querySelector(".plain").textContent = entry.plainEnglish;
    node.querySelector(".technical").textContent = entry.technicalDefinition;
    node.querySelector(".matters").textContent = entry.whyItMatters;
    node.querySelector(".example").textContent = entry.realWorldExample;

    const relatedList = node.querySelector(".related-list");
    for (const term of entry.relatedTerms) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "related-term";
      button.textContent = term;
      button.addEventListener("click", () => setQuery(term));
      relatedList.appendChild(button);
    }

    fragment.appendChild(node);
  }
  els.results.appendChild(fragment);
}

function getSuggestions(query) {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length < 2) return [];

  return state.entries
    .map(entry => ({ entry, ...rankEntry(entry, normalizedQuery) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, 8);
}

function renderSuggestions() {
  const suggestions = getSuggestions(state.query);
  state.suggestionIndex = -1;
  els.searchInput.setAttribute("aria-expanded", String(suggestions.length > 0));

  if (!suggestions.length || document.activeElement !== els.searchInput) {
    els.suggestions.classList.remove("open");
    els.suggestions.innerHTML = "";
    return;
  }

  els.suggestions.innerHTML = suggestions.map((item, index) => `
    <button class="suggestion-item" type="button" role="option" data-index="${index}">
      <span>${escapeHtml(item.entry.name)}</span>
      <span class="suggestion-category">${escapeHtml(item.entry.category)}</span>
    </button>
  `).join("");
  els.suggestions.classList.add("open");

  els.suggestions.querySelectorAll(".suggestion-item").forEach((button, index) => {
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", () => setQuery(suggestions[index].entry.name));
  });
}

function setQuery(value) {
  state.query = value;
  state.visibleLimit = state.query ? 80 : 48;
  els.searchInput.value = value;
  els.suggestions.classList.remove("open");
  applyFilters();
  renderSuggestions();
  els.searchInput.focus();
}

function clearAll() {
  state.query = "";
  state.visibleLimit = 48;
  state.selectedCategories.clear();
  els.searchInput.value = "";
  syncCategoryButtons();
  applyFilters();
  renderSuggestions();
}

function handleCategoryClick(event) {
  const button = event.target.closest(".category-chip");
  if (!button) return;

  const category = button.dataset.category;
  state.visibleLimit = state.query ? 80 : 48;
  if (category === "all") {
    state.selectedCategories.clear();
  } else if (state.selectedCategories.has(category)) {
    state.selectedCategories.delete(category);
  } else {
    state.selectedCategories.add(category);
  }
  syncCategoryButtons();
  applyFilters();
}

function handleSuggestionKeys(event) {
  const items = Array.from(els.suggestions.querySelectorAll(".suggestion-item"));
  if (!items.length) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    state.suggestionIndex = (state.suggestionIndex + 1) % items.length;
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    state.suggestionIndex = (state.suggestionIndex - 1 + items.length) % items.length;
  } else if (event.key === "Enter" && state.suggestionIndex >= 0) {
    event.preventDefault();
    items[state.suggestionIndex].click();
    return;
  } else if (event.key === "Escape") {
    els.suggestions.classList.remove("open");
    return;
  } else {
    return;
  }

  items.forEach((item, index) => item.classList.toggle("active", index === state.suggestionIndex));
}

function setupTheme() {
  const stored = localStorage.getItem("plainEnglishTheme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = stored || (prefersDark ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  els.themeLabel.textContent = theme === "dark" ? "Light" : "Dark";

  els.themeToggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("plainEnglishTheme", next);
    els.themeLabel.textContent = next === "dark" ? "Light" : "Dark";
  });
}

async function loadData() {
  try {
    const response = await fetch("plain_english_data.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
    const data = await response.json();
    state.entries = prepareEntries(data);
    renderCategories();
    syncCategoryButtons();
    applyFilters();
  } catch (error) {
    console.error(error);
    els.resultCount.textContent = "Data unavailable";
    els.activeContext.textContent = "The translator data could not be loaded.";
    els.results.innerHTML = `<div class="error-state"><strong>Translator data did not load</strong><span>Use a web server or GitHub Pages so the JSON file can be fetched.</span></div>`;
  }
}

const debouncedSearch = debounce(() => {
  state.query = els.searchInput.value;
  state.visibleLimit = state.query ? 80 : 48;
  applyFilters();
  renderSuggestions();
}, 70);

els.searchInput.addEventListener("input", debouncedSearch);
els.searchInput.addEventListener("focus", renderSuggestions);
els.searchInput.addEventListener("blur", () => window.setTimeout(() => els.suggestions.classList.remove("open"), 120));
els.searchInput.addEventListener("keydown", handleSuggestionKeys);
els.clearSearch.addEventListener("click", () => setQuery(""));
els.clearFilters.addEventListener("click", clearAll);
els.loadMore.addEventListener("click", () => {
  state.visibleLimit += 48;
  renderResults();
  renderStatus();
});
document.querySelector(".category-bar").addEventListener("click", handleCategoryClick);

setupTheme();
renderResults();
loadData();
