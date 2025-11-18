
import express from 'express';
import admin from './firebase-config.js';
import axios from 'axios';
import { pesapalConfig } from './pesapal-config.js';
import { v4 as uuidv4 } from 'uuid'; // Import uuid

const app = express();
app.use(express.json());

// --- Database Collection Names ---
const USERS_COLLECTION = 'we_chat_users';
const TRANSACTIONS_COLLECTION = 'pesapal_transactions'; // New collection for transactions

// --- CONFIGURATION CONSTANTS ---
const CALL_COST_PER_MINUTE = 50;
const ADMOB_REWARD_AMOUNT = 20;

// --- Pesapal API Configuration ---
const PESAPAL_API = 'https://cybqa.pesapal.com/pesapalv3'; // Sandbox URL
const PESAPAL_CALLBACK_URL_BASE = 'https://we-chat-1-flwd.onrender.com'; // Your app's public URL

// --- MIDDLEWARE ---
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided.' });
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    req.user = await admin.auth().verifyIdToken(idToken);
    // Fetch user's email from Auth if not present on token
    if (!req.user.email) {
        const firebaseUser = await admin.auth().getUser(req.user.uid);
        req.user.email = firebaseUser.email;
    }
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(403).json({ error: 'Unauthorized: Invalid token.' });
  }
};

// --- PESAPAL HELPER ---
let pesapalAuthToken = null;
let tokenExpiry = null;
const getPesapalToken = async () => {
    if (pesapalAuthToken && tokenExpiry && new Date() < tokenExpiry) return pesapalAuthToken;
    try {
        const response = await axios.post(`${PESAPAL_API}/api/Auth/RequestToken`, {
            consumer_key: pesapalConfig.consumerKey,
            consumer_secret: pesapalConfig.consumerSecret,
        });
        pesapalAuthToken = response.data.token;
        tokenExpiry = new Date(new Date().getTime() + 290 * 1000); // 4.8 minutes
        return pesapalAuthToken;
    } catch (error) {
        console.error('Error getting Pesapal token:', error.response ? error.response.data : error.message);
        throw new Error('Could not authenticate with Pesapal.');
    }
};

// --- USER, ACCOUNT & PERMISSIONS ---
app.post('/api/setupNewUser', authMiddleware, async (req, res) => {
    const { uid, email } = req.user;
    const db = admin.firestore();
    const userRef = db.collection(USERS_COLLECTION).doc(uid);
    try {
        const userDoc = await userRef.get();
        if (userDoc.exists) return res.status(200).json({ message: 'User profile already exists.' });
        await userRef.set({ uid, email, username: 'New User', profilePictureUrl: null, subscriptionTier: 'none', coins: 550, isLive: false, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        res.status(201).json({ success: true, message: 'User profile created with 550 bonus coins.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to set up new user.' });
    }
});

// --- RECHARGE & PAYMENT ---
const COIN_PACKAGES = { 'pack1': { coins: 100, price: 5.00 }, 'pack2': { coins: 550, price: 20.00 }, 'pack3': { coins: 1200, price: 50.00 } };

app.post('/api/recharge/initiate', authMiddleware, async (req, res) => {
    const { uid, email } = req.user;
    const { packageId, phoneNumber } = req.body; // Expect packageId and phoneNumber from client

    if (!packageId || !COIN_PACKAGES[packageId]) {
        return res.status(400).json({ error: 'Invalid coin package selected.' });
    }
    
    const db = admin.firestore();
    const selectedPackage = COIN_PACKAGES[packageId];
    const merchantReference = uuidv4(); // Generate a unique ID for this transaction
    const ipnNotificationUrl = `${PESAPAL_CALLBACK_URL_BASE}/api/recharge/webhook`;

    try {
        // 1. Get Pesapal Auth Token
        const token = await getPesapalToken();

        // 2. Create a pending transaction record in Firestore
        const transactionRef = db.collection(TRANSACTIONS_COLLECTION).doc(merchantReference);
        await transactionRef.set({
            userId: uid,
            packageId: packageId,
            amount: selectedPackage.price,
            coins: selectedPackage.coins,
            status: 'PENDING',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            merchantReference: merchantReference,
        });

        // 3. Submit Order to Pesapal
        const pesapalOrderPayload = {
            id: merchantReference,
            currency: 'KES',
            amount: selectedPackage.price,
            description: `Recharge ${selectedPackage.coins} coins`,
            callback_url: ipnNotificationUrl, // For this app, both callback and IPN are the same
            notification_id: ipnNotificationUrl,
            billing_address: {
                email_address: email,
                phone_number: phoneNumber || '', // Use phone number from client if available
                country_code: 'KE'
            }
        };

        const headers = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        };

        const pesapalResponse = await axios.post(
            `${PESAPAL_API}/api/Transactions/SubmitOrderRequest`,
            pesapalOrderPayload,
            { headers }
        );

        if (pesapalResponse.data && pesapalResponse.data.redirect_url) {
            // 4. Send redirect URL to the client
            res.status(200).json({ redirectUrl: pesapalResponse.data.redirect_url });
        } else {
            throw new Error('Invalid response from Pesapal.');
        }

    } catch (error) {
        console.error('Error initiating recharge:', error.response ? error.response.data : error.message);
        // Update transaction status to FAILED
        await db.collection(TRANSACTIONS_COLLECTION).doc(merchantReference).update({ status: 'FAILED' });
        res.status(500).json({ error: 'Failed to initiate recharge.' });
    }
});

// Pesapal IPN Listener (Webhook)
app.get('/api/recharge/webhook', (req, res) => {
  console.log('GET /api/recharge/webhook - PesaPal URL Registration');
  const response = {
    "order_notification_type": "GET",
    "timestamp": new Date().toISOString(),
    "status": "200",
    "message": "Callback URL successfully registered"
  };
  res.status(200).json(response);
});

app.post('/api/recharge/webhook', (req, res) => {
  console.log('POST /api/recharge/webhook - Received PesaPal IPN:');
  console.log(JSON.stringify(req.body, null, 2));

  // TODO: Add logic here to verify the notification and update the database
  const { OrderMerchantReference, OrderNotificationType } = req.body;
  if (OrderNotificationType === "IPNCHANGE") {
      // This is the actual payment notification
      // We will add the logic to handle this in the next step
  }
  
  const response = {
    "order_notification_type": "POST",
    "timestamp": new Date().toISOString(),
    "status": "200",
    "message": "IPN received successfully. Ready for processing."
  };
  res.status(200).json(response);
});

// --- LIVE STREAMING ---
app.post('/api/livestreams/start', authMiddleware, async (req, res) => {
    const { uid } = req.user;
    const db = admin.firestore();
    const userRef = db.collection(USERS_COLLECTION).doc(uid);
    try {
        await userRef.update({ isLive: true });
        res.status(200).json({ success: true, message: 'User is now live.' });
    } catch (error) {
        console.error('Error starting live stream:', error);
        res.status(500).json({ error: 'Failed to start live stream.' });
    }
});

app.post('/api/livestreams/stop', authMiddleware, async (req, res) => {
    const { uid } = req.user;
    const db = admin.firestore();
    const userRef = db.collection(USERS_COLLECTION).doc(uid);
    try {
        await userRef.update({ isLive: false });
        res.status(200).json({ success: true, message: 'User has stopped being live.' });
    } catch (error) {
        console.error('Error stopping live stream:', error);
        res.status(500).json({ error: 'Failed to stop live stream.' });
    }
});

app.get('/api/livestreams', authMiddleware, async (req, res) => {
    const db = admin.firestore();
    try {
        const querySnapshot = await db.collection(USERS_COLLECTION).where('isLive', '==', true).get();
        const liveUsers = [];
        querySnapshot.forEach(doc => {
            const { uid, username, profilePictureUrl } = doc.data();
            liveUsers.push({ uid, username, profilePictureUrl });
        });
        res.status(200).json({ success: true, liveUsers });
    } catch (error) {
        console.error('Error fetching live streams:', error);
        res.status(500).json({ error: 'Failed to fetch live streams.' });
    }
});

// --- VIDEO & VOICE CALLS ---
app.post('/api/calls/start', authMiddleware, /* ... Existing Call code ... */ );
app.post('/api/calls/charge', authMiddleware, /* ... Existing Call code ... */ );
app.post('/api/calls/end', authMiddleware, /* ... Existing Call code ... */ );

// --- ADMOB & REWARDS ---
app.post('/api/rewards/grant-ad-reward', authMiddleware, /* ... Existing AdMob code ... */ );


const port = parseInt(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Server is running on port ${port}`));
