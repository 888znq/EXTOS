// Firebase settings for Split View.
//
// Copied from your Notes app (same Firebase project). Split View only talks to
// the Realtime Database over its REST API, so only `databaseURL` is actually
// used — the rest is kept so the config matches the Notes app exactly.
//
// PRIVACY / SAFETY: Split View reads and writes ONE branch only:
//     splitView/main
// It never touches `textNotes/…` (your Notes app) or anything else in the
// database, and it never writes to the database root.
window.SPLIT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAYHA8Qw3Qw3Qzbyg8MtjrSKcJusNi4VaA6V4",
  authDomain: "system-data-bf026.firebaseapp.com",
  databaseURL: "https://system-data-bf026-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "system-data-bf026",
  storageBucket: "system-data-bf026.firebasestorage.app",
  messagingSenderId: "718302899022",
  appId: "1:718302899022:web:f1675dbcc293e138c68c1f"
};

// Database path used by Split View. Change the last part (e.g. "phone") to keep
// separate setups per device group.
window.SPLIT_DB_PATH = "splitView/main";
