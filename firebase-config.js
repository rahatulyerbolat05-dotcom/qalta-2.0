// Firebase project config — Project settings -> General -> Your apps -> Web app.
// This value is meant to be public in client code; real access control comes
// from Firestore Security Rules, not from hiding this object.
// https://firebase.google.com/docs/projects/learn-more#config-files-objects
//
// Leave as null to run Қalta with local-only storage (no cross-device sync).
window.QALTA_FIREBASE_CONFIG = null;

// Example, once you have a project:
// window.QALTA_FIREBASE_CONFIG = {
//   apiKey: "AIza...",
//   authDomain: "your-project.firebaseapp.com",
//   projectId: "your-project",
//   storageBucket: "your-project.appspot.com",
//   messagingSenderId: "1234567890",
//   appId: "1:1234567890:web:abcdef"
// };
