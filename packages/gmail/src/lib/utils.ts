import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomId(): string {
  return randomUUID();
}

export function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function toArray(value?: string | string[]): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Array.isArray(value) ? value : [value];
}

export function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4 || 4)) % 4;
  return Buffer.from(`${normalized}${"=".repeat(padding)}`, "base64").toString("utf8");
}

export function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxBytes) {
    return value;
  }

  let out = value;
  while (Buffer.byteLength(out, "utf8") > maxBytes && out.length > 0) {
    out = out.slice(0, -1);
  }

  return out;
}

export function joinAddressList(value?: string | string[]): string | undefined {
  const list = toArray(value);
  if (!list?.length) {
    return undefined;
  }

  return list.join(", ");
}

export function encodeQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }
    search.set(key, String(value));
  }

  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}

export async function openBrowser(url: string): Promise<boolean> {
  const platform = process.platform;
  const command =
    platform === "win32"
      ? { cmd: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }
      : platform === "darwin"
        ? { cmd: "open", args: [url] }
        : { cmd: "xdg-open", args: [url] };

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command.cmd, command.args, {
        detached: true,
        stdio: "ignore"
      });

      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });

    return true;
  } catch {
    return false;
  }
}

export function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}
