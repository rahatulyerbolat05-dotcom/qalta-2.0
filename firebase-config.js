// Firebase project config — Project settings -> General -> Your apps -> Web app.
// This value is meant to be public in client code; real access control comes
// from Firestore Security Rules (firestore.rules), not from hiding this object.
// https://firebase.google.com/docs/projects/learn-more#config-files-objects
//
// Set to null to run Қalta with local-only storage (no cross-device sync).
window.QALTA_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCf1M9AEt_3lMOGpkeVtuBLtUDtoXSVkpk",
  authDomain: "qalta-by-yerbo.firebaseapp.com",
  projectId: "qalta-by-yerbo",
  storageBucket: "qalta-by-yerbo.firebasestorage.app",
  messagingSenderId: "50557771129",
  appId: "1:50557771129:web:1b97cbc3e04ac5280123a8"
};

// Telegram bot username (without @), public like the config above. Empty: the "Telegram bot" row is hidden.
// Set it after creating the bot with @BotFather and deploying bot/ (see bot/README.md).
window.QALTA_TELEGRAM_BOT = "";
