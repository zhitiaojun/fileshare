/**
 * BurnClaimDO - Durable Object for atomic burn-after-reading claims.
 * Ensures only ONE download succeeds for a burn-after-read share,
 * even across multiple Cloudflare edge nodes.
 */
export class BurnClaimDO {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');

    if (!code) {
      return Response.json(
        { success: false, reason: 'missing_code' },
        { status: 400 }
      );
    }

    // Check in-memory set first (fast path)
    const storageKey = `burn:${code}`;

    // Check durable storage
    const existing = await this.state.storage.get<string>(storageKey);
    if (existing === 'claimed') {
      return Response.json(
        { success: false, reason: 'already_claimed' },
        { status: 409 }
      );
    }

    // Claim it atomically
    await this.state.storage.put(storageKey, 'claimed');

    return Response.json({ success: true });
  }
}

export default BurnClaimDO;
