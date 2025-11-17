
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK using environment variables
// This is more secure for platforms like Render
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Replace escaped newlines
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  }),
});

console.log('Firebase Admin SDK initialized successfully.');

module.exports = admin;
