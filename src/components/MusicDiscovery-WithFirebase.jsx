import React, { useState, useEffect } from 'react'
import { Heart, ThumbsUp, Meh, ThumbsDown, TrendingUp, Music, User, BarChart3, Sliders, Plus, Check, X, ChevronDown, ChevronUp } from 'lucide-react'
import './MusicDiscovery.css'
import { createUserProfile, savePreference, getUserPreferences, onAuthChange } from './firebase'

const MusicDiscovery = () => {
  const [isConnected, setIsConnected] = useState(false)
  const [spotifyToken, setSpotifyToken] = useState(null)
  const [userId, setUserId] = useState(null)
  const [currentView, setCurrentView] = useState('discover') // discover, stats
  const [discoveryMode, setDiscoveryMode] = useState(50) // 0-100, 0=familiar, 100=exploratory
  const [selectedGenres, setSelectedGenres] = useState(['all']) // Selected genre filters
  const [showGenreFilter, setShowGenreFilter] = useState(false) // Show/hide genre dropdown
  const [filtersCollapsed, setFiltersCollapsed] = useState(false) // Collapse entire filters section
  const [isLoading, setIsLoading] = useState(false)
  
  // Spotify Web Player
  const [player, setPlayer] = useState(null)
  const [deviceId, setDeviceId] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playerReady, setPlayerReady] = useState(false)
  const [currentPosition, setCurrentPosition] = useState(0) // Current playback position in ms
  const [trackDuration, setTrackDuration] = useState(0) // Track duration in ms
  
  // User data
  const [userStats, setUserStats] = useState(null)
  const [currentTrack, setCurrentTrack] = useState(null)
  const [recommendations, setRecommendations] = useState([])
  const [likedSongIds, setLikedSongIds] = useState(new Set()) // Track Spotify liked song IDs
  const [userPreferences, setUserPreferences] = useState({
    loved: [],
    liked: [],
    disliked: [],
    hated: []
  })
  
  // Store artist genres for better filtering
  const [artistGenresMap, setArtistGenresMap] = useState(new Map())

  // Spotify API config
  const SPOTIFY_CLIENT_ID = '317c65a797af484fb3e2af110acdfd72' // Your client ID
  const REDIRECT_URI = 'https://www.tuneswipe.xyz'
  const SPOTIFY_AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize'
  const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token'
  const SPOTIFY_SCOPES = [
    'user-library-modify',
    'user-library-read',
    'user-top-read',
    'user-read-recently-played',
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-modify-playback-state',
    'user-read-playback-state'
  ]

  // PKCE helper functions
  const generateRandomString = (length) => {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    const values = crypto.getRandomValues(new Uint8Array(length))
    return values.reduce((acc, x) => acc + possible[x % possible.length], '')
  }

  const sha256 = async (plain) => {
    const encoder = new TextEncoder()
    const data = encoder.encode(plain)
    return window.crypto.subtle.digest('SHA-256', data)
  }

  const base64encode = (input) => {
    return btoa(String.fromCharCode(...new Uint8Array(input)))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  }

  // Check for authorization code or existing token on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const code = urlParams.get('code')
    const storedToken = window.localStorage.getItem('spotify_token')
    const tokenExpiry = window.localStorage.getItem('spotify_token_expiry')

    // Check if stored token is still valid
    if (storedToken && tokenExpiry && Date.now() < parseInt(tokenExpiry)) {
      setSpotifyToken(storedToken)
      fetchSpotifyUserData(storedToken)
    } else if (code) {
      // Exchange code for token
      exchangeCodeForToken(code)
    }
  }, [])

  // Initialize Spotify Web Playback SDK
  useEffect(() => {
    if (!spotifyToken) return

    const script = document.createElement('script')
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.async = true
    document.body.appendChild(script)

    window.onSpotifyWebPlaybackSDKReady = () => {
      const newPlayer = new window.Spotify.Player({
        name: 'TuneSwipe Player',
        getOAuthToken: cb => { cb(spotifyToken) },
        volume: 0.5
      })

      // Ready
      newPlayer.addListener('ready', ({ device_id }) => {
        console.log('Web Playback SDK Ready with Device ID:', device_id)
        setDeviceId(device_id)
        setPlayerReady(true)
      })

      // Not Ready
      newPlayer.addListener('not_ready', ({ device_id }) => {
        console.log('Device has gone offline', device_id)
      })

      // Player state changed
      newPlayer.addListener('player_state_changed', state => {
        if (!state) return
        setIsPlaying(!state.paused)
        setCurrentPosition(state.position)
        setTrackDuration(state.duration)
      })

      newPlayer.connect().then(success => {
        if (success) {
          console.log('Successfully connected to Spotify Web Player')
        }
      })

      setPlayer(newPlayer)
    }

    return () => {
      if (player) {
        player.disconnect()
      }
    }
  }, [spotifyToken])

  // Poll player state for smooth progress updates
  useEffect(() => {
    if (!player || !isPlaying) return

    const interval = setInterval(async () => {
      try {
        const state = await player.getCurrentState()
        if (state) {
          setCurrentPosition(state.position)
          setTrackDuration(state.duration)
        }
      } catch (error) {
        console.error('Error getting player state:', error)
      }
    }, 1000) // Update every second

    return () => clearInterval(interval)
  }, [player, isPlaying])

  // Exchange authorization code for access token
  const exchangeCodeForToken = async (code) => {
    const codeVerifier = window.localStorage.getItem('code_verifier')

    const payload = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    }

    try {
      const response = await fetch(SPOTIFY_TOKEN_ENDPOINT, payload)
      const data = await response.json()

      if (data.access_token) {
        const expiryTime = Date.now() + (data.expires_in * 1000)
        window.localStorage.setItem('spotify_token', data.access_token)
        window.localStorage.setItem('spotify_token_expiry', expiryTime.toString())
        
        if (data.refresh_token) {
          window.localStorage.setItem('spotify_refresh_token', data.refresh_token)
        }

        setSpotifyToken(data.access_token)
        
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname)
        
        // Fetch user data
        fetchSpotifyUserData(data.access_token)
      }
    } catch (error) {
      console.error('Error exchanging code for token:', error)
      alert('Authentication failed. Please try again.')
    }
  }

  // Connect to Spotify using PKCE
  const connectSpotify = async () => {
    const codeVerifier = generateRandomString(64)
    const hashed = await sha256(codeVerifier)
    const codeChallenge = base64encode(hashed)

    window.localStorage.setItem('code_verifier', codeVerifier)

    const params = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SPOTIFY_SCOPES.join(' '),
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
    })

    window.location.href = `${SPOTIFY_AUTH_ENDPOINT}?${params.toString()}`
  }

  // Fetch all user's liked songs (with pagination)
  const fetchAllLikedSongs = async (token) => {
    const likedIds = new Set()
    let url = 'https://api.spotify.com/v1/me/tracks?limit=50'
    let pageCount = 0
    const MAX_PAGES = 20 // Limit to 1000 songs max
    
    try {
      while (url && pageCount < MAX_PAGES) {
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        
        if (!response.ok) {
          console.warn('Could not fetch page', pageCount, 'of liked songs')
          break
        }
        
        const data = await response.json()
        
        // Add all track IDs to the set
        data.items?.forEach(item => {
          if (item.track?.id) {
            likedIds.add(item.track.id)
          }
        })
        
        // Get next page URL (null if no more pages)
        url = data.next
        pageCount++
        
        // Small delay to avoid rate limiting
        if (url) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
      
      console.log(`Fetched ${likedIds.size} liked songs from Spotify (${pageCount} pages)`)
    } catch (error) {
      console.error('Error fetching liked songs:', error)
      // Return whatever we got so far
    }
    
    return likedIds
  }

  // Fetch artist genres for better filtering
  const fetchArtistGenres = async (artistIds, token) => {
    const genresMap = new Map()
    
    // Fetch in batches of 50 (Spotify API limit)
    const batchSize = 50
    for (let i = 0; i < artistIds.length; i += batchSize) {
      const batch = artistIds.slice(i, i + batchSize)
      try {
        const response = await fetch(
          `https://api.spotify.com/v1/artists?ids=${batch.join(',')}`,
          {
            headers: { 'Authorization': `Bearer ${token}` }
          }
        )
        
        if (response.ok) {
          const data = await response.json()
          data.artists?.forEach(artist => {
            if (artist && artist.id && artist.genres) {
              genresMap.set(artist.id, artist.genres)
            }
          })
        }
        
        // Small delay to avoid rate limiting
        if (i + batchSize < artistIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      } catch (error) {
        console.error('Error fetching artist genres:', error)
      }
    }
    
    return genresMap
  }

  // Fetch Spotify user data
  const fetchSpotifyUserData = async (token) => {
    try {
      setIsLoading(true)
      
      // Get Spotify user profile
      const profileResponse = await fetch('https://api.spotify.com/v1/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const profile = await profileResponse.json()

      if (profileResponse.status === 401) {
        // Token expired
        window.localStorage.removeItem('spotify_token')
        window.localStorage.removeItem('spotify_token_expiry')
        setSpotifyToken(null)
        setIsConnected(false)
        setIsLoading(false)
        return
      }

      // Get top artists
      const topArtistsResponse = await fetch('https://api.spotify.com/v1/me/top/artists?limit=20&time_range=medium_term', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const topArtists = await topArtistsResponse.json()

      // Get top tracks
      const topTracksResponse = await fetch('https://api.spotify.com/v1/me/top/tracks?limit=20&time_range=medium_term', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const topTracks = await topTracksResponse.json()

      // Get user's liked songs (to filter out from recommendations)
      console.log('Fetching user liked songs...')
      const likedSongs = await fetchAllLikedSongs(token)
      console.log(`Found ${likedSongs.size} liked songs`)
      setLikedSongIds(likedSongs)

      // Extract genres from top artists
      const genresMap = {}
      topArtists.items?.forEach(artist => {
        artist.genres?.forEach(genre => {
          genresMap[genre] = (genresMap[genre] || 0) + 1
        })
      })
      const topGenres = Object.entries(genresMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([genre]) => ({ name: genre }))

      const userData = {
        username: profile.display_name || profile.id,
        spotifyId: profile.id,
        topArtists: topArtists.items || [],
        topTracks: topTracks.items || [],
        topGenres: topGenres
      }

      setUserStats(userData)

      // Create/update Firebase user profile
      try {
        const firebaseUserId = await createUserProfile({
          spotifyId: userData.spotifyId,
          username: userData.username,
          topArtists: userData.topArtists.slice(0, 10).map(a => ({ name: a.name, id: a.id })),
          topGenres: userData.topGenres
        })
        setUserId(firebaseUserId)

        // Load user preferences from Firebase
        const savedPreferences = await getUserPreferences(firebaseUserId)
        if (savedPreferences) {
          setUserPreferences(savedPreferences)
        }
      } catch (error) {
        console.warn('Firebase unavailable - continuing without cloud sync:', error.message)
        // Continue without Firebase - preferences will be local only
      }

      setIsConnected(true)
      
      // Get initial recommendations
      try {
        await getRecommendations(topArtists.items || [], token)
      } catch (recError) {
        console.error('Error loading recommendations:', recError)
        // Continue anyway - user can manually trigger recommendations
      }
      
      setIsLoading(false)
    } catch (error) {
      console.error('Error fetching Spotify data:', error)
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      })
      setIsLoading(false)
      alert(`Error connecting to Spotify: ${error.message}\n\nPlease try reconnecting or refresh the page.`)
    }
  }

  // Play a track using Spotify Web Playback SDK
  const playTrack = async (trackUri) => {
    if (!deviceId || !spotifyToken) {
      console.log('Player not ready - deviceId:', deviceId, 'token:', !!spotifyToken)
      return
    }

    try {
      // First, transfer playback to this device
      await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        body: JSON.stringify({ 
          device_ids: [deviceId],
          play: false
        }),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${spotifyToken}`
        }
      })

      // Small delay to ensure transfer completes
      await new Promise(resolve => setTimeout(resolve, 500))

      // Now play the track
      const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        body: JSON.stringify({ uris: [trackUri] }),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${spotifyToken}`
        }
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('Play error:', errorData)
        
        // If premium required, inform user
        if (errorData.error?.reason === 'PREMIUM_REQUIRED') {
          alert('Spotify Premium is required to use the web player. You can still browse and like songs!')
        }
      } else {
        console.log('Successfully started playback')
      }
    } catch (error) {
      console.error('Error playing track:', error)
    }
  }

  // Toggle play/pause
  const togglePlayback = async () => {
    if (!player || !playerReady) {
      console.log('Player not ready')
      // Fallback: open in Spotify
      if (currentTrack) {
        window.open(currentTrack.external_urls?.spotify || `https://open.spotify.com/track/${currentTrack.id}`, '_blank')
      }
      return
    }

    try {
      // Check if we have a track loaded
      const state = await player.getCurrentState()
      
      if (!state) {
        // No track loaded, start playing the current track
        console.log('No track loaded, starting playback...')
        if (currentTrack?.uri) {
          await playTrack(currentTrack.uri)
        }
      } else {
        // Track is loaded, toggle play/pause
        await player.togglePlay()
        console.log('Toggled playback')
      }
    } catch (error) {
      console.error('Error toggling playback:', error)
      // If web player fails, offer to open in Spotify
      if (currentTrack) {
        const openSpotify = confirm('Web player unavailable. Open in Spotify app?')
        if (openSpotify) {
          window.open(currentTrack.external_urls?.spotify || `https://open.spotify.com/track/${currentTrack.id}`, '_blank')
        }
      }
    }
  }

  // Format time from milliseconds to MM:SS
  const formatTime = (ms) => {
    if (!ms || ms === 0) return '0:00'
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // Handle seeking through track
  const handleSeek = async (event) => {
    if (!player || !playerReady) return
    
    const seekPosition = parseInt(event.target.value)
    try {
      await player.seek(seekPosition)
      setCurrentPosition(seekPosition)
    } catch (error) {
      console.error('Error seeking:', error)
    }
  }

  // Get recommendations using audio features (works in Development Mode)
  const getRecommendations = async (topArtists, token) => {
    console.log('getRecommendations called (using audio features approach)')
    
    if (!token) {
      console.error('No Spotify token available')
      return
    }

    try {
      // Get recently played tracks (works in dev mode)
      console.log('Fetching recently played tracks...')
      const recentlyPlayedResponse = await fetch(
        'https://api.spotify.com/v1/me/player/recently-played?limit=50',
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      )

      if (!recentlyPlayedResponse.ok) {
        console.error('Failed to fetch recently played:', recentlyPlayedResponse.status)
        
        // Fallback to top tracks if recently played doesn't work
        const topTracksResponse = await fetch(
          'https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term',
          {
            headers: { 'Authorization': `Bearer ${token}` }
          }
        )
        
        if (!topTracksResponse.ok) {
          alert('Unable to fetch your listening history. Please try reconnecting.')
          return
        }
        
        const topTracksData = await topTracksResponse.json()
        const tracks = topTracksData.items || []
        
        if (tracks.length === 0) {
          alert('No listening history found. Listen to some music on Spotify first!')
          return
        }
        
        // Filter out already liked songs from top tracks
        const notLikedTopTracks = tracks.filter(track => !likedSongIds.has(track.id))
        
        console.log(`Top tracks: ${tracks.length}, After filtering liked: ${notLikedTopTracks.length}`)
        
        if (notLikedTopTracks.length === 0) {
          alert('All your top tracks are already liked! Great taste! Try listening to new music.')
          return
        }
        
        // Fetch artist genres for better filtering
        const allArtistIds = [...new Set(notLikedTopTracks.flatMap(track => 
          track.artists?.map(a => a.id) || []
        ))]
        console.log('Fetching genres for', allArtistIds.length, 'artists...')
        const genresMap = await fetchArtistGenres(allArtistIds, token)
        setArtistGenresMap(genresMap)
        
        // Apply genre filter
        const genreFilteredTracks = filterTracksByGenre(notLikedTopTracks, genresMap)
        
        if (genreFilteredTracks.length === 0) {
          alert('No tracks match your selected genres. Try selecting different genres or choose "All".')
          return
        }
        
        // Use the user's top tracks (filtered) as recommendations
        console.log('Using filtered top tracks as recommendations:', genreFilteredTracks.length)
        setRecommendations(genreFilteredTracks)
        setCurrentTrack(genreFilteredTracks[0])
        return
      }

      const recentlyPlayedData = await recentlyPlayedResponse.json()
      const recentTracks = recentlyPlayedData.items?.map(item => item.track) || []
      
      console.log('Recently played tracks:', recentTracks.length)

      if (recentTracks.length === 0) {
        alert('No recent listening history found. Play some music on Spotify first!')
        return
      }

      // Remove duplicates
      const uniqueTracks = recentTracks.filter((track, index, self) =>
        index === self.findIndex((t) => t.id === track.id)
      )

      console.log('Unique tracks:', uniqueTracks.length)
      console.log('Liked songs Set size:', likedSongIds.size)

      // Filter out songs user has already liked on Spotify
      const notLikedTracks = uniqueTracks.filter(track => {
        const isLiked = likedSongIds.has(track.id)
        if (isLiked) {
          console.log('✓ Filtering out liked song:', track.name, 'ID:', track.id)
        }
        return !isLiked
      })
      
      console.log(`Filtered out ${uniqueTracks.length - notLikedTracks.length} already-liked songs`)
      console.log('Tracks after filtering liked songs:', notLikedTracks.length)
      
      // Fetch artist genres for better filtering
      const allArtistIds = [...new Set(notLikedTracks.flatMap(track => 
        track.artists?.map(a => a.id) || []
      ))]
      console.log('Fetching genres for', allArtistIds.length, 'artists...')
      const genresMap = await fetchArtistGenres(allArtistIds, token)
      setArtistGenresMap(genresMap)
      
      // Apply genre filter
      const genreFilteredTracks = filterTracksByGenre(notLikedTracks, genresMap)
      
      console.log(`Genre filter (${selectedGenres.join(', ')}): ${notLikedTracks.length} → ${genreFilteredTracks.length} tracks`)
      
      if (genreFilteredTracks.length > 0) {
        console.log('Sample tracks passing all filters:', genreFilteredTracks.slice(0, 3).map(t => ({ 
          name: t.name, 
          artist: t.artists?.[0]?.name,
          id: t.id 
        })))
      }

      if (genreFilteredTracks.length === 0) {
        alert('No tracks match your selected genres. Try selecting different genres or choose "All".')
        return
      }

      // Based on discovery mode, select tracks
      // 0 = Most recent/familiar songs
      // 50 = Mix of recent and random
      // 100 = Completely random/exploratory
      let selectedTracks = []
      
      const availableTracks = [...genreFilteredTracks] // Use genre-filtered tracks
      
      if (discoveryMode === 0) {
        // 0% exploratory - just most recent
        selectedTracks = availableTracks.slice(0, 20)
        console.log('Discovery mode: 0% - Using most recent tracks')
      } else if (discoveryMode === 100) {
        // 100% exploratory - completely random
        selectedTracks = availableTracks
          .sort(() => Math.random() - 0.5)
          .slice(0, 20)
        console.log('Discovery mode: 100% - Completely randomized')
      } else {
        // Mixed mode - blend recent and random based on percentage
        const numRecent = Math.floor(20 * (1 - discoveryMode / 100))
        const numRandom = 20 - numRecent
        
        console.log(`Discovery mode: ${discoveryMode}% - ${numRecent} recent + ${numRandom} random`)
        
        // Take some recent tracks
        const recentPicks = availableTracks.slice(0, numRecent)
        
        // Take some random tracks (excluding the ones we already picked)
        const remainingTracks = availableTracks.slice(numRecent)
        const randomPicks = remainingTracks
          .sort(() => Math.random() - 0.5)
          .slice(0, numRandom)
        
        // Combine and shuffle
        selectedTracks = [...recentPicks, ...randomPicks]
          .sort(() => Math.random() - 0.5)
      }

      console.log('Selected tracks for recommendations:', selectedTracks.length)
      console.log('Discovery mode result:', selectedTracks.slice(0, 3).map(t => t.name))

      if (selectedTracks.length > 0) {
        setRecommendations(selectedTracks)
        setCurrentTrack(selectedTracks[0])
        
        // Try to auto-play the first track (will fail gracefully if no premium)
        if (selectedTracks[0].uri && deviceId) {
          setTimeout(() => {
            playTrack(selectedTracks[0].uri)
          }, 1000)
        }
        
        console.log('Successfully loaded:', selectedTracks[0].name, 'by', selectedTracks[0].artists[0].name)
      } else {
        alert('No tracks available. Try playing more music on Spotify!')
      }

    } catch (error) {
      console.error('Error getting recommendations:', error)
      alert('Error loading music: ' + error.message + '\n\nTip: Make sure you have recent listening history on Spotify.')
    }
  }

  // Filter tracks by selected genres - FIXED VERSION
  const filterTracksByGenre = (tracks, genresMap) => {
    if (selectedGenres.includes('all')) {
      return tracks
    }
    
    return tracks.filter(track => {
      const artistIds = track.artists?.map(a => a.id) || []
      
      // Get all genres for this track's artists
      let trackGenres = new Set()
      artistIds.forEach(artistId => {
        const genres = genresMap.get(artistId)
        if (genres && genres.length > 0) {
          genres.forEach(genre => trackGenres.add(genre.toLowerCase()))
        }
      })
      
      // CRITICAL FIX: If track has no genre data, exclude it when specific genres are selected
      // This ensures we only show tracks that match the selected genres
      if (trackGenres.size === 0) {
        console.log(`❌ No genre data for track: ${track.name} - excluding from filtered results`)
        return false
      }
      
      // Check if any track genre matches any selected genre
      for (const selectedGenre of selectedGenres) {
        const normalizedSelected = selectedGenre.toLowerCase().replace('-', ' ')
        for (const trackGenre of trackGenres) {
          // Check for partial matches (e.g., "hip-hop" matches "hip hop", "pop" matches "k-pop")
          if (trackGenre.includes(normalizedSelected) || 
              trackGenre.includes(selectedGenre.replace('-', ''))) {
            console.log(`✓ Genre match: ${track.name} - ${trackGenre} matches ${selectedGenre}`)
            return true
          }
        }
      }
      
      console.log(`❌ No genre match for track: ${track.name} - genres: ${[...trackGenres].join(', ')}`)
      return false
    })
  }

  // Add track to Spotify liked songs
  const addToSpotifyLiked = async (trackUri) => {
    if (!spotifyToken) return

    try {
      const trackId = trackUri.split(':')[2]
      await fetch(`https://api.spotify.com/v1/me/tracks?ids=${trackId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${spotifyToken}`,
          'Content-Type': 'application/json'
        }
      })
      alert('Added to your Spotify Liked Songs! ✓')
    } catch (error) {
      console.error('Error adding to Spotify:', error)
      alert('Could not add to Spotify. Please try again.')
    }
  }

  // Handle reaction to current track
  const handleReaction = async (reaction, addToLiked = false) => {
    if (!currentTrack) return

    const trackData = {
      id: currentTrack.id,
      name: currentTrack.name,
      artist: currentTrack.artists ? currentTrack.artists[0].name : currentTrack.artist,
      uri: currentTrack.uri,
      timestamp: Date.now()
    }

    // Add to Spotify liked songs if requested
    if (addToLiked && currentTrack.uri) {
      await addToSpotifyLiked(currentTrack.uri)
    }

    // Update local preferences
    const newPreferences = { ...userPreferences }
    
    switch(reaction) {
      case 'love':
        newPreferences.loved = [...(newPreferences.loved || []), trackData]
        // Save to Firebase (silently fail if unavailable)
        if (userId) {
          try {
            await savePreference(userId, trackData, 'loved')
          } catch (error) {
            console.warn('Could not save to Firebase:', error.message)
          }
        }
        break
      case 'like':
        newPreferences.liked = [...(newPreferences.liked || []), trackData]
        if (userId) {
          try {
            await savePreference(userId, trackData, 'liked')
          } catch (error) {
            console.warn('Could not save to Firebase:', error.message)
          }
        }
        break
      case 'meh':
        // Don't save meh reactions
        break
      case 'dislike':
        newPreferences.disliked = [...(newPreferences.disliked || []), trackData]
        if (userId) {
          try {
            await savePreference(userId, trackData, 'disliked')
          } catch (error) {
            console.warn('Could not save to Firebase:', error.message)
          }
        }
        break
      default:
        break
    }

    setUserPreferences(newPreferences)

    // Move to next track
    const currentIndex = recommendations.findIndex(
      track => track.uri === currentTrack.uri
    )
    
    if (currentIndex < recommendations.length - 1) {
      const nextTrack = recommendations[currentIndex + 1]
      setCurrentTrack(nextTrack)
      
      // Auto-play next track (with delay to ensure player is ready)
      if (nextTrack.uri && deviceId) {
        setTimeout(() => {
          playTrack(nextTrack.uri)
        }, 500)
      }
    } else {
      // Get more recommendations when we run out
      if (userStats?.topArtists && spotifyToken) {
        await getRecommendations(userStats.topArtists, spotifyToken)
      }
    }
  }

  // Update recommendations when discovery mode or genre filters change (with debounce)
  useEffect(() => {
    if (isConnected && userStats?.topArtists && spotifyToken) {
      console.log('Discovery mode or genres changed:', discoveryMode, selectedGenres)
      const timeoutId = setTimeout(() => {
        console.log('Fetching new recommendations for discovery mode:', discoveryMode, 'genres:', selectedGenres)
        getRecommendations(userStats.topArtists, spotifyToken)
      }, 500) // Wait 500ms after user stops making changes
      
      return () => clearTimeout(timeoutId)
    }
  }, [discoveryMode, selectedGenres, isConnected, userStats, spotifyToken])

  // Login view
  if (!isConnected) {
    return (
      <div className="app-container">
        <div className="login-card">
          <div className="logo-section">
            <Music size={64} className="logo-icon" />
            <h1>TuneSwipe</h1>
            <p>Discover music that adapts to your taste</p>
          </div>

          <div className="login-form">
            {isLoading ? (
              <div className="loading-state">
                <Music size={48} className="spinning" />
                <p>Setting up your profile...</p>
              </div>
            ) : (
              <>
                <button onClick={connectSpotify} className="connect-button spotify-button">
                  <Music size={24} />
                  Connect with Spotify
                </button>
                
                <div className="info-box">
                  <p><strong>What you'll get:</strong></p>
                  <ul>
                    <li>Personalized music recommendations</li>
                    <li>Add songs directly to your Spotify Liked Songs</li>
                    <li>View your listening stats and top tracks</li>
                    <li>Discovery mode that learns your taste</li>
                  </ul>
                  <p className="permission-note">We'll only access your listening history and ability to save songs.</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Common music genres for filtering
  const availableGenres = [
    'all',
    'pop',
    'rock',
    'hip-hop',
    'rap',
    'r&b',
    'indie',
    'electronic',
    'edm',
    'dance',
    'house',
    'techno',
    'country',
    'folk',
    'jazz',
    'blues',
    'classical',
    'metal',
    'punk',
    'alternative',
    'soul',
    'funk',
    'reggae',
    'latin',
    'k-pop',
    'j-pop',
    'afrobeat'
  ]

  // Toggle genre selection
  const toggleGenre = (genre) => {
    if (genre === 'all') {
      setSelectedGenres(['all'])
    } else {
      setSelectedGenres(prev => {
        // Remove 'all' if selecting specific genre
        const withoutAll = prev.filter(g => g !== 'all')
        
        if (withoutAll.includes(genre)) {
          // Remove the genre
          const newGenres = withoutAll.filter(g => g !== genre)
          // If no genres selected, default to 'all'
          return newGenres.length === 0 ? ['all'] : newGenres
        } else {
          // Add the genre
          return [...withoutAll, genre]
        }
      })
    }
  }

  // Get greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'good morning'
    if (hour < 18) return 'good afternoon'
    return 'good evening'
  }

  // Get discovery message based on time
  const getDiscoveryMessage = () => {
    const hour = new Date().getHours()
    if (hour >= 5 && hour < 12) {
      return 'Discovery based on your morning vibes'
    } else if (hour >= 12 && hour < 17) {
      return 'Discovery based on your afternoon mood'
    } else if (hour >= 17 && hour < 21) {
      return 'Discovery based on your evening energy'
    } else {
      return 'Discovery based on your late night feels'
    }
  }

  // Main app view
  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-content">
          <div className="header-left">
            <Music size={32} />
            <h2>TuneSwipe</h2>
          </div>
          <div className="header-right">
            <button 
              className={`nav-button ${currentView === 'discover' ? 'active' : ''}`}
              onClick={() => setCurrentView('discover')}
            >
              <TrendingUp size={20} />
              Discover
            </button>
            <button 
              className={`nav-button ${currentView === 'stats' ? 'active' : ''}`}
              onClick={() => setCurrentView('stats')}
            >
              <BarChart3 size={20} />
              Stats
            </button>
            <div className="user-badge">
              <User size={16} />
              {userStats?.username}
            </div>
          </div>
        </div>
      </header>

      {/* Discovery View */}
      {currentView === 'discover' && (
        <div className="discover-view">
          {/* Greeting Header */}
          <div className="greeting-header">
            <h1>{getGreeting()}</h1>
            <p className="discovery-message">{getDiscoveryMessage()}</p>
          </div>

          {/* Collapsible Discovery Controls */}
          <div className="discovery-controls">
            <div className="filters-header" onClick={() => setFiltersCollapsed(!filtersCollapsed)}>
              <div className="filters-title">
                <Sliders size={20} />
                <span>Filters</span>
              </div>
              <button className="collapse-button">
                {filtersCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
              </button>
            </div>

            {!filtersCollapsed && (
              <>
                {/* Discovery Mode Slider */}
                <div className="slider-container">
                  <div className="slider-labels">
                    <span>Familiar</span>
                    <span className="slider-percentage">{discoveryMode}% exploratory</span>
                    <span>Exploratory</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={discoveryMode}
                    onChange={(e) => setDiscoveryMode(Number(e.target.value))}
                    className="discovery-slider"
                  />
                </div>

                {/* Genre Filter Dropdown */}
                <div className="genre-filter-container">
                  <button 
                    className="genre-filter-button"
                    onClick={() => setShowGenreFilter(!showGenreFilter)}
                  >
                    <Sliders size={18} />
                    <span>Genre Filter</span>
                    <span className="selected-count">
                      {selectedGenres.includes('all') ? 'All' : `${selectedGenres.length}`}
                    </span>
                    <span className={`dropdown-arrow ${showGenreFilter ? 'open' : ''}`}>▼</span>
                  </button>
                  
                  {showGenreFilter && (
                    <div className="genre-dropdown">
                      <div className="genre-tags-filter">
                        {availableGenres.map(genre => (
                          <button
                            key={genre}
                            className={`genre-tag-filter ${selectedGenres.includes(genre) ? 'active' : ''}`}
                            onClick={() => toggleGenre(genre)}
                          >
                            {genre === 'all' ? '✓ All' : genre}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Current Track Card */}
          {currentTrack ? (
            <div className="track-card-new">
              {/* Horizontal Layout: Photo Left, Info Right */}
              <div className="track-card-horizontal">
                {/* Album Art - Left Side */}
                <div className="album-art-left">
                  {currentTrack.album?.images && currentTrack.album.images[0] ? (
                    <img src={currentTrack.album.images[0].url} alt={currentTrack.name} className="album-image" />
                  ) : (
                    <div className="placeholder-image">
                      <Music size={80} />
                    </div>
                  )}
                </div>

                {/* Track Details - Right Side */}
                <div className="track-details-right">
                  <h2 className="song-title">{currentTrack.name}</h2>
                  <h3 className="artist-name">{currentTrack.artists ? currentTrack.artists.map(a => a.name).join(', ') : ''}</h3>
                  <p className="album-name">{currentTrack.album?.name}</p>
                  
                  {/* Stats */}
                  {currentTrack.popularity && (
                    <div className="popularity-stat">
                      <TrendingUp size={18} />
                      <span>{currentTrack.popularity}/100</span>
                    </div>
                  )}
                  
                  {/* Open in Spotify Link */}
                  <button
                    className="spotify-link-btn"
                    onClick={() => window.open(currentTrack.external_urls?.spotify || `https://open.spotify.com/track/${currentTrack.id}`, '_blank')}
                    title="Open in Spotify"
                  >
                    🎵 Open in Spotify
                  </button>
                </div>
              </div>

              {/* Playback Progress Slider with Controls */}
              <div className="playback-progress-section">
                <div className="playback-controls-row">
                  {/* Play/Pause Button */}
                  <button 
                    className="play-button-control"
                    onClick={togglePlayback}
                    disabled={!playerReady}
                    title={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? '⏸' : '▶'}
                  </button>
                  
                  {/* Progress Slider and Time */}
                  <div className="progress-container">
                    <div className="progress-info">
                      <span className="time-current">{formatTime(currentPosition)}</span>
                      <span className="time-total">{formatTime(trackDuration)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max={trackDuration || 100}
                      value={currentPosition}
                      onChange={handleSeek}
                      className="progress-slider"
                      disabled={!playerReady || !isPlaying}
                      title="Seek through track (Premium required)"
                    />
                  </div>
                </div>
                
                {!playerReady && (
                  <p className="playback-note">
                    Web playback requires Spotify Premium • Use "Open in Spotify" to listen
                  </p>
                )}
              </div>

              {/* Large Reaction Buttons - Bottom */}
              <div className="reaction-buttons-bottom">
                <button 
                  className="reaction-btn-xlarge dislike-btn-xlarge"
                  onClick={() => handleReaction('dislike')}
                  title="Skip"
                >
                  <X size={50} strokeWidth={3} />
                </button>
                
                <button 
                  className="reaction-btn-xlarge like-btn-xlarge"
                  onClick={() => handleReaction('like', true)}
                  title="Like & Save"
                >
                  <Check size={50} strokeWidth={3} />
                </button>
              </div>
            </div>
          ) : (
            <div className="loading-message">
              <Music size={48} className="spinning" />
              <p>Loading recommendations...</p>
            </div>
          )}

          {/* Preference Summary */}
          <div className="preference-summary">
            <div className="pref-stat">
              <Heart size={20} className="love-color" />
              <span>{userPreferences.loved.length} loved</span>
            </div>
            <div className="pref-stat">
              <ThumbsUp size={20} className="like-color" />
              <span>{userPreferences.liked.length} liked</span>
            </div>
            <div className="pref-stat">
              <ThumbsDown size={20} className="dislike-color" />
              <span>{userPreferences.disliked.length} disliked</span>
            </div>
          </div>
        </div>
      )}

      {/* Stats View */}
      {currentView === 'stats' && userStats && (
        <div className="stats-view">
          <div className="stats-header">
            <h2>Your Music Profile</h2>
            <p className="total-scrobbles">Powered by Spotify</p>
          </div>

          <div className="stats-grid">
            {/* Top Artists */}
            <div className="stat-section">
              <h3>Top Artists</h3>
              <div className="stat-list">
                {userStats.topArtists.slice(0, 10).map((artist, index) => (
                  <div key={index} className="stat-item">
                    <span className="stat-rank">{index + 1}</span>
                    {artist.images && artist.images[2] && (
                      <img src={artist.images[2].url} alt={artist.name} className="artist-image" />
                    )}
                    <span className="stat-name">{artist.name}</span>
                    {artist.genres && artist.genres.length > 0 && (
                      <span className="stat-genre">{artist.genres[0]}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Top Tracks */}
            <div className="stat-section">
              <h3>Top Tracks</h3>
              <div className="stat-list">
                {userStats.topTracks.slice(0, 10).map((track, index) => (
                  <div key={index} className="stat-item">
                    <span className="stat-rank">{index + 1}</span>
                    {track.album?.images && track.album.images[2] && (
                      <img src={track.album.images[2].url} alt={track.name} className="track-image-small" />
                    )}
                    <div className="stat-track-info">
                      <span className="stat-name">{track.name}</span>
                      <span className="stat-artist">{track.artists?.map(a => a.name).join(', ')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Genres */}
            <div className="stat-section full-width">
              <h3>Top Genres</h3>
              <div className="genre-tags">
                {userStats.topGenres.map((genre, index) => (
                  <div key={index} className="genre-tag">
                    {genre.name}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MusicDiscovery