SELECT week_start, statistics_json
FROM public_weekly_statistics
ORDER BY week_start DESC
LIMIT 12;
