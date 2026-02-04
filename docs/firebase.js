import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";

import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

import {
  getFirestore,
  doc, getDoc, setDoc,
  collection, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyARJOjG8qenV7E5EzhNFYeTJdLoZrxM_E4",
  authDomain: "behavioural-biometrics-b52e4.firebaseapp.com",
  projectId: "behavioural-biometrics-b52e4",
  storageBucket: "behavioural-biometrics-b52e4.firebasestorage.app",
  messagingSenderId: "335083928247",
  appId: "1:335083928247:web:c872ba3278a7b49f892b32",
  measurementId: "G-N310K3ZT4M"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export {
  auth, signInAnonymously,
  db, doc, getDoc, setDoc, collection, addDoc, serverTimestamp,
  storage, ref, uploadBytes
};
