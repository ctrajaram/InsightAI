'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { UploadIcon, Loader2 } from 'lucide-react';

interface FileUploadProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  acceptedFileTypes?: string;
  maxSizeMB?: number;
  onFilesSelected?: (files: File[]) => void;
  isUploading?: boolean;
  uploadProgress?: number;
  className?: string;
}

export const FileUpload = React.forwardRef<HTMLDivElement, FileUploadProps>(
  ({
    icon,
    acceptedFileTypes = "audio/*, video/*",
    maxSizeMB = 100,
    onFilesSelected,
    isUploading = false,
    uploadProgress = 0,
    className,
    ...props
  }, ref) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const [dragActive, setDragActive] = React.useState(false);
    const [fileError, setFileError] = React.useState<string | null>(null);
    
    const handleClick = () => {
      if (inputRef.current) {
        inputRef.current.click();
      }
    };

    const validateFiles = (files: FileList | File[]): File[] => {
      const validFiles: File[] = [];
      setFileError(null);
      
      Array.from(files).forEach(file => {
        // Debug file info
        console.log('Validating file:', {
          name: file.name,
          type: file.type || 'no-type', // Some files might not have type properly set
          extension: file.name.split('.').pop()?.toLowerCase()
        });
        
        // Check file type with improved handling for files without proper MIME types
        const fileExtension = file.name.split('.').pop()?.toLowerCase();
        const isAudio = file.type.startsWith('audio/') || 
          ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(fileExtension || '');
        const isVideo = file.type.startsWith('video/') || 
          ['mp4', 'webm', 'avi', 'mov', 'wmv', 'mkv'].includes(fileExtension || '');
        
        if (acceptedFileTypes.includes('audio/*') && acceptedFileTypes.includes('video/*')) {
          if (!isAudio && !isVideo) {
            setFileError(`File type not accepted. Please upload audio or video files only.`);
            return;
          }
        } else if (acceptedFileTypes.includes('audio/*') && !isAudio) {
          setFileError(`File type not accepted. Please upload audio files only.`);
          return;
        } else if (acceptedFileTypes.includes('video/*') && !isVideo) {
          setFileError(`File type not accepted. Please upload video files only.`);
          return;
        } else if (!file.type.match(acceptedFileTypes.replace(/\*/g, '.*'))) {
          setFileError(`File type not accepted. Please upload ${acceptedFileTypes} files only.`);
          return;
        }
        
        // Check file size
        if (file.size > maxSizeMB * 1024 * 1024) {
          setFileError(`File size too large. Maximum size is ${maxSizeMB}MB.`);
          return;
        }
        
        validFiles.push(file);
      });
      
      return validFiles;
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      e.preventDefault();
      if (e.target.files && e.target.files.length > 0) {
        const validFiles = validateFiles(e.target.files);
        if (validFiles.length > 0 && onFilesSelected) {
          onFilesSelected(validFiles);
        }
      }
    };

    const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'dragenter' || e.type === 'dragover') {
        setDragActive(true);
      } else if (e.type === 'dragleave') {
        setDragActive(false);
      }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const validFiles = validateFiles(e.dataTransfer.files);
        if (validFiles.length > 0 && onFilesSelected) {
          onFilesSelected(validFiles);
        }
      }
    };

    return (
      <div ref={ref} className={cn('w-full', className)}>
        <div
          className={cn(
            'relative flex flex-col items-center justify-center w-full h-64 p-6 border-2 border-dashed rounded-lg transition-colors',
            dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
            isUploading ? 'bg-muted/50 pointer-events-none' : 'hover:bg-muted/50 cursor-pointer'
          )}
          onClick={handleClick}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={acceptedFileTypes}
            onChange={handleChange}
            multiple={false}
            disabled={isUploading}
            {...props}
          />
          
          {isUploading ? (
            <div className="flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">
                {uploadProgress > 0 ? `Uploading... ${uploadProgress.toFixed(0)}%` : 'Processing...'}
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center justify-center gap-3">
                {icon || <UploadIcon className="w-10 h-10 text-muted-foreground" />}
                <div className="flex flex-col items-center text-center gap-1">
                  <p className="text-sm font-medium">
                    <span className="font-semibold text-primary">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {acceptedFileTypes.includes('audio/*') && acceptedFileTypes.includes('video/*') 
                      ? 'Audio or Video files' 
                      : acceptedFileTypes.includes('audio/*') 
                        ? 'Audio files' 
                        : acceptedFileTypes.includes('video/*') 
                          ? 'Video files' 
                          : acceptedFileTypes}
                    {' '}(up to {maxSizeMB}MB)
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={handleClick}
              >
                Select File
              </Button>
            </>
          )}
        </div>
        
        {fileError && (
          <p className="mt-2 text-sm text-red-500">{fileError}</p>
        )}
      </div>
    );
  }
);

FileUpload.displayName = 'FileUpload'; 