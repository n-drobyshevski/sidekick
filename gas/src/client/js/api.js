// Promisified google.script.run wrapper. Every server endpoint returns
// {ok, data|error}; failures surface as rejected promises with the server message.

export function call(name, params) {
  return new Promise((resolve, reject) => {
    if (typeof google === "undefined" || !google.script || !google.script.run) {
      reject(new Error("google.script.run unavailable (open via the web app URL)"));
      return;
    }
    const t0 = performance.now();
    const done = () => {
      console.debug("[rpc] " + name + " " + Math.round(performance.now() - t0) + "ms");
    };
    google.script.run
      .withSuccessHandler((res) => {
        done();
        if (res && res.ok) resolve(res.data);
        // `contact`/`contactUrl` ride along for the forbidden envelope only (access.ts), so the
        // no-access card can offer the same "contact X" mailto the denied page does without
        // the address being baked into the message — which doubles as the Stackdriver line.
        else reject(Object.assign(new Error((res && res.error) || "Unknown server error"),
          { kind: res && res.errorKind, contact: res && res.contact,
            contactUrl: res && res.contactUrl }));
      })
      .withFailureHandler((err) => {
        done();
        reject(err instanceof Error ? err : new Error(String(err)));
      })
      [name](params || {});
  });
}
