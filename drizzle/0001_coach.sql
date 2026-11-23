CREATE TABLE coach_messages (id TEXT PRIMARY KEY NOT NULL,owner TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,model TEXT,input_tokens INTEGER,output_tokens INTEGER,created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX coach_messages_owner_time ON coach_messages(owner,created_at);
