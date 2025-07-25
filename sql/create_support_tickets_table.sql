-- Create support_tickets table for contact support form
CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_email TEXT,
    user_name TEXT,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    admin_notes TEXT
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_support_tickets_category ON support_tickets(category);

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_support_tickets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_support_tickets_updated_at
    BEFORE UPDATE ON support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION update_support_tickets_updated_at();

-- Enable Row Level Security (RLS)
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Create policies for secure access
-- Users can only see their own tickets (if authenticated)
CREATE POLICY "Users can view own tickets" ON support_tickets
    FOR SELECT USING (
        (auth.uid() = user_id) OR 
        (auth.uid() IS NULL AND user_id IS NULL)
    );

-- Anyone can create tickets (including anonymous users)
CREATE POLICY "Anyone can create tickets" ON support_tickets
    FOR INSERT WITH CHECK (true);

-- Users can update their own tickets (if authenticated)
CREATE POLICY "Users can update own tickets" ON support_tickets
    FOR UPDATE USING (
        (auth.uid() = user_id) OR 
        (auth.uid() IS NULL AND user_id IS NULL)
    );

-- Admins can view all tickets (you'll need to set up admin role)
-- CREATE POLICY "Admins can view all tickets" ON support_tickets
--     FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

-- Add comments for documentation
COMMENT ON TABLE support_tickets IS 'Support tickets for user contact form submissions';
COMMENT ON COLUMN support_tickets.user_id IS 'User ID if authenticated, NULL for anonymous submissions';
COMMENT ON COLUMN support_tickets.user_email IS 'User email address for contact';
COMMENT ON COLUMN support_tickets.user_name IS 'User name if provided';
COMMENT ON COLUMN support_tickets.subject IS 'Support ticket subject';
COMMENT ON COLUMN support_tickets.message IS 'Support ticket message content';
COMMENT ON COLUMN support_tickets.category IS 'Ticket category (general, technical, billing, etc.)';
COMMENT ON COLUMN support_tickets.status IS 'Ticket status (open, in_progress, resolved, closed)';
COMMENT ON COLUMN support_tickets.priority IS 'Ticket priority level';
COMMENT ON COLUMN support_tickets.assigned_to IS 'Admin user assigned to handle this ticket';
COMMENT ON COLUMN support_tickets.admin_notes IS 'Internal notes for admin use'; 