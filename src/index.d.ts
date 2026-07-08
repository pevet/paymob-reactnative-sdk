declare module 'paymob-reactnative' {
  import type { ForwardRefExoticComponent, RefAttributes } from 'react';
  import type { NativeSyntheticEvent, ViewProps } from 'react-native';

  export enum PaymentStatus {
    SUCCESS = 'Success',
    FAIL = 'Fail',
    PENDING = 'Pending',
  }

  export type PaymentResponse = {
    status: PaymentStatus; // Enum type for status
    details?: object; // Optional property of type 'object'
  };

  export interface PaymobListener {
    (response: PaymentResponse): void;
  }

  export interface PaymobModule {
    setAppIcon(base64Image: string): void;
    setAppName(name: string): void;
    setButtonBackgroundColor(color: string): void;
    setButtonTextColor(color: string): void;
    setSaveCardDefault(isEnabled: boolean): void;
    setShowSaveCard(isVisible: boolean): void;
    setShowConfirmationPage(isVisible: boolean): void;
    setShowTransactionResult(isVisible: boolean): void;
    setKeyboardHandlingEnabled(isEnabled: boolean): void;
    presentPayVC(clientSecret: string, publicKey: string): void;
    setSdkListener(listener: PaymobListener): void;
    removeSdkListener(): void;
  }

  const Paymob: PaymobModule;

  /**
   * Visual theming for the embedded checkout. Colors are hex strings
   * (e.g. `'#000000'`); numeric-like values (sizes, radius, padding) are
   * passed as strings. Serialize with `JSON.stringify` into
   * `PaymobCheckoutConfig.uiCustomization`.
   *
   * WARNING: the native SDKs expect DIFFERENT JSON key formats. The property
   * names below match the Android SDK (camelCase, e.g. `colorPrimary`). The
   * iOS SDK instead decodes Title_Case_With_Underscores keys
   * (e.g. `Color_Primary`, `Text_Color_For_Payment_Button`,
   * `Payment_Button_Title`). Build the JSON with the key format that matches
   * the platform you are targeting.
   */
  export interface PaymobEmbeddedCustomization {
    /** Primary/accent color, e.g. the payment button fill. */
    colorPrimary?: string;
    colorContainer?: string;
    colorInputFields?: string;
    colorDisabled?: string;
    colorError?: string;
    colorBorderInputFields?: string;
    colorBorderPaymentButton?: string;
    /** Text color of the payment button. */
    textColorForPaymentButton?: string;
    textColorForLabel?: string;
    textColorForInputFields?: string;
    colorForTextPlaceholder?: string;
    radiusBorder?: string;
    /** Label shown on the payment button. */
    paymentButtonTitle?: string;
    fontSizeLabel?: string;
    fontSizeInputFields?: string;
    fontSizePaymentButton?: string;
    fontWeightLabel?: string;
    fontWeightInputFields?: string;
    fontWeightPaymentButton?: string;
    widthOfContainer?: string;
    verticalPadding?: string;
    verticalSpacingBetweenComponents?: string;
    containerPadding?: string;
  }

  /** UI configuration passed to `PaymobCheckoutViewRef.configure`. */
  export interface PaymobCheckoutConfig {
    /**
     * JSON string of a {@link PaymobEmbeddedCustomization}, e.g.
     * `JSON.stringify({ colorPrimary: '#000000' })`.
     */
    uiCustomization?: string;
    showAddNewCard?: boolean;
    showSaveCard?: boolean;
    saveCardByDefault?: boolean;
    payFromOutside?: boolean;
  }

  /** Payment keys passed to `PaymobCheckoutViewRef.setPaymentKeys`. */
  export interface PaymobPaymentKeys {
    publicKey: string;
    clientSecret: string;
  }

  /** Imperative handle exposed by `PaymobCheckoutView` via a ref. */
  export interface PaymobCheckoutViewRef {
    /** Configures the checkout view. Call once before `setPaymentKeys`. */
    configure(config?: PaymobCheckoutConfig): void;
    /** Sets the payment keys and starts the payment flow. */
    setPaymentKeys(keys: PaymobPaymentKeys): void;
  }

  export interface PaymobCheckoutViewProps extends ViewProps {
    onSuccess?: (event: NativeSyntheticEvent<Record<string, unknown>>) => void;
    onFailure?: (event: NativeSyntheticEvent<{ error?: string }>) => void;
    onPending?: (event: NativeSyntheticEvent<Record<string, unknown>>) => void;
  }

  /**
   * Embedded (inline) Paymob checkout view. Obtain a ref (typed as
   * `PaymobCheckoutViewRef`) to call `configure()` and `setPaymentKeys()`.
   */
  export const PaymobCheckoutView: ForwardRefExoticComponent<
    PaymobCheckoutViewProps & RefAttributes<PaymobCheckoutViewRef>
  >;

  export default Paymob;
}
