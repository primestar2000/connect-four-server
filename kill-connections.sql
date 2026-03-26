-- Kill all connections to the database (run this in Supabase SQL Editor)
-- This will forcefully terminate all active connections

SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'postgres'
  AND pid <> pg_backend_pid()
  AND usename = 'postgres';

-- Check remaining connections
SELECT count(*) as active_connections
FROM pg_stat_activity
WHERE datname = 'postgres';
