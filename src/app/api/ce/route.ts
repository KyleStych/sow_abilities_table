import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const BRIDGE_DIR = "C:\\Temp\\sow_bridge";
const TIMEOUT_MS = 8000;
const POLL_MS = 25;

type BridgeEnvelope = {
  status: number;
  body: unknown;
};

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendToCeFileBridge(
  method: string,
  routePath: string,
  rawBody: string | null,
): Promise<BridgeEnvelope> {
  await fs.mkdir(BRIDGE_DIR, { recursive: true });

  const reqId = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const tmpFile = path.join(BRIDGE_DIR, `req_${reqId}.tmp`);
  const reqFile = path.join(BRIDGE_DIR, `req_${reqId}.json`);
  const resFile = path.join(BRIDGE_DIR, `res_${reqId}.json`);

  const payload = JSON.stringify({
    method,
    path: routePath,
    body: rawBody && rawBody.length > 0 ? rawBody : null,
  });

  // Atomic write (.tmp -> .json) so CE never reads a partial file
  await fs.writeFile(tmpFile, payload, "utf8");
  await fs.rename(tmpFile, reqFile);

  const deadline = Date.now() + TIMEOUT_MS;

  try {
    while (Date.now() < deadline) {
      try {
        const rawRes = await fs.readFile(resFile, "utf8");
        await fs.unlink(resFile).catch(() => {});
        return JSON.parse(rawRes) as BridgeEnvelope;
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") {
          // File may still be flushing; wait one tick and retry
        }
      }
      await sleep(POLL_MS);
    }

    throw new Error("Timed out waiting for Cheat Engine file bridge");
  } finally {
    // Clean up orphaned request/response files on timeout or error
    await fs.unlink(tmpFile).catch(() => {});
    await fs.unlink(reqFile).catch(() => {});
    await fs.unlink(resFile).catch(() => {});
  }
}

async function proxy(req: NextRequest, pathParts: string[]) {
  const routePath = "/" + pathParts.join("/");

  try {
    const rawBody =
      req.method !== "GET" && req.method !== "HEAD" ? await req.text() : null;

    const envelope = await sendToCeFileBridge(req.method, routePath, rawBody);
    const bodyText =
      typeof envelope.body === "string"
        ? envelope.body
        : JSON.stringify(envelope.body ?? {});

    return new NextResponse(bodyText, {
      status: envelope.status || 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to reach CE file bridge";
    return NextResponse.json(
      {
        error: `Cannot reach Cheat Engine file bridge at ${BRIDGE_DIR} (${message}). Is ce_bridge.lua running?`,
      },
      { status: 502 },
    );
  }
}

type RouteCtx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const { path: pathParts } = await ctx.params;
  return proxy(req, pathParts);
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { path: pathParts } = await ctx.params;
  return proxy(req, pathParts);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}