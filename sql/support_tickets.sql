-- Create support_tickets table
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_email TEXT,
    user_name TEXT,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in-progress', 'resolved', 'closed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_support_tickets_user_id ON public.support_tickets(user_id);
CREATE INDEX idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX idx_support_tickets_created_at ON public.support_tickets(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can view their own tickets
CREATE POLICY "Users can view own tickets" ON public.support_tickets
    FOR SELECT USING (auth.uid() = user_id);

-- Users can create tickets (even anonymous users)
CREATE POLICY "Anyone can create tickets" ON public.support_tickets
    FOR INSERT WITH CHECK (true);

-- Only admins can update tickets (you'll need to create an admin role)
-- CREATE POLICY "Admins can update tickets" ON public.support_tickets
--     FOR UPDATE USING (auth.jwt() ->> 'role' = 'admin');

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create a trigger to call the function
CREATE TRIGGER update_support_tickets_updated_at BEFORE UPDATE
    ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); 