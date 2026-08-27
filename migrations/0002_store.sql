-- Education prices are a second price for the same configuration in the same
-- market, so `store` belongs in a price point's identity. Adding a column is
-- not enough: the primary key would still collide, and INSERT OR REPLACE would
-- have retail and education overwriting each other. SQLite cannot alter a
-- primary key, so the table is rebuilt.
CREATE TABLE price_point_new (
  market_id   TEXT    NOT NULL,
  family_id   TEXT    NOT NULL,
  store       TEXT    NOT NULL DEFAULT 'retail',
  config_key  TEXT    NOT NULL,
  currency    TEXT    NOT NULL,
  amount      REAL    NOT NULL,
  observed_on TEXT    NOT NULL,
  PRIMARY KEY (market_id, family_id, store, config_key, observed_on)
);

INSERT INTO price_point_new (market_id, family_id, store, config_key, currency, amount, observed_on)
  SELECT market_id, family_id, 'retail', config_key, currency, amount, observed_on FROM price_point;

DROP TABLE price_point;
ALTER TABLE price_point_new RENAME TO price_point;

CREATE INDEX price_point_series
  ON price_point (family_id, config_key, market_id, store, observed_on);
