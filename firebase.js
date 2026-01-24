import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, serverTimestamp,
  query, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Paste your real Firebase config later.
// This guard prevents a blank page before config is set.
const firebaseConfig = {
  apiKey: "YOUR_KEY",
  authDomain: "YOUR_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_BUCKET",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

function configLooksUnset(cfg) {
  const vals = Object.values(cfg || {});
  return vals.some(v => typeof v === "string" && v.includes("YOUR_"));
}

let db = null;

if (!configLooksUnset(firebaseConfig)) {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} else {
  console.warn("[firebase] Config not set yet — uploads/leaderboard disabled.");
}

export {
  db, collection, addDoc, serverTimestamp,
  query, orderBy, limit, getDocs
};