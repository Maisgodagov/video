const fs = require('fs');
const path = require('path');
const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const mime = require('mime-types');
const config = require('../../config/config');
const fsPromises = fs.promises;

const {
  endpoint,
  region,
  bucket,
  accessKeyId,
  secretAccessKey,
  cdnDomain
} = config.storage;

const s3Client = new S3Client({
  region,
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId,
    secretAccessKey
  }
});

/**
 * Upload a video file to S3-compatible storage and return CDN URL
 * @param {string} localPath - Path to local video file
 * @param {string} keyPrefix - Key prefix inside bucket
 * @returns {Promise<string>} - CDN URL of uploaded file
 */
async function uploadVideo(localPath, keyPrefix = 'videos', targetFileName) {
  const baseName = targetFileName || path.basename(localPath);
  const objectKey = `${keyPrefix}/${baseName}`.replace(/\\/g, '/');

  const fileStream = fs.createReadStream(localPath);
  const contentType = mime.lookup(baseName) || 'application/octet-stream';

  const uploader = new Upload({
    client: s3Client,
    params: {
      Bucket: bucket,
      Key: objectKey,
      Body: fileStream,
      ContentType: contentType,
      ACL: 'public-read'
    }
  });

  await uploader.done();

  const cdnUrl = `https://${cdnDomain}/${objectKey}`;
  console.log(`Uploaded video to S3: ${cdnUrl}`);

  return cdnUrl;
}

async function listFilesRecursive(dir, baseDir = dir) {
  const entries = await fsPromises.readdir(dir, { withFileTypes: true });
  const files = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      const nested = await listFilesRecursive(fullPath, baseDir);
      files.push(...nested);
    } else if (entry.isFile()) {
      const relative = path.relative(baseDir, fullPath);
      files.push({
        fullPath,
        relativePath: relative
      });
    }
  }
  return files;
}

function detectContentType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.m3u8') {
    return 'application/vnd.apple.mpegurl';
  }
  if (ext === '.ts') {
    return 'video/mp2t';
  }
  if (ext === '.m4s') {
    return 'video/iso.segment';
  }
  return mime.lookup(fileName) || 'application/octet-stream';
}

async function uploadHlsDirectory(localDir, keyPrefix, baseName, masterPlaylistName = 'master.m3u8') {
  const files = await listFilesRecursive(localDir);
  if (!files.length) {
    throw new Error(`HLS directory is empty: ${localDir}`);
  }

  const uploads = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const file of files) {
    const targetKey = `${keyPrefix}/${baseName}/${file.relativePath}`.replace(/\\/g, '/');
    const fileStream = fs.createReadStream(file.fullPath);
    const contentType = detectContentType(file.relativePath);

    const uploader = new Upload({
      client: s3Client,
      params: {
        Bucket: bucket,
        Key: targetKey,
        Body: fileStream,
        ContentType: contentType,
        ACL: 'public-read'
      }
    });

    uploads.push(uploader.done());
  }

  await Promise.all(uploads);

  const masterKey = `${keyPrefix}/${baseName}/${masterPlaylistName}`.replace(/\\/g, '/');
  const masterUrl = `https://${cdnDomain}/${masterKey}`;
  console.log(`Uploaded HLS package to S3 (master playlist): ${masterUrl}`);
  return masterUrl;
}

module.exports = { uploadVideo, uploadHlsDirectory };
