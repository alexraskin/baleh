-- Characters each user sent per UTC day, capping translation spend (see DAILY_CHARACTER_BUDGET).
create table "dailyUsage" (
  "userId" text not null references "user" ("id") on delete cascade,
  "day" text not null,
  "characters" integer not null default 0,
  primary key ("userId", "day")
) without rowid;
