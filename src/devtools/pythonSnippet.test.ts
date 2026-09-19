import {describe, expect, it} from "vitest";

import type {WireLogEntry} from "@/store/wireSlice";

import {pythonSnippet} from "./pythonSnippet";

const frame = (direction: WireLogEntry["direction"]): WireLogEntry => ({
    seq: 1,
    direction,
    at: 0,
    requestId: "7",
    kind: "hello",
    terminal: direction === "in",
    json: {requestId: "7", hello: {}}
});

describe("the Python snippet", () => {
    it("dials the service this page is connected to", () => {
        // It used to dial ws://127.0.0.1:9111 whatever the page was using.
        const snippet = pythonSnippet(frame("out"), "wss://pricing.example/ws/")!;
        expect(snippet).toContain('"wss://pricing.example/ws/"');
        expect(snippet).not.toContain("127.0.0.1:9111");
    });

    it("carries a token from the environment, and never writes one into the snippet", () => {
        const snippet = pythonSnippet(frame("out"), "ws://127.0.0.1:9111")!;
        expect(snippet).toContain('os.environ.get("QL_TOKEN"');
        expect(snippet).toContain('"Authorization"');
    });

    it("is offered for a frame this page sent, and not for one it received", () => {
        // Sending a ServerFrame to the service reproduces nothing.
        expect(pythonSnippet(frame("in"), "ws://127.0.0.1:9111")).toBeNull();
    });
});
