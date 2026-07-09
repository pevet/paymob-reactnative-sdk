import Config from 'react-native-config';

/**
 * Talks to the demo backend (example/server), NOT to Paymob directly. The
 * backend holds the secret key, creates the intention, receives Paymob's
 * webhook, and exposes the authoritative result for a transaction.
 *
 * The iOS simulator reaches the Mac host at localhost, so the default backend
 * URL is http://localhost:3000 (allowed by NSAllowsLocalNetworking).
 */
const BACKEND_URL = (
  Config.PAYMOB_BACKEND_URL ?? 'http://localhost:3000'
).replace(/\/$/, '');

export interface SavedCard {
  token?: string;
  maskedPan?: string;
  cardType?: string;
  nickname?: string | null;
  order?: number | null;
  email?: string | null;
  reference?: string | null;
  receivedAt?: string;
}

/** Persists the display order of saved cards (tokens, top to bottom). */
export async function reorderSavedCards(
  tokens: string[]
): Promise<SavedCard[]> {
  const response = await fetch(`${BACKEND_URL}/saved-cards/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokens }),
  });
  if (!response.ok) {
    throw new Error(`Reorder failed (${response.status})`);
  }
  return (await response.json()) as SavedCard[];
}

/** Sets (or clears, with an empty string) a saved card's nickname. */
export async function updateSavedCard(
  token: string,
  nickname: string
): Promise<SavedCard> {
  const response = await fetch(
    `${BACKEND_URL}/saved-cards/${encodeURIComponent(token)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname }),
    }
  );
  if (!response.ok) {
    throw new Error(`Update failed (${response.status})`);
  }
  return (await response.json()) as SavedCard;
}

/** Lists the saved cards known to the backend. */
export async function getSavedCards(): Promise<SavedCard[]> {
  const response = await fetch(`${BACKEND_URL}/saved-cards`);
  if (!response.ok) {
    throw new Error(`Saved cards lookup failed (${response.status})`);
  }
  return (await response.json()) as SavedCard[];
}

/** Deletes a saved card. */
export async function deleteSavedCard(token: string): Promise<void> {
  const response = await fetch(
    `${BACKEND_URL}/saved-cards/${encodeURIComponent(token)}`,
    { method: 'DELETE' }
  );
  if (!response.ok) {
    throw new Error(`Delete failed (${response.status})`);
  }
}

export interface CreateIntentionResult {
  clientSecret: string;
  reference: string;
  savedCards: SavedCard[];
}

/**
 * Asks the backend to create a payment intention for the given amount (OMR).
 * Returns the client secret used to initialise the SDK, a reference the app
 * uses to look up the authoritative result later, and the saved cards known to
 * the backend.
 */
export async function createIntention(
  amountOmr: number
): Promise<CreateIntentionResult> {
  const response = await fetch(`${BACKEND_URL}/intentions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountOmr }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Create intention failed (${response.status}): ${text.slice(0, 300)}`
    );
  }
  const data = JSON.parse(text) as {
    clientSecret?: string;
    reference?: string;
    savedCards?: SavedCard[];
  };
  if (!data.clientSecret || !data.reference) {
    throw new Error('Backend did not return a clientSecret/reference.');
  }
  return {
    clientSecret: data.clientSecret,
    reference: data.reference,
    savedCards: data.savedCards ?? [],
  };
}

export interface TransactionResult {
  found: boolean;
  status?: string;
  transactionId?: number | null;
  amountCents?: number | null;
  savedCard?: SavedCard | null;
}

/**
 * Looks up the authoritative transaction result (populated by Paymob's webhook)
 * for a reference. Returns `{ found: false }` if the backend has nothing yet.
 */
export async function getTransactionResult(
  reference: string
): Promise<TransactionResult> {
  const response = await fetch(
    `${BACKEND_URL}/tx/${encodeURIComponent(reference)}`
  );
  if (!response.ok) {
    throw new Error(`Result lookup failed (${response.status})`);
  }
  return (await response.json()) as TransactionResult;
}
