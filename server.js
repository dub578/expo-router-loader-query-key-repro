// Production server for `expo export --platform web` output (web.output: "server").
// Serves dist/client as static files and everything else through expo-server.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { createRequestHandler } = require("expo-server/adapter/http");

const CLIENT = path.join(__dirname, "dist/client");
const handler = createRequestHandler({ build: path.join(__dirname, "dist/server") });
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".ico": "image/x-icon" };

http
  .createServer((req, res) => {
    const file = path.join(CLIENT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (file.startsWith(CLIENT + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
      return;
    }
    handler(req, res, (err) => {
      res.statusCode = 500;
      res.end(String(err));
    });
  })
  .listen(process.env.PORT ?? 3000, () => console.log(`http://localhost:${process.env.PORT ?? 3000}`));
