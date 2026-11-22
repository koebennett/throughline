import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startServer, type RunningServer } from "../../src/server/server.js";
import { loadConfig } from "../../src/server/config.js";
import { createMcpServer, resolveBaseUrl } from "../../src/mcp/server.js";
import { PROFILE } from "../helpers/setup.js";

let srv: RunningServer;
let client: Client;
const text = (r: any) => JSON.parse(r.content[0].text);

beforeAll(async () => {
  srv = await startServer({ ...loadConfig({ CSA_DB_PATH: ":memory:" } as any), port: 0, anthropicApiKey: undefined }, { clientDir: "/nonexistent" });
  await fetch(`${srv.url}/api/brands`, { method: "POST", headers: { "content-type": "application/json", "x-throughline": "1" }, body: JSON.stringify(PROFILE) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(srv.url).connect(a);
  client = new Client({ name: "test", version: "1" });
  await client.connect(b);
});
afterAll(async () => {
  await client.close();
  await srv.close();
});

describe("MCP server", () => {
  it("exposes safe tools only — no approve, publish or delete", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_brands", "command_center", "search_brand_docs", "run_task", "add_evidence", "add_idea", "get_content"]));
    expect(names.filter((n) => /approv|publish|delete|decide/.test(n))).toEqual([]);
  });

  it("reads brands and enforces evidence honesty through the API", async () => {
    const brands = text(await client.callTool({ name: "list_brands", arguments: {} }));
    expect(brands[0].name).toBe("Test Brand");
    const ev = text(await client.callTool({ name: "add_evidence", arguments: { brandId: brands[0].id, claim: "Most freelancers under-save for tax", kind: "fact" } }));
    expect(ev.kind).toBe("inference");
  });

  it("runs agent tasks and stops at approval gates it cannot approve", async () => {
    const brandId = text(await client.callTool({ name: "list_brands", arguments: {} }))[0].id;
    const r = text(await client.callTool({ name: "run_task", arguments: { brandId, task: "build_strategy", input: {}, waitSeconds: 30 } }));
    expect(r.status).toBe("awaiting_approval");
    expect(r.note).toMatch(/approval/);
    const ask = text(await client.callTool({ name: "run_task", arguments: { brandId, task: "ask", input: { question: "What should I do next?" }, waitSeconds: 30 } }));
    expect(ask.status).toBe("succeeded");
  });

  it("refuses non-loopback targets and reports a helpful error when the app is down", async () => {
    expect(() => createMcpServer("http://example.com")).toThrow(/loopback/);
    expect(resolveBaseUrl({ THROUGHLINE_URL: "http://127.0.0.1:9999/" } as any)).toBe("http://127.0.0.1:9999");
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer("http://127.0.0.1:1").connect(a);
    const c = new Client({ name: "t", version: "1" });
    await c.connect(b);
    const r: any = await c.callTool({ name: "list_brands", arguments: {} });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Is the Throughline app running/);
    await c.close();
  });
});
