# Account Deactivation and Deletion System

A production-ready implementation of user account deactivation with a 30-day grace period before permanent deletion, designed for GDPR/CCPA compliance and user experience.

## Overview

This system implements a two-phase account deletion process:

1. **Deactivation Phase**: Users can deactivate their accounts, which immediately revokes access but preserves all data for 30 days
2. **Deletion Phase**: After 30 days of inactivity, accounts and all associated data are permanently deleted

## Features

- ✅ **Immediate Deactivation**: Users can deactivate accounts instantly via API
- ✅ **Grace Period**: 30-day reactivation window before permanent deletion
- ✅ **Session Revocation**: All user sessions are immediately invalidated on deactivation
- ✅ **Cascading Deletion**: Comprehensive cleanup of all user-related data
- ✅ **Audit Logging**: Complete audit trail of all deactivation/deletion actions
- ✅ **Robust Error Handling**: Production-level error handling and logging
- ✅ **Admin Monitoring**: Admin endpoints for monitoring and manual cleanup
- ✅ **Security**: Proper authentication and authorization for all operations

## Environment Variables

Add these environment variables to your deployment:

```bash
# Required for admin cleanup operations
ADMIN_API_KEY=your-secure-admin-key-here

# Supabase configuration (should already be set)
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

## API Endpoints

### 1. Deactivate Account
```http
POST /auth/deactivate
Authorization: Bearer <user_jwt_token>
```

**Response:**
```json
{
  "message": "Account deactivated successfully. You have 30 days to reactivate your account before permanent deletion.",
  "deactivated_at": "2024-01-15T10:30:00Z",
  "scheduled_deletion_at": "2024-02-14T10:30:00Z"
}
```

### 2. Reactivate Account
```http
POST /auth/reactivate
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "user_password"
}
```

**Response:**
```json
{
  "message": "Account reactivated successfully. You can now login normally.",
  "reactivated_at": "2024-01-20T14:30:00Z",
  "access_token": "jwt_token_here",
  "refresh_token": "refresh_token_here",
  "user": { ... }
}
```

### 3. Check Account Status
```http
GET /auth/account-status
Authorization: Bearer <user_jwt_token>
```

**Response (Active Account):**
```json
{
  "user_id": "123e4567-e89b-12d3-a456-426614174000",
  "email": "user@example.com",
  "account_status": "active",
  "created_at": "2024-01-01T00:00:00Z"
}
```

**Response (Deactivated Account):**
```json
{
  "user_id": "123e4567-e89b-12d3-a456-426614174000",
  "email": "user@example.com",
  "account_status": "deactivated",
  "created_at": "2024-01-01T00:00:00Z",
  "deactivated_at": "2024-01-15T10:30:00Z",
  "scheduled_deletion_at": "2024-02-14T10:30:00Z",
  "days_until_deletion": 20,
  "can_reactivate": true
}
```

### 4. Admin Cleanup (Cron Job)
```http
POST /auth/cleanup-deactivated-accounts
X-Admin-Key: your-admin-api-key
```

**Response:**
```json
{
  "message": "Account cleanup completed",
  "processed": 5,
  "successful": 4,
  "failed": 1,
  "errors": [
    {
      "userId": "456e7890-e89b-12d3-a456-426614174000",
      "error": "Failed to delete user from auth",
      "step": "auth_deletion"
    }
  ]
}
```

## Setting Up Automated Cleanup

### Option 1: Cloudflare Cron Triggers (Recommended for Workers)

Add to your `wrangler.toml`:

```toml
[[triggers]]
crons = ["0 2 * * *"]  # Run daily at 2 AM UTC
```

Create a cron handler:

```typescript
export default {
  async scheduled(event, env, ctx) {
    const response = await fetch('https://your-api.com/auth/cleanup-deactivated-accounts', {
      method: 'POST',
      headers: {
        'X-Admin-Key': env.ADMIN_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    const result = await response.json();
    console.log('Cleanup result:', result);
  }
};
```

### Option 2: External Cron Service

Use services like GitHub Actions, cron-job.org, or your server's cron:

```bash
# Add to crontab (daily at 2 AM)
0 2 * * * curl -X POST "https://your-api.com/auth/cleanup-deactivated-accounts" \
  -H "X-Admin-Key: your-admin-api-key" \
  -H "Content-Type: application/json"
```

### Option 3: GitHub Actions (Free option)

Create `.github/workflows/cleanup.yml`:

```yaml
name: Account Cleanup
on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM UTC
  workflow_dispatch:  # Allow manual trigger

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Cleanup Deactivated Accounts
        run: |
          curl -X POST "${{ secrets.API_URL }}/auth/cleanup-deactivated-accounts" \
            -H "X-Admin-Key: ${{ secrets.ADMIN_API_KEY }}" \
            -H "Content-Type: application/json"
```

## Data Deletion Overview

When an account is permanently deleted, the following data is removed:

### User Data Tables
- `user_subscriptions` (user's subscription records)
- `usage_analytics` (user's usage analytics)
- `support_tickets` (user's support tickets)

### Project Data (Cascaded)
- `mcp_servers` (user's projects)
- `mcp_resources` (resources in user's projects)
- `mcp_tools` (tools in user's projects)
- `mcp_prompts` (prompts in user's projects)

### Authentication Data
- User profile from Supabase Auth
- All user sessions and tokens

## Security Considerations

### Authentication
- **Deactivation**: Requires valid JWT token
- **Reactivation**: Requires email/password authentication
- **Cleanup**: Requires admin API key
- **Status Check**: Requires valid JWT token

### Session Management
- All user sessions are revoked immediately on deactivation
- Deactivated users cannot authenticate or access API endpoints
- Clear error messages inform users about reactivation options

### Data Protection
- No sensitive data is logged (passwords, tokens, etc.)
- User metadata is used to store deactivation status (not exposed externally)
- Audit trail maintained for compliance purposes

## Monitoring and Logging

### What's Logged

1. **Deactivation Events**:
   ```json
   {
     "action": "account_deactivated",
     "user_id": "user-id",
     "deactivated_at": "timestamp",
     "reason": "user_requested"
   }
   ```

2. **Reactivation Events**:
   ```json
   {
     "action": "account_reactivated",
     "user_id": "user-id",
     "reactivated_at": "timestamp",
     "days_since_deactivation": 5
   }
   ```

3. **Deletion Events**:
   ```json
   {
     "action": "account_permanently_deleted",
     "user_id": "user-id",
     "deleted_at": "timestamp",
     "deactivated_at": "original-timestamp",
     "projects_deleted": 3
   }
   ```

4. **Blocked Access Attempts**:
   ```json
   {
     "action": "deactivated_account_blocked",
     "user_id": "user-id",
     "blocked_at": "timestamp",
     "days_until_deletion": 15
   }
   ```

### Monitoring Queries

Query the `usage_analytics` table to monitor system usage:

```sql
-- Count deactivations by day
SELECT 
  DATE(created_at) as date,
  COUNT(*) as deactivations
FROM usage_analytics 
WHERE metadata->>'action' = 'account_deactivated'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Count reactivations by day
SELECT 
  DATE(created_at) as date,
  COUNT(*) as reactivations,
  AVG((metadata->>'days_since_deactivation')::int) as avg_days
FROM usage_analytics 
WHERE metadata->>'action' = 'account_reactivated'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Count permanent deletions by day
SELECT 
  DATE(created_at) as date,
  COUNT(*) as deletions,
  SUM((metadata->>'projects_deleted')::int) as total_projects_deleted
FROM usage_analytics 
WHERE metadata->>'action' = 'account_permanently_deleted'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

## Error Handling

### Common Error Scenarios

1. **Invalid Token**: Returns 401 with clear error message
2. **Account Not Deactivated**: Returns 400 when trying to reactivate active account
3. **Reactivation Period Expired**: Returns 410 when past 30-day window
4. **Missing Admin Key**: Returns 401 for cleanup endpoint
5. **Database Errors**: Returns 500 with generic error (details in logs)

### Error Response Format

```json
{
  "error": "Human-readable error message",
  "code": "MACHINE_READABLE_ERROR_CODE",
  "message": "Detailed explanation",
  "... additional context fields ..."
}
```

## Testing

### Manual Testing

1. **Test Deactivation**:
   ```bash
   curl -X POST "https://your-api.com/auth/deactivate" \
     -H "Authorization: Bearer your-jwt-token"
   ```

2. **Test Blocked Access**:
   ```bash
   curl -X GET "https://your-api.com/mcp-projects" \
     -H "Authorization: Bearer deactivated-user-token"
   ```

3. **Test Reactivation**:
   ```bash
   curl -X POST "https://your-api.com/auth/reactivate" \
     -H "Content-Type: application/json" \
     -d '{"email": "user@example.com", "password": "password"}'
   ```

4. **Test Cleanup** (be careful in production):
   ```bash
   curl -X POST "https://your-api.com/auth/cleanup-deactivated-accounts" \
     -H "X-Admin-Key: your-admin-key"
   ```

### Unit Testing

The system includes comprehensive error handling and logging. Key test scenarios:

- Valid deactivation flow
- Invalid token handling
- Reactivation within grace period
- Reactivation after grace period
- Cascading deletion verification
- Admin authentication

## Production Deployment Checklist

- [ ] Set `ADMIN_API_KEY` environment variable
- [ ] Configure Supabase environment variables
- [ ] Set up automated cleanup cron job
- [ ] Configure monitoring/alerting for cleanup failures
- [ ] Test all endpoints in staging environment
- [ ] Verify cascading deletion works correctly
- [ ] Set up log aggregation for audit trail
- [ ] Document process for ops team
- [ ] Configure backup/disaster recovery procedures

## Compliance Notes

This system is designed to help with:

- **GDPR Article 17** (Right to Erasure)
- **CCPA** (Right to Delete)
- **User Experience** (Grace period for accidental deactivations)
- **Data Minimization** (Complete cleanup of user data)
- **Audit Requirements** (Full logging of all actions)

## Support and Maintenance

### Log Analysis
Monitor logs for:
- Cleanup job failures
- High deactivation rates
- Reactivation patterns
- Blocked access attempts

### Performance Considerations
- Cleanup job processes users in batches (1000 per run)
- Database operations are optimized for cascading deletes
- Logging is non-blocking (failures don't stop the process)

### Troubleshooting
- Check admin API key if cleanup fails
- Verify Supabase service role permissions
- Monitor rate limits on cleanup operations
- Check database constraints for deletion failures

For additional support, check the application logs and analytics dashboard for detailed error information. 