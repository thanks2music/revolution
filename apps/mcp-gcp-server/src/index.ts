import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { Storage } from "@google-cloud/storage";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { google } from "googleapis";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

// ES modules対応
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 環境変数の読み込み
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// 環境変数から設定を取得
const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
const region = process.env.GOOGLE_CLOUD_REGION || "asia-northeast1";
const serviceName = process.env.CLOUD_RUN_SERVICE_NAME || "dev-crd-wordpress-app";
const bucketName = process.env.GCS_BUCKET_NAME;
const sqlInstanceName = process.env.CLOUD_SQL_INSTANCE_NAME;

// 必須環境変数のチェック
if (!projectId) {
  console.error("Error: GOOGLE_CLOUD_PROJECT_ID is not set");
  process.exit(1);
}

if (!bucketName) {
  console.error("Error: GCS_BUCKET_NAME is not set");
  process.exit(1);
}

// Google Cloud クライアント初期化
const storage = new Storage({ projectId });
const secretManager = new SecretManagerServiceClient();

// サーバー初期化
const server = new Server(
  {
    name: process.env.MCP_SERVER_NAME || "gcp-wordpress-mcp-server",
    version: process.env.MCP_SERVER_VERSION || "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ツールの定義
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "check_wordpress_health",
        description: "WordPressサイトの総合ヘルスチェックを実行",
        inputSchema: {
          type: "object",
          properties: {
            includeGcs: {
              type: "boolean",
              description: "GCS統合チェックを含めるか",
              default: true,
            },
            includeDatabase: {
              type: "boolean",
              description: "データベース接続チェックを含めるか",
              default: true,
            },
          },
        },
      },
      {
        name: "list_gcs_media_files",
        description: "WordPressメディアファイルの一覧を取得",
        inputSchema: {
          type: "object",
          properties: {
            prefix: {
              type: "string",
              description: "ファイルプレフィックス（例: wp-content/uploads/2024/）",
            },
            limit: {
              type: "number",
              description: "取得件数制限",
              default: 10,
            },
          },
        },
      },
      {
        name: "get_cloud_run_status",
        description: "Cloud Runサービスの状態と設定を取得",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "check_recent_logs",
        description: "Cloud Runの最新ログを確認",
        inputSchema: {
          type: "object",
          properties: {
            severity: {
              type: "string",
              description: "ログレベル（ERROR, WARNING, INFO）",
              default: "ERROR",
            },
            limit: {
              type: "number",
              description: "取得件数",
              default: 20,
            },
          },
        },
      },
      {
        name: "backup_database",
        description: "Cloud SQLデータベースのバックアップを作成",
        inputSchema: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "バックアップの説明",
            },
          },
        },
      },
      {
        name: "list_secrets",
        description: "Secret Managerに保存された秘密情報の一覧を取得（値は含まない）",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "analyze_gcs_usage",
        description: "GCSバケットの使用状況を分析",
        inputSchema: {
          type: "object",
          properties: {
            detailed: {
              type: "boolean",
              description: "詳細な分析を実行",
              default: false,
            },
          },
        },
      },
    ],
  };
});

// ツール実行ハンドラー
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "check_wordpress_health":
        return await checkWordPressHealth(
          (args as any)?.includeGcs ?? true,
          (args as any)?.includeDatabase ?? true
        );

      case "list_gcs_media_files":
        return await listGCSMediaFiles((args as any)?.prefix, (args as any)?.limit || 10);

      case "get_cloud_run_status":
        return await getCloudRunStatus();

      case "check_recent_logs":
        return await checkRecentLogs((args as any)?.severity || "ERROR", (args as any)?.limit || 20);

      case "backup_database":
        return await backupDatabase((args as any)?.description);

      case "list_secrets":
        return await listSecrets();

      case "analyze_gcs_usage":
        return await analyzeGCSUsage((args as any)?.detailed || false);

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Tool execution failed: ${(error as Error).message}`
    );
  }
});

// WordPressヘルスチェック
async function checkWordPressHealth(includeGcs: boolean, includeDatabase: boolean) {
  const health = {
    timestamp: new Date().toISOString(),
    checks: {} as Record<string, any>,
  };

  // Cloud Run状態チェック
  try {
    const run = google.run("v2");
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const authClient = await auth.getClient();
    const servicePath = `projects/${projectId}/locations/${region}/services/${serviceName}`;

    const response = await run.projects.locations.services.get({
      name: servicePath,
      auth: authClient as any,
    });

    const serviceData = response.data;
    health.checks.cloudRun = {
      status: "healthy",
      url: serviceData?.uri,
      latestRevision: serviceData?.latestReadyRevision,
      updateTime: serviceData?.updateTime,
    };
  } catch (error: any) {
    health.checks.cloudRun = {
      status: "error",
      error: error.message,
    };
  }

  // GCS統合チェック
  if (includeGcs) {
    try {
      const bucket = storage.bucket(bucketName!);
      const [exists] = await bucket.exists();

      if (exists) {
        const [files] = await bucket.getFiles({
          prefix: "wp-content/uploads/",
          maxResults: 1,
        });

        health.checks.gcsIntegration = {
          status: "healthy",
          bucketExists: true,
          hasFiles: files.length > 0,
          bucketName,
        };
      } else {
        health.checks.gcsIntegration = {
          status: "warning",
          bucketExists: false,
          bucketName,
        };
      }
    } catch (error: any) {
      health.checks.gcsIntegration = {
        status: "error",
        error: error.message,
      };
    }
  }

  // データベース接続チェック
  if (includeDatabase) {
    try {
      const sqladmin = google.sqladmin("v1");
      const auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });

      const authClient = await auth.getClient();
      const response = await sqladmin.instances.get({
        project: projectId,
        instance: sqlInstanceName,
        auth: authClient as any,
      });

      const instanceData = response.data;
      health.checks.database = {
        status: "healthy",
        instanceState: instanceData?.state,
        databaseVersion: instanceData?.databaseVersion,
        instanceName: sqlInstanceName,
      };
    } catch (error: any) {
      health.checks.database = {
        status: "error",
        error: error.message,
      };
    }
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(health, null, 2),
      },
    ],
  };
}

// GCSメディアファイル一覧
async function listGCSMediaFiles(prefix?: string, limit: number = 10) {
  try {
    const bucket = storage.bucket(bucketName!);
    const [files] = await bucket.getFiles({
      prefix: prefix || "wp-content/uploads/",
      maxResults: limit,
    });

    const fileList = files.map((file) => ({
      name: file.name,
      size: `${(parseInt(String(file.metadata.size || "0")) / 1024).toFixed(2)} KB`,
      contentType: file.metadata.contentType,
      updated: file.metadata.updated,
      publicUrl: `https://storage.googleapis.com/${bucketName}/${file.name}`,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              bucket: bucketName,
              prefix: prefix || "wp-content/uploads/",
              totalFiles: fileList.length,
              files: fileList,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    throw new McpError(ErrorCode.InternalError, error.message);
  }
}

// Cloud Run状態取得
async function getCloudRunStatus() {
  try {
    const run = google.run("v2");
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const authClient = await auth.getClient();
    const servicePath = `projects/${projectId}/locations/${region}/services/${serviceName}`;

    const response = await run.projects.locations.services.get({
      name: servicePath,
      auth: authClient as any,
    });

    const service = response.data;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              name: service.name,
              uri: service.uri,
              generation: service.generation,
              latestReadyRevision: service.latestReadyRevision,
              latestCreatedRevision: service.latestCreatedRevision,
              traffic: service.traffic,
              observedGeneration: service.observedGeneration,
              conditions: service.conditions,
              updateTime: service.updateTime,
              createTime: service.createTime,
              scaling: service.template?.scaling,
              containers: service.template?.containers?.map((c: any) => ({
                image: c.image,
                resources: c.resources,
                env: c.env?.map((e: any) => e.name), // 値は表示しない
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    throw new McpError(ErrorCode.InternalError, error.message);
  }
}

// 最近のログ確認
async function checkRecentLogs(severity: string, limit: number) {
  try {
    const logging = google.logging("v2");
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const authClient = await auth.getClient();

    const response = await logging.entries.list({
      auth: authClient as any,
      requestBody: {
        resourceNames: [`projects/${projectId}`],
        filter: `resource.type="cloud_run_revision" AND severity>=${severity}`,
        orderBy: "timestamp desc",
        pageSize: limit,
      },
    });

    const responseData = response.data;
    const logs = responseData?.entries?.map((entry: any) => ({
      timestamp: entry.timestamp,
      severity: entry.severity,
      message: entry.textPayload || entry.jsonPayload,
      labels: entry.labels,
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              project: projectId,
              severity,
              count: logs?.length || 0,
              logs,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    throw new McpError(ErrorCode.InternalError, error.message);
  }
}

// データベースバックアップ
async function backupDatabase(description?: string) {
  try {
    const sqladmin = google.sqladmin("v1");
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const authClient = await auth.getClient();
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-");
    const backupDescription = description || `MCP backup ${timestamp}`;

    const response = await sqladmin.backupRuns.insert({
      project: projectId,
      instance: sqlInstanceName,
      auth: authClient as any,
      requestBody: {
        instance: sqlInstanceName,
        type: "ON_DEMAND",
        description: backupDescription,
      },
    });

    const backupData = response.data;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "initiated",
              backupId: backupData?.name,
              description: backupDescription,
              startTime: backupData?.startTime,
              instance: sqlInstanceName,
              operation: backupData?.name,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    throw new McpError(ErrorCode.InternalError, error.message);
  }
}

// Secret Manager一覧
async function listSecrets() {
  try {
    const [secrets] = await secretManager.listSecrets({
      parent: `projects/${projectId}`,
    });

    const secretList = secrets.map((secret) => ({
      name: secret.name?.split("/").pop(),
      createTime: secret.createTime,
      labels: secret.labels,
      replication: secret.replication?.automatic ? "automatic" : "user-managed",
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              project: projectId,
              totalSecrets: secretList.length,
              secrets: secretList,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    throw new McpError(ErrorCode.InternalError, error.message);
  }
}

// GCS使用状況分析
async function analyzeGCSUsage(detailed: boolean) {
  try {
    const bucket = storage.bucket(bucketName!);
    const [files] = await bucket.getFiles({
      prefix: "wp-content/uploads/",
    });

    let totalSize = 0;
    const filesByType: Record<string, { count: number; size: number }> = {};
    const filesByYear: Record<string, { count: number; size: number }> = {};

    for (const file of files) {
      const size = parseInt(String(file.metadata.size || "0"));
      totalSize += size;

      // ファイルタイプ別集計
      const extension = file.name.split(".").pop()?.toLowerCase() || "unknown";
      if (!filesByType[extension]) {
        filesByType[extension] = { count: 0, size: 0 };
      }
      filesByType[extension].count++;
      filesByType[extension].size += size;

      // 年別集計
      const yearMatch = file.name.match(/\/(\d{4})\//);
      if (yearMatch) {
        const year = yearMatch[1];
        if (!filesByYear[year]) {
          filesByYear[year] = { count: 0, size: 0 };
        }
        filesByYear[year].count++;
        filesByYear[year].size += size;
      }
    }

    const result: any = {
      bucket: bucketName,
      totalFiles: files.length,
      totalSize: `${(totalSize / 1024 / 1024).toFixed(2)} MB`,
      filesByType: Object.entries(filesByType).map(([type, data]) => ({
        type,
        count: data.count,
        size: `${(data.size / 1024 / 1024).toFixed(2)} MB`,
      })),
      filesByYear: Object.entries(filesByYear).map(([year, data]) => ({
        year,
        count: data.count,
        size: `${(data.size / 1024 / 1024).toFixed(2)} MB`,
      })),
    };

    if (detailed) {
      // 最大ファイルトップ10
      const largestFiles = files
        .sort((a, b) => parseInt(String(b.metadata.size || "0")) - parseInt(String(a.metadata.size || "0")))
        .slice(0, 10)
        .map((file) => ({
          name: file.name,
          size: `${(parseInt(String(file.metadata.size || "0")) / 1024 / 1024).toFixed(2)} MB`,
          updated: file.metadata.updated,
        }));

      result.largestFiles = largestFiles;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error: any) {
    throw new McpError(ErrorCode.InternalError, error.message);
  }
}

// サーバー起動
async function main() {
  const transport = new StdioServerTransport();

  await server.connect(transport);

  console.error("MCP Server started successfully");
  console.error(`Project: ${projectId}`);
  console.error(`Service: ${serviceName}`);
  console.error(`Bucket: ${bucketName}`);
}

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});