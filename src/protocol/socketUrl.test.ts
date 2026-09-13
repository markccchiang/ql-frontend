import {describe, expect, it} from "vitest";

import {DEFAULT_SOCKET_URL, resolveSocketUrl} from "./socketUrl";

describe("resolveSocketUrl", () => {
    const page = {protocol: "http:", host: "localhost:8080"};

    it("falls back to the loopback service when nothing is configured", () => {
        expect(resolveSocketUrl(undefined, page)).toBe(DEFAULT_SOCKET_URL);
        expect(resolveSocketUrl("", page)).toBe(DEFAULT_SOCKET_URL);
    });

    it("uses a full URL as it is", () => {
        expect(resolveSocketUrl("ws://10.0.0.5:9111", page)).toBe("ws://10.0.0.5:9111");
        expect(resolveSocketUrl("wss://pricing.example/ws/", page)).toBe("wss://pricing.example/ws/");
    });

    it("dials a path on the host that served the page", () => {
        expect(resolveSocketUrl("/ws/", page)).toBe("ws://localhost:8080/ws/");
        expect(resolveSocketUrl("/ws/", {protocol: "https:", host: "pricing.example"})).toBe("wss://pricing.example/ws/");
    });

    it("leaves a path alone when there is no page to resolve it against", () => {
        expect(resolveSocketUrl("/ws/", undefined)).toBe("/ws/");
    });
});
