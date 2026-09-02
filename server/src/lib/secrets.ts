import * as crypto from 'crypto';
import { config } from '../config';

/**
 * S9/SEC-009: Derive 32-byte AES-256-GCM key from SECRET_ENCRYPTION_KEY using HKDF-SHA256
 * with domain separation context 'itehaas-ci-secrets-v1'.
 */
export function getSecretEncryptionKey(rootKey?: string): Buffer {
  const secret = rootKey || config.secretEncryptionKey || config.cookieSecret;
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.from(secret),
    Buffer.from('itehaas-salt-ci-secrets-v1'),
    Buffer.from('itehaas-ci-secrets-v1'),
    32
  ) as ArrayBuffer);
}

/**
 * Fallback legacy key derived via SHA-256(cookieSecret) for backward compatibility.
 */
function getLegacyKey(): Buffer {
  return crypto.createHash('sha256').update(config.cookieSecret).digest();
}

/**
 * Encrypt plaintext with AES-256-GCM using a cryptographically random 12-byte IV.
 * Returns formatted versioned string: "v1:" + base64(iv(12) + authTag(16) + ciphertext).
 */
export function encryptSecret(plaintext: string, rootKey?: string): string {
  const key = getSecretEncryptionKey(rootKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, enc]);
  return `v1:${payload.toString('base64')}`;
}

/**
 * Decrypt ciphertext with AES-256-GCM.
 * Supports versioned "v1:..." ciphertexts, unversioned ciphertexts, and fallback to legacy keys.
 */
export function decryptSecret(ciphertextStr: string, rootKey?: string): string {
  let isV1 = false;
  let rawB64 = ciphertextStr;
  if (ciphertextStr.startsWith('v1:')) {
    isV1 = true;
    rawB64 = ciphertextStr.slice(3);
  }

  const data = Buffer.from(rawB64, 'base64');
  if (data.length < 28) throw new Error('ciphertext too short');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const enc = data.subarray(28);

  // Attempt with HKDF key first
  const keysToTry: Buffer[] = [];
  if (rootKey) {
    keysToTry.push(getSecretEncryptionKey(rootKey));
  } else {
    keysToTry.push(getSecretEncryptionKey());
    keysToTry.push(getLegacyKey());
  }

  let lastErr: any = null;
  for (const key of keysToTry) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
      return dec.toString('utf8');
    } catch (err: any) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('decryption failed');
}

/**
 * Try decrypting, and if that fails, return the raw value (for legacy plaintext).
 */
export function decryptSecretSafe(ciphertext: string, rootKey?: string): string {
  try {
    return decryptSecret(ciphertext, rootKey);
  } catch {
    return ciphertext;
  }
}

/**
 * Key rotation helper: re-encrypts an existing ciphertext with a new encryption key.
 */
export function rotateSecret(ciphertext: string, newRootKey?: string): string {
  const plaintext = decryptSecret(ciphertext);
  return encryptSecret(plaintext, newRootKey);
}

/**
 * S9: Hardened log masking.
 * Replaces any secret of length >= 4 with "***", handling:
 * 1. Raw secret
 * 2. URL-encoded variant
 * 3. Base64-encoded variant
 * 4. JSON-escaped variant
 */
export function maskSecretInLog(logs: string, secretValue: string): string {
  if (!secretValue || secretValue.length < 4) return logs;

  let masked = logs;
  const variants = new Set<string>();

  // 1. Raw
  variants.add(secretValue);

  // 2. URL-encoded
  try {
    const urlEnc = encodeURIComponent(secretValue);
    if (urlEnc.length >= 4) variants.add(urlEnc);
  } catch {}

  // 3. Base64
  try {
    const b64 = Buffer.from(secretValue, 'utf8').toString('base64');
    if (b64.length >= 4) variants.add(b64);
  } catch {}

  // 4. JSON-escaped (middle of string)
  try {
    const jsonEsc = JSON.stringify(secretValue).slice(1, -1);
    if (jsonEsc.length >= 4) variants.add(jsonEsc);
  } catch {}

  for (const variant of variants) {
    masked = masked.split(variant).join('***');
  }

  return masked;
}
