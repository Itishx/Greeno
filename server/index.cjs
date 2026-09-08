// Local dev. One long-lived process, a real JSON file, and the Vite dev server
// proxying /api to it. The app itself lives in app.cjs and is shared with the
// serverless entry point in api/index.js.
const app = require("./app.cjs");

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[greeno-web] api on http://127.0.0.1:${PORT}  (data: ${app.LOCAL_DIR})`);
  if (!process.env.OPENAI_API_KEY) console.warn("[greeno-web] no OPENAI_API_KEY, the summarizer will not run");
});
