# AWS S3 File Provider Module

This module provides AWS S3 integration for file storage in Medusa. It implements the file provider interface to handle file uploads, downloads, and deletions using AWS S3 as the storage backend.

## Configuration

The module requires the following environment variables:

```env
S3_ENDPOINT=s3.us-east-2.amazonaws.com  # AWS S3 endpoint
S3_ACCESS_KEY_ID=your-access-key-id
S3_SECRET_ACCESS_KEY=your-secret-access-key
S3_BUCKET=your-bucket-name
S3_REGION=us-east-2  # Your AWS region
```

## Features

- Automatic bucket creation and configuration
- AWS S3 compatible API using MinIO client library
- Unique file naming using ULID
- Proper content type and metadata handling
- Presigned URLs for secure file access
- Support for product imports and file uploads

## Usage

The module is automatically configured in medusa-config.js when the required environment variables are present:

```javascript
{
  resolve: './src/modules/s3-file',
  id: 's3-compatible',
  options: {
    endPoint: S3_ENDPOINT,
    accessKey: S3_ACCESS_KEY_ID,
    secretKey: S3_SECRET_ACCESS_KEY,
    bucket: S3_BUCKET,
    region: S3_REGION
  }
}
```

### Important Note About Configuration Changes

When changing configuration (especially the bucket name):
1. Stop the Medusa server
2. Delete the `.medusa/server` directory to clear cached configuration
3. Restart the server

This is necessary because Medusa caches environment variables in the `.medusa/server` directory.

### Automatic Setup

When the service starts:
1. It checks for the existence of the configured S3 bucket
2. Creates the bucket if it doesn't exist (if permissions allow)
3. Configures or updates the bucket policy for public read access
4. Logs all initialization steps for transparency

This happens only once when the service starts, not on every file operation.

### File Upload

Files are automatically uploaded to S3 when using Medusa's file upload endpoints or services. Each file is stored with:
- A unique name generated using ULID
- The original file extension preserved
- Proper content type set
- Original filename stored in metadata
- Public read access enabled

### File Access

Files can be accessed in two ways:
1. Direct URL: `https://${BUCKET_NAME}.${S3_ENDPOINT}/${fileKey}`
   - Files are publicly accessible due to bucket policy configuration
2. Presigned URL: Generated on demand with 24-hour expiration
   - Useful for temporary access to files

### File Deletion

Files are automatically deleted from S3 when using Medusa's file deletion endpoints or services.

## Implementation Details

- Uses MinIO client library for S3 compatibility
- Port 443 and SSL are used for secure connections
- Files are given unique names using ULID to prevent collisions
- Original filenames are preserved in metadata
- Non-existent file deletions are logged but don't throw errors
- Presigned URLs are valid for 24 hours
- Bucket policy is automatically configured for public read access

## Security Considerations

The module configures the S3 bucket for public read access, which means:
- All uploaded files will be publicly accessible via their URLs
- This is suitable for public assets like product images
- For private files, consider using presigned URLs instead of direct access

## Migration Note

If you're migrating from another storage solution or have an existing bucket:
1. Set the S3_BUCKET environment variable to your existing bucket name
2. Delete the `.medusa/server` directory to clear cached configuration
3. Restart the server
4. The module will use your existing bucket and ensure it has the correct public read policy

## Troubleshooting

1. **Files uploading to wrong bucket**: 
   - Check S3_BUCKET environment variable
   - Ensure bucket exists and you have permissions
   - Restart server after configuration changes

2. **Access denied errors**:
   - Verify S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY
   - Check IAM permissions for the S3 user
   - Ensure bucket policy allows public read access

3. **Import not working**:
   - Check that all required methods are implemented
   - Verify presigned URLs are being generated correctly
   - Monitor logs for detailed error information

## Required Methods

This provider implements all required methods for Medusa file operations:
- `upload()` - Direct file uploads
- `delete()` - File deletion
- `getPresignedUploadUrl()` - Generate upload URLs
- `getPresignedDownloadUrl()` - Generate download URLs
- `getDownloadStream()` - Stream file content
- `getFileInfo()` - Get file metadata