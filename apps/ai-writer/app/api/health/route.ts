import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  environment: string;
  service: string;
  checks: {
    firebase: {
      status: 'pass' | 'fail';
      message: string;
    };
    secrets: {
      status: 'pass' | 'fail';
      message: string;
    };
    ai: {
      status: 'pass' | 'fail';
      message: string;
    };
  };
}

/**
 * Deep Health Check エンドポイント
 * Cloud Run のヘルスチェックとDockerのHEALTHCHECKで使用
 * Firebase設定、Secret Manager、AI プロバイダーの検証を実行
 */
export async function GET() {
  const startTime = Date.now();
  const healthCheck: HealthCheckResult = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    service: 'ai-writer',
    checks: {
      firebase: {
        status: 'pass',
        message: 'Firebase configuration loaded',
      },
      secrets: {
        status: 'pass',
        message: 'Required secrets available',
      },
      ai: {
        status: 'pass',
        message: 'AI provider configured',
      },
    },
  };

  try {
    // Check Firebase configuration
    const firebaseKeys = [
      'NEXT_PUBLIC_FIREBASE_API_KEY',
      'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
      'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
      'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
      'NEXT_PUBLIC_FIREBASE_APP_ID',
    ];

    const missingFirebaseKeys = firebaseKeys.filter(
      (key) => !process.env[key]
    );

    if (missingFirebaseKeys.length > 0) {
      healthCheck.checks.firebase.status = 'fail';
      healthCheck.checks.firebase.message = `Missing Firebase keys: ${missingFirebaseKeys.join(', ')}`;
      healthCheck.status = 'degraded';
    }

    // Check required secrets
    const requiredSecrets = [
      'ALLOWED_EMAILS',
      'FIREBASE_PRIVATE_KEY',
      'FIREBASE_CLIENT_EMAIL',
      'FIREBASE_PROJECT_ID',
      'GITHUB_PAT',
      'GITHUB_OWNER',
      'GITHUB_REPO',
    ];

    const missingSecrets = requiredSecrets.filter(
      (key) => !process.env[key]
    );

    if (missingSecrets.length > 0) {
      healthCheck.checks.secrets.status = 'fail';
      healthCheck.checks.secrets.message = `Missing secrets: ${missingSecrets.join(', ')}`;
      healthCheck.status = 'degraded';
    }

    // Check AI provider configuration
    const aiProvider = process.env.AI_PROVIDER || 'anthropic';
    const aiKeyMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      gemini: 'GEMINI_API_KEY',
      openai: 'OPENAI_API_KEY',
    };

    const requiredAIKey = aiKeyMap[aiProvider];
    if (!requiredAIKey || !process.env[requiredAIKey]) {
      healthCheck.checks.ai.status = 'fail';
      healthCheck.checks.ai.message = `AI provider ${aiProvider} not configured (missing ${requiredAIKey})`;
      healthCheck.status = 'degraded';
    } else {
      healthCheck.checks.ai.message = `AI provider: ${aiProvider}`;
    }

    // Determine overall health status
    const failedChecks = Object.values(healthCheck.checks).filter(
      (check) => check.status === 'fail'
    );

    if (failedChecks.length >= 2) {
      healthCheck.status = 'unhealthy';
      return NextResponse.json(healthCheck, { status: 503 });
    } else if (failedChecks.length === 1) {
      healthCheck.status = 'degraded';
      return NextResponse.json(healthCheck, { status: 200 });
    }

    // All checks passed
    const duration = Date.now() - startTime;
    console.log(`Health check completed in ${duration}ms - Status: ${healthCheck.status}`);

    return NextResponse.json(healthCheck, { status: 200 });
  } catch (error) {
    console.error('Health check failed:', error);

    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        service: 'ai-writer',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    );
  }
}
