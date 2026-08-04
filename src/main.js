
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const appWindow = window.__TAURI__.window.getCurrentWindow();

const headerLabel = document.getElementById("header-label");
const headerDate = document.getElementById("header-date");

const dayListEl = document.getElementById("event-list");
const dayEmptyEl = document.getElementById("empty-state");

const weekStripEl = document.getElementById("week-strip");
const weekAgendaEl = document.getElementById("week-agenda");
const weekEmptyEl = document.getElementById("week-empty");

const monthHeaderEl = document.getElementById("month-header");
const monthGridEl = document.getElementById("month-grid");
const monthAgendaEl = document.getElementById("month-agenda");
const monthEmptyEl = document.getElementById("month-empty");

const panels = {
  day: document.getElementById("day-view"),
  week: document.getElementById("week-view"),
  month: document.getElementById("month-view"),
};
const tabButtons = document.querySelectorAll(".tab");

const themeBtn = document.getElementById("theme-btn");
const themePopover = document.getElementById("theme-popover");
const popoutBtn = document.getElementById("popout-btn");
const closeBtn = document.getElementById("close-btn");

let allEvents = [];
let eventsByDay = new Map(); // "YYYY-MM-DD" -> events[]
let currentView = localStorage.getItem("gcalwidget:view") || "day";
let selectedDate = new Date(); // drives Week/Month agenda selection
let accent = localStorage.getItem("gcalwidget:accent") || "#378ADD";

const VIEW_HEIGHTS = { day: 360, week: 430, month: 480 };

document.documentElement.style.setProperty("--accent", accent);

function toKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function getWeekStart(d) {
  const nd = new Date(d);
  nd.setHours(0, 0, 0, 0);
  nd.setDate(nd.getDate() - nd.getDay());
  return nd;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRange(start, end) {
  const opts = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString([], opts)} \u2013 ${end.toLocaleDateString([], opts)}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderAgendaInto(events, listEl, emptyEl) {
  listEl.innerHTML = "";

  if (!events.length) {
    listEl.style.display = "none";
    emptyEl.style.display = "flex";
    return;
  }

  listEl.style.display = "flex";
  emptyEl.style.display = "none";

  for (const ev of events) {
    const row = document.createElement("div");
    row.className = "event-row";
    row.innerHTML = `
      <div class="event-bar" style="background:${ev.calendar_color}"></div>
      <div>
        <p class="event-title">${escapeHtml(ev.title)}</p>
        <p class="event-time">${ev.all_day ? "All day" : `${formatTime(ev.start)} - ${formatTime(ev.end)}`}</p>
      </div>
    `;

    listEl.appendChild(row);
  }
}

async function loadAllEvents() {
  try {
    allEvents = await invoke("get_events");
  } catch (err) {
    console.error("Failed to load events:", err);
    allEvents = [];
  }

  eventsByDay = new Map();
  for (const ev of allEvents) {
    const key = toKey(new Date(ev.start));
    if (!eventsByDay.has(key)) eventsByDay.set(key, []);
    eventsByDay.get(key).push(ev);
  }
  for (const arr of eventsByDay.values()) {
    arr.sort((a, b) => new Date(a.start) - new Date(b.start));
  }
}

function renderDayView() {
  const today = new Date();
  headerLabel.textContent = "Today";
  headerDate.textContent = today.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const events = eventsByDay.get(toKey(today)) || [];
  renderAgendaInto(events, dayListEl, dayEmptyEl);
}

function renderWeekView() {
  const weekStart = getWeekStart(selectedDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  headerLabel.textContent = "This week";
  headerDate.textContent = formatRange(weekStart, weekEnd);

  const todayKey = toKey(new Date());
  const selectedKey = toKey(selectedDate);

  weekStripEl.innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const key = toKey(d);
    const cell = document.createElement("div");
    cell.className = "week-day"
      + (key === todayKey ? " today" : "")
      + (key === selectedKey ? " selected" : "")
      + (eventsByDay.has(key) ? " has-events" : "");
    cell.dataset.date = key;
    cell.innerHTML = `
      <span class="dow">${d.toLocaleDateString([], { weekday: "narrow" })}</span>
      <span class="num">${d.getDate()}</span>
      <span class="dot"></span>
    `;
    weekStripEl.appendChild(cell);
  }

  const events = eventsByDay.get(selectedKey) || [];
  renderAgendaInto(events, weekAgendaEl, weekEmptyEl);
}

function renderMonthView() {
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();

  headerLabel.textContent = selectedDate.toLocaleDateString([], { month: "long" });
  headerDate.textContent = String(year);

  monthHeaderEl.innerHTML = `
    <button class="nav-btn" id="month-prev" aria-label="Previous month">\u2039</button>
    <span class="month-label">${selectedDate.toLocaleDateString([], { month: "long", year: "numeric" })}</span>
    <button class="nav-btn" id="month-next" aria-label="Next month">\u203a</button>
  `;
  monthHeaderEl.querySelector("#month-prev").addEventListener("click", () => shiftMonth(-1));
  monthHeaderEl.querySelector("#month-next").addEventListener("click", () => shiftMonth(1));

  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay());

  const todayKey = toKey(new Date());
  const selectedKey = toKey(selectedDate);

  monthGridEl.innerHTML = "";
  const dowLabels = ["S", "M", "T", "W", "T", "F", "S"];
  for (const l of dowLabels) {
    const el = document.createElement("div");
    el.className = "month-dow";
    el.textContent = l;
    monthGridEl.appendChild(el);
  }

  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    const key = toKey(d);
    const cell = document.createElement("div");
    cell.className = "month-cell"
      + (d.getMonth() !== month ? " other-month" : "")
      + (key === todayKey ? " today" : "")
      + (key === selectedKey ? " selected" : "")
      + (eventsByDay.has(key) ? " has-events" : "");
    cell.dataset.date = key;
    cell.innerHTML = `${d.getDate()}<span class="dot"></span>`;
    monthGridEl.appendChild(cell);
  }

  const events = eventsByDay.get(selectedKey) || [];
  renderAgendaInto(events, monthAgendaEl, monthEmptyEl);
}

function shiftMonth(delta) {
  selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + delta, 1);
  renderMonthView();
}

function renderCurrentView() {
  if (currentView === "day") renderDayView();
  else if (currentView === "week") renderWeekView();
  else renderMonthView();
}

async function applyViewSize(view) {
  try {
    const { LogicalSize } = window.__TAURI__.dpi;
    await appWindow.setSize(new LogicalSize(300, VIEW_HEIGHTS[view]));
  } catch (err) {
    console.error("Failed to resize window for view:", view, err);
  }
}

function switchView(view) {
  currentView = view;
  localStorage.setItem("gcalwidget:view", view);
  for (const [name, el] of Object.entries(panels)) {
    el.style.display = name === view ? "flex" : "none";
  }
  tabButtons.forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  applyViewSize(view);
  renderCurrentView();
}

tabButtons.forEach((t) => {
  t.addEventListener("click", () => switchView(t.dataset.view));
});

weekStripEl.addEventListener("click", (e) => {
  const cell = e.target.closest(".week-day");
  if (!cell) return;
  selectedDate = parseKey(cell.dataset.date);
  renderWeekView();
});

monthGridEl.addEventListener("click", (e) => {
  const cell = e.target.closest(".month-cell");
  if (!cell || !cell.dataset.date) return;
  selectedDate = parseKey(cell.dataset.date);
  renderMonthView();
});

let themeOpen = false;

function updateActiveSwatches() {
  themePopover.querySelectorAll(".swatch").forEach((sw) => {
    sw.classList.toggle("active", sw.dataset.accent === accent);
  });
}

themeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  themeOpen = !themeOpen;
  themePopover.style.display = themeOpen ? "flex" : "none";
});

themePopover.addEventListener("click", (e) => e.stopPropagation());

document.addEventListener("click", () => {
  if (themeOpen) {
    themeOpen = false;
    themePopover.style.display = "none";
  }
});

themePopover.querySelectorAll(".swatch").forEach((sw) => {
  sw.addEventListener("click", () => {
    accent = sw.dataset.accent;
    document.documentElement.style.setProperty("--accent", accent);
    localStorage.setItem("gcalwidget:accent", accent);
    updateActiveSwatches();
    themeOpen = false;
    themePopover.style.display = "none";
  });
});

updateActiveSwatches();

closeBtn.addEventListener("click", () => {
  invoke("hide_widget");
});

popoutBtn.addEventListener("click", async () => {
  const pinned = await invoke("toggle_pop_out");
  popoutBtn.classList.toggle("active", pinned);
});

listen("pinned-changed", (event) => {
  popoutBtn.classList.toggle("active", event.payload);
});

async function init() {
  await loadAllEvents();
  switchView(currentView);
}

init();

setInterval(async () => {
  await loadAllEvents();
  renderCurrentView();
}, 5 * 60 * 1000);

listen("refresh-events", async () => {
  await loadAllEvents();
  renderCurrentView();
});
