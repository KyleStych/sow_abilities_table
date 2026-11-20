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
      const log = res.status === 404 ? console.warn : console.error;
      log(`[ce-bridge] ${init?.method || "GET"} ${path} → ${res.status}`, {
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

export async function getMarkerCatalog() {
  return ceFetch<CeCatalogResponse>("/marker-catalog");
}

export async function getMarkersFromGame() {
  return ceFetch<CeTraitsResponse>("/markers");
}

export async function postMarkersToGame(
  traits: Array<{ address?: string; name?: string } | null>,
) {
  console.info("[ce-bridge] POST /markers", { count: traits.length, traits });
  return ceFetch<CeTraitsResponse>("/markers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ traits }),
  });
}

export type AppearancePointer = {
  name: string | null;
  address: string;
};

export type AppearanceFieldValue = AppearancePointer & {
  id: string;
  error?: string;
};

export type AppearanceListValue = {
  capacity: number;
  items: AppearancePointer[];
  error?: string;
};

export type AppearanceColorValue = {
  id: string;
  label: string;
  offset: string;
  argb: string;
  error?: string;
};

export type AppearanceResponse = {
  orc: string;
  rarity: string;
  rarityError?: string;
  fields: AppearanceFieldValue[];
  tags: AppearanceListValue;
  wounds: AppearanceListValue;
  colors: AppearanceColorValue[];
  error?: string;
};

export type AppearanceCatalogResponse = {
  lists: Record<string, CeCatalogTrait[]>;
  missing?: string[];
  error?: string;
};

export type AppearanceWriteBody = {
  rarity: string;
  fields: AppearanceFieldValue[];
  tags: AppearancePointer[];
  wounds: AppearancePointer[];
  colors: Array<{ id: string; argb: string }>;
};

export async function getAppearance() {
  return ceFetch<AppearanceResponse>("/appearance");
}

export async function getAppearanceCatalog() {
  return ceFetch<AppearanceCatalogResponse>("/appearance-catalog");
}

export async function postAppearance(body: AppearanceWriteBody) {
  console.info("[ce-bridge] POST /appearance", {
    fields: body.fields.length,
    tags: body.tags.length,
    wounds: body.wounds.length,
    colors: body.colors.length,
  });
  return ceFetch<AppearanceResponse>("/appearance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
