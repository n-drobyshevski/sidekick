// Interactive and labelled chrome: status pills and the KPI tile.

import { el } from "./dom.js";

export function statusPill(kind, text) {
  return el("span", { class: `pill ${kind}` }, text);
}

export function kpiCard(label, value, sub, chip) {
  return el(
    "div",
    { class: "kpi-card" },
    el("div", { class: "kpi-label" }, label),
    el("div", { class: "kpi-value num" }, value, chip || null),
    sub ? el("div", { class: "kpi-sub" }, sub) : null,
  );
}
