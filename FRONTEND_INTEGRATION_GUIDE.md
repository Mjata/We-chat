# Front-End Integration Guide for We-Chat API

This document provides front-end developers with the necessary information to interact with the We-Chat back-end API.

## 1. Authentication

All protected API endpoints require a `Bearer Token` in the `Authorization` header.

The token is the `idToken` obtained from Firebase Authentication after a user logs in.

```
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

### Recommended Approach: Axios Interceptor

To automatically include the token in every request, use an Axios interceptor. This saves you from adding the header manually for each API call.

#### Setup

1.  **Install Axios:**
    ```bash
    npm install axios
    # or
    yarn add axios
    ```

2.  **Install Firebase:**
    You should already have Firebase set up for authentication.

#### `ApiService` with Interceptor

Create a dedicated service file to manage all your API calls. This is a clean and reusable approach.

**File: `services/ApiService.ts` (TypeScript Example)**

```typescript
import axios, { AxiosInstance } from 'axios';
import auth from '@react-native-firebase/auth'; // Or your web equivalent

// The base URL of your deployed Render backend
const API_BASE_URL = 'https://we-chat-1-flwd.onrender.com/api'; 

class ApiService {
    private api: AxiosInstance;

    constructor() {
        // Create an Axios instance
        this.api = axios.create({
            baseURL: API_BASE_URL,
            headers: {
                'Content-Type': 'application/json',
            },
        });

        // Add a request interceptor to attach the auth token
        this.api.interceptors.request.use(
            async (config) => {
                const currentUser = auth().currentUser;
                if (currentUser) {
                    const token = await currentUser.getIdToken();
                    if (token) {
                        config.headers.Authorization = `Bearer ${token}`;
                    }
                }
                return config;
            },
            (error) => {
                return Promise.reject(error);
            }
        );
    }
    
    /**
     * Sets up a new user profile on the backend.
     * Should be called once after a user signs up.
     */
    async setupNewUser(): Promise<void> {
        try {
            await this.api.post('/setupNewUser');
            console.log('User setup successfully on the backend.');
        } catch (error) {
            // Handle cases where the profile might already exist (e.g., status 200)
            if (axios.isAxiosError(error) && error.response?.status !== 200) {
                 console.error('Failed to set up new user:', error.response?.data);
                 throw error; // Re-throw to be handled by the caller
            }
            console.log("User profile likely already exists.");
        }
    }
    
    /**
     * Initiates a coin recharge transaction.
     * @param packageId The ID of the selected coin package (e.g., 'pack1', 'pack2').
     * @param phoneNumber The user's M-Pesa phone number (e.g., '2547...').
     * @returns The redirect URL for the PesaPal payment page.
     */
    async initiateRecharge(packageId: string, phoneNumber: string): Promise<string> {
        try {
            const response = await this.api.post<{ redirectUrl: string }>('/recharge/initiate', {
                packageId,
                phoneNumber,
            });
            
            if (response.data && response.data.redirectUrl) {
                return response.data.redirectUrl;
            } else {
                throw new Error('Failed to get redirect URL from server.');
            }
        } catch (error) {
            console.error('Error initiating recharge:', error);
            // Handle error appropriately in your UI
            throw error; 
        }
    }

    // You can add other API methods here...
}

// Export a singleton instance of the service
export const apiService = new ApiService();
```

### Usage Example

Now, from anywhere in your app, you can call the `ApiService` methods directly. The interceptor will handle the token automatically.

#### **1. After User Sign-Up:**

Call `setupNewUser` immediately after a user successfully registers and logs in for the first time.

```typescript
import { apiService } from './services/ApiService';

// Inside your auth logic, after a new user signs up...
try {
    await apiService.setupNewUser();
} catch (error) {
    // Handle error (e.g., show a message to the user)
}
```
## 2. Coin Recharge (Payment) Integration

The payment flow is designed to be seamless and secure, leveraging a `WebView` on the client-side and a webhook on the server-side.

### Flow Overview

1.  **Initiate Transaction:** The app sends a request to the backend with a coin package ID and phone number.
2.  **Receive Redirect URL:** The backend responds with a unique PesaPal payment URL.
3.  **Open WebView:** The app opens this URL in a `WebView`, allowing the user to complete the payment within the app.
4.  **Backend Handles Confirmation:** After payment, PesaPal notifies our backend (not the app) via a webhook. The backend verifies the payment and updates the user's coin balance in Firestore.
5.  **UI Updates Automatically:** The app, using a real-time Firestore listener, detects the change in the user's coin balance and updates the UI automatically.

### Step-by-Step Implementation

#### Step 1: Build the UI

Create a screen where users can select a coin package. You will need the `packageId` for the API call.

*   `pack1`: 100 Coins
*   `pack2`: 550 Coins
*   `pack3`: 1200 Coins

#### Step 2: Call the API and Open WebView

When the user clicks "Pay", call the `initiateRecharge` method from `ApiService`.

**Example in a React Native Component:**

```typescript
// components/RechargeScreen.tsx (Example)

import React, { useState } from 'react';
import { View, Button, TextInput, Alert, StyleSheet } from 'react-native';
import { apiService } from '../services/ApiService';
import { WebView } from 'react-native-webview'; // Install with: npm install react-native-webview

const RechargeScreen = () => {
    const [phoneNumber, setPhoneNumber] = useState('');
    const [packageId, setPackageId] = useState('pack2'); // Example
    const [paymentUrl, setPaymentUrl] = useState<string | null>(null);

    const handleRecharge = async () => {
        if (!/^(254)\d{9}$/.test(phoneNumber)) { // Basic validation
            Alert.alert('Invalid Number', 'Please enter a valid phone number starting with 254.');
            return;
        }

        try {
            const url = await apiService.initiateRecharge(packageId, phoneNumber);
            setPaymentUrl(url); // This will trigger the WebView to render
        } catch (error) {
            Alert.alert('Error', 'Failed to start payment. Please try again.');
        }
    };
    
    // This function is called when the user closes the WebView
    const handleWebViewClose = () => {
        setPaymentUrl(null);
        Alert.alert('Processing', 'We will update your coins as soon as payment is confirmed.');
        // You can navigate the user back or refresh their profile
    };

    if (paymentUrl) {
        return (
            <WebView
                style={styles.container}
                source={{ uri: paymentUrl }}
                startInLoadingState={true}
                // When the user navigates away or closes the payment page,
                // you can decide what to do. Here we just close the view.
                onNavigationStateChange={(navState) => {
                    // You could check navState.url here to see if it's a "success" or "failure" URL
                    // from PesaPal and close the WebView automatically.
                    if (navState.url.includes('pesapal.com/failed')) {
                        handleWebViewClose();
                    }
                }}
            />
        );
    }

    return (
        <View style={styles.container}>
            {/* Your UI to select packages */}
            <TextInput
                style={styles.input}
                placeholder="254712345678"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                keyboardType="phone-pad"
            />
            <Button title={`Pay for Package: ${packageId}`} onPress={handleRecharge} />
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, marginTop: 20 },
    input: { height: 40, borderColor: 'gray', borderWidth: 1, marginBottom: 10, paddingHorizontal: 8 }
});

export default RechargeScreen;

```

#### Step 3: Listen for Real-Time Coin Updates

You **do not** need to poll the server for the new coin balance. Use Firestore's real-time capabilities.

Set up a listener on the user's document. When the backend webhook updates the `coins` field, your app's UI will receive the new data instantly.

**Example using a custom React hook:**

```typescript
// hooks/useUserProfile.ts

import { useState, useEffect } from 'react';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';

interface UserProfile {
    uid: string;
    email: string;
    username: string;
    coins: number;
    // ... other fields
}

export function useUserProfile() {
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const currentUser = auth().currentUser;

    useEffect(() => {
        if (!currentUser) {
            setLoading(false);
            return;
        }

        const userRef = firestore().collection('we_chat_users').doc(currentUser.uid);

        // onSnapshot listens for any changes to the document
        const unsubscribe = userRef.onSnapshot(
            (documentSnapshot) => {
                if (documentSnapshot.exists) {
                    setProfile(documentSnapshot.data() as UserProfile);
                } else {
                    setProfile(null);
                }
                setLoading(false);
            },
            (error) => {
                console.error("Failed to listen to user profile:", error);
                setLoading(false);
            }
        );

        // Cleanup the listener when the component unmounts
        return () => unsubscribe();

    }, [currentUser]);

    return { profile, loading };
}

// --- Usage in a component ---

// components/CoinDisplay.tsx
import React from 'react';
import { Text, View } from 'react-native';
import { useUserProfile } from '../hooks/useUserProfile';

export const CoinDisplay = () => {
    const { profile, loading } = useUserProfile();

    if (loading) {
        return <Text>Loading coins...</Text>;
    }

    return (
        <View>
            <Text style={{ fontSize: 18, fontWeight: 'bold' }}>
                Coins: {profile ? profile.coins : 0}
            </Text>
        </View>
    );
};
```

By following this guide, your front-end application can securely and efficiently handle payments and automatically reflect updated coin balances, providing a smooth user experience.
