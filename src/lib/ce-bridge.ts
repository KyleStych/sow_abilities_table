/** Browser calls same-origin Next proxy; Next talks to CE via C:\\Temp\\sow_bridge. */
export const CE_BRIDGE_BASE = "/api/ce";

export type CeCatalogTrait = {
  name: string;
  address: string;
};

export type CeTraitSlot = {
  index: number;
  name: string | null;
  address: string;
};

export type CeHealth = {
  ok: boolean;
  error?: string;
  p_uruk: string | null;
  count: number;
  max_length?: number;
};

export type CeTraitsResponse = {
  orc: string;
  count: number;
  max_length: number;
  traits: CeTraitSlot[];
  error?: string;
};

export type CeCatalogResponse = {
  traits: CeCatalogTrait[];
  error?: string;
};

async function ceFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data?: T; error: string | null; status: number }> {
  try {
    const res = await fetch(`${CE_BRIDGE_BASE}${path}`, {
      ...init,
      cache: "no-store",
    });
    const text = await res.text();
    let data: T | undefined;
    try {
      data = text ? (JSON.parse(text) as T) : undefined;
    } catch {
      return {
        error: `Invalid JSON from CE bridge (${res.status})`,
        status: res.status,
      };
    }
    if (!res.ok) {
      const errMsg =
        data &&
        typeof data === "object" &&
        "error" in data &&
        typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : `CE bridge HTTP ${res.status}`;
      console.error(`[ce-bridge] ${init?.method || "GET"} ${path} → ${res.status}`, {
        error: errMsg,
        data,
        requestBody: init?.body,
      });
      return { data, error: errMsg, status: res.status };
    }
    return { data, error: null, status: res.status };
  } catch (err) {
    console.error(`[ce-bridge] ${init?.method || "GET"} ${path} network failure`, err);
    return {
      error:
        "Cannot reach Cheat Engine file bridge (C:\\Temp\\sow_bridge). Is ce_bridge.lua running?",
      status: 0,
    };
  }
}

export async function getHealth() {
  return ceFetch<CeHealth>("/health");
}

export async function getCatalog() {
  return ceFetch<CeCatalogResponse>("/catalog");
}

export async function getTraitsFromGame() {
  return ceFetch<CeTraitsResponse>("/traits");
}

export async function postTraitsToGame(
  traits: Array<{ address?: string; name?: string } | null>,
) {
  console.info("[ce-bridge] POST /traits", { count: traits.length, traits });
  return ceFetch<CeTraitsResponse>("/traits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ traits }),
  });
}
