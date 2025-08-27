# MCP Deploy Backend

Backend for MCP Deploy no cap

## Prerequisites

- **Node.js** 18.x+ 
- **npm** (comes with Node)
- **Git** 
- **Wrangler CLI**: `npm install -g wrangler`

## Quick Start

```bash
git clone <repository-url>
cd backend-mcp

npm install
cp .env.example .env

npm run dev
```

## Environment Variables REQUIRED

Drop these in your `.env` file:

```
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-key
RESEND_API_KEY=your-resend-key
SUPPORT_EMAIL=support@yourapp.com
STRIPE_SECRET_KEY=your-stripe-secret
STRIPE_WEBHOOK_SECRET=your-webhook-secret
MCP_FRONTEND_BASE_URL=your-frontend-url
```

Check `RESEND_SETUP.md` for Resend details.

## Deploy

```bash
npm run deploy
```

Make sure your `wrangler.toml` is configured first.

## TODO: Code Updates
- [ ] Write tests (fr this time)
- [ ] Refactor MCP tools
- [ ] Refactor MCP handler
- [ ] Add environment validation
- [ ] Implement health checks
- [ ] Set up monitoring and logging
- [ ] Add rate limiting
- [ ] Write integration and unit tests
- [ ] set up github actions for merging into main 
- [ ] remove sql into separate db migrations - DBMATE