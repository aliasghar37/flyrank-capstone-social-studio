-- Shared helpers. Requires PostgreSQL 13+ (gen_random_uuid is built in).

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Custom SQLSTATEs raised by guard triggers (the API maps them to HTTP codes):
--   SS001 invalid variant transition    SS004 invalid slot transition
--   SS002 variant immutable             SS005 invalid attempt transition
--   SS003 variant not approved          SS006 post immutable
