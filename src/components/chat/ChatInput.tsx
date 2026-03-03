import { useState, useRef, type KeyboardEvent, type ChangeEvent } from 'react';
import { Send, Paperclip, X } from 'lucide-react';

interface Props {
  onSend: (text: string, files?: File[]) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: Props) {
  const [text, setText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSend() {
    const trimmed = text.trim();
    if ((!trimmed && attachedFiles.length === 0) || disabled) return;
    onSend(trimmed || 'Uploaded files', attachedFiles.length > 0 ? attachedFiles : undefined);
    setText('');
    setAttachedFiles([]);
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setAttachedFiles((prev) => [...prev, ...files]);
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function removeFile(index: number) {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {/* Attached files preview */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachedFiles.map((file, index) => (
            <div
              key={index}
              className="badge badge-lg gap-2 bg-base-200 pr-1"
            >
              <Paperclip className="w-3 h-3" />
              <span className="text-xs truncate max-w-[150px]">{file.name}</span>
              <button
                className="btn btn-ghost btn-xs btn-circle"
                onClick={() => removeFile(index)}
                aria-label="Remove file"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          disabled={disabled}
        />
        <button
          className="btn btn-ghost btn-circle"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Attach files"
          title="Attach files"
        >
          <Paperclip className="w-5 h-5" />
        </button>
        <textarea
          ref={textareaRef}
          className="textarea textarea-bordered flex-1 chat-textarea text-base leading-snug"
          placeholder="Type a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
        />
        <button
          className="btn btn-primary btn-circle"
          onClick={handleSend}
          disabled={disabled || (!text.trim() && attachedFiles.length === 0)}
          aria-label="Send message"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
