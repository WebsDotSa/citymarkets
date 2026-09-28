/**
 * Cloudflare R2 upload via raw HTTPS + AWS Signature V4.
 *
 * No external SDK — uses Node's built-in `crypto` for HMAC-SHA256. This
 * keeps the install footprint zero and avoids version churn when
 * `@aws-sdk/client-s3` ships breaking changes.
 *
 * Reference: https://developers.cloudflare.com/r2/api/s3/api/
 *
 * Usage:
 *   await uploadToR2({
 *     key: "products/abc123.jpg",
 *     body: Buffer.from(...),
 *     contentType: "image/jpeg",
 *   });
 *   // returns the public URL (R2_PUBLIC_BASE + key)
 */

import crypto from "node:crypto";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`R2 upload: missing env ${name}`);
  return v;
}

function hexHash(buffer: Buffer | Uint8Array | string): string {
  return crypto.createHash("sha256").update(buffer as Buffer).digest("hex");
}

function hmac(key: Buffer | string, payload: string): Buffer {
  return crypto.createHmac("sha256", key).update(payload).digest();
}

/**
 * Derive the AWS Signature V4 signing key from the secret access key.
 * See: https://docs.aws.amazon.com/general/latest/gr/sigv4_signing.html
 */
function getSigningKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export type R2UploadResult = {
  /** The public URL the uploaded object will be served from. */
  publicUrl: string;
  /** The full object key inside the bucket, e.g. "products/abc.jpg". */
  key: string;
  /** ETag of the uploaded object (MD5 for single-part PUT). */
  etag: string;
};

export async function uploadToR2(args: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  cacheControl?: string;
}): Promise<R2UploadResult> {
  const accountId = requireEnv("R2_ACCOUNT_ID");
  const accessKey = requireEnv("R2_ACCESS_KEY_ID");
  const secretKey = requireEnv("R2_SECRET_ACCESS_KEY");
  const bucket = requireEnv("R2_BUCKET");
  const publicBase =
    process.env.R2_PUBLIC_BASE ?? `https://pub-${accountId}.r2.dev`;

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = "auto";
  const service = "s3";

  const now = new Date();
  const amzDate =
    now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = hexHash(args.body);
  const cacheControl = args.cacheControl ?? "public, max-age=31536000, immutable";

  // Canonical request — headers MUST be sorted alphabetically by name
  // per AWS SigV4 spec. `x-amz-cache-control` sorts before
  // `x-amz-content-sha256`, so it has to come third. Without that
  // ordering R2 returns SignatureDoesNotMatch and we silently fall
  // back to the local `/images/...` URL — which then trips the Zod
  // `z.string().url()` validator on the product form.
  const canonicalUri = `/${bucket}/${encodeURI(args.key)}`;
  const canonicalQueryString = "";
  const canonicalHeaders =
    `content-type:${args.contentType}\n` +
    `host:${host}\n` +
    `x-amz-cache-control:${cacheControl}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders =
    "content-type;host;x-amz-cache-control;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  // String to sign
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hexHash(canonicalRequest),
  ].join("\n");

  const signingKey = getSigningKey(secretKey, dateStamp, region, service);
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `https://${host}${canonicalUri}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Host: host,
      "Content-Type": args.contentType,
      "Content-Length": String(args.body.byteLength),
      "X-Amz-Content-Sha256": payloadHash,
      "X-Amz-Date": amzDate,
      "X-Amz-Cache-Control": cacheControl,
      Authorization: authorization,
    },
    // fetch() accepts BodyInit — for binary we cast through Uint8Array
    // view which is always assignable (Buffer is a subclass).
    body: args.body as unknown as BodyInit,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(
      `R2 upload failed: ${res.status} ${res.statusText} — ${errBody.slice(0, 200)}`,
    );
  }

  const etag = res.headers.get("etag")?.replaceAll('"', "") ?? "";

  return {
    publicUrl: `${publicBase.replace(/\/$/, "")}/${args.key}`,
    key: args.key,
    etag,
  };
}

/**
 * Public-URL helper for keys already uploaded. Useful when the upload
 * succeeded but the caller wants the canonical URL without re-uploading.
 */
export function r2PublicUrl(key: string): string {
  const base =
    process.env.R2_PUBLIC_BASE ??
    `https://pub-${requireEnv("R2_ACCOUNT_ID")}.r2.dev`;
  return `${base.replace(/\/$/, "")}/${key}`;
}

/**
 * Extract the R2 object key from a public URL produced by `r2PublicUrl`.
 * Returns null if the URL is not an R2 public URL we own — so callers can
 * skip deletion for vendor placeholders or external images without
 * throwing.
 */
export function r2KeyFromUrl(url: string): string | null {
  const base =
    process.env.R2_PUBLIC_BASE ??
    `https://pub-${requireEnv("R2_ACCOUNT_ID")}.r2.dev`;
  if (!url.startsWith(base)) return null;
  const key = url.slice(base.length).replace(/^\//, "");
  return key.length > 0 ? key : null;
}

/**
 * Delete an object from R2. Idempotent: a 404 from R2 is treated as
 * success because the desired end state (object absent) is already
 * achieved. Other errors bubble up so the caller can decide whether to
 * retry or fall back to a "tombstone" record.
 */
export async function deleteFromR2(key: string): Promise<void> {
  const accountId = requireEnv("R2_ACCOUNT_ID");
  const accessKey = requireEnv("R2_ACCESS_KEY_ID");
  const secretKey = requireEnv("R2_SECRET_ACCESS_KEY");
  const bucket = requireEnv("R2_BUCKET");

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = "auto";
  const service = "s3";

  const now = new Date();
  const amzDate =
    now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = hexHash("");
  const canonicalUri = `/${bucket}/${encodeURI(key)}`;
  const canonicalQueryString = "";
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "DELETE",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hexHash(canonicalRequest),
  ].join("\n");

  const signingKey = getSigningKey(secretKey, dateStamp, region, service);
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `https://${host}${canonicalUri}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Host: host,
      "X-Amz-Content-Sha256": payloadHash,
      "X-Amz-Date": amzDate,
      Authorization: authorization,
    },
  });

  if (res.ok || res.status === 404) return;

  const errBody = await res.text();
  throw new Error(
    `R2 delete failed: ${res.status} ${res.statusText} — ${errBody.slice(0, 200)}`,
  );
}
