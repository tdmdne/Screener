-- Vektor Terminal — User profile avatar support
-- Apply locally:  npx wrangler d1 migrations apply vektor-auth-db --local
-- Apply remote:   npx wrangler d1 migrations apply vektor-auth-db --remote

ALTER TABLE users ADD COLUMN avatar_url TEXT;
