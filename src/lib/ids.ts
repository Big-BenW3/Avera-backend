/**
 * Buildspace API module: src/lib/ids.ts
 * Generates opaque application identifiers that avoid exposing database implementation details.
 */

import { customAlphabet } from "nanoid";

// Human-safe opaque IDs are used in public URLs and realtime subjects.
// They avoid leaking row counts and are suitable for LiveKit room identities.
const generateOpaqueId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 18);

export function opaqueId(prefix: string): string {
  return `${prefix}_${generateOpaqueId()}`;
}
