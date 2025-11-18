
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
const LIVE_STREAMS_COLLECTION = 'live_streams';

// --- CONFIGURATION CONSTANTS ---
const CALL_COST_PER_MINUTE = 50;
const ADMOB_REWARD_AMOUNT = 20;

// --- Pesapal API Configuration ---
const PESAPAL_API = 'https://cybqa.pesapal.com/pesapalv3';
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
        tokenExpiry = new Date(new Date().getTime() + 290 * 1000);
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
        await userRef.set({ uid, email, username: 'New User', profilePictureUrl: null, subscriptionTier: 'none', coins: 550, createdAt: admin.firestore.FieldValue.serverTimestamp() });
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

app.get('/api/recharge/webhook', (req, res) => {
  console.log('GET /api/recharge/webhook - PesaPal URL Registration');
  res.status(200).json({
    order_notification_type: "GET",
    timestamp: new Date().toISOString(),
    status: "200",
    message: "Callback URL successfully registered"
  });
});

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
        if (!transactionDoc.exists) { return; }
        const transactionData = transactionDoc.data();
        if (transactionData.status === 'COMPLETED' || transactionData.status === 'FAILED') { return; }
        const token = await getPesapalToken();
        const statusResponse = await axios.get(`${PESAPAL_API}/api/Transactions/GetTransactionStatus?orderTrackingId=${OrderTrackingId}`, { headers: { Authorization: `Bearer ${token}` } });
        const paymentStatus = statusResponse.data.payment_status_description.toUpperCase();
        if (paymentStatus === 'COMPLETED') {
            const userRef = db.collection(USERS_COLLECTION).doc(transactionData.userId);
            t.update(transactionRef, { status: 'COMPLETED', pesapalTrackingId: OrderTrackingId, paymentStatus: paymentStatus, processedAt: admin.firestore.FieldValue.serverTimestamp() });
            t.update(userRef, { coins: admin.firestore.FieldValue.increment(transactionData.coins) });
        } else if (['FAILED', 'INVALID', 'CANCELLED'].includes(paymentStatus)) {
            t.update(transactionRef, { status: 'FAILED', pesapalTrackingId: OrderTrackingId, paymentStatus: paymentStatus, processedAt: admin.firestore.FieldValue.serverTimestamp() });
        }
    });
    res.status(200).json({ order_notification_type: "POST", timestamp: new Date().toISOString(), status: "200", message: "IPN received and processed." });
  } catch (error) {
    console.error(`Webhook FATAL Error for ${OrderMerchantReference}: `, error.response ? error.response.data : error.message);
    res.status(500).json({ error: "Internal server error processing webhook." });
  }
});


// --- LIVEKIT, CALLS & CHARGING ---

// Generates a token for a user to join a LiveKit call.
app.post('/api/calls/livekit-token', authMiddleware, async (req, res) => {
  const { roomName, participantIdentity } = req.body;
  const authenticatedUserId = req.user.uid;
  const db = admin.firestore();

  // Security Check: Ensure the person requesting the token is the same person who will use it
  if (participantIdentity !== authenticatedUserId) {
    return res.status(403).json({ error: 'Forbidden: You can only request a token for yourself.' });
  }

  try {
    // Pre-call Coin Check: Verify user has enough coins for at least one minute.
    const userRef = db.collection(USERS_COLLECTION).doc(authenticatedUserId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
        return res.status(404).json({ error: 'User profile not found.' });
    }

    const userCoins = userDoc.data().coins;
    if (userCoins < CALL_COST_PER_MINUTE) {
        return res.status(402).json({ error: `Insufficient coins to start a call. At least ${CALL_COST_PER_MINUTE} coins are required.` });
    }

    // If check passes, proceed to generate the token.
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      console.error('LiveKit server keys are not configured on the backend.');
      return res.status(500).json({ error: 'LiveKit server keys are not configured.' });
    }
    if (!roomName || !participantIdentity) {
      return res.status(400).json({ error: 'roomName and participantIdentity are required.' });
    }

    const at = new AccessToken(apiKey, apiSecret, { identity: participantIdentity });
    at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
    const token = at.toJwt();
    console.log(`Successfully generated LiveKit token for user: ${participantIdentity}`);
    return res.status(200).json({ token: token });

  } catch (error) {
      console.error(`Error generating LiveKit token for user ${authenticatedUserId}:`, error);
      return res.status(500).json({ error: 'Failed to generate LiveKit token.'});
  }
});

// Called by the client APP AFTER a call has ended to deduct coins.
app.post('/api/calls/charge-duration', authMiddleware, async (req, res) => {
    const { uid } = req.user;
    const { durationInSeconds } = req.body;
    const db = admin.firestore();

    if (durationInSeconds == null || typeof durationInSeconds !== 'number' || durationInSeconds < 0) {
        return res.status(400).json({ error: 'A valid durationInSeconds (number) is required.' });
    }
    if (durationInSeconds === 0) {
        return res.status(200).json({ success: true, message: "No charge for 0 second call." });
    }

    const minutes = Math.ceil(durationInSeconds / 60);
    const totalCost = minutes * CALL_COST_PER_MINUTE;

    const userRef = db.collection(USERS_COLLECTION).doc(uid);

    try {
        await db.runTransaction(async (t) => {
            const userDoc = await t.get(userRef);
            if (!userDoc.exists) {
                throw { status: 404, message: 'User not found' };
            }
            const currentCoins = userDoc.data().coins;
            if (currentCoins < totalCost) {
                // This is a fallback check. The pre-call check should prevent this in most cases.
                console.warn(`User ${uid} had insufficient coins post-call. Required ${totalCost}, had ${currentCoins}. Charging what is available.`);
                t.update(userRef, { coins: 0 });
            } else {
                t.update(userRef, { coins: admin.firestore.FieldValue.increment(-totalCost) });
            }
        });
        res.status(200).json({ success: true, message: `Successfully charged for ${minutes} minute(s).` });
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        console.error(`Failed to charge call for user ${uid}:`, error);
        res.status(500).json({ error: 'Failed to process call charge.' });
    }
});


// --- LIVE STREAMING ---
app.post('/api/livestreams/start', authMiddleware, async (req, res) => {
    const { uid } = req.user;
    const { liveStreamImageUrl } = req.body;
    const db = admin.firestore();
    
    if (!liveStreamImageUrl) {
        return res.status(400).json({ error: 'liveStreamImageUrl is required.' });
    }

    try {
        const userRef = db.collection(USERS_COLLECTION).doc(uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User profile not found.' });
        }
        
        const userData = userDoc.data();

        // Security Check: Only allow VIP users to stream.
        if (userData.subscriptionTier !== 'vip') {
            return res.status(403).json({ error: 'Only VIP users are allowed to start a live stream.' });
        }

        const { username, profilePictureUrl } = userData;
        const liveStreamRef = db.collection(LIVE_STREAMS_COLLECTION).doc(uid);
        await liveStreamRef.set({
            userId: uid,
            username: username,
            profilePictureUrl: profilePictureUrl,
            liveStreamImageUrl: liveStreamImageUrl,
            startedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(200).json({ status: "success", message: "Stream started and user is now live." });
    } catch (error) {
        console.error('Error starting live stream:', error);
        res.status(500).json({ error: 'Failed to start live stream.' });
    }
});

app.post('/api/livestreams/stop', authMiddleware, async (req, res) => {
    const { uid } = req.user;
    const db = admin.firestore();
    try {
        const liveStreamRef = db.collection(LIVE_STREAMS_COLLECTION).doc(uid);
        await liveStreamRef.delete();
        res.status(200).json({ status: "success", message: "Stream stopped." });
    } catch (error) {
        console.error('Error stopping live stream:', error);
        res.status(500).json({ error: 'Failed to stop live stream.' });
    }
});

app.get('/api/livestreams', authMiddleware, async (req, res) => {
    const db = admin.firestore();
    try {
        const snapshot = await db.collection(LIVE_STREAMS_COLLECTION).orderBy('startedAt', 'desc').get();
        const liveUsers = snapshot.docs.map(doc => doc.data());
        res.status(200).json({ success: true, liveUsers: liveUsers });
    } catch (error) {
        console.error('Error fetching live streams:', error);
        res.status(500).json({ error: 'Failed to fetch live streams.' });
    }
});


const port = parseInt(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Server is running on port ${port}`));
