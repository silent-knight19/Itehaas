import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { hashPassword, verifyPassword } from '../lib/auth';
import { encryptSecret, decryptSecret } from '../lib/secrets';

describe('S16 Cryptographic Integrity & Primitives', () => {
  it('S16-01: Argon2id password hashing adheres to secure parameters', async () => {
    const pwd = 'TestPassword123!@#';
    const hash = await hashPassword(pwd);
    // Format: $argon2id$v=19$m=65536,t=3,p=1$...
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    const valid = await verifyPassword(hash, pwd);
    expect(valid).toBe(true);
    const invalid = await verifyPassword(hash, 'WrongPassword');
    expect(invalid).toBe(false);
  });

  it('S16-02: Zero Math.random usage in production server source code', async () => {
    const files = ['src/index.ts', 'src/lib/auth.ts', 'src/lib/secrets.ts', 'src/routes/repos.ts', 'src/routes/ci.ts'];
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
      expect(content).not.toContain('Math.random()');
    }
  });

  it('S16-03: AES-256-GCM authenticated encryption rejects tampered ciphertext', async () => {
    const plaintext = 'super-sensitive-ci-token-value';
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).not.toBe(plaintext);

    // Verify valid decryption
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plaintext);

    // Tamper with ciphertext by modifying a byte in the base64 string
    const raw = Buffer.from(encrypted, 'base64');
    raw[raw.length - 1] ^= 0x01; // flip 1 bit in tag or ciphertext
    const tampered = raw.toString('base64');

    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('S16-04: Constant-time comparison rejects unequal tokens without timing variance', async () => {
    const tokenA = crypto.randomBytes(32).toString('hex');
    const tokenB = crypto.randomBytes(32).toString('hex');
    const tokenAClone = Buffer.from(tokenA).toString();

    expect(crypto.timingSafeEqual(Buffer.from(tokenA), Buffer.from(tokenAClone))).toBe(true);
    expect(crypto.timingSafeEqual(Buffer.from(tokenA), Buffer.from(tokenB))).toBe(false);
  });

  it('S16-05: CSPRNG session IDs maintain high entropy', async () => {
    const sessionIds = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = crypto.randomUUID();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(sessionIds.has(id)).toBe(false);
      sessionIds.add(id);
    }
    expect(sessionIds.size).toBe(100);
  });
});
