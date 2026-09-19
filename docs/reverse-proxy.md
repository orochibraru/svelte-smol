# Reverse Proxy

Behind a proxy, the server sees the proxy's connection, not the browser's. Tell
it where the real URL and client address come from.

## Request URL

SvelteKit needs the public URL for `url.origin`, redirects and its CSRF check on
form actions. Pick one:

- **`ORIGIN`** — simplest when the app lives at a single public URL:

  ```ini
  ORIGIN=https://my.site
  ```

- **Forwarded headers** — when the app answers on several hosts:

  ```ini
  PROTOCOL_HEADER=x-forwarded-proto
  HOST_HEADER=x-forwarded-host
  ```

With neither set, the protocol defaults to `https` and the host comes from the
`Host` header.

Remote function calls (`/_app/remote/…`) are the exception: when the browser's
`Origin` matches the request's host, that origin is used as-is, so they pass
SvelteKit's CSRF check even when `ORIGIN` points elsewhere.

## Client address

`event.getClientAddress()` returns the socket address by default. Behind a
proxy, read it from a header instead:

```ini
ADDRESS_HEADER=x-forwarded-for
XFF_DEPTH=1
```

`XFF_DEPTH` is the number of trusted proxies in front of the app: the address is
taken that many entries from the **right** of `X-Forwarded-For`, so a client
can't spoof it by sending its own header. With `ADDRESS_HEADER` set, a request
missing that header throws — only set it when every request goes through the
proxy.

## Unix socket

Proxies on the same host can skip TCP:

```ini
SOCKET_PATH=/run/app.sock
```

```nginx
location / {
  proxy_pass http://unix:/run/app.sock;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

## WebSockets and SSE

Both work through the proxy as long as it forwards `Upgrade` / keeps long-lived
responses open. The server itself disables its idle timeout for
`text/event-stream` responses.
