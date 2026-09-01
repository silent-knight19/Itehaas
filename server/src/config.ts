import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || 'postgres://itehaas:itehaas@localhost:5432/itehaas',
  reposRoot: process.env.REPOS_ROOT || path.join(__dirname, '../../data/repos'),
  itehaasBin: process.env.ITEHAAS_BIN || path.join(__dirname, '../../target/debug/itehaas'),
  cookieSecret: process.env.COOKIE_SECRET || 'dev-secret-change-me',
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
};
