import Config from 'react-native-config';
import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Button,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import {
  PaymobCheckoutView,
  type PaymobCheckoutViewRef,
} from 'paymob-reactnative';

interface PaymobEmbeddedViewProps {
  onBack: () => void;
}

export default function PaymobEmbeddedView({
  onBack,
}: PaymobEmbeddedViewProps) {
  const checkoutRef = useRef<PaymobCheckoutViewRef>(null);
  const [loading] = useState(false);
  const [status, setStatus] = useState<string>('');

  // Secrets (In real app, fetch these securely)
  const publicKey = Config.PAYMOB_PUBLIC_KEY ?? '';
  const clientSecret = Config.PAYMOB_CLIENT_SECRET ?? '';

  // 1. Initial Configure (Settings only)
  useEffect(() => {
    checkoutRef.current?.configure({
      showAddNewCard: true,
      showSaveCard: true,
      saveCardByDefault: false,
      payFromOutside: false,
    });
    setStatus('Ready to Pay');
  }, []);

  // 2. Pay Button Handler (Sets Keys)
  const handlePay = () => {
    setStatus('Initializing Payment...');
    checkoutRef.current?.setPaymentKeys({ publicKey, clientSecret });
  };

  const handleSuccess = (event: any) => {
    console.log('Paymob Success:', event.nativeEvent);
    setStatus('Success: ' + JSON.stringify(event.nativeEvent));
  };

  const handleFailure = (event: any) => {
    console.log('Paymob Failure:', event.nativeEvent);
    setStatus('Failure: ' + (event.nativeEvent?.error || 'Unknown'));
  };

  const handlePending = (event: any) => {
    console.log('Paymob Pending:', event.nativeEvent);
    setStatus('Pending');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Checkout</Text>
      </View>

      <Text style={styles.status}>{status}</Text>
      {loading && <ActivityIndicator size="large" color="#0000ff" />}

      <PaymobCheckoutView
        ref={checkoutRef}
        style={styles.embeddedView}
        onSuccess={handleSuccess}
        onFailure={handleFailure}
        onPending={handlePending}
      />

      <View style={styles.footer}>
        <View style={styles.buttonContainer}>
          <Button title="Pay / Load Keys" onPress={handlePay} color="#6200EE" />
        </View>
        <View style={{ height: 10 }} />
        <View style={styles.buttonContainer}>
          <Button title="Back" onPress={onBack} color="#333" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center', // Center title
    padding: 16,
    backgroundColor: '#fff',
    elevation: 2,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  status: {
    textAlign: 'center',
    margin: 10,
    color: 'gray',
  },
  embeddedView: {
    width: '100%',
    backgroundColor: 'white', // Ensure visible
  },
  footer: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  buttonContainer: {
    width: '50%',
  },
});
