-- Migration for video learning content table
-- This table stores processed videos with transcripts and exercises

CREATE TABLE IF NOT EXISTS video_learning_content (
    id INT AUTO_INCREMENT PRIMARY KEY,
    video_name VARCHAR(255) NOT NULL,
    video_url VARCHAR(500) NULL COMMENT 'S3 CDN URL - to be added later',

    -- Content analysis
    cefr_level ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2') NOT NULL,
    speech_speed ENUM('slow', 'normal', 'fast') DEFAULT 'normal',
    grammar_complexity ENUM('simple', 'intermediate', 'complex') DEFAULT 'intermediate',
    vocabulary_complexity ENUM('basic', 'intermediate', 'advanced') DEFAULT 'intermediate',

    -- Topics (stored as JSON array)
    topics JSON NOT NULL COMMENT 'Array of topic tags',

    -- Transcription with timestamps
    transcript_full TEXT NOT NULL COMMENT 'Full transcript text',
    transcript_chunks JSON NOT NULL COMMENT 'Phrase-level timestamps for subtitles',
    transcript_word_chunks JSON NULL COMMENT 'Word-level timestamps for subtitles',
    transcript_translation_full TEXT NULL COMMENT 'Full transcript translated to Russian',
    transcript_translation_chunks JSON NULL COMMENT 'Russian translation with word-level timestamps',

    -- Exercises
    exercises JSON NOT NULL COMMENT 'Array of exercise objects',

    -- Metadata
    duration_seconds INT NULL COMMENT 'Video duration in seconds',
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'completed',

    INDEX idx_cefr_level (cefr_level),
    INDEX idx_status (status),
    INDEX idx_processed_at (processed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table to store topic tags for better querying (optional, for optimization)
CREATE TABLE IF NOT EXISTS video_topics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    video_id INT NOT NULL,
    topic VARCHAR(100) NOT NULL,
    FOREIGN KEY (video_id) REFERENCES video_learning_content(id) ON DELETE CASCADE,
    INDEX idx_topic (topic),
    INDEX idx_video_id (video_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE video_learning_content
  ADD COLUMN transcript_word_chunks JSON NULL COMMENT 'Word-level timestamps for subtitles' AFTER transcript_chunks;

ALTER TABLE video_learning_content
  ADD COLUMN transcript_translation_full TEXT NULL COMMENT 'Full transcript translated to Russian' AFTER transcript_word_chunks;

ALTER TABLE video_learning_content
  ADD COLUMN transcript_translation_chunks JSON NULL COMMENT 'Russian translation with word-level timestamps' AFTER transcript_translation_full;

ALTER TABLE video_learning_content
  ADD COLUMN duration_seconds INT NULL COMMENT 'Video duration in seconds' AFTER exercises;
