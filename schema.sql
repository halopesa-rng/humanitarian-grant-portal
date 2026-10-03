CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  reference VARCHAR(32) UNIQUE NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  age INTEGER NOT NULL CHECK (age >= 18 AND age <= 120),
  phone VARCHAR(40) NOT NULL,
  country VARCHAR(100) NOT NULL,
  location VARCHAR(160) NOT NULL,
  occupation VARCHAR(120) NOT NULL,
  zone VARCHAR(120),
  purpose VARCHAR(80) NOT NULL,
  participated_before BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  admin_contact_number VARCHAR(40),
  admin_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
  method VARCHAR(20) NOT NULL,
  transaction_reference VARCHAR(120),
  payment_statement TEXT,
  amount NUMERIC(12,2),
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_applications_reference ON applications(reference);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_payments_application ON payments(application_id);
