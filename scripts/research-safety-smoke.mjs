import {
  MAX_PAGE_BYTES,
  PageRetrievalError,
  assertSafePublicUrl,
  retrievePublicPage,
} from "../src/lib/research/retrieval.ts";

async function expectCode(action, expectedCode) {
  try {
    await action();
  } catch (error) {
    if (error instanceof PageRetrievalError && error.code === expectedCode) return;
    throw new Error(`Expected retrieval error ${expectedCode}.`);
  }
  throw new Error(`Expected retrieval error ${expectedCode}.`);
}

await expectCode(
  () => assertSafePublicUrl("http://127.0.0.1:8080/health", async () => ["127.0.0.1"]),
  "blocked-host",
);

const publicUrl = await assertSafePublicUrl("https://docs.example.test/guide", async () => ["93.184.216.34"]);
if (publicUrl.hostname !== "docs.example.test") throw new Error("Public URL validation changed the hostname.");

await expectCode(
  () => retrievePublicPage("https://docs.example.test/start", {
    resolveHost: async (hostname) => hostname === "docs.example.test" ? ["93.184.216.34"] : ["127.0.0.1"],
    fetcher: async () => new Response("", { status: 302, headers: { location: "http://127.0.0.1/private" } }),
  }),
  "blocked-host",
);

await expectCode(
  () => retrievePublicPage("https://docs.example.test/large", {
    resolveHost: async () => ["93.184.216.34"],
    fetcher: async () => new Response("", { status: 200, headers: { "content-type": "text/plain", "content-length": String(MAX_PAGE_BYTES + 1) } }),
  }),
  "too-large",
);

const page = await retrievePublicPage("https://docs.example.test/guide", {
  resolveHost: async () => ["93.184.216.34"],
  fetcher: async () => new Response("<html><title>Docs</title><script>ignore this</script><p>Hello &amp; world.</p></html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  }),
});
if (page.title !== "Docs" || page.text !== "Docs Hello & world.") throw new Error("Readable page extraction check failed.");

console.log("Research safety smoke checks passed.");
