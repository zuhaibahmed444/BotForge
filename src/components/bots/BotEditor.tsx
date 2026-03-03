import { useState, useEffect } from 'react';
import { Save, X, Upload, FileText, Trash2 } from 'lucide-react';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import type { BotConfig } from '../../types.js';
import { DEFAULT_GROUP_ID } from '../../config.js';
import { listGroupFiles, readGroupFile, writeGroupFile } from '../../storage.js';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

interface Props {
  bot: BotConfig;
  isNew: boolean;
  onSave: (bot: BotConfig) => void;
  onCancel: () => void;
}

export function BotEditor({ bot: initialBot, isNew, onSave, onCancel }: Props) {
  const [bot, setBot] = useState<BotConfig>(initialBot);
  const [availableFiles, setAvailableFiles] = useState<string[]>([]);
  const [uploadingKnowledge, setUploadingKnowledge] = useState(false);

  useEffect(() => {
    loadAvailableFiles();
  }, []);

  async function loadAvailableFiles() {
    try {
      const files = await listGroupFiles(DEFAULT_GROUP_ID, '.');
      setAvailableFiles(files.filter((f) => !f.endsWith('/')));
    } catch (err) {
      console.error('Failed to load files:', err);
    }
  }

  function handleChange(field: keyof BotConfig, value: any) {
    setBot((prev) => ({ ...prev, [field]: value, updatedAt: Date.now() }));
  }

  function handleAddKnowledge(filename: string) {
    if (!bot.knowledgeBase.includes(filename)) {
      handleChange('knowledgeBase', [...bot.knowledgeBase, filename]);
    }
  }

  function handleRemoveKnowledge(filename: string) {
    handleChange(
      'knowledgeBase',
      bot.knowledgeBase.filter((f) => f !== filename)
    );
  }

  async function handleUploadKnowledge(files: FileList | null) {
    if (!files || files.length === 0) return;

    setUploadingKnowledge(true);
    const errors: string[] = [];
    const uploaded: string[] = [];

    try {
      // Create a safe folder name from bot name
      const safeBotName = bot.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const knowledgeFolder = `knowledge/${safeBotName}`;

      for (const file of Array.from(files)) {
        const fileName = file.name.toLowerCase();
        
        // Validate file type
        if (!fileName.endsWith('.docx') && !fileName.endsWith('.pdf')) {
          errors.push(`${file.name}: Only DOCX and PDF files are supported`);
          continue;
        }

        try {
          let content: string;
          let filename: string;

          // Handle DOCX files
          if (fileName.endsWith('.docx')) {
            const arrayBuffer = await file.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer });
            content = result.value;
            filename = `${knowledgeFolder}/${file.name.replace('.docx', '.txt')}`;
          } 
          // Handle PDF files
          else if (fileName.endsWith('.pdf')) {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const textParts: string[] = [];
            
            // Extract text from each page
            for (let i = 1; i <= pdf.numPages; i++) {
              const page = await pdf.getPage(i);
              const textContent = await page.getTextContent();
              const pageText = textContent.items
                .map((item: any) => item.str)
                .join(' ');
              textParts.push(pageText);
            }
            
            content = textParts.join('\n\n');
            filename = `${knowledgeFolder}/${file.name.replace('.pdf', '.txt')}`;
          } else {
            continue; // Should never reach here due to validation above
          }

          // Check if content was extracted
          if (!content || content.trim().length === 0) {
            errors.push(`${file.name}: No text content could be extracted`);
            continue;
          }

          await writeGroupFile(DEFAULT_GROUP_ID, filename, content);
          handleAddKnowledge(filename);
          uploaded.push(file.name);
        } catch (err) {
          console.error(`Failed to process ${file.name}:`, err);
          errors.push(`${file.name}: Failed to extract text - ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      await loadAvailableFiles();

      // Show results
      if (uploaded.length > 0) {
        const message = `Successfully uploaded: ${uploaded.join(', ')}`;
        if (errors.length > 0) {
          alert(`${message}\n\nErrors:\n${errors.join('\n')}`);
        }
      } else if (errors.length > 0) {
        alert(`Upload failed:\n${errors.join('\n')}`);
      }
    } catch (err) {
      console.error('Failed to upload knowledge:', err);
      alert('Failed to upload files');
    } finally {
      setUploadingKnowledge(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(bot);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-base-300 flex items-center justify-between">
        <h1 className="text-xl font-bold">{isNew ? 'Create Bot' : 'Edit Bot'}</h1>
        <button className="btn btn-ghost btn-sm btn-circle" onClick={onCancel}>
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Basic Info */}
        <div className="card bg-base-200">
          <div className="card-body">
            <h2 className="card-title text-lg">Basic Information</h2>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Bot Name</span>
              </label>
              <input
                type="text"
                className="input input-bordered"
                value={bot.name}
                onChange={(e) => handleChange('name', e.target.value)}
                required
              />
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Description</span>
              </label>
              <textarea
                className="textarea textarea-bordered"
                rows={2}
                value={bot.description}
                onChange={(e) => handleChange('description', e.target.value)}
                placeholder="What does this bot do?"
              />
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">System Prompt</span>
                <span className="label-text-alt">Define bot personality and behavior</span>
              </label>
              <textarea
                className="textarea textarea-bordered font-mono text-sm"
                rows={6}
                value={bot.systemPrompt}
                onChange={(e) => handleChange('systemPrompt', e.target.value)}
                placeholder="You are a helpful assistant specialized in..."
                required
              />
            </div>
          </div>
        </div>

        {/* Model Settings */}
        <div className="card bg-base-200">
          <div className="card-body">
            <h2 className="card-title text-lg">Model Settings</h2>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Model</span>
              </label>
              <select
                className="select select-bordered"
                value={bot.model}
                onChange={(e) => handleChange('model', e.target.value)}
              >
                <option value="claude-sonnet-4-6">Claude Sonnet 4</option>
                <option value="claude-opus-4">Claude Opus 4</option>
                <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Temperature</span>
                  <span className="label-text-alt">{bot.temperature}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  className="range range-sm"
                  value={bot.temperature}
                  onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
                />
                <div className="text-xs opacity-60 mt-1">
                  Lower = focused, Higher = creative
                </div>
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text">Max Tokens</span>
                </label>
                <input
                  type="number"
                  className="input input-bordered input-sm"
                  value={bot.maxTokens}
                  onChange={(e) => handleChange('maxTokens', parseInt(e.target.value))}
                  min="1024"
                  max="200000"
                />
              </div>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Top K</span>
                <span className="label-text-alt">Optional (0 = disabled)</span>
              </label>
              <input
                type="number"
                className="input input-bordered input-sm"
                value={bot.topK}
                onChange={(e) => handleChange('topK', parseInt(e.target.value))}
                min="0"
                max="500"
              />
              <div className="text-xs opacity-60 mt-1">
                Limits vocabulary to top K tokens (advanced)
              </div>
            </div>
          </div>
        </div>

        {/* Knowledge Base */}
        <div className="card bg-base-200">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <h2 className="card-title text-lg">Knowledge Base</h2>
              <label className="btn btn-sm btn-primary gap-2">
                <Upload className="w-4 h-4" />
                Upload Files
                <input
                  type="file"
                  multiple
                  accept=".docx,.pdf"
                  className="hidden"
                  onChange={(e) => handleUploadKnowledge(e.target.files)}
                  disabled={uploadingKnowledge}
                />
              </label>
            </div>

            <p className="text-sm opacity-60">
              Upload DOCX or PDF documents to give this bot specialized knowledge. Text will be automatically extracted and stored in <code className="text-xs bg-base-300 px-1 py-0.5 rounded">knowledge/{bot.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/</code>
            </p>

            {bot.knowledgeBase.length > 0 ? (
              <div className="space-y-2 mt-2">
                {bot.knowledgeBase.map((filename) => (
                  <div
                    key={filename}
                    className="flex items-center justify-between p-2 bg-base-300 rounded"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      <span className="text-sm">{filename}</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs text-error"
                      onClick={() => handleRemoveKnowledge(filename)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 opacity-60">
                <FileText className="w-8 h-8 mx-auto mb-2" />
                <p className="text-sm">No knowledge files yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary gap-2">
            <Save className="w-4 h-4" />
            {isNew ? 'Create Bot' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
