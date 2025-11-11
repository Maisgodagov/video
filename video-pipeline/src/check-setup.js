/**
 * Script to check if all prerequisites are set up correctly
 */

const config = require('../config/config');
const { getConnection } = require('./database/db');

async function checkGoogleApis() {
  console.log('\n[1/3] Checking Google API configuration...');
  const translateKey = config.google.translateApiKey;
  const geminiKey = config.google.geminiApiKey;

  if (!translateKey) {
    console.log('✗ GOOGLE_TRANSLATE_API_KEY is missing (or empty)');
  } else {
    console.log('✓ Google Translate API key is set');
  }

  if (!geminiKey) {
    console.log('✗ GOOGLE_GEMINI_API_KEY is missing (or empty)');
  } else {
    console.log('✓ Google Gemini API key is set');
  }

  return Boolean(translateKey && geminiKey);
}

async function checkDatabase() {
  console.log('\n[2/3] Checking database connection...');
  try {
    const conn = await getConnection();
    console.log('✓ Database connected successfully');

    await conn.query('SELECT 1');
    console.log('✓ Database is responsive');
    return true;
  } catch (error) {
    console.log('✗ Database connection failed');
    console.log(`Error: ${error.message}`);
    console.log('\nPlease check database credentials in config.js');
    return false;
  }
}

async function checkFFmpeg() {
  console.log('\n[3/3] Checking FFmpeg...');
  try {
    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    console.log('✓ FFmpeg is available');
    console.log(`  Path: ${ffmpegPath}`);
    return true;
  } catch (error) {
    console.log('✗ FFmpeg not found');
    return false;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('VIDEO PIPELINE SETUP CHECK');
  console.log('='.repeat(60));

  const results = {
    googleApis: await checkGoogleApis(),
    database: await checkDatabase(),
    ffmpeg: await checkFFmpeg()
  };

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const allGood = Object.values(results).every((r) => r === true);

  if (allGood) {
    console.log('\n✓ All systems ready!');
    console.log('\nYou can now run the pipeline:');
    console.log('  npm start');
  } else {
    console.log('\n✗ Some issues need to be fixed:');
    if (!results.googleApis) console.log('  - Google API keys');
    if (!results.database) console.log('  - Database connection');
    if (!results.ffmpeg) console.log('  - FFmpeg');
  }

  console.log();
  process.exit(allGood ? 0 : 1);
}

main();
