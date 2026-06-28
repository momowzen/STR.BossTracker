const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  const saPath = path.join(__dirname, 'service-account.json');
  if (fs.existsSync(saPath)) {
    serviceAccount = require(saPath);
  } else {
    throw new Error('No Firebase credentials found. Set FIREBASE_SERVICE_ACCOUNT env var or place service-account.json in the bot directory.');
  }
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

module.exports = { db, admin };
