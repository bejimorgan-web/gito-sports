import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { apiClient } from "../services/api-client";
import { resolveAssetUrl } from "./asset-url";

interface LogoUrlFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onUploadStateChange?: (isUploading: boolean) => void;
}

function getPreviewSource(value: string) {
  return resolveAssetUrl(value);
}

export function isValidLogoSource(value: string) {
  if (!value.trim()) {
    return true;
  }

  if (value.startsWith("data:image/")) {
    return true;
  }

  if (value.startsWith("/uploads/")) {
    return true;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function LogoUrlField({ label, value, onChange, onUploadStateChange }: LogoUrlFieldProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [previewSource, setPreviewSource] = useState<string>(() => getPreviewSource(value));
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const invalid = value.trim() !== "" && !isValidLogoSource(value);

  useEffect(() => {
    setPreviewSource(getPreviewSource(value));
  }, [value]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setFileName(file.name);
    setPreviewSource("");
    setUploadError(null);
    setUploadSuccess(false);
    setIsUploading(true);
    onUploadStateChange?.(true);

    const reader = new FileReader();
    const previewPromise = new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
    });
    reader.readAsDataURL(file);

    previewPromise.then(setPreviewSource).catch(() => {});

    try {
      const url = await apiClient.uploadImage(file);
      onChange(url);
      setUploadSuccess(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      setUploadError(message);
      setUploadSuccess(false);
    } finally {
      setIsUploading(false);
      onUploadStateChange?.(false);
    }
  };

  const clearLogo = () => {
    setFileName("");
    setUploadError(null);
    setUploadSuccess(false);
    setPreviewSource("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onChange("");
    onUploadStateChange?.(false);
  };

  return (
    <label>
      {label}
      <div className="logo-url-field">
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} disabled={isUploading} />
        <div className="logo-url-preview-row">
          <div className="entity-avatar">
            {previewSource ? (
              <img src={previewSource} alt="Logo preview" />
            ) : (
              <span>?</span>
            )}
          </div>
          <div>
            {fileName ? (
              <div className="file-help">
                {isUploading ? "Uploading logo..." : `Selected file: ${fileName}. Preview shown above.`}
              </div>
            ) : (
              <div className="file-help">Upload an image to preview it immediately in the avatar.</div>
            )}
            {uploadError ? <p className="field-error">{uploadError}</p> : uploadSuccess ? <p className="field-success">Logo uploaded successfully.</p> : null}
            {invalid ? <p className="field-error">Upload an image file or leave this field blank. Existing http/https URLs are also accepted.</p> : null}
            {value ? (
              <button type="button" className="secondary" onClick={clearLogo}>
                Remove logo
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </label>
  );
}
