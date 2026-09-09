-- Add notes column to user_profiles_v2 for storing annotation data
ALTER TABLE user_profiles_v2 ADD COLUMN notes TEXT DEFAULT '{}';
