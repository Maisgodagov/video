const { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs').promises;
const path = require('path');
const { pipeline } = require('stream/promises');
const config = require('../../config/config');

/**
 * S3 Input Manager - handles downloading videos from S3 bucket
 */
class S3InputManager {
  constructor() {
    const s3Config = {
      region: config.s3Input.region,
      credentials: {
        accessKeyId: config.s3Input.accessKeyId,
        secretAccessKey: config.s3Input.secretAccessKey
      }
    };

    // Add custom endpoint if provided (for non-AWS S3-compatible services)
    if (config.s3Input.endpoint) {
      s3Config.endpoint = config.s3Input.endpoint;
      s3Config.forcePathStyle = true; // Required for some S3-compatible services
    }

    this.s3Client = new S3Client(s3Config);
    this.bucket = config.s3Input.bucket;
    this.pendingPrefix = config.s3Input.pendingPrefix || 'pending/';
    this.processingPrefix = config.s3Input.processingPrefix || 'processing/';
    this.completedPrefix = config.s3Input.completedPrefix || 'completed/';
    this.failedPrefix = config.s3Input.failedPrefix || 'failed/';
  }

  /**
   * List all video files in the pending folder
   */
  async listPendingVideos() {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: this.pendingPrefix
      });

      const response = await this.s3Client.send(command);

      if (!response.Contents || response.Contents.length === 0) {
        return [];
      }

      // Filter only video files
      const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
      const videos = response.Contents
        .filter(item => {
          const ext = path.extname(item.Key).toLowerCase();
          return videoExtensions.includes(ext) && item.Size > 0;
        })
        .map(item => ({
          key: item.Key,
          size: item.Size,
          lastModified: item.LastModified,
          name: path.basename(item.Key)
        }));

      return videos;
    } catch (error) {
      console.error('Error listing pending videos from S3:', error);
      throw new Error(`Failed to list videos from S3: ${error.message}`);
    }
  }

  /**
   * Download a video from S3 to local temp directory
   */
  async downloadVideo(s3Key, localDir) {
    try {
      const fileName = path.basename(s3Key);
      const localPath = path.join(localDir, fileName);

      console.log(`  -> Downloading ${fileName} from S3...`);

      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: s3Key
      });

      const response = await this.s3Client.send(command);

      // Stream the file to disk
      await pipeline(
        response.Body,
        require('fs').createWriteStream(localPath)
      );

      const stats = await fs.stat(localPath);
      console.log(`  -> Downloaded ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

      return localPath;
    } catch (error) {
      console.error(`Error downloading video ${s3Key}:`, error);
      throw new Error(`Failed to download video from S3: ${error.message}`);
    }
  }

  /**
   * Move video to processing folder (indicates it's being processed)
   */
  async moveToProcessing(s3Key) {
    try {
      const fileName = path.basename(s3Key);
      const newKey = path.join(this.processingPrefix, fileName).replace(/\\/g, '/');

      // Copy to processing folder
      const copyCommand = new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${s3Key}`,
        Key: newKey
      });
      await this.s3Client.send(copyCommand);

      // Delete from pending folder
      const deleteCommand = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: s3Key
      });
      await this.s3Client.send(deleteCommand);

      console.log(`  -> Moved ${fileName} to processing folder`);
      return newKey;
    } catch (error) {
      console.error(`Error moving video to processing:`, error);
      // Non-critical error, continue processing
      return s3Key;
    }
  }

  /**
   * Move video to completed folder (successful processing)
   */
  async moveToCompleted(s3Key) {
    try {
      const fileName = path.basename(s3Key);
      const newKey = path.join(this.completedPrefix, fileName).replace(/\\/g, '/');

      // Copy to completed folder
      const copyCommand = new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${s3Key}`,
        Key: newKey
      });
      await this.s3Client.send(copyCommand);

      // Delete from processing folder
      const deleteCommand = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: s3Key
      });
      await this.s3Client.send(deleteCommand);

      console.log(`  -> Moved ${fileName} to completed folder`);
    } catch (error) {
      console.error(`Error moving video to completed:`, error);
      // Non-critical error, log and continue
    }
  }

  /**
   * Move video to failed folder (processing error)
   */
  async moveToFailed(s3Key) {
    try {
      const fileName = path.basename(s3Key);
      const newKey = path.join(this.failedPrefix, fileName).replace(/\\/g, '/');

      // Copy to failed folder
      const copyCommand = new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${s3Key}`,
        Key: newKey
      });
      await this.s3Client.send(copyCommand);

      // Delete from processing folder
      const deleteCommand = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: s3Key
      });
      await this.s3Client.send(deleteCommand);

      console.log(`  -> Moved ${fileName} to failed folder`);
    } catch (error) {
      console.error(`Error moving video to failed:`, error);
      // Non-critical error, log and continue
    }
  }

  /**
   * Delete video from processing folder (after successful completion)
   */
  async deleteFromProcessing(s3Key) {
    try {
      const deleteCommand = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: s3Key
      });
      await this.s3Client.send(deleteCommand);
      console.log(`  -> Deleted ${path.basename(s3Key)} from processing folder`);
    } catch (error) {
      console.error(`Error deleting video from processing:`, error);
      // Non-critical error, log and continue
    }
  }

  /**
   * Clean up: delete video from both processing and pending folders
   */
  async cleanupVideo(s3Key) {
    try {
      // Try to delete from both locations (in case move failed)
      const possibleKeys = [
        s3Key,
        path.join(this.processingPrefix, path.basename(s3Key)).replace(/\\/g, '/')
      ];

      for (const key of possibleKeys) {
        try {
          const deleteCommand = new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key
          });
          await this.s3Client.send(deleteCommand);
        } catch (err) {
          // Ignore errors (file might not exist)
        }
      }
    } catch (error) {
      console.error(`Error cleaning up video:`, error);
    }
  }
}

module.exports = { S3InputManager };
