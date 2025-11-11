const mysql = require('mysql2/promise');
const config = require('../../config/config');

let connection = null;

/**
 * Get database connection
 */
async function getConnection() {
  // Check if connection exists and is alive
  if (connection) {
    try {
      await connection.ping();
      return connection;
    } catch (error) {
      console.log('Connection lost, reconnecting...');
      connection = null;
    }
  }

  // Create new connection
  connection = await mysql.createConnection(config.database);
  console.log('Database connected successfully');
  return connection;
}

/**
 * Run migrations
 */
async function runMigrations() {
  const conn = await getConnection();
  const fs = require('fs').promises;
  const path = require('path');

  const migrationSQL = await fs.readFile(
    path.join(__dirname, 'migrations.sql'),
    'utf-8'
  );

  // Split by semicolon and execute each statement
  const statements = migrationSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const statement of statements) {
    try {
      await conn.query(statement);
    } catch (error) {
      const ignorableCodes = new Set(['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_TABLE_EXISTS_ERROR']);
      if (ignorableCodes.has(error.code)) {
        console.log(`Skipping migration statement due to existing schema element: ${error.code}`);
        continue;
      }
      throw error;
    }
  }

  console.log('Migrations completed successfully');
}

/**
 * Save video data to database
 * @param {Object} videoData - Complete video processing result
 * @returns {Promise<number>} - Inserted video ID
 */
async function saveVideoData(videoData) {
  const conn = await getConnection();

  const [result] = await conn.query(
    `INSERT INTO video_learning_content
    (video_name, video_url, cefr_level, speech_speed, grammar_complexity,
     vocabulary_complexity, topics, transcript_full, transcript_chunks,
     transcript_word_chunks, transcript_translation_full, transcript_translation_chunks,
     exercises, duration_seconds, status, likes_count, is_adult_content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      videoData.videoName,
      videoData.videoUrl,
      videoData.analysis.cefrLevel,
      videoData.analysis.speechSpeed,
      videoData.analysis.grammarComplexity,
      videoData.analysis.vocabularyComplexity,
      JSON.stringify(videoData.analysis.topics),
      videoData.transcription.plain.fullText,
      JSON.stringify(videoData.transcription.phrases.chunks),
      JSON.stringify(videoData.transcription.words.chunks),
      videoData.translation?.fullText || null,
      videoData.translation ? JSON.stringify(videoData.translation.chunks) : null,
      JSON.stringify(videoData.exercises),
      videoData.durationSeconds ?? null,
      'completed',
      0,
      videoData.isAdultContent ? 1 : 0
    ]
  );

  const videoId = result.insertId;

  // Insert topics into video_topics table
  if (videoData.analysis.topics && videoData.analysis.topics.length > 0) {
    for (const topic of videoData.analysis.topics) {
      await conn.query(
        'INSERT INTO video_topics (video_id, topic) VALUES (?, ?)',
        [videoId, topic]
      );
    }
  }

  console.log(`Video data saved to database with ID: ${videoId}`);
  return videoId;
}

/**
 * Close database connection
 */
async function closeConnection() {
  if (connection) {
    await connection.end();
    connection = null;
    console.log('Database connection closed');
  }
}

module.exports = {
  getConnection,
  runMigrations,
  saveVideoData,
  closeConnection
};
