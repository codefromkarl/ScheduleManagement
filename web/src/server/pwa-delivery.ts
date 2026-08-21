export type PwaSubscriptionTarget = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PwaSend = (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;

export type PwaDeliveryResult = {
  acceptedIds: string[];
  staleIds: string[];
  errors: string[];
};

function statusCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return undefined;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function deliverPwaPayload(targets: PwaSubscriptionTarget[], payload: string, send: PwaSend): Promise<PwaDeliveryResult> {
  const result: PwaDeliveryResult = { acceptedIds: [], staleIds: [], errors: [] };
  await Promise.all(targets.map(async (target) => {
    try {
      await send({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload);
      result.acceptedIds.push(target.id);
    } catch (error) {
      const code = statusCode(error);
      if (code === 404 || code === 410) {
        result.staleIds.push(target.id);
      } else {
        result.errors.push(errorMessage(error));
      }
    }
  }));
  result.acceptedIds.sort();
  result.staleIds.sort();
  result.errors.sort();
  return result;
}
