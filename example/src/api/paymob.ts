import Config from 'react-native-config';

/**
 * MOCK BACKEND.
 *
 * In a real integration the payment intention is created on YOUR server, which
 * holds the Paymob secret key, and only the returned `client_secret` is sent to
 * the app. This file fakes that server by calling Paymob's Intention API
 * directly from the device — do NOT do this in production, the secret key must
 * never be shipped inside the app.
 *
 * Mirrors the reference request:
 *   curl -X POST 'https://oman.paymob.com/v1/intention/' \
 *     -H 'Authorization: Token <secret_key>' \
 *     -H 'Content-Type: application/json' \
 *     --data-raw '{ "amount": 10, "currency": "OMR", ... }'
 */

const INTENTION_URL = 'https://oman.paymob.com/v1/intention/';
const CURRENCY = 'OMR';
// Integration id(s) enabled for this account (the card integration in the curl).
const PAYMENT_METHODS = [70072];

export interface CreateIntentionResult {
  clientSecret: string;
}

/**
 * Creates a payment intention for the given amount and returns its client
 * secret, which is used to initialise the Paymob SDK.
 *
 * @param amountOmr - Amount in OMR (major units, e.g. 1.5 = 1.500 OMR). It is
 *   converted to the smallest currency subunit (baisa, x1000) for the API.
 */
export async function createIntention(
  amountOmr: number
): Promise<CreateIntentionResult> {
  const secretKey = Config.PAYMOB_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      'PAYMOB_SECRET_KEY is not set in .env (rebuild the app after adding it).'
    );
  }

  // OMR has 3 decimal places; Paymob expects the amount in the smallest subunit.
  const amount = Math.round(amountOmr * 1000);

  const body = {
    amount,
    currency: CURRENCY,
    payment_methods: PAYMENT_METHODS,
    items: [],
    billing_data: {
      first_name: 'Test',
      last_name: 'Account',
      phone_number: '+96890000000',
      email: 'test@example.com',
    },
    extras: {},
    // Must be unique per intention, otherwise Paymob rejects duplicates.
    special_reference: `rn_demo_${Date.now()}`,
    expiration: 3600,
    notification_url: 'https://accept.paymob.com/api/acceptance/post_pay',
  };

  const response = await fetch(INTENTION_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Intention request failed (${response.status}): ${text.slice(0, 500)}`
    );
  }

  const data = JSON.parse(text) as { client_secret?: string };
  if (!data.client_secret) {
    throw new Error('Intention response did not include a client_secret.');
  }

  return { clientSecret: data.client_secret };
}
