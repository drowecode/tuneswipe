import React, { useState, useEffect } from 'react'
import { Heart, ThumbsUp, Meh, ThumbsDown, TrendingUp, Music, User, BarChart3, Sliders, Plus } from 'lucide-react'
import './MusicDiscovery.css'
import { createUserProfile, savePreference, getUserPreferences, onAuthChange } from './firebase'

const MusicDiscovery = () => {
  const [isConnected, setIsConnected] = useState(false)
  const [spotifyToken, setSpotifyToken] = useState(null)
  const [userId, setUserId] = useState(null)
  const [currentView, setCurrentView] = useState('discover') // discover, stats
  const [discoveryMode, setDiscoveryMode] = useState(50) // 0-100, 0=familiar, 100=exploratory
  const [isLoading, setIsLoading] = useState(false)
  
  // User data
  const [userStats, setUserStats] = useState(null)
  const [currentTrack, setCurrentTrack] = useState(null)
  const [recommendations, setRecommendations] = useState([])
  const [userPreferences, setUserPreferences] = useState({
    loved: [],
    liked: [],
    disliked: [],
    hated: []
  })

  // Spotify API config
  const SPOTIFY_CLIENT_ID = '317c65a797af484fb3e2af110acdfd72' // Your client ID
  const REDIRECT_URI = 'https://www.tuneswipe.xyz'
  const SPOTIFY_AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize'
  const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token'
  const SPOTIFY_SCOPES = [
    'user-library-modify',
    'user-library-read',
    'user-top-read',
    'user-read-recently-played'
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
        topGenres: topGenres,
        country: profile?.country || 'US'
      };
      setUserStats(userData);

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
        console.error('Firebase error:', error)
        // Continue without Firebase if there's an error
      }

      setIsConnected(true)
      
      // Get initial recommendations once stats are ready
      await getRecommendations(topArtists.items || [], token);

      setIsLoading(false)
    } catch (error) {
      console.error('Error fetching Spotify data:', error)
      setIsLoading(false)
      alert('Error connecting to Spotify. Please try again.')
    }
  }

// --- helpers ---
let _genreSeeds = null;
const getGenreSeeds = async (token) => {
  if (_genreSeeds) return _genreSeeds;
  const r = await fetch('https://api.spotify.com/v1/recommendations/available-genre-seeds', {
    headers: { Authorization: `Bearer ${token}` }
  });
  _genreSeeds = r.ok ? (await r.json()).genres : [];
  return _genreSeeds;
};

const isSpotifyId = v => typeof v === 'string' && /^[0-9A-Za-z]{22}$/.test(v);

// --- drop-in replacement ---
const getRecommendations = async (topArtists, token) => {
  console.log('getRecommendations called with:', {
    topArtistsCount: Array.isArray(topArtists) ? topArtists.length : null,
    hasToken: !!token, discoveryMode
  });
  if (!Array.isArray(topArtists) || topArtists.length === 0 || !token) return;

  try {
    // split familiar/exploratory
    const familiarCount = Math.max(1, Math.floor((1 - discoveryMode / 100) * 3));
    const exploratoryCount = Math.max(0, 3 - familiarCount);

    // familiar seeds
    const familiarSeeds = topArtists.slice(0, familiarCount).map(a => a?.id).filter(isSpotifyId);

    // exploratory via related-artists (best-effort + guarded)
    let exploratorySeeds = [];
    if (exploratoryCount > 0 && topArtists.length) {
      try {
        const pick = topArtists[Math.floor(Math.random() * Math.min(5, topArtists.length))];
        if (isSpotifyId(pick?.id)) {
          const rel = await fetch(`https://api.spotify.com/v1/artists/${pick.id}/related-artists`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (rel.ok) {
            const j = await rel.json();
            exploratorySeeds = (j.artists || [])
              .slice(0, exploratoryCount)
              .map(a => a?.id)
              .filter(isSpotifyId);
          } else {
            console.warn('related-artists failed:', rel.status);
          }
        }
      } catch (e) { console.warn('related-artists error:', e); }
    }

    // reliable track seeds
    const trackSeeds = (userStats?.topTracks || [])
      .slice(0, 2).map(t => t?.id).filter(isSpotifyId);

    // dedupe + clamp
    const seed_artists = [...new Set([...familiarSeeds, ...exploratorySeeds])].slice(0, 3);
    const seed_tracks  = trackSeeds.slice(0, 2);

    // fallback to allowed genre seeds
    let seed_genres = [];
    if (seed_artists.length + seed_tracks.length === 0) {
      const allowed = new Set(await getGenreSeeds(token));
      seed_genres = (userStats?.topGenres || [])
        .map(g => g?.name?.toLowerCase().replace(/\s+/g, '-'))
        .filter(g => g && allowed.has(g))
        .slice(0, 5);
    }

    if (!seed_artists.length && !seed_tracks.length && !seed_genres.length) {
      alert('Not enough listening history to generate recommendations yet.');
      return;
    }

    // safe URL assembly (prevents malformed queries → 404)
    const params = new URLSearchParams({ limit: '20', min_popularity: '20' });
    params.set('market', userStats?.country || 'US');
    if (seed_artists.length) params.set('seed_artists', seed_artists.join(','));
    if (seed_tracks.length)  params.set('seed_tracks',  seed_tracks.join(','));
    if (seed_genres.length)  params.set('seed_genres',  seed_genres.join(','));

    const url = `https://api.spotify.com/v1/recommendations?${params.toString()}`;
    console.log('Recs URL:', url);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (res.status === 401) {
      localStorage.removeItem('spotify_token');
      localStorage.removeItem('spotify_token_expiry');
      setIsConnected(false);
      alert('Session expired. Please reconnect to Spotify.');
      return;
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('Retry-After') || 1);
      await new Promise(r => setTimeout(r, wait * 1000));
      return getRecommendations(topArtists, token);
    }
    if (!res.ok) {
      console.error('Recs failed:', res.status, await res.text());
      alert(`Failed to load recommendations (${res.status}). Try reconnecting.`);
      return;
    }

    const data = await res.json();
    if (data?.tracks?.length) {
      setRecommendations(data.tracks);
      setCurrentTrack(data.tracks[0]);
    } else {
      alert('No recommendations right now. Try adjusting the slider.');
    }
  } catch (err) {
    console.error('Error getting recommendations:', err);
    alert('Error loading recommendations. Check console and try again.');
  } finally {
    setIsLoading(false);
  }
};
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
        // Save to Firebase
        if (userId) {
          await savePreference(userId, trackData, 'loved')
        }
        break
      case 'like':
        newPreferences.liked = [...(newPreferences.liked || []), trackData]
        if (userId) {
          await savePreference(userId, trackData, 'liked')
        }
        break
      case 'meh':
        // Don't save meh reactions
        break
      case 'dislike':
        newPreferences.disliked = [...(newPreferences.disliked || []), trackData]
        if (userId) {
          await savePreference(userId, trackData, 'disliked')
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
      setCurrentTrack(recommendations[currentIndex + 1])
    } else {
      // Get more recommendations when we run out
      if (userStats?.topArtists && spotifyToken) {
        await getRecommendations(userStats.topArtists, spotifyToken)
      }
    }
  }

  useEffect(() => {
  if (isConnected && spotifyToken && userStats?.topArtists?.length) {
    setIsLoading(true);
    getRecommendations(userStats.topArtists, spotifyToken);
  }
  }, [discoveryMode]);
  

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
          {/* Discovery Mode Slider */}
          <div className="discovery-controls">
            <div className="slider-container">
              <label>
                <Sliders size={20} />
                Discovery Mode
              </label>
              <div className="slider-labels">
                <span>Familiar</span>
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
              <div className="slider-value">{discoveryMode}% exploratory</div>
            </div>
          </div>

          {/* Current Track Card */}
          {currentTrack ? (
            <div className="track-card">
              <div className="track-image">
                {currentTrack.album?.images && currentTrack.album.images[0] ? (
                  <img src={currentTrack.album.images[0].url} alt={currentTrack.name} />
                ) : (
                  <div className="placeholder-image">
                    <Music size={64} />
                  </div>
                )}
              </div>
              <div className="track-info">
                <h2>{currentTrack.name}</h2>
                <h3>{currentTrack.artists ? currentTrack.artists.map(a => a.name).join(', ') : ''}</h3>
                {currentTrack.album && (
                  <p className="track-album">{currentTrack.album.name}</p>
                )}
                {currentTrack.popularity && (
                  <p className="track-stats">Popularity: {currentTrack.popularity}/100</p>
                )}
                
                {/* Add to Spotify Liked Button */}
                <button 
                  className="add-to-liked-btn"
                  onClick={() => addToSpotifyLiked(currentTrack.uri)}
                  title="Add to Spotify Liked Songs"
                >
                  <Plus size={20} />
                  Add to Liked Songs
                </button>
              </div>

              {/* Reaction Buttons */}
              <div className="reaction-buttons">
                <button 
                  className="reaction-btn dislike-btn"
                  onClick={() => handleReaction('dislike')}
                  title="Dislike"
                >
                  <ThumbsDown size={28} />
                </button>
                <button 
                  className="reaction-btn meh-btn"
                  onClick={() => handleReaction('meh')}
                  title="Meh"
                >
                  <Meh size={28} />
                </button>
                <button 
                  className="reaction-btn like-btn"
                  onClick={() => handleReaction('like', true)}
                  title="Like & Add to Spotify"
                >
                  <ThumbsUp size={28} />
                </button>
                <button 
                  className="reaction-btn love-btn"
                  onClick={() => handleReaction('love', true)}
                  title="Love & Add to Spotify"
                >
                  <Heart size={28} />
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