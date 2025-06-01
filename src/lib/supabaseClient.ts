import { createClient } from '@supabase/supabase-js'

// It's recommended to store these in environment variables
// For Cloudflare Workers, you'd set these as secrets in your Worker's settings
const supabaseUrl = process.env.SUPABASE_URL || "https://bzwwyoxfnjueipztlcmw.supabase.co"
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6d3d5b3hmbmp1ZWlweXRscmNtdyIsInJlc291cmNlIjoic3ViYXNlIiwiaWF0IjoxNzE2MjI0MjUyLCJleHAiOjIwMzE4MDAyNTJ9.09-0000000000000000000000000000000000000000000000000000000000000000"

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase URL and Anon Key must be provided.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey) 