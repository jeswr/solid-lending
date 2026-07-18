import {
  DevSeedUnavailableError,
  DevSeedUnconfiguredError,
  runDevSeed,
} from "../../../../lib/server/dev-seed";

/**
 * The wallet's dev-gated "Mode-1" seed endpoint (sm-qz3j): seeds Maya Torres's real
 * signed lending-credential pod, triggered from the browser page at `/dev/seed`. Fails
 * closed exactly like the sample pod route (`../pod/example/route.ts`): 404 outside
 * development, 503 while the seed target is unconfigured — never picks a default pod.
 */
export async function POST(): Promise<Response> {
  try {
    const seeded = await runDevSeed();
    return Response.json({
      persona: seeded.persona.name,
      webid: seeded.webid,
      baseUrl: seeded.baseUrl,
      resources: seeded.manifest.pods.flatMap((pod) =>
        pod.resources.map((resource) => ({ url: resource.url, status: resource.status })),
      ),
    });
  } catch (error) {
    if (error instanceof DevSeedUnavailableError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof DevSeedUnconfiguredError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
