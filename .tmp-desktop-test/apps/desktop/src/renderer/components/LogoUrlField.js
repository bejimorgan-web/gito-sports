import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "../services/api-client";
import { resolveAssetUrl } from "./asset-url";
function getPreviewSource(value) {
    return resolveAssetUrl(value);
}
export function isValidLogoSource(value) {
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
    }
    catch {
        return false;
    }
}
export function LogoUrlField({ label, value, onChange, onUploadStateChange }) {
    const fileInputRef = useRef(null);
    const [fileName, setFileName] = useState("");
    const [previewSource, setPreviewSource] = useState(() => getPreviewSource(value));
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    const [uploadSuccess, setUploadSuccess] = useState(false);
    const invalid = value.trim() !== "" && !isValidLogoSource(value);
    useEffect(() => {
        setPreviewSource(getPreviewSource(value));
    }, [value]);
    const handleFileChange = async (event) => {
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
        const previewPromise = new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
        });
        reader.readAsDataURL(file);
        previewPromise.then(setPreviewSource).catch(() => { });
        try {
            const url = await apiClient.uploadImage(file);
            onChange(url);
            setUploadSuccess(true);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Upload failed.";
            setUploadError(message);
            setUploadSuccess(false);
        }
        finally {
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
    return (_jsxs("label", { children: [label, _jsxs("div", { className: "logo-url-field", children: [_jsx("input", { ref: fileInputRef, type: "file", accept: "image/*", onChange: handleFileChange, disabled: isUploading }), _jsxs("div", { className: "logo-url-preview-row", children: [_jsx("div", { className: "entity-avatar", children: previewSource ? (_jsx("img", { src: previewSource, alt: "Logo preview" })) : (_jsx("span", { children: "?" })) }), _jsxs("div", { children: [fileName ? (_jsx("div", { className: "file-help", children: isUploading ? "Uploading logo..." : `Selected file: ${fileName}. Preview shown above.` })) : (_jsx("div", { className: "file-help", children: "Upload an image to preview it immediately in the avatar." })), uploadError ? _jsx("p", { className: "field-error", children: uploadError }) : uploadSuccess ? _jsx("p", { className: "field-success", children: "Logo uploaded successfully." }) : null, invalid ? _jsx("p", { className: "field-error", children: "Upload an image file or leave this field blank. Existing http/https URLs are also accepted." }) : null, value ? (_jsx("button", { type: "button", className: "secondary", onClick: clearLogo, children: "Remove logo" })) : null] })] })] })] }));
}
