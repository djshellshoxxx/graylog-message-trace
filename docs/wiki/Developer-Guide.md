# Developer Guide

Use Node.js 22 or later from the repository root.

```sh
npm test
npm run serve
```

Open <http://127.0.0.1:8080> to view the bundled example or import a trace. Set `GRAYLOG_URL` and credentials in the server environment to enable read-only live lookup. The viewer limits imported files to 5 MiB.

Run `node tools/graylog-trace.mjs --help` for the viewer and fetch commands. To build the standalone executable, run `npm ci` followed by `npm run build`. The test workflow is in `.github/workflows/test.yml`.
