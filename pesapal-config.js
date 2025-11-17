
// This is the secure way to handle secrets.
// Make sure to set these environment variables in your hosting environment (like Render).
export const pesapalConfig = {
  consumerKey: process.env.PESAPAL_CONSUMER_KEY,
  consumerSecret: process.env.PESAPAL_CONSUMER_SECRET,
  callbackUrl: process.env.PESAPAL_CALLBACK_URL || 'https://www.yourapp.com/payment-success'
};
