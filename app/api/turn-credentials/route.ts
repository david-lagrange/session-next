import { NextResponse } from 'next/server';

// Your Metered credentials
const METERED_DOMAIN = process.env.METERED_DOMAIN;
const METERED_SECRET_KEY = process.env.METERED_SECRET_KEY;

export async function GET() {
  console.log('[TURN API] Received request for TURN credentials');
  
  try {
    if (!METERED_DOMAIN || !METERED_SECRET_KEY) {
      console.warn('[TURN API] Missing Metered credentials in environment variables');
      throw new Error('Missing Metered configuration');
    }
    
    console.log(`[TURN API] Fetching credentials from ${METERED_DOMAIN}`);
    
    // Fetch TURN credentials from Metered API using your domain and secret key
    const response = await fetch(
      `https://${METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${METERED_SECRET_KEY}`
    );
    
    if (!response.ok) {
      console.error(`[TURN API] Metered API error: ${response.status} ${response.statusText}`);
      throw new Error(`Metered API returned ${response.status}: ${response.statusText}`);
    }
    
    const credentials = await response.json();
    
    // Enhance credentials to prioritize TCP connections for TURN servers
    const enhancedCredentials = Array.isArray(credentials) ? 
      credentials.map(server => {
        // Convert credentials to string if they aren't already
        if (server.credential && typeof server.credential !== 'string') {
          server.credential = String(server.credential);
        }
        if (server.username && typeof server.username !== 'string') {
          server.username = String(server.username);
        }
        
        // For TURN servers, ensure TCP transport is specified or add it
        if (typeof server.urls === 'string' && 
            server.urls.includes('turn:') && 
            !server.urls.includes('?transport=tcp')) {
          return { ...server, urls: `${server.urls}?transport=tcp` };
        }
        return server;
      }) : credentials;
    
    // Log success information with more details but still being careful about credentials
    console.log(`[TURN API] Successfully retrieved and enhanced credentials from Metered`, {
      serverCount: Array.isArray(enhancedCredentials) ? enhancedCredentials.length : 'unknown format',
      urls: Array.isArray(enhancedCredentials) ? 
        enhancedCredentials.map(server => server.urls).flat() : 
        'unknown format',
      hasCredentials: Array.isArray(enhancedCredentials) ? 
        enhancedCredentials.map(server => !!server.credential && !!server.username) :
        'unknown format',
      timestamp: new Date().toISOString()
    });
    
    // Return the enhanced credentials to the client
    return NextResponse.json({ iceServers: enhancedCredentials });
  } catch (error) {
    console.error('[TURN API] Error fetching TURN credentials:', error);
    
    console.log('[TURN API] Using fallback ICE servers');
    
    // Enhanced fallback with more reliable TCP options
    return NextResponse.json({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        // Public Metered TURN servers as fallback - prioritize TCP for better NAT traversal
        { 
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        { 
          urls: 'turns:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        // Include UDP options as last resort
        { 
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ]
    }, { status: 200 });
  }
} 
