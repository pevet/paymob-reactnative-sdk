import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import {
  requireNativeComponent,
  UIManager,
  findNodeHandle,
  Platform,
} from 'react-native';

const COMPONENT_NAME = 'PaymobCheckoutView';

const NativeCheckoutView = requireNativeComponent(COMPONENT_NAME);

/**
 * Dispatches a view manager command to the native checkout view.
 * On iOS the command must be resolved to its numeric id via the view
 * manager config, while on Android the string command id is used directly.
 * @param {number} handle - The native node handle.
 * @param {string} commandId - The command name (e.g. 'configure').
 * @param {Array} args - Arguments to pass to the command.
 */
function dispatchCommand(handle, commandId, args) {
  if (Platform.OS === 'ios') {
    const config = UIManager.getViewManagerConfig(COMPONENT_NAME);
    const command =
      config && config.Commands ? config.Commands[commandId] : null;
    if (command != null) {
      UIManager.dispatchViewManagerCommand(handle, command, args);
    }
    return;
  }

  UIManager.dispatchViewManagerCommand(handle, commandId, args);
}

/**
 * Embedded (inline) Paymob checkout view.
 *
 * Renders the native Paymob checkout inside your React Native layout. Obtain a
 * ref and call `configure()` once to set up the view, then `setPaymentKeys()`
 * when you are ready to start the payment.
 *
 * @example
 * const ref = useRef(null);
 * useEffect(() => {
 *   ref.current?.configure({ showSaveCard: true });
 * }, []);
 * // later, on a Pay button press:
 * ref.current?.setPaymentKeys({ publicKey, clientSecret });
 *
 * <PaymobCheckoutView
 *   ref={ref}
 *   style={{ width: '100%' }}
 *   onSuccess={(e) => {}}
 *   onFailure={(e) => {}}
 *   onPending={(e) => {}}
 * />
 */
const PaymobCheckoutView = forwardRef(function PaymobCheckoutView(props, ref) {
  const { onSuccess, onFailure, onPending, ...rest } = props;
  const nativeRef = useRef(null);

  useImperativeHandle(
    ref,
    () => ({
      /**
       * Configures the checkout view. Call once before `setPaymentKeys`.
       * @param {object} [config] - UI configuration.
       */
      configure(config) {
        const handle = findNodeHandle(nativeRef.current);
        if (handle != null) {
          dispatchCommand(handle, 'configure', [config || {}]);
        }
      },
      /**
       * Sets the payment keys and starts the payment flow.
       * @param {object} keys - `{ publicKey, clientSecret }`.
       */
      setPaymentKeys(keys) {
        const handle = findNodeHandle(nativeRef.current);
        if (handle != null) {
          dispatchCommand(handle, 'setPaymentKeys', [keys]);
        }
      },
    }),
    []
  );

  return (
    <NativeCheckoutView
      ref={nativeRef}
      onSuccess={onSuccess}
      onFailure={onFailure}
      onPending={onPending}
      {...rest}
    />
  );
});

export default PaymobCheckoutView;
