-- Forward-looking PostgreSQL schema, NOT used by the zero-dependency local runtime.
-- Migration planning based on the user's handbook; deploy only after adding per-user auth/RLS.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text UNIQUE NOT NULL,name text,locale text DEFAULT 'en',plan text DEFAULT 'free',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS channels(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),yt_channel_id text UNIQUE NOT NULL,title text,subs bigint,last_synced_at timestamptz,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS user_channels(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),channel_id uuid NOT NULL REFERENCES channels(id),oauth_connected boolean NOT NULL DEFAULT false,refresh_token_enc bytea,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS videos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),yt_video_id text UNIQUE NOT NULL,channel_id uuid REFERENCES channels(id),title text,published_at timestamptz,tags jsonb DEFAULT '[]',duration_seconds integer,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS video_snapshots(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),video_id uuid NOT NULL REFERENCES videos(id),taken_at timestamptz DEFAULT now(),views bigint,likes bigint,comments bigint);
CREATE TABLE IF NOT EXISTS keywords(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),term text NOT NULL,locale text NOT NULL DEFAULT 'en',score numeric(5,2),est_volume_proxy numeric(5,2),updated_at timestamptz DEFAULT now(),UNIQUE(term,locale));
CREATE TABLE IF NOT EXISTS tracked_keywords(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),video_id uuid NOT NULL REFERENCES videos(id),keyword_id uuid NOT NULL REFERENCES keywords(id),active boolean DEFAULT true,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS rank_checks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tracked_keyword_id uuid NOT NULL REFERENCES tracked_keywords(id) ON DELETE CASCADE,checked_at timestamptz DEFAULT now(),position integer,found boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS competitors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),channel_id uuid NOT NULL REFERENCES channels(id),created_at timestamptz DEFAULT now(),UNIQUE(user_id,channel_id));
CREATE TABLE IF NOT EXISTS alerts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),type text NOT NULL,payload jsonb NOT NULL,read_at timestamptz,sent_at timestamptz,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS retention_points(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),video_id uuid NOT NULL REFERENCES videos(id),elapsed_ratio numeric(6,5),audience_watch_ratio numeric(8,5),created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS usage_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES users(id),feature text NOT NULL,units integer NOT NULL DEFAULT 1,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),provider text,provider_sub_id text,plan text NOT NULL DEFAULT 'free',status text,current_period_end timestamptz,created_at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_rank_checks_keyword_time ON rank_checks(tracked_keyword_id,checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_snapshots_time ON video_snapshots(video_id,taken_at DESC);
-- RLS policies must be defined AFTER integrating Supabase auth and mapped auth.uid().
