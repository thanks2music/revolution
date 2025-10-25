/**
 * ヘルスチェックエンドポイント
 * Cloud Run のヘルスチェックとDockerのHEALTHCHECKで使用
 */
export async function GET() {
  return Response.json(
    {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'ai-writer',
    },
    { status: 200 }
  );
}
