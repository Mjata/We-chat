
import admin from 'firebase-admin';

// Initialize Firebase Admin SDK using environment variables
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      // The private key from Render's env var doesn't need replacing escaped newlines
      privateKey: process.env.FIREBASE_PRIVATE_KEY,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
  console.log('Firebase Admin SDK initialized successfully.');
} else {
  console.log('Firebase Admin SDK already initialized.');
}

export default admin;
