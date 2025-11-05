// Firebase configuration and initialization
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import { getFirestore, doc, setDoc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore'

// Your Firebase config - GET THIS FROM FIREBASE CONSOLE
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
}

// Initialize Firebase
const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)

// Create or get user profile
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

export { auth, db }