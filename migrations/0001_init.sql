-- Change-only price history.
--
-- A row is written the first time a configuration is seen in a market, and
-- thereafter only when its price actually moves. A full daily dump would be
-- ~90k rows a day to record that nothing happened; this is a few rows.
CREATE TABLE IF NOT EXISTS price_point (
  market_id   TEXT    NOT NULL,
  family_id   TEXT    NOT NULL,
  config_key  TEXT    NOT NULL,
  currency    TEXT    NOT NULL,
  amount      REAL    NOT NULL,
  observed_on TEXT    NOT NULL,
  PRIMARY KEY (market_id, family_id, config_key, observed_on)
);

-- Charting one configuration across markets is the only read pattern.
CREATE INDEX IF NOT EXISTS price_point_series
  ON price_point (family_id, config_key, market_id, observed_on);
