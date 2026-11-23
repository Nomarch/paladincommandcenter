CREATE TABLE characters (owner TEXT PRIMARY KEY NOT NULL,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,last_write TEXT NOT NULL,updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE objectives (owner TEXT NOT NULL,key TEXT NOT NULL,title TEXT NOT NULL,category TEXT NOT NULL,custom INTEGER NOT NULL DEFAULT 0,done INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,completed_at TEXT,PRIMARY KEY(owner,key));
--> statement-breakpoint
CREATE TABLE events (id TEXT PRIMARY KEY NOT NULL,owner TEXT NOT NULL,kind TEXT NOT NULL,summary TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX events_owner_time ON events(owner,created_at);
--> statement-breakpoint
CREATE TABLE screenshots (id TEXT PRIMARY KEY NOT NULL,owner TEXT NOT NULL,object_key TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX screenshots_owner ON screenshots(owner);
