import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

export const analyticsRoutes = new Hono<any>();

// Helper to get an authenticated Supabase client (respects RLS)
function getAuthenticatedSupabaseClient(c: any) {
  const supabaseUrl = c.env?.SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = c.env?.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL and anon key must be provided.');
  }
  
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error('Authorization header required');
  }
  
  const userJwt = authHeader.replace("Bearer ", "");
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } }
  });
}

// Get current user's analytics summary
analyticsRoutes.get('/analytics/summary', async (c) => {
  const userId = c.var.userId;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  try {
    // Use authenticated client for RLS compliance
    const authenticatedSupabase = getAuthenticatedSupabaseClient(c);
    
    // Get user analytics summary from the view
    const { data: summary, error: summaryError } = await authenticatedSupabase
      .from('user_analytics_summary')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (summaryError) {
      console.error('[Analytics Summary] Error:', summaryError);
      return c.json({ error: 'Failed to fetch analytics summary' }, 500);
    }

    // Get additional real-time stats
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    // Get today's detailed stats
    const { data: todayStats } = await authenticatedSupabase
      .from('usage_daily_stats')
      .select('*')
      .eq('user_id', userId)
      .eq('date', todayStart.toISOString().slice(0, 10))
      .single();

    // Get this month's aggregated stats
    const { data: monthStats } = await authenticatedSupabase
      .from('usage_monthly_stats')
      .select('*')
      .eq('user_id', userId)
      .eq('year', now.getFullYear())
      .eq('month', now.getMonth() + 1)
      .single();

    // Get recent errors
    const { data: recentErrors } = await authenticatedSupabase
      .from('usage_analytics')
      .select('endpoint, status_code, error_type, error_message, created_at')
      .eq('user_id', userId)
      .gte('status_code', 400)
      .order('created_at', { ascending: false })
      .limit(5);

    // Get most used endpoints
    const { data: topEndpoints } = await authenticatedSupabase
      .from('usage_analytics')
      .select('endpoint')
      .eq('user_id', userId)
      .gte('created_at', monthStart.toISOString());

    // Process top endpoints (this would be better done in a materialized view)
    const endpointCounts: Record<string, number> = {};
    if (topEndpoints) {
      topEndpoints.forEach(row => {
        endpointCounts[row.endpoint] = (endpointCounts[row.endpoint] || 0) + 1;
      });
    }
    const topEndpointsList = Object.entries(endpointCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([endpoint, count]) => ({ endpoint, count }));

    return c.json({
      summary,
      today_stats: todayStats,
      month_stats: monthStats,
      recent_errors: recentErrors,
      top_endpoints: topEndpointsList
    });
  } catch (error) {
    console.error('[Analytics Summary] Unexpected error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Get daily analytics for a date range
analyticsRoutes.get('/analytics/daily', async (c) => {
  const userId = c.var.userId;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');

  if (!startDate || !endDate) {
    return c.json({ error: 'start_date and end_date are required' }, 400);
  }

  try {
    // Use authenticated client for RLS compliance
    const authenticatedSupabase = getAuthenticatedSupabaseClient(c);
    
    // Get daily stats from usage_daily_stats
    const { data: dailyStats, error: dailyError } = await authenticatedSupabase
      .from('usage_daily_stats')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false });

    if (dailyError) {
      console.error('[Analytics Daily] Error fetching daily stats:', dailyError);
      return c.json({ error: 'Failed to fetch daily analytics' }, 500);
    }

    // Get current user subscription to access usage_v2 data
    let subscription = null;
    try {
      const { data: subData, error: subError } = await authenticatedSupabase
        .from('user_subscriptions')
        .select('usage_v2')
        .eq('user_id', userId)
        .single();

      if (subError) {
        console.error('[Analytics Daily] Error fetching subscription:', subError);
        // Continue without subscription data
      } else {
        subscription = subData;
      }
    } catch (error) {
      console.error('[Analytics Daily] Error fetching subscription:', error);
    }

    // Extract current billable request count from usage_v2
    const usageV2 = subscription?.usage_v2 || {};
    const currentBillableRequests = usageV2.requests_today || 0;
    const currentDate = usageV2.requests_today_date;

    // Enhance the daily stats with billable request data
    const enhancedStats = (dailyStats || []).map(stat => {
      const enhancedStat = { ...stat };
      
      // Add billable requests for today's date if it matches
      if (stat.date === currentDate) {
        enhancedStat.billable_requests_today = currentBillableRequests;
      } else {
        // For historical dates, we don't have this data, so set to null
        enhancedStat.billable_requests_today = null;
      }
      
      return enhancedStat;
    });

    // If today's date is in the range but not in daily_stats, add it
    const today = new Date().toISOString().slice(0, 10);
    const hasToday = enhancedStats.some(stat => stat.date === today);
    
    if (!hasToday && today >= startDate && today <= endDate && currentDate === today) {
      enhancedStats.unshift({
        id: null,
        user_id: userId,
        date: today,
        total_requests: 0,
        successful_requests: 0,
        failed_requests: 0,
        get_requests: 0,
        post_requests: 0,
        put_requests: 0,
        delete_requests: 0,
        avg_response_time_ms: null,
        p95_response_time_ms: null,
        p99_response_time_ms: null,
        total_request_bytes: 0,
        total_response_bytes: 0,
        unique_projects_accessed: 0,
        unique_endpoints_accessed: 0,
        auth_errors: 0,
        rate_limit_errors: 0,
        server_errors: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        billable_requests_today: currentBillableRequests
      });
    }

    return c.json(enhancedStats);
  } catch (error) {
    console.error('[Analytics Daily] Unexpected error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Get monthly analytics
analyticsRoutes.get('/analytics/monthly', async (c) => {
  const userId = c.var.userId;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const year = c.req.query('year');
  const limit = parseInt(c.req.query('limit') || '12');

  try {
    // Use authenticated client for RLS compliance
    const authenticatedSupabase = getAuthenticatedSupabaseClient(c);
    
    let query = authenticatedSupabase
      .from('usage_monthly_stats')
      .select('*')
      .eq('user_id', userId)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(limit);

    if (year) {
      query = query.eq('year', parseInt(year));
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Analytics Monthly] Error:', error);
      return c.json({ error: 'Failed to fetch monthly analytics' }, 500);
    }

    return c.json(data || []);
  } catch (error) {
    console.error('[Analytics Monthly] Unexpected error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Get detailed analytics logs
analyticsRoutes.get('/analytics/logs', async (c) => {
  const userId = c.var.userId;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('page_size') || '50');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  const statusCode = c.req.query('status_code');
  const method = c.req.query('method');
  const endpoint = c.req.query('endpoint');

  try {
    let query = supabase
      .from('usage_analytics')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }
    if (statusCode) {
      query = query.eq('status_code', parseInt(statusCode));
    }
    if (method) {
      query = query.eq('method', method);
    }
    if (endpoint) {
      query = query.ilike('endpoint', `%${endpoint}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('[Analytics Logs] Error:', error);
      return c.json({ error: 'Failed to fetch analytics logs' }, 500);
    }

    return c.json({
      data: data || [],
      pagination: {
        page,
        page_size: pageSize,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / pageSize)
      }
    });
  } catch (error) {
    console.error('[Analytics Logs] Unexpected error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Get analytics by project
analyticsRoutes.get('/analytics/projects', async (c) => {
  const userId = c.var.userId;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');

  try {
    let query = supabase
      .from('usage_analytics')
      .select('project_id, mcp_servers!inner(name)')
      .eq('user_id', userId)
      .not('project_id', 'is', null);

    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Analytics Projects] Error:', error);
      return c.json({ error: 'Failed to fetch project analytics' }, 500);
    }

    // Aggregate by project
    const projectStats: Record<string, { name: string; count: number; project_id: string }> = {};
    
    if (data) {
      data.forEach((row: any) => {
        const projectId = row.project_id;
        const projectName = row.mcp_servers?.name || 'Unknown Project';
        
        if (!projectStats[projectId]) {
          projectStats[projectId] = { 
            project_id: projectId,
            name: projectName, 
            count: 0 
          };
        }
        projectStats[projectId].count++;
      });
    }

    const projectList = Object.values(projectStats)
      .sort((a, b) => b.count - a.count);

    return c.json(projectList);
  } catch (error) {
    console.error('[Analytics Projects] Unexpected error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Get performance metrics
analyticsRoutes.get('/analytics/performance', async (c) => {
  const userId = c.var.userId;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const period = c.req.query('period') || 'day'; // day, week, month
  const projectId = c.req.query('project_id');

  try {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      default: // day
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    let query = supabase
      .from('usage_analytics')
      .select('response_time_ms, created_at')
      .eq('user_id', userId)
      .gte('created_at', startDate.toISOString())
      .not('response_time_ms', 'is', null);

    if (projectId) {
      query = query.eq('project_id', projectId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Analytics Performance] Error:', error);
      return c.json({ error: 'Failed to fetch performance metrics' }, 500);
    }

    if (!data || data.length === 0) {
      return c.json({
        avg_response_time: 0,
        p50_response_time: 0,
        p95_response_time: 0,
        p99_response_time: 0,
        min_response_time: 0,
        max_response_time: 0,
        total_requests: 0
      });
    }

    // Calculate percentiles
    const responseTimes = data
      .map(r => r.response_time_ms)
      .filter(t => t !== null && t !== undefined)
      .sort((a, b) => a - b);

    const getPercentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0;
      const index = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, index)];
    };

    const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;

    return c.json({
      avg_response_time: Math.round(avgResponseTime),
      p50_response_time: getPercentile(responseTimes, 50),
      p95_response_time: getPercentile(responseTimes, 95),
      p99_response_time: getPercentile(responseTimes, 99),
      min_response_time: responseTimes[0] || 0,
      max_response_time: responseTimes[responseTimes.length - 1] || 0,
      total_requests: data.length
    });
  } catch (error) {
    console.error('[Analytics Performance] Unexpected error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Export analytics data
analyticsRoutes.get('/analytics/export', async (c) => {
  const userId = c.var.userId;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const format = c.req.query('format') || 'json'; // json or csv
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');

  try {
    let query = supabase
      .from('usage_analytics')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Analytics Export] Error:', error);
      return c.json({ error: 'Failed to export analytics' }, 500);
    }

    if (format === 'csv') {
      // Convert to CSV
      const headers = [
        'timestamp', 'method', 'endpoint', 'status_code', 'response_time_ms',
        'request_size_bytes', 'response_size_bytes', 'error_type', 'user_agent'
      ];
      
      let csv = headers.join(',') + '\n';
      
      if (data) {
        data.forEach(row => {
          const values = [
            row.created_at,
            row.method,
            `"${row.endpoint}"`,
            row.status_code,
            row.response_time_ms || '',
            row.request_size_bytes || '',
            row.response_size_bytes || '',
            row.error_type || '',
            `"${row.user_agent || ''}"`
          ];
          csv += values.join(',') + '\n';
        });
      }

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="analytics-${startDate || 'all'}.csv"`
        }
      });
    }

    // Default to JSON
    return c.json(data || []);
  } catch (error) {
    console.error('[Analytics Export] Unexpected error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}); 