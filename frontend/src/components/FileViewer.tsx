import { useEffect, useState } from 'react';
import {
  Download,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  FileText,
  Image as ImageIcon,
  AlertCircle,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatBytes } from '../lib/format';
import { Badge, Button } from './ui';

export interface FileViewerProps {
  url: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  className?: string;
}

export function FileViewer({
  url,
  fileName = 'document',
  mimeType,
  fileSize,
  className = '',
}: FileViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [detectedMime, setDetectedMime] = useState<string>(mimeType || '');
  const [detectedName, setDetectedName] = useState<string>(fileName);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(100);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(null);

    api
      .fetchFileBlob(url)
      .then(({ blob, mime, name }) => {
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
        setDetectedMime(mime || mimeType || 'application/pdf');
        if (name && name !== 'document') setDetectedName(name);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Could not load file.');
        setLoading(false);
      });

    return () => {
      active = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [url, mimeType]);

  const isImage = detectedMime.startsWith('image/');
  const isPdf = detectedMime.includes('pdf');

  function handleDownload() {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = detectedName || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleZoomIn() {
    setZoom((z) => Math.min(200, z + 20));
  }

  function handleZoomOut() {
    setZoom((z) => Math.max(50, z - 20));
  }

  function handleResetZoom() {
    setZoom(100);
  }

  return (
    <div className={`flex flex-col rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm ${className}`}>
      {/* File Viewer Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-slate-50/90 px-4 py-2.5 text-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          {isImage ? (
            <ImageIcon className="h-4 w-4 shrink-0 text-blue-600" />
          ) : (
            <FileText className="h-4 w-4 shrink-0 text-indigo-600" />
          )}
          <span className="font-semibold text-slate-800 truncate max-w-[240px]" title={detectedName}>
            {detectedName}
          </span>
          {fileSize !== undefined && fileSize > 0 && (
            <span className="text-xs text-slate-500 shrink-0">({formatBytes(fileSize)})</span>
          )}
          <Badge tone={isImage ? 'info' : 'neutral'} size="sm">
            {isPdf ? 'PDF Document' : isImage ? detectedMime.replace('image/', '').toUpperCase() : detectedMime}
          </Badge>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isImage && (
            <div className="flex items-center gap-1 border-r border-slate-200 pr-2 mr-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={handleZoomOut}
                disabled={loading || !!error || zoom <= 50}
                title="Zoom Out"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <button
                type="button"
                onClick={handleResetZoom}
                className="text-xs font-mono text-slate-600 px-1 hover:text-slate-900"
                title="Reset zoom"
              >
                {zoom}%
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={handleZoomIn}
                disabled={loading || !!error || zoom >= 200}
                title="Zoom In"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {blobUrl && (
            <>
              <Button
                variant="secondary"
                size="sm"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={handleDownload}
              >
                Download
              </Button>
              <a
                href={blobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition"
                title="Open in new window"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </>
          )}
        </div>
      </div>

      {/* Viewer Canvas */}
      <div className="relative min-h-[380px] max-h-[620px] flex-1 overflow-auto bg-slate-100 flex items-center justify-center p-4">
        {loading && (
          <div className="flex flex-col items-center gap-3 text-slate-500 py-12">
            <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
            <p className="text-sm font-medium">Decrypting and loading document...</p>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center gap-3 text-center max-w-md p-6 bg-rose-50 border border-rose-200 rounded-xl my-8">
            <AlertCircle className="h-8 w-8 text-rose-600 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-rose-900">Unable to load document</p>
              <p className="text-xs text-rose-700 mt-1">{error}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={() => {
                setLoading(true);
                setError(null);
                api
                  .fetchFileBlob(url)
                  .then(({ blob, mime, name }) => {
                    const u = URL.createObjectURL(blob);
                    setBlobUrl(u);
                    setDetectedMime(mime || mimeType || 'application/pdf');
                    if (name && name !== 'document') setDetectedName(name);
                    setLoading(false);
                  })
                  .catch((e: unknown) => {
                    setError(e instanceof Error ? e.message : 'Could not load file.');
                    setLoading(false);
                  });
              }}
            >
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && blobUrl && (
          <>
            {isImage ? (
              <div className="flex items-center justify-center w-full h-full overflow-auto">
                <img
                  src={blobUrl}
                  alt={detectedName}
                  style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'center center' }}
                  className="max-h-[540px] max-w-full rounded-lg shadow-md object-contain transition-transform duration-150"
                />
              </div>
            ) : isPdf ? (
              <div className="w-full h-[540px] rounded-lg overflow-hidden shadow-md bg-white">
                <object
                  data={`${blobUrl}#toolbar=1&navpanes=0`}
                  type="application/pdf"
                  className="w-full h-full"
                >
                  <iframe
                    src={`${blobUrl}#toolbar=1&navpanes=0`}
                    title={detectedName}
                    className="w-full h-full border-0"
                  >
                    <p className="p-4 text-sm text-slate-600">
                      Your browser cannot render PDFs inline.{' '}
                      <button
                        type="button"
                        onClick={handleDownload}
                        className="text-blue-600 underline font-semibold"
                      >
                        Download the file
                      </button>{' '}
                      to view it.
                    </p>
                  </iframe>
                </object>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-slate-700 p-8 bg-white rounded-xl shadow-sm border border-slate-200">
                <FileText className="h-12 w-12 text-slate-400" />
                <p className="font-semibold text-slate-800">{detectedName}</p>
                <p className="text-xs text-slate-500">MIME type: {detectedMime}</p>
                <Button variant="primary" size="sm" icon={<Download className="h-4 w-4" />} onClick={handleDownload}>
                  Download Document
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
