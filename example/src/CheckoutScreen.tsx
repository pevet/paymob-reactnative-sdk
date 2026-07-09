import { useEffect, useRef, useState } from 'react';
import Config from 'react-native-config';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Button,
  Image,
  Modal,
  PanResponder,
  Platform,
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
  deleteSavedCard,
  getSavedCards,
  getTransactionResult,
  reorderSavedCards,
  updateSavedCard,
  type SavedCard,
  type TransactionResult,
} from './api/paymob';

// walletii by Ooredoo brand logo, shown on the checkout screen's header banner.
const walletiiLogo = require('./assets/walletii-logo.png');

const RIAL = '﷼'; // Omani Rial sign ﷼
const FLAG = '🇴🇲'; // 🇴🇲
const QUICK_ADD = [5, 10, 15, 20];
const BASE_BALANCE = 163.1; // cosmetic demo balance (OMR), shown before top-up
const SAVED_CARD_ROW_H = 60; // saved-card tile height + gap (for drag math)

type Flow = 'embedded' | 'saved';
type Screen = 'select' | 'topup';
// A selection is a card token, the sentinel 'new', or null (nothing chosen).
type Selection = string | 'new' | null;

// The rial glyph is Arabic (RTL); wrap it in an LTR isolate so it stays before
// the number (e.g. "﷼ 5") instead of being reordered after it.
const money = (v: string | number) => `⁦${RIAL}⁩ ${v}`;

// Compact masked pan for the tiles, e.g. "•••• 2346".
const last4 = (pan?: string) => {
  const digits = (pan ?? '').replace(/\D/g, '');
  return digits ? `•••• ${digits.slice(-4)}` : (pan ?? '');
};

// Small brand mark drawn from views (no icon library): Mastercard's two
// overlapping circles, a "VISA" wordmark, or a neutral card for anything else.
function CardBrandIcon({ type }: { type?: string }) {
  const t = (type ?? '').toLowerCase();
  if (t.includes('master')) {
    return (
      <View style={styles.brand}>
        <View style={[styles.mcCircle, styles.mcRed]} />
        <View style={[styles.mcCircle, styles.mcYellow]} />
      </View>
    );
  }
  if (t.includes('visa')) {
    return (
      <View style={styles.brand}>
        <Text style={styles.visaText}>VISA</Text>
      </View>
    );
  }
  return <View style={[styles.brand, styles.brandGeneric]} />;
}

// Blocking "payment in progress" overlay shown while awaiting confirmation.
function ProcessingModal({ visible }: { visible: boolean }) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.processingOverlay}>
        <View style={styles.processingCard}>
          <ActivityIndicator size="large" color="#07F0D7" />
          <Text style={styles.processingText}>Payment in progress…</Text>
        </View>
      </View>
    </Modal>
  );
}

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
// IMPORTANT: the two native SDKs decode this JSON with different key casing —
// iOS uses Title_Case_With_Underscores (e.g. `Color_Primary`), Android uses
// camelCase (e.g. `colorPrimary`, matching the AAR's UiCustomizationEmbedded).
// Same values, keyed per platform so the theme applies on both.
const CUSTOMIZATION = Platform.select<Record<string, string>>({
  ios: {
    Color_Container: '#FFF8E1', // embedded element background (gentle yellow)
    Color_Primary: '#07F0D7', // payment button background (active)
    Color_Disabled: '#C7CDD1', // payment button background (inactive/disabled)
    Text_Color_For_Payment_Button: '#051926', // payment button text
    Radius_Border: '8',
    Payment_Button_Title: 'Continue',
  },
  default: {
    colorContainer: '#FFF8E1',
    colorPrimary: '#07F0D7',
    colorDisabled: '#C7CDD1',
    textColorForPaymentButton: '#051926',
    radiusBorder: '8',
    paymentButtonTitle: 'Continue',
  },
});

export default function CheckoutScreen() {
  const checkoutRef = useRef<PaymobCheckoutViewRef>(null);
  const referenceRef = useRef<string | null>(null);
  const [screen, setScreen] = useState<Screen>('select');
  const [flow, setFlow] = useState<Flow>('embedded');
  const [amountText, setAmountText] = useState<string>('');
  const [agreed, setAgreed] = useState<boolean>(false);
  const [selected, setSelected] = useState<Selection>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [processing, setProcessing] = useState<boolean>(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [editingCard, setEditingCard] = useState<SavedCard | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState<string>('');

  // Accepts '.' or ',' as the decimal separator regardless of device locale.
  const amount = parseFloat(amountText.replace(',', '.')) || 0;
  // Balance preview decreases by the entered amount (shows the base on load).
  const balance = (BASE_BALANCE - amount).toFixed(3);
  const hasSelection = flow === 'embedded' || selected != null;
  const canContinue = amount > 0 && agreed && hasSelection;

  const publicKey = Config.PAYMOB_PUBLIC_KEY ?? '';

  // Once we have a client secret the checkout mounts; configure it, then set the
  // keys to load the payment form. When the app-driven flow scoped the intention
  // to one saved card, hide the "add new card" form so only that card shows.
  const scopedToSavedCard =
    flow === 'saved' && !!selected && selected !== 'new';
  useEffect(() => {
    if (!clientSecret) {
      return;
    }
    checkoutRef.current?.configure({
      uiCustomization: JSON.stringify(CUSTOMIZATION),
      showAddNewCard: !scopedToSavedCard,
      showSaveCard: true,
      saveCardByDefault: false,
      payFromOutside: false,
    });
    checkoutRef.current?.setPaymentKeys({ publicKey, clientSecret });
  }, [clientSecret, publicKey, scopedToSavedCard]);

  // Load saved cards whenever we're on the top-up screen (not the element).
  useEffect(() => {
    if (screen !== 'topup' || clientSecret) {
      return;
    }
    let active = true;
    getSavedCards()
      .then((cards) => {
        if (!active) {
          return;
        }
        setSavedCards(cards);
        // App-driven flow: pre-select the first saved card, or "New card" if
        // there are none. Don't override a choice the user already made.
        if (flow === 'saved') {
          setSelected((prev) => prev ?? cards[0]?.token ?? 'new');
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [screen, clientSecret, flow]);

  const goToSelect = () => {
    referenceRef.current = null;
    setClientSecret(null);
    setSelected(null);
    setPickerOpen(false);
    setAmountText('');
    setAgreed(false);
    setScreen('select');
  };

  const chooseFlow = (f: Flow) => {
    setFlow(f);
    setSelected(null);
    setPickerOpen(false);
    setAmountText('');
    setAgreed(false);
    setScreen('topup');
  };

  // Choose a saved card (or "New card") from the dropdown and close it.
  const pickCard = (sel: Selection) => {
    setSelected(sel);
    setPickerOpen(false);
  };

  // Open the embedded checkout. `cardTokens` scopes which saved cards it shows:
  // undefined = all (embedded flow), [token] = only that card (saved flow), and
  // [] = new card only.
  const startEmbedded = async (cardTokens?: string[]) => {
    setLoading(true);
    try {
      const { clientSecret: secret, reference } = await createIntention(
        amount,
        cardTokens
      );
      referenceRef.current = reference;
      setClientSecret(secret);
    } catch (error: any) {
      Alert.alert('Could not start payment', error?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = () => {
    if (!canContinue) {
      return;
    }
    if (flow === 'saved') {
      // Scope the checkout to the chosen saved card, or to a new card only.
      startEmbedded(selected && selected !== 'new' ? [selected] : []);
    } else {
      startEmbedded(); // embedded flow: all saved cards
    }
  };

  // Show the result popup; confirming it (OK) restarts at the flow selector.
  const showResult = (
    status: string | undefined,
    card: SavedCardInfo | null,
    source: string
  ) => {
    const ok = [{ text: 'OK', onPress: goToSelect }];
    if (status === 'Failed') {
      Alert.alert(
        'Payment failed',
        `The payment was rejected.\n\n(${source})`,
        ok
      );
      return;
    }
    if (status === 'Pending') {
      Alert.alert(
        'Payment pending',
        `Your payment is being processed.\n\n(${source})`,
        ok
      );
      return;
    }
    if (card && (card.maskedPan || card.token)) {
      const lines = [
        card.maskedPan ? `Card: ${card.maskedPan}` : null,
        card.cardType ? `Type: ${card.cardType}` : null,
        card.token ? `Token: ${card.token}` : null,
      ]
        .filter(Boolean)
        .join('\n');
      Alert.alert(
        'Payment successful',
        `Saved card\n${lines}\n\n(${source})`,
        ok
      );
    } else {
      Alert.alert(
        'Payment successful',
        `Your payment was completed.\n\n(${source})`,
        ok
      );
    }
  };

  const addAmount = (v: number) => {
    setAmountText(String(Math.round((amount + v) * 1000) / 1000));
  };

  // --- Drag to reorder saved cards ------------------------------------------
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;

  const makeDragResponder = (index: number) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setDragIndex(index);
        dragY.setValue(0);
      },
      onPanResponderMove: (_e, g) => dragY.setValue(g.dy),
      onPanResponderRelease: (_e, g) => {
        const delta = Math.round(g.dy / SAVED_CARD_ROW_H);
        setSavedCards((prev) => {
          const to = Math.max(0, Math.min(prev.length - 1, index + delta));
          if (to === index) {
            return prev;
          }
          const next = prev.slice();
          const [moved] = next.splice(index, 1);
          if (!moved) {
            return prev;
          }
          next.splice(to, 0, moved);
          reorderSavedCards(
            next.map((c) => c.token).filter((t): t is string => !!t)
          ).catch(() => {});
          return next;
        });
        setDragIndex(null);
        dragY.setValue(0);
      },
      onPanResponderTerminate: () => {
        setDragIndex(null);
        dragY.setValue(0);
      },
    });

  const renameCard = async (card: SavedCard, nickname: string) => {
    if (!card.token) {
      return;
    }
    try {
      const updated = await updateSavedCard(card.token, nickname.trim());
      setSavedCards((cards) =>
        cards.map((c) =>
          c.token === card.token ? { ...c, nickname: updated.nickname } : c
        )
      );
    } catch (e: any) {
      Alert.alert('Could not update card', e?.message ?? 'Unknown error');
    }
  };

  const removeCard = async (card: SavedCard) => {
    if (!card.token) {
      return;
    }
    try {
      await deleteSavedCard(card.token);
      setSavedCards((cards) => cards.filter((c) => c.token !== card.token));
      if (selected === card.token) {
        setSelected(null);
      }
    } catch (e: any) {
      Alert.alert('Could not delete card', e?.message ?? 'Unknown error');
    }
  };

  // Open the rename/delete sheet. Uses a cross-platform Modal (not Alert.prompt,
  // which is iOS-only) so the same UI works on Android.
  const openEditCard = (card: SavedCard) => {
    setEditingCard(card);
    setNicknameDraft(card.nickname ?? '');
  };

  const closeEditCard = () => {
    setEditingCard(null);
    setNicknameDraft('');
  };

  const saveEditCard = () => {
    if (editingCard) {
      renameCard(editingCard, nicknameDraft);
    }
    closeEditCard();
  };

  const deleteEditCard = () => {
    const card = editingCard;
    closeEditCard();
    if (card) {
      removeCard(card);
    }
  };

  const handleSuccess = async (event: any) => {
    // Show the in-progress popup while we wait for the backend (webhook) to
    // confirm the transaction, then replace it with the result popup.
    setProcessing(true);
    const reference = referenceRef.current;
    const backend = reference ? await pollBackendResult(reference) : null;
    const confirmed = !!backend?.found && backend.status !== 'Created';
    const card =
      (backend?.savedCard as SavedCardInfo | null | undefined) ??
      extractSavedCard(event?.nativeEvent);
    setProcessing(false);
    showResult(
      backend?.status ?? 'Success',
      card ?? null,
      confirmed ? 'confirmed by backend' : 'device (webhook pending)'
    );
  };

  const handleFailure = (event: any) => {
    setProcessing(false);
    const reason = event?.nativeEvent?.error;
    Alert.alert(
      'Payment failed',
      reason ? `Reason: ${reason}` : 'The payment was rejected.',
      [{ text: 'OK', onPress: goToSelect }]
    );
  };

  const handlePending = () => {
    setProcessing(false);
    Alert.alert('Payment pending', 'Your payment is being processed.', [
      { text: 'OK', onPress: goToSelect },
    ]);
  };

  // ---- Flow selection (first screen) ---------------------------------------
  if (screen === 'select') {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Top up</Text>
        </View>
        <Text style={styles.subtitle}>Choose how you’d like to pay</Text>
        <View style={styles.selectWrap}>
          <TouchableOpacity
            style={styles.selectCard}
            onPress={() => chooseFlow('embedded')}
            activeOpacity={0.85}
          >
            <Text style={styles.selectTitle}>Paymob checkout</Text>
            <Text style={styles.selectDesc}>
              Pay with Paymob’s secure embedded element (saved cards and new
              card).
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.selectCard}
            onPress={() => chooseFlow('saved')}
            activeOpacity={0.85}
          >
            <Text style={styles.selectTitle}>Saved cards</Text>
            <Text style={styles.selectDesc}>
              Pick one of your saved cards (or a new card) and pay in-app.
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ---- Embedded checkout screen (after Continue) ---------------------------
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
        <View style={[styles.container, styles.checkoutContent]}>
          <PaymobCheckoutView
            ref={checkoutRef}
            style={styles.embedded}
            onSuccess={handleSuccess}
            onFailure={handleFailure}
            onPending={handlePending}
          />
          <View style={styles.resetButton}>
            <Button title="Start over" onPress={goToSelect} color="#888888" />
          </View>
        </View>
        <ProcessingModal visible={processing} />
      </View>
    );
  }

  // ---- Top-up screen -------------------------------------------------------
  const showCards = flow === 'saved' || savedCards.length > 0;
  const selectedCard = savedCards.find((c) => c.token === selected) ?? null;
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.back}
          onPress={goToSelect}
          accessibilityLabel="Back"
        >
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
            {`Current balance: ${money(balance)}`}
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

      {showCards && (
        <View style={styles.savedCards}>
          <View style={styles.savedCardsHeader}>
            <Text style={styles.savedCardsTitle}>
              {flow === 'saved' ? 'Pay with' : 'Saved cards'}
            </Text>
            {flow === 'embedded' && savedCards.length > 1 && (
              <Text style={styles.savedCardsHint}>≡ drag to reorder</Text>
            )}
          </View>

          {flow === 'saved' ? (
            // App-driven flow: a dropdown whose closed state shows the selected
            // card; tapping it reveals the saved cards plus a "New card" option.
            <View>
              <TouchableOpacity
                style={[
                  styles.dropdownTrigger,
                  pickerOpen && styles.dropdownTriggerOpen,
                ]}
                activeOpacity={0.7}
                onPress={() => setPickerOpen((o) => !o)}
                accessibilityRole="button"
                accessibilityLabel="Select a card to pay with"
              >
                <View style={styles.savedCardLeft}>
                  {selected === 'new' ? (
                    <Text style={styles.newCardText}>+ New card</Text>
                  ) : selectedCard ? (
                    <>
                      <CardBrandIcon type={selectedCard.cardType} />
                      <Text style={styles.savedCardType} numberOfLines={1}>
                        {selectedCard.nickname ||
                          selectedCard.cardType ||
                          'Card'}
                      </Text>
                      <Text style={styles.savedCardPan}>
                        {last4(selectedCard.maskedPan)}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.dropdownPlaceholder}>
                      Select a card
                    </Text>
                  )}
                </View>
                <Text style={styles.caret}>{pickerOpen ? '▲' : '▾'}</Text>
              </TouchableOpacity>

              {pickerOpen && (
                <View style={styles.dropdownPanel}>
                  {savedCards.map((c, i) => {
                    const isSel = selected === c.token;
                    return (
                      <View
                        key={c.token ?? String(i)}
                        style={[
                          styles.dropdownOption,
                          isSel && styles.rowSelected,
                        ]}
                      >
                        <TouchableOpacity
                          style={styles.savedCardLeft}
                          activeOpacity={0.7}
                          onPress={() => pickCard(c.token ?? null)}
                        >
                          <CardBrandIcon type={c.cardType} />
                          <Text style={styles.savedCardType} numberOfLines={1}>
                            {c.nickname || c.cardType || 'Card'}
                          </Text>
                        </TouchableOpacity>
                        <View style={styles.savedCardRight}>
                          <Text style={styles.savedCardPan}>
                            {last4(c.maskedPan)}
                          </Text>
                          {isSel && <Text style={styles.optionCheck}>✓</Text>}
                          <TouchableOpacity
                            style={styles.editBtn}
                            onPress={() => openEditCard(c)}
                            accessibilityLabel="Edit card"
                          >
                            <Text style={styles.editIcon}>✎</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                  <TouchableOpacity
                    style={[
                      styles.dropdownOption,
                      styles.dropdownOptionLast,
                      selected === 'new' && styles.rowSelected,
                    ]}
                    activeOpacity={0.7}
                    onPress={() => pickCard('new')}
                  >
                    <Text style={styles.newCardText}>+ New card</Text>
                    {selected === 'new' && (
                      <Text style={styles.optionCheck}>✓</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ) : (
            // Embedded flow: an informational list of the cards Paymob will
            // offer, with rename/delete and drag-to-reorder.
            savedCards.map((c, i) => (
              <Animated.View
                key={c.token ?? String(i)}
                style={[
                  styles.savedCardRow,
                  i === dragIndex && {
                    transform: [{ translateY: dragY }],
                    zIndex: 10,
                    elevation: 6,
                    shadowColor: '#000000',
                    shadowOpacity: 0.15,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 3 },
                  },
                ]}
              >
                <View style={styles.savedCardLeft}>
                  <CardBrandIcon type={c.cardType} />
                  <Text style={styles.savedCardType} numberOfLines={1}>
                    {c.nickname || c.cardType || 'Card'}
                  </Text>
                </View>
                <View style={styles.savedCardRight}>
                  <Text style={styles.savedCardPan}>{last4(c.maskedPan)}</Text>
                  <TouchableOpacity
                    style={styles.editBtn}
                    onPress={() => openEditCard(c)}
                    accessibilityLabel="Edit card"
                  >
                    <Text style={styles.editIcon}>✎</Text>
                  </TouchableOpacity>
                  {savedCards.length > 1 && (
                    <View
                      style={styles.grip}
                      accessibilityLabel="Drag to reorder"
                      {...makeDragResponder(i).panHandlers}
                    >
                      <Text style={styles.gripIcon}>≡</Text>
                    </View>
                  )}
                </View>
              </Animated.View>
            ))
          )}
        </View>
      )}

      <View style={styles.spacer} />

      <TouchableOpacity
        style={styles.secureNote}
        onPress={() => setAgreed((a) => !a)}
        activeOpacity={0.7}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreed }}
      >
        <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
          {agreed && <Text style={styles.checkboxTick}>✓</Text>}
        </View>
        <Text style={styles.secureText}>
          You will be redirected to a secure payment page to enter your card
          details.
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.continueBtn, !canContinue && styles.continueBtnDisabled]}
        onPress={handleContinue}
        disabled={loading || !canContinue}
      >
        {loading ? (
          <ActivityIndicator color="#051926" />
        ) : (
          <Text style={styles.continueText}>Continue</Text>
        )}
      </TouchableOpacity>

      <Modal
        visible={!!editingCard}
        transparent
        animationType="fade"
        onRequestClose={closeEditCard}
      >
        <View style={styles.editOverlay}>
          <View style={styles.editCard}>
            <Text style={styles.editTitle}>Edit card</Text>
            <Text style={styles.editSubtitle}>
              {`${editingCard?.cardType ?? 'Card'} ${
                editingCard?.maskedPan ?? ''
              }`.trim()}
            </Text>
            <TextInput
              style={styles.editInput}
              value={nicknameDraft}
              onChangeText={setNicknameDraft}
              placeholder="Nickname"
              placeholderTextColor="#9a9a9a"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveEditCard}
            />
            <View style={styles.editButtons}>
              <TouchableOpacity onPress={deleteEditCard} style={styles.editGhost}>
                <Text style={styles.editDelete}>Delete</Text>
              </TouchableOpacity>
              <View style={styles.editRight}>
                <TouchableOpacity onPress={closeEditCard} style={styles.editGhost}>
                  <Text style={styles.editCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={saveEditCard} style={styles.editSave}>
                  <Text style={styles.editSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },

  // top-up + select screens
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

  // select screen
  selectWrap: {
    marginHorizontal: 20,
    marginTop: 28,
    gap: 16,
  },
  selectCard: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 16,
    padding: 20,
    backgroundColor: '#fafafa',
  },
  selectTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 6,
  },
  selectDesc: {
    fontSize: 14,
    lineHeight: 20,
    color: '#6b6b6b',
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
  checkbox: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#c4c4c4',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#07F0D7',
    borderColor: '#07F0D7',
  },
  checkboxTick: {
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

  // saved cards
  savedCards: {
    marginHorizontal: 20,
    marginTop: 24,
  },
  savedCardsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  savedCardsTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  savedCardsHint: {
    fontSize: 12,
    fontWeight: '500',
    color: '#9a9a9a',
  },
  savedCardRow: {
    height: 52,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#fafafa',
  },
  rowSelected: {
    borderColor: '#0b8f83',
    backgroundColor: '#f0faf9',
  },

  // saved-card dropdown (app-driven flow)
  dropdownTrigger: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#c4c4c4',
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  dropdownTriggerOpen: {
    borderColor: '#0b8f83',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  dropdownPlaceholder: {
    fontSize: 15,
    color: '#9a9a9a',
  },
  caret: {
    fontSize: 14,
    color: '#0b8f83',
    marginLeft: 12,
  },
  dropdownPanel: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: '#0b8f83',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  dropdownOption: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
  },
  dropdownOptionLast: {
    borderBottomWidth: 0,
  },
  optionCheck: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0b8f83',
  },

  savedCardLeft: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brand: {
    width: 34,
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandGeneric: {
    width: 28,
    height: 18,
    borderRadius: 4,
    backgroundColor: '#d4d4d4',
  },
  mcCircle: {
    width: 15,
    height: 15,
    borderRadius: 8,
  },
  mcRed: {
    backgroundColor: '#EB001B',
  },
  mcYellow: {
    backgroundColor: '#F79E1B',
    marginLeft: -6,
  },
  visaText: {
    color: '#1A1F71',
    fontSize: 13,
    fontWeight: '700',
    fontStyle: 'italic',
    letterSpacing: -0.5,
  },
  savedCardType: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#051926',
  },
  savedCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginLeft: 12,
  },
  savedCardPan: {
    fontSize: 15,
    color: '#555555',
  },
  editBtn: {
    padding: 4,
  },
  editIcon: {
    fontSize: 18,
    color: '#0b8f83',
  },
  grip: {
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  gripIcon: {
    fontSize: 20,
    color: '#b8b8b8',
  },
  newCardText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0b8f83',
  },
  embedded: {
    width: '100%',
    marginBottom: 16,
  },
  resetButton: {
    marginTop: 8,
  },

  // payment-in-progress overlay
  processingOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  processingCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 36,
    alignItems: 'center',
    gap: 14,
  },
  processingText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111111',
  },

  // edit-card modal (cross-platform rename/delete)
  editOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 28,
  },
  editCard: {
    alignSelf: 'stretch',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 22,
  },
  editTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  editSubtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#6b6b6b',
  },
  editInput: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#c4c4c4',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111111',
  },
  editButtons: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editGhost: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  editDelete: {
    fontSize: 15,
    fontWeight: '600',
    color: '#d11',
  },
  editCancel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6b6b6b',
  },
  editSave: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: '#07F0D7',
  },
  editSaveText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#051926',
  },
});
