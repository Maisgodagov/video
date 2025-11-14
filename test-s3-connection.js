#!/usr/bin/env node

/**
 * Test S3 Connection Script
 *
 * This script tests the connection to your S3 input bucket
 * and displays available videos in the pending folder.
 */

require('dotenv').config();
const { S3InputManager } = require('./video-pipeline/src/storage/s3Input');
const config = require('./video-pipeline/config/config');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testS3Connection() {
  log('cyan', '\n════════════════════════════════════════════════');
  log('cyan', '  S3 Input Bucket Connection Test');
  log('cyan', '════════════════════════════════════════════════\n');

  // Display configuration
  log('blue', '📋 Configuration:');
  console.log(`   Bucket: ${config.s3Input.bucket}`);
  console.log(`   Endpoint: ${config.s3Input.endpoint}`);
  console.log(`   Region: ${config.s3Input.region}`);
  console.log(`   Pending prefix: ${config.s3Input.pendingPrefix}`);
  console.log(`   S3 Input enabled: ${config.s3Input.enabled ? 'Yes' : 'No'}\n`);

  if (!config.s3Input.enabled) {
    log('yellow', '⚠️  S3 Input is disabled in configuration');
    log('yellow', '   Set USE_S3_INPUT=true in your .env file to enable it\n');
    return;
  }

  try {
    log('blue', '🔄 Testing connection...\n');

    const s3Manager = new S3InputManager();
    const videos = await s3Manager.listPendingVideos();

    log('green', '✅ Connection successful!\n');

    if (videos.length === 0) {
      log('yellow', '📂 No videos found in pending folder');
      log('yellow', `   Upload videos to: s3://${config.s3Input.bucket}/${config.s3Input.pendingPrefix}\n`);
    } else {
      log('green', `📹 Found ${videos.length} video(s) in pending folder:\n`);

      videos.forEach((video, index) => {
        const sizeMB = (video.size / 1024 / 1024).toFixed(2);
        const date = video.lastModified ? new Date(video.lastModified).toLocaleString() : 'Unknown';
        console.log(`   ${index + 1}. ${video.name}`);
        console.log(`      Size: ${sizeMB} MB`);
        console.log(`      Last modified: ${date}`);
        console.log();
      });
    }

    // Test other folders
    log('blue', '📁 Checking other folders...\n');

    try {
      const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
      const s3Client = new S3Client({
        region: config.s3Input.region,
        endpoint: config.s3Input.endpoint,
        credentials: {
          accessKeyId: config.s3Input.accessKeyId,
          secretAccessKey: config.s3Input.secretAccessKey
        },
        forcePathStyle: true
      });

      const folders = [
        { name: 'Processing', prefix: config.s3Input.processingPrefix },
        { name: 'Completed', prefix: config.s3Input.completedPrefix },
        { name: 'Failed', prefix: config.s3Input.failedPrefix }
      ];

      for (const folder of folders) {
        const command = new ListObjectsV2Command({
          Bucket: config.s3Input.bucket,
          Prefix: folder.prefix
        });
        const response = await s3Client.send(command);
        const count = response.Contents ? response.Contents.filter(item => item.Size > 0).length : 0;
        console.log(`   ${folder.name}: ${count} file(s)`);
      }
      console.log();

    } catch (error) {
      log('yellow', `   ⚠️  Could not check other folders: ${error.message}\n`);
    }

    // Success summary
    log('green', '═══════════════════════════════════════════════');
    log('green', '✅ All tests passed!');
    log('green', '═══════════════════════════════════════════════\n');

    log('cyan', '💡 Next steps:');
    console.log('   1. Upload a video to the pending folder');
    console.log('   2. Run: npm run s3');
    console.log('   3. Or run in watch mode: npm run s3:watch\n');

  } catch (error) {
    log('red', '\n❌ Connection failed!\n');
    log('red', `Error: ${error.message}\n`);

    log('yellow', '🔍 Troubleshooting:');
    console.log('   1. Check your S3 credentials in .env');
    console.log('   2. Verify the bucket exists');
    console.log('   3. Ensure the endpoint URL is correct');
    console.log('   4. Check your internet connection\n');

    log('yellow', '📚 Documentation:');
    console.log('   - See S3_SETUP.md for setup instructions');
    console.log('   - See DEPLOYMENT_GUIDE.md for full guide\n');

    process.exit(1);
  }
}

// Run the test
testS3Connection()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
