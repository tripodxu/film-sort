-- Add parent_id column to plaza_comments for nested replies
ALTER TABLE plaza_comments ADD COLUMN parent_id INTEGER REFERENCES plaza_comments(id);
CREATE INDEX idx_plaza_comments_parent ON plaza_comments(parent_id);
