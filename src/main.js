const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const appWindow = window.__TAURI__.window.getCurrentWindow();

const headerLabel = document.getElementById("header-label");
const dateTextEl = document.getElementById("date-text");
const timeTextEl = document.getElementById("time-text");

const dayListEl = document.getElementById("event-list");
const dayEmptyEl = document.getElementById("empty-state");

const weekStripEl = document.getElementById("week-strip");
const weekAgendaEl = document.getElementById("week-agenda");
const weekEmptyEl = document.getElementById("week-empty");

const monthHeaderEl = document.getElementById("month-header");
const monthGridEl = document.getElementById("month-grid");
const monthAgendaEl = document.getElementById("month-agenda");
const monthEmptyEl = document.getElementById("month-empty");

const yearPopoverEl = document.getElementById("year-popover");
const yearRangeLabelEl = document.getElementById("year-range-label");
const yearGridEl = document.getElementById("year-grid");
const yearPrevDecadeBtn = document.getElementById("year-prev-decade");
const yearNextDecadeBtn = document.getElementById("year-next-decade");

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
const todayBtn = document.getElementById("today-btn");
const formatRowEl = document.getElementById("format-row");
const densityRowEl = document.getElementById("density-row");
const cardEl = document.getElementById("card");
const widgetSizeRowEl = document.getElementById("widgetsize-row");
const customAccentSwatchEl = document.getElementById("custom-accent-swatch");
const customAccentInputEl = document.getElementById("custom-accent-input");

let allEvents = [];
let eventsByDay = new Map(); // "YYYY-MM-DD" -> events[]
let currentView = localStorage.getItem("gcalwidget:view") || "day";
let selectedDate = new Date(); // drives Week/Month agenda selection
let accent = localStorage.getItem("gcalwidget:accent") || "#378ADD";
let theme = localStorage.getItem("gcalwidget:theme") || "dark";
let bgOpacity = clampOpacity(parseInt(localStorage.getItem("gcalwidget:opacity"), 10));
let timeFormat = localStorage.getItem("gcalwidget:timeFormat") || "12h";
let density = localStorage.getItem("gcalwidget:density") || "standard";
let widgetSize = localStorage.getItem("gcalwidget:widgetSize") || "standard";
let yearPickerOpen = false;
let yearPickerStart = null;

const VALID_THEMES = ["dark", "midnight", "slate", "light", "nord", "forest", "rose", "paper"];
if (!["12h", "24h"].includes(timeFormat)) timeFormat = "12h";
if (!["standard", "compact"].includes(density)) density = "standard";

// Widget size controls both window width and the per-view window height.
const WIDGET_SIZES = {
  compact: { width: 260, heights: { day: 320, week: 380, month: 420 } },
  standard: { width: 300, heights: { day: 360, week: 430, month: 480 } },
  large: { width: 340, heights: { day: 410, week: 490, month: 550 } },
};
if (!Object.keys(WIDGET_SIZES).includes(widgetSize)) widgetSize = "standard";

function clampOpacity(val) {
  if (Number.isNaN(val)) return 35;
  return Math.min(100, Math.max(15, val));
}

if (!VALID_THEMES.includes(theme)) theme = "dark";

document.documentElement.style.setProperty("--accent", accent);
document.documentElement.style.setProperty("--bg-alpha", bgOpacity / 100);
document.documentElement.setAttribute("data-theme", theme);
cardEl.classList.toggle("density-compact", density === "compact");

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

function timeFormatOptions() {
  return timeFormat === "24h"
    ? { hour: "2-digit", minute: "2-digit", hour12: false }
    : { hour: "numeric", minute: "2-digit", hour12: true };
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], timeFormatOptions());
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
  dateTextEl.textContent = today.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const events = eventsByDay.get(toKey(today)) || [];
  renderAgendaInto(events, dayListEl, dayEmptyEl);
}

function renderWeekView() {
  const weekStart = getWeekStart(selectedDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  headerLabel.textContent = "This week";
  dateTextEl.textContent = formatRange(weekStart, weekEnd);

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
  dateTextEl.textContent = String(year);

  monthHeaderEl.innerHTML = `
    <button class="nav-btn" id="month-prev" aria-label="Previous month">\u2039</button>
    <button class="month-label" id="month-label-btn">${selectedDate.toLocaleDateString([], { month: "long", year: "numeric" })}</button>
    <button class="nav-btn" id="month-next" aria-label="Next month">\u203a</button>
  `;
  monthHeaderEl.querySelector("#month-prev").addEventListener("click", () => shiftMonth(-1));
  monthHeaderEl.querySelector("#month-next").addEventListener("click", () => shiftMonth(1));
  monthHeaderEl.querySelector("#month-label-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleYearPicker();
  });

  yearPopoverEl.style.display = yearPickerOpen ? "flex" : "none";
  if (yearPickerOpen) renderYearPicker();

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
  closeYearPicker();
  selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + delta, 1);
  renderMonthView();
}

function toggleYearPicker() {
  yearPickerOpen = !yearPickerOpen;
  if (yearPickerOpen) {
    yearPickerStart = selectedDate.getFullYear() - 5;
    renderYearPicker();
  }
  yearPopoverEl.style.display = yearPickerOpen ? "flex" : "none";
}

function closeYearPicker() {
  if (!yearPickerOpen) return;
  yearPickerOpen = false;
  yearPopoverEl.style.display = "none";
}

function renderYearPicker() {
  yearRangeLabelEl.textContent = `${yearPickerStart}\u2013${yearPickerStart + 11}`;
  const currentYear = new Date().getFullYear();
  const selectedYear = selectedDate.getFullYear();

  yearGridEl.innerHTML = "";
  for (let i = 0; i < 12; i++) {
    const y = yearPickerStart + i;
    const cell = document.createElement("button");
    cell.className = "year-cell"
      + (y === currentYear ? " today" : "")
      + (y === selectedYear ? " selected" : "");
    cell.textContent = String(y);
    cell.dataset.year = String(y);
    yearGridEl.appendChild(cell);
  }
}

function renderCurrentView() {
  if (currentView === "day") renderDayView();
  else if (currentView === "week") renderWeekView();
  else renderMonthView();
}

function goToToday() {
  selectedDate = new Date();
  if (currentView === "week") {
    renderWeekView();
  } else if (currentView === "month") {
    closeYearPicker();
    renderMonthView();
  }
}

todayBtn.addEventListener("click", goToToday);

async function applyViewSize(view) {
  try {
    const { LogicalSize } = window.__TAURI__.dpi;
    const size = WIDGET_SIZES[widgetSize];
    await appWindow.setSize(new LogicalSize(size.width, size.heights[view]));
  } catch (err) {
    console.error("Failed to resize window for view:", view, err);
  }
}

function switchView(view) {
  currentView = view;
  localStorage.setItem("gcalwidget:view", view);
  closeYearPicker();
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
  closeYearPicker();
  selectedDate = parseKey(cell.dataset.date);
  renderMonthView();
});

yearPrevDecadeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  yearPickerStart -= 12;
  renderYearPicker();
});

yearNextDecadeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  yearPickerStart += 12;
  renderYearPicker();
});

yearGridEl.addEventListener("click", (e) => {
  const cell = e.target.closest(".year-cell");
  if (!cell) return;
  const y = parseInt(cell.dataset.year, 10);
  selectedDate = new Date(y, selectedDate.getMonth(), 1);
  closeYearPicker();
  renderMonthView();
});

yearPopoverEl.addEventListener("click", (e) => e.stopPropagation());

let themeOpen = false;

const themeRowEl = document.getElementById("theme-row");
const opacitySliderEl = document.getElementById("opacity-slider");
const opacityValueEl = document.getElementById("opacity-value");

const PRESET_ACCENTS = ["#378ADD", "#1D9E75", "#D85A30", "#D4537E", "#7F77DD", "#BA7517"];

function updateActiveSwatches() {
  const isCustomAccent = !PRESET_ACCENTS.includes(accent.toUpperCase());
  themePopover.querySelectorAll(".swatch:not(.swatch-custom)").forEach((sw) => {
    sw.classList.toggle("active", sw.dataset.accent === accent.toUpperCase());
  });
  customAccentSwatchEl.classList.toggle("active", isCustomAccent);
  if (isCustomAccent) customAccentInputEl.value = accent;
  themePopover.querySelectorAll(".theme-swatch").forEach((sw) => {
    sw.classList.toggle("active", sw.dataset.theme === theme);
  });
  formatRowEl.querySelectorAll(".segment").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.format === timeFormat);
  });
  densityRowEl.querySelectorAll(".segment").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.density === density);
  });
  widgetSizeRowEl.querySelectorAll(".segment").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.widgetsize === widgetSize);
  });
  opacitySliderEl.value = String(bgOpacity);
  opacityValueEl.textContent = `${bgOpacity}%`;
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
  closeYearPicker();
});

themePopover.querySelectorAll(".swatch:not(.swatch-custom)").forEach((sw) => {
  sw.addEventListener("click", () => {
    accent = sw.dataset.accent;
    document.documentElement.style.setProperty("--accent", accent);
    localStorage.setItem("gcalwidget:accent", accent);
    updateActiveSwatches();
  });
});

customAccentInputEl.addEventListener("input", () => {
  accent = customAccentInputEl.value.toUpperCase();
  document.documentElement.style.setProperty("--accent", accent);
  localStorage.setItem("gcalwidget:accent", accent);
  updateActiveSwatches();
});

themeRowEl.querySelectorAll(".theme-swatch").forEach((sw) => {
  sw.addEventListener("click", () => {
    theme = sw.dataset.theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("gcalwidget:theme", theme);
    updateActiveSwatches();
  });
});

opacitySliderEl.addEventListener("input", () => {
  bgOpacity = clampOpacity(parseInt(opacitySliderEl.value, 10));
  document.documentElement.style.setProperty("--bg-alpha", bgOpacity / 100);
  opacityValueEl.textContent = `${bgOpacity}%`;
});

opacitySliderEl.addEventListener("change", () => {
  localStorage.setItem("gcalwidget:opacity", String(bgOpacity));
});

formatRowEl.querySelectorAll(".segment").forEach((btn) => {
  btn.addEventListener("click", () => {
    timeFormat = btn.dataset.format;
    localStorage.setItem("gcalwidget:timeFormat", timeFormat);
    updateActiveSwatches();
    updateHeaderTime();
    renderCurrentView();
  });
});

densityRowEl.querySelectorAll(".segment").forEach((btn) => {
  btn.addEventListener("click", () => {
    density = btn.dataset.density;
    localStorage.setItem("gcalwidget:density", density);
    cardEl.classList.toggle("density-compact", density === "compact");
    updateActiveSwatches();
  });
});

widgetSizeRowEl.querySelectorAll(".segment").forEach((btn) => {
  btn.addEventListener("click", () => {
    widgetSize = btn.dataset.widgetsize;
    localStorage.setItem("gcalwidget:widgetSize", widgetSize);
    updateActiveSwatches();
    applyViewSize(currentView);
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

function updateHeaderTime() {
  timeTextEl.textContent = new Date().toLocaleTimeString([], timeFormatOptions());
}

async function init() {
  await loadAllEvents();
  switchView(currentView);
  updateHeaderTime();
}

init();

setInterval(updateHeaderTime, 15 * 1000);

setInterval(async () => {
  await loadAllEvents();
  renderCurrentView();
}, 5 * 60 * 1000);

listen("refresh-events", async () => {
  await loadAllEvents();
  renderCurrentView();
});