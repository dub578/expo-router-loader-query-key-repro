# expo-router: SSR loader data missed when the query string is re-serialized

With `web.output: "server"`, a route `loader` renders on the server for `/en` and `/en?page=2`,
but for queries like `?a=b,c`, `?locale=fr` or `?a=1&b=2&a=3` the server HTML has an **empty
page body**. The browser then reports a Suspense/SSR error, fetches the loader data and renders
on the client.

The app is `npx create-expo-app@latest --template blank` reduced to one route,
[`app/[locale]/index.tsx`](app/%5Blocale%5D/index.tsx):

```tsx
export async function loader() {
  return { message: "LOADER DATA RENDERED" };
}

export default function Page() {
  const data = useLoaderData<typeof loader>();
  return <Text>{data.message}</Text>;
}
```

[`server.js`](server.js) is a small Node `http` server around `expo-server/adapter/http`: it serves
`dist/client` as static files and everything else through `createRequestHandler`.

## Environment

- Platform: web
- Package manager: npm
- `expo` 58.0.16, `expo-router` 58.0.24, `@expo/router-server` 58.0.15, `expo-server` 58.0.5,
  `@expo/cli` 58.1.13, `react` / `react-dom` 19.3.0, `react-native-web` 0.21.4
- Node 24.18.1, npm 11.16.0, macOS 27.0, Chrome (Playwright Chromium)
- Reproduces on a production server export (`expo export --platform web` served by `expo-server`)
  and on the dev server (`expo start`).

## Steps to reproduce

### Production server export

```sh
npm install
npx expo export --platform web --clear
node server.js            # http://localhost:3000
```

`--clear` matters: a stale Metro cache once produced an export with no loader bundle at all,
which makes every URL (even `/en`) render empty and hides this bug.

Check the server HTML for the rendered loader text (`1` = rendered, `0` = empty body):

```sh
curl -s 'http://localhost:3000/en?page=2' | grep -c '>LOADER DATA RENDERED</div>'   # 1
curl -s 'http://localhost:3000/en?a=b,c'  | grep -c '>LOADER DATA RENDERED</div>'   # 0
```

Show the empty body itself:

```sh
curl -s 'http://localhost:3000/en?a=b,c' | grep -o '<div id="root">.*</div><script'
# ... <!--$!--><template></template><!--/$--> ...   (errored Suspense boundary, no text)
```

Then open each URL in Chrome with the console open.

| URL | Expected | Actual |
| --- | --- | --- |
| `/en` | body renders loader data, no console error | as expected |
| `/en?page=2` | same | as expected |
| `/en?a=b,c` | same | empty body, React #419, client render |
| `/en?a=b%20c` | same | empty body, React #419, client render |
| `/en?foo=a@b.example` | same | empty body, React #419, client render |
| `/en?a=x:y` | same | empty body, React #419, client render |
| `/en?locale=fr` (key named like the route param) | same | empty body, React #419, client render |
| `/en?a=1&b=2&a=3` (repeated key) | same | empty body, React #419, client render |
| `/en?2=x&1=y` (integer-like keys) | same | empty body, React #419, client render |

On every failing URL:

- The server logs `SSR streaming render error: TypeError: Cannot read properties of undefined (reading 'message')`:
  `useLoaderData()` returned `undefined` during the server render.
- The HTML body holds an errored Suspense boundary (`<!--$!--><template></template><!--/$-->`)
  where the text should be.
- The loader data **is** in the document, keyed by the raw request query, for example
  `"/en/index?a=b,c"`, `"/en/index?locale=fr"`, `"/en/index?a=1&b=2&a=3"`, `"/en/index?2=x&1=y"`
  in `globalThis.__EXPO_ROUTER_LOADER_DATA__`.
- The browser logs minified React error #419 (server could not finish a Suspense boundary,
  switched to client rendering), fetches the loader data and renders the text.

First paint and non-JS clients (crawlers, link previews) get the empty body.

### Dev server

```sh
npx expo start --web --port 8081
```

Same URLs on `http://localhost:8081`: `/en` and `/en?page=2` render the body; the other seven
render an empty body, the terminal logs the same `SSR streaming render error`, and the browser
throws `Switched to client rendering because the server rendering errored: Cannot read properties of undefined (reading 'message')`.

## What seems to be happening

`@expo/router-server` (`renderStreamingContent` / `renderStaticContent`) stores loader data under
`loader.key + location.search`, the raw request query. `useLoaderData` (expo-router
`resolveLoaderPath`) reads it under `routeInfo.searchParams.toString()`, whose search params come
from `serializeQueryAndHash`. That string differs from the raw query when `URLSearchParams`
re-encodes a value (`,` `@` `:` space), when a query key matches a route param name and is dropped
(`locale`), when repeated keys are grouped, or when integer-like keys are reordered. When the two
strings differ, the server render misses its own loader data.
