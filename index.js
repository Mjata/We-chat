
import express from 'express';
import admin from './firebase-config.js';
import axios from 'axios';
import { pesapalConfig } from './pesapal-config.js';
import { v4 as uuidv4 } from 'uuid';
import { AccessToken } from 'livekit-server-sdk';

const app = express();
app.use(express.json());

// --- Database Collection Names ---
const USERS_COLLECTION = 'we_chat_users';
const TRANSACTIONS_COLLECTION = 'pesapal_transactions';

// --- CONFIGURATION CONSTANTS ---
const CALL_COST_PER_MINUTE = 50;
const ADMOB_REWARD_AMOUNT = 20;

// --- Pesapal API Configuration ---
const PESAPAL_API = 'https://cybqa.pesapal.com/pesapalv3'; // Sandbox URL
const PESAPAL_CALLBACK_URL_BASE = 'https://we-chat-1-flwd.onrender.com';

// --- MIDDLEWARE ---
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided.' });
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    req.user = await admin.auth().verifyIdToken(idToken);
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
        tokenExpiry = new Date(new Date().getTime() + 290 * 1000); // Set expiry for ~4.8 mins
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
    const { packageId, phoneNumber } = req.body;

    if (!packageId || !COIN_PACKAGES[packageId]) {
        return res.status(400).json({ error: 'Invalid coin package selected.' });
    }
    
    const db = admin.firestore();
    const selectedPackage = COIN_PACKAGES[packageId];
    const merchantReference = uuidv4();
    const ipnNotificationUrl = `${PESAPAL_CALLBACK_URL_BASE}/api/recharge/webhook`;

    try {
        const token = await getPesapalToken();
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

        const pesapalOrderPayload = {
            id: merchantReference,
            currency: 'KES',
            amount: selectedPackage.price,
            description: `Recharge ${selectedPackage.coins} coins`,
            callback_url: ipnNotificationUrl,
            notification_id: ipnNotificationUrl,
            billing_address: {
                email_address: email,
                phone_number: phoneNumber || '',
                country_code: 'KE'
            }
        };

        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
        const pesapalResponse = await axios.post(`${PESAPAL_API}/api/Transactions/SubmitOrderRequest`, pesapalOrderPayload, { headers });

        if (pesapalResponse.data && pesapalResponse.data.redirect_url) {
            res.status(200).json({ redirectUrl: pesapalResponse.data.redirect_url });
        } else {
            throw new Error('Invalid response from Pesapal.');
        }

    } catch (error) {
        console.error('Error initiating recharge:', error.response ? error.response.data : error.message);
        await db.collection(TRANSACTIONS_COLLECTION).doc(merchantReference).update({ status: 'FAILED' }).catch(err => console.error("Failed to update status to FAILED:", err));
        res.status(500).json({ error: 'Failed to initiate recharge.' });
    }
});

// Pesapal IPN Listener (Webhook) - For URL Registration
app.get('/api/recharge/webhook', (req, res) => {
  console.log('GET /api/recharge/webhook - PesaPal URL Registration');
  res.status(200).json({
    order_notification_type: "GET",
    timestamp: new Date().toISOString(),
    status: "200",
    message: "Callback URL successfully registered"
  });
});

// Pesapal IPN Listener (Webhook) - For Payment Notifications
app.post('/api/recharge/webhook', async (req, res) => {
  console.log('POST /api/recharge/webhook - Received PesaPal IPN:', JSON.stringify(req.body, null, 2));

  const { OrderMerchantReference, OrderTrackingId, OrderNotificationType } = req.body;

  if (OrderNotificationType !== "IPNCHANGE") {
    return res.status(200).json({ message: "Acknowledged, but not the notification type we process." });
  }

  const db = admin.firestore();
  const transactionRef = db.collection(TRANSACTIONS_COLLECTION).doc(OrderMerchantReference);

  try {
    await db.runTransaction(async (t) => {
        const transactionDoc = await t.get(transactionRef);

        if (!transactionDoc.exists) {
            console.error(`Webhook Error: Transaction with MerchantReference ${OrderMerchantReference} not found.`);
            return;
        }
        
        const transactionData = transactionDoc.data();

        if (transactionData.status === 'COMPLETED' || transactionData.status === 'FAILED') {
            console.log(`Webhook Info: Transaction ${OrderMerchantReference} already processed.`);
            return;
        }

        const token = await getPesapalToken();
        const statusResponse = await axios.get(`${PESAPAL_API}/api/Transactions/GetTransactionStatus?orderTrackingId=${OrderTrackingId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        const paymentStatus = statusResponse.data.payment_status_description.toUpperCase();

        if (paymentStatus === 'COMPLETED') {
            console.log(`Processing COMPLETED payment for ${OrderMerchantReference}`);
            const userRef = db.collection(USERS_COLLECTION).doc(transactionData.userId);
            
            t.update(transactionRef, { 
                status: 'COMPLETED', 
                pesapalTrackingId: OrderTrackingId,
                paymentStatus: paymentStatus,
                processedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            t.update(userRef, {
                coins: admin.firestore.FieldValue.increment(transactionData.coins)
            });

        } else if (['FAILED', 'INVALID', 'CANCELLED'].includes(paymentStatus)) {
            console.log(`Processing FAILED payment for ${OrderMerchantReference}`);
            t.update(transactionRef, { 
                status: 'FAILED',
                pesapalTrackingId: OrderTrackingId,
                paymentStatus: paymentStatus,
                processedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } else {
            console.log(`Payment for ${OrderMerchantReference} is still ${paymentStatus}. No action taken.`);
        }
    });

    res.status(200).json({
        order_notification_type: "POST",
        timestamp: new Date().toISOString(),
        status: "200",
        message: "IPN received and processed."
    });

  } catch (error) {
    console.error(`Webhook FATAL Error for ${OrderMerchantReference}: `, error.response ? error.response.data : error.message);
    res.status(500).json({ error: "Internal server error processing webhook." });
  }
});


// --- LIVEKIT & CALLS ---
app.post('/api/calls/livekit-token', authMiddleware, (req, res) => {
  // 1. Get API Key and Secret from environment variables
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  // 2. Get roomName and participantIdentity from the request body
  const { roomName, participantIdentity } = req.body;
  
  // 3. Get the authenticated user's UID from the middleware
  const authenticatedUserId = req.user.uid;

  // Security Check: Ensure the person requesting the token is the same person who will use it
  if (participantIdentity !== authenticatedUserId) {
    return res.status(403).json({ error: 'Forbidden: You can only request a token for yourself.' });
  }

  // 4. Validate inputs
  if (!apiKey || !apiSecret) {
    console.error('LiveKit server keys are not configured on the backend.');
    return res.status(500).json({ error: 'LiveKit server keys are not configured.' });
  }
  if (!roomName || !participantIdentity) {
    return res.status(400).json({ error: 'roomName and participantIdentity are required.' });
  }

  // 5. Create an AccessToken
  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantIdentity,
  });

  // 6. Grant permissions to join the room
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  // 7. Generate the token (JWT)
  const token = at.toJwt();
  
  console.log(`Successfully generated LiveKit token for user: ${participantIdentity}`);
  
  // 8. Send the token back to the client app
  return res.status(200).json({ token: token });
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


const port = parseInt(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Server is running on port ${port}`));
