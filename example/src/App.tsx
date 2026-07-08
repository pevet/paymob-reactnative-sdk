import { SafeAreaView, StyleSheet } from 'react-native';
import CheckoutScreen from './CheckoutScreen';

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <CheckoutScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
});
