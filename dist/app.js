import { addToPicker, convertCsv, pickerState } from "./decks.js";
import { chooseEvo, withEvo } from "./evo.js";

const ui = Object.fromEntries(
  ["csv", "name", "header", "summary", "status", "send", "download", "retry", "install", "deck-form"]
    .map(id => [id, document.getElementById(id)])
);
let deck;
let revision = 0;
let busy = false;
let device;
let pending;

function message(node, value, error = false) {
  node.textContent = value;
  node.hidden = !value;
  node.toggleAttribute("data-error", error);
}

function controls() {
  ui.send.disabled = busy || !deck || !!pending;
  ui.download.disabled = busy || !deck;
  ui.install.disabled = busy;
  ui.retry.disabled = busy;
  ui.retry.hidden = !pending;
}

async function refresh() {
  const current = ++revision;
  deck = null;
  controls();
  message(ui.summary, "");
  const file = ui.csv.files[0];
  if (!file || !ui.name.value.trim()) return;
  try {
    const input = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    if (current !== revision) return;
    deck = convertCsv(input, ui.name.value, ui.header.checked, window.Papa);
    message(ui.summary, `${deck.count} ${deck.count === 1 ? "card" : "cards"} · ${deck.name}.py`);
  } catch (error) {
    if (current !== revision) return;
    message(ui.summary, error instanceof TypeError ? "Save your CSV as UTF‑8 and try again." : error.message, true);
  }
  controls();
}

ui.csv.addEventListener("change", () => {
  if (!ui.name.value && ui.csv.files[0]) {
    let name = ui.csv.files[0].name.replace(/\.csv$/i, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[A-Z]/.test(name)) name = "D" + name;
    ui.name.value = name.slice(0, 8);
  }
  refresh();
});
ui.name.addEventListener("input", refresh);
ui.header.addEventListener("change", refresh);

function download(name, source) {
  const url = URL.createObjectURL(new Blob([source], { type: "text/x-python;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name + ".py";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

ui.download.addEventListener("click", () => {
  if (deck) download(deck.name, deck.source);
});

async function connected(action) {
  if (busy) return;
  busy = true;
  controls();
  message(ui.status, "Connecting to your calculator…");
  try {
    device ??= await chooseEvo();
    await withEvo(device, action);
  } catch (error) {
    device = null;
    let detail = error.message || "USB transfer failed.";
    if (["NetworkError", "InvalidStateError", "NotFoundError"].includes(error.name)) {
      detail = "Calculator disconnected or busy. Check the USB cable, close TI Connect Evo, and retry.";
    }
    if (pending) detail = `${pending.name} was sent. The picker update still needs to finish. ${detail}`;
    message(ui.status, detail, true);
  } finally {
    busy = false;
    controls();
  }
}

navigator.usb?.addEventListener("disconnect", event => {
  if (event.device === device?.device) device = null;
});

navigator.serial?.addEventListener("disconnect", event => {
  if (event.target === device?.port) device = null;
});

function confirmReplacement(files, name) {
  const existing = files.some(file => file.name === name && file.type === 15);
  if (existing && !window.confirm(`Replace ${name} on this calculator?`)) return null;
  return existing;
}

ui.install.addEventListener("click", () => connected(async link => {
  const files = await link.list();
  const overwrite = confirmReplacement(files, "FLASH");
  if (overwrite === null) return message(ui.status, "Viewer installation canceled.");
  const response = await fetch("./FLASH.py");
  if (!response.ok) throw new Error("Could not load the calculator viewer. Reload the page.");
  message(ui.status, "Sending FLASH to RAM…");
  await link.writeSource("FLASH", await response.text(), overwrite);
  message(ui.status, "Viewer installed. Open FLASH in the calculator’s Python app.");
}));

ui["deck-form"].addEventListener("submit", event => {
  event.preventDefault();
  const selected = deck;
  if (!selected || pending) return;
  connected(async link => {
    const state = await pickerState(link);
    const overwrite = confirmReplacement(state.files, selected.name);
    if (overwrite === null) return message(ui.status, "Deck transfer canceled.");
    message(ui.status, `Sending ${selected.name} to RAM…`);
    await link.writeSource(selected.name, selected.source, overwrite);
    pending = selected;
    state.ramNames.add(selected.name);
    message(ui.status, "Updating the deck picker…");
    await addToPicker(link, selected.name, state);
    pending = null;
    message(ui.status, `${selected.name} is ready in the FLASH deck picker.`);
  });
});

ui.retry.addEventListener("click", () => {
  const selected = pending;
  if (!selected) return;
  connected(async link => {
    const state = await pickerState(link);
    const entry = state.files.find(file => file.name === selected.name && file.type === 15 && file.ram);
    if (!entry || await link.readSource(entry) !== selected.source) {
      throw new Error("Reconnect the calculator that received this deck.");
    }
    message(ui.status, "Updating the deck picker…");
    await addToPicker(link, selected.name, state);
    pending = null;
    message(ui.status, `${selected.name} is ready in the FLASH deck picker.`);
  });
});

if (!navigator.serial && !navigator.usb) message(ui.status, "Open this site directly in desktop Chrome for USB transfer. Downloads are available here.");
