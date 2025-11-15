
# Updated Backend Blueprint for Chat App

This document outlines the revised architecture and API endpoints for the Express.js backend. It now includes logic for real-time services, ad rewards, and a complete payment workflow.

---

## 1. Core Principles

- **Backend Authority**: The backend is the single source of truth for all critical operations, especially for coin management, payments, and user status.
- **Security**: All sensitive endpoints are protected by Firebase JWT authentication. Webhooks from payment providers are handled as open but secure endpoints.
- **Data Integrity**: Firestore transactions are used for all financial operations (granting/deducting coins) to ensure atomicity and prevent race conditions.

---

## 2. Data Model (Firestore)

### `users` collection
- **Description**: Stores the primary profile for each user, including their coin balance and live status.
```json
{
  "uid": "user_firebase_uid",
  "email": "user@example.com",
  "username": "New User",
  "profilePictureUrl": null,
  "subscriptionTier": "none",
  "coins": 550,
  "isLive": false,
  "createdAt": "2024-08-01T10:00:00Z"
}
```

### `transactions` collection
- **Description**: Stores a record of every recharge attempt initiated via Pesapal, providing a clear audit trail.
```json
{
  "userId": "user_firebase_uid",
  "packageId": "pack2",
  "status": "pending" | "completed" | "failed",
  "pesapalOrderTrackingId": "pesapal_guid",
  "createdAt": "2024-08-01T10:00:00Z",
  "updatedAt": "2024-08-01T10:05:00Z"
}
```

### `call_history` collection
- **Description**: Logs all call attempts and their status.
```json
{
  "callId": "firestore_document_id",
  "callerId": "caller_firebase_uid",
  "calleeId": "callee_firebase_uid",
  "status": "initiated" | "ongoing" | "ended" | "ended_insufficient_funds",
  "startTime": "2024-08-01T11:00:00Z",
  "endTime": "2024-08-01T11:05:00Z",
  "durationInSeconds": 300
}
```

---

## 3. Backend API Endpoints (Express.js)

### Authentication
- `authMiddleware`: A middleware that protects all sensitive routes by verifying the Firebase JWT `Authorization: Bearer <token>` header.

### User & Account
#### `POST /api/setupNewUser`
- **Description**: Creates a new user profile in Firestore if one doesn't already exist. Grants an initial bonus of 550 coins.
- **Auth**: Required.

### Payments & Recharge (Pesapal)
#### `POST /api/recharge/initiate`
- **Description**: Initiates a coin purchase. Creates a `pending` transaction record in Firestore and returns a Pesapal payment redirection URL to the client.
- **Auth**: Required.
- **Request Body**: `{ "packageId": "pack1" }`
- **Response (Success)**: `200 OK` - `{ "success": true, "paymentRedirectUrl": "https://cybqa.pesapal.com/..." }`

#### `GET /api/recharge/webhook`
- **Description**: The webhook endpoint that Pesapal calls to notify our server about the payment status.
- **Auth**: **None**. This is an open endpoint.
- **Logic**: It gets the transaction status from Pesapal. If the payment is `COMPLETED`, it runs a Firestore transaction to update the local transaction status to `completed` and atomically increments the user's `coins` balance.

### Live Streaming
#### `POST /api/livestreams/start`
- **Description**: Allows a user to start a live stream by setting their `isLive` status to `true`.
- **Auth**: Required.

#### `POST /api/livestreams/stop`
- **Description**: Allows a user to stop their live stream by setting their `isLive` status to `false`.
- **Auth**: Required.

#### `GET /api/livestreams`
- **Description**: Fetches a list of all users who are currently live (`isLive: true`).
- **Auth**: Required.
- **Response (Success)**: `200 OK` - `{ "success": true, "liveUsers": [{ "uid": "...", "username": "...", "profilePictureUrl": "..." }] }`

### Video & Voice Calls (Business Logic)
*Note: These endpoints manage the business logic (permissions, payments) for calls. The real-time video/audio streaming itself must be handled on the client-side using a service like Agora, ZegoCloud, or a custom WebRTC implementation.*

#### `POST /api/calls/start`
- **Description**: Checks if the calling user has enough coins to start a call (at least `CALL_COST_PER_MINUTE`). Creates a new `initiated` record in the `call_history` collection.
- **Auth**: Required.
- **Request Body**: `{ "calleeId": "the_user_to_call_uid" }`

#### `POST /api/calls/charge`
- **Description**: Deducts `CALL_COST_PER_MINUTE` from the caller's account. This should be called by the client app every minute to continue the call. If coins are insufficient, it returns an error, signaling the client to terminate the call.
- **Auth**: Required.
- **Request Body**: `{ "callId": "the_call_document_id" }`

#### `POST /api/calls/end`
- **Description**: Finalizes a call by updating its status to `ended` and logging the final duration.
- **Auth**: Required.
- **Request Body**: `{ "callId": "...", "duration": 300 }`

### AdMob Rewards
#### `POST /api/rewards/grant-ad-reward`
- **Description**: Securely grants a fixed number of coins (`ADMOB_REWARD_AMOUNT`) to a user. This endpoint should be called by the client app after a user successfully watches a rewarded video ad.
- **Auth**: Required.
- **Security**: This server-side approach prevents clients from fraudulently granting themselves coins.
