// Loads .env (if present) and exposes typed config. Keys never leave the server.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const envPath = join(root, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const env = process.env;

export const config = {
  root,
  port: Number(env.PORT || 3000),
  dbPath: env.DB_PATH || join(root, 'data', 'adweek.db'),
  krogerClientId: env.KROGER_CLIENT_ID || '',
  krogerClientSecret: env.KROGER_CLIENT_SECRET || '',
  anthropicApiKey: env.ANTHROPIC_API_KEY || '',
  anthropicModel: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  userAgent: env.USER_AGENT || 'AdWeek-PoC/0.1 (personal, non-commercial meal planner)',
  // How long cached deal data is considered fresh before re-ingesting.
  dealTtlHours: Number(env.DEAL_TTL_HOURS || 24),
  // Kroger API: how many of the nearest Kroger stores to price per ZIP.
  krogerMaxStores: Number(env.KROGER_MAX_STORES || 3),
  // Coverage: ZIPs must be within this many miles of downtown Dallas.
  coverageMiles: Number(env.COVERAGE_MILES || 60),
};

export const hasKroger = () => !!(config.krogerClientId && config.krogerClientSecret);
export const hasAnthropic = () => !!config.anthropicApiKey;
