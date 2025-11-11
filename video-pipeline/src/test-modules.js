/**
 * Script to test individual modules
 * Useful for debugging and development
 */

const config = require('../config/config');
const { getConnection } = require('./database/db');
const { translateTranscription } = require('./translation/translator');
const { analyzeText } = require('./analysis/textAnalyzer');
const { generateExercises } = require('./exercises/generator');

// Test menu
const tests = {
  '1': { name: 'Test Google Translate', fn: testGoogleTranslate },
  '2': { name: 'Test Database Connection', fn: testDatabase },
  '3': { name: 'Test Text Analysis (Gemini)', fn: testTextAnalysis },
  '4': { name: 'Test Exercise Generation (Gemini)', fn: testExerciseGeneration },
  '5': { name: 'Run All Tests', fn: runAllTests }
};

// ====================
// Test Functions
// ====================

async function testGoogleTranslate() {
  console.log('\n[Test] Google Translate');
  console.log('-'.repeat(50));

  const sampleTranscription = {
    fullText: 'Hello world from the pipeline.',
    chunks: [
      { text: 'Hello world from the pipeline.', timestamp: [0, 2.5] }
    ]
  };

  try {
    if (!config.google.translateApiKey) {
      console.log('✗ GOOGLE_TRANSLATE_API_KEY is not set');
      return false;
    }

    const translation = await translateTranscription(sampleTranscription);

    console.log('✓ Translation succeeded');
    console.log('  Original:', sampleTranscription.chunks[0].text);
    console.log('  Translated:', translation.chunks[0].text);
    return true;
  } catch (error) {
    console.log('✗ Error:', error.message);
    return false;
  }
}

async function testDatabase() {
  console.log('\n[Test] Database Connection');
  console.log('-'.repeat(50));

  try {
    const conn = await getConnection();
    console.log('✓ Connected to database');

    const [rows] = await conn.query('SELECT 1 as test');
    console.log('✓ Query successful:', rows);

    return true;
  } catch (error) {
    console.log('✗ Error:', error.message);
    return false;
  }
}

async function testTextAnalysis() {
  console.log('\n[Test] Text Analysis (Gemini)');
  console.log('-'.repeat(50));

  const sampleText = `
    Hello everyone! Today I'm going to talk about technology and education.
    The internet has changed the way we learn. Students can now access
    information from anywhere in the world. This is amazing!
  `;

  try {
    const result = await analyzeText(sampleText);

    console.log('✓ Text analysis succeeded');
    console.log('  CEFR Level:', result.cefrLevel);
    console.log('  Topics:', result.topics.join(', '));
    return true;
  } catch (error) {
    console.log('✗ Error:', error.message);
    return false;
  }
}

async function testExerciseGeneration() {
  console.log('\n[Test] Exercise Generation (Gemini)');
  console.log('-'.repeat(50));

  const sampleText = `
    Hello everyone! Today I'm going to talk about technology.
    The internet has changed our lives completely.
  `;

  const sampleAnalysis = {
    cefrLevel: 'B1',
    speechSpeed: 'normal',
    grammarComplexity: 'intermediate',
    vocabularyComplexity: 'intermediate',
    topics: ['Technology']
  };

  try {
    const exercises = await generateExercises(sampleText, sampleAnalysis);

    console.log(`✓ Generated ${exercises.length} exercises`);
    exercises.slice(0, 2).forEach((exercise, index) => {
      console.log(`  #${index + 1} Type: ${exercise.type}`);
      console.log(`    Question: ${exercise.question.slice(0, 60)}...`);
    });

    return true;
  } catch (error) {
    console.log('✗ Error:', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('Running All Tests');
  console.log('='.repeat(60));

  const results = {
    googleTranslate: await testGoogleTranslate(),
    database: await testDatabase(),
    textAnalysis: await testTextAnalysis(),
    exercises: await testExerciseGeneration()
  };

  console.log('\n' + '='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));

  Object.entries(results).forEach(([name, passed]) => {
    const icon = passed ? '✓' : '✗';
    console.log(`${icon} ${name}`);
  });

  const allPassed = Object.values(results).every((r) => r === true);
  console.log('\n' + (allPassed ? '✓ All tests passed!' : '✗ Some tests failed'));

  return allPassed;
}

// ====================
// Main Menu
// ====================

async function showMenu() {
  console.log('\n' + '='.repeat(60));
  console.log('Module Testing Menu');
  console.log('='.repeat(60));

  Object.entries(tests).forEach(([key, test]) => {
    console.log(`${key}. ${test.name}`);
  });

  console.log('0. Exit');
  console.log('='.repeat(60));
}

async function main() {
  const testNum = process.argv[2];

  if (testNum && tests[testNum]) {
    await tests[testNum].fn();
    process.exit(0);
  }

  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const askQuestion = (query) => {
    return new Promise((resolve) => readline.question(query, resolve));
  };

  while (true) {
    await showMenu();
    const choice = await askQuestion('\nSelect test: ');

    if (choice === '0') {
      console.log('Goodbye!');
      readline.close();
      break;
    }

    if (tests[choice]) {
      await tests[choice].fn();
      await askQuestion('\nPress Enter to continue...');
    } else {
      console.log('Invalid choice');
    }
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  testGoogleTranslate,
  testDatabase,
  testTextAnalysis,
  testExerciseGeneration,
  runAllTests
};
