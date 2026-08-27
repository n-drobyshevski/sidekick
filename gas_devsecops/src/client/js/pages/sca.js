import { renderStub } from "./_stub.js";

/** Third-party dependencies: a CVE in a package at a version. */
export function renderSca(host) {
  renderStub(host, {
    lane: "Реестры",
    title: "Зависимости",
    lede: "Известные уязвимости в сторонних пакетах — и есть ли вообще, на что их менять.",
    sections: [
      "Реестр: CVE, пакет и версия, исправленная версия, экосистема.",
      "Доступность исправления: сколько строк ждут вендора, а не команду.",
      "Сигналы эксплуатации — KEV, наличие эксплойта, EPSS — в три состояния: измерено, не измерено, неприменимо.",
      "Разрез по языкам и по репозиториям.",
    ],
    note: "Отсутствие — не ноль: примерно в каждой восьмой строке выборки hasExploit, "
      + "hasCisaKevExploit и epssProbability приходят как null, и схлопывать это в false нельзя.",
  });
}
