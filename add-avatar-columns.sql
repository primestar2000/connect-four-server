-- Add avatar columns to players table
ALTER TABLE players 
ADD COLUMN IF NOT EXISTS avatar TEXT,
ADD COLUMN IF NOT EXISTS "avatarType" TEXT DEFAULT 'emoji';

-- Update existing players with default emoji avatars based on username
-- This ensures existing players have avatars
UPDATE players 
SET avatar = '👤', "avatarType" = 'emoji'
WHERE avatar IS NULL;
