/**
 * ElecMap playground: a netlist editor wired to the engine, published with the
 * documentation (`docs/api/playground/`). Everything runs in the browser.
 */
import { ElecMap, ElecMapError, formatSI } from "../../src";
import type {
  Complex,
  ComponentJSON,
  MonteCarlo,
  MonteCarloBode,
  OutputSpec,
  TransferFunction,
  TransferOptions,
} from "../../src";
import { plot } from "../site/plot";
import type { Panel, Series } from "../site/plot";
import { Editor, emptyDrawing, fromCircuit } from "./editor";
import type { Drawing } from "./editor";
import { EXAMPLES } from "./examples";
import type { Tab } from "./examples";
import { STRINGS } from "./i18n";
import { Viewport } from "./viewport";
import "./style.css";
import type { Lang, Strings } from "./i18n";

// ------------------------------------------------------------------ state

interface State {
  netlist: string;
  tab: Tab;
  /** Transfer function. */
  input: string;
  outKind: "voltage" | "current";
  output: string;
  reference: string;
  outCurrent: string;
  literal: boolean;
  fStart: string;
  fStop: string;
  /** Monte-Carlo envelope of the Bode plot (tolerances in %). */
  mc: boolean;
  tolR: string;
  tolC: string;
  tolL: string;
  tolOther: string;
  runs: string;
  /** Transient. */
  tStop: string;
  tStep: string;
  method: "gear2" | "trap" | "euler";
  traces: string[];
  currents: string[];
  /** Impedance. */
  zA: string;
  zB: string;
  /** Schematic. */
  style: "iec" | "ansi";
  /** Input: netlist text or block drawing. */
  mode: "text" | "draw";
}

const first = EXAMPLES[0] as (typeof EXAMPLES)[0];
const state: State = {
  netlist: first.netlist,
  tab: first.tab,
  input: "",
  outKind: "voltage",
  output: first.output ?? "",
  reference: "",
  outCurrent: "",
  literal: false,
  fStart: "",
  fStop: "",
  mc: false,
  tolR: "5",
  tolC: "10",
  tolL: "10",
  tolOther: "",
  runs: "100",
  tStop: first.tStop !== undefined ? spice(first.tStop) : "",
  tStep: "",
  method: "gear2",
  traces: first.trace ?? [],
  currents: [],
  zA: "",
  zB: "",
  style: "iec",
  mode: "text",
};

const params = new URLSearchParams(location.search);
const lang: Lang =
  params.get("lang") === "fr" ||
  (params.get("lang") === null && navigator.language.toLowerCase().startsWith("fr"))
    ? "fr"
    : "en";
const t: Strings = STRINGS[lang];
document.documentElement.lang = lang;

/** Current circuit (undefined while the netlist does not compile). */
let circuit: ElecMap | undefined;
let ground = "0";
let selected: string | undefined;
/** Block editor, and the netlist it last generated (the drawing is up to date when they match). */
let blocks: Editor | undefined;
let drawnNetlist: string | undefined;
/** What the side panel shows: the netlist, or the analysis of `state.tab`. */
let view: "netlist" | "analysis" = "netlist";
/** Zoom and pan of the schematic and of the drawing. */
let schematicView: Viewport | undefined;
let editorView: Viewport | undefined;

// --------------------------------------------------------------- helpers

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

function esc(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );
}

/** SPICE-style number for the input boxes: 0.002 → "2m". */
function spice(v: number): string {
  const table: [number, string][] = [
    [1e9, "g"],
    [1e6, "meg"],
    [1e3, "k"],
    [1, ""],
    [1e-3, "m"],
    [1e-6, "u"],
    [1e-9, "n"],
    [1e-12, "p"],
  ];
  const a = Math.abs(v);
  for (const [scale, suffix] of table) {
    if (a >= scale * 0.9995) return `${Number((v / scale).toPrecision(4))}${suffix}`;
  }
  return `${v}`;
}

/** Parses "2m", "1.5k", "10meg", "3e-6" (empty or invalid → undefined). */
function parseNumber(text: string): number | undefined {
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(meg|[fpnumkgt]|µ)?/i.exec(text);
  if (!m) return undefined;
  const scale: Record<string, number> = {
    f: 1e-15,
    p: 1e-12,
    n: 1e-9,
    u: 1e-6,
    µ: 1e-6,
    m: 1e-3,
    k: 1e3,
    meg: 1e6,
    g: 1e9,
    t: 1e12,
  };
  const v = Number(m[1]) * (m[2] ? (scale[m[2].toLowerCase()] ?? 1) : 1);
  return Number.isFinite(v) ? v : undefined;
}

const si = (v: number, unit: string, digits = 4): string =>
  Number.isFinite(v) ? formatSI(v, unit, digits) : v > 0 ? "∞" : v < 0 ? "−∞" : "—";

function complexText(z: Complex, unit = ""): string {
  if (Math.abs(z.im) < 1e-12 * Math.max(1, Math.abs(z.re))) return si(z.re, unit);
  const sign = z.im < 0 ? "−" : "+";
  return `${si(z.re, "")} ${sign} j${si(Math.abs(z.im), "")}${unit ? ` ${unit}` : ""}`;
}

function message(err: unknown): string {
  if (err instanceof ElecMapError) {
    const issues = err.details?.["issues"];
    if (Array.isArray(issues) && issues.length > 0) {
      return issues
        .map((i: { message?: string }) => i.message ?? "")
        .filter(Boolean)
        .join("\n");
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

const errorBox = (err: unknown): string =>
  `<div class="pg-error"><strong>${t.error}</strong><pre>${esc(message(err))}</pre></div>`;

function option(value: string, label: string, current: string): string {
  return `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`;
}

// ------------------------------------------------------------------ KaTeX

let katexReady: Promise<void> | undefined;
interface Katex {
  render(latex: string, el: HTMLElement, options: Record<string, unknown>): void;
}

function loadKatex(): Promise<void> {
  katexReady ??= new Promise((resolve, reject) => {
    const base = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/";
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${base}katex.min.css`;
    document.head.appendChild(css);
    const script = document.createElement("script");
    script.src = `${base}katex.min.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("KaTeX unavailable"));
    document.head.appendChild(script);
  });
  return katexReady;
}

/** Renders the `[data-tex]` elements under `root` (raw LaTeX if KaTeX cannot load). */
function renderMath(root: HTMLElement): void {
  const blocks = [...root.querySelectorAll<HTMLElement>("[data-tex]")];
  if (blocks.length === 0) return;
  for (const el of blocks) el.textContent = el.dataset["tex"] ?? "";
  loadKatex()
    .then(() => {
      const katex = (window as unknown as { katex: Katex }).katex;
      for (const el of blocks) {
        katex.render(el.dataset["tex"] ?? "", el, { displayMode: true, throwOnError: false });
      }
    })
    .catch(() => undefined);
}

// ------------------------------------------------------------------ theme

function applyTheme(): void {
  let theme = "os";
  try {
    theme = localStorage.getItem("tsd-theme") ?? "os";
  } catch {
    /* storage blocked */
  }
  document.documentElement.dataset["theme"] = theme;
  const select = document.querySelector<HTMLSelectElement>("#pg-theme");
  if (select) select.value = theme;
}

// ------------------------------------------------------------------ shell

function shell(): void {
  const docs = lang === "fr" ? "../fr/" : "../";
  const other = lang === "fr" ? "en" : "fr";
  document.title = `ElecMap — ${t.title}`;
  document.body.innerHTML = `
<header class="pg-header">
  <a class="pg-brand" href="${docs}"><span class="pg-logo">⏚</span> ElecMap <span class="pg-sub">${t.title}</span></a>
  <nav class="pg-nav">
    <a href="${docs}">${t.docs}</a>
    <a href="?lang=${other}" id="pg-lang">${other === "fr" ? "Français" : "English"}</a>
    <select id="pg-theme" aria-label="Theme">
      <option value="os">${lang === "fr" ? "Thème du système" : "System theme"}</option>
      <option value="light">${lang === "fr" ? "Clair" : "Light"}</option>
      <option value="dark">${lang === "fr" ? "Sombre" : "Dark"}</option>
    </select>
    <button id="pg-share" class="pg-primary">${t.share}</button>
  </nav>
</header>
<main class="pg-main">
  <section class="pg-stage" aria-label="${t.schematic}">
    <div class="pg-bar">
      ${modeSwitch()}
      <select id="pg-example" aria-label="${t.examples}">
        <option value="">${t.examples}…</option>
        ${EXAMPLES.map((e) => `<option value="${e.id}">${esc(e.name[lang])}</option>`).join("")}
      </select>
      <span class="pg-grow"></span>
      <select id="pg-style" aria-label="${t.symbols}" title="${t.symbols}">
        <option value="iec">IEC</option>
        <option value="ansi">ANSI</option>
      </select>
      <details class="pg-menu" id="pg-download">
        <summary>${t.download}</summary>
        <div class="pg-menu-list" role="menu">
          ${(
            [
              ["svg", t.downloadSvg, t.downloadSvgHint],
              ["json", t.downloadJson, t.downloadJsonHint],
              ["netlist", t.downloadNetlist, t.downloadNetlistHint],
              ["cir", t.downloadCir, t.downloadCirHint],
              ["asc", t.downloadAsc, t.downloadAscHint],
            ] as const
          )
            .map(
              ([k, name, hint]) =>
                `<button role="menuitem" data-download="${k}"><strong>${name}</strong><span>${esc(hint)}</span></button>`,
            )
            .join("")}
        </div>
      </details>
    </div>
    <div id="pg-schematic" class="pg-schematic pg-canvas"></div>
    <div id="pg-editor" class="ed" hidden></div>
    <div class="pg-foot">
      <div id="pg-status"></div>
      <p class="pg-hint" id="pg-stage-hint">${t.schematicHint}</p>
      <div class="pg-zoom" role="group" aria-label="Zoom">
        <button data-zoom="out" title="${t.zoomOut}" aria-label="${t.zoomOut}">−</button>
        <button data-zoom="fit" class="pg-zoom-level" title="${t.zoomFitHint}">100 %</button>
        <button data-zoom="in" title="${t.zoomIn}" aria-label="${t.zoomIn}">+</button>
      </div>
    </div>
  </section>
  <div class="pg-split" role="separator" aria-orientation="vertical" tabindex="0" aria-label="${t.panelResize}" title="${t.panelResize}"></div>
  <aside class="pg-side" id="pg-side">
    <div class="pg-side-head">
      <div class="pg-tabs" role="tablist">
        <button role="tab" data-view="netlist">${t.netlist}</button>
        <span class="pg-tab-sep" aria-hidden="true"></span>
        ${(Object.keys(t.tabs) as Tab[])
          .map(
            (k) =>
              `<button role="tab" data-tab="${k}" title="${t.tabs[k]}">${t.tabsShort[k]}</button>`,
          )
          .join("")}
      </div>
      <button class="pg-collapse" data-panel="hide" title="${t.panelHide}" aria-label="${t.panelHide}">»</button>
    </div>
    <div id="pg-netlist-pane" class="pg-pane">
      <textarea id="pg-netlist" spellcheck="false" autocomplete="off" aria-label="${t.netlist}"></textarea>
      <p class="pg-hint" id="pg-netlist-hint">${t.netlistHint}</p>
      <details class="pg-directives" id="pg-directives-box" hidden>
        <summary>${t.editor.directives}</summary>
        <textarea id="pg-directives" spellcheck="false" autocomplete="off" aria-label="${t.editor.directives}"></textarea>
      </details>
    </div>
    <div id="pg-panel" class="pg-panel pg-pane" hidden></div>
  </aside>
  <nav class="pg-rail" id="pg-rail" hidden aria-label="${t.panelShow}">
    <button data-panel="show" title="${t.panelShow}" aria-label="${t.panelShow}">«</button>
    <button data-view="netlist">${t.netlist}</button>
    ${(Object.keys(t.tabs) as Tab[])
      .map((k) => `<button data-tab="${k}" title="${t.tabs[k]}">${t.tabsShort[k]}</button>`)
      .join("")}
  </nav>
</main>
<div id="pg-toast" class="pg-toast" hidden></div>`;
  applyTheme();
}

function modeSwitch(): string {
  return `<div class="pg-seg pg-mode" role="group" aria-label="${t.editor.text} / ${t.editor.draw}">
    <button data-mode="text">${t.editor.text}</button><button data-mode="draw">${t.editor.draw}</button>
  </div>`;
}

// -------------------------------------------------------------- compiling

function compile(): void {
  const status = $("#pg-status");
  try {
    circuit = new ElecMap(state.netlist);
    ground = circuit.toJSON().ground ?? "0";
    const warnings = circuit.circuit.warnings.map((w) => w.message);
    status.innerHTML =
      `<p class="pg-ok">✓ ${t.compiled(circuit.nodes().length, circuit.components().length)}</p>` +
      (warnings.length > 0
        ? `<div class="pg-warn"><strong>${t.warnings}</strong><ul>${warnings
            .map((w) => `<li>${esc(w)}</li>`)
            .join("")}</ul></div>`
        : "");
  } catch (err) {
    circuit = undefined;
    status.innerHTML = errorBox(err);
  }
  fixSelections();
  drawSchematic();
  if (state.mode === "draw") blocks?.setCircuit(circuit);
  renderPanel();
}

/** Keeps the selected nodes and components valid after an edit. */
function fixSelections(): void {
  if (!circuit) return;
  const nodes = circuit.nodes();
  const ids = circuit.components().map((c) => c.id);
  const sources = sourceIds();
  const guess = nodes.includes("out") ? "out" : (nodes[nodes.length - 1] ?? ground);
  if (!nodes.includes(state.output)) state.output = guess;
  if (state.reference !== "" && !nodes.includes(state.reference)) state.reference = "";
  if (!ids.includes(state.outCurrent)) state.outCurrent = ids[0] ?? "";
  const inputOk =
    sources.includes(state.input) ||
    (state.input.startsWith(VOLTAGE) && nodes.includes(state.input.slice(VOLTAGE.length)));
  if (state.input !== "" && !inputOk) state.input = "";
  state.traces = state.traces.filter((n) => nodes.includes(n));
  state.currents = state.currents.filter((id) => ids.includes(id));
  if (state.traces.length === 0 && state.currents.length === 0) {
    state.traces = nodes.includes("in") && guess !== "in" ? ["in", guess] : [guess];
  }
  if (!nodes.includes(state.zA)) state.zA = nodes[0] ?? "";
  if (state.zB !== ground && !nodes.includes(state.zB)) state.zB = ground;
  if (selected !== undefined && !ids.includes(selected)) selected = undefined;
}

/** Prefix of an input that is a node voltage (`v:in`) rather than a source id. */
const VOLTAGE = "v:";

function sourceIds(): string[] {
  return (circuit?.components() ?? [])
    .filter((c) => c.type === "vsource" || c.type === "isource")
    .map((c) => c.id);
}

// -------------------------------------------------------------- schematic

function drawSchematic(): void {
  const box = $("#pg-schematic");
  if (!circuit) {
    box.classList.add("pg-stale");
    return;
  }
  box.classList.remove("pg-stale");
  try {
    box.innerHTML = circuit.toSVG({ theme: "none", style: state.style, title: t.schematic });
    // Fitted to the view until the user zooms.
    const size = schematicSize();
    if (schematicView && !schematicView.manual) schematicView.fit(size.width, size.height);
    sizeSchematic(schematicView?.scale ?? 1);
  } catch (err) {
    box.innerHTML = errorBox(err);
  }
  highlight();
}

/** Size of the schematic at scale 1. */
function schematicSize(): { width: number; height: number } {
  const svg = document.querySelector("#pg-schematic svg");
  return {
    width: Number(svg?.getAttribute("width")) || 1,
    height: Number(svg?.getAttribute("height")) || 1,
  };
}

function sizeSchematic(scale: number): void {
  const svg = document.querySelector<SVGSVGElement>("#pg-schematic svg");
  const { width, height } = schematicSize();
  if (svg) {
    svg.style.width = `${width * scale}px`;
    svg.style.height = `${height * scale}px`;
  }
  $("#pg-schematic").style.setProperty("--grid", `${Math.max(8, 20 * scale)}px`);
  zoomLabel();
}

/** The zoom of the visible drawing, on the zoom button. */
function zoomLabel(): void {
  const v = activeView();
  const el = document.querySelector(".pg-zoom-level");
  if (el && v) el.textContent = `${Math.round(v.scale * 100)} %`;
}

function activeView(): Viewport | undefined {
  return state.mode === "draw" ? editorView : schematicView;
}

/** Fits the visible drawing to the stage. */
function fitView(): void {
  if (state.mode === "draw") {
    if (blocks && editorView) {
      const e = blocks.extent();
      editorView.fit(e.width, e.height, 1);
    }
  } else if (schematicView) {
    const size = schematicSize();
    schematicView.fit(size.width, size.height);
  }
  zoomLabel();
}

function zoom(action: string): void {
  const v = activeView();
  if (!v) return;
  if (action === "in") v.zoomIn();
  else if (action === "out") v.zoomOut();
  else fitView();
  zoomLabel();
}

/** Marks the probed nodes and the selected component on the schematic and the drawing. */
function highlight(): void {
  const svg = document.querySelector("#pg-schematic svg");
  if (svg) decorate(svg);
  const drawn = document.querySelector("#pg-editor .ed-canvas svg");
  if (drawn) decorate(drawn);
}

/**
 * Clickable boxes around the components, in a layer under the wires: a click
 * anywhere in a component's box selects it, and the wires stay clickable.
 */
function addHitBoxes(svg: Element): void {
  if (svg.querySelector(".pg-hits")) return;
  const NS = "http://www.w3.org/2000/svg";
  const layer = document.createElementNS(NS, "g");
  layer.setAttribute("class", "pg-hits");
  for (const g of svg.querySelectorAll<SVGGElement>("g[data-id]")) {
    const id = g.dataset["id"] ?? "";
    if (id.startsWith("__")) continue;
    const b = g.getBBox();
    // Not laid out yet (hidden): try again on the next decoration.
    if (b.width === 0 && b.height === 0) return;
    const pad = 5;
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("class", "pg-hit");
    rect.setAttribute("data-hit", id);
    rect.setAttribute("x", String(b.x - pad));
    rect.setAttribute("y", String(b.y - pad));
    rect.setAttribute("width", String(b.width + 2 * pad));
    rect.setAttribute("height", String(b.height + 2 * pad));
    rect.setAttribute("rx", "6");
    layer.append(rect);
  }
  // Right after the background (and the editor's grid), before the wires.
  const anchor = svg.querySelector(".ed-grid") ?? svg.querySelector(".bg");
  if (anchor) anchor.after(layer);
  else svg.prepend(layer);
  // The box lights up while the pointer is over the component or its box.
  const hover = (e: Event, on: boolean) => {
    const el = (e.target as Element).closest<SVGElement>("g[data-id], [data-hit]");
    const id = el?.dataset["id"] ?? el?.dataset["hit"];
    if (id) layer.querySelector(`[data-hit="${CSS.escape(id)}"]`)?.classList.toggle("hover", on);
  };
  svg.addEventListener("pointerover", (e) => hover(e, true));
  svg.addEventListener("pointerout", (e) => hover(e, false));
}

function decorate(svg: Element): void {
  addHitBoxes(svg);
  const nodes = new Set<string>();
  if (state.tab === "transfer" && state.outKind === "voltage") {
    nodes.add(state.output);
    if (state.reference) nodes.add(state.reference);
  }
  if (state.tab === "transient") state.traces.forEach((n) => nodes.add(n));
  if (state.tab === "impedance") [state.zA, state.zB].forEach((n) => nodes.add(n));
  const parts = new Set<string>();
  if (selected) parts.add(selected);
  if (state.tab === "transfer" && state.outKind === "current") parts.add(state.outCurrent);
  if (state.tab === "transient") state.currents.forEach((id) => parts.add(id));
  for (const el of svg.querySelectorAll<SVGElement>("[data-node]")) {
    el.classList.toggle("hl", nodes.has(el.dataset["node"] ?? ""));
  }
  for (const el of svg.querySelectorAll<SVGElement>("g[data-id]")) {
    el.classList.toggle("hl", parts.has(el.dataset["id"] ?? ""));
  }
  for (const el of svg.querySelectorAll<SVGElement>("[data-hit]")) {
    el.classList.toggle("hl", parts.has(el.dataset["hit"] ?? ""));
  }
}

function onSchematicClick(event: MouseEvent): void {
  const target = event.target as Element;
  const wire = target.closest<SVGElement>("[data-node]");
  const part = target.closest<SVGElement>("g[data-id], [data-hit]");
  if (wire) probe("node", wire.dataset["node"] ?? "");
  else if (part) probe("part", part.dataset["id"] ?? part.dataset["hit"] ?? "");
}

/** A node or a component was clicked: probe it in the current tab. */
function probe(kind: "node" | "part", value: string): void {
  if (kind === "node") {
    const node = value;
    if (state.tab === "transient") toggle(state.traces, node);
    else if (state.tab === "impedance") state.zA = node;
    else {
      if (state.tab !== "transfer") state.tab = "transfer";
      state.outKind = "voltage";
      state.output = node;
    }
  } else {
    const id = value;
    selected = selected === id ? undefined : id;
    if (state.tab === "transient") toggle(state.currents, id);
    if (state.tab === "transfer" && state.outKind === "current") state.outCurrent = id;
  }
  showView("analysis");
}

function toggle(list: string[], value: string): void {
  const i = list.indexOf(value);
  if (i >= 0) list.splice(i, 1);
  else list.push(value);
}

// ------------------------------------------------------------------ panel

function renderTabs(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tab], [data-view]")) {
    const on =
      b.dataset["view"] === "netlist"
        ? view === "netlist"
        : view === "analysis" && b.dataset["tab"] === state.tab;
    b.classList.toggle("on", on);
    if (b.getAttribute("role") === "tab") b.setAttribute("aria-selected", String(on));
  }
  $("#pg-netlist-pane").hidden = view !== "netlist";
  $("#pg-panel").hidden = view !== "analysis";
}

/** Shows the netlist or the analysis in the side panel (and opens it). */
function showView(next: typeof view): void {
  view = next;
  setCollapsed(false);
  renderTabs();
  renderPanel();
}

function renderPanel(): void {
  const panel = $("#pg-panel");
  panel.classList.toggle("pg-stale", !circuit);
  // Analyses only run when they are seen.
  if (view !== "analysis" || panelCollapsed) {
    highlight();
    return;
  }
  if (!circuit) return;
  if (sourceIds().length === 0 && state.tab !== "impedance") {
    panel.innerHTML = `<p class="pg-note">${t.sources}</p>`;
    highlight();
    return;
  }
  try {
    panel.innerHTML = {
      dc: dcPanel,
      transfer: transferPanel,
      transient: transientPanel,
      impedance: impedancePanel,
    }[state.tab](circuit);
  } catch (err) {
    panel.innerHTML = errorBox(err);
  }
  renderMath(panel);
  highlight();
}

// DC ----------------------------------------------------------------------

function dcPanel(c: ElecMap): string {
  const op = c.operatingPoint();
  const nodes = c
    .nodes()
    .map(
      (n) =>
        `<tr data-node="${esc(n)}"><td><code>${esc(n)}</code></td><td class="num">${si(op.voltage(n), "V")}</td></tr>`,
    )
    .join("");
  let balance = 0;
  const rows = c
    .components()
    .map((comp) => {
      const current = attempt(() => op.current(comp.id));
      const power = attempt(() => op.power(comp.id));
      if (power !== undefined) balance += power;
      const cls = comp.id === selected ? ` class="sel"` : "";
      return `<tr data-id="${esc(comp.id)}"${cls}><td><code>${esc(comp.id)}</code></td><td>${esc(typeName(comp))}</td>
        <td class="num">${current === undefined ? "—" : si(current, "A")}</td>
        <td class="num">${power === undefined ? "—" : si(power, "W")}</td></tr>`;
    })
    .join("");
  const notes = [
    op.iterations > 0 ? t.newton(op.iterations) : t.linear,
    ...(op.gminUsed ? [t.gmin] : []),
  ];
  return `
<div class="pg-grid2">
  <table class="pg-table"><thead><tr><th>${t.node}</th><th class="num">${t.voltage}</th></tr></thead><tbody>${nodes}</tbody></table>
  <table class="pg-table"><thead><tr><th>${t.component}</th><th>${t.type}</th><th class="num">${t.current}</th><th class="num">${t.power}</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td colspan="3">${t.powerBalance} (Σ P)</td><td class="num">${si(Math.abs(balance) < 1e-12 ? 0 : balance, "W")}</td></tr></tfoot></table>
</div>
<p class="pg-note">${notes.join(" · ")}</p>`;
}

/** A node name inside LaTeX. */
const texName = (name: string): string => `\\mathrm{${name.replace(/[_#%&${}]/g, "\\$&")}}`;

function attempt<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}

function typeName(comp: ComponentJSON): string {
  return t.types[comp.type] ?? comp.type;
}

// Transfer function -------------------------------------------------------

function outputSpec(): OutputSpec {
  if (state.outKind === "current") return { current: state.outCurrent };
  return state.reference ? [state.output, state.reference] : state.output;
}

function transferPanel(c: ElecMap): string {
  const nodes = c.nodes();
  const ids = c.components().map((x) => x.id);
  const controls = `
<div class="pg-controls">
  <label>${t.input}
    <select data-bind="input">${option("", `${t.auto}`, state.input)}${sourceIds()
      .map((id) => option(id, id, state.input))
      .join("")}${nodes
      .filter((n) => n !== state.output)
      .map((n) => option(`${VOLTAGE}${n}`, `V(${n})`, state.input))
      .join("")}</select></label>
  <label>${t.output}
    <select data-bind="outKind">${option("voltage", t.outputVoltage, state.outKind)}${option(
      "current",
      t.outputCurrent,
      state.outKind,
    )}</select>
    ${
      state.outKind === "voltage"
        ? `<select data-bind="output">${nodes.map((n) => option(n, n, state.output)).join("")}</select>`
        : `<select data-bind="outCurrent">${ids.map((n) => option(n, n, state.outCurrent)).join("")}</select>`
    }</label>
  ${
    state.outKind === "voltage"
      ? `<label>${t.reference}<select data-bind="reference">${option("", ground, state.reference)}${nodes
          .filter((n) => n !== state.output)
          .map((n) => option(n, n, state.reference))
          .join("")}</select></label>`
      : ""
  }
  <div class="pg-seg">
    <button data-literal="0" class="${state.literal ? "" : "on"}">${t.numeric}</button>
    <button data-literal="1" class="${state.literal ? "on" : ""}">${t.literal}</button>
  </div>
</div>`;

  const node = state.input.startsWith(VOLTAGE) ? state.input.slice(VOLTAGE.length) : "";
  const source = node ? "" : state.input;
  const spec = { output: outputSpec(), ...(source ? { input: source } : {}) };
  const full: TransferOptions = node ? { ...spec, input: { voltage: node } } : spec;
  const H = c.transferFunction(full);
  const name = state.outKind === "current" ? "\\frac{I(s)}{V_{in}(s)}" : "H(s)";
  let latex = `${name} = ${H.toLatex()}`;
  let literalNote = "";
  if (state.literal && node) {
    literalNote = `<p class="pg-note">${t.literalUnavailable}: V(${esc(node)})</p>`;
  } else if (state.literal) {
    try {
      latex = `${name} = ${c.symbolicTransferFunction(spec).toLatex()}`;
    } catch (err) {
      literalNote = `<p class="pg-note">${t.literalUnavailable}: ${esc(message(err))}</p>`;
    }
  }
  return `${controls}
<div class="pg-math" data-tex="${esc(latex)}"></div>${literalNote}
${metrics(H)}
${bodeControls(true)}
${state.mc ? monteCarloBode(c, full, H) : bodePlot(H)}`;
}

/** Tolerances of the Monte-Carlo controls: R, C and L by kind, plus "id[.field] percent" entries. */
function tolerances(c: ElecMap): Record<string, number> {
  const byKind: Record<string, string> = {
    resistor: state.tolR,
    capacitor: state.tolC,
    inductor: state.tolL,
  };
  const result: Record<string, number> = {};
  for (const comp of c.components()) {
    const pct = parseNumber(byKind[comp.type] ?? "");
    if (pct !== undefined && pct > 0) result[comp.id] = pct / 100;
  }
  for (const entry of state.tolOther.split(/[,;\n]+/)) {
    if (entry.trim() === "") continue;
    const m = /^\s*([\w.]+)\s*[=:\s]\s*±?\s*([^\s%]+)\s*%?\s*$/.exec(entry);
    const pct = m ? parseNumber(m[2] as string) : undefined;
    if (!m || pct === undefined || pct < 0) throw new Error(`${t.tolSyntax}: "${entry.trim()}"`);
    result[m[1] as string] = pct / 100;
  }
  return result;
}

function monteCarloBode(c: ElecMap, spec: TransferOptions, H: TransferFunction): string {
  const [fStart, fStop] = frequencyRange(H);
  let mc: MonteCarlo;
  let bode: MonteCarloBode;
  try {
    const runs = Math.min(Math.max(Math.round(parseNumber(state.runs) ?? 100), 1), 2000);
    mc = c.monteCarlo({ tolerances: tolerances(c), runs });
    bode = mc.bode(spec, { fStart, fStop, points: 40 });
  } catch (err) {
    return `<p class="pg-error">${esc(message(err))}</p>${bodePlot(H)}`;
  }
  const peak = Math.max(...bode.nominal.magnitudeDb.filter(Number.isFinite));
  const floor = Math.min(peak - 120, -40);
  const clip = (v: readonly number[]) => v.map((x) => Math.max(x, floor));
  const spread: [string, (h: TransferFunction) => number | undefined, string][] = [
    [t.dcGain, (h) => h.dcGain(), ""],
    [t.cutoff, (h) => attempt(() => h.cutoffFrequency()), "Hz"],
    [t.f0, (h) => h.naturalFrequency(), "Hz"],
    [t.q, (h) => h.qFactor(), ""],
  ];
  const rows = spread
    .map(([label, f, unit]) => {
      const s = mc.statistics((x) => f(x.transferFunction(spec)));
      if (!Number.isFinite(s.nominal) || s.nominal === 0 || !Number.isFinite(s.min)) return "";
      if (s.max - s.min <= Math.abs(s.nominal) * 1e-9) return "";
      const num = (v: number) => (unit ? si(v, unit) : v.toPrecision(4));
      const rel = (v: number) =>
        `${v >= s.nominal ? "+" : "−"}${Math.abs((v / s.nominal - 1) * 100).toFixed(1)} %`;
      return `<div><dt>${label}</dt><dd>${num(s.min)} … ${num(s.max)}<small>${rel(s.min)} / ${rel(s.max)} · σ ${num(s.std)}</small></dd></div>`;
    })
    .join("");
  return `<dl class="pg-metrics pg-mc-stats">${rows}</dl>
${figure(
  {
    logX: true,
    xLabel: t.frequency,
    panels: [
      {
        bands: [
          {
            x: bode.freq,
            lo: clip(bode.magnitudeDb.min),
            hi: clip(bode.magnitudeDb.max),
            label: `${mc.length} ${t.runsLabel}`,
          },
        ],
        series: [{ x: bode.freq, y: clip(bode.nominal.magnitudeDb), label: t.nominal }],
        yLabel: t.gainDb,
      },
      {
        bands: [{ x: bode.freq, lo: bode.phase.min, hi: bode.phase.max }],
        series: [{ x: bode.freq, y: bode.nominal.phase, label: "φ" }],
        yLabel: t.phase,
        yTicks: phaseTicks([...bode.phase.min, ...bode.phase.max]),
      },
    ],
  },
  [
    ["dB", 4],
    ["°", 4],
  ],
)}`;
}

function metrics(H: TransferFunction): string {
  const items: [string, string][] = [];
  const db = (g: number) =>
    g === 0 ? "" : ` (${(20 * Math.log10(Math.abs(g))).toFixed(2).replace(/^-0\.00$/, "0.00")} dB)`;
  const dc = H.dcGain();
  items.push([t.dcGain, `${si(dc, "")}${Number.isFinite(dc) ? db(dc) : ""}`]);
  const hf = H.highFrequencyGain();
  items.push([t.hfGain, `${si(hf, "")}${Number.isFinite(hf) ? db(hf) : ""}`]);
  items.push([t.filter, t.filters[H.filterType()] ?? H.filterType()]);
  items.push([t.order, String(H.order)]);
  const cutoffs = attempt(() => H.cutoffFrequencies()) ?? [];
  if (cutoffs.length > 0) items.push([t.cutoff, cutoffs.map((f) => si(f, "Hz")).join(", ")]);
  const f0 = H.naturalFrequency();
  if (f0 !== undefined) items.push([t.f0, si(f0, "Hz")]);
  const q = H.qFactor();
  if (q !== undefined) items.push([t.q, q.toPrecision(4)]);
  const zeta = H.dampingRatio();
  if (zeta !== undefined) items.push([t.zeta, zeta.toPrecision(4)]);
  if (H.filterType() === "bandpass") {
    const peak = H.peakGain();
    items.push([t.peak, `${si(peak, "")}${db(peak)} @ ${si(H.peakFrequency(), "Hz")}`]);
  }
  const bw = attempt(() => H.bandwidth());
  if (bw !== undefined) items.push([t.bandwidth, si(bw, "Hz")]);
  items.push([t.stable, H.isStable() ? t.yes : t.no]);
  const roots = (list: Complex[]) =>
    list.length === 0
      ? t.none
      : list
          .map(
            (p) =>
              `${complexText(p, "rad/s")} <span class="pg-dim">(${si(p.abs() / (2 * Math.PI), "Hz")})</span>`,
          )
          .join("<br>");
  return `<dl class="pg-metrics">${items
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("")}</dl>
<div class="pg-grid2 pg-roots">
  <div><h3>${t.poles}</h3><p>${roots(H.poles())}</p></div>
  <div><h3>${t.zeros}</h3><p>${roots(H.zeros())}</p></div>
</div>`;
}

function bodeControls(tolerance = false): string {
  const pct = (key: "tolR" | "tolC" | "tolL", label: string) =>
    `<label>${label} ±<input data-bind="${key}" value="${esc(state[key])}" size="3"> %</label>`;
  const toggle = tolerance
    ? `<button data-mc class="pg-toggle${state.mc ? " on" : ""}" title="${esc(t.mcHint)}">± ${t.mcEnvelope}</button>`
    : "";
  const mcRow =
    tolerance && state.mc
      ? `<div class="pg-controls pg-small pg-mc">
  ${pct("tolR", "R")}${pct("tolC", "C")}${pct("tolL", "L")}
  <label>${t.tolOther}<input data-bind="tolOther" value="${esc(state.tolOther)}" placeholder="${esc(t.tolOtherHint)}" size="14"></label>
  <label><input data-bind="runs" value="${esc(state.runs)}" size="4"> ${t.runsLabel}</label>
</div>`
      : "";
  return `<div class="pg-controls pg-small">
  <label>${t.from}<input data-bind="fStart" placeholder="${t.auto}" value="${esc(state.fStart)}" size="7"> Hz</label>
  <label>${t.to}<input data-bind="fStop" placeholder="${t.auto}" value="${esc(state.fStop)}" size="7"> Hz</label>
  ${toggle}
</div>${mcRow}`;
}

function frequencyRange(H: TransferFunction): [number, number] {
  const [a, b] = H.frequencyRange();
  const lo = parseNumber(state.fStart);
  const hi = parseNumber(state.fStop);
  const start = lo !== undefined && lo > 0 ? lo : a;
  const stop = hi !== undefined && hi > start ? hi : Math.max(b, start * 10);
  // Whole decades, so that the log axis ticks fall on 1, 10, 100…
  return [10 ** Math.floor(Math.log10(start)), 10 ** Math.ceil(Math.log10(stop))];
}

function bodePlot(H: TransferFunction): string {
  const [fStart, fStop] = frequencyRange(H);
  const bode = H.bode({ fStart, fStop, points: 400 });
  const peak = Math.max(...bode.magnitudeDb.filter(Number.isFinite));
  const floor = Math.min(peak - 120, -40);
  const gain = bode.magnitudeDb.map((v) => Math.max(v, floor));
  return figure(
    {
      logX: true,
      xLabel: t.frequency,
      panels: [
        { series: [{ x: bode.freq, y: gain, label: "|H|" }], yLabel: t.gainDb },
        {
          series: [{ x: bode.freq, y: bode.phase, label: "φ" }],
          yLabel: t.phase,
          yTicks: phaseTicks(bode.phase),
        },
      ],
    },
    [
      ["dB", 4],
      ["°", 4],
    ],
  );
}

/** Phase ticks on multiples of 45°, or of 90° and 180° for wide ranges. */
function phaseTicks(phase: readonly number[]): number[] {
  const lo = Math.min(...phase);
  const hi = Math.max(...phase);
  const span = hi - lo;
  const step = span > 540 ? 180 : span > 200 ? 90 : 45;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step; v += step)
    ticks.push(v);
  return ticks;
}

// Transient ---------------------------------------------------------------

function defaultStop(c: ElecMap): number {
  // A few time constants of the slowest pole, else 10 ms.
  try {
    const H = c.transferFunction({ output: state.traces[0] ?? state.output });
    const taus = H.timeConstants().filter((x) => Number.isFinite(x) && x > 0);
    if (taus.length > 0) return Number((5 * Math.max(...taus)).toPrecision(1));
  } catch {
    /* no transfer function */
  }
  return 10e-3;
}

function transientPanel(c: ElecMap): string {
  if (state.tStop === "") state.tStop = spice(defaultStop(c));
  const tStop = parseNumber(state.tStop) ?? 1e-3;
  const step = parseNumber(state.tStep);
  const nodes = c.nodes();
  const ids = c
    .components()
    .filter((x) => x.type !== "coupling")
    .map((x) => x.id);
  const check = (list: string[], key: string, value: string) =>
    `<label class="pg-check"><input type="checkbox" data-list="${key}" value="${esc(value)}"${
      list.includes(value) ? " checked" : ""
    }><code>${esc(value)}</code></label>`;
  const controls = `
<div class="pg-controls">
  <label>${t.tStop}<input data-bind="tStop" value="${esc(state.tStop)}" size="7"> s</label>
  <label>${t.tStep}<input data-bind="tStep" placeholder="${spice(tStop / 1000)}" value="${esc(state.tStep)}" size="7"> s</label>
  <label>${t.method}<select data-bind="method">${(["gear2", "trap", "euler"] as const)
    .map((m) => option(m, m, state.method))
    .join("")}</select></label>
</div>
<div class="pg-traces">
  <div><span>${t.voltages}</span>${nodes.map((n) => check(state.traces, "traces", n)).join("")}</div>
  <div><span>${t.currents}</span>${ids.map((id) => check(state.currents, "currents", id)).join("")}</div>
</div>`;
  if (state.traces.length === 0 && state.currents.length === 0) {
    return `${controls}<p class="pg-note">${t.pickTrace}</p>`;
  }
  const result = c.transient({
    tStop,
    method: state.method,
    ...(step !== undefined && step > 0 ? { tStep: Math.max(step, tStop / 20000) } : {}),
  });
  const x = result.time;
  const panels: Panel[] = [];
  const units: [string, number][] = [];
  if (state.traces.length > 0) {
    panels.push({
      series: state.traces.map((n) => ({ x, y: result.voltage(n), label: `V(${n})` })),
      yLabel: t.voltageAxis,
    });
    units.push(["V", 4]);
  }
  if (state.currents.length > 0) {
    panels.push({
      series: state.currents.map((id) => ({ x, y: result.current(id), label: `I(${id})` })),
      yLabel: t.currentAxis,
    });
    units.push(["A", 4]);
  }
  return `${controls}${figure({ xLabel: t.time, xFormat: (v) => si(v, "s", 3), panels }, units)}`;
}

// Impedance ---------------------------------------------------------------

function impedancePanel(c: ElecMap): string {
  const nodes = c.nodes();
  const all = [...nodes, ground];
  const controls = `
<div class="pg-controls">
  <label>${t.between}<select data-bind="zA">${nodes.map((n) => option(n, n, state.zA)).join("")}</select></label>
  <label>${t.and}<select data-bind="zB">${all
    .filter((n) => n !== state.zA)
    .map((n) => option(n, n, state.zB))
    .join("")}</select></label>
</div>`;
  const b = state.zB === ground ? undefined : state.zB;
  const Z = c.impedance(state.zA, b);
  const items: [string, string][] = [
    [t.zDc, si(Z.dcGain(), "Ω")],
    [t.zHf, si(Z.highFrequencyGain(), "Ω")],
  ];
  const r = attempt(() => c.equivalentResistance(state.zA, b));
  items.push([
    t.equivalentR,
    r === undefined ? `<span class="pg-dim">${t.notResistive}</span>` : si(r, "Ω"),
  ]);
  const th = attempt(() => c.thevenin(state.zA, b));
  if (th) items.push([t.thevenin, `${si(th.voltage, "V")} · ${si(th.resistance, "Ω")}`]);
  const [fStart, fStop] = frequencyRange(Z);
  const bode = Z.bode({ fStart, fStop, points: 400 });
  const label = `Z_{${texName(state.zA)}${b ? `,${texName(b)}` : ""}}(s)`;
  return `${controls}
<div class="pg-math" data-tex="${esc(`${label} = ${Z.toLatex()}`)}"></div>
<dl class="pg-metrics">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
${bodeControls()}
${figure(
  {
    logX: true,
    xLabel: t.frequency,
    panels: [
      { series: [{ x: bode.freq, y: bode.magnitude, label: "|Z|" }], yLabel: t.zLabel, logY: true },
      {
        series: [{ x: bode.freq, y: bode.phase, label: "φ" }],
        yLabel: t.phase,
        yTicks: phaseTicks(bode.phase),
      },
    ],
  },
  [
    ["Ω", 4],
    ["°", 4],
  ],
)}`;
}

// ------------------------------------------------------------------ plots

interface PlotData {
  panels: { series: Series[]; unit: string; digits: number }[];
  xFormat: (v: number) => string;
}

const plots = new Map<string, PlotData>();
let plotCount = 0;

/** Plots are drawn at the width of the panel, so their text keeps its size. */
function plotWidth(): number {
  const w = document.querySelector("#pg-panel")?.clientWidth ?? 0;
  return Math.max(320, Math.round(w > 0 ? w : 560));
}

/** A plot with a cursor that reads every series at the mouse position. */
function figure(options: Parameters<typeof plot>[0], units: [string, number][]): string {
  const id = `p${++plotCount}`;
  const xFormat = options.xFormat ?? ((v: number) => si(v, "Hz", 4));
  plots.set(id, {
    panels: options.panels.map((p, i) => ({
      series: p.series,
      unit: units[i]?.[0] ?? "",
      digits: units[i]?.[1] ?? 4,
    })),
    xFormat,
  });
  return `<figure class="pg-plot" data-plot="${id}">${plot({ width: plotWidth(), panelHeight: 130, ...options })}<div class="pg-cursor" hidden></div><div class="pg-readout" hidden></div></figure>`;
}

function onPlotMove(event: MouseEvent): void {
  const fig = (event.target as Element).closest<HTMLElement>("[data-plot]");
  if (!fig) return;
  const svg = fig.querySelector<SVGSVGElement>("svg");
  const data = plots.get(fig.dataset["plot"] ?? "");
  const cursor = fig.querySelector<HTMLElement>(".pg-cursor");
  const readout = fig.querySelector<HTMLElement>(".pg-readout");
  if (!svg || !data || !cursor || !readout) return;
  const box = svg.getBoundingClientRect();
  const scale = box.width / svg.viewBox.baseVal.width;
  const left = Number(svg.dataset["left"]);
  const right = Number(svg.dataset["right"]);
  const px = (event.clientX - box.left) / scale;
  if (px < left || px > right) {
    cursor.hidden = true;
    readout.hidden = true;
    return;
  }
  const min = Number(svg.dataset["xmin"]);
  const max = Number(svg.dataset["xmax"]);
  const u = (px - left) / (right - left);
  const x =
    svg.dataset["log"] === "1"
      ? 10 ** (Math.log10(min) + u * (Math.log10(max) - Math.log10(min)))
      : min + u * (max - min);
  const xs = data.panels[0]?.series[0]?.x ?? [];
  let k = 0;
  let lo = 0;
  let hi = xs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] as number) < x) lo = mid + 1;
    else hi = mid - 1;
  }
  k = Math.min(Math.max(lo, 0), xs.length - 1);
  if (k > 0 && Math.abs((xs[k - 1] as number) - x) < Math.abs((xs[k] as number) - x)) k--;
  const figBox = fig.getBoundingClientRect();
  const sx = box.left - figBox.left;
  const xAt =
    svg.dataset["log"] === "1"
      ? (Math.log10(xs[k] as number) - Math.log10(min)) / (Math.log10(max) - Math.log10(min))
      : ((xs[k] as number) - min) / (max - min);
  cursor.hidden = false;
  cursor.style.left = `${sx + (left + xAt * (right - left)) * scale}px`;
  cursor.style.top = `${box.top - figBox.top}px`;
  cursor.style.height = `${box.height}px`;
  const lines = data.panels.flatMap((p) =>
    p.series.map((s, i) => {
      const v = s.y[k] ?? NaN;
      return `<div><i class="c${(i % 5) + 1}"></i>${esc(s.label ?? "")} <b>${si(v, p.unit, p.digits)}</b></div>`;
    }),
  );
  readout.hidden = false;
  readout.innerHTML = `<div class="pg-readout-x">${data.xFormat(xs[k] as number)}</div>${lines.join("")}`;
  const cx = event.clientX - figBox.left;
  const flip = cx > figBox.width * 0.6;
  readout.style.left = flip ? "" : `${cx + 14}px`;
  readout.style.right = flip ? `${figBox.width - cx + 14}px` : "";
  readout.style.top = `${Math.max(event.clientY - figBox.top - 20, 0)}px`;
}

function onPlotLeave(event: MouseEvent): void {
  const fig = (event.target as Element).closest<HTMLElement>("[data-plot]");
  fig?.querySelectorAll<HTMLElement>(".pg-cursor, .pg-readout").forEach((el) => (el.hidden = true));
}

// ------------------------------------------------------------------ share

function encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(token: string): string {
  const bin = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

const SHARED: (keyof State)[] = [
  "tab",
  "input",
  "outKind",
  "output",
  "reference",
  "outCurrent",
  "tStop",
  "zA",
  "zB",
  "tolR",
  "tolC",
  "tolL",
  "tolOther",
  "runs",
];

function shareUrl(): string {
  const hash = new URLSearchParams({ c: encode(state.netlist) });
  if (state.mode === "draw" && blocks) hash.set("d", encode(JSON.stringify(blocks.drawing)));
  for (const key of SHARED) {
    const v = state[key];
    if (typeof v === "string" && v !== "") hash.set(key, v);
  }
  if (state.mc) hash.set("mc", "1");
  if (state.traces.length > 0) hash.set("traces", state.traces.join(","));
  if (state.currents.length > 0) hash.set("currents", state.currents.join(","));
  return `${location.origin}${location.pathname}${location.search}#${hash.toString()}`;
}

function readHash(): boolean {
  if (!location.hash) return false;
  const hash = new URLSearchParams(location.hash.slice(1));
  const c = hash.get("c");
  if (!c) return false;
  try {
    state.netlist = decode(c);
  } catch {
    return false;
  }
  for (const key of SHARED) {
    const v = hash.get(key);
    if (v !== null) (state as unknown as Record<string, string>)[key] = v;
  }
  state.mc = hash.get("mc") === "1";
  state.traces = hash.get("traces")?.split(",").filter(Boolean) ?? [];
  state.currents = hash.get("currents")?.split(",").filter(Boolean) ?? [];
  const d = hash.get("d");
  pendingDrawing = undefined;
  if (d) {
    try {
      pendingDrawing = JSON.parse(decode(d)) as Drawing;
      state.mode = "draw";
    } catch {
      /* ignore a broken drawing */
    }
  } else state.mode = "text";
  return true;
}

function toast(text: string): void {
  const el = $("#pg-toast");
  el.textContent = text;
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 1800);
}

/** Drawing read from a link or the storage, loaded once the editor exists. */
let pendingDrawing: Drawing | undefined;

function save(): void {
  try {
    localStorage.setItem("elecmap-playground", state.netlist);
    localStorage.setItem(
      "elecmap-playground-drawing",
      JSON.stringify({ mode: state.mode, drawing: blocks?.drawing }),
    );
  } catch {
    /* storage blocked */
  }
}

/** SPICE analysis lines matching the open tab. */
function spiceAnalysis(): string[] {
  switch (state.tab) {
    case "transfer":
    case "impedance":
      return [`.ac dec 50 ${state.fStart} ${state.fStop}`];
    case "transient":
      return [`.tran ${state.tStep} ${state.tStop}`];
    default:
      return [".op"];
  }
}

function download(kind: string): void {
  const c = circuit;
  if (!c) return;
  const files: Record<string, () => [string, string, string]> = {
    svg: () => [
      c.toSVG({ theme: "light", style: state.style, background: true }),
      "image/svg+xml",
      "svg",
    ],
    json: () => [`${JSON.stringify(c.toJSON(), null, 2)}\n`, "application/json", "json"],
    netlist: () => [c.toSpice(), "text/plain", "sp"],
    cir: () => [c.toCir({ analysis: spiceAnalysis() }), "text/plain", "cir"],
    asc: () => [c.toAsc({ analysis: spiceAnalysis() }), "text/plain", "asc"],
  };
  const make = files[kind];
  if (!make) return;
  const [text, type, ext] = make();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = `circuit.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------ side panel

const PANEL_KEY = "elecmap-playground-panel";
let panelCollapsed = false;
let panelWidth = 0;

/** Width limits of the side panel, in pixels. */
function panelLimits(): [number, number] {
  return [320, Math.max(360, Math.round(window.innerWidth * 0.7))];
}

function setPanelWidth(width: number): void {
  const [min, max] = panelLimits();
  panelWidth = Math.round(Math.min(max, Math.max(min, width)));
  $(".pg-main").style.setProperty("--side", `${panelWidth}px`);
  const split = $(".pg-split");
  split.setAttribute("aria-valuemin", String(min));
  split.setAttribute("aria-valuemax", String(max));
  split.setAttribute("aria-valuenow", String(panelWidth));
}

function setCollapsed(collapsed: boolean): void {
  if (collapsed === panelCollapsed) return;
  panelCollapsed = collapsed;
  $(".pg-main").classList.toggle("pg-collapsed", collapsed);
  $("#pg-side").hidden = collapsed;
  $(".pg-split").hidden = collapsed;
  $("#pg-rail").hidden = !collapsed;
  savePanel();
}

function savePanel(): void {
  try {
    localStorage.setItem(
      PANEL_KEY,
      JSON.stringify({ width: panelWidth, collapsed: panelCollapsed }),
    );
  } catch {
    /* storage blocked */
  }
}

/** Width and state of the panel from the last visit (about 40 % of the window at first). */
function restorePanel(): void {
  let saved: { width?: number; collapsed?: boolean } = {};
  try {
    saved = JSON.parse(localStorage.getItem(PANEL_KEY) ?? "{}") as typeof saved;
  } catch {
    /* storage blocked */
  }
  setPanelWidth(saved.width ?? Math.min(640, window.innerWidth * 0.4));
  setCollapsed(saved.collapsed === true);
}

/** The bar between the stage and the panel: drag it, or use the arrow keys. */
function splitter(): void {
  const split = $(".pg-split");
  let drag: { x: number; width: number } | undefined;
  split.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag = { x: e.clientX, width: panelWidth };
    split.setPointerCapture(e.pointerId);
    document.body.classList.add("pg-resizing");
  });
  split.addEventListener("pointermove", (e) => {
    if (drag) setPanelWidth(drag.width - (e.clientX - drag.x));
  });
  const end = () => {
    if (!drag) return;
    drag = undefined;
    document.body.classList.remove("pg-resizing");
    savePanel();
  };
  split.addEventListener("pointerup", end);
  split.addEventListener("pointercancel", end);
  split.addEventListener("dblclick", () => {
    setPanelWidth(Math.min(640, window.innerWidth * 0.4));
    savePanel();
  });
  split.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 80 : 24;
    if (e.key === "ArrowLeft") setPanelWidth(panelWidth + step);
    else if (e.key === "ArrowRight") setPanelWidth(panelWidth - step);
    else if (e.key === "Enter") setCollapsed(true);
    else return;
    e.preventDefault();
    savePanel();
  });

  // Plots follow the width of the panel; drawings stay fitted until zoomed.
  let width = $("#pg-panel").clientWidth;
  let timer: ReturnType<typeof setTimeout> | undefined;
  new ResizeObserver(() => {
    const w = $("#pg-panel").clientWidth;
    if (w === 0 || Math.abs(w - width) < 24) return;
    width = w;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (view === "analysis" && document.querySelector("#pg-panel .pg-plot")) renderPanel();
    }, 150);
  }).observe($("#pg-side"));
  let fitTimer: ReturnType<typeof setTimeout> | undefined;
  new ResizeObserver(() => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      const v = activeView();
      if (v && !v.manual) fitView();
      else if (state.mode === "draw") blocks?.render();
    }, 100);
  }).observe($(".pg-stage"));
}

// ------------------------------------------------------------------ events

function loadExample(id: string): void {
  const e = EXAMPLES.find((x) => x.id === id);
  if (!e) return;
  state.netlist = e.netlist;
  state.tab = e.tab;
  state.input = "";
  state.outKind = "voltage";
  state.output = e.output ?? "";
  state.reference = "";
  state.traces = e.trace ? [...e.trace] : [];
  state.currents = [];
  state.tStop = e.tStop !== undefined ? spice(e.tStop) : "";
  state.tStep = "";
  state.fStart = "";
  state.fStop = "";
  state.zA = e.port?.[0] ?? "";
  state.zB = e.port?.[1] ?? "";
  state.literal = false;
  selected = undefined;
  $<HTMLTextAreaElement>("#pg-netlist").value = state.netlist;
  if (schematicView) schematicView.manual = false;
  if (editorView) editorView.manual = false;
  view = "analysis";
  setCollapsed(false);
  renderTabs();
  if (state.mode === "draw") setMode("draw", true);
  else compile();
  save();
}

// ------------------------------------------------------------------ modes

let drawTimer: ReturnType<typeof setTimeout> | undefined;

/** Netlist generated by the drawing. */
function drawingChanged(netlist: string): void {
  drawnNetlist = netlist;
  state.netlist = netlist;
  $<HTMLTextAreaElement>("#pg-netlist").value = netlist;
  clearTimeout(drawTimer);
  drawTimer = setTimeout(() => {
    compile();
    save();
  }, 120);
}

/**
 * Switches between the text and the drawing. Entering the drawing redraws the
 * netlist with the automatic layout when it changed since the last drawing.
 */
function setMode(mode: State["mode"], redraw = false): void {
  if (mode === "draw" && blocks && (redraw || drawnNetlist !== state.netlist)) {
    const hasElements = state.netlist
      .split(/\r?\n/)
      .some((l) => l.trim() !== "" && !/^[*.;]/.test(l.trim()));
    let drawing: Drawing;
    try {
      drawing = hasElements ? fromCircuit(new ElecMap(state.netlist)) : emptyDrawing();
    } catch {
      toast(t.editor.importFailed);
      return;
    }
    state.mode = mode;
    applyMode();
    blocks.load(drawing);
    $<HTMLTextAreaElement>("#pg-directives").value = drawing.directives;
    drawingChanged(blocks.netlist());
    return;
  }
  state.mode = mode;
  applyMode();
  if (mode === "draw") blocks?.setCircuit(circuit);
  save();
}

function applyMode(): void {
  const draw = state.mode === "draw";
  $("#pg-editor").hidden = !draw;
  $("#pg-schematic").hidden = draw;
  $("#pg-directives-box").hidden = !draw;
  $("#pg-stage-hint").textContent = draw ? t.zoomHint : `${t.schematicHint} ${t.zoomHint}`;
  $("#pg-netlist-hint").textContent = draw ? t.editor.generated : t.netlistHint;
  $<HTMLTextAreaElement>("#pg-netlist").readOnly = draw;
  document.querySelector(".pg-main")?.classList.toggle("pg-drawing", draw);
  if (draw && editorView && !editorView.manual) fitView();
  zoomLabel();
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    b.classList.toggle("on", b.dataset["mode"] === state.mode);
    b.setAttribute("aria-pressed", String(b.dataset["mode"] === state.mode));
  }
  // Boxes of a view that was hidden could not be measured.
  highlight();
}

function wire(): void {
  const editor = $<HTMLTextAreaElement>("#pg-netlist");
  editor.value = state.netlist;
  let timer: ReturnType<typeof setTimeout> | undefined;
  editor.addEventListener("input", () => {
    state.netlist = editor.value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      // A new circuit gets a new default duration.
      compile();
      save();
    }, 350);
  });
  editor.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      clearTimeout(timer);
      compile();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      editor.setRangeText("  ", editor.selectionStart, editor.selectionEnd, "end");
      editor.dispatchEvent(new Event("input"));
    }
  });

  $<HTMLSelectElement>("#pg-example").addEventListener("change", (e) => {
    const select = e.target as HTMLSelectElement;
    loadExample(select.value);
    select.value = "";
  });
  $<HTMLSelectElement>("#pg-style").addEventListener("change", (e) => {
    state.style = (e.target as HTMLSelectElement).value as State["style"];
    drawSchematic();
    blocks?.palette();
    blocks?.render();
  });
  $<HTMLSelectElement>("#pg-theme").addEventListener("change", (e) => {
    try {
      localStorage.setItem("tsd-theme", (e.target as HTMLSelectElement).value);
    } catch {
      /* storage blocked */
    }
    applyTheme();
  });
  $("#pg-share").addEventListener("click", () => {
    const url = shareUrl();
    history.replaceState(null, "", url);
    navigator.clipboard?.writeText(url).then(
      () => toast(t.copied),
      () => toast(url),
    );
  });
  $("#pg-lang").addEventListener("click", (e) => {
    // Keep the circuit when switching language.
    e.preventDefault();
    const other = lang === "fr" ? "en" : "fr";
    location.href = shareUrl()
      .replace(/\?[^#]*/, "")
      .replace("#", `?lang=${other}#`);
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-download]")) {
    b.addEventListener("click", () => download(b.dataset["download"] ?? ""));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    b.addEventListener("click", () => {
      state.tab = b.dataset["tab"] as Tab;
      showView("analysis");
    });
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    b.addEventListener("click", () => showView("netlist"));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-panel]")) {
    b.addEventListener("click", () => {
      setCollapsed(b.dataset["panel"] === "hide");
      renderPanel();
    });
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-zoom]")) {
    b.addEventListener("click", () => zoom(b.dataset["zoom"] ?? ""));
  }
  const menu = $<HTMLDetailsElement>("#pg-download");
  menu.addEventListener("click", (e) => {
    if ((e.target as Element).closest("[data-download]")) menu.open = false;
  });
  document.addEventListener("pointerdown", (e) => {
    if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
  });
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      menu.open = false;
      menu.querySelector("summary")?.focus();
    }
  });
  schematicView = new Viewport($("#pg-schematic"), {
    panWithPrimary: true,
    onZoom: (s) => sizeSchematic(s),
  });
  splitter();
  $("#pg-schematic").addEventListener("click", onSchematicClick);
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    b.addEventListener("click", () => setMode(b.dataset["mode"] as State["mode"]));
  }
  blocks = new Editor($("#pg-editor"), {
    t,
    style: () => state.style,
    changed: drawingChanged,
    probe,
    decorate,
  });
  const drawn = blocks;
  editorView = new Viewport(drawn.viewport, {
    onZoom: (s) => {
      drawn.setZoom(s);
      zoomLabel();
    },
  });
  const directives = $<HTMLTextAreaElement>("#pg-directives");
  directives.addEventListener("change", () => blocks?.setDirectives(directives.value));

  const panel = $("#pg-panel");
  panel.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const key = el.dataset["bind"];
    if (key) {
      (state as unknown as Record<string, string>)[key] = el.value;
      renderPanel();
      return;
    }
    const list = el.dataset["list"];
    if (list === "traces" || list === "currents") {
      toggle(state[list], el.value);
      renderPanel();
    }
  });
  panel.addEventListener("keydown", (e) => {
    const el = e.target as HTMLElement;
    if (e.key === "Enter" && el.tagName === "INPUT") (el as HTMLInputElement).blur();
  });
  panel.addEventListener("click", (e) => {
    if ((e.target as Element).closest("[data-mc]")) {
      state.mc = !state.mc;
      renderPanel();
      return;
    }
    const b = (e.target as Element).closest<HTMLButtonElement>("[data-literal]");
    if (b) {
      state.literal = b.dataset["literal"] === "1";
      renderPanel();
    }
  });
  panel.addEventListener("mouseover", (e) => {
    const row = (e.target as Element).closest<HTMLElement>("tr[data-id], tr[data-node]");
    const svg = document.querySelector("#pg-schematic svg");
    if (!svg) return;
    svg.querySelectorAll(".hover").forEach((el) => el.classList.remove("hover"));
    if (!row) return;
    const sel = row.dataset["id"]
      ? `g[data-id="${CSS.escape(row.dataset["id"])}"]`
      : `[data-node="${CSS.escape(row.dataset["node"] ?? "")}"]`;
    svg.querySelectorAll(sel).forEach((el) => el.classList.add("hover"));
  });
  panel.addEventListener("mousemove", onPlotMove);
  panel.addEventListener("mouseleave", onPlotLeave, true);
  window.addEventListener("hashchange", () => {
    if (readHash()) {
      editor.value = state.netlist;
      renderTabs();
      startMode();
    }
  });
  window.addEventListener("storage", (e) => {
    if (e.key === "tsd-theme") applyTheme();
  });
}

// ------------------------------------------------------------------ start

/** Shows the drawing read from a link or the storage, or the text. */
function startMode(): void {
  const drawing = pendingDrawing;
  pendingDrawing = undefined;
  const draw = blocks;
  if (state.mode === "draw" && drawing && draw) {
    draw.load({ ...emptyDrawing(), ...drawing });
    $<HTMLTextAreaElement>("#pg-directives").value = draw.drawing.directives;
    drawnNetlist = draw.netlist();
    // The drawing is the source: its netlist replaces the text.
    state.netlist = drawnNetlist;
    $<HTMLTextAreaElement>("#pg-netlist").value = drawnNetlist;
    applyMode();
  } else if (state.mode === "draw") {
    setMode("draw", true);
    return;
  } else applyMode();
  compile();
}

shell();
restorePanel();
if (readHash()) view = "analysis";
else {
  try {
    const saved = localStorage.getItem("elecmap-playground");
    if (saved) {
      state.netlist = saved;
      state.output = "";
      state.traces = [];
      state.tStop = "";
    }
    const drawn = JSON.parse(localStorage.getItem("elecmap-playground-drawing") ?? "null") as {
      mode?: State["mode"];
      drawing?: Drawing;
    } | null;
    if (drawn?.mode === "draw" && drawn.drawing) {
      state.mode = "draw";
      pendingDrawing = drawn.drawing;
    }
  } catch {
    /* storage blocked */
  }
}
wire();
renderTabs();
startMode();
