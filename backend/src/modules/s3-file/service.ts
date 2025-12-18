import { AbstractFileProviderService, MedusaError } from '@medusajs/framework/utils';
import { Logger } from '@medusajs/framework/types';
import { 
  ProviderUploadFileDTO,
  ProviderDeleteFileDTO,
  ProviderFileResultDTO,
  ProviderGetFileDTO
} from '@medusajs/framework/types';
import { Readable } from 'stream';
import { Client } from 'minio';
import path from 'path';
import { ulid } from 'ulid';

type InjectedDependencies = {
  logger: Logger
}

interface S3ServiceConfig {
  endPoint: string
  accessKey: string
  secretKey: string
  bucket?: string
  region?: string
}

export interface S3FileProviderOptions {
  endPoint: string
  accessKey: string
  secretKey: string
  bucket?: string
  region?: string
}

const DEFAULT_BUCKET = 'medusa-media'

/**
 * Service to handle file storage using AWS S3.
 */
class S3FileProviderService extends AbstractFileProviderService {
  static identifier = 's3-file'
  protected readonly config_: S3ServiceConfig
  protected readonly logger_: Logger
  protected client: Client
  protected readonly bucket: string

  constructor({ logger }: InjectedDependencies, options: S3FileProviderOptions) {
    super()
    this.logger_ = logger
    this.config_ = {
      endPoint: options.endPoint,
      accessKey: options.accessKey,
      secretKey: options.secretKey,
      bucket: options.bucket,
      region: options.region
    }

    // Use provided bucket or default
    this.bucket = this.config_.bucket || DEFAULT_BUCKET
    this.logger_.info(`S3 service initialized with bucket: ${this.bucket}`)

    // Initialize S3 client using MinIO client library (compatible with S3)
    this.client = new Client({
      endPoint: this.config_.endPoint,
      port: 443,
      useSSL: true,
      accessKey: this.config_.accessKey,
      secretKey: this.config_.secretKey,
      region: this.config_.region || 'us-east-2' // Use configured region or default
    })

    // Initialize bucket and policy
    this.initializeBucket().catch(error => {
      this.logger_.error(`Failed to initialize S3 bucket: ${error.message}`)
    })

    // Add method interceptor for debugging
    this.interceptMethods()
  }

  private interceptMethods() {
    const originalMethods = ['upload', 'delete', 'getPresignedUploadUrl', 'getPresignedDownloadUrl', 'getDownloadStream', 'getFileInfo', 'exists', 'getAsBuffer']
    
    originalMethods.forEach(methodName => {
      const originalMethod = this[methodName]
      if (typeof originalMethod === 'function') {
        this[methodName] = (...args: any[]) => {
          this.logger_.info(`🔍 METHOD CALLED: ${methodName} with args: ${JSON.stringify(args, null, 2)}`)
          try {
            const result = originalMethod.apply(this, args)
            if (result && typeof result.then === 'function') {
              return result.catch(async (error: any) => {
                this.logger_.error(`❌ METHOD FAILED: ${methodName} - ${error.message}`)
                
                // Reportar error a Crashlytics
                await reportError(
                  error instanceof Error ? error : new Error(String(error)),
                  ErrorCategory.S3,
                  {
                    method: methodName,
                    args: JSON.stringify(args).substring(0, 500),
                  }
                ).catch(() => {
                  // Ignorar errores de reporte
                });
                
                throw error
              })
            }
            return result
          } catch (error: any) {
            this.logger_.error(`❌ METHOD FAILED: ${methodName} - ${error.message}`)
            
            // Reportar error a Crashlytics
            reportError(
              error instanceof Error ? error : new Error(String(error)),
              ErrorCategory.S3,
              {
                method: methodName,
                args: JSON.stringify(args).substring(0, 500),
              }
            ).catch(() => {
              // Ignorar errores de reporte
            });
            
            throw error
          }
        }
      }
    })
  }

  static validateOptions(options: Record<string, any>) {
    const requiredFields = [
      'endPoint',
      'accessKey',
      'secretKey'
    ]

    requiredFields.forEach((field) => {
      if (!options[field]) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `${field} is required in the provider's options`
        )
      }
    })
  }

  private async initializeBucket(): Promise<void> {
    try {
      // Check if bucket exists
      const bucketExists = await this.client.bucketExists(this.bucket)
      
      if (!bucketExists) {
        // Create the bucket
        await this.client.makeBucket(this.bucket)
        this.logger_.info(`Created bucket: ${this.bucket}`)

        // Set bucket policy to allow public read access
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'PublicRead',
              Effect: 'Allow',
              Principal: '*',
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.bucket}/*`]
            }
          ]
        }

        await this.client.setBucketPolicy(this.bucket, JSON.stringify(policy))
        this.logger_.info(`Set public read policy for bucket: ${this.bucket}`)
      } else {
        this.logger_.info(`Using existing bucket: ${this.bucket}`)
        
        // Verify/update policy on existing bucket
        try {
          const policy = {
            Version: '2012-10-17',
            Statement: [
              {
                Sid: 'PublicRead',
                Effect: 'Allow',
                Principal: '*',
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${this.bucket}/*`]
              }
            ]
          }
          await this.client.setBucketPolicy(this.bucket, JSON.stringify(policy))
          this.logger_.info(`Updated public read policy for existing bucket: ${this.bucket}`)
        } catch (policyError) {
          this.logger_.warn(`Failed to update policy for existing bucket: ${policyError.message}`)
        }
      }
    } catch (error) {
      this.logger_.error(`Error initializing bucket: ${error.message}`)
      throw error
    }
  }

  async upload(
    file: ProviderUploadFileDTO
  ): Promise<ProviderFileResultDTO> {
    if (!file) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No file provided'
      )
    }

    if (!file.filename) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No filename provided'
      )
    }

    try {
      const parsedFilename = path.parse(file.filename)
      const fileKey = `${parsedFilename.name}-${ulid()}${parsedFilename.ext}`
      const content = Buffer.from(file.content, 'binary')

      // Upload file sin ACL - usar bucket policy para acceso público
      await this.client.putObject(
        this.bucket,
        fileKey,
        content,
        content.length,
        {
          'Content-Type': file.mimeType,
          'x-amz-meta-original-filename': file.filename,
          // Removido 'x-amz-acl': 'public-read' para evitar error de ACL
        }
      )

      // Generate URL - formato S3 estándar
      const url = `https://${this.bucket}.${this.config_.endPoint}/${fileKey}`

      this.logger_.info(`Successfully uploaded file ${fileKey} to S3 bucket ${this.bucket}`)

      return {
        url,
        key: fileKey
      }
    } catch (error) {
      this.logger_.error(`Failed to upload file: ${error.message}`)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to upload file: ${error.message}`
      )
    }
  }

  async delete(
    fileData: ProviderDeleteFileDTO | ProviderDeleteFileDTO[]
  ): Promise<void> {
    // Handle both single file and array of files
    const filesToDelete = Array.isArray(fileData) ? fileData.flat() : [fileData]
    
    for (const file of filesToDelete) {
      if (!file?.fileKey) {
        this.logger_.warn(`Skipping delete - no file key provided for file: ${JSON.stringify(file)}`)
        continue
      }

      try {
        await this.client.removeObject(this.bucket, file.fileKey)
        this.logger_.info(`Successfully deleted file ${file.fileKey} from S3 bucket ${this.bucket}`)
      } catch (error) {
        // Log error but don't throw if file doesn't exist
        this.logger_.warn(`Failed to delete file ${file.fileKey}: ${error.message}`)
      }
    }
  }

  async getPresignedDownloadUrl(
    fileData: ProviderGetFileDTO
  ): Promise<string> {
    this.logger_.info(`getPresignedDownloadUrl called with: ${JSON.stringify(fileData, null, 2)}`)
    
    // Generate a file key if not provided (though this should rarely happen for downloads)
    let fileKey = fileData?.fileKey
    
    if (!fileKey) {
      this.logger_.error(`getPresignedDownloadUrl: No file key provided in fileData: ${JSON.stringify(fileData)}`)
      this.logger_.error('This might be the source of the "No file key provided" error in import workflow')
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No file key provided for download URL generation'
      )
    }

    try {
      const url = await this.client.presignedGetObject(
        this.bucket,
        fileKey,
        24 * 60 * 60 // URL expires in 24 hours
      )
      this.logger_.info(`Generated presigned download URL for file ${fileKey}`)
      return url
    } catch (error) {
      this.logger_.error(`Failed to generate presigned download URL: ${error.message}`)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to generate presigned download URL: ${error.message}`
      )
    }
  }

  async getPresignedUploadUrl(
    fileData?: ProviderGetFileDTO
  ): Promise<{ url: string; key: string }> {
    // Always generate a unique file key for uploads
    const timestamp = Date.now()
    const fileKey = fileData?.fileKey || `uploads/${timestamp}-${ulid()}.csv`
    
    this.logger_.info(`Generating presigned upload URL for file key: ${fileKey}`)

    try {
      const url = await this.client.presignedPutObject(
        this.bucket,
        fileKey,
        24 * 60 * 60 // URL expires in 24 hours
      )
      this.logger_.info(`Generated presigned upload URL for file ${fileKey}`)
      return { url, key: fileKey }
    } catch (error) {
      this.logger_.error(`Failed to generate presigned upload URL: ${error.message}`)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to generate presigned upload URL: ${error.message}`
      )
    }
  }

  async getDownloadStream(
    fileData: ProviderGetFileDTO
  ): Promise<Readable> {
    this.logger_.info(`getDownloadStream called with: ${JSON.stringify(fileData, null, 2)}`)
    
    if (!fileData?.fileKey) {
      this.logger_.error(`getDownloadStream: No file key provided in fileData: ${JSON.stringify(fileData)}`)
      this.logger_.error('This is the source of "No file key provided" error - getDownloadStream method')
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No file key provided for download stream'
      )
    }

    try {
      this.logger_.info(`Attempting to get object from bucket: ${this.bucket}, key: ${fileData.fileKey}`)
      const stream = await this.client.getObject(this.bucket, fileData.fileKey)
      this.logger_.info(`Successfully generated download stream for file ${fileData.fileKey}`)
      return stream
    } catch (error) {
      this.logger_.error(`Failed to get download stream for ${fileData.fileKey}: ${error.message}`)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to get download stream: ${error.message}`
      )
    }
  }

  async getFileInfo(
    fileData: ProviderGetFileDTO
  ): Promise<{ size: number; lastModified: Date }> {
    this.logger_.info(`getFileInfo called with: ${JSON.stringify(fileData, null, 2)}`)
    
    if (!fileData?.fileKey) {
      this.logger_.error(`getFileInfo: No file key provided in fileData: ${JSON.stringify(fileData)}`)
      this.logger_.error('This is the source of "No file key provided" error - getFileInfo method')
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No file key provided for file info'
      )
    }

    try {
      const stat = await this.client.statObject(this.bucket, fileData.fileKey)
      this.logger_.info(`Retrieved file info for ${fileData.fileKey}: ${stat.size} bytes`)
      return {
        size: stat.size,
        lastModified: stat.lastModified
      }
    } catch (error) {
      this.logger_.error(`Failed to get file info: ${error.message}`)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to get file info: ${error.message}`
      )
    }
  }

  // Additional method that might be called by Medusa workflows
  async exists(fileData: ProviderGetFileDTO): Promise<boolean> {
    this.logger_.info(`exists called with: ${JSON.stringify(fileData, null, 2)}`)
    
    if (!fileData?.fileKey) {
      this.logger_.error(`exists: No file key provided in fileData: ${JSON.stringify(fileData)}`)
      this.logger_.error('This is the source of "No file key provided" error - exists method')
      return false // Return false instead of throwing error
    }

    try {
      await this.client.statObject(this.bucket, fileData.fileKey)
      this.logger_.info(`File exists: ${fileData.fileKey}`)
      return true
    } catch (error) {
      this.logger_.info(`File does not exist: ${fileData.fileKey}`)
      return false
    }
  }

  // Required method for processing imports
  async getAsBuffer(fileData: ProviderGetFileDTO): Promise<Buffer> {
    this.logger_.info(`getAsBuffer called with: ${JSON.stringify(fileData, null, 2)}`)
    
    if (!fileData?.fileKey) {
      this.logger_.error(`getAsBuffer: No file key provided in fileData: ${JSON.stringify(fileData)}`)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No file key provided for buffer generation'
      )
    }

    try {
      const stream = await this.client.getObject(this.bucket, fileData.fileKey)
      const chunks: Buffer[] = []
      
      return new Promise((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        
        stream.on('end', () => {
          const buffer = Buffer.concat(chunks)
          this.logger_.info(`Generated buffer for file ${fileData.fileKey}: ${buffer.length} bytes`)
          resolve(buffer)
        })
        
        stream.on('error', (error) => {
          this.logger_.error(`Failed to generate buffer for ${fileData.fileKey}: ${error.message}`)
          reject(error)
        })
      })
    } catch (error) {
      this.logger_.error(`Failed to get buffer: ${error.message}`)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to get buffer: ${error.message}`
      )
    }
  }

  // Override any method that might be called but not implemented
  async getFile?(fileData: ProviderGetFileDTO): Promise<any> {
    this.logger_.info(`🔍 UNEXPECTED METHOD CALLED: getFile with: ${JSON.stringify(fileData, null, 2)}`)
    if (!fileData?.fileKey) {
      this.logger_.error(`🚨 FOUND IT! getFile called without fileKey - this might be the source!`)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No file key provided'
      )
    }
    return this.getDownloadStream(fileData)
  }

  // Catch-all method interceptor
  [key: string]: any
}

export default S3FileProviderService
