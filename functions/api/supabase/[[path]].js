const SUPABASE_ORIGIN = "https://cwjcljzraxkclowrcizx.supabase.co";

export async function onRequest(context) {
  const incoming = new URL(context.request.url);
  const pathValue = context.params.path || "";
  const path = Array.isArray(pathValue) ? pathValue.join("/") : pathValue;
  const target = new URL(`${SUPABASE_ORIGIN}/${path}`);
  target.search = incoming.search;

  const headers = new Headers(context.request.headers);
  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");

  const upstream = await fetch(target, {
    method: context.request.method,
    headers,
    body: context.request.method === "GET" || context.request.method === "HEAD" ? undefined : context.request.body
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("access-control-allow-origin");
  responseHeaders.delete("access-control-allow-credentials");
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}