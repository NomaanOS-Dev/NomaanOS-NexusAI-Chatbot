import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  KnowledgeSpaceSummary,
  WorkspaceSummary,
  DocumentSourceSummary,
  DocumentChunkSummary,
  DocumentVersionSummary,
  IngestionJobSummary,
} from '../types';
import { api } from '../services/api';

const ALLOWED_EXTENSIONS = ['.pdf', '.md', '.txt', '.html', '.htm', '.json', '.yaml', '.yml', '.docx'];
const MAX_FILE_BYTES = 15728640; // 15 MiB

interface KnowledgeBasesViewProps {
  knowledgeSpaces: KnowledgeSpaceSummary[];
  activeWorkspace: WorkspaceSummary | null;
  workspaces?: WorkspaceSummary[];
  onSelectWorkspace?: (id: string) => void;
  onCreateKnowledgeSpace: (data: { name: string; slug: string; description?: string }) => Promise<void>;
  loading: boolean;
}

export const KnowledgeBasesView: React.FC<KnowledgeBasesViewProps> = ({
  knowledgeSpaces,
  activeWorkspace,
  workspaces,
  onSelectWorkspace,
  onCreateKnowledgeSpace,
  loading: spacesLoading,
}) => {
  // Selected Knowledge Space state
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);

  // Documents state for selected space
  const [documents, setDocuments] = useState<DocumentSourceSummary[]>([]);
  const [docsLoading, setDocsLoading] = useState<boolean>(false);
  const [docErrorMessage, setDocErrorMessage] = useState<string | null>(null);
  const [docSuccessMessage, setDocSuccessMessage] = useState<string | null>(null);

  // Space Creation Modal state
  const [createSpaceModalOpen, setCreateSpaceModalOpen] = useState(false);
  const [spaceName, setSpaceName] = useState('');
  const [spaceSlug, setSpaceSlug] = useState('');
  const [spaceDescription, setSpaceDescription] = useState('');
  const [isSubmittingSpace, setIsSubmittingSpace] = useState(false);
  const [spaceModalError, setSpaceModalError] = useState<string | null>(null);

  // Upload State
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadTitleOverride, setUploadTitleOverride] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Document Details / Chunks Drawer state
  const [selectedDocDetails, setSelectedDocDetails] = useState<DocumentSourceSummary | null>(null);
  const [docChunks, setDocChunks] = useState<DocumentChunkSummary[]>([]);
  const [docVersions, setDocVersions] = useState<DocumentVersionSummary[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [activeDetailsTab, setActiveDetailsTab] = useState<'overview' | 'chunks' | 'versions'>('overview');

  // Ingestion Jobs for selected space/document
  const [ingestionJobs, setIngestionJobs] = useState<IngestionJobSummary[]>([]);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);

  // Auto-select first space when list changes or active workspace changes
  useEffect(() => {
    if (knowledgeSpaces.length > 0) {
      if (!selectedSpaceId || !knowledgeSpaces.some((s) => s.id === selectedSpaceId)) {
        setSelectedSpaceId(knowledgeSpaces[0].id);
      }
    } else {
      setSelectedSpaceId(null);
      setDocuments([]);
    }
  }, [knowledgeSpaces, selectedSpaceId]);

  // Fetch documents whenever activeWorkspace or selectedSpaceId changes
  const fetchDocuments = useCallback(async () => {
    if (!activeWorkspace || !selectedSpaceId) {
      setDocuments([]);
      return;
    }
    setDocsLoading(true);
    setDocErrorMessage(null);
    try {
      const docs = await api.getDocuments(selectedSpaceId, activeWorkspace.id);
      setDocuments(docs);

      // Also fetch any background jobs
      try {
        const jobs = await api.getIngestionJobs(activeWorkspace.id);
        const filteredJobs = jobs.filter((j) => j.knowledgeSpaceId === selectedSpaceId);
        setIngestionJobs(filteredJobs);
      } catch (jobErr) {
        // jobs are optional diagnostics
      }
    } catch (err: any) {
      setDocErrorMessage(err.message || 'Failed to load documents.');
    } finally {
      setDocsLoading(false);
    }
  }, [activeWorkspace, selectedSpaceId]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Client-Side Validation helper
  const validateFile = async (file: File): Promise<string | null> => {
    if (!file || file.size === 0) {
      return 'File is empty (0 bytes). Please upload a valid document.';
    }
    if (file.size > MAX_FILE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      return `File size (${sizeMb} MiB) exceeds the maximum allowed limit of 15 MiB.`;
    }

    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `Unsupported file format '${ext}'. Supported extensions: ${ALLOWED_EXTENSIONS.join(', ')}`;
    }

    // PDF magic bytes verification: %PDF-
    if (ext === '.pdf') {
      try {
        const buffer = await file.slice(0, 5).arrayBuffer();
        const header = new TextDecoder().decode(buffer);
        if (!header.startsWith('%PDF-')) {
          return "MIME mismatch: File has .pdf extension but lacks the '%PDF-' signature.";
        }
      } catch (e) {
        return 'Could not verify PDF file header signature.';
      }
    }

    return null;
  };

  // Perform upload
  const handleUploadFile = async (file: File) => {
    if (!activeWorkspace || !selectedSpaceId) {
      setUploadError('Please select a project and knowledge space first.');
      return;
    }

    setUploadError(null);
    const validationError = await validateFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setUploadProgress(0);
    setUploadStatus('Uploading file...');

    try {
      await api.uploadDocument(
        activeWorkspace.id,
        selectedSpaceId,
        file,
        {
          title: uploadTitleOverride.trim() || undefined,
        },
        (percent) => {
          setUploadProgress(percent);
          if (percent === 100) {
            setUploadStatus('Processing document chunks and embeddings...');
          }
        }
      );

      setUploadStatus('Document uploaded and indexed successfully!');
      setUploadTitleOverride('');
      setDocSuccessMessage(`Successfully uploaded "${file.name}"`);
      setTimeout(() => {
        setUploadProgress(null);
        setUploadStatus(null);
        setDocSuccessMessage(null);
      }, 2500);

      // Refresh documents
      await fetchDocuments();
    } catch (err: any) {
      setUploadError(err.message || 'Document upload failed.');
      setUploadProgress(null);
      setUploadStatus(null);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await handleUploadFile(files[0]);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await handleUploadFile(files[0]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Create Knowledge Space
  const handleCreateSpaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spaceName.trim()) {
      setSpaceModalError('Name is required.');
      return;
    }
    const safeSlug =
      spaceSlug.trim() || spaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    setIsSubmittingSpace(true);
    setSpaceModalError(null);
    try {
      await onCreateKnowledgeSpace({
        name: spaceName.trim(),
        slug: safeSlug,
        description: spaceDescription.trim() || undefined,
      });
      setSpaceName('');
      setSpaceSlug('');
      setSpaceDescription('');
      setCreateSpaceModalOpen(false);
    } catch (err: any) {
      setSpaceModalError(err.message || 'Failed to create knowledge space.');
    } finally {
      setIsSubmittingSpace(false);
    }
  };

  // Delete Document
  const handleDeleteDocument = async (source: DocumentSourceSummary) => {
    if (!activeWorkspace) return;
    const confirmDelete = window.confirm(
      `Are you sure you want to delete "${source.title || source.filename}"? This will permanently remove its embeddings and chunks.`
    );
    if (!confirmDelete) return;

    try {
      await api.deleteDocument(source.id, activeWorkspace.id);
      setDocSuccessMessage(`Document "${source.title || source.filename}" deleted.`);
      if (selectedDocDetails?.id === source.id) {
        setSelectedDocDetails(null);
      }
      setTimeout(() => setDocSuccessMessage(null), 2500);
      await fetchDocuments();
    } catch (err: any) {
      setDocErrorMessage(err.message || 'Failed to delete document.');
    }
  };

  // Reprocess / Sync Document
  const handleSyncDocument = async (source: DocumentSourceSummary) => {
    if (!activeWorkspace) return;
    try {
      await api.syncDocument(source.id, activeWorkspace.id);
      setDocSuccessMessage(`Reprocessing job enqueued for "${source.title || source.filename}".`);
      setTimeout(() => setDocSuccessMessage(null), 3000);
      await fetchDocuments();
    } catch (err: any) {
      setDocErrorMessage(err.message || 'Failed to reprocess document.');
    }
  };

  // Open Document Details / Chunks Drawer
  const handleOpenDocDetails = async (source: DocumentSourceSummary) => {
    if (!activeWorkspace) return;
    setDetailsLoading(true);
    setSelectedDocDetails(source);
    setActiveDetailsTab('overview');
    try {
      const [fullSource, chunks, versions] = await Promise.all([
        api.getDocumentDetails(source.id, activeWorkspace.id),
        api.getDocumentChunks(source.id, activeWorkspace.id),
        api.getDocumentVersions(source.id, activeWorkspace.id),
      ]);
      setSelectedDocDetails(fullSource);
      setDocChunks(chunks);
      setDocVersions(versions);
    } catch (err: any) {
      console.warn('Error fetching document details', err);
    } finally {
      setDetailsLoading(false);
    }
  };

  // Retry failed ingestion job
  const handleRetryJob = async (jobId: string) => {
    if (!activeWorkspace) return;
    setRetryingJobId(jobId);
    try {
      await api.retryIngestionJob(jobId, activeWorkspace.id);
      setDocSuccessMessage('Ingestion job re-queued successfully.');
      setTimeout(() => setDocSuccessMessage(null), 2500);
      await fetchDocuments();
    } catch (err: any) {
      setDocErrorMessage(err.message || 'Failed to retry ingestion job.');
    } finally {
      setRetryingJobId(null);
    }
  };

  const activeSpace = knowledgeSpaces.find((ks) => ks.id === selectedSpaceId) || null;

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ready':
      case 'completed':
        return <span className="nexus-badge status-healthy">Ready</span>;
      case 'completed_with_warnings':
        return <span className="nexus-badge status-degraded">Ready (Warnings)</span>;
      case 'processing':
        return <span className="nexus-badge status-processing">Processing...</span>;
      case 'queued':
      case 'pending':
        return <span className="nexus-badge status-offline">Queued</span>;
      case 'failed':
        return <span className="nexus-badge status-offline" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}>Failed</span>;
      default:
        return <span className="nexus-badge">{status}</span>;
    }
  };

  return (
    <div className="nexus-view-container">
      {/* Top Header */}
      <div className="nexus-page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 className="nexus-page-title">Knowledge Bases</h1>
            {activeWorkspace && (
              <span className="nexus-badge status-healthy" style={{ fontSize: 13, padding: '4px 10px' }}>
                📁 Project: {activeWorkspace.name}
              </span>
            )}
          </div>
          <p className="nexus-page-subtitle">
            Manage project-specific knowledge spaces and upload technical documentation used by your SaaS chatbots.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          {workspaces && workspaces.length > 1 && onSelectWorkspace && (
            <select
              className="nexus-input"
              style={{ width: 'auto', background: '#1e293b', color: '#f8fafc' }}
              value={activeWorkspace?.id || ''}
              onChange={(e) => onSelectWorkspace(e.target.value)}
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  Project: {ws.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            className="nexus-btn-primary"
            onClick={() => setCreateSpaceModalOpen(true)}
            disabled={!activeWorkspace}
          >
            <span>➕</span> New Knowledge Space
          </button>
        </div>
      </div>

      {!activeWorkspace ? (
        <div className="nexus-empty-state">
          <p>Please select an active project to view and manage its knowledge spaces and documents.</p>
        </div>
      ) : spacesLoading ? (
        <div className="nexus-loading-state">
          <div className="nexus-spinner" />
          <p>Loading knowledge spaces for project {activeWorkspace.name}...</p>
        </div>
      ) : knowledgeSpaces.length === 0 ? (
        <div className="nexus-empty-state">
          <span style={{ fontSize: 42 }}>📚</span>
          <h3>No Knowledge Bases in this Project</h3>
          <p>
            Create your first knowledge space to ingest PDF runbooks, Markdown docs, HTML specifications, and API documentation.
          </p>
          <button type="button" className="nexus-btn-primary" onClick={() => setCreateSpaceModalOpen(true)}>
            Create Knowledge Space
          </button>
        </div>
      ) : (
        /* Two-Column Knowledge Base Layout */
        <div className="nexus-kb-layout">
          {/* Left Column: Knowledge Spaces list */}
          <div className="nexus-kb-sidebar">
            <div className="nexus-kb-sidebar-header">
              <h3 style={{ fontSize: 15, margin: 0, fontWeight: 600, color: '#f8fafc' }}>
                Knowledge Spaces ({knowledgeSpaces.length})
              </h3>
            </div>

            <div className="nexus-kb-space-list">
              {knowledgeSpaces.map((space) => {
                const isSelected = space.id === selectedSpaceId;
                return (
                  <div
                    key={space.id}
                    className={`nexus-kb-space-item ${isSelected ? 'active' : ''}`}
                    onClick={() => setSelectedSpaceId(space.id)}
                  >
                    <div className="nexus-kb-space-item-header">
                      <span className="nexus-kb-space-item-title">{space.name}</span>
                      <span className="nexus-badge status-healthy" style={{ fontSize: 11 }}>
                        {space.status || 'active'}
                      </span>
                    </div>
                    <code className="nexus-kb-space-item-slug">/{space.slug}</code>
                    {space.description && (
                      <p className="nexus-kb-space-item-desc">{space.description}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Documents & Upload in selected space */}
          <div className="nexus-kb-main-pane">
            {activeSpace ? (
              <>
                {/* Active Space Summary Card */}
                <div className="nexus-card" style={{ marginBottom: 20 }}>
                  <div className="nexus-card-header">
                    <div>
                      <h2 style={{ fontSize: 18, margin: '0 0 4px 0', color: '#f8fafc' }}>
                        {activeSpace.name}
                      </h2>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <code style={{ fontSize: 12, color: '#38bdf8' }}>/{activeSpace.slug}</code>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>•</span>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>
                          ID: {activeSpace.id}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button
                        type="button"
                        className="nexus-btn-ghost"
                        onClick={fetchDocuments}
                        disabled={docsLoading}
                        title="Refresh document repository"
                      >
                        🔄 Refresh
                      </button>
                    </div>
                  </div>
                  {activeSpace.description && (
                    <p style={{ fontSize: 13, color: '#cbd5e1', margin: '10px 0 0 0' }}>
                      {activeSpace.description}
                    </p>
                  )}
                </div>

                {/* Upload & Drag-and-Drop Area */}
                <div className="nexus-card" style={{ marginBottom: 20 }}>
                  <h3 style={{ fontSize: 16, margin: '0 0 12px 0', color: '#f8fafc' }}>
                    Upload Documentation
                  </h3>

                  {uploadError && (
                    <div className="nexus-form-error" style={{ marginBottom: 12 }}>
                      ⚠️ {uploadError}
                    </div>
                  )}

                  {docSuccessMessage && (
                    <div className="nexus-form-success" style={{ marginBottom: 12 }}>
                      ✓ {docSuccessMessage}
                    </div>
                  )}

                  {/* Dropzone */}
                  <div
                    className={`nexus-dropzone ${isDragging ? 'dragging' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      style={{ display: 'none' }}
                      accept={ALLOWED_EXTENSIONS.join(',')}
                      onChange={handleFileInputChange}
                    />

                    <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#f8fafc', marginBottom: 4 }}>
                      Drag and drop document files here, or <span style={{ color: '#38bdf8' }}>browse</span>
                    </div>
                    <p style={{ fontSize: 12, color: '#94a3b8', margin: 0, maxWidth: 500 }}>
                      Supported formats: <strong>.pdf, .md, .txt, .html, .htm, .json, .yaml, .yml, .docx</strong>
                      <br />
                      Maximum file size: <strong>15 MiB</strong> per document.
                    </p>
                  </div>

                  {/* Upload Progress Bar */}
                  {uploadProgress !== null && (
                    <div className="nexus-upload-progress-container" style={{ marginTop: 14 }}>
                      <div className="nexus-progress-header">
                        <span style={{ fontSize: 13, color: '#38bdf8', fontWeight: 600 }}>
                          {uploadStatus || 'Uploading...'}
                        </span>
                        <span style={{ fontSize: 13, color: '#94a3b8' }}>{uploadProgress}%</span>
                      </div>
                      <div className="nexus-progress-track">
                        <div
                          className="nexus-progress-bar"
                          style={{ width: `${Math.max(uploadProgress, 5)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Ingestion Diagnostic Alert (if any failed jobs exist) */}
                {ingestionJobs.some((j) => j.status === 'failed') && (
                  <div className="nexus-alert-warning" style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <strong>⚠️ Ingestion Notice:</strong> One or more background synchronization jobs failed.
                      </div>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                      {ingestionJobs
                        .filter((j) => j.status === 'failed')
                        .map((job) => (
                          <div
                            key={job.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '6px 0',
                              borderTop: '1px solid rgba(245, 158, 11, 0.2)',
                            }}
                          >
                            <span>
                              Job <code>{job.id.slice(0, 8)}</code>: {job.diagnosticMessage || job.errorCode || 'Ingestion error'} (Attempts: {job.attempts}/{job.maxAttempts})
                            </span>
                            <button
                              type="button"
                              className="nexus-btn-ghost"
                              style={{ padding: '3px 10px', fontSize: 12 }}
                              onClick={() => handleRetryJob(job.id)}
                              disabled={retryingJobId === job.id}
                            >
                              {retryingJobId === job.id ? 'Retrying...' : '🔄 Retry Job'}
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Documents Table */}
                <div className="nexus-card">
                  <div className="nexus-card-header" style={{ marginBottom: 12 }}>
                    <div>
                      <h3 style={{ fontSize: 16, margin: 0, color: '#f8fafc' }}>
                        Indexed Documents ({documents.length})
                      </h3>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>
                        PostgreSQL pgvector chunk embeddings & full-text search indexes
                      </span>
                    </div>
                  </div>

                  {docsLoading ? (
                    <div className="nexus-loading-state" style={{ padding: '40px 0' }}>
                      <div className="nexus-spinner" />
                      <p>Loading documents...</p>
                    </div>
                  ) : docErrorMessage ? (
                    <div className="nexus-form-error">{docErrorMessage}</div>
                  ) : documents.length === 0 ? (
                    <div className="nexus-empty-state" style={{ padding: '40px 20px' }}>
                      <span style={{ fontSize: 32 }}>📑</span>
                      <h4 style={{ margin: '8px 0 4px 0', color: '#f8fafc' }}>
                        No Documents in this Knowledge Space
                      </h4>
                      <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>
                        Drop your documentation files above to start extracting text, creating chunks, and generating vector embeddings.
                      </p>
                    </div>
                  ) : (
                    <div className="nexus-table-responsive">
                      <table className="nexus-table">
                        <thead>
                          <tr>
                            <th>Document Title / File</th>
                            <th>Status</th>
                            <th>Size</th>
                            <th>Chunks / Tokens</th>
                            <th>MIME / SHA</th>
                            <th>Ingested At</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {documents.map((doc) => (
                            <tr key={doc.id}>
                              <td>
                                <div style={{ fontWeight: 600, color: '#f8fafc' }}>
                                  {doc.title || doc.filename}
                                </div>
                                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                                  {doc.filename}
                                </div>
                                {doc.errorMessage && (
                                  <div style={{ fontSize: 11, color: '#f87171', marginTop: 2 }}>
                                    ⚠️ {doc.errorMessage}
                                  </div>
                                )}
                              </td>
                              <td>{getStatusBadge(doc.status)}</td>
                              <td style={{ fontSize: 13, color: '#cbd5e1' }}>
                                {formatBytes(doc.fileSizeBytes)}
                              </td>
                              <td>
                                <div style={{ fontSize: 13, color: '#38bdf8', fontWeight: 600 }}>
                                  {doc.chunkCount ?? '—'} chunks
                                </div>
                                {doc.totalTokens !== undefined && (
                                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                    {doc.totalTokens.toLocaleString()} tokens
                                  </div>
                                )}
                              </td>
                              <td>
                                <div style={{ fontSize: 12, color: '#cbd5e1' }}>{doc.mimeType}</div>
                                <code style={{ fontSize: 11, color: '#64748b' }}>
                                  {doc.sha256?.slice(0, 10)}...
                                </code>
                              </td>
                              <td style={{ fontSize: 12, color: '#94a3b8' }}>
                                {new Date(doc.createdAt).toLocaleDateString()}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <div style={{ display: 'inline-flex', gap: 6 }}>
                                  <button
                                    type="button"
                                    className="nexus-btn-ghost"
                                    style={{ padding: '4px 8px', fontSize: 12 }}
                                    onClick={() => handleOpenDocDetails(doc)}
                                    title="Inspect document text, chunks, and version history"
                                  >
                                    🔍 Details
                                  </button>
                                  <button
                                    type="button"
                                    className="nexus-btn-ghost"
                                    style={{ padding: '4px 8px', fontSize: 12 }}
                                    onClick={() => handleSyncDocument(doc)}
                                    title="Reprocess and re-embed document"
                                  >
                                    🔄 Sync
                                  </button>
                                  <button
                                    type="button"
                                    className="nexus-btn-ghost"
                                    style={{ padding: '4px 8px', fontSize: 12, color: '#f87171' }}
                                    onClick={() => handleDeleteDocument(doc)}
                                    title="Delete document and vector chunks"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="nexus-empty-state">
                <p>Select a knowledge space from the left column to view its documents.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Document Details / Chunks Drawer Modal */}
      {selectedDocDetails && (
        <div className="nexus-modal-overlay" onClick={() => setSelectedDocDetails(null)}>
          <div
            className="nexus-modal-card"
            style={{ maxWidth: 860, width: '92%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="nexus-modal-header">
              <div>
                <h3 style={{ margin: 0 }}>{selectedDocDetails.title || selectedDocDetails.filename}</h3>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  UUID: <code>{selectedDocDetails.id}</code>
                </div>
              </div>
              <button
                type="button"
                className="nexus-close-btn"
                onClick={() => setSelectedDocDetails(null)}
              >
                ✕
              </button>
            </div>

            {/* Drawer Tabs */}
            <div className="nexus-drawer-tabs">
              <button
                type="button"
                className={`nexus-drawer-tab ${activeDetailsTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveDetailsTab('overview')}
              >
                Overview & Metadata
              </button>
              <button
                type="button"
                className={`nexus-drawer-tab ${activeDetailsTab === 'chunks' ? 'active' : ''}`}
                onClick={() => setActiveDetailsTab('chunks')}
              >
                Structure Chunks ({docChunks.length})
              </button>
              <button
                type="button"
                className={`nexus-drawer-tab ${activeDetailsTab === 'versions' ? 'active' : ''}`}
                onClick={() => setActiveDetailsTab('versions')}
              >
                Versions ({docVersions.length})
              </button>
            </div>

            {detailsLoading ? (
              <div className="nexus-loading-state" style={{ padding: '40px 0' }}>
                <div className="nexus-spinner" />
                <p>Loading document details...</p>
              </div>
            ) : (
              <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '16px 0' }}>
                {activeDetailsTab === 'overview' && (
                  <div>
                    <div className="nexus-detail-list">
                      <div className="nexus-detail-item">
                        <span className="nexus-detail-label">Status:</span>
                        <span>{getStatusBadge(selectedDocDetails.status)}</span>
                      </div>
                      <div className="nexus-detail-item">
                        <span className="nexus-detail-label">Original Filename:</span>
                        <code>{selectedDocDetails.filename}</code>
                      </div>
                      <div className="nexus-detail-item">
                        <span className="nexus-detail-label">MIME Type:</span>
                        <span>{selectedDocDetails.mimeType}</span>
                      </div>
                      <div className="nexus-detail-item">
                        <span className="nexus-detail-label">File Size:</span>
                        <span>{formatBytes(selectedDocDetails.fileSizeBytes)}</span>
                      </div>
                      <div className="nexus-detail-item">
                        <span className="nexus-detail-label">SHA-256 Hash:</span>
                        <code style={{ fontSize: 11 }}>{selectedDocDetails.sha256}</code>
                      </div>
                      <div className="nexus-detail-item">
                        <span className="nexus-detail-label">Extracted Chunks:</span>
                        <span>{docChunks.length} chunks</span>
                      </div>
                    </div>

                    {selectedDocDetails.extractedTextPreview && (
                      <div style={{ marginTop: 16 }}>
                        <h4 style={{ fontSize: 13, color: '#f8fafc', marginBottom: 6 }}>
                          Extracted Text Preview:
                        </h4>
                        <pre
                          style={{
                            background: '#0f172a',
                            padding: 12,
                            borderRadius: 6,
                            fontSize: 12,
                            color: '#cbd5e1',
                            maxHeight: 180,
                            overflowY: 'auto',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {selectedDocDetails.extractedTextPreview}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                {activeDetailsTab === 'chunks' && (
                  <div>
                    {docChunks.length === 0 ? (
                      <p style={{ color: '#94a3b8' }}>No chunks generated for this document yet.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {docChunks.map((chunk) => (
                          <div
                            key={chunk.id}
                            style={{
                              background: '#0f172a',
                              border: '1px solid #334155',
                              borderRadius: 6,
                              padding: 12,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: 12,
                                color: '#38bdf8',
                                marginBottom: 6,
                              }}
                            >
                              <span>
                                Chunk #{chunk.chunkIndex ?? chunk.chunk_index ?? 0}{' '}
                                {(chunk.sectionPath || chunk.section_path) ? `— ${chunk.sectionPath || chunk.section_path}` : ''}
                              </span>
                              <span style={{ color: '#94a3b8' }}>
                                {chunk.tokenCount ?? chunk.token_count ?? 0} tokens{' '}
                                {(chunk.pageNumber || chunk.page_number) ? `• Page ${chunk.pageNumber || chunk.page_number}` : ''}
                              </span>
                            </div>
                            <p
                              style={{
                                fontSize: 13,
                                color: '#e2e8f0',
                                margin: 0,
                                whiteSpace: 'pre-wrap',
                                fontFamily: 'monospace',
                              }}
                            >
                              {chunk.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeDetailsTab === 'versions' && (
                  <div>
                    {docVersions.length === 0 ? (
                      <p style={{ color: '#94a3b8' }}>No version history available.</p>
                    ) : (
                      <div className="nexus-table-responsive">
                        <table className="nexus-table">
                          <thead>
                            <tr>
                              <th>Version</th>
                              <th>Current</th>
                              <th>Chunks</th>
                              <th>Tokens</th>
                              <th>Created</th>
                            </tr>
                          </thead>
                          <tbody>
                            {docVersions.map((v) => (
                              <tr key={v.id}>
                                <td>
                                  <strong>v{v.versionNumber}</strong>
                                </td>
                                <td>
                                  {v.isCurrent ? (
                                    <span className="nexus-badge status-healthy">Active</span>
                                  ) : (
                                    <span className="nexus-badge status-offline">Superseded</span>
                                  )}
                                </td>
                                <td>{v.chunkCount}</td>
                                <td>{v.totalTokens}</td>
                                <td style={{ fontSize: 12, color: '#94a3b8' }}>
                                  {new Date(v.createdAt).toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="nexus-modal-actions">
              <button
                type="button"
                className="nexus-btn-primary"
                onClick={() => setSelectedDocDetails(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Knowledge Space Modal */}
      {createSpaceModalOpen && (
        <div className="nexus-modal-overlay" onClick={() => setCreateSpaceModalOpen(false)}>
          <div className="nexus-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="nexus-modal-header">
              <h3>Create Knowledge Space</h3>
              <button
                type="button"
                className="nexus-close-btn"
                onClick={() => setCreateSpaceModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSpaceSubmit}>
              {spaceModalError && <div className="nexus-form-error">{spaceModalError}</div>}

              <div className="nexus-form-group">
                <label className="nexus-form-label">Space Name *</label>
                <input
                  type="text"
                  className="nexus-input"
                  placeholder="e.g. Sentinel Runbooks, SaaS Architecture Docs"
                  value={spaceName}
                  onChange={(e) => setSpaceName(e.target.value)}
                  disabled={isSubmittingSpace}
                  required
                />
              </div>

              <div className="nexus-form-group">
                <label className="nexus-form-label">Slug (optional)</label>
                <input
                  type="text"
                  className="nexus-input"
                  placeholder="e.g. sentinel-runbooks"
                  value={spaceSlug}
                  onChange={(e) => setSpaceSlug(e.target.value)}
                  disabled={isSubmittingSpace}
                />
              </div>

              <div className="nexus-form-group">
                <label className="nexus-form-label">Description (optional)</label>
                <textarea
                  className="nexus-input"
                  rows={3}
                  placeholder="Description of the documents stored in this space..."
                  value={spaceDescription}
                  onChange={(e) => setSpaceDescription(e.target.value)}
                  disabled={isSubmittingSpace}
                />
              </div>

              <div className="nexus-modal-actions">
                <button
                  type="button"
                  className="nexus-btn-ghost"
                  onClick={() => setCreateSpaceModalOpen(false)}
                  disabled={isSubmittingSpace}
                >
                  Cancel
                </button>
                <button type="submit" className="nexus-btn-primary" disabled={isSubmittingSpace}>
                  {isSubmittingSpace ? 'Creating...' : 'Create Space'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
