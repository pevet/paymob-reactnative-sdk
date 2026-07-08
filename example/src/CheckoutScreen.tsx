import { useEffect, useRef, useState } from 'react';
import Config from 'react-native-config';
import {
  ActivityIndicator,
  Alert,
  Button,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  PaymobCheckoutView,
  type PaymobCheckoutViewRef,
} from 'paymob-reactnative';
import {
  createIntention,
  getTransactionResult,
  type TransactionResult,
} from './api/paymob';

// walletii by Ooredoo brand logo, shown in our own header banner (the embedded
// Paymob element has no merchant name/icon field, so we brand around it).
const walletiiLogo = require('./assets/walletii-logo.png');

type SavedCardInfo = {
  maskedPan?: string;
  cardType?: string;
  token?: string;
};

// A saved card may come back nested (e.g. `savedCard`) or as flat fields, and
// key casing differs across platforms, so probe the known variants.
function extractSavedCard(details: any): SavedCardInfo | null {
  if (!details || typeof details !== 'object') {
    return null;
  }
  const nested =
    details.savedCard ?? details.saved_card ?? details.savedBankCard;
  const src = nested && typeof nested === 'object' ? nested : details;

  const maskedPan = src.maskedPan ?? src.maskedPanNumber ?? src.masked_pan;
  const token = src.token ?? src.cardToken ?? src.card_token;
  const cardType =
    src.cardType ?? src.creditCard ?? src.cardSubtype ?? src.card_subtype;

  if (maskedPan || token) {
    return { maskedPan, cardType, token };
  }
  return null;
}

// Poll the backend for the authoritative (webhook-sourced) result. Two webhooks
// arrive independently: TRANSACTION (status) and TOKEN (saved card), with the
// TOKEN typically a few seconds behind. So we return as soon as a saved card is
// present, but once the status alone has settled we keep polling for a short
// grace window to give the TOKEN time to arrive before giving up on the card.
async function pollBackendResult(
  reference: string
): Promise<TransactionResult | null> {
  const MAX_CYCLES = 14; // ~21s ceiling
  const GRACE_AFTER_TERMINAL = 5; // ~7.5s extra to wait for the TOKEN
  const isTerminal = (s?: string) =>
    s === 'Success' || s === 'Failed' || s === 'Pending';

  let terminalSince = -1;
  let last: TransactionResult | null = null;
  for (let i = 0; i < MAX_CYCLES; i++) {
    try {
      const r = await getTransactionResult(reference);
      last = r;
      if (r.found) {
        if (r.savedCard) {
          return r; // best case: status + saved card both present
        }
        if (isTerminal(r.status)) {
          if (terminalSince < 0) {
            terminalSince = i;
          }
          if (i - terminalSince >= GRACE_AFTER_TERMINAL) {
            return r; // settled, but no card arrived (likely not saved)
          }
        }
      }
    } catch {
      // ignore and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return last;
}

// Inline (embedded) checkout theming. Colors are hex strings.
//
// IMPORTANT: the native iOS SDK decodes this JSON with
// Title_Case_With_Underscores keys (e.g. `Color_Primary`), which differ from
// the Android SDK's camelCase keys (e.g. `colorPrimary`). This example targets
// iOS, so the iOS key names are used here.
const CUSTOMIZATION: Record<string, string> = {
  Color_Primary: '#07F0D7', // payment button background (active)
  Color_Disabled: '#C7CDD1', // payment button background (inactive/disabled)
  Text_Color_For_Payment_Button: '#051926', // payment button text
  Radius_Border: '8',
  Payment_Button_Title: 'Pay now',
};

export default function CheckoutScreen() {
  const checkoutRef = useRef<PaymobCheckoutViewRef>(null);
  const referenceRef = useRef<string | null>(null);
  const [amount, setAmount] = useState<string>('1.500');
  const [loading, setLoading] = useState<boolean>(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const publicKey = Config.PAYMOB_PUBLIC_KEY ?? '';

  // Once we have a client secret the checkout mounts; configure it, then set the
  // keys to load the payment form.
  useEffect(() => {
    if (!clientSecret) {
      return;
    }
    checkoutRef.current?.configure({
      uiCustomization: JSON.stringify(CUSTOMIZATION),
      showAddNewCard: true,
      showSaveCard: true,
      saveCardByDefault: false,
      payFromOutside: false,
    });
    checkoutRef.current?.setPaymentKeys({ publicKey, clientSecret });
  }, [clientSecret, publicKey]);

  const handlePay = async () => {
    // Accept both '.' and ',' as the decimal separator regardless of the
    // device's locale/region, then parse against a fixed '.'-based format.
    const normalized = amount.trim().replace(',', '.');
    const amountOmr = parseFloat(normalized);
    if (!Number.isFinite(amountOmr) || amountOmr <= 0) {
      Alert.alert('Invalid amount', 'Please enter an amount greater than 0.');
      return;
    }

    setLoading(true);
    try {
      // Backend creates the intention (with the secret key) and returns the
      // client secret plus a reference we use to look up the result later.
      const { clientSecret: secret, reference } =
        await createIntention(amountOmr);
      referenceRef.current = reference;
      setClientSecret(secret);
    } catch (error: any) {
      Alert.alert('Could not start payment', error?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    referenceRef.current = null;
    setClientSecret(null);
    setAmount('1.500');
  };

  const handleSuccess = async (event: any) => {
    // Prefer the authoritative, webhook-sourced result from the backend; fall
    // back to the in-app callback payload if the webhook hasn't arrived (e.g.
    // no public tunnel configured).
    const reference = referenceRef.current;
    const backend = reference ? await pollBackendResult(reference) : null;
    const confirmed = !!backend?.found && backend.status !== 'Created';

    const card =
      (backend?.savedCard as SavedCardInfo | null | undefined) ??
      extractSavedCard(event?.nativeEvent);
    const source = confirmed
      ? 'confirmed by backend'
      : 'device (webhook pending)';

    if (card && (card.maskedPan || card.token)) {
      const lines = [
        card.maskedPan ? `Card: ${card.maskedPan}` : null,
        card.cardType ? `Type: ${card.cardType}` : null,
        card.token ? `Token: ${card.token}` : null,
      ]
        .filter(Boolean)
        .join('\n');
      Alert.alert('Payment successful', `Saved card\n${lines}\n\n(${source})`);
    } else {
      Alert.alert(
        'Payment successful',
        `Your payment was completed.\n\n(${source})`
      );
    }
  };

  const handleFailure = (event: any) => {
    const reason = event?.nativeEvent?.error;
    Alert.alert(
      'Payment failed',
      reason ? `Reason: ${reason}` : 'The payment was rejected.'
    );
  };

  const handlePending = () => {
    Alert.alert('Payment pending', 'Your payment is being processed.');
  };

  return (
    <View style={styles.container}>
      <View style={styles.banner}>
        <Image style={styles.logo} source={walletiiLogo} resizeMode="contain" />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.label}>Amount (OMR)</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          editable={!clientSecret && !loading}
          keyboardType="decimal-pad"
          placeholder="e.g. 1.500"
        />

        {!clientSecret ? (
          <View style={styles.payButton}>
            {loading ? (
              <ActivityIndicator size="large" color="#000000" />
            ) : (
              <Button title="Pay" onPress={handlePay} color="#000000" />
            )}
          </View>
        ) : (
          <>
            <PaymobCheckoutView
              ref={checkoutRef}
              style={styles.embedded}
              onSuccess={handleSuccess}
              onFailure={handleFailure}
              onPending={handlePending}
            />
            <View style={styles.resetButton}>
              <Button title="Start over" onPress={reset} color="#888888" />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  content: {
    padding: 24,
  },
  banner: {
    backgroundColor: '#0A1925',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  logo: {
    height: 48,
    width: 160,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 18,
    marginBottom: 24,
  },
  payButton: {
    minHeight: 48,
    justifyContent: 'center',
  },
  embedded: {
    width: '100%',
    marginBottom: 16,
  },
  resetButton: {
    marginTop: 8,
  },
});
