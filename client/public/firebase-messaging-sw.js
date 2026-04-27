// Firebase Cloud Messaging Service Worker
// This handles background push notifications

// Give the service worker access to Firebase Messaging.
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Initialize the Firebase app in the service worker
firebase.initializeApp({
  apiKey: 'REPLACE_WITH_FIREBASE_API_KEY',
  authDomain: 'civiclemma.firebaseapp.com',
  projectId: 'civiclemma',
  storageBucket: 'civiclemma.firebasestorage.app',
  messagingSenderId: '160362202198',
  appId: '1:160362202198:web:000ee6e3f15755e656e7f7',
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM SW] Background message received:', payload);

  const notificationTitle = payload.notification?.title || 'New Issue';
  const notificationOptions = {
    body: payload.notification?.body || 'New issue reported in your jurisdiction.',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    vibrate: [100, 50, 100],
    data: payload.data || {},
    tag: 'civiclemma-fcm',
    renotify: true,
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
