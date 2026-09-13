/** Where the service is when nothing says otherwise: the loopback port that
 *  `ql-backend --port 9111` listens on. */
export const DEFAULT_SOCKET_URL = "ws://127.0.0.1:9111";

/** The service's WebSocket address, as this page should dial it.
 *
 *  VITE_WS_URL is fixed when the bundle is built, and a bundle served from a
 *  container cannot know which host or port it will be reached on. So a path
 *  such as `/ws/` means the host that served the page, over wss: when the page
 *  came over https: and ws: otherwise; a full ws:// URL is used as it is.
 *  Without a page to resolve against — under Node, in the unit tests — a path
 *  is returned unchanged.
 */
export function resolveSocketUrl(configured: string | undefined, page: Pick<Location, "protocol" | "host"> | undefined = globalThis.location): string {
    const url = configured || DEFAULT_SOCKET_URL;
    if (!url.startsWith("/") || !page) return url;
    return `${page.protocol === "https:" ? "wss:" : "ws:"}//${page.host}${url}`;
}
