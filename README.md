# Paymob for React Native

Paymob runs millions of transactions for different business sizes across the Middle East and Africa. Start using Paymob’s solutions and API’s to accept and send payments for your online business now.

To learn more about Paymob’s offerings and capabilities, visit [Paymob.com](https://www.paymob.com).

## Installation

To get started with the `paymob-reactnative` package, follow these steps:

- **Install the Package**

  Open your terminal, navigate to your React Native project directory, and install the `paymob-reactnative` package using npm:

  ```bash
  npm install paymob-reactnative@https://github.com/PaymobAccept/paymob-reactnative-sdk.git
  ```

  If you prefer using Yarn, you can run:

  ```bash
  yarn add paymob-reactnative@https://github.com/PaymobAccept/paymob-reactnative-sdk.git
  ```

  ### iOS

- **Install CocoaPods for iOS**

  If you are developing for iOS, you will need to install CocoaPods to manage your project's dependencies. Run the following commands:

  ```bash
  cd ios && pod install && cd ..
  ```

  This step ensures that the necessary native modules are linked correctly in your iOS project.

  **Important Notice:** If you encounter an issue with the native iOS SDK, you may need to create a new blank Swift file in Xcode. After creating the blank file, be sure to click on `Create Bridging Header` when prompted.

  ### Android

- Append the following snippet to your **project-level** `build.gradle` file.
  ```java
  allprojects {
      repositories {
          maven {
              url = rootProject.projectDir.toURI().resolve("../node_modules/paymob-reactnative/android/libs")
          }
          maven {
              url = uri("https://jitpack.io")
          }
      }
  }
  ```
- Add the following snippet to your **app-level** `build.gradle` file.
  ```java
  android {
      buildFeatures { dataBinding = true }
  }
  ```

## Using Paymob

To begin using the Paymob SDK in your React Native application, start by importing the module in your component:

```javascript
import Paymob, { PaymentStatus } from 'paymob-reactnative';
```

### SDK Customization

You can customize the Paymob SDK to match your app's branding and user experience by calling the following functions:

```javascript
Paymob.setAppIcon(base64Image); // Set your merchant logo using a base64 encoded image
Paymob.setAppName('Paymob SDK'); // Customize merchant app name displayed in the Paymob interface
Paymob.setButtonTextColor('#FFFFFF'); // Set the text color of buttons in the SDK
Paymob.setButtonBackgroundColor('#000000'); // Set the background color of buttons in the SDK
Paymob.setShowSaveCard(true); // Enable the option for users to save their cards
Paymob.setSaveCardDefault(true); // Set saved card option as default for transactions
Paymob.setShowConfirmationPage(true); // Show confirmation page upon payment
```

These customization options allow you to tailor the Paymob SDK interface to align with your brand identity.

### Important Notice

**Please ensure that all SDK customizations are completed before calling `Paymob.presentPayVC()`. Failing to do so may result in the payment interface not reflecting your desired branding and settings.**

### Adding a Listener

To handle payment results effectively, you can add a listener that will respond to different transaction statuses. This is crucial for providing feedback to users about their payment transactions:

```javascript
Paymob.setSdkListener((response: PaymentResponse) => {
  switch (response.status) {
    case PaymentStatus.SUCCESS:
      // Handle successful payment (response.details holds the transaction data)
      break;
    case PaymentStatus.FAIL:
      // Handle failed payment
      break;
    case PaymentStatus.PENDING:
      // Handle pending payment status
      break;
  }
});
```

Remember to remove the listener when it is no longer needed (e.g. on unmount):

```javascript
Paymob.removeSdkListener();
```

This listener will allow you to implement logic based on the result of the payment process, enhancing the user experience.

### Invoking the SDK

After configuring the SDK, you can invoke the Paymob payment interface with the following code:

```javascript
Paymob.presentPayVC('CLIENT_SECRET', 'PUBLIC_KEY');
```

This function call opens the Paymob payment interface, allowing users to complete their transactions securely. Make sure to replace `'CLIENT_SECRET'` and `'PUBLIC_KEY'` with your actual credentials.

The `CLIENT_SECRET` is obtained from your backend by calling Paymob's Intention Creation API (which uses your **secret key** — never ship the secret key in the app). The `PUBLIC_KEY` is your publishable key. See the [Mobile SDKs documentation](https://developers.paymob.com/paymob-docs/integration-paths/mobile-sdks) for the full backend-to-app flow.

### Embedded (Inline) Checkout

In addition to the full-screen flow above, you can embed the checkout directly inside your own screen using the `PaymobCheckoutView` component. Obtain a ref, call `configure()` once to set it up, then call `setPaymentKeys()` when the user is ready to pay:

```tsx
import { useEffect, useRef } from 'react';
import { PaymobCheckoutView, type PaymobCheckoutViewRef } from 'paymob-reactnative';

function Checkout() {
  const checkoutRef = useRef<PaymobCheckoutViewRef>(null);

  useEffect(() => {
    checkoutRef.current?.configure({
      showAddNewCard: true,
      showSaveCard: true,
      saveCardByDefault: false,
      payFromOutside: false,
    });
  }, []);

  const handlePay = () => {
    checkoutRef.current?.setPaymentKeys({
      publicKey: 'PUBLIC_KEY',
      clientSecret: 'CLIENT_SECRET',
    });
  };

  return (
    <PaymobCheckoutView
      ref={checkoutRef}
      style={{ width: '100%' }}
      onSuccess={(e) => console.log('Success', e.nativeEvent)}
      onFailure={(e) => console.log('Failure', e.nativeEvent?.error)}
      onPending={() => console.log('Pending')}
    />
  );
}
```

The view reports its result through the `onSuccess` / `onFailure` / `onPending` callbacks (not through `setSdkListener`, which is only used by the full-screen flow). The component measures its own height, so give it a width and let the height size itself.

## Example App

To explore the SDK or test its features, you can clone the repository and run the example app by following these steps:

1. **Clone the Repository**  
   Clone the repository to your local machine.

2. **Install Dependencies**  
   Navigate to the project directory and install the required dependencies using Yarn. Run:

   ```bash
   yarn
   ```

3. **Run the Example App**  
   You can run the example app for both iOS and Android platforms:

   - To run the app on **iOS**, use the following command:

     ```bash
     yarn example ios
     ```

   - To run the app on **Android**, use this command:

     ```bash
     yarn example android
     ```

By following these steps, you can explore the functionality of the SDK in the example app.

## Documentation

For more detailed information about the supported APIs, usage guidelines, and advanced features, please refer to our comprehensive [**Documentation**](https://developers.paymob.com/). Here, you will find examples, best practices, and troubleshooting tips to help you make the most out of the Paymob SDK.
