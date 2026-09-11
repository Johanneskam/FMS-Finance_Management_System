// db/firebase-config.js
// Paste the values from Firebase Console -> Project settings -> General ->
// Your apps -> (Web app) -> SDK setup and configuration -> Config.
// These are public identifiers, not secrets — safe to commit/ship. Actual
// access control lives in Firestore's Security Rules (Console -> Firestore
// Database -> Rules), not in anything here.
//
// Firestore doesn't use a databaseURL (that was Realtime-Database-specific,
// back when sync-firebase.js used that instead) — apiKey + projectId are
// the whole connection.

module.exports = {
  apiKey: 'AIzaSyAwxgHNCSYV2c07q_9JW66-Tt3U8QivBT0',
  authDomain: 'wps-fms.firebaseapp.com',
  projectId: 'wps-fms',
  storageBucket: 'wps-fms.firebasestorage.app', // not actually used by this app (we only touch Firestore + Anonymous Auth)
  messagingSenderId: '267749804858',
  appId: '1:267749804858:web:70e06c581af33a869e9e03'
  // measurementId ('G-9SEEXSCT50' in the Console snippet) deliberately left
  // out — that's for Firebase Analytics (firebase/analytics), which is a
  // separate product from Firestore sync and isn't wired into this app.
  // Adding it would mean sending usage telemetry to Google from what's
  // meant to be a local-first, minimal-external-dependency tool — a real
  // product decision, not just a config value. If you do want it later,
  // add measurementId back here and `import { getAnalytics } from
  // "firebase/analytics"` in the renderer (analytics is a browser-side
  // product, not something sync-firebase.js — which runs in the main
  // process — would ever touch).
};