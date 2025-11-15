
const admin = require('firebase-admin');

// Check for the GOOGLE_APPLICATION_CREDENTIALS environment variable
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error('GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. You must set this to the path of your Firebase service account key file.');
}

// Initialize the Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

console.log('Firebase Admin SDK initialized successfully.');

module.exports = admin;
