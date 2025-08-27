-- Add billable_requests_today field to usage_daily_stats table
-- This field tracks actual MCP functional requests (tools/call, resources/read, prompts/get)
-- separate from total_requests which includes all HTTP API calls

ALTER TABLE usage_daily_stats 
ADD COLUMN billable_requests_today INTEGER DEFAULT 0;

-- Add comment to explain the field
COMMENT ON COLUMN usage_daily_stats.billable_requests_today IS 'Count of billable MCP requests (tools/call, resources/read, prompts/get) for this date. Excludes protocol handshake methods like initialize, tools/list, etc.';

-- Create an index for better query performance
CREATE INDEX idx_usage_daily_stats_billable_requests ON usage_daily_stats(user_id, date, billable_requests_today);

-- Update existing records to have 0 billable requests (since we don't have historical data)
UPDATE usage_daily_stats SET billable_requests_today = 0 WHERE billable_requests_today IS NULL;

-- Optional: Create a view that combines both API and MCP usage for easy reporting
CREATE OR REPLACE VIEW user_daily_usage_combined AS
SELECT 
    uds.id,
    uds.user_id,
    uds.date,
    uds.total_requests as api_requests,
    uds.billable_requests_today as mcp_billable_requests,
    uds.successful_requests,
    uds.failed_requests,
    uds.auth_errors,
    uds.rate_limit_errors,
    uds.server_errors,
    uds.avg_response_time_ms,
    uds.p95_response_time_ms,
    uds.p99_response_time_ms,
    uds.created_at,
    uds.updated_at,
    -- Get current usage_v2 data for today if available
    CASE 
        WHEN uds.date = CURRENT_DATE THEN 
            COALESCE((us.usage_v2->>'requests_today')::integer, 0)
        ELSE 
            uds.billable_requests_today
    END as current_billable_requests
FROM usage_daily_stats uds
LEFT JOIN user_subscriptions us ON uds.user_id = us.user_id
ORDER BY uds.date DESC;

-- Grant appropriate permissions
GRANT SELECT ON user_daily_usage_combined TO authenticated;
GRANT SELECT ON user_daily_usage_combined TO service_role; 
