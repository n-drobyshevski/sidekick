// Promisified google.script.run wrapper. Every server endpoint returns
// {ok, data|error}; failures surface as rejected promises with the server message.

export function call(name, params) {
  return new Promise((resolve, reject) => {
    if (typeof google === "undefined" || !google.script || !google.script.run) {
      reject(new Error("google.script.run unavailable (open via the web app URL)"));
      return;
    }
    google.script.run
      .withSuccessHandler((res) => {
        if (res && res.ok) resolve(res.data);
        else reject(Object.assign(new Error((res && res.error) || "Unknown server error"),
          { kind: res && res.errorKind }));
      })
      .withFailureHandler((err) => reject(err instanceof Error ? err : new Error(String(err))))
      [name](params || {});
  });
}
