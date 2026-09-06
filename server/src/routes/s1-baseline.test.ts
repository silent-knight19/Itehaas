import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  createConfig,
  validateStartupConfig,
  validateDatabaseUrl,
  validateReposRoot,
  validateItehaasBin,
  validatePort,
  AppConfig,
} from '../config';

describe('S1 Security Baseline & Fail-Closed Boot', () => {
  const validProdSecret = 'super-secure-production-random-auth-key-at-least-32-chars-long';
  const validProdSek = 'distinct-secret-encryption-key-9f8e7d6c5b4a39485769788796a5b4c';
  const validProdDb = 'postgres://prod_user:Str0ng!X7q2$Z9mV4kQ8@db.internal:5432/itehaas_prod';
  const validReposRoot = path.join(__dirname, '../../../data/repos');
  const validBin = path.join(__dirname, '../../../target/debug/itehaas');

  function getBaseProdConfig(): AppConfig {
    return {
      port: 3001,
      host: '127.0.0.1',
      databaseUrl: validProdDb,
      reposRoot: validReposRoot,
      itehaasBin: validBin,
      cookieSecret: validProdSecret,
      secretEncryptionKey: validProdSek,
      nodeEnv: 'production',
      isProd: true,
    };
  }

  describe('1. Secret Validation & Fail-Closed Requirements', () => {
    it('missing secret -> startup failure in production', () => {
      expect(() => {
        createConfig({
          NODE_ENV: 'production',
          DATABASE_URL: validProdDb,
          // COOKIE_SECRET omitted
        });
      }).toThrow(/COOKIE_SECRET is required in production/);
    });

    it('weak secret (length < 32) -> startup failure in production', () => {
      const cfg = getBaseProdConfig();
      cfg.cookieSecret = 'short-secret';
      expect(() => validateStartupConfig(cfg, { NODE_ENV: 'production', SECRET_ENCRYPTION_KEY: validProdSek })).toThrow(
        /COOKIE_SECRET too short in production \(min 32 chars/
      );
    });

    it('insecure default patterns in secret -> startup failure in production', () => {
      const patterns = [
        'dev-secret-change-me',
        'change-me-in-production',
        'changeme',
        'default-secret',
        'password123',
        '12345678',
        'itehaas',
      ];

      for (const pat of patterns) {
        const cfg = getBaseProdConfig();
        cfg.cookieSecret = `random-padding-prefix-12345-${pat}-random-padding-suffix-67890`;
        expect(() => validateStartupConfig(cfg, { NODE_ENV: 'production', SECRET_ENCRYPTION_KEY: validProdSek })).toThrow(
          /contains insecure default pattern/
        );
      }
    });

    it('unrecognized NODE_ENV -> startup failure', () => {
      const cfg = getBaseProdConfig();
      cfg.isProd = false;
      cfg.nodeEnv = 'staging_unknown';
      expect(() => validateStartupConfig(cfg, { NODE_ENV: 'staging_unknown' })).toThrow(
        /Invalid NODE_ENV/
      );
    });
  });

  describe('2. Debug Settings & Production Separation', () => {
    it('production debug setting (DEBUG=true) -> startup failure', () => {
      const cfg = getBaseProdConfig();
      expect(() =>
        validateStartupConfig(cfg, { NODE_ENV: 'production', SECRET_ENCRYPTION_KEY: validProdSek, DEBUG: 'true' })
      ).toThrow(/DEBUG mode is forbidden in production environment/);
    });

    it('production debug setting (ITEHAAS_DEBUG=1) -> startup failure', () => {
      const cfg = getBaseProdConfig();
      expect(() =>
        validateStartupConfig(cfg, { NODE_ENV: 'production', SECRET_ENCRYPTION_KEY: validProdSek, ITEHAAS_DEBUG: '1' })
      ).toThrow(/DEBUG mode is forbidden in production environment/);
    });

    it('production verbose log level (LOG_LEVEL=debug) -> startup failure', () => {
      const cfg = getBaseProdConfig();
      expect(() =>
        validateStartupConfig(cfg, { NODE_ENV: 'production', SECRET_ENCRYPTION_KEY: validProdSek, LOG_LEVEL: 'debug' })
      ).toThrow(/Verbose LOG_LEVEL="debug" is forbidden in production/);
    });

    it('production verbose log level (LOG_LEVEL=trace) -> startup failure', () => {
      const cfg = getBaseProdConfig();
      expect(() =>
        validateStartupConfig(cfg, { NODE_ENV: 'production', SECRET_ENCRYPTION_KEY: validProdSek, LOG_LEVEL: 'trace' })
      ).toThrow(/Verbose LOG_LEVEL="trace" is forbidden in production/);
    });
  });

  describe('3. Database Configuration Validation', () => {
    it('invalid DB configuration (malformed URL) -> startup failure', () => {
      expect(() => validateDatabaseUrl('not a valid url at all ::::', false)).toThrow(
        /DATABASE_URL is malformed/
      );
    });

    it('invalid DB configuration (non-postgres protocol) -> startup failure', () => {
      expect(() => validateDatabaseUrl('http://localhost:5432/itehaas', false)).toThrow(
        /must use postgres: or postgresql: protocol/
      );
      expect(() => validateDatabaseUrl('mysql://localhost:3306/itehaas', false)).toThrow(
        /must use postgres: or postgresql: protocol/
      );
    });

    it('invalid DB configuration (missing hostname) -> startup failure', () => {
      expect(() => validateDatabaseUrl('postgres:///itehaas', false)).toThrow(
        /missing hostname/
      );
    });

    it('invalid DB configuration (empty string) -> startup failure', () => {
      expect(() => validateDatabaseUrl('', false)).toThrow(
        /DATABASE_URL must be a non-empty string/
      );
    });

    it('default credentials in production DB URL -> startup failure', () => {
      expect(() =>
        validateDatabaseUrl('postgres://itehaas:itehaas@db.internal:5432/itehaas', true)
      ).toThrow(/contains insecure default credentials "itehaas:itehaas" in production/);

      expect(() =>
        validateDatabaseUrl('postgres://postgres:postgres@db.internal:5432/itehaas', true)
      ).toThrow(/contains insecure default credentials "postgres:postgres" in production/);
    });
  });

  describe('4. Repository Root Validation', () => {
    it('invalid repository root (empty string) -> startup failure', () => {
      expect(() => validateReposRoot('', true)).toThrow(/REPOS_ROOT must be a non-empty string/);
    });

    it('invalid repository root (null bytes) -> startup failure', () => {
      expect(() => validateReposRoot('/tmp/repos\0/bad', true)).toThrow(/forbidden null bytes/);
    });

    it('invalid repository root (file instead of directory) -> startup failure', () => {
      expect(() => validateReposRoot(__filename, true)).toThrow(/exists but is not a directory/);
    });

    it('invalid repository root in production (parent non-existent) -> startup failure', () => {
      expect(() =>
        validateReposRoot('/nonexistent_root_dir_abc123/subfolder_xyz/repos', true)
      ).toThrow(/parent directory does not exist/);
    });
  });

  describe('5. VCS Executable Path Validation', () => {
    it('invalid binary path (empty string) -> startup failure', () => {
      expect(() => validateItehaasBin('', true)).toThrow(/ITEHAAS_BIN must be a non-empty string/);
    });

    it('invalid binary path (null bytes) -> startup failure', () => {
      expect(() => validateItehaasBin('/bin/itehaas\0', true)).toThrow(/forbidden null bytes/);
    });

    it('invalid binary path (non-existent file in production) -> startup failure', () => {
      expect(() => validateItehaasBin('/usr/local/bin/nonexistent_itehaas_binary_xyz', true)).toThrow(
        /executable not found/
      );
    });

    it('invalid binary path (directory instead of file) -> startup failure', () => {
      expect(() => validateItehaasBin(__dirname, true)).toThrow(/exists but is not a regular file/);
    });
  });

  describe('6. Host Binding Validation in Production', () => {
    it('binding to 0.0.0.0 in production -> startup failure without override', () => {
      const cfg = getBaseProdConfig();
      cfg.host = '0.0.0.0';
      expect(() => validateStartupConfig(cfg, { NODE_ENV: 'production', SECRET_ENCRYPTION_KEY: validProdSek })).toThrow(
        /Binding to 0.0.0.0 is forbidden in production/
      );
    });

    it('binding to 0.0.0.0 in production allowed with explicit override', () => {
      const cfg = getBaseProdConfig();
      cfg.host = '0.0.0.0';
      // Should not throw when explicit override is provided
      expect(() =>
        validateStartupConfig(cfg, { NODE_ENV: 'production', SECRET_ENCRYPTION_KEY: validProdSek, ALLOW_ALL_INTERFACES: 'true' })
      ).not.toThrow();
    });
  });

  describe('7. Valid Configurations', () => {
    it('valid production configuration passes validation', () => {
      const cfg = getBaseProdConfig();
      expect(() => validateStartupConfig(cfg, { NODE_ENV: 'production', SECRET_ENCRYPTION_KEY: validProdSek })).not.toThrow();
    });

    it('valid test environment passes validation with dev defaults', () => {
      const testCfg: AppConfig = {
        port: 3001,
        host: '127.0.0.1',
        databaseUrl: 'postgres://itehaas:itehaas@localhost:5432/itehaas',
        reposRoot: validReposRoot,
        itehaasBin: validBin,
        cookieSecret: 'dev-secret-change-me',
        secretEncryptionKey: 'dev-secret-change-me-fallback-test-only-0000',
        nodeEnv: 'test',
        isProd: false,
      };
      expect(() => validateStartupConfig(testCfg, { NODE_ENV: 'test' })).not.toThrow();
    });
  });

  describe('8. S1-fresh hardening (explicit SEK, DB password, any-bind, port)', () => {
    it('missing SECRET_ENCRYPTION_KEY -> startup failure in production even with COOKIE_SECRET set', () => {
      const cfg = getBaseProdConfig();
      expect(() =>
        validateStartupConfig(cfg, { NODE_ENV: 'production' })
      ).toThrow(/SECRET_ENCRYPTION_KEY is required in production/);
    });

    it('SECRET_ENCRYPTION_KEY coupled to COOKIE_SECRET -> startup failure in production', () => {
      const cfg = getBaseProdConfig();
      cfg.secretEncryptionKey = cfg.cookieSecret;
      expect(() =>
        validateStartupConfig(cfg, { NODE_ENV: 'production', SECRET_ENCRYPTION_KEY: cfg.cookieSecret })
      ).toThrow(/must be distinct from COOKIE_SECRET/);
    });

    it('weak SECRET_ENCRYPTION_KEY (<32) -> startup failure in production', () => {
      const cfg = getBaseProdConfig();
      cfg.secretEncryptionKey = 'short';
      expect(() =>
        validateStartupConfig(cfg, { NODE_ENV: 'production', SECRET_ENCRYPTION_KEY: 'short' })
      ).toThrow(/SECRET_ENCRYPTION_KEY too short/);
    });

    it('createConfig without SECRET_ENCRYPTION_KEY still fails closed at validateStartupConfig', () => {
      const cfg = createConfig({
        NODE_ENV: 'production',
        DATABASE_URL: validProdDb,
        COOKIE_SECRET: validProdSecret,
        REPOS_ROOT: validReposRoot,
        ITEHAAS_BIN: validBin,
      } as any);
      // Coupled fallback value passes createConfig but must fail validation without explicit env.
      expect(() =>
        validateStartupConfig(cfg, { NODE_ENV: 'production' })
      ).toThrow(/SECRET_ENCRYPTION_KEY is required/);
    });

    it('invalid DB configuration (missing password) -> startup failure in production', () => {
      expect(() =>
        validateDatabaseUrl('postgres://prod_user@db.internal:5432/itehaas_prod', true)
      ).toThrow(/must include a password/);
    });

    it('invalid DB configuration (short password) -> startup failure in production', () => {
      expect(() =>
        validateDatabaseUrl('postgres://prod_user:short1@db.internal:5432/itehaas_prod', true)
      ).toThrow(/password too short/);
    });

    it('invalid DB configuration (weak password pattern) -> startup failure in production', () => {
      expect(() =>
        validateDatabaseUrl('postgres://prod_user:CHANGEME12345@db.internal:5432/itehaas_prod', true)
      ).toThrow(/weak pattern/);
    });

    it('binding to :: in production -> startup failure without override', () => {
      const cfg = getBaseProdConfig();
      cfg.host = '::';
      expect(() => validateStartupConfig(cfg, { NODE_ENV: 'production', SECRET_ENCRYPTION_KEY: validProdSek })).toThrow(
        /Binding to :: is forbidden/
      );
    });

    it('binding to :: in production allowed with explicit override', () => {
      const cfg = getBaseProdConfig();
      cfg.host = '::';
      expect(() =>
        validateStartupConfig(cfg, { NODE_ENV: 'production', SECRET_ENCRYPTION_KEY: validProdSek, ALLOW_ALL_INTERFACES: 'true' })
      ).not.toThrow();
    });

    it('invalid port (0, 99999, NaN) -> startup failure', () => {
      expect(() => validatePort(0)).toThrow(/PORT must be an integer 1-65535/);
      expect(() => validatePort(99999)).toThrow(/PORT must be an integer 1-65535/);
      expect(() => validatePort(NaN)).toThrow(/PORT must be an integer 1-65535/);
      expect(() => validatePort(3001)).not.toThrow();
    });

    it('world-writable REPOS_ROOT parent -> startup failure in production', () => {
      const dir = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'itehaas-s1-'));
      try {
        fs.chmodSync(dir, 0o777);
        const child = path.join(dir, 'repos');
        expect(() => validateReposRoot(child, true)).toThrow(/world-writable/);
      } finally {
        try { fs.chmodSync(dir, 0o755); fs.rmdirSync(dir); } catch {}
      }
    });
  });
});
