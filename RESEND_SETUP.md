# Resend Email Setup for Support Form

## Setup Instructions

### 1. Create a Resend Account
- Go to [resend.com](https://resend.com) and create an account
- Verify your domain or use the provided sandbox domain for testing

### 2. Get Your API Key
- In your Resend dashboard, go to API Keys
- Create a new API key
- Copy the API key (starts with `re_`)

### 3. Set Environment Variables

Add these environment variables to your `.env` file or Cloudflare Workers environment:

```bash
RESEND_API_KEY=re_your_api_key_here
SUPPORT_EMAIL=your-email@yourdomain.com
```

### 4. Domain Verification (Optional but Recommended)
- In Resend dashboard, add and verify your domain
- Update the `from` email in the code to use your verified domain
- Example: `from: 'MCPDploy Support <support@yourdomain.com>'`

### 5. Testing
- Send a test support request to `/support/contact`
- Check your email inbox for the support ticket
- Check the console logs for any errors

## Email Format

The support emails will include:
- **From**: MCPDploy Support <noreply@mcpdploy.com>
- **To**: Your support email (from SUPPORT_EMAIL env var)
- **Reply-To**: User's email (if authenticated) or noreply@mcpdploy.com
- **Subject**: [Support] [category] subject
- **Content**: User details, message, and ticket ID

## Troubleshooting

- If emails aren't sending, check the console logs for errors
- Ensure your RESEND_API_KEY is correct
- Make sure your domain is verified in Resend (if using custom domain)
- Check that SUPPORT_EMAIL is set correctly 