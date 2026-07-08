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

  /** UI configuration passed to `PaymobCheckoutViewRef.configure`. */
  export interface PaymobCheckoutConfig {
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
