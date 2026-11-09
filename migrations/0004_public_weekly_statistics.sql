-- Identifier-free, independently versioned weekly public statistics.
CREATE TABLE public_weekly_statistics (
 week_start TEXT PRIMARY KEY NOT NULL,
 generated_at TEXT NOT NULL,
 statistics_json TEXT NOT NULL CHECK(json_valid(statistics_json))
);
