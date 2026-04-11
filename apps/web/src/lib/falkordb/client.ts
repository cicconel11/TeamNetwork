import { existsSync } from "fs";
import { toErrorMessage } from "@/lib/falkordb/utils";

export interface FalkorQueryClient {
  isAvailable(): boolean;
  getUnavailableReason?(): "disabled" | "unavailable";
  query<T extends Record<string, unknown>>(
    orgId: string,
    cypher: string,
    params?: Record<string, unknown>
  ): Promise<T[]>;
}

type FalkorDatabaseHandle = {
  selectGraph(graphId: string): {
    query<T extends Record<string, unknown>>(
      query: string,
      options?: { params?: Record<string, unknown> }
    ): Promise<{ data?: T[] }>;
    delete(): Promise<void>;
  };
  close(): Promise<void>;
};

type FalkorConfig =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      mode: "embedded" | "remote";
      graphPrefix: string;
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      redisServerPath?: string;
      dataPath?: string;
    };

const DEFAULT_GRAPH_PREFIX = "teamnetwork_people";
const FALLBACK_REDIS_PATHS = [
  "/opt/homebrew/bin/redis-server",
  "/usr/local/bin/redis-server",
];

function resolveEmbeddedRedisServerPath() {
  const configured = process.env.FALKOR_REDIS_SERVER_PATH?.trim();
  if (configured) {
    return configured;
  }

  for (const candidate of FALLBACK_REDIS_PATHS) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

let cachedConfig: FalkorConfig | null = null;

function getFalkorConfig(): FalkorConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const config = parseFalkorConfig();
  cachedConfig = config;
  return config;
}

function parseFalkorConfig(): FalkorConfig {
  if (process.env.FALKOR_ENABLED !== "true") {
    return { enabled: false, reason: "disabled_via_env" };
  }

  const graphPrefix = process.env.FALKOR_GRAPH_PREFIX?.trim() || DEFAULT_GRAPH_PREFIX;
  const url = process.env.FALKOR_URL?.trim();
  if (url) {
    const parsed = new URL(url);
    return {
      enabled: true,
      mode: "remote",
      graphPrefix,
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    };
  }

  const host = process.env.FALKOR_HOST?.trim();
  if (host) {
    return {
      enabled: true,
      mode: "remote",
      graphPrefix,
      host,
      port: Number(process.env.FALKOR_PORT || 6379),
      username: process.env.FALKOR_USERNAME?.trim() || undefined,
      password: process.env.FALKOR_PASSWORD?.trim() || undefined,
    };
  }

  if (process.env.FALKOR_EMBEDDED === "true") {
    const redisServerPath = resolveEmbeddedRedisServerPath();
    if (!redisServerPath) {
      return { enabled: false, reason: "embedded_redis_server_not_found" };
    }

    return {
      enabled: true,
      mode: "embedded",
      graphPrefix,
      redisServerPath,
      dataPath: process.env.FALKOR_EMBEDDED_PATH?.trim() || undefined,
    };
  }

  return { enabled: false, reason: "missing_remote_or_embedded_config" };
}

function graphNameForOrg(orgId: string, graphPrefix: string) {
  return `${graphPrefix}_${orgId.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

export class FalkorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FalkorUnavailableError";
  }
}

export class FalkorQueryError extends Error {
  cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "FalkorQueryError";
    this.cause = cause;
  }
}

class FalkorClientImpl implements FalkorQueryClient {
  private connectionPromise: Promise<FalkorDatabaseHandle> | null = null;

  isAvailable() {
    return getFalkorConfig().enabled;
  }

  getUnavailableReason(): "disabled" | "unavailable" {
    return getFalkorConfig().enabled ? "unavailable" : "disabled";
  }

  async query<T extends Record<string, unknown>>(
    orgId: string,
    cypher: string,
    params?: Record<string, unknown>
  ) {
    const config = getFalkorConfig();
    if (!config.enabled) {
      throw new FalkorUnavailableError(`Falkor unavailable: ${config.reason}`);
    }

    const connection = await this.getConnection(config);
    const graph = connection.selectGraph(graphNameForOrg(orgId, config.graphPrefix));

    try {
      const result = await graph.query<T>(cypher, params ? { params } : undefined);
      return result.data ?? [];
    } catch (error) {
      throw new FalkorQueryError(`Falkor query failed: ${toErrorMessage(error, "unknown_falkor_error")}`, error);
    }
  }

  async close() {
    const promise = this.connectionPromise;
    this.connectionPromise = null;

    if (!promise) {
      return;
    }

    try {
      const connection = await promise;
      await connection.close();
    } catch {
      // Ignore teardown failures; a fresh connection will be created next time.
    }
  }

  async deleteGraphForTests(orgId: string) {
    const config = getFalkorConfig();
    if (!config.enabled) {
      return;
    }

    const connection = await this.getConnection(config);
    await connection.selectGraph(graphNameForOrg(orgId, config.graphPrefix)).delete();
  }

  private async getConnection(config: Extract<FalkorConfig, { enabled: true }>) {
    if (!this.connectionPromise) {
      this.connectionPromise = this.createConnection(config).catch((error) => {
        this.connectionPromise = null;
        throw error;
      });
    }

    return this.connectionPromise;
  }

  private async createConnection(config: Extract<FalkorConfig, { enabled: true }>) {
    try {
      if (config.mode === "embedded") {
        const { FalkorDB } = await import("falkordblite");
        return (await FalkorDB.open({
          redisServerPath: config.redisServerPath,
          path: config.dataPath,
        })) as FalkorDatabaseHandle;
      }

      const { FalkorDB } = await import("falkordb");
      return (await FalkorDB.connect({
        username: config.username,
        password: config.password,
        socket: {
          host: config.host,
          port: config.port,
        },
      })) as FalkorDatabaseHandle;
    } catch (error) {
      throw new FalkorUnavailableError(`Failed to connect to Falkor: ${toErrorMessage(error, "unknown_falkor_error")}`);
    }
  }
}

export const falkorClient = new FalkorClientImpl();
