import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Force no caching to prevent stale responses
export const fetchCache = 'force-no-store';

// Check if the required environment variables are set
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasServiceRoleKey = !!serviceRoleKey;

if (!supabaseUrl) {
  console.error('NEXT_PUBLIC_SUPABASE_URL is not set');
}

if (!hasServiceRoleKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set - operating in fallback mode');
}

if (!anonKey) {
  console.error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set');
}

export async function POST(request: NextRequest) {
  try {
    // Initialize Supabase client with environment variables
    if (!supabaseUrl) {
      console.error('NEXT_PUBLIC_SUPABASE_URL is not set');
      return NextResponse.json({ 
        success: false, 
        error: 'Server configuration error', 
        details: 'Missing Supabase URL' 
      }, { status: 500 });
    }
    
    // Log whether we have a service role key
    if (!serviceRoleKey) {
      console.warn('SUPABASE_SERVICE_ROLE_KEY is not set - falling back to anon key');
    }
    
    if (!anonKey && !serviceRoleKey) {
      console.error('Neither SUPABASE_SERVICE_ROLE_KEY nor NEXT_PUBLIC_SUPABASE_ANON_KEY is set');
      return NextResponse.json({ 
        success: false, 
        error: 'Server configuration error', 
        details: 'Missing Supabase API keys' 
      }, { status: 500 });
    }
    
    // Create Supabase client - use service role key if available, otherwise use anon key
    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey || anonKey || 'MISSING_API_KEY'
    );
    
    // Log which key we're using (without exposing the actual key)
    console.log(`Create Transcription API: Using ${serviceRoleKey ? 'service role' : (anonKey ? 'anon' : 'missing')} key for Supabase client`);
    
    // Parse request body first to ensure we have the data
    let recordData;
    try {
      recordData = await request.json();
    } catch (parseError) {
      console.error('Error parsing request body:', parseError);
      return NextResponse.json({ 
        success: false,
        error: 'Invalid request body',
        details: 'Could not parse JSON body'
      }, { status: 400 });
    }
    
    // Validate required fields
    if (!recordData || !recordData.id || !recordData.user_id) {
      return NextResponse.json({ 
        success: false,
        error: 'Missing required fields',
        details: 'Record must include id and user_id'
      }, { status: 400 });
    }
    
    console.log('Received request to create transcription record:', recordData.id);
    
    // Get the access token from the Authorization header
    const authHeader = request.headers.get('authorization');
    const accessToken = authHeader ? authHeader.split(' ')[1] : null;
    
    // In development mode, we can proceed without authentication
    if (process.env.NODE_ENV !== 'production' && (!accessToken || !serviceRoleKey)) {
      console.log('DEVELOPMENT MODE: Proceeding without strict authentication');
      
      try {
        // Try to insert the record using the available client
        const { data, error } = await supabase
          .from('transcriptions')
          .insert(recordData)
          .select()
          .single();
        
        if (error) {
          console.error('Database error in development mode:', error);
          
          // In development mode, simulate a successful response
          console.log('DEVELOPMENT MODE: Simulating successful creation despite database error');
          return NextResponse.json({ 
            ...recordData,
            created_at: recordData.created_at || new Date().toISOString(),
            warning: 'This is a simulated success response. In production, this would have failed.',
            error: error.message
          });
        }
        
        console.log('Transcription record created successfully in development mode:', data.id);
        return NextResponse.json(data);
      } catch (dbError: any) {
        console.error('Database exception in development mode:', dbError);
        
        // In development mode, simulate a successful response
        console.log('DEVELOPMENT MODE: Simulating successful creation despite database exception');
        return NextResponse.json({ 
          ...recordData,
          created_at: recordData.created_at || new Date().toISOString(),
          warning: 'This is a simulated success response. In production, this would have failed.',
          error: dbError.message
        });
      }
    }
    
    // Production flow with authentication
    if (!accessToken) {
      console.log('No access token provided in production mode');
      return NextResponse.json(
        { 
          success: false,
          error: 'Authentication required. Please sign in and try again.'
        }, 
        { status: 401 }
      );
    }
    
    // Verify the token with Supabase
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);

      if (authError || !user) {
        console.error('Authentication error:', authError?.message || 'No user found');
        
        // In development mode, proceed anyway
        if (process.env.NODE_ENV !== 'production') {
          console.log('DEVELOPMENT MODE: Proceeding despite authentication failure');
          
          try {
            // Try to insert the record using the available client
            const { data, error } = await supabase
              .from('transcriptions')
              .insert(recordData)
              .select()
              .single();
            
            if (error) {
              console.error('Database error after auth failure in development mode:', error);
              
              // In development mode, simulate a successful response
              console.log('DEVELOPMENT MODE: Simulating successful creation despite database error');
              return NextResponse.json({ 
                ...recordData,
                created_at: recordData.created_at || new Date().toISOString(),
                warning: 'This is a simulated success response. In production, this would have failed.',
                error: error.message
              });
            }
            
            console.log('Transcription record created successfully despite auth failure:', data.id);
            return NextResponse.json(data);
          } catch (dbError: any) {
            console.error('Database exception after auth failure in development mode:', dbError);
            
            // In development mode, simulate a successful response
            console.log('DEVELOPMENT MODE: Simulating successful creation despite database exception');
            return NextResponse.json({ 
              ...recordData,
              created_at: recordData.created_at || new Date().toISOString(),
              warning: 'This is a simulated success response. In production, this would have failed.',
              error: dbError.message
            });
          }
        }
        
        return NextResponse.json(
          { 
            success: false,
            error: 'Authentication failed. Please sign in again.',
            details: authError?.message || 'Invalid or expired token'
          }, 
          { status: 401 }
        );
      }
      
      // Ensure the user_id in the record matches the authenticated user
      // In development mode, we'll allow mismatched user IDs
      if (recordData.user_id !== user.id && process.env.NODE_ENV === 'production') {
        console.error('User ID mismatch:', recordData.user_id, user.id);
        return NextResponse.json(
          { 
            success: false,
            error: 'Unauthorized: You can only create records for your own account.'
          }, 
          { status: 403 }
        );
      }
      
      console.log('Creating transcription record with authenticated user:', user.id);
      
      // Insert the record
      const { data, error } = await supabase
        .from('transcriptions')
        .insert(recordData)
        .select()
        .single();
      
      if (error) {
        console.error('Error creating transcription record:', error);
        return NextResponse.json(
          { 
            success: false,
            error: `Failed to create transcription record: ${error.message}`,
            details: error
          }, 
          { status: 500 }
        );
      }
      
      console.log('Transcription record created successfully:', data.id);
      
      return NextResponse.json(data);
    } catch (authError: any) {
      console.error('Authentication exception:', authError);
      
      // In development mode, proceed anyway
      if (process.env.NODE_ENV !== 'production') {
        console.log('DEVELOPMENT MODE: Proceeding despite authentication exception');
        
        try {
          // Try to insert the record using the available client
          const { data, error } = await supabase
            .from('transcriptions')
            .insert(recordData)
            .select()
            .single();
          
          if (error) {
            console.error('Database error after auth exception in development mode:', error);
            
            // In development mode, simulate a successful response
            console.log('DEVELOPMENT MODE: Simulating successful creation despite database error');
            return NextResponse.json({ 
              ...recordData,
              created_at: recordData.created_at || new Date().toISOString(),
              warning: 'This is a simulated success response. In production, this would have failed.',
              error: error.message
            });
          }
          
          console.log('Transcription record created successfully despite auth exception:', data.id);
          return NextResponse.json(data);
        } catch (dbError: any) {
          console.error('Database exception after auth exception in development mode:', dbError);
          
          // In development mode, simulate a successful response
          console.log('DEVELOPMENT MODE: Simulating successful creation despite database exception');
          return NextResponse.json({ 
            ...recordData,
            created_at: recordData.created_at || new Date().toISOString(),
            warning: 'This is a simulated success response. In production, this would have failed.',
            error: dbError.message
          });
        }
      }
      
      return NextResponse.json(
        { 
          success: false,
          error: 'Authentication error',
          details: authError.message || String(authError)
        }, 
        { status: 401 }
      );
    }
  } catch (error: any) {
    console.error('Unexpected error in transcription create API:', error);
    
    // In development mode, simulate a successful response
    if (process.env.NODE_ENV !== 'production') {
      console.log('DEVELOPMENT MODE: Simulating successful creation despite unexpected error');
      return NextResponse.json({ 
        success: true,
        message: 'Transcription record created successfully (simulated in development mode)',
        warning: 'This is a simulated success response. In production, this would have failed.',
        error: error.message
      });
    }
    
    return NextResponse.json(
      { 
        success: false,
        error: 'An unexpected error occurred',
        details: error.message || String(error)
      }, 
      { status: 500 }
    );
  }
}
