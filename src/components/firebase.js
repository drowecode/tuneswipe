// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, arrayUnion } from "firebase/firestore";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDGntgef6ZTEWpoXOVSSbx3evfWzhGoaGo",
  authDomain: "tuneswi.firebaseapp.com",
  projectId: "tuneswi",
  storageBucket: "tuneswi.firebasestorage.app",
  messagingSenderId: "1064407703187",
  appId: "1:1064407703187:web:a5e052bebe634d5bc5f766",
  measurementId: "G-0JPL80ZPNB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
export const db = getFirestore(app);

export const createUserProfile = async (spotifyData) => {
  try {
    // Sign in anonymously or use existing session
    const userCredential = await signInAnonymously(auth)
    const userId = userCredential.user.uid

    // Check if user profile exists
    const userRef = doc(db, 'users', userId)
    const userDoc = await getDoc(userRef)

    if (!userDoc.exists()) {
      // Create new user profile
      await setDoc(userRef, {
        spotifyId: spotifyData.spotifyId,
        username: spotifyData.username,
        createdAt: new Date().toISOString(),
        preferences: {
          loved: [],
          liked: [],
          disliked: [],
          hated: []
        },
        topArtists: spotifyData.topArtists || [],
        topGenres: spotifyData.topGenres || []
      })
    } else {
      // Update existing profile with latest Spotify data
      await updateDoc(userRef, {
        spotifyId: spotifyData.spotifyId,
        username: spotifyData.username,
        topArtists: spotifyData.topArtists || [],
        topGenres: spotifyData.topGenres || []
      })
    }

    return userId
  } catch (error) {
    console.error('Error creating user profile:', error)
    throw error
  }
}

// Save user preference (love, like, dislike)
export const savePreference = async (userId, trackData, preferenceType) => {
  try {
    const userRef = doc(db, 'users', userId)
    
    await updateDoc(userRef, {
      [`preferences.${preferenceType}`]: arrayUnion({
        trackId: trackData.id,
        name: trackData.name,
        artist: trackData.artist,
        uri: trackData.uri,
        timestamp: new Date().toISOString()
      })
    })
  } catch (error) {
    console.error('Error saving preference:', error)
  }
}

// Get user preferences
export const getUserPreferences = async (userId) => {
  try {
    const userRef = doc(db, 'users', userId)
    const userDoc = await getDoc(userRef)
    
    if (userDoc.exists()) {
      return userDoc.data().preferences
    }
    return null
  } catch (error) {
    console.error('Error getting preferences:', error)
    return null
  }
}

// Listen to auth state changes
export const onAuthChange = (callback) => {
  return onAuthStateChanged(auth, callback)
}

export { auth }