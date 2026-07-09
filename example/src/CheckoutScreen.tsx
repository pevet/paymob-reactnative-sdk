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
  TouchableOpacity,
  View,
} from 'react-native';
import {
  PaymobCheckoutView,
  type PaymobCheckoutViewRef,
} from 'paymob-reactnative';
import {
  createIntention,
  getTransactionResult,
  type SavedCard,
  type TransactionResult,
} from './api/paymob';

// walletii by Ooredoo brand logo, shown on the checkout screen's header banner.
const walletiiLogo = require('./assets/walletii-logo.png');

const RIAL = '﷼'; // Omani Rial sign ﷼
const FLAG = '🇴🇲'; // 🇴🇲
const QUICK_ADD = [5, 10, 15, 20];
const CURRENT_BALANCE = '163.100'; // cosmetic demo balance

// The rial glyph is Arabic (RTL); wrap it in an LTR isolate so it stays before
// the number (e.g. "﷼ 5") instead of being reordered after it.
const money = (v: string | number) => `⁦${RIAL}⁩ ${v}`;

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
  Color_Container: '#FFF8E1', // embedded element background (gentle yellow)
  Color_Primary: '#07F0D7', // payment button background (active)
  Color_Disabled: '#C7CDD1', // payment button background (inactive/disabled)
  Text_Color_For_Payment_Button: '#051926', // payment button text
  Radius_Border: '8',
  Payment_Button_Title: 'Continue',
};

export default function CheckoutScreen() {
  const checkoutRef = useRef<PaymobCheckoutViewRef>(null);
  const referenceRef = useRef<string | null>(null);
  const [amountText, setAmountText] = useState<string>('5');
  const [loading, setLoading] = useState<boolean>(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);

  // Accepts '.' or ',' as the decimal separator regardless of device locale.
  const amount = parseFloat(amountText.replace(',', '.')) || 0;

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

  const handleContinue = async () => {
    if (amount <= 0) {
      Alert.alert('Choose an amount', 'Add an amount to top up first.');
      return;
    }

    setLoading(true);
    try {
      // Backend creates the intention (with the secret key) and returns the
      // client secret, a reference we use to look up the result later, and the
      // saved cards it knows about.
      const {
        clientSecret: secret,
        reference,
        savedCards: cards,
      } = await createIntention(amount);
      referenceRef.current = reference;
      setSavedCards(cards);
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
    setSavedCards([]);
    setAmountText('5');
  };

  const addAmount = (v: number) => {
    setAmountText(String(Math.round((amount + v) * 1000) / 1000));
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

  // ---- Checkout screen (after Continue) ------------------------------------
  if (clientSecret) {
    return (
      <View style={styles.container}>
        <View style={styles.banner}>
          <Image
            style={styles.logo}
            source={walletiiLogo}
            resizeMode="contain"
          />
        </View>
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.checkoutContent}
          keyboardShouldPersistTaps="handled"
        >
          {savedCards.length > 0 && (
            <View style={styles.savedCards}>
              <Text style={styles.savedCardsTitle}>Saved cards</Text>
              {savedCards.map((c, i) => (
                <View key={c.token ?? String(i)} style={styles.savedCardRow}>
                  <Text style={styles.savedCardType}>
                    {c.cardType ?? 'Card'}
                  </Text>
                  <Text style={styles.savedCardPan}>{c.maskedPan ?? ''}</Text>
                </View>
              ))}
            </View>
          )}
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
        </ScrollView>
      </View>
    );
  }

  // ---- Top-up screen (first screen) ----------------------------------------
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.back} accessibilityLabel="Back">
          <Text style={styles.backChevron}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Debit card</Text>
      </View>

      <Text style={styles.subtitle}>
        It’s <Text style={styles.subtitleBold}>free of charge</Text> and we
        accept all local debit cards
      </Text>

      <View style={styles.cardWrap}>
        <View style={styles.amountCard}>
          <TextInput
            style={styles.amountInput}
            value={amountText}
            onChangeText={(t) => setAmountText(t.replace(/[^0-9.,]/g, ''))}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor="#c4c4c4"
            selectTextOnFocus
          />
          <View style={styles.currencyRow}>
            <Text style={styles.flag}>{FLAG}</Text>
            <Text style={styles.rial}>{RIAL}</Text>
          </View>
        </View>
        <View style={styles.balanceBar}>
          <Text style={styles.balanceText}>
            {`Current balance: ${money(CURRENT_BALANCE)}`}
          </Text>
        </View>
      </View>

      <View style={styles.chips}>
        {QUICK_ADD.map((v) => (
          <TouchableOpacity
            key={v}
            style={styles.chip}
            onPress={() => addAmount(v)}
          >
            <Text style={styles.chipText}>{`+ ${money(v)}`}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.spacer} />

      <View style={styles.secureNote}>
        <View style={styles.shield}>
          <Text style={styles.shieldCheck}>✓</Text>
        </View>
        <Text style={styles.secureText}>
          You will be redirected to a secure payment page to enter your card
          details.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.continueBtn, amount <= 0 && styles.continueBtnDisabled]}
        onPress={handleContinue}
        disabled={loading || amount <= 0}
      >
        {loading ? (
          <ActivityIndicator color="#051926" />
        ) : (
          <Text style={styles.continueText}>Continue</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },

  // top-up screen
  screen: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingBottom: 12,
  },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  back: {
    position: 'absolute',
    left: 18,
    top: 6,
    bottom: 6,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  backChevron: {
    fontSize: 30,
    color: '#111111',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111111',
  },
  subtitle: {
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 22,
    color: '#1a1a1a',
    marginHorizontal: 28,
    marginTop: 6,
  },
  subtitleBold: {
    fontWeight: '700',
  },
  cardWrap: {
    marginHorizontal: 20,
    marginTop: 28,
  },
  amountCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingVertical: 44,
    alignItems: 'center',
    zIndex: 2,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  amountInput: {
    alignSelf: 'stretch',
    textAlign: 'center',
    fontSize: 68,
    fontWeight: '800',
    color: '#111111',
    letterSpacing: -1,
    padding: 0,
  },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  flag: {
    fontSize: 20,
  },
  rial: {
    fontSize: 20,
    color: '#111111',
  },
  balanceBar: {
    backgroundColor: '#D3F500',
    borderRadius: 24,
    marginTop: -28,
    paddingTop: 42,
    paddingBottom: 18,
    alignItems: 'center',
    zIndex: 1,
  },
  balanceText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
    writingDirection: 'ltr',
  },
  chips: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 22,
    gap: 10,
  },
  chip: {
    flex: 1,
    backgroundColor: '#efefef',
    borderRadius: 22,
    paddingVertical: 12,
    alignItems: 'center',
  },
  chipText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111111',
    writingDirection: 'ltr',
  },
  spacer: {
    flex: 1,
  },
  secureNote: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginBottom: 16,
    gap: 10,
  },
  shield: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: '#07F0D7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shieldCheck: {
    fontSize: 16,
    fontWeight: '700',
    color: '#051926',
  },
  secureText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#6b6b6b',
  },
  continueBtn: {
    marginHorizontal: 20,
    minHeight: 58,
    borderRadius: 30,
    backgroundColor: '#07F0D7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnDisabled: {
    backgroundColor: '#C7CDD1',
  },
  continueText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#051926',
  },

  // checkout screen
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
  checkoutContent: {
    padding: 24,
  },
  savedCards: {
    marginBottom: 20,
  },
  savedCardsTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  savedCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#fafafa',
  },
  savedCardType: {
    fontSize: 15,
    fontWeight: '600',
    color: '#051926',
  },
  savedCardPan: {
    fontSize: 15,
    color: '#555555',
  },
  embedded: {
    width: '100%',
    marginBottom: 16,
  },
  resetButton: {
    marginTop: 8,
  },
});
