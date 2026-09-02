"use client";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { BookOpen, Copy } from "lucide-react";
import { useToast } from "./Toast";

interface MarkdownViewerProps {
  content: string;
  title?: string;
}

export function MarkdownViewer({ content, title = "README.md" }: MarkdownViewerProps) {
  const { toast } = useToast();

  function handleCopy() {
    navigator.clipboard.writeText(content);
    toast("README copied to clipboard", "info");
  }

  return (
    <div className="pt-6 border-t border-border-subtle">
      <div className="flex items-center justify-between pb-3 mb-2 border-b border-border-subtle">
        <div className="flex items-center gap-1.5 text-xs text-fg-muted font-medium">
          <BookOpen className="h-3.5 w-3.5" />
          <span>{title}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded-xs border border-border-default bg-surface px-2 py-0.5 text-xs text-fg-muted hover:border-border-emphasis hover:text-fg transition-colors"
        >
          <Copy className="h-3 w-3" />
          <span>Copy</span>
        </button>
      </div>

      <div className="markdown-body py-2">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeSanitize, defaultSchema]]}
          components={{
            a: ({ href, children, ...props }: any) => {
              const h = String(href || '');
              if (/^\s*(javascript|data|vbscript):/i.test(h)) {
                return <span>{children}</span>;
              }
              return (
                <a href={h} target="_blank" rel="noopener noreferrer" {...props}>
                  {children}
                </a>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
