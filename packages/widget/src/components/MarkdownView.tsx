import type { FC, ReactNode } from 'react';

interface MarkdownViewProps {
  content: string;
}

export const MarkdownView: FC<MarkdownViewProps> = ({ content }) => {
  // Simple, safe Markdown parser for LLM responses
  const lines = content.split('\n');
  const elements: ReactNode[] = [];

  let inCodeBlock = false;
  let codeBlockBuffer: string[] = [];
  let codeBlockLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle code blocks (```)
    if (line.trim().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.trim().slice(3).trim();
        codeBlockBuffer = [];
      } else {
        inCodeBlock = false;
        elements.push(
          <pre key={`code-${i}`} className="nexus-code-block">
            {codeBlockLang && <div className="nexus-code-lang">{codeBlockLang}</div>}
            <code>{codeBlockBuffer.join('\n')}</code>
          </pre>
        );
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockBuffer.push(line);
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    // Unordered lists
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      const itemText = line.trim().slice(2);
      elements.push(
        <li key={`li-${i}`} className="nexus-list-item">
          {formatInline(itemText)}
        </li>
      );
      continue;
    }

    // Headers
    if (line.startsWith('### ')) {
      elements.push(<h4 key={`h-${i}`}>{formatInline(line.slice(4))}</h4>);
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<h3 key={`h-${i}`}>{formatInline(line.slice(3))}</h3>);
      continue;
    }

    // Default paragraph
    elements.push(<p key={`p-${i}`}>{formatInline(line)}</p>);
  }

  // Flush open code block if stream ends midway
  if (inCodeBlock) {
    elements.push(
      <pre key="code-unterminated" className="nexus-code-block">
        <code>{codeBlockBuffer.join('\n')}</code>
      </pre>
    );
  }

  return <div className="nexus-markdown">{elements}</div>;
};

/**
 * Parses bold, inline code, and links.
 */
function formatInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  // Tokenize regex for **bold**, `code`, [link](url)
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const segments = text.split(regex);

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    if (!seg) continue;

    if (seg.startsWith('**') && seg.endsWith('**')) {
      parts.push(<strong key={idx}>{seg.slice(2, -2)}</strong>);
    } else if (seg.startsWith('`') && seg.endsWith('`')) {
      parts.push(<code key={idx}>{seg.slice(1, -1)}</code>);
    } else if (seg.startsWith('[') && seg.includes('](') && seg.endsWith(')')) {
      const match = seg.match(/^\[(.*?)\]\((.*?)\)$/);
      if (match) {
        parts.push(
          <a
            key={idx}
            href={match[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="nexus-link"
          >
            {match[1]}
          </a>
        );
      } else {
        parts.push(seg);
      }
    } else {
      parts.push(seg);
    }
  }

  return parts;
}
