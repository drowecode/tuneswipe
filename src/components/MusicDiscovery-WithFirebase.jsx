import React, { useState, useEffect } from 'react'
import { Heart, ThumbsUp, Meh, ThumbsDown, TrendingUp, Music, User, BarChart3, Sliders, Plus, Check, X, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import './MusicDiscovery.css'
import { createUserProfile, savePreference, getUserPreferences, onAuthChange } from './firebase'

const MusicDiscovery = () => {
  const [isConnected, setIsConnected] = useState(false)
  const [spotifyToken, setSpotifyToken] = useState(null)
  const [userId, setUserId] = useState(null)
  const [tokenExpiresAt, setTokenExpiresAt] = useState(null)
  const [currentView, setCurrentView] = useState('discover') // discover, stats
  const [discoveryMode, setDiscoveryMode] = useState(50) // 0-100, 0=familiar, 100=exploratory
  const [selectedGenres, setSelectedGenres] = useState(['all']) // Selected genre filters
  const [showGenreFilter, setShowGenreFilter] = useState(false) // Show/hide genre dropdown
  const [showFilters, setShowFilters] = useState(true) // Show/hide entire filters section
  const [isLoading, setIsLoading] = useState(false)
  
  // Spotify Web Player
  const [player, setPlayer] = useState(null)
  const [deviceId, setDeviceId] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playerReady, setPlayerReady] = useState(false)
  const [currentPosition, setCurrentPosition] = useState(0) // Current playback position in ms
  const [trackDuration, setTrackDuration] = useState(0) // Track duration in ms
  
  // Audio visualizer (simulated)
  const [frequencyData, setFrequencyData] = useState(new Uint8Array(18))
  
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
  
  // Cache for artist genre data
  const [artistGenreCache, setArtistGenreCache] = useState({})
  
  // Cache filtered and scored tracks to avoid re-fetching on slider change
  const [cachedScoredTracks, setCachedScoredTracks] = useState([])

  // Spotify API config
  // Using environment variables - set in .env file
  const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || '317c65a797af484fb3e2af110acdfd72' // Fallback for local dev
  const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI || 'https://www.tuneswipe.xyz'
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

    // Check if stored token is still valid (with 5 minute buffer)
    const expiryTime = tokenExpiry ? parseInt(tokenExpiry) : 0
    const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000)
    
    if (storedToken && expiryTime > fiveMinutesFromNow) {
      console.log('✅ Using stored token (expires in', Math.round((expiryTime - Date.now()) / 60000), 'minutes)')
      setSpotifyToken(storedToken)
      fetchSpotifyUserData(storedToken)
    } else if (storedToken && expiryTime <= fiveMinutesFromNow) {
      // Token expired or expiring soon
      console.log('⚠️ Token expired or expiring soon, clearing...')
      localStorage.removeItem('spotify_token')
      localStorage.removeItem('spotify_token_expiry')
      localStorage.removeItem('code_verifier')
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
        setPlayerReady(false)
      })

      // Error handling
      newPlayer.addListener('initialization_error', ({ message }) => {
        console.error('Initialization Error:', message)
      })

      newPlayer.addListener('authentication_error', ({ message }) => {
        console.error('Authentication Error:', message)
        
        // Prevent multiple alerts - only show once
        if (window.authErrorShown) {
          console.log('Auth error already handled, skipping...')
          return
        }
        window.authErrorShown = true
        
        // Token is invalid - clear it and force re-login
        console.log('🔄 Token invalid, clearing and forcing re-login...')
        localStorage.removeItem('spotify_token')
        localStorage.removeItem('spotify_token_expiry')
        localStorage.removeItem('code_verifier')
        
        // Disconnect player to stop more errors
        if (newPlayer) {
          newPlayer.disconnect()
        }
        
        alert('Spotify authentication expired. Please log in again.')
        
        // Force reload to trigger login
        setTimeout(() => {
          window.location.href = window.location.origin
        }, 100)
      })

      newPlayer.addListener('account_error', ({ message }) => {
        console.error('Account Error:', message)
        alert('Spotify Premium is required for playback.')
      })

      newPlayer.addListener('playback_error', ({ message }) => {
        console.error('Playback Error:', message)
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
          console.log('✅ Successfully connected to Spotify Web Player')
        } else {
          console.error('❌ Failed to connect to Spotify Web Player')
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

  // Auto-advance to next track when current song ends
  useEffect(() => {
    // Only check when playing and we have valid duration/position
    if (!isPlaying || !trackDuration || trackDuration <= 0 || !currentTrack) return
    
    const timeRemaining = trackDuration - currentPosition
    
    // Check if we're within the last 2 seconds of the track
    if (timeRemaining > 0 && timeRemaining <= 2000) {
      console.log(`⏱️ ${Math.floor(timeRemaining / 1000)}s remaining, preparing next track...`)
      
      // Set a timeout to advance when track actually ends
      const advanceTimeout = setTimeout(() => {
        console.log('🎵 Track ended, advancing to next...')
        console.log('Current track:', currentTrack?.name)
        console.log('Recommendations count:', recommendations.length)
        
        const currentIndex = recommendations.findIndex(track => 
          track.id === currentTrack?.id
        )
        
        console.log('Current index:', currentIndex)
        
        if (currentIndex >= 0 && currentIndex < recommendations.length - 1) {
          const nextTrack = recommendations[currentIndex + 1]
          console.log('Next track:', nextTrack.name)
          setCurrentTrack(nextTrack)
          
          if (nextTrack.uri && deviceId && playerReady) {
            console.log('▶️ Playing next track...')
            playTrack(nextTrack.uri)
          } else {
            console.log('⚠️ Cannot play - deviceId:', deviceId, 'playerReady:', playerReady)
          }
        } else {
          console.log('📝 Reached end of recommendations (index:', currentIndex, '/', recommendations.length - 1, ')')
        }
      }, timeRemaining) // Wait exactly until track ends
      
      return () => clearTimeout(advanceTimeout)
    }
  }, [currentPosition, trackDuration, isPlaying, currentTrack, recommendations, deviceId, playerReady])

  // Simulated audio visualizer
  useEffect(() => {
    if (!isPlaying) {
      // Reset to low values when paused
      setFrequencyData(new Uint8Array(18).fill(0))
      return
    }

    let animationFrameId

    const generateSimulatedData = () => {
      if (isPlaying) {
        const data = new Uint8Array(18)
        
        for (let i = 0; i < 18; i++) {
          // Create varying heights with some randomness
          const baseValue = 40 + Math.random() * 60
          const boost = Math.sin(Date.now() / 200 + i) * 40
          const variation = Math.random() * 30
          
          // Bass frequencies tend to be stronger
          const bassBoost = i < 6 ? 20 : 0
          
          data[i] = Math.min(255, Math.max(0, baseValue + boost + variation + bassBoost))
        }
        
        setFrequencyData(data)
        animationFrameId = requestAnimationFrame(generateSimulatedData)
      }
    }
    
    generateSimulatedData()

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
    }
  }, [isPlaying])

  // Refresh Spotify access token
  const refreshAccessToken = async () => {
    const refreshToken = localStorage.getItem('spotify_refresh_token')
    if (!refreshToken) {
      console.error('❌ No refresh token available')
      return null
    }

    try {
      console.log('🔄 Refreshing access token...')
      const response = await fetch(SPOTIFY_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: SPOTIFY_CLIENT_ID
        })
      })

      const data = await response.json()
      
      if (data.access_token) {
        const expiryTime = Date.now() + (data.expires_in * 1000)
        localStorage.setItem('spotify_token', data.access_token)
        localStorage.setItem('spotify_token_expiry', expiryTime.toString())
        
        if (data.refresh_token) {
          localStorage.setItem('spotify_refresh_token', data.refresh_token)
        }
        
        setSpotifyToken(data.access_token)
        setTokenExpiresAt(expiryTime)
        console.log('✅ Token refreshed successfully')
        return data.access_token
      } else {
        console.error('❌ No access token in refresh response')
        return null
      }
    } catch (error) {
      console.error('❌ Error refreshing token:', error)
      return null
    }
  }

  // Check if token is expired
  const isTokenExpired = () => {
    const expiryTime = localStorage.getItem('spotify_token_expiry')
    if (!expiryTime) return false
    return Date.now() >= parseInt(expiryTime) - (5 * 60 * 1000) // Refresh 5 min before expiry
  }

  // Get valid token (refresh if needed)
  const getValidToken = async () => {
    if (isTokenExpired()) {
      console.log('⏰ Token expired or expiring soon, refreshing...')
      return await refreshAccessToken()
    }
    return spotifyToken
  }

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

  // Disconnect from Spotify
  const disconnectSpotify = () => {
    setIsConnected(false)
    setSpotifyToken(null)
    setUserStats(null)
    setCurrentTrack(null)
    setRecommendations([])
    window.localStorage.removeItem('spotify_token')
    window.localStorage.removeItem('code_verifier')
    
    // Disconnect player
    if (player) {
      player.disconnect()
      setPlayer(null)
      setDeviceId(null)
      setPlayerReady(false)
    }
  }

  // Fetch user data from Spotify
  const fetchSpotifyUserData = async (token) => {
    try {
      // Get user profile
      const profileRes = await fetch('https://api.spotify.com/v1/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const profile = await profileRes.json()
      console.log('User profile:', profile)
      
      // Store user ID
      const spotifyUserId = profile.id
      setUserId(spotifyUserId)
      
      // Initialize Firebase user profile if needed
      await createUserProfile(spotifyUserId)
      
      // Load user preferences from Firebase
      const prefs = await getUserPreferences(spotifyUserId)
      if (prefs) {
        setUserPreferences(prefs)
      }
      
      // Get top artists (medium term = last 6 months, limit 50 for better data)
      const topArtistsRes = await fetch('https://api.spotify.com/v1/me/top/artists?limit=50&time_range=short_term', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const topArtists = await topArtistsRes.json()
      console.log('Top artists:', topArtists.items?.length || 0)
      
      // Get top tracks (medium term = last 6 months, limit 50 for better data)
      const topTracksRes = await fetch('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=short_term', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const topTracks = await topTracksRes.json()
      console.log('Top tracks:', topTracks.items?.length || 0)
      
      // Process genres from top artists
      const genreCount = {}
      topArtists.items?.forEach(artist => {
        artist.genres?.forEach(genre => {
          genreCount[genre] = (genreCount[genre] || 0) + 1
        })
      })
      
      const topGenres = Object.entries(genreCount)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }))
      
      console.log('Top genres:', topGenres.length)
      
      setUserStats({
        topArtists: topArtists.items || [],
        topTracks: topTracks.items || [],
        topGenres
      })
      
      setIsConnected(true)
      
      // Fetch recommendations
      fetchRecommendations(token, topArtists.items || [], topTracks.items || [])
      
      // Fetch user's liked songs
      fetchLikedSongs(token)
    } catch (error) {
      console.error('Error fetching user data:', error)
    }
  }

  // Fetch user's liked songs (saved tracks)
  const fetchLikedSongs = async (token) => {
    try {
      let allLikedTracks = []
      let nextUrl = 'https://api.spotify.com/v1/me/tracks?limit=50'
      
      // Fetch all liked songs (paginated)
      while (nextUrl) {
        const response = await fetch(nextUrl, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        const data = await response.json()
        
        if (data.items) {
          allLikedTracks = allLikedTracks.concat(data.items.map(item => item.track.id))
        }
        
        nextUrl = data.next
        
        // Limit to prevent too many requests
        if (allLikedTracks.length >= 500) break
      }
      
      console.log('📚 Loaded', allLikedTracks.length, 'liked songs from Spotify')
      setLikedSongIds(new Set(allLikedTracks))
    } catch (error) {
      console.error('Error fetching liked songs:', error)
    }
  }

  // Fetch artist genres (with caching)
  const fetchArtistGenres = async (artistId, token) => {
    // Check cache first
    if (artistGenreCache[artistId]) {
      return artistGenreCache[artistId]
    }
    
    try {
      const response = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      
      // Cache the result
      setArtistGenreCache(prev => ({
        ...prev,
        [artistId]: data.genres || []
      }))
      
      return data.genres || []
    } catch (error) {
      console.error('Error fetching artist genres:', error)
      return []
    }
  }

  // Fetch recommendations from Spotify
  const fetchRecommendations = async (token, topArtists, topTracks) => {
    try {
      setIsLoading(true)
      console.log('🎵 Fetching recommendations...')
      
      // Get seed artists and tracks
      const seedArtists = topArtists.slice(0, 2).map(a => a.id)
      const seedTracks = topTracks.slice(0, 3).map(t => t.id)
      
      // Build recommendation query
      const params = new URLSearchParams({
        seed_artists: seedArtists.join(','),
        seed_tracks: seedTracks.join(','),
        limit: '100', // Get 100 tracks initially, we'll filter/score them
        market: 'US'
      })
      
      console.log('Fetching with seeds:', {
        artists: seedArtists.length,
        tracks: seedTracks.length
      })
      
      const response = await fetch(`https://api.spotify.com/v1/recommendations?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      
      if (data.tracks && data.tracks.length > 0) {
        console.log(`✅ Got ${data.tracks.length} initial recommendations`)
        
        // Fetch genres for all tracks in parallel
        const tracksWithGenres = await Promise.all(
          data.tracks.map(async (track) => {
            const artistGenres = await Promise.all(
              track.artists.map(artist => fetchArtistGenres(artist.id, token))
            )
            const genres = [...new Set(artistGenres.flat())]
            return { ...track, genres }
          })
        )
        
        console.log(`✅ Enriched ${tracksWithGenres.length} tracks with genre data`)
        
        // Calculate novelty scores for all tracks
        const tracksWithScores = tracksWithGenres.map(track => {
          // Check if track is in user's top tracks
          const isTopTrack = topTracks.some(t => t.id === track.id)
          
          // Check if artist is in user's top artists
          const artistMatch = track.artists.some(artist => 
            topArtists.some(topArtist => topArtist.id === artist.id)
          )
          
          // Check genre overlap
          const trackGenres = track.genres || []
          const topGenres = userStats?.topGenres?.slice(0, 10).map(g => g.name) || []
          const genreOverlap = trackGenres.filter(g => topGenres.includes(g)).length
          const maxGenreOverlap = Math.min(trackGenres.length, topGenres.length)
          const genreScore = maxGenreOverlap > 0 ? genreOverlap / maxGenreOverlap : 0
          
          // Calculate novelty score (0 = very familiar, 100 = very novel)
          let noveltyScore = 50 // Start at middle
          
          if (isTopTrack) noveltyScore -= 30 // Exact track match = very familiar
          if (artistMatch) noveltyScore -= 15 // Artist match = somewhat familiar
          noveltyScore -= genreScore * 20 // Genre overlap reduces novelty
          
          // Add some randomness for variety (±10)
          noveltyScore += (Math.random() - 0.5) * 20
          
          // Clamp between 0-100
          noveltyScore = Math.max(0, Math.min(100, noveltyScore))
          
          return {
            ...track,
            noveltyScore,
            isTopTrack,
            artistMatch,
            genreScore
          }
        })
        
        console.log(`✅ Calculated novelty scores for ${tracksWithScores.length} tracks`)
        
        // Cache the scored tracks so we don't need to re-fetch when slider changes
        setCachedScoredTracks(tracksWithScores)
        
        // Apply initial filtering based on current discoveryMode
        filterAndDisplayRecommendations(tracksWithScores, discoveryMode, selectedGenres)
        
      } else {
        console.log('❌ No recommendations returned')
        setRecommendations([])
      }
    } catch (error) {
      console.error('Error fetching recommendations:', error)
      setRecommendations([])
    } finally {
      setIsLoading(false)
    }
  }

  // Filter and display recommendations based on discovery mode and genre filters
  const filterAndDisplayRecommendations = (tracks, mode, genres) => {
    console.log(`🎯 Filtering ${tracks.length} tracks with mode=${mode}, genres=${genres.join(',')}`)
    
    // Step 1: Apply genre filter
    let filtered = tracks
    if (!genres.includes('all')) {
      filtered = tracks.filter(track => {
        const trackGenres = track.genres || []
        return genres.some(selectedGenre => 
          trackGenres.some(trackGenre => 
            trackGenre.toLowerCase().includes(selectedGenre.toLowerCase()) ||
            selectedGenre.toLowerCase().includes(trackGenre.toLowerCase())
          )
        )
      })
      console.log(`   After genre filter: ${filtered.length} tracks`)
    }
    
    // Step 2: Score tracks based on discovery mode
    const targetNovelty = mode // mode is 0-100, same as noveltyScore
    const scoredTracks = filtered.map(track => {
      // Calculate how close this track is to target novelty (0 = perfect match)
      const noveltyDiff = Math.abs(track.noveltyScore - targetNovelty)
      
      // Invert to get match score (100 = perfect, 0 = worst)
      const matchScore = 100 - noveltyDiff
      
      return {
        ...track,
        matchScore
      }
    })
    
    // Step 3: Sort by match score and take top 20
    const sorted = scoredTracks.sort((a, b) => b.matchScore - a.matchScore)
    const final = sorted.slice(0, 20)
    
    console.log(`✅ Final ${final.length} tracks selected`)
    console.log(`   Novelty range: ${Math.min(...final.map(t => t.noveltyScore)).toFixed(1)} - ${Math.max(...final.map(t => t.noveltyScore)).toFixed(1)}`)
    
    setRecommendations(final)
  }

  // Update recommendations when discovery mode or genre filter changes
  useEffect(() => {
    if (cachedScoredTracks.length > 0) {
      filterAndDisplayRecommendations(cachedScoredTracks, discoveryMode, selectedGenres)
    }
  }, [discoveryMode, selectedGenres])

  // Play a track
  const playTrack = async (uri) => {
    if (!deviceId || !playerReady) {
      console.error('Player not ready')
      return
    }

    try {
      // Get valid token (will refresh if expired)
      const token = await getValidToken()
      if (!token) {
        console.error('❌ No valid token available')
        return
      }

      await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          uris: [uri]
        })
      })
      
      console.log('▶️ Playing track:', uri)
    } catch (error) {
      console.error('Error playing track:', error)
    }
  }

  // Toggle play/pause
  const togglePlayPause = async () => {
    if (!player) return

    try {
      await player.togglePlay()
    } catch (error) {
      console.error('Error toggling play/pause:', error)
    }
  }

  // Handle track rating (like/dislike)
  const handleRating = async (track, rating) => {
    console.log('Rating:', rating, 'for track:', track.name)
    
    // Save to Firebase
    if (userId) {
      await savePreference(userId, track.id, rating)
    }
    
    // Update local state
    setUserPreferences(prev => {
      const newPrefs = { ...prev }
      
      // Remove from all categories first
      Object.keys(newPrefs).forEach(key => {
        newPrefs[key] = newPrefs[key].filter(id => id !== track.id)
      })
      
      // Add to appropriate category
      if (rating === 'loved') {
        newPrefs.loved.push(track.id)
        // Also save to Spotify liked songs
        saveToSpotify(track.id, true)
      } else if (rating === 'liked') {
        newPrefs.liked.push(track.id)
      } else if (rating === 'disliked') {
        newPrefs.disliked.push(track.id)
      } else if (rating === 'hated') {
        newPrefs.hated.push(track.id)
      }
      
      return newPrefs
    })
    
    // Move to next track
    const currentIndex = recommendations.findIndex(r => r.id === track.id)
    if (currentIndex < recommendations.length - 1) {
      const nextTrack = recommendations[currentIndex + 1]
      setCurrentTrack(nextTrack)
      playTrack(nextTrack.uri)
    }
  }

  // Save/remove track to/from Spotify liked songs
  const saveToSpotify = async (trackId, save = true) => {
    try {
      // Get valid token (will refresh if expired)
      const token = await getValidToken()
      if (!token) {
        console.error('❌ No valid token available')
        return
      }

      const method = save ? 'PUT' : 'DELETE'
      await fetch(`https://api.spotify.com/v1/me/tracks?ids=${trackId}`, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      
      // Update local liked songs set
      setLikedSongIds(prev => {
        const newSet = new Set(prev)
        if (save) {
          newSet.add(trackId)
        } else {
          newSet.delete(trackId)
        }
        return newSet
      })
      
      console.log(save ? '💚 Saved to' : '❌ Removed from', 'Spotify liked songs:', trackId)
    } catch (error) {
      console.error('Error saving to Spotify:', error)
    }
  }

  // Get user's preference for a track
  const getTrackPreference = (trackId) => {
    if (userPreferences.loved.includes(trackId)) return 'loved'
    if (userPreferences.liked.includes(trackId)) return 'liked'
    if (userPreferences.disliked.includes(trackId)) return 'disliked'
    if (userPreferences.hated.includes(trackId)) return 'hated'
    return null
  }

  // Toggle genre selection
  const toggleGenre = (genre) => {
    setSelectedGenres(prev => {
      if (genre === 'all') {
        return ['all']
      }
      
      // Remove 'all' if present
      const filtered = prev.filter(g => g !== 'all')
      
      if (filtered.includes(genre)) {
        // Remove genre
        const newGenres = filtered.filter(g => g !== genre)
        return newGenres.length === 0 ? ['all'] : newGenres
      } else {
        // Add genre
        return [...filtered, genre]
      }
    })
  }

  // Format time (milliseconds to MM:SS)
  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // Calculate progress percentage
  const progressPercent = trackDuration > 0 ? (currentPosition / trackDuration) * 100 : 0

  // Get available genres from user's top genres
  const availableGenres = userStats?.topGenres?.slice(0, 15).map(g => g.name) || []

  return (
    <div className="app">
      {!isConnected ? (
        <div className="connect-view">
          <div className="connect-content">
            <div className="logo-section">
              <div className="logo">
                <Music size={48} />
              </div>
              <h1>TuneSwipe</h1>
              <p className="tagline">Discover music that matches your vibe</p>
            </div>
            
            <div className="features">
              <div className="feature">
                <TrendingUp size={24} />
                <h3>Smart Discovery</h3>
                <p>Find new music based on your listening history</p>
              </div>
              <div className="feature">
                <Sliders size={24} />
                <h3>Your Way</h3>
                <p>Control how adventurous or familiar your discoveries are</p>
              </div>
              <div className="feature">
                <BarChart3 size={24} />
                <h3>Track Everything</h3>
                <p>See your music stats and preferences grow over time</p>
              </div>
            </div>

            <button className="connect-button" onClick={connectSpotify}>
              <Music size={20} />
              Connect with Spotify
            </button>

            <p className="disclaimer">
              Spotify Premium required for playback
            </p>
          </div>
        </div>
      ) : (
        <div className="main-view">
          {/* Header */}
          <header className="header">
            <div className="header-left">
              <div className="logo">
                <Music size={32} />
              </div>
              <h1>TuneSwipe</h1>
            </div>
            
            <nav className="nav">
              <button 
                className={currentView === 'discover' ? 'active' : ''}
                onClick={() => setCurrentView('discover')}
              >
                <TrendingUp size={20} />
                Discover
              </button>
              <button 
                className={currentView === 'stats' ? 'active' : ''}
                onClick={() => setCurrentView('stats')}
              >
                <BarChart3 size={20} />
                Stats
              </button>
            </nav>

            <button className="disconnect-button" onClick={disconnectSpotify}>
              Disconnect
            </button>
          </header>

          {/* Discovery View */}
          {currentView === 'discover' && (
            <div className="discovery-view">
              {/* Discovery Controls - ABOVE the grid */}
              <div className="discovery-controls-wrapper">
                <button 
                  className="toggle-filters-button"
                  onClick={() => setShowFilters(!showFilters)}
                >
                  {showFilters ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  {showFilters ? 'Hide' : 'Show'} Filters
                </button>
                
                {showFilters && (
                  <div className="discovery-controls">
                    {/* Discovery Mode Slider */}
                    <div className="control-section">
                      <label>
                        <Sliders size={18} />
                        Discovery Mode
                        <span className="mode-label">
                          {discoveryMode < 33 ? '🏠 Familiar' : 
                           discoveryMode < 66 ? '🎯 Balanced' : 
                           '🚀 Exploratory'}
                        </span>
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={discoveryMode}
                        onChange={(e) => setDiscoveryMode(parseInt(e.target.value))}
                        className="discovery-slider"
                      />
                      <div className="slider-labels">
                        <span>Similar to your taste</span>
                        <span>Completely new sounds</span>
                      </div>
                    </div>

                    {/* Genre Filter */}
                    {availableGenres.length > 0 && (
                      <div className="control-section genre-filter-section">
                        <label>
                          <Music size={18} />
                          Filter by Genre
                        </label>
                        <button 
                          className="genre-dropdown-toggle"
                          onClick={() => setShowGenreFilter(!showGenreFilter)}
                        >
                          {selectedGenres.includes('all') ? 'All Genres' : 
                           selectedGenres.length === 1 ? selectedGenres[0] :
                           `${selectedGenres.length} genres selected`}
                          {showGenreFilter ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                        
                        {showGenreFilter && (
                          <div className="genre-dropdown">
                            <button
                              className={`genre-option ${selectedGenres.includes('all') ? 'selected' : ''}`}
                              onClick={() => toggleGenre('all')}
                            >
                              {selectedGenres.includes('all') ? <Check size={16} /> : <Plus size={16} />}
                              All Genres
                            </button>
                            {availableGenres.map(genre => (
                              <button
                                key={genre}
                                className={`genre-option ${selectedGenres.includes(genre) ? 'selected' : ''}`}
                                onClick={() => toggleGenre(genre)}
                              >
                                {selectedGenres.includes(genre) ? <Check size={16} /> : <Plus size={16} />}
                                {genre}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

          {/* discovery-main-content grid container */}
          <div className="discovery-main-content">
          {/* Now Playing Card */}
          {currentTrack && (
            <div className="now-playing-card">
              <div className="now-playing-header">
                <Music size={20} />
                <span>Now Playing</span>
              </div>
              
              <img 
                src={currentTrack.album.images[0]?.url} 
                alt={currentTrack.name}
                className="now-playing-image"
              />
              
              <div className="now-playing-info">
                <h3>{currentTrack.name}</h3>
                <p>{currentTrack.artists.map(a => a.name).join(', ')}</p>
              </div>

              {/* Playback Progress */}
              <div className="playback-progress">
                <div className="progress-times">
                  <span>{formatTime(currentPosition)}</span>
                  <span>{formatTime(trackDuration)}</span>
                </div>
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {/* Playback Controls */}
              <div className="playback-controls">
                <button onClick={togglePlayPause} className="play-button">
                  {isPlaying ? '⏸' : '▶️'}
                </button>
              </div>

              {/* Rating Buttons */}
              <div className="rating-buttons">
                <button 
                  className={`rating-button love ${getTrackPreference(currentTrack.id) === 'loved' ? 'active' : ''}`}
                  onClick={() => handleRating(currentTrack, 'loved')}
                  title="Love it! (Save to Spotify)"
                >
                  <Heart size={24} fill={getTrackPreference(currentTrack.id) === 'loved' ? 'currentColor' : 'none'} />
                </button>
                <button 
                  className={`rating-button like ${getTrackPreference(currentTrack.id) === 'liked' ? 'active' : ''}`}
                  onClick={() => handleRating(currentTrack, 'liked')}
                  title="Like it"
                >
                  <ThumbsUp size={24} />
                </button>
                <button 
                  className={`rating-button neutral ${getTrackPreference(currentTrack.id) === 'neutral' ? 'active' : ''}`}
                  onClick={() => handleRating(currentTrack, 'neutral')}
                  title="It's okay"
                >
                  <Meh size={24} />
                </button>
                <button 
                  className={`rating-button dislike ${getTrackPreference(currentTrack.id) === 'disliked' ? 'active' : ''}`}
                  onClick={() => handleRating(currentTrack, 'disliked')}
                  title="Not for me"
                >
                  <ThumbsDown size={24} />
                </button>
                <button 
                  className={`rating-button hate ${getTrackPreference(currentTrack.id) === 'hated' ? 'active' : ''}`}
                  onClick={() => handleRating(currentTrack, 'hated')}
                  title="Skip similar"
                >
                  <X size={24} />
                </button>
              </div>

              {/* Show if track is already liked on Spotify */}
              {likedSongIds.has(currentTrack.id) && (
                <div className="already-liked-badge">
                  <Heart size={14} fill="currentColor" />
                  Saved to Spotify
                </div>
              )}
            </div>
          )}

          {/* Queue */}
          {recommendations.length > 0 ? (
            <div className="queue-section">
              <h2>
                <Music size={24} />
                Up Next
                <span className="queue-count">({recommendations.length} tracks)</span>
              </h2>
              <div className="queue-list">
                {recommendations.map((track, index) => (
                  <div 
                    key={track.id}
                    className={`queue-item ${currentTrack?.id === track.id ? 'current' : ''}`}
                    onClick={() => {
                      setCurrentTrack(track)
                      playTrack(track.uri)
                    }}
                  >
                    <div className="queue-item-number">{index + 1}</div>
                    <img 
                      src={track.album.images[2]?.url || track.album.images[0]?.url} 
                      alt={track.name}
                      className="queue-item-image"
                    />
                    <div className="queue-item-info">
                      <div className="queue-item-name">{track.name}</div>
                      <div className="queue-item-artist">
                        {track.artists.map(a => a.name).join(', ')}
                      </div>
                    </div>
                    {/* Show user's preference if they have one */}
                    {getTrackPreference(track.id) && (
                      <div className={`preference-badge ${getTrackPreference(track.id)}`}>
                        {getTrackPreference(track.id) === 'loved' && <Heart size={14} fill="currentColor" />}
                        {getTrackPreference(track.id) === 'liked' && <ThumbsUp size={14} />}
                        {getTrackPreference(track.id) === 'disliked' && <ThumbsDown size={14} />}
                      </div>
                    )}
                    {/* Show if already liked on Spotify */}
                    {likedSongIds.has(track.id) && !getTrackPreference(track.id) && (
                      <div className="spotify-liked-badge">
                        <Heart size={14} fill="currentColor" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="loading-message">
              <Music size={48} className="spinning" />
              <p>Loading recommendations...</p>
            </div>
          )}
          </div>
          {/* End of discovery-main-content grid */}

          {/* Audio Visualizer Bars - Simulated visualization */}
          <div className={`audio-visualizer ${isPlaying ? 'playing' : 'paused'}`}>
            {Array.from({ length: 18 }).map((_, index) => {
              // Convert frequency data (0-255) to height percentage (20%-100%)
              const frequencyValue = frequencyData[index] || 0
              const heightPercent = isPlaying 
                ? 20 + (frequencyValue / 255) * 80 // 20% to 100% when playing
                : 20 // Fixed 20% when paused
              
              return (
                <div
                  key={index}
                  className="visualizer-bar"
                  style={{
                    '--bar-height': `${heightPercent}%`,
                    height: `${heightPercent}%`
                  }}
                />
              )
            })}
          </div>

          {/* Preference Summary */}
          <div className="preference-summary">
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
            <p className="stats-subtitle">Based on your last 4 weeks of listening on Spotify</p>
            <p className="stats-update-info">Data updates daily • Powered by Spotify</p>
            <button 
              className="refresh-stats-button"
              onClick={async () => {
                setIsLoading(true)
                try {
                  const topArtists = await fetch('https://api.spotify.com/v1/me/top/artists?limit=50&time_range=short_term', {
                    headers: { 'Authorization': `Bearer ${spotifyToken}` }
                  }).then(r => r.json())
                  
                  const topTracks = await fetch('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=short_term', {
                    headers: { 'Authorization': `Bearer ${spotifyToken}` }
                  }).then(r => r.json())
                  
                  // Process genres
                  const genreCount = {}
                  topArtists.items.forEach(artist => {
                    artist.genres?.forEach(genre => {
                      genreCount[genre] = (genreCount[genre] || 0) + 1
                    })
                  })
                  const topGenres = Object.entries(genreCount)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, count]) => ({ name, count }))
                  
                  setUserStats({
                    topArtists: topArtists.items,
                    topTracks: topTracks.items,
                    topGenres
                  })
                  
                  console.log('✅ Stats refreshed successfully')
                } catch (error) {
                  console.error('Error refreshing stats:', error)
                  alert('Failed to refresh stats. Please try again.')
                } finally {
                  setIsLoading(false)
                }
              }}
              disabled={isLoading}
            >
              <RefreshCw size={18} />
              {isLoading ? 'Refreshing...' : 'Refresh Stats'}
            </button>
          </div>

          {/* Time Period Info Card */}
          <div className="stats-info-card">
            <div className="info-item">
              <span className="info-icon">📊</span>
              <div className="info-content">
                <span className="info-label">Time Period</span>
                <span className="info-value">Last 4 weeks (short_term)</span>
              </div>
            </div>
            <div className="info-item">
              <span className="info-icon">🎵</span>
              <div className="info-content">
                <span className="info-label">Data Source</span>
                <span className="info-value">Spotify Listening History</span>
              </div>
            </div>
            <div className="info-item">
              <span className="info-icon">🔄</span>
              <div className="info-content">
                <span className="info-label">Updates</span>
                <span className="info-value">Real-time from your account</span>
              </div>
            </div>
          </div>

          <div className="stats-grid">
            {/* Top Artists */}
            <div className="stat-section">
              <h3>
                <User size={20} />
                Top Artists
                <span className="stat-count">({userStats.topArtists.length} total)</span>
              </h3>
              <p className="stat-description">Your most listened-to artists in the past month</p>
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
              <h3>
                <Music size={20} />
                Top Tracks
                <span className="stat-count">({userStats.topTracks.length} total)</span>
              </h3>
              <p className="stat-description">Your most played songs this month</p>
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
              <h3>
                <BarChart3 size={20} />
                Top Genres
                <span className="stat-count">({userStats.topGenres.length} total)</span>
              </h3>
              <p className="stat-description">Genres based on your top artists</p>
              <div className="genre-tags">
                {userStats.topGenres.map((genre, index) => (
                  <div key={index} className="genre-tag">
                    {genre.name}
                    <span className="genre-count">{genre.count}</span>
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