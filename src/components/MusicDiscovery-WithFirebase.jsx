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
  const REDIRECT_URI = window.location.origin // Use current origin to avoid redirect URI mismatch
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
      // Pass both artists and tracks directly (before userStats is fully set)
      await getRecommendations(topArtists.items || [], token, topTracks.items || []);

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
    try {
      const r = await fetch('https://api.spotify.com/v1/recommendations/available-genre-seeds', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (r.ok) {
        const data = await r.json();
        _genreSeeds = data.genres || [];
        return _genreSeeds;
      } else {
        console.warn('Genre seeds endpoint failed:', r.status, await r.text().catch(() => ''));
        // Return empty array if it fails - not critical
        return [];
      }
    } catch (e) {
      console.warn('Genre seeds fetch error:', e);
      return [];
    }
  };

  const isSpotifyId = v => {
    if (!v || typeof v !== 'string') return false;
    // Spotify IDs are exactly 22 characters, alphanumeric
    const isValid = /^[0-9A-Za-z]{22}$/.test(v);
    if (!isValid && v) {
      console.warn('Invalid Spotify ID format:', v, 'Length:', v.length);
    }
    return isValid;
  };

  // --- drop-in replacement ---
  const getRecommendations = async (topArtists, token, topTracks = null) => {
    // Use passed tracks or fall back to userStats
    const tracks = topTracks || userStats?.topTracks || [];
    
    console.log('getRecommendations called with:', {
      topArtistsCount: Array.isArray(topArtists) ? topArtists.length : null,
      topTracksCount: Array.isArray(tracks) ? tracks.length : null,
      hasToken: !!token, 
      discoveryMode
    });
    if (!Array.isArray(topArtists) || topArtists.length === 0 || !token) return;

    // First, verify the token works with a simple API call
    try {
      const testResponse = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (testResponse.status === 401) {
        console.error('Token is invalid or expired');
        localStorage.removeItem('spotify_token');
        localStorage.removeItem('spotify_token_expiry');
        setIsConnected(false);
        alert('Your Spotify session has expired. Please reconnect.');
        return;
      }
      if (!testResponse.ok) {
        console.error('Token validation failed:', testResponse.status);
      }
    } catch (e) {
      console.error('Failed to validate token:', e);
    }

    try {
      // split familiar/exploratory
      const familiarCount = Math.max(1, Math.floor((1 - discoveryMode / 100) * 3));
      const exploratoryCount = Math.max(0, 3 - familiarCount);

      // familiar seeds - ensure we extract valid IDs
      const familiarSeeds = topArtists
        .slice(0, familiarCount)
        .map(a => {
          const id = a?.id || a?.uri?.split(':')?.pop();
          return id;
        })
        .filter(isSpotifyId);
      
      console.log('Familiar seeds extracted:', familiarSeeds.length, 'from', familiarCount, 'artists');

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
            } else if (rel.status === 401) {
              // Token expired
              localStorage.removeItem('spotify_token');
              localStorage.removeItem('spotify_token_expiry');
              setIsConnected(false);
              alert('Session expired. Please reconnect to Spotify.');
              return;
            } else {
              console.warn('related-artists failed:', rel.status, await rel.text().catch(() => ''));
            }
          }
        } catch (e) { 
            console.warn('related-artists error:', e);
            // Continue without exploratory seeds if related-artists fails
          }
      }

      // reliable track seeds - prefer tracks as they're more reliable than artists
      const trackSeeds = (tracks || [])
        .slice(0, 5)
        .map(t => {
          const id = t?.id || t?.uri?.split(':')?.pop();
          if (!id) {
            console.warn('Track missing ID:', t);
          }
          return id;
        })
        .filter(id => {
          const isValid = isSpotifyId(id);
          if (!isValid && id) {
            console.warn('Invalid track ID:', id, 'from track:', tracks.find(t => (t?.id || t?.uri?.split(':')?.pop()) === id));
          }
          return isValid;
        });
      
      console.log('Track seeds extracted:', trackSeeds.length, 'from', tracks.length, 'tracks');
      console.log('Track seed IDs:', trackSeeds);

      // dedupe + clamp artist seeds
      const seed_artists = [...new Set([...familiarSeeds, ...exploratorySeeds])].slice(0, 5);
      const seed_tracks  = trackSeeds.slice(0, 5);

      // Get genre seeds as additional fallback
      let seed_genres = [];
      try {
        const allowed = new Set(await getGenreSeeds(token));
        seed_genres = (userStats?.topGenres || [])
          .map(g => g?.name?.toLowerCase().replace(/\s+/g, '-'))
          .filter(g => g && allowed.has(g))
          .slice(0, 5);
      } catch (e) {
        console.warn('Failed to get genre seeds:', e);
      }

      // Strategy: Prioritize tracks > artists > genres
      // If we have tracks, use them primarily (they're most reliable)
      // If no tracks, use artists + genres combination
      const hasTracks = seed_tracks.length > 0;
      const hasArtists = seed_artists.length > 0;
      
      console.log('Seed availability:', { 
        tracks: seed_tracks.length, 
        artists: seed_artists.length, 
        genres: seed_genres.length,
        willUseTracks: hasTracks
      });

      // Final validation - we must have at least one seed
      if (!seed_artists.length && !seed_tracks.length && !seed_genres.length) {
        console.error('No valid seeds available after all fallbacks');
        alert('Not enough listening history to generate recommendations. Please listen to more music on Spotify first.');
        setIsLoading(false);
        return;
      }

      // safe URL assembly (prevents malformed queries → 404)
      // Spotify requires at least 1 seed and max 5 total seeds
      // Strategy: Prefer tracks (most reliable), then artists, then genres
      let maxTrackSeeds, maxArtistSeeds, maxGenreSeeds;
      
      if (hasTracks) {
        // If we have tracks, use ONLY tracks (no artists) - Spotify works better with pure track seeds
        // Use 2-5 track seeds for best results
        maxTrackSeeds = Math.min(seed_tracks.length, 5);
        maxArtistSeeds = 0; // Don't mix tracks and artists - can cause 404s
        maxGenreSeeds = 0;
        console.log('Using track-only seeds:', maxTrackSeeds, 'tracks');
      } else if (hasArtists) {
        // If we have artists but no tracks, use multiple artists (at least 2-3 for better results)
        // Spotify works better with multiple artist seeds
        maxArtistSeeds = Math.min(seed_artists.length, 5); // Use up to 5 artists if we have them
        maxGenreSeeds = Math.min(seed_genres.length, Math.max(0, 5 - maxArtistSeeds));
        maxTrackSeeds = 0;
        
        // If we only have 1 artist, try to get more from related artists
        if (maxArtistSeeds === 1 && seed_artists.length > 0) {
          console.warn('Only 1 artist seed available - Spotify may reject this. Trying to get more...');
          // Try to get related artists from the single artist we have
          try {
            const relatedResponse = await fetch(`https://api.spotify.com/v1/artists/${seed_artists[0]}/related-artists`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (relatedResponse.ok) {
              const relatedData = await relatedResponse.json();
              const additionalArtists = (relatedData.artists || [])
                .slice(0, 4)
                .map(a => a?.id)
                .filter(isSpotifyId);
              if (additionalArtists.length > 0) {
                seed_artists.push(...additionalArtists);
                maxArtistSeeds = Math.min(seed_artists.length, 5);
                console.log('Added related artists, now have', maxArtistSeeds, 'artist seeds');
              }
            }
          } catch (e) {
            console.warn('Could not get related artists:', e);
          }
        }
      } else {
        // Fallback to genres only
        maxGenreSeeds = Math.min(seed_genres.length, 5);
        maxArtistSeeds = 0;
        maxTrackSeeds = 0;
      }
      
      // Final validation - ensure we have at least 1 seed total
      if (maxArtistSeeds + maxTrackSeeds + maxGenreSeeds === 0) {
        console.error('No valid seeds after limiting');
        alert('Not enough listening history to generate recommendations. Please listen to more music on Spotify first.');
        setIsLoading(false);
        return;
      }

      // Build parameters - Spotify recommendations API requires at least 1 seed
      // Important: Use comma-separated values, not multiple params
      const params = new URLSearchParams();
      params.set('limit', '20');
      
      // Market parameter - use from user profile or default to US
      const market = userStats?.country || 'US';
      params.set('market', market);
      
      // Spotify requires at least 1 seed - validate we have valid seeds
      let seedCount = 0;
      if (maxTrackSeeds > 0) {
        const trackIds = seed_tracks.slice(0, maxTrackSeeds);
        console.log('Using track IDs:', trackIds);
        // Join with comma - Spotify expects comma-separated string
        params.set('seed_tracks', trackIds.join(','));
        seedCount = trackIds.length;
      } else if (maxArtistSeeds > 0) {
        const artistIds = seed_artists.slice(0, maxArtistSeeds);
        console.log('Using artist IDs:', artistIds);
        params.set('seed_artists', artistIds.join(','));
        seedCount = artistIds.length;
      } else if (maxGenreSeeds > 0) {
        const genreNames = seed_genres.slice(0, maxGenreSeeds);
        console.log('Using genre names:', genreNames);
        params.set('seed_genres', genreNames.join(','));
        seedCount = genreNames.length;
      } else {
        console.error('No valid seeds to use!');
        alert('No valid seeds available. Please try reconnecting to Spotify.');
        setIsLoading(false);
        return;
      }

      // Validate we have at least 1 seed (Spotify requirement)
      if (seedCount === 0) {
        console.error('Seed count is 0!');
        alert('No valid seeds available. Please try reconnecting to Spotify.');
        setIsLoading(false);
        return;
      }

      const url = `https://api.spotify.com/v1/recommendations?${params.toString()}`;
      console.log('Final Recs URL:', url);
      console.log('URL breakdown:', {
        limit: params.get('limit'),
        market: params.get('market'),
        seed_tracks: params.get('seed_tracks'),
        seed_artists: params.get('seed_artists'),
        seed_genres: params.get('seed_genres'),
        seedCount
      });
      console.log('Seeds:', { 
        artists: seed_artists.slice(0, maxArtistSeeds), 
        tracks: seed_tracks.slice(0, maxTrackSeeds), 
        genres: seed_genres.slice(0, maxGenreSeeds),
        artistIds: seed_artists.slice(0, maxArtistSeeds),
        trackIds: seed_tracks.slice(0, maxTrackSeeds)
      });

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      
      // Log full response for debugging
      if (!res.ok) {
        const errorBody = await res.clone().json().catch(() => ({ message: 'Unknown error' }));
        console.error('Spotify API Error:', {
          status: res.status,
          statusText: res.statusText,
          url: url.substring(0, 100) + '...',
          error: errorBody
        });
      }

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
        return getRecommendations(topArtists, token, tracks);
      }
      if (!res.ok) {
        let errorText = '';
        try {
          const errorData = await res.json();
          errorText = JSON.stringify(errorData);
          console.error('Recs failed:', res.status, errorData);
        } catch (e) {
          errorText = await res.text().catch(() => '');
          console.error('Recs failed:', res.status, errorText);
        }
        
        if (res.status === 400) {
          // Bad request - likely invalid seed parameters
          console.error('Invalid seeds - artist IDs:', seed_artists.slice(0, maxArtistSeeds));
          alert('Invalid recommendation parameters. Please try adjusting the discovery mode or reconnect to Spotify.');
        } else if (res.status === 404) {
          // Not found - could be invalid endpoint, token issue, or invalid seed IDs
          console.error('404 Error - Check if seed IDs are valid. Artist IDs:', seed_artists.slice(0, maxArtistSeeds));
          console.error('Track IDs:', seed_tracks.slice(0, maxTrackSeeds));
          
          // If we have tracks, try with ONLY tracks (no artists)
          if (seed_tracks.length > 0) {
            console.log('Retrying with track seeds only (no artists)...');
            const trackOnlyParams = new URLSearchParams();
            trackOnlyParams.set('limit', '20');
            trackOnlyParams.set('market', userStats?.country || 'US');
            // Use 2-5 track seeds for best results
            const trackSeedCount = Math.min(seed_tracks.length, 5);
            const trackIdsToUse = seed_tracks.slice(0, trackSeedCount);
            console.log('Retry track IDs:', trackIdsToUse);
            trackOnlyParams.set('seed_tracks', trackIdsToUse.join(','));
            
            const retryUrl = `https://api.spotify.com/v1/recommendations?${trackOnlyParams.toString()}`;
            console.log('Retry URL:', retryUrl);
            
            // First verify one of the track IDs is valid
            if (trackIdsToUse.length > 0) {
              try {
                const trackTest = await fetch(`https://api.spotify.com/v1/tracks/${trackIdsToUse[0]}`, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                if (trackTest.ok) {
                  console.log('Track ID is valid:', trackIdsToUse[0]);
                } else {
                  console.error('Track ID validation failed:', trackTest.status, await trackTest.json().catch(() => ({})));
                }
              } catch (e) {
                console.error('Failed to validate track ID:', e);
              }
            }
            
            const retryRes = await fetch(retryUrl, { headers: { Authorization: `Bearer ${token}` } });
            
            if (retryRes.ok) {
              const retryData = await retryRes.json();
              if (retryData?.tracks?.length) {
                console.log('Success with track-only seeds! Got', retryData.tracks.length, 'tracks');
                setRecommendations(retryData.tracks);
                setCurrentTrack(retryData.tracks[0]);
                setIsLoading(false);
                return;
              } else {
                console.error('Retry succeeded but no tracks returned:', retryData);
              }
            } else {
              const retryError = await retryRes.json().catch(() => ({}));
              console.error('Retry also failed:', retryRes.status, retryError);
              
              // If 404 on recommendations with valid track IDs, token might not have right scopes
              if (retryRes.status === 404) {
                console.error('404 on recommendations with valid track IDs - token may lack required scopes');
                alert('Spotify API access issue. Please disconnect and reconnect to Spotify to refresh permissions.');
              }
            }
          }
          
          // If still failing, the token might be invalid or IDs are wrong
          alert('Could not load recommendations. Please try disconnecting and reconnecting to Spotify.');
        } else {
          alert(`Failed to load recommendations (${res.status}). Try reconnecting.`);
        }
        setIsLoading(false);
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
        await getRecommendations(userStats.topArtists, spotifyToken, userStats.topTracks || [])
      }
    }
  }

  useEffect(() => {
  if (isConnected && spotifyToken && userStats?.topArtists?.length) {
    setIsLoading(true);
    getRecommendations(userStats.topArtists, spotifyToken, userStats.topTracks || []);
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