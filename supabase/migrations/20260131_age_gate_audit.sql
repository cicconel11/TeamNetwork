-- Compliance audit log for age gate events (COPPA compliance)
-- This table stores anonymized audit records without DOB values

CREATE TABLE IF NOT EXISTS compliance_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  age_bracket TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash TEXT,

  CONSTRAINT valid_event_type CHECK (
    event_type IN ('age_gate_passed', 'age_gate_redirected')
  ),
  CONSTRAINT valid_age_bracket CHECK (
    age_bracket IS NULL OR age_bracket IN ('under_13', '13_17', '18_plus')
  )
);

-- Index for querying by IP and time (rate limiting, abuse detection)
CREATE INDEX idx_compliance_audit_ip_time
  ON compliance_audit_log (ip_hash, created_at);

-- Index for analytics queries by event type
CREATE INDEX idx_compliance_audit_event_type
  ON compliance_audit_log (event_type, created_at);

-- Enable RLS - only service role can access this table
ALTER TABLE compliance_audit_log ENABLE ROW LEVEL SECURITY;

-- No access for regular users - service role only
CREATE POLICY "Service role only" ON compliance_audit_log
  FOR ALL USING (false);

COMMENT ON TABLE compliance_audit_log IS 'Audit log for COPPA compliance age gate events. Contains no DOB or PII.';
COMMENT ON COLUMN compliance_audit_log.event_type IS 'Type of age gate event: age_gate_passed or age_gate_redirected';
COMMENT ON COLUMN compliance_audit_log.age_bracket IS 'Age bracket derived from DOB: under_13, 13_17, or 18_plus';
COMMENT ON COLUMN compliance_audit_log.ip_hash IS 'SHA-256 hash of IP address for rate limiting without storing raw IP';
