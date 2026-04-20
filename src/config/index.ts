import dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env variable: ${key}`);
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  nodeEnv: optionalEnv('NODE_ENV', 'development'),
  bot: {
    token: requireEnv('BOT_TOKEN'),
    adminIds: requireEnv('ADMIN_IDS').split(',').map((id) => id.trim()),
  },
  db: {
    host: optionalEnv('DB_HOST', 'localhost'),
    port: parseInt(optionalEnv('DB_PORT', '3306'), 10),
    user: requireEnv('DB_USER'),
    password: requireEnv('DB_PASSWORD'),
    database: requireEnv('DB_NAME'),
  },
  redis: {
    enabled: optionalEnv('REDIS_ENABLED', 'false') === 'true',
    url: optionalEnv('REDIS_URL', 'redis://localhost:6379'),
  },
  blockchain: {
    trongridApiKey: optionalEnv('TRONGRID_API_KEY', ''),
    bscscanApiKey: optionalEnv('BSCSCAN_API_KEY', ''),
    etherscanApiKey: optionalEnv('ETHERSCAN_API_KEY', ''),
  },
  app: {
    instanceId: optionalEnv('INSTANCE_ID', `instance-${process.pid}`),
    reservationTimeoutSeconds: parseInt(optionalEnv('RESERVATION_TIMEOUT_SECONDS', '600'), 10),
    jobPollIntervalMs: parseInt(optionalEnv('JOB_POLL_INTERVAL_MS', '15000'), 10),
  },
} as const;