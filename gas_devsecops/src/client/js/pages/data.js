import { renderStub } from "./_stub.js";

/** The stored record and what can be taken out of it. */
export function renderData(host) {
  renderStub(host, {
    lane: "Данные",
    title: "Данные",
    lede: "Хранилище реестра: что занято, что можно выгрузить, что можно сбросить.",
    sections: [
      "Выгрузка реестра и производных таблиц в CSV.",
      "Занятое место: ячейки листа, архивы в Drive, запас до предела.",
      "Сброс и повторная сборка ledger из архива.",
    ],
  });
}
