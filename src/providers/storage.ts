/**
 * Buildspace API module: src/providers/storage.ts
 * Encapsulates S3-compatible signed upload and download URL generation for private attachments.
 */

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AppConfig } from "../config/env.js";

function client(config: AppConfig): S3Client {
  if (!config.S3_BUCKET || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) throw new Error("Object storage has not been configured.");
  return new S3Client({ region: config.S3_REGION, ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}), credentials: { accessKeyId: config.S3_ACCESS_KEY_ID!, secretAccessKey: config.S3_SECRET_ACCESS_KEY! }, forcePathStyle: Boolean(config.S3_ENDPOINT) });
}
export function storageConfigured(config: AppConfig): boolean { return Boolean(config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY); }
export async function createUploadUrl(config: AppConfig, key: string, contentType: string) { return getSignedUrl(client(config), new PutObjectCommand({ Bucket: config.S3_BUCKET!, Key: key, ContentType: contentType }), { expiresIn: 300 }); }
export async function createDownloadUrl(config: AppConfig, key: string) { return getSignedUrl(client(config), new GetObjectCommand({ Bucket: config.S3_BUCKET!, Key: key }), { expiresIn: 300 }); }
