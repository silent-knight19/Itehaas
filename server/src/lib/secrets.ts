import * as crypto from 'crypto';
import { config } from '../config';

function getKey(): Buffer {
  // Derive 32-byte key from cookieSecret via SHA-256
  return crypto.createHash('sha256').update(config.cookieSecret).digest();
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns base64(iv(12) + authTag(16) + ciphertext)
 */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = Buffer.concat([iv, tag, enc]);
  return out.toString('base64');
}

/**
 * Decrypt ciphertext (base64 iv+tag+ciphertext) with AES-256-GCM.
 * If decrypt fails, throws. Caller should fallback to plaintext for legacy.
 */
export function decryptSecret(ciphertextB64: string): string {
  const key = getKey();
  const data = Buffer.from(ciphertextB64, 'base64');
  if (data.length < 28) throw new Error('ciphertext too short');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const enc = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

/**
 * Try decrypt, if fails treat as plaintext (legacy).
 */
export function decryptSecretSafe(ciphertextB64: string): string {
  try {
    return decryptSecret(ciphertextB64);
  } catch {
    // Legacy plaintext
    return ciphertextB64;
  }
}
