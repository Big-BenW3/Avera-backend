/**
 * Avera API module: src/lib/sanitize.ts
 * Strict server-side input sanitisation: strip HTML, normalize text, guard URLs/files.
 */

const TAG_RE = /<[^>]*>/g;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function stripHtml(value: string): string {
  return value.replace(TAG_RE, "");
}

/** Trim, strip HTML tags, collapse whitespace, remove control chars. */
export function cleanText(value: string, maxLength?: number): string {
  let out = stripHtml(value).replace(CONTROL_RE, "");
  out = out.replace(/[ \t]+\n/g, "\n").trim();
  if (typeof maxLength === "number" && out.length > maxLength) out = out.slice(0, maxLength);
  return out;
}

/** Clean each string in an array, drop empties. */
export function cleanStringArray(values: string[], maxItems: number, maxEach: number): string[] {
  return values
    .map((v) => cleanText(v, maxEach))
    .filter((v) => v.length > 0)
    .slice(0, maxItems);
}

/** Escape LIKE wildcards so % _ \ are matched literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Build a safe ILIKE pattern with escaped wildcards. */
export function likePattern(raw: string, maxLength = 120): string {
  const trimmed = raw.trim().slice(0, maxLength);
  return `%${escapeLike(trimmed)}%`;
}

/** Only allow http(s) URLs; reject javascript:/data:/etc. */
export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Prefer HTTPS; still allow http for local dev. */
export function isSafeExternalUrl(value: string | null | undefined): boolean {
  if (value == null) return true;
  return isSafeHttpUrl(value);
}

const ALLOWED_UPLOAD_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/zip",
  "video/mp4",
  "audio/mpeg",
]);

export function isAllowedUploadType(contentType: string): boolean {
  return ALLOWED_UPLOAD_TYPES.has(contentType.toLowerCase());
}

export function sanitizeFileName(name: string): string {
  const cleaned = cleanText(name, 255).replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.length > 0 ? cleaned : "file";
}
